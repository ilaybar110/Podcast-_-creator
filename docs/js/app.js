// UI for the browser-only edition (GitHub Pages). No server: the page talks to Google directly.
import { cleanText, detectLanguage, estimateSeconds, formatDuration } from "./text.js";
import { STYLES } from "./prompts.js";
import { DATA } from "./prompts_data.js";
import { Gemini, QuotaExhausted, VOICES, freeVerdict, withRetries } from "./gemini.js";
import { Cancelled, hostNames, planParts, runJob } from "./job.js";
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
    keyStep1: 'היכנסו ל-<bdi dir="ltr"><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></bdi> עם חשבון <bdi>Google</bdi>.',
    keyStep2: 'לחצו <bdi dir="ltr">"Create API key"</bdi> והעתיקו את המפתח. עדיף בפרויקט בלי חיוב (<bdi>Billing</bdi>) — כך אי אפשר לחייב אתכם.',
    keyStep3: "הדביקו אותו כאן. המפתח נשמר רק בטלפון שלכם ונשלח ישירות ל-<bdi>Google</bdi>.",
    keyChecking: "בודקים את המפתח…", keyOk: "✓ המפתח עובד. אפשר להתחיל!",
    privacy: "הכול רץ בדפדפן שלכם. הטקסט והמפתח נשלחים ל-<bdi>Google</bdi>; במצב נושא, מילות הנושא נשלחות גם ל-<bdi>Wikipedia</bdi>.",
    rememberKey: "זכור את המפתח במכשיר הזה (אם כבוי, הוא נשמר רק עד סגירת הלשונית)",
    forgetKey: "שכחו את המפתח", clearAll: "מחיקת כל הנתונים שלי",
    keyForgotten: "המפתח נמחק מהמכשיר הזה.",
    confirmClear: "למחוק מהמכשיר הזה את המפתח, ההגדרות, מעקב המכסה, הפודקאסטים השמורים ודוגמאות הקול? אי אפשר לשחזר.",
    clearedAll: "כל הנתונים נמחקו מהמכשיר הזה.",
    keyRestrictHint: "טיפ אבטחה: ב-Google AI Studio / Cloud Console הגבילו את המפתח ל-Generative Language API בלבד (ואפשר גם להגביל לדומיין של האתר הזה כ-HTTP referrer), והשאירו חיוב (Billing) כבוי.",
    resume: "המשך יצירה", freeTitle: "שמירה על מסלול חינמי",
    freeOnly: "מצב חינם בלבד: לעולם לא לעבור את המכסה החינמית (עוצר וממשיך מחר במקום לשלם)",
    billing: "בפרויקט Google של המפתח מוגדר חיוב (Billing)",
    billingHint: "הכי בטוח: מפתח מפרויקט בלי חיוב — כך Google לא יכולה לחייב אתכם בכלל, ובמקרה הגרוע תקבלו הודעת \"מכסה נגמרה\".",
    limitsHint: "המגבלות החינמיות משתנות לפי פרויקט. האפליקציה לומדת את המגבלה האמיתית מ-Google אוטומטית; אפשר גם להזין ידנית לפי",
    ttsPerDay: "בקשות קול ליום", ttsPerMin: "בקשות קול לדקה", textPerDay: "בקשות תסריט ליום",
    fFree: "✓ <b>חינם</b> — ישתמש ב-{need} מתוך {left} בקשות קול חינמיות שנותרו היום.",
    fFreeScript: " + {need} בקשות לכתיבת התסריט (נותרו {left}).",
    fMinutes: "בגלל מגבלת {rpm} בקשות לדקה, היצירה תיקח לפחות ~{min} דק׳.",
    fWait: "⏳ <b>מכסת הקול החינמית של היום נגמרה.</b> אפשר ללחוץ יצירה: ההקלטה תחכה לאיפוס ({reset}) ותמשיך מעצמה כשתלחצו \"המשך יצירה\" — בלי לשלם.",
    confirmWait: "מכסת הקול החינמית של היום נגמרה. ההקלטה תחכה לאיפוס ותמשיכו אחריו ב\"המשך יצירה\". להתחיל?",
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
    topicPlaceholder: "למשל: איך עובד הזיכרון האנושי",
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
    cantResume: "אי אפשר להמשיך את היצירה הזו — צרו את הפודקאסט מחדש.",
    errorText: "היצירה נעצרה בגלל שגיאה. החלקים שכבר הוקלטו שמורים — אפשר לנסות להמשיך מאיפה שעצרנו.",
    noStorage: "הדפדפן לא מאפשר שמירה במכשיר (אולי גלישה פרטית), אז היצירה תרוץ בזיכרון בלבד: אי אפשר יהיה לעצור ולהמשיך אחר כך. השאירו את הדף פתוח עד הסוף.",
    voiceStyle: "קול וסגנון", change: "שינוי", done: "סגירה", close: "סגירה",
    share: "שיתוף / שמירה בקבצים", shareFail: "השיתוף נכשל", playSample: "השמעת דוגמה של {name}",
    geminiKeyLabel: "מפתח <bdi>Gemini API</bdi>", geminiKeyAria: "מפתח Gemini API", srcAria: "מקור הפודקאסט",
    progressAria: "התקדמות היצירה",
    lockWarn: "<b>אל תנעלו את המסך ואל תעברו לאפליקציה אחרת</b> עד שהפודקאסט מוכן — המסך נשמר דלוק בזמן היצירה.",
    lockWarnNoWake: "<b>אל תנעלו את המסך ואל תעברו לאפליקציה אחרת</b> עד שהפודקאסט מוכן. הדפדפן הזה לא תומך בשמירת המסך דלוק, אז כדאי להקיש על המסך מדי פעם.",
    lockEtaMin: "זמן יצירה משוער: לפחות ~{min} דק׳.", lockEtaLen: "אורך הפודקאסט המשוער: ~{len}. היצירה אורכת כמה דקות.",
    infoFree: "✓ חינם", infoMulti: "⏳ כמה ימים", infoPaid: "💳 בתשלום", infoLen: "~{len}",
    // ---- messages produced outside app.js (job.js, research.js, gemini.js, audio.js): {key, ...values}
    secUnit: "שנ׳", errDetails: "פרטים טכניים",
    p_researchDeep: "חוקרים לעומק את הכיוון שבחרתם…",
    p_writeScript: "כותבים את התסריט: חלק {n} מתוך {total}",
    p_writeTwoHost: "כותבים את תסריט השיחה בין שני המגישים: חלק {n} מתוך {total}",
    p_recording: "מקליטים את הקול: חלק {n} מתוך {total}",
    p_recordingReused: "מקליטים את הקול: חלק {n} מתוך {total} ({reused} נלקחו מהקלטות קודמות, בלי מכסה)",
    p_mastering: "משפרים את השמע (חמימות ועוצמה אחידה)",
    p_encoding: "מקודדים ל-MP3",
    p_waitMinute: "נשארים במסגרת החינמית: ממתינים {s} שניות למגבלת הבקשות לדקה",
    p_waitOffline: "אין חיבור לאינטרנט: ממתינים שהחיבור יחזור",
    w_best1: "חלק {n}: נשמרה ההקלטה מהניסיון היחיד (בעיה: {problems}).",
    w_best: "חלק {n}: נשמרה ההקלטה הטובה ביותר מתוך {takes} ניסיונות (בעיה: {problems}).",
    w_earlier: "חלק {n}: נשמרה הקלטה קודמת כי לא נשארה מכסה להקלטה חוזרת (בעיה: {problems}).",
    w_reused1: "הקלטה אחת נלקחה מפודקאסט קודם, בלי שימוש במכסה.",
    w_reused: "{count} הקלטות נלקחו מפודקאסטים קודמים, בלי שימוש במכסה.",
    w_deepOff: "החיפוש המעמיק ברשת לא היה זמין, ולכן התסריט מבוסס על המחקר הראשוני בלבד.",
    pr_short: "ההקלטה נקטעה באמצע: {got} שנ׳ במקום כ-{exp}",
    pr_long: "ההקלטה ארוכה מהצפוי: {got} שנ׳ במקום כ-{exp}",
    pr_dead: "שקט ממושך של {secs} שנ׳",
    e_unknown: "אירעה שגיאה לא צפויה.",
    e_stalled: "היצירה נעצרה כשהמסך ננעל או שעברתם לאפליקציה אחרת.",
    e_badKey: "<bdi>Google</bdi> דחתה את מפתח ה-API.",
    e_listModels: "לא הצלחנו לקבל מ-<bdi>Gemini</bdi> את רשימת הדגמים (שגיאה {status}).",
    e_noTts: "למפתח הזה אין גישה לדגם קול חינמי.",
    e_noText: "למפתח הזה אין דגם טקסט זמין לכתיבת התסריט.",
    e_noSearch: "למפתח הזה אין דגם עם חיפוש <bdi>Google</bdi> חינמי.",
    e_timeout: "<bdi>Gemini</bdi> לא ענה תוך {s} שניות.",
    e_network: "הייתה בעיית רשת בתקשורת עם <bdi>Gemini</bdi>.",
    e_unreadable: "<bdi>Gemini</bdi> החזיר תשובה שאי אפשר לקרוא.",
    e_rate: "נשלחו יותר מדי בקשות ל-<bdi>Gemini</bdi> בזמן קצר.",
    e_server: "השרת של <bdi>Gemini</bdi> נתקל בתקלה (שגיאה {status}).",
    e_http: "<bdi>Gemini</bdi> החזיר שגיאה {status}.",
    e_noAudio: "<bdi>Gemini</bdi> לא החזיר שמע לקטע הזה.",
    e_contentFilter: "<bdi>Gemini</bdi> סירב להקריא את הקטע (מסנן תוכן).",
    e_emptyScript: "<bdi>Gemini</bdi> החזיר תסריט ריק.",
    e_searchEmpty: "חיפוש <bdi>Google</bdi> החזיר תשובה ריקה.",
    e_quotaDay: "המכסה החינמית להיום ב-<bdi>Gemini</bdi> ({n} בקשות) נגמרה.",
    e_quotaGoogle: "<bdi>Google</bdi> מדווחת שהמכסה החינמית להיום לדגם הזה נגמרה ({n} בקשות ליום).",
    e_retakeLater: "המכסה של היום נחוצה להמשך הפודקאסט, אז ההקלטה החוזרת תתבצע אחרי האיפוס.",
    e_emptyText: "הטקסט ריק אחרי הניקוי.",
    e_badDialogue: "כותב התסריט החזיר שיחה שאי אפשר להשתמש בה.",
    e_tooLittle: "כותב התסריט החזיר מעט מדי טקסט.",
    e_researchFormat: "המחקר חזר בפורמט לא צפוי.",
    e_noSources: "לא הצלחנו למצוא מקורות לנושא הזה.",
    e_needTopic: "כתבו נושא קודם.",
    e_neverTruncated: "חלק {n}: מנוע הקול ממשיך לקטוע את הקטע הזה, ולכן הוא לא הוקלט במלואו.",
    e_usedRetakes: "חלק {n}: הקטע ניצל את כל ההקלטות החוזרות שמותר לו לעכשיו.",
    e_storageBlocked: "אחסון הדפדפן חסום על ידי לשונית אחרת.",
    e_storageFull: "אין מספיק מקום באחסון של המכשיר.",
    e_encoder: "קידוד ה-MP3 נכשל.",
    s_key: "בדקו את המפתח בהגדרות.",
    s_retry: "נסו שוב.",
    s_retryWait: "המתינו דקה ונסו שוב.",
    s_edit: "ערכו את הקטע ונסו שוב.",
    s_online: "בדקו את החיבור לאינטרנט ונסו שוב.",
    s_resume: "לחצו \"המשך יצירה\" כדי לנסות שוב, או בחרו קול אחר.",
    s_reset: "אפשר להמשיך אחרי איפוס המכסה.",
    s_space: "פנו מקום במכשיר ונסו שוב.",
    s_tabs: "סגרו לשוניות אחרות של האתר ונסו שוב.",
    s_keepOpen: "השאירו את המסך דלוק ולחצו \"המשך יצירה\".",
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
    privacy: "Everything runs in your browser. Your text and key go to Google; in topic mode the topic words also go to Wikipedia.",
    rememberKey: "Remember this key on this device (if off, it is kept only until the tab is closed)",
    forgetKey: "Forget key", clearAll: "Clear all my data",
    keyForgotten: "The key was removed from this device.",
    confirmClear: "Delete the key, settings, quota tracking, saved podcasts and voice samples from this device? This cannot be undone.",
    clearedAll: "All data was removed from this device.",
    keyRestrictHint: "Security tip: in Google AI Studio / Cloud Console restrict the key to the Generative Language API only (and optionally to this site's domain as an HTTP referrer), and keep billing off.",
    resume: "Continue", freeTitle: "Stay on the free tier",
    freeOnly: "Free-only mode: never go past the free quota (pause and continue tomorrow instead of paying)",
    billing: "The key's Google project has billing enabled",
    billingHint: "Safest: use a key from a project with no billing. Then Google cannot charge you at all; the worst case is a 'quota exceeded' message.",
    limitsHint: "Free limits differ per project. The app learns the real limit from Google automatically; you can also enter it from",
    ttsPerDay: "Voice requests / day", ttsPerMin: "Voice requests / minute", textPerDay: "Script requests / day",
    fFree: "✓ <b>Free</b> — uses {need} of the {left} free voice requests left today.",
    fFreeScript: " + {need} requests to write the script ({left} left).",
    fMinutes: "Because of the {rpm} requests/minute limit, it will take at least ~{min} min.",
    fWait: "⏳ <b>Today's free voice quota is used up.</b> You can press Create: recording waits for the reset ({reset}) and you continue with \"Continue\" — without paying.",
    confirmWait: "Today's free voice quota is used up. Recording will wait for the reset, then you press \"Continue\". Start?",
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
    topicPlaceholder: "e.g. how human memory works",
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
    cantResume: "This podcast can't be continued — please create it again.",
    errorText: "Recording stopped because of an error. The parts already recorded are saved — you can try to continue where it stopped.",
    noStorage: "This browser doesn't allow saving on the device (private browsing?), so the podcast is made in memory only: it can't be paused and continued later. Keep this page open until it's done.",
    voiceStyle: "Voice & style", change: "Change", done: "Close", close: "Close",
    share: "Share / Save to Files", shareFail: "Sharing failed", playSample: "Play a sample of {name}",
    geminiKeyLabel: "<bdi>Gemini API</bdi> key", geminiKeyAria: "Gemini API key", srcAria: "Podcast source",
    progressAria: "Recording progress",
    lockWarn: "<b>Don't lock the screen or switch apps</b> until the podcast is ready — the screen is kept awake while it records.",
    lockWarnNoWake: "<b>Don't lock the screen or switch apps</b> until the podcast is ready. This browser can't keep the screen awake, so tap the screen now and then.",
    lockEtaMin: "Estimated recording time: at least ~{min} min.", lockEtaLen: "Estimated podcast length: ~{len}. Recording takes a few minutes.",
    infoFree: "✓ Free", infoMulti: "⏳ Several days", infoPaid: "💳 Paid", infoLen: "~{len}",
    // ---- messages produced outside app.js (job.js, research.js, gemini.js, audio.js): {key, ...values}
    secUnit: "s", errDetails: "Technical details",
    p_researchDeep: "Researching your focus in depth…",
    p_writeScript: "Writing the script: part {n} of {total}",
    p_writeTwoHost: "Writing the two-host script: part {n} of {total}",
    p_recording: "Recording voice: part {n} of {total}",
    p_recordingReused: "Recording voice: part {n} of {total} ({reused} reused, no quota used)",
    p_mastering: "Mastering audio (warmth EQ, loudness)",
    p_encoding: "Encoding MP3",
    p_waitMinute: "Staying within the free tier: waiting {s}s for the per-minute limit",
    p_waitOffline: "You are offline: waiting for the connection to come back",
    w_best1: "Part {n}: kept the only take (problem: {problems}).",
    w_best: "Part {n}: kept the best of {takes} takes (problem: {problems}).",
    w_earlier: "Part {n}: kept an earlier take, no quota left for a retake (problem: {problems}).",
    w_reused1: "Reused 1 recording from an earlier podcast, no quota used.",
    w_reused: "Reused {count} recordings from earlier podcasts, no quota used.",
    w_deepOff: "The deep-dive web search was unavailable, so the script uses the first research only.",
    pr_short: "the recording was cut off: {got}s for ~{exp}s of text",
    pr_long: "the recording is longer than expected: {got}s for ~{exp}s of text",
    pr_dead: "a long silence of {secs}s",
    e_unknown: "Something unexpected went wrong.",
    e_stalled: "Recording stopped when the screen locked or you switched apps.",
    e_badKey: "Google rejected the API key.",
    e_listModels: "Couldn't get the model list from Gemini (error {status}).",
    e_noTts: "This key has no access to a free voice model.",
    e_noText: "This key has no text model available for writing the script.",
    e_noSearch: "This key has no model with free Google Search.",
    e_timeout: "Gemini did not answer within {s} seconds.",
    e_network: "There was a network problem talking to Gemini.",
    e_unreadable: "Gemini sent an answer that can't be read.",
    e_rate: "Too many requests were sent to Gemini in a short time.",
    e_server: "Gemini's server had a problem (error {status}).",
    e_http: "Gemini returned error {status}.",
    e_noAudio: "Gemini returned no audio for this passage.",
    e_contentFilter: "Gemini refused to voice this passage (content filter).",
    e_emptyScript: "Gemini returned an empty script.",
    e_searchEmpty: "Google Search came back empty.",
    e_quotaDay: "Today's free Gemini quota ({n} requests) is used up.",
    e_quotaGoogle: "Google says today's free quota for this model is used up ({n} requests/day).",
    e_retakeLater: "Today's quota is needed for the rest of the podcast, so the retake will be made after the reset.",
    e_emptyText: "The text is empty after cleanup.",
    e_badDialogue: "The script writer returned a dialogue that can't be used.",
    e_tooLittle: "The script writer returned too little text.",
    e_researchFormat: "The research came back in an unexpected format.",
    e_noSources: "Couldn't find sources for this topic.",
    e_needTopic: "Write a topic first.",
    e_neverTruncated: "Part {n}: the voice engine keeps cutting this passage short, so it was not recorded completely.",
    e_usedRetakes: "Part {n}: this passage used up the retakes it is allowed for now.",
    e_storageBlocked: "The browser's storage is blocked by another tab.",
    e_storageFull: "There isn't enough storage space on the device.",
    e_encoder: "MP3 encoding failed.",
    s_key: "Check the key in Settings.",
    s_retry: "Try again.",
    s_retryWait: "Wait a minute and try again.",
    s_edit: "Edit that passage and try again.",
    s_online: "Check your internet connection and try again.",
    s_resume: "Tap \"Continue\" to try again, or pick another voice.",
    s_reset: "You can continue after the quota resets.",
    s_space: "Free some space on the device and try again.",
    s_tabs: "Close other tabs of this site and try again.",
    s_keepOpen: "Keep the screen on and tap \"Continue\".",
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
// The API key lives in localStorage (remembered) or sessionStorage (forgotten when the tab closes).
const KEY = "geminiKey", REMEMBER = "rememberKey";
const rememberKey = () => store.get(REMEMBER, "1") !== "0";
function readKey() {
  for (const area of ["sessionStorage", "localStorage"]) {
    try { const v = globalThis[area].getItem(KEY); if (v) return v; } catch { /* storage blocked */ }
  }
  return "";
}
function writeKey(value) {
  const [keep, drop] = rememberKey() ? ["localStorage", "sessionStorage"] : ["sessionStorage", "localStorage"];
  try { globalThis[drop].removeItem(KEY); } catch { /* storage blocked */ }
  try { if (value) globalThis[keep].setItem(KEY, value); else globalThis[keep].removeItem(KEY); } catch { /* storage blocked */ }
}
const state = {
  ui: store.get("ui", "he"), lang: "he", langTouched: false, mode: "narrator", style: "warm", pace: "natural",
  voice: "Sulafat", voice2: "Achird", showAll: false, busy: false, cancel: false, gemini: null, job: null, free: null, t0: 0,
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
const key = readKey;

// ---------------------------------------------------------------- messages from the other modules
// job.js, research.js, gemini.js and audio.js never produce UI text: they report a message
// { key, ...values } (progress stages, warnings, error `msg`) and this file renders it in the current
// language from the I18N table. Latin names and numbers go into <bdi> so Hebrew punctuation stays put.
const textNode = (s) => document.createTextNode(s);
function bdiNode(v) { const b = document.createElement("bdi"); b.textContent = String(v); return b; }
function msgNodes(m) {
  if (m == null) return [];
  if (typeof m === "string") return [textNode(m)];                       // an old job saved plain text
  if (Array.isArray(m)) return m.flatMap((x, i) => (i ? [textNode("; "), ...msgNodes(x)] : msgNodes(x)));
  const key = m.code ? `pr_${m.code}` : m.key === "w_best" && m.takes < 2 ? "w_best1"
    : m.key === "w_reused" && m.count < 2 ? "w_reused1" : m.key;
  const tpl = I18N[state.ui][key];
  if (tpl == null) return [textNode(String(key))];
  return tpl.split(/(\{\w+\}|<bdi>.*?<\/bdi>)/).filter(Boolean).flatMap((part) => {
    const ph = part.match(/^\{(\w+)\}$/);
    if (ph) {
      const v = m[ph[1]];
      return v == null ? [] : typeof v === "object" ? msgNodes(v) : [bdiNode(v)];
    }
    const lit = part.match(/^<bdi>(.*)<\/bdi>$/);
    return [lit ? bdiNode(lit[1]) : textNode(part)];
  });
}
// The short next step for an error (Hebrew/English text lives in the table as s_*).
const STEP_OF = {
  e_badKey: "s_key", e_noTts: "s_key", e_noText: "s_key", e_noSearch: "s_key",
  e_network: "s_online", e_timeout: "s_online", e_rate: "s_retryWait",
  e_contentFilter: "s_edit", e_emptyText: "s_edit", e_neverTruncated: "s_resume", e_usedRetakes: "s_resume",
  e_quotaDay: "s_reset", e_quotaGoogle: "s_reset", e_retakeLater: "s_reset",
  e_storageFull: "s_space", e_storageBlocked: "s_tabs", e_stalled: "s_keepOpen",
};
/** An error (thrown, or saved on a job as { msg, raw }) as { msg: {key,...}, raw: "technical text" }. */
function errInfo(e) {
  if (e && typeof e === "object" && e.msg && e.raw !== undefined && !(e instanceof Error)) return e;
  if (typeof e === "string") return { msg: { key: "e_unknown" }, raw: e };
  const msg = e?.msg || (e?.name === "QuotaExceededError" ? { key: "e_storageFull" } : { key: "e_unknown" });
  return { msg, raw: e?.message || String(e ?? "") };
}
/** Shows an error in `el`: the message in the current language, a short next step, and the raw
 *  technical text in a collapsed <details> (textContent only) so it can still be copied. */
function fillError(el, e, prefix = "") {
  const info = errInfo(e);
  el._err = { e, prefix };
  const head = document.createElement("span");
  head.className = "err-msg";
  if (prefix) head.append(textNode(prefix + " "));
  head.append(...msgNodes(info.msg));
  const step = document.createElement("div");
  step.className = "err-step";
  step.append(...msgNodes({ key: STEP_OF[info.msg.key] || "s_retry" }));
  const kids = [head, step];
  if (info.raw) {
    const d = document.createElement("details"), sm = document.createElement("summary"), pre = document.createElement("pre");
    d.className = "err-details";
    sm.textContent = t("errDetails");
    pre.textContent = info.raw; pre.dir = "ltr";
    d.append(sm, pre);
    kids.push(d);
  }
  el.replaceChildren(...kids);
}
/** After a language switch: redraw the messages that are on screen (progress stage, errors, warnings). */
function refreshMessages() {
  for (const n of document.querySelectorAll(".err-msg")) {
    const el = n.parentElement;
    if (el?._err) fillError(el, el._err.e, el._err.prefix);
  }
  if (state.busy && state.stage) $("stage").replaceChildren(...msgNodes(state.stage));
  if (!$("result").hidden && state.job) renderWarnings(state.job);
  if (!$("paused").hidden && state.job) showPaused(state.job, false);
}
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
  // innerHTML is only used for constant strings from the I18N table (never user, network or computed values).
  document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
  $("uiLangBtn").textContent = state.ui === "he" ? "English" : "עברית";
  if (!$("title").value || Object.values(I18N).some((d) => d.defaultTitle === $("title").value)) $("title").value = t("defaultTitle");
  const chips = $("styles");
  chips.innerHTML = "";
  for (const [id, s] of Object.entries(STYLES)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (id === state.style ? " on" : "");
    b.setAttribute("aria-pressed", id === state.style);
    b.textContent = state.ui === "he" ? s.label_he : s.label_en;
    b.onclick = () => {
      state.style = id;
      [...chips.children].forEach((c) => { c.classList.toggle("on", c === b); c.setAttribute("aria-pressed", c === b); });
      updateVoiceSummary();
    };
    chips.appendChild(b);
  }
  $("keyCard").hidden = !!key() && !state.keyBad;      // a key that failed the check stays visible with its message
  setSeg("srcSeg", state.src); setSeg("langSeg", state.lang); setSeg("modeSeg", state.mode); setSeg("paceSeg", state.pace);
  $("topicCard").hidden = state.src !== "topic";
  $("textCard").hidden = state.src === "topic";
  $("minutesOut").textContent = `${$("minutes").value} ${t("minutesUnit")}`;
  document.querySelector('[data-i18n="topicHint"]').textContent = freeOpts().freeOnly ? t("topicHint") : t("topicHintOff");
  renderResearch();
  renderVoices();
  updateHint();
  onTextChange();
  refreshMessages();
}

function renderVoiceGrid(container, k) {
  container.innerHTML = "";
  const list = state.showAll ? VOICES : VOICES.filter((v) => v.recommended || v.id === state[k]);
  for (const v of list) {
    const on = state[k] === v.id;
    const item = document.createElement("div");
    item.className = "voice-item";
    const card = document.createElement("button");
    card.type = "button";
    card.className = "voice" + (on ? " on" : "");
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", on);
    card.tabIndex = on ? 0 : -1;
    card.innerHTML = `<span class="meta"><span class="name"></span><span class="desc"></span></span>`;
    card.querySelector(".name").textContent = v.name;
    if (v.recommended) {
      const s = document.createElement("span"); s.className = "star"; s.textContent = "★ " + t("recommended");
      card.querySelector(".name").appendChild(s);
    }
    card.querySelector(".desc").textContent = `${t(v.gender)} · ${state.ui === "he" ? DESC_HE[v.description] || v.description : v.description}`;
    const play = document.createElement("button");
    play.type = "button";
    play.className = "play";
    play.textContent = "▶";
    play.setAttribute("aria-label", fmt(t("playSample"), { name: v.name }));
    play.title = readySamples.has(`${state.lang}/${v.id}`) ? "▶" : t("previewCost");
    const choose = (refocus) => {
      state[k] = v.id; store.set(k, v.id); renderVoices();
      if (refocus) container.querySelector('[aria-checked="true"]')?.focus();
    };
    card.addEventListener("click", () => choose(false));
    card.addEventListener("keydown", (e) => {
      const dir = { ArrowDown: 1, ArrowRight: state.ui === "he" ? -1 : 1, ArrowUp: -1, ArrowLeft: state.ui === "he" ? 1 : -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const radios = [...container.querySelectorAll('[role="radio"]')];
      const next = radios[(radios.indexOf(card) + dir + radios.length) % radios.length];
      const id = VOICES.find((x) => x.name === next.querySelector(".name").firstChild.textContent)?.id;
      if (id) { state[k] = id; store.set(k, id); renderVoices(); container.querySelector('[aria-checked="true"]')?.focus(); }
    });
    play.addEventListener("click", (e) => { e.stopPropagation(); preview(v, e.currentTarget); });
    item.append(card, play);
    container.appendChild(item);
  }
}

function renderVoices() {
  renderVoiceGrid($("voices"), "voice");
  $("voice2Wrap").hidden = state.mode !== "conversation";
  if (state.mode === "conversation") renderVoiceGrid($("voices2"), "voice2");
  $("voiceMore").textContent = state.showAll ? t("showLess") : t("showAll");
  $("voiceMore").setAttribute("aria-pressed", state.showAll);
  updateVoiceSummary();
}

// "Sulafat · warm · natural" - what the collapsed voice section shows.
function updateVoiceSummary() {
  const el = $("voiceSummary");
  if (!el) return;
  const st = STYLES[state.style];
  const bits = [state.mode === "conversation" ? `${state.voice} + ${state.voice2}` : state.voice,
    st ? (state.ui === "he" ? st.label_he : st.label_en) : "", t(state.pace)];
  el.innerHTML = "";
  bits.filter(Boolean).forEach((x, i) => {
    if (i) el.append(" · ");
    const bdi = document.createElement("bdi"); bdi.textContent = x; el.append(bdi);
  });
}
$("voiceMore").addEventListener("click", () => { state.showAll = !state.showAll; renderVoices(); });

function updateHint() {
  const topic = state.src === "topic";
  $("modeHint").textContent = state.mode === "conversation" ? t(topic ? "convTopicHint" : "convHint")
    : t(topic ? "narratorTopicHint" : "narratorHint");
  $("generate").disabled = state.busy;
  $("genbar").hidden = state.busy;
}

/** Turns a string with constant <b>…</b> markup into DOM nodes; everything else becomes plain text. */
function richNodes(str) {
  return str.split(/(<b>.*?<\/b>)/).filter(Boolean).map((part) => {
    const m = part.match(/^<b>(.*)<\/b>$/);
    if (!m) return document.createTextNode(part);
    const b = document.createElement("b");
    b.textContent = m[1];
    return b;
  });
}

function renderFree(f) {
  const el = $(state.src === "topic" ? "topicBadge" : "freeBadge");
  $(state.src === "topic" ? "freeBadge" : "topicBadge").hidden = true;
  state.free = f;
  if (!f) { el.hidden = true; return; }
  const tts = f.buckets.gemini_tts, txt = f.buckets.gemini_text, web = f.buckets.gemini_search;
  if (!tts) { el.hidden = true; return; }       // nothing left to record (all parts already made): no badge
  // `html` is a template from the I18N table with {placeholders} filled in by richNodes (no innerHTML).
  let cls = "ok", html;
  if (f.status === "paid") { cls = "bad"; html = t("fPaid"); }
  else if (f.status === "free_multi_day" && tts.left_today === 0) { cls = "wait"; html = fmt(t("fWait"), { reset: resetTime(f.reset_at) }); }
  else if (f.status === "free_multi_day") { cls = "wait"; html = fmt(t("fMulti"), { days: f.days, reset: resetTime(f.reset_at) }); }
  else html = fmt(t("fFree"), { need: tts.needed + tts.reserve, left: tts.left_today });
  if (txt && f.status !== "paid") html += fmt(t("fFreeScript"), { need: txt.needed + txt.reserve, left: txt.left_today });
  if (web?.left_today && f.status !== "paid") html += fmt(t("fSearch"), { left: web.left_today });
  if (!freeOpts().freeOnly && f.status !== "free") html += t("fOff");
  const sub = [];
  if (tts.reserve) sub.push(fmt(t("fReserve"), { reserve: tts.reserve }));
  if (tts.minutes_at_least >= 1) sub.push(fmt(t("fMinutes"), { rpm: tts.per_minute, min: Math.ceil(tts.minutes_at_least) }));
  el.className = "free-badge " + cls;
  el.replaceChildren(...richNodes(html));
  if (sub.length) {
    const d = document.createElement("div");
    d.className = "sub"; d.textContent = sub.join(" ");
    el.appendChild(d);
  }
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
    renderFree(await realEstimate(raw, text, o));
  }, 250);
}

/**
 * The free-tier verdict from the real chunker: the actual number of voice requests for this text (or,
 * for a conversation, its written script), minus the parts a paused job with this very text has
 * already recorded and the ones the recordings cache holds.
 */
async function realEstimate(raw, text, o) {
  const chunkChars = o.freeOnly ? DATA.FREE_CHUNK_CHARS : 1500;
  const prior = state.job && resumableJob(state.job) && state.job.request.text === raw && state.job.request.mode === state.mode
    ? state.job : null;
  const job = prior ? { ...prior, chunkChars: prior.chunkChars || chunkChars }
    : { id: null, chunkChars, request: { text, mode: state.mode, language: state.lang, voice: state.voice, voice2: state.voice2,
      style: state.style, pace: state.pace } };
  let parts = null;
  try {
    let model = "";
    try { model = await gemini().ttsModel(); } catch { /* no model list yet: the cache can't be checked */ }
    parts = await planParts(job, { model });
  } catch { /* fall back to the length-based estimate */ }
  return freeVerdict({ chars: text.length, mode: state.mode, apiKey: key(), overrides: o.limits, billing: o.billing,
    chunkChars: job.chunkChars, ...(parts && { ttsParts: parts.ttsParts, textParts: parts.textParts,
      alreadyDone: parts.alreadyDone, cached: parts.cached }) });
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
function topicError(e) {
  const el = $("researchStatus");
  el.hidden = false; el.classList.add("error");
  fillError(el, e);
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
    g.gate.onWait = (s, why) => topicStatus(why === "offline" ? t("p_waitOffline") : `${t("researching")} (${Math.round(s)} ${t("secUnit")})`);
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
    if (e instanceof QuotaExhausted) topicStatus(fmt(t("pausedText"), { reset: resetTime(e.resetAt.toISOString()) }), true);
    else topicError(e);
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
    if (e.name === "NotAllowedError") voiceMsg(t("tapAgain"));
    else throw e;
  }
}

function preview(v, btn) {
  const seq = ++previewSeq;
  const wasPlaying = playingBtn === btn;
  previewEl.pause();
  resetPlayButtons();
  voiceMsg("");
  if (wasPlaying) return;                                  // second tap = stop
  if (readySamples.has(`${state.lang}/${v.id}`)) {   // shipped sample: no key, no quota
    return playPreview(`previews/${state.lang}/${v.id}.mp3`, btn).catch((e) => voiceErr(e));
  }
  if (!key()) return voiceMsg(t("needKey"), true);
  if (freeOpts().billing && freeOpts().freeOnly) return voiceMsg(t("paidBlocked"), true);
  const ck = [v.id, state.lang, state.style, state.pace].join("|");
  const cached = previewCache.get(ck);
  if (cached) return playPreview(cached, btn).catch((e) => voiceErr(e));
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
    voiceErr(e);
  });
}

// ---------------------------------------------------------------- jobs
function voiceMsg(msg, isError = false) {
  const el = $("voiceMsg");
  el.hidden = !msg; el.textContent = msg || ""; el.classList.toggle("bad", isError);
}
function voiceErr(e) {
  const el = $("voiceMsg");
  el.hidden = false; el.classList.add("bad");
  fillError(el, e, t("previewFail") + ":");
}
function showError(msg) { $("error").hidden = !msg; $("error").textContent = msg || ""; }
function showErr(e) { $("error").hidden = false; fillError($("error"), e); }
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB"; }

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator) { wakeLock = await navigator.wakeLock.request("screen"); state.wakeOk = true; }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { state.wakeOk = false; /* not supported / denied */ }
  if (on) renderLockNote();
}
/** The "don't lock the screen" notice shown while a job runs. */
function renderLockNote() {
  const supported = "wakeLock" in navigator && state.wakeOk !== false;
  let html = t(supported ? "lockWarn" : "lockWarnNoWake");
  const mins = state.free?.buckets?.gemini_tts?.minutes_at_least;
  const eta = mins >= 1 ? fmt(t("lockEtaMin"), { min: Math.ceil(mins) })
    : state.est ? fmt(t("lockEtaLen"), { len: state.est }) : "";
  if (eta) html += ` <span class="eta">${eta}</span>`;
  $("lockNote").innerHTML = html;
}
state.hiddenAt = 0; state.lastProgress = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { state.hiddenAt = Date.now(); return; }
  const away = state.hiddenAt ? Date.now() - state.hiddenAt : 0;
  state.hiddenAt = 0;
  if (state.busy) {
    keepAwake(true);
    // The phone was locked / another app was in front: requests in flight usually died. If nothing
    // has moved for a while, stop waiting and offer "Continue" right away.
    if (away > 8000 && Date.now() - state.lastProgress > 20000 && state.gemini) { state.stalled = true; state.gemini.abortAll(); }
  } else if (state.job && RESUMABLE.has(state.job.status) && $("paused").hidden && $("progress").hidden) {
    showPaused(state.job);
  }
});

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
  if (state.free?.status === "free_multi_day" && o.freeOnly && !confirm(state.free.buckets.gemini_tts?.left_today === 0 ? t("confirmWait") : fmt(t("confirmMulti"), { days: state.free.days }))) return;
  const job = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), status: "running", warnings: [], script: null,
    request: { text, topic, language: state.lang, mode: state.mode, voice: state.voice, voice2: state.voice2,
      style: state.style, pace: state.pace, title: $("title").value || t("defaultTitle") },
  };
  try {
    await A.store.saveJob(job);
  } catch {
    // No IndexedDB (private mode, blocked storage): make the podcast in memory instead.
    A.store.useMemory();
    await A.store.saveJob(job);
  }
  if (A.store.persistent) store.set("lastJob", job.id);
  run(job);
  if (!A.store.persistent) showError(t("noStorage"));
}

async function run(job) {
  state.job = job; state.busy = true; state.cancel = false; state.t0 = Date.now();
  $("result").hidden = true; $("paused").hidden = true;
  $("progress").hidden = false; state.stage = { key: "starting" }; $("stage").replaceChildren(...msgNodes(state.stage)); $("barFill").style.width = "1%";
  $("bar").setAttribute("aria-valuenow", 1);
  state.stalled = false; state.lastProgress = Date.now(); renderLockNote();
  updateHint();
  keepAwake(true);
  $("progress").scrollIntoView({ behavior: "smooth", block: "nearest" });
  const timer = setInterval(() => { $("elapsed").textContent = formatDuration((Date.now() - state.t0) / 1000); }, 1000);
  const ui = {
    progress(p, stage) {
      state.lastProgress = Date.now();
      if (p != null) $("bar").setAttribute("aria-valuenow", Math.round(p * 100));
      if (p != null) { $("barFill").style.width = Math.max(1, p * 100) + "%"; $("pct").textContent = Math.round(p * 100) + "%"; }
      if (stage) { state.stage = stage; $("stage").replaceChildren(...msgNodes(stage)); }
    },
    cancelled: () => state.cancel,
  };
  try {
    state.gemini = gemini();
    const { blob } = await runJob(job, state.gemini, ui);
    job.status = "done";
    await A.store.saveJob(job);
    await showResult(job, blob);
  } catch (e) {
    if (e instanceof QuotaExhausted) {
      job.status = "paused"; job.resumeAt = e.resetAt.toISOString();
      showPaused(job);
    } else if (e instanceof Cancelled && state.stalled) {
      job.status = "error"; job.error = { msg: { key: "e_stalled" }, raw: "" };
      showPaused(job);
    } else if (e instanceof Cancelled) {
      job.status = "cancelled"; showError(t("cancelled"));
    } else if (job.status === "done") {
      showErr(e);                              // the MP3 is already saved; never re-record a finished job
    } else {
      // Recorded parts are kept, so a failed job can be continued like a paused one.
      const { msg, raw } = errInfo(e);
      job.status = "error"; job.error = { msg, raw };
      showPaused(job);
    }
    await A.store.saveJob(job).catch(() => {});
  } finally {
    clearInterval(timer);
    state.busy = false; state.gemini = null; state.stalled = false;
    $("progress").hidden = true;
    keepAwake(false);
    updateHint();
    onTextChange();
  }
}

function showPaused(job, scroll = true) {
  $("pausedText").textContent = job.status === "paused" ? fmt(t("pausedText"), { reset: resetTime(job.resumeAt) })
    : job.status === "error" ? t("errorText") : t("interruptedText");
  $("pausedErr").hidden = job.status !== "error";
  if (job.status === "error") fillError($("pausedErr"), job.error ?? "");
  $("paused").hidden = false;
  if (scroll) $("paused").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
const RESUMABLE = new Set(["paused", "running", "error"]);    // "running" = the page was closed mid-way
/** A job loaded from storage that can be continued (written by this or an older version of the app). */
function resumableJob(job) {
  const r = job?.request;
  return !!(job && typeof job.id === "string" && RESUMABLE.has(job.status) && r && typeof r === "object" &&
    (typeof r.text === "string" || r.topic) && ["he", "en"].includes(r.language) &&
    ["narrator", "conversation"].includes(r.mode) && typeof r.voice === "string" &&
    (job.script == null || Array.isArray(job.script)) && Array.isArray(job.warnings ||= []));
}

const HOST_HE = { Noa: "נועה", Maya: "מאיה", Yoni: "יוני", Avi: "אבי" };
function renderWarnings(job) {
  $("warnings").replaceChildren(...(job.warnings || []).map((w) => {
    const d = document.createElement("div");
    d.append(...msgNodes(w));
    return d;
  }));
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
  $("resMeta").textContent = `${t("size")}: \u2066${fmtSize(blob.size)}\u2069 · \u2066Gemini (${job.request.mode === "conversation" ? job.request.voice + ", " + job.request.voice2 : job.request.voice})\u2069`;
  const safe = (job.request.title || "podcast").replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "podcast";
  $("download").href = url;
  $("download").download = `${safe}.mp3`;
  setupShare(blob, `${safe}.mp3`);
  store.set("genDone", "1");
  renderWarnings(job);
  const lines = job.script || job.narration;
  $("showScript").hidden = !lines;
  $("script").hidden = true;
  $("script").innerHTML = "";
  for (const line of lines || []) {
    const p = document.createElement("p");
    if (line.speaker) {
      // Hebrew scripts keep Latin host names for the voice engine (stable multi-speaker labels); show them in Hebrew.
      const b = document.createElement("b");
      b.textContent = (job.request.language === "he" && HOST_HE[line.speaker] || line.speaker) + ": ";
      p.append(b);
    }
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

// On a phone the plain download link only opens a media viewer; the share sheet can save to Files.
let shareFile = null;
function setupShare(blob, name) {
  shareFile = null; $("share").hidden = true; $("shareMsg").hidden = true;
  $("download").classList.toggle("secondary", false);
  try {
    const file = new File([blob], name, { type: "audio/mpeg" });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      shareFile = file; $("share").hidden = false;
      $("download").classList.add("secondary");
    }
  } catch { /* no File constructor / share support: keep the download link */ }
}
$("share").addEventListener("click", async () => {
  if (!shareFile) return;
  $("shareMsg").hidden = true;
  try { await navigator.share({ files: [shareFile], title: shareFile.name.replace(/\.mp3$/, "") }); }
  catch (e) {
    if (e.name === "AbortError") return;               // the person closed the sheet
    $("shareMsg").hidden = false; fillError($("shareMsg"), e, t("shareFail") + ":");
  }
});

async function restoreLastJob() {
  const id = store.get("lastJob", "");
  try {
    const job = id ? await A.store.loadJob(id) : null;
    const resumable = resumableJob(job) ? job : null;
    let finished = job?.status === "done" ? job : null;
    if (!finished) {        // the newest finished podcast (ids start with the creation time)
      const done = (await A.store.allJobs()).filter((j) => j.status === "done" && typeof j.id === "string");
      finished = done.sort((a, b) => (a.id.length - b.id.length) || (a.id < b.id ? -1 : 1)).pop() || null;
    }
    // Free space: keep only the parts of a job that can be continued, and the latest MP3.
    await A.store.cleanup({ resumable: resumable?.id, finished: finished?.id }).catch(() => {});
    if (resumable) {
      state.job = resumable;
      showPaused(resumable);
    } else if (job?.status === "done") {
      state.job = job;
      const blob = await A.store.getPart(job.id, "mp3");
      if (blob) await showResult(job, blob);
    }
  } catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------- wiring
function setSeg(id, v) {
  [...$(id).children].forEach((c) => { c.classList.toggle("on", c.dataset.v === v); c.setAttribute("aria-pressed", c.dataset.v === v); });
}
function seg(id, k, onChange) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    state[k] = b.dataset.v; setSeg(id, state[k]); onChange?.();
  });
}
seg("langSeg", "lang", () => { state.langTouched = true; onTextChange(); });
seg("modeSeg", "mode", () => { renderVoices(); updateHint(); onTextChange(); });
seg("paceSeg", "pace", updateVoiceSummary);
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

// Compact estimate + free-quota status next to the sticky Create button.
function updateGenInfo() {
  const topic = state.src === "topic";
  const len = topic ? $("minutesOut").textContent : $("statEst").textContent;
  const badge = $(topic ? "topicBadge" : "freeBadge");
  const hasText = topic ? !!state.research : $("statEst").textContent !== "0:00";
  state.est = hasText ? len.replace(/^~/, "") : "";
  const bits = [];
  if (hasText) bits.push(`<bdi>${fmt(t("infoLen"), { len })}</bdi>`.replace("~~", "~"));
  if (!badge.hidden) {
    const cls = badge.classList.contains("bad") ? "bad" : badge.classList.contains("wait") ? "wait" : "ok";
    bits.push(`<span class="gi-${cls}">${t({ ok: "infoFree", wait: "infoMulti", bad: "infoPaid" }[cls])}</span>`);
  }
  $("genInfo").innerHTML = bits.join(" · ");
}
{
  const mo = new MutationObserver(updateGenInfo);
  for (const id of ["freeBadge", "topicBadge", "statEst", "minutesOut"]) mo.observe($(id), { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });
}
$("cancel").addEventListener("click", () => { state.cancel = true; state.gemini?.abortAll(); });   // stops requests in flight too
$("resumeBtn").addEventListener("click", async () => {
  if (state.busy) return;
  showError("");
  // Continue from what is saved on the device (works after a reload too), not from memory.
  const id = state.job?.id || store.get("lastJob", "");
  let job = null;
  try { job = A.store.persistent && id ? await A.store.loadJob(id) : null; } catch { /* storage unavailable */ }
  if (!job && state.job?.id === id) job = state.job;            // in-memory job (no IndexedDB)
  if (!resumableJob(job)) { $("paused").hidden = true; return showError(t("cantResume")); }
  job.status = "running"; delete job.error;
  run(job);
});
$("showScript").addEventListener("click", () => {
  $("script").hidden = !$("script").hidden;
  $("showScript").textContent = $("script").hidden ? t("showScript") : t("hideScript");
});
$("uiLangBtn").addEventListener("click", () => { state.ui = state.ui === "he" ? "en" : "he"; store.set("ui", state.ui); applyUI(); });

async function saveKey(value) {
  value = value.trim();
  writeKey(value);
  if (!value) { applyUI(); return; }
  state.keyBad = false;
  $("keyMsg").textContent = t("keyChecking");
  try {
    await new Gemini(value).models();     // free call: listing models doesn't use any quota
    $("keyMsg").textContent = t("keyOk");
    setTimeout(applyUI, 900);
  } catch (e) {
    state.keyBad = true;
    applyUI();                            // show the key card again, so the person sees why it failed
    $("keyInput").value = value;
    fillError($("keyMsg"), e, "✗");
    $("keyCard").scrollIntoView({ block: "nearest" });
  }
}
$("keySave").addEventListener("click", () => saveKey($("keyInput").value));

const LOCAL_KEYS = ["geminiKey", "rememberKey", "ui", "src", "research", "topicSetup", "voice", "voice2", "lastJob",
  "freeOnly", "billing", "limTtsRpd", "limTtsRpm", "limTextRpd", "podcastUsage"];
$("rememberKey").addEventListener("change", () => {
  store.set(REMEMBER, $("rememberKey").checked ? "1" : "0");
  writeKey(key());                                     // move the current key to the chosen storage
});
$("forgetKey").addEventListener("click", () => {
  writeKey("");
  $("geminiKey").value = "";
  $("keyInput").value = "";
  $("settingsMsg").textContent = t("keyForgotten");
  applyUI();
});
$("clearAll").addEventListener("click", async () => {
  if (!confirm(t("confirmClear"))) return;
  for (const k of LOCAL_KEYS) { try { localStorage.removeItem(k); } catch { /* blocked */ } }
  try { sessionStorage.removeItem(KEY); } catch { /* blocked */ }
  for (const url of previewCache.values()) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }
  previewCache.clear();
  try {                                                // jobs, parts and saved preview audio
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase("podcast-creator");
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  } catch { /* IndexedDB unavailable */ }
  state.job = null;
  $("geminiKey").value = "";
  $("settingsMsg").textContent = t("clearedAll");
  $("result").hidden = true;
  applyUI();
});

$("settingsBtn").addEventListener("click", () => {
  $("settingsMsg").textContent = "";
  $("rememberKey").checked = rememberKey();
  $("geminiKey").value = key();
  $("freeOnly").checked = store.get("freeOnly", "1") === "1";
  $("billing").checked = store.get("billing", "0") === "1";
  for (const id of ["limTtsRpd", "limTtsRpm", "limTextRpd"]) $(id).value = store.get(id, "");
  $("limTtsRpd").placeholder = DATA.FREE_DEFAULTS.gemini_tts.rpd;
  $("limTtsRpm").placeholder = DATA.FREE_DEFAULTS.gemini_tts.rpm;
  $("limTextRpd").placeholder = DATA.FREE_DEFAULTS.gemini_text.rpd;
  $("settings").showModal();
});
$("closeSettings").addEventListener("click", (e) => { e.preventDefault(); $("settings").close(); });
$("saveSettings").addEventListener("click", () => {
  store.set("freeOnly", $("freeOnly").checked ? "1" : "0");
  store.set("billing", $("billing").checked ? "1" : "0");
  for (const id of ["limTtsRpd", "limTtsRpm", "limTextRpd"]) store.set(id, intOrNull($(id).value) ?? "");
  if ($("geminiKey").value.trim() !== key()) saveKey($("geminiKey").value);
  else applyUI();
});

// The voice / style / pace section starts collapsed once a voice is chosen or a podcast was made.
{
  const d = $("voiceDetails"), saved = store.get("voiceOpen", "");
  d.open = saved ? saved === "1" : !(store.get("voice", "") || store.get("genDone", ""));
  d.addEventListener("toggle", () => store.set("voiceOpen", d.open ? "1" : "0"));
}
applyUI();
restoreTopicSetup();
applyUI();
updateGenInfo();
restoreLastJob();
