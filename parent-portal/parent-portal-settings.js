// Parent Portal – Settings page script (language only)
// The choice is saved by parent-portal-i18n.js and is used by the home
// page and side panel the next time they load.
(function () {
  'use strict';

  const I18n = window.PortalI18n;
  if (!I18n) return;

  I18n.apply();

  const toast = document.getElementById('toast');
  let toastTimer;

  function showToast() {
    clearTimeout(toastTimer);
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
  }

  const radios = document.querySelectorAll('input[name="language"]');

  radios.forEach((radio) => {
    radio.checked = radio.value === I18n.getLang();
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      I18n.setLang(radio.value);   // saves + re-translates this page
      showToast();
    });
  });
})();