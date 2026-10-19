// UI for the browser-only edition (GitHub Pages). No server: the page talks to Google directly.
import { cleanText, detectLanguage, estimateSeconds, formatDuration } from "./text.js";
import { STYLES } from "./prompts.js";
import { DATA } from "./prompts_data.js";
import { Gemini, QuotaExhausted, VOICES, freeVerdict, withRetries } from "./gemini.js";
import { Cancelled, hostNames, runJob } from "./job.js";
import { research, topicPlan } from "./research.js";
import * as A from "./audio.js";

const I18N = {
  he: {
    title: "יוצר הפודקאסטים", subtitle: "כל טקסט, בכל אורך — לפודקאסט MP3 בקול אנושי וחם",
    settings: "הגדרות", step1: "הטקסט שלך", upload: "העלאת קובץ",
    placeholder: "הדביקו כאן טקסט באורך כלשהו — מאמר, פרק מספר, סיכום, תסריט...",
    chars: "תווים", words: "מילים", estimate: "אורך משוער", step2: "הקול", language: "שפת הפודקאסט",
    format: "פורמט", narrator: "קריין אחד", conversation: "שיחה בין שני מגישים",
    voice: "בחרו קול", voice2: "קול המגיש/ה השני/ה", style: "סגנון", pace: "קצב", relaxed: "רגוע",
    natural: "טבעי", brisk: "מהיר", ptitle: "שם הפרק", generate: "צרו את הפודקאסט",
    keepOpen: "השאירו את הדף פתוח בזמן היצירה.", cancel: "ביטול", ready: "הפודקאסט מוכן",
    exactLength: "אורך מדויק", download: "הורדת MP3", showScript: "הצגת התסריט", hideScript: "הסתרת התסריט",
    getKey: "(קבלת מפתח חינם)", save: "שמירה", recommended: "מומלץ", female: "אישה", male: "גבר",
    showAll: "הצגת כל הקולות", showLess: "רק הקולות המומלצים",
    narratorHint: "קריין/ית אחד/ת מקריא/ה את הטקסט שלכם מילה במילה, בקול חם וטבעי.",
    convHint: "הטקסט הופך לשיחה טבעית בין שני מגישים שמכסה את כל התוכן — כמו פודקאסט אמיתי.",
    emptyText: "הדביקו טקסט קודם.", needKey: "הוסיפו קודם מפתח Gemini (למעלה).", starting: "מתחילים…",
    size: "גודל", previewFail: "התצוגה המקדימה נכשלה", defaultTitle: "הפודקאסט שלי",
    keyTitle: "חיבור חד-פעמי: מפתח Gemini חינמי",
    keyStep1: 'היכנסו ל-<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> עם חשבון Google.',
    keyStep2: 'לחצו "Create API key" והעתיקו את המפתח. עדיף בפרויקט בלי חיוב (Billing) — כך אי אפשר לחייב אתכם.',
    keyStep3: "הדביקו אותו כאן. המפתח נשמר רק בטלפון שלכם ונשלח ישירות ל-Google.",
    keyChecking: "בודקים את המפתח…", keyOk: "✓ המפתח עובד. אפשר להתחיל!",
    privacy: "הכול רץ בדפדפן שלכם. הטקסט והמפתח נשלחים רק ל-Google.",
    resume: "המשך יצירה", freeTitle: "שמירה על מסלול חינמי",
    freeOnly: "מצב חינם בלבד: לעולם לא לעבור את המכסה החינמית (עוצר וממשיך מחר במקום לשלם)",
    billing: "בפרויקט Google של המפתח מוגדר חיוב (Billing)",
    billingHint: "הכי בטוח: מפתח מפרויקט בלי חיוב — כך Google לא יכולה לחייב אתכם בכלל, ובמקרה הגרוע תקבלו הודעת \"מכסה נגמרה\".",
    limitsHint: "המגבלות החינמיות משתנות לפי פרויקט. האפליקציה לומדת את המגבלה האמיתית מ-Google אוטומטית; אפשר גם להזין ידנית לפי",
    ttsPerDay: "בקשות קול ליום", ttsPerMin: "בקשות קול לדקה", textPerDay: "בקשות תסריט ליום",
    fFree: "✓ <b>חינם</b> — ישתמש ב-{need} מתוך {left} בקשות קול חינמיות שנותרו היום.",
    fFreeScript: " + {need} בקשות לכתיבת התסריט (נותרו {left}).",
    fMinutes: "בגלל מגבלת {rpm} בקשות לדקה, היצירה תיקח לפחות ~{min} דק׳.",
    fMulti: "⏳ <b>חינם, אבל דורש {days} ימים של מכסה חינמית.</b> היצירה תיעצר כשהמכסה תיגמר, ותוכלו להמשיך אחרי האיפוס ({reset}) — בלי לשלם.",
    fPaid: "💳 <b>בתשלום</b> — במפתח מוגדר חיוב, כך שכל בקשה עולה כסף.",
    fOff: " (מצב חינם בלבד כבוי — ייתכנו חיובים או שגיאות מכסה)",
    fReserve: "כולל רזרבה של {reserve} להקלטות חוזרות.",
    confirmMulti: "הפודקאסט הזה דורש {days} ימים של מכסה חינמית. היצירה תיעצר כשהמכסה תיגמר ותוכלו ללחוץ \"המשך יצירה\" אחרי האיפוס. להתחיל?",
    pausedText: "המכסה החינמית להיום נגמרה, אז עצרנו כדי שלא תשלמו. החלקים שכבר הוקלטו נשמרו בטלפון. אפשר להמשיך אחרי {reset}.",
    previewCost: "השמעה לדוגמה (משתמשת בבקשה חינמית אחת בפעם הראשונה)",
    paidBlocked: "במפתח מוגדר חיוב, אז כל בקשה תעלה כסף. כבו את 'מצב חינם בלבד' בהגדרות כדי לאשר תשלום, או השתמשו במפתח מפרויקט בלי חיוב.",
    cancelled: "בוטל.",
    tapAgain: "הדוגמה מוכנה — הקישו שוב על ▶ כדי לשמוע.",
    srcText: "מהטקסט שלי", srcTopic: "מנושא — מחקר מהאינטרנט", topicTitle: "על מה הפודקאסט?",
    topicPlaceholder: "למשל: איך עובד הזיכרון האנושי, המהפכה התעשייתית, בינה מלאכותית ברפואה…",
    findSources: "חיפוש מקורות",
    topicHint: "האפליקציה תחפש מקורות ב-Google ובוויקיפדיה ותציע לכם כיווני התמקדות. החיפוש חינמי ולא נוגע במכסת הקולות.",
    researching: "מחפשים מקורות ומכינים סיכום מחקר… (כחצי דקה)",
    focusTitle: "על מה להתמקד? (אפשר לבחור כמה)", customFocus: "או כתבו כיוון משלכם (לא חובה)",
    lengthLabel: "אורך הפודקאסט", minShort: "2 דק׳", maxLong: "שעה", minutesUnit: "דקות",
    sourcesTitle: "המקורות שנמצאו", wikiOnly: "חיפוש Google לא היה זמין כרגע, לכן המחקר מבוסס על ויקיפדיה.",
    needTopic: "כתבו נושא קודם.", needResearch: "לחצו קודם על \"חיפוש מקורות\".", needFocus: "בחרו לפחות כיוון אחד להתמקד בו.",
    fSearch: " + חיפוש מעמיק אחד ב-Google ({left} נשארו היום).",
    narratorTopicHint: "קריין/ית אחד/ת מגיש/ה פרק מעמיק על הנושא, בקול חם וטבעי.",
    convTopicHint: "שני מגישים משוחחים לעומק על הנושא — כמו פודקאסט אמיתי.",
    sourcesHead: "מקורות",
    topicHintOff: "האפליקציה תחפש מקורות ב-Google ובוויקיפדיה. מצב חינמי-בלבד כבוי, ולכן ייתכן שהחיפוש יעלה כסף.",
    interruptedText: "היצירה נקטעה (הדף נסגר). החלקים שכבר הוקלטו שמורים — אפשר להמשיך מאיפה שעצרנו.",
  },
  en: {
    title: "Podcast Creator", subtitle: "Any text, any length — into a warm, human-sounding podcast MP3",
    settings: "Settings", step1: "Your text", upload: "Upload file",
    placeholder: "Paste text of any length — an article, a book chapter, notes, a script...",
    chars: "characters", words: "words", estimate: "Estimated length", step2: "Voice", language: "Podcast language",
    format: "Format", narrator: "Single narrator", conversation: "Two-host conversation",
    voice: "Choose a voice", voice2: "Second host's voice", style: "Style", pace: "Pace", relaxed: "Relaxed",
    natural: "Natural", brisk: "Brisk", ptitle: "Episode title", generate: "Create podcast",
    keepOpen: "Keep this page open while it records.", cancel: "Cancel", ready: "Your podcast is ready",
    exactLength: "Exact length", download: "Download MP3", showScript: "Show script", hideScript: "Hide script",
    getKey: "(get a free key)", save: "Save", recommended: "Recommended", female: "Female", male: "Male",
    showAll: "Show all voices", showLess: "Recommended voices only",
    narratorHint: "One narrator reads your text word for word in a warm, natural voice.",
    convHint: "Your text becomes a natural conversation between two hosts that covers all of it — like a real podcast.",
    emptyText: "Paste some text first.", needKey: "Add your Gemini key first (top of the page).", starting: "Starting…",
    size: "Size", previewFail: "Preview failed", defaultTitle: "My podcast",
    keyTitle: "One-time setup: a free Gemini key",
    keyStep1: 'Go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> with a Google account.',
    keyStep2: 'Tap "Create API key" and copy it. Prefer a project without billing — then you can\'t be charged.',
    keyStep3: "Paste it here. It is stored only on your device and sent only to Google.",
    keyChecking: "Checking the key…", keyOk: "✓ The key works. You're ready!",
    privacy: "Everything runs in your browser. Your text and key go only to Google.",
    resume: "Continue", freeTitle: "Stay on the free tier",
    freeOnly: "Free-only mode: never go past the free quota (pause and continue tomorrow instead of paying)",
    billing: "The key's Google project has billing enabled",
    billingHint: "Safest: use a key from a project with no billing. Then Google cannot charge you at all; the worst case is a 'quota exceeded' message.",
    limitsHint: "Free limits differ per project. The app learns the real limit from Google automatically; you can also enter it from",
    ttsPerDay: "Voice requests / day", ttsPerMin: "Voice requests / minute", textPerDay: "Script requests / day",
    fFree: "✓ <b>Free</b> — uses {need} of the {left} free voice requests left today.",
    fFreeScript: " + {need} requests to write the script ({left} left).",
    fMinutes: "Because of the {rpm} requests/minute limit, it will take at least ~{min} min.",
    fMulti: "⏳ <b>Free, but needs {days} days of free quota.</b> It will pause when the quota runs out and you can continue after the reset ({reset}) — without paying.",
    fPaid: "💳 <b>Paid</b> — billing is enabled on this key, so every request costs money.",
    fOff: " (free-only mode is OFF — you may be charged or hit quota errors)",
    fReserve: "Includes {reserve} spare for re-recording bad takes.",
    confirmMulti: "This podcast needs {days} days of free quota. It will pause when the quota runs out and you can press \"Continue\" after the reset. Start?",
    pausedText: "Today's free quota is used up, so we paused instead of charging you. Everything recorded so far is saved on this device. You can continue after {reset}.",
    previewCost: "Preview (uses one free request the first time)",
    paidBlocked: "Billing is enabled on this key, so every request would cost money. Turn off free-only mode in Settings to allow that, or use a key from a project without billing.",
    cancelled: "Cancelled.",
    tapAgain: "The sample is ready — tap ▶ again to listen.",
    srcText: "From my text", srcTopic: "From a topic — web research", topicTitle: "What is the podcast about?",
    topicPlaceholder: "e.g. how human memory works, the industrial revolution, AI in medicine…",
    findSources: "Find sources",
    topicHint: "The app searches Google and Wikipedia for sources and suggests what to focus on. Searching is free and doesn't touch the voice quota.",
    researching: "Finding sources and preparing research notes… (about 30 seconds)",
    focusTitle: "What should it focus on? (pick one or more)", customFocus: "Or write your own focus (optional)",
    lengthLabel: "Podcast length", minShort: "2 min", maxLong: "1 hour", minutesUnit: "min",
    sourcesTitle: "Sources found", wikiOnly: "Google Search wasn't available right now, so the research is based on Wikipedia.",
    needTopic: "Write a topic first.", needResearch: "Tap \"Find sources\" first.", needFocus: "Pick at least one focus.",
    fSearch: " + 1 in-depth Google search ({left} left today).",
    narratorTopicHint: "One host presents an in-depth episode on the topic in a warm, natural voice.",
    convTopicHint: "Two hosts discuss the topic in depth — like a real podcast.",
    sourcesHead: "Sources",
    topicHintOff: "The app searches Google and Wikipedia for sources. Free-only mode is OFF, so searching may cost money.",
    interruptedText: "Recording was interrupted (the page was closed). The parts already recorded are saved — continue where it stopped.",
  },
};
const DESC_HE = {
  Warm: "חם", Friendly: "ידידותי", Gentle: "עדין", Smooth: "חלק ונעים", Mature: "בוגר", "Easy-going": "נינוח",
  Breezy: "קליל", Knowledgeable: "בקיא", Soft: "רך", Informative: "אינפורמטיבי", Casual: "יומיומי",
  Lively: "תוסס", Breathy: "אוורירי", Clear: "צלול", Firm: "תקיף", Youthful: "צעיר", Bright: "בהיר",
  Upbeat: "עליז", Forward: "ישיר", Excitable: "נלהב", Gravelly: "מחוספס", Even: "מאוזן",
};
const PREVIEW_TEXT = {
  he: (g) => `היי, שלום לכולם וברוכים הבאים. אני ממש ${g === "male" ? "שמח" : "שמחה"} שאתם פה איתנו היום, ` +
    "כי יש לנו נושא מרתק לדבר עליו. אז תכינו לכם כוס קפה, תתרווחו, ובואו נתחיל.",
  en: () => "Hey everyone, and welcome back. I'm really glad you're here with us today, because we've got a " +
    "fascinating story to talk about. So grab a coffee, get comfy, and let's dive in.",
};

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const state = {
  ui: store.get("ui", "he"), lang: "he", langTouched: false, mode: "narrator", style: "warm", pace: "natural",
  voice: "Sulafat", voice2: "Achird", showAll: false, busy: false, cancel: false, job: null, free: null, t0: 0,
  src: store.get("src", "text"), research: null, focus: new Set(), researching: false,
};
try { state.research = JSON.parse(store.get("research", "null")); } catch { /* old or corrupt */ }
if (state.research?.angles) {
  state.focus = new Set(state.research.angles.slice(0, 2).map((x) => x.id));
  state.lang = state.research.language || state.lang;
} else state.research = null;
// The choices made on the research (focus, own focus, length, title) survive a reload too.
function saveTopicSetup() {
  store.set("topicSetup", JSON.stringify({ focus: [...state.focus], custom: $("customFocus").value,
    minutes: $("minutes").value, title: $("title").value }));
}
function restoreTopicSetup() {
  if (!state.research) return;
  try {
    const s = JSON.parse(store.get("topicSetup", "null"));
    if (!s) return;
    state.focus = new Set(s.focus.filter((id) => state.research.angles.some((a) => a.id === id)));
    $("customFocus").value = s.custom || "";
    $("minutes").value = s.minutes || 8;
    if (s.title) $("title").value = s.title;
  } catch { /* old or corrupt */ }
}
const safeUrl = (u) => /^https?:\/\//i.test(u || "");
const t = (k) => I18N[state.ui][k] ?? k;
const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
const key = () => store.get("geminiKey", "");
const intOrNull = (v) => { const n = parseInt(v, 10); return n > 0 ? n : null; };

function freeOpts() {
  const limits = {}, tts = {}, txt = {};
  if (intOrNull(store.get("limTtsRpd"))) tts.rpd = intOrNull(store.get("limTtsRpd"));
  if (intOrNull(store.get("limTtsRpm"))) tts.rpm = intOrNull(store.get("limTtsRpm"));
  if (intOrNull(store.get("limTextRpd"))) txt.rpd = intOrNull(store.get("limTextRpd"));
  if (Object.keys(tts).length) limits.gemini_tts = tts;
  if (Object.keys(txt).length) limits.gemini_text = txt;
  return { freeOnly: store.get("freeOnly", "1") === "1", billing: store.get("billing", "0") === "1", limits };
}
const gemini = () => new Gemini(key(), { freeOnly: freeOpts().freeOnly, overrides: freeOpts().limits });

function resetTime(iso) {
  return iso ? new Date(iso).toLocaleString(state.ui === "he" ? "he-IL" : "en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

// ---------------------------------------------------------------- rendering
function applyUI() {
  document.documentElement.lang = state.ui;
  document.documentElement.dir = state.ui === "he" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  $("uiLangBtn").textContent = state.ui === "he" ? "English" : "עברית";
  if (!$("title").value || Object.values(I18N).some((d) => d.defaultTitle === $("title").value)) $("title").value = t("defaultTitle");
  const chips = $("styles");
  chips.innerHTML = "";
  for (const [id, s] of Object.entries(STYLES)) {
    const b = document.createElement("button");
    b.className = "chip" + (id === state.style ? " on" : "");
    b.textContent = state.ui === "he" ? s.label_he : s.label_en;
    b.onclick = () => { state.style = id; [...chips.children].forEach((c) => c.classList.toggle("on", c === b)); };
    chips.appendChild(b);
  }
  $("keyCard").hidden = !!key();
  setSeg("srcSeg", state.src);
  $("topicCard").hidden = state.src !== "topic";
  $("textCard").hidden = state.src === "topic";
  $("minutesOut").textContent = `${$("minutes").value} ${t("minutesUnit")}`;
  document.querySelector('[data-i18n="topicHint"]').textContent = freeOpts().freeOnly ? t("topicHint") : t("topicHintOff");
  renderResearch();
  renderVoices();
  updateHint();
  onTextChange();
}

function renderVoiceGrid(container, k) {
  container.innerHTML = "";
  const list = state.showAll ? VOICES : VOICES.filter((v) => v.recommended || v.id === state[k]);
  for (const v of list) {
    const card = document.createElement("div");
    card.className = "voice" + (state[k] === v.id ? " on" : "");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.innerHTML = `<button class="play" aria-label="preview">▶</button><div class="meta"><div class="name"></div><div class="desc"></div></div>`;
    card.querySelector(".name").textContent = v.name;
    card.querySelector(".play").title = readySamples.has(`${state.lang}/${v.id}`) ? "▶" : t("previewCost");
    if (v.recommended) {
      const s = document.createElement("span"); s.className = "star"; s.textContent = "★ " + t("recommended");
      card.querySelector(".name").appendChild(s);
    }
    card.querySelector(".desc").textContent = `${t(v.gender)} · ${state.ui === "he" ? DESC_HE[v.description] || v.description : v.description}`;
    const choose = () => { state[k] = v.id; store.set(k, v.id); renderVoices(); };
    card.addEventListener("click", (e) => { if (!e.target.closest(".play")) choose(); });
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } });
    card.querySelector(".play").addEventListener("click", (e) => { e.stopPropagation(); preview(v, e.currentTarget); });
    container.appendChild(card);
  }
  const more = document.createElement("button");
  more.className = "chip";
  more.textContent = state.showAll ? t("showLess") : t("showAll");
  more.onclick = () => { state.showAll = !state.showAll; renderVoices(); };
  container.appendChild(more);
}

function renderVoices() {
  renderVoiceGrid($("voices"), "voice");
  $("voice2Wrap").hidden = state.mode !== "conversation";
  if (state.mode === "conversation") renderVoiceGrid($("voices2"), "voice2");
}

function updateHint() {
  const topic = state.src === "topic";
  $("modeHint").textContent = state.mode === "conversation" ? t(topic ? "convTopicHint" : "convHint")
    : t(topic ? "narratorTopicHint" : "narratorHint");
  $("generate").disabled = state.busy;
}

function renderFree(f) {
  const el = $(state.src === "topic" ? "topicBadge" : "freeBadge");
  $(state.src === "topic" ? "freeBadge" : "topicBadge").hidden = true;
  state.free = f;
  if (!f) { el.hidden = true; return; }
  const tts = f.buckets.gemini_tts, txt = f.buckets.gemini_text, web = f.buckets.gemini_search;
  let cls = "ok", html;
  if (f.status === "paid") { cls = "bad"; html = t("fPaid"); }
  else if (f.status === "free_multi_day") { cls = "wait"; html = fmt(t("fMulti"), { days: f.days, reset: resetTime(f.reset_at) }); }
  else html = fmt(t("fFree"), { need: tts.needed + tts.reserve, left: tts.left_today });
  if (txt && f.status !== "paid") html += fmt(t("fFreeScript"), { need: txt.needed + txt.reserve, left: txt.left_today });
  if (web?.left_today && f.status !== "paid") html += fmt(t("fSearch"), { left: web.left_today });
  if (!freeOpts().freeOnly && f.status !== "free") html += t("fOff");
  const sub = [];
  if (tts.reserve) sub.push(fmt(t("fReserve"), { reserve: tts.reserve }));
  if (tts.minutes_at_least >= 1) sub.push(fmt(t("fMinutes"), { rpm: tts.per_minute, min: Math.ceil(tts.minutes_at_least) }));
  el.className = "free-badge " + cls;
  el.innerHTML = html + (sub.length ? `<div class="sub">${sub.join(" ")}</div>` : "");
  el.hidden = false;
}

let estTimer = null;
function onTextChange() {
  clearTimeout(estTimer);
  estTimer = setTimeout(async () => {
    if (state.src === "topic") return topicEstimate();
    const raw = $("text").value;
    const text = cleanText(raw);
    if (!text) { $("statChars").textContent = "0"; $("statWords").textContent = "0"; $("statEst").textContent = "0:00"; renderFree(null); return; }
    if (!state.langTouched) { state.lang = detectLanguage(text); setSeg("langSeg", state.lang); }
    let secs = estimateSeconds(text, state.lang);
    if (state.mode === "conversation") secs *= 1.25;
    $("statChars").textContent = text.length.toLocaleString();
    $("statWords").textContent = text.split(/\s+/).length.toLocaleString();
    $("statEst").textContent = "~" + formatDuration(secs);
    if (!key()) return renderFree(null);
    const o = freeOpts();
    renderFree(await freeVerdict({ chars: text.length, mode: state.mode, apiKey: key(), overrides: o.limits, billing: o.billing }));
  }, 250);
}

// ---------------------------------------------------------------- podcast from a topic
async function topicEstimate() {
  const minutes = +$("minutes").value;
  $("minutesOut").textContent = `${minutes} ${t("minutesUnit")}`;
  if (!key() || !state.research) return renderFree(null);
  const o = freeOpts();
  const plan = topicPlan(minutes, state.lang, state.mode, o.freeOnly ? DATA.FREE_CHUNK_CHARS : 1500);
  renderFree(await freeVerdict({ apiKey: key(), overrides: o.limits, billing: o.billing, plan }));
}

function topicStatus(msg, isError = false) {
  const el = $("researchStatus");
  el.hidden = !msg;
  el.textContent = msg || "";
  el.classList.toggle("error", isError);
}

function renderResearch() {
  const r = state.research;
  $("researchOut").hidden = !r;
  if (!r) return;
  if (!$("topic").value) $("topic").value = r.topic;
  $("resSummary").textContent = r.summary;
  const box = $("angles");
  box.innerHTML = "";
  for (const a of r.angles) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "angle" + (state.focus.has(a.id) ? " on" : "");
    b.setAttribute("aria-pressed", state.focus.has(a.id));
    b.innerHTML = `<span class="tick">✓</span><span><b dir="auto"></b><span class="d" dir="auto"></span></span>`;
    b.querySelector("b").textContent = a.title;
    b.querySelector(".d").textContent = a.description;
    b.onclick = () => {
      state.focus.has(a.id) ? state.focus.delete(a.id) : state.focus.add(a.id);
      b.classList.toggle("on", state.focus.has(a.id));
      saveTopicSetup();
      b.setAttribute("aria-pressed", state.focus.has(a.id));
    };
    box.appendChild(b);
  }
  $("sourceCount").textContent = r.sources.length;
  const list = $("sourceList");
  list.innerHTML = "";
  for (const s of r.sources.filter((x) => safeUrl(x.url))) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = s.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = s.title;
    li.appendChild(a);
    list.appendChild(li);
  }
  if (!r.searched) topicStatus(t("wikiOnly"));
}

async function findSources() {
  if (state.researching) return;
  const topic = $("topic").value.trim();
  if (!topic) return topicStatus(t("needTopic"), true);
  if (!key()) return topicStatus(t("needKey"), true);
  if (freeOpts().billing && freeOpts().freeOnly) return topicStatus(t("paidBlocked"), true);
  if (!state.langTouched) { state.lang = detectLanguage(topic); setSeg("langSeg", state.lang); }
  state.researching = true;
  $("researchBtn").disabled = true;
  topicStatus(t("researching"));
  try {
    const g = gemini();
    g.gate.onWait = (s) => topicStatus(`${t("researching")} (${Math.round(s)}s)`);
    const r = await research(topic, state.lang, g);
    const oldTitle = state.research?.title;
    state.research = r;
    state.focus = new Set(r.angles.slice(0, 2).map((a) => a.id));
    store.set("research", JSON.stringify(r));
    const title = $("title").value;
    if (!title || title === oldTitle || Object.values(I18N).some((d) => d.defaultTitle === title)) $("title").value = r.title;
    $("customFocus").value = "";
    saveTopicSetup();
    topicStatus("");
    renderResearch();
  } catch (e) {
    topicStatus(e instanceof QuotaExhausted ? fmt(t("pausedText"), { reset: resetTime(e.resetAt.toISOString()) })
      : e.message || String(e), true);
  } finally {
    state.researching = false;
    $("researchBtn").disabled = false;
    onTextChange();
  }
}

// ---------------------------------------------------------------- preview
// iPhone Safari only allows sound to start inside the tap itself. A preview first waits for
// Google, so we "unlock" one shared <audio> element during the tap (by playing a silent clip)
// and reuse that element once the voice arrives. Previews already fetched play instantly.
const previewEl = new Audio();
previewEl.preload = "auto";
const SILENCE_URL = (() => {
  const n = 2400, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, str) => [...str].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 24000, true); v.setUint32(28, 48000, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
})();
let previewSeq = 0, playingBtn = null;
const previewCache = new Map();
// Samples recorded in advance (tools/make_previews.py) ship with the site: instant, no quota.
let readySamples = new Set();
fetch("previews/manifest.json").then((r) => (r.ok ? r.json() : { samples: [] }))
  .then((m) => { readySamples = new Set(m.samples); renderVoices(); }).catch(() => {});

function resetPlayButtons() {
  document.querySelectorAll(".play").forEach((b) => { b.textContent = "▶"; });
  playingBtn = null;
}
previewEl.addEventListener("ended", resetPlayButtons);

async function playPreview(url, btn) {
  previewEl.src = url;
  btn.textContent = "❚❚";
  playingBtn = btn;
  try {
    await previewEl.play();
  } catch (e) {
    // Still blocked (very strict browser settings): the clip is ready now, so the next tap plays at once.
    resetPlayButtons();
    if (e.name === "NotAllowedError") showError(t("tapAgain"));
    else throw e;
  }
}

function preview(v, btn) {
  const seq = ++previewSeq;
  const wasPlaying = playingBtn === btn;
  previewEl.pause();
  resetPlayButtons();
  showError("");
  if (wasPlaying) return;                                  // second tap = stop
  if (!key()) return showError(t("needKey"));
  if (freeOpts().billing && freeOpts().freeOnly) return showError(t("paidBlocked"));
  if (readySamples.has(`${state.lang}/${v.id}`)) {
    return playPreview(`previews/${state.lang}/${v.id}.mp3`, btn).catch((e) => showError(`${t("previewFail")}: ${e.message}`));
  }
  const ck = [v.id, state.lang, state.style, state.pace].join("|");
  const cached = previewCache.get(ck);
  if (cached) return playPreview(cached, btn).catch((e) => showError(`${t("previewFail")}: ${e.message}`));
  // Unlock the shared player while we are still inside the tap.
  previewEl.src = SILENCE_URL;
  previewEl.play().catch(() => {});
  btn.textContent = "…";
  (async () => {
    let url;
    const blob = await A.store.getPart("preview", ck);    // previews persist: one free request each, ever
    if (blob) url = URL.createObjectURL(blob);
    if (!url) {
      const g = gemini();
      const other = v.gender === "male" ? "female" : "male";
      const opts = { language: state.lang, style: state.style, pace: state.pace,
        hostNames: hostNames(state.lang, v.gender, other), genders: [v.gender, other] };
      const { pcm, rate } = await withRetries(() => g.synthesize(PREVIEW_TEXT[state.lang](v.gender), v.id, opts), 3);
      const { audio, kweighted } = await A.masterPart(A.trimSilence(A.resample(pcm, rate)));
      const meter = new A.LoudnessMeter();
      meter.add(kweighted);
      const enc = A.startEncoder(64);
      enc.push(new Float32Array(audio), Math.min(4, 10 ** ((-16 - meter.integratedDb()) / 20)));
      const mp3 = await enc.finish();
      await A.store.putPart("preview", ck, mp3);
      url = URL.createObjectURL(mp3);
      onTextChange();                                       // the free-quota badge changed
    }
    previewCache.set(ck, url);
    if (seq !== previewSeq) { btn.textContent = "▶"; return; }   // another voice was tapped meanwhile
    await playPreview(url, btn);
  })().catch((e) => {
    if (seq === previewSeq) btn.textContent = "▶";
    showError(`${t("previewFail")}: ${e.message}`);
  });
}

// ---------------------------------------------------------------- jobs
function showError(msg) { $("error").hidden = !msg; $("error").textContent = msg || ""; }
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB"; }

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not supported / denied */ }
}
document.addEventListener("visibilitychange", () => { if (state.busy && document.visibilityState === "visible") keepAwake(true); });

async function generate() {
  if (state.busy) return;
  showError("");
  const fromTopic = state.src === "topic";
  const text = fromTopic ? "" : $("text").value;
  let topic = null;
  if (fromTopic) {
    const r = state.research;
    if (!r || $("topic").value.trim() !== r.topic) return showError(t("needResearch"));   // topic changed: search again
    const focus = r.angles.filter((a) => state.focus.has(a.id)).map((a) => `${a.title} - ${a.description}`);
    if ($("customFocus").value.trim()) focus.push($("customFocus").value.trim());
    if (!focus.length) return showError(t("needFocus"));
    topic = { topic: r.topic, notes: r.notes, sources: r.sources, focus, minutes: +$("minutes").value };
  } else if (!cleanText(text)) return showError(t("emptyText"));
  if (!key()) return showError(t("needKey"));
  const o = freeOpts();
  if (o.billing && o.freeOnly) return showError(t("paidBlocked"));
  if (state.free?.status === "free_multi_day" && o.freeOnly && !confirm(fmt(t("confirmMulti"), { days: state.free.days }))) return;
  const job = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), status: "running", warnings: [], script: null,
    request: { text, topic, language: state.lang, mode: state.mode, voice: state.voice, voice2: state.voice2,
      style: state.style, pace: state.pace, title: $("title").value || t("defaultTitle") },
  };
  await A.store.saveJob(job);
  store.set("lastJob", job.id);
  run(job);
}

async function run(job) {
  state.job = job; state.busy = true; state.cancel = false; state.t0 = Date.now();
  $("result").hidden = true; $("paused").hidden = true;
  $("progress").hidden = false; $("stage").textContent = t("starting"); $("barFill").style.width = "1%";
  updateHint();
  keepAwake(true);
  const timer = setInterval(() => { $("elapsed").textContent = formatDuration((Date.now() - state.t0) / 1000); }, 1000);
  const ui = {
    progress(p, stage) {
      if (p != null) { $("barFill").style.width = Math.max(1, p * 100) + "%"; $("pct").textContent = Math.round(p * 100) + "%"; }
      if (stage) $("stage").textContent = stage;
    },
    cancelled: () => state.cancel,
  };
  try {
    const { blob } = await runJob(job, gemini(), ui);
    job.status = "done";
    await A.store.saveJob(job);
    await showResult(job, blob);
  } catch (e) {
    if (e instanceof QuotaExhausted) {
      job.status = "paused"; job.resumeAt = e.resetAt.toISOString();
      showPaused(job);
    } else if (e instanceof Cancelled) {
      job.status = "cancelled"; showError(t("cancelled"));
    } else {
      job.status = "error"; showError(e.message || String(e));
    }
    await A.store.saveJob(job);
  } finally {
    clearInterval(timer);
    state.busy = false;
    $("progress").hidden = true;
    keepAwake(false);
    updateHint();
    onTextChange();
  }
}

function showPaused(job) {
  $("pausedText").textContent = job.status === "paused"
    ? fmt(t("pausedText"), { reset: resetTime(job.resumeAt) }) : t("interruptedText");
  $("paused").hidden = false;
}

async function showResult(job, blob) {
  const url = URL.createObjectURL(blob);
  const player = $("player");
  player.src = url;
  $("result").hidden = false;
  // Exact length, counted from the MP3's own frames (iPhone Safari won't load the player's
  // metadata until you press play, so we don't wait for it).
  const duration = await A.mp3Duration(blob);
  $("resDuration").textContent = Number.isFinite(duration) ? formatDuration(duration) : "?";
  $("resMeta").textContent = `${t("size")}: \u2066${fmtSize(blob.size)}\u2069 · Gemini (${job.request.mode === "conversation" ? job.request.voice + ", " + job.request.voice2 : job.request.voice})`;
  const safe = (job.request.title || "podcast").replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "podcast";
  $("download").href = url;
  $("download").download = `${safe}.mp3`;
  $("warnings").textContent = (job.warnings || []).join(" · ");
  const lines = job.script || job.narration;
  $("showScript").hidden = !lines;
  $("script").hidden = true;
  $("script").innerHTML = "";
  for (const line of lines || []) {
    const p = document.createElement("p");
    if (line.speaker) { const b = document.createElement("b"); b.textContent = line.speaker + ": "; p.append(b); }
    p.append(document.createTextNode(line.text));
    $("script").appendChild(p);
  }
  if (job.sources?.length) {
    const h = document.createElement("h3"); h.textContent = t("sourcesHead");
    const ol = document.createElement("ol");
    for (const s of job.sources.filter((x) => safeUrl(x.url))) {
      const li = document.createElement("li"), a = document.createElement("a");
      a.href = s.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = s.title;
      li.appendChild(a); ol.appendChild(li);
    }
    $("script").append(h, ol);
  }
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function restoreLastJob() {
  const id = store.get("lastJob", "");
  if (!id) return;
  try {
    const job = await A.store.loadJob(id);
    if (!job) return;
    state.job = job;
    if (job.status === "paused" || job.status === "running") {   // "running" = the page was closed mid-way
      showPaused(job);
    } else if (job.status === "done") {
      const blob = await A.store.getPart(job.id, "mp3");
      if (blob) await showResult(job, blob);
    }
  } catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------- wiring
function setSeg(id, v) { [...$(id).children].forEach((c) => c.classList.toggle("on", c.dataset.v === v)); }
function seg(id, k, onChange) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    state[k] = b.dataset.v; setSeg(id, state[k]); onChange?.();
  });
}
seg("langSeg", "lang", () => { state.langTouched = true; onTextChange(); });
seg("modeSeg", "mode", () => { renderVoices(); updateHint(); onTextChange(); });
seg("paceSeg", "pace");
seg("srcSeg", "src", () => { store.set("src", state.src); showError(""); applyUI(); });
$("researchBtn").addEventListener("click", findSources);
$("topic").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findSources(); } });
$("minutes").addEventListener("input", onTextChange);
$("minutes").addEventListener("change", saveTopicSetup);
$("customFocus").addEventListener("change", saveTopicSetup);
$("title").addEventListener("change", () => state.src === "topic" && saveTopicSetup());
state.voice = store.get("voice", state.voice);
state.voice2 = store.get("voice2", state.voice2);

$("text").addEventListener("input", onTextChange);
async function loadFile(file) {
  let text = await file.text();
  if (/\.html?$/i.test(file.name)) text = new DOMParser().parseFromString(text, "text/html").body.innerText;
  if (/\.(srt|vtt)$/i.test(file.name)) text = text.replace(/^\d+\s*$|^[\d:,.]+ --> [\d:,.]+.*$|^WEBVTT.*$/gm, "").replace(/\n{2,}/g, "\n");
  $("text").value = text;
  if ($("title").value === t("defaultTitle")) $("title").value = file.name.replace(/\.[^.]+$/, "");
  onTextChange();
}
$("fileInput").addEventListener("change", (e) => e.target.files[0] && loadFile(e.target.files[0]));
const dz = $("dropZone");
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]); });

$("generate").addEventListener("click", generate);
$("cancel").addEventListener("click", () => { state.cancel = true; });
$("resumeBtn").addEventListener("click", () => {
  if (!state.job || state.busy) return;
  showError("");
  state.job.status = "running";
  run(state.job);
});
$("showScript").addEventListener("click", () => {
  $("script").hidden = !$("script").hidden;
  $("showScript").textContent = $("script").hidden ? t("showScript") : t("hideScript");
});
$("uiLangBtn").addEventListener("click", () => { state.ui = state.ui === "he" ? "en" : "he"; store.set("ui", state.ui); applyUI(); });

async function saveKey(value) {
  value = value.trim();
  store.set("geminiKey", value);
  if (!value) { applyUI(); return; }
  $("keyMsg").textContent = t("keyChecking");
  try {
    await new Gemini(value).models();     // free call: listing models doesn't use any quota
    $("keyMsg").textContent = t("keyOk");
    setTimeout(applyUI, 900);
  } catch (e) {
    $("keyMsg").textContent = "✗ " + e.message;
  }
}
$("keySave").addEventListener("click", () => saveKey($("keyInput").value));

$("settingsBtn").addEventListener("click", () => {
  $("geminiKey").value = key();
  $("freeOnly").checked = store.get("freeOnly", "1") === "1";
  $("billing").checked = store.get("billing", "0") === "1";
  for (const id of ["limTtsRpd", "limTtsRpm", "limTextRpd"]) $(id).value = store.get(id, "");
  $("limTtsRpd").placeholder = DATA.FREE_DEFAULTS.gemini_tts.rpd;
  $("limTtsRpm").placeholder = DATA.FREE_DEFAULTS.gemini_tts.rpm;
  $("limTextRpd").placeholder = DATA.FREE_DEFAULTS.gemini_text.rpd;
  $("settings").showModal();
});
$("saveSettings").addEventListener("click", () => {
  store.set("freeOnly", $("freeOnly").checked ? "1" : "0");
  store.set("billing", $("billing").checked ? "1" : "0");
  for (const id of ["limTtsRpd", "limTtsRpm", "limTextRpd"]) store.set(id, intOrNull($(id).value) ?? "");
  if ($("geminiKey").value.trim() !== key()) saveKey($("geminiKey").value);
  else applyUI();
});

applyUI();
restoreTopicSetup();
applyUI();
restoreLastJob();
