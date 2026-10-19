"""Stay on the free tier: plan the API usage of a podcast before it is generated,
track what was already used today, pace requests under the per-minute limits,
and never send a request that would go past a free daily limit.

Google does not publish fixed free-tier numbers for every model - they are set
per project (see https://aistudio.google.com/rate-limit). We therefore start
from conservative defaults, let the user override them, and *learn the real
limit* from Google's own quota errors, which state the exact value.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import threading
import time
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .providers.base import ProviderError

PACIFIC = ZoneInfo("America/Los_Angeles")   # Gemini daily quotas reset at midnight Pacific

# Conservative free-tier defaults (env-overridable). Real values are learned from 429s.
DEFAULT_LIMITS = {
    "gemini_tts": {"rpm": int(os.getenv("GEMINI_FREE_TTS_RPM", "3")),
                   "rpd": int(os.getenv("GEMINI_FREE_TTS_RPD", "15")),
                   "tpm": int(os.getenv("GEMINI_FREE_TTS_TPM", "10000"))},
    "gemini_text": {"rpm": int(os.getenv("GEMINI_FREE_TEXT_RPM", "10")),
                    "rpd": int(os.getenv("GEMINI_FREE_TEXT_RPD", "250")),
                    "tpm": int(os.getenv("GEMINI_FREE_TEXT_TPM", "250000"))},
}
# In free mode each TTS request carries more text, so the daily request quota goes further.
FREE_CHUNK_CHARS = int(os.getenv("GEMINI_FREE_CHUNK_CHARS", "3000"))
SCRIPT_PART_CHARS = 6000          # must match script_writer.SOURCE_PART_CHARS
DIALOGUE_EXPANSION = 1.25         # a dialogue is a bit longer than its source
RESERVE = 0.15                    # spare requests for re-recording bad takes


class QuotaExhausted(ProviderError):
    """A free daily quota is used up. Not retryable today; the job pauses."""

    def __init__(self, message: str, reset_at: datetime):
        super().__init__(message, retryable=False)
        self.reset_at = reset_at


def key_id(api_key: str | None) -> str:
    return hashlib.sha256((api_key or "").encode()).hexdigest()[:16]


def today_pacific() -> str:
    return datetime.now(PACIFIC).date().isoformat()


def next_reset() -> datetime:
    now = datetime.now(PACIFIC)
    return datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), PACIFIC)


def estimate_tokens(text: str) -> int:
    """Rough input-token count (Hebrew tokenises denser than English)."""
    hebrew = sum(1 for c in text if "֐" <= c <= "׿")
    return int(hebrew / 2.5 + (len(text) - hebrew) / 4) + 1


class Ledger:
    """Per-key, per-day usage counts persisted to disk (survives restarts)."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._minute: dict[tuple[str, str], deque] = {}
        try:
            self.data = json.loads(path.read_text())
        except (OSError, ValueError):
            self.data = {}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=1))
        tmp.replace(self.path)

    def _entry(self, kid: str) -> dict:
        e = self.data.setdefault(kid, {"day": today_pacific(), "used": {}, "learned": {}})
        if e["day"] != today_pacific():
            e["day"], e["used"] = today_pacific(), {}
        return e

    def used(self, kid: str, bucket: str) -> int:
        with self._lock:
            return self._entry(kid)["used"].get(bucket, 0)

    def record(self, kid: str, bucket: str, tokens: int) -> None:
        with self._lock:
            e = self._entry(kid)
            e["used"][bucket] = e["used"].get(bucket, 0) + 1
            self._save()
        self._minute.setdefault((kid, bucket), deque()).append((time.time(), tokens))

    def mark_exhausted(self, kid: str, bucket: str, limit: int | None) -> None:
        with self._lock:
            e = self._entry(kid)
            if limit:
                e["learned"].setdefault(bucket, {})["rpd"] = limit
            e["used"][bucket] = max(e["used"].get(bucket, 0), limit or 10**9)
            self._save()

    def learn(self, kid: str, bucket: str, kind: str, value: int) -> None:
        with self._lock:
            self._entry(kid)["learned"].setdefault(bucket, {})[kind] = value
            self._save()

    def limits(self, kid: str, bucket: str, overrides: dict | None = None) -> dict:
        """default < user override < value learned from Google's own quota error."""
        out = dict(DEFAULT_LIMITS[bucket])
        out.update({k: int(v) for k, v in (overrides or {}).items() if v})
        with self._lock:
            out.update(self._entry(kid)["learned"].get(bucket, {}))
        return out

    def minute_window(self, kid: str, bucket: str) -> deque:
        q = self._minute.setdefault((kid, bucket), deque())
        while q and time.time() - q[0][0] > 60:
            q.popleft()
        return q


def _data_dir() -> Path:
    return Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))


LEDGER = Ledger(_data_dir() / "usage.json")


class Gate:
    """Attached to a Gemini provider: paces and caps requests in free-only mode."""

    def __init__(self, api_key: str | None, free_only: bool, overrides: dict | None = None,
                 ledger: Ledger | None = None):
        self.kid = key_id(api_key)
        self.free_only = free_only
        self.overrides = overrides or {}
        self.ledger = ledger or LEDGER
        self.on_wait = None            # callback(seconds) so the UI can say "waiting for the free tier"
        self._lock = asyncio.Lock()

    async def acquire(self, bucket: str, tokens: int) -> None:
        if not self.free_only:
            self.ledger.record(self.kid, bucket, tokens)
            return
        async with self._lock:
            lim = self.ledger.limits(self.kid, bucket, self.overrides.get(bucket))
            if self.ledger.used(self.kid, bucket) >= lim["rpd"]:
                raise QuotaExhausted(
                    f"Today's free Gemini quota ({lim['rpd']} requests) is used up. "
                    f"The podcast is paused - continue after the quota resets.", next_reset())
            while True:
                q = self.ledger.minute_window(self.kid, bucket)
                n, toks = len(q), sum(t for _, t in q)
                if n < lim["rpm"] and (n == 0 or toks + tokens <= lim["tpm"]):
                    break
                wait = 60.5 - (time.time() - q[0][0])
                if self.on_wait:
                    self.on_wait(wait)
                await asyncio.sleep(max(0.5, wait))
            self.ledger.record(self.kid, bucket, tokens)

    def quota_error(self, bucket: str, body: dict) -> ProviderError | None:
        """Read Google's 429 details: learn the real limit, and stop for the day if it's daily."""
        for d in body.get("error", {}).get("details", []) or []:
            for v in d.get("violations", []) or []:
                qid = v.get("quotaId", "")
                try:
                    value = int(v.get("quotaValue", 0))
                except (TypeError, ValueError):
                    value = 0
                if "PerDay" in qid:
                    self.ledger.mark_exhausted(self.kid, bucket, value or None)
                    return QuotaExhausted(
                        f"Google says today's free quota for this model is used up ({value or '?'} "
                        f"requests/day). The podcast is paused - continue after the reset.", next_reset())
                if "PerMinute" in qid and value:
                    self.ledger.learn(self.kid, bucket, "tpm" if "Token" in qid else "rpm", value)
        return None


# ------------------------------------------------------------------ planning
def plan_requests(chars: int, mode: str, chunk_chars: int, already_done: int = 0) -> dict:
    """How many API calls a podcast needs, by quota bucket."""
    if mode == "conversation":
        script = math.ceil(chars / SCRIPT_PART_CHARS)
        tts = math.ceil(chars * DIALOGUE_EXPANSION / chunk_chars)
    else:
        script = 0
        tts = math.ceil(chars / chunk_chars)
    tts = max(0, tts - already_done)
    return {"gemini_tts": tts, "gemini_text": script,
            "reserve": {"gemini_tts": math.ceil(tts * RESERVE) if tts else 0,
                        "gemini_text": 1 if script else 0}}


def gemini_verdict(chars: int, mode: str, api_key: str | None, overrides: dict | None,
                   billing: bool, ledger: Ledger | None = None) -> dict:
    ledger = ledger or LEDGER
    kid = key_id(api_key)
    p = plan_requests(chars, mode, FREE_CHUNK_CHARS)
    buckets = {}
    days = 1
    for b in ("gemini_tts", "gemini_text"):
        need = p[b]
        if not need:
            continue
        lim = ledger.limits(kid, b, (overrides or {}).get(b))
        left = max(0, lim["rpd"] - ledger.used(kid, b))
        total = need + p["reserve"][b]
        if total > left:
            days = max(days, 1 + math.ceil((total - left) / max(1, lim["rpd"])))
        buckets[b] = {"needed": need, "reserve": p["reserve"][b], "left_today": left,
                      "per_day": lim["rpd"], "per_minute": lim["rpm"],
                      "minutes_at_least": round(need / max(1, lim["rpm"]), 1)}
    reset = next_reset()
    if billing:
        status = "paid"
    elif days == 1:
        status = "free"
    else:
        status = "free_multi_day"
    return {"engine": "gemini", "status": status, "days": days, "buckets": buckets,
            "reset_at": reset.isoformat(), "chunk_chars": FREE_CHUNK_CHARS}


def free_check(provider, chars: int, mode: str, keys: dict, billing: bool,
               overrides: dict | None = None) -> dict:
    """Will this podcast cost money? One verdict per engine:

    free            fits in what is left of today's free quota
    free_multi_day  free, but needs N days of free quota (the job pauses and continues)
    plan_credits    uses credits of a paid plan you already have (no extra charge)
    not_free        would go past the free allowance - blocked in free-only mode
    paid            billing is enabled on the key: every request is billed
    unknown         the quota couldn't be checked
    """
    out = _engine_check(provider, chars, mode, keys, billing, overrides)
    if mode == "conversation" and provider.name != "gemini":
        # The two-host script is always written by Gemini, so its quota matters too.
        script = gemini_verdict(chars, mode, keys.get("gemini") or os.getenv("GEMINI_API_KEY"),
                                overrides, billing)
        script["buckets"].pop("gemini_tts", None)
        script["days"] = 1 + max(0, max((math.ceil((b["needed"] + b["reserve"] - b["left_today"])
                                                  / max(1, b["per_day"]))
                                         for b in script["buckets"].values()), default=0))
        out["script"] = script
        if RANK.get(script["status"], 9) > RANK.get(out["status"], 9):
            out["status"] = script["status"]
            out["days"] = script["days"]
    return out


RANK = {"free": 0, "plan_credits": 1, "free_multi_day": 2, "unknown": 3, "not_free": 4, "paid": 5}


def _engine_check(provider, chars, mode, keys, billing, overrides) -> dict:
    name = provider.name
    if name == "edge":
        return {"engine": name, "status": "free", "unlimited": True}
    if name == "gemini":
        return gemini_verdict(chars, mode, provider.api_key, overrides, billing)
    if name == "elevenlabs":
        needed = int(chars * (DIALOGUE_EXPANSION if mode == "conversation" else 1))
        sub = provider.subscription()
        if not sub:
            return {"engine": name, "status": "unknown", "needed_chars": needed}
        left = max(0, int(sub.get("character_limit", 0)) - int(sub.get("character_count", 0)))
        tier = sub.get("tier", "unknown")
        if needed > left:
            status = "not_free"
        else:
            status = "free" if tier == "free" else "plan_credits"
        out = {"engine": name, "status": status, "tier": tier, "needed_chars": needed,
               "left_chars": left, "reset_at": datetime.fromtimestamp(
                   sub.get("next_character_count_reset_unix", 0) or time.time(), PACIFIC).isoformat()}
        return out
    # fake/test engines
    return {"engine": name, "status": "free", "unlimited": True}
