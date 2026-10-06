/* Teacher Portal — Home · Classes · Attendance · Tests · Notices · Profile (+ ID card) */
(function () {
  "use strict";
  const API = "https://167-86-120-247.sslip.io/api";
  const auth = window.SoftSchoolTeacher;
  const session = auth && auth.getSession();
  if (!session || !session.token) { location.replace("index.html"); return; }

  const staff = session.staff || {};
  const schoolId = session.schoolId;
  const school = session.school || {};
  const schoolName = school.name || "My School";
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

  /* ── School branding (logo + name replace the SoftSchool mark) ── */
  document.title = "Teacher Portal | " + schoolName;
  (function brand() {
    const el = $("#school-logo");
    if (school.logo) { const img = new Image(); img.alt = schoolName; img.src = school.logo; img.onerror = () => fallback(); el.appendChild(img); }
    else fallback();
    function fallback() { el.innerHTML = ""; el.textContent = schoolName.trim().charAt(0).toUpperCase(); el.classList.add("letter"); }
  })();

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
  const initials = () => String(staff.name || "T").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  /* ── Attendance state ── */
  const att = { students: null, saved: {}, cls: 0, marks: {}, loading: false };
  async function loadAttendanceData() {
    att.loading = true;
    try {
      const [stu, logs] = await Promise.all([
        api("/students/summary?schoolId=" + encodeURIComponent(schoolId)),
        api("/attendance/students?date=" + today() + "&schoolId=" + encodeURIComponent(schoolId))
      ]);
      att.students = (Array.isArray(stu) ? stu : []).filter((s) => !s.status || s.status === "active").map((s) => ({
        regNo: s.regNo, name: s.fullName || "Unknown", cls: s.studentClass || "", section: s.section || "A"
      }));
      att.saved = {};
      (Array.isArray(logs) ? logs : []).forEach((l) => { if (l.memberId) att.saved[l.memberId] = l.status || "absent"; });
      att.marks = {};
    } catch (e) { if (e.message !== "401") toast("Could not load attendance data.", true); att.students = att.students || []; }
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

  /* ── Sheet (bottom modal) ── */
  function openSheet(html, cls) { const b = $("#sheet-body"); b.className = "sheet" + (cls ? " " + cls : ""); b.innerHTML = html; $("#sheet").hidden = false; b.scrollTop = 0; document.body.style.overflow = "hidden"; }
  function closeSheet() { $("#sheet").hidden = true; $("#sheet-body").innerHTML = ""; document.body.style.overflow = ""; }
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet" || e.target.closest("[data-close]")) closeSheet(); });

  /* ── Announcements store (received + sent). Backend endpoints are TODO — see api* helpers ── */
  const ann = { received: store.get("ann_in", []), sent: store.get("ann_out", []), tab: "in", loaded: false };
  const prefs = Object.assign({ receiveAdmin: true }, store.get("prefs", {}));
  const unread = () => (prefs.receiveAdmin ? ann.received.filter((a) => !a.read).length : 0);
  function updateDot() { const n = unread(); const d = $("#inbox-dot"); d.hidden = !n; d.textContent = n > 9 ? "9+" : n; }
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
  async function syncOutbox() {
    for (const m of ann.sent.filter((x) => x.status === "queued")) {
      try { await api("/announcements/teacher", { method: "POST", body: JSON.stringify({ schoolId, staffId: staff.staffId, staffName: staff.name, audience: m.audience, className: m.cls, title: m.title, body: m.body, priority: m.priority }) }); m.status = "sent"; } catch (e) { break; }
    }
    store.set("ann_out", ann.sent);
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
      try { await api("/teacher-tests/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(Object.assign({ schoolId }, t)) }); pendingPut = pendingPut.filter((x) => x !== id); } catch (e) { if (e.message === "401") return; break; }
    }
    for (const id of pendingDel.slice()) {
      try { await api("/teacher-tests/" + encodeURIComponent(id) + "?schoolId=" + encodeURIComponent(schoolId), { method: "DELETE" }); pendingDel = pendingDel.filter((x) => x !== id); } catch (e) { if (e.message === "401") return; break; }
    }
    savePending();
  }
  function pushTest(t) { if (pendingPut.indexOf(t.id) < 0) pendingPut.push(t.id); savePending(); flushTests(); }
  async function loadTests() {
    try {
      const list = await api("/teacher-tests?schoolId=" + encodeURIComponent(schoolId));
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
  const qTotal = (t) => t.questions.reduce((a, q) => a + (+q.marks || 0), 0);
  const gradeOf = (p) => (p >= 90 ? "A+" : p >= 80 ? "A" : p >= 70 ? "B" : p >= 60 ? "C" : p >= 50 ? "D" : "F");
  function scoreSheet(t, r) {
    let got = 0;
    t.questions.forEach((q) => { const a = r.answers[q.id]; if (q.kind === "mcq") { if (a != null && +a === +q.answer) got += +q.marks || 0; } else got += Math.min(+a || 0, +q.marks || 0); });
    return got;
  }
  const resultsOf = (t) => Object.keys(t.results || {}).map((k) => Object.assign({ reg: k }, t.results[k]));
  function testStats(t) {
    const res = resultsOf(t).filter((r) => !r.absent), tot = qTotal(t) || 1;
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
        <button class="link" data-go="attendance">${marked ? "Review" : "Mark now"} <i class="fas fa-arrow-right"></i></button></div></div>`;
    }
    const strength = att.students && mine.length ? `<div class="card"><h2><i class="fas fa-users"></i> Class strength</h2>${mine.map((c) => { const n = studentsOf(c).length, mx = Math.max.apply(null, mine.map((x) => studentsOf(x).length).concat([1])); return `<div class="bar-row"><span>${esc(label(c))}</span><div class="bar"><i style="width:${(n / mx) * 100}%"></i></div><b>${n}</b></div>`; }).join("")}</div>` : "";
    const news = prefs.receiveAdmin ? ann.received.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3) : [];
    const newsCard = `<div class="card"><h2><i class="fas fa-bullhorn"></i> Latest notices <button class="link r" data-go="inbox">All</button></h2>${news.length ? news.map(noticeRow).join("") : `<p class="hint" style="margin:0">${prefs.receiveAdmin ? "No announcements from admin yet." : "Admin announcements are switched off in Profile."}</p>`}</div>`;
    const recent = tests.slice().sort((a, b) => b.created - a.created).slice(0, 2);
    const testCard = `<div class="card"><h2><i class="fas fa-file-pen"></i> Tests & quizzes <button class="link r" data-go="quizzes">All</button></h2>${recent.length ? recent.map((t) => { const st = testStats(t); return `<div class="row" data-test="${t.id}" style="cursor:pointer"><div class="ic"><i class="fas ${t.type === "quiz" ? "fa-bolt" : "fa-file-lines"}"></i></div><div class="tx"><b>${esc(t.title)}</b><span>${esc(t.cls)} · ${esc(t.subject)}</span></div>${st ? `<span class="pill teal">${Math.round(st.avg)}% avg</span>` : `<span class="pill amber">Not checked</span>`}</div>`; }).join("") : `<p class="hint" style="margin:0 0 10px">Create your first quiz or test in a minute.</p><button class="btn ghost sm" style="margin:0" data-newtest="1"><i class="fas fa-plus"></i> New test</button>`}</div>`;
    const todos = store.get("todos", []);
    const todoCard = `<div class="card"><h2><i class="fas fa-list-check"></i> My to-do</h2>
      ${todos.map((t, i) => `<label class="todo ${t.done ? "done" : ""}"><input type="checkbox" data-todo="${i}" ${t.done ? "checked" : ""}><span>${esc(t.text)}</span><button data-deltodo="${i}" aria-label="Delete"><i class="fas fa-xmark"></i></button></label>`).join("")}
      <div class="todo-add"><input id="todo-in" placeholder="Add a reminder…" maxlength="80"><button class="icon-btn dark" id="todo-add" aria-label="Add"><i class="fas fa-plus"></i></button></div></div>`;

    view.innerHTML = `
      <div class="hero"><small>${greet},</small><h2>${esc((staff.name || "Teacher").split(" ")[0])}</h2>
        <div class="hero-school">${esc(schoolName)}</div>
        <span class="pill"><i class="fas fa-id-badge"></i> ${esc(staff.staffId || "")}</span>
        ${inc.length ? `<span class="pill"><i class="fas fa-star"></i> Incharge ${esc(label(inc[0]))}</span>` : ""}</div>
      ${weekStrip()}
      <div class="qa">
        ${inc.length ? `<button data-go="attendance"><i class="fas fa-clipboard-check"></i><span>Attendance</span></button>` : ""}
        <button data-newtest="1"><i class="fas fa-file-circle-plus"></i><span>New test</span></button>
        <button data-go="inbox"><i class="fas fa-bullhorn"></i><span>Notices</span></button>
        <button data-card="1"><i class="fas fa-id-card"></i><span>ID card</span></button>
      </div>
      <div class="stats s4">
        <div class="stat"><i class="fas fa-chalkboard"></i><b>${teach.length}</b><span>Classes</span></div>
        <div class="stat amber"><i class="fas fa-book"></i><b>${subjects().length}</b><span>Subjects</span></div>
        <div class="stat blue"><i class="fas fa-user-graduate"></i><b>${stuCount == null ? "—" : stuCount}</b><span>Students</span></div>
        <div class="stat violet"><i class="fas fa-file-pen"></i><b>${tests.length}</b><span>Tests</span></div>
      </div>
      ${attCard}
      ${session.passwordChanged ? "" : `<div class="card nudge"><div class="row"><div class="ic"><i class="fas fa-key"></i></div><div class="tx"><b>Secure your account</b><span>You're using the default password. Change it once from Profile.</span></div></div><button class="btn sm" data-go="profile">Change password</button></div>`}
      ${newsCard}${testCard}${strength}${todoCard}`;
  }
  function noticeRow(a) {
    return `<div class="row notice ${a.read ? "" : "new"}" data-notice="${esc(a.id)}"><div class="ic ${a.priority === "urgent" ? "urgent" : ""}"><i class="fas ${a.priority === "urgent" ? "fa-triangle-exclamation" : "fa-bullhorn"}"></i></div><div class="tx"><b>${esc(a.title)}</b><span>${esc(a.from)} · ${fmtDate(a.date)}</span></div>${a.read ? "" : `<i class="udot"></i>`}</div>`;
  }
  function classes() {
    const teach = teachingClasses(), inc = inchargeClasses(), subs = subjects();
    if (!teach.length && !inc.length) { view.innerHTML = empty("fa-chalkboard", "No classes yet", "Your admin hasn't assigned classes to you."); return; }
    const isInc = (c) => inc.some((i) => norm(i.cls) === norm(c.cls) && (!i.section || norm(i.section) === norm(c.section)));
    view.innerHTML = `<div class="section-title">Classes I teach</div>` + teach.map((c) => `
      <div class="class-card"><div class="class-badge">${esc(String(c.cls).replace(/class/i, "").trim().slice(0, 4) || "—")}</div>
        <div class="tx"><b>${esc(label(c))}</b><span>${esc(subs.join(" · ") || "Subjects not set")}</span></div>
        ${isInc(c) ? `<span class="pill amber"><i class="fas fa-star"></i> Incharge</span>` : ""}</div>`).join("") +
      (inc.some((i) => !teach.some((t) => norm(t.cls) === norm(i.cls))) ? `<div class="section-title">Incharge of</div>` +
        inc.filter((i) => !teach.some((t) => norm(t.cls) === norm(i.cls))).map((c) => `<div class="class-card"><div class="class-badge"><i class="fas fa-star"></i></div><div class="tx"><b>${esc(label(c))}</b><span>Class incharge</span></div></div>`).join("") : "");
  }

  function attendance() {
    const inc = inchargeClasses();
    if (!inc.length) { view.innerHTML = empty("fa-user-lock", "Not a class incharge", "Attendance is only available for the class you are incharge of."); return; }
    if (!att.students) { view.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>'; loadAttendanceData().then(() => current === "attendance" && attendance()); return; }
    const list = classStudents(), c = counts(list);
    view.innerHTML = `
      ${inc.length > 1 ? `<div class="chips">${inc.map((x, i) => `<button class="chip ${i === att.cls ? "on" : ""}" data-cls="${i}">${esc(label(x))}</button>`).join("")}</div>` : ""}
      <div class="sumbar"><div class="p"><b id="c-p">${c.present}</b>Present</div><div class="a"><b id="c-a">${c.absent}</b>Absent</div><div class="l"><b id="c-l">${c.leave}</b>Leave</div></div>
      ${list.length ? `<div class="bulk"><button data-bulk="present"><i class="fas fa-check-double"></i> All Present</button><button data-bulk="absent">All Absent</button></div>
      ${list.map((s, i) => `<div class="stu" data-id="${esc(s.regNo)}"><div class="stu-top"><div class="stu-no">${i + 1}</div><div><b>${esc(s.name)}</b><span>${esc(s.regNo)}</span></div></div>
        <div class="seg">${["present", "absent", "leave"].map((k) => `<button class="${k[0]} ${statusOf(s) === k ? "on" : ""}" data-set="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div></div>`).join("")}
      <div class="savebar"><button class="btn" id="save-att"><i class="fas fa-floppy-disk"></i> Save Attendance</button></div>`
      : empty("fa-user-graduate", "No students found", "No active students in " + esc(label(inc[att.cls])) + ".")}`;
  }

  async function saveAttendance() {
    const btn = $("#save-att"), c = inchargeClasses()[att.cls], list = classStudents();
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    try {
      await api("/attendance/save", { method: "POST", body: JSON.stringify(list.map((s) => ({
        schoolId, memberId: s.regNo, memberName: s.name, memberType: "STUDENT",
        className: s.cls, section: s.section, date: today(), status: statusOf(s), reason: ""
      }))) });
      list.forEach((s) => (att.saved[s.regNo] = statusOf(s)));
      toast("Attendance saved for " + label(c));
    } catch (e) { if (e.message !== "401") toast("Save failed. Try again.", true); }
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save Attendance';
  }


  /* ── TESTS / QUIZZES ── */
  function newQuestion(kind) { return { id: uid(), kind, text: "", options: ["", "", "", ""], answer: 0, marks: kind === "mcq" ? 1 : 5 }; }
  function startBuild() {
    const mc = allMyClasses(), subs = subjects();
    qb = { id: uid(), type: "quiz", title: "", cls: mc[0] ? label(mc[0]) : "", subject: subs[0] || "", date: today(), duration: 20, passPct: 40, questions: [newQuestion("mcq")], results: {}, created: Date.now() };
    quizView = "build"; quizzes();
  }
  function harvest() {
    if (!qb) return;
    view.querySelectorAll("[data-f]").forEach((el) => { const f = el.dataset.f; qb[f] = el.type === "number" ? +el.value : el.value; });
    view.querySelectorAll(".qcard").forEach((card, i) => {
      const q = qb.questions[i]; if (!q) return;
      q.text = card.querySelector(".q-text").value;
      q.marks = +card.querySelector(".q-marks").value || 0;
      if (q.kind === "mcq") { q.options = Array.prototype.map.call(card.querySelectorAll(".q-opt"), (o) => o.value); const ck = card.querySelector("input[type=radio]:checked"); q.answer = ck ? +ck.value : 0; }
    });
  }
  function buildView() {
    const mc = allMyClasses(), subs = subjects();
    const clsOpts = mc.map((c) => `<option ${label(c) === qb.cls ? "selected" : ""}>${esc(label(c))}</option>`).join("");
    const subOpts = (subs.length ? subs : [qb.subject || "General"]).map((s) => `<option ${s === qb.subject ? "selected" : ""}>${esc(s)}</option>`).join("");
    return `
      <button class="back" data-qback="1"><i class="fas fa-arrow-left"></i> Back</button>
      <div class="card"><h2><i class="fas fa-pen-ruler"></i> Setup</h2>
        <div class="seg two" style="margin-bottom:14px"><button class="${qb.type === "quiz" ? "on t" : ""}" data-qtype="quiz"><i class="fas fa-bolt"></i> Quiz</button><button class="${qb.type === "test" ? "on t" : ""}" data-qtype="test"><i class="fas fa-file-lines"></i> Test</button></div>
        <div class="field"><label>Title</label><input data-f="title" value="${esc(qb.title)}" placeholder="e.g. Chapter 3 – Fractions" maxlength="80"></div>
        <div class="two-col"><div class="field"><label>Class</label><select data-f="cls">${clsOpts || "<option>—</option>"}</select></div>
        <div class="field"><label>Subject</label><select data-f="subject">${subOpts}</select></div></div>
        <div class="two-col three"><div class="field"><label>Date</label><input type="date" data-f="date" value="${esc(qb.date)}"></div>
        <div class="field"><label>Minutes</label><input type="number" min="1" data-f="duration" value="${qb.duration}"></div>
        <div class="field"><label>Pass %</label><input type="number" min="1" max="100" data-f="passPct" value="${qb.passPct}"></div></div>
      </div>
      <div class="section-title">Questions · ${qb.questions.length} · ${qTotal(qb)} marks</div>
      ${qb.questions.map((q, i) => `<div class="card qcard"><div class="q-head"><b>Q${i + 1} · ${q.kind === "mcq" ? "Multiple choice" : "Short / long answer"}</b><button class="icon-btn dark sm" data-delq="${i}" aria-label="Remove"><i class="fas fa-trash"></i></button></div>
        <div class="field"><textarea class="q-text" rows="2" placeholder="Type the question…">${esc(q.text)}</textarea></div>
        ${q.kind === "mcq" ? q.options.map((o, k) => `<label class="opt"><input type="radio" name="ans${i}" value="${k}" ${q.answer === k ? "checked" : ""}><span class="ltr">${"ABCD"[k]}</span><input class="q-opt" value="${esc(o)}" placeholder="Option ${"ABCD"[k]}"></label>`).join("") + `<p class="hint" style="margin:4px 0 8px"><i class="fas fa-circle-check"></i> Select the correct option.</p>` : ""}
        <div class="field" style="margin:0;max-width:130px"><label>Marks</label><input class="q-marks" type="number" min="0" value="${q.marks}"></div></div>`).join("")}
      <div class="bulk"><button data-addq="mcq"><i class="fas fa-list-ul"></i> Add MCQ</button><button data-addq="short"><i class="fas fa-align-left"></i> Add short</button></div>
      <div class="savebar"><button class="btn" id="save-test"><i class="fas fa-floppy-disk"></i> Save ${qb.type}</button></div>`;
  }
  function saveBuilt() {
    harvest();
    if (!qb.title.trim()) return toast("Give your " + qb.type + " a title.", true);
    if (!qb.cls || qb.cls === "—") return toast("Choose a class.", true);
    for (let i = 0; i < qb.questions.length; i++) {
      const q = qb.questions[i];
      if (!q.text.trim()) return toast("Question " + (i + 1) + " is empty.", true);
      if (q.kind === "mcq" && q.options.filter((o) => o.trim()).length < 2) return toast("Question " + (i + 1) + " needs at least 2 options.", true);
      if (q.kind === "mcq" && !q.options[q.answer].trim()) return toast("Q" + (i + 1) + ": correct option is blank.", true);
    }
    tests.push(qb); saveTests(); pushTest(qb); openTest = qb.id; qb = null; quizView = "detail"; toast("Saved."); quizzes();
  }
  function quizzes() {
    if (quizView === "build" && qb) { view.innerHTML = buildView(); return; }
    const t = tests.find((x) => x.id === openTest);
    if (quizView === "detail" && t) { detailView(t); return; }
    quizView = "list";
    const f = quizzes.filter || "all", list = tests.filter((x) => f === "all" || x.type === f).sort((a, b) => b.created - a.created);
    view.innerHTML = `<button class="btn" data-newtest="1" style="margin-bottom:14px"><i class="fas fa-plus"></i> Create quiz / test</button>
      <div class="chips">${["all", "quiz", "test"].map((k) => `<button class="chip ${f === k ? "on" : ""}" data-qf="${k}">${k === "all" ? "All" : k === "quiz" ? "Quizzes" : "Tests"}</button>`).join("")}</div>
      ${list.length ? list.map((x) => { const st = testStats(x); return `<div class="class-card tcard" data-test="${x.id}"><div class="class-badge ${x.type}"><i class="fas ${x.type === "quiz" ? "fa-bolt" : "fa-file-lines"}"></i></div>
        <div class="tx"><b>${esc(x.title)}</b><span>${esc(x.cls)} · ${esc(x.subject)} · ${x.questions.length} Qs · ${qTotal(x)} marks</span><span>${fmtDate(x.date)} · ${x.duration} min</span></div>
        ${st ? `<span class="pill teal">${Math.round(st.avg)}%</span>` : `<span class="pill amber">To check</span>`}</div>`; }).join("")
        : empty("fa-file-pen", "No " + (f === "all" ? "tests" : f + "s") + " yet", "Build a quiz with multiple-choice and written questions, then mark your students' papers here.")}`;
  }
  function detailView(t) {
    const cl = allMyClasses().find((c) => label(c) === t.cls) || { cls: t.cls.split(" - ")[0], section: (t.cls.split(" - ")[1] || "") };
    const stu = studentsOf(cl), st = testStats(t), tot = qTotal(t);
    if (!att.students) { view.innerHTML = '<div class="skel"></div><div class="skel"></div>'; ensureStudents().then(() => current === "quizzes" && quizzes()); return; }
    const ranked = stu.map((s) => ({ s, r: (t.results || {})[s.regNo] })).sort((a, b) => ((b.r && !b.r.absent ? b.r.score : -1) - (a.r && !a.r.absent ? a.r.score : -1)));
    view.innerHTML = `<button class="back" data-qback="1"><i class="fas fa-arrow-left"></i> All tests</button>
      <div class="hero small"><small>${t.type === "quiz" ? "Quiz" : "Test"} · ${esc(t.subject)}</small><h2>${esc(t.title)}</h2>
        <span class="pill"><i class="fas fa-chalkboard"></i> ${esc(t.cls)}</span><span class="pill"><i class="fas fa-star"></i> ${tot} marks</span><span class="pill"><i class="fas fa-clock"></i> ${t.duration} min</span></div>
      ${st ? `<div class="stats s4"><div class="stat"><i class="fas fa-chart-line"></i><b>${Math.round(st.avg)}%</b><span>Average</span></div><div class="stat green"><i class="fas fa-trophy"></i><b>${Math.round(st.hi)}%</b><span>Highest</span></div><div class="stat red"><i class="fas fa-arrow-down"></i><b>${Math.round(st.lo)}%</b><span>Lowest</span></div><div class="stat amber"><i class="fas fa-circle-check"></i><b>${st.pass}/${st.n}</b><span>Passed</span></div></div>` : ""}
      <div class="section-title">Check papers · ${resultsOf(t).length}/${stu.length} done</div>
      ${stu.length ? ranked.map((x, i) => { const r = x.r, pct = r && !r.absent ? (r.score / (tot || 1)) * 100 : null; return `<div class="stu res" data-grade="${esc(x.s.regNo)}"><div class="stu-top"><div class="stu-no">${i + 1}</div><div style="flex:1"><b>${esc(x.s.name)}</b><span>${esc(x.s.regNo)}</span></div>
        ${r ? (r.absent ? `<span class="pill amber">Absent</span>` : `<div class="score ${pct >= t.passPct ? "ok" : "bad"}"><b>${r.score}/${tot}</b><span>${gradeOf(pct)}</span></div>`) : `<span class="pill teal"><i class="fas fa-pen"></i> Check</span>`}</div></div>`; }).join("")
        : empty("fa-user-graduate", "No students found", "No active students in " + esc(t.cls) + ".")}
      <div class="bulk" style="margin-top:6px"><button data-csv="${t.id}"><i class="fas fa-file-csv"></i> Export results</button><button data-deltest="${t.id}" style="color:var(--coral);background:var(--coral-100)"><i class="fas fa-trash"></i> Delete</button></div>`;
  }
  function openGrade(t, reg) {
    const cl = allMyClasses().find((c) => label(c) === t.cls) || { cls: t.cls.split(" - ")[0], section: (t.cls.split(" - ")[1] || "") };
    const stu = studentsOf(cl), s = stu.find((x) => x.regNo === reg); if (!s) return;
    const prev = (t.results || {})[reg] || { answers: {}, absent: false };
    gradeCtx = { id: t.id, reg, answers: Object.assign({}, prev.answers), absent: !!prev.absent, next: (stu[stu.findIndex((x) => x.regNo === reg) + 1] || {}).regNo };
    renderGrade(t, s);
  }
  function renderGrade(t, s) {
    const g = gradeCtx, tot = qTotal(t), sc = scoreSheet(t, { answers: g.answers });
    openSheet(`<div class="sheet-head"><div><b>${esc(s.name)}</b><span>${esc(s.regNo)} · ${esc(t.title)}</span></div><button class="icon-btn dark" data-close="1" aria-label="Close"><i class="fas fa-xmark"></i></button></div>
      <label class="absent-sw"><input type="checkbox" id="g-absent" ${g.absent ? "checked" : ""}> Student was absent</label>
      <div class="${g.absent ? "dim" : ""}">${t.questions.map((q, i) => `<div class="gq"><div class="gq-t"><b>Q${i + 1}.</b> ${esc(q.text)} <em>${q.marks} mark${q.marks == 1 ? "" : "s"}</em></div>
        ${q.kind === "mcq" ? `<div class="gopts">${q.options.map((o, k) => o.trim() ? `<button class="gopt ${g.answers[q.id] != null && +g.answers[q.id] === k ? (k === +q.answer ? "right" : "wrong") : ""} ${k === +q.answer ? "key" : ""}" data-gq="${q.id}" data-gk="${k}"><span class="ltr">${"ABCD"[k]}</span>${esc(o)}</button>` : "").join("")}</div>`
          : `<div class="field" style="margin:0"><label>Marks awarded (max ${q.marks})</label><input type="number" min="0" max="${q.marks}" step="0.5" data-gm="${q.id}" value="${g.answers[q.id] != null ? esc(g.answers[q.id]) : ""}" placeholder="0"></div>`}</div>`).join("")}</div>
      <div class="gtotal"><span>Total</span><b id="g-total">${g.absent ? "—" : sc + " / " + tot}</b></div>
      <div class="two-col" style="margin-top:12px"><button class="btn ghost" style="margin:0" id="g-save">Save</button><button class="btn" style="margin:0" id="g-next" ${g.next ? "" : "disabled"}>Save & next <i class="fas fa-arrow-right"></i></button></div>`, "tall");
  }
  function saveGrade(goNext) {
    const t = tests.find((x) => x.id === gradeCtx.id); if (!t) return;
    const abs = $("#g-absent").checked;
    document.querySelectorAll("[data-gm]").forEach((i) => { if (i.value !== "") gradeCtx.answers[i.dataset.gm] = Math.min(+i.value || 0, +t.questions.find((q) => q.id === i.dataset.gm).marks); else delete gradeCtx.answers[i.dataset.gm]; });
    t.results = t.results || {};
    t.results[gradeCtx.reg] = { answers: gradeCtx.answers, absent: abs, score: abs ? 0 : scoreSheet(t, { answers: gradeCtx.answers }), at: Date.now() };
    saveTests(); pushTest(t); const nxt = gradeCtx.next; closeSheet(); toast("Saved."); quizzes();
    if (goNext && nxt) openGrade(t, nxt);
  }
  function exportCsv(t) {
    const cl = allMyClasses().find((c) => label(c) === t.cls) || { cls: t.cls.split(" - ")[0], section: (t.cls.split(" - ")[1] || "") }, tot = qTotal(t);
    const rows = [["Reg No", "Name", "Score", "Total", "Percent", "Grade", "Status"]].concat(studentsOf(cl).map((s) => { const r = (t.results || {})[s.regNo]; if (!r) return [s.regNo, s.name, "", tot, "", "", "Not checked"]; if (r.absent) return [s.regNo, s.name, "", tot, "", "", "Absent"]; const p = (r.score / (tot || 1)) * 100; return [s.regNo, s.name, r.score, tot, p.toFixed(1), gradeOf(p), p >= t.passPct ? "Pass" : "Fail"]; }));
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = t.title.replace(/\W+/g, "_") + "_results.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  /* ── NOTICES (receive from admin · send area) ── */
  const AUD = { admin: "Admin / Principal", class: "My class — students & parents", teachers: "All teachers" };
  let compose = { audience: "admin", cls: "", priority: "normal" };
  function inbox() {
    const t = ann.tab, mine = allMyClasses();
    if (!compose.cls && mine[0]) compose.cls = label(mine[0]);
    let body = "";
    if (t === "in") {
      const list = ann.received.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
      body = !prefs.receiveAdmin ? empty("fa-bell-slash", "Admin announcements are off", "Turn them back on from Profile → Notifications.")
        : list.length ? list.map(noticeRow).join("") : empty("fa-bullhorn", "No announcements yet", "When your admin posts a notice for teachers, it will show up here.");
    } else if (t === "send") {
      body = `<div class="card"><h2><i class="fas fa-paper-plane"></i> New message</h2>
        <div class="field"><label>Send to</label><div class="chips wrap">${Object.keys(AUD).map((k) => `<button class="chip ${compose.audience === k ? "on" : ""}" data-aud="${k}">${AUD[k]}</button>`).join("")}</div></div>
        ${compose.audience === "class" ? `<div class="field"><label>Class</label><select id="c-cls">${mine.map((c) => `<option ${label(c) === compose.cls ? "selected" : ""}>${esc(label(c))}</option>`).join("")}</select></div>` : ""}
        <div class="field"><label>Priority</label><div class="seg two"><button class="${compose.priority === "normal" ? "on t" : ""}" data-prio="normal">Normal</button><button class="${compose.priority === "urgent" ? "on a" : ""}" data-prio="urgent">Urgent</button></div></div>
        <div class="field"><label>Title</label><input id="c-title" maxlength="80" placeholder="Subject"></div>
        <div class="field"><label>Message</label><textarea id="c-body" rows="5" maxlength="1000" placeholder="Write your announcement, request or note…"></textarea></div>
        <button class="btn" id="c-send"><i class="fas fa-paper-plane"></i> Send</button>
        <p class="hint" style="margin:12px 0 0"><i class="fas fa-circle-info"></i> Sending is being connected to the school server. Messages are saved on this device and delivered automatically once it's live.</p></div>`;
    } else {
      const list = ann.sent.slice().sort((a, b) => b.at - a.at);
      body = list.length ? list.map((m) => `<div class="card sent"><div class="sent-top"><b>${esc(m.title)}</b><span class="pill ${m.status === "sent" ? "teal" : "amber"}">${m.status === "sent" ? "Delivered" : "Queued"}</span></div><p>${esc(m.body)}</p><small>To ${esc(AUD[m.audience])}${m.audience === "class" ? " · " + esc(m.cls) : ""} · ${fmtDate(m.at)}${m.priority === "urgent" ? " · Urgent" : ""}</small></div>`).join("")
        : empty("fa-paper-plane", "Nothing sent yet", "Messages you send will be listed here.");
    }
    view.innerHTML = `<div class="seg three">${[["in", "Received", unread()], ["send", "Send", 0], ["out", "Sent", 0]].map((x) => `<button class="${ann.tab === x[0] ? "on t" : ""}" data-atab="${x[0]}">${x[1]}${x[2] ? ` <i class="cnt">${x[2]}</i>` : ""}</button>`).join("")}</div><div style="height:14px"></div>${body}`;
  }
  function openNotice(id) {
    const a = ann.received.find((x) => x.id === id); if (!a) return;
    a.read = true; store.set("ann_in", ann.received); updateDot();
    openSheet(`<div class="sheet-head"><div><b>${esc(a.title)}</b><span>${esc(a.from)} · ${new Date(a.date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></div><button class="icon-btn dark" data-close="1" aria-label="Close"><i class="fas fa-xmark"></i></button></div>${a.priority === "urgent" ? `<span class="pill amber" style="margin-bottom:10px"><i class="fas fa-triangle-exclamation"></i> Urgent</span>` : ""}<p class="notice-body">${esc(a.body).replace(/\n/g, "<br>")}</p>`);
    if (current === "inbox") inbox(); else if (current === "home") home();
  }
  function sendMessage() {
    const title = $("#c-title").value.trim(), body = $("#c-body").value.trim();
    if (!title || !body) return toast("Add a title and a message.", true);
    ann.sent.push({ id: uid(), audience: compose.audience, cls: compose.cls, priority: compose.priority, title, body, at: Date.now(), status: "queued" });
    store.set("ann_out", ann.sent); ann.tab = "out"; inbox(); toast("Message saved & queued.");
    syncOutbox().then(() => current === "inbox" && inbox());
  }

  /* ── PROFILE + TEACHER ID CARD ── */
  function profile() {
    const kv = (k, v) => (v ? `<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>` : "");
    const inc = inchargeClasses();
    view.innerHTML = `
      <div class="profile-head"><div class="avatar">${staff.photo ? `<img src="${esc(staff.photo)}" alt="">` : esc(initials())}</div>
        <h2>${esc(staff.name || "Teacher")}</h2><p>${esc(staff.role || "Teacher")} · ${esc(staff.staffId || "")}</p></div>
      <div class="idmini"><div class="idmini-top"><div class="idmini-logo">${school.logo ? `<img src="${esc(school.logo)}" alt="">` : esc(schoolName.charAt(0))}</div><div><small>Staff Identity Card</small><b>${esc(schoolName)}</b></div></div>
        <div class="idmini-name">${esc(staff.name || "Teacher")}<span>ID ${esc(staff.staffId || "—")}</span></div>
        <button class="btn light" data-card="1"><i class="fas fa-id-card"></i> View your teacher card</button></div>
      <div class="card"><h2><i class="fas fa-address-card"></i> Details</h2>
        ${kv("Staff ID", staff.staffId)}${kv("Role", staff.role)}${kv("Phone", staff.phone)}${kv("Gender", staff.gender)}${kv("CNIC", staff.cnic)}
        ${kv(staff.guardianType || "Guardian", staff.guardianName)}${kv("Address", staff.address)}${kv("Qualification", staff.qualification)}${kv("Joined", staff.joined)}</div>
      <div class="card"><h2><i class="fas fa-book"></i> Subjects</h2><div class="tags">${subjects().map((s) => `<span class="pill teal">${esc(s)}</span>`).join("") || "<span style='color:var(--ink-faint)'>None assigned</span>"}</div></div>
      <div class="card"><h2><i class="fas fa-chalkboard"></i> Classes</h2><div class="tags">${teachingClasses().map((c) => `<span class="pill teal">${esc(label(c))}</span>`).join("") || "<span style='color:var(--ink-faint)'>None assigned</span>"}
        ${inc.map((c) => `<span class="pill amber"><i class="fas fa-star"></i> ${esc(label(c))}</span>`).join("")}</div></div>
      <div class="card"><h2><i class="fas fa-bell"></i> Notifications</h2>
        <label class="switch"><span><b>Admin announcements</b><small>Receive notices the admin sends to teachers</small></span><input type="checkbox" id="pref-admin" ${prefs.receiveAdmin ? "checked" : ""}><i class="sw"></i></label></div>
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
  function cardFace(side) {
    const logo = school.logo ? `<img src="${esc(school.logo)}" alt="" crossorigin="anonymous">` : `<span>${esc(schoolName.charAt(0))}</span>`;
    const head = `<div class="tc-head"><div class="tc-logo">${logo}</div><div><b>${esc(schoolName)}</b><small>Staff Identity Card</small></div></div>`;
    if (side === "front") return `<div class="tcard-face" id="card-front">${head}
      <div class="tc-photo">${staff.photo ? `<img src="${esc(staff.photo)}" alt="" crossorigin="anonymous">` : `<i class="fas fa-user"></i>`}</div>
      <div class="tc-name">${esc(staff.name || "Teacher")}</div><div class="tc-badge">ID: ${esc(staff.staffId || "—")}</div>
      <div class="tc-rows"><div><span>Designation</span><b>${esc(staff.role || "Teacher")}</b></div><div><span>CNIC</span><b>${esc(staff.cnic || "—")}</b></div><div><span>Contact</span><b>${esc(staff.phone || "—")}</b></div><div><span>Address</span><b class="clamp">${esc(staff.address || "—")}</b></div></div>
      <div class="tc-qr"><div id="tc-qr"></div><small>Scan for attendance</small></div></div>`;
    return `<div class="tcard-face" id="card-back">${head}
      <div class="tc-terms"><b>This card is property of ${esc(schoolName)}.</b><p>If found, please return it to the school office. It is non-transferable and must be worn on school premises.</p></div>
      <div class="tc-rows"><div><span>Subjects</span><b class="clamp">${esc(subjects().join(", ") || "—")}</b></div><div><span>Joined</span><b>${esc(staff.joined || "—")}</b></div></div>
      <div class="tc-sign"><i></i><small>Principal's signature</small></div></div>`;
  }
  function openCard() {
    openSheet(`<div class="sheet-head"><div><b>Your teacher card</b><span>Issued by ${esc(schoolName)}</span></div><button class="icon-btn dark" data-close="1" aria-label="Close"><i class="fas fa-xmark"></i></button></div>
      <div class="cards-row">${cardFace("front")}${cardFace("back")}</div>
      <div class="card-actions"><button class="btn" id="card-print"><i class="fas fa-print"></i> Print</button><button class="btn ghost" id="card-share"><i class="fas fa-share-nodes"></i> Share</button></div>
      <button class="link center" id="card-dl"><i class="fas fa-download"></i> Save as image</button>`, "tall");
    try { if (window.QRCode) new QRCode($("#tc-qr"), { text: String(staff.staffId || ""), width: 84, height: 84, correctLevel: QRCode.CorrectLevel.M }); } catch (e) { /* QR optional */ }
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
  const TITLES = { home: "Home", classes: "My Classes", attendance: "Attendance", quizzes: "Tests & Quizzes", inbox: "Notices", profile: "My Profile" };
  const VIEWS = { home, classes, attendance, quizzes, inbox, profile };
  let current = "home";
  function go(tab) {
    if (current === "quizzes" && tab !== "quizzes" && quizView === "build") harvest();
    current = tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    $("#btn-inbox").classList.toggle("on", tab === "inbox");
    $("#page-title").textContent = TITLES[tab];
    view.scrollTop = 0; view.style.animation = "none"; void view.offsetWidth; view.style.animation = "";
    VIEWS[tab]();
    if (["home", "classes", "quizzes"].includes(tab) && !att.students && !att.loading) ensureStudents().then(() => current === tab && VIEWS[tab]());
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => { if (t.dataset.tab === "quizzes") quizView = "list"; go(t.dataset.tab); }));
  $("#btn-inbox").addEventListener("click", () => go("inbox"));
  $("#btn-refresh").addEventListener("click", async (e) => {
    const b = e.currentTarget; b.classList.add("spin"); att.students = null;
    await Promise.all([loadAttendanceData(), loadAnnouncements(), syncOutbox(), loadTests()]); b.classList.remove("spin"); go(current); toast("Refreshed");
  });

  view.addEventListener("click", (e) => {
    const nt = e.target.closest("[data-notice]"); if (nt) return openNotice(nt.dataset.notice);
    const tt = e.target.closest("[data-test]"); if (tt && !e.target.closest("button[data-go]")) { openTest = tt.dataset.test; quizView = "detail"; return go("quizzes"); }
    const gg = e.target.closest("[data-grade]"); if (gg) { const t = tests.find((x) => x.id === openTest); return t && openGrade(t, gg.dataset.grade); }
    const t = e.target.closest("button"); if (!t) return;
    const d = t.dataset;
    if (d.go) return go(d.go);
    if (d.card) return openCard();
    if (d.newtest) { go("quizzes"); return startBuild(); }
    if (d.cls) { att.cls = +d.cls; return attendance(); }
    if (d.set) { att.marks[t.closest(".stu").dataset.id] = d.set; t.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === t)); const c = counts(classStudents()); $("#c-p").textContent = c.present; $("#c-a").textContent = c.absent; $("#c-l").textContent = c.leave; return; }
    if (d.bulk) { classStudents().forEach((s) => (att.marks[s.regNo] = d.bulk)); return attendance(); }
    if (d.pw) { pwOpen = true; return profile(); }
    if (t.id === "pw-save") return changePassword();
    if (t.id === "save-att") return saveAttendance();
    if (t.id === "logout") { auth.clearSession(); location.replace("index.html"); }
    /* tests */
    if (d.qf) { quizzes.filter = d.qf; return quizzes(); }
    if (d.qback) { quizView = "list"; qb = null; openTest = null; return quizzes(); }
    if (d.qtype) { harvest(); qb.type = d.qtype; return quizzes(); }
    if (d.addq) { harvest(); qb.questions.push(newQuestion(d.addq)); quizzes(); view.scrollTop = view.scrollHeight; return; }
    if (d.delq != null) { harvest(); if (qb.questions.length < 2) return toast("A test needs at least one question.", true); qb.questions.splice(+d.delq, 1); return quizzes(); }
    if (t.id === "save-test") return saveBuilt();
    if (d.csv) return exportCsv(tests.find((x) => x.id === d.csv));
    if (d.deltest) { if (confirm("Delete this " + "test and all its results?")) { tests = tests.filter((x) => x.id !== d.deltest); saveTests(); pendingPut = pendingPut.filter((x) => x !== d.deltest); pendingDel.push(d.deltest); savePending(); flushTests(); quizView = "list"; quizzes(); toast("Deleted."); } return; }
    /* notices */
    if (d.atab) { ann.tab = d.atab; return inbox(); }
    if (d.aud) { compose.audience = d.aud; return inbox(); }
    if (d.prio) { compose.priority = d.prio; const ti = $("#c-title").value, bo = $("#c-body").value; inbox(); $("#c-title").value = ti; $("#c-body").value = bo; return; }
    if (t.id === "c-send") return sendMessage();
    /* home to-do */
    if (t.id === "todo-add") return addTodo();
    if (d.deltodo != null) { const l = store.get("todos", []); l.splice(+d.deltodo, 1); store.set("todos", l); return home(); }
  });
  function addTodo() { const i = $("#todo-in"), v = i.value.trim(); if (!v) return; const l = store.get("todos", []); l.push({ text: v, done: false }); store.set("todos", l.slice(-20)); home(); }
  view.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "todo-in") addTodo(); });
  view.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.todo != null) { const l = store.get("todos", []); if (l[+t.dataset.todo]) l[+t.dataset.todo].done = t.checked; store.set("todos", l); return home(); }
    if (t.id === "pref-admin") { prefs.receiveAdmin = t.checked; store.set("prefs", prefs); updateDot(); toast(t.checked ? "Admin announcements on." : "Admin announcements off."); }
    if (t.id === "c-cls") compose.cls = t.value;
  });
  $("#sheet-body").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "card-print") return cardPrint();
    if (b.id === "card-share") return cardShare();
    if (b.id === "card-dl") return cardDownload();
    if (gradeCtx && b.dataset.gq) { gradeCtx.answers[b.dataset.gq] = +b.dataset.gk; const t = tests.find((x) => x.id === gradeCtx.id); document.querySelectorAll("[data-gm]").forEach((i) => { if (i.value !== "") gradeCtx.answers[i.dataset.gm] = +i.value; }); const abs = $("#g-absent").checked, s = studentsOf(allMyClasses().find((c) => label(c) === t.cls) || { cls: t.cls.split(" - ")[0], section: t.cls.split(" - ")[1] || "" }).find((x) => x.regNo === gradeCtx.reg); gradeCtx.absent = abs; return renderGrade(t, s); }
    if (b.id === "g-save") return saveGrade(false);
    if (b.id === "g-next") return saveGrade(true);
  });
  $("#sheet-body").addEventListener("input", (e) => {
    if (gradeCtx && e.target.dataset.gm != null) { const t = tests.find((x) => x.id === gradeCtx.id), q = t.questions.find((x) => x.id === e.target.dataset.gm); const v = Math.min(+e.target.value || 0, q.marks); if (e.target.value === "") delete gradeCtx.answers[q.id]; else gradeCtx.answers[q.id] = v; $("#g-total").textContent = $("#g-absent").checked ? "—" : scoreSheet(t, { answers: gradeCtx.answers }) + " / " + qTotal(t); }
  });
  $("#sheet-body").addEventListener("change", (e) => { if (e.target.id === "g-absent" && gradeCtx) { const t = tests.find((x) => x.id === gradeCtx.id); $("#g-total").textContent = e.target.checked ? "—" : scoreSheet(t, { answers: gradeCtx.answers }) + " / " + qTotal(t); e.target.closest(".sheet").querySelector(".dim, [class=\"\"]"); } });

  $("#page-date").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  updateDot();
  go("home");
  if (inchargeClasses().length) loadAttendanceData().then(() => current === "home" && home());
  loadTests().then(() => { if (current === "quizzes" && quizView === "list") quizzes(); else if (current === "home") home(); });
  loadAnnouncements().then(() => { syncOutbox(); if (current === "home") home(); else if (current === "inbox") inbox(); });
})();
