/**
 * EDUFLOW - STAFF MANAGEMENT LOGIC
 * Handles: sidebar toggle, counter animation, ripple, date display
 */

// ============================================================================
// PLAN ENFORCEMENT — feature locks + subscription expiry (mirrors the same
// block in manage-students.js so both pages behave identically). Driven by
// the School record Super Admin configured for this school: `locks` and
// `expiryDate`. Staff has no numeric usage limit (School has no
// staffLimit field), so there's no limit banner here — just feature locks
// and the expiry badge.
// ============================================================================

/** Days before School.expiryDate the blinking subscription badge starts showing. */
const STAFF_EXPIRY_WARNING_DAYS = 30;

/** The logged-in school's record (School.java shape, via access-control.js). */
function getCurrentSchoolRecord() {
    try {
        if (window.SoftSchoolAdmin) return window.SoftSchoolAdmin.getCurrentSchool();
    } catch (e) { /* ignore — demo / no session */ }
    return null;
}

/**
 * True if ANY of a comma-separated list of feature keys is locked for this
 * school. Delegates to SoftSchoolAdmin.isFeatureLocked (access-control.js) —
 * the same check every other page uses.
 */
function isFeatureLocked(keysCsv) {
    const school = getCurrentSchoolRecord();
    if (!school) return false;
    const keys = String(keysCsv || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (window.SoftSchoolAdmin && typeof window.SoftSchoolAdmin.isFeatureLocked === 'function') {
        return keys.some(k => window.SoftSchoolAdmin.isFeatureLocked(school, k));
    }
    // Fallback if access-control.js somehow isn't loaded.
    const raw = String(school.locks || '');
    const locked = new Set(raw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean));
    return keys.some(k => locked.has(k));
}

/**
 * Blur/fade every data-feature element locked for this plan — currently
 * just the Staff Agreement upload (data-feature="staff_agreement_pic" in
 * buildAgreementField()), matching the "staff_agreement_pic" key in
 * superadmin.js's FEATURES catalog. Since the form markup is rebuilt from
 * scratch every time openAddForm()/openEditForm() runs, this needs to be
 * re-applied after every renderFormFields() call, not just once on load.
 */
function applyFeatureLocks() {
    document.querySelectorAll('[data-feature]').forEach(el => {
        if (!isFeatureLocked(el.dataset.feature)) return;
        el.classList.add('feature-locked');
        el.setAttribute('data-tooltip', 'Not available in this plan');
        el.onclick = null;
        el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); }, true);
        el.querySelectorAll('input, button, select, textarea').forEach(ctrl => { ctrl.disabled = true; });
    });
}

/**
 * Small blinking badge, fixed to the corner of the viewport, warning that
 * the school's subscription is about to expire. Identical logic to
 * manage-students.js's renderSubscriptionExpiryBadge() so the warning is
 * consistent everywhere in the app.
 */
function renderSubscriptionExpiryBadge() {
    const badge = document.getElementById('subscription-expiry-badge');
    const text  = document.getElementById('subscription-expiry-text');
    if (!badge || !text) return;

    const school = getCurrentSchoolRecord();
    if (!school || !school.expiryDate) { badge.style.display = 'none'; return; }

    const expiry = new Date(school.expiryDate + 'T00:00:00');
    if (isNaN(expiry.getTime())) { badge.style.display = 'none'; return; }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

    if (daysLeft < 0) {
        text.textContent = 'Subscription expired';
        badge.style.display = 'flex';
    } else if (daysLeft <= STAFF_EXPIRY_WARNING_DAYS) {
        text.textContent = daysLeft === 0
            ? 'Subscription expires today'
            : `Subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

// ============================================================================
// BACKEND SYNC — StaffController.java exposes CRUD under this base, scoped
// by schoolId exactly like StudentController does for students (see
// manage-students.js's identical apiRequest/toApiPayload/syncWithBackend).
// ============================================================================
const STAFF_API_BASE = 'http://localhost:8080/api/staff';

/**
 * The logged-in school's real School ID (School.schoolId, e.g. "SS_77_1") —
 * StaffController scopes every read/write by this value. Returns '' when no
 * school session exists (demo / superadmin mode) — callers should treat
 * that as "can't sync yet".
 */
function getCurrentSchoolId() {
    const school = getCurrentSchoolRecord();
    return (school && school.schoolId) ? school.schoolId : '';
}

const STAFF_NUMERIC_FIELDS = ['salary', 'securityTotal', 'securityCollected', 'securityMonthly', 'fines'];

/** Thin fetch() wrapper that throws a readable error on non-2xx responses. */
async function staffApiRequest(method, url, body) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${method} ${url} -> ${res.status} ${text}`);
    }
    const contentType = res.headers.get('content-type') || '';
    return contentType.includes('application/json') ? res.json() : null;
}

/**
 * Build a payload safe to POST to the Spring Boot API.
 * - Renames the frontend's display `id` (e.g. "PSC_S_1") to `staffId` — the
 *   Java Staff entity's `id` is an auto-generated Long primary key, so
 *   sending the string under `id` would fail deserialization. The backend
 *   re-associates the correct row using (schoolId, staffId) — see
 *   StaffController.save().
 * - Packs the `agreement` object ({name, type, data}) into a single JSON
 *   string column (agreementData), since Staff has no nested-object column.
 * - Stamps schoolId so every school's staff stay in their own records.
 * - Coerces numeric-looking strings into real numbers for the Double fields.
 */
function toApiStaffPayload(staffObj) {
    const payload = Object.assign({}, staffObj);
    payload.staffId = payload.id;
    delete payload.id;

    payload.agreementData = payload.agreement ? JSON.stringify(payload.agreement) : null;
    delete payload.agreement;

    STAFF_NUMERIC_FIELDS.forEach(f => {
        if (payload[f] !== undefined && payload[f] !== null && payload[f] !== '') {
            const n = parseFloat(payload[f]);
            payload[f] = isNaN(n) ? 0 : n;
        }
    });

    payload.schoolId = getCurrentSchoolId();
    return payload;
}

/** Turn a Staff row from the backend back into the shape the frontend uses everywhere. */
function fromApiStaffRecord(row) {
    const staff = Object.assign({}, row);
    staff.id = row.staffId;
    delete staff.staffId;
    delete staff.schoolId;

    if (row.agreementData) {
        try { staff.agreement = JSON.parse(row.agreementData); } catch (e) { staff.agreement = null; }
    } else {
        staff.agreement = null;
    }
    delete staff.agreementData;

    // Recompute the display-only alias the form still reads in a couple of places.
    staff.fatherName = staff.guardianType === 'Father' ? (staff.guardianName || '') : '';

    return staff;
}

/** Save (create or update) a staff member in MySQL. Fire-and-forget from the caller's point of view. */
async function apiSaveStaff(staffObj) {
    const saved = await staffApiRequest('POST', STAFF_API_BASE, toApiStaffPayload(staffObj));
    return saved ? fromApiStaffRecord(saved) : null;
}

/** Remove a staff member on the backend. */
function apiDeleteStaff(staffId) {
    const schoolId = getCurrentSchoolId();
    return staffApiRequest('DELETE', `${STAFF_API_BASE}/${encodeURIComponent(staffId)}?schoolId=${encodeURIComponent(schoolId)}`);
}

/**
 * Pull the current staff roster from MySQL on page load and refresh the
 * shared localStorage store so counts/directory reflect the database
 * instead of whatever was last cached in the browser. Server rows are
 * merged ON TOP OF the local cache (matched by id) so nothing local-only
 * gets wiped, then re-split into the Teaching / Non-Teaching buckets
 * shared-data.js expects (mirrors syncWithBackend() in manage-students.js).
 */
async function syncStaffWithBackend() {
    try {
        const schoolId = getCurrentSchoolId();
        if (!schoolId) {
            // No school session (demo / superadmin preview) — nothing to
            // scope the request to, so stay on the local cache instead of
            // sending a schoolId-less request the backend will reject.
            console.warn('syncStaffWithBackend: no logged-in school, staying on local cache.');
            return;
        }
        const serverRows = await staffApiRequest('GET', `${STAFF_API_BASE}?schoolId=${encodeURIComponent(schoolId)}`);
        if (!Array.isArray(serverRows)) return;

        const db = getGlobalData();
        const localById = new Map(
            [].concat(db.staff['Teaching'] || [], db.staff['Non-Teaching'] || []).map(s => [s.id, s])
        );

        const merged = serverRows.map(fromApiStaffRecord).map(srv =>
            Object.assign({}, localById.get(srv.id) || {}, srv)
        );

        db.staff['Teaching']     = merged.filter(s => s.type !== 'Non-Teaching');
        db.staff['Non-Teaching'] = merged.filter(s => s.type === 'Non-Teaching');
        saveGlobalData(db);

        staffData = db.staff;
        loadStaffCounts(false);
        if (currentCategory && !document.getElementById('directory-view').classList.contains('d-none')) {
            populateDirectory(currentCategory);
        }
    } catch (err) {
        // Backend not reachable (e.g. Spring Boot not running) — keep working
        // off the local cache instead of breaking the page.
        console.warn('syncStaffWithBackend: could not reach the server, using local cache.', err.message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSidebar();
    initDate();
    loadStaffCounts();

    // Update the header brand logo (and any other .brand-logo instances)
    // from the logged-in school's saved logo, instead of leaving the
    // static placeholder image in the markup.
    const headerSchool = _getSchoolIdentity();
    document.querySelectorAll('.brand-logo').forEach(img => {
        if (headerSchool.logo && !headerSchool.logo.includes('logo-icon.png')) {
            img.src = headerSchool.logo;
        }
    });

    // Pull the live roster from MySQL as soon as the page loads, so the
    // counters/directory reflect the database instead of a stale local cache.
    syncStaffWithBackend();

    // ── PLAN ENFORCEMENT: initial pass ──────────────────────────────────
    applyFeatureLocks();
    renderSubscriptionExpiryBadge();
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
    const removedId = currentProfileId;

    // Remove from array
    staffData[currentCategory] = staffData[currentCategory].filter(s => s.id !== removedId);
    
    // Save to global state
    const db = getGlobalData();
    db.staff = staffData;
    saveGlobalData(db);

    // Mirror the delete to MySQL (fire-and-forget, same pattern as the save above).
    if (getCurrentSchoolId()) {
        apiDeleteStaff(removedId).catch(err =>
            console.warn('apiDeleteStaff failed, removal kept locally only:', err.message));
    }

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

    const createInput = (id, label, type='text', fullWidth=false, required=true, readonly=false) => {
        return `
            <div class="form-group ${fullWidth ? 'full-width' : ''}">
                <label for="${id}">${label}</label>
                <input type="${type}" id="${id}" name="${id}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0"' : ''} ${readonly ? 'readonly' : ''}>
            </div>
        `;
    };

    if (category === 'Teaching') {
        grid.innerHTML += createInput('f-staff-id', 'Teacher ID', 'text', false, false, true);
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
        grid.innerHTML += createInput('f-staff-id', 'Staff ID', 'text', false, false, true);
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
    // Show the auto-generated staff ID before saving
    const idField = document.getElementById('f-staff-id');
    if (idField) idField.value = generateStaffId();
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

    // Show existing staff ID (read-only)
    const idField = document.getElementById('f-staff-id');
    if (idField) idField.value = staff.id;

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
        // Add new — use the ID shown in the form if still available, otherwise regenerate
        const displayedId = document.getElementById('f-staff-id')?.value || '';
        const allIds = []
            .concat(staffData['Teaching'] || [])
            .concat(staffData['Non-Teaching'] || [])
            .map(s => s.id);
        newData.id = displayedId && !allIds.includes(displayedId) ? displayedId : generateStaffId();
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

    const createInput = (id, label, type='text', fullWidth=false, required=true, readonly=false) => `
        <div class="form-group ${fullWidth ? 'full-width' : ''}">
            <label for="${id}">${label}</label>
            <input type="${type}" id="${id}" name="${id}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0"' : ''} ${readonly ? 'readonly' : ''}>
        </div>`;

    // Photo first (both categories)
    grid.innerHTML += buildPhotoField('');

    if (category === 'Teaching') {
        grid.innerHTML += createInput('f-staff-id', 'Teacher ID', 'text', false, false, true);
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
        grid.innerHTML += createInput('f-staff-id', 'Staff ID', 'text', false, false, true);
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

    // Show existing staff ID (read-only)
    const idField = document.getElementById('f-staff-id');
    if (idField) idField.value = staff.id || '';

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
    // Show the auto-generated staff ID before saving
    const idField = document.getElementById('f-staff-id');
    if (idField) idField.value = generateStaffId();
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
        // Add new — use the ID shown in the form if still available, otherwise regenerate
        const displayedId = document.getElementById('f-staff-id')?.value || '';
        const allIds = []
            .concat(staffData['Teaching'] || [])
            .concat(staffData['Non-Teaching'] || [])
            .map(s => s.id);
        newData.id = displayedId && !allIds.includes(displayedId) ? displayedId : generateStaffId();
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

/* ============================================================
   ============================================================
   V2 UPGRADE BLOCK
   Uploads (200KB limit), conditional guardian field,
   dynamic class assignment tags, class-incharge toggle.
   Declared LAST so these definitions win.
   ============================================================
   ============================================================ */

const MAX_UPLOAD_BYTES = 200 * 1024;

/* Shared state for the new widgets */
let _pendingAgreement   = null;   // { name, type, data }
let _classAssignments   = [];     // [{ cls, section }]
let _guardianType       = 'Father';
let _inchargeOn         = false;

/* ---- Class/section source (Settings) ---- */
function getAssignClasses() {
    return getSettingsClasses();
}
function getSectionsFor(clsName) {
    const cfg = getAssignClasses().find(c => c.name === clsName);
    return (cfg && Array.isArray(cfg.sections)) ? cfg.sections.filter(Boolean) : [];
}
function _esc(v) {
    return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _fillSectionSelect(secSel, clsName, placeholder) {
    if (!secSel) return;
    if (!clsName) {
        secSel.innerHTML = `<option value="">${placeholder}</option>`;
        secSel.disabled = true;
        return;
    }
    const sections = getSectionsFor(clsName);
    if (!sections.length) {
        secSel.innerHTML = '<option value="">No sections</option>';
        secSel.disabled = true;
    } else {
        secSel.innerHTML = '<option value="">— Select Section —</option>' +
            sections.map(s => `<option value="${_esc(s)}">Section ${_esc(s)}</option>`).join('');
        secSel.disabled = false;
    }
}

/* ============================================
   FILE UPLOADS — 200KB LIMIT (non-image files, e.g. PDF agreements)
   ============================================ */
function _setUploadError(errorElId, msg) {
    const el = document.getElementById(errorElId);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('visible', !!msg);
}
function _isOverLimit(file) {
    return !!file && file.size > MAX_UPLOAD_BYTES;
}
function _kb(bytes) {
    return Math.round(bytes / 1024) + 'KB';
}

/* ============================================
   IMAGE AUTO-OPTIMIZATION — every uploaded photo/agreement image is
   re-encoded client-side to land at ~TARGET_IMAGE_BYTES (40KB) before it's
   ever turned into a data URL, so what actually gets stored in the DB
   (Staff.photo / agreement.data, both LONGTEXT) is always small — no more
   raw multi-MB camera photos bloating the staff table.
   ============================================ */
const TARGET_IMAGE_BYTES  = 40 * 1024;  // ~40KB target for stored images
const MAX_IMAGE_DIMENSION = 900;        // starting max width/height (px) before compression

function _loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
        img.src = url;
    });
}

// Approximate decoded byte size of a base64 data URL (base64 is ~4/3 the size of the raw bytes)
function _dataURLBytes(dataURL) {
    const base64 = (dataURL.split(',')[1]) || '';
    return Math.floor(base64.length * 3 / 4);
}

/**
 * Compress an image File down to roughly `targetBytes` by iteratively
 * lowering JPEG quality and, if quality alone isn't enough, shrinking the
 * pixel dimensions and trying again. Resolves to a JPEG data URL string.
 */
async function compressImageToTarget(file, targetBytes = TARGET_IMAGE_BYTES) {
    const img = await _loadImageFromFile(file);

    let width  = img.naturalWidth  || img.width;
    let height = img.naturalHeight || img.height;

    if (Math.max(width, height) > MAX_IMAGE_DIMENSION) {
        const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
        width  = Math.round(width  * scale);
        height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let bestDataURL = '';
    let totalAttempts = 0;
    const MAX_ATTEMPTS = 25;

    while (totalAttempts < MAX_ATTEMPTS && width >= 40 && height >= 40) {
        canvas.width = width;
        canvas.height = height;
        // JPEG has no alpha channel — flatten transparent PNGs onto white first
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.85;
        let hitTarget = false;
        while (quality >= 0.1 && totalAttempts < MAX_ATTEMPTS) {
            bestDataURL = canvas.toDataURL('image/jpeg', quality);
            totalAttempts++;
            if (_dataURLBytes(bestDataURL) <= targetBytes) {
                hitTarget = true;
                break;
            }
            quality -= 0.1;
        }

        if (hitTarget) return bestDataURL;

        // Still too big even at lowest quality — shrink dimensions and retry
        width  = Math.round(width  * 0.8);
        height = Math.round(height * 0.8);
    }

    // Best effort: return whatever the smallest attempt produced
    return bestDataURL;
}

/* ---- Staff photo (override) ---- */
function buildPhotoField(existing = '') {
    _pendingPhoto = existing || '';
    const inner = existing
        ? `<img src="${_esc(existing)}" alt="Staff photo">`
        : `<i class="fas fa-user"></i>`;
    return `
    <div class="form-group full-width photo-upload-group">
        <div class="photo-upload-preview" id="f-photo-preview">${inner}</div>
        <div class="photo-upload-actions">
            <label for="f-photo" class="btn-photo-pick"><i class="fas fa-camera"></i> Choose Photo</label>
            <input type="file" id="f-photo" accept="image/*">
            <button type="button" class="btn-photo-remove" onclick="clearStaffPhoto()"><i class="fas fa-times"></i> Remove</button>
            <div class="upload-hint">JPG / PNG — auto-optimized to ~40KB</div>
            <div class="upload-error" id="f-photo-error"></div>
        </div>
    </div>`;
}
function wirePhotoField() {
    const input = document.getElementById('f-photo');
    if (!input) return;
    input.addEventListener('change', async (e) => {
        _setUploadError('f-photo-error', '');
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!/^image\//.test(file.type)) {
            input.value = '';
            _setUploadError('f-photo-error', 'Please choose an image file (JPG or PNG).');
            return;
        }
        const prev = document.getElementById('f-photo-preview');
        if (prev) prev.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
        try {
            _pendingPhoto = await compressImageToTarget(file);
            if (prev) prev.innerHTML = `<img src="${_pendingPhoto}" alt="Staff photo">`;
        } catch (err) {
            input.value = '';
            if (prev) prev.innerHTML = '<i class="fas fa-user"></i>';
            _setUploadError('f-photo-error', 'Could not process that image. Please try another file.');
        }
    });
}
function clearStaffPhoto() {
    _pendingPhoto = '';
    const prev = document.getElementById('f-photo-preview');
    if (prev) prev.innerHTML = '<i class="fas fa-user"></i>';
    const input = document.getElementById('f-photo');
    if (input) input.value = '';
    _setUploadError('f-photo-error', '');
}

/* ---- Staff agreement ---- */
function buildAgreementField(existing = null) {
    _pendingAgreement = existing || null;
    return `
    <div class="form-group full-width agreement-upload-group" data-feature="staff_agreement_pic">
        <label>Staff Agreement</label>
        <div class="agreement-row">
            <label for="f-agreement" class="btn-photo-pick"><i class="fas fa-file-upload"></i> Choose File</label>
            <input type="file" id="f-agreement" accept="application/pdf,image/*">
            <span class="agreement-file-name" id="f-agreement-name">${_pendingAgreement ? _esc(_pendingAgreement.name) : 'No file selected'}</span>
            <button type="button" class="btn-photo-remove" onclick="clearStaffAgreement()"><i class="fas fa-times"></i> Remove</button>
        </div>
        <div class="upload-hint">PDF (max 200KB), or JPG/PNG — auto-optimized to ~40KB</div>
        <div class="upload-error" id="f-agreement-error"></div>
    </div>`;
}
function wireAgreementField() {
    const input = document.getElementById('f-agreement');
    if (!input) return;
    input.addEventListener('change', async (e) => {
        _setUploadError('f-agreement-error', '');
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const isImage = /^image\//.test(file.type);
        const isPdf = file.type === 'application/pdf';
        if (!isImage && !isPdf) {
            input.value = '';
            _setUploadError('f-agreement-error', 'Unsupported file type. Upload a PDF or an image.');
            return;
        }

        const nameEl = document.getElementById('f-agreement-name');

        if (isImage) {
            // Agreement photos (e.g. a snapped picture of a signed page) get
            // the same auto-optimization as the staff photo.
            if (nameEl) nameEl.textContent = 'Optimizing…';
            try {
                const data = await compressImageToTarget(file);
                _pendingAgreement = { name: file.name, type: 'image/jpeg', data };
                if (nameEl) nameEl.textContent = file.name;
            } catch (err) {
                input.value = '';
                if (nameEl) nameEl.textContent = 'No file selected';
                _setUploadError('f-agreement-error', 'Could not process that image. Please try another file.');
            }
            return;
        }

        // PDF — not something we can safely re-encode client-side, so keep
        // the existing hard size cap instead of trying to compress it.
        if (_isOverLimit(file)) {
            input.value = '';
            _setUploadError('f-agreement-error', `File too large (${_kb(file.size)}). Maximum size is 200KB.`);
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            _pendingAgreement = { name: file.name, type: file.type, data: ev.target.result };
            if (nameEl) nameEl.textContent = file.name;
        };
        reader.readAsDataURL(file);
    });
}
function clearStaffAgreement() {
    _pendingAgreement = null;
    const input = document.getElementById('f-agreement');
    if (input) input.value = '';
    const nameEl = document.getElementById('f-agreement-name');
    if (nameEl) nameEl.textContent = 'No file selected';
    _setUploadError('f-agreement-error', '');
}

/* ============================================
   GENDER + CONDITIONAL GUARDIAN FIELD
   ============================================ */
function buildGenderField(value = 'Male') {
    return `
    <div class="form-group">
        <label for="f-gender">Gender</label>
        <select id="f-gender" name="f-gender" onchange="onGenderChange()">
            <option value="Male"${value === 'Male' ? ' selected' : ''}>Male</option>
            <option value="Female"${value === 'Female' ? ' selected' : ''}>Female</option>
            <option value="Other"${value === 'Other' ? ' selected' : ''}>Other</option>
        </select>
    </div>`;
}
function buildGuardianField(type = 'Father', name = '') {
    _guardianType = (type === 'Husband') ? 'Husband' : 'Father';
    return `
    <div class="form-group guardian-group" id="f-guardian-group">
        <div class="guardian-toggle collapsible" id="f-guardian-toggle">
            <button type="button" class="guardian-opt${_guardianType === 'Father' ? ' active' : ''}"
                    id="f-guardian-opt-father" onclick="setGuardianType('Father')">Father Name</button>
            <button type="button" class="guardian-opt${_guardianType === 'Husband' ? ' active' : ''}"
                    id="f-guardian-opt-husband" onclick="setGuardianType('Husband')">Husband Name</button>
        </div>
        <label for="f-guardian-name" id="f-guardian-label">${_guardianType} Name</label>
        <input type="text" id="f-guardian-name" name="f-guardian-name" value="${_esc(name)}">
    </div>`;
}
function setGuardianType(type) {
    _guardianType = (type === 'Husband') ? 'Husband' : 'Father';
    const label = document.getElementById('f-guardian-label');
    if (label) label.textContent = `${_guardianType} Name`;
    const input = document.getElementById('f-guardian-name');
    if (input) input.placeholder = `Enter ${_guardianType.toLowerCase()} name`;
    const f = document.getElementById('f-guardian-opt-father');
    const h = document.getElementById('f-guardian-opt-husband');
    if (f) f.classList.toggle('active', _guardianType === 'Father');
    if (h) h.classList.toggle('active', _guardianType === 'Husband');
}
function onGenderChange() {
    const gender = (document.getElementById('f-gender') || {}).value || 'Male';
    const toggle = document.getElementById('f-guardian-toggle');
    if (!toggle) return;
    const isFemale = gender === 'Female';
    toggle.classList.toggle('open', isFemale);
    if (!isFemale) setGuardianType('Father');
}

/* ============================================
   DYNAMIC TEACHING CLASS ASSIGNMENT (green tags)
   ============================================ */
function buildClassAssignPicker(existing = '') {
    _classAssignments = [];
    if (existing) {
        try {
            const arr = typeof existing === 'string' ? JSON.parse(existing) : existing;
            if (Array.isArray(arr)) {
                arr.forEach(a => {
                    if (a && a.cls) _classAssignments.push({ cls: a.cls, section: a.section || '' });
                });
            }
        } catch (e) { /* ignore */ }
    }

    const classes = getAssignClasses();
    return `
    <div class="form-group full-width class-assign-group" id="f-classassign-group">
        <label>Class Assignment</label>
        <div class="class-tags" id="f-class-tags">${_renderClassTags()}</div>
        ${classes.length ? `
        <button type="button" class="add-class-btn" onclick="toggleClassAssignBox()">
            <i class="fas fa-plus"></i> Add Class
        </button>
        <div class="class-assign-box collapsible" id="f-classassign-box">
            <div class="class-assign-row">
                <div>
                    <span class="assign-select-label">Class</span>
                    <select id="f-assign-cls" onchange="onAssignClassChange()">
                        <option value="">— Select Class —</option>
                        ${classes.map(c => `<option value="${_esc(c.name)}">${_esc(c.name)}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <span class="assign-select-label">Section</span>
                    <select id="f-assign-sec" disabled>
                        <option value="">— Select Class first —</option>
                    </select>
                </div>
                <button type="button" class="assign-add-btn" onclick="addClassAssignment()">Add</button>
            </div>
            <div class="upload-error" id="f-assign-error"></div>
        </div>` : '<span class="incharge-no-assignment">No classes defined in Settings yet.</span>'}
    </div>`;
}
function _renderClassTags() {
    if (!_classAssignments.length) {
        return '<span class="incharge-no-assignment">No class assigned yet.</span>';
    }
    return _classAssignments.map((a, i) => {
        const label = a.section ? `${_esc(a.cls)} — ${_esc(a.section)}` : _esc(a.cls);
        return `<span class="class-tag">${label}<button type="button" class="class-tag-remove"
            onclick="removeClassAssignment(${i})" title="Remove">&times;</button></span>`;
    }).join('');
}
function _refreshClassTags() {
    const el = document.getElementById('f-class-tags');
    if (el) el.innerHTML = _renderClassTags();
}
function toggleClassAssignBox(force) {
    const box = document.getElementById('f-classassign-box');
    if (!box) return;
    const open = (typeof force === 'boolean') ? force : !box.classList.contains('open');
    box.classList.toggle('open', open);
}
function onAssignClassChange() {
    const clsSel = document.getElementById('f-assign-cls');
    _fillSectionSelect(document.getElementById('f-assign-sec'), clsSel ? clsSel.value : '', '— Select Class first —');
}
function addClassAssignment() {
    const clsSel = document.getElementById('f-assign-cls');
    const secSel = document.getElementById('f-assign-sec');
    _setUploadError('f-assign-error', '');
    if (!clsSel || !clsSel.value) {
        _setUploadError('f-assign-error', 'Please select a class.');
        return;
    }
    const cls = clsSel.value;
    const hasSections = getSectionsFor(cls).length > 0;
    const section = hasSections ? (secSel ? secSel.value : '') : '';
    if (hasSections && !section) {
        _setUploadError('f-assign-error', 'Please select a section.');
        return;
    }
    if (_classAssignments.some(a => a.cls === cls && a.section === section)) {
        _setUploadError('f-assign-error', 'This class is already assigned.');
        return;
    }
    _classAssignments.push({ cls, section });
    _refreshClassTags();
    clsSel.value = '';
    _fillSectionSelect(secSel, '', '— Select Class first —');
    toggleClassAssignBox(false);
}
function removeClassAssignment(idx) {
    _classAssignments.splice(idx, 1);
    _refreshClassTags();
}
function readClassAssignments() {
    return _classAssignments.map(a => a.section ? `${a.cls} - ${a.section}` : a.cls).join(', ');
}

/* ============================================
   CLASS INCHARGE TOGGLE
   ============================================ */
function buildInchargePicker(existingCls = '', existingSec = '') {
    _inchargeOn = !!existingCls;
    _inchargeAssignments = _inchargeOn ? [{ cls: existingCls, section: existingSec || '' }] : [];
    const classes = getAssignClasses();
    return `
    <div class="form-group full-width incharge-group" id="f-incharge-group">
        <label class="incharge-switch">
            <input type="checkbox" id="f-incharge-toggle" ${_inchargeOn ? 'checked' : ''} onchange="onInchargeToggle()">
            <span class="incharge-switch-track"><span class="incharge-switch-thumb"></span></span>
            <span class="incharge-switch-text">Make Class Incharge</span>
        </label>
        <div class="incharge-fields collapsible${_inchargeOn ? ' open' : ''}" id="f-incharge-fields">
            <div class="class-assign-row">
                <div>
                    <span class="assign-select-label">Class</span>
                    <select id="f-incharge-cls" onchange="onInchargeClsChange()">
                        <option value="">— Select Class —</option>
                        ${classes.map(c => `<option value="${_esc(c.name)}"${c.name === existingCls ? ' selected' : ''}>${_esc(c.name)}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <span class="assign-select-label">Section</span>
                    <select id="f-incharge-sec" disabled>
                        <option value="">— Select Class first —</option>
                    </select>
                </div>
            </div>
        </div>
    </div>`;
}
function wireInchargePicker(existingCls = '', existingSec = '') {
    if (existingCls) {
        _fillSectionSelect(document.getElementById('f-incharge-sec'), existingCls, '— Select Class first —');
        const secSel = document.getElementById('f-incharge-sec');
        if (secSel && existingSec) secSel.value = existingSec;
    }
}
function onInchargeToggle() {
    const cb = document.getElementById('f-incharge-toggle');
    const box = document.getElementById('f-incharge-fields');
    _inchargeOn = !!(cb && cb.checked);
    if (box) box.classList.toggle('open', _inchargeOn);
}
function onInchargeClsChange() {
    const clsSel = document.getElementById('f-incharge-cls');
    _fillSectionSelect(document.getElementById('f-incharge-sec'), clsSel ? clsSel.value : '', '— Select Class first —');
}
function readIncharge() {
    if (!_inchargeOn) return { cls: '', section: '', label: '' };
    const cls = (document.getElementById('f-incharge-cls') || {}).value || '';
    const secSel = document.getElementById('f-incharge-sec');
    const section = (secSel && !secSel.disabled) ? (secSel.value || '') : '';
    return { cls, section, label: cls ? (section ? `${cls} - ${section}` : cls) : '' };
}

/* ---- OVERRIDE: renderFormFields ---- */
function renderFormFields(category) {
    const grid = document.getElementById('form-dynamic-fields');
    grid.innerHTML = '';

    const createInput = (id, label, type='text', fullWidth=false, required=true, readonly=false) => `
        <div class="form-group ${fullWidth ? 'full-width' : ''}">
            <label for="${id}">${label}</label>
            <input type="${type}" id="${id}" name="${id}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0"' : ''} ${readonly ? 'readonly' : ''}>
        </div>`;

    let html = buildPhotoField('');

    if (category === 'Teaching') {
        html += createInput('f-staff-id', 'Teacher ID', 'text', false, false, true);
        html += createInput('f-name', 'Teacher Name');
        html += buildGenderField('Male');
        html += buildGuardianField('Father', '');
        html += createInput('f-qualification', 'Qualification');
        html += createInput('f-subjects', 'Subjects');
        html += buildClassAssignPicker('');
        html += buildInchargePicker('', '');
        html += createInput('f-salary', 'Salary', 'number');
        html += createInput('f-joined', 'Date Joined', 'date');
        html += `
            <div class="form-group full-width">
                <label for="f-cnic">CNIC (Pakistani 13-digit)</label>
                ${buildCnicField('f-cnic')}
            </div>`;
        html += createInput('f-phone', 'Phone Number');
        html += createInput('f-address', 'Address', 'text', true);
    } else {
        html += createInput('f-staff-id', 'Staff ID', 'text', false, false, true);
        html += createInput('f-name', 'Staff Name');
        html += buildGenderField('Male');
        html += buildGuardianField('Father', '');
        html += createInput('f-job', 'Job Title');
        html += createInput('f-startTime', 'Start Time', 'time');
        html += createInput('f-endTime', 'End Time', 'time');
        html += createInput('f-salary', 'Salary', 'number');
        html += `
            <div class="form-group full-width">
                <label for="f-cnic">CNIC (Pakistani 13-digit)</label>
                ${buildCnicField('f-cnic')}
            </div>`;
        html += createInput('f-phone', 'Phone Number');
        html += createInput('f-address', 'Address', 'text', true);
    }

    html += buildAgreementField(null);

    html += `
        <div class="form-group security-section-divider full-width">
            <div class="security-divider-label"><i class="fas fa-shield-alt"></i> Security Deposit (Optional)</div>
        </div>`;
    html += createInput('f-security-total', 'Total Security Amount (PKR)', 'number', false, false);
    html += createInput('f-security-monthly', 'Monthly Deduction (PKR)', 'number', false, false);

    grid.innerHTML = html;

    wirePhotoField();
    wireAgreementField();
    wireCnicField('f-cnic');
    wireInchargePicker();
    onGenderChange();

    // Re-apply plan feature locks — this markup (incl. the Staff Agreement
    // upload, data-feature="staff_agreement_pic") is rebuilt from scratch
    // every time this function runs, so the lock has to be re-applied too.
    applyFeatureLocks();
}

/* ---- OVERRIDE: openAddForm ---- */
function openAddForm() {
    isEditMode = false;
    _pendingPhoto = '';
    _pendingAgreement = null;
    _classAssignments = [];
    _inchargeOn = false;
    const title = currentCategory === 'Teaching' ? 'Add Teacher' : 'Add Non-Teaching Staff';
    document.getElementById('form-modal-title').textContent = title;
    renderFormFields(currentCategory);
    // Show the auto-generated staff ID before saving
    const idField = document.getElementById('f-staff-id');
    if (idField) idField.value = generateStaffId();
    document.getElementById('form-modal').classList.remove('d-none');
}

/* ---- OVERRIDE: openEditForm ---- */
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

    // Agreement
    if (staff.agreement && staff.agreement.data) {
        _pendingAgreement = staff.agreement;
        const nameEl = document.getElementById('f-agreement-name');
        if (nameEl) nameEl.textContent = staff.agreement.name || 'Agreement file';
    }

    const cnicInput = document.getElementById('f-cnic');
    if (cnicInput) cnicInput.value = formatCnic(staff.cnic || '');

    // Show existing staff ID (read-only)
    const idField = document.getElementById('f-staff-id');
    if (idField) idField.value = staff.id || '';

    document.getElementById('f-name').value    = staff.name || '';
    document.getElementById('f-gender').value  = staff.gender || 'Male';
    document.getElementById('f-salary').value  = staff.salary || '';
    document.getElementById('f-phone').value   = staff.phone || '';
    document.getElementById('f-address').value = staff.address || '';

    // Guardian
    onGenderChange();
    setGuardianType(staff.guardianType || 'Father');
    const gName = document.getElementById('f-guardian-name');
    if (gName) gName.value = staff.guardianName || '';

    if (currentCategory === 'Teaching') {
        document.getElementById('f-qualification').value = staff.qualification || '';
        document.getElementById('f-subjects').value = staff.subjects || '';
        document.getElementById('f-joined').value = staff.joined || '';

        // Class assignment tags
        const assignGroup = document.getElementById('f-classassign-group');
        if (assignGroup) {
            const tmp = document.createElement('div');
            tmp.innerHTML = buildClassAssignPicker(staff.classAssignments || '');
            assignGroup.replaceWith(tmp.firstElementChild);
        }

        // Incharge
        const inchargeGroup = document.getElementById('f-incharge-group');
        if (inchargeGroup) {
            const tmp2 = document.createElement('div');
            tmp2.innerHTML = buildInchargePicker(staff.assignedClass || '', staff.assignedSection || '');
            inchargeGroup.replaceWith(tmp2.firstElementChild);
            wireInchargePicker(staff.assignedClass || '', staff.assignedSection || '');
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

/* ---- OVERRIDE: handleFormSubmit ---- */
function handleFormSubmit(e) {
    e.preventDefault();

    const guardianInput = document.getElementById('f-guardian-name');

    let newData = {
        name: document.getElementById('f-name').value,
        gender: document.getElementById('f-gender').value,
        guardianType: _guardianType,
        guardianName: guardianInput ? guardianInput.value.trim() : '',
        salary: document.getElementById('f-salary').value,
        phone: document.getElementById('f-phone').value,
        address: document.getElementById('f-address').value,
        photo: _pendingPhoto || '',
        agreement: _pendingAgreement || null,
        cnic: readCnicField('f-cnic')
    };
    // Backwards compatible alias
    newData.fatherName = _guardianType === 'Father' ? newData.guardianName : '';

    const secTotal = parseFloat(document.getElementById('f-security-total').value) || 0;
    const secMonthly = parseFloat(document.getElementById('f-security-monthly').value) || 0;
    newData.securityTotal = secTotal > 0 ? secTotal : 0;
    newData.securityMonthly = secTotal > 0 && secMonthly > 0 ? secMonthly : 0;
    if (!isEditMode) newData.securityCollected = 0;

    if (currentCategory === 'Teaching') {
        newData.qualification = document.getElementById('f-qualification').value;
        newData.subjects = document.getElementById('f-subjects').value;
        newData.joined = document.getElementById('f-joined').value;

        // Class assignment tags
        newData.classes = readClassAssignments();
        newData.classAssignments = JSON.stringify(_classAssignments);

        // Class incharge
        const inc = readIncharge();
        newData.isClassIncharge = !!inc.label;
        newData.incharge = inc.label;
        newData.assignedClass = inc.cls;
        newData.assignedSection = inc.section;
        newData.inchargeAssignments = JSON.stringify(inc.label ? [{ cls: inc.cls, section: inc.section }] : []);
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
        // Add new — use the ID shown in the form if still available, otherwise regenerate
        const displayedId = document.getElementById('f-staff-id')?.value || '';
        const allIds = []
            .concat(staffData['Teaching'] || [])
            .concat(staffData['Non-Teaching'] || [])
            .map(s => s.id);
        newData.id = displayedId && !allIds.includes(displayedId) ? displayedId : generateStaffId();
        newData.fines = 0;
        newData.type = currentCategory;
        staffData[currentCategory].push(newData);
    }

    const db = getGlobalData();
    db.staff = staffData;
    saveGlobalData(db);

    // Push the full, merged record to MySQL (fire-and-forget — the UI
    // already reflects the change from localStorage above, and
    // syncStaffWithBackend() will reconcile on next page load either way).
    const savedId = isEditMode ? currentProfileId : newData.id;
    const finalRecord = staffData[currentCategory].find(s => s.id === savedId);
    if (finalRecord && getCurrentSchoolId()) {
        apiSaveStaff(finalRecord).catch(err =>
            console.warn('apiSaveStaff failed, change kept locally only:', err.message));
    }

    populateDirectory(currentCategory);
    loadStaffCounts(false);
    closeFormModal();
}

/* ---- OVERRIDE: showProfileView (adds guardian, tags, agreement) ---- */
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
    const initials = (nameParts.length > 1 ? nameParts[0][0] + nameParts[1][0] : nameParts[0][0]).toUpperCase();

    const avatarEl = document.querySelector('.profile-avatar');
    document.getElementById('profile-initials').textContent = initials;
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

    const guardianLabel = (staff.guardianType || 'Father') + ' Name';

    const agreementHTML = (staff.agreement && staff.agreement.data)
        ? `<button type="button" class="btn btn-view-agreement" onclick="openAgreementModal('${_esc(staff.id)}')">
             <i class="fas fa-file-contract"></i> View Agreement</button>
           <span class="agreement-file-label">${_esc(staff.agreement.name || 'agreement')}</span>`
        : `<span class="agreement-none">No agreement uploaded.</span>`;

    if (category === 'Teaching') {
        let tags = '';
        try {
            const arr = JSON.parse(staff.classAssignments || '[]');
            if (Array.isArray(arr) && arr.length) {
                tags = `<span class="class-tags readonly">` + arr.map(a =>
                    `<span class="class-tag static">${_esc(a.section ? `${a.cls} — ${a.section}` : a.cls)}</span>`
                ).join('') + `</span>`;
            }
        } catch (e) {}
        if (!tags) tags = staff.classes || '';

        grid.innerHTML += createItem('Qualification', staff.qualification);
        grid.innerHTML += createItem('Subjects', staff.subjects);
        grid.innerHTML += createItem('Class Assignment', tags, true);
        grid.innerHTML += createItem('Class Incharge', staff.incharge || 'Not assigned', true);
        grid.innerHTML += createItem('Gender', staff.gender);
        grid.innerHTML += createItem(guardianLabel, staff.guardianName || staff.fatherName);
        grid.innerHTML += createItem('Salary', formatCurrency(staff.salary));
        grid.innerHTML += createItem('Date Joined', staff.joined);
        grid.innerHTML += createItem('CNIC', staff.cnic);
        grid.innerHTML += createItem('Phone Number', staff.phone);
        grid.innerHTML += createItem('Address', staff.address, true);
        grid.innerHTML += createItem('Staff Agreement', agreementHTML, true);
        grid.innerHTML += buildSecurityHTML(staff);
    } else {
        grid.innerHTML += createItem('Job Title', staff.job);
        grid.innerHTML += createItem('Gender', staff.gender);
        grid.innerHTML += createItem(guardianLabel, staff.guardianName || staff.fatherName);
        grid.innerHTML += createItem('Salary', formatCurrency(staff.salary));
        grid.innerHTML += createItem('Start Time', staff.startTime);
        grid.innerHTML += createItem('End Time', staff.endTime);
        grid.innerHTML += createItem('CNIC', staff.cnic);
        grid.innerHTML += createItem('Phone Number', staff.phone);
        grid.innerHTML += createItem('Address', staff.address, true);
        grid.innerHTML += createItem('Staff Agreement', agreementHTML, true);
        grid.innerHTML += buildSecurityHTML(staff);
    }
}


/* ============================================================
   ============================================================
   STAFF AGREEMENT VIEWER — view / print / download / share
   Declared LAST so it always wins.
   ============================================================
   ============================================================ */

let _currentAgreementStaff = null; // { id, category, agreement }

/**
 * Find a staff record by id across both categories (so the modal
 * doesn't depend on currentCategory being correct).
 */
function _findStaffById(staffId) {
    const cats = ['Teaching', 'Non-Teaching'];
    for (const cat of cats) {
        const list = (staffData && staffData[cat]) || [];
        const found = list.find(s => s.id === staffId);
        if (found) return { staff: found, category: cat };
    }
    return null;
}

function openAgreementModal(staffId) {
    const found = _findStaffById(staffId);
    if (!found || !found.staff.agreement || !found.staff.agreement.data) return;

    const staff = found.staff;
    _currentAgreementStaff = { id: staff.id, name: staff.name, agreement: staff.agreement };

    document.getElementById('agreement-modal-title').textContent = `${staff.name} — Staff Agreement`;

    const body = document.getElementById('agreement-modal-body');
    const isPdf = (staff.agreement.type || '').toLowerCase() === 'application/pdf'
        || /\.pdf$/i.test(staff.agreement.name || '');

    if (isPdf) {
        body.innerHTML = `<iframe class="agreement-pdf-frame" id="agreement-pdf-frame" src="${staff.agreement.data}"></iframe>`;
    } else {
        body.innerHTML = `<img class="agreement-img-preview" id="agreement-img-preview" src="${staff.agreement.data}" alt="Staff agreement">`;
    }

    document.getElementById('agreement-modal').classList.remove('d-none');
}

function closeAgreementModal() {
    document.getElementById('agreement-modal').classList.add('d-none');
    document.getElementById('agreement-modal-body').innerHTML = '';
    _currentAgreementStaff = null;
}

/**
 * Convert a base64 data URL into a Blob (used for share/download fallbacks).
 */
function _dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const meta = parts[0];
    const mimeMatch = meta.match(/data:([^;]+);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const byteString = atob(parts[1]);
    const arr = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) arr[i] = byteString.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

/**
 * Download the currently viewed agreement file to the device.
 */
function downloadAgreementFile() {
    if (!_currentAgreementStaff) return;
    const { agreement, name } = _currentAgreementStaff;
    const a = document.createElement('a');
    a.href = agreement.data;
    a.download = agreement.name || `${name || 'staff'}-agreement`;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/**
 * Print the agreement — opens a dedicated print window sized to the file
 * so the rest of the app UI never ends up in the printout.
 */
function printAgreement() {
    if (!_currentAgreementStaff) return;
    const { agreement, name } = _currentAgreementStaff;
    const isPdf = (agreement.type || '').toLowerCase() === 'application/pdf'
        || /\.pdf$/i.test(agreement.name || '');

    const printWin = window.open('', '_blank');
    if (!printWin) return; // popup blocked

    if (isPdf) {
        printWin.document.write(`
            <html><head><title>${_esc(name || 'Staff Agreement')}</title>
            <style>html,body{margin:0;height:100%;} iframe{border:0;width:100%;height:100%;}</style>
            </head><body>
            <iframe src="${agreement.data}" onload="setTimeout(function(){window.focus();window.print();},300)"></iframe>
            </body></html>`);
    } else {
        printWin.document.write(`
            <html><head><title>${_esc(name || 'Staff Agreement')}</title>
            <style>
                html,body{margin:0;padding:0;display:flex;align-items:center;justify-content:center;background:#fff;}
                img{max-width:100%;max-height:100vh;}
                @media print { img{width:100%;height:auto;} }
            </style>
            </head><body>
            <img src="${agreement.data}" onload="setTimeout(function(){window.focus();window.print();},300)">
            </body></html>`);
    }
    printWin.document.close();
}

/**
 * Share the agreement to WhatsApp (or any installed share target) using
 * the native Web Share API when available (works on most mobile browsers
 * and shares the actual file/image). Falls back to opening WhatsApp Web
 * with a text message plus triggering a download, since browsers cannot
 * attach a file to wa.me links directly.
 */
async function shareAgreementWhatsApp() {
    if (!_currentAgreementStaff) return;
    const { agreement, name } = _currentAgreementStaff;
    const fileName = agreement.name || `${name || 'staff'}-agreement`;

    try {
        const blob = _dataUrlToBlob(agreement.data);
        const file = new File([blob], fileName, { type: blob.type });

        if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
            await navigator.share({
                files: [file],
                title: `${name || 'Staff'} — Agreement`,
                text: `Staff agreement for ${name || ''}`
            });
            return;
        }
    } catch (err) {
        // fall through to fallback below (user cancel also lands here on some browsers)
        if (err && err.name === 'AbortError') return; // user cancelled share sheet, do nothing
    }

    // Fallback: download the file locally and open WhatsApp with a text prompt,
    // since a plain link cannot carry file bytes into WhatsApp.
    downloadAgreementFile();
    const msg = encodeURIComponent(`Staff agreement for ${name || ''} — file downloaded, please attach it in WhatsApp.`);
    window.open(`https://wa.me/?text=${msg}`, '_blank');
}

/* ============================================================
   ============================================================
   EXPERIENCE CERTIFICATE GENERATOR (Teaching staff only)
   Builds an A4 certificate from the provided school-letterhead
   template, auto-filled with staff + school data, gender-aware
   pronouns, and editable position/date fields. Supports print,
   PNG download, and WhatsApp share. Declared LAST so it wins.
   ============================================================
   ============================================================ */

let _certStaffId = null;
let _certPosition = 'Teacher';

/**
 * Pull the school's name & logo for THIS logged-in school. Prioritizes the
 * authoritative Super Admin record (window.SoftSchoolAdmin.getCurrentSchool(),
 * set up by access-control.js) — the same source manage-students.js already
 * uses for prefixes/branding — so certificates always match whatever the
 * super admin actually configured, instead of stale/guessed localStorage
 * keys or the demo default. Older fallbacks are kept afterwards purely for
 * single-school / no-super-admin demo setups. Address & phone aren't shown
 * anywhere in the app yet, so we ask for them once and remember the answer
 * in localStorage for next time.
 */
function _getSchoolIdentity() {
    let logo = '';
    let name = '';

    try {
        // 1. Authoritative source: the school record from Super Admin, via
        //    the same window.SoftSchoolAdmin API access-control.js exposes.
        if (window.SoftSchoolAdmin) {
            const currentSchool = window.SoftSchoolAdmin.getCurrentSchool();
            if (currentSchool) {
                if (currentSchool.logo) logo = currentSchool.logo;
                if (currentSchool.name) name = currentSchool.name;
            }
        }

        // 2. Check Global Data (shared-data.js) — legacy fallback
        const db = (typeof getGlobalData === 'function') ? getGlobalData() : {};

        // Comprehensive search for logo in the database object
        if (!logo) {
            if (db.settings?.schoolLogo) logo = db.settings.schoolLogo;
            else if (db.schoolLogo) logo = db.schoolLogo;
            else if (db.config?.logo) logo = db.config.logo;
        }

        if (!name) {
            if (db.settings?.schoolName) name = db.settings.schoolName;
            else if (db.schoolName) name = db.schoolName;
        }

        // 3. Search LocalStorage directly (older Super Admin builds saved here)
        if (!logo) {
            logo = localStorage.getItem('schoolLogo') || 
                   localStorage.getItem('admin_logo') || 
                   JSON.parse(localStorage.getItem('school_settings') || '{}').logo;
        }

    } catch (e) { console.warn("Search interrupted:", e); }

    // 4. Last Resort: Grab it from the actual Header Image on the screen
    if (!logo) {
        const headerLogo = document.querySelector('.brand-logo');
        if (headerLogo && headerLogo.src && !headerLogo.src.includes('placeholder')) {
            // Check if the source is a valid data string or path
            logo = headerLogo.src;
        }
    }

    const contact = JSON.parse(localStorage.getItem('eduflow-school-contact') || '{"address":"","phone":""}');

    return { 
        name: name || document.querySelector('.school-name')?.textContent?.trim() || 'ST. LAWRENCE INTERNATIONAL SCHOOL', 
        logo: logo || '', 
        address: contact.address, 
        phone: contact.phone 
    };
}

function _saveSchoolContact(address, phone) {
    try {
        localStorage.setItem('eduflow-school-contact', JSON.stringify({ address, phone }));
    } catch (e) { /* ignore */ }
}

/** Gender-aware pronoun set. */
function _pronouns(gender) {
    if (gender === 'Female') return { subj: 'she', obj: 'her', poss: 'her' };
    if (gender === 'Other') return { subj: 'they', obj: 'them', poss: 'their' };
    return { subj: 'he', obj: 'him', poss: 'his' };
}

function _todayLong() {
    return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function _formatDateLong(val) {
    if (!val) return '—';
    const d = new Date(val);
    if (isNaN(d.getTime())) return val; // already a display string
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}


/* ---- Logo safety: html2canvas chokes on a missing/blocked logo file.
   We preload it once, cache it as a data URL, and fall back to an inline
   SVG crest so the certificate always renders. ---- */
let _certLogoDataURL = null;

const _CERT_FALLBACK_CREST = `<div class="certificate-logo-fallback"><svg viewBox="0 0 64 64" width="34" height="34" aria-hidden="true">
  <path d="M32 3 58 12v22c0 15-11 24-26 27C17 58 6 49 6 34V12L32 3z" fill="#2f8f7d"/>
  <path d="M32 3 58 12v22c0 15-11 24-26 27V3z" fill="#1f6f74"/>
  <path d="M18 24h13v18H18zM33 24h13v18H33z" fill="#f7faf9"/>
  <path d="M32 22v20" stroke="#1f6f74" stroke-width="2"/>
</svg></div>`;
window._CERT_FALLBACK_CREST = _CERT_FALLBACK_CREST;

function _preloadCertLogo(src) {
    _certLogoDataURL = null;

    // Log the actual source found for debugging
    console.log("Attempting to load certificate logo from:", src);

    if (!src || src === "" || src.includes('placeholder')) {
        console.warn("Logo source is empty or placeholder. Using fallback crest.");
        refreshCertificatePreview();
        return;
    }

    // If it's Base64 (Data URL), it's safe and fast
    if (src.startsWith('data:image')) {
        _certLogoDataURL = src;
        refreshCertificatePreview();
        return;
    }

    // If it's a URL/Path, we must convert it
    const img = new Image();
    // This line is vital for ERR_CONNECTION issues
    img.setAttribute('crossOrigin', 'anonymous'); 
    
    img.onload = function() {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        try {
            _certLogoDataURL = canvas.toDataURL('image/png');
            console.log("Logo successfully converted to DataURL.");
        } catch (e) {
            console.error("Canvas export failed. Using raw path.");
            _certLogoDataURL = src;
        }
        refreshCertificatePreview();
    };

    img.onerror = function() {
        console.error("Failed to load image resource at:", src);
        _certLogoDataURL = null; // Show the green SVG shield instead
        refreshCertificatePreview();
    };

    // Add a timestamp to bypass browser cache
    img.src = src + (src.includes('?') ? '&' : '?') + 't=' + new Date().getTime();
}

/**
 * Open the certificate modal for a Teaching staff member and render
 * the first preview using smart defaults pulled from their record.
 */
function openCertificateModal() {
    const staff = staffData['Teaching'].find(s => s.id === currentProfileId);
    if (!staff) return;
    _certStaffId = staff.id;

    const school = _getSchoolIdentity();
    const position = (staff.subjects ? staff.subjects.split(',')[0].trim() + ' Teacher' : 'Teacher');
    _certPosition = position;

    document.getElementById('certificate-modal-title').textContent = `Experience Certificate — ${staff.name}`;

    // Setup the options fields
    const opts = document.getElementById('certificate-options');
    opts.innerHTML = `
        <div class="form-group">
            <label for="cert-start">Start Date</label>
            <input type="date" id="cert-start" value="${_esc(staff.joined || '')}" oninput="refreshCertificatePreview()">
        </div>
        <div class="form-group">
            <label for="cert-end">End Date</label>
            <input type="date" id="cert-end" value="${_esc(new Date().toISOString().slice(0,10))}" oninput="refreshCertificatePreview()">
        </div>
    `;

    // CRITICAL FIX: Pre-load the logo first, THEN refresh the preview
    document.getElementById('certificate-modal-body').innerHTML = '<div style="color:white;text-align:center;padding:50px;">Loading Certificate Template...</div>';
    
    _preloadCertLogo(school.logo); // This function calls refreshCertificatePreview inside itself
    document.getElementById('certificate-modal').classList.remove('d-none');
}

/**
 * Rebuild the A4 certificate markup from current staff data + the
 * editable option fields, and persist the school contact details.
 */
function refreshCertificatePreview() {
    const staff = staffData['Teaching'].find(s => s.id === _certStaffId);
    if (!staff) return;

    const school = _getSchoolIdentity();
    const p = _pronouns(staff.gender);

    const position = _certPosition || 'Teacher';
    const startDate = _formatDateLong((document.getElementById('cert-start') || {}).value);
    const endDate = _formatDateLong((document.getElementById('cert-end') || {}).value);
    const classes = staff.classes || '';

    const guardianType = staff.guardianType || 'Father';
    const guardianName = staff.guardianName || staff.fatherName || '';
    const guardianLine = guardianName
        ? `${guardianType === 'Husband' ? 'w/o' : 's/o'} ${_esc(guardianName)}, `
        : '';

    const subjectsLine = staff.subjects ? _esc(staff.subjects) : position;
    const classesLine = classes ? _esc(classes) : '—';
    const logoSrc = _certLogoDataURL || school.logo || '';
    const logoInner = logoSrc
        ? `<img src="${_esc(logoSrc)}" alt="School logo" onerror="this.outerHTML = _CERT_FALLBACK_CREST;">`
        : _CERT_FALLBACK_CREST;
    const logoHTML = `<div class="certificate-logo-wrap">${logoInner}<div class="certificate-logo-ring"></div></div>`;

    // Keep the school name on a single line: shrink the font size a bit for
    // longer names instead of letting it wrap under the logo.
    const nameLen = (school.name || '').length;
    const nameFontSize = nameLen > 42 ? 14 : nameLen > 34 ? 16 : nameLen > 26 ? 19 : 22;

    const html = `
    <div class="certificate-page" id="certificate-page">
        <div class="certificate-border">
            <div class="corner-flourish corner-tl"></div>
            <div class="corner-flourish corner-tr"></div>
            <div class="corner-flourish corner-bl"></div>
            <div class="corner-flourish corner-br"></div>

            <div class="certificate-header">
                <div class="certificate-brand">
                    ${logoHTML}
                    <div class="certificate-school-name" style="font-size:${nameFontSize}px;">${_esc(school.name)}</div>
                </div>
            </div>

            <div class="certificate-divider"></div>
            <div class="certificate-title">Experience Certificate</div>
            <div class="certificate-divider"></div>

            <div class="certificate-body">
                <p>This is to certify that <strong>${_esc(staff.name)}</strong>, ${guardianLine}has served as
                an <strong>${_esc(position)}</strong> from <strong>${startDate}</strong> to <strong>${endDate}</strong>.</p>

                <p>During ${p.poss} tenure with us, ${p.subj} taught <strong>${subjectsLine}</strong>
                to classes <strong>${classesLine}</strong>.</p>

                <p>During ${p.poss} employment, we found ${p.obj} to be hardworking, dedicated, punctual, and
                highly professional. ${p.subj.charAt(0).toUpperCase() + p.subj.slice(1)} possesses excellent
                classroom management skills and maintains strong professional relationships with students,
                colleagues, and parents.</p>

                <p>We appreciate ${p.poss} contributions to our institution and wish ${p.obj} all the best
                and success in future endeavors.</p>
            </div>

            <div class="certificate-footer">
                <div>
                    <div class="certificate-date">Date: ${_todayLong()}</div>
                    <div class="certificate-corner"></div>
                </div>
                <div class="certificate-signature">
                    <div class="sig-line">&nbsp;</div>
                    <div>(Name)</div>
                    <div>(Position)</div>
                    <div>Principal, ${_esc(school.name)}</div>
                </div>
            </div>
        </div>
    </div>`;

    document.getElementById('certificate-modal-body').innerHTML = html;
}

function closeCertificateModal() {
    document.getElementById('certificate-modal').classList.add('d-none');
    document.getElementById('certificate-modal-body').innerHTML = '';
    _certStaffId = null;
}

/* Self-contained certificate CSS, inlined directly into the print popup.
   We used to <link> to the app's main manage-staff.css from the popup, but
   that external load would silently fail in a lot of environments (opening
   the app as a local file, popups treated as a separate origin, slow/blocked
   requests, etc). When it failed there was NO styling at all in the popup,
   which is why the printout came out as plain unstyled text instead of the
   certificate template. Everything the certificate needs (colors, borders,
   corner flourishes as inline SVG data-URIs) is self-contained, so inlining
   it here removes that external dependency completely and makes printing
   reliable everywhere. Keep this in sync with the .certificate-* rules in
   manage-staff.css if the certificate design changes. */
const _CERT_PRINT_CSS = `
@page { size: A4; margin: 0; }
html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    width: 100%;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: Georgia, 'Times New Roman', serif;
}
.certificate-page {
    width: 794px;
    min-height: 1123px;
    background: #f7faf9;
    color: #1a2e2c;
    font-family: Georgia, 'Times New Roman', serif;
    height: 1123px;
    position: relative;
    box-shadow: none !important;
    flex-shrink: 0;
    padding: 34px;
    box-sizing: border-box;
    margin: 0 auto;
    display: flex;
}
.certificate-border {
    border: 3px double #2f7d6b;
    border-radius: 4px;
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    padding: 46px 56px;
    position: relative;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
}
.certificate-border::before {
    content: '';
    position: absolute;
    inset: 10px;
    border: 1px solid #2f7d6b;
    opacity: 0.5;
    pointer-events: none;
}
.corner-flourish {
    position: absolute;
    width: 88px;
    height: 88px;
    background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Cg%20fill='none'%20stroke='%232f7d6b'%20stroke-width='1.3'%3E%3Cpath%20d='M4,4%20Q4,46%2046,46%20Q88,46%2088,4'%20opacity='0.55'/%3E%3Cpath%20d='M4,16%20Q4,58%2058,58%20Q98,58%2098,18'%20opacity='0.3'/%3E%3Cpath%20d='M4,28%20Q4,4%2028,4'%20opacity='0.7'/%3E%3Cpath%20d='M12,4%20Q26,4%2026,18%20Q26,30%2012,28%20Q2,26%206,16%20Q10,8%2018,10'%20opacity='0.6'/%3E%3C/g%3E%3Ccircle%20cx='4'%20cy='4'%20r='2.6'%20fill='%232f7d6b'%20opacity='0.7'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: none;
    z-index: 0;
}
.corner-tl { top: 4px; left: 4px; }
.corner-tr { top: 4px; right: 4px; transform: scaleX(-1); }
.corner-bl { bottom: 4px; left: 4px; transform: scaleY(-1); }
.corner-br { bottom: 4px; right: 4px; transform: scale(-1, -1); }
.certificate-header,
.certificate-divider,
.certificate-title,
.certificate-body,
.certificate-footer {
    position: relative;
    z-index: 1;
}
.certificate-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
}
.certificate-brand {
    display: flex;
    align-items: center;
    gap: 16px;
}
.certificate-logo-wrap {
    position: relative;
    flex-shrink: 0;
    width: 56px;
    height: 56px;
}
.certificate-brand img {
    width: 56px;
    height: 56px;
    object-fit: cover;
    border-radius: 50%;
    background: #fff;
    border: 2px solid #fff;
    box-shadow: 0 4px 14px rgba(47, 125, 107, 0.35);
    position: relative;
    z-index: 1;
    display: block;
}
.certificate-logo-ring {
    position: absolute;
    top: -4px;
    left: -4px;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    border: 2px solid rgba(47, 125, 107, 0.35);
    pointer-events: none;
}
.certificate-logo-fallback {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #f2f8f6;
    border: 2px solid #fff;
    box-shadow: 0 4px 14px rgba(47, 125, 107, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 1;
}
.certificate-school-name {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: #1f4e42;
    text-transform: uppercase;
    line-height: 1.25;
    white-space: nowrap;
}
.certificate-contact {
    text-align: right;
    font-size: 12.5px;
    color: #2f5b52;
    line-height: 1.6;
    white-space: pre-line;
}
.certificate-divider {
    height: 2px;
    background: #2f7d6b;
    margin: 22px 0;
    opacity: 0.7;
}
.certificate-title {
    text-align: center;
    font-size: 30px;
    letter-spacing: 3px;
    font-weight: 700;
    color: #1f4e42;
    text-transform: uppercase;
    margin: 6px 0 22px;
}
.certificate-body p {
    font-size: 15.5px;
    line-height: 1.9;
    text-align: justify;
    text-align-last: center;
    text-justify: inter-word;
    word-spacing: 1px;
    color: #223330;
    margin: 0 0 20px;
}
.certificate-body { flex: 1 1 auto; }
.certificate-body strong { color: #1f4e42; }
.certificate-footer {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-top: auto;
    padding-top: 40px;
}
.certificate-date { font-size: 14px; color: #223330; }
.certificate-signature {
    text-align: center;
    font-size: 13px;
    color: #223330;
    line-height: 1.5;
}
.certificate-signature .sig-line {
    font-family: 'Brush Script MT', cursive;
    font-size: 24px;
    color: #1f4e42;
    border-bottom: 1px solid #2f7d6b;
    padding: 0 10px 6px;
    margin-bottom: 6px;
    min-width: 180px;
}
.certificate-corner {
    margin-top: 18px;
    width: 130px;
    height: 40px;
    opacity: 0.65;
    background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20260%2070'%3E%3Cg%20fill='none'%20stroke='%232f7d6b'%20stroke-width='1.4'%3E%3Cpath%20d='M4,50%20Q40,10%2080,40%20Q110,62%20130,35'/%3E%3Cpath%20d='M130,35%20Q150,8%20180,30%20Q210,55%20250,20'/%3E%3Ccircle%20cx='4'%20cy='50'%20r='3'%20fill='%232f7d6b'%20stroke='none'/%3E%3Ccircle%20cx='250'%20cy='20'%20r='3'%20fill='%232f7d6b'%20stroke='none'/%3E%3C/g%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-size: contain;
    background-position: left center;
}
@media print {
    .certificate-page {
        width: 210mm;
        height: 297mm;
        min-height: 297mm;
        margin: 0;
        padding: 10mm;
        box-shadow: none !important;
        display: flex;
    }
}
`;

/** Print via a dedicated A4-sized print window (keeps app chrome out of the printout). */
function printCertificate() {
    const page = document.getElementById('certificate-page');
    if (!page) return;
    const printWin = window.open('', '_blank');
    if (!printWin) return; // popup blocked

    printWin.document.write(`
        <html><head><title>Experience Certificate</title>
        <style>${_CERT_PRINT_CSS}</style>
        </head><body>${page.outerHTML}</body></html>`);
    printWin.document.close();

    // No external resources (CSS, fonts, images) are loaded anymore — the
    // logo is always a data URL/inline SVG and the styles above are inlined
    // — so we don't need to wait on printWin.onload for a stylesheet fetch.
    // A short delay is still kept purely to let the popup finish its own
    // initial layout/paint before the print dialog opens.
    setTimeout(() => { printWin.focus(); printWin.print(); }, 250);
}

/** Rasterize the certificate to a PNG blob using html2canvas. */
async function _renderCertificateBlob() {
    const page = document.getElementById('certificate-page');
    if (!page || typeof html2canvas === 'undefined') return null;
    const canvas = await html2canvas(page, {
        scale: 2,
        backgroundColor: '#f7faf9',
        useCORS: true,
        allowTaint: false,
        imageTimeout: 3000,
        logging: false,
        // Drop any image that failed to load so html2canvas never errors on it.
        onclone: (doc) => {
            doc.querySelectorAll('#certificate-page img').forEach(img => {
                const ok = img.complete && img.naturalWidth > 0;
                if (!ok) img.outerHTML = _CERT_FALLBACK_CREST;
            });
        }
    });
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function downloadCertificateImage() {
    const staff = staffData['Teaching'].find(s => s.id === _certStaffId);
    const blob = await _renderCertificateBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(staff && staff.name) || 'staff'}-experience-certificate.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function shareCertificateWhatsApp() {
    const staff = staffData['Teaching'].find(s => s.id === _certStaffId);
    const name = (staff && staff.name) || 'Staff';
    const blob = await _renderCertificateBlob();
    if (!blob) return;
    const fileName = `${name}-experience-certificate.png`;

    try {
        const file = new File([blob], fileName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
            await navigator.share({
                files: [file],
                title: `${name} — Experience Certificate`,
                text: `Experience certificate for ${name}`
            });
            return;
        }
    } catch (err) {
        if (err && err.name === 'AbortError') return; // user cancelled share sheet
    }

    // Fallback: download locally, then open WhatsApp with a text prompt
    // (a plain wa.me link can't carry file bytes into WhatsApp).
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    const msg = encodeURIComponent(`Experience certificate for ${name} — file downloaded, please attach it in WhatsApp.`);
    window.open(`https://wa.me/?text=${msg}`, '_blank');
}

/* ---- OVERRIDE: showProfileView — reveal the certificate button for Teaching only ---- */
const _showProfileView_beforeCertificate = showProfileView;
showProfileView = function(staffId, category) {
    _showProfileView_beforeCertificate(staffId, category);
    const certBtn = document.getElementById('generate-certificate-btn');
    if (!certBtn) return;
    if (category === 'Teaching') {
        certBtn.classList.remove('d-none');
    } else {
        certBtn.classList.add('d-none');
    }
}

/* ============================================
   STAFF ID GENERATION (linked to access-control.js)
   Uses the school prefix the Super Admin set, e.g. PSC_S_1, PSC_S_2
   ============================================ */
function generateStaffId() {
    const all = []
        .concat(staffData['Teaching'] || [])
        .concat(staffData['Non-Teaching'] || []);
    const ids = all.map(s => s && s.id).filter(Boolean);

    if (window.SoftSchoolAdmin && typeof window.SoftSchoolAdmin.nextStaffId === 'function') {
        return window.SoftSchoolAdmin.nextStaffId(ids);
    }

    // Fallback when no school is registered yet in Super Admin
    const prefix = 'SCH';
    const re = new RegExp('^' + prefix + '_S_(\\d+)$', 'i');
    let max = 0;
    ids.forEach(id => {
        const m = re.exec(String(id).trim());
        if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
    });
    return prefix + '_S_' + (max + 1);
}