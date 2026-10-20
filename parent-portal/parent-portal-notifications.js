// Parent Portal – Notifications page script
(function () {
  'use strict';

  // ---------- Settings ----------
  const RETENTION_DAYS = 3;                 // today + the 2 days before it
  const STORAGE_KEY = 'portalNotifications';

  // ---------- Language ----------
  const I18n = window.PortalI18n;
  if (I18n) I18n.apply();

  // Returns the translation, or the English fallback if the key is missing.
  const tr = (key, fallback) => {
    try {
      const v = I18n ? I18n.t(key) : null;
      return v && v !== key ? v : fallback;
    } catch (e) {
      return fallback;
    }
  };

  // ---------- Date helpers ----------
  function isoDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function parseDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  const locale = document.documentElement.lang || undefined;

  function formatDate(iso) {
    return parseDate(iso).toLocaleDateString(locale, {
      weekday: 'short', day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  function dateLabel(iso) {
    if (iso === isoDaysAgo(0)) return tr('today', 'Today');
    if (iso === isoDaysAgo(1)) return tr('yesterday', 'Yesterday');
    return parseDate(iso).toLocaleDateString(locale, { weekday: 'long' });
  }

  function formatTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const t = new Date();
    t.setHours(h, m, 0, 0);
    return t.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  }

  // ---------- Data ----------
  // type: fee | attendance | meeting | homework | result (optional, picks the icon)
  // date: YYYY-MM-DD    time: 24-hour HH:MM
  // Replace this sample list with data from your server.
  function sampleData() {
    return [
      { date: isoDaysAgo(0), time: '09:15', type: 'fee', title: 'Fee reminder',
        body: 'The fee for October is due on 25 October. Please clear the dues to avoid a late fee.' },
      { date: isoDaysAgo(0), time: '08:05', type: 'attendance', title: 'Attendance update',
        body: 'Aarav was marked present today. Arrival time: 07:52 AM.' },
      { date: isoDaysAgo(1), time: '14:30', type: 'meeting', title: 'Parent-teacher meeting',
        body: 'A parent-teacher meeting is scheduled for Saturday at 10:00 AM in the school hall.' },
      { date: isoDaysAgo(1), time: '11:00', type: 'homework', title: 'New homework posted',
        body: 'Mathematics: Exercise 4.2, questions 1 to 10. Due tomorrow.' },
      { date: isoDaysAgo(2), time: '16:45', type: 'result', title: 'Result announced',
        body: 'The mid-term results are now available. Open the dashboard to view the report card.' },
      // Older than 3 days: removed automatically the first time the page loads
      { date: isoDaysAgo(4), time: '10:00', type: 'homework', title: 'Old homework notice',
        body: 'This one is older than 3 days, so it gets deleted.' }
    ];
  }

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return sampleData();
  }

  function saveAll(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  // Keeps only the last RETENTION_DAYS calendar days and deletes the rest.
  function purgeOld(list) {
    const oldestKept = isoDaysAgo(RETENTION_DAYS - 1);
    const kept = list.filter((n) => n && n.date >= oldestKept && n.date <= isoDaysAgo(0));
    if (kept.length !== list.length) saveAll(kept);
    return kept;
  }

  // ---------- Icons (static markup, no user data) ----------
  const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    fee: '<svg ' + ICON_ATTRS + '><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    attendance: '<svg ' + ICON_ATTRS + '><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    meeting: '<svg ' + ICON_ATTRS + '><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    homework: '<svg ' + ICON_ATTRS + '><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    result: '<svg ' + ICON_ATTRS + '><circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/></svg>',
    default: '<svg ' + ICON_ATTRS + '><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
  };

  // ---------- Render ----------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render() {
    const list = document.getElementById('notifList');
    const summary = document.getElementById('notifSummary');
    if (!list) return;

    const items = purgeOld(loadAll());
    list.textContent = '';

    if (summary) {
      summary.textContent = items.length
        ? items.length + ' · ' + tr('notifKeptNote', 'Showing the last 3 days')
        : tr('notifKeptNote', 'Showing the last 3 days');
    }

    if (!items.length) {
      const empty = el('div', 'notif-empty');
      const icon = el('span', 'notif-empty-icon');
      icon.innerHTML = ICONS.default;
      empty.appendChild(icon);
      empty.appendChild(el('strong', '', tr('noNotifications', 'You\u2019re all caught up')));
      empty.appendChild(el('span', '', tr('noNotificationsHint', 'New notifications from the school will appear here.')));
      list.appendChild(empty);
      return;
    }

    // Newest first, grouped by date
    const sorted = items.slice().sort((a, b) =>
      (b.date + b.time).localeCompare(a.date + a.time));

    const groups = new Map();
    sorted.forEach((n) => {
      if (!groups.has(n.date)) groups.set(n.date, []);
      groups.get(n.date).push(n);
    });

    groups.forEach((group, date) => {
      const section = el('section', 'notif-group');

      const heading = el('h2', 'notif-date');
      heading.appendChild(el('span', 'notif-date-label', dateLabel(date)));
      heading.appendChild(el('span', '', formatDate(date)));
      section.appendChild(heading);

      const ul = el('ul', 'notif-cards');
      group.forEach((n) => {
        const type = ICONS[n.type] ? n.type : 'default';
        const li = el('li', 'notif-card');

        const icon = el('span', 'notif-icon t-' + type);
        icon.innerHTML = ICONS[type];
        icon.setAttribute('aria-hidden', 'true');

        const main = el('div', 'notif-main');
        const head = el('div', 'notif-card-head');
        head.appendChild(el('h3', 'notif-title', n.title));
        head.appendChild(el('span', 'notif-time', formatTime(n.time)));
        main.appendChild(head);
        main.appendChild(el('p', 'notif-body', n.body));

        li.appendChild(icon);
        li.appendChild(main);
        ul.appendChild(li);
      });

      section.appendChild(ul);
      list.appendChild(section);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();