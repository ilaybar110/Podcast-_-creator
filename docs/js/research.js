// "Podcast from a topic": find sources on the web, offer focus options, then write an in-depth
// script of the chosen length. Kept cheap on purpose:
//   research   = 1 Google-Search request (free on Gemini 2.5 Flash) + Wikipedia (free, no key)
//   generation = 1 Google-Search deep dive + 1 script request per ~12 minutes of audio
// Only the voice recording itself uses the small daily voice quota.
import { CHARS_PER_SECOND } from "./text.js";
import { DATA } from "./prompts_data.js";
import { parseDialogue, conversationCraft, stripTags, NARRATION_CRAFT } from "./prompts.js";
import { Cancelled, ProviderError, QuotaExhausted, withRetries } from "./gemini.js";

export const WORDS_PER_MINUTE = { he: 125, en: 150 };
export const WORDS_PER_PART = 1800;               // longer scripts are written in parts
const WIKI_CHARS = 5000, NOTES_CHARS = 30000;
const LANG_NAME = { he: "Hebrew", en: "English" };
const SPOKEN = { he: "modern, colloquial Israeli Hebrew (עברית מדוברת, טבעית)", en: "natural, conversational English" };

export const scriptParts = (minutes, language) =>
  Math.max(1, Math.ceil(minutes * (WORDS_PER_MINUTE[language] || 140) / WORDS_PER_PART));

/** Characters of speech for `minutes` of audio (what the voice engine will read). */
export const speechChars = (minutes, language) => Math.round(minutes * 60 * (CHARS_PER_SECOND[language] || 14));

/** Requests a topic podcast needs, for the free-quota badge. */
export function topicPlan(minutes, language, mode, chunkChars) {
  const chars = speechChars(minutes, language) * (mode === "conversation" ? 1.1 : 1);   // + speaker labels
  // Even packing (text.js packEven) fills requests to ~95% of the chunk size on average.
  return { gemini_tts: Math.ceil(chars / (DATA.FILL_FACTOR * chunkChars)), gemini_text: scriptParts(minutes, language), gemini_search: 1 };
}

// ------------------------------------------------------------------ Wikipedia (free)
async function wikiSearch(topic, lang, n, fetchFn) {
  const api = `https://${lang}.wikipedia.org/w/api.php?origin=*&format=json&formatversion=2`;
  const s = await (await fetchFn(`${api}&action=query&list=search&srlimit=${n}&srsearch=${encodeURIComponent(topic)}`)).json();
  const titles = (s.query?.search || []).map((x) => x.title);
  const pages = await Promise.all(titles.map(async (title) => {
    const r = await (await fetchFn(`${api}&action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`)).json();
    const text = (r.query?.pages?.[0]?.extract || "").replace(/\n{3,}/g, "\n\n").trim();
    return { title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      text: text.slice(0, WIKI_CHARS), wiki: true };
  }));
  return pages.filter((p) => p.text.length > 200);
}

export async function wikipedia(topic, language, fetchFn = (...a) => fetch(...a)) {
  const langs = language === "he" ? [["he", 2], ["en", 1]] : [["en", 3]];
  const found = await Promise.all(langs.map(([l, n]) => wikiSearch(topic, l, n, fetchFn).catch(() => [])));
  return found.flat();
}

// ------------------------------------------------------------------ prompts
const today = () => new Date().toISOString().slice(0, 10);
const wikiBlock = (pages) => pages.length
  ? "\nBACKGROUND FROM WIKIPEDIA (use it, but check it and go further):\n" +
    pages.map((p) => `--- ${p.title}\n${p.text}`).join("\n\n") + "\n" : "";

export function researchPrompt(topic, language, wikiPages, searching = true) {
  const L = LANG_NAME[language];
  return `You are the research producer of an award-winning, in-depth podcast. Today is ${today()}.
TOPIC: ${topic}
${searching ? "Search the web for solid, reputable and up-to-date sources on this topic (several searches, different angles)." :
    "Work from the background material below and your own reliable knowledge."}
${wikiBlock(wikiPages)}
Then return ONLY one valid JSON object, no markdown fences (inside strings write Hebrew acronyms with ״,
never a bare "):
{"title": "a catchy episode title in ${L}",
 "summary": "2 sentences in ${L}: what the topic is and why it matters",
 "angles": [ {"title": "2-6 words in ${L}", "description": "one sentence in ${L}: what this focus explores"} ],
 "notes": "detailed research notes in English"}

"angles": 6 genuinely different directions an expert episode could focus on (for example history and
origins, how it works, the people involved, controversy and debate, numbers and impact, latest
developments, what is next, practical lessons) - chosen for THIS topic, specific, not generic.
"notes": 900-1500 words of dense, accurate facts: key concepts, dates, names (also in their original
spelling), numbers, causes and effects, competing views, surprising details and recent news. Only state
what the sources support.`;
}

export function deepDivePrompt(topic, focus, notes, language, parts, searching = true) {
  return `You are the research producer of an award-winning, in-depth podcast. Today is ${today()}.
TOPIC: ${topic}
THE LISTENER CHOSE TO FOCUS ON:
${focus.map((f) => `- ${f}`).join("\n")}

${searching ? "Search the web to research exactly these focus areas in depth" : "Research exactly these focus areas in depth"}:
mechanisms and explanations, concrete examples and stories, numbers, expert opinions, debates and
counter-arguments, common misconceptions, recent developments and what they mean.

EARLIER NOTES:
${notes.slice(0, NOTES_CHARS)}

Return ONLY one valid JSON object, no markdown fences (inside strings write Hebrew acronyms with ״,
never a bare "):
{"notes": "${Math.min(3500, 1000 + 500 * parts)}-${Math.min(4500, 1600 + 600 * parts)} words of new, deeper research notes in English on the chosen focus",
 "outline": [ ${parts} strings - the episode's segments in order, each one sentence in English ]}`;
}

export function topicScriptPrompt({ topic, focus, notes, language, mode, hosts, genders, words, part, parts, segment, covered = [], tail }) {
  const [a, b] = hosts;
  const who = { female: "woman", male: "man" };
  const two = mode === "conversation";
  const position = [
    part === 1 ? (two ? `This is the START: ${a} opens with a short, warm welcome, introduces ${b} and hooks the listener with why this topic matters.`
      : "This is the START: open with a short, warm welcome and a hook - why this topic matters.")
      : "This continues an episode already in progress: do NOT greet or re-introduce anything; continue naturally.",
    part === parts ? "This is the END: finish with the key takeaways and a short, warm goodbye."
      : "Do NOT wrap up or say goodbye - the episode continues after this part.",
  ].join(" ");
  const format = two
    ? `Output ONLY dialogue lines, one turn per line, in exactly this format:\n${a}: ...\n${b}: ...`
    : "Output ONLY the words the narrator says, as plain paragraphs (no headings, no lists).";
  return `You write ${two ? "a top-rated two-host podcast" : "a top-rated solo podcast"} known for depth and insight.
Write ${two ? `a natural, engaging conversation between ${a} (a ${who[genders[0]]}) and ${b} (a ${who[genders[1]]})` :
    "the narration of one warm, knowledgeable host"} in ${SPOKEN[language]}.${language === "he" && !two ? " Use correct Hebrew gender forms." : ""}

TOPIC: ${topic}
FOCUS (the listener chose this): ${focus.join("; ")}
${segment ? `THIS PART COVERS: ${segment}\n` : ""}${covered.length ? `EARLIER PARTS ALREADY COVERED (do not repeat them): ${covered.join(" | ")}\n` : ""}
Make it a HIGH-LEVEL episode, not a summary:
- Explain the why and the how, not just the what. Connect ideas, causes and consequences.
- Use concrete examples, stories, names and numbers from the research. Present competing views fairly.
- Bust a misconception or two, and give the listener insights they would not get from a quick search.
- Use ONLY facts supported by the research notes. If something is uncertain, say so or leave it out.
- It must sound spoken, not read: clear short sentences, ${two ? "real reactions, follow-up questions, light humour" : "rhetorical questions, a warm personal tone"}.
- No URLs, no citation marks, no stage directions, no sound effects, no markdown, no emojis.
${two ? conversationCraft(language, hosts) : NARRATION_CRAFT[language]}
- ${position}
- LENGTH: this part must be about ${words} words. That length matters - do not stop early.
- Part ${part} of ${parts}.
${tail ? `\nThe episode so far ended with:\n${tail}\n` : ""}
${format}

RESEARCH NOTES:
${notes}
`;
}

// ------------------------------------------------------------------ parsing
export function parseJson(raw) {
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  const body = raw.slice(s, e + 1);
  // Hebrew acronyms (צה"ל, ארה"ב) put a bare quote inside a string: swap it for the Hebrew gershayim.
  for (const text of [body, body.replace(/([\u0590-\u05FF])"(?=[\u0590-\u05FF])/g, "$1״")]) {
    try { return JSON.parse(text); } catch { /* try the repaired text */ }
  }
  return null;
}

/** Parse the research JSON; if it is malformed, one cheap text request reformats it (no new search). */
async function researchJson(raw, gemini) {
  const d = parseJson(raw);
  if (d?.angles?.length) return d;
  const fixed = parseJson(await gemini.writeText("Rewrite the following as ONE valid JSON object with the keys title, " +
    "summary, angles (list of {title, description}) and notes. Keep all the content and language. Output only the JSON.\n\n" + raw));
  if (!fixed?.angles?.length) throw new ProviderError("The research came back in an unexpected format. Try again.", { msg: { key: "e_researchFormat" } });
  return fixed;
}
const noFreeSearch = (e) => e instanceof QuotaExhausted || (e instanceof ProviderError && !e.retryable);

function mergeSources(...lists) {
  const seen = new Set(), out = [];
  for (const s of lists.flat()) {
    if (!/^https?:\/\//i.test(s.url || "")) continue;
    const k = s.url;
    if (seen.has(k)) continue;
    seen.add(k); out.push({ title: s.title, url: s.url });
  }
  return out;
}

export function cleanNarration(raw) {
  return raw.split("\n").map((l) => l.replace(/^#+\s*|[*_`]/g, "").replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim())
    .filter((l) => l && !/^(part|חלק)\s*\d/i.test(l)).join("\n\n");
}

// ------------------------------------------------------------------ steps
/**
 * Step 1 (button "Find sources"): one Google-Search request + Wikipedia.
 * Returns { topic, language, title, summary, angles, notes, sources, searched }.
 */
export async function research(topic, language, gemini, { fetchFn } = {}) {
  topic = topic.trim();
  if (!topic) throw new ProviderError("Write a topic first.", { msg: { key: "e_needTopic" } });
  const wiki = await wikipedia(topic, language, fetchFn);
  let res = null, searched = true;
  try {
    res = await withRetries(() => gemini.searchText(researchPrompt(topic, language, wiki)), 3);
  } catch (e) {
    // No free Google Search today (or on this key): research from Wikipedia instead.
    if (!noFreeSearch(e)) throw e;
    if (!wiki.length) throw e instanceof QuotaExhausted ? e : new ProviderError(`Could not find sources: ${e.message}`, { msg: e.msg || { key: "e_noSources" } });
    searched = false;
  }
  const raw = res ? res.text : await withRetries(() => gemini.writeText(researchPrompt(topic, language, wiki, false)), 3);
  const data = await researchJson(raw, gemini);
  const sources = res ? res.sources : [];
  const angles = data.angles.filter((x) => x?.title).slice(0, 8)
    .map((x, i) => ({ id: `a${i}`, title: String(x.title), description: String(x.description || "") }));
  const notes = [String(data.notes || ""), wiki.map((p) => `[Wikipedia: ${p.title}]\n${p.text}`).join("\n\n")]
    .filter(Boolean).join("\n\n").slice(0, NOTES_CHARS);
  return { topic, language, title: String(data.title || topic), summary: String(data.summary || ""), angles, notes,
    sources: mergeSources(sources, wiki), searched };
}

/**
 * Step 2 (part of "Create podcast"): deep dive on the chosen focus, then the script.
 * Saves progress on the job, so a paused or interrupted job never repeats a request.
 */
export async function writeTopicScript(job, gemini, ui, opts, saveJob) {
  const req = job.request, tp = req.topic;
  const parts = scriptParts(tp.minutes, req.language);
  const focus = tp.focus.length ? tp.focus : [tp.topic];
  const stop = () => { if (ui.cancelled?.()) throw new Cancelled(); };
  if (!job.deep) {
    stop();
    ui.progress(0.02, { key: "p_researchDeep" });
    try {
      const r = await withRetries(() => gemini.searchText(deepDivePrompt(tp.topic, focus, tp.notes, req.language, parts)), 3);
      const d = parseJson(r.text) || { notes: r.text };
      job.deep = { notes: String(d.notes || ""), outline: Array.isArray(d.outline) ? d.outline.map(String) : [], sources: r.sources };
    } catch (e) {
      if (!noFreeSearch(e)) throw e;          // a passing network error: nothing saved, a retry searches again
      job.deep = { notes: "", outline: [], sources: [] };        // the first research is enough
      job.warnings.push({ key: "w_deepOff" });
    }
    job.sources = mergeSources(tp.sources, job.deep.sources);
    await saveJob(job);
  }
  const notes = `${job.deep.notes}\n\n${tp.notes}`.slice(0, NOTES_CHARS);
  const words = Math.round(tp.minutes * (WORDS_PER_MINUTE[req.language] || 140) / parts);
  job.written ||= [];
  for (let i = job.written.length; i < parts; i++) {
    stop();
    ui.progress(0.04 + 0.2 * i / parts, { key: "p_writeScript", n: i + 1, total: parts });
    const prev = job.written.flat();
    const tail = req.mode === "conversation"
      ? prev.slice(-6).map((t) => `${t.speaker}: ${t.text}`).join("\n")
      : prev.slice(-2).map((t) => t.text).join("\n");
    const prompt = topicScriptPrompt({ topic: tp.topic, focus, notes, language: req.language, mode: req.mode,
      hosts: opts.hostNames, genders: opts.genders, words, part: i + 1, parts, segment: job.deep.outline[i] || "",
      covered: job.deep.outline.slice(0, i), tail });
    const piece = await withRetries(async () => {
      const raw = await gemini.writeText(prompt);
      if (req.mode === "conversation") {
        const t = parseDialogue(raw, opts.hostNames);
        if (t.length < 2 || new Set(t.map((x) => x.speaker)).size < 2) {
          throw new ProviderError("Script writer returned an unusable dialogue", { retryable: true, msg: { key: "e_badDialogue" } });
        }
        return t;
      }
      const text = cleanNarration(raw);
      if (text.length < 200) throw new ProviderError("Script writer returned too little text", { retryable: true, msg: { key: "e_tooLittle" } });
      return text.split("\n\n").map((p) => ({ speaker: "", text: p }));
    }, 4);
    job.written.push(piece);
    await saveJob(job);
  }
  const all = job.written.flat();
  if (req.mode === "conversation") job.script = all;
  else job.narration = all;
  req.text = all.map((t) => stripTags(t.text)).join("\n\n");
  await saveJob(job);
}
