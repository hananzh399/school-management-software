/* Settings > WhatsApp tab. Talks to /api/whatsapp/* on the backend (school comes from the signed session). */
(function () {
  const API = 'https://167-86-120-247.sslip.io/api/whatsapp';
  const $ = (id) => document.getElementById(id);
  let timer = null;
  let cfgLoaded = false;

  async function call(path, opts = {}) {
    const res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => ({})) : {};
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

  function render(st) {
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
      $('wa-absent-tpl').value = st.config.absentTemplate || '';
      $('wa-voucher-tpl').value = st.config.voucherTemplate || '';
      $('wa-reminder-tpl').value = st.config.reminderTemplate || '';
    }
    if (!connected) cfgLoaded = false;
  }

  const WAIT_WHY = {
    cooldown: 'resting between batches', hourly_limit: 'hourly limit reached', daily_limit: "today's limit reached",
    errors: 'paused after errors',
  };

  /** One line under the limit field: how much was sent, what is waiting and why, and when it will be done. */
  function renderQueue(st) {
    const el = $('wa-queue-info'); if (!el) return;
    if (typeof st.sentToday !== 'number') { el.textContent = ''; return; }
    let t = 'Today: ' + st.sentToday + ' of ' + st.dailyLimit + ' sent · this hour: ' + (st.sentThisHour || 0) + ' of ' + st.hourlyLimit;
    if (st.warmupDay !== null && st.warmupDay !== undefined) t += ' · new number warm-up, day ' + (st.warmupDay + 1) + ' of 7 (limit rises daily)';
    if (st.queued) {
      t += ' · ' + st.queued + ' waiting in queue (about ' + (st.etaMinutes >= 90 ? Math.round(st.etaMinutes / 60) + ' hours' : st.etaMinutes + ' min') + ')';
      const w = st.waiting;
      if (w) t += ' — ' + (w === 'quiet_hours' ? 'will continue at ' + String(st.window || '').split('-')[0] : (WAIT_WHY[w] || w));
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

  window.waOnOpen = function () { poll(); clearInterval(timer); timer = setInterval(poll, 2500); };
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
      await call('/config', { method: 'PUT', body: JSON.stringify({
        enabled: $('wa-enabled').checked, notifyAbsent: $('wa-absent').checked,
        dailyLimit: parseInt($('wa-limit').value, 10) || 0,
        notifyVoucher: $('wa-voucher').checked, notifyReminder: $('wa-reminder').checked,
        absentTemplate: $('wa-absent-tpl').value,
        voucherTemplate: $('wa-voucher-tpl').value, reminderTemplate: $('wa-reminder-tpl').value,
      }) });
      say('wa-msg', 'Saved ✓');
    } catch (e) { say('wa-msg', e.message, true); }
  };

  window.waSendTest = async function () {
    const phone = $('wa-test-phone').value.trim();
    if (!phone) return say('wa-test-msg', 'Enter a number to send the test to.', true);
    try { await call('/test', { method: 'POST', body: JSON.stringify({ phone }) }); say('wa-test-msg', 'Test queued ✓ — check WhatsApp'); }
    catch (e) { say('wa-test-msg', e.message, true); }
  };

  window.waBroadcast = async function () {
    const text = $('wa-bc-text').value.trim();
    if (!text) return say('wa-bc-msg', 'Write the message first.', true);
    const cls = $('wa-bc-class').value.trim();
    if (!confirm('Send this message to parents of ' + (cls ? 'class ' + cls : 'ALL students') + '?')) return;
    try {
      const r = await call('/broadcast', { method: 'POST', body: JSON.stringify({
        text, className: cls, section: $('wa-bc-section').value.trim() }) });
      say('wa-bc-msg', 'Queued ' + r.queued + ' messages' + (r.studentsWithoutNumber ? ' (' + r.studentsWithoutNumber + ' students have no number)' : ''));
    } catch (e) { say('wa-bc-msg', e.message, true); }
  };

  window.waLogout = async function () {
    if (!confirm('Disconnect this WhatsApp number? Automatic messages will stop until you link again.')) return;
    try { await call('/logout', { method: 'POST', body: '{}' }); cfgLoaded = false; poll(); }
    catch (e) { say('wa-conn-msg', e.message, true); }
  };
})();
