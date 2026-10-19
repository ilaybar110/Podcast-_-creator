"""Turn any text into a natural two-host podcast conversation (Gemini text model)."""
from __future__ import annotations

import re

from . import prompts
from .providers import ProviderError, Turn, with_retries
from .providers.gemini import GeminiProvider
from .text_utils import chunk_text, pack_even

SOURCE_PART_CHARS = 6000


_TAG = re.compile(r"\[([^\]]*)\]")
_STAGE = re.compile(r"\((?:laughs?|צוחק(?:ת)?|music|מוזיקה)[^)]*\)", re.I)


def strip_tags(text: str) -> str:
    """The words only, without [voice cues] (for lengths and word counts)."""
    return re.sub(r"\s{2,}", " ", _TAG.sub("", text)).strip()


def _clean_turn(text: str, allow_tag: bool) -> tuple[str, bool]:
    """Keep at most one whitelisted [tag]; drop other brackets and (stage directions)."""
    kept = False

    def keep(m: re.Match) -> str:
        nonlocal kept
        tag = m.group(1).strip().lower()
        if allow_tag and not kept and tag in prompts.TAGS:
            kept = True
            return f" [{tag}] "
        return " "

    text = _TAG.sub(keep, _STAGE.sub(" ", text))
    text = re.sub(r"\s+([,.!?…])", r"\1", re.sub(r"\s{2,}", " ", text)).strip()
    return (text if strip_tags(text) else ""), kept


def parse_dialogue(raw: str, hosts: tuple[str, str]) -> list[Turn]:
    a, b = hosts
    pattern = re.compile(
        rf"^\W*({re.escape(a)}|{re.escape(b)})\W*\s*[:：\-–]\s*(.+)$", re.I)
    turns: list[Turn] = []
    last_tag = -prompts.TAG_EVERY
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        m = pattern.match(line)
        if m:
            speaker = a if m.group(1).lower() == a.lower() else b
            text, tagged = _clean_turn(re.sub(r"[*_#`]", "", m.group(2)),
                                       len(turns) - last_tag >= prompts.TAG_EVERY)
            if text:
                if tagged:
                    last_tag = len(turns)
                turns.append(Turn(speaker, text))
        elif turns and not re.match(r"^[A-Za-z]{2,20}\s*:", line):
            text, _ = _clean_turn(re.sub(r"[*_#`]", "", line), False)   # wrapped continuation
            if text:
                turns[-1].text += " " + text
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


LONG_TURN = 60           # a statement this long is a good place to end a batch
SHORT_TURN = 25          # a reaction this short belongs with the line before it


def _size(t: Turn) -> int:
    return len(t.text) + len(t.speaker) + 3


def _good_end(t: Turn) -> bool:
    words = strip_tags(t.text)
    return len(words) > LONG_TURN and re.search(r"\.[\"'”’״)]*$", words) is not None


def _bad_split(before: Turn, after: Turn) -> bool:
    """Splitting between these would cut a question from its answer or a reaction from its cue."""
    return strip_tags(before.text).rstrip("\"'”’״) ").endswith("?") or len(strip_tags(after.text)) < SHORT_TURN


def batch_turns(turns: list[Turn], max_chars: int) -> list[list[Turn]]:
    """Group turns into TTS requests, packed evenly (see pack_even): the fewest requests that fit
    max_chars (with 10% slack), each about the same size. A batch ends after a long statement where
    possible, and avoids ending on a question or just before a short reaction (a heavy penalty, so it
    only happens when nothing else keeps the batches under the limit)."""
    sizes = [_size(t) for t in turns]
    pens = [12 if _bad_split(turns[i], turns[i + 1]) else 0 if _good_end(turns[i]) else 1
            for i in range(len(turns) - 1)]
    return [turns[i:j] for i, j in pack_even(sizes, pens, max_chars)]
