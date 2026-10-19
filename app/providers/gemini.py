"""Google Gemini TTS - the warmest, most human Hebrew of the engines we support.

Gemini TTS is a "directable" speech model: on top of the voice it follows
director's notes (accent, emotion, pacing), and it can voice a two-host
conversation in a single request. Free API key: https://aistudio.google.com/apikey
"""
from __future__ import annotations

import base64
import os
import re
import time

import httpx
import numpy as np

from .. import budget, prompts
from ..audio import pcm_from_bytes, resample
from .base import Provider, ProviderError, SynthesisOptions, Turn, Voice

API = "https://generativelanguage.googleapis.com/v1beta"

# Newest first. The first one the key has access to is used (override: GEMINI_TTS_MODEL).
TTS_MODEL_PREFERENCE = [
    "gemini-3.1-flash-tts-preview",
    "gemini-3.1-flash-tts",
    "gemini-2.5-pro-tts",
    "gemini-2.5-pro-preview-tts",
    "gemini-2.5-flash-tts",
    "gemini-2.5-flash-preview-tts",
]
TEXT_MODEL_PREFERENCE = [
    "gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-2.5-pro",
    "gemini-3.1-flash-preview", "gemini-3-flash-preview", "gemini-2.5-flash",
]

# The 30 prebuilt Gemini voices, with Google's own one-word character labels.
# `recommended` marks the ones that sound warmest for podcasts; the self-check
# tool (tools/voice_selfcheck.py) re-ranks them for Hebrew on your key.
_VOICES = [
    ("Sulafat", "female", "Warm", True), ("Achird", "male", "Friendly", True),
    ("Vindemiatrix", "female", "Gentle", True), ("Algieba", "male", "Smooth", True),
    ("Gacrux", "female", "Mature", True), ("Umbriel", "male", "Easy-going", True),
    ("Aoede", "female", "Breezy", True), ("Sadaltager", "male", "Knowledgeable", True),
    ("Despina", "female", "Smooth", False), ("Callirrhoe", "female", "Easy-going", False),
    ("Achernar", "female", "Soft", False), ("Charon", "male", "Informative", False),
    ("Zubenelgenubi", "male", "Casual", False), ("Sadachbia", "male", "Lively", False),
    ("Enceladus", "male", "Breathy", False), ("Iapetus", "male", "Clear", False),
    ("Kore", "female", "Firm", False), ("Leda", "female", "Youthful", False),
    ("Zephyr", "female", "Bright", False), ("Autonoe", "female", "Bright", False),
    ("Erinome", "female", "Clear", False), ("Laomedeia", "female", "Upbeat", False),
    ("Pulcherrima", "female", "Forward", False), ("Puck", "male", "Upbeat", False),
    ("Fenrir", "male", "Excitable", False), ("Orus", "male", "Firm", False),
    ("Algenib", "male", "Gravelly", False), ("Rasalgethi", "male", "Informative", False),
    ("Alnilam", "male", "Firm", False), ("Schedar", "male", "Even", False),
]

BLOCK_REASONS = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "OTHER_BLOCK"}

_model_cache: dict[str, tuple[float, list[str]]] = {}


def _parse_retry_delay(body: dict) -> float | None:
    for d in body.get("error", {}).get("details", []) or []:
        delay = d.get("retryDelay")
        if delay:
            m = re.match(r"([\d.]+)s", delay)
            if m:
                return float(m.group(1))
    return None


class GeminiProvider(Provider):
    name = "gemini"
    label = "Google Gemini (most natural)"
    max_chunk_chars = 1500
    supports_dialogue = True

    def __init__(self, api_key: str | None = None, free_only: bool = False,
                 limit_overrides: dict | None = None):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        self.concurrency = int(os.getenv("GEMINI_CONCURRENCY", "2"))
        self.timeout = httpx.Timeout(300.0, connect=20.0)
        self.free_only = free_only
        # Every request goes through the gate: it counts usage, and in free-only mode it also
        # paces under the per-minute limits and refuses to pass a free daily limit.
        self.gate = budget.Gate(self.api_key, free_only, limit_overrides)
        if free_only:
            self.max_chunk_chars = budget.FREE_CHUNK_CHARS   # fewer, longer requests

    def available(self) -> bool:
        return bool(self.api_key)

    def voices(self, language: str) -> list[Voice]:
        return [Voice(id=n, name=n, gender=g, description=d, recommended=r) for n, g, d, r in _VOICES]

    # ---------------------------------------------------------------- models
    async def _models(self) -> list[str]:
        cached = _model_cache.get(self.api_key or "")
        if cached and time.time() - cached[0] < 3600:
            return cached[1]
        names: list[str] = []
        async with httpx.AsyncClient(timeout=30) as client:
            token = None
            for _ in range(10):
                params = {"pageSize": 1000, **({"pageToken": token} if token else {})}
                try:
                    r = await client.get(f"{API}/models", params=params,
                                         headers={"x-goog-api-key": self.api_key})
                except httpx.TransportError as e:
                    raise ProviderError(f"Network error talking to Gemini: {e}", retryable=True)
                if r.status_code in (400, 401, 403):
                    raise ProviderError("Gemini rejected the API key. Check GEMINI_API_KEY.")
                if r.status_code != 200:
                    raise ProviderError(f"Gemini {r.status_code} while listing models",
                                        retryable=r.status_code in (429, 500, 502, 503, 504))
                data = r.json()
                names += [m["name"].split("/", 1)[1] for m in data.get("models", [])
                          if "generateContent" in m.get("supportedGenerationMethods", [])]
                token = data.get("nextPageToken")
                if not token:
                    break
        _model_cache[self.api_key or ""] = (time.time(), names)
        return names

    def _free_models(self, names: list[str]) -> list[str]:
        # Pro models have no free tier: in free-only mode never pick one.
        return [n for n in names if "pro" not in n] if self.free_only else names

    async def tts_model(self) -> str:
        if os.getenv("GEMINI_TTS_MODEL"):
            return os.environ["GEMINI_TTS_MODEL"]
        names = self._free_models(await self._models())
        for pref in TTS_MODEL_PREFERENCE:
            if pref in names:
                return pref
        tts = sorted((n for n in names if "tts" in n), reverse=True)
        if not tts:
            raise ProviderError("This Gemini API key has no access to a TTS model.")
        return tts[0]

    async def text_model(self) -> str:
        if os.getenv("GEMINI_SCRIPT_MODEL"):
            return os.environ["GEMINI_SCRIPT_MODEL"]
        names = self._free_models(await self._models())
        for pref in TEXT_MODEL_PREFERENCE:
            if pref in names:
                return pref
        cands = [n for n in names if n.startswith("gemini") and not re.search(
            r"tts|image|embedding|live|audio|vision|thinking-exp", n)]
        if not cands:
            raise ProviderError("No Gemini text model available for writing the podcast script.")
        return sorted(cands, reverse=True)[0]

    # ------------------------------------------------------------------ http
    async def _generate(self, model: str, body: dict) -> dict:
        bucket = "gemini_tts" if "tts" in model else "gemini_text"
        prompt = "".join(p.get("text", "") for c in body.get("contents", []) for p in c.get("parts", []))
        await self.gate.acquire(bucket, budget.estimate_tokens(prompt))
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                r = await client.post(f"{API}/models/{model}:generateContent", json=body,
                                      headers={"x-goog-api-key": self.api_key})
            except httpx.TransportError as e:
                raise ProviderError(f"Network error talking to Gemini: {e}", retryable=True)
        if r.status_code == 200:
            return r.json()
        try:
            err = r.json()
        except ValueError:
            err = {}
        if r.status_code == 429:
            quota = self.gate.quota_error(bucket, err)
            if quota:
                raise quota
        msg = err.get("error", {}).get("message") or r.text[:300]
        retryable = r.status_code in (429, 500, 502, 503, 504)
        raise ProviderError(f"Gemini {r.status_code}: {msg}", retryable=retryable,
                            retry_after=_parse_retry_delay(err))

    async def _speak(self, prompt: str, speech_config: dict) -> np.ndarray:
        model = await self.tts_model()
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": speech_config,
                                 "temperature": 1.0},
        }
        data = await self._generate(model, body)
        chunks, rate = [], 24000
        for cand in data.get("candidates", [])[:1]:
            for part in cand.get("content", {}).get("parts", []):
                inline = part.get("inlineData") or part.get("inline_data")
                if inline and inline.get("data"):
                    m = re.search(r"rate=(\d+)", inline.get("mimeType", ""))
                    rate = int(m.group(1)) if m else 24000
                    chunks.append(base64.b64decode(inline["data"]))
        if not chunks:
            reason = (data.get("candidates") or [{}])[0].get("finishReason") \
                or data.get("promptFeedback", {}).get("blockReason", "no audio")
            blocked = reason in BLOCK_REASONS
            raise ProviderError(
                "Gemini refused to voice this passage (content filter)" if blocked
                else f"Gemini returned no audio ({reason})", retryable=not blocked)
        return resample(pcm_from_bytes(b"".join(chunks)), rate)

    # -------------------------------------------------------------- public
    async def _speak_lang(self, prompt: str, cfg: dict, language: str) -> np.ndarray:
        if language == "he":
            cfg["languageCode"] = "he-IL"
        try:
            return await self._speak(prompt, cfg)
        except ProviderError as e:
            if "languageCode" in cfg and "language" in str(e).lower() and not e.retryable:
                cfg.pop("languageCode")   # older models reject the field; auto-detect instead
                return await self._speak(prompt, cfg)
            raise

    async def synthesize(self, text: str, voice: str, opts: SynthesisOptions) -> np.ndarray:
        gender = next((g for n, g, _, _ in _VOICES if n == voice), opts.genders[0])
        persona = opts.host_names[0] if gender == opts.genders[0] else opts.host_names[1]
        prompt = prompts.narrator_prompt(text, opts.language, opts.style, opts.pace,
                                         f"{persona}, a warm podcast host", gender)
        cfg = {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}
        return await self._speak_lang(prompt, cfg, opts.language)

    async def synthesize_dialogue(self, turns: list[Turn], voices: dict[str, str],
                                  opts: SynthesisOptions) -> np.ndarray:
        transcript = "\n".join(f"{t.speaker}: {t.text}" for t in turns)
        prompt = prompts.dialogue_prompt(transcript, opts.language, opts.style, opts.pace,
                                         opts.host_names, opts.genders)
        cfg = {"multiSpeakerVoiceConfig": {"speakerVoiceConfigs": [
            {"speaker": spk, "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": v}}}
            for spk, v in voices.items()
        ]}}
        return await self._speak_lang(prompt, cfg, opts.language)

    async def write_text(self, prompt: str, temperature: float = 0.9) -> str:
        model = await self.text_model()
        body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": temperature}}
        data = await self._generate(model, body)
        parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        if not text.strip():
            raise ProviderError("Gemini returned an empty script", retryable=True)
        return text

    async def listen(self, wav_bytes: bytes, prompt: str) -> str:
        """Audio understanding - used by the self-check 'native listener' judge."""
        model = await self.text_model()
        body = {"contents": [{"role": "user", "parts": [
            {"inlineData": {"mimeType": "audio/wav", "data": base64.b64encode(wav_bytes).decode()}},
            {"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"}}
        data = await self._generate(model, body)
        parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts if not p.get("thought"))

