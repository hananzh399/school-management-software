
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
    ["#stage-mode","#stage-submode","#stage-classes","#stage-table","#stage-staff","#stage-view"].forEach(hide);
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
                // Rebuild history from real saved records
                STUDENT_HISTORY = buildRealStudentHistory(STUDENTS);
                STAFF_HISTORY   = buildRealStaffHistory(STAFF);
                renderView();
                show("#stage-view");
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
        card.addEventListener("click", () => openClass(cls));
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
