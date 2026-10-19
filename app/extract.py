"""Extract plain text from uploaded files."""
from __future__ import annotations

import io
import re
from html.parser import HTMLParser


class _HTMLText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self._skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag in ("p", "br", "div", "h1", "h2", "h3", "h4", "li", "tr"):
            self.parts.append("\n\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def _decode(data: bytes) -> str:
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    for enc in ("utf-8-sig", "cp1255"):   # cp1255 = legacy Windows Hebrew
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join((p.extract_text() or "") for p in reader.pages)
    if name.endswith(".docx"):
        import docx
        d = docx.Document(io.BytesIO(data))
        return "\n\n".join(p.text for p in d.paragraphs if p.text.strip())
    if name.endswith((".html", ".htm")):
        parser = _HTMLText()
        parser.feed(_decode(data))
        return re.sub(r"\n{3,}", "\n\n", "".join(parser.parts))
    if name.endswith(".srt") or name.endswith(".vtt"):
        text = _decode(data)
        text = re.sub(r"^\d+\s*$|^[\d:,.]+ --> [\d:,.]+.*$|^WEBVTT.*$", "", text, flags=re.M)
        return re.sub(r"\n{2,}", "\n", text)
    return _decode(data)
