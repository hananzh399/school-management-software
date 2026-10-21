// Parent Portal – access guard.
// Load as the FIRST script in <head> of every parent-portal page.
//
// NOTE: this is only the front door. The real protection is the server: every /api/parent/** call needs
// the signed token and returns 401 without it, so a visitor who skips this script still gets no data.
(function () {
  'use strict';
  var API = 'https://167-86-120-247.sslip.io/api/parent';   // same server as the login page
  var LOGIN = '../index.html';                               // the login page (site root)
  var page = (location.pathname.split('/').pop() || '').toLowerCase();
  var onlyNeedsToken = page === 'parent-portal-change-password.html'; // a first-time session may only change its password

  // One shared loader handles initial page checks, API activity, and navigation.
  var startupPending = true;
  var networkCount = 0;
  var networkVisible = false;
  var networkTimer = null;
  var operationCount = 0;
  var operationVisible = false;
  var operationTimer = null;
  var quietDepth = 0;
  var navigationPending = false;
  var hideTimer = null;
  var transitionTimer = null;
  var visibleSince = 0;
  var MIN_VISIBLE_MS = 480;
  var SHOW_DELAY_MS = 160;
  var loaderTitle;
  var loaderDetail;
  document.documentElement.classList.add('pp-auth-pending');

  var loaderStyle = document.createElement('style');
  loaderStyle.textContent = [
    'html.pp-auth-pending body{visibility:hidden!important}',
    '#pp-global-loader[hidden],#pp-student-picker[hidden]{display:none!important}',
    '#pp-global-loader{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;background:rgba(239,247,243,.78);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);opacity:0;pointer-events:none;transition:opacity .22s ease;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17332e}',
    '#pp-global-loader.is-visible{opacity:1;pointer-events:auto}',
    '.pp-loader-card{width:min(100%,340px);padding:32px 28px 27px;text-align:center;border:1px solid rgba(255,255,255,.9);border-radius:28px;background:rgba(255,255,255,.93);box-shadow:0 28px 80px rgba(24,76,66,.18),0 4px 14px rgba(24,76,66,.08);animation:pp-card-in .45s cubic-bezier(.2,.8,.2,1) both}',
    '.pp-loader-mark{width:74px;height:74px;position:relative;margin:0 auto 22px;display:grid;place-items:center;border-radius:24px;background:linear-gradient(145deg,#effaf5,#dff2e9);box-shadow:inset 0 1px 0 #fff}',
    '.pp-loader-orbit{position:absolute;inset:8px;border:2px solid rgba(46,139,122,.16);border-top-color:#2e8b7a;border-radius:50%;animation:pp-spin 1.05s linear infinite}',
    '.pp-loader-orbit-inner{position:absolute;inset:16px;border:2px solid rgba(46,139,122,.12);border-bottom-color:#74b4a3;border-radius:50%;animation:pp-spin-reverse 1.6s linear infinite}',
    '.pp-loader-mark svg{width:28px;height:28px;color:#247262;z-index:1}',
    '.pp-loader-title{display:block;font-size:1.03rem;font-weight:800;letter-spacing:-.02em}',
    '.pp-loader-detail{margin:8px 0 20px;color:#667a75;font-size:.88rem;line-height:1.5}',
    '.pp-loader-track{height:4px;overflow:hidden;border-radius:999px;background:#e7f2ed}',
    '.pp-loader-track:after{content:"";display:block;width:38%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#56a894,#2e8b7a,#91cdbb);animation:pp-progress 1.35s ease-in-out infinite}',
    '@keyframes pp-spin{to{transform:rotate(360deg)}}',
    '@keyframes pp-spin-reverse{to{transform:rotate(-360deg)}}',
    '@keyframes pp-progress{0%{transform:translateX(-110%)}100%{transform:translateX(280%)}}',
    '@keyframes pp-card-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '#pp-student-picker{position:fixed;inset:0;z-index:2147483001;display:grid;place-items:center;padding:20px;background:rgba(13,35,31,.50);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17332e;animation:pp-picker-fade .18s ease both}',
    '.pp-picker-panel-wrap{position:relative;width:min(100%,460px)}',
    '.pp-picker-panel{position:relative;width:100%;max-height:min(84vh,680px);overflow:auto;padding:56px clamp(22px,5vw,32px) clamp(22px,5vw,32px);border:1px solid rgba(255,255,255,.8);border-radius:28px;background:#fff;box-shadow:0 30px 90px rgba(0,0,0,.24);animation:pp-card-in .24s cubic-bezier(.2,.8,.2,1) both}',
    '.pp-picker-kicker{margin-bottom:7px;color:#2e8b7a;font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}',
    '.pp-picker-title{font-size:clamp(1.35rem,5vw,1.7rem);line-height:1.15;letter-spacing:-.04em}',
    '.pp-picker-copy{margin:9px 0 22px;color:#667a75;font-size:.93rem;line-height:1.5}',
    '.pp-picker-list{display:grid;gap:10px}',
    '.pp-picker-choice{width:100%;display:flex;align-items:center;gap:14px;padding:13px 15px;text-align:left;border:1px solid #e4eee9;border-radius:18px;background:#fbfdfc;color:inherit;cursor:pointer;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease,background .16s ease}',
    '.pp-picker-choice:hover{transform:translateY(-1px);border-color:#a9d3c7;background:#f4fbf7;box-shadow:0 9px 24px rgba(46,139,122,.10)}',
    '.pp-picker-choice:focus-visible,.pp-picker-cancel:focus-visible,.pp-picker-close:focus-visible{outline:3px solid rgba(46,139,122,.42);outline-offset:3px}',
    '.pp-picker-avatar{flex:0 0 48px;width:48px;height:48px;display:grid;place-items:center;border-radius:16px;background:linear-gradient(145deg,#e5f5ee,#cfe9de);color:#247262;font-weight:800;font-size:1rem}',
    '.pp-picker-details{min-width:0;display:grid;gap:4px}',
    '.pp-picker-name{overflow-wrap:anywhere;font-size:.98rem;font-weight:800}',
    '.pp-picker-meta{color:#71817d;font-size:.8rem}',
    '.pp-picker-arrow{margin-inline-start:auto;color:#2e8b7a;font-size:1.25rem;font-weight:700}',
    '.pp-picker-footer{display:flex;justify-content:flex-end;margin-top:18px}',
    '.pp-picker-cancel,.pp-picker-close{border:0;background:transparent;color:#55726a;font:inherit;font-weight:700;cursor:pointer}',
    '.pp-picker-close{position:absolute;z-index:1;top:14px;inset-inline-end:14px;width:38px;height:38px;border-radius:12px;background:#f2f7f4;font-size:1.35rem}',
    '@keyframes pp-picker-fade{from{opacity:0}to{opacity:1}}',
    '@media(prefers-reduced-motion:reduce){#pp-global-loader,.pp-loader-card,#pp-student-picker,.pp-picker-choice{animation:none;transition:none}.pp-loader-orbit,.pp-loader-orbit-inner,.pp-loader-track:after{animation:none}}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(loaderStyle);

  var loader = document.createElement('div');
  loader.id = 'pp-global-loader';
  loader.setAttribute('role', 'status');
  loader.setAttribute('aria-live', 'polite');
  loader.setAttribute('aria-atomic', 'true');
  loader.setAttribute('aria-hidden', 'true');
  loader.hidden = true;

  var loaderCard = document.createElement('div');
  loaderCard.className = 'pp-loader-card';
  loaderCard.innerHTML = '<div class="pp-loader-mark" aria-hidden="true"><span class="pp-loader-orbit"></span><span class="pp-loader-orbit-inner"></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 4l9 6.5"/><path d="M5.5 9.5v9h13v-9"/><path d="M9 18.5v-5h6v5"/></svg></div>';
  loaderTitle = document.createElement('strong');
  loaderTitle.className = 'pp-loader-title';
  loaderTitle.textContent = 'Preparing your portal';
  loaderDetail = document.createElement('p');
  loaderDetail.className = 'pp-loader-detail';
  loaderDetail.textContent = 'Please wait while we get everything ready.';
  var loaderTrack = document.createElement('div');
  loaderTrack.className = 'pp-loader-track';
  loaderTrack.setAttribute('aria-hidden', 'true');
  loaderCard.appendChild(loaderTitle);
  loaderCard.appendChild(loaderDetail);
  loaderCard.appendChild(loaderTrack);
  loader.appendChild(loaderCard);
  document.documentElement.appendChild(loader);

  function isPending() {
    return startupPending || networkVisible || operationVisible || navigationPending;
  }

  function setLoaderCopy(title, detail) {
    if (title) loaderTitle.textContent = title;
    if (detail) loaderDetail.textContent = detail;
  }

  function updateLoader() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null; }

    if (isPending()) {
      if (loader.hidden) {
        loader.hidden = false;
        loader.setAttribute('aria-hidden', 'false');
        visibleSince = Date.now();
        if (window.requestAnimationFrame) {
          window.requestAnimationFrame(function () { loader.classList.add('is-visible'); });
        } else {
          window.setTimeout(function () { loader.classList.add('is-visible'); }, 0);
        }
      } else {
        loader.setAttribute('aria-hidden', 'false');
        loader.classList.add('is-visible');
      }
      return;
    }

    if (loader.hidden) return;
    var remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - visibleSince));
    hideTimer = window.setTimeout(function () {
      if (isPending()) return updateLoader();
      loader.classList.remove('is-visible');
      loader.setAttribute('aria-hidden', 'true');
      transitionTimer = window.setTimeout(function () {
        if (!isPending()) loader.hidden = true;
        visibleSince = 0;
      }, 240);
    }, remaining);
  }

  function beginOperation(title, detail) {
    if (quietDepth > 0) return function () {};
    operationCount += 1;
    if (operationCount === 1) {
      setLoaderCopy(title || 'Processing your request', detail || 'Please wait while we complete this step.');
      operationTimer = window.setTimeout(function () {
        if (operationCount > 0) {
          operationVisible = true;
          updateLoader();
        }
      }, SHOW_DELAY_MS);
    }
    var finished = false;
    return function () {
      if (finished) return;
      finished = true;
      operationCount = Math.max(0, operationCount - 1);
      if (operationCount === 0) {
        if (operationTimer) { clearTimeout(operationTimer); operationTimer = null; }
        operationVisible = false;
        updateLoader();
      }
    };
  }

  function finishNetworkRequest() {
    networkCount = Math.max(0, networkCount - 1);
    if (networkCount === 0) {
      if (networkTimer) { clearTimeout(networkTimer); networkTimer = null; }
      networkVisible = false;
      updateLoader();
    }
  }

  // Catch direct fetch calls too; the API wrapper keeps its loader active until
  // response bodies have been parsed.
  if (typeof window.fetch === 'function' && !window.__parentPortalFetchWrapped) {
    var originalFetch = window.fetch.bind(window);
    window.fetch = function () {
      if (quietDepth > 0) return originalFetch.apply(null, arguments);
      networkCount += 1;
      if (networkCount === 1 && !startupPending && operationCount === 0 && !operationVisible && !navigationPending) {
        networkTimer = window.setTimeout(function () {
          if (networkCount > 0 && operationCount === 0 && !startupPending && !navigationPending) {
            networkVisible = true;
            setLoaderCopy('Loading your information', 'Please wait while we prepare this page.');
            updateLoader();
          }
        }, SHOW_DELAY_MS);
      }

      var result;
      try {
        result = originalFetch.apply(null, arguments);
      } catch (error) {
        finishNetworkRequest();
        throw error;
      }
      return Promise.resolve(result).then(function (response) {
        finishNetworkRequest();
        return response;
      }, function (error) {
        finishNetworkRequest();
        throw error;
      });
    };
    window.__parentPortalFetchWrapped = true;
  }

  window.ParentPortalLoading = {
    begin: beginOperation,
    quiet: function (callback) {
      quietDepth += 1;
      try { return callback(); }
      finally { quietDepth = Math.max(0, quietDepth - 1); }
    }
  };
  setLoaderCopy('Preparing your portal', 'Securely checking your parent account…');

  function deny() {
    try { sessionStorage.clear(); } catch (e) { /* ignore */ }
    setLoaderCopy('Returning to sign in', 'Your parent session needs to be checked again.');
    location.replace(LOGIN);
  }

  function reveal() {
    startupPending = false;
    document.documentElement.classList.remove('pp-auth-pending');
    updateLoader();
  }

  function childrenList() {
    if (Array.isArray(window.__parentPortalChildren)) return window.__parentPortalChildren;
    if (window.PortalStudents && typeof window.PortalStudents.list === 'function') {
      var currentList = window.PortalStudents.list();
      if (Array.isArray(currentList) && currentList.length) return currentList;
    }
    try {
      var saved = JSON.parse(sessionStorage.getItem('studentsList') || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch (e) { return []; }
  }

  function studentId(student) {
    return String(student && (student.id || student.regNo || student.regNumber) || '');
  }

  function studentName(student) {
    return String(student && (student.name || student.fullName) || 'Student');
  }

  function studentInitials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length ? (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase() : '?';
  }

  function openStudentPicker(kids, targetUrl) {
    var overlay = document.createElement('div');
    overlay.id = 'pp-student-picker';
    overlay.setAttribute('role', 'presentation');

    var panelWrap = document.createElement('div');
    panelWrap.className = 'pp-picker-panel-wrap';
    var panel = document.createElement('section');
    panel.className = 'pp-picker-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'pp-picker-title');
    panel.setAttribute('aria-describedby', 'pp-picker-copy');

    var close = document.createElement('button');
    close.className = 'pp-picker-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close student selection');
    close.textContent = '×';
    var kicker = document.createElement('p');
    kicker.className = 'pp-picker-kicker';
    kicker.textContent = 'Parent portal';
    var heading = document.createElement('h2');
    heading.className = 'pp-picker-title';
    heading.id = 'pp-picker-title';
    heading.textContent = 'Choose a student profile';
    var description = document.createElement('p');
    description.className = 'pp-picker-copy';
    description.id = 'pp-picker-copy';
    description.textContent = 'Select which student’s profile you want to open.';
    var list = document.createElement('div');
    list.className = 'pp-picker-list';

    panel.appendChild(close);
    var firstChoice = null;
    var previousActiveElement = document.activeElement;
    function closePicker() {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      if (document.body) document.body.style.overflow = '';
      if (previousActiveElement && previousActiveElement.isConnected) previousActiveElement.focus();
    }

    function chooseStudent(student) {
      var id = studentId(student);
      if (!id) return;
      try {
        sessionStorage.setItem('selectedStudentId', id);
        sessionStorage.setItem('studentData', JSON.stringify(student));
      } catch (e) { /* ignore unavailable session storage */ }
      if (window.PortalStudents) {
        if (typeof window.PortalStudents.setStudents === 'function') window.PortalStudents.setStudents(kids);
        if (typeof window.PortalStudents.select === 'function') window.PortalStudents.select(id);
      }
      window.__parentPortalChildren = kids;
      closePicker();
      navigationPending = true;
      setLoaderCopy('Opening student profile', 'Preparing ' + studentName(student) + '’s information.');
      updateLoader();
      window.location.href = targetUrl;
    }

    kids.forEach(function (student) {
      var button = document.createElement('button');
      button.className = 'pp-picker-choice';
      button.type = 'button';
      var avatar = document.createElement('span');
      avatar.className = 'pp-picker-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = studentInitials(studentName(student));
      var details = document.createElement('span');
      details.className = 'pp-picker-details';
      var name = document.createElement('span');
      name.className = 'pp-picker-name';
      name.textContent = studentName(student);
      var className = student && (student.classLabel || student.classSection || student.className) || '';
      var regNo = student && (student.regNo || student.regNumber) || '';
      var meta = document.createElement('span');
      meta.className = 'pp-picker-meta';
      meta.textContent = [className, regNo].filter(Boolean).join(' · ');
      details.appendChild(name);
      if (meta.textContent) details.appendChild(meta);
      var arrow = document.createElement('span');
      arrow.className = 'pp-picker-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '›';
      button.appendChild(avatar);
      button.appendChild(details);
      button.appendChild(arrow);
      button.addEventListener('click', function () { chooseStudent(student); });
      list.appendChild(button);
      if (!firstChoice) firstChoice = button;
    });

    var footer = document.createElement('div');
    footer.className = 'pp-picker-footer';
    var cancel = document.createElement('button');
    cancel.className = 'pp-picker-cancel';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    footer.appendChild(cancel);
    panel.appendChild(kicker);
    panel.appendChild(heading);
    panel.appendChild(description);
    panel.appendChild(list);
    panel.appendChild(footer);
    panelWrap.appendChild(panel);
    overlay.appendChild(panelWrap);

    function onKeyDown(event) {
      if (event.key === 'Escape') closePicker();
      if (event.key === 'Tab' && firstChoice) {
        var focusable = Array.prototype.slice.call(panel.querySelectorAll('button'));
        if (!focusable.length) return;
        if (event.shiftKey && document.activeElement === focusable[0]) {
          event.preventDefault();
          focusable[focusable.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
          event.preventDefault();
          focusable[0].focus();
        }
      }
    }
    close.addEventListener('click', closePicker);
    cancel.addEventListener('click', closePicker);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closePicker();
    });
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);
    if (firstChoice) firstChoice.focus();
  }

  function handleNavigation(event) {
    if (event.defaultPrevented || (event.button != null && event.button !== 0)
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var target = event.target;
    if (target && target.nodeType !== 1) target = target.parentElement;
    var link = target && target.closest ? target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;

    var destination;
    try { destination = new URL(link.href, window.location.href); } catch (e) { return; }
    if (destination.origin !== window.location.origin) return;

    if (/\/parent-portal-profile\.html$/i.test(destination.pathname)) {
      var kids = childrenList();
      if (kids.length > 1) {
        // If a child is already open (e.g. we are inside that child's dashboard),
        // go straight to that child's profile instead of asking again.
        // The picker is only for the home/index page or when nothing valid is selected.
        var onIndexPage = !!(document.body && document.body.classList.contains('page-index'));
        var openId = destination.searchParams.get('student');
        if (!openId) {
          try { openId = sessionStorage.getItem('selectedStudentId'); } catch (e) { openId = null; }
        }
        var openStudent = null;
        for (var k = 0; k < kids.length; k++) {
          if (openId && studentId(kids[k]) === String(openId)) { openStudent = kids[k]; break; }
        }

        if (!onIndexPage && openStudent) {
          try {
            sessionStorage.setItem('selectedStudentId', studentId(openStudent));
            sessionStorage.setItem('studentData', JSON.stringify(openStudent));
          } catch (e) { /* ignore */ }
          if (window.PortalStudents && typeof window.PortalStudents.select === 'function') {
            window.PortalStudents.select(studentId(openStudent));
          }
          // fall through: let the link navigate normally (no picker)
        } else {
          event.preventDefault();
          openStudentPicker(kids, destination.href);
          return;
        }
      }
    }

    if (destination.pathname === window.location.pathname
        && destination.search === window.location.search
        && destination.hash !== window.location.hash) return;
    if (destination.href === window.location.href) return;
    navigationPending = true;
    setLoaderCopy('Opening your page', 'Please wait while we prepare the next screen.');
    updateLoader();
  }

  document.addEventListener('click', handleNavigation);
  window.addEventListener('beforeunload', function () {
    navigationPending = true;
    setLoaderCopy('Opening your page', 'Please wait while we prepare the next screen.');
    updateLoader();
  });

  function check() {
    startupPending = true;
    document.documentElement.classList.add('pp-auth-pending');
    setLoaderCopy('Preparing your portal', 'Securely checking your parent account…');
    updateLoader();
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
          // parent-portal-students.js is loaded while this request is in flight.
          // Keep both its startup state and its live view in sync with the server.
          window.__parentPortalChildren = kids;
          window.dispatchEvent(new CustomEvent('parent-portal-children-updated', { detail: kids }));
          reveal();
        });
      })
      .catch(deny);   // cannot confirm the session -> do not show the portal
  }

  check();
  // Back/forward cache: re-check when the page is restored from history.
  window.addEventListener('pageshow', function (e) { if (e.persisted) check(); });
})();
