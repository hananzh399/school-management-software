// Parent Portal – Attendance page script
(function () {
  'use strict';

  // ---------- Redirect to index on page refresh ----------
  (function redirectOnRefresh() {
    const navEntries = performance.getEntriesByType && performance.getEntriesByType('navigation');
    const isReload = (navEntries && navEntries[0] && navEntries[0].type === 'reload')
      || (performance.navigation && performance.navigation.type === 1);
    if (isReload) {
      window.location.replace('parent-portal-index.html');
    }
  })();

  // ===================================================
  // Language
  // ===================================================
  const I18n = window.PortalI18n;
  if (I18n) I18n.apply();
  const tr = (key, fallback) => (I18n ? I18n.t(key) : fallback);
  const onScreen = (text) => (I18n ? I18n.iso(text) : text);
  const isUrdu = () => !!I18n && I18n.getLang() === 'ur';

  // ===================================================
  // State
  // ===================================================
  const now = new Date();
  let currentYear = now.getFullYear();
  let currentMonth = now.getMonth(); // 0-11

  // "Today" — local midnight
  const TODAY = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // ===================================================
  // Mock attendance data
  // Key: 'YYYY-MM-DD', Value: 'present' | 'absent' | 'leave' | 'holiday'
  //
  // Builds statuses for the current month AND previous months
  // (up to ~4 months back) so navigating to previous months shows
  // a realistic historical record.
  // ===================================================
  const ATTENDANCE = {};

  // Real marks from the school's attendance sheet. Sundays with no mark are shown as holidays,
  // exactly as before; any other unmarked day stays "unmarked".
  async function loadData() {
    const d = await PortalAPI.get(PortalAPI.forChild('/attendance'));
    Object.keys(ATTENDANCE).forEach((k) => delete ATTENDANCE[k]);
    const days = (d && d.days) || {};
    Object.keys(days).forEach((k) => { ATTENDANCE[k] = days[k]; });
    const keys = Object.keys(days).sort();
    const pad2 = (n) => String(n).padStart(2, '0');
    const from = keys.length ? new Date(keys[0] + 'T00:00:00') : TODAY;
    for (let dt = new Date(from); dt <= TODAY; dt.setDate(dt.getDate() + 1)) {
      const k = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
      if (dt.getDay() === 0 && !ATTENDANCE[k]) ATTENDANCE[k] = 'holiday';
    }
  }

  // ===================================================
  // Helpers
  // ===================================================
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const pad2 = (n) => String(n).padStart(2, '0');

  function dateKey(y, m, d) {
    return `${y}-${pad2(m + 1)}-${pad2(d)}`;
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function statusLabel(status) {
    switch (status) {
      case 'present': return tr('attPresent', 'Present');
      case 'absent':  return tr('attAbsent', 'Absent');
      case 'leave':   return tr('attLeave', 'Leave');
      case 'holiday': return tr('attHoliday', 'Holiday');
      default:        return tr('attNotMarked', 'Not Marked');
    }
  }

  // Month name for tooltips (plain text) in the chosen language
  function monthName(idx) {
    return isUrdu() ? I18n.monthShort(idx) : MONTH_NAMES[idx];
  }

  function statusIcon(status) {
    switch (status) {
      case 'present':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      case 'absent':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      case 'leave':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>';
      case 'holiday':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
      default:
        return '';
    }
  }

  // ===================================================
  // Today's card
  // ===================================================
  function renderTodayCard() {
    const dateEl = document.getElementById('attTodayDate');
    const statusEl = document.getElementById('attTodayStatus');

    if (dateEl) {
      if (isUrdu()) {
        const dow = I18n.weekdayShort(TODAY.getDay());
        const mo = I18n.monthShort(TODAY.getMonth());
        dateEl.textContent = onScreen(`${dow}، ${TODAY.getDate()} ${mo} ${TODAY.getFullYear()}`);
      } else {
        const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][TODAY.getDay()];
        const mo = MONTH_NAMES[TODAY.getMonth()].slice(0, 3);
        dateEl.textContent = `${dow}, ${TODAY.getDate()} ${mo} ${TODAY.getFullYear()}`;
      }
    }

    if (statusEl) {
      const key = dateKey(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
      const status = ATTENDANCE[key] || 'unmarked';
      const label = statusLabel(status);
      const icon = statusIcon(status);
      statusEl.innerHTML = `
        <span class="att-status-pill att-status-${status}">
          ${icon}
          <span>${onScreen(label)}</span>
        </span>
      `;
    }
  }

  // ===================================================
  // Summary counts (for the current month shown)
  // ===================================================
  function renderSummary() {
    const counts = { present: 0, absent: 0, leave: 0, holiday: 0 };
    const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();

    for (let d = 1; d <= lastDay; d++) {
      const date = new Date(currentYear, currentMonth, d);
      if (date > TODAY) continue;
      const key = dateKey(currentYear, currentMonth, d);
      const status = ATTENDANCE[key];
      if (status && counts.hasOwnProperty(status)) counts[status]++;
    }

    const cP = document.getElementById('attCountPresent');
    const cA = document.getElementById('attCountAbsent');
    const cL = document.getElementById('attCountLeave');
    const cH = document.getElementById('attCountHoliday');
    if (cP) cP.textContent = counts.present;
    if (cA) cA.textContent = counts.absent;
    if (cL) cL.textContent = counts.leave;
    if (cH) cH.textContent = counts.holiday;
  }

  // ===================================================
  // Calendar grid
  // ===================================================
  function renderCalendar() {
    const gridEl = document.getElementById('attCalendarGrid');
    const labelEl = document.getElementById('attMonthLabel');
    const subEl = document.getElementById('attMonthSub');
    if (!gridEl) return;

    if (labelEl) {
      labelEl.textContent = I18n
        ? I18n.formatMonth(`${currentYear}-${pad2(currentMonth + 1)}`)
        : `${MONTH_NAMES[currentMonth]} ${currentYear}`;
    }
    if (subEl) {
      const isCurrentMonth = (currentYear === TODAY.getFullYear() && currentMonth === TODAY.getMonth());
      subEl.textContent = onScreen(isCurrentMonth ? tr('currentMonthLabel', 'Current month') : tr('pastMonthLabel', 'Past month'));
    }

    gridEl.innerHTML = '';

    const firstDay = new Date(currentYear, currentMonth, 1);
    const startWeekday = firstDay.getDay(); // 0 = Sunday
    const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();

    // Empty leading cells
    for (let i = 0; i < startWeekday; i++) {
      const empty = document.createElement('div');
      empty.className = 'att-day att-day-empty';
      empty.setAttribute('aria-hidden', 'true');
      gridEl.appendChild(empty);
    }

    // Actual days
    for (let d = 1; d <= lastDay; d++) {
      const date = new Date(currentYear, currentMonth, d);
      const key = dateKey(currentYear, currentMonth, d);
      const status = ATTENDANCE[key];

      const cell = document.createElement('div');
      cell.className = 'att-day';
      cell.dataset.date = key;

      if (date.getDay() === 0) cell.classList.add('att-sunday');

      const isToday = isSameDay(date, TODAY);
      const isFuture = date > TODAY;

      if (isFuture) {
        cell.classList.add('att-future');
        if (status) cell.classList.add('att-' + status);
      } else if (status) {
        cell.classList.add('att-' + status);
      } else {
        cell.classList.add('att-unmarked');
      }

      if (isToday) cell.classList.add('att-today');

      // Day number
      const numSpan = document.createElement('span');
      numSpan.className = 'att-day-num';
      numSpan.textContent = String(d);
      cell.appendChild(numSpan);

      // Status letter (mini indicator) — for past/current dates with status
      if (!isFuture && status) {
        const markSpan = document.createElement('span');
        markSpan.className = 'att-day-mark';
        const short = {
          present: tr('markP', 'P'),
          absent:  tr('markA', 'A'),
          leave:   tr('markL', 'L'),
          holiday: tr('markH', 'H')
        }[status] || '';
        markSpan.textContent = short;
        cell.appendChild(markSpan);
      }

      // Tooltip
      if (!isFuture) {
        cell.title = `${d} ${monthName(currentMonth)} — ${statusLabel(status)}`;
      } else {
        cell.title = `${d} ${monthName(currentMonth)} — ${tr('attUpcoming', 'upcoming')}`;
      }

      gridEl.appendChild(cell);
    }
  }

  // ===================================================
  // Month navigation
  // ===================================================
  function goToPrevMonth() {
    currentMonth -= 1;
    if (currentMonth < 0) {
      currentMonth = 11;
      currentYear -= 1;
    }
    renderAll();
  }

  function goToNextMonth() {
    currentMonth += 1;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear += 1;
    }
    renderAll();
  }

  function initNav() {
    const prev = document.getElementById('attPrevMonth');
    const next = document.getElementById('attNextMonth');
    if (prev) prev.addEventListener('click', goToPrevMonth);
    if (next) next.addEventListener('click', goToNextMonth);
  }

  // ===================================================
  // Drawer (reused pattern)
  // ===================================================
  function openDrawer(drawer, overlay, hamburger) {
    drawer.classList.add('open');
    overlay.classList.add('active');
    drawer.setAttribute('aria-hidden', 'false');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer(drawer, overlay, hamburger) {
    drawer.classList.remove('open');
    overlay.classList.remove('active');
    drawer.setAttribute('aria-hidden', 'true');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function handleDrawerAction(action) {
    switch (action) {
      case 'change-password':
        window.location.href = 'parent-portal-settings.html';
        break;
      case 'settings':
        window.location.href = 'parent-portal-settings.html';
        break;
      case 'demo-videos':     console.log('→ Demo Videos'); break;
      case 'submit-feedback':
        window.location.href = 'parent-portal-feedback.html';
        break;
      case 'logout':
        if (window.confirm(tr('logoutConfirm', 'Are you sure you want to logout?'))) {
          try { sessionStorage.clear(); } catch (e) {}
          console.log('→ Logged out');
        }
        break;
      default: console.warn('Unknown drawer action:', action);
    }
  }

  function initDrawer() {
    const hamburger = document.getElementById('hamburgerBtn');
    const drawer = document.getElementById('sidePanel');
    const overlay = document.getElementById('sidePanelOverlay');
    const closeBtn = document.getElementById('sidePanelClose');
    if (!drawer || !overlay) return;

    if (hamburger) hamburger.addEventListener('click', () => openDrawer(drawer, overlay, hamburger));
    if (closeBtn) closeBtn.addEventListener('click', () => closeDrawer(drawer, overlay, hamburger));
    overlay.addEventListener('click', () => closeDrawer(drawer, overlay, hamburger));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) {
        closeDrawer(drawer, overlay, hamburger);
      }
    });

    drawer.querySelectorAll('.drawer-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        handleDrawerAction(link.dataset.action);
        closeDrawer(drawer, overlay, hamburger);
      });
    });
  }

  // ===================================================
  // Master render
  // ===================================================
  function renderAll() {
    renderTodayCard();
    renderSummary();
    renderCalendar();
  }

  // ===================================================
  // Boot
  // ===================================================
  async function boot() {
    try { await loadData(); } catch (err) { PortalAPI.showError(err); }
    initNav();
    initDrawer();
    renderAll();
    console.log('Attendance page ready.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();