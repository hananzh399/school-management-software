/* "Send to parents on WhatsApp" popup — Attendance report, Fee vouchers.
   Open it with  WhatsAppSend.open({kind:'attendance'|'fee', className?, section?, days?})
   or put  data-wa-send="fee"  on any button.
   Everything is limited server-side (per-send cap, cooldown, daily quota); this popup only shows those limits. */
(function () {
  const API = 'https://thesoftschool.com/api/whatsapp';
  const KINDS = {
    attendance:   { title: 'Send attendance report to parents', icon: 'fa-clipboard-check',     path: '/send/attendance',   go: 'Send report',
                    sub: 'Each parent gets a personal summary of their child\u2019s attendance.' },
    fee:          { title: 'Send fee vouchers to parents',      icon: 'fa-file-invoice-dollar', path: '/send/fee',          go: 'Send vouchers',
                    sub: 'Each parent gets the fee details and balance of their child for the month.' },
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-US');
  let S = null;       // current popup state
  let root = null;    // overlay element

  async function call(path, opts) {
    const res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...(opts || {}) });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => ({})) : {};
    if (!res.ok) throw new Error(data.error || (res.status === 403 ? 'Only the school admin can send WhatsApp messages.' : 'Request failed (' + res.status + ')'));
    return data;
  }

  // ───────────────────────── open / close ─────────────────────────
  function open(opts) {
    opts = opts || {};
    // The super admin can ban WhatsApp for a school or its plan: no popup, no requests.
    const adm = window.SoftSchoolAdmin;
    if (adm && adm.isWhatsAppBanned && adm.getCurrentSchool && adm.isWhatsAppBanned(adm.getCurrentSchool())) {
      alert('WhatsApp messaging is not available for your school. Please contact your administrator.');
      return;
    }
    const kind = KINDS[opts.kind] ? opts.kind : 'attendance';
    close();
    const today = new Date();
    S = {
      kind, cfg: KINDS[kind], status: null, classes: [], sections: [], students: [], selected: new Set(),
      className: opts.className || '', section: opts.section || '', days: opts.days || 30,
      monthKey: today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0'),
      onlyUnpaid: true, search: '', busy: false, error: '', result: '', max: 100,
    };
    root = document.createElement('div');
    root.className = 'wsm-overlay';
    root.innerHTML = `
      <div class="wsm" role="dialog" aria-modal="true" aria-label="${esc(S.cfg.title)}">
        <div class="wsm-head">
          <div class="wsm-ico"><i class="fas ${S.cfg.icon}"></i></div>
          <div><h3 class="wsm-title">${esc(S.cfg.title)}</h3><p class="wsm-sub">${esc(S.cfg.sub)}</p></div>
          <button class="wsm-x" type="button" data-w="close" aria-label="Close"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="wsm-body" id="wsm-body"><div class="wsm-empty">Loading…</div></div>
        <div class="wsm-foot">
          <span class="wsm-msg" id="wsm-msg"></span>
          <button class="wsm-btn" type="button" data-w="close">Close</button>
          <button class="wsm-btn go" type="button" id="wsm-go" data-w="send" disabled><i class="fab fa-whatsapp"></i> <span>${esc(S.cfg.go)}</span></button>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    document.addEventListener('keydown', onKey);
    init();
  }

  function close() {
    if (!root) return;
    document.removeEventListener('keydown', onKey);
    root.remove(); root = null; S = null;
  }
  const onKey = (e) => { if (e.key === 'Escape' && S && !S.busy) close(); };

  async function init() {
    try {
      const [status, rec] = await Promise.all([call('/status'), call('/recipients')]);
      S.status = status; S.classes = rec.classes || []; S.max = rec.maxPerSend || status.maxPerSend || 100;
      if (S.className && !S.classes.includes(S.className)) S.className = '';
      renderBody();
      if (S.className) await loadStudents(true);
    } catch (e) {
      $('wsm-body').innerHTML = `<div class="wsm-alert">${esc(e.message)}</div>`;
    }
  }

  const $ = (id) => document.getElementById(id);

  // ───────────────────────── rendering ─────────────────────────
  function safeStrip() {
    const st = S.status || {};
    const chips = [];
    chips.push(`<span class="wsm-chip">Max per send <b>${S.max}</b></span>`);
    if (st.cooldownMinutes) chips.push(`<span class="wsm-chip">Gap between sends <b>${st.cooldownMinutes} min</b></span>`);
    if (st.dailyCap != null) {
      const low = (st.remainingToday || 0) < 20;
      chips.push(`<span class="wsm-chip ${low ? 'warn' : ''}">Left today <b>${st.remainingToday || 0} of ${st.dailyCap}</b></span>`);
    }
    if (st.maxBulkPerDay) chips.push(`<span class="wsm-chip">Sends today <b>${st.bulkSendsToday || 0} of ${st.maxBulkPerDay}</b></span>`);
    if (st.cooldownLeftSeconds > 0) chips.push(`<span class="wsm-chip warn">Next send in <b>${Math.ceil(st.cooldownLeftSeconds / 60)} min</b></span>`);
    let html = `<div class="wsm-safe">${chips.join('')}</div>`;
    if (!st.connected) {
      html += `<div class="wsm-alert">WhatsApp is not connected. <a href="settings.html#whatsapp">Open Settings → WhatsApp</a> to link your school number.</div>`;
    } else if (st.config && !st.config.enabled) {
      html += `<div class="wsm-alert">WhatsApp automation is switched off. <a href="settings.html#whatsapp">Turn it on in Settings → WhatsApp</a>.</div>`;
    } else {
      if (st.quietNow) html += `<div class="wsm-note">It is night time (${esc(st.quietHours || '')}). Messages are queued and sent in the morning.</div>`;
    }
    return html;
  }

  function controls() {
    const cls = S.classes.map((c) => `<option value="${esc(c)}" ${c === S.className ? 'selected' : ''}>Class ${esc(c)}</option>`).join('');
    const secs = S.sections.map((c) => `<option value="${esc(c)}" ${c === S.section ? 'selected' : ''}>Section ${esc(c)}</option>`).join('');
    let extra = '';
    if (S.kind === 'attendance') {
      const opts = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 1 year']];
      extra = `<div class="wsm-f"><label>Period</label><select id="wsm-days">${opts.map(([v, t]) => `<option value="${v}" ${+S.days === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    } else if (S.kind === 'fee') {
      extra = `<div class="wsm-f"><label>Fee month</label><input type="month" id="wsm-month" value="${esc(S.monthKey)}"></div>
               <label class="wsm-check"><input type="checkbox" id="wsm-unpaid" ${S.onlyUnpaid ? 'checked' : ''}> Only students with balance due</label>`;
    }
    return `<div class="wsm-grid">
        <div class="wsm-f"><label>Class</label><select id="wsm-class"><option value="">Choose a class…</option>${cls}</select></div>
        <div class="wsm-f"><label>Section</label><select id="wsm-section" ${S.className ? '' : 'disabled'}><option value="">All sections</option>${secs}</select></div>
        ${extra}
      </div>`;
  }

  function renderBody() {
    let html = safeStrip() + controls();
    html += `<div id="wsm-result"></div>
      <div class="wsm-tools">
        <input type="search" id="wsm-search" placeholder="Search parent / student…" autocomplete="off">
        <button class="wsm-btn" type="button" data-w="all">Select all</button>
        <button class="wsm-btn" type="button" data-w="none">Clear</button>
        <span class="wsm-count" id="wsm-count"></span>
      </div>
      <div class="wsm-list" id="wsm-list"></div>`;
    $('wsm-body').innerHTML = html;
    renderList();
  }

  function visible() {
    const q = S.search.trim().toLowerCase();
    return !q ? S.students : S.students.filter((s) => (s.name + ' ' + s.regNo).toLowerCase().includes(q));
  }

  function renderList() {
    const list = $('wsm-list');
    if (!list) return;
    if (!S.className) { list.innerHTML = '<div class="wsm-empty">Choose a class to see its parents.</div>'; }
    else if (!S.students.length) { list.innerHTML = '<div class="wsm-empty">No students found.</div>'; }
    else {
      const rows = visible().map((s) => {
        const off = !s.hasPhone;
        const bal = s.balance != null ? `<span class="wsm-bal" style="color:${s.balance > 0 ? '#f87171' : '#34d399'}">${s.balance > 0 ? money(s.balance) : 'Paid'}</span>` : '<span class="wsm-bal"></span>';
        return `<label class="wsm-row ${off ? 'off' : ''}">
            <input type="checkbox" data-reg="${esc(s.regNo)}" ${off ? 'disabled' : ''} ${S.selected.has(s.regNo) ? 'checked' : ''}>
            <span class="wsm-nm">${esc(s.name)}<small>${esc(s.regNo)}</small></span>
            <span class="wsm-cls wsm-ph">${esc(s.className)}${s.section ? '-' + esc(s.section) : ''}</span>
            <span class="wsm-ph ${off ? 'none' : ''}">${off ? 'No WhatsApp no.' : esc(s.phone)}</span>
            ${bal}
          </label>`;
      }).join('');
      list.innerHTML = rows || '<div class="wsm-empty">No match.</div>';
    }
    updateFooter();
  }

  function updateFooter() {
    const n = S.selected.size;
    const count = $('wsm-count');
    if (count) { count.textContent = n + ' selected (max ' + S.max + ')'; count.classList.toggle('over', n > S.max); }
    const st = S.status || {};
    const ready = st.connected && (!st.config || st.config.enabled) && !(st.cooldownLeftSeconds > 0);
    const go = $('wsm-go');
    if (go) go.disabled = S.busy || !ready || n === 0 || n > S.max;
    const msg = $('wsm-msg');
    if (msg) msg.textContent = n > S.max ? 'Too many selected — send in smaller groups.' : '';
  }

  // ───────────────────────── data ─────────────────────────
  async function loadStudents(autoSelect) {
    if (!S.className) { S.students = []; S.selected.clear(); renderList(); return; }
    const qs = new URLSearchParams({ className: S.className });
    if (S.section) qs.set('section', S.section);
    if (S.kind === 'fee') qs.set('monthKey', S.monthKey);
    $('wsm-list').innerHTML = '<div class="wsm-empty">Loading…</div>';
    try {
      const rec = await call('/recipients?' + qs.toString());
      S.students = rec.students || [];
      if (!S.section) { S.sections = rec.sections || []; const el = $('wsm-section'); if (el) refreshSections(); }
      if (autoSelect) autoPick();
      else S.selected = new Set([...S.selected].filter((r) => S.students.some((s) => s.regNo === r && s.hasPhone)));
      renderList();
    } catch (e) { showError(e.message); $('wsm-list').innerHTML = ''; }
  }

  function refreshSections() {
    const el = $('wsm-section'); if (!el) return;
    el.disabled = !S.className;
    el.innerHTML = '<option value="">All sections</option>' + S.sections.map((c) => `<option value="${esc(c)}" ${c === S.section ? 'selected' : ''}>Section ${esc(c)}</option>`).join('');
  }

  /** Pre-tick everyone who can be messaged (and, for fees, who owes money) up to the per-send limit. */
  function autoPick() {
    S.selected = new Set();
    for (const s of S.students) {
      if (!s.hasPhone || S.selected.size >= S.max) continue;
      if (S.kind === 'fee' && S.onlyUnpaid && s.balance != null && s.balance <= 0) continue;
      S.selected.add(s.regNo);
    }
  }

  function showError(msg) { const r = $('wsm-result'); if (r) r.innerHTML = msg ? `<div class="wsm-alert">${esc(msg)}</div>` : ''; }

  // ───────────────────────── events ─────────────────────────
  function onClick(e) {
    if (e.target === root && !S.busy) return close();
    const b = e.target.closest('[data-w]'); if (!b) return;
    const w = b.dataset.w;
    if (w === 'close' && !S.busy) close();
    else if (w === 'all') { visible().forEach((s) => { if (s.hasPhone && S.selected.size < S.max) S.selected.add(s.regNo); }); renderList(); if (visible().filter((s) => s.hasPhone).length > S.max) showError('Only ' + S.max + ' parents can be messaged at one time. The rest can be sent later.'); }
    else if (w === 'none') { S.selected.clear(); renderList(); }
    else if (w === 'send') send();
  }

  function onInput(e) {
    const t = e.target;
    // text boxes react while typing; selects, checkboxes and the month picker only on "change" (they fire both events)
    const typing = t.id === 'wsm-search';
    if (typing !== (e.type === 'input')) return;
    if (t.dataset && t.dataset.reg) {
      if (t.checked) { if (S.selected.size >= S.max) { t.checked = false; return showError('Only ' + S.max + ' parents can be messaged at one time.'); } S.selected.add(t.dataset.reg); }
      else S.selected.delete(t.dataset.reg);
      showError(''); return updateFooter();
    }
    switch (t.id) {
      case 'wsm-class': S.className = t.value; S.section = ''; S.sections = []; S.result = ''; showError(''); refreshSections(); loadStudents(true); break;
      case 'wsm-section': S.section = t.value; loadStudents(true); break;
      case 'wsm-days': S.days = +t.value; break;
      case 'wsm-month': if (t.value) { S.monthKey = t.value; loadStudents(true); } break;
      case 'wsm-unpaid': S.onlyUnpaid = t.checked; autoPick(); renderList(); break;
      case 'wsm-search': S.search = t.value; renderList(); break;
      default: break;
    }
  }

  // ───────────────────────── send ─────────────────────────
  async function send() {
    const n = S.selected.size;
    if (!n || S.busy) return;
    const eta = Math.max(1, Math.ceil(n * 11 / 60));
    if (!confirm(`Send to ${n} parent${n > 1 ? 's' : ''} on WhatsApp?\n\nMessages are delivered slowly (about ${eta} min) to protect your number.`)) return;
    const body = { className: S.className, section: S.section, regNos: [...S.selected] };
    if (S.kind === 'attendance') body.days = S.days;
    if (S.kind === 'fee') { body.monthKey = S.monthKey; body.onlyUnpaid = S.onlyUnpaid; }
    S.busy = true; showError(''); updateFooter();
    $('wsm-go').querySelector('span').textContent = 'Sending…';
    try {
      const r = await call(S.cfg.path, { method: 'POST', body: JSON.stringify(body) });
      showResult(r);
      S.selected.clear(); renderList();
      S.status = await call('/status').catch(() => S.status);
      const strip = document.querySelector('#wsm-body .wsm-safe');
      if (strip) { const tmp = document.createElement('div'); tmp.innerHTML = safeStrip(); strip.replaceWith(tmp.firstChild); }
    } catch (e) { showError(e.message); }
    S.busy = false;
    const go = $('wsm-go'); if (go) go.querySelector('span').textContent = S.cfg.go;
    updateFooter();
  }

  function showResult(r) {
    const notes = [];
    if (r.noPhone) notes.push(r.noPhone + ' without a WhatsApp number');
    if (r.invalidNumber) notes.push(r.invalidNumber + ' with an invalid WhatsApp number');
    if (r.alreadySent) notes.push(r.alreadySent + ' already received this');
    const sk = r.skipped || {};
    if (sk.noRecords) notes.push(sk.noRecords + ' with no attendance records');
    if (sk.noVoucher) notes.push(sk.noVoucher + ' with no fee voucher for this month');
    if (sk.alreadyPaid) notes.push(sk.alreadyPaid + ' already paid');
    const skipped = notes.length ? `<br><small>Skipped: ${esc(notes.join(', '))}.</small>` : '';
    const box = $('wsm-result');
    if (!box) return;
    if (!r.queued) { box.innerHTML = `<div class="wsm-note">Nothing was sent.${skipped}</div>`; return; }
    const night = r.quietNow ? ' It is night time, so sending starts in the morning.' : '';
    box.innerHTML = `<div class="wsm-okbox"><b>${SSX.esc(r.queued)} message${r.queued > 1 ? 's' : ''} queued.</b> They are delivered one by one, about ${r.etaMinutes || 1} min in total.${night}${skipped}</div>`;
  }

  // declarative buttons: <button data-wa-send="fee">
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-wa-send]');
    if (t) { e.preventDefault(); open({ kind: t.getAttribute('data-wa-send') }); }
  });

  window.WhatsAppSend = { open, close };
})();
