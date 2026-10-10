/* Teacher Portal — Home · Classes · Attendance · Tests · Notices · Profile (+ ID card) */
(function () {
  "use strict";
  const API = "https://167-86-120-247.sslip.io/api";
  const auth = window.SoftSchoolTeacher;
  const session = auth && auth.getSession();
  if (!session || !session.token) { location.replace("index.html"); return; }

  const staff = session.staff || {};
  const schoolId = session.schoolId;
  let school = session.school || {};
  let schoolName = school.name || "School";
  const $ = (s) => document.querySelector(s);
  const view = $("#view");
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (v) => String(v || "").trim().toLowerCase();
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };

  /* ── Per-teacher local storage (until the backend endpoints exist) ── */
  const SK = "tp_" + schoolId + "_" + (staff.staffId || "t") + "_";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(SK + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(SK + k, JSON.stringify(v)); } catch (e) { /* storage full / blocked */ } }
  };

  /* ── School branding (real school logo + name replace the SoftSchool mark) ── */
  function renderBrand() {
    document.title = "Teacher Portal | " + schoolName;
    const el = $("#school-logo");
    el.innerHTML = ""; el.className = "appbar-logo";
    const fallback = () => {
      el.innerHTML = ""; el.classList.add("letter");
      if (school.name) el.textContent = school.name.trim().charAt(0).toUpperCase();
      else el.innerHTML = '<i class="fas fa-graduation-cap"></i>';
    };
    if (school.logo) { const img = new Image(); img.alt = schoolName; img.onerror = fallback; img.src = school.logo; el.appendChild(img); }
    else fallback();
  }
  renderBrand();

  /* ── API helper (sends the teacher's school-scoped token) ── */
  async function api(path, opts) {
    const res = await fetch(API + path, Object.assign({}, opts, {
      headers: Object.assign({ "Content-Type": "application/json", Authorization: "Bearer " + session.token }, (opts && opts.headers) || {})
    }));
    if (res.status === 401) { auth.clearSession(); toast("Session expired. Please sign in again.", true); setTimeout(() => location.replace("index.html"), 900); throw new Error("401"); }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = text; try { msg = JSON.parse(text).error || text; } catch (e) { /* plain text */ }
      throw new Error(msg || "HTTP " + res.status);
    }
    return res.json().catch(() => ({}));
  }
  let toastTimer;
  function toast(msg, err) {
    const t = $("#toast"); t.textContent = msg; t.className = "toast show" + (err ? " err" : "");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = "toast"), 2600);
  }

  /* ── Real school name / logo / contact ──
     Sources, in order: the teacher-login response (school object) → the admin session on this same
     browser → GET /api/settings/{schoolId}. Never signs the teacher out if one of them fails. */
  async function softGet(path) {
    try { const r = await fetch(API + path, { headers: { Authorization: "Bearer " + session.token } }); return r.ok ? await r.json() : null; } catch (e) { return null; }
  }
  async function loadSchoolInfo() {
    const next = Object.assign({}, school);
    try {
      const a = JSON.parse(localStorage.getItem("softschool_session")), s = a && a.school;
      if (s && String(s.schoolId || a.schoolId) === String(schoolId)) {
        ["name", "logo", "address", "phone"].forEach((k) => { if (!next[k] && s[k]) next[k] = s[k]; });
      }
    } catch (e) { /* no admin session here */ }
    const st = await softGet("/settings/" + encodeURIComponent(schoolId));
    if (st) {
      if (st.schoolName) next.name = st.schoolName;
      if (st.schoolAddress) next.address = st.schoolAddress;
      if (st.schoolPhone) next.phone = st.schoolPhone;
      const lg = st.schoolLogo || st.logo; if (lg && !next.logo) next.logo = lg;
    }
    if (JSON.stringify(next) === JSON.stringify(school)) return;
    school = next; schoolName = school.name || "School";
    auth.updateSession({ school: next }); renderBrand();
  }

  /* ── Staff data → assignments ── */
  function parseList(json) { try { const a = JSON.parse(json); return Array.isArray(a) ? a.filter((x) => x && x.cls) : []; } catch (e) { return []; } }
  function teachingClasses() {
    const a = parseList(staff.classAssignments);
    if (a.length) return a.map((x) => ({ cls: x.cls, section: x.section || "" }));
    return String(staff.classes || "").split(",").map((s) => s.trim()).filter(Boolean).map((cls) => ({ cls, section: "" }));
  }
  function inchargeClasses() {
    const a = parseList(staff.inchargeAssignments);
    if (a.length) return a.map((x) => ({ cls: x.cls, section: x.section || "" }));
    if (staff.assignedClass && (staff.isClassIncharge || staff.incharge)) return [{ cls: staff.assignedClass, section: staff.assignedSection || "" }];
    return [];
  }
  const label = (c) => c.cls + (c.section ? " - " + c.section : "");
  const subjects = () => String(staff.subjects || "").split(",").map((s) => s.trim()).filter(Boolean);
  /* Subject → class pairs set by the admin ({subject, cls, section}). Teachers saved before this
     existed have none, and keep the old behaviour (every subject in every class). */
  const subjectPairs = () => { try { const a = JSON.parse(staff.subjectAssignments || "[]"); return Array.isArray(a) ? a.filter((x) => x && x.cls && x.subject) : []; } catch (e) { return []; } };
  const hasPairs = () => subjectPairs().length > 0;
  /* Subjects this teacher teaches in one class, given its label ("Class 5 - A" or "Class 5"). */
  function subjectsForClass(lbl) {
    if (!hasPairs()) return subjects();
    const parts = String(lbl || "").split(/\s+-\s+/), c = norm(parts[0]), sc = norm(parts[1]), out = [];
    subjectPairs().forEach((p) => { if (norm(p.cls) === c && (!p.section || !sc || norm(p.section) === sc) && out.indexOf(p.subject) < 0) out.push(p.subject); });
    return out;
  }
  const initials = () => String(staff.name || "T").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  /* ── Attendance state ── */
  const att = { students: null, saved: {}, cls: 0, marks: {}, loading: false };
  async function loadAttendanceData(quiet) {
    att.loading = true;
    try {
      const [stu, logs] = await Promise.all([
        api("/students/summary?schoolId=" + encodeURIComponent(schoolId)),
        api("/attendance/students?date=" + today() + "&schoolId=" + encodeURIComponent(schoolId))
      ]);
      att.students = (Array.isArray(stu) ? stu : []).filter((s) => !s.status || s.status === "active").map((s) => ({
        regNo: s.regNo, name: s.fullName || "Unknown", cls: s.studentClass || "", section: s.section || "A", guardian: s.guardianName || ""
      }));
      att.saved = {};
      (Array.isArray(logs) ? logs : []).forEach((l) => { if (l.memberId) att.saved[l.memberId] = l.status || "absent"; });
      if (!quiet) att.marks = {};
      (typeof attPending !== "undefined" ? attPending : []).forEach((p) => p.forEach((x) => { if (x.date === today()) att.saved[x.memberId] = x.status; }));   // not-yet-uploaded saves still show
    } catch (e) { if (e.message !== "401" && !quiet) toast("Could not load attendance data.", true); att.students = att.students || []; }
    att.loading = false;
  }
  function classStudents() {
    const c = inchargeClasses()[att.cls];
    if (!c) return [];
    return att.students.filter((s) => norm(s.cls) === norm(c.cls) && (!c.section || norm(s.section) === norm(c.section)));
  }
  const statusOf = (s) => att.marks[s.regNo] || att.saved[s.regNo] || "present";
  function counts(list) { const r = { present: 0, absent: 0, leave: 0 }; list.forEach((s) => r[statusOf(s)]++); return r; }


  const empty = (ic, t, p) => `<div class="empty"><i class="fas ${ic}"></i><b>${t}</b><p>${p}</p></div>`;
  let pwOpen = false;
  async function ensureStudents() { if (!att.students && !att.loading) await loadAttendanceData(); return att.students || []; }
  function studentsOf(c) { return (att.students || []).filter((s) => norm(s.cls) === norm(c.cls) && (!c.section || norm(s.section) === norm(c.section))); }
  const allMyClasses = () => { const m = {}; teachingClasses().concat(inchargeClasses()).forEach((c) => (m[label(c)] = c)); return Object.keys(m).map((k) => m[k]); };
  /* Classes where this teacher actually teaches a subject — what Diary and Tests should offer. */
  const subjectClasses = () => { if (!hasPairs()) return allMyClasses(); const m = {}; subjectPairs().forEach((p) => { const c = { cls: p.cls, section: p.section || "" }; m[label(c)] = c; }); return Object.keys(m).map((k) => m[k]); };

  /* ── Sheet (bottom modal) ── */
  function openSheet(html, cls) { const b = $("#sheet-body"); b.className = "sheet" + (cls ? " " + cls : ""); b.innerHTML = html; $("#sheet").hidden = false; b.scrollTop = 0; document.body.style.overflow = "hidden"; }
  function closeSheet() { $("#sheet").hidden = true; $("#sheet-body").innerHTML = ""; document.body.style.overflow = ""; }
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet" || e.target.closest("[data-close]")) closeSheet(); });

  /* ── Announcements store (received + sent). Backend endpoints are TODO — see api* helpers ── */
  const ann = { received: store.get("ann_in", []), loaded: false };
  const prefs = Object.assign({ receiveAdmin: true }, store.get("prefs", {}));
  const unread = () => (prefs.receiveAdmin ? ann.received.filter((a) => !a.read).length : 0);
  const totalUnread = () => unread() + chatUnread();
  function updateDot() { const n = totalUnread(); const d = $("#inbox-dot"); if (!d) return; d.hidden = !n; d.textContent = n > 9 ? "9+" : n; }
  async function loadAnnouncements() {
    try {
      const list = await api("/announcements?schoolId=" + encodeURIComponent(schoolId) + "&audience=teachers");
      if (Array.isArray(list)) {
        const readIds = {}; ann.received.forEach((a) => { if (a.read) readIds[a.id] = 1; });
        ann.received = list.map((a) => ({ id: String(a.id), title: a.title || "Announcement", body: a.body || a.message || "", from: a.from || a.createdBy || "Admin", date: a.date || a.createdAt || new Date().toISOString(), priority: a.priority || "normal", read: !!readIds[a.id] }));
        store.set("ann_in", ann.received);
      }
    } catch (e) { /* endpoint not live yet — keep cached copy */ }
    ann.loaded = true; updateDot();
  }
  /* ── Tests & quizzes (stored per teacher; ready to swap for API) ── */
  let tests = store.get("tests", []);
  const saveTests = () => store.set("tests", tests);
  /* Server sync: PUT/DELETE /api/teacher-tests. Failures are queued and retried on refresh / next open. */
  let pendingPut = store.get("tests_put", []), pendingDel = store.get("tests_del", []);
  const savePending = () => { store.set("tests_put", pendingPut); store.set("tests_del", pendingDel); };
  async function flushTests() {
    for (const id of pendingPut.slice()) {
      const t = tests.find((x) => x.id === id);
      if (!t) { pendingPut = pendingPut.filter((x) => x !== id); continue; }
      try { await api("/teacher-tests/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(Object.assign({ schoolId, staffId: staff.staffId, staffName: staff.name }, t)) }); pendingPut = pendingPut.filter((x) => x !== id); } catch (e) { if (e.message === "401") return; break; }
    }
    for (const id of pendingDel.slice()) {
      try { await api("/teacher-tests/" + encodeURIComponent(id) + "?schoolId=" + encodeURIComponent(schoolId) + "&staffId=" + encodeURIComponent(staff.staffId || ""), { method: "DELETE" }); pendingDel = pendingDel.filter((x) => x !== id); } catch (e) { if (e.message === "401") return; break; }
    }
    savePending();
  }
  function pushTest(t) { if (pendingPut.indexOf(t.id) < 0) pendingPut.push(t.id); savePending(); flushTests(); }
  async function loadTests() {
    try {
      const list = await api("/teacher-tests?schoolId=" + encodeURIComponent(schoolId) + "&staffId=" + encodeURIComponent(staff.staffId || ""));
      if (!Array.isArray(list)) return;
      const byId = {}; list.forEach((t) => { if (t && t.id) byId[t.id] = t; });
      pendingPut.forEach((id) => { const l = tests.find((x) => x.id === id); if (l) byId[id] = l; });   // unsynced local edits win
      pendingDel.forEach((id) => delete byId[id]);
      tests.filter((l) => !byId[l.id] && pendingDel.indexOf(l.id) < 0).forEach((l) => { byId[l.id] = l; if (pendingPut.indexOf(l.id) < 0) pendingPut.push(l.id); });  // local-only tests get uploaded once
      tests = Object.keys(byId).map((k) => byId[k]); saveTests(); savePending(); flushTests();
    } catch (e) { /* offline or endpoint not deployed — keep local copy */ }
  }
  let qb = null;         // test being built
  let gradeCtx = null;   // { id, reg }
  let quizView = "list"; // list | build | detail
  let openTest = null;
  const qTotal = (t) => (t.questions || []).reduce((a, q) => a + (+q.marks || 0), 0);
  const gradeOf = (p) => (p >= 90 ? "A+" : p >= 80 ? "A" : p >= 70 ? "B" : p >= 60 ? "C" : p >= 50 ? "D" : "F");
  function scoreSheet(t, r) {
    let got = 0;
    t.questions.forEach((q) => { const a = r.answers[q.id]; if (q.kind === "mcq") { if (a != null && +a === +q.answer) got += +q.marks || 0; } else got += Math.min(+a || 0, +q.marks || 0); });
    return got;
  }
  const resultsOf = (t) => Object.keys(t.results || {}).map((k) => Object.assign({ reg: k }, t.results[k]));
  function testStats(t) {
    const res = resultsOf(t).filter((r) => !r.absent), tot = (+t.totalMarks || qTotal(t)) || 1;
    if (!res.length) return null;
    const pcts = res.map((r) => (r.score / tot) * 100);
    return { n: res.length, avg: pcts.reduce((a, b) => a + b, 0) / pcts.length, hi: Math.max.apply(null, pcts), lo: Math.min.apply(null, pcts), pass: pcts.filter((p) => p >= (t.passPct || 40)).length };
  }

  /* ── HOME ── */
  function ring(pct, color) {
    const r = 30, c = 2 * Math.PI * r, d = c * (pct / 100);
    return `<svg class="ring" viewBox="0 0 76 76"><circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--paper-deep)" stroke-width="9"/><circle cx="38" cy="38" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${d} ${c}" transform="rotate(-90 38 38)"/><text x="38" y="43" text-anchor="middle" font-family="Space Grotesk" font-weight="700" font-size="16" fill="var(--ink)">${Math.round(pct)}%</text></svg>`;
  }
  function weekStrip() {
    const now = new Date(), dow = now.getDay(), out = [];
    for (let i = 0; i < 7; i++) { const d = new Date(now); d.setDate(now.getDate() - dow + i); out.push(`<div class="day ${i === dow ? "on" : ""}"><small>${["S","M","T","W","T","F","S"][i]}</small><b>${d.getDate()}</b></div>`); }
    return `<div class="week">${out.join("")}</div>`;
  }
  function home() {
    const inc = inchargeClasses(), teach = teachingClasses(), mine = allMyClasses();
    const hr = new Date().getHours(), greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const stuCount = att.students ? mine.reduce((n, c) => n + studentsOf(c).length, 0) : null;
    let attCard = "";
    if (inc.length && att.students) {
      const list = classStudents(), c = counts(list), marked = list.some((s) => att.saved[s.regNo]), pct = list.length ? (c.present / list.length) * 100 : 0;
      attCard = `<div class="card att-card"><div class="att-ring">${marked ? ring(pct, "var(--teal-500)") : `<div class="ring-empty"><i class="fas fa-bell"></i></div>`}</div>
        <div class="tx"><h2 style="margin-bottom:4px">Today · ${esc(label(inc[att.cls]))}</h2>
        ${marked ? `<div class="mini-stats"><span class="g"><b>${c.present}</b> Present</span><span class="r"><b>${c.absent}</b> Absent</span><span class="a"><b>${c.leave}</b> Leave</span></div>` : `<p class="hint" style="margin:0">Attendance isn't marked yet.</p>`}
        <button class="link" data-go="attendance">${marked ? "View" : "Mark now"} <i class="fas fa-arrow-right"></i></button></div></div>`;
    }
    const strength = att.students && mine.length ? `<div class="card"><h2><i class="fas fa-users"></i> Class strength</h2>${mine.map((c) => { const n = studentsOf(c).length, mx = Math.max.apply(null, mine.map((x) => studentsOf(x).length).concat([1])); return `<div class="bar-row"><span>${esc(label(c))}</span><div class="bar"><i style="width:${(n / mx) * 100}%"></i></div><b>${n}</b></div>`; }).join("")}</div>` : "";
    const recent = tests.slice().sort((a, b) => b.created - a.created).slice(0, 2);
    const testCard = `<div class="card"><h2><i class="fas fa-file-pen"></i> Tests & quizzes <button class="link r" data-go="quizzes">All</button></h2>${recent.length ? recent.map((t) => { const st = testStats(t); return `<div class="row" data-test="${t.id}" style="cursor:pointer"><div class="ic"><i class="fas fa-file-lines"></i></div><div class="tx"><b>${esc(t.title)}</b><span>${esc(t.cls)} · ${esc(t.subject)}</span></div>${st ? `<span class="pill teal">${Math.round(st.avg)}% avg</span>` : `<span class="pill amber">Marks pending</span>`}</div>`; }).join("") : `<p class="hint" style="margin:0 0 10px">Add your first paper test in a minute.</p><button class="btn ghost sm" style="margin:0" data-newtest="1"><i class="fas fa-plus"></i> New test</button>`}</div>`;
    const todos = store.get("todos", []);
    const todoCard = `<div class="card"><h2><i class="fas fa-list-check"></i> My to-do</h2>
      ${todos.map((t, i) => `<label class="todo ${t.done ? "done" : ""}"><input type="checkbox" data-todo="${i}" ${t.done ? "checked" : ""}><span>${esc(t.text)}</span><button data-deltodo="${i}" aria-label="Delete"><i class="fas fa-xmark"></i></button></label>`).join("")}
      <div class="todo-add"><input id="todo-in" placeholder="Add a reminder…" maxlength="80"><button class="icon-btn dark" id="todo-add" aria-label="Add"><i class="fas fa-plus"></i></button></div></div>`;

    view.innerHTML = `
      <div class="hero"><small>${greet},</small><h2>${esc((staff.name || "Teacher").split(" ")[0])}</h2>
        ${school.name ? `<div class="hero-school">${esc(school.name)}</div>` : ""}
        <span class="pill"><i class="fas fa-id-badge"></i> ${esc(staff.staffId || "")}</span>
        ${inc.length ? `<span class="pill"><i class="fas fa-star"></i> Incharge ${esc(label(inc[0]))}</span>` : ""}</div>
      ${weekStrip()}
      <div class="qa">
        ${inc.length ? `<button data-go="attendance"><i class="fas fa-clipboard-check"></i><span>Attendance</span></button>` : ""}
        <button data-newtest="1"><i class="fas fa-file-circle-plus"></i><span>Add test</span></button>
        <button data-go="inbox"><i class="fas fa-envelope"></i><span>Messages</span></button>
        <button data-card="1"><i class="fas fa-id-card"></i><span>ID card</span></button>
      </div>
      ${messagesCard()}
      <div class="stats s4">
        <div class="stat"><i class="fas fa-chalkboard"></i><b>${teach.length}</b><span>Classes</span></div>
        <div class="stat amber"><i class="fas fa-book"></i><b>${subjects().length}</b><span>Subjects</span></div>
        <div class="stat blue"><i class="fas fa-user-graduate"></i><b>${stuCount == null ? "—" : stuCount}</b><span>Students</span></div>
        <div class="stat violet"><i class="fas fa-file-pen"></i><b>${tests.length}</b><span>Tests</span></div>
      </div>
      ${attCard}
      ${session.passwordChanged ? "" : `<div class="card nudge"><div class="row"><div class="ic"><i class="fas fa-key"></i></div><div class="tx"><b>Secure your account</b><span>You're using the default password. Change it once from Profile.</span></div></div><button class="btn sm" data-go="profile">Change password</button></div>`}
      ${testCard}${strength}${todoCard}`;
  }
  /* Home: compact view of the latest conversations */
  function messagesCard() {
    const rows = threadList().map((th) => Object.assign({ th }, threadInfo(th))).filter((x) => x.unread || x.at).sort((a, b) => b.at - a.at).slice(0, 3), un = totalUnread();
    return `<div class="card msg-card"><h2><i class="fas fa-comments"></i> Messages ${un ? `<i class="cnt">${un}</i>` : ""}<button class="link r" data-go="inbox">Open</button></h2>
      ${rows.length ? rows.map((x) => `<button class="thr sm" data-thread="${esc(x.th.key)}"><div class="thr-ic ${x.th.kind}"><i class="fas ${x.th.icon}"></i></div><div class="thr-tx"><b>${esc(x.th.title)}</b><span>${esc(x.last)}</span></div>${x.unread ? `<i class="cnt">${x.unread}</i>` : ""}</button>`).join("") : `<p class="hint" style="margin:0">No messages yet. Open Messages to write to the admin or to parents.</p>`}</div>`;
  }

  /* ── MY CLASSES (tap a class you are incharge of → its students) ── */
  let classOpen = null;
  function classes() {
    const inc = inchargeClasses(), mine = allMyClasses();
    if (!mine.length) { view.innerHTML = empty("fa-chalkboard", "No classes yet", "Your admin hasn't assigned classes to you."); return; }
    const incIdx = (c) => inc.findIndex((i) => norm(i.cls) === norm(c.cls) && (!i.section || norm(i.section) === norm(c.section)));
    if (classOpen != null && inc[classOpen]) return classDetail(inc[classOpen]);
    classOpen = null;
    view.innerHTML = `<div class="section-title">My classes</div>` + mine.map((c) => {
      const ix = incIdx(c), n = att.students ? studentsOf(c).length : null, subs = subjectsForClass(label(c));
      const inner = `<div class="class-badge">${esc(String(c.cls).replace(/class/i, "").trim().slice(0, 4) || "—")}</div>
        <div class="tx"><b>${esc(label(c))}</b><span>${esc(subs.join(" · ") || (hasPairs() ? "Class incharge" : "Subjects not set"))}${n == null ? "" : " · " + n + " students"}</span></div>
        ${ix >= 0 ? `<span class="pill amber"><i class="fas fa-star"></i> Incharge</span><i class="fas fa-chevron-right chev"></i>` : ""}`;
      return ix >= 0 ? `<button class="class-card tap" data-openclass="${ix}">${inner}</button>` : `<div class="class-card">${inner}</div>`;
    }).join("") + (inc.length ? `<p class="hint" style="margin:6px 4px 0"><i class="fas fa-circle-info"></i> Tap a class you are incharge of to see its students.</p>` : "");
  }
  function classDetail(c) {
    if (!att.students) { view.innerHTML = '<div class="skel"></div><div class="skel"></div>'; ensureStudents().then(() => current === "classes" && classes()); return; }
    const list = studentsOf(c).slice().sort((a, b) => a.name.localeCompare(b.name)), cnt = { present: 0, absent: 0, leave: 0 };
    list.forEach((s) => { if (att.saved[s.regNo]) cnt[att.saved[s.regNo]]++; });
    const marked = list.length && list.every((s) => att.saved[s.regNo]);
    const tag = { present: "P", absent: "A", leave: "L" };
    view.innerHTML = `<button class="back" data-classback="1"><i class="fas fa-arrow-left"></i> My classes</button>
      <div class="cl-head"><div class="class-badge">${esc(String(c.cls).replace(/class/i, "").trim().slice(0, 4) || "—")}</div><div><b>${esc(label(c))}</b><span>${list.length} student${list.length === 1 ? "" : "s"}${marked ? ` · Today: ${cnt.present} P · ${cnt.absent} A · ${cnt.leave} L` : " · Attendance not marked today"}</span></div></div>
      ${list.length > 6 ? `<div class="searchbox"><i class="fas fa-magnifying-glass"></i><input id="class-q" placeholder="Search name or reg no" autocomplete="off"></div>` : ""}
      ${list.length ? `<div class="slist">${list.map((s, i) => `<div class="srow" data-q="${esc((s.name + " " + s.regNo).toLowerCase())}"><span class="sn">${i + 1}</span><div class="sav">${esc(s.name.trim().charAt(0).toUpperCase())}</div>
        <div class="stx"><b>${esc(s.name)}</b><span>${esc(s.regNo)}${s.guardian ? " · " + esc(s.guardian) : ""}</span></div>${att.saved[s.regNo] ? `<i class="stt ${tag[att.saved[s.regNo]].toLowerCase()}">${tag[att.saved[s.regNo]]}</i>` : ""}<button class="srow-msg" data-msgparent="${esc(s.regNo)}" aria-label="Message parent"><i class="fas fa-comment-dots"></i></button></div>`).join("")}</div>`
        : empty("fa-user-graduate", "No students found", "No active students in " + esc(label(c)) + ".")}`;
  }

  /* Attendance is marked ONCE per day. After saving it is locked (the server enforces this too). */
  const unsaved = (list) => list.filter((s) => !att.saved[s.regNo]);
  const isMarkedToday = (list) => list.length > 0 && unsaved(list).length === 0;
  function saveBtnHtml(list) {
    if (isMarkedToday(list)) return `<button class="btn done" disabled><i class="fas fa-lock"></i> Attendance saved</button>`;
    return `<button class="btn" id="save-att"><i class="fas fa-floppy-disk"></i> Save attendance</button>`;
  }
  function refreshAttBar() {
    const list = classStudents(), c = counts(list);
    $("#c-p").textContent = c.present; $("#c-a").textContent = c.absent; $("#c-l").textContent = c.leave;
    const bar = $(".savebar"); if (bar) bar.innerHTML = saveBtnHtml(list);
  }
  function attendance() {
    const inc = inchargeClasses();
    if (!inc.length) { view.innerHTML = empty("fa-user-lock", "Not a class incharge", "Attendance is only available for the class you are incharge of."); return; }
    if (!att.students) { view.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>'; loadAttendanceData().then(() => current === "attendance" && attendance()); return; }
    const list = classStudents(), c = counts(list), marked = isMarkedToday(list), name = { present: "Present", absent: "Absent", leave: "Leave" };
    view.innerHTML = `
      ${inc.length > 1 ? `<div class="chips">${inc.map((x, i) => `<button class="chip ${i === att.cls ? "on" : ""}" data-cls="${i}">${esc(label(x))}</button>`).join("")}</div>` : ""}
      <div class="sumbar"><div class="p"><b id="c-p">${c.present}</b>Present</div><div class="a"><b id="c-a">${c.absent}</b>Absent</div><div class="l"><b id="c-l">${c.leave}</b>Leave</div></div>
      ${marked ? `<div class="att-note"><i class="fas fa-lock"></i> Today's attendance is saved and locked. If something is wrong, ask the admin to correct it.</div>` : ""}
      ${list.length ? `${unsaved(list).length ? `<div class="bulk"><button data-bulk="present"><i class="fas fa-check-double"></i> All Present</button><button data-bulk="absent">All Absent</button></div>` : ""}
      ${list.map((s, i) => att.saved[s.regNo]
        ? `<div class="stu locked" data-id="${esc(s.regNo)}"><div class="stu-no">${i + 1}</div><div class="stu-nm"><b>${esc(s.name)}</b><span>${esc(s.regNo)}</span></div><span class="st-badge ${att.saved[s.regNo][0]}">${name[att.saved[s.regNo]] || ""}</span></div>`
        : `<div class="stu" data-id="${esc(s.regNo)}"><div class="stu-no">${i + 1}</div><div class="stu-nm"><b>${esc(s.name)}</b><span>${esc(s.regNo)}</span></div>
        <div class="seg">${["present", "absent", "leave"].map((k) => `<button class="${k[0]} ${statusOf(s) === k ? "on" : ""}" data-set="${k}" aria-label="${k}">${k[0].toUpperCase()}</button>`).join("")}</div></div>`).join("")}
      <div class="savebar">${saveBtnHtml(list)}</div>`
      : empty("fa-user-graduate", "No students found", "No active students in " + esc(label(inc[att.cls])) + ".")}`;
  }

  /* Saving is instant on screen; the upload runs in the background and is retried if it fails. */
  let attPending = store.get("att_pending", []);
  let attFlushing = false;
  async function flushAttendance() {
    if (attFlushing) return; attFlushing = true;
    try {
      while (attPending.length) {
        try { await api("/attendance/save", { method: "POST", body: JSON.stringify(attPending[0]) }); }
        catch (e) { if (!/already marked/i.test(e.message || "")) throw e; /* server already has today's marks */ }
        attPending.shift(); store.set("att_pending", attPending);
      }
    } catch (e) { /* stays queued, retried on next save / refresh */ }
    attFlushing = false;
  }
  function saveAttendance() {
    const c = inchargeClasses()[att.cls], list = unsaved(classStudents());
    if (!list.length) return;
    if (!confirm("Save attendance for " + label(c) + "?\n\nIt cannot be changed afterwards.")) return;
    const payload = list.map((s) => ({ schoolId, memberId: s.regNo, memberName: s.name, memberType: "STUDENT", className: s.cls, section: s.section, date: today(), status: statusOf(s), reason: "" }));
    list.forEach((s) => { att.saved[s.regNo] = statusOf(s); });
    att.marks = {};
    attPending.push(payload); store.set("att_pending", attPending);
    attendance(); toast("Attendance saved for " + label(c));
    flushAttendance();
  }

  /* ── TESTS (paper test / quiz / class test …) ──
     Flow: teacher adds a test (own name, subject, total marks, syllabus) → it sits under "Upcoming"
     → open it to see every student of the class in a table → "Enter marks" → saved tests move to "Past". */
  const TYPES = ["Paper test", "Class test", "Quiz", "Monthly test", "Mid-term", "Final term", "Other"];
  const totalOf = (t) => +t.totalMarks || (t.questions ? qTotal(t) : 0);
  function newTestDraft() {
    const mc = subjectClasses(), subs = mc[0] ? subjectsForClass(label(mc[0])) : subjects();
    return { id: uid(), kind: TYPES[0], title: "", cls: mc[0] ? label(mc[0]) : "", subject: subs[0] || "", date: today(), totalMarks: "", passPct: 40, syllabus: "", results: {}, marked: false, created: Date.now() };
  }
  function startBuild() { qb = newTestDraft(); quizView = "build"; quizzes(); }
  function harvest() {
    if (!qb) return;
    view.querySelectorAll("[data-f]").forEach((el) => { qb[el.dataset.f] = el.value; });
  }
  function buildView() {
    const mc = subjectClasses(), subs = subjectsForClass(qb.cls);
    const clsOpts = mc.map((c) => `<option ${label(c) === qb.cls ? "selected" : ""}>${esc(label(c))}</option>`).join("");
    const subOpts = (subs.length ? subs : [qb.subject || "General"]).map((s) => `<option ${s === qb.subject ? "selected" : ""}>${esc(s)}</option>`).join("");
    return `
      <button class="back" data-qback="1"><i class="fas fa-arrow-left"></i> Back</button>
      <div class="card"><h2><i class="fas fa-file-circle-plus"></i> Add test / paper</h2>
        <div class="field"><label>Type</label><div class="chips wrap" style="margin:0">${TYPES.map((k) => `<button class="chip ${qb.kind === k ? "on" : ""}" data-qkind="${esc(k)}">${esc(k)}</button>`).join("")}</div></div>
        <div class="field"><label>Test name</label><input data-f="title" value="${esc(qb.title)}" placeholder="e.g. Chapter 3 – Fractions" maxlength="80"></div>
        <div class="two-col"><div class="field"><label>Class</label><select data-f="cls">${clsOpts || "<option>—</option>"}</select></div>
        <div class="field"><label>Subject</label><select data-f="subject">${subOpts}</select></div></div>
        <div class="two-col"><div class="field"><label>Total marks of paper</label><input type="number" inputmode="numeric" min="1" data-f="totalMarks" value="${esc(qb.totalMarks)}" placeholder="e.g. 50"></div>
        <div class="field"><label>Test date</label><input type="date" data-f="date" value="${esc(qb.date)}"></div></div>
        <div class="field"><label>Syllabus of the paper</label><textarea data-f="syllabus" rows="4" maxlength="600" placeholder="e.g. Chapters 3 & 4, exercises 3.1 – 4.2">${esc(qb.syllabus)}</textarea></div>
      </div>
      <div class="savebar"><button class="btn" id="save-test"><i class="fas fa-floppy-disk"></i> Add ${esc(qb.kind.toLowerCase())}</button></div>`;
  }
  function saveBuilt() {
    harvest();
    if (!qb.title.trim()) return toast("Enter the test name.", true);
    if (!qb.cls || qb.cls === "—") return toast("Choose a class.", true);
    if (!qb.subject) return toast("Choose the subject.", true);
    if (hasPairs() && subjectsForClass(qb.cls).indexOf(qb.subject) < 0) return toast("You don't teach " + qb.subject + " in " + qb.cls + ".", true);
    if (!(+qb.totalMarks > 0)) return toast("Enter the total marks of the paper.", true);
    qb.totalMarks = +qb.totalMarks;
    tests.push(qb); saveTests(); pushTest(qb); openTest = qb.id; qb = null; quizView = "list"; quizzes.tab = "upcoming"; toast("Added to Upcoming."); quizzes();
  }
  const isMarked = (t) => !!t.marked || (!t.totalMarks && resultsOf(t).length > 0);
  function quizzes() {
    if (quizView === "build" && qb) { view.innerHTML = buildView(); return; }
    const t = tests.find((x) => x.id === openTest);
    if (quizView === "detail" && t) { detailView(t); return; }
    quizView = "list";
    const tab = quizzes.tab || "upcoming";
    const up = tests.filter((x) => !isMarked(x)).sort((a, b) => new Date(a.date) - new Date(b.date));
    const past = tests.filter(isMarked).sort((a, b) => new Date(b.date) - new Date(a.date));
    const list = tab === "upcoming" ? up : past;
    view.innerHTML = `<button class="btn" data-newtest="1" style="margin-bottom:12px"><i class="fas fa-plus"></i> Add test / paper</button>
      <div class="seg two" style="margin-bottom:12px"><button class="${tab === "upcoming" ? "on t" : ""}" data-qtab="upcoming">Upcoming · ${up.length}</button><button class="${tab === "past" ? "on t" : ""}" data-qtab="past">Past · ${past.length}</button></div>
      ${list.length ? list.map((x) => { const st = testStats(x); return `<div class="class-card tcard" data-test="${x.id}"><div class="class-badge test"><i class="fas ${x.kind === "Quiz" ? "fa-bolt" : "fa-file-lines"}"></i></div>
        <div class="tx"><b>${esc(x.title)}</b><span>${esc(x.kind || "Test")} · ${esc(x.cls)} · ${esc(x.subject)}</span><span>${fmtDate(x.date)} · ${totalOf(x)} marks</span></div>
        ${isMarked(x) ? (st ? `<span class="pill teal">${Math.round(st.avg)}% avg</span>` : `<span class="pill teal">Done</span>`) : `<span class="pill amber">Marks pending</span>`}</div>`; }).join("")
        : empty(tab === "upcoming" ? "fa-file-pen" : "fa-clock-rotate-left", tab === "upcoming" ? "No upcoming tests" : "No past tests yet", tab === "upcoming" ? "Add a paper test or quiz with its subject, total marks and syllabus." : "Once you enter marks for a test it moves here.")}`;
  }
  function classOfTest(t) { return allMyClasses().find((c) => label(c) === t.cls) || { cls: t.cls.split(" - ")[0], section: (t.cls.split(" - ")[1] || "") }; }
  function detailView(t) {
    if (!att.students) { view.innerHTML = '<div class="skel"></div><div class="skel"></div>'; ensureStudents().then(() => current === "quizzes" && quizzes()); return; }
    const stu = studentsOf(classOfTest(t)).slice().sort((a, b) => a.name.localeCompare(b.name)), st = testStats(t), tot = totalOf(t);
    view.innerHTML = `<button class="back" data-qback="1"><i class="fas fa-arrow-left"></i> All tests</button>
      <div class="hero small"><small>${esc(t.kind || "Test")} · ${esc(t.subject)}</small><h2>${esc(t.title)}</h2>
        <span class="pill"><i class="fas fa-chalkboard"></i> ${esc(t.cls)}</span><span class="pill"><i class="fas fa-star"></i> ${tot} marks</span><span class="pill"><i class="fas fa-calendar"></i> ${fmtDate(t.date)}</span></div>
      ${t.syllabus ? `<div class="card syl"><h2><i class="fas fa-book-open"></i> Syllabus</h2><p>${esc(t.syllabus).replace(/\n/g, "<br>")}</p></div>` : ""}
      ${st ? `<div class="stats s4"><div class="stat"><i class="fas fa-chart-line"></i><b>${Math.round(st.avg)}%</b><span>Average</span></div><div class="stat green"><i class="fas fa-trophy"></i><b>${Math.round(st.hi)}%</b><span>Highest</span></div><div class="stat red"><i class="fas fa-arrow-down"></i><b>${Math.round(st.lo)}%</b><span>Lowest</span></div><div class="stat amber"><i class="fas fa-circle-check"></i><b>${st.pass}/${st.n}</b><span>Passed</span></div></div>` : ""}
      <div class="tbl-head"><div class="section-title" style="margin:0">Students · ${stu.length}</div>
        <button class="btn-mini" data-entermarks="${t.id}"><i class="fas fa-pen-to-square"></i> ${isMarked(t) ? "Edit marks" : "Enter marks"}</button></div>
      ${stu.length ? `<div class="tbl-wrap"><table class="mt"><thead><tr><th>#</th><th>Student</th><th>Marks</th><th>%</th></tr></thead><tbody>${stu.map((s, i) => { const r = (t.results || {})[s.regNo], pct = r && !r.absent ? (r.score / (tot || 1)) * 100 : null;
        return `<tr><td>${i + 1}</td><td><b>${esc(s.name)}</b><small>${esc(s.regNo)}</small></td><td>${r ? (r.absent ? `<span class="pill amber sm">Absent</span>` : `<b class="${pct >= (t.passPct || 40) ? "okc" : "badc"}">${r.score}</b> / ${tot}`) : `<span class="muted">—</span>`}</td><td>${pct == null ? "" : Math.round(pct) + "%"}</td></tr>`; }).join("")}</tbody></table></div>`
        : empty("fa-user-graduate", "No students found", "No active students in " + esc(t.cls) + ".")}
      <div class="bulk" style="margin-top:12px"><button data-csv="${t.id}"><i class="fas fa-file-csv"></i> Export</button><button data-deltest="${t.id}" style="color:var(--coral);background:var(--coral-100)"><i class="fas fa-trash"></i> Delete</button></div>`;
  }
  /* Marks entry sheet: one compact row per student */
  function openMarks(t) {
    const stu = studentsOf(classOfTest(t)).slice().sort((a, b) => a.name.localeCompare(b.name)), tot = totalOf(t);
    gradeCtx = { id: t.id, tot, vals: {}, abs: {} };
    stu.forEach((s) => { const r = (t.results || {})[s.regNo]; if (r) { gradeCtx.abs[s.regNo] = !!r.absent; if (!r.absent) gradeCtx.vals[s.regNo] = r.score; } });
    openSheet(`<div class="sheet-head"><div><b>${esc(t.title)}</b><span>${esc(t.subject)} · ${esc(t.cls)} · out of ${tot}</span></div><button class="icon-btn dark" data-close="1" aria-label="Close"><i class="fas fa-xmark"></i></button></div>
      <div class="mk-list">${stu.map((s, i) => `<div class="mk-row" data-reg="${esc(s.regNo)}"><span class="mk-no">${i + 1}</span><div class="mk-n"><b>${esc(s.name)}</b><small>${esc(s.regNo)}</small></div>
        <input type="number" inputmode="decimal" min="0" max="${tot}" step="0.5" class="mk-in" data-mk="${esc(s.regNo)}" value="${gradeCtx.vals[s.regNo] != null ? gradeCtx.vals[s.regNo] : ""}" placeholder="—" ${gradeCtx.abs[s.regNo] ? "disabled" : ""}>
        <button class="mk-abs ${gradeCtx.abs[s.regNo] ? "on" : ""}" data-abs="${esc(s.regNo)}">Abs</button></div>`).join("") || empty("fa-user-graduate", "No students", "")}</div>
      <div class="savebar" style="margin-bottom:0"><button class="btn" id="mk-save"><i class="fas fa-floppy-disk"></i> Save marks</button></div>`, "tall");
  }
  function saveMarks() {
    const t = tests.find((x) => x.id === gradeCtx.id); if (!t) return;
    const tot = gradeCtx.tot; t.results = {}; let bad = 0;
    document.querySelectorAll("#sheet-body [data-mk]").forEach((i) => {
      const reg = i.dataset.mk;
      if (gradeCtx.abs[reg]) { t.results[reg] = { absent: true, score: 0, at: Date.now() }; return; }
      if (i.value === "") return;
      const v = +i.value; if (isNaN(v) || v < 0 || v > tot) { bad++; return; }
      t.results[reg] = { absent: false, score: v, at: Date.now() };
    });
    if (bad) return toast(bad + " mark(s) are above " + tot + " or invalid.", true);
    if (!Object.keys(t.results).length) return toast("Enter at least one mark.", true);
    t.marked = true; saveTests(); pushTest(t); closeSheet(); gradeCtx = null;
    quizView = "list"; quizzes.tab = "past"; openTest = null; toast("Marks saved — moved to Past."); quizzes();
  }
  function exportCsv(t) {
    const tot = totalOf(t);
    const rows = [["Reg No", "Name", "Score", "Total", "Percent", "Grade", "Status"]].concat(studentsOf(classOfTest(t)).map((s) => { const r = (t.results || {})[s.regNo]; if (!r) return [s.regNo, s.name, "", tot, "", "", "Not marked"]; if (r.absent) return [s.regNo, s.name, "", tot, "", "", "Absent"]; const p = (r.score / (tot || 1)) * 100; return [s.regNo, s.name, r.score, tot, p.toFixed(1), gradeOf(p), p >= (t.passPct || 40) ? "Pass" : "Fail"]; }));
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = t.title.replace(/\W+/g, "_") + "_results.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  /* ── MESSAGES: real conversations ──
     • School notices  – broadcasts from the admin (read only)
     • Admin / Principal – two-way chat
     • Parents · <class> – your messages to the parents of a class (parent replies will land here once the parent portal is linked)
     Messages are saved on the phone first, then sent in the background (clock → tick), and retried if the network drops. */
  const enc = encodeURIComponent;
  const chat = { items: store.get("chat", []), thread: null, draft: {}, started: store.get("chat_started", []) };
  const saveChat = () => store.set("chat", chat.items.slice(-600));
  const chatUnread = () => chat.items.filter((m) => m.senderType !== "TEACHER" && !m.read).length;
  const fmtClock = (ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  function fmtWhen(ms) { const d = new Date(ms), n = new Date(), y = new Date(n); y.setDate(n.getDate() - 1); if (d.toDateString() === n.toDateString()) return fmtClock(ms); if (d.toDateString() === y.toDateString()) return "Yesterday"; return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  function dayLabel(ms) { const d = new Date(ms), n = new Date(), y = new Date(n); y.setDate(n.getDate() - 1); if (d.toDateString() === n.toDateString()) return "Today"; if (d.toDateString() === y.toDateString()) return "Yesterday"; return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
  function threadList() {
    const t = [{ key: "notices", kind: "notices", title: "School notices", sub: "Announcements from the admin", icon: "fa-bullhorn" },
      { key: "admin", kind: "chat", channel: "admin", className: "", title: "Admin / Principal", sub: "Direct chat with the admin", icon: "fa-user-tie" }];
    allMyClasses().forEach((c) => t.push({ key: "class:" + label(c), kind: "chat", channel: "class", className: label(c), title: "Parents · " + label(c), sub: "Your message goes to every parent of this class", icon: "fa-people-roof" }));
    // one private conversation per student's parent (started by the teacher, or opened by the parent later)
    const ppl = {};
    chat.started.forEach((s) => (ppl[s.regNo] = Object.assign({}, s)));
    chat.items.filter((m) => m.channel === "parent_teacher" && m.regNo).forEach((m) => { ppl[m.regNo] = Object.assign({ regNo: m.regNo }, ppl[m.regNo] || {}, { studentName: m.studentName || (ppl[m.regNo] || {}).studentName, guardianName: m.guardianName || (ppl[m.regNo] || {}).guardianName, className: m.className || (ppl[m.regNo] || {}).className }); });
    Object.keys(ppl).forEach((r) => { const s = ppl[r]; t.push({ key: "parent:" + r, kind: "chat", channel: "parent_teacher", className: s.className || "", regNo: r, title: "Parent of " + (s.studentName || r), sub: "Father/Guardian: " + (s.guardianName || "—") + " · " + r + (s.className ? " · " + s.className : ""), icon: "fa-user-group" }); });
    return t;
  }
  const msgsOf = (th) => chat.items.filter((m) => m.channel === th.channel && (th.channel === "admin" || (th.channel === "parent_teacher" ? m.regNo === th.regNo : m.className === th.className))).sort((a, b) => a.at - b.at);
  function threadInfo(th) {
    if (th.kind === "notices") {
      const list = prefs.receiveAdmin ? ann.received.slice().sort((a, b) => new Date(b.date) - new Date(a.date)) : [], l = list[0];
      return { last: l ? l.title : (prefs.receiveAdmin ? "No notices yet" : "Turned off in Profile"), at: l ? new Date(l.date).getTime() : 0, unread: prefs.receiveAdmin ? ann.received.filter((a) => !a.read).length : 0 };
    }
    const list = msgsOf(th), l = list[list.length - 1];
    return { last: l ? (l.senderType === "TEACHER" ? "You: " : "") + l.body : (th.channel === "admin" ? "Say hello to the admin" : "Write to the parents"), at: l ? l.at : 0, unread: list.filter((m) => m.senderType !== "TEACHER" && !m.read).length };
  }
  async function loadChat() {
    try {
      const list = await api("/messages?schoolId=" + enc(schoolId) + "&staffId=" + enc(staff.staffId || ""));
      if (!Array.isArray(list)) return;
      const localRead = {}; chat.items.forEach((m) => { if (m.read && m.id) localRead[m.id] = 1; });
      const server = list.map((x) => ({ id: x.id, clientId: x.clientId || "s" + x.id, channel: x.channel, className: x.className || "", regNo: x.regNo || "", studentName: x.studentName || "", guardianName: x.guardianName || "", senderType: x.senderType, senderName: x.senderName || "", body: x.body, at: Date.parse(x.createdAt) || 0, read: x.senderType === "TEACHER" ? true : (!!x.readByTeacher || !!localRead[x.id]), status: "sent" }));
      const have = {}; server.forEach((m) => (have[m.clientId] = 1));
      const pending = chat.items.filter((m) => m.senderType === "TEACHER" && m.status !== "sent" && !have[m.clientId]);
      chat.items = server.concat(pending); saveChat(); flushChat();
    } catch (e) { /* offline or endpoint not live — keep the cached copy */ }
    updateDot();
  }
  let chatFlushing = false;
  async function flushChat() {
    if (chatFlushing) return; chatFlushing = true;
    try {
      for (const m of chat.items.filter((x) => x.senderType === "TEACHER" && x.status === "sending")) {
        try {
          const r = await api("/messages", { method: "POST", body: JSON.stringify({ schoolId, staffId: staff.staffId, clientId: m.clientId, channel: m.channel, className: m.className, regNo: m.regNo || undefined, body: m.body }) });
          m.status = "sent"; if (r && r.id) m.id = r.id; if (r && r.createdAt) m.at = Date.parse(r.createdAt) || m.at;
        } catch (e) {
          if (e.message === "401") return;
          if (e instanceof TypeError || /^HTTP 5/.test(e.message || "")) break;           // network / server down: stay "sending", retry later
          m.status = "failed"; m.error = e.message;                                          // refused (limit, not your class…): let the teacher retry
        }
      }
    } finally { chatFlushing = false; saveChat(); if (current === "inbox") inbox(); }
  }
  function markRead(th) {
    if (th.kind === "notices") { if (ann.received.some((a) => !a.read)) { ann.received.forEach((a) => (a.read = true)); store.set("ann_in", ann.received); updateDot(); } return; }
    const un = msgsOf(th).filter((m) => m.senderType !== "TEACHER" && !m.read); if (!un.length) return;
    un.forEach((m) => (m.read = true)); saveChat(); updateDot();
    api("/messages/read", { method: "POST", body: JSON.stringify({ schoolId, staffId: staff.staffId, channel: th.channel, className: th.className, regNo: th.regNo || undefined }) }).catch(() => {});
  }
  function threadBodyHtml(th) {
    if (th.kind === "notices") {
      if (!prefs.receiveAdmin) return empty("fa-bell-slash", "Notices are off", "Turn them back on from Profile → Notifications.");
      const list = ann.received.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
      return list.length ? list.map((a) => `<div class="ncard ${a.priority === "urgent" ? "urgent" : ""}"><div class="n-top"><b>${esc(a.title)}</b>${a.priority === "urgent" ? `<span class="pill amber sm"><i class="fas fa-triangle-exclamation"></i> Urgent</span>` : ""}</div><p>${esc(a.body).replace(/\n/g, "<br>")}</p><small>${esc(a.from)} · ${dayLabel(new Date(a.date).getTime())}, ${fmtClock(new Date(a.date).getTime())}</small></div>`).join("")
        : empty("fa-bullhorn", "No notices yet", "When the admin posts a notice for teachers it will appear here.");
    }
    const list = msgsOf(th);
    if (!list.length) return empty(th.channel === "admin" ? "fa-comments" : "fa-people-roof", "No messages yet", th.channel === "admin" ? "Write below to start a chat with the admin." : th.channel === "parent_teacher" ? "Write below to message this student's parent privately." : "Write below to message the parents of " + esc(th.className) + ". Their replies will appear here once the parent portal is live.");
    let html = "", last = "";
    list.forEach((m) => {
      const dl = dayLabel(m.at); if (dl !== last) { html += `<div class="day-sep"><span>${dl}</span></div>`; last = dl; }
      const me = m.senderType === "TEACHER", ic = m.status === "sending" ? "fa-clock" : m.status === "failed" ? "fa-circle-exclamation" : "fa-check";
      html += `<div class="bub ${me ? "me" : "them"} ${m.status === "failed" ? "failed" : ""}" ${m.status === "failed" ? `data-retry="${esc(m.clientId)}"` : ""}>${me ? "" : `<small class="who">${esc(m.senderName || (m.senderType === "ADMIN" ? "Admin" : "Parent"))}</small>`}<p>${esc(m.body).replace(/\n/g, "<br>")}</p><span class="meta">${fmtClock(m.at)}${me ? ` <i class="fas ${ic}"></i>` : ""}${m.status === "failed" ? " · " + esc(m.error || "Not sent") + " · tap to retry" : ""}</span></div>`;
    });
    return html;
  }
  function inbox() {
    const th = chat.thread && threadList().find((t) => t.key === chat.thread);
    if (!th) {
      chat.thread = null; view.classList.remove("chat-mode");
      const rows = threadList().map((t) => Object.assign({ th: t }, threadInfo(t)));
      view.innerHTML = `<button class="btn" data-newparent="1" style="margin-bottom:10px;height:42px"><i class="fas fa-user-plus"></i> Message a parent</button><div class="thr-list">${rows.map((x) => `<button class="thr" data-thread="${esc(x.th.key)}"><div class="thr-ic ${x.th.kind}"><i class="fas ${x.th.icon}"></i></div><div class="thr-tx"><b>${esc(x.th.title)}</b><span>${esc(x.last)}</span></div><div class="thr-r"><small>${x.at ? fmtWhen(x.at) : ""}</small>${x.unread ? `<i class="cnt">${x.unread > 99 ? "99+" : x.unread}</i>` : ""}</div></button>`).join("")}</div>
        ${allMyClasses().length ? "" : `<p class="hint" style="margin:10px 4px"><i class="fas fa-circle-info"></i> Parent channels appear here once the admin assigns you a class.</p>`}`;
      return;
    }
    view.classList.add("chat-mode");
    const body = $("#chat-body");
    if (body && body.dataset.key === th.key && view.contains(body)) {           // already open: refresh the bubbles only (keeps the keyboard and draft)
      const near = body.scrollHeight - body.scrollTop - body.clientHeight < 90, top = body.scrollTop;
      body.innerHTML = threadBodyHtml(th); body.scrollTop = near && th.kind === "chat" ? body.scrollHeight : top;
      markRead(th); return;
    }
    view.innerHTML = `<div class="chat-wrap"><div class="chat-head"><button class="back-ic" data-chatback="1" aria-label="Back"><i class="fas fa-arrow-left"></i></button><div class="thr-ic ${th.kind}"><i class="fas ${th.icon}"></i></div><div class="ch-t"><b>${esc(th.title)}</b><span>${esc(th.sub)}</span></div></div>
      <div class="chat-body" id="chat-body" data-key="${esc(th.key)}">${threadBodyHtml(th)}</div>
      ${th.kind === "chat" ? `<div class="composer"><textarea id="chat-in" rows="1" maxlength="1000" placeholder="Message…">${esc(chat.draft[th.key] || "")}</textarea><button class="send" id="chat-send" aria-label="Send"><i class="fas fa-paper-plane"></i></button></div>` : `<div class="chat-note">Only the admin can post notices.</div>`}</div>`;
    const b = $("#chat-body"); if (b) b.scrollTop = th.kind === "chat" ? b.scrollHeight : 0;
    const ta = $("#chat-in"); if (ta) autoGrow(ta);
    markRead(th);
  }
  /* Pick any student from your classes → private chat with that student's parent */
  function parentPickRows(q) {
    const seen = {}, rows = [];
    allMyClasses().forEach((c) => studentsOf(c).forEach((s) => { if (!seen[s.regNo]) { seen[s.regNo] = 1; rows.push(s); } }));
    q = (q || "").trim().toLowerCase();
    return rows.filter((s) => !q || (s.name + " " + s.regNo + " " + (s.guardian || "")).toLowerCase().indexOf(q) >= 0).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60)
      .map((s) => `<button class="pp-row" data-pickparent="${esc(s.regNo)}"><div class="sav">${esc(s.name.trim().charAt(0).toUpperCase())}</div><div class="stx"><b>${esc(s.name)}</b><span>Father/Guardian: ${esc(s.guardian || "—")} · ${esc(s.regNo)} · ${esc(s.cls + (s.section ? " - " + s.section : ""))}</span></div></button>`).join("") || empty("fa-user-graduate", "No students found", "");
  }
  async function openParentPicker() {
    openSheet(`<div class="sheet-head"><div><b>Message a parent</b><span>Choose a student from your classes</span></div><button class="icon-btn dark" data-close="1" aria-label="Close"><i class="fas fa-xmark"></i></button></div>
      <div class="searchbox"><i class="fas fa-magnifying-glass"></i><input id="pp-q" placeholder="Student, guardian or reg no" autocomplete="off"></div><div class="pp-list" id="pp-list"><div class="skel"></div></div>`, "tall");
    await ensureStudents(); const l = $("#pp-list"); if (l) l.innerHTML = parentPickRows("");
  }
  function startParentChat(regNo) {
    let s = null; allMyClasses().forEach((c) => studentsOf(c).forEach((x) => { if (x.regNo === regNo) s = x; })); if (!s) return;
    if (!chat.started.some((x) => x.regNo === regNo)) { chat.started.push({ regNo, studentName: s.name, guardianName: s.guardian || "", className: s.cls + (s.section ? " - " + s.section : "") }); store.set("chat_started", chat.started); }
    closeSheet(); chat.thread = "parent:" + regNo; current === "inbox" ? inbox() : go("inbox");
  }
  function autoGrow(ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; }
  function sendChat() {
    const th = threadList().find((t) => t.key === chat.thread), ta = $("#chat-in");
    if (!th || th.kind !== "chat" || !ta) return;
    const body = ta.value.trim(); if (!body) return;
    chat.items.push({ id: null, clientId: uid(), channel: th.channel, className: th.className || "", regNo: th.regNo || "", studentName: th.title.replace(/^Parent of /, ""), senderType: "TEACHER", senderName: staff.name || "", body, at: Date.now(), read: true, status: "sending" });
    chat.draft[th.key] = ""; ta.value = ""; autoGrow(ta); saveChat(); inbox(); flushChat();
  }

  /* ── DIARY: class → subject → pictures → sent to the class's parents ── */
  const dz = { cls: "", subject: "", note: "", files: [], sending: false, list: store.get("diary", []), loaded: false, blobs: {} };
  async function apiForm(path, fd) {
    const res = await fetch(API + path, { method: "POST", headers: { Authorization: "Bearer " + session.token }, body: fd });
    if (res.status === 401) { auth.clearSession(); location.replace("index.html"); throw new Error("401"); }
    if (!res.ok) { const t = await res.text().catch(() => ""); let m = t; try { m = JSON.parse(t).error || t; } catch (e) { /* plain */ } throw new Error(m || "HTTP " + res.status); }
    return res.json().catch(() => ({}));
  }
  async function loadDiary() {
    try {
      const list = await api("/diary?schoolId=" + enc(schoolId) + "&staffId=" + enc(staff.staffId || ""));
      if (Array.isArray(list)) { dz.list = list; store.set("diary", list.slice(0, 40)); }
    } catch (e) { /* offline: show cached */ }
    dz.loaded = true;
  }
  function compressImage(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1400, k = Math.min(1, max / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k), c = document.createElement("canvas");
        c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? res(b) : rej(new Error("Could not read that picture"))), "image/jpeg", 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That file isn't a picture")); };
      img.src = url;
    });
  }
  async function addPhotos(fileList) {
    const room = 6 - dz.files.length; if (room <= 0) return toast("You can send up to 6 pictures.", true);
    const picked = Array.prototype.slice.call(fileList).slice(0, room);
    if (fileList.length > room) toast("Only 6 pictures per diary — extra ones skipped.", true);
    for (const f of picked) { try { const b = await compressImage(f); dz.files.push({ blob: b, url: URL.createObjectURL(b) }); } catch (e) { toast(e.message, true); } }
    if (current === "diary") diary();
  }
  async function sendDiary() {
    if (dz.sending) return;
    if (!dz.cls || !dz.subject) return toast("Choose the class and subject first.", true);
    if (!dz.files.length) return toast("Add at least one picture.", true);
    dz.sending = true; diary();
    try {
      const fd = new FormData();
      fd.append("schoolId", schoolId); fd.append("className", dz.cls); fd.append("subject", dz.subject); fd.append("note", dz.note.trim()); fd.append("date", today());
      dz.files.forEach((f, i) => fd.append("images", f.blob, "diary" + (i + 1) + ".jpg"));
      await apiForm("/diary", fd);
      dz.files.forEach((f) => URL.revokeObjectURL(f.url));
      const cls = dz.cls; dz.files = []; dz.note = ""; dz.subject = "";
      toast("Diary sent to the parents of " + cls); await loadDiary();
    } catch (e) { if (e.message !== "401") toast(e.message || "Could not send. Check your connection and try again.", true); }
    dz.sending = false; if (current === "diary") diary();
  }
  function diary() {
    const mc = subjectClasses();
    if (!mc.length) { view.innerHTML = empty("fa-book-open", "No classes yet", "Your admin hasn't assigned classes to you."); return; }
    if (!dz.cls || !mc.some((c) => label(c) === dz.cls)) { dz.cls = mc.length === 1 ? label(mc[0]) : ""; }
    const subs = dz.cls ? subjectsForClass(dz.cls) : [];
    if (dz.subject && subs.length && subs.indexOf(dz.subject) < 0) dz.subject = "";
    if (!dz.subject && subs.length === 1) dz.subject = subs[0];
    const ready = dz.cls && dz.subject;
    const step = (n, done, title, inner) => `<div class="card dstep"><h2><span class="sn2 ${done ? "ok" : ""}">${done ? '<i class="fas fa-check"></i>' : n}</span> ${title}</h2>${inner}</div>`;
    view.innerHTML = `
      ${step(1, !!dz.cls, "Class", `<div class="chips wrap" style="margin:0">${mc.map((c) => `<button class="chip ${label(c) === dz.cls ? "on" : ""}" data-dcls="${esc(label(c))}">${esc(label(c))}</button>`).join("")}</div>`)}
      ${dz.cls ? step(2, !!dz.subject, "Subject", subs.length ? `<div class="chips wrap" style="margin:0">${subs.map((s) => `<button class="chip ${s === dz.subject ? "on" : ""}" data-dsub="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : `<div class="field" style="margin:0"><input id="d-subj" maxlength="40" placeholder="Type the subject" value="${esc(dz.subject)}"></div>`) : ""}
      ${ready ? step(3, dz.files.length > 0, "Diary pictures", `
        <div class="thumbs">${dz.files.map((f, i) => `<div class="th"><img src="${f.url}" alt=""><button data-drm="${i}" aria-label="Remove"><i class="fas fa-xmark"></i></button></div>`).join("")}
          ${dz.files.length < 6 ? `<label class="th add"><input type="file" id="d-cam" accept="image/*" capture="environment" hidden><i class="fas fa-camera"></i><span>Camera</span></label><label class="th add"><input type="file" id="d-files" accept="image/*" multiple hidden><i class="fas fa-image"></i><span>Gallery</span></label>` : ""}</div>
        <div class="field" style="margin:12px 0 0"><label>Note for parents (optional)</label><textarea id="d-note" rows="2" maxlength="500" placeholder="e.g. Learn Q1–Q5 for tomorrow">${esc(dz.note)}</textarea></div>
        <button class="btn" id="d-send" style="margin-top:12px" ${dz.sending || !dz.files.length ? "disabled" : ""}>${dz.sending ? '<i class="fas fa-spinner fa-spin"></i> Sending…' : '<i class="fas fa-paper-plane"></i> Send to parents of ' + esc(dz.cls)}</button>`) : ""}
      <div class="section-title" style="margin-top:18px">Sent diary</div>
      ${dz.list.length ? dz.list.map((d) => `<div class="card dentry"><div class="de-top"><div><b>${esc(d.subject)}</b><span>${esc(d.className)} · ${esc(d.date || "")}</span></div><button class="icon-btn dark sm" data-ddel="${d.id}" aria-label="Delete"><i class="fas fa-trash"></i></button></div>
        ${d.note ? `<p>${esc(d.note)}</p>` : ""}<div class="thumbs sm">${Array.from({ length: d.imageCount || 0 }, (_, i) => `<img data-dimg="${d.id}:${i}" alt="" class="dimg">`).join("")}</div></div>`).join("")
        : `<p class="hint" style="margin:0 4px">Nothing sent yet.</p>`}`;
    hydrateThumbs();
  }
  async function diaryBlob(key) {
    if (dz.blobs[key]) return dz.blobs[key];
    const [id, idx] = key.split(":");
    const res = await fetch(API + "/diary/" + id + "/image/" + idx + "?schoolId=" + enc(schoolId), { headers: { Authorization: "Bearer " + session.token } });
    if (!res.ok) throw new Error("img"); return (dz.blobs[key] = URL.createObjectURL(await res.blob()));
  }
  function hydrateThumbs() { view.querySelectorAll("img[data-dimg]").forEach((im) => { diaryBlob(im.dataset.dimg).then((u) => (im.src = u)).catch(() => im.classList.add("broken")); }); }

  /* ── PROFILE + TEACHER ID CARD ── */
  function profile() {
    const kv = (k, v) => (v ? `<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>` : "");
    const inc = inchargeClasses();
    view.innerHTML = `
      <div class="profile-head"><div class="avatar">${staff.photo ? `<img src="${esc(staff.photo)}" alt="">` : esc(initials())}</div>
        <h2>${esc(staff.name || "Teacher")}</h2><p>${esc(staff.role || "Teacher")} · ${esc(staff.staffId || "")}</p></div>
      <div class="idmini"><div class="idmini-top"><div class="idmini-logo">${school.logo ? `<img src="${esc(school.logo)}" alt="">` : school.name ? esc(school.name.trim().charAt(0).toUpperCase()) : `<i class="fas fa-graduation-cap"></i>`}</div><div><small>Staff Identity Card</small><b>${esc(schoolName)}</b></div></div>
        <div class="idmini-name">${esc(staff.name || "Teacher")}<span>ID ${esc(staff.staffId || "—")}</span></div>
        <button class="btn light" data-card="1"><i class="fas fa-id-card"></i> View your teacher card</button></div>
      <div class="card"><h2><i class="fas fa-address-card"></i> Details</h2>
        ${kv("Staff ID", staff.staffId)}${kv("Role", staff.role)}${kv("Phone", staff.phone)}${kv("Gender", staff.gender)}${kv("CNIC", staff.cnic)}
        ${kv(staff.guardianType || "Guardian", staff.guardianName)}${kv("Address", staff.address)}${kv("Qualification", staff.qualification)}${kv("Joined", staff.joined)}</div>
      <div class="card"><h2><i class="fas fa-book"></i> Subjects</h2>${hasPairs()
        ? subjects().map((sb) => `<div class="kv"><span>${esc(sb)}</span><b>${esc(subjectPairs().filter((p) => p.subject === sb).map((p) => label({ cls: p.cls, section: p.section || "" })).join(", "))}</b></div>`).join("")
        : `<div class="tags">${subjects().map((s) => `<span class="pill teal">${esc(s)}</span>`).join("") || "<span style='color:var(--ink-faint)'>None assigned</span>"}</div>`}</div>
      <div class="card"><h2><i class="fas fa-chalkboard"></i> Classes</h2><div class="tags">${teachingClasses().map((c) => `<span class="pill teal">${esc(label(c))}</span>`).join("") || "<span style='color:var(--ink-faint)'>None assigned</span>"}
        ${inc.map((c) => `<span class="pill amber"><i class="fas fa-star"></i> ${esc(label(c))}</span>`).join("")}</div></div>
      <div class="card"><h2><i class="fas fa-bell"></i> Notifications</h2>
        <label class="switch"><span><b>Admin messages</b><small>Receive messages the admin sends to teachers</small></span><input type="checkbox" id="pref-admin" ${prefs.receiveAdmin ? "checked" : ""}><i class="sw"></i></label></div>
      <div class="card"><h2><i class="fas fa-lock"></i> Password</h2>
        ${session.passwordChanged
          ? `<p class="hint"><i class="fas fa-circle-check"></i> You've changed your password. To change it again, ask your admin to reset it.</p>`
          : pwOpen
            ? `<div class="field"><label>Current password</label><input type="password" id="pw-cur" autocomplete="current-password" placeholder="Default password from admin"></div>
               <div class="field"><label>New password</label><input type="password" id="pw-new" autocomplete="new-password" placeholder="At least 6 characters"></div>
               <div class="field"><label>Confirm new password</label><input type="password" id="pw-new2" autocomplete="new-password"></div>
               <p class="hint warn"><i class="fas fa-triangle-exclamation"></i> You can only change your password once.</p>
               <button class="btn" id="pw-save"><i class="fas fa-check"></i> Save new password</button>`
            : `<p class="hint">You can change your password <b>one time</b>.</p><button class="btn ghost" data-pw="open"><i class="fas fa-key"></i> Change password</button>`}
      </div>
      <button class="btn out" id="logout"><i class="fas fa-right-from-bracket"></i> Sign out</button>`;
  }
  /* Same staff ID card as Staff Management (blue .sidc-card, front = QR, back = school contact + barcode) */
  function barcodeSvg(text) {
    const VIEW_H = 60, QUIET = 10, str = String(text || "").trim() || "0";
    let binary = "";
    try { if (window.JsBarcode) { const out = {}; JsBarcode(out, str, { format: "CODE128" }); binary = out.encodings.map((e) => e.data).join(""); } } catch (e) { /* fallback below */ }
    if (binary) {
      let bars = "", i = 0;
      while (i < binary.length) { if (binary[i] === "1") { let j = i; while (j < binary.length && binary[j] === "1") j++; bars += `<rect x="${QUIET + i}" y="0" width="${j - i}" height="${VIEW_H}" fill="#000"/>`; i = j; } else i++; }
      return `<svg viewBox="0 0 ${binary.length + QUIET * 2} ${VIEW_H}" preserveAspectRatio="none" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
    }
    let seed = 0, x = 0, bars = ""; for (let k = 0; k < str.length; k++) seed = (seed * 131 + str.charCodeAt(k) + 7) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    while (x < 480) { const w = 2 + Math.floor(rnd() * 6); if (rnd() > 0.42) bars += `<rect x="${x}" y="0" width="${w}" height="${VIEW_H}" fill="#0f172a"/>`; x += w; }
    return `<svg viewBox="0 0 480 ${VIEW_H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
  }
  function cardFace(side) {
    const logoInner = school.logo ? `<img src="${esc(school.logo)}" alt="Logo" crossorigin="anonymous">` : `<i class="fas fa-graduation-cap"></i>`;
    const id = staff.staffId || "—", designation = staff.role || "Teacher";
    const head = (lbl) => `<div class="sidc-card-header"><div class="sidc-card-logo">${logoInner}</div><div class="sidc-card-header-text"><div class="sidc-card-school-name">${esc(schoolName)}</div><div class="sidc-card-doc-label">${lbl}</div></div></div>`;
    if (side === "front") return `<div class="sidc-card" id="card-front">${head("Staff Identity Card")}
      <div class="sidc-card-body"><div class="sidc-card-photo">${staff.photo ? `<img src="${esc(staff.photo)}" alt="" crossorigin="anonymous">` : `<i class="fas fa-user"></i>`}</div>
        <div class="sidc-card-info"><div class="sidc-card-name">${esc(staff.name || "—")}</div><span class="sidc-card-idbadge">ID: ${esc(id)}</span>
          <div class="sidc-card-rows">
            <div class="sidc-card-row"><span class="sidc-label">Designation:</span><span class="sidc-value">${esc(designation)}</span></div>
            <div class="sidc-card-row"><span class="sidc-label">Department:</span><span class="sidc-value">Teaching</span></div>
            <div class="sidc-card-row"><span class="sidc-label">CNIC:</span><span class="sidc-value">${esc(staff.cnic || "—")}</span></div>
            <div class="sidc-card-row"><span class="sidc-label">Contact:</span><span class="sidc-value">${esc(staff.phone || "—")}</span></div>
            <div class="sidc-card-row sidc-row-clamp"><span class="sidc-label">Address:</span><span class="sidc-value sidc-value-clamp">${esc(staff.address || "—")}</span></div></div></div></div>
      <div class="sidc-card-barcode-wrap"><div class="sidc-card-barcode-label">Scan for Attendance</div><div class="sidc-card-front-qr-box" id="tc-qr"><i class="fas fa-qrcode sidc-card-front-qr-fallback"></i></div><div class="sidc-card-barcode-text">${esc(id)}</div></div></div>`;
    const phone = school.phone || school.contact || "Not set in Settings", addr = school.address || "Not set in Settings";
    return `<div class="sidc-card sidc-card-back" id="card-back">${head("School Contact &amp; Attendance")}
      <div class="sidc-card-back-body"><div class="sidc-back-contact-col">
        <div class="sidc-back-section-label">School Address</div><div class="sidc-back-line"><i class="fas fa-map-marker-alt"></i><span>${esc(addr)}</span></div>
        <div class="sidc-back-section-label" style="margin-top:2px">Contact Number</div><div class="sidc-back-line"><i class="fas fa-phone"></i><span>${esc(phone)}</span></div>
        <div class="sidc-back-note">If found, please return this card to the school address above. This card remains the property of ${esc(schoolName)}.</div></div></div>
      <div class="sidc-card-barcode-wrap"><div class="sidc-card-barcode-label">Scan for Attendance</div>${barcodeSvg(id)}<div class="sidc-card-barcode-text">${esc(id)}</div></div>
      <div class="sidc-software-brand"><span class="sidc-software-logo">S</span><span>Powered by <strong>SoftSchool</strong></span></div></div>`;
  }
  function openCard() {
    openSheet(`<div class="sheet-head"><div><b>Your teacher card</b><span>Issued by ${esc(schoolName)}</span></div><button class="icon-btn dark" data-close="1" aria-label="Close"><i class="fas fa-xmark"></i></button></div>
      <div class="cards-row">${cardFace("front")}${cardFace("back")}</div>
      <div class="card-actions"><button class="btn" id="card-print"><i class="fas fa-print"></i> Print</button><button class="btn ghost" id="card-share"><i class="fas fa-share-nodes"></i> Share</button></div>
      <button class="link center" id="card-dl"><i class="fas fa-download"></i> Save as image</button>`, "tall");
    try { if (window.QRCode) { const box = $("#tc-qr"); box.innerHTML = ""; new QRCode(box, { text: String(staff.staffId || ""), width: 100, height: 100, correctLevel: QRCode.CorrectLevel.M }); } } catch (e) { /* QR optional */ }
  }
  async function snap(id) {
    if (!window.html2canvas) throw new Error("Image tools didn't load. Check your connection.");
    return html2canvas(document.getElementById(id), { scale: 3, backgroundColor: null, useCORS: true });
  }
  const blobOf = (cv) => new Promise((r) => cv.toBlob(r, "image/png"));
  async function cardPrint() {
    const w = window.open("", "_blank"); if (!w) return toast("Allow pop-ups to print.", true);
    w.document.write("<p style='font-family:sans-serif'>Preparing…</p>");
    try {
      const f = (await snap("card-front")).toDataURL("image/png"), b = (await snap("card-back")).toDataURL("image/png");
      w.document.open(); w.document.write(`<!doctype html><title>Teacher card — ${esc(staff.name)}</title><style>@page{size:A4;margin:12mm}body{margin:0;display:flex;gap:10mm;flex-wrap:wrap;justify-content:center}img{width:54mm;height:86mm;border:.2mm dashed #999;border-radius:3mm}</style><img src="${f}"><img src="${b}"><script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>`); w.document.close();
    } catch (e) { w.close(); toast(e.message || "Could not prepare the card.", true); }
  }
  async function cardShare() {
    try {
      const blob = await blobOf(await snap("card-front")), file = new File([blob], "teacher-card-" + (staff.staffId || "id") + ".png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Teacher ID card", text: (staff.name || "Teacher") + " — " + schoolName }); return; }
      if (navigator.share) { await navigator.share({ title: "Teacher ID card", text: (staff.name || "Teacher") + " · ID " + (staff.staffId || "") + " · " + schoolName }); return; }
      cardDownload(); toast("Sharing isn't supported here — image saved instead.");
    } catch (e) { if (e && e.name !== "AbortError") toast(e.message || "Could not share.", true); }
  }
  async function cardDownload() {
    try { for (const id of ["card-front", "card-back"]) { const cv = await snap(id), a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = "teacher-" + id + "-" + (staff.staffId || "id") + ".png"; a.click(); } }
    catch (e) { toast(e.message || "Could not save the image.", true); }
  }
  async function changePassword() {
    const cur = $("#pw-cur").value, nw = $("#pw-new").value, nw2 = $("#pw-new2").value;
    if (!cur || !nw) return toast("Fill in all password fields.", true);
    if (nw.length < 6) return toast("New password must be at least 6 characters.", true);
    if (nw !== nw2) return toast("New passwords don't match.", true);
    if (nw === cur) return toast("New password must be different.", true);
    if (!confirm("You can only change your password once. Continue?")) return;
    const btn = $("#pw-save"); btn.disabled = true;
    try {
      await api("/staff/change-password?schoolId=" + encodeURIComponent(schoolId), {
        method: "POST", body: JSON.stringify({ staffId: staff.staffId, currentPassword: cur, newPassword: nw })
      });
      session.passwordChanged = true; auth.updateSession({ passwordChanged: true });
      pwOpen = false; profile(); toast("Password changed.");
    } catch (e) { if (e.message !== "401") toast(e.message || "Could not change password.", true); btn.disabled = false; }
  }


  /* ── Navigation ── */
  const TITLES = { home: "Home", classes: "My Classes", attendance: "Attendance", diary: "Diary", quizzes: "Tests & Quizzes", inbox: "Messages", profile: "My Profile" };
  const VIEWS = { home, classes, attendance, diary, quizzes, inbox, profile };
  let current = "home";
  function go(tab) {
    if (current === "quizzes" && tab !== "quizzes" && quizView === "build") harvest();
    current = tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    $("#btn-profile").classList.toggle("on", tab === "profile");
    view.classList.remove("chat-mode");
    $("#page-title").textContent = TITLES[tab];
    view.scrollTop = 0; view.style.animation = "none"; void view.offsetWidth; view.style.animation = "";
    VIEWS[tab]();
    if (tab === "diary" && !dz.loaded) loadDiary().then(() => current === "diary" && diary());
    if (["home", "classes", "quizzes", "diary"].includes(tab) && !att.students && !att.loading) ensureStudents().then(() => current === tab && VIEWS[tab]());
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => { if (t.dataset.tab === "quizzes") quizView = "list"; if (t.dataset.tab === "inbox") chat.thread = null; if (t.dataset.tab === "classes") classOpen = null; go(t.dataset.tab); }));
  $("#btn-profile").addEventListener("click", () => go("profile"));

  view.addEventListener("click", (e) => {
    const th = e.target.closest("[data-thread]"); if (th) { chat.thread = th.dataset.thread; return current === "inbox" ? inbox() : go("inbox"); }
    const rt = e.target.closest("[data-retry]"); if (rt) { const m = chat.items.find((x) => x.clientId === rt.dataset.retry); if (m) { m.status = "sending"; m.error = ""; saveChat(); inbox(); flushChat(); } return; }
    const tt = e.target.closest("[data-test]"); if (tt && !e.target.closest("button[data-go]")) { openTest = tt.dataset.test; quizView = "detail"; return go("quizzes"); }
    const im = e.target.closest("img[data-dimg]"); if (im && im.src) { openSheet(`<div class="sheet-head"><div><b>Diary picture</b></div><button class="icon-btn dark" data-close="1" aria-label="Close"><i class="fas fa-xmark"></i></button></div><img src="${im.src}" alt="" class="fullimg">`, "tall"); return; }
    const t = e.target.closest("button"); if (!t) return;
    const d = t.dataset;
    if (d.go) return go(d.go);
    if (d.card) return openCard();
    if (d.newtest) { go("quizzes"); return startBuild(); }
    if (d.cls) { att.cls = +d.cls; return attendance(); }
    if (d.set) { att.marks[t.closest(".stu").dataset.id] = d.set; t.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === t)); return refreshAttBar(); }
    if (d.bulk) { unsaved(classStudents()).forEach((s) => (att.marks[s.regNo] = d.bulk)); return attendance(); }
    if (d.pw) { pwOpen = true; return profile(); }
    if (t.id === "pw-save") return changePassword();
    if (t.id === "save-att") return saveAttendance();
    if (t.id === "logout") { auth.clearSession(); location.replace("index.html"); }
    /* tests */
    if (d.qtab) { quizzes.tab = d.qtab; return quizzes(); }
    if (d.entermarks) { const tt2 = tests.find((x) => x.id === d.entermarks); return tt2 && openMarks(tt2); }
    if (d.qback) { quizView = "list"; qb = null; openTest = null; return quizzes(); }
    if (d.qkind) { harvest(); qb.kind = d.qkind; return quizzes(); }
    if (t.id === "save-test") return saveBuilt();
    if (d.csv) return exportCsv(tests.find((x) => x.id === d.csv));
    if (d.deltest) { if (confirm("Delete this test and all its marks?")) { tests = tests.filter((x) => x.id !== d.deltest); saveTests(); pendingPut = pendingPut.filter((x) => x !== d.deltest); pendingDel.push(d.deltest); savePending(); flushTests(); quizView = "list"; quizzes(); toast("Deleted."); } return; }
    /* messages */
    if (d.newparent != null) return openParentPicker();
    if (d.msgparent != null) return startParentChat(d.msgparent);
    if (d.chatback != null) { chat.thread = null; return inbox(); }
    if (t.id === "chat-send") return sendChat();
    /* classes */
    if (d.openclass != null) { classOpen = +d.openclass; return classes(); }
    if (d.classback != null) { classOpen = null; return classes(); }
    /* diary */
    if (d.dcls != null) { dz.cls = d.dcls; dz.subject = ""; return diary(); }
    if (d.dsub != null) { dz.subject = d.dsub; return diary(); }
    if (d.drm != null) { const f = dz.files.splice(+d.drm, 1)[0]; if (f) URL.revokeObjectURL(f.url); return diary(); }
    if (t.id === "d-send") return sendDiary();
    if (d.ddel != null) { if (confirm("Delete this diary entry? Parents will no longer see it.")) { const id = d.ddel; api("/diary/" + enc(id) + "?schoolId=" + enc(schoolId), { method: "DELETE" }).then(() => { dz.list = dz.list.filter((x) => String(x.id) !== String(id)); store.set("diary", dz.list.slice(0, 40)); if (current === "diary") diary(); toast("Deleted."); }).catch((e) => e.message !== "401" && toast(e.message || "Could not delete.", true)); } return; }
    /* home to-do */
    if (t.id === "todo-add") return addTodo();
    if (d.deltodo != null) { const l = store.get("todos", []); l.splice(+d.deltodo, 1); store.set("todos", l); return home(); }
  });
  function addTodo() { const i = $("#todo-in"), v = i.value.trim(); if (!v) return; const l = store.get("todos", []); l.push({ text: v, done: false }); store.set("todos", l.slice(-20)); home(); }
  view.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "todo-in") addTodo();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.id === "chat-in") { e.preventDefault(); sendChat(); }
  });
  view.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "chat-in") { chat.draft[chat.thread] = t.value; autoGrow(t); }
    else if (t.id === "d-note") dz.note = t.value;
    else if (t.id === "d-subj") { dz.subject = t.value.trim(); const b = $("#d-send"); }
    else if (t.id === "class-q") { const q = t.value.trim().toLowerCase(); view.querySelectorAll(".srow").forEach((r) => (r.hidden = !!q && r.dataset.q.indexOf(q) < 0)); }
  });
  view.addEventListener("focusout", (e) => { if (e.target.id === "d-subj" && current === "diary") diary(); });
  view.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.todo != null) { const l = store.get("todos", []); if (l[+t.dataset.todo]) l[+t.dataset.todo].done = t.checked; store.set("todos", l); return home(); }
    if (t.dataset.f === "cls" && qb) { harvest(); const ok = subjectsForClass(qb.cls); if (hasPairs() && ok.indexOf(qb.subject) < 0) qb.subject = ok[0] || ""; return quizzes(); }
    if (t.id === "d-files" || t.id === "d-cam") { const fl = t.files; if (fl && fl.length) addPhotos(fl); t.value = ""; return; }
    if (t.id === "pref-admin") { prefs.receiveAdmin = t.checked; store.set("prefs", prefs); updateDot(); toast(t.checked ? "Admin messages on." : "Admin messages off."); }
  });
  $("#sheet-body").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "card-print") return cardPrint();
    if (b.id === "card-share") return cardShare();
    if (b.id === "card-dl") return cardDownload();
    if (b.id === "mk-save") return saveMarks();
    if (b.dataset.pickparent) return startParentChat(b.dataset.pickparent);
    if (gradeCtx && b.dataset.abs) {
      const reg = b.dataset.abs, on = !gradeCtx.abs[reg]; gradeCtx.abs[reg] = on; b.classList.toggle("on", on);
      const inp = b.parentElement.querySelector(".mk-in"); inp.disabled = on; if (on) inp.value = ""; else inp.focus();
    }
  });
  $("#sheet-body").addEventListener("input", (e) => { if (e.target.id === "pp-q") { const l = $("#pp-list"); if (l) l.innerHTML = parentPickRows(e.target.value); } });
  $("#sheet-body").addEventListener("input", (e) => {
    const i = e.target; if (!gradeCtx || i.dataset.mk == null) return;
    if (+i.value > gradeCtx.tot) i.classList.add("over"); else i.classList.remove("over");
  });

  $("#page-date").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  updateDot();
  go("home");
  flushAttendance();
  loadSchoolInfo().then(() => { if (current === "home" || current === "profile") VIEWS[current](); });
  if (inchargeClasses().length) loadAttendanceData().then(() => current === "home" && home());
  loadTests().then(() => { if (current === "quizzes" && quizView === "list") quizzes(); else if (current === "home") home(); });
  loadAnnouncements().then(() => { if (current === "home") home(); else if (current === "inbox") inbox(); });
  loadChat().then(() => { if (current === "home") home(); else if (current === "inbox") inbox(); });

  /* ── Live sync: no reload button. Data re-syncs automatically every few seconds, when the app
        comes back to the foreground or the network returns, and the screen updates only if something
        actually changed — and never while the teacher is typing, marking or has a sheet open. ── */
  const LIVE_MS = 8000;
  let syncing = false, stale = false;
  const liveSig = () => JSON.stringify([ann.received.map((a) => [a.id, a.title, a.body, a.date]), chat.items.map((m) => [m.id, m.status, m.read]), dz.list.map((d) => d.id), att.saved, att.students ? att.students.length : -1, tests.map((t) => [t.id, t.marked, Object.keys(t.results || {}).length]), school.name, school.logo ? school.logo.length : 0]);
  function userBusy() {
    const a = document.activeElement;
    if (!$("#sheet").hidden) return true;
    if (current === "inbox" && chat.thread) return false;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && (view.contains(a))) return true;
    if (current === "quizzes" && quizView !== "list") return true;
    if (current === "profile" || current === "diary") return true;
    if (current === "inbox" && chat.thread) return false;                 // thread updates in place, never steals the keyboard
    if (current === "attendance" && Object.keys(att.marks).length) return true;
    return false;
  }
  function rerender() { const y = view.scrollTop; VIEWS[current](); view.scrollTop = y; }
  async function liveSync() {
    if (syncing || document.hidden) return;
    syncing = true;
    const before = liveSig();
    try {
      await flushAttendance();
      await Promise.all([att.students || inchargeClasses().length ? loadAttendanceData(true) : null, loadAnnouncements(), loadChat(), loadTests(), loadSchoolInfo()]);
    } catch (e) { /* retried on the next tick */ }
    syncing = false;
    if (liveSig() !== before) stale = true;
    if (stale && !userBusy()) { stale = false; rerender(); }
  }
  setInterval(() => { if (stale && !userBusy() && !document.hidden) { stale = false; rerender(); } else liveSync(); }, LIVE_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) liveSync(); });
  window.addEventListener("online", liveSync);
  window.addEventListener("focus", liveSync);
})();
