# 🎙 Podcast Creator · יוצר הפודקאסטים

Turn **any text, of any length** into a podcast **MP3** in **Hebrew or English**, in warm, human voices
instead of robotic ones like "Carmit". You see the **exact length** of the podcast before you download it.

הפכו כל טקסט, בכל אורך, לפודקאסט MP3 בעברית או באנגלית, בקול חם ואנושי ולא רובוטי. האורך המדויק מוצג לפני ההורדה.

## Features

- **Any length**: paste text or upload TXT / MD / PDF / DOCX / HTML / SRT. Long texts are split at
  paragraph and sentence boundaries, recorded in parallel, and joined with natural pauses.
- **Two formats**
  - *Single narrator*: your text, read word for word.
  - *Two-host conversation*: Gemini rewrites the text as a natural dialogue between two hosts
    (Noa & Yoni / Emma & Jack) that covers all of the content, then voices both hosts. NotebookLM-style.
- **Length up front**: an estimate updates while you type. When the podcast is ready, the app shows the
  **exact** duration of the finished MP3 (measured with ffprobe) next to the player, before you download.
- **Warm by design**
  - Gemini TTS is "directable". Every request carries director's notes asking for a native Israeli
    (Sabra) accent, correct stress, a smile in the voice, breaths and natural pauses, and explicitly
    *not* a newsreader ([app/prompts.py](app/prompts.py)).
  - Curated warm voices (Sulafat *Warm*, Achird *Friendly*, Vindemiatrix *Gentle*, Algieba *Smooth*…),
    each with a ▶ preview.
  - 5 styles (warm, storyteller, upbeat, calm, documentary) and 3 paces.
  - Warm mastering: rumble cut, a touch of low-mid body, de-essing, gentle compression, −16 LUFS
    podcast loudness.
- **Automatic quality control**: every recorded part is checked, and bad takes (truncated, rambling,
  long dead air) are re-recorded. The finished podcast gets a *humanness score* based on intonation
  movement, pause variety and dynamics. Flat, robotic speech scores low.

## Voice engines

| Engine | Hebrew quality | Cost | Setup |
|---|---|---|---|
| **Google Gemini TTS** (default) | Most natural and controllable; two-host mode | Free tier available | `GEMINI_API_KEY` from <https://aistudio.google.com/apikey> |
| ElevenLabs v3 | Very natural (uses explicit Hebrew `language_code`) | Paid | `ELEVENLABS_API_KEY` |
| Microsoft Neural (edge-tts) | Hila / Avri, clearly better than Carmit but flatter | Free, no key | Nothing |

The app automatically uses the best engine it has a key for. You can set keys in `.env` on the server,
or paste them in **Settings** in the UI (stored only in your browser).

## Run it

```bash
cp .env.example .env        # put your GEMINI_API_KEY in it
./run.sh                    # needs Python 3.10+ and ffmpeg
# open http://localhost:8000
```

Or with Docker:

```bash
docker build -t podcast-creator .
docker run -p 8000:8000 --env-file .env podcast-creator
```

## Voice self-check (Hebrew warmth audit)

Before trusting a voice, audit it:

```bash
GEMINI_API_KEY=... python -m tools.voice_selfcheck --language he --styles warm,storyteller --edge
```

For every voice × prompt variant (with director's notes vs. plain), this:

1. Records a Hebrew passage built around common TTS failures: words without niqqud whose reading
   depends on context, a date and numbers, an emotional line, and a question.
2. Measures it objectively: pitch movement in semitones (robotic voices stay flat), pause variety and
   dynamics, combined into a humanness score.
3. Has Gemini listen to the recording as a strict native Israeli critic. It scores native accent,
   warmth, naturalness and roboticness, lists mispronounced words, and transcribes what it heard.
   The transcript is compared with the source text to get a character error rate (CER).
4. Ranks the results in `selfcheck_out/report.md` and saves every sample as an MP3, so you can listen
   and check the ranking yourself.

Use the top-ranked voice as your default, and re-run it after any change to `app/prompts.py`.

## Development

```bash
pip install -r requirements.txt pytest
python -m pytest -q
```

The tests use a fake voice engine that produces speech-like audio. They check chunking (no text lost),
cleanup, bad-take retries, the robotic-vs-lively detector, the Gemini request format, and the full
API flow, including that the displayed duration matches the real MP3.

## How it works

```
text ─► clean (markdown, URLs, emoji) ─► detect he/en
     ├─ narrator:      split into ≤1.5k-char parts on paragraph/sentence boundaries
     └─ conversation:  Gemini writes the dialogue part by part, keeping context ─► batch turns
  ─► TTS in parallel (retry on rate limits; reject and re-record bad takes)
  ─► trim, short fades, natural pauses ─► warm mastering + loudnorm ─► MP3 ─► exact duration
```
