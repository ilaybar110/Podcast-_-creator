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
    text = re.sub(r"^[ \t]{0,3}#{1,6}[ \t]*", "", text, flags=re.M)
    text = re.sub(r"(\*\*|__|\*|`|~~)", "", text)
    text = re.sub(r"^[ \t]*[-*•●▪][ \t]+", "", text, flags=re.M)
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
    return [p for p, _ in _paragraph_blocks(text)]


def _paragraph_blocks(text: str) -> list[tuple[str, bool]]:
    """Paragraphs, each with a flag for lines that look like headings."""
    # A single newline in pasted text is usually a hard wrap, not a new paragraph,
    # unless the line looks like a heading (short, no final punctuation).
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    out: list[tuple[str, bool]] = []
    for block in blocks:
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        current = ""
        for ln in lines:
            is_heading = len(ln) < 40 and not re.search(r"[.!?:,;…״׳\"'”)\]]$", ln)
            if is_heading:
                if current:
                    out.append((current, False))
                out.append((ln if re.search(r"[.!?]$", ln) else ln + ".", True))
                current = ""
            else:
                current = f"{current} {ln}".strip()
        if current:
            out.append((current, False))
    return out


_CLOSE = "\"'״”)\\]"
# split on whitespace after sentence-final punctuation, keeping closing quotes/brackets attached
_SENTENCE_RE = re.compile(rf"(?:(?<=[.!?…])|(?<=[.!?…][{_CLOSE}])|(?<=[.!?…][{_CLOSE}][{_CLOSE}]))\s+")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_RE.split(text) if s.strip()]


def _split_long(sentence: str, max_chars: int) -> list[str]:
    """Split a monster sentence at commas/semicolons, then at spaces, then hard."""
    if len(sentence) <= max_chars:
        return [sentence]
    parts: list[str] = []
    cur = ""

    def add(piece: str):
        nonlocal cur
        if len(cur) + len(piece) + 1 > max_chars and cur:
            parts.append(cur)
            cur = piece
        else:
            cur = f"{cur} {piece}".strip()

    for piece in re.split(r"(?<=[,;:–—])\s+", sentence):
        if len(piece) <= max_chars:
            add(piece)
            continue
        for word in piece.split(" "):
            while len(word) > max_chars:          # a "word" with no spaces at all
                add(word[:max_chars])
                word = word[max_chars:]
            add(word)
    if cur:
        parts.append(cur)
    return parts


def chunk_text(text: str, max_chars: int = 1600) -> list[list[str]]:
    """Group paragraphs into chunks of at most max_chars.

    Returns a list of chunks; each chunk is a list of paragraphs so the audio
    stage can place natural pauses between them. Never splits mid-sentence
    unless one sentence alone is longer than max_chars.
    """
    return chunk_text_with_breaks(text, max_chars)[0]


# Silence placed between two recorded chunks, by what separates them in the text.
BREAK_PAUSE_SEC = {"sentence": 0.35, "paragraph": 0.7, "section": 1.1}


def chunk_text_with_breaks(text: str, max_chars: int = 1600) -> tuple[list[list[str]], list[str]]:
    """The chunks of chunk_text plus breaks[i]: what separates chunk i from chunk i+1 -
    "sentence" (inside a long paragraph), "paragraph", or "section" (chunk i+1 opens with
    a heading). len(breaks) == len(chunks) - 1."""
    chunks: list[list[str]] = []
    starts: list[str] = []          # what kind of boundary each chunk begins at
    cur: list[str] = []
    cur_len = 0
    cur_start = "paragraph"

    def flush():
        nonlocal cur, cur_len
        if cur:
            chunks.append(cur)
            starts.append(cur_start)
        cur, cur_len = [], 0

    for para, heading in _paragraph_blocks(text):
        kind = "section" if heading else "paragraph"
        if len(para) > max_chars:
            flush()
            piece, piece_start = "", kind
            for sent in split_sentences(para):
                for s in _split_long(sent, max_chars):
                    if len(piece) + len(s) + 1 > max_chars and piece:
                        chunks.append([piece])
                        starts.append(piece_start)
                        piece, piece_start = s, "sentence"
                    else:
                        piece = f"{piece} {s}".strip()
            if piece:
                cur, cur_len, cur_start = [piece], len(piece), piece_start
            continue
        if cur_len + len(para) + 1 > max_chars:
            flush()
        if not cur:
            cur_start = kind
        cur.append(para)
        cur_len += len(para) + 1
    flush()
    return chunks, starts[1:]


def break_pauses(breaks: list[str], end_sec: float = 0.0) -> list[float]:
    """Pause (seconds) after each chunk: the break kind's pause, and end_sec after the last."""
    return [BREAK_PAUSE_SEC.get(b, BREAK_PAUSE_SEC["paragraph"]) for b in breaks] + [end_sec]


# Conversation: the gap between two recorded batches of turns - longer when the next turn
# opens a new topic or is a long turn, so a batch cut doesn't sound like the hosts rush on.
TURN_GAP_SEC = 0.25
TOPIC_GAP_SEC = 0.5
LONG_TURN_CHARS = 280
_END = r"(?=[\s,.!?:;—–-]|$)"
_TOPIC_START_RE = re.compile(
    r"^(?:(?:so|now|okay|ok|alright|anyway|right),|(?:moving on|next up|speaking of|turning to"
    r"|let's (?:talk|move|turn|look|switch)|another (?:thing|question|topic|point)|the next|finally"
    rf"|first of all|last but not least){_END}"
    r"|(?:אז|טוב|עכשיו|ועכשיו|אוקיי),|(?:בוא נדבר|בואי נדבר|בוא נעבור|בואי נעבור|נעבור|ונעבור|הנושא הבא"
    rf"|דבר נוסף|ולסיום|לסיום|קודם כל){_END})", re.I)


def turn_gap_sec(prev, nxt) -> float:
    """Gap before turn `nxt` (anything with a .text, or a dict with "text") when a cut falls there."""
    if prev is None or nxt is None:
        return TURN_GAP_SEC
    t = (nxt["text"] if isinstance(nxt, dict) else nxt.text).strip()
    return TOPIC_GAP_SEC if len(t) >= LONG_TURN_CHARS or _TOPIC_START_RE.match(t) else TURN_GAP_SEC


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
