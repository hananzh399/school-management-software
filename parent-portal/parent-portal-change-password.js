// Parent Portal – Change Password page script
(function () {
  'use strict';

  // ---------- Language ----------
  const I18n = window.PortalI18n;
  if (I18n) I18n.apply();
  const tr = (key) => (I18n ? I18n.t(key) : key);   // attributes
  const ti = (key) => (I18n ? I18n.ti(key) : key);  // on-screen text

  const form = document.getElementById('changePasswordForm');
  const successBox = document.getElementById('successBox');
  const formError = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');
  const submitText = document.getElementById('submitText');

  const inputs = {
    phone: document.getElementById('phone'),
    oldPassword: document.getElementById('oldPassword'),
    newPassword: document.getElementById('newPassword'),
    confirmPassword: document.getElementById('confirmPassword')
  };

  // ---------- Helpers ----------
  function setError(name, message) {
    const field = document.getElementById('field-' + name);
    const err = document.getElementById('error-' + name);
    field.classList.remove('is-valid');
    field.classList.toggle('has-error', !!message);
    err.textContent = message || '';
    return !message;
  }

  function setValid(name) {
    const field = document.getElementById('field-' + name);
    field.classList.remove('has-error');
    field.classList.add('is-valid');
    document.getElementById('error-' + name).textContent = '';
  }

  // ---------- Validators ----------
  function validatePhone() {
    const raw = inputs.phone.value.trim();
    const digits = raw.replace(/[\s\-()]/g, '');
    if (!raw) return setError('phone', ti('cpErrPhoneEmpty'));
    if (!/^\+?\d{10,15}$/.test(digits)) {
      return setError('phone', ti('cpErrPhoneInvalid'));
    }
    setValid('phone');
    return true;
  }

  function validateOld() {
    const v = inputs.oldPassword.value;
    if (!v) return setError('oldPassword', ti('cpErrOldEmpty'));
    if (!/^\d{7}$/.test(v)) {
      return setError('oldPassword', ti('cpErrOld7'));
    }
    setValid('oldPassword');
    return true;
  }

  function getRules(pw) {
    return {
      length: pw.length === 7,
      digits: pw.length > 0 && /^\d+$/.test(pw)
    };
  }

  function validateNew() {
    const pw = inputs.newPassword.value;
    const rules = getRules(pw);
    if (!pw) return setError('newPassword', ti('cpErrNewEmpty'));
    if (!rules.length || !rules.digits) {
      return setError('newPassword', ti('cpErrNew7'));
    }
    if (pw === inputs.oldPassword.value) {
      return setError('newPassword', ti('cpErrNewSame'));
    }
    setValid('newPassword');
    return true;
  }

  function validateConfirm() {
    const c = inputs.confirmPassword.value;
    if (!c) return setError('confirmPassword', ti('cpErrConfirmEmpty'));
    if (c !== inputs.newPassword.value) {
      return setError('confirmPassword', ti('cpErrConfirmMismatch'));
    }
    setValid('confirmPassword');
    return true;
  }

  // ---------- Rules checklist ----------
  function updateStrength() {
    const rules = getRules(inputs.newPassword.value);
    document.querySelectorAll('#rules li').forEach((li) => {
      li.classList.toggle('met', rules[li.dataset.rule]);
    });
  }

  // ---------- Digits only, max 7 ----------
  ['oldPassword', 'newPassword', 'confirmPassword'].forEach((name) => {
    inputs[name].addEventListener('input', () => {
      inputs[name].value = inputs[name].value.replace(/\D/g, '').slice(0, 7);
    });
  });

  // ---------- Show / hide password ----------
  document.querySelectorAll('.cp-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('showing', show);
      btn.setAttribute('aria-label', tr(show ? 'cpHidePw' : 'cpShowPw'));
    });
  });

  // ---------- Live validation ----------
  inputs.phone.addEventListener('blur', validatePhone);
  inputs.oldPassword.addEventListener('blur', validateOld);
  inputs.newPassword.addEventListener('input', () => {
    updateStrength();
    if (inputs.newPassword.value) validateNew();
    if (inputs.confirmPassword.value) validateConfirm();
  });
  inputs.newPassword.addEventListener('blur', validateNew);
  inputs.confirmPassword.addEventListener('input', validateConfirm);

  // ---------- Server call ----------
  // TODO: replace with your real API request. It should verify that the
  // phone number + old password belong to this parent account, then save
  // the new password. Resolve on success, reject with an Error(message).
  function changePasswordRequest(payload) {
    return PortalAPI.post('/change-password', {
      phone: payload.phone, oldPassword: payload.oldPassword, newPassword: payload.newPassword
    });
  }

  // ---------- Submit ----------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formError.classList.remove('show');

    const results = [validatePhone(), validateOld(), validateNew(), validateConfirm()];
    if (results.includes(false)) {
      const firstBad = form.querySelector('.has-error input');
      if (firstBad) firstBad.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    submitText.textContent = ti('cpUpdating');

    changePasswordRequest({
      phone: inputs.phone.value.trim().replace(/[\s\-()]/g, ''),
      oldPassword: inputs.oldPassword.value,
      newPassword: inputs.newPassword.value
    })
      .then(() => {
        form.style.display = 'none';
        successBox.classList.add('show');
        form.reset();
      })
      .catch((err) => {
        formError.textContent = err.message || ti('genericError');
        formError.classList.add('show');
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        submitText.textContent = ti('changePassword');
      });
  });
})();