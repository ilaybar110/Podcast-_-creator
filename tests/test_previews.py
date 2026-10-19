"""Selection, manifest and safety-gate logic of the voice-sample tooling (no network, no key)."""
import json
import subprocess

import pytest

from app.providers.gemini import GeminiProvider
from tools import check_previews, make_previews

VOICES = GeminiProvider(api_key="k").voices("he")
GOOD_MP3 = b"ID3" + b"\x00" * 2000


def seed(root, names):
    for n in names:
        lang, voice = n.split("/")
        (root / lang).mkdir(parents=True, exist_ok=True)
        (root / lang / f"{voice}.mp3").write_bytes(GOOD_MP3)


def test_wanted_is_eight_recommended_voices_in_both_languages_hebrew_first():
    w = make_previews.wanted(VOICES)
    assert len(w) == 16
    assert [lang for lang, _ in w] == ["he"] * 8 + ["en"] * 8
    assert all(v.recommended for _, v in w)


def test_missing_skips_existing_and_keeps_order(tmp_path):
    seed(tmp_path, ["he/Achird", "he/Sulafat", "en/Sulafat"])
    m = [(lang, v.id) for lang, v in make_previews.missing(VOICES, tmp_path)]
    assert len(m) == 13
    assert ("he", "Achird") not in m and ("en", "Sulafat") not in m
    assert m[0][0] == "he" and m[-1][0] == "en"
    assert make_previews.missing(VOICES, tmp_path / "nowhere")[0] == ("he", next(v for v in VOICES if v.id == "Sulafat"))


def test_manifest_lists_sorted_samples_with_expected_shape(tmp_path):
    seed(tmp_path, ["he/Sulafat", "en/Achird", "he/Achird"])
    m = make_previews.manifest_for(tmp_path)
    assert m == {"style": "warm", "pace": "natural", "samples": ["en/Achird", "he/Achird", "he/Sulafat"]}


def write_manifest(root, data):
    (root / "docs" / "previews").mkdir(parents=True, exist_ok=True)
    (root / "docs" / "previews" / "manifest.json").write_text(json.dumps(data))


def test_check_accepts_new_samples_and_matching_manifest(tmp_path):
    seed(tmp_path / "docs" / "previews", ["he/Achird", "en/Achird"])
    write_manifest(tmp_path, {"style": "warm", "pace": "natural", "samples": ["en/Achird", "he/Achird"]})
    changes = [("??", "docs/previews/en/Achird.mp3"), ("M", "docs/previews/manifest.json")]
    assert check_previews.check(changes, tmp_path) == []


@pytest.mark.parametrize("change", [
    ("M", ".github/workflows/voice-samples.yml"),
    ("??", "docs/index.html"),
    ("??", "docs/previews/fr/Achird.mp3"),
    ("??", "docs/previews/he/NotAVoice.mp3"),
    ("??", "docs/previews/he/../../app.js"),
    ("M", "docs/previews/he/Achird.mp3"),          # an existing sample must not be rewritten
    ("D", "docs/previews/he/Achird.mp3"),
])
def test_check_rejects_other_changes(tmp_path, change):
    seed(tmp_path / "docs" / "previews", ["he/Achird"])
    write_manifest(tmp_path, {"style": "warm", "pace": "natural", "samples": ["he/Achird"]})
    assert check_previews.check([change], tmp_path)


@pytest.mark.parametrize("manifest", [
    "not json",
    {"style": "warm", "pace": "natural"},
    {"style": "warm", "pace": "natural", "samples": "he/Achird"},
    {"style": "warm", "pace": "natural", "samples": ["he/Achird", "he/Nope"]},
    {"style": "warm", "pace": "natural", "samples": []},                      # does not match the files on disk
    {"style": "warm", "pace": "natural", "samples": ["he/Achird"], "extra": 1},
])
def test_check_rejects_bad_manifest(tmp_path, manifest):
    seed(tmp_path / "docs" / "previews", ["he/Achird"])
    (tmp_path / "docs" / "previews").mkdir(parents=True, exist_ok=True)
    (tmp_path / "docs" / "previews" / "manifest.json").write_text(
        manifest if isinstance(manifest, str) else json.dumps(manifest))
    assert check_previews.check([("M", "docs/previews/manifest.json")], tmp_path)


def test_check_rejects_non_mp3_and_tiny_files(tmp_path):
    root = tmp_path / "docs" / "previews"
    seed(root, ["he/Achird"])
    (root / "he" / "Achird.mp3").write_bytes(b"<html>" + b"x" * 2000)
    write_manifest(tmp_path, {"style": "warm", "pace": "natural", "samples": ["he/Achird"]})
    assert any("not an MP3" in e for e in check_previews.check([("??", "docs/previews/he/Achird.mp3")], tmp_path))
    (root / "he" / "Achird.mp3").write_bytes(b"ID3")
    assert any("size" in e for e in check_previews.check([("??", "docs/previews/he/Achird.mp3")], tmp_path))


def test_the_committed_previews_pass_the_gate():
    """The samples and manifest shipped in the repo are themselves valid."""
    root = check_previews.ROOT
    on_disk = {f"{p.parent.name}/{p.stem}" for p in (root / "docs" / "previews").glob("*/*.mp3")}
    assert check_previews.check_manifest(root / "docs" / "previews" / "manifest.json", on_disk) == []


def test_changed_paths_reads_git_status(tmp_path, monkeypatch):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    (tmp_path / "a.txt").write_text("x")
    monkeypatch.setattr(check_previews, "ROOT", tmp_path)
    assert check_previews.changed_paths() == [("??", "a.txt")]
