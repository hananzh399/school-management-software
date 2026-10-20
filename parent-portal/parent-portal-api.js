// Parent Portal – API client. Load in <head> right after parent-portal-guard.js.
// Every page talks to the backend only through this file.
(function (global) {
  'use strict';
  // Override this before loading the file when the backend URL changes:
  // window.PARENT_PORTAL_API_BASE = 'https://your-host/api/parent';
  var API = (global.PARENT_PORTAL_API_BASE || 'https://167-86-120-247.sslip.io/api/parent').replace(/\/+$/, '');
  var LOGIN = '../index.html';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function token() { try { return sessionStorage.getItem('softschool_parent_token'); } catch (e) { return null; } }
  function logout() { try { sessionStorage.clear(); } catch (e) { /* ignore */ } location.replace(LOGIN); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function request(method, path, body) {
    var currentToken = token();
    if (!currentToken) return Promise.reject(new Error('Please log in to the parent portal first.'));
    var opts = { method: method, headers: { Authorization: 'Bearer ' + currentToken, Accept: 'application/json' } };
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
      if (d && (d.regNo || d.id || d.regNumber)) return d;
      var list = JSON.parse(sessionStorage.getItem('studentsList') || '[]');
      return list[0] || null;
    } catch (e) { return null; }
  }
  function childId() {
    var c = child();
    return c ? (c.regNo || c.regNumber || c.id || null) : null;
  }
  function forChild(suffix) {
    var id = childId();
    if (!id) throw new Error('No child is selected in the parent portal.');
    return '/children/' + encodeURIComponent(id) + suffix;
  }

  // Refresh and normalize the real children list from the authenticated backend.
  // Keep the parent's current selection when that child is still linked to the account.
  function children() {
    return request('GET', '/children').then(function (list) {
      if (!Array.isArray(list)) throw new Error('The backend returned an invalid children list.');
      var previous = childId();
      var selected = list.find(function (c) {
        return String(c.regNo || c.regNumber || c.id) === String(previous);
      }) || list[0] || null;
      try {
        sessionStorage.setItem('studentsList', JSON.stringify(list));
        if (selected) sessionStorage.setItem('studentData', JSON.stringify(selected));
      } catch (e) { /* storage may be unavailable; in-memory calls still work */ }
      return list;
    });
  }

  function ensureChildren() {
    return children().then(function (list) {
      if (!list.length) throw new Error('No children are linked to this parent account.');
      return list;
    });
  }

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

  function school() { return request('GET', '/school'); }

  // Use the SoftSchool product mark in the browser tab on every portal page.
  function ensureSoftwareFavicon() {
    if (!document.head) return;
    var icon = document.querySelector('link[rel~="icon"]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.appendChild(icon);
    }
    icon.type = 'image/png';
    icon.href = 'logo-icon.png';
  }

  // School logos are uploaded as image data URLs. Only accept image sources
  // that cannot turn this branding field into executable page content.
  function safeLogoSource(value) {
    if (typeof value !== 'string') return null;
    var src = value.trim();
    if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(src)) {
      return src;
    }
    return /^https:\/\//i.test(src) ? src : null;
  }

  var currentSchoolBrand = null;
  var brandingSvgNs = 'http://www.w3.org/2000/svg';

  function fallbackSchoolMark(className) {
    var svg = document.createElementNS(brandingSvgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', className || 'portal-school-brand-logo');
    svg.setAttribute('aria-hidden', 'true');
    var circle = document.createElementNS(brandingSvgNs, 'circle');
    circle.setAttribute('cx', '50');
    circle.setAttribute('cy', '50');
    circle.setAttribute('r', '45');
    circle.setAttribute('fill', '#F0F9F4');
    circle.setAttribute('stroke', '#2E8B7A');
    circle.setAttribute('stroke-width', '5');
    var roof = document.createElementNS(brandingSvgNs, 'path');
    roof.setAttribute('d', 'M50 20 L75 40 L75 75 L25 75 L25 40 Z');
    roof.setAttribute('fill', '#2E8B7A');
    roof.setAttribute('opacity', '0.85');
    var window = document.createElementNS(brandingSvgNs, 'circle');
    window.setAttribute('cx', '50');
    window.setAttribute('cy', '52');
    window.setAttribute('r', '10');
    window.setAttribute('fill', '#F0F9F4');
    window.setAttribute('stroke', '#2E8B7A');
    window.setAttribute('stroke-width', '3');
    var door = document.createElementNS(brandingSvgNs, 'rect');
    door.setAttribute('x', '42');
    door.setAttribute('y', '62');
    door.setAttribute('width', '16');
    door.setAttribute('height', '12');
    door.setAttribute('fill', '#F0F9F4');
    door.setAttribute('rx', '2');
    svg.appendChild(circle);
    svg.appendChild(roof);
    svg.appendChild(window);
    svg.appendChild(door);
    return svg;
  }

  function logoImage(source, name, className, fallback) {
    var img = document.createElement('img');
    img.className = className;
    img.alt = name + ' logo';
    img.decoding = 'async';
    img.src = source;
    img.addEventListener('error', function () {
      if (img.parentNode) img.replaceWith(fallback || fallbackSchoolMark(className));
    }, { once: true });
    return img;
  }

  function replaceDefaultSchoolName(text, name) {
    return typeof text === 'string' ? text.replace(/Greenwood High/g, name) : text;
  }

  function updatePageSchoolBranding(brand) {
    if (!brand || !brand.name || !document.body) return;
    var name = brand.name;
    var logo = safeLogoSource(brand.logo);

    document.querySelectorAll('[data-i18n="school"], .app-brand-name, .drawer-school, .mobile-brand-name')
      .forEach(function (el) { el.textContent = name; });

    // The page translations include the old sample school in titles and a few
    // portal labels. Replace it after each language change without disturbing
    // the translated page-specific text.
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      if (el.tagName === 'TITLE') return;
      var translated = replaceDefaultSchoolName(el.textContent, name);
      if (translated !== el.textContent) el.textContent = translated;
    });
    document.title = replaceDefaultSchoolName(document.title, name);

    if (logo) {
      document.querySelectorAll('.app-brand-logo, .drawer-logo, .mobile-brand-logo').forEach(function (mark) {
        if (mark.dataset && mark.dataset.schoolBrandLogoFailed === 'true') return;
        if (mark.tagName === 'IMG') {
          if (mark.dataset && mark.dataset.schoolBrandSrc === logo) return;
          mark.dataset.schoolBrandSrc = logo;
          mark.alt = name + ' logo';
          mark.src = logo;
          return;
        }
        var className = mark.getAttribute('class') || '';
        var fallback = mark.cloneNode(true);
        fallback.dataset.schoolBrandLogoFailed = 'true';
        mark.replaceWith(logoImage(logo, name, className, fallback));
      });
    }

    // A few utility pages (chat, settings, and password/feedback) do not have
    // a visible school mark in their top bar, so give those pages the same
    // school identity as the rest of the portal.
    var header = document.querySelector('header');
    if (!header || header.querySelector('.app-brand-logo, .mobile-brand-logo')) return;
    if (document.getElementById('portalSchoolBranding')) return;

    var badge = document.createElement('div');
    badge.id = 'portalSchoolBranding';
    badge.className = 'portal-school-branding';
    badge.setAttribute('role', 'group');
    badge.setAttribute('aria-label', 'School: ' + name);
    badge.appendChild(logo
      ? logoImage(logo, name, 'portal-school-brand-logo', fallbackSchoolMark('portal-school-brand-logo'))
      : fallbackSchoolMark('portal-school-brand-logo'));
    var label = document.createElement('span');
    label.className = 'portal-school-brand-name';
    label.textContent = name;
    badge.appendChild(label);
    header.insertAdjacentElement('afterend', badge);
  }

  function installSchoolBranding(brand) {
    currentSchoolBrand = brand;
    var i18n = global.PortalI18n;
    if (i18n && !i18n.schoolBrandingInstalled) {
      var originalTranslate = i18n.t;
      if (typeof originalTranslate === 'function') {
        i18n.t = function (key) {
          return replaceDefaultSchoolName(originalTranslate.apply(this, arguments), brand.name);
        };
      }
      var originalTranslateEnglish = i18n.tEn;
      if (typeof originalTranslateEnglish === 'function') {
        i18n.tEn = function (key) {
          return replaceDefaultSchoolName(originalTranslateEnglish.apply(this, arguments), brand.name);
        };
      }
      var originalApply = i18n.apply;
      if (typeof originalApply === 'function') {
        i18n.apply = function () {
          var result = originalApply.apply(this, arguments);
          updatePageSchoolBranding(currentSchoolBrand);
          return result;
        };
      }
      i18n.schoolBrandingInstalled = true;
    }

    function renderWhenReady() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          setTimeout(function () {
            installSchoolBranding(currentSchoolBrand);
            updatePageSchoolBranding(currentSchoolBrand);
          }, 0);
        }, { once: true });
        return;
      }
      updatePageSchoolBranding(brand);
    }
    renderWhenReady();
  }

  function loadSchoolBranding() {
    school().then(function (data) {
      if (!data || typeof data.name !== 'string' || !data.name.trim()) return;
      installSchoolBranding({
        name: data.name.trim(),
        logo: data.logo || null
      });
    }).catch(function () {
      // The portal remains usable if school branding is temporarily unavailable.
    });
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
    blobUrl('/children/' + encodeURIComponent(c.regNo || c.regNumber || c.id) + '/photo').then(function (url) {
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
    postForm: function (p, form) { return request('POST', p, form); },
    children: children,
    ensureChildren: ensureChildren,
    school: school,
    diary: function () { return request('GET', forChild('/diary')); },
    tests: function () { return request('GET', forChild('/tests')); },
    teachers: function () { return request('GET', forChild('/teachers')); },
    messages: function (regNo) { return request('GET', '/messages?regNo=' + encodeURIComponent(regNo || childId())); },
    messageThreads: function (regNo) { return request('GET', '/messages/threads?regNo=' + encodeURIComponent(regNo || childId())); },
    markMessagesRead: function (regNo, thread) { return request('POST', '/messages/read', { regNo: regNo || childId(), thread: thread }); },
    sendMessage: function (body) { return request('POST', '/messages', body); },
    submissions: function (form) { return request('POST', '/submissions', form); },
    child: child, childId: childId, forChild: forChild,
    fmtDate: fmtDate, fmtTime: fmtTime, blobUrl: blobUrl,
    showError: showError, logout: logout
  };
  ensureSoftwareFavicon();
  loadSchoolBranding();
})(window);
