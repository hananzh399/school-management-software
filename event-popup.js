/*! event-popup.js - shows the super admin's event image once per visit, right after the splash screen (website + Android app).
 *  Has a Skip button (also: tap outside / Escape). Nothing is shown when the super admin has no image set. */
(function () {
  'use strict';
  if (window.__ssEventPopup) return; window.__ssEventPopup = true;
  var SHOWN = 'softschool_event_shown';
  var base = window.SOFTSCHOOL_API_BASE || 'https://thesoftschool.com';
  var TOKEN = '1'; try { if (window.SoftSchoolBg && typeof window.SoftSchoolBg.launchId === 'function') TOKEN = String(window.SoftSchoolBg.launchId()); } catch (e) { /* ignore */ }   // changes every time the app is opened
  var skip = false;                                           // already shown in this visit: do not show again (the app can ask again when it comes back to the front)
  try { if (sessionStorage.getItem(SHOWN) === TOKEN) { window.__eventPending = false; skip = true; } } catch (e) { /* ignore */ }
  if (!skip) window.__eventPending = true;
  function done() { window.__eventShowing = false; window.__eventPending = false; }

  function show(src, id) {
    var o = document.createElement('div');
    o.style.cssText = 'position:fixed !important;inset:0 !important;z-index:2147483600 !important;display:flex !important;visibility:visible !important;pointer-events:auto !important;align-items:center;justify-content:center;padding:18px;background:rgba(8,15,30,.78);opacity:0;transition:opacity .35s ease';   /* !important: the app's login screen hides other page parts */
    o.innerHTML = '<div style="position:relative;max-width:min(94vw,720px);max-height:92vh;display:flex;flex-direction:column;align-items:center;gap:12px">' +
      '<img alt="" style="max-width:100%;max-height:78vh;object-fit:contain;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.5);background:#fff;transform:scale(.96);transition:transform .35s ease">' +
      '<button type="button" style="padding:11px 34px;border:0;border-radius:999px;background:#fff;color:#0b1120;font:600 15px system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.35);cursor:pointer">Skip</button></div>';
    var img = o.querySelector('img'); img.src = src;
    var closed = false;
    function close() {
      if (closed) return; closed = true;
      o.style.opacity = '0';
      setTimeout(function () { o.remove(); done(); }, 360);
      document.removeEventListener('keydown', key);
    }
    function key(e) { if (e.key === 'Escape') close(); }
    o.querySelector('button').onclick = close;
    o.addEventListener('click', function (e) { if (e.target === o) close(); });
    document.addEventListener('keydown', key);
    (document.documentElement || document.body).appendChild(o);   // on <html>, outside <body>: rules that hide the body's other children cannot reach it
    requestAnimationFrame(function () { o.style.opacity = '1'; img.style.transform = 'scale(1)'; });
    window.__eventShowing = true;
    try { sessionStorage.setItem(SHOWN, TOKEN); } catch (e) { /* ignore */ }
  }

  /* The picture is fetched and decoded WHILE the splash is playing, so it can pop up the moment the splash ends.
     It is turned into a data: address (allowed by the app's page rules, unlike blob:) and, if the server cannot be asked
     for its details, the picture is tried directly. Nothing is shown (and nothing waits) when there is no image. */
  function toData(blob) { return new Promise(function (ok, bad) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { bad(r.error); }; r.readAsDataURL(blob); }); }
  function decode(src) { return new Promise(function (ok, bad) { var im = new Image(); im.onload = function () { ok(src); }; im.onerror = function () { bad(new Error('bad picture')); }; im.src = src; }); }
  async function webPrep() {
    var stamp = Date.now(), id = '1';
    var meta = fetch(base + '/api/app/event?t=' + stamp).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return undefined; });
    var pic = fetch(base + '/api/app/event/image?t=' + stamp).then(function (r) { return r.ok ? r.blob() : null; }).catch(function () { return undefined; });
    var j = await meta;
    if (j === null || (j && j.active === false)) return null;             // the server says: no event image (deleted / never set)
    if (j && j.id != null) id = j.id;
    var b = await pic;
    if (b) { try { return { src: await decode(await toData(b)), id: id }; } catch (e) { /* fall through */ } }
    try { return { src: await decode(base + '/api/app/event/image?v=' + encodeURIComponent(id) + '&t=' + stamp), id: id }; } catch (e) { return null; }   // direct, if reading it as data failed
  }
  /* Android app: the app itself downloads the picture (no browser limits), then hands it to the page. */
  function nativePrep() {
    return new Promise(function (ok) {
      var bg = window.SoftSchoolBg;
      if (!bg || typeof bg.fetchEvent !== 'function') return ok(null);
      var t = setTimeout(function () { ok(null); }, 10000);
      window.__ssEventNative = function (txt) {
        clearTimeout(t);
        try { var n = JSON.parse(txt); if (n && n.active && n.data) { decode(n.data).then(function (src) { ok({ src: src, id: n.id || '1' }); }, function () { ok(null); }); } else ok(null); } catch (e) { ok(null); }
      };
      try { bg.fetchEvent(base); } catch (e) { clearTimeout(t); ok(null); }
    });
  }
  function prepAll() { return new Promise(function (resolve) {
    var left = 2, fin = false;
    function end(v) { if (fin) return; if (v) { fin = true; return resolve(v); } if (--left === 0) { fin = true; resolve(null); } }
    nativePrep().then(end, function () { end(null); });
    webPrep().then(end, function () { end(null); });
  }); }
  var ready = skip ? null : prepAll();
  var shownOnce = false;
  async function go() {
    if (shownOnce) return; shownOnce = true;
    var res = await Promise.race([ready, new Promise(function (r) { setTimeout(function () { r(null); }, 12000); })]);
    if (!res) return done();
    if (document.body) show(res.src, res.id); else document.addEventListener('DOMContentLoaded', function () { show(res.src, res.id); });
  }
  /* The Android app calls this when the user comes back to the app after being away: the picture is shown again. */
  window.__ssEventResume = function () {
    if (window.__eventShowing) return;
    try { sessionStorage.removeItem(SHOWN); } catch (e) { /* ignore */ }
    shownOnce = false; window.__eventPending = true; ready = prepAll(); go();
    setTimeout(function () { if (!window.__eventShowing) done(); }, 16000);
  };
  if (!skip) {
    setTimeout(function () { if (!window.__eventShowing) done(); }, 16000);                          // never hold anything back for long
    if (document.documentElement.classList.contains('splash-on') && !window.__splashDone) {
      document.addEventListener('splash:done', go, { once: true });
    } else go();
  }
})();
