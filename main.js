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
    // Net Expenses = only money that has actually gone out the door:
    // Paid Salaries (posted payroll + advances) + Bonuses given + Other
    // Expenses logged. Pending Salaries is deliberately left out — it's
    // what's still owed, not a cost incurred yet, so Net Expenses should
    // stay at 0 (plus whatever's genuinely been paid) until a salary,
    // bonus, or expense is actually recorded.
    const netExp = data.salaries.paid + data.staffBonusTotal + data.otherExpensesTotal;
    
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
    // FEATURE — this box now shows STAFF FINE only (Manage Finance > Staff
    // Fines), no longer student fine + staff fine combined. Student "other"
    // fines still exist in data.fines.studentOther and still count toward
    // Total Revenue below — they just aren't shown in this particular box
    // anymore.
    animateCounter('student-other-fines', data.fines.staffTotal);
    animateCounter('teacher-absence-fines', data.fines.teacherAbsence);

    // 3b. ADMISSION FEES
    animateCounter('admission-fees', data.admissionFees);

    // 3b-2. CUSTOM FEE COLLECTED
    // (Fees & Finance page) that has actually been marked Paid per student.
    animateCounter('custom-fees-collected', data.customFeesCollected);

    // 3c. TOTAL REVENUE — collected fees + every fine + admission fees + custom fees, all together
    animateCounter('total-revenue', totalRev);

    // 4. UPDATE THE UI (Expenses)
    animateCounter('payable-salaries', data.salaries.payable);
    animateCounter('paid-salaries', data.salaries.paid);
    animateCounter('pending-salaries', data.salaries.pending);
    animateCounter('advance-salaries', data.salaries.advance);
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

const DASHBOARD_BACKEND_ORIGIN = 'https://softschool-production.up.railway.app';

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

/**
 * FIX — "Past Month Profit changes after adding a record this month":
 * A handful of records/fields are untagged or otherwise not truly scoped to
 * the month they're being read for (legacy rows saved before `monthKey`
 * existed, or fields that only ever reflect "right now"). The old filters
 * below (`!item.monthKey || item.monthKey === monthKey`) treated an
 * untagged item as matching *every* month it was asked about — so the same
 * record got counted into both the current AND the previous month's totals
 * at once, and "last month" drifted every time something new was added
 * this month. An untagged/legacy item should only ever count toward the
 * *current* month (never retroactively toward a prior one).
 */
function _dashboardBelongsToMonth(itemMonthKey, targetMonthKey, currentMonthKey) {
    if (itemMonthKey) return itemMonthKey === targetMonthKey;
    return targetMonthKey === currentMonthKey;
}

function _dashboardCustomFeesCollected(customFees, monthKey, currentMonthKey) {
    return _dashboardArray(customFees).reduce((total, fee) => {
        if (!_dashboardBelongsToMonth(fee.monthKey, monthKey, currentMonthKey)) return total;
        const records = Array.isArray(fee.records) ? fee.records : [];
        return total + records.filter(record => record.paid).length * _dashboardNumber(fee.amount);
    }, 0);
}

function _dashboardStaffAmount(items, monthKey, currentMonthKey) {
    return _dashboardArray(items).reduce((total, item) => {
        if (!_dashboardBelongsToMonth(item.monthKey, monthKey, currentMonthKey)) return total;
        return total + _dashboardNumber(item.amount || item.netPaid || item.value);
    }, 0);
}

function _dashboardSalaryAmount(salaryRecords, staff, monthKey, currentMonthKey) {
    // Payable = the roster's full monthly salary obligation, regardless of
    // what's actually been posted/paid yet. Mirrors Staff.getSalary(), the
    // same field FinanceController#paySalary reads as `baseSalary`.
    const payable = staff.reduce((total, member) => total + _dashboardNumber(member.salary), 0);

    // Paid (payroll-only) = whatever's actually posted for this month
    // (Finance TYPE_SALARY rows). netPaid is the true amount disbursed
    // (base + bonus − fines − advance settled − security); fall back for
    // older rows. Advances get folded in on top of this by the caller
    // (_dashboardSnapshot), since money already handed out as an advance is
    // just as "paid" as a posted payroll run — see the note in
    // _dashboardAdvanceTotal.
    const paidRows = _dashboardArray(salaryRecords)
        .filter(row => _dashboardBelongsToMonth(row.monthKey, monthKey, currentMonthKey));
    const paidFromPayroll = paidRows.reduce((total, row) =>
        total + _dashboardNumber(row.netPaid ?? row.baseSalary ?? row.amount), 0);

    return { payable, paidFromPayroll };
}

/**
 * Advance = salary staff have drawn ahead of payroll and not yet settled.
 * Real data comes from GET /api/finance/staff-advances, which merges live
 * Finance TYPE_ADVANCE rows (paymentStatus "Advance" = outstanding,
 * "Settled" = already deducted from a paid salary, see
 * FinanceController#paySalary) with the legacy staff-advances bulk bucket.
 * Only unsettled rows for the current month count here — once a payroll run
 * settles an advance, it's folded into that run's netPaid instead, so
 * counting a settled row here too would double it. An unsettled advance is
 * still real cash that's already left the building, so it's added into
 * Paid Salaries by the caller (_dashboardSnapshot), which then also
 * recomputes Pending Salaries and Total Net Expenses off that updated
 * paid figure.
 */
function _dashboardAdvanceTotal(staffAdvances, monthKey, currentMonthKey) {
    return _dashboardArray(staffAdvances)
        .filter(item => _dashboardBelongsToMonth(item.monthKey, monthKey, currentMonthKey))
        .filter(item => String(item.paymentStatus || '').toLowerCase() !== 'settled')
        .reduce((total, item) => total + _dashboardNumber(item.amount), 0);
}

/**
 * Manual staff fines (Manage Finance > Staff Fines) vs. auto absence fines.
 * These are NOT the same bucket: manual fines live in the TYPE_STAFF_FINE
 * bulk list (field `amount`, no "absence" reason ever appears there), while
 * absence fines are written straight onto each staff member's own `fines`
 * field by attendance.js and never appear in the fines list at all.
 *
 * `member.fines` is a live, current-state field — it's never stamped with a
 * monthKey and is only ever meaningful for "right now" (see manage-finance.js,
 * which itself only reads it when `isCurrentMonth` is true and otherwise
 * treats it as unavailable). So it must never be attributed to a past
 * month's snapshot — otherwise a fine issued today shows up as if it also
 * happened last month.
 */
function _dashboardStaffFineTotals(staffFines, staff, monthKey, currentMonthKey) {
    const staffTotal = _dashboardArray(staffFines)
        .filter(item => _dashboardBelongsToMonth(item.monthKey, monthKey, currentMonthKey))
        .reduce((total, item) => total + _dashboardNumber(item.amount), 0);

    const teacherAbsence = monthKey === currentMonthKey
        ? staff.reduce((total, member) => total + _dashboardNumber(member.fines), 0)
        : 0;

    return { staffTotal, teacherAbsence };
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

/**
 * A student's admissionDate tells us which real-world month their admission
 * fee actually belongs to. Falls back to null (unknown) when the date is
 * missing/unparseable, in which case the fee is only ever attributed to the
 * current month (see _dashboardSnapshot below) — never retroactively to a
 * past month.
 */
function _dashboardAdmissionMonthKey(student) {
    if (!student || !student.admissionDate) return null;
    const parsed = new Date(student.admissionDate);
    return Number.isNaN(parsed.getTime()) ? null : _dashboardFeeMonthKey(parsed);
}

async function _dashboardSnapshot(
    monthKey, students, staff, statusRows, customFees, staffBonus, staffFines,
    expenses, salaryRecords, staffAdvances, currentMonthKey
) {
    const activeStudents = students.filter(_dashboardIsActiveStudent);
    const statusByStudent = new Map(_dashboardArray(statusRows)
        .filter(row => row && row.regNo)
        .map(row => [String(row.regNo), row]));
    // Expected Fees = exactly Manage Finance's "Total with Fine" figure
    // (updateFeeStatsHeader()'s fee-stat-totalfine box: totalCollected +
    // totalPending). That box only ever includes students who've actually
    // been billed this month (a generated voucher / Finance fee-master row
    // exists) — an unbilled student contributes nothing there, even though
    // they have a standardFee on their roster record. So unlike our old
    // fallback (which added base fee + transport for unbilled students,
    // inflating Expected Fees above what Manage Finance shows), we now
    // only sum `netPayable` — base fee + rolled-over arrears + any fine,
    // see FinanceController#calculateNetPayable — for students who have a
    // live fee-master row this month, and skip students with none. This
    // also means Expected Fees updates automatically the moment a fine or
    // a newly generated fee touches that row, with no caching in between.
    const expected = activeStudents.reduce((total, student) => {
        const row = statusByStudent.get(String(student.regNo || student.id || ''));
        return (row && row.netPayable != null) ? total + _dashboardNumber(row.netPayable) : total;
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

    const { staffTotal, teacherAbsence } = _dashboardStaffFineTotals(
        staffFines, staff, monthKey, currentMonthKey
    );
    // FIX — admission fees now scoped to the month the student was actually
    // admitted in (see _dashboardAdmissionMonthKey), instead of every active
    // student's admissionFee being summed into every month unconditionally.
    // That old behaviour meant "last month" always showed the exact same
    // admission-fee total as "this month", for a figure that never actually
    // happened last month.
    const admissionFees = activeStudents.reduce((total, student) => {
        const admissionMonth = _dashboardAdmissionMonthKey(student);
        const belongsHere = admissionMonth
            ? admissionMonth === monthKey
            : monthKey === currentMonthKey;
        return belongsHere ? total + _dashboardNumber(student.admissionFee) : total;
    }, 0);

    // Paid Salaries = posted payroll + any still-outstanding advances (cash
    // already handed to staff counts as paid even before it's formally
    // settled through a payroll run). Pending then reflects what's left of
    // the obligation after that combined figure.
    const { payable, paidFromPayroll } = _dashboardSalaryAmount(
        salaryRecords, staff, monthKey, currentMonthKey
    );
    const advance = _dashboardAdvanceTotal(staffAdvances, monthKey, currentMonthKey);
    const paid = paidFromPayroll + advance;
    const pending = Math.max(0, payable - paid);

    return {
        realStudentCount: activeStudents.length,
        fees: { expected, collected, pending: Math.max(0, expected - collected) },
        fines: { studentLate, studentOther, staffTotal, teacherAbsence },
        admissionFees,
        customFeesCollected: _dashboardCustomFeesCollected(customFees, monthKey, currentMonthKey),
        salaries: { payable, paid, pending, advance },
        staffBonusTotal: _dashboardStaffAmount(staffBonus, monthKey, currentMonthKey),
        otherExpensesTotal: _dashboardStaffAmount(expenses, monthKey, currentMonthKey)
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
        staffAdvances,
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
        _dashboardGet('/api/finance/staff-advances', []),
        _dashboardAttendance()
    ]);

    const students = _dashboardArray(studentsData);
    const staff = _dashboardStaffArray(staffData);
    const current = await _dashboardSnapshot(
        currentMonth, students, staff, currentStatus, customFees,
        staffBonus, staffFines, expenses, salaryRecords, staffAdvances, currentMonth
    );
    const previous = await _dashboardSnapshot(
        previousMonth, students, staff, previousStatus, customFees,
        staffBonus, staffFines, expenses, salaryRecords, staffAdvances, currentMonth
    );

    const revenue = snapshot => snapshot.fees.collected
        + snapshot.fines.studentLate
        + snapshot.fines.studentOther
        + snapshot.fines.staffTotal
        + snapshot.fines.teacherAbsence
        + snapshot.admissionFees
        + snapshot.customFeesCollected;
    const expensesTotal = snapshot => snapshot.salaries.paid
        + snapshot.staffBonusTotal
        + snapshot.otherExpensesTotal;

    // FEATURE — "Past Month Profit should read 0 for a brand-new school,
    // and must stay untouched by anything added to the CURRENT month":
    // every figure that feeds this check is now properly scoped to the
    // snapshot's own month (fee-master rows, salary records, fines, staff
    // bonus/expenses, custom fees, and — as of this fix — admission fees
    // and staff-absence fines too, see _dashboardAdmissionMonthKey and
    // _dashboardStaffFineTotals). `salaries.payable` is deliberately left
    // out here: it's just the staff roster's current salary total, not
    // scoped to any month at all, so it can never be used as a signal that
    // a *specific* month had real activity — a school with staff on the
    // books but zero transactions would otherwise always look "active".
    // A school with no billing history yet will have every one of these at
    // 0 for "previous month". Once a fee voucher, salary payment, fine, an
    // admission, etc. has actually happened in a given month, that month's
    // snapshot trips this and lastMonthProfit reflects the real number —
    // and only for the month it truly happened in.
    const hasRealActivity = snapshot =>
        snapshot.fees.expected > 0 ||
        snapshot.fees.collected > 0 ||
        snapshot.fines.studentLate > 0 ||
        snapshot.fines.studentOther > 0 ||
        snapshot.fines.staffTotal > 0 ||
        snapshot.fines.teacherAbsence > 0 ||
        snapshot.customFeesCollected > 0 ||
        snapshot.admissionFees > 0 ||
        snapshot.salaries.paid > 0 ||
        snapshot.salaries.advance > 0 ||
        snapshot.staffBonusTotal > 0 ||
        snapshot.otherExpensesTotal > 0;

    const lastMonthProfit = hasRealActivity(previous)
        ? (revenue(previous) - expensesTotal(previous))
        : 0;

    return {
        ...current,
        totalStaff: staff.length,
        netExpenses: expensesTotal(current),
        netProfit: revenue(current) - expensesTotal(current),
        lastMonthProfit,
        todayAttendance: attendance
    };
}