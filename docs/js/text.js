// Text cleanup, language detection, chunking and duration estimates (port of app/text_utils.py).

export const CHARS_PER_SECOND = { he: 12.5, en: 14.5 };
export const PARAGRAPH_PAUSE_SEC = 0.75;

export function detectLanguage(text) {
  const he = (text.match(/[֐-׿]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  return he > 0 && he >= en * 0.5 ? "he" : "en";
}

export function cleanText(text) {
  text = text.replace(/\r\n?/g, "\n").replace(/ /g, " ");
  text = text.replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]+\)/g, "$1");     // [label](url) -> label
  text = text.replace(/https?:\/\/\S+|www\.\S+/g, "");
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, "");
  text = text.replace(/(\*\*|__|\*|`|~~)/g, "");
  text = text.replace(/^[ \t]*[-*•●▪][ \t]+/gm, "");
  text = text.replace(/^\s*\|.*\|\s*$/gm, (m) => m.replace(/\|/g, ", ").replace(/^[, ]+|[, ]+$/g, ""));
  text = text.replace(/[\u{1F000}-\u{1FAFF}☀-➿️‍]/gu, "");
  text = text.replace(/([!?.])\1{2,}/g, "$1");
  text = text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export function paragraphs(text) {
  return paragraphBlocks(text).map((p) => p.text);
}

// Paragraphs, each flagged when it came from a line that looks like a heading.
function paragraphBlocks(text) {
  // A single newline in pasted text is usually a hard wrap, unless the line looks like a heading.
  const out = [];
  for (const block of text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    let cur = "";
    for (const ln of block.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const isHeading = ln.length < 40 && !/[.!?:,;…״׳"'”)\]]$/.test(ln);
      if (isHeading) {
        if (cur) out.push({ text: cur, heading: false });
        out.push({ text: /[.!?]$/.test(ln) ? ln : ln + ".", heading: true });
        cur = "";
      } else {
        cur = (cur + " " + ln).trim();
      }
    }
    if (cur) out.push({ text: cur, heading: false });
  }
  return out;
}

// Split on whitespace after sentence-final punctuation, keeping closing quotes/brackets attached.
const SENTENCE_RE = /(?:(?<=[.!?…])|(?<=[.!?…]["'״”)\]])|(?<=[.!?…]["'״”)\]]["'״”)\]]))\s+/;

export function splitSentences(text) {
  return text.split(SENTENCE_RE).map((s) => s.trim()).filter(Boolean);
}

function splitLong(sentence, maxChars) {
  if (sentence.length <= maxChars) return [sentence];
  const parts = [];
  let cur = "";
  const add = (piece) => {
    if (cur && cur.length + piece.length + 1 > maxChars) { parts.push(cur); cur = piece; }
    else cur = (cur + " " + piece).trim();
  };
  for (const piece of sentence.split(/(?<=[,;:–—])\s+/)) {
    if (piece.length <= maxChars) { add(piece); continue; }
    for (let word of piece.split(" ")) {
      while (word.length > maxChars) { add(word.slice(0, maxChars)); word = word.slice(maxChars); }
      add(word);
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Group paragraphs into chunks of about maxChars; each chunk is a list of paragraphs. */
export function chunkText(text, maxChars = 1600) {
  return chunkTextWithBreaks(text, maxChars).chunks;
}

// Silence placed between two recorded chunks, by what separates them in the text.
export const BREAK_PAUSE_SEC = { sentence: 0.35, paragraph: 0.7, section: 1.1 };

// A request may overrun maxChars by this much, so a tiny leftover never costs a whole request.
export const OVERRUN = 1.1;

/**
 * Even packing (twin of app/text_utils.py pack_even). sizes[i]: size of item i; pens[i]: how bad
 * it is to end a chunk after item i, in units of "10% off the target size". Picks the fewest chunks
 * that fit maxChars * OVERRUN, then the cut points where every chunk is closest to total / n and
 * the cuts are least bad. Returns [start, end) pairs. A single item may exceed the limit on its own.
 */
export function packEven(sizes, pens, maxChars) {
  const m = sizes.length;
  if (!m) return [];
  const limit = Math.floor(maxChars * OVERRUN);
  const pre = [0];
  for (const s of sizes) pre.push(pre[pre.length - 1] + s);
  const T = pre[m];
  const attempt = (n, slack) => {
    const par = [];
    let prev = new Array(m + 1).fill(Infinity);
    prev[0] = 0;
    for (let k = 1; k <= n; k++) {
      const cur = new Array(m + 1).fill(Infinity), from = new Array(m + 1).fill(-1);
      for (let j = k; j <= m - (n - k); j++) {
        if (Math.abs(pre[j] * n - k * T) > slack * n) continue;
        for (let i = j - 1; i >= k - 1; i--) {
          const size = pre[j] - pre[i];
          if (size > limit && j - i > 1) break;
          if (prev[i] === Infinity) continue;
          const d = n * size - T;
          const cost = prev[i] + 100 * d * d + (j < m ? pens[j - 1] * T * T : 0);
          if (cost < cur[j]) { cur[j] = cost; from[j] = i; }
        }
      }
      par.push(from);
      prev = cur;
    }
    if (prev[m] === Infinity) return null;
    const out = [];
    for (let k = n, j = m; k > 0; k--) { const i = par[k - 1][j]; out.unshift([i, j]); j = i; }
    return out;
  };
  for (let n = Math.max(1, Math.ceil(T / limit)); n < m; n++) {
    const r = attempt(n, 1.5 * limit) || attempt(n, Infinity);
    if (r) return r;
  }
  return sizes.map((_, i) => [i, i + 1]);
}

/**
 * The chunks of chunkText plus breaks[i]: what separates chunk i from chunk i+1 -
 * "sentence" (inside a paragraph), "paragraph", or "section" (chunk i+1 opens with a
 * heading). breaks.length === chunks.length - 1.
 *
 * Chunks are packed evenly (see packEven): n = fewest requests that fit, each about total / n,
 * cut at paragraph boundaries where possible, never right after a heading.
 */
export function chunkTextWithBreaks(text, maxChars = 1600) {
  const atoms = [];      // sentences, remembering the paragraph they came from
  paragraphBlocks(text).forEach(({ text: para, heading }, pi) => {
    const sents = splitSentences(para).flatMap((s) => splitLong(s, maxChars));
    sents.forEach((s, k) => atoms.push({ text: s, pi, para, heading, first: k === 0, count: sents.length }));
  });
  const sizes = atoms.map((a) => a.text.length + (a.first ? 2 : 1));   // + the separator that joins it
  const pens = atoms.slice(0, -1).map((a, i) => atoms[i + 1].pi === a.pi ? 4 : a.heading ? 30 : 0);
  const chunks = [], starts = [];
  for (const [i, j] of packEven(sizes, pens, maxChars)) {
    const chunk = [];
    for (let k = i; k < j;) {
      let e = k;
      while (e < j && atoms[e].pi === atoms[k].pi) e++;
      chunk.push(e - k === atoms[k].count ? atoms[k].para : atoms.slice(k, e).map((a) => a.text).join(" "));
      k = e;
    }
    chunks.push(chunk);
    starts.push(!atoms[i].first ? "sentence" : atoms[i].heading ? "section" : "paragraph");
  }
  return { chunks, breaks: starts.slice(1) };
}

/** Pause (seconds) after each chunk: the break kind's pause, and `endSec` after the last one. */
export function breakPauses(breaks, endSec = 0) {
  return [...breaks.map((b) => BREAK_PAUSE_SEC[b] ?? BREAK_PAUSE_SEC.paragraph), endSec];
}

// Conversation: the gap between two recorded batches of turns - longer when the next turn
// opens a new topic or is a long turn, so a batch cut doesn't sound like the hosts rush on.
export const TURN_GAP_SEC = 0.25, TOPIC_GAP_SEC = 0.5;
const LONG_TURN_CHARS = 280;
const END = "(?=[\\s,.!?:;—–-]|$)";
const TOPIC_START_RE = new RegExp(
  `^(?:(?:so|now|okay|ok|alright|anyway|right),|(?:moving on|next up|speaking of|turning to|let's (?:talk|move|turn|look|switch)` +
  `|another (?:thing|question|topic|point)|the next|finally|first of all|last but not least)${END}` +
  `|(?:אז|טוב|עכשיו|ועכשיו|אוקיי),|(?:בוא נדבר|בואי נדבר|בוא נעבור|בואי נעבור|נעבור|ונעבור|הנושא הבא|דבר נוסף|ולסיום|לסיום|קודם כל)${END})`, "i");

export function turnGapSec(prev, next) {
  if (!prev || !next) return TURN_GAP_SEC;
  const t = next.text.trim();
  return t.length >= LONG_TURN_CHARS || TOPIC_START_RE.test(t) ? TOPIC_GAP_SEC : TURN_GAP_SEC;
}

export function estimateSeconds(text, language) {
  text = cleanText(text);
  if (!text) return 0;
  return text.length / (CHARS_PER_SECOND[language] || 14) + paragraphs(text).length * PARAGRAPH_PAUSE_SEC;
}

export function formatDuration(seconds) {
  seconds = Math.floor(seconds + 0.05);   // floor like audio players do, so the numbers match
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
