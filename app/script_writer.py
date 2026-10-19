"""Turn any text into a natural two-host podcast conversation (Gemini text model)."""
from __future__ import annotations

import re

from . import prompts
from .providers import ProviderError, Turn, with_retries
from .providers.gemini import GeminiProvider
from .text_utils import chunk_text

SOURCE_PART_CHARS = 6000


def parse_dialogue(raw: str, hosts: tuple[str, str]) -> list[Turn]:
    a, b = hosts
    pattern = re.compile(
        rf"^\W*({re.escape(a)}|{re.escape(b)})\W*\s*[:：\-–]\s*(.+)$", re.I)
    turns: list[Turn] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        m = pattern.match(line)
        if m:
            speaker = a if m.group(1).lower() == a.lower() else b
            text = re.sub(r"[*_#`]", "", m.group(2)).strip()
            # drop stage directions like (laughs) / [music]
            text = re.sub(r"\[[^\]]*\]|\((?:laughs?|צוחק(?:ת)?|music|מוזיקה)[^)]*\)", "", text).strip()
            if text:
                turns.append(Turn(speaker, text))
        elif turns and not re.match(r"^[A-Za-z]{2,20}\s*:", line):
            turns[-1].text += " " + re.sub(r"[*_#`]", "", line)   # wrapped continuation
    return turns


async def write_dialogue(gemini: GeminiProvider, text: str, language: str,
                         hosts: tuple[str, str], on_progress=None,
                         genders: tuple[str, str] = ("female", "male")) -> list[Turn]:
    parts = [" ".join(p) for p in chunk_text(text, SOURCE_PART_CHARS)]
    turns: list[Turn] = []
    for i, part in enumerate(parts, 1):
        tail = "\n".join(f"{t.speaker}: {t.text}" for t in turns[-6:])
        prompt = prompts.podcast_script_prompt(part, language, hosts, i, len(parts), tail, genders)

        async def attempt():
            raw = await gemini.write_text(prompt)
            new = parse_dialogue(raw, hosts)
            if len(new) < 2 or len({t.speaker for t in new}) < 2:
                raise ProviderError("Script writer returned an unusable dialogue", retryable=True)
            return new

        turns += await with_retries(attempt, attempts=4)
        if on_progress:
            on_progress(i, len(parts))
    return turns


def batch_turns(turns: list[Turn], max_chars: int) -> list[list[Turn]]:
    batches: list[list[Turn]] = []
    cur: list[Turn] = []
    size = 0
    for t in turns:
        n = len(t.text) + len(t.speaker) + 3
        if cur and size + n > max_chars:
            batches.append(cur)
            cur, size = [], 0
        cur.append(t)
        size += n
    if cur:
        batches.append(cur)
    return batches
