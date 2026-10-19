from __future__ import annotations

from .base import Provider, ProviderError, SynthesisOptions, Turn, Voice, with_retries
from .edge import EdgeProvider
from .elevenlabs import ElevenLabsProvider
from .gemini import GeminiProvider

# Order = default preference: the most human-sounding available engine wins.
PROVIDER_CLASSES = {"gemini": GeminiProvider, "elevenlabs": ElevenLabsProvider, "edge": EdgeProvider}


def get_provider(name: str | None, keys: dict[str, str] | None = None) -> Provider:
    keys = keys or {}
    if name and name != "auto":
        cls = PROVIDER_CLASSES.get(name)
        if not cls:
            raise ProviderError(f"Unknown engine '{name}'")
        p = cls(keys.get(name)) if name != "edge" else cls()
        if not p.available():
            raise ProviderError(f"Engine '{name}' is not configured (missing API key).")
        return p
    for n, cls in PROVIDER_CLASSES.items():
        p = cls(keys.get(n)) if n != "edge" else cls()
        if p.available():
            return p
    raise ProviderError("No TTS engine available. Set GEMINI_API_KEY or install edge-tts.")


__all__ = ["Provider", "ProviderError", "SynthesisOptions", "Turn", "Voice", "with_retries",
           "get_provider", "PROVIDER_CLASSES", "GeminiProvider", "ElevenLabsProvider", "EdgeProvider"]
