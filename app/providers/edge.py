"""Microsoft neural voices via edge-tts. Free, no key - the fallback engine.
Clearly better than old concatenative voices like Carmit, but less expressive
than Gemini or ElevenLabs."""
from __future__ import annotations

import asyncio
import os
import re

import numpy as np

from ..audio import decode_to_pcm
from .base import Provider, ProviderError, SynthesisOptions, Voice

_VOICES = {
    "he": [
        Voice("he-IL-HilaNeural", "Hila", "female", "Israeli Hebrew, clear", ["he"], True),
        Voice("he-IL-AvriNeural", "Avri", "male", "Israeli Hebrew, clear", ["he"], True),
    ],
    "en": [
        Voice("en-US-AvaMultilingualNeural", "Ava", "female", "Expressive, caring", ["en"], True),
        Voice("en-US-AndrewMultilingualNeural", "Andrew", "male", "Warm, confident", ["en"], True),
        Voice("en-US-EmmaMultilingualNeural", "Emma", "female", "Cheerful, clear", ["en"], False),
        Voice("en-US-BrianMultilingualNeural", "Brian", "male", "Approachable, casual", ["en"], False),
        Voice("en-GB-SoniaNeural", "Sonia", "female", "British, friendly", ["en"], False),
    ],
}
_RATE = {"relaxed": "-8%", "natural": "-3%", "brisk": "+6%"}


class EdgeProvider(Provider):
    name = "edge"
    label = "Microsoft Neural (free)"
    max_chunk_chars = 2500
    concurrency = 3

    def available(self) -> bool:
        try:
            import edge_tts  # noqa: F401
        except ImportError:
            return False
        return True

    def voices(self, language: str) -> list[Voice]:
        return _VOICES.get(language, [])

    async def synthesize(self, text: str, voice: str, opts: SynthesisOptions) -> np.ndarray:
        import edge_tts

        proxy = os.getenv("HTTPS_PROXY") or os.getenv("https_proxy")
        comm = edge_tts.Communicate(text, voice, rate=_RATE.get(opts.pace, "-3%"), proxy=proxy)
        buf = bytearray()
        try:
            async for item in comm.stream():
                if item["type"] == "audio":
                    buf += item["data"]
        except Exception as e:  # edge-tts raises many network exception types
            msg = re.sub(r"\w+://\S+", "<url>", str(e))   # never echo proxy URLs/credentials
            raise ProviderError(f"Microsoft TTS error: {msg}", retryable=True)
        if not buf:
            raise ProviderError("Microsoft TTS returned no audio", retryable=True)
        return await asyncio.to_thread(decode_to_pcm, bytes(buf), "mp3")
