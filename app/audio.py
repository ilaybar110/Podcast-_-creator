"""PCM utilities, assembly and warm podcast mastering (ffmpeg)."""
from __future__ import annotations

import functools
import json
import re
import shutil
import subprocess
import tempfile
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


TRIM_PRE_SEC = 0.15     # keep the breath before the first word
TRIM_POST_SEC = 0.25    # and the soft ending after the last (common in Hebrew)
FADE_IN_MS = 10.0
FADE_OUT_MS = 30.0


def trim_silence(pcm: np.ndarray, threshold_db: float = -45.0, pre_sec: float = TRIM_PRE_SEC,
                 post_sec: float = TRIM_POST_SEC) -> np.ndarray:
    """Trim leading/trailing silence so the pauses we insert are consistent, keeping a
    pre-roll and a longer tail so soft word endings and breaths are never clipped."""
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
    start = max(0, loud[0] * win - round(SAMPLE_RATE * pre_sec))
    end = min(pcm.size, (loud[-1] + 1) * win + round(SAMPLE_RATE * post_sec))
    return pcm[start:end]


def fade(pcm: np.ndarray, in_ms: float = FADE_IN_MS, out_ms: float = FADE_OUT_MS) -> np.ndarray:
    """Raised-cosine fade in/out so the joins never click."""
    n_in = min(int(SAMPLE_RATE * in_ms / 1000), pcm.size // 2)
    n_out = min(int(SAMPLE_RATE * out_ms / 1000), pcm.size // 2)
    if n_in <= 0 and n_out <= 0:
        return pcm
    out = pcm.astype(np.float32)
    if n_in > 0:
        out[:n_in] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(n_in) / n_in)
    if n_out > 0:
        out[-n_out:] *= (0.5 - 0.5 * np.cos(np.pi * np.arange(n_out) / n_out))[::-1]
    return out.astype(pcm.dtype) if pcm.dtype != np.float32 else out


# ------------------------------------------------------------------ room tone
ROOM_TONE_DB = -65.0


class RoomTone:
    """Very quiet, gentle pink-ish noise so pauses never drop to digital zero.

    A seeded loop (~11 s) shaped in the frequency domain: 1/f power from 100 Hz, rolled off
    above 6 kHz. Built by inverse FFT, so it loops without a seam. RMS is exactly `level_db`."""

    def __init__(self, level_db: float = ROOM_TONE_DB, seed: int = 1234, n: int = 1 << 18):
        rng = np.random.default_rng(seed)
        f = np.fft.rfftfreq(n, 1 / SAMPLE_RATE)
        shape = 1 / np.sqrt(np.maximum(f, 1.0))
        shape *= (f / 100) ** 2 / (1 + (f / 100) ** 2)          # 2nd-order-ish low cut
        shape /= np.sqrt(1 + (f / 6000) ** 4)                     # gentle top roll-off
        spec = shape * (rng.standard_normal(f.size) + 1j * rng.standard_normal(f.size))
        spec[0] = 0
        loop = np.fft.irfft(spec, n)
        self.loop = (loop / np.sqrt((loop ** 2).mean()) * 10 ** (level_db / 20)).astype(np.float32)
        self.pos = 0

    def take(self, n: int) -> np.ndarray:
        idx = (self.pos + np.arange(n)) % self.loop.size
        self.pos = (self.pos + n) % self.loop.size
        return self.loop[idx]


# ------------------------------------------------------------------ loudness
def _biquad_response(b, a, w):
    z = np.exp(-1j * w)
    return (b[0] + b[1] * z + b[2] * z * z) / (a[0] + a[1] * z + a[2] * z * z)


def _k_weight_magnitude(n: int, rate: int = SAMPLE_RATE) -> np.ndarray:
    """|H| of the ITU-R BS.1770 K-weighting (high shelf + RLB high-pass) at rfft bins."""
    w = 2 * np.pi * np.fft.rfftfreq(n, 1 / rate) / rate
    # stage 1: high shelf, +4 dB around 1.7 kHz
    g, q, fc = 3.99984385397, 0.7071752369554193, 1681.9744509555319
    A, w0 = 10 ** (g / 40), 2 * np.pi * fc / rate
    c, sa = np.cos(w0), 2 * np.sqrt(A) * np.sin(w0) / (2 * q)
    b1 = [A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa)]
    a1 = [(A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa]
    # stage 2: high-pass at 38 Hz
    q, fc = 0.5003270373253953, 38.13547087613982
    w0 = 2 * np.pi * fc / rate
    al, c = np.sin(w0) / (2 * q), np.cos(w0)
    b2 = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    a2 = [1 + al, -2 * c, 1 - al]
    return np.abs(_biquad_response(b1, a1, w) * _biquad_response(b2, a2, w))


def block_energies(pcm: np.ndarray, rate: int = SAMPLE_RATE) -> np.ndarray:
    """Mean-square energy of K-weighted, non-overlapping 400 ms blocks (full scale = 1)."""
    x = pcm.astype(np.float64) / (32768.0 if pcm.dtype == np.int16 else 1.0)
    win = int(rate * 0.4)
    nb = x.size // win
    if nb == 0:
        return np.zeros(0)
    y = np.fft.irfft(np.fft.rfft(x) * _k_weight_magnitude(x.size, rate), x.size)
    return (y[: nb * win].reshape(nb, win) ** 2).mean(axis=1)


def gated_loudness(energies: np.ndarray) -> float:
    """EBU R128 gated integrated loudness (LUFS) from block energies; -70 when silent."""
    lufs = lambda e: -0.691 + 10 * np.log10(np.asarray(e) + 1e-12)   # noqa: E731
    e = np.asarray(energies, dtype=np.float64)
    e = e[lufs(e) > -70]
    if e.size == 0:
        return -70.0
    e = e[lufs(e) > lufs(e.mean()) - 10]
    return float(lufs(e.mean()))


def loudness_lufs(pcm: np.ndarray, rate: int = SAMPLE_RATE) -> float:
    return gated_loudness(block_energies(pcm, rate))


PART_MATCH_MAX_DB = 3.0


def match_part_gains(part_lufs: list[float], max_db: float = PART_MATCH_MAX_DB) -> list[float]:
    """Gain (dB) nudging each part toward the episode's median loudness, clamped to +-max_db.
    Parts too short or quiet to measure (<= -70 LUFS) are left alone."""
    ok = [v for v in part_lufs if np.isfinite(v) and v > -70]
    if not ok:
        return [0.0 for _ in part_lufs]
    med = float(np.median(ok))
    return [float(np.clip(med - v, -max_db, max_db)) if np.isfinite(v) and v > -70 else 0.0 for v in part_lufs]


def write_wav(path: Path, pcm: np.ndarray, rate: int = SAMPLE_RATE) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.astype("<i2").tobytes())



# Gentle "radio warm" chain: remove rumble, a touch of low-mid body, tame harsh
# sibilance, soft compression. Loudness is then set with one linear gain measured in a
# first pass (EBU R128, -16 LUFS) and peaks are caught by a look-ahead limiter at -1 dBFS -
# no dynamic loudness riding, so phrases keep their natural rise and fall.
WARM_CHAIN = (
    "highpass=f=70,"
    "equalizer=f=180:t=q:w=1.0:g=1.5,"
    "equalizer=f=3200:t=q:w=1.2:g=-1.0,"
    "deesser=i=0.35,"
    "acompressor=threshold=-20dB:ratio=2.2:attack=15:release=180:makeup=1.5"
)
TARGET_LUFS = -16.0
LIMIT_DB = -1.0
MAX_GAIN_DB = 12.0
LIMITER = f"alimiter=limit={10 ** (LIMIT_DB / 20):.4f}:attack=1.5:release=80:level=disabled:latency=1"
_F32_IN = ["-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "1", "-i", "pipe:0"]


def _as_float(pcm: np.ndarray) -> np.ndarray:
    return pcm.astype(np.float32) / 32768.0 if pcm.dtype == np.int16 else pcm.astype(np.float32)


def _feed(cmd: list[str], chunks) -> str:
    """Run ffmpeg with float PCM chunks on stdin; returns its log (stderr)."""
    with tempfile.TemporaryFile() as log:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=log)
        try:
            for x in chunks:
                proc.stdin.write(np.ascontiguousarray(x, dtype="<f4").tobytes())
            proc.stdin.close()
        except BrokenPipeError:
            pass
        code = proc.wait()
        log.seek(0)
        err = log.read().decode(errors="replace")
    if code != 0:
        raise RuntimeError(f"ffmpeg failed: {err[-500:]}")
    return err


def measure_loudness(make_stream, warm: bool = True) -> float:
    """Pass 1: integrated loudness (LUFS) of the stream after the warm chain."""
    af = (WARM_CHAIN + "," if warm else "") + "ebur128=framelog=quiet"
    err = _feed(["ffmpeg", "-hide_banner", "-nostats", "-loglevel", "info", *_F32_IN, "-af", af, "-f", "null", "-"],
                (_as_float(p) for p in make_stream()))
    found = re.findall(r"I:\s+(-?[\d.]+|-inf) LUFS", err)
    return float(found[-1]) if found and found[-1] != "-inf" else -70.0


@functools.lru_cache(maxsize=1)
def _warm_tone_gain_db() -> float:
    """How much the warm chain lifts the room tone (EQ + compressor make-up), measured once."""
    x = RoomTone(ROOM_TONE_DB).take(int(SAMPLE_RATE * 2.5))
    out = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", *_F32_IN, "-af", WARM_CHAIN,
                          "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "1", "pipe:1"],
                         input=x.astype("<f4").tobytes(), capture_output=True, check=True).stdout
    y = np.frombuffer(out, dtype="<f4")[int(SAMPLE_RATE * 0.5):].astype(np.float64)   # after the filters settle
    rms = lambda a: np.sqrt((a ** 2).mean()) + 1e-12   # noqa: E731
    return float(20 * np.log10(rms(y) / rms(x[int(SAMPLE_RATE * 0.5):].astype(np.float64))))


def master_gain_db(measured_lufs: float, target: float = TARGET_LUFS) -> float:
    return 0.0 if measured_lufs <= -70 else min(MAX_GAIN_DB, target - measured_lufs)


def _mp3_args(mp3_path: Path, bitrate: str, title: str | None) -> list[str]:
    cmd = ["-ar", "44100", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", bitrate]
    if title:
        cmd += ["-metadata", f"title={title}", "-metadata", "genre=Podcast"]
    return cmd + [str(mp3_path)]


def encode_mp3_stream(pcm_source, mp3_path: Path, warm: bool = True, bitrate: str = "128k",
                      title: str | None = None, room_tone_db: float | None = ROOM_TONE_DB) -> float:
    """Two-pass mastering piped straight into the encoder - no WAV size limit, constant memory.

    pcm_source: a list of PCM arrays, or a callable returning a fresh iterator of them (it is
    read twice: measure, then apply). Int16 or float (full scale 1.0) arrays both work.
    Returns the master gain (dB) applied."""
    make = pcm_source if callable(pcm_source) else (lambda: iter(pcm_source))
    gain_db = master_gain_db(measure_loudness(make, warm))
    # Room tone goes in before the chain and the gain, pre-scaled so it lands at room_tone_db.
    tone = None
    if room_tone_db is not None:
        tone = RoomTone(room_tone_db - gain_db - (_warm_tone_gain_db() if warm else 0.0))

    def chunks():
        for p in make():
            x = _as_float(p)
            yield x + tone.take(x.size) if tone is not None else x

    af = (WARM_CHAIN + "," if warm else "") + f"volume={gain_db:.3f}dB," + LIMITER
    _feed(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *_F32_IN, "-af", af,
           *_mp3_args(mp3_path, bitrate, title)], chunks())
    return gain_db


def encode_mp3(wav_path: Path, mp3_path: Path, warm: bool = True, bitrate: str = "128k",
               title: str | None = None) -> None:
    with wave.open(str(wav_path), "rb") as w:
        rate, pcm = w.getframerate(), pcm_from_bytes(w.readframes(w.getnframes()))
    encode_mp3_stream([resample(pcm, rate)], mp3_path, warm, bitrate, title)


def probe_duration(path: Path) -> float:
    """Exact duration of the finished file as players will report it."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        capture_output=True, check=True, text=True,
    ).stdout
    return float(json.loads(out)["format"]["duration"])
