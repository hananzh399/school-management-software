/*!
 * mobile-ui.js - phone-only helpers for the admin pages
 * (Manage Students, Manage Staff, Attendance). Pair it with mobile-ui.css.
 *
 *  1. THREE-DOT MENUS: the extra buttons of a toolbar / page header are moved into a "⋮" menu.
 *     The buttons are only MOVED (never cloned or rewritten), so every existing click handler keeps
 *     working. When the screen gets wider than a phone they are put back exactly where they were.
 *  2. BACK BUTTON: the CSS pins the back button to the upper-left; this script makes sure only the
 *     top-most visible one is shown, gives it an accessible name, and leaves room in the page header.
 *
 * To put another button into a three-dot menu, add its selector to MENU_ITEMS below.
 * To keep a button visible instead, just don't list it.
 */
(function () {
  'use strict';
  if (window.__muLoaded) return;
  window.__muLoaded = true;

  var MAX_WIDTH = 768;
  var mq = window.matchMedia ? window.matchMedia('(max-width: ' + MAX_WIDTH + 'px)') : null;
  if (!mq) return;

  // ───────────── what goes into a ⋮ menu (edit here) ─────────────
  var MENU_ITEMS = [
    // Attendance
    '.stage-header .view-attendance-btn',          // "View Attendance", "Send Report to Parents"
    '.bulk-actions .bulk-btn',                     // All Present / All Absent / All Leave / Link Biometric
    '.view-actions .bulk-btn',                     // Print / Share (view page)
    '#open-report-btn', '#open-staff-report-btn',  // "Generate Attendance Report" buttons
    '#open-student-report-btn', '#open-staff-individual-report-btn',
    '#staff-monthly-print-btn', '#staff-monthly-share-btn', '#monthly-send-report-btn',
    // Manage Staff
    '.table-controls-actions .btn:not(#add-staff-btn)',   // Archive Center, Generate ID Cards
    '.profile-actions .btn',                               // Certificate, Edit, Reactivate, Deactivate
    '.agreement-modal-footer > .btn:not(.btn-cancel)',     // Share / Download / Print on the staff certificate + agreement windows
    // Manage Students
    '.msc-stage-header .idc-generate-btn',                 // Generate ID Cards
    '.upd-action-btns .btn-secondary',                     // Promote
    '.profile-action-btns > button',                       // Share / Print Record / Print Admission Form
    '.slc-modal-footer > .btn-primary-submit',             // Share / Print on the certificate windows
    // full-screen ID card / certificate viewers
    '.idc-toolbar-actions > button:not(.cert-viewer-close)', '.sidc-toolbar-actions > button:not(.cert-viewer-close)',
    '.cert-viewer-actions > button:not(.cert-viewer-close)'
  ];

  // the row a group of buttons belongs to (the ⋮ button is added at the end of this row)
  var HOSTS = '.agreement-modal-footer, .profile-action-btns, .slc-modal-footer, .profile-actions, .view-actions, .bulk-actions, .table-controls-actions, ' +
              '.upd-action-btns, .idc-toolbar-actions, .sidc-toolbar-actions, .cert-viewer-actions, ' +
              '.stage-header, .msc-stage-header, .view-header, .toolbar';

  var BACK = '.back-btn, .msc-back-btn, .cert-back-btn';

  var ITEM_SEL = MENU_ITEMS.join(',');
  var groups = [];            // [{host, wrap, btn, menu, items:[{el, parent, next}]}]
  var openGroup = null;

  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ───────────── build / remove the ⋮ menus ─────────────
  function build() {
    var found = qsa(ITEM_SEL).filter(function (el) { return !el.__muMoved; });
    if (!found.length) return;

    found.forEach(function (el) {
      var host = el.closest(HOSTS);
      if (!host) return;
      var g = null;
      for (var i = 0; i < groups.length; i++) { if (groups[i].host === host) { g = groups[i]; break; } }
      if (!g) g = makeGroup(host);
      g.items.push({ el: el, parent: el.parentNode, next: el.nextSibling });
      el.__muMoved = true;
      g.menu.appendChild(el);
    });
    groups.forEach(refresh);
  }

  function makeGroup(host) {
    var wrap = document.createElement('div');
    wrap.className = 'mu-more-wrap';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mu-more';
    btn.setAttribute('aria-label', 'More actions');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<i class="fas fa-ellipsis-vertical" aria-hidden="true"></i>';
    var menu = document.createElement('div');
    menu.className = 'mu-menu';
    menu.setAttribute('role', 'menu');
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    host.appendChild(wrap);

    var g = { host: host, wrap: wrap, btn: btn, menu: menu, items: [] };
    groups.push(g);

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (openGroup === g) closeMenu(); else openMenu(g);
    });
    // choosing an item closes the menu (the item's own click handler still runs)
    menu.addEventListener('click', function () { setTimeout(closeMenu, 0); });

    // hide the ⋮ when every button inside is hidden by the page (e.g. "Send Report" not available yet)
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () { refresh(g); });
      mo.observe(menu, { attributes: true, subtree: true, attributeFilter: ['style', 'class', 'hidden'] });
      g.observer = mo;
    }
    return g;
  }

  function refresh(g) {
    var any = g.items.some(function (it) {
      return window.getComputedStyle(it.el).display !== 'none';
    });
    g.wrap.classList.toggle('mu-empty', !any);
  }

  function teardown() {
    closeMenu();
    groups.forEach(function (g) {
      if (g.observer) g.observer.disconnect();
      // put every button back exactly where it was
      for (var i = g.items.length - 1; i >= 0; i--) {
        var it = g.items[i];
        if (it.parent) {
          if (it.next && it.next.parentNode === it.parent) it.parent.insertBefore(it.el, it.next);
          else it.parent.appendChild(it.el);
        }
        it.el.__muMoved = false;
      }
      if (g.wrap.parentNode) g.wrap.parentNode.removeChild(g.wrap);
    });
    groups = [];
  }

  // ───────────── open / close ─────────────
  function openMenu(g) {
    closeMenu();
    refresh(g);
    if (g.wrap.classList.contains('mu-empty')) return;
    var r = g.btn.getBoundingClientRect();
    g.wrap.classList.add('mu-open');
    g.btn.setAttribute('aria-expanded', 'true');
    g.menu.style.top = Math.round(r.bottom + 6) + 'px';
    g.menu.style.right = Math.max(10, Math.round(window.innerWidth - r.right)) + 'px';
    // keep it on screen if the button is near the bottom
    var mh = g.menu.offsetHeight;
    if (r.bottom + 6 + mh > window.innerHeight - 8) {
      g.menu.style.top = Math.max(8, Math.round(r.top - 6 - mh)) + 'px';
    }
    openGroup = g;
  }

  function closeMenu() {
    if (!openGroup) return;
    openGroup.wrap.classList.remove('mu-open');
    openGroup.btn.setAttribute('aria-expanded', 'false');
    openGroup = null;
  }

  document.addEventListener('click', function (e) {
    if (openGroup && !openGroup.wrap.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('scroll', closeMenu, { passive: true, capture: true });
  window.addEventListener('resize', closeMenu);

  // ───────────── back button: only the top-most visible one is shown ─────────────
  function isShown(el) { return el.getClientRects().length > 0; }

  function updateBack() {
    var body = document.body;
    if (!body) return;
    var all = qsa(BACK);
    if (!mq.matches) {
      body.classList.remove('mu-has-back');
      all.forEach(function (b) { b.classList.remove('mu-back-hidden'); });
      return;
    }
    var shown = all.filter(isShown);
    var top = shown.length ? shown[shown.length - 1] : null;   // later in the page = opened on top
    all.forEach(function (b) {
      b.classList.toggle('mu-back-hidden', !!top && b !== top);
      if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', (b.textContent || 'Back').replace(/\s+/g, ' ').trim() || 'Back');
    });
    body.classList.toggle('mu-has-back', !!top);
  }

  // ───────────── keep everything in sync ─────────────
  var raf = 0, rebuildTimer = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; updateBack(); });
  }

  function start() {
    if (mq.matches) build();
    updateBack();

    if (window.MutationObserver) {
      // page changes (stages shown / hidden, rows drawn): refresh back button, pick up new buttons
      new MutationObserver(function () {
        schedule();
        if (!mq.matches) return;
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(build, 350);
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    }
  }

  function onModeChange() {
    if (mq.matches) build(); else teardown();
    updateBack();
  }
  if (mq.addEventListener) mq.addEventListener('change', onModeChange);
  else if (mq.addListener) mq.addListener(onModeChange);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
