/* =====================================================================
   Mr. Abdulrahim Hassan — app.js
   Talks DIRECTLY to Sheetson (Google Sheet as DB) and imgbb from the
   browser, as requested. See the note at the end of this file about
   the security tradeoffs of that approach.

   ---------------------------------------------------------------
   REQUIRED GOOGLE SHEET TABS (create these exact tab names + header
   row in the spreadsheet before this will work):

   Students      | id | fullName | phone | parentPhone | centerCode | email | username | password | gender | dob | grade | banned | createdAt
   Courses       | id | grade | title | titleAr | image | month | price
   Lectures      | id | courseId | title | order
   Tasks         | id | lectureId | type | title | videoUrl | textJson | pdfUrl | audioUrl | order | startTime | endTime
   QuizQuestions | id | taskId | question | optionsJson | correctAnswer
   Vocab         | id | lectureId | wordAr | wordEn
   ForumPosts    | id | studentId | studentName | text | imagesJson | likes | createdAt
   Attendance    | id | studentId | lectureId | present | date
   Scores        | id | studentId | refId | refType | score | total | date
   Payments      | id | studentId | courseId | paid | status | date
   Parents       | id | parentPhone | password | studentPhone | studentId | createdAt
   FAQs          | id | question | answer | order
   Schedule      | id | grade | day | time | title | note
   Notifications | id | grade | title | body | createdAt
   Certificates  | id | studentId | title | imageUrl | date
   TeacherFiles  | id | grade | title | fileUrl | type | createdAt
   Suggestions   | id | studentId | studentName | text | createdAt
   Bookings      | id | studentId | studentName | requestedDate | note | status | createdAt
   Homework      | id | grade | title | dueDate | description | createdAt
   HomeworkSubs  | id | homeworkId | studentId | submittedAt | note
   LectureRatings| id | lectureId | studentId | rating | comment | createdAt
   ForumReplies  | id | postId | studentId | studentName | text | createdAt
   VocabAttempts | id | studentId | vocabId | wordEn | correct | date
   Admins        | id | username | password | name | createdAt
   QuizAttempts  | id | studentId | taskId | questionId | questionText | selectedAnswer | correctAnswer | correct | date
   VocabSRS      | id | studentId | vocabId | wordEn | wordAr | level | dueDate | lastReviewed
   SpeakingPrompts | id | grade | text
   SpeakingAttempts | id | studentId | promptId | transcript | score | date
   TaskCompletions | id | studentId | taskId | taskType | date
   Goals         | id | studentId | targetCount | weekStart | createdAt
   GameScores    | id | studentId | moves | timeSeconds | date

   grade values used across the app: prep1, prep2, prep3, sec1, sec2, sec3
   task.type values: video | text | pdf | audio | quiz   (max 25 tasks per lecture)
   Payments.status values: pending | paid
   Bookings.status values: pending | confirmed | done
   Tasks.textJson: only meaningful when type=="text" — a JSON array of blocks,
     each block is {"html": "<b>...</b>..."} — a small rich-text HTML fragment
     (bold/underline/color spans only). Written by the admin app's rich-text
     editor; the student app renders each block's html directly.
   Tasks.startTime / Tasks.endTime: only meaningful when type=="quiz" — ISO datetime
     strings; the quiz can only be started between these two times. Leave both blank
     for a quiz with no time limit.
   Students.centerCode: used for "register with a center code" — the teacher
     pre-creates a row with just centerCode+grade filled and password left EMPTY;
     the student then looks themself up by that code and fills in the rest.
   Notifications.grade / Schedule.grade / TeacherFiles.grade / Homework.grade:
     a specific grade value, or the literal string "all" to target every grade.
   QuizAttempts: one row per question answered in any renderQuiz() session —
     powers "مراجعة أخطائي" (general quiz mistake review), separate from the
     vocab-only "كلماتي الصعبة".
   VocabSRS.level: 0-5, mapped to SRS_INTERVAL_DAYS = [0,1,3,7,14,30] — a
     correct review bumps the level up (further dueDate); a wrong one resets
     it to 0 (due again immediately). Upserted by upsertVocabSRS(), called
     both from a normal تسميع session and from the "مراجعة الكلمات" screen.
   SpeakingPrompts: teacher-authored English sentences for "تمرين النطق"
     (pronunciation practice); grade is a specific grade value or "all".
   TaskCompletions: one row per finished task/quiz/تسميع session (any type),
     written purely so "هدفي الأسبوعي" can count activity over a rolling
     7-day window — separate from Progress (localStorage-only, undated) and
     from Scores (score-specific, quiz/vocab only).
   Goals: one row per time the student sets/changes their weekly target —
     renderWeeklyGoalCard() always uses the most recently created row.
   ===================================================================== */

/* ---------------------- PWA manifest (injected, keeps the app to 3 files) ---------------------- */
/* ---------------------- Best-effort content protection ----------------------
   None of this can fully stop a determined person (browsers don't allow that),
   but it deters casual copying/downloading: blocks common save/inspect
   shortcuts, blocks text selection outside inputs, and blocks copy events on
   protected content. See the note near the bottom of this file for the
   honest limits of what's possible from a web page. ------------------------ */
document.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  const blockCombo =
    (e.ctrlKey || e.metaKey) && ["s", "u", "p"].includes(k) ||
    (e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(k) ||
    k === "f12" || k === "printscreen";
  if (blockCombo) e.preventDefault();
});
document.addEventListener("copy", (e) => {
  const tag = document.activeElement?.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA") e.preventDefault();
});

(function injectManifest() {
  const manifest = {
    name: "Mr. Abdulrahim Hassan",
    short_name: "Abdulrahim Hassan",
    start_url: "./index.html",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#2F6FED",
    orientation: "portrait",
    icons: [
      { src: "https://i.ibb.co/0y2hF8Vc/Picsart-26-07-02-21-34-43-546.jpg", sizes: "512x512", type: "image/jpeg", purpose: "any maskable" },
      { src: "https://i.ibb.co/0y2hF8Vc/Picsart-26-07-02-21-34-43-546.jpg", sizes: "192x192", type: "image/jpeg" },
    ],
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = URL.createObjectURL(blob);
  document.head.appendChild(link);
})();

const CONFIG = {
  sheetsonBase: "https://api.sheetson.com/v2",
  spreadsheetId: "1vMOJsaOnXzvSRIb4nCOvy8HMjQnoAHmbaPGK0rYvbcc",
  sheetsonApiKey: "HlUZiTjLO1sp-Ou0JbsluuQNAWUoMP2XOYcVw5n6OxoroGNPfVpIDZq3fF0",
  imgbbKey: "36b0e2658ed6fad2ca48081442f1539b",
  proxycheckKey: "", // optional — a free proxycheck.io key raises the daily query limit; works without one too
  // Sign in with Google needs a real OAuth Client ID from a Google Cloud
  // project the site owner controls — I can't generate a working one myself.
  // To get one: Google Cloud Console → APIs & Services → Credentials →
  // Create Credentials → OAuth client ID → Application type "Web application"
  // → add the exact domain this site is hosted on under "Authorized
  // JavaScript origins" (e.g. https://yourdomain.com, no trailing slash) →
  // paste the Client ID string below. Left empty, the Google button simply
  // stays hidden instead of rendering broken.
  googleClientId: "355037443320-g3s1413hs3krs1gpj4r1b9ifnigendqr.apps.googleusercontent.com",
};

const GRADE_LABELS = {
  prep1: "الأول الإعدادي", prep2: "الثاني الإعدادي", prep3: "الثالث الإعدادي",
  sec1: "الأول الثانوي", sec2: "الثاني الثانوي", sec3: "الثالث الثانوي",
};

/* ---------------------- Sheetson helper ----------------------
   Sheetson requires apiKey+spreadsheetId as URL params on every request,
   PLUS an Authorization header and X-Spreadsheet-Id header on writes.
   We send both forms on every call so it works regardless of endpoint.
   "where" filtering/ordering is a paid-plan-only feature on Sheetson, so
   we fetch all rows (paginated) and filter/sort on the client instead —
   this works on every Sheetson plan. ------------------------------- */
async function sheetsonRequest(path, { method = "GET", query = {}, body } = {}) {
  const url = new URL(`${CONFIG.sheetsonBase}/${path}`);
  url.searchParams.set("apiKey", CONFIG.sheetsonApiKey);
  url.searchParams.set("spreadsheetId", CONFIG.spreadsheetId);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  if (method === "GET") url.searchParams.set("_ts", Date.now()); // cache-bust so edits/deletes show up immediately
  const headers = {
    Authorization: `Bearer ${CONFIG.sheetsonApiKey}`,
    "X-Spreadsheet-Id": CONFIG.spreadsheetId,
  };
  if (body) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  } catch (err) {
    // fetch() itself rejects (no HTTP response at all) on network loss or a CORS block —
    // the browser never exposes which of the two, so name both possibilities. Full
    // technical detail goes to the console for debugging; the student only ever sees
    // a plain, brand-free message (never mention Sheetson/CORS/support emails to them).
    console.error(`sheetsonRequest network failure — ${method} ${path}:`, err);
    throw new Error("تعذر الاتصال بالمنصة، تأكد من اتصالك بالإنترنت أو حدّث الصفحة وحاول تاني");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`sheetsonRequest ${method} ${path} failed: ${res.status} ${detail.slice(0, 300)}`);
    throw new Error("تعذر الاتصال بالمنصة، تأكد من اتصالك بالإنترنت أو حدّث الصفحة وحاول تاني");
  }
  return res.json();
}

const Sheet = {
  async list(name, { filter } = {}) {
    let all = [];
    let skip = 0;
    const limit = 1000; // fetch up to 1000 rows per request — the loop below still
    // stops on its own as soon as a page comes back with no more data, so a sheet
    // with fewer rows never pulls extra empty pages.
    for (let page = 0; page < 20; page++) {
      const json = await sheetsonRequest(`sheets/${name}`, { query: { skip, limit } });
      const results = json.results || [];
      all = all.concat(results);
      if (!json.hasNextPage || results.length < limit) break;
      skip += limit;
    }
    return filter ? all.filter(filter) : all;
  },
  async create(name, row) {
    return sheetsonRequest(`sheets/${name}`, { method: "POST", body: row });
  },
  async update(name, rowIndex, row) {
    return sheetsonRequest(`sheets/${name}/${rowIndex}`, { method: "PUT", body: row });
  },
};

async function uploadToImgbb(file) {
  const b64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const form = new FormData();
  form.append("image", b64);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${CONFIG.imgbbKey}`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.success) throw new Error("imgbb upload failed");
  return json.data.url;
}

/* ---------------------- Session ---------------------- */
const Session = {
  get() { try { return JSON.parse(localStorage.getItem("mah_session")); } catch { return null; } },
  set(s) { localStorage.setItem("mah_session", JSON.stringify(s)); },
  clear() { localStorage.removeItem("mah_session"); },
};

/* ---------------------- Local progress tracking (per student, on-device) ---------------------- */
const Progress = {
  _key(sid) { return `mah_progress_${sid}`; },
  _read(sid) { try { return JSON.parse(localStorage.getItem(this._key(sid))) || { done: [], last: null }; } catch { return { done: [], last: null }; } },
  _write(sid, data) { localStorage.setItem(this._key(sid), JSON.stringify(data)); },
  isDone(sid, taskId) { return this._read(sid).done.includes(taskId); },
  markDone(sid, taskId) {
    const data = this._read(sid);
    if (!data.done.includes(taskId)) data.done.push(taskId);
    this._write(sid, data);
  },
  setLast(sid, entry) {
    const data = this._read(sid);
    data.last = entry;
    this._write(sid, data);
  },
  getLast(sid) { return this._read(sid).last; },
  doneCount(sid, taskIds) { const done = this._read(sid).done; return taskIds.filter((id) => done.includes(id)).length; },
};

/* ---------------------- Feature: simple on-device counters ---------------------- */
const Counters = {
  _key(sid, name) { return `mah_counter_${name}_${sid}`; },
  inc(sid, name) {
    const k = this._key(sid, name);
    const v = (Number(localStorage.getItem(k)) || 0) + 1;
    localStorage.setItem(k, String(v));
    return v;
  },
  get(sid, name) { return Number(localStorage.getItem(this._key(sid, name))) || 0; },
};

/* ---------------------- Feature: XP / level system ---------------------- */
const XP = {
  _key(sid) { return `mah_xp_${sid}`; },
  get(sid) { return Number(localStorage.getItem(this._key(sid))) || 0; },
  add(sid, amount) {
    const total = this.get(sid) + amount;
    localStorage.setItem(this._key(sid), String(total));
    return total;
  },
  level(xp) { return Math.floor(xp / 100) + 1; },
  levelProgress(xp) { return xp % 100; }, // out of 100
};

/* ---------------------- Feature: badges ---------------------- */
const BADGES = {
  first_lecture: { icon: '<path d="M12 2l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-1.5z"/>', label: "أول محاضرة", desc: "أكملت أول محاضرة كاملة" },
  streak_5: { icon: '<path d="M12 2c1 4-4 5-4 9a4 4 0 0 0 8 0c0-1.5-1-2.5-1-2.5s2 1 2 4.5a5 5 0 0 1-10 0c0-5 5-6 5-11z"/>', label: "٥ أيام متتالية", desc: "دخلت المنصة ٥ أيام على التوالي" },
  perfect_quiz: { icon: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M5 9a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h3"/><path d="M19 9a2 2 0 0 0 2-2V6a1 1 0 0 0-1-1h-3"/>', label: "الدرجة الكاملة", desc: "حصلت على الدرجة الكاملة في اختبار" },
  quiz_master: { icon: '<path d="M22 10L12 4 2 10l10 6 10-6z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/>', label: "محترف اختبارات", desc: "أنهيت ١٠ اختبارات" },
  bookworm: { icon: '<path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2z"/><path d="M20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2z"/>', label: "دودة كتب", desc: "قرأت ٥ دروس نصية" },
};
const Badges = {
  _key(sid) { return `mah_badges_${sid}`; },
  list(sid) { try { return JSON.parse(localStorage.getItem(this._key(sid))) || []; } catch { return []; } },
  has(sid, id) { return this.list(sid).includes(id); },
  award(sid, id) {
    if (this.has(sid, id) || !BADGES[id]) return false;
    const items = this.list(sid);
    items.push(id);
    localStorage.setItem(this._key(sid), JSON.stringify(items));
    toast(`شارة جديدة: ${BADGES[id].label}`);
    return true;
  },
};

/* ---------------------- Feature: daily streak ---------------------- */
const Streak = {
  _key(sid) { return `mah_streak_${sid}`; },
  _read(sid) { try { return JSON.parse(localStorage.getItem(this._key(sid))) || { count: 0, lastDate: null }; } catch { return { count: 0, lastDate: null }; } },
  touch(sid) {
    const data = this._read(sid);
    const today = new Date().toDateString();
    if (data.lastDate === today) return data.count; // already counted today
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    data.count = data.lastDate === yesterday ? data.count + 1 : 1;
    data.lastDate = today;
    localStorage.setItem(this._key(sid), JSON.stringify(data));
    if (data.count >= 5) Badges.award(sid, "streak_5");
    return data.count;
  },
  get(sid) { return this._read(sid).count; },
};

/* ---------------------- Feature: bookmarked lectures (on-device) ---------------------- */
const Bookmarks = {
  _key(sid) { return `mah_bookmarks_${sid}`; },
  list(sid) { try { return JSON.parse(localStorage.getItem(this._key(sid))) || []; } catch { return []; } },
  isBookmarked(sid, lectureId) { return this.list(sid).some((b) => b.id === lectureId); },
  toggle(sid, entry) {
    const items = this.list(sid);
    const idx = items.findIndex((b) => b.id === entry.id);
    if (idx >= 0) items.splice(idx, 1); else items.push(entry);
    localStorage.setItem(this._key(sid), JSON.stringify(items));
    return idx < 0; // true if it's now bookmarked
  },
};

/* ---------------------- Feature: forum post likes (on-device "did I like it" guard) ---------------------- */
const LikedPosts = {
  _key(sid) { return `mah_liked_${sid}`; },
  _read(sid) { try { return JSON.parse(localStorage.getItem(this._key(sid))) || []; } catch { return []; } },
  has(sid, postId) { return this._read(sid).includes(postId); },
  add(sid, postId) {
    const ids = this._read(sid);
    if (!ids.includes(postId)) ids.push(postId);
    localStorage.setItem(this._key(sid), JSON.stringify(ids));
  },
};

let toastTimer;
function toast(msg) {
  clearTimeout(toastTimer);
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  toastTimer = setTimeout(() => el.remove(), 2200);
}

/* ---------------------- Auth ---------------------- */
const authError = document.getElementById("auth-error");
function showAuthError(msg) { authError.textContent = msg; authError.hidden = false; }
function clearAuthError() { authError.hidden = true; }

// Shown over the auth screen while a login/signup/center-code request is in
// flight, so the student sees the logo + "جاري التحميل" instead of a
// button that looks frozen — then the app loads straight in on success.
function showAuthLoading() { document.getElementById("auth-loading-overlay").hidden = false; }
function hideAuthLoading() { document.getElementById("auth-loading-overlay").hidden = true; }

/* ---------------------- Feature: block banned students from re-registering ----------------------
   A banned student can't just make a brand-new account to get back in. We check
   the identity details they're providing (phone, email, or the parentPhone+
   fullName pair — checking parentPhone alone would wrongly block legitimate
   siblings who share a parent's number) against every BANNED row already in
   the sheet. Only the teacher un-banning the original row lets them back in.
   This can't stop someone from getting hold of a different, never-banned
   student's real login and using that instead — there's no per-device or
   per-session identity in a plain phone/email/username login, so that part
   isn't something a check like this can close. VPN blocking (see boot()) is
   a separate, unconditional gate that already applies to every visitor,
   banned or not, before they ever reach these forms. */
async function isBannedIdentity({ phone, email, parentPhone, fullName }) {
  const banned = await Sheet.list("Students", { filter: (r) => String(r.banned).toLowerCase() === "true" });
  const emailNorm = (email || "").trim().toLowerCase();
  const nameNorm = (fullName || "").trim().toLowerCase();
  return banned.some((r) =>
    (phone && r.phone === phone) ||
    (emailNorm && (r.email || "").trim().toLowerCase() === emailNorm) ||
    (parentPhone && r.parentPhone === parentPhone && (r.fullName || "").trim().toLowerCase() === nameNorm)
  );
}

function applyAuthPanels() {
  const role = document.querySelector("#auth-role-tabs button.active").dataset.role;
  const mode = document.querySelector("#auth-mode-tabs button.active").dataset.mode;
  const isLogin = mode === "login";
  document.getElementById("login-form").hidden = !(role === "student" && isLogin);
  document.getElementById("signup-form").hidden = !(role === "student" && !isLogin);
  document.getElementById("parent-login-form").hidden = !(role === "parent" && isLogin);
  document.getElementById("parent-signup-form").hidden = !(role === "parent" && !isLogin);
  document.getElementById("forgot-form").hidden = true;
  document.getElementById("center-code-step").hidden = true;
  document.getElementById("center-complete-form").hidden = true;
  document.getElementById("google-signin-wrap").hidden = !(role === "student" && CONFIG.googleClientId);
}

// Username: force lowercase English, strip spaces, live as the student types
["su-username", "fp-username", "cc-username"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", () => { el.value = el.value.toLowerCase().replace(/\s+/g, ""); });
});

/* ---------------------- Feature: Sign in with Google (student role) ----------------------
   Uses Google Identity Services (loaded in index.html's <head>) — a purely
   client-side flow, no backend needed, consistent with how this whole app
   already talks to Sheetson/imgbb directly from the browser. The ID token
   Google returns is a signed JWT; we only need the email/name out of it, so
   we decode the payload locally rather than verifying the signature (this
   app has no server to verify it against anyway — see the security note at
   the end of this file for the same tradeoff already made everywhere else).
   An existing Students row matched by email logs straight in; a new Google
   user is routed into the normal signup form with their email/name
   pre-filled, since grade/phone/parentPhone are still required either way. */
function parseJwt(token) {
  try {
    const payload = token.split(".")[1];
    const json = decodeURIComponent(atob(payload.replace(/-/g, "+").replace(/_/g, "/")).split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
    return JSON.parse(json);
  } catch { return null; }
}
async function handleGoogleCredential(response) {
  const payload = parseJwt(response.credential);
  if (!payload?.email) return showAuthError("تعذر قراءة بيانات حساب Google");
  showAuthLoading();
  try {
    const rows = await Sheet.list("Students", { filter: (r) => (r.email || "").toLowerCase() === payload.email.toLowerCase() });
    if (rows.length) {
      const student = rows[0];
      if (String(student.banned).toLowerCase() === "true") return showBanned();
      Session.set({ role: "student", id: student.id, fullName: student.fullName, grade: student.grade, phone: student.phone });
      enterApp();
    } else {
      // No account yet — prefill the normal signup form with what Google gave us
      // and let the student fill in the rest (grade/phone/parentPhone are still required).
      document.querySelector('#auth-mode-tabs button[data-mode="signup"]').click();
      document.getElementById("su-email").value = payload.email;
      document.getElementById("su-email").readOnly = true;
      if (payload.name && !document.getElementById("su-name").value) document.getElementById("su-name").value = payload.name;
      if (payload.email && !document.getElementById("su-username").value) {
        document.getElementById("su-username").value = payload.email.split("@")[0].toLowerCase().replace(/[^a-z0-9_.]/g, "");
      }
      toast("كمّل باقي بياناتك عشان تخلّص إنشاء الحساب");
    }
  } catch (err) { showAuthError("تعذر الاتصال بالمنصة، تأكد من اتصالك بالإنترنت أو حدّث الصفحة وحاول تاني"); console.error(err); } finally { hideAuthLoading(); }
}
if (CONFIG.googleClientId) {
  window.addEventListener("load", () => {
    if (!window.google?.accounts?.id) return; // GIS script blocked/failed to load — button just won't appear
    google.accounts.id.initialize({ client_id: CONFIG.googleClientId, callback: handleGoogleCredential });
    google.accounts.id.renderButton(document.getElementById("google-signin-btn"), { theme: "outline", size: "large", width: 280, locale: "ar" });
  });
}

document.getElementById("auth-role-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (!btn) return;
  document.querySelectorAll("#auth-role-tabs button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  clearAuthError();
  applyAuthPanels();
});

document.getElementById("auth-mode-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (!btn) return;
  document.querySelectorAll("#auth-mode-tabs button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  clearAuthError();
  applyAuthPanels();
});

const loginMethodLabels = { phone: "رقم الهاتف", email: "البريد الإلكتروني", username: "اسم المستخدم" };
document.getElementById("login-method-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (!btn) return;
  document.querySelectorAll("#login-method-tabs button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("login-id-label").textContent = loginMethodLabels[btn.dataset.method];
  document.getElementById("login-id").value = "";
});

document.getElementById("btn-login").addEventListener("click", async () => {
  clearAuthError();
  const method = document.querySelector("#login-method-tabs button.active").dataset.method;
  const idVal = document.getElementById("login-id").value.trim();
  const pass = document.getElementById("login-pass").value;
  if (!idVal || !pass) return showAuthError("من فضلك أدخل البيانات كاملة");
  showAuthLoading();
  try {
    const rows = await Sheet.list("Students", { filter: (r) => r[method] === idVal });
    const student = rows.find((r) => r.password === pass);
    if (!student) return showAuthError("بيانات الدخول غير صحيحة");
    if (String(student.banned).toLowerCase() === "true") return showBanned();
    Session.set({ role: "student", id: student.id, fullName: student.fullName, grade: student.grade, phone: student.phone });
    enterApp();
  } catch (err) { showAuthError("تعذر الاتصال بالمنصة، تأكد من اتصالك بالإنترنت أو حدّث الصفحة وحاول تاني"); console.error(err); } finally { hideAuthLoading(); }
});

document.getElementById("btn-signup").addEventListener("click", async () => {
  clearAuthError();
  const name = document.getElementById("su-name").value.trim();
  const phone = document.getElementById("su-phone").value.trim();
  const parentPhone = document.getElementById("su-parent-phone").value.trim();
  const email = document.getElementById("su-email").value.trim();
  const grade = document.getElementById("su-grade").value;
  const gender = document.getElementById("su-gender").value;
  const dob = document.getElementById("su-dob").value;
  const username = document.getElementById("su-username").value.trim().toLowerCase();
  const pass = document.getElementById("su-pass").value;
  const pass2 = document.getElementById("su-pass2").value;

  if (name.split(/\s+/).filter(Boolean).length < 4) return showAuthError("الاسم يجب أن يكون رباعيًا");
  if (!/^\d{11}$/.test(phone)) return showAuthError("رقم الهاتف يجب أن يكون ١١ رقمًا");
  if (!/^\d{11}$/.test(parentPhone)) return showAuthError("رقم هاتف ولي الأمر يجب أن يكون ١١ رقمًا");
  if (!/^[a-z0-9_.]+$/.test(username)) return showAuthError("اسم المستخدم أحرف إنجليزية صغيرة وأرقام فقط");
  if (pass.length < 6) return showAuthError("كلمة المرور يجب ألا تقل عن ٦ خانات");
  if (pass !== pass2) return showAuthError("كلمتا المرور غير متطابقتين");

  showAuthLoading();
  try {
    const existingPhone = await Sheet.list("Students", { filter: (r) => r.phone === phone });
    if (existingPhone.length) return showAuthError("رقم الهاتف مسجل بالفعل");
    const existingUser = await Sheet.list("Students", { filter: (r) => r.username === username });
    if (existingUser.length) return showAuthError("اسم المستخدم مستخدم بالفعل، جرّب اسمًا آخر");
    if (await isBannedIdentity({ phone, email, parentPhone, fullName: name })) {
      return showAuthError("تم إيقاف حساب مرتبط بهذه البيانات من قبل المستر، تواصل معه لرفع الإيقاف قبل إنشاء حساب جديد");
    }
    const created = await Sheet.create("Students", {
      id: `st_${Date.now()}`, fullName: name, phone, parentPhone, email, username, password: pass,
      gender, dob, grade, banned: "false", createdAt: new Date().toISOString(),
    });
    Session.set({ role: "student", id: created.id || `st_${Date.now()}`, fullName: name, grade, phone });
    enterApp();
  } catch (err) { showAuthError("تعذر إنشاء الحساب، تأكد من اتصالك بالإنترنت أو حدّث الصفحة وحاول تاني"); console.error(err); } finally { hideAuthLoading(); }
});

/* ---------------------- Feature: register with a center code ---------------------- */
let ccStudentRow = null;

document.getElementById("center-code-link").addEventListener("click", () => {
  clearAuthError();
  document.getElementById("signup-form").hidden = true;
  document.getElementById("center-code-step").hidden = false;
});
document.getElementById("cc-back-link").addEventListener("click", () => {
  clearAuthError();
  document.getElementById("center-code-step").hidden = true;
  document.getElementById("signup-form").hidden = false;
});

document.getElementById("btn-cc-lookup").addEventListener("click", async () => {
  clearAuthError();
  const code = document.getElementById("cc-code").value.trim();
  if (!code) return showAuthError("من فضلك أدخل الكود");
  showAuthLoading();
  try {
    const rows = await Sheet.list("Students", { filter: (r) => r.centerCode === code });
    if (!rows.length) return showAuthError("الكود غير صحيح");
    if (rows[0].password) return showAuthError("الكود ده مستخدم بالفعل، سجّل دخولك عاديًا");
    ccStudentRow = rows[0];
    setupCenterCompleteForm(ccStudentRow);
    document.getElementById("center-code-step").hidden = true;
    document.getElementById("center-complete-form").hidden = false;
  } catch (err) { showAuthError("تعذر التحقق من الكود، تأكد من اتصالك بالإنترنت أو حدّث الصفحة وحاول تاني"); console.error(err); } finally { hideAuthLoading(); }
});

// Only ask the student for whatever the teacher hasn't already filled in for
// this centerCode row — anything already present in the sheet is hidden and
// carried through as-is instead of being asked again.
function setupCenterCompleteForm(row) {
  const fields = [
    { input: "cc-name", wrap: "cc-name-field", value: row.fullName },
    { input: "cc-phone", wrap: "cc-phone-field", value: row.phone },
    { input: "cc-parent-phone", wrap: "cc-parent-phone-field", value: row.parentPhone },
    { input: "cc-email", wrap: "cc-email-field", value: row.email },
    { input: "cc-gender", wrap: "cc-gender-field", value: row.gender },
    { input: "cc-dob", wrap: "cc-dob-field", value: row.dob },
  ];
  fields.forEach(({ input, wrap, value }) => {
    const inputEl = document.getElementById(input);
    const wrapEl = document.getElementById(wrap);
    if (value) { inputEl.value = value; wrapEl.hidden = true; }
    else { inputEl.value = ""; wrapEl.hidden = false; }
  });
  document.getElementById("cc-gender-dob-row").hidden = document.getElementById("cc-gender-field").hidden && document.getElementById("cc-dob-field").hidden;
  document.getElementById("cc-prefilled-hint").hidden = !fields.some((f) => f.value);
}

document.getElementById("btn-cc-complete").addEventListener("click", async () => {
  clearAuthError();
  if (!ccStudentRow) return showAuthError("من فضلك تحقق من الكود أولاً");
  const name = document.getElementById("cc-name").value.trim();
  const phone = document.getElementById("cc-phone").value.trim();
  const parentPhone = document.getElementById("cc-parent-phone").value.trim();
  const email = document.getElementById("cc-email").value.trim();
  const gender = document.getElementById("cc-gender").value;
  const dob = document.getElementById("cc-dob").value;
  const username = document.getElementById("cc-username").value.trim().toLowerCase();
  const pass = document.getElementById("cc-pass").value;
  const pass2 = document.getElementById("cc-pass2").value;

  // Only validate the fields the student actually had to fill in — anything
  // the teacher already pre-filled (hidden field) is trusted as-is.
  if (!document.getElementById("cc-name-field").hidden && name.split(/\s+/).filter(Boolean).length < 4) return showAuthError("الاسم يجب أن يكون رباعيًا");
  if (!document.getElementById("cc-phone-field").hidden && !/^\d{11}$/.test(phone)) return showAuthError("رقم الهاتف يجب أن يكون ١١ رقمًا");
  if (!document.getElementById("cc-parent-phone-field").hidden && !/^\d{11}$/.test(parentPhone)) return showAuthError("رقم هاتف ولي الأمر يجب أن يكون ١١ رقمًا");
  if (!/^[a-z0-9_.]+$/.test(username)) return showAuthError("اسم المستخدم أحرف إنجليزية صغيرة وأرقام فقط");
  if (pass.length < 6) return showAuthError("كلمة المرور يجب ألا تقل عن ٦ خانات");
  if (pass !== pass2) return showAuthError("كلمتا المرور غير متطابقتين");

  showAuthLoading();
  try {
    const existingUser = await Sheet.list("Students", { filter: (r) => r.username === username });
    if (existingUser.length) return showAuthError("اسم المستخدم مستخدم بالفعل، جرّب اسمًا آخر");
    if (await isBannedIdentity({ phone, email, parentPhone, fullName: name })) {
      return showAuthError("تم إيقاف حساب مرتبط بهذه البيانات من قبل المستر، تواصل معه لرفع الإيقاف قبل إكمال التسجيل");
    }
    await Sheet.update("Students", ccStudentRow.rowIndex, {
      fullName: name, phone, parentPhone, email, username, password: pass, gender, dob,
      banned: "false", createdAt: new Date().toISOString(),
    });
    Session.set({ role: "student", id: ccStudentRow.id, fullName: name, grade: ccStudentRow.grade, phone });
    enterApp();
  } catch (err) { showAuthError("تعذر إكمال التسجيل، تأكد من اتصالك بالإنترنت أو حدّث الصفحة وحاول تاني"); console.error(err); } finally { hideAuthLoading(); }
});

/* ---------------------- Feature: forgot password (student) ---------------------- */
document.getElementById("forgot-pass-link").addEventListener("click", () => {
  clearAuthError();
  document.getElementById("login-form").hidden = true;
  document.getElementById("forgot-form").hidden = false;
});
document.getElementById("forgot-back-link").addEventListener("click", () => {
  clearAuthError();
  document.getElementById("forgot-form").hidden = true;
  document.getElementById("login-form").hidden = false;
});
document.getElementById("btn-forgot-submit").addEventListener("click", async () => {
  clearAuthError();
  const phone = document.getElementById("fp-phone").value.trim();
  const email = document.getElementById("fp-email").value.trim().toLowerCase();
  const username = document.getElementById("fp-username").value.trim().toLowerCase();
  const pass = document.getElementById("fp-pass").value;
  const pass2 = document.getElementById("fp-pass2").value;
  if (!/^\d{11}$/.test(phone)) return showAuthError("رقم الهاتف يجب أن يكون ١١ رقمًا");
  if (!email || !username) return showAuthError("من فضلك أدخل البريد الإلكتروني واسم المستخدم كاملين");
  if (pass.length < 6) return showAuthError("كلمة المرور يجب ألا تقل عن ٦ خانات");
  if (pass !== pass2) return showAuthError("كلمتا المرور غير متطابقتين");
  try {
    const rows = await Sheet.list("Students", {
      filter: (r) => r.phone === phone && (r.email || "").toLowerCase() === email && (r.username || "").toLowerCase() === username,
    });
    if (!rows.length) return showAuthError("البيانات الثلاثة (الهاتف، البريد، اسم المستخدم) لازم تكون مطابقة لنفس الحساب");
    await Sheet.update("Students", rows[0].rowIndex, { password: pass });
    toast("تم تحديث كلمة المرور، سجّل دخولك الآن");
    document.getElementById("forgot-form").hidden = true;
    document.getElementById("login-form").hidden = false;
  } catch (err) { showAuthError("تعذر تحديث كلمة المرور، تأكد من اتصالك بالإنترنت أو حدّث الصفحة وحاول تاني"); console.error(err); }
});

document.getElementById("btn-parent-login").addEventListener("click", async () => {
  clearAuthError();
  const phone = document.getElementById("pl-phone").value.trim();
  const pass = document.getElementById("pl-pass").value;
  if (!phone || !pass) return showAuthError("من فضلك أدخل البيانات كاملة");
  try {
    const rows = await Sheet.list("Parents", { filter: (r) => r.parentPhone === phone });
    const parent = rows.find((r) => r.password === pass);
    if (!parent) return showAuthError("بيانات الدخول غير صحيحة");
    Session.set({ role: "parent", id: parent.id, parentPhone: parent.parentPhone, studentId: parent.studentId });
    enterApp();
  } catch (err) { showAuthError("تعذر الاتصال بالمنصة، تأكد من اتصالك بالإنترنت أو حدّث الصفحة وحاول تاني"); console.error(err); }
});

document.getElementById("btn-parent-signup").addEventListener("click", async () => {
  clearAuthError();
  const phone = document.getElementById("ps-phone").value.trim();
  const studentPhone = document.getElementById("ps-student-phone").value.trim();
  const pass = document.getElementById("ps-pass").value;
  const pass2 = document.getElementById("ps-pass2").value;
  if (!/^\d{11}$/.test(phone)) return showAuthError("رقم هاتف ولي الأمر يجب أن يكون ١١ رقمًا");
  if (pass.length < 6) return showAuthError("كلمة المرور يجب ألا تقل عن ٦ خانات");
  if (pass !== pass2) return showAuthError("كلمتا المرور غير متطابقتين");
  try {
    const students = await Sheet.list("Students", { filter: (r) => r.phone === studentPhone });
    if (!students.length) return showAuthError("رقم هاتف الابن غير مسجل على المنصة");
    const existing = await Sheet.list("Parents", { filter: (r) => r.parentPhone === phone });
    if (existing.length) return showAuthError("رقم هاتف ولي الأمر مسجل بالفعل");
    const created = await Sheet.create("Parents", {
      id: `pr_${Date.now()}`, parentPhone: phone, password: pass, studentPhone,
      studentId: students[0].id, createdAt: new Date().toISOString(),
    });
    Session.set({ role: "parent", id: created.id || `pr_${Date.now()}`, parentPhone: phone, studentId: students[0].id });
    enterApp();
  } catch (err) { showAuthError("تعذر إنشاء الحساب، تأكد من اتصالك بالإنترنت أو حدّث الصفحة وحاول تاني"); console.error(err); }
});

function showBanned() {
  document.getElementById("view-auth").hidden = true;
  document.getElementById("view-app").hidden = true;
  document.getElementById("loading").hidden = true;
  document.getElementById("view-banned").hidden = false;
  Session.clear();
}

/* ---------------------- Router / tabs ---------------------- */
let quizActive = false; // guards accidental navigation away mid-quiz
const screens = ["home", "course", "task", "quiz", "vocab", "forum", "faq", "profile"];
function showScreen(name) {
  screens.forEach((s) => (document.getElementById(`screen-${s}`).hidden = s !== name));
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
}
document.querySelector(".tabbar").addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (!btn) return;
  if (quizActive && !confirm("هل تريد الخروج؟ لن تُحتسب نتيجة الاختبار الحالي")) return;
  quizActive = false;
  NavStack = []; // switching tabs starts a fresh in-app navigation branch
  const tab = btn.dataset.tab;
  if (tab === "home") renderHome();
  if (tab === "forum") renderForum();
  if (tab === "faq") renderFAQ();
  if (tab === "profile") renderProfile();
});

/* ---------------------- In-app back-navigation stack ----------------------
   The platform must never let a "رجوع" tap, or the phone's own back
   button/gesture, actually exit the site — only the logout button should
   do that. So every deeper navigation (course -> lecture -> task/quiz/vocab)
   pushes the screen it came from onto NavStack, and every "back" action
   (on-screen button or hardware back) pops from NavStack instead of
   touching real browser history. ---------------------------------------- */
let NavStack = [];
function pushNav(fn, args) { NavStack.push({ fn, args: args || [] }); }
function goBack() {
  const prev = NavStack.pop();
  if (prev) prev.fn(...prev.args);
  else renderHome(); // nothing left to go back to — stay safely inside the platform
}

let countdownTimer = null; // quiz countdown, referenced by the back-trap handler below
let historyTrapped = false;
function armBackTrap() {
  if (historyTrapped) return;
  historyTrapped = true;
  history.pushState({ mahTrap: true }, "", location.href);
  window.addEventListener("popstate", () => {
    // re-arm immediately so the phone's back button/gesture can never
    // actually leave the platform — it only moves within the app.
    history.pushState({ mahTrap: true }, "", location.href);
    const s = Session.get();
    if (!s) return;              // not logged in yet — nothing to trap
    if (s.role === "parent") return; // single-screen dashboard, nothing to go back to
    if (quizActive) {
      if (confirm("هل تريد الخروج؟ لن تُحتسب نتيجة الاختبار الحالي")) {
        quizActive = false;
        if (countdownTimer) clearInterval(countdownTimer);
        goBack();
      }
      return;
    }
    goBack();
  });
}

function svgIcon(path) { return `<svg class="icon" viewBox="0 0 24 24">${path}</svg>`; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function stripHtml(html) { const d = document.createElement("div"); d.innerHTML = html; return d.textContent || ""; }
// Turns plain-text URLs (http://, https://, or bare www.) sitting inline in normal
// text into clickable links — not buttons, just an <a> in the middle of the sentence
// like any other word. escapeFirst=true is for user-typed content (forum posts/
// replies) so raw HTML someone pastes shows as plain text instead of running;
// admin-authored content (notifications, FAQ answers) is left as-is otherwise,
// exactly like before, just with URLs inside it turned into links.
function linkify(text, escapeFirst = false) {
  const src = escapeFirst ? escapeHtml(text || "") : (text || "");
  return src.replace(/((?:https?:\/\/|www\.)[^\s<>"']+)/gi, (match) => {
    let url = match;
    let suffix = "";
    const trailing = url.match(/[)\].,!؟?:;]+$/);
    if (trailing) { suffix = trailing[0]; url = url.slice(0, -suffix.length); }
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${suffix}`;
  });
}

/* ---------------------- Feature: shareable deep links ----------------------
   Builds a link like index.html#course=<id> (matching the format the
   existing course-share button in renderCourse already generates — that
   button worked cosmetically before but nothing ever read the hash back,
   so sharing a course link didn't actually take the recipient anywhere;
   this adds the missing piece). handleDeepLink() below reads the same
   #course=/#lecture=/#file=/#post= hash once the student is logged in and
   jumps straight to the right screen. */
function buildShareLink(type, id) {
  return `${location.href.split("#")[0]}#${type}=${id}`;
}
async function shareLink(type, id, label) {
  const shareText = `${label || "Mr. Abdulrahim Hassan"}\n${buildShareLink(type, id)}`;
  try {
    if (navigator.share) await navigator.share({ title: "Mr. Abdulrahim Hassan", text: shareText });
    else { await navigator.clipboard.writeText(shareText); toast("تم نسخ الرابط"); }
  } catch { /* user cancelled the native share sheet — no action needed */ }
}

// Shared English pronunciation helper — used by the vocab (تسميع) test itself
// (auto-play only, no manual replay there) and by the student's personal
// word bank (openWordBank), where replaying pronunciation is always allowed.
function speak(word) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-US";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
const ICONS = {
  video: '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  quiz: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
};

function skeletonRow(n, cls) {
  return Array.from({ length: n }).map(() => `<div class="skeleton ${cls}"></div>`).join("");
}

/* ---------------------- Feature: course progress bar on Home cards ---------------------- */
async function attachCourseProgress(studentId, courseId) {
  const holder = document.getElementById(`cprog-${courseId}`);
  if (!holder) return;
  try {
    const lectures = await Sheet.list("Lectures", { filter: (r) => r.courseId === courseId });
    if (!lectures.length) return;
    const taskLists = await Promise.all(lectures.map((l) => Sheet.list("Tasks", { filter: (r) => r.lectureId === l.id })));
    const allIds = taskLists.flat().map((t) => t.id);
    if (!allIds.length) return;
    const doneN = Progress.doneCount(studentId, allIds);
    const pct = Math.round((doneN / allIds.length) * 100);
    const el = document.getElementById(`cprog-${courseId}`);
    if (el) el.innerHTML = `<div class="course-progress-bar"><div style="width:${pct}%"></div></div><span>${pct}%</span>`;
  } catch { /* progress is a nice-to-have — silently skip on failure */ }
}

/* ---------------------- Home ---------------------- */
async function renderHome() {
  showScreen("home");
  const el = document.getElementById("screen-home");
  const s = Session.get();
  const last = Progress.getLast(s.id);
  el.innerHTML = `
    <div class="ar" dir="rtl">
      <div class="greeting" style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div class="name heading">أهلاً، ${s.fullName.split(" ")[0]}</div>
          <div class="grade-pill">${GRADE_LABELS[s.grade]}</div>
          ${Streak.get(s.id) > 1 ? `<div class="streak-pill">${svgIcon('<path d="M12 2c1 4-4 5-4 9a4 4 0 0 0 8 0c0-1.5-1-2.5-1-2.5s2 1 2 4.5a5 5 0 0 1-10 0c0-5 5-6 5-11z"/>')} ${Streak.get(s.id)} أيام متتالية</div>` : ""}
        </div>
        <button class="btn-ghost" id="btn-leaderboard" style="width:auto;padding:8px 14px;display:flex;align-items:center;gap:6px;">
          ${svgIcon('<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M5 9a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h3"/><path d="M19 9a2 2 0 0 0 2-2V6a1 1 0 0 0-1-1h-3"/>')}
          لوحة الشرف
        </button>
      </div>
      ${last ? `
      <div class="continue-card" id="continue-card">
        <div>
          <div class="continue-lbl">أكمل من حيث توقفت</div>
          <div class="continue-title">${last.title}</div>
        </div>
        ${svgIcon('<path d="M9 6l6 6-6 6"/>')}
      </div>` : ""}

      <div class="quick-links">
        <button class="quick-link" id="ql-schedule">
          ${svgIcon('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>')}
          <span>جدول المواعيد</span>
        </button>
        <button class="quick-link" id="ql-notifications">
          ${svgIcon('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>')}
          <span>الإشعارات</span>
          <span class="badge" id="notif-badge" hidden>0</span>
        </button>
        <button class="quick-link" id="ql-files">
          ${svgIcon('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>')}
          <span>ملفات المستر</span>
        </button>
        <button class="quick-link" id="ql-bookmarks">
          ${svgIcon('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>')}
          <span>المفضلة</span>
        </button>
        <button class="quick-link" id="ql-homework">
          ${svgIcon('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>')}
          <span>الواجبات</span>
        </button>
        <button class="quick-link" id="ql-booking">
          ${svgIcon('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M9 16l2 2 4-4"/>')}
          <span>حجز جلسة</span>
        </button>
        <button class="quick-link" id="ql-hardwords">
          ${svgIcon('<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/><path d="M11 8v3M11 14h.01"/>')}
          <span>كلماتي الصعبة</span>
        </button>
        <button class="quick-link" id="ql-wordbank">
          ${svgIcon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>')}
          <span>لوحة الكلمات</span>
        </button>
        <button class="quick-link" id="ql-support">
          ${svgIcon('<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>')}
          <span>الدعم الفني</span>
        </button>
        <button class="quick-link" id="ql-quizmistakes">
          ${svgIcon('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>')}
          <span>مراجعة أخطائي</span>
        </button>
        <button class="quick-link" id="ql-vocabreview">
          ${svgIcon('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>')}
          <span>مراجعة الكلمات</span>
        </button>
        <button class="quick-link" id="ql-speaking">
          ${svgIcon('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>')}
          <span>تمرين النطق</span>
        </button>
        <button class="quick-link" id="ql-wordgame">
          ${svgIcon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>')}
          <span>لعبة الكلمات</span>
        </button>
        <button class="quick-link" id="ql-teachernotes">
          ${svgIcon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>')}
          <span>ملاحظات المستر</span>
        </button>
        <button class="quick-link" id="ql-reading">
          ${svgIcon('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>')}
          <span>قطع القراءة</span>
        </button>
        <button class="quick-link" id="ql-grammar">
          ${svgIcon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/>')}
          <span>قواعد اللغة</span>
        </button>
        <button class="quick-link" id="ql-myquestions">
          ${svgIcon('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4"/><path d="M12 17h.01"/>')}
          <span>أسئلتي للمستر</span>
        </button>
      </div>

      <div class="section-title"><h3>هدفي الأسبوعي</h3></div>
      <div id="weekly-goal-card"><div class="spinner"></div></div>

      <div class="section-title"><h3>الكورسات</h3></div>
      <div class="search-box">
        <input id="course-search" type="text" placeholder="ابحث عن كورس...">
        ${svgIcon('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>')}
      </div>
      <div id="home-courses" class="card-row">${skeletonRow(3, "skeleton-course")}</div>
    </div>`;
  if (last) document.getElementById("continue-card").addEventListener("click", () => { pushNav(renderHome, []); last.taskType === "quiz" ? renderQuiz(last.taskObj) : renderTask(last.taskObj); });
  document.getElementById("btn-leaderboard").addEventListener("click", () => openLeaderboard(s.grade));
  document.getElementById("ql-schedule").addEventListener("click", () => openSchedule(s.grade));
  document.getElementById("ql-notifications").addEventListener("click", () => openNotifications(s));
  document.getElementById("ql-files").addEventListener("click", () => openTeacherFiles(s.grade));
  document.getElementById("ql-bookmarks").addEventListener("click", () => openBookmarks(s));
  document.getElementById("ql-homework").addEventListener("click", () => openHomework(s));
  document.getElementById("ql-booking").addEventListener("click", () => openBooking(s));
  document.getElementById("ql-hardwords").addEventListener("click", () => openHardWords(s));
  document.getElementById("ql-wordbank").addEventListener("click", () => openWordBank(s));
  document.getElementById("ql-support").addEventListener("click", () => window.open("https://mrabdulrahimsup.oneapp.dev/", "_blank"));
  document.getElementById("ql-quizmistakes").addEventListener("click", () => openQuizMistakes(s));
  document.getElementById("ql-vocabreview").addEventListener("click", () => openVocabReview(s));
  document.getElementById("ql-speaking").addEventListener("click", () => openSpeakingPractice(s));
  document.getElementById("ql-wordgame").addEventListener("click", () => openWordGame(s));
  document.getElementById("ql-teachernotes").addEventListener("click", () => openTeacherNotes(s));
  document.getElementById("ql-reading").addEventListener("click", () => openReadingList(s));
  document.getElementById("ql-grammar").addEventListener("click", () => openGrammarBank(s));
  document.getElementById("ql-myquestions").addEventListener("click", () => openMyQuestions(s));
  refreshNotifBadge(s);
  renderWeeklyGoalCard(s);
  try {
    const courses = await Sheet.list("Courses", { filter: (r) => r.grade === s.grade });
    const wrap = document.getElementById("home-courses");
    if (!courses.length) { wrap.outerHTML = `<div class="empty">لا توجد كورسات متاحة لصفك الدراسي حاليًا</div>`; return; }
    function draw(list) {
      wrap.innerHTML = list.length ? list.map((c) => `
        <div class="course-card" data-id="${c.id}" style="position:relative;">
          <button class="icon-btn" data-share-course="${c.id}" data-title="${escapeHtml(c.titleAr || c.title || "")}" title="مشاركة الرابط" style="position:absolute;top:8px;left:8px;z-index:2;background:rgba(255,255,255,.9);">${svgIcon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>')}</button>
          <img class="thumb" src="${c.image || ""}" onerror="this.style.display='none'">
          <div class="body">
            <div class="title">${c.titleAr || c.title}</div>
            <div class="meta">${c.month || ""}</div>
            <div class="course-progress" id="cprog-${c.id}"></div>
          </div>
        </div>`).join("") : `<div class="empty">لا توجد نتائج</div>`;
      wrap.querySelectorAll(".course-card").forEach((card) =>
        card.addEventListener("click", () => renderCourse(card.dataset.id, courses.find((c) => c.id === card.dataset.id)))
      );
      wrap.querySelectorAll("button[data-share-course]").forEach((btn) =>
        btn.addEventListener("click", (e) => { e.stopPropagation(); shareLink("course", btn.dataset.shareCourse, btn.dataset.title); })
      );
      list.forEach((c) => attachCourseProgress(s.id, c.id));
    }
    draw(courses);
    document.getElementById("course-search").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      draw(courses.filter((c) => (c.titleAr || "").toLowerCase().includes(q) || (c.title || "").toLowerCase().includes(q)));
    });
  } catch (err) { document.getElementById("home-courses").outerHTML = `<div class="empty">تعذر تحميل الكورسات</div>`; console.error(err); }
}

/* ---------------------- Feature: weekly personal goal (DB-backed) ----------------------
   A student sets how many tasks/quizzes/تسميع sessions they want to finish
   this week; progress is counted from TaskCompletions (written whenever any
   task, quiz, or vocab test is completed — see the hooks in completeTask(),
   the quiz finish(), and the vocab finish() above) over a rolling 7-day
   window, not a fixed Sat–Fri calendar week, to keep the logic simple. */
async function renderWeeklyGoalCard(s) {
  const card = document.getElementById("weekly-goal-card");
  if (!card) return;
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const [goals, completions] = await Promise.all([
      Sheet.list("Goals", { filter: (r) => r.studentId === s.id }),
      Sheet.list("TaskCompletions", { filter: (r) => r.studentId === s.id && new Date(r.date) >= weekAgo }),
    ]);
    const latestGoal = goals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const done = completions.length;
    if (!latestGoal) {
      card.innerHTML = `
        <div class="path-card">
          <div class="sub" style="margin-bottom:10px;">حدّد كام مهمة/اختبار/تسميع عايز تخلّص منهم الأسبوع ده</div>
          <div style="display:flex;gap:8px;">
            <input id="goal-target" type="number" min="1" max="200" placeholder="مثلًا: ١٠" style="flex:1;padding:10px 12px;border-radius:10px;border:1.5px solid var(--panel-line);">
            <button class="btn-primary" id="goal-set" style="width:auto;padding:0 16px;">حفظ الهدف</button>
          </div>
        </div>`;
      document.getElementById("goal-set").addEventListener("click", async () => {
        const target = Number(document.getElementById("goal-target").value);
        if (!target || target < 1) return toast("اكتب رقم صحيح أكبر من صفر");
        try {
          await Sheet.create("Goals", { id: `gl_${Date.now()}`, studentId: s.id, targetCount: target, weekStart: new Date().toISOString(), createdAt: new Date().toISOString() });
          renderWeeklyGoalCard(s);
        } catch { toast("تعذر حفظ الهدف"); }
      });
      return;
    }
    const target = Number(latestGoal.targetCount) || 1;
    const pct = Math.min(100, Math.round((done / target) * 100));
    card.innerHTML = `
      <div class="path-card">
        <div class="sub" style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span>${done} من ${target}</span>
          <span>${pct >= 100 ? "🎉 خلصت هدفك!" : `${pct}%`}</span>
        </div>
        <div class="level-bar"><div style="width:${pct}%"></div></div>
        <button class="btn-ghost" id="goal-edit" style="margin-top:10px;">تغيير الهدف</button>
      </div>`;
    document.getElementById("goal-edit").addEventListener("click", async () => {
      const target2 = Number(prompt("عدد المهام الجديد للهدف الأسبوعي:", String(target)));
      if (!target2 || target2 < 1) return;
      try {
        await Sheet.create("Goals", { id: `gl_${Date.now()}`, studentId: s.id, targetCount: target2, weekStart: new Date().toISOString(), createdAt: new Date().toISOString() });
        renderWeeklyGoalCard(s);
      } catch { toast("تعذر تحديث الهدف"); }
    });
  } catch (err) { card.innerHTML = `<div class="empty">تعذر تحميل الهدف الأسبوعي</div>`; console.error(err); }
}

/* ---------------------- Leaderboard ---------------------- */
async function openLeaderboard(grade) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const [students, scores] = await Promise.all([
      Sheet.list("Students", { filter: (r) => r.grade === grade }),
      Sheet.list("Scores"),
    ]);
    const rows = students.map((st) => {
      const mine = scores.filter((sc) => sc.studentId === st.id);
      const pct = mine.length
        ? Math.round((mine.reduce((sum, sc) => sum + (Number(sc.score) / (Number(sc.total) || 1)), 0) / mine.length) * 100)
        : 0;
      return { name: st.fullName, pct, count: mine.length };
    }).filter((r) => r.count > 0 && r.pct >= 88).sort((a, b) => b.pct - a.pct).slice(0, 20);

    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">لوحة الشرف</div>
      <div class="report-sub">أفضل الطلاب حسب متوسط الاختبارات — ${GRADE_LABELS[grade]}</div>
      ${rows.length ? rows.map((r, i) => `
        <div class="lb-row">
          <div class="lb-rank">${i + 1}</div>
          <div class="lb-name">${r.name}</div>
          <div class="lb-pct">${r.pct}%</div>
        </div>`).join("") : `<div class="empty">لا توجد نتائج اختبارات بعد</div>`}`;
    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
  } catch (err) {
    content.innerHTML = `<div class="empty">تعذر تحميل لوحة الشرف</div>`;
    console.error(err);
  }
}

/* ---------------------- Feature: schedule ---------------------- */
async function openSchedule(grade) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const rows = await Sheet.list("Schedule", { filter: (r) => r.grade === grade });
    const dayOrder = { "السبت": 0, "الأحد": 1, "الاثنين": 2, "الثلاثاء": 3, "الأربعاء": 4, "الخميس": 5, "الجمعة": 6 };
    rows.sort((a, b) => (dayOrder[a.day] ?? 9) - (dayOrder[b.day] ?? 9));
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">جدول المواعيد</div>
      <div class="report-sub">${GRADE_LABELS[grade]}</div>
      ${rows.length ? rows.map((r) => `
        <div class="schedule-row">
          <div class="schedule-day">${r.day}</div>
          <div style="flex:1;">
            <div class="schedule-title">${r.title}</div>
            ${r.note ? `<div class="schedule-time">${r.note}</div>` : ""}
          </div>
          <div class="schedule-time">${r.time || ""}</div>
        </div>`).join("") : `<div class="empty">لسه المستر مضافش مواعيد</div>`}`;
    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل الجدول</div>`; console.error(err); }
}

/* ---------------------- Feature: notifications ---------------------- */
const NotifRead = {
  _key(sid) { return `mah_notif_read_${sid}`; },
  getRead(sid) { try { return JSON.parse(localStorage.getItem(this._key(sid))) || []; } catch { return []; } },
  markAllRead(sid, ids) { localStorage.setItem(this._key(sid), JSON.stringify(ids)); },
};

async function refreshNotifBadge(s) {
  try {
    const rows = await Sheet.list("Notifications", { filter: (r) => r.grade === s.grade || r.grade === "all" });
    const read = NotifRead.getRead(s.id);
    const unread = rows.filter((r) => !read.includes(r.id)).length;
    const badge = document.getElementById("notif-badge");
    if (badge) { badge.hidden = unread === 0; badge.textContent = unread; }
  } catch { /* silent — badge just won't update this time */ }
}

async function openNotifications(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const rows = (await Sheet.list("Notifications", { filter: (r) => r.grade === s.grade || r.grade === "all" }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">الإشعارات</div>
      ${rows.length ? rows.map((n) => `
        <div class="notif-row">
          <div class="notif-title">${n.title}</div>
          <div class="notif-body">${linkify(n.body || "")}</div>
          <div class="notif-when">${n.createdAt ? new Date(n.createdAt).toLocaleString("ar-EG") : ""}</div>
        </div>`).join("") : `<div class="empty">لا توجد إشعارات</div>`}`;
    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
    NotifRead.markAllRead(s.id, rows.map((r) => r.id));
    const badge = document.getElementById("notif-badge");
    if (badge) badge.hidden = true;
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل الإشعارات</div>`; console.error(err); }
}

/* ---------------------- Feature: teacher files & resources ---------------------- */
async function openTeacherFiles(grade) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const rows = await Sheet.list("TeacherFiles", { filter: (r) => r.grade === grade || r.grade === "all" });
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">ملفات ومصادر المستر</div>
      ${rows.length ? rows.map((f) => `
        <div class="file-row">
          ${svgIcon(f.type === "pdf" ? ICONS.pdf : '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>')}
          <div class="name">${f.title}</div>
          <button class="icon-btn" data-share-file="${f.id}" data-title="${escapeHtml(f.title)}" title="مشاركة الرابط">${svgIcon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>')}</button>
          <button data-url="${f.fileUrl}" data-name="${f.title}">تحميل</button>
        </div>`).join("") : `<div class="empty">لسه المستر مرفعش ملفات</div>`}`;
    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
    content.querySelectorAll(".file-row button[data-url]").forEach((btn) =>
      btn.addEventListener("click", () => forceDownload(btn.dataset.url, btn.dataset.name))
    );
    content.querySelectorAll("button[data-share-file]").forEach((btn) =>
      btn.addEventListener("click", () => shareLink("file", btn.dataset.shareFile, btn.dataset.title))
    );
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل الملفات</div>`; console.error(err); }
}

/* ---------------------- Feature: bookmarked lectures list ---------------------- */
async function openBookmarks(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  const items = Bookmarks.list(s.id);
  content.innerHTML = `
    <div class="report-head">
      <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
      <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
    </div>
    <div class="report-title heading">المفضلة</div>
    ${items.length ? items.map((b) => `
      <div class="path-card" style="margin-bottom:10px;cursor:pointer;" data-lid="${b.id}" data-cid="${b.courseId}">
        <div class="title">${b.title}</div>
      </div>`).join("") : `<div class="empty">لسه مضفتش أي محاضرة للمفضلة</div>`}`;
  document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
  content.querySelectorAll(".path-card[data-lid]").forEach((card) =>
    card.addEventListener("click", () => {
      overlay.hidden = true;
      renderLectureTasks(card.dataset.lid, { title: card.querySelector(".title").textContent });
    })
  );
}

/* ---------------------- Feature: homework assignments (DB-backed) ---------------------- */
async function openHomework(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const [items, subs] = await Promise.all([
      Sheet.list("Homework", { filter: (r) => r.grade === s.grade || r.grade === "all" }),
      Sheet.list("HomeworkSubs", { filter: (r) => r.studentId === s.id }),
    ]);
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">الواجبات</div>
      ${items.length ? items.map((h) => {
        const submitted = subs.some((sub) => sub.homeworkId === h.id);
        return `<div class="path-card" style="margin-bottom:10px;">
          <div class="title">${h.title}</div>
          <div class="sub">${h.description || ""}${h.dueDate ? ` — يسلم قبل ${new Date(h.dueDate).toLocaleDateString("ar-EG")}` : ""}</div>
          <button class="icon-btn ${submitted ? "active" : ""}" data-hwid="${h.id}" style="margin-top:8px;" ${submitted ? "disabled" : ""}>
            ${svgIcon('<path d="M20 6L9 17l-5-5"/>')} ${submitted ? "تم التسليم" : "تسليم الواجب"}
          </button>
        </div>`;
      }).join("") : `<div class="empty">لا توجد واجبات حاليًا</div>`}`;
    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
    content.querySelectorAll("button[data-hwid]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await Sheet.create("HomeworkSubs", { id: `hs_${Date.now()}`, homeworkId: btn.dataset.hwid, studentId: s.id, submittedAt: new Date().toISOString(), note: "" });
          btn.classList.add("active");
          btn.innerHTML = `${svgIcon('<path d="M20 6L9 17l-5-5"/>')} تم التسليم`;
          toast("تم تسجيل تسليم الواجب");
        } catch { btn.disabled = false; toast("تعذر تسجيل التسليم"); }
      })
    );
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل الواجبات</div>`; console.error(err); }
}

/* ---------------------- Feature: book a session with the teacher (DB-backed) ---------------------- */
async function openBooking(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `
    <div class="report-head">
      <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
      <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
    </div>
    <div class="report-title heading">حجز جلسة مراجعة</div>
    <div class="field"><label>التاريخ والوقت المفضل</label><input id="bk-date" type="datetime-local"></div>
    <div class="field"><label>ملاحظة (اختياري)</label><input id="bk-note" type="text" placeholder="مثلاً: مراجعة present perfect"></div>
    <button class="btn-primary" id="bk-submit">إرسال طلب الحجز</button>
    <div id="bk-list" style="margin-top:16px;"></div>`;
  document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
  document.getElementById("bk-submit").addEventListener("click", async () => {
    const date = document.getElementById("bk-date").value;
    const note = document.getElementById("bk-note").value.trim();
    if (!date) return toast("من فضلك اختر تاريخ ووقت");
    try {
      await Sheet.create("Bookings", { id: `bk_${Date.now()}`, studentId: s.id, studentName: s.fullName, requestedDate: date, note, status: "pending", createdAt: new Date().toISOString() });
      toast("تم إرسال طلب الحجز، بانتظار تأكيد المستر");
      loadMyBookings();
    } catch { toast("تعذر إرسال الطلب"); }
  });
  async function loadMyBookings() {
    const list = document.getElementById("bk-list");
    list.innerHTML = `<div class="spinner"></div>`;
    try {
      const mine = (await Sheet.list("Bookings", { filter: (r) => r.studentId === s.id }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      list.innerHTML = mine.length ? `<div class="section-title"><h3>طلباتي</h3></div>` + mine.map((b) => `
        <div class="notif-row">
          <div class="notif-title">${new Date(b.requestedDate).toLocaleString("ar-EG")}</div>
          <div class="notif-body">${b.note || ""} — ${b.status === "confirmed" ? "تم التأكيد" : b.status === "done" ? "تمت" : "بانتظار الرد"}</div>
        </div>`).join("") : "";
    } catch { /* silent — list is a nice-to-have */ }
  }
  loadMyBookings();
}

/* ---------------------- Feature: vocabulary mistake review (DB-backed) ---------------------- */
async function openHardWords(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const attempts = await Sheet.list("VocabAttempts", { filter: (r) => r.studentId === s.id });
    const wrongByWord = {};
    attempts.forEach((a) => {
      if (String(a.correct).toLowerCase() === "true") return;
      wrongByWord[a.wordEn] = (wrongByWord[a.wordEn] || 0) + 1;
    });
    const words = Object.entries(wrongByWord).sort((a, b) => b[1] - a[1]).slice(0, 30);
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">كلماتي الصعبة</div>
      <div class="report-sub">الكلمات اللي بتخطئ فيها أكتر في التسميع</div>
      ${words.length ? words.map(([w, n]) => `
        <div class="report-list-item"><span>${w}</span><span>أخطأت ${n} ${n === 1 ? "مرة" : "مرات"}</span></div>`).join("")
        : `<div class="empty">لسه معندكش أي أخطاء مسجلة — ابدأ تسميع كلمات عشان نجمعلك مراجعة هنا</div>`}`;
    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل المراجعة</div>`; console.error(err); }
}

/* ---------------------- Feature: personal word bank (DB-backed) ----------------------
   Only shows a word once the student has actually been tested on it in a
   تسميع session (i.e. it exists in VocabAttempts for them) — nothing here
   is visible ahead of time. Pronunciation can be replayed freely here,
   unlike during the test itself where it only plays once automatically. */
async function openWordBank(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const attempts = await Sheet.list("VocabAttempts", { filter: (r) => r.studentId === s.id });
    const byVocabId = new Map(); // keep the most recent attempt per word
    attempts.forEach((a) => {
      const prev = byVocabId.get(a.vocabId);
      if (!prev || new Date(a.date) > new Date(prev.date)) {
        byVocabId.set(a.vocabId, { wordEn: a.wordEn, correct: String(a.correct).toLowerCase() === "true", date: a.date });
      }
    });
    const vocabIds = new Set(byVocabId.keys());
    const vocabRows = vocabIds.size ? await Sheet.list("Vocab", { filter: (r) => vocabIds.has(r.id) }) : [];
    const wordArById = {};
    vocabRows.forEach((v) => { wordArById[v.id] = v.wordAr; });
    const entries = Array.from(byVocabId.entries())
      .map(([vocabId, info]) => ({ wordEn: info.wordEn, wordAr: wordArById[vocabId] || "", correct: info.correct }))
      .sort((a, b) => a.wordEn.localeCompare(b.wordEn));
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">لوحة الكلمات</div>
      <div class="report-sub">كل الكلمات اللي اتسمّعتلك قبل كده — اضغط على السماعة لتسمع النطق في أي وقت</div>
      ${entries.length ? entries.map((e) => `
        <div class="report-list-item">
          <button class="speak-btn-sm" data-word="${escapeHtml(e.wordEn)}">${svgIcon(ICONS.audio)}</button>
          <span style="flex:1;padding:0 10px;">${escapeHtml(e.wordEn)}${e.wordAr ? " — " + escapeHtml(e.wordAr) : ""}</span>
          <span style="color:${e.correct ? "var(--mint)" : "var(--rose)"};">${e.correct ? "صح" : "خطأ"}</span>
        </div>`).join("")
        : `<div class="empty">لسه معملتش أي تسميع — أول ما تخلّص تسميع كلمات هتظهرلك هنا مع إمكانية سماع النطق وقت ما تحب</div>`}`;
    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
    content.querySelectorAll(".speak-btn-sm[data-word]").forEach((btn) => btn.addEventListener("click", () => speak(btn.dataset.word)));
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل لوحة الكلمات</div>`; console.error(err); }
}

/* ---------------------- Feature: general quiz mistake review (DB-backed) ----------------------
   Every question answered in any renderQuiz() attempt is logged to
   QuizAttempts (see the click handler inside renderQuiz). This surfaces the
   ones the student got wrong, across every quiz, not just vocab — the
   companion to "كلماتي الصعبة" which only covers تسميع words. */
async function openQuizMistakes(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const attempts = await Sheet.list("QuizAttempts", { filter: (r) => r.studentId === s.id });
    const latestByQuestion = new Map(); // keep only the most recent attempt per question
    attempts.forEach((a) => {
      const prev = latestByQuestion.get(a.questionId);
      if (!prev || new Date(a.date) > new Date(prev.date)) latestByQuestion.set(a.questionId, a);
    });
    const wrongOnes = Array.from(latestByQuestion.values())
      .filter((a) => String(a.correct).toLowerCase() !== "true")
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 40);
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">مراجعة أخطائي</div>
      <div class="report-sub">أسئلة الاختبارات اللي جاوبت عليها غلط آخر مرة — جاوبتها صح بعد كده؟ خش الاختبار تاني وهتتحدث هنا تلقائيًا</div>
      ${wrongOnes.length ? wrongOnes.map((a) => `
        <div class="path-card" style="margin-bottom:10px;">
          <div class="title">${escapeHtml(a.questionText || a.questionId)}</div>
          <div class="sub" style="margin-top:6px;">
            <span style="color:var(--rose);">إجابتك: ${escapeHtml(a.selectedAnswer || "—")}</span><br>
            <span style="color:var(--mint);">الصح: ${escapeHtml(a.correctAnswer || "—")}</span>
          </div>
        </div>`).join("")
        : `<div class="empty">مفيش أي أخطاء مسجلة — كل اللي جاوبته صح، أو لسه معملتش اختبارات</div>`}`;
    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل المراجعة</div>`; console.error(err); }
}

/* ---------------------- Feature: vocab spaced-repetition review (DB-backed) ----------------------
   Every تسميع answer also upserts a VocabSRS row (see upsertVocabSRS, called
   from renderVocab) tracking a simple level 0-5 and a dueDate. Getting a word
   right pushes its level up and its next due date further out; getting it
   wrong resets it to level 0 (due again right away). This screen shows only
   the words that are due today, self-graded flashcard style — the student
   sees the Arabic meaning, tries to recall the English, reveals the answer,
   then honestly marks whether they knew it. */
const SRS_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30]; // level -> days until the next time it's due
async function upsertVocabSRS(studentId, vocabId, wordEn, wordAr, isCorrect) {
  const rows = await Sheet.list("VocabSRS", { filter: (r) => r.studentId === studentId && r.vocabId === vocabId });
  const prevLevel = rows.length ? Number(rows[0].level) || 0 : 0;
  const newLevel = isCorrect ? Math.min(prevLevel + 1, SRS_INTERVAL_DAYS.length - 1) : 0;
  const dueDate = new Date(Date.now() + SRS_INTERVAL_DAYS[newLevel] * 86400000).toISOString();
  const row = { studentId, vocabId, wordEn, wordAr, level: newLevel, dueDate, lastReviewed: new Date().toISOString() };
  if (rows.length) await Sheet.update("VocabSRS", rows[0].rowIndex, row);
  else await Sheet.create("VocabSRS", { id: `srs_${Date.now()}`, ...row });
}
async function openVocabReview(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const rows = await Sheet.list("VocabSRS", { filter: (r) => r.studentId === s.id && new Date(r.dueDate) <= new Date() });
    let i = 0;
    function draw() {
      if (i >= rows.length) {
        content.innerHTML = `
          <div class="report-head">
            <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
            <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
          </div>
          <div class="report-title heading">مراجعة الكلمات</div>
          <div class="empty">${rows.length === 0 ? "مفيش كلمات مستحقة مراجعة النهارده — عاش! 🎉" : "خلّصت كل الكلمات المستحقة النهارده 🎉"}</div>`;
        document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
        return;
      }
      const w = rows[i];
      content.innerHTML = `
        <div class="report-head">
          <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
          <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
        </div>
        <div class="report-title heading">مراجعة الكلمات</div>
        <div class="report-sub">${i + 1} / ${rows.length}</div>
        <div style="text-align:center;padding:30px 10px;" dir="rtl">
          <div class="heading" style="font-size:24px;">${escapeHtml(w.wordAr)}</div>
          <div id="vsrs-answer" class="heading" style="font-size:20px;color:var(--blue);margin-top:14px;" hidden>${escapeHtml(w.wordEn)}</div>
          <button class="btn-ghost" id="vsrs-reveal" style="margin-top:16px;max-width:220px;margin-inline:auto;">إظهار الإجابة</button>
        </div>
        <div id="vsrs-grade" style="display:flex;gap:10px;" hidden>
          <button class="btn-ghost" id="vsrs-forgot" style="color:var(--rose);">نسيتها</button>
          <button class="btn-primary" id="vsrs-knew">تذكرتها</button>
        </div>`;
      document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
      document.getElementById("vsrs-reveal").addEventListener("click", () => {
        document.getElementById("vsrs-answer").hidden = false;
        document.getElementById("vsrs-reveal").hidden = true;
        document.getElementById("vsrs-grade").hidden = false;
        speak(w.wordEn);
      });
      const grade = (isCorrect) => {
        upsertVocabSRS(s.id, w.vocabId, w.wordEn, w.wordAr, isCorrect).catch(console.error);
        i++; draw();
      };
      document.getElementById("vsrs-knew")?.addEventListener("click", () => grade(true));
      document.getElementById("vsrs-forgot")?.addEventListener("click", () => grade(false));
    }
    draw();
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل المراجعة</div>`; console.error(err); }
}

/* ---------------------- Feature: speaking / pronunciation practice (DB-backed) ----------------------
   Uses the browser's SpeechRecognition API (Chrome-only — Safari/iOS and
   Firefox don't support it, so we show a plain message there instead of a
   broken button). The student reads an English prompt aloud, the browser
   transcribes what it heard, and we score it against the target text by
   word overlap. Prompts come from SpeakingPrompts (grade-specific, teacher-
   authored); every attempt is logged to SpeakingAttempts for progress. */
function scoreTranscript(target, heard) {
  const norm = (t) => (t || "").toLowerCase().replace(/[^\w\s']/g, "").split(/\s+/).filter(Boolean);
  const targetWords = norm(target);
  const heardWords = new Set(norm(heard));
  if (!targetWords.length) return 0;
  const matched = targetWords.filter((w) => heardWords.has(w)).length;
  return Math.round((matched / targetWords.length) * 100);
}
async function openSpeakingPractice(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  try {
    const prompts = await Sheet.list("SpeakingPrompts", { filter: (r) => r.grade === s.grade || r.grade === "all" });
    if (!prompts.length) {
      content.innerHTML = `
        <div class="report-head">
          <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
          <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
        </div>
        <div class="report-title heading">تمرين النطق</div>
        <div class="empty">لسه مفيش جمل نطق مضافة لصفك الدراسي</div>`;
      document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
      return;
    }
    let i = 0;
    // getUserMedia/SpeechRecognition only work in a "secure context" (HTTPS,
    // or localhost) — on a plain-http page the mic button would look fine
    // but silently fail (or show the browser's own mic-blocked indicator,
    // usually a small colored icon in the address bar — that part is native
    // browser chrome, not something a page's code can change or remove).
    const isSecureCtx = window.isSecureContext !== false;
    function draw() {
      const p = prompts[i];
      content.innerHTML = `
        <div class="report-head">
          <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
          <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
        </div>
        <div class="report-title heading">تمرين النطق</div>
        <div class="report-sub">${i + 1} / ${prompts.length}</div>
        <div style="text-align:center;padding:20px 10px;" dir="ltr">
          <div class="heading" style="font-size:19px;">${escapeHtml(p.text)}</div>
        </div>
        ${SpeechRecognitionCtor && isSecureCtx ? `
          <button class="btn-primary" id="sp-record">${svgIcon(ICONS.audio)} ابدأ النطق</button>
          <div id="sp-result" style="margin-top:14px;"></div>
        ` : SpeechRecognitionCtor ? `<div class="hint-msg">تمرين النطق محتاج اتصال آمن (HTTPS) عشان يقدر يستخدم الميكروفون</div>`
          : `<div class="hint-msg">تمرين النطق بيشتغل بس على متصفح Chrome حاليًا</div>`}
        <button class="btn-ghost" id="sp-next" style="margin-top:14px;">السؤال التالي</button>`;
      document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
      document.getElementById("sp-next").addEventListener("click", () => { i = (i + 1) % prompts.length; draw(); });
      const recordBtn = document.getElementById("sp-record");
      if (recordBtn && SpeechRecognitionCtor) {
        const idleHtml = `${svgIcon(ICONS.audio)} ابدأ النطق`;
        recordBtn.addEventListener("click", () => {
          const recog = new SpeechRecognitionCtor();
          recog.lang = "en-US";
          recog.interimResults = false;
          recordBtn.textContent = "جاري الاستماع...";
          recordBtn.disabled = true;
          document.getElementById("sp-result").innerHTML = "";
          recog.onresult = (e) => {
            const heard = e.results[0][0].transcript;
            const score = scoreTranscript(p.text, heard);
            document.getElementById("sp-result").innerHTML = `
              <div class="report-list-item"><span>سمعت:</span><span>${escapeHtml(heard)}</span></div>
              <div class="report-list-item"><span>نسبة التطابق</span><span style="color:${score >= 70 ? "var(--mint)" : "var(--rose)"};">${score}%</span></div>`;
            Sheet.create("SpeakingAttempts", { id: `sp_${Date.now()}`, studentId: s.id, promptId: p.id, transcript: heard, score, date: new Date().toISOString() }).catch(console.error);
            if (score >= 70) XP.add(s.id, 5);
          };
          recog.onerror = (e) => {
            const messages = {
              "not-allowed": "لازم تسمح باستخدام الميكروفون عشان تقدر تستخدم تمرين النطق",
              "service-not-allowed": "لازم تسمح باستخدام الميكروفون عشان تقدر تستخدم تمرين النطق",
              "no-speech": "معملتش أي صوت، جرّب تاني وقرب من الميكروفون",
              "audio-capture": "مفيش ميكروفون متاح على الجهاز ده",
              network: "تعذر الاتصال بخدمة التعرف على الصوت، تأكد من اتصالك بالإنترنت",
            };
            toast(messages[e.error] || "تعذر التعرف على الصوت، حاول تاني");
          };
          recog.onend = () => { recordBtn.innerHTML = idleHtml; recordBtn.disabled = false; };
          try { recog.start(); }
          catch (err) { console.error(err); toast("تعذر بدء التسجيل، حدّث الصفحة وحاول تاني"); recordBtn.innerHTML = idleHtml; recordBtn.disabled = false; }
        });
      }
    }
    draw();
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل تمرين النطق</div>`; console.error(err); }
}

/* ---------------------- Feature: vocab matching game (DB-backed high scores) ----------------------
   Reuses the same word bank source as لوحة الكلمات (words the student has
   already been تسميع-tested on) for a quick memory-match game; best runs
   are logged to GameScores so progress carries between visits. */
async function openWordGame(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const attempts = await Sheet.list("VocabAttempts", { filter: (r) => r.studentId === s.id });
    const vocabIds = new Set(attempts.map((a) => a.vocabId));
    const vocabRows = vocabIds.size ? await Sheet.list("Vocab", { filter: (r) => vocabIds.has(r.id) }) : [];
    const pool = vocabRows.slice(0, 6); // 6 pairs = 12 cards, keeps the board readable on mobile
    if (pool.length < 3) {
      content.innerHTML = `
        <div class="report-head">
          <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
          <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
        </div>
        <div class="report-title heading">لعبة الكلمات</div>
        <div class="empty">لازم تعمل تسميع كلمات الأول عشان يبقى عندك كلمات كفاية للعبة (٣ كلمات على الأقل)</div>`;
      document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
      return;
    }
    let cards = pool.flatMap((v) => [
      { key: v.id, side: "en", text: v.wordEn },
      { key: v.id, side: "ar", text: v.wordAr },
    ]);
    cards = cards.map((c) => ({ ...c, sort: Math.random() })).sort((a, b) => a.sort - b.sort);
    let first = null, moves = 0, matched = 0;
    const startedAt = Date.now();
    function draw() {
      content.innerHTML = `
        <div class="report-head">
          <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
          <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
        </div>
        <div class="report-title heading">لعبة الكلمات</div>
        <div class="report-sub">حركات: ${moves}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
          ${cards.map((c, idx) => `
            <button class="btn-ghost game-card" data-idx="${idx}" data-key="${c.key}" style="min-height:60px;font-size:12.5px;${c.matched ? "opacity:.35;pointer-events:none;" : ""}${c.flipped ? "border-color:var(--blue);" : ""}">
              ${c.flipped || c.matched ? escapeHtml(c.text) : "؟"}
            </button>`).join("")}
        </div>`;
      document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
      content.querySelectorAll(".game-card").forEach((btn) =>
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.idx);
          const card = cards[idx];
          if (card.flipped || card.matched || first?.idx === idx) return;
          card.flipped = true;
          if (!first) { first = { idx, card }; draw(); return; }
          moves++;
          if (first.card.key === card.key) {
            card.matched = true; first.card.matched = true; matched++;
            first = null; draw();
            if (matched === pool.length) {
              const timeSeconds = Math.round((Date.now() - startedAt) / 1000);
              Sheet.create("GameScores", { id: `gm_${Date.now()}`, studentId: s.id, moves, timeSeconds, date: new Date().toISOString() }).catch(console.error);
              XP.add(s.id, 8);
              setTimeout(() => {
                content.innerHTML += `<div class="empty">🎉 خلصت اللعبة في ${moves} حركة و${timeSeconds} ثانية!</div>`;
              }, 300);
            }
          } else {
            draw();
            setTimeout(() => { card.flipped = false; first.card.flipped = false; first = null; draw(); }, 700);
          }
        })
      );
    }
    draw();
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل اللعبة</div>`; console.error(err); }
}

/* ---------------------- Feature: teacher's private notes to a student (DB-backed) ----------------------
   Written by the teacher from teacher-admin.html's student detail view;
   this is a read-only feed for the student. */
async function openTeacherNotes(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const notes = (await Sheet.list("TeacherNotes", { filter: (r) => r.studentId === s.id })).sort((a, b) => new Date(b.date) - new Date(a.date));
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">ملاحظات المستر</div>
      ${notes.length ? notes.map((n) => `
        <div class="path-card" style="margin-bottom:10px;">
          <div class="sub">${linkify(n.note || "", true)}</div>
          <div class="sub" style="margin-top:6px;font-size:11px;color:var(--ink-soft);">${n.date ? new Date(n.date).toLocaleString("ar-EG") : ""}</div>
        </div>`).join("")
        : `<div class="empty">لسه مفيش ملاحظات من المستر</div>`}`;
    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل الملاحظات</div>`; console.error(err); }
}

/* ---------------------- Feature: reading comprehension passages (DB-backed) ----------------------
   Teacher writes passages + MCQ questions per grade from teacher-admin.html;
   scored attempts are logged to ReadingAttempts, same spirit as quizzes. */
async function openReadingList(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const passages = await Sheet.list("ReadingPassages", { filter: (r) => r.grade === s.grade || r.grade === "all" });
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">قطع القراءة</div>
      ${passages.length ? passages.map((p) => `<div class="path-card" data-id="${p.id}"><div class="title">${escapeHtml(p.title || "")}</div></div>`).join("")
        : `<div class="empty">لسه مفيش قطع قراءة لصفك الدراسي</div>`}`;
    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
    content.querySelectorAll(".path-card[data-id]").forEach((card) =>
      card.addEventListener("click", () => openReadingPassage(s, passages.find((p) => p.id === card.dataset.id)))
    );
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل قطع القراءة</div>`; console.error(err); }
}
async function openReadingPassage(s, passage) {
  const content = document.getElementById("report-content");
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const questions = await Sheet.list("ReadingQuestions", { filter: (r) => r.passageId === passage.id });
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">${escapeHtml(passage.title || "")}</div>
      <div class="sub" dir="ltr" style="text-align:left;line-height:1.8;margin-bottom:16px;">${escapeHtml(passage.text || "")}</div>
      <button class="btn-primary" id="reading-start">ابدأ الأسئلة (${questions.length})</button>`;
    document.getElementById("report-close").addEventListener("click", () => { document.getElementById("report-overlay").hidden = true; });
    document.getElementById("reading-start").addEventListener("click", () => runReadingQuiz(s, passage, questions));
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل القطعة</div>`; console.error(err); }
}
function runReadingQuiz(s, passage, questions) {
  const content = document.getElementById("report-content");
  if (!questions.length) { toast("لا توجد أسئلة لهذه القطعة"); return; }
  let i = 0, score = 0;
  function draw() {
    const q = questions[i];
    const opts = safeJsonParseLocal(q.optionsJson, []);
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="quiz-progress"><div style="width:${(i / questions.length) * 100}%"></div></div>
      <div class="heading" style="margin:14px 0;">${escapeHtml(q.question || "")}</div>
      ${opts.map((o) => `<button class="quiz-opt" data-o="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join("")}`;
    document.getElementById("report-close").addEventListener("click", () => { document.getElementById("report-overlay").hidden = true; });
    content.querySelectorAll(".quiz-opt").forEach((btn) =>
      btn.addEventListener("click", () => {
        const correct = btn.dataset.o === q.correctAnswer;
        if (correct) score++;
        content.querySelectorAll(".quiz-opt").forEach((b) => {
          if (b.dataset.o === q.correctAnswer) b.classList.add("correct");
          else if (b === btn) b.classList.add("wrong");
          b.disabled = true;
        });
        setTimeout(() => { i++; i < questions.length ? draw() : finishReading(); }, 700);
      })
    );
  }
  function finishReading() {
    Sheet.create("ReadingAttempts", { id: `ra_${Date.now()}`, studentId: s.id, passageId: passage.id, score, total: questions.length, date: new Date().toISOString() }).catch(console.error);
    XP.add(s.id, score * 4);
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
      </div>
      <div style="text-align:center;padding:20px;">
        <div class="heading" style="font-size:24px;">${score} / ${questions.length}</div>
        <div class="sub" style="margin-top:8px;">نتيجتك في أسئلة القطعة</div>
        <button class="btn-primary" id="reading-done" style="margin-top:20px;">تم</button>
      </div>`;
    document.getElementById("reading-done").addEventListener("click", () => { document.getElementById("report-overlay").hidden = true; });
  }
  draw();
}
function safeJsonParseLocal(str, fallback) { try { const v = JSON.parse(str); return v || fallback; } catch { return fallback; } }

/* ---------------------- Feature: grammar notes bank (DB-backed) ---------------------- */
async function openGrammarBank(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const notes = await Sheet.list("GrammarNotes", { filter: (r) => r.grade === s.grade || r.grade === "all" });
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">قواعد اللغة</div>
      <div class="search-box"><input id="grammar-search" type="text" placeholder="ابحث في القواعد..."></div>
      <div id="grammar-list"></div>`;
    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
    function draw(list) {
      const wrap = document.getElementById("grammar-list");
      wrap.innerHTML = list.length ? list.map((g, idx) => `
        <div class="path-card" data-i="${idx}">
          <div class="title">${escapeHtml(g.title || "")}</div>
          <div class="sub grammar-body" hidden style="margin-top:8px;line-height:1.7;">
            ${linkify(g.explanation || "")}
            ${g.examples ? `<div style="margin-top:8px;font-style:italic;color:var(--ink-soft);">${escapeHtml(g.examples)}</div>` : ""}
          </div>
        </div>`).join("") : `<div class="empty">لا توجد نتائج</div>`;
      wrap.querySelectorAll(".path-card").forEach((card) =>
        card.addEventListener("click", () => { const b = card.querySelector(".grammar-body"); b.hidden = !b.hidden; })
      );
    }
    draw(notes);
    document.getElementById("grammar-search").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      draw(notes.filter((g) => (g.title || "").toLowerCase().includes(q) || (g.explanation || "").toLowerCase().includes(q)));
    });
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل القواعد</div>`; console.error(err); }
}

/* ---------------------- Feature: ask the teacher about a specific task (DB-backed) ----------------------
   openAskTeacherModal is called from the "اسأل المستر" button added inside
   renderTask() below; openMyQuestions shows the student's own questions and
   the teacher's answers once given (from teacher-admin.html). */
async function openAskTeacherModal(s, t) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `
    <div class="report-head">
      <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
      <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
    </div>
    <div class="report-title heading">اسأل المستر عن: ${escapeHtml(t.title || "")}</div>
    <div class="compose">
      <textarea id="ask-text" placeholder="اكتب سؤالك عن المهمة دي..." maxlength="500"></textarea>
    </div>
    <button class="btn-primary" id="ask-submit" style="margin-top:10px;">إرسال السؤال</button>`;
  document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
  document.getElementById("ask-submit").addEventListener("click", async () => {
    const question = document.getElementById("ask-text").value.trim();
    if (!question) return toast("اكتب سؤالك الأول");
    try {
      await Sheet.create("TaskQuestions", { id: `tq_${Date.now()}`, studentId: s.id, studentName: s.fullName, taskId: t.id, taskTitle: t.title, question, answer: "", date: new Date().toISOString() });
      toast("تم إرسال سؤالك للمستر");
      overlay.hidden = true;
    } catch { toast("تعذر إرسال السؤال"); }
  });
}
async function openMyQuestions(s) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const questions = (await Sheet.list("TaskQuestions", { filter: (r) => r.studentId === s.id })).sort((a, b) => new Date(b.date) - new Date(a.date));
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">أسئلتي للمستر</div>
      ${questions.length ? questions.map((q) => `
        <div class="path-card" style="margin-bottom:10px;">
          <div class="sub" style="font-size:11px;color:var(--ink-soft);">${escapeHtml(q.taskTitle || "")}</div>
          <div class="title" style="margin-top:4px;">${escapeHtml(q.question || "")}</div>
          ${q.answer ? `<div class="sub" style="margin-top:8px;color:var(--mint);"><b>رد المستر:</b> ${linkify(q.answer, true)}</div>`
            : `<div class="sub" style="margin-top:8px;color:var(--ink-soft);">بانتظار رد المستر...</div>`}
        </div>`).join("")
        : `<div class="empty">لسه معملتش أي سؤال — اضغط "اسأل المستر" من داخل أي مهمة</div>`}`;
    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
  } catch (err) { content.innerHTML = `<div class="empty">تعذر تحميل أسئلتك</div>`; console.error(err); }
}

/* ---------------------- Feature: printable course-completion certificate ---------------------- */
function openCourseCertificate(s, course) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `
    <div class="report-head">
      <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
      <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
    </div>
    <div style="text-align:center;padding:20px 10px;" dir="rtl">
      <div style="font-size:12px;color:var(--ink-soft);letter-spacing:2px;">CERTIFICATE OF COMPLETION</div>
      <div class="report-title heading" style="margin:14px 0 4px;font-size:22px;">شهادة إتمام كورس</div>
      <div style="font-size:12px;color:var(--ink-soft);">تُمنح هذه الشهادة إلى</div>
      <div class="heading" style="font-size:26px;margin:10px 0;color:var(--blue-deep);">${s.fullName}</div>
      <div style="font-size:13px;color:var(--ink-soft);">لإتمامه بنجاح كورس</div>
      <div style="font-size:17px;font-weight:700;margin:8px 0 18px;">${course?.titleAr || course?.title || ""}</div>
      <div style="font-size:11px;color:var(--ink-soft);">${new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" })}</div>
    </div>
    <div class="report-actions"><button class="btn-primary" id="report-print">طباعة / حفظ PDF</button></div>
    <div class="report-footer">جميع الحقوق محفوظة لدى Mr. Abdulrahim Hassan®</div>`;
  document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
  document.getElementById("report-print").addEventListener("click", () => window.print());
}

/* ---------------------- Course -> lecture path ---------------------- */
async function renderCourse(courseId, course) {
  showScreen("course");
  const el = document.getElementById("screen-course");
  el.innerHTML = `
    <div class="ar" dir="rtl">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <button class="btn-ghost" id="back-home" style="width:auto;padding:8px 16px;">← رجوع</button>
        <button class="icon-btn" id="btn-share-course">${svgIcon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>')} مشاركة</button>
      </div>
      <h2 class="heading">${course?.titleAr || course?.title || ""}</h2>
      <div id="course-cert-banner"></div>
      <div id="lecture-path" class="path">${skeletonRow(3, "skeleton-node")}</div>
    </div>`;
  document.getElementById("back-home").addEventListener("click", renderHome);
  document.getElementById("btn-share-course").addEventListener("click", async () => {
    const shareText = `${course?.titleAr || course?.title || "كورس"} — Mr. Abdulrahim Hassan\n${location.href.split("#")[0]}#course=${courseId}`;
    try {
      if (navigator.share) await navigator.share({ title: "Mr. Abdulrahim Hassan", text: shareText });
      else { await navigator.clipboard.writeText(shareText); toast("تم نسخ رابط الكورس"); }
    } catch { /* user cancelled share sheet — no action needed */ }
  });
  try {
    const s = Session.get();
    const lectures = (await Sheet.list("Lectures", { filter: (r) => r.courseId === courseId }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const wrap = document.getElementById("lecture-path");
    if (!lectures.length) { wrap.outerHTML = `<div class="empty">لا توجد محاضرات بعد</div>`; return; }

    // fetch tasks per lecture in parallel to know completion state
    const taskLists = await Promise.all(lectures.map((l) => Sheet.list("Tasks", { filter: (r) => r.lectureId === l.id })));

    wrap.innerHTML = lectures.map((l, i) => {
      const ids = taskLists[i].map((t) => t.id);
      const doneN = ids.length ? Progress.doneCount(s.id, ids) : 0;
      const complete = ids.length > 0 && doneN === ids.length;
      if (complete) Badges.award(s.id, "first_lecture");
      const bookmarked = Bookmarks.isBookmarked(s.id, l.id);
      return `
      <div class="path-node ${complete ? "done" : ""}" data-id="${l.id}">
        <div class="dot">${complete ? svgIcon('<path d="M20 6L9 17l-5-5"/>') : i + 1}</div>
        <div class="path-card" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div>
            <div class="title">${l.title}</div>
            <div class="sub">${ids.length ? `${doneN} / ${ids.length} مهام مكتملة` : `محاضرة ${i + 1}`}</div>
          </div>
          <button class="icon-btn bookmark-btn ${bookmarked ? "active" : ""}" data-lid="${l.id}" data-title="${l.title}" data-course="${courseId}">
            ${svgIcon('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>')}
          </button>
          <button class="icon-btn share-lecture-btn" data-lecid="${l.id}" data-title="${escapeHtml(l.title)}" title="مشاركة الرابط">
            ${svgIcon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>')}
          </button>
        </div>
      </div>`;
    }).join("");
    wrap.querySelectorAll(".path-node").forEach((node) =>
      node.addEventListener("click", (e) => {
        if (e.target.closest(".bookmark-btn") || e.target.closest(".share-lecture-btn")) return;
        pushNav(renderCourse, [courseId, course]);
        renderLectureTasks(node.dataset.id, lectures.find((l) => l.id === node.dataset.id));
      })
    );
    wrap.querySelectorAll(".share-lecture-btn").forEach((btn) =>
      btn.addEventListener("click", (e) => { e.stopPropagation(); shareLink("lecture", btn.dataset.lecid, btn.dataset.title); })
    );
    wrap.querySelectorAll(".bookmark-btn").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const nowOn = Bookmarks.toggle(s.id, { id: btn.dataset.lid, title: btn.dataset.title, courseId: btn.dataset.course });
        btn.classList.toggle("active", nowOn);
        toast(nowOn ? "أُضيفت للمفضلة" : "أُزيلت من المفضلة");
      })
    );

    const courseComplete = lectures.length > 0 && lectures.every((l, idx) => {
      const ids = taskLists[idx].map((tk) => tk.id);
      return ids.length > 0 && Progress.doneCount(s.id, ids) === ids.length;
    });
    if (courseComplete) {
      document.getElementById("course-cert-banner").innerHTML = `
        <button class="btn-primary coral" id="btn-course-cert" style="margin-bottom:14px;display:flex;align-items:center;justify-content:center;gap:8px;">
          ${svgIcon('<path d="M12 2l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-1.5z"/>')} أكملت الكورس! اطبع شهادتك
        </button>`;
      document.getElementById("btn-course-cert").addEventListener("click", () => openCourseCertificate(s, course));
    }
  } catch (err) { console.error(err); }
}

async function renderLectureTasks(lectureId, lecture) {
  showScreen("course");
  const el = document.getElementById("screen-course");
  const s = Session.get();
  const noteKey = `mah_note_${s.id}_${lectureId}`;
  el.innerHTML = `
    <div class="ar" dir="rtl">
      <button class="btn-ghost" id="back-course" style="width:auto;padding:8px 16px;margin-bottom:10px;">← رجوع</button>
      <h2 class="heading">${lecture.title}</h2>
      <div id="task-list" class="path">${skeletonRow(3, "skeleton-node")}</div>
      <div class="section-title"><h3>تسميع كلمات هذه المحاضرة</h3></div>
      <button class="btn-primary coral" id="btn-vocab">ابدأ التسميع</button>
      <div class="section-title"><h3>ملاحظاتي الخاصة</h3></div>
      <textarea id="lecture-note" class="note-box" placeholder="اكتب ملاحظاتك الخاصة على هذه المحاضرة...">${localStorage.getItem(noteKey) || ""}</textarea>
      <div id="lecture-rating-wrap"></div>
    </div>`;
  document.getElementById("back-course").addEventListener("click", () => goBack());
  document.getElementById("btn-vocab").addEventListener("click", () => { pushNav(renderLectureTasks, [lectureId, lecture]); renderVocab(lectureId); });
  let noteTimer;
  document.getElementById("lecture-note").addEventListener("input", (e) => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => localStorage.setItem(noteKey, e.target.value), 500);
  });
  try {
    const tasks = (await Sheet.list("Tasks", { filter: (r) => r.lectureId === lectureId }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const wrap = document.getElementById("task-list");
    if (!tasks.length) { wrap.outerHTML = `<div class="empty">لا توجد مهام بعد</div>`; return; }
    wrap.innerHTML = tasks.map((t, i) => {
      const done = Progress.isDone(s.id, t.id);
      return `
      <div class="path-node ${done ? "done" : ""}" data-id="${t.id}">
        <div class="dot">${done ? svgIcon('<path d="M20 6L9 17l-5-5"/>') : svgIcon(ICONS[t.type] || ICONS.text)}</div>
        <div class="path-card">
          <div class="title">${t.title}</div>
          <span class="task-badge ${t.type}">${t.type}</span>
        </div>
      </div>`;
    }).join("");
    wrap.querySelectorAll(".path-node").forEach((node) => {
      const t = tasks.find((x) => x.id === node.dataset.id);
      node.addEventListener("click", () => {
        pushNav(renderLectureTasks, [lectureId, lecture]);
        t.type === "quiz" ? renderQuiz(t) : renderTask(t);
      });
    });

    const allDone = tasks.every((t) => Progress.isDone(s.id, t.id));
    if (allDone) renderLectureRating(s, lectureId);
  } catch (err) { console.error(err); }
}

/* ---------------------- Feature: lecture rating & feedback (DB-backed) ---------------------- */
async function renderLectureRating(s, lectureId) {
  const holder = document.getElementById("lecture-rating-wrap");
  if (!holder) return;
  try {
    const mine = await Sheet.list("LectureRatings", { filter: (r) => r.lectureId === lectureId && r.studentId === s.id });
    if (mine.length) {
      holder.innerHTML = `
        <div class="section-title"><h3>تقييمك</h3></div>
        <div class="text-block">شكرًا لتقييمك! (${mine[0].rating} / ٥)</div>`;
      return;
    }
    holder.innerHTML = `
      <div class="section-title"><h3>قيّم هذه المحاضرة</h3></div>
      <div class="star-row" id="rating-stars">
        ${[1, 2, 3, 4, 5].map((n) => `<button class="star-btn" data-v="${n}">${svgIcon('<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>')}</button>`).join("")}
      </div>
      <textarea id="rating-comment" class="note-box" placeholder="تعليق (اختياري)..." style="margin-top:8px;"></textarea>
      <button class="btn-primary" id="rating-submit" style="margin-top:10px;">إرسال التقييم</button>`;
    let chosen = 0;
    holder.querySelectorAll(".star-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        chosen = Number(btn.dataset.v);
        holder.querySelectorAll(".star-btn").forEach((b) => b.classList.toggle("active", Number(b.dataset.v) <= chosen));
      });
    });
    document.getElementById("rating-submit").addEventListener("click", async () => {
      if (!chosen) return toast("اختر عدد النجوم أولاً");
      try {
        await Sheet.create("LectureRatings", { id: `lr_${Date.now()}`, lectureId, studentId: s.id, rating: chosen, comment: document.getElementById("rating-comment").value.trim(), createdAt: new Date().toISOString() });
        toast("شكرًا لتقييمك");
        renderLectureRating(s, lectureId);
      } catch { toast("تعذر إرسال التقييم"); }
    });
  } catch (err) { console.error(err); }
}

/* ---------------------- Task viewer ---------------------- */
function renderTask(t) {
  showScreen("task");
  const el = document.getElementById("screen-task");
  const s = Session.get();
  let body = "";
  let readAloudText = "";
  if (t.type === "video") {
    body = `<div class="player-wrap"><video id="task-video" src="${t.videoUrl}" controls controlsList="nodownload noremoteplayback" disablePictureInPicture></video></div>
      <div class="speed-row" dir="rtl">
        <span>سرعة التشغيل:</span>
        ${[0.75, 1, 1.25, 1.5, 2].map((sp) => `<button class="speed-btn ${sp === 1 ? "active" : ""}" data-speed="${sp}">${sp}x</button>`).join("")}
      </div>`;
  } else if (t.type === "audio") {
    body = `<div class="player-wrap" style="background:var(--panel);padding:16px;"><audio src="${t.audioUrl}" controls controlsList="nodownload"></audio></div>`;
  } else if (t.type === "pdf") {
    body = `<iframe class="pdf-frame" src="${t.pdfUrl}#toolbar=0"></iframe>
      <div class="pdf-actions"><button id="pdf-dl" data-url="${t.pdfUrl}" data-name="${t.title || "file"}">تحميل الملف مباشرة</button></div>`;
  } else if (t.type === "text") {
    let content = t.textJson;
    try {
      const blocks = JSON.parse(t.textJson);
      content = blocks.map((b) => b.html || escapeHtml(b.text || "")).join("<br><br>");
      readAloudText = blocks.map((b) => stripHtml(b.html || b.text || "")).join(". ");
    } catch { readAloudText = stripHtml(t.textJson || ""); }
    const savedSize = Number(localStorage.getItem("mah_text_size")) || 100;
    body = `
      <div style="display:flex;gap:8px;margin-bottom:10px;" dir="rtl">
        <button class="icon-btn" id="btn-read-aloud">
          ${svgIcon('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>')}
          <span id="read-aloud-label">استماع للنص</span>
        </button>
        <button class="icon-btn" id="font-dec">A-</button>
        <button class="icon-btn" id="font-inc">A+</button>
      </div>
      <div class="text-block" id="text-content" style="font-size:${savedSize}%;">${content}</div>`;
  }
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;" dir="rtl">
      <button class="btn-ghost" id="back-task" style="width:auto;padding:8px 16px;">← رجوع</button>
      <button class="icon-btn" id="btn-ask-teacher">${svgIcon('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4"/><path d="M12 17h.01"/>')} اسأل المستر</button>
    </div>
    <h2>${t.title}</h2>${body}`;
  document.getElementById("back-task").addEventListener("click", () => { if ("speechSynthesis" in window) speechSynthesis.cancel(); goBack(); });
  document.getElementById("btn-ask-teacher").addEventListener("click", () => openAskTeacherModal(s, t));
  const dlBtn = document.getElementById("pdf-dl");
  if (dlBtn) dlBtn.addEventListener("click", () => forceDownload(dlBtn.dataset.url, `${dlBtn.dataset.name}.pdf`));
  const readBtn = document.getElementById("btn-read-aloud");
  if (readBtn) {
    readBtn.addEventListener("click", () => {
      if (!("speechSynthesis" in window)) return toast("المتصفح ده مايدعمش الاستماع للنص");
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
        document.getElementById("read-aloud-label").textContent = "استماع للنص";
        return;
      }
      const u = new SpeechSynthesisUtterance(readAloudText);
      u.lang = "en-US";
      u.onend = () => { const lbl = document.getElementById("read-aloud-label"); if (lbl) lbl.textContent = "استماع للنص"; };
      speechSynthesis.speak(u);
      document.getElementById("read-aloud-label").textContent = "إيقاف";
    });
  }
  const fontDec = document.getElementById("font-dec");
  const fontInc = document.getElementById("font-inc");
  if (fontDec && fontInc) {
    const applySize = (delta) => {
      const box = document.getElementById("text-content");
      const next = Math.min(160, Math.max(80, (Number(localStorage.getItem("mah_text_size")) || 100) + delta));
      localStorage.setItem("mah_text_size", String(next));
      box.style.fontSize = next + "%";
    };
    fontDec.addEventListener("click", () => applySize(-10));
    fontInc.addEventListener("click", () => applySize(10));
  }
  document.querySelectorAll(".speed-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      const video = document.getElementById("task-video");
      if (video) video.playbackRate = Number(btn.dataset.speed);
      document.querySelectorAll(".speed-btn").forEach((b) => b.classList.toggle("active", b === btn));
    })
  );

  Progress.setLast(s.id, { title: t.title, taskType: t.type, taskObj: t });
  function completeTask() {
    const wasDone = Progress.isDone(s.id, t.id);
    Progress.markDone(s.id, t.id);
    if (!wasDone) {
      XP.add(s.id, 10);
      if (t.type === "text" && Counters.inc(s.id, "textRead") >= 5) Badges.award(s.id, "bookworm");
      Sheet.create("TaskCompletions", { id: `tc_${Date.now()}`, studentId: s.id, taskId: t.id, taskType: t.type, date: new Date().toISOString() }).catch(console.error);
    }
  }
  const video = document.getElementById("task-video");
  if (video) {
    video.addEventListener("ended", completeTask);
    const posKey = `mah_videopos_${t.id}`;
    const maxKey = `mah_videomax_${t.id}`;
    const alreadyDone = Progress.isDone(s.id, t.id);
    const savedPos = Number(localStorage.getItem(posKey)) || 0;
    // Once the student has finished the video for real, free rewatching/scrubbing is fine.
    // Until then, maxWatched caps how far they're allowed to seek — no skipping ahead.
    let maxWatched = alreadyDone ? Infinity : (Number(localStorage.getItem(maxKey)) || 0);
    video.addEventListener("loadedmetadata", () => {
      if (savedPos > 5 && savedPos < video.duration - 5) {
        video.currentTime = savedPos;
        toast("استكملنا من آخر نقطة توقفت عندها");
      }
    });
    let saveThrottle = 0;
    video.addEventListener("timeupdate", () => {
      if (!alreadyDone && video.currentTime > maxWatched) maxWatched = video.currentTime;
      const now = Date.now();
      if (now - saveThrottle > 4000) {
        saveThrottle = now;
        localStorage.setItem(posKey, String(video.currentTime));
        if (!alreadyDone) localStorage.setItem(maxKey, String(maxWatched));
      }
    });
    if (!alreadyDone) {
      video.addEventListener("seeking", () => {
        if (video.currentTime > maxWatched + 0.75) {
          video.currentTime = maxWatched;
          toast("لازم تخلّص مشاهدة الفيديو الأول من غير تخطي");
        }
      });
    }
  } else completeTask();
}

async function forceDownload(url, filename) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch { toast("تعذر تحميل الملف، افتحه من العارض أعلاه"); }
}

/* ---------------------- Quiz ---------------------- */
async function renderQuiz(t) {
  showScreen("quiz");
  const el = document.getElementById("screen-quiz");
  el.innerHTML = `<div class="spinner"></div>`;

  const now = new Date();
  if (t.startTime && now < new Date(t.startTime)) {
    el.innerHTML = `<div class="empty" dir="rtl">الاختبار لسه مبدأش. هيفتح في ${new Date(t.startTime).toLocaleString("ar-EG")}</div>`;
    return;
  }
  if (t.endTime && now > new Date(t.endTime)) {
    el.innerHTML = `<div class="empty" dir="rtl">انتهى وقت هذا الاختبار في ${new Date(t.endTime).toLocaleString("ar-EG")}</div>`;
    return;
  }

  const questions = await Sheet.list("QuizQuestions", { filter: (r) => r.taskId === t.id });
  let i = 0, score = 0;
  countdownTimer = null;
  if (t.endTime) {
    countdownTimer = setInterval(() => {
      const remainMs = new Date(t.endTime) - new Date();
      const cd = document.getElementById("quiz-countdown");
      if (remainMs <= 0) {
        clearInterval(countdownTimer);
        if (cd) cd.textContent = "انتهى الوقت";
        finish();
        return;
      }
      const m = Math.floor(remainMs / 60000), sec = Math.floor((remainMs % 60000) / 1000);
      if (cd) cd.textContent = `الوقت المتبقي: ${m}:${String(sec).padStart(2, "0")}`;
    }, 1000);
  }
  function finish() {
    if (countdownTimer) clearInterval(countdownTimer);
    quizActive = false;
    const s = Session.get();
    Sheet.create("Scores", { id: `sc_${Date.now()}`, studentId: s.id, refId: t.id, refType: "quiz", score, total: questions.length, date: new Date().toISOString() }).catch(console.error);
    Sheet.create("TaskCompletions", { id: `tc_${Date.now()}`, studentId: s.id, taskId: t.id, taskType: "quiz", date: new Date().toISOString() }).catch(console.error);
    XP.add(s.id, score * 5);
    if (questions.length && score === questions.length) Badges.award(s.id, "perfect_quiz");
    if (Counters.inc(s.id, "quizzesDone") >= 10) Badges.award(s.id, "quiz_master");
    el.innerHTML = `<div style="text-align:center;padding:40px 10px;" dir="rtl">
      <h2 class="heading">نتيجتك</h2>
      <div style="font-size:40px;font-weight:700;color:var(--blue);">${score} / ${questions.length}</div>
      <button class="btn-primary" id="quiz-done" style="margin-top:20px;">تم</button></div>`;
    document.getElementById("quiz-done").addEventListener("click", () => goBack());
  }
  function draw() {
    if (i >= questions.length) { finish(); return; }
    const q = questions[i];
    let opts = [];
    try { opts = JSON.parse(q.optionsJson); } catch { opts = []; }
    el.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:6px;" dir="rtl">
        <button class="icon-btn" id="quiz-exit">${svgIcon('<path d="M18 6L6 18M6 6l12 12"/>')} خروج</button>
      </div>
      ${t.endTime ? `<div id="quiz-countdown" dir="rtl" style="text-align:center;font-size:12px;color:var(--rose);margin-bottom:8px;"></div>` : ""}
      <div class="quiz-progress"><div style="width:${(i / questions.length) * 100}%"></div></div>
      <div class="quiz-q">${q.question}</div>
      <div class="quiz-opts">${opts.map((o) => `<button class="quiz-opt" data-o="${o}">${o}</button>`).join("")}</div>`;
    document.getElementById("quiz-exit").addEventListener("click", () => {
      if (confirm("هل تريد الخروج؟ لن تُحتسب نتيجة هذا الاختبار")) { quizActive = false; if (countdownTimer) clearInterval(countdownTimer); goBack(); }
    });
    el.querySelectorAll(".quiz-opt").forEach((btn) =>
      btn.addEventListener("click", () => {
        const correct = btn.dataset.o === q.correctAnswer;
        if (correct) score++;
        const sNow = Session.get();
        Sheet.create("QuizAttempts", { id: `qa_${Date.now()}_${i}`, studentId: sNow.id, taskId: t.id, questionId: q.id, questionText: q.question, selectedAnswer: btn.dataset.o, correctAnswer: q.correctAnswer, correct: correct ? "true" : "false", date: new Date().toISOString() }).catch(console.error);
        el.querySelectorAll(".quiz-opt").forEach((b) => {
          if (b.dataset.o === q.correctAnswer) b.classList.add("correct");
          else if (b === btn) b.classList.add("wrong");
          b.disabled = true;
        });
        setTimeout(() => { i++; draw(); }, 700);
      })
    );
  }
  quizActive = true;
  draw();
}

/* ---------------------- Vocab listening quiz ---------------------- */
async function renderVocab(lectureId) {
  showScreen("vocab");
  const el = document.getElementById("screen-vocab");
  el.innerHTML = `<div class="spinner"></div>`;
  const words = await Sheet.list("Vocab", { filter: (r) => r.lectureId === lectureId });
  let i = 0, correct = 0, wrong = 0;
  function draw() {
    if (i >= words.length) {
      const s = Session.get();
      Sheet.create("Scores", { id: `sc_${Date.now()}`, studentId: s.id, refId: lectureId, refType: "vocab", score: correct, total: words.length, date: new Date().toISOString() }).catch(console.error);
      Sheet.create("TaskCompletions", { id: `tc_${Date.now()}`, studentId: s.id, taskId: lectureId, taskType: "vocab", date: new Date().toISOString() }).catch(console.error);
      XP.add(s.id, correct * 2);
      el.innerHTML = `<div dir="rtl" style="text-align:center;padding:40px 10px;">
        <h2 class="heading">نتيجة التسميع</h2>
        <p style="color:var(--mint);font-size:16px;">صح: ${correct}</p>
        <p style="color:var(--rose);font-size:16px;">خطأ: ${wrong}</p>
        <button class="btn-primary" id="vocab-done" style="margin-top:16px;">تم</button></div>`;
      document.getElementById("vocab-done").addEventListener("click", () => goBack());
      return;
    }
    const w = words[i];
    el.innerHTML = `
      <div dir="rtl">
        <div class="quiz-progress"><div style="width:${(i / words.length) * 100}%"></div></div>
        <div class="vocab-word-ar heading">${w.wordAr}</div>
        <div class="speak-btn" style="pointer-events:none;">${svgIcon(ICONS.audio)}</div>
        <div class="field"><input id="vocab-answer" type="text" placeholder="اكتب الكلمة بالإنجليزية" autocomplete="off"></div>
        <button class="btn-primary" id="vocab-submit">تأكيد</button>
      </div>`;
    document.getElementById("vocab-submit").addEventListener("click", () => {
      const ans = document.getElementById("vocab-answer").value.trim().toLowerCase();
      const isCorrect = ans === String(w.wordEn).trim().toLowerCase();
      if (isCorrect) correct++; else wrong++;
      const s = Session.get();
      Sheet.create("VocabAttempts", { id: `va_${Date.now()}_${i}`, studentId: s.id, vocabId: w.id, wordEn: w.wordEn, correct: isCorrect ? "true" : "false", date: new Date().toISOString() }).catch(console.error);
      upsertVocabSRS(s.id, w.id, w.wordEn, w.wordAr, isCorrect).catch(console.error);
      i++; draw();
    });
    speak(w.wordEn);
  }
  draw();
}

/* ---------------------- Forum ---------------------- */
let forumPending = [];
async function renderForum() {
  showScreen("forum");
  const el = document.getElementById("screen-forum");
  const s = Session.get();
  forumPending = [];
  el.innerHTML = `
    <h2 class="heading">المنتدى</h2>
    <div class="compose">
      <textarea id="forum-text" placeholder="اكتب سؤالك..." maxlength="600"></textarea>
      <div id="forum-thumbs" class="thumb-strip"></div>
      <div class="compose-actions">
        <label style="font-size:12px;color:var(--blue);">
          <input type="file" id="forum-file" accept="image/*" multiple hidden> إضافة صور (حتى ٨)
        </label>
        <button class="btn-primary" id="forum-post" style="width:auto;padding:9px 22px;">نشر</button>
      </div>
    </div>
    <div class="search-box">
      <input id="forum-search" type="text" placeholder="ابحث في الأسئلة...">
      ${svgIcon('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>')}
    </div>
    <button class="icon-btn" id="forum-mine-toggle" style="margin-bottom:10px;">${svgIcon('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>')} أسئلتي فقط</button>
    <div id="forum-posts"><div class="spinner"></div></div>`;

  document.getElementById("forum-file").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files).slice(0, 8 - forumPending.length);
    for (const f of files) {
      try { forumPending.push(await uploadToImgbb(f)); } catch { toast("تعذر رفع إحدى الصور"); }
    }
    document.getElementById("forum-thumbs").innerHTML = forumPending.map((u) => `<img src="${u}">`).join("");
  });

  document.getElementById("forum-post").addEventListener("click", async () => {
    const text = document.getElementById("forum-text").value.trim();
    if (!text && !forumPending.length) return;
    try {
      await Sheet.create("ForumPosts", {
        id: `fp_${Date.now()}`, studentId: s.id, studentName: s.fullName, text,
        imagesJson: JSON.stringify(forumPending), createdAt: new Date().toISOString(),
      });
      toast("تم النشر");
      renderForum();
    } catch { toast("تعذر النشر"); }
  });

  try {
    const posts = (await Sheet.list("ForumPosts")).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const wrap = document.getElementById("forum-posts");
    if (!posts.length) { wrap.outerHTML = `<div class="empty">لا توجد أسئلة بعد، كن أول من يسأل</div>`; return; }
    let mineOnly = false;
    function draw(list) {
      const shown = mineOnly ? list.filter((p) => p.studentId === s.id) : list;
      wrap.innerHTML = shown.length ? shown.map((p) => {
        let imgs = []; try { imgs = JSON.parse(p.imagesJson || "[]"); } catch {}
        const liked = LikedPosts.has(s.id, p.id);
        return `<div class="post">
          <div class="who">${p.studentName}</div>
          <div class="when">${new Date(p.createdAt).toLocaleString("ar-EG")}</div>
          <div class="text">${linkify(p.text || "", true)}</div>
          ${imgs.length ? `<div class="post-imgs">${imgs.map((u) => `<img src="${u}">`).join("")}</div>` : ""}
          <div class="post-actions">
            <button class="icon-btn like-btn ${liked ? "active" : ""}" data-id="${p.id}" data-rowindex="${p.rowIndex}" data-likes="${Number(p.likes) || 0}">
              ${svgIcon('<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.3a2 2 0 0 0 2-1.7l1.4-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>')}
              <span>${Number(p.likes) || 0}</span>
            </button>
            <button class="icon-btn reply-toggle" data-id="${p.id}">${svgIcon('<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>')} الردود</button>
            <button class="icon-btn share-post-btn" data-postid="${p.id}" data-title="${escapeHtml(stripHtml(p.text || "").slice(0, 60))}">${svgIcon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>')} مشاركة</button>
          </div>
          <div class="replies-wrap" id="replies-${p.id}" hidden></div>
        </div>`;
      }).join("") : `<div class="empty">لا توجد نتائج</div>`;
      wrap.querySelectorAll(".like-btn").forEach((btn) =>
        btn.addEventListener("click", async () => {
          const postId = btn.dataset.id;
          if (LikedPosts.has(s.id, postId)) return; // one like per student, on-device guard
          const newCount = Number(btn.dataset.likes) + 1;
          btn.classList.add("active");
          btn.querySelector("span").textContent = newCount;
          LikedPosts.add(s.id, postId);
          try { await Sheet.update("ForumPosts", btn.dataset.rowindex, { likes: newCount }); }
          catch { toast("تعذر تسجيل الإعجاب"); }
        })
      );
      wrap.querySelectorAll(".reply-toggle").forEach((btn) =>
        btn.addEventListener("click", () => toggleReplies(s, btn.dataset.id))
      );
      wrap.querySelectorAll(".share-post-btn").forEach((btn) =>
        btn.addEventListener("click", () => shareLink("post", btn.dataset.postid, btn.dataset.title))
      );
    }
    draw(posts);
    document.getElementById("forum-mine-toggle").addEventListener("click", (e) => {
      mineOnly = !mineOnly;
      e.currentTarget.classList.toggle("active", mineOnly);
      draw(posts);
    });
    document.getElementById("forum-search").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      draw(posts.filter((p) => (p.text || "").toLowerCase().includes(q) || (p.studentName || "").toLowerCase().includes(q)));
    });
  } catch (err) { console.error(err); }
}

/* ---------------------- Feature: forum replies (DB-backed) ---------------------- */
async function toggleReplies(s, postId) {
  const box = document.getElementById(`replies-${postId}`);
  if (!box) return;
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div class="spinner"></div>`;
  try {
    const replies = (await Sheet.list("ForumReplies", { filter: (r) => r.postId === postId }))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    box.innerHTML = `
      ${replies.map((r) => `
        <div class="reply-row">
          <span class="reply-who">${r.studentName}</span>
          <span class="reply-text">${linkify(r.text, true)}</span>
        </div>`).join("")}
      <div class="reply-compose">
        <input id="reply-input-${postId}" type="text" placeholder="اكتب ردًا...">
        <button class="reply-send" data-post="${postId}">${svgIcon('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>')}</button>
      </div>`;
    box.querySelector(".reply-send").addEventListener("click", async () => {
      const input = document.getElementById(`reply-input-${postId}`);
      const text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      try {
        await Sheet.create("ForumReplies", { id: `fr_${Date.now()}`, postId, studentId: s.id, studentName: s.fullName, text, createdAt: new Date().toISOString() });
        toggleReplies(s, postId); // close
        toggleReplies(s, postId); // reopen fresh with the new reply included
      } catch { toast("تعذر إرسال الرد"); input.disabled = false; }
    });
  } catch (err) { box.innerHTML = `<div class="empty">تعذر تحميل الردود</div>`; console.error(err); }
}

/* ---------------------- FAQ ---------------------- */
async function renderFAQ() {
  showScreen("faq");
  const el = document.getElementById("screen-faq");
  el.innerHTML = `<h2 class="heading">الأسئلة الشائعة</h2><div id="faq-list"><div class="spinner"></div></div>`;
  try {
    const faqs = (await Sheet.list("FAQs")).sort((a, b) => (a.order || 0) - (b.order || 0));
    const wrap = document.getElementById("faq-list");
    if (!faqs.length) { wrap.outerHTML = `<div class="empty">لا توجد أسئلة شائعة بعد</div>`; return; }
    wrap.innerHTML = faqs.map((f, i) => `
      <div class="path-card" style="margin-bottom:10px;cursor:pointer;" data-i="${i}">
        <div class="title">${f.question}</div>
        <div class="sub faq-answer" hidden style="margin-top:8px;line-height:1.7;">${linkify(f.answer)}</div>
      </div>`).join("");
    wrap.querySelectorAll(".path-card").forEach((card) =>
      card.addEventListener("click", () => card.querySelector(".faq-answer").hidden = !card.querySelector(".faq-answer").hidden)
    );
  } catch (err) { console.error(err); }
}

/* ---------------------- Parent dashboard ---------------------- */
async function renderParentDashboard() {
  const el = document.getElementById("screen-parent");
  const s = Session.get();
  el.innerHTML = `<div class="spinner"></div>`;
  try {
    const students = await Sheet.list("Students", { filter: (r) => r.id === s.studentId });
    const student = students[0];
    if (!student) { el.innerHTML = `<div class="empty">تعذر إيجاد بيانات الابن</div>`; return; }

    const [att, scores, courses, payments] = await Promise.all([
      Sheet.list("Attendance", { filter: (r) => r.studentId === s.studentId }),
      Sheet.list("Scores", { filter: (r) => r.studentId === s.studentId }),
      Sheet.list("Courses", { filter: (r) => r.grade === student.grade }),
      Sheet.list("Payments", { filter: (r) => r.studentId === s.studentId }),
    ]);
    const present = att.filter((a) => String(a.present).toLowerCase() === "true").length;

    el.innerHTML = `
      <h2 class="heading">متابعة ${student.fullName.split(" ")[0]}</h2>
      <div class="text-block" style="margin-bottom:14px;">
        <div>${student.fullName} — ${GRADE_LABELS[student.grade]}</div>
      </div>

      <div class="chart-wrap">
        <div class="chart-title">آخر ١٠ أيام حضور (أخضر = حاضر)</div>
        <div id="parent-chart-attendance"></div>
      </div>
      <div class="chart-wrap">
        <div class="chart-title">اتجاه نتائج آخر الاختبارات (%)</div>
        <div id="parent-chart-scores"></div>
      </div>

      <div class="section-title"><h3>الحضور والغياب</h3></div>
      <div class="text-block" style="margin-bottom:14px;">حضر: ${present} — غاب: ${att.length - present}</div>

      <div class="section-title"><h3>النتائج</h3></div>
      <div id="parent-scores" style="margin-bottom:14px;">
        ${scores.length ? scores.map((sc) => `<div class="text-block" style="margin-bottom:8px;">${sc.refType === "quiz" ? "اختبار" : "تسميع"}: ${sc.score} / ${sc.total}</div>`).join("") : `<div class="empty">لا توجد نتائج بعد</div>`}
      </div>

      <div class="section-title"><h3>الاشتراكات والدفع</h3></div>
      <div id="parent-subs"></div>
      <button class="btn-primary" id="btn-parent-report" style="margin-top:18px;">التقرير الأسبوعي (للطباعة)</button>`;

    const last10Att = att.slice(-10);
    document.getElementById("parent-chart-attendance").innerHTML = last10Att.length
      ? svgMiniBars(last10Att.map(() => 1), last10Att.map((a) => (String(a.present).toLowerCase() === "true" ? "#22C7A0" : "#FF5D6C")))
      : `<div class="empty">لا توجد بيانات بعد</div>`;
    const sortedScores = scores.slice().sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-10);
    const pcts = sortedScores.map((sc) => Math.round((Number(sc.score) / (Number(sc.total) || 1)) * 100));
    document.getElementById("parent-chart-scores").innerHTML = pcts.length ? svgMiniLine(pcts) : `<div class="empty">لا توجد بيانات بعد</div>`;

    document.getElementById("btn-parent-report").addEventListener("click", () => openWeeklyReport(s.studentId));

    const subsEl = document.getElementById("parent-subs");
    if (!courses.length) { subsEl.innerHTML = `<div class="empty">لا توجد كورسات لهذا الصف</div>`; }
    else {
      subsEl.innerHTML = courses.map((c) => {
        const pay = payments.find((p) => p.courseId === c.id);
        const paid = pay && String(pay.paid).toLowerCase() === "true";
        return `<div class="path-card" style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div class="title">${c.titleAr || c.title}</div>
            <div class="sub">${c.price ? c.price + " ج.م" : ""} — ${paid ? "تم الدفع" : "غير مدفوع"}</div>
          </div>
          ${paid ? "" : `<button class="btn-primary" style="width:auto;padding:8px 16px;" data-course="${c.id}" data-name="${c.titleAr || c.title}">اشتراك</button>`}
        </div>`;
      }).join("");
      subsEl.querySelectorAll("button[data-course]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          try {
            await Sheet.create("Payments", { id: `pay_${Date.now()}`, studentId: s.studentId, courseId: btn.dataset.course, paid: "false", status: "pending", date: new Date().toISOString() });
            toast("تم إرسال طلب الاشتراك، بانتظار تأكيد المستر");
            renderParentDashboard();
          } catch { toast("تعذر إرسال الطلب"); }
        })
      );
    }
  } catch (err) { console.error(err); el.innerHTML = `<div class="empty">تعذر تحميل بيانات المتابعة</div>`; }
}

/* ---------------------- Weekly report (glass, printable) ---------------------- */
function startOfWeekAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}
function inLastWeek(dateStr) {
  const d = new Date(dateStr);
  return !isNaN(d) && d >= startOfWeekAgo();
}

async function buildWeeklyReport(studentId) {
  const [students, att, scores, payments] = await Promise.all([
    Sheet.list("Students", { filter: (r) => r.id === studentId }),
    Sheet.list("Attendance", { filter: (r) => r.studentId === studentId }),
    Sheet.list("Scores", { filter: (r) => r.studentId === studentId }),
    Sheet.list("Payments", { filter: (r) => r.studentId === studentId }),
  ]);
  const student = students[0];
  const weekAtt = att.filter((a) => inLastWeek(a.date));
  const weekScores = scores.filter((s) => inLastWeek(s.date));
  const present = weekAtt.filter((a) => String(a.present).toLowerCase() === "true").length;
  const quizScores = weekScores.filter((s) => s.refType === "quiz");
  const vocabScores = weekScores.filter((s) => s.refType === "vocab");
  const avgPct = (arr) => arr.length
    ? Math.round((arr.reduce((sum, s) => sum + (Number(s.score) / (Number(s.total) || 1)), 0) / arr.length) * 100)
    : null;
  const unpaid = payments.filter((p) => String(p.paid).toLowerCase() !== "true").length;
  return { student, weekAtt, present, quizScores, vocabScores, avgQuiz: avgPct(quizScores), avgVocab: avgPct(vocabScores), unpaid };
}

async function openWeeklyReport(studentId) {
  const overlay = document.getElementById("report-overlay");
  const content = document.getElementById("report-content");
  overlay.hidden = false;
  content.innerHTML = `<div class="spinner"></div>`;
  try {
    const r = await buildWeeklyReport(studentId);
    if (!r.student) { content.innerHTML = `<div class="empty">تعذر تحميل بيانات التقرير</div>`; return; }
    const today = new Date();
    const from = startOfWeekAgo();
    const fmt = (d) => d.toLocaleDateString("ar-EG", { day: "numeric", month: "long" });
    content.innerHTML = `
      <div class="report-head">
        <img class="logo" src="https://i.ibb.co/4g4YK4Qh/Picsart-26-07-02-21-34-00-868.png" alt="logo">
        <button class="btn-ghost" id="report-close" style="width:auto;padding:6px 14px;">إغلاق</button>
      </div>
      <div class="report-title heading">التقرير الأسبوعي</div>
      <div class="report-sub">${r.student.fullName} — ${GRADE_LABELS[r.student.grade]} · من ${fmt(from)} إلى ${fmt(today)}</div>

      <div class="report-stat-grid">
        <div class="report-stat"><div class="num">${r.weekAtt.length ? r.present : "—"}</div><div class="lbl">أيام حضور هذا الأسبوع</div></div>
        <div class="report-stat"><div class="num">${r.weekAtt.length ? r.weekAtt.length - r.present : "—"}</div><div class="lbl">أيام غياب هذا الأسبوع</div></div>
        <div class="report-stat"><div class="num">${r.avgQuiz !== null ? r.avgQuiz + "%" : "—"}</div><div class="lbl">متوسط الاختبارات</div></div>
        <div class="report-stat"><div class="num">${r.avgVocab !== null ? r.avgVocab + "%" : "—"}</div><div class="lbl">متوسط التسميع</div></div>
      </div>

      ${r.quizScores.length || r.vocabScores.length ? `
        <div class="section-title" style="margin-top:4px;"><h3>تفاصيل هذا الأسبوع</h3></div>
        ${[...r.quizScores, ...r.vocabScores].map((s) => `
          <div class="report-list-item">
            <span>${s.refType === "quiz" ? "اختبار" : "تسميع كلمات"} — ${new Date(s.date).toLocaleDateString("ar-EG")}</span>
            <span>${s.score} / ${s.total}</span>
          </div>`).join("")}
      ` : `<div class="empty">لا يوجد نشاط اختبارات أو تسميع هذا الأسبوع</div>`}

      ${r.unpaid ? `<div class="report-list-item" style="color:var(--rose);"><span>حالة الدفع</span><span>يوجد ${r.unpaid} كورس غير مدفوع</span></div>` : ""}

      <div class="report-actions">
        <button class="btn-primary" id="report-print">طباعة / حفظ PDF</button>
      </div>
      <div class="report-footer">جميع الحقوق محفوظة لدى Mr. Abdulrahim Hassan®</div>`;

    document.getElementById("report-close").addEventListener("click", () => { overlay.hidden = true; });
    document.getElementById("report-print").addEventListener("click", () => window.print());
  } catch (err) {
    content.innerHTML = `<div class="empty">تعذر تحميل التقرير، حاول مرة أخرى</div>`;
    console.error(err);
  }
}

/* ---------------------- Profile ---------------------- */
/* ---------------------- Tiny dependency-free SVG charts ---------------------- */
function svgMiniBars(values, colors, w = 300, h = 90) {
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  const barW = w / values.length - 4;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${values.map((v, i) => {
    const bh = (v / max) * (h - 12);
    return `<rect x="${i * (barW + 4)}" y="${h - bh}" width="${barW}" height="${bh}" rx="3" fill="${colors[i] || "var(--blue)"}"/>`;
  }).join("")}</svg>`;
}
function svgMiniLine(values, w = 300, h = 90, color = "#2F6FED") {
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  const stepX = w / Math.max(values.length - 1, 1);
  const y = (v) => h - (v / max) * (h - 14) - 6;
  const pts = values.map((v, i) => `${i * stepX},${y(v)}`).join(" ");
  const dots = values.map((v, i) => `<circle cx="${i * stepX}" cy="${y(v)}" r="3.5" fill="${color}"/>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5"/>${dots}</svg>`;
}
function svgRing(pct, size = 76, color = "#2F6FED") {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, pct)) / 100) * c;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--panel-line)" stroke-width="7"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="52%" text-anchor="middle" font-size="16" font-weight="700" fill="${color}">${pct}%</text>
  </svg>`;
}

async function renderProfile() {
  showScreen("profile");
  const el = document.getElementById("screen-profile");
  const s = Session.get();
  const xp = XP.get(s.id);
  const level = XP.level(xp);
  const levelPct = XP.levelProgress(xp);
  const earnedBadges = Badges.list(s.id);
  el.innerHTML = `
    <h2 class="heading">حسابي</h2>
    <div class="text-block" style="margin-bottom:16px;">
      <div>${s.fullName}</div>
      <div style="color:var(--ink-soft);font-size:13px;margin-top:4px;">${GRADE_LABELS[s.grade]}</div>
    </div>

    <div class="level-card">
      <div class="level-badge">Lv ${level}</div>
      <div style="flex:1;">
        <div class="level-xp-row"><span>${xp} XP</span><span>${levelPct}/100 للمستوى التالي</span></div>
        <div class="level-bar"><div style="width:${levelPct}%"></div></div>
      </div>
    </div>

    <div class="chart-wrap" style="display:flex;align-items:center;gap:16px;">
      <div id="attendance-ring"><div class="spinner"></div></div>
      <div>
        <div class="chart-title" style="margin-bottom:2px;">نسبة الحضور الإجمالية</div>
        <div style="font-size:11.5px;color:var(--ink-soft);">من إجمالي الأيام المسجلة بواسطة المستر</div>
      </div>
    </div>

    <div class="section-title"><h3>شاراتي</h3></div>
    <div class="badge-grid">
      ${Object.keys(BADGES).map((id) => `
        <div class="badge-item ${earnedBadges.includes(id) ? "" : "locked"}" title="${BADGES[id].desc}">
          <div class="badge-icon">${svgIcon(BADGES[id].icon)}</div>
          <div class="badge-label">${BADGES[id].label}</div>
        </div>`).join("")}
    </div>

    <div class="section-title"><h3>لوحة المتابعة</h3></div>
    <div class="chart-wrap">
      <div class="chart-title">آخر ١٠ أيام حضور (أخضر = حاضر)</div>
      <div id="chart-attendance"><div class="spinner"></div></div>
    </div>
    <div class="chart-wrap">
      <div class="chart-title">اتجاه نتائج آخر الاختبارات (%)</div>
      <div id="chart-scores"><div class="spinner"></div></div>
    </div>

    <div class="section-title"><h3>الحضور والغياب</h3></div>
    <div id="profile-attendance"><div class="spinner"></div></div>
    <div class="section-title"><h3>النتائج</h3></div>
    <div id="profile-scores"><div class="spinner"></div></div>

    <div class="section-title"><h3>شهاداتي وجوائزي</h3></div>
    <div id="profile-certs"><div class="spinner"></div></div>

    <div class="section-title"><h3>مدفوعاتي</h3></div>
    <div id="profile-payments"><div class="spinner"></div></div>

    <div class="section-title"><h3>اقتراحات وشكاوى</h3></div>
    <textarea id="suggestion-box" class="note-box" placeholder="اكتب اقتراحك أو شكواك للمستر..."></textarea>
    <button class="btn-ghost" id="btn-send-suggestion" style="margin-top:8px;">إرسال</button>

    <div class="section-title"><h3>تغيير كلمة المرور</h3></div>
    <div class="field"><input id="pw-current" type="password" placeholder="كلمة المرور الحالية"></div>
    <div class="field-row">
      <div class="field"><input id="pw-new" type="password" placeholder="كلمة المرور الجديدة"></div>
      <div class="field"><input id="pw-new2" type="password" placeholder="تأكيدها"></div>
    </div>
    <button class="btn-ghost" id="btn-change-pass">تحديث كلمة المرور</button>

    <button class="btn-primary" id="btn-weekly-report" style="margin-top:18px;">التقرير الأسبوعي (للطباعة)</button>
    <button class="btn-ghost" id="btn-logout" style="margin-top:10px;">تسجيل الخروج</button>`;

  document.getElementById("btn-weekly-report").addEventListener("click", () => openWeeklyReport(s.id));
  document.getElementById("btn-logout").addEventListener("click", () => { Session.clear(); location.reload(); });
  document.getElementById("btn-send-suggestion").addEventListener("click", async () => {
    const text = document.getElementById("suggestion-box").value.trim();
    if (!text) return toast("اكتب اقتراحك أولاً");
    try {
      await Sheet.create("Suggestions", { id: `sg_${Date.now()}`, studentId: s.id, studentName: s.fullName, text, createdAt: new Date().toISOString() });
      document.getElementById("suggestion-box").value = "";
      toast("تم الإرسال، شكرًا لك");
    } catch { toast("تعذر الإرسال"); }
  });
  document.getElementById("btn-change-pass").addEventListener("click", async () => {
    const current = document.getElementById("pw-current").value;
    const next = document.getElementById("pw-new").value;
    const next2 = document.getElementById("pw-new2").value;
    if (next.length < 6) return toast("كلمة المرور الجديدة قصيرة جدًا");
    if (next !== next2) return toast("كلمتا المرور غير متطابقتين");
    try {
      const rows = await Sheet.list("Students", { filter: (r) => r.id === s.id });
      if (!rows[0] || rows[0].password !== current) return toast("كلمة المرور الحالية غير صحيحة");
      await Sheet.update("Students", rows[0].rowIndex, { password: next });
      toast("تم تحديث كلمة المرور");
      document.getElementById("pw-current").value = "";
      document.getElementById("pw-new").value = "";
      document.getElementById("pw-new2").value = "";
    } catch (err) { toast("تعذر التحديث، تأكد من اتصالك بالإنترنت أو حدّث الصفحة وحاول تاني"); console.error(err); }
  });

  try {
    const att = await Sheet.list("Attendance", { filter: (r) => r.studentId === s.id });
    const present = att.filter((a) => String(a.present).toLowerCase() === "true").length;
    document.getElementById("profile-attendance").innerHTML =
      `<div class="text-block">حضر: ${present} — غاب: ${att.length - present}</div>`;
    const last10 = att.slice(-10);
    document.getElementById("chart-attendance").innerHTML = last10.length
      ? svgMiniBars(last10.map(() => 1), last10.map((a) => (String(a.present).toLowerCase() === "true" ? "#22C7A0" : "#FF5D6C")))
      : `<div class="empty">لا توجد بيانات بعد</div>`;
    const pct = att.length ? Math.round((present / att.length) * 100) : 0;
    document.getElementById("attendance-ring").innerHTML = svgRing(pct);
  } catch {
    document.getElementById("profile-attendance").innerHTML = `<div class="empty">لا توجد بيانات بعد</div>`;
    document.getElementById("chart-attendance").innerHTML = `<div class="empty">لا توجد بيانات بعد</div>`;
    document.getElementById("attendance-ring").innerHTML = svgRing(0);
  }

  try {
    const scores = await Sheet.list("Scores", { filter: (r) => r.studentId === s.id });
    document.getElementById("profile-scores").innerHTML = scores.length
      ? scores.map((sc) => `<div class="text-block" style="margin-bottom:8px;">${sc.refType === "quiz" ? "اختبار" : "تسميع"}: ${sc.score} / ${sc.total}</div>`).join("")
      : `<div class="empty">لا توجد نتائج بعد</div>`;
    const sorted = scores.slice().sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-10);
    const pcts = sorted.map((sc) => Math.round((Number(sc.score) / (Number(sc.total) || 1)) * 100));
    document.getElementById("chart-scores").innerHTML = pcts.length ? svgMiniLine(pcts) : `<div class="empty">لا توجد بيانات بعد</div>`;
  } catch {
    document.getElementById("profile-scores").innerHTML = `<div class="empty">لا توجد بيانات بعد</div>`;
    document.getElementById("chart-scores").innerHTML = `<div class="empty">لا توجد بيانات بعد</div>`;
  }

  try {
    const certs = await Sheet.list("Certificates", { filter: (r) => r.studentId === s.id });
    document.getElementById("profile-certs").innerHTML = certs.length
      ? `<div class="cert-grid">${certs.map((c) => `
          <div class="cert-card">
            <img src="${c.imageUrl}" onerror="this.style.display='none'">
            <div class="cert-title">${c.title}</div>
          </div>`).join("")}</div>`
      : `<div class="empty">لسه معندكش شهادات أو جوائز مرفوعة</div>`;
  } catch { document.getElementById("profile-certs").innerHTML = `<div class="empty">تعذر تحميل الشهادات</div>`; }

  try {
    const [payments, courses] = await Promise.all([
      Sheet.list("Payments", { filter: (r) => r.studentId === s.id }),
      Sheet.list("Courses", { filter: (r) => r.grade === s.grade }),
    ]);
    document.getElementById("profile-payments").innerHTML = payments.length
      ? payments.map((p) => {
          const c = courses.find((x) => x.id === p.courseId);
          const paid = String(p.paid).toLowerCase() === "true";
          return `<div class="path-card" style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;">
            <div class="title">${c ? (c.titleAr || c.title) : p.courseId}</div>
            <span class="task-badge ${paid ? "" : "pdf"}">${paid ? "تم الدفع" : "غير مدفوع"}</span>
          </div>`;
        }).join("")
      : `<div class="empty">لا توجد مدفوعات مسجلة بعد</div>`;
  } catch { document.getElementById("profile-payments").innerHTML = `<div class="empty">تعذر تحميل المدفوعات</div>`; }
}

/* ---------------------- Ban check (polling) ---------------------- */
async function pollBanStatus() {
  const s = Session.get();
  if (!s || s.role !== "student") return;
  try {
    const rows = await Sheet.list("Students", { filter: (r) => r.id === s.id });
    if (rows[0] && String(rows[0].banned).toLowerCase() === "true") showBanned();
  } catch { /* ignore network hiccups */ }
}
setInterval(pollBanStatus, 20000);

/* ---------------------- Boot ---------------------- */
function enterApp() {
  document.getElementById("view-auth").hidden = true;
  document.getElementById("loading").hidden = true;
  NavStack = [];
  armBackTrap();
  const s = Session.get();
  if (s && s.role === "parent") {
    document.getElementById("view-app").hidden = true;
    document.getElementById("view-parent").hidden = false;
    renderParentDashboard();
  } else {
    document.getElementById("view-parent").hidden = true;
    document.getElementById("view-app").hidden = false;
    Streak.touch(s.id);
    renderHome();
    handleDeepLink(s);
  }
}

// Reads a shared #course=/#lecture=/#file=/#post= link (see shareLink above)
// and jumps straight to that screen once the student is logged in. Runs
// after renderHome() so there's always a normal Home underneath to land on
// if the linked item can't be found (deleted, wrong grade, etc.).
async function handleDeepLink(s) {
  const hash = location.hash.replace(/^#/, "");
  const [type, id] = hash.split("=");
  if (!type || !id) return;
  try {
    if (type === "course") {
      const rows = await Sheet.list("Courses", { filter: (r) => r.id === id });
      if (rows.length) renderCourse(id, rows[0]); else toast("الكورس غير موجود أو تم حذفه");
    } else if (type === "lecture") {
      const lecRows = await Sheet.list("Lectures", { filter: (r) => r.id === id });
      if (!lecRows.length) { toast("المحاضرة غير موجودة أو تم حذفها"); return; }
      const courseRows = await Sheet.list("Courses", { filter: (r) => r.id === lecRows[0].courseId });
      pushNav(renderHome, []);
      renderLectureTasks(id, lecRows[0]);
      if (courseRows.length) pushNav(renderCourse, [lecRows[0].courseId, courseRows[0]]);
    } else if (type === "file") {
      const fileRows = await Sheet.list("TeacherFiles", { filter: (r) => r.id === id });
      if (fileRows.length) openTeacherFiles(s.grade);
      else toast("الملف غير موجود أو تم حذفه");
    } else if (type === "post") {
      renderForum();
      setTimeout(() => {
        const btn = document.querySelector(`.share-post-btn[data-postid="${id}"]`);
        const card = btn?.closest(".post");
        if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); card.style.outline = "2px solid var(--blue)"; }
        else toast("المنشور غير موجود أو تم حذفه");
      }, 600);
    }
  } catch (err) { console.error(err); }
  history.replaceState(null, "", location.pathname + location.search); // consume the hash so back/refresh doesn't re-trigger it
}

document.getElementById("btn-parent-logout").addEventListener("click", () => { Session.clear(); location.reload(); });

/* ---------------------- Feature: VPN / proxy blocking ----------------------
   Best-effort only — this is a pure front-end app (see the security note at
   the bottom of this file), so a determined user can always defeat a
   client-side check. This calls proxycheck.io's free endpoint (no key
   required for light traffic; CONFIG.proxycheckKey raises the daily limit)
   which auto-detects the caller's IP when none is given in the URL. If the
   check itself fails for any reason (offline, ad-blocker, service outage,
   rate limit) we fail OPEN — never lock out a real student over a
   third-party hiccup — and just log it for the developer. ---------------- */
async function isLikelyVpn() {
  try {
    const keyParam = CONFIG.proxycheckKey ? `&key=${CONFIG.proxycheckKey}` : "";
    const res = await fetch(`https://proxycheck.io/v2/?vpn=1&asn=0${keyParam}`, { cache: "no-store" });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.status !== "ok") return false;
    const entry = Object.values(data).find((v) => v && typeof v === "object" && "proxy" in v);
    return !!entry && String(entry.proxy).toLowerCase() === "yes";
  } catch (err) {
    console.warn("VPN check unavailable — allowing the student through:", err);
    return false;
  }
}

function showVpnBlocked() {
  document.getElementById("view-auth").hidden = true;
  document.getElementById("view-app").hidden = true;
  document.getElementById("view-parent").hidden = true;
  document.getElementById("loading").hidden = true;
  document.getElementById("view-vpn-blocked").hidden = false;
}
document.getElementById("btn-vpn-retry").addEventListener("click", () => location.reload());

/* ---------------------- Feature: connection status banner ---------------------- */
function updateConnBanner() {
  document.getElementById("conn-banner").hidden = navigator.onLine;
}
window.addEventListener("online", updateConnBanner);
window.addEventListener("offline", updateConnBanner);

/* ---------------------- Feature: install-to-home-screen prompt ----------------------
   Chrome/Android fires "beforeinstallprompt" when the manifest+icons above
   make the site installable; we hold onto that event instead of letting the
   browser show its own mini-infobar, and show our own banner with a direct
   install button instead. NOTE: this API is Chromium-only — Safari/iOS never
   fires it (there's no equivalent there; "Add to Home Screen" on iOS is a
   manual step from the share sheet with no programmatic trigger), and even
   on Chrome it only fires once the browser's own engagement/installability
   heuristics are satisfied, so it won't necessarily appear on every visit. */
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById("install-banner").hidden = false;
});
document.getElementById("btn-install").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  document.getElementById("install-banner").hidden = true;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});
document.getElementById("btn-install-dismiss").addEventListener("click", () => {
  document.getElementById("install-banner").hidden = true;
});
window.addEventListener("appinstalled", () => {
  document.getElementById("install-banner").hidden = true;
  deferredInstallPrompt = null;
});

(async function boot() {
  updateConnBanner();
  if (await isLikelyVpn()) { showVpnBlocked(); return; }
  const s = Session.get();
  document.getElementById("loading").hidden = true;
  if (s) { enterApp(); }
  else { document.getElementById("view-auth").hidden = false; }
})();

/* =====================================================================
   SECURITY NOTE for the developer (not shown to students):
   - Sheetson token and imgbb key are visible to anyone who opens
     devtools, since this is a pure front-end app talking to the APIs
     directly, as requested.
   - Passwords are stored in the sheet as plain text (Sheetson has no
     hashing). Anyone with the token can read every student's password.
   - True copy/download protection for video/audio is not possible from
     a plain web page; this app hides default download UI and disables
     right-click as basic deterrents only.
   If this ever needs to be locked down, the fix is a small backend
   (even a few serverless functions) that holds the Sheetson/imgbb
   credentials and hashes passwords, so the browser never sees them.
   ===================================================================== */
