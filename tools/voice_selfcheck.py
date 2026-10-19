"""Voice self-check: is the Hebrew (or English) voice warm, human and correct?

For every candidate voice x prompt variant it:
  1. records a test passage full of Hebrew traps (homographs without niqqud,
     numbers, dates, an English loanword, an emotional sentence, a question),
  2. measures the audio objectively - pitch movement (flat = robotic),
     pause variety, dynamics -> "humanness" 0-100,
  3. asks Gemini to listen as a native Israeli listener and score native accent,
     warmth, naturalness and roboticness, list mispronounced words, and
     transcribe what it heard -> character error rate vs. the source text,
  4. ranks everything and writes report.md / report.json plus the MP3 samples.

Usage:
  GEMINI_API_KEY=... python -m tools.voice_selfcheck --language he
  python -m tools.voice_selfcheck --language he --voices Sulafat,Achird --variants directed,plain
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import re
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import audio, quality  # noqa: E402
from app.providers import EdgeProvider, GeminiProvider, ProviderError, SynthesisOptions, with_retries  # noqa: E402
from app.text_utils import NIQQUD_RE  # noqa: E402

PASSAGES = {
    "he": (
        "שלום לכולם, וברוכים הבאים לפרק חדש. היום אני רוצה לספר לכם על ספר שממש שינה לי את הראש. "
        "קראתי אותו בחופשה בצפון, ב-12 באוגוסט 2024, ופשוט לא הצלחתי להניח אותו. "
        "הסופרת מתארת ילדה קטנה שגדלה בקיבוץ, ואיך היא מגלה, לאט לאט, שהעולם גדול הרבה יותר ממה שחשבה. "
        "ואתם יודעים מה הכי ריגש אותי? הרגע שבו אמא שלה אומרת לה: את לא חייבת לפחד. "
        "אז אם אתם מחפשים משהו חם לקרוא בסוף השבוע, זה בדיוק הספר בשבילכם."
    ),
    "en": (
        "Hi everyone, and welcome to a brand new episode. Today I want to tell you about a book that "
        "honestly changed the way I think. I read it on vacation up north, on August 12th, 2024, and I "
        "just couldn't put it down. And you know what moved me the most? The moment her mother tells "
        "her: you don't have to be afraid. So if you're looking for something warm to read this weekend, "
        "this is the one."
    ),
}

JUDGE_PROMPT = {
    "he": """את/ה מאזין/ה ישראלי/ת, דובר/ת עברית ילידית, ומבקר/ת קריינות קפדני/ת לפודקאסטים.
הקשב/י להקלטה. הטקסט שהיה אמור להיקרא:
"{text}"

דרג/י בכנות (1-10):
- native_accent: עד כמה זה נשמע כמו ישראלי/ת ילידי/ת (10) לעומת מבטא זר (1)
- warmth: חום, חיוך בקול, אכפתיות
- naturalness: נשמע כמו בן אדם שמדבר (10) או קורא/מכונה (1)
- robotic: עד כמה זה רובוטי/מונוטוני (10 = רובוטי מאוד, כמו "כרמית")
- stress_errors: מספר המילים עם הטעמה או הגייה שגויה
והחזר/י JSON בלבד:
{{"native_accent":n,"warmth":n,"naturalness":n,"robotic":n,"stress_errors":n,
"mispronounced":["מילה - מה נשמע לא נכון"],"transcript":"מה ששמעת בדיוק, מילה במילה","verdict":"משפט אחד"}}""",
    "en": """You are a strict native English podcast critic. Listen to the recording. The intended text:
"{text}"
Score honestly 1-10: native_accent, warmth, naturalness, robotic (10 = very robotic/monotone),
stress_errors (count of mispronounced words). Return JSON only:
{{"native_accent":n,"warmth":n,"naturalness":n,"robotic":n,"stress_errors":n,
"mispronounced":["word - what was wrong"],"transcript":"exactly what you heard","verdict":"one sentence"}}""",
}


def normalise(s: str) -> str:
    s = NIQQUD_RE.sub("", s.lower())
    return re.sub(r"[^\w]", "", s)


def cer(ref: str, hyp: str) -> float:
    a, b = normalise(ref), normalise(hyp)
    if not a:
        return 0.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return prev[-1] / len(a)


def wav_bytes(pcm) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(audio.SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class PlainGemini(GeminiProvider):
    """Baseline: the same voice with no director's notes - shows what the prompt adds."""

    async def synthesize(self, text, voice, opts):
        cfg = {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}
        return await self._speak(text, cfg)


def combined(r: dict) -> float:
    j = r.get("judge") or {}
    if not j:
        return r["humanness"]
    listener = (j.get("native_accent", 0) * 1.4 + j.get("warmth", 0) * 1.3 + j.get("naturalness", 0) * 1.3
                + (10 - j.get("robotic", 10))) / 5.0 * 10            # 0-100
    accuracy = max(0.0, 100 - r["cer"] * 300 - j.get("stress_errors", 0) * 4)
    return round(0.55 * listener + 0.25 * r["humanness"] + 0.20 * accuracy, 1)


async def evaluate(engine, voice: str, variant: str, style: str, *, lang: str,
                   judge: GeminiProvider | None, out: Path) -> dict:
    text = PASSAGES[lang]
    opts = SynthesisOptions(language=lang, style=style, host_names=("Noa", "Yoni") if lang == "he" else ("Emma", "Jack"))
    t0 = time.time()
    pcm = audio.trim_silence(await with_retries(lambda: engine.synthesize(text, voice, opts)))
    secs = time.time() - t0
    name = f"{engine.name}_{voice}_{variant}_{style}".replace("/", "-")
    audio.write_wav(out / f"{name}.wav", pcm)
    audio.encode_mp3(out / f"{name}.wav", out / f"{name}.mp3", warm=True)
    (out / f"{name}.wav").unlink()
    m = quality.analyze(pcm)
    rec = {"engine": engine.name, "voice": voice, "variant": variant, "style": style,
           "file": f"{name}.mp3", "synth_sec": round(secs, 1), "metrics": m.to_dict(),
           "humanness": quality.humanness_score(m), "judge": None, "cer": 0.0}
    if judge:
        try:
            raw = await with_retries(lambda: judge.listen(wav_bytes(pcm), JUDGE_PROMPT[lang].format(text=text)))
            raw = raw.strip().removeprefix("```json").removesuffix("```")
            rec["judge"] = json.loads(raw)
            rec["cer"] = round(cer(text, rec["judge"].get("transcript", "")), 3)
        except (ProviderError, json.JSONDecodeError) as e:
            rec["judge_error"] = str(e)
    rec["score"] = combined(rec)
    print(f"  {name:45s} humanness={rec['humanness']:5.1f}  score={rec['score']:5.1f}  "
          f"{(rec['judge'] or {}).get('verdict', '')}", flush=True)
    return rec


def write_report(results: list[dict], out: Path, lang: str) -> None:
    results.sort(key=lambda r: r["score"], reverse=True)
    (out / "report.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [f"# Voice self-check ({lang})", "",
             "| # | engine | voice | variant | style | score | humanness | accent | warmth | natural | robotic | CER | pitch σ (st) |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for i, r in enumerate(results, 1):
        j = r.get("judge") or {}
        lines.append(f"| {i} | {r['engine']} | {r['voice']} | {r['variant']} | {r['style']} | **{r['score']}** | "
                     f"{r['humanness']} | {j.get('native_accent', '-')} | {j.get('warmth', '-')} | "
                     f"{j.get('naturalness', '-')} | {j.get('robotic', '-')} | {r['cer']} | "
                     f"{r['metrics']['pitch_std_semitones']} |")
    lines += ["", "## Listener notes", ""]
    for r in results:
        j = r.get("judge") or {}
        if j:
            lines.append(f"- **{r['voice']} / {r['variant']} / {r['style']}** - {j.get('verdict', '')} "
                         f"Mispronounced: {', '.join(j.get('mispronounced', [])) or 'none'}")
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nReport: {out / 'report.md'}")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--language", default="he", choices=["he", "en"])
    ap.add_argument("--voices", help="comma-separated Gemini voices (default: recommended set)")
    ap.add_argument("--variants", default="directed,plain", help="directed,plain")
    ap.add_argument("--styles", default="warm")
    ap.add_argument("--edge", action="store_true", help="also test the free Microsoft voices as a baseline")
    ap.add_argument("--no-judge", action="store_true")
    ap.add_argument("--out", default="selfcheck_out")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    gem = GeminiProvider()
    judge = gem if gem.available() and not args.no_judge else None
    jobs = []
    if gem.available():
        print(f"Gemini TTS model: {await gem.tts_model()} | judge model: {await gem.text_model()}")
        voices = args.voices.split(",") if args.voices else [v.id for v in gem.voices(args.language) if v.recommended]
        for variant in args.variants.split(","):
            engine = gem if variant == "directed" else PlainGemini()
            for style in (args.styles.split(",") if variant == "directed" else ["none"]):
                for v in voices:
                    jobs.append((engine, v, variant, style))
    else:
        print("GEMINI_API_KEY not set - skipping Gemini voices and the listener judge.")
    if args.edge or not gem.available():
        edge = EdgeProvider()
        for v in edge.voices(args.language):
            jobs.append((edge, v.id, "edge", "warm"))

    sem = asyncio.Semaphore(2)

    async def run(job):
        async with sem:
            try:
                return await evaluate(*job, lang=args.language, judge=judge, out=out)
            except ProviderError as e:
                print(f"  {job[0].name}/{job[1]}: FAILED - {e}")
                return None

    results = [r for r in await asyncio.gather(*(run(j) for j in jobs)) if r]
    if results:
        write_report(results, out, args.language)


if __name__ == "__main__":
    asyncio.run(main())
