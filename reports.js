/**
 * EDUFLOW PRO - REPORTS & ANALYTICS
 * Reads the same backend records used by Student Management and Finance
 * (fee ledgers, expenses, bonuses, fines, attendance marks, and staff
 * records) and renders period-based charts (Week / Month / Year),
 * cross-module quick links, class-level breakdowns, and a recent
 * transactions feed.
 * No other page's data is modified — this page is read-only.
 * No report data is written to localStorage.
 */

let currentTxnFilter = 'all';
let allPeriodTxnRows = []; // full (unsliced) set of transactions for the active period+filter, used by CSV export
let charts = { revExp: null, attendance: null, expenseBreak: null, feeStatus: null, cashFlow: null };

/* ── In-page toast (replaces window.alert) ───────────────────── */
function showReportsToast(message, type = 'info') {
    let container = document.getElementById('reports-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'reports-toast-container';
        container.className = 'reports-toast-container';
        document.body.appendChild(container);
    }
    const icon = type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info');
    const toast = document.createElement('div');
    toast.className = `reports-toast reports-toast-${type}`;
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initSidebar();
    initNavSearch();
    initDate();
    initTxnControls();
    
    await loadReportsDataFromBackend();
    
    renderReports();

    initLiveRefresh();
});

/* ============================================
   LIVE REFRESH
   Keeps every figure on this page (stat cards, charts, transactions,
   quick links) accurate without a manual reload: re-pulls the backend
   on an interval, and immediately whenever the tab/window regains focus
   (e.g. coming back from Fees & Finance after recording a payment). A
   simple in-flight guard stops overlapping refreshes from stacking up if
   the network is slow.
   ============================================ */
const REPORTS_REFRESH_INTERVAL_MS = 30000; // 30s
let _reportsRefreshInFlight = false;

async function refreshReportsData() {
    if (_reportsRefreshInFlight) return;
    _reportsRefreshInFlight = true;
    try {
        await loadReportsDataFromBackend();
        renderReports();
    } catch (err) {
        console.error('[Reports] Live refresh failed:', err);
    } finally {
        _reportsRefreshInFlight = false;
    }
}

function initLiveRefresh() {
    setInterval(refreshReportsData, REPORTS_REFRESH_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshReportsData();
    });

    window.addEventListener('focus', refreshReportsData);
}

/* ============================================
   THEME TOGGLE
   ============================================ */
function initTheme() {
    const toggleBtn = document.getElementById('theme-toggle');
    const root = document.documentElement;

    // Reports data is never persisted in browser storage. Keep the theme
    // in memory for this page only.
    root.setAttribute('data-theme', 'dark');

    if (toggleBtn) toggleBtn.addEventListener('click', () => {
        const currentTheme = root.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', newTheme);
        // Re-render so chart colors (read from CSS vars) follow the new theme
        setTimeout(renderReports, 50);
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
   TRANSACTIONS: FILTER + EXPORT CONTROLS
   ============================================ */
function initTxnControls() {
    const filterEl = document.getElementById('txn-filter');
    if (filterEl) {
        filterEl.addEventListener('change', () => {
            currentTxnFilter = filterEl.value;
            renderReports();
        });
    }

    const exportBtn = document.getElementById('txn-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportTransactionsCSV);
    }
}

function exportTransactionsCSV() {
    if (!allPeriodTxnRows.length) {
        showReportsToast('No transactions to export for the current period / filter.', 'info');
        return;
    }
    const header = ['Date', 'Type', 'Description', 'Direction', 'Amount (RS)'];
    const lines = [header.join(',')];
    allPeriodTxnRows.forEach(r => {
        const row = [
            r.date.toLocaleDateString('en-CA'), // YYYY-MM-DD, unambiguous in CSV
            r.typeLabel,
            csvEscape(r.desc),
            r.direction === 'in' ? 'Income' : 'Expense',
            Math.round(r.amount)
        ];
        lines.push(row.join(','));
    });
    const csvContent = lines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${toDateKey(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function csvEscape(str) {
    const s = str == null ? '' : String(str);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

/* ============================================
   DATA READERS (raw, dated events)
   ============================================ */
let _reportsDataCache = {
    feePayments: [],
    otherExpenses: [],
    staffBonus: [],
    studentFines: [],
    staffFines: [],
    attendance: {},
    students: [],
    staff: [],
    salaryRecords: [],
    feeStatus: []
};

function _getSchoolId() {
    if (window.SoftSchoolAdmin && typeof window.SoftSchoolAdmin.getCurrentSchool === 'function') {
        const school = window.SoftSchoolAdmin.getCurrentSchool();
        if (school && school.schoolId) return school.schoolId;
    }
    return '';
}

const REPORTS_BACKEND_ORIGIN = 'http://localhost:8080';

function _reportsArray(data, keys = []) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of keys) {
        if (Array.isArray(data[key])) return data[key];
    }
    return [];
}

function _reportsStaffArray(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    const result = [];
    ['staff', 'employees', 'members', 'items', 'content', 'data',
        'Teaching', 'Non-Teaching', 'teaching', 'nonTeaching'].forEach(key => {
        if (Array.isArray(data[key])) result.push(...data[key]);
    });
    return result;
}

function _reportsIsActiveStudent(student) {
    const status = String((student && student.status) || '').trim().toLowerCase();
    return !status || status === 'active';
}

function _reportsNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function _reportsMonthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function _reportsMonthKeys(count = 12) {
    const now = new Date();
    return Array.from({ length: count }, (_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
        return _reportsMonthKey(date);
    });
}

function _reportsDate(value, monthKey) {
    const parsed = value ? new Date(value) : new Date(`${monthKey}-01T00:00:00`);
    return Number.isNaN(parsed.getTime())
        ? new Date(`${monthKey}-01T00:00:00`)
        : parsed;
}

async function _reportsGet(path, fallback) {
    const schoolId = _getSchoolId();
    const separator = path.includes('?') ? '&' : '?';
    try {
        const response = await fetch(
            `${REPORTS_BACKEND_ORIGIN}${path}${separator}schoolId=${encodeURIComponent(schoolId)}`,
            { headers: { 'Content-Type': 'application/json' } }
        );
        if (!response.ok) return fallback;
        const text = await response.text();
        return text ? JSON.parse(text) : fallback;
    } catch (error) {
        console.warn(`[Reports] Could not read ${path}:`, error);
        return fallback;
    }
}

/**
 * Net expense means only money that's actually gone out the door. A
 * record counts as paid/disbursed unless it's explicitly flagged
 * otherwise — a `paid: false` boolean, or a status field (status /
 * paymentStatus / paidStatus) that reads as pending/unpaid/due/etc.
 * Records with no such field at all (the common case for the operational
 * expenses & bonus endpoints) are treated as paid, same as before.
 */
function _reportsIsPaidRecord(item) {
    if (!item || typeof item !== 'object') return true;
    if (item.paid === false) return false;
    const status = String(item.status || item.paymentStatus || item.paidStatus || '').trim().toLowerCase();
    if (status && /pending|unpaid|due|outstanding|scheduled|upcoming|unsettled/.test(status)) return false;
    return true;
}

function _reportsEvent(item, monthKey, fallbackLabel) {
    return {
        date: _reportsDate(
            item.date || item.paymentDate || item.payDate || item.paidAt ||
            item.generatedAt || item.createdAt || item.applyDate,
            monthKey
        ),
        amount: _reportsNumber(item.amount || item.netPaid || item.value),
        label: item.label || item.description || item.reason || fallbackLabel
    };
}

function _reportsAttendanceMap(data) {
    const map = {};
    if (Array.isArray(data)) {
        data.forEach(record => {
            const date = record.date || record.dateKey || record.attendanceDate;
            if (date) map[String(date).slice(0, 10)] = record;
        });
        return map;
    }
    if (data && typeof data === 'object') {
        const source = data.attendance && typeof data.attendance === 'object'
            ? data.attendance
            : data;
        Object.entries(source).forEach(([key, value]) => {
            if (value && typeof value === 'object' && /^\d{4}-\d{2}-\d{2}/.test(key)) {
                map[key.slice(0, 10)] = value;
            }
        });
    }
    return map;
}

async function loadReportsDataFromBackend() {
    const months = _reportsMonthKeys();
    const [
        studentsData,
        staffData,
        customFeesData,
        staffBonusData,
        staffFinesData,
        expensesData,
        salaryRecordsData,
        attendanceData,
        statusResponses,
        fineResponses
    ] = await Promise.all([
        _reportsGet('/api/students', []),
        _reportsGet('/api/staff', []),
        _reportsGet('/api/finance/custom-fees', []),
        _reportsGet('/api/finance/staff-bonus', []),
        _reportsGet('/api/finance/staff-fines', []),
        _reportsGet('/api/finance/expenses', []),
        _reportsGet('/api/finance/salary/records', []),
        _reportsGet('/api/attendance', []),
        Promise.all(months.map(month =>
            _reportsGet(`/api/finance/status-all/${encodeURIComponent(month)}`, [])
        )),
        Promise.all(months.map(month =>
            _reportsGet(`/api/finance/all-fines/${encodeURIComponent(month)}`, [])
        ))
    ]);

    const students = _reportsArray(studentsData).filter(_reportsIsActiveStudent);
    const statusRows = statusResponses.flatMap((rows, index) =>
        _reportsArray(rows).map(row => ({ ...row, monthKey: row.monthKey || months[index] }))
    );
    const feePayments = statusRows
        .filter(row => _reportsNumber(row.paidAmount) > 0)
        .map(row => ({
            date: _reportsDate(
                row.paymentDate || row.paidAt || row.updatedAt || row.createdAt,
                row.monthKey
            ),
            amount: _reportsNumber(row.paidAmount),
            label: `Fee payment${row.studentName ? ` · ${row.studentName}` : ''}`
        }));

    const customFees = _reportsArray(customFeesData);
    customFees.forEach(fee => {
        const monthKey = fee.monthKey || _reportsMonthKey();
        const records = Array.isArray(fee.records) ? fee.records : [];
        records.filter(record => record.paid).forEach(record => {
            feePayments.push({
                date: _reportsDate(record.paidAt || record.paymentDate || fee.generatedAt, monthKey),
                amount: _reportsNumber(fee.amount),
                label: fee.feeName || 'Custom fee'
            });
        });
    });

    const studentFines = fineResponses.flatMap((rows, index) =>
        _reportsArray(rows)
            .filter(row => _reportsNumber(row.fineAmount) > 0)
            .map(row => ({
                date: _reportsDate(row.paymentDate || row.updatedAt, months[index]),
                amount: _reportsNumber(row.fineAmount),
                label: row.studentName ? `Student fine · ${row.studentName}` : 'Student fine'
            }))
    );

    _reportsDataCache = {
        feePayments,
        // Net expense only — anything still pending/unpaid is excluded so
        // every chart and total on this page reflects money actually spent.
        otherExpenses: _reportsArray(expensesData).filter(_reportsIsPaidRecord).map(item =>
            _reportsEvent(item, item.monthKey || _reportsMonthKey(), 'Operational expense')
        ),
        staffBonus: _reportsArray(staffBonusData).filter(_reportsIsPaidRecord).map(item =>
            _reportsEvent(item, item.monthKey || _reportsMonthKey(), 'Bonus')
        ),
        studentFines,
        staffFines: _reportsArray(staffFinesData).map(item =>
            _reportsEvent(item, item.monthKey || _reportsMonthKey(), 'Staff fine')
        ),
        attendance: _reportsAttendanceMap(attendanceData),
        students,
        staff: _reportsStaffArray(staffData),
        salaryRecords: _reportsArray(salaryRecordsData),
        feeStatus: statusRows
    };
}

function getAllFeePayments() {
    return (_reportsDataCache.feePayments || []).map(p => ({
        date: new Date(p.date), amount: Number(p.amount) || 0, label: p.label || 'Fee payment'
    })).filter(p => !isNaN(p.date));
}

function getAllOtherExpenses() {
    return (_reportsDataCache.otherExpenses || []).map(e => ({
        date: new Date(e.date), amount: Number(e.amount) || 0, label: e.label || 'Operational expense'
    })).filter(e => !isNaN(e.date));
}

function getAllStaffBonus() {
    return (_reportsDataCache.staffBonus || []).map(b => ({
        date: new Date(b.date), amount: Number(b.amount) || 0, label: b.label || 'Bonus'
    })).filter(b => !isNaN(b.date));
}

function getAllStudentFines() {
    return (_reportsDataCache.studentFines || []).map(f => ({
        date: new Date(f.date), amount: Number(f.amount) || 0, label: f.label || 'Student fine'
    })).filter(f => !isNaN(f.date));
}

function getAllStaffFines() {
    return (_reportsDataCache.staffFines || []).map(f => ({
        date: new Date(f.date), amount: Number(f.amount) || 0, label: f.label || 'Staff fine'
    })).filter(f => !isNaN(f.date));
}

/**
 * Actual, applied salary payments — one event per salary record that was
 * really paid (i.e. exists in /api/finance/salary/records), dated to when
 * it was paid. This replaces the old "monthly payroll ÷ 30 × days in
 * bucket" estimate: that proration counted a full month of salary as an
 * expense in every period even when nothing had actually been paid yet,
 * and double-counted once real payments started coming in. Using the
 * dated records means the period charts only ever show expense that was
 * genuinely applied, exactly like bonuses and operational expenses already do.
 */
function getAllSalaryEvents() {
    return (_reportsDataCache.salaryRecords || []).map(row => ({
        date: _reportsDate(
            row.date || row.paymentDate || row.payDate || row.paidAt || row.generatedAt || row.createdAt,
            row.monthKey || row.month || _reportsMonthKey()
        ),
        amount: _reportsNumber(row.netPaid || row.baseSalary || row.amount),
        label: row.staffName ? `Salary paid · ${row.staffName}` : 'Staff salary'
    })).filter(e => !isNaN(e.date));
}

/* ============================================
   ATTENDANCE READER (per calendar date)
   ============================================ */
function getAttendanceForDate(dateKey) {
    if (_reportsDataCache.attendance && _reportsDataCache.attendance[dateKey]) {
        return _reportsDataCache.attendance[dateKey];
    }
    return { presentStudents: 0, totalStudents: 0, presentStaff: 0, totalStaff: 0, hasData: false };
}

/* ============================================
   PERIOD BUCKETS (calendar-accurate)
   ============================================ */
function toDateKey(d) { return d.toISOString().slice(0, 10); }

/**
 * Builds `count` calendar-month buckets, oldest first, ending at the
 * current month — e.g. for count=12 that's this month plus the 11 before
 * it. Every chart on this page (Revenue vs Expenses, Attendance Trend,
 * Net Cash Flow Trend) is driven off this same list so they always agree
 * on which months are being shown. The last bucket doubles as "this
 * month" for the stat-pill totals, and the second-to-last as "last
 * month" for their trend badges — there's no separate week/day view
 * anymore, everything on this page is monthly.
 */
/**
 * Builds 12 calendar-month buckets for one calendar year, Jan through
 * Dec — defaults to the current year. Every chart on this page (Revenue
 * vs Expenses, Attendance Trend, Net Cash Flow Trend) is driven off this
 * same list so they always agree on which months are being shown. Months
 * later than the current one will simply have no data yet.
 */
function getMonthlyBuckets(year = new Date().getFullYear()) {
    const buckets = [];
    for (let month = 0; month < 12; month++) {
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
        const days = [];
        for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) days.push(new Date(day));
        buckets.push({
            label: start.toLocaleDateString('en-US', { month: 'short' }),
            start, end, days
        });
    }
    return buckets;
}

/**
 * Returns the immediately-preceding period of equal length, used for
 * period-over-period trend comparisons (e.g. this week vs last week).
 */
function getPreviousRange(periodStart, periodEnd) {
    const durationMs = periodEnd.getTime() - periodStart.getTime() + 1;
    const prevEnd = new Date(periodStart.getTime() - 1);
    const prevStart = new Date(periodStart.getTime() - durationMs);
    return { start: prevStart, end: prevEnd };
}

function sumInRange(events, start, end) {
    return events.reduce((sum, e) => (e.date >= start && e.date <= end) ? sum + e.amount : sum, 0);
}

function countDaysInRange(start, end) {
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

/* ============================================
   THEME-AWARE COLOR HELPER
   ============================================ */
function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ============================================
   CHART RENDER SAFETY WRAPPER
   Prevents one bad chart (bad data, DOM not ready, etc.) from throwing
   and silently skipping every chart rendered after it. Also surfaces a
   visible message — instead of a blank canvas — if Chart.js itself
   never loaded (e.g. CDN blocked by network/ad-blocker).
   ============================================ */
let chartLibWarningShown = false;
function safeRenderChart(name, fn) {
    if (typeof Chart === 'undefined') {
        console.error(`[Reports] Chart.js is not loaded — cannot render "${name}".`);
        if (!chartLibWarningShown) {
            chartLibWarningShown = true;
            document.querySelectorAll('.chart-wrap').forEach(wrap => {
                if (wrap.querySelector('canvas')) {
                    const warn = document.createElement('p');
                    warn.className = 'chart-empty-note';
                    warn.style.display = 'block';
                    warn.textContent = 'Charts failed to load (Chart.js did not load — check your network/ad-blocker and refresh).';
                    wrap.after(warn);
                }
            });
        }
        return;
    }
    try {
        fn();
    } catch (err) {
        console.error(`[Reports] Failed to render chart "${name}":`, err);
    }
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

/* ============================================
   TREND BADGE HELPER
   goodDirection: 'up' (higher = better, e.g. revenue) or 'down' (lower = better, e.g. expenses)
   ============================================ */
function renderTrendBadge(elId, current, previous, goodDirection) {
    const el = document.getElementById(elId);
    if (!el) return;

    if (previous <= 0 && current <= 0) { el.textContent = ''; el.className = 'stat-pill-trend'; return; }
    if (previous <= 0 && current > 0) {
        el.innerHTML = '<i class="fas fa-arrow-up"></i> New';
        el.className = 'stat-pill-trend ' + (goodDirection === 'up' ? 'trend-up' : 'trend-down');
        return;
    }

    const pctChange = ((current - previous) / Math.abs(previous)) * 100;
    const rounded = Math.round(Math.abs(pctChange));
    const increased = pctChange > 0.5;
    const decreased = pctChange < -0.5;

    if (!increased && !decreased) {
        el.innerHTML = '<i class="fas fa-minus"></i> Flat';
        el.className = 'stat-pill-trend trend-flat';
        return;
    }

    const isGood = (increased && goodDirection === 'up') || (decreased && goodDirection === 'down');
    el.innerHTML = `<i class="fas fa-arrow-${increased ? 'up' : 'down'}"></i> ${rounded}%`;
    el.className = 'stat-pill-trend ' + (isGood ? 'trend-up' : 'trend-down');
}

/* ============================================
   MAIN RENDER
   ============================================ */
function renderReports() {
    // One shared bucket list (Jan → Dec of the current year) drives every
    // trend chart, so they're always looking at the same months. "This
    // month" and "last month" (used for the stat-pill totals and their
    // trend badges) are picked out by the current calendar month index,
    // since December — not necessarily today's month — is always last.
    const buckets = getMonthlyBuckets();
    const now = new Date();
    const currentMonthIdx = now.getMonth();
    const currentBucket = buckets[currentMonthIdx];
    const prevBucket = currentMonthIdx > 0 ? buckets[currentMonthIdx - 1] : null;
    const periodStart = currentBucket.start;
    const periodEnd = currentBucket.end;
    const prevRange = prevBucket
        ? { start: prevBucket.start, end: prevBucket.end }
        : getPreviousRange(periodStart, periodEnd);

    const labelEl = document.getElementById('period-range-label');
    if (labelEl) {
        labelEl.textContent = '· ' + periodStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    const feePayments = getAllFeePayments();
    const otherExpenses = getAllOtherExpenses();
    const staffBonus = getAllStaffBonus();
    const studentFines = getAllStudentFines();
    const staffFines = getAllStaffFines();
    const salaryEvents = getAllSalaryEvents();

    // ---------- Staff payroll (loaded from the Staff API) ----------
    const staff = Array.isArray(_reportsDataCache.staff) ? _reportsDataCache.staff : [];
    const teaching = staff.filter(member => {
        const category = String(member.category || member.staffCategory || member.type || '').toLowerCase();
        return !/non[\s-]*teach|support|admin|office/.test(category);
    });
    const nonTeaching = staff.filter(member => {
        const category = String(member.category || member.staffCategory || member.type || '').toLowerCase();
        return /non[\s-]*teach|support|admin|office/.test(category);
    });
    const salaryRows = Array.isArray(_reportsDataCache.salaryRecords)
        ? _reportsDataCache.salaryRecords
        : [];
    const totalSalaries = salaryRows.length
        ? salaryRows.reduce((total, row) => total + _reportsNumber(row.netPaid || row.baseSalary || row.amount), 0)
        : staff.reduce((total, member) => total + _reportsNumber(member.salary), 0);

    // ---------- Monthly revenue / net-expense series (last 12 months) ----------
    // "Expense" here is *net* expense — salary, bonus & operational costs
    // that were actually paid/disbursed (otherExpenses/staffBonus are
    // already filtered to paid-only records when loaded from the backend,
    // and salaryEvents only ever contains records that were really paid) —
    // nothing pending/unpaid, estimated, or prorated. totalSalaries above
    // (whole payroll figure) is still used for the Expense Breakdown donut
    // and Payroll Snapshot, which are explicitly labeled as whole-of-record,
    // not month totals.
    const revenueSeries = buckets.map(b =>
        sumInRange(feePayments, b.start, b.end) +
        sumInRange(studentFines, b.start, b.end) +
        sumInRange(staffFines, b.start, b.end)
    );
    const expenseSeries = buckets.map(b =>
        sumInRange(otherExpenses, b.start, b.end) +
        sumInRange(staffBonus, b.start, b.end) +
        sumInRange(salaryEvents, b.start, b.end)
    );

    // This month / last month totals come from the matching index in the
    // same series — no separate range sum needed.
    const periodRevenue = revenueSeries[currentMonthIdx];
    const periodExpense = expenseSeries[currentMonthIdx];
    const netFlow = periodRevenue - periodExpense;

    const prevRevenue = currentMonthIdx > 0 ? revenueSeries[currentMonthIdx - 1] : 0;
    const prevExpense = currentMonthIdx > 0 ? expenseSeries[currentMonthIdx - 1] : 0;
    const prevNetFlow = prevRevenue - prevExpense;

    // Totals across the full 12-month window, used to decide whether the
    // Revenue vs Expenses / Net Cash Flow Trend charts have anything to show.
    const totalRevenueAllMonths = revenueSeries.reduce((a, b) => a + b, 0);
    const totalExpenseAllMonths = expenseSeries.reduce((a, b) => a + b, 0);

    setText('rp-total-revenue', 'RS ' + Math.round(periodRevenue).toLocaleString());
    setText('rp-total-expense', 'RS ' + Math.round(periodExpense).toLocaleString());
    setText('rp-net-flow', 'RS ' + Math.round(netFlow).toLocaleString());

    const netFlowEl = document.getElementById('rp-net-flow');
    if (netFlowEl) netFlowEl.style.color = netFlow >= 0 ? '#10b981' : '#ef4444';

    renderTrendBadge('rp-revenue-trend', periodRevenue, prevRevenue, 'up');
    renderTrendBadge('rp-expense-trend', periodExpense, prevExpense, 'down');
    renderTrendBadge('rp-netflow-trend', netFlow, prevNetFlow, 'up');

    const trendBadge = document.getElementById('rp-trend-badge');
    if (trendBadge) {
        const hasActivity = periodRevenue > 0 || periodExpense > 0;
        trendBadge.className = hasActivity ? 'trend up' : 'trend neutral';
        trendBadge.innerHTML = hasActivity
            ? '<i class="fas fa-circle" style="font-size:7px;"></i> Live'
            : '<i class="fas fa-circle" style="font-size:7px;"></i> No activity yet';
    }

    // ---------- Attendance series (recalculated every month) ----------
    // One average student/staff attendance % per month across the same
    // 12-month window as the other trend charts.
    const attendanceStudentSeries = [];
    const attendanceStaffSeries = [];
    let attendanceHasAnyData = false;

    buckets.forEach(b => {
        let sPresent = 0, sTotal = 0, stPresent = 0, stTotal = 0;
        b.days.forEach(day => {
            const rec = getAttendanceForDate(toDateKey(day));
            if (rec.hasData) attendanceHasAnyData = true;
            sPresent += rec.presentStudents; sTotal += rec.totalStudents;
            stPresent += rec.presentStaff; stTotal += rec.totalStaff;
        });
        attendanceStudentSeries.push(sTotal > 0 ? Math.round((sPresent / sTotal) * 100) : null);
        attendanceStaffSeries.push(stTotal > 0 ? Math.round((stPresent / stTotal) * 100) : null);
    });

    // "Avg Attendance" stat pill = this month; its trend badge compares
    // against last month — both are just the series' last two points.
    function overallPct(studentPct, staffPct) {
        const parts = [studentPct, staffPct].filter(v => v !== null);
        return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0;
    }
    const avgOverall = overallPct(attendanceStudentSeries[currentMonthIdx], attendanceStaffSeries[currentMonthIdx]);
    const prevAvgOverall = currentMonthIdx > 0 ? overallPct(attendanceStudentSeries[currentMonthIdx - 1], attendanceStaffSeries[currentMonthIdx - 1]) : 0;

    setText('rp-avg-attendance', avgOverall + '%');
    renderTrendBadge('rp-attendance-trend', avgOverall, prevAvgOverall, 'up');

    // ---------- Expense breakdown (whole-of-record totals, matches Fees & Finance) ----------
    const totalBonusAll = staffBonus.reduce((s, b) => s + b.amount, 0);
    const totalOtherAll = otherExpenses.reduce((s, e) => s + e.amount, 0);

    // ---------- Fee collection status (active students from the Student API) ----------
    // Labeled "All-Time" in the UI, so it needs to sum each student's full
    // payment history — not just one month's status snapshot. It now uses
    // the exact same per-student calculation as "Top Pending Fees" below,
    // so the two cards can never disagree with each other.
    const students = Array.isArray(_reportsDataCache.students)
        ? _reportsDataCache.students
        : [];
    let expected = 0, collected = 0;
    students.forEach(s => {
        expected += (Number(s.standardFee) || 0) + (Number(s.transportFee) || 0);
        collected += (s.feePayments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    });
    const pending = Math.max(0, expected - collected);

    // ---------- Render core charts ----------
    // Each call is isolated: if one chart throws (bad data, DOM timing, etc.)
    // it's logged and skipped instead of silently halting every chart after it.
    safeRenderChart('Revenue vs Expenses', () => renderRevExpChart(buckets.map(b => b.label), revenueSeries, expenseSeries));
    safeRenderChart('Attendance Trend', () => renderAttendanceChart(buckets.map(b => b.label), attendanceStudentSeries, attendanceStaffSeries));
    safeRenderChart('Expense Breakdown', () => renderExpenseBreakdown(totalSalaries, totalBonusAll, totalOtherAll));
    safeRenderChart('Fee Collection Status', () => renderFeeStatus(collected, pending));

    document.getElementById('chart-revenue-expense-empty').style.display =
        (totalRevenueAllMonths === 0 && totalExpenseAllMonths === 0) ? 'block' : 'none';
    document.getElementById('chart-attendance-trend-empty').style.display =
        attendanceHasAnyData ? 'none' : 'block';

    // ---------- Net Cash Flow Trend ----------
    const netSeries = revenueSeries.map((r, i) => r - expenseSeries[i]);
    safeRenderChart('Net Cash Flow Trend', () => renderCashFlowTrend(buckets.map(b => b.label), netSeries));
    document.getElementById('chart-cash-flow-trend-empty').style.display =
        (totalRevenueAllMonths === 0 && totalExpenseAllMonths === 0) ? 'block' : 'none';

    const cashflowBadge = document.getElementById('rp-cashflow-badge');
    if (cashflowBadge) {
        if (periodRevenue === 0 && periodExpense === 0) {
            cashflowBadge.className = 'trend neutral';
            cashflowBadge.innerHTML = '<i class="fas fa-circle" style="font-size:7px;"></i> No activity yet';
        } else if (netFlow >= 0) {
            cashflowBadge.className = 'trend up';
            cashflowBadge.innerHTML = '<i class="fas fa-arrow-up"></i> Surplus';
        } else {
            cashflowBadge.className = 'trend down';
            cashflowBadge.innerHTML = '<i class="fas fa-arrow-down"></i> Deficit';
        }
    }

    // ---------- Top Pending Fees ----------
    renderPendingFees(students);

    // ---------- Payroll snapshot ----------
    const periodBonus = sumInRange(staffBonus, periodStart, periodEnd);
    setText('pr-teaching-count', teaching.length);
    setText('pr-nonteaching-count', nonTeaching.length);
    setText('pr-monthly-payroll', 'RS ' + Math.round(totalSalaries).toLocaleString());
    setText('pr-period-bonus', 'RS ' + Math.round(periodBonus).toLocaleString());

    // ---------- Quick links row ----------
    renderQuickLinks(students);

    // ---------- Transactions table ----------
    renderTransactions(feePayments, otherExpenses, staffBonus, studentFines, staffFines, salaryEvents, periodStart, periodEnd);
}

/* ============================================
   CHART THEME
   A palette derived from the app's own brand teal (#17716A)
   instead of generic off-the-shelf chart colors, plus shared
   gradient/tooltip helpers so every chart feels like one system.
   ============================================ */
const CHART_PALETTE = {
    teal: '#17716A',       // brand primary — revenue, collected, present
    tealLight: '#2dd4bf',  // brand accent — highlights, secondary teal series
    rose: '#f43f5e',       // expenses, pending-negative
    amber: '#f59e0b',      // staff / bonuses
    indigo: '#6366f1',     // tertiary contrast series
    slate: '#94a3b8'       // neutral / empty state
};

function chartTheme() {
    return {
        grid: cssVar('--border-subtle') || 'rgba(255,255,255,0.06)',
        text: cssVar('--text-secondary') || '#8892a8',
        cardBg: cssVar('--bg-card') || '#161b22',
        textPrimary: cssVar('--text-primary') || '#e6edf3'
    };
}

function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Vertical gradient for bar fills — solid at top, fading toward the baseline. */
function barGradient(color) {
    return (context) => {
        const { chart } = context;
        const { ctx, chartArea } = chart;
        if (!chartArea) return hexToRgba(color, 0.85);
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, hexToRgba(color, 0.95));
        gradient.addColorStop(1, hexToRgba(color, 0.55));
        return gradient;
    };
}

/** Soft vertical gradient for line-chart area fills. */
function lineFillGradient(color) {
    return (context) => {
        const { chart } = context;
        const { ctx, chartArea } = chart;
        if (!chartArea) return hexToRgba(color, 0.15);
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, hexToRgba(color, 0.32));
        gradient.addColorStop(1, hexToRgba(color, 0.02));
        return gradient;
    };
}

/** Shared tooltip look — rounded card, brand accent border, point-style swatches. */
function tooltipStyle(theme) {
    return {
        enabled: true,
        backgroundColor: theme.cardBg,
        titleColor: theme.textPrimary,
        bodyColor: theme.text,
        borderColor: hexToRgba(CHART_PALETTE.teal, 0.4),
        borderWidth: 1,
        cornerRadius: 10,
        padding: 10,
        boxPadding: 4,
        displayColors: true,
        usePointStyle: true,
        titleFont: { family: 'Inter', size: 12, weight: '700' },
        bodyFont: { family: 'Inter', size: 12, weight: '600' }
    };
}

/** Draws a total value + label centered inside a doughnut's cutout. */
function centerTextPlugin(getLines) {
    return {
        id: 'centerText',
        afterDraw(chart) {
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            const lines = getLines();
            if (!lines) return;
            const cx = (chartArea.left + chartArea.right) / 2;
            const cy = (chartArea.top + chartArea.bottom) / 2;
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = lines.valueColor;
            ctx.font = "800 17px Inter, sans-serif";
            ctx.fillText(lines.value, cx, cy - 9);
            ctx.fillStyle = lines.labelColor;
            ctx.font = "600 10px Inter, sans-serif";
            ctx.fillText(lines.label, cx, cy + 11);
            ctx.restore();
        }
    };
}

/* ============================================
   CHART: Revenue vs Expenses (bar)
   ============================================ */
function renderRevExpChart(labels, revenue, expense) {
    const ctx = document.getElementById('chart-revenue-expense');
    if (!ctx || typeof Chart === 'undefined') return;

    const theme = chartTheme();

    if (charts.revExp) charts.revExp.destroy();
    charts.revExp = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Revenue', data: revenue, backgroundColor: barGradient(CHART_PALETTE.teal), borderRadius: 8, borderSkipped: false, maxBarThickness: 30, categoryPercentage: 0.62, barPercentage: 0.9 },
                { label: 'Expenses', data: expense, backgroundColor: barGradient(CHART_PALETTE.rose), borderRadius: 8, borderSkipped: false, maxBarThickness: 30, categoryPercentage: 0.62, barPercentage: 0.9 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 650, easing: 'easeOutQuart' },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: theme.text, font: { family: 'Inter', size: 11.5, weight: '600' }, usePointStyle: true, pointStyle: 'circle', padding: 16 } },
                tooltip: { ...tooltipStyle(theme), callbacks: { label: (c) => ` ${c.dataset.label}: RS ${Math.round(c.parsed.y).toLocaleString()}` } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: theme.text, font: { size: 11 } } },
                y: { grid: { color: theme.grid }, border: { display: false }, ticks: { color: theme.text, font: { size: 11 }, callback: v => v >= 1000 ? (v / 1000) + 'k' : v } }
            }
        }
    });
}

/* ============================================
   CHART: Attendance Trend (line)
   ============================================ */
function renderAttendanceChart(labels, studentPct, staffPct) {
    const ctx = document.getElementById('chart-attendance-trend');
    if (!ctx || typeof Chart === 'undefined') return;

    const theme = chartTheme();

    if (charts.attendance) charts.attendance.destroy();
    charts.attendance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Students', data: studentPct, borderColor: CHART_PALETTE.teal, borderWidth: 2.5,
                    backgroundColor: lineFillGradient(CHART_PALETTE.teal), fill: true, tension: 0.4,
                    spanGaps: true, pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: theme.cardBg,
                    pointBorderColor: CHART_PALETTE.teal, pointBorderWidth: 2
                },
                {
                    label: 'Staff', data: staffPct, borderColor: CHART_PALETTE.amber, borderWidth: 2.5,
                    backgroundColor: lineFillGradient(CHART_PALETTE.amber), fill: true, tension: 0.4,
                    spanGaps: true, pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: theme.cardBg,
                    pointBorderColor: CHART_PALETTE.amber, pointBorderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 650, easing: 'easeOutQuart' },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: theme.text, font: { family: 'Inter', size: 11.5, weight: '600' }, usePointStyle: true, pointStyle: 'circle', padding: 16 } },
                tooltip: { ...tooltipStyle(theme), callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y === null ? 'No data' : c.parsed.y + '%'}` } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: theme.text, font: { size: 11 } } },
                y: { min: 0, max: 100, grid: { color: theme.grid }, border: { display: false }, ticks: { color: theme.text, font: { size: 11 }, callback: v => v + '%' } }
            }
        }
    });
}

/* ============================================
   CHART: Net Cash Flow Trend (line, surplus/deficit aware)
   Plots revenue-minus-expense per bucket so admins can see at a glance
   which weeks/days ran a surplus vs a deficit, not just the period total.
   ============================================ */
function renderCashFlowTrend(labels, netSeries) {
    const ctx = document.getElementById('chart-cash-flow-trend');
    if (!ctx || typeof Chart === 'undefined') return;

    const theme = chartTheme();
    const teal = CHART_PALETTE.teal;
    const rose = CHART_PALETTE.rose;

    if (charts.cashFlow) charts.cashFlow.destroy();
    charts.cashFlow = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Net Cash Flow',
                data: netSeries,
                borderWidth: 2.5,
                fill: true,
                tension: 0.35,
                backgroundColor: lineFillGradient(teal),
                pointRadius: 4,
                pointHoverRadius: 6,
                pointBorderWidth: 2,
                pointBorderColor: theme.cardBg,
                pointBackgroundColor: netSeries.map(v => v >= 0 ? teal : rose),
                segment: {
                    borderColor: (segCtx) => (segCtx.p0.parsed.y < 0 || segCtx.p1.parsed.y < 0) ? rose : teal
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 650, easing: 'easeOutQuart' },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...tooltipStyle(theme),
                    callbacks: {
                        label: (c) => ` ${c.parsed.y >= 0 ? 'Surplus' : 'Deficit'}: RS ${Math.abs(Math.round(c.parsed.y)).toLocaleString()}`
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: theme.text, font: { size: 11 } } },
                y: {
                    grid: { color: theme.grid }, border: { display: false },
                    ticks: {
                        color: theme.text, font: { size: 11 },
                        callback: v => (v < 0 ? '−' : '') + 'RS ' + (Math.abs(v) >= 1000 ? Math.round(Math.abs(v) / 1000) + 'k' : Math.round(Math.abs(v)))
                    }
                }
            }
        },
        plugins: [{
            id: 'zeroLine',
            afterDraw(chart) {
                const { ctx: c, chartArea, scales } = chart;
                if (!chartArea) return;
                const y0 = scales.y.getPixelForValue(0);
                c.save();
                c.strokeStyle = theme.grid;
                c.setLineDash([4, 4]);
                c.lineWidth = 1;
                c.beginPath();
                c.moveTo(chartArea.left, y0);
                c.lineTo(chartArea.right, y0);
                c.stroke();
                c.restore();
            }
        }]
    });
}

/* ============================================
   CHART: Expense Breakdown (donut)
   ============================================ */
function renderExpenseBreakdown(salaries, bonus, other) {
    const ctx = document.getElementById('chart-expense-breakdown');
    if (!ctx || typeof Chart === 'undefined') return;

    const theme = chartTheme();
    const data = [salaries, bonus, other];
    const labels = ['Base Salaries', 'Staff Bonuses', 'Other Expenses'];
    const colors = [CHART_PALETTE.indigo, CHART_PALETTE.amber, CHART_PALETTE.rose];
    const total = data.reduce((a, b) => a + b, 0);

    if (charts.expenseBreak) charts.expenseBreak.destroy();
    charts.expenseBreak = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: total > 0 ? data : [1, 0, 0], backgroundColor: total > 0 ? colors : [hexToRgba(CHART_PALETTE.slate, 0.25)], borderWidth: 3, borderColor: theme.cardBg, hoverOffset: 6, borderRadius: 4 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            animation: { duration: 650, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: { ...tooltipStyle(theme), enabled: total > 0, callbacks: { label: (c) => ` RS ${Number(c.raw).toLocaleString()}` } }
            }
        },
        plugins: [centerTextPlugin(() => ({
            value: total > 0 ? 'RS ' + (total >= 1000 ? Math.round(total / 1000) + 'k' : Math.round(total)) : '—',
            label: 'Total Spend',
            valueColor: theme.textPrimary,
            labelColor: theme.text
        }))]
    });

    renderLegend('legend-expense-breakdown', labels, data, colors, total);
}

/* ============================================
   CHART: Fee Collection Status (donut)
   ============================================ */
function renderFeeStatus(collected, pending) {
    const ctx = document.getElementById('chart-fee-status');
    if (!ctx || typeof Chart === 'undefined') return;

    const theme = chartTheme();
    const data = [collected, pending];
    const labels = ['Collected', 'Pending'];
    const colors = [CHART_PALETTE.teal, CHART_PALETTE.amber];
    const total = data.reduce((a, b) => a + b, 0);
    const collectedPct = total > 0 ? Math.round((collected / total) * 100) : 0;

    if (charts.feeStatus) charts.feeStatus.destroy();
    charts.feeStatus = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: total > 0 ? data : [1, 0], backgroundColor: total > 0 ? colors : [hexToRgba(CHART_PALETTE.slate, 0.25)], borderWidth: 3, borderColor: theme.cardBg, hoverOffset: 6, borderRadius: 4 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            animation: { duration: 650, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: { ...tooltipStyle(theme), enabled: total > 0, callbacks: { label: (c) => ` RS ${Number(c.raw).toLocaleString()}` } }
            }
        },
        plugins: [centerTextPlugin(() => ({
            value: total > 0 ? collectedPct + '%' : '—',
            label: 'Collected',
            valueColor: theme.textPrimary,
            labelColor: theme.text
        }))]
    });

    renderLegend('legend-fee-status', labels, data, colors, total);
}

function renderLegend(elId, labels, data, colors, total) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = labels.map((lbl, i) => {
        const pct = total > 0 ? Math.round((data[i] / total) * 100) : 0;
        return `<li>
            <span class="legend-key"><span class="legend-dot" style="background:${colors[i]}"></span>${lbl}</span>
            <span class="legend-value">${pct}%</span>
        </li>`;
    }).join('');
}

/* ============================================
   TOP PENDING FEES LIST
   ============================================ */
function renderPendingFees(students) {
    const list = document.getElementById('pending-fees-list');
    if (!list) return;

    const rows = students.map(s => {
        const expected = (Number(s.standardFee) || 0) + (Number(s.transportFee) || 0);
        const collected = (s.feePayments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        const pendingAmt = Math.max(0, expected - collected);
        return {
            name: s.fullName || 'Unnamed Student',
            cls: `${s.studentClass || '—'}${s.section ? ' - ' + s.section : ''}`,
            pending: pendingAmt
        };
    }).filter(r => r.pending > 0).sort((a, b) => b.pending - a.pending).slice(0, 5);

    if (rows.length === 0) {
        list.innerHTML = '<li class="pending-empty">No pending fees — everything is collected.</li>';
        return;
    }

    list.innerHTML = rows.map(r => `
        <li>
            <span class="pending-name">
                <strong>${escapeHtml(r.name)}</strong>
                <span>${escapeHtml(r.cls)}</span>
            </span>
            <span class="pending-amount">RS ${Math.round(r.pending).toLocaleString()}</span>
        </li>
    `).join('');
}

/* ============================================
   QUICK LINKS ROW (cross-module snapshot)
   ============================================ */
/**
 * A student record may store its enrollment / dropout dates under different
 * field names depending on how manage-students.js writes them. We try the
 * common candidates in order and use whichever is present.
 */
function pickDate(obj, keys) {
    for (const k of keys) {
        if (obj && obj[k]) {
            const d = new Date(obj[k]);
            if (!isNaN(d)) return d;
        }
    }
    return null;
}

function isDroppedStudent(s) {
    const status = (s.status || s.enrollmentStatus || '').toString().toLowerCase();
    return s.isDropped === true || s.dropped === true || status === 'dropped' || status === 'inactive';
}

function renderQuickLinks(students) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const addedThisMonth = students.filter(s => {
        const d = pickDate(s, ['admissionDate', 'dateOfAdmission', 'joiningDate', 'enrollmentDate', 'dateAdded', 'createdAt']);
        return d && d >= monthStart && d <= monthEnd;
    }).length;
    setText('ql-students-added-count', addedThisMonth);

    const droppedThisMonth = students.filter(s => {
        if (!isDroppedStudent(s)) return false;
        const d = pickDate(s, ['dropDate', 'dateDropped', 'leftDate', 'deactivatedAt', 'statusChangedAt']);
        return d ? (d >= monthStart && d <= monthEnd) : true; // no drop date on record: still count it
    }).length;
    setText('ql-students-dropped-count', droppedThisMonth);

    const pendingCount = students.filter(s => {
        const expected = (Number(s.standardFee) || 0) + (Number(s.transportFee) || 0);
        const collected = (s.feePayments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        return expected - collected > 0;
    }).length;
    setText('ql-pending-count', pendingCount);
}

/* ============================================
   RECENT TRANSACTIONS TABLE
   ============================================ */
function renderTransactions(feePayments, otherExpenses, staffBonus, studentFines, staffFines, salaryEvents, periodStart, periodEnd) {
    const rows = [];

    feePayments.forEach(e => rows.push({ date: e.date, type: 'fee', typeLabel: 'Fee Payment', desc: e.label, amount: e.amount, direction: 'in' }));
    studentFines.forEach(e => rows.push({ date: e.date, type: 'fine-in', typeLabel: 'Fine Collected', desc: e.label, amount: e.amount, direction: 'in' }));
    staffFines.forEach(e => rows.push({ date: e.date, type: 'fine-in', typeLabel: 'Fine Collected', desc: e.label, amount: e.amount, direction: 'in' }));
    otherExpenses.forEach(e => rows.push({ date: e.date, type: 'expense', typeLabel: 'Expense', desc: e.label, amount: e.amount, direction: 'out' }));
    staffBonus.forEach(e => rows.push({ date: e.date, type: 'bonus', typeLabel: 'Bonus Paid', desc: e.label, amount: e.amount, direction: 'out' }));
    salaryEvents.forEach(e => rows.push({ date: e.date, type: 'salary', typeLabel: 'Salary Paid', desc: e.label, amount: e.amount, direction: 'out' }));

    let inPeriod = rows.filter(r => r.date >= periodStart && r.date <= periodEnd);
    if (currentTxnFilter !== 'all') {
        inPeriod = inPeriod.filter(r => r.type === currentTxnFilter);
    }
    inPeriod.sort((a, b) => b.date - a.date);

    allPeriodTxnRows = inPeriod; // full set, used by CSV export
    const shown = inPeriod.slice(0, 14);

    const tbody = document.getElementById('txn-tbody');
    const countEl = document.getElementById('rp-txn-count');
    if (countEl) countEl.textContent = `${inPeriod.length} record${inPeriod.length === 1 ? '' : 's'}`;

    if (!tbody) return;
    if (shown.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No transactions recorded for this period yet.</td></tr>';
        return;
    }

    tbody.innerHTML = shown.map(r => `
        <tr>
            <td>${r.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
            <td><span class="txn-type-badge ${r.type}">${r.typeLabel}</span></td>
            <td class="txn-desc">${escapeHtml(r.desc)}</td>
            <td class="txn-amount ${r.direction}">${r.direction === 'in' ? '+' : '−'} RS ${Math.round(r.amount).toLocaleString()}</td>
        </tr>
    `).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}