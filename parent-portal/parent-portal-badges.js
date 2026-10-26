// Parent Portal – live badges (the red number / dot on cards and tabs).
//
// Listens to the "portal-pulse" event that parent-portal-push.js fires every few seconds, so the numbers
// change by themselves - the parent never has to refresh the page.
//
//   Messages tab          -> number of unread messages (all children)
//   Announcement card     -> number of announcements this child has not opened yet
//
// Loaded automatically by parent-portal-api.js, so every portal page gets it without editing the page.
// Opening the Announcements page calls PortalBadges.markAnnouncementsSeen(list) to clear its badge.
(function (global) {
  'use strict';

  var API = global.PortalAPI;
  if (!API) return;

  var LAST_KEY = 'portalPulse:last';          // sessionStorage: the last pulse, so a new page shows badges instantly
  var SEEN_PREFIX = 'portalAnnSeen:';         // localStorage: newest announcement id this parent has opened, per child
  var annCache = {};                          // "reg|max|seen" -> count (avoids re-downloading every 5 seconds)
  var annBusy = {};
  var lastPulse = null;

  function ssGet(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function seenOf(reg) {
    try { return Number(localStorage.getItem(SEEN_PREFIX + reg)) || 0; } catch (e) { return 0; }
  }
  function setSeen(reg, id) {
    try { localStorage.setItem(SEEN_PREFIX + reg, String(id)); } catch (e) { /* ignore */ }
  }
  function label(n, what) { return n + ' ' + what; }

  // ---------- one badge element per host ----------
  function setBadge(host, n, what) {
    if (!host) return;
    var b = host.querySelector(':scope > .live-badge');
    if (n > 0) {
      if (!b) {
        b = document.createElement('span');
        b.className = 'live-badge';
        host.appendChild(b);
      }
      b.textContent = n > 99 ? '99+' : String(n);
      b.setAttribute('aria-label', label(n, what));
      b.hidden = false;
    } else if (b) {
      b.hidden = true;
    }
  }

  function setAppIconBadge(n) {
    try {
      if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n);
      else if (navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (e) { /* not supported */ }
  }

  // ---------- messages ----------
  function renderMessages(p) {
    var n = Math.max(0, Number(p && p.unread) || 0);
    var tabs = document.querySelectorAll('.tab-item[href^="parent-portal-messages"]');
    for (var i = 0; i < tabs.length; i++) setBadge(tabs[i], n, 'unread messages');
    setAppIconBadge(n);
  }

  // ---------- announcements ----------
  function renderAnnouncements(p) {
    var cards = document.querySelectorAll('.feature-card[data-feature="announcement"]');
    if (!cards.length) return;
    var reg = String(API.childId() || '');
    var max = Number(p && p.annByChild && p.annByChild[reg]) || 0;
    var seen = seenOf(reg);
    var apply = function (n) {
      for (var i = 0; i < cards.length; i++) setBadge(cards[i], n, 'new announcements');
    };
    if (!reg || max <= seen) { apply(0); return; }

    var key = reg + '|' + max + '|' + seen;
    if (annCache[key] != null) { apply(annCache[key]); return; }
    apply(1);                                           // show a dot right away; the exact number follows
    if (annBusy[key]) return;
    annBusy[key] = true;
    API.get('/children/' + encodeURIComponent(reg) + '/announcements').then(function (list) {
      // First time on this device nothing has been "opened" yet, so only recent ones (the server's isNew) count.
      var n = (list || []).filter(function (a) { return a.id > seen && (seen > 0 || a.isNew); }).length;
      annCache[key] = n;
      if (String(API.childId() || '') === reg) apply(n);
    }).catch(function () { /* keep the dot */ })
      .then(function () { delete annBusy[key]; });
  }

  function render(p) {
    if (!p) return;
    renderMessages(p);
    renderAnnouncements(p);
  }

  // Call from the Announcements page once the list is on screen.
  function markAnnouncementsSeen(list) {
    var reg = String(API.childId() || '');
    if (!reg || !Array.isArray(list)) return;
    var max = 0;
    list.forEach(function (a) { if (a && a.id > max) max = a.id; });
    if (max > seenOf(reg)) setSeen(reg, max);
    if (lastPulse) renderAnnouncements(lastPulse);
    else {
      var cards = document.querySelectorAll('.feature-card[data-feature="announcement"]');
      for (var i = 0; i < cards.length; i++) setBadge(cards[i], 0, 'new announcements');
    }
  }

  global.addEventListener('portal-pulse', function (e) {
    lastPulse = e.detail;
    ssSet(LAST_KEY, lastPulse);
    render(lastPulse);
  });

  function boot() {
    var cached = ssGet(LAST_KEY);
    if (cached) { lastPulse = cached; render(cached); }      // instant: no waiting for the next poll
    if (global.PortalPush && typeof global.PortalPush.last === 'function' && global.PortalPush.last()) {
      lastPulse = global.PortalPush.last();
      render(lastPulse);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  global.addEventListener('pageshow', function (e) { if (e.persisted) boot(); });

  global.PortalBadges = { render: render, markAnnouncementsSeen: markAnnouncementsSeen };
})(window);
