// Node test for docs/js/speech.js (run by tests/test_app.py): the shared Hebrew speech-prep cases in
// tests/speech_cases.json, which tests/test_speech.py runs against app/speech.py too.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const S = await import(new URL("../docs/js/speech.js", import.meta.url));

const { cases } = JSON.parse(readFileSync(new URL("./speech_cases.json", import.meta.url), "utf8"));
assert.ok(cases.length > 50);
let failures = 0;
for (const c of cases) {
  const lang = "lang" in c ? c.lang ?? undefined : "he";
  const out = S.prepareForSpeech(c.in, lang);
  if (out !== c.out) { failures++; console.error(`MISMATCH ${JSON.stringify(c.in)}\n  got  ${JSON.stringify(out)}\n  want ${JSON.stringify(c.out)}`); }
  const again = S.prepareForSpeech(out, lang);
  if (again !== out) { failures++; console.error(`NOT IDEMPOTENT ${JSON.stringify(out)} -> ${JSON.stringify(again)}`); }
}
assert.equal(failures, 0, `${failures} speech-prep case(s) failed`);

// number words: no digits or stray spaces anywhere in the range, and a few anchors
for (let n = 0; n < 2200; n++) {
  for (const m of [false, true]) assert.doesNotMatch(S.numberWords(n, m), /[0-9]| {2}|^ | $/, String(n));
}
assert.equal(S.numberWords(21, true), "עשרים ואחד");
assert.equal(S.numberWords(2_000_002), "שני מיליון ושתיים");
assert.ok(S.numberWords(999_999_999).startsWith("תשע מאות תשעים ותשעה מיליון"));
assert.equal(S.digitWords("050"), "אפס חמש אפס");

// language detection when none is given; clean text is left alone
assert.equal(S.prepareForSpeech("הם שילמו 50 ₪"), "הם שילמו חמישים שקלים");
const english = "They paid $50 for 3 tickets in 2024.";
assert.equal(S.prepareForSpeech(english), english);
const clean = "שלום לכולם, היום נדבר על צה״ל ועל המנכ״לית החדשה.\n\nפסקה שנייה, בלי מספרים בכלל!";
assert.equal(S.prepareForSpeech(clean), clean);
console.log(`ok: ${cases.length} shared cases`);
