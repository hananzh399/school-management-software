/*!
 * app-bars.js - colours the phone's STATUS BAR (top) and NAVIGATION BAR (bottom) after login.
 *
 * Android app only (does nothing in a browser). Loaded on every logged-in page:
 *   - teacher portal : status bar = the teacher header colour,  navigation bar = white
 *   - parent portal  : status bar = white,                      navigation bar = white
 *   - admin pages    : both bars follow the page's own theme colour (dark navy, or light in the light theme)
 *
 * The login screen and splash keep their own dark-green bars (native-ui.js); this file takes over from the
 * moment a user lands on a logged-in page, so the bars change colour right after login.
 *
 * It uses SoftSchoolBars.setBarsSplit(...) from MainActivity.java (two colours). If an older app without that
 * method is installed it falls back to the single-colour SoftSchoolBars.setBars(...) using the status-bar colour.
 *
 * To change a colour, edit COLORS below. Icon colour is chosen automatically: dark icons on a light bar,
 * white icons on a dark bar.
 */
(function () {
  'use strict';
  if (window.__appBarsLoaded) return;
  window.__appBarsLoaded = true;

  var C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return;   // normal browser: nothing to do

  // ───────────── the software colours (edit here) ─────────────
  var COLORS = {
    teacher: { status: '#0F423D', nav: '#FFFFFF' },   // header colour on top, white bottom bar
    parent:  { status: '#FFFFFF', nav: '#FFFFFF' }    // white top and bottom
    // admin pages: not listed on purpose = follow the page theme (they have a dark and a light theme)
  };
  var ADMIN_FALLBACK_DARK = '#0b1120';   // used only if the page colour cannot be read
  var ADMIN_FALLBACK_LIGHT = '#ffffff';

  var root = document.documentElement;
  var P = C.Plugins || {};
  var last = '';

  // ───────────── colour helpers ─────────────
  function hex2(n) { return ('0' + Math.round(n).toString(16)).slice(-2); }
  function toHex(c) { return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b); }

  function parseColor(str) {
    str = String(str == null ? '' : str).trim();
    if (!str) return null;
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return { r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16), b: parseInt(h.substr(4, 2), 16), a: 1 };
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(str);
    if (m) {
      var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat);
      if (p.length < 3 || isNaN(p[0]) || isNaN(p[1]) || isNaN(p[2])) return null;
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !isNaN(p[3]) ? p[3] : 1 };
    }
    return null;
  }

  function isDark(c) { return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b < 140; }

  // ───────────── which portal is this page? ─────────────
  function portal() {
    var p = (location.pathname || '');
    if (/(^|\/)(index\.html)?$/.test(p)) return 'login';          // login page: native-ui.js owns the bars
    if (/\/parent-portal\//i.test(p)) return 'parent';
    if (/teacher-portal/i.test(p)) return 'teacher';
    return 'admin';
  }

  // Admin pages: use the theme's own background variable (it changes with the light/dark toggle),
  // then the real background colour, then a safe fallback.
  function adminColor() {
    var cs;
    try { cs = getComputedStyle(root); } catch (e) { cs = null; }
    if (cs && typeof cs.getPropertyValue === 'function') {
      var names = ['--bg-primary', '--bg', '--bg-body', '--background'];
      for (var i = 0; i < names.length; i++) {
        var c = parseColor(cs.getPropertyValue(names[i]));
        if (c && c.a > 0.5) return c;
      }
    }
    var els = [document.body, root];
    for (var j = 0; j < els.length; j++) {
      if (!els[j]) continue;
      var bc = parseColor(getComputedStyle(els[j]).backgroundColor);
      if (bc && bc.a > 0.5) return bc;
    }
    var light = root.getAttribute('data-theme') === 'light' ||
                (document.body && document.body.getAttribute('data-theme') === 'light');
    return parseColor(light ? ADMIN_FALLBACK_LIGHT : ADMIN_FALLBACK_DARK);
  }

  // → { status: colour, nav: colour } for this page, or null (login page)
  function wanted() {
    var which = portal();
    if (which === 'login') return null;
    var fixed = COLORS[which];
    if (fixed) {
      var s = parseColor(fixed.status), n = parseColor(fixed.nav);
      if (s && n) return { status: s, nav: n };
    }
    var a = adminColor();
    return { status: a, nav: a };
  }

  // ───────────── apply ─────────────
  function safe(fn) { try { var r = fn(); if (r && r.catch) r.catch(function () {}); } catch (e) { /* ignore */ } }

  function apply(force) {
    var w = wanted();
    if (!w) return;
    var sHex = toHex(w.status), nHex = toHex(w.nav);
    var key = sHex + '|' + nHex;
    if (key === last && !force) return;
    last = key;
    var sLight = !isDark(w.status), nLight = !isDark(w.nav);    // "light bar" => dark icons

    var bridge = window.SoftSchoolBars;
    if (bridge && typeof bridge.setBarsSplit === 'function') {
      try { bridge.setBarsSplit(sHex, sLight, nHex, nLight); } catch (e) { /* ignore */ }
      return;
    }
    if (bridge && typeof bridge.setBars === 'function') {
      // older app build without the two-colour method: one colour for both bars (the top one wins)
      try { bridge.setBars(sHex, sLight); } catch (e) { /* ignore */ }
      return;
    }
    // No native bridge at all: the standard Capacitor plugins, if installed.
    if (P.StatusBar) {
      safe(function () { return P.StatusBar.setBackgroundColor({ color: sHex }); });
      safe(function () { return P.StatusBar.setStyle({ style: sLight ? 'LIGHT' : 'DARK' }); });
    }
    if (P.NavigationBar && P.NavigationBar.setNavigationBarColor) {
      safe(function () { return P.NavigationBar.setNavigationBarColor({ color: nHex, darkButtons: nLight }); });
    }
  }

  // Right now (teacher / parent colours are fixed, so there is no flash of the wrong colour) ...
  apply(false);

  // ... and keep it right.
  var pending = {};
  function later(ms) {
    if (pending[ms]) return;
    pending[ms] = setTimeout(function () { pending[ms] = null; apply(false); }, ms);
  }
  function soon() { later(20); later(200); later(800); }

  function start() {
    soon();
    if (portal() === 'admin') {
      // admin pages can switch light/dark theme: watch for it
      try {
        var obs = new MutationObserver(soon);
        var opts = { attributes: true, attributeFilter: ['class', 'data-theme', 'data-bs-theme', 'style'] };
        obs.observe(root, opts);
        if (document.body) obs.observe(document.body, opts);
      } catch (e) { /* ignore */ }
      document.addEventListener('click', function () { later(80); later(500); }, true);
      setInterval(function () { apply(false); }, 2000);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  window.addEventListener('load', soon);
  // coming back to the app from another app / the lock screen: set it again to be sure
  document.addEventListener('visibilitychange', function () { if (!document.hidden) apply(true); });
  window.addEventListener('pageshow', function () { apply(true); });
})();
