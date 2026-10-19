"""Background podcast generation jobs."""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import audio, quality, script_writer
from .providers import Provider, ProviderError, SynthesisOptions, Turn, get_provider, with_retries
from .budget import QuotaExhausted
from .providers.gemini import GeminiProvider
from .text_utils import chunk_text, clean_text, format_duration, split_sentences

log = logging.getLogger("podcast")

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data")) / "jobs"
JOB_TTL_SEC = float(os.getenv("JOB_TTL_HOURS", "24")) * 3600
PAUSED_TTL_SEC = 7 * 24 * 3600   # paused (free quota) jobs wait up to a week to be continued
MAX_TAKES = 3
CHUNK_PAUSE_SEC = 0.75
TURN_GAP_SEC = 0.3


@dataclass
class JobRequest:
    text: str
    language: str
    mode: str = "narrator"          # narrator | conversation
    provider: str = "auto"
    voice: str = ""
    voice2: str = ""
    style: str = "warm"
    pace: str = "natural"
    warm_master: bool = True
    title: str = "Podcast"
    keys: dict[str, str] = field(default_factory=dict)
    free_only: bool = True          # never go past a free quota; pause instead
    limit_overrides: dict = field(default_factory=dict)


@dataclass
class Job:
    id: str
    request: JobRequest
    status: str = "queued"
    stage: str = "Waiting to start"
    progress: float = 0.0
    error: str | None = None
    warnings: list[str] = field(default_factory=list)
    created: float = field(default_factory=time.time)
    finished: float | None = None
    result: dict | None = None
    script: list[dict] | None = None
    cancelled: bool = False
    resume_at: str | None = None     # ISO time the free quota resets, when paused

    @property
    def dir(self) -> Path:
        return DATA_DIR / self.id

    def public(self) -> dict:
        return {
            "id": self.id, "status": self.status, "stage": self.stage,
            "progress": round(self.progress, 4), "error": self.error, "warnings": self.warnings[-10:],
            "result": self.result, "has_script": bool(self.script), "resume_at": self.resume_at,
            "elapsed_sec": round((self.finished or time.time()) - self.created, 1),
        }


JOBS: dict[str, Job] = {}


def create_job(req: JobRequest) -> Job:
    cleanup_old()
    job = Job(id=uuid.uuid4().hex[:12], request=req)
    JOBS[job.id] = job
    job.dir.mkdir(parents=True, exist_ok=True)
    job.task = asyncio.create_task(run_job(job))  # keep a reference so it isn't GC'd
    return job


def resume_job(job: Job) -> Job:
    """Continue a job paused by the free quota; parts already recorded are kept."""
    job.status, job.stage, job.error, job.resume_at = "queued", "Continuing", None, None
    job.cancelled, job.finished = False, None
    job.task = asyncio.create_task(run_job(job))
    return job


def cleanup_old() -> None:
    now = time.time()
    for jid, job in list(JOBS.items()):
        ttl = PAUSED_TTL_SEC if job.status == "paused" else JOB_TTL_SEC
        if job.finished and now - job.finished > ttl:
            shutil.rmtree(job.dir, ignore_errors=True)
            JOBS.pop(jid, None)
    if DATA_DIR.exists():
        for d in DATA_DIR.iterdir():
            if d.name not in JOBS and now - d.stat().st_mtime > PAUSED_TTL_SEC:
                shutil.rmtree(d, ignore_errors=True)


class Cancelled(Exception):
    pass


def default_voices(provider: Provider, language: str, voices=None) -> tuple[str, str]:
    voices = provider.voices(language) if voices is None else voices
    rec = [v for v in voices if v.recommended] or voices
    female = next((v.id for v in rec if v.gender == "female"), rec[0].id if rec else "")
    male = next((v.id for v in rec if v.gender == "male"), female)
    return female, male


async def best_take(make, text: str, language: str, job: Job, label: str) -> tuple[np.ndarray, list[str]]:
    """Synthesize, check the take, and retry bad takes (truncated, rambling, dead air).

    Returns the best take and its remaining problems ([] when clean)."""
    best, best_problems = None, None
    for take in range(MAX_TAKES):
        if job.cancelled:
            raise Cancelled()
        pcm = await with_retries(make)
        pcm = audio.trim_silence(pcm)
        problems = await asyncio.to_thread(quality.take_problems, pcm, text, language)
        if not problems:
            return pcm, []
        log.warning("%s take %d rejected: %s", label, take + 1, problems)
        if best_problems is None or len(problems) < len(best_problems):
            best, best_problems = pcm, problems
    if not _truncated(best_problems):
        job.warnings.append(f"{label}: kept best of {MAX_TAKES} takes ({'; '.join(best_problems)})")
    return best, best_problems


def _truncated(problems: list[str]) -> bool:
    return any(p.startswith("too short") for p in problems)


def _halves(items: list) -> tuple[list, list]:
    mid = len(items) // 2
    return items[:mid], items[mid:]


def _join(pcms: list[np.ndarray], gap: float) -> np.ndarray:
    out = []
    for i, p in enumerate(pcms):
        out.append(audio.fade(p))
        if i < len(pcms) - 1:
            out.append(audio.silence(gap))
    return np.concatenate(out)


def _never_truncated(label: str) -> ProviderError:
    # Better to fail loudly than to hand over a podcast with a silently missing passage.
    return ProviderError(f"{label}: the voice engine keeps cutting this passage short, so it was not "
                         f"recorded completely. Try again, or try another voice or engine.")


def host_names(language: str, g1: str | None, g2: str | None) -> tuple[str, str]:
    """Host names that match the voices' genders - Hebrew verbs and adjectives depend on it."""
    names = {"he": {"female": ["Noa", "Maya"], "male": ["Yoni", "Avi"]},
             "en": {"female": ["Emma", "Lily"], "male": ["Jack", "Ben"]}}[language]
    first = names.get(g1 or "female", names["female"])[0]
    pool = names.get(g2 or "male", names["male"])
    return first, pool[1] if pool[0] == first else pool[0]


def _part_path(job: Job, i: int) -> Path:
    return job.dir / "parts" / f"{i:05d}.pcm"


def _save_part(job: Job, i: int, pcm: np.ndarray) -> Path:
    """Parts go to disk so book-length podcasts don't have to fit in memory, and so a job
    paused by the free quota can continue later without paying for the same audio twice."""
    path = _part_path(job, i)
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(audio.fade(pcm).astype("<i2").tobytes())
    tmp.replace(path)               # atomic: a half-written part is never mistaken for done
    return path


def _waiting(job: Job, seconds: float) -> None:
    job.stage = f"Staying within the free tier: waiting {int(seconds)}s for the per-minute limit"


def _assemble(mp3_path: Path, segments: list[tuple[Path, float]], warm: bool, title: str) -> np.ndarray:
    """Stream all parts, with natural pauses, into the encoder. Returns the first 3 minutes for analysis."""
    head, head_len, limit = [], 0, audio.SAMPLE_RATE * 180

    def stream():
        nonlocal head_len
        yield audio.silence(0.35)
        for i, (part, gap) in enumerate(segments):
            pcm = audio.pcm_from_bytes(part.read_bytes())
            if head_len < limit:
                head.append(pcm)
                head_len += pcm.size
            yield pcm
            yield audio.silence(gap if i < len(segments) - 1 else 0.6)

    audio.encode_mp3_stream(stream(), mp3_path, warm, "128k", title)
    return np.concatenate(head)[:limit] if head else np.zeros(0, dtype=np.int16)


async def run_job(job: Job) -> None:
    req = job.request
    try:
        audio.require_ffmpeg()
        job.status = "running"
        provider = get_provider(req.provider, req.keys, req.free_only, req.limit_overrides)
        if isinstance(provider, GeminiProvider):
            provider.gate.on_wait = lambda s: _waiting(job, s)
        text = clean_text(req.text)
        if not text:
            raise ProviderError("The text is empty after cleanup.")
        voices = await asyncio.to_thread(provider.voices, req.language)
        v1_default, v2_default = default_voices(provider, req.language, voices)
        v1 = req.voice or v1_default
        v2 = req.voice2 or (v2_default if v2_default != v1 else v1_default)
        if not v1:
            raise ProviderError(f"{provider.label}: no voices available for this language.")
        gender = {v.id: v.gender for v in voices}
        opts = SynthesisOptions(language=req.language, style=req.style, pace=req.pace,
                                host_names=host_names(req.language, gender.get(v1), gender.get(v2)),
                                genders=(gender.get(v1, "female"), gender.get(v2, "male")))

        if req.mode == "conversation":
            segments = await _conversation_segments(job, provider, text, opts, v1, v2)
        else:
            segments = await _narrator_segments(job, provider, text, opts, v1)

        job.stage = "Mastering audio (warmth EQ, loudness)"
        job.progress = 0.97
        mp3 = job.dir / "podcast.mp3"
        head = await asyncio.to_thread(_assemble, mp3, segments, req.warm_master, req.title)
        metrics = await asyncio.to_thread(quality.analyze, head)
        shutil.rmtree(job.dir / "parts", ignore_errors=True)

        duration = await asyncio.to_thread(audio.probe_duration, mp3)
        job.result = {
            "duration_sec": round(duration, 2),
            "duration_str": format_duration(duration),
            "size_bytes": mp3.stat().st_size,
            "url": f"/api/jobs/{job.id}/audio",
            "download_url": f"/api/jobs/{job.id}/download",
            "provider": provider.label,
            "voices": [v1, v2] if req.mode == "conversation" else [v1],
            "humanness": quality.humanness_score(metrics),
            "metrics": metrics.to_dict(),
        }
        job.status, job.stage, job.progress = "done", "Ready", 1.0
    except QuotaExhausted as e:
        job.status, job.resume_at = "paused", e.reset_at.isoformat()
        job.stage = "Paused: today's free quota is used up"
        job.error = str(e)
    except (Cancelled, asyncio.CancelledError):
        job.status, job.stage = "cancelled", "Cancelled"
    except ProviderError as e:
        job.status, job.error, job.stage = "error", str(e), "Failed"
    except Exception as e:  # pragma: no cover - surfaced to the UI
        log.exception("job %s failed", job.id)
        job.status, job.error, job.stage = "error", f"{type(e).__name__}: {e}", "Failed"
    finally:
        job.finished = time.time()


async def _run_parallel(job: Job, provider: Provider, units: list, worker, start: float, span: float):
    sem = asyncio.Semaphore(max(1, provider.concurrency))
    results: list = [None] * len(units)
    done = 0

    async def run(i, unit):
        nonlocal done
        async with sem:
            if job.cancelled:
                raise Cancelled()
            results[i] = await worker(i, unit)
            done += 1
            job.progress = start + span * done / len(units)
            job.stage = f"Recording voice: part {done} of {len(units)}"

    tasks = [asyncio.create_task(run(i, u)) for i, u in enumerate(units)]
    try:
        await asyncio.gather(*tasks)
    except QuotaExhausted:
        # Requests already in flight were counted against the quota: let them finish and be
        # saved, so continuing tomorrow doesn't pay for them again.
        await asyncio.gather(*tasks, return_exceptions=True)
        raise
    except BaseException:
        for t in tasks:
            t.cancel()
        raise
    return results


async def _narrator_segments(job, provider, text, opts, voice):
    chunks = chunk_text(text, provider.max_chunk_chars)
    job.stage = f"Recording voice: 0 of {len(chunks)} parts"

    async def speak(text: str, label: str, depth: int = 0) -> np.ndarray:
        pcm, problems = await best_take(lambda: provider.synthesize(text, voice, opts), text,
                                        opts.language, job, label)
        if _truncated(problems):
            sentences = split_sentences(text)
            if depth >= 3 or len(sentences) < 2:
                raise _never_truncated(label)
            a, b = _halves(sentences)       # shorter requests are cut off far less often
            return _join([await speak(" ".join(a), label, depth + 1),
                          await speak(" ".join(b), label, depth + 1)], 0.35)
        return pcm

    async def worker(i, paras):
        if _part_path(job, i).exists():
            return _part_path(job, i)
        return _save_part(job, i, await speak("\n\n".join(paras), f"Part {i + 1}"))

    pcms = await _run_parallel(job, provider, chunks, worker, 0.02, 0.94)
    return [(p, CHUNK_PAUSE_SEC) for p in pcms]


async def _conversation_segments(job, provider, text, opts, v1, v2):
    req = job.request
    gemini = provider if isinstance(provider, GeminiProvider) else \
        GeminiProvider(req.keys.get("gemini"), free_only=req.free_only, limit_overrides=req.limit_overrides)
    if not gemini.available():
        raise ProviderError("Two-host conversation mode needs a Gemini API key to write the script.")
    job.stage = "Writing the two-host script"

    def on_progress(i, n):
        job.progress = 0.02 + 0.25 * i / n
        job.stage = f"Writing the two-host script: part {i} of {n}"

    if job.script:      # resuming: the script was already written (and paid for in quota)
        turns = [Turn(t["speaker"], t["text"]) for t in job.script]
    else:
        turns = await script_writer.write_dialogue(gemini, text, opts.language, opts.host_names,
                                                   on_progress, opts.genders)
    job.script = [{"speaker": t.speaker, "text": t.text} for t in turns]
    a, b = opts.host_names
    voices = {a: v1, b: v2}

    if provider.supports_dialogue:
        batches = script_writer.batch_turns(turns, provider.max_chunk_chars)

        async def speak(batch: list[Turn], label: str) -> np.ndarray:
            chunk = " ".join(t.text for t in batch)
            pcm, problems = await best_take(lambda: provider.synthesize_dialogue(batch, voices, opts),
                                            chunk, opts.language, job, label)
            if _truncated(problems):
                if len(batch) < 2:
                    raise _never_truncated(label)
                a, b = _halves(batch)
                return _join([await speak(a, label), await speak(b, label)], TURN_GAP_SEC)
            return pcm

        async def worker(i, batch: list[Turn]):
            if _part_path(job, i).exists():
                return _part_path(job, i)
            return _save_part(job, i, await speak(batch, f"Part {i + 1}"))

        pcms = await _run_parallel(job, provider, batches, worker, 0.28, 0.68)
        return [(p, TURN_GAP_SEC + 0.1) for p in pcms]

    async def worker(i, turn: Turn):
        if _part_path(job, i).exists():
            return _part_path(job, i)
        pcm, problems = await best_take(lambda: provider.synthesize(turn.text, voices[turn.speaker], opts),
                                        turn.text, opts.language, job, f"Line {i + 1}")
        if _truncated(problems):
            raise _never_truncated(f"Line {i + 1}")
        return _save_part(job, i, pcm)

    pcms = await _run_parallel(job, provider, turns, worker, 0.28, 0.68)
    return [(p, TURN_GAP_SEC) for p in pcms]
