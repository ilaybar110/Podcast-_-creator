// Node test for docs/js/job.js (run by tests/test_app.py): a whole podcast with a fake Gemini, an
// in-memory store and stand-ins for the browser's audio context and MP3 worker. Covers the retake
// budget, keeping a take when the quota runs out, and continuing a job that failed.
import assert from "node:assert/strict";

// --- browser stand-ins: any audio node/param works, rendering returns the input unchanged
const param = () => new Proxy({ value: 0 }, { get: (t, k) => (k in t ? t[k] : () => {}) });
const node = () => new Proxy({}, {
  get: (t, k) => k === "connect" ? (x) => x || node() : k in t ? t[k]
    : (t[k] = ["start", "stop", "disconnect"].includes(k) ? () => {} : param()),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.OfflineAudioContext = class {
  constructor(channels) {
    this.channels = channels; this.destination = node();
    return new Proxy(this, { get: (t, k) => (k in t ? t[k] : String(k).startsWith("create") ? () => node() : undefined) });
  }
  createBuffer(c, len) { const ch = Array.from({ length: c }, () => new Float32Array(len)); return (this.buf = { getChannelData: (i) => ch[i] }); }
  createBufferSource() { return node(); }
  async startRendering() { const d = this.buf.getChannelData(0); return { getChannelData: () => d.slice() }; }
};
globalThis.Worker = class {
  postMessage(m) { if (m.cmd === "end") setTimeout(() => this.onmessage({ data: { parts: [new Uint8Array([0xff, 0xf3, 1, 2])] } })); }
  terminate() {}
};

const A = await import(new URL("../docs/js/audio.js", import.meta.url));
const { batchTurns, runJob } = await import(new URL("../docs/js/job.js", import.meta.url));
const { ProviderError, QuotaExhausted } = await import(new URL("../docs/js/gemini.js", import.meta.url));
A.store.useMemory();

/** take(txt, call) -> length factor (1 = fine, 0.2 = cut off, 3 = too long) or an Error to throw. */
function fakeGemini({ freeOnly = true, take = () => 1, write = null, rpd = null } = {}) {
  const calls = { tts: 0, text: 0 };
  const audio = (txt) => {
    const f = take(txt, calls.tts++);
    if (f instanceof Error) throw f;
    const n = Math.round(txt.length / 14.5 * f * A.SAMPLE_RATE);
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) pcm[i] = Math.round(8000 * Math.sin(i / 7));
    return { pcm, rate: A.SAMPLE_RATE };
  };
  const gate = rpd == null ? {} : { kidP: Promise.resolve("k"), overrides: {},
    ledger: { limits: () => ({ rpd }), used: () => calls.tts } };
  return {
    calls, freeOnly, gate, maxChunkChars: 200, concurrency: 1,
    async synthesize(txt) { return audio(txt); },
    async synthesizeDialogue(batch) { return audio(batch.map((t) => t.text).join(" ")); },
    async writeText(prompt) {
      const n = calls.text++;
      if (write) { const r = write(n); if (r instanceof Error) throw r; }
      return Array.from({ length: 6 }, (_, i) => `${i % 2 ? "Jack" : "Emma"}: Line ${n}.${i} about how memory ` +
        "shapes the stories we tell ourselves every single day.").join("\n");
    },
  };
}
const ui = { progress() {}, cancelled: () => false };
const sentence = (i) => `This is sentence number ${i} about memory. `;
let n = 0;
function newJob(text, mode = "narrator") {
  return { id: `job${n++}`, status: "running", warnings: [], script: null,
    request: { text, topic: null, language: "en", mode, voice: "Sulafat", voice2: "Achird", style: "warm", pace: "natural", title: "T" } };
}

// 16-bit mastered parts read back close to the original, peaks above 1 included
const f = Float32Array.from({ length: 1000 }, (_, i) => 1.3 * Math.sin(i / 5));
await A.store.putMastered("x", 0, f);
const back = await A.store.getMastered("x", 0);
assert.ok(back.every((v, i) => Math.abs(v - f[i]) < 1e-4));

// free-only: a cut-off take is split at once (1 full + 2 halves), not retaken 3 times first
let g = fakeGemini({ take: (txt) => (txt.length > 120 ? 0.2 : 1) });
let job = newJob([1, 2, 3, 4].map(sentence).join(""));
await runJob(job, g, ui);
assert.equal(g.calls.tts, 3);
assert.equal(job.status, "done");
assert.ok(await A.store.getPart(job.id, "mp3"), "the MP3 is kept");
assert.equal(await A.store.hasPart(job.id, 0), false, "parts are freed after the MP3 is saved");
assert.equal((await A.store.loadJob(job.id)).status, "done");

// free-only: a "too long" take is kept with a warning instead of retaken
g = fakeGemini({ take: () => 3 });
job = newJob([1, 2].map(sentence).join(""));
await runJob(job, g, ui);
assert.equal(g.calls.tts, 1);
assert.match(job.warnings.join(" "), /kept best of 1 take .*too long/);

// free-only: a passage that is always cut off stops within the per-part budget
g = fakeGemini({ take: () => 0.2 });
job = newJob([1, 2, 3, 4, 5, 6, 7, 8].map(sentence).join("").slice(0, 190));
await assert.rejects(runJob(job, g, ui), (e) => e instanceof ProviderError && !(e instanceof QuotaExhausted) && /cutting/.test(e.message));
assert.ok(g.calls.tts <= 6, `used ${g.calls.tts} requests`);

// free-only: retakes never eat the requests the other parts still need today -> pause instead
g = fakeGemini({ take: () => 0.2, rpd: 2 });
job = newJob([1, 2, 3, 4, 5, 6, 7, 8].map(sentence).join(""));
await assert.rejects(runJob(job, g, ui), QuotaExhausted);
assert.equal(g.calls.tts, 1);

// out of quota on a retake: the earlier complete take is kept
g = fakeGemini({ freeOnly: false, take: (txt, i) => (i === 0 ? 3 : new QuotaExhausted("none left", new Date())) });
job = newJob([1, 2].map(sentence).join(""));
await runJob(job, g, ui);
assert.equal(job.status, "done");
assert.match(job.warnings.join(" "), /kept an earlier take/);
// ...but a cut-off take is not kept: the job pauses
g = fakeGemini({ freeOnly: false, take: (txt, i) => (i === 0 ? 0.2 : new QuotaExhausted("none left", new Date())) });
await assert.rejects(runJob(newJob([1, 2].map(sentence).join("")), g, ui), QuotaExhausted);

// paid: conversation splits are capped too (single turns can't be split further)
g = fakeGemini({ freeOnly: false, take: () => 0.2 });
await assert.rejects(runJob(newJob("Some text about memory. ".repeat(20), "conversation"), g, ui), /cutting/);
assert.ok(g.calls.tts <= 15 + 1, `used ${g.calls.tts} requests`);

// a failed job continues after a reload: written script pieces and recorded parts are not redone
const long = Array.from({ length: 8 }, (_, p) => `Paragraph ${p}. ` + "Memory is how we keep the past with us. ".repeat(22)).join("\n\n");
job = newJob(long, "conversation");
g = fakeGemini({ write: (i) => (i === 1 ? new ProviderError("writer broke") : null) });
await assert.rejects(runJob(job, g, ui), /writer broke/);
let saved = await A.store.loadJob(job.id);           // what a reloaded page sees
assert.equal(saved.scriptPieces.length, 1);
assert.ok(saved.chunkChars > 0);
g = fakeGemini({ take: (txt, i) => (i === 2 ? new ProviderError("voice broke") : 1) });
await assert.rejects(runJob(saved, g, ui), /voice broke/);
assert.equal(g.calls.text, 1, "only the missing script piece is written");
assert.equal(g.calls.tts, 3);
saved = await A.store.loadJob(job.id);
assert.equal(saved.script.length, 12);
assert.equal(await A.store.hasPart(job.id, 1), true);
g = fakeGemini();
const { blob } = await runJob(saved, g, ui);
assert.equal(g.calls.text, 0);
assert.ok(blob.size > 0);
assert.equal((await A.store.loadJob(job.id)).status, "done");
assert.equal(g.calls.tts, batchTurns(saved.script, saved.chunkChars).length - 2, "recorded parts are skipped");

// start-up cleanup: only the resumable job's parts and the latest MP3 (and previews) survive
await A.store.putPart("old", 0, new Int16Array(4));
await A.store.putPart("old", "mp3", new Uint8Array(1));
await A.store.putPart("keep", 0, new Int16Array(4));
await A.store.putPart("preview", "Sulafat|en", new Uint8Array(1));
await A.store.saveJob({ id: "old", status: "done" });
await A.store.saveJob({ id: "keep", status: "error" });
await A.store.cleanup({ resumable: "keep", finished: job.id });
assert.equal(await A.store.hasPart("old", "mp3"), false);
assert.equal(await A.store.hasPart("old", 0), false);
assert.equal(await A.store.hasPart("keep", 0), true);
assert.equal(await A.store.hasPart("preview", "Sulafat|en"), true);
assert.equal(await A.store.hasPart(job.id, "mp3"), true);
assert.equal(await A.store.loadJob("old"), undefined);
console.log("ok");
