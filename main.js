/**
 * EDUFLOW PRO - DASHBOARD LOGIC
 */

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSidebar();
    initNavSearch();
    initDate();
    calculateAndLoadDashboardData();
    // Add this inside DOMContentLoaded in index.js
window.addEventListener('storage', (e) => {
    if (['edu_students', 'eduflow-db', 'eduflow-student-fines',
         'eduflow-staff-fines', 'eduflow-staff-bonus', 'eduflow-other-expenses',
         'edu_staff', 'eduflow-staff-advances', 'edu_latefee_config',
         'edu_attendance', 'eduflow-attendance-records'].includes(e.key)) {
        calculateAndLoadDashboardData();
    }
});

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
   SIDEBAR SEARCH FILTER
   ============================================ */
function initNavSearch() {
    const input = document.getElementById('nav-search');
    if (!input) return;
    const links = document.querySelectorAll('.sidebar-nav .nav-link');

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        links.forEach(link => {
            const label = link.querySelector('span')?.textContent.toLowerCase() || '';
            link.style.display = label.includes(q) ? 'flex' : 'none';
        });
    });
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
   DASHBOARD DATA & LOGIC SIMULATION
   ============================================ */

function calculateAndLoadDashboardData() {
    const data = calculateFinancials();
    
    // 1. CALCULATE TOTALS FIRST
    // Net Expenses = Salaries + Bonuses + Other Expenses
    const netExp = data.salaries.total + data.staffBonusTotal + data.otherExpensesTotal;
    
    // Total Revenue = Collected Fees + all fines (late, manual student+staff, staff absence) + Admission Fees
    const totalRev = data.fees.collected
        + data.fines.studentLate
        + data.fines.studentOther
        + data.fines.staffTotal
        + data.fines.teacherAbsence
        + data.admissionFees;
    
    // Net Profit = Revenue - Expenses
    const netProfit = totalRev - netExp;

    // 2. HEADCOUNT (feeds the quick-stats strip, no dedicated card anymore)
    const totalStaff = (data.db.staff['Teaching']?.length || 0) + (data.db.staff['Non-Teaching']?.length || 0);

    // 3. UPDATE THE UI (Revenue)
    animateCounter('expected-fees', data.fees.expected);
    animateCounter('collected-fees', data.fees.collected);
    animateCounter('pending-fees', data.fees.pending);
    animateCounter('student-late-fines', data.fines.studentLate); 
    animateCounter('student-other-fines', data.fines.studentOther + data.fines.staffTotal); 
    animateCounter('teacher-absence-fines', data.fines.teacherAbsence);

    // 3b. ADMISSION FEES — only appears once at least one student has an
    // admission fee on record; otherwise it just sits at 0 like any other metric.
    animateCounter('admission-fees', data.admissionFees);

    // 3c. TOTAL REVENUE — collected fees + every fine + admission fees, all together
    animateCounter('total-revenue', totalRev);

    // 4. UPDATE THE UI (Expenses)
    animateCounter('base-salaries', data.salaries.total);
    animateCounter('staff-bonus', data.staffBonusTotal);
    animateCounter('other-expenses', data.otherExpensesTotal);
    
    // 5. UPDATE THE UI (Net Totals)
    animateCounter('net-expenses', netExp);
    animateCounter('net-profit', netProfit);
    animateCounter('past-month-profit', data.lastMonthProfit);

    // 6. UPDATE TREND ARROW
    const lastMonth = data.lastMonthProfit;
    const profitDiff = netProfit - lastMonth;
    const percentChange = lastMonth !== 0 ? ((profitDiff / lastMonth) * 100).toFixed(1) : "100";

    const trendEl = document.getElementById('profit-trend');
    if (trendEl) {
        if (profitDiff >= 0) {
            trendEl.className = 'trend up';
            trendEl.innerHTML = `<i class="fas fa-arrow-up"></i> ${percentChange}% vs last month`;
        } else {
            trendEl.className = 'trend down';
            trendEl.innerHTML = `<i class="fas fa-arrow-down"></i> ${Math.abs(percentChange)}% vs last month`;
        }
    }

    // 7. UPDATE QUICK STATS STRIP + TODAY'S ATTENDANCE
    loadAttendanceData(data.realStudentCount, totalStaff);
}

/* ============================================
   TODAY'S ATTENDANCE
   ============================================
   Looks for attendance data under 'edu_attendance', keyed by date
   (YYYY-MM-DD) with the shape:
   { "2026-07-01": { students: { studentId: true/false, ... },
                      staff:    { staffId: true/false, ... } } }
   Also supports a flat record list under 'eduflow-attendance-records':
   [{ date: "2026-07-01", type: "student"|"staff", present: true/false }, ...]
   If your attendance.html page (once built) writes to either of these
   keys/shapes, this card updates automatically — no other changes needed.
   ============================================ */
function getTodayAttendance() {
    const todayKey = new Date().toISOString().split('T')[0];

    // Format 1: unified object keyed by date
    try {
        const store = JSON.parse(localStorage.getItem('edu_attendance') || '{}');
        const today = store[todayKey];
        if (today && (today.students || today.staff)) {
            const studentVals = today.students ? Object.values(today.students) : [];
            const staffVals = today.staff ? Object.values(today.staff) : [];
            const presentStudents = studentVals.filter(v => v === true || v === 'present').length;
            const presentStaff = staffVals.filter(v => v === true || v === 'present').length;
            return { presentStudents, presentStaff, hasData: true };
        }
    } catch (e) { /* ignore malformed data */ }

    // Format 2: flat record array
    try {
        const records = JSON.parse(localStorage.getItem('eduflow-attendance-records') || '[]');
        const todays = records.filter(r => r.date === todayKey);
        if (todays.length) {
            const presentStudents = todays.filter(r => r.type === 'student' && (r.status === 'present' || r.present === true)).length;
            const presentStaff = todays.filter(r => r.type === 'staff' && (r.status === 'present' || r.present === true)).length;
            return { presentStudents, presentStaff, hasData: true };
        }
    } catch (e) { /* ignore malformed data */ }

    return { presentStudents: 0, presentStaff: 0, hasData: false };
}

function loadAttendanceData(totalStudents, totalStaff) {
    const { presentStudents, presentStaff, hasData } = getTodayAttendance();

    // Quick stats strip
    animateCounter('strip-total-students', totalStudents);
    animateCounter('strip-total-staff', totalStaff);
    animateCounter('strip-present-students', presentStudents);
    animateCounter('strip-present-staff', presentStaff);

    // Ring captions
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setText('present-students-count', presentStudents);
    setText('total-students-2', totalStudents);
    setText('present-teachers-count', presentStaff);
    setText('total-staff-2', totalStaff);

    // Percentages
    const studentPct = totalStudents > 0 ? Math.round((presentStudents / totalStudents) * 100) : 0;
    const staffPct = totalStaff > 0 ? Math.round((presentStaff / totalStaff) * 100) : 0;
    setText('student-attendance-pct', studentPct + '%');
    setText('teacher-attendance-pct', staffPct + '%');

    setRingProgress('ring-students', studentPct);
    setRingProgress('ring-staff', staffPct);

    // Badge + empty-state note
    const badge = document.getElementById('attendance-date-badge');
    const note = document.getElementById('attendance-empty-note');
    if (badge) {
        if (hasData) {
            badge.className = 'trend up';
            badge.innerHTML = '<i class="fas fa-circle" style="font-size:7px;"></i> Live';
        } else {
            badge.className = 'trend neutral';
            badge.innerHTML = '<i class="fas fa-circle" style="font-size:7px;"></i> Not marked yet';
        }
    }
    if (note) {
        note.style.display = hasData ? 'none' : 'block';
    }
}

function setRingProgress(elementId, percent) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const radius = 45;
    const circumference = 2 * Math.PI * radius; // ~282.74
    const clamped = Math.max(0, Math.min(100, percent));
    const offset = circumference - (clamped / 100) * circumference;
    // Defer so the transition animates from the initial full-offset state
    requestAnimationFrame(() => {
        el.style.strokeDashoffset = offset;
    });
}

/* ============================================
   COUNTER ANIMATION & FORMATTING
   ============================================ */
function animateCounter(elementId, target) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (target === 0) {
        el.textContent = '0';
        return;
    }

    let current = 0;
    const duration = 1200; // ms
    const stepTime = 30; // ms
    const increment = Math.max(1, Math.floor(target / (duration / stepTime)));

    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            current = target;
            clearInterval(timer);
        }
        // Format with commas for readability
        el.textContent = current.toLocaleString();
    }, stepTime);
}

function calculateFinancials() {
    // 1. Get the global database
    const db = getGlobalData();
    
    // 2. Get Real Student Data (for fee calculations)
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');
    
    // 3. GET STAFF BONUS TOTAL
    const bonusRecords = JSON.parse(localStorage.getItem('eduflow-staff-bonus') || '[]');
    const totalStaffBonuses = bonusRecords.reduce((sum, record) => sum + (Number(record.amount) || 0), 0);

    // 4. GET STAFF FINES TOTAL
    const fineRecords = JSON.parse(localStorage.getItem('eduflow-staff-fines') || '[]');
    const totalStaffFines = fineRecords.reduce((sum, record) => sum + (Number(record.amount) || 0), 0);

    // 5. GET OTHER EXPENSES TOTAL — read directly from eduflow-other-expenses for real-time accuracy
    const expenseRecords = JSON.parse(localStorage.getItem('eduflow-other-expenses') || '[]');
    const totalOtherExpenses = expenseRecords.reduce((sum, record) => sum + (Number(record.amount) || 0), 0);

    // 6. GET TEACHER ABSENCE FINES — sum t.fines from all Teaching + Non-Teaching staff
    const allStaff = [...(db.staff.Teaching || []), ...(db.staff['Non-Teaching'] || [])];
    const totalTeacherAbsenceFines = allStaff.reduce((sum, t) => sum + (Number(t.fines) || 0), 0);

    // 7. GET STUDENT FINES — read from eduflow-student-fines for real-time accuracy
    const studentFineRecords = JSON.parse(localStorage.getItem('eduflow-student-fines') || '[]');
    const totalStudentFines = studentFineRecords.reduce((sum, record) => sum + (Number(record.amount) || 0), 0);

    // 8. Calculate Student Fees
    let expected = 0;
    let collected = 0;
    let admissionFees = 0;
    students.forEach(s => {
        expected += (Number(s.standardFee) || 0);
        (s.feePayments || []).forEach(p => {
            collected += (Number(p.amount) || 0);
        });
        // Admission Fee is a one-time charge captured on the student's record
        // at the time of admission — only counts once anything is actually entered.
        admissionFees += (Number(s.admissionFee) || 0);
    });

    // 9. Return the data object
    return {
        db: db,
        realStudentCount: students.length,
        fees: {
            expected: expected,
            collected: collected,
            pending: Math.max(0, expected - collected)
        },
        admissionFees: admissionFees,
        fines: {
            studentLate: computeStudentLateFinesTotal() + (db.students?.fines?.lateFees || 0),
            studentOther: totalStudentFines,
            staffTotal: totalStaffFines,
            teacherAbsence: totalTeacherAbsenceFines
        },
        salaries: {
            total: allStaff.reduce((s, t) => s + (Number(t.salary) || 0), 0)
        },
        staffBonusTotal: totalStaffBonuses,
        otherExpensesTotal: totalOtherExpenses,
        netExpenses: 0,
        netProfit: 0,
        lastMonthProfit: 50000 // Placeholder
    };
}

/* ============================================
   STUDENT LATE-FEE COMPUTATION
   ============================================
   Reads late-fee config from 'edu_latefee_config' (saved by settings.js)
   and sums lateFeeSurcharge for every student whose CURRENT-month voucher
   is unpaid and past the (deadlineDay + grace) cut-off.
   This mirrors the logic in manage-finance.js (getVoucherSettings /
   computeFeeBreakdown) so the dashboard reflects real outstanding
   late-fee charges. */
function computeStudentLateFinesTotal() {
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('edu_latefee_config') || '{}'); } catch(e) {}
    const enabled = cfg.enabled !== false;
    if (!enabled) return 0;

    const deadlineDay = parseInt(cfg.deadlineDay, 10) || 10;
    const grace       = parseInt(cfg.grace, 10) || 0;
    const lateType    = cfg.type || 'fixed';
    const lateVal     = parseFloat(cfg.amount) || 200;
    const cutoffDay   = deadlineDay + grace;

    const today = new Date();
    if (today.getDate() <= cutoffDay) return 0; // not yet late this month

    const monthKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
    const students = JSON.parse(localStorage.getItem('edu_students') || '[]');

    let total = 0;
    students.forEach(s => {
        const tuition   = Number(s.standardFee)   || 0;
        const transport = Number(s.transportFee)  || 0;
        const baseMonthly = Math.max(0, tuition + transport
            - (Number(s.tuitionDiscount)   || 0)
            - (Number(s.transportDiscount) || 0)
            - (Number(s.siblingDiscount)   || 0));
        if (baseMonthly <= 0) return;

        const paidThisMonth = (s.feePayments || [])
            .filter(p => p.monthKey === monthKey)
            .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        if (paidThisMonth >= baseMonthly) return; // already paid

        const surcharge = lateType === 'percent'
            ? Math.round(baseMonthly * (lateVal / 100))
            : lateVal;
        total += surcharge;
    });
    return total;
}
