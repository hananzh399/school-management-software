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
      setTimeout(function () { o.remove(); done(); }, 360);
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

  /* The picture is fetched and decoded WHILE the splash is playing, so it can pop up the moment the splash ends.
     It is turned into a data: address (allowed by the app's page rules, unlike blob:) and, if the server cannot be asked
     for its details, the picture is tried directly. Nothing is shown (and nothing waits) when there is no image. */
  function toData(blob) { return new Promise(function (ok, bad) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { bad(r.error); }; r.readAsDataURL(blob); }); }
  function decode(src) { return new Promise(function (ok, bad) { var im = new Image(); im.onload = function () { ok(src); }; im.onerror = function () { bad(new Error('bad picture')); }; im.src = src; }); }
  async function prepare() {
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
  var ready = prepare().catch(function () { return null; });
  var shownOnce = false;
  async function go() {
    if (shownOnce) return; shownOnce = true;
    var res = await Promise.race([ready, new Promise(function (r) { setTimeout(function () { r(null); }, 9000); })]);
    if (!res) return done();
    if (document.body) show(res.src, res.id); else document.addEventListener('DOMContentLoaded', function () { show(res.src, res.id); });
  }
  setTimeout(function () { if (!window.__eventShowing) done(); }, 15000);                            // never hold anything back for long
  if (document.documentElement.classList.contains('splash-on') && !window.__splashDone) {
    document.addEventListener('splash:done', go, { once: true });
  } else go();
})();
