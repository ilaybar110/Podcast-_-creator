"use strict";

const I18N = {
  he: {
    title: "יוצר הפודקאסטים", subtitle: "כל טקסט, בכל אורך — לפודקאסט MP3 בקול אנושי וחם",
    settings: "הגדרות", step1: "הטקסט שלך", upload: "העלאת קובץ",
    placeholder: "הדביקו כאן טקסט באורך כלשהו — מאמר, פרק מספר, סיכום, תסריט... או גררו קובץ (TXT, PDF, Word)",
    chars: "תווים", words: "מילים", estimate: "אורך משוער", step2: "הקול", language: "שפת הפודקאסט",
    format: "פורמט", narrator: "קריין אחד", conversation: "שיחה בין שני מגישים", engine: "מנוע קול",
    voice: "בחרו קול", voice2: "קול המגיש/ה השני/ה", style: "סגנון", pace: "קצב", relaxed: "רגוע",
    natural: "טבעי", brisk: "מהיר", ptitle: "שם הפרק",
    warm: "מאסטרינג חם — EQ, דחיסה עדינה ועוצמת שמע סטנדרטית לפודקאסט", generate: "צרו את הפודקאסט",
    cancel: "ביטול", ready: "הפודקאסט מוכן", exactLength: "אורך מדויק", download: "הורדת MP3",
    showScript: "הצגת התסריט", hideScript: "הסתרת התסריט",
    keysHint: "המפתחות נשמרים רק בדפדפן שלכם ונשלחים לשרת שלכם בלבד. אם השרת כבר מוגדר עם מפתחות — אפשר להשאיר ריק.",
    getKey: "(קבלת מפתח חינם)", save: "שמירה", recommended: "מומלץ", female: "אישה", male: "גבר",
    showAll: "הצגת כל הקולות", showLess: "רק הקולות המומלצים", noEngine: "לא מוגדר",
    narratorHint: "קריין/ית אחד/ת מקריא/ה את הטקסט שלכם מילה במילה, בקול חם וטבעי.",
    convHint: "הטקסט הופך לשיחה טבעית בין שני מגישים (נועה ויוני) שמכסה את כל התוכן — כמו פודקאסט אמיתי.",
    convNeedsGemini: "מצב שיחה דורש מפתח Gemini (בהגדרות).",
    noVoices: "אין מנוע קול זמין. הוסיפו מפתח Gemini בהגדרות.",
    emptyText: "הדביקו טקסט קודם.", starting: "מתחילים…", size: "גודל", engineL: "מנוע",
    humanness: "מדד אנושיות", previewFail: "התצוגה המקדימה נכשלה",
    edgeNote: "קולות Microsoft החינמיים טובים בהרבה מ'כרמית', אבל לקול הכי חם ואנושי מומלץ Gemini.",
    defaultTitle: "הפודקאסט שלי",
    resume: "המשך יצירה", freeTitle: "שמירה על מסלול חינמי",
    freeOnly: "מצב חינם בלבד: לעולם לא לעבור את המכסה החינמית (עוצר וממשיך מחר במקום לשלם)",
    billing: "בפרויקט Google של המפתח מוגדר חיוב (Billing)",
    billingHint: "הכי בטוח: מפתח מפרויקט בלי חיוב — כך Google לא יכולה לחייב אתכם בכלל, ובמקרה הגרוע תקבלו הודעת \"מכסה נגמרה\".",
    limitsHint: "המגבלות החינמיות משתנות לפי פרויקט. האפליקציה לומדת את המגבלה האמיתית מ-Google אוטומטית; אפשר גם להזין ידנית לפי",
    ttsPerDay: "בקשות קול ליום", ttsPerMin: "בקשות קול לדקה", textPerDay: "בקשות תסריט ליום",
    fUnlimited: "✓ <b>חינם לגמרי</b> — קולות Microsoft, ללא מכסה.",
    fFree: "✓ <b>חינם</b> — ישתמש ב-{need} מתוך {left} בקשות קול חינמיות שנותרו היום.",
    fFreeScript: " + {need} בקשות לכתיבת התסריט (נותרו {left}).",
    fMinutes: "בגלל מגבלת {rpm} בקשות לדקה, היצירה תיקח לפחות ~{min} דק׳.",
    fMulti: "⏳ <b>חינם, אבל דורש {days} ימים של מכסה חינמית.</b> היצירה תיעצר כשהמכסה תיגמר, ותוכלו להמשיך אחרי האיפוס ({reset}) — בלי לשלם.",
    fNotFree: "✗ <b>לא חינם</b> — דורש {need} תווים, ונותרו {left} במכסה. קצרו את הטקסט או בחרו בקולות Microsoft החינמיים.",
    fPaid: "💳 <b>בתשלום</b> — במפתח מוגדר חיוב, כך שכל בקשה עולה כסף.",
    fPlan: "✓ <b>ללא עלות נוספת</b> — {need} תווים מתוך {left} שנותרו בקרדיטים של המנוי שלכם.",
    fElevenFree: "✓ <b>חינם</b> — {need} תווים מתוך {left} שנותרו במכסה החודשית החינמית.",
    fUnknown: "? לא ניתן לבדוק את המכסה החינמית למנוע הזה.",
    fOff: " (מצב חינם בלבד כבוי — ייתכנו חיובים או שגיאות מכסה)",
    fReserve: "כולל רזרבה של {reserve} להקלטות חוזרות.",
    confirmMulti: "הפודקאסט הזה דורש {days} ימים של מכסה חינמית. היצירה תיעצר כשהמכסה תיגמר ותוכלו ללחוץ \"המשך יצירה\" אחרי האיפוס. להתחיל?",
    pausedText: "המכסה החינמית להיום נגמרה, אז עצרנו כדי שלא תשלמו. החלקים שכבר הוקלטו נשמרו. אפשר להמשיך אחרי {reset}.",
    previewCost: "השמעה לדוגמה (משתמשת בבקשה חינמית אחת בפעם הראשונה)",
  },
  en: {
    title: "Podcast Creator", subtitle: "Any text, any length — into a warm, human-sounding podcast MP3",
    settings: "Settings", step1: "Your text", upload: "Upload file",
    placeholder: "Paste text of any length — an article, a book chapter, notes, a script... or drop a file (TXT, PDF, Word)",
    chars: "characters", words: "words", estimate: "Estimated length", step2: "Voice", language: "Podcast language",
    format: "Format", narrator: "Single narrator", conversation: "Two-host conversation", engine: "Voice engine",
    voice: "Choose a voice", voice2: "Second host's voice", style: "Style", pace: "Pace", relaxed: "Relaxed",
    natural: "Natural", brisk: "Brisk", ptitle: "Episode title",
    warm: "Warm mastering (EQ, gentle compression, podcast loudness -16 LUFS)", generate: "Create podcast",
    cancel: "Cancel", ready: "Your podcast is ready", exactLength: "Exact length", download: "Download MP3",
    showScript: "Show script", hideScript: "Hide script",
    keysHint: "Keys are stored only in your browser and sent only to your own server. Leave empty if the server already has keys.",
    getKey: "(get a free key)", save: "Save", recommended: "Recommended", female: "Female", male: "Male",
    showAll: "Show all voices", showLess: "Recommended voices only", noEngine: "not configured",
    narratorHint: "One narrator reads your text word for word in a warm, natural voice.",
    convHint: "Your text becomes a natural conversation between two hosts that covers all of it — like a real podcast.",
    convNeedsGemini: "Conversation mode needs a Gemini API key (Settings).",
    noVoices: "No voice engine available. Add a Gemini key in Settings.",
    emptyText: "Paste some text first.", starting: "Starting…", size: "Size", engineL: "Engine",
    humanness: "Humanness score", previewFail: "Preview failed",
    edgeNote: "The free Microsoft voices beat old voices like Carmit, but Gemini gives the warmest, most human sound.",
    defaultTitle: "My podcast",
    resume: "Continue", freeTitle: "Stay on the free tier",
    freeOnly: "Free-only mode: never go past the free quota (pause and continue tomorrow instead of paying)",
    billing: "The key's Google project has billing enabled",
    billingHint: "Safest: use a key from a project with no billing. Then Google cannot charge you at all; the worst case is a 'quota exceeded' message.",
    limitsHint: "Free limits differ per project. The app learns the real limit from Google automatically; you can also enter it from",
    ttsPerDay: "Voice requests / day", ttsPerMin: "Voice requests / minute", textPerDay: "Script requests / day",
    fUnlimited: "✓ <b>Completely free</b> — Microsoft voices, no quota.",
    fFree: "✓ <b>Free</b> — uses {need} of the {left} free voice requests left today.",
    fFreeScript: " + {need} requests to write the script ({left} left).",
    fMinutes: "Because of the {rpm} requests/minute limit, it will take at least ~{min} min.",
    fMulti: "⏳ <b>Free, but needs {days} days of free quota.</b> It will pause when the quota runs out and you can continue after the reset ({reset}) — without paying.",
    fNotFree: "✗ <b>Not free</b> — needs {need} characters, only {left} left in your quota. Shorten the text or use the free Microsoft voices.",
    fPaid: "💳 <b>Paid</b> — billing is enabled on this key, so every request costs money.",
    fPlan: "✓ <b>No extra cost</b> — {need} of the {left} characters left in your plan's credits.",
    fElevenFree: "✓ <b>Free</b> — {need} of the {left} characters left in your free monthly quota.",
    fUnknown: "? Couldn't check the free quota for this engine.",
    fOff: " (free-only mode is OFF — you may be charged or hit quota errors)",
    fReserve: "Includes {reserve} spare for re-recording bad takes.",
    confirmMulti: "This podcast needs {days} days of free quota. It will pause when the quota runs out and you can press \"Continue\" after the reset. Start?",
    pausedText: "Today's free quota is used up, so we paused instead of charging you. Everything recorded so far is saved. You can continue after {reset}.",
    previewCost: "Preview (uses one free request the first time)",
  },
};
const DESC_HE = {
  Warm: "חם", Friendly: "ידידותי", Gentle: "עדין", Smooth: "חלק ונעים", Mature: "בוגר", "Easy-going": "נינוח",
  Breezy: "קליל", Knowledgeable: "בקיא", Soft: "רך", Informative: "אינפורמטיבי", Casual: "יומיומי",
  Lively: "תוסס", Breathy: "אוורירי", Clear: "צלול", Firm: "תקיף", Youthful: "צעיר", Bright: "בהיר",
  Upbeat: "עליז", Forward: "ישיר", Excitable: "נלהב", Gravelly: "מחוספס", Even: "מאוזן",
  "Israeli Hebrew": "עברית ישראלית", clear: "צלול",
};

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = {
  ui: store.get("ui", "he"),
  lang: "he", mode: "narrator", engine: store.get("engine", "auto"), style: "warm", pace: "natural",
  voice: "", voice2: "", showAll: false, config: null, langTouched: false, jobId: null, timer: null,
  busy: false, cfgSeq: 0, estSeq: 0,
};
const t = (k) => I18N[state.ui][k] ?? k;

function fmt(s, vars) { return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ""); }
function intOrNull(v) { const n = parseInt(v, 10); return n > 0 ? n : null; }
function freeOpts() {
  const lim = (k) => intOrNull(store.get(k, ""));
  const limits = {};
  const tts = {}, txt = {};
  if (lim("limTtsRpd")) tts.rpd = lim("limTtsRpd");
  if (lim("limTtsRpm")) tts.rpm = lim("limTtsRpm");
  if (lim("limTextRpd")) txt.rpd = lim("limTextRpd");
  if (Object.keys(tts).length) limits.gemini_tts = tts;
  if (Object.keys(txt).length) limits.gemini_text = txt;
  return { free_only: store.get("freeOnly", "1") === "1", billing: store.get("billing", "0") === "1", limits };
}
function resetTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(state.ui === "he" ? "he-IL" : "en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function renderFree(f) {
  const el = $("freeBadge");
  state.free = f;
  if (!f) { el.hidden = true; return; }
  let cls = "ok", html = "";
  const b = f.buckets || {};
  const tts = b.gemini_tts, txt = b.gemini_text || f.script?.buckets?.gemini_text;
  if (f.unlimited) html = t("fUnlimited");
  else if (f.status === "paid") { cls = "bad"; html = t("fPaid"); }
  else if (f.status === "unknown") { cls = "wait"; html = t("fUnknown"); }
  else if (f.status === "not_free") { cls = "bad"; html = fmt(t("fNotFree"), { need: f.needed_chars?.toLocaleString(), left: f.left_chars?.toLocaleString() }); }
  else if (f.status === "free_multi_day") { cls = "wait"; html = fmt(t("fMulti"), { days: f.days, reset: resetTime(f.reset_at || f.script?.reset_at) }); }
  else if (f.engine === "elevenlabs") html = fmt(t(f.status === "plan_credits" ? "fPlan" : "fElevenFree"), { need: f.needed_chars.toLocaleString(), left: f.left_chars.toLocaleString() });
  else if (tts) html = fmt(t("fFree"), { need: tts.needed + tts.reserve, left: tts.left_today });
  else html = t("fUnlimited");
  if (txt && f.status !== "paid" && f.status !== "not_free") html += fmt(t("fFreeScript"), { need: txt.needed + txt.reserve, left: txt.left_today });
  const sub = [];
  if (tts && tts.reserve) sub.push(fmt(t("fReserve"), { reserve: tts.reserve }));
  if (tts && tts.minutes_at_least >= 1) sub.push(fmt(t("fMinutes"), { rpm: tts.per_minute, min: Math.ceil(tts.minutes_at_least) }));
  if (!freeOpts().free_only && !f.unlimited && f.status !== "free") html += t("fOff");
  el.className = "free-badge " + cls;
  el.innerHTML = html + (sub.length ? `<div class="sub">${sub.join(" ")}</div>` : "");
  el.hidden = false;
}

function headers() {
  const h = { "Content-Type": "application/json" };
  const g = store.get("geminiKey", ""), e = store.get("elevenKey", "");
  if (g) h["X-Gemini-Key"] = g;
  if (e) h["X-ElevenLabs-Key"] = e;
  return h;
}

function applyUI() {
  document.documentElement.lang = state.ui;
  document.documentElement.dir = state.ui === "he" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  $("uiLangBtn").textContent = state.ui === "he" ? "English" : "עברית";
  if (!$("title").value || Object.values(I18N).some((d) => d.defaultTitle === $("title").value)) {
    $("title").value = t("defaultTitle");
  }
  renderVoices();
  updateModeHint();
}

function seg(id, key, onChange) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    state[key] = b.dataset.v;
    [...$(id).children].forEach((c) => c.classList.toggle("on", c === b));
    onChange && onChange();
  });
}
function setSeg(id, v) { [...$(id).children].forEach((c) => c.classList.toggle("on", c.dataset.v === v)); }

async function loadConfig() {
  const seq = ++state.cfgSeq;
  let cfg;
  try {
    const r = await fetch(`/api/config?language=${state.lang}`, { headers: headers() });
    cfg = await r.json();
  } catch (err) { return showError(err.message); }
  if (seq !== state.cfgSeq) return;          // a newer request (e.g. language switch) won
  state.config = cfg;
  const sel = $("engine");
  sel.innerHTML = "";
  const firstAvail = state.config.engines.find((e) => e.available);
  for (const e of state.config.engines) {
    const o = document.createElement("option");
    o.value = e.id;
    o.textContent = e.available ? e.label : `${e.label} — ${t("noEngine")}`;
    o.disabled = !e.available;
    sel.appendChild(o);
  }
  const wanted = state.config.engines.find((e) => e.id === state.engine && e.available);
  state.engine = (wanted || firstAvail || {}).id || "";
  sel.value = state.engine;
  const chips = $("styles");
  chips.innerHTML = "";
  for (const s of state.config.styles) {
    const b = document.createElement("button");
    b.className = "chip" + (s.id === state.style ? " on" : "");
    b.textContent = s.label;
    b.onclick = () => { state.style = s.id; [...chips.children].forEach((c) => c.classList.toggle("on", c === b)); };
    chips.appendChild(b);
  }
  pickDefaults();
  renderVoices();
  updateModeHint();
}

function engine() { return state.config?.engines.find((e) => e.id === state.engine); }

function pickDefaults() {
  const e = engine();
  if (!e || !e.voices.length) { state.voice = state.voice2 = ""; return; }
  const ids = e.voices.map((v) => v.id);
  if (!ids.includes(state.voice)) state.voice = e.defaults?.[0] || ids[0];
  if (!ids.includes(state.voice2) || state.voice2 === state.voice) {
    state.voice2 = e.defaults?.[1] && e.defaults[1] !== state.voice ? e.defaults[1] : ids.find((i) => i !== state.voice) || ids[0];
  }
}

function voiceDesc(v) {
  if (state.ui !== "he") return v.description;
  return v.description.split(",").map((s) => DESC_HE[s.trim()] || s.trim()).join(", ");
}

function renderVoiceGrid(container, key) {
  container.innerHTML = "";
  const e = engine();
  if (!e || !e.voices.length) { container.innerHTML = `<p class="hint">${t("noVoices")}</p>`; return; }
  const list = state.showAll ? e.voices : e.voices.filter((v) => v.recommended || v.id === state[key]);
  for (const v of (list.length ? list : e.voices)) {
    const card = document.createElement("div");
    card.className = "voice" + (state[key] === v.id ? " on" : "");
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.innerHTML = `<button class="play" aria-label="preview">▶</button>
      <div class="meta"><div class="name"></div><div class="desc"></div></div>`;
    card.querySelector(".name").textContent = v.name;
    card.querySelector(".play").title = state.engine === "edge" ? "▶" : t("previewCost");
    if (v.recommended) {
      const s = document.createElement("span"); s.className = "star"; s.textContent = "★ " + t("recommended");
      card.querySelector(".name").appendChild(s);
    }
    const gender = v.gender === "female" ? t("female") : v.gender === "male" ? t("male") : "";
    card.querySelector(".desc").textContent = [gender, voiceDesc(v)].filter(Boolean).join(" · ");
    const choose = () => { state[key] = v.id; renderVoices(); };
    card.addEventListener("click", (ev) => { if (!ev.target.closest(".play")) choose(); });
    card.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); choose(); } });
    card.querySelector(".play").addEventListener("click", (ev) => { ev.stopPropagation(); preview(v.id, ev.currentTarget); });
    container.appendChild(card);
  }
  if (e.voices.some((v) => !v.recommended)) {
    const more = document.createElement("button");
    more.className = "chip";
    more.textContent = state.showAll ? t("showLess") : t("showAll");
    more.onclick = () => { state.showAll = !state.showAll; renderVoices(); };
    container.appendChild(more);
  }
}

function renderVoices() {
  if (!state.config) return;
  renderVoiceGrid($("voices"), "voice");
  $("voice2Wrap").hidden = state.mode !== "conversation";
  if (state.mode === "conversation") renderVoiceGrid($("voices2"), "voice2");
}

function updateModeHint() {
  let h = state.mode === "conversation" ? t("convHint") : t("narratorHint");
  if (state.mode === "conversation" && !state.config?.conversation_available) h = t("convNeedsGemini");
  if (state.engine === "edge") h += " " + t("edgeNote");
  $("modeHint").textContent = h;
  $("generate").disabled = state.busy || !state.engine || (state.mode === "conversation" && !state.config?.conversation_available);
}

let audioEl = null, previewSeq = 0;
function stopPreview() {
  if (audioEl) { audioEl.pause(); URL.revokeObjectURL(audioEl.src); audioEl = null; }
}
async function preview(voiceId, btn) {
  const seq = ++previewSeq;
  stopPreview();
  document.querySelectorAll(".play").forEach((b) => { b.textContent = "▶"; });
  if (btn.dataset.playing === "1") { btn.dataset.playing = ""; return; }
  btn.classList.add("loading"); btn.textContent = "…";
  try {
    const r = await fetch("/api/preview", {
      method: "POST", headers: headers(),
      body: JSON.stringify({ language: state.lang, provider: state.engine, voice: voiceId, style: state.style, pace: state.pace, ...freeOpts() }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    const blob = await r.blob();
    if (seq !== previewSeq) return;          // another preview was clicked meanwhile
    audioEl = new Audio(URL.createObjectURL(blob));
    document.querySelectorAll(".play").forEach((b) => { b.dataset.playing = ""; });
    btn.dataset.playing = "1"; btn.textContent = "❚❚";
    audioEl.onended = () => { btn.textContent = "▶"; btn.dataset.playing = ""; };
    await audioEl.play();
  } catch (err) {
    btn.textContent = "▶";
    showError(`${t("previewFail")}: ${err.message}`);
  } finally { btn.classList.remove("loading"); }
}

// ---------------------------------------------------------------- estimate
let estTimer = null;
function onTextChange() {
  clearTimeout(estTimer);
  estTimer = setTimeout(async () => {
    const seq = ++state.estSeq;
    const text = $("text").value;
    if (!text.trim()) { $("statChars").textContent = "0"; $("statWords").textContent = "0"; $("statEst").textContent = "0:00"; renderFree(null); return; }
    const r = await fetch("/api/estimate", {
      method: "POST", headers: headers(),
      body: JSON.stringify({ text, language: state.langTouched ? state.lang : null, mode: state.mode,
                             provider: state.engine || "auto", ...freeOpts() }),
    });
    const d = await r.json();
    if (seq !== state.estSeq || !r.ok) return;   // a newer keystroke's estimate is coming
    $("statChars").textContent = d.chars.toLocaleString();
    $("statWords").textContent = d.words.toLocaleString();
    $("statEst").textContent = "~" + d.estimated_str;
    renderFree(d.free);
    if (!state.langTouched && d.language !== state.lang) {
      state.lang = d.language; setSeg("langSeg", state.lang); await loadConfig();
    }
  }, 350);
}

async function loadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/extract", { method: "POST", body: fd });
  const d = await r.json();
  if (!r.ok) return showError(d.detail || "Upload failed");
  $("text").value = d.text;
  if ($("title").value === t("defaultTitle")) $("title").value = file.name.replace(/\.[^.]+$/, "");
  onTextChange();
}

// ---------------------------------------------------------------- jobs
function showError(msg) { $("error").hidden = !msg; $("error").textContent = msg || ""; }
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB"; }
function fmtSec(s) { s = Math.round(s); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; }

async function readJSON(r) {
  try { return await r.json(); } catch { return { detail: `${r.status} ${r.statusText}` }; }
}
function errText(d) {
  return Array.isArray(d.detail) ? d.detail.map((x) => x.msg).join(", ") : (d.detail || d.error || "Error");
}

async function generate() {
  if (state.busy) return;
  showError("");
  const text = $("text").value;
  if (!text.trim()) return showError(t("emptyText"));
  if (state.free?.status === "free_multi_day" && freeOpts().free_only &&
      !confirm(fmt(t("confirmMulti"), { days: state.free.days }))) return;
  $("result").hidden = true;
  $("paused").hidden = true;
  state.busy = true;
  $("generate").disabled = true;
  $("progress").hidden = false;
  $("stage").textContent = t("starting");
  $("barFill").style.width = "1%";
  try {
    const r = await fetch("/api/jobs", {
      method: "POST", headers: headers(),
      body: JSON.stringify({
        text, language: state.lang, mode: state.mode, provider: state.engine, voice: state.voice,
        voice2: state.voice2, style: state.style, pace: state.pace, warm_master: $("warm").checked,
        title: $("title").value || t("defaultTitle"), ...freeOpts(),
      }),
    });
    const d = await readJSON(r);
    if (!r.ok) { finish(); return showError(errText(d)); }
    state.jobId = d.id;
    store.set("lastJob", d.id);
    poll();
  } catch (err) { finish(); showError(err.message); }
}

let pollFailures = 0;
async function poll() {
  clearTimeout(state.timer);
  let r, j;
  try {
    r = await fetch(`/api/jobs/${state.jobId}`);
    j = await readJSON(r);
  } catch (err) {                       // transient network blip: keep trying for a while
    if (++pollFailures < 20) { state.timer = setTimeout(poll, 3000); return; }
    finish(); return showError(err.message);
  }
  pollFailures = 0;
  if (!r.ok) { finish(); return showError(errText(j)); }
  $("barFill").style.width = Math.max(1, j.progress * 100) + "%";
  $("pct").textContent = Math.round(j.progress * 100) + "%";
  $("stage").textContent = j.stage;
  $("elapsed").textContent = fmtSec(j.elapsed_sec);
  if (j.status === "done") { finish(); return showResult(j); }
  if (j.status === "error" || j.status === "cancelled") { finish(); return showError(j.error || j.stage); }
  if (j.status === "paused") {
    finish();
    $("pausedText").textContent = fmt(t("pausedText"), { reset: resetTime(j.resume_at) });
    $("paused").hidden = false;
    onTextChange();          // refresh the free-quota badge
    return;
  }
  state.timer = setTimeout(poll, 1500);
}

function finish() { state.busy = false; $("progress").hidden = true; updateModeHint(); }

async function showResult(j) {
  const res = j.result;
  $("result").hidden = false;
  $("resDuration").textContent = res.duration_str;
  $("resMeta").textContent = `${t("size")}: ${fmtSize(res.size_bytes)} · ${t("engineL")}: ${res.provider} (${res.voices.join(", ")}) · ${t("humanness")}: ${res.humanness}/100`;
  $("player").src = res.url;
  $("download").href = res.download_url;
  $("warnings").textContent = (j.warnings || []).join(" · ");
  $("script").hidden = true;
  $("showScript").hidden = !j.has_script;
  $("showScript").textContent = t("showScript");
  if (j.has_script) {
    const s = await (await fetch(`/api/jobs/${j.id}/script`)).json();
    $("script").innerHTML = "";
    for (const line of s.script) {
      const p = document.createElement("p");
      const b = document.createElement("b"); b.textContent = line.speaker + ": ";
      p.append(b, document.createTextNode(line.text));
      $("script").appendChild(p);
    }
  }
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------- wiring
seg("langSeg", "lang", async () => { state.langTouched = true; state.voice = state.voice2 = ""; await loadConfig(); onTextChange(); });
seg("modeSeg", "mode", () => { renderVoices(); updateModeHint(); onTextChange(); });
seg("paceSeg", "pace");
$("engine").addEventListener("change", (e) => { state.engine = e.target.value; store.set("engine", state.engine); pickDefaults(); renderVoices(); updateModeHint(); onTextChange(); });
$("text").addEventListener("input", onTextChange);
$("fileInput").addEventListener("change", (e) => e.target.files[0] && loadFile(e.target.files[0]));
const dz = $("dropZone");
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]); });
$("generate").addEventListener("click", generate);
$("resumeBtn").addEventListener("click", async () => {
  if (!state.jobId || state.busy) return;
  showError("");
  const r = await fetch(`/api/jobs/${state.jobId}/resume`, { method: "POST" });
  const d = await readJSON(r);
  if (!r.ok) return showError(errText(d));
  $("paused").hidden = true;
  state.busy = true; $("generate").disabled = true; $("progress").hidden = false;
  poll();
});
$("cancel").addEventListener("click", () => state.jobId && fetch(`/api/jobs/${state.jobId}/cancel`, { method: "POST" }));
$("showScript").addEventListener("click", () => {
  $("script").hidden = !$("script").hidden;
  $("showScript").textContent = $("script").hidden ? t("showScript") : t("hideScript");
});
$("uiLangBtn").addEventListener("click", () => { state.ui = state.ui === "he" ? "en" : "he"; store.set("ui", state.ui); applyUI(); loadConfig(); });
$("settingsBtn").addEventListener("click", () => {
  $("geminiKey").value = store.get("geminiKey", ""); $("elevenKey").value = store.get("elevenKey", "");
  $("freeOnly").checked = store.get("freeOnly", "1") === "1";
  $("billing").checked = store.get("billing", "0") === "1";
  for (const id of ["limTtsRpd", "limTtsRpm", "limTextRpd"]) $(id).value = store.get(id, "");
  const d = state.config?.free_defaults;
  if (d) {
    $("limTtsRpd").placeholder = d.gemini_tts.rpd; $("limTtsRpm").placeholder = d.gemini_tts.rpm;
    $("limTextRpd").placeholder = d.gemini_text.rpd;
  }
  $("settings").showModal();
});
$("saveKeys").addEventListener("click", () => {
  store.set("geminiKey", $("geminiKey").value.trim()); store.set("elevenKey", $("elevenKey").value.trim());
  store.set("freeOnly", $("freeOnly").checked ? "1" : "0");
  store.set("billing", $("billing").checked ? "1" : "0");
  for (const id of ["limTtsRpd", "limTtsRpm", "limTextRpd"]) store.set(id, intOrNull($(id).value) ?? "");
  loadConfig().then(onTextChange);
});

async function restoreLastJob() {
  // A podcast paused by the free quota survives closing the page: show it again.
  const id = store.get("lastJob", "");
  if (!id) return;
  try {
    const r = await fetch(`/api/jobs/${id}`);
    if (!r.ok) return;
    const j = await r.json();
    state.jobId = id;
    if (j.status === "paused") {
      $("pausedText").textContent = fmt(t("pausedText"), { reset: resetTime(j.resume_at) });
      $("paused").hidden = false;
    } else if (j.status === "running" || j.status === "queued") {
      state.busy = true; $("progress").hidden = false; poll();
    } else if (j.status === "done") {
      showResult(j);
    }
  } catch { /* server restarted: nothing to restore */ }
}

applyUI();
loadConfig().then(restoreLastJob);
