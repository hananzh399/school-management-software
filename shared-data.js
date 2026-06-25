/**
 * EDUFLOW PRO - SHARED DATA LAYER
 * Manages global state via LocalStorage across all pages.
 */

const DEFAULT_DATA = {
    staff: {
        'Teaching': [
            {
                id: "TCH-9021", name: "Taha Khan", qualification: "M.Sc. Mathematics, B.Ed", subjects: "Mathematics, Physics", classes: "Grade 9, Grade 10", incharge: "Grade 10-A", gender: "Male", salary: 4500, joined: "Aug 15, 2021", cnic: "42101-1234567-1", phone: "+1 (555) 123-4567", address: "123 Education Lane",
                fines: 0
            }
        ],
        'Non-Teaching': [
            {
                id: "NTS-4012", name: "John Doe", job: "Maintenance Supervisor", startTime: "07:00 AM", endTime: "04:00 PM", gender: "Male", salary: 3200, cnic: "12345-6789012-3", phone: "+1 (555) 987-6543", address: "456 Facility Rd",
                fines: 0
            }
        ]
    },
    students: {
        totalCount: 1245,
        withPendingFees: 125,
        fines: {
            lateFees: 0, // Automatically calculated
            other: 12000 // Disciplinary, etc.
        }
    },
    finances: {
        fees: {
            expected: 4500000,
            collected: 3800000,
            pending: 700000
        },
        expenses: {
            other: 450000
        },
        historical: {
            lastMonthProfit: 1400000
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
