/* Unread teacher / parent message count on the "Announcements" sidebar link (every admin page). */
(function () {
    "use strict";
    var API = "https://167-86-120-247.sslip.io/api";
    var badge = document.getElementById("nav-ann-badge");
    if (!badge) return;
    var st = document.createElement("style");
    st.textContent = ".nav-badge{margin-left:auto;font-style:normal;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;display:inline-grid;place-items:center}.nav-badge[hidden]{display:none}";
    document.head.appendChild(st);
    function paint(n) { badge.hidden = !n; badge.textContent = n > 99 ? "99+" : String(n); }
    window.__annPaintBadge = paint;
    function tick() {
        var token = sessionStorage.getItem("softschool_api_token");
        if (!token || document.hidden || window.__annLive) return;      // the Announcements page does its own faster polling
        fetch(API + "/messages/pulse", { headers: { Authorization: "Bearer " + token } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { if (d && typeof d.unread === "number") paint(d.unread); })
            .catch(function () { /* offline: keep the last number */ });
    }
    tick();
    setInterval(tick, 15000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
})();
