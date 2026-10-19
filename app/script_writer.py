"""Turn any text into a natural two-host podcast conversation (Gemini text model)."""
from __future__ import annotations

import re

from . import prompts
from .providers import ProviderError, Turn, with_retries
from .providers.gemini import GeminiProvider
from .text_utils import chunk_text

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


SOFT_FULL = 0.8          # a batch this full ends at the next good boundary
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
    """Group turns into TTS requests of at most max_chars, split where the conversation breathes:
    once a batch is ~80% full it ends after a long statement; it never ends on a question or just
    before a short reaction, unless only that keeps it under max_chars."""
    batches: list[list[Turn]] = []
    cur: list[Turn] = []
    size = 0
    for t in turns:
        n = _size(t)
        if cur and size + n > max_chars:
            cut = len(cur)
            if _bad_split(cur[-1], t):      # look back for a better place that still fits
                tail = n
                for j in range(len(cur) - 1, 0, -1):
                    tail += _size(cur[j])
                    if tail > max_chars or size - tail + n < SOFT_FULL / 2 * max_chars:
                        break
                    if not _bad_split(cur[j - 1], cur[j]):
                        cut = j
                        break
            batches.append(cur[:cut])
            cur = cur[cut:]
            size = sum(_size(x) for x in cur)
        elif cur and size >= SOFT_FULL * max_chars and _good_end(cur[-1]) and not _bad_split(cur[-1], t):
            batches.append(cur)
            cur, size = [], 0
        cur.append(t)
        size += n
    if cur:
        batches.append(cur)
    return batches
