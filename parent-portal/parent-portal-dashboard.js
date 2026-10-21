// Parent Portal – Dashboard page script
(function () {
  'use strict';

    // ---------- Redirect to index on page refresh ----------
  (function redirectOnRefresh() {
    // performance.navigation.type === 1 means "reload"
    // legacy fallback also supported
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

  // ---------- Student data ----------
  const defaults = { name: '', className: '', regNumber: '', photo: null };

  let studentData = defaults;

  try {
    const saved = sessionStorage.getItem('studentData');
    if (saved) studentData = Object.assign({}, defaults, JSON.parse(saved));
  } catch (e) { /* ignore */ }

  // Populate the dashboard student card
  function populateStudentCard() {
    const nameEl = document.getElementById('dashStudentName');
    const classEl = document.getElementById('dashStudentClass');
    const regEl = document.getElementById('dashStudentReg');
    const photoEl = document.getElementById('dashStudentPhoto');

    if (nameEl) nameEl.textContent = studentData.name;
    // show class and section together (e.g. "5 – B")
    if (classEl) classEl.textContent = studentData.classSection || studentData.className;
    if (regEl) regEl.textContent = studentData.regNumber;

    if (photoEl && studentData.photo) {
      photoEl.src = studentData.photo;
    }
    if (photoEl) {
      photoEl.alt = tr('photoAlt', "{name}'s photo").replace('{name}', studentData.name);
    }
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

    if (hamburger) {
      hamburger.addEventListener('click', () =>
        openDrawer(drawer, overlay, hamburger)
      );
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () =>
        closeDrawer(drawer, overlay, hamburger)
      );
    }
    overlay.addEventListener('click', () =>
      closeDrawer(drawer, overlay, hamburger)
    );

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

  // ---------- Feature cards ----------
   function initFeatureCards() {
    document.querySelectorAll('.feature-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const href = card.getAttribute('href');
        // Real links (not "#") navigate normally
        if (href && href !== '#') return;

        e.preventDefault();
        console.log('→ Feature:', card.dataset.feature);
        // window.location.href = `parent-portal-${card.dataset.feature}.html`;
      });
    });
  }

  // ---------- Profile links: open THIS student's profile directly ----------
  // When a sibling is already open in the dashboard, the profile page must not
  // ask "which child?" again. We mark the student as the active one and pass
  // the registration number along so the profile page can skip its picker.
  function markActiveStudent() {
    try {
      sessionStorage.setItem('activeStudentReg', studentData.regNumber || '');
      sessionStorage.setItem('skipStudentPicker', '1');
      sessionStorage.setItem('studentData', JSON.stringify(studentData));
    } catch (e) { /* ignore */ }
  }

  function initProfileLinks() {
    const links = document.querySelectorAll(
      '.feature-card[data-feature="profile"], .bottom-tabs a[href="parent-portal-profile.html"]'
    );
    links.forEach((link) => {
      // Put the student in the URL too (works even if storage is cleared)
      if (studentData.regNumber) {
        const url = new URL(link.getAttribute('href'), window.location.href);
        url.searchParams.set('reg', studentData.regNumber);
        link.setAttribute('href', url.pathname.split('/').pop() + url.search);
      }
      link.addEventListener('click', markActiveStudent);
    });
  }

  // ---------- Boot ----------
  function boot() {
    populateStudentCard();
    initDrawer();
    initFeatureCards();
    initProfileLinks();
    console.log('Dashboard ready for:', studentData.name);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();