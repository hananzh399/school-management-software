/**
 * EDUFLOW PRO - REPORTS & ANALYTICS
 * Reads the same LocalStorage data sources used by the rest of the app
 * (fee payments, expenses, bonuses, fines, attendance marks) and renders
 * period-based charts (Week / Month / Year) + a recent transactions feed.
 * No other page's data is modified — this page is read-only.
 */

let currentPeriod = 'month';
let charts = { revExp: null, attendance: null, expenseBreak: null, feeStatus: null };

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initSidebar();
    initNavSearch();
    initDate();
    initPeriodSwitch();
    renderReports();

    // Live-refresh if data changes in another tab, same pattern as main.js
    window.addEventListener('storage', (e) => {
        const watched = ['edu_students', 'eduflow-db', 'eduflow-student-fines',
            'eduflow-staff-fines', 'eduflow-staff-bonus', 'eduflow-other-expenses'];
        if (watched.includes(e.key) || (e.key && e.key.startsWith('eduflow_'))) {
            renderReports();
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
   PERIOD SWITCH (Week / Month / Year)
   ============================================ */
function initPeriodSwitch() {
    const wrap = document.getElementById('period-switch');
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
        const btn = e.target.closest('.period-btn');
        if (!btn) return;
        wrap.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPeriod = btn.dataset.period;
        renderReports();
    });
}

/* ============================================
   DATA READERS (raw, dated events)
   ============================================ */
function safeParse(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch (e) { return fallback; }
}

function getAllFeePayments() {
    const students = safeParse('edu_students', []);
    const out = [];
    students.forEach(s => {
        (s.feePayments || []).forEach(p => {
            const d = new Date(p.date);
            if (!isNaN(d)) out.push({ date: d, amount: Number(p.amount) || 0, label: `Fee payment — ${s.fullName || 'Student'}` });
        });
    });
    return out;
}

function getAllOtherExpenses() {
    return safeParse('eduflow-other-expenses', []).map(e => ({
        date: new Date(e.date), amount: Number(e.amount) || 0,
        label: e.description || 'Operational expense'
    })).filter(e => !isNaN(e.date));
}

function getAllStaffBonus() {
    return safeParse('eduflow-staff-bonus', []).map(b => ({
        date: new Date(b.date), amount: Number(b.amount) || 0,
        label: `Bonus — ${b.name || 'Staff'}`
    })).filter(b => !isNaN(b.date));
}

function getAllStudentFines() {
    return safeParse('eduflow-student-fines', []).map(f => ({
        date: new Date(f.date), amount: Number(f.amount) || 0,
        label: `Student fine — ${f.name || 'Student'}`
    })).filter(f => !isNaN(f.date));
}

function getAllStaffFines() {
    return safeParse('eduflow-staff-fines', []).map(f => ({
        date: new Date(f.date), amount: Number(f.amount) || 0,
        label: `Staff fine — ${f.name || 'Staff'}`
    })).filter(f => !isNaN(f.date));
}

/* ============================================
   ATTENDANCE READER (per calendar date)
   ============================================ */
function getAttendanceForDate(dateKey) {
    let presentStudents = 0, totalStudents = 0, presentStaff = 0, totalStaff = 0, hasData = false;

    for (let key in localStorage) {
        if (!key.startsWith('eduflow_att_' + dateKey)) continue;
        try {
            const payload = JSON.parse(localStorage.getItem(key));
            if (!payload || !payload.records) continue;
            hasData = true;
            Object.values(payload.records).forEach(r => {
                totalStudents++;
                if (r.status === 'present') presentStudents++;
            });
        } catch (e) { /* skip malformed */ }
    }

    const staffRaw = localStorage.getItem('eduflow_staff_att_' + dateKey);
    if (staffRaw) {
        try {
            const payload = JSON.parse(staffRaw);
            if (payload && payload.records) {
                hasData = true;
                Object.values(payload.records).forEach(r => {
                    totalStaff++;
                    if (r.status === 'present') presentStaff++;
                });
            }
        } catch (e) { /* skip malformed */ }
    }

    return { presentStudents, totalStudents, presentStaff, totalStaff, hasData };
}

/* ============================================
   PERIOD BUCKETS
   ============================================ */
function toDateKey(d) { return d.toISOString().slice(0, 10); }

function getBuckets(period) {
    const buckets = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (period === 'week') {
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const end = new Date(d); end.setHours(23, 59, 59, 999);
            buckets.push({ label: d.toLocaleDateString('en-US', { weekday: 'short' }), start: new Date(d), end, days: [new Date(d)] });
        }
    } else if (period === 'month') {
        for (let i = 3; i >= 0; i--) {
            const end = new Date(today); end.setDate(end.getDate() - i * 7);
            const start = new Date(end); start.setDate(start.getDate() - 6);
            const endOfDay = new Date(end); endOfDay.setHours(23, 59, 59, 999);
            const days = [];
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
            buckets.push({ label: `Week ${4 - i}`, start, end: endOfDay, days });
        }
    } else { // year
        for (let i = 11; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const start = new Date(d.getFullYear(), d.getMonth(), 1);
            const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
            const days = [];
            for (let day = new Date(start); day <= end && day <= today; day.setDate(day.getDate() + 1)) days.push(new Date(day));
            buckets.push({ label: d.toLocaleDateString('en-US', { month: 'short' }), start, end, days });
        }
    }
    return buckets;
}

function sumInRange(events, start, end) {
    return events.reduce((sum, e) => (e.date >= start && e.date <= end) ? sum + e.amount : sum, 0);
}

/* ============================================
   THEME-AWARE COLOR HELPER
   ============================================ */
function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ============================================
   MAIN RENDER
   ============================================ */
function renderReports() {
    const buckets = getBuckets(currentPeriod);
    const periodStart = buckets[0].start;
    const periodEnd = buckets[buckets.length - 1].end;

    const feePayments = getAllFeePayments();
    const otherExpenses = getAllOtherExpenses();
    const staffBonus = getAllStaffBonus();
    const studentFines = getAllStudentFines();
    const staffFines = getAllStaffFines();

    // ---------- Per-bucket revenue / expense series ----------
    const revenueSeries = buckets.map(b =>
        sumInRange(feePayments, b.start, b.end) +
        sumInRange(studentFines, b.start, b.end) +
        sumInRange(staffFines, b.start, b.end)
    );
    const expenseSeries = buckets.map(b =>
        sumInRange(otherExpenses, b.start, b.end) +
        sumInRange(staffBonus, b.start, b.end)
    );

    const periodRevenue = revenueSeries.reduce((a, b) => a + b, 0);
    const periodExpense = expenseSeries.reduce((a, b) => a + b, 0);
    const netFlow = periodRevenue - periodExpense;

    setText('rp-total-revenue', 'RS ' + Math.round(periodRevenue).toLocaleString());
    setText('rp-total-expense', 'RS ' + Math.round(periodExpense).toLocaleString());
    setText('rp-net-flow', 'RS ' + Math.round(netFlow).toLocaleString());

    const netFlowEl = document.getElementById('rp-net-flow');
    if (netFlowEl) netFlowEl.style.color = netFlow >= 0 ? '#10b981' : '#ef4444';

    const trendBadge = document.getElementById('rp-trend-badge');
    if (trendBadge) {
        const hasActivity = periodRevenue > 0 || periodExpense > 0;
        trendBadge.className = hasActivity ? 'trend up' : 'trend neutral';
        trendBadge.innerHTML = hasActivity
            ? '<i class="fas fa-circle" style="font-size:7px;"></i> Live'
            : '<i class="fas fa-circle" style="font-size:7px;"></i> No activity yet';
    }

    // ---------- Attendance series ----------
    const attendanceStudentSeries = [];
    const attendanceStaffSeries = [];
    let attendanceHasAnyData = false;
    let sumStudentPct = 0, sumStaffPct = 0, countStudentDays = 0, countStaffDays = 0;

    buckets.forEach(b => {
        let sPresent = 0, sTotal = 0, stPresent = 0, stTotal = 0, dayHasData = false;
        b.days.forEach(day => {
            const rec = getAttendanceForDate(toDateKey(day));
            if (rec.hasData) { dayHasData = true; attendanceHasAnyData = true; }
            sPresent += rec.presentStudents; sTotal += rec.totalStudents;
            stPresent += rec.presentStaff; stTotal += rec.totalStaff;
        });
        const sPct = sTotal > 0 ? Math.round((sPresent / sTotal) * 100) : null;
        const stPct = stTotal > 0 ? Math.round((stPresent / stTotal) * 100) : null;
        attendanceStudentSeries.push(sPct);
        attendanceStaffSeries.push(stPct);
        if (sPct !== null) { sumStudentPct += sPct; countStudentDays++; }
        if (stPct !== null) { sumStaffPct += stPct; countStaffDays++; }
    });

    const avgStudentPct = countStudentDays ? Math.round(sumStudentPct / countStudentDays) : 0;
    const avgStaffPct = countStaffDays ? Math.round(sumStaffPct / countStaffDays) : 0;
    const avgOverall = (countStudentDays || countStaffDays)
        ? Math.round((avgStudentPct * (countStudentDays ? 1 : 0) + avgStaffPct * (countStaffDays ? 1 : 0)) /
            ((countStudentDays ? 1 : 0) + (countStaffDays ? 1 : 0) || 1))
        : 0;
    setText('rp-avg-attendance', avgOverall + '%');

    // ---------- Expense breakdown (whole-of-record totals, matches Fees & Finance) ----------
    const db = safeParse('eduflow-db', { staff: { Teaching: [], 'Non-Teaching': [] } });
    const teaching = (db.staff && db.staff['Teaching']) || [];
    const nonTeaching = (db.staff && db.staff['Non-Teaching']) || [];
    const totalSalaries = [...teaching, ...nonTeaching].reduce((s, m) => s + (Number(m.salary) || 0), 0);
    const totalBonusAll = staffBonus.reduce((s, b) => s + b.amount, 0);
    const totalOtherAll = otherExpenses.reduce((s, e) => s + e.amount, 0);

    // ---------- Fee collection status (real students, current global picture) ----------
    const students = safeParse('edu_students', []);
    let expected = 0, collected = 0;
    students.forEach(s => {
        expected += (Number(s.standardFee) || 0) + (Number(s.transportFee) || 0);
        (s.feePayments || []).forEach(p => { collected += Number(p.amount) || 0; });
    });
    const pending = Math.max(0, expected - collected);

    // ---------- Render charts ----------
    renderRevExpChart(buckets.map(b => b.label), revenueSeries, expenseSeries);
    renderAttendanceChart(buckets.map(b => b.label), attendanceStudentSeries, attendanceStaffSeries);
    renderExpenseBreakdown(totalSalaries, totalBonusAll, totalOtherAll);
    renderFeeStatus(collected, pending);

    document.getElementById('chart-revenue-expense-empty').style.display =
        (periodRevenue === 0 && periodExpense === 0) ? 'block' : 'none';
    document.getElementById('chart-attendance-trend-empty').style.display =
        attendanceHasAnyData ? 'none' : 'block';

    // ---------- Transactions table ----------
    renderTransactions(feePayments, otherExpenses, staffBonus, studentFines, staffFines, periodStart, periodEnd);
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

/* ============================================
   CHART: Revenue vs Expenses (bar)
   ============================================ */
function renderRevExpChart(labels, revenue, expense) {
    const ctx = document.getElementById('chart-revenue-expense');
    if (!ctx || typeof Chart === 'undefined') return;

    const gridColor = cssVar('--border-subtle') || 'rgba(255,255,255,0.06)';
    const textColor = cssVar('--text-secondary') || '#8892a8';

    if (charts.revExp) charts.revExp.destroy();
    charts.revExp = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Revenue', data: revenue, backgroundColor: '#10b981', borderRadius: 6, maxBarThickness: 34 },
                { label: 'Expenses', data: expense, backgroundColor: '#ef4444', borderRadius: 6, maxBarThickness: 34 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: textColor, font: { family: 'Inter', size: 11.5, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
                tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: RS ${Number(c.parsed.y).toLocaleString()}` } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: textColor, font: { size: 11 } } },
                y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 11 }, callback: v => v >= 1000 ? (v / 1000) + 'k' : v } }
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

    const gridColor = cssVar('--border-subtle') || 'rgba(255,255,255,0.06)';
    const textColor = cssVar('--text-secondary') || '#8892a8';

    if (charts.attendance) charts.attendance.destroy();
    charts.attendance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Students', data: studentPct, borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59,130,246,0.12)', fill: true, tension: 0.35,
                    spanGaps: true, pointRadius: 3, pointBackgroundColor: '#3b82f6'
                },
                {
                    label: 'Staff', data: staffPct, borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245,158,11,0.12)', fill: true, tension: 0.35,
                    spanGaps: true, pointRadius: 3, pointBackgroundColor: '#f59e0b'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: textColor, font: { family: 'Inter', size: 11.5, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
                tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y === null ? 'No data' : c.parsed.y + '%'}` } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: textColor, font: { size: 11 } } },
                y: { min: 0, max: 100, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 11 }, callback: v => v + '%' } }
            }
        }
    });
}

/* ============================================
   CHART: Expense Breakdown (donut)
   ============================================ */
function renderExpenseBreakdown(salaries, bonus, other) {
    const ctx = document.getElementById('chart-expense-breakdown');
    if (!ctx || typeof Chart === 'undefined') return;

    const data = [salaries, bonus, other];
    const labels = ['Base Salaries', 'Staff Bonuses', 'Other Expenses'];
    const colors = ['#3b82f6', '#f59e0b', '#ef4444'];
    const total = data.reduce((a, b) => a + b, 0);

    if (charts.expenseBreak) charts.expenseBreak.destroy();
    charts.expenseBreak = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: total > 0 ? data : [1, 0, 0], backgroundColor: total > 0 ? colors : ['rgba(148,163,184,0.25)'], borderWidth: 0 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { display: false },
                tooltip: { enabled: total > 0, callbacks: { label: (c) => ` RS ${Number(c.raw).toLocaleString()}` } }
            }
        }
    });

    renderLegend('legend-expense-breakdown', labels, data, colors, total);
}

/* ============================================
   CHART: Fee Collection Status (donut)
   ============================================ */
function renderFeeStatus(collected, pending) {
    const ctx = document.getElementById('chart-fee-status');
    if (!ctx || typeof Chart === 'undefined') return;

    const data = [collected, pending];
    const labels = ['Collected', 'Pending'];
    const colors = ['#10b981', '#f59e0b'];
    const total = data.reduce((a, b) => a + b, 0);

    if (charts.feeStatus) charts.feeStatus.destroy();
    charts.feeStatus = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: total > 0 ? data : [1, 0], backgroundColor: total > 0 ? colors : ['rgba(148,163,184,0.25)'], borderWidth: 0 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { display: false },
                tooltip: { enabled: total > 0, callbacks: { label: (c) => ` RS ${Number(c.raw).toLocaleString()}` } }
            }
        }
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
   RECENT TRANSACTIONS TABLE
   ============================================ */
function renderTransactions(feePayments, otherExpenses, staffBonus, studentFines, staffFines, periodStart, periodEnd) {
    const rows = [];

    feePayments.forEach(e => rows.push({ date: e.date, type: 'fee', typeLabel: 'Fee Payment', desc: e.label, amount: e.amount, direction: 'in' }));
    studentFines.forEach(e => rows.push({ date: e.date, type: 'fine-in', typeLabel: 'Fine Collected', desc: e.label, amount: e.amount, direction: 'in' }));
    staffFines.forEach(e => rows.push({ date: e.date, type: 'fine-in', typeLabel: 'Fine Collected', desc: e.label, amount: e.amount, direction: 'in' }));
    otherExpenses.forEach(e => rows.push({ date: e.date, type: 'expense', typeLabel: 'Expense', desc: e.label, amount: e.amount, direction: 'out' }));
    staffBonus.forEach(e => rows.push({ date: e.date, type: 'bonus', typeLabel: 'Bonus Paid', desc: e.label, amount: e.amount, direction: 'out' }));

    const inPeriod = rows.filter(r => r.date >= periodStart && r.date <= periodEnd);
    inPeriod.sort((a, b) => b.date - a.date);
    const shown = inPeriod.slice(0, 15);

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
