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
    connected: 'Connected', connecting: 'Connecting…', qr: 'Waiting for scan', pairing: 'Waiting for code',
    disconnected: 'Not connected', service_down: 'Service offline', not_configured: 'Not set up on server',
  };
  const TONE = { connected: 'wa-on', connecting: 'wa-wait', qr: 'wa-wait', pairing: 'wa-wait' };

  function render(st) {
    const state = st.state || 'disconnected';
    const pill = $('wa-state');
    pill.textContent = LABEL[state] || state;
    pill.className = 'wa-pill ' + (TONE[state] || 'wa-off');
    $('wa-number').textContent = st.number ? '+' + st.number : '';

    const connected = state === 'connected';
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

    if (connected && st.config && !cfgLoaded) {
      cfgLoaded = true;
      $('wa-enabled').checked = !!st.config.enabled;
      $('wa-absent').checked = st.config.notifyAbsent !== false;
      $('wa-fee').checked = !!st.config.notifyFeePaid;
      $('wa-absent-tpl').value = st.config.absentTemplate || '';
      $('wa-fee-tpl').value = st.config.feeTemplate || '';
    }
    if (!connected) cfgLoaded = false;
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
        enabled: $('wa-enabled').checked, notifyAbsent: $('wa-absent').checked, notifyFeePaid: $('wa-fee').checked,
        absentTemplate: $('wa-absent-tpl').value, feeTemplate: $('wa-fee-tpl').value,
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
