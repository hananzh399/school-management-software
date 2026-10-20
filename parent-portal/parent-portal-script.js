// Parent Portal – Home (index) page script
(function () {
  'use strict';

  // ---------- Language ----------
  const I18n = window.PortalI18n;
  if (I18n) I18n.apply();
  const tr = (key, fallback) => (I18n ? I18n.t(key) : fallback);

  // ---------- Time-of-day greeting ----------
  const hiEl = document.getElementById('greetingHi');
  if (hiEl) {
    const hour = new Date().getHours();
    const greeting =
      hour < 12 ? tr('goodMorning', 'Good morning,')
      : hour < 17 ? tr('goodAfternoon', 'Good afternoon,')
      : tr('goodEvening', 'Good evening,');
    // wrap Urdu so its punctuation sits on the correct side
    hiEl.textContent = I18n && I18n.iso ? I18n.iso(greeting) : greeting;
  }

  // ---------- Bell → Notifications page ----------
  const bellBtn = document.getElementById('notificationBtn');
  if (bellBtn) {
    bellBtn.addEventListener('click', () => {
      window.location.href = 'parent-portal-notifications.html';
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

  function boot() {
    initDrawer();
    console.log('Parent portal ready.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();