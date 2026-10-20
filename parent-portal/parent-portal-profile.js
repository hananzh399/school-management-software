// Parent Portal – Profile page script
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

  // ---------- Full student data ----------
  const defaults = { name: '', fullName: '', className: '', section: '', classSection: '', regNumber: '', rollNumber: '—', guardianName: '—', primaryPhone: '—', secondaryPhone: '—', permanentAddress: '—', photo: null };

  let data = defaults;

  try {
    const saved = sessionStorage.getItem('studentData');
    if (saved) data = Object.assign({}, defaults, JSON.parse(saved));
  } catch (e) { /* ignore */ }

  // Fallbacks for fields that might not be saved
  if (!data.fullName) data.fullName = data.name || defaults.fullName;
  if (!data.classSection && data.className) {
    data.classSection = data.className;
  }
  if (!data.rollNumber) data.rollNumber = defaults.rollNumber;
  if (!data.guardianName) data.guardianName = defaults.guardianName;
  if (!data.primaryPhone) data.primaryPhone = defaults.primaryPhone;
  if (!data.secondaryPhone) data.secondaryPhone = defaults.secondaryPhone;
  if (!data.permanentAddress) data.permanentAddress = defaults.permanentAddress;

  // ---------- Populate the page ----------
  function populate() {
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el && value != null) el.textContent = value;
    };

    setText('profileName', data.fullName);
    setText('profileClassTag', onScreen(
      `${tr('classWord', 'Class')} ${data.className || ''}` +
      (data.section ? ` · ${tr('sectionWord', 'Section')} ${data.section}` : '')
    ).trim());

    setText('profileRollHero', data.rollNumber);
    setText('profileRegHero', data.regNumber);

    setText('profileFullName', data.fullName);
    setText('profileClassSection', data.classSection);
    setText('profileReg', data.regNumber);
    setText('profileRoll', data.rollNumber);

    setText('guardianName', data.guardianName);

    // Phone links
    const primaryEl = document.getElementById('primaryPhone');
    if (primaryEl) {
      primaryEl.textContent = data.primaryPhone;
      primaryEl.href = 'tel:' + String(data.primaryPhone).replace(/\s+/g, '');
    }

    const secondaryEl = document.getElementById('secondaryPhone');
    if (secondaryEl) {
      secondaryEl.textContent = data.secondaryPhone;
      secondaryEl.href = 'tel:' + String(data.secondaryPhone).replace(/\s+/g, '');
    }

    // Address (multi-line)
    const addrEl = document.getElementById('permanentAddress');
    if (addrEl) {
      const lines = String(data.permanentAddress).split('\n');
      addrEl.innerHTML = lines.map((line) => escapeHtml(line)).join('<br>');
    }

    // Photo
    const photoEl = document.getElementById('profilePhoto');
    if (photoEl && data.photo) {
      photoEl.src = data.photo;
    }
    if (photoEl) {
      photoEl.alt = tr('photoAlt', "{name}'s photo").replace('{name}', data.fullName);
    }
  }

  // Basic HTML escape for safety when injecting multi-line addresses
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  // ---------- Boot ----------
  function boot() {
    populate();
    initDrawer();
    console.log('Profile loaded for:', data.fullName);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();