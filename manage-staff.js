/**
 * EDULOW PRO - STAFF MANAGEMENT LOGIC
 */

document.addEventListener('DOMContentLoaded', () => {
    updateStaffCounters();
    
    // Sidebar toggle logic
    const sidebar = document.getElementById('sidebar');
    document.getElementById('open-sidebar').onclick = () => sidebar.classList.add('active');
    document.getElementById('close-sidebar').onclick = () => sidebar.classList.remove('active');

    // Handle Form Submission
    const staffForm = document.getElementById('staff-form');
    staffForm.onsubmit = (e) => {
        e.preventDefault();
        saveStaffMember();
    };
});

// GLOBAL STATE
let currentViewCategory = "";

function openStaffModal(category) {
    const modal = document.getElementById('staff-form-modal');
    const form = document.getElementById('staff-form');
    form.reset();
    
    document.getElementById('staff-id').value = "";
    document.getElementById('staff-category').value = category;
    document.getElementById('modal-title').innerText = `Add New ${category} Staff`;
    document.getElementById('display-id').value = "NEW-EMP-" + Math.floor(Math.random() * 9000);
    
    modal.style.display = 'block';
}

function openDirectoryModal(category) {
    currentViewCategory = category;
    document.getElementById('directory-title').innerText = `${category} Directory`;
    refreshTable();
    document.getElementById('directory-modal').style.display = 'block';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function saveStaffMember() {
    const form = document.getElementById('staff-form');
    const formData = new FormData(form);
    const staffData = Object.fromEntries(formData);
    
    let database = JSON.parse(localStorage.getItem('edu_staff') || '[]');

    if (staffData.id) {
        // Edit Mode
        const index = database.findIndex(s => s.id === staffData.id);
        database[index] = staffData;
    } else {
        // Add Mode
        staffData.id = "EMP-" + Date.now(); // Unique ID
        database.push(staffData);
    }

    localStorage.setItem('edu_staff', JSON.stringify(database));
    closeModal('staff-form-modal');
    updateStaffCounters();
    alert("Staff Record Saved Successfully!");
}

function refreshTable() {
    const database = JSON.parse(localStorage.getItem('edu_staff') || '[]');
    const searchTerm = document.getElementById('staff-search').value.toLowerCase();
    const tbody = document.getElementById('staff-table-body');
    
    tbody.innerHTML = "";

    const filtered = database.filter(s => 
        s.category === currentViewCategory && 
        (s.name.toLowerCase().includes(searchTerm) || s.id.toLowerCase().includes(searchTerm))
    );

    filtered.forEach(s => {
        tbody.innerHTML += `
            <tr>
                <td>${s.id.substring(0,8)}</td>
                <td><strong>${s.name}</strong></td>
                <td>${s.designation}</td>
                <td>${s.department || 'N/A'}</td>
                <td>${s.phone}</td>
                <td>
                    <button onclick="editStaff('${s.id}')" class="btn-tiny">Edit</button>
                    <button onclick="deleteStaff('${s.id}')" class="btn-tiny" style="background:#e74c3c">Del</button>
                </td>
            </tr>
        `;
    });
}

function editStaff(id) {
    const database = JSON.parse(localStorage.getItem('edu_staff') || '[]');
    const staff = database.find(s => s.id === id);
    
    openStaffModal(staff.category);
    
    const form = document.getElementById('staff-form');
    document.getElementById('staff-id').value = staff.id;
    document.getElementById('modal-title').innerText = "Edit Staff Record";
    document.getElementById('display-id').value = staff.id;

    Object.keys(staff).forEach(key => {
        const input = form.querySelector(`[name="${key}"]`);
        if(input) input.value = staff[key];
    });
}

function deleteStaff(id) {
    if(confirm("Delete this record permanently?")) {
        let database = JSON.parse(localStorage.getItem('edu_staff') || '[]');
        database = database.filter(s => s.id !== id);
        localStorage.setItem('edu_staff', JSON.stringify(database));
        refreshTable();
        updateStaffCounters();
    }
}

function updateStaffCounters() {
    const database = JSON.parse(localStorage.getItem('edu_staff') || '[]');
    const teaching = database.filter(s => s.category === 'Teaching').length;
    const nonTeaching = database.filter(s => s.category === 'Non-Teaching').length;

    document.getElementById('count-total-staff').innerText = database.length;
    document.getElementById('count-teaching').innerText = teaching;
    document.getElementById('count-non-teaching').innerText = nonTeaching;
}