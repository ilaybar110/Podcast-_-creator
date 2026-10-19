// Deterministic "speech prep" for Hebrew text, applied right before text-to-speech.
// Port of app/speech.py (see the rules there); both run tests/speech_cases.json, so keep them identical.
// Bare numbers are read in the feminine counting form (3 -> שלוש, 2024 -> אלפיים עשרים וארבע);
// before a masculine unit (%, ₪, $, ק"מ, -ים nouns...) they are masculine (15% -> חמישה עשר אחוז).
// English text is returned unchanged.
import { detectLanguage } from "./text.js";

const UNITS_F = ["אפס", "אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"];
const UNITS_M = ["אפס", "אחד", "שניים", "שלושה", "ארבעה", "חמישה", "שישה", "שבעה", "שמונה", "תשעה"];
const TEENS_F = ["עשר", "אחת עשרה", "שתים עשרה", "שלוש עשרה", "ארבע עשרה", "חמש עשרה", "שש עשרה",
  "שבע עשרה", "שמונה עשרה", "תשע עשרה"];
const TEENS_M = ["עשרה", "אחד עשר", "שנים עשר", "שלושה עשר", "ארבעה עשר", "חמישה עשר", "שישה עשר",
  "שבעה עשר", "שמונה עשר", "תשעה עשר"];
const TENS = ["", "", "עשרים", "שלושים", "ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים"];
const HUNDREDS = ["", "מאה", "מאתיים", "שלוש מאות", "ארבע מאות", "חמש מאות", "שש מאות", "שבע מאות",
  "שמונה מאות", "תשע מאות"];
const THOUSANDS = ["", "אלף", "אלפיים", "שלושת אלפים", "ארבעת אלפים", "חמשת אלפים", "ששת אלפים",
  "שבעת אלפים", "שמונת אלפים", "תשעת אלפים", "עשרת אלפים"];
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר",
  "אוקטובר", "נובמבר", "דצמבר"];

// unit -> [masculine, singular, plural, suffix]
const SYMBOL_UNITS = {
  "%": [true, "אחוז", "אחוז", ""],
  "₪": [true, "שקל", "שקלים", ""],
  "ש״ח": [true, "שקל", "שקלים", ""],
  "$": [true, "דולר", "דולר", ""],
  "€": [true, "אירו", "אירו", ""],
  "°": [false, "מעלה", "מעלות", ""],
  "°C": [false, "מעלה", "מעלות", " צלזיוס"],
  "°F": [false, "מעלה", "מעלות", " פרנהייט"],
  "ק״מ": [true, "קילומטר", "קילומטרים", ""],
  "ס״מ": [true, "סנטימטר", "סנטימטרים", ""],
  "מ״מ": [true, "מילימטר", "מילימטרים", ""],
  "ק״ג": [true, "קילוגרם", "קילוגרם", ""],
};
const MULTIPLIERS = { "אלף": 1e3, "מיליון": 1e6, "מיליארד": 1e9 };
// Known nouns after a number. Other plural nouns are guessed by their ending: -ים is
// masculine (ילדים), -ות feminine (מכוניות); a word with ה (the article) is never the counted noun.
const MASC_NOUNS = ["טריליון", "שקל", "שקלים", "אחוז", "אחוזים", "דולר", "דולרים", "אירו", "יורו",
  "מטר", "קילו", "קילוגרם", "גרם", "ליטר", "שבועות", "מקומות", "חלונות", "קולות",
  "לילות", "רחובות", "כוחות", "דורות", "שולחנות", "אבות", "חובות", "ארונות",
  ...MONTHS.map((m) => "ב" + m)];        // ה-3 בינואר -> השלושה בינואר
const FEM_NOUNS = ["שעות", "דקות", "שניות", "שנים", "פעמים", "נשים", "ערים", "מילים", "ביצים", "יונים",
  "נמלים", "דבורים", "אבנים", "ציפורים", "רגליים", "ידיים", "עיניים", "אוזניים", "שיניים"];

const NUM = String.raw`[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?`;
const NOUNS = [...Object.keys(MULTIPLIERS), ...MASC_NOUNS, ...FEM_NOUNS].sort((a, b) => b.length - a.length).join("|");
const UNIT = String.raw`[ ]?(?:%|₪|\$|€|°[ ]?[CF](?![A-Za-z])|°|(?:ש״ח|ק״מ|ס״מ|מ״מ|ק״ג)(?![א-ת]))` +
  String.raw`|[ ](?:${NOUNS}|(?!ה)[א-ת]+(?:ים|ות))(?![א-ת״׳])`;
const TOKEN_RE = new RegExp(String.raw`(?<![A-Za-z0-9.,:/\-])(?:([₪$€%])[ ]?)?(${NUM})(${UNIT})?` +
  String.raw`(?:([ ]?[-–][ ]?)(?:([₪$€])[ ]?)?(${NUM})(${UNIT})?)?(?![0-9]|[.,:/][0-9])`, "g");
const ACRONYM_RE = /([א-ת]+)("|'')([א-ת]+)/g;
const ACRONYM_SUFFIXES = new Set(["ים", "ות", "ית", "יות", "י"]);
const PREFIX_RE = /(?<![A-Za-z0-9א-ת״׳])([א-ת]+)[-־–]?(?=[0-9₪$€])/g;
const PREFIX_WORD_RE = /^(?:ו?(?:כש|ש)?)(?:[בהכלמ]|מה)?$/;
const DATE_RE = /(?<![0-9.,:/])([0-9]{1,2})([./-])([0-9]{1,2})\2([0-9]{4}|[0-9]{2})(?![0-9]|[.,:/-][0-9])/g;
const TIME_RE = /(?<![0-9:.,])([01]?[0-9]|2[0-3]):([0-5][0-9])(?![0-9]|[:.][0-9])/g;
const DIGITS_RE = /(?<![0-9.,:/+])(\+)?([0-9]+(?:[-–][0-9]+)*)(?![0-9]|[.,:/][0-9])/g;
const NEGATIVE_RE = /(?<![A-Za-z0-9א-ת״׳)\]\-])(?<![0-9][%₪$€°])[-−](?=[0-9])/g;
const PLUS = String.raw`(?<![^\s0-9])\+(?![^\s0-9])`;     // a + with only spaces/digits/edges around it

/** Replace every match of a global regex with fn(match), like Python's re.sub with a function. */
function sub(text, re, fn) {
  let out = "", last = 0;
  for (const m of text.matchAll(re)) {
    out += text.slice(last, m.index) + fn(m);
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

/** Hebrew words for 0 <= n < 10**12 (feminine counting form unless masculine). */
export function numberWords(n, masculine = false) {
  return n === 0 ? "אפס" : join(terms(n, masculine));
}

function join(t) {
  if (t.length > 1) t = [...t.slice(0, -1), "ו" + t[t.length - 1]];
  return t.join(" ");
}

function terms(n, masculine) {
  const out = [];
  for (const [value, word] of [[1e9, "מיליארד"], [1e6, "מיליון"]]) {
    const q = Math.floor(n / value);
    n %= value;
    if (q) out.push(q === 1 ? word : q === 2 ? `שני ${word}` : `${join(terms(q, true))} ${word}`);
  }
  let q = Math.floor(n / 1000);
  n %= 1000;
  if (q) out.push(q <= 10 ? THOUSANDS[q] : `${join(terms(q, true))} אלף`);
  q = Math.floor(n / 100);
  n %= 100;
  if (q) out.push(HUNDREDS[q]);
  if (n >= 10 && n < 20) out.push((masculine ? TEENS_M : TEENS_F)[n - 10]);
  else {
    if (n >= 20) out.push(TENS[Math.floor(n / 10)]);
    if (n % 10) out.push((masculine ? UNITS_M : UNITS_F)[n % 10]);
  }
  return out;
}

export function digitWords(digits) {
  return [...digits].map((d) => UNITS_F[+d]).join(" ");
}

function plainNumber(s, masculine) {
  const [whole, frac] = s.replace(/,/g, "").split(".");
  if (frac) {
    const fracWords = frac.length <= 2 && frac[0] !== "0" ? numberWords(parseInt(frac, 10)) : digitWords(frac);
    return `${numberWords(parseInt(whole, 10))} נקודה ${fracWords}`;
  }
  const n = parseInt(whole, 10);
  return n < 1e12 ? numberWords(n, masculine) : digitWords(whole);
}

function nounIsMasculine(noun) {
  if (FEM_NOUNS.includes(noun)) return false;
  return MASC_NOUNS.includes(noun) || noun in MULTIPLIERS || noun.endsWith("ים");
}

/** Read number s before its unit (or, with bare, in the unit's gender without the unit). */
function withUnit(s, unit, bare = false) {
  unit = (unit || "").trim().replace(/ /g, "");
  if (!unit) return plainNumber(s, false);
  const integer = !s.includes(".");
  const n = parseInt(s.replace(/,/g, "").split(".")[0], 10);
  if (Object.hasOwn(SYMBOL_UNITS, unit)) {
    const [masc, one, many, suffix] = SYMBOL_UNITS[unit];
    if (bare) return plainNumber(s, masc);
    if (integer && n === 1) return `${one} ${masc ? "אחד" : "אחת"}${suffix}`;
    if (integer && n === 2) return `${masc ? "שני" : "שתי"} ${many}${suffix}`;
    return `${plainNumber(s, masc)} ${many}${suffix}`;
  }
  if (Object.hasOwn(MULTIPLIERS, unit) && integer && n < 1000 && !bare) return numberWords(n * MULTIPLIERS[unit]);
  const known = MASC_NOUNS.includes(unit) || FEM_NOUNS.includes(unit) || Object.hasOwn(MULTIPLIERS, unit);
  // A year followed by a plural word (בשנת 2024 עובדים...) is probably not counting them.
  const masc = !known && integer && !s.includes(",") && n >= 1000 && n <= 2099 ? false : nounIsMasculine(unit);
  if (bare) return plainNumber(s, masc);
  if (integer && n === 2 && (known || unit.endsWith("ים") || unit.endsWith("ות"))) return `${masc ? "שני" : "שתי"} ${unit}`;
  return `${plainNumber(s, masc)} ${unit}`;
}

function token(m) {
  const [, pre, a, ua, sep, pre2, b, ub] = m;
  if (b === undefined) return withUnit(a, ua || pre);
  const value = (s) => parseFloat(s.replace(/,/g, ""));
  if (value(a) < value(b) && !(ua && ub && ua.trim() !== ub.trim())) {
    const unit = ub || ua || pre2 || pre;
    return `${withUnit(a, unit, true)} עד ${withUnit(b, unit)}`;
  }
  return withUnit(a, ua || pre) + sep + withUnit(b, ub || pre2);
}

const isHe = (c) => !!c && c >= "א" && c <= "ת";
const isWord = (c) => !!c && /[A-Za-z0-9א-ת]/.test(c);
const isQuote = (c) => !!c && "\"״“”'".includes(c);

function acronym(m) {
  const [whole, before, , after] = m;
  const next = m.input.slice(m.index + whole.length, m.index + whole.length + 1);
  if (after.length === 1 || (ACRONYM_SUFFIXES.has(after.slice(1)) && !isQuote(next))) return `${before}״${after}`;
  return whole;
}

function gereshes(text) {
  const chars = [...text];
  let open = false;
  chars.forEach((c, i) => {
    if (c === "\n") open = false;
    if (c !== "'") return;
    const p = chars[i - 1] || "", n = chars[i + 1] || "", pp = chars[i - 2] || "";
    if (isHe(p)) {
      if (isHe(n)) {
        if ("גזצץת".includes(p)) chars[i] = "׳";
        else if ("בהוכלמש".includes(p) && !isWord(pp)) open = true;
      } else if (open) open = false;
      else chars[i] = "׳";
    } else if (isHe(n) && !(isWord(p) || "׳״".includes(p || "x"))) open = true;
  });
  return chars.join("");
}

function prefix(m) {
  const word = m[1];
  return word.length <= 4 && PREFIX_WORD_RE.test(word) ? word : word + " ";
}

function date(m) {
  const d = +m[1], mo = +m[3];
  if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12)) return m[0];
  return `${numberWords(d, true)} ב${MONTHS[mo - 1]} ${numberWords(+m[4])}`;
}

function time(m) {
  const h = +m[1], mins = m[2];
  if (mins === "00") return numberWords(h);
  return `${numberWords(h)} ${mins[0] === "0" ? "אפס " + UNITS_F[+mins] : numberWords(+mins)}`;
}

function digits(m) {
  const [whole, plus, body] = m;
  const groups = body.split(/[-–]/);
  if (plus || groups.length >= 3 || groups.some((g) => g.length > 9 || (g.length > 1 && g[0] === "0"))) {
    return (plus ? "פלוס " : "") + groups.map(digitWords).join(", ");
  }
  return whole;
}

/** Replace a symbol with a word, keeping exactly one space around it where needed. */
function spaced(text, pattern, word, attach = false) {
  return sub(text, new RegExp(pattern, "g"), (m) => {
    const s = m.input, start = m.index, end = m.index + m[0].length;
    const before = start === 0 || /\s/.test(s[start - 1]) ? "" : " ";
    const after = attach || end === s.length || /\s/.test(s[end]) || ".,!?;:)]״\"".includes(s[end]) ? "" : " ";
    return before + word + after;
  });
}

const quotes = (text) => gereshes(sub(text, ACRONYM_RE, acronym));
function operators(text) {
  text = spaced(text, String.raw`[ \t]*` + PLUS + String.raw`[ \t]*`, "פלוס");
  return spaced(text, String.raw`[ \t]*(?<![^\s0-9])=(?![^\s0-9])[ \t]*`, "שווה");
}

/** Spell out what Hebrew TTS reads badly. Without a language it is detected from the text. */
export function prepareForSpeech(text, language) {
  if ((language || detectLanguage(text)) !== "he") return text;
  text = quotes(text);
  text = text.replace(/(?<=[0-9])(?=[א-ת])(?!(?:ש״ח|ק״מ|ס״מ|מ״מ|ק״ג)(?![א-ת]))/g, " ");
  text = sub(text, PREFIX_RE, prefix);
  text = sub(text, DATE_RE, date);
  text = sub(text, TIME_RE, time);
  text = sub(text, DIGITS_RE, digits);
  text = text.replace(NEGATIVE_RE, "מינוס ");
  text = operators(text);
  text = sub(text, TOKEN_RE, token);
  text = spaced(text, String.raw`[ \t]*%[ \t]*`, "אחוז");
  text = spaced(text, String.raw`[ \t]*₪[ \t]*`, "שקלים");
  text = spaced(text, String.raw`(?<![א-ת])ש״ח(?![א-ת])`, "שקלים");
  text = spaced(text, String.raw`[ \t]*\$[ \t]*`, "דולר");
  text = spaced(text, String.raw`[ \t]*€[ \t]*`, "אירו");
  text = spaced(text, String.raw`[ \t]*°[ \t]*`, "מעלות");
  // & and the operators again, now that the words around them are final, so that a
  // second run changes nothing.
  for (let joined; (joined = spaced(text, String.raw`[ \t]*&[ \t]*(?=[א-ת])`, "ו", true)) !== text;) text = joined;
  text = operators(text);
  text = quotes(text);
  return text.replace(/[ \t]{2,}/g, " ");
}
