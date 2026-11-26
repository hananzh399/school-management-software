/*!
 * auto-refresh.js - the open page updates by itself when a record is changed somewhere else
 *   hybrid : local-api.js pulls from the server and fires 'softschool:data-changed' when something new arrived
 *   online : every 30 s (page visible) a small server check; a change fires the same event
 * On the event: if the page has window.softRefresh() it is called, otherwise the page reloads - but only when
 * nobody is typing or has a window open. If they are busy it waits until they finish.
 */
(function () {
  'use strict';
  if (window.SoftSchoolAutoRefresh) return;
  var lastInput = 0, pending = false, sig = null, EVERY = 30000;
  ['input', 'keydown', 'change'].forEach(function (e) { document.addEventListener(e, function () { lastInput = Date.now(); }, true); });

  function mode() { try { return window.SoftSchoolMode && window.SoftSchoolMode.get(); } catch (e) { return null; } }
  function visible(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }
  function busy() {
    if (Date.now() - lastInput < 6000) return true;                       // typed a moment ago
    var m = document.querySelectorAll('.modal.show, .modal.open, dialog[open], .overlay.show, .popup.show');
    for (var i = 0; i < m.length; i++) if (visible(m[i])) return true;   // a window is really open
    return false;
  }
  function apply() {
    if (document.hidden) { pending = true; return; }
    if (busy()) { pending = true; return; }
    pending = false;
    try { if (typeof window.softRefresh === 'function') { window.softRefresh(); return; } } catch (e) { /* fall through */ }
    location.reload();
  }
  function changed() { pending = true; apply(); }
  window.addEventListener('softschool:data-changed', changed);
  setInterval(function () { if (pending) apply(); }, 4000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && pending) apply(); });

  // online schools: look at the server's two small summary answers
  function token() { try { return sessionStorage.getItem('softschool_api_token') || ''; } catch (e) { return ''; } }
  async function check() {
    if (document.hidden || mode() !== 'online' || navigator.onLine === false) return;
    try {
      var h = token() ? { Authorization: 'Bearer ' + token() } : {};
      var parts = [];
      var urls = ['/api/students/summary', '/api/staff/summary'];
      for (var i = 0; i < urls.length; i++) { var r = await fetch(urls[i], { headers: h }); if (!r.ok) return; parts.push(await r.text()); }
      var now = parts.join('|');
      if (sig !== null && sig !== now) { sig = now; window.dispatchEvent(new CustomEvent('softschool:data-changed', { detail: { source: 'server' } })); }
      else sig = now;
    } catch (e) { /* offline or busy: try next time */ }
  }
  setTimeout(check, 5000);
  setInterval(check, EVERY);
  window.SoftSchoolAutoRefresh = { check: check, apply: apply };
})();
