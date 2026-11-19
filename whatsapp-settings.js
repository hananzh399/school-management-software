/* Settings > WhatsApp tab. Talks to /api/whatsapp/* on the backend (school comes from the signed session). */
(function () {
  const API = 'https://167-86-120-247.sslip.io/api/whatsapp';
  const $ = (id) => document.getElementById(id);
  let timer = null;
  let cfgLoaded = false;

  // ---- Super-admin ban ----------------------------------------------------------------
  // The super admin can ban WhatsApp for one school or for a whole plan. A banned school does not
  // see the WhatsApp tab in Settings at all (the server refuses /api/whatsapp/* for it too).
  const SSA = () => window.SoftSchoolAdmin;
  const isBanned = () => {
    const a = SSA();
    return !!(a && a.isWhatsAppBanned && a.getCurrentSchool && a.isWhatsAppBanned(a.getCurrentSchool()));
  };

  /** Hides (or restores) the WhatsApp tab button and panel. */
  function applyBan(on) {
    const btn = $('tab-btn-whatsapp'), panel = $('tab-whatsapp');
    if (btn) btn.style.setProperty('display', on ? 'none' : '', on ? 'important' : '');
    if (panel) {
      panel.style.setProperty('display', on ? 'none' : '', on ? 'important' : '');
      if (on) panel.classList.remove('active');
    }
    if (on) {
      clearInterval(timer); timer = null;
      // Was the person looking at the WhatsApp tab? Send them to the first visible tab instead.
      if (btn && btn.classList.contains('active')) {
        btn.classList.remove('active');
        const first = Array.from(document.querySelectorAll('.tab-btn')).find((b) => b !== btn && b.style.display !== 'none');
        if (first) first.click();
      }
    }
  }

  /** Remembers the lock in the cached session so other pages / the next load hide it immediately. */
  function rememberBan(on) {
    const a = SSA(); if (!a || !a.getCurrentSchool || !a.setSession) return;
    const cur = a.getCurrentSchool(); if (!cur || !on || a.isWhatsAppBanned(cur)) return;
    const locks = Array.isArray(cur.locks) ? cur.locks.slice() : String(cur.locks || '').split(',').map((x) => x.trim()).filter(Boolean);
    locks.push('whatsapp');
    a.setSession(Object.assign({}, cur, { locks: Array.isArray(cur.locks) ? locks : locks.join(',') }));
  }

  /** Refuse to open the tab while banned (covers the #whatsapp deep link and any stale button). */
  const baseSwitchTab = window.switchTab;
  if (typeof baseSwitchTab === 'function') {
    window.switchTab = function (name, btn) {
      if (name === 'whatsapp' && isBanned()) { applyBan(true); return; }
      return baseSwitchTab.apply(this, arguments);
    };
  }

  const refreshBan = () => applyBan(isBanned());
  refreshBan();                                                   // this script sits at the end of <body>, so the tab already exists
  document.addEventListener('DOMContentLoaded', refreshBan);      // ...and once more in case it was loaded early
  window.addEventListener('softschool:session-updated', refreshBan);   // fresh school record arrived (ban added or lifted)

  async function call(path, opts = {}) {
    const res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => ({})) : {};
    if (res.status === 403 && data.code === 'whatsapp_banned') { rememberBan(true); applyBan(true); }
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }

  /** Shows a short result next to the button that was clicked (target = id of that card's status span). */
  function say(target, text, bad) {
    const el = $(target); if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('wa-err', !!bad);
    if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 6000);
  }

  const LABEL = {
    connected: 'Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…', qr: 'Waiting for scan',
    pairing: 'Waiting for code', disconnected: 'Not connected', service_down: 'Service offline',
    not_configured: 'Not set up on server',
  };
  const TONE = { connected: 'wa-on', connecting: 'wa-wait', reconnecting: 'wa-wait', qr: 'wa-wait', pairing: 'wa-wait' };

  // A linked number can drop for a few seconds (network blip, WhatsApp asking for a restart) and then
  // come straight back. Keep showing the "connected" screen for that short window instead of flipping
  // to the QR / link screen and back, which looked like the connection was constantly resetting.
  const RECONNECT_GRACE_MS = 45000;
  let lastConnectedAt = 0;

  // ---- Fee reminder schedule (before / on / after the due date) ----
  const BEFORE_DAYS = [1, 2, 3, 5, 7];
  const AFTER_DAYS = [1, 2, 3, 5, 7, 10];

  function buildDayChips(boxId, days, kind) {
    const box = $(boxId); if (!box || box.childElementCount) return;
    box.innerHTML = days.map((d) =>
      '<label class="wa-chip"><input type="checkbox" data-rem="' + kind + '" value="' + d + '"> ' + d + (d === 1 ? ' day' : ' days') + '</label>').join('');
  }
  const pickedDays = (kind) =>
    Array.from(document.querySelectorAll('input[data-rem="' + kind + '"]:checked')).map((i) => i.value).join(',');
  function setPickedDays(kind, csv) {
    const set = new Set(String(csv || '').split(',').map((x) => x.trim()).filter(Boolean));
    document.querySelectorAll('input[data-rem="' + kind + '"]').forEach((i) => { i.checked = set.has(i.value); });
  }
  function syncReminderUi() {
    const on = $('wa-reminder').checked;
    $('wa-rem-opts').style.display = on ? '' : 'none';
    $('wa-rem-before-box').style.display = on && $('wa-rem-before').checked ? '' : 'none';
    $('wa-rem-after-box').style.display = on && $('wa-rem-after').checked ? '' : 'none';
  }
  document.addEventListener('change', (e) => {
    if (['wa-reminder', 'wa-rem-before', 'wa-rem-after'].includes(e.target && e.target.id)) syncReminderUi();
  });

  function render(st) {
    if (st && st.banned) { rememberBan(true); applyBan(true); return; }   // banned since this page loaded
    const rawState = st.state || 'disconnected';
    if (rawState === 'connected') lastConnectedAt = Date.now();
    const blip = rawState === 'connecting' && lastConnectedAt && (Date.now() - lastConnectedAt) < RECONNECT_GRACE_MS;
    const state = blip ? 'reconnecting' : rawState;
    if (rawState === 'disconnected' || rawState === 'qr' || rawState === 'pairing') lastConnectedAt = 0;

    const pill = $('wa-state');
    pill.textContent = LABEL[state] || state;
    pill.className = 'wa-pill ' + (TONE[state] || 'wa-off');
    $('wa-number').textContent = st.number ? '+' + st.number : '';

    const connected = state === 'connected' || state === 'reconnecting';
    $('wa-conn-box').style.display = connected ? '' : 'none';
    $('wa-link-box').style.display = connected ? 'none' : '';
    $('wa-disconnect-btn').style.display = connected ? '' : 'none';
    $('wa-qr-btn').disabled = state === 'service_down' || state === 'not_configured';

    const qr = state === 'qr' && st.qr;
    $('wa-qr-wrap').style.display = qr ? '' : 'none';
    if (qr) $('wa-qr-img').src = st.qr;
    const code = state === 'pairing' && st.pairingCode;
    $('wa-code-wrap').style.display = code ? '' : 'none';
    if (code) $('wa-code').textContent = String(st.pairingCode).replace(/(.{4})(.{4})/, '$1-$2');

    if (connected) renderQueue(st);

    if (connected && st.config && !cfgLoaded) {
      cfgLoaded = true;
      $('wa-limit').value = st.config.dailyLimit || '';
      $('wa-enabled').checked = !!st.config.enabled;
      $('wa-absent').checked = st.config.notifyAbsent !== false;
      $('wa-voucher').checked = !!st.config.notifyVoucher;
      $('wa-reminder').checked = !!st.config.notifyReminder;
      buildDayChips('wa-rem-before-days', BEFORE_DAYS, 'before');
      buildDayChips('wa-rem-after-days', AFTER_DAYS, 'after');
      setPickedDays('before', st.config.reminderBeforeDays);
      setPickedDays('after', st.config.reminderAfterDays);
      $('wa-rem-before').checked = !!String(st.config.reminderBeforeDays || '').trim();
      $('wa-rem-after').checked = !!String(st.config.reminderAfterDays || '').trim();
      $('wa-rem-on').checked = !!st.config.reminderOnDue;
      syncReminderUi();
      $('wa-absent-tpl').value = st.config.absentTemplate || '';
      $('wa-voucher-tpl').value = st.config.voucherTemplate || '';
      $('wa-reminder-tpl').value = st.config.reminderTemplate || '';
    }
    if (!connected) cfgLoaded = false;
  }

  const WAIT_WHY = {
    cooldown: 'resting between batches', busy: 'sending', daily_limit: "today's limit reached",
    errors: 'paused after errors',
  };

  /** One line under the limit field: how much was sent, what is waiting and why, and when it will be done. */
  function renderQueue(st) {
    const el = $('wa-queue-info'); if (!el) return;
    if (typeof st.sentToday !== 'number') { el.textContent = ''; return; }
    let t = st.dailyLimit ? 'Today: ' + st.sentToday + ' of ' + st.dailyLimit + ' sent' : 'Today: ' + st.sentToday + ' sent (no daily limit set)';
    if (st.queued) {
      t += ' · ' + st.queued + ' waiting in queue (about ' + (st.etaMinutes >= 90 ? Math.round(st.etaMinutes / 60) + ' hours' : st.etaMinutes + ' min') + ')';
      const w = st.waiting;
      if (w) t += ' — ' + (WAIT_WHY[w] || w);
    }
    el.textContent = t;
  }

  async function poll() {
    try { render(await call('/status')); }
    catch (e) {
      const pill = $('wa-state');
      pill.textContent = 'Could not reach server'; pill.className = 'wa-pill wa-off';
    }
  }

  window.waOnOpen = function () { if (isBanned()) { applyBan(true); return; } poll(); clearInterval(timer); timer = setInterval(poll, 2500); };
  window.waOnClose = function () { clearInterval(timer); timer = null; };

  window.waConnect = async function (usePhone) {
    try {
      const body = {};
      if (usePhone) {
        const p = $('wa-phone').value.trim();
        if (p.replace(/\D/g, '').length < 10) return say('wa-conn-msg', 'Enter the full WhatsApp number first.', true);
        body.phone = p;
      }
      render(await call('/connect', { method: 'POST', body: JSON.stringify(body) }));
    } catch (e) { say('wa-conn-msg', e.message, true); }
  };

  window.waSaveConfig = async function () {
    try {
      const remOn = $('wa-reminder').checked;
      const useBefore = $('wa-rem-before').checked, useAfter = $('wa-rem-after').checked;
      const before = useBefore ? pickedDays('before') : '';
      const after = useAfter ? pickedDays('after') : '';
      if (remOn) {
        if (useBefore && !before) return say('wa-msg', 'Pick how many days before the due date.', true);
        if (useAfter && !after) return say('wa-msg', 'Pick how many days after the due date.', true);
        if (!before && !after && !$('wa-rem-on').checked) return say('wa-msg', 'Choose when to send fee reminders (before, on or after the due date).', true);
      }
      await call('/config', { method: 'PUT', body: JSON.stringify({
        enabled: $('wa-enabled').checked, notifyAbsent: $('wa-absent').checked,
        dailyLimit: parseInt($('wa-limit').value, 10) || 0,
        notifyVoucher: $('wa-voucher').checked, notifyReminder: remOn,
        reminderBeforeDays: before, reminderAfterDays: after, reminderOnDue: remOn && $('wa-rem-on').checked,
        absentTemplate: $('wa-absent-tpl').value,
        voucherTemplate: $('wa-voucher-tpl').value, reminderTemplate: $('wa-reminder-tpl').value,
      }) });
      say('wa-msg', 'Saved ✓');
    } catch (e) { say('wa-msg', e.message, true); }
  };

  window.waSendTest = async function () {
    const phone = $('wa-test-phone').value.trim();
    if (!phone) return say('wa-test-msg', 'Enter a number to send the test to.', true);
    try { const r = await call('/test', { method: 'POST', body: JSON.stringify({ phone }) }); say('wa-test-msg', r.sent ? 'Test sent ✓ — check WhatsApp' : 'Test accepted ✓ — waiting in queue, it will arrive shortly'); }
    catch (e) { say('wa-test-msg', e.message, true); }
  };

  window.waLogout = async function () {
    if (!confirm('Disconnect this WhatsApp number? Automatic messages will stop until you link again.')) return;
    try { await call('/logout', { method: 'POST', body: '{}' }); cfgLoaded = false; poll(); }
    catch (e) { say('wa-conn-msg', e.message, true); }
  };
})();
