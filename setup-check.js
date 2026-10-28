/**
 * SOFT SCHOOL - SETUP CHECK  (small popup, used on the Dashboard and on New Admission)
 *
 *   REQUIRED (the popup shows until both are done):
 *     1. an academic session exists AND one is marked as current   -> sessions.html
 *     2. at least one class is set up in Settings                   -> settings.html#classes
 *
 *   RECOMMENDED (dashboard only, same popup, hidden for the day once closed):
 *     3. school name + address filled in   -> settings.html#schoolinfo
 *     4. monthly fee set on every class    -> settings.html#classes
 *
 * Where it shows
 *   - Dashboard (main.html):            opens by itself when something required is missing. Crossable (X, Esc, click outside).
 *   - New Admission (manage-students):  opens by itself, AND every time "New Admission" is pressed while setup is missing
 *                                       (manage-students.js asks SoftSchoolSetupCheck.blockAdmission()).
 *
 * Speed (this is what was making the other pages feel slow)
 *   - The old version fired 5 requests on every dashboard load, 3 of them copies of what the dashboard already loads
 *     (students/summary, staff/summary) plus teacher-password. staff/summary is not cached on the server and scans a
 *     month of attendance each time. Those 3 calls are gone: only /api/sessions and /api/settings/{id} are used now.
 *   - Runs when the browser is idle, after the page's own requests, never before them.
 *   - Once the school is fully set up the answer is remembered for 30 minutes (per tab), so normal page loads make
 *     ZERO extra requests.
 *   - One shared in-flight check, so the dashboard and the admission page never ask twice at the same time.
 *   - No page lock, no grayscale/opacity filter on the dashboard any more.
 *
 * Safety: if a request fails (offline, token expired) nothing is shown and nothing is blocked.
 */
(function () {
    'use strict';
    if (window.SoftSchoolSetupCheck) return;

    var ORIGIN = (typeof window.SOFTSCHOOL_API_ORIGIN === 'string' && window.SOFTSCHOOL_API_ORIGIN.trim())
        ? window.SOFTSCHOOL_API_ORIGIN.trim().replace(/\/+$/, '')
        : 'https://167-86-120-247.sslip.io';
    var OK_TTL_MS = 30 * 60 * 1000;

    var IS_DASHBOARD = !!document.querySelector('main.main-content .quick-stats-strip') || /(^|\/)main\.html$/.test(location.pathname);
    var IS_ADMISSION = !!document.getElementById('card-add-student');

    var lastModel = null;      // newest result: { requiredDone, steps, extras }
    var inflight = null;       // shared promise

    function schoolId() {
        try {
            if (window.SoftSchoolAdmin && typeof window.SoftSchoolAdmin.getCurrentSchool === 'function') {
                var s = window.SoftSchoolAdmin.getCurrentSchool();
                if (s && s.schoolId) return s.schoolId;
            }
        } catch (e) { /* not signed in */ }
        return '';
    }
    function get(path, withQuery) {
        var id = schoolId();
        var url = ORIGIN + path + (withQuery ? (path.indexOf('?') > -1 ? '&' : '?') + 'schoolId=' + encodeURIComponent(id) : '');
        var headers = {};
        try { var t = sessionStorage.getItem('softschool_api_token'); if (t) headers.Authorization = 'Bearer ' + t; } catch (e) { /* ignore */ }
        var ctl = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : null;
        return fetch(url, { headers: headers, signal: ctl ? ctl.signal : undefined }).then(function (r) {
            if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status);
            return r.json();
        }).then(function (d) { if (timer) clearTimeout(timer); return d; },
                function (e) { if (timer) clearTimeout(timer); throw e; });
    }
    function list(d) { return Array.isArray(d) ? d : (d && (d.items || d.content || d.data)) || []; }
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    /* ------------------------------------------------------- "all set" memory */
    function okKey() { return 'softschool-setup-ok:' + schoolId(); }
    function readOk() {
        try {
            var v = JSON.parse(sessionStorage.getItem(okKey()) || 'null');
            return !!(v && v.t && Date.now() - v.t < OK_TTL_MS);
        } catch (e) { return false; }
    }
    function writeOk(on) {
        try { if (on) sessionStorage.setItem(okKey(), JSON.stringify({ t: Date.now() })); else sessionStorage.removeItem(okKey()); } catch (e) { /* ignore */ }
    }

    /* ------------------------------------------------------------------ checks */
    function evaluate(force) {
        var id = schoolId();
        if (!id) return Promise.reject(new Error('not signed in'));
        if (!force && readOk()) {
            lastModel = { requiredDone: true, steps: [], extras: [], cached: true };
            return Promise.resolve(lastModel);
        }
        if (inflight) return inflight;

        inflight = Promise.all([get('/api/sessions', true), get('/api/settings/' + encodeURIComponent(id), false)]).then(function (r) {
            var sessions = list(r[0]), settings = r[1] || {};
            var classes = (settings.classes || []).filter(function (c) { return c && String(c.className || '').trim(); });
            var hasSession = sessions.length > 0, hasCurrent = sessions.some(function (s) { return s && s.currentSession; });

            var steps = [
                {
                    key: 'session', required: true, done: hasSession && hasCurrent, icon: 'fa-calendar-check',
                    title: hasSession && !hasCurrent ? 'Choose your current session' : 'Set your academic session',
                    text: hasSession && !hasCurrent ? 'Press “Set as current” on one of your sessions.' : 'Create the session your school is running now and mark it as current.',
                    cta: hasSession && !hasCurrent ? 'Open Sessions' : 'Set session',
                    href: hasSession && !hasCurrent ? 'sessions.html' : 'sessions.html#new'
                },
                {
                    key: 'classes', required: true, done: classes.length > 0, icon: 'fa-layer-group',
                    title: 'Set up your classes',
                    text: 'Add each class with its monthly fee in Settings.',
                    cta: 'Set classes', href: 'settings.html#classes'
                }
            ];
            var requiredDone = steps.every(function (s) { return s.done; });

            // recommended items use data we already have - no extra requests
            var extras = [];
            if (requiredDone) {
                var noFee = classes.filter(function (c) { return !(Number(c.fee) > 0); }).length;
                extras.push({ key: 'info', done: !!(String(settings.schoolName || '').trim() && String(settings.schoolAddress || '').trim()),
                    icon: 'fa-school', title: 'Add school name and address', text: 'Printed on vouchers, certificates and ID cards.', cta: 'School info', href: 'settings.html#schoolinfo' });
                extras.push({ key: 'fees', done: noFee === 0,
                    icon: 'fa-money-bill-wave', title: 'Set a fee for every class', text: noFee + ' class' + (noFee === 1 ? ' has' : 'es have') + ' no fee yet.', cta: 'Set fees', href: 'settings.html#classes' });
            }
            writeOk(requiredDone && extras.every(function (e) { return e.done; }));
            lastModel = { requiredDone: requiredDone, steps: steps, extras: extras };
            return lastModel;
        });
        var clear = function () { inflight = null; };
        inflight.then(clear, clear);
        return inflight;
    }

    /* ---------------------------------------------------------------------- UI */
    var STYLE_ID = 'setup-pop-styles';
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent =
            '.setup-pop-overlay{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(2,6,23,.45);animation:setupPopFade .18s ease-out}' +
            '.setup-pop{position:relative;width:100%;max-width:400px;max-height:calc(100vh - 32px);overflow:auto;padding:18px 18px 16px;border-radius:16px;background:var(--bg-secondary,#111a2e);color:var(--text-primary,#e8ecf4);border:1px solid var(--border-hover,rgba(255,255,255,.14));box-shadow:0 20px 50px rgba(0,0,0,.4);font-family:inherit}' +
            '.setup-pop::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;border-radius:16px 16px 0 0;background:linear-gradient(90deg,#3b82f6,#a855f7,#14b8a6)}' +
            '.setup-pop-x{position:absolute;top:8px;right:8px;width:30px;height:30px;border:0;border-radius:8px;cursor:pointer;font-size:1.25rem;line-height:1;color:var(--text-secondary,#8892a8);background:transparent}' +
            '.setup-pop-x:hover{background:var(--bg-card,rgba(255,255,255,.08));color:var(--text-primary,#e8ecf4)}' +
            '.setup-pop-head{display:flex;gap:12px;align-items:flex-start;padding-right:26px;margin-bottom:12px}' +
            '.setup-pop-ico{flex:none;width:36px;height:36px;border-radius:11px;display:grid;place-items:center;font-size:.95rem;color:#f59e0b;background:rgba(245,158,11,.15)}' +
            '.setup-pop.is-next .setup-pop-ico{color:#10b981;background:rgba(16,185,129,.15)}' +
            '.setup-pop h3{margin:0 0 3px;font-size:1.02rem;line-height:1.25;font-weight:700;color:var(--text-primary,#e8ecf4)}' +
            '.setup-pop-head p{margin:0;font-size:.8rem;line-height:1.45;color:var(--text-secondary,#8892a8)}' +
            '.setup-pop-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}' +
            '.setup-pop-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:var(--bg-card,rgba(255,255,255,.04));border:1px solid var(--border-subtle,rgba(255,255,255,.07))}' +
            '.setup-pop-item>i{flex:none;width:18px;text-align:center;color:#3b82f6;font-size:.9rem}' +
            '.setup-pop-item.is-done>i{color:#10b981}' +
            '.setup-pop-txt{flex:1;min-width:0}' +
            '.setup-pop-txt b{display:block;font-size:.84rem;font-weight:700;line-height:1.3}' +
            '.setup-pop-txt span{display:block;margin-top:1px;font-size:.74rem;line-height:1.35;color:var(--text-secondary,#8892a8)}' +
            '.setup-pop-go{flex:none;display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9px;font-size:.78rem;font-weight:700;text-decoration:none;color:#fff;background:linear-gradient(135deg,#3b82f6,#6366f1)}' +
            '.setup-pop-go:hover{filter:brightness(1.08)}' +
            '.setup-pop-done{flex:none;font-size:.72rem;font-weight:800;color:#10b981}' +
            '.setup-pop-foot{margin:10px 2px 0;font-size:.72rem;color:var(--text-muted,#556178)}' +
            '@keyframes setupPopFade{from{opacity:0}to{opacity:1}}' +
            '@media (max-width:480px){.setup-pop-item{flex-wrap:wrap}.setup-pop-go{width:100%;justify-content:center}}' +
            '@media (prefers-reduced-motion:reduce){.setup-pop-overlay{animation:none}}';
        document.head.appendChild(st);
    }

    function itemRow(s) {
        return '<li class="setup-pop-item' + (s.done ? ' is-done' : '') + '">' +
            '<i class="fas ' + (s.done ? 'fa-circle-check' : s.icon) + '"></i>' +
            '<div class="setup-pop-txt"><b>' + esc(s.title) + '</b><span>' + esc(s.text) + '</span></div>' +
            (s.done ? '<span class="setup-pop-done">Done</span>' : '<a class="setup-pop-go" href="' + esc(s.href) + '">' + esc(s.cta) + ' <i class="fas fa-arrow-right"></i></a>') +
            '</li>';
    }

    var prevFocus = null, currentKind = null;
    function closePop() {
        var el = document.getElementById('setup-pop-overlay');
        if (el) el.remove();
        document.removeEventListener('keydown', onKey, true);
        if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* ignore */ } }
        prevFocus = null;
    }
    // X, Esc and a click outside all do the same: close, and keep the auto-popup quiet for the rest of this tab session
    function dismissPop() { if (currentKind) hideFor(currentKind); closePop(); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); dismissPop(); } }

    /** kind: 'required' | 'admission' | 'next' */
    function openPop(model, kind) {
        injectStyles();
        closePop();
        var rows, title, text, cls = 'setup-pop', icon = 'fa-triangle-exclamation', foot = '';
        if (kind === 'next') {
            rows = model.extras.filter(function (e) { return !e.done; });
            title = 'A few things left to do'; text = 'Session and classes are ready. These are optional but recommended.';
            cls += ' is-next'; icon = 'fa-circle-check';
        } else {
            rows = model.steps;
            if (kind === 'admission') { title = 'Set up before admitting students'; text = 'New admissions need a current session and at least one class.'; }
            else { title = 'Finish setting up your school'; text = 'Two quick steps are needed before fees, attendance and results work.'; }
            foot = 'This message goes away once both steps are done.';
        }
        var overlay = document.createElement('div');
        overlay.id = 'setup-pop-overlay';
        overlay.className = 'setup-pop-overlay';
        overlay.innerHTML =
            '<div class="' + cls + '" role="dialog" aria-modal="true" aria-labelledby="setup-pop-title">' +
            '<button type="button" class="setup-pop-x" aria-label="Close" title="Close">&times;</button>' +
            '<div class="setup-pop-head"><span class="setup-pop-ico"><i class="fas ' + icon + '"></i></span>' +
            '<div><h3 id="setup-pop-title">' + esc(title) + '</h3><p>' + esc(text) + '</p></div></div>' +
            '<ul class="setup-pop-list">' + rows.map(itemRow).join('') + '</ul>' +
            (foot ? '<p class="setup-pop-foot">' + esc(foot) + '</p>' : '') + '</div>';
        overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) dismissPop(); });
        overlay.querySelector('.setup-pop-x').addEventListener('click', dismissPop);
        currentKind = kind;
        prevFocus = document.activeElement;
        document.body.appendChild(overlay);
        document.addEventListener('keydown', onKey, true);
        var first = overlay.querySelector('.setup-pop-go') || overlay.querySelector('.setup-pop-x');
        if (first && first.focus) first.focus();
    }
    // Hidden state only affects the AUTO popup. Pressing "New Admission" while setup is missing always shows it again.
    function hideKey(kind) { return 'softschool-setup-hidden:' + kind + ':' + schoolId() + ':' + new Date().toDateString(); }
    function isHidden(kind) { try { return sessionStorage.getItem(hideKey(kind)) === '1'; } catch (e) { return false; } }
    function hideFor(kind) { try { sessionStorage.setItem(hideKey(kind), '1'); } catch (e) { /* ignore */ } }

    /* --------------------------------------------------------------- auto-show */
    function autoShow(model) {
        if (!model) return;
        if (!model.requiredDone) {
            var kind = IS_ADMISSION ? 'admission' : 'required';
            if (!isHidden(kind)) {
                openPop(model, kind);
            }
            return;
        }
        if (IS_DASHBOARD && !isHidden('next')) {
            var todo = model.extras.filter(function (e) { return !e.done; });
            if (todo.length) openPop(model, 'next');
        }
    }

    function run(force) {
        return evaluate(force).then(function (m) { autoShow(m); return m; })
            .catch(function (e) { console.warn('[setup-check] skipped:', e && e.message ? e.message : e); });
    }

    /** Called by manage-students.js before the admission form opens. Returns true when it was blocked (popup shown). */
    function blockAdmission() {
        if (lastModel && !lastModel.requiredDone) { openPop(lastModel, 'admission'); return true; }
        return false;
    }

    window.SoftSchoolSetupCheck = { run: run, evaluate: evaluate, blockAdmission: blockAdmission, close: dismissPop };

    /* Wait until the page's own requests have started, then check when the browser is idle. */
    var scheduled = false;
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        var go = function () { run(false); };
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 4000 });
        else setTimeout(go, 1500);
    }
    if (!IS_DASHBOARD && !IS_ADMISSION) return;
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule);
    // coming back with the browser's back button: re-check only if the school was not fully set up
    window.addEventListener('pageshow', function (e) { if (e.persisted && !readOk()) run(true); });
})();
