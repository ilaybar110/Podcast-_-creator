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
};
const t = (k) => I18N[state.ui][k] ?? k;

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
  const r = await fetch(`/api/config?language=${state.lang}`, { headers: headers() });
  state.config = await r.json();
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
    card.innerHTML = `<button class="play" title="▶" aria-label="preview">▶</button>
      <div class="meta"><div class="name"></div><div class="desc"></div></div>`;
    card.querySelector(".name").textContent = v.name;
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
  $("generate").disabled = !state.engine || (state.mode === "conversation" && !state.config?.conversation_available);
}

let audioEl = null;
async function preview(voiceId, btn) {
  if (audioEl) { audioEl.pause(); audioEl = null; }
  document.querySelectorAll(".play").forEach((b) => { b.textContent = "▶"; });
  if (btn.dataset.playing === "1") { btn.dataset.playing = ""; return; }
  btn.classList.add("loading"); btn.textContent = "…";
  try {
    const r = await fetch("/api/preview", {
      method: "POST", headers: headers(),
      body: JSON.stringify({ language: state.lang, provider: state.engine, voice: voiceId, style: state.style, pace: state.pace }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    const url = URL.createObjectURL(await r.blob());
    audioEl = new Audio(url);
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
    const text = $("text").value;
    if (!text.trim()) { $("statChars").textContent = "0"; $("statWords").textContent = "0"; $("statEst").textContent = "0:00"; return; }
    const r = await fetch("/api/estimate", {
      method: "POST", headers: headers(),
      body: JSON.stringify({ text, language: state.langTouched ? state.lang : null, mode: state.mode }),
    });
    const d = await r.json();
    $("statChars").textContent = d.chars.toLocaleString();
    $("statWords").textContent = d.words.toLocaleString();
    $("statEst").textContent = "~" + d.estimated_str;
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

async function generate() {
  showError("");
  const text = $("text").value;
  if (!text.trim()) return showError(t("emptyText"));
  $("result").hidden = true;
  $("generate").disabled = true;
  $("progress").hidden = false;
  $("stage").textContent = t("starting");
  $("barFill").style.width = "1%";
  const r = await fetch("/api/jobs", {
    method: "POST", headers: headers(),
    body: JSON.stringify({
      text, language: state.lang, mode: state.mode, provider: state.engine, voice: state.voice,
      voice2: state.voice2, style: state.style, pace: state.pace, warm_master: $("warm").checked,
      title: $("title").value || t("defaultTitle"),
    }),
  });
  const d = await r.json();
  if (!r.ok) { finish(); return showError(d.detail?.[0]?.msg || d.detail || "Error"); }
  state.jobId = d.id;
  poll();
}

async function poll() {
  clearTimeout(state.timer);
  const r = await fetch(`/api/jobs/${state.jobId}`);
  if (!r.ok) { finish(); return showError((await r.json()).detail); }
  const j = await r.json();
  $("barFill").style.width = Math.max(1, j.progress * 100) + "%";
  $("pct").textContent = Math.round(j.progress * 100) + "%";
  $("stage").textContent = j.stage;
  $("elapsed").textContent = fmtSec(j.elapsed_sec);
  if (j.status === "done") { finish(); return showResult(j); }
  if (j.status === "error" || j.status === "cancelled") { finish(); return showError(j.error || j.stage); }
  state.timer = setTimeout(poll, 1500);
}

function finish() { $("progress").hidden = true; updateModeHint(); }

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
$("engine").addEventListener("change", (e) => { state.engine = e.target.value; store.set("engine", state.engine); pickDefaults(); renderVoices(); updateModeHint(); });
$("text").addEventListener("input", onTextChange);
$("fileInput").addEventListener("change", (e) => e.target.files[0] && loadFile(e.target.files[0]));
const dz = $("dropZone");
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]); });
$("generate").addEventListener("click", generate);
$("cancel").addEventListener("click", () => state.jobId && fetch(`/api/jobs/${state.jobId}/cancel`, { method: "POST" }));
$("showScript").addEventListener("click", () => {
  $("script").hidden = !$("script").hidden;
  $("showScript").textContent = $("script").hidden ? t("showScript") : t("hideScript");
});
$("uiLangBtn").addEventListener("click", () => { state.ui = state.ui === "he" ? "en" : "he"; store.set("ui", state.ui); applyUI(); loadConfig(); });
$("settingsBtn").addEventListener("click", () => {
  $("geminiKey").value = store.get("geminiKey", ""); $("elevenKey").value = store.get("elevenKey", "");
  $("settings").showModal();
});
$("saveKeys").addEventListener("click", () => {
  store.set("geminiKey", $("geminiKey").value.trim()); store.set("elevenKey", $("elevenKey").value.trim());
  loadConfig();
});

applyUI();
loadConfig();
