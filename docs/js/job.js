// Podcast generation in the browser (port of app/jobs.py + app/script_writer.py).
import { cleanText, chunkText, chunkTextWithBreaks, breakPauses, BREAK_PAUSE_SEC, turnGapSec, splitSentences } from "./text.js";
import { prepareForSpeech } from "./speech.js";
import { podcastScriptPrompt, parseDialogue, stripTags } from "./prompts.js";
import { Cancelled, ProviderError, QuotaExhausted, VOICES, nextReset, withRetries } from "./gemini.js";
import * as A from "./audio.js";
import { writeTopicScript } from "./research.js";

// How many voice requests one passage may use. Free-only mode is frugal: a "too long" or "dead air"
// take is kept (with a warning), and a cut-off take is split into shorter requests at once.
const RETAKES = {
  free: { fullTakes: 2, splitTakes: 1, acceptSoft: true, splitEarly: true, maxDepth: 2, perPart: 6, perJob: 0.15 },
  paid: { fullTakes: 3, splitTakes: 2, acceptSoft: false, splitEarly: false, maxDepth: 3, perPart: 15, perJob: 1 },
};
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

// Batch boundaries (twin of app/script_writer.py batch_turns): once a batch is ~80% full it ends
// after a long statement; it never ends on a question or just before a short reaction, unless
// only that keeps it under maxChars.
const SOFT_FULL = 0.8, LONG_TURN = 60, SHORT_TURN = 25;
const turnSize = (t) => t.text.length + t.speaker.length + 3;
const goodEnd = (t) => { const w = stripTags(t.text); return w.length > LONG_TURN && /\.["'”’״)]*$/.test(w); };
const badSplit = (before, after) =>
  stripTags(before.text).replace(/["'”’״) ]+$/, "").endsWith("?") || stripTags(after.text).length < SHORT_TURN;

export function batchTurns(turns, maxChars) {
  const batches = [];
  let cur = [], size = 0;
  for (const t of turns) {
    const n = turnSize(t);
    if (cur.length && size + n > maxChars) {
      let cut = cur.length;
      if (badSplit(cur[cur.length - 1], t)) {     // look back for a better place that still fits
        let tail = n;
        for (let j = cur.length - 1; j > 0; j--) {
          tail += turnSize(cur[j]);
          if (tail > maxChars || size - tail + n < SOFT_FULL / 2 * maxChars) break;
          if (!badSplit(cur[j - 1], cur[j])) { cut = j; break; }
        }
      }
      batches.push(cur.slice(0, cut));
      cur = cur.slice(cut);
      size = cur.reduce((s, x) => s + turnSize(x), 0);
    } else if (cur.length && size >= SOFT_FULL * maxChars && goodEnd(cur[cur.length - 1]) && !badSplit(cur[cur.length - 1], t)) {
      batches.push(cur); cur = []; size = 0;
    }
    cur.push(t); size += n;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// What the voice reads: numbers/symbols spelled out (the saved and shown script stays as written).
const spokenTurns = (batch) => batch.map((t) => ({ ...t, text: prepareForSpeech(t.text) }));
const halves = (a) => [a.slice(0, a.length >> 1), a.slice(a.length >> 1)];
const truncated = (p) => p.some((x) => x.startsWith("too short"));
const neverTruncated = (label) => new ProviderError(`${label}: the voice engine keeps cutting this passage short, ` +
  "so it was not recorded completely. Continue to try again, or try another voice.");

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
  gemini.gate.onWait = (s, why) => ui.progress(null, why === "offline" ? "You are offline: waiting for the connection to come back"
    : `Staying within the free tier: waiting ${Math.round(s)}s for the per-minute limit`);
  // A podcast from a topic: research the chosen focus and write the script first (saved, so resuming skips it).
  if (req.topic && !req.text) await writeTopicScript(job, gemini, ui, opts, (j) => A.store.saveJob(j));
  const text = cleanText(req.text);
  if (!text) throw new ProviderError("The text is empty after cleanup.");
  if (!job.chunkChars) {                     // fixed on first run (and saved) so resumed jobs line up
    job.chunkChars = gemini.maxChunkChars;
    await A.store.saveJob(job);
  }

  // ------------------------------------------------------------- retake budget
  const policy = gemini.freeOnly ? RETAKES.free : RETAKES.paid;
  let extraUsed = 0, started = 0;
  // Free-only: today's voice requests left, as the free-tier guard counts them (Infinity if unknown).
  async function ttsLeft() {
    try {
      const g = gemini.gate, kid = await g.kidP;
      const left = g.ledger.limits(kid, "gemini_tts", g.overrides?.gemini_tts).rpd - g.ledger.used(kid, "gemini_tts");
      return Number.isFinite(left) ? left : Infinity;
    } catch { return Infinity; }
  }
  /** May this part make one more request beyond its first? Retakes never eat into first takes. */
  async function mayRetake(part) {
    if (part.requests >= policy.perPart) return false;
    if (extraUsed >= Math.max(3, Math.ceil(units.length * policy.perJob))) return false;
    if (gemini.freeOnly && (await ttsLeft()) - (units.length - started) <= 0) {
      throw new QuotaExhausted("Today's free voice requests are needed for the rest of the podcast; " +
        "the retake will be made after the reset.", nextReset());
    }
    return true;
  }

  /** Returns [pcm, problems]; problems is non-empty only for a take we decided to keep anyway. */
  async function bestTake(make, txt, label, part, { depth = 0, canSplit = false } = {}) {
    const maxTakes = depth ? policy.splitTakes : policy.fullTakes;
    let best = null, bestProblems = null, takes = 0;
    for (let take = 0; take < maxTakes; take++) {
      if (ui.cancelled()) throw new Cancelled();
      let res;
      try {
        if (part.requests && !(await mayRetake(part))) break;
        res = await withRetries(make);
      } catch (e) {
        // Out of quota on a retake: an earlier complete take is better than nothing.
        if (e instanceof QuotaExhausted && best && !truncated(bestProblems)) {
          job.warnings.push(`${label}: kept an earlier take, no quota left for a retake (${bestProblems.join("; ")})`);
          return [best, bestProblems];
        }
        throw e;
      }
      if (part.requests++) extraUsed++;
      takes++;
      const clean = A.trimSilence(A.resample(res.pcm, res.rate));
      const problems = A.takeProblems(clean, txt, req.language);
      if (!problems.length) return [clean, []];
      if (!bestProblems || problems.length < bestProblems.length) { best = clean; bestProblems = problems; }
      if (truncated(problems) ? policy.splitEarly && canSplit : policy.acceptSoft) break;
    }
    if (!best) throw neverTruncated(label);              // no budget left for even one take of this piece
    if (!truncated(bestProblems)) job.warnings.push(`${label}: kept best of ${takes} take${takes > 1 ? "s" : ""} (${bestProblems.join("; ")})`);
    return [best, bestProblems];
  }

  let done = 0, units = [], pauses = [];    // pauses[i]: silence after part i
  const tick = (start, span) => { done++; ui.progress(start + span * done / units.length, `Recording voice: part ${done} of ${units.length}`); };

  async function record(i, makeAudio, start, span) {
    started++;
    if (await A.store.hasPart(job.id, i)) { tick(start, span); return; }    // resumed: already recorded
    const pcm = await makeAudio({ requests: 0 });
    await A.store.putPart(job.id, i, A.fade(pcm));
    tick(start, span);
  }

  if (req.mode === "conversation") {
    if (!job.script) {
      const parts = chunkText(text, 6000).map((p) => p.join(" "));
      job.scriptPieces ||= [];          // each piece is saved as it is written, so resuming skips it
      for (let i = job.scriptPieces.length; i < parts.length; i++) {
        if (ui.cancelled()) throw new Cancelled();
        const turns = job.scriptPieces.flat();
        ui.progress(0.02 + 0.25 * i / parts.length, `Writing the two-host script: part ${i + 1} of ${parts.length}`);
        const tail = turns.slice(-6).map((t) => `${t.speaker}: ${t.text}`).join("\n");
        const prompt = podcastScriptPrompt(parts[i], req.language, opts.hostNames, i + 1, parts.length, tail, genders);
        job.scriptPieces.push(await withRetries(async () => {
          const t = parseDialogue(await gemini.writeText(prompt), opts.hostNames);
          if (t.length < 2 || new Set(t.map((x) => x.speaker)).size < 2) {
            throw new ProviderError("Script writer returned an unusable dialogue", { retryable: true });
          }
          return t;
        }, 4));
        await A.store.saveJob(job);
      }
      job.script = job.scriptPieces.flat();
      delete job.scriptPieces;
      await A.store.saveJob(job);     // the script is kept, so resuming never re-writes it
    }
    const voices = { [opts.hostNames[0]]: v1, [opts.hostNames[1]]: v2 };
    units = batchTurns(job.script, job.chunkChars);
    pauses = units.map((b, i) => (i < units.length - 1 ? turnGapSec(b[b.length - 1], units[i + 1][0]) : TAIL_SEC));
    const speak = async (batch, label, part, depth = 0) => {
      const txt = batch.map((t) => t.text).join(" ");
      const canSplit = batch.length > 1 && depth < policy.maxDepth;
      const [pcm, problems] = await bestTake(() => gemini.synthesizeDialogue(batch, voices, opts), txt, label, part, { depth, canSplit });
      if (!truncated(problems)) return pcm;
      if (!canSplit) throw neverTruncated(label);
      const [a, b] = halves(batch);
      return joinPcm([await speak(a, label, part, depth + 1), await speak(b, label, part, depth + 1)],
        turnGapSec(a[a.length - 1], b[0]));
    };
    await pool(units, gemini.concurrency, (i, batch) => record(i, (part) => speak(spokenTurns(batch), `Part ${i + 1}`, part), 0.28, 0.62),
      ui.cancelled);
  } else {
    const { chunks, breaks } = chunkTextWithBreaks(text, job.chunkChars);
    units = chunks;
    pauses = breakPauses(breaks, TAIL_SEC);
    const speak = async (txt, label, part, depth = 0) => {
      const sentences = splitSentences(txt);
      const canSplit = sentences.length > 1 && depth < policy.maxDepth;
      const [pcm, problems] = await bestTake(() => gemini.synthesize(txt, v1, opts), txt, label, part, { depth, canSplit });
      if (!truncated(problems)) return pcm;
      if (!canSplit) throw neverTruncated(label);
      const [a, b] = halves(sentences);      // shorter requests are cut off far less often
      return joinPcm([await speak(a.join(" "), label, part, depth + 1), await speak(b.join(" "), label, part, depth + 1)],
        BREAK_PAUSE_SEC.sentence);
    };
    await pool(units, gemini.concurrency, (i, paras) => record(i, (part) => speak(prepareForSpeech(paras.join("\n\n")), `Part ${i + 1}`, part),
      req.topic ? 0.25 : 0.02, req.topic ? 0.65 : 0.88),
      ui.cancelled);
  }

  // ------------------------------------------------------------- mastering
  ui.progress(0.91, "Mastering audio (warmth EQ, loudness)");
  // Pass 1: master each part and measure its gated, K-weighted loudness.
  const meters = [];
  for (let i = 0; i < units.length; i++) {
    if (ui.cancelled()) throw new Cancelled();
    const { audio, kweighted } = await A.masterPart(await A.store.getPart(job.id, i));
    const m = new A.LoudnessMeter();
    m.add(kweighted);
    meters.push(m);
    await A.store.putMastered(job.id, i, audio);
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
    if (ui.cancelled()) throw new Cancelled();
    ui.progress(0.94 + 0.05 * i / units.length, "Encoding MP3");
    const m = await A.store.getMastered(job.id, i);
    samples += m.length;
    enc.push(m, gain * A.dbToGain(partDb[i]));
    const p = pad(pauses[i] ?? TAIL_SEC);
    samples += p.length;
    enc.push(p, 1);
  }
  const blob = await enc.finish();
  // MP3 first, then mark done, then free the parts: a crash in between never loses the podcast.
  await A.store.putPart(job.id, "mp3", blob);
  job.status = "done";
  await A.store.saveJob(job);
  await A.store.deleteParts(job.id, ["mp3"]);
  return { blob, samplesDuration: samples / A.SAMPLE_RATE };
}
