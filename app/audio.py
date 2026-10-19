"""PCM utilities, assembly and warm podcast mastering (ffmpeg)."""
from __future__ import annotations

import json
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 24000  # every provider is normalised to 24 kHz mono s16le


def require_ffmpeg() -> None:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("ffmpeg/ffprobe not found. Install ffmpeg (e.g. `apt install ffmpeg`).")


def pcm_from_bytes(data: bytes) -> np.ndarray:
    if len(data) % 2:
        data = data[:-1]
    return np.frombuffer(data, dtype="<i2").copy()


def resample(pcm: np.ndarray, src_rate: int, dst_rate: int = SAMPLE_RATE) -> np.ndarray:
    if src_rate == dst_rate or pcm.size == 0:
        return pcm
    n_out = int(round(pcm.size * dst_rate / src_rate))
    x_old = np.linspace(0, 1, pcm.size, endpoint=False)
    x_new = np.linspace(0, 1, n_out, endpoint=False)
    return np.interp(x_new, x_old, pcm.astype(np.float32)).astype(np.int16)


def decode_to_pcm(data: bytes, input_format: str | None = None) -> np.ndarray:
    """Decode any compressed audio (mp3, ogg...) to 24 kHz mono PCM via ffmpeg."""
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
    if input_format:
        cmd += ["-f", input_format]
    cmd += ["-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"]
    out = subprocess.run(cmd, input=data, capture_output=True, check=True).stdout
    return pcm_from_bytes(out)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(SAMPLE_RATE * seconds), dtype=np.int16)


def trim_silence(pcm: np.ndarray, threshold_db: float = -45.0, keep_sec: float = 0.06) -> np.ndarray:
    """Trim leading/trailing silence so the pauses we insert are consistent."""
    if pcm.size == 0:
        return pcm
    win = int(SAMPLE_RATE * 0.02)
    n = pcm.size // win
    if n == 0:
        return pcm
    frames = pcm[: n * win].astype(np.float32).reshape(n, win) / 32768.0
    rms_db = 20 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-9)
    loud = np.where(rms_db > threshold_db)[0]
    if loud.size == 0:
        return pcm[:0]
    keep = int(SAMPLE_RATE * keep_sec)
    start = max(0, loud[0] * win - keep)
    end = min(pcm.size, (loud[-1] + 1) * win + keep)
    return pcm[start:end]


def fade(pcm: np.ndarray, ms: float = 8.0) -> np.ndarray:
    """Tiny fade in/out to avoid clicks at the joins."""
    n = min(int(SAMPLE_RATE * ms / 1000), pcm.size // 2)
    if n <= 0:
        return pcm
    out = pcm.astype(np.float32)
    ramp = np.linspace(0.0, 1.0, n)
    out[:n] *= ramp
    out[-n:] *= ramp[::-1]
    return out.astype(np.int16)


def write_wav(path: Path, pcm: np.ndarray, rate: int = SAMPLE_RATE) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.astype("<i2").tobytes())


# Gentle "radio warm" chain: remove rumble, a touch of low-mid body, tame harsh
# sibilance, soft compression, then EBU R128 podcast loudness (-16 LUFS).
WARM_FILTER = (
    "highpass=f=70,"
    "equalizer=f=180:t=q:w=1.0:g=1.5,"
    "equalizer=f=3200:t=q:w=1.2:g=-1.0,"
    "deesser=i=0.35,"
    "acompressor=threshold=-20dB:ratio=2.2:attack=15:release=180:makeup=1.5,"
    "loudnorm=I=-16:TP=-1.5:LRA=11"
)
PLAIN_FILTER = "loudnorm=I=-16:TP=-1.5:LRA=11"


def encode_mp3(wav_path: Path, mp3_path: Path, warm: bool = True, bitrate: str = "128k",
               title: str | None = None) -> None:
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav_path),
        "-af", WARM_FILTER if warm else PLAIN_FILTER,
        "-ar", "44100", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", bitrate,
    ]
    if title:
        cmd += ["-metadata", f"title={title}", "-metadata", "genre=Podcast"]
    cmd.append(str(mp3_path))
    subprocess.run(cmd, check=True, capture_output=True)


def probe_duration(path: Path) -> float:
    """Exact duration of the finished file as players will report it."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        capture_output=True, check=True, text=True,
    ).stdout
    return float(json.loads(out)["format"]["duration"])
