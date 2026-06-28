/**
 * EDUFLOW PRO - DASHBOARD LOGIC
 */

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSidebar();
    initDate();
    calculateAndLoadDashboardData();
    // Add this inside DOMContentLoaded in index.js
window.addEventListener('storage', (e) => {
    if (['edu_students', 'eduflow-db', 'eduflow-student-fines',
         'eduflow-staff-fines', 'eduflow-staff-bonus', 'eduflow-other-expenses',
         'edu_staff', 'eduflow-staff-advances'].includes(e.key)) {
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
    
    // Total Revenue = Collected Fees + all fines (late, manual student+staff, staff absence)
    const totalRev = data.fees.collected
        + data.fines.studentLate
        + data.fines.studentOther
        + data.fines.staffTotal
        + data.fines.teacherAbsence;
    
    // Net Profit = Revenue - Expenses
    const netProfit = totalRev - netExp;

    // 2. UPDATE THE UI (Demographics)
    animateCounter('total-students', data.realStudentCount);
    const totalStaff = (data.db.staff['Teaching']?.length || 0) + (data.db.staff['Non-Teaching']?.length || 0);
    animateCounter('total-staff', totalStaff);

    // 3. UPDATE THE UI (Revenue)
    animateCounter('expected-fees', data.fees.expected);
    animateCounter('collected-fees', data.fees.collected);
    animateCounter('pending-fees', data.fees.pending);
    animateCounter('student-late-fines', data.fines.studentLate); 
    animateCounter('student-other-fines', data.fines.studentOther + data.fines.staffTotal); 
    animateCounter('teacher-absence-fines', data.fines.teacherAbsence);

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
}

/* ============================================
   COUNTER ANIMATION & FORMATTING
   ============================================ */
function animateCounter(elementId, target) {
    const el = document.getElementById(elementId);
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
    students.forEach(s => {
        expected += (Number(s.standardFee) || 0);
        (s.feePayments || []).forEach(p => {
            collected += (Number(p.amount) || 0);
        });
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
        fines: {
            studentLate: db.students?.fines?.lateFees || 0,
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
