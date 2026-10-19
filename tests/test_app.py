import asyncio
import base64
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import audio, quality, script_writer
from app.providers import PROVIDER_CLASSES, Provider, SynthesisOptions, Turn, Voice
from app.providers.gemini import GeminiProvider
from app.text_utils import chunk_text, clean_text, detect_language, estimate_seconds, format_duration

SR = audio.SAMPLE_RATE


def speechlike(seconds: float, lively: bool = True, f0: float = 190.0) -> np.ndarray:
    """Harmonic 'voice' with syllable envelope; lively = moving intonation + varied pauses."""
    t = np.arange(int(SR * seconds)) / SR
    rng = np.random.default_rng(1)
    if lively:
        contour = f0 * 2 ** ((3.0 * np.sin(2 * np.pi * 0.35 * t) + 1.5 * np.sin(2 * np.pi * 1.3 * t)) / 12)
    else:
        contour = np.full_like(t, f0)
    phase = 2 * np.pi * np.cumsum(contour) / SR
    sig = sum(np.sin(k * phase) / k for k in range(1, 6))
    env = 0.5 + 0.5 * np.sin(2 * np.pi * 4 * t) ** 2
    if lively:
        gate = np.ones_like(t)
        pos = 0.0
        while pos < seconds:
            pos += rng.uniform(1.0, 3.0)
            gate[int(pos * SR): int((pos + rng.uniform(0.2, 0.7)) * SR)] = 0
        env *= gate * (0.6 + 0.4 * np.sin(2 * np.pi * 0.2 * t) ** 2)
    return (sig * env * 6000).astype(np.int16)


class FakeProvider(Provider):
    name = "fake"
    label = "Fake"
    max_chunk_chars = 300
    concurrency = 3
    supports_dialogue = True
    calls = 0
    fail_first = False

    def __init__(self, *_):
        pass

    def available(self):
        return True

    def voices(self, language):
        return [Voice("F1", "F1", "female", "Warm", recommended=True), Voice("M1", "M1", "male", "Warm", recommended=True)]

    async def synthesize(self, text, voice, opts):
        FakeProvider.calls += 1
        if FakeProvider.fail_first and FakeProvider.calls == 1:
            return speechlike(0.3)                 # truncated take -> must be retried
        return speechlike(len(text) / 13.0)

    async def synthesize_dialogue(self, turns, voices, opts):
        return speechlike(sum(len(t.text) for t in turns) / 13.0)


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app import jobs
    monkeypatch.setattr(jobs, "DATA_DIR", tmp_path)
    monkeypatch.setitem(PROVIDER_CLASSES, "fake", FakeProvider)
    FakeProvider.calls, FakeProvider.fail_first = 0, False
    from app.main import app
    with TestClient(app) as c:
        yield c


# ------------------------------------------------------------------ text
def test_detect_language():
    assert detect_language("שלום עולם, מה שלומכם?") == "he"
    assert detect_language("Hello world, how are you?") == "en"
    assert detect_language("היום נדבר על AI ועל ChatGPT") == "he"


def test_clean_text_strips_markup():
    t = clean_text("# כותרת\n\n**מודגש** ראו https://x.com/a [קישור](http://y.com) 🎉🎉\n- פריט")
    assert "http" not in t and "**" not in t and "🎉" not in t and "#" not in t
    assert "קישור" in t and "פריט" in t


def test_chunking_covers_all_text_and_respects_limits():
    sentence = "זהו משפט בדיקה ארוך למדי שנועד לבדוק את חלוקת הטקסט לחלקים. "
    text = "\n\n".join(sentence * (i % 7 + 1) for i in range(200)) + "\n\n" + "מילה " * 2000
    chunks = chunk_text(text, 1500)
    joined = " ".join(" ".join(c) for c in chunks).split()
    assert joined == clean_text(text).split()
    assert all(len("\n\n".join(c)) <= 1500 + 10 for c in chunks)


def test_estimate_and_format():
    assert format_duration(3725) == "1:02:05" and format_duration(65) == "1:05"
    he = estimate_seconds("שלום " * 1000, "he")
    assert 350 < he < 600


# --------------------------------------------------------------- quality
def test_robotic_voice_scores_lower_than_lively_voice():
    flat = quality.analyze(speechlike(20, lively=False))
    live = quality.analyze(speechlike(20, lively=True))
    assert flat.pitch_std_semitones < 0.5
    assert live.pitch_std_semitones > 1.5
    assert quality.humanness_score(live) > quality.humanness_score(flat) + 30


def test_take_problems_detects_truncation():
    text = "א" * 260
    assert quality.take_problems(speechlike(2), text, "he")
    assert not quality.take_problems(speechlike(20), text, "he")


# --------------------------------------------------------------- dialogue
def test_parse_dialogue():
    raw = "**Noa:** היי וברוכים הבאים!\nYoni: תודה נועה (צוחק) שמח להיות פה.\nהמשך שורה.\nNarrator: x"
    turns = script_writer.parse_dialogue(raw, ("Noa", "Yoni"))
    assert [t.speaker for t in turns] == ["Noa", "Yoni"]
    assert "צוחק" not in turns[1].text and turns[1].text.endswith("המשך שורה.")


# ------------------------------------------------------------- gemini wire
def test_gemini_request_and_audio_parsing(monkeypatch):
    seen = {}
    pcm = speechlike(1.0)

    async def fake_generate(self, model, body):
        seen["model"], seen["body"] = model, body
        return {"candidates": [{"content": {"parts": [{"inlineData": {
            "mimeType": "audio/L16;codec=pcm;rate=24000", "data": base64.b64encode(pcm.tobytes()).decode()}}]}}]}

    async def fake_model(self):
        return "gemini-tts-test"

    monkeypatch.setattr(GeminiProvider, "_generate", fake_generate)
    monkeypatch.setattr(GeminiProvider, "tts_model", fake_model)
    g = GeminiProvider(api_key="k")
    out = asyncio.run(g.synthesize("שלום לכולם", "Sulafat", SynthesisOptions(language="he")))
    assert np.array_equal(out, pcm)
    cfg = seen["body"]["generationConfig"]
    assert cfg["responseModalities"] == ["AUDIO"]
    assert cfg["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] == "Sulafat"
    prompt = seen["body"]["contents"][0]["parts"][0]["text"]
    assert "Israeli" in prompt and prompt.rstrip().endswith("שלום לכולם")

    out = asyncio.run(g.synthesize_dialogue([Turn("Noa", "היי"), Turn("Yoni", "שלום")],
                                            {"Noa": "Sulafat", "Yoni": "Achird"},
                                            SynthesisOptions(language="he")))
    spk = seen["body"]["generationConfig"]["speechConfig"]["multiSpeakerVoiceConfig"]["speakerVoiceConfigs"]
    assert {s["speaker"] for s in spk} == {"Noa", "Yoni"}
    assert seen["body"]["generationConfig"]["speechConfig"]["languageCode"] == "he-IL"
    assert "Noa: היי\nYoni: שלום" in seen["body"]["contents"][0]["parts"][0]["text"]


# --------------------------------------------------------------- end to end
def wait(client, jid, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        j = client.get(f"/api/jobs/{jid}").json()
        if j["status"] in ("done", "error", "cancelled"):
            return j
        time.sleep(0.2)
    raise AssertionError("job timed out")


def test_full_narrator_job_reports_exact_duration(client):
    FakeProvider.fail_first = True
    text = "\n\n".join(f"פסקה מספר {i}. זה טקסט לבדיקה של יצירת פודקאסט ארוך בעברית." for i in range(40))
    est = client.post("/api/estimate", json={"text": text}).json()
    assert est["language"] == "he" and est["estimated_sec"] > 0
    r = client.post("/api/jobs", json={"text": text, "provider": "fake", "title": "בדיקה"})
    assert r.status_code == 200, r.text
    j = wait(client, r.json()["id"])
    assert j["status"] == "done", j
    res = j["result"]
    dl = client.get(res["download_url"])
    assert dl.status_code == 200 and dl.content[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3")
    # the duration shown before download is the real duration of the file
    from pathlib import Path
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(dl.content)
    assert abs(audio.probe_duration(Path(f.name)) - res["duration_sec"]) < 0.05
    assert res["duration_str"] == format_duration(res["duration_sec"])
    assert FakeProvider.calls > len(chunk_text(text, 300))   # the truncated take was retried
    assert 0.6 * est["estimated_sec"] < res["duration_sec"] < 1.6 * est["estimated_sec"]


def test_conversation_job(client, monkeypatch):
    async def fake_dialogue(gemini, text, language, hosts, on_progress=None, genders=None):
        return [Turn(hosts[i % 2], f"שורה מספר {i} בשיחה בין המגישים, עם קצת תוכן.") for i in range(30)]

    monkeypatch.setattr(script_writer, "write_dialogue", fake_dialogue)
    monkeypatch.setattr(GeminiProvider, "available", lambda self: True)
    r = client.post("/api/jobs", json={"text": "טקסט כלשהו לשיחה.", "provider": "fake", "mode": "conversation"})
    j = wait(client, r.json()["id"])
    assert j["status"] == "done", j
    assert j["has_script"]
    assert len(client.get(f"/api/jobs/{j['id']}/script").json()["script"]) == 30


def test_extract_and_config(client):
    r = client.post("/api/extract", files={"file": ("a.txt", "שלום עולם".encode("cp1255"))})
    assert r.json()["text"] == "שלום עולם" and r.json()["language"] == "he"
    cfg = client.get("/api/config?language=he").json()
    assert {e["id"] for e in cfg["engines"]} >= {"gemini", "elevenlabs", "edge"}
    assert client.get("/").status_code == 200


# ------------------------------------------------------- review regressions
def test_long_sentence_keeps_order_and_quotes():
    from app.text_utils import _split_long, split_sentences
    s = "Short intro, " + "word " * 60 + "end."
    parts = _split_long(s, 100)
    assert parts[0].startswith("Short intro") and " ".join(parts).split() == s.split()
    assert split_sentences("הוא אמר ״שלום.״ ואז הלך.") == ["הוא אמר ״שלום.״", "ואז הלך."]
    text = 'He said "hi." ' * 200
    assert " ".join(" ".join(c) for c in chunk_text(text, 300)).count('"') == 400
    assert all(len(c[0]) <= 1000 for c in chunk_text("x" * 5000, 1000))


def test_bullets_keep_paragraph_break():
    assert clean_text("Intro.\n\n- item one") == "Intro.\n\nitem one"


def test_host_names_follow_voice_gender():
    from app.jobs import host_names
    assert host_names("he", "female", "male") == ("Noa", "Yoni")
    assert host_names("he", "male", "male") == ("Yoni", "Avi")
    assert host_names("he", "female", "female") == ("Noa", "Maya")


def test_always_truncated_part_is_split_then_fails_loudly(client, monkeypatch):
    async def short_unless_tiny(self, text, voice, opts):
        FakeProvider.calls += 1
        return speechlike(len(text) / 13.0 if len(text) < 120 else 0.3)

    monkeypatch.setattr(FakeProvider, "synthesize", short_unless_tiny)
    text = "זה משפט ראשון שהוא די ארוך כדי לבדוק. וזה משפט שני שהוא גם די ארוך לבדיקה. ומשפט שלישי אחרון."
    j = wait(client, client.post("/api/jobs", json={"text": text, "provider": "fake"}).json()["id"])
    assert j["status"] == "done", j          # recovered by recording shorter pieces
    assert j["result"]["duration_sec"] > 0.6 * len(text) / 13.0

    async def always_short(self, text, voice, opts):
        return speechlike(0.2)

    monkeypatch.setattr(FakeProvider, "synthesize", always_short)
    j = wait(client, client.post("/api/jobs", json={"text": text, "provider": "fake"}).json()["id"])
    assert j["status"] == "error" and "cutting this passage short" in j["error"]


def test_cancel_stops_job(client, monkeypatch):
    async def slow(self, text, voice, opts):
        await asyncio.sleep(30)

    monkeypatch.setattr(FakeProvider, "synthesize", slow)
    jid = client.post("/api/jobs", json={"text": "שלום " * 300, "provider": "fake"}).json()["id"]
    time.sleep(0.5)
    client.post(f"/api/jobs/{jid}/cancel")
    t0 = time.time()
    assert wait(client, jid, timeout=5)["status"] == "cancelled" and time.time() - t0 < 5
