/* Unread teacher / parent message count on the "Announcements" sidebar link (every admin page),
 * plus an in-app popup card (inside the page, not a browser notification) when a new message arrives. */
(function () {
    "use strict";
    var API = "https://167-86-120-247.sslip.io/api";
    var badge = document.getElementById("nav-ann-badge");
    if (!badge) return;
    var css = document.createElement("style");
    css.textContent =
        ".nav-badge{margin-left:auto;font-style:normal;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;display:inline-grid;place-items:center}.nav-badge[hidden]{display:none}" +
        "#ann-pop-wrap{position:fixed;top:14px;right:14px;z-index:5000;display:flex;flex-direction:column;gap:10px;width:min(340px,calc(100vw - 28px));pointer-events:none}" +
        ".ann-pop{pointer-events:auto;display:flex;gap:11px;align-items:flex-start;padding:11px 12px;border-radius:14px;cursor:pointer;background:var(--bg-secondary,#16213a);color:var(--text-primary,#fff);border:1px solid var(--border-hover,rgba(255,255,255,.18));box-shadow:0 14px 34px rgba(0,0,0,.4);animation:annIn .28s ease-out;position:relative;overflow:hidden}" +
        ".ann-pop.out{animation:annOut .25s ease-in forwards}" +
        "@keyframes annIn{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}@keyframes annOut{to{opacity:0;transform:translateX(28px)}}" +
        ".ann-pop .av{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:14px;color:#fff;flex-shrink:0;background:var(--accent-teaching,#3b82f6)}" +
        ".ann-pop .av.parent{background:var(--accent-nonteaching,#f59e0b)}" +
        ".ann-pop .tx{flex:1;min-width:0}.ann-pop .tt{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--text-muted,#94a3b8)}" +
        ".ann-pop .tt b{font-size:13px;color:var(--text-primary,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
        ".ann-pop p{margin:2px 0 0;font-size:12.5px;line-height:1.35;color:var(--text-secondary,#cbd5e1);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}" +
        ".ann-pop .x{border:0;background:none;color:var(--text-muted,#94a3b8);font-size:15px;cursor:pointer;line-height:1;padding:0 2px}" +
        ".ann-pop .bar{position:absolute;left:0;bottom:0;height:3px;background:var(--accent-teaching,#3b82f6);width:100%;transform-origin:left;animation:annBar 7s linear forwards}" +
        ".ann-pop:hover .bar{animation-play-state:paused}@keyframes annBar{to{transform:scaleX(0)}}";
    document.head.appendChild(css);

    function paint(n) { badge.hidden = !n; badge.textContent = n > 99 ? "99+" : String(n); }
    window.__annPaintBadge = paint;

    /* in-app popup card: window.__annPopup({ title, body, kind: "teacher"|"parent", onClick }) */
    window.__annPopup = function (o) {
        var wrap = document.getElementById("ann-pop-wrap");
        if (!wrap) { wrap = document.createElement("div"); wrap.id = "ann-pop-wrap"; document.body.appendChild(wrap); }
        while (wrap.children.length >= 4) wrap.removeChild(wrap.firstChild);
        var el = document.createElement("div"); el.className = "ann-pop"; el.setAttribute("role", "status");
        var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
        el.innerHTML = '<div class="av ' + (o.kind === "parent" ? "parent" : "") + '">' + esc(String(o.title || "?").trim().charAt(0).toUpperCase()) + "</div>" +
            '<div class="tx"><div class="tt"><b>' + esc(o.title) + "</b><span>now</span></div><p>" + esc(o.body) + "</p></div>" +
            '<button class="x" type="button" aria-label="Dismiss">&times;</button><span class="bar"></span>';
        var timer;
        function close() { clearTimeout(timer); el.classList.add("out"); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260); }
        function arm() { clearTimeout(timer); timer = setTimeout(close, 7000); }
        el.addEventListener("mouseenter", function () { clearTimeout(timer); });
        el.addEventListener("mouseleave", arm);
        el.addEventListener("click", function (e) { if (e.target.closest(".x")) { close(); return; } close(); if (o.onClick) o.onClick(); });
        wrap.appendChild(el); arm();
    };

    function wantsPopup() { try { return JSON.parse(localStorage.getItem("ann_popup") || "true") !== false; } catch (e) { return true; } }
    function beep() {
        try {
            if (JSON.parse(localStorage.getItem("ann_sound") || "true") === false) return;
            var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
            var c = new AC(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
            o.type = "sine"; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1175, t + 0.12);
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
            o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.36);
        } catch (e) { /* audio blocked until the first click */ }
    }

    var last = -1;
    function alertNew(token, added) {
        beep();
        if (!wantsPopup()) return;
        fetch(API + "/messages/threads", { headers: { Authorization: "Bearer " + token } })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (list) {
                var from = (list || []).filter(function (t) { return t.unread > 0 && t.lastSender !== "ADMIN"; })
                    .sort(function (a, b) { return new Date(b.lastAt) - new Date(a.lastAt); });
                var t = from[0];
                if (!t) return;
                var teacher = t.type === "teacher", multi = from.length > 1;
                var go = function () { location.href = "announcements.html" + (multi ? "" : teacher ? "?staffId=" + encodeURIComponent(t.staffId) : "?regNo=" + encodeURIComponent(t.regNo)); };
                window.__annPopup({
                    kind: t.type,
                    title: multi ? added + " new messages" : (teacher ? (t.staffName || t.staffId) : "Parent of " + (t.studentName || t.regNo)),
                    body: multi ? "Latest from " + (teacher ? (t.staffName || t.staffId) : "Parent of " + (t.studentName || t.regNo)) + ": " + t.lastBody : t.lastBody,
                    onClick: go
                });
            }).catch(function () { /* popup is best effort */ });
    }
    function tick() {
        var token = sessionStorage.getItem("softschool_api_token");
        if (!token || window.__annLive) return;      // the Announcements page does its own faster polling and popups
        fetch(API + "/messages/pulse", { headers: { Authorization: "Bearer " + token } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d || typeof d.unread !== "number") return;
                paint(d.unread);
                if (last >= 0 && d.unread > last) alertNew(token, d.unread - last);
                last = d.unread;
            })
            .catch(function () { /* offline: keep the last number */ });
    }
    tick();
    setInterval(tick, 8000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
})();
