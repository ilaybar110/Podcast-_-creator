// Node test for the pure audio/text functions of the web app (run by tests/test_app.py):
// trimming keeps breaths and tails, fades, room tone level, the look-ahead limiter, per-part
// loudness matching, pause kinds - and a synthetic episode checked numerically for clicks/clipping.
import assert from "node:assert/strict";
const A = await import(new URL("../docs/js/audio.js", import.meta.url));
const T = await import(new URL("../docs/js/text.js", import.meta.url));
const SR = A.SAMPLE_RATE;
const db = (x) => 20 * Math.log10(x + 1e-12);
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rand = globalThis.PodcastDSP.rng(7);

function tone(sec, amp, f = 220) {
  const out = new Float32Array(Math.round(SR * sec));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin(2 * Math.PI * f * i / SR);
  return out;
}
const toInt16 = (f) => Int16Array.from(f, (v) => Math.round(v * 32767));
const cat = (...xs) => { const o = new Float32Array(xs.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };

// ---------------------------------------------------------------- trim keeps pre-roll and tail
{
  const speech = tone(1, 0.3);
  const pcm = toInt16(cat(new Float32Array(SR), speech, new Float32Array(SR)));
  const out = A.trimSilence(pcm);
  const want = speech.length + Math.round(SR * 0.15) + Math.round(SR * 0.25);
  assert.ok(Math.abs(out.length - want) <= SR * 0.02, `trim length ${out.length} vs ${want}`);
  // the loud part starts after a 150 ms pre-roll
  const firstLoud = out.findIndex((v) => Math.abs(v) > 100);
  assert.ok(firstLoud >= SR * 0.13 && firstLoud <= SR * 0.17, `pre-roll ${firstLoud / SR}s`);
  // a soft ending right after the loud part (below the trim threshold) is kept
  const soft = tone(0.2, 10 ** (-52 / 20), 300);
  const out2 = A.trimSilence(toInt16(cat(new Float32Array(SR / 2), speech, soft, new Float32Array(SR))));
  const tail = out2.subarray(out2.length - Math.round(SR * 0.25));
  assert.ok(rms(Float32Array.from(tail, (v) => v / 32768)) > 10 ** (-60 / 20), "soft tail was clipped");
  assert.equal(A.trimSilence(new Int16Array(SR)).length, 0);
}

// ---------------------------------------------------------------- fades: smooth, end at zero
{
  const pcm = toInt16(tone(0.5, 0.5));
  const f = A.fade(pcm);
  assert.equal(f[0], 0);
  assert.ok(Math.abs(f[f.length - 1]) <= 1);
  assert.equal(A.FADE_OUT_MS, 30);
  // the 30 ms fade-out is still rising 20 ms before the end
  const n = Math.round(SR * 0.02);
  const envNear = peak(Float32Array.from(f.subarray(f.length - n - 50, f.length - n)));
  assert.ok(envNear < 0.5 * 32767 * 0.9 && envNear > 0.5 * 32767 * 0.2, `fade shape ${envNear}`);
}

// ---------------------------------------------------------------- room tone
{
  const t1 = new A.RoomTone(-65, 1234), t2 = new A.RoomTone(-65, 1234);
  const a = t1.fill(SR * 10), b = t2.fill(SR * 10);
  assert.deepEqual(a.subarray(0, 1000), b.subarray(0, 1000), "room tone must be deterministic");
  const level = db(rms(a));
  assert.ok(Math.abs(level + 65) < 0.75, `room tone at ${level.toFixed(2)} dBFS`);
  assert.ok(db(peak(a)) < -50, "room tone peaks stay far below speech");
  assert.ok(a.every((v) => Number.isFinite(v)));
  // no DC / rumble build-up: 1 s means stay tiny
  for (let s = 0; s < 10; s++) {
    const m = a.subarray(s * SR, (s + 1) * SR).reduce((x, y) => x + y, 0) / SR;
    assert.ok(Math.abs(m) < 10 ** (-80 / 20), `DC ${m}`);
  }
}

// ---------------------------------------------------------------- look-ahead peak limiter
{
  const ceil = 10 ** (-1 / 20);
  const lim = new A.PeakLimiter({ sampleRate: SR, ceilingDb: -1, lookaheadMs: 1.5, releaseMs: 80 });
  // speech-like noise with bursts up to +12 dB over full scale, fed in odd-sized chunks
  const x = new Float32Array(SR * 4);
  for (let i = 0; i < x.length; i++) {
    const burst = (i % 9000) < 400 ? 4 : 0.4;
    x[i] = (rand() * 2 - 1) * burst * Math.abs(Math.sin(i / 300));
  }
  const outs = [];
  for (let i = 0; i < x.length; i += 1777) outs.push(lim.process(x.subarray(i, i + 1777)));
  outs.push(lim.flush());
  const y = cat(...outs);
  assert.equal(y.length, x.length, "limiter keeps the length");
  assert.ok(peak(y) <= ceil + 1e-6, `limiter peak ${db(peak(y)).toFixed(3)} dBFS`);
  assert.ok(peak(y) > ceil * 0.95, "limiter should not over-squash");
  // a signal under the ceiling passes untouched (only delayed, and the delay is hidden)
  const quiet = tone(0.5, 0.5);
  const lim2 = new A.PeakLimiter({ sampleRate: SR });
  const q = cat(lim2.process(quiet), lim2.flush());
  for (let i = 0; i < quiet.length; i++) assert.ok(Math.abs(q[i] - quiet[i]) < 1e-6);
  // a gain step on a sine never produces a click: the output envelope moves smoothly
  const s = cat(tone(0.3, 0.5, 1000), tone(0.3, 2, 1000), tone(0.3, 0.5, 1000));
  const lim3 = new A.PeakLimiter({ sampleRate: SR });
  const z = cat(lim3.process(s), lim3.flush());
  assert.ok(peak(z) <= ceil + 1e-6);
  const maxStepIn = 2 * Math.PI * 1000 / SR * 0.5;          // steepest step of the clean sine at 0.5
  let worst = 0;
  for (let i = 1; i < z.length; i++) worst = Math.max(worst, Math.abs(z[i] - z[i - 1]));
  assert.ok(worst <= 2 * Math.PI * 1000 / SR * ceil * 1.05, `click: step ${worst} vs ${maxStepIn}`);
  // and the tiny input stays intact at the very end of a short stream
  const lim4 = new A.PeakLimiter({ sampleRate: SR });
  const tiny = Float32Array.from([0.1, 0.2, 0.3]);
  assert.deepEqual(Array.from(cat(lim4.process(tiny), lim4.flush()), (v) => +v.toFixed(5)), [0.1, 0.2, 0.3]);
}

// ---------------------------------------------------------------- per-part loudness matching
{
  assert.deepEqual(A.matchPartGains([-20, -23, -30, -10, -80]), [-1.5, 1.5, 3, -3, 0]);
  assert.deepEqual(A.matchPartGains([-70, -90]), [0, 0]);
  assert.deepEqual(A.matchPartGains([-18, -18, -18]), [0, 0, 0]);
  const g = A.matchPartGains([-14, -40, -22, -21]);
  assert.ok(g.every((v) => Math.abs(v) <= A.PART_MATCH_MAX_DB));
  // merging a meter with a gain moves the integrated loudness by exactly that gain
  const m = new A.LoudnessMeter();
  m.add(tone(4, 0.1, 1000));
  const both = new A.LoudnessMeter();
  both.merge(m, 6);
  assert.ok(Math.abs(both.integratedDb() - m.integratedDb() - 6) < 1e-6);
}

// ---------------------------------------------------------------- even packing
{
  const doc = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i}. ` + "A fairly long test sentence, with commas. ".repeat(i * 7 % 11 + 1)).join("\n\n");
  for (const max of [700, 1500, 4500]) {
    for (const n of [3, 12, 45, 90]) {
      const text = T.cleanText(doc(n));
      const { chunks, breaks } = T.chunkTextWithBreaks(text, max);
      const sizes = chunks.map((c) => c.join("\n\n").length), avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      assert.equal(breaks.length, chunks.length - 1);
      assert.ok(Math.max(...sizes) <= max * 1.1, `${max}/${n}: ${sizes}`);
      if (sizes.length > 1) assert.ok(Math.min(...sizes) >= 0.75 * avg, `tiny chunk ${max}/${n}: ${sizes}`);
      assert.equal(chunks.flat().join(" ").split(/\s+/).length, text.split(/\s+/).length, "nothing lost");
    }
  }
  assert.equal(T.chunkText("Word. ".repeat(780), 4500).length, 1, "10% slack saves a request");
  assert.deepEqual(T.chunkText("", 100), []);
  assert.deepEqual(T.packEven([10, 10, 10, 10], [0, 0, 0], 20), [[0, 2], [2, 4]]);
  assert.deepEqual(T.packEven([10, 10, 10, 10, 10], [0, 0, 9, 0], 30), [[0, 2], [2, 5]], "an expensive cut after item 3 moves the cut");
}

// ---------------------------------------------------------------- pause kinds
{
  const text = "Intro\n\n" + "First paragraph sentence here. ".repeat(10) + "\n\n" +
    "Second paragraph. ".repeat(16) + "\n\nChapter two\n\n" + "Long one, with words. ".repeat(40);
  const { chunks, breaks } = T.chunkTextWithBreaks(T.cleanText(text), 300);
  assert.deepEqual(chunks, T.chunkText(T.cleanText(text), 300));
  assert.equal(breaks.length, chunks.length - 1);
  assert.ok(breaks.includes("section") && breaks.includes("sentence") && breaks.includes("paragraph"), breaks.join());
  const sectionAt = breaks.indexOf("section");
  assert.equal(chunks[sectionAt + 1][0], "Chapter two.");
  const pauses = T.breakPauses(breaks, 0.6);
  assert.equal(pauses.length, chunks.length);
  assert.equal(pauses[sectionAt], 1.1);
  assert.equal(pauses.at(-1), 0.6);
  assert.deepEqual(T.BREAK_PAUSE_SEC, { sentence: 0.35, paragraph: 0.7, section: 1.1 });
  const turn = (text) => ({ speaker: "Noa", text });
  assert.equal(T.turnGapSec(turn("hi"), turn("Yes, exactly.")), 0.25);
  assert.equal(T.turnGapSec(turn("hi"), turn("So, what about sleep?")), 0.5);
  assert.equal(T.turnGapSec(turn("hi"), turn("Moving on to the next part.")), 0.5);
  assert.equal(T.turnGapSec(turn("hi"), turn("אז, בוא נדבר על שינה.")), 0.5);
  assert.equal(T.turnGapSec(turn("hi"), turn("בוא נדבר על שינה")), 0.5);
  assert.equal(T.turnGapSec(turn("hi"), turn("אזור הנוחות שלנו")), 0.25);
  assert.equal(T.turnGapSec(turn("hi"), turn("word ".repeat(80))), 0.5);
}

// ---------------------------------------------------------------- synthetic episode sanity check
{
  // Three "takes" at different loudness (harmonic tone + low-passed noise bursts) that start and
  // stop abruptly, like a cut-off TTS take, assembled the way job.js + the encoder worker do.
  const take = (amp, sec, plosive = 0) => {
    const out = new Float32Array(Math.round(SR * sec));
    let lp = 0;
    for (let i = 0; i < out.length; i++) {
      lp += 0.15 * ((rand() * 2 - 1) - lp);
      const burst = (i % 6000) < 1500 ? 1 : 0.2;
      const spike = i > SR && i < SR + 120 ? plosive : 0;    // a "plosive" that must be limited
      out[i] = spike * Math.sign(Math.sin(i / 7)) + amp * (0.6 * Math.sin(2 * Math.PI * 180 * i / SR) + 0.3 * Math.sin(2 * Math.PI * 360 * i / SR) + burst * lp);
    }
    return toInt16(out);
  };
  function assemble(withFade) {
    const parts = [take(0.06, 2), take(0.02, 2), take(0.2, 2, 0.9)].map((p) => (withFade ? A.fade(A.trimSilence(p)) : p));
    const meters = parts.map((p) => { const m = new A.LoudnessMeter(); m.add(Float32Array.from(p, (v) => v / 32768)); return m; });
    const partDb = A.matchPartGains(meters.map((m) => m.integratedDb()));
    const meter = new A.LoudnessMeter();
    meters.forEach((m, i) => meter.merge(m, partDb[i]));
    const gain = Math.min(4, 10 ** ((-16 - meter.integratedDb()) / 20));
    const lim = new A.PeakLimiter({ sampleRate: SR }), room = new A.RoomTone(-65, 1234);
    const pieces = [], gaps = [], seams = [];
    let pos = 0;
    const push = (samples, g) => {
      const x = Float32Array.from(samples, (v) => (samples instanceof Int16Array ? v / 32768 : v) * g + room.next());
      pieces.push(lim.process(x)); pos += x.length;
    };
    push(new Float32Array(SR * 0.35), 1);
    parts.forEach((p, i) => {
      seams.push(pos);
      push(p, gain * A.dbToGain(partDb[i]));
      seams.push(pos);
      const gap = [0.7, 1.1, 0.6][i];
      gaps.push([pos + SR * 0.05, pos + SR * gap - SR * 0.05]);
      push(new Float32Array(Math.floor(SR * gap)), 1);
    });
    pieces.push(lim.flush());
    return { ep: cat(...pieces), gaps, seams, partDb, gain };
  }
  const seamJump = ({ ep, seams }) => {
    let j = 0;
    for (const s of seams) for (let i = s - 48; i < s + 48; i++) j = Math.max(j, Math.abs(ep[i] - ep[i - 1]));
    return j;
  };
  const { ep, gaps, seams, partDb, gain } = assemble(true);
  assert.ok(peak(ep) <= 10 ** (-1 / 20) + 1e-6, "episode clips");
  const clicky = seamJump(assemble(false));
  const smooth = seamJump({ ep, seams });
  assert.ok(clicky > 0.05, `the click metric should catch an unfaded join (${clicky})`);
  assert.ok(smooth < 0.01 && smooth < clicky / 10, `click at a join: step ${smooth.toFixed(4)}`);
  for (const [a, b] of gaps) {
    const lvl = db(rms(ep.subarray(Math.round(a), Math.round(b))));
    assert.ok(lvl > -66 && lvl < -64, `gap level ${lvl.toFixed(1)} dBFS (room tone, not digital zero)`);
  }
  // loudness matching pulled the quiet and the loud take toward the middle one
  assert.deepEqual(partDb.map((v) => Math.sign(v)), [0, 1, -1]);
  console.log(`synthetic episode: peak ${db(peak(ep)).toFixed(2)} dBFS; join step ${smooth.toFixed(4)} ` +
    `(unfaded ${clicky.toFixed(3)}); part gains ${partDb.map((v) => v.toFixed(2)).join("/")} dB; master ${db(gain).toFixed(2)} dB`);
}
console.log("ok");
