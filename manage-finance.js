/**
 * EDULOW PRO - FINANCE MANAGEMENT LOGIC
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initial state: Hub is visible, others hidden via HTML
    renderFees('All');
});

/**
 * Switcher function for Finance Modules
 */
function showFinanceModule(moduleId) {
    const hub = document.getElementById('finance-hub-section');
    const studentFees = document.getElementById('student-fees-module');
    const placeholders = document.getElementById('other-modules-placeholder');
    
    // Hide everything
    hub.style.display = 'none';
    studentFees.style.display = 'none';
    placeholders.style.display = 'none';

    if (moduleId === 'hub') {
        hub.style.display = 'block';
    } else if (moduleId === 'student-fees') {
        studentFees.style.display = 'block';
        backToClassSelection(); // Ensure we start at the card grid
    } else {
        placeholders.style.display = 'block';
        document.getElementById('placeholder-title').innerText = moduleId.replace('-', ' ').toUpperCase();
    }
}
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
function viewVoucher(studentId) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const student = students.find(s => String(s.id) === String(studentId));
    if (!student) {
        alert('Student record not found.');
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

function buildVoucherHTML(s) {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const dueDate = new Date(today.getFullYear(), today.getMonth(), 10);
    const dueDateStr = dueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const monthLabel = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const challanNo = `CH-${s.id}-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

    const photoSrc = s.photo || s.picture || s.image || '';
    const photoBlock = photoSrc
        ? `<img src="${photoSrc}" class="v-photo" alt="${s.fullName}">`
        : `<div class="v-photo v-photo-placeholder"><i class="fas fa-user"></i></div>`;

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
                ${photoBlock}
            </div>

            <div class="voucher-meta-row">
                <div><span>Challan No.</span><strong>${challanNo}</strong></div>
                <div><span>Issue Date</span><strong>${dateStr}</strong></div>
                <div><span>Due Date</span><strong>${dueDateStr}</strong></div>
            </div>

            <div class="voucher-divider"></div>

            <div class="voucher-student-grid">
                <div><span>Student ID</span><strong>${s.id}</strong></div>
                <div><span>Student Name</span><strong>${s.fullName}</strong></div>
                <div><span>Class</span><strong>${s.studentClass || '-'}</strong></div>
                <div><span>Guardian</span><strong>${s.guardianName || '-'}</strong></div>
            </div>

            <table class="voucher-fee-table">
                <thead>
                    <tr><th>Description</th><th>Period</th><th>Amount</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Tuition Fee</td>
                        <td>${monthLabel}</td>
                        <td>Rs. ${s.netPayable}</td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="2">Total Payable</td>
                        <td>Rs. ${s.netPayable}</td>
                    </tr>
                </tfoot>
            </table>

            <div class="voucher-footer">
                <div class="voucher-note"><i class="fas fa-info-circle"></i> Please pay before the due date to avoid late fee surcharge.</div>
                <div class="voucher-signature">
                    <div class="sig-line"></div>
                    <span>Authorized Signature</span>
                </div>
            </div>
        </div>
    `;

    return `
        <div class="voucher-sheet">
            ${copy('School Copy')}
            ${copy('Student Copy')}
        </div>
    `;
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

function renderFees(className) {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const tbody = document.getElementById('fee-table-body');
    if(!tbody) return;
    
    tbody.innerHTML = "";
    
    // Filter students by the selected class
    const filtered = students.filter(s => s.studentClass === className);

    if(filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px;">No students found enrolled in <strong>${className}</strong>.</td></tr>`;
        return;
    }

     filtered.forEach(s => {
        tbody.innerHTML += `
            <tr>
                <td><span class="hrk-id-badge">${s.id}</span></td>
                <td><strong>${s.fullName}</strong></td>
                <td>${s.guardianName}</td>
                <td><strong style="color:#27ae60">Rs. ${s.netPayable}</strong></td>
                <td>
                    <button class="btn-tiny" onclick="viewVoucher('${s.id}')">
                        <i class="fas fa-eye"></i> View Voucher
                    </button>
                </td>
            </tr>
        `;
    });
}