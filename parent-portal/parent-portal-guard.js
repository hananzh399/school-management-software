// Parent Portal – access guard.
// Load as the FIRST script in <head> of every parent-portal page.
// Without a valid parent session the page never becomes visible and the visitor is sent to the login page.
//
// NOTE: this is only the front door. The real protection is the server: every /api/parent/** call needs
// the signed token and returns 401 without it, so a visitor who skips this script still gets no data.
(function () {
  'use strict';
  var API = 'https://167-86-120-247.sslip.io/api/parent';   // same server as the login page
  var LOGIN = '../index.html';                               // the login page (site root)
  var page = (location.pathname.split('/').pop() || '').toLowerCase();
  var onlyNeedsToken = page === 'parent-portal-change-password.html'; // a first-time session may only change its password

  // Hide everything until the session has been checked.
  var hide = document.createElement('style');
  hide.id = 'pp-guard-hide';
  hide.textContent = 'html{visibility:hidden!important}';
  document.documentElement.appendChild(hide);

  function reveal() { var s = document.getElementById('pp-guard-hide'); if (s) s.remove(); }
  function deny() {
    try { sessionStorage.clear(); } catch (e) { /* ignore */ }
    location.replace(LOGIN);
  }

  function check() {
    var token = null;
    try { token = sessionStorage.getItem('softschool_parent_token'); } catch (e) { /* ignore */ }
    if (!token) return deny();
    if (onlyNeedsToken) return reveal();

    fetch(API + '/children', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (res) {
        if (!res.ok) return deny();
        return res.json().then(function (kids) {
          if (!Array.isArray(kids) || !kids.length) return deny();
          try { sessionStorage.setItem('studentsList', JSON.stringify(kids)); } catch (e) { /* ignore */ }
          reveal();
        });
      })
      .catch(deny);   // cannot confirm the session -> do not show the portal
  }

  check();
  // Back/forward cache: re-check when the page is restored from history.
  window.addEventListener('pageshow', function (e) { if (e.persisted) { document.documentElement.appendChild(hide); check(); } });
})();
