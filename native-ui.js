/* ── APP: KEEP USERS LOGGED IN (Android app only) ──
   • Saves the login session so it survives closing the app / restarting the phone.
   • On launch, opens the user's own account (school / teacher / parent) instead of
     the login page. The login page only shows again after Logout, or after the
     app is uninstalled and reinstalled. */
(function () {
  var native = false;
  try {
    var C0 = window.Capacitor;
    native = !!(C0 && typeof C0.isNativePlatform === "function" && C0.isNativePlatform());
    if (!native && location.hostname === "localhost" && /;\s*wv\)/.test(navigator.userAgent)) native = true;
  } catch (e) {}
  if (!native) return;

  var root = document.documentElement;
  var BACKUP = "__softschool_ss_backup";   // copy of sessionStorage that survives restarts
  var PORTAL = "__softschool_last_portal"; // where to open the app next time
  var SKIP = { softschool_splash_seen: 1 };// the splash must play on every launch
  var ls, ss;
  try { ls = window.localStorage; ss = window.sessionStorage; } catch (e) { return; }

  var isIndex = /(^|\/)(index\.html)?$/.test(location.pathname);
  var cameFromSite = false;
  try { cameFromSite = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) {}

  /* Arriving at the login page from another page of the app means the user
     logged out (or the portal rejected the session): forget everything. */
  if (isIndex && cameFromSite) {
    try { ls.removeItem(PORTAL); ls.removeItem(BACKUP); } catch (e) {}
  }

  /* 1. Restore the session after the app was closed */
  function snapshot() {
    try {
      var o = {};
      for (var i = 0; i < ss.length; i++) {
        var k = ss.key(i);
        if (!SKIP[k]) o[k] = ss.getItem(k);
      }
      ls.setItem(BACKUP, JSON.stringify(o));
    } catch (e) {}
  }
  try {
    if (ss.length === 0) {
      var raw = ls.getItem(BACKUP);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var key in saved) if (!SKIP[key]) ss.setItem(key, saved[key]);
      }
    }
  } catch (e) {}

  /* 2. From now on, mirror every sessionStorage change (login saves, logout clears) */
  try {
    var SP = Storage.prototype, oSet = SP.setItem, oRem = SP.removeItem, oClr = SP.clear;
    SP.setItem = function (k, v) { oSet.call(this, k, v); if (this === ss) snapshot(); };
    SP.removeItem = function (k) { oRem.call(this, k); if (this === ss) snapshot(); };
    SP.clear = function () { oClr.call(this); if (this === ss) snapshot(); };
    window.addEventListener("pagehide", snapshot);
    document.addEventListener("visibilitychange", function () { if (document.hidden) snapshot(); });
  } catch (e) {}

  /* 3. Remember which account the user is in */
  function homeFor(p) {
    if (/superadmin/i.test(p) || /change-password/i.test(p)) return null;
    var origin = location.origin;
    var i = p.search(/parent-portal\//i);
    if (i >= 0) return origin + p.substring(0, i) + "parent-portal/parent-portal-index.html";
    var dir = p.replace(/[^\/]*$/, "");
    if (/teacher-portal/i.test(p)) return origin + dir + "teacher-portal.html";
    if (/\/(main|manage-[a-z]+|attendance|reports|settings)\.html$/i.test(p)) return origin + dir + "main.html";
    return null;
  }
  if (!isIndex) {
    var home = homeFor(location.pathname);
    if (home) setTimeout(function () { try { ls.setItem(PORTAL, home); } catch (e) {} }, 1500);
    return;
  }

  /* 4. App launch on the login page: go straight to the saved account */
  if (cameFromSite) return;
  var target = null;
  try { target = ls.getItem(PORTAL); } catch (e) {}
  if (!target) return;

  root.classList.add("app-routing");   // hides the login screen (see index.css)
  setTimeout(function () { root.classList.remove("app-routing"); }, 12000);  // never get stuck

  // School accounts use the existing "Remember Me" sign-in in index.js
  // (it also refreshes the server token). Teachers and parents go straight in.
  var schoolWithToken = /\/main\.html$/i.test(target) && !!ls.getItem("softschool_remember");
  if (schoolWithToken) return;

  var went = false;
  function go() {
    if (went) return; went = true;
    try { location.replace(target); } catch (e) { root.classList.remove("app-routing"); }
  }
  if (root.classList.contains("splash-skip")) go();
  else {
    document.addEventListener("splash:done", go, { once: true });
    setTimeout(go, 4500);
  }
})();

/* ── NATIVE APP: system bars follow the screen ──
   Android app only (does nothing in a browser).
   • Splash screen and login animation: top and bottom bars take the dark
     green of the animation, with white icons.
   • Everywhere else: bars match the page background (light / dark mode).
   Uses SoftSchoolBars from MainActivity.java. */
(function () {
  if (window.__nativeUiLoaded) return;
  window.__nativeUiLoaded = true;

  var C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== "function" || !C.isNativePlatform()) return;
  var P = C.Plugins || {};
  var root = document.documentElement;

  var SPLASH_COLOR = "#0B2B28";   // edge color of the splash gradient
  var LOADER_COLOR = "#07201D";   // edge color of the login animation
  var HOLD_MS = 480;              // keep the dark bars while the overlay fades out

  var last = "";
  var overlayHex = null, overlaySeen = 0;

  function parse(str) {
    var m = /rgba?\(([^)]+)\)/.exec(str || "");
    if (!m) return null;
    var p = m[1].split(",").map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function fromHex(h) {
    return { r: parseInt(h.substr(1, 2), 16), g: parseInt(h.substr(3, 2), 16), b: parseInt(h.substr(5, 2), 16), a: 1 };
  }
  function hex(n) { return ("0" + Math.round(n).toString(16)).slice(-2); }
  function safe(fn) { try { var r = fn(); if (r && r.catch) r.catch(function () {}); } catch (e) {} }

  function isIndexPage() { return /(^|\/)(index\.html)?$/.test(location.pathname); }

  // Which full-screen animation (if any) is showing right now?
  function currentOverlay() {
    var sp = document.getElementById("splash");
    if (sp && !sp.classList.contains("splash-hide") && root.classList.contains("splash-on")) return SPLASH_COLOR;
    // very first moments of the app: splash is about to appear
    if (!sp && document.readyState === "loading" && isIndexPage() && !root.classList.contains("splash-skip")) return SPLASH_COLOR;
    if (document.querySelector(".login-loader.open")) return LOADER_COLOR;
    return null;
  }

  function pageColor() {
    var els = [document.body, root];
    for (var i = 0; i < els.length; i++) {
      if (!els[i]) continue;
      var c = parse(getComputedStyle(els[i]).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function target() {
    var now = Date.now();
    var o = currentOverlay();
    if (o) { overlayHex = o; overlaySeen = now; return fromHex(o); }
    // overlay just finished: keep its color until it has faded out
    if (overlayHex && now - overlaySeen < HOLD_MS) {
      setTimeout(sync, HOLD_MS - (now - overlaySeen) + 30);
      return fromHex(overlayHex);
    }
    return pageColor();
  }

  function sync() {
    var c = target();
    var color = "#" + hex(c.r) + hex(c.g) + hex(c.b);
    if (color === last) return;
    last = color;
    var isDark = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b < 140;

    if (window.SoftSchoolBars && typeof window.SoftSchoolBars.setBars === "function") {
      try { window.SoftSchoolBars.setBars(color, !isDark); } catch (e) {}
      return;
    }
    if (P.StatusBar) {
      safe(function () { return P.StatusBar.setBackgroundColor({ color: color }); });
      safe(function () { return P.StatusBar.setStyle({ style: isDark ? "DARK" : "LIGHT" }); });
    }
    if (P.NavigationBar && P.NavigationBar.setNavigationBarColor) {
      safe(function () { return P.NavigationBar.setNavigationBarColor({ color: color, darkButtons: !isDark }); });
    }
  }

  var pending = {};
  function later(ms) {
    if (pending[ms]) return;
    pending[ms] = setTimeout(function () { pending[ms] = null; sync(); }, ms);
  }
  function syncSoon() { later(20); later(150); later(500); later(1000); }

  // set the right color immediately (splash on the index page)
  sync();

  function start() {
    syncSoon();
    try {
      // theme toggle on <html>/<body>
      var themeObs = new MutationObserver(syncSoon);
      var o1 = { attributes: true, attributeFilter: ["class", "data-theme", "data-bs-theme", "style"] };
      themeObs.observe(root, o1);
      if (document.body) themeObs.observe(document.body, o1);
      // overlays appearing / disappearing anywhere in the page
      var overlayObs = new MutationObserver(function () { later(20); });
      overlayObs.observe(document.body || root, { attributes: true, attributeFilter: ["class"], subtree: true, childList: true });
    } catch (e) {}
    document.addEventListener("click", function () { later(60); later(400); }, true);
    setInterval(sync, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.addEventListener("load", syncSoon);
})();


/* ── PULL TO REFRESH (Android app, logged-in pages) ──
   Swipe down from the top of any page to reload it, like the YouTube app.
   Not active on the login page (index.html). */
(function () {
  var C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== "function" || !C.isNativePlatform()) return;
  if (/(^|\/)(index\.html)?$/.test(location.pathname)) return;   // login page
  if (window.__ptrLoaded) return;
  window.__ptrLoaded = true;

  var THRESHOLD = 70;   // how far to pull (px) before it refreshes
  var MAX_PULL = 130;
  var SIZE = 42;

  var css = document.createElement("style");
  css.textContent =
    "html,body{overscroll-behavior-y:contain;}" +
    "#ptr{position:fixed;left:50%;top:0;width:" + SIZE + "px;height:" + SIZE + "px;margin-left:-" + (SIZE / 2) + "px;" +
    "border-radius:50%;z-index:2147483000;display:flex;align-items:center;justify-content:center;" +
    "box-shadow:0 4px 14px rgba(0,0,0,.28);opacity:0;pointer-events:none;will-change:transform,opacity;}" +
    "#ptr i{display:block;width:22px;height:22px;border-radius:50%;border:3px solid #1E8F86;border-top-color:transparent;box-sizing:border-box;}" +
    "#ptr.spin i{animation:ptrSpin .7s linear infinite;}" +
    "@keyframes ptrSpin{to{transform:rotate(360deg);}}";
  document.head.appendChild(css);

  var box = document.createElement("div");
  box.id = "ptr";
  box.setAttribute("aria-hidden", "true");
  var ring = document.createElement("i");
  box.appendChild(ring);

  function mount() { if (!box.parentNode && document.body) document.body.appendChild(box); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  var startY = 0, startX = 0, pull = 0, tracking = false, pulling = false, busy = false, atTop = false;

  function safeTop() {
    // sit just below the notch / status area (0 when the webview already starts below it)
    var d = document.createElement("div");
    d.style.cssText = "position:fixed;top:0;height:env(safe-area-inset-top,0px);visibility:hidden;";
    document.body.appendChild(d);
    var h = d.offsetHeight; d.remove();
    return h || 0;
  }

  function pageIsDark() {
    var els = [document.body, document.documentElement];
    for (var i = 0; i < els.length; i++) {
      var m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(els[i]).backgroundColor || "");
      if (m) {
        var p = m[1].split(",").map(parseFloat);
        if (p.length < 4 || p[3] > 0.5) return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] < 140;
      }
    }
    return false;
  }

  function scrolledUp(el) {
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.scrollTop > 0) return true;
      el = el.parentElement;
    }
    var mains = document.querySelectorAll("main, .main-content, #main-content, .content-area, .page-content");
    for (var i = 0; i < mains.length; i++) if (mains[i].scrollTop > 0) return true;
    return (window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0) > 0;
  }

  function blocked(el) {
    if (!el || !el.closest) return false;
    if (el.closest("input, textarea, select, [contenteditable='true'], .modal-overlay.open, [role='dialog'], .login-loader.open")) return true;
    return false;
  }

  function draw(y, rotateDeg, opacity, animate) {
    box.style.transition = animate ? "transform .25s ease, opacity .2s ease" : "none";
    box.style.transform = "translateY(" + y + "px) rotate(" + rotateDeg + "deg)";
    box.style.opacity = opacity;
  }

  function reset() {
    pulling = false; pull = 0;
    box.classList.remove("spin");
    draw(-SIZE, 0, 0, true);
  }

  document.addEventListener("touchstart", function (e) {
    if (busy || e.touches.length !== 1) { tracking = false; return; }
    var t = e.target;
    if (blocked(t)) { tracking = false; return; }
    atTop = !scrolledUp(t);
    tracking = atTop;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    pull = 0; pulling = false;
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (!tracking || busy) return;
    var dy = e.touches[0].clientY - startY;
    var dx = e.touches[0].clientX - startX;

    if (!pulling) {
      if (dy < 8) { if (dy < -8) tracking = false; return; }          // scrolling up / not pulling
      if (Math.abs(dx) > dy) { tracking = false; return; }            // mostly sideways (tables, sliders)
      if (scrolledUp(e.target)) { tracking = false; return; }
      pulling = true;
      mount();
      box.style.background = pageIsDark() ? "#1F2937" : "#FFFFFF";
      ring.style.borderColor = "#1E8F86"; ring.style.borderTopColor = "transparent";
    }

    if (e.cancelable) e.preventDefault();
    pull = Math.min(MAX_PULL, dy * 0.5);
    var progress = Math.min(1, pull / THRESHOLD);
    var y = safeTop() + 8 + pull * 0.7 - SIZE * (1 - progress);
    draw(y, progress * 270, progress, false);
  }, { passive: false });

  function end() {
    if (!tracking && !pulling) return;
    tracking = false;
    if (!pulling) return;
    if (pull >= THRESHOLD && !busy) {
      busy = true;
      box.classList.add("spin");
      draw(safeTop() + 8 + 30, 0, 1, true);
      setTimeout(function () { location.reload(); }, 450);
    } else {
      reset();
    }
  }
  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", end, { passive: true });

  draw(-SIZE, 0, 0, false);
})();
