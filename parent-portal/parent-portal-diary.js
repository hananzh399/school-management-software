// Parent Portal – Daily Diary page script
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

  // Date labels + per-subject aria labels follow the chosen language.
  // (The diary text itself is written by teachers and is shown as-is.)
  function localizeEntries() {
    document.querySelectorAll('.diary-entry').forEach((entry) => {
      const label = entry.querySelector('[data-date-label]');
      if (!label || !I18n) return;
      const text = I18n.formatDate(entry.dataset.date);
      if (text) label.textContent = text;
    });

    document.querySelectorAll('.subject-item').forEach((item) => {
      const name = item.querySelector('.subject-name');
      const panel = item.querySelector('.subject-panel');
      if (!name || !panel) return;
      const subject = name.textContent.replace(/[\u2066-\u2069]/g, '');
      panel.setAttribute('aria-label', tr('subjectPanelAria', '{subject} diary').replace('{subject}', subject));
    });
  }

  function createSubjectItem(subject, template) {
    if (template) {
      const item = template.cloneNode(true);
      item.classList.remove('open', 'search-open');
      item.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
      item.querySelectorAll('[aria-controls]').forEach((node) => node.removeAttribute('aria-controls'));
      return item;
    }
    const item = document.createElement('section');
    item.className = 'subject-item';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'subject-btn';
    button.setAttribute('aria-expanded', 'false');
    const name = document.createElement('span');
    name.className = 'subject-name';
    const count = document.createElement('span');
    count.className = 'subject-count';
    button.append(name, count);
    const panel = document.createElement('div');
    panel.className = 'subject-panel';
    const list = document.createElement('div');
    list.className = 'diary-entries';
    const empty = document.createElement('div');
    empty.className = 'diary-empty';
    empty.textContent = tr('diaryEmpty', 'No diary entries for this period.');
    panel.append(list, empty);
    item.append(button, panel);
    return item;
  }

  function createDiaryEntry(row, api) {
    const entry = document.createElement('article');
    entry.className = 'diary-entry';
    entry.dataset.date = row.date || '';
    entry.dataset.periodHidden = '0';

    const date = document.createElement('time');
    date.className = 'diary-date';
    date.textContent = I18n && I18n.formatDate(row.date) ? I18n.formatDate(row.date) : (row.date || '');
    date.dataset.dateLabel = '';
    entry.appendChild(date);

    const chip = document.createElement('span');
    chip.className = 'diary-chip';
    chip.textContent = row.subject || tr('diary', 'Diary');
    entry.appendChild(chip);

    const note = document.createElement('p');
    note.className = 'diary-text';
    note.textContent = row.note || '';
    entry.appendChild(note);
    if (row.teacher) {
      const teacher = document.createElement('span');
      teacher.className = 'diary-teacher';
      teacher.textContent = row.teacher;
      entry.appendChild(teacher);
    }
    (Array.isArray(row.imageUrls) ? row.imageUrls : []).forEach((path, index) => {
      const image = document.createElement('img');
      image.className = 'diary-image';
      image.alt = (row.subject || tr('diary', 'Diary')) + ' ' + (index + 1);
      image.loading = 'lazy';
      entry.appendChild(image);
      api.blobUrl(path).then((url) => {
        image.src = url;
      }).catch(() => {
        image.remove();
      });
    });
    return entry;
  }

  function renderDiaryData(rows, api) {
    const accordion = document.getElementById('subjectAccordion');
    if (!accordion) return;
    const originals = Array.from(accordion.querySelectorAll('.subject-item'));
    const subjectTemplate = originals[0] || null;
    const originalBySubject = new Map();
    originals.forEach((item) => {
      const name = item.querySelector('.subject-name');
      if (name) originalBySubject.set(name.textContent.replace(/[\u2066-\u2069]/g, '').trim().toLowerCase(), item);
    });

    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const subject = String(row.subject || tr('diary', 'Diary')).trim();
      if (!groups.has(subject)) groups.set(subject, []);
      groups.get(subject).push(row);
    });

    const subjects = groups.size ? Array.from(groups.keys()) : Array.from(originalBySubject.keys()).map((key) => {
      const item = originalBySubject.get(key);
      return item && item.querySelector('.subject-name')
        ? item.querySelector('.subject-name').textContent.replace(/[\u2066-\u2069]/g, '').trim()
        : key;
    });
    const rendered = [];
    subjects.forEach((subject) => {
      const rowsForSubject = groups.get(subject) || [];
      const item = originalBySubject.get(subject.toLowerCase()) || createSubjectItem(subject, subjectTemplate);
      item.classList.remove('open', 'search-open');
      const name = item.querySelector('.subject-name');
      if (name) name.textContent = subject;
      const button = item.querySelector('.subject-btn');
      if (button) button.setAttribute('aria-expanded', 'false');

      const existingEntry = item.querySelector('.diary-entry');
      const host = existingEntry ? existingEntry.parentElement : item.querySelector('.subject-panel');
      item.querySelectorAll('.diary-entry').forEach((entry) => entry.remove());
      if (host) rowsForSubject.forEach((row) => host.appendChild(createDiaryEntry(row, api)));

      let empty = item.querySelector('.diary-empty');
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'diary-empty';
        empty.textContent = tr('diaryEmpty', 'No diary entries for this period.');
        (host || item).appendChild(empty);
      }
      empty.hidden = rowsForSubject.length > 0;
      const count = item.querySelector('.subject-count');
      if (count) count.textContent = String(rowsForSubject.length);
      rendered.push(item);
    });

    accordion.replaceChildren.apply(accordion, rendered);
  }

  function initializePage(err) {
    localizeEntries();
    initAccordion();
    initPeriodFilter();
    initDrawer();
    if (err && window.PortalAPI) window.PortalAPI.showError(err);
    console.log('Daily Diary connected to the parent portal backend.');
  }

  // Chip text used by search: what is shown on screen PLUS the English name,
  // so searching "homework" still works when the page is in Urdu.
  function chipSearchText(entry) {
    const chip = entry.querySelector('.diary-chip');
    if (!chip) return '';
    const shown = (chip.textContent || '').toLowerCase();
    const english = I18n && chip.dataset.i18n ? I18n.tEn(chip.dataset.i18n).toLowerCase() : '';
    return shown + ' ' + english;
  }

  // ===================================================
  // Utilities
  // ===================================================
  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function daysAgoISO(n) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ===================================================
  // Period filter
  // ===================================================
  function applyPeriodFilter(period) {
    const today = todayISO();
    let fromISO = today;
    if (period === 'week')  fromISO = daysAgoISO(7);
    if (period === 'month') fromISO = daysAgoISO(30);

    const items = document.querySelectorAll('.subject-item');

    items.forEach((item) => {
      const entries = item.querySelectorAll('.diary-entry');
      let visibleCount = 0;

      entries.forEach((entry) => {
        const entryDate = entry.dataset.date || '';
        const visible = entryDate >= fromISO && entryDate <= today;
        entry.dataset.periodHidden = visible ? '0' : '1';
        if (visible) visibleCount++;
      });

      const countEl = item.querySelector('.subject-count');
      if (countEl) countEl.textContent = String(visibleCount);

      refreshEntryVisibility(item);
    });

    // Resize any open panel
    document.querySelectorAll('.subject-item.open').forEach((item) => {
      const panel = item.querySelector('.subject-panel');
      if (panel) {
        panel.style.maxHeight = 'none';
        panel.style.maxHeight = panel.scrollHeight + 'px';
      }
    });
  }

  // ===================================================
  // Visibility logic
  // ===================================================
  function refreshEntryVisibility(item) {
    const entries = item.querySelectorAll('.diary-entry');
    const dateInput = item.querySelector('.diary-search-date');
    const textInput = item.querySelector('.diary-search-text');

    // Only apply search filters if the search block is visible
    const searchOpen = item.classList.contains('search-open');
    const dateQuery = searchOpen ? (dateInput?.value || '').trim() : '';
    const textQuery = searchOpen ? (textInput?.value || '').trim().toLowerCase() : '';

    let visibleCount = 0;

    entries.forEach((entry) => {
      const hiddenByPeriod = entry.dataset.periodHidden === '1';
      const entryDate = entry.dataset.date || '';
      const entryText = (entry.querySelector('.diary-text')?.textContent || '').toLowerCase();
      const entryChip = chipSearchText(entry);
      const entryDateLabel = (entry.querySelector('.diary-date')?.textContent || '').toLowerCase();
      const haystack = entryText + ' ' + entryChip + ' ' + entryDateLabel;

      const matchesDate = !dateQuery || entryDate === dateQuery;
      const matchesText = !textQuery || haystack.includes(textQuery);

      const visible = !hiddenByPeriod && matchesDate && matchesText;
      entry.hidden = !visible;
      if (visible) visibleCount++;
    });

    const emptyEl = item.querySelector('.diary-empty');
    if (emptyEl) emptyEl.hidden = visibleCount !== 0;

    const countEl = item.querySelector('.subject-count');
    if (countEl) countEl.textContent = String(visibleCount);

    item.__matchIndex = -1;
    item.__matches = [];
    updateSearchStatus(item);

    if (item.classList.contains('open')) {
      const panel = item.querySelector('.subject-panel');
      if (panel) {
        panel.style.maxHeight = 'none';
        panel.style.maxHeight = panel.scrollHeight + 'px';
      }
    }
  }

  // ===================================================
  // Search status
  // ===================================================
  function collectMatches(item) {
    const dateInput = item.querySelector('.diary-search-date');
    const textInput = item.querySelector('.diary-search-text');
    const dateQuery = (dateInput?.value || '').trim();
    const textQuery = (textInput?.value || '').trim().toLowerCase();

    const entries = Array.from(item.querySelectorAll('.diary-entry'))
      .filter((el) => !el.hidden);

    return entries.filter((entry) => {
      const entryDate = entry.dataset.date || '';
      const entryText = (entry.querySelector('.diary-text')?.textContent || '').toLowerCase();
      const entryChip = chipSearchText(entry);
      const entryDateLabel = (entry.querySelector('.diary-date')?.textContent || '').toLowerCase();
      const haystack = entryText + ' ' + entryChip + ' ' + entryDateLabel;

      const matchesDate = !dateQuery || entryDate === dateQuery;
      const matchesText = !textQuery || haystack.includes(textQuery);
      return matchesDate && matchesText;
    });
  }

  function updateSearchStatus(item) {
    const statusEl = item.querySelector('.diary-search-status');
    const upBtn = item.querySelector('.diary-nav-up');
    const downBtn = item.querySelector('.diary-nav-down');
    if (!statusEl) return;

    const searchOpen = item.classList.contains('search-open');
    if (!searchOpen) {
      statusEl.textContent = '';
      statusEl.classList.remove('has-match', 'no-match');
      if (upBtn) upBtn.disabled = true;
      if (downBtn) downBtn.disabled = true;
      return;
    }

    const dateInput = item.querySelector('.diary-search-date');
    const textInput = item.querySelector('.diary-search-text');
    const hasQuery = Boolean((dateInput?.value || '').trim() || (textInput?.value || '').trim());

    statusEl.classList.remove('has-match', 'no-match');

    if (!hasQuery) {
      statusEl.textContent = '';
      if (upBtn) upBtn.disabled = true;
      if (downBtn) downBtn.disabled = true;
      return;
    }

    const matches = collectMatches(item);
    item.__matches = matches;

    if (matches.length === 0) {
      statusEl.textContent = onScreen(tr('noMatches', 'No matches found'));
      statusEl.classList.add('no-match');
      if (upBtn) upBtn.disabled = true;
      if (downBtn) downBtn.disabled = true;
      return;
    }

    statusEl.textContent = onScreen(
      tr(matches.length === 1 ? 'matchOne' : 'matchMany',
         matches.length === 1 ? '{n} match' : '{n} matches')
        .replace('{n}', String(matches.length))
    );
    statusEl.classList.add('has-match');
    if (upBtn) upBtn.disabled = false;
    if (downBtn) downBtn.disabled = false;
  }

  // ===================================================
  // Jump to match
  // ===================================================
  function jumpToMatch(item, direction) {
    const matches = item.__matches || collectMatches(item);
    if (!matches.length) return;

    matches.forEach((m) => m.classList.remove('match-highlight'));

    if (typeof item.__matchIndex !== 'number' || item.__matchIndex < -1) {
      item.__matchIndex = -1;
    }

    item.__matchIndex += direction;
    if (item.__matchIndex >= matches.length) item.__matchIndex = 0;
    if (item.__matchIndex < 0) item.__matchIndex = matches.length - 1;

    const target = matches[item.__matchIndex];
    if (target) {
      target.classList.add('match-highlight');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // ===================================================
  // Accordion + Search toggle
  // ===================================================
  function initAccordion() {
    const accordion = document.getElementById('subjectAccordion');
    if (!accordion) return;

    const items = accordion.querySelectorAll('.subject-item');

    items.forEach((item) => {
      const btn = item.querySelector('.subject-btn');
      const panel = item.querySelector('.subject-panel');
      const searchToggle = item.querySelector('.subject-search-toggle');
      const searchBlock = item.querySelector('[data-search-block]');
      if (!btn || !panel) return;

      // ----- Expand / collapse the whole subject -----
      btn.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');

        // Close all others
        items.forEach((other) => {
          if (other === item) return;
          other.classList.remove('open');
          other.classList.remove('search-open');
          const otherBtn = other.querySelector('.subject-btn');
          const otherPanel = other.querySelector('.subject-panel');
          const otherSearchToggle = other.querySelector('.subject-search-toggle');
          const otherSearchBlock = other.querySelector('[data-search-block]');
          if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
          if (otherPanel) otherPanel.style.maxHeight = null;
          if (otherSearchToggle) otherSearchToggle.setAttribute('aria-expanded', 'false');
          if (otherSearchBlock) otherSearchBlock.hidden = true;
        });

        if (isOpen) {
          item.classList.remove('open');
          item.classList.remove('search-open');
          btn.setAttribute('aria-expanded', 'false');
          panel.style.maxHeight = null;
          if (searchToggle) searchToggle.setAttribute('aria-expanded', 'false');
          if (searchBlock) searchBlock.hidden = true;
        } else {
          item.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
          panel.style.maxHeight = 'none';
          const h = panel.scrollHeight;
          panel.style.maxHeight = h + 'px';
        }
      });

      // ----- Search toggle (only makes sense when expanded) -----
      if (searchToggle) {
        searchToggle.addEventListener('click', (e) => {
          e.stopPropagation();

          // Ensure the subject is expanded first
          if (!item.classList.contains('open')) {
            // Close others
            items.forEach((other) => {
              if (other === item) return;
              other.classList.remove('open');
              other.classList.remove('search-open');
              const otherBtn = other.querySelector('.subject-btn');
              const otherPanel = other.querySelector('.subject-panel');
              const otherSearchToggle = other.querySelector('.subject-search-toggle');
              const otherSearchBlock = other.querySelector('[data-search-block]');
              if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
              if (otherPanel) otherPanel.style.maxHeight = null;
              if (otherSearchToggle) otherSearchToggle.setAttribute('aria-expanded', 'false');
              if (otherSearchBlock) otherSearchBlock.hidden = true;
            });

            item.classList.add('open');
            btn.setAttribute('aria-expanded', 'true');
          }

          const isSearchOpen = item.classList.toggle('search-open');
          searchToggle.setAttribute('aria-expanded', String(isSearchOpen));
          if (searchBlock) searchBlock.hidden = !isSearchOpen;

          // When closing search, clear inputs and reset
          if (!isSearchOpen) {
            const dateInput = item.querySelector('.diary-search-date');
            const textInput = item.querySelector('.diary-search-text');
            if (dateInput) dateInput.value = '';
            if (textInput) textInput.value = '';
            item.__matchIndex = -1;
            item.__matches = [];
            // Clear highlights
            item.querySelectorAll('.diary-entry.match-highlight').forEach((el) => el.classList.remove('match-highlight'));
            refreshEntryVisibility(item);
          }

          // Resize panel
          panel.style.maxHeight = 'none';
          const h = panel.scrollHeight;
          panel.style.maxHeight = h + 'px';

          // Focus first input when opening
          if (isSearchOpen) {
            const focusEl = item.querySelector('.diary-search-text');
            if (focusEl) {
              // Small delay so the panel transition catches up
              setTimeout(() => focusEl.focus({ preventScroll: true }), 120);
            }
          }
        });
      }

      // ----- Search input wiring -----
      const dateInput = item.querySelector('.diary-search-date');
      const textInput = item.querySelector('.diary-search-text');
      const upBtn = item.querySelector('.diary-nav-up');
      const downBtn = item.querySelector('.diary-nav-down');

      if (dateInput) {
        dateInput.addEventListener('input', () => {
          if (dateInput.value && textInput) textInput.value = '';
          refreshEntryVisibility(item);
        });
      }

      if (textInput) {
        textInput.addEventListener('input', () => {
          if (textInput.value && dateInput) dateInput.value = '';
          refreshEntryVisibility(item);
        });
      }

      if (upBtn)   upBtn.addEventListener('click', () => jumpToMatch(item, -1));
      if (downBtn) downBtn.addEventListener('click', () => jumpToMatch(item, +1));
    });

    window.addEventListener('resize', () => {
      document.querySelectorAll('.subject-item.open').forEach((item) => {
        const panel = item.querySelector('.subject-panel');
        if (panel) {
          panel.style.maxHeight = 'none';
          panel.style.maxHeight = panel.scrollHeight + 'px';
        }
      });
    });
  }

  // ===================================================
  // Period filter wiring
  // ===================================================
  function initPeriodFilter() {
    const select = document.getElementById('diaryPeriodFilter');
    if (!select) return;
    applyPeriodFilter(select.value || 'today');
    select.addEventListener('change', () => applyPeriodFilter(select.value));
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
      renderDiaryData([], { blobUrl: function () { return Promise.reject(new Error('API client unavailable')); } });
      initializePage(new Error('Load parent-portal-api.js before parent-portal-diary.js.'));
      return;
    }
    api.ensureChildren()
      .then(() => api.diary())
      .then((rows) => {
        renderDiaryData(rows, api);
        initializePage();
      })
      .catch((err) => {
        renderDiaryData([], api);
        initializePage(err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();