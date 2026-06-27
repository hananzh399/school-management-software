
/* EduFlow Pro — Attendance module
   Flow: mode (Staff/Student) -> submode (Add/View) -> form or analytics
*/
 
// ---------- MOCK DATA ----------
const CLASSES = [
    { name: "Class 1",  sections: ["A", "B", "C"] },
    { name: "Class 2",  sections: ["A", "B", "C"] },
    { name: "Class 3",  sections: ["A", "B"] },
    { name: "Class 4",  sections: ["A", "B"] },
    { name: "Class 5",  sections: ["A", "B"] },
    { name: "Class 6",  sections: ["A", "B"] },
    { name: "Class 7",  sections: ["A"] },
    { name: "Class 8",  sections: ["A"] },
    { name: "Class 9",  sections: ["A", "B"] },
    { name: "Class 10", sections: ["A", "B"] },
];
 
const FIRST_NAMES = ["Ali","Ahmad","Hassan","Hussain","Tahir","Timur","Aman","Bilal","Fatima","Ayesha","Zara","Hira","Sara","Maryam","Ibrahim","Yusuf","Omar","Saad","Hamza","Zainab"];
const GUARDIANS  = ["Ahmad Khan","Ibrahim Ali","Yusuf Raza","Tariq Mehmood","Imran Sheikh","Kashif Iqbal","Adnan Malik","Faisal Aziz","Naseer Ahmed","Salman Tariq"];
const LEAVE_REASONS = ["Sick Leave","Personal","Family Event","Medical Appointment","Travel","Other"];
 
let seed = 1;
function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
 
let _nextId = 771;
function buildStudents() {
    const all = [];
    for (const cls of CLASSES) {
        for (const section of cls.sections) {
            const count = 8 + Math.floor(rand() * 8);
            for (let i = 0; i < count; i++) {
                all.push({
                    regNo: `HRK_${_nextId++}`,
                    name: `${pick(FIRST_NAMES)} ${pick(FIRST_NAMES)}`,
                    class: cls.name,
                    section,
                    guardian: pick(GUARDIANS),
                });
            }
        }
    }
    return all;
}
const STUDENTS = buildStudents();
 
const STAFF = [
    { id: "STF_001", name: "Mr. Imran Sheikh",  role: "Teacher",       department: "Mathematics" },
    { id: "STF_002", name: "Ms. Ayesha Khan",    role: "Teacher",       department: "English" },
    { id: "STF_003", name: "Mr. Tariq Mehmood",  role: "Teacher",       department: "Science" },
    { id: "STF_004", name: "Ms. Fatima Raza",    role: "Teacher",       department: "Urdu" },
    { id: "STF_005", name: "Mr. Adnan Malik",    role: "Coordinator",   department: "Primary" },
    { id: "STF_006", name: "Ms. Maryam Iqbal",   role: "Teacher",       department: "Islamiat" },
    { id: "STF_007", name: "Mr. Saad Hussain",   role: "Lab Assistant", department: "Computer" },
    { id: "STF_008", name: "Mr. Kashif Aziz",    role: "Admin",         department: "Office" },
    { id: "STF_009", name: "Mrs. Zara Naseer",   role: "Teacher",       department: "Arts" },
    { id: "STF_010", name: "Mr. Hamza Faisal",   role: "PE Teacher",    department: "Sports" },
];
 
// ---------- HISTORICAL MOCK (for View) ----------
// generate ~365 days of records per person
function buildHistory(people, idKey) {
    const today = new Date(); today.setHours(0,0,0,0);
    const hist = {};
    for (const p of people) {
        const records = [];
        for (let d = 0; d < 365; d++) {
            const day = new Date(today); day.setDate(today.getDate() - d);
            const r = rand();
            let status, reason = null;
            if (r < 0.82) status = "present";
            else if (r < 0.93) status = "absent";
            else { status = "leave"; reason = pick(LEAVE_REASONS); }
            records.push({ date: day.toISOString().slice(0,10), status, reason });
        }
        hist[p[idKey]] = records;
    }
    return hist;
}
const STUDENT_HISTORY = buildHistory(STUDENTS, "regNo");
const STAFF_HISTORY   = buildHistory(STAFF, "id");
 
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
    const saved = localStorage.getItem("eduflow_theme") || "dark";
    if (saved === "light") document.documentElement.setAttribute("data-theme", "light");
    $("#theme-toggle").addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
        const next = cur === "light" ? "dark" : "light";
        if (next === "light") document.documentElement.setAttribute("data-theme", "light");
        else document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("eduflow_theme", next);
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
            hideAllStages();
            if (state.action === "add") {
                if (state.mode === "student") { renderClasses(); show("#stage-classes"); }
                else { initStaffAttendance(); renderStaff(); show("#stage-staff"); }
            } else {
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
    CLASSES.forEach(cls => {
        const count = STUDENTS.filter(s => s.class === cls.name).length;
        const card = document.createElement("div");
        card.className = "class-card";
        card.innerHTML = `
            <div class="class-name">${cls.name}</div>
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
    state.attendance = {};
    STUDENTS.filter(s => s.class === cls.name).forEach(s => { state.attendance[s.regNo] = { status: "present", reason: "" }; });
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
        const payload = {
            date: todayKey(),
            class: cls.name,
            section: state.selectedSection,
            records: state.attendance,
        };
        localStorage.setItem(`eduflow_att_${payload.date}_${payload.class}`, JSON.stringify(payload));
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
        const payload = {
            date: todayKey(),
            records: state.staffAttendance,
        };
        localStorage.setItem(`eduflow_staff_att_${payload.date}`, JSON.stringify(payload));
        renderStaff();
        toast("Staff attendance saved successfully");
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
    if (Object.keys(state.staffAttendance).length === 0) {
        STAFF.forEach(s => { state.staffAttendance[s.id] = { status: "present", reason: "" }; });
    }
}
 
function renderStaff() {
    const tbody = $("#staff-tbody");
    const q = ($("#staff-search").value || "").trim().toLowerCase();
    tbody.innerHTML = "";
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
 




