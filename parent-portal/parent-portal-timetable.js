// Parent Portal – Timetable page script (connected to the backend)
// Data source: GET /api/parent/children/{regNo}/timetable
//   -> { available, className, updatedAt, periods:[{num,time}], days:{ Monday:[...], ... } }
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

  // ---------- Backend (parent-portal-api.js exposes window.PortalAPI) ----------
  // PortalAPI adds the base URL (/api/parent), the Bearer token and the 401 -> login redirect.
  const API = window.PortalAPI;

  // ---------- Student info (set at login / child selection) ----------
  function getStudent() {
    const defaults = { className: '', section: '', classSection: '', regNo: '' };
    let data = defaults;
    try {
      const saved = sessionStorage.getItem('studentData');
      if (saved) data = Object.assign({}, defaults, JSON.parse(saved));
    } catch (e) { /* ignore */ }
    data.regNo = (API && API.childId()) || data.regNo || data.regNumber || data.id || '';
    if (!data.classSection && (data.className || data.section)) {
      data.classSection = data.section ? `${data.className} – ${data.section}` : data.className;
    }
    return data;
  }

  function setClassLabel(text) {
    const infoItems = document.querySelectorAll('.timetable-info-item span');
    if (infoItems[0] && text) {
      infoItems[0].textContent = onScreen(`${tr('classWord', 'Class')} ${text}`);
    }
  }

  // ---------- Templates captured from the static markup ----------
  const table = document.querySelector('.timetable-table');
  const thead = table.querySelector('thead tr');
  const tbody = table.querySelector('tbody');
  const scrollWrap = document.querySelector('.timetable-scroll');
  const hint = document.querySelector('.timetable-hint');

  const COLORS = ['blue', 'green', 'yellow', 'purple', 'pink', 'coral'];
  const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const tpl = { cornerTh: null, breakCell: null, dayIcon: {}, dayColor: {}, subjectKey: {} };

  function captureTemplates() {
    tpl.cornerTh = thead.querySelector('.tt-corner').cloneNode(true);
    const br = tbody.querySelector('.tt-break-cell');
    tpl.breakCell = br ? br.cloneNode(true) : null;

    tbody.querySelectorAll('.tt-row').forEach((row) => {
      const name = row.querySelector('.tt-day-name');
      const th = row.querySelector('.tt-day');
      if (!name || !th) return;
      const day = name.dataset.day;
      const icon = th.querySelector('.tt-day-icon');
      if (icon) tpl.dayIcon[day] = icon.outerHTML;
      const m = th.className.match(/tt-day-(\w+)/);
      if (m) tpl.dayColor[day] = m[1];
    });

    // Remember which subject names already have a translation key in the page
    tbody.querySelectorAll('.tt-subject[data-i18n]').forEach((el) => {
      tpl.subjectKey[el.textContent.trim().toLowerCase()] = el.getAttribute('data-i18n');
    });
  }

  // ---------- Helpers ----------
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function normCell(v) {
    if (v == null) return null;
    if (typeof v === 'string' || typeof v === 'number') {
      const s = String(v).trim();
      return s && s !== '-' && s !== '—' ? { subject: s } : null;
    }
    if (typeof v === 'object') {
      const subject = String(v.subject || v.name || v.title || '').trim();
      if (!subject) return null;
      return {
        subject,
        teacher: String(v.teacher || v.teacherName || '').trim(),
        room: String(v.room || '').trim()
      };
    }
    return null;
  }

  // "10:00 – 10:45" -> ["10:00","10:45"]
  const splitTime = (t) => String(t || '').split(/\s*[–—-]\s*/).map((s) => s.trim());

  function breakInfo(periods, payload) {
    let after = null, time = '';
    const b = payload.break;
    if (b && typeof b === 'object') { after = Number(b.after); time = b.time || ''; }
    if (payload.breakAfter != null) after = Number(payload.breakAfter);
    if (payload.breakTime) time = payload.breakTime;
    if (!after && periods.length > 3) after = 3;                  // layout of the original page
    if (!after || after >= periods.length) return null;
    if (!time) {
      const end = splitTime(periods[after - 1].time)[1];
      const start = splitTime(periods[after].time)[0];
      time = end && start ? `${end} – ${start}` : '';
    }
    return { after, time };
  }

  // ---------- Status message (loading / empty / error) ----------
  let statusEl = null;
  function showStatus(text, isError) {
    if (!statusEl) {
      statusEl = el('p', 'timetable-status');
      statusEl.setAttribute('role', 'status');
      statusEl.style.cssText = 'text-align:center;padding:28px 16px;color:#5b6b66;font-size:15px;';
      scrollWrap.parentNode.insertBefore(statusEl, scrollWrap);
    }
    statusEl.textContent = text;
    statusEl.style.color = isError ? '#b3261e' : '#5b6b66';
    statusEl.hidden = false;
    scrollWrap.hidden = true;
    if (hint) hint.hidden = true;
  }
  function hideStatus() {
    if (statusEl) statusEl.hidden = true;
    scrollWrap.hidden = false;
    if (hint) hint.hidden = false;
  }

  // ---------- Render ----------
  function render(payload) {
    const periods = (Array.isArray(payload.periods) ? payload.periods : [])
      .map((p, i) => ({ num: p.num != null ? p.num : i + 1, time: p.time || '' }));
    const days = payload.days || {};

    // Day rows: standard order first, then any extra day names the school used
    const dayNames = DAY_ORDER.filter((d) => Array.isArray(days[d]))
      .concat(Object.keys(days).filter((d) => !DAY_ORDER.includes(d) && Array.isArray(days[d])));

    // If the school sent no period list, derive one from the longest day
    if (!periods.length) {
      const max = dayNames.reduce((m, d) => Math.max(m, days[d].length), 0);
      for (let i = 0; i < max; i++) periods.push({ num: i + 1, time: '' });
    }
    if (!dayNames.length || !periods.length) {
      showStatus(tr('ttNotPublished', 'The timetable for this class has not been published yet.'));
      return;
    }

    const brk = breakInfo(periods, payload);

    // ----- header -----
    thead.innerHTML = '';
    thead.appendChild(tpl.cornerTh.cloneNode(true));
    periods.forEach((p, i) => {
      const th = el('th', 'tt-period');
      th.appendChild(el('span', 'tt-period-num', String(p.num)));
      if (p.time) th.appendChild(el('span', 'tt-period-time', p.time));
      thead.appendChild(th);
      if (brk && brk.after === i + 1) {
        const bh = el('th', 'tt-break-header');
        bh.setAttribute('aria-hidden', 'true');
        thead.appendChild(bh);
      }
    });

    // ----- body -----
    tbody.innerHTML = '';
    dayNames.forEach((day, rowIdx) => {
      const color = tpl.dayColor[day] || COLORS[rowIdx % COLORS.length];
      const row = el('tr', 'tt-row');

      const th = el('th', `tt-day tt-day-${color}`);
      const inner = el('span', 'tt-day-inner');
      inner.innerHTML = tpl.dayIcon[day] || '';
      const name = el('span', 'tt-day-name', day);
      name.dataset.day = day;
      name.setAttribute('data-i18n', 'day' + day);   // translated by I18n.apply()
      inner.appendChild(name);
      th.appendChild(inner);
      row.appendChild(th);

      const cells = days[day];
      periods.forEach((p, i) => {
        const c = normCell(cells[i]);
        const td = el('td', `tt-cell tt-cell-${color}`);
        if (c) {
          const subj = el('span', 'tt-subject', c.subject);
          const key = tpl.subjectKey[c.subject.toLowerCase()];
          if (key) subj.setAttribute('data-i18n', key);
          td.appendChild(subj);
          if (c.teacher || c.room) {
            const t = el('span', 'tt-teacher');
            if (c.teacher) {
              t.textContent = c.teacher;
            } else {
              const rm = el('span', null, 'Rm');
              rm.setAttribute('data-i18n', 'roomShort');
              t.appendChild(rm);
              t.appendChild(document.createTextNode(' ' + c.room));
            }
            td.appendChild(t);
          }
        } else {
          td.appendChild(el('span', 'tt-subject', '—'));
        }
        row.appendChild(td);

        // Break column: one tall cell, only in the first row
        if (brk && brk.after === i + 1 && rowIdx === 0 && tpl.breakCell) {
          const bc = tpl.breakCell.cloneNode(true);
          bc.rowSpan = dayNames.length;
          const bt = bc.querySelector('.tt-break-time');
          if (bt) bt.textContent = brk.time;
          row.appendChild(bc);
        }
      });
      tbody.appendChild(row);
    });

    hideStatus();
    if (I18n) I18n.apply();
    highlightToday();
  }

  // ---------- Load from backend ----------
  async function loadTimetable() {
    const student = getStudent();
    setClassLabel(student.classSection);

    if (!student.regNo) {
      showStatus(tr('ttNoStudent', 'Please select a student from the home page.'), true);
      return;
    }
    showStatus(tr('loading', 'Loading timetable…'));

    try {
      const data = await API.get(API.forChild('/timetable'));
      if (!data || data.available === false) {
        showStatus(tr('ttNotPublished', 'The timetable for this class has not been published yet.'));
        return;
      }
      if (data.className) setClassLabel(String(data.className).replace(/\s+-\s+/, ' – ').replace(/^class\s+/i, ''));
      render(data);
    } catch (err) {
      console.error('Timetable load failed:', err);
      showStatus((err && err.message) || tr('ttLoadError', 'Could not load the timetable. Please try again.'), true);
    }
  }

  // ---------- Highlight today's row ----------
  function highlightToday() {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = dayNames[new Date().getDay()];

    document.querySelectorAll('.tt-row').forEach((row) => {
      const dayLabel = row.querySelector('.tt-day-name');
      if (!dayLabel) return;
      const rowDay = dayLabel.dataset.day || dayLabel.textContent.trim();
      if (rowDay === today) {
        row.classList.add('tt-row-today');
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

  // ---------- Boot ----------
  function boot() {
    captureTemplates();   // must run before the sample rows are replaced
    initDrawer();
    loadTimetable();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
