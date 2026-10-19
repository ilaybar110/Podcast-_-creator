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

## Use it from your phone (GitHub Pages)

The `docs/` folder is a **browser-only edition** that needs no server, so it can be hosted free on
GitHub Pages and used from a phone:

- Your Gemini key is stored only in your browser and sent only to Google.
- Voice recording, quality checks, warm mastering, loudness and MP3 encoding all run on your device
  (lamejs encoder, bundled).
- The same voice direction as the server: `docs/js/prompts_data.js` is generated from `app/prompts.py`
  by `python -m tools.build_web`, and a test fails if they drift apart.
- The same free-tier guard, length estimate, exact final duration and two-host mode.
- Long podcasts are saved part by part on the device, so a pause (quota, or closing the page)
  continues where it stopped.
- Gemini only: the Microsoft and ElevenLabs engines need the Python server.

**Turn it on:** Repository **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
choose branch `claude/podcast-creator-app` and folder **`/docs`**, then **Save**. After a minute the app
is live at <https://ilaybar110.github.io/Podcast-_-creator/>.

## Podcast from a topic (web research)

In the GitHub Pages app, choose **From a topic**, write a subject and tap **Find sources**.
The app searches Google (Grounding with Google Search) and Wikipedia, then shows a short
summary, the sources it found and about six directions the episode could focus on. Pick
one or more (or write your own), set the length with the slider (2-30 minutes) and create it.
The script is written as an in-depth episode, not a summary: it explains why and how, uses
examples and numbers from the sources, and presents competing views. You get one narrator
or two hosts, as usual.

Cost is kept low:
- **Find sources** = 1 Google-Search request plus free Wikipedia lookups.
- **Create** = 1 more search (a deep dive on what you picked), 1 script request per ~12
  minutes of audio, and the voice recording.
- Search runs only on Gemini 2.5 Flash, where Google Search is free (3.x models charge per
  search). If search is unavailable, the research uses Wikipedia instead.
- Only the voice recording uses the small daily voice quota. The badge under the slider
  shows the exact number of requests before you start.

## Is it free? (checked before you click "Create")

Next to the length estimate, a badge shows whether the podcast will cost money:

| Badge | Meaning |
|---|---|
| ✓ **Free** | Fits in what's left of today's free quota. The badge shows how many requests it uses. |
| ⏳ **Free, needs N days** | Longer than one day's free quota. The app records until the quota runs out, **pauses**, and you press **Continue** after the daily reset (midnight Pacific, 10:00 Israel time). Finished parts are saved, so they're never paid for twice. A paused podcast survives closing the page. |
| ✗ **Not free** | Would go past the free allowance (for example, the ElevenLabs monthly characters). In free-only mode, creating it is blocked. |
| 💳 **Paid** | You marked your Gemini key as having billing enabled, so every request costs money. Blocked in free-only mode. |

How it works ([app/budget.py](app/budget.py)):

- **Exact request count:** the app counts the voice requests the text needs, plus script requests in two-host
  mode and a small reserve for re-recording bad takes, and subtracts what this key already used today.
  Usage is stored in `data/usage.json`.
- **Free-only mode** (on by default): requests are paced under the per-minute limit, so there are no
  rate-limit errors. A request past a daily free limit is never sent, and Pro models (no free tier) are
  never used. Each free request carries more text (3,000 characters, about 4 minutes of audio), so the
  daily quota goes further.
- **The real limits are learned:** Google doesn't publish fixed free-tier numbers for every model; they're
  set per project. The app starts from conservative defaults (10 voice requests a day, the real limit Google reported for the newest voice model, and 3 per minute).
  When Google rejects a request for quota, its error states the exact limit, and the app saves it. You can
  also enter your limits from <https://aistudio.google.com/rate-limit> in **Settings**.
- **ElevenLabs:** the app asks ElevenLabs for your exact remaining character quota.
- **Microsoft voices** are always free.
- Voice previews are cached on disk, so each one uses a free request only the first time.

> **Safest setup:** use a Gemini key from a Google Cloud project **without billing**. Then Google cannot
> charge you at all; the worst case is a "quota exceeded" pause.

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
