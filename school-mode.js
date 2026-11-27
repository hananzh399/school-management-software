/*!
 * school-mode.js - which kind of school is this? (Step 2 of the offline / hybrid app)
 *
 *   'online'  : normal school. Everything lives on the server.                    (offlineApp = false)
 *   'offline' : offline only. Data stays on the phone and is NEVER uploaded.      (offlineApp = true,  databaseSupported = false)
 *   'hybrid'  : data lives on the phone AND is uploaded when internet is back.    (offlineApp = true,  databaseSupported = true)
 *
 * The super admin sets these two flags per school. The server sends them with the school record, and
 * access-control.js already refreshes that record from the server on every admin page, so this file only
 * has to READ the session. Load it on the admin pages, right after access-control.js.
 *
 * What it gives the rest of the app:
 *   SoftSchoolMode.get()            -> 'online' | 'offline' | 'hybrid' | null (not logged in)
 *   SoftSchoolMode.isOnlineOnly()   SoftSchoolMode.isOfflineOnly()   SoftSchoolMode.isHybrid()
 *   SoftSchoolMode.usesLocalDb()    -> true for offline + hybrid  (data is read/written on the phone)
 *   SoftSchoolMode.syncsToServer()  -> true for hybrid only       (local records are uploaded when online)
 *   SoftSchoolMode.info()           -> { mode, lastVerifiedAt, daysSinceVerified, daysLeft }
 *   SoftSchoolMode.verifyNow()      -> Promise 'verified' | 'offline' | 'blocked'
 *   event 'softschool:mode-changed' { from, to }   (the super admin switched this school's mode)
 *
 * SAFETY NET: an offline / hybrid school has to reach the server at least once every MAX_OFFLINE_DAYS,
 * otherwise a blocked or expired school could keep working forever without ever connecting. After that long the
 * app shows a "connect to the internet" screen until one check succeeds. Set MAX_OFFLINE_DAYS = 0 to switch
 * this off. Online schools are never affected (they need the server anyway).
 */
(function () {
  'use strict';
  if (window.SoftSchoolMode) return;

  var MAX_OFFLINE_DAYS = 30;                 // <- change here (0 = no limit)
  var STATE_KEY = 'softschool_mode_state';   // { schoolId, mode, lastVerifiedAt }
  var SESSION_KEY = 'softschool_session';    // written by access-control.js: { schoolId, school, at }
  var DAY = 86400000;
  var CHECK_EVERY_MS = 60 * 60 * 1000;       // re-check the limit hourly while the app stays open

  // ───────────── storage helpers ─────────────
  function readJson(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  function session() { var s = readJson(SESSION_KEY); return s && s.school && s.school.schoolId ? s : null; }
  function school() { var s = session(); return s ? s.school : null; }

  function modeOf(sc) {
    if (!sc) return null;
    if (!sc.offlineApp) return 'online';
    if (sc.databaseSupported) return nativeApp() ? 'hybrid' : 'online';   // a website has no phone database: use the server
    return 'offline';
  }
  function nativeApp() { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) || /^(localhost|127\.0\.0\.1)$/.test(location.hostname); } catch (e) { return false; } }

  // The remembered state belongs to ONE school; a different school logging in starts fresh.
  function loadState(sc) {
    var st = readJson(STATE_KEY);
    if (!st || st.schoolId !== sc.schoolId) {
      var s = session();
      st = { schoolId: sc.schoolId, mode: modeOf(sc), lastVerifiedAt: (s && s.at) || Date.now() };
    }
    if (!st.lastVerifiedAt) { var s2 = session(); st.lastVerifiedAt = (s2 && s2.at) || Date.now(); }
    return st;
  }

  function fire(name, detail) {
    setTimeout(function () {                 // after the current handlers, so late listeners still hear it
      try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* ignore */ }
    }, 0);
  }

  // Recompute the mode from the session, remember it, and announce a change.
  function sync() {
    var sc = school();
    if (!sc) return null;
    var st = loadState(sc);
    var now = modeOf(sc);
    var from = st.mode;
    st.mode = now;
    writeJson(STATE_KEY, st);
    if (from !== now) fire('softschool:mode-changed', { from: from, to: now });
    return st;
  }

  // ───────────── "last time the server confirmed this school" ─────────────
  function markVerified() {
    var sc = school();
    if (!sc) return;
    var st = loadState(sc);
    st.lastVerifiedAt = Date.now();
    writeJson(STATE_KEY, st);
    removeOverlay();
  }

  function isLate(st) {
    if (!MAX_OFFLINE_DAYS || !st || st.mode === 'online') return false;
    var now = Date.now();
    // too long without a check, OR the phone's clock was moved backwards to dodge the limit
    return now - st.lastVerifiedAt > MAX_OFFLINE_DAYS * DAY || now < st.lastVerifiedAt - 3600000;
  }

  function info() {
    var sc = school();
    if (!sc) return null;
    var st = loadState(sc);
    var days = Math.max(0, Math.floor((Date.now() - st.lastVerifiedAt) / DAY));
    return {
      mode: modeOf(sc),
      lastVerifiedAt: st.lastVerifiedAt,
      daysSinceVerified: days,
      daysLeft: MAX_OFFLINE_DAYS && modeOf(sc) !== 'online' ? Math.max(0, MAX_OFFLINE_DAYS - days) : null
    };
  }

  // Ask the server right now. access-control.js does the real work and fires 'softschool:session-updated'
  // when the answer is good; if the school is blocked it logs out and we send the user to the login page.
  function verifyNow() {
    return new Promise(function (resolve) {
      var done = false, timer = null;
      function finish(v) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('softschool:session-updated', onGood);
        resolve(v);
      }
      function onGood() { finish('verified'); }
      window.addEventListener('softschool:session-updated', onGood);
      timer = setTimeout(function () { finish('offline'); }, 8000);
      try {
        var A = window.SoftSchoolAdmin;
        if (A && typeof A.revalidateSession === 'function') {
          A.revalidateSession(function () { finish('blocked'); window.location.href = 'index.html?blocked=1'; });
        } else finish('offline');
      } catch (e) { finish('offline'); }
    });
  }

  // ───────────── the "connect to the internet" screen ─────────────
  var overlay = null, statusEl = null, bodyEl = null;

  function showOverlay(days) {
    var doc = document;
    if (!doc.body) return;
    var text = 'This school has not been checked with the server for ' + days + ' day' + (days === 1 ? '' : 's') +
      '. Connect to the internet and tap "Check again" to continue.';
    if (overlay) { if (bodyEl) bodyEl.textContent = text; return; }
    overlay = doc.createElement('div');
    overlay.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:28px;text-align:center;' +
      'background:#0b1120;color:#fff;font:16px/1.45 system-ui,sans-serif';
    var h = doc.createElement('h2');
    h.textContent = 'Verification needed';
    h.style.cssText = 'margin:0;font-size:22px';
    bodyEl = doc.createElement('p');
    bodyEl.textContent = text;
    bodyEl.style.cssText = 'margin:0;max-width:420px;opacity:.9';
    var btn = doc.createElement('button');
    btn.textContent = 'Check again';
    btn.style.cssText = 'padding:12px 26px;border:0;border-radius:10px;background:#1E8F86;color:#fff;font:600 16px system-ui,sans-serif';
    statusEl = doc.createElement('p');
    statusEl.style.cssText = 'margin:0;min-height:1.4em;font-size:14px;opacity:.8';
    btn.onclick = function () {
      statusEl.textContent = 'Checking...';
      verifyNow().then(function (r) {
        if (r === 'verified') return;                               // markVerified() removes the screen
        if (r === 'offline') statusEl.textContent = 'Still no connection to the server. Please try again.';
      });
    };
    overlay.appendChild(h); overlay.appendChild(bodyEl); overlay.appendChild(btn); overlay.appendChild(statusEl);
    doc.body.appendChild(overlay);
  }

  function removeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null; statusEl = null; bodyEl = null;
  }

  function enforce() {
    var st = sync();
    if (!st) { removeOverlay(); return; }
    if (isLate(st)) showOverlay(Math.max(0, Math.floor((Date.now() - st.lastVerifiedAt) / DAY)));
    else removeOverlay();
  }

  // ───────────── public API ─────────────
  function get() { return modeOf(school()); }
  window.SoftSchoolMode = {
    get: get,
    isOnlineOnly: function () { return get() === 'online'; },
    isOfflineOnly: function () { return get() === 'offline'; },
    isHybrid: function () { return get() === 'hybrid'; },
    usesLocalDb: function () { var m = get(); return m === 'offline' || m === 'hybrid'; },
    syncsToServer: function () { return get() === 'hybrid'; },
    info: info,
    verifyNow: verifyNow
  };

  // ───────────── start ─────────────
  // access-control.js fires this after a successful check with the server (school is still valid).
  window.addEventListener('softschool:session-updated', function () { sync(); markVerified(); });

  function start() {
    enforce();
    setInterval(enforce, CHECK_EVERY_MS);
    // Whenever internet is on, ask the server (every ~2 minutes and when internet returns) whether this school was blocked,
    // switched to offline-only, or edited by the super admin. access-control.js does the check, saves the new school details
    // and logs out a blocked school. A school that became OFFLINE-ONLY is logged out of the website (the phone app is fine).
    function isApp() { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) || /^(localhost|127\.0\.0\.1)$/.test(location.hostname); } catch (e) { return false; } }
    function kickOut(why) {
      try { var A = window.SoftSchoolAdmin; if (A && A.clearSession) A.clearSession(); } catch (e) { /* ignore */ }
      try { localStorage.removeItem('softschool_remember'); localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem('softschool_api_token'); } catch (e) { /* ignore */ }
      window.location.href = 'index.html?' + (why === 'offline_only' ? 'offline_only=1' : 'blocked=1');
    }
    try {                                              // any server answer "blocked" / "offline_only" ends the session at once
      var nativeFetch = window.fetch;
      if (nativeFetch) window.fetch = function () {
        var p = nativeFetch.apply(this, arguments);
        try { p.then(function (res) { if (res && res.status === 403) res.clone().json().then(function (j) { if (j && (j.error === 'blocked' || (j.error === 'offline_only' && !isApp()))) kickOut(j.error); }).catch(function () {}); }).catch(function () {}); } catch (e) { /* ignore */ }
        return p;
      };
    } catch (e) { /* ignore */ }
    function recheck() {
      if (!school() || document.hidden || navigator.onLine === false) return;
      var before = JSON.stringify(school() || {});
      verifyNow().then(function (r) {
        if (r !== 'verified') return;
        if (get() === 'offline' && !isApp()) { kickOut('offline_only'); return; }
        if (JSON.stringify(school() || {}) !== before) { try { window.dispatchEvent(new CustomEvent('softschool:data-changed', { detail: { source: 'school' } })); } catch (e) { /* ignore */ } }
      });
    }
    setInterval(recheck, 2 * 60 * 1000);
    window.addEventListener('online', function () { setTimeout(recheck, 1500); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(recheck, 1000); });
    setTimeout(recheck, 8000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) enforce(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

/* load the forced-update check (Android app only) */
(function () { try { if (window.SoftSchoolBg && !window.__ssAppUpdate) { var s = document.createElement('script'); s.src = 'app-update.js'; (document.head || document.documentElement).appendChild(s); } } catch (e) { /* ignore */ } })();

/* event image after the splash (once per visit) */
(function () { try { if (!window.__ssEventPopup) { var s = document.createElement('script'); s.src = 'event-popup.js'; (document.head || document.documentElement).appendChild(s); } } catch (e) { /* ignore */ } })();
