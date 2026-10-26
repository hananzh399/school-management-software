// Parent Portal – notifications for new messages, announcements and results.
//
// How it works (no push-service credentials are needed):
//   - every few seconds the portal asks GET /api/parent/pulse (a tiny probe: unread messages + newest
//     announcement id per child) and compares it with what this browser has already been told about;
//   - when something new arrived it is shown as
//        * a system notification (phone / desktop notification bar) while the portal is in the background,
//          once the parent has allowed notifications; or
//        * a small in-app banner while the portal is open.
//   - tapping a notification opens the right page (the chat, or the Announcements page).
//
// Every poll also broadcasts a "portal-pulse" event on window (detail = the raw pulse), which is what makes
// the message dot/number, the lists and the chat update live without the parent refreshing anything.
//
// Included at the end of every parent page. Only one open tab shows alerts at a time, so nothing is shown twice.
// Limit: the browser must be running (a background tab or an installed home-screen app is fine). Alerts while the
// browser is completely closed would need a real Web Push server key - parent-portal-sw.js already handles that.
(function (global) {
  'use strict';

  var API = global.PortalAPI;
  if (!API) return;

  var POLL_VISIBLE_MS = 8000;     // pulse check while the portal is on screen (feels live; the server allows 300 calls/min per IP)
  var POLL_HIDDEN_MS = 30000;     // pulse check while the tab is in the background (saves battery/data)
  var LEASE_MS = 40000;           // one tab "owns" showing alerts for this long
  var ASK_AGAIN_DAYS = 7;         // after "Not now", ask again after a week
  var MAX_SINGLE = 3;             // more than this many new announcements -> one summary notification
  var ME = Math.random().toString(36).slice(2);
  var SUPPORTED = 'Notification' in global;
  var swReg = null;
  var queued = [];                // alerts that arrived while the tab was hidden and system alerts are off
  var bannerShown = false;
  var polling = false;
  var lastPulse = null;
  var failStreak = 0;             // consecutive failed polls -> wait longer (offline, rate limit, server busy)

  // ---------- tiny helpers ----------
  function lsGet(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage unavailable */ } }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  function token() { try { return sessionStorage.getItem('softschool_parent_token'); } catch (e) { return null; } }
  function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function quietly(fn) {
    var l = global.ParentPortalLoading;
    return l && typeof l.quiet === 'function' ? l.quiet(fn) : fn();
  }
  function tr(key, fallback) {
    try {
      var v = global.PortalI18n ? global.PortalI18n.t(key) : null;
      return v && v !== key ? v : fallback;
    } catch (e) { return fallback; }
  }
  function regOf(c) { return c ? String(c.regNo || c.regNumber || c.id || '') : ''; }
  function kids() { try { return API.childList() || []; } catch (e) { return []; } }
  function accountKey() {
    var ids = kids().map(regOf).filter(Boolean).sort();
    return ids.length ? 'portalPush:state:' + ids.join('|') : null;
  }
  function nameOf(reg) {
    var c = kids().filter(function (k) { return regOf(k) === String(reg); })[0];
    var n = c && (c.fullName || c.name || c.studentName);
    return n ? String(n).trim().split(/\s+/)[0] : '';
  }
  function onChatPage() { return /parent-portal-(chat|messages)\.html/.test(global.location.pathname); }

  // ---------- one tab polls at a time ----------
  // A visible tab always wins over a background one, so the alert appears where the parent is looking.
  function takeLease() {
    var now = Date.now(), l = lsGet('portalPush:lead');
    var visible = document.visibilityState === 'visible';
    if (l && l.id !== ME && now - l.t < LEASE_MS && !(visible && !l.v)) return false;
    lsSet('portalPush:lead', { id: ME, t: now, v: visible });
    return true;
  }
  function releaseLease() {
    var l = lsGet('portalPush:lead');
    if (l && l.id === ME) lsDel('portalPush:lead');
  }

  // ---------- showing an alert ----------
  var CSS = '' +
    '.pp-push-toast,.pp-push-banner{position:fixed;left:50%;transform:translateX(-50%);z-index:100000;width:min(440px,calc(100vw - 24px));' +
    'display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;background:#fff;color:#1c2b2a;font-family:inherit;' +
    'box-shadow:0 10px 34px rgba(16,40,38,.25);border:1px solid rgba(46,139,122,.28);box-sizing:border-box}' +
    '.pp-push-toast{top:calc(10px + env(safe-area-inset-top,0px));cursor:pointer;animation:ppPushIn .26s ease-out}' +
    '.pp-push-banner{bottom:calc(84px + env(safe-area-inset-bottom,0px));animation:ppPushUp .26s ease-out}' +
    '@keyframes ppPushIn{from{opacity:0;transform:translate(-50%,-14px)}to{opacity:1;transform:translate(-50%,0)}}' +
    '@keyframes ppPushUp{from{opacity:0;transform:translate(-50%,14px)}to{opacity:1;transform:translate(-50%,0)}}' +
    '.pp-push-ic{flex:0 0 38px;height:38px;border-radius:12px;background:#E6F4F0;color:#2E8B7A;display:grid;place-items:center}' +
    '.pp-push-ic svg{width:20px;height:20px}' +
    '.pp-push-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}' +
    '.pp-push-tx b{font-size:14px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pp-push-tx span{font-size:12.5px;line-height:1.35;color:#4b5d5b;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}' +
    '.pp-push-yes{border:0;border-radius:10px;background:#2E8B7A;color:#fff;font-weight:600;font-size:13px;font-family:inherit;padding:9px 14px;cursor:pointer;flex-shrink:0}' +
    '.pp-push-no{border:0;background:none;color:#6b7c7a;font-size:20px;line-height:1;cursor:pointer;padding:4px 6px;flex-shrink:0}';
  var BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

  function injectCss() {
    if (document.getElementById('ppPushCss')) return;
    var s = document.createElement('style'); s.id = 'ppPushCss'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function beep() {
    try {
      var AC = global.AudioContext || global.webkitAudioContext; if (!AC) return;
      var c = beep.ctx || (beep.ctx = new AC()), o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1175, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.35);
    } catch (e) { /* audio is blocked until the first tap - fine */ }
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function inApp(n) {
    injectCss();
    var old = document.querySelector('.pp-push-toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var box = el('div', 'pp-push-toast');
    box.setAttribute('role', 'status');
    var ic = el('span', 'pp-push-ic'); ic.innerHTML = BELL;
    var tx = el('div', 'pp-push-tx'); tx.appendChild(el('b', '', n.title)); tx.appendChild(el('span', '', n.body));
    var x = el('button', 'pp-push-no', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Dismiss');
    box.appendChild(ic); box.appendChild(tx); box.appendChild(x);
    var timer = setTimeout(close, 8000);
    function close() { clearTimeout(timer); if (box.parentNode) box.parentNode.removeChild(box); }
    box.addEventListener('click', function (e) {
      if (e.target === x) { close(); return; }
      close();
      if (n.url) global.location.href = n.url;
    });
    document.body.appendChild(box);
    beep();
  }
  function canSystem() { return SUPPORTED && global.Notification.permission === 'granted'; }
  function system(n) {
    var opts = { body: n.body, icon: 'logo-icon.png', badge: 'logo-icon.png', tag: n.tag || undefined, data: { url: n.url || 'parent-portal-index.html' } };
    try {
      if (swReg && swReg.showNotification) return swReg.showNotification(n.title, opts);
      var x = new global.Notification(n.title, opts);
      x.onclick = function () { try { global.focus(); } catch (e) { /* ignore */ } if (n.url) global.location.href = n.url; x.close(); };
    } catch (e) { inApp(n); }
  }
  function show(n) {
    var visible = document.visibilityState === 'visible';
    if (visible) {
      if (n.kind === 'message' && onChatPage()) return;      // the chat on screen already shows it
      inApp(n);
    } else if (canSystem()) {
      system(n);
    } else {
      queued.push(n);                                         // shown as a banner when the parent comes back
    }
  }
  function flushQueue() {
    if (!queued.length || document.visibilityState !== 'visible') return;
    var list = queued.splice(0, queued.length);
    inApp(list.length === 1 ? list[0] : { title: tr('pushManyTitle', 'New updates from school'), body: list.length + ' ' + tr('pushManyBody', 'new notifications'), url: 'parent-portal-notifications.html' });
  }

  // ---------- permission + service worker ----------
  function registerSW() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register('parent-portal-sw.js')
      .then(function (r) { swReg = r; return navigator.serviceWorker.ready.then(function (ready) { swReg = ready || r; return swReg; }); })
      .catch(function () { return null; });
  }
  function permission() { return SUPPORTED ? global.Notification.permission : 'unsupported'; }
  function enable() {
    if (!SUPPORTED) return Promise.resolve('unsupported');
    var ask;
    try { ask = global.Notification.requestPermission(); } catch (e) { return Promise.resolve(permission()); }
    return Promise.resolve(ask).then(function (p) {
      if (p !== 'granted') return p;
      return registerSW().then(function () {
        system({ title: tr('pushOnTitle', 'Notifications are on'), body: tr('pushOnBody', 'You will be alerted about new messages, announcements and results.'), url: 'parent-portal-index.html', tag: 'pp-welcome' });
        return 'granted';
      });
    });
  }

  function maybeAskBanner() {
    if (bannerShown || !SUPPORTED || permission() !== 'default') return;
    var skip = lsGet('portalPush:askedAt');
    if (skip && Date.now() - skip < ASK_AGAIN_DAYS * 86400000) return;
    bannerShown = true;
    injectCss();
    var box = el('div', 'pp-push-banner'); box.setAttribute('role', 'dialog');
    var ic = el('span', 'pp-push-ic'); ic.innerHTML = BELL;
    var tx = el('div', 'pp-push-tx');
    tx.appendChild(el('b', '', tr('pushAskTitle', 'Turn on notifications')));
    tx.appendChild(el('span', '', tr('pushAskBody', 'Get an alert for new messages, announcements and results.')));
    var yes = el('button', 'pp-push-yes', tr('pushAskYes', 'Turn on')); yes.type = 'button';
    var no = el('button', 'pp-push-no', '×'); no.type = 'button'; no.setAttribute('aria-label', tr('pushAskNo', 'Not now'));
    box.appendChild(ic); box.appendChild(tx); box.appendChild(yes); box.appendChild(no);
    function close() { if (box.parentNode) box.parentNode.removeChild(box); }
    yes.addEventListener('click', function () { close(); enable().then(wireSettings); });
    no.addEventListener('click', function () { lsSet('portalPush:askedAt', Date.now()); close(); });
    document.body.appendChild(box);
  }

  // ---------- the poll ----------
  function threadTitle(t, reg) {
    var who = t.type === 'admin' ? tr('schoolOffice', 'School Office') : (t.staffName || tr('teacher', 'Teacher'));
    var n = kids().length > 1 ? nameOf(reg) : '';
    return n ? who + ' · ' + n : who;
  }
  function notifyMessages(reg) {
    return quietly(function () { return API.messageThreads(reg); }).then(function (threads) {
      var unread = (threads || []).filter(function (t) { return t.unread > 0; })
        .sort(function (a, b) { return String(b.lastAt).localeCompare(String(a.lastAt)); });
      var t = unread[0];
      if (!t) return;
      var id = t.type === 'admin' ? 'admin' : t.staffId;
      show({ kind: 'message', title: threadTitle(t, reg), body: clip(t.lastBody, 140), tag: 'pp-msg-' + reg + '-' + id,
             url: 'parent-portal-chat.html?teacher=' + encodeURIComponent(id) + '&child=' + encodeURIComponent(reg) });
    }).catch(function () {
      show({ kind: 'message', title: tr('pushNewMessage', 'New message'), body: tr('pushNewMessageBody', 'You have a new message from school.'), url: 'parent-portal-messages.html', tag: 'pp-msg-' + reg });
    });
  }
  function notifyAnnouncements(jobs) {
    var seen = {}, found = [];
    return Promise.all(jobs.map(function (j) {
      return quietly(function () { return API.get('/children/' + encodeURIComponent(j.reg) + '/announcements'); }).then(function (list) {
        (list || []).forEach(function (a) { if (a.id > j.since && !seen[a.id]) { seen[a.id] = 1; found.push(a); } });
      }).catch(function () { /* generic alert below */ });
    })).then(function () {
      found.sort(function (a, b) { return a.id - b.id; });
      if (!found.length) {
        show({ kind: 'announcement', title: tr('notifAnnouncement', 'New announcement'), body: tr('pushNewAnnBody', 'The school posted a new announcement.'), url: 'parent-portal-announcement.html', tag: 'pp-ann' });
      } else if (found.length === 1 || (found.length <= MAX_SINGLE && document.visibilityState !== 'visible' && canSystem())) {
        // one banner can only show one item, so several at once are listed one by one only as system notifications
        found.forEach(function (a) {
          show({ kind: 'announcement', title: clip(a.title || tr('notifAnnouncement', 'New announcement'), 70), body: clip(a.body, 140),
                 url: 'parent-portal-announcement.html', tag: 'pp-ann-' + a.id });
        });
      } else {
        show({ kind: 'announcement', title: found.length + ' ' + tr('pushNewAnns', 'new announcements'), body: clip(found[found.length - 1].title, 100),
               url: 'parent-portal-announcement.html', tag: 'pp-ann-many' });
      }
    });
  }
  function handle(p) {
    var key = accountKey();
    if (!key || !p) return;
    var st = lsGet(key) || { ann: {}, unread: {} };
    st.ann = st.ann || {}; st.unread = st.unread || {};
    st.inId = st.inId || {};
    var annJobs = [], msgJobs = [];
    Object.keys(p.annByChild || {}).forEach(function (reg) {
      var cur = Number(p.annByChild[reg]) || 0, prev = st.ann[reg];
      if (prev != null && cur > prev) annJobs.push({ reg: reg, since: prev });
      st.ann[reg] = cur;
    });
    // A NEW incoming message is the newest school/teacher message id going up (the server sends inByChild).
    // Older servers only send the unread counter, so that is still used as a fallback.
    var haveIn = p.inByChild && typeof p.inByChild === 'object';
    Object.keys(p.byChild || {}).forEach(function (reg) {
      var cur = Number(p.byChild[reg]) || 0, prev = st.unread[reg];
      if (!haveIn && prev != null && cur > prev) msgJobs.push(reg);
      st.unread[reg] = cur;
    });
    if (haveIn) {
      Object.keys(p.inByChild).forEach(function (reg) {
        var curIn = Number(p.inByChild[reg]) || 0, prevIn = st.inId[reg];
        if (prevIn != null && curIn > prevIn && (Number((p.byChild || {})[reg]) || 0) > 0) msgJobs.push(reg);
        st.inId[reg] = curIn;
      });
    }
    lsSet(key, st);                      // first run only records the baseline - no flood of old items
    var jobs = [];
    if (annJobs.length) jobs.push(notifyAnnouncements(annJobs));
    msgJobs.forEach(function (reg) { jobs.push(notifyMessages(reg)); });
    return Promise.all(jobs);
  }
  function broadcast(p) {
    lastPulse = p;
    try { global.dispatchEvent(new CustomEvent('portal-pulse', { detail: p })); } catch (e) { /* old browser */ }
  }
  function poll() {
    if (!token() || !kids().length) return Promise.resolve();
    if (polling) return Promise.resolve();            // never overlap two requests
    polling = true;
    return quietly(function () { return API.pulse(); }).then(function (p) {
      failStreak = 0;
      broadcast(p);                                   // every open page updates its badges and lists
      if (!takeLease()) return;                       // another tab owns the alerts
      return Promise.resolve(handle(p)).then(function () { setTimeout(maybeAskBanner, 1500); });
    }).catch(function () { failStreak = Math.min(failStreak + 1, 4); /* offline or busy: back off, retry later */ })
      .then(function () { polling = false; });
  }
  function schedule() {
    var wait = document.visibilityState === 'visible' ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;
    wait = wait * Math.pow(2, failStreak);            // 8s, 16s, 32s ... up to 16x after repeated failures
    setTimeout(function () { poll().then(schedule); }, wait);
  }

  // ---------- Settings page card (optional markup: #pushStatus + #pushBtn) ----------
  function wireSettings() {
    var status = document.getElementById('pushStatus'), btn = document.getElementById('pushBtn');
    if (!status || !btn) return;
    var p = permission();
    btn.hidden = false; btn.disabled = false;
    if (p === 'unsupported') {
      status.textContent = tr('pushUnsupported', 'This browser cannot show notifications. You will still see new items inside the portal.');
      btn.hidden = true;
    } else if (p === 'granted') {
      status.textContent = tr('pushGranted', 'Notifications are on for this device.');
      btn.textContent = tr('pushTest', 'Send a test notification');
    } else if (p === 'denied') {
      status.textContent = tr('pushDenied', 'Notifications are blocked. Allow them for this site in your browser settings, then reload.');
      btn.hidden = true;
    } else {
      status.textContent = tr('pushOff', 'Get an alert when the school sends a message, an announcement or a result.');
      btn.textContent = tr('pushAskYes', 'Turn on');
    }
    btn.onclick = function () {
      if (permission() === 'granted') {
        system({ title: tr('pushTestTitle', 'Test notification'), body: tr('pushTestBody', 'Notifications are working on this device.'), url: 'parent-portal-index.html', tag: 'pp-test' });
      } else {
        enable().then(wireSettings);
      }
    };
  }

  // ---------- boot ----------
  function boot() {
    if (!token()) return;
    if (canSystem()) registerSW();
    wireSettings();
    setTimeout(function () { poll().then(schedule); }, 500);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { flushQueue(); poll(); }
    });
    global.addEventListener('online', poll);
    global.addEventListener('pagehide', releaseLease);
  }

  global.PortalPush = { enable: enable, permission: permission, poll: poll, last: function () { return lastPulse; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
