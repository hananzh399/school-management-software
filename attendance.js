/* EduFlow Pro — Attendance module
   Flow: mode (Staff/Student) -> submode (Add/View) -> form or analytics
*/
 
// ---------- REAL DATA FROM DATABASE ----------

const LEAVE_REASONS = ["Sick Leave","Personal","Family Event","Medical Appointment","Travel","Other"];

/**
 * Load real students from edu_students (managed by manage-students.js).
 * Falls back to empty array if none saved yet.
 * Normalises to the shape attendance needs: { regNo, name, class, section, guardian }
 */
function loadRealStudents() {
    const raw = JSON.parse(localStorage.getItem('edu_students') || '[]');
    return raw.map(s => {
        const fullName = s.fullName
            || ((s.firstName ? s.firstName + ' ' + (s.lastName || '') : '').trim())
            || s.name
            || 'Unknown';
        return {
            regNo:    s.regNo || s.studentId || s.id || ('STD-' + Math.random().toString(36).slice(2,7).toUpperCase()),
            name:     fullName.trim(),
            class:    s.studentClass || s.class || s.grade || s.className || 'Unassigned',
            section:  s.section || 'A',
            guardian: s.guardianName || s.fatherName || s.guardian || '—',
        };
    });
}

/* Ensure every record has a unique key; suffix duplicates so toggling
   attendance on one row never affects another. */
function _uniquifyKey(arr, keyName) {
    const seen = {};
    arr.forEach(item => {
        let k = item[keyName] || ('AUTO-' + Math.random().toString(36).slice(2,7).toUpperCase());
        if (seen[k] != null) {
            seen[k] += 1;
            k = k + '#' + seen[k];
        } else {
            seen[k] = 0;
        }
        item[keyName] = k;
    });
    return arr;
}

/**
 * Load real staff from the shared DB (eduflow-db → staff Teaching + Non-Teaching).
 * Falls back to empty array.
 * Normalises to: { id, name, role, department }
 */
function loadRealStaff() {
    try {
        const db = JSON.parse(localStorage.getItem('eduflow-db') || '{}');
        const teaching    = (db.staff && db.staff['Teaching'])    || [];
        const nonTeaching = (db.staff && db.staff['Non-Teaching']) || [];
        const all = [];
        teaching.forEach(s => all.push({
            id:         s.id   || ('TCH-' + s.name.replace(/\s+/g,'').slice(0,4).toUpperCase()),
            name:       s.name || 'Unknown',
            role:       s.role || 'Teacher',
            department: s.subjects || s.department || 'General',
        }));
        nonTeaching.forEach(s => all.push({
            id:         s.id   || ('NTS-' + s.name.replace(/\s+/g,'').slice(0,4).toUpperCase()),
            name:       s.name || 'Unknown',
            role:       s.job  || s.role || 'Staff',
            department: s.department || 'Support',
        }));
        return all;
    } catch(e) { return []; }
}

/**
 * Derive the list of classes+sections from the real student DB
 * (or from edu_class_configs set in Settings if students not yet added).
 */
function loadRealClasses() {
    // Prefer class configs from settings (always present)
    const configs = JSON.parse(localStorage.getItem('edu_class_configs') || '[]');
    if (configs.length > 0) {
        return configs.map(c => ({
            name:     c.name,
            sections: Array.isArray(c.sections) && c.sections.length ? c.sections : ['A'],
        }));
    }
    // Derive from real students
    const students = loadRealStudents();
    const map = {};
    students.forEach(s => {
        if (!map[s.class]) map[s.class] = new Set();
        map[s.class].add(s.section);
    });
    return Object.keys(map).map(name => ({ name, sections: [...map[name]] }));
}

// Lazy-loaded so data is always fresh when a stage is entered
let STUDENTS = [];
let STAFF    = [];
let CLASSES  = [];

function refreshLiveData() {
    STUDENTS = _uniquifyKey(loadRealStudents(), "regNo");
    STAFF    = _uniquifyKey(loadRealStaff(), "id");
    CLASSES  = loadRealClasses();
}

// Build history from saved localStorage attendance keys (real data)
function buildRealStudentHistory(students) {
    const hist = {};
    students.forEach(s => { hist[s.regNo] = []; });
    for (let key in localStorage) {
        if (!key.startsWith('eduflow_att_')) continue;
        try {
            const payload = JSON.parse(localStorage.getItem(key));
            if (!payload || !payload.records) continue;
            Object.entries(payload.records).forEach(([regNo, entry]) => {
                if (hist[regNo] !== undefined) {
                    hist[regNo].push({ date: payload.date, status: entry.status, reason: entry.reason || null });
                }
            });
        } catch(e) { /* skip */ }
    }
    return hist;
}

function buildRealStaffHistory(staff) {
    const hist = {};
    staff.forEach(s => { hist[s.id] = []; });
    for (let key in localStorage) {
        if (!key.startsWith('eduflow_staff_att_')) continue;
        try {
            const payload = JSON.parse(localStorage.getItem(key));
            if (!payload || !payload.records) continue;
            Object.entries(payload.records).forEach(([id, entry]) => {
                if (hist[id] !== undefined) {
                    hist[id].push({ date: payload.date, status: entry.status, reason: entry.reason || null });
                }
            });
        } catch(e) { /* skip */ }
    }
    return hist;
}

// These are populated lazily when View stage is entered
let STUDENT_HISTORY = {};
let STAFF_HISTORY   = {};

 
// ---------- STATE ----------
const state = {
    mode: null,           // 'staff' | 'student'
    action: null,         // 'add' | 'view'
    selectedClass: null,
    selectedSection: "ALL",
    search: "",
    attendance: {},       // regNo -> { status, reason }
    staffAttendance: {},  // staffId -> { status, reason }
    savedStudentKeys: new Set(),   // regNos that have been saved today
    savedStaffKeys: new Set(),     // staffIds that have been saved today
    studentEditMode: new Set(),    // regNos currently in edit mode
    staffEditMode: new Set(),      // staffIds currently in edit mode
    viewRange: 7,
    viewSearch: "",
};

// Monthly view state
state.monthlyClass = null;
state.monthlyDate  = new Date();   // any day inside the chosen month
state.monthlySearch = "";
state.monthlySection = "ALL";
 
// ---------- DATE HELPERS ----------
function todayKey() { return new Date().toISOString().slice(0, 10); }
 
function checkDayReset() {
    const lastDay = localStorage.getItem("eduflow_last_day");
    const today = todayKey();
    if (lastDay !== today) {
        // New day — clear all saved marks
        state.savedStudentKeys.clear();
        state.savedStaffKeys.clear();
        state.studentEditMode.clear();
        state.staffEditMode.clear();
        localStorage.setItem("eduflow_last_day", today);
    }
}
 
function scheduleMidnightRefresh() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 1, 0); // 1 second past midnight
    const msUntilMidnight = midnight - now;
    setTimeout(() => {
        // Reset saved state and re-render current stage
        state.savedStudentKeys.clear();
        state.savedStaffKeys.clear();
        state.studentEditMode.clear();
        state.staffEditMode.clear();
        state.attendance = {};
        state.staffAttendance = {};
        localStorage.setItem("eduflow_last_day", todayKey());
        // Re-init current visible stage
        if (!document.querySelector("#stage-table.hidden")) { renderTable(); }
        if (!document.querySelector("#stage-staff.hidden")) { initStaffAttendance(); renderStaff(); }
        toast("New day — attendance sheet has been reset!");
        scheduleMidnightRefresh();
    }, msUntilMidnight);
}
 
// ---------- DOM HELPERS ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }
function hideAllStages() {
    ["#stage-mode","#stage-submode","#stage-classes","#stage-table","#stage-staff","#stage-view","#stage-monthly","#stage-student-record","#stage-staff-monthly","#stage-staff-record"].forEach(hide);
}

 
// ---------- INIT ----------
document.addEventListener("DOMContentLoaded", () => {
    checkDayReset();
    scheduleMidnightRefresh();
    initTheme();
    initSidebar();
    initDate();
    initModeCards();
    initSubmodeCards();
    initBackButtons();
    initSearch();
    initSectionDropdown();
    initBulk();
    initSave();
    initStaff();
    initView();
    initMonthly();
    initMonthlyToolbar();
    initStudentRecordFilters();
});
 
function initDate() {
    const d = new Date();
    $("#header-date").textContent = d.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}
 
function initTheme() {
    const saved = localStorage.getItem("eduflow-theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved);
    $("#theme-toggle").addEventListener("click", () => {
        const cur  = document.documentElement.getAttribute("data-theme") || "dark";
        const next = cur === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("eduflow-theme", next);
    });
}
 
function initSidebar() {
    const sidebar = $("#sidebar"), overlay = $("#sidebar-overlay");
    $("#open-sidebar").addEventListener("click", () => { sidebar.classList.add("active"); overlay.classList.add("active"); });
    $("#close-sidebar").addEventListener("click", () => { sidebar.classList.remove("active"); overlay.classList.remove("active"); });
    overlay.addEventListener("click", () => { sidebar.classList.remove("active"); overlay.classList.remove("active"); });
}
 
function initModeCards() {
    $$("#stage-mode .choice-card").forEach(card => {
        card.addEventListener("click", () => {
            state.mode = card.getAttribute("data-mode");
            $("#submode-title").textContent = state.mode === "staff" ? "Staff Attendance" : "Student Attendance";
            hideAllStages();
            show("#stage-submode");
        });
    });
}
 
function initSubmodeCards() {
    $$("#stage-submode .choice-card").forEach(card => {
        card.addEventListener("click", () => {
            state.action = card.getAttribute("data-action");
            refreshLiveData(); // always pull fresh DB data
            hideAllStages();
            if (state.action === "add") {
                if (state.mode === "student") { renderClasses(); show("#stage-classes"); }
                else { initStaffAttendance(); renderStaff(); show("#stage-staff"); }
            } else {
                if (state.mode === "student") {
                    // View student attendance: first pick a class, then show monthly grid
                    renderClasses();
                    show("#stage-classes");
                } else {
                    // Staff view: open the monthly staff attendance grid (mirrors student monthly view)
                    openStaffMonthly();
                }
            }
        });
    });
}

 
function initBackButtons() {
    $$(".back-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.getAttribute("data-back");
            hideAllStages();
            if (target === "mode") show("#stage-mode");
            else if (target === "submode") show("#stage-submode");
            else if (target === "classes") show("#stage-classes");
            else if (target === "view-classes") { renderClasses(); show("#stage-classes"); }
            else if (target === "monthly") { show("#stage-monthly"); }
            else if (target === "staff-monthly") { show("#stage-staff-monthly"); }
        });
    });
}

 
// ---------- CLASSES ----------
function renderClasses() {
    const grid = $("#classes-grid");
    grid.innerHTML = "";
    if (CLASSES.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 24px;color:var(--text-muted);">
            <i class="fas fa-school" style="font-size:2.5rem;margin-bottom:12px;display:block;opacity:0.4;"></i>
            <strong>No classes found.</strong><br>
            <span style="font-size:0.875rem;">Add classes in <a href="settings.html" style="color:var(--accent);">Admin Settings</a> or add students in <a href="manage-students.html" style="color:var(--accent);">Student Management</a>.</span>
        </div>`;
        return;
    }
    CLASSES.forEach(cls => {
        const count = STUDENTS.filter(s => s.class === cls.name).length;
        const alreadySaved = !!localStorage.getItem(`eduflow_att_${todayKey()}_${cls.name}`);
        const card = document.createElement("div");
        card.className = "class-card" + (alreadySaved ? " class-card--saved" : "");
        card.innerHTML = `
            <div class="class-name">${cls.name}${alreadySaved ? ' <span class="class-saved-badge"><i class="fas fa-check-circle"></i> Saved Today</span>' : ''}</div>
            <div class="class-meta">Sections: ${cls.sections.join(", ")}</div>
            <div class="class-count"><i class="fas fa-users"></i> ${count} students</div>
        `;
        card.addEventListener("click", () => {
            if (state.action === "view") openClassMonthly(cls);
            else openClass(cls);
        });
        grid.appendChild(card);
    });
}
 
function openClass(cls) {
    state.selectedClass = cls;
    state.selectedSection = "ALL";
    state.search = "";
    state.studentEditMode.clear();

    // Check if attendance has already been saved today for this class
    const todayStorageKey = `eduflow_att_${todayKey()}_${cls.name}`;
    const existing = localStorage.getItem(todayStorageKey);

    if (existing) {
        try {
            const payload = JSON.parse(existing);
            // Pre-load the saved records so rows show the correct status
            state.attendance = payload.records || {};
            // Mark every student in the class as already saved (locked "Done" state)
            state.savedStudentKeys = new Set(
                STUDENTS.filter(s => s.class === cls.name).map(s => s.regNo)
            );
        } catch(e) {
            // Corrupted data — fall back to fresh sheet
            state.attendance = {};
            state.savedStudentKeys.clear();
            STUDENTS.filter(s => s.class === cls.name)
                .forEach(s => { state.attendance[s.regNo] = { status: "present", reason: "" }; });
        }
    } else {
        // No record yet for today — start fresh
        state.attendance = {};
        state.savedStudentKeys.clear();
        STUDENTS.filter(s => s.class === cls.name)
            .forEach(s => { state.attendance[s.regNo] = { status: "present", reason: "" }; });
    }

    $("#table-title").textContent = `${cls.name} — Attendance`;
    $("#search-input").value = "";
    $("#section-label").textContent = "All Sections";
    renderSectionList();
    hideAllStages();
    show("#stage-table");
    renderTable();
}
 
// ---------- SECTION DROPDOWN ----------
function renderSectionList() {
    const list = $("#section-list");
    list.innerHTML = "";
    const items = ["ALL", ...(state.selectedClass?.sections ?? [])];
    items.forEach(s => {
        const div = document.createElement("div");
        div.className = "dropdown-item" + (state.selectedSection === s ? " active" : "");
        div.textContent = s === "ALL" ? "All Sections" : `Section ${s}`;
        div.addEventListener("click", () => {
            state.selectedSection = s;
            $("#section-label").textContent = s === "ALL" ? "All Sections" : `Section ${s}`;
            hide("#section-dropdown");
            renderTable();
            renderSectionList();
        });
        list.appendChild(div);
    });
}
 
function initSectionDropdown() {
    $("#section-trigger").addEventListener("click", (e) => {
        e.stopPropagation();
        $("#section-dropdown").classList.toggle("hidden");
    });
    document.addEventListener("click", (e) => {
        if (!$("#section-select").contains(e.target)) hide("#section-dropdown");
    });
}
 
// ---------- SEARCH ----------
function initSearch() {
    $("#search-input").addEventListener("input", (e) => {
        state.search = e.target.value.trim();
        renderTable();
    });
}
 
function matchesSearch(s, q) {
    if (!q) return true;
    // Tilde syntax: "Hanan~Habib" searches name contains "Hanan" AND guardian contains "Habib"
    if (q.includes("~")) {
        const parts = q.split("~");
        const namePart = parts[0].trim().toLowerCase();
        const guardianPart = parts[1].trim().toLowerCase();
        const nameMatch = !namePart || s.name.toLowerCase().includes(namePart);
        const guardianMatch = !guardianPart || s.guardian.toLowerCase().includes(guardianPart);
        return nameMatch && guardianMatch;
    }
    const ql = q.toLowerCase();
    return s.name.toLowerCase().includes(ql)
        || s.regNo.toLowerCase().includes(ql)
        || s.guardian.toLowerCase().includes(ql);
}
 
// ---------- TABLE (Student / Add) ----------
function renderTable() {
    const tbody = $("#attendance-tbody");
    tbody.innerHTML = "";
    const cls = state.selectedClass;
    if (!cls) return;
    const rows = STUDENTS
        .filter(s => s.class === cls.name)
        .filter(s => state.selectedSection === "ALL" || s.section === state.selectedSection)
        .filter(s => matchesSearch(s, state.search));
 
    rows.length === 0 ? show("#empty-state") : hide("#empty-state");
 
    rows.forEach((s, idx) => {
        const entry = state.attendance[s.regNo] || { status: "present", reason: "" };
        const isSaved = state.savedStudentKeys.has(s.regNo);
        const isEditing = state.studentEditMode.has(s.regNo);
        const tr = document.createElement("tr");
 
        if (isSaved && !isEditing) {
            // Green "Done" row
            tr.classList.add("row-done");
            const statusLabel = entry.status.charAt(0).toUpperCase() + entry.status.slice(1);
            const statusClass = entry.status === "present" ? "done-present" : entry.status === "absent" ? "done-absent" : "done-leave";
            tr.innerHTML = `
                <td>${idx + 1}</td>
                <td><span class="id-badge">${s.regNo}</span></td>
                <td>${s.name}${entry.reason ? `<span class="done-reason">(${entry.reason})</span>` : ""}</td>
                <td>${s.section}</td>
                <td>${s.guardian}</td>
                <td>
                    <div class="done-cell">
                        <span class="done-badge ${statusClass}"><i class="fas fa-check-circle"></i> Done · ${statusLabel}</span>
                        <button class="edit-btn" data-edit-id="${s.regNo}"><i class="fas fa-pen"></i> Edit</button>
                    </div>
                </td>
            `;
        } else {
            tr.innerHTML = `
                <td>${idx + 1}</td>
                <td><span class="id-badge">${s.regNo}</span></td>
                <td>
                    ${s.name}
                    ${entry.status === "leave" ? renderLeaveReason(s.regNo, entry.reason, "student") : ""}
                </td>
                <td>${s.section}</td>
                <td>${s.guardian}</td>
                <td>
                    <div class="status-cell">
                        <button class="status-btn present ${entry.status==='present'?'active':''}" data-id="${s.regNo}" data-status="present"><i class="fas fa-check"></i><span>Present</span></button>
                        <button class="status-btn absent  ${entry.status==='absent' ?'active':''}" data-id="${s.regNo}" data-status="absent"><i class="fas fa-times"></i><span>Absent</span></button>
                        <button class="status-btn leave   ${entry.status==='leave'  ?'active':''}" data-id="${s.regNo}" data-status="leave"><i class="fas fa-clock"></i><span>Leave</span></button>
                    </div>
                </td>
            `;
        }
        tbody.appendChild(tr);
    });
 
    tbody.querySelectorAll(".status-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-id");
            const status = btn.getAttribute("data-status");
            const prev = state.attendance[id] || { status: "present", reason: "" };
            state.attendance[id] = { status, reason: status === "leave" ? prev.reason : "" };
            renderTable();
        });
    });
    tbody.querySelectorAll(".leave-reason input").forEach(inp => {
        inp.addEventListener("input", (e) => {
            const id = inp.getAttribute("data-id");
            if (state.attendance[id]) state.attendance[id].reason = e.target.value;
        });
    });
    tbody.querySelectorAll(".edit-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-edit-id");
            state.studentEditMode.add(id);
            renderTable();
        });
    });
 
    renderSummary();
}
 
function renderLeaveReason(id, value, kind) {
    return `<div class="leave-reason">
        <label>Reason</label>
        <input data-id="${id}" data-kind="${kind}" type="text" placeholder="e.g. Sick Leave, Personal" value="${value || ""}" />
    </div>`;
}
 
function renderSummary() {
    const cls = state.selectedClass;
    if (!cls) return;
    const students = STUDENTS.filter(s => s.class === cls.name)
        .filter(s => state.selectedSection === "ALL" || s.section === state.selectedSection);
    let p=0,a=0,l=0;
    students.forEach(s => {
        const st = (state.attendance[s.regNo] || {}).status || "present";
        if (st === "present") p++; else if (st === "absent") a++; else l++;
    });
    $("#summary").innerHTML = `
        <span>Total: <strong>${students.length}</strong></span>
        <span class="pill present"><i class="fas fa-check"></i> ${p} Present</span>
        <span class="pill absent"><i class="fas fa-times"></i> ${a} Absent</span>
        <span class="pill leave"><i class="fas fa-clock"></i> ${l} Leave</span>
    `;
}
 
// ---------- BULK ----------
function initBulk() {
    $$(".bulk-btn[data-bulk]").forEach(btn => {
        btn.addEventListener("click", () => {
            const status = btn.getAttribute("data-bulk");
            const cls = state.selectedClass; if (!cls) return;
            STUDENTS.filter(s => s.class === cls.name)
                .filter(s => state.selectedSection === "ALL" || s.section === state.selectedSection)
                .filter(s => matchesSearch(s, state.search))
                .forEach(s => {
                    const prev = state.attendance[s.regNo] || {};
                    state.attendance[s.regNo] = { status, reason: status === "leave" ? (prev.reason || "") : "" };
                });
            renderTable();
        });
    });
    $$(".bulk-btn[data-staff-bulk]").forEach(btn => {
        btn.addEventListener("click", () => {
            const status = btn.getAttribute("data-staff-bulk");
            STAFF.forEach(s => {
                const prev = state.staffAttendance[s.id] || {};
                state.staffAttendance[s.id] = { status, reason: status === "leave" ? (prev.reason || "") : "" };
            });
            renderStaff();
        });
    });
}
 
// ---------- SAVE ----------
function initSave() {
    $("#save-btn").addEventListener("click", () => {
        const cls = state.selectedClass;
        if (!cls) return;

        // Mark all currently visible students as saved, clear edit mode
        STUDENTS.filter(s => s.class === cls.name)
            .filter(s => state.selectedSection === "ALL" || s.section === state.selectedSection)
            .filter(s => matchesSearch(s, state.search))
            .forEach(s => {
                state.savedStudentKeys.add(s.regNo);
                state.studentEditMode.delete(s.regNo);
            });

        // Merge with any existing record for today (other sections may already be saved)
        const storageKey = `eduflow_att_${todayKey()}_${cls.name}`;
        let existingRecords = {};
        try {
            const prev = localStorage.getItem(storageKey);
            if (prev) existingRecords = JSON.parse(prev).records || {};
        } catch(e) { /* ignore */ }

        const payload = {
            date: todayKey(),
            class: cls.name,
            records: { ...existingRecords, ...state.attendance },
        };
        localStorage.setItem(storageKey, JSON.stringify(payload));
        renderTable();
        toast("Attendance saved successfully");
    });

    $("#staff-save-btn").addEventListener("click", () => {
        // Mark all visible staff as saved
        const q = ($("#staff-search").value || "").trim().toLowerCase();
        STAFF.filter(s => !q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
            .forEach(s => {
                state.savedStaffKeys.add(s.id);
                state.staffEditMode.delete(s.id);
            });

        // Merge with existing record for today
        const storageKey = `eduflow_staff_att_${todayKey()}`;
        let existingRecords = {};
        try {
            const prev = localStorage.getItem(storageKey);
            if (prev) existingRecords = JSON.parse(prev).records || {};
        } catch(e) { /* ignore */ }

        const payload = {
            date: todayKey(),
            records: { ...existingRecords, ...state.staffAttendance },
        };
        localStorage.setItem(storageKey, JSON.stringify(payload));
        applyAbsenceFines(); // auto-update fines in shared DB
        renderStaff();
        toast("Staff attendance saved & fines updated");
    });
}
 
function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.classList.add("hidden"), 300); }, 2200);
}
 
// ---------- STAFF ----------
function initStaff() {
    initStaffAttendance();
    $("#staff-search").addEventListener("input", () => renderStaff());
}
function initStaffAttendance() {
    const todayStorageKey = `eduflow_staff_att_${todayKey()}`;
    const existing = localStorage.getItem(todayStorageKey);

    if (existing) {
        try {
            const payload = JSON.parse(existing);
            // Pre-load saved records so rows reflect the correct status
            const savedRecords = payload.records || {};
            // Merge: keep saved data, add defaults only for new staff not yet in the record
            STAFF.forEach(s => {
                if (savedRecords[s.id] !== undefined) {
                    state.staffAttendance[s.id] = savedRecords[s.id];
                } else if (!state.staffAttendance[s.id]) {
                    state.staffAttendance[s.id] = { status: "present", reason: "" };
                }
            });
            // Lock every staff member that appears in the saved record
            state.savedStaffKeys = new Set(Object.keys(savedRecords).filter(id => STAFF.some(s => s.id === id)));
        } catch(e) {
            // Corrupted — fresh sheet
            state.savedStaffKeys.clear();
            STAFF.forEach(s => {
                if (!state.staffAttendance[s.id]) {
                    state.staffAttendance[s.id] = { status: "present", reason: "" };
                }
            });
        }
    } else {
        // No record saved today — fresh sheet
        state.savedStaffKeys.clear();
        STAFF.forEach(s => {
            if (!state.staffAttendance[s.id]) {
                state.staffAttendance[s.id] = { status: "present", reason: "" };
            }
        });
    }

    // Remove entries for staff that no longer exist
    const validIds = new Set(STAFF.map(s => s.id));
    Object.keys(state.staffAttendance).forEach(id => {
        if (!validIds.has(id)) delete state.staffAttendance[id];
    });
}
 
function renderStaff() {
    const tbody = $("#staff-tbody");
    const q = ($("#staff-search").value || "").trim().toLowerCase();
    tbody.innerHTML = "";
    if (STAFF.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:48px;color:var(--text-muted);">
            <i class="fas fa-user-slash" style="font-size:2rem;margin-bottom:10px;display:block;opacity:0.4;"></i>
            No staff found. Add staff in <a href="manage-staff.html" style="color:var(--accent);">Staff Management</a>.
        </td></tr>`;
        return;
    }
    const rows = STAFF.filter(s => !q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    rows.forEach((s, idx) => {
        const entry = state.staffAttendance[s.id] || { status: "present", reason: "" };
        const isSaved = state.savedStaffKeys.has(s.id);
        const isEditing = state.staffEditMode.has(s.id);
        const tr = document.createElement("tr");
 
        if (isSaved && !isEditing) {
            tr.classList.add("row-done");
            const statusLabel = entry.status.charAt(0).toUpperCase() + entry.status.slice(1);
            const statusClass = entry.status === "present" ? "done-present" : entry.status === "absent" ? "done-absent" : "done-leave";
            tr.innerHTML = `
                <td>${idx+1}</td>
                <td><span class="id-badge">${s.id}</span></td>
                <td>${s.name}${entry.reason ? `<span class="done-reason">(${entry.reason})</span>` : ""}</td>
                <td>${s.role}</td>
                <td>${s.department}</td>
                <td>
                    <div class="done-cell">
                        <span class="done-badge ${statusClass}"><i class="fas fa-check-circle"></i> Done · ${statusLabel}</span>
                        <button class="edit-btn" data-edit-staff="${s.id}"><i class="fas fa-pen"></i> Edit</button>
                    </div>
                </td>
            `;
        } else {
            tr.innerHTML = `
                <td>${idx+1}</td>
                <td><span class="id-badge">${s.id}</span></td>
                <td>
                    ${s.name}
                    ${entry.status === "leave" ? renderLeaveReason(s.id, entry.reason, "staff") : ""}
                </td>
                <td>${s.role}</td>
                <td>${s.department}</td>
                <td>
                    <div class="status-cell">
                        <button class="status-btn present ${entry.status==='present'?'active':''}" data-sid="${s.id}" data-status="present"><i class="fas fa-check"></i><span>Present</span></button>
                        <button class="status-btn absent  ${entry.status==='absent' ?'active':''}" data-sid="${s.id}" data-status="absent"><i class="fas fa-times"></i><span>Absent</span></button>
                        <button class="status-btn leave   ${entry.status==='leave'  ?'active':''}" data-sid="${s.id}" data-status="leave"><i class="fas fa-clock"></i><span>Leave</span></button>
                    </div>
                </td>
            `;
        }
        tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".status-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const sid = btn.getAttribute("data-sid");
            const status = btn.getAttribute("data-status");
            const prev = state.staffAttendance[sid] || {};
            state.staffAttendance[sid] = { status, reason: status === "leave" ? (prev.reason || "") : "" };
            renderStaff();
        });
    });
    tbody.querySelectorAll(".leave-reason input").forEach(inp => {
        inp.addEventListener("input", (e) => {
            const id = inp.getAttribute("data-id");
            if (state.staffAttendance[id]) state.staffAttendance[id].reason = e.target.value;
        });
    });
    tbody.querySelectorAll(".edit-btn[data-edit-staff]").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-edit-staff");
            state.staffEditMode.add(id);
            renderStaff();
        });
    });
    let p=0,a=0,l=0;
    STAFF.forEach(s => { const st = (state.staffAttendance[s.id]||{}).status; if(st==='present')p++; else if(st==='absent')a++; else l++; });
    $("#staff-summary").innerHTML = `
        <span>Total: <strong>${STAFF.length}</strong></span>
        <span class="pill present"><i class="fas fa-check"></i> ${p} Present</span>
        <span class="pill absent"><i class="fas fa-times"></i> ${a} Absent</span>
        <span class="pill leave"><i class="fas fa-clock"></i> ${l} Leave</span>
    `;
}
 
// ---------- VIEW (Analytics) ----------
function initView() {
    $("#view-search").addEventListener("input", (e) => {
        state.viewSearch = e.target.value.trim().toLowerCase();
        renderView();
    });
    $$("#view-filters .filter-btn").forEach(b => {
        b.addEventListener("click", () => {
            $$("#view-filters .filter-btn").forEach(x => x.classList.remove("active"));
            b.classList.add("active");
            state.viewRange = parseInt(b.getAttribute("data-range"), 10);
            renderView();
        });
    });

    // ---------- PRINT ----------
    const printBtn = document.getElementById("view-print-btn");
    if (printBtn) {
        printBtn.addEventListener("click", () => {
            const title  = document.getElementById("view-title").textContent || "Attendance Report";
            const kpis   = document.getElementById("view-kpis").outerHTML;
            const table  = document.querySelector("#stage-view .table-card").outerHTML;
            const dateStr = new Date().toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'});
            const w = window.open("", "_blank", "width=1000,height=800");
            if (!w) { toast("Pop-up blocked — please allow pop-ups to print."); return; }
            w.document.write(`<!doctype html><html><head><title>${title}</title>
                <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
                <style>
                    body{font-family:Inter,Arial,sans-serif;padding:24px;color:#0f172a;}
                    h1{font-size:22px;margin:0 0 4px;} .sub{color:#64748b;font-size:13px;margin-bottom:18px;}
                    table{width:100%;border-collapse:collapse;font-size:13px;}
                    th,td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left;}
                    th{background:#f1f5f9;}
                    .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px;}
                    .kpi-card{border:1px solid #e2e8f0;border-radius:10px;padding:12px;}
                    .kpi-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;}
                    .kpi-value{font-size:20px;font-weight:700;margin-top:4px;}
                    .kpi-value.small{font-size:14px;}
                    .kpi-icon{display:none;}
                    .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:#f1f5f9;}
                    .badge-present{background:#dcfce7;color:#15803d;}
                    .badge-absent{background:#fee2e2;color:#b91c1c;}
                    .badge-leave{background:#fef3c7;color:#a16207;}
                    .id-badge{font-family:monospace;background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:11px;}
                    @media print { button{display:none;} }
                </style></head><body>
                <h1>${title}</h1>
                <div class="sub">St. Lawrence International School &middot; ${dateStr}</div>
                ${kpis}${table}
                <script>window.onload=()=>{setTimeout(()=>window.print(),250);};<\/script>
                </body></html>`);
            w.document.close();
        });
    }

    // ---------- SHARE ----------
    const shareBtn = document.getElementById("view-share-btn");
    if (shareBtn) {
        shareBtn.addEventListener("click", async () => {
            const title  = document.getElementById("view-title").textContent || "Attendance Report";
            const tbody  = document.getElementById("view-tbody");
            const rows   = [...tbody.querySelectorAll("tr")];
            const dateStr = new Date().toLocaleDateString();
            let text = `${title}\n${dateStr}\n\n`;
            rows.forEach(tr => {
                const cells = [...tr.querySelectorAll("td")].map(td => td.innerText.trim());
                if (cells.length) text += cells.join(" | ") + "\n";
            });
            const shareData = { title, text };
            try {
                if (navigator.share) {
                    await navigator.share(shareData);
                    toast("Shared successfully");
                } else if (navigator.clipboard) {
                    await navigator.clipboard.writeText(text);
                    toast("Report copied to clipboard");
                } else {
                    const w = window.open("", "_blank");
                    w.document.write("<pre>"+text.replace(/</g,"&lt;")+"</pre>");
                    w.document.close();
                }
            } catch (err) {
                if (err && err.name === "AbortError") return; // user cancelled
                try { await navigator.clipboard.writeText(text); toast("Report copied to clipboard"); }
                catch(e){ toast("Unable to share: " + (err.message || err)); }
            }
        });
    }
}
 
function renderView() {
    const isStaff = state.mode === "staff";
    $("#view-title").textContent = isStaff ? "View Staff Attendance" : "View Student Attendance";
 
    const people = isStaff ? STAFF : STUDENTS;
    const idKey = isStaff ? "id" : "regNo";
    const history = isStaff ? STAFF_HISTORY : STUDENT_HISTORY;
    const days = state.viewRange;
 
    // filter people by search
    const q = state.viewSearch;
    const filtered = people.filter(p => !q || p.name.toLowerCase().includes(q) || p[idKey].toLowerCase().includes(q));
 
    // aggregate KPIs across filtered people, across range
    let totalPresent = 0, totalAbsent = 0, totalLeave = 0;
    const reasonCounts = {};
 
    const perPersonRows = filtered.map(p => {
        const slice = (history[p[idKey]] || []).slice(0, days);
        let pr=0, ab=0, lv=0;
        slice.forEach(rec => {
            if (rec.status === "present") pr++;
            else if (rec.status === "absent") ab++;
            else { lv++; if (rec.reason) reasonCounts[rec.reason] = (reasonCounts[rec.reason]||0) + 1; }
        });
        totalPresent += pr; totalAbsent += ab; totalLeave += lv;
        const latest = slice[0] ? slice[0].status : "present";
        return { p, pr, ab, lv, latest };
    });
 
    const primaryReason = Object.entries(reasonCounts).sort((a,b) => b[1]-a[1])[0];
 
    // KPI cards
    $("#view-kpis").innerHTML = `
        ${kpiCard("icon-emerald", "fa-check-circle", "Total Days Present", totalPresent)}
        ${kpiCard("icon-rose",    "fa-times-circle", "Total Days Absent", totalAbsent, true)}
        ${kpiCard("icon-amber",   "fa-clock",        "Total Days on Leave", totalLeave, false, true)}
        ${kpiCard("icon-indigo",  "fa-comment-dots", "Primary Leave Reason", primaryReason ? primaryReason[0] : "—", false, false, true)}
    `;
 
    // Table
    const tbody = $("#view-tbody");
    tbody.innerHTML = "";
    perPersonRows.length === 0 ? show("#view-empty") : hide("#view-empty");
    perPersonRows.forEach((row, idx) => {
        const tr = document.createElement("tr");
        const badgeClass = row.latest === "present" ? "badge-present" : row.latest === "absent" ? "badge-absent" : "badge-leave";
        tr.innerHTML = `
            <td>${idx+1}</td>
            <td><span class="id-badge">${row.p[idKey]}</span></td>
            <td>${row.p.name}</td>
            <td>${isStaff ? "—" : escapeHtml(row.p.guardian || "—")}</td>
            <td style="text-align:center"><span class="badge badge-present">${row.pr}</span></td>
            <td style="text-align:center"><span class="badge badge-absent">${row.ab}</span></td>
            <td style="text-align:center"><span class="badge badge-leave">${row.lv}</span></td>
            <td style="text-align:center"><span class="badge ${badgeClass}">${row.latest}</span></td>
        `;
        tbody.appendChild(tr);
    });
}
 
function kpiCard(iconClass, fa, label, value) {
    // map custom icon classes
    const iconBg = iconClass === "icon-rose" ? "background: linear-gradient(135deg, #ef4444, #dc2626);"
                 : iconClass === "icon-amber" ? "background: linear-gradient(135deg, #f59e0b, #d97706);"
                 : iconClass === "icon-emerald" ? ""
                 : "";
    const valueClass = typeof value === "string" && value.length > 8 ? "kpi-value small" : "kpi-value";
    return `
        <div class="kpi-card">
            <div class="kpi-icon ${iconClass}" style="${iconBg}"><i class="fas ${fa}"></i></div>
            <div class="kpi-meta">
                <div class="kpi-label">${label}</div>
                <div class="${valueClass}">${value}</div>
            </div>
        </div>
    `;
}
 





// ---------- AUTO FINE APPLICATION ----------
/**
 * Reads all saved staff attendance records for the current month,
 * counts absent days per staff member, computes fines using their
 * penalty settings from Settings (or global pay variables),
 * and writes the total fine back into the shared DB so finance pages
 * and settings cards show the correct deductions automatically.
 */
function applyAbsenceFines() {
    try {
        const db = JSON.parse(localStorage.getItem('eduflow-db') || '{}');
        if (!db.staff) return;

        const vars = JSON.parse(localStorage.getItem('edu_pay_variables') || '{}');
        const globalPenaltyType  = vars.penaltyType  || 'percent';
        const globalPenaltyValue = parseFloat(vars.penaltyValue) || 3;

        const now = new Date();
        const month = now.getMonth();
        const year  = now.getFullYear();

        // Gather all this-month attendance records
        const monthRecords = {}; // staffId -> [status, ...]
        for (let key in localStorage) {
            if (!key.startsWith('eduflow_staff_att_')) continue;
            const dateStr = key.replace('eduflow_staff_att_', '');
            const d = new Date(dateStr);
            if (isNaN(d.getTime()) || d.getMonth() !== month || d.getFullYear() !== year) continue;
            try {
                const payload = JSON.parse(localStorage.getItem(key));
                if (!payload || !payload.records) continue;
                Object.entries(payload.records).forEach(([id, entry]) => {
                    if (!monthRecords[id]) monthRecords[id] = [];
                    monthRecords[id].push(entry.status);
                });
            } catch(e) { /* skip */ }
        }

        // Helper: count absents (absent + leave both count as non-present for fine)
        function countAbsents(records) {
            return records.filter(s => s === 'absent').length; // only 'absent' triggers fine; 'leave' usually doesn't
        }

        // Apply fine to Teaching staff
        db.staff['Teaching'] = (db.staff['Teaching'] || []).map(s => {
            const records = monthRecords[s.id] || [];
            const absentDays = countAbsents(records);
            const salary = parseFloat(s.salary) || 0;
            const pType  = s.penaltyType  || globalPenaltyType;
            const pValue = parseFloat(s.penaltyValue != null ? s.penaltyValue : globalPenaltyValue);
            let fine = 0;
            if (absentDays > 0) {
                fine = pType === 'percent'
                    ? Math.round((salary * pValue / 100) * absentDays)
                    : Math.round(pValue * absentDays);
            }
            return { ...s, fines: fine, absentDaysThisMonth: absentDays };
        });

        // Apply fine to Non-Teaching staff
        db.staff['Non-Teaching'] = (db.staff['Non-Teaching'] || []).map(s => {
            const records = monthRecords[s.id] || [];
            const absentDays = countAbsents(records);
            const salary = parseFloat(s.salary) || 0;
            const pType  = s.penaltyType  || globalPenaltyType;
            const pValue = parseFloat(s.penaltyValue != null ? s.penaltyValue : globalPenaltyValue);
            let fine = 0;
            if (absentDays > 0) {
                fine = pType === 'percent'
                    ? Math.round((salary * pValue / 100) * absentDays)
                    : Math.round(pValue * absentDays);
            }
            return { ...s, fines: fine, absentDaysThisMonth: absentDays };
        });

        localStorage.setItem('eduflow-db', JSON.stringify(db));
    } catch(e) {
        console.warn('applyAbsenceFines error:', e);
    }
}
// ---------- MONTHLY VIEW (Student View Attendance) ----------
const _WD = ["Su","M","Tu","W","Th","F","Sa"];
const _MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function initMonthly() {
    document.getElementById("month-prev").addEventListener("click", () => {
        const d = new Date(state.monthlyDate);
        d.setDate(1); d.setMonth(d.getMonth() - 1);
        state.monthlyDate = d;
        renderMonthly();
    });
    document.getElementById("month-next").addEventListener("click", () => {
        const d = new Date(state.monthlyDate);
        d.setDate(1); d.setMonth(d.getMonth() + 1);
        state.monthlyDate = d;
        renderMonthly();
    });
}

// ---------- MONTHLY SEARCH + SECTION FILTER ----------
function initMonthlyToolbar() {
    const search = document.getElementById("monthly-search");
    if (search) {
        search.addEventListener("input", (e) => {
            state.monthlySearch = e.target.value.trim();
            renderMonthly();
        });
    }
    const trigger = document.getElementById("monthly-section-trigger");
    if (trigger) {
        trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            document.getElementById("monthly-section-dropdown").classList.toggle("hidden");
        });
    }
    document.addEventListener("click", (e) => {
        const wrap = document.getElementById("monthly-section-select");
        if (wrap && !wrap.contains(e.target)) {
            document.getElementById("monthly-section-dropdown").classList.add("hidden");
        }
    });
}

function renderMonthlySectionList() {
    const list = document.getElementById("monthly-section-list");
    if (!list) return;
    list.innerHTML = "";
    const items = ["ALL", ...(state.monthlyClass?.sections ?? [])];
    items.forEach(s => {
        const div = document.createElement("div");
        div.className = "dropdown-item" + (state.monthlySection === s ? " active" : "");
        div.textContent = s === "ALL" ? "All Sections" : `Section ${s}`;
        div.addEventListener("click", () => {
            state.monthlySection = s;
            document.getElementById("monthly-section-label").textContent = s === "ALL" ? "All Sections" : `Section ${s}`;
            document.getElementById("monthly-section-dropdown").classList.add("hidden");
            renderMonthlySectionList();
            renderMonthly();
        });
        list.appendChild(div);
    });
}

function openClassMonthly(cls) {
    state.monthlyClass = cls;
    state.monthlyDate = new Date(); // current month
    state.monthlySearch = "";
    state.monthlySection = "ALL";
    document.getElementById("monthly-title").textContent = `${cls.name} — Monthly Attendance`;
    const searchInput = document.getElementById("monthly-search");
    if (searchInput) searchInput.value = "";
    const label = document.getElementById("monthly-section-label");
    if (label) label.textContent = "All Sections";
    renderMonthlySectionList();
    hideAllStages();
    show("#stage-monthly");
    renderMonthly();
}

function renderMonthly() {
    const cls = state.monthlyClass;
    if (!cls) return;
    const d = state.monthlyDate;
    const year = d.getFullYear();
    const month = d.getMonth(); // 0-11
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    document.getElementById("month-label").textContent = `${_MONTHS[month]} ${year}`;

    // Collect students for this class, filtered by section + search (Reg No / name / name~guardian)
    const students = STUDENTS
        .filter(s => s.class === cls.name)
        .filter(s => state.monthlySection === "ALL" || s.section === state.monthlySection)
        .filter(s => matchesSearch(s, state.monthlySearch));

    const table = document.getElementById("monthly-table");
    const emptyEl = document.getElementById("monthly-empty");
    if (students.length === 0) {
        table.innerHTML = "";
        const hasAnyInClass = STUDENTS.some(s => s.class === cls.name);
        emptyEl.innerHTML = hasAnyInClass
            ? `<i class="fas fa-search"></i><p>No students match your search or section filter.</p>`
            : `<i class="fas fa-inbox"></i><p>No students in this class.</p>`;
        emptyEl.classList.remove("hidden");
        return;
    }
    emptyEl.classList.add("hidden");

    // Pre-load daily records: { 'YYYY-MM-DD': records }
    const dayRecords = {};
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const raw = localStorage.getItem(`eduflow_att_${dateKey}_${cls.name}`);
        if (raw) {
            try { dayRecords[dateKey] = (JSON.parse(raw).records) || {}; }
            catch(e) { dayRecords[dateKey] = {}; }
        } else {
            dayRecords[dateKey] = null; // no record taken
        }
    }

    // Build header
    let headHtml = `<thead>
        <tr>
            <th class="col-id" rowspan="2">Reg No</th>
            <th class="col-name" rowspan="2">Student Name <span style="font-weight:400;font-size:0.65rem;color:var(--text-muted);">(double-click row for full record)</span></th>
            <th class="col-guardian" rowspan="2">Guardian</th>
            <th colspan="${daysInMonth}" style="background:var(--bg-secondary);">
                Enter: <span class="mark-P">P</span>=Present,
                <span class="mark-A">A</span>=Absent,
                <span class="mark-L">L</span>=Leave
            </th>
            <th rowspan="2">P</th>
            <th rowspan="2">A</th>
            <th rowspan="2">L</th>
        </tr>
        <tr>`;
    for (let day = 1; day <= daysInMonth; day++) {
        const wd = new Date(year, month, day).getDay();
        const isWeekend = wd === 0 || wd === 6;
        headHtml += `<th class="${isWeekend ? "day-weekend" : ""}">
            <div style="font-size:0.7rem;color:var(--text-muted);">${_WD[wd]}</div>
            <div>${day}</div>
        </th>`;
    }
    headHtml += `</tr></thead>`;

    // Build body
    let bodyHtml = "<tbody>";
    students.forEach((s, idx) => {
        let p = 0, a = 0, l = 0;
        let rowHtml = `<tr class="clickable-row" data-regno="${s.regNo}" title="Double-click to view full attendance record">
            <td class="col-id"><span class="id-badge">${s.regNo}</span></td>
            <td class="col-name">${s.name}</td>
            <td class="col-guardian">${escapeHtml(s.guardian || "—")}</td>`;
        for (let day = 1; day <= daysInMonth; day++) {
            const dateKey = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const recs = dayRecords[dateKey];
            const wd = new Date(year, month, day).getDay();
            const isWeekend = wd === 0 || wd === 6;
            let mark = "–", cls2 = "mark-empty";
            if (recs && recs[s.regNo]) {
                const st = recs[s.regNo].status;
                if (st === "present") { mark = "P"; cls2 = "mark-P"; p++; }
                else if (st === "absent")  { mark = "A"; cls2 = "mark-A"; a++; }
                else if (st === "leave")   { mark = "L"; cls2 = "mark-L"; l++; }
            }
            rowHtml += `<td class="${isWeekend ? "day-weekend" : ""}"><span class="mark ${cls2}">${mark}</span></td>`;
        }
        rowHtml += `<td class="mark-P"><strong>${p}</strong></td>
                    <td class="mark-A"><strong>${a}</strong></td>
                    <td class="mark-L"><strong>${l}</strong></td></tr>`;
        bodyHtml += rowHtml;
    });
    bodyHtml += "</tbody>";

    table.innerHTML = headHtml + bodyHtml;

    table.querySelectorAll("tbody tr.clickable-row").forEach(row => {
        row.addEventListener("dblclick", () => {
            const regNo = row.getAttribute("data-regno");
            if (!regNo) return;
            const student = STUDENTS.find(s => s.regNo === regNo);
            if (student) openStudentRecord(student);
        });
    });
}

// ---------- SINGLE STUDENT FULL ATTENDANCE RECORD ----------
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    })[ch]);
}
state.studentRecord = null;     // the student object currently being viewed
state.recordSearch  = "";
state.recordRange   = "all";

/* Scan every eduflow_att_<date>_<class> key and collect this student's entries */
function buildStudentFullHistory(regNo) {
    const records = [];
    for (let key in localStorage) {
        if (!key.startsWith('eduflow_att_')) continue;
        try {
            const payload = JSON.parse(localStorage.getItem(key));
            if (!payload || !payload.records) continue;
            const entry = payload.records[regNo];
            if (entry) records.push({ date: payload.date, status: entry.status, reason: entry.reason || "" });
        } catch(e) { /* skip corrupted */ }
    }
    records.sort((a, b) => b.date.localeCompare(a.date)); // newest first
    return records;
}

function openStudentRecord(student) {
    state.studentRecord = student;
    state.recordSearch = "";
    state.recordRange = "all";
    $("#record-title").textContent = `${student.name} — Attendance Record`;
    $("#record-search").value = "";
    $$("#record-filters .filter-btn").forEach(b => b.classList.remove("active"));
    const allBtn = document.querySelector('#record-filters .filter-btn[data-range="all"]');
    if (allBtn) allBtn.classList.add("active");

    const initials = student.name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    $("#record-profile").innerHTML = `
        <div class="record-avatar">${escapeHtml(initials || "?")}</div>
        <div class="record-meta">
            <span class="name">${escapeHtml(student.name)}</span>
            <span class="sub">Reg No: ${escapeHtml(student.regNo)} &middot; Class ${escapeHtml(student.class)} &middot; Section ${escapeHtml(student.section)}</span>
        </div>
        <div class="record-tags">
            <div class="record-tag">Guardian: <strong>${escapeHtml(student.guardian)}</strong></div>
        </div>
    `;

    hideAllStages();
    show("#stage-student-record");
    renderStudentRecord();
}

function _recordWithinRange(dateStr, range) {
    if (range === "all") return true;
    const days = parseInt(range, 10);
    const d = new Date(dateStr);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return d >= cutoff;
}

function _matchesRecordSearch(rec, q) {
    if (!q) return true;
    const ql = q.toLowerCase();
    return rec.date.toLowerCase().includes(ql)
        || rec.status.toLowerCase().includes(ql)
        || (rec.reason || "").toLowerCase().includes(ql);
}

function renderStudentRecordKpis(filtered) {
    let p = 0, a = 0, l = 0;
    filtered.forEach(r => { if (r.status === "present") p++; else if (r.status === "absent") a++; else if (r.status === "leave") l++; });
    const total = filtered.length;
    const pct = total ? Math.round((p / total) * 1000) / 10 : 0;
    $("#record-kpis").innerHTML = `
        <div class="kpi-card">
            <div class="kpi-icon icon-indigo"><i class="fas fa-calendar-check"></i></div>
            <div class="kpi-meta"><div class="kpi-label">Total Marked Days</div><div class="kpi-value">${total}</div></div>
        </div>
        <div class="kpi-card">
            <div class="kpi-icon icon-emerald"><i class="fas fa-check"></i></div>
            <div class="kpi-meta"><div class="kpi-label">Present</div><div class="kpi-value">${p}</div></div>
        </div>
        <div class="kpi-card">
            <div class="kpi-icon icon-rose"><i class="fas fa-times"></i></div>
            <div class="kpi-meta"><div class="kpi-label">Absent</div><div class="kpi-value">${a}</div></div>
        </div>
        <div class="kpi-card">
            <div class="kpi-icon icon-amber"><i class="fas fa-clock"></i></div>
            <div class="kpi-meta"><div class="kpi-label">Leave</div><div class="kpi-value">${l}</div></div>
        </div>
        <div class="kpi-card">
            <div class="kpi-icon icon-indigo"><i class="fas fa-percent"></i></div>
            <div class="kpi-meta"><div class="kpi-label">Attendance %</div><div class="kpi-value">${pct}%</div></div>
        </div>
    `;
}

function renderStudentRecord() {
    const student = state.studentRecord;
    if (!student) return;
    const allRecords = buildStudentFullHistory(student.regNo);
    const filtered = allRecords
        .filter(r => _recordWithinRange(r.date, state.recordRange))
        .filter(r => _matchesRecordSearch(r, state.recordSearch));

    renderStudentRecordKpis(filtered);

    const list = $("#history-list");
    list.innerHTML = "";
    filtered.length === 0 ? show("#history-empty") : hide("#history-empty");

    filtered.forEach(r => {
        const cls = r.status === "present" ? "present" : r.status === "absent" ? "absent" : "leave";
        const label = r.status.charAt(0).toUpperCase() + r.status.slice(1);
        const dateLabel = new Date(r.date).toLocaleDateString(undefined, { weekday:'short', year:'numeric', month:'short', day:'numeric' });
        const row = document.createElement("div");
        row.className = "history-row";
        row.innerHTML = `
            <span class="history-date">${escapeHtml(dateLabel)}</span>
            <span class="history-reason">${escapeHtml(r.reason) || "—"}</span>
            <span class="history-status ${cls}">${label}</span>
        `;
        list.appendChild(row);
    });
}

function initStudentRecordFilters() {
    const search = $("#record-search");
    if (search) {
        search.addEventListener("input", (e) => {
            state.recordSearch = e.target.value.trim();
            renderStudentRecord();
        });
    }
    $$("#record-filters .filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            $$("#record-filters .filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.recordRange = btn.getAttribute("data-range");
            renderStudentRecord();
        });
    });
}

/* ============================================================
   SINGLE STUDENT ATTENDANCE REPORT (Full Record view →
   "Generate Attendance Report"). Lets the user pick 1 Week /
   1 Month / 1 Year and produces a printable, shareable summary
   card with the student's profile, markable days, present/
   absent/leave totals, top 2 leave reasons, attendance % and a
   performance rating (Excellent / Good / Average / Poor).
   ============================================================ */
/* ============================================================
   SHARED REPORT HELPERS
   ============================================================ */
function _reportEscapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, ch => ({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    })[ch]);
}

/* Open the report card in a new window for reliable, full-page printing.
   Solves the "only top of report prints" bug caused by the modal's
   fixed positioning + max-height + overflow:hidden clipping. */
function _printReportNode(node, title) {
    if (!node) { toast("Nothing to print"); return; }
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) { toast("Pop-up blocked — please allow pop-ups to print."); return; }
    const html = node.innerHTML;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${_reportEscapeHtml(title || "Attendance Report")}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            *{box-sizing:border-box;margin:0;padding:0;}
            html,body{background:#fff;color:#0f172a;font-family:'Inter',Arial,sans-serif;}
            body{padding:28px;}
            #print-wrap{max-width:820px;margin:0 auto;background:linear-gradient(180deg,#ffffff 0%,#f8fafc 100%);
                border:1px solid #e2e8f0;border-radius:14px;padding:28px 30px;
                box-shadow:0 4px 12px rgba(2,6,23,0.06);}
            .report-card__head{display:flex;justify-content:space-between;align-items:flex-start;
                padding-bottom:14px;margin-bottom:18px;border-bottom:2px solid #6366f1;}
            .report-card__brand{display:flex;align-items:center;gap:12px;}
            .report-card__brand-icon{width:42px;height:42px;border-radius:10px;
                background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;
                display:grid;place-items:center;font-size:1.1rem;}
            .report-card__brand-name{font-weight:800;font-size:1.15rem;}
            .report-card__brand-sub{font-size:0.75rem;color:#64748b;letter-spacing:0.04em;}
            .report-card__period{text-align:right;}
            .report-card__period-label{font-size:0.7rem;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;}
            .report-card__period-value{font-weight:700;font-size:1rem;}
            .report-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px;}
            .report-meta__item{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;}
            .report-meta__item--full{grid-column:1/-1;}
            .report-meta__label{font-size:0.7rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;}
            .report-meta__value{font-weight:700;font-size:1rem;margin-top:2px;}
            h4{margin:0 0 10px;font-size:1rem;color:#1e293b;}
            .report-stats{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:18px;}
            .report-stat{padding:14px;border-radius:12px;color:#fff;display:flex;flex-direction:column;gap:4px;
                background:linear-gradient(135deg,#64748b,#475569);}
            .report-stat--present{background:linear-gradient(135deg,#10b981,#059669);}
            .report-stat--absent{background:linear-gradient(135deg,#ef4444,#dc2626);}
            .report-stat--leave{background:linear-gradient(135deg,#f59e0b,#d97706);}
            .report-stat--pct{background:linear-gradient(135deg,#6366f1,#4f46e5);}
            .report-stat__label{font-size:0.72rem;opacity:0.9;text-transform:uppercase;letter-spacing:0.05em;}
            .report-stat__value{font-size:1.5rem;font-weight:800;}
            .report-section{margin-top:14px;}
            .report-reasons-list{list-style:none;display:grid;gap:6px;}
            .report-reasons-list li{display:flex;justify-content:space-between;align-items:center;
                padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:0.88rem;}
            .report-reasons-list .rank{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;
                background:#6366f1;color:#fff;font-size:0.72rem;font-weight:700;margin-right:10px;}
            .report-reasons-list .count{background:#e0e7ff;color:#4338ca;font-weight:700;padding:2px 10px;border-radius:999px;font-size:0.78rem;}
            .report-empty-reasons{padding:10px 12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;color:#64748b;font-size:0.85rem;text-align:center;}
            .report-rating{margin-top:16px;padding:12px 16px;border-radius:10px;text-align:center;font-size:0.95rem;
                border:1px solid #e2e8f0;background:#f8fafc;}
            .report-rating strong{font-size:1.05rem;}
            .report-rating--excellent{background:#dcfce7;border-color:#86efac;color:#14532d;}
            .report-rating--good{background:#e0f2fe;border-color:#7dd3fc;color:#0c4a6e;}
            .report-rating--average,.report-rating--moderate{background:#fef3c7;border-color:#fcd34d;color:#78350f;}
            .report-rating--poor,.report-rating--bad{background:#fee2e2;border-color:#fca5a5;color:#7f1d1d;}
            .report-paragraph{margin-top:14px;padding:14px 16px;border-radius:10px;border-left:4px solid #6366f1;
                background:#f8fafc;color:#1e293b;font-size:0.9rem;line-height:1.55;}
            .report-signature{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px;padding-top:18px;border-top:1px dashed #cbd5e1;}
            .report-signature__block{font-size:0.8rem;color:#475569;}
            .report-signature__line{height:1px;background:#0f172a;margin:36px 0 6px;}
            .report-footer{margin-top:22px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:0.72rem;color:#64748b;text-align:center;}
            @page{margin:14mm;}
            @media print{button{display:none;}}
        </style></head><body>
        <div id="print-wrap">${html}</div>
        <script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script>
        </body></html>`);
    w.document.close();
}

/* Share a report card as an image via Web Share API or download fallback. */
async function _shareReportNode(node, title, text) {
    if (!node) { toast("Nothing to share"); return; }
    if (typeof html2canvas !== "function") {
        toast("Image library not loaded — please reload the page");
        return;
    }
    try {
        const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
        const dataUrl = canvas.toDataURL("image/png");
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], "attendance-report.png", { type: "image/png" });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title, text });
            return;
        }
        // Fallback: download image + open WhatsApp web
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = "attendance-report.png";
        document.body.appendChild(a); a.click(); a.remove();

        const waUrl = "https://wa.me/?text=" + encodeURIComponent(text + " (image saved to your device — attach it to the WhatsApp chat)");
        window.open(waUrl, "_blank", "noopener");
        toast("Image downloaded — attach it in WhatsApp");
    } catch (err) {
        if (err && err.name === "AbortError") return;
        console.warn("share failed", err);
        toast("Sharing was cancelled");
    }
}

/* Find the class teacher / class incharge name for a given class. */
function _getClassTeacher(className) {
    if (!className) return "Not Assigned";
    try {
        const configs = JSON.parse(localStorage.getItem('edu_class_configs') || '[]');
        const cfg = configs.find(c => c && c.name === className);
        if (cfg) {
            const t = cfg.classTeacher || cfg.teacher || cfg.incharge || cfg.classIncharge;
            if (t) return t;
        }
    } catch(e) {}
    try {
        const db = JSON.parse(localStorage.getItem('eduflow-db') || '{}');
        const teaching = (db.staff && db.staff['Teaching']) || [];
        const match = teaching.find(s => {
            const assigned = s.classTeacherOf || s.classTeacher || s.classIncharge || s.assignedClass;
            return assigned && String(assigned).trim() === className;
        });
        if (match && match.name) return match.name;
    } catch(e) {}
    return "Not Assigned";
}

/* Build a performance paragraph from a rating + stats. */
function _performanceParagraph(ratingCls, pct, scopeName) {
    const period = scopeName || "this period";
    switch (ratingCls) {
        case "excellent":
            return `Attendance for ${period} has been <strong>excellent</strong> at ${pct}%. Consistent presence reflects strong discipline, engagement and a positive academic attitude. Keep up this outstanding commitment.`;
        case "good":
            return `Attendance for ${period} has been <strong>good</strong> at ${pct}%. Engagement is steady and reliable; a small reduction in absences would push this into the excellent range.`;
        case "moderate":
        case "average":
            return `Attendance for ${period} has been <strong>moderate</strong> at ${pct}%. There is clear room for improvement — irregular attendance can begin to affect academic progress and continuity of learning.`;
        case "poor":
        case "bad":
        default:
            return `Attendance for ${period} has been <strong>poor</strong> at ${pct}%. This level of absence is a serious concern and is likely to impact academic performance. Immediate corrective action and closer monitoring are recommended.`;
    }
}

/* ============================================================
   STUDENT ATTENDANCE REPORT
   ============================================================ */
(function initStudentAttendanceReport() {
    if (typeof document === "undefined") return;

    const RANGE_DAYS = { week: 7, month: 30, year: 365 };
    const RANGE_LABEL = { week: "Last 1 Week", month: "Last 1 Month", year: "Last 1 Year" };

    document.addEventListener("DOMContentLoaded", () => {
        const openBtn   = document.getElementById("open-student-report-btn");
        const modal     = document.getElementById("student-report-modal");
        if (!openBtn || !modal) return;

        const scopeView  = document.getElementById("student-report-scope");
        const resultView = document.getElementById("student-report-result");
        const reportCard = document.getElementById("student-report-card");
        const shareBtn   = document.getElementById("student-report-share-btn");
        const printBtn   = document.getElementById("student-report-print-btn");

        function openModal() {
            if (!state.studentRecord) {
                toast("Open a student's record first");
                return;
            }
            modal.classList.remove("hidden");
            showScope();
        }
        function closeModal() { modal.classList.add("hidden"); }
        function showScope()  { scopeView.classList.remove("hidden");  resultView.classList.add("hidden"); }
        function showResult() { scopeView.classList.add("hidden");     resultView.classList.remove("hidden"); }

        openBtn.addEventListener("click", openModal);
        modal.querySelectorAll("[data-close-student-report]").forEach(el =>
            el.addEventListener("click", closeModal));
        modal.querySelectorAll("[data-back-student-scope]").forEach(el =>
            el.addEventListener("click", showScope));

        modal.querySelectorAll(".scope-btn[data-student-scope]").forEach(btn => {
            btn.addEventListener("click", () => {
                const scope = btn.getAttribute("data-student-scope");
                const data  = buildStudentReport(scope);
                reportCard.innerHTML = renderStudentReport(data);
                showResult();
            });
        });

        // FIXED: previously called undefined shareReport/printReport — buttons did nothing
        shareBtn.addEventListener("click", () => {
            const s = state.studentRecord || {};
            _shareReportNode(reportCard, "Student Attendance Report",
                `Student Attendance Report — ${s.name || ""} (${s.regNo || ""})`);
        });
        printBtn.addEventListener("click", () => {
            const s = state.studentRecord || {};
            _printReportNode(reportCard, `Attendance Report — ${s.name || ""}`);
        });
    });

    function _ratingFor(pct) {
        if (pct >= 95) return { label: "Excellent", cls: "excellent" };
        if (pct >= 85) return { label: "Good",      cls: "good" };
        if (pct >= 75) return { label: "Moderate",  cls: "moderate" };
        return            { label: "Poor",         cls: "poor" };
    }

    /* ---------- AGGREGATION ---------- */
    function buildStudentReport(scope) {
        const student = state.studentRecord;
        const days = RANGE_DAYS[scope];

        const allRecords = buildStudentFullHistory(student.regNo);
        const filtered = allRecords.filter(r => _recordWithinRange(r.date, String(days)));

        let present = 0, absent = 0, leave = 0;
        const reasonCounts = {};
        filtered.forEach(r => {
            if (r.status === "present") present++;
            else if (r.status === "absent") absent++;
            else if (r.status === "leave") {
                leave++;
                const reason = (r.reason || "Unspecified").trim() || "Unspecified";
                reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
            }
        });

        const totalMarkable = present + absent + leave;
        const pct = totalMarkable ? Math.round((present / totalMarkable) * 1000) / 10 : 0;
        const rating = _ratingFor(pct);

        const topReasons = Object.entries(reasonCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2);

        return {
            student,
            classTeacher: _getClassTeacher(student.class),
            scope,
            periodLabel: RANGE_LABEL[scope],
            totalMarkable, present, absent, leave,
            attendancePct: pct,
            rating,
            topReasons,
            generatedAt: new Date(),
        };
    }

    /* ---------- RENDER ---------- */
    function renderStudentReport(d) {
        const s = d.student;
        const esc = _reportEscapeHtml;
        const dateStr = d.generatedAt.toLocaleString();
        const reasonsHtml = d.topReasons.length
            ? `<ol class="report-reasons-list">${
                d.topReasons.map(([reason, count], i) =>
                    `<li><span><span class="rank">${i+1}</span>${esc(reason)}</span><span class="count">${count}</span></li>`
                ).join("")
              }</ol>`
            : `<div class="report-empty-reasons">No leave reasons recorded in this period.</div>`;

        const paragraph = _performanceParagraph(d.rating.cls, d.attendancePct, d.periodLabel);

        return `
            <div class="report-card__head">
                <div class="report-card__brand">
                    <div class="report-card__brand-icon"><i class="fas fa-graduation-cap"></i></div>
                    <div>
                        <div class="report-card__brand-name">EduFlow Pro</div>
                        <div class="report-card__brand-sub">ST. LAWRENCE INTERNATIONAL SCHOOL · Student Attendance Report</div>
                    </div>
                </div>
                <div class="report-card__period">
                    <div class="report-card__period-label">Period</div>
                    <div class="report-card__period-value">${esc(d.periodLabel)}</div>
                </div>
            </div>

            <div class="report-meta">
                <div class="report-meta__item">
                    <div class="report-meta__label">Student Name</div>
                    <div class="report-meta__value">${esc(s.name)}</div>
                </div>
                <div class="report-meta__item">
                    <div class="report-meta__label">Reg No</div>
                    <div class="report-meta__value">${esc(s.regNo)}</div>
                </div>
                <div class="report-meta__item">
                    <div class="report-meta__label">Class</div>
                    <div class="report-meta__value">${esc(s.class)}</div>
                </div>
                <div class="report-meta__item">
                    <div class="report-meta__label">Section</div>
                    <div class="report-meta__value">${esc(s.section)}</div>
                </div>
                <div class="report-meta__item">
                    <div class="report-meta__label">Guardian</div>
                    <div class="report-meta__value">${esc(s.guardian || "—")}</div>
                </div>
                <div class="report-meta__item">
                    <div class="report-meta__label">Class Teacher</div>
                    <div class="report-meta__value">${esc(d.classTeacher)}</div>
                </div>
            </div>

            <h4>Attendance Summary</h4>
            <div class="report-stats">
                <div class="report-stat">
                    <span class="report-stat__label">Total Markable Days</span>
                    <span class="report-stat__value">${d.totalMarkable}</span>
                </div>
                <div class="report-stat report-stat--present">
                    <span class="report-stat__label">Total Presence</span>
                    <span class="report-stat__value">${d.present}</span>
                </div>
                <div class="report-stat report-stat--absent">
                    <span class="report-stat__label">Total Absence</span>
                    <span class="report-stat__value">${d.absent}</span>
                </div>
                <div class="report-stat report-stat--leave">
                    <span class="report-stat__label">Total Leaves</span>
                    <span class="report-stat__value">${d.leave}</span>
                </div>
                <div class="report-stat report-stat--pct">
                    <span class="report-stat__label">Attendance %</span>
                    <span class="report-stat__value">${d.attendancePct}%</span>
                </div>
            </div>

            <div class="report-section">
                <h4>Top 2 Leave Reasons</h4>
                ${reasonsHtml}
            </div>

            <div class="report-rating report-rating--${d.rating.cls}">
                Overall Performance: <strong>${d.rating.label}</strong>
            </div>

            <div class="report-paragraph">${paragraph}</div>

            <div class="report-signature">
                <div class="report-signature__block">
                    <div class="report-signature__line"></div>
                    Class Teacher (${esc(d.classTeacher)})
                </div>
                <div class="report-signature__block">
                    <div class="report-signature__line"></div>
                    Principal / Administrator
                </div>
            </div>

            <div class="report-footer">
                Generated ${esc(dateStr)} · EduFlow Pro · ST. LAWRENCE INTERNATIONAL SCHOOL
            </div>
        `;
    }
})();

/* ============================================================
   CLASS ATTENDANCE REPORT (Monthly view → "Generate Report")
   ============================================================ */
(function initAttendanceReport() {
    if (typeof document === "undefined") return;

    const MONTH_NAMES = ["January","February","March","April","May","June",
                         "July","August","September","October","November","December"];

    document.addEventListener("DOMContentLoaded", () => {
        const openBtn = document.getElementById("open-report-btn");
        const modal   = document.getElementById("report-modal");
        if (!openBtn || !modal) return;

        const scopeView   = document.getElementById("report-scope");
        const resultView  = document.getElementById("report-result");
        const reportCard  = document.getElementById("report-card");
        const shareBtn    = document.getElementById("report-share-btn");
        const printBtn    = document.getElementById("report-print-btn");

        function openModal() {
            if (!state.monthlyClass) {
                toast("Open a class first to generate its report");
                return;
            }
            modal.classList.remove("hidden");
            showScope();
        }
        function closeModal() { modal.classList.add("hidden"); }
        function showScope()  { scopeView.classList.remove("hidden"); resultView.classList.add("hidden"); }
        function showResult() { scopeView.classList.add("hidden");    resultView.classList.remove("hidden"); }

        openBtn.addEventListener("click", openModal);
        modal.querySelectorAll("[data-close-report]").forEach(el =>
            el.addEventListener("click", closeModal));
        modal.querySelectorAll("[data-back-scope]").forEach(el =>
            el.addEventListener("click", showScope));

        modal.querySelectorAll(".scope-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const scope = btn.getAttribute("data-scope");
                if (!scope) return;
                const data  = buildReport(scope);
                reportCard.innerHTML = renderReport(data);
                showResult();
            });
        });

        shareBtn.addEventListener("click", () => {
            const cls = state.monthlyClass;
            _shareReportNode(reportCard, "Class Attendance Report",
                `Attendance Report — ${cls ? cls.name : ""}`);
        });
        printBtn.addEventListener("click", () => {
            const cls = state.monthlyClass;
            _printReportNode(reportCard, `Attendance Report — ${cls ? cls.name : ""}`);
        });
    });

    function _ratingFor(pct) {
        if (pct >= 95) return { label: "Excellent", cls: "excellent" };
        if (pct >= 85) return { label: "Good",      cls: "good" };
        if (pct >= 75) return { label: "Moderate",  cls: "moderate" };
        return            { label: "Poor",         cls: "poor" };
    }

    /* ---------- AGGREGATION ---------- */
    function buildReport(scope) {
        const cls = state.monthlyClass;
        const now = new Date();
        let year, month, periodLabel;

        if (scope === "month") {
            const d = state.monthlyDate || now;
            year  = d.getFullYear();
            month = d.getMonth();
            periodLabel = `${MONTH_NAMES[month]} ${year}`;
        } else {
            year  = now.getFullYear();
            month = null;
            periodLabel = `Year ${year}`;
        }

        const allStudents = STUDENTS.filter(s => s.class === cls.name);
        const sectionMap = {};
        allStudents.forEach(s => {
            sectionMap[s.section] = (sectionMap[s.section] || 0) + 1;
        });
        const sectionsLine = Object.keys(sectionMap).sort()
            .map(sec => `${sec} (${sectionMap[sec]})`).join(", ") || "—";

        const prefix = `eduflow_att_`;
        const suffix = `_${cls.name}`;
        let present = 0, absent = 0, leave = 0;
        const reasonCounts = {};
        const studentIds = new Set(allStudents.map(s => s.regNo));

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(prefix) || !key.endsWith(suffix)) continue;
            const dateStr = key.slice(prefix.length, key.length - suffix.length);
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) continue;
            if (d.getFullYear() !== year) continue;
            if (month !== null && d.getMonth() !== month) continue;

            let payload;
            try { payload = JSON.parse(localStorage.getItem(key)); }
            catch (e) { continue; }
            const records = (payload && payload.records) || {};
            Object.entries(records).forEach(([sid, entry]) => {
                if (!studentIds.has(sid)) return;
                const st = entry && entry.status;
                if (st === "present")      present++;
                else if (st === "absent")  absent++;
                else if (st === "leave") {
                    leave++;
                    const reason = (entry.reason || "Unspecified").trim() || "Unspecified";
                    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
                }
            });
        }

        const totalMarks = present + absent + leave;
        const pct = totalMarks ? Math.round((present / totalMarks) * 1000) / 10 : 0;
        const rating = _ratingFor(pct);

        const topReasons = Object.entries(reasonCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        return {
            className: cls.name,
            classTeacher: _getClassTeacher(cls.name),
            sectionsLine,
            totalStudents: allStudents.length,
            periodLabel,
            scope,
            present, absent, leave,
            totalMarks,
            attendancePct: pct,
            rating,
            topReasons,
            generatedAt: new Date(),
        };
    }

    /* ---------- RENDER ---------- */
    function renderReport(d) {
        const esc = _reportEscapeHtml;
        const dateStr = d.generatedAt.toLocaleString();
        const reasonsHtml = d.topReasons.length
            ? `<ol class="report-reasons-list">${
                d.topReasons.map(([reason, count], i) =>
                    `<li><span><span class="rank">${i+1}</span>${esc(reason)}</span><span class="count">${count}</span></li>`
                ).join("")
              }</ol>`
            : `<div class="report-empty-reasons">No leave reasons recorded in this period.</div>`;

        const paragraph = _performanceParagraph(d.rating.cls, d.attendancePct, d.periodLabel);

        return `
            <div class="report-card__head">
                <div class="report-card__brand">
                    <div class="report-card__brand-icon"><i class="fas fa-graduation-cap"></i></div>
                    <div>
                        <div class="report-card__brand-name">EduFlow Pro</div>
                        <div class="report-card__brand-sub">ST. LAWRENCE INTERNATIONAL SCHOOL · Class Attendance Report</div>
                    </div>
                </div>
                <div class="report-card__period">
                    <div class="report-card__period-label">${d.scope === "month" ? "Month" : "Year"}</div>
                    <div class="report-card__period-value">${esc(d.periodLabel)}</div>
                </div>
            </div>

            <div class="report-meta">
                <div class="report-meta__item">
                    <div class="report-meta__label">Class</div>
                    <div class="report-meta__value">${esc(d.className)}</div>
                </div>
                <div class="report-meta__item">
                    <div class="report-meta__label">Class Teacher</div>
                    <div class="report-meta__value">${esc(d.classTeacher)}</div>
                </div>
                <div class="report-meta__item">
                    <div class="report-meta__label">Sections</div>
                    <div class="report-meta__value">${esc(d.sectionsLine)}</div>
                </div>
                <div class="report-meta__item">
                    <div class="report-meta__label">Total Students</div>
                    <div class="report-meta__value">${d.totalStudents}</div>
                </div>
            </div>

            <h4>Attendance Summary</h4>
            <div class="report-stats">
                <div class="report-stat">
                    <span class="report-stat__label">Total Markable</span>
                    <span class="report-stat__value">${d.totalMarks}</span>
                </div>
                <div class="report-stat report-stat--present">
                    <span class="report-stat__label">Total Present</span>
                    <span class="report-stat__value">${d.present}</span>
                </div>
                <div class="report-stat report-stat--absent">
                    <span class="report-stat__label">Total Absent</span>
                    <span class="report-stat__value">${d.absent}</span>
                </div>
                <div class="report-stat report-stat--leave">
                    <span class="report-stat__label">Total Leave</span>
                    <span class="report-stat__value">${d.leave}</span>
                </div>
                <div class="report-stat report-stat--pct">
                    <span class="report-stat__label">Attendance %</span>
                    <span class="report-stat__value">${d.attendancePct}%</span>
                </div>
            </div>

            <div class="report-section">
                <h4>Top 5 Leave Reasons</h4>
                ${reasonsHtml}
            </div>

            <div class="report-rating report-rating--${d.rating.cls}">
                Overall Class Performance: <strong>${d.rating.label}</strong>
            </div>

            <div class="report-paragraph">${paragraph}</div>

            <div class="report-signature">
                <div class="report-signature__block">
                    <div class="report-signature__line"></div>
                    Class Teacher (${esc(d.classTeacher)})
                </div>
                <div class="report-signature__block">
                    <div class="report-signature__line"></div>
                    Principal / Administrator
                </div>
            </div>

            <div class="report-footer">
                Generated ${esc(dateStr)} · EduFlow Pro · ST. LAWRENCE INTERNATIONAL SCHOOL
            </div>
        `;
    }
})();

/* ============================================================
   STAFF MONTHLY GRID + STAFF INDIVIDUAL RECORD + STAFF REPORTS
   Mirrors the student monthly / record / report flow.
   ============================================================ */
state.staffMonthlyDate   = new Date();
state.staffMonthlySearch = "";
state.staffRecord        = null;
state.staffRecordSearch  = "";
state.staffRecordRange   = "30";

function openStaffMonthly() {
    refreshLiveData();
    state.staffMonthlyDate = new Date();
    state.staffMonthlySearch = "";
    const si = document.getElementById("staff-monthly-search");
    if (si) si.value = "";
    hideAllStages();
    show("#stage-staff-monthly");
    renderStaffMonthly();
}

function renderStaffMonthly() {
    const d = state.staffMonthlyDate;
    const year = d.getFullYear();
    const month = d.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const label = document.getElementById("staff-month-label");
    if (label) label.textContent = `${_MONTHS[month]} ${year}`;

    const q = (state.staffMonthlySearch || "").trim().toLowerCase();
    const staff = STAFF.filter(s =>
        !q
        || s.name.toLowerCase().includes(q)
        || s.id.toLowerCase().includes(q)
        || (s.role || "").toLowerCase().includes(q)
    );

    const table = document.getElementById("staff-monthly-table");
    const emptyEl = document.getElementById("staff-monthly-empty");
    if (staff.length === 0) {
        table.innerHTML = "";
        emptyEl.innerHTML = STAFF.length === 0
            ? `<i class="fas fa-user-slash"></i><p>No staff found. Add staff in <a href="manage-staff.html" style="color:var(--accent);">Staff Management</a>.</p>`
            : `<i class="fas fa-search"></i><p>No staff match your search.</p>`;
        emptyEl.classList.remove("hidden");
        return;
    }
    emptyEl.classList.add("hidden");

    // Pre-load daily staff records
    const dayRecords = {};
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const raw = localStorage.getItem(`eduflow_staff_att_${dateKey}`);
        if (raw) {
            try { dayRecords[dateKey] = JSON.parse(raw).records || {}; }
            catch(e) { dayRecords[dateKey] = {}; }
        } else {
            dayRecords[dateKey] = null;
        }
    }

    let headHtml = `<thead>
        <tr>
            <th class="col-id" rowspan="2">Staff ID</th>
            <th class="col-name" rowspan="2">Name <span style="font-weight:400;font-size:0.65rem;color:var(--text-muted);">(double-click row for full record)</span></th>
            <th class="col-guardian" rowspan="2">Job</th>
            <th colspan="${daysInMonth}" style="background:var(--bg-secondary);">
                Enter: <span class="mark-P">P</span>=Present,
                <span class="mark-A">A</span>=Absent,
                <span class="mark-L">L</span>=Leave
            </th>
            <th rowspan="2">P</th>
            <th rowspan="2">A</th>
            <th rowspan="2">L</th>
        </tr>
        <tr>`;
    for (let day = 1; day <= daysInMonth; day++) {
        const wd = new Date(year, month, day).getDay();
        const isWeekend = wd === 0 || wd === 6;
        headHtml += `<th class="${isWeekend ? "day-weekend" : ""}">
            <div style="font-size:0.7rem;color:var(--text-muted);">${_WD[wd]}</div>
            <div>${day}</div>
        </th>`;
    }
    headHtml += `</tr></thead>`;

    let bodyHtml = "<tbody>";
    staff.forEach(s => {
        let p=0,a=0,l=0;
        let rowHtml = `<tr class="clickable-row" data-staffid="${escapeHtml(s.id)}" title="Double-click to view full attendance record">
            <td class="col-id"><span class="id-badge">${escapeHtml(s.id)}</span></td>
            <td class="col-name">${escapeHtml(s.name)}</td>
            <td class="col-guardian">${escapeHtml(s.role || "—")}</td>`;
        for (let day = 1; day <= daysInMonth; day++) {
            const dateKey = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const recs = dayRecords[dateKey];
            const wd = new Date(year, month, day).getDay();
            const isWeekend = wd === 0 || wd === 6;
            let mark = "–", cls2 = "mark-empty";
            if (recs && recs[s.id]) {
                const st = recs[s.id].status;
                if (st === "present")     { mark = "P"; cls2 = "mark-P"; p++; }
                else if (st === "absent") { mark = "A"; cls2 = "mark-A"; a++; }
                else if (st === "leave")  { mark = "L"; cls2 = "mark-L"; l++; }
            }
            rowHtml += `<td class="${isWeekend ? "day-weekend" : ""}"><span class="mark ${cls2}">${mark}</span></td>`;
        }
        rowHtml += `<td class="mark-P"><strong>${p}</strong></td>
                    <td class="mark-A"><strong>${a}</strong></td>
                    <td class="mark-L"><strong>${l}</strong></td></tr>`;
        bodyHtml += rowHtml;
    });
    bodyHtml += "</tbody>";

    table.innerHTML = headHtml + bodyHtml;

    table.querySelectorAll("tbody tr.clickable-row").forEach(row => {
        row.addEventListener("dblclick", () => {
            const sid = row.getAttribute("data-staffid");
            const member = STAFF.find(x => x.id === sid);
            if (member) openStaffRecord(member);
        });
    });
}

/* ---------- Staff monthly toolbar wiring (init once on DOM ready) ---------- */
document.addEventListener("DOMContentLoaded", () => {
    const prev = document.getElementById("staff-month-prev");
    const next = document.getElementById("staff-month-next");
    const search = document.getElementById("staff-monthly-search");
    if (prev) prev.addEventListener("click", () => {
        const d = new Date(state.staffMonthlyDate);
        d.setDate(1); d.setMonth(d.getMonth() - 1);
        state.staffMonthlyDate = d;
        renderStaffMonthly();
    });
    if (next) next.addEventListener("click", () => {
        const d = new Date(state.staffMonthlyDate);
        d.setDate(1); d.setMonth(d.getMonth() + 1);
        state.staffMonthlyDate = d;
        renderStaffMonthly();
    });
    if (search) search.addEventListener("input", (e) => {
        state.staffMonthlySearch = e.target.value;
        renderStaffMonthly();
    });

    /* Print / Share for the full-staff monthly grid */
    const printBtn = document.getElementById("staff-monthly-print-btn");
    if (printBtn) {
        printBtn.addEventListener("click", () => {
            const d = state.staffMonthlyDate;
            const title = `Staff Monthly Attendance — ${_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
            const tableHtml = document.querySelector("#stage-staff-monthly .table-card").outerHTML;
            const dateStr = new Date().toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'});
            const w = window.open("", "_blank", "width=1200,height=900");
            if (!w) { toast("Pop-up blocked — please allow pop-ups to print."); return; }
            w.document.write(`<!doctype html><html><head><title>${title}</title>
                <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
                <style>
                    body{font-family:Inter,Arial,sans-serif;padding:20px;color:#0f172a;}
                    h1{font-size:20px;margin:0 0 4px;} .sub{color:#64748b;font-size:12px;margin-bottom:14px;}
                    table{width:100%;border-collapse:collapse;font-size:11px;}
                    th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:center;}
                    th{background:#f1f5f9;}
                    .mark-P{color:#15803d;font-weight:700;} .mark-A{color:#b91c1c;font-weight:700;}
                    .mark-L{color:#a16207;font-weight:700;} .mark-empty{color:#94a3b8;}
                    .id-badge{font-family:monospace;background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:10px;}
                    .day-weekend{background:#f8fafc;}
                    @media print { button{display:none;} @page{size:landscape;margin:10mm;} }
                </style></head><body>
                <h1>${title}</h1>
                <div class="sub">St. Lawrence International School &middot; ${dateStr}</div>
                ${tableHtml}
                <script>window.onload=()=>setTimeout(()=>window.print(),300);<\/script>
                </body></html>`);
            w.document.close();
        });
    }
    const shareBtn = document.getElementById("staff-monthly-share-btn");
    if (shareBtn) {
        shareBtn.addEventListener("click", async () => {
            const d = state.staffMonthlyDate;
            const title = `Staff Monthly Attendance — ${_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
            const table = document.getElementById("staff-monthly-table");
            let text = `${title}\n${new Date().toLocaleDateString()}\n\n`;
            table.querySelectorAll("tbody tr").forEach(tr => {
                const cells = [...tr.querySelectorAll("td")].slice(0, 3).map(td => td.innerText.trim());
                const tail = [...tr.querySelectorAll("td")].slice(-3).map(td => td.innerText.trim());
                text += cells.join(" | ") + "  →  P:" + tail[0] + " A:" + tail[1] + " L:" + tail[2] + "\n";
            });
            try {
                if (navigator.share) { await navigator.share({ title, text }); toast("Shared"); }
                else if (navigator.clipboard) { await navigator.clipboard.writeText(text); toast("Report copied to clipboard"); }
                else { const w = window.open(""); w.document.write("<pre>"+text.replace(/</g,"&lt;")+"</pre>"); }
            } catch(e) {
                if (e && e.name === "AbortError") return;
                try { await navigator.clipboard.writeText(text); toast("Report copied"); } catch(_) { toast("Unable to share"); }
            }
        });
    }
});

/* ---------- INDIVIDUAL STAFF RECORD ---------- */
function buildStaffFullHistory(staffId) {
    const records = [];
    for (let key in localStorage) {
        if (!key.startsWith('eduflow_staff_att_')) continue;
        try {
            const payload = JSON.parse(localStorage.getItem(key));
            if (!payload || !payload.records) continue;
            const entry = payload.records[staffId];
            if (entry) records.push({ date: payload.date, status: entry.status, reason: entry.reason || "" });
        } catch(e) {}
    }
    records.sort((a, b) => b.date.localeCompare(a.date));
    return records;
}

function openStaffRecord(member) {
    state.staffRecord = member;
    state.staffRecordSearch = "";
    state.staffRecordRange = "30";
    document.getElementById("staff-record-title").textContent = `${member.name} — Attendance Record`;
    const srch = document.getElementById("staff-record-search");
    if (srch) srch.value = "";
    document.querySelectorAll("#staff-record-filters .filter-btn").forEach(b => b.classList.remove("active"));
    const def = document.querySelector('#staff-record-filters .filter-btn[data-range="30"]');
    if (def) def.classList.add("active");

    const initials = member.name.split(/\s+/).map(w => w[0]).slice(0,2).join("").toUpperCase();
    document.getElementById("staff-record-profile").innerHTML = `
        <div class="record-avatar">${escapeHtml(initials || "?")}</div>
        <div class="record-meta">
            <span class="name">${escapeHtml(member.name)}</span>
            <span class="sub">Staff ID: ${escapeHtml(member.id)} &middot; ${escapeHtml(member.role || "")} &middot; ${escapeHtml(member.department || "")}</span>
        </div>
        <div class="record-tags">
            <div class="record-tag">Department: <strong>${escapeHtml(member.department || "—")}</strong></div>
        </div>
    `;
    hideAllStages();
    show("#stage-staff-record");
    renderStaffRecord();
}

function renderStaffRecord() {
    const member = state.staffRecord;
    if (!member) return;
    const all = buildStaffFullHistory(member.id);
    const filtered = all
        .filter(r => _recordWithinRange(r.date, state.staffRecordRange))
        .filter(r => _matchesRecordSearch(r, state.staffRecordSearch));

    let p=0,a=0,l=0;
    filtered.forEach(r => { if(r.status==="present")p++; else if(r.status==="absent")a++; else if(r.status==="leave")l++; });
    const total = filtered.length;
    const pct = total ? Math.round((p/total)*1000)/10 : 0;

    document.getElementById("staff-record-kpis").innerHTML = `
        <div class="kpi-card"><div class="kpi-icon icon-indigo"><i class="fas fa-calendar-check"></i></div>
            <div class="kpi-meta"><div class="kpi-label">Total Marked Days</div><div class="kpi-value">${total}</div></div></div>
        <div class="kpi-card"><div class="kpi-icon icon-emerald"><i class="fas fa-check"></i></div>
            <div class="kpi-meta"><div class="kpi-label">Present</div><div class="kpi-value">${p}</div></div></div>
        <div class="kpi-card"><div class="kpi-icon icon-rose"><i class="fas fa-times"></i></div>
            <div class="kpi-meta"><div class="kpi-label">Absent</div><div class="kpi-value">${a}</div></div></div>
        <div class="kpi-card"><div class="kpi-icon icon-amber"><i class="fas fa-clock"></i></div>
            <div class="kpi-meta"><div class="kpi-label">Leave</div><div class="kpi-value">${l}</div></div></div>
        <div class="kpi-card"><div class="kpi-icon icon-indigo"><i class="fas fa-percent"></i></div>
            <div class="kpi-meta"><div class="kpi-label">Attendance %</div><div class="kpi-value">${pct}%</div></div></div>
    `;

    const list = document.getElementById("staff-history-list");
    const empty = document.getElementById("staff-history-empty");
    list.innerHTML = "";
    if (filtered.length === 0) { empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");

    filtered.forEach(r => {
        const cls = r.status === "present" ? "present" : r.status === "absent" ? "absent" : "leave";
        const label = r.status.charAt(0).toUpperCase() + r.status.slice(1);
        const dateLabel = new Date(r.date).toLocaleDateString(undefined, { weekday:'short', year:'numeric', month:'short', day:'numeric' });
        const row = document.createElement("div");
        row.className = "history-row";
        row.innerHTML = `
            <span class="history-date">${escapeHtml(dateLabel)}</span>
            <span class="history-reason">${escapeHtml(r.reason) || "—"}</span>
            <span class="history-status ${cls}">${label}</span>
        `;
        list.appendChild(row);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const search = document.getElementById("staff-record-search");
    if (search) search.addEventListener("input", (e) => {
        state.staffRecordSearch = e.target.value.trim();
        renderStaffRecord();
    });
    document.querySelectorAll("#staff-record-filters .filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#staff-record-filters .filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.staffRecordRange = btn.getAttribute("data-range");
            renderStaffRecord();
        });
    });
});

/* ============================================================
   FULL STAFF ATTENDANCE REPORT (Staff Monthly view → Generate)
   ============================================================ */
(function initStaffFullReport() {
    if (typeof document === "undefined") return;
    const MONTH_NAMES = ["January","February","March","April","May","June",
                         "July","August","September","October","November","December"];

    document.addEventListener("DOMContentLoaded", () => {
        const openBtn = document.getElementById("open-staff-report-btn");
        const modal   = document.getElementById("staff-report-modal");
        if (!openBtn || !modal) return;
        const scopeView  = document.getElementById("staff-report-scope");
        const resultView = document.getElementById("staff-report-result");
        const card       = document.getElementById("staff-report-card");
        const shareBtn   = document.getElementById("staff-report-share-btn");
        const printBtn   = document.getElementById("staff-report-print-btn");

        function open()  { if (STAFF.length === 0) { toast("No staff to report on"); return; } modal.classList.remove("hidden"); showScope(); }
        function close() { modal.classList.add("hidden"); }
        function showScope()  { scopeView.classList.remove("hidden"); resultView.classList.add("hidden"); }
        function showResult() { scopeView.classList.add("hidden");    resultView.classList.remove("hidden"); }

        openBtn.addEventListener("click", open);
        modal.querySelectorAll("[data-close-staff-report]").forEach(el => el.addEventListener("click", close));
        modal.querySelectorAll("[data-back-staff-scope]").forEach(el => el.addEventListener("click", showScope));
        modal.querySelectorAll(".scope-btn[data-staff-scope]").forEach(btn => {
            btn.addEventListener("click", () => {
                const scope = btn.getAttribute("data-staff-scope");
                const data  = build(scope);
                card.innerHTML = render(data);
                showResult();
            });
        });
        shareBtn.addEventListener("click", () => _shareReportNode(card, "Staff Attendance Report", "Staff Attendance Report"));
        printBtn.addEventListener("click", () => _printReportNode(card, "Staff Attendance Report"));
    });

    function _ratingFor(pct) {
        if (pct >= 95) return { label: "Excellent", cls: "excellent" };
        if (pct >= 85) return { label: "Good",      cls: "good" };
        if (pct >= 75) return { label: "Moderate",  cls: "moderate" };
        return            { label: "Poor",         cls: "poor" };
    }

    function build(scope) {
        const now = new Date();
        let year, month, periodLabel;
        if (scope === "month") {
            const d = state.staffMonthlyDate || now;
            year = d.getFullYear(); month = d.getMonth();
            periodLabel = `${MONTH_NAMES[month]} ${year}`;
        } else {
            year = now.getFullYear(); month = null;
            periodLabel = `Year ${year}`;
        }
        let present=0, absent=0, leave=0;
        const reasonCounts = {};
        const staffIds = new Set(STAFF.map(s => s.id));
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith("eduflow_staff_att_")) continue;
            const dateStr = key.replace("eduflow_staff_att_", "");
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) continue;
            if (d.getFullYear() !== year) continue;
            if (month !== null && d.getMonth() !== month) continue;
            let payload; try { payload = JSON.parse(localStorage.getItem(key)); } catch(e) { continue; }
            const records = (payload && payload.records) || {};
            Object.entries(records).forEach(([sid, entry]) => {
                if (!staffIds.has(sid)) return;
                const st = entry && entry.status;
                if (st === "present") present++;
                else if (st === "absent") absent++;
                else if (st === "leave") {
                    leave++;
                    const reason = (entry.reason || "Unspecified").trim() || "Unspecified";
                    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
                }
            });
        }
        const totalMarks = present + absent + leave;
        const pct = totalMarks ? Math.round((present/totalMarks)*1000)/10 : 0;
        const topReasons = Object.entries(reasonCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
        // department distribution
        const deptMap = {};
        STAFF.forEach(s => { deptMap[s.role || "Staff"] = (deptMap[s.role || "Staff"] || 0) + 1; });
        const rolesLine = Object.keys(deptMap).sort().map(r => `${r} (${deptMap[r]})`).join(", ") || "—";
        return {
            scope, periodLabel,
            totalStaff: STAFF.length, rolesLine,
            present, absent, leave, totalMarks,
            attendancePct: pct, rating: _ratingFor(pct),
            topReasons, generatedAt: new Date(),
        };
    }

    function render(d) {
        const esc = _reportEscapeHtml;
        const dateStr = d.generatedAt.toLocaleString();
        const reasonsHtml = d.topReasons.length
            ? `<ol class="report-reasons-list">${d.topReasons.map(([r,c],i)=>`<li><span><span class="rank">${i+1}</span>${esc(r)}</span><span class="count">${c}</span></li>`).join("")}</ol>`
            : `<div class="report-empty-reasons">No leave reasons recorded in this period.</div>`;
        const paragraph = _performanceParagraph(d.rating.cls, d.attendancePct, d.periodLabel);
        return `
            <div class="report-card__head">
                <div class="report-card__brand">
                    <div class="report-card__brand-icon"><i class="fas fa-graduation-cap"></i></div>
                    <div>
                        <div class="report-card__brand-name">EduFlow Pro</div>
                        <div class="report-card__brand-sub">ST. LAWRENCE INTERNATIONAL SCHOOL · Staff Attendance Report</div>
                    </div>
                </div>
                <div class="report-card__period">
                    <div class="report-card__period-label">${d.scope === "month" ? "Month" : "Year"}</div>
                    <div class="report-card__period-value">${esc(d.periodLabel)}</div>
                </div>
            </div>
            <div class="report-meta">
                <div class="report-meta__item"><div class="report-meta__label">Total Staff</div><div class="report-meta__value">${d.totalStaff}</div></div>
                <div class="report-meta__item report-meta__item--full"><div class="report-meta__label">Roles</div><div class="report-meta__value">${esc(d.rolesLine)}</div></div>
            </div>
            <h4>Attendance Summary</h4>
            <div class="report-stats">
                <div class="report-stat"><span class="report-stat__label">Total Markable</span><span class="report-stat__value">${d.totalMarks}</span></div>
                <div class="report-stat report-stat--present"><span class="report-stat__label">Total Present</span><span class="report-stat__value">${d.present}</span></div>
                <div class="report-stat report-stat--absent"><span class="report-stat__label">Total Absent</span><span class="report-stat__value">${d.absent}</span></div>
                <div class="report-stat report-stat--leave"><span class="report-stat__label">Total Leave</span><span class="report-stat__value">${d.leave}</span></div>
                <div class="report-stat report-stat--pct"><span class="report-stat__label">Attendance %</span><span class="report-stat__value">${d.attendancePct}%</span></div>
            </div>
            <div class="report-section"><h4>Top 5 Leave Reasons</h4>${reasonsHtml}</div>
            <div class="report-rating report-rating--${d.rating.cls}">Overall Staff Performance: <strong>${d.rating.label}</strong></div>
            <div class="report-paragraph">${paragraph}</div>
            <div class="report-signature">
                <div class="report-signature__block"><div class="report-signature__line"></div>HR / Administrator</div>
                <div class="report-signature__block"><div class="report-signature__line"></div>Principal</div>
            </div>
            <div class="report-footer">Generated ${esc(dateStr)} · EduFlow Pro · ST. LAWRENCE INTERNATIONAL SCHOOL</div>
        `;
    }
})();

/* ============================================================
   INDIVIDUAL STAFF ATTENDANCE REPORT
   ============================================================ */
(function initStaffIndividualReport() {
    if (typeof document === "undefined") return;
    const RANGE_DAYS  = { week: 7, month: 30, year: 365 };
    const RANGE_LABEL = { week: "Last 1 Week", month: "Last 1 Month", year: "Last 1 Year" };

    document.addEventListener("DOMContentLoaded", () => {
        const openBtn = document.getElementById("open-staff-individual-report-btn");
        const modal   = document.getElementById("staff-individual-report-modal");
        if (!openBtn || !modal) return;
        const scopeView  = document.getElementById("staff-individual-report-scope");
        const resultView = document.getElementById("staff-individual-report-result");
        const card       = document.getElementById("staff-individual-report-card");
        const shareBtn   = document.getElementById("staff-individual-report-share-btn");
        const printBtn   = document.getElementById("staff-individual-report-print-btn");

        function open()  { if (!state.staffRecord) { toast("Open a staff record first"); return; } modal.classList.remove("hidden"); showScope(); }
        function close() { modal.classList.add("hidden"); }
        function showScope()  { scopeView.classList.remove("hidden"); resultView.classList.add("hidden"); }
        function showResult() { scopeView.classList.add("hidden");    resultView.classList.remove("hidden"); }

        openBtn.addEventListener("click", open);
        modal.querySelectorAll("[data-close-staff-individual-report]").forEach(el => el.addEventListener("click", close));
        modal.querySelectorAll("[data-back-staff-individual-scope]").forEach(el => el.addEventListener("click", showScope));
        modal.querySelectorAll(".scope-btn[data-staff-individual-scope]").forEach(btn => {
            btn.addEventListener("click", () => {
                const scope = btn.getAttribute("data-staff-individual-scope");
                const data  = build(scope);
                card.innerHTML = render(data);
                showResult();
            });
        });
        shareBtn.addEventListener("click", () => {
            const s = state.staffRecord || {};
            _shareReportNode(card, "Staff Attendance Report", `Staff Attendance Report — ${s.name || ""} (${s.id || ""})`);
        });
        printBtn.addEventListener("click", () => {
            const s = state.staffRecord || {};
            _printReportNode(card, `Attendance Report — ${s.name || ""}`);
        });
    });

    function _ratingFor(pct) {
        if (pct >= 95) return { label: "Excellent", cls: "excellent" };
        if (pct >= 85) return { label: "Good",      cls: "good" };
        if (pct >= 75) return { label: "Moderate",  cls: "moderate" };
        return            { label: "Poor",         cls: "poor" };
    }

    function build(scope) {
        const member = state.staffRecord;
        const days = RANGE_DAYS[scope];
        const all = buildStaffFullHistory(member.id);
        const filtered = all.filter(r => _recordWithinRange(r.date, String(days)));
        let present=0, absent=0, leave=0;
        const reasonCounts = {};
        filtered.forEach(r => {
            if (r.status === "present") present++;
            else if (r.status === "absent") absent++;
            else if (r.status === "leave") {
                leave++;
                const reason = (r.reason || "Unspecified").trim() || "Unspecified";
                reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
            }
        });
        const totalMarkable = present + absent + leave;
        const pct = totalMarkable ? Math.round((present/totalMarkable)*1000)/10 : 0;
        const topReasons = Object.entries(reasonCounts).sort((a,b)=>b[1]-a[1]).slice(0,2);
        return {
            member, scope, periodLabel: RANGE_LABEL[scope],
            totalMarkable, present, absent, leave,
            attendancePct: pct, rating: _ratingFor(pct),
            topReasons, generatedAt: new Date(),
        };
    }

    function render(d) {
        const s = d.member;
        const esc = _reportEscapeHtml;
        const dateStr = d.generatedAt.toLocaleString();
        const reasonsHtml = d.topReasons.length
            ? `<ol class="report-reasons-list">${d.topReasons.map(([r,c],i)=>`<li><span><span class="rank">${i+1}</span>${esc(r)}</span><span class="count">${c}</span></li>`).join("")}</ol>`
            : `<div class="report-empty-reasons">No leave reasons recorded in this period.</div>`;
        const paragraph = _performanceParagraph(d.rating.cls, d.attendancePct, d.periodLabel);
        return `
            <div class="report-card__head">
                <div class="report-card__brand">
                    <div class="report-card__brand-icon"><i class="fas fa-graduation-cap"></i></div>
                    <div>
                        <div class="report-card__brand-name">EduFlow Pro</div>
                        <div class="report-card__brand-sub">ST. LAWRENCE INTERNATIONAL SCHOOL · Staff Attendance Report</div>
                    </div>
                </div>
                <div class="report-card__period">
                    <div class="report-card__period-label">Period</div>
                    <div class="report-card__period-value">${esc(d.periodLabel)}</div>
                </div>
            </div>
            <div class="report-meta">
                <div class="report-meta__item"><div class="report-meta__label">Name</div><div class="report-meta__value">${esc(s.name)}</div></div>
                <div class="report-meta__item"><div class="report-meta__label">Staff ID</div><div class="report-meta__value">${esc(s.id)}</div></div>
                <div class="report-meta__item"><div class="report-meta__label">Job / Role</div><div class="report-meta__value">${esc(s.role || "—")}</div></div>
                <div class="report-meta__item"><div class="report-meta__label">Department</div><div class="report-meta__value">${esc(s.department || "—")}</div></div>
            </div>
            <h4>Attendance Summary</h4>
            <div class="report-stats">
                <div class="report-stat"><span class="report-stat__label">Total Markable Days</span><span class="report-stat__value">${d.totalMarkable}</span></div>
                <div class="report-stat report-stat--present"><span class="report-stat__label">Total Presence</span><span class="report-stat__value">${d.present}</span></div>
                <div class="report-stat report-stat--absent"><span class="report-stat__label">Total Absence</span><span class="report-stat__value">${d.absent}</span></div>
                <div class="report-stat report-stat--leave"><span class="report-stat__label">Total Leaves</span><span class="report-stat__value">${d.leave}</span></div>
                <div class="report-stat report-stat--pct"><span class="report-stat__label">Attendance %</span><span class="report-stat__value">${d.attendancePct}%</span></div>
            </div>
            <div class="report-section"><h4>Top 2 Leave Reasons</h4>${reasonsHtml}</div>
            <div class="report-rating report-rating--${d.rating.cls}">Overall Performance: <strong>${d.rating.label}</strong></div>
            <div class="report-paragraph">${paragraph}</div>
            <div class="report-signature">
                <div class="report-signature__block"><div class="report-signature__line"></div>HR / Administrator</div>
                <div class="report-signature__block"><div class="report-signature__line"></div>Principal</div>
            </div>
            <div class="report-footer">Generated ${esc(dateStr)} · EduFlow Pro · ST. LAWRENCE INTERNATIONAL SCHOOL</div>
        `;
    }
})();
