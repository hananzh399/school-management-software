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
   LOAD & COUNT STAFF
   ============================================ */
function loadStaffCounts(animate = true) {
    // Read directly from the live staffData array instead of localStorage
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
    
    const staffList = staffData[category] || [];
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
        grid.innerHTML += createItem('Salary', staff.salary);
        grid.innerHTML += createItem('Date Joined', staff.joined);
        grid.innerHTML += createItem('CNIC', staff.cnic);
        grid.innerHTML += createItem('Phone Number', staff.phone);
        grid.innerHTML += createItem('Address', staff.address, true);
    } else {
        grid.innerHTML += createItem('Job Title', staff.job);
        grid.innerHTML += createItem('Gender', staff.gender);
        grid.innerHTML += createItem('Salary', staff.salary);
        grid.innerHTML += createItem('Start Time', staff.startTime);
        grid.innerHTML += createItem('End Time', staff.endTime);
        grid.innerHTML += createItem('CNIC', staff.cnic);
        grid.innerHTML += createItem('Phone Number', staff.phone);
        grid.innerHTML += createItem('Address', staff.address, true);
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

    const createInput = (id, label, type='text', fullWidth=false) => {
        return `
            <div class="form-group ${fullWidth ? 'full-width' : ''}">
                <label for="${id}">${label}</label>
                <input type="${type}" id="${id}" name="${id}" required>
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
        // Update existing
        let index = staffData[currentCategory].findIndex(s => s.id === currentProfileId);
        if (index > -1) {
            staffData[currentCategory][index] = { ...staffData[currentCategory][index], ...newData };
        }
        // Update profile view text
        showProfileView(currentProfileId, currentCategory);
    } else {
        // Add new
        const prefix = currentCategory === 'Teaching' ? 'TCH-' : 'NTS-';
        newData.id = prefix + Math.floor(1000 + Math.random() * 9000);
        newData.fines = 0; // Initialize fines
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
