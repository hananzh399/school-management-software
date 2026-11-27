/*! app-update.js - forced update screen for the Android app.
 *  The app asks the server for the newest version when it opens (after the splash), when it comes back to the front,
 *  and every 10 minutes. If the super admin turned "forced update" on and this phone has an older version, a full-screen
 *  "Update required" box blocks the app until the new version is installed. The last answer is remembered, so a phone
 *  that is offline is still blocked once it knows an update is required. */
(function () {
  'use strict';
  if (window.__ssAppUpdate) return; window.__ssAppUpdate = true;
  var bg = window.SoftSchoolBg;
  if (!bg || typeof bg.appVersion !== 'function') return;                       // website or old app: nothing to do
  var KEY = 'softschool_force_update', URL_FALLBACK = 'https://softschoolmanagement.github.io/Android-Download/';
  var installed = ''; try { installed = String(bg.appVersion() || ''); } catch (e) { return; }
  if (!installed) return;

  function older(a, b) {                                   // is version a older than b?
    var x = String(a).split('.'), y = String(b).split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var p = parseInt(x[i] || '0', 10), q = parseInt(y[i] || '0', 10);
      if (isNaN(p) || isNaN(q)) return String(a) !== String(b);
      if (p !== q) return p < q;
    }
    return false;
  }
  function saved() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  var box = null;
  function show(url) {
    if (box) return;
    box = document.createElement('div');
    box.id = 'ssUpdateBox';                                  // listed in index.css so the app-mode login screen does not hide it
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0b1120;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:28px;text-align:center;font:16px/1.45 system-ui,sans-serif';
    box.innerHTML = '<h2 style="margin:0;font-size:22px;color:#fff">Update required</h2><p style="margin:0;max-width:360px;opacity:.9">This version of Soft School (' + installed + ') is outdated. Please download the new version to continue.</p><button id="ssUpdBtn" style="padding:13px 30px;border:0;border-radius:10px;background:#1E8F86;color:#fff;font:600 16px system-ui,sans-serif">Update</button>';
    document.body.appendChild(box);
    box.querySelector('#ssUpdBtn').onclick = function () {
      try { if (bg.openUrl) { bg.openUrl(url || URL_FALLBACK); return; } } catch (e) { /* fall through */ }
      window.location.href = url || URL_FALLBACK;
    };
  }
  function apply(info) {
    if (info && info.forceUpdate && info.version && older(installed, info.version)) show(info.url);
    else if (box) { box.remove(); box = null; }
  }
  async function check() {
    var s = saved(); if (s) apply(s);                                           // known requirement applies even without internet
    if (navigator.onLine === false) return;
    try {
      var c = new AbortController(), t = setTimeout(function () { c.abort(); }, 8000);
      var r = await fetch((window.SOFTSCHOOL_API_BASE || 'https://thesoftschool.com') + '/api/app/version', { signal: c.signal }); clearTimeout(t);
      if (!r.ok) return;
      var j = await r.json();
      try { localStorage.setItem(KEY, JSON.stringify(j)); } catch (e) { /* ignore */ }
      apply(j);
    } catch (e) { /* no answer: try again later */ }
  }
  function start() { check(); setInterval(check, 10 * 60 * 1000); document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); }); }
  var began = false;
  function go() { if (began) return; began = true; if (document.body) start(); else document.addEventListener('DOMContentLoaded', start); }
  // after the splash: wait for it when it is playing
  if (document.documentElement.classList.contains('splash-on') && !window.__splashDone) {
    document.addEventListener('splash:done', function () { setTimeout(go, 200); }, { once: true });
    setTimeout(go, 6000);
  } else go();
})();
