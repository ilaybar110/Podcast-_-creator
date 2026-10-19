// Audio in the browser: take checks, trimming, warm mastering and MP3 encoding
// (port of app/audio.py + app/quality.py). Parts live in IndexedDB so long podcasts
// don't have to fit in a phone's memory, and paused jobs survive closing the page.
import { CHARS_PER_SECOND } from "./text.js";

export const SAMPLE_RATE = 24000;

export function resample(pcm, src, dst = SAMPLE_RATE) {
  if (src === dst || !pcm.length) return pcm;
  const n = Math.round(pcm.length * dst / src);
  const out = new Int16Array(n);
  const ratio = (pcm.length - 1) / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const x = i * ratio, j = Math.floor(x), f = x - j;
    out[i] = pcm[j] * (1 - f) + (pcm[Math.min(j + 1, pcm.length - 1)] || 0) * f;
  }
  return out;
}

function frameDb(pcm, win) {
  const n = Math.floor(pcm.length / win);
  const db = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * win; i < (f + 1) * win; i++) { const v = pcm[i] / 32768; s += v * v; }
    db[f] = 20 * Math.log10(Math.sqrt(s / win) + 1e-9);
  }
  return db;
}

/** Trim leading/trailing silence so the pauses we insert are consistent. */
export function trimSilence(pcm, thresholdDb = -45, keepSec = 0.06) {
  const win = SAMPLE_RATE * 0.02;
  const db = frameDb(pcm, win);
  let first = -1, last = -1;
  for (let i = 0; i < db.length; i++) if (db[i] > thresholdDb) { if (first < 0) first = i; last = i; }
  if (first < 0) return pcm.subarray(0, 0);
  const keep = SAMPLE_RATE * keepSec;
  return pcm.slice(Math.max(0, first * win - keep), Math.min(pcm.length, (last + 1) * win + keep));
}

export function fade(pcm, ms = 8) {
  const n = Math.min(Math.floor(SAMPLE_RATE * ms / 1000), pcm.length >> 1);
  const out = pcm.slice();
  for (let i = 0; i < n; i++) { const g = i / n; out[i] *= g; out[out.length - 1 - i] *= g; }
  return out;
}

export function silence(sec) { return new Int16Array(Math.floor(SAMPLE_RATE * sec)); }

export function concat(arrays) {
  const out = new Int16Array(arrays.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
}

/** Reasons to reject a synthesized take and ask for another one. */
export function takeProblems(pcm, text, language) {
  const problems = [];
  const duration = pcm.length / SAMPLE_RATE;
  const expected = text.length / (CHARS_PER_SECOND[language] || 14);
  if (duration < 0.4 * expected) problems.push(`too short (${duration.toFixed(1)}s for ~${Math.round(expected)}s of text) - likely truncated`);
  if (expected > 3 && duration > 2.6 * expected) problems.push(`too long (${duration.toFixed(1)}s for ~${Math.round(expected)}s of text)`);
  if (duration > 8) {
    const db = frameDb(pcm, SAMPLE_RATE * 0.01);
    const sorted = Float32Array.from(db).sort();
    const floor = sorted[Math.floor(sorted.length * 0.9)] - 30;
    let run = 0, longest = 0;
    for (const v of db) { run = v < floor ? run + 1 : 0; longest = Math.max(longest, run); }
    if (longest * 0.01 > 4) problems.push(`dead air of ${(longest * 0.01).toFixed(1)}s`);
  }
  return problems;
}

// ------------------------------------------------------------------ mastering
/** Gentle "radio warm" chain: rumble cut, low-mid body, softer sibilance, soft compression. */
export async function masterPart(pcm) {
  const ctx = new OfflineAudioContext(2, Math.max(1, pcm.length), SAMPLE_RATE);
  const buf = ctx.createBuffer(1, Math.max(1, pcm.length), SAMPLE_RATE);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = Object.assign(ctx.createBiquadFilter(), { type: "highpass" }); hp.frequency.value = 70;
  const body = Object.assign(ctx.createBiquadFilter(), { type: "peaking" }); body.frequency.value = 180; body.Q.value = 1; body.gain.value = 1.5;
  const harsh = Object.assign(ctx.createBiquadFilter(), { type: "peaking" }); harsh.frequency.value = 3200; harsh.Q.value = 1.2; harsh.gain.value = -1;
  const sibil = Object.assign(ctx.createBiquadFilter(), { type: "highshelf" }); sibil.frequency.value = 6500; sibil.gain.value = -1.5;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.ratio.value = 2.2; comp.attack.value = 0.015; comp.release.value = 0.18; comp.knee.value = 6;
  // Channel 0: the mastered audio. Channel 1: the same audio K-weighted (ITU-R BS.1770), used
  // only to measure loudness the way podcast platforms do.
  const merge = ctx.createChannelMerger(2);
  src.connect(hp).connect(body).connect(harsh).connect(sibil).connect(comp);
  comp.connect(merge, 0, 0);
  const kShelf = Object.assign(ctx.createBiquadFilter(), { type: "highshelf" }); kShelf.frequency.value = 1681; kShelf.gain.value = 4;
  const kHp = Object.assign(ctx.createBiquadFilter(), { type: "highpass" }); kHp.frequency.value = 38; kHp.Q.value = 0.5;
  comp.connect(kShelf).connect(kHp).connect(merge, 0, 1);
  merge.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return { audio: out.getChannelData(0), kweighted: out.getChannelData(1) };
}

/** Accumulates gated 400 ms block energy of K-weighted audio (EBU R128 gating) across parts. */
export class LoudnessMeter {
  constructor() { this.blocks = []; }
  add(samples) {
    const win = SAMPLE_RATE * 0.4;
    for (let i = 0; i + win <= samples.length; i += win) {
      let s = 0;
      for (let j = i; j < i + win; j++) s += samples[j] * samples[j];
      this.blocks.push(s / win);
    }
  }
  integratedDb() {
    const lufs = (e) => -0.691 + 10 * Math.log10(e + 1e-12);
    const abs = this.blocks.filter((e) => lufs(e) > -70);
    if (!abs.length) return -70;
    const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
    const rel = abs.filter((e) => lufs(e) > lufs(mean) - 10);
    return -0.691 + 10 * Math.log10(rel.reduce((a, b) => a + b, 0) / rel.length);
  }
}

export function startEncoder(kbps = 96) {
  const worker = new Worker(new URL("./encoder-worker.js", import.meta.url));
  worker.postMessage({ cmd: "init", rate: SAMPLE_RATE, kbps });
  return {
    push(samples, gain) { worker.postMessage({ cmd: "chunk", samples, gain }, [samples.buffer]); },
    finish() {
      return new Promise((resolve, reject) => {
        worker.onmessage = (e) => { worker.terminate(); resolve(new Blob(e.data.parts, { type: "audio/mpeg" })); };
        worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || "MP3 encoder failed")); };
        worker.postMessage({ cmd: "end" });
      });
    },
  };
}

// ------------------------------------------------------------------ storage
// One cached IndexedDB connection; if IndexedDB is unavailable (some private modes), the app can
// switch to an in-memory store: everything works, but a closed page can't be resumed.
let dbP = null;
function db() {
  dbP ||= new Promise((resolve, reject) => {
    const req = indexedDB.open("podcast-creator", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("jobs", { keyPath: "id" });
      req.result.createObjectStore("parts");
    };
    req.onsuccess = () => {
      const d = req.result;
      d.onversionchange = () => { d.close(); dbP = null; };     // another tab upgrades: let it
      d.onclose = () => { dbP = null; };                        // closed by the browser: reopen next time
      resolve(d);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("The browser's storage is blocked by another tab."));
  }).catch((e) => { dbP = null; throw e; });
  return dbP;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Storage write was aborted (the device may be out of space)."));
  });
}
const memory = { jobs: new Map(), parts: new Map() };
const copy = (v) => (typeof Blob !== "undefined" && v instanceof Blob) ? v : structuredClone(v);
const partKeys = (jobId) => IDBKeyRange.bound(`${jobId}/`, `${jobId}/￿`);
let persistent = true;
// Mastered audio is kept as 16-bit, scaled to its own peak (half the space of Float32, and far
// below audible: 96 dB of range before the final gain of at most +12 dB).
function packFloat(f) {
  let peak = 0;
  for (let i = 0; i < f.length; i++) { const a = Math.abs(f[i]); if (a > peak) peak = a; }
  const scale = peak || 1, data = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) data[i] = Math.round(f[i] / scale * 32767);
  return { scale, data };
}
function unpackFloat(v) {
  if (!v || v instanceof Float32Array) return v;          // jobs saved before the 16-bit format
  const out = new Float32Array(v.data.length), k = v.scale / 32767;
  for (let i = 0; i < out.length; i++) out[i] = v.data[i] * k;
  return out;
}
export const store = {
  get persistent() { return persistent; },
  /** Keep everything in memory from now on (IndexedDB unavailable). */
  useMemory() { persistent = false; },
  putPart: (jobId, i, v) => persistent ? tx("parts", "readwrite", (s) => s.put(v, `${jobId}/${i}`))
    : (memory.parts.set(`${jobId}/${i}`, copy(v)), Promise.resolve()),
  getPart: (jobId, i) => persistent ? tx("parts", "readonly", (s) => s.get(`${jobId}/${i}`))
    : Promise.resolve(memory.parts.has(`${jobId}/${i}`) ? copy(memory.parts.get(`${jobId}/${i}`)) : undefined),
  hasPart: async (jobId, i) => persistent ? (await tx("parts", "readonly", (s) => s.count(`${jobId}/${i}`))) > 0
    : memory.parts.has(`${jobId}/${i}`),
  putMastered: (jobId, i, float) => store.putPart(jobId, `m${i}`, packFloat(float)),
  getMastered: async (jobId, i) => unpackFloat(await store.getPart(jobId, `m${i}`)),
  saveJob: (job) => persistent ? tx("jobs", "readwrite", (s) => s.put(job))
    : (memory.jobs.set(job.id, copy(job)), Promise.resolve()),
  loadJob: (id) => persistent ? tx("jobs", "readonly", (s) => s.get(id))
    : Promise.resolve(memory.jobs.has(id) ? copy(memory.jobs.get(id)) : undefined),
  allJobs: () => persistent ? tx("jobs", "readonly", (s) => s.getAll())
    : Promise.resolve([...memory.jobs.values()].map(copy)),
  /** Delete a job's parts, except the named ones (e.g. ["mp3"]). */
  async deleteParts(jobId, keep = []) {
    const keepKeys = new Set(keep.map((k) => `${jobId}/${k}`));
    if (!persistent) {
      for (const k of [...memory.parts.keys()]) if (k.startsWith(`${jobId}/`) && !keepKeys.has(k)) memory.parts.delete(k);
      return;
    }
    if (!keepKeys.size) return tx("parts", "readwrite", (s) => s.delete(partKeys(jobId)));
    const keys = await tx("parts", "readonly", (s) => s.getAllKeys(partKeys(jobId)));
    await tx("parts", "readwrite", (s) => { for (const k of keys) if (!keepKeys.has(k)) s.delete(k); });
  },
  /**
   * Free space on start: drop every job's parts except those of `resumable` (a job that can still be
   * continued) and the MP3 of `finished`; drop job records that keep nothing. Previews are kept.
   */
  async cleanup({ resumable = null, finished = null } = {}) {
    const keepJobs = new Set([resumable, finished].filter(Boolean));
    const doomed = (k) => {
      const [id, part] = [k.slice(0, k.indexOf("/")), k.slice(k.indexOf("/") + 1)];
      return id !== "preview" && id !== resumable && !(id === finished && part === "mp3");
    };
    if (!persistent) {
      for (const k of [...memory.parts.keys()]) if (doomed(k)) memory.parts.delete(k);
      for (const id of [...memory.jobs.keys()]) if (!keepJobs.has(id)) memory.jobs.delete(id);
      return;
    }
    const keys = await tx("parts", "readonly", (s) => s.getAllKeys());
    const drop = keys.filter((k) => typeof k === "string" && doomed(k));
    if (drop.length) await tx("parts", "readwrite", (s) => { for (const k of drop) s.delete(k); });
    const ids = await tx("jobs", "readonly", (s) => s.getAllKeys());
    const old = ids.filter((id) => !keepJobs.has(id));
    if (old.length) await tx("jobs", "readwrite", (s) => { for (const id of old) s.delete(id); });
  },
};

/** Exact duration of an MP3 by walking its frames - what players report for the file. */
export async function mp3Duration(blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const KBPS1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const KBPS2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  let i = 0, seconds = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {            // skip an ID3v2 tag
    i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  }
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3;
    const br = (b[i + 2] >> 4) & 15, sr = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) { i++; continue; }   // Layer III only
    const rate = RATES[ver][sr];
    const kbps = (ver === 3 ? KBPS1 : KBPS2)[br];
    const samples = ver === 3 ? 1152 : 576;
    const size = Math.floor((samples / 8) * kbps * 1000 / rate) + pad;
    seconds += samples / rate;
    i += size;
  }
  return seconds;
}
