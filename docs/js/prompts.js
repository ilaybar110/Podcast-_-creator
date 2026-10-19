// Prompt templates (port of app/prompts.py). The wording itself lives in prompts_data.js,
// generated from the Python source so both apps direct the voice identically.
import { DATA } from "./prompts_data.js";

export const { STYLES, PACES, ACCENT, DELIVERY, RULES } = DATA;
const WHO = { female: "woman", male: "man" };

export function narratorPrompt(text, language, style, pace, persona, gender = "female") {
  const s = STYLES[style] || STYLES.warm;
  const who = WHO[gender] || "person";
  const grammar = language === "he" && WHO[gender]
    ? ` Speaking as a ${who}, so first-person Hebrew forms are ${gender}.` : "";
  return `# AUDIO PROFILE: ${persona} (${who})\n` +
    `A beloved podcast host recording an episode in a quiet, warm-sounding studio, close to the mic.${grammar}\n\n` +
    `### DIRECTOR'S NOTES\n` +
    `Style: ${s.notes}\n` +
    `Accent: ${ACCENT[language]}\n` +
    `Pacing: ${PACES[pace] || PACES.natural}\n` +
    `Delivery: ${DELIVERY}\n` +
    `Rules: ${RULES}\n\n` +
    `#### TRANSCRIPT\n${text}\n`;
}

export function dialoguePrompt(transcript, language, style, pace, hosts, genders = ["female", "male"]) {
  const s = STYLES[style] || STYLES.warm;
  const [a, b] = hosts;
  const [ga, gb] = genders.map((g) => WHO[g] || "person");
  return `# AUDIO PROFILE: ${a} (${ga}) and ${b} (${gb}), two friends who co-host a much-loved podcast.\n` +
    `They are recording together in a cosy studio. Real chemistry: they listen to each other and ` +
    `sound curious, engaged and amused where the lines are funny.\n\n` +
    `### DIRECTOR'S NOTES\n` +
    `Style: ${s.notes}\n` +
    `Accent (both hosts): ${ACCENT[language]}\n` +
    `Pacing: ${PACES[pace] || PACES.natural} Natural turn-taking with no awkward gaps.\n` +
    `Delivery: ${DELIVERY}\n` +
    `Rules: ${RULES} Do not read the speaker names aloud.\n\n` +
    `#### TRANSCRIPT\n${transcript}\n`;
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
Use correct Hebrew gender forms for each host when they speak and when they address each other.

Requirements:
- Cover ALL the information in the source, in order. Do not invent facts. Keep names, numbers and key terms.
- It must sound like real people talking, not reading: short sentences, natural reactions
  ("רגע, מה?", "וואו", "בדיוק" / "wait, really?", "exactly"), questions, light humour, occasional
  agreement or follow-up questions. No stage directions, no sound effects, no markdown, no emojis.
- Alternate speakers often; each turn is 1-4 sentences.
- ${position.join(" ")}
- Part ${part} of ${totalParts}.${tail}
Output ONLY lines in exactly this format, one turn per line:
${a}: ...
${b}: ...

SOURCE:
${source}
`;
}

export function parseDialogue(raw, hosts) {
  const [a, b] = hosts;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\W*(${esc(a)}|${esc(b)})\\W*\\s*[:：\\-–]\\s*(.+)$`, "i");
  const turns = [];
  for (let line of raw.split("\n")) {
    line = line.trim();
    if (!line) continue;
    const m = line.match(pattern);
    if (m) {
      const speaker = m[1].toLowerCase() === a.toLowerCase() ? a : b;
      let text = m[2].replace(/[*_#`]/g, "").trim();
      text = text.replace(/\[[^\]]*\]|\((?:laughs?|צוחק(?:ת)?|music|מוזיקה)[^)]*\)/g, "").trim();
      if (text) turns.push({ speaker, text });
    } else if (turns.length && !/^[A-Za-z]{2,20}\s*:/.test(line)) {
      turns[turns.length - 1].text += " " + line.replace(/[*_#`]/g, "");
    }
  }
  return turns;
}
