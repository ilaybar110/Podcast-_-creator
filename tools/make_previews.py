"""Pre-record the voice samples for the web app, so ▶ plays instantly and costs no quota.

Writes docs/previews/<lang>/<Voice>.mp3 and docs/previews/manifest.json. Skips samples that
already exist and stops after --max new ones, so a daily run leaves most of the free quota
for making podcasts. Only the 8 recommended voices are recorded (Hebrew first, then English);
other voices are still recorded live when tapped.

    GEMINI_API_KEY=... python -m tools.make_previews --max 8
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
from app.main import PREVIEW_TEXT  # noqa: E402
from app.providers import ProviderError, SynthesisOptions, with_retries  # noqa: E402
from app.providers.gemini import GeminiProvider  # noqa: E402

OUT = ROOT / "docs" / "previews"
LANGS = ("he", "en")


def todo(gem: GeminiProvider) -> list[tuple[str, object]]:
    # Only the 8 recommended (warmest) voices: Hebrew first, then English - 16 samples in total.
    recommended = [v for v in gem.voices("he") if v.recommended]
    jobs = [(lang, v) for lang in LANGS for v in recommended]
    return [(lang, v) for lang, v in jobs if not (OUT / lang / f"{v.id}.mp3").exists()]


def write_manifest() -> None:
    files = sorted(f"{p.parent.name}/{p.stem}" for p in OUT.glob("*/*.mp3"))
    (OUT / "manifest.json").write_text(json.dumps({"style": "warm", "pace": "natural", "samples": files},
                                                  indent=1) + "\n", encoding="utf-8")


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=8, help="new samples per run (each uses one free request)")
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
            print(f"Stopping for today: {e}")
            break
        except ProviderError as e:
            print(f"  {lang}/{v.id}: failed - {e}")
            continue
        (OUT / lang).mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "s.wav"
            audio.write_wav(wav, audio.trim_silence(pcm))
            audio.encode_mp3(wav, OUT / lang / f"{v.id}.mp3", warm=True, bitrate="64k")
        made += 1
        print(f"  recorded {lang}/{v.id}")
    write_manifest()
    print(f"Done: {made} new, {len(todo(gem))} still missing.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
