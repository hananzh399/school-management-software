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
   MODALS & FORMS
   ============================================ */
function openModal(id) {
    document.getElementById(id).classList.remove('d-none');
}

function closeModal(id) {
    document.getElementById(id).classList.add('d-none');
}

// 1. Collect Student Fee
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

// 2. Log Student Fine
function handleStudentFineSubmit(e) {
    e.preventDefault();
    const amount = Number(document.getElementById('sfine-amount').value);
    
    const db = getGlobalData();
    db.students.fines.other += amount;
    saveGlobalData(db);

    alert(`Successfully logged student fine of RS ${amount.toLocaleString()}`);
    closeModal('student-fine-modal');
    e.target.reset();
}

// 3. Log Staff Fine
function populateStaffDropdown() {
    const category = document.getElementById('staff-category').value;
    const staffSelect = document.getElementById('staff-member');
    staffSelect.innerHTML = '<option value="">Select Staff Member...</option>';
    
    if (!category) return;
    
    const db = getGlobalData();
    db.staff[category].forEach(s => {
        const option = document.createElement('option');
        option.value = s.id;
        option.textContent = `${s.name} (${s.id})`;
        staffSelect.appendChild(option);
    });
}

function handleStaffFineSubmit(e) {
    e.preventDefault();
    const category = document.getElementById('staff-category').value;
    const staffId = document.getElementById('staff-member').value;
    const amount = Number(document.getElementById('tfine-amount').value);
    
    if (!staffId) {
        alert("Please select a staff member");
        return;
    }

    const db = getGlobalData();
    const staffIndex = db.staff[category].findIndex(s => s.id === staffId);
    
    if (staffIndex > -1) {
        db.staff[category][staffIndex].fines = (Number(db.staff[category][staffIndex].fines) || 0) + amount;
        saveGlobalData(db);
        alert(`Successfully logged RS ${amount.toLocaleString()} fine for ${db.staff[category][staffIndex].name}`);
        closeModal('staff-fine-modal');
        e.target.reset();
        document.getElementById('staff-member').innerHTML = '<option value="">Select Category First...</option>';
    }
}

// 4. Log Operational Expense
function handleExpenseSubmit(e) {
    e.preventDefault();
    const amount = Number(document.getElementById('exp-amount').value);
    
    const db = getGlobalData();
    db.finances.expenses.other += amount;
    saveGlobalData(db);

    alert(`Successfully logged operational expense of RS ${amount.toLocaleString()}`);
    closeModal('expense-modal');
    e.target.reset();
}
