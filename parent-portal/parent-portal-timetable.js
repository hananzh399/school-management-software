// Parent Portal – Timetable page script
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

  // ---------- Language ----------
  const I18n = window.PortalI18n;
  if (I18n) I18n.apply();
  const tr = (key, fallback) => (I18n ? I18n.t(key) : fallback);
  const onScreen = (text) => (I18n ? I18n.iso(text) : text);

  // ---------- Restore student info in the info strip ----------
  function populateInfo() {
    const defaults = { className: '5', section: 'B', classSection: '5 – B' };
    let data = defaults;
    try {
      const saved = sessionStorage.getItem('studentData');
      if (saved) data = Object.assign({}, defaults, JSON.parse(saved));
    } catch (e) { /* ignore */ }

    if (!data.classSection) {
      data.classSection = `${data.className || ''} – ${data.section || ''}`;
    }

    // Update the class name in the info strip (first .timetable-info-item span)
    const infoItems = document.querySelectorAll('.timetable-info-item span');
    if (infoItems[0]) {
      infoItems[0].textContent = onScreen(`${tr('classWord', 'Class')} ${data.classSection}`);
    }
  }

  // ---------- Highlight today's row ----------
  function highlightToday() {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = dayNames[new Date().getDay()];

    document.querySelectorAll('.tt-row').forEach((row) => {
      const dayLabel = row.querySelector('.tt-day-name');
      if (!dayLabel) return;
      // Compare the hidden English day name so this works in any language
      const rowDay = dayLabel.dataset.day || dayLabel.textContent.trim();
      if (rowDay === today) {
        row.classList.add('tt-row-today');
        // Gently flash the row on load
        row.animate(
          [
            { boxShadow: 'inset 0 0 0 2px rgba(46,139,122,0)' },
            { boxShadow: 'inset 0 0 0 2px rgba(46,139,122,0.6)' },
            { boxShadow: 'inset 0 0 0 2px rgba(46,139,122,0)' }
          ],
          { duration: 1200, easing: 'ease-out', iterations: 1 }
        );
      }
    });
  }

  // ---------- Drawer ----------
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
        window.location.href = 'parent-portal-change-password.html';
        break;
      case 'settings':
        window.location.href = 'parent-portal-settings.html';
        break;
      case 'info':            console.log('→ Info'); break;
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

  // ---------- Boot ----------
  function boot() {
    populateInfo();
    initDrawer();
    highlightToday();
    console.log('Timetable page ready.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();