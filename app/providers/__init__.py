from __future__ import annotations

from .base import Provider, ProviderError, SynthesisOptions, Turn, Voice, with_retries
from .edge import EdgeProvider
from .elevenlabs import ElevenLabsProvider
from .gemini import GeminiProvider

# Order = default preference: the most human-sounding available engine wins.
PROVIDER_CLASSES = {"gemini": GeminiProvider, "elevenlabs": ElevenLabsProvider, "edge": EdgeProvider}


def make_provider(name: str, keys: dict[str, str], free_only: bool = False,
                  overrides: dict | None = None) -> Provider:
    cls = PROVIDER_CLASSES[name]
    if cls is GeminiProvider:
        return cls(keys.get(name), free_only=free_only, limit_overrides=overrides)
    return cls() if name == "edge" else cls(keys.get(name))


def get_provider(name: str | None, keys: dict[str, str] | None = None, free_only: bool = False,
                 overrides: dict | None = None) -> Provider:
    keys = keys or {}
    if name and name != "auto":
        if name not in PROVIDER_CLASSES:
            raise ProviderError(f"Unknown engine '{name}'")
        p = make_provider(name, keys, free_only, overrides)
        if not p.available():
            raise ProviderError(f"Engine '{name}' is not configured (missing API key).")
        return p
    for n in PROVIDER_CLASSES:
        p = make_provider(n, keys, free_only, overrides)
        if p.available():
            return p
    raise ProviderError("No TTS engine available. Set GEMINI_API_KEY or install edge-tts.")


__all__ = ["Provider", "ProviderError", "SynthesisOptions", "Turn", "Voice", "with_retries",
           "get_provider", "make_provider", "PROVIDER_CLASSES", "GeminiProvider", "ElevenLabsProvider", "EdgeProvider"]
