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
    // Paid Salaries (posted payroll + advances) + Other Expenses logged +
    // Dropout Staff Paid Salary (money already paid to staff who have
    // since been deleted — see the dropout-staff fetch in
    // calculateFinancials). Pending Salaries is deliberately left out —
    // it's what's still owed, not a cost incurred yet, so Net Expenses
    // should stay at 0 (plus whatever's genuinely been paid) until a
    // salary, expense, or dropout payout is actually recorded.
    //
    // FEATURE — Staff Bonus is deliberately NOT added into Net Expenses.
    // It still has its own "Staff Bonus" card (animateCounter('staff-bonus', ...)
    // below) so admins can see how much bonus has been given, but it no
    // longer reduces Net Expenses / Net Profit on this dashboard.
    const netExp = data.salaries.paid + data.otherExpensesTotal + data.dropoutStaffTotal;
    
    // Total Revenue = Collected Fees + Admission Fees + Custom Fees.
    //
    // BUGFIX — Total Revenue was double-counting student fines: a fine
    // that's been paid off (whether via the general "Pay Bill" flow or the
    // standalone "Pay Fine" button — see Finance#removeFineFromMaster /
    // FinanceController#processPayment on the backend) now always lands in
    // that student's ledger paidAmount, which is exactly what
    // data.fees.collected sums across every student below. Adding
    // data.fines.studentLate/studentOther on top of that counted the same
    // rupee twice — once as part of the fee bill collected, once again as
    // a "fine collected". Those two stat boxes (student-late-fines /
    // student-other-fines) still show the fine breakdown on their own; they
    // just no longer feed into Total Revenue a second time.
    //
    // BUGFIX — Net Profit was double-counting staff fines: a staff fine
    // (manual or absence) is not new cash coming in, it's cash that was
    // NOT paid out — Paid Salaries (data.salaries.paid, netExp above)
    // already comes out lower by exactly the fine amount, via each SALARY
    // record's totalDue = Gross − Fines (Finance#calculateSalaryDue()).
    // Adding that fine into Total Revenue too would count its effect on
    // profit twice, so staff fines were never added here either.
    const totalRev = data.fees.collected
        + data.admissionFees
        + data.customFeesCollected;

    // Net Profit = Revenue - Expenses (Actual Paid Salaries already nets
    // out staff fines, so they aren't added back in here either).
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
    animateCounter('dropout-staff-salary', data.dropoutStaffTotal);
    
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

/**
 * Sums the manual STAFF_FINE list plus (current month only) the staff
 * member's live absence-fine field for ONE staff member — the same two
 * sources FinanceController#paySalary / manage-finance.js's salary panel
 * combine into "Fines" when a payroll run actually happens. Used below so
 * an un-paid staff member's contribution to Total Due already reflects
 * fines on file, instead of assuming their full roster salary is owed.
 */
function _dashboardStaffFineFor(staffFines, staff, staffId, monthKey, currentMonthKey) {
    const manual = _dashboardArray(staffFines)
        .filter(item => String(item.staffId ?? item.id) === String(staffId))
        .filter(item => _dashboardBelongsToMonth(item.monthKey, monthKey, currentMonthKey))
        .reduce((total, item) => total + _dashboardNumber(item.amount), 0);
    const absence = monthKey === currentMonthKey
        ? _dashboardNumber((staff.find(m => String(m.staffId) === String(staffId)) || {}).fines)
        : 0;
    return manual + absence;
}

/**
 * FEATURE — "bonus should sit in Pending Salaries until it's actually
 * paid": mirrors _dashboardStaffFineFor above, but for the staff-bonus
 * bulk list. Same source manage-finance.js's showSalaryBreakdown() /
 * getEffectiveSalaryDuePreview() read (getStaffBonusData(), field
 * `amount`, matched by staffId + monthKey) and the same field
 * FinanceController#paySalary folds into a posted SALARY record's
 * totalDue (`baseSalary + bonus - fine - security`). Used below so an
 * un-paid staff member's Total Due already carries any bonus given this
 * month — previously this estimate only ever subtracted fines, so a
 * bonus never raised Pending Salaries at all; it only ever showed up in
 * the separate Staff Bonus card, even though the money is genuinely owed
 * until payroll actually pays it out.
 */
function _dashboardStaffBonusFor(staffBonus, staffId, monthKey, currentMonthKey) {
    return _dashboardArray(staffBonus)
        .filter(item => String(item.staffId ?? item.id) === String(staffId))
        .filter(item => _dashboardBelongsToMonth(item.monthKey, monthKey, currentMonthKey))
        .reduce((total, item) => total + _dashboardNumber(item.amount), 0);
}

function _dashboardSalaryAmount(salaryRecords, staff, staffFines, staffBonus, monthKey, currentMonthKey) {
    // Payable = the roster's full monthly salary obligation, regardless of
    // what's actually been posted/paid yet, fines included. Mirrors
    // Staff.getSalary(), the same field FinanceController#paySalary reads
    // as `baseSalary`. Shown as its own "Payable Salaries" figure — it is
    // NOT used for Pending below (see totalDue).
    const payable = staff.reduce((total, member) => total + _dashboardNumber(member.salary), 0);

    // Paid = whatever's actually posted for this month (Finance TYPE_SALARY
    // rows), using amountPaid — the record's authoritative "Advance +
    // Current Payment" total (Finance#calculateSalaryDue) — so a settled
    // advance that was folded into a payroll run stays counted here
    // instead of silently dropping out of "Paid Salaries" the moment it's
    // reconciled. Falls back to netPaid/baseSalary for older rows that
    // predate amountPaid. Any advance NOT yet reconciled into a payroll run
    // is added on top by the caller (_dashboardSnapshot) — see
    // _dashboardAdvanceTotal.
    const paidRows = _dashboardArray(salaryRecords)
        .filter(row => _dashboardBelongsToMonth(row.monthKey, monthKey, currentMonthKey));
    const paidFromPayroll = paidRows.reduce((total, row) => {
        const amountPaid = row.amountPaid != null
            ? row.amountPaid
            : _dashboardNumber(row.netPaid) + _dashboardNumber(row.advanceDeducted);
        return total + _dashboardNumber(amountPaid ?? row.baseSalary ?? row.amount);
    }, 0);

    // Total Due = Gross Salary − Fines (per staff member), aggregated. For
    // staff already paid this month, use the SALARY record's own totalDue —
    // authoritative, computed server-side. For staff not yet paid, estimate
    // it as roster salary minus whatever fine is on file for them, so
    // Pending already reflects the fine before payroll actually runs.
    //
    // BUGFIX — "salary paid but dashboard still shows it as Pending":
    // Finance rows are keyed by the staff member's PUBLIC staffId (e.g.
    // "PSC_S_1" — see FinanceController#paySalary, which calls
    // record.setStaffId(staffId) using that same public id). But `staff`
    // here is the RAW /api/staff response, where `.id` is the backend's
    // internal auto-generated primary key (a Long) and `.staffId` is the
    // public id — two completely different ID spaces. Matching on
    // `member.id` below could never find that staff member's paid SALARY
    // row, so it always fell through to the "not yet paid" estimate even
    // for staff who'd actually been paid in full, leaving a false residual
    // in Pending. Matching on `member.staffId` (mirrors manage-finance.js's
    // normalizeStaffMember(), which does exactly this for the same reason)
    // fixes it.
    const paidByStaffId = new Map(paidRows.map(row => [String(row.staffId), row]));
    const totalDue = staff.reduce((total, member) => {
        const paidRow = paidByStaffId.get(String(member.staffId));
        if (paidRow && paidRow.totalDue != null) return total + _dashboardNumber(paidRow.totalDue);
        const gross = _dashboardNumber(member.salary);
        const fine = _dashboardStaffFineFor(staffFines, staff, member.staffId, monthKey, currentMonthKey);
        // FEATURE — bonus given but not yet paid out still counts toward
        // what's owed, matching FinanceController#paySalary's own
        // `baseSalary + bonus - fine - security` formula (see
        // _dashboardStaffBonusFor above). Without this, a bonus never
        // moved Pending Salaries at all — it only lived in the separate
        // Staff Bonus card, even though it's real money still owed.
        const bonus = _dashboardStaffBonusFor(staffBonus, member.staffId, monthKey, currentMonthKey);
        return total + Math.max(0, gross + bonus - fine);
    }, 0);

    return { payable, paidFromPayroll, totalDue };
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
    // BUGFIX — "delete a student and Collected Fees/Total Revenue drops on
    // the Dashboard": Expected/Collected/paid-fine totals used to be summed
    // only over activeStudents above, so the instant a student was deleted
    // (StudentController#deleteStudent soft-deletes — status -> "dropped",
    // their Finance ledger rows are never touched), any money they'd
    // already paid in THIS billing month vanished from Collected Fees,
    // Total Revenue and Net Profit. Money that has genuinely already been
    // collected/billed is a historical fact and must not disappear just
    // because the student's roster status changed afterwards — so these
    // money figures below are now computed over every student on file
    // (moneyStudents), while `realStudentCount` and forward-looking things
    // collected/billed/paid rupee already happened, and unlike headcount it
    // must not disappear when the student's roster status later changes —
    // so these money figures below (including admission fees further down)
    // are now computed over every student on file (moneyStudents), while
    // `realStudentCount` still correctly uses activeStudents only.
    const moneyStudents = students;
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
    // only sum `netPayable` — base fee + rolled-over arrears + total fine
    // ever charged this month, see Finance#calculateNetPayable — for
    // students who have a live fee-master row this month, and skip
    // students with none. This also means Expected Fees updates
    // automatically the moment a fine touches that row.
    //
    // BUGFIX — "Expected/Pending/Collected go wrong the moment a fine is
    // added or paid": netPayable used to be built from `fineAmount`, a
    // running total the backend reduced back down every time a fine got
    // paid off (whether via the general bill payment or the standalone
    // "Pay Fine" button) — so Expected visibly SHRANK right after a fine
    // was settled, even though the fine was genuinely billed and genuinely
    // collected. netPayable is now driven by `totalFineCharged`, a running
    // total the backend never reduces (see Finance.java), so a fine stays
    // in Expected Fees for the rest of the billing month regardless of
    // payment status. Paying it off (either flow) now adds the money into
    // paidAmount instead of erasing the fine from netPayable — which is
    // exactly what `collected` below sums, and what makes `pending`
    // (expected − collected, see the `fees` object below) correctly settle
    // back down to the real remaining balance once the bill is actually
    // paid, fine included.
    const expected = moneyStudents.reduce((total, student) => {
        const row = statusByStudent.get(String(student.regNo || student.id || ''));
        return (row && row.netPayable != null) ? total + _dashboardNumber(row.netPayable) : total;
    }, 0);
    const collected = moneyStudents.reduce((total, student) => {
        const row = statusByStudent.get(String(student.regNo || student.id || ''));
        return total + _dashboardNumber(row && row.paidAmount);
    }, 0);

    const fineRecords = await _dashboardFineRecords(moneyStudents, monthKey);
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
    //
    // BUGFIX — uses moneyStudents (not activeStudents): an admission fee is
    // a one-time payment already collected at the moment a student joined.
    // If that same student is later deleted, the fee they genuinely paid
    // shouldn't vanish from Total Revenue — same reasoning as collected/
    // expected above.
    const admissionFees = moneyStudents.reduce((total, student) => {
        const admissionMonth = _dashboardAdmissionMonthKey(student);
        const belongsHere = admissionMonth
            ? admissionMonth === monthKey
            : monthKey === currentMonthKey;
        return belongsHere ? total + _dashboardNumber(student.admissionFee) : total;
    }, 0);

    // Paid Salaries = posted payroll + any still-outstanding advances (cash
    // already handed to staff counts as paid even before it's formally
    // settled through a payroll run).
    //
    // BUGFIX — "Pending doesn't subtract fines correctly": Pending used to
    // be computed as roster Payable Salaries (raw, unreduced) minus Paid —
    // so a fine that lowered what a staff member actually owed never
    // showed up here; Pending stayed inflated by the fine amount even
    // though the fine had already been deducted the moment payroll ran.
    // Pending is now Total Due (Gross + Bonus − Fines, see
    // _dashboardSalaryAmount) minus Paid, matching the same formula used
    // everywhere else on this page.
    //
    // FEATURE — a bonus now stays part of Pending Salaries (Total Due)
    // until it's actually paid out, instead of only ever appearing in the
    // separate Staff Bonus card. The moment payroll pays that staff
    // member, the posted SALARY record's own totalDue (already
    // bonus-inclusive server-side — see FinanceController#paySalary) takes
    // over, so the bonus correctly moves from Pending into Paid with the
    // real combined value.
    const { payable, paidFromPayroll, totalDue } = _dashboardSalaryAmount(
        salaryRecords, staff, staffFines, staffBonus, monthKey, currentMonthKey
    );
    const advance = _dashboardAdvanceTotal(staffAdvances, monthKey, currentMonthKey);
    const paid = paidFromPayroll + advance;
    const pending = Math.max(0, totalDue - paid);

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
        dropoutStaff,
        attendance
    ] = await Promise.all([
        // PERFORMANCE FIX — these used to hit plain GET /api/students and
        // GET /api/staff, which pull every student's/staff member's base64
        // photo (+ certData/otherFeesData/agreementData/etc.) LONGTEXT
        // blobs along with them (Hibernate fetches @Lob string columns
        // eagerly here), even though this dashboard only ever reads
        // regNo/status/admissionDate/admissionFee and staffId/salary/fines
        // below (see _dashboardSnapshot / _dashboardSalaryAmount). That's
        // what made these cards slow. /summary (StudentController /
        // StaffController + StudentSummaryDTO / StaffSummaryDTO) selects
        // only those columns at the SQL level, so the LOB columns are
        // never read off disk or sent over the wire for this call.
        _dashboardGet('/api/students/summary', []),
        _dashboardGet('/api/staff/summary', []),
        _dashboardGet(`/api/finance/status-all/${encodeURIComponent(currentMonth)}`, []),
        _dashboardGet(`/api/finance/status-all/${encodeURIComponent(previousMonth)}`, []),
        _dashboardGet('/api/finance/custom-fees', []),
        _dashboardGet('/api/finance/staff-bonus', []),
        _dashboardGet('/api/finance/staff-fines', []),
        _dashboardGet('/api/finance/expenses', []),
        _dashboardGet('/api/finance/salary/records', []),
        _dashboardGet('/api/finance/staff-advances', []),
        // Dropout Staff Paid Salary: lifetime snapshot total (see
        // FinanceController#getDropoutStaffSalaries), not scoped to any
        // month — a staff member's paid salary/bonus/fine total is
        // archived here the moment they're deleted. Fetched once, not
        // per-snapshot, and folded only into the CURRENT month's totals
        // below (see dropoutStaffTotal) — there's no way to say which past
        // month it "belongs" to, so it must never leak into the previous-
        // month snapshot or it would distort Past Month Profit.
        _dashboardGet('/api/finance/dropout-staff', { total: 0, finesTotal: 0, records: [] }),
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

    // Same fix as Total Revenue above: snapshot.fees.collected already
    // includes every student fine that's been paid off (it's summed
    // straight from each student's ledger paidAmount), so adding
    // fines.studentLate/studentOther again here double-counted them — and
    // staff fines already reduce Paid Salaries via each SALARY record's
    // totalDue, so they were never added into revenue either. Otherwise
    // Past Month Profit would double-count the exact same things
    // This Month's Profit used to.
    const revenue = snapshot => snapshot.fees.collected
        + snapshot.admissionFees
        + snapshot.customFeesCollected;
    // FEATURE — Staff Bonus is excluded from Net Expenses (see the same
    // fix in loadDashboardFromBackend's netExp) so Past Month Profit uses
    // the identical formula as This Month's Profit — otherwise the trend
    // arrow would be comparing two differently-defined numbers.
    const expensesTotal = snapshot => snapshot.salaries.paid
        + snapshot.otherExpensesTotal;

    // Dropout Staff Paid Salary total — see the fetch above for why this is
    // computed once and applied only to the current month, never to
    // `previous`.
    const dropoutStaffTotal = _dashboardNumber(dropoutStaff && dropoutStaff.total);

    // FEATURE — "deleting a staff member makes their fine disappear from
    // the dashboard's Staff Fine box": the STAFF_FINE rows for a deleted
    // staff member are wiped (StaffController#delete()), but their fine
    // total is archived into the same dropout-staff snapshot as the paid
    // salary above (see FinanceController#getDropoutStaffSalaries). Same
    // rule as dropoutStaffTotal: a lifetime figure, folded only into the
    // CURRENT month's Staff Fine total, never into `previous`.
    const dropoutStaffFinesTotal = _dashboardNumber(dropoutStaff && dropoutStaff.finesTotal);

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
        fines: { ...current.fines, staffTotal: current.fines.staffTotal + dropoutStaffFinesTotal },
        totalStaff: staff.length,
        dropoutStaffTotal,
        netExpenses: expensesTotal(current) + dropoutStaffTotal,
        netProfit: revenue(current) - (expensesTotal(current) + dropoutStaffTotal),
        lastMonthProfit,
        todayAttendance: attendance
    };
}