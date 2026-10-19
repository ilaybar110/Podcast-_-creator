// Gemini client + free-tier guard, running entirely in the browser (port of
// app/providers/gemini.py and app/budget.py). The API key goes straight from this
// page to Google; there is no server in between.
import { DATA } from "./prompts_data.js";
import { narratorPrompt, dialoguePrompt } from "./prompts.js";

const API = "https://generativelanguage.googleapis.com/v1beta";
const TTS_PREF = ["gemini-3.1-flash-tts-preview", "gemini-3.1-flash-tts", "gemini-2.5-pro-tts",
  "gemini-2.5-pro-preview-tts", "gemini-2.5-flash-tts", "gemini-2.5-flash-preview-tts"];
const TEXT_PREF = ["gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-2.5-pro",
  "gemini-3.1-flash-preview", "gemini-3-flash-preview", "gemini-2.5-flash"];
const BLOCK = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "OTHER_BLOCK"]);

export const VOICES = [
  ["Sulafat", "female", "Warm", true], ["Achird", "male", "Friendly", true],
  ["Vindemiatrix", "female", "Gentle", true], ["Algieba", "male", "Smooth", true],
  ["Gacrux", "female", "Mature", true], ["Umbriel", "male", "Easy-going", true],
  ["Aoede", "female", "Breezy", true], ["Sadaltager", "male", "Knowledgeable", true],
  ["Despina", "female", "Smooth", false], ["Callirrhoe", "female", "Easy-going", false],
  ["Achernar", "female", "Soft", false], ["Charon", "male", "Informative", false],
  ["Zubenelgenubi", "male", "Casual", false], ["Sadachbia", "male", "Lively", false],
  ["Enceladus", "male", "Breathy", false], ["Iapetus", "male", "Clear", false],
  ["Kore", "female", "Firm", false], ["Leda", "female", "Youthful", false],
  ["Zephyr", "female", "Bright", false], ["Autonoe", "female", "Bright", false],
  ["Erinome", "female", "Clear", false], ["Laomedeia", "female", "Upbeat", false],
  ["Pulcherrima", "female", "Forward", false], ["Puck", "male", "Upbeat", false],
  ["Fenrir", "male", "Excitable", false], ["Orus", "male", "Firm", false],
  ["Algenib", "male", "Gravelly", false], ["Rasalgethi", "male", "Informative", false],
  ["Alnilam", "male", "Firm", false], ["Schedar", "male", "Even", false],
].map(([id, gender, description, recommended]) => ({ id, name: id, gender, description, recommended }));

export class ProviderError extends Error {
  constructor(message, { retryable = false, retryAfter = null } = {}) {
    super(message);
    this.retryable = retryable;
    this.retryAfter = retryAfter;
  }
}

export class QuotaExhausted extends ProviderError {
  constructor(message, resetAt) {
    super(message);
    this.resetAt = resetAt;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withRetries(fn, attempts = 6, base = 4000) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable || i >= attempts - 1) throw e;
      await sleep(Math.min(90000, e.retryAfter ? e.retryAfter * 1000 : base * 2 ** i));
    }
  }
}

// ------------------------------------------------------------------ free tier
// Gemini daily quotas reset at midnight Pacific time.
function pacificParts(date = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return p;
}
export function todayPacific() {
  const p = pacificParts();
  return `${p.year}-${p.month}-${p.day}`;
}
export function nextReset() {
  const p = pacificParts();
  const secsIntoDay = (+p.hour) * 3600 + (+p.minute) * 60 + (+p.second);
  return new Date(Date.now() + (86400 - secsIntoDay) * 1000);
}

export function estimateTokens(text) {
  const he = (text.match(/[֐-׿]/g) || []).length;
  return Math.floor(he / 2.5 + (text.length - he) / 4) + 1;
}

async function keyId(key) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key || ""));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Per-key, per-day usage counts, kept in this browser's localStorage. */
export class Ledger {
  constructor(storage = globalThis.localStorage) { this.storage = storage; this.minute = new Map(); }
  _load() { try { return JSON.parse(this.storage.getItem("podcastUsage") || "{}"); } catch { return {}; } }
  _save(d) { try { this.storage.setItem("podcastUsage", JSON.stringify(d)); } catch { /* full/private */ } }
  _entry(d, kid) {
    const today = todayPacific();
    const e = d[kid] ||= { day: today, used: {}, learned: {} };
    if (e.day !== today) { e.day = today; e.used = {}; }
    return e;
  }
  used(kid, bucket) { const d = this._load(); return this._entry(d, kid).used[bucket] || 0; }
  record(kid, bucket, tokens) {
    const d = this._load(); const e = this._entry(d, kid);
    e.used[bucket] = (e.used[bucket] || 0) + 1; this._save(d);
    this.window(kid, bucket).push([Date.now(), tokens]);
  }
  markExhausted(kid, bucket, limit) {
    const d = this._load(); const e = this._entry(d, kid);
    if (limit) (e.learned[bucket] ||= {}).rpd = limit;
    e.used[bucket] = Math.max(e.used[bucket] || 0, limit || 1e9); this._save(d);
  }
  learn(kid, bucket, kind, value) {
    const d = this._load(); (this._entry(d, kid).learned[bucket] ||= {})[kind] = value; this._save(d);
  }
  /** default < user override < the limit Google itself reported. */
  limits(kid, bucket, overrides = {}) {
    const out = { ...DATA.FREE_DEFAULTS[bucket] };
    for (const [k, v] of Object.entries(overrides || {})) if (v > 0) out[k] = v;
    const d = this._load();
    return { ...out, ...(this._entry(d, kid).learned[bucket] || {}) };
  }
  window(kid, bucket) {
    const k = kid + bucket;
    const q = (this.minute.get(k) || []).filter(([t]) => Date.now() - t < 60000);
    this.minute.set(k, q);
    return q;
  }
}
export const LEDGER = new Ledger();

/** Paces and caps requests in free-only mode. */
export class Gate {
  constructor(apiKey, freeOnly, overrides = {}, ledger = LEDGER) {
    this.kidP = keyId(apiKey);
    Object.assign(this, { freeOnly, overrides, ledger, onWait: null, chain: Promise.resolve() });
  }
  acquire(bucket, tokens) {
    // serialise acquisitions so concurrent requests can't both slip past a limit
    const run = this.chain.then(() => this._acquire(bucket, tokens));
    this.chain = run.catch(() => {});
    return run;
  }
  async _acquire(bucket, tokens) {
    const kid = await this.kidP;
    if (!this.freeOnly) return this.ledger.record(kid, bucket, tokens);
    const lim = this.ledger.limits(kid, bucket, this.overrides[bucket]);
    if (this.ledger.used(kid, bucket) >= lim.rpd) {
      throw new QuotaExhausted(`Today's free Gemini quota (${lim.rpd} requests) is used up.`, nextReset());
    }
    for (;;) {
      const q = this.ledger.window(kid, bucket);
      const toks = q.reduce((s, [, t]) => s + t, 0);
      if (q.length < lim.rpm && (q.length === 0 || toks + tokens <= lim.tpm)) break;
      const wait = 60500 - (Date.now() - q[0][0]);
      this.onWait?.(wait / 1000);
      await sleep(Math.max(500, wait));
    }
    this.ledger.record(kid, bucket, tokens);
  }
  async quotaError(bucket, body) {
    const kid = await this.kidP;
    for (const d of body?.error?.details || []) {
      for (const v of d.violations || []) {
        const qid = v.quotaId || "";
        const value = parseInt(v.quotaValue, 10) || 0;
        if (qid.includes("PerDay")) {
          this.ledger.markExhausted(kid, bucket, value || null);
          return new QuotaExhausted(`Google says today's free quota for this model is used up (${value || "?"} requests/day).`, nextReset());
        }
        if (qid.includes("PerMinute") && value) this.ledger.learn(kid, bucket, qid.includes("Token") ? "tpm" : "rpm", value);
      }
    }
    return null;
  }
}

export async function freeVerdict({ chars, mode, apiKey, overrides, billing, alreadyDone = 0, ledger = LEDGER }) {
  const kid = await keyId(apiKey);
  const chunk = DATA.FREE_CHUNK_CHARS;
  const need = {
    gemini_tts: Math.max(0, Math.ceil(chars * (mode === "conversation" ? 1.25 : 1) / chunk) - alreadyDone),
    gemini_text: mode === "conversation" ? Math.ceil(chars / 6000) : 0,
  };
  const buckets = {};
  let days = 1;
  for (const b of ["gemini_tts", "gemini_text"]) {
    if (!need[b]) continue;
    const lim = ledger.limits(kid, b, overrides?.[b]);
    const left = Math.max(0, lim.rpd - ledger.used(kid, b));
    const reserve = b === "gemini_tts" ? Math.ceil(need[b] * 0.15) : 1;
    const total = need[b] + reserve;
    if (total > left) days = Math.max(days, 1 + Math.ceil((total - left) / Math.max(1, lim.rpd)));
    buckets[b] = { needed: need[b], reserve, left_today: left, per_day: lim.rpd, per_minute: lim.rpm,
      minutes_at_least: Math.round(10 * need[b] / Math.max(1, lim.rpm)) / 10 };
  }
  const status = billing ? "paid" : days === 1 ? "free" : "free_multi_day";
  return { engine: "gemini", status, days, buckets, reset_at: nextReset().toISOString() };
}

// ------------------------------------------------------------------ client
const modelCache = new Map();

function b64ToInt16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length & ~1);
  for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export class Gemini {
  constructor(apiKey, { freeOnly = true, overrides = {}, fetchFn = (...a) => fetch(...a) } = {}) {
    Object.assign(this, { apiKey, freeOnly, fetchFn });
    this.gate = new Gate(apiKey, freeOnly, overrides);
    this.maxChunkChars = freeOnly ? DATA.FREE_CHUNK_CHARS : 1500;
    this.concurrency = 2;
  }

  async models() {
    if (modelCache.has(this.apiKey)) return modelCache.get(this.apiKey);
    let names = [], token = "";
    for (let i = 0; i < 10; i++) {
      let r;
      try {
        r = await this.fetchFn(`${API}/models?pageSize=1000${token ? "&pageToken=" + token : ""}`,
          { headers: { "x-goog-api-key": this.apiKey } });
      } catch (e) { throw new ProviderError(`Network error talking to Gemini: ${e.message}`, { retryable: true }); }
      if ([400, 401, 403].includes(r.status)) throw new ProviderError("Gemini rejected the API key. Check it in Settings.");
      if (!r.ok) throw new ProviderError(`Gemini ${r.status} while listing models`, { retryable: [429, 500, 502, 503, 504].includes(r.status) });
      const d = await r.json();
      names = names.concat((d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => m.name.split("/").slice(1).join("/")));
      token = d.nextPageToken;
      if (!token) break;
    }
    modelCache.set(this.apiKey, names);
    return names;
  }

  _free(names) { return this.freeOnly ? names.filter((n) => !n.includes("pro")) : names; }   // Pro has no free tier

  async ttsModel() {
    const names = this._free(await this.models());
    const m = TTS_PREF.find((p) => names.includes(p)) || names.filter((n) => n.includes("tts")).sort().reverse()[0];
    if (!m) throw new ProviderError("This Gemini API key has no access to a free TTS model.");
    return m;
  }

  async textModel() {
    const names = this._free(await this.models());
    const m = TEXT_PREF.find((p) => names.includes(p)) ||
      names.filter((n) => n.startsWith("gemini") && !/tts|image|embedding|live|audio|vision|thinking-exp/.test(n)).sort().reverse()[0];
    if (!m) throw new ProviderError("No Gemini text model available for writing the podcast script.");
    return m;
  }

  async generate(model, body) {
    const bucket = model.includes("tts") ? "gemini_tts" : "gemini_text";
    const prompt = body.contents.flatMap((c) => c.parts).map((p) => p.text || "").join("");
    await this.gate.acquire(bucket, estimateTokens(prompt));
    let r;
    try {
      r = await this.fetchFn(`${API}/models/${model}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) { throw new ProviderError(`Network error talking to Gemini: ${e.message}`, { retryable: true }); }
    if (r.ok) return r.json();
    let err = {};
    try { err = await r.json(); } catch { /* not JSON */ }
    if (r.status === 429) {
      const q = await this.gate.quotaError(bucket, err);
      if (q) throw q;
    }
    const delay = (err.error?.details || []).map((d) => d.retryDelay).find(Boolean);
    throw new ProviderError(`Gemini ${r.status}: ${err.error?.message || r.statusText}`, {
      retryable: [429, 500, 502, 503, 504].includes(r.status), retryAfter: delay ? parseFloat(delay) : null });
  }

  async speak(prompt, speechConfig, language) {
    const model = await this.ttsModel();
    const cfg = { ...speechConfig };
    if (language === "he") cfg.languageCode = "he-IL";
    const body = () => ({ contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: cfg, temperature: 1.0 } });
    let data;
    try {
      data = await this.generate(model, body());
    } catch (e) {
      if (!(cfg.languageCode && !e.retryable && !(e instanceof QuotaExhausted) && /language/i.test(e.message))) throw e;
      delete cfg.languageCode;    // older models reject the field; auto-detect instead
      data = await this.generate(model, body());
    }
    const parts = data.candidates?.[0]?.content?.parts || [];
    const audio = parts.map((p) => p.inlineData || p.inline_data).filter((d) => d?.data);
    if (!audio.length) {
      const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || "no audio";
      const blocked = BLOCK.has(reason);
      throw new ProviderError(blocked ? "Gemini refused to voice this passage (content filter)" : `Gemini returned no audio (${reason})`,
        { retryable: !blocked });
    }
    const rate = parseInt((audio[0].mimeType || "").match(/rate=(\d+)/)?.[1] || "24000", 10);
    const pcm = audio.map((a) => b64ToInt16(a.data));
    const total = pcm.reduce((s, a) => s + a.length, 0);
    const out = new Int16Array(total);
    let o = 0;
    for (const a of pcm) { out.set(a, o); o += a.length; }
    return { pcm: out, rate };
  }

  synthesize(text, voice, opts) {
    const gender = VOICES.find((v) => v.id === voice)?.gender || opts.genders[0];
    const persona = gender === opts.genders[0] ? opts.hostNames[0] : opts.hostNames[1];
    const prompt = narratorPrompt(text, opts.language, opts.style, opts.pace, `${persona}, a warm podcast host`, gender);
    return this.speak(prompt, { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }, opts.language);
  }

  synthesizeDialogue(turns, voices, opts) {
    const transcript = turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
    const prompt = dialoguePrompt(transcript, opts.language, opts.style, opts.pace, opts.hostNames, opts.genders);
    return this.speak(prompt, { multiSpeakerVoiceConfig: { speakerVoiceConfigs: Object.entries(voices).map(([speaker, v]) =>
      ({ speaker, voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } })) } }, opts.language);
  }

  async writeText(prompt) {
    const data = await this.generate(await this.textModel(), {
      contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9 } });
    const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
    if (!text.trim()) throw new ProviderError("Gemini returned an empty script", { retryable: true });
    return text;
  }
}
