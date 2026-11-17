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

  function say(text, bad) {
    const el = $('wa-msg'); if (!el) return;
    el.textContent = text || ''; el.style.color = bad ? '#e5484d' : '';
    if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 6000);
  }

  const LABEL = {
    connected: 'Connected', connecting: 'Connecting…', qr: 'Waiting for scan', pairing: 'Waiting for code entry',
    disconnected: 'Not connected', service_down: 'WhatsApp service is offline', not_configured: 'Not set up on the server yet',
  };

  function render(st) {
    const state = st.state || 'disconnected';
    $('wa-state').textContent = LABEL[state] || state;
    $('wa-number').textContent = st.number ? '+' + st.number : '';
    const connected = state === 'connected';
    $('wa-conn-box').style.display = connected ? '' : 'none';
    $('wa-link-box').style.display = connected ? 'none' : '';
    const unavailable = state === 'service_down' || state === 'not_configured';
    $('wa-qr-btn').disabled = unavailable;

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
    catch (e) { $('wa-state').textContent = 'Could not reach server'; }
  }

  window.waOnOpen = function () { poll(); clearInterval(timer); timer = setInterval(poll, 2500); };
  window.waOnClose = function () { clearInterval(timer); timer = null; };

  window.waConnect = async function (usePhone) {
    try {
      const body = {};
      if (usePhone) {
        const p = $('wa-phone').value.trim();
        if (p.replace(/\D/g, '').length < 10) return say('Enter the full WhatsApp number first.', true);
        body.phone = p;
      }
      render(await call('/connect', { method: 'POST', body: JSON.stringify(body) }));
    } catch (e) { say(e.message, true); }
  };

  window.waSaveConfig = async function () {
    try {
      await call('/config', { method: 'PUT', body: JSON.stringify({
        enabled: $('wa-enabled').checked, notifyAbsent: $('wa-absent').checked, notifyFeePaid: $('wa-fee').checked,
        absentTemplate: $('wa-absent-tpl').value, feeTemplate: $('wa-fee-tpl').value,
      }) });
      say('Saved ✓');
    } catch (e) { say(e.message, true); }
  };

  window.waSendTest = async function () {
    const phone = $('wa-test-phone').value.trim();
    if (!phone) return say('Enter a number to send the test to.', true);
    try { await call('/test', { method: 'POST', body: JSON.stringify({ phone }) }); say('Test queued ✓ — check WhatsApp'); }
    catch (e) { say(e.message, true); }
  };

  window.waBroadcast = async function () {
    const text = $('wa-bc-text').value.trim();
    if (!text) return say('Write the message first.', true);
    const cls = $('wa-bc-class').value.trim();
    if (!confirm('Send this message to parents of ' + (cls ? 'class ' + cls : 'ALL students') + '?')) return;
    try {
      const r = await call('/broadcast', { method: 'POST', body: JSON.stringify({
        text, className: cls, section: $('wa-bc-section').value.trim() }) });
      say('Queued ' + r.queued + ' messages' + (r.studentsWithoutNumber ? ' (' + r.studentsWithoutNumber + ' students have no number)' : ''));
    } catch (e) { say(e.message, true); }
  };

  window.waLogout = async function () {
    if (!confirm('Disconnect this WhatsApp number? Automatic messages will stop until you link again.')) return;
    try { await call('/logout', { method: 'POST', body: '{}' }); cfgLoaded = false; poll(); }
    catch (e) { say(e.message, true); }
  };
})();
