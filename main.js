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
    
    // Dashboard data is never persisted in browser storage. Theme is kept
    // in memory for this page only.
    root.setAttribute('data-theme', 'dark');

    if (toggleBtn) toggleBtn.addEventListener('click', () => {
        const currentTheme = root.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        root.setAttribute('data-theme', newTheme);
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
   ---------------------------------------------------------------------------
   This page is read-only. It reads the same backend records used by Student
   Management and Finance instead of depending on a separate dashboard
   endpoint or browser storage.
   ============================================ */

function _getSchoolId() {
    if (window.SoftSchoolAdmin && typeof window.SoftSchoolAdmin.getCurrentSchool === 'function') {
        const school = window.SoftSchoolAdmin.getCurrentSchool();
        if (school && school.schoolId) return school.schoolId;
    }
    return '';
}

const DASHBOARD_BACKEND_ORIGIN = 'http://localhost:8080';

function _dashboardMonthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function _dashboardFeeMonthKey(date = new Date()) {
    const d = new Date(date);
    if (d.getDate() >= 27) d.setMonth(d.getMonth() + 1);
    return _dashboardMonthKey(d);
}

function _dashboardPreviousMonthKey(monthKey) {
    const [year, month] = String(monthKey).split('-').map(Number);
    return _dashboardMonthKey(new Date(year, (month || 1) - 2, 1));
}

function _dashboardNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function _dashboardIsActiveStudent(student) {
    const status = String((student && student.status) || '').trim().toLowerCase();
    return !status || status === 'active';
}

function _dashboardArray(data, keys = []) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of keys) {
        if (Array.isArray(data[key])) return data[key];
    }
    return [];
}

function _dashboardStaffArray(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    const result = [];
    ['staff', 'employees', 'members', 'items', 'content', 'data',
        'Teaching', 'Non-Teaching', 'teaching', 'nonTeaching'].forEach(key => {
        if (Array.isArray(data[key])) result.push(...data[key]);
    });
    return result;
}

async function _dashboardGet(path, fallback) {
    const schoolId = _getSchoolId();
    const separator = path.includes('?') ? '&' : '?';
    try {
        const response = await fetch(
            `${DASHBOARD_BACKEND_ORIGIN}${path}${separator}schoolId=${encodeURIComponent(schoolId)}`,
            { headers: { 'Content-Type': 'application/json' } }
        );
        if (!response.ok) return fallback;
        const text = await response.text();
        return text ? JSON.parse(text) : fallback;
    } catch (error) {
        console.warn(`[Dashboard] Could not read ${path}:`, error);
        return fallback;
    }
}

function _dashboardDate(value, fallbackMonthKey) {
    const parsed = value
        ? new Date(value)
        : new Date(`${fallbackMonthKey}-01T00:00:00`);
    return Number.isNaN(parsed.getTime())
        ? new Date(`${fallbackMonthKey}-01T00:00:00`)
        : parsed;
}

function _dashboardPaidFine(fine) {
    const status = String(fine && (fine.paymentStatus ?? fine.status) || '').toLowerCase();
    return status === 'paid' || status === 'settled';
}

async function _dashboardFineRecords(students, monthKey) {
    const records = [];
    await Promise.all(students.map(async student => {
        const id = student.regNo || student.id;
        if (!id) return;
        const data = await _dashboardGet(
            `/api/finance/fine-details/${encodeURIComponent(id)}/${encodeURIComponent(monthKey)}`,
            []
        );
        if (Array.isArray(data)) {
            data.forEach(fine => records.push({
                ...fine,
                date: _dashboardDate(fine.payDate || fine.paymentDate || fine.createdAt, monthKey)
            }));
        }
    }));
    return records;
}

function _dashboardCustomFeesCollected(customFees, monthKey) {
    return _dashboardArray(customFees).reduce((total, fee) => {
        if (fee.monthKey && fee.monthKey !== monthKey) return total;
        const records = Array.isArray(fee.records) ? fee.records : [];
        return total + records.filter(record => record.paid).length * _dashboardNumber(fee.amount);
    }, 0);
}

function _dashboardStaffAmount(items, monthKey) {
    return _dashboardArray(items).reduce((total, item) => {
        if (item.monthKey && item.monthKey !== monthKey) return total;
        return total + _dashboardNumber(item.amount || item.netPaid || item.value);
    }, 0);
}

function _dashboardSalaryAmount(salaryRecords, staff, monthKey) {
    const paidRows = _dashboardArray(salaryRecords)
        .filter(row => !row.monthKey || row.monthKey === monthKey);
    if (paidRows.length) {
        return paidRows.reduce((total, row) =>
            total + _dashboardNumber(row.netPaid || row.baseSalary || row.amount), 0);
    }
    // If payroll has not been posted yet, show the roster's monthly salary
    // obligation rather than an unexplained zero.
    return staff.reduce((total, member) => total + _dashboardNumber(member.salary), 0);
}

async function _dashboardAttendance() {
    const now = new Date();
    const dateKey = `${_dashboardMonthKey(now)}-${String(now.getDate()).padStart(2, '0')}`;
    const data = await _dashboardGet(`/api/attendance?date=${encodeURIComponent(dateKey)}`, null);
    if (!data) return { presentStudents: 0, presentStaff: 0, hasData: false };

    const record = Array.isArray(data) ? data[0] : (data.record || data.data || data);
    if (!record || typeof record !== 'object') {
        return { presentStudents: 0, presentStaff: 0, hasData: false };
    }
    const presentStudents = _dashboardNumber(record.presentStudents ?? record.studentsPresent);
    const presentStaff = _dashboardNumber(
        record.presentStaff ?? record.staffPresent ?? record.presentTeachers
    );
    const hasData = record.hasData !== undefined
        ? Boolean(record.hasData)
        : presentStudents > 0 || presentStaff > 0 ||
          record.totalStudents != null || record.totalStaff != null;
    return { presentStudents, presentStaff, hasData };
}

async function _dashboardSnapshot(
    monthKey, students, staff, statusRows, customFees, staffBonus, staffFines, expenses, salaryRecords
) {
    const activeStudents = students.filter(_dashboardIsActiveStudent);
    const statusByStudent = new Map(_dashboardArray(statusRows)
        .filter(row => row && row.regNo)
        .map(row => [String(row.regNo), row]));
    // BUGFIX — "Expected Fees" didn't match Manage Finance's fine-inclusive
    // totals and never moved when a fine was added. This used to be a
    // static `standardFee + transportFee` per student, completely ignoring
    // the live backend fee record (arrears rolled over from last month,
    // and any fine applied this month). Manage Finance's "Total with Fine"
    // is built from each student's live `netPayable` (base fee + arrears +
    // fine — see FinanceController#calculateNetPayable), so we now mirror
    // that here: use the student's current-month Finance master row when
    // one exists (i.e. a fee record has actually been generated for them),
    // and only fall back to the plain base fee for students who haven't
    // been billed yet this month.
    const expected = activeStudents.reduce((total, student) => {
        const row = statusByStudent.get(String(student.regNo || student.id || ''));
        if (row && row.netPayable != null) {
            return total + _dashboardNumber(row.netPayable);
        }
        return total + _dashboardNumber(student.standardFee) + _dashboardNumber(student.transportFee);
    }, 0);
    const collected = activeStudents.reduce((total, student) => {
        const row = statusByStudent.get(String(student.regNo || student.id || ''));
        return total + _dashboardNumber(row && row.paidAmount);
    }, 0);

    const fineRecords = await _dashboardFineRecords(activeStudents, monthKey);
    const paidFines = fineRecords.filter(_dashboardPaidFine);
    const studentLate = paidFines
        .filter(fine => /late|overdue|delay/i.test(String(fine.reason || '')))
        .reduce((total, fine) => total + _dashboardNumber(fine.amount), 0);
    const studentOther = paidFines
        .filter(fine => !/late|overdue|delay/i.test(String(fine.reason || '')))
        .reduce((total, fine) => total + _dashboardNumber(fine.amount), 0);

    const staffFineRows = _dashboardArray(staffFines);
    const staffTotal = staffFineRows
        .filter(item => !/absence/i.test(String(item.reason || item.label || '')))
        .reduce((total, item) => total + _dashboardNumber(item.amount), 0);
    const teacherAbsence = staffFineRows
        .filter(item => /absence/i.test(String(item.reason || item.label || '')))
        .reduce((total, item) => total + _dashboardNumber(item.amount), 0);
    const admissionFees = activeStudents.reduce(
        (total, student) => total + _dashboardNumber(student.admissionFee), 0
    );

    return {
        realStudentCount: activeStudents.length,
        fees: { expected, collected, pending: Math.max(0, expected - collected) },
        fines: { studentLate, studentOther, staffTotal, teacherAbsence },
        admissionFees,
        customFeesCollected: _dashboardCustomFeesCollected(customFees, monthKey),
        salaries: { total: _dashboardSalaryAmount(salaryRecords, staff, monthKey) },
        staffBonusTotal: _dashboardStaffAmount(staffBonus, monthKey),
        otherExpensesTotal: _dashboardStaffAmount(expenses, monthKey)
    };
}

async function calculateFinancials() {
    const currentMonth = _dashboardFeeMonthKey();
    const previousMonth = _dashboardPreviousMonthKey(currentMonth);
    const [
        studentsData,
        staffData,
        currentStatus,
        previousStatus,
        customFees,
        staffBonus,
        staffFines,
        expenses,
        salaryRecords,
        attendance
    ] = await Promise.all([
        _dashboardGet('/api/students', []),
        _dashboardGet('/api/staff', []),
        _dashboardGet(`/api/finance/status-all/${encodeURIComponent(currentMonth)}`, []),
        _dashboardGet(`/api/finance/status-all/${encodeURIComponent(previousMonth)}`, []),
        _dashboardGet('/api/finance/custom-fees', []),
        _dashboardGet('/api/finance/staff-bonus', []),
        _dashboardGet('/api/finance/staff-fines', []),
        _dashboardGet('/api/finance/expenses', []),
        _dashboardGet('/api/finance/salary/records', []),
        _dashboardAttendance()
    ]);

    const students = _dashboardArray(studentsData);
    const staff = _dashboardStaffArray(staffData);
    const current = await _dashboardSnapshot(
        currentMonth, students, staff, currentStatus, customFees,
        staffBonus, staffFines, expenses, salaryRecords
    );
    const previous = await _dashboardSnapshot(
        previousMonth, students, staff, previousStatus, customFees,
        staffBonus, staffFines, expenses, salaryRecords
    );

    const revenue = snapshot => snapshot.fees.collected
        + snapshot.fines.studentLate
        + snapshot.fines.studentOther
        + snapshot.fines.staffTotal
        + snapshot.fines.teacherAbsence
        + snapshot.admissionFees
        + snapshot.customFeesCollected;
    const expensesTotal = snapshot => snapshot.salaries.total
        + snapshot.staffBonusTotal
        + snapshot.otherExpensesTotal;

    return {
        ...current,
        totalStaff: staff.length,
        netExpenses: expensesTotal(current),
        netProfit: revenue(current) - expensesTotal(current),
        lastMonthProfit: revenue(previous) - expensesTotal(previous),
        todayAttendance: attendance
    };
}