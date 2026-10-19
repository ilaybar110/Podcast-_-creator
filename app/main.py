"""FastAPI app: text in, warm human podcast MP3 out."""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import audio, prompts
from .extract import extract_text
from .jobs import JOBS, JobRequest, create_job, default_voices, host_names
from .providers import PROVIDER_CLASSES, ProviderError, SynthesisOptions, get_provider, with_retries
from .text_utils import clean_text, detect_language, estimate_seconds, format_duration

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
STATIC = Path(__file__).parent / "static"
MAX_CHARS = int(os.getenv("MAX_CHARS", "3000000"))
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))

app = FastAPI(title="Podcast Creator")
app.mount("/static", StaticFiles(directory=STATIC), name="static")

PREVIEW_TEXT = {
    "he": "היי, שלום לכולם וברוכים הבאים. אני ממש {glad} שאתם פה איתנו היום, "
          "כי יש לנו נושא מרתק לדבר עליו. אז תכינו לכם כוס קפה, תתרווחו, ובואו נתחיל.",
    "en": "Hey everyone, and welcome back. I'm really glad you're here with us today, "
          "because we've got a fascinating story to talk about. So grab a coffee, get comfy, "
          "and let's dive in.",
}
_preview_cache: dict[tuple, tuple[float, bytes]] = {}


def _keys(request: Request) -> dict[str, str]:
    keys = {}
    if request.headers.get("x-gemini-key"):
        keys["gemini"] = request.headers["x-gemini-key"].strip()
    if request.headers.get("x-elevenlabs-key"):
        keys["elevenlabs"] = request.headers["x-elevenlabs-key"].strip()
    return keys


@app.get("/", response_class=HTMLResponse)
def index():
    return (STATIC / "index.html").read_text(encoding="utf-8")


@app.get("/api/config")
def config(request: Request, language: str = "he"):
    keys = _keys(request)
    engines = []
    for name, cls in PROVIDER_CLASSES.items():
        p = cls(keys.get(name)) if name != "edge" else cls()
        ok = p.available()
        voices = [v.to_dict() for v in p.voices(language)] if ok else []
        engines.append({"id": name, "label": p.label, "available": ok,
                        "supports_dialogue": p.supports_dialogue, "voices": voices,
                        "defaults": default_voices(p, language) if ok and voices else None})
    styles = [{"id": k, "label": v["label_he"] if language == "he" else v["label_en"]}
              for k, v in prompts.STYLES.items()]
    return {"engines": engines, "styles": styles, "max_chars": MAX_CHARS,
            "conversation_available": any(e["id"] == "gemini" and e["available"] for e in engines)}


class EstimateIn(BaseModel):
    text: str
    language: str | None = None
    mode: str = "narrator"


@app.post("/api/estimate")
def estimate(body: EstimateIn):
    text = clean_text(body.text)
    lang = body.language or detect_language(text)
    secs = estimate_seconds(text, lang)
    if body.mode == "conversation":
        secs *= 1.25   # dialogue adds reactions, questions and an intro/outro
    return {"language": lang, "chars": len(text), "words": len(text.split()),
            "estimated_sec": round(secs, 1), "estimated_str": format_duration(secs)}


@app.post("/api/extract")
async def extract(file: UploadFile = File(...)):
    limit = MAX_UPLOAD_MB * 1024 * 1024
    buf = bytearray()
    while chunk := await file.read(1 << 20):
        buf += chunk
        if len(buf) > limit:
            raise HTTPException(413, f"File is larger than {MAX_UPLOAD_MB} MB")
    try:
        text = await asyncio.to_thread(extract_text, file.filename or "file.txt", bytes(buf))
    except Exception as e:
        raise HTTPException(400, f"Could not read this file: {e}")
    return {"text": text, "language": detect_language(text)}


class PreviewIn(BaseModel):
    language: str = "he"
    provider: str = "auto"
    voice: str
    style: str = "warm"
    pace: str = "natural"


@app.post("/api/preview")
async def preview(body: PreviewIn, request: Request):
    if body.language not in PREVIEW_TEXT or body.style not in prompts.STYLES or body.pace not in prompts.PACES:
        raise HTTPException(400, "Invalid language, style or pace")
    try:
        provider = get_provider(body.provider, _keys(request))
    except ProviderError as e:
        raise HTTPException(400, str(e))
    key = (provider.name, body.voice, body.language, body.style, body.pace)
    hit = _preview_cache.get(key)
    if hit and time.time() - hit[0] < 6 * 3600:
        return Response(hit[1], media_type="audio/mpeg")
    voices = await asyncio.to_thread(provider.voices, body.language)
    gender = next((v.gender for v in voices if v.id == body.voice), "female")
    names = host_names(body.language, gender, None)
    opts = SynthesisOptions(language=body.language, style=body.style, pace=body.pace,
                            host_names=names, genders=(gender, "male" if gender == "female" else "female"))
    text = PREVIEW_TEXT[body.language].format(glad="שמח" if gender == "male" else "שמחה")
    try:
        pcm = await with_retries(lambda: provider.synthesize(text, body.voice, opts), attempts=3)
    except ProviderError as e:
        raise HTTPException(502, str(e))
    data = await asyncio.to_thread(_preview_mp3, pcm)
    _preview_cache[key] = (time.time(), data)
    return Response(data, media_type="audio/mpeg")


def _preview_mp3(pcm) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        wav, mp3 = Path(tmp) / "p.wav", Path(tmp) / "p.mp3"
        audio.write_wav(wav, audio.trim_silence(pcm))
        audio.encode_mp3(wav, mp3, warm=True, bitrate="96k")
        return mp3.read_bytes()


class JobIn(BaseModel):
    text: str = Field(min_length=1)
    language: str | None = None
    mode: str = "narrator"
    provider: str = "auto"
    voice: str = ""
    voice2: str = ""
    style: str = "warm"
    pace: str = "natural"
    warm_master: bool = True
    title: str = "Podcast"


@app.post("/api/jobs")
async def start_job(body: JobIn, request: Request):
    if len(body.text) > MAX_CHARS:
        raise HTTPException(413, f"Text is longer than {MAX_CHARS:,} characters (MAX_CHARS).")
    if body.mode not in ("narrator", "conversation") or body.pace not in prompts.PACES:
        raise HTTPException(400, "Invalid mode or pace")
    lang = body.language or detect_language(body.text)
    if lang not in ("he", "en"):
        raise HTTPException(400, "Language must be 'he' or 'en'")
    req = JobRequest(text=body.text, language=lang, mode=body.mode, provider=body.provider,
                     voice=body.voice, voice2=body.voice2, style=body.style, pace=body.pace,
                     warm_master=body.warm_master, title=body.title[:120] or "Podcast",
                     keys=_keys(request))
    job = create_job(req)
    return job.public()


def _job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found (it may have expired)")
    return job


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    return _job(job_id).public()


@app.get("/api/jobs/{job_id}/script")
def job_script(job_id: str):
    return {"script": _job(job_id).script or []}


@app.post("/api/jobs/{job_id}/cancel")
def cancel(job_id: str):
    job = _job(job_id)
    job.cancelled = True
    task = getattr(job, "task", None)
    if task and not task.done():
        task.cancel()          # stop in-flight requests and backoff sleeps right away
    return job.public()


def _mp3(job_id: str) -> Path:
    job = _job(job_id)
    path = job.dir / "podcast.mp3"
    if job.status != "done" or not path.exists():
        raise HTTPException(409, "Audio not ready yet")
    return path


@app.get("/api/jobs/{job_id}/audio")
def job_audio(job_id: str):
    return FileResponse(_mp3(job_id), media_type="audio/mpeg")


@app.get("/api/jobs/{job_id}/download")
def job_download(job_id: str):
    job = _job(job_id)
    safe = "".join(c for c in job.request.title if c.isalnum() or c in " -_").strip() or "podcast"
    return FileResponse(_mp3(job_id), media_type="audio/mpeg", filename=f"{safe}.mp3")


@app.get("/healthz")
def health():
    return {"ok": True}
