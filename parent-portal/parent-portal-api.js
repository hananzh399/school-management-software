// Parent Portal – API client. Load in <head> right after parent-portal-guard.js.
// Every page talks to the backend only through this file.
(function (global) {
  'use strict';
  var API = 'https://167-86-120-247.sslip.io/api/parent';   // same server as the login page
  var LOGIN = '../index.html';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function token() { try { return sessionStorage.getItem('softschool_parent_token'); } catch (e) { return null; } }
  function logout() { try { sessionStorage.clear(); } catch (e) { /* ignore */ } location.replace(LOGIN); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function request(method, path, body) {
    var opts = { method: method, headers: { Authorization: 'Bearer ' + token() } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(API + path, opts).then(function (res) {
      if (res.status === 401) { logout(); throw new Error('Session expired.'); }
      if (res.status === 204) return null;
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || 'Something went wrong. Please try again.');
        return data;
      });
    }, function () { throw new Error("Couldn't reach the server. Check your connection."); });
  }

  // The child currently selected in the portal (set by parent-portal-students.js / the home page).
  function child() {
    try {
      var d = JSON.parse(sessionStorage.getItem('studentData') || 'null');
      if (d && d.id) return d;
      var list = JSON.parse(sessionStorage.getItem('studentsList') || '[]');
      return list[0] || null;
    } catch (e) { return null; }
  }
  function childId() { var c = child(); return c ? c.id : null; }
  function forChild(suffix) { return '/children/' + encodeURIComponent(childId()) + suffix; }

  // Dates: "05 Oct 2026" and "09:15 AM", the formats the pages already display.
  function parts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);          // date-only: no timezone shift
  }
  function fmtDate(iso) { var d = parts(iso); return isNaN(d) ? '' : pad(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtTime(iso) {
    var d = parts(iso); if (isNaN(d)) return '';
    var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return pad(h) + ':' + pad(d.getMinutes()) + ' ' + ap;
  }

  function showError(err) {
    var msg = (err && err.message) || 'Could not load your data.';
    var bar = document.createElement('div');
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:99999;background:#B3261E;color:#fff;padding:10px 14px;border-radius:10px;font:14px system-ui,sans-serif;text-align:center';
    bar.textContent = msg;
    document.body.appendChild(bar);
    setTimeout(function () { bar.remove(); }, 6000);
  }

  // Fetches a protected file (photo, diary picture) and returns a blob: URL for <img src>.
  function blobUrl(path) {
    return fetch(API + path, { headers: { Authorization: 'Bearer ' + token() } }).then(function (res) {
      if (!res.ok) throw new Error('file');
      return res.blob();
    }).then(function (b) { return URL.createObjectURL(b); });
  }

  // Child photos: set on every photo element the pages use.
  function loadPhoto() {
    var c = child();
    if (!c || !c.hasPhoto) return;
    blobUrl('/children/' + encodeURIComponent(c.id) + '/photo').then(function (url) {
      ['dashStudentPhoto', 'profilePhoto'].forEach(function (id) { var el = document.getElementById(id); if (el) el.src = url; });
      document.querySelectorAll('.student-bar-photo').forEach(function (el) { el.src = url; });
    }).catch(function () { /* initials/default picture stays */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadPhoto); else loadPhoto();

  global.PortalAPI = {
    get: function (p) { return request('GET', p); },
    post: function (p, b) { return request('POST', p, b); },
    put: function (p, b) { return request('PUT', p, b); },
    del: function (p) { return request('DELETE', p); },
    child: child, childId: childId, forChild: forChild,
    fmtDate: fmtDate, fmtTime: fmtTime, blobUrl: blobUrl,
    showError: showError, logout: logout
  };
})(window);
