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

// Helpers for Dashboard Calculations
function calculateFinancials() {
    const db = getGlobalData();
    
    // 1. Calculate Staff Salaries & Fines
    let totalBaseSalaries = 0;
    let totalTeacherSalaries = 0;
    let totalNonTeachingSalaries = 0;
    let totalTeacherFines = 0;
    let totalNonTeachingFines = 0;

    db.staff['Teaching'].forEach(s => {
        totalTeacherSalaries += Number(s.salary) || 0;
        totalTeacherFines += Number(s.fines) || 0;
    });

    db.staff['Non-Teaching'].forEach(s => {
        totalNonTeachingSalaries += Number(s.salary) || 0;
        totalNonTeachingFines += Number(s.fines) || 0;
    });

    totalBaseSalaries = totalTeacherSalaries + totalNonTeachingSalaries;
    const totalStaffFines = totalTeacherFines + totalNonTeachingFines;

    // 2. Student Late Fees
    const autoLateFeePerStudent = 150;
    const totalAutoLateFees = db.students.withPendingFees * autoLateFeePerStudent;
    db.students.fines.lateFees = totalAutoLateFees;

    const adjustedPendingFees = db.finances.fees.pending + totalAutoLateFees;
    const adjustedExpectedFees = db.finances.fees.expected + totalAutoLateFees;
    
    // Total net expenses (Base + Other - Staff Fines)
    const netExpenses = totalBaseSalaries + db.finances.expenses.other - totalStaffFines;
    
    // Total Revenue (Collected + All Student Fines)
    const totalStudentFines = db.students.fines.lateFees + db.students.fines.other;
    const totalRevenueCollected = db.finances.fees.collected + totalStudentFines;
    
    // Net Profit
    const netProfit = totalRevenueCollected - netExpenses;

    return {
        db,
        salaries: {
            total: totalBaseSalaries,
            teaching: totalTeacherSalaries,
            nonTeaching: totalNonTeachingSalaries
        },
        fines: {
            staffTotal: totalStaffFines,
            teaching: totalTeacherFines,
            nonTeaching: totalNonTeachingFines,
            studentTotal: totalStudentFines,
            studentLate: db.students.fines.lateFees,
            studentOther: db.students.fines.other
        },
        fees: {
            expected: adjustedExpectedFees,
            collected: db.finances.fees.collected,
            pending: adjustedPendingFees
        },
        netExpenses,
        netProfit,
        lastMonthProfit: db.finances.historical.lastMonthProfit
    };
}
