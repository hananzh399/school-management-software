/* Announcements & Messages (admin): real-time chat with teachers and parents. */
(function () {
    "use strict";
    var API = "https://167-86-120-247.sslip.io/api";
    var POLL_MS = 4000;
    var $ = function (s) { return document.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
    var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

    var school = {};
    try { school = (window.SoftSchoolAdmin && window.SoftSchoolAdmin.getCurrentSchool && window.SoftSchoolAdmin.getCurrentSchool()) || {}; } catch (e) { /* ignore */ }
    var schoolId = school.schoolId || "";

    var state = { threads: [], filter: "all", q: "", active: null, msgs: [], pulse: { lastId: -1, unread: -1 }, dir: null, who: "teacher", sending: false, drafts: {}, online: true };
    window.__annLive = true;

    /* ───────── API ───────── */
    function api(path, opt) {
        var token = sessionStorage.getItem("softschool_api_token") || "";
        opt = opt || {};
        opt.headers = Object.assign({ "Content-Type": "application/json", Authorization: "Bearer " + token }, opt.headers || {});
        return fetch(API + path, opt).then(function (res) {
            if (res.status === 401) { location.replace("index.html"); throw new Error("401"); }
            if (!res.ok) return res.text().then(function (t) { var m = t; try { m = JSON.parse(t).error || t; } catch (e) { /* plain */ } throw new Error(m || "HTTP " + res.status); });
            return res.status === 204 ? {} : res.json().catch(function () { return {}; });
        });
    }
    function toast(msg, isErr) {
        var t = $("#am-toast"); t.textContent = msg; t.className = "am-toast" + (isErr ? " err" : ""); t.hidden = false;
        clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3200);
    }

    /* ───────── formatting ───────── */
    function when(iso) {
        var d = new Date(iso), n = new Date(), y = new Date(n); y.setDate(n.getDate() - 1);
        if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        if (d.toDateString() === y.toDateString()) return "Yesterday";
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    function dayLabel(iso) {
        var d = new Date(iso), n = new Date(), y = new Date(n); y.setDate(n.getDate() - 1);
        if (d.toDateString() === n.toDateString()) return "Today";
        if (d.toDateString() === y.toDateString()) return "Yesterday";
        return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    }
    var clock = function (iso) { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
    var initial = function (n) { return esc(String(n || "?").trim().charAt(0).toUpperCase() || "?"); };
    function guardianLine(t) { return (t.guardianRole ? t.guardianRole : "Father/Guardian") + ": " + (t.guardianName || "—"); }

    /* ───────── conversation descriptors ───────── */
    function descOfThread(t) {
        return t.type === "teacher"
            ? { key: t.key, type: "teacher", staffId: t.staffId, name: t.staffName || t.staffId }
            : { key: t.key, type: "parent", regNo: t.regNo, studentName: t.studentName, guardianName: t.guardianName, guardianRole: t.guardianRole, className: t.className };
    }
    function threadTitle(t) { return t.type === "teacher" ? (t.staffName || t.staffId) : "Parent of " + (t.studentName || t.regNo); }
    function threadSub(t) {
        return t.type === "teacher"
            ? "Teacher · ID " + t.staffId
            : guardianLine(t) + " · " + t.regNo + (t.className ? " · " + t.className : "");
    }

    /* ───────── conversation list ───────── */
    function visibleThreads() {
        var q = state.q.trim().toLowerCase();
        return state.threads.filter(function (t) {
            if (state.filter !== "all" && t.type !== state.filter) return false;
            if (!q) return true;
            return [t.staffName, t.staffId, t.studentName, t.guardianName, t.regNo, t.className].join(" ").toLowerCase().indexOf(q) >= 0;
        });
    }
    function renderThreads() {
        var un = { all: 0, teacher: 0, parent: 0 };
        state.threads.forEach(function (t) { un.all += t.unread; un[t.type] += t.unread; });
        ["all", "teacher", "parent"].forEach(function (k) { $("#cnt-" + k).textContent = un[k] ? (un[k] > 99 ? "99+" : un[k]) : ""; });
        $$("#am-tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.f === state.filter); });
        var list = visibleThreads(), box = $("#am-threads");
        if (!list.length) {
            box.innerHTML = '<div class="am-empty"><i class="fas fa-comments"></i><b>' + (state.threads.length ? "No match" : "No conversations yet") + '</b>' + (state.threads.length ? "Try a different search." : "Messages from teachers and parents appear here. Use <b style='display:inline'>New message</b> to start one.") + "</div>";
            return;
        }
        box.innerHTML = list.map(function (t) {
            var mine = t.lastSender === "ADMIN";
            return '<button class="am-th ' + (state.active && state.active.key === t.key ? "on" : "") + '" data-key="' + esc(t.key) + '">' +
                '<div class="am-av ' + t.type + '">' + initial(t.type === "teacher" ? t.staffName : t.studentName) + "</div>" +
                '<div class="am-tx"><div class="l1"><b>' + esc(threadTitle(t)) + "</b><small>" + when(t.lastAt) + "</small></div>" +
                '<span class="id ' + (t.type === "parent" ? "parent-id" : "") + '">' + esc(threadSub(t)) + "</span>" +
                '<div class="l2"><span>' + (mine ? "You: " : "") + esc(t.lastBody) + "</span>" + (t.unread ? '<i class="am-cnt" style="font-style:normal">' + (t.unread > 99 ? "99+" : t.unread) + "</i>" : "") + "</div></div></button>";
        }).join("");
    }
    function loadThreads() {
        return api("/messages/threads").then(function (list) {
            state.threads = Array.isArray(list) ? list : [];
            renderThreads();
            var total = state.threads.reduce(function (a, t) { return a + t.unread; }, 0);
            if (window.__annPaintBadge) window.__annPaintBadge(total);
        });
    }

    /* ───────── open chat ───────── */
    function chatQuery(d) { return d.type === "teacher" ? "?staffId=" + encodeURIComponent(d.staffId) : "?regNo=" + encodeURIComponent(d.regNo); }
    function renderChatShell() {
        var d = state.active, c = $("#am-chat");
        if (!d) {
            c.innerHTML = '<div class="am-empty"><i class="fas fa-comments"></i><b>Select a conversation</b>Pick a teacher or parent on the left, or start a new message.</div>';
            return;
        }
        var t = state.threads.filter(function (x) { return x.key === d.key; })[0];
        var title = d.type === "teacher" ? d.name : "Parent of " + (d.studentName || d.regNo);
        var sub = d.type === "teacher" ? "Teacher · ID " + d.staffId : guardianLine(d) + " · " + d.regNo + (d.className ? " · " + d.className : "");
        c.innerHTML =
            '<div class="am-head"><button class="am-back" id="am-back" aria-label="Back"><i class="fas fa-arrow-left"></i></button>' +
            '<div class="am-av ' + d.type + '">' + initial(d.type === "teacher" ? d.name : d.studentName) + "</div>" +
            '<div class="meta"><b>' + esc(title) + "</b><span>" + esc(sub) + '</span></div><span class="am-live' + (state.online ? "" : " off") + '" id="am-live">' + (state.online ? "Live" : "Offline") + "</span></div>" +
            '<div class="am-body" id="am-body"></div>' +
            '<div class="am-compose"><textarea id="am-in" rows="1" maxlength="1000" placeholder="Write a reply…">' + esc(state.drafts[d.key] || "") + '</textarea><button class="am-send" id="am-send" aria-label="Send"><i class="fas fa-paper-plane"></i></button></div>' +
            '<div class="am-hint">Enter to send · Shift+Enter for a new line</div>';
        renderMessages(true);
        grow($("#am-in"));
    }
    function renderMessages(forceBottom) {
        var body = $("#am-body"); if (!body) return;
        var near = body.scrollHeight - body.scrollTop - body.clientHeight < 100, top = body.scrollTop;
        if (!state.msgs.length) {
            body.innerHTML = '<div class="am-empty"><i class="fas fa-paper-plane"></i><b>No messages yet</b>Write below to start the conversation.</div>';
            return;
        }
        var html = "", last = "";
        state.msgs.forEach(function (m) {
            var dl = dayLabel(m.createdAt); if (dl !== last) { html += '<div class="am-day">' + dl + "</div>"; last = dl; }
            var me = m.senderType === "ADMIN";
            var who = me ? "" : '<span class="who">' + esc(m.senderType === "PARENT" ? (m.guardianName || "Parent") + " (parent)" : (m.senderName || "Teacher")) + "</span>";
            html += '<div class="am-b ' + (me ? "me" : "them") + (m.pending ? " sending" : "") + '">' + who + "<p>" + esc(m.body) + '</p><span class="t">' + clock(m.createdAt) + (me ? (m.pending ? " ⏱" : " ✓") : "") + "</span></div>";
        });
        body.innerHTML = html;
        body.scrollTop = (forceBottom || near) ? body.scrollHeight : top;
    }
    function loadMessages(forceBottom) {
        var d = state.active; if (!d) return Promise.resolve();
        var key = d.key;
        return api("/messages" + chatQuery(d)).then(function (list) {
            if (!state.active || state.active.key !== key) return;                     // user switched chats while loading
            list = (Array.isArray(list) ? list : []).slice().sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
            var pend = state.msgs.filter(function (m) { return m.pending; });
            state.msgs = list.concat(pend);
            // the teacher / parent details can come from the messages themselves (new chats started from a search)
            renderMessages(forceBottom);
            if (list.some(function (m) { return m.senderType !== "ADMIN" && !m.readByAdmin; })) {
                api("/messages/read", { method: "POST", body: JSON.stringify(d.type === "teacher" ? { staffId: d.staffId } : { regNo: d.regNo }) })
                    .then(loadThreads).catch(function () { /* retried on next change */ });
            }
        });
    }
    function open(desc) {
        if (state.active) state.drafts[state.active.key] = ($("#am-in") || {}).value || state.drafts[state.active.key] || "";
        state.active = desc; state.msgs = [];
        $("#am-wrap").classList.add("chat-open");
        renderThreads(); renderChatShell();
        loadMessages(true).catch(function (e) { if (e.message !== "401") toast("Could not load the chat.", true); });
        var inp = $("#am-in"); if (inp && window.innerWidth > 860) inp.focus();
    }
    function grow(ta) { if (!ta) return; ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; }

    function send() {
        var d = state.active, ta = $("#am-in"); if (!d || !ta || state.sending) return;
        var text = ta.value.trim(); if (!text) return;
        state.sending = true; $("#am-send").disabled = true;
        var tmp = { id: null, senderType: "ADMIN", body: text, createdAt: new Date().toISOString(), pending: true };
        state.msgs.push(tmp); ta.value = ""; state.drafts[d.key] = ""; grow(ta); renderMessages(true);
        var payload = d.type === "teacher" ? { staffId: d.staffId, body: text } : { regNo: d.regNo, body: text };
        payload.senderName = school.name || "Admin";
        api("/messages", { method: "POST", body: JSON.stringify(payload) })
            .then(function () { state.msgs = state.msgs.filter(function (m) { return m !== tmp; }); return Promise.all([loadMessages(true), loadThreads()]); })
            .catch(function (e) {
                state.msgs = state.msgs.filter(function (m) { return m !== tmp; });
                if (e.message !== "401") { toast(e.message || "Could not send.", true); if ($("#am-in")) { $("#am-in").value = text; grow($("#am-in")); } }
                renderMessages(true);
            })
            .then(function () { state.sending = false; var b = $("#am-send"); if (b) b.disabled = false; });
    }

    /* ───────── live updates (polls a tiny endpoint; reloads only when something changed) ───────── */
    function setOnline(on) {
        if (state.online === on) return; state.online = on;
        var l = $("#am-live"); if (l) { l.textContent = on ? "Live" : "Offline"; l.classList.toggle("off", !on); }
    }
    function tick() {
        if (document.hidden) return;
        api("/messages/pulse").then(function (p) {
            setOnline(true);
            var changed = p.lastId !== state.pulse.lastId || p.unread !== state.pulse.unread;
            state.pulse = p;
            if (changed) { loadThreads().catch(function () {}); if (state.active) loadMessages(false).catch(function () {}); }
        }).catch(function (e) { if (e.message !== "401") setOnline(false); });
    }

    /* ───────── new message picker (any teacher / any parent) ───────── */
    function loadDirectory() {
        if (state.dir) return Promise.resolve(state.dir);
        var q = "?schoolId=" + encodeURIComponent(schoolId);
        return Promise.all([api("/staff/summary" + q), api("/students/summary" + q)]).then(function (r) {
            state.dir = {
                teachers: (r[0] || []).filter(function (s) { return String(s.type || "").toLowerCase() === "teaching"; }),
                students: (r[1] || []).filter(function (s) { return !s.status || String(s.status).toLowerCase() === "active"; })
            };
            return state.dir;
        });
    }
    function renderPicker() {
        var box = $("#am-pick"), q = $("#pick-q").value.trim().toLowerCase();
        if (!state.dir) { box.innerHTML = '<div class="am-empty">Loading…</div>'; return; }
        var rows;
        if (state.who === "teacher") {
            rows = state.dir.teachers.filter(function (s) { return !q || (s.name + " " + s.staffId + " " + (s.subjects || "")).toLowerCase().indexOf(q) >= 0; }).slice(0, 80).map(function (s) {
                return '<button class="am-th" data-t="' + esc(s.staffId) + '"><div class="am-av teacher">' + initial(s.name) + '</div><div class="am-tx"><b>' + esc(s.name) + '</b><span class="id">ID ' + esc(s.staffId) + (s.subjects ? " · " + esc(s.subjects) : "") + "</span></div></button>";
            });
        } else {
            rows = state.dir.students.filter(function (s) { return !q || (s.fullName + " " + s.regNo + " " + (s.guardianName || "")).toLowerCase().indexOf(q) >= 0; }).slice(0, 80).map(function (s) {
                var cls = (s.studentClass || "") + (s.section ? " - " + s.section : "");
                return '<button class="am-th" data-s="' + esc(s.regNo) + '"><div class="am-av parent">' + initial(s.fullName) + '</div><div class="am-tx"><b>' + esc(s.fullName) + '</b><span class="id parent-id">Father/Guardian: ' + esc(s.guardianName || "—") + " · " + esc(s.regNo) + (cls ? " · " + esc(cls) : "") + "</span></div></button>";
            });
        }
        box.innerHTML = rows.length ? rows.join("") : '<div class="am-empty"><b>No match</b></div>';
    }
    function openPicker() {
        $("#am-modal").hidden = false; $("#pick-q").value = ""; renderPicker();
        loadDirectory().then(renderPicker).catch(function (e) { if (e.message !== "401") toast("Could not load the list.", true); });
        setTimeout(function () { $("#pick-q").focus(); }, 30);
    }

    /* ───────── page chrome (sidebar, theme, date) ───────── */
    function chrome() {
        var sb = $("#sidebar"), ov = $("#sidebar-overlay");
        $("#open-sidebar").addEventListener("click", function () { sb.classList.add("active"); ov.classList.add("active"); });
        var close = function () { sb.classList.remove("active"); ov.classList.remove("active"); };
        $("#close-sidebar").addEventListener("click", close); ov.addEventListener("click", close);
        $("#nav-search").addEventListener("input", function (e) {
            var q = e.target.value.trim().toLowerCase();
            $$(".sidebar-nav .nav-link").forEach(function (l) { l.style.display = l.textContent.toLowerCase().indexOf(q) >= 0 ? "flex" : "none"; });
        });
        $("#theme-toggle").addEventListener("click", function () {
            var r = document.documentElement, n = r.getAttribute("data-theme") === "dark" ? "light" : "dark";
            r.setAttribute("data-theme", n); try { localStorage.setItem("eduflow-theme", n); } catch (e) { /* ignore */ }
        });
        $("#header-date").textContent = new Date().toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
        if (school.name) $("#school-name").textContent = String(school.name).toUpperCase();
        $("#logout-link").addEventListener("click", function () {
            try { if (window.SoftSchoolAdmin && window.SoftSchoolAdmin.clearSession) window.SoftSchoolAdmin.clearSession(); } catch (e) { /* ignore */ }
            try { localStorage.removeItem("softschool_session"); localStorage.removeItem("softschool_remember"); } catch (e) { /* ignore */ }
        });
    }

    /* ───────── events ───────── */
    function bind() {
        $("#am-tabs").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.filter = b.dataset.f; renderThreads(); });
        $("#am-q").addEventListener("input", function (e) { state.q = e.target.value; renderThreads(); });
        $("#am-threads").addEventListener("click", function (e) {
            var b = e.target.closest("[data-key]"); if (!b) return;
            var t = state.threads.filter(function (x) { return x.key === b.dataset.key; })[0]; if (t) open(descOfThread(t));
        });
        $("#am-new").addEventListener("click", openPicker);
        $("#am-close").addEventListener("click", function () { $("#am-modal").hidden = true; });
        $("#am-modal").addEventListener("click", function (e) { if (e.target.id === "am-modal") $("#am-modal").hidden = true; });
        $(".am-seg").addEventListener("click", function (e) {
            var b = e.target.closest("button"); if (!b) return;
            state.who = b.dataset.who; $$(".am-seg button").forEach(function (x) { x.classList.toggle("on", x === b); }); renderPicker();
        });
        $("#pick-q").addEventListener("input", renderPicker);
        $("#am-pick").addEventListener("click", function (e) {
            var b = e.target.closest("button"); if (!b) return;
            var desc;
            if (b.dataset.t) {
                var s = state.dir.teachers.filter(function (x) { return x.staffId === b.dataset.t; })[0];
                desc = { key: "t:" + s.staffId, type: "teacher", staffId: s.staffId, name: s.name };
            } else {
                var st = state.dir.students.filter(function (x) { return x.regNo === b.dataset.s; })[0];
                desc = { key: "p:" + st.regNo, type: "parent", regNo: st.regNo, studentName: st.fullName, guardianName: st.guardianName, guardianRole: st.guardianRole, className: (st.studentClass || "") + (st.section ? " - " + st.section : "") };
            }
            $("#am-modal").hidden = true; open(desc);
        });
        $("#am-chat").addEventListener("click", function (e) {
            if (e.target.closest("#am-back")) { $("#am-wrap").classList.remove("chat-open"); state.active = null; renderThreads(); renderChatShell(); }
            else if (e.target.closest("#am-send")) send();
        });
        $("#am-chat").addEventListener("input", function (e) { if (e.target.id === "am-in") { grow(e.target); if (state.active) state.drafts[state.active.key] = e.target.value; } });
        $("#am-chat").addEventListener("keydown", function (e) { if (e.target.id === "am-in" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
        document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") $("#am-modal").hidden = true; });
    }

    chrome(); bind(); renderChatShell();
    loadThreads().then(function () {
        var want = new URLSearchParams(location.search), reg = want.get("regNo"), sid = want.get("staffId");   // deep links, e.g. from a student / staff page
        if (reg || sid) loadDirectory().then(function (dir) {
            if (sid) { var s = dir.teachers.filter(function (x) { return x.staffId === sid; })[0]; if (s) open({ key: "t:" + s.staffId, type: "teacher", staffId: s.staffId, name: s.name }); }
            else { var st = dir.students.filter(function (x) { return x.regNo === reg; })[0]; if (st) open({ key: "p:" + st.regNo, type: "parent", regNo: st.regNo, studentName: st.fullName, guardianName: st.guardianName, className: (st.studentClass || "") + (st.section ? " - " + st.section : "") }); }
        });
    }).catch(function (e) { if (e.message !== "401") toast("Could not load conversations.", true); });
    tick(); setInterval(tick, POLL_MS);
})();
