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
    'page-view-expenses'
];

function showPage(pageId) {
    ALL_PAGES.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('d-none');
    });
    const target = document.getElementById(pageId);
    if (target) target.classList.remove('d-none');

    if (pageId === 'page-add-student-fine') populateStudentDropdown();
    if (pageId === 'page-add-staff-fine') {
        selectedStaffCategory = 'Teaching';
        selectedStaffId = null;
        document.getElementById('btn-teaching').classList.add('active');
        document.getElementById('btn-non-teaching').classList.remove('active');
        renderStaffMembersList('Teaching');
    }
    if (pageId === 'page-add-staff-bonus') {
        selectedBonusCategory = 'Teaching';
        selectedBonusStaffId = null;
        document.getElementById('btn-bonus-teaching').classList.add('active');
        document.getElementById('btn-bonus-non-teaching').classList.remove('active');
        renderBonusMembersList('Teaching');
    }
    if (pageId === 'page-view-student-fines') renderStudentFinesTable();
    if (pageId === 'page-view-staff-fines') renderStaffFinesTable();
    if (pageId === 'page-view-staff-bonus') renderStaffBonusTable();
    if (pageId === 'page-view-expenses') renderExpensesTable();
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

function getStudentList() {
    const db = getGlobalData();
    if (db.students && Array.isArray(db.students.records) && db.students.records.length > 0) {
        return db.students.records;
    }
    return [
        { id: 'STU-001', name: 'Ali Hassan',    className: 'Grade 9-A' },
        { id: 'STU-002', name: 'Sara Malik',    className: 'Grade 10-B' },
        { id: 'STU-003', name: 'Usman Ahmed',   className: 'Grade 8-C' },
        { id: 'STU-004', name: 'Fatima Noor',   className: 'Grade 11-A' },
        { id: 'STU-005', name: 'Hamza Raza',    className: 'Grade 7-B' },
    ];
}

function populateStudentDropdown() {
    const select = document.getElementById('student-select');
    select.innerHTML = '<option value="">Select Student...</option>';
    getStudentList().forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} — ${s.className} (${s.id})`;
        select.appendChild(opt);
    });
}

function handleAddStudentFine() {
    const studentId = document.getElementById('student-select').value;
    const amount = Number(document.getElementById('student-fine-amount').value);
    const desc = document.getElementById('student-fine-desc').value.trim();

    if (!studentId) { alert('Please select a student.'); return; }
    if (!amount || amount < 1) { alert('Please enter a valid fine amount.'); return; }
    if (!desc) { alert('Please enter a fine description/cause.'); return; }

    const students = getStudentList();
    const student = students.find(s => s.id === studentId);

    const fines = getStudentFinesData();
    fines.push({
        id: studentId, name: student.name, className: student.className,
        amount: amount, cause: desc, date: new Date().toLocaleDateString('en-US')
    });
    saveStudentFinesData(fines);

    const db = getGlobalData();
    db.students.fines.other += amount;
    saveGlobalData(db);

    alert(`Fine of RS ${amount.toLocaleString()} added to ${student.name}.`);
    document.getElementById('student-select').value = '';
    document.getElementById('student-fine-amount').value = '';
    document.getElementById('student-fine-desc').value = '';
    showPage('page-student-fine');
}

function renderStudentFinesTable() {
    const tbody = document.getElementById('student-fines-tbody');
    const fines = getStudentFinesData();
    if (fines.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No fines recorded yet.</td></tr>';
        return;
    }
    tbody.innerHTML = fines.map(f => `
        <tr>
            <td>${f.name}</td>
            <td>${f.className}</td>
            <td>RS ${Number(f.amount).toLocaleString()}</td>
            <td>${f.cause}</td>
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
    renderStaffMembersList(category);
}

function renderStaffMembersList(category) {
    const container = document.getElementById('staff-members-list');
    const db = getGlobalData();
    const members = db.staff[category] || [];
    if (members.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:14px;">No staff found in this category.</p>';
        return;
    }
    container.innerHTML = members.map(s => {
        const role = category === 'Teaching' ? (s.subjects || 'Teacher') : (s.job || 'Staff');
        return `
        <div class="staff-member-item" id="staff-item-${s.id}" onclick="selectStaffMember('${s.id}')">
            <div class="staff-member-info">
                <span class="staff-member-name">${s.name}</span>
                <span class="staff-member-role">${role} &bull; ${s.id}</span>
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
        id: members[idx].id, name: members[idx].name, role: role,
        category: selectedStaffCategory, amount: amount, cause: desc,
        date: new Date().toLocaleDateString('en-US')
    });
    saveStaffFinesData(finesLog);

    alert(`Fine of RS ${amount.toLocaleString()} added to ${members[idx].name}.`);
    document.getElementById('staff-fine-amount').value = '';
    document.getElementById('staff-fine-desc').value = '';
    showPage('page-staff-fine');
}

function renderStaffFinesTable() {
    const tbody = document.getElementById('staff-fines-tbody');
    const fines = getStaffFinesData();
    if (fines.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No fines recorded yet.</td></tr>';
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
    renderBonusMembersList(category);
}

function renderBonusMembersList(category) {
    const container = document.getElementById('bonus-members-list');
    const db = getGlobalData();
    const members = db.staff[category] || [];
    if (members.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:14px;">No staff found in this category.</p>';
        return;
    }
    container.innerHTML = members.map(s => {
        const role = category === 'Teaching' ? (s.subjects || 'Teacher') : (s.job || 'Staff');
        return `
        <div class="staff-member-item" id="bonus-item-${s.id}" onclick="selectBonusStaff('${s.id}')">
            <div class="staff-member-info">
                <span class="staff-member-name">${s.name}</span>
                <span class="staff-member-role">${role} &bull; ${s.id}</span>
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
        id: members[idx].id, name: members[idx].name, role: role,
        category: selectedBonusCategory, amount: amount, description: desc,
        date: new Date().toLocaleDateString('en-US')
    });
    saveStaffBonusData(log);

    alert(`Bonus of RS ${amount.toLocaleString()} added to ${members[idx].name}.`);
    document.getElementById('staff-bonus-amount').value = '';
    document.getElementById('staff-bonus-desc').value = '';
    showPage('page-staff-bonus');
}

function renderStaffBonusTable() {
    const tbody = document.getElementById('staff-bonus-tbody');
    const log = getStaffBonusData();
    if (log.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No bonuses recorded yet.</td></tr>';
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
    list.push({ description: desc, amount: amount, date: new Date().toLocaleDateString('en-US') });
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
    const list = getExpensesData();
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" class="empty-row">No expenses recorded yet.</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(e => `
        <tr>
            <td>${e.description}</td>
            <td>RS ${Number(e.amount).toLocaleString()}</td>
        </tr>
    `).join('');
}
