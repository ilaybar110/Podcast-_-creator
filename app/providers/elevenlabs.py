"""ElevenLabs (premium). Uses Eleven v3 with explicit Hebrew - older multilingual
models produce poor Hebrew. Set ELEVENLABS_API_KEY."""
from __future__ import annotations

import os
import time

import httpx
import numpy as np

from ..audio import pcm_from_bytes
from .base import Provider, ProviderError, SynthesisOptions, Voice

API = "https://api.elevenlabs.io/v1"
_voice_cache: dict[str, tuple[float, list[Voice]]] = {}


class ElevenLabsProvider(Provider):
    name = "elevenlabs"
    label = "ElevenLabs v3 (premium)"
    max_chunk_chars = 2500
    concurrency = 2

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.getenv("ELEVENLABS_API_KEY")
        self.model = os.getenv("ELEVENLABS_MODEL", "eleven_v3")

    def available(self) -> bool:
        return bool(self.api_key)

    def voices(self, language: str) -> list[Voice]:
        cached = _voice_cache.get(self.api_key or "")
        if cached and time.time() - cached[0] < 3600:
            return cached[1]
        try:
            r = httpx.get(f"{API}/voices", headers={"xi-api-key": self.api_key}, timeout=20)
            r.raise_for_status()
        except httpx.HTTPError:
            return []
        out = []
        for v in r.json().get("voices", []):
            labels = v.get("labels") or {}
            desc = ", ".join(x for x in (labels.get("description"), labels.get("accent"),
                                         labels.get("use_case")) if x)
            out.append(Voice(id=v["voice_id"], name=v.get("name", v["voice_id"]),
                             gender=labels.get("gender", "unknown"), description=desc or v.get("category", ""),
                             recommended="warm" in desc.lower()))
        _voice_cache[self.api_key or ""] = (time.time(), out)
        return out

    async def synthesize(self, text: str, voice: str, opts: SynthesisOptions) -> np.ndarray:
        body = {
            "text": text,
            "model_id": self.model,
            "language_code": opts.language,
            # v3 stability presets: 0.0 creative, 0.5 natural, 1.0 robust
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "use_speaker_boost": True},
        }
        async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=20)) as client:
            try:
                r = await client.post(f"{API}/text-to-speech/{voice}",
                                      params={"output_format": "pcm_24000"}, json=body,
                                      headers={"xi-api-key": self.api_key})
            except httpx.TransportError as e:
                raise ProviderError(f"Network error talking to ElevenLabs: {e}", retryable=True)
        if r.status_code != 200:
            raise ProviderError(f"ElevenLabs {r.status_code}: {r.text[:300]}",
                                retryable=r.status_code in (429, 500, 502, 503, 504))
        return pcm_from_bytes(r.content)
