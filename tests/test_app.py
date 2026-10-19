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
        if j["status"] in ("done", "error", "cancelled", "paused"):
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


# ------------------------------------------------------------ free tier guard
from app import budget  # noqa: E402


@pytest.fixture
def ledger(tmp_path, monkeypatch):
    led = budget.Ledger(tmp_path / "usage.json")
    monkeypatch.setattr(budget, "LEDGER", led)
    return led


def test_free_verdict_counts_requests(ledger):
    chunk = budget.FREE_CHUNK_CHARS
    v = budget.gemini_verdict(chunk * 5, "narrator", "k", None, billing=False)
    b = v["buckets"]["gemini_tts"]
    assert v["status"] == "free" and b["needed"] == 5 and b["left_today"] == 10
    assert "gemini_text" not in v["buckets"]
    # 40 requests (+6 reserve) at 10/day -> spans days, still free
    v = budget.gemini_verdict(chunk * 40, "narrator", "k", None, billing=False)
    assert v["status"] == "free_multi_day" and v["days"] == 5
    # usage already spent today is taken into account
    for _ in range(12):
        ledger.record(budget.key_id("k"), "gemini_tts", 10)
    assert budget.gemini_verdict(chunk * 5, "narrator", "k", None, False)["status"] == "free_multi_day"
    # user override of the daily limit
    v = budget.gemini_verdict(chunk * 5, "narrator", "k", {"gemini_tts": {"rpd": 100}}, False)
    assert v["status"] == "free" and v["buckets"]["gemini_tts"]["left_today"] == 88
    # conversation mode also needs script-writing requests
    v = budget.gemini_verdict(13000, "conversation", "other", None, False)
    assert v["buckets"]["gemini_text"]["needed"] == 3
    assert budget.gemini_verdict(100, "narrator", "k", None, billing=True)["status"] == "paid"


def test_gate_blocks_past_daily_limit_and_learns_from_google(ledger):
    gate = budget.Gate("key", free_only=True, overrides={"gemini_tts": {"rpd": 2, "rpm": 100}})
    asyncio.run(gate.acquire("gemini_tts", 10))
    asyncio.run(gate.acquire("gemini_tts", 10))
    with pytest.raises(budget.QuotaExhausted):
        asyncio.run(gate.acquire("gemini_tts", 10))
    # Google's real 429 tells us the true limit
    gate2 = budget.Gate("key2", free_only=True)
    err = {"error": {"code": 429, "details": [{"@type": "type.googleapis.com/google.rpc.QuotaFailure",
           "violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier", "quotaValue": "10"}]}]}}
    assert isinstance(gate2.quota_error("gemini_tts", err), budget.QuotaExhausted)
    assert ledger.limits(budget.key_id("key2"), "gemini_tts")["rpd"] == 10
    with pytest.raises(budget.QuotaExhausted):
        asyncio.run(gate2.acquire("gemini_tts", 10))
    minute = {"error": {"details": [{"violations": [
        {"quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "quotaValue": "5"}]}]}}
    assert gate2.quota_error("gemini_tts", minute) is None
    assert ledger.limits(budget.key_id("key2"), "gemini_tts")["rpm"] == 5


def test_gate_paces_under_rpm(ledger, monkeypatch):
    clock = [1000.0]
    waits = []

    async def fake_sleep(s):
        waits.append(s)
        clock[0] += s

    monkeypatch.setattr(budget.time, "time", lambda: clock[0])
    monkeypatch.setattr(budget.asyncio, "sleep", fake_sleep)
    gate = budget.Gate("k3", free_only=True, overrides={"gemini_tts": {"rpm": 3}})

    async def go():
        for _ in range(4):
            await gate.acquire("gemini_tts", 10)
    asyncio.run(go())
    assert len(waits) == 1 and 59 < waits[0] < 62     # 4th request waits for the minute window


def test_job_pauses_on_quota_and_resumes_without_repaying(client, ledger, monkeypatch):
    budget_calls = {"n": 0, "limit": 3}

    async def quota_synth(self, text, voice, opts):
        budget_calls["n"] += 1
        if budget_calls["n"] > budget_calls["limit"]:
            raise budget.QuotaExhausted("used up", budget.next_reset())
        return speechlike(len(text) / 13.0)

    monkeypatch.setattr(FakeProvider, "synthesize", quota_synth)
    monkeypatch.setattr(FakeProvider, "concurrency", 1)
    text = "\n\n".join(f"פסקה {i}. " + "מילים רבות בפסקה הזאת לבדיקה. " * 8 for i in range(6))
    n_parts = len(chunk_text(clean_text(text), FakeProvider.max_chunk_chars))
    assert n_parts > 3
    j = wait(client, client.post("/api/jobs", json={"text": text, "provider": "fake"}).json()["id"])
    assert j["status"] == "paused" and j["resume_at"]
    budget_calls["limit"] = 10**6
    calls_before = budget_calls["n"]
    r = client.post(f"/api/jobs/{j['id']}/resume")
    assert r.status_code == 200
    j = wait(client, j["id"])
    assert j["status"] == "done", j
    assert budget_calls["n"] - calls_before == n_parts - 3      # finished parts were not re-recorded


def test_estimate_and_start_report_free_status(client, ledger):
    d = client.post("/api/estimate", json={"text": "שלום עולם. " * 50, "provider": "fake"}).json()
    assert d["free"]["status"] == "free"
    d = client.post("/api/estimate", json={"text": "שלום עולם. " * 50, "provider": "gemini"},
                    headers={"X-Gemini-Key": "k"}).json()
    assert d["free"]["status"] == "free" and d["free"]["buckets"]["gemini_tts"]["needed"] == 1
    r = client.post("/api/jobs", json={"text": "שלום", "provider": "gemini", "billing": True},
                    headers={"X-Gemini-Key": "k"})
    assert r.status_code == 402


# ------------------------------------------------- browser edition (GitHub Pages)
def test_web_prompts_in_sync_with_python():
    from tools import build_web
    assert build_web.OUT.read_text(encoding="utf-8") == build_web.render(), \
        "docs/js/prompts_data.js is stale: run `python -m tools.build_web`"


def test_web_chunking_matches_python():
    import json
    import shutil
    import subprocess
    from pathlib import Path
    if not shutil.which("node"):
        pytest.skip("node not installed")
    samples = [
        "\n\n".join(f"פסקה {i}. " + "משפט בדיקה ארוך, עם פסיקים; וגם ״ציטוט.״ " * (i % 9 + 1) for i in range(60)),
        "Short intro, " + "word " * 900 + "end.",
        "# Title\n\nIntro line that wraps\nonto the next line.\n\n- bullet one\n- bullet two\n\n" + "x" * 5000,
    ]
    js = Path(__file__).resolve().parent.parent / "docs" / "js" / "text.js"
    script = (f"import('{js.as_posix()}').then(m => {{ const s = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
              "process.stdout.write(JSON.stringify(s.map(t => m.chunkText(m.cleanText(t), 1500)))); })")
    out = subprocess.run(["node", "-e", script], input=json.dumps(samples), capture_output=True, text=True, check=True)
    assert json.loads(out.stdout) == [chunk_text(clean_text(t), 1500) for t in samples]


def test_make_previews_records_missing_samples_in_order(tmp_path, monkeypatch, ledger):
    import json
    import sys
    from tools import make_previews
    pcm = speechlike(9.0)

    async def fake_generate(self, model, body):
        return {"candidates": [{"content": {"parts": [{"inlineData": {
            "mimeType": "audio/L16;codec=pcm;rate=24000", "data": base64.b64encode(pcm.tobytes()).decode()}}]}}]}

    async def fake_model(self):
        return "gemini-tts-test"

    monkeypatch.setattr(GeminiProvider, "_generate", fake_generate)
    monkeypatch.setattr(GeminiProvider, "tts_model", fake_model)
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(make_previews, "OUT", tmp_path)
    monkeypatch.setattr(sys, "argv", ["make_previews", "--max", "3"])
    asyncio.run(make_previews.main())
    assert json.loads((tmp_path / "manifest.json").read_text())["samples"] == ["he/Achird", "he/Sulafat", "he/Vindemiatrix"]
    monkeypatch.setattr(sys, "argv", ["make_previews", "--max", "100"])
    asyncio.run(make_previews.main())          # next run continues where it stopped, and stops at 16
    assert len(list(tmp_path.glob("he/*.mp3"))) == 8 and len(list(tmp_path.glob("en/*.mp3"))) == 8
    assert not (tmp_path / "he" / "Kore.mp3").exists()     # not a recommended voice


def test_web_topic_research_and_script():
    import shutil
    import subprocess
    from pathlib import Path
    if not shutil.which("node"):
        pytest.skip("node not installed")
    test = Path(__file__).resolve().parent / "web_topic_test.mjs"
    out = subprocess.run(["node", str(test)], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr


def test_web_hebrew_speech_prep_matches_python():
    import shutil
    import subprocess
    from pathlib import Path
    if not shutil.which("node"):
        pytest.skip("node not installed")
    test = Path(__file__).resolve().parent / "web_hebrew_test.mjs"
    out = subprocess.run(["node", str(test)], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
