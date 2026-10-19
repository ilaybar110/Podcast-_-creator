// Prompt templates (port of app/prompts.py). The wording itself lives in prompts_data.js,
// generated from the Python source so both apps direct the voice identically.
import { DATA } from "./prompts_data.js";

export const { STYLES, PACES, ACCENT, DELIVERY, RULES, TAGS, TAG_EVERY, DIALOGUE_RULES, SAMPLE_CONTEXT,
  CONVO_CRAFT, CONVO_TAGS, NARRATION_CRAFT } = DATA;
const WHO = { female: "woman", male: "man" };

export function narratorPrompt(text, language, style, pace, persona, gender = "female") {
  const s = STYLES[style] || STYLES.warm;
  const who = WHO[gender] || "person";
  const grammar = language === "he" && WHO[gender]
    ? ` Speaking as a ${who}, so first-person Hebrew forms are ${gender}.` : "";
  return `# AUDIO PROFILE: ${persona} (${who})\n` +
    `## A beloved podcast host: warm, curious and easy to listen to.${grammar}\n\n` +
    `## THE SCENE\n` +
    `A quiet, warm-sounding studio, close to the mic. Talking to one listener over coffee, ` +
    `not to an audience.\n\n` +
    `### DIRECTOR'S NOTES\n` +
    `Style: ${s.notes}\n` +
    `Accent: ${ACCENT[language]}\n` +
    `Pacing: ${PACES[pace] || PACES.natural}\n` +
    `Delivery: ${DELIVERY}\n` +
    `Rules: ${RULES}\n\n` +
    `### SAMPLE CONTEXT\n${SAMPLE_CONTEXT.narrator}\n\n` +
    `#### TRANSCRIPT\n${text}\n`;
}

export function dialoguePrompt(transcript, language, style, pace, hosts, genders = ["female", "male"]) {
  const s = STYLES[style] || STYLES.warm;
  const [a, b] = hosts;
  const [ga, gb] = genders.map((g) => WHO[g] || "person");
  return `# AUDIO PROFILE: ${a} (${ga}) and ${b} (${gb})\n` +
    `## Two old friends who co-host a much-loved podcast. ${a} explains; ${b} is curious and ` +
    `asks what the listener would ask.\n\n` +
    `## THE SCENE\n` +
    `Recording together in a cosy studio, close to the mic. Real chemistry: they listen to ` +
    `each other, react honestly and sound amused where the lines are funny. Talking to one ` +
    `listener over coffee, not to an audience.\n\n` +
    `### DIRECTOR'S NOTES\n` +
    `Style: ${s.notes}\n` +
    `Accent (both hosts): ${ACCENT[language]}\n` +
    `Pacing: ${PACES[pace] || PACES.natural} Natural turn-taking with no awkward gaps.\n` +
    `Delivery: ${DELIVERY}\n` +
    `Rules: ${RULES} ${DIALOGUE_RULES}\n\n` +
    `### SAMPLE CONTEXT\n${SAMPLE_CONTEXT.dialogue}\n\n` +
    `#### TRANSCRIPT\n${transcript}\n`;
}

/** Script-writer guidance for a two-host conversation: roles, rhythm, spoken language, voice cues. */
export function conversationCraft(language, hosts) {
  const [a, b] = hosts;
  return CONVO_CRAFT[language].replaceAll("{A}", a).replaceAll("{B}", b) + "\n" + CONVO_TAGS;
}

export function podcastScriptPrompt(source, language, hosts, part, totalParts, previousTail,
                                    genders = ["female", "male"]) {
  const [a, b] = hosts;
  const [ga, gb] = genders.map((g) => WHO[g] || "person");
  const langName = language === "he" ? "modern, colloquial Israeli Hebrew (עברית מדוברת, טבעית)"
    : "natural, conversational English";
  const position = [];
  position.push(part === 1
    ? `This is the START of the episode: ${a} opens with a short, warm welcome and introduces the topic and ${b}.`
    : "This continues an episode already in progress: do NOT greet or re-introduce the show; pick up naturally from where the conversation stopped.");
  position.push(part === totalParts
    ? "This is the END of the episode: finish with a short, warm wrap-up and goodbye."
    : "Do NOT wrap up or say goodbye - the episode continues after this part.");
  const tail = previousTail ? `\nThe conversation so far ended with:\n${previousTail}\n` : "";
  return `You write scripts for a top-rated two-host podcast. Turn the SOURCE below into a natural,
engaging dialogue between ${a} (a ${ga}) and ${b} (a ${gb}), written in ${langName}.

Requirements:
- Cover ALL the information in the source, in order. Do not invent facts. Keep names, key terms and every number (written as spoken words).
- It must sound like real people talking, not reading: questions, honest reactions, light humour,
  follow-ups. No stage directions, no sound effects, no markdown, no emojis.
${conversationCraft(language, hosts)}
- ${position.join(" ")}
- Part ${part} of ${totalParts}.${tail}
Output ONLY lines in exactly this format, one turn per line:
${a}: ...
${b}: ...

SOURCE:
${source}
`;
}

// ------------------------------------------------------------------ parsing
const TAG = /\[([^\]]*)\]/g;
const STAGE = /\((?:laughs?|צוחק(?:ת)?|music|מוזיקה)[^)]*\)/gi;

/** The words only, without [voice cues] (for lengths and word counts). */
export const stripTags = (text) => text.replace(TAG, "").replace(/\s{2,}/g, " ").trim();

// Keep at most one whitelisted [tag]; drop other brackets and (stage directions).
function cleanTurn(text, allowTag) {
  let kept = false;
  text = text.replace(STAGE, " ").replace(TAG, (_, t) => {
    const tag = t.trim().toLowerCase();
    if (allowTag && !kept && TAGS.includes(tag)) { kept = true; return ` [${tag}] `; }
    return " ";
  });
  text = text.replace(/\s{2,}/g, " ").replace(/\s+([,.!?…])/g, "$1").trim();
  return [stripTags(text) ? text : "", kept];
}

export function parseDialogue(raw, hosts) {
  const [a, b] = hosts;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\W*(${esc(a)}|${esc(b)})\\W*\\s*[:：\\-–]\\s*(.+)$`, "i");
  const turns = [];
  let lastTag = -TAG_EVERY;
  for (let line of raw.split("\n")) {
    line = line.trim();
    if (!line) continue;
    const m = line.match(pattern);
    if (m) {
      const speaker = m[1].toLowerCase() === a.toLowerCase() ? a : b;
      const [text, tagged] = cleanTurn(m[2].replace(/[*_#`]/g, ""), turns.length - lastTag >= TAG_EVERY);
      if (text) {
        if (tagged) lastTag = turns.length;
        turns.push({ speaker, text });
      }
    } else if (turns.length && !/^[A-Za-z]{2,20}\s*:/.test(line)) {
      const [text] = cleanTurn(line.replace(/[*_#`]/g, ""), false);     // wrapped continuation
      if (text) turns[turns.length - 1].text += " " + text;
    }
  }
  return turns;
}
