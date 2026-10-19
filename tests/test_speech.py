"""Hebrew speech prep (app/speech.py). The same cases run against docs/js/speech.js
in tests/web_hebrew_test.mjs, so the web and Python versions stay identical."""
import json
import re
from pathlib import Path

import pytest

from app.speech import digit_words, number_words, prepare_for_speech

CASES = json.loads((Path(__file__).parent / "speech_cases.json").read_text(encoding="utf-8"))["cases"]


def _lang(case):
    return case["lang"] if "lang" in case else "he"


@pytest.mark.parametrize("case", CASES, ids=[c["in"][:30] for c in CASES])
def test_shared_cases(case):
    assert prepare_for_speech(case["in"], _lang(case)) == case["out"]


@pytest.mark.parametrize("case", CASES, ids=[c["in"][:30] for c in CASES])
def test_idempotent(case):
    out = prepare_for_speech(case["in"], _lang(case))
    assert prepare_for_speech(out, _lang(case)) == out


def test_spec_examples():
    he = lambda t: prepare_for_speech(t, "he")    # noqa: E731
    assert he('צה"ל') == "צה״ל"
    assert he("3") == "שלוש" and he("15") == "חמש עשרה"
    assert he("1948") == "אלף תשע מאות ארבעים ושמונה"
    assert he("2024") == "אלפיים עשרים וארבע"
    assert he("3.5") == "שלוש נקודה חמש"
    assert he("15%") == "חמישה עשר אחוז"
    assert he("50 ₪") == "חמישים שקלים"
    assert he("10-20") == "עשר עד עשרים"
    assert he("ב-1948") == "באלף תשע מאות ארבעים ושמונה"


def test_number_words_cover_the_range_cleanly():
    for n in list(range(0, 2200)) + [10 ** k - 1 for k in range(4, 10)] + [10 ** k for k in range(4, 10)]:
        for masc in (False, True):
            w = number_words(n, masc)
            assert w and not re.search(r"[0-9]|  |^ | $", w), (n, w)
    assert number_words(21) == "עשרים ואחת" and number_words(21, True) == "עשרים ואחד"
    assert number_words(12, True) == "שנים עשר" and number_words(12) == "שתים עשרה"
    assert number_words(3000) == "שלושת אלפים" and number_words(11000) == "אחד עשר אלף"
    assert number_words(2_000_002) == "שני מיליון ושתיים"
    assert number_words(999_999_999).startswith("תשע מאות תשעים ותשעה מיליון")
    assert digit_words("050") == "אפס חמש אפס"


def test_detects_language_when_not_given():
    assert prepare_for_speech("הם שילמו 50 ₪") == "הם שילמו חמישים שקלים"
    english = "They paid $50 for 3 tickets in 2024."
    assert prepare_for_speech(english) == english
    assert prepare_for_speech("", None) == ""


def test_clean_hebrew_text_is_untouched():
    text = "שלום לכולם, היום נדבר על צה״ל ועל המנכ״לית החדשה.\n\nפסקה שנייה, בלי מספרים בכלל!"
    assert prepare_for_speech(text) == text


def test_jobs_send_spelled_out_text_to_the_voice(tmp_path, monkeypatch):
    """Narrator chunks and dialogue turns reach the provider spelled out; the saved script does not change."""
    import asyncio
    from app import jobs
    seen = []

    class P:
        max_chunk_chars, concurrency, supports_dialogue = 400, 1, True

        async def synthesize(self, text, voice, opts):
            seen.append(text)
            return b""

        async def synthesize_dialogue(self, turns, voices, opts):
            seen.extend(t.text for t in turns)
            return b""

    async def fake_best_take(make, text, language, job, label):
        await make()
        return [0], []

    monkeypatch.setattr(jobs, "best_take", fake_best_take)
    monkeypatch.setattr(jobs, "_save_part", lambda job, i, pcm: i)
    job = type("J", (), {"dir": tmp_path, "cancelled": False, "progress": 0, "stage": ""})()
    monkeypatch.setattr(jobs, "_part_path", lambda job, i: tmp_path / f"none{i}")
    from app.providers import SynthesisOptions
    opts = SynthesisOptions(language="he")
    asyncio.run(jobs._narrator_segments(job, P(), "ב-1948 קמה המדינה, עם 15% מהאוכלוסייה.", opts, "v"))
    assert seen == ["באלף תשע מאות ארבעים ושמונה קמה המדינה, עם חמישה עשר אחוז מהאוכלוסייה."]
