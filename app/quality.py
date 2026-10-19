"""Objective checks used to catch robotic or broken speech.

A flat, robotic TTS voice ("Carmit"-style) has very little pitch movement and
uniform pacing. Natural, warm speech moves its pitch a lot (typically 2.5-5
semitones standard deviation) and has varied pauses. These metrics let the app
and the self-check tool detect bad takes without a human listening.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from .audio import SAMPLE_RATE


@dataclass
class SpeechMetrics:
    duration_sec: float
    voiced_ratio: float
    pitch_median_hz: float
    pitch_std_semitones: float      # intonation liveliness; < 1.5 sounds robotic
    pitch_range_semitones: float    # 5th-95th percentile span
    pause_count: int
    pause_std_sec: float            # varied pauses read as human
    longest_pause_sec: float
    loudness_std_db: float          # dynamics across phrases

    def to_dict(self) -> dict:
        return {k: round(v, 3) if isinstance(v, float) else v for k, v in asdict(self).items()}


def _frame(x: np.ndarray, win: int, hop: int) -> np.ndarray:
    n = 1 + max(0, (x.size - win) // hop)
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    return x[idx]


def estimate_pitch(pcm: np.ndarray, sr: int = SAMPLE_RATE, fmin: float = 70, fmax: float = 400):
    """Normalised-autocorrelation pitch tracker. Returns f0 per 10 ms frame (0 = unvoiced)."""
    x = pcm.astype(np.float32) / 32768.0
    win, hop = int(sr * 0.04), int(sr * 0.01)
    if x.size < win:
        return np.zeros(0), np.zeros(0)
    frames = _frame(x, win, hop)
    frames = frames - frames.mean(axis=1, keepdims=True)
    energy = (frames ** 2).sum(axis=1)
    energy_db = 10 * np.log10(energy / win + 1e-12)
    loud_floor = np.percentile(energy_db, 90) - 30
    lag_min, lag_max = int(sr / fmax), int(sr / fmin)
    nfft = 1 << (2 * win - 1).bit_length()
    spec = np.fft.rfft(frames, nfft, axis=1)
    ac = np.fft.irfft(np.abs(spec) ** 2, nfft, axis=1)[:, : lag_max + 1]
    ac = ac / (ac[:, :1] + 1e-12)
    seg = ac[:, lag_min: lag_max + 1]
    best = seg.argmax(axis=1)
    peak = seg[np.arange(seg.shape[0]), best]
    f0 = sr / (best + lag_min)
    voiced = (peak > 0.45) & (energy_db > loud_floor)
    return np.where(voiced, f0, 0.0), energy_db


def analyze(pcm: np.ndarray, sr: int = SAMPLE_RATE) -> SpeechMetrics:
    duration = pcm.size / sr
    f0, energy_db = estimate_pitch(pcm, sr)
    if f0.size == 0:
        return SpeechMetrics(duration, 0, 0, 0, 0, 0, 0, 0, 0)
    voiced = f0[f0 > 0]
    if voiced.size > 10:
        median = float(np.median(voiced))
        # drop octave errors before measuring spread
        voiced = voiced[(voiced > median / 1.8) & (voiced < median * 1.8)]
        st = 12 * np.log2(voiced / median)
        pitch_std = float(st.std())
        pitch_range = float(np.percentile(st, 95) - np.percentile(st, 5))
    else:
        median = pitch_std = pitch_range = 0.0

    # pauses: runs of >= 150 ms below the speech floor
    floor = np.percentile(energy_db, 90) - 30
    silent = energy_db < floor
    pauses, run = [], 0
    for s in silent:
        if s:
            run += 1
        else:
            if run >= 15:
                pauses.append(run * 0.01)
            run = 0
    speech_db = energy_db[~silent]
    return SpeechMetrics(
        duration_sec=duration,
        voiced_ratio=float((f0 > 0).mean()),
        pitch_median_hz=median,
        pitch_std_semitones=pitch_std,
        pitch_range_semitones=pitch_range,
        pause_count=len(pauses),
        pause_std_sec=float(np.std(pauses)) if pauses else 0.0,
        longest_pause_sec=max(pauses) if pauses else 0.0,
        loudness_std_db=float(speech_db.std()) if speech_db.size else 0.0,
    )


def humanness_score(m: SpeechMetrics) -> float:
    """0-100 heuristic from intonation movement and pause variety."""
    def band(v, lo, hi):  # 0 below lo, 1 at/above hi
        return float(np.clip((v - lo) / (hi - lo), 0, 1))
    score = (
        45 * band(m.pitch_std_semitones, 1.2, 3.0)
        + 25 * band(m.pitch_range_semitones, 4.0, 10.0)
        + 15 * band(m.pause_std_sec, 0.03, 0.25)
        + 15 * band(m.loudness_std_db, 3.0, 7.0)
    )
    return round(score, 1)


def take_problems(pcm: np.ndarray, text: str, language: str) -> list[str]:
    """Reasons to reject a synthesized chunk and ask the engine for another take."""
    from .text_utils import CHARS_PER_SECOND

    problems = []
    duration = pcm.size / SAMPLE_RATE
    expected = len(text) / CHARS_PER_SECOND.get(language, 14.0)
    if duration < 0.4 * expected:
        problems.append(f"too short ({duration:.1f}s for ~{expected:.0f}s of text) - likely truncated")
    if expected > 3 and duration > 2.6 * expected:
        problems.append(f"too long ({duration:.1f}s for ~{expected:.0f}s of text) - likely rambling/hallucination")
    if duration > 8:
        m = analyze(pcm)
        if m.longest_pause_sec > 4.0:
            problems.append(f"dead air of {m.longest_pause_sec:.1f}s")
    return problems
