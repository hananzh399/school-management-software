// Parent Portal – Submit Feedback page script
(function () {
  'use strict';

  // ---------- Language ----------
  const I18n = window.PortalI18n;
  if (I18n) I18n.apply();
  const tr = (key) => (I18n ? I18n.t(key) : key);   // attributes
  const ti = (key) => (I18n ? I18n.ti(key) : key);  // on-screen text
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

  const MAX_IMAGES = 3;
  const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

  const form = document.getElementById('feedbackForm');
  const formError = document.getElementById('formError');
  const successBox = document.getElementById('successBox');
  const submitBtn = document.getElementById('submitBtn');
  const submitText = document.getElementById('submitText');

  const titleEl = document.getElementById('title');
  const contentEl = document.getElementById('content');
  const countEl = document.getElementById('contentCount');
  const dropzone = document.getElementById('dropzone');
  const dropzoneText = document.getElementById('dropzoneText');
  const imageInput = document.getElementById('imageInput');
  const previews = document.getElementById('previews');

  let images = []; // File objects

  // ---------- Helpers ----------
  function setError(name, message) {
    const field = document.getElementById('field-' + name);
    field.classList.toggle('has-error', !!message);
    document.getElementById('error-' + name).textContent = message || '';
    return !message;
  }

  function getCategory() {
    const checked = form.querySelector('input[name="category"]:checked');
    return checked ? checked.value : '';
  }

  // ---------- Category → adapt wording ----------
  form.querySelectorAll('input[name="category"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      setError('category', '');
      const isBug = radio.value === 'bug';
      document.getElementById('titleLabel').textContent = ti(isBug ? 'fbBugTitle' : 'fbSuggestionTitle');
      titleEl.placeholder = ti(isBug ? 'fbBugTitlePh' : 'fbSuggestionTitlePh');
    });
  });

  titleEl.addEventListener('input', () => { if (titleEl.value.trim()) setError('title', ''); });

  contentEl.addEventListener('input', () => {
    countEl.textContent = contentEl.value.length;
    if (contentEl.value.trim().length >= 10) setError('content', '');
  });

  // ---------- Images ----------
  function renderPreviews() {
    previews.innerHTML = '';
    images.forEach((file, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'fb-thumb';

      const img = document.createElement('img');
      img.alt = fill(tr('fbAttachedAria'), { n: i + 1 });
      const url = URL.createObjectURL(file);
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fb-thumb-remove';
      btn.setAttribute('aria-label', fill(tr('fbRemoveAria'), { n: i + 1 }));
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      btn.addEventListener('click', () => {
        images.splice(i, 1);
        renderPreviews();
      });

      wrap.append(img, btn);
      previews.appendChild(wrap);
    });

    const full = images.length >= MAX_IMAGES;
    dropzone.disabled = full;
    dropzoneText.textContent = ti(full ? 'fbMaxPictures' : (images.length ? 'fbAddMore' : 'fbAddPictures'));
  }

  function addFiles(fileList) {
    setError('images', '');
    let problem = '';
    Array.from(fileList).forEach((file) => {
      if (!file.type.startsWith('image/')) { problem = ti('fbErrOnlyImages'); return; }
      if (file.size > MAX_SIZE) { problem = fill(ti('fbErrTooLarge'), { name: file.name }); return; }
      if (images.length >= MAX_IMAGES) { problem = fill(ti('fbErrMaxImages'), { n: MAX_IMAGES }); return; }
      images.push(file);
    });
    if (problem) setError('images', problem);
    renderPreviews();
  }

  dropzone.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', () => {
    addFiles(imageInput.files);
    imageInput.value = '';
  });
  ['dragover', 'dragenter'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  // ---------- Validation ----------
  function validate() {
    const ok = [
      setError('category', getCategory() ? '' : ti('fbErrCategory')),
      setError('title', titleEl.value.trim() ? '' : ti('fbErrTitle')),
      setError('content', contentEl.value.trim().length >= 10 ? '' : ti('fbErrContent'))
    ];
    return !ok.includes(false);
  }

  // ---------- Server call ----------
  // TODO: replace with your real API endpoint. This is the feedback that
  // goes to the software developers; it is sent as multipart FormData so
  // the pictures are included as files.
  function sendFeedbackRequest(formData) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const summary = {};
        formData.forEach((v, k) => { summary[k] = v instanceof File ? '[file] ' + v.name : v; });
        console.log('Feedback payload (demo, not sent):', summary);
        resolve();
      }, 900);
    });
    /* Example:
    return fetch('/api/feedback', { method: 'POST', body: formData })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Could not send feedback.');
        }
      });
    */
  }

  // ---------- Submit ----------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formError.classList.remove('show');
    if (!validate()) {
      const bad = form.querySelector('.has-error');
      if (bad) bad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const data = new FormData();
    data.append('category', getCategory());
    data.append('title', titleEl.value.trim());
    data.append('content', contentEl.value.trim());
    data.append('recipient', 'developers');
    images.forEach((file) => data.append('images', file, file.name));

    // Attach student info (saved by the home page) so developers have context
    try {
      const student = JSON.parse(sessionStorage.getItem('studentData') || 'null');
      if (student) {
        data.append('studentName', student.name);
        data.append('regNumber', student.regNumber);
        if (student.id) data.append('studentId', student.id);
      }
    } catch (err) { /* ignore */ }

    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    submitText.textContent = ti('fbSending');

    sendFeedbackRequest(data)
      .then(() => {
        form.style.display = 'none';
        successBox.classList.add('show');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch((err) => {
        formError.textContent = err.message || ti('genericError');
        formError.classList.add('show');
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        submitText.textContent = ti('fbSend');
      });
  });
})();