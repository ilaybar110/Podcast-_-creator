"""Background podcast generation jobs."""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import time
import uuid
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import audio, quality, script_writer
from .providers import Provider, ProviderError, SynthesisOptions, Turn, get_provider, with_retries
from .providers.gemini import GeminiProvider
from .text_utils import chunk_text, clean_text, format_duration

log = logging.getLogger("podcast")

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data")) / "jobs"
JOB_TTL_SEC = float(os.getenv("JOB_TTL_HOURS", "24")) * 3600
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

    @property
    def dir(self) -> Path:
        return DATA_DIR / self.id

    def public(self) -> dict:
        return {
            "id": self.id, "status": self.status, "stage": self.stage,
            "progress": round(self.progress, 4), "error": self.error, "warnings": self.warnings[-10:],
            "result": self.result, "has_script": bool(self.script),
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


def cleanup_old() -> None:
    now = time.time()
    for jid, job in list(JOBS.items()):
        if job.finished and now - job.finished > JOB_TTL_SEC:
            shutil.rmtree(job.dir, ignore_errors=True)
            JOBS.pop(jid, None)
    if DATA_DIR.exists():
        for d in DATA_DIR.iterdir():
            if d.name not in JOBS and now - d.stat().st_mtime > JOB_TTL_SEC:
                shutil.rmtree(d, ignore_errors=True)


class Cancelled(Exception):
    pass


def default_voices(provider: Provider, language: str) -> tuple[str, str]:
    voices = provider.voices(language)
    rec = [v for v in voices if v.recommended] or voices
    female = next((v.id for v in rec if v.gender == "female"), rec[0].id if rec else "")
    male = next((v.id for v in rec if v.gender == "male"), female)
    return female, male


async def best_take(make, text: str, language: str, job: Job, label: str) -> np.ndarray:
    """Synthesize, check the take, and retry bad takes (truncated, rambling, dead air)."""
    best, best_problems = None, None
    for take in range(MAX_TAKES):
        if job.cancelled:
            raise Cancelled()
        pcm = await with_retries(make)
        pcm = audio.trim_silence(pcm)
        problems = await asyncio.to_thread(quality.take_problems, pcm, text, language)
        if not problems:
            return pcm
        log.warning("%s take %d rejected: %s", label, take + 1, problems)
        if best_problems is None or len(problems) < len(best_problems):
            best, best_problems = pcm, problems
    job.warnings.append(f"{label}: kept best of {MAX_TAKES} takes ({'; '.join(best_problems)})")
    return best


def _save_part(job: Job, i: int, pcm: np.ndarray) -> Path:
    """Parts go to disk so book-length podcasts don't have to fit in memory."""
    path = job.dir / "parts" / f"{i:05d}.pcm"
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(audio.fade(pcm).astype("<i2").tobytes())
    return path


def _assemble(wav_path: Path, segments: list[tuple[Path, float]]) -> np.ndarray:
    """Stream all parts into one WAV with natural pauses. Returns the first 3 minutes for analysis."""
    head, head_len, limit = [], 0, audio.SAMPLE_RATE * 180
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(audio.SAMPLE_RATE)
        w.writeframes(audio.silence(0.35).tobytes())
        for i, (part, gap) in enumerate(segments):
            pcm = audio.pcm_from_bytes(part.read_bytes())
            w.writeframes(pcm.tobytes())
            if head_len < limit:
                head.append(pcm)
                head_len += pcm.size
            w.writeframes(audio.silence(gap if i < len(segments) - 1 else 0.6).tobytes())
    return np.concatenate(head)[:limit] if head else np.zeros(0, dtype=np.int16)


async def run_job(job: Job) -> None:
    req = job.request
    try:
        audio.require_ffmpeg()
        job.status = "running"
        provider = get_provider(req.provider, req.keys)
        text = clean_text(req.text)
        if not text:
            raise ProviderError("The text is empty after cleanup.")
        opts = SynthesisOptions(language=req.language, style=req.style, pace=req.pace,
                                host_names=("Noa", "Yoni") if req.language == "he" else ("Emma", "Jack"))
        v1_default, v2_default = default_voices(provider, req.language)
        v1 = req.voice or v1_default
        v2 = req.voice2 or (v2_default if v2_default != v1 else v1_default)

        if req.mode == "conversation":
            segments = await _conversation_segments(job, provider, text, opts, v1, v2)
        else:
            segments = await _narrator_segments(job, provider, text, opts, v1)

        job.stage = "Mastering audio (warmth EQ, loudness)"
        job.progress = 0.97
        wav, mp3 = job.dir / "podcast.wav", job.dir / "podcast.mp3"
        head = await asyncio.to_thread(_assemble, wav, segments)
        await asyncio.to_thread(audio.encode_mp3, wav, mp3, req.warm_master, "128k", req.title)
        metrics = await asyncio.to_thread(quality.analyze, head)
        wav.unlink(missing_ok=True)
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
    except Cancelled:
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
    except BaseException:
        for t in tasks:
            t.cancel()
        raise
    return results


async def _narrator_segments(job, provider, text, opts, voice):
    chunks = chunk_text(text, provider.max_chunk_chars)
    job.stage = f"Recording voice: 0 of {len(chunks)} parts"

    async def worker(i, paras):
        chunk = "\n\n".join(paras)
        pcm = await best_take(lambda: provider.synthesize(chunk, voice, opts), chunk,
                              opts.language, job, f"Part {i + 1}")
        return _save_part(job, i, pcm)

    pcms = await _run_parallel(job, provider, chunks, worker, 0.02, 0.94)
    return [(p, CHUNK_PAUSE_SEC) for p in pcms]


async def _conversation_segments(job, provider, text, opts, v1, v2):
    gemini = provider if isinstance(provider, GeminiProvider) else GeminiProvider(job.request.keys.get("gemini"))
    if not gemini.available():
        raise ProviderError("Two-host conversation mode needs a Gemini API key to write the script.")
    job.stage = "Writing the two-host script"

    def on_progress(i, n):
        job.progress = 0.02 + 0.25 * i / n
        job.stage = f"Writing the two-host script: part {i} of {n}"

    turns = await script_writer.write_dialogue(gemini, text, opts.language, opts.host_names, on_progress)
    job.script = [{"speaker": t.speaker, "text": t.text} for t in turns]
    a, b = opts.host_names
    voices = {a: v1, b: v2}

    if provider.supports_dialogue:
        batches = script_writer.batch_turns(turns, provider.max_chunk_chars)

        async def worker(i, batch: list[Turn]):
            chunk = " ".join(t.text for t in batch)
            pcm = await best_take(lambda: provider.synthesize_dialogue(batch, voices, opts), chunk,
                                  opts.language, job, f"Part {i + 1}")
            return _save_part(job, i, pcm)

        pcms = await _run_parallel(job, provider, batches, worker, 0.28, 0.68)
        return [(p, TURN_GAP_SEC + 0.1) for p in pcms]

    async def worker(i, turn: Turn):
        pcm = await best_take(lambda: provider.synthesize(turn.text, voices[turn.speaker], opts),
                              turn.text, opts.language, job, f"Line {i + 1}")
        return _save_part(job, i, pcm)

    pcms = await _run_parallel(job, provider, turns, worker, 0.28, 0.68)
    return [(p, TURN_GAP_SEC) for p in pcms]
