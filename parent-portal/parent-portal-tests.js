// Parent Portal – Tests page script
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
  const plain = (text) => text.replace(/[\u2066-\u2069]/g, '');

  // Dates, month names and per-subject aria labels follow the chosen language.
  // (Test titles are entered by teachers and are shown as-is.)
  function localizePage() {
    if (!I18n) return;

    document.querySelectorAll('.test-card').forEach((card) => {
      const label = card.querySelector('[data-date-label]');
      const text = I18n.formatDate(card.dataset.testDate);
      if (label && text) label.textContent = text;
    });

    document.querySelectorAll('#testMonthSort option[data-month]').forEach((opt) => {
      const text = I18n.formatMonth(opt.dataset.month);
      if (text) opt.textContent = text;
    });

    document.querySelectorAll('.tests-subject').forEach((subject) => {
      const nameEl = subject.querySelector('.tests-subject-name');
      if (!nameEl) return;
      const name = plain(nameEl.textContent);
      const panel = subject.querySelector('.tests-subject-panel');
      const input = subject.querySelector('.subject-search-date');
      if (panel) panel.setAttribute('aria-label', tr('subjectTestsAria', '{subject} tests').replace('{subject}', name));
      if (input) input.setAttribute('aria-label', tr('searchSubjectAria', 'Search {subject} tests by date').replace('{subject}', name));
    });
  }

  // ===================================================
  // Global filter helpers
  // ===================================================
  function currentType() {
    const el = document.getElementById('testTypeFilter');
    return el ? el.value : 'daily';
  }

  function currentDate() {
    const el = document.getElementById('testDateSearch');
    return el ? (el.value || '').trim() : '';
  }

  function currentMonth() {
    const el = document.getElementById('testMonthSort');
    return el ? el.value : 'all';
  }

  function updateMonthSortVisibility() {
    const row = document.getElementById('testMonthSortRow');
    if (!row) return;
    row.hidden = currentType() !== 'monthly';
  }

  function updateGlobalDateClear() {
    const clearBtn = document.getElementById('testDateClear');
    if (!clearBtn) return;
    clearBtn.hidden = !currentDate();
  }

  // ===================================================
  // Resize open panels
  // ===================================================
  function resizeOpenPanels() {
    document.querySelectorAll('.tests-subject.open').forEach((subject) => {
      const panel = subject.querySelector('.tests-subject-panel');
      if (panel) {
        panel.style.maxHeight = 'none';
        panel.style.maxHeight = panel.scrollHeight + 'px';
      }
    });
  }

  // ===================================================
  // Apply filters (global + per-subject)
  // ===================================================
  function applyFilters() {
    const type = currentType();
    const globalDate = currentDate();
    const month = currentMonth();

    const subjects = document.querySelectorAll('.tests-subject');

    subjects.forEach((subject) => {
      const searchOpen = subject.classList.contains('search-open');
      const subjectDateInput = subject.querySelector('.subject-search-date');
      const subjectDate = searchOpen ? (subjectDateInput?.value || '').trim() : '';

      const cards = subject.querySelectorAll('.test-card');
      let visibleCount = 0;

      cards.forEach((card) => {
        const cardType = card.dataset.testType || '';
        const cardDate = card.dataset.testDate || '';

        const matchesGlobalType = cardType === type;
        const matchesGlobalDate = !globalDate || cardDate === globalDate;
        const matchesMonth = (type !== 'monthly' || month === 'all' || cardDate.startsWith(month));
        const matchesSubjectDate = !subjectDate || cardDate === subjectDate;

        const visible =
          matchesGlobalType &&
          matchesGlobalDate &&
          matchesMonth &&
          matchesSubjectDate;

        card.hidden = !visible;
        if (visible) visibleCount++;
      });

      // Update count pill
      const countEl = subject.querySelector('.tests-count');
      if (countEl) countEl.textContent = String(visibleCount);

      // Empty state
      const emptyEl = subject.querySelector('.tests-empty');
      if (emptyEl) emptyEl.hidden = visibleCount !== 0;

      // Hide subject entirely if no matches
      subject.style.display = visibleCount === 0 ? 'none' : '';

      // Subject search status
      updateSubjectSearchStatus(subject, visibleCount);
    });

    resizeOpenPanels();
  }

  // ===================================================
  // Per-subject search status
  // ===================================================
  function updateSubjectSearchStatus(subject, visibleCount) {
    const statusEl = subject.querySelector('.subject-search-status');
    const clearBtn = subject.querySelector('.subject-search-clear');
    const dateInput = subject.querySelector('.subject-search-date');
    if (!statusEl) return;

    const searchOpen = subject.classList.contains('search-open');
    const hasQuery = searchOpen && (dateInput?.value || '').trim();

    if (clearBtn) clearBtn.hidden = !(dateInput?.value);

    statusEl.classList.remove('has-match', 'no-match');

    if (!hasQuery) {
      statusEl.textContent = '';
      return;
    }

    if (visibleCount === 0) {
      statusEl.textContent = onScreen(tr('noTestsDate', 'No tests on this date'));
      statusEl.classList.add('no-match');
    } else {
      statusEl.textContent = onScreen(
        tr(visibleCount === 1 ? 'testsOnDateOne' : 'testsOnDateMany',
           visibleCount === 1 ? '{n} test on this date' : '{n} tests on this date')
          .replace('{n}', String(visibleCount))
      );
      statusEl.classList.add('has-match');
    }
  }

  // ===================================================
  // Global filters wiring
  // ===================================================
  function initGlobalFilters() {
    const typeSelect = document.getElementById('testTypeFilter');
    const dateInput = document.getElementById('testDateSearch');
    const dateClear = document.getElementById('testDateClear');
    const monthSelect = document.getElementById('testMonthSort');

    if (typeSelect) {
      typeSelect.addEventListener('change', () => {
        updateMonthSortVisibility();
        applyFilters();
      });
    }
    if (dateInput) {
      dateInput.addEventListener('input', () => {
        updateGlobalDateClear();
        applyFilters();
      });
    }
    if (dateClear) {
      dateClear.addEventListener('click', () => {
        if (dateInput) dateInput.value = '';
        updateGlobalDateClear();
        applyFilters();
      });
    }
    if (monthSelect) {
      monthSelect.addEventListener('change', applyFilters);
    }

    updateMonthSortVisibility();
    updateGlobalDateClear();
  }

  // ===================================================
  // Accordion + per-subject search
  // ===================================================
  function initAccordion() {
    const accordion = document.getElementById('testsAccordion');
    if (!accordion) return;

    const items = accordion.querySelectorAll('.tests-subject');

    items.forEach((item) => {
      const btn = item.querySelector('.tests-subject-btn');
      const panel = item.querySelector('.tests-subject-panel');
      const searchToggle = item.querySelector('.subject-search-toggle');
      const searchBlock = item.querySelector('[data-search-block]');
      const dateInput = item.querySelector('.subject-search-date');
      const dateClear = item.querySelector('.subject-search-clear');
      if (!btn || !panel) return;

      // ----- Toggle whole subject -----
      btn.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');

        items.forEach((other) => {
          if (other === item) return;
          other.classList.remove('open');
          other.classList.remove('search-open');
          const otherBtn = other.querySelector('.tests-subject-btn');
          const otherPanel = other.querySelector('.tests-subject-panel');
          const otherToggle = other.querySelector('.subject-search-toggle');
          const otherBlock = other.querySelector('[data-search-block]');
          if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
          if (otherPanel) otherPanel.style.maxHeight = null;
          if (otherToggle) otherToggle.setAttribute('aria-expanded', 'false');
          if (otherBlock) otherBlock.hidden = true;
          // Reset other subject's date too
          const otherDate = other.querySelector('.subject-search-date');
          if (otherDate) otherDate.value = '';
        });

        if (isOpen) {
          item.classList.remove('open');
          item.classList.remove('search-open');
          btn.setAttribute('aria-expanded', 'false');
          panel.style.maxHeight = null;
          if (searchToggle) searchToggle.setAttribute('aria-expanded', 'false');
          if (searchBlock) searchBlock.hidden = true;
          if (dateInput) dateInput.value = '';
        } else {
          item.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
          panel.style.maxHeight = 'none';
          panel.style.maxHeight = panel.scrollHeight + 'px';
        }

        applyFilters();
      });

      // ----- Search toggle -----
      if (searchToggle) {
        searchToggle.addEventListener('click', (e) => {
          e.stopPropagation();

          // Ensure the subject is expanded
          if (!item.classList.contains('open')) {
            items.forEach((other) => {
              if (other === item) return;
              other.classList.remove('open');
              other.classList.remove('search-open');
              const otherBtn = other.querySelector('.tests-subject-btn');
              const otherPanel = other.querySelector('.tests-subject-panel');
              const otherToggle = other.querySelector('.subject-search-toggle');
              const otherBlock = other.querySelector('[data-search-block]');
              if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
              if (otherPanel) otherPanel.style.maxHeight = null;
              if (otherToggle) otherToggle.setAttribute('aria-expanded', 'false');
              if (otherBlock) otherBlock.hidden = true;
              const otherDate = other.querySelector('.subject-search-date');
              if (otherDate) otherDate.value = '';
            });

            item.classList.add('open');
            btn.setAttribute('aria-expanded', 'true');
          }

          const isSearchOpen = item.classList.toggle('search-open');
          searchToggle.setAttribute('aria-expanded', String(isSearchOpen));
          if (searchBlock) searchBlock.hidden = !isSearchOpen;

          // If closing the search, clear its filter
          if (!isSearchOpen && dateInput) {
            dateInput.value = '';
          }

          // Recalculate panel height
          panel.style.maxHeight = 'none';
          panel.style.maxHeight = panel.scrollHeight + 'px';

          // Focus the date input
          if (isSearchOpen && dateInput) {
            setTimeout(() => dateInput.focus({ preventScroll: true }), 120);
          }

          applyFilters();
        });
      }

      // ----- Date input -----
      if (dateInput) {
        dateInput.addEventListener('input', () => {
          applyFilters();
        });
      }

      // ----- Clear button -----
      if (dateClear) {
        dateClear.addEventListener('click', (e) => {
          e.stopPropagation();
          if (dateInput) dateInput.value = '';
          applyFilters();
          if (dateInput) dateInput.focus({ preventScroll: true });
        });
      }
    });

    window.addEventListener('resize', resizeOpenPanels);
  }

  // ===================================================
  // Drawer
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

  // ===================================================
  // Boot
  // ===================================================
  function boot() {
    localizePage();
    initGlobalFilters();
    initAccordion();
    initDrawer();
    applyFilters(); // initial pass
    console.log('Tests page ready.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();