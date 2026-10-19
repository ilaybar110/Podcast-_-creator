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
  // A single newline in pasted text is usually a hard wrap, unless the line looks like a heading.
  const out = [];
  for (const block of text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    let cur = "";
    for (const ln of block.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const isHeading = ln.length < 40 && !/[.!?:,;…״׳"'”)\]]$/.test(ln);
      if (isHeading) {
        if (cur) out.push(cur);
        out.push(/[.!?]$/.test(ln) ? ln : ln + ".");
        cur = "";
      } else {
        cur = (cur + " " + ln).trim();
      }
    }
    if (cur) out.push(cur);
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

/** Group paragraphs into chunks of at most maxChars; each chunk is a list of paragraphs. */
export function chunkText(text, maxChars = 1600) {
  const chunks = [];
  let cur = [], curLen = 0;
  const flush = () => { if (cur.length) chunks.push(cur); cur = []; curLen = 0; };
  for (const para of paragraphs(text)) {
    if (para.length > maxChars) {
      flush();
      let piece = "";
      for (const sent of splitSentences(para)) {
        for (const s of splitLong(sent, maxChars)) {
          if (piece && piece.length + s.length + 1 > maxChars) { chunks.push([piece]); piece = s; }
          else piece = (piece + " " + s).trim();
        }
      }
      if (piece) { cur = [piece]; curLen = piece.length; }
      continue;
    }
    if (curLen + para.length + 1 > maxChars) flush();
    cur.push(para);
    curLen += para.length + 1;
  }
  flush();
  return chunks;
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
