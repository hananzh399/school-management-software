// Parent Portal – shared notification feed + "seen" tracking.
// Load after parent-portal-api.js / parent-portal-i18n.js, before the page script.
//
// Used by:
//   - Notifications page: renders the feed, then calls markSeen(items)
//   - Home page: calls load() + unseenCount(items) to decide if the red dot shows
//
// The backend has no "notifications" table, so the feed is assembled from what the
// school already publishes for the selected child (last 3 days only).
(function (global) {
  'use strict';

  var RETENTION_DAYS = 3;          // today + the 2 days before it
  var CURRENCY = 'Rs.';            // shown in fee reminders; set '' to hide
  var SEEN_PREFIX = 'portalNotifSeen:';
  var SEEN_KEEP_MS = 14 * 24 * 60 * 60 * 1000;   // forget seen ids after 14 days

  var I18n = global.PortalI18n;
  var API = global.PortalAPI;

  function tr(key, fallback) {
    try {
      var v = I18n ? I18n.t(key) : null;
      return v && v !== key ? v : fallback;
    } catch (e) { return fallback; }
  }

  // ---------- Date helpers ----------
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var isoOf = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  function locale() { return document.documentElement.lang || undefined; }

  function isoDaysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return isoOf(d);
  }
  function parseDate(iso) {
    var p = iso.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function formatDate(iso) {
    return parseDate(iso).toLocaleDateString(locale(), {
      weekday: 'short', day: 'numeric', month: 'long', year: 'numeric'
    });
  }
  function formatTime(hhmm) {
    if (!hhmm) return '';
    var p = hhmm.split(':').map(Number);
    var t = new Date();
    t.setHours(p[0], p[1], 0, 0);
    return t.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
  }

  // "2026-10-20" -> {date, time:''}   |   ISO instant -> local {date, time:'HH:MM'}
  function when(value) {
    if (!value) return null;
    var s = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s, time: '' };
    var d = new Date(s);
    if (isNaN(d)) return null;
    return { date: isoOf(d), time: pad(d.getHours()) + ':' + pad(d.getMinutes()) };
  }
  // "07:52:10" or "2026-10-20T07:52:10" -> "07:52"
  function clock(value) {
    var m = /(?:T|^)(\d{1,2}):(\d{2})/.exec(String(value || ''));
    return m ? pad(+m[1]) + ':' + m[2] : '';
  }
  function money(n) {
    return (CURRENCY ? CURRENCY + ' ' : '') + Number(n || 0).toLocaleString(locale());
  }
  function childFirstName() {
    var c = API && API.child();
    var name = c && (c.name || c.fullName);
    return name ? String(name).trim().split(/\s+/)[0] : tr('yourChild', 'Your child');
  }

  // ---------- Feed builders ----------
  // Every item has a stable `id` (same notification => same id on every load),
  // which is what the "seen" tracking relies on.
  function fromAnnouncements(rows) {
    return (rows || []).map(function (a) {
      var w = when(a.date);
      if (!w) return null;
      return { id: 'ann|' + (a.id != null ? a.id : w.date + '|' + (a.title || '')),
        date: w.date, time: w.time, type: a.category === 'result' ? 'result' : 'default',
        title: a.title || tr('notifAnnouncement', 'New announcement'), body: a.body || '' };
    });
  }

  function fromDiary(rows) {
    return (rows || []).map(function (d) {
      var w = when(d.createdAt || d.date);
      if (!w) return null;
      var subject = d.subject ? ' \u00b7 ' + d.subject : '';
      return { id: 'diary|' + (d.id != null ? d.id : (d.createdAt || d.date) + '|' + (d.subject || '')),
        date: w.date, time: w.time, type: 'homework',
        title: tr('notifHomework', 'New homework posted') + subject, body: d.note || '' };
    });
  }

  function fromTests(rows) {
    return (rows || []).map(function (t) {
      if (t.status !== 'marked') return null;
      var w = when(t.date);
      if (!w) return null;
      var of = t.totalMarks ? ' / ' + t.totalMarks : '';
      var pct = t.percentage != null ? ' (' + t.percentage + '%)' : '';
      return { id: 'test|' + (t.id != null ? t.id : w.date + '|' + (t.title || '') + '|' + (t.subject || '')),
        date: w.date, time: '', type: 'result',
        title: tr('notifResult', 'Result announced') + (t.title ? ' \u00b7 ' + t.title : ''),
        body: (t.subject ? t.subject + ': ' : '') + childFirstName() + ' scored ' + t.score + of + pct + '.' };
    });
  }

  function fromAttendance(data) {
    var out = [];
    var days = (data && data.days) || {};
    var details = (data && data.details) || {};
    var name = childFirstName();
    Object.keys(days).forEach(function (date) {
      var status = days[date];
      var det = details[date] || {};
      var t = clock(det.checkIn);
      var body;
      if (status === 'present') {
        body = name + ' was marked present.' + (t ? ' Arrival time: ' + formatTime(t) + '.' : '');
      } else if (status === 'absent') {
        body = name + ' was marked absent.' + (det.reason ? ' Reason: ' + det.reason : '');
      } else if (status === 'leave') {
        body = name + ' is on leave.' + (det.reason ? ' Reason: ' + det.reason : '');
      } else {
        return;
      }
      out.push({ id: 'att|' + date + '|' + status, date: date, time: t, type: 'attendance',
        title: tr('notifAttendance', 'Attendance update'), body: body });
    });
    return out;
  }

  function fromFees(data) {
    var today = isoDaysAgo(0);
    return ((data && data.fees) || []).map(function (f) {
      if (f.status !== 'due' && f.status !== 'overdue') return null;
      var overdue = f.status === 'overdue';
      // The id has no date, so a standing reminder is "new" once, not again every day.
      // It becomes new again if the fee turns from due to overdue.
      return { id: 'fee|' + (f.id != null ? f.id : f.monthLabel) + '|' + f.status,
        date: today, time: '', type: 'fee',
        title: overdue ? tr('notifFeeOverdue', 'Fee overdue') : tr('notifFeeReminder', 'Fee reminder'),
        body: 'The fee for ' + f.monthLabel + ' (' + money(f.remaining) + ') ' +
              (overdue ? 'was due on ' : 'is due on ') + formatDate(f.dueDate) + '.' };
    });
  }

  // Runs every request; one failing endpoint does not hide the others.
  function load() {
    var api = global.PortalAPI || API;
    if (!api || !api.childId()) return Promise.reject(new Error('No child selected'));
    var jobs = [
      ['/announcements', fromAnnouncements],
      ['/diary', fromDiary],
      ['/tests', fromTests],
      ['/attendance', fromAttendance],
      ['/fees', fromFees]
    ].map(function (j) {
      return Promise.resolve()
        .then(function () { return api.get(api.forChild(j[0])); })
        .then(j[1]);
    });

    return Promise.allSettled(jobs).then(function (results) {
      var failed = results.filter(function (r) { return r.status === 'rejected'; });
      if (failed.length === results.length) throw failed[0].reason;

      var oldestKept = isoDaysAgo(RETENTION_DAYS - 1);
      var newest = isoDaysAgo(0);
      var items = [];
      results.forEach(function (r) {
        if (r.status === 'fulfilled') items.push.apply(items, r.value || []);
      });
      return items.filter(function (n) { return n && n.date >= oldestKept && n.date <= newest; });
    });
  }

  // ---------- Seen tracking (per child, in this browser) ----------
  function seenKey() {
    var id = global.PortalAPI && global.PortalAPI.childId();
    return id ? SEEN_PREFIX + id : null;
  }
  function readSeen() {
    var key = seenKey();
    if (!key) return {};
    try {
      var o = JSON.parse(localStorage.getItem(key) || '{}');
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch (e) { return {}; }
  }

  function unseen(items) {
    var seen = readSeen();
    return (items || []).filter(function (n) { return n && !seen[n.id]; });
  }
  function unseenCount(items) { return unseen(items).length; }

  // Call when the person has actually looked at these notifications.
  function markSeen(items) {
    var key = seenKey();
    if (!key) return;
    var seen = readSeen();
    var now = Date.now();
    (items || []).forEach(function (n) { if (n && n.id) seen[n.id] = now; });
    Object.keys(seen).forEach(function (id) {
      if (now - seen[id] > SEEN_KEEP_MS) delete seen[id];
    });
    try { localStorage.setItem(key, JSON.stringify(seen)); } catch (e) { /* storage unavailable */ }
  }

  global.PortalNotifFeed = {
    RETENTION_DAYS: RETENTION_DAYS,
    load: load,
    unseen: unseen,
    unseenCount: unseenCount,
    markSeen: markSeen,
    util: { isoDaysAgo: isoDaysAgo, parseDate: parseDate, formatDate: formatDate, formatTime: formatTime }
  };
})(window);
