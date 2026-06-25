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
         'eduflow-staff-fines', 'eduflow-staff-bonus', 'eduflow-other-expenses'].includes(e.key)) {
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
    
    // 5. Update the UI
    // Demographics
    animateCounter('total-students', data.realStudentCount);
    
    const totalStaff = data.db.staff['Teaching'].length + data.db.staff['Non-Teaching'].length;
    animateCounter('total-staff', totalStaff);

    // Revenue
    animateCounter('expected-fees', data.fees.expected);
    animateCounter('collected-fees', data.fees.collected);
    animateCounter('pending-fees', data.fees.pending);
    animateCounter('student-late-fines', data.fines.studentLate); 
    animateCounter('student-other-fines', data.fines.studentOther); 

    // Expenses
    animateCounter('base-salaries', data.salaries.total);
    animateCounter('staff-fines', data.fines.staffTotal);
    animateCounter('other-expenses', data.db.finances.expenses.other);
    animateCounter('net-expenses', data.netExpenses);

    // Profit
    animateCounter('net-profit', data.netProfit);
    animateCounter('past-month-profit', data.lastMonthProfit);
    
    // Update Trend UI
    const lastMonth = data.lastMonthProfit;
    const profitDiff = data.netProfit - lastMonth;
    const percentChange = ((profitDiff / lastMonth) * 100).toFixed(1);

    const trendEl = document.getElementById('profit-trend');
    if (profitDiff >= 0) {
        trendEl.className = 'trend up';
        trendEl.innerHTML = `<i class="fas fa-arrow-up"></i> ${percentChange}% vs last month`;
    } else {
        trendEl.className = 'trend down';
        trendEl.innerHTML = `<i class="fas fa-arrow-down"></i> ${Math.abs(percentChange)}% vs last month`;
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
