/**
 * SOFT SCHOOL - DASHBOARD SETUP CHECK
 *
 * Shows a card at the top of the dashboard until the school is ready to use.
 *
 *   REQUIRED (the dashboard stays locked until both are done):
 *     1. an academic session exists AND one is marked as current      -> sessions.html
 *     2. at least one class is set up in Settings                     -> settings.html#classes
 *
 *   RECOMMENDED (a smaller card, can be hidden for the day):
 *     3. school name + address filled in      -> settings.html#schoolinfo
 *     4. monthly fee set on every class       -> settings.html#classes
 *     5. a default teacher password is set    -> settings.html#teacherlogin
 *     6. at least one staff member added      -> manage-staff.html
 *     7. at least one student admitted        -> manage-students.html
 *
 * Safety: the lock is only applied when the server clearly says a required step is missing.
 * If a request fails (offline, token expired) nothing is locked and nothing is shown.
 *
 * Data: GET /api/sessions, GET /api/settings/{schoolId}, GET /api/settings/{schoolId}/teacher-password,
 *       GET /api/students/summary, GET /api/staff/summary   (all already exist).
 */
(function () {
    'use strict';

    var ORIGIN = (typeof window.SOFTSCHOOL_API_ORIGIN === 'string' && window.SOFTSCHOOL_API_ORIGIN.trim())
        ? window.SOFTSCHOOL_API_ORIGIN.trim().replace(/\/+$/, '')
        : 'https://167-86-120-247.sslip.io';

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
        return fetch(url, { headers: headers }).then(function (r) {
            if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status);
            return r.json();
        });
    }
    function list(d) { return Array.isArray(d) ? d : (d && (d.items || d.content || d.data)) || []; }
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    /* ------------------------------------------------------------------ checks */
    function evaluate() {
        var id = schoolId();
        if (!id) return Promise.reject(new Error('not signed in'));

        // 1) the two REQUIRED things: both must load, otherwise we do not judge
        return Promise.all([get('/api/sessions', true), get('/api/settings/' + encodeURIComponent(id), false)]).then(function (r) {
            var sessions = list(r[0]), settings = r[1] || {};
            var classes = (settings.classes || []).filter(function (c) { return c && String(c.className || '').trim(); });
            var hasSession = sessions.length > 0, hasCurrent = sessions.some(function (s) { return s && s.currentSession; });

            var steps = [
                {
                    key: 'session', required: true, done: hasSession && hasCurrent, icon: 'fa-calendar-check',
                    title: hasSession && !hasCurrent ? 'Choose your current session' : 'Set your academic session',
                    text: hasSession && !hasCurrent
                        ? 'You have created a session, but none is marked as current. Open Sessions and press “Set as current”.'
                        : 'Create the session your school is running now (for example April 2026 – March 2027) and mark it as current. Fees, results and reports follow it.',
                    cta: hasSession && !hasCurrent ? 'Open Sessions' : 'Set session',
                    href: hasSession && !hasCurrent ? 'sessions.html' : 'sessions.html#new'
                },
                {
                    key: 'classes', required: true, done: classes.length > 0, icon: 'fa-layer-group',
                    title: 'Set up your classes in Settings',
                    text: 'Add each class (Nursery, One, Two …) with its sections and monthly fee. Admissions, attendance, fees and exams all depend on it.',
                    cta: 'Set classes', href: 'settings.html#classes'
                }
            ];
            var requiredDone = steps.every(function (s) { return s.done; });
            var model = { steps: steps, requiredDone: requiredDone, extras: [] };

            if (!requiredDone) return model;   // no point loading the rest yet

            // 2) RECOMMENDED: each one is optional - a failed request simply leaves that item out
            var noFee = classes.filter(function (c) { return !(Number(c.fee) > 0); }).length;
            var infoDone = !!(String(settings.schoolName || '').trim() && String(settings.schoolAddress || '').trim());
            var extras = [
                { key: 'info', done: infoDone, icon: 'fa-school', title: 'Fill in school name and address', text: 'Printed on fee vouchers, certificates and ID cards.', cta: 'School info', href: 'settings.html#schoolinfo' },
                { key: 'fees', done: noFee === 0, icon: 'fa-money-bill-wave', title: 'Set a monthly fee for every class', text: noFee + ' class' + (noFee === 1 ? ' has' : 'es have') + ' no fee yet, so new admissions would be charged nothing.', cta: 'Set fees', href: 'settings.html#classes' }
            ];
            var optional = [
                get('/api/settings/' + encodeURIComponent(id) + '/teacher-password', false).then(function (d) {
                    extras.push({ key: 'teacherpw', done: !!(d && d.set), icon: 'fa-key', title: 'Set the default teacher password', text: 'Teachers cannot sign in to the Teacher Portal until you set one.', cta: 'Teacher login', href: 'settings.html#teacherlogin' });
                }),
                get('/api/staff/summary', true).then(function (d) {
                    extras.push({ key: 'staff', done: list(d).length > 0, icon: 'fa-chalkboard-user', title: 'Add your teachers and staff', text: 'Needed for salaries, staff attendance and the Teacher Portal.', cta: 'Add staff', href: 'manage-staff.html' });
                }),
                get('/api/students/summary', true).then(function (d) {
                    extras.push({ key: 'students', done: list(d).length > 0, icon: 'fa-user-graduate', title: 'Admit your first students', text: 'Fees, attendance, results and the Parent Portal all start from students.', cta: 'Add students', href: 'manage-students.html' });
                })
            ].map(function (p) { return p.catch(function (e) { console.warn('[setup-check] optional check skipped', e); }); });

            return Promise.all(optional).then(function () {
                var order = ['info', 'fees', 'teacherpw', 'staff', 'students'];
                extras.sort(function (a, b) { return order.indexOf(a.key) - order.indexOf(b.key); });
                model.extras = extras;
                return model;
            });
        });
    }

    /* ---------------------------------------------------------------------- UI */
    var HIDE_KEY = 'softschool-setup-hidden:' + new Date().toDateString();

    function ring(done, total) {
        var pct = total ? Math.round(done / total * 100) : 0, c = 2 * Math.PI * 26;
        return '<div class="setup-ring" role="img" aria-label="' + done + ' of ' + total + ' done">' +
            '<svg viewBox="0 0 64 64"><circle class="setup-ring-bg" cx="32" cy="32" r="26"></circle>' +
            '<circle class="setup-ring-fg" cx="32" cy="32" r="26" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - pct / 100)).toFixed(1) + '"></circle></svg>' +
            '<span>' + done + '/' + total + '</span></div>';
    }
    function stepRow(s, n, big) {
        return '<li class="setup-step' + (s.done ? ' is-done' : '') + (big ? ' is-big' : '') + '">' +
            '<span class="setup-step-ico"><i class="fas ' + (s.done ? 'fa-check' : s.icon) + '"></i></span>' +
            '<div class="setup-step-body"><div class="setup-step-title">' + (big ? '<em>' + n + '</em>' : '') + esc(s.title) +
            (s.required && !s.done ? '<span class="setup-tag">Required</span>' : '') + '</div><p>' + esc(s.text) + '</p></div>' +
            (s.done ? '<span class="setup-done">Done</span>' : '<a class="setup-btn' + (big ? '' : ' is-soft') + '" href="' + esc(s.href) + '">' + esc(s.cta) + ' <i class="fas fa-arrow-right"></i></a>') +
            '</li>';
    }

    function render(model) {
        var main = document.querySelector('main.main-content');
        var anchor = document.querySelector('.quick-stats-strip');
        var old = document.getElementById('setup-card');
        if (old) old.remove();
        main && main.classList.remove('setup-locked');
        if (!main || !anchor) return;

        var card = document.createElement('section');
        card.id = 'setup-card';

        if (!model.requiredDone) {
            var done = model.steps.filter(function (s) { return s.done; }).length;
            card.className = 'setup-card is-required';
            card.setAttribute('role', 'alert');
            card.innerHTML =
                '<div class="setup-head">' + ring(done, model.steps.length) +
                '<div><span class="setup-eyebrow"><i class="fas fa-lock"></i> Setup required</span>' +
                '<h2>Let’s finish setting up your school</h2>' +
                '<p>Two quick steps are needed before Soft School can track fees, attendance and results. The dashboard unlocks as soon as both are done.</p></div></div>' +
                '<ol class="setup-steps">' + model.steps.map(function (s, i) { return stepRow(s, i + 1, true); }).join('') + '</ol>' +
                '<p class="setup-foot"><i class="fas fa-circle-info"></i> This message disappears automatically once both steps are complete. You can still use the menu on the left at any time.</p>';
            anchor.parentNode.insertBefore(card, anchor);
            main.classList.add('setup-locked');
            return;
        }

        var todo = model.extras.filter(function (e) { return !e.done; });
        var hidden = false;
        try { hidden = sessionStorage.getItem(HIDE_KEY) === '1'; } catch (e) { /* ignore */ }
        if (!todo.length || hidden) return;       // everything is ready (or hidden for today)

        var total = model.extras.length, ok = total - todo.length;
        card.className = 'setup-card is-next';
        card.innerHTML =
            '<button class="setup-close" type="button" aria-label="Hide for today" title="Hide for today"><i class="fas fa-xmark"></i></button>' +
            '<div class="setup-head">' + ring(ok, total) +
            '<div><span class="setup-eyebrow is-ok"><i class="fas fa-circle-check"></i> Session and classes are ready</span>' +
            '<h2>A few things left to do next</h2><p>Finish these to get the most out of Soft School.</p></div></div>' +
            '<ul class="setup-steps">' + todo.map(function (s) { return stepRow(s, 0, false); }).join('') + '</ul>';
        anchor.parentNode.insertBefore(card, anchor);
        card.querySelector('.setup-close').addEventListener('click', function () {
            try { sessionStorage.setItem(HIDE_KEY, '1'); } catch (e) { /* ignore */ }
            card.remove();
        });
    }

    function run() {
        evaluate().then(render).catch(function (e) { console.warn('[setup-check] skipped:', e && e.message ? e.message : e); });
    }
    window.SoftSchoolSetupCheck = { run: run, evaluate: evaluate };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
    // coming back from Sessions / Settings with the browser's back button: re-check
    window.addEventListener('pageshow', function (e) { if (e.persisted) run(); });
})();
