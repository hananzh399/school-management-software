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
    try {
        const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
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
        const prevUnpaid = Math.max(0, monthlyExpected - prevPayments);
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

const originalShowFinanceModule = showFinanceModule;
showFinanceModule = function(moduleId) {
    originalShowFinanceModule(moduleId);
    const finesModule = document.getElementById('student-fines-module');
    finesModule.style.display = (moduleId === 'student-fines-module') ? 'block' : 'none';
    if(moduleId === 'student-fines-module') searchFineStudents();
};

function searchFineStudents() {
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const sId = document.getElementById('fine-search-id').value.toLowerCase();
    const sName = document.getElementById('fine-search-name').value.toLowerCase();
    const sGuard = document.getElementById('fine-search-guardian').value.toLowerCase();
    const sClass = document.getElementById('fine-search-class').value;

    const filtered = students.filter(s => {
        const matchesId = String(s.id).toLowerCase().includes(sId);
        const matchesName = s.fullName.toLowerCase().includes(sName);
        const matchesGuardian = (s.guardianName || "").toLowerCase().includes(sGuard);
        const matchesClass = sClass === "" || s.studentClass === sClass;
        return matchesId && matchesName && matchesGuardian && matchesClass;
    });

    renderFineSearchResults(filtered);
}

function renderFineSearchResults(list) {
    const tbody = document.getElementById('fine-search-results');
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:#64748b;">No students match your search.</td></tr>`;
        return;
    }

    list.forEach(s => {
        const activeFineCount = (s.fines || []).length;
        tbody.innerHTML += `
            <tr>
                <td><span class="hrk-id-badge">${s.id}</span></td>
                <td><strong>${s.fullName}</strong></td>
                <td>${s.studentClass}</td>
                <td>${activeFineCount > 0 ? `<span class="fine-badge">${activeFineCount} Active</span>` : '<span style="color:#cbd5e1">-</span>'}</td>
                <td>
                    <button class="btn-tiny btn-fine" onclick="openFineModal('${s.id}')">
                        <i class="fas fa-plus-circle"></i> Add Fine
                    </button>
                </td>
            </tr>
        `;
    });
}

function openFineModal(studentId) {
    document.getElementById('target-fine-student-id').value = studentId;
    document.getElementById('fine-entry-modal').style.display = 'flex';
}

function closeFineModal() {
    document.getElementById('fine-entry-modal').style.display = 'none';
    // Clear inputs
    document.getElementById('fine-amount').value = "";
    document.getElementById('fine-reason').value = "";
}

function toggleInstallmentInput() {
    const type = document.getElementById('fine-payment-type').value;
    document.getElementById('installment-config').style.display = (type === 'installment') ? 'block' : 'none';
}

function saveFineToStudent() {
    const studentId = document.getElementById('target-fine-student-id').value;
    const amount = parseFloat(document.getElementById('fine-amount').value);
    const reason = document.getElementById('fine-reason').value || "General Fine";
    const type = document.getElementById('fine-payment-type').value;
    const months = parseInt(document.getElementById('fine-months').value) || 1;

    if (!amount || amount <= 0) {
        alert("Please enter a valid fine amount.");
        return;
    }

    let students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const index = students.findIndex(s => String(s.id) === String(studentId));

    if (index !== -1) {
        if (!students[index].fines) students[index].fines = [];

        const monthlyInstallment = type === 'installment' ? (amount / months) : amount;
        
        students[index].fines.push({
            id: Date.now(),
            reason: reason,
            totalAmount: amount,
            monthlyAmount: monthlyInstallment,
            remainingInstallments: type === 'installment' ? months : 1,
            dateAdded: new Date().toISOString()
        });

        localStorage.setItem('edu_students', JSON.stringify(students));
        alert(`Fine of Rs. ${amount} added to ${students[index].fullName}'s record.`);
        closeFineModal();
        searchFineStudents();
    }
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
    
    const filtered = className === 'All'
        ? students
        : students.filter(s => s.studentClass === className);

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
                <td style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button class="btn-tiny" onclick="viewVoucher('${s.id}', '${escapeForAttr(s.fullName||'')}')">
                        <i class="fas fa-eye"></i> Voucher
                    </button>
                    <button class="btn-tiny btn-add-fees" onclick="openAddFeesModal('${s.id}', '${escapeForAttr(s.fullName||'')}')">
                        <i class="fas fa-plus-circle"></i> Add Fees
                    </button>
                    <button class="btn-tiny btn-add-to-voucher" onclick="openAddToVoucherModal('${s.id}', '${escapeForAttr(s.fullName||'')}')">
                        <i class="fas fa-file-invoice-dollar"></i> Add Fees to Voucher
                    </button>
                </td>
            </tr>
        `;
    });
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
