/**
 * EDUFLOW PRO - STAFF MANAGEMENT LOGIC
 * Handles: sidebar toggle, counter animation, ripple, date display
 */

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSidebar();
    initDate();
    loadStaffCounts();
});


/* ============================================
   THEME TOGGLE
   ============================================ */
function initTheme() {
    const toggleBtn = document.getElementById('theme-toggle');
    const root = document.documentElement;
    
    // Check local storage for saved theme, default to dark
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

    // Create overlay element for mobile
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
    const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    dateEl.textContent = now.toLocaleDateString('en-US', options);
}



/* ============================================
   STAFF BUCKET SANITIZER
   ============================================ */
function _looksNonTeachingMS(s) {
    if (!s) return false;
    if (s.type === 'Non-Teaching') return true;
    if (s.type === 'Teaching') return false;
    if (s.role || s.job || s.startTime || s.endTime) return true;
    if (s.subjects || s.qualification || s.classes || s.incharge) return false;
    return false;
}
function sanitizeStaffBuckets() {
    const db = getGlobalData();
    if (!db || !db.staff) return;
    const teaching = Array.isArray(db.staff['Teaching']) ? db.staff['Teaching'] : [];
    const nonTeaching = Array.isArray(db.staff['Non-Teaching']) ? db.staff['Non-Teaching'] : [];
    const cleanT = [];
    const cleanNT = [...nonTeaching];
    let changed = false;
    teaching.forEach(s => {
        if (_looksNonTeachingMS(s)) {
            cleanNT.push({ ...s, type: 'Non-Teaching' });
            changed = true;
        } else {
            if (!s.type) changed = true;
            cleanT.push({ ...s, type: s.type || 'Teaching' });
        }
    });
    const stampedNT = cleanNT.map(s => {
        if (!s.type) { changed = true; return { ...s, type: 'Non-Teaching' }; }
        return s;
    });
    if (changed) {
        db.staff['Teaching'] = cleanT;
        db.staff['Non-Teaching'] = stampedNT;
        saveGlobalData(db);
    }
}

/* ============================================
   LOAD & COUNT STAFF
   ============================================ */
function loadStaffCounts(animate = true) {
    // Repair any cross-bucket leakage before counting.
    sanitizeStaffBuckets();
    staffData = getGlobalData().staff;
    const teachingCount = staffData['Teaching'].length;
    const nonTeachingCount = staffData['Non-Teaching'].length;
    const total = teachingCount + nonTeachingCount;

    if (animate) {
        document.getElementById('teaching-count').setAttribute('data-target', teachingCount);
        document.getElementById('nonteaching-count').setAttribute('data-target', nonTeachingCount);
        animateCounter('teaching-count', teachingCount);
        animateCounter('nonteaching-count', nonTeachingCount);
    } else {
        document.getElementById('teaching-count').textContent = teachingCount;
        document.getElementById('nonteaching-count').textContent = nonTeachingCount;
    }

    // Update summary bar
    setTimeout(() => {
        document.getElementById('total-count').textContent = total;
        document.getElementById('summary-teaching').textContent = teachingCount;
        document.getElementById('summary-nonteaching').textContent = nonTeachingCount;
    }, animate ? 400 : 0);
}


/* ============================================
   COUNTER ANIMATION
   ============================================ */
function animateCounter(elementId, target) {
    const el = document.getElementById(elementId);
    if (target === 0) {
        el.textContent = '0';
        return;
    }

    let current = 0;
    const duration = 1200; // ms
    const stepTime = Math.max(Math.floor(duration / target), 30);
    const increment = Math.max(1, Math.floor(target / (duration / stepTime)));

    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            current = target;
            clearInterval(timer);
        }
        el.textContent = current;
    }, stepTime);
}


/* ============================================
   CARD CLICK HANDLER -> SHOW DIRECTORY
   ============================================ */
let currentCategory = '';

function onCardClick(category) {
    currentCategory = category;

    // Create ripple effect
    const cardId = category === 'Teaching' ? 'teaching-card' : 'nonteaching-card';
    const card = document.getElementById(cardId);
    createRipple(card, event);

    setTimeout(() => {
        showDirectoryView(category);
    }, 400);
}

/* ============================================
   VIEW MANAGEMENT
   ============================================ */
function showCardsView() {
    currentCategory = '';
    
    // Ensure counters are up to date when returning to cards view
    loadStaffCounts(false);

    document.querySelector('.page-title-section').classList.remove('d-none');
    document.querySelector('.staff-cards-container').classList.remove('d-none');
    document.getElementById('summary-bar').classList.remove('d-none');
    
    document.getElementById('directory-view').classList.add('d-none');
    document.getElementById('profile-view').classList.add('d-none');
}

function showDirectoryView(category) {
    currentCategory = category;
    document.querySelector('.page-title-section').classList.add('d-none');
    document.querySelector('.staff-cards-container').classList.add('d-none');
    document.getElementById('summary-bar').classList.add('d-none');
    document.getElementById('profile-view').classList.add('d-none');
    
    // Clear search
    document.getElementById('staff-search').value = '';

    const dirView = document.getElementById('directory-view');
    dirView.classList.remove('d-none');
    dirView.classList.add('fade-in');
    
    document.getElementById('directory-title').textContent = `${category} Staff Directory`;

    // Update Add button text based on category
    const addBtn = document.getElementById('add-staff-btn');
    if (addBtn) {
        addBtn.innerHTML = category === 'Teaching'
            ? '<i class="fas fa-plus"></i> Add Teacher'
            : '<i class="fas fa-plus"></i> Add Non-Teaching Staff';
    }

    // Reset animation
    setTimeout(() => dirView.classList.remove('fade-in'), 400);

    populateDirectory(category);
}

/* ============================================
   SAMPLE DATA & TABLE POPULATION
   ============================================ */
// Read from global state instead of local variable
sanitizeStaffBuckets();
let staffData = getGlobalData().staff;

let currentProfileId = null;

function populateDirectory(category, filterText = '') {
    const thead = document.getElementById('directory-thead');
    const tbody = document.getElementById('directory-tbody');
    
    // Set headers
    if (category === 'Teaching') {
        thead.innerHTML = `<tr>
            <th>Teacher ID</th><th>Teacher Name</th><th>Qualification</th>
            <th>Subjects</th><th>Classes</th><th>Class Incharge</th>
        </tr>`;
    } else {
        thead.innerHTML = `<tr>
            <th>Staff ID</th><th>Staff Name</th><th>Job Title</th>
            <th>Start Time</th><th>End Time</th>
        </tr>`;
    }

    tbody.innerHTML = '';
    
    const rawList = staffData[category] || [];
    // Defensive filter: hide cross-bucket records.
    const staffList = rawList.filter(s => {
        const looksNT = _looksNonTeachingMS(s);
        return category === 'Teaching' ? !looksNT : true;
    });
    const lowerFilter = filterText.toLowerCase();

    staffList.forEach(s => {
        // Search Filter
        const searchableText = Object.values(s).join(' ').toLowerCase();
        if (filterText && !searchableText.includes(lowerFilter)) return;

        const tr = document.createElement('tr');
        tr.onclick = () => showProfileView(s.id, category);
        
        if (category === 'Teaching') {
            tr.innerHTML = `
                <td><span class="id-badge">${s.id}</span></td>
                <td class="td-bold">${s.name}</td>
                <td>${s.qualification}</td>
                <td>${s.subjects}</td>
                <td>${s.classes}</td>
                <td>${s.incharge}</td>
            `;
        } else {
            tr.innerHTML = `
                <td><span class="id-badge">${s.id}</span></td>
                <td class="td-bold">${s.name}</td>
                <td>${s.job}</td>
                <td>${s.startTime}</td>
                <td>${s.endTime}</td>
            `;
        }
        tbody.appendChild(tr);
    });
}

function filterDirectory() {
    const val = document.getElementById('staff-search').value;
    populateDirectory(currentCategory, val);
}

/* ============================================
   PROFILE VIEW
   ============================================ */
function showProfileView(staffId, category) {
    const staff = staffData[category].find(s => s.id === staffId);
    if (!staff) return;
    
    currentProfileId = staff.id;

    // Update back button
    const backBtn = document.querySelector('.profile-view .back-btn');
    backBtn.setAttribute('onclick', `showDirectoryView('${category}')`);

    // Hide directory, show profile
    document.getElementById('directory-view').classList.add('d-none');
    const profileView = document.getElementById('profile-view');
    profileView.classList.remove('d-none');
    profileView.classList.add('fade-in');
    
    setTimeout(() => profileView.classList.remove('fade-in'), 400);

    // Get initials
    const nameParts = staff.name.split(' ');
    const initials = nameParts.length > 1 ? nameParts[0][0] + nameParts[1][0] : nameParts[0][0];

    // Populate header
    document.getElementById('profile-initials').textContent = initials.toUpperCase();
    document.getElementById('profile-name').textContent = staff.name;
    document.getElementById('profile-id').textContent = staff.id;
    
    // Populate Grid
    const grid = document.getElementById('profile-details-grid');
    grid.innerHTML = '';

    const createItem = (label, val, fullWidth = false) => {
        return `<div class="detail-item ${fullWidth ? 'full-width' : ''}">
            <span class="detail-label">${label}</span>
            <span class="detail-value">${val}</span>
        </div>`;
    };

    if (category === 'Teaching') {
        grid.innerHTML += createItem('Qualification', staff.qualification);
        grid.innerHTML += createItem('Subjects', staff.subjects);
        grid.innerHTML += createItem('Classes', staff.classes);
        grid.innerHTML += createItem('Class Incharge', staff.incharge);
        grid.innerHTML += createItem('Gender', staff.gender);
        grid.innerHTML += createItem('Salary', formatCurrency(staff.salary));
        grid.innerHTML += createItem('Date Joined', staff.joined);
        grid.innerHTML += createItem('CNIC', staff.cnic);
        grid.innerHTML += createItem('Phone Number', staff.phone);
        grid.innerHTML += createItem('Address', staff.address, true);
        grid.innerHTML += buildSecurityHTML(staff);
    } else {
        grid.innerHTML += createItem('Job Title', staff.job);
        grid.innerHTML += createItem('Gender', staff.gender);
        grid.innerHTML += createItem('Salary', formatCurrency(staff.salary));
        grid.innerHTML += createItem('Start Time', staff.startTime);
        grid.innerHTML += createItem('End Time', staff.endTime);
        grid.innerHTML += createItem('CNIC', staff.cnic);
        grid.innerHTML += createItem('Phone Number', staff.phone);
        grid.innerHTML += createItem('Address', staff.address, true);
        grid.innerHTML += buildSecurityHTML(staff);
    }
}

/* ============================================
   REMOVE ACTIONS
   ============================================ */
function confirmRemove() {
    const staff = staffData[currentCategory].find(s => s.id === currentProfileId);
    if (!staff) return;
    
    // Update modal title based on category
    const modalTitle = document.getElementById('confirm-modal-title');
    if (currentCategory === 'Teaching') {
        modalTitle.textContent = 'Remove Teacher';
    } else {
        modalTitle.textContent = 'Remove Non-Teaching Staff';
    }

    document.getElementById('remove-target-name').textContent = staff.name;
    document.getElementById('confirm-modal').classList.remove('d-none');
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').classList.add('d-none');
}

function executeRemove() {
    // Remove from array
    staffData[currentCategory] = staffData[currentCategory].filter(s => s.id !== currentProfileId);
    
    // Save to global state
    const db = getGlobalData();
    db.staff = staffData;
    saveGlobalData(db);

    // Update counts silently
    loadStaffCounts(false);

    closeConfirmModal();
    // Go back to directory
    showDirectoryView(currentCategory);
}


/* ============================================
   RIPPLE EFFECT
   ============================================ */
function createRipple(card, e) {
    // Remove any existing ripple
    const existingRipple = card.querySelector('.ripple');
    if (existingRipple) existingRipple.remove();

    const ripple = document.createElement('span');
    ripple.className = 'ripple';

    const rect = card.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;

    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';

    card.appendChild(ripple);

    // Clean up after animation
    ripple.addEventListener('animationend', () => ripple.remove());
}

/* ============================================
   ADD / EDIT FORMS LOGIC
   ============================================ */
let isEditMode = false;

function renderFormFields(category) {
    const grid = document.getElementById('form-dynamic-fields');
    grid.innerHTML = '';

    const createInput = (id, label, type='text', fullWidth=false, required=true) => {
        return `
            <div class="form-group ${fullWidth ? 'full-width' : ''}">
                <label for="${id}">${label}</label>
                <input type="${type}" id="${id}" name="${id}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0"' : ''}>
            </div>
        `;
    };

    if (category === 'Teaching') {
        grid.innerHTML += createInput('f-name', 'Teacher Name');
        grid.innerHTML += createInput('f-qualification', 'Qualification');
        grid.innerHTML += createInput('f-subjects', 'Subjects');
        grid.innerHTML += createInput('f-classes', 'Classes');
        grid.innerHTML += createInput('f-incharge', 'Class Incharge');
        grid.innerHTML += `
            <div class="form-group">
                <label for="f-gender">Gender</label>
                <select id="f-gender" name="f-gender">
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                </select>
            </div>
        `;
        grid.innerHTML += createInput('f-salary', 'Salary');
        grid.innerHTML += createInput('f-joined', 'Date Joined');
        grid.innerHTML += createInput('f-cnic', 'CNIC');
        grid.innerHTML += createInput('f-phone', 'Phone Number');
        grid.innerHTML += createInput('f-address', 'Address', 'text', true);
        grid.innerHTML += `
            <div class="form-group security-section-divider full-width">
                <div class="security-divider-label"><i class="fas fa-shield-alt"></i> Security Deposit (Optional)</div>
            </div>
        `;
        grid.innerHTML += createInput('f-security-total', 'Total Security Amount (PKR)', 'number', false, false);
        grid.innerHTML += createInput('f-security-monthly', 'Monthly Deduction (PKR)', 'number', false, false);
    } else {
        grid.innerHTML += createInput('f-name', 'Staff Name');
        grid.innerHTML += createInput('f-job', 'Job Title');
        grid.innerHTML += createInput('f-startTime', 'Start Time');
        grid.innerHTML += createInput('f-endTime', 'End Time');
        grid.innerHTML += `
            <div class="form-group">
                <label for="f-gender">Gender</label>
                <select id="f-gender" name="f-gender">
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                </select>
            </div>
        `;
        grid.innerHTML += createInput('f-salary', 'Salary');
        grid.innerHTML += createInput('f-cnic', 'CNIC');
        grid.innerHTML += createInput('f-phone', 'Phone Number');
        grid.innerHTML += createInput('f-address', 'Address', 'text', true);
        grid.innerHTML += `
            <div class="form-group security-section-divider full-width">
                <div class="security-divider-label"><i class="fas fa-shield-alt"></i> Security Deposit (Optional)</div>
            </div>
        `;
        grid.innerHTML += createInput('f-security-total', 'Total Security Amount (PKR)', 'number', false, false);
        grid.innerHTML += createInput('f-security-monthly', 'Monthly Deduction (PKR)', 'number', false, false);
    }
}

function openAddForm() {
    isEditMode = false;
    const title = currentCategory === 'Teaching' ? 'Add Teacher' : 'Add Non-Teaching Staff';
    document.getElementById('form-modal-title').textContent = title;
    renderFormFields(currentCategory);
    document.getElementById('staff-form').reset();
    document.getElementById('form-modal').classList.remove('d-none');
}

function openEditForm() {
    isEditMode = true;
    const title = currentCategory === 'Teaching' ? 'Edit Teacher' : 'Edit Non-Teaching Staff';
    document.getElementById('form-modal-title').textContent = title;
    renderFormFields(currentCategory);
    
    // Prefill data
    const staff = staffData[currentCategory].find(s => s.id === currentProfileId);
    if (!staff) return;

    document.getElementById('f-name').value = staff.name;
    document.getElementById('f-gender').value = staff.gender;
    document.getElementById('f-salary').value = staff.salary;
    document.getElementById('f-phone').value = staff.phone;
    document.getElementById('f-address').value = staff.address;

    if (currentCategory === 'Teaching') {
        document.getElementById('f-qualification').value = staff.qualification;
        document.getElementById('f-subjects').value = staff.subjects;
        document.getElementById('f-classes').value = staff.classes;
        document.getElementById('f-incharge').value = staff.incharge;
        document.getElementById('f-joined').value = staff.joined;
        document.getElementById('f-cnic').value = staff.cnic;
    } else {
        document.getElementById('f-job').value = staff.job;
        document.getElementById('f-startTime').value = staff.startTime;
        document.getElementById('f-endTime').value = staff.endTime;
        document.getElementById('f-cnic').value = staff.cnic;
    }

    // Prefill security deposit
    if (staff.securityTotal) document.getElementById('f-security-total').value = staff.securityTotal;
    if (staff.securityMonthly) document.getElementById('f-security-monthly').value = staff.securityMonthly;

    document.getElementById('form-modal').classList.remove('d-none');
}

function closeFormModal() {
    document.getElementById('form-modal').classList.add('d-none');
}

function handleFormSubmit(e) {
    e.preventDefault();

    let newData = {
        name: document.getElementById('f-name').value,
        gender: document.getElementById('f-gender').value,
        salary: document.getElementById('f-salary').value,
        phone: document.getElementById('f-phone').value,
        address: document.getElementById('f-address').value
    };

    // Security deposit fields
    const secTotal = parseFloat(document.getElementById('f-security-total').value) || 0;
    const secMonthly = parseFloat(document.getElementById('f-security-monthly').value) || 0;
    if (secTotal > 0) {
        newData.securityTotal = secTotal;
        newData.securityMonthly = secMonthly > 0 ? secMonthly : 0;
        // In edit mode keep existing collected amount; in add mode start at 0
        if (!isEditMode) {
            newData.securityCollected = 0;
        }
    } else {
        newData.securityTotal = 0;
        newData.securityMonthly = 0;
        if (!isEditMode) {
            newData.securityCollected = 0;
        }
    }

    if (currentCategory === 'Teaching') {
        newData.qualification = document.getElementById('f-qualification').value;
        newData.subjects = document.getElementById('f-subjects').value;
        newData.classes = document.getElementById('f-classes').value;
        newData.incharge = document.getElementById('f-incharge').value;
        newData.joined = document.getElementById('f-joined').value;
        newData.cnic = document.getElementById('f-cnic').value;
    } else {
        newData.job = document.getElementById('f-job').value;
        newData.startTime = document.getElementById('f-startTime').value;
        newData.endTime = document.getElementById('f-endTime').value;
        newData.cnic = document.getElementById('f-cnic').value;
    }

    if (isEditMode) {
        // Update existing — preserve securityCollected from existing record
        let index = staffData[currentCategory].findIndex(s => s.id === currentProfileId);
        if (index > -1) {
            const existing = staffData[currentCategory][index];
            newData.securityCollected = existing.securityCollected || 0;
            staffData[currentCategory][index] = { ...existing, ...newData };
        }
        // Update profile view text
        showProfileView(currentProfileId, currentCategory);
    } else {
        // Add new
        const prefix = currentCategory === 'Teaching' ? 'TCH-' : 'NTS-';
        newData.id = prefix + Math.floor(1000 + Math.random() * 9000);
        newData.fines = 0;
        newData.type = currentCategory; // tag for bucket integrity
        staffData[currentCategory].push(newData);
    }

    // Save to global state
    const db = getGlobalData();
    db.staff = staffData;
    saveGlobalData(db);

    // Refresh directory table and update counts silently
    populateDirectory(currentCategory);
    loadStaffCounts(false);
    closeFormModal();
}


/* ============================================
   SECURITY DEPOSIT HELPERS
   ============================================ */

/**
 * Format a number as PKR currency string.
 */
function formatCurrency(val) {
    const n = parseFloat(val);
    if (isNaN(n)) return val || '—';
    return 'PKR ' + n.toLocaleString('en-PK');
}

/**
 * Calculate security deposit status for a staff member.
 * Returns { total, monthly, collected, remaining, monthsLeft, isDone }
 */
function getSecurityStatus(staff) {
    const total     = parseFloat(staff.securityTotal)    || 0;
    const monthly   = parseFloat(staff.securityMonthly)  || 0;
    const collected = parseFloat(staff.securityCollected)|| 0;
    const remaining = Math.max(0, total - collected);
    const isDone    = total > 0 && collected >= total;
    const monthsLeft = (monthly > 0 && !isDone) ? Math.ceil(remaining / monthly) : 0;
    return { total, monthly, collected, remaining, monthsLeft, isDone };
}

/**
 * Build the security deposit HTML block for the profile view.
 */
function buildSecurityHTML(staff) {
    const s = getSecurityStatus(staff);

    // No security configured
    if (s.total === 0) {
        return `
        <div class="security-block full-width">
            <div class="security-header">
                <i class="fas fa-shield-alt"></i>
                <span>Security Deposit</span>
            </div>
            <p class="security-none">No security deposit configured for this staff member.</p>
        </div>`;
    }

    const pct = Math.min(100, Math.round((s.collected / s.total) * 100));
    const statusClass = s.isDone ? 'status-done' : 'status-active';
    const statusText  = s.isDone ? 'Fully Collected' : 'In Progress';
    const netSalary   = parseFloat(staff.salary) - (s.isDone ? 0 : s.monthly);

    return `
    <div class="security-block full-width">
        <div class="security-header">
            <i class="fas fa-shield-alt"></i>
            <span>Security Deposit</span>
            <span class="security-status-badge ${statusClass}">${statusText}</span>
        </div>

        <div class="security-stats-grid">
            <div class="sec-stat">
                <span class="sec-stat-label">Total Security</span>
                <span class="sec-stat-value">${formatCurrency(s.total)}</span>
            </div>
            <div class="sec-stat">
                <span class="sec-stat-label">Monthly Deduction</span>
                <span class="sec-stat-value deduction">${s.isDone ? '—' : formatCurrency(s.monthly)}</span>
            </div>
            <div class="sec-stat">
                <span class="sec-stat-label">Amount Collected</span>
                <span class="sec-stat-value collected">${formatCurrency(s.collected)}</span>
            </div>
            <div class="sec-stat">
                <span class="sec-stat-label">Remaining</span>
                <span class="sec-stat-value remaining">${s.isDone ? 'PKR 0' : formatCurrency(s.remaining)}</span>
            </div>
            <div class="sec-stat">
                <span class="sec-stat-label">Gross Salary</span>
                <span class="sec-stat-value">${formatCurrency(staff.salary)}</span>
            </div>
            <div class="sec-stat">
                <span class="sec-stat-label">Net Salary (This Month)</span>
                <span class="sec-stat-value net-salary">${formatCurrency(netSalary)}</span>
            </div>
        </div>

        <div class="security-progress-wrap">
            <div class="security-progress-labels">
                <span>Collection Progress</span>
                <span>${pct}% collected${!s.isDone ? ` · ~${s.monthsLeft} month${s.monthsLeft !== 1 ? 's' : ''} left` : ''}</span>
            </div>
            <div class="security-progress-bar">
                <div class="security-progress-fill ${s.isDone ? 'progress-done' : ''}" style="width:${pct}%"></div>
            </div>
        </div>

        ${!s.isDone ? `
        <button class="btn btn-deduct-month" onclick="deductSecurityMonth('${staff.id}')">
            <i class="fas fa-calendar-check"></i> Apply This Month's Deduction (${formatCurrency(s.monthly)})
        </button>` : `
        <div class="security-complete-notice">
            <i class="fas fa-check-circle"></i> Security deposit fully collected — no further deductions.
        </div>`}
    </div>`;
}

/**
 * Apply one month's security deduction for a staff member.
 */
function deductSecurityMonth(staffId) {
    const idx = staffData[currentCategory].findIndex(s => s.id === staffId);
    if (idx === -1) return;

    const staff = staffData[currentCategory][idx];
    const s = getSecurityStatus(staff);
    if (s.isDone || s.monthly <= 0) return;

    // Deduct — don't exceed total
    const deductAmount = Math.min(s.monthly, s.remaining);
    staffData[currentCategory][idx].securityCollected = (s.collected + deductAmount);

    // Persist
    const db = getGlobalData();
    db.staff = staffData;
    saveGlobalData(db);

    // Refresh profile
    showProfileView(staffId, currentCategory);
}


/* ============================================================
   ============================================================
   EXTENSIONS: Photo upload, CNIC 13 blocks, Class-Section
   incharge picker (sourced from settings), avatar in profile
   & directory rows. Defined LAST so they override earlier
   declarations of the same function names.
   ============================================================
   ============================================================ */

/* ---- Read classes (with sections) from settings storage ---- */
function getSettingsClasses() {
    // Primary source: settings.js localStorage key
    try {
        const raw = localStorage.getItem('edu_class_configs');
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                return arr.map(c => ({
                    name: c.name || c.className || c.class || '',
                    sections: Array.isArray(c.sections) ? c.sections.filter(Boolean) : []
                })).filter(c => c.name);
            }
        }
    } catch (e) { /* ignore */ }

    // Fallback: shared global data
    try {
        const db = (typeof getGlobalData === 'function') ? getGlobalData() : {};
        const settings = db.settings || {};
        const src = settings.classes || settings.classConfigs || db.classes || [];
        if (Array.isArray(src)) {
            return src.map(c => {
                if (typeof c === 'string') return { name: c, sections: [] };
                return {
                    name: c.name || c.className || '',
                    sections: Array.isArray(c.sections) ? c.sections : []
                };
            }).filter(c => c.name);
        }
    } catch (e) { /* ignore */ }

    return [];
}

/* ---- CNIC single input with auto-formatting (xxxxx-xxxxxxx-x) ---- */
function formatCnic(digits) {
    digits = String(digits || '').replace(/\D/g, '').slice(0, 13);
    if (digits.length <= 5) return digits;
    if (digits.length <= 12) return digits.slice(0, 5) + '-' + digits.slice(5);
    return digits.slice(0, 5) + '-' + digits.slice(5, 12) + '-' + digits.slice(12);
}
function buildCnicField(idPrefix, existing = '') {
    const val = formatCnic(existing);
    return `
        <input type="text" id="${idPrefix}" class="cnic-input"
               placeholder="xxxxx-xxxxxxx-x"
               maxlength="15"
               inputmode="numeric"
               autocomplete="off"
               value="${val}">
        <div class="cnic-hint">Format: 13 digits — auto-adds dashes</div>`;
}
function wireCnicField(idPrefix) {
    const inp = document.getElementById(idPrefix);
    if (!inp) return;
    inp.addEventListener('input', () => {
        const pos = inp.selectionStart;
        const before = inp.value;
        const formatted = formatCnic(before);
        inp.value = formatted;
        // best-effort caret restore
        const diff = formatted.length - before.length;
        try { inp.setSelectionRange(pos + diff, pos + diff); } catch (e) {}
    });
}
function readCnicField(idPrefix) {
    const inp = document.getElementById(idPrefix);
    if (!inp) return '';
    return formatCnic(inp.value);
}

/* ---- Photo upload helpers ---- */
let _pendingPhoto = '';
function buildPhotoField(existing = '') {
    _pendingPhoto = existing || '';
    const inner = existing
        ? `<img src="${existing}" alt="Staff photo">`
        : `<i class="fas fa-user"></i>`;
    return `
    <div class="form-group full-width photo-upload-group">
        <div class="photo-upload-preview" id="f-photo-preview">${inner}</div>
        <div class="photo-upload-actions">
            <label for="f-photo" class="btn-photo-pick"><i class="fas fa-camera"></i> Choose Photo</label>
            <input type="file" id="f-photo" accept="image/*">
            <button type="button" class="btn-photo-remove" onclick="clearStaffPhoto()"><i class="fas fa-times"></i> Remove</button>
        </div>
    </div>`;
}
function wirePhotoField() {
    const input = document.getElementById('f-photo');
    if (!input) return;
    input.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            _pendingPhoto = ev.target.result;
            const prev = document.getElementById('f-photo-preview');
            prev.innerHTML = `<img src="${_pendingPhoto}" alt="Staff photo">`;
        };
        reader.readAsDataURL(file);
    });
}
function clearStaffPhoto() {
    _pendingPhoto = '';
    const prev = document.getElementById('f-photo-preview');
    if (prev) prev.innerHTML = '<i class="fas fa-user"></i>';
    const input = document.getElementById('f-photo');
    if (input) input.value = '';
}

/* ---- Smart Class Incharge Dropdown Picker ---- */

/**
 * Holds the current incharge assignments as an array of { cls, section } objects.
 * section is '' when the class has no sections.
 */
let _inchargeAssignments = [];

function buildInchargePicker(existing = '') {
    const classes = getSettingsClasses();

    // Parse existing value back to assignment objects
    // Format stored: "Grade 2 - A, Grade 3 - B" or "Prep" (no section)
    _inchargeAssignments = [];
    if (existing) {
        String(existing).split(',').map(s => s.trim()).filter(Boolean).forEach(val => {
            const dashIdx = val.lastIndexOf(' - ');
            if (dashIdx !== -1) {
                const cls = val.slice(0, dashIdx).trim();
                const sec = val.slice(dashIdx + 3).trim();
                // Only add if the class still exists in settings
                if (classes.find(c => c.name === cls)) {
                    _inchargeAssignments.push({ cls, section: sec });
                }
            } else {
                if (classes.find(c => c.name === val)) {
                    _inchargeAssignments.push({ cls: val, section: '' });
                }
            }
        });
    }

    const noClassMsg = !classes.length
        ? '<span class="incharge-no-assignment">No classes defined in Settings yet.</span>'
        : '';

    return `
    <div class="form-group full-width" id="f-incharge-group">
        <label>Class Incharge</label>
        <div class="incharge-smart-wrap" id="f-incharge-smart">
            ${noClassMsg}
            ${classes.length ? `
            <div class="incharge-select-row">
                <div>
                    <span class="incharge-select-label">Class</span>
                    <select id="f-incharge-cls-sel" onchange="onInchargeClassChange()">
                        <option value="">— Select Class —</option>
                        ${classes.map(c => `<option value="${c.name.replace(/"/g,'&quot;')}">${c.name}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <span class="incharge-select-label">Section</span>
                    <select id="f-incharge-sec-sel" disabled>
                        <option value="">— Select Class first —</option>
                    </select>
                </div>
            </div>
            <button type="button" class="incharge-add-btn" onclick="addInchargeAssignment()">
                <i class="fas fa-plus"></i> Assign
            </button>
            ` : ''}
            <div class="incharge-assignment-display" id="f-incharge-chips">
                ${_renderInchargeChips()}
            </div>
        </div>
    </div>`;
}

function _renderInchargeChips() {
    if (!_inchargeAssignments.length) {
        return '<span class="incharge-no-assignment">No class assigned yet.</span>';
    }
    return _inchargeAssignments.map((a, i) => {
        const label = a.section ? `${a.cls} — Section ${a.section}` : a.cls;
        return `<span class="incharge-chip">
            ${label}
            <button type="button" class="incharge-chip-remove" onclick="removeInchargeAssignment(${i})" title="Remove">
                <i class="fas fa-times"></i>
            </button>
        </span>`;
    }).join('');
}

function _refreshInchargeChips() {
    const el = document.getElementById('f-incharge-chips');
    if (el) el.innerHTML = _renderInchargeChips();
}

function onInchargeClassChange() {
    const clsSel = document.getElementById('f-incharge-cls-sel');
    const secSel = document.getElementById('f-incharge-sec-sel');
    if (!clsSel || !secSel) return;

    const chosenClass = clsSel.value;
    if (!chosenClass) {
        secSel.innerHTML = '<option value="">— Select Class first —</option>';
        secSel.disabled = true;
        return;
    }

    const classes = getSettingsClasses();
    const cfg = classes.find(c => c.name === chosenClass);
    const sections = (cfg && Array.isArray(cfg.sections)) ? cfg.sections.filter(Boolean) : [];

    if (!sections.length) {
        // No sections for this class — disable section dropdown, set to none
        secSel.innerHTML = '<option value="">No sections</option>';
        secSel.disabled = true;
    } else {
        secSel.innerHTML = '<option value="">— Select Section —</option>' +
            sections.map(s => `<option value="${s}">Section ${s}</option>`).join('');
        secSel.disabled = false;
    }
}

function addInchargeAssignment() {
    const clsSel = document.getElementById('f-incharge-cls-sel');
    const secSel = document.getElementById('f-incharge-sec-sel');
    if (!clsSel) return;

    const cls = clsSel.value;
    if (!cls) {
        clsSel.focus();
        return;
    }

    const classes = getSettingsClasses();
    const cfg = classes.find(c => c.name === cls);
    const hasSections = cfg && Array.isArray(cfg.sections) && cfg.sections.filter(Boolean).length > 0;

    let section = '';
    if (hasSections) {
        section = secSel ? secSel.value : '';
        if (!section) {
            if (secSel) secSel.focus();
            return;
        }
    }

    // Avoid exact duplicates
    const exists = _inchargeAssignments.some(a => a.cls === cls && a.section === section);
    if (!exists) {
        _inchargeAssignments.push({ cls, section });
        _refreshInchargeChips();
    }

    // Reset dropdowns
    clsSel.value = '';
    if (secSel) { secSel.innerHTML = '<option value="">— Select Class first —</option>'; secSel.disabled = true; }
}

function removeInchargeAssignment(idx) {
    _inchargeAssignments.splice(idx, 1);
    _refreshInchargeChips();
}

function wireInchargePicker() {
    // No extra wiring needed — all events are inline
}

function readInchargePicker() {
    return _inchargeAssignments.map(a => a.section ? `${a.cls} - ${a.section}` : a.cls).join(', ');
}

/* ---- OVERRIDE: renderFormFields ---- */
function renderFormFields(category) {
    const grid = document.getElementById('form-dynamic-fields');
    grid.innerHTML = '';

    const createInput = (id, label, type='text', fullWidth=false, required=true) => `
        <div class="form-group ${fullWidth ? 'full-width' : ''}">
            <label for="${id}">${label}</label>
            <input type="${type}" id="${id}" name="${id}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0"' : ''}>
        </div>`;

    // Photo first (both categories)
    grid.innerHTML += buildPhotoField('');

    if (category === 'Teaching') {
        grid.innerHTML += createInput('f-name', 'Teacher Name');
        grid.innerHTML += createInput('f-qualification', 'Qualification');
        grid.innerHTML += createInput('f-subjects', 'Subjects');
        grid.innerHTML += createInput('f-classes', 'Classes');
        grid.innerHTML += buildInchargePicker('');
        grid.innerHTML += `
            <div class="form-group">
                <label for="f-gender">Gender</label>
                <select id="f-gender" name="f-gender">
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                </select>
            </div>`;
        grid.innerHTML += createInput('f-salary', 'Salary', 'number');
        grid.innerHTML += createInput('f-joined', 'Date Joined', 'date');
        grid.innerHTML += `
            <div class="form-group full-width">
                <label for="f-cnic">CNIC (Pakistani 13-digit)</label>
                ${buildCnicField('f-cnic')}
            </div>`;
        grid.innerHTML += createInput('f-phone', 'Phone Number');
        grid.innerHTML += createInput('f-address', 'Address', 'text', true);
    } else {
        grid.innerHTML += createInput('f-name', 'Staff Name');
        grid.innerHTML += createInput('f-job', 'Job Title');
        grid.innerHTML += createInput('f-startTime', 'Start Time', 'time');
        grid.innerHTML += createInput('f-endTime', 'End Time', 'time');
        grid.innerHTML += `
            <div class="form-group">
                <label for="f-gender">Gender</label>
                <select id="f-gender" name="f-gender">
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                </select>
            </div>`;
        grid.innerHTML += createInput('f-salary', 'Salary', 'number');
        grid.innerHTML += `
            <div class="form-group full-width">
                <label for="f-cnic">CNIC (Pakistani 13-digit)</label>
                ${buildCnicField('f-cnic')}
            </div>`;
        grid.innerHTML += createInput('f-phone', 'Phone Number');
        grid.innerHTML += createInput('f-address', 'Address', 'text', true);
    }

    // Security deposit section (unchanged)
    grid.innerHTML += `
        <div class="form-group security-section-divider full-width">
            <div class="security-divider-label"><i class="fas fa-shield-alt"></i> Security Deposit (Optional)</div>
        </div>`;
    grid.innerHTML += createInput('f-security-total', 'Total Security Amount (PKR)', 'number', false, false);
    grid.innerHTML += createInput('f-security-monthly', 'Monthly Deduction (PKR)', 'number', false, false);

    // Wire dynamic widgets
    wirePhotoField();
    wireCnicField('f-cnic');
    wireInchargePicker();
}

/* ---- OVERRIDE: openEditForm to prefill new widgets ---- */
function openEditForm() {
    isEditMode = true;
    const title = currentCategory === 'Teaching' ? 'Edit Teacher' : 'Edit Non-Teaching Staff';
    document.getElementById('form-modal-title').textContent = title;
    renderFormFields(currentCategory);

    const staff = staffData[currentCategory].find(s => s.id === currentProfileId);
    if (!staff) return;

    // Photo
    if (staff.photo) {
        _pendingPhoto = staff.photo;
        const prev = document.getElementById('f-photo-preview');
        if (prev) prev.innerHTML = `<img src="${staff.photo}" alt="Staff photo">`;
    }

    // CNIC single input
    const cnicInput = document.getElementById('f-cnic');
    if (cnicInput) cnicInput.value = formatCnic(staff.cnic || '');

    // Common
    document.getElementById('f-name').value = staff.name || '';
    document.getElementById('f-gender').value = staff.gender || 'Male';
    document.getElementById('f-salary').value = staff.salary || '';
    document.getElementById('f-phone').value = staff.phone || '';
    document.getElementById('f-address').value = staff.address || '';

    if (currentCategory === 'Teaching') {
        document.getElementById('f-qualification').value = staff.qualification || '';
        document.getElementById('f-subjects').value = staff.subjects || '';
        document.getElementById('f-classes').value = staff.classes || '';
        document.getElementById('f-joined').value = staff.joined || '';

        // Incharge - re-render the picker with prefilled selections
        const pickerWrap = document.getElementById('f-incharge-picker');
        if (pickerWrap && pickerWrap.parentElement) {
            const formGroup = pickerWrap.parentElement;
            const tmp = document.createElement('div');
            tmp.innerHTML = buildInchargePicker(staff.incharge || '');
            const fresh = tmp.firstElementChild;
            formGroup.replaceWith(fresh);
            wireInchargePicker();
        }
    } else {
        document.getElementById('f-job').value = staff.job || '';
        document.getElementById('f-startTime').value = staff.startTime || '';
        document.getElementById('f-endTime').value = staff.endTime || '';
    }

    if (staff.securityTotal) document.getElementById('f-security-total').value = staff.securityTotal;
    if (staff.securityMonthly) document.getElementById('f-security-monthly').value = staff.securityMonthly;

    document.getElementById('form-modal').classList.remove('d-none');
}

/* ---- OVERRIDE: openAddForm to reset photo state ---- */
function openAddForm() {
    isEditMode = false;
    _pendingPhoto = '';
    const title = currentCategory === 'Teaching' ? 'Add Teacher' : 'Add Non-Teaching Staff';
    document.getElementById('form-modal-title').textContent = title;
    renderFormFields(currentCategory);
    document.getElementById('staff-form').reset();
    document.getElementById('form-modal').classList.remove('d-none');
}

/* ---- OVERRIDE: handleFormSubmit to include photo, CNIC blocks, incharge picker ---- */
function handleFormSubmit(e) {
    e.preventDefault();

    let newData = {
        name: document.getElementById('f-name').value,
        gender: document.getElementById('f-gender').value,
        salary: document.getElementById('f-salary').value,
        phone: document.getElementById('f-phone').value,
        address: document.getElementById('f-address').value,
        photo: _pendingPhoto || '',
        cnic: readCnicField('f-cnic')
    };

    const secTotal = parseFloat(document.getElementById('f-security-total').value) || 0;
    const secMonthly = parseFloat(document.getElementById('f-security-monthly').value) || 0;
    if (secTotal > 0) {
        newData.securityTotal = secTotal;
        newData.securityMonthly = secMonthly > 0 ? secMonthly : 0;
        if (!isEditMode) newData.securityCollected = 0;
    } else {
        newData.securityTotal = 0;
        newData.securityMonthly = 0;
        if (!isEditMode) newData.securityCollected = 0;
    }

    if (currentCategory === 'Teaching') {
        newData.qualification = document.getElementById('f-qualification').value;
        newData.subjects = document.getElementById('f-subjects').value;
        newData.classes = document.getElementById('f-classes').value;
        newData.incharge = readInchargePicker();
        newData.joined = document.getElementById('f-joined').value;
        // Save first assignment as assignedClass/assignedSection for student management integration
        if (_inchargeAssignments.length > 0) {
            newData.assignedClass   = _inchargeAssignments[0].cls;
            newData.assignedSection = _inchargeAssignments[0].section || '';
        } else {
            newData.assignedClass   = '';
            newData.assignedSection = '';
        }
        // Store full list as JSON for multi-class teachers
        newData.inchargeAssignments = JSON.stringify(_inchargeAssignments);
    } else {
        newData.job = document.getElementById('f-job').value;
        newData.startTime = document.getElementById('f-startTime').value;
        newData.endTime = document.getElementById('f-endTime').value;
    }

    if (isEditMode) {
        let index = staffData[currentCategory].findIndex(s => s.id === currentProfileId);
        if (index > -1) {
            const existing = staffData[currentCategory][index];
            newData.securityCollected = existing.securityCollected || 0;
            staffData[currentCategory][index] = { ...existing, ...newData };
        }
        showProfileView(currentProfileId, currentCategory);
    } else {
        const prefix = currentCategory === 'Teaching' ? 'TCH-' : 'NTS-';
        newData.id = prefix + Math.floor(1000 + Math.random() * 9000);
        newData.fines = 0;
        newData.type = currentCategory;
        staffData[currentCategory].push(newData);
    }

    const db = getGlobalData();
    db.staff = staffData;
    saveGlobalData(db);

    populateDirectory(currentCategory);
    loadStaffCounts(false);
    closeFormModal();
}

/* ---- OVERRIDE: showProfileView to show photo + incharge sections ---- */
function showProfileView(staffId, category) {
    const staff = staffData[category].find(s => s.id === staffId);
    if (!staff) return;

    currentProfileId = staff.id;

    const backBtn = document.querySelector('.profile-view .back-btn');
    backBtn.setAttribute('onclick', `showDirectoryView('${category}')`);

    document.getElementById('directory-view').classList.add('d-none');
    const profileView = document.getElementById('profile-view');
    profileView.classList.remove('d-none');
    profileView.classList.add('fade-in');
    setTimeout(() => profileView.classList.remove('fade-in'), 400);

    const nameParts = (staff.name || '?').split(' ');
    const initials = nameParts.length > 1 ? nameParts[0][0] + nameParts[1][0] : nameParts[0][0];

    // Avatar — photo if available, else initials
    const avatarEl = document.querySelector('.profile-avatar');
    const initialsEl = document.getElementById('profile-initials');
    initialsEl.textContent = initials.toUpperCase();
    // remove any previous img
    const oldImg = avatarEl.querySelector('img');
    if (oldImg) oldImg.remove();
    if (staff.photo) {
        avatarEl.classList.add('has-photo');
        const img = document.createElement('img');
        img.src = staff.photo;
        img.alt = staff.name || 'Staff photo';
        avatarEl.appendChild(img);
    } else {
        avatarEl.classList.remove('has-photo');
    }

    document.getElementById('profile-name').textContent = staff.name;
    document.getElementById('profile-id').textContent = staff.id;

    const grid = document.getElementById('profile-details-grid');
    grid.innerHTML = '';

    const createItem = (label, val, fullWidth = false) => `
        <div class="detail-item ${fullWidth ? 'full-width' : ''}">
            <span class="detail-label">${label}</span>
            <span class="detail-value">${val || '—'}</span>
        </div>`;

    if (category === 'Teaching') {
        grid.innerHTML += createItem('Qualification', staff.qualification);
        grid.innerHTML += createItem('Subjects', staff.subjects);
        grid.innerHTML += createItem('Classes', staff.classes);
        // Display incharge assignments nicely
        let inchargeDisplay = staff.incharge || '—';
        if (staff.inchargeAssignments) {
            try {
                const arr = JSON.parse(staff.inchargeAssignments);
                if (Array.isArray(arr) && arr.length) {
                    inchargeDisplay = arr.map(a => a.section ? `${a.cls} — Section ${a.section}` : a.cls).join(', ');
                }
            } catch(e) {}
        }
        grid.innerHTML += createItem('Class Incharge', inchargeDisplay, true);
        grid.innerHTML += createItem('Gender', staff.gender);
        grid.innerHTML += createItem('Salary', formatCurrency(staff.salary));
        grid.innerHTML += createItem('Date Joined', staff.joined);
        grid.innerHTML += createItem('CNIC', staff.cnic);
        grid.innerHTML += createItem('Phone Number', staff.phone);
        grid.innerHTML += createItem('Address', staff.address, true);
        grid.innerHTML += buildSecurityHTML(staff);
    } else {
        grid.innerHTML += createItem('Job Title', staff.job);
        grid.innerHTML += createItem('Gender', staff.gender);
        grid.innerHTML += createItem('Salary', formatCurrency(staff.salary));
        grid.innerHTML += createItem('Start Time', staff.startTime);
        grid.innerHTML += createItem('End Time', staff.endTime);
        grid.innerHTML += createItem('CNIC', staff.cnic);
        grid.innerHTML += createItem('Phone Number', staff.phone);
        grid.innerHTML += createItem('Address', staff.address, true);
        grid.innerHTML += buildSecurityHTML(staff);
    }
}

/* ---- OVERRIDE: populateDirectory to include avatar in name cell ---- */
function populateDirectory(category, filterText = '') {
    const thead = document.getElementById('directory-thead');
    const tbody = document.getElementById('directory-tbody');

    if (category === 'Teaching') {
        thead.innerHTML = `<tr>
            <th>Teacher ID</th><th>Teacher Name</th><th>Qualification</th>
            <th>Subjects</th><th>Classes</th><th>Class Incharge</th>
        </tr>`;
    } else {
        thead.innerHTML = `<tr>
            <th>Staff ID</th><th>Staff Name</th><th>Job Title</th>
            <th>Start Time</th><th>End Time</th>
        </tr>`;
    }

    tbody.innerHTML = '';
    const rawList = staffData[category] || [];
    const staffList = rawList.filter(s => {
        const looksNT = _looksNonTeachingMS(s);
        return category === 'Teaching' ? !looksNT : true;
    });
    const lowerFilter = filterText.toLowerCase();

    staffList.forEach(s => {
        const searchableText = Object.values(s).join(' ').toLowerCase();
        if (filterText && !searchableText.includes(lowerFilter)) return;

        const tr = document.createElement('tr');
        tr.onclick = () => showProfileView(s.id, category);

        const initials = (s.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
        const avatarHTML = s.photo
            ? `<img class="row-avatar" src="${s.photo}" alt="">`
            : `<span class="row-avatar-fallback">${initials}</span>`;

        if (category === 'Teaching') {
            tr.innerHTML = `
                <td><span class="id-badge">${s.id}</span></td>
                <td class="td-bold">${avatarHTML}${s.name}</td>
                <td>${s.qualification || ''}</td>
                <td>${s.subjects || ''}</td>
                <td>${s.classes || ''}</td>
                <td>${s.incharge || ''}</td>
            `;
        } else {
            tr.innerHTML = `
                <td><span class="id-badge">${s.id}</span></td>
                <td class="td-bold">${avatarHTML}${s.name}</td>
                <td>${s.job || ''}</td>
                <td>${s.startTime || ''}</td>
                <td>${s.endTime || ''}</td>
            `;
        }
        tbody.appendChild(tr);
    });
}
