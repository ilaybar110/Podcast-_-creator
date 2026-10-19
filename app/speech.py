"""Deterministic "speech prep" for Hebrew text, applied right before text-to-speech.

Twin of docs/js/speech.js: both must behave identically (tests/speech_cases.json is run
against both). Hebrew TTS stumbles on digits, symbols and acronyms written with ASCII
quotes, so we spell them out. English text is returned unchanged (English TTS reads
digits fine). We never transliterate Latin words or add niqqud.

Rules (Hebrew):
- Acronyms: " or '' between Hebrew letters -> ״ (צה"ל -> צה״ל) when it sits before the
  last letter (optionally + a plural/adjective suffix); ' after a Hebrew letter used as
  geresh -> ׳ (ג'ירפה, מס', א'), but quotes around a word ('שלום') are kept.
- Gender: a bare number is read in the feminine counting form (3 -> שלוש, 15 -> חמש עשרה),
  which is how Hebrew counts, reads years (1948, 2024) and reads digits. A number before a
  masculine unit is masculine: % (אחוז), ₪/ש"ח (שקלים), $ (דולר), € (אירו), ק"מ, ס"מ, מ"מ,
  ק"ג, known masculine nouns (שקלים, שבועות, בינואר...) and any following plural ending
  in -ים (ילדים) unless it is a known feminine one (שנים, שעות, פעמים...); a following
  word starting with ה is not the counted noun, and a year-like 1000-2099 before an
  unknown plural stays feminine (בשנת 2024 עובדים). ° (מעלות) is feminine. Thousands/millions multipliers are always masculine (שלושה מיליון,
  עשרים ושניים אלף), hundreds always feminine (שלוש מאות). Decimals are always read in
  the feminine counting form (3.5% -> שלוש נקודה חמש אחוז). One/two before a unit:
  "1%" -> אחוז אחד, "2 ₪" -> שני שקלים, "2°" -> שתי מעלות.
- Plain integers up to 999,999,999 (up to 999,999,999,999 with thousands commas);
  digit strings with a leading zero or longer than 9 digits, and dash-joined groups that
  look like phone numbers/IDs, are read digit by digit.
- Ranges "10-20" -> עשר עד עשרים (only when the first is smaller; "3-2" is a score and
  keeps its dash). Times H:MM -> "ארבע עשרה שלושים" (":00" -> just the hour).
  Dates d.m.yyyy / d/m/yyyy / d-m-yyyy -> "ארבעה עשר במרץ אלפיים עשרים וארבע".
- Prefix letters glued to a number (ב-1948, ה־3, ל50) lose the hyphen/maqaf and are
  attached to the first word: באלף תשע מאות ארבעים ושמונה.
- Symbols: & before a Hebrew word -> ו, a standalone + -> פלוס, = -> שווה, ° -> מעלות, % -> אחוז,
  ₪ -> שקלים, $ -> דולר, € -> אירו.
The pass is idempotent: running it on its own output changes nothing.
"""
from __future__ import annotations

import re

from .text_utils import detect_language

_UNITS_F = ["אפס", "אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"]
_UNITS_M = ["אפס", "אחד", "שניים", "שלושה", "ארבעה", "חמישה", "שישה", "שבעה", "שמונה", "תשעה"]
_TEENS_F = ["עשר", "אחת עשרה", "שתים עשרה", "שלוש עשרה", "ארבע עשרה", "חמש עשרה", "שש עשרה",
            "שבע עשרה", "שמונה עשרה", "תשע עשרה"]
_TEENS_M = ["עשרה", "אחד עשר", "שנים עשר", "שלושה עשר", "ארבעה עשר", "חמישה עשר", "שישה עשר",
            "שבעה עשר", "שמונה עשר", "תשעה עשר"]
_TENS = ["", "", "עשרים", "שלושים", "ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים"]
_HUNDREDS = ["", "מאה", "מאתיים", "שלוש מאות", "ארבע מאות", "חמש מאות", "שש מאות", "שבע מאות",
             "שמונה מאות", "תשע מאות"]
_THOUSANDS = ["", "אלף", "אלפיים", "שלושת אלפים", "ארבעת אלפים", "חמשת אלפים", "ששת אלפים",
              "שבעת אלפים", "שמונת אלפים", "תשעת אלפים", "עשרת אלפים"]
_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר",
           "אוקטובר", "נובמבר", "דצמבר"]

# unit -> (masculine, singular, plural, suffix)
_SYMBOL_UNITS = {
    "%": (True, "אחוז", "אחוז", ""),
    "₪": (True, "שקל", "שקלים", ""),
    "ש״ח": (True, "שקל", "שקלים", ""),
    "$": (True, "דולר", "דולר", ""),
    "€": (True, "אירו", "אירו", ""),
    "°": (False, "מעלה", "מעלות", ""),
    "°C": (False, "מעלה", "מעלות", " צלזיוס"),
    "°F": (False, "מעלה", "מעלות", " פרנהייט"),
    "ק״מ": (True, "קילומטר", "קילומטרים", ""),
    "ס״מ": (True, "סנטימטר", "סנטימטרים", ""),
    "מ״מ": (True, "מילימטר", "מילימטרים", ""),
    "ק״ג": (True, "קילוגרם", "קילוגרם", ""),
}
_MULTIPLIERS = {"אלף": 10 ** 3, "מיליון": 10 ** 6, "מיליארד": 10 ** 9}
# Known nouns after a number. Other plural nouns are guessed by their ending: -ים is
# masculine (ילדים), -ות feminine (מכוניות); a word with ה (the article) is never the counted noun.
_MASC_NOUNS = ["טריליון", "שקל", "שקלים", "אחוז", "אחוזים", "דולר", "דולרים", "אירו", "יורו",
               "מטר", "קילו", "קילוגרם", "גרם", "ליטר", "שבועות", "מקומות", "חלונות", "קולות",
               "לילות", "רחובות", "כוחות", "דורות", "שולחנות", "אבות", "חובות", "ארונות"]
_MASC_NOUNS += ["ב" + month for month in _MONTHS]       # ה-3 בינואר -> השלושה בינואר
_FEM_NOUNS = ["שעות", "דקות", "שניות", "שנים", "פעמים", "נשים", "ערים", "מילים", "ביצים", "יונים",
              "נמלים", "דבורים", "אבנים", "ציפורים", "רגליים", "ידיים", "עיניים", "אוזניים", "שיניים"]

_NUM = r"[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?"
_NOUNS = "|".join(sorted(list(_MULTIPLIERS) + _MASC_NOUNS + _FEM_NOUNS, key=len, reverse=True))
_UNIT = (r"[ ]?(?:%|₪|\$|€|°[ ]?[CF](?![A-Za-z])|°|(?:ש״ח|ק״מ|ס״מ|מ״מ|ק״ג)(?![א-ת]))"
         rf"|[ ](?:{_NOUNS}|(?!ה)[א-ת]+(?:ים|ות))(?![א-ת״׳])")
_TOKEN_RE = re.compile(
    rf"(?<![A-Za-z0-9.,:/\-])(?:([₪$€%])[ ]?)?({_NUM})({_UNIT})?"
    rf"(?:([ ]?[-–][ ]?)(?:([₪$€])[ ]?)?({_NUM})({_UNIT})?)?(?![0-9]|[.,:/][0-9])")
_ACRONYM_RE = re.compile(r"([א-ת]+)(\"|'')([א-ת]+)")
_ACRONYM_SUFFIXES = {"ים", "ות", "ית", "יות", "י"}
_PREFIX_RE = re.compile(r"(?<![A-Za-z0-9א-ת״׳])([א-ת]+)[-־–]?(?=[0-9₪$€])")
_PREFIX_WORD_RE = re.compile(r"(?:ו?(?:כש|ש)?)(?:[בהכלמ]|מה)?")
_DATE_RE = re.compile(r"(?<![0-9.,:/])([0-9]{1,2})([./-])([0-9]{1,2})\2([0-9]{4}|[0-9]{2})(?![0-9]|[.,:/-][0-9])")
_TIME_RE = re.compile(r"(?<![0-9:.,])([01]?[0-9]|2[0-3]):([0-5][0-9])(?![0-9]|[:.][0-9])")
_DIGITS_RE = re.compile(r"(?<![0-9.,:/+])(\+)?([0-9]+(?:[-–][0-9]+)*)(?![0-9]|[.,:/][0-9])")
_NEGATIVE_RE = re.compile(r"(?<![A-Za-z0-9א-ת״׳)\]\-])(?<![0-9][%₪$€°])[-−](?=[0-9])")
_PLUS = r"(?<![^\s0-9])\+(?![^\s0-9])"      # a + with only spaces/digits/edges around it


def number_words(n: int, masculine: bool = False) -> str:
    """Hebrew words for 0 <= n < 10**12 (feminine counting form unless masculine)."""
    if n == 0:
        return "אפס"
    terms = _terms(n, masculine)
    return _join(terms)


def _join(terms: list[str]) -> str:
    if len(terms) > 1:
        terms = terms[:-1] + ["ו" + terms[-1]]
    return " ".join(terms)


def _terms(n: int, masculine: bool) -> list[str]:
    out: list[str] = []
    for value, word in ((10 ** 9, "מיליארד"), (10 ** 6, "מיליון")):
        q, n = divmod(n, value)
        if q:
            out.append(word if q == 1 else f"שני {word}" if q == 2 else f"{_join(_terms(q, True))} {word}")
    q, n = divmod(n, 1000)
    if q:
        out.append(_THOUSANDS[q] if q <= 10 else f"{_join(_terms(q, True))} אלף")
    q, n = divmod(n, 100)
    if q:
        out.append(_HUNDREDS[q])
    if 10 <= n < 20:
        out.append((_TEENS_M if masculine else _TEENS_F)[n - 10])
    else:
        if n >= 20:
            out.append(_TENS[n // 10])
        if n % 10:
            out.append((_UNITS_M if masculine else _UNITS_F)[n % 10])
    return out


def digit_words(digits: str) -> str:
    return " ".join(_UNITS_F[int(d)] for d in digits)


def _plain_number(s: str, masculine: bool) -> str:
    whole, _, frac = s.replace(",", "").partition(".")
    if frac:
        frac_words = number_words(int(frac)) if len(frac) <= 2 and frac[0] != "0" else digit_words(frac)
        return f"{number_words(int(whole))} נקודה {frac_words}"
    n = int(whole)
    return number_words(n, masculine) if n < 10 ** 12 else digit_words(whole)


def _noun_is_masculine(noun: str) -> bool:
    if noun in _FEM_NOUNS:
        return False
    return noun in _MASC_NOUNS or noun in _MULTIPLIERS or noun.endswith("ים")


def _with_unit(s: str, unit: str | None, bare: bool = False) -> str:
    """Read number s before its unit (or, with bare, in the unit's gender without the unit)."""
    unit = (unit or "").strip().replace(" ", "")
    if not unit:
        return _plain_number(s, False)
    integer = "." not in s
    n = int(s.replace(",", "").split(".")[0])
    if unit in _SYMBOL_UNITS:
        masc, one, many, suffix = _SYMBOL_UNITS[unit]
        if bare:
            return _plain_number(s, masc)
        if integer and n == 1:
            return f"{one} {'אחד' if masc else 'אחת'}{suffix}"
        if integer and n == 2:
            return f"{'שני' if masc else 'שתי'} {many}{suffix}"
        return f"{_plain_number(s, masc)} {many}{suffix}"
    if unit in _MULTIPLIERS and integer and n < 1000 and not bare:
        return number_words(n * _MULTIPLIERS[unit])
    known = unit in _MASC_NOUNS or unit in _FEM_NOUNS or unit in _MULTIPLIERS
    if not known and integer and "," not in s and 1000 <= n <= 2099:
        masc = False        # probably a year followed by a plural word: בשנת 2024 עובדים...
    else:
        masc = _noun_is_masculine(unit)
    if bare:
        return _plain_number(s, masc)
    if integer and n == 2 and (known or unit.endswith("ים") or unit.endswith("ות")):
        return f"{'שני' if masc else 'שתי'} {unit}"
    return f"{_plain_number(s, masc)} {unit}"


def _token(m: re.Match) -> str:
    pre, a, ua, sep, pre2, b, ub = m.groups()
    if b is None:
        return _with_unit(a, ua or pre)
    value = lambda s: float(s.replace(",", ""))   # noqa: E731
    if value(a) < value(b) and not (ua and ub and ua.strip() != ub.strip()):
        unit = ub or ua or pre2 or pre
        return f"{_with_unit(a, unit, bare=True)} עד {_with_unit(b, unit)}"
    return _with_unit(a, ua or pre) + sep + _with_unit(b, ub or pre2)


def _acronym(m: re.Match) -> str:
    before, _, after = m.groups()
    nxt = m.string[m.end():m.end() + 1]
    if len(after) == 1 or (after[1:] in _ACRONYM_SUFFIXES and not _is_quote(nxt)):
        return f"{before}״{after}"
    return m.group(0)


def _is_he(c: str) -> bool:
    return bool(c) and "א" <= c <= "ת"


def _is_word(c: str) -> bool:
    return bool(c) and bool(re.match(r"[A-Za-z0-9א-ת]", c))


def _is_quote(c: str) -> bool:
    return bool(c) and c in "\"״“”'"


def _gereshes(text: str) -> str:
    chars = list(text)
    is_open = False
    for i, c in enumerate(chars):
        if c == "\n":
            is_open = False
        if c != "'":
            continue
        p = chars[i - 1] if i > 0 else ""
        n = chars[i + 1] if i + 1 < len(chars) else ""
        pp = chars[i - 2] if i > 1 else ""
        if _is_he(p):
            if _is_he(n):
                if p in "גזצץת":
                    chars[i] = "׳"
                elif p in "בהוכלמש" and not _is_word(pp):
                    is_open = True
            elif is_open:
                is_open = False
            else:
                chars[i] = "׳"
        elif _is_he(n) and not (_is_word(p) or (p and p in "׳״")):
            is_open = True
    return "".join(chars)


def _prefix(m: re.Match) -> str:
    word = m.group(1)
    return word if len(word) <= 4 and _PREFIX_WORD_RE.fullmatch(word) else word + " "


def _date(m: re.Match) -> str:
    d, mo, y = int(m.group(1)), int(m.group(3)), m.group(4)
    if not (1 <= d <= 31 and 1 <= mo <= 12):
        return m.group(0)
    return f"{number_words(d, True)} ב{_MONTHS[mo - 1]} {number_words(int(y))}"


def _time(m: re.Match) -> str:
    h, mins = int(m.group(1)), m.group(2)
    if mins == "00":
        return number_words(h)
    return f"{number_words(h)} {'אפס ' + _UNITS_F[int(mins)] if mins[0] == '0' else number_words(int(mins))}"


def _digits(m: re.Match) -> str:
    plus, body = m.groups()
    groups = re.split(r"[-–]", body)
    if plus or len(groups) >= 3 or any(len(g) > 9 or (len(g) > 1 and g[0] == "0") for g in groups):
        return ("פלוס " if plus else "") + ", ".join(digit_words(g) for g in groups)
    return m.group(0)


def _spaced(text: str, pattern: str, word: str, attach: bool = False) -> str:
    """Replace a symbol with a word, keeping exactly one space around it where needed."""
    def rep(m: re.Match) -> str:
        s, start, end = m.string, m.start(), m.end()
        before = "" if start == 0 or s[start - 1].isspace() else " "
        after = "" if attach or end == len(s) or s[end].isspace() or s[end] in ".,!?;:)]״\"" else " "
        return before + word + after
    return re.sub(pattern, rep, text)


def _quotes(text: str) -> str:
    return _gereshes(_ACRONYM_RE.sub(_acronym, text))


def _operators(text: str) -> str:
    text = _spaced(text, r"[ \t]*" + _PLUS + r"[ \t]*", "פלוס")
    return _spaced(text, r"[ \t]*(?<![^\s0-9])=(?![^\s0-9])[ \t]*", "שווה")


def prepare_for_speech(text: str, language: str | None = None) -> str:
    """Spell out what Hebrew TTS reads badly. language=None detects it from the text."""
    if (language or detect_language(text)) != "he":
        return text
    text = _quotes(text)
    text = re.sub(r"(?<=[0-9])(?=[א-ת])(?!(?:ש״ח|ק״מ|ס״מ|מ״מ|ק״ג)(?![א-ת]))", " ", text)
    text = _PREFIX_RE.sub(_prefix, text)
    text = _DATE_RE.sub(_date, text)
    text = _TIME_RE.sub(_time, text)
    text = _DIGITS_RE.sub(_digits, text)
    text = _NEGATIVE_RE.sub("מינוס ", text)
    text = _operators(text)
    text = _TOKEN_RE.sub(_token, text)
    text = _spaced(text, r"[ \t]*%[ \t]*", "אחוז")
    text = _spaced(text, r"[ \t]*₪[ \t]*", "שקלים")
    text = _spaced(text, r"(?<![א-ת])ש״ח(?![א-ת])", "שקלים")
    text = _spaced(text, r"[ \t]*\$[ \t]*", "דולר")
    text = _spaced(text, r"[ \t]*€[ \t]*", "אירו")
    text = _spaced(text, r"[ \t]*°[ \t]*", "מעלות")
    # & and the operators again, now that the words around them are final, so that a
    # second run changes nothing.
    while True:
        joined = _spaced(text, r"[ \t]*&[ \t]*(?=[א-ת])", "ו", attach=True)
        if joined == text:
            break
        text = joined
    text = _operators(text)
    text = _quotes(text)
    return re.sub(r"[ \t]{2,}", " ", text)
