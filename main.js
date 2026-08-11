/**
 * EDUFLOW PRO - DASHBOARD LOGIC
 */

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initSidebar();
    initNavSearch();
    initDate();
    await loadDashboardFromBackend();
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


async function loadDashboardFromBackend() {
    const data = await calculateFinancials();
    
    // 1. CALCULATE TOTALS FIRST
    // Net Expenses = Salaries + Bonuses + Other Expenses
    const netExp = data.salaries.total + data.staffBonusTotal + data.otherExpensesTotal;
    
    // Total Revenue = Collected Fees + all fines (late, manual student+staff, staff absence) + Admission Fees + Custom Fees Collected
    const totalRev = data.fees.collected
        + data.fines.studentLate
        + data.fines.studentOther
        + data.fines.staffTotal
        + data.fines.teacherAbsence
        + data.admissionFees
        + data.customFeesCollected;
    
    // Net Profit = Revenue - Expenses
    const netProfit = totalRev - netExp;

    // 2. HEADCOUNT (feeds the quick-stats strip, no dedicated card anymore)
    const totalStaff = data.totalStaff || 0;

    // 3. UPDATE THE UI (Revenue)
    animateCounter('expected-fees', data.fees.expected);
    animateCounter('collected-fees', data.fees.collected);
    animateCounter('pending-fees', data.fees.pending);
    animateCounter('student-late-fines', data.fines.studentLate); 
    animateCounter('student-other-fines', data.fines.studentOther + data.fines.staffTotal); 
    animateCounter('teacher-absence-fines', data.fines.teacherAbsence);

    // 3b. ADMISSION FEES
    animateCounter('admission-fees', data.admissionFees);

    // 3b-2. CUSTOM FEE COLLECTED
    // (Fees & Finance page) that has actually been marked Paid per student.
    animateCounter('custom-fees-collected', data.customFeesCollected);

    // 3c. TOTAL REVENUE — collected fees + every fine + admission fees + custom fees, all together
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
    loadAttendanceData(data.realStudentCount || 0, totalStaff, data.todayAttendance);
}

   

function loadAttendanceData(totalStudents, totalStaff, attendanceData) {
    const presentStudents = attendanceData ? attendanceData.presentStudents : 0;
    const presentStaff = attendanceData ? attendanceData.presentStaff : 0;
    const hasData = attendanceData ? attendanceData.hasData : false;

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
}/* ============================================
   FINANCIAL CALCULATIONS
   ============================================ */

function _getSchoolId() {
    if (window.SoftSchoolAdmin && typeof window.SoftSchoolAdmin.getCurrentSchool === 'function') {
        const school = window.SoftSchoolAdmin.getCurrentSchool();
        if (school && school.schoolId) return school.schoolId;
    }
    return '';
}

async function calculateFinancials() {
    try {
        const schoolId = _getSchoolId();
        const url = `http://localhost:8080/api/dashboard?schoolId=${encodeURIComponent(schoolId)}`;
        const res = await fetch(url, { headers: { "Content-Type": "application/json" }});
        if (res.ok) {
            return await res.json();
        } else {
            console.error('Failed to fetch dashboard data:', await res.text());
        }
    } catch (e) {
        console.error('Network error fetching dashboard data:', e);
    }
    
    return {
        realStudentCount: 0,
        totalStaff: 0,
        fees: { expected: 0, collected: 0, pending: 0 },
        admissionFees: 0,
        customFeesCollected: 0,
        fines: { studentLate: 0, studentOther: 0, staffTotal: 0, teacherAbsence: 0 },
        salaries: { total: 0 },
        staffBonusTotal: 0,
        otherExpensesTotal: 0,
        netExpenses: 0,
        netProfit: 0,
        lastMonthProfit: 0,
        todayAttendance: { presentStudents: 0, presentStaff: 0, hasData: false }
    };
}
