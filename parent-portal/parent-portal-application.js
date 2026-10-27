// Parent Portal – Submit Application page script
// Contains: chooser + embedded Leave form + embedded Complaint form + embedded Suggestion form
(function () {
  'use strict';

  // ---------- Redirect to index on page refresh ----------
  (function redirectOnRefresh() {
    const navEntries = performance.getEntriesByType && performance.getEntriesByType('navigation');
    const isReload = (navEntries && navEntries[0] && navEntries[0].type === 'reload')
      || (performance.navigation && performance.navigation.type === 1);
    if (isReload) {
      window.location.replace('parent-portal-index.html');
    }
  })();

  // ===================================================
  // Language
  // ===================================================
  const I18n = window.PortalI18n;
  if (I18n) I18n.apply();
  const tr = (key, fallback) => (I18n ? I18n.t(key) : fallback);
  const onScreen = (text) => (I18n ? I18n.iso(text) : text);

  // Image alt text can't use data-i18n, so set it here
  [['leavePreviewImg', 'attachmentPreviewAlt', 'Attachment preview'],
   ['complaintPreviewImg', 'complaintPreviewAlt', 'Complaint image preview'],
   ['suggestionPreviewImg', 'suggestionPreviewAlt', 'Suggestion image preview']
  ].forEach(([id, key, fallback]) => {
    const img = document.getElementById(id);
    if (img) img.alt = tr(key, fallback);
  });

  // ===================================================
  // Shared state
  // ===================================================
  const state = {
    view: 'chooser',    // 'chooser' | 'leave' | 'complaint' | 'suggestion'

    // Leave form
    type: '',
    method: 'write',
    imageData: null,
    stream: null,

    // Complaint form
    cMethod: 'write',
    cImageData: null,
    cStream: null,

    // Suggestion form
    sMethod: 'write',
    sImageData: null,
    sStream: null
  };

  const MAX_TEXT = 1000;
  const MAX_TITLE = 120;

  const TYPE_LABELS = {
    'sick-leave':   'Sick Leave',
    'urgent-work':  'Urgent Work',
    'family-event': 'Family Event',
    'medical':      'Medical',
    'travel':       'Travel',
    'other':        'Other'
  };

  const TYPE_KEYS = {
    'sick-leave':   'typeSick',
    'urgent-work':  'typeUrgent',
    'family-event': 'typeFamily',
    'medical':      'typeMedical',
    'travel':       'typeTravel',
    'other':        'typeOther'
  };
  const METHOD_KEYS = { write: 'tabWrite', image: 'tabImage', camera: 'tabCamera' };

  function typeLabel(value) {
    return tr(TYPE_KEYS[value], TYPE_LABELS[value] || value);
  }
  function methodLabel(value) {
    return tr(METHOD_KEYS[value], value);
  }

  async function postSubmission(payload, imageData) {
    const api = window.PortalAPI;
    if (!api) throw new Error('Parent portal API client is missing. Load parent-portal-api.js before this page script.');
    await api.ensureChildren();
    const form = new FormData();
    Object.keys(payload).forEach((key) => {
      if (payload[key] !== undefined && payload[key] !== null) form.append(key, String(payload[key]));
    });
    const regNo = api.childId();
    if (payload.kind !== 'feedback' && !regNo) throw new Error('Select a child before submitting this form.');
    if (regNo) form.append('regNo', regNo);
    if (imageData) {
      const blob = await fetch(imageData).then((response) => response.blob());
      if (blob.size > 3 * 1024 * 1024) throw new Error('Each attached picture must be under 3 MB.');
      form.append('images', blob, 'parent-portal-attachment.' + ((blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')));
    }
    return api.submissions(form);
  }

  function submissionError(err) {
    alert((err && err.message) || tr('submissionFailed', 'Could not submit this form. Please try again.'));
  }

  // ===================================================
  // Helpers
  // ===================================================
  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ===================================================
  // VIEW SWITCHING
  // ===================================================
  function setView(name) {
    // Stop cameras when leaving their views
    if (state.view === 'leave')      stopLeaveCamera();
    if (state.view === 'complaint')  stopComplaintCamera();
    if (state.view === 'suggestion') stopSuggestionCamera();

    state.view = name;

    const views = {
      chooser:    document.getElementById('appViewChooser'),
      leave:      document.getElementById('appViewLeave'),
      complaint:  document.getElementById('appViewComplaint'),
      suggestion: document.getElementById('appViewSuggestion')
    };

    Object.keys(views).forEach((k) => {
      if (views[k]) views[k].hidden = (k !== name);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ===================================================
  // TOP BACK BUTTON
  // ===================================================
  function initBackButton() {
    const btn = document.getElementById('appBackBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      if (state.view !== 'chooser') {
        setView('chooser');
      } else {
        window.location.href = 'parent-portal-dashboard.html';
      }
    });
  }

  // ===================================================
  // CHOOSER OPTIONS
  // ===================================================
  function initChooserOptions() {
    const appCard = document.getElementById('appOptionApplication');
    if (appCard) appCard.addEventListener('click', () => setView('leave'));

    const complaintCard = document.getElementById('appOptionComplaint');
    if (complaintCard) complaintCard.addEventListener('click', () => setView('complaint'));

    const suggestionCard = document.getElementById('appOptionSuggestion');
    if (suggestionCard) suggestionCard.addEventListener('click', () => setView('suggestion'));

    // Any remaining data-action cards → generic placeholder
    document.querySelectorAll('.app-option-card[data-action]').forEach((card) => {
      card.addEventListener('click', () => {
        const action = card.dataset.action;
        const label = action.charAt(0).toUpperCase() + action.slice(1);
          alert(tr('formNotConnected', 'The {name} form is not connected to the backend yet.').replace('{name}', label));
      });
    });
  }

  // ===================================================
  // LEAVE FORM — type dropdown
  // ===================================================
  function initTypeDropdown() {
    const dropdown = document.getElementById('leaveTypeDropdown');
    const trigger = document.getElementById('leaveTypeTrigger');
    const menu = document.getElementById('leaveTypeMenu');
    const valueEl = document.getElementById('leaveTypeValue');
    if (!dropdown || !trigger || !menu || !valueEl) return;

    function openMenu() { menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); }
    function closeMenu() { menu.hidden = true;  trigger.setAttribute('aria-expanded', 'false'); }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hidden) openMenu(); else closeMenu();
    });

    menu.querySelectorAll('.leave-dropdown-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = item.dataset.value;
        const label = typeLabel(value);
        state.type = value;

        valueEl.textContent = onScreen(label);
        valueEl.classList.remove('is-placeholder');

        menu.querySelectorAll('.leave-dropdown-item').forEach((it) => {
          const isSelected = it.dataset.value === value;
          it.classList.toggle('selected', isSelected);
          it.setAttribute('aria-selected', String(isSelected));
        });

        closeMenu();
      });
    });

    document.addEventListener('click', (e) => { if (!dropdown.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) { closeMenu(); trigger.focus(); }
    });
    window.addEventListener('blur', closeMenu);
    window.addEventListener('pagehide', closeMenu);
  }

  // ===================================================
  // LEAVE FORM — Today button
  // ===================================================
  function initTodayButton() {
    const btn = document.getElementById('leaveTodayBtn');
    const from = document.getElementById('leaveFrom');
    const to = document.getElementById('leaveTo');
    if (!btn || !from || !to) return;

    btn.addEventListener('click', () => {
      const today = todayISO();
      from.value = today;
      to.value = today;
      btn.classList.add('leave-today-btn-active');
      setTimeout(() => btn.classList.remove('leave-today-btn-active'), 500);
    });
  }

  // ===================================================
  // LEAVE FORM — method tabs
  // ===================================================
  function initMethodTabs() {
    const tabs = document.querySelectorAll('.leave-tab[data-method]');
    const panels = {
      write:  document.getElementById('leavePanelWrite'),
      image:  document.getElementById('leavePanelImage'),
      camera: document.getElementById('leavePanelCamera')
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const method = tab.dataset.method || 'write';
        if (state.method === 'camera' && method !== 'camera') stopLeaveCamera();
        state.method = method;

        tabs.forEach((t) => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        Object.keys(panels).forEach((key) => {
          if (panels[key]) panels[key].hidden = (key !== method);
        });

        if (method === 'camera') startLeaveCamera();
      });
    });
  }

  // ===================================================
  // LEAVE FORM — text counter
  // ===================================================
  function initTextCounter() {
    const textarea = document.getElementById('leaveText');
    const counter = document.getElementById('leaveTextCount');
    if (!textarea || !counter) return;

    function update() {
      const len = textarea.value.length;
      if (len > MAX_TEXT) textarea.value = textarea.value.slice(0, MAX_TEXT);
      counter.textContent = String(textarea.value.length);
    }
    textarea.addEventListener('input', update);
    update();
  }

  // ===================================================
  // LEAVE FORM — upload
  // ===================================================
  function initUpload() {
    const input = document.getElementById('leaveImageInput');
    if (!input) return;

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) { alert(tr('alertSelectImage', 'Please select an image file.')); return; }
      if (file.size > 3 * 1024 * 1024) { alert(tr('alertImageTooLarge', 'Image is too large (max 3 MB).')); return; }

      const reader = new FileReader();
      reader.onload = (e) => {
        state.imageData = e.target.result;
        showLeavePreview(state.imageData);
      };
      reader.readAsDataURL(file);
    });
  }

  // ===================================================
  // LEAVE FORM — camera
  // ===================================================
  async function startLeaveCamera() {
    const video = document.getElementById('leaveCameraVideo');
    const captureBtn = document.getElementById('leaveCamCapture');
    if (!video) return;

    if (state.stream) { if (captureBtn) captureBtn.disabled = false; return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert(tr('alertCameraUnsupported', 'Camera not supported in this browser.')); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      state.stream = stream;
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (captureBtn) captureBtn.disabled = false;
    } catch (err) {
      console.warn('Camera error:', err);
      alert(tr('alertCameraAccess', 'Could not access the camera. Please check permissions and try again.'));
    }
  }
  function stopLeaveCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    const video = document.getElementById('leaveCameraVideo');
    if (video) video.srcObject = null;
    const captureBtn = document.getElementById('leaveCamCapture');
    if (captureBtn) captureBtn.disabled = true;
  }
  function captureLeaveFromCamera() {
    const video = document.getElementById('leaveCameraVideo');
    const canvas = document.getElementById('leaveCameraCanvas');
    if (!video || !canvas) return;

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);

    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      state.imageData = dataUrl;
      showLeavePreview(dataUrl);
      stopLeaveCamera();
    } catch (e) {
      console.warn('Capture error:', e);
      alert(tr('alertCaptureFail', 'Could not capture image.'));
    }
  }
  function initLeaveCamera() {
    const startBtn = document.getElementById('leaveCamStart');
    const captureBtn = document.getElementById('leaveCamCapture');
    if (startBtn) startBtn.addEventListener('click', startLeaveCamera);
    if (captureBtn) captureBtn.addEventListener('click', captureLeaveFromCamera);
    window.addEventListener('pagehide', stopLeaveCamera);
    window.addEventListener('beforeunload', stopLeaveCamera);
  }

  // ===================================================
  // LEAVE FORM — preview
  // ===================================================
  function showLeavePreview(dataUrl) {
    const wrap = document.getElementById('leavePreview');
    const img = document.getElementById('leavePreviewImg');
    if (!wrap || !img) return;
    img.src = dataUrl;
    wrap.hidden = false;
  }
  function hideLeavePreview() {
    const wrap = document.getElementById('leavePreview');
    const img = document.getElementById('leavePreviewImg');
    if (!wrap || !img) return;
    wrap.hidden = true;
    img.removeAttribute('src');
    state.imageData = null;
  }
  function initPreviewRemove() {
    const btn = document.getElementById('leavePreviewRemove');
    const input = document.getElementById('leaveImageInput');
    if (!btn) return;
    btn.addEventListener('click', () => {
      hideLeavePreview();
      if (input) input.value = '';
    });
  }

  // ===================================================
  // LEAVE FORM — submit
  // ===================================================
  function initLeaveSubmit() {
    const btn = document.getElementById('leaveSubmitBtn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const from = document.getElementById('leaveFrom')?.value || '';
      const to = document.getElementById('leaveTo')?.value || '';
      const text = (document.getElementById('leaveText')?.value || '').trim();

      if (!state.type) { alert(tr('alertSelectType', 'Please select the type of application before submitting.')); return; }
      if (state.method === 'write') {
        if (!text) { alert(tr('alertWriteApplication', 'Please write your application before submitting.')); return; }
      } else if (state.method === 'image' || state.method === 'camera') {
        if (!state.imageData) { alert(tr('alertAttachApplication', 'Please attach an image of the application before submitting.')); return; }
      }
      if (!from || !to) { alert(tr('alertSelectDates', 'Please select the leave duration (From and To dates).')); return; }

      const summary = [
        `${tr('sumType', 'Type')}: ${typeLabel(state.type)}`,
        `${tr('sumFrom', 'From')}: ${from}`,
        `${tr('sumTo', 'To')}: ${to}`,
        `${tr('sumMethod', 'Method')}: ${methodLabel(state.method)}`,
        text ? `${tr('sumText', 'Text')}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}` : `${tr('sumText', 'Text')}: ${tr('sumNotUsed', '(not used)')}`,
        `${tr('sumImage', 'Image')}: ${state.imageData ? tr('sumAttached', 'attached') : tr('sumNone', 'none')}`
      ].join('\n');

      const ok = window.confirm(tr('confirmSubmitApplication', 'Submit this application?') + '\n\n' + summary);
      if (ok) {
        btn.disabled = true;
        try {
          const result = await postSubmission({
            kind: 'leave', category: state.type, content: text,
            from, to, method: state.method
          }, state.imageData);
          alert(tr('submittedApplication', 'Application submitted successfully.') +
            (result && result.id ? '\n' + tr('submissionReference', 'Reference') + ': ' + result.id : ''));
        } catch (err) {
          submissionError(err);
        } finally {
          btn.disabled = false;
        }
      }
    });
  }

  // ===================================================
  // COMPLAINT FORM
  // ===================================================
  function initComplaintTitleCounter() {
    const input = document.getElementById('complaintTitle');
    const counter = document.getElementById('complaintTitleCount');
    if (!input || !counter) return;

    function update() {
      const len = input.value.length;
      if (len > MAX_TITLE) input.value = input.value.slice(0, MAX_TITLE);
      counter.textContent = String(input.value.length);
    }
    input.addEventListener('input', update);
    update();
  }

  function initComplaintTabs() {
    const tabs = document.querySelectorAll('.leave-tab[data-cmethod]');
    const panels = {
      write:  document.getElementById('complaintPanelWrite'),
      image:  document.getElementById('complaintPanelImage'),
      camera: document.getElementById('complaintPanelCamera')
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const method = tab.dataset.cmethod || 'write';
        if (state.cMethod === 'camera' && method !== 'camera') stopComplaintCamera();
        state.cMethod = method;

        tabs.forEach((t) => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        Object.keys(panels).forEach((key) => {
          if (panels[key]) panels[key].hidden = (key !== method);
        });

        if (method === 'camera') startComplaintCamera();
      });
    });
  }

  function initComplaintTextCounter() {
    const textarea = document.getElementById('complaintText');
    const counter = document.getElementById('complaintTextCount');
    if (!textarea || !counter) return;

    function update() {
      const len = textarea.value.length;
      if (len > MAX_TEXT) textarea.value = textarea.value.slice(0, MAX_TEXT);
      counter.textContent = String(textarea.value.length);
    }
    textarea.addEventListener('input', update);
    update();
  }

  function initComplaintUpload() {
    const input = document.getElementById('complaintImageInput');
    if (!input) return;

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) { alert(tr('alertSelectImage', 'Please select an image file.')); return; }
      if (file.size > 3 * 1024 * 1024) { alert(tr('alertImageTooLarge', 'Image is too large (max 3 MB).')); return; }

      const reader = new FileReader();
      reader.onload = (e) => {
        state.cImageData = e.target.result;
        showComplaintPreview(state.cImageData);
      };
      reader.readAsDataURL(file);
    });
  }

  async function startComplaintCamera() {
    const video = document.getElementById('complaintCameraVideo');
    const captureBtn = document.getElementById('complaintCamCapture');
    if (!video) return;

    if (state.cStream) { if (captureBtn) captureBtn.disabled = false; return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert(tr('alertCameraUnsupported', 'Camera not supported in this browser.')); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false
      });
      state.cStream = stream;
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (captureBtn) captureBtn.disabled = false;
    } catch (err) {
      console.warn('Camera error:', err);
      alert(tr('alertCameraAccess', 'Could not access the camera. Please check permissions and try again.'));
    }
  }
  function stopComplaintCamera() {
    if (state.cStream) {
      state.cStream.getTracks().forEach((t) => t.stop());
      state.cStream = null;
    }
    const video = document.getElementById('complaintCameraVideo');
    if (video) video.srcObject = null;
    const captureBtn = document.getElementById('complaintCamCapture');
    if (captureBtn) captureBtn.disabled = true;
  }
  function captureComplaintFromCamera() {
    const video = document.getElementById('complaintCameraVideo');
    const canvas = document.getElementById('complaintCameraCanvas');
    if (!video || !canvas) return;

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);

    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      state.cImageData = dataUrl;
      showComplaintPreview(dataUrl);
      stopComplaintCamera();
    } catch (e) {
      console.warn('Capture error:', e);
      alert(tr('alertCaptureFail', 'Could not capture image.'));
    }
  }
  function initComplaintCamera() {
    const startBtn = document.getElementById('complaintCamStart');
    const captureBtn = document.getElementById('complaintCamCapture');
    if (startBtn) startBtn.addEventListener('click', startComplaintCamera);
    if (captureBtn) captureBtn.addEventListener('click', captureComplaintFromCamera);
    window.addEventListener('pagehide', stopComplaintCamera);
    window.addEventListener('beforeunload', stopComplaintCamera);
  }

  function showComplaintPreview(dataUrl) {
    const wrap = document.getElementById('complaintPreview');
    const img = document.getElementById('complaintPreviewImg');
    if (!wrap || !img) return;
    img.src = dataUrl;
    wrap.hidden = false;
  }
  function hideComplaintPreview() {
    const wrap = document.getElementById('complaintPreview');
    const img = document.getElementById('complaintPreviewImg');
    if (!wrap || !img) return;
    wrap.hidden = true;
    img.removeAttribute('src');
    state.cImageData = null;
  }
  function initComplaintPreviewRemove() {
    const btn = document.getElementById('complaintPreviewRemove');
    const input = document.getElementById('complaintImageInput');
    if (!btn) return;
    btn.addEventListener('click', () => {
      hideComplaintPreview();
      if (input) input.value = '';
    });
  }

  function initComplaintSubmit() {
    const btn = document.getElementById('complaintSubmitBtn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const title = (document.getElementById('complaintTitle')?.value || '').trim();
      const text = (document.getElementById('complaintText')?.value || '').trim();

      if (!title) { alert(tr('alertEnterComplaintTitle', 'Please enter a title for your complaint.')); return; }

      if (state.cMethod === 'write') {
        if (!text) { alert(tr('alertWriteComplaint', 'Please describe your complaint before submitting.')); return; }
      } else if (state.cMethod === 'image' || state.cMethod === 'camera') {
        if (!state.cImageData) { alert(tr('alertAttachComplaint', 'Please attach an image of your complaint before submitting.')); return; }
      }

      const summary = [
        `${tr('sumTitle', 'Title')}: ${title}`,
        `${tr('sumMethod', 'Method')}: ${methodLabel(state.cMethod)}`,
        text ? `${tr('sumText', 'Text')}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}` : `${tr('sumText', 'Text')}: ${tr('sumNotUsed', '(not used)')}`,
        `${tr('sumImage', 'Image')}: ${state.cImageData ? tr('sumAttached', 'attached') : tr('sumNone', 'none')}`
      ].join('\n');

      const ok = window.confirm(tr('confirmSubmitComplaint', 'Submit this complaint?') + '\n\n' + summary);
      if (ok) {
        btn.disabled = true;
        try {
          const result = await postSubmission({
            kind: 'complaint', title, content: text, method: state.cMethod
          }, state.cImageData);
          alert(tr('submittedComplaint', 'Complaint submitted successfully.') +
            (result && result.id ? '\n' + tr('submissionReference', 'Reference') + ': ' + result.id : ''));
        } catch (err) {
          submissionError(err);
        } finally {
          btn.disabled = false;
        }
      }
    });
  }

  // ===================================================
  // SUGGESTION FORM
  // ===================================================
  function initSuggestionTitleCounter() {
    const input = document.getElementById('suggestionTitle');
    const counter = document.getElementById('suggestionTitleCount');
    if (!input || !counter) return;

    function update() {
      const len = input.value.length;
      if (len > MAX_TITLE) input.value = input.value.slice(0, MAX_TITLE);
      counter.textContent = String(input.value.length);
    }
    input.addEventListener('input', update);
    update();
  }

  function initSuggestionTabs() {
    const tabs = document.querySelectorAll('.leave-tab[data-smethod]');
    const panels = {
      write:  document.getElementById('suggestionPanelWrite'),
      image:  document.getElementById('suggestionPanelImage'),
      camera: document.getElementById('suggestionPanelCamera')
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const method = tab.dataset.smethod || 'write';
        if (state.sMethod === 'camera' && method !== 'camera') stopSuggestionCamera();
        state.sMethod = method;

        tabs.forEach((t) => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        Object.keys(panels).forEach((key) => {
          if (panels[key]) panels[key].hidden = (key !== method);
        });

        if (method === 'camera') startSuggestionCamera();
      });
    });
  }

  function initSuggestionTextCounter() {
    const textarea = document.getElementById('suggestionText');
    const counter = document.getElementById('suggestionTextCount');
    if (!textarea || !counter) return;

    function update() {
      const len = textarea.value.length;
      if (len > MAX_TEXT) textarea.value = textarea.value.slice(0, MAX_TEXT);
      counter.textContent = String(textarea.value.length);
    }
    textarea.addEventListener('input', update);
    update();
  }

  function initSuggestionUpload() {
    const input = document.getElementById('suggestionImageInput');
    if (!input) return;

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) { alert(tr('alertSelectImage', 'Please select an image file.')); return; }
      if (file.size > 3 * 1024 * 1024) { alert(tr('alertImageTooLarge', 'Image is too large (max 3 MB).')); return; }

      const reader = new FileReader();
      reader.onload = (e) => {
        state.sImageData = e.target.result;
        showSuggestionPreview(state.sImageData);
      };
      reader.readAsDataURL(file);
    });
  }

  async function startSuggestionCamera() {
    const video = document.getElementById('suggestionCameraVideo');
    const captureBtn = document.getElementById('suggestionCamCapture');
    if (!video) return;

    if (state.sStream) { if (captureBtn) captureBtn.disabled = false; return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert(tr('alertCameraUnsupported', 'Camera not supported in this browser.')); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false
      });
      state.sStream = stream;
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (captureBtn) captureBtn.disabled = false;
    } catch (err) {
      console.warn('Camera error:', err);
      alert(tr('alertCameraAccess', 'Could not access the camera. Please check permissions and try again.'));
    }
  }
  function stopSuggestionCamera() {
    if (state.sStream) {
      state.sStream.getTracks().forEach((t) => t.stop());
      state.sStream = null;
    }
    const video = document.getElementById('suggestionCameraVideo');
    if (video) video.srcObject = null;
    const captureBtn = document.getElementById('suggestionCamCapture');
    if (captureBtn) captureBtn.disabled = true;
  }
  function captureSuggestionFromCamera() {
    const video = document.getElementById('suggestionCameraVideo');
    const canvas = document.getElementById('suggestionCameraCanvas');
    if (!video || !canvas) return;

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);

    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      state.sImageData = dataUrl;
      showSuggestionPreview(dataUrl);
      stopSuggestionCamera();
    } catch (e) {
      console.warn('Capture error:', e);
      alert(tr('alertCaptureFail', 'Could not capture image.'));
    }
  }
  function initSuggestionCamera() {
    const startBtn = document.getElementById('suggestionCamStart');
    const captureBtn = document.getElementById('suggestionCamCapture');
    if (startBtn) startBtn.addEventListener('click', startSuggestionCamera);
    if (captureBtn) captureBtn.addEventListener('click', captureSuggestionFromCamera);
    window.addEventListener('pagehide', stopSuggestionCamera);
    window.addEventListener('beforeunload', stopSuggestionCamera);
  }

  function showSuggestionPreview(dataUrl) {
    const wrap = document.getElementById('suggestionPreview');
    const img = document.getElementById('suggestionPreviewImg');
    if (!wrap || !img) return;
    img.src = dataUrl;
    wrap.hidden = false;
  }
  function hideSuggestionPreview() {
    const wrap = document.getElementById('suggestionPreview');
    const img = document.getElementById('suggestionPreviewImg');
    if (!wrap || !img) return;
    wrap.hidden = true;
    img.removeAttribute('src');
    state.sImageData = null;
  }
  function initSuggestionPreviewRemove() {
    const btn = document.getElementById('suggestionPreviewRemove');
    const input = document.getElementById('suggestionImageInput');
    if (!btn) return;
    btn.addEventListener('click', () => {
      hideSuggestionPreview();
      if (input) input.value = '';
    });
  }

  function initSuggestionSubmit() {
    const btn = document.getElementById('suggestionSubmitBtn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const title = (document.getElementById('suggestionTitle')?.value || '').trim();
      const text = (document.getElementById('suggestionText')?.value || '').trim();

      // Title is required in every method
      if (!title) { alert(tr('alertEnterSuggestionTitle', 'Please enter a title for your suggestion.')); return; }

      if (state.sMethod === 'write') {
        if (!text) { alert(tr('alertWriteSuggestion', 'Please describe your suggestion before submitting.')); return; }
      } else if (state.sMethod === 'image' || state.sMethod === 'camera') {
        if (!state.sImageData) { alert(tr('alertAttachSuggestion', 'Please attach an image of your suggestion before submitting.')); return; }
      }

      const summary = [
        `${tr('sumTitle', 'Title')}: ${title}`,
        `${tr('sumMethod', 'Method')}: ${methodLabel(state.sMethod)}`,
        text ? `${tr('sumText', 'Text')}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}` : `${tr('sumText', 'Text')}: ${tr('sumNotUsed', '(not used)')}`,
        `${tr('sumImage', 'Image')}: ${state.sImageData ? tr('sumAttached', 'attached') : tr('sumNone', 'none')}`
      ].join('\n');

      const ok = window.confirm(tr('confirmSubmitSuggestion', 'Submit this suggestion?') + '\n\n' + summary);
      if (ok) {
        btn.disabled = true;
        try {
          const result = await postSubmission({
            kind: 'suggestion', title, content: text, method: state.sMethod
          }, state.sImageData);
          alert(tr('submittedSuggestion', 'Suggestion submitted successfully.') +
            (result && result.id ? '\n' + tr('submissionReference', 'Reference') + ': ' + result.id : ''));
        } catch (err) {
          submissionError(err);
        } finally {
          btn.disabled = false;
        }
      }
    });
  }

  // ===================================================
  // Drawer
  // ===================================================
  function openDrawer(drawer, overlay, hamburger) {
    drawer.classList.add('open');
    overlay.classList.add('active');
    drawer.setAttribute('aria-hidden', 'false');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer(drawer, overlay, hamburger) {
    drawer.classList.remove('open');
    overlay.classList.remove('active');
    drawer.setAttribute('aria-hidden', 'true');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
  function handleDrawerAction(action) {
    switch (action) {
      case 'change-password': console.log('→ Change Password'); break;
      case 'demo-videos':     console.log('→ Demo Videos'); break;
      case 'submit-feedback': console.log('→ Submit Feedback'); break;
      case 'logout':
        if (window.confirm(tr('logoutConfirm', 'Are you sure you want to logout?'))) {
          try { sessionStorage.clear(); } catch (e) {}
          console.log('→ Logged out');
        }
        break;
      default: console.warn('Unknown drawer action:', action);
    }
  }
  function initDrawer() {
    const hamburger = document.getElementById('hamburgerBtn');
    const drawer = document.getElementById('sidePanel');
    const overlay = document.getElementById('sidePanelOverlay');
    const closeBtn = document.getElementById('sidePanelClose');
    if (!drawer || !overlay) return;

    if (hamburger) hamburger.addEventListener('click', () => openDrawer(drawer, overlay, hamburger));
    if (closeBtn) closeBtn.addEventListener('click', () => closeDrawer(drawer, overlay, hamburger));
    overlay.addEventListener('click', () => closeDrawer(drawer, overlay, hamburger));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) {
        closeDrawer(drawer, overlay, hamburger);
      }
    });

    drawer.querySelectorAll('.drawer-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        handleDrawerAction(link.dataset.action);
        closeDrawer(drawer, overlay, hamburger);
      });
    });
  }

  // ===================================================
  // Boot
  // ===================================================
  function boot() {
    initBackButton();
    initChooserOptions();

    // Leave
    initTypeDropdown();
    initTodayButton();
    initMethodTabs();
    initTextCounter();
    initUpload();
    initLeaveCamera();
    initPreviewRemove();
    initLeaveSubmit();

    // Complaint
    initComplaintTitleCounter();
    initComplaintTabs();
    initComplaintTextCounter();
    initComplaintUpload();
    initComplaintCamera();
    initComplaintPreviewRemove();
    initComplaintSubmit();

    // Suggestion
    initSuggestionTitleCounter();
    initSuggestionTabs();
    initSuggestionTextCounter();
    initSuggestionUpload();
    initSuggestionCamera();
    initSuggestionPreviewRemove();
    initSuggestionSubmit();

    initDrawer();
    console.log('Submit Application page ready.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();