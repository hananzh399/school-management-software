/* Announcements (admin): notices from the school that teachers AND parents receive.
 * Kept separate from Messages (the one-to-one chat in announcements.js).
 *   GET    /api/announcements?schoolId=&scope=notices   the notices the admin posted
 *   POST   /api/announcements                           { audience, title, body, category, priority, className? }
 *   DELETE /api/announcements/{id}?schoolId=
 * audience: everyone | teachers | parents | class
 * Result notices ("your child's result is available") are created automatically by Examination → Send to Parents. */
(function () {
    "use strict";
    var API = "https://167-86-120-247.sslip.io/api";
    var $ = function (s) { return document.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
    var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

    var school = {};
    try { school = (window.SoftSchoolAdmin && window.SoftSchoolAdmin.getCurrentSchool && window.SoftSchoolAdmin.getCurrentSchool()) || {}; } catch (e) { /* ignore */ }
    var schoolId = school.schoolId || "";

    var state = { pane: "messages", rows: [], filter: "all", loaded: false, loading: false, classes: null, pendingDelete: null,
                  c: { cat: "notice", aud: "everyone", cls: "", busy: false } };

    /* ───────── helpers ───────── */
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
        var t = $("#am-toast"); if (!t) return;
        t.textContent = msg; t.className = "am-toast" + (isErr ? " err" : ""); t.hidden = false; t.onclick = null;
        clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3200);
    }
    function stamp(iso) {
        var d = new Date(iso); if (isNaN(d)) return "";
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }
    function audLabel(a) {
        switch (a.audience) {
            case "everyone": return ["fa-users", "Teachers & parents"];
            case "teachers": return ["fa-chalkboard-teacher", "All teachers"];
            case "teacher": return ["fa-chalkboard-teacher", "One teacher" + (a.targetStaffId ? " · ID " + a.targetStaffId : "")];
            case "parents": return ["fa-people-roof", "All parents"];
            case "class": return ["fa-school", "Parents of " + (a.className || "a class")];
            default: return ["fa-bullhorn", a.audience || "—"];
        }
    }
    function reaches(a, who) {                       // does this notice reach teachers / parents?
        if (a.audience === "everyone") return true;
        return who === "teachers" ? (a.audience === "teachers" || a.audience === "teacher") : (a.audience === "parents" || a.audience === "class");
    }

    /* ───────── pane switch (Messages | Announcements) ───────── */
    function setPane(p) {
        state.pane = p;
        $$("#am-main-tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.pane === p); });
        $("#am-wrap").hidden = p !== "messages";
        $("#an-wrap").hidden = p !== "notices";
        document.body.classList.toggle("an-mode", p === "notices");
        try { sessionStorage.setItem("am_pane", p); } catch (e) { /* ignore */ }
        if (p === "notices" && !state.loaded) load();
    }

    /* ───────── list ───────── */
    function visible() {
        return state.rows.filter(function (a) { return state.filter === "all" || reaches(a, state.filter); });
    }
    function render() {
        $$("#an-filters button").forEach(function (b) { b.classList.toggle("on", b.dataset.f === state.filter); });
        var box = $("#an-list"), list = visible();
        if (state.loading && !state.rows.length) { box.innerHTML = '<div class="am-empty"><i class="fas fa-spinner fa-spin"></i><b>Loading…</b></div>'; return; }
        if (!list.length) {
            box.innerHTML = '<div class="am-empty"><i class="fas fa-bullhorn"></i><b>' + (state.rows.length ? "Nothing here" : "No announcements yet") + "</b>" +
                (state.rows.length ? "No announcement for this filter." : "Tap “New announcement” to send a notice to teachers and parents.") + "</div>";
            return;
        }
        box.innerHTML = list.map(function (a) {
            var cat = a.category === "event" || a.category === "holiday" ? a.category : "notice", al = audLabel(a), urgent = a.priority === "urgent";
            return '<article class="an-card has-del cat-' + cat + (urgent ? " urgent" : "") + '" data-id="' + esc(a.id) + '">' +
                '<div class="an-meta"><span class="an-chip ' + cat + '">' + cat.charAt(0).toUpperCase() + cat.slice(1) + "</span>" +
                (urgent ? '<span class="an-chip urgent"><i class="fas fa-triangle-exclamation"></i> Urgent</span>' : "") +
                '<span class="an-chip aud"><i class="fas ' + al[0] + '"></i> ' + esc(al[1]) + "</span>" +
                '<span class="an-when">' + esc(stamp(a.date)) + "</span></div>" +
                "<h3>" + esc(a.title) + "</h3><p>" + esc(a.body) + "</p>" +
                '<button type="button" class="an-del" data-del="' + esc(a.id) + '" title="Delete" aria-label="Delete announcement"><i class="fas fa-trash"></i></button></article>';
        }).join("");
    }
    function load() {
        state.loading = true; render();
        return api("/announcements?schoolId=" + encodeURIComponent(schoolId) + "&scope=notices").then(function (list) {
            state.rows = (Array.isArray(list) ? list : []).filter(function (a) { return a.audience !== "parent" && a.audience !== "admin"; })
                .sort(function (a, b) { return (b.priority === "urgent") - (a.priority === "urgent") || new Date(b.date) - new Date(a.date); });
            state.loaded = true;
        }).catch(function (e) { if (e.message !== "401") toast("Could not load announcements.", true); })
          .then(function () { state.loading = false; render(); });
    }

    /* ───────── compose ───────── */
    function loadClasses() {
        if (state.classes) return Promise.resolve(state.classes);
        return api("/students/summary?schoolId=" + encodeURIComponent(schoolId)).then(function (list) {
            var set = {};
            (list || []).forEach(function (s) {
                if (s.status && String(s.status).toLowerCase() !== "active") return;
                var c = (s.studentClass || "") + (s.section ? " - " + s.section : ""); if (c) set[c] = 1;
            });
            state.classes = Object.keys(set).sort();
            return state.classes;
        });
    }
    function paintCompose() {
        var c = state.c;
        $$("#an-cat button").forEach(function (b) { b.classList.toggle("on", b.dataset.cat === c.cat); });
        $$("#an-aud button").forEach(function (b) { b.classList.toggle("on", b.dataset.aud === c.aud); });
        var showClass = c.aud === "class";
        $("#an-class-wrap").hidden = !showClass;
        if (showClass) {
            var cl = state.classes || [];
            if (!c.cls) c.cls = cl[0] || "";
            $("#an-class").innerHTML = cl.length ? cl.map(function (k) { return '<option value="' + esc(k) + '"' + (k === c.cls ? " selected" : "") + ">" + esc(k) + "</option>"; }).join("") : "<option value=''>Loading classes…</option>";
        }
        var who = { everyone: "every teacher and every parent", teachers: "all teachers", parents: "all parents", class: "the parents of " + (c.cls || "the chosen class") }[c.aud];
        $("#an-to").innerHTML = '<i class="fas fa-paper-plane"></i> Will be sent to <b>' + esc(who) + "</b>";
        $("#an-post").disabled = c.busy || (c.aud === "class" && !c.cls);
    }
    function openCompose() {
        state.c = { cat: "notice", aud: "everyone", cls: "", busy: false };
        $("#an-title").value = ""; $("#an-body").value = ""; $("#an-urgent").checked = false;
        $("#an-modal").hidden = false; paintCompose();
        setTimeout(function () { $("#an-title").focus(); }, 40);
    }
    function closeCompose() { $("#an-modal").hidden = true; }
    function post() {
        var c = state.c; if (c.busy) return;
        var title = $("#an-title").value.trim(), body = $("#an-body").value.trim();
        if (!title) { toast("Add a title.", true); $("#an-title").focus(); return; }
        if (!body) { toast("Write the announcement.", true); $("#an-body").focus(); return; }
        if (c.aud === "class" && !c.cls) { toast("Choose a class.", true); return; }
        var payload = { audience: c.aud, title: title, body: body, category: c.cat, priority: $("#an-urgent").checked ? "urgent" : "normal", senderName: school.name || "Admin" };
        if (c.aud === "class") payload.className = c.cls;
        c.busy = true; paintCompose();
        api("/announcements", { method: "POST", body: JSON.stringify(payload) }).then(function () {
            closeCompose(); toast("Announcement sent."); return load();
        }).catch(function (e) { if (e.message !== "401") toast(e.message || "Could not send.", true); })
          .then(function () { c.busy = false; paintCompose(); });
    }

    /* ───────── delete ───────── */
    function doDelete() {
        var id = state.pendingDelete; state.pendingDelete = null; $("#an-confirm").hidden = true; if (!id) return;
        api("/announcements/" + encodeURIComponent(id) + "?schoolId=" + encodeURIComponent(schoolId), { method: "DELETE" })
            .then(function () { state.rows = state.rows.filter(function (a) { return String(a.id) !== String(id); }); render(); toast("Announcement deleted."); })
            .catch(function (e) { if (e.message !== "401") toast(e.message || "Could not delete.", true); });
    }

    /* ───────── events ───────── */
    function bind() {
        $("#am-main-tabs").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setPane(b.dataset.pane); });
        $("#an-filters").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.filter = b.dataset.f; render(); });
        $("#an-new").addEventListener("click", openCompose);
        $("#an-close").addEventListener("click", closeCompose);
        $("#an-cancel").addEventListener("click", closeCompose);
        $("#an-modal").addEventListener("click", function (e) { if (e.target.id === "an-modal") closeCompose(); });
        $("#an-cat").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.c.cat = b.dataset.cat; paintCompose(); });
        $("#an-aud").addEventListener("click", function (e) {
            var b = e.target.closest("button"); if (!b) return;
            state.c.aud = b.dataset.aud; paintCompose();
            if (state.c.aud === "class" && !state.classes) loadClasses().then(paintCompose).catch(function (er) { if (er.message !== "401") toast("Could not load classes.", true); });
        });
        $("#an-class").addEventListener("change", function (e) { state.c.cls = e.target.value; paintCompose(); });
        $("#an-post").addEventListener("click", post);
        $("#an-body").addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); } });
        $("#an-list").addEventListener("click", function (e) {
            var d = e.target.closest("[data-del]"); if (!d) return;
            state.pendingDelete = d.dataset.del; $("#an-confirm").hidden = false;
        });
        $("#an-no").addEventListener("click", function () { state.pendingDelete = null; $("#an-confirm").hidden = true; });
        $("#an-yes").addEventListener("click", doDelete);
        $("#an-confirm").addEventListener("click", function (e) { if (e.target.id === "an-confirm") { state.pendingDelete = null; $("#an-confirm").hidden = true; } });
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeCompose(); $("#an-confirm").hidden = true; state.pendingDelete = null; } });

        // mirror the unread-messages count (kept by announcements.js) onto the Messages tab
        var src = $("#cnt-all"), dst = $("#mt-msg");
        if (src && dst && window.MutationObserver) {
            var sync = function () { var t = (src.textContent || "").trim(); dst.textContent = t; dst.hidden = !t; };
            new MutationObserver(sync).observe(src, { childList: true, characterData: true, subtree: true }); sync();
        }
    }

    bind();
    var want = new URLSearchParams(location.search).get("tab"), saved = "";
    try { saved = sessionStorage.getItem("am_pane") || ""; } catch (e) { /* ignore */ }
    var deep = new URLSearchParams(location.search);
    // opening a conversation from a student / staff page (?regNo= / ?staffId=) always shows Messages
    setPane(deep.get("regNo") || deep.get("staffId") ? "messages" : (want === "notices" || want === "messages" ? want : (saved === "notices" ? "notices" : "messages")));
})();
