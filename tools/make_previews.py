"""Pre-record the voice samples for the web app, so ▶ plays instantly and costs no quota.

Writes docs/previews/<lang>/<Voice>.mp3 and docs/previews/manifest.json. Skips samples that
already exist and stops after --max new ones, so a daily run leaves most of the free quota
for making podcasts. Only the 8 recommended voices are recorded (Hebrew first, then English);
other voices are still recorded live when tapped.

    GEMINI_API_KEY=... python -m tools.make_previews --max 5
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import audio  # noqa: E402
from app.budget import QuotaExhausted  # noqa: E402
from app.jobs import host_names  # noqa: E402
from app.prompts import PREVIEW_TEXT  # noqa: E402
from app.providers import ProviderError, SynthesisOptions, with_retries  # noqa: E402
from app.providers.gemini import GeminiProvider  # noqa: E402

OUT = ROOT / "docs" / "previews"
LANGS = ("he", "en")
# New samples are small: 24 kHz mono at 40 kbps (speech only; ~20 KB for a 4 s clip).
SAMPLE_RATE = 24000
BITRATE = "40k"


def wanted(voices) -> list[tuple[str, object]]:
    """Every sample the site should ship: the recommended voices, Hebrew first, then English (8 x 2)."""
    recommended = [v for v in voices if v.recommended]
    return [(lang, v) for lang in LANGS for v in recommended]


def missing(voices, out: Path) -> list[tuple[str, object]]:
    """Wanted samples that do not exist yet, in recording order. Existing files are never re-recorded."""
    return [(lang, v) for lang, v in wanted(voices) if not (out / lang / f"{v.id}.mp3").exists()]


def todo(gem: GeminiProvider) -> list[tuple[str, object]]:
    return missing(gem.voices("he"), OUT)


def manifest_for(out: Path) -> dict:
    files = sorted(f"{p.parent.name}/{p.stem}" for p in out.glob("*/*.mp3"))
    return {"style": "warm", "pace": "natural", "samples": files}


def write_manifest() -> None:
    (OUT / "manifest.json").write_text(json.dumps(manifest_for(OUT), indent=1) + "\n", encoding="utf-8")


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=5,
                    help="new samples per run (each uses one free TTS request of the repository key; the "
                         "free tier allows about 10 a day, so 5 leaves room for retries)")
    args = ap.parse_args()
    gem = GeminiProvider(free_only=True)
    if not gem.available():
        print("GEMINI_API_KEY is not set - nothing to do.")
        return 0
    pending = todo(gem)
    print(f"{len(pending)} samples missing; recording up to {args.max} now.")
    made = 0
    for lang, v in pending[: args.max]:
        other = "female" if v.gender == "male" else "male"
        opts = SynthesisOptions(language=lang, style="warm", pace="natural",
                                host_names=host_names(lang, v.gender, other), genders=(v.gender, other))
        text = PREVIEW_TEXT[lang].format(glad="שמח" if v.gender == "male" else "שמחה")
        try:
            pcm = await with_retries(lambda: gem.synthesize(text, v.id, opts), attempts=4)
        except QuotaExhausted as e:
            print("Stopping for today: the daily free quota is used up. The next run continues.")
            break
        except ProviderError as e:
            print(f"  {lang}/{v.id}: failed - {e}")
            continue
        (OUT / lang).mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "s.wav"
            audio.write_wav(wav, audio.trim_silence(pcm))
            audio.encode_mp3(wav, OUT / lang / f"{v.id}.mp3", warm=True, bitrate=BITRATE, out_rate=SAMPLE_RATE)
        made += 1
        print(f"  recorded {lang}/{v.id}")
    write_manifest()
    print(f"Done: {made} new, {len(todo(gem))} still missing.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
