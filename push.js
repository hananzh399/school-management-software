/*!
 * push.js (v2) - Firebase push notifications for the Soft School Capacitor (Android) app.
 *
 * SELF-CONFIGURING. Load it on every logged-in page and it does everything by itself:
 *   - parent-portal/*.html   -> parent  (token: sessionStorage 'softschool_parent_token')
 *   - teacher-portal.html    -> teacher (token: localStorage   'softschool_teacher' .token)
 *   - every other admin page -> admin   (token: sessionStorage 'softschool_api_token')
 *
 * It registers this phone with the server ONCE per login, shows a banner when a notification arrives
 * while the app is open (staff pages only - the parent portal already has its own banner), opens the right
 * screen when a notification is tapped, and removes the phone from the server at logout.
 *
 * In a normal browser it does nothing. Works without a bundler (uses window.Capacitor.Plugins).
 *
 * Manual use (optional): set window.SCHOOL_PUSH_MANUAL = true before loading, then call SchoolPush.init({...}).
 * Public API: SchoolPush.init(opts), SchoolPush.logout()
 */
(function (global) {
  'use strict';

  // Must be identical to PUSH_ANDROID_CHANNEL_ID on the server (default 'school_alerts').
  var CHANNEL_ID = 'school_alerts';
  var STORE_KEY = 'sp_push_token';   // localStorage: last FCM token of this phone
  var OK_KEY = 'sp_push_ok';         // sessionStorage: "this phone is registered for the login ending in ..."

  var cfg = null;
  var P = null;                      // the PushNotifications plugin
  var listenersAdded = false;
  var pendingToken = null;           // token waiting to be sent (offline / session not ready)

  // ───────────── small helpers ─────────────
  function capacitor() { return global.Capacitor; }
  function isNative() {
    var c = capacitor();
    return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
  }
  function isAndroid() {
    var c = capacitor();
    return !!(c && typeof c.getPlatform === 'function' && c.getPlatform() === 'android');
  }
  function findPlugin(opts) {
    if (opts && opts.plugin) return opts.plugin;
    var c = capacitor();
    return c && c.Plugins && c.Plugins.PushNotifications ? c.Plugins.PushNotifications : null;
  }
  function ssGet(k) { try { return global.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { global.sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function ssDel(k) { try { global.sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function lsGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { global.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function lsDel(k) { try { global.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function lsJson(k) { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } }
  function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
  function tail(t) { return t ? String(t).slice(-16) : ''; }

  function authToken() {
    try { return cfg && cfg.getAuthToken ? cfg.getAuthToken() : null; } catch (e) { return null; }
  }
  function url(path) { return String(cfg.apiBase || '').replace(/\/+$/, '') + path; }
  function paths() {
    return cfg.role === 'parent'
      ? { register: '/api/parent/push/register', unregister: '/api/parent/push/unregister' }
      : { register: '/api/push/register', unregister: '/api/push/unregister' };
  }

  // keepalive lets the request finish even if the page is being closed (logout navigates away at once).
  function post(path, token, keepalive) {
    var auth = authToken();
    if (!auth) return Promise.reject(new Error('not logged in'));
    var init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth },
      body: JSON.stringify({ token: token, platform: 'android' })
    };
    if (keepalive) init.keepalive = true;
    return fetch(url(path), init).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    });
  }

  // Tell the server "this phone belongs to the logged-in user". Retried when the network comes back.
  function sendToServer(token) {
    pendingToken = token;
    lsSet(STORE_KEY, token);
    var mark = tail(authToken());
    return post(paths().register, token, false).then(function () {
      pendingToken = null;
      if (mark) ssSet(OK_KEY, mark);
    }).catch(function () {
      /* offline, or the session is not ready (e.g. parent must still change the default password):
         pendingToken stays set and is retried on 'online' and on the next page load */
    });
  }

  if (global.addEventListener) {
    global.addEventListener('online', function () {
      if (cfg && pendingToken && authToken()) sendToServer(pendingToken);
    });
  }

  // ───────────── role detection (self-configuration) ─────────────
  function originOf() {
    var o = global.SOFTSCHOOL_API_ORIGIN;
    return (typeof o === 'string' && o.trim() ? o.trim() : 'https://thesoftschool.com').replace(/\/+$/, '');
  }

  function whenReady(fn) {           // the teacher portal builds its screen a moment after load
    var tries = 0;
    (function again() {
      var done = false;
      try { done = fn(); } catch (e) { done = true; }
      if (!done && ++tries < 24) setTimeout(again, 250);
    })();
  }

  function goTo(u) { try { global.location.href = u; } catch (e) { /* ignore */ } }

  function openParent(d) {
    d = d || {};
    if (d.type === 'announcement') return goTo('parent-portal-announcement.html');
    if (d.type === 'message') {
      if (d.channel === 'parent_teacher' && d.staffId && d.regNo) {
        return goTo('parent-portal-chat.html?teacher=' + enc(d.staffId) + '&child=' + enc(d.regNo));
      }
      return goTo('parent-portal-messages.html');
    }
  }
  function openTeacher() {
    whenReady(function () {
      var t = global.document && global.document.querySelector('.tab[data-tab="inbox"]');
      if (t) { t.click(); return true; }
      return false;
    });
  }
  function openAdmin() { goTo('announcements.html'); }

  function autoConfig() {
    var path = (global.location && global.location.pathname) || '';
    var base = originOf();
    if (/\/parent-portal\//.test(path)) {
      return {
        apiBase: base, role: 'parent',
        getAuthToken: function () { return ssGet('softschool_parent_token'); },
        onForeground: function () { /* the parent portal shows its own in-app banner */ },
        onOpen: openParent
      };
    }
    if (/teacher-portal\.html/.test(path)) {
      return {
        apiBase: base, role: 'staff',
        getAuthToken: function () { var s = lsJson('softschool_teacher'); return s && s.token ? s.token : null; },
        onOpen: openTeacher
      };
    }
    return {
      apiBase: base, role: 'staff',
      getAuthToken: function () { return ssGet('softschool_api_token'); },
      onOpen: openAdmin
    };
  }

  // ───────────── in-app banner (app is open) ─────────────
  function toast(n) {
    try {
      var doc = global.document;
      var el = doc.createElement('div');
      var title = doc.createElement('strong');
      var body = doc.createElement('div');
      // textContent (never innerHTML): the text can come from another user.
      title.textContent = (n && n.title) || 'New notification';
      body.textContent = (n && n.body) || '';
      el.appendChild(title);
      el.appendChild(body);
      el.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 12px);' +
        'z-index:2147483647;background:#1f2937;color:#fff;padding:12px 14px;border-radius:10px;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.35);font:14px/1.35 system-ui,sans-serif;cursor:pointer;' +
        'max-height:30vh;overflow:hidden';
      el.onclick = function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        if (cfg && cfg.onOpen) cfg.onOpen((n && n.data) || {}, n);
      };
      doc.body.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 6000);
    } catch (e) { /* never break the page because of a banner */ }
  }

  function addListeners() {
    if (listenersAdded) return;
    listenersAdded = true;

    // First registration, and whenever Google refreshes the token.
    P.addListener('registration', function (t) {
      if (t && t.value) sendToServer(t.value);
    });
    P.addListener('registrationError', function (err) {
      console.warn('[push] registration error', err);
    });
    // App is open and in front.
    P.addListener('pushNotificationReceived', function (n) {
      try { global.dispatchEvent(new CustomEvent('school-push', { detail: n })); } catch (e) { /* ignore */ }
      if (cfg && cfg.onForeground) cfg.onForeground(n); else toast(n);
    });
    // User tapped a notification (app was closed, in background, or open).
    P.addListener('pushNotificationActionPerformed', function (action) {
      var n = (action && action.notification) || {};
      if (cfg && cfg.onOpen) cfg.onOpen(n.data || {}, n);
    });
  }

  // ───────────── public: init ─────────────
  function init(opts) {
    cfg = opts || autoConfig();
    if (!isNative()) return Promise.resolve(false);            // normal browser: nothing to do
    P = findPlugin(cfg);
    if (!P) {
      console.warn('[push] @capacitor/push-notifications is not installed (npm i + npx cap sync android).');
      return Promise.resolve(false);
    }

    var auth = authToken();
    // Not logged in (e.g. the login screen): add NO listeners, so a tapped notification stays queued
    // in the plugin until the page after login can actually open the right screen.
    if (!auth) return Promise.resolve(false);

    addListeners();                                            // listeners first, so a tap that launched the app is not missed

    // Already registered for THIS login in this app session: nothing more to do on later pages.
    if (ssGet(OK_KEY) === tail(auth)) return Promise.resolve(true);

    var known = lsGet(STORE_KEY);                              // token from an earlier run: send it under this login right away
    if (known) sendToServer(known);

    var channel = Promise.resolve();
    if (isAndroid() && typeof P.createChannel === 'function') {
      // Android 8+: the channel decides sound/vibration. Must exist BEFORE the first notification arrives.
      channel = P.createChannel({
        id: CHANNEL_ID,
        name: 'School alerts',
        description: 'Announcements and messages',
        importance: 4,          // high: sound + heads-up banner
        visibility: 1,          // public
        vibration: true
      }).catch(function () { /* channel already exists */ });
    }

    return channel
      .then(function () { return P.checkPermissions(); })
      .then(function (perm) {
        if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') return P.requestPermissions();
        return perm;
      })
      .then(function (perm) {
        if (perm.receive !== 'granted') return false;           // user said no - nothing more we can do
        return P.register().then(function () { return true; });
      })
      .catch(function (e) {
        console.warn('[push] init failed', e);
        return false;
      });
  }

  // ───────────── public: logout ─────────────
  // Call right BEFORE the session is cleared. The unregister request is built synchronously (so it carries
  // the still-valid login) and sent with keepalive, so it completes even though the page leaves immediately.
  function logout() {
    if (!isNative()) return Promise.resolve();
    if (!cfg) cfg = autoConfig();
    if (!P) P = findPlugin(cfg);
    var token = lsGet(STORE_KEY);
    pendingToken = null;
    ssDel(OK_KEY);
    lsDel(STORE_KEY);
    try { if (P && typeof P.removeAllDeliveredNotifications === 'function') P.removeAllDeliveredNotifications(); } catch (e) { /* ignore */ }
    if (!token) return Promise.resolve();
    return post(paths().unregister, token, true).catch(function () { /* best effort - never block logout */ });
  }

  global.SchoolPush = { init: init, logout: logout };

  // ───────────── automatic start ─────────────
  function autoBoot() {
    if (global.SCHOOL_PUSH_MANUAL) return;
    try { init(autoConfig()); } catch (e) { console.warn('[push] auto start failed', e); }
  }
  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', autoBoot);
    else autoBoot();
  }
})(window);
