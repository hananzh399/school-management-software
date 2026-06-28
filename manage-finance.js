/**
 * EDUFLOW PRO - FINANCE LOGIC
 */

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSidebar();
    initDate();
    initAtvVoucherModal();
    renderClassCardGrid();
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

    if (pageId === 'page-student-fees') { renderClassCardGrid(); if (typeof backToClassSelection === 'function') backToClassSelection(); }
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

    // Determine whether the current month's fee voucher has already been paid.
    // If yes, the fine must be deferred to NEXT month's voucher instead of
    // appearing on the already-paid one.
    const currentMonthKey = getCurrentMonthKey();
    const hasPaidThisMonth = Array.isArray(student.feePayments) &&
        student.feePayments.some(p => p.monthKey === currentMonthKey);

    const now = new Date();
    const targetDate = hasPaidThisMonth
        ? new Date(now.getFullYear(), now.getMonth() + 1, 1)
        : now;
    const targetMonthKey = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    const targetPeriodShort = targetDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    const targetPeriodLong  = targetDate.toLocaleDateString('en-GB', { month: 'long',  year: 'numeric' });

    // 1) Log the fine record (shown in View Records of student fines for that month)
    const fines = getStudentFinesData();
    fines.push({
        id: student.id || student.regNo, name: name, className: cls, father: father,
        amount: amount, cause: desc, date: new Date().toLocaleDateString('en-US'),
        monthKey: targetMonthKey
    });
    saveStudentFinesData(fines);

    // 2) Add the fine as a line item in the student's fee voucher (otherFeesData)
    // so it shows up explicitly on the correct month's voucher. We tag it with
    // monthKey so computeFeeBreakdown can hide future-month items from the
    // current voucher. We do NOT touch arrears here.
    let existingFees = [];
    try { existingFees = JSON.parse(student.otherFeesData || '[]'); } catch(e) { existingFees = []; }
    // If voucherCustomFees is not already set, seed the base charges first so they aren't lost
    if (!student.voucherCustomFees) {
        const baseRows = [];
        if (Number(student.standardFee)  > 0) baseRows.push({ description: 'Tuition Fee',        period: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), amount: Number(student.standardFee),  discount: Number(student.tuitionDiscount)   || 0 });
        if (Number(student.transportFee) > 0) baseRows.push({ description: 'Transportation Fee', period: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), amount: Number(student.transportFee), discount: Number(student.transportDiscount) || 0 });
        if (Number(student.admissionFee) > 0) baseRows.push({ description: 'Admission Fee',      period: 'One-time',   amount: Number(student.admissionFee), discount: 0 });
        if (Number(student.otherFee)     > 0) baseRows.push({ description: student.otherFeeLabel || 'Other Charges', period: '-', amount: Number(student.otherFee), discount: 0 });
        if (Number(student.booksFee)     > 0) baseRows.push({ description: 'Books Fee',          period: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), amount: Number(student.booksFee), discount: Number(student.booksDiscount) || 0 });
        existingFees = [...baseRows, ...existingFees];
    }
    existingFees.push({
        description: 'Fine: ' + desc,
        period: targetPeriodShort,
        amount: amount,
        discount: 0,
        monthKey: targetMonthKey
    });
    student.otherFeesData = JSON.stringify(existingFees);
    student.voucherCustomFees = true;
    students[idx] = student;
    localStorage.setItem('edu_students', JSON.stringify(students));

    // 3) Update global finance counters so the DASHBOARD reflects it in real time
    const db = getGlobalData();
    if (!db.students) db.students = {};
    if (!db.students.fines) db.students.fines = { lateFees: 0, other: 0 };
    db.students.fines.other = (Number(db.students.fines.other) || 0) + amount;
    saveGlobalData(db);

    if (hasPaidThisMonth) {
        alert(`Current month already paid. Fine of RS ${amount.toLocaleString()} added to ${name}'s ${targetPeriodLong} voucher.`);
        document.getElementById('student-fine-amount').value = '';
        document.getElementById('student-fine-desc').value = '';
        selectedStudentFineId = null;
        showPage('page-student-fine');
        return;
    }

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
 * Renders the class-card-grid from whatever classes are stored in
 * localStorage under 'edu_class_configs' (written by settings.js).
 * Falls back to the original set of 5 default classes if nothing is saved.
 * Called once on DOMContentLoaded AND again when showPage('page-student-fees')
 * is triggered, so the grid always stays in sync with settings changes.
 */
function renderClassCardGrid() {
    const grid = document.getElementById('class-card-grid');
    if (!grid) return;

    let classes = [];
    try {
        const raw = localStorage.getItem('edu_class_configs');
        if (raw) classes = JSON.parse(raw);
    } catch (e) { classes = []; }

    // Fall back to the same defaults that settings.js uses
    if (!Array.isArray(classes) || classes.length === 0) {
        classes = [
            { name: 'Montessori' },
            { name: 'Nursery' },
            { name: 'Prep' },
            { name: 'Grade 1' },
            { name: 'Grade 2' },
        ];
    }

    grid.innerHTML = classes.map((cls, i) => {
        const name        = (cls.name || 'Class ' + (i + 1)).trim();
        const colorClass  = _CLASS_CARD_COLORS[i % _CLASS_CARD_COLORS.length];
        const iconHTML    = _classCardIcon(name, i);
        const label       = _classDisplayLabel(name);
        // Escape name for inline onclick attribute
        const safeName    = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `<div class="class-selector-card ${colorClass}" onclick="selectClassForFees('${safeName}')">
                    <div class="c-icon">${iconHTML}</div>
                    <h4>${label}</h4>
                </div>`;
    }).join('');
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
let currentVoucherStudentId = null;
let currentVoucherStudentName = null;

function viewVoucher(studentId, fullName, isPaidBill = false) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = findStudentExact(students, studentId, fullName);
    if (!student) {
        alert('Student not found.');
        return;
    }

    currentVoucherStudentId = studentId;
    currentVoucherStudentName = fullName;

    let html = buildVoucherHTML(student);
    const editBtn = document.getElementById('edit-voucher-btn');
    if (isPaidBill) {
        html = '<div style="position:relative;">' + html + '<div class="paid-stamp-overlay">PAID</div></div>';
        if (editBtn) editBtn.style.display = 'none';
    } else {
        if (editBtn) editBtn.style.display = 'inline-block';
    }

    document.getElementById('voucher-render-target').innerHTML = html;
    document.getElementById('voucher-modal-overlay').style.display = 'flex';
}

function openVoucherEditModal() {
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
    // Toggle the share popup near the share button
    let popup = document.getElementById('voucher-share-popup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'voucher-share-popup';
        popup.className = 'voucher-share-popup';
        popup.innerHTML = `
            <div class="share-popup-title"><i class="fas fa-share-nodes"></i> &nbsp;Share Voucher</div>
            <button class="share-popup-item spi-whatsapp" onclick="shareViaWhatsApp()">
                <span class="spi-icon"><i class="fab fa-whatsapp"></i></span>
                <span>Share via WhatsApp</span>
            </button>
            <button class="share-popup-item spi-copy" onclick="shareViaCopyLink()">
                <span class="spi-icon"><i class="fas fa-link"></i></span>
                <span>Copy as Text</span>
            </button>
            <button class="share-popup-item spi-email" onclick="shareViaEmail()">
                <span class="spi-icon"><i class="fas fa-envelope"></i></span>
                <span>Send via Email</span>
            </button>
            <button class="share-popup-item spi-download" onclick="shareViaDownloadImage()">
                <span class="spi-icon"><i class="fas fa-image"></i></span>
                <span>Save as Image</span>
            </button>
        `;
        document.body.appendChild(popup);

        // Close popup when clicking outside
        document.addEventListener('click', function closeSharePopup(e) {
            const btn = document.getElementById('share-voucher-btn');
            if (!popup.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
                popup.classList.remove('open');
            }
        });
    }

    // Position popup near button
    const btn = document.getElementById('share-voucher-btn');
    if (btn) {
        const rect = btn.getBoundingClientRect();
        popup.style.top  = (rect.bottom + 8) + 'px';
        popup.style.left = Math.max(8, rect.left - 40) + 'px';
    }

    popup.classList.toggle('open');
}

function _buildVoucherShareText() {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student  = findStudentExact(students, currentVoucherStudentId, currentVoucherStudentName);
    if (!student) return 'Fee Voucher – ST. LAWRENCE INTERNATIONAL SCHOOL';

    const f         = computeFeeBreakdown(student);
    const today     = new Date();
    const challanNo = `CH-${student.id}-${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}`;

    let text = `🏫 *ST. LAWRENCE INTERNATIONAL SCHOOL*\n`;
    text    += `📄 Fee Voucher — ${f.monthLabel}\n`;
    text    += `──────────────────────\n`;
    text    += `👤 *Student:* ${student.fullName}\n`;
    text    += `🆔 *Reg. No:* ${f.regNo}\n`;
    text    += `📚 *Class:* ${student.studentClass || '—'}\n`;
    text    += `👨‍👩‍👦 *Guardian:* ${student.guardianName || '—'}\n`;
    text    += `──────────────────────\n`;
    text    += `🔢 *Challan No:* ${challanNo}\n`;
    text    += `📅 *Due Date:* ${f.dueDateStr}\n`;
    if (f.lateFineEnabled) {
        text += `⚠️ *Late Fine:* Rs. ${f.lateFeeSurcharge.toLocaleString()} (after ${f.dueDateStr})\n`;
    }
    text    += `──────────────────────\n`;
    text    += `💰 *Net Payable:* Rs. ${f.voucherTotal.toLocaleString()}\n`;
    if (f.lateFineEnabled) {
        text += `💳 *After Due Date:* Rs. ${f.totalAfterDueDate.toLocaleString()}\n`;
    }
    text    += `──────────────────────\n`;
    text    += `_Please pay before the due date to avoid late charges._`;
    return text;
}

function shareViaWhatsApp() {
    const text = _buildVoucherShareText();
    const url  = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
    document.getElementById('voucher-share-popup')?.classList.remove('open');
    _showShareToast('Opening WhatsApp…');
}

function shareViaCopyLink() {
    const text = _buildVoucherShareText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            _showShareToast('<i class="fas fa-check"></i> Voucher text copied!');
        }).catch(() => _fallbackCopy(text));
    } else {
        _fallbackCopy(text);
    }
    document.getElementById('voucher-share-popup')?.classList.remove('open');
}

function _fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); _showShareToast('<i class="fas fa-check"></i> Voucher text copied!'); }
    catch(e) { _showShareToast('Could not copy — please copy manually.'); }
    document.body.removeChild(ta);
}

function shareViaEmail() {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student  = findStudentExact(students, currentVoucherStudentId, currentVoucherStudentName);
    const f        = student ? computeFeeBreakdown(student) : {};
    const subject  = encodeURIComponent(`Fee Voucher – ${student?.fullName || ''} (${f.monthLabel || ''})`);
    const body     = encodeURIComponent(_buildVoucherShareText().replace(/\*/g,'').replace(/_/g,''));
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
    document.getElementById('voucher-share-popup')?.classList.remove('open');
    _showShareToast('Opening email client…');
}

function shareViaDownloadImage() {
    document.getElementById('voucher-share-popup')?.classList.remove('open');

    // Check if html2canvas is available; if not, load it dynamically
    function doCapture() {
        const target = document.getElementById('voucher-render-target');
        if (!target) { _showShareToast('Voucher not found.'); return; }

        // Temporarily hide the School Copy so we only capture the Student Copy
        const copies = target.querySelectorAll('.voucher-copy');
        if (copies[0]) copies[0].style.display = 'none';

        _showShareToast('<i class="fas fa-spinner fa-spin"></i> Generating image…');

        html2canvas(target, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false
        }).then(canvas => {
            if (copies[0]) copies[0].style.display = '';
            const link = document.createElement('a');
            const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
            const student  = findStudentExact(students, currentVoucherStudentId, currentVoucherStudentName);
            link.download = `voucher-${student?.fullName?.replace(/\s+/g,'-') || 'student'}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            _showShareToast('<i class="fas fa-check"></i> Image downloaded!');
        }).catch(() => {
            if (copies[0]) copies[0].style.display = '';
            _showShareToast('Image capture failed. Try Print instead.');
        });
    }

    if (typeof html2canvas !== 'undefined') {
        doCapture();
    } else {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload  = doCapture;
        script.onerror = () => _showShareToast('Could not load image library. Use Print instead.');
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
    // Always use HRK_77-prefixed registration ID for display
    const regNo = s.regNo && String(s.regNo).startsWith('HRK_') ? s.regNo : `HRK_77${String(s.id).padStart(3, '0')}`;

    // If the admin saved a custom voucher (via Edit Voucher), the saved fee
    // rows REPLACE the base charges — otherwise they would be double-counted
    // (once as base charges and again as additional fees).
    const usingCustomVoucher = s.voucherCustomFees === true || s.voucherCustomFees === 'true';

    // --- 1. Core Charges (stored in DB, shown in table) ---
    const tuitionFee   = usingCustomVoucher ? 0 : (Number(s.standardFee)   || 0);
    const transportFee = usingCustomVoucher ? 0 : (Number(s.transportFee)  || 0);
    const admissionFee = usingCustomVoucher ? 0 : (Number(s.admissionFee)  || 0);
    const otherFee     = usingCustomVoucher ? 0 : (Number(s.otherFee)      || 0);
    const otherFeeLabel = s.otherFeeLabel || 'Other Charges';

    // --- 2. Voucher-Only: Books Fee ---
    const booksFeeEnabled = s.takesBooks === true || s.booksFee > 0;
    const booksFee     = usingCustomVoucher ? 0 : (Number(s.booksFee) || 0);
    const booksDiscount= usingCustomVoucher ? 0 : (Number(s.booksDiscount) || 0);
    const booksNet     = Math.max(0, booksFee - booksDiscount);

    // --- 3. Voucher-Only: Additional (Other) Fees ---
    let additionalFees = [];
    try { additionalFees = JSON.parse(s.otherFeesData || '[]'); } catch(e) { additionalFees = []; }
    // Hide line items tagged for a FUTURE month (e.g. a fine added after the
    // current month's voucher was already paid is deferred to next month).
    const __curMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    additionalFees = additionalFees.filter(f => !f.monthKey || f.monthKey <= __curMonthKey);

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
    const bulkVoucherDiscount = Math.max(0, Number(s.voucherBulkDiscount) || 0);
    const voucherTotal = Math.max(0,
        totalWithinDueDate + booksNet + additionalFeesNet + (showAnnualFund ? annualFundAmt : 0) - bulkVoucherDiscount
    );

    // --- 7. Live settings snapshot (reads 'edu_latefee_config' from localStorage) ---
    const vs = getVoucherSettings();

    // Dates — due date is NEXT month's deadline day (from settings)
    // Grace period extends the "no fine" window by vs.graceDays extra days.
    const dueDate    = new Date(today.getFullYear(), today.getMonth() + 1, vs.dueDayOfMonth);
    const expiryDate = new Date(today.getFullYear(), today.getMonth() + 1, vs.expiryDayOfMonth);
    const dueDateStr    = dueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const expiryDateStr = expiryDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const discountDeadline = s.discountExpiry
        ? new Date(s.discountExpiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : dueDateStr;

    // Late Surcharge — uses fixed amount or percentage from live settings.
    // If late fee is disabled in Admin Settings the surcharge is Rs. 0.
    const lateFeeSurcharge = vs.lateFineEnabled
        ? (vs.lateFineFixedAmount > 0
            ? vs.lateFineFixedAmount
            : Math.round(voucherTotal * (vs.lateFinePercent / 100)))
        : 0;
    const totalAfterDueDate = voucherTotal + lateFeeSurcharge;

    // Grace info — surfaced so the voucher HTML can show the right label
    const graceDays       = vs.graceDays;
    const lateFineEnabled = vs.lateFineEnabled;

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
        discountDeadline,
        // Late fee settings (live from Admin Settings)
        graceDays, lateFineEnabled
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
        ${f.tuitionFee > 0 ? `<tr><td>Tuition Fee</td><td>${f.monthLabel}</td><td>Rs. ${f.tuitionFee.toLocaleString()}</td></tr>` : ''}
        ${f.transportFee > 0 ? `<tr><td>Transportation Fee</td><td>${f.monthLabel}</td><td>Rs. ${f.transportFee.toLocaleString()}</td></tr>` : ''}
        ${f.admissionFee > 0 ? `<tr><td>Admission Fee</td><td>One-time</td><td>Rs. ${f.admissionFee.toLocaleString()}</td></tr>` : ''}
        ${f.otherFee > 0 ? `<tr><td>${f.otherFeeLabel}</td><td>-</td><td>Rs. ${f.otherFee.toLocaleString()}</td></tr>` : ''}
    `;

    // ── Voucher-Only: Books Fee ──────────────────────────────────────────────
    // (Books discount, if any, is shown in the unified Discounts Breakdown below.)
    if (f.booksFee > 0) {
        rowsHTML += `<tr><td>Books Fee</td><td>${f.monthLabel}</td><td>Rs. ${f.booksFee.toLocaleString()}</td></tr>`;
    }

    // ── Voucher-Only: Additional Fees ────────────────────────────────────────
    // Per-row discounts are aggregated into the Discounts Breakdown section
    // below instead of being rendered inline under each fee row.
    f.additionalFees.forEach(fee => {
        if (!fee.description && !fee.amount) return;
        rowsHTML += `<tr><td>${fee.description || 'Additional Fee'}</td><td>${f.monthLabel}</td><td>Rs. ${parseFloat(fee.amount||0).toLocaleString()}</td></tr>`;
    });

    // ── Voucher-Only: Annual Fund (only in designated month) ─────────────────
    if (f.showAnnualFund) {
        rowsHTML += `<tr style="background:#fffbeb;"><td><strong>Annual Fund</strong></td><td>Annual (${today.toLocaleDateString('en-GB', { month: 'long' })} only)</td><td>Rs. ${f.annualFundAmt.toLocaleString()}</td></tr>`;
    }

    // ── Unified Discounts Breakdown ─────────────────────────────────────────
    // Collect every discount (form-level concessions, books, per-row edited
    // discounts, and one-time bulk discount) into a single breakdown block
    // so admins can see exactly what was deducted and why.
    const breakdownDiscounts = [];
    if (f.tDisc  > 0) breakdownDiscounts.push({ label: 'Tuition Concession',  amount: f.tDisc  });
    if (f.trDisc > 0) breakdownDiscounts.push({ label: 'Transport Subsidy',   amount: f.trDisc });
    if (f.sibDisc> 0) breakdownDiscounts.push({ label: 'Sibling Discount',    amount: f.sibDisc});
    if (f.booksDiscount > 0) breakdownDiscounts.push({ label: 'Books Discount', amount: f.booksDiscount });
    f.additionalFees.forEach(fee => {
        const d = parseFloat(fee.discount || 0);
        if (d > 0) breakdownDiscounts.push({
            label: `${fee.description || 'Additional Fee'} Discount`,
            amount: d
        });
    });
    const bulkVoucherDisc = Math.max(0, Number(s.voucherBulkDiscount) || 0);
    if (bulkVoucherDisc > 0) breakdownDiscounts.push({ label: 'One-time Voucher Discount', amount: bulkVoucherDisc });

    const breakdownTotal = breakdownDiscounts.reduce((sum, d) => sum + d.amount, 0);
    if (breakdownTotal > 0) {
        rowsHTML += `<tr class="voucher-row-discount"><td colspan="3"><strong>Discounts Breakdown:</strong></td></tr>`;
        breakdownDiscounts.forEach(d => {
            rowsHTML += `<tr class="voucher-row-discount"><td>- ${d.label}</td><td>-</td><td>- Rs. ${d.amount.toLocaleString()}</td></tr>`;
        });
        rowsHTML += `<tr class="voucher-row-discount" style="background:#f0fdf4; border-top:1px solid #bbf7d0">
            <td><strong>Total Discounts</strong></td><td>Valid till ${f.discountDeadline}</td><td><strong>- Rs. ${breakdownTotal.toLocaleString()}</strong></td></tr>`;
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

    const savedNote = (s.voucherNote || '').trim();
    const defaultNote = 'Arrears are included in the Net Payable amount. Please clear all dues.';
    const noteText = savedNote || defaultNote;
    const noteClass = savedNote ? 'voucher-note voucher-note-custom' : 'voucher-note';

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
                <div class="${noteClass}"><i class="fas fa-info-circle"></i> ${escapeHtml(noteText)}</div>
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
        const pendingAmount = Math.max(0, f.voucherTotal - thisMonthPaid);
        const isPaid = pendingAmount <= 0;
        const hasArrears = f.arrears > 0;
        const hasFines = f.monthlyFineTotal > 0;

        const hasPaidThisMonth = payments.some(p => p.monthKey === currentMonthKey);

        let statusBadge = '';
        if (hasPaidThisMonth) {
            statusBadge = `<span class="fee-status-badge fee-paid"><i class="fas fa-check-circle"></i> Paid</span>`;
        } else if (hasArrears) {
            statusBadge = `<span class="fee-status-badge fee-overdue"><i class="fas fa-exclamation-circle"></i> Arrears</span>`;
        } else {
            statusBadge = `<span class="fee-status-badge fee-pending"><i class="fas fa-clock"></i> Pending</span>`;
        }
        // If paid this month, never show arrears badge — it's already settled
        const showArrearsInRow = hasArrears && !hasPaidThisMonth;

        let actionButtons = '';
        if (hasPaidThisMonth) {
            actionButtons = `
                <button class="btn-tiny" onclick="viewVoucher('${s.id}', '${escapeForAttr(s.fullName||'')}', true)">
                    <i class="fas fa-eye"></i> View Paid Bill
                </button>
            `;
        } else {
            actionButtons = `
                <button class="btn-tiny" onclick="viewVoucher('${s.id}', '${escapeForAttr(s.fullName||'')}', false)">
                    <i class="fas fa-eye"></i> View Voucher
                </button>
                <!--<button class="btn-tiny btn-add-to-voucher" onclick="openAddToVoucherModal('${s.id}', '${escapeForAttr(s.fullName||'')}', true)">
                    <i class="fas fa-edit"></i> Edit Voucher
                </button>-->
                <button class="btn-tiny btn-add-fees" onclick="openAddFeesModal('${s.id}', '${escapeForAttr(s.fullName||'')}')">
                    <i class="fas fa-plus-circle"></i> Pay Fee
                </button>
            `;
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
                    ${showArrearsInRow ? `<br><span style="font-size:0.72rem;color:#c2410c;">Arrears: Rs. ${f.arrears.toLocaleString()}</span>` : ''}
                </td>
                <td>${statusBadge}</td>
                <td class="fee-actions-cell">
                    ${actionButtons}
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

function saveSimpleStudentFeePayment() {
    const studentId = document.getElementById('add-fees-student-id').value;
    const method = document.getElementById('af-payment-method').value;
    const notes = document.getElementById('af-fee-notes').value;
    const discount = parseFloat(document.getElementById('afm-pay-discount').value) || 0;
    const paid = parseFloat(document.getElementById('afm-pay-amount').value) || 0;

    if (paid <= 0 && discount <= 0) { alert('Please enter a valid amount or discount.'); return; }

    const monthValue = getCurrentMonthKey();
    const [year, month] = monthValue.split('-');
    const monthLabel = new Date(parseInt(year), parseInt(month) - 1, 1)
        .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    let students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const wantName = afmCurrentStudent ? afmCurrentStudent.fullName : null;
    let idx = -1;
    if (wantName) idx = students.findIndex(s => String(s.id) === String(studentId) && s.fullName === wantName);
    if (idx === -1) idx = students.findIndex(s => String(s.id) === String(studentId));
    if (idx === -1) { alert('Student not found.'); return; }

    if (!students[idx].feePayments) students[idx].feePayments = [];

    // We treat `amount` as the EFFECTIVE coverage (cash paid + admin discount)
    // so that a fee paid e.g. Rs. 4500 + Rs. 500 discount on a Rs. 5000 bill
    // marks the month as fully paid and doesn't roll over to next month's arrears.
    const effective = paid + discount;
    const payment = {
        id: Date.now(),
        monthKey: monthValue,
        monthLabel,
        feeType: "Voucher Payment",
        feeItems: [{ type: 'voucher', label: 'Voucher Payment', amount: paid + discount, discount: discount, net: paid }],
        amount: effective,
        cashPaid: paid,
        grossAmount: paid + discount,
        itemDiscounts: 0,
        bulkDiscount: discount,
        method,
        notes,
        date: new Date().toISOString()
    };

    students[idx].feePayments.push(payment);
    localStorage.setItem('edu_students', JSON.stringify(students));

    showFeeSuccessToast(`Rs. ${paid.toLocaleString()} recorded for ${students[idx].fullName}`);

    closeAddFeesModal();

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
        if (f.tuitionFee > 0)   atvAddFeeRow('tuition',   f.tuitionFee,   f.tDisc);
        if (f.transportFee > 0) atvAddFeeRow('transport', f.transportFee, f.trDisc);
        if (f.booksFee > 0)     atvAddFeeRow('book',      f.booksFee,     f.booksDiscount);
        if (f.admissionFee > 0) atvAddFeeRow('admission', f.admissionFee, 0);
        if (f.otherFee > 0)     atvAddFeeRow('other',     f.otherFee,     0);
        if (f.showAnnualFund)   atvAddFeeRow('annual',    f.annualFundAmt, 0);
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
        const absenceFine = Number(t.fines) || 0;
        const absentDays  = Number(t.absentDaysThisMonth) || 0;
        const fineLabel   = absenceFine > 0
            ? `<span style="color:#ef4444;font-weight:600;">− RS ${absenceFine.toLocaleString()}</span><span style="font-size:10px;color:var(--text-secondary);display:block;">${absentDays}d absent</span>`
            : `<span style="color:var(--text-secondary);font-size:12px;">None</span>`;
        return `
            <tr class="salary-row-clickable" onclick="showSalaryBreakdown('${t.id}', 'Teaching')" title="Click to view salary breakdown">
                <td class="teacher-id-cell">${t.id}</td>
                <td>
                    <div style="font-weight:600;">${t.name}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">${t.email || ''}</div>
                </td>
                <td>${t.subjects || 'General Teacher'}</td>
                <td><strong>RS ${(Number(t.salary) || 0).toLocaleString()}</strong></td>
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
let ievRows = [];   // [{description, period, amount}]

let ievArrears = 0;

function openInlineVoucherEditor(studentId, fullName) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = findStudentExact(students, studentId, fullName);
    if (!student) { alert('Student not found.'); return; }

    ievCurrentStudentId = studentId;
    ievCurrentStudentName = fullName;

    // Build initial rows from current voucher breakdown so the editor mirrors
    // whatever the user just saw in the "View Voucher" modal.
    const f = computeFeeBreakdown(student);
    const rows = [];
    if (f.tuitionFee   > 0) rows.push({ description: 'Tuition Fee',        period: f.monthLabel, amount: f.tuitionFee,   discount: 0 });
    if (f.transportFee > 0) rows.push({ description: 'Transportation Fee', period: f.monthLabel, amount: f.transportFee, discount: 0 });
    if (f.admissionFee > 0) rows.push({ description: 'Admission Fee',      period: 'One-time',   amount: f.admissionFee, discount: 0 });
    if (f.otherFee     > 0) rows.push({ description: f.otherFeeLabel,      period: '-',          amount: f.otherFee,     discount: 0 });
    if (f.booksFee     > 0) rows.push({ description: 'Books Fee',          period: f.monthLabel, amount: f.booksFee,     discount: Number(student.booksDiscount) || 0 });
    (f.additionalFees || []).forEach(fee => {
        if (!fee.description && !fee.amount) return;
        rows.push({
            description: fee.description || 'Additional Fee',
            period: f.monthLabel,
            amount: parseFloat(fee.amount) || 0,
            discount: parseFloat(fee.discount) || 0
        });
    });
    if (f.showAnnualFund) rows.push({ description: 'Annual Fund', period: 'Annual', amount: f.annualFundAmt, discount: 0 });
    if (rows.length === 0) rows.push({ description: '', period: '', amount: 0, discount: 0 });

    ievRows = rows;
    ievArrears = Number(f.arrears) || Number(student.arrears) || 0;

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
    document.getElementById('iev-modal-overlay').style.display = 'flex';
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
    const total = subtotal + (Number(ievArrears) || 0);
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

    if (typeof showFeeSuccessToast === 'function') {
        showFeeSuccessToast(`Voucher updated for ${students[idx].fullName}`);
    }

    closeInlineVoucherEditor();
    // Re-open the read-only voucher with the new values.
    viewVoucher(studentId, fullName);
}

window.openInlineVoucherEditor = openInlineVoucherEditor;
window.closeInlineVoucherEditor = closeInlineVoucherEditor;
window.ievAddRow    = ievAddRow;
window.ievDeleteRow = ievDeleteRow;
window.ievUpdateRow = ievUpdateRow;
window.ievUpdateArrears = ievUpdateArrears;
window.ievSave = ievSave;

