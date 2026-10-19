// Podcast generation in the browser (port of app/jobs.py + app/script_writer.py).
import { cleanText, chunkText, chunkTextWithBreaks, breakPauses, BREAK_PAUSE_SEC, turnGapSec, splitSentences } from "./text.js";
import { podcastScriptPrompt, parseDialogue } from "./prompts.js";
import { Cancelled, ProviderError, QuotaExhausted, VOICES, withRetries } from "./gemini.js";
import * as A from "./audio.js";
import { writeTopicScript } from "./research.js";

const MAX_TAKES = 3;
const TARGET_LUFS = -16;
const LEAD_IN_SEC = 0.35, TAIL_SEC = 0.6;

export { Cancelled };

export function hostNames(language, g1, g2) {
  const names = { he: { female: ["Noa", "Maya"], male: ["Yoni", "Avi"] },
    en: { female: ["Emma", "Lily"], male: ["Jack", "Ben"] } }[language];
  const first = (names[g1] || names.female)[0];
  const pool = names[g2] || names.male;
  return [first, pool[0] === first ? pool[1] : pool[0]];
}

export function batchTurns(turns, maxChars) {
  const batches = [];
  let cur = [], size = 0;
  for (const t of turns) {
    const n = t.text.length + t.speaker.length + 3;
    if (cur.length && size + n > maxChars) { batches.push(cur); cur = []; size = 0; }
    cur.push(t); size += n;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

const halves = (a) => [a.slice(0, a.length >> 1), a.slice(a.length >> 1)];
const truncated = (p) => p.some((x) => x.startsWith("too short"));
const neverTruncated = (label) => new ProviderError(`${label}: the voice engine keeps cutting this passage short, ` +
  "so it was not recorded completely. Try again, or try another voice.");

function joinPcm(pcms, gap) {
  const out = [];
  pcms.forEach((p, i) => { out.push(A.fade(p)); if (i < pcms.length - 1) out.push(A.silence(gap)); });
  return A.concat(out);
}

async function pool(items, concurrency, worker, shouldStop) {
  let next = 0, failure = null;
  const run = async () => {
    while (next < items.length && !failure) {
      if (shouldStop()) throw new Cancelled();
      const i = next++;
      try { await worker(i, items[i]); } catch (e) {
        // A request already in flight used quota: let the others finish and save their parts.
        if (e instanceof QuotaExhausted) { failure ||= e; return; }
        failure = e; throw e;
      }
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, run));
  if (failure) throw failure;
  const bad = results.find((r) => r.status === "rejected");
  if (bad) throw bad.reason;
}

/**
 * job: { id, request, status, script, warnings, chunkChars }
 * ui:  { progress(fraction, stage), cancelled() }
 */
export async function runJob(job, gemini, ui) {
  const req = job.request;
  const gender = Object.fromEntries(VOICES.map((v) => [v.id, v.gender]));
  const v1 = req.voice, v2 = req.voice2 && req.voice2 !== v1 ? req.voice2 : VOICES.find((v) => v.id !== v1 && v.recommended).id;
  const genders = [gender[v1] || "female", gender[v2] || "male"];
  const opts = { language: req.language, style: req.style, pace: req.pace,
    hostNames: hostNames(req.language, genders[0], genders[1]), genders };
  gemini.gate.onWait = (s) => ui.progress(null, `Staying within the free tier: waiting ${Math.round(s)}s for the per-minute limit`);
  // A podcast from a topic: research the chosen focus and write the script first (saved, so resuming skips it).
  if (req.topic && !req.text) await writeTopicScript(job, gemini, ui, opts, (j) => A.store.saveJob(j));
  const text = cleanText(req.text);
  if (!text) throw new ProviderError("The text is empty after cleanup.");
  job.chunkChars ||= gemini.maxChunkChars;    // fixed on first run so resumed jobs line up

  async function bestTake(make, txt, label) {
    let best = null, bestProblems = null;
    for (let take = 0; take < MAX_TAKES; take++) {
      if (ui.cancelled()) throw new Cancelled();
      const { pcm, rate } = await withRetries(make);
      const clean = A.trimSilence(A.resample(pcm, rate));
      const problems = A.takeProblems(clean, txt, req.language);
      if (!problems.length) return [clean, []];
      if (!bestProblems || problems.length < bestProblems.length) { best = clean; bestProblems = problems; }
    }
    if (!truncated(bestProblems)) job.warnings.push(`${label}: kept best of ${MAX_TAKES} takes (${bestProblems.join("; ")})`);
    return [best, bestProblems];
  }

  let done = 0, units = [], pauses = [];    // pauses[i]: silence after part i
  const tick = (start, span) => { done++; ui.progress(start + span * done / units.length, `Recording voice: part ${done} of ${units.length}`); };

  async function record(i, makeAudio, start, span) {
    if (await A.store.hasPart(job.id, i)) { tick(start, span); return; }    // resumed: already recorded
    const pcm = await makeAudio();
    await A.store.putPart(job.id, i, A.fade(pcm));
    tick(start, span);
  }

  if (req.mode === "conversation") {
    if (!job.script) {
      const parts = chunkText(text, 6000).map((p) => p.join(" "));
      let turns = [];
      for (let i = 0; i < parts.length; i++) {
        ui.progress(0.02 + 0.25 * i / parts.length, `Writing the two-host script: part ${i + 1} of ${parts.length}`);
        const tail = turns.slice(-6).map((t) => `${t.speaker}: ${t.text}`).join("\n");
        const prompt = podcastScriptPrompt(parts[i], req.language, opts.hostNames, i + 1, parts.length, tail, genders);
        turns = turns.concat(await withRetries(async () => {
          const t = parseDialogue(await gemini.writeText(prompt), opts.hostNames);
          if (t.length < 2 || new Set(t.map((x) => x.speaker)).size < 2) {
            throw new ProviderError("Script writer returned an unusable dialogue", { retryable: true });
          }
          return t;
        }, 4));
      }
      job.script = turns;
      await A.store.saveJob(job);     // the script is kept, so resuming never re-writes it
    }
    const voices = { [opts.hostNames[0]]: v1, [opts.hostNames[1]]: v2 };
    units = batchTurns(job.script, job.chunkChars);
    pauses = units.map((b, i) => (i < units.length - 1 ? turnGapSec(b[b.length - 1], units[i + 1][0]) : TAIL_SEC));
    const speak = async (batch, label) => {
      const txt = batch.map((t) => t.text).join(" ");
      const [pcm, problems] = await bestTake(() => gemini.synthesizeDialogue(batch, voices, opts), txt, label);
      if (!truncated(problems)) return pcm;
      if (batch.length < 2) throw neverTruncated(label);
      const [a, b] = halves(batch);
      return joinPcm([await speak(a, label), await speak(b, label)], turnGapSec(a[a.length - 1], b[0]));
    };
    await pool(units, gemini.concurrency, (i, batch) => record(i, () => speak(batch, `Part ${i + 1}`), 0.28, 0.62),
      ui.cancelled);
  } else {
    const { chunks, breaks } = chunkTextWithBreaks(text, job.chunkChars);
    units = chunks;
    pauses = breakPauses(breaks, TAIL_SEC);
    const speak = async (txt, label, depth = 0) => {
      const [pcm, problems] = await bestTake(() => gemini.synthesize(txt, v1, opts), txt, label);
      if (!truncated(problems)) return pcm;
      const sentences = splitSentences(txt);
      if (depth >= 3 || sentences.length < 2) throw neverTruncated(label);
      const [a, b] = halves(sentences);      // shorter requests are cut off far less often
      return joinPcm([await speak(a.join(" "), label, depth + 1), await speak(b.join(" "), label, depth + 1)],
        BREAK_PAUSE_SEC.sentence);
    };
    await pool(units, gemini.concurrency, (i, paras) => record(i, () => speak(paras.join("\n\n"), `Part ${i + 1}`),
      req.topic ? 0.25 : 0.02, req.topic ? 0.65 : 0.88),
      ui.cancelled);
  }

  // ------------------------------------------------------------- mastering
  ui.progress(0.91, "Mastering audio (warmth EQ, loudness)");
  // Pass 1: master each part and measure its gated, K-weighted loudness.
  const meters = [];
  for (let i = 0; i < units.length; i++) {
    const { audio, kweighted } = await A.masterPart(await A.store.getPart(job.id, i));
    const m = new A.LoudnessMeter();
    m.add(kweighted);
    meters.push(m);
    await A.store.putPart(job.id, `m${i}`, audio);
  }
  // Nudge each part toward the episode median (+-3 dB), then one linear gain to the target.
  const partDb = A.matchPartGains(meters.map((m) => m.integratedDb()));
  const meter = new A.LoudnessMeter();
  meters.forEach((m, i) => meter.merge(m, partDb[i]));
  const gain = Math.min(4, 10 ** ((TARGET_LUFS - meter.integratedDb()) / 20));
  // Pass 2: gain, room tone and the look-ahead peak limiter happen in the encoder worker.
  const enc = A.startEncoder(96);
  const pad = (sec) => new Float32Array(Math.floor(A.SAMPLE_RATE * sec));
  enc.push(pad(LEAD_IN_SEC), 1);
  let samples = pad(LEAD_IN_SEC).length;
  for (let i = 0; i < units.length; i++) {
    ui.progress(0.94 + 0.05 * i / units.length, "Encoding MP3");
    const m = await A.store.getPart(job.id, `m${i}`);
    samples += m.length;
    enc.push(m, gain * A.dbToGain(partDb[i]));
    const p = pad(pauses[i] ?? TAIL_SEC);
    samples += p.length;
    enc.push(p, 1);
  }
  const blob = await enc.finish();
  await A.store.deleteParts(job.id);
  await A.store.putPart(job.id, "mp3", blob);
  return { blob, samplesDuration: samples / A.SAMPLE_RATE };
}
