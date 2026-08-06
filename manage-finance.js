  /**
 * EUFLOW PRO - FINNCE LOGIC
 */

const API_BASE = "http://localhost:8080/api/finance";

async function apiCall(endpoint, method = "GET", body = null) {
    const config = {
        method,
        headers: { "Content-Type": "application/json" }
    };
    if (body) config.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${endpoint}`, config);
    
    if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Server Error");
    }
    
    // Check if response is empty before parsing JSON
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

async function apiRequest(endpoint, method = "GET", body = null) {
    const config = {
        method,
        headers: { "Content-Type": "application/json" }
    };
    if (body) config.body = JSON.stringify(body);

    try {
        const res = await fetch(`${API_BASE}${endpoint}`, config);
        
        if (!res.ok) {
            const errorText = await res.text();
            console.error(`API Error (${res.status}): ${errorText}`);
            return null; // Return null so the frontend handles the 404/500 gracefully
        }
        
        // Handle empty responses
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    } catch (error) {
        console.error("Network connection failed:", error);
        return null;
    }
}

let currentDetailedFines = []; // Global cache for current student's fines

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSidebar();
    initDate();
    initAtvVoucherModal();
    renderClassCardGrid();
    initLedgerScrollEffect();
});

/* ============================================
   LEDGER TABLE HEADER SCROLL EFFECT
   (Full Student Fines Record page)
   ============================================ */
function initLedgerScrollEffect() {
    const container = document.querySelector('.ledger-container');
    if (!container || container.dataset.scrollBound === 'true') return;
    container.dataset.scrollBound = 'true';

    container.addEventListener('scroll', () => {
        if (container.scrollTop > 0) {
            container.classList.add('is-scrolled');
        } else {
            container.classList.remove('is-scrolled');
        }
    });
}

/* ============================================
   THEME TOGGLE
   ============================================ */
function initTheme() {
    const toggleBtn = document.getElementById('theme-toggle');
    const root = document.documentElement;
    const savedTheme = localStorage.getItem('eduflow-theme') || 'dark';
    root.setAttribute('data-theme', savedTheme);

    toggleBtn.addEventListener('click', () => {
        const currentTheme = root.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', newTheme);
        localStorage.setItem('eduflow-theme', newTheme);
    });
}

/* ============================================
   SIDEBAR TOGGLE
   ============================================ */
function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const openBtn = document.getElementById('open-sidebar');
    const closeBtn = document.getElementById('close-sidebar');

    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);

    openBtn.addEventListener('click', () => {
        sidebar.classList.add('active');
        overlay.classList.add('active');
    });

    closeBtn.addEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);

    function closeSidebar() {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
    }
}

/* ============================================
   HEADER DATE
   ============================================ */
function initDate() {
    const dateEl = document.getElementById('header-date');
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

/* ============================================
   MODALS
   ============================================ */
function openModal(id) { document.getElementById(id).classList.remove('d-none'); }
function closeModal(id) { document.getElementById(id).classList.add('d-none'); }

/* ============================================
   SUB-PAGE NAVIGATION
   ============================================ */
const ALL_PAGES = [
    'page-main',
    'page-student-fees',
    'page-student-fine',
    'page-fine-records',
    'page-view-staff-bonus',
    'page-expense-hub',
    'page-add-expense',
    'page-view-expenses',
    // Salary pages
    'page-salary-hub',
    'page-salary-teaching',
    'page-salary-non-teaching',
    'page-salary-records',
    'page-bonus-hub',
    'page-bonus-teaching',
    'page-bonus-non-teaching',
    'page-custom-fee',
    'page-custom-fee-generate',
    'page-custom-fee-records',
    'page-fee-defaulter'
];

function showPage(pageId) {
    ALL_PAGES.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('d-none');
    });
    const target = document.getElementById(pageId);
    if (target) target.classList.remove('d-none');

    if (pageId === 'page-student-fees') { renderClassCardGrid(); if (typeof backToClassSelection === 'function') backToClassSelection(); }
    if (pageId === 'page-student-fine') initFinesHub();
    if (pageId === 'page-fine-records') initFineRecordsHub();
    if (pageId === 'page-view-staff-bonus') initBonusRecordsHub();
    if (pageId === 'page-view-expenses') renderExpensesTable();
    if (pageId === 'page-salary-teaching') initTeachingSalaryPage();
    if (pageId === 'page-salary-non-teaching') initNonTeachingSalaryPage();
    if (pageId === 'page-salary-records') initSalaryRecordsPage();
    if (pageId === 'page-expense-hub') initExpenseHub();
    if (pageId === 'page-bonus-teaching') initBonusPage('teaching');
    if (pageId === 'page-bonus-non-teaching') initBonusPage('non-teaching');
    if (pageId === 'page-custom-fee')          initCfWorkspace();
    if (pageId === 'page-custom-fee-generate') initCustomFeeGeneratePage();
    if (pageId === 'page-custom-fee-records')  _onShowCustomFeeRecords();
    if (pageId === 'page-fee-defaulter')       initFeeDefaulterPage();
}

/* ============================================
   COLLECT FEE (kept, not modified)
   ============================================ */
function handleFeeSubmit(e) {
    e.preventDefault();
    const amount = Number(document.getElementById('fee-amount').value);

    const db = getGlobalData();
    db.finances.fees.collected += amount;
    db.finances.fees.pending = Math.max(0, db.finances.fees.pending - amount);
    saveGlobalData(db);

    alert(`Successfully collected RS ${amount.toLocaleString()}`);
    closeModal('fee-modal');
    e.target.reset();
}

/* ============================================
   STUDENT FINES
   ============================================ */
function getStudentFinesData() {
    const raw = localStorage.getItem('eduflow-student-fines');
    return raw ? JSON.parse(raw) : [];
}
function saveStudentFinesData(arr) {
    localStorage.setItem('eduflow-student-fines', JSON.stringify(arr));
}

/* ============================================
   STUDENT FINES  (real DB + search)
   ============================================ */
function getRealStudents() {
    return JSON.parse(localStorage.getItem('edu_students') || '[]');
}

/* ============================================
   FINES HUB — left switch (Students / Staff)
   ============================================ */
let fineTargetTab = 'student';

function initFinesHub() {
    setFineTargetTab(fineTargetTab || 'student');
    populateFineClassDropdown();
}

function setFineTargetTab(tab) {
    fineTargetTab = tab;
    const isStudent = tab === 'student';
    document.getElementById('fine-tab-student').classList.toggle('active', isStudent);
    document.getElementById('fine-tab-staff').classList.toggle('active', !isStudent);
    document.getElementById('fine-panel-student').classList.toggle('d-none', !isStudent);
    document.getElementById('fine-panel-staff').classList.toggle('d-none', isStudent);
    if (isStudent) {
        resetStudentFineForm();
    } else {
        resetStaffFineForm();
    }
}

function resetStudentFineForm() {
    sfSelectedRegNo = null;
    sfSelectedId = null;
    populateFineClassDropdown();
    const secSel = document.getElementById('sf-section-select');
    const stuSel = document.getElementById('sf-student-select');
    if (secSel) { secSel.innerHTML = '<option value="">-- Select Section --</option>'; secSel.disabled = true; }
    if (stuSel) { stuSel.innerHTML = '<option value="">-- Select Student --</option>'; stuSel.disabled = true; }
    const info = document.getElementById('sf-selected-student-info');
    if (info) { info.classList.add('d-none'); info.innerHTML = ''; }
    const amt = document.getElementById('student-fine-amount'); if (amt) amt.value = '';
    const desc = document.getElementById('student-fine-desc'); if (desc) desc.value = '';
}

function resetStaffFineForm() {
    const amt = document.getElementById('staff-fine-amount'); if (amt) amt.value = '';
    const desc = document.getElementById('staff-fine-desc'); if (desc) desc.value = '';
    selectStaffCategory('Teaching');
}

/* ---- Cascading Class -> Section -> Student dropdowns ---- */
let sfSelectedRegNo = null;
let sfSelectedId = null;

function populateFineClassDropdown() {
    const classSel = document.getElementById('sf-class-select');
    if (!classSel) return;
    const students = getRealStudents();
    let classes = [...new Set(students.map(s => s.studentClass || s.className).filter(Boolean))];
    if (classes.length === 0) classes = getAllClassNames();
    classSel.innerHTML = '<option value="">-- Select Class --</option>' +
        classes.map(c => `<option value="${escapeForAttr(c)}">${escapeHtml(c)}</option>`).join('');
    classSel.value = '';
}

function onFineClassChange() {
    const cls = document.getElementById('sf-class-select').value;
    const secSel = document.getElementById('sf-section-select');
    const stuSel = document.getElementById('sf-student-select');
    sfSelectedRegNo = null; sfSelectedId = null;
    const info = document.getElementById('sf-selected-student-info');
    if (info) { info.classList.add('d-none'); info.innerHTML = ''; }

    if (!cls) {
        secSel.innerHTML = '<option value="">-- Select Section --</option>'; secSel.disabled = true;
        stuSel.innerHTML = '<option value="">-- Select Student --</option>'; stuSel.disabled = true;
        return;
    }

    const students = getRealStudents().filter(s => (s.studentClass || s.className) === cls);
    let sections = [...new Set(students.map(s => s.section).filter(Boolean))];
    stuSel.innerHTML = '<option value="">-- Select Student --</option>'; stuSel.disabled = true;

    if (sections.length === 0) {
        // No sections on record for this class — skip straight to students
        secSel.innerHTML = '<option value="">-- N/A --</option>';
        secSel.disabled = true;
        populateFineStudentDropdown(cls, null);
    } else {
        secSel.innerHTML = '<option value="">-- Select Section --</option>' +
            sections.map(sec => `<option value="${escapeForAttr(sec)}">${escapeHtml(sec)}</option>`).join('');
        secSel.disabled = false;
    }
}

function onFineSectionChange() {
    const cls = document.getElementById('sf-class-select').value;
    const sec = document.getElementById('sf-section-select').value;
    sfSelectedRegNo = null; sfSelectedId = null;
    const info = document.getElementById('sf-selected-student-info');
    if (info) { info.classList.add('d-none'); info.innerHTML = ''; }
    populateFineStudentDropdown(cls, sec || null);
}

function populateFineStudentDropdown(cls, sec) {
    const stuSel = document.getElementById('sf-student-select');
    if (!stuSel) return;
    let students = getRealStudents().filter(s => (s.studentClass || s.className) === cls);
    if (sec) students = students.filter(s => s.section === sec);

    if (students.length === 0) {
        stuSel.innerHTML = '<option value="">-- No Students Found --</option>';
        stuSel.disabled = true;
        return;
    }

    stuSel.innerHTML = '<option value="">-- Select Student --</option>' +
        students.map(s => {
            const id = s.id || s.regNo || '';
            const regNo = s.regNo || s.id || '';
            const name = s.fullName || s.name || 'Unnamed';
            return `<option value="${escapeForAttr(id)}" data-regno="${escapeForAttr(regNo)}">${escapeHtml(name)} (${escapeHtml(id)})</option>`;
        }).join('');
    stuSel.disabled = false;
}

function onFineStudentChange() {
    const stuSel = document.getElementById('sf-student-select');
    const opt = stuSel.options[stuSel.selectedIndex];
    const info = document.getElementById('sf-selected-student-info');
    if (!opt || !opt.value) {
        sfSelectedId = null; sfSelectedRegNo = null;
        if (info) { info.classList.add('d-none'); info.innerHTML = ''; }
        return;
    }
    sfSelectedId = opt.value;
    sfSelectedRegNo = opt.getAttribute('data-regno') || opt.value;

    const students = getRealStudents();
    const s = students.find(x => String(x.id || x.regNo) === String(sfSelectedId));
    if (info && s) {
        const father = s.guardianName || '-';
        info.classList.remove('d-none');
        info.innerHTML = `<i class="fas fa-user-check"></i> <b>${escapeHtml(s.fullName || s.name || '')}</b> &nbsp;&bull;&nbsp; ID: ${escapeHtml(sfSelectedId)} &nbsp;&bull;&nbsp; Father: ${escapeHtml(father)}`;
    }
}

async function handleAddStudentFine() {
    const amount = document.getElementById('student-fine-amount').value;
    const desc = document.getElementById('student-fine-desc').value.trim();
    if (!sfSelectedId || !amount) return alert("Please select a class, section, student and enter a fine amount.");

    await apiRequest("/add-fine", "POST", {
        regNo: sfSelectedRegNo || sfSelectedId,
        monthKey: getCurrentMonthKey(),
        amount: amount,
        reason: desc
    });

    alert("Fine added to MySQL Database");
    resetStudentFineForm();
}

let allStudentFinesCache = [];
let studentFinesMonthKey = null;

async function renderStudentFinesTable() {
    const tbody = document.getElementById('student-fines-tbody');
    const monthKey = getCurrentMonthKey();
    studentFinesMonthKey = monthKey;

    if(!tbody) return;
    tbody.innerHTML = "<tr><td colspan='6' class='empty-row'><i class='fas fa-spinner fa-spin'></i> Fetching aggregated records...</td></tr>";

    // Reset the search box whenever this page is (re)loaded fresh
    const searchInput = document.getElementById('student-fines-view-search');
    if (searchInput) searchInput.value = '';

    try {
        const fines = await apiCall(`/all-fines/${monthKey}`);
        allStudentFinesCache = fines || [];

        if (allStudentFinesCache.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No students found with fines this month.</td></tr>';
            return;
        }

        filterStudentFinesTable();
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row" style="color:red;">Error connecting to MySQL.</td></tr>';
    }
}

function renderStudentFinesRows(fines) {
    const tbody = document.getElementById('student-fines-tbody');
    if (!tbody) return;

    if (!fines || fines.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No students match your search.</td></tr>';
        return;
    }

    const monthKey = studentFinesMonthKey || getCurrentMonthKey();

    tbody.innerHTML = fines.map(f => {
        // Use our smart reason processor
        const smartReason = getSmartFineReason(f.fineReason);

        return `
             <tr class="salary-row-clickable" onclick="showFineDetails('${f.regNo}', '${monthKey}')">
                <td><span class="hrk-id-badge">${f.regNo}</span></td>
                <td><strong>${f.studentName}</strong></td>
                <td>${f.studentClass}</td>
                <td><span class="class-chip" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">${f.section || 'N/A'}</span></td>
                <td>${f.guardianName || '-'}</td>
                <td>
                    <div style="color:#dc2626; font-weight:800; font-size:1.05rem;">RS ${f.fineAmount.toLocaleString()}</div>
                    <div style="color:var(--text-secondary); line-height: 1.2;">${smartReason}</div>
                </td>
            </tr>
        `;
    }).join('');
}

// Supports:
//  - plain text: matches Reg No, Name, OR Guardian Name
//  - "Name~Guardian": BOTH the name part AND the guardian part must match
//    (either side can be left empty, e.g. "~Ahmed" or "Ali~")
function studentFineMatchesQuery(f, query) {
    const regNo = String(f.regNo || '').toLowerCase();
    const name = (f.studentName || '').toLowerCase();
    const guardian = (f.guardianName || '').toLowerCase();
    const q = (query || '').trim().toLowerCase();
    if (!q) return true;

    if (q.includes('~')) {
        const parts = q.split('~');
        const namePart = (parts[0] || '').trim();
        const guardianPart = (parts[1] || '').trim();
        const nameOk = !namePart || name.includes(namePart) || regNo.includes(namePart);
        const guardianOk = !guardianPart || guardian.includes(guardianPart);
        return nameOk && guardianOk;
    }

    return regNo.includes(q) || name.includes(q) || guardian.includes(q);
}

function filterStudentFinesTable() {
    const input = document.getElementById('student-fines-view-search');
    const q = input ? input.value : '';
    const classFilter = (document.getElementById('fr-student-class-filter') || {}).value || '';
    const sectionFilter = (document.getElementById('fr-student-section-filter') || {}).value || '';

    let filtered = allStudentFinesCache;
    if (q.trim())        filtered = filtered.filter(f => studentFineMatchesQuery(f, q));
    if (classFilter)     filtered = filtered.filter(f => f.studentClass === classFilter);
    if (sectionFilter)   filtered = filtered.filter(f => (f.section || '') === sectionFilter);

    renderStudentFinesRows(filtered);
}

/* ============================================
   FINE RECORDS HUB — left switch (Students / Staff)
   ============================================ */
let fineRecordsTab = 'student';

/**
 * Context set when navigating to fine records.
 * 'student' | 'Teaching' | 'Non-Teaching'
 */
let _fineRecordsContext = 'student';

/**
 * Called by the "View Records" button. Sets context from the active fine tab
 * and staff category, then navigates to the fine records page.
 */
function openFineRecordsWithContext() {
    if (fineTargetTab === 'student') {
        _fineRecordsContext = 'student';
    } else {
        _fineRecordsContext = selectedStaffCategory; // 'Teaching' or 'Non-Teaching'
    }
    showPage('page-fine-records');
}

function initFineRecordsHub() {
    const ctx = _fineRecordsContext || 'student';
    const studentPanel = document.getElementById('fr-panel-student');
    const staffPanel   = document.getElementById('fr-panel-staff');

    if (ctx === 'student') {
        if (studentPanel) studentPanel.classList.remove('d-none');
        if (staffPanel)   staffPanel.classList.add('d-none');
        populateFrClassFilter();
        renderStudentFinesTable();
    } else {
        if (studentPanel) studentPanel.classList.add('d-none');
        if (staffPanel)   staffPanel.classList.remove('d-none');

        // Hide the All/Teaching/Non-Teaching toggle — context is already specific
        const catToggle = staffPanel ? staffPanel.querySelector('.records-category-toggle') : null;
        if (catToggle) catToggle.style.display = 'none';

        staffFinesCategoryFilter = ctx; // 'Teaching' or 'Non-Teaching'
        const sInput = document.getElementById('staff-fines-view-search');
        if (sInput) sInput.value = '';
        renderStaffFinesTable();
    }
}

function setFineRecordsTab(tab) {
    // Legacy helper — tab buttons have been removed; kept for compatibility.
    fineRecordsTab = tab;
    _fineRecordsContext = tab === 'student' ? 'student' : (selectedStaffCategory || 'Teaching');
    initFineRecordsHub();
}

function populateFrClassFilter() {
    const classSel = document.getElementById('fr-student-class-filter');
    if (!classSel) return;
    const students = getRealStudents();
    let classes = [...new Set(students.map(s => s.studentClass || s.className).filter(Boolean))];
    if (classes.length === 0) classes = getAllClassNames();
    const current = classSel.value;
    classSel.innerHTML = '<option value="">-- All Classes --</option>' +
        classes.map(c => `<option value="${escapeForAttr(c)}">${escapeHtml(c)}</option>`).join('');
    classSel.value = current || '';
    onFrStudentFilterChange(true);
}

function onFrStudentFilterChange(skipRender) {
    const cls = document.getElementById('fr-student-class-filter').value;
    const secSel = document.getElementById('fr-student-section-filter');
    if (secSel) {
        const students = getRealStudents().filter(s => cls ? (s.studentClass || s.className) === cls : true);
        const sections = [...new Set(students.map(s => s.section).filter(Boolean))];
        const current = secSel.value;
        secSel.innerHTML = '<option value="">-- All Sections --</option>' +
            sections.map(sec => `<option value="${escapeForAttr(sec)}">${escapeHtml(sec)}</option>`).join('');
        secSel.value = sections.includes(current) ? current : '';
    }
    if (!skipRender) filterStudentFinesTable();
}

/* ============================================
   STAFF FINES
   ============================================ */
let selectedStaffCategory = 'Teaching';
let selectedStaffId = null;

function getStaffFinesData() {
    const raw = localStorage.getItem('eduflow-staff-fines');
    return raw ? JSON.parse(raw) : [];
}
function saveStaffFinesData(arr) {
    localStorage.setItem('eduflow-staff-fines', JSON.stringify(arr));
}

function selectStaffCategory(category) {
    selectedStaffCategory = category;
    selectedStaffId = null;
    document.getElementById('btn-teaching').classList.toggle('active', category === 'Teaching');
    document.getElementById('btn-non-teaching').classList.toggle('active', category === 'Non-Teaching');
    const search = document.getElementById('staff-fine-search');
    if (search) search.value = '';
    renderStaffMembersList(category, '');
}

function staffMatchesQuery(s, q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return true;
    return (s.name || '').toLowerCase().includes(q) ||
           (s.id || '').toLowerCase().includes(q) ||
           (s.subjects || '').toLowerCase().includes(q) ||
           (s.classes || '').toLowerCase().includes(q) ||
           (s.job || '').toLowerCase().includes(q);
}

function staffSubLine(s, category) {
    if (category === 'Teaching') {
        return `<b>ID:</b> ${s.id} &nbsp;&bull;&nbsp; <b>Class:</b> ${s.classes || '-'} &nbsp;&bull;&nbsp; <b>Subject:</b> ${s.subjects || '-'}`;
    }
    return `<b>ID:</b> ${s.id} &nbsp;&bull;&nbsp; <b>Job:</b> ${s.job || 'Staff'}`;
}

function filterStaffFineList() {
    renderStaffMembersList(selectedStaffCategory, document.getElementById('staff-fine-search').value);
}

function renderStaffMembersList(category, query) {
    const container = document.getElementById('staff-members-list');
    const db = getGlobalData();
    let members = db.staff[category] || [];
    members = members.filter(s => staffMatchesQuery(s, query));
    if (members.length === 0) {
        container.innerHTML = '<p class="search-empty">No staff found in this category.</p>';
        return;
    }
    container.innerHTML = members.map(s => {
        const active = (String(s.id) === String(selectedStaffId)) ? 'selected' : '';
        return `
        <div class="staff-member-item ${active}" id="staff-item-${s.id}" onclick="selectStaffMember('${s.id}')">
            <div class="staff-member-info">
                <span class="staff-member-name">${s.name}</span>
                <span class="staff-member-role">${staffSubLine(s, category)}</span>
            </div>
            <div class="staff-member-check"><i class="fas fa-check"></i></div>
        </div>`;
    }).join('');
}

function selectStaffMember(id) {
    document.querySelectorAll('#staff-members-list .staff-member-item').forEach(el => el.classList.remove('selected'));
    const item = document.getElementById('staff-item-' + id);
    if (item) item.classList.add('selected');
    selectedStaffId = id;
}

function handleAddStaffFine() {
    if (!selectedStaffId) { alert('Please select a staff member.'); return; }
    const amount = Number(document.getElementById('staff-fine-amount').value);
    const desc = document.getElementById('staff-fine-desc').value.trim();
    if (!amount || amount < 1) { alert('Please enter a valid fine amount.'); return; }
    if (!desc) { alert('Please enter a fine description/cause.'); return; }

    const db = getGlobalData();
    const members = db.staff[selectedStaffCategory];
    const idx = members.findIndex(s => s.id === selectedStaffId);
    if (idx === -1) { alert('Staff member not found.'); return; }

    // NOTE: do NOT write to members[idx].fines — that field is owned by
    // attendance.js applyAbsenceFines() (absence fine only). Manual fines
    // live solely in the eduflow-staff-fines log below.
    const finesLog = getStaffFinesData();
    const role = selectedStaffCategory === 'Teaching'
        ? (members[idx].subjects || 'Teacher')
        : (members[idx].job || 'Staff');

    finesLog.push({
        staffId: members[idx].id, id: members[idx].id, name: members[idx].name, role: role,
        category: selectedStaffCategory, amount: amount, cause: desc,
        date: new Date().toLocaleDateString('en-US'),
        monthKey: getCurrentMonthKey()
    });
    saveStaffFinesData(finesLog);

    alert(`Fine of RS ${amount.toLocaleString()} added to ${members[idx].name}.`);
    document.getElementById('staff-fine-amount').value = '';
    document.getElementById('staff-fine-desc').value = '';
    selectedStaffId = null;
    renderStaffMembersList(selectedStaffCategory, '');
    const sf = document.getElementById('staff-fine-search'); if (sf) sf.value = '';
}

let staffFinesCategoryFilter = 'All';

function setStaffFinesCategoryFilter(category) {
    staffFinesCategoryFilter = category;
    document.querySelectorAll('#fr-panel-staff .records-category-toggle .category-btn').forEach(b => b.classList.remove('active'));
    const map = { 'All': 'fr-staff-cat-all', 'Teaching': 'fr-staff-cat-teaching', 'Non-Teaching': 'fr-staff-cat-non-teaching' };
    const btn = document.getElementById(map[category]); if (btn) btn.classList.add('active');
    renderStaffFinesTable();
}

function filterStaffFinesTable() {
    renderStaffFinesTable();
}

function renderStaffFinesTable() {
    const tbody = document.getElementById('staff-fines-tbody');
    if (!tbody) return;
    const allFines = getStaffFinesData();
    const currentMonthKey = getCurrentMonthKey();
    const q = ((document.getElementById('staff-fines-view-search') || {}).value || '').trim().toLowerCase();

    let fines = allFines.filter(f => !f.monthKey || f.monthKey === currentMonthKey);
    if (staffFinesCategoryFilter && staffFinesCategoryFilter !== 'All') {
        fines = fines.filter(f => f.category === staffFinesCategoryFilter);
    }
    if (q) {
        fines = fines.filter(f =>
            (f.name || '').toLowerCase().includes(q) ||
            String(f.id || '').toLowerCase().includes(q) ||
            (f.role || '').toLowerCase().includes(q)
        );
    }

    if (fines.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No fines match your filters.</td></tr>';
        return;
    }
    tbody.innerHTML = fines.map(f => `
        <tr>
            <td>${f.name}</td>
            <td>${f.role}</td>
            <td>RS ${Number(f.amount).toLocaleString()}</td>
            <td>${f.cause}</td>
        </tr>
    `).join('');
}

/* ============================================
   STAFF BONUS
   ============================================ */
function getStaffBonusData() {
    const raw = localStorage.getItem('eduflow-staff-bonus');
    return raw ? JSON.parse(raw) : [];
}
function saveStaffBonusData(arr) {
    localStorage.setItem('eduflow-staff-bonus', JSON.stringify(arr));
}

/* Bonus Records: Teaching and Non-Teaching are two fully separate tabs,
   each with its own search box and table — mirrors the Fine Records
   Student/Staff tab pattern instead of a single merged table. */
let bonusRecordsTab = 'Teaching';

/**
 * Context set before navigating to bonus records.
 * 'Teaching' | 'Non-Teaching'
 */
let _bonusContext = 'Teaching';

function initBonusRecordsHub() {
    const ctx = _bonusContext || 'Teaching';
    const tSearch  = document.getElementById('staff-bonus-view-search-teaching');  if (tSearch)  tSearch.value  = '';
    const ntSearch = document.getElementById('staff-bonus-view-search-non-teaching'); if (ntSearch) ntSearch.value = '';
    setBonusRecordsTab(ctx);
}

function setBonusRecordsTab(category) {
    bonusRecordsTab = category;
    const isTeaching = category === 'Teaching';
    // Tab buttons removed — just show/hide the relevant panel
    const tPanel  = document.getElementById('vb-panel-teaching');
    const ntPanel = document.getElementById('vb-panel-non-teaching');
    if (tPanel)  tPanel.classList.toggle('d-none', !isTeaching);
    if (ntPanel) ntPanel.classList.toggle('d-none', isTeaching);
    renderStaffBonusTable(category);
}

function filterStaffBonusTable(category) {
    renderStaffBonusTable(category);
}

function renderStaffBonusTable(category) {
    const tbody = document.getElementById(category === 'Teaching' ? 'staff-bonus-tbody-teaching' : 'staff-bonus-tbody-non-teaching');
    if (!tbody) return;

    const db = getGlobalData();
    const allStaff = (db.staff && db.staff[category]) ? db.staff[category] : [];
    const allLog = getStaffBonusData();
    const currentMonthKey = getCurrentMonthKey();
    const searchId = category === 'Teaching' ? 'staff-bonus-view-search-teaching' : 'staff-bonus-view-search-non-teaching';
    const q = ((document.getElementById(searchId) || {}).value || '').trim().toLowerCase();

    // Filter staff by search query
    const staffToShow = allStaff.filter(s => {
        if (!q) return true;
        return (s.name || '').toLowerCase().includes(q) ||
               String(s.id || '').toLowerCase().includes(q) ||
               (s.subjects || s.job || s.role || '').toLowerCase().includes(q);
    });

    if (staffToShow.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No ${category === 'Teaching' ? 'teaching' : 'non-teaching'} staff found.</td></tr>`;
        return;
    }

    tbody.innerHTML = staffToShow.map(s => {
        // Find a bonus for this staff member in the current month
        const bonus = allLog.find(b =>
            (String(b.staffId) === String(s.id) || String(b.id) === String(s.id)) &&
            b.category === category &&
            (!b.monthKey || b.monthKey === currentMonthKey)
        );
        const given = !!bonus;
        const role    = category === 'Teaching' ? (s.subjects || 'Teacher') : (s.job || 'Staff');
        const amount  = given ? `RS ${Number(bonus.amount).toLocaleString()}` : '—';
        const desc    = given ? (bonus.description || '—') : '—';
        const badge   = given
            ? `<span class="status-badge status-paid"><i class="fas fa-check-circle"></i> Given</span>`
            : `<span class="status-badge status-pending"><i class="fas fa-clock"></i> Not Given</span>`;
        return `
            <tr>
                <td>${escapeHtml(s.name)}</td>
                <td>${escapeHtml(role)}</td>
                <td>${amount}</td>
                <td>${escapeHtml(desc)}</td>
                <td>${badge}</td>
            </tr>
        `;
    }).join('');
}

/* ============================================
   OTHER EXPENSES
   ============================================ */
function getExpensesData() {
    const raw = localStorage.getItem('eduflow-other-expenses');
    return raw ? JSON.parse(raw) : [];
}
function saveExpensesData(arr) {
    localStorage.setItem('eduflow-other-expenses', JSON.stringify(arr));
}

function handleExpenseSubmitNew() {
    const amount = Number(document.getElementById('exp-amount').value);
    const desc = document.getElementById('exp-desc').value.trim();
    if (!amount || amount < 1) { alert('Please enter a valid expense amount.'); return; }
    if (!desc) { alert('Please enter an expense description.'); return; }

    const list = getExpensesData();
    const now = new Date();
    list.push({ description: desc, amount: amount, date: now.toLocaleDateString('en-US'), time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), monthKey: getCurrentMonthKey() });
    saveExpensesData(list);

    const db = getGlobalData();
    db.finances.expenses.other += amount;
    saveGlobalData(db);

    alert(`Operational expense of RS ${amount.toLocaleString()} logged successfully.`);
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-desc').value = '';
    showPage('page-expense-hub');
}

function renderExpensesTable() {
    const tbody = document.getElementById('expenses-tbody');
    const allList = getExpensesData();
    const currentMonthKey = getCurrentMonthKey();
    const list = allList.filter(e => !e.monthKey || e.monthKey === currentMonthKey);
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No expenses recorded this month.</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(e => `
        <tr>
            <td>${e.date || '—'}</td>
            <td><span style="font-size:0.85rem;color:var(--text-secondary);">${e.time || '—'}</span></td>
            <td>${e.description}</td>
            <td>RS ${Number(e.amount).toLocaleString()}</td>
        </tr>
    `).join('');
}


/* ============================================
   STUDENT FEES MODULE (merged from manage-finance_1/_2)
   ============================================ */
/**
 * EDULOW PRO - FINANCE MANAGEMENT LOGIC
 */

// ============================================================================
// ⚙️  SETTINGS — ANNUAL FUND (mirrors manage-students.js settings)
// Change this to match the value set in manage-students.js.
// ============================================================================
const ANNUAL_FUND_AMOUNT = 2000; // Rs. — must match value in manage-students.js

// ============================================================================
// ⚙️  VOUCHER SETTINGS — read live from the Admin Settings page (settings.js)
//     Key: 'edu_latefee_config'  (saved by settings.js → saveAll())
//
//     Shape stored by settings.js:
//       { enabled, deadlineDay, type, amount, grace }
//
//     We derive:
//       dueDayOfMonth   = deadlineDay
//       expiryDayOfMonth= deadlineDay + grace   (last day without fine)
//       lateFineEnabled = enabled
//       lateFineType    = type   ('fixed' | 'percent')
//       lateFineValue   = amount
//       graceDays       = grace
// ============================================================================

/**
 * Returns a live snapshot of voucher / late-fee settings.
 * Falls back to safe defaults when nothing has been saved yet.
 */
function getVoucherSettings() {
    let cfg = {};
    try {
        const raw = localStorage.getItem('edu_latefee_config');
        if (raw) cfg = JSON.parse(raw);
    } catch (e) { /* ignore */ }

    const deadlineDay  = parseInt(cfg.deadlineDay, 10)  || 10;
    const grace        = parseInt(cfg.grace,        10)  || 0;
    const lateFineType = cfg.type   || 'fixed';
    const lateFineVal  = parseFloat(cfg.amount)          || 200;
    const enabled      = cfg.enabled !== false;           // default true

    return {
        dueDayOfMonth:      deadlineDay,
        // Grace days are added ON TOP of the deadline, so the fine only kicks
        // in after (deadlineDay + grace).  The voucher shows both dates.
        expiryDayOfMonth:   deadlineDay + grace,
        graceDays:          grace,
        lateFineEnabled:    enabled,
        lateFineFixedAmount: (enabled && lateFineType === 'fixed')   ? lateFineVal : 0,
        lateFinePercent:     (enabled && lateFineType === 'percent') ? lateFineVal : 0,
    };
}

// Thin compatibility shim so any existing code that references VOUCHER_SETTINGS
// still works — it just reads a fresh copy each time a property is accessed.
const VOUCHER_SETTINGS = new Proxy({}, {
    get(_, prop) { return getVoucherSettings()[prop]; }
});
// ============================================================================

// Escape a string so it can be safely embedded inside a single-quoted
// HTML attribute value (e.g. onclick="fn('${escapeForAttr(name)}')").
// Escapes backslashes, single quotes, and HTML-significant chars.
function escapeForAttr(str) {
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}


/* ============================================================================
   CLASS CARD GRID — Dynamic (reads from Admin Settings → edu_class_configs)
   The class-card-grid div in manage-finance.html is left empty and populated
   here at runtime so it always reflects whatever the admin has configured.
   ============================================================================ */

/**
 * A palette of colour-index classes (c1…c13+) and icon helpers that mirror
 * the static cards that were previously hardcoded in the HTML.
 * We cycle through both arrays so every class gets a distinct look even when
 * more classes are added than the palette has entries.
 */
const _CLASS_CARD_COLORS = ['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12','c13'];

/**
 * Returns a FontAwesome icon class appropriate for a given class name.
 * Keeps the original icon choices for known early-childhood grades and falls
 * back to a numbered badge or a generic book icon for everything else.
 */
function _classCardIcon(name, index) {
    const lc = (name || '').toLowerCase();
    if (lc.includes('montessori'))         return '<i class="fas fa-child-reaching"></i>';
    if (lc.includes('nursery'))            return '<i class="fas fa-baby"></i>';
    if (lc.includes('prep') || lc.includes('pre')) return '<i class="fas fa-shapes"></i>';
    // Try to extract a number for numeric grades
    const m = name.match(/\d+/);
    if (m) return `<span class="c-num">${m[0]}</span>`;
    // Generic fallback based on position in list
    const fallbackIcons = ['fa-book','fa-star','fa-medal','fa-award','fa-graduation-cap','fa-bookmark','fa-pencil-alt','fa-chalkboard'];
    return `<i class="fas ${fallbackIcons[index % fallbackIcons.length]}"></i>`;
}

/**
 * Builds a human-friendly display label.
 * "Grade 1" → "1st Grade", "Grade 2" → "2nd Grade", etc.
 * Custom names (e.g. "Montessori") are returned as-is.
 */
function _classDisplayLabel(name) {
    const m = name.match(/^Grade\s+(\d+)$/i);
    if (!m) return name;
    const n = parseInt(m[1], 10);
    const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
    return `${n}${suffix} Grade`;
}

/**
 * Computes and paints the three header stat cards on the "Manage Student
 * Fees" page for THE CURRENT MONTH ONLY: Fee Generated (sum of this month's
 * generated voucher totals), Collected (sum of payments recorded against
 * this month), and Pending (the difference, floored at 0).
 * Called every time renderClassCardGrid() runs — i.e. on page load, class
 * navigation, and right after a voucher is generated or a payment is
 * recorded — so the figures always reflect the current month automatically
 * and roll over to the new month on their own once the calendar turns.
 */
function updateFeeStatsHeader() {
    const genEl = document.getElementById('fee-stat-generated');
    const colEl = document.getElementById('fee-stat-collected');
    const penEl = document.getElementById('fee-stat-pending');
    if (!genEl || !colEl || !penEl) return;

    const monthKey = getCurrentMonthKey();
    const monthLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    let totalGenerated = 0;
    try {
        totalGenerated = getGeneratedVouchers()
            .filter(r => r.monthKey === monthKey)
            .reduce((sum, r) => sum + (Number(r.snapshot && r.snapshot.voucherTotal) || 0), 0);
    } catch (e) { totalGenerated = 0; }

    let totalCollected = 0;
    try {
        const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
        totalCollected = students.reduce((sum, s) => {
            const payments = Array.isArray(s.feePayments) ? s.feePayments : [];
            return sum + payments
                .filter(p => p.monthKey === monthKey)
                .reduce((pSum, p) => pSum + (Number(p.amount) || 0), 0);
        }, 0);
    } catch (e) { totalCollected = 0; }

    const totalPending = Math.max(0, totalGenerated - totalCollected);

    genEl.textContent = `Rs. ${totalGenerated.toLocaleString()}`;
    colEl.textContent = `Rs. ${totalCollected.toLocaleString()}`;
    penEl.textContent = `Rs. ${totalPending.toLocaleString()}`;

    const genLabel = document.getElementById('fee-stat-generated-label');
    const colLabel = document.getElementById('fee-stat-collected-label');
    const penLabel = document.getElementById('fee-stat-pending-label');
    if (genLabel) genLabel.textContent = `Generated · ${monthLabel}`;
    if (colLabel) colLabel.textContent = `Collected · ${monthLabel}`;
    if (penLabel) penLabel.textContent = `Pending · ${monthLabel}`;
}

/**
 * Same idea as updateFeeStatsHeader(), but scoped to a single class — used
 * in the per-class fee table view. Called every time renderFees() runs
 * (class selection, after generating a voucher, after recording a payment),
 * so it always reflects the current month for that class automatically.
 */
function updateClassFeeStats(className) {
    const genEl = document.getElementById('class-fee-stat-generated');
    const colEl = document.getElementById('class-fee-stat-collected');
    const penEl = document.getElementById('class-fee-stat-pending');
    if (!genEl || !colEl || !penEl) return;

    const monthKey = getCurrentMonthKey();
    const monthLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    let totalGenerated = 0;
    try {
        totalGenerated = getGeneratedVouchers()
            .filter(r => r.monthKey === monthKey && r.studentClass === className)
            .reduce((sum, r) => sum + (Number(r.snapshot && r.snapshot.voucherTotal) || 0), 0);
    } catch (e) { totalGenerated = 0; }

    let totalCollected = 0;
    try {
        const students = JSON.parse(localStorage.getItem('edu_students') || '[]')
            .filter(s => s.studentClass === className);
        totalCollected = students.reduce((sum, s) => {
            const payments = Array.isArray(s.feePayments) ? s.feePayments : [];
            return sum + payments
                .filter(p => p.monthKey === monthKey)
                .reduce((pSum, p) => pSum + (Number(p.amount) || 0), 0);
        }, 0);
    } catch (e) { totalCollected = 0; }

    const totalPending = Math.max(0, totalGenerated - totalCollected);

    genEl.textContent = `Rs. ${totalGenerated.toLocaleString()}`;
    colEl.textContent = `Rs. ${totalCollected.toLocaleString()}`;
    penEl.textContent = `Rs. ${totalPending.toLocaleString()}`;

    const genLabel = document.getElementById('class-fee-stat-generated-label');
    const colLabel = document.getElementById('class-fee-stat-collected-label');
    const penLabel = document.getElementById('class-fee-stat-pending-label');
    if (genLabel) genLabel.textContent = `Generated · ${monthLabel}`;
    if (colLabel) colLabel.textContent = `Collected · ${monthLabel}`;
    if (penLabel) penLabel.textContent = `Pending · ${monthLabel}`;
}

/**
 * Renders the class-card-grid from whatever classes are stored in
 * localStorage under 'edu_class_configs' (written by settings.js).
 * Falls back to the original set of 5 default classes if nothing is saved.
 * Called once on DOMContentLoaded AND again when showPage('page-student-fees')
 * is triggered, so the grid always stays in sync with settings changes.
 */
function renderClassCardGrid() {
    updateFeeStatsHeader();

    const grid = document.getElementById('class-card-grid');
    if (!grid) return;

    let classes = [];
    try {
        const raw = localStorage.getItem('edu_class_configs');
        if (raw) classes = JSON.parse(raw);
    } catch (e) { classes = []; }

    if (!Array.isArray(classes)) {
        classes = [];
    }

    grid.innerHTML = classes.map((cls, i) => {
        const name        = (cls.name || 'Class ' + (i + 1)).trim();
        const colorClass  = _CLASS_CARD_COLORS[i % _CLASS_CARD_COLORS.length];
        const iconHTML    = _classCardIcon(name, i);
        const label       = _classDisplayLabel(name);
        // Escape name for inline onclick attribute
        const safeName    = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const badge       = _classVoucherBadgeHTML(name);
        return `<div class="class-selector-card ${colorClass}" onclick="selectClassForFees('${safeName}')">
                    ${badge}
                    <div class="c-icon">${iconHTML}</div>
                    <h4>${label}</h4>
                </div>`;
    }).join('');
}

/**
 * Switcher function for Finance Modules
 */
let currentFeeClassName = null;

function selectClassForFees(className) {
    // 1. Toggle UI Views
    document.getElementById('class-selection-view').style.display = 'none';
    document.getElementById('class-student-list-view').style.display = 'block';

    // Hide the page-wide monthly totals while inside a specific class —
    // the class already shows its own scoped totals right below its title,
    // so keeping both visible was redundant. The Back button (to the main
    // fees page) stays untouched since it lives outside the stats row.
    const topStatsRow = document.getElementById('fee-stats-row');
    const statsHeader = document.querySelector('.fee-stats-header');
    if (topStatsRow) topStatsRow.style.display = 'none';
    if (statsHeader) statsHeader.style.display = 'none';

    // 2. Set Title
    document.getElementById('selected-class-title').innerText = `Fee Records: ${className}`;
    currentFeeClassName = className;
    
    // 3. Render Students
    renderFees(className);
}
function backToClassSelection() {
    document.getElementById('class-selection-view').style.display = 'block';
    document.getElementById('class-student-list-view').style.display = 'none';
    currentFeeClassName = null;

    // Restore the page-wide monthly totals now that we're back at the
    // class-grid level (no single class is selected anymore).
    const topStatsRow = document.getElementById('fee-stats-row');
    const statsHeader = document.querySelector('.fee-stats-header');
    if (topStatsRow) topStatsRow.style.display = '';
    if (statsHeader) statsHeader.style.display = '';

    // Refresh badges in case anything was generated while inside the class view
    renderClassCardGrid();
}

// ... rest of the existing renderFees and filterByClass functions remain the same ...

/**
 * VOUCHER PREVIEW LOGIC
 */
let currentVoucherStudentId = null;
let currentVoucherStudentName = null;
// BUGFIX — "fine not adding up in voucher": `student.backendFine` was only ever
// set on the local, in-memory `student` object inside viewVoucher(). Every other
// function (like the inline voucher editor) re-reads the student fresh from
// localStorage, where that fine value never existed — so it silently read as 0.
// Caching the last-fetched fine here lets other flows see the real value.
let currentVoucherFineAmount = 0;
let currentVoucherFineReason = '';

async function viewVoucher(studentId, fullName, isPaidBill = false) {
    // 1. Validation
    if (!studentId || studentId === "null") {
        alert("Invalid Student ID.");
        return;
    }

    // 2. Get the base student profile from local storage
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    let student = findStudentExact(students, studentId, fullName);
    
    if (!student) { 
        alert('Student profile not found in local cache.'); 
        return; 
    }

    const monthKey = getCurrentMonthKey();
    
    try {
        // 3. API CALL: Fetch FRESH status from the MySQL database.
        // If a fine was just settled/paid in the ledger, the backend logic 
        // has already subtracted it from 'fineAmount'.
        // NOTE: this is best-effort. If the backend isn't reachable (e.g. running
        // fully client-side), we fall back to whatever is already known locally
        // (computeFeeBreakdown already pulls arrears/fines/discounts from the
        // student record itself) instead of blocking the voucher from opening.
        const finance = await apiRequest(`/status/${studentId}/${monthKey}`);

        // 4. Sync backend data to the student object used for rendering (when available).
        // This 'backendFine' is picked up by computeFeeBreakdown() inside buildVoucherHTML().
        if (finance) {
            student.backendFine = finance.fineAmount || 0;
            student.backendFineReason = finance.fineReason || "";
        }

        // Set global variables for the Edit/Share functionality
        currentVoucherStudentId = studentId;
        currentVoucherStudentName = fullName;
        // Cache the fine so it's still available if the editor re-reads the
        // student fresh from localStorage (see note above the declaration).
        const fBreakdown = computeFeeBreakdown(student);
        currentVoucherFineAmount = fBreakdown.fineAmount || 0;
        currentVoucherFineReason = student.backendFineReason || '';

        // 5. Build the HTML content
        let html = buildVoucherHTML(student);
        
        // 6. Apply the "PAID" stamp if the monthly bill is fully settled
        if (isPaidBill) {
            html = `
                <div style="position:relative;">
                    ${html}
                    <div class="paid-stamp-overlay">PAID</div>
                </div>`;
        }

        // 7. Update the Modal UI
        const renderTarget = document.getElementById('voucher-render-target');
        const modalOverlay = document.getElementById('voucher-modal-overlay');
        
        if (renderTarget) renderTarget.innerHTML = html;
        if (modalOverlay) modalOverlay.style.display = 'flex';
        
        // 8. Control the "Edit Voucher" button visibility
        // We disable editing if the bill is already marked as Paid.
        const editBtn = document.getElementById('edit-voucher-btn');
        if (editBtn) {
            editBtn.style.display = isPaidBill ? 'none' : 'inline-flex';
            editBtn.setAttribute('data-paid-locked', isPaidBill ? '1' : '0');
        }

    } catch (err) {
        console.error("Voucher Rendering Error:", err);
        alert("Failed to sync with the server. The voucher might show outdated information.");
    }
}

function openVoucherEditModal() {
    const editBtn = document.getElementById('edit-voucher-btn');
    if (editBtn && editBtn.getAttribute('data-paid-locked') === '1') return; // Paid bills cannot be edited
    if (currentVoucherStudentId) {
        openInlineVoucherEditor(currentVoucherStudentId, currentVoucherStudentName);
    }
}

function closeVoucherModal() {
    document.getElementById('voucher-modal-overlay').style.display = 'none';
    // Close share popup if open
    const popup = document.getElementById('voucher-share-popup');
    if (popup) popup.classList.remove('open');
}

/* ============================================
   SHARE VOUCHER — Online Share Options
   ============================================ */
function shareVoucherOnline() {
    // Directly share the voucher as an image (Web Share API on mobile / supported browsers,
    // automatic download fallback elsewhere). No popup, no extra options.
    _showShareToast('<i class="fas fa-spinner fa-spin"></i> Preparing voucher image…');

    function doShare() {
        const target = document.getElementById('voucher-render-target');
        if (!target) { _showShareToast('Voucher not found.'); return; }

        // Capture only the Student Copy
        const copies = target.querySelectorAll('.voucher-copy');
        if (copies[0]) copies[0].style.display = 'none';

        html2canvas(target, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false
        }).then(canvas => {
            if (copies[0]) copies[0].style.display = '';

            const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
            const student  = findStudentExact(students, currentVoucherStudentId, currentVoucherStudentName);
            const safeName = (student?.fullName || 'student').replace(/\s+/g,'-');
            const fileName = `voucher-${safeName}.png`;

            canvas.toBlob(async (blob) => {
                if (!blob) { _showShareToast('Image capture failed.'); return; }
                const file = new File([blob], fileName, { type: 'image/png' });

                // Try native share-with-file
                if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
                    try {
                        await navigator.share({
                            files: [file],
                            title: 'Fee Voucher',
                            text: `Fee Voucher — ${student?.fullName || ''}`
                        });
                        _showShareToast('<i class="fas fa-check"></i> Voucher shared!');
                        return;
                    } catch (err) {
                        // user cancelled or share failed — fall back to download
                    }
                }

                // Fallback: download the image
                const link = document.createElement('a');
                link.download = fileName;
                link.href = canvas.toDataURL('image/png');
                link.click();
                _showShareToast('<i class="fas fa-check"></i> Voucher image downloaded!');
            }, 'image/png');
        }).catch(() => {
            if (copies[0]) copies[0].style.display = '';
            _showShareToast('Image capture failed. Try Print instead.');
        });
    }

    if (typeof html2canvas !== 'undefined') {
        doShare();
    } else {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload  = doShare;
        script.onerror = () => _showShareToast('Could not load image library.');
        document.head.appendChild(script);
    }
}

function _showShareToast(message) {
    let toast = document.getElementById('voucher-share-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'voucher-share-toast';
        toast.className = 'share-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = message;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('visible'), 2800);
}

function printVoucherFromModal() {
    const content = document.getElementById('voucher-render-target').innerHTML;
    const printArea = document.getElementById('voucher-print-area');
    printArea.innerHTML = content;
    window.print();
}

/**
 * Shared fee calculation — used by both the student table and the voucher,
 * so totals and discounts always match.
 */
function computeFeeBreakdown(s) {
    const today = new Date();
    const monthLabel = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const regNo = s.regNo || s.id;

    // Core Charges
    const tuitionFee   = Number(s.standardFee)   || 0;
    const transportFee = Number(s.transportFee)  || 0;
    const otherFee     = Number(s.otherFee)      || 0;
    
    // Fines from MySQL handshake
    const fineFromBackend = s.backendFine || 0; 

    // Specific Discounts from Student Profile
    const tDisc   = Number(s.tuitionDiscount)   || 0;
    const trDisc  = Number(s.transportDiscount) || 0;
    const sibDisc = Number(s.siblingDiscount)   || 0;

    // BUGFIX — "arrears sometimes show, sometimes don't": `s.arrears` is only
    // ever refreshed at the moment "Generate Voucher" is clicked (see
    // recordVoucherGeneration). Before that click happens for the current
    // month, `s.arrears` is whatever was last written — which could be last
    // month's figure, a manual edit from weeks ago, or 0 if never set. That
    // stale value was being shown on the voucher preview, the fee table, and
    // the Pay Bill screen alike, so the same student could look like they
    // owed a different arrears amount depending only on whether "Generate"
    // had been clicked yet this month.
    // Fix: once a voucher record already exists for THIS month, trust the
    // persisted `s.arrears` (it's the locked-in snapshot, and may have been
    // deliberately overridden via the "Edit Voucher" screen). Otherwise —
    // i.e. any time we're previewing/paying before generation — compute the
    // real outstanding balance live from payment history so it's always
    // accurate.
    const regNoForArrears = s.regNo || s.id;
    const arrears = isVoucherGenerated(regNoForArrears)
        ? (Number(s.arrears) || 0)
        : computeOutstandingArrears(s);

    // BUGFIX — "Edit Voucher" changes were silently discarded: previously this
    // function never looked at `s.otherFeesData` / `s.voucherCustomFees`, which
    // is exactly what the inline voucher editor (ievSave) persists. That meant
    // editing rows in "Edit Voucher" had zero effect on the real voucher total —
    // only the Arrears field (read directly below) actually changed anything.
    // Now, when a custom edited breakdown exists, it fully replaces the base
    // tuition/transport/other charges for the total calculation, while fines
    // and arrears keep being layered on top exactly as before.
    let customRows = null;
    if (s.voucherCustomFees === true) {
        try {
            const parsed = JSON.parse(s.otherFeesData || '[]');
            if (Array.isArray(parsed) && parsed.length > 0) customRows = parsed;
        } catch (e) { customRows = null; }
    }
    const isCustom = !!customRows;

    // Create a list of active discounts for the UI (only meaningful in the
    // non-custom/base mode — custom rows already carry their own per-row
    // discount, so we don't want to subtract it a second time here).
    const activeDiscounts = [];
    if (!isCustom) {
        if (tDisc > 0) activeDiscounts.push({ label: 'Tuition Concession', amount: tDisc });
        if (trDisc > 0) activeDiscounts.push({ label: 'Transport Discount', amount: trDisc });
        if (sibDisc > 0) activeDiscounts.push({ label: 'Sibling Discount', amount: sibDisc });
    }

    const baseCharges   = isCustom
        ? customRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
        : (tuitionFee + transportFee + otherFee);
    const baseDiscounts = isCustom
        ? customRows.reduce((sum, r) => sum + (Number(r.discount) || 0), 0)
        : (tDisc + trDisc + sibDisc);

    // BUGFIX — "discount not working": saveFeesToVoucher() (the "Add to
    // Voucher" bulk-discount field) has always written `voucherBulkDiscount`
    // onto the student record, and the modal's own live preview (atvRecalc)
    // subtracts it from the total shown to the admin — but computeFeeBreakdown
    // never read `voucherBulkDiscount` at all. So the moment the admin closed
    // that modal, the discount they just entered and "saw applied" silently
    // vanished from the real voucher total, the Pay Bill screen, and the
    // printed voucher. It only ever affected a number the admin never got
    // charged from.
    const bulkDiscount = isCustom ? (Number(s.voucherBulkDiscount) || 0) : 0;

    const totalCharges   = baseCharges + fineFromBackend;
    const totalDiscounts = baseDiscounts + bulkDiscount;
    
    // Final Calculation
    const voucherTotal = Math.max(0, (totalCharges - totalDiscounts) + arrears);

    const vs = getVoucherSettings();
    const lateFeeSurcharge = vs.lateFineEnabled ? (vs.lateFineFixedAmount > 0 ? vs.lateFineFixedAmount : Math.round(voucherTotal * (vs.lateFinePercent / 100))) : 0;

    return {
        regNo, monthLabel, 
        tuitionFee, transportFee, otherFee, arrears,
        fineAmount: fineFromBackend,
        activeDiscounts, // Pass the array of individual discounts
        totalDiscounts,
        bulkDiscount,
        isCustom,
        customRows, // null unless a saved "Edit Voucher" breakdown exists
        voucherTotal: voucherTotal,
        totalAfterDueDate: voucherTotal + lateFeeSurcharge,
        lateFineEnabled: vs.lateFineEnabled,
        lateFeeSurcharge: lateFeeSurcharge,
        dueDateStr: new Date(today.getFullYear(), today.getMonth() + 1, vs.dueDayOfMonth).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        expiryDateStr: new Date(today.getFullYear(), today.getMonth() + 1, vs.expiryDayOfMonth).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    };
}

function buildVoucherHTML(s) {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const challanNo = `CH-${s.id}-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;
    const photoSrc = s.photo || '';
    const f = computeFeeBreakdown(s);

    // 1. Build Base Fee Rows
    // If this voucher was edited via "Edit Voucher" (a saved custom
    // breakdown exists), render exactly those rows instead of the raw
    // base tuition/transport/other fields — otherwise a saved edit would
    // never actually show up on the printed voucher.
    let rowsHTML;
    if (f.isCustom && Array.isArray(f.customRows)) {
        rowsHTML = f.customRows.map(r => {
            const amt = Number(r.amount) || 0;
            const disc = Number(r.discount) || 0;
            const net = Math.max(0, amt - disc);
            const discNote = disc > 0 ? ` <span style="color:#16a34a; font-size:0.75rem;">(- Rs. ${disc.toLocaleString()} discount)</span>` : '';
            return `<tr><td>${escapeHtml(r.description || 'Fee')}${discNote}</td><td>${escapeHtml(r.period || '-')}</td><td>Rs. ${net.toLocaleString()}</td></tr>`;
        }).join('');
        if (f.bulkDiscount > 0) {
            rowsHTML += `<tr class="voucher-row-discount"><td style="padding-left: 20px;">- Bulk Discount</td><td>Concession</td><td>- Rs. ${f.bulkDiscount.toLocaleString()}</td></tr>`;
        }
    } else {
        rowsHTML = `
            ${f.tuitionFee > 0 ? `<tr><td>Tuition Fee</td><td>${f.monthLabel}</td><td>Rs. ${f.tuitionFee.toLocaleString()}</td></tr>` : ''}
            ${f.transportFee > 0 ? `<tr><td>Transportation Fee</td><td>${f.monthLabel}</td><td>Rs. ${f.transportFee.toLocaleString()}</td></tr>` : ''}
            ${f.otherFee > 0 ? `<tr><td>Other Charges</td><td>-</td><td>Rs. ${f.otherFee.toLocaleString()}</td></tr>` : ''}
        `;
    }
    rowsHTML += `${f.fineAmount > 0 ? `<tr style="color:#dc2626;"><td><strong>Fine / Penalty</strong></td><td>${s.backendFineReason || 'Disciplinary'}</td><td>Rs. ${f.fineAmount.toLocaleString()}</td></tr>` : ''}`;

    // 2. Build Specific Discounts Section
    if (f.activeDiscounts.length > 0) {
        rowsHTML += `<tr class="voucher-row-discount" style="background: rgba(21, 128, 61, 0.03);"><td colspan="3" style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #64748b; padding-top: 10px;">Applied Concessions</td></tr>`;
        
        f.activeDiscounts.forEach(d => {
            rowsHTML += `
                <tr class="voucher-row-discount">
                    <td style="padding-left: 20px;">- ${d.label}</td>
                    <td>Concession</td>
                    <td>- Rs. ${d.amount.toLocaleString()}</td>
                </tr>`;
        });

        // 3. Highlighted Total Discount Row
        rowsHTML += `
            <tr style="background: #f0fdf4; color: #166534; border-top: 1px solid #bbf7d0;">
                <td><strong>TOTAL DISCOUNT</strong></td>
                <td>-</td>
                <td><strong>- Rs. ${f.totalDiscounts.toLocaleString()}</strong></td>
            </tr>`;
    }

    // 4. Arrears Row
    if (f.arrears > 0) {
        rowsHTML += `
            <tr class="voucher-row-arrears">
                <td><strong>Previous Arrears</strong></td>
                <td>Balance B/F</td>
                <td>Rs. ${f.arrears.toLocaleString()}</td>
            </tr>`;
    }

    const copy = (label) => `
        <div class="voucher-copy">
            <div class="voucher-copy-tag ${label === 'School Copy' ? 'tag-blue' : 'tag-green'}">${label}</div>
            <div class="voucher-header">
                <div class="voucher-school-info">
                    <div class="voucher-logo"><i class="fas fa-graduation-cap"></i></div>
                    <div>
                        <h2>ST. LAWRENCE INTERNATIONAL SCHOOL</h2>
                        <p>Financial Control Center &middot; Fee Voucher</p>
                    </div>
                </div>
                ${photoSrc ? `<img src="${photoSrc}" class="v-photo">` : `<div class="v-photo v-photo-placeholder"><i class="fas fa-user"></i></div>`}
            </div>

            <div class="voucher-meta-row">
                <div><span>Challan No.</span><strong>${challanNo}</strong></div>
                <div><span>Issue Date</span><strong>${dateStr}</strong></div>
                <div><span>Due Date</span><strong>${f.dueDateStr}</strong></div>
                <div><span>Expiry Date</span><strong>${f.expiryDateStr}</strong></div>
            </div>

            <div class="voucher-divider"></div>

            <div class="voucher-student-grid">
                <div><span>Student ID</span><strong>${f.regNo}</strong></div>
                <div><span>Student Name</span><strong>${s.fullName}</strong></div>
                <div><span>Class</span><strong>${s.studentClass || '-'}</strong></div>
                <div><span>Guardian</span><strong>${s.guardianName || '-'}</strong></div>
            </div>

            <table class="voucher-fee-table">
                <thead>
                    <tr><th>Description</th><th>Period</th><th>Amount</th></tr>
                </thead>
                <tbody>
                    ${rowsHTML}
                </tbody>
                <tfoot>
                    <tr class="voucher-total-row voucher-total-ontime">
                        <td colspan="2"><i class="fas fa-wallet"></i> NET PAYABLE (on or before ${f.dueDateStr})</td>
                        <td>Rs. ${f.voucherTotal.toLocaleString()}</td>
                    </tr>
                    ${f.lateFineEnabled ? `
                    <tr class="voucher-total-row voucher-total-late">
                        <td colspan="2"><i class="fas fa-exclamation-triangle"></i> Payable After Due Date (incl. late fine Rs. ${f.lateFeeSurcharge.toLocaleString()})</td>
                        <td>Rs. ${f.totalAfterDueDate.toLocaleString()}</td>
                    </tr>` : ''}
                </tfoot>
            </table>

            <div class="voucher-footer">
                <div class="voucher-note"><i class="fas fa-info-circle"></i> Please clear dues by the due date to avoid late fees.</div>
                <div class="voucher-signature">
                    <div class="sig-line"></div>
                    <span>Principal / Accounts</span>
                </div>
            </div>
        </div>
    `;

    return `<div class="voucher-sheet">${copy('School Copy')}${copy('Student Copy')}</div>`;
}

function filterByClass(className) {
    document.querySelectorAll('.class-btn').forEach(btn => {
        btn.classList.remove('active');
        if(btn.innerText === className || (className === 'All' && btn.innerText === 'All Classes')) {
            btn.classList.add('active');
        }
    });
    renderFees(className);
}








const originalComputeFeeBreakdown = computeFeeBreakdown;
computeFeeBreakdown = function(s) {
    const f = originalComputeFeeBreakdown(s);
    
    // Calculate sum of active fines for this month
    let monthlyFineTotal = 0;
    let fineDetails = "";

    if (s.fines && s.fines.length > 0) {
        s.fines.forEach(fine => {
            if (fine.remainingInstallments > 0) {
                monthlyFineTotal += fine.monthlyAmount;
                fineDetails += `${fine.reason} (Inst. left: ${fine.remainingInstallments}), `;
            }
        });
    }

    // Add fines to the net totals
    f.monthlyFineTotal = monthlyFineTotal;
    f.fineDetails = fineDetails.replace(/, $/, "");
    f.voucherTotal += monthlyFineTotal;
    f.totalAfterDueDate += monthlyFineTotal;

    return f;
};

const originalBuildVoucherHTML = buildVoucherHTML;
buildVoucherHTML = function(s) {
    // We add a fine row if active fines exist
    const f = computeFeeBreakdown(s);
    let html = originalBuildVoucherHTML(s);
    
    if (f.monthlyFineTotal > 0) {
        const fineRow = `<tr><td>Disciplinary Fines</td><td>${f.fineDetails}</td><td>Rs. ${f.monthlyFineTotal.toLocaleString()}</td></tr>`;
        // Insert the row before the totals (using simple string replace for demo)
        html = html.replace('</tbody>', `${fineRow}</tbody>`);
    }
    return html;
};

/**
 * Best-effort finance status for a single student.
 * Tries the backend first (so a live server, when present, always wins);
 * if it's unreachable/404 we fall back to a status computed entirely from
 * local data via computeFeeBreakdown() — the same function the voucher and
 * fee tables already trust for arrears/fines/discounts — so nothing about
 * the underlying calculation logic changes.
 */
async function getFeeRowFinance(student, monthKey) {
    const studentIdentifier = student.regNo || student.id;
    let finance = null;
    try {
        finance = await apiRequest(`/status/${studentIdentifier}/${monthKey}`);
    } catch (e) { /* handled below via fallback */ }

    if (finance) return finance;

    // ---- Local fallback ----
    const f = computeFeeBreakdown(student);
    const payments = (student.feePayments || []).filter(p => p.monthKey === monthKey);
    const paidAmount = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const remainingBalance = Math.max(0, f.voucherTotal - paidAmount);
    const paymentStatus = remainingBalance <= 0 ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Pending');

    return {
        regNo: f.regNo,
        studentName: student.fullName,
        guardianName: student.guardianName,
        remainingBalance,
        paidAmount,
        paymentStatus,
        fineAmount: (f.fineAmount || 0) + (f.monthlyFineTotal || 0),
        fineReason: f.fineDetails || student.backendFineReason || ''
    };
}

async function renderFees(className) {
    updateClassFeeStats(className);

    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const tbody = document.getElementById('fee-table-body');
    const monthKey = getCurrentMonthKey(); 
    
    if(!tbody) return;
    
    // Show loading state while syncing with database
    tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:20px;'><i class='fas fa-spinner fa-spin'></i> Syncing with MySQL Database...</td></tr>";
    
    const filtered = students.filter(s => s.studentClass === className);

    if(filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px;">No students found enrolled in <strong>${className}</strong>.</td></tr>`;
        return;
    }

    let rowsHtml = "";

    // Loop through filtered students and fetch fresh backend status for each
    for (const s of filtered) {
        const studentIdentifier = s.regNo || s.id;

        try {
            const finance = await getFeeRowFinance(s, monthKey);

            const isPaid = finance.paymentStatus === "Paid";
            const hasUnpaidFine = finance.fineAmount > 0;

            const statusClass = isPaid ? 'fee-paid' : (finance.paidAmount > 0 ? 'fee-pending' : 'fee-overdue');

            const billable = isStudentBillable(s);
            const voucherRec = getVoucherRecord(studentIdentifier, monthKey);

            let actionsHtml;
            if (!billable) {
                actionsHtml = `<span class="fee-status-badge fee-inactive"><i class="fas fa-ban"></i> ${escapeHtml(studentStatusLabel(s))}</span>`;
            } else if (!voucherRec) {
                actionsHtml = `
                    <button class="btn-tiny btn-generate-voucher" onclick="handleGenerateSingleVoucher('${escapeForAttr(studentIdentifier)}', '${escapeForAttr(s.fullName)}')">
                        <i class="fas fa-file-invoice"></i> Generate Voucher
                    </button>`;
            } else {
                actionsHtml = `
                    <button class="btn-tiny" onclick="viewVoucher('${finance.regNo}', '${escapeForAttr(finance.studentName)}', ${isPaid})">
                        <i class="fas fa-eye"></i> View Voucher
                    </button>
                    ${!isPaid ? `
                        <button class="btn-tiny btn-add-fees" onclick="openAddFeesModal('${finance.regNo}', '${escapeForAttr(finance.studentName)}')">
                            <i class="fas fa-money-bill-wave"></i> Pay Bill
                        </button>
                    ` : ''}`;
            }

            rowsHtml += `
                <tr>
                    <td><span class="hrk-id-badge">${finance.regNo}</span></td>
                    <td>
                        <strong>${finance.studentName}</strong>
                        ${hasUnpaidFine ? `<br><span style="font-size:0.72rem;color:#dc2626;font-weight:700;"><i class="fas fa-exclamation-triangle"></i> Unpaid Fine: Rs. ${finance.fineAmount}</span>` : ''}
                    </td>
                    <td>${finance.guardianName || '-'}</td>
                    <td>
                        <strong style="color:${isPaid ? '#27ae60' : '#c2410c'}">Rs. ${finance.remainingBalance.toLocaleString()}</strong>
                        ${finance.paidAmount > 0 ? `<br><span style="font-size:0.7rem; color:#16a34a;">Paid so far: Rs. ${finance.paidAmount}</span>` : ''}
                    </td>
                    <td><span class="fee-status-badge ${statusClass}">${voucherRec ? finance.paymentStatus : 'Not Generated'}</span></td>
                    <td class="fee-actions-cell">
                        ${actionsHtml}
                    </td>
                </tr>
            `;
        } catch (err) {
            console.error("Failed to load row for " + studentIdentifier, err);
            rowsHtml += `
                <tr>
                    <td><span class="hrk-id-badge">${studentIdentifier}</span></td>
                    <td><strong>${s.fullName}</strong></td>
                    <td colspan="4" style="color:#ef4444; font-size: 0.8rem;">
                        <i class="fas fa-exclamation-circle"></i> Error loading this student's fee record.
                    </td>
                </tr>`;
        }
    }
    
    tbody.innerHTML = rowsHtml;
}

// Filter the fee table rows by name / id / guardian
function filterFeeTable() {
    const input = document.getElementById('fee-search-input');
    const tbody = document.getElementById('fee-table-body');
    const countEl = document.getElementById('fee-search-count');
    if (!tbody) return;
    const q = (input ? input.value : '').trim().toLowerCase();
    const rows = tbody.querySelectorAll('tr');
    let visible = 0;
    rows.forEach(r => {
        // skip the "no students" placeholder row
        if (r.children.length < 2) { return; }
        const text = r.innerText.toLowerCase();
        const match = !q || text.includes(q);
        r.style.display = match ? '' : 'none';
        if (match) visible++;
    });
    if (countEl) {
        countEl.textContent = q ? `${visible} match${visible === 1 ? '' : 'es'}` : '';
    }
}

// =============================================
//  ADD FEES MODAL LOGIC — MULTI-FEE REDESIGN
// =============================================

function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Fee type presets — label + suggested amount source key
const FEE_TYPE_PRESETS = [
    { value: 'tuition',   label: '📚 Tuition Fee',      key: 'standardFee' },
    { value: 'transport', label: '🚌 Transport Fee',     key: 'transportFee' },
    { value: 'book',      label: '📘 Book Fee',          key: 'booksFee' },
    { value: 'extra',     label: '➕ Extra Fee',          key: null },
    { value: 'annual',    label: '🏫 Annual Fund',       key: null },
    { value: 'admission', label: '📝 Admission Fee',     key: 'admissionFee' },
    { value: 'exam',      label: '📋 Exam Fee',          key: null },
    { value: 'other',     label: '🏷️ Other Charges',     key: 'otherFee' },
    { value: 'arrears',   label: '⏳ Previous Arrears',  key: null },
    { value: 'custom',    label: '✏️ Custom Category',   key: null },
];

// Current fee rows state
let afmFeeRows = [];
let afmNextRowId = 1;
let afmCurrentStudent = null;

function findStudentExact(students, studentId, fullName) {
    // Prefer an exact (id + name) match to disambiguate siblings that
    // accidentally share an id. Fall back to id only.
    if (fullName) {
        const exact = students.find(s =>
            String(s.id) === String(studentId) && s.fullName === fullName);
        if (exact) return exact;
    }
    return students.find(s => String(s.id) === String(studentId));
}

let afmCurrentPendingAmount = 0;

function openAddFeesModal(studentId, fullName) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = findStudentExact(students, studentId, fullName);
    if (!student) { alert('Student not found.'); return; }
    afmCurrentStudent = student;

    document.getElementById('add-fees-student-id').value = studentId;

    // Reset inputs
    const discountInput = document.getElementById('afm-pay-discount');
    if(discountInput) discountInput.value = '';
    
    const amountInput = document.getElementById('afm-pay-amount');
    if(amountInput) amountInput.value = '';
    
    const notesInput = document.getElementById('af-fee-notes');
    if(notesInput) notesInput.value = '';

    renderAddFeesModal(student);
    document.getElementById('add-fees-modal').style.display = 'flex';
}

function renderAddFeesModal(student) {
    const f = computeFeeBreakdown(student);
    const payments = student.feePayments || [];
    const currentMonthKey = getCurrentMonthKey();
    const thisMonthPaid = payments
        .filter(p => p.monthKey === currentMonthKey)
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    // Left panel: show ONE copy of the voucher (Student Copy) only.
    let voucherHTML = buildVoucherHTML(student);
    const previewContainer = document.getElementById('afm-voucher-preview-container');
    if (previewContainer) {
        previewContainer.innerHTML = voucherHTML;
        // Hide the School Copy so the admin sees just the saved/edited voucher.
        const copies = previewContainer.querySelectorAll('.voucher-copy');
        if (copies.length > 1) copies[0].style.display = 'none';
    }

    // Header strip: name, monthly total, paid so far
    const headerEl = document.getElementById('afm-pay-header');
    if (headerEl) {
        headerEl.innerHTML = `
            <div class="afm-pay-header-name">${student.fullName || 'Student'}</div>
            <div class="afm-pay-header-stats">
                <div><span>Monthly Total</span><strong>Rs. ${f.voucherTotal.toLocaleString()}</strong></div>
                <div><span>Paid This Month</span><strong style="color:#16a34a;">Rs. ${thisMonthPaid.toLocaleString()}</strong></div>
                <div><span>Remaining</span><strong style="color:#c2410c;">Rs. ${Math.max(0, f.voucherTotal - thisMonthPaid).toLocaleString()}</strong></div>
            </div>`;
    }

    // Hide the extras (arrears alert + history) — the user wants only voucher + summary.
    const arrAlert = document.getElementById('afm-arrears-alert');
    if (arrAlert) arrAlert.style.display = 'none';
    const history = document.querySelector('#add-fees-modal .af-history-panel');
    if (history) history.style.display = 'none';

    // Right panel summary
    const pendingAmount = Math.max(0, f.voucherTotal - thisMonthPaid);
    afmCurrentPendingAmount = pendingAmount;

    const payableEl = document.getElementById('afm-t-payable');
    if (payableEl) {
        payableEl.textContent = `Rs. ${pendingAmount.toLocaleString()}`;
    }

    recalcSimpleAFTotal();
}

function recalcSimpleAFTotal() {
    const discountInput = document.getElementById('afm-pay-discount');
    const amountInput = document.getElementById('afm-pay-amount');

    const discount = discountInput ? (parseFloat(discountInput.value) || 0) : 0;
    const paid = amountInput ? (parseFloat(amountInput.value) || 0) : 0;

    // Net payable after the on-the-spot discount
    const gross = afmCurrentPendingAmount;
    const netPayable = Math.max(0, gross - discount);
    const remaining = Math.max(0, netPayable - paid);

    const set = (id, txt, color) => {
        const el = document.getElementById(id);
        if (el) { el.textContent = txt; if (color) el.style.color = color; }
    };
    set('afm-t-gross-sum', `Rs. ${gross.toLocaleString()}`);
    set('afm-t-disc-sum',  `- Rs. ${discount.toLocaleString()}`, '#16a34a');
    set('afm-t-payable',   `Rs. ${netPayable.toLocaleString()}`);
    set('afm-t-paid-sum',  `Rs. ${paid.toLocaleString()}`, '#16a34a');
    set('afm-t-remaining', `Rs. ${remaining.toLocaleString()}`, remaining > 0 ? '#c2410c' : '#16a34a');
}

async function saveSimpleStudentFeePayment() {
    const studentId = document.getElementById('add-fees-student-id').value;
    const paid = parseFloat(document.getElementById('afm-pay-amount').value) || 0;
    const discountInput = document.getElementById('afm-pay-discount');
    const discount = discountInput ? (parseFloat(discountInput.value) || 0) : 0;
    const notesInput = document.getElementById('af-fee-notes');
    const notes = notesInput ? notesInput.value.trim() : '';

    if (paid <= 0 && discount <= 0) {
        alert('Please enter a payment amount.');
        return;
    }

    const monthKey = getCurrentMonthKey();
    const monthLabel = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    // BUGFIX — "Pay Bill doesn't work / stays View & Pay after paying":
    // This used to ONLY call apiRequest("/pay", ...) against a backend at
    // localhost:8080. apiRequest() swallows network errors and returns null
    // (see its try/catch), so with no backend running the call was a silent
    // no-op — nothing was ever written to student.feePayments, which is the
    // array every balance/status calculation (getFeeRowFinance, the fee
    // table, the voucher) actually reads. The row kept recomputing the same
    // "Pending"/"Partial" status forever. We still ping the backend as a
    // best-effort sync, but the payment is now ALSO saved locally so the
    // UI and dashboard always reflect it immediately regardless of backend.
    apiRequest("/pay", "POST", { regNo: studentId, monthKey, amount: paid }).catch(() => {});

    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = afmCurrentStudent
        ? findStudentExact(students, studentId, afmCurrentStudent.fullName)
        : findStudentExact(students, studentId);

    if (!student) { alert('Student not found — payment was not saved.'); return; }
    if (!Array.isArray(student.feePayments)) student.feePayments = [];

    if (paid > 0) {
        student.feePayments.push({
            amount: paid,
            monthKey,
            monthLabel,
            feeType: 'Monthly Fee',
            method: 'cash',
            date: new Date().toISOString(),
            notes
        });
    }
    // Record the on-the-spot discount too — otherwise a discounted bill
    // never reaches remainingBalance <= 0 (the balance calc only knows
    // about actual payments), so it would stay "Partial" forever even
    // though the admin fully settled it with a discount applied.
    if (discount > 0) {
        student.feePayments.push({
            amount: discount,
            monthKey,
            monthLabel,
            feeType: 'On-the-spot Discount',
            method: 'discount',
            date: new Date().toISOString(),
            notes: notes || 'Discount applied at time of payment'
        });
    }

    localStorage.setItem('edu_students', JSON.stringify(students));

    showFeeSuccessToast(`Payment of Rs. ${paid} recorded successfully`);
    closeAddFeesModal();
    const className = document.getElementById('selected-class-title').innerText.replace('Fee Records: ', '');
    renderFees(className);
    // Class-card badges and any dashboard widgets reading 'edu_students'
    // should reflect the new Paid status immediately too.
    renderClassCardGrid();
}

function closeAddFeesModal() {
    document.getElementById('add-fees-modal').style.display = 'none';
}

function showFeeSuccessToast(message) {
    let toast = document.getElementById('fee-success-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'fee-success-toast';
        toast.className = 'fee-success-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    toast.classList.add('toast-visible');
    setTimeout(() => toast.classList.remove('toast-visible'), 3200);
}

// (renderAddFeesModal replaced above)

function renderPaymentHistory(student) {
    const payments = (student.feePayments || []).slice().reverse();
    const container = document.getElementById('af-payment-history');

    if (payments.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8;"><i class="fas fa-inbox" style="font-size:1.8rem; display:block; margin-bottom:8px;"></i> No payment records yet.</div>`;
        return;
    }

    let html = `<div class="af-history-list">`;
    payments.forEach(p => {
        const date = new Date(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        const methodIcons = { cash: 'fa-money-bill-wave', bank: 'fa-university', cheque: 'fa-file-alt', online: 'fa-mobile-alt' };
        const icon = methodIcons[p.method] || 'fa-receipt';
        html += `
            <div class="af-history-item">
                <div class="af-history-icon"><i class="fas ${icon}"></i></div>
                <div class="af-history-details">
                    <strong>Rs. ${p.amount.toLocaleString()}</strong>
                    <span>${p.feeType} &bull; ${p.method} &bull; ${date}</span>
                    ${p.notes ? `<span class="af-history-note">${p.notes}</span>` : ''}
                </div>
                <div class="af-history-month">${p.monthLabel || p.monthKey}</div>
            </div>`;
    });
    html += `</div>`;
    container.innerHTML = html;
}

// (saveStudentFeePayment, closeAddFeesModal, showFeeSuccessToast replaced above)

// ============================================================================
//  ADD FEES TO VOUCHER — MODAL LOGIC
// ============================================================================

// State for voucher fee rows
let atvFeeRows = [];
let atvNextRowId = 1;

// Fee name presets for the voucher form
const ATV_FEE_PRESETS = [
    { value: 'tuition',    label: '📚 Tuition Fee' },
    { value: 'transport',  label: '🚌 Transport Fee' },
    { value: 'book',       label: '📘 Book Fee' },
    { value: 'extra',      label: '➕ Extra Fee' },
    { value: 'annual',     label: '🏫 Annual Fund' },
    { value: 'admission',  label: '📝 Admission Fee' },
    { value: 'exam',       label: '📋 Exam Fee' },
    { value: 'stationary', label: '✏️ Stationery Fee' },
    { value: 'sports',     label: '⚽ Sports Fee' },
    { value: 'lab',        label: '🔬 Lab Fee' },
    { value: 'other',      label: '🏷️ Other Charges' },
    { value: 'custom',     label: '✏️ Custom Category' },
];

function initAtvVoucherModal() {
    const addBtn = document.getElementById('atv-add-fee-btn');
    if (addBtn && !addBtn.dataset.bound) {
        addBtn.dataset.bound = '1';
        addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            atvAddManualFeeRow();
        });
    }

    const modalBox = document.querySelector('#add-to-voucher-modal .voucher-modal-box');
    if (modalBox && !modalBox.dataset.bound) {
        modalBox.dataset.bound = '1';
        modalBox.addEventListener('click', (e) => e.stopPropagation());
    }
}

function atvAddManualFeeRow() {
    atvAddFeeRow('custom', 0, 0, '', { manual: true });
}

function atvScrollToFeeRow(rowId) {
    requestAnimationFrame(() => {
        const newRow = document.getElementById('atv-row-' + rowId);
        if (!newRow) return;

        const listScroller = document.getElementById('atv-fee-rows-container');
        if (listScroller) {
            const rowTop = newRow.offsetTop;
            listScroller.scrollTo({ top: Math.max(0, rowTop - 12), behavior: 'smooth' });
        }

        const modalScroller = newRow.closest('.voucher-modal-scroll');
        if (modalScroller) {
            const rowRect = newRow.getBoundingClientRect();
            const scrRect = modalScroller.getBoundingClientRect();
            if (rowRect.bottom > scrRect.bottom || rowRect.top < scrRect.top) {
                const offset = (rowRect.top - scrRect.top) + modalScroller.scrollTop - 24;
                modalScroller.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
            }
        } else {
            newRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        newRow.style.transition = 'background-color 0.6s ease';
        newRow.style.backgroundColor = '#eff6ff';
        setTimeout(() => { newRow.style.backgroundColor = ''; }, 900);

        const sel = newRow.querySelector('select');
        if (sel) sel.focus();
    });
}

function atvUpdateFeeRowCount() {
    const countEl = document.getElementById('atv-fee-row-count');
    if (countEl) {
        const n = atvFeeRows.length;
        countEl.textContent = n ? `${n} item${n === 1 ? '' : 's'}` : '';
    }
}

function openAddToVoucherModal(studentId, fullName, editMode) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = findStudentExact(students, studentId, fullName);
    if (!student) { alert('Student not found.'); return; }

    document.getElementById('atv-student-id').value = student.id;
    document.getElementById('atv-student-id').dataset.fullName = student.fullName || '';
    document.getElementById('atv-header-subtitle').textContent = `${student.fullName} · ${student.studentClass || ''}`;

    const titleEl = document.getElementById('atv-modal-title');
    if (titleEl) titleEl.textContent = editMode ? 'Edit Voucher' : 'Add Fees to Voucher';

    // Reset rows
    atvFeeRows = [];
    atvNextRowId = 1;
    const f = computeFeeBreakdown(student);

    // If this student already has a saved (edited) voucher, seed rows from THAT
    // so the admin sees the same voucher they previously saved. Otherwise,
    // seed from the standard fee profile.
    let savedFees = [];
    try { savedFees = JSON.parse(student.otherFeesData || '[]'); } catch(e) { savedFees = []; }
    const hasSaved = student.voucherCustomFees === true && Array.isArray(savedFees) && savedFees.length > 0;

    if (hasSaved) {
        savedFees.forEach(fee => {
            // Try to map description back to a preset value
            const preset = ATV_FEE_PRESETS.find(p =>
                p.label.toLowerCase().includes(String(fee.description||'').toLowerCase()) ||
                String(fee.description||'').toLowerCase().includes(p.value)
            );
            const type = preset ? preset.value : 'custom';
            atvAddFeeRow(type, parseFloat(fee.amount)||0, parseFloat(fee.discount)||0,
                         type === 'custom' ? (fee.description || '') : '');
        });
    } else {
        // BUGFIX — this used to read f.tDisc / f.trDisc / f.booksFee /
        // f.booksDiscount / f.showAnnualFund / f.annualFundAmt, none of which
        // computeFeeBreakdown() actually returns (same class of bug already
        // fixed once in openInlineVoucherEditor — see the note there). Every
        // one of those was `undefined`, so a student's existing tuition/
        // transport discount was silently seeded as a Rs.0 discount the
        // moment this modal opened; saving then locked in a "custom" voucher
        // with the discount permanently gone. Pull the real discount fields
        // straight from the student record, the same way the printed
        // voucher and the inline editor already do.
        const tuitionRowDiscount = (Number(student.tuitionDiscount) || 0) + (Number(student.siblingDiscount) || 0);
        if (f.tuitionFee > 0)   atvAddFeeRow('tuition',   f.tuitionFee,   tuitionRowDiscount);
        if (f.transportFee > 0) atvAddFeeRow('transport', f.transportFee, Number(student.transportDiscount) || 0);
        if (f.otherFee > 0)     atvAddFeeRow('other',     f.otherFee,     0);
    }
    if (atvFeeRows.length === 0) atvAddFeeRow('tuition', 0, 0);

    // Reset bulk discount (preload from saved if present)
    document.getElementById('atv-bulk-discount').value =
        Number(student.voucherBulkDiscount) > 0 ? Number(student.voucherBulkDiscount) : '';

    const noteEl = document.getElementById('atv-voucher-note');
    if (noteEl) noteEl.value = student.voucherNote || '';

    // Show due / expiry dates from live settings
    const _vs = getVoucherSettings();
    document.getElementById('atv-due-date-display').textContent = f.dueDateStr;
    document.getElementById('atv-expiry-date-display').textContent = f.expiryDateStr;
    const lateLabel = !_vs.lateFineEnabled
        ? 'Disabled'
        : (_vs.lateFineFixedAmount > 0
            ? `Rs. ${_vs.lateFineFixedAmount.toLocaleString()} fixed`
            : `${_vs.lateFinePercent}% of total`);
    document.getElementById('atv-late-fine-display').textContent = lateLabel;

    // Render student banner
    const photoHtml = student.photo
        ? `<img src="${student.photo}" class="af-student-photo">`
        : `<div class="af-student-photo af-photo-placeholder"><i class="fas fa-user"></i></div>`;
    document.getElementById('atv-student-summary').innerHTML = `
        <div class="af-summary-inner">
            ${photoHtml}
            <div class="af-summary-details">
                <div class="af-summary-name">${student.fullName}</div>
                <div class="af-summary-meta">
                    <span><i class="fas fa-id-card"></i> ${f.regNo}</span>
                    <span><i class="fas fa-layer-group"></i> ${student.studentClass || '-'}</span>
                    <span><i class="fas fa-user-friends"></i> ${student.guardianName || '-'}</span>
                </div>
            </div>
        </div>`;

    atvRenderRows();
    atvRecalc();
    initAtvVoucherModal();
    document.getElementById('add-to-voucher-modal').style.display = 'flex';
}

function closeAddToVoucherModal() {
    document.getElementById('add-to-voucher-modal').style.display = 'none';
    const titleEl = document.getElementById('atv-modal-title');
    if (titleEl) titleEl.textContent = 'Edit Voucher';
}

function atvAddFeeRow(typeVal, amount, discount, customLabel, options) {
    options = options || {};
    // Inline onclick may pass the click event as the first argument.
    if (typeVal && typeof typeVal !== 'string') typeVal = undefined;
    if (typeof amount !== 'number' && typeof amount !== 'string') amount = 0;
    if (typeof discount !== 'number' && typeof discount !== 'string') discount = 0;
    if (customLabel && typeof customLabel !== 'string') customLabel = '';

    const id = atvNextRowId++;
    const isManualAdd = options.manual === true || typeVal === undefined;
    const row = {
        id,
        type: typeVal || 'custom',
        amount: Number(amount) || 0,
        discount: Number(discount) || 0,
        customLabel: customLabel || ''
    };
    atvFeeRows.push(row);
    atvRenderRows();
    atvRecalc();

    if (isManualAdd) {
        atvScrollToFeeRow(id);
    }
}

function atvRemoveRow(id) {
    atvFeeRows = atvFeeRows.filter(r => r.id !== id);
    atvRenderRows();
    atvRecalc();
}

function atvUpdateRow(id, field, value) {
    const row = atvFeeRows.find(r => r.id === id);
    if (!row) return;
    if (field === 'type') {
        row.type = value;
        atvRenderRows();
    } else if (field === 'amount') {
        row.amount = parseFloat(value) || 0;
    } else if (field === 'discount') {
        row.discount = parseFloat(value) || 0;
    } else if (field === 'customLabel') {
        row.customLabel = value;
    }
    atvRecalc();
}

function atvRenderRows() {
    const container = document.getElementById('atv-fee-rows-container');
    if (!container) return;

    let html = '';
    atvFeeRows.forEach(row => {
        const net = Math.max(0, row.amount - row.discount);
        const selectedOptions = ATV_FEE_PRESETS.map(p =>
            `<option value="${p.value}" ${p.value === row.type ? 'selected' : ''}>${p.label}</option>`
        ).join('');
        const customNameInput = row.type === 'custom'
            ? `<input type="text" class="afm-input" style="margin-top:6px;" placeholder="Name this category…"
                       value="${(row.customLabel||'').replace(/"/g,'&quot;')}"
                       oninput="atvUpdateRow(${row.id},'customLabel',this.value)">`
            : '';
        html += `
        <div class="afm-fee-row" id="atv-row-${row.id}">
            <div class="afm-fee-row-type">
                <select class="afm-input afm-row-select" onchange="atvUpdateRow(${row.id},'type',this.value)">
                    ${selectedOptions}
                </select>
                ${customNameInput}
            </div>
            <div class="afm-fee-row-amt">
                <div class="afm-input-with-prefix">
                    <span class="afm-prefix">Rs.</span>
                    <input type="number" class="afm-input afm-no-left-radius" value="${row.amount || ''}" placeholder="0" min="0"
                        oninput="atvUpdateRow(${row.id},'amount',this.value)">
                </div>
            </div>
            <div class="afm-fee-row-disc">
                <div class="afm-input-with-prefix afm-disc-input">
                    <span class="afm-prefix afm-disc-prefix">- Rs.</span>
                    <input type="number" class="afm-input afm-no-left-radius" value="${row.discount || ''}" placeholder="0" min="0"
                        oninput="atvUpdateRow(${row.id},'discount',this.value)">
                </div>
            </div>
            <div class="afm-fee-row-net">
                <span class="afm-net-badge ${net > 0 ? '' : 'afm-net-zero'}" id="atv-net-${row.id}">Rs. ${net.toLocaleString()}</span>
            </div>
            <div class="afm-fee-row-del">
                ${atvFeeRows.length > 1 ? `<button class="afm-del-btn" onclick="atvRemoveRow(${row.id})" title="Remove"><i class="fas fa-trash-alt"></i></button>` : ''}
            </div>
        </div>`;
    });
    container.innerHTML = html;
    atvUpdateFeeRowCount();
}

function atvRecalc() {
    // Update net badges
    atvFeeRows.forEach(row => {
        const net = Math.max(0, row.amount - row.discount);
        const el = document.getElementById(`atv-net-${row.id}`);
        if (el) {
            el.textContent = `Rs. ${net.toLocaleString()}`;
            el.classList.toggle('afm-net-zero', net === 0);
        }
    });

    const bulkDisc = parseFloat(document.getElementById('atv-bulk-discount')?.value) || 0;
    const gross = atvFeeRows.reduce((s, r) => s + (r.amount || 0), 0);
    const itemDisc = atvFeeRows.reduce((s, r) => s + (r.discount || 0), 0);
    const totalDisc = itemDisc + bulkDisc;
    const voucherTotal = Math.max(0, gross - totalDisc);

    const vs = getVoucherSettings();
    const lateExtra = vs.lateFineEnabled
        ? (vs.lateFineFixedAmount > 0
            ? vs.lateFineFixedAmount
            : Math.round(voucherTotal * (vs.lateFinePercent / 100)))
        : 0;
    const lateTotal = voucherTotal + lateExtra;

    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('atv-t-gross', `Rs. ${gross.toLocaleString()}`);
    set('atv-t-disc',  `- Rs. ${totalDisc.toLocaleString()}`);
    set('atv-t-grand', `Rs. ${voucherTotal.toLocaleString()}`);
    set('atv-t-late',  `Rs. ${lateTotal.toLocaleString()}`);
}

function saveFeesToVoucher() {
    const idEl = document.getElementById('atv-student-id');
    const studentId = idEl.value;
    const fullName = idEl.dataset.fullName || '';
    const bulkDisc = parseFloat(document.getElementById('atv-bulk-discount').value) || 0;

    if (atvFeeRows.length === 0) { alert('Please add at least one fee item.'); return; }
    const gross = atvFeeRows.reduce((s, r) => s + (r.amount || 0), 0);
    if (gross <= 0) { alert('Please enter valid fee amounts.'); return; }

    let students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    let idx = -1;
    if (fullName) {
        idx = students.findIndex(s => String(s.id) === String(studentId) && s.fullName === fullName);
    }
    if (idx === -1) idx = students.findIndex(s => String(s.id) === String(studentId));
    if (idx === -1) { alert('Student not found.'); return; }

    // Build additional fees list to be stored on the student record
    // These will appear in the voucher via computeFeeBreakdown → additionalFees
    const newFeeEntries = atvFeeRows.map(row => {
        const preset = ATV_FEE_PRESETS.find(p => p.value === row.type);
        const desc = (row.type === 'custom' && row.customLabel)
            ? row.customLabel
            : (preset ? preset.label.replace(/^[^\s]+\s/, '') : row.type);
        return {
            description: desc,
            amount: row.amount,
            discount: row.discount
        };
    });

    // Replace previously-saved voucher items and mark this student as having
    // a custom voucher so computeFeeBreakdown doesn't ALSO add the base
    // tuition/transport charges (that's what caused the doubled total).
    const noteEl = document.getElementById('atv-voucher-note');
    students[idx].otherFeesData = JSON.stringify(newFeeEntries);
    students[idx].voucherBulkDiscount = bulkDisc;
    students[idx].voucherCustomFees = true;
    students[idx].voucherNote = noteEl ? noteEl.value.trim() : '';

    localStorage.setItem('edu_students', JSON.stringify(students));

    // BUGFIX — keep this month's already-generated voucher record in sync
    // with the edit just made. Without this, next month's arrears rollover
    // would keep comparing against the STALE pre-discount total, leaving a
    // phantom "still owed" balance even if the (correct, discounted) bill
    // was paid in full.
    syncVoucherSnapshotForCurrentMonth(students[idx].regNo || students[idx].id, students[idx].fullName);

    // Keep Pay Fee modal in sync if it is open for the same student
    if (afmCurrentStudent &&
        String(afmCurrentStudent.id) === String(students[idx].id) &&
        afmCurrentStudent.fullName === students[idx].fullName) {
        afmCurrentStudent = students[idx];
        renderAddFeesModal(students[idx]);
    }

    showFeeSuccessToast(`Fees saved to voucher for ${students[idx].fullName}`);
    closeAddToVoucherModal();

    // Auto-open the voucher preview (pass name to keep siblings separate)
    viewVoucher(students[idx].id, students[idx].fullName);

    // Refresh the table
    const classTitle = document.getElementById('selected-class-title');
    if (classTitle) {
        const className = classTitle.innerText.replace('Fee Records: ', '');
        renderFees(className);
    }
}

/* ============================================
   ADVANCE SALARY STORAGE HELPERS
   ============================================ */
function getAdvanceRecords() {
    return JSON.parse(localStorage.getItem('eduflow-staff-advances') || '[]');
}
function saveAdvanceRecords(list) {
    localStorage.setItem('eduflow-staff-advances', JSON.stringify(list));
}
function getTotalAdvance(staffId) {
    return getAdvanceRecords()
        .filter(r => r.staffId === staffId)
        .reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

/* ============================================
   TEACHING SALARY PAGE
   ============================================ */
function initTeachingSalaryPage() {
    const monthYear = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    document.getElementById('current-salary-month').value = monthYear;
    renderTeachingSalaries();
}

async function renderTeachingSalaries(filterText = '') {
    const tbody = document.getElementById('teaching-salary-tbody');
    const monthKey = getCurrentMonthKey(); // e.g., "2024-03"
    
    // Show loading state
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row"><i class="fas fa-spinner fa-spin"></i> Loading Teaching Staff...</td></tr>';

    try {
        // 1. Fetch all staff from the backend StaffController
        const staffResponse = await fetch("http://localhost:8080/api/staff");
        if (!staffResponse.ok) throw new Error("Failed to fetch staff");
        const allStaff = await staffResponse.json();

        // 2. Fetch all salary records for the current month to check payment status
        // We assume you might add a "GET all for month" endpoint, 
        // or we can fetch them individually. For now, let's fetch the staff 
        // and filter for the 'Teaching' category.
        const teachingStaff = allStaff.filter(t => 
            t.category === 'Teaching' && 
            (t.name.toLowerCase().includes(filterText.toLowerCase()) || 
             t.id.toLowerCase().includes(filterText.toLowerCase()))
        );

        if (teachingStaff.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No teaching staff found.</td></tr>';
            return;
        }

        // 3. Generate HTML rows
        let rowsHtml = "";

        for (const t of teachingStaff) {
            // Check status: We call an endpoint to see if this staff is paid for this month
            // If you haven't built this endpoint yet, it will default to 'Pending'
            let isPaid = false;
            try {
                const statusRes = await fetch(`http://localhost:8080/api/finance/salary/status/${t.id}/${monthKey}`);
                if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    isPaid = statusData.paid; // Expecting { paid: true/false }
                }
            } catch (e) {
                isPaid = false; // Fallback if endpoint doesn't exist
            }

            const absenceFine = Number(t.fines) || 0;
            const basicSalary = Number(t.salary) || 0;
            
            // Note: Advances are now handled in the backend, 
            // you might want to add a field 'totalAdvance' to your Staff model
            const advance = 0; 

            rowsHtml += `
                <tr class="salary-row-clickable" onclick="showSalaryBreakdown('${t.id}', 'Teaching')" title="Click to view salary breakdown">
                    <td class="teacher-id-cell">${t.id}</td>
                    <td>
                        <div style="font-weight:600;">${t.name}</div>
                        <div style="font-size:11px; color:var(--text-secondary);">${t.phone || 'No Phone'}</div>
                    </td>
                    <td>${t.role || 'Teacher'}</td>
                    <td><strong>RS ${basicSalary.toLocaleString()}</strong></td>
                    <td>
                        <span style="color:#ef4444; font-weight:600;">
                            ${absenceFine > 0 ? '− RS ' + absenceFine.toLocaleString() : 'None'}
                        </span>
                    </td>
                    <td>
                        <strong style="color:#eab308;">RS ${advance.toLocaleString()}</strong>
                    </td>
                    <td>
                        <span class="status-badge ${isPaid ? 'status-paid' : 'status-pending'}">
                            <i class="fas ${isPaid ? 'fa-check-circle' : 'fa-clock'}"></i>
                            ${isPaid ? 'Paid' : 'Pending'}
                        </span>
                    </td>
                </tr>
            `;
        }

        tbody.innerHTML = rowsHtml;

    } catch (err) {
        console.error("Fetch Error:", err);
        tbody.innerHTML = '<tr><td colspan="7" class="empty-row" style="color:red;">Error connecting to backend server.</td></tr>';
    }
}

function filterTeachingSalaries() {
    renderTeachingSalaries(document.getElementById('teacher-salary-search').value);
}

/* ============================================
   NON-TEACHING SALARY PAGE
   ============================================ */
function initNonTeachingSalaryPage() {
    const monthYear = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const el = document.getElementById('current-salary-month-nt');
    if (el) el.value = monthYear;
    renderNonTeachingSalaries();
}

function renderNonTeachingSalaries(filterText = '') {
    const tbody = document.getElementById('non-teaching-salary-tbody');
    if (!tbody) return;
    const db = getGlobalData();
    const workers = db.staff['Non-Teaching'] || [];
    const currentMonthKey = getCurrentMonthKey();

    const filtered = workers.filter(w =>
        w.name.toLowerCase().includes(filterText.toLowerCase()) ||
        w.id.toLowerCase().includes(filterText.toLowerCase())
    );

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No matching workers found.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(w => {
        const isPaid = (w.salaryHistory || []).some(h => h.monthKey === currentMonthKey);
        const advance = getTotalAdvance(w.id);
        const absenceFine = Number(w.fines) || 0;
        const absentDays  = Number(w.absentDaysThisMonth) || 0;
        const fineLabel   = absenceFine > 0
            ? `<span style="color:#ef4444;font-weight:600;">− RS ${absenceFine.toLocaleString()}</span><span style="font-size:10px;color:var(--text-secondary);display:block;">${absentDays}d absent</span>`
            : `<span style="color:var(--text-secondary);font-size:12px;">None</span>`;
        return `
            <tr class="salary-row-clickable" onclick="showSalaryBreakdown('${w.id}', 'Non-Teaching')" title="Click to view salary breakdown">
                <td class="teacher-id-cell">${w.id}</td>
                <td>
                    <div style="font-weight:600;">${w.name}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">${w.email || ''}</div>
                </td>
                <td>${w.job || 'Worker'}</td>
                <td><strong>RS ${(Number(w.salary) || 0).toLocaleString()}</strong></td>
                <td>${fineLabel}</td>
                <td><strong style="color:#eab308;">RS ${advance.toLocaleString()}</strong></td>
                <td>
                    <span class="status-badge ${isPaid ? 'status-paid' : 'status-pending'}">
                        <i class="fas ${isPaid ? 'fa-check-circle' : 'fa-clock'}"></i>
                        ${isPaid ? 'Paid' : 'Pending'}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

function filterNonTeachingSalaries() {
    const el = document.getElementById('worker-salary-search');
    renderNonTeachingSalaries(el ? el.value : '');
}

/* ============================================
   SALARY BREAKDOWN PANEL (shared)
   ============================================ */
function showSalaryBreakdown(staffId, category = 'Teaching') {
    const db = getGlobalData();
    let list = db.staff[category] || [];
    let staff = list.find(s => s.id === staffId);
    if (!staff) {
        // Fallback: scan all staff categories (key for non-teaching may differ)
        for (const key of Object.keys(db.staff || {})) {
            const found = (db.staff[key] || []).find(s => s.id === staffId);
            if (found) { staff = found; category = key; break; }
        }
    }
    if (!staff) return;

    const bonusRecords = JSON.parse(localStorage.getItem('eduflow-staff-bonus') || '[]');
    const fineRecords  = JSON.parse(localStorage.getItem('eduflow-staff-fines') || '[]');
    const matchStaff = r => String(r.staffId) === String(staffId) || String(r.id) === String(staffId);
    const currentMonthKey = getCurrentMonthKey();
    const matchMonth = r => !r.monthKey || r.monthKey === currentMonthKey;

    const totalBonus = bonusRecords
        .filter(r => matchStaff(r) && matchMonth(r))
        .reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const totalFine = fineRecords
        .filter(r => matchStaff(r) && matchMonth(r))
        .reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const baseSalary    = Number(staff.salary) || 0;
    const advanceTaken  = getTotalAdvance(staffId);

    // Security deposit auto-deduction (monthly until fully collected)
    const secInfo       = computeMonthlySecurity(staff);
    // Manual override (legacy) is added on top of the auto monthly deduction
    const manualSecurity = Number(staff.security) || 0;
    const security      = secInfo.monthlyDue + manualSecurity;

    // Auto absence fine (written by attendance.js applyAbsenceFines)
    const absenceFine   = Number(staff.fines) || 0;
    const absentDays    = Number(staff.absentDaysThisMonth) || 0;

    const netPayable    = baseSalary + totalBonus - security - totalFine - absenceFine - advanceTaken;
    const fmt = n => 'RS ' + Math.max(0, n).toLocaleString();

    document.getElementById('sbp-teacher-name').textContent = staff.name;
    document.getElementById('sbp-teacher-id').textContent   = staff.id;
    document.getElementById('sbp-total-salary').value   = fmt(baseSalary);
    document.getElementById('sbp-bonus').value          = fmt(totalBonus);
    document.getElementById('sbp-security').value       = secInfo.total > 0
        ? `${fmt(security)}  (${secInfo.collected.toLocaleString()} / ${secInfo.total.toLocaleString()})`
        : fmt(security);
    document.getElementById('sbp-fine').value           = fmt(totalFine);
    document.getElementById('sbp-advance-taken').value  = fmt(advanceTaken);
    document.getElementById('sbp-net-payable').value    = 'RS ' + netPayable.toLocaleString();

    // Absence fine — auto from attendance
    const absEl = document.getElementById('sbp-absence-fine');
    const absLabel = document.getElementById('sbp-absent-days-label');
    if (absEl) absEl.value = absenceFine > 0 ? fmt(absenceFine) : 'RS 0';
    if (absLabel) absLabel.textContent = absentDays > 0 ? `(${absentDays}d)` : '';

    // reset advance input UI
    const wrap = document.getElementById('sbp-advance-input-wrap');
    if (wrap) wrap.classList.add('d-none');
    const amt = document.getElementById('sbp-advance-amount');
    if (amt) amt.value = '';

    const panel = document.getElementById('salary-breakdown-panel');
    panel.dataset.teacherId = staffId;
    panel.dataset.category  = category;
    panel.classList.remove('d-none');
    const backdrop = document.getElementById('salary-breakdown-backdrop');
    if (backdrop) backdrop.classList.remove('d-none');
    document.body.style.overflow = 'hidden';

    // Show or hide the green "Paid" overlay
    const isPaidThisMonth = (staff.salaryHistory || []).some(h => h.monthKey === getCurrentMonthKey());
    let paidOverlay = panel.querySelector('.sbp-paid-overlay');
    if (!paidOverlay) {
        paidOverlay = document.createElement('div');
        paidOverlay.className = 'sbp-paid-overlay';
        paidOverlay.innerHTML = `
            <div class="sbp-paid-badge">
                <i class="fas fa-check-circle"></i>
                <span>Paid for This Month</span>
            </div>
        `;
        panel.appendChild(paidOverlay);
    }
    paidOverlay.style.display = isPaidThisMonth ? 'flex' : 'none';
}

function closeSalaryBreakdown() {
    document.getElementById('salary-breakdown-panel').classList.add('d-none');
    const backdrop = document.getElementById('salary-breakdown-backdrop');
    if (backdrop) backdrop.classList.add('d-none');
    document.body.style.overflow = '';
}

async function payCurrentSalary() {
    const panel = document.getElementById('salary-breakdown-panel');
    const staffId = panel && panel.dataset.teacherId;
    const category = (panel && panel.dataset.category) || 'Teaching';

    if (!staffId) return;

    // 1. Get values from the UI fields
    // We remove "RS " and commas to get a clean number for the backend
    const bonus = parseFloat(document.getElementById('sbp-bonus').value.replace(/[^0-9.]/g, '')) || 0;
    const manualFine = parseFloat(document.getElementById('sbp-fine').value.replace(/[^0-9.]/g, '')) || 0;
    const monthKey = getCurrentMonthKey();

    if (!confirm(`Confirm salary payment for ${document.getElementById('sbp-teacher-name').textContent}?`)) return;

    try {
        // 2. Call the Spring Boot Backend
        const response = await apiCall("/salary/pay", "POST", {
            staffId: staffId,
            monthKey: monthKey,
            bonus: bonus,
            fine: manualFine
        });

        // 3. Success UI updates
        alert("Salary processed and recorded in database!");
        
        // Refresh the table to show "Paid" status
        if (category === 'Teaching') {
            renderTeachingSalaries();
        } else {
            renderNonTeachingSalaries();
        }
        
        closeSalaryBreakdown();
    } catch (err) {
        console.error(err);
        alert("Error: " + err.message);
    }
}

function processSalaryPayment(staffId, category = 'Teaching') {
    const db = getGlobalData();
    const list = db.staff[category] || [];
    const staff = list.find(s => s.id === staffId);
    if (!staff) return;

    const absenceFine = Number(staff.fines) || 0;
    // Subtract manual fines logged for this month as well
    const _fineRecs = JSON.parse(localStorage.getItem('eduflow-staff-fines') || '[]');
    const _mk = getCurrentMonthKey();
    const manualFine = _fineRecs
        .filter(r => (String(r.staffId) === String(staffId) || String(r.id) === String(staffId))
                  && (!r.monthKey || r.monthKey === _mk))
        .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const totalFines  = absenceFine + manualFine;
    const netSalary   = Math.max(0, Number(staff.salary) - totalFines);
    const fineNote    = totalFines > 0 ? ` (after RS ${totalFines.toLocaleString()} fines)` : '';

    if (confirm(`Confirm salary payment of RS ${netSalary.toLocaleString()} to ${staff.name}?${fineNote}`)) {
        if (!staff.salaryHistory) staff.salaryHistory = [];

        // Apply this month's security deduction (if any pending)
        const secInfo = computeMonthlySecurity(staff);
        const secDeducted = secInfo.monthlyDue;
        if (secDeducted > 0) {
            staff.securityCollected = (Number(staff.securityCollected) || 0) + secDeducted;
        }

        // Reset absence fine after payment (marks it as settled)
        staff.finesPaidThisMonth = absenceFine;
        staff.fines = 0;
        staff.absentDaysThisMonth = 0;

        staff.salaryHistory.push({
            date: new Date().toISOString(),
            monthKey: getCurrentMonthKey(),
            amount: staff.salary,
            absenceFineDeducted: absenceFine,
            securityDeducted: secDeducted,
            status: 'Paid'
        });

        saveGlobalData(db);
        const note = secDeducted > 0 ? `\nSecurity deducted: RS ${secDeducted.toLocaleString()}` : '';
        const fineMsg = absenceFine > 0 ? `\nAbsence fine deducted: RS ${absenceFine.toLocaleString()}` : '';
        alert(`Salary processed successfully for ${staff.name}${fineMsg}${note}`);
        if (category === 'Teaching') {
            renderTeachingSalaries(document.getElementById('teacher-salary-search').value);
        } else {
            const sEl = document.getElementById('worker-salary-search');
            renderNonTeachingSalaries(sEl ? sEl.value : '');
        }
    }
}

/* ============================================
   SECURITY DEPOSIT — MONTHLY DEDUCTION HELPER
   --------------------------------------------
   Returns the amount that should be deducted from this month's salary
   for the staff member's security deposit. Once securityCollected
   reaches securityTotal, monthlyDue returns 0.
   If the current month's salary has already been paid (and the
   security was already deducted as part of that payment), monthlyDue
   also returns 0 to avoid double-counting in the breakdown panel.
   ============================================ */
function computeMonthlySecurity(staff) {
    const total     = Number(staff.securityTotal)     || 0;
    const monthly   = Number(staff.securityMonthly)   || 0;
    const collected = Number(staff.securityCollected) || 0;
    const remaining = Math.max(0, total - collected);

    if (total <= 0 || monthly <= 0 || remaining <= 0) {
        return { total, monthly, collected, remaining: 0, monthlyDue: 0 };
    }

    // If already paid this month, don't show pending deduction again.
    const monthKey = getCurrentMonthKey();
    const paidThisMonth = (staff.salaryHistory || []).some(h => h.monthKey === monthKey);
    if (paidThisMonth) {
        return { total, monthly, collected, remaining, monthlyDue: 0 };
    }

    return {
        total, monthly, collected, remaining,
        monthlyDue: Math.min(monthly, remaining)
    };
}


/* ============================================
   ADVANCE SALARY — UI + PAYMENT
   ============================================ */
function isStaffPaidThisMonth(staffId, category) {
    const db = getGlobalData();
    const list = db.staff[category] || [];
    const staff = list.find(s => s.id === staffId);
    if (!staff) return false;
    return (staff.salaryHistory || []).some(h => h.monthKey === getCurrentMonthKey());
}

/* ============================================
   INLINE "ADD BONUS" — from the Salary Breakdown panel
   Reuses the same eduflow-staff-bonus log as the Staff Bonus page,
   just entered from a different section of the UI.
   ============================================ */
function toggleInlineBonus() {
    const panel = document.getElementById('salary-breakdown-panel');
    const staffId  = panel && panel.dataset.teacherId;
    const category = (panel && panel.dataset.category) || 'Teaching';
    if (staffId && isStaffPaidThisMonth(staffId, category)) {
        alert('Salary for this month has already been paid. No further actions can be performed until next month.');
        return;
    }
    const wrap = document.getElementById('sbp-inline-bonus-wrap');
    if (!wrap) return;
    wrap.classList.toggle('d-none');
    if (!wrap.classList.contains('d-none')) {
        const amt = document.getElementById('sbp-inline-bonus-amount');
        if (amt) amt.focus();
    }
}

function addBonusFromSalaryPanel() {
    const panel = document.getElementById('salary-breakdown-panel');
    const staffId  = panel && panel.dataset.teacherId;
    const category = (panel && panel.dataset.category) || 'Teaching';
    if (!staffId) return;

    const amount = Number(document.getElementById('sbp-inline-bonus-amount').value);
    const desc = document.getElementById('sbp-inline-bonus-desc').value.trim();
    if (!amount || amount < 1) { alert('Please enter a valid bonus amount.'); return; }
    if (!desc) { alert('Please enter a bonus reason.'); return; }

    const db = getGlobalData();
    const members = db.staff[category] || [];
    const member = members.find(s => s.id === staffId);
    if (!member) { alert('Staff member not found.'); return; }

    const role = category === 'Teaching' ? (member.subjects || 'Teacher') : (member.job || 'Staff');

    const log = getStaffBonusData();
    log.push({
        staffId: member.id, id: member.id, name: member.name, role: role,
        category: category, amount: amount, description: desc,
        date: new Date().toLocaleDateString('en-US'),
        monthKey: getCurrentMonthKey()
    });
    saveStaffBonusData(log);

    document.getElementById('sbp-inline-bonus-amount').value = '';
    document.getElementById('sbp-inline-bonus-desc').value = '';
    document.getElementById('sbp-inline-bonus-wrap').classList.add('d-none');

    // Refresh the breakdown so the Bonus / Net Payable figures update immediately
    showSalaryBreakdown(staffId, category);
}

function toggleAdvancePay() {
    const panel = document.getElementById('salary-breakdown-panel');
    const staffId  = panel && panel.dataset.teacherId;
    const category = (panel && panel.dataset.category) || 'Teaching';
    if (staffId && isStaffPaidThisMonth(staffId, category)) {
        alert('Salary for this month has already been paid. No further actions can be performed until next month.');
        return;
    }
    const wrap = document.getElementById('sbp-advance-input-wrap');
    if (!wrap) return;
    wrap.classList.toggle('d-none');
    if (!wrap.classList.contains('d-none')) {
        const amt = document.getElementById('sbp-advance-amount');
        if (amt) amt.focus();
    }
}

async function payAdvanceSalary() {
    const panel = document.getElementById('salary-breakdown-panel');
    const staffId = panel && panel.dataset.teacherId;
    if (!staffId) return;

    const amtEl = document.getElementById('sbp-advance-amount');
    const amount = Number(amtEl && amtEl.value);
    const monthKey = getCurrentMonthKey();

    if (!amount || amount <= 0) {
        alert('Please enter a valid advance amount.');
        return;
    }

    try {
        // Call the Spring Boot Backend
        await apiCall("/salary/advance", "POST", {
            staffId: staffId,
            amount: amount,
            monthKey: monthKey
        });

        alert(`Advance of RS ${amount.toLocaleString()} recorded in database.`);
        
        // Clear input and refresh panel
        amtEl.value = '';
        showSalaryBreakdown(staffId, panel.dataset.category); 
    } catch (err) {
        alert("Failed to record advance: " + err.message);
    }
}

/* ============================================================
   PUBLIC DEDUCTION API
   ------------------------------------------------------------
   Use these from ANY other page (just include manage-finance.js
   on that page, or copy this block) to control the per-staff
   "Security" and "Fee Deducted" values that drive Net Payable
   in the Staff Salary breakdown panel.

   Quick reference (call from console or another script):

     // Set one staff member
     EduFlowFinance.setStaffSecurity('STF-001', 2000);
     EduFlowFinance.setStaffFeeDeducted('STF-001', 500);

     // Read current values
     EduFlowFinance.getStaffDeductions('STF-001');
     // => { security: 2000, feeDeducted: 500 }

     // Apply the same defaults to EVERY staff member
     EduFlowFinance.setAllStaffDeductionDefaults({
         security: 1000,
         feeDeducted: 250
     });

   Net Payable formula (already wired in showSalaryBreakdown):
     baseSalary + totalBonus
       - security - feeDeducted - totalFine - advanceTaken
   Bonus and Fine totals come live from the records added on the
   "Add Staff Bonus" / "Add Staff Fine" pages, so every new entry
   updates the salary panel automatically.
   ============================================================ */
function setStaffDeduction(staffId, field, value) {
    if (field !== 'security' && field !== 'feeDeducted') return false;
    const db = getGlobalData();
    if (!db || !db.staff) return false;
    for (const cat of Object.keys(db.staff)) {
        const list = db.staff[cat] || [];
        const i = list.findIndex(s => String(s.id) === String(staffId));
        if (i !== -1) {
            list[i][field] = Math.max(0, Number(value) || 0);
            saveGlobalData(db);
            return true;
        }
    }
    return false;
}
function setStaffSecurity(staffId, value)    { return setStaffDeduction(staffId, 'security',    value); }
function setStaffFeeDeducted(staffId, value) { return setStaffDeduction(staffId, 'feeDeducted', value); }

function getStaffDeductions(staffId) {
    const db = getGlobalData();
    if (!db || !db.staff) return null;
    for (const cat of Object.keys(db.staff)) {
        const s = (db.staff[cat] || []).find(x => String(x.id) === String(staffId));
        if (s) {
            return {
                security:    Number(s.security)    || 0,
                feeDeducted: Number(s.feeDeducted) || 0
            };
        }
    }
    return null;
}

function setAllStaffDeductionDefaults(opts) {
    opts = opts || {};
    const db = getGlobalData();
    if (!db || !db.staff) return;
    for (const cat of Object.keys(db.staff)) {
        (db.staff[cat] || []).forEach(s => {
            if (opts.security    !== undefined) s.security    = Math.max(0, Number(opts.security)    || 0);
            if (opts.feeDeducted !== undefined) s.feeDeducted = Math.max(0, Number(opts.feeDeducted) || 0);
        });
    }
    saveGlobalData(db);
}

window.atvAddFeeRow = atvAddFeeRow;
window.atvAddManualFeeRow = atvAddManualFeeRow;
window.atvRemoveRow = atvRemoveRow;
window.atvUpdateRow = atvUpdateRow;
window.saveFeesToVoucher = saveFeesToVoucher;
window.openAddToVoucherModal = openAddToVoucherModal;
window.closeAddToVoucherModal = closeAddToVoucherModal;

// Expose globally so other pages / settings panels can drive these values.
window.EduFlowFinance = Object.assign(window.EduFlowFinance || {}, {
    setStaffSecurity,
    setStaffFeeDeducted,
    setStaffDeduction,
    getStaffDeductions,
    setAllStaffDeductionDefaults
});


/* ============================================================
   INLINE EDITABLE VOUCHER (click-to-edit replica of the voucher)
   ============================================================ */
let ievCurrentStudentId = null;
let ievCurrentStudentName = '';
let ievRows = [];   // [{description, period, amount, discount}]

let ievArrears = 0;
let ievFineAmount = 0;
let ievFineReason = '';

function openInlineVoucherEditor(studentId, fullName) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = findStudentExact(students, studentId, fullName);
    if (!student) { alert('Student not found.'); return; }

    ievCurrentStudentId = studentId;
    ievCurrentStudentName = fullName;

    const f = computeFeeBreakdown(student);
    let rows;

    // BUGFIX — "Edit Voucher" was throwing away previous edits: it always
    // rebuilt rows from computeFeeBreakdown's base fields (and even referenced
    // fields like f.booksFee / f.additionalFees / f.showAnnualFund that this
    // function never actually returns, so they were always empty/undefined).
    // If a custom breakdown was already saved, reload THAT so re-opening the
    // editor shows exactly what was last saved, instead of silently reverting
    // to the plain tuition/transport/other fields.
    if (f.isCustom && Array.isArray(f.customRows) && f.customRows.length > 0) {
        rows = f.customRows.map(r => ({
            description: r.description || '',
            period: r.period || f.monthLabel,
            amount: Number(r.amount) || 0,
            discount: Number(r.discount) || 0
        }));
    } else {
        rows = [];
        // Fold the named concessions into their matching row's discount so
        // they aren't silently dropped the moment this gets saved as a
        // custom breakdown (sibling discount is bundled with tuition since
        // it isn't tied to a single fee line of its own).
        const tuitionRowDiscount = (Number(student.tuitionDiscount) || 0) + (Number(student.siblingDiscount) || 0);
        if (f.tuitionFee   > 0) rows.push({ description: 'Tuition Fee',        period: f.monthLabel, amount: f.tuitionFee,   discount: tuitionRowDiscount });
        if (f.transportFee > 0) rows.push({ description: 'Transportation Fee', period: f.monthLabel, amount: f.transportFee, discount: Number(student.transportDiscount) || 0 });
        if (f.otherFee     > 0) rows.push({ description: 'Other Charges',      period: '-',          amount: f.otherFee,     discount: 0 });
    }
    if (rows.length === 0) rows.push({ description: '', period: '', amount: 0, discount: 0 });

    ievRows = rows;
    ievArrears = Number(f.arrears) || Number(student.arrears) || 0;

    // BUGFIX — "fine not adding up": the fine lives on the backend and is
    // fetched fresh by viewVoucher(); re-reading the student from localStorage
    // here loses it. Use the value viewVoucher() just cached instead, so the
    // fine is visible and included in the running total while editing (it
    // still isn't editable here — it's authoritative from the database — but
    // it must not silently disappear from what the admin sees).
    ievFineAmount = Number(currentVoucherFineAmount) || 0;
    ievFineReason = currentVoucherFineReason || '';

    // Fill meta info
    document.getElementById('iev-student-name').textContent = student.fullName || '';
    document.getElementById('iev-student-reg').textContent  = f.regNo || '';
    document.getElementById('iev-student-class').textContent= student.studentClass || '-';
    document.getElementById('iev-month-label').textContent  = f.monthLabel;

    const arrInput = document.getElementById('iev-arrears-input');
    if (arrInput) arrInput.value = ievArrears;

    const noteInput = document.getElementById('iev-note-input');
    if (noteInput) noteInput.value = student.voucherNote || '';

    closeVoucherModal();
    renderInlineVoucherRows();
    renderIevFineRow();
    document.getElementById('iev-modal-overlay').style.display = 'flex';
}

// Read-only fine display row, injected just above the arrears row so the
// admin can see it is included in the total instead of it seeming to vanish.
function renderIevFineRow() {
    const existing = document.getElementById('iev-fine-row');
    if (existing) existing.remove();
    if (ievFineAmount <= 0) return;
    const arrearsRow = document.querySelector('.iev-arrears-row');
    if (!arrearsRow) return;
    const tr = document.createElement('tr');
    tr.id = 'iev-fine-row';
    tr.className = 'iev-arrears-row';
    tr.innerHTML = `
        <td colspan="2" style="color:#dc2626;"><i class="fas fa-exclamation-triangle"></i> Fine / Penalty <span style="font-size:0.7rem; font-weight:400;">(from database, not editable here)</span></td>
        <td colspan="2" style="color:#dc2626;"><strong>Rs. ${ievFineAmount.toLocaleString()}</strong>${ievFineReason ? ` <span style="font-size:0.72rem;">(${escapeHtml(ievFineReason)})</span>` : ''}</td>
        <td></td>`;
    arrearsRow.parentNode.insertBefore(tr, arrearsRow);
}

function closeInlineVoucherEditor() {
    document.getElementById('iev-modal-overlay').style.display = 'none';
}

function renderInlineVoucherRows() {
    const tbody = document.getElementById('iev-rows-body');
    tbody.innerHTML = ievRows.map((r, i) => `
        <tr class="iev-row" data-i="${i}">
            <td>
                <input type="text" class="iev-input" value="${escapeHtml(r.description || '')}"
                    placeholder="Fee description"
                    oninput="ievUpdateRow(${i},'description',this.value)">
            </td>
            <td>
                <input type="text" class="iev-input" value="${escapeHtml(r.period || '')}"
                    placeholder="Period / note"
                    oninput="ievUpdateRow(${i},'period',this.value)">
            </td>
            <td>
                <div class="iev-amount-wrap">
                    <span class="iev-rs">Rs.</span>
                    <input type="number" min="0" class="iev-input iev-amount" value="${Number(r.amount)||0}"
                        placeholder="0"
                        oninput="ievUpdateRow(${i},'amount',this.value)">
                </div>
            </td>
            <td>
                <div class="iev-amount-wrap iev-discount-wrap">
                    <span class="iev-rs">- Rs.</span>
                    <input type="number" min="0" class="iev-input iev-amount iev-discount" value="${Number(r.discount)||0}"
                        placeholder="0"
                        oninput="ievUpdateRow(${i},'discount',this.value)">
                </div>
            </td>
            <td class="iev-row-actions">
                <button type="button" class="iev-del-btn" title="Delete row" onclick="ievDeleteRow(${i})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
    ievRecalcTotal();
}

function ievUpdateRow(i, field, value) {
    if (!ievRows[i]) return;
    if (field === 'amount' || field === 'discount') {
        ievRows[i][field] = Math.max(0, parseFloat(value) || 0);
        ievRecalcTotal();
    } else {
        ievRows[i][field] = value;
    }
}

function ievUpdateArrears(value) {
    ievArrears = Math.max(0, parseFloat(value) || 0);
    ievRecalcTotal();
}

function ievAddRow() {
    ievRows.push({ description: '', period: '', amount: 0, discount: 0 });
    renderInlineVoucherRows();
    // focus the new row's description input
    const tbody = document.getElementById('iev-rows-body');
    const last = tbody.querySelector('tr:last-child input');
    if (last) last.focus();
}

function ievDeleteRow(i) {
    ievRows.splice(i, 1);
    if (ievRows.length === 0) ievRows.push({ description: '', period: '', amount: 0, discount: 0 });
    renderInlineVoucherRows();
}

function ievRecalcTotal() {
    const subtotal = ievRows.reduce((s, r) => {
        const net = Math.max(0, (Number(r.amount) || 0) - (Number(r.discount) || 0));
        return s + net;
    }, 0);
    // Fine + arrears both add on top of the row subtotal, matching how
    // computeFeeBreakdown() computes the real voucher total.
    const total = subtotal + (Number(ievFineAmount) || 0) + (Number(ievArrears) || 0);
    const subEl = document.getElementById('iev-subtotal');
    const el = document.getElementById('iev-total');
    if (subEl) subEl.textContent = 'Rs. ' + subtotal.toLocaleString();
    if (el) el.textContent = 'Rs. ' + total.toLocaleString();
}

function ievSave() {
    const studentId = ievCurrentStudentId;
    const fullName  = ievCurrentStudentName;
    if (!studentId) return;

    const cleanRows = ievRows
        .map(r => ({
            description: (r.description || '').trim(),
            period: (r.period || '').trim(),
            amount: Math.max(0, Number(r.amount) || 0),
            discount: Math.max(0, Number(r.discount) || 0)
        }))
        .filter(r => r.description || r.amount > 0);

    if (cleanRows.length === 0) { alert('Please add at least one fee row.'); return; }

    let students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    let idx = students.findIndex(s => String(s.id) === String(studentId) && s.fullName === fullName);
    if (idx === -1) idx = students.findIndex(s => String(s.id) === String(studentId));
    if (idx === -1) { alert('Student not found.'); return; }

    const noteEl = document.getElementById('iev-note-input');

    // Mark as a custom voucher so base charges are not added on top, then
    // store every editable row as an "additional fee" entry.
    students[idx].otherFeesData      = JSON.stringify(cleanRows);
    students[idx].voucherCustomFees  = true;
    // Reset any prior bulk discount — per-row discounts now drive the math.
    students[idx].voucherBulkDiscount = 0;
    // Persist editable arrears + voucher note
    students[idx].arrears     = Math.max(0, Number(ievArrears) || 0);
    students[idx].voucherNote = noteEl ? noteEl.value.trim() : (students[idx].voucherNote || '');

    localStorage.setItem('edu_students', JSON.stringify(students));

    // BUGFIX — same fix as saveFeesToVoucher(): sync this month's generated
    // record so a discount/edit applied here doesn't leave a phantom
    // "arrears" balance once the bill is actually paid and the month rolls over.
    syncVoucherSnapshotForCurrentMonth(students[idx].regNo || students[idx].id, students[idx].fullName);

    if (typeof showFeeSuccessToast === 'function') {
        showFeeSuccessToast(`Voucher updated for ${students[idx].fullName}`);
    }

    closeInlineVoucherEditor();
    // Re-open the read-only voucher with the new values.
    viewVoucher(studentId, fullName);
}

/**
 * Processes a comma-separated string of reasons.
 * - If one reason appears more than once, show that reason.
 * - If all reasons are unique, show them inside [reason1, reason2].
 */
function getSmartFineReason(reasonString) {
    if (!reasonString) return "N/A";
    
    // Split into array and clean up
    const reasons = reasonString.split(',').map(r => r.trim()).filter(r => r !== "");
    if (reasons.length === 0) return "N/A";

    const frequencyMap = {};
    reasons.forEach(r => frequencyMap[r] = (frequencyMap[r] || 0) + 1);

    let mostFrequentReason = "";
    let maxCount = 0;
    let hasDuplicate = false;

    for (const reason in frequencyMap) {
        if (frequencyMap[reason] > maxCount) {
            maxCount = frequencyMap[reason];
            mostFrequentReason = reason;
        }
        if (frequencyMap[reason] > 1) hasDuplicate = true;
    }

    // Requirement: If more than one time means he gets more fine for one reason
    if (hasDuplicate) {
        return `${mostFrequentReason} <small>(Frequent)</small>`;
    } else {
        // Show all unique reasons inside square brackets
        return `<span style="font-size: 0.75rem;">[${reasons.join(', ')}]</span>`;
    }
}

async function showFineDetails(regNo, monthKey) {
    const page = document.getElementById('fine-full-record-page');
    page.classList.remove('d-none');
    document.body.style.overflow = 'hidden';

    // Make sure the header-transparency scroll effect is bound, and start fresh (header transparent at top)
    initLedgerScrollEffect();
    const ledgerContainer = document.querySelector('.ledger-container');
    if (ledgerContainer) {
        ledgerContainer.scrollTop = 0;
        ledgerContainer.classList.remove('is-scrolled');
    }

    try {
        const summary = await apiCall(`/status/${regNo}/${monthKey}`);
        currentDetailedFines = await apiCall(`/fine-details/${regNo}/${monthKey}`);

        // 1. Calculate Quick Stats
        const totalPending = currentDetailedFines.filter(f => f.status !== "Paid").reduce((s, f) => s + f.amount, 0);
        const totalPaid = currentDetailedFines.filter(f => f.status === "Paid").reduce((s, f) => s + f.amount, 0);

        // 2. Render Banner
        document.getElementById('full-fine-banner').innerHTML = `
            <div class="portfolio-student-info">
                <label style="color: #10b981; font-weight: 800; font-size: 0.75rem; letter-spacing: 2px; text-transform: uppercase;">Financial Integrity Portfolio</label>
                <h1>${summary.studentName}</h1>
                <div class="portfolio-meta">
                    <span><i class="fas fa-user-shield"></i> Guardian: <b>${summary.guardianName}</b></span>
                    <span><i class="fas fa-fingerprint"></i> ID: <b>${summary.regNo}</b></span>
                    <span><i class="fas fa-layer-group"></i> <b>${summary.studentClass} - ${summary.section}</b></span>
                </div>
            </div>
            <div class="portfolio-stats">
                <div class="stat-pill" style="border-color: rgba(239, 68, 68, 0.3);">
                    <label>Unpaid Balance</label>
                    <span style="color: #ef4444;">Rs. ${totalPending.toLocaleString()}</span>
                </div>
                <div class="stat-pill" style="border-color: rgba(16, 185, 129, 0.3);">
                    <label>Settled Fines</label>
                    <span style="color: #10b981;">Rs. ${totalPaid.toLocaleString()}</span>
                </div>
            </div>
        `;

        applyHistoryFilters(); // Initial Render

    } catch (err) {
        console.error("Dashboard error:", err);
    }
}

function renderFineRows(data) {
    const tbody = document.getElementById('full-fine-history-tbody');
    
    // Sort all matching data by time (newest first)
    data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:80px; opacity:0.6;">No matching records found.</td></tr>`;
        return;
    }
    
    // Use .map and .join to ensure the entire array is converted to HTML
    tbody.innerHTML = data.map(d => {
        const isPaid = d.status === "Paid";
        return `
        <tr>
            <td><span class="tx-id">#FT-${d.id}</span></td>
            <td>
                <div style="font-weight: 600;">${d.applyDate}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted);">${d.applyTime}</div>
            </td>
            <td><div style="font-weight: 600; font-size: 0.9rem;">${d.reason}</div></td>
            <td><b style="font-size: 1.1rem; color: ${isPaid ? 'var(--text-primary)' : '#ef4444'};">Rs. ${d.amount.toLocaleString()}</b></td>
            <td>
                <span class="fee-status-badge ${isPaid ? 'fee-paid' : 'fee-overdue'}">
                    <i class="fas ${isPaid ? 'fa-check-circle' : 'fa-clock'}"></i> ${isPaid ? 'Settled' : 'Pending'}
                </span>
            </td>
            <td>
                ${isPaid ? `
                    <div style="font-weight: 600; color: #10b981;">${d.payDate}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">${d.payTime}</div>
                ` : '<span style="opacity:0.2">—</span>'}
            </td>
            <td class="text-center">
                <button class="btn-settle" ${isPaid ? 'disabled' : ''} onclick="processIndividualPay(${d.id})">
                    ${isPaid ? 'Completed' : 'Pay Now'}
                </button>
            </td>
        </tr>`;
    }).join('');
}

async function processIndividualPay(fineId) {
    if(!confirm("Proceed to settle this specific transaction?")) return;

    try {
        const updated = await apiCall(`/pay-fine/${fineId}`, 'POST');
        
        // 1. Update local cache for the Full Record Page
        const idx = currentDetailedFines.findIndex(f => f.id === fineId);
        if (idx !== -1) currentDetailedFines[idx] = updated;

        // 2. REFRESH MAIN FEE TABLE
        // This is the key: it re-fetches the backend status for the student
        const classTitleEl = document.getElementById('selected-class-title');
        if (classTitleEl && classTitleEl.innerText.includes(':')) {
            const className = classTitleEl.innerText.split(': ')[1];
            renderFees(className); 
        }

        showFeeSuccessToast("Fine Settled Successfully");
        applyHistoryFilters(); // Refresh the current Ledger UI

    } catch (err) {
        alert("Transaction failed: " + err.message);
    }
}

function closeFullFineRecord() {
    document.getElementById('fine-full-record-page').classList.add('d-none');
    document.body.style.overflow = 'auto';
}

function filterFines(timeframe, btn) {
    // 1. UI Switch
    document.querySelectorAll('.sorting-group .category-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // 2. Logic
    const now = new Date();
    let filtered = [];

    if (timeframe === 'all') {
        filtered = currentDetailedFines;
    } else {
        filtered = currentDetailedFines.filter(item => {
            // Convert "12 Jan 2025" back to Date object for logic
            const itemDate = new Date(item.applyDate);
            
            if (timeframe === 'today') {
                return itemDate.toDateString() === now.toDateString();
            }
            if (timeframe === 'week') {
                const diffTime = Math.abs(now - itemDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return diffDays <= 7;
            }
            if (timeframe === '3months') {
                const threeMonthsAgo = new Date();
                threeMonthsAgo.setMonth(now.getMonth() - 3);
                return itemDate >= threeMonthsAgo;
            }
        });
    }
    renderFineRows(filtered);
}

let currentActiveTimeframe = null; // To track buttons

function resetHistoryFilters() {
    document.getElementById('fine-history-search').value = "";
    document.getElementById('fine-history-date-filter').value = "";
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    currentActiveTimeframe = null;
    applyHistoryFilters();
}

function setTimeframeFilter(timeframe, btn) {
    if (currentActiveTimeframe === timeframe) {
        currentActiveTimeframe = null;
        btn.classList.remove('active');
    } else {
        // Fix: Use correct selector .seg-btn
        document.querySelectorAll('.segemented-control .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentActiveTimeframe = timeframe;
    }
    applyHistoryFilters();
}

/**
 * Unified Filter Engine
 */
function applyHistoryFilters() {
    const searchText = document.getElementById('fine-history-search').value.toLowerCase().trim();
    const datePickerValue = document.getElementById('fine-history-date-filter').value; // Returns YYYY-MM-DD
    
    const now = new Date();
    // Start of today (00:00:00)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Use .filter() to find ALL matching items
    const filteredResults = currentDetailedFines.filter(item => {
        const itemDate = new Date(item.createdAt);
        const itemDayOnly = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate());

        // --- 1. Text Search (Reason or Amount) ---
        const matchesText = !searchText || 
            item.reason.toLowerCase().includes(searchText) || 
            item.amount.toString().includes(searchText);

        // --- 2. Date Picker Logic (Matches exact day selected) ---
        let matchesDate = true;
        if (datePickerValue) {
            // datePickerValue is "2026-07-28", we extract components
            const [y, m, d] = datePickerValue.split('-').map(Number);
            matchesDate = (
                itemDate.getFullYear() === y &&
                itemDate.getMonth() === (m - 1) &&
                itemDate.getDate() === d
            );
        }

        // --- 3. Timeframe Buttons Logic ---
        let matchesTimeframe = true;
        if (currentActiveTimeframe) {
            // Calculate day difference
            const diffInMs = todayStart - itemDayOnly;
            const diffInDays = diffInMs / (1000 * 60 * 60 * 24);

            if (currentActiveTimeframe === 'today') {
                matchesTimeframe = (itemDate.toDateString() === now.toDateString());
            } 
            else if (currentActiveTimeframe === 'week') {
                matchesTimeframe = (diffInDays >= 0 && diffInDays < 7);
            } 
            else if (currentActiveTimeframe === 'month') {
                matchesTimeframe = (itemDate.getMonth() === now.getMonth() && itemDate.getFullYear() === now.getFullYear());
            } 
            else if (currentActiveTimeframe === '3months') {
                matchesTimeframe = (diffInDays >= 0 && diffInDays < 90);
            }
        }

        // Must satisfy ALL active filters
        return matchesText && matchesDate && matchesTimeframe;
    });

    renderFineRows(filteredResults);
}

window.openInlineVoucherEditor = openInlineVoucherEditor;
window.closeInlineVoucherEditor = closeInlineVoucherEditor;
window.ievAddRow    = ievAddRow;
window.ievDeleteRow = ievDeleteRow;
window.ievUpdateRow = ievUpdateRow;
window.ievUpdateArrears = ievUpdateArrears;
window.ievSave = ievSave;

/* ============================================================================
   MONTHLY FEE VOUCHER — GENERATION & PRINTING ENGINE
   ----------------------------------------------------------------------------
   This section is intentionally self-contained: it never touches
   computeFeeBreakdown(), buildVoucherHTML(), or any of the existing fine /
   arrears / discount logic above. It only adds a thin "has a voucher been
   generated for this student this month?" tracking layer on top of that
   existing, already-trusted calculation logic, plus the UI to drive it.
   ============================================================================ */

const GENERATED_VOUCHERS_KEY = 'edu_generated_vouchers';

// ---------------------------------------------------------------------------
// Data layer
// ---------------------------------------------------------------------------
function getGeneratedVouchers() {
    try {
        return JSON.parse(localStorage.getItem(GENERATED_VOUCHERS_KEY) || '[]');
    } catch (e) { return []; }
}

function saveGeneratedVouchers(list) {
    localStorage.setItem(GENERATED_VOUCHERS_KEY, JSON.stringify(list));
}

function voucherRecordKey(studentId, monthKey) {
    return `${studentId}::${monthKey}`;
}

/**
 * Looks up an existing voucher-generation record for a student for a given
 * month (defaults to the current month). Returns null if none exists yet —
 * this is the single source of truth the duplicate-generation guard relies on.
 */
function getVoucherRecord(studentId, monthKey = getCurrentMonthKey()) {
    const key = voucherRecordKey(studentId, monthKey);
    return getGeneratedVouchers().find(r => r.key === key) || null;
}

function isVoucherGenerated(studentId, monthKey = getCurrentMonthKey()) {
    return !!getVoucherRecord(studentId, monthKey);
}

/**
 * A student is billable if they're on the active roster. Graduated, dropped,
 * or otherwise inactive (e.g. suspended) students are skipped automatically
 * during generation — this is the "suspended status" edge case from the spec.
 */
function isStudentBillable(s) {
    return !s.status || s.status === 'active';
}

function studentStatusLabel(s) {
    if (!s.status || s.status === 'active') return 'Active';
    return s.status.charAt(0).toUpperCase() + s.status.slice(1);
}

/**
 * Writes a single voucher-generation record. Returns { created:boolean, record }.
 * `created` is false when a record already exists for this student+month —
 * this is the duplicate-generation guard: once a voucher exists for the
 * month, it is never regenerated/overwritten until the month rolls over
 * (monthKey changes), which also naturally covers "blocked until the last
 * date of the month" since the key stays identical for the whole month.
 */
/**
 * BUGFIX — "past arrears not carried into the next month":
 * Previously `arrears` was purely a manually-typed field (via the inline
 * voucher editor). If a student's fee went unpaid and the admin generated
 * next month's voucher, the new voucher only showed that month's fee —
 * the unpaid balance from the earlier month was silently dropped instead
 * of carrying forward.
 *
 * This walks every ALREADY-GENERATED voucher for the student (every month
 * except the one currently being generated), and for each one sums up
 * however much of that month's billed total is still unpaid (billed total
 * minus whatever was actually recorded in student.feePayments for that
 * month). The sum becomes the new month's "Previous Arrears".
 */
function computeOutstandingArrears(student) {
    const studentId = student.regNo || student.id;
    const currentMonthKey = getCurrentMonthKey();
    const payments = student.feePayments || [];

    const priorRecords = getGeneratedVouchers()
        .filter(r => String(r.studentId) === String(studentId) && r.monthKey !== currentMonthKey)
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

    if (priorRecords.length === 0) return 0;

    // BUGFIX — arrears were compounding every month instead of carrying the
    // real outstanding balance. Each voucher's snapshotted `voucherTotal`
    // ALREADY has every earlier month's unpaid arrears rolled into it (see
    // recordVoucherGeneration, which sets student.arrears BEFORE snapshotting).
    // The old code summed (billed - paid) across EVERY historical record,
    // which re-added already-included old debt on top of itself each month
    // it stayed unpaid — e.g. Rs.1000 unpaid in month 1 became Rs.3000 of
    // "arrears" by month 3 instead of staying Rs.2000 (2 months x Rs.1000).
    // Only the most recent prior month's snapshot is needed: it already
    // represents the full running balance up to that point.
    const last = priorRecords[priorRecords.length - 1];
    const billed = Number(last.snapshot && last.snapshot.voucherTotal) || 0;
    const paidForThatMonth = payments
        .filter(p => p.monthKey === last.monthKey)
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    return Math.max(0, billed - paidForThatMonth);
}

/**
 * Persists an updated arrears figure onto the student's saved record, AND
 * expires any one-time custom voucher edits (Add-to-Voucher custom rows,
 * bulk discount) that belonged to the month that just ended.
 *
 * BUGFIX — "discount isn't one-time, it keeps showing on every future
 * voucher": `voucherCustomFees` / `otherFeesData` / `voucherBulkDiscount`
 * live directly on the student profile with no month attached to them, so
 * once an admin customized/discounted one month's voucher, EVERY future
 * month kept reusing those exact same rows forever — a discount meant for
 * March was silently still being charged (or discounted) in April, May,
 * June... This is also the real reason a fully-paid month could still show
 * "arrears" next month, and why totals looked doubled: the next month's
 * bill kept including a leftover custom row from the SAME fee the student
 * had already paid, on top of that same fee being charged again normally.
 * Now, the moment a new month's voucher is generated, last month's custom
 * edits are cleared so the new voucher starts from the plain base
 * tuition/transport/other fields — an admin can still add a fresh discount
 * for the new month specifically, and it will only apply to that month.
 */
function startFreshVoucherMonth(studentId, fullName, arrears) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const matches = s => String(s.regNo || s.id) === String(studentId);
    let idx = students.findIndex(s => matches(s) && s.fullName === fullName);
    if (idx === -1) idx = students.findIndex(matches);
    if (idx === -1) return;
    students[idx].arrears = arrears;
    students[idx].voucherCustomFees = false;
    students[idx].otherFeesData = '[]';
    students[idx].voucherBulkDiscount = 0;
    localStorage.setItem('edu_students', JSON.stringify(students));
}

/**
 * Keeps a generated voucher's snapshot in sync with the LIVE breakdown after
 * the admin edits that month's voucher (discount, custom fees) post-
 * generation. Without this, computeOutstandingArrears() next month compares
 * against the STALE pre-edit total — so if a discount was applied, or fees
 * customized, AFTER "Generate" was clicked, a student could pay their full
 * (correct, discounted) bill and still show leftover "arrears" equal to the
 * gap the snapshot never learned about — exactly the "paid in full but
 * arrears still shows" / "7800 fee shows as 15k" symptoms.
 */
function syncVoucherSnapshotForCurrentMonth(studentId, fullName) {
    const monthKey = getCurrentMonthKey();
    const key = voucherRecordKey(studentId, monthKey);
    const list = getGeneratedVouchers();
    const recIdx = list.findIndex(r => r.key === key);
    if (recIdx === -1) return; // no voucher generated yet this month — nothing to sync

    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = findStudentExact(students, studentId, fullName);
    if (!student) return;

    const f = computeFeeBreakdown(student);
    list[recIdx].snapshot = {
        tuitionFee: f.tuitionFee,
        transportFee: f.transportFee,
        otherFee: f.otherFee,
        arrears: f.arrears,
        fineAmount: (f.fineAmount || 0) + (f.monthlyFineTotal || 0),
        totalDiscounts: f.totalDiscounts,
        voucherTotal: f.voucherTotal,
        totalAfterDueDate: f.totalAfterDueDate,
        dueDateStr: f.dueDateStr,
        expiryDateStr: f.expiryDateStr
    };
    saveGeneratedVouchers(list);
}

function recordVoucherGeneration(student, source = 'individual') {
    const monthKey = getCurrentMonthKey();
    const studentId = student.regNo || student.id;
    const key = voucherRecordKey(studentId, monthKey);

    const list = getGeneratedVouchers();
    const existing = list.find(r => r.key === key);
    if (existing) return { created: false, record: existing };

    // Roll forward any unpaid balance from earlier months into this
    // month's "Previous Arrears" BEFORE snapshotting, and expire any
    // one-time discount/custom-fee edits that belonged to the month that
    // just ended, so the new voucher starts clean (see startFreshVoucherMonth).
    const rolledArrears = computeOutstandingArrears(student);
    student.arrears = rolledArrears;
    student.voucherCustomFees = false;
    student.otherFeesData = '[]';
    student.voucherBulkDiscount = 0;
    startFreshVoucherMonth(studentId, student.fullName, rolledArrears);

    // Snapshot pulls straight from the existing, untouched calculation engine
    // so arrears / fines / discounts are captured exactly as the rest of the
    // app already computes them.
    const f = computeFeeBreakdown(student);

    const record = {
        key,
        studentId,
        studentName: student.fullName,
        studentClass: student.studentClass,
        monthKey,
        generatedAt: new Date().toISOString(),
        source,
        snapshot: {
            tuitionFee: f.tuitionFee,
            transportFee: f.transportFee,
            otherFee: f.otherFee,
            arrears: f.arrears,
            fineAmount: (f.fineAmount || 0) + (f.monthlyFineTotal || 0),
            totalDiscounts: f.totalDiscounts,
            voucherTotal: f.voucherTotal,
            totalAfterDueDate: f.totalAfterDueDate,
            dueDateStr: f.dueDateStr,
            expiryDateStr: f.expiryDateStr
        }
    };

    list.push(record);
    saveGeneratedVouchers(list);
    return { created: true, record };
}

function getAllClassNames() {
    let classes = [];
    try {
        const raw = localStorage.getItem('edu_class_configs');
        if (raw) classes = JSON.parse(raw);
    } catch (e) { classes = []; }
    if (!Array.isArray(classes)) {
        classes = [];
    }
    return classes.map(c => (c.name || '').trim()).filter(Boolean);
}

/**
 * Returns the list of billable students in a class who are still missing a
 * voucher for the current month. Because this is always computed fresh
 * against getVoucherRecord(), calling "Generate" again after a new student
 * is admitted mid-month naturally picks up only that new student — nothing
 * special has to be done for the "late admission" case.
 */
function getPendingStudentsForClass(className) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const monthKey = getCurrentMonthKey();
    return students
        .filter(s => s.studentClass === className)
        .filter(isStudentBillable)
        .filter(s => !isVoucherGenerated(s.regNo || s.id, monthKey));
}

function getPendingStudentsSchoolWide() {
    const monthKey = getCurrentMonthKey();
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    return students
        .filter(isStudentBillable)
        .filter(s => !isVoucherGenerated(s.regNo || s.id, monthKey));
}

/**
 * Class-level status used for the badge shown on each class card:
 * 'done'    -> every billable student in the class has a voucher this month
 * 'partial' -> some, but not all
 * 'none'    -> no billable students have one yet (also used when class is empty)
 */
function getClassVoucherStatus(className) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]')
        .filter(s => s.studentClass === className)
        .filter(isStudentBillable);
    if (students.length === 0) return { state: 'none', total: 0, generated: 0 };
    const monthKey = getCurrentMonthKey();
    const generated = students.filter(s => isVoucherGenerated(s.regNo || s.id, monthKey)).length;
    let state = 'none';
    if (generated === students.length) state = 'done';
    else if (generated > 0) state = 'partial';
    return { state, total: students.length, generated };
}

function _classVoucherBadgeHTML(className) {
    const status = getClassVoucherStatus(className);
    if (status.total === 0) return '';
    const cls = status.state === 'done' ? 'badge-done' : (status.state === 'partial' ? 'badge-partial' : 'badge-none');
    const icon = status.state === 'done' ? 'fa-check' : (status.state === 'partial' ? 'fa-clock' : 'fa-circle');
    const title = status.state === 'done'
        ? `All ${status.total} vouchers generated this month`
        : `${status.generated}/${status.total} vouchers generated this month`;
    return `<span class="class-status-badge ${cls}" title="${escapeForAttr(title)}"><i class="fas ${icon}"></i></span>`;
}

// ---------------------------------------------------------------------------
// Toast feedback
// ---------------------------------------------------------------------------
function showFinanceToast(message, type = 'success') {
    const container = document.getElementById('finance-toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `finance-toast finance-toast-${type}`;
    const icon = type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info');
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

// ---------------------------------------------------------------------------
// Progress modal (background/batched processing feedback)
// ---------------------------------------------------------------------------
function openProgressModal(title) {
    document.getElementById('progress-title').textContent = title;
    document.getElementById('progress-bar-fill').style.width = '0%';
    document.getElementById('progress-status-text').textContent = 'Preparing…';
    document.getElementById('voucher-progress-modal').style.display = 'flex';
}
function updateProgressModal(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 100;
    document.getElementById('progress-bar-fill').style.width = pct + '%';
    document.getElementById('progress-status-text').textContent = `${done} of ${total} students processed…`;
}
function closeProgressModal() {
    document.getElementById('voucher-progress-modal').style.display = 'none';
}

/**
 * Generates vouchers for a list of students in small chunks, yielding back to
 * the browser between chunks so the UI (and the progress bar) never freezes
 * even with hundreds/thousands of students.
 */
function batchGenerateVouchers(students, source, onDone) {
    const total = students.length;
    if (total === 0) { onDone({ created: 0, skipped: 0 }); return; }

    openProgressModal('Generating Vouchers…');
    const CHUNK_SIZE = 25;
    let index = 0;
    let created = 0;
    let skipped = 0;

    function processChunk() {
        const end = Math.min(index + CHUNK_SIZE, total);
        for (; index < end; index++) {
            const s = students[index];
            const result = recordVoucherGeneration(s, source);
            if (result.created) created++; else skipped++;
        }
        updateProgressModal(index, total);

        if (index < total) {
            setTimeout(processChunk, 0); // yield to the event loop
        } else {
            setTimeout(() => {
                closeProgressModal();
                onDone({ created, skipped });
            }, 250);
        }
    }
    processChunk();
}

// ---------------------------------------------------------------------------
// Preview / confirm modal ("You're about to generate X vouchers…")
// ---------------------------------------------------------------------------
let _pendingPreviewAction = null; // { students, source, label }

function showVoucherGenerationPreview(students, source, label) {
    const alreadyGenerated = countAlreadyGeneratedFor(source);
    // computeFeeBreakdown() now computes live outstanding arrears automatically
    // for any student who doesn't yet have a voucher this month (see the
    // arrears-staleness fix above), so this already matches exactly what
    // recordVoucherGeneration() will lock in on confirm.
    const totalRevenue = students.reduce((sum, s) => sum + computeFeeBreakdown(s).voucherTotal, 0);

    document.getElementById('vp-title').textContent = `Generate Monthly Fees — ${label}`;
    document.getElementById('vp-subtitle').textContent = students.length > 0
        ? 'Please review before this is committed.'
        : 'Nothing new to generate right now.';
    document.getElementById('vp-count').textContent = students.length;
    document.getElementById('vp-skip-count').textContent = alreadyGenerated;
    document.getElementById('vp-revenue').textContent = `Rs. ${totalRevenue.toLocaleString()}`;

    const confirmBtn = document.getElementById('vp-confirm-btn');
    const emptyNote = document.getElementById('vp-empty-note');
    if (students.length === 0) {
        confirmBtn.style.display = 'none';
        emptyNote.style.display = 'flex';
    } else {
        confirmBtn.style.display = 'inline-flex';
        emptyNote.style.display = 'none';
    }

    _pendingPreviewAction = { students, source, label };
    document.getElementById('voucher-preview-modal').style.display = 'flex';
}

function countAlreadyGeneratedFor(source) {
    const monthKey = getCurrentMonthKey();
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]').filter(isStudentBillable);
    const scoped = source === 'class' && currentFeeClassName
        ? students.filter(s => s.studentClass === currentFeeClassName)
        : students;
    return scoped.filter(s => isVoucherGenerated(s.regNo || s.id, monthKey)).length;
}

function closeVoucherPreviewModal() {
    document.getElementById('voucher-preview-modal').style.display = 'none';
    _pendingPreviewAction = null;
}

function confirmVoucherPreview() {
    if (!_pendingPreviewAction) { closeVoucherPreviewModal(); return; }
    const { students, source, label } = _pendingPreviewAction;
    closeVoucherPreviewModal();

    batchGenerateVouchers(students, source, ({ created, skipped }) => {
        showFinanceToast(`${label}: ${created} voucher${created === 1 ? '' : 's'} generated${skipped > 0 ? `, ${skipped} already existed` : ''}.`, 'success');
        renderClassCardGrid();
        if (currentFeeClassName) renderFees(currentFeeClassName);
    });
}

// ---------------------------------------------------------------------------
// Entry points wired to the buttons
// ---------------------------------------------------------------------------

/** Global "Generate Monthly Fees" button — scans every class in the school. */
function handleGenerateMonthlyGlobalClick() {
    const pending = getPendingStudentsSchoolWide();
    showVoucherGenerationPreview(pending, 'global', 'Entire School');
}

/** Class-level "Generate Monthly Fee" button. */
function handleGenerateClassClick() {
    if (!currentFeeClassName) return;
    const pending = getPendingStudentsForClass(currentFeeClassName);
    showVoucherGenerationPreview(pending, 'class', currentFeeClassName);
}

/** Per-student "Generate Voucher" button in the student list. */
function handleGenerateSingleVoucher(studentId, fullName) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = findStudentExact(students, studentId, fullName);
    if (!student) { showFinanceToast('Student not found.', 'error'); return; }

    if (!isStudentBillable(student)) {
        showFinanceToast(`Cannot generate a voucher — student is ${studentStatusLabel(student).toLowerCase()}.`, 'error');
        return;
    }

    // Duplicate-generation guard
    if (isVoucherGenerated(student.regNo || student.id)) {
        showFinanceToast('A voucher has already been generated for this student this month.', 'info');
        if (currentFeeClassName) renderFees(currentFeeClassName);
        return;
    }

    const result = recordVoucherGeneration(student, 'individual');
    if (result.created) {
        showFinanceToast(`Voucher generated for ${student.fullName}.`, 'success');
    } else {
        showFinanceToast('A voucher already exists for this student this month.', 'info');
    }
    renderClassCardGrid();
    if (currentFeeClassName) renderFees(currentFeeClassName);
}

window.handleGenerateMonthlyGlobalClick = handleGenerateMonthlyGlobalClick;
window.handleGenerateClassClick = handleGenerateClassClick;
window.handleGenerateSingleVoucher = handleGenerateSingleVoucher;
window.confirmVoucherPreview = confirmVoucherPreview;
window.closeVoucherPreviewModal = closeVoucherPreviewModal;

/* ============================================================================
   PRINT VOUCHERS FLOW
   ============================================================================ */

function openPrintVouchersModal() {
    backToPrintModeSelect();
    document.getElementById('print-vouchers-modal').style.display = 'flex';
}
function closePrintVouchersModal() {
    document.getElementById('print-vouchers-modal').style.display = 'none';
}
function backToPrintModeSelect() {
    document.getElementById('pv-mode-select').style.display = 'block';
    document.getElementById('pv-class-picker').style.display = 'none';
    document.getElementById('pv-student-search').style.display = 'none';
}

function showPrintClassPicker() {
    document.getElementById('pv-mode-select').style.display = 'none';
    document.getElementById('pv-class-picker').style.display = 'block';
    document.getElementById('pv-student-search').style.display = 'none';

    const classes = getAllClassNames();
    const list = document.getElementById('pv-class-list');
    list.innerHTML = classes.map(name => {
        const count = JSON.parse(localStorage.getItem('edu_students') || '[]').filter(s => s.studentClass === name).length;
        return `<button type="button" class="pv-list-item" onclick="printClassVouchers('${escapeForAttr(name)}')">
                    <span>${escapeHtml(name)}</span>
                    <span class="pv-list-item-count">${count} student${count === 1 ? '' : 's'}</span>
                </button>`;
    }).join('') || '<p class="pv-empty">No classes configured yet.</p>';
}

function showPrintStudentSearch() {
    document.getElementById('pv-mode-select').style.display = 'none';
    document.getElementById('pv-class-picker').style.display = 'none';
    document.getElementById('pv-student-search').style.display = 'block';
    document.getElementById('pv-student-search-input').value = '';
    document.getElementById('pv-student-results').innerHTML = '<p class="pv-empty">Start typing to search…</p>';
    setTimeout(() => document.getElementById('pv-student-search-input').focus(), 50);
}

function filterPrintStudentResults() {
    const q = document.getElementById('pv-student-search-input').value.trim().toLowerCase();
    const results = document.getElementById('pv-student-results');
    if (!q) { results.innerHTML = '<p class="pv-empty">Start typing to search…</p>'; return; }

    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const matches = students.filter(s => {
        const name = (s.fullName || '').toLowerCase();
        const id = (s.regNo || s.id || '').toLowerCase();
        return name.includes(q) || id.includes(q);
    }).slice(0, 25);

    results.innerHTML = matches.length ? matches.map(s => `
        <button type="button" class="pv-list-item" onclick="printStudentVoucher('${escapeForAttr(s.regNo || s.id)}', '${escapeForAttr(s.fullName)}')">
            <span>${escapeHtml(s.fullName)} <span class="pv-list-item-sub">(${escapeHtml(s.studentClass || '-')})</span></span>
            <span class="pv-list-item-count">${escapeHtml(s.regNo || s.id)}</span>
        </button>
    `).join('') : '<p class="pv-empty">No matching students.</p>';
}

/** Renders one or more students' vouchers into the hidden print area and triggers print. */
function printStudentsSequentially(students, emptyMessage) {
    if (students.length === 0) {
        showFinanceToast(emptyMessage || 'No students to print.', 'info');
        return;
    }
    const printArea = document.getElementById('voucher-print-area');
    printArea.innerHTML = students.map(s => buildVoucherHTML(s)).join('<div class="print-page-break"></div>');
    closePrintVouchersModal();
    showFinanceToast(`Preparing ${students.length} voucher${students.length === 1 ? '' : 's'} for print…`, 'info');
    setTimeout(() => window.print(), 200);
}

function printAllVouchers() {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]').filter(isStudentBillable);
    // Sequential by class, then by name, for a predictable print order.
    students.sort((a, b) => (a.studentClass || '').localeCompare(b.studentClass || '') || (a.fullName || '').localeCompare(b.fullName || ''));
    printStudentsSequentially(students, 'No active students found to print.');
}

function printClassVouchers(className) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]')
        .filter(s => s.studentClass === className)
        .filter(isStudentBillable);
    printStudentsSequentially(students, `No active students found in ${className}.`);
}

function printStudentVoucher(studentId, fullName) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = findStudentExact(students, studentId, fullName);
    if (!student) { showFinanceToast('Student not found.', 'error'); return; }
    printStudentsSequentially([student]);
}

window.openPrintVouchersModal = openPrintVouchersModal;
window.closePrintVouchersModal = closePrintVouchersModal;
window.backToPrintModeSelect = backToPrintModeSelect;
window.showPrintClassPicker = showPrintClassPicker;
window.showPrintStudentSearch = showPrintStudentSearch;
window.filterPrintStudentResults = filterPrintStudentResults;
window.printAllVouchers = printAllVouchers;
window.printClassVouchers = printClassVouchers;
window.printStudentVoucher = printStudentVoucher;


/* ============================================================
   CUSTOM FEE & FEE DEFAULTER MODULE
   ============================================================ */

/* ── Helpers ─────────────────────────────────────────────── */
function _escHtml(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _escAttr(s) { return typeof escapeForAttr === 'function' ? escapeForAttr(s) : String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }
function _monthKey() { return typeof getCurrentMonthKey === 'function' ? getCurrentMonthKey() : new Date().toISOString().slice(0,7); }
function _isBillable(s) { return typeof isStudentBillable === 'function' ? isStudentBillable(s) : true; }
function _getStudents() { try { return JSON.parse(localStorage.getItem('edu_students') || '[]'); } catch(e) { return []; } }
function _getClasses() {
    let c = [];
    try { c = JSON.parse(localStorage.getItem('edu_class_configs') || '[]'); } catch(e) {}
    if (!c.length) c = [];
    return c;
}

/* ── Toast ───────────────────────────────────────────────── */
function _toast(msg, type) {
    const container = document.getElementById('finance-toast-container');
    if (!container) { alert(msg); return; }
    const el = document.createElement('div');
    el.className = `finance-toast toast-${type || 'success'}`;
    el.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : type === 'info' ? 'info-circle' : 'check-circle'}"></i> ${msg}`;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 350); }, 3000);
}

/* ── Custom Fee Data ─────────────────────────────────────── */
function getCustomFees() { try { return JSON.parse(localStorage.getItem('eduflow-custom-fees') || '[]'); } catch(e) { return []; } }
function saveCustomFees(arr) { localStorage.setItem('eduflow-custom-fees', JSON.stringify(arr)); }

/* ── Custom Fee Generate Page ────────────────────────────── */
let _cfScope = 'all';
let _cfStudentId = '';
let _cfStudentName = '';

function initCustomFeeGeneratePage() {
    const nameEl = document.getElementById('cf-fee-name');
    const amountEl = document.getElementById('cf-fee-amount');
    const descEl = document.getElementById('cf-description');
    const dueDateEl = document.getElementById('cf-due-date');
    if (nameEl) nameEl.value = '';
    if (amountEl) amountEl.value = '';
    if (descEl) descEl.value = '';
    if (dueDateEl) dueDateEl.value = '';
    _cfScope = 'all'; _cfStudentId = ''; _cfStudentName = '';
    setCfScope('all');
    _populateCfClassDropdown('cf-class-select', false);
}

function setCfScope(scope) {
    _cfScope = scope;
    ['all','class','student'].forEach(s => {
        const btn = document.getElementById('cf-scope-' + s);
        if (btn) btn.classList.toggle('active', s === scope);
    });
    const classWrap = document.getElementById('cf-class-wrap');
    const studentWrap = document.getElementById('cf-student-wrap');
    if (classWrap) classWrap.style.display = scope === 'class' ? 'block' : 'none';
    if (studentWrap) studentWrap.style.display = scope === 'student' ? 'block' : 'none';
    if (scope === 'student') { const res = document.getElementById('cf-student-results'); if (res && !res.innerHTML) filterCfStudents(); }
}

function _populateCfClassDropdown(selectId, includeAll) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const classes = _getClasses();
    const allOpt = includeAll ? '<option value="">-- All Classes --</option>' : '<option value="">-- Select Class --</option>';
    const current = sel.value;
    sel.innerHTML = allOpt + classes.map(c => `<option value="${_escHtml(c.name)}"${c.name === current ? ' selected' : ''}>${_escHtml(c.name)}</option>`).join('');
}

function filterCfStudents() {
    const q = ((document.getElementById('cf-student-search') || {}).value || '').trim().toLowerCase();
    const container = document.getElementById('cf-student-results');
    if (!container) return;

    if (!q) {
        container.innerHTML = '<p class="search-empty" style="color:var(--text-muted);font-size:0.8rem;padding:8px;"><i class="fas fa-info-circle"></i> Type student name or ID to search...</p>';
        return;
    }

    const students = _getStudents();
    const matches = students.filter(s => {
        const name = (s.fullName || s.name || '').toLowerCase();
        const id = (s.regNo || s.id || '').toLowerCase();
        const cls = (s.studentClass || '').toLowerCase();
        return name.includes(q) || id.includes(q) || cls.includes(q);
    });

    if (!matches.length) {
        container.innerHTML = '<p class="search-empty">No matching students found.</p>';
        return;
    }

    container.innerHTML = matches.map(s => {
        const id = _escAttr(s.regNo || s.id || '');
        const name = _escAttr(s.fullName || s.name || 'Unnamed');
        const cls = s.studentClass || '-';
        const active = (s.regNo || s.id) === _cfStudentId ? 'selected' : '';
        return `<div class="staff-member-item ${active}" onclick="selectCfStudent('${id}','${name}',this)">
            <div class="staff-member-info">
                <span class="staff-member-name">${_escHtml(s.fullName || s.name || 'Unnamed')}</span>
                <span class="staff-member-role"><b>ID:</b> ${_escHtml(s.regNo || s.id)} &bull; <b>Class:</b> ${_escHtml(cls)}</span>
            </div>
            <div class="staff-member-check"><i class="fas fa-check"></i></div>
        </div>`;
    }).join('');
}

function selectCfStudent(id, name, el) {
    _cfStudentId = id; _cfStudentName = name;
    document.querySelectorAll('#cf-student-results .staff-member-item').forEach(e => e.classList.remove('selected'));
    if (el) el.classList.add('selected');
}

function handleGenerateCustomFee() {
    const feeName = ((document.getElementById('cf-fee-name') || {}).value || '').trim();
    const amount = Number((document.getElementById('cf-fee-amount') || {}).value || 0);
    const description = ((document.getElementById('cf-description') || {}).value || '').trim();
    const dueDate = ((document.getElementById('cf-due-date') || {}).value || '').trim();
    if (!feeName) { _toast('Please enter a fee name.', 'error'); return; }
    if (!amount || amount < 1) { _toast('Please enter a valid amount.', 'error'); return; }

    const allStudents = _getStudents();
    let targetStudents = [], scopeLabel = 'All';

    if (_cfScope === 'all') {
        targetStudents = allStudents.filter(_isBillable);
    } else if (_cfScope === 'class') {
        const cls = (document.getElementById('cf-class-select') || {}).value;
        if (!cls) { _toast('Please select a class.', 'error'); return; }
        targetStudents = allStudents.filter(s => s.studentClass === cls && _isBillable(s));
        scopeLabel = cls;
    } else if (_cfScope === 'student') {
        if (!_cfStudentId) { _toast('Please select a student.', 'error'); return; }
        const student = allStudents.find(s => (s.regNo || s.id) === _cfStudentId);
        if (!student) { _toast('Student not found.', 'error'); return; }
        targetStudents = [student];
        scopeLabel = student.studentClass || 'N/A';
    }

    if (!targetStudents.length) { _toast('No billable students found for the selected scope.', 'error'); return; }

    const record = {
        id: 'cf_' + Date.now(), feeName, amount,
        description: description || '',
        dueDate: dueDate || '',
        monthKey: _monthKey(), generatedAt: new Date().toISOString(),
        scope: _cfScope, className: scopeLabel,
        records: targetStudents.map(s => ({
            studentId: s.regNo || s.id || '',
            studentName: s.fullName || s.name || 'Unnamed',
            studentClass: s.studentClass || '-',
            section: s.section || '-',
            guardianName: s.guardianName || '-',
            paid: false
        }))
    };

    const existing = getCustomFees();
    existing.unshift(record);
    saveCustomFees(existing);
    _toast(`"${feeName}" generated for ${targetStudents.length} student(s)!`, 'success');
    // Navigate back to workspace and auto-open the new record in detail
    setTimeout(() => {
        showPage('page-custom-fee');
        setTimeout(() => showCfDetail(record.id), 150);
    }, 700);
}

/* ── Custom Fee Records Page ─────────────────────────────── */
let _cfrMode = 'class';

function _onShowCustomFeeRecords() {
    _populateCfClassDropdown('cfr-class-select', true);
    _populateCfClassDropdown('cfr-allclass-select', false);
    const cw = document.getElementById('cfr-class-filter-wrap');
    const aw = document.getElementById('cfr-all-class-wrap');
    const sw = document.getElementById('cfr-student-filter-wrap');
    if (_cfrMode === 'class') {
        if (cw) cw.style.display = 'block';
        if (aw) aw.style.display = 'none';
        if (sw) sw.style.display = 'none';
        const btn = document.getElementById('cfr-filter-class');
        if (btn) btn.classList.add('active');
    }
    renderCustomFeeRecords();
}

let _activeCfrFeeId = null;

function renderCustomFeeRecords() {
    if (_activeCfrFeeId) {
        showCustomFeeDetail(_activeCfrFeeId);
    } else {
        showCustomFeeSummaryList();
    }
}

function showCustomFeeSummaryList() {
    _activeCfrFeeId = null;
    const summaryView = document.getElementById('cfr-summary-view');
    const detailView = document.getElementById('cfr-detail-view');
    const pageTitle = document.getElementById('cfr-page-title');
    const pageDesc = document.getElementById('cfr-page-desc');
    const backBtn = document.getElementById('cfr-main-back-btn');

    if (summaryView) summaryView.classList.remove('d-none');
    if (detailView) detailView.classList.add('d-none');
    if (pageTitle) pageTitle.textContent = 'Custom Fee Records';
    if (pageDesc) pageDesc.textContent = 'Browse all generated custom fee vouchers.';
    if (backBtn) backBtn.setAttribute('onclick', "showPage('page-custom-fee')");

    const tbody = document.getElementById('cfr-fees-summary-tbody');
    if (!tbody) return;

    const allFees = getCustomFees();
    if (!allFees.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No custom fees generated yet. Use <strong>Generate Custom Fee</strong> to create one.</td></tr>`;
        return;
    }

    tbody.innerHTML = allFees.map(fee => {
        const records = fee.records || [];
        const paidCount = records.filter(r => r.paid).length;
        const pendingCount = records.length - paidCount;

        return `
        <tr>
            <td><strong style="font-size:0.95rem;">${_escHtml(fee.feeName)}</strong></td>
            <td><strong>Rs. ${Number(fee.amount).toLocaleString()}</strong></td>
            <td><span class="hrk-id-badge">${_escHtml(fee.monthKey)}</span></td>
            <td><b>${records.length}</b> Students</td>
            <td><span style="color:#16a34a; font-weight:700;">${paidCount} Paid</span></td>
            <td><span style="color:#ef4444; font-weight:700;">${pendingCount} Pending</span></td>
            <td class="fee-actions-cell">
                <button class="btn-tiny btn-primary" onclick="showCustomFeeDetail('${fee.id}')"><i class="fas fa-list-ul"></i> View Roster</button>
                <button class="btn-tiny" style="background:rgba(239,68,68,0.12);color:#dc2626;" onclick="deleteCustomFee('${fee.id}')"><i class="fas fa-trash"></i> Delete</button>
            </td>
        </tr>`;
    }).join('');
}

function showCustomFeeDetail(feeId) {
    _activeCfrFeeId = feeId;
    const summaryView = document.getElementById('cfr-summary-view');
    const detailView = document.getElementById('cfr-detail-view');
    const pageTitle = document.getElementById('cfr-page-title');
    const pageDesc = document.getElementById('cfr-page-desc');
    const backBtn = document.getElementById('cfr-main-back-btn');

    if (summaryView) summaryView.classList.add('d-none');
    if (detailView) detailView.classList.remove('d-none');
    if (backBtn) backBtn.setAttribute('onclick', "showCustomFeeSummaryList()");

    const fee = getCustomFees().find(f => f.id === feeId);
    if (!fee) { showCustomFeeSummaryList(); return; }

    if (pageTitle) pageTitle.textContent = fee.feeName;
    if (pageDesc) pageDesc.textContent = `Rs. ${Number(fee.amount).toLocaleString()} per student • Month: ${fee.monthKey}`;

    const records = fee.records || [];
    _populateCfrDetailFilters(records);
    filterCfrDetailTable();
}

function _populateCfrDetailFilters(records) {
    const classSel = document.getElementById('cfr-detail-class-filter');
    const secSel = document.getElementById('cfr-detail-section-filter');
    if (!classSel) return;

    const classes = Array.from(new Set(records.map(r => r.studentClass).filter(Boolean))).sort();
    const sections = Array.from(new Set(records.map(r => r.section).filter(s => s && s !== '-'))).sort();

    let classHtml = '<option value="">All Classes</option>';
    classes.forEach(c => { classHtml += `<option value="${_escAttr(c)}">${_escHtml(c)}</option>`; });
    classSel.innerHTML = classHtml;

    if (secSel) {
        let secHtml = '<option value="">All Sections</option>';
        sections.forEach(s => { secHtml += `<option value="${_escAttr(s)}">Section ${_escHtml(s)}</option>`; });
        secSel.innerHTML = secHtml;
    }
}

function filterCfrDetailTable() {
    const feeId = _activeCfrFeeId;
    if (!feeId) return;

    const fee = getCustomFees().find(f => f.id === feeId);
    if (!fee) return;

    const searchQ = ((document.getElementById('cfr-detail-search-input') || {}).value || '').trim().toLowerCase();
    const classF = (document.getElementById('cfr-detail-class-filter') || {}).value || '';
    const secF = (document.getElementById('cfr-detail-section-filter') || {}).value || '';
    const statusF = (document.getElementById('cfr-detail-status-filter') || {}).value || '';

    let filtered = (fee.records || []).filter(r => {
        if (searchQ) {
            const name = (r.studentName || '').toLowerCase();
            const id = (r.studentId || '').toLowerCase();
            if (!name.includes(searchQ) && !id.includes(searchQ)) return false;
        }
        if (classF && r.studentClass !== classF) return false;
        if (secF && r.section !== secF) return false;
        if (statusF === 'paid' && !r.paid) return false;
        if (statusF === 'pending' && r.paid) return false;
        return true;
    });

    const tbody = document.getElementById('cfr-detail-tbody');
    if (tbody) {
        if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No student records match your filters.</td></tr>`;
        } else {
            tbody.innerHTML = filtered.map(r => `
                <tr>
                    <td><span class="hrk-id-badge">${_escHtml(r.studentId)}</span></td>
                    <td><strong>${_escHtml(r.studentName)}</strong></td>
                    <td>${_escHtml(r.studentClass)}${r.section && r.section !== '-' ? ' – Section ' + _escHtml(r.section) : ''}</td>
                    <td>${_escHtml(r.guardianName || '-')}</td>
                    <td><strong>Rs. ${Number(fee.amount).toLocaleString()}</strong></td>
                    <td><span class="fee-status-badge ${r.paid ? 'fee-paid' : 'fee-overdue'}">${r.paid ? 'Paid' : 'Pending'}</span></td>
                    <td class="fee-actions-cell">
                        <button class="btn-tiny" onclick="viewCustomFeeVoucher('${_escAttr(fee.id)}','${_escAttr(r.studentId)}')"><i class="fas fa-eye"></i> Voucher</button>
                        ${!r.paid ? `<button class="btn-tiny btn-add-fees" onclick="markCustomFeePaid('${_escAttr(fee.id)}','${_escAttr(r.studentId)}')"><i class="fas fa-check"></i> Paid</button>` : ''}
                    </td>
                </tr>
            `).join('');
        }
    }

    // Update Top Summary Bar above table
    const topSummary = document.getElementById('cfr-detail-top-summary');
    if (topSummary) {
        const totalCount = (fee.records || []).filter(r => _isBillable(r)).length || (fee.records || []).length;
        const totalBilled = totalCount * Number(fee.amount);
        const paidCount = (fee.records || []).filter(r => r.paid).length;
        const paidAmount = paidCount * Number(fee.amount);
        const pendingCount = Math.max(0, totalCount - paidCount);
        const pendingAmount = pendingCount * Number(fee.amount);

        topSummary.innerHTML = `
            <span><i class="fas fa-users"></i> Total Students: <b>${totalCount}</b></span>
            <span><i class="fas fa-coins"></i> Total Billed: <b>Rs. ${totalBilled.toLocaleString()}</b></span>
            <span style="color:#16a34a;"><i class="fas fa-check-circle"></i> Collected: <b>Rs. ${paidAmount.toLocaleString()} (${paidCount} Paid)</b></span>
            <span style="color:#ef4444;"><i class="fas fa-exclamation-triangle"></i> Pending: <b>Rs. ${pendingAmount.toLocaleString()} (${pendingCount} Pending)</b></span>
        `;
    }
}

function deleteCustomFee(feeId) {
    if (!confirm('Delete this custom fee record? This cannot be undone.')) return;
    saveCustomFees(getCustomFees().filter(f => f.id !== feeId));
    _activeCfrFeeId = null;
    renderCustomFeeRecords();
    _toast('Custom fee record deleted.', 'success');
}

function markCustomFeePaid(feeId, studentId) {
    const fees = getCustomFees();
    const fee = fees.find(f => f.id === feeId);
    if (!fee) return;
    const rec = fee.records.find(r => r.studentId === studentId);
    if (rec) rec.paid = true;
    saveCustomFees(fees);
    renderCustomFeeRecords();
    _toast('Marked as paid!', 'success');
}

function viewCustomFeeVoucher(feeId, studentId) {
    const fee = getCustomFees().find(f => f.id === feeId);
    if (!fee) return;
    const rec = fee.records.find(r => r.studentId === studentId);
    if (!rec) return;
    const html = _buildCustomFeeVoucherHTML(fee, rec);
    const target = document.getElementById('voucher-render-target');
    const overlay = document.getElementById('voucher-modal-overlay');
    const editBtn = document.getElementById('edit-voucher-btn');
    if (target) target.innerHTML = html;
    if (overlay) overlay.style.display = 'flex';
    if (editBtn) editBtn.style.display = 'none';
}

function _buildCustomFeeVoucherHTML(fee, rec) {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    const challanNo = `CF-${rec.studentId}-${fee.monthKey.replace('-','')}`;
    const paidStamp = rec.paid ? `<div class="paid-stamp-overlay">PAID</div>` : '';

    // Due date row — only show if admin provided one
    const dueDateRow = fee.dueDate
        ? `<div><span>Due Date</span><strong style="color:#dc2626;">${new Date(fee.dueDate).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</strong></div>`
        : '';

    // Description row — only show if admin provided one
    const descriptionRow = fee.description
        ? `<tr><td colspan="2" style="color:var(--text-secondary,#64748b);font-size:0.78rem;padding-top:4px;">${_escHtml(fee.description)}</td><td></td></tr>`
        : '';

    const noteText = fee.description
        ? fee.description
        : 'Please clear dues by the due date to avoid penalties.';

    const copy = label => `
        <div class="voucher-copy">
            <div class="voucher-copy-tag ${label === 'School Copy' ? 'tag-blue' : 'tag-green'}">${label}</div>
            <div class="voucher-header">
                <div class="voucher-school-info">
                    <div class="voucher-logo"><i class="fas fa-graduation-cap"></i></div>
                    <div><h2>ST. LAWRENCE INTERNATIONAL SCHOOL</h2><p>Financial Control Center &middot; Custom Fee Voucher</p></div>
                </div>
            </div>
            <div class="voucher-meta-row" style="grid-template-columns: repeat(${dueDateRow ? 4 : 3}, 1fr);">
                <div><span>Challan No.</span><strong>${_escHtml(challanNo)}</strong></div>
                <div><span>Issue Date</span><strong>${dateStr}</strong></div>
                <div><span>Month</span><strong>${_escHtml(fee.monthKey)}</strong></div>
                ${dueDateRow}
                <div><span>Fee Type</span><strong style="color:#f59e0b;">Custom</strong></div>
            </div>
            <div class="voucher-divider"></div>
            <div class="voucher-student-grid">
                <div><span>Student ID</span><strong>${_escHtml(rec.studentId)}</strong></div>
                <div><span>Student Name</span><strong>${_escHtml(rec.studentName)}</strong></div>
                <div><span>Class</span><strong>${_escHtml(rec.studentClass)}</strong></div>
                <div><span>Guardian</span><strong>${_escHtml(rec.guardianName)}</strong></div>
            </div>
            <table class="voucher-fee-table">
                <thead><tr><th>Description</th><th>Period</th><th>Amount</th></tr></thead>
                <tbody>
                    <tr><td><strong>${_escHtml(fee.feeName)}</strong></td><td>${_escHtml(fee.monthKey)}</td><td>Rs. ${Number(fee.amount).toLocaleString()}</td></tr>
                    ${descriptionRow}
                </tbody>
                <tfoot><tr class="voucher-total-row voucher-total-ontime"><td colspan="2"><i class="fas fa-wallet"></i> NET PAYABLE</td><td>Rs. ${Number(fee.amount).toLocaleString()}</td></tr></tfoot>
            </table>
            <div class="voucher-footer">
                <div class="voucher-note"><i class="fas fa-info-circle"></i> ${_escHtml(noteText)}</div>
                <div class="voucher-signature"><div class="sig-line"></div><span>Principal / Accounts</span></div>
            </div>
        </div>`;
    return `<div class="voucher-sheet" style="position:relative;">${copy('School Copy')}${copy('Student Copy')}${paidStamp}</div>`;
}

function printCustomFeeVouchers(feeId) {
    const fee = getCustomFees().find(f => f.id === feeId);
    if (!fee) return;
    const html = fee.records.map(r => _buildCustomFeeVoucherHTML(fee, r)).join('<div style="page-break-after:always;"></div>');
    const printArea = document.getElementById('voucher-print-area');
    if (printArea) { printArea.innerHTML = html; window.print(); }
}

/* ── Fee Defaulter Page ──────────────────────────────────── */
let _fdMonth = '', _fdSearch = '', _fdAllData = [];

function initFeeDefaulterPage() {
    _fdSearch = '';
    const searchEl = document.getElementById('fd-search');
    if (searchEl) searchEl.value = '';
    _populateFdMonthDropdown();
    _fdMonth = _monthKey();
    const monthSel = document.getElementById('fd-month-filter');
    if (monthSel) monthSel.value = _fdMonth;
    loadFeeDefaulters();
}

function _populateFdMonthDropdown() {
    const sel = document.getElementById('fd-month-filter');
    if (!sel) return;
    const now = new Date();
    const opts = [];
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const lbl = d.toLocaleDateString('en-US', { month:'long', year:'numeric' });
        opts.push(`<option value="${key}">${lbl}</option>`);
    }
    sel.innerHTML = opts.join('');
}

async function loadFeeDefaulters() {
    const tbody = document.getElementById('fd-tbody');
    const countEl = document.getElementById('fd-count');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row"><i class="fas fa-spinner fa-spin"></i> Loading fee defaulters…</td></tr>`;
    if (countEl) countEl.textContent = '';

    const students = _getStudents();
    const monthKey = _fdMonth || _monthKey();

    if (!students.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No students found. Add students from Admissions first.</td></tr>`;
        return;
    }

    const defaulters = [];
    for (const s of students) {
        if (!_isBillable(s)) continue;
        let finance = null;
        try { if (typeof getFeeRowFinance === 'function') finance = await getFeeRowFinance(s, monthKey); } catch(e) {}
        if (!finance) {
            let feeTotal = 0;
            try { feeTotal = computeFeeBreakdown(s).voucherTotal; } catch(e) { feeTotal = Number(s.standardFee || 0); }
            const payments = (s.feePayments || []).filter(p => p.monthKey === monthKey);
            const paidAmount = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const remaining = Math.max(0, feeTotal - paidAmount);
            finance = { remainingBalance: remaining, paidAmount, paymentStatus: remaining <= 0 ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Pending'), studentName: s.fullName || s.name, guardianName: s.guardianName };
        }
        if (finance.remainingBalance > 0 && finance.paymentStatus !== 'Paid') {
            const pendingMonths = _computePendingMonths(s);
            defaulters.push({
                studentId: s.regNo || s.id || '',
                studentName: finance.studentName || s.fullName || 'Unnamed',
                studentClass: s.studentClass || '-', section: s.section || '',
                guardianName: finance.guardianName || s.guardianName || '-',
                remainingBalance: finance.remainingBalance, paymentStatus: finance.paymentStatus,
                paidAmount: Number(finance.paidAmount) || 0,
                pendingMonthsList: pendingMonths, pendingMonthsCount: pendingMonths.length
            });
        }
    }
    defaulters.sort((a, b) => b.remainingBalance - a.remainingBalance);
    _fdAllData = defaulters;
    _renderDefaultersTable(defaulters);
}

function _computePendingMonths(student) {
    const now = new Date(), pending = [];
    for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const lbl = d.toLocaleDateString('en-US', { month:'short', year:'numeric' });
        const payments = (student.feePayments || []).filter(p => p.monthKey === key);
        const paidAmount = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        let feeTotal = 0;
        try { feeTotal = computeFeeBreakdown(student).voucherTotal; } catch(e) { feeTotal = Number(student.standardFee || 0); }
        if (Math.max(0, feeTotal - paidAmount) > 0) pending.push(lbl);
    }
    return pending;
}

/**
 * Paints the overview stat row at the top of the Fee Defaulters page.
 * Runs on whatever list is currently being shown (all defaulters, or a
 * filtered/searched subset), so the totals always match what's on screen.
 *
 * Shows three totals:
 *   - Pending After 1 Month: sum owed by defaulters who have been pending
 *     for more than one month (aging beyond the current month).
 *   - Total Collected: how much has already been paid in by these
 *     defaulters (partial payments) for the selected month.
 *   - Total Remaining: the full outstanding balance still owed.
 */
function updateFdOverviewStats(defaulters) {
    const afterEl = document.getElementById('fd-overview-after1month');
    const colEl = document.getElementById('fd-overview-collected');
    const penEl = document.getElementById('fd-overview-pending');
    if (!afterEl || !colEl || !penEl) return;

    const list = Array.isArray(defaulters) ? defaulters : [];
    const totalRemaining = list.reduce((sum, d) => sum + (Number(d.remainingBalance) || 0), 0);
    const totalCollected = list.reduce((sum, d) => sum + (Number(d.paidAmount) || 0), 0);

    afterEl.textContent = `Rs. ${totalRemaining.toLocaleString()}`;
    colEl.textContent = `Rs. ${totalCollected.toLocaleString()}`;
    penEl.textContent = `Rs. ${totalRemaining.toLocaleString()}`;
}

function _renderDefaultersTable(defaulters) {
    updateFdOverviewStats(defaulters);

    const tbody = document.getElementById('fd-tbody');
    const countEl = document.getElementById('fd-count');
    if (!tbody) return;
    if (countEl) countEl.textContent = `${defaulters.length} defaulter${defaulters.length !== 1 ? 's' : ''} found`;
    if (!defaulters.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row"><i class="fas fa-check-circle" style="color:#16a34a;"></i>&nbsp; No fee defaulters found for this period. All caught up!</td></tr>`;
        return;
    }
    tbody.innerHTML = defaulters.map(d => {
        const cls = d.studentClass + (d.section ? ' – ' + d.section : '');
        const monthsTitle = d.pendingMonthsList.join(', ') || 'Current month';
        const monthsHtml = d.pendingMonthsCount > 0
            ? `<div class="fd-months-badge" title="${_escHtml(monthsTitle)}"><i class="fas fa-calendar-times" style="color:#dc2626;"></i> <strong>${d.pendingMonthsCount}</strong> month${d.pendingMonthsCount !== 1 ? 's' : ''}<span class="fd-months-list">${d.pendingMonthsList.slice(0,3).map(_escHtml).join(', ')}${d.pendingMonthsCount > 3 ? '…' : ''}</span></div>`
            : `<span style="color:var(--text-secondary);">—</span>`;
        return `<tr>
            <td><span class="hrk-id-badge">${_escHtml(d.studentId)}</span></td>
            <td><strong>${_escHtml(d.studentName)}</strong></td>
            <td><span class="class-chip" style="background:rgba(139,92,246,0.1);color:#8b5cf6;">${_escHtml(cls)}</span></td>
            <td>${_escHtml(d.guardianName)}</td>
            <td><strong style="color:#dc2626;font-size:1.05rem;">Rs. ${d.remainingBalance.toLocaleString()}</strong></td>
            <td>${monthsHtml}</td>
            <td><span class="fee-status-badge ${d.paymentStatus === 'Partial' ? 'fee-pending' : 'fee-overdue'}">${_escHtml(d.paymentStatus)}</span></td>
        </tr>`;
    }).join('');
}

function filterFdTable() {
    _fdSearch = ((document.getElementById('fd-search') || {}).value || '').trim().toLowerCase();
    const filtered = _fdSearch
        ? _fdAllData.filter(d => (d.studentName || '').toLowerCase().includes(_fdSearch) || (d.studentId || '').toLowerCase().includes(_fdSearch) || (d.studentClass || '').toLowerCase().includes(_fdSearch) || (d.guardianName || '').toLowerCase().includes(_fdSearch))
        : _fdAllData;
    _renderDefaultersTable(filtered);
}

function onFdMonthChange() {
    _fdMonth = (document.getElementById('fd-month-filter') || {}).value || _monthKey();
    loadFeeDefaulters();
}

/* ============================================================
   CUSTOM FEE WORKSPACE — Split-panel layout functions
   ============================================================ */

let _cfCurrentFeeId = null;

/**
 * Called whenever page-custom-fee is shown.
 * Populates the class filter dropdown and renders the records list.
 */
function initCfWorkspace() {
    // Populate class filter in left panel
    const filterSel = document.getElementById('cf-panel-filter');
    if (filterSel) {
        const classes = _getClasses();
        filterSel.innerHTML = '<option value="">All Classes</option>' +
            classes.map(c => `<option value="${_escHtml(c.name)}">${_escHtml(c.name)}</option>`).join('');
    }
    // Render records list (left panel)
    renderCfRecordsList();
    // Show create form (right panel default)
    showCfCreateForm();
    // Init the create form fields
    initCustomFeeGeneratePage();
}

/**
 * Renders the list of fee name cards in the left panel,
 * filtered by class dropdown and search input.
 */
/**
 * Paints the overview stat row at the top of the Custom Fee page — totals
 * across EVERY custom fee record (not month-scoped, since custom fees are
 * one-off charges that can be generated any time). Called whenever the
 * records list re-renders, so it stays in sync with new fees, deletions,
 * and payments recorded from the detail view.
 */
function updateCfOverviewStats() {
    const genEl = document.getElementById('cf-overview-generated');
    const colEl = document.getElementById('cf-overview-collected');
    const penEl = document.getElementById('cf-overview-pending');
    if (!genEl || !colEl || !penEl) return;

    const allFees = getCustomFees();
    let totalGenerated = 0, totalCollected = 0;
    allFees.forEach(fee => {
        const records = fee.records || [];
        const amount = Number(fee.amount) || 0;
        const paidCount = records.filter(r => r.paid).length;
        totalGenerated += records.length * amount;
        totalCollected += paidCount * amount;
    });
    const totalPending = Math.max(0, totalGenerated - totalCollected);

    genEl.textContent = `Rs. ${totalGenerated.toLocaleString()}`;
    colEl.textContent = `Rs. ${totalCollected.toLocaleString()}`;
    penEl.textContent = `Rs. ${totalPending.toLocaleString()}`;
}

function renderCfRecordsList() {
    updateCfOverviewStats();

    const container = document.getElementById('cf-records-list');
    if (!container) return;

    const allFees = getCustomFees();
    const classFilter = ((document.getElementById('cf-panel-filter') || {}).value || '').trim();
    const searchQ = ((document.getElementById('cf-panel-search-input') || {}).value || '').trim().toLowerCase();

    let filtered = allFees;

    if (classFilter) {
        filtered = filtered.filter(fee =>
            (fee.records || []).some(r => r.studentClass === classFilter)
        );
    }
    if (searchQ) {
        filtered = filtered.filter(fee =>
            (fee.feeName || '').toLowerCase().includes(searchQ)
        );
    }

    if (!filtered.length) {
        container.innerHTML = `<div class="cf-records-empty">
            <i class="fas fa-inbox"></i>
            <p>${allFees.length ? 'No records match the filter' : 'No custom fees yet'}</p>
        </div>`;
        return;
    }

    container.innerHTML = filtered.map(fee => {
        const paidCount = (fee.records || []).filter(r => r.paid).length;
        const total = (fee.records || []).length;
        const pending = total - paidCount;
        const genDate = fee.generatedAt
            ? new Date(fee.generatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
            : '—';
        const isActive = fee.id === _cfCurrentFeeId;
        return `<div class="cf-record-item${isActive ? ' active' : ''}" onclick="showCfDetail('${_escAttr(fee.id)}')">
            <div class="cf-record-name"><i class="fas fa-tag"></i> ${_escHtml(fee.feeName)}</div>
            <div class="cf-record-meta">Rs. ${Number(fee.amount).toLocaleString()} &bull; ${_escHtml(genDate)}</div>
            <div class="cf-record-badges">
                <span class="cf-badge cf-badge-paid"><i class="fas fa-check"></i> ${paidCount} paid</span>
                <span class="cf-badge cf-badge-pending">${pending} pending</span>
            </div>
        </div>`;
    }).join('');
}

/**
 * Shows the detail view for a specific fee record.
 */
function showCfDetail(feeId) {
    _cfCurrentFeeId = feeId;
    const fee = getCustomFees().find(f => f.id === feeId);
    if (!fee) return;

    // Re-render list to highlight active item
    renderCfRecordsList();

    // Switch right panel to detail view
    const createView = document.getElementById('cf-create-form-view');
    const detailView = document.getElementById('cf-detail-view');
    if (createView) createView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';

    // Header
    const nameEl = document.getElementById('cf-detail-name');
    const metaEl = document.getElementById('cf-detail-meta');
    if (nameEl) nameEl.textContent = fee.feeName;
    if (metaEl) {
        const genDate = fee.generatedAt
            ? new Date(fee.generatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
            : '—';
        const duePart = fee.dueDate
            ? ` · Due: ${new Date(fee.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
            : '';
        metaEl.textContent = `Generated: ${genDate} · Month: ${fee.monthKey} · Rs. ${Number(fee.amount).toLocaleString()} / student${duePart}`;
    }

    // Wire buttons
    const printBtn = document.getElementById('cf-detail-print-btn');
    const deleteBtn = document.getElementById('cf-detail-delete-btn');
    if (printBtn) printBtn.onclick = () => printCustomFeeVouchers(feeId);
    if (deleteBtn) deleteBtn.onclick = () => deleteCustomFeeFromWorkspace(feeId);

    // Reset search/filter fields in detail view
    const searchEl = document.getElementById('cf-detail-search');
    const statusEl = document.getElementById('cf-detail-status-filter');
    if (searchEl) searchEl.value = '';
    if (statusEl) statusEl.value = '';

    // Render stats + table
    _renderCfDetailFull(fee);
}

/**
 * Renders the stats bar and student table inside the detail view.
 * Applies search and status filters.
 */
function _renderCfDetailFull(fee) {
    const records = fee.records || [];
    const searchQ = ((document.getElementById('cf-detail-search') || {}).value || '').trim().toLowerCase();
    const statusFilter = ((document.getElementById('cf-detail-status-filter') || {}).value || '').trim();

    // Stats (computed on all records, not filtered)
    const paidCount = records.filter(r => r.paid).length;
    const totalStudents = records.length;
    const totalCollect = totalStudents * Number(fee.amount);
    const collected = paidCount * Number(fee.amount);
    const remaining = totalCollect - collected;

    const totalEl = document.getElementById('cf-stat-total');
    const collectedEl = document.getElementById('cf-stat-collected');
    const remainingEl = document.getElementById('cf-stat-remaining');
    if (totalEl) totalEl.textContent = `Rs. ${totalCollect.toLocaleString()}`;
    if (collectedEl) collectedEl.textContent = `Rs. ${collected.toLocaleString()}`;
    if (remainingEl) remainingEl.textContent = `Rs. ${remaining.toLocaleString()}`;

    // Apply filters to table records
    let filtered = records;
    if (searchQ) {
        filtered = filtered.filter(r =>
            (r.studentName || '').toLowerCase().includes(searchQ) ||
            (r.studentId || '').toLowerCase().includes(searchQ)
        );
    }
    if (statusFilter === 'paid') filtered = filtered.filter(r => r.paid);
    if (statusFilter === 'pending') filtered = filtered.filter(r => !r.paid);

    const tbody = document.getElementById('cf-detail-tbody');
    if (!tbody) return;

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No records match your filter.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(r => `
        <tr>
            <td><span class="hrk-id-badge">${_escHtml(r.studentId)}</span></td>
            <td><strong>${_escHtml(r.studentName)}</strong></td>
            <td>${_escHtml(r.studentClass)}${r.section && r.section !== '-' ? ' – ' + _escHtml(r.section) : ''}</td>
            <td>${_escHtml(r.guardianName || '-')}</td>
            <td><strong>Rs. ${Number(fee.amount).toLocaleString()}</strong></td>
            <td><span class="fee-status-badge ${r.paid ? 'fee-paid' : 'fee-overdue'}">${r.paid ? 'Paid' : 'Pending'}</span></td>
            <td class="fee-actions-cell">
                <button class="btn-tiny" onclick="viewCustomFeeVoucher('${_escAttr(fee.id)}','${_escAttr(r.studentId)}')">
                    <i class="fas fa-eye"></i> Voucher
                </button>
                ${!r.paid ? `<button class="btn-tiny btn-add-fees" onclick="markCustomFeePaidWs('${_escAttr(fee.id)}','${_escAttr(r.studentId)}')">
                    <i class="fas fa-check"></i> Paid
                </button>` : ''}
            </td>
        </tr>`).join('');
}

/** Called when search/status filter changes inside the detail view. */
function filterCfDetailTable() {
    const fee = getCustomFees().find(f => f.id === _cfCurrentFeeId);
    if (fee) _renderCfDetailFull(fee);
}

/** Switches the right panel back to the create form. */
function showCfCreateForm() {
    _cfCurrentFeeId = null;
    const createView = document.getElementById('cf-create-form-view');
    const detailView = document.getElementById('cf-detail-view');
    if (createView) createView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
    renderCfRecordsList(); // Remove active highlight
}

/**
 * Mark a custom fee record as paid (workspace version — refreshes detail view after).
 */
function markCustomFeePaidWs(feeId, studentId) {
    markCustomFeePaid(feeId, studentId);
    const fee = getCustomFees().find(f => f.id === feeId);
    if (fee) _renderCfDetailFull(fee);
    renderCfRecordsList();
}

/**
 * Delete a custom fee record from the workspace panel (with confirmation).
 */
function deleteCustomFeeFromWorkspace(feeId) {
    if (!confirm('Delete this custom fee record? This cannot be undone.')) return;
    saveCustomFees(getCustomFees().filter(f => f.id !== feeId));
    _toast('Custom fee record deleted.', 'success');
    showCfCreateForm();
    renderCfRecordsList();
}

/* ============================================================
   SALARY PAGE — BONUS PANEL
   Bonus state per salary page (keyed by 'teaching' / 'non-teaching')
   ============================================================ */

const _salaryBonusSelected = { teaching: null, 'non-teaching': null };

/**
 * Toggle the collapsible bonus panel on a salary page.
 * panelId: 'teaching' | 'non-teaching'
 */
function toggleSalaryBonusPanel(panelId) {
    const panel = document.getElementById('salary-bonus-panel-' + panelId);
    if (!panel) return;
    const isHidden = panel.classList.contains('d-none');
    panel.classList.toggle('d-none', !isHidden);
    if (isHidden) {
        // Panel just opened — populate the staff list
        filterSalaryBonusList(panelId);
    }
}

/**
 * Filter/render staff list inside a salary page bonus panel.
 * panelId: 'teaching' | 'non-teaching'
 */
function filterSalaryBonusList(panelId) {
    const searchEl = document.getElementById('bonus-search-' + panelId);
    const query = searchEl ? searchEl.value : '';
    const category = panelId === 'teaching' ? 'Teaching' : 'Non-Teaching';
    const container = document.getElementById('bonus-members-list-' + panelId);
    if (!container) return;

    const db = getGlobalData();
    let members = (db.staff && db.staff[category]) ? db.staff[category] : [];
    if (query.trim()) {
        members = members.filter(s => staffMatchesQuery(s, query));
    }

    if (members.length === 0) {
        container.innerHTML = '<p class="search-empty">No staff found.</p>';
        return;
    }
    const selectedId = _salaryBonusSelected[panelId];
    container.innerHTML = members.map(s => {
        const active = (String(s.id) === String(selectedId)) ? 'selected' : '';
        return `
        <div class="staff-member-item ${active}" id="sbp-bonus-item-${panelId}-${s.id}"
             onclick="_selectSalaryBonusStaff('${panelId}','${s.id}')">
            <div class="staff-member-info">
                <span class="staff-member-name">${s.name}</span>
                <span class="staff-member-role">${staffSubLine(s, category)}</span>
            </div>
            <div class="staff-member-check"><i class="fas fa-check"></i></div>
        </div>`;
    }).join('');
}

function _selectSalaryBonusStaff(panelId, id) {
    const container = document.getElementById('bonus-members-list-' + panelId);
    if (container) {
        container.querySelectorAll('.staff-member-item').forEach(el => el.classList.remove('selected'));
        const item = container.querySelector('#sbp-bonus-item-' + panelId + '-' + id);
        if (item) item.classList.add('selected');
    }
    _salaryBonusSelected[panelId] = id;
}

/**
 * Reset the salary page bonus form.
 */
function resetSalaryBonusForm(panelId) {
    _salaryBonusSelected[panelId] = null;
    const amtEl  = document.getElementById('bonus-amount-' + panelId);
    const descEl = document.getElementById('bonus-desc-' + panelId);
    const srchEl = document.getElementById('bonus-search-' + panelId);
    if (amtEl)  amtEl.value  = '';
    if (descEl) descEl.value = '';
    if (srchEl) srchEl.value = '';
    filterSalaryBonusList(panelId);
}

/**
 * Submit bonus from salary page.
 * category: 'Teaching' | 'Non-Teaching'
 */
function handleSalaryPageBonus(category) {
    const panelId = category === 'Teaching' ? 'teaching' : 'non-teaching';
    const selectedId = _salaryBonusSelected[panelId];
    if (!selectedId) { alert('Please select a staff member.'); return; }

    const amount = Number((document.getElementById('bonus-amount-' + panelId) || {}).value);
    const desc   = ((document.getElementById('bonus-desc-' + panelId) || {}).value || '').trim();
    if (!amount || amount < 1) { alert('Please enter a valid bonus amount.'); return; }
    if (!desc) { alert('Please enter a bonus description.'); return; }

    const db = getGlobalData();
    const members = (db.staff && db.staff[category]) ? db.staff[category] : [];
    const member  = members.find(s => String(s.id) === String(selectedId));
    if (!member) { alert('Staff member not found.'); return; }

    const role = category === 'Teaching'
        ? (member.subjects || 'Teacher')
        : (member.job || 'Staff');

    const log = getStaffBonusData();
    log.push({
        staffId: member.id, id: member.id, name: member.name, role: role,
        category: category, amount: amount, description: desc,
        date: new Date().toLocaleDateString('en-US'),
        monthKey: getCurrentMonthKey()
    });
    saveStaffBonusData(log);

    alert('Bonus of RS ' + amount.toLocaleString() + ' added to ' + member.name + '.');
    resetSalaryBonusForm(panelId);
}

/**
 * Navigate to the bonus records page pre-filtered to a category.
 * category: 'Teaching' | 'Non-Teaching'
 */
let _bonusRecordsOrigin = 'page-salary-hub';

// Tracks which salary page the user came from when opening a bonus page
let _bonusSalaryOrigin = 'page-salary-teaching';

function goBackFromBonusRecords() {
    showPage(_bonusRecordsOrigin);
}

/**
 * Navigate back from the bonus form page to the salary page the user came from.
 */
function goBackToSalaryFromBonus() {
    showPage(_bonusSalaryOrigin);
}

/**
 * Initialize a bonus page when navigated to.
 * panelId: 'teaching' | 'non-teaching'
 */
function initBonusPage(panelId) {
    // Track which salary page to return to when the user hits Back
    _bonusSalaryOrigin = panelId === 'teaching' ? 'page-salary-teaching' : 'page-salary-non-teaching';
    resetSalaryBonusForm(panelId);
    filterSalaryBonusList(panelId);
}

/**
 * Navigate to bonus records filtered to a specific category,
 * called from the bonus page's "View Records" button.
 * category: 'Teaching' | 'Non-Teaching'
 */
function openBonusRecordsForCategory(category) {
    _bonusContext = category;
    _bonusRecordsOrigin = category === 'Teaching' ? 'page-bonus-teaching' : 'page-bonus-non-teaching';
    showPage('page-view-staff-bonus');
}

/**
 * Navigate to bonus records from the salary page "Bonus Records" button.
 * category: 'Teaching' | 'Non-Teaching'
 */
function showSalaryBonusRecords(category) {
    _bonusContext = category;
    _bonusRecordsOrigin = category === 'Teaching' ? 'page-salary-teaching' : 'page-salary-non-teaching';
    showPage('page-view-staff-bonus');
}

/* ============================================
   SALARY RECORDS PAGE
   ============================================ */
let _salaryRecordsOrigin = 'page-salary-teaching';
let _salaryRecordsTab = 'Teaching';

/**
 * Navigate to salary records from the salary page "Salary Records" button.
 * category: 'Teaching' | 'Non-Teaching'
 */
function showSalaryRecords(category) {
    _salaryRecordsTab = category || 'Teaching';
    _salaryRecordsOrigin = category === 'Teaching' ? 'page-salary-teaching' : 'page-salary-non-teaching';

    // Update the back button destination
    const backBtn = document.getElementById('salary-records-back-btn');
    if (backBtn) backBtn.setAttribute('onclick', `showPage('${_salaryRecordsOrigin}')`);

    showPage('page-salary-records');
}

function initSalaryRecordsPage() {
    // Populate the month filter select with available months
    _populateSalaryRecordsMonthFilter();
    // Clear search input
    const searchInput = document.getElementById('sr-search-input');
    if (searchInput) searchInput.value = '';
    // Reset status filter
    const statusFilter = document.getElementById('sr-status-filter');
    if (statusFilter) statusFilter.value = '';
    // Set the correct tab/category active
    setSalaryRecordsTab(_salaryRecordsTab || 'Teaching');
    // Update back button
    const backBtn = document.getElementById('salary-records-back-btn');
    if (backBtn) backBtn.setAttribute('onclick', `showPage('${_salaryRecordsOrigin}')`);
}

function _populateSalaryRecordsMonthFilter() {
    const sel = document.getElementById('sr-month-select');
    if (!sel) return;

    const currentMk = getCurrentMonthKey();
    const [cy, cm] = currentMk.split('-').map(Number);

    // Always list the trailing 12 months (current month + previous 11),
    // so the filter covers a full year even for months with no processed
    // records yet.
    const months = [];
    for (let i = 0; i < 12; i++) {
        const d = new Date(cy, (cm - 1) - i, 1);
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.push(mk);
    }

    sel.innerHTML = months.map(mk => {
        const [y, m] = mk.split('-');
        const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        return `<option value="${mk}">${label}</option>`;
    }).join('');

    // Default to current month
    sel.value = currentMk;
}

function setSalaryRecordsTab(category) {
    _salaryRecordsTab = category;
    // Update the category badge label
    const labelEl = document.getElementById('sr-category-label-text');
    const badgeEl = document.getElementById('sr-category-badge');
    const isTeaching = category === 'Teaching';
    if (labelEl) labelEl.textContent = isTeaching ? 'Teaching Staff' : 'Non-Teaching Staff';
    if (badgeEl) {
        const icon = badgeEl.querySelector('i');
        if (icon) icon.className = isTeaching ? 'fas fa-chalkboard-teacher' : 'fas fa-hard-hat';
    }
    renderSalaryRecordsTable();
}

function onSalaryRecordsMonthChange() {
    filterSalaryRecordsTable();
}

function filterSalaryRecordsTable() {
    renderSalaryRecordsTable();
}

function renderSalaryRecordsTable() {
    const tbody = document.getElementById('salary-records-tbody');
    if (!tbody) return;

    const category = _salaryRecordsTab || 'Teaching';
    const sel = document.getElementById('sr-month-select');
    const monthKey = sel ? sel.value : getCurrentMonthKey();

    const searchInput = document.getElementById('sr-search-input');
    const q = ((searchInput && searchInput.value) || '').trim().toLowerCase();

    const statusFilter = document.getElementById('sr-status-filter');
    const statusVal = (statusFilter && statusFilter.value) || '';

    const db = getGlobalData();
    const staff = db.staff[category] || [];

    // Filter to staff who have a history entry for the selected month
    let rows = [];
    staff.forEach(s => {
        const entry = (s.salaryHistory || []).find(h => h.monthKey === monthKey);
        rows.push({ staff: s, entry: entry || null });
    });

    // Apply search filter
    if (q) {
        rows = rows.filter(({ staff: s }) =>
            (s.name || '').toLowerCase().includes(q) ||
            String(s.id || '').toLowerCase().includes(q) ||
            (s.subjects || s.job || s.role || '').toLowerCase().includes(q)
        );
    }

    // Apply status filter
    if (statusVal) {
        rows = rows.filter(({ entry }) =>
            statusVal === 'paid' ? !!entry : !entry
        );
    }

    if (rows.length === 0) {
        const emptyMsg = q || statusVal
            ? 'No records match your search / filter.'
            : `No ${category.toLowerCase()} staff found.`;
        tbody.innerHTML = `<tr><td colspan="8" class="empty-row">${emptyMsg}</td></tr>`;
        return;
    }

    const [y, m] = monthKey.split('-');
    const monthLabel = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    tbody.innerHTML = rows.map(({ staff: s, entry }) => {
        const role = category === 'Teaching' ? (s.subjects || s.role || 'Teacher') : (s.job || 'Staff');
        const baseSalary = Number(s.salary) || 0;
        const finesDeducted = entry ? (Number(entry.absenceFineDeducted) || 0) : 0;
        const secDeducted   = entry ? (Number(entry.securityDeducted) || 0) : 0;
        const isPaid = !!entry;
        const statusBadge = isPaid
            ? `<span class="status-badge status-paid"><i class="fas fa-check-circle"></i> Paid</span>`
            : `<span class="status-badge status-pending"><i class="fas fa-clock"></i> Pending</span>`;
        const finesCell = finesDeducted > 0
            ? `<span style="color:#ef4444;font-weight:600;">− RS ${finesDeducted.toLocaleString()}</span>`
            : `<span style="color:var(--text-secondary);font-size:12px;">None</span>`;
        const secCell = secDeducted > 0
            ? `RS ${secDeducted.toLocaleString()}`
            : `<span style="color:var(--text-secondary);font-size:12px;">—</span>`;
        return `
            <tr>
                <td><span class="hrk-id-badge">${escapeHtml(s.id)}</span></td>
                <td><strong>${escapeHtml(s.name)}</strong></td>
                <td>${escapeHtml(role)}</td>
                <td><strong>RS ${baseSalary.toLocaleString()}</strong></td>
                <td>${finesCell}</td>
                <td>${secCell}</td>
                <td><span class="salary-month-chip">${monthLabel}</span></td>
                <td>${statusBadge}</td>
            </tr>`;
    }).join('');
}

/* ============================================
   EXPENSE HUB — inline form handlers
   ============================================ */
function initExpenseHub() {
    // Hub is now self-contained; just ensure form is clear on each visit
    const amtEl = document.getElementById('hub-exp-amount');
    const descEl = document.getElementById('hub-exp-desc');
    if (amtEl) amtEl.value = '';
    if (descEl) descEl.value = '';
}

function clearExpenseHubForm() {
    const amtEl = document.getElementById('hub-exp-amount');
    const descEl = document.getElementById('hub-exp-desc');
    if (amtEl) amtEl.value = '';
    if (descEl) descEl.value = '';
}

function handleExpenseSubmitHub() {
    const amount = Number(document.getElementById('hub-exp-amount').value);
    const desc = document.getElementById('hub-exp-desc').value.trim();
    if (!amount || amount < 1) { alert('Please enter a valid expense amount.'); return; }
    if (!desc) { alert('Please enter an expense description.'); return; }

    const list = getExpensesData();
    const now = new Date();
    list.push({
        description: desc,
        amount: amount,
        date: now.toLocaleDateString('en-US'),
        time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        monthKey: getCurrentMonthKey()
    });
    saveExpensesData(list);

    const db = getGlobalData();
    db.finances.expenses.other += amount;
    saveGlobalData(db);

    // Show success toast and clear the form — user stays on hub
    showFeeSuccessToast(`Expense of RS ${amount.toLocaleString()} logged successfully.`);
    clearExpenseHubForm();
}
