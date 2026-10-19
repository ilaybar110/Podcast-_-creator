"""Safety gate for the voice-samples workflow: run it before committing.

Fails (exit 1) unless the only changes in the working tree are
  * new docs/previews/<lang>/<Voice>.mp3 files, where <lang> is he or en and <Voice> is a voice the
    code knows (and the file looks like a small MP3), and
  * docs/previews/manifest.json, which must parse with the expected shape and list exactly the
    mp3 files that exist.
Existing samples must not be modified or deleted. Anything else (workflow files, scripts, other
docs) means something went wrong, so nothing is committed.

    python -m tools.check_previews
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.providers.gemini import _VOICES  # noqa: E402

PREVIEWS = "docs/previews"
LANGS = ("he", "en")
VOICES = frozenset(v[0] for v in _VOICES)
MAX_BYTES = 400_000            # a sample is ~4 s of speech; anything larger is not one
SAMPLE_RE = re.compile(rf"^{PREVIEWS}/({'|'.join(LANGS)})/([A-Za-z]+)\.mp3$")


def changed_paths() -> list[tuple[str, str]]:
    """(status, path) for everything changed or untracked in the working tree."""
    out = subprocess.run(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    entries, items = [], out.split("\0")
    i = 0
    while i < len(items):
        e = items[i]
        i += 1
        if not e:
            continue
        status, path = e[:2].strip() or "M", e[3:]
        if e[0] in "RC":            # renames carry the old path as a separate entry
            i += 1
            status = "R"
        entries.append((status, path))
    return entries


def check_manifest(path: Path, on_disk: set[str]) -> list[str]:
    try:
        m = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return [f"manifest.json does not parse: {e}"]
    if not isinstance(m, dict) or set(m) != {"style", "pace", "samples"}:
        return ["manifest.json must be an object with exactly: style, pace, samples"]
    if not isinstance(m["style"], str) or not isinstance(m["pace"], str):
        return ["manifest.json style/pace must be strings"]
    s = m["samples"]
    if not isinstance(s, list) or not all(isinstance(x, str) for x in s):
        return ["manifest.json samples must be a list of strings"]
    errors = []
    for x in s:
        lang, _, voice = x.partition("/")
        if lang not in LANGS or voice not in VOICES:
            errors.append(f"manifest.json lists an unknown sample: {x!r}")
    if len(set(s)) != len(s) or s != sorted(s):
        errors.append("manifest.json samples must be unique and sorted")
    if set(s) != on_disk:
        errors.append(f"manifest.json does not match the mp3 files on disk: {sorted(set(s) ^ on_disk)}")
    return errors


def check(changes: list[tuple[str, str]], root: Path = ROOT) -> list[str]:
    errors = []
    for status, path in changes:
        if path == f"{PREVIEWS}/manifest.json":
            if status not in ("M", "A", "??"):
                errors.append(f"unexpected change to {path}: {status}")
            continue
        m = SAMPLE_RE.match(path)
        if not m:
            errors.append(f"unexpected changed path: {path} ({status})")
            continue
        if status not in ("A", "??"):
            errors.append(f"existing sample must not change: {path} ({status})")
        if m.group(2) not in VOICES:
            errors.append(f"not a known voice: {path}")
            continue
        f = root / path
        if not f.is_file() or f.stat().st_size > MAX_BYTES or f.stat().st_size < 1000:
            errors.append(f"implausible mp3 size: {path}")
            continue
        head = f.read_bytes()[:3]
        if not (head == b"ID3" or (head[0] == 0xFF and head[1] & 0xE0 == 0xE0)):
            errors.append(f"not an MP3: {path}")
    manifest = root / PREVIEWS / "manifest.json"
    on_disk = {f"{p.parent.name}/{p.stem}" for p in (root / PREVIEWS).glob("*/*.mp3")}
    errors += check_manifest(manifest, on_disk)
    return errors


def main() -> int:
    errors = check(changed_paths())
    for e in errors:
        print("ERROR:", e)
    if errors:
        print("Refusing to commit.")
        return 1
    print("Preview changes look correct.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
