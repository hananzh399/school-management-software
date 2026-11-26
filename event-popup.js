/*! event-popup.js - shows the super admin's event image once per visit, right after the splash screen (website + Android app).
 *  Has a Skip button (also: tap outside / Escape). Nothing is shown when the super admin has no image set. */
(function () {
  'use strict';
  if (window.__ssEventPopup) return; window.__ssEventPopup = true;
  var SHOWN = 'softschool_event_shown';
  var base = window.SOFTSCHOOL_API_BASE || 'https://thesoftschool.com';
  try { if (sessionStorage.getItem(SHOWN)) { window.__eventPending = false; return; } } catch (e) { /* ignore */ }
  window.__eventPending = true;
  function done() { window.__eventShowing = false; window.__eventPending = false; }

  function show(src, id) {
    var o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(8,15,30,.78);opacity:0;transition:opacity .35s ease';
    o.innerHTML = '<div style="position:relative;max-width:min(94vw,720px);max-height:92vh;display:flex;flex-direction:column;align-items:center;gap:12px">' +
      '<img alt="" style="max-width:100%;max-height:78vh;object-fit:contain;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.5);background:#fff;transform:scale(.96);transition:transform .35s ease">' +
      '<button type="button" style="padding:11px 34px;border:0;border-radius:999px;background:#fff;color:#0b1120;font:600 15px system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.35);cursor:pointer">Skip</button></div>';
    var img = o.querySelector('img'); img.src = src;
    var closed = false;
    function close() {
      if (closed) return; closed = true;
      o.style.opacity = '0';
      setTimeout(function () { o.remove(); try { URL.revokeObjectURL(src); } catch (e) { /* ignore */ } done(); }, 360);
      document.removeEventListener('keydown', key);
    }
    function key(e) { if (e.key === 'Escape') close(); }
    o.querySelector('button').onclick = close;
    o.addEventListener('click', function (e) { if (e.target === o) close(); });
    document.addEventListener('keydown', key);
    document.body.appendChild(o);
    requestAnimationFrame(function () { o.style.opacity = '1'; img.style.transform = 'scale(1)'; });
    window.__eventShowing = true;
    try { sessionStorage.setItem(SHOWN, id || '1'); } catch (e) { /* ignore */ }
  }

  async function run() {
    try {
      var r = await fetch(base + '/api/app/event');
      if (!r.ok) return done();
      var j = await r.json();
      if (!j || !j.active) return done();
      var ir = await fetch(base + '/api/app/event/image?v=' + encodeURIComponent(j.id));
      if (!ir.ok) return done();
      var url = URL.createObjectURL(await ir.blob());
      var probe = new Image();
      probe.onload = function () { show(url, j.id); };
      probe.onerror = function () { done(); };
      probe.src = url;
    } catch (e) { done(); }
  }
  function go() { if (navigator.onLine === false) return done(); if (document.body) run(); else document.addEventListener('DOMContentLoaded', run); }
  setTimeout(function () { if (!window.__eventShowing) done(); }, 12000);                              // never hold anything back for long
  if (document.documentElement.classList.contains('splash-on') && !window.__splashDone) {
    document.addEventListener('splash:done', function () { setTimeout(go, 250); }, { once: true });
  } else go();
})();
