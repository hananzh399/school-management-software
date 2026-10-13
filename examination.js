/* ============================================================
   EXAMINATION MODULE — FRONTEND ONLY
   Everything is stored in localStorage under "ex_data_v1" so the UI is fully
   clickable today. Each `db.*` collection maps 1:1 to a future REST resource
   (see the "BACKEND HOOKS" note at the bottom) — swap load()/save() for API
   calls when the backend is ready; the views do not need to change.
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
    const opts = (list, val) => list.map(x => '<option' + (x === val ? " selected" : "") + ">" + esc(x) + "</option>").join("");
    const field = (label, ctl) => '<div class="ex-f"><label>' + label + "</label>" + ctl + "</div>";
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

    /* ───────── constants ───────── */
    const KEY = "ex_data_v1";
    const TERMS = ["Monthly Test", "First Term", "Mid Term", "Final Term"];
    const CLASSES = ["Play Group", "Nursery", "Prep", "Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6", "Class 7", "Class 8", "Class 9", "Class 10"];
    const SUBJECTS = ["English", "Urdu", "Mathematics", "Science", "Islamiyat", "Social Studies", "Computer", "Pak Studies"];
    const QTYPES = ["MCQs", "True / False", "Fill in the Blanks", "Short Questions", "Long Questions"];
    const DIFFS = ["Easy", "Medium", "Hard"];
    const DEF_SCALE = [
        { min: 90, grade: "A+", gpa: "4.0", remark: "Outstanding" },
        { min: 80, grade: "A", gpa: "3.7", remark: "Excellent" },
        { min: 70, grade: "B", gpa: "3.0", remark: "Very Good" },
        { min: 60, grade: "C", gpa: "2.5", remark: "Good" },
        { min: 50, grade: "D", gpa: "2.0", remark: "Satisfactory" },
        { min: 40, grade: "E", gpa: "1.0", remark: "Needs Improvement" },
        { min: 0, grade: "F", gpa: "0.0", remark: "Fail" }
    ];
    const DEMO_NAMES = ["Ahmed Raza", "Fatima Noor", "Hamza Ali", "Ayesha Siddiqui", "Usman Khan", "Zainab Malik", "Bilal Hussain", "Maryam Iqbal", "Hassan Tariq", "Sana Yousaf", "Talha Mehmood", "Hira Anwar"];

    /* ───────── school (name comes from the logged-in session, same as other pages) ───────── */
    let school = { name: "SOFTSCHOOL" };
    try { const s = JSON.parse(localStorage.getItem("softschool_session") || "null"); if (s && s.school && s.school.name) school = s.school; } catch (e) { /* ignore */ }

    /* ───────── storage ───────── */
    function seed() {
        const t = new Date(), day = n => { const d = new Date(t); d.setDate(d.getDate() + n); return iso(d); };
        const bank = [
            ["Mathematics", "MCQs", "Easy", "What is the value of 7 × 8?", ["48", "54", "56", "64"]],
            ["Mathematics", "MCQs", "Medium", "Which of these is a prime number?", ["21", "27", "29", "33"]],
            ["Mathematics", "Short Questions", "Easy", "Define a fraction and give two examples."],
            ["Mathematics", "Long Questions", "Hard", "Solve: 3x + 7 = 28 and verify your answer. Show all steps."],
            ["Science", "MCQs", "Easy", "Which gas do plants absorb during photosynthesis?", ["Oxygen", "Carbon dioxide", "Nitrogen", "Hydrogen"]],
            ["Science", "True / False", "Easy", "Sound can travel through a vacuum."],
            ["Science", "Short Questions", "Medium", "Differentiate between a solid and a liquid."],
            ["English", "Fill in the Blanks", "Easy", "She ____ (go) to school every day."],
            ["English", "Short Questions", "Medium", "Write the plural of: child, mouse, leaf."],
            ["English", "Long Questions", "Medium", "Write a paragraph on 'My Favourite Teacher' (80–100 words)."]
        ].map(b => ({ id: uid(), subject: b[0], cls: "All", type: b[1], diff: b[2], text: b[3], opts: b[4] || [] }));
        const ds = (n, cls, subj, time, room) => ({ id: uid(), term: "Mid Term", date: day(n), cls, subject: subj, time, room });
        return {
            papers: [], results: {}, bank, duties: {}, log: [],
            grades: { pass: 40, scale: JSON.parse(JSON.stringify(DEF_SCALE)) },
            prefs: { term: "Mid Term", cls: "Class 5" },
            datesheet: [
                ds(3, "Class 5", "English", "09:00 – 11:00", "Room 5A"), ds(4, "Class 5", "Mathematics", "09:00 – 11:00", "Room 5A"),
                ds(5, "Class 5", "Science", "09:00 – 11:00", "Room 5A"), ds(6, "Class 5", "Urdu", "09:00 – 11:00", "Room 5A"),
                ds(3, "Class 8", "Mathematics", "09:00 – 11:30", "Hall 1"), ds(4, "Class 8", "Science", "09:00 – 11:30", "Hall 1")
            ]
        };
    }
    function load() { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.grades) return d; } catch (e) { /* ignore */ } return seed(); }
    let db = load();
    function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } }
    function logAct(icon, text) { db.log.unshift({ icon, text, at: Date.now() }); db.log = db.log.slice(0, 15); save(); }

    /* ───────── data helpers ───────── */
    function roster(cls) {
        try {
            const all = JSON.parse(localStorage.getItem("edu_students") || "[]");
            const list = all.filter(s => s && s.studentClass === cls && !s.archived).map(s => ({ roll: String(s.regNo || ""), name: s.fullName || "", father: s.guardianName || s.fatherName || "" }));
            if (list.length) return list.sort((a, b) => a.roll.localeCompare(b.roll, undefined, { numeric: true }));
        } catch (e) { /* ignore */ }
        const p = String(CLASSES.indexOf(cls) + 1).padStart(2, "0");
        return DEMO_NAMES.map((n, i) => ({ roll: p + String(i + 1).padStart(3, "0"), name: n, father: "", demo: true }));
    }
    function staffList() {
        try {
            const g = JSON.parse(localStorage.getItem("eduflow-db") || "{}"), t = (g.staff && g.staff.Teaching) || [];
            const n = t.map(x => x && (x.name || x.fullName)).filter(Boolean);
            if (n.length) return n;
        } catch (e) { /* ignore */ }
        return ["Ms. Ayesha Khan", "Mr. Bilal Ahmed", "Ms. Sana Iqbal", "Mr. Usman Tariq", "Ms. Hira Malik"];
    }
    function gradeOf(pct) {
        const s = db.grades.scale.slice().sort((a, b) => b.min - a.min);
        for (let i = 0; i < s.length; i++) if (pct >= s[i].min) return s[i];
        return s[s.length - 1] || { grade: "—", remark: "" };
    }
    const rk = (term, cls, subj) => term + "|" + cls + "|" + subj;
    const isAbs = m => /^a(b)?$/i.test(String(m).trim());
    const isNum = m => m !== "" && m != null && isFinite(m);
    function toast(msg, err) {
        const t = $("#ex-toast"); t.textContent = msg; t.className = "ex-toast" + (err ? " err" : ""); t.hidden = false;
        clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
    }
    function openModal(html, bind) {
        $("#ex-sheet").innerHTML = html; $("#ex-modal").hidden = false;
        $$("[data-close]", $("#ex-sheet")).forEach(b => b.addEventListener("click", closeModal));
        if (bind) bind($("#ex-sheet"));
    }
    function closeModal() { $("#ex-modal").hidden = true; }
    function download(name, text, mime) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: mime || "text/csv" })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    }
    const ROOT = () => $("#ex-root");
    function freshRoot() { const old = ROOT(), n = old.cloneNode(false); old.parentNode.replaceChild(n, old); return n; }
    function head(icon, title, sub, actions) {
        return '<div class="ex-title ex-noprint"><div><h2><i class="fas fa-' + icon + '"></i> ' + title + "</h2><p>" + sub + '</p></div><div class="ex-actions"><a class="ex-back" href="#hub"><i class="fas fa-arrow-left"></i> Examination</a>' + (actions || "") + "</div></div>";
    }
    function termClassBar(extra) {
        return '<div class="ex-grid">' + field("Exam / Term", '<select data-pref="term">' + opts(TERMS, db.prefs.term) + "</select>") +
            field("Class", '<select data-pref="cls">' + opts(CLASSES, db.prefs.cls) + "</select>") + (extra || "") + "</div>";
    }
    function bindPrefs(root, cb) {
        $$("[data-pref]", root).forEach(s => s.addEventListener("change", () => { db.prefs[s.dataset.pref] = s.value; save(); cb(); }));
    }
    const empty = (icon, t, s) => '<div class="ex-empty"><i class="fas fa-' + icon + '"></i><b>' + t + "</b>" + (s || "") + "</div>";

    /* ============================================================
       HUB
       ============================================================ */
    function vHub() {
        const today = iso(new Date());
        const up = db.datesheet.filter(d => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
        const pending = SUBJECTS.filter(s => !db.results[rk(db.prefs.term, db.prefs.cls, s)]).length;
        let pass = 0, tot = 0;
        Object.values(db.results).forEach(r => r.rows.forEach(x => { if (isNum(x.marks)) { tot++; if (x.marks / r.total * 100 >= db.grades.pass) pass++; } }));
        const published = Object.values(db.results).filter(r => r.status === "published").length;
        const unassigned = up.filter(d => !db.duties[d.id]).length;
        const tiles = [
            ["paper", "file-pen", "#3b82f6", "Paper Generation", "Build a question paper from your question bank — sections, marks, time — then print it.", db.papers.length + " saved", ""],
            ["results", "file-arrow-up", "#10b981", "Result Upload", "Upload marks by CSV or enter them by hand, check for errors and publish to parents.", pending + " pending", pending ? "warn" : "ok"],
            ["datesheet", "calendar-days", "#8b5cf6", "Date Sheet", "Plan the exam timetable for every class — dates, timings and rooms.", up.length + " upcoming", "info"],
            ["slips", "id-card", "#f59e0b", "Roll Number Slips", "Print admit slips for a whole class with the date sheet on each one.", "Print", ""],
            ["cards", "award", "#17716A", "Report Cards", "Generate result cards with grades, percentage, position and remarks.", published + " published", ""],
            ["analysis", "chart-column", "#ec4899", "Result Analysis", "Subject averages, grade distribution, toppers and students needing attention.", tot ? Math.round(pass / tot * 100) + "% pass" : "No data", ""],
            ["bank", "database", "#06b6d4", "Question Bank", "Store reusable questions by subject, class, type and difficulty.", db.bank.length + " questions", ""],
            ["duty", "user-shield", "#ef4444", "Invigilation Duty", "Assign teachers to each paper and print the duty roster.", unassigned + " unassigned", unassigned ? "warn" : "ok"],
            ["grades", "ranking-star", "#a855f7", "Grading Scheme", "Set pass marks and the percentage → grade table used everywhere.", "Pass " + db.grades.pass + "%", ""]
        ];
        ROOT().innerHTML =
            '<div class="ex-title"><div><h2><i class="fas fa-file-signature"></i> Examination <span>&amp; Results</span></h2><p>Papers, results and report cards in one place.</p></div></div>' +
            '<section class="quick-stats-strip">' +
            stat("icon-students", "calendar-check", up.length, "Upcoming Papers") +
            stat("icon-staff", "file-pen", db.papers.length, "Papers Generated") +
            stat("icon-present-staff", "hourglass-half", pending, "Results Pending (" + esc(db.prefs.cls) + ")") +
            stat("icon-present-students", "percent", tot ? Math.round(pass / tot * 100) + "%" : "—", "Overall Pass Rate") + "</section>" +
            '<section class="ex-tiles">' + tiles.map((t, i) =>
                '<button class="ex-tile" type="button" data-go="' + t[0] + '" style="--tc:' + t[2] + ";animation-delay:" + (0.04 * i).toFixed(2) + 's">' +
                '<div class="ex-tile-top"><div class="ex-tile-ic"><i class="fas fa-' + t[1] + '"></i></div><span class="ex-chip ' + t[6] + '">' + t[5] + "</span></div>" +
                "<h3>" + t[3] + "</h3><p>" + t[4] + '</p><div class="ex-tile-foot"><span>Open</span><i class="fas fa-arrow-right"></i></div></button>').join("") + "</section>" +
            '<section class="ex-two">' +
            '<div class="ex-panel"><h3><i class="fas fa-calendar-days"></i> Upcoming Papers</h3>' + (up.length ?
                '<div class="ex-tablewrap"><table class="ex-table"><thead><tr><th>Date</th><th>Class</th><th>Subject</th><th>Time</th></tr></thead><tbody>' +
                up.slice(0, 6).map(d => "<tr><td>" + fmt(d.date) + "<br><small style='color:var(--text-muted)'>" + dow(d.date) + "</small></td><td>" + esc(d.cls) + "</td><td><b>" + esc(d.subject) + "</b></td><td>" + esc(d.time) + "</td></tr>").join("") + "</tbody></table></div>"
                : empty("calendar-xmark", "No upcoming papers", "Add entries in Date Sheet.")) + "</div>" +
            '<div class="ex-panel"><h3><i class="fas fa-clock-rotate-left"></i> Recent Activity</h3>' + (db.log.length ?
                db.log.slice(0, 7).map(l => '<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-subtle);font-size:13px"><i class="fas fa-' + l.icon + '" style="color:var(--accent-teaching-light);width:16px;text-align:center"></i><span style="flex:1">' + esc(l.text) + '</span><small style="color:var(--text-muted)">' + new Date(l.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) + "</small></div>").join("")
                : empty("inbox", "Nothing yet", "Generated papers and published results will show here.")) + "</div></section>";
        $$("[data-go]").forEach(b => b.addEventListener("click", () => { location.hash = "#" + b.dataset.go; }));
    }
    function stat(ic, fa, val, label) {
        return '<div class="stat-pill"><div class="stat-pill-icon ' + ic + '"><i class="fas fa-' + fa + '"></i></div><div class="stat-pill-info"><span class="stat-pill-value">' + val + '</span><span class="stat-pill-label">' + label + "</span></div></div>";
    }

    /* ============================================================
       PAPER GENERATION
       ============================================================ */
    let P = null;
    function newPaper() {
        return {
            term: db.prefs.term, cls: db.prefs.cls, subj: "Mathematics", date: iso(new Date()), mins: 90, title: "",
            instr: "Read each question carefully. Write neatly. Attempt all sections as instructed.",
            sections: [{ type: "MCQs", total: 5, attempt: 5, marks: 1 }, { type: "Short Questions", total: 4, attempt: 3, marks: 5 }, { type: "Long Questions", total: 3, attempt: 2, marks: 10 }],
            picked: []
        };
    }
    const paperTotal = p => p.sections.reduce((a, s) => a + (+s.attempt || 0) * (+s.marks || 0), 0);
    function repick() {
        P.picked = P.sections.map(sec => {
            const pool = shuffle(db.bank.filter(q => q.subject === P.subj && q.type === sec.type && (q.cls === "All" || q.cls === P.cls)));
            const out = []; for (let i = 0; i < (+sec.total || 0); i++) out.push(pool[i] || null);
            return out;
        });
    }
    function paperHtml(p) {
        const L = "ABCDEFGH";
        let h = "<h1>" + esc(school.name) + '</h1><div class="sub">' + esc(p.term) + " Examination " + new Date().getFullYear() + "</div>" +
            '<div class="meta"><span>Subject: ' + esc(p.subj) + "</span><span>Class: " + esc(p.cls) + "</span><span>Time: " + (+p.mins || 0) + " mins</span><span>Max Marks: " + paperTotal(p) + "</span></div>" +
            '<div class="stu"><span>Name:</span><span style="flex:.6">Roll No:</span><span style="flex:.5">Date: ' + fmt(p.date) + "</span></div>" +
            '<div class="note">' + esc(p.instr) + "</div>";
        p.sections.forEach((sec, i) => {
            const att = +sec.attempt, tot = +sec.total, mk = +sec.marks;
            h += '<div class="secthead"><span>Section ' + L[i] + " — " + esc(sec.type) + " (" + (att >= tot ? "Attempt all" : "Attempt any " + att + " of " + tot) + ")</span><span>" + att + " × " + mk + " = " + att * mk + "</span></div><ol>";
            (p.picked[i] || []).forEach(q => {
                if (!q) { h += '<li><span class="blank">Question ______________________________</span>' + (sec.type !== "MCQs" ? '<span class="mk">[' + mk + "]</span>" : "") + "</li>"; return; }
                h += "<li>" + esc(q.text) + (sec.type !== "MCQs" ? '<span class="mk">[' + mk + "]</span>" : "");
                if (sec.type === "MCQs" && q.opts && q.opts.length) h += '<div class="opts">' + q.opts.map((o, k) => "<span>(" + "abcd"[k] + ") " + esc(o) + "</span>").join("") + "</div>";
                if (sec.type === "True / False") h += '<div class="opts"><span>True / False</span></div>';
                h += "</li>";
            });
            h += "</ol>";
        });
        return h + '<div class="foot">— End of Paper —</div>';
    }
    function vPaper() {
        freshRoot();
        if (!P) { P = newPaper(); repick(); }
        ROOT().innerHTML = head("file-pen", "Paper <span>Generation</span>", "Choose subject &amp; structure — questions are picked from the Question Bank.",
            '<button class="ex-btn ghost" id="pg-reset"><i class="fas fa-rotate-left"></i> New</button><button class="ex-btn ghost" id="pg-shuf"><i class="fas fa-shuffle"></i> Shuffle</button><button class="ex-btn ghost" id="pg-save"><i class="fas fa-floppy-disk"></i> Save</button><button class="ex-btn" id="pg-print"><i class="fas fa-print"></i> Print</button>') +
            '<div class="ex-split"><div class="ex-panel ex-noprint"><h3><i class="fas fa-sliders"></i> Paper Setup</h3><div class="ex-grid">' +
            field("Exam / Term", '<select data-p="term">' + opts(TERMS, P.term) + "</select>") +
            field("Class", '<select data-p="cls" data-pick="1">' + opts(CLASSES, P.cls) + "</select>") +
            field("Subject", '<select data-p="subj" data-pick="1">' + opts(SUBJECTS, P.subj) + "</select>") +
            field("Date", '<input type="date" data-p="date" value="' + P.date + '">') +
            field("Duration (mins)", '<input type="number" min="10" data-p="mins" value="' + P.mins + '">') + "</div>" +
            '<div class="ex-f" style="margin-top:12px"><label>Instructions</label><textarea data-p="instr" rows="2">' + esc(P.instr) + "</textarea></div>" +
            '<h3 style="margin:16px 0 8px;font-size:13.5px">Sections <span class="ex-spacer"><button class="ex-btn sm ghost" id="pg-addsec"><i class="fas fa-plus"></i> Add</button></span></h3><div id="pg-secs"></div>' +
            '<div class="ex-total"><span>Total Marks</span><span id="pg-total"></span></div><p class="ex-note" id="pg-bankinfo"></p></div>' +
            '<div class="ex-panel"><h3 class="ex-noprint"><i class="fas fa-eye"></i> Live Preview</h3><div class="ex-paper-wrap"><div class="ex-paper" id="pg-paper"></div></div></div></div>' +
            '<div class="ex-panel ex-noprint" style="margin-top:16px"><h3><i class="fas fa-folder-open"></i> Saved Papers</h3><div id="pg-saved"></div></div>';
        secs(); preview(); saved();
        const root = ROOT();
        root.addEventListener("input", onP); root.addEventListener("change", onP);
        function onP(e) {
            const t = e.target;
            if (t.dataset.p) { P[t.dataset.p] = t.value; if (t.dataset.pick) repick(); preview(); info(); }
            else if (t.dataset.sec != null) { P.sections[+t.dataset.sec][t.dataset.k] = t.dataset.k === "type" ? t.value : (+t.value || 0); if (t.dataset.k === "type" || t.dataset.k === "total") repick(); preview(); info(); }
        }
        root.addEventListener("click", e => {
            const rm = e.target.closest("[data-rmsec]");
            if (rm) { P.sections.splice(+rm.dataset.rmsec, 1); repick(); secs(); preview(); }
        });
        $("#pg-addsec").addEventListener("click", () => { if (P.sections.length >= 8) return toast("Maximum 8 sections.", 1); P.sections.push({ type: "Short Questions", total: 4, attempt: 4, marks: 2 }); repick(); secs(); preview(); });
        $("#pg-shuf").addEventListener("click", () => { repick(); preview(); toast("Questions reshuffled."); });
        $("#pg-reset").addEventListener("click", () => { P = newPaper(); repick(); vPaper(); });
        $("#pg-print").addEventListener("click", () => window.print());
        $("#pg-save").addEventListener("click", () => {
            const title = P.title || (P.term + " — " + P.subj + " (" + P.cls + ")");
            db.papers.unshift({ id: uid(), title, term: P.term, cls: P.cls, subj: P.subj, total: paperTotal(P), at: Date.now(), data: JSON.parse(JSON.stringify(P)) });
            logAct("file-pen", "Paper saved: " + title); save(); saved(); toast("Paper saved.");
        });
    }
    function secs() {
        const box = $("#pg-secs"); if (!box) return;
        box.innerHTML = P.sections.map((s, i) => '<div class="ex-sec">' +
            field("Type", '<select data-sec="' + i + '" data-k="type">' + opts(QTYPES, s.type) + "</select>") +
            field("Questions", '<input type="number" min="1" data-sec="' + i + '" data-k="total" value="' + s.total + '">') +
            field("Attempt", '<input type="number" min="1" data-sec="' + i + '" data-k="attempt" value="' + s.attempt + '">') +
            field("Marks each", '<input type="number" min="1" data-sec="' + i + '" data-k="marks" value="' + s.marks + '">') +
            '<button class="ex-icon-btn del" type="button" data-rmsec="' + i + '" title="Remove"><i class="fas fa-trash"></i></button></div>').join("");
        info();
    }
    function info() {
        const t = $("#pg-total"); if (t) t.textContent = paperTotal(P) + " marks";
        const b = $("#pg-bankinfo"); if (!b) return;
        const found = (P.picked || []).reduce((a, s) => a + s.filter(Boolean).length, 0), need = P.sections.reduce((a, s) => a + (+s.total || 0), 0);
        b.innerHTML = found < need ? "<b>" + found + " of " + need + "</b> questions found in the Question Bank for " + esc(P.subj) + ". Blank lines are left for the rest — add more in <a href='#bank' style='color:var(--accent-teaching-light)'>Question Bank</a>." : "All <b>" + need + "</b> questions picked from the Question Bank.";
    }
    function preview() { const p = $("#pg-paper"); if (p) p.innerHTML = paperHtml(P); }
    function saved() {
        const b = $("#pg-saved"); if (!b) return;
        b.innerHTML = db.papers.length ? '<div class="ex-tablewrap"><table class="ex-table"><thead><tr><th>Title</th><th>Class</th><th>Subject</th><th>Marks</th><th>Saved</th><th></th></tr></thead><tbody>' +
            db.papers.map(p => "<tr><td><b>" + esc(p.title) + "</b></td><td>" + esc(p.cls) + "</td><td>" + esc(p.subj) + "</td><td>" + p.total + "</td><td>" + new Date(p.at).toLocaleDateString("en-GB") + '</td><td style="text-align:right;white-space:nowrap"><button class="ex-btn sm ghost" data-open="' + p.id + '">Open</button> <button class="ex-icon-btn del" data-del="' + p.id + '"><i class="fas fa-trash"></i></button></td></tr>').join("") + "</tbody></table></div>"
            : empty("folder-open", "No saved papers yet", "Press Save to keep a paper here.");
        $$("[data-open]", b).forEach(x => x.addEventListener("click", () => { const p = db.papers.find(q => q.id === x.dataset.open); if (p) { P = JSON.parse(JSON.stringify(p.data)); vPaper(); window.scrollTo(0, 0); } }));
        $$("[data-del]", b).forEach(x => x.addEventListener("click", () => { db.papers = db.papers.filter(q => q.id !== x.dataset.del); save(); saved(); }));
    }

    /* ============================================================
       RESULT UPLOAD
       ============================================================ */
    let R = null;
    function loadR() {
        if (R.keep) { R.rows = R.keep; R.keep = null; R.status = (db.results[rk(R.term, R.cls, R.subj)] || {}).status || "new"; return; }
        const ex = db.results[rk(R.term, R.cls, R.subj)];
        if (ex) { R.total = ex.total; R.rows = JSON.parse(JSON.stringify(ex.rows)); R.status = ex.status; }
        else { R.rows = roster(R.cls).map(s => ({ roll: s.roll, name: s.name, marks: "" })); R.status = "new"; }
    }
    function calc(row) {
        const m = String(row.marks).trim();
        if (m === "") return { pct: "", grade: "", res: "—", cls: "" };
        if (isAbs(m)) return { pct: "", grade: "Abs", res: "Absent", cls: "warn" };
        if (!isNum(m) || +m < 0 || +m > R.total) return { pct: "", grade: "", res: "Invalid", cls: "bad" };
        const pct = +m / R.total * 100;
        return { pct: pct.toFixed(1) + "%", grade: gradeOf(pct).grade, res: pct >= db.grades.pass ? "Pass" : "Fail", cls: pct >= db.grades.pass ? "ok" : "bad" };
    }
    function vResults() {
        if (!R) R = { term: db.prefs.term, cls: db.prefs.cls, subj: "Mathematics", total: 100, tab: "upload" };
        R.term = db.prefs.term; R.cls = db.prefs.cls; loadR();
        const locked = R.status === "published";
        ROOT().innerHTML = head("file-arrow-up", "Result <span>Upload</span>", "Upload marks for one subject at a time, review, then publish.",
            '<button class="ex-btn ghost" id="ru-tpl"><i class="fas fa-download"></i> CSV Template</button>' +
            (locked ? '<button class="ex-btn ghost" id="ru-unpub"><i class="fas fa-lock-open"></i> Unpublish</button>' : '<button class="ex-btn ghost" id="ru-draft"><i class="fas fa-floppy-disk"></i> Save Draft</button><button class="ex-btn" id="ru-pub"><i class="fas fa-paper-plane"></i> Publish</button>')) +
            '<div class="ex-panel ex-noprint">' + termClassBar(field("Subject", '<select id="ru-subj">' + opts(SUBJECTS, R.subj) + "</select>") + field("Total Marks", '<input type="number" id="ru-total" min="1" value="' + R.total + '"' + (locked ? " disabled" : "") + ">")) +
            '<div style="margin-top:14px"><div class="ex-seg"><button data-tab="upload" class="' + (R.tab === "upload" ? "on" : "") + '"><i class="fas fa-file-csv"></i> Upload CSV</button><button data-tab="manual" class="' + (R.tab === "manual" ? "on" : "") + '"><i class="fas fa-keyboard"></i> Enter Manually</button></div></div>' +
            '<div id="ru-drop-wrap"' + (R.tab === "upload" && !locked ? "" : " hidden") + '><div class="ex-drop" id="ru-drop"><i class="fas fa-cloud-arrow-up"></i><b>Drop a CSV file here or click to browse</b><small>Columns: roll no, name, marks &nbsp;·&nbsp; use A or AB for absent</small><input type="file" id="ru-file" accept=".csv,text/csv" hidden></div></div>' +
            (locked ? '<p class="ex-note"><b>Published.</b> These results are visible to parents. Unpublish to edit.</p>' : "") + "</div>" +
            '<div class="ex-panel"><h3><i class="fas fa-table-list"></i> Marks Sheet <span class="ex-chip ' + (locked ? "ok" : R.status === "draft" ? "warn" : "info") + '" style="margin-left:6px">' + (locked ? "Published" : R.status === "draft" ? "Draft" : "Not saved") + "</span></h3>" +
            '<div id="ru-sum" class="ex-mini"></div><div class="ex-tablewrap"><table class="ex-table"><thead><tr><th>#</th><th>Roll No</th><th>Student</th><th>Marks</th><th>%</th><th>Grade</th><th>Result</th></tr></thead><tbody id="ru-body"></tbody></table></div>' +
            (roster(R.cls)[0] && roster(R.cls)[0].demo ? '<p class="ex-note"><b>Demo roster</b> — no students found for ' + esc(R.cls) + " in Student Management, so sample names are shown.</p>" : "") + "</div>" +
            '<div class="ex-panel ex-noprint"><h3><i class="fas fa-list-check"></i> Upload Status — ' + esc(R.term) + ", " + esc(R.cls) + '</h3><div class="ex-matrix">' +
            SUBJECTS.map(s => { const r = db.results[rk(R.term, R.cls, s)]; return '<div data-subj="' + esc(s) + '" style="cursor:pointer;' + (s === R.subj ? "border-color:#17716A" : "") + '">' + esc(s) + '<span class="ex-chip ' + (r ? (r.status === "published" ? "ok" : "warn") : "") + '" style="align-self:flex-start">' + (r ? (r.status === "published" ? "Published" : "Draft") : "Pending") + "</span></div>"; }).join("") + "</div></div>";
        bindPrefs(ROOT(), vResults);
        rows(); sum();
        $("#ru-subj").addEventListener("change", e => { R.subj = e.target.value; vResults(); });
        $$("[data-subj]").forEach(d => d.addEventListener("click", () => { R.subj = d.dataset.subj; vResults(); }));
        $$("[data-tab]").forEach(b => b.addEventListener("click", () => { R.tab = b.dataset.tab; vResults(); }));
        $("#ru-total").addEventListener("input", e => { R.total = +e.target.value || 1; $$("#ru-body tr").forEach(refreshRow); sum(); });
        $("#ru-tpl").addEventListener("click", () => download("marks-template-" + R.cls.replace(/\s+/g, "") + "-" + R.subj + ".csv", "roll_no,name,marks\n" + R.rows.map(r => r.roll + "," + r.name + ",").join("\n")));
        const drop = $("#ru-drop"), file = $("#ru-file");
        if (drop) {
            drop.addEventListener("click", () => file.click());
            file.addEventListener("change", () => readFile(file.files[0]));
            ["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
            ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
            drop.addEventListener("drop", e => readFile(e.dataTransfer.files[0]));
        }
        const d = $("#ru-draft"); if (d) d.addEventListener("click", () => persist("draft"));
        const p = $("#ru-pub"); if (p) p.addEventListener("click", publish);
        const u = $("#ru-unpub"); if (u) u.addEventListener("click", () => { persist("draft", true); vResults(); toast("Results unpublished."); });
    }
    function rows() {
        const locked = R.status === "published";
        $("#ru-body").innerHTML = R.rows.map((r, i) => '<tr data-i="' + i + '"><td>' + (i + 1) + "</td><td>" + esc(r.roll) + "</td><td>" + esc(r.name) + (r.extra ? ' <span class="ex-chip warn">not in roster</span>' : "") + '</td><td><input class="ex-cell" data-m="' + i + '" value="' + esc(r.marks) + '"' + (locked ? " disabled" : "") + '></td><td data-c="pct"></td><td data-c="grade"></td><td data-c="res"></td></tr>').join("");
        $$("#ru-body tr").forEach(refreshRow);
        $$("[data-m]").forEach(inp => inp.addEventListener("input", () => { R.rows[+inp.dataset.m].marks = inp.value.trim(); refreshRow(inp.closest("tr")); sum(); }));
    }
    function refreshRow(tr) {
        const r = R.rows[+tr.dataset.i], c = calc(r);
        tr.querySelector('[data-c="pct"]').textContent = c.pct;
        tr.querySelector('[data-c="grade"]').innerHTML = c.grade ? "<b>" + c.grade + "</b>" : "";
        tr.querySelector('[data-c="res"]').innerHTML = c.res === "—" ? "—" : '<span class="ex-chip ' + c.cls + '">' + c.res + "</span>";
        tr.querySelector("input").classList.toggle("err", c.res === "Invalid");
    }
    function sum() {
        const nums = R.rows.filter(r => isNum(r.marks) && +r.marks >= 0 && +r.marks <= R.total).map(r => +r.marks);
        const abs = R.rows.filter(r => isAbs(r.marks)).length, bad = R.rows.filter(r => calc(r).res === "Invalid").length;
        const pass = nums.filter(m => m / R.total * 100 >= db.grades.pass).length;
        $("#ru-sum").innerHTML = [["Entered", nums.length + abs + " / " + R.rows.length], ["Average", nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : "—"],
            ["Highest", nums.length ? Math.max.apply(null, nums) : "—"], ["Lowest", nums.length ? Math.min.apply(null, nums) : "—"], ["Pass %", nums.length ? Math.round(pass / nums.length * 100) + "%" : "—"], ["Errors", bad]].map(x => "<div><b" + (x[0] === "Errors" && bad ? ' style="color:#ef4444"' : "") + ">" + x[1] + "</b><span>" + x[0] + "</span></div>").join("");
    }
    function readFile(f) {
        if (!f) return;
        if (!/\.csv$/i.test(f.name)) return toast("Please choose a .csv file.", 1);
        const rd = new FileReader();
        rd.onload = () => {
            const lines = String(rd.result).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            let ok = 0, extra = 0, bad = 0;
            lines.forEach((l, i) => {
                const c = l.split(",").map(x => x.replace(/^"|"$/g, "").trim());
                const marks = c.length >= 3 ? c[2] : c[1];
                if (i === 0 && !isNum(marks) && !isAbs(marks)) return; // header row
                if (marks == null || !(isNum(marks) && +marks >= 0 && +marks <= R.total || isAbs(marks))) { bad++; return; }
                const hit = R.rows.find(r => r.roll.toLowerCase() === c[0].toLowerCase());
                if (hit) { hit.marks = isAbs(marks) ? "A" : marks; ok++; }
                else { R.rows.push({ roll: c[0], name: c.length >= 3 ? c[1] : "(not in roster)", marks: isAbs(marks) ? "A" : marks, extra: true }); extra++; }
            });
            R.tab = "manual"; R.keep = R.rows; vResults();
            toast(ok + " rows imported" + (extra ? ", " + extra + " not in roster" : "") + (bad ? ", " + bad + " skipped (invalid marks)" : "") + ".", bad > 0);
        };
        rd.readAsText(f);
    }
    function persist(status, quiet) {
        db.results[rk(R.term, R.cls, R.subj)] = { total: R.total, rows: JSON.parse(JSON.stringify(R.rows)), status, at: Date.now() };
        save(); if (!quiet) { toast("Draft saved."); logAct("file-arrow-up", "Draft saved: " + R.subj + " · " + R.cls); vResults(); }
    }
    function publish() {
        const bad = R.rows.filter(r => calc(r).res === "Invalid").length, entered = R.rows.filter(r => r.marks !== "").length, blank = R.rows.length - entered;
        if (bad) return toast(bad + " row(s) have invalid marks (more than total or not a number).", 1);
        if (!entered) return toast("Enter at least one mark before publishing.", 1);
        openModal("<h3>Publish results?</h3><p style='font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0 0 6px'><b>" + esc(R.subj) + "</b> · " + esc(R.cls) + " · " + esc(R.term) + "<br>" + entered + " students have marks" + (blank ? "; <b>" + blank + " still blank</b>" : "") + ". Once published, parents can see these results.</p><div class='row'><button class='ex-btn ghost' data-close>Cancel</button><button class='ex-btn' id='pub-ok'>Publish</button></div>", s => {
            $("#pub-ok", s).addEventListener("click", () => { persist("published", true); logAct("paper-plane", "Published " + R.subj + " · " + R.cls + " (" + R.term + ")"); closeModal(); vResults(); toast("Results published."); });
        });
    }

    /* ============================================================
       DATE SHEET
       ============================================================ */
    function vDate() {
        const rowsAll = db.datesheet.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        const clash = d => db.datesheet.some(o => o.id !== d.id && o.cls === d.cls && o.date === d.date);
        ROOT().innerHTML = head("calendar-days", "Date <span>Sheet</span>", "Exam timetable for each class.",
            '<button class="ex-btn ghost" id="ds-print"><i class="fas fa-print"></i> Print</button><button class="ex-btn" id="ds-add"><i class="fas fa-plus"></i> Add Paper</button>') +
            '<div class="ex-panel"><div class="ex-grid ex-noprint" style="margin-bottom:14px">' + field("Filter by class", '<select id="ds-f"><option value="">All classes</option>' + opts(CLASSES, "") + "</select>") + "</div>" +
            '<div id="ds-body"></div></div>';
        const draw = () => {
            const f = $("#ds-f").value, list = rowsAll.filter(d => !f || d.cls === f);
            $("#ds-body").innerHTML = list.length ? '<div class="ex-tablewrap"><table class="ex-table"><thead><tr><th>Date</th><th>Day</th><th>Class</th><th>Subject</th><th>Time</th><th>Room</th><th>Term</th><th class="ex-noprint"></th></tr></thead><tbody>' +
                list.map(d => "<tr><td><b>" + fmt(d.date) + "</b></td><td>" + dow(d.date) + "</td><td>" + esc(d.cls) + "</td><td>" + esc(d.subject) + (clash(d) ? ' <span class="ex-chip warn">2 papers same day</span>' : "") + "</td><td>" + esc(d.time) + "</td><td>" + esc(d.room) + "</td><td>" + esc(d.term) + '</td><td class="ex-noprint" style="text-align:right;white-space:nowrap"><button class="ex-icon-btn" data-e="' + d.id + '"><i class="fas fa-pen"></i></button> <button class="ex-icon-btn del" data-d="' + d.id + '"><i class="fas fa-trash"></i></button></td></tr>').join("") + "</tbody></table></div>"
                : empty("calendar-plus", "No papers scheduled", "Press Add Paper to build the date sheet.");
            $$("[data-e]").forEach(b => b.addEventListener("click", () => dsForm(db.datesheet.find(x => x.id === b.dataset.e))));
            $$("[data-d]").forEach(b => b.addEventListener("click", () => { db.datesheet = db.datesheet.filter(x => x.id !== b.dataset.d); save(); vDate(); }));
        };
        draw(); $("#ds-f").addEventListener("change", draw);
        $("#ds-add").addEventListener("click", () => dsForm());
        $("#ds-print").addEventListener("click", () => window.print());
    }
    function dsForm(d) {
        d = d || { term: db.prefs.term, date: iso(new Date()), cls: db.prefs.cls, subject: "English", time: "09:00 – 11:00", room: "" };
        openModal("<h3>" + (d.id ? "Edit" : "Add") + " Paper <button class='ex-icon-btn' data-close><i class='fas fa-xmark'></i></button></h3><div class='ex-grid'>" +
            field("Term", '<select id="f-term">' + opts(TERMS, d.term) + "</select>") + field("Class", '<select id="f-cls">' + opts(CLASSES, d.cls) + "</select>") +
            field("Subject", '<select id="f-subj">' + opts(SUBJECTS, d.subject) + "</select>") + field("Date", '<input type="date" id="f-date" value="' + d.date + '">') +
            field("Time", '<input id="f-time" value="' + esc(d.time) + '">') + field("Room / Hall", '<input id="f-room" value="' + esc(d.room) + '" placeholder="e.g. Hall 1">') +
            "</div><div class='row'><button class='ex-btn ghost' data-close>Cancel</button><button class='ex-btn' id='f-ok'>Save</button></div>", s => {
            $("#f-ok", s).addEventListener("click", () => {
                const v = { term: $("#f-term", s).value, cls: $("#f-cls", s).value, subject: $("#f-subj", s).value, date: $("#f-date", s).value, time: $("#f-time", s).value.trim(), room: $("#f-room", s).value.trim() };
                if (!v.date) return toast("Pick a date.", 1);
                if (d.id) Object.assign(d, v); else db.datesheet.push(Object.assign({ id: uid() }, v));
                logAct("calendar-days", "Date sheet updated: " + v.subject + " · " + v.cls); save(); closeModal(); vDate();
            });
        });
    }

    /* ============================================================
       ROLL NUMBER SLIPS
       ============================================================ */
    function vSlips() {
        const ro = roster(db.prefs.cls), ds = db.datesheet.filter(d => d.cls === db.prefs.cls && d.term === db.prefs.term).sort((a, b) => a.date.localeCompare(b.date));
        ROOT().innerHTML = head("id-card", "Roll Number <span>Slips</span>", "Admit slips for the whole class, with the date sheet on each slip.", '<button class="ex-btn" id="sl-print"' + (ro.length ? "" : " disabled") + '><i class="fas fa-print"></i> Print All</button>') +
            '<div class="ex-panel ex-noprint">' + termClassBar() + (ds.length ? "" : '<p class="ex-note"><b>No date sheet</b> for this class and term yet — slips will print without a schedule. Add one in <a href="#datesheet" style="color:var(--accent-teaching-light)">Date Sheet</a>.</p>') + "</div>" +
            '<div class="ex-slips">' + ro.map(s => '<div class="ex-slip"><h4>' + esc(school.name) + '</h4><div class="t">ROLL NUMBER SLIP — ' + esc(db.prefs.term).toUpperCase() + "</div><dl><dt>Name</dt><dd>" + esc(s.name) + "</dd><dt>Roll No</dt><dd>" + esc(s.roll) + "</dd><dt>Class</dt><dd>" + esc(db.prefs.cls) + "</dd></dl>" +
                (ds.length ? "<table><thead><tr><th>Date</th><th>Subject</th><th>Time</th></tr></thead><tbody>" + ds.map(d => "<tr><td>" + fmt(d.date) + "</td><td>" + esc(d.subject) + "</td><td>" + esc(d.time) + "</td></tr>").join("") + "</tbody></table>" : "") +
                '<div class="sig"><span>Class Teacher</span><span>Principal</span></div></div>').join("") + "</div>";
        bindPrefs(ROOT(), vSlips); $("#sl-print").addEventListener("click", () => window.print());
    }

    /* ============================================================
       REPORT CARDS
       ============================================================ */
    let CARD = { roll: "", all: false };
    function cardData(roll) {
        const subs = []; let got = 0, out = 0;
        SUBJECTS.forEach(s => {
            const r = db.results[rk(db.prefs.term, db.prefs.cls, s)]; if (!r) return;
            const row = r.rows.find(x => x.roll === roll); if (!row || row.marks === "") return;
            if (isAbs(row.marks)) { subs.push({ s, total: r.total, abs: true }); return; }
            const m = +row.marks, pct = m / r.total * 100; got += m; out += r.total;
            subs.push({ s, m, total: r.total, pct, g: gradeOf(pct).grade });
        });
        const pct = out ? got / out * 100 : 0;
        return { subs, got, out, pct, g: gradeOf(pct), failed: subs.some(x => x.abs || x.pct < db.grades.pass) };
    }
    function cardHtml(st) {
        const d = cardData(st.roll);
        const all = roster(db.prefs.cls).map(s => ({ roll: s.roll, pct: cardData(s.roll).pct })).sort((a, b) => b.pct - a.pct);
        const pos = all.findIndex(x => x.roll === st.roll) + 1;
        return '<div class="ex-rc"><h1>' + esc(school.name) + '</h1><div class="sub">Result Card — ' + esc(db.prefs.term) + " " + new Date().getFullYear() + "</div>" +
            "<dl><dt>Name</dt><dd>" + esc(st.name) + "</dd><dt>Roll No</dt><dd>" + esc(st.roll) + "</dd><dt>Class</dt><dd>" + esc(db.prefs.cls) + "</dd><dt>Position</dt><dd>" + (d.out ? pos + " of " + all.length : "—") + "</dd></dl>" +
            "<table><thead><tr><th>Subject</th><th>Total</th><th>Obtained</th><th>%</th><th>Grade</th></tr></thead><tbody>" +
            d.subs.map(x => "<tr><td>" + esc(x.s) + "</td><td>" + x.total + "</td><td>" + (x.abs ? "Abs" : x.m) + "</td><td>" + (x.abs ? "—" : x.pct.toFixed(1)) + "</td><td>" + (x.abs ? "—" : x.g) + "</td></tr>").join("") +
            '</tbody></table><div class="sum"><span>Total: ' + d.got + " / " + d.out + "</span><span>Percentage: " + d.pct.toFixed(1) + "%</span><span>Grade: " + d.g.grade + "</span><span>Result: " + (d.failed ? "FAIL" : "PASS") + "</span></div><div>Remarks: <b>" + esc(d.g.remark) + '</b></div><div class="sig"><span>Class Teacher</span><span>Parent</span><span>Principal</span></div></div>';
    }
    function vCards() {
        const ro = roster(db.prefs.cls); if (!ro.some(s => s.roll === CARD.roll)) CARD.roll = ro[0] ? ro[0].roll : "";
        const anyRes = SUBJECTS.some(s => db.results[rk(db.prefs.term, db.prefs.cls, s)]);
        const st = ro.find(s => s.roll === CARD.roll);
        ROOT().innerHTML = head("award", "Report <span>Cards</span>", "Built automatically from uploaded results.", '<button class="ex-btn ghost" id="rc-all"><i class="fas fa-layer-group"></i> ' + (CARD.all ? "Single View" : "All Students") + '</button><button class="ex-btn" id="rc-print"' + (anyRes ? "" : " disabled") + '><i class="fas fa-print"></i> Print</button>') +
            '<div class="ex-panel ex-noprint">' + termClassBar(CARD.all ? "" : field("Student", '<select id="rc-st">' + ro.map(s => '<option value="' + esc(s.roll) + '"' + (s.roll === CARD.roll ? " selected" : "") + ">" + esc(s.roll + " — " + s.name) + "</option>").join("") + "</select>")) + "</div>" +
            (anyRes ? (CARD.all ? ro.map(cardHtml).join('<div style="height:16px" class="ex-noprint"></div>') : (st ? cardHtml(st) : "")) : '<div class="ex-panel">' + empty("file-circle-question", "No results uploaded yet", 'Upload marks in <a href="#results" style="color:var(--accent-teaching-light)">Result Upload</a> for ' + esc(db.prefs.cls) + " · " + esc(db.prefs.term) + ".") + "</div>");
        bindPrefs(ROOT(), vCards);
        const s = $("#rc-st"); if (s) s.addEventListener("change", e => { CARD.roll = e.target.value; vCards(); });
        $("#rc-all").addEventListener("click", () => { CARD.all = !CARD.all; vCards(); });
        $("#rc-print").addEventListener("click", () => window.print());
    }

    /* ============================================================
       RESULT ANALYSIS
       ============================================================ */
    function vAnalysis() {
        const per = [], stu = {}; const dist = {};
        db.grades.scale.forEach(g => { dist[g.grade] = 0; });
        SUBJECTS.forEach(s => {
            const r = db.results[rk(db.prefs.term, db.prefs.cls, s)]; if (!r) return;
            const ms = r.rows.filter(x => isNum(x.marks)).map(x => ({ roll: x.roll, name: x.name, m: +x.marks }));
            if (!ms.length) return;
            const avg = ms.reduce((a, b) => a + b.m, 0) / ms.length / r.total * 100, pass = ms.filter(x => x.m / r.total * 100 >= db.grades.pass).length;
            per.push({ s, avg, pass: Math.round(pass / ms.length * 100), hi: Math.max.apply(null, ms.map(x => x.m)), n: ms.length, total: r.total });
            ms.forEach(x => { const p = x.m / r.total * 100; dist[gradeOf(p).grade]++; const o = stu[x.roll] || (stu[x.roll] = { name: x.name, got: 0, out: 0, fails: [] }); o.got += x.m; o.out += r.total; if (p < db.grades.pass) o.fails.push(s); });
        });
        const list = Object.values(stu).map(o => Object.assign(o, { pct: o.got / o.out * 100 })).sort((a, b) => b.pct - a.pct);
        const needs = list.filter(o => o.fails.length).sort((a, b) => b.fails.length - a.fails.length).slice(0, 6);
        const maxD = Math.max.apply(null, Object.values(dist).concat([1]));
        const overall = per.length ? per.reduce((a, b) => a + b.avg, 0) / per.length : 0;
        ROOT().innerHTML = head("chart-column", "Result <span>Analysis</span>", "How the class performed, subject by subject.") + '<div class="ex-panel ex-noprint">' + termClassBar() + "</div>" +
            (!per.length ? '<div class="ex-panel">' + empty("chart-simple", "Nothing to analyse yet", "Upload results for " + esc(db.prefs.cls) + " · " + esc(db.prefs.term) + " first.") + "</div>" :
                '<section class="quick-stats-strip">' + stat("icon-students", "book", per.length, "Subjects Uploaded") + stat("icon-staff", "users", list.length, "Students") + stat("icon-present-students", "percent", overall.toFixed(1) + "%", "Class Average") + stat("icon-present-staff", "triangle-exclamation", needs.length, "Need Attention") + "</section>" +
                '<div class="ex-two"><div class="ex-panel"><h3><i class="fas fa-book-open"></i> Subject Averages</h3><div class="ex-bars">' + per.map(p => '<div class="ex-bar"><span class="lbl">' + esc(p.s) + '</span><div class="trk"><div class="fil ' + (p.avg < 50 ? "low" : p.avg < 65 ? "mid" : "") + '" style="width:' + p.avg.toFixed(0) + '%"></div></div><span class="val">' + p.avg.toFixed(0) + "%</span></div>").join("") + "</div></div>" +
                '<div class="ex-panel"><h3><i class="fas fa-chart-simple"></i> Grade Distribution</h3><div class="ex-cols">' + Object.keys(dist).map(g => '<div class="ex-col"><b>' + dist[g] + '</b><i style="height:' + Math.round(dist[g] / maxD * 100) + '%"></i>' + g + "</div>").join("") + "</div></div></div>" +
                '<div class="ex-two"><div class="ex-panel"><h3><i class="fas fa-trophy"></i> Top Performers</h3><div class="ex-tablewrap"><table class="ex-table" style="min-width:0"><tbody>' + list.slice(0, 5).map((o, i) => "<tr><td><b>" + (i + 1) + "</b></td><td>" + esc(o.name) + "</td><td style='text-align:right'><span class='ex-chip ok'>" + o.pct.toFixed(1) + "%</span></td></tr>").join("") + "</tbody></table></div></div>" +
                '<div class="ex-panel"><h3><i class="fas fa-triangle-exclamation"></i> Needs Attention</h3>' + (needs.length ? '<div class="ex-tablewrap"><table class="ex-table" style="min-width:0"><tbody>' + needs.map(o => "<tr><td>" + esc(o.name) + "</td><td style='color:var(--text-secondary);font-size:12px'>" + esc(o.fails.join(", ")) + "</td><td style='text-align:right'><span class='ex-chip bad'>" + o.fails.length + " failed</span></td></tr>").join("") + "</tbody></table></div>" : empty("circle-check", "No failures", "Every student cleared the pass mark.")) + "</div></div>");
        bindPrefs(ROOT(), vAnalysis);
    }

    /* ============================================================
       QUESTION BANK
       ============================================================ */
    let BF = { subj: "", type: "", diff: "", q: "" };
    function vBank() {
        ROOT().innerHTML = head("database", "Question <span>Bank</span>", "Reusable questions that feed the Paper Generation tool.", '<button class="ex-btn" id="qb-add"><i class="fas fa-plus"></i> Add Question</button>') +
            '<div class="ex-panel"><div class="ex-grid" style="margin-bottom:14px">' + field("Subject", '<select id="qb-s"><option value="">All</option>' + opts(SUBJECTS, BF.subj) + "</select>") + field("Type", '<select id="qb-t"><option value="">All</option>' + opts(QTYPES, BF.type) + "</select>") +
            field("Difficulty", '<select id="qb-d"><option value="">All</option>' + opts(DIFFS, BF.diff) + "</select>") + field("Search", '<input id="qb-q" placeholder="Search text…" value="' + esc(BF.q) + '">') + '</div><div id="qb-body"></div></div>';
        const draw = () => {
            const l = db.bank.filter(q => (!BF.subj || q.subject === BF.subj) && (!BF.type || q.type === BF.type) && (!BF.diff || q.diff === BF.diff) && (!BF.q || q.text.toLowerCase().indexOf(BF.q.toLowerCase()) >= 0));
            $("#qb-body").innerHTML = l.length ? '<div class="ex-tablewrap"><table class="ex-table"><thead><tr><th>Question</th><th>Subject</th><th>Class</th><th>Type</th><th>Level</th><th></th></tr></thead><tbody>' +
                l.map(q => '<tr><td style="max-width:360px">' + esc(q.text) + (q.opts && q.opts.length ? '<br><small style="color:var(--text-muted)">' + q.opts.map(esc).join(" · ") + "</small>" : "") + "</td><td>" + esc(q.subject) + "</td><td>" + esc(q.cls) + "</td><td>" + esc(q.type) + '</td><td><span class="ex-chip ' + (q.diff === "Easy" ? "ok" : q.diff === "Hard" ? "bad" : "warn") + '">' + q.diff + '</span></td><td style="text-align:right"><button class="ex-icon-btn del" data-d="' + q.id + '"><i class="fas fa-trash"></i></button></td></tr>').join("") + "</tbody></table></div>" : empty("circle-question", "No questions match", "Try clearing a filter or add a new question.");
            $$("[data-d]").forEach(b => b.addEventListener("click", () => { db.bank = db.bank.filter(q => q.id !== b.dataset.d); save(); draw(); }));
        };
        draw();
        [["qb-s", "subj"], ["qb-t", "type"], ["qb-d", "diff"], ["qb-q", "q"]].forEach(p => $("#" + p[0]).addEventListener(p[0] === "qb-q" ? "input" : "change", e => { BF[p[1]] = e.target.value; draw(); }));
        $("#qb-add").addEventListener("click", () => {
            openModal("<h3>Add Question <button class='ex-icon-btn' data-close><i class='fas fa-xmark'></i></button></h3><div class='ex-grid'>" + field("Subject", '<select id="n-s">' + opts(SUBJECTS, BF.subj || "Mathematics") + "</select>") + field("Class", '<select id="n-c"><option>All</option>' + opts(CLASSES, "") + "</select>") +
                field("Type", '<select id="n-t">' + opts(QTYPES, "MCQs") + "</select>") + field("Difficulty", '<select id="n-d">' + opts(DIFFS, "Medium") + "</select>") + '</div><div class="ex-f" style="margin-bottom:12px"><label>Question</label><textarea id="n-q"></textarea></div><div id="n-opts" class="ex-grid">' +
                [1, 2, 3, 4].map(i => field("Option " + "ABCD"[i - 1], '<input class="n-o">')).join("") + "</div><div class='row'><button class='ex-btn ghost' data-close>Cancel</button><button class='ex-btn' id='n-ok'>Add</button></div>", s => {
                const t = $("#n-t", s), o = $("#n-opts", s); t.addEventListener("change", () => { o.hidden = t.value !== "MCQs"; });
                $("#n-ok", s).addEventListener("click", () => {
                    const text = $("#n-q", s).value.trim(); if (!text) return toast("Write the question first.", 1);
                    const op = t.value === "MCQs" ? $$(".n-o", s).map(i => i.value.trim()).filter(Boolean) : [];
                    if (t.value === "MCQs" && op.length < 2) return toast("MCQs need at least 2 options.", 1);
                    db.bank.unshift({ id: uid(), subject: $("#n-s", s).value, cls: $("#n-c", s).value, type: t.value, diff: $("#n-d", s).value, text, opts: op });
                    save(); closeModal(); toast("Question added."); draw();
                });
            });
        });
    }

    /* ============================================================
       GRADING SCHEME
       ============================================================ */
    function vGrades() {
        const g = JSON.parse(JSON.stringify(db.grades));
        const draw = () => {
            $("#gr-body").innerHTML = g.scale.map((r, i) => '<tr><td><input class="ex-cell" type="number" min="0" max="100" data-i="' + i + '" data-k="min" value="' + r.min + '"></td><td><input class="ex-cell" data-i="' + i + '" data-k="grade" value="' + esc(r.grade) + '"></td><td><input class="ex-cell" data-i="' + i + '" data-k="gpa" value="' + esc(r.gpa) + '"></td><td><input class="ex-cell wide" data-i="' + i + '" data-k="remark" value="' + esc(r.remark) + '"></td><td><button class="ex-icon-btn del" data-r="' + i + '"><i class="fas fa-trash"></i></button></td></tr>').join("");
            $$("#gr-body input").forEach(inp => inp.addEventListener("input", () => { g.scale[+inp.dataset.i][inp.dataset.k] = inp.dataset.k === "min" ? +inp.value : inp.value; }));
            $$("[data-r]").forEach(b => b.addEventListener("click", () => { if (g.scale.length <= 2) return toast("Keep at least 2 grades.", 1); g.scale.splice(+b.dataset.r, 1); draw(); }));
        };
        ROOT().innerHTML = head("ranking-star", "Grading <span>Scheme</span>", "Used by Result Upload, Report Cards and Analysis.", '<button class="ex-btn ghost" id="gr-def"><i class="fas fa-rotate-left"></i> Defaults</button><button class="ex-btn" id="gr-save"><i class="fas fa-floppy-disk"></i> Save</button>') +
            '<div class="ex-panel"><div class="ex-grid" style="max-width:260px;margin-bottom:16px">' + field("Pass mark (%)", '<input type="number" id="gr-pass" min="1" max="100" value="' + g.pass + '">') + "</div>" +
            '<div class="ex-tablewrap"><table class="ex-table" style="min-width:520px"><thead><tr><th>Min %</th><th>Grade</th><th>GPA</th><th>Remark</th><th></th></tr></thead><tbody id="gr-body"></tbody></table></div><div style="margin-top:12px"><button class="ex-btn sm ghost" id="gr-add"><i class="fas fa-plus"></i> Add Grade</button></div></div>';
        draw();
        $("#gr-pass").addEventListener("input", e => { g.pass = +e.target.value || 0; });
        $("#gr-add").addEventListener("click", () => { g.scale.push({ min: 0, grade: "", gpa: "", remark: "" }); draw(); });
        $("#gr-def").addEventListener("click", () => { g.pass = 40; g.scale = JSON.parse(JSON.stringify(DEF_SCALE)); $("#gr-pass").value = 40; draw(); });
        $("#gr-save").addEventListener("click", () => {
            if (g.scale.some(r => !r.grade.trim())) return toast("Every row needs a grade name.", 1);
            if (!g.scale.some(r => r.min === 0)) return toast("One grade must start at 0%.", 1);
            db.grades = g; logAct("ranking-star", "Grading scheme updated"); save(); toast("Grading scheme saved.");
        });
    }

    /* ============================================================
       INVIGILATION DUTY
       ============================================================ */
    function vDuty() {
        const today = iso(new Date()), list = db.datesheet.filter(d => d.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)), staff = staffList();
        ROOT().innerHTML = head("user-shield", "Invigilation <span>Duty</span>", "Who supervises which paper.", '<button class="ex-btn ghost" id="du-auto"><i class="fas fa-wand-magic-sparkles"></i> Auto-assign</button><button class="ex-btn" id="du-print"><i class="fas fa-print"></i> Print</button>') +
            '<div class="ex-panel">' + (list.length ? '<div class="ex-tablewrap"><table class="ex-table"><thead><tr><th>Date</th><th>Class</th><th>Subject</th><th>Room</th><th>Invigilator</th></tr></thead><tbody>' +
                list.map(d => "<tr><td><b>" + fmt(d.date) + "</b><br><small style='color:var(--text-muted)'>" + esc(d.time) + "</small></td><td>" + esc(d.cls) + "</td><td>" + esc(d.subject) + "</td><td>" + esc(d.room || "—") + '</td><td><select class="ex-cell wide" data-d="' + d.id + '" style="height:30px"><option value="">— Unassigned —</option>' + staff.map(s => "<option" + (db.duties[d.id] === s ? " selected" : "") + ">" + esc(s) + "</option>").join("") + "</select></td></tr>").join("") + "</tbody></table></div>"
                : empty("user-shield", "No upcoming papers", 'Add papers in <a href="#datesheet" style="color:var(--accent-teaching-light)">Date Sheet</a> first.') ) + "</div>";
        $$("[data-d]").forEach(s => s.addEventListener("change", () => { if (s.value) db.duties[s.dataset.d] = s.value; else delete db.duties[s.dataset.d]; save(); }));
        $("#du-auto").addEventListener("click", () => { list.forEach((d, i) => { db.duties[d.id] = staff[i % staff.length]; }); logAct("user-shield", "Invigilation duties auto-assigned"); save(); vDuty(); toast("Duties assigned."); });
        $("#du-print").addEventListener("click", () => window.print());
    }

    /* ============================================================
       ROUTER + PAGE CHROME
       ============================================================ */
    const views = { hub: vHub, paper: vPaper, results: vResults, datesheet: vDate, slips: vSlips, cards: vCards, analysis: vAnalysis, bank: vBank, duty: vDuty, grades: vGrades };
    function route() {
        const k = (location.hash || "#hub").slice(1);
        // fresh node so listeners attached by the previous view (e.g. paper builder) never leak
        freshRoot();
        (views[k] || vHub)(); window.scrollTo(0, 0);
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
    chrome(); window.addEventListener("hashchange", route); route();

    /* ------------------------------------------------------------
       BACKEND HOOKS (for later) — suggested REST resources:
         GET/POST   /api/exams/datesheet          -> db.datesheet
         GET/POST   /api/exams/papers             -> db.papers
         GET/POST   /api/exams/questions          -> db.bank
         GET/PUT    /api/exams/results/{term}/{class}/{subject}   (status: draft|published)
         GET/PUT    /api/exams/grading            -> db.grades
         GET/PUT    /api/exams/duties             -> db.duties
       Add "/api/exams" to protectedPrefixes in shared-data.js so the school
       token is attached, and add an "examination" entry to FEATURES /
       PAGE_FEATURE in access-control.js if you want Super Admin plan locks.
       ------------------------------------------------------------ */
})();
