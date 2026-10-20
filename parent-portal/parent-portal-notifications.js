// Parent Portal – Notifications page script (connected to the backend)
//
// The backend has no separate "notifications" table, so the feed is assembled from
// what the school already publishes for the selected child (last 3 days only):
//   announcements -> notice            diary entries  -> homework
//   marked tests  -> result            attendance     -> attendance
//   unpaid fees   -> fee (standing reminder, shown as today)
(function () {
  'use strict';

  // ---------- Settings ----------
  const RETENTION_DAYS = 3;                 // today + the 2 days before it
  const CURRENCY = 'Rs.';                   // shown in fee reminders; change or set '' to hide

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

  const API = window.PortalAPI;

  // ---------- Date helpers ----------
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

  function isoDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return isoOf(d);
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
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    const t = new Date();
    t.setHours(h, m, 0, 0);
    return t.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  }

  // "2026-10-20" -> {date, time:''}   |   ISO instant -> local {date, time:'HH:MM'}
  function when(value) {
    if (!value) return null;
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s, time: '' };
    const d = new Date(s);
    if (isNaN(d)) return null;
    return { date: isoOf(d), time: pad(d.getHours()) + ':' + pad(d.getMinutes()) };
  }

  // "07:52:10" or "2026-10-20T07:52:10" -> "07:52"
  function clock(value) {
    const m = /(?:T|^)(\d{1,2}):(\d{2})/.exec(String(value || ''));
    return m ? pad(+m[1]) + ':' + m[2] : '';
  }

  const money = (n) => (CURRENCY ? CURRENCY + ' ' : '') + Number(n || 0).toLocaleString(locale);

  // ---------- Build the feed from the backend ----------
  function childFirstName() {
    const c = API && API.child();
    const name = c && (c.name || c.fullName);
    return name ? String(name).trim().split(/\s+/)[0] : tr('yourChild', 'Your child');
  }

  function fromAnnouncements(rows) {
    return (rows || []).map((a) => {
      const w = when(a.date);
      if (!w) return null;
      return { date: w.date, time: w.time, type: 'default',
        title: a.title || tr('notifAnnouncement', 'New announcement'), body: a.body || '' };
    });
  }

  function fromDiary(rows) {
    return (rows || []).map((d) => {
      const w = when(d.createdAt || d.date);
      if (!w) return null;
      const subject = d.subject ? ' · ' + d.subject : '';
      return { date: w.date, time: w.time, type: 'homework',
        title: tr('notifHomework', 'New homework posted') + subject, body: d.note || '' };
    });
  }

  function fromTests(rows) {
    return (rows || []).map((t) => {
      if (t.status !== 'marked') return null;
      const w = when(t.date);
      if (!w) return null;
      const of = t.totalMarks ? ' / ' + t.totalMarks : '';
      const pct = t.percentage != null ? ' (' + t.percentage + '%)' : '';
      return { date: w.date, time: '', type: 'result',
        title: tr('notifResult', 'Result announced') + (t.title ? ' · ' + t.title : ''),
        body: (t.subject ? t.subject + ': ' : '') + childFirstName() + ' scored ' + t.score + of + pct + '.' };
    });
  }

  function fromAttendance(data) {
    const out = [];
    const days = (data && data.days) || {};
    const details = (data && data.details) || {};
    const name = childFirstName();
    Object.keys(days).forEach((date) => {
      const status = days[date];
      const det = details[date] || {};
      const t = clock(det.checkIn);
      let body;
      if (status === 'present') {
        body = name + ' was marked present.' + (t ? ' Arrival time: ' + formatTime(t) + '.' : '');
      } else if (status === 'absent') {
        body = name + ' was marked absent.' + (det.reason ? ' Reason: ' + det.reason : '');
      } else if (status === 'leave') {
        body = name + ' is on leave.' + (det.reason ? ' Reason: ' + det.reason : '');
      } else {
        return;
      }
      out.push({ date, time: t, type: 'attendance',
        title: tr('notifAttendance', 'Attendance update'), body });
    });
    return out;
  }

  function fromFees(data) {
    const today = isoDaysAgo(0);
    return ((data && data.fees) || []).map((f) => {
      if (f.status !== 'due' && f.status !== 'overdue') return null;
      const overdue = f.status === 'overdue';
      return { date: today, time: '', type: 'fee',
        title: overdue ? tr('notifFeeOverdue', 'Fee overdue') : tr('notifFeeReminder', 'Fee reminder'),
        body: 'The fee for ' + f.monthLabel + ' (' + money(f.remaining) + ') ' +
              (overdue ? 'was due on ' : 'is due on ') + formatDate(f.dueDate) + '.' };
    });
  }

  // Runs every request; one failing endpoint does not hide the others.
  async function loadFeed() {
    const jobs = [
      ['/announcements', fromAnnouncements],
      ['/diary', fromDiary],
      ['/tests', fromTests],
      ['/attendance', fromAttendance],
      ['/fees', fromFees]
    ].map(([path, map]) => API.get(API.forChild(path)).then(map));

    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === results.length) throw failed[0].reason;

    const oldestKept = isoDaysAgo(RETENTION_DAYS - 1);
    const newest = isoDaysAgo(0);
    const items = [];
    results.forEach((r) => {
      if (r.status === 'fulfilled') items.push(...(r.value || []));
    });
    return items.filter((n) => n && n.date >= oldestKept && n.date <= newest);
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
    if (summary) summary.textContent = items.length ? items.length + ' · ' + note : note;

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
    showMessage(list, tr('loading', 'Loading…'));
    try {
      render(await loadFeed());
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
