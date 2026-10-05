/* SoftSchool Teacher Portal — Home · Classes · Attendance (incharge class only) · Profile */
(function () {
  "use strict";
  const API = "https://167-86-120-247.sslip.io/api";
  const auth = window.SoftSchoolTeacher;
  const session = auth && auth.getSession();
  if (!session || !session.token) { location.replace("index.html"); return; }

  const staff = session.staff || {};
  const schoolId = session.schoolId;
  const $ = (s) => document.querySelector(s);
  const view = $("#view");
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (v) => String(v || "").trim().toLowerCase();
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  /* ── API helper (sends the teacher's school-scoped token) ── */
  async function api(path, opts) {
    const res = await fetch(API + path, Object.assign({}, opts, {
      headers: Object.assign({ "Content-Type": "application/json", Authorization: "Bearer " + session.token }, (opts && opts.headers) || {})
    }));
    if (res.status === 401) { auth.clearSession(); toast("Session expired. Please sign in again.", true); setTimeout(() => location.replace("index.html"), 900); throw new Error("401"); }
    if (!res.ok) throw new Error((await res.text().catch(() => "")) || "HTTP " + res.status);
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

  /* ── Views ── */
  function home() {
    const inc = inchargeClasses(), teach = teachingClasses();
    const hr = new Date().getHours(), greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    let today$ = "";
    if (inc.length && att.students) {
      const list = classStudents(), c = counts(list), marked = list.some((s) => att.saved[s.regNo]);
      today$ = `<div class="section-title">Today · ${esc(label(inc[att.cls]))}</div>
        <div class="stats">
          <div class="stat green"><i class="fas fa-check"></i><b>${marked ? c.present : "—"}</b><span>Present</span></div>
          <div class="stat red"><i class="fas fa-xmark"></i><b>${marked ? c.absent : "—"}</b><span>Absent</span></div>
        </div>${marked ? "" : `<div class="card"><div class="row"><div class="ic"><i class="fas fa-bell"></i></div><div class="tx"><b>Attendance not marked yet</b><span>Tap below to mark today's attendance.</span></div></div></div>`}`;
    }
    view.innerHTML = `
      <div class="hero"><small>${greet},</small><h2>${esc((staff.name || "Teacher").split(" ")[0])}</h2>
        <span class="pill"><i class="fas fa-id-badge"></i> ${esc(staff.staffId || "")}</span>
        ${inc.length ? `<span class="pill"><i class="fas fa-star"></i> Incharge ${esc(label(inc[0]))}</span>` : ""}</div>
      <div class="stats">
        <div class="stat"><i class="fas fa-chalkboard"></i><b>${teach.length}</b><span>Classes</span></div>
        <div class="stat amber"><i class="fas fa-book"></i><b>${subjects().length}</b><span>Subjects</span></div>
      </div>${today$}
      ${inc.length ? `<button class="btn" data-go="attendance"><i class="fas fa-clipboard-check"></i> Mark Attendance</button>` : ""}`;
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

  function profile() {
    const kv = (k, v) => (v ? `<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>` : "");
    const inc = inchargeClasses();
    view.innerHTML = `
      <div class="profile-head"><div class="avatar">${staff.photo ? `<img src="${esc(staff.photo)}" alt="">` : esc(initials())}</div>
        <h2>${esc(staff.name || "Teacher")}</h2><p>${esc(staff.role || "Teacher")} · ${esc(staff.staffId || "")}</p></div>
      <div class="card"><h2><i class="fas fa-address-card"></i> Details</h2>
        ${kv("Staff ID", staff.staffId)}${kv("Role", staff.role)}${kv("Phone", staff.phone)}${kv("Gender", staff.gender)}${kv("CNIC", staff.cnic)}
        ${kv(staff.guardianType || "Guardian", staff.guardianName)}${kv("Address", staff.address)}${kv("Qualification", staff.qualification)}${kv("Joined", staff.joined)}</div>
      <div class="card"><h2><i class="fas fa-book"></i> Subjects</h2><div class="tags">${subjects().map((s) => `<span class="pill teal">${esc(s)}</span>`).join("") || "<span style='color:var(--ink-faint)'>None assigned</span>"}</div></div>
      <div class="card"><h2><i class="fas fa-chalkboard"></i> Classes</h2><div class="tags">${teachingClasses().map((c) => `<span class="pill teal">${esc(label(c))}</span>`).join("") || "<span style='color:var(--ink-faint)'>None assigned</span>"}
        ${inc.map((c) => `<span class="pill amber"><i class="fas fa-star"></i> ${esc(label(c))}</span>`).join("")}</div></div>
      <button class="btn out" id="logout"><i class="fas fa-right-from-bracket"></i> Sign out</button>`;
  }
  const empty = (ic, t, p) => `<div class="empty"><i class="fas ${ic}"></i><b>${t}</b><p>${p}</p></div>`;

  /* ── Navigation ── */
  const TITLES = { home: "Home", classes: "My Classes", attendance: "Attendance", profile: "My Profile" };
  const VIEWS = { home, classes, attendance, profile };
  let current = "home";
  function go(tab) {
    current = tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    $("#page-title").textContent = TITLES[tab];
    view.scrollTop = 0; view.style.animation = "none"; void view.offsetWidth; view.style.animation = "";
    VIEWS[tab]();
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => go(t.dataset.tab)));
  $("#btn-refresh").addEventListener("click", async (e) => {
    const b = e.currentTarget; b.classList.add("spin"); att.students = null; await loadAttendanceData(); b.classList.remove("spin"); go(current); toast("Refreshed");
  });
  view.addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.go) return go(t.dataset.go);
    if (t.dataset.cls) { att.cls = +t.dataset.cls; return attendance(); }
    if (t.dataset.set) { att.marks[t.closest(".stu").dataset.id] = t.dataset.set; t.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === t)); const c = counts(classStudents()); $("#c-p").textContent = c.present; $("#c-a").textContent = c.absent; $("#c-l").textContent = c.leave; return; }
    if (t.dataset.bulk) { classStudents().forEach((s) => (att.marks[s.regNo] = t.dataset.bulk)); return attendance(); }
    if (t.id === "save-att") return saveAttendance();
    if (t.id === "logout") { auth.clearSession(); location.replace("index.html"); }
  });

  $("#page-date").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  go("home");
  if (inchargeClasses().length) loadAttendanceData().then(() => current === "home" && home());
})();
