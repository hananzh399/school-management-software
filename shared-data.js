/**
 * EDUFLOW PRO - SHARED DATA LAYER
 * Manages global state via LocalStorage across all pages.
 */

// ── DOUBLE-LOAD GUARD ────────────────────────────────────────────────────
// If a page accidentally includes this file more than once (two <script>
// tags, or it's pulled in both directly and via another bundled script),
// a second run of top-level `const`/`let` declarations throws
// "Identifier 'DEFAULT_DATA' has already been declared" and breaks the
// whole page. Wrapping everything in this IIFE means each <script> tag
// gets its own function scope, so re-including the file is harmless — and
// the flag below skips the extra work entirely on repeat loads.
if (window.__EDUFLOW_SHARED_DATA_LOADED__) {
    console.warn('shared-data.js was included more than once on this page — skipping duplicate load. Check your HTML for a repeated <script src="shared-data.js"> tag.');
} else {
window.__EDUFLOW_SHARED_DATA_LOADED__ = true;

const DEFAULT_DATA = {
    staff: {
        'Teaching': [],
        'Non-Teaching': []
    },
    students: {
        totalCount: 0,
        withPendingFees: 0,
        fines: {
            lateFees: 0,
            other: 0
        }
    },
    finances: {
        fees: {
            expected: 0,
            collected: 0,
            pending: 0
        },
        expenses: {
            other: 0
        },
        historical: {
            lastMonthProfit: 0
        }
    }
};

function getGlobalData() {
    const data = localStorage.getItem('eduflow-db');
    if (!data) {
        localStorage.setItem('eduflow-db', JSON.stringify(DEFAULT_DATA));
        return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
    return JSON.parse(data);
}

function saveGlobalData(data) {
    localStorage.setItem('eduflow-db', JSON.stringify(data));
}

function calculateFinancials() {
    const db = getGlobalData();

    // ── REAL student count from edu_students ──────────────────────────────
    const allStudents = JSON.parse(localStorage.getItem('edu_students') || '[]');
    const realStudentCount = allStudents.length;

    // ── REAL fee totals computed from every student's feePayments ────────
    const currentMonthKey = (() => {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
    })();

    let totalCollected = 0;
    let totalPending   = 0;
    let pendingCount   = 0;

    allStudents.forEach(s => {
        // Monthly expected (what the fee table shows as "pending")
        const tuition   = Number(s.standardFee)       || 0;
        const transport = Number(s.transportFee)       || 0;
        const tDisc     = Number(s.tuitionDiscount)    || 0;
        const trDisc    = Number(s.transportDiscount)  || 0;
        const sibDisc   = Number(s.siblingDiscount)    || 0;
        const monthly   = Math.max(0, tuition + transport - tDisc - trDisc - sibDisc);

        const payments   = s.feePayments || [];
        const paidThisMonth = payments
            .filter(p => p.monthKey === currentMonthKey)
            .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

        // Lifetime collected
        const lifetimeCollected = payments
            .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

        totalCollected += lifetimeCollected;

        const pendingThisMonth = Math.max(0, monthly - paidThisMonth);
        totalPending += pendingThisMonth;
        if (pendingThisMonth > 0) pendingCount++;
    });

    // ── STAFF salaries + fines ────────────────────────────────────────────
    let totalTeacherSalaries = 0, totalNonTeachingSalaries = 0;
    let totalTeacherFines = 0,    totalNonTeachingFines = 0;

    db.staff['Teaching'].forEach(s => {
        totalTeacherSalaries += Number(s.salary) || 0;
        totalTeacherFines    += Number(s.fines)  || 0;
    });
    db.staff['Non-Teaching'].forEach(s => {
        totalNonTeachingSalaries += Number(s.salary) || 0;
        totalNonTeachingFines    += Number(s.fines)  || 0;
    });

    const totalBaseSalaries = totalTeacherSalaries + totalNonTeachingSalaries;
    const totalStaffFines   = totalTeacherFines + totalNonTeachingFines;

    // ── STUDENT fines ─────────────────────────────────────────────────────
    const studentFinesRaw   = JSON.parse(localStorage.getItem('eduflow-student-fines') || '[]');
    const totalStudentFines = studentFinesRaw.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

    // ── OTHER expenses ────────────────────────────────────────────────────
    const otherExpensesRaw  = JSON.parse(localStorage.getItem('eduflow-other-expenses') || '[]');
    const totalOtherExpenses= otherExpensesRaw.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    // ── STAFF bonus (reduces net profit, counts as expense) ──────────────
    const staffBonusRaw     = JSON.parse(localStorage.getItem('eduflow-staff-bonus') || '[]');
    const totalStaffBonus   = staffBonusRaw.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

    const autoLateFeePerStudent = 150;
    const autoLateFees = pendingCount * autoLateFeePerStudent;

    const netExpenses = totalBaseSalaries + totalOtherExpenses + totalStaffBonus - totalStaffFines;
    const totalRevenueCollected = totalCollected + totalStudentFines + autoLateFees;
    const netProfit = totalRevenueCollected - netExpenses;

    return {
        db,
        realStudentCount,
        salaries: {
            total: totalBaseSalaries,
            teaching: totalTeacherSalaries,
            nonTeaching: totalNonTeachingSalaries
        },
        staffBonusTotal: totalStaffBonus,
        fines: {
            staffTotal: totalStaffFines,
            studentTotal: totalStudentFines,
            studentLate: autoLateFees,
            studentOther: totalStudentFines
        },
        fees: {
            expected: totalCollected + totalPending,
            collected: totalCollected,
            pending: totalPending
        },
        netExpenses,
        netProfit,
        lastMonthProfit: db.finances.historical.lastMonthProfit || 0
    };
}

// Attach to window explicitly. In a classic (non-module) script, unqualified
// references like `getGlobalData()` from other files already resolve against
// `window`, so this keeps every other page's existing calls working exactly
// as before while still being safely scoped inside this IIFE.
window.DEFAULT_DATA        = DEFAULT_DATA;
window.getGlobalData       = getGlobalData;
window.saveGlobalData      = saveGlobalData;
window.calculateFinancials = calculateFinancials;

} // end double-load guard