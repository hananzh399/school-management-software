// Parent Portal – Home page extras
// Adds the date in the banner and the live Messages / Notifications tiles.
// Runs after parent-portal-script.js and never touches what that script owns.
(function () {
  'use strict';

  var I18n = window.PortalI18n;

  // Translation with an English fallback if a key is missing
  function tr(key, fallback) {
    try {
      var v = I18n ? I18n.t(key) : null;
      return v && v !== key ? v : fallback;
    } catch (e) { return fallback; }
  }
  // Wrap Urdu phrases so punctuation lands on the correct side
  function onScreen(text) { return I18n && I18n.iso ? I18n.iso(text) : text; }
  function fill(text, n) { return text.replace('{n}', String(n)); }
  function $(id) { return document.getElementById(id); }
  var cardPhotoUrls = [];

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }

  function revokeCardPhotoUrl(url) {
    var index = cardPhotoUrls.indexOf(url);
    if (index >= 0) cardPhotoUrls.splice(index, 1);
    if (window.URL && typeof window.URL.revokeObjectURL === 'function') {
      window.URL.revokeObjectURL(url);
    }
  }

  // ---------- Full-screen photo viewer ----------
  var lightbox = null, lightboxImg = null, lightboxCap = null, lightboxClose = null, lightboxReturnFocus = null;

  function injectLightboxStyles() {
    if (document.getElementById('photoLightboxStyles')) return;
    var css = [
      '.student-photo-wrap.has-photo{cursor:zoom-in}',
      '.photo-lightbox{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.9rem;box-sizing:border-box;padding:calc(1rem + env(safe-area-inset-top,0px)) 1rem calc(1rem + env(safe-area-inset-bottom,0px));background:rgba(8,16,14,.92);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);opacity:0;transition:opacity .22s ease;cursor:zoom-out}',
      '.photo-lightbox[hidden]{display:none}',
      '.photo-lightbox.is-open{opacity:1}',
      '.photo-lightbox .photo-lightbox-img{display:block;position:static;width:auto;height:auto;max-width:100%;max-height:calc(100vh - 8rem);max-height:calc(100dvh - 8rem);object-fit:contain;border-radius:16px;border:0;box-shadow:0 20px 60px -10px rgba(0,0,0,.6);transform:scale(.94);transition:transform .25s cubic-bezier(.22,.8,.3,1)}',
      '.photo-lightbox.is-open .photo-lightbox-img{transform:scale(1)}',
      '.photo-lightbox .photo-lightbox-caption{margin:0;color:#fff;font-size:1rem;font-weight:700;text-align:center;overflow-wrap:anywhere}',
      '.photo-lightbox .photo-lightbox-close{position:absolute;top:calc(.75rem + env(safe-area-inset-top,0px));right:.75rem;display:flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;cursor:pointer}',
      '.photo-lightbox .photo-lightbox-close:hover{background:rgba(255,255,255,.3)}',
      '.photo-lightbox .photo-lightbox-close svg{width:22px;height:22px}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'photoLightboxStyles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildLightbox() {
    injectLightboxStyles();
    lightbox = node('div', 'photo-lightbox');
    lightbox.hidden = true;
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');

    lightboxClose = node('button', 'photo-lightbox-close');
    lightboxClose.type = 'button';
    lightboxClose.setAttribute('aria-label', tr('close', 'Close'));
    lightboxClose.appendChild(svg(['M18 6L6 18', 'M6 6l12 12'], '2.5'));

    lightboxImg = node('img', 'photo-lightbox-img');
    lightboxCap = node('p', 'photo-lightbox-caption');

    lightbox.appendChild(lightboxClose);
    lightbox.appendChild(lightboxImg);
    lightbox.appendChild(lightboxCap);
    document.body.appendChild(lightbox);

    lightbox.addEventListener('click', closeLightbox);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && lightbox && !lightbox.hidden) closeLightbox();
    });
  }

  function openLightbox(src, name) {
    if (!lightbox) buildLightbox();
    lightboxReturnFocus = document.activeElement;
    lightboxImg.src = src;
    lightboxImg.alt = name || '';
    lightboxCap.textContent = name || '';
    lightbox.setAttribute('aria-label', name || '');
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { lightbox.classList.add('is-open'); });
    lightboxClose.focus();
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.classList.remove('is-open');
    lightbox.hidden = true;
    lightboxImg.removeAttribute('src');
    document.body.style.overflow = '';
    if (lightboxReturnFocus && lightboxReturnFocus.focus) lightboxReturnFocus.focus();
  }

  function loadCardPhoto(student, img, fallback) {
    function show(url) {
      img.onload = function () {
        fallback.hidden = true;
        var wrap = img.parentNode;
        if (wrap) {
          wrap.classList.add('has-photo');
          wrap.setAttribute('role', 'button');
          wrap.tabIndex = 0;
          wrap.setAttribute('aria-label', tr('viewPhoto', 'View photo'));
        }
      };
      img.onerror = function () {
        img.hidden = true;
        fallback.hidden = false;
        if (url.indexOf('blob:') === 0) revokeCardPhotoUrl(url);
      };
      img.src = url;
      img.hidden = false;
    }

    if (student.photo) {
      show(student.photo);
      return;
    }

    var regNo = student.regNo || student.regNumber || student.id;
    var api = window.PortalAPI;
    if ((!student.hasPhoto && !student.photoUrl) || !regNo || !api || typeof api.blobUrl !== 'function') return;

    api.blobUrl('/children/' + encodeURIComponent(regNo) + '/photo').then(function (url) {
      if (!img.isConnected) {
        window.URL.revokeObjectURL(url);
        return;
      }
      cardPhotoUrls.push(url);
      show(url);
    }).catch(function () {
      img.hidden = true;
      fallback.hidden = false;
    });
  }

  // ---------- Student cards (one per child) ----------
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svg(paths, extra) {
    var el = document.createElementNS(SVG_NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', extra || '2.2');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('aria-hidden', 'true');
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      el.appendChild(p);
    });
    return el;
  }

  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function openStudent(id) {
    if (window.PortalStudents) window.PortalStudents.select(id);
    window.location.href = 'parent-portal-dashboard.html';
  }

  function buildStudentCard(s, isCurrent) {
    var PS = window.PortalStudents;
    var card = node('div', 'student-card-new' + (isCurrent ? ' is-current' : ''));
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.dataset.studentId = s.id;
    card.setAttribute('aria-label', tr('openDashboard', 'Open student dashboard') + ': ' + s.name);

    // top: photo, name, class + section, arrow
    var top = node('div', 'student-card-top');

    var photoWrap = node('div', 'student-photo-wrap');
    var fallback = node('span', 'student-photo-fallback', initials(s.name));
    fallback.setAttribute('aria-hidden', 'true');
    var img = node('img', 'student-photo-new');
    img.hidden = true;
    img.alt = tr('photoAlt', '{name}\u2019s photo').replace('{name}', s.name || '');
    photoWrap.appendChild(fallback);
    photoWrap.appendChild(img);
    photoWrap.appendChild(node('span', 'status-dot'));

    var main = node('div', 'student-card-main');
    main.appendChild(node('span', 'student-tag', onScreen(tr('student', 'Student'))));
    main.appendChild(node('h3', 'student-name-new', s.name));
    var meta = node('div', 'student-meta-row');
    var chip = node('span', 'meta-chip');
    chip.appendChild(svg(['M22 10v6M2 10l10-5 10 5-10 5z', 'M6 12v5c3 3 9 3 12 0v-5']));
    chip.appendChild(node('bdi', null, PS ? PS.classSectionLabel(s) : (s.classSection || '')));
    meta.appendChild(chip);
    main.appendChild(meta);

    var arrow = node('div', 'student-card-arrow');
    arrow.appendChild(svg(['M9 18l6-6-6-6'], '2.5'));

    top.appendChild(photoWrap);
    top.appendChild(main);
    top.appendChild(arrow);

    // bottom: registration number + call to action
    var bottom = node('div', 'student-card-bottom');
    var detail = node('div', 'student-detail');
    detail.appendChild(node('span', 'detail-label', onScreen(tr('regNumber', 'Reg Number'))));
    var value = node('span', 'detail-value');
    var bdi = node('bdi', null, s.regNumber);
    bdi.dir = 'ltr';
    value.appendChild(bdi);
    detail.appendChild(value);
    bottom.appendChild(detail);
    bottom.appendChild(node('span', 'student-card-cta', onScreen(tr('viewDashboard', 'View dashboard'))));

    card.appendChild(top);
    card.appendChild(bottom);
    card._studentPhoto = { img: img, fallback: fallback };

    // Tap the photo → enlarge it (don't open the dashboard)
    function zoomPhoto(e) {
      if (!photoWrap.classList.contains('has-photo') || !img.src) return;
      e.stopPropagation();
      openLightbox(img.src, s.name);
    }
    photoWrap.addEventListener('click', zoomPhoto);
    photoWrap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        if (!photoWrap.classList.contains('has-photo')) return;
        e.preventDefault();
        zoomPhoto(e);
      }
    });

    card.addEventListener('click', function () { openStudent(s.id); });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStudent(s.id); }
    });
    return card;
  }

  function renderStudents() {
    var grid = $('studentGrid');
    if (!grid) return;
    closeLightbox();
    var PS = window.PortalStudents;
    var students = PS ? PS.list() : [];
    var hint = $('studentsHint');
    var heading = $('studentsHeading');

    var previousPhotoUrls = cardPhotoUrls;
    cardPhotoUrls = [];
    previousPhotoUrls.forEach(function (url) {
      if (window.URL && typeof window.URL.revokeObjectURL === 'function') window.URL.revokeObjectURL(url);
    });
    grid.textContent = '';
    if (!students.length) return;

    var current = PS.current();
    var several = students.length > 1;
    students.forEach(function (s) {
      var card = buildStudentCard(s, several && current && s.id === current.id);
      grid.appendChild(card);
      loadCardPhoto(s, card._studentPhoto.img, card._studentPhoto.fallback);
    });

    if (hint) hint.hidden = !several;
    if (heading) heading.textContent = onScreen(tr(several ? 'myChildren' : 'myChild', several ? 'My Children' : 'My Child'));
  }

  // ---------- Date in the banner ----------
  function renderDate() {
    var box = $('heroDate');
    var out = $('heroDateText');
    if (!box || !out) return;
    var text;
    try {
      text = new Date().toLocaleDateString(document.documentElement.lang || undefined, {
        weekday: 'long', day: 'numeric', month: 'long'
      });
    } catch (e) {
      text = new Date().toDateString();
    }
    out.textContent = onScreen(text);
    box.hidden = false;
  }

  // ---------- Notifications: red dot + tile ----------
  // "New" = a notification the person has not yet seen on the Notifications page.
  // The page marks everything as seen when it opens (see parent-portal-notif-feed.js).
  var notifRun = 0;

  function setNotifUI(count) {
    var sub = $('tileNotifSub');
    var badge = $('tileNotifBadge');
    var dot = $('notificationDot');
    if (dot) dot.hidden = !(count > 0);
    if (!sub || !badge) return;
    if (count > 0) {
      sub.textContent = onScreen(fill(tr('unreadN', '{n} unread'), count));
      badge.textContent = String(count);
      badge.hidden = false;
    } else {
      sub.textContent = onScreen(tr('homeNotifNone', 'Nothing new today'));
      badge.hidden = true;
    }
  }

  function renderNotifications() {
    var sub = $('tileNotifSub');
    var badge = $('tileNotifBadge');
    var dot = $('notificationDot');
    var Feed = window.PortalNotifFeed;
    var api = window.PortalAPI;

    // Neutral state until the real answer arrives (no dot guessed in advance)
    if (sub && !sub.textContent) sub.textContent = onScreen(tr('notifKeptNote', 'Showing the last 3 days'));
    if (badge) badge.hidden = true;
    if (dot) dot.hidden = true;
    if (!Feed || !api || !api.childId()) return;

    var run = ++notifRun;
    Feed.load().then(function (items) {
      if (run !== notifRun) return;          // a newer check replaced this one
      setNotifUI(Feed.unseenCount(items));
    }).catch(function () {
      // Offline / server error: leave the dot hidden rather than guess
    });
  }

  // ---------- Messages tile ----------
  function renderMessages() {
    var sub = $('tileMessagesSub');
    var badge = $('tileMessagesBadge');
    if (!sub || !badge) return;
    var Store = window.ChatStore;

    if (!Store) {
      sub.textContent = onScreen(tr('msgSubtitle', 'Chat with your child\u2019s teachers and the school office.'));
      badge.hidden = true;
      return;
    }

    var unread = Store.totalUnread();
    if (unread > 0) {
      sub.textContent = onScreen(fill(tr('unreadN', '{n} unread'), unread));
      badge.textContent = String(unread);
      badge.hidden = false;
    } else {
      sub.textContent = onScreen(tr('caughtUp', 'You\u2019re all caught up'));
      badge.hidden = true;
    }
  }

  function renderAll() {
    renderStudents();
    renderDate();
    renderNotifications();
    renderMessages();
  }

  function boot() {
    renderAll();
    // A fresh child list can arrive after the page's scripts have rendered.
    window.addEventListener('portal-students-updated', function () {
      renderStudents();
      renderNotifications();
    });
    // Live: new messages and receipts while the page is open
    if (window.ChatStore && window.ChatStore.subscribe) window.ChatStore.subscribe(renderMessages);
    // Back button can restore a cached copy of this page
    window.addEventListener('pageshow', function (e) { if (e.persisted) renderAll(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
