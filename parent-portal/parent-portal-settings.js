// Parent Portal – Settings page script: language + change password.
// The language choice is saved by parent-portal-i18n.js and is used by the home page and side panel
// the next time they load. The password form talks to POST /api/parent/change-password.
(function () {
  'use strict';

  const I18n = window.PortalI18n;
  if (!I18n) return;

  I18n.apply();
  const ti = (key) => I18n.ti(key);
  const tr = (key) => I18n.t(key);

  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');
  let toastTimer;

  function showToast(text) {
    if (text) toastText.textContent = text;
    clearTimeout(toastTimer);
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  // ---------- Language ----------
  document.querySelectorAll('input[name="language"]').forEach((radio) => {
    radio.checked = radio.value === I18n.getLang();
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      I18n.setLang(radio.value);   // saves + re-translates this page
      showToast(ti('saved'));
    });
  });

  // ---------- Change password ----------
  const form = document.getElementById('pwForm');
  const openBtn = document.getElementById('pwOpenBtn');
  const cancelBtn = document.getElementById('pwCancel');
  const submitBtn = document.getElementById('pwSubmit');
  const submitText = document.getElementById('pwSubmitText');
  const formError = document.getElementById('pwFormError');
  const inputs = {
    oldPassword: document.getElementById('oldPassword'),
    newPassword: document.getElementById('newPassword'),
    confirmPassword: document.getElementById('confirmPassword')
  };

  function setError(name, message) {
    const field = document.getElementById('field-' + name);
    field.classList.toggle('has-error', !!message);
    document.getElementById('error-' + name).textContent = message || '';
    return !message;
  }

  function validateOld() {
    const v = inputs.oldPassword.value;
    if (!v) return setError('oldPassword', ti('cpErrOldEmpty'));
    if (!/^\d{7}$/.test(v)) return setError('oldPassword', ti('cpErrOld7'));
    return setError('oldPassword', '');
  }
  function validateNew() {
    const v = inputs.newPassword.value;
    if (!v) return setError('newPassword', ti('cpErrNewEmpty'));
    if (!/^\d{7}$/.test(v)) return setError('newPassword', ti('cpErrNew7'));
    if (v === inputs.oldPassword.value) return setError('newPassword', ti('cpErrNewSame'));
    return setError('newPassword', '');
  }
  function validateConfirm() {
    const v = inputs.confirmPassword.value;
    if (!v) return setError('confirmPassword', ti('cpErrConfirmEmpty'));
    if (v !== inputs.newPassword.value) return setError('confirmPassword', ti('cpErrConfirmMismatch'));
    return setError('confirmPassword', '');
  }

  function resetForm() {
    form.reset();
    formError.classList.remove('show');
    Object.keys(inputs).forEach((n) => {
      inputs[n].type = 'password';
      setError(n, '');
    });
    form.querySelectorAll('.st-eye').forEach((b) => b.classList.remove('showing'));
  }
  function setOpen(open) {
    form.hidden = !open;
    openBtn.hidden = open;
    if (open) inputs.oldPassword.focus(); else resetForm();
  }

  openBtn.addEventListener('click', () => setOpen(true));
  cancelBtn.addEventListener('click', () => setOpen(false));

  // digits only, max 7
  Object.keys(inputs).forEach((n) => {
    inputs[n].addEventListener('input', () => {
      inputs[n].value = inputs[n].value.replace(/\D/g, '').slice(0, 7);
    });
  });
  inputs.oldPassword.addEventListener('blur', validateOld);
  inputs.newPassword.addEventListener('blur', validateNew);
  inputs.newPassword.addEventListener('input', () => { if (inputs.confirmPassword.value) validateConfirm(); });
  inputs.confirmPassword.addEventListener('input', validateConfirm);

  form.querySelectorAll('.st-eye').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('showing', show);
      btn.setAttribute('aria-label', tr(show ? 'cpHidePw' : 'cpShowPw'));
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formError.classList.remove('show');
    const ok = [validateOld(), validateNew(), validateConfirm()];
    if (ok.includes(false)) {
      const bad = form.querySelector('.has-error input');
      if (bad) bad.focus();
      return;
    }
    if (!window.PortalAPI) return;

    submitBtn.disabled = true;
    submitText.textContent = ti('cpUpdating');
    // No phone is sent: the server uses the phone this signed-in session belongs to.
    window.PortalAPI.post('/change-password', {
      oldPassword: inputs.oldPassword.value,
      newPassword: inputs.newPassword.value
    }).then(() => {
      setOpen(false);
      showToast(ti('cpSuccessTitle'));
    }).catch((err) => {
      formError.textContent = (err && err.message) || ti('genericError');
      formError.classList.add('show');
    }).finally(() => {
      submitBtn.disabled = false;
      submitText.textContent = ti('changePassword');
    });
  });
})();
