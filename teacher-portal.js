/**
 * ============================================================
 * SOFT SCHOOL — TEACHER PORTAL LOGIC
 * ===========================================================
 */

(function () {
  "use strict";

  const Teacher = window.SoftSchoolTeacher;

  /* ── GUARD: only signed-in teachers get past this point ── */
  const session = Teacher.getSession();
  const teacher = session ? Teacher.getCurrentTeacher() : null;
  if (!teacher) {
    window.location.href = "index.html";
    return;
  }

  /* ── HELPERS ────────────────────────────────────────────── */
  function splitList(str) {
    return (str || "").split(",").map(s => s.trim()).filter(Boolean);
  }
  function initials(name) {
    return (name || "").split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  }
  function todayKey() { return new Date().toISOString().slice(0, 10); }
  function todayNice() {
    return new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }
  function getStudents() {
    try { return JSON.parse(localStorage.getItem("edu_students")) || []; }
    catch (e) { return []; }
  }
  /* Student records are saved by Manage Students as studentClass/fullName/regNo,
     with `class`/`name`/`id` kept as fallbacks for older or hand-edited records. */
  function studentClassOf(s) { return s.studentClass || s.class || ""; }
  function studentNameOf(s) { return s.fullName || s.name || "—"; }
  function studentRegOf(s) { return s.regNo || s.id || ""; }
  function studentsInClass(className) {
    return getStudents().filter(s => studentClassOf(s) === className);
  }
  function getAllTeachers() {
    return (Teacher.getTeachers && Teacher.getTeachers()) || [];
  }
  /* Manage Staff's incharge picker saves a few different fields depending on
     how it was set up:
       - inchargeAssignments: JSON string like [{"cls":"Grade 10","section":"A"}]
         (most reliable — a teacher can be incharge of more than one section)
       - assignedClass: just the first assignment's class name, as a plain string
       - incharge: a human-readable string built from the above, e.g. "Grade 10 - A",
         or "Grade 9 - B, Grade 10 - A" when there's more than one assignment
     We try the structured fields first and only fall back to parsing the
     display string, since a plain startsWith() on `incharge` breaks as soon
     as there's more than one assignment or the format shifts slightly. */
  function inchargeClassesOf(t) {
    if (!t) return [];
    if (t.inchargeAssignments) {
      try {
        const arr = JSON.parse(t.inchargeAssignments);
        if (Array.isArray(arr) && arr.length) {
          const classes = arr.map(a => (a.cls || "").trim()).filter(Boolean);
          if (classes.length) return classes;
        }
      } catch (e) { /* fall through to other fields */ }
    }
    if (t.assignedClass) return [t.assignedClass.trim()];
    if (t.incharge) {
      return t.incharge.split(",")
        .map(entry => entry.split(" - ")[0].trim())
        .filter(Boolean);
    }
    return [];
  }
  /* Finds who is incharge of a given class (bare class name, e.g. "Grade 10"). */
  function inchargeNameForClass(className) {
    const found = getAllTeachers().find(t => inchargeClassesOf(t).includes(className));
    return found ? found.name : null;
  }
  /* Which of THIS teacher's own classes they are incharge of, if any. */
  function findOwnInchargeClass() {
    const inchargeClasses = inchargeClassesOf(teacher);
    if (!inchargeClasses.length) return null;
    /* Prefer a class that's also in this teacher's own "classes" list, since
       that's the exact string used elsewhere (student lookups, tiles, etc). */
    return teacherClasses.find(c => inchargeClasses.includes(c)) || inchargeClasses[0];
  }
  function getAttendanceRecord(className) {
    try { return JSON.parse(localStorage.getItem(`eduflow_att_${todayKey()}_${className}`) || "null")?.records || {}; }
    catch (e) { return {}; }
  }
  function summarizeAttendance(className) {
    const students = studentsInClass(className);
    const saved = getAttendanceRecord(className);
    let present = 0, absent = 0, leave = 0, unmarked = 0;
    students.forEach(s => {
      const rec = saved[studentRegOf(s)];
      if (!rec) { unmarked++; return; }
      if (rec.status === "present") present++;
      else if (rec.status === "absent") absent++;
      else if (rec.status === "leave") leave++;
      else unmarked++;
    });
    return { total: students.length, present, absent, leave, unmarked, marked: Object.keys(saved).length > 0 };
  }
  function showToast(msg, type) {
    const container = document.getElementById("toastContainer");
    const el = document.createElement("div");
    el.className = "toast " + (type || "");
    const icon = type === "error" ? "fa-circle-exclamation" : type === "success" ? "fa-circle-check" : "fa-circle-info";
    el.innerHTML = `<i class="fas ${icon}"></i><span>${msg}</span>`;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, 3200);
  }

  const teacherClasses = splitList(teacher.classes);
  const teacherSubjects = splitList(teacher.subjects);

  /* Classes and Subjects are both stored as separate free-text comma lists
     on the teacher record (see Manage Staff), with no explicit link between
     a class and the subject taught there. As a best-effort match we pair
     them by position — 1st class with 1st subject, 2nd with 2nd, etc.
     If the two lists aren't the same length we can't safely guess a pairing,
     so we fall back to showing every subject the teacher teaches. */
  function subjectForClass(className) {
    const idx = teacherClasses.indexOf(className);
    if (idx !== -1 && teacherClasses.length === teacherSubjects.length && teacherSubjects[idx]) {
      return teacherSubjects[idx];
    }
    return teacherSubjects.join(", ") || "No subjects on file";
  }

  /* ── TOPBAR / SIDEBAR SETUP ───────────────────────────────── */
  document.getElementById("avatarInitials").textContent = initials(teacher.name) || "T";
  document.getElementById("teacherNameLabel").textContent = teacher.name || "Teacher";
  document.getElementById("teacherSubjectLabel").textContent = teacherSubjects[0] || "Teacher";
  document.getElementById("todayLabel").textContent = todayNice();

  document.getElementById("logoutBtn").addEventListener("click", function () {
    Teacher.clearSession();
    window.location.href = "index.html";
  });

  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  document.getElementById("menuToggle").addEventListener("click", () => {
    sidebar.classList.add("open"); overlay.classList.add("open");
  });
  overlay.addEventListener("click", () => {
    sidebar.classList.remove("open"); overlay.classList.remove("open");
  });

  const PAGE_META = {
    dashboard: ["Dashboard", "A quick look at your day"],
    classes: ["My Classes", "Every class and section assigned to you — tap a class to see its students"],
    attendance: ["Attendance", "Mark today's attendance for your classes"],
    gradebook: ["Assign Test", "Schedule a weekly assessment, then come back to fill in marks"],
    announcements: ["Announcements", "Updates from your school administration"],
    profile: ["My Profile", "Your details on file"]
  };

  function switchView(name) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    const view = document.getElementById("view-" + name);
    const nav = document.querySelector('.nav-item[data-view="' + name + '"]');
    if (view) view.classList.add("active");
    if (nav) nav.classList.add("active");
    const meta = PAGE_META[name] || ["Dashboard", ""];
    document.getElementById("pageTitle").textContent = meta[0];
    document.getElementById("pageSubtitle").textContent = meta[1];
    sidebar.classList.remove("open"); overlay.classList.remove("open");
    if (name === "attendance") renderAttendanceClassOptions();
    if (name === "gradebook") renderGradebook();
  }

  document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.getAttribute("data-view")));
  });
  document.querySelectorAll("[data-goto]").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.getAttribute("data-goto")));
  });

  /* ── DASHBOARD ─────────────────────────────────────────────── */
  function renderDashboard() {
    /* Incharge-class stat cards at the top of the dashboard */
    const inchargeClass = findOwnInchargeClass();
    const statClassEl = document.getElementById("statInchargeClass");
    const statStudentsEl = document.getElementById("statInchargeStudents");
    const statAttendanceEl = document.getElementById("statInchargeAttendance");
    if (!inchargeClass) {
      statClassEl.textContent = "—";
      statStudentsEl.textContent = "0";
      statAttendanceEl.textContent = "—";
    } else {
      const sum = summarizeAttendance(inchargeClass);
      statClassEl.textContent = inchargeClass;
      statStudentsEl.textContent = sum.total;
      statAttendanceEl.textContent = sum.marked ? `${sum.present}/${sum.total}` : "Not marked";
    }

    /* "Classes I teach" tiles, each labelled with the specific subject taught there */
    const quick = document.getElementById("quickActions");
    quick.innerHTML = "";
    if (teacherClasses.length === 0) {
      quick.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <i class="fas fa-chalkboard"></i><strong>No classes assigned yet</strong>
        Ask your admin to assign classes to you in Manage Staff.
      </div>`;
    } else {
      teacherClasses.forEach(c => {
        const count = studentsInClass(c).length;
        const isIncharge = inchargeClassesOf(teacher).includes(c);
        const tile = document.createElement("div");
        tile.className = "class-tile";
        tile.innerHTML = `
          ${isIncharge ? '<span class="incharge-pill"><i class="fas fa-star"></i> Class incharge</span>' : ""}
          <h4>${c}</h4>
          <div class="meta"><i class="fas fa-book"></i> ${subjectForClass(c)}</div>
          <div class="foot">
            <span><i class="fas fa-user-graduate"></i> ${count} student${count === 1 ? "" : "s"}</span>
          </div>`;
        tile.addEventListener("click", () => {
          switchView("classes");
          setTimeout(() => {
            const target = Array.from(document.querySelectorAll("#classesList .class-tile"))
              .find(t => t.querySelector("h4") && t.querySelector("h4").textContent === c);
            if (target) target.click();
          }, 30);
        });
        quick.appendChild(tile);
      });
    }

    renderAnnouncements(document.getElementById("dashAnnouncements"), 3);
  }

  /* ── MY CLASSES ────────────────────────────────────────────── */
  function renderClasses() {
    const wrap = document.getElementById("classesList");
    wrap.innerHTML = "";
    const panel = document.getElementById("classDetailPanel");
    panel.innerHTML = "";

    if (teacherClasses.length === 0) {
      wrap.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <i class="fas fa-users"></i><strong>No classes assigned yet</strong>
        Ask your admin to assign classes to you in Manage Staff.
      </div>`;
      return;
    }

    teacherClasses.forEach((c, idx) => {
      const students = studentsInClass(c);
      const sections = [...new Set(students.map(s => s.section).filter(Boolean))];
      const isIncharge = inchargeClassesOf(teacher).includes(c);
      const tile = document.createElement("div");
      tile.className = "class-tile";
      tile.innerHTML = `
        ${isIncharge ? '<span class="incharge-pill"><i class="fas fa-star"></i> Class incharge</span>' : ""}
        <h4>${c}</h4>
        <div class="meta">${sections.length ? "Sections: " + sections.join(", ") : "No sections recorded"}</div>
        <div class="foot"><span><i class="fas fa-user-graduate"></i> ${students.length} students</span>
        <span><i class="fas fa-book"></i> ${subjectForClass(c)}</span></div>`;
      tile.addEventListener("click", () => {
        document.querySelectorAll("#classesList .class-tile").forEach(t => t.classList.remove("selected"));
        tile.classList.add("selected");
        renderClassDetail(c);
      });
      wrap.appendChild(tile);
      if (idx === 0) {
        tile.classList.add("selected");
        renderClassDetail(c);
      }
    });
  }

  function renderClassDetail(className) {
    const panel = document.getElementById("classDetailPanel");
    const students = studentsInClass(className);
    const saved = getAttendanceRecord(className);
    const sum = summarizeAttendance(className);
    const inchargeName = inchargeNameForClass(className);

    const rows = students.map(s => {
      const reg = studentRegOf(s);
      const rec = saved[reg];
      const status = rec ? rec.status : "unmarked";
      const tagClass = status === "present" ? "tag-present" : status === "absent" ? "tag-absent" : status === "leave" ? "tag-leave" : "tag-unmarked";
      const label = status === "present" ? "Present" : status === "absent" ? "Absent" : status === "leave" ? "Leave" : "Not marked";
      return `<tr>
        <td>${studentNameOf(s)}</td><td>${reg || "—"}</td><td>${s.section || "—"}</td>
        <td><span class="tag ${tagClass}">${label}</span></td>
      </tr>`;
    }).join("");

    panel.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div>
            <h3>${className}</h3>
            <p>${subjectForClass(className)} • Class incharge: ${inchargeName || "Not assigned"}</p>
          </div>
        </div>
        <div class="class-detail-stats">
          <div class="mini-stat"><div class="mini-stat-value">${sum.total}</div><div class="mini-stat-label">Total students</div></div>
          <div class="mini-stat"><div class="mini-stat-value">${sum.present}</div><div class="mini-stat-label">Present today</div></div>
          <div class="mini-stat"><div class="mini-stat-value">${sum.absent + sum.leave}</div><div class="mini-stat-label">Absent today</div></div>
        </div>
        ${students.length === 0
          ? `<div class="empty-state"><i class="fas fa-user-graduate"></i><strong>No students found</strong>Students for ${className} haven't been added yet.</div>`
          : `<div style="overflow-x:auto;"><table class="data-table">
              <thead><tr><th>Name</th><th>Reg #</th><th>Section</th><th>Status</th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`}
      </div>`;
  }

  /* ── ATTENDANCE ────────────────────────────────────────────── */
  let attState = {};

  function renderAttendanceClassOptions() {
    const inchargeClass = findOwnInchargeClass();
    const nameEl = document.getElementById("attClassName");
    if (!inchargeClass) {
      nameEl.textContent = "Not incharge of a class";
      document.getElementById("attTableWrap").innerHTML = `<div class="empty-state">
        <i class="fas fa-clipboard-check"></i><strong>You're not incharge of a class</strong>
        Attendance can only be marked by the teacher incharge. Ask your admin if this isn't right.
      </div>`;
      document.getElementById("attStatusBadge").innerHTML = "";
      return;
    }
    nameEl.textContent = inchargeClass;
    renderAttendanceTable(inchargeClass);
  }

  function renderAttendanceTable(className) {
    const wrap = document.getElementById("attTableWrap");
    const badge = document.getElementById("attStatusBadge");
    if (!className) { wrap.innerHTML = ""; badge.innerHTML = ""; return; }

    const storageKey = `eduflow_att_${todayKey()}_${className}`;
    const saved = getAttendanceRecord(className);
    attState = JSON.parse(JSON.stringify(saved));

    const alreadySaved = Object.keys(saved).length > 0;
    badge.innerHTML = `<span class="badge ${alreadySaved ? "badge-saved" : "badge-pending"}">
      <i class="fas ${alreadySaved ? "fa-check-circle" : "fa-clock"}"></i> ${alreadySaved ? "Saved for today" : "Not marked yet"}</span>`;

    const students = studentsInClass(className);
    if (students.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><i class="fas fa-user-graduate"></i><strong>No students found</strong>Students for ${className} haven't been added yet.</div>`;
      return;
    }

    let rows = students.map(s => {
      const reg = studentRegOf(s);
      const entry = attState[reg] || { status: "present", reason: "" };
      return `<tr data-reg="${reg}">
        <td>${studentNameOf(s)}</td>
        <td>${reg || "—"}</td>
        <td>${s.section || "—"}</td>
        <td>
          <div class="status-pills">
            <button type="button" class="status-btn present ${entry.status === "present" ? "active" : ""}" data-status="present"><i class="fas fa-check"></i> Present</button>
            <button type="button" class="status-btn absent ${entry.status === "absent" ? "active" : ""}" data-status="absent"><i class="fas fa-xmark"></i> Absent</button>
            <button type="button" class="status-btn leave ${entry.status === "leave" ? "active" : ""}" data-status="leave"><i class="fas fa-user-clock"></i> Leave</button>
          </div>
        </td>
      </tr>`;
    }).join("");

    wrap.innerHTML = `<div style="overflow-x:auto;"><table class="data-table">
      <thead><tr><th>Name</th><th>Reg #</th><th>Section</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div style="margin-top:1.2rem;"><button class="btn btn-primary" id="attSaveBtn"><i class="fas fa-save"></i> Save attendance</button></div>`;

    wrap.querySelectorAll(".status-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const row = btn.closest("tr");
        const reg = row.getAttribute("data-reg");
        row.querySelectorAll(".status-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        attState[reg] = { status: btn.getAttribute("data-status"), reason: "" };
      });
    });

    document.getElementById("attSaveBtn").addEventListener("click", () => {
      const existing = getAttendanceRecord(className);
      const payload = { date: todayKey(), class: className, records: { ...existing, ...attState } };
      localStorage.setItem(storageKey, JSON.stringify(payload));
      showToast("Attendance saved for " + className, "success");
      renderAttendanceTable(className);
      renderDashboard();
      renderClasses();
    });
  }

  /* ── ASSIGN TEST (formerly Gradebook) ─────────────────────────
     Two-step flow: schedule a test (class/subject/name/total), then
     separately open it to fill marks. Once marks are saved the test
     locks and can no longer be edited. ─────────────────────────── */
  const GRADES_KEY = "eduflow_teacher_grades";
  function getAllGrades() {
    try { return JSON.parse(localStorage.getItem(GRADES_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveAllGrades(list) { localStorage.setItem(GRADES_KEY, JSON.stringify(list)); }

  function renderGradebook() {
    const classSel = document.getElementById("gbClassSelect");
    const subjSel = document.getElementById("gbSubjectSelect");
    classSel.innerHTML = teacherClasses.length
      ? teacherClasses.map(c => `<option value="${c}">${c}</option>`).join("")
      : `<option value="">No classes assigned</option>`;
    subjSel.innerHTML = teacherSubjects.length
      ? teacherSubjects.map(s => `<option value="${s}">${s}</option>`).join("")
      : `<option value="">No subjects on file</option>`;
    renderGbHistory();
  }

  document.getElementById("gbSaveBtn").addEventListener("click", () => {
    const className = document.getElementById("gbClassSelect").value;
    const subject = document.getElementById("gbSubjectSelect").value;
    const examName = document.getElementById("gbExamName").value.trim();
    const total = Number(document.getElementById("gbTotalMarks").value);

    if (!className || !subject) { showToast("Choose a class and subject first.", "error"); return; }
    if (!examName) { showToast("Give this test a name.", "error"); return; }
    if (!total || total <= 0) { showToast("Enter the total marks for this test.", "error"); return; }

    const list = getAllGrades();
    list.push({
      id: "GB-" + Date.now(),
      teacherId: teacher.id,
      class: className,
      subject: subject,
      examName: examName,
      totalMarks: total,
      date: todayKey(),
      marks: {},
      locked: false
    });
    saveAllGrades(list);
    showToast(examName + " scheduled for " + className, "success");
    document.getElementById("gbExamName").value = "";
    document.getElementById("gbTotalMarks").value = "";
    renderGbHistory();
  });

  function renderGbHistory() {
    const wrap = document.getElementById("gbHistoryWrap");
    const mine = getAllGrades().filter(g => g.teacherId === teacher.id).reverse();
    if (mine.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><i class="fas fa-file-pen"></i><strong>No tests scheduled yet</strong>Create one above to get started.</div>`;
      return;
    }
    wrap.innerHTML = `<div style="overflow-x:auto;"><table class="data-table">
      <thead><tr><th>Assessment</th><th>Class</th><th>Subject</th><th>Total</th><th>Date</th><th>Marks</th><th></th></tr></thead>
      <tbody>${mine.map(g => `<tr>
        <td>${g.examName}</td><td>${g.class}</td><td>${g.subject}</td><td>${g.totalMarks}</td><td>${g.date}</td>
        <td>${g.locked
          ? `<button class="btn btn-secondary btn-sm gb-view-marks" data-id="${g.id}"><i class="fas fa-eye"></i> View marks</button>`
          : `<button class="btn btn-primary btn-sm gb-fill-marks" data-id="${g.id}"><i class="fas fa-pen"></i> Fill marks</button>`}
        </td>
        <td>${g.locked
          ? `<span class="badge badge-locked"><i class="fas fa-lock"></i> Locked</span>`
          : `<button class="btn btn-secondary btn-sm gb-delete" data-id="${g.id}"><i class="fas fa-trash-alt"></i></button>`}
        </td>
      </tr>`).join("")}</tbody>
    </table></div>`;

    wrap.querySelectorAll(".gb-fill-marks, .gb-view-marks").forEach(btn => {
      btn.addEventListener("click", () => openMarksModal(btn.getAttribute("data-id")));
    });
    wrap.querySelectorAll(".gb-delete").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        saveAllGrades(getAllGrades().filter(g => g.id !== id));
        showToast("Test removed", "success");
        renderGbHistory();
      });
    });
  }

  let activeMarksTestId = null;

  function openMarksModal(id) {
    const g = getAllGrades().find(t => t.id === id);
    if (!g) return;
    activeMarksTestId = id;

    document.getElementById("marksModalTitle").textContent = g.examName;
    document.getElementById("marksModalSubtitle").textContent =
      `${g.class} • ${g.subject} • Total marks: ${g.totalMarks}${g.locked ? " • Locked — marks can't be edited" : ""}`;

    const students = studentsInClass(g.class);
    const wrap = document.getElementById("marksModalTableWrap");
    if (students.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><i class="fas fa-user-graduate"></i><strong>No students found</strong>Students for ${g.class} haven't been added yet.</div>`;
    } else {
      wrap.innerHTML = `<div style="overflow-x:auto;"><table class="data-table">
        <thead><tr><th>Name</th><th>Reg #</th><th style="width:140px;">Marks obtained</th></tr></thead>
        <tbody>${students.map(s => {
          const reg = studentRegOf(s);
          const existing = (g.marks && g.marks[reg] != null) ? g.marks[reg] : "";
          return `<tr data-reg="${reg}">
            <td>${studentNameOf(s)}</td><td>${reg || "—"}</td>
            <td><input class="input gb-mark-input" type="number" min="0" max="${g.totalMarks}" placeholder="0" value="${existing}" ${g.locked ? "disabled" : ""}></td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>`;
    }

    document.getElementById("marksModalSave").style.display = g.locked ? "none" : "";
    document.getElementById("marksModal").classList.add("open");
  }

  document.getElementById("marksModalClose").addEventListener("click", () => document.getElementById("marksModal").classList.remove("open"));
  document.getElementById("marksModal").addEventListener("click", (e) => { if (e.target.id === "marksModal") e.currentTarget.classList.remove("open"); });

  document.getElementById("marksModalSave").addEventListener("click", () => {
    const list = getAllGrades();
    const idx = list.findIndex(t => t.id === activeMarksTestId);
    if (idx === -1) return;
    if (list[idx].locked) return;

    const marks = {};
    document.querySelectorAll("#marksModalTableWrap tr[data-reg]").forEach(row => {
      const reg = row.getAttribute("data-reg");
      const val = Number(row.querySelector(".gb-mark-input").value) || 0;
      marks[reg] = val;
    });

    list[idx].marks = marks;
    list[idx].locked = true;
    saveAllGrades(list);
    document.getElementById("marksModal").classList.remove("open");
    showToast("Marks saved for " + list[idx].examName, "success");
    renderGbHistory();
  });

  /* ── ANNOUNCEMENTS ─────────────────────────────────────────── */
  const SEED_ANNOUNCEMENTS = [
    { title: "Welcome to the new term", body: "Attendance and test marks you save here are shared with the office in real time.", date: todayKey() },
    { title: "Staff meeting this Friday", body: "All teaching staff are expected in the staff room at 2:00 PM for the monthly briefing.", date: todayKey() },
    { title: "Report cards due", body: "Please make sure test marks for this term are complete before the 25th.", date: todayKey() }
  ];
  function getAnnouncements() {
    try {
      const raw = JSON.parse(localStorage.getItem("eduflow-announcements"));
      return Array.isArray(raw) && raw.length ? raw : SEED_ANNOUNCEMENTS;
    } catch (e) { return SEED_ANNOUNCEMENTS; }
  }
  function renderAnnouncements(target, limit) {
    const list = getAnnouncements().slice(0, limit || 99);
    target.innerHTML = list.map(a => `<div class="announcement-item">
      <div class="announcement-icon"><i class="fas fa-bullhorn"></i></div>
      <div><h4>${a.title}</h4><p>${a.body}</p><time>${a.date}</time></div>
    </div>`).join("");
  }

  /* ── PROFILE ───────────────────────────────────────────────── */
  function renderProfile() {
    const fields = [
      ["Teacher ID", teacher.id], ["Full name", teacher.name],
      ["Qualification", teacher.qualification], ["Subjects", teacher.subjects],
      ["Classes", teacher.classes], ["Class incharge", teacher.incharge || "—"],
      ["Gender", teacher.gender], ["Joined", teacher.joined]
    ];
    document.getElementById("profileReadonly").innerHTML = fields.map(([label, val]) =>
      `<div class="profile-field"><label>${label}</label><div>${val || "—"}</div></div>`).join("");

    document.getElementById("profPhone").value = teacher.phone || "";
    document.getElementById("profAddress").value = teacher.address || "";
  }

  document.getElementById("profSaveBtn").addEventListener("click", () => {
    const phone = document.getElementById("profPhone").value.trim();
    const address = document.getElementById("profAddress").value.trim();
    Teacher.updateTeacher(teacher.id, { phone, address });
    teacher.phone = phone; teacher.address = address;
    showToast("Contact details updated", "success");
  });

  /* ── INIT ──────────────────────────────────────────────────── */
  renderDashboard();
  renderClasses();
  renderProfile();
  renderAnnouncements(document.getElementById("announcementsList"));
  switchView("dashboard");
})();
