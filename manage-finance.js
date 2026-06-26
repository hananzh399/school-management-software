/**
 * EDUFLOW PRO - FINANCE LOGIC
 */

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSidebar();
    initDate();
});

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
    'page-add-student-fine',
    'page-view-student-fines',
    'page-staff-hub',
    'page-staff-bonus',
    'page-add-staff-bonus',
    'page-view-staff-bonus',
    'page-staff-fine',
    'page-add-staff-fine',
    'page-view-staff-fines',
    'page-expense-hub',
    'page-add-expense',
    'page-view-expenses',
    // Salary pages
    'page-salary-hub',
    'page-salary-teaching',
    'page-salary-non-teaching'
];

function showPage(pageId) {
    ALL_PAGES.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('d-none');
    });
    const target = document.getElementById(pageId);
    if (target) target.classList.remove('d-none');

    if (pageId === 'page-student-fees') { if (typeof backToClassSelection === 'function') backToClassSelection(); }
    if (pageId === 'page-add-student-fine') populateStudentDropdown();
    if (pageId === 'page-add-staff-fine') {
        selectedStaffCategory = 'Teaching';
        selectedStaffId = null;
        document.getElementById('btn-teaching').classList.add('active');
        document.getElementById('btn-non-teaching').classList.remove('active');
        const sf = document.getElementById('staff-fine-search'); if (sf) sf.value = '';
        renderStaffMembersList('Teaching', '');
    }
    if (pageId === 'page-add-staff-bonus') {
        selectedBonusCategory = 'Teaching';
        selectedBonusStaffId = null;
        document.getElementById('btn-bonus-teaching').classList.add('active');
        document.getElementById('btn-bonus-non-teaching').classList.remove('active');
        const bs = document.getElementById('bonus-search'); if (bs) bs.value = '';
        renderBonusMembersList('Teaching', '');
    }
    if (pageId === 'page-view-student-fines') renderStudentFinesTable();
    if (pageId === 'page-view-staff-fines') renderStaffFinesTable();
    if (pageId === 'page-view-staff-bonus') renderStaffBonusTable();
    if (pageId === 'page-view-expenses') renderExpensesTable();
    if (pageId === 'page-salary-teaching') initTeachingSalaryPage();
    if (pageId === 'page-salary-non-teaching') initNonTeachingSalaryPage();
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

let selectedStudentFineId = null;

// Reset the Add-Student-Fine page each time it opens
function populateStudentDropdown() {
    selectedStudentFineId = null;
    const input = document.getElementById('student-fine-search');
    if (input) input.value = '';
    renderStudentSearchResults('');
}

function studentMatchesQuery(s, query) {
    const name = (s.fullName || s.name || '').toLowerCase();
    const guardian = (s.guardianName || '').toLowerCase();
    const q = (query || '').trim().toLowerCase();
    if (!q) return true;
    // "Name~Guardian" => BOTH must match
    if (q.includes('~')) {
        const parts = q.split('~');
        const namePart = (parts[0] || '').trim();
        const guardianPart = (parts[1] || '').trim();
        const nameOk = !namePart || name.includes(namePart);
        const guardianOk = !guardianPart || guardian.includes(guardianPart);
        return nameOk && guardianOk;
    }
    // single term => match student name OR guardian name
    return name.includes(q) || guardian.includes(q);
}

function searchStudentsForFine() {
    const q = document.getElementById('student-fine-search').value;
    renderStudentSearchResults(q);
}

function renderStudentSearchResults(query) {
    const container = document.getElementById('student-fine-results');
    if (!container) return;
    const students = getRealStudents();

    if (students.length === 0) {
        container.innerHTML = '<p class="search-empty">No students found. Add students from Admissions first.</p>';
        return;
    }

    const q = (query || '').trim();
    const matches = q ? students.filter(s => studentMatchesQuery(s, q)) : students;

    if (matches.length === 0) {
        container.innerHTML = '<p class="search-empty">No students match your search.</p>';
        return;
    }

    container.innerHTML = matches.map((s, index) => {
        const id = s.id || s.regNo || '';
        const name = s.fullName || s.name || 'Unnamed';
        const cls = s.studentClass || s.className || '-';
        const father = s.guardianName || '-';
        const active = (String(id) === String(selectedStudentFineId)) ? 'selected' : '';
        return `
        <div class="staff-member-item ${active}" id="stu-fine-item-${index}" onclick="selectStudentForFine('${id}', ${index})">
            <div class="staff-member-info">
                <span class="staff-member-name">${name}</span>
                <span class="staff-member-role"><b>ID:</b> ${id} &nbsp;&bull;&nbsp; <b>Class:</b> ${cls} &nbsp;&bull;&nbsp; <b>Father:</b> ${father}</span>
            </div>
            <div class="staff-member-check"><i class="fas fa-check"></i></div>
        </div>`;
    }).join('');
}

function selectStudentForFine(id, index) {
    selectedStudentFineId = id;
    document.querySelectorAll('#student-fine-results .staff-member-item').forEach(el => el.classList.remove('selected'));
    const item = document.getElementById('stu-fine-item-' + index);
    if (item) item.classList.add('selected');
}

function handleAddStudentFine() {
    const amount = Number(document.getElementById('student-fine-amount').value);
    const desc = document.getElementById('student-fine-desc').value.trim();

    if (!selectedStudentFineId) { alert('Please search and select a student.'); return; }
    if (!amount || amount < 1) { alert('Please enter a valid fine amount.'); return; }
    if (!desc) { alert('Please enter a fine description/cause.'); return; }

    const students = getRealStudents();
    const idx = students.findIndex(s => String(s.id || s.regNo) === String(selectedStudentFineId));
    if (idx === -1) { alert('Student not found.'); return; }
    const student = students[idx];

    const name = student.fullName || student.name || 'Unnamed';
    const cls = student.studentClass || student.className || '-';
    const father = student.guardianName || '-';

    // 1) Log the fine record (shown in View Records of student fines)
    const fines = getStudentFinesData();
    fines.push({
        id: student.id || student.regNo, name: name, className: cls, father: father,
        amount: amount, cause: desc, date: new Date().toLocaleDateString('en-US'),
        monthKey: getCurrentMonthKey()
    });
    saveStudentFinesData(fines);

    // 2) Send the fine to the student's FEE BILL (adds to outstanding arrears)
    student.arrears = (Number(student.arrears) || 0) + amount;
    students[idx] = student;
    localStorage.setItem('edu_students', JSON.stringify(students));

    // 3) Update global finance counters so the DASHBOARD reflects it in real time
    const db = getGlobalData();
    if (!db.students) db.students = {};
    if (!db.students.fines) db.students.fines = { lateFees: 0, other: 0 };
    db.students.fines.other = (Number(db.students.fines.other) || 0) + amount;
    saveGlobalData(db);

    alert(`Fine of RS ${amount.toLocaleString()} added to ${name} and posted to their fee bill.`);
    document.getElementById('student-fine-amount').value = '';
    document.getElementById('student-fine-desc').value = '';
    selectedStudentFineId = null;
    showPage('page-student-fine');
}

function renderStudentFinesTable() {
    const tbody = document.getElementById('student-fines-tbody');
    const allFines = getStudentFinesData();
    const currentMonthKey = getCurrentMonthKey();
    const fines = allFines.filter(f => !f.monthKey || f.monthKey === currentMonthKey);
    if (fines.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No fines recorded this month.</td></tr>';
        return;
    }
    tbody.innerHTML = fines.map(f => `
        <tr>
            <td>${f.id || '-'}</td>
            <td>${f.name}</td>
            <td>${f.className || '-'}</td>
            <td>${f.father || '-'}</td>
            <td>RS ${Number(f.amount).toLocaleString()} <span style="color:var(--text-secondary);font-size:12px;">(${f.cause})</span></td>
        </tr>
    `).join('');
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

    members[idx].fines = (Number(members[idx].fines) || 0) + amount;
    saveGlobalData(db);

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
    showPage('page-staff-fine');
}

function renderStaffFinesTable() {
    const tbody = document.getElementById('staff-fines-tbody');
    const allFines = getStaffFinesData();
    const currentMonthKey = getCurrentMonthKey();
    const fines = allFines.filter(f => !f.monthKey || f.monthKey === currentMonthKey);
    if (fines.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No fines recorded this month.</td></tr>';
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
let selectedBonusCategory = 'Teaching';
let selectedBonusStaffId = null;

function getStaffBonusData() {
    const raw = localStorage.getItem('eduflow-staff-bonus');
    return raw ? JSON.parse(raw) : [];
}
function saveStaffBonusData(arr) {
    localStorage.setItem('eduflow-staff-bonus', JSON.stringify(arr));
}

function selectBonusCategory(category) {
    selectedBonusCategory = category;
    selectedBonusStaffId = null;
    document.getElementById('btn-bonus-teaching').classList.toggle('active', category === 'Teaching');
    document.getElementById('btn-bonus-non-teaching').classList.toggle('active', category === 'Non-Teaching');
    const search = document.getElementById('bonus-search');
    if (search) search.value = '';
    renderBonusMembersList(category, '');
}

function filterBonusList() {
    renderBonusMembersList(selectedBonusCategory, document.getElementById('bonus-search').value);
}

function renderBonusMembersList(category, query) {
    const container = document.getElementById('bonus-members-list');
    const db = getGlobalData();
    let members = db.staff[category] || [];
    members = members.filter(s => staffMatchesQuery(s, query));
    if (members.length === 0) {
        container.innerHTML = '<p class="search-empty">No staff found in this category.</p>';
        return;
    }
    container.innerHTML = members.map(s => {
        const active = (String(s.id) === String(selectedBonusStaffId)) ? 'selected' : '';
        return `
        <div class="staff-member-item ${active}" id="bonus-item-${s.id}" onclick="selectBonusStaff('${s.id}')">
            <div class="staff-member-info">
                <span class="staff-member-name">${s.name}</span>
                <span class="staff-member-role">${staffSubLine(s, category)}</span>
            </div>
            <div class="staff-member-check"><i class="fas fa-check"></i></div>
        </div>`;
    }).join('');
}

function selectBonusStaff(id) {
    document.querySelectorAll('#bonus-members-list .staff-member-item').forEach(el => el.classList.remove('selected'));
    const item = document.getElementById('bonus-item-' + id);
    if (item) item.classList.add('selected');
    selectedBonusStaffId = id;
}

function handleAddStaffBonus() {
    if (!selectedBonusStaffId) { alert('Please select a staff member.'); return; }
    const amount = Number(document.getElementById('staff-bonus-amount').value);
    const desc = document.getElementById('staff-bonus-desc').value.trim();
    if (!amount || amount < 1) { alert('Please enter a valid bonus amount.'); return; }
    if (!desc) { alert('Please enter a bonus description.'); return; }

    const db = getGlobalData();
    const members = db.staff[selectedBonusCategory];
    const idx = members.findIndex(s => s.id === selectedBonusStaffId);
    if (idx === -1) { alert('Staff member not found.'); return; }

    const role = selectedBonusCategory === 'Teaching'
        ? (members[idx].subjects || 'Teacher')
        : (members[idx].job || 'Staff');

    const log = getStaffBonusData();
    log.push({
        staffId: members[idx].id, id: members[idx].id, name: members[idx].name, role: role,
        category: selectedBonusCategory, amount: amount, description: desc,
        date: new Date().toLocaleDateString('en-US'),
        monthKey: getCurrentMonthKey()
    });
    saveStaffBonusData(log);

    alert(`Bonus of RS ${amount.toLocaleString()} added to ${members[idx].name}.`);
    document.getElementById('staff-bonus-amount').value = '';
    document.getElementById('staff-bonus-desc').value = '';
    showPage('page-staff-bonus');
}

function renderStaffBonusTable() {
    const tbody = document.getElementById('staff-bonus-tbody');
    const allLog = getStaffBonusData();
    const currentMonthKey = getCurrentMonthKey();
    const log = allLog.filter(b => !b.monthKey || b.monthKey === currentMonthKey);
    if (log.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No bonuses recorded this month.</td></tr>';
        return;
    }
    tbody.innerHTML = log.map(b => `
        <tr>
            <td>${b.name}</td>
            <td>${b.role}</td>
            <td>RS ${Number(b.amount).toLocaleString()}</td>
            <td>${b.description}</td>
        </tr>
    `).join('');
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
    list.push({ description: desc, amount: amount, date: new Date().toLocaleDateString('en-US'), monthKey: getCurrentMonthKey() });
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
        tbody.innerHTML = '<tr><td colspan="2" class="empty-row">No expenses recorded this month.</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(e => `
        <tr>
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
// ⚙️  VOUCHER SETTINGS — configurable for the Settings page
// These variables control voucher due dates, expiry, and late fine behaviour.
// Export / import these via a settings page to allow admin customisation.
// ============================================================================
const VOUCHER_SETTINGS = {
    // Day of next month that the voucher is due (default: 10th)
    dueDayOfMonth: 10,

    // Day of next month that the voucher expires / last acceptable date
    // (typically the same as dueDayOfMonth; change if you want a grace period)
    expiryDayOfMonth: 10,

    // Late fine amount in Rupees added to the voucher if paid after due date
    // Set to 0 to disable, or use lateFinePercent for a % of total instead
    lateFineFixedAmount: 0,

    // Late fine as a percentage of the voucher grand total (e.g. 5 = 5%)
    // If lateFineFixedAmount > 0 it takes precedence over this value
    lateFinePercent: 5,
};
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


/**
 * Switcher function for Finance Modules
 */
function selectClassForFees(className) {
    // 1. Toggle UI Views
    document.getElementById('class-selection-view').style.display = 'none';
    document.getElementById('class-student-list-view').style.display = 'block';
    
    // 2. Set Title
    document.getElementById('selected-class-title').innerText = `Fee Records: ${className}`;
    
    // 3. Render Students
    renderFees(className);
}
function backToClassSelection() {
    document.getElementById('class-selection-view').style.display = 'block';
    document.getElementById('class-student-list-view').style.display = 'none';
}

// ... rest of the existing renderFees and filterByClass functions remain the same ...

/**
 * VOUCHER PREVIEW LOGIC
 */
function viewVoucher(studentId, fullName) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = findStudentExact(students, studentId, fullName);
    if (!student) {
        alert('Student not found.');
        return;
    }

    const html = buildVoucherHTML(student);
    document.getElementById('voucher-render-target').innerHTML = html;
    document.getElementById('voucher-modal-overlay').style.display = 'flex';
}

function closeVoucherModal() {
    document.getElementById('voucher-modal-overlay').style.display = 'none';
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
    // Always use HRK_77-prefixed registration ID for display
    const regNo = s.regNo && String(s.regNo).startsWith('HRK_') ? s.regNo : `HRK_77${String(s.id).padStart(3, '0')}`;

    // --- 1. Core Charges (stored in DB, shown in table) ---
    const tuitionFee = Number(s.standardFee) || 0;
    const transportFee = Number(s.transportFee) || 0;
    const admissionFee = Number(s.admissionFee) || 0;
    const otherFee = Number(s.otherFee) || 0;
    const otherFeeLabel = s.otherFeeLabel || 'Other Charges';

    // --- 2. Voucher-Only: Books Fee ---
    const booksFeeEnabled = s.takesBooks === true || s.booksFee > 0;
    const booksFee     = Number(s.booksFee) || 0;
    const booksDiscount= Number(s.booksDiscount) || 0;
    const booksNet     = Math.max(0, booksFee - booksDiscount);

    // --- 3. Voucher-Only: Additional (Other) Fees ---
    let additionalFees = [];
    try { additionalFees = JSON.parse(s.otherFeesData || '[]'); } catch(e) { additionalFees = []; }

    // --- 4. Voucher-Only: Annual Fund (only in the configured month) ---
    const annualFundEnabled = s.annualFundEnabled === 'on' || s.annualFundEnabled === true;
    const annualFundMonth   = parseInt(s.annualFundMonth) || 0;   // 1–12
    const annualFundAmt     = Number(s.annualFundAmount) || ANNUAL_FUND_AMOUNT;
    const currentMonth      = today.getMonth() + 1; // 1–12
    const showAnnualFund    = annualFundEnabled && annualFundMonth === currentMonth;

    // --- 5. Arrears (Previous Balance) ---
    // Stored arrears from the student record
    let arrears = Number(s.arrears) || 0;

    // Auto-rollover: if the previous month was not paid in full, add the
    // shortfall to arrears for the current month. (E.g. unpaid June fees
    // automatically appear in the July voucher.)
    //
    // BUGFIX: Only roll over previous-month unpaid amounts for students who
    // were actually enrolled BEFORE the previous month started. Newly admitted
    // students were incorrectly being charged "arrears" for months they were
    // not even in the school.
    try {
        const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

        // Determine the date the student joined the software.
        // We avoid using admissionDate because that's when they joined the school, not the software.
        // Using admissionDate causes newly added (but old) students to get hit with past months' arrears.
        let softwareJoinDate = null;
        if (s.createdAt) {
            const d = new Date(s.createdAt);
            if (!isNaN(d)) softwareJoinDate = d;
        }
        if (!softwareJoinDate && Array.isArray(s.feePayments) && s.feePayments.length) {
            const dates = s.feePayments
                .map(p => p.date ? new Date(p.date) : null)
                .filter(d => d && !isNaN(d));
            if (dates.length) softwareJoinDate = new Date(Math.min(...dates.map(d => d.getTime())));
        }
        if (!softwareJoinDate) softwareJoinDate = new Date(today);

        // Student must have been active in the software on or before the FIRST day of the
        // previous month to automatically owe anything for that month.
        const enrolledBeforePrevMonth = softwareJoinDate <= prev;

        let prevUnpaid = 0;
        if (enrolledBeforePrevMonth) {
            const prevPayments = (s.feePayments || [])
                .filter(p => p.monthKey === prevKey)
                .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const monthlyExpected =
                (Number(s.standardFee) || 0) +
                (Number(s.transportFee) || 0) +
                (Number(s.otherFee) || 0) -
                ((Number(s.tuitionDiscount) || 0) +
                 (Number(s.transportDiscount) || 0) +
                 (Number(s.siblingDiscount) || 0));
            prevUnpaid = Math.max(0, monthlyExpected - prevPayments);
        }
        // Mark as auto-rolled so the voucher row can label it clearly
        s.__rolledOverArrears = prevUnpaid;
        s.__rolledOverFromMonth = prev.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        arrears += prevUnpaid;
    } catch (e) { /* ignore */ }

    // --- 6. Specific Discounts (from Student Form) ---
    const tDisc   = Number(s.tuitionDiscount)   || 0;
    const trDisc  = Number(s.transportDiscount) || 0;
    const sibDisc = Number(s.siblingDiscount)   || 0;

    // Core total (what the table "pending fees" shows)
    const totalCharges   = tuitionFee + transportFee + admissionFee + otherFee;
    const totalDiscounts = tDisc + trDisc + sibDisc;
    const totalWithinDueDate = (totalCharges - totalDiscounts) + arrears;

    // Voucher grand total (core + voucher-only items)
    const additionalFeesNet = additionalFees.reduce((sum, f) =>
        sum + Math.max(0, (parseFloat(f.amount)||0) - (parseFloat(f.discount)||0)), 0);
    const voucherTotal = totalWithinDueDate + booksNet + additionalFeesNet + (showAnnualFund ? annualFundAmt : 0);

    // Dates — due date is NEXT month's configured day
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, VOUCHER_SETTINGS.dueDayOfMonth);
    const expiryDate = new Date(today.getFullYear(), today.getMonth() + 1, VOUCHER_SETTINGS.expiryDayOfMonth);
    const dueDate = nextMonth;
    const dueDateStr = dueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const expiryDateStr = expiryDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const discountDeadline = s.discountExpiry
        ? new Date(s.discountExpiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : dueDateStr;

    // Late Surcharge — uses fixed amount or percentage from VOUCHER_SETTINGS
    const lateFeeSurcharge = VOUCHER_SETTINGS.lateFineFixedAmount > 0
        ? VOUCHER_SETTINGS.lateFineFixedAmount
        : Math.round(voucherTotal * (VOUCHER_SETTINGS.lateFinePercent / 100));
    const totalAfterDueDate = voucherTotal + lateFeeSurcharge;

    return {
        regNo, monthLabel, dueDateStr, expiryDateStr,
        tuitionFee, transportFee, admissionFee, otherFee, otherFeeLabel, arrears,
        tDisc, trDisc, sibDisc,
        // Books (voucher-only)
        booksFee, booksDiscount, booksNet, booksFeeEnabled,
        // Additional fees (voucher-only)
        additionalFees,
        // Annual fund (voucher-only)
        showAnnualFund, annualFundAmt,
        totalCharges, totalDiscounts,
        totalWithinDueDate,  // core total for table display
        voucherTotal,        // grand total for the voucher
        lateFeeSurcharge, totalAfterDueDate,
        discountDeadline
    };
}

function buildVoucherHTML(s) {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const challanNo = `CH-${s.id}-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;
    const photoSrc = s.photo || '';
    const f = computeFeeBreakdown(s);

    // Build Charges Rows
    let rowsHTML = `
        <tr><td>Tuition Fee</td><td>${f.monthLabel}</td><td>Rs. ${f.tuitionFee.toLocaleString()}</td></tr>
        ${f.transportFee > 0 ? `<tr><td>Transportation Fee</td><td>${f.monthLabel}</td><td>Rs. ${f.transportFee.toLocaleString()}</td></tr>` : ''}
        ${f.admissionFee > 0 ? `<tr><td>Admission Fee</td><td>One-time</td><td>Rs. ${f.admissionFee.toLocaleString()}</td></tr>` : ''}
        ${f.otherFee > 0 ? `<tr><td>${f.otherFeeLabel}</td><td>-</td><td>Rs. ${f.otherFee.toLocaleString()}</td></tr>` : ''}
    `;

    // ── Voucher-Only: Books Fee ──────────────────────────────────────────────
    if (f.booksFee > 0) {
        rowsHTML += `<tr><td>Books Fee</td><td>${f.monthLabel}</td><td>Rs. ${f.booksFee.toLocaleString()}</td></tr>`;
        if (f.booksDiscount > 0) {
            rowsHTML += `<tr class="voucher-row-discount"><td>- Books Discount</td><td>-</td><td>- Rs. ${f.booksDiscount.toLocaleString()}</td></tr>`;
        }
    }

    // ── Voucher-Only: Additional Fees ────────────────────────────────────────
    f.additionalFees.forEach(fee => {
        if (!fee.description && !fee.amount) return;
        rowsHTML += `<tr><td>${fee.description || 'Additional Fee'}</td><td>${f.monthLabel}</td><td>Rs. ${parseFloat(fee.amount||0).toLocaleString()}</td></tr>`;
        if (parseFloat(fee.discount||0) > 0) {
            rowsHTML += `<tr class="voucher-row-discount"><td>- ${fee.description || 'Additional Fee'} Discount</td><td>-</td><td>- Rs. ${parseFloat(fee.discount).toLocaleString()}</td></tr>`;
        }
    });

    // ── Voucher-Only: Annual Fund (only in designated month) ─────────────────
    if (f.showAnnualFund) {
        rowsHTML += `<tr style="background:#fffbeb;"><td><strong>Annual Fund</strong></td><td>Annual (${today.toLocaleDateString('en-GB', { month: 'long' })} only)</td><td>Rs. ${f.annualFundAmt.toLocaleString()}</td></tr>`;
    }

    // Build Discount Rows (If any exist)
    if (f.totalDiscounts > 0) {
        rowsHTML += `<tr class="voucher-row-discount"><td colspan="2"><strong>Discounts Breakdown:</strong></td><td></td></tr>`;
        if (f.tDisc > 0) rowsHTML += `<tr class="voucher-row-discount"><td>- Tuition Concession</td><td>-</td><td>- Rs. ${f.tDisc.toLocaleString()}</td></tr>`;
        if (f.trDisc > 0) rowsHTML += `<tr class="voucher-row-discount"><td>- Transport Subsidy</td><td>-</td><td>- Rs. ${f.trDisc.toLocaleString()}</td></tr>`;
        if (f.sibDisc > 0) rowsHTML += `<tr class="voucher-row-discount"><td>- Sibling Discount</td><td>-</td><td>- Rs. ${f.sibDisc.toLocaleString()}</td></tr>`;
        rowsHTML += `<tr class="voucher-row-discount" style="background:#f0fdf4; border-top:1px solid #bbf7d0">
            <td><strong>Total Monthly Discount</strong></td><td>Valid till ${f.discountDeadline}</td><td><strong>- Rs. ${f.totalDiscounts.toLocaleString()}</strong></td></tr>`;
    }

    // Arrears Row (may include auto-rolled previous-month unpaid)
    if (f.arrears > 0) {
        const rolled = Number(s.__rolledOverArrears) || 0;
        const stored = Math.max(0, f.arrears - rolled);
        if (stored > 0) {
            rowsHTML += `
                <tr class="voucher-row-arrears">
                    <td><strong>Previous Arrears / Balance</strong></td>
                    <td>Past Dues</td>
                    <td>Rs. ${stored.toLocaleString()}</td>
                </tr>`;
        }
        if (rolled > 0) {
            rowsHTML += `
                <tr class="voucher-row-arrears">
                    <td><strong>Unpaid Carried Forward</strong></td>
                    <td>${s.__rolledOverFromMonth || 'Previous month'}</td>
                    <td>Rs. ${rolled.toLocaleString()}</td>
                </tr>`;
        }
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
                        <td colspan="2"><i class="fas fa-wallet"></i> NET PAYABLE / REMAINING BALANCE</td>
                        <td>Rs. ${f.voucherTotal.toLocaleString()}</td>
                    </tr>
                    <tr class="voucher-total-row voucher-total-late">
                        <td colspan="2"><i class="fas fa-exclamation-triangle"></i> Payable After Due Date (Incl. Surcharge)</td>
                        <td>Rs. ${f.totalAfterDueDate.toLocaleString()}</td>
                    </tr>
                </tfoot>
            </table>

            <div class="voucher-footer">
                <div class="voucher-note"><i class="fas fa-info-circle"></i> Arrears are included in the Net Payable amount. Please clear all dues.</div>
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
    f.totalWithinDueDate += monthlyFineTotal;
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

function renderFees(className) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const tbody = document.getElementById('fee-table-body');
    if(!tbody) return;
    
    tbody.innerHTML = "";
    
    const filtered = students.filter(s => s.studentClass === className);

    if(filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px;">No students found enrolled in <strong>${className}</strong>.</td></tr>`;
        return;
    }

    filtered.forEach(s => {
        const f = computeFeeBreakdown(s);
        const currentMonthKey = getCurrentMonthKey();
        const payments = s.feePayments || [];
        const thisMonthPaid = payments.filter(p => p.monthKey === currentMonthKey).reduce((sum, p) => sum + p.amount, 0);
        const pendingAmount = Math.max(0, f.totalWithinDueDate - thisMonthPaid);
        const isPaid = pendingAmount <= 0;
        const hasArrears = f.arrears > 0;
        const hasFines = f.monthlyFineTotal > 0;

        let statusBadge = '';
        if (isPaid) {
            statusBadge = `<span class="fee-status-badge fee-paid"><i class="fas fa-check-circle"></i> Paid</span>`;
        } else if (hasArrears) {
            statusBadge = `<span class="fee-status-badge fee-overdue"><i class="fas fa-exclamation-circle"></i> Arrears</span>`;
        } else {
            statusBadge = `<span class="fee-status-badge fee-pending"><i class="fas fa-clock"></i> Pending</span>`;
        }

        tbody.innerHTML += `
            <tr>
                <td><span class="hrk-id-badge">${f.regNo}</span></td>
                <td>
                    <strong>${s.fullName}</strong>
                    ${hasFines ? `<br><span style="font-size:0.72rem;color:#dc2626;"><i class="fas fa-exclamation-triangle"></i> Active fines</span>` : ''}
                </td>
                <td>${s.guardianName || '-'}</td>
                <td>
                    <strong style="color:${isPaid ? '#27ae60' : '#c2410c'}">Rs. ${pendingAmount.toLocaleString()}</strong>
                    ${thisMonthPaid > 0 ? `<br><span style="font-size:0.72rem;color:#16a34a;"><i class="fas fa-check"></i> Rs. ${thisMonthPaid.toLocaleString()} paid</span>` : ''}
                    ${hasArrears ? `<br><span style="font-size:0.72rem;color:#c2410c;">Arrears: Rs. ${f.arrears.toLocaleString()}</span>` : ''}
                </td>
                <td>${statusBadge}</td>
                <td class="fee-actions-cell">
                    <button class="btn-tiny" onclick="viewVoucher('${s.id}', '${escapeForAttr(s.fullName||'')}')">
                        <i class="fas fa-eye"></i> Voucher
                    </button>
                    <button class="btn-tiny btn-add-fees" onclick="openAddFeesModal('${s.id}', '${escapeForAttr(s.fullName||'')}')">
                        <i class="fas fa-plus-circle"></i> Add Fees
                    </button>
                </td>
            </tr>
        `;
    });

    // Reset & apply search after re-render
    const search = document.getElementById('fee-search-input');
    if (search) { search.value = ''; }
    filterFeeTable();
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

function openAddFeesModal(studentId, fullName) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = findStudentExact(students, studentId, fullName);
    if (!student) { alert('Student not found.'); return; }
    afmCurrentStudent = student;

    document.getElementById('add-fees-student-id').value = studentId;

    // Pre-fill month
    const now = new Date();
    document.getElementById('af-fee-month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Reset bulk discount & notes
    document.getElementById('afm-bulk-discount').value = '';
    document.getElementById('af-fee-notes').value = '';

    // Reset fee rows — start with standard fees from student record
    afmFeeRows = [];
    afmNextRowId = 1;

    const f = computeFeeBreakdown(student);

    // Auto-populate rows based on student's fee structure
    if (f.tuitionFee > 0) addFeeItemRow('tuition', f.tuitionFee, f.tDisc);
    if (f.transportFee > 0) addFeeItemRow('transport', f.transportFee, f.trDisc);
    if (f.admissionFee > 0) addFeeItemRow('admission', f.admissionFee, 0);
    if (f.otherFee > 0) addFeeItemRow('other', f.otherFee, 0);
    // If nothing set up, add one empty row
    if (afmFeeRows.length === 0) addFeeItemRow('tuition', 0, 0);

    renderAddFeesModal(student);
    document.getElementById('add-fees-modal').style.display = 'flex';
}

function addFeeItemRow(typeVal, amount, discount, customLabel) {
    const id = afmNextRowId++;
    const row = {
        id,
        type: typeVal || 'custom',
        amount: amount || 0,
        discount: discount || 0,
        customLabel: customLabel || ''
    };
    // Preset seeding (called with arguments) appends; user clicks (no args)
    // prepend so the new fields appear at the top of the list.
    if (typeVal === undefined) {
        afmFeeRows.unshift(row);
    } else {
        afmFeeRows.push(row);
    }
    renderFeeRows();
    recalcAFTotal();
    // Make the brand-new row visible immediately
    if (typeVal === undefined) {
        const wrap = document.getElementById('afm-fee-rows-container');
        if (wrap) wrap.scrollTop = 0;
        const newRow = document.getElementById('afm-row-' + id);
        if (newRow && newRow.scrollIntoView) newRow.scrollIntoView({ block: 'nearest' });
        // Focus the category select for the new row
        const sel = newRow && newRow.querySelector('select');
        if (sel) sel.focus();
    }
}

function removeFeeRow(id) {
    afmFeeRows = afmFeeRows.filter(r => r.id !== id);
    renderFeeRows();
    recalcAFTotal();
}

function updateFeeRow(id, field, value) {
    const row = afmFeeRows.find(r => r.id === id);
    if (!row) return;
    if (field === 'type') {
        row.type = value;
        // Auto-fill amount from student data if applicable
        const studentId = document.getElementById('add-fees-student-id').value;
        const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
        const student = afmCurrentStudent || students.find(s => String(s.id) === String(studentId));
        if (student) {
            const preset = FEE_TYPE_PRESETS.find(p => p.value === value);
            if (preset && preset.key && student[preset.key]) {
                row.amount = Number(student[preset.key]) || 0;
            }
            if (value === 'arrears') {
                row.amount = Number(student.arrears) || 0;
            }
        }
        renderFeeRows();
    } else if (field === 'amount') {
        row.amount = parseFloat(value) || 0;
    } else if (field === 'discount') {
        row.discount = parseFloat(value) || 0;
    } else if (field === 'customLabel') {
        row.customLabel = value;
    }
    recalcAFTotal();
}

function renderFeeRows() {
    const container = document.getElementById('afm-fee-rows-container');
    if (!container) return;

    let html = '';
    afmFeeRows.forEach(row => {
        const net = Math.max(0, row.amount - row.discount);
        const selectedOptions = FEE_TYPE_PRESETS.map(p =>
            `<option value="${p.value}" ${p.value === row.type ? 'selected' : ''}>${p.label}</option>`
        ).join('');

        const customNameInput = row.type === 'custom'
            ? `<input type="text" class="afm-input" style="margin-top:6px;" placeholder="Name this category…"
                       value="${(row.customLabel||'').replace(/"/g,'&quot;')}"
                       oninput="updateFeeRow(${row.id},'customLabel',this.value)">`
            : '';

        html += `
        <div class="afm-fee-row" id="afm-row-${row.id}">
            <div class="afm-fee-row-type">
                <select class="afm-input afm-row-select" onchange="updateFeeRow(${row.id},'type',this.value)">
                    ${selectedOptions}
                </select>
                ${customNameInput}
            </div>
            <div class="afm-fee-row-amt">
                <div class="afm-input-with-prefix">
                    <span class="afm-prefix">Rs.</span>
                    <input type="number" class="afm-input afm-no-left-radius" value="${row.amount || ''}" placeholder="0" min="0"
                        onchange="updateFeeRow(${row.id},'amount',this.value)"
                        oninput="updateFeeRow(${row.id},'amount',this.value)">
                </div>
            </div>
            <div class="afm-fee-row-disc">
                <div class="afm-input-with-prefix afm-disc-input">
                    <span class="afm-prefix afm-disc-prefix">- Rs.</span>
                    <input type="number" class="afm-input afm-no-left-radius" value="${row.discount || ''}" placeholder="0" min="0"
                        onchange="updateFeeRow(${row.id},'discount',this.value)"
                        oninput="updateFeeRow(${row.id},'discount',this.value)">
                </div>
            </div>
            <div class="afm-fee-row-net">
                <span class="afm-net-badge ${net > 0 ? '' : 'afm-net-zero'}" id="afm-net-${row.id}">Rs. ${net.toLocaleString()}</span>
            </div>
            <div class="afm-fee-row-del">
                ${afmFeeRows.length > 1 ? `<button class="afm-del-btn" onclick="removeFeeRow(${row.id})" title="Remove"><i class="fas fa-trash-alt"></i></button>` : ''}
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

function recalcAFTotal() {
    // Update net badges live
    afmFeeRows.forEach(row => {
        const net = Math.max(0, row.amount - row.discount);
        const el = document.getElementById(`afm-net-${row.id}`);
        if (el) {
            el.textContent = `Rs. ${net.toLocaleString()}`;
            el.classList.toggle('afm-net-zero', net === 0);
        }
    });

    const bulkDisc = parseFloat(document.getElementById('afm-bulk-discount')?.value) || 0;

    const gross = afmFeeRows.reduce((s, r) => s + (r.amount || 0), 0);
    const itemDiscTotal = afmFeeRows.reduce((s, r) => s + (r.discount || 0), 0);
    const afterItemDisc = Math.max(0, gross - itemDiscTotal);
    const afterBulkDisc = Math.max(0, afterItemDisc - bulkDisc);

    // Check for arrears rows
    const arrearsRow = afmFeeRows.find(r => r.type === 'arrears');
    const arrearsAmt = arrearsRow ? (arrearsRow.amount || 0) : 0;

    // Update summary panel
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('afm-t-gross', `Rs. ${gross.toLocaleString()}`);
    set('afm-t-item-disc', `- Rs. ${itemDiscTotal.toLocaleString()}`);
    set('afm-t-bulk-disc', `- Rs. ${bulkDisc.toLocaleString()}`);
    set('afm-t-grand', `Rs. ${afterBulkDisc.toLocaleString()}`);

    // Hide arrears row in totals (arrears included in gross already)
    const arrearsRowEl = document.getElementById('afm-arrears-row');
    if (arrearsRowEl) arrearsRowEl.style.display = 'none';

    // Per-fee discount breakdown
    const discBreakEl = document.getElementById('afm-discount-breakdown');
    if (discBreakEl) {
        const rowsWithDisc = afmFeeRows.filter(r => r.discount > 0);
        if (rowsWithDisc.length > 0) {
            discBreakEl.innerHTML = rowsWithDisc.map(r => {
                const preset = FEE_TYPE_PRESETS.find(p => p.value === r.type);
                const label = preset ? preset.label : r.type;
                return `<div class="afm-disc-break-row">
                    <span>${label}</span>
                    <strong style="color:#16a34a;">- Rs. ${r.discount.toLocaleString()}</strong>
                </div>`;
            }).join('');
        } else {
            discBreakEl.innerHTML = '';
        }
    }

    // Combined discount card
    const totalDisc = itemDiscTotal + bulkDisc;
    const combCard = document.getElementById('afm-combined-disc-card');
    if (combCard) {
        if (totalDisc > 0) {
            combCard.style.display = 'block';
            const cdcItems = document.getElementById('afm-cdc-items');
            if (cdcItems) {
                let html = '';
                afmFeeRows.filter(r => r.discount > 0).forEach(r => {
                    const preset = FEE_TYPE_PRESETS.find(p => p.value === r.type);
                    html += `<div class="afm-cdc-row"><span>${preset ? preset.label : r.type}</span><strong>Rs. ${r.discount.toLocaleString()}</strong></div>`;
                });
                if (bulkDisc > 0) html += `<div class="afm-cdc-row"><span>Bulk Discount</span><strong>Rs. ${bulkDisc.toLocaleString()}</strong></div>`;
                cdcItems.innerHTML = html;
            }
            const cdcTotal = document.getElementById('afm-cdc-total-amt');
            if (cdcTotal) cdcTotal.textContent = `Rs. ${totalDisc.toLocaleString()}`;
        } else {
            combCard.style.display = 'none';
        }
    }
}

function renderAddFeesModal(student) {
    const f = computeFeeBreakdown(student);
    const payments = student.feePayments || [];
    const currentMonthKey = getCurrentMonthKey();
    const thisMonthPaid = payments.filter(p => p.monthKey === currentMonthKey).reduce((sum, p) => sum + p.amount, 0);

    // Header subtitle
    const headerSub = document.getElementById('afm-header-subtitle');
    if (headerSub) headerSub.textContent = `${student.fullName} · ${student.studentClass || ''}`;

    // Student summary banner
    const photoHtml = student.photo
        ? `<img src="${student.photo}" class="af-student-photo">`
        : `<div class="af-student-photo af-photo-placeholder"><i class="fas fa-user"></i></div>`;

    const pendingAmount = Math.max(0, f.totalWithinDueDate - thisMonthPaid);

    document.getElementById('add-fees-student-summary').innerHTML = `
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
            <div class="af-summary-amounts">
                <div class="af-amount-box af-amount-total">
                    <span>Monthly Total</span>
                    <strong>Rs. ${f.totalWithinDueDate.toLocaleString()}</strong>
                </div>
                <div class="af-amount-box ${pendingAmount > 0 ? 'af-amount-pending' : 'af-amount-clear'}">
                    <span>${pendingAmount > 0 ? 'Pending' : 'Cleared'}</span>
                    <strong>Rs. ${pendingAmount.toLocaleString()}</strong>
                </div>
                ${thisMonthPaid > 0 ? `<div class="af-amount-box af-amount-clear"><span>Paid This Month</span><strong>Rs. ${thisMonthPaid.toLocaleString()}</strong></div>` : ''}
            </div>
        </div>
    `;

    // Arrears alert
    const arrearsAlert = document.getElementById('afm-arrears-alert');
    if (f.arrears > 0 && arrearsAlert) {
        arrearsAlert.style.display = 'flex';
        document.getElementById('afm-arrears-amount-text').textContent = `Rs. ${f.arrears.toLocaleString()} in previous dues have been added to this month's fee.`;
        document.getElementById('afm-arrears-badge').textContent = `Rs. ${f.arrears.toLocaleString()}`;
    } else if (arrearsAlert) {
        arrearsAlert.style.display = 'none';
    }

    // Render fee rows + recalc
    renderFeeRows();
    recalcAFTotal();

    // Payment history
    renderPaymentHistory(student);
}

function saveStudentFeePayment() {
    const studentId = document.getElementById('add-fees-student-id').value;
    const monthValue = document.getElementById('af-fee-month').value;
    const method = document.getElementById('af-payment-method').value;
    const notes = document.getElementById('af-fee-notes').value;
    const bulkDisc = parseFloat(document.getElementById('afm-bulk-discount').value) || 0;

    if (!monthValue) { alert('Please select a payment month.'); return; }
    if (afmFeeRows.length === 0) { alert('Please add at least one fee item.'); return; }

    const totalGross = afmFeeRows.reduce((s, r) => s + (r.amount || 0), 0);
    if (totalGross <= 0) { alert('Please enter valid fee amounts.'); return; }

    const [year, month] = monthValue.split('-');
    const monthLabel = new Date(parseInt(year), parseInt(month) - 1, 1)
        .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    const itemDiscTotal = afmFeeRows.reduce((s, r) => s + (r.discount || 0), 0);
    const grandTotal = Math.max(0, totalGross - itemDiscTotal - bulkDisc);

    let students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const wantName = afmCurrentStudent ? afmCurrentStudent.fullName : null;
    let idx = -1;
    if (wantName) idx = students.findIndex(s => String(s.id) === String(studentId) && s.fullName === wantName);
    if (idx === -1) idx = students.findIndex(s => String(s.id) === String(studentId));
    if (idx === -1) { alert('Student not found.'); return; }

    if (!students[idx].feePayments) students[idx].feePayments = [];

    // Build fee items snapshot
    const feeItemsSnapshot = afmFeeRows.map(r => {
        const preset = FEE_TYPE_PRESETS.find(p => p.value === r.type);
        const label = (r.type === 'custom' && r.customLabel)
            ? r.customLabel
            : (preset ? preset.label : r.type);
        return {
            type: r.type,
            label,
            customLabel: r.customLabel || '',
            amount: r.amount,
            discount: r.discount,
            net: Math.max(0, r.amount - r.discount)
        };
    });

    const payment = {
        id: Date.now(),
        monthKey: monthValue,
        monthLabel,
        feeType: feeItemsSnapshot.map(i => i.label.replace(/^[^\s]+\s/, '')).join(' + '),
        feeItems: feeItemsSnapshot,
        amount: grandTotal,
        grossAmount: totalGross,
        itemDiscounts: itemDiscTotal,
        bulkDiscount: bulkDisc,
        method,
        notes,
        date: new Date().toISOString()
    };

    students[idx].feePayments.push(payment);

    // Clear arrears if an arrears row was included
    const arrearsRow = afmFeeRows.find(r => r.type === 'arrears');
    if (arrearsRow && arrearsRow.amount > 0) {
        const remaining = Math.max(0, (Number(students[idx].arrears) || 0) - arrearsRow.amount);
        students[idx].arrears = remaining;
    }

    localStorage.setItem('edu_students', JSON.stringify(students));

    showFeeSuccessToast(`Rs. ${grandTotal.toLocaleString()} recorded for ${students[idx].fullName}`);

    // Reset form
    document.getElementById('af-fee-notes').value = '';
    document.getElementById('afm-bulk-discount').value = '';

    // Re-render modal
    renderAddFeesModal(students[idx]);

    // Refresh table
    const classTitle = document.getElementById('selected-class-title');
    if (classTitle) {
        const className = classTitle.innerText.replace('Fee Records: ', '');
        renderFees(className);
    }
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

function openAddToVoucherModal(studentId, fullName) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = findStudentExact(students, studentId, fullName);
    if (!student) { alert('Student not found.'); return; }

    document.getElementById('atv-student-id').value = student.id;
    document.getElementById('atv-student-id').dataset.fullName = student.fullName || '';
    document.getElementById('atv-header-subtitle').textContent = `${student.fullName} · ${student.studentClass || ''}`;

    // Reset rows — seed with student's standard fees
    atvFeeRows = [];
    atvNextRowId = 1;
    const f = computeFeeBreakdown(student);
    if (f.tuitionFee > 0)   atvAddFeeRow('tuition',   f.tuitionFee,   f.tDisc);
    if (f.transportFee > 0) atvAddFeeRow('transport', f.transportFee, f.trDisc);
    if (f.admissionFee > 0) atvAddFeeRow('admission', f.admissionFee, 0);
    if (f.otherFee > 0)     atvAddFeeRow('other',     f.otherFee,     0);
    if (atvFeeRows.length === 0) atvAddFeeRow('tuition', 0, 0);

    // Reset bulk discount
    document.getElementById('atv-bulk-discount').value = '';

    // Show due / expiry dates from VOUCHER_SETTINGS
    document.getElementById('atv-due-date-display').textContent = f.dueDateStr;
    document.getElementById('atv-expiry-date-display').textContent = f.expiryDateStr;
    const lateLabel = VOUCHER_SETTINGS.lateFineFixedAmount > 0
        ? `Rs. ${VOUCHER_SETTINGS.lateFineFixedAmount.toLocaleString()} fixed`
        : `${VOUCHER_SETTINGS.lateFinePercent}% of total`;
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
    document.getElementById('add-to-voucher-modal').style.display = 'flex';
}

function closeAddToVoucherModal() {
    document.getElementById('add-to-voucher-modal').style.display = 'none';
}

function atvAddFeeRow(typeVal, amount, discount, customLabel) {
    const id = atvNextRowId++;
    const isManualAdd = typeVal === undefined;
    const row = {
        id,
        type: typeVal || 'custom',
        amount: amount || 0,
        discount: discount || 0,
        customLabel: customLabel || ''
    };
    // Always append to the bottom so the new row appears right where the user
    // expects (below the existing fees) instead of being hidden above them.
    atvFeeRows.push(row);
    atvRenderRows();
    atvRecalc();

    if (isManualAdd) {
        // Scroll the modal so the new row is visible, then focus the category select.
        const newRow = document.getElementById('atv-row-' + id);
        if (newRow) {
            const scroller = newRow.closest('.voucher-modal-scroll')
                || document.querySelector('#add-to-voucher-modal .voucher-modal-scroll');
            if (scroller) {
                // Bring the new row into view within the modal's scroll container.
                const rowRect = newRow.getBoundingClientRect();
                const scrRect = scroller.getBoundingClientRect();
                const offset  = (rowRect.top - scrRect.top) + scroller.scrollTop - 40;
                scroller.scrollTo({ top: offset, behavior: 'smooth' });
            } else if (newRow.scrollIntoView) {
                newRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
            // Brief highlight so the user notices the new row.
            newRow.style.transition = 'background-color 0.6s ease';
            newRow.style.backgroundColor = '#eff6ff';
            setTimeout(() => { newRow.style.backgroundColor = ''; }, 800);

            const sel = newRow.querySelector('select');
            if (sel) sel.focus();
        }
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

    const lateExtra = VOUCHER_SETTINGS.lateFineFixedAmount > 0
        ? VOUCHER_SETTINGS.lateFineFixedAmount
        : Math.round(voucherTotal * (VOUCHER_SETTINGS.lateFinePercent / 100));
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

    // Merge with existing additional fees (or replace — here we replace for clarity)
    students[idx].otherFeesData = JSON.stringify(newFeeEntries);
    students[idx].voucherBulkDiscount = bulkDisc;

    localStorage.setItem('edu_students', JSON.stringify(students));

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

function renderTeachingSalaries(filterText = '') {
    const tbody = document.getElementById('teaching-salary-tbody');
    const db = getGlobalData();
    const teachingStaff = db.staff.Teaching || [];
    const currentMonthKey = getCurrentMonthKey();

    const filtered = teachingStaff.filter(t =>
        t.name.toLowerCase().includes(filterText.toLowerCase()) ||
        t.id.toLowerCase().includes(filterText.toLowerCase())
    );

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No matching teaching staff found.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(t => {
        const isPaid = (t.salaryHistory || []).some(h => h.monthKey === currentMonthKey);
        const advance = getTotalAdvance(t.id);
        return `
            <tr class="salary-row-clickable" onclick="showSalaryBreakdown('${t.id}', 'Teaching')" title="Click to view salary breakdown">
                <td class="teacher-id-cell">${t.id}</td>
                <td>
                    <div style="font-weight:600;">${t.name}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">${t.email || ''}</div>
                </td>
                <td>${t.subjects || 'General Teacher'}</td>
                <td><strong>RS ${(Number(t.salary) || 0).toLocaleString()}</strong></td>
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
        return `
            <tr class="salary-row-clickable" onclick="showSalaryBreakdown('${w.id}', 'Non-Teaching')" title="Click to view salary breakdown">
                <td class="teacher-id-cell">${w.id}</td>
                <td>
                    <div style="font-weight:600;">${w.name}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">${w.email || ''}</div>
                </td>
                <td>${w.job || 'Worker'}</td>
                <td><strong>RS ${(Number(w.salary) || 0).toLocaleString()}</strong></td>
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
    const feeDeducted   = Number(staff.feeDeducted) || 0;
    const advanceTaken  = getTotalAdvance(staffId);

    // Security deposit auto-deduction (monthly until fully collected)
    const secInfo       = computeMonthlySecurity(staff);
    // Manual override (legacy) is added on top of the auto monthly deduction
    const manualSecurity = Number(staff.security) || 0;
    const security      = secInfo.monthlyDue + manualSecurity;

    const netPayable    = baseSalary + totalBonus - security - feeDeducted - totalFine - advanceTaken;
    const fmt = n => 'RS ' + Math.max(0, n).toLocaleString();

    document.getElementById('sbp-teacher-name').textContent = staff.name;
    document.getElementById('sbp-teacher-id').textContent   = staff.id;
    document.getElementById('sbp-total-salary').value   = fmt(baseSalary);
    document.getElementById('sbp-bonus').value          = fmt(totalBonus);
    document.getElementById('sbp-security').value       = secInfo.total > 0
        ? `${fmt(security)}  (${secInfo.collected.toLocaleString()} / ${secInfo.total.toLocaleString()})`
        : fmt(security);
    document.getElementById('sbp-fee-deducted').value   = fmt(feeDeducted);
    document.getElementById('sbp-fine').value           = fmt(totalFine);
    document.getElementById('sbp-advance-taken').value  = fmt(advanceTaken);
    document.getElementById('sbp-net-payable').value    = 'RS ' + netPayable.toLocaleString();


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

function payCurrentSalary() {
    const panel = document.getElementById('salary-breakdown-panel');
    const staffId  = panel && panel.dataset.teacherId;
    const category = (panel && panel.dataset.category) || 'Teaching';
    if (!staffId) return;
    if (isStaffPaidThisMonth(staffId, category)) {
        alert('Salary for this month has already been paid. No further actions can be performed until next month.');
        return;
    }
    processSalaryPayment(staffId, category);
    closeSalaryBreakdown();
}

function processSalaryPayment(staffId, category = 'Teaching') {
    const db = getGlobalData();
    const list = db.staff[category] || [];
    const staff = list.find(s => s.id === staffId);
    if (!staff) return;

    if (confirm(`Confirm salary payment of RS ${Number(staff.salary).toLocaleString()} to ${staff.name}?`)) {
        if (!staff.salaryHistory) staff.salaryHistory = [];



        // Apply this month's security deduction (if any pending)
        const secInfo = computeMonthlySecurity(staff);
        const secDeducted = secInfo.monthlyDue;
        if (secDeducted > 0) {
            staff.securityCollected = (Number(staff.securityCollected) || 0) + secDeducted;
        }

        staff.salaryHistory.push({
            date: new Date().toISOString(),
            monthKey: getCurrentMonthKey(),
            amount: staff.salary,
            securityDeducted: secDeducted,
            status: 'Paid'
        });

        saveGlobalData(db);
        const note = secDeducted > 0 ? `\nSecurity deducted: RS ${secDeducted.toLocaleString()}` : '';
        alert(`Salary processed successfully for ${staff.name}${note}`);
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

function payAdvanceSalary() {
    const panel = document.getElementById('salary-breakdown-panel');
    const staffId  = panel && panel.dataset.teacherId;
    const category = (panel && panel.dataset.category) || 'Teaching';
    if (!staffId) return;

    if (isStaffPaidThisMonth(staffId, category)) {
        alert('Salary for this month has already been paid. No further actions can be performed until next month.');
        return;
    }

    const amtEl = document.getElementById('sbp-advance-amount');
    const amount = Number(amtEl && amtEl.value);
    if (!amount || amount <= 0) {
        alert('Please enter a valid advance amount.');
        return;
    }

    const list = getAdvanceRecords();
    list.push({
        staffId,
        category,
        amount,
        date: new Date().toISOString(),
        monthKey: getCurrentMonthKey()
    });
    saveAdvanceRecords(list);

    alert(`Advance of RS ${amount.toLocaleString()} recorded.`);

    // Refresh the breakdown panel + the underlying table
    showSalaryBreakdown(staffId, category);
    if (category === 'Teaching') {
        renderTeachingSalaries(document.getElementById('teacher-salary-search').value);
    } else {
        const sEl = document.getElementById('worker-salary-search');
        renderNonTeachingSalaries(sEl ? sEl.value : '');
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

// Expose globally so other pages / settings panels can drive these values.
window.EduFlowFinance = Object.assign(window.EduFlowFinance || {}, {
    setStaffSecurity,
    setStaffFeeDeducted,
    setStaffDeduction,
    getStaffDeductions,
    setAllStaffDeductionDefaults
});
