/* ============================================================
   EXAMINATION MODULE
   - Classes, sections and students are LIVE data: GET /api/settings/{schoolId}
     and GET /api/students/list?schoolId=… (same sources Student Management uses).
   - Subject suggestions come from the Teaching staff (GET /api/staff).
   - Papers, marks, the date sheet and the grading scheme are stored on the server
     (/api/exams, see ExamController). localStorage ("ex_data_v2") is only a cache:
     every change is queued ("ex_pending_v1") and re-sent until the server accepts it,
     so nothing is lost if the connection drops. Data an older version kept only in
     this browser is uploaded once automatically.
   - Every printout (paper, date sheet, marks sheet, report cards) is built as a
     standalone A4 document and printed through a hidden iframe, so the page
     chrome (sidebar, buttons) can never leak into a print.
   ============================================================ */
(function () {
    "use strict";

    /* ───────── tiny helpers ───────── */
    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const uid = () => "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const fmt = d => d ? new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
    const dow = d => d ? new Date(d + "T00:00").toLocaleDateString("en-US", { weekday: "long" }) : "";
    const t12 = t => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return ((h % 12) || 12) + ":" + String(m).padStart(2, "0") + " " + (h < 12 ? "AM" : "PM"); };
    const opts = (list, val, blank) => (blank != null ? '<option value="">' + esc(blank) + "</option>" : "") + list.map(x => '<option' + (x === val ? " selected" : "") + ">" + esc(x) + "</option>").join("");
    const field = (label, ctl, cls) => '<div class="ex-f' + (cls ? " " + cls : "") + '"><label>' + label + "</label>" + ctl + "</div>";
    const isAbs = m => /^a(b|bs|bsent)?$/i.test(String(m).trim());
    const isNum = m => String(m).trim() !== "" && m != null && isFinite(m);
    const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
    const empty = (icon, t, s) => '<div class="ex-empty"><i class="fas fa-' + icon + '"></i><b>' + t + "</b>" + (s || "") + "</div>";
    const link = (href, text) => '<a class="ex-link" href="' + href + '">' + text + "</a>";

    /* ───────── constants ───────── */
    const KEY = "ex_data_v2";
    const TERMS = ["Monthly Test", "First Term", "Mid Term", "Final Term"];
    const QTYPES = ["MCQs", "True / False", "Fill in the Blanks", "Short Questions", "Long Questions"];
    const DEF_MARKS = { "MCQs": 1, "True / False": 1, "Fill in the Blanks": 1, "Short Questions": 2, "Long Questions": 5 };
    const SUBJECT_HINTS = ["English", "Urdu", "Mathematics", "Science", "Islamiyat", "Social Studies", "Computer", "Pak Studies", "General Knowledge"];
    const DEF_SCALE = [
        { min: 90, grade: "A+", remark: "Outstanding", pass: true }, { min: 80, grade: "A", remark: "Excellent", pass: true },
        { min: 70, grade: "B", remark: "Very Good", pass: true }, { min: 60, grade: "C", remark: "Good", pass: true },
        { min: 50, grade: "D", remark: "Satisfactory", pass: true }, { min: 40, grade: "E", remark: "Needs Improvement", pass: true },
        { min: 0, grade: "F", remark: "Fail", pass: false }
    ];
    let SCALE = DEF_SCALE.map(g => Object.assign({}, g));   // editable in "Grading Scheme" (each grade is Pass or Fail)
    const gradeOf = pct => { for (const s of SCALE) if (pct >= s.min) return s; return SCALE[SCALE.length - 1]; };
    const isPass = pct => gradeOf(pct).pass !== false;      // pass / fail comes from the grade the mark falls in
    const passFrom = () => { const p = SCALE.filter(s => s.pass !== false).map(s => s.min); return p.length ? Math.min.apply(null, p) : null; };

    /* ───────── session / school ───────── */
    function getSchool() {
        try { if (window.SoftSchoolAdmin) { const s = window.SoftSchoolAdmin.getCurrentSchool(); if (s) return s; } } catch (e) { /* ignore */ }
        try { const s = JSON.parse(localStorage.getItem("softschool_session") || "null"); if (s && s.school) return s.school; } catch (e) { /* ignore */ }
        return { name: "SOFTSCHOOL" };
    }
    const school = getSchool();
    const API_ORIGIN = (typeof window.SOFTSCHOOL_API_ORIGIN === "string" && window.SOFTSCHOOL_API_ORIGIN.trim())
        ? window.SOFTSCHOOL_API_ORIGIN.trim().replace(/\/+$/, "")
        : (window.location.port === "8080" ? "" : "https://167-86-120-247.sslip.io");

    /* ───────── live data (real classes / students / subjects) ───────── */
    const LIVE = { students: [], classes: [], subjects: [], loading: true, error: "" };

    async function getJSON(url) {
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
    }
    async function loadLive() {
        LIVE.loading = true; LIVE.error = "";
        const sid = school.schoolId;
        let stuRaw = null, cls = null, staff = null;
        if (sid) {
            const q = encodeURIComponent(sid);
            const res = await Promise.allSettled([
                getJSON(API_ORIGIN + "/api/students/list?schoolId=" + q),
                getJSON(API_ORIGIN + "/api/settings/" + q),
                getJSON(API_ORIGIN + "/api/staff?schoolId=" + q)
            ]);
            if (res[0].status === "fulfilled" && Array.isArray(res[0].value)) stuRaw = res[0].value;
            if (res[1].status === "fulfilled" && res[1].value && Array.isArray(res[1].value.classes)) cls = res[1].value.classes;
            if (res[2].status === "fulfilled") { const v = res[2].value; staff = Array.isArray(v) ? v : (v && Array.isArray(v.staff) ? v.staff : null); }
        }
        if (!stuRaw) {   // offline / not reachable: use the copy Student Management may have cached
            try { const c = JSON.parse(localStorage.getItem("edu_students") || "null"); if (Array.isArray(c) && c.length) stuRaw = c; } catch (e) { /* ignore */ }
        }
        if (!stuRaw) LIVE.error = sid ? "Could not load students from the server." : "No school session found — please log in again.";
        if (!cls && sid && !LIVE.error) LIVE.error = "Could not load the class list from Settings.";

        LIVE.students = (stuRaw || []).filter(s => s && (!s.status || s.status === "active")).map(s => ({
            reg: String(s.regNo || s.id || ""), roll: String(s.rollNo || ""), name: String(s.fullName || ""),
            father: String(s.guardianName || s.fatherName || ""), cls: String(s.studentClass || ""), section: String(s.section || "")
        })).filter(s => s.name && s.cls);

        const list = (cls || []).map(c => ({ name: String(c.className || c.name || ""), sections: String(c.sections || "").split(",").map(x => x.trim()).filter(Boolean) })).filter(c => c.name);
        LIVE.students.forEach(s => {                      // classes that have students but are missing from Settings
            let c = list.find(x => x.name === s.cls);
            if (!c) { c = { name: s.cls, sections: [] }; list.push(c); }
            if (s.section && c.sections.indexOf(s.section) < 0) c.sections.push(s.section);
        });
        LIVE.classes = list;

        const subj = new Set();
        (staff || []).forEach(t => String((t && (t.subjects || t.subject)) || "").split(/[,/|]/).map(x => x.trim()).filter(x => x && x.length < 30).forEach(x => subj.add(x)));
        LIVE.subjects = Array.from(subj);
        LIVE.loading = false;
    }
    const classNames = () => LIVE.classes.map(c => c.name);
    const sectionsOf = cls => { const c = LIVE.classes.find(x => x.name === cls); return c ? c.sections : []; };
    const studentsOf = (cls, section) => LIVE.students.filter(s => s.cls === cls && (!section || s.section === section))
        .sort((a, b) => (parseInt(a.roll, 10) || 1e9) - (parseInt(b.roll, 10) || 1e9) || natural(a.roll, b.roll) || a.name.localeCompare(b.name));
    const clsLabel = (cls, section) => cls + (section ? " (" + section + ")" : "");
    const allSubjects = () => {
        const s = new Set(LIVE.subjects);
        db.papers.forEach(p => p.subj && s.add(p.subj));
        db.datesheet.forEach(d => d.subject && s.add(d.subject));
        if (!s.size) SUBJECT_HINTS.forEach(x => s.add(x));
        return Array.from(s).sort();
    };

    /* ───────── storage (papers / marks / date sheet) ───────── */
    function load() {
        try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && Array.isArray(d.papers)) return d; } catch (e) { /* ignore */ }
        return { papers: [], results: {}, datesheet: [], draft: null, prefs: { term: "Mid Term", cls: "" } };
    }
    let db = load();
    function applyGrading() {   // use the school's saved grading scheme, else the defaults
        const g = db.grading;
        if (g && Array.isArray(g.scale) && g.scale.length) {
            const old = isFinite(g.pass) ? +g.pass : 40;   // schemes saved before per-grade Pass/Fail had one pass mark
            const sc = g.scale.filter(x => x && x.grade && isFinite(x.min)).map(x => ({ min: +x.min, grade: String(x.grade), remark: String(x.remark || ""), pass: typeof x.pass === "boolean" ? x.pass : +x.min >= old })).sort((a, b) => b.min - a.min);
            if (sc.length && sc[sc.length - 1].min <= 0) { SCALE = sc; return; }
        }
        SCALE = DEF_SCALE.map(x => Object.assign({}, x));
    }
    applyGrading();
    function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } }
    let saveT; const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 400); };

    /* ───────── server sync (/api/exams) ───────── */
    const QKEY = "ex_pending_v1";
    const SYNC = { queue: [], busy: false, warned: false };
    try { const q = JSON.parse(localStorage.getItem(QKEY) || "[]"); if (Array.isArray(q)) SYNC.queue = q.filter(o => o && o.sid === school.schoolId && o.method && o.path); } catch (e) { /* ignore */ }
    const saveQ = () => { try { localStorage.setItem(QKEY, JSON.stringify(SYNC.queue)); } catch (e) { /* ignore */ } };
    const warnOnce = msg => { if (!SYNC.warned) { SYNC.warned = true; toast(msg, true); } };
    async function rawCall(method, path, body, ms) {
        const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 15000);
        try {
            return await fetch(API_ORIGIN + "/api/exams" + path + "?schoolId=" + encodeURIComponent(school.schoolId), {
                method, signal: ctl.signal,
                headers: Object.assign({ Accept: "application/json" }, body !== undefined ? { "Content-Type": "application/json" } : {}),
                body: body !== undefined ? JSON.stringify(body) : undefined
            });
        } finally { clearTimeout(t); }
    }
    /* Queue a change (the newest write to a resource replaces an older queued one) and try to send it now. */
    function pend(method, path, body) {
        if (!school.schoolId) return;
        SYNC.queue = SYNC.queue.filter(o => o.path !== path);
        SYNC.queue.push({ sid: school.schoolId, method, path, body });
        saveQ(); flush();
    }
    function dropQ(path) { SYNC.queue = SYNC.queue.filter(o => o.path !== path); saveQ(); }
    async function flush() {
        if (SYNC.busy) return;
        SYNC.busy = true;
        try {
            while (SYNC.queue.length) {
                const op = SYNC.queue[0];
                let r;
                try { r = await rawCall(op.method, op.path, op.body); }
                catch (e) { warnOnce("Offline - your changes are kept on this device and will sync automatically."); break; }
                if (r.ok || (r.status === 404 && op.method === "DELETE")) { SYNC.queue = SYNC.queue.filter(o => o !== op); saveQ(); continue; }
                if (r.status === 401 || r.status === 429 || r.status >= 500) { warnOnce(r.status === 401 ? "Your session expired - log in again to sync your changes." : "The server is busy - will retry shortly."); break; }
                let m = "The server rejected a change (HTTP " + r.status + ").";
                try { const j = await r.json(); m = j.message || j.error || m; } catch (e) { /* keep default */ }
                SYNC.queue = SYNC.queue.filter(o => o !== op); saveQ();
                toast(m, true);
            }
        } finally { SYNC.busy = false; }
    }
    const blankDb = () => ({ papers: [], results: {}, datesheet: [], draft: null, prefs: { term: "Mid Term", cls: "" } });
    /* Replace the local copy with the server's, after uploading anything still waiting to be sent. */
    async function loadServer() {
        const sid = school.schoolId;
        if (!sid) return;
        await flush();
        if (SYNC.queue.length) return;                       // unsent edits on this device win until they upload
        const get = async path => { const r = await rawCall("GET", path, undefined, 20000); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
        if (db.srvSchool && db.srvSchool !== sid) db = blankDb();   // cache belongs to another school
        let boot = await get("/bootstrap");
        const hasLocal = db.papers.length || db.datesheet.length || Object.keys(db.results).length || db.grading;
        if (!db.srvSchool && hasLocal) {                      // one-time move of data an older version kept only in this browser
            const r = await rawCall("POST", "/import", { papers: db.papers, results: db.results, datesheet: db.datesheet, grading: db.grading }, 30000);
            if (r.ok) boot = await get("/bootstrap");
        }
        db.papers = boot.papers || []; db.results = boot.results || {}; db.datesheet = boot.datesheet || [];
        if (boot.grading && Array.isArray(boot.grading.scale)) db.grading = { scale: boot.grading.scale }; else delete db.grading;
        db.srvSchool = sid;
        applyGrading(); save();
    }
    window.addEventListener("online", flush);
    setInterval(flush, 30000);

    /* ───────── UI plumbing ───────── */
    function toast(msg, err) {
        const t = $("#ex-toast"); t.textContent = msg; t.className = "ex-toast" + (err ? " err" : ""); t.hidden = false;
        clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3000);
    }
    function openModal(html, bind) {
        $("#ex-sheet").innerHTML = html; $("#ex-modal").hidden = false;
        $$("[data-close]", $("#ex-sheet")).forEach(b => b.addEventListener("click", closeModal));
        if (bind) bind($("#ex-sheet"));
    }
    function closeModal() { $("#ex-modal").hidden = true; }
    function confirmBox(title, msg, okText, onOk) {
        openModal("<h3>" + title + "</h3><p class='ex-modal-p'>" + msg + "</p><div class='row'><button class='ex-btn ghost' data-close>Cancel</button><button class='ex-btn danger' id='cf-ok'>" + okText + "</button></div>",
            s => $("#cf-ok", s).addEventListener("click", () => { closeModal(); onOk(); }));
    }
    function download(name, text) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    const csvCell = v => { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const ROOT = () => $("#ex-root");
    function freshRoot() { const old = ROOT(), n = old.cloneNode(false); old.parentNode.replaceChild(n, old); return n; }
    function head(icon, title, sub, actions) {
        return '<div class="ex-title"><div class="ex-title-main"><a class="ex-back" href="#hub" title="Back to Examination"><i class="fas fa-arrow-left"></i></a><div><h2><i class="fas fa-' + icon + '"></i> ' + title + "</h2><p>" + sub + '</p></div></div><div class="ex-actions">' + (actions || "") + "</div></div>";
    }
    function stat(ic, fa, val, label) {
        return '<div class="stat-pill"><div class="stat-pill-icon ' + ic + '"><i class="fas fa-' + fa + '"></i></div><div class="stat-pill-info"><span class="stat-pill-value">' + val + '</span><span class="stat-pill-label">' + label + "</span></div></div>";
    }
    function dataBanner() {
        if (LIVE.error) return '<div class="ex-alert warn"><i class="fas fa-triangle-exclamation"></i><div><b>' + esc(LIVE.error) + '</b><span>Showing whatever is available. Classes and students come straight from Student Management &amp; Settings.</span></div><button class="ex-btn sm" data-reload>Retry</button></div>';
        if (!LIVE.classes.length) return '<div class="ex-alert"><i class="fas fa-circle-info"></i><div><b>No classes found</b><span>Add classes in Settings and students in Student Management — they appear here automatically.</span></div></div>';
        return "";
    }
    function bindReload() { $$("[data-reload]").forEach(b => b.addEventListener("click", () => { b.disabled = true; b.textContent = "Loading…"; loadLive().then(route); })); }
    function ensurePrefs() {
        const names = classNames();
        if (!db.prefs.term) db.prefs.term = TERMS[2];
        if (names.length && names.indexOf(db.prefs.cls) < 0) db.prefs.cls = names[0];
    }
    function termClassBar(extra) {
        ensurePrefs();
        return '<div class="ex-grid">' + field("Exam / Term", '<select data-pref="term">' + opts(TERMS, db.prefs.term) + "</select>") +
            field("Class", '<select data-pref="cls">' + (classNames().length ? opts(classNames(), db.prefs.cls) : "<option value=''>No classes</option>") + "</select>") + (extra || "") + "</div>";
    }
    function bindPrefs(root, cb) { $$("[data-pref]", root).forEach(s => s.addEventListener("change", () => { db.prefs[s.dataset.pref] = s.value; save(); cb(); })); }
    function subjectList() { return '<datalist id="ex-subjects">' + allSubjects().map(s => "<option value=\"" + esc(s) + "\">").join("") + "</datalist>"; }

    /* ============================================================
       PRINTING — standalone A4 documents through a hidden iframe
       ============================================================ */
    const DOC_CSS = `
.doc{font-family:'Times New Roman',Georgia,serif;color:#111;background:#fff;line-height:1.45;font-size:14px}
.doc *{box-sizing:border-box}
.doc-head{display:flex;align-items:center;justify-content:center;gap:14px;text-align:center}
.doc-head img{width:64px;height:64px;object-fit:contain}
.doc h1{margin:0;font-size:22px;text-transform:uppercase;letter-spacing:.6px}
.doc .sub{font-size:15px;font-weight:700;margin:2px 0 10px;text-align:center}
.doc .meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 18px;border-top:2px solid #111;border-bottom:2px solid #111;padding:6px 0;font-weight:700;font-size:13px}
.doc .stu{display:flex;gap:16px;margin:14px 0 8px;font-size:13px}
.doc .stu span{flex:1;border-bottom:1px solid #111;height:20px;white-space:nowrap}
.doc .note{font-size:12.5px;font-style:italic;margin:6px 0 12px}
.doc .secthead{display:flex;justify-content:space-between;gap:10px;font-weight:700;background:#ececec;padding:4px 9px;margin:16px 0 9px;font-size:13.5px;break-after:avoid;page-break-after:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc ol.qs{margin:0;padding-left:24px}
.doc ol.qs li{margin-bottom:10px;break-inside:avoid;page-break-inside:avoid}
.doc li .qt{white-space:pre-wrap}
.doc li .mk{float:right;font-weight:700;margin-left:12px}
.doc .opts{display:flex;flex-wrap:wrap;gap:3px 26px;margin-top:4px;font-size:13px;clear:both}
.doc .opts span{min-width:120px}
.doc .foot{text-align:center;font-weight:700;margin-top:20px;font-size:13px}
.doc table{width:100%;border-collapse:collapse;font-size:13px}
.doc th,.doc td{border:1px solid #333;padding:5px 8px;text-align:left}
.doc th{background:#e9eeee;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc td.c,.doc th.c{text-align:center}
.doc h2.cls{font-size:15px;margin:18px 0 6px}
.doc-rc{padding:22px 26px;border:3px double #17716A;margin:0 auto;max-width:760px}
.doc-rc dl{display:grid;grid-template-columns:100px 1fr 100px 1fr;gap:4px 10px;margin:12px 0 14px;font-size:13.5px}
.doc-rc dt{font-weight:700}.doc-rc dd{margin:0}
.doc-rc table td,.doc-rc table th{text-align:center}
.doc-rc table td:first-child,.doc-rc table th:first-child{text-align:left}
.doc-rc .sum{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:14px 0;font-weight:700}
.doc-rc .sig{display:flex;justify-content:space-between;margin-top:46px;font-size:12.5px;font-weight:700}
.doc-rc .sig span{border-top:1px solid #111;padding-top:3px;min-width:130px;text-align:center}
.doc .pg-break{break-after:page;page-break-after:always}
.doc .pg-break:last-child{break-after:auto;page-break-after:auto}
.doc .ph{color:#888}
`;
    (function injectDocCss() { const st = document.createElement("style"); st.id = "ex-doc-css"; st.textContent = DOC_CSS; document.head.appendChild(st); })();

    function printDoc(title, bodyHtml, landscape) {
        $$("iframe.ex-print-frame").forEach(f => f.remove());
        const f = document.createElement("iframe");
        f.className = "ex-print-frame"; f.setAttribute("aria-hidden", "true");
        document.body.appendChild(f);
        const d = f.contentWindow.document;
        d.open();
        d.write("<!doctype html><html><head><meta charset='utf-8'><title>" + esc(title) + "</title><style>@page{size:A4" + (landscape ? " landscape" : "") + ";margin:13mm}html,body{margin:0;padding:0;background:#fff}" + DOC_CSS + "</style></head><body>" + bodyHtml + "</body></html>");
        d.close();
        let fired = false;
        const go = () => {
            if (fired) return; fired = true;
            try { f.contentWindow.focus(); f.contentWindow.print(); }
            catch (e) { toast("Printing is blocked by the browser.", 1); }
            setTimeout(() => f.remove(), 60000);
        };
        const imgs = Array.from(d.images).filter(i => !i.complete);
        if (!imgs.length) setTimeout(go, 150);
        else { let n = imgs.length; imgs.forEach(i => { const done = () => { if (--n <= 0) setTimeout(go, 50); }; i.onload = i.onerror = done; }); setTimeout(go, 2500); }
    }
    const docHead = (sub) => '<div class="doc-head">' + (school.logo ? '<img src="' + esc(school.logo) + '" alt="">' : "") + "<div><h1>" + esc(school.name || "School") + "</h1></div></div>" + (sub ? '<div class="sub">' + sub + "</div>" : "");

    /* ============================================================
       HUB
       ============================================================ */
    function paperStatus(p) {
        const r = db.results[p.id], ro = studentsOf(p.cls, p.section);
        if (!r) return { key: "none", label: "Not uploaded", cls: "", done: 0, of: ro.length };
        const done = ro.filter(s => r.marks && r.marks[s.reg] != null && r.marks[s.reg] !== "").length;
        return { key: r.status, label: r.status === "published" ? "Published" : "Draft", cls: r.status === "published" ? "ok" : "warn", done, of: ro.length };
    }
    function vHub() {
        ensurePrefs();
        const today = iso(new Date());
        const up = db.datesheet.filter(d => d.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
        const pubd = db.papers.filter(p => paperStatus(p).key === "published").length;
        const waiting = db.papers.length - pubd;
        const tiles = [
            ["paper", "file-pen", "#3b82f6", "Paper Generation", "Write questions straight into sections, set marks and time, then print a clean A4 paper.", db.papers.length + " saved", ""],
            ["results", "file-arrow-up", "#10b981", "Result Upload", "Pick a generated paper and enter or import marks for the real students of its class.", waiting + " awaiting", waiting ? "warn" : "ok"],
            ["datesheet", "calendar-days", "#8b5cf6", "Date Sheet", "Plan the exam timetable for every class — dates, timings and rooms — and print it.", up.length + " upcoming", "info"],
            ["cards", "award", "#17716A", "Report Cards", "Result cards with grades, percentage, position and remarks, ready to print.", pubd + " published", ""],
            ["analysis", "chart-column", "#ec4899", "Result Analysis", "Subject averages, grade spread, toppers and students who need attention.", "Charts & insights", ""],
            ["grading", "ranking-star", "#f59e0b", "Grading Scheme", "Set the grade scale (A+, A, B …) and choose which grades are Pass or Fail on marks sheets, report cards and analysis.", SCALE.length + " grades · " + SCALE.filter(s => s.pass === false).length + " fail", ""]
        ];
        const recent = db.papers.slice(0, 5);
        ROOT().innerHTML =
            '<section class="ex-hero"><div><span class="ex-eyebrow">Examination</span><h2>Papers, results &amp; report cards</h2><p>' + (LIVE.students.length ? "Working with <b>" + LIVE.students.length + "</b> active students across <b>" + LIVE.classes.length + "</b> classes." : "Connect classes and students to get started.") + '</p></div><div class="ex-hero-actions"><button class="ex-btn light" data-go="paper"><i class="fas fa-plus"></i> New Paper</button><button class="ex-btn glass" data-reload><i class="fas fa-rotate"></i> Refresh data</button></div></section>' +
            dataBanner() +
            '<section class="quick-stats-strip">' +
            stat("icon-staff", "file-pen", db.papers.length, "Papers Generated") +
            stat("icon-present-staff", "hourglass-half", waiting, "Results Awaiting") +
            stat("icon-students", "calendar-check", up.length, "Upcoming Papers") +
            stat("icon-present-students", "user-graduate", LIVE.students.length, "Active Students") + "</section>" +
            '<section class="ex-ccards">' + tiles.map(t =>
                '<button class="ex-ccard" type="button" data-go="' + t[0] + '" style="--cc:' + t[2] + '">' +
                '<div class="ex-cc-name">' + t[3] + '</div><div class="ex-cc-meta">' + t[4] + '</div>' +
                '<div class="ex-cc-count ' + t[6] + '"><i class="fas fa-' + t[1] + '"></i>' + t[5] + "</div></button>").join("") + "</section>" +
            '<section class="ex-two">' +
            '<div class="ex-panel"><h3><i class="fas fa-file-lines"></i> Recent Papers <span class="ex-spacer">' + link("#results", "All results") + "</span></h3>" + (recent.length ?
                '<div class="ex-tablewrap"><table class="ex-table"><thead><tr><th>Paper</th><th>Class</th><th>Marks</th><th>Results</th></tr></thead><tbody>' +
                recent.map(p => { const s = paperStatus(p); return "<tr><td><b>" + esc(p.title) + "</b></td><td>" + esc(clsLabel(p.cls, p.section)) + "</td><td>" + p.total + '</td><td><a href="#results/' + p.id + '"><span class="ex-chip ' + s.cls + '">' + s.label + "</span></a></td></tr>"; }).join("") + "</tbody></table></div>"
                : empty("file-circle-plus", "No papers yet", "Create one in " + link("#paper", "Paper Generation") + ".")) + "</div>" +
            '<div class="ex-panel"><h3><i class="fas fa-calendar-days"></i> Upcoming Papers <span class="ex-spacer">' + link("#datesheet", "Date sheet") + "</span></h3>" + (up.length ?
                '<div class="ex-tablewrap"><table class="ex-table"><thead><tr><th>Date</th><th>Class</th><th>Subject</th><th>Time</th></tr></thead><tbody>' +
                up.slice(0, 6).map(d => "<tr><td>" + fmt(d.date) + "<br><small class='muted'>" + dow(d.date) + "</small></td><td>" + esc(d.cls) + "</td><td><b>" + esc(d.subject) + "</b></td><td>" + t12(d.start) + " – " + t12(d.end) + "</td></tr>").join("") + "</tbody></table></div>"
                : empty("calendar-xmark", "No upcoming papers", "Add entries in " + link("#datesheet", "Date Sheet") + ".")) + "</div></section>";
        $$("[data-go]").forEach(b => b.addEventListener("click", () => { location.hash = "#" + b.dataset.go; }));
        bindReload();
    }

    /* ============================================================
       PAPER GENERATION — questions are written inside the paper
       ============================================================ */
    let P = null;
    const blankQ = type => ({ text: "", opts: type === "MCQs" ? ["", "", "", ""] : [] });
    const mkSection = type => ({ type, attempt: 0, marks: DEF_MARKS[type] || 1, questions: [blankQ(type)] });
    function newPaper() {
        ensurePrefs();
        return {
            id: null, term: db.prefs.term, cls: db.prefs.cls || "", section: "", subj: "", date: iso(new Date()), mins: 90, title: "",
            instr: "Read each question carefully. Write neatly. Attempt all sections as instructed.",
            sections: [mkSection("MCQs"), mkSection("Short Questions"), mkSection("Long Questions")]
        };
    }
    const filled = sec => sec.questions.filter(q => q.text.trim());
    const effAttempt = sec => { const n = filled(sec).length, a = +sec.attempt; return a > 0 && a < n ? a : n; };
    const paperTotal = p => p.sections.reduce((a, s) => a + effAttempt(s) * (+s.marks || 0), 0);
    const paperQs = p => p.sections.reduce((a, s) => a + filled(s).length, 0);
    const defTitle = p => (p.subj || "Paper") + " — " + p.term + " (" + clsLabel(p.cls, p.section) + ")";

    function paperHtml(p) {
        const L = "ABCDEFGH";
        let h = docHead(esc(p.term) + " Examination " + (p.date ? p.date.slice(0, 4) : new Date().getFullYear())) +
            '<div class="meta"><span>Subject: ' + esc(p.subj || "—") + "</span><span>Class: " + esc(clsLabel(p.cls, p.section) || "—") + "</span><span>Time: " + (+p.mins || 0) + " mins</span><span>Max Marks: " + paperTotal(p) + "</span></div>" +
            '<div class="stu"><span>Name:</span><span style="flex:.55">Roll No:</span><span style="flex:.55">Date: ' + fmt(p.date) + "</span></div>" +
            (p.instr.trim() ? '<div class="note">' + esc(p.instr) + "</div>" : "");
        let any = false;
        p.sections.forEach((sec, i) => {
            const qs = filled(sec); if (!qs.length) return; any = true;
            const att = effAttempt(sec), mk = +sec.marks || 0;
            h += '<div class="secthead"><span>Section ' + L[i] + " — " + esc(sec.type) + " (" + (att >= qs.length ? "Attempt all" : "Attempt any " + att + " of " + qs.length) + ")</span><span>" + att + " × " + mk + " = " + att * mk + '</span></div><ol class="qs">';
            qs.forEach(q => {
                h += '<li><span class="qt">' + esc(q.text.trim()) + "</span>" + (sec.type !== "MCQs" ? '<span class="mk">[' + mk + "]</span>" : "");
                if (sec.type === "MCQs") { const o = q.opts.map(x => x.trim()).filter(Boolean); if (o.length) h += '<div class="opts">' + o.map((x, k) => "<span>(" + "abcdefgh"[k] + ") " + esc(x) + "</span>").join("") + "</div>"; }
                if (sec.type === "True / False") h += '<div class="opts"><span>True / False</span></div>';
                h += "</li>";
            });
            h += "</ol>";
        });
        if (!any) h += '<p class="ph" style="text-align:center;margin:40px 0">Start typing questions on the left — they appear here.</p>';
        return h + '<div class="foot">— End of Paper —</div>';
    }
    function classCtl(attr, val) {
        const n = classNames();
        return n.length ? '<select ' + attr + ">" + (val && n.indexOf(val) < 0 ? "<option>" + esc(val) + "</option>" : "") + opts(n, val) + "</select>" : '<input ' + attr + ' value="' + esc(val) + '" placeholder="Class name">';
    }
    function vPaper() {
        if (!P) P = db.draft ? JSON.parse(JSON.stringify(db.draft)) : newPaper();
        freshRoot();   // new node => no duplicate listeners when the view is re-rendered
        const root = ROOT();
        root.innerHTML = head("file-pen", "Paper <span>Generation</span>", "Set up the paper, write your questions inside each section, then print.",
            '<button class="ex-btn ghost" id="pg-reset"><i class="fas fa-file-circle-plus"></i> New</button><button class="ex-btn ghost" id="pg-save"><i class="fas fa-floppy-disk"></i> Save</button><button class="ex-btn" id="pg-print"><i class="fas fa-print"></i> Print</button>') +
            dataBanner() + subjectList() +
            '<div class="ex-split"><div class="ex-col-left">' +
            '<div class="ex-panel"><h3><span class="ex-step">1</span> Paper Setup</h3><div class="ex-grid">' +
            field("Exam / Term", '<select data-p="term">' + opts(TERMS, P.term) + "</select>") +
            field("Class", classCtl('data-p="cls"', P.cls)) +
            field("Section", '<select data-p="section" id="pg-section"></select>') +
            field("Subject", '<input data-p="subj" list="ex-subjects" placeholder="e.g. Mathematics" value="' + esc(P.subj) + '">') +
            field("Date", '<input type="date" data-p="date" value="' + esc(P.date) + '">') +
            field("Duration (mins)", '<input type="number" min="5" data-p="mins" value="' + esc(P.mins) + '">') + "</div>" +
            '<div class="ex-grid one" style="margin-top:12px">' + field("Paper title <small>(optional)</small>", '<input data-p="title" placeholder="Auto: Subject — Term (Class)" value="' + esc(P.title) + '">') +
            field("Instructions", '<textarea data-p="instr" rows="2">' + esc(P.instr) + "</textarea>") + "</div></div>" +
            '<div class="ex-panel"><h3><span class="ex-step">2</span> Sections &amp; Questions <span class="ex-spacer"><button class="ex-btn sm ghost" id="pg-addsec"><i class="fas fa-plus"></i> Section</button></span></h3><div id="pg-secs"></div>' +
            '<div class="ex-total"><span><i class="fas fa-calculator"></i> Total marks</span><b id="pg-total"></b></div></div></div>' +
            '<div class="ex-col-right"><div class="ex-panel ex-sticky"><h3><i class="fas fa-eye"></i> Live Preview <small id="pg-count"></small></h3><div class="ex-paper-wrap"><div class="ex-sheetpage doc" id="pg-paper"></div></div></div></div></div>' +
            '<div class="ex-panel"><h3><i class="fas fa-folder-open"></i> Saved Papers</h3><div id="pg-saved"></div></div>';
        fillSections(); secs(); preview(); savedList();

        root.addEventListener("input", onChange); root.addEventListener("change", onChange);
        function onChange(e) {
            const t = e.target;
            if (t.dataset.p) {
                P[t.dataset.p] = t.dataset.p === "mins" ? (+t.value || 0) : t.value;
                if (t.dataset.p === "cls") { P.section = ""; fillSections(); }
                preview(); keep();
            } else if (t.dataset.f) {
                const sec = P.sections[+t.dataset.s], f = t.dataset.f;
                if (f === "text") { sec.questions[+t.dataset.q].text = t.value; autoGrow(t); }
                else if (f.indexOf("opt") === 0) sec.questions[+t.dataset.q].opts[+f.slice(3)] = t.value;
                else if (f === "type") { sec.type = t.value; sec.questions.forEach(q => { q.opts = t.value === "MCQs" ? (q.opts.length ? q.opts : ["", "", "", ""]) : []; }); if (DEF_MARKS[t.value] && !sec.touched) sec.marks = DEF_MARKS[t.value]; secs(); }
                else if (f === "attempt") sec.attempt = Math.max(0, +t.value || 0);
                else if (f === "marks") { sec.marks = Math.max(0, +t.value || 0); sec.touched = true; }
                if (f !== "text" && f.indexOf("opt") !== 0) totals();
                preview(); keep();
            }
        }
        root.addEventListener("click", e => {
            const b = e.target.closest("button"); if (!b) return;
            if (b.dataset.rmsec != null) { if (P.sections.length <= 1) return toast("A paper needs at least one section.", 1); P.sections.splice(+b.dataset.rmsec, 1); secs(); preview(); keep(); }
            else if (b.dataset.addq != null) { const sec = P.sections[+b.dataset.addq]; sec.questions.push(blankQ(sec.type)); secs(); const ta = $$('[data-s="' + b.dataset.addq + '"][data-f="text"]').pop(); if (ta) ta.focus(); keep(); }
            else if (b.dataset.rmq != null) { const [s, q] = b.dataset.rmq.split("."); const sec = P.sections[+s]; sec.questions.splice(+q, 1); if (!sec.questions.length) sec.questions.push(blankQ(sec.type)); secs(); preview(); keep(); }
        });
        $("#pg-addsec").addEventListener("click", () => { if (P.sections.length >= 8) return toast("Maximum 8 sections.", 1); P.sections.push(mkSection("Short Questions")); secs(); preview(); keep(); });
        $("#pg-reset").addEventListener("click", () => {
            const go = () => { P = newPaper(); db.draft = null; save(); vPaper(); window.scrollTo(0, 0); };
            paperQs(P) ? confirmBox("Start a new paper?", "The questions you have typed in the current paper will be cleared. Saved papers are not affected.", "Clear &amp; start new", go) : go();
        });
        $("#pg-print").addEventListener("click", () => {
            if (!paperQs(P)) return toast("Write at least one question before printing.", 1);
            printDoc(P.title || defTitle(P), '<div class="doc">' + paperHtml(P) + "</div>");
        });
        $("#pg-save").addEventListener("click", () => {
            if (!P.cls) return toast("Choose a class.", 1);
            if (!P.subj.trim()) return toast("Enter the subject.", 1);
            if (!paperQs(P)) return toast("Write at least one question.", 1);
            const title = P.title.trim() || defTitle(P), data = JSON.parse(JSON.stringify(P));
            const rec = { id: P.id || uid(), title, term: P.term, cls: P.cls, section: P.section || "", subj: P.subj.trim(), date: P.date, total: paperTotal(P), at: Date.now(), sections: data.sections, mins: P.mins, instr: P.instr };
            const i = db.papers.findIndex(x => x.id === rec.id);
            if (i >= 0) db.papers[i] = rec; else db.papers.unshift(rec);
            P.id = rec.id; db.draft = JSON.parse(JSON.stringify(P)); save(); pend("PUT", "/papers/" + rec.id, rec); savedList(); toast("Paper saved — it is now available in Result Upload.");
        });
    }
    function keep() { db.draft = JSON.parse(JSON.stringify(P)); saveSoon(); }
    function autoGrow(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 260) + "px"; }
    function fillSections() {
        const sel = $("#pg-section"); if (!sel) return;
        const list = sectionsOf(P.cls);
        sel.innerHTML = '<option value="">All sections</option>' + list.map(s => "<option" + (s === P.section ? " selected" : "") + ">" + esc(s) + "</option>").join("");
        sel.disabled = !list.length;
    }
    function totals() { const t = $("#pg-total"); if (t) t.textContent = paperTotal(P) + " marks"; }
    function footTxt(s) { const n = filled(s).length; return n + " question" + (n === 1 ? "" : "s") + " · " + effAttempt(s) * (+s.marks || 0) + " marks"; }
    function preview() {
        $$("[data-foot]").forEach(e => { e.textContent = footTxt(P.sections[+e.dataset.foot]); });
        const p = $("#pg-paper"); if (p) p.innerHTML = paperHtml(P);
        totals(); const c = $("#pg-count"); if (c) c.textContent = paperQs(P) + " questions";
    }
    function secs() {
        const box = $("#pg-secs"); if (!box) return;
        const L = "ABCDEFGH";
        box.innerHTML = P.sections.map((s, i) => {
            const n = filled(s).length;
            return '<div class="pg-sec"><div class="pg-sec-head"><span class="pg-badge">' + L[i] + "</span>" +
                '<div class="pg-sec-ctl">' + field("Type", '<select data-s="' + i + '" data-f="type">' + opts(QTYPES, s.type) + "</select>", "grow") +
                field("Attempt <small>(0 = all)</small>", '<input type="number" min="0" data-s="' + i + '" data-f="attempt" value="' + (+s.attempt || 0) + '">') +
                field("Marks each", '<input type="number" min="0" data-s="' + i + '" data-f="marks" value="' + (+s.marks || 0) + '">') + "</div>" +
                '<button class="ex-icon-btn del" type="button" data-rmsec="' + i + '" title="Remove section"><i class="fas fa-trash"></i></button></div>' +
                '<div class="pg-qs">' + s.questions.map((q, k) =>
                    '<div class="pg-q"><span class="n">' + (k + 1) + '</span><div class="body"><textarea rows="2" data-s="' + i + '" data-q="' + k + '" data-f="text" placeholder="' + (s.type === "Fill in the Blanks" ? "Type the sentence — use ______ for the blank" : s.type === "True / False" ? "Type the statement" : "Type the question…") + '">' + esc(q.text) + "</textarea>" +
                    (s.type === "MCQs" ? '<div class="pg-opts">' + [0, 1, 2, 3].map(o => '<label><i>' + "abcd"[o] + '</i><input data-s="' + i + '" data-q="' + k + '" data-f="opt' + o + '" value="' + esc(q.opts[o] || "") + '" placeholder="Option ' + "ABCD"[o] + '"></label>').join("") + "</div>" : "") +
                    '</div><button class="ex-icon-btn del" type="button" data-rmq="' + i + "." + k + '" title="Remove question"><i class="fas fa-xmark"></i></button></div>').join("") + "</div>" +
                '<div class="pg-sec-foot"><button class="ex-btn sm ghost" type="button" data-addq="' + i + '"><i class="fas fa-plus"></i> Add question</button><span class="pg-foot-n" data-foot="' + i + '">' + footTxt(s) + "</span></div></div>";
        }).join("");
        $$("textarea[data-f=text]", box).forEach(autoGrow);
        totals();
    }
    function savedList() {
        const b = $("#pg-saved"); if (!b) return;
        b.innerHTML = db.papers.length ? '<div class="ex-tablewrap"><table class="ex-table"><thead><tr><th>Title</th><th>Class</th><th>Subject</th><th>Marks</th><th>Saved</th><th></th></tr></thead><tbody>' +
            db.papers.map(p => "<tr><td><b>" + esc(p.title) + "</b>" + (P && P.id === p.id ? ' <span class="ex-chip info">editing</span>' : "") + "</td><td>" + esc(clsLabel(p.cls, p.section)) + "</td><td>" + esc(p.subj) + "</td><td>" + p.total + "</td><td>" + new Date(p.at).toLocaleDateString("en-GB") +
                '</td><td class="ex-rowact"><button class="ex-btn sm ghost" data-open="' + p.id + '"><i class="fas fa-pen"></i> Edit</button><button class="ex-icon-btn" data-dup="' + p.id + '" title="Duplicate"><i class="fas fa-copy"></i></button><button class="ex-icon-btn" data-prn="' + p.id + '" title="Print"><i class="fas fa-print"></i></button><button class="ex-icon-btn del" data-del="' + p.id + '" title="Delete"><i class="fas fa-trash"></i></button></td></tr>').join("") + "</tbody></table></div>"
            : empty("folder-open", "No saved papers yet", "Press Save to keep a paper here and use it in Result Upload.");
        const get = id => db.papers.find(q => q.id === id);
        const toP = (p, copy) => ({ id: copy ? null : p.id, term: p.term, cls: p.cls, section: p.section || "", subj: copy ? p.subj : p.subj, date: p.date, mins: p.mins, title: copy ? "" : (p.title === defTitle(p) ? "" : p.title), instr: p.instr, sections: JSON.parse(JSON.stringify(p.sections)) });
        $$("[data-open]", b).forEach(x => x.addEventListener("click", () => { const p = get(x.dataset.open); if (p) { P = toP(p); keep(); vPaper(); window.scrollTo(0, 0); } }));
        $$("[data-dup]", b).forEach(x => x.addEventListener("click", () => { const p = get(x.dataset.dup); if (p) { P = toP(p, true); keep(); vPaper(); window.scrollTo(0, 0); toast("Copy opened — save it to keep it."); } }));
        $$("[data-prn]", b).forEach(x => x.addEventListener("click", () => { const p = get(x.dataset.prn); if (p) printDoc(p.title, '<div class="doc">' + paperHtml(toP(p)) + "</div>"); }));
        $$("[data-del]", b).forEach(x => x.addEventListener("click", () => {
            const p = get(x.dataset.del); if (!p) return;
            confirmBox("Delete this paper?", "<b>" + esc(p.title) + "</b>" + (db.results[p.id] ? " and the marks uploaded for it" : "") + " will be removed permanently.", "Delete", () => {
                db.papers = db.papers.filter(q => q.id !== p.id); delete db.results[p.id]; if (P && P.id === p.id) { P.id = null; keep(); } save(); dropQ("/results/" + p.id); pend("DELETE", "/papers/" + p.id); savedList();
            });
        }));
    }

    /* ============================================================
       RESULT UPLOAD — only generated papers, only the real students
       ============================================================ */
    let RS = null;   // marks sheet state
    function vResults(paperId) {
        if (paperId) return vSheet(paperId);
        ensurePrefs();
        const fl = db.prefs.rfilter || "";
        const list = db.papers.filter(p => !fl || p.cls === fl);
        ROOT().innerHTML = head("file-arrow-up", "Result <span>Upload</span>", "Choose a generated paper to enter or import marks for its class.") + dataBanner() +
            '<div class="ex-panel"><div class="ex-grid" style="max-width:560px">' + field("Show papers of", '<select id="ru-f">' + opts(classNames(), fl, "All classes") + "</select>") + "</div></div>" +
            (list.length ? '<div class="ex-papers">' + list.map(p => {
                const s = paperStatus(p), pct = s.of ? Math.round(s.done / s.of * 100) : 0;
                return '<a class="ex-pcard" href="#results/' + p.id + '"><div class="ex-pcard-top"><span class="ex-chip ' + s.cls + '">' + s.label + '</span><small>' + esc(p.term) + "</small></div><h4>" + esc(p.title) + "</h4>" +
                    '<div class="ex-pcard-meta"><span><i class="fas fa-users-rectangle"></i> ' + esc(clsLabel(p.cls, p.section)) + '</span><span><i class="fas fa-book"></i> ' + esc(p.subj) + '</span><span><i class="fas fa-star-half-stroke"></i> ' + p.total + ' marks</span></div>' +
                    '<div class="ex-prog"><i style="width:' + pct + '%"></i></div><div class="ex-pcard-foot"><span>' + s.done + " of " + s.of + " students entered</span><b>" + (s.key === "none" ? "Upload marks" : s.key === "published" ? "View" : "Continue") + ' <i class="fas fa-arrow-right"></i></b></div></a>';
            }).join("") + "</div>" : '<div class="ex-panel">' + empty("file-circle-plus", db.papers.length ? "No papers for this class" : "No papers generated yet", "Results are uploaded against a paper. Create one in " + link("#paper", "Paper Generation") + " and save it.") + "</div>");
        const f = $("#ru-f"); if (f) f.addEventListener("change", () => { db.prefs.rfilter = f.value; save(); vResults(); });
        bindReload();
    }
    function sheetRows() { return studentsOf(RS.paper.cls, RS.paper.section); }
    function calc(m) {
        m = String(m == null ? "" : m).trim();
        if (m === "") return { pct: "", grade: "", res: "—", cls: "" };
        if (isAbs(m)) return { pct: "", grade: "Abs", res: "Absent", cls: "warn" };
        if (!isNum(m) || +m < 0 || +m > RS.total) return { pct: "", grade: "", res: "Invalid", cls: "bad" };
        const pct = +m / RS.total * 100, ok = isPass(pct);
        return { pct: pct.toFixed(1) + "%", grade: gradeOf(pct).grade, res: ok ? "Pass" : "Fail", cls: ok ? "ok" : "bad" };
    }
    function vSheet(id) {
        const paper = db.papers.find(p => p.id === id);
        if (!paper) { location.hash = "#results"; return; }
        if (!RS || RS.paper.id !== id) {
            const ex = db.results[id];
            RS = { paper, total: ex ? ex.total : paper.total, marks: ex ? Object.assign({}, ex.marks) : {}, status: ex ? ex.status : "new", tab: "manual" };
        }
        RS.paper = paper;
        const ro = sheetRows(), locked = RS.status === "published";
        ROOT().innerHTML = head("file-arrow-up", esc(paper.title), esc(paper.term) + " · " + esc(clsLabel(paper.cls, paper.section)) + " · " + esc(paper.subj),
            '<a class="ex-btn ghost" href="#results"><i class="fas fa-list"></i> All papers</a><button class="ex-btn ghost" id="ru-tpl"><i class="fas fa-download"></i> CSV Template</button><button class="ex-btn ghost" id="ru-print"><i class="fas fa-print"></i> Print</button>' +
            (locked ? '<button class="ex-btn ghost" id="ru-unpub"><i class="fas fa-lock-open"></i> Unpublish</button>' : '<button class="ex-btn ghost" id="ru-draft"><i class="fas fa-floppy-disk"></i> Save Draft</button><button class="ex-btn" id="ru-pub"><i class="fas fa-paper-plane"></i> Publish</button>')) +
            dataBanner() +
            '<div class="ex-panel"><div class="ex-grid">' + field("Paper", '<input value="' + esc(paper.subj) + '" disabled>') + field("Class", '<input value="' + esc(clsLabel(paper.cls, paper.section)) + '" disabled>') +
            field("Maximum marks", '<input type="number" id="ru-total" min="1" value="' + RS.total + '"' + (locked ? " disabled" : "") + ">") + field("Status", '<div class="ex-statusbox"><span class="ex-chip ' + (locked ? "ok" : RS.status === "draft" ? "warn" : "info") + '">' + (locked ? "Published" : RS.status === "draft" ? "Draft" : "Not saved") + "</span></div>") + "</div>" +
            (locked ? '<p class="ex-note"><b>Published.</b> These results are final. Unpublish to edit.</p>' :
                '<div class="ex-seg" style="margin-top:14px"><button data-tab="manual" class="' + (RS.tab === "manual" ? "on" : "") + '"><i class="fas fa-keyboard"></i> Enter Manually</button><button data-tab="upload" class="' + (RS.tab === "upload" ? "on" : "") + '"><i class="fas fa-file-csv"></i> Import CSV</button></div>' +
                '<div id="ru-drop-wrap"' + (RS.tab === "upload" ? "" : " hidden") + '><div class="ex-drop" id="ru-drop"><i class="fas fa-cloud-arrow-up"></i><b>Drop a CSV file here or click to browse</b><small>Columns: roll_no (or reg_no), name, marks · use A or AB for absent · only students of this class are accepted</small><input type="file" id="ru-file" accept=".csv,text/csv" hidden></div></div>') + "</div>" +
            '<div class="ex-panel"><h3><i class="fas fa-table-list"></i> Marks Sheet <small>' + ro.length + " student" + (ro.length === 1 ? "" : "s") + '</small></h3><div id="ru-sum" class="ex-mini"></div>' +
            (ro.length ? '<div class="ex-tablewrap"><table class="ex-table"><thead><tr><th>#</th><th>Roll No</th><th>Reg No</th><th>Student</th><th>Father / Guardian</th><th>Marks</th><th>%</th><th>Grade</th><th>Result</th></tr></thead><tbody id="ru-body"></tbody></table></div>'
                : empty("user-slash", "No students in " + esc(clsLabel(paper.cls, paper.section)), "Add students in Student Management — they show up here automatically.")) + "</div>";
        bindReload();
        if (ro.length) { drawRows(ro, locked); sum(ro); }
        $$("[data-tab]").forEach(b => b.addEventListener("click", () => { RS.tab = b.dataset.tab; $$("[data-tab]").forEach(x => x.classList.toggle("on", x === b)); $("#ru-drop-wrap").hidden = RS.tab !== "upload"; }));
        const tot = $("#ru-total"); tot.addEventListener("input", () => { RS.total = +tot.value || 1; $$("#ru-body tr").forEach(refreshRow); sum(ro); });
        $("#ru-tpl").addEventListener("click", () => download("marks-" + paper.cls.replace(/\s+/g, "") + "-" + paper.subj.replace(/\s+/g, "") + ".csv", "roll_no,reg_no,name,marks\n" + ro.map(s => [s.roll, s.reg, s.name, RS.marks[s.reg] || ""].map(csvCell).join(",")).join("\n")));
        $("#ru-print").addEventListener("click", () => printSheet(ro));
        const drop = $("#ru-drop"), file = $("#ru-file");
        if (drop) {
            drop.addEventListener("click", () => file.click());
            file.addEventListener("change", () => readFile(file.files[0], ro));
            ["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
            ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
            drop.addEventListener("drop", e => readFile(e.dataTransfer.files[0], ro));
        }
        const d = $("#ru-draft"); if (d) d.addEventListener("click", () => persist("draft", ro));
        const p = $("#ru-pub"); if (p) p.addEventListener("click", () => publish(ro));
        const u = $("#ru-unpub"); if (u) u.addEventListener("click", () => { persist("draft", ro, true); vSheet(id); toast("Results unpublished."); });
    }
    function drawRows(ro, locked) {
        $("#ru-body").innerHTML = ro.map((s, i) => '<tr data-r="' + esc(s.reg) + '"><td>' + (i + 1) + "</td><td>" + esc(s.roll || "—") + "</td><td class='muted'>" + esc(s.reg) + "</td><td><b>" + esc(s.name) + "</b></td><td>" + esc(s.father || "—") +
            '</td><td><input class="ex-cell" data-m="' + esc(s.reg) + '" value="' + esc(RS.marks[s.reg] || "") + '"' + (locked ? " disabled" : "") + ' inputmode="decimal" autocomplete="off"></td><td data-c="pct"></td><td data-c="grade"></td><td data-c="res"></td></tr>').join("");
        $$("#ru-body tr").forEach(refreshRow);
        $$("[data-m]").forEach((inp, i, all) => {
            inp.addEventListener("input", () => { RS.marks[inp.dataset.m] = inp.value.trim(); refreshRow(inp.closest("tr")); sum(ro); });
            inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const n = all[i + 1]; if (n) { n.focus(); n.select(); } } });
        });
    }
    function refreshRow(tr) {
        const c = calc(RS.marks[tr.dataset.r]);
        tr.querySelector('[data-c="pct"]').textContent = c.pct;
        tr.querySelector('[data-c="grade"]').innerHTML = c.grade ? "<b>" + c.grade + "</b>" : "";
        tr.querySelector('[data-c="res"]').innerHTML = c.res === "—" ? "—" : '<span class="ex-chip ' + c.cls + '">' + c.res + "</span>";
        tr.querySelector("input").classList.toggle("err", c.res === "Invalid");
    }
    function sum(ro) {
        const vals = ro.map(s => RS.marks[s.reg]);
        const nums = vals.filter(m => calc(m).pct !== "").map(Number), abs = vals.filter(m => m != null && isAbs(m)).length, bad = vals.filter(m => calc(m).res === "Invalid").length;
        const pass = nums.filter(m => isPass(m / RS.total * 100)).length;
        $("#ru-sum").innerHTML = [["Entered", nums.length + abs + " / " + ro.length], ["Average", nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : "—"],
            ["Highest", nums.length ? Math.max.apply(null, nums) : "—"], ["Lowest", nums.length ? Math.min.apply(null, nums) : "—"], ["Pass rate", nums.length ? Math.round(pass / nums.length * 100) + "%" : "—"], ["Errors", bad]]
            .map(x => "<div><b" + (x[0] === "Errors" && bad ? ' style="color:#ef4444"' : "") + ">" + x[1] + "</b><span>" + x[0] + "</span></div>").join("");
    }
    function parseCSV(text) {
        const rows = []; let row = [], cell = "", q = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
            else if (c === '"') q = true;
            else if (c === "," || c === ";") { row.push(cell); cell = ""; }
            else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(x => x.trim() !== "")) rows.push(row.map(x => x.trim())); row = []; }
            else cell += c;
        }
        row.push(cell); if (row.some(x => x.trim() !== "")) rows.push(row.map(x => x.trim()));
        return rows;
    }
    function readFile(f, ro) {
        if (!f) return;
        if (!/\.csv$/i.test(f.name)) return toast("Please choose a .csv file.", 1);
        const rd = new FileReader();
        rd.onload = () => {
            const rows = parseCSV(String(rd.result).replace(/^﻿/, ""));
            if (!rows.length) return toast("The file is empty.", 1);
            const h = rows[0].map(x => x.toLowerCase().replace(/[^a-z]/g, ""));
            const hasHead = h.some(x => /^(roll|rollno|regno|reg|name|marks|mark)/.test(x)) && !rows[0].some((x, i) => i === rows[0].length - 1 && isNum(x));
            let ci = { roll: 0, reg: -1, marks: rows[0].length >= 3 ? 2 : 1 };
            if (hasHead) {
                const find = re => h.findIndex(x => re.test(x));
                ci = { roll: find(/^roll/), reg: find(/^reg/), marks: find(/^marks?$|^obtained|^score/) };
                if (ci.marks < 0) return toast("Could not find a 'marks' column in the header row.", 1);
                if (ci.roll < 0 && ci.reg < 0) return toast("Could not find a 'roll_no' or 'reg_no' column.", 1);
            }
            let ok = 0, miss = 0, bad = 0;
            rows.slice(hasHead ? 1 : 0).forEach(c => {
                const m = c[ci.marks]; if (m == null || m === "") return;
                const key = ((ci.reg >= 0 && c[ci.reg]) ? c[ci.reg] : c[ci.roll] || "").toLowerCase();
                const alt = (ci.roll >= 0 ? c[ci.roll] : "").toLowerCase();
                const s = ro.find(x => x.reg.toLowerCase() === key || (x.roll && x.roll.toLowerCase() === key) || (alt && x.roll && x.roll.toLowerCase() === alt));
                if (!s) { miss++; return; }
                if (!(isAbs(m) || (isNum(m) && +m >= 0 && +m <= RS.total))) { bad++; return; }
                RS.marks[s.reg] = isAbs(m) ? "A" : String(+m); ok++;
            });
            RS.tab = "manual"; vSheet(RS.paper.id);
            toast(ok + " marks imported" + (miss ? " · " + miss + " not in this class (skipped)" : "") + (bad ? " · " + bad + " invalid (skipped)" : "") + ".", ok === 0 || bad > 0);
        };
        rd.readAsText(f);
    }
    function persist(status, ro, quiet) {
        const marks = {}; ro.forEach(s => { const v = RS.marks[s.reg]; if (v != null && String(v).trim() !== "") marks[s.reg] = String(v).trim(); });
        db.results[RS.paper.id] = { total: RS.total, marks, status, at: Date.now() }; RS.status = status; save();
        pend("PUT", "/results/" + RS.paper.id, { total: RS.total, marks, status });
        if (!quiet) { toast("Draft saved."); vSheet(RS.paper.id); }
    }
    function publish(ro) {
        const vals = ro.map(s => RS.marks[s.reg]), bad = vals.filter(m => calc(m).res === "Invalid").length, entered = vals.filter(m => m != null && String(m).trim() !== "").length, blank = ro.length - entered;
        if (bad) return toast(bad + " row(s) have invalid marks (more than the maximum or not a number).", 1);
        if (!entered) return toast("Enter at least one mark before publishing.", 1);
        openModal("<h3>Publish results?</h3><p class='ex-modal-p'><b>" + esc(RS.paper.title) + "</b><br>" + entered + " of " + ro.length + " students have marks" + (blank ? "; <b>" + blank + " still blank</b>" : "") + ". Published results feed Report Cards and Result Analysis.</p><div class='row'><button class='ex-btn ghost' data-close>Cancel</button><button class='ex-btn' id='pub-ok'>Publish</button></div>", s => {
            $("#pub-ok", s).addEventListener("click", () => { persist("published", ro, true); closeModal(); vSheet(RS.paper.id); toast("Results published."); });
        });
    }
    function printSheet(ro) {
        const p = RS.paper;
        printDoc("Marks — " + p.title, '<div class="doc">' + docHead("Marks Sheet — " + esc(p.term)) + '<div class="meta"><span>Subject: ' + esc(p.subj) + "</span><span>Class: " + esc(clsLabel(p.cls, p.section)) + "</span><span>Max Marks: " + RS.total + "</span><span>Date: " + fmt(p.date) + "</span></div>" +
            '<table style="margin-top:12px"><thead><tr><th class="c">#</th><th>Roll No</th><th>Student</th><th>Father / Guardian</th><th class="c">Marks</th><th class="c">%</th><th class="c">Grade</th></tr></thead><tbody>' +
            ro.map((s, i) => { const m = RS.marks[s.reg], c = calc(m); return '<tr><td class="c">' + (i + 1) + "</td><td>" + esc(s.roll || "") + "</td><td>" + esc(s.name) + "</td><td>" + esc(s.father) + '</td><td class="c">' + (m == null || m === "" ? "" : esc(isAbs(m) ? "Abs" : m)) + '</td><td class="c">' + c.pct + '</td><td class="c">' + c.grade + "</td></tr>"; }).join("") +
            '</tbody></table><div style="display:flex;justify-content:space-between;margin-top:46px;font-weight:700;font-size:12.5px"><span style="border-top:1px solid #111;padding-top:3px;min-width:140px;text-align:center">Subject Teacher</span><span style="border-top:1px solid #111;padding-top:3px;min-width:140px;text-align:center">Principal</span></div></div>');
    }

    /* ============================================================
       DATE SHEET
       ============================================================ */
    function vDate() {
        ensurePrefs();
        const clash = d => db.datesheet.some(o => o.id !== d.id && o.cls === d.cls && o.date === d.date);
        const sorted = () => db.datesheet.slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
        ROOT().innerHTML = head("calendar-days", "Date <span>Sheet</span>", "Exam timetable for each class.",
            '<button class="ex-btn ghost" id="ds-print"><i class="fas fa-print"></i> Print</button><button class="ex-btn" id="ds-add"><i class="fas fa-plus"></i> Add Paper</button>') + dataBanner() + subjectList() +
            '<div class="ex-panel"><div class="ex-grid" style="max-width:560px;margin-bottom:14px">' + field("Class", '<select id="ds-f">' + opts(classNames(), db.prefs.dsf || "", "All classes") + "</select>") + field("Exam / Term", '<select id="ds-t">' + opts(TERMS, db.prefs.dst || "", "All terms") + "</select>") + '</div><div id="ds-body"></div></div>';
        const cur = () => sorted().filter(d => (!$("#ds-f").value || d.cls === $("#ds-f").value) && (!$("#ds-t").value || d.term === $("#ds-t").value));
        const draw = () => {
            const list = cur();
            $("#ds-body").innerHTML = list.length ? '<div class="ex-tablewrap"><table class="ex-table"><thead><tr><th>Date</th><th>Day</th><th>Class</th><th>Subject</th><th>Time</th><th>Room</th><th>Term</th><th></th></tr></thead><tbody>' +
                list.map(d => "<tr><td><b>" + fmt(d.date) + "</b></td><td>" + dow(d.date) + "</td><td>" + esc(d.cls) + "</td><td>" + esc(d.subject) + (clash(d) ? ' <span class="ex-chip warn">2 papers same day</span>' : "") + "</td><td>" + t12(d.start) + " – " + t12(d.end) + "</td><td>" + esc(d.room || "—") + "</td><td>" + esc(d.term) +
                    '</td><td class="ex-rowact"><button class="ex-icon-btn" data-e="' + d.id + '" title="Edit"><i class="fas fa-pen"></i></button><button class="ex-icon-btn del" data-d="' + d.id + '" title="Delete"><i class="fas fa-trash"></i></button></td></tr>').join("") + "</tbody></table></div>"
                : empty("calendar-plus", "No papers scheduled", "Press Add Paper to build the date sheet.");
            $$("[data-e]").forEach(b => b.addEventListener("click", () => dsForm(db.datesheet.find(x => x.id === b.dataset.e))));
            $$("[data-d]").forEach(b => b.addEventListener("click", () => confirmBox("Remove this paper?", "It will be removed from the date sheet.", "Remove", () => { db.datesheet = db.datesheet.filter(x => x.id !== b.dataset.d); save(); pend("DELETE", "/datesheet/" + b.dataset.d); vDate(); })));
        };
        draw();
        $("#ds-f").addEventListener("change", e => { db.prefs.dsf = e.target.value; save(); draw(); });
        $("#ds-t").addEventListener("change", e => { db.prefs.dst = e.target.value; save(); draw(); });
        $("#ds-add").addEventListener("click", () => dsForm());
        $("#ds-print").addEventListener("click", () => {
            const list = cur(); if (!list.length) return toast("Nothing to print — the date sheet is empty.", 1);
            const classes = Array.from(new Set(list.map(d => d.cls))).sort((a, b) => classNames().indexOf(a) - classNames().indexOf(b));
            const term = $("#ds-t").value;
            printDoc("Date Sheet", '<div class="doc">' + docHead("Date Sheet" + (term ? " — " + esc(term) : "")) + classes.map(c => '<h2 class="cls">' + esc(c) + '</h2><table><thead><tr><th>Date</th><th>Day</th><th>Subject</th><th>Time</th><th>Room</th></tr></thead><tbody>' +
                list.filter(d => d.cls === c).map(d => "<tr><td>" + fmt(d.date) + "</td><td>" + dow(d.date) + "</td><td>" + esc(d.subject) + "</td><td>" + t12(d.start) + " – " + t12(d.end) + "</td><td>" + esc(d.room || "") + "</td></tr>").join("") + "</tbody></table>").join("") +
                '<div style="display:flex;justify-content:flex-end;margin-top:46px;font-weight:700;font-size:12.5px"><span style="border-top:1px solid #111;padding-top:3px;min-width:150px;text-align:center">Principal</span></div></div>');
        });
    }
    function dsForm(d) {
        ensurePrefs();
        d = d || { term: db.prefs.term, date: iso(new Date()), cls: db.prefs.cls || "", subject: "", start: "09:00", end: "11:00", room: "" };
        openModal("<h3>" + (d.id ? "Edit" : "Add") + " Paper <button class='ex-icon-btn' data-close><i class='fas fa-xmark'></i></button></h3><div class='ex-grid'>" +
            field("Term", '<select id="f-term">' + opts(TERMS, d.term) + "</select>") + field("Class", classCtl('id="f-cls"', d.cls)) +
            field("Subject", '<input id="f-subj" list="ex-subjects" value="' + esc(d.subject) + '" placeholder="e.g. English">') + field("Date", '<input type="date" id="f-date" value="' + esc(d.date) + '">') +
            field("Start", '<input type="time" id="f-start" value="' + esc(d.start) + '">') + field("End", '<input type="time" id="f-end" value="' + esc(d.end) + '">') +
            field("Room / Hall", '<input id="f-room" value="' + esc(d.room) + '" placeholder="e.g. Hall 1">') + "</div><div class='row'><button class='ex-btn ghost' data-close>Cancel</button><button class='ex-btn' id='f-ok'>Save</button></div>", s => {
            $("#f-ok", s).addEventListener("click", () => {
                const v = { term: $("#f-term", s).value, cls: $("#f-cls", s).value, subject: $("#f-subj", s).value.trim(), date: $("#f-date", s).value, start: $("#f-start", s).value, end: $("#f-end", s).value, room: $("#f-room", s).value.trim() };
                if (!v.cls) return toast("Choose a class.", 1);
                if (!v.subject) return toast("Enter the subject.", 1);
                if (!v.date) return toast("Pick a date.", 1);
                if (!v.start || !v.end || v.end <= v.start) return toast("End time must be after the start time.", 1);
                let entry = d;
                if (d.id) Object.assign(d, v); else { entry = Object.assign({ id: uid() }, v); db.datesheet.push(entry); }
                save(); pend("PUT", "/datesheet/" + entry.id, entry); closeModal(); vDate(); toast("Date sheet updated.");
            });
        });
    }

    /* ============================================================
       REPORT CARDS — built from uploaded marks of the real class
       ============================================================ */
    let CARD = { reg: "", all: false };
    function termData(term, cls) {
        const by = {};
        db.papers.filter(p => p.term === term && p.cls === cls && db.results[p.id]).forEach(p => {
            const r = db.results[p.id], k = p.subj.toLowerCase(), cur = by[k];
            if (!cur || r.at > cur.r.at) by[k] = { p, r };
        });
        return Object.keys(by).map(k => by[k]).sort((a, b) => a.p.subj.localeCompare(b.p.subj));
    }
    function cardOf(s, data) {
        const subs = []; let got = 0, out = 0;
        data.forEach(({ p, r }) => {
            const m = r.marks[s.reg]; if (m == null || m === "") return;
            if (isAbs(m)) { subs.push({ s: p.subj, total: r.total, abs: true }); return; }
            const mk = +m, pct = mk / r.total * 100; got += mk; out += r.total;
            subs.push({ s: p.subj, m: mk, total: r.total, pct, g: gradeOf(pct).grade });
        });
        const pct = out ? got / out * 100 : 0;
        return { subs, got, out, pct, g: gradeOf(pct), failed: subs.some(x => x.abs || !isPass(x.pct)) };
    }
    function cardHtml(s, data, ranks, count) {
        const d = cardOf(s, data), pos = ranks[s.reg];
        return '<div class="doc-rc pg-break">' + docHead("Result Card — " + esc(db.prefs.term) + " " + new Date().getFullYear()) +
            "<dl><dt>Name</dt><dd>" + esc(s.name) + "</dd><dt>Roll No</dt><dd>" + esc(s.roll || "—") + "</dd><dt>Father</dt><dd>" + esc(s.father || "—") + "</dd><dt>Reg No</dt><dd>" + esc(s.reg) + "</dd><dt>Class</dt><dd>" + esc(clsLabel(s.cls, s.section)) + "</dd><dt>Position</dt><dd>" + (pos ? pos + " of " + count : "—") + "</dd></dl>" +
            '<table><thead><tr><th>Subject</th><th>Total</th><th>Obtained</th><th>%</th><th>Grade</th></tr></thead><tbody>' +
            d.subs.map(x => "<tr><td>" + esc(x.s) + "</td><td>" + x.total + "</td><td>" + (x.abs ? "Abs" : x.m) + "</td><td>" + (x.abs ? "—" : x.pct.toFixed(1)) + "</td><td>" + (x.abs ? "—" : x.g) + "</td></tr>").join("") +
            '</tbody></table><div class="sum"><span>Total: ' + d.got + " / " + d.out + "</span><span>Percentage: " + d.pct.toFixed(1) + "%</span><span>Grade: " + d.g.grade + "</span><span>Result: " + (d.failed ? "FAIL" : "PASS") + "</span></div><div>Remarks: <b>" + esc(d.g.remark) + '</b></div><div class="sig"><span>Class Teacher</span><span>Parent</span><span>Principal</span></div></div>';
    }
    function rankMap(ro, data) {
        const scored = ro.map(s => { const d = cardOf(s, data); return { reg: s.reg, pct: d.pct, has: d.out > 0 }; }).filter(x => x.has).sort((a, b) => b.pct - a.pct);
        const m = {}; scored.forEach((x, i) => { m[x.reg] = i && Math.abs(scored[i - 1].pct - x.pct) < 1e-9 ? m[scored[i - 1].reg] : i + 1; });
        return { map: m, count: scored.length };
    }
    function vCards() {
        ensurePrefs();
        const ro = studentsOf(db.prefs.cls), data = termData(db.prefs.term, db.prefs.cls);
        if (!ro.some(s => s.reg === CARD.reg)) CARD.reg = ro[0] ? ro[0].reg : "";
        const st = ro.find(s => s.reg === CARD.reg), rk = rankMap(ro, data);
        const any = data.length > 0, marked = ro.filter(s => cardOf(s, data).subs.length);
        const chips = data.map(({ p, r }) => '<span class="ex-chip ' + (r.status === "published" ? "ok" : "warn") + '">' + esc(p.subj) + (r.status === "published" ? "" : " · draft") + "</span>").join(" ");
        ROOT().innerHTML = head("award", "Report <span>Cards</span>", "Built automatically from uploaded results.", '<button class="ex-btn ghost" id="rc-all"><i class="fas fa-layer-group"></i> ' + (CARD.all ? "Single view" : "All students (" + marked.length + ")") + '</button><button class="ex-btn" id="rc-print"' + (any && marked.length ? "" : " disabled") + '><i class="fas fa-print"></i> Print ' + (CARD.all ? "all" : "card") + "</button>") + dataBanner() +
            '<div class="ex-panel">' + termClassBar(CARD.all ? "" : field("Student", '<select id="rc-st">' + ro.map(s => '<option value="' + esc(s.reg) + '"' + (s.reg === CARD.reg ? " selected" : "") + ">" + esc((s.roll ? s.roll + " — " : "") + s.name) + "</option>").join("") + "</select>")) +
            (any ? '<p class="ex-note" style="margin-top:12px"><b>Subjects included:</b> ' + chips + "</p>" : "") + "</div>" +
            (!ro.length ? '<div class="ex-panel">' + empty("user-slash", "No students in this class", "Add students in Student Management.") + "</div>" :
                !any ? '<div class="ex-panel">' + empty("file-circle-question", "No results uploaded yet", "Upload marks in " + link("#results", "Result Upload") + " for " + esc(db.prefs.cls) + " · " + esc(db.prefs.term) + ".") + "</div>" :
                    '<div class="ex-cards doc">' + (CARD.all ? marked.map(s => cardHtml(s, data, rk.map, rk.count)).join("") : (st ? cardHtml(st, data, rk.map, rk.count) : "")) + "</div>");
        bindPrefs(ROOT(), vCards); bindReload();
        const s = $("#rc-st"); if (s) s.addEventListener("change", e => { CARD.reg = e.target.value; vCards(); });
        $("#rc-all").addEventListener("click", () => { CARD.all = !CARD.all; vCards(); });
        $("#rc-print").addEventListener("click", () => {
            const list = CARD.all ? marked : (st ? [st] : []);
            printDoc("Report Cards — " + db.prefs.cls, '<div class="doc">' + list.map(x => cardHtml(x, data, rk.map, rk.count)).join("") + "</div>");
        });
    }

    /* ============================================================
       RESULT ANALYSIS
       ============================================================ */
    function vAnalysis() {
        ensurePrefs();
        const data = termData(db.prefs.term, db.prefs.cls), ro = studentsOf(db.prefs.cls), per = [], stu = {}, dist = {};
        SCALE.forEach(g => { dist[g.grade] = 0; });
        data.forEach(({ p, r }) => {
            const ms = ro.filter(s => r.marks[s.reg] != null && isNum(r.marks[s.reg]) && +r.marks[s.reg] <= r.total).map(s => ({ reg: s.reg, name: s.name, m: +r.marks[s.reg] }));
            if (!ms.length) return;
            const avg = ms.reduce((a, b) => a + b.m, 0) / ms.length / r.total * 100, pass = ms.filter(x => isPass(x.m / r.total * 100)).length;
            per.push({ s: p.subj, avg, pass: Math.round(pass / ms.length * 100) });
            ms.forEach(x => { const pc = x.m / r.total * 100; dist[gradeOf(pc).grade]++; const o = stu[x.reg] || (stu[x.reg] = { name: x.name, got: 0, out: 0, fails: [] }); o.got += x.m; o.out += r.total; if (!isPass(pc)) o.fails.push(p.subj); });
        });
        const list = Object.values(stu).map(o => Object.assign(o, { pct: o.got / o.out * 100 })).sort((a, b) => b.pct - a.pct);
        const needs = list.filter(o => o.fails.length).sort((a, b) => b.fails.length - a.fails.length).slice(0, 6);
        const maxD = Math.max.apply(null, Object.values(dist).concat([1])), overall = per.length ? per.reduce((a, b) => a + b.avg, 0) / per.length : 0;
        ROOT().innerHTML = head("chart-column", "Result <span>Analysis</span>", "How the class performed, subject by subject.") + dataBanner() + '<div class="ex-panel">' + termClassBar() + "</div>" +
            (!per.length ? '<div class="ex-panel">' + empty("chart-simple", "Nothing to analyse yet", "Upload results for " + esc(db.prefs.cls) + " · " + esc(db.prefs.term) + " in " + link("#results", "Result Upload") + " first.") + "</div>" :
                '<section class="quick-stats-strip">' + stat("icon-students", "book", per.length, "Subjects Uploaded") + stat("icon-staff", "users", list.length, "Students Marked") + stat("icon-present-students", "percent", overall.toFixed(1) + "%", "Class Average") + stat("icon-present-staff", "triangle-exclamation", needs.length, "Need Attention") + "</section>" +
                '<div class="ex-two"><div class="ex-panel"><h3><i class="fas fa-book-open"></i> Subject Averages</h3><div class="ex-bars">' + per.map(p => '<div class="ex-bar"><span class="lbl">' + esc(p.s) + '</span><div class="trk"><div class="fil ' + (p.avg < 50 ? "low" : p.avg < 65 ? "mid" : "") + '" style="width:' + p.avg.toFixed(0) + '%"></div></div><span class="val">' + p.avg.toFixed(0) + "%</span></div>").join("") + "</div></div>" +
                '<div class="ex-panel"><h3><i class="fas fa-chart-simple"></i> Grade Distribution</h3><div class="ex-cols">' + Object.keys(dist).map(g => '<div class="ex-colbar"><b>' + dist[g] + '</b><i style="height:' + Math.round(dist[g] / maxD * 100) + '%"></i>' + g + "</div>").join("") + "</div></div></div>" +
                '<div class="ex-two"><div class="ex-panel"><h3><i class="fas fa-trophy"></i> Top Performers</h3><div class="ex-tablewrap"><table class="ex-table" style="min-width:0"><tbody>' + list.slice(0, 5).map((o, i) => "<tr><td><b>" + (i + 1) + "</b></td><td>" + esc(o.name) + "</td><td style='text-align:right'><span class='ex-chip ok'>" + o.pct.toFixed(1) + "%</span></td></tr>").join("") + "</tbody></table></div></div>" +
                '<div class="ex-panel"><h3><i class="fas fa-triangle-exclamation"></i> Needs Attention</h3>' + (needs.length ? '<div class="ex-tablewrap"><table class="ex-table" style="min-width:0"><tbody>' + needs.map(o => "<tr><td>" + esc(o.name) + "</td><td class='muted'>" + esc(o.fails.join(", ")) + "</td><td style='text-align:right'><span class='ex-chip bad'>" + o.fails.length + " failed</span></td></tr>").join("") + "</tbody></table></div>" : empty("circle-check", "No failures", "Every student cleared the pass mark.")) + "</div></div>");
        bindPrefs(ROOT(), vAnalysis); bindReload();
    }


    /* ============================================================
       GRADING SCHEME  (grade scale with a Pass/Fail setting per grade, saved in db.grading)
       ============================================================ */
    let GS = null;   // working copy while the page is open
    const cleanNum = v => { const n = +v; return Math.round(n * 100) / 100; };
    function gsRows(scale) {   // numeric rows, highest first (for ranges / the live test)
        return scale.filter(r => String(r.min).trim() !== "" && isFinite(r.min)).map(r => ({ min: +r.min, grade: String(r.grade).trim(), remark: String(r.remark || "").trim(), pass: r.pass !== false })).sort((a, b) => b.min - a.min);
    }
    function gsRange(i) {
        const m = GS.scale[i].min;
        if (String(m).trim() === "" || !isFinite(m)) return "—";
        const higher = GS.scale.filter(r => String(r.min).trim() !== "" && isFinite(r.min) && +r.min > +m).map(r => +r.min).sort((a, b) => a - b)[0];
        return cleanNum(m) + "%" + (higher == null ? " and above" : " to under " + cleanNum(higher) + "%");
    }
    function gsValidate() {
        if (!GS.scale.length) return "Add at least one grade.";
        const g = {}, m = {};
        for (const r of GS.scale) {
            const name = String(r.grade).trim(), min = String(r.min).trim();
            if (!name) return "Every row needs a grade name.";
            if (min === "" || !isFinite(min) || +min < 0 || +min > 100) return "Grade " + name + ": 'From %' must be a number between 0 and 100.";
            if (g[name.toLowerCase()]) return "The grade " + name + " is used twice.";
            if (m[+min]) return "Two grades start at " + (+min) + "%. Each grade needs its own starting percentage.";
            g[name.toLowerCase()] = 1; m[+min] = 1;
        }
        if (!m[0]) return "One grade must start at 0% so every mark gets a grade (normally the fail grade).";
        if (!GS.scale.some(r => r.pass !== false)) return "Mark at least one grade as Pass.";
        return "";
    }
    function gsRefresh() {
        $$("[data-rng]").forEach(td => { td.textContent = gsRange(+td.dataset.rng); });
        $$('[data-gs="pass"]').forEach(s => { s.className = "ex-cell ex-gs-res " + (GS.scale[+s.dataset.i].pass !== false ? "ok" : "bad"); });
        const rows = gsRows(GS.scale), names = p => rows.filter(r => r.pass === p).map(r => esc(r.grade || "?")).join(", ") || "none";
        const sum = $("#gs-sum"); if (sum) sum.innerHTML = '<div><span class="ex-chip ok">Pass</span> ' + names(true) + '</div><div><span class="ex-chip bad">Fail</span> ' + names(false) + "</div>";
        const out = $("#gs-test-out"), v = $("#gs-test").value.trim();
        if (!out) return;
        if (v === "" || !isFinite(v) || +v < 0 || +v > 100 || !rows.length) { out.innerHTML = '<span class="muted">Enter a percentage to preview</span>'; return; }
        const hit = rows.find(r => +v >= r.min) || rows[rows.length - 1];
        out.innerHTML = "<b>" + esc(hit.grade || "—") + "</b><span>" + esc(hit.remark) + '</span><span class="ex-chip ' + (hit.pass ? "ok" : "bad") + '">' + (hit.pass ? "Pass" : "Fail") + "</span>";
    }
    function vGrading() {
        GS = { scale: SCALE.map(g => Object.assign({}, g)) };
        drawGrading();
    }
    function drawGrading() {
        const rows = GS.scale.map((r, i) => "<tr><td>" +
            '<input class="ex-cell ex-gs-grade" data-gs="grade" data-i="' + i + '" value="' + esc(r.grade) + '" maxlength="4" autocomplete="off"></td><td>' +
            '<input class="ex-cell ex-gs-min" data-gs="min" data-i="' + i + '" value="' + esc(r.min) + '" inputmode="decimal" autocomplete="off"><span class="ex-gs-pct">%</span></td>' +
            '<td class="muted" data-rng="' + i + '"></td><td><select class="ex-cell ex-gs-res" data-gs="pass" data-i="' + i + '"><option value="pass"' + (r.pass !== false ? " selected" : "") + '>Pass</option><option value="fail"' + (r.pass === false ? " selected" : "") + '>Fail</option></select></td><td><input class="ex-cell ex-gs-remark" data-gs="remark" data-i="' + i + '" value="' + esc(r.remark) + '" maxlength="40" autocomplete="off"></td>' +
            '<td class="ex-rowact"><button class="ex-icon-btn del" type="button" data-gs-del="' + i + '" title="Remove grade"><i class="fas fa-trash"></i></button></td></tr>').join("");
        ROOT().innerHTML = head("ranking-star", "Grading <span>Scheme</span>", "Set the grades and whether each one is a Pass or a Fail.",
            '<button class="ex-btn ghost" id="gs-reset"><i class="fas fa-rotate-left"></i> Reset to default</button><button class="ex-btn" id="gs-save"><i class="fas fa-floppy-disk"></i> Save scheme</button>') +
            '<div class="ex-two"><div class="ex-panel"><h3><i class="fas fa-circle-check"></i> Pass / Fail summary</h3><div class="ex-gs-sum" id="gs-sum"></div>' +
            '<p class="ex-note">Choose <b>Pass</b> or <b>Fail</b> for each grade below. A student whose mark falls in a Fail grade is marked <b>Fail</b> on marks sheets, report cards and analysis.</p></div>' +
            '<div class="ex-panel"><h3><i class="fas fa-vial"></i> Try a percentage</h3>' +
            field("Percentage", '<input id="gs-test" inputmode="decimal" autocomplete="off" placeholder="e.g. 76">', "") +
            '<div class="ex-gs-result" id="gs-test-out"></div></div></div>' +
            '<div class="ex-panel"><h3><i class="fas fa-list-ol"></i> Grade scale <small>highest grade first</small></h3>' +
            '<div class="ex-tablewrap"><table class="ex-table"><thead><tr><th>Grade</th><th>From</th><th>Range</th><th>Result</th><th>Remark on report card</th><th></th></tr></thead><tbody id="gs-body">' + rows + "</tbody></table></div>" +
            '<div class="ex-gs-foot"><button class="ex-btn ghost sm" id="gs-add"><i class="fas fa-plus"></i> Add grade</button><span class="ex-note" style="margin:0">One grade must start at <b>0%</b>. Changes apply to all saved marks as soon as you save — no marks are altered.</span></div></div>';
        $$("[data-gs]").forEach(inp => inp.addEventListener("input", () => { GS.scale[+inp.dataset.i][inp.dataset.gs] = inp.dataset.gs === "pass" ? inp.value === "pass" : inp.value; gsRefresh(); }));
        $$("[data-gs-del]").forEach(b => b.addEventListener("click", () => {
            if (GS.scale.length <= 1) { toast("Keep at least one grade.", true); return; }
            GS.scale.splice(+b.dataset.gsDel, 1); drawGrading();
        }));
        $("#gs-test").addEventListener("input", gsRefresh);
        $("#gs-add").addEventListener("click", () => { GS.scale.push({ min: "", grade: "", remark: "", pass: true }); drawGrading(); const l = $$("[data-gs=grade]"); if (l.length) l[l.length - 1].focus(); });
        $("#gs-save").addEventListener("click", () => {
            const err = gsValidate(); if (err) { toast(err, true); return; }
            db.grading = { scale: GS.scale.map(r => ({ min: +r.min, grade: String(r.grade).trim(), remark: String(r.remark || "").trim(), pass: r.pass !== false })).sort((a, b) => b.min - a.min) };
            applyGrading(); save(); pend("PUT", "/grading", db.grading); toast("Grading scheme saved"); vGrading();
        });
        $("#gs-reset").addEventListener("click", () => confirmBox("Reset grading scheme?", "The grade scale goes back to the default (A+ to F, with only F as a Fail). Saved marks are not changed.", "Reset", () => {
            delete db.grading; applyGrading(); save(); pend("DELETE", "/grading"); toast("Grading scheme reset to default"); vGrading();
        }));
        gsRefresh();
    }

    /* ============================================================
       ROUTER + PAGE CHROME
       ============================================================ */
    const views = { hub: vHub, paper: vPaper, results: vResults, datesheet: vDate, cards: vCards, analysis: vAnalysis, grading: vGrading };
    function route() {
        const parts = (location.hash || "#hub").slice(1).split("/");
        freshRoot();
        if (LIVE.loading) { ROOT().innerHTML = '<div class="ex-panel">' + empty("spinner fa-spin", "Loading classes and students…", "Fetching live data from your school account.") + "</div>"; return; }
        (views[parts[0]] || vHub)(parts[1]); window.scrollTo(0, 0);
    }
    function chrome() {
        const sb = $("#sidebar"), ov = $("#sidebar-overlay"), close = () => { sb.classList.remove("active"); ov.classList.remove("active"); };
        $("#open-sidebar").addEventListener("click", () => { sb.classList.add("active"); ov.classList.add("active"); });
        $("#close-sidebar").addEventListener("click", close); ov.addEventListener("click", close);
        $("#nav-search").addEventListener("input", e => { const q = e.target.value.trim().toLowerCase(); $$(".sidebar-nav .nav-link").forEach(l => { l.style.display = l.textContent.toLowerCase().indexOf(q) >= 0 ? "flex" : "none"; }); });
        $("#theme-toggle").addEventListener("click", () => { const r = document.documentElement, n = r.getAttribute("data-theme") === "dark" ? "light" : "dark"; r.setAttribute("data-theme", n); try { localStorage.setItem("eduflow-theme", n); } catch (e) { /* ignore */ } });
        $("#header-date").textContent = new Date().toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
        if (school.name) $("#school-name").textContent = String(school.name).toUpperCase();
        $("#logout-link").addEventListener("click", () => {
            try { if (window.SoftSchoolAdmin && window.SoftSchoolAdmin.clearSession) window.SoftSchoolAdmin.clearSession(); } catch (e) { /* ignore */ }
            try { localStorage.removeItem("softschool_session"); localStorage.removeItem("softschool_remember"); } catch (e) { /* ignore */ }
        });
        $("#ex-modal").addEventListener("click", e => { if (e.target.id === "ex-modal") closeModal(); });
        document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
    }
    window.addEventListener("beforeunload", save);
    chrome(); window.addEventListener("hashchange", route); route();
    Promise.all([
        loadLive().catch(e => { LIVE.loading = false; LIVE.error = "Could not load live data (" + e.message + ")."; }),
        loadServer().catch(() => { toast("Could not reach the exam server - showing the copy saved on this device.", true); })
    ]).then(route);

    /* ------------------------------------------------------------
       BACKEND: ExamController (/api/exams)
         GET    /bootstrap                      papers + results + date sheet + grading in one call
         PUT    /papers/{id}   DELETE /papers/{id}
         PUT    /results/{paperId}              { total, marks:{regNo:mark|"A"}, status:"draft"|"published" }
         PUT    /datesheet/{id}   DELETE /datesheet/{id}
         PUT    /grading          DELETE /grading
         POST   /import                         one-time upload of this browser's older local data
       ------------------------------------------------------------ */
})();
