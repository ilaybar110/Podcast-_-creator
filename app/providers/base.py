from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass, field

import numpy as np


class ProviderError(RuntimeError):
    def __init__(self, message: str, retryable: bool = False, retry_after: float | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.retry_after = retry_after


@dataclass
class Voice:
    id: str
    name: str
    gender: str                     # "female" | "male"
    description: str
    languages: list[str] = field(default_factory=lambda: ["he", "en"])
    recommended: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Turn:
    speaker: str   # host label, e.g. "Noa"
    text: str


@dataclass
class SynthesisOptions:
    language: str           # "he" | "en"
    style: str = "warm"     # key into prompts.STYLES
    pace: str = "natural"   # relaxed | natural | brisk
    host_names: tuple[str, str] = ("Noa", "Yoni")
    genders: tuple[str, str] = ("female", "male")   # of host_names / the chosen voices


class Provider:
    name: str = "base"
    label: str = "base"
    max_chunk_chars: int = 1600
    concurrency: int = 2
    supports_dialogue: bool = False   # can voice two hosts in one request

    def available(self) -> bool:
        raise NotImplementedError

    def voices(self, language: str) -> list[Voice]:
        raise NotImplementedError

    async def synthesize(self, text: str, voice: str, opts: SynthesisOptions) -> np.ndarray:
        """Return 24 kHz mono int16 PCM."""
        raise NotImplementedError

    async def synthesize_dialogue(self, turns: list[Turn], voices: dict[str, str],
                                  opts: SynthesisOptions) -> np.ndarray:
        raise NotImplementedError


async def with_retries(fn, attempts: int = 6, base: float = 4.0):
    """Retry retryable provider errors with backoff, honouring server retry hints."""
    for i in range(attempts):
        try:
            return await fn()
        except ProviderError as e:
            if not e.retryable or i == attempts - 1:
                raise
            await asyncio.sleep(min(90.0, e.retry_after or base * (2 ** i)))
