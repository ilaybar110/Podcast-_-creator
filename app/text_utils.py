"""Text cleanup, language detection, chunking and duration estimates."""
from __future__ import annotations

import re

HEBREW_RE = re.compile(r"[֐-׿]")
LATIN_RE = re.compile(r"[A-Za-z]")
NIQQUD_RE = re.compile(r"[֑-ׇ]")

# Speaking rates measured on natural podcast-style delivery (characters per second,
# spaces included). Hebrew words are shorter, so chars/sec is a little lower.
CHARS_PER_SECOND = {"he": 12.5, "en": 14.5}
PARAGRAPH_PAUSE_SEC = 0.75


def detect_language(text: str) -> str:
    he = len(HEBREW_RE.findall(text))
    en = len(LATIN_RE.findall(text))
    return "he" if he >= en * 0.5 and he > 0 else "en"


def clean_text(text: str) -> str:
    """Remove things a human narrator would never read aloud."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace(" ", " ")
    # Markdown links [label](url) -> label, bare URLs dropped.
    text = re.sub(r"\[([^\]]+)\]\((?:https?://)?[^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+|www\.\S+", "", text)
    # Markdown markup: headings, emphasis, code fences, bullets, tables.
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.M)
    text = re.sub(r"(\*\*|__|\*|`|~~)", "", text)
    text = re.sub(r"^\s*[-*•●▪]\s+", "", text, flags=re.M)
    text = re.sub(r"^\s*\|.*\|\s*$", lambda m: m.group(0).replace("|", ", ").strip(", "), text, flags=re.M)
    # Emoji and pictographs.
    text = re.sub("[\U0001F000-\U0001FAFF☀-➿️‍]", "", text)
    # Repeated punctuation / whitespace.
    text = re.sub(r"([!?.])\1{2,}", r"\1", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def paragraphs(text: str) -> list[str]:
    # A single newline in pasted text is usually a hard wrap, not a new paragraph,
    # unless the line looks like a heading (short, no final punctuation).
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    out: list[str] = []
    for block in blocks:
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        current = ""
        for ln in lines:
            is_heading = len(ln) < 60 and not re.search(r"[.!?:,;״\"']$", ln)
            if is_heading:
                if current:
                    out.append(current)
                out.append(ln if re.search(r"[.!?]$", ln) else ln + ".")
                current = ""
            else:
                current = f"{current} {ln}".strip()
        if current:
            out.append(current)
    return out


_SENTENCE_RE = re.compile(r"(?<=[.!?…])[\"'״”)]*\s+")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_RE.split(text) if s.strip()]


def _split_long(sentence: str, max_chars: int) -> list[str]:
    """Split a monster sentence at commas/semicolons, then at spaces."""
    if len(sentence) <= max_chars:
        return [sentence]
    parts, cur = [], ""
    for piece in re.split(r"(?<=[,;:–—])\s+", sentence):
        if len(piece) > max_chars:
            words, piece_cur = piece.split(" "), ""
            for w in words:
                if len(piece_cur) + len(w) + 1 > max_chars and piece_cur:
                    parts.append(piece_cur)
                    piece_cur = w
                else:
                    piece_cur = f"{piece_cur} {w}".strip()
            piece = piece_cur
        if len(cur) + len(piece) + 1 > max_chars and cur:
            parts.append(cur)
            cur = piece
        else:
            cur = f"{cur} {piece}".strip()
    if cur:
        parts.append(cur)
    return parts


def chunk_text(text: str, max_chars: int = 1600) -> list[list[str]]:
    """Group paragraphs into chunks of at most max_chars.

    Returns a list of chunks; each chunk is a list of paragraphs so the audio
    stage can place natural pauses between them. Never splits mid-sentence
    unless one sentence alone is longer than max_chars.
    """
    chunks: list[list[str]] = []
    cur: list[str] = []
    cur_len = 0

    def flush():
        nonlocal cur, cur_len
        if cur:
            chunks.append(cur)
        cur, cur_len = [], 0

    for para in paragraphs(text):
        if len(para) > max_chars:
            flush()
            piece = ""
            for sent in split_sentences(para):
                for s in _split_long(sent, max_chars):
                    if len(piece) + len(s) + 1 > max_chars and piece:
                        chunks.append([piece])
                        piece = s
                    else:
                        piece = f"{piece} {s}".strip()
            if piece:
                cur, cur_len = [piece], len(piece)
            continue
        if cur_len + len(para) + 1 > max_chars:
            flush()
        cur.append(para)
        cur_len += len(para) + 1
    flush()
    return chunks


def estimate_seconds(text: str, language: str, speed: float = 1.0) -> float:
    text = clean_text(text)
    if not text:
        return 0.0
    n_paras = len(paragraphs(text))
    speech = len(text) / CHARS_PER_SECOND.get(language, 14.0)
    return speech / max(speed, 0.5) + n_paras * PARAGRAPH_PAUSE_SEC


def format_duration(seconds: float) -> str:
    seconds = int(seconds + 0.05)   # floor like audio players do, so the numbers match
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
