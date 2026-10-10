/* Unread teacher / parent message count on the "Announcements" sidebar link (every admin page),
 * plus a browser notification when a new message arrives while you are on another admin page. */
(function () {
    "use strict";
    var API = "https://167-86-120-247.sslip.io/api";
    var badge = document.getElementById("nav-ann-badge");
    if (!badge) return;
    var st = document.createElement("style");
    st.textContent = ".nav-badge{margin-left:auto;font-style:normal;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;display:inline-grid;place-items:center}.nav-badge[hidden]{display:none}";
    document.head.appendChild(st);
    var last = -1;
    function paint(n) { badge.hidden = !n; badge.textContent = n > 99 ? "99+" : String(n); }
    window.__annPaintBadge = paint;
    function wantsNotify() {
        try { return JSON.parse(localStorage.getItem("ann_notify") || "false") && "Notification" in window && Notification.permission === "granted"; } catch (e) { return false; }
    }
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
    function alertNew(n, added) {
        beep();
        if (!wantsNotify()) return;
        try {
            var note = new Notification(added === 1 ? "New message" : added + " new messages", { body: n + " unread in Announcements", icon: "logo-icon.png", tag: "ann-badge" });
            note.onclick = function () { window.focus(); location.href = "announcements.html"; };
        } catch (e) { /* some mobile browsers need a service worker */ }
    }
    function tick() {
        var token = sessionStorage.getItem("softschool_api_token");
        if (!token || window.__annLive) return;      // the Announcements page does its own faster polling and alerts
        fetch(API + "/messages/pulse", { headers: { Authorization: "Bearer " + token } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d || typeof d.unread !== "number") return;
                paint(d.unread);
                if (last >= 0 && d.unread > last) alertNew(d.unread, d.unread - last);
                last = d.unread;
            })
            .catch(function () { /* offline: keep the last number */ });
    }
    tick();
    setInterval(tick, 15000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
})();
