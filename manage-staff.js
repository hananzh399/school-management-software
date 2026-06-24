/**
 * EDUFLOW PRO - STAFF MANAGEMENT LOGIC
 */

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSidebar();
    initDate();
    loadStaffCounts(true);
    
    // Search listener
    document.getElementById('staff-search').addEventListener('input', handleSearch);
});

/* ============================================
   THEME TOGGLE
   ============================================ */
function initTheme() {
    const toggleBtn = document.getElementById('theme-toggle');
    const root = document.documentElement;
    
    // Check local storage or default to dark
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

    // Create an overlay element
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
   VIEW MANAGEMENT (State Navigation)
   ============================================ */
const VIEWS = {
    CARDS: 'category-cards',
    DIRECTORY: 'directory-view',
    PROFILE: 'profile-view'
};

let currentCategory = 'Teaching'; // Default

function switchView(viewId) {
    document.getElementById(VIEWS.CARDS).classList.add('d-none');
    document.getElementById(VIEWS.DIRECTORY).classList.add('d-none');
    document.getElementById(VIEWS.PROFILE).classList.add('d-none');
    
    document.getElementById(viewId).classList.remove('d-none');
}

function showCategoryCards() {
    switchView(VIEWS.CARDS);
    loadStaffCounts(true);
}

function showDirectoryView(category) {
    currentCategory = category;
    document.getElementById('directory-title').textContent = category + " Staff";
    document.getElementById('staff-search').value = ""; // clear search
    
    // Update Add button text dynamically
    const addBtnText = category === 'Teaching' ? 'Add Teacher' : 'Add Staff';
    document.getElementById('add-btn-text').textContent = addBtnText;
    
    populateDirectory(category);
    switchView(VIEWS.DIRECTORY);
}

function backToDirectory() {
    switchView(VIEWS.DIRECTORY);
}

/* ============================================
   SAMPLE DATA & TABLE POPULATION
   ============================================ */
// Read from global state instead of local variable
let staffData = getGlobalData().staff;

let currentProfileId = null;

function loadStaffCounts(animate = false) {
    // Refresh staffData from global state just in case it changed elsewhere
    staffData = getGlobalData().staff;
    const tCount = staffData['Teaching'].length;
    const ntCount = staffData['Non-Teaching'].length;

    if(animate) {
        animateValue('teaching-count', 0, tCount, 800);
        animateValue('non-teaching-count', 0, ntCount, 800);
    } else {
        document.getElementById('teaching-count').textContent = tCount;
        document.getElementById('non-teaching-count').textContent = ntCount;
    }
}

function animateValue(id, start, end, duration) {
    if (start === end) {
        document.getElementById(id).textContent = end;
        return;
    }
    let range = end - start;
    let current = start;
    let increment = end > start ? 1 : -1;
    let stepTime = Math.abs(Math.floor(duration / range));
    let obj = document.getElementById(id);
    let timer = setInterval(function() {
        current += increment;
        obj.textContent = current;
        if (current == end) {
            clearInterval(timer);
        }
    }, stepTime);
}

function populateDirectory(category, searchTerm = "") {
    const tbody = document.getElementById('directory-tbody');
    const noResults = document.getElementById('no-results');
    tbody.innerHTML = '';

    let data = staffData[category];

    // Filter by search term
    if (searchTerm) {
        searchTerm = searchTerm.toLowerCase();
        data = data.filter(s => 
            s.name.toLowerCase().includes(searchTerm) || 
            s.id.toLowerCase().includes(searchTerm)
        );
    }

    if (data.length === 0) {
        noResults.classList.remove('d-none');
    } else {
        noResults.classList.add('d-none');
        data.forEach(staff => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="badge">${staff.id}</span></td>
                <td class="font-medium">${staff.name}</td>
                <td>${staff.gender}</td>
                <td>${staff.phone}</td>
                <td>
                    <button class="btn btn-sm btn-icon" onclick="showProfileView('${staff.id}', '${category}')" title="View Profile">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
}

function handleSearch(e) {
    populateDirectory(currentCategory, e.target.value);
}

/* ============================================
   PROFILE VIEW POPULATION
   ============================================ */
function showProfileView(id, category) {
    currentProfileId = id;
    const staff = staffData[category].find(s => s.id === id);
    if (!staff) return;

    document.getElementById('pv-name').textContent = staff.name;
    document.getElementById('pv-id').textContent = staff.id;
    document.getElementById('pv-gender').textContent = staff.gender;
    document.getElementById('pv-cnic').textContent = staff.cnic;
    document.getElementById('pv-phone').textContent = staff.phone;
    document.getElementById('pv-address').textContent = staff.address;

    const roleContainer = document.getElementById('pv-role-details');
    roleContainer.innerHTML = '';

    if (category === 'Teaching') {
        roleContainer.innerHTML = `
            <div class="detail-group">
                <label>Qualification</label>
                <p>${staff.qualification || '-'}</p>
            </div>
            <div class="detail-group">
                <label>Subjects Taught</label>
                <p>${staff.subjects || '-'}</p>
            </div>
            <div class="detail-group">
                <label>Classes Assigned</label>
                <p>${staff.classes || '-'}</p>
            </div>
            <div class="detail-group">
                <label>Class Incharge Of</label>
                <p>${staff.incharge || '-'}</p>
            </div>
            <div class="detail-group">
                <label>Salary</label>
                <p>RS ${staff.salary || '-'}</p>
            </div>
            <div class="detail-group">
                <label>Joined Date</label>
                <p>${staff.joined || '-'}</p>
            </div>
        `;
    } else {
        roleContainer.innerHTML = `
            <div class="detail-group">
                <label>Job Title</label>
                <p>${staff.job || '-'}</p>
            </div>
            <div class="detail-group">
                <label>Salary</label>
                <p>RS ${staff.salary || '-'}</p>
            </div>
            <div class="detail-group">
                <label>Shift Timing</label>
                <p>${staff.startTime || '-'} to ${staff.endTime || '-'}</p>
            </div>
        `;
    }

    switchView(VIEWS.PROFILE);
}

/* ============================================
   DELETE MODAL LOGIC
   ============================================ */
function openConfirmModal() {
    const staff = staffData[currentCategory].find(s => s.id === currentProfileId);
    document.getElementById('confirm-name').textContent = staff.name;
    
    // Update confirmation text based on role
    const modalTitle = currentCategory === 'Teaching' ? 'Remove Teacher' : 'Remove Staff Member';
    document.getElementById('confirm-title').textContent = modalTitle;
    
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
   ADD / EDIT FORM LOGIC
   ============================================ */
let isEditMode = false;

function openAddForm() {
    isEditMode = false;
    currentProfileId = null;
    
    // Set dynamic form title
    const formTitle = currentCategory === 'Teaching' ? 'Add Teacher' : 'Add Staff Member';
    document.getElementById('form-title').textContent = formTitle;
    document.getElementById('form-submit-btn').textContent = "Save Staff";
    
    document.getElementById('staff-form').reset();
    toggleFormFields(currentCategory);
    document.getElementById('form-modal').classList.remove('d-none');
}

function openEditForm() {
    isEditMode = true;
    const staff = staffData[currentCategory].find(s => s.id === currentProfileId);
    
    // Set dynamic form title
    const formTitle = currentCategory === 'Teaching' ? 'Edit Teacher' : 'Edit Staff Member';
    document.getElementById('form-title').textContent = formTitle;
    document.getElementById('form-submit-btn').textContent = "Update Staff";

    toggleFormFields(currentCategory);
    
    // Common fields
    document.getElementById('f-name').value = staff.name || '';
    document.getElementById('f-gender').value = staff.gender || '';
    document.getElementById('f-cnic').value = staff.cnic || '';
    document.getElementById('f-phone').value = staff.phone || '';
    document.getElementById('f-address').value = staff.address || '';

    // Specific fields
    if (currentCategory === 'Teaching') {
        document.getElementById('f-qual').value = staff.qualification || '';
        document.getElementById('f-subjects').value = staff.subjects || '';
        document.getElementById('f-classes').value = staff.classes || '';
        document.getElementById('f-incharge').value = staff.incharge || '';
        document.getElementById('f-salary-t').value = (staff.salary || '').toString().replace(/[^0-9]/g, '');
        // Date parsing could be added if dates are standard ISO, skipping for simple mockup
    } else {
        document.getElementById('f-job').value = staff.job || '';
        document.getElementById('f-salary-nt').value = (staff.salary || '').toString().replace(/[^0-9]/g, '');
        document.getElementById('f-start').value = staff.startTime || '';
        document.getElementById('f-end').value = staff.endTime || '';
    }

    document.getElementById('form-modal').classList.remove('d-none');
}

function closeFormModal() {
    document.getElementById('form-modal').classList.add('d-none');
}

function toggleFormFields(category) {
    const teachFields = document.getElementById('form-teaching-fields');
    const ntFields = document.getElementById('form-nonteaching-fields');
    
    // Ensure inputs in hidden sections aren't required when hidden
    const ntJobInput = document.getElementById('f-job');
    
    if (category === 'Teaching') {
        teachFields.classList.remove('d-none');
        ntFields.classList.add('d-none');
        ntJobInput.removeAttribute('required');
    } else {
        teachFields.classList.add('d-none');
        ntFields.classList.remove('d-none');
        ntJobInput.setAttribute('required', 'true');
    }
}

function handleFormSubmit(e) {
    e.preventDefault();

    // Gather common data
    const newData = {
        name: document.getElementById('f-name').value,
        gender: document.getElementById('f-gender').value,
        cnic: document.getElementById('f-cnic').value,
        phone: document.getElementById('f-phone').value,
        address: document.getElementById('f-address').value,
    };

    if (currentCategory === 'Teaching') {
        newData.qualification = document.getElementById('f-qual').value;
        newData.subjects = document.getElementById('f-subjects').value;
        newData.classes = document.getElementById('f-classes').value;
        newData.incharge = document.getElementById('f-incharge').value;
        newData.salary = document.getElementById('f-salary-t').value;
        newData.joined = document.getElementById('f-joined').value;
    } else {
        newData.job = document.getElementById('f-job').value;
        newData.salary = document.getElementById('f-salary-nt').value;
        newData.startTime = document.getElementById('f-start').value;
        newData.endTime = document.getElementById('f-end').value;
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
