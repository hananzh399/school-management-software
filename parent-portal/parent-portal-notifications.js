// Parent Portal – Notifications page script (connected to the backend)
//
// The feed itself (and the "seen" tracking behind the red dot on Home) lives in
// parent-portal-notif-feed.js. This file only renders it and marks it as seen.
(function () {
  'use strict';

  // ---------- Language ----------
  const I18n = window.PortalI18n;
  if (I18n) I18n.apply();

  const tr = (key, fallback) => {
    try {
      const v = I18n ? I18n.t(key) : null;
      return v && v !== key ? v : fallback;
    } catch (e) {
      return fallback;
    }
  };

  const API = window.PortalAPI;
  const Feed = window.PortalNotifFeed;
  const { isoDaysAgo, parseDate, formatDate, formatTime } = Feed.util;
  const locale = document.documentElement.lang || undefined;

  function dateLabel(iso) {
    if (iso === isoDaysAgo(0)) return tr('today', 'Today');
    if (iso === isoDaysAgo(1)) return tr('yesterday', 'Yesterday');
    return parseDate(iso).toLocaleDateString(locale, { weekday: 'long' });
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

  function showMessage(list, strong, hint) {
    list.textContent = '';
    const box = el('div', 'notif-empty');
    const icon = el('span', 'notif-empty-icon');
    icon.innerHTML = ICONS.default;
    box.appendChild(icon);
    box.appendChild(el('strong', '', strong));
    if (hint) box.appendChild(el('span', '', hint));
    list.appendChild(box);
  }

  function render(items) {
    const list = document.getElementById('notifList');
    const summary = document.getElementById('notifSummary');
    if (!list) return;

    const note = tr('notifKeptNote', 'Showing the last 3 days');
    if (summary) summary.textContent = items.length ? items.length + ' \u00b7 ' + note : note;

    if (!items.length) {
      showMessage(list,
        tr('noNotifications', 'You\u2019re all caught up'),
        tr('noNotificationsHint', 'New notifications from the school will appear here.'));
      return;
    }

    list.textContent = '';

    // Newest first, grouped by date
    const sorted = items.slice().sort((a, b) =>
      (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));

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
        if (n.time) head.appendChild(el('span', 'notif-time', formatTime(n.time)));
        main.appendChild(head);
        if (n.body) main.appendChild(el('p', 'notif-body', n.body));

        li.appendChild(icon);
        li.appendChild(main);
        ul.appendChild(li);
      });

      section.appendChild(ul);
      list.appendChild(section);
    });
  }

  async function boot() {
    const list = document.getElementById('notifList');
    if (!list) return;
    try { localStorage.removeItem('portalNotifications'); } catch (e) { /* old sample data */ }

    if (!API || !API.childId()) {
      showMessage(list, tr('ttNoStudent', 'Please select a student from the home page.'));
      return;
    }
    showMessage(list, tr('loading', 'Loading\u2026'));
    try {
      const items = await Feed.load();
      render(items);
      // The person has now seen everything listed -> the red dot on Home goes away
      // until a notification with a new id arrives.
      Feed.markSeen(items);
    } catch (err) {
      console.error('Notifications load failed:', err);
      showMessage(list, tr('notifLoadError', 'Could not load notifications.'),
        (err && err.message) || '');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
