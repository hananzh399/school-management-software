/* Announcements & Messages (admin): real-time chat with teachers and parents.
 * Messaging-app layout · edit / delete · message everyone or specific teachers / parents · push notifications. */
(function () {
    "use strict";
    var API = "https://167-86-120-247.sslip.io/api";
    var POLL_MS = 4000;
    var MAX_LEN = 1000;
    var QUICK = [
        "Please come to the school office when you are free.",
        "School will remain closed tomorrow. Please stay tuned for updates.",
        "Reminder: the fee due date is approaching. Kindly clear the dues on time.",
        "Parent-teacher meeting is scheduled this week. Your presence is requested.",
        "Thank you, we have noted this and will get back to you shortly."
    ];
    var $ = function (s) { return document.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
    var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
    var store = {
        get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
        set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
    };

    var school = {};
    try { school = (window.SoftSchoolAdmin && window.SoftSchoolAdmin.getCurrentSchool && window.SoftSchoolAdmin.getCurrentSchool()) || {}; } catch (e) { /* ignore */ }
    var schoolId = school.schoolId || "";

    var state = {
        threads: [], filter: "all", q: "", active: null, msgs: [], editing: null, menuFor: null,
        pulse: { lastId: -1, unread: -1, count: -1, edited: "", reads: -1 }, dir: null, sheetFor: null, savedDraft: "", mark: null, markSet: false, sending: false, drafts: {}, online: true,
        pins: store.get("ann_pins", []), notify: store.get("ann_popup", true), sound: store.get("ann_sound", true),
        seen: null, newBelow: 0,
        cm: { who: "teacher", mode: "all", sel: {}, cls: "", q: "", busy: false }
    };
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
    function toast(msg, isErr, onClick) {
        var t = $("#am-toast"); t.textContent = msg; t.className = "am-toast" + (isErr ? " err" : "") + (onClick ? " link" : ""); t.hidden = false;
        t.onclick = onClick || null;
        clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, onClick ? 5000 : 3200);
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
    var classOf = function (s) { return (s.studentClass || "") + (s.section ? " - " + s.section : ""); };

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
        var list = state.threads.filter(function (t) {
            if (state.filter === "unread") { if (!t.unread) return false; }
            else if (state.filter !== "all" && t.type !== state.filter) return false;
            if (!q) return true;
            return [t.staffName, t.staffId, t.studentName, t.guardianName, t.regNo, t.className].join(" ").toLowerCase().indexOf(q) >= 0;
        });
        return list.sort(function (a, b) {                                            // pinned first, then newest
            var pa = state.pins.indexOf(a.key) >= 0 ? 1 : 0, pb = state.pins.indexOf(b.key) >= 0 ? 1 : 0;
            return pb - pa || new Date(b.lastAt) - new Date(a.lastAt);
        });
    }
    function renderThreads() {
        var un = { all: 0, teacher: 0, parent: 0 };
        state.threads.forEach(function (t) { un.all += t.unread; un[t.type] += t.unread; });
        ["all", "teacher", "parent"].forEach(function (k) { $("#cnt-" + k).textContent = un[k] ? (un[k] > 99 ? "99+" : un[k]) : ""; });
        $$("#am-tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.f === state.filter); });
        document.title = (un.all ? "(" + un.all + ") " : "") + "Announcements";
        var list = visibleThreads(), box = $("#am-threads");
        if (!list.length) {
            box.innerHTML = '<div class="am-empty"><i class="fas fa-comments"></i><b>' + (state.threads.length ? "No match" : "No conversations yet") + "</b>" + (state.threads.length ? "Try a different search or filter." : "Messages from teachers and parents appear here. Tap the pen icon to start one.") + "</div>";
            return;
        }
        box.innerHTML = list.map(function (t) {
            var mine = t.lastSender === "ADMIN", pinned = state.pins.indexOf(t.key) >= 0;
            return '<button class="am-th ' + (state.active && state.active.key === t.key ? "on " : "") + (t.unread ? "unread " : "") + (pinned ? "pinned" : "") + '" data-key="' + esc(t.key) + '">' +
                '<div class="am-av ' + t.type + '">' + initial(t.type === "teacher" ? t.staffName : t.studentName) + "</div>" +
                '<div class="am-tx"><div class="l1"><b>' + esc(threadTitle(t)) + "</b><small>" + when(t.lastAt) + "</small></div>" +
                '<span class="id ' + (t.type === "parent" ? "parent-id" : "") + '">' + esc(threadSub(t)) + "</span>" +
                '<div class="l2"><span>' + (mine ? "You: " : "") + esc(t.lastBody) + "</span>" + (t.unread ? '<i class="am-cnt">' + (t.unread > 99 ? "99+" : t.unread) + "</i>" : "") + "</div></div>" +
                '<span class="am-pin" data-pin="' + esc(t.key) + '" role="button" title="' + (pinned ? "Unpin" : "Pin to top") + '"><i class="fas fa-thumbtack"></i></span></button>';
        }).join("");
    }
    function loadThreads() {
        return api("/messages/threads").then(function (list) {
            state.threads = Array.isArray(list) ? list : [];
            renderThreads();
            var total = state.threads.reduce(function (a, t) { return a + t.unread; }, 0);
            if (window.__annPaintBadge) window.__annPaintBadge(total);
            announceNew();
        });
    }

    /* ───────── notifications (browser push + sound + title count) ───────── */
    function beep() {
        if (!state.sound) return;
        try {
            var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
            var c = beep._c || (beep._c = new AC()), o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
            o.type = "sine"; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1175, t + 0.12);
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
            o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.36);
        } catch (e) { /* audio blocked until the first click */ }
    }
    function paintTools() {
        var bell = $("#am-bell"), on = state.notify;
        bell.classList.toggle("on", on);
        bell.querySelector("i").className = "fas " + (on ? "fa-bell" : "fa-bell-slash");
        bell.querySelector("span").textContent = on ? "Pop-ups on" : "Pop-ups off";
        var snd = $("#am-sound"); snd.classList.toggle("on", state.sound);
        snd.querySelector("i").className = "fas " + (state.sound ? "fa-volume-high" : "fa-volume-xmark");
    }
    function toggleBell() {
        state.notify = !state.notify; store.set("ann_popup", state.notify); paintTools();
        toast(state.notify ? "Message pop-ups turned on." : "Message pop-ups turned off.");
    }
    /** In-app popup card (shown inside the page, not a browser notification). */
    function popup(t) {
        if (!state.notify || !window.__annPopup) return;
        window.__annPopup({ kind: t.type, title: threadTitle(t), body: t.lastBody, onClick: function () { open(descOfThread(t)); } });
    }
    /** Compare the thread list with what we showed last time; alert for each new message from a teacher / parent. */
    function announceNew() {
        var first = state.seen === null;
        if (first) state.seen = {};
        var fresh = [];
        state.threads.forEach(function (t) {
            var prev = state.seen[t.key]; state.seen[t.key] = t.lastAt;
            if (first || t.lastSender === "ADMIN" || !t.unread) return;
            if (prev && new Date(t.lastAt) <= new Date(prev)) return;
            fresh.push(t);
        });
        if (!fresh.length) return;
        var watching = !document.hidden && document.hasFocus();
        fresh.forEach(function (t) {
            var here = state.active && state.active.key === t.key;
            if (here && watching) return;                                      // you are reading it right now
            beep(); popup(t);
        });
    }

    /* ───────── open chat ───────── */
    function chatQuery(d) { return d.type === "teacher" ? "?staffId=" + encodeURIComponent(d.staffId) : "?regNo=" + encodeURIComponent(d.regNo); }
    function renderChatShell() {
        var d = state.active, c = $("#am-chat");
        if (!d) {
            c.innerHTML = '<div class="am-empty"><i class="fas fa-comments"></i><b>Select a conversation</b>Pick a teacher or parent on the left, or tap the pen icon to write a new message.</div>';
            return;
        }
        var title = d.type === "teacher" ? d.name : "Parent of " + (d.studentName || d.regNo);
        var sub = d.type === "teacher" ? "Teacher · ID " + d.staffId : guardianLine(d) + " · " + d.regNo + (d.className ? " · " + d.className : "");
        c.innerHTML =
            '<div class="am-head"><button class="am-back" id="am-back" aria-label="Back"><i class="fas fa-arrow-left"></i></button>' +
            '<div class="am-av ' + d.type + '">' + initial(d.type === "teacher" ? d.name : d.studentName) + "</div>" +
            '<div class="meta"><b>' + esc(title) + "</b><span>" + esc(sub) + '</span></div><span class="am-live' + (state.online ? "" : " off") + '" id="am-live">' + (state.online ? "Live" : "Offline") + "</span></div>" +
            '<div class="am-bodywrap"><div class="am-body" id="am-body"></div><button class="am-down" id="am-down" hidden><i class="fas fa-arrow-down"></i><span></span></button></div>' +
            '<div class="am-editbar" id="am-editbar" hidden><i class="fas fa-pen"></i><div class="eb"><b>Editing message</b><span id="am-edit-text"></span></div><button type="button" id="am-edit-cancel" aria-label="Cancel editing"><i class="fas fa-xmark"></i></button></div>' +
            '<div class="am-compose"><button class="am-qr" id="am-qr" type="button" title="Quick replies" aria-label="Quick replies"><i class="fas fa-bolt"></i></button>' +
            '<textarea id="am-in" rows="1" maxlength="' + MAX_LEN + '" placeholder="Write a message…  (Enter to send, Shift+Enter for a new line)">' + esc(state.drafts[d.key] || "") + '</textarea>' +
            '<span class="am-count" id="am-count"></span><button class="am-send" id="am-send" aria-label="Send"><i class="fas fa-paper-plane"></i></button></div>';
        renderMessages(true);
        grow($("#am-in"));
    }
    /* ───────── receipts (same ticks as the parent portal: clock = sending, ✓ = sent, ✓✓ blue = read) ───────── */
    var RECEIPT_LABEL = { sending: "Sending", sent: "Sent", read: "Read" };
    function receiptHTML(status) {
        var key = RECEIPT_LABEL[status] ? status : "sent", svg;
        if (key === "sending") svg = '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.8"/><path d="M6 3.4V6l1.8 1.1"/></svg>';
        else if (key === "sent") svg = '<svg viewBox="0 0 14.5 11" aria-hidden="true"><path d="M1.5 5.8 5.3 9.4 13 1.6"/></svg>';
        else svg = '<svg viewBox="0 0 19 11" aria-hidden="true"><path d="M1.5 5.8 5.3 9.4 13 1.6"/><path d="M6 5.8 9.8 9.4 17.5 1.6"/></svg>';
        return '<span class="receipt receipt-' + key + '" role="img" aria-label="' + RECEIPT_LABEL[key] + '" title="' + RECEIPT_LABEL[key] + '">' + svg + "</span>";
    }
    /** Status of one of the admin's own messages. A message is "read" once the teacher / parent opened the chat. */
    function statusOf(m) {
        if (m.pending) return "sending";
        var teacher = state.active && state.active.type === "teacher";
        return (teacher ? m.readByTeacher : m.readByParent) ? "read" : "sent";
    }
    /** Edit / delete are offered only for your own, saved, not-yet-read messages (the server enforces this too). */
    function canChange(m) { return !!m && m.senderType === "ADMIN" && !!m.id && statusOf(m) !== "read"; }
    var READ_LOCK = "This message has been read, so it can't be edited or deleted.";

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
            if (state.mark && m.id && m.id === state.mark.id) html += '<div class="am-unread"><span>' + state.mark.count + (state.mark.count === 1 ? " unread message" : " unread messages") + "</span></div>";
            var me = m.senderType === "ADMIN", tap = me && !!m.id;
            var who = me ? "" : '<span class="who">' + esc(m.senderType === "PARENT" ? (m.guardianName || "Parent") + " (parent)" : (m.senderName || "Teacher")) + "</span>";
            var grp = m.broadcastId ? '<span class="grp"><i class="fas fa-bullhorn"></i> Announcement</span>' : "";
            var menu = !me && m.id ? '<button class="am-mm" data-mid="' + m.id + '" aria-label="Message options"><i class="fas fa-chevron-down"></i></button>' : "";
            var meta = '<span class="t">' + (m.editedAt ? '<em class="am-edited">Edited</em>' : "") + clock(m.createdAt) + (me ? ' <span class="receipt-slot">' + receiptHTML(statusOf(m)) + "</span>" : "") + "</span>";
            html += '<div class="am-b ' + (me ? "me" : "them") + (m.pending ? " sending" : "") + (tap ? " tappable" : "") + (state.editing === m.id && me ? " is-editing" : "") + '" data-mid="' + (m.id || "") + '"' +
                (tap ? ' tabindex="0" role="button" aria-label="Your message. Press for details."' : "") + ">" + menu + who + grp + "<p>" + esc(m.body) + "</p>" + meta + "</div>";
        });
        body.innerHTML = html;
        body.scrollTop = (forceBottom || near) ? body.scrollHeight : top;
        syncDown();
    }
    function syncDown() {
        var body = $("#am-body"), btn = $("#am-down"); if (!body || !btn) return;
        var away = body.scrollHeight - body.scrollTop - body.clientHeight > 160;
        if (!away) state.newBelow = 0;
        btn.hidden = !away;
        btn.querySelector("span").textContent = state.newBelow ? state.newBelow + " new" : "";
    }
    function loadMessages(forceBottom) {
        var d = state.active; if (!d) return Promise.resolve();
        var key = d.key;
        return api("/messages" + chatQuery(d)).then(function (list) {
            if (!state.active || state.active.key !== key) return;                     // user switched chats while loading
            list = (Array.isArray(list) ? list : []).slice().sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
            var prevIds = state.msgs.length;
            var incoming = list.filter(function (m) { return m.senderType !== "ADMIN" && !state.msgs.some(function (x) { return x.id === m.id; }); }).length;
            var pend = state.msgs.filter(function (m) { return m.pending; });
            state.msgs = list.concat(pend);
            if (state.editing && !list.some(function (m) { return m.id === state.editing; })) cancelEdit();   // it was deleted elsewhere
            if (!state.markSet) {                                                       // remember where the unread messages start (shown as a divider)
                var firstNew = list.filter(function (m) { return m.senderType !== "ADMIN" && !m.readByAdmin; });
                state.mark = firstNew.length ? { id: firstNew[0].id, count: firstNew.length } : null;
                state.markSet = true;
            }
            var body = $("#am-body"), wasAway = body && body.scrollHeight - body.scrollTop - body.clientHeight > 160;
            renderMessages(forceBottom);
            if (prevIds && incoming && wasAway && !forceBottom) { state.newBelow += incoming; syncDown(); }
            refreshInfo();
            if (list.some(function (m) { return m.senderType !== "ADMIN" && !m.readByAdmin; }) && !document.hidden) {
                api("/messages/read", { method: "POST", body: JSON.stringify(d.type === "teacher" ? { staffId: d.staffId } : { regNo: d.regNo }) })
                    .then(loadThreads).catch(function () { /* retried on next change */ });
            }
        });
    }
    function open(desc) {
        if (state.active) state.drafts[state.active.key] = (state.editing ? state.savedDraft : ($("#am-in") || {}).value) || state.drafts[state.active.key] || "";
        state.active = desc; state.msgs = []; state.editing = null; state.savedDraft = ""; state.mark = null; state.markSet = false; state.newBelow = 0; closeMenu(); closeInfo();
        $("#am-wrap").classList.add("chat-open");
        renderThreads(); renderChatShell();
        loadMessages(true).catch(function (e) { if (e.message !== "401") toast("Could not load the chat.", true); });
        var inp = $("#am-in"); if (inp && window.innerWidth > 860) inp.focus();
    }
    function grow(ta) {
        if (!ta) return; ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
        var c = $("#am-count"); if (c) { var n = ta.value.length; c.textContent = n > MAX_LEN - 150 ? n + "/" + MAX_LEN : ""; c.classList.toggle("warn", n >= MAX_LEN - 20); }
    }

    function send() {
        if (state.editing) return saveEdit();
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

    /* ───────── edit / delete / copy ───────── */
    function msgById(id) { return state.msgs.filter(function (m) { return String(m.id) === String(id); })[0]; }
    function closeMenu() { var m = $("#am-menu"); m.hidden = true; m.className = "am-menu"; state.menuFor = null; }
    function showMenu(anchor, html, cls) {
        var m = $("#am-menu"); m.innerHTML = html; m.className = "am-menu " + (cls || ""); m.hidden = false;
        var r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
        var left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
        var topPos = r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6;
        m.style.left = left + "px"; m.style.top = topPos + "px";
    }
    function openMessageMenu(btn) {
        var m = msgById(btn.dataset.mid); if (!m) return;
        if (state.menuFor === m.id) { closeMenu(); return; }
        state.menuFor = m.id;
        showMenu(btn, '<button data-act="copy"><i class="fas fa-copy"></i> Copy text</button>');   // your own messages: tap the bubble
    }
    function copyText(t) {
        var done = function () { toast("Copied."); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { toast("Could not copy.", true); });
        else { var x = document.createElement("textarea"); x.value = t; document.body.appendChild(x); x.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Could not copy.", true); } x.remove(); }
    }
    /* ───────── edit in the composer (like the parent portal) ───────── */
    function startEdit(m) {
        var ta = $("#am-in"); if (!ta || !canChange(m)) return;
        if (!state.editing) state.savedDraft = ta.value;                                 // keep any half-typed message
        state.editing = m.id;
        ta.value = m.body; grow(ta);
        $("#am-edit-text").textContent = m.body; $("#am-editbar").hidden = false;
        var sb = $("#am-send"); sb.classList.add("is-editing"); sb.setAttribute("aria-label", "Save changes"); sb.querySelector("i").className = "fas fa-check";
        renderMessages(false); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    function cancelEdit() {
        if (!state.editing) return;
        state.editing = null;
        var ta = $("#am-in"); if (ta) { ta.value = state.savedDraft; grow(ta); }
        state.savedDraft = "";
        var bar = $("#am-editbar"); if (bar) bar.hidden = true;
        var sb = $("#am-send"); if (sb) { sb.classList.remove("is-editing"); sb.setAttribute("aria-label", "Send"); sb.querySelector("i").className = "fas fa-paper-plane"; }
        renderMessages(false);
    }
    function saveEdit() {
        var m = msgById(state.editing), ta = $("#am-in"); if (!m || !ta) { cancelEdit(); return; }
        var text = ta.value.trim(); if (!text) { toast("A message cannot be empty.", true); return; }
        if (text === m.body) { cancelEdit(); return; }
        if (!canChange(m)) { cancelEdit(); toast(READ_LOCK, true); return; }
        api("/messages/" + m.id, { method: "PUT", body: JSON.stringify({ body: text }) })
            .then(function (r) { m.body = text; m.editedAt = r.editedAt || new Date().toISOString(); cancelEdit(); loadThreads(); toast("Message updated."); })
            .catch(function (e) { if (e.message === "401") return; toast(e.message || "Could not edit.", true); cancelEdit(); loadMessages(false).catch(function () {}); });
    }

    /* ───────── message info sheet: tap one of your own messages ───────── */
    function openInfo(id) {
        var m = msgById(id); if (!m || m.senderType !== "ADMIN") return;
        closeMenu(); state.sheetFor = m.id; renderInfo(m);
        $("#am-sov").hidden = false; $("#am-info").hidden = false;
        var first = $("#am-info").querySelector(canChange(m) ? '[data-sa="edit"]' : '[data-sa="close"]'); if (first) first.focus();
    }
    function closeInfo() { state.sheetFor = null; var o = $("#am-sov"), i = $("#am-info"); if (o) o.hidden = true; if (i) i.hidden = true; }
    function refreshInfo() { if (state.sheetFor == null) return; var m = msgById(state.sheetFor); if (!m) closeInfo(); else renderInfo(m); }
    function renderInfo(m) {
        var st = statusOf(m), sent = st !== "sending", read = st === "read";
        $("#am-info-prev").textContent = m.body;
        function row(key, label, done, value) {
            return '<div class="am-info-row"><span class="ic">' + receiptHTML(key) + '</span><span class="lb">' + label + '</span><span class="vl' + (done ? "" : " pending") + '">' + value + "</span></div>";
        }
        $("#am-info-rows").innerHTML =
            row("sent", "Sent", sent, sent ? dayLabel(m.createdAt) + ", " + clock(m.createdAt) : "Sending…") +
            row("read", "Read", read, read ? "Read" : "Not read yet");
        var ok = canChange(m);
        $("#am-info-actions").querySelector('[data-sa="edit"]').hidden = !ok;
        $("#am-info-actions").querySelector('[data-sa="del"]').hidden = !ok;
        $("#am-info-note").textContent = ok ? "You can edit or delete this message until it has been read." : (m.pending ? "" : READ_LOCK);
    }
    function infoAction(a) {
        var id = state.sheetFor, m = id == null ? null : msgById(id);
        if (a === "close" || !m) { closeInfo(); return; }
        if (a === "copy") { closeInfo(); copyText(m.body); return; }
        if (!canChange(m)) { closeInfo(); toast(READ_LOCK, true); return; }
        closeInfo();
        if (a === "edit") startEdit(m); else if (a === "del") askDelete(m.id);
    }

    var pendingDelete = null;
    function askDelete(id) { pendingDelete = id; $("#am-confirm").hidden = false; }
    function doDelete() {
        var id = pendingDelete; pendingDelete = null; $("#am-confirm").hidden = true; if (!id) return;
        api("/messages/" + id, { method: "DELETE" })
            .then(function () { state.msgs = state.msgs.filter(function (m) { return String(m.id) !== String(id); }); renderMessages(false); return loadThreads(); })
            .catch(function (e) { if (e.message !== "401") { toast(e.message || "Could not delete.", true); loadMessages(false).catch(function () {}); } });
    }

    /* ───────── live updates (polls a tiny endpoint; reloads only when something changed) ───────── */
    function setOnline(on) {
        if (state.online === on) return; state.online = on;
        var l = $("#am-live"); if (l) { l.textContent = on ? "Live" : "Offline"; l.classList.toggle("off", !on); }
    }
    function tick() {
        api("/messages/pulse").then(function (p) {
            setOnline(true);
            var o = state.pulse;
            var changed = p.lastId !== o.lastId || p.unread !== o.unread || p.count !== o.count || p.edited !== o.edited || p.reads !== o.reads;
            state.pulse = p;
            if (changed) { loadThreads().catch(function () {}); if (state.active) loadMessages(false).catch(function () {}); }
        }).catch(function (e) { if (e.message !== "401") setOnline(false); });
    }

    /* ───────── new message sheet: one person, everyone, a class, or a hand-picked group ───────── */
    function loadDirectory() {
        if (state.dir) return Promise.resolve(state.dir);
        var q = "?schoolId=" + encodeURIComponent(schoolId);
        return Promise.all([api("/staff/summary" + q), api("/students/summary" + q)]).then(function (r) {
            var students = (r[1] || []).filter(function (s) { return !s.status || String(s.status).toLowerCase() === "active"; });
            var classes = {}; students.forEach(function (s) { var c = classOf(s); if (c) classes[c] = 1; });
            state.dir = {
                teachers: (r[0] || []).filter(function (s) { return String(s.type || "").toLowerCase() === "teaching"; }),
                students: students, classes: Object.keys(classes).sort()
            };
            return state.dir;
        });
    }
    function modesFor(who) { return who === "teacher" ? [["all", "All teachers"], ["pick", "Specific"]] : [["all", "All parents"], ["class", "A class"], ["pick", "Specific"]]; }
    function pickRows() {
        var q = state.cm.q.trim().toLowerCase(), d = state.dir;
        if (state.cm.who === "teacher") {
            return d.teachers.filter(function (s) { return !q || (s.name + " " + s.staffId + " " + (s.subjects || "")).toLowerCase().indexOf(q) >= 0; })
                .map(function (s) { return { id: s.staffId, type: "teacher", name: s.name, sub: "ID " + s.staffId + (s.subjects ? " · " + s.subjects : "") }; });
        }
        return d.students.filter(function (s) { return !q || (s.fullName + " " + s.regNo + " " + (s.guardianName || "")).toLowerCase().indexOf(q) >= 0; })
            .map(function (s) { return { id: s.regNo, type: "parent", name: s.fullName, sub: "Father/Guardian: " + (s.guardianName || "—") + " · " + s.regNo + (classOf(s) ? " · " + classOf(s) : "") }; });
    }
    function recipientCount() {
        var c = state.cm, d = state.dir; if (!d) return 0;
        if (c.mode === "pick") return Object.keys(c.sel).length;
        if (c.who === "teacher") return d.teachers.length;
        if (c.mode === "class") return d.students.filter(function (s) { return classOf(s) === c.cls; }).length;
        return d.students.length;
    }
    function renderSheet() {
        var c = state.cm, d = state.dir;
        $$("#am-who button").forEach(function (b) { b.classList.toggle("on", b.dataset.who === c.who); });
        $("#am-modes").innerHTML = modesFor(c.who).map(function (m) { return '<button type="button" data-mode="' + m[0] + '" class="' + (c.mode === m[0] ? "on" : "") + '">' + m[1] + "</button>"; }).join("");
        var showClass = c.who === "parent" && c.mode === "class";
        $("#am-class-wrap").hidden = !showClass;
        if (showClass && d) {
            if (!c.cls) c.cls = d.classes[0] || "";
            $("#am-class").innerHTML = d.classes.map(function (k) { return '<option value="' + esc(k) + '"' + (k === c.cls ? " selected" : "") + ">" + esc(k) + "</option>"; }).join("") || "<option value=''>No classes found</option>";
        }
        $("#am-pickbox").hidden = c.mode !== "pick";
        if (c.mode === "pick") renderPick();
        var n = recipientCount(), what = c.who === "teacher" ? (n === 1 ? "teacher" : "teachers") : (n === 1 ? "parent" : "parents");
        $("#am-to").innerHTML = d ? '<i class="fas fa-paper-plane"></i> Sending to <b>' + n + "</b> " + what + (c.mode === "all" ? " (everyone)" : c.mode === "class" ? " in " + esc(c.cls) : "") : "Loading…";
        $("#cm-send").disabled = c.busy || !n;
    }
    function renderPick() {
        var box = $("#am-pick"), c = state.cm;
        if (!state.dir) { box.innerHTML = '<div class="am-empty">Loading…</div>'; return; }
        var rows = pickRows(), shown = rows.slice(0, 200);
        box.innerHTML = shown.length ? shown.map(function (r) {
            return '<button type="button" class="am-th ' + (c.sel[r.id] ? "sel" : "") + '" data-id="' + esc(r.id) + '"><span class="am-chk"><i class="fas fa-check"></i></span><div class="am-av ' + r.type + '">' + initial(r.name) + '</div><div class="am-tx"><b>' + esc(r.name) + '</b><span class="id ' + (r.type === "parent" ? "parent-id" : "") + '">' + esc(r.sub) + "</span></div></button>";
        }).join("") : '<div class="am-empty"><b>No match</b></div>';
        $("#pick-n").textContent = Object.keys(c.sel).length + " selected";
    }
    function openSheet(pre) {
        var c = state.cm; c.sel = {}; c.q = ""; c.busy = false; c.mode = "all"; c.who = "teacher"; c.cls = "";
        if (pre && pre.id) { c.who = pre.type; c.mode = "pick"; c.sel[pre.id] = 1; }
        $("#pick-q").value = ""; $("#cm-text").value = "";
        $("#am-modal").hidden = false; renderSheet();
        loadDirectory().then(renderSheet).catch(function (e) { if (e.message !== "401") toast("Could not load the list.", true); });
        setTimeout(function () { $("#cm-text").focus(); }, 40);
    }
    function sendGroup() {
        var c = state.cm, text = $("#cm-text").value.trim(); if (c.busy) return;
        if (!text) { toast("Write a message first.", true); return; }
        var n = recipientCount(); if (!n) { toast("Choose at least one recipient.", true); return; }
        var payload = { audience: c.who === "teacher" ? "teachers" : "parents", body: text, senderName: school.name || "Admin" };
        if (c.mode === "all") payload.all = true;
        else if (c.mode === "class") payload.className = c.cls;
        else if (c.who === "teacher") payload.staffIds = Object.keys(c.sel);
        else payload.regNos = Object.keys(c.sel);
        var only = c.mode === "pick" && n === 1 ? Object.keys(c.sel)[0] : null;
        c.busy = true; renderSheet();
        api("/messages/broadcast", { method: "POST", body: JSON.stringify(payload) }).then(function (r) {
            $("#am-modal").hidden = true; toast("Sent to " + (r.sent || n) + (r.sent === 1 ? " recipient." : " recipients."));
            return loadThreads().then(function () {
                if (!only) return;
                if (c.who === "teacher") { var s = state.dir.teachers.filter(function (x) { return x.staffId === only; })[0]; if (s) open({ key: "t:" + s.staffId, type: "teacher", staffId: s.staffId, name: s.name }); }
                else { var st = state.dir.students.filter(function (x) { return x.regNo === only; })[0]; if (st) open({ key: "p:" + st.regNo, type: "parent", regNo: st.regNo, studentName: st.fullName, guardianName: st.guardianName, guardianRole: st.guardianRole, className: classOf(st) }); }
            });
        }).catch(function (e) { if (e.message !== "401") toast(e.message || "Could not send.", true); })
          .then(function () { c.busy = false; renderSheet(); });
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
        paintTools();
    }

    /* ───────── events ───────── */
    function bind() {
        $("#am-bell").addEventListener("click", toggleBell);
        $("#am-sound").addEventListener("click", function () { state.sound = !state.sound; store.set("ann_sound", state.sound); paintTools(); if (state.sound) beep(); });
        $("#am-tabs").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.filter = b.dataset.f; renderThreads(); });
        $("#am-q").addEventListener("input", function (e) { state.q = e.target.value; renderThreads(); });
        $("#am-threads").addEventListener("click", function (e) {
            var pin = e.target.closest("[data-pin]");
            if (pin) { e.stopPropagation(); var k = pin.dataset.pin, i = state.pins.indexOf(k); if (i >= 0) state.pins.splice(i, 1); else state.pins.push(k); store.set("ann_pins", state.pins); renderThreads(); return; }
            var b = e.target.closest("[data-key]"); if (!b) return;
            var t = state.threads.filter(function (x) { return x.key === b.dataset.key; })[0]; if (t) open(descOfThread(t));
        });

        // new message sheet
        $("#am-new").addEventListener("click", function () { openSheet(); });
        $("#am-close").addEventListener("click", function () { $("#am-modal").hidden = true; });
        $("#am-modal").addEventListener("click", function (e) { if (e.target.id === "am-modal") $("#am-modal").hidden = true; });
        $("#am-who").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.cm.who = b.dataset.who; state.cm.mode = "all"; state.cm.sel = {}; state.cm.q = ""; $("#pick-q").value = ""; renderSheet(); });
        $("#am-modes").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.cm.mode = b.dataset.mode; renderSheet(); });
        $("#am-class").addEventListener("change", function (e) { state.cm.cls = e.target.value; renderSheet(); });
        $("#pick-q").addEventListener("input", function (e) { state.cm.q = e.target.value; renderPick(); });
        $("#am-pick").addEventListener("click", function (e) {
            var b = e.target.closest("[data-id]"); if (!b) return;
            var id = b.dataset.id; if (state.cm.sel[id]) delete state.cm.sel[id]; else state.cm.sel[id] = 1; renderSheet();
        });
        $("#pick-all").addEventListener("click", function () { pickRows().forEach(function (r) { state.cm.sel[r.id] = 1; }); renderSheet(); });
        $("#pick-none").addEventListener("click", function () { state.cm.sel = {}; renderSheet(); });
        $("#cm-send").addEventListener("click", sendGroup);
        $("#cm-text").addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendGroup(); } });

        // chat pane
        $("#am-chat").addEventListener("click", function (e) {
            var t = e.target;
            if (t.closest("#am-back")) { $("#am-wrap").classList.remove("chat-open"); state.active = null; state.editing = null; renderThreads(); renderChatShell(); }
            else if (t.closest("#am-send")) send();
            else if (t.closest("#am-down")) { var b = $("#am-body"); b.scrollTop = b.scrollHeight; state.newBelow = 0; syncDown(); }
            else if (t.closest("#am-qr")) {
                var q = t.closest("#am-qr"); if (!$("#am-menu").hidden && state.menuFor === "qr") { closeMenu(); return; }
                closeMenu(); state.menuFor = "qr";
                showMenu(q, '<div class="qr-t">Quick replies</div>' + QUICK.map(function (s, i) { return '<button data-qr="' + i + '">' + esc(s) + "</button>"; }).join(""), "qr");
            }
            else if (t.closest("#am-edit-cancel")) cancelEdit();
            else if (t.closest(".am-mm")) { e.stopPropagation(); openMessageMenu(t.closest(".am-mm")); }
            else if (t.closest(".am-b.tappable")) openInfo(t.closest(".am-b.tappable").dataset.mid);
        });
        $("#am-sov").addEventListener("click", closeInfo);
        $("#am-info").addEventListener("click", function (e) { var b = e.target.closest("[data-sa]"); if (b) infoAction(b.dataset.sa); });
        $("#am-chat").addEventListener("scroll", function (e) { if (e.target.id === "am-body") syncDown(); }, true);
        $("#am-chat").addEventListener("input", function (e) { if (e.target.id === "am-in") { grow(e.target); if (state.active && !state.editing) state.drafts[state.active.key] = e.target.value; } });
        $("#am-chat").addEventListener("keydown", function (e) {
            if (e.target.id === "am-in" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("tappable")) { e.preventDefault(); openInfo(e.target.dataset.mid); }
        });
        $("#am-menu").addEventListener("click", function (e) {
            var b = e.target.closest("button"); if (!b) return;
            if (b.dataset.qr != null) { var ta = $("#am-in"); if (ta && !state.editing) { ta.value = (ta.value ? ta.value + " " : "") + QUICK[+b.dataset.qr]; grow(ta); ta.focus(); if (state.active) state.drafts[state.active.key] = ta.value; } closeMenu(); return; }
            var m = msgById(state.menuFor); closeMenu(); if (!m) return;
            if (b.dataset.act === "copy") copyText(m.body);
            else if (b.dataset.act === "edit") { state.editing = m.id; renderMessages(false); }
            else if (b.dataset.act === "del") askDelete(m.id);
        });
        $("#cf-no").addEventListener("click", function () { pendingDelete = null; $("#am-confirm").hidden = true; });
        $("#cf-yes").addEventListener("click", doDelete);
        $("#am-confirm").addEventListener("click", function (e) { if (e.target.id === "am-confirm") { pendingDelete = null; $("#am-confirm").hidden = true; } });
        document.addEventListener("click", function (e) { if (!e.target.closest("#am-menu") && !e.target.closest(".am-mm") && !e.target.closest("#am-qr")) closeMenu(); });
        window.addEventListener("resize", closeMenu);
        document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
        window.addEventListener("focus", function () { if (state.active) loadMessages(false).catch(function () {}); });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") { $("#am-modal").hidden = true; $("#am-confirm").hidden = true; closeMenu(); if (state.sheetFor != null) closeInfo(); else cancelEdit(); } });
    }

    chrome(); bind(); renderChatShell();
    loadThreads().then(function () {
        var want = new URLSearchParams(location.search), reg = want.get("regNo"), sid = want.get("staffId");   // deep links, e.g. from a student / staff page
        if (reg || sid) loadDirectory().then(function (dir) {
            if (sid) { var s = dir.teachers.filter(function (x) { return x.staffId === sid; })[0]; if (s) open({ key: "t:" + s.staffId, type: "teacher", staffId: s.staffId, name: s.name }); }
            else { var st = dir.students.filter(function (x) { return x.regNo === reg; })[0]; if (st) open({ key: "p:" + st.regNo, type: "parent", regNo: st.regNo, studentName: st.fullName, guardianName: st.guardianName, className: classOf(st) }); }
        });
    }).catch(function (e) { if (e.message !== "401") toast("Could not load conversations.", true); });
    tick(); setInterval(tick, POLL_MS);
})();
