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

  function createTestSubject(subject, template) {
    if (template) {
      const item = template.cloneNode(true);
      item.classList.remove('open', 'search-open');
      item.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
      item.querySelectorAll('[aria-controls]').forEach((node) => node.removeAttribute('aria-controls'));
      return item;
    }
    const item = document.createElement('section');
    item.className = 'tests-subject';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tests-subject-btn';
    button.setAttribute('aria-expanded', 'false');
    const name = document.createElement('span');
    name.className = 'tests-subject-name';
    const count = document.createElement('span');
    count.className = 'tests-count';
    button.append(name, count);
    const panel = document.createElement('div');
    panel.className = 'tests-subject-panel';
    const empty = document.createElement('div');
    empty.className = 'tests-empty';
    empty.textContent = tr('noTests', 'No tests available.');
    panel.appendChild(empty);
    item.append(button, panel);
    return item;
  }

  function createTestCard(row) {
    const card = document.createElement('article');
    card.className = 'test-card';
    card.dataset.testType = String(row.kind || 'test').toLowerCase();
    card.dataset.testDate = row.date || '';
    card.dataset.testId = row.id == null ? '' : String(row.id);

    const title = document.createElement('strong');
    title.className = 'test-card-title';
    title.textContent = row.title || tr('untitledTest', 'Untitled test');
    const meta = document.createElement('div');
    meta.className = 'test-card-meta';
    const subject = document.createElement('span');
    subject.className = 'test-card-subject';
    subject.textContent = row.subject || '';
    const date = document.createElement('time');
    date.className = 'test-card-date';
    date.dataset.dateLabel = '';
    date.textContent = I18n && I18n.formatDate(row.date) ? I18n.formatDate(row.date) : (row.date || '');
    const kind = document.createElement('span');
    kind.className = 'test-card-kind';
    kind.textContent = row.kind === 'quiz' ? tr('quiz', 'Quiz') : tr('test', 'Test');
    meta.append(subject, date, kind);
    const result = document.createElement('div');
    result.className = 'test-card-result';
    if (row.score === null || row.score === undefined) {
      result.textContent = tr('resultPending', 'Marks pending');
    } else {
      const total = row.totalMarks == null ? '' : ' / ' + row.totalMarks;
      const percent = row.percentage == null ? '' : ' (' + row.percentage + '%)';
      result.textContent = tr('scoreLabel', 'Score') + ': ' + row.score + total + percent;
    }
    card.append(title, meta, result);
    return card;
  }

  function renderTestData(rows) {
    const accordion = document.getElementById('testsAccordion');
    if (!accordion) return;
    const originals = Array.from(accordion.querySelectorAll('.tests-subject'));
    const subjectTemplate = originals[0] || null;
    const originalBySubject = new Map();
    originals.forEach((item) => {
      const name = item.querySelector('.tests-subject-name');
      if (name) originalBySubject.set(plain(name.textContent).trim().toLowerCase(), item);
    });

    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const subject = String(row.subject || tr('otherSubject', 'Other')).trim();
      if (!groups.has(subject)) groups.set(subject, []);
      groups.get(subject).push(row);
    });
    const subjects = groups.size ? Array.from(groups.keys()) : Array.from(originalBySubject.keys()).map((key) => {
      const item = originalBySubject.get(key);
      const name = item && item.querySelector('.tests-subject-name');
      return name ? plain(name.textContent).trim() : key;
    });

    const rendered = [];
    subjects.forEach((subject) => {
      const group = groups.get(subject) || [];
      const item = originalBySubject.get(subject.toLowerCase()) || createTestSubject(subject, subjectTemplate);
      item.classList.remove('open', 'search-open');
      const name = item.querySelector('.tests-subject-name');
      if (name) name.textContent = subject;
      const button = item.querySelector('.tests-subject-btn');
      if (button) button.setAttribute('aria-expanded', 'false');

      const existingCard = item.querySelector('.test-card');
      const host = existingCard ? existingCard.parentElement : item.querySelector('.tests-subject-panel');
      item.querySelectorAll('.test-card').forEach((card) => card.remove());
      if (host) group.forEach((row) => host.appendChild(createTestCard(row)));
      let empty = item.querySelector('.tests-empty');
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'tests-empty';
        empty.textContent = tr('noTests', 'No tests available.');
        (host || item).appendChild(empty);
      }
      empty.hidden = group.length > 0;
      const count = item.querySelector('.tests-count');
      if (count) count.textContent = String(group.length);
      rendered.push(item);
    });
    accordion.replaceChildren.apply(accordion, rendered);
    let emptyState = document.getElementById('testsDataEmpty');
    if (!emptyState) {
      emptyState = document.createElement('p');
      emptyState.id = 'testsDataEmpty';
      emptyState.className = 'tests-data-empty';
      emptyState.setAttribute('role', 'status');
      accordion.insertAdjacentElement('afterend', emptyState);
    }
    populateTestFilters(Array.isArray(rows) ? rows : []);
  }

  function populateTestFilters(rows) {
    const typeSelect = document.getElementById('testTypeFilter');
    const monthSelect = document.getElementById('testMonthSort');
    const kinds = Array.from(new Set(rows.map((row) => String(row.kind || 'test').toLowerCase())))
      .filter((kind) => kind === 'quiz' || kind === 'test');
    const months = Array.from(new Set(rows.map((row) => String(row.date || '').slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month)))).sort().reverse();

    if (typeSelect) {
      const options = [new Option(tr('allTests', 'All'), 'all')].concat(kinds.map((kind) =>
        new Option(kind === 'quiz' ? tr('quiz', 'Quiz') : tr('test', 'Test'), kind)));
      typeSelect.replaceChildren.apply(typeSelect, options);
      typeSelect.value = 'all';
    }
    if (monthSelect) {
      const options = [new Option(tr('allMonths', 'All months'), 'all')].concat(months.map((month) => {
        const [year, number] = month.split('-');
        const label = I18n && I18n.formatMonth(month) ? I18n.formatMonth(month) : new Date(Number(year), Number(number) - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' });
        return new Option(label, month);
      }));
      monthSelect.replaceChildren.apply(monthSelect, options);
      monthSelect.value = 'all';
    }
  }

  function initializePage(err) {
    localizePage();
    initGlobalFilters();
    initAccordion();
    initDrawer();
    applyFilters();
    if (err && window.PortalAPI) window.PortalAPI.showError(err);
    console.log('Tests page connected to the parent portal backend.');
  }

  // ===================================================
  // Global filter helpers
  // ===================================================
  function currentType() {
    const el = document.getElementById('testTypeFilter');
    return el ? el.value : 'all';
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
    const months = document.getElementById('testMonthSort');
    row.hidden = !months || months.options.length < 2;
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
    let totalVisible = 0;

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

        const matchesGlobalType = type === 'all' || cardType === type;
        const matchesGlobalDate = !globalDate || cardDate === globalDate;
        const matchesMonth = month === 'all' || cardDate.startsWith(month);
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
      totalVisible += visibleCount;

      // Hide subject entirely if no matches
      subject.style.display = visibleCount === 0 ? 'none' : '';

      // Subject search status
      updateSubjectSearchStatus(subject, visibleCount);
    });

    const dataEmpty = document.getElementById('testsDataEmpty');
    if (dataEmpty) {
      const hasAnyTests = document.querySelectorAll('.test-card').length > 0;
      dataEmpty.textContent = hasAnyTests
        ? tr('noTestsMatchFilters', 'No tests match the current filters.')
        : tr('noTestsPublished', 'No tests have been published for this child.');
      dataEmpty.hidden = totalVisible > 0;
    }
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
  // Boot
  // ===================================================
  function boot() {
    const api = window.PortalAPI;
    if (!api) {
      renderTestData([]);
      initializePage(new Error('Load parent-portal-api.js before parent-portal-tests.js.'));
      return;
    }
    api.ensureChildren()
      .then(() => api.tests())
      .then((rows) => {
        renderTestData(rows);
        initializePage();
      })
      .catch((err) => {
        renderTestData([]);
        initializePage(err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();