// Parent Portal – Full-screen student photo viewer (shared by Dashboard + Profile)
// Usage: PortalPhotoViewer.attach(wrapEl, imgEl, () => 'Student name')
(function () {
  'use strict';

  const CSS = `
.has-photo-zoom { cursor: zoom-in; }
.has-photo-zoom:focus-visible { outline: 2px solid #FFFFFF; outline-offset: 3px; border-radius: 50%; }

.photo-lightbox {
  position: fixed; inset: 0; z-index: 2147483000; box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.9rem;
  padding: calc(1rem + env(safe-area-inset-top, 0px)) 1rem calc(1rem + env(safe-area-inset-bottom, 0px));
  background-color: rgba(8, 16, 14, 0.92);
  -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
  opacity: 0; transition: opacity 0.22s ease; cursor: zoom-out;
}
.photo-lightbox[hidden] { display: none; }
.photo-lightbox.is-open { opacity: 1; }
.photo-lightbox-img {
  max-width: 100%; max-height: calc(100dvh - 8rem);
  width: auto; height: auto; object-fit: contain;
  border-radius: 16px; box-shadow: 0 20px 60px -10px rgba(0, 0, 0, 0.6);
  transform: scale(0.94); transition: transform 0.25s cubic-bezier(0.22, 0.8, 0.3, 1);
}
.photo-lightbox.is-open .photo-lightbox-img { transform: scale(1); }
.photo-lightbox-caption { color: #FFFFFF; font-size: 1rem; font-weight: 700; text-align: center; overflow-wrap: anywhere; }
.photo-lightbox-close {
  position: absolute; top: calc(0.75rem + env(safe-area-inset-top, 0px)); inset-inline-end: 0.75rem;
  display: flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; border: none; border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.16); color: #FFFFFF; cursor: pointer;
  transition: background-color 0.18s ease;
}
.photo-lightbox-close:hover { background-color: rgba(255, 255, 255, 0.3); }
.photo-lightbox-close svg { width: 22px; height: 22px; }
`;

  function tr(key, fallback) {
    try {
      const I = window.PortalI18n;
      const v = I ? I.t(key) : null;
      return v && v !== key ? v : fallback;
    } catch (e) { return fallback; }
  }

  // The built-in silhouette placeholder is an inline SVG data URI: not a real photo
  const isRealPhoto = (src) => !!src && !/^data:image\/svg/i.test(src);

  let box, imgEl, capEl, closeBtn, lastFocus, prevOverflow = '';

  function injectStyles() {
    if (document.getElementById('photoViewerStyles')) return;
    const s = document.createElement('style');
    s.id = 'photoViewerStyles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function build() {
    if (box) return;
    injectStyles();
    box = document.createElement('div');
    box.className = 'photo-lightbox';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML =
      '<button type="button" class="photo-lightbox-close" aria-label="Close">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
      '<img class="photo-lightbox-img" alt="">' +
      '<p class="photo-lightbox-caption"></p>';
    document.body.appendChild(box);
    imgEl = box.querySelector('.photo-lightbox-img');
    capEl = box.querySelector('.photo-lightbox-caption');
    closeBtn = box.querySelector('.photo-lightbox-close');
    closeBtn.setAttribute('aria-label', tr('close', 'Close'));

    box.addEventListener('click', close);          // tap anywhere closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !box.hidden) close();
    });
  }

  function open(src, name) {
    build();
    lastFocus = document.activeElement;
    imgEl.src = src;
    imgEl.alt = name || '';
    capEl.textContent = name || '';
    capEl.hidden = !name;
    box.setAttribute('aria-label', name || '');
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.hidden = false;
    void box.offsetWidth;                           // let the fade-in run
    box.classList.add('is-open');
    closeBtn.focus();
  }

  function close() {
    if (!box || box.hidden) return;
    box.classList.remove('is-open');
    document.body.style.overflow = prevOverflow;
    setTimeout(() => { box.hidden = true; imgEl.removeAttribute('src'); }, 220);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function loadFromApi(img, student) {
    const api = window.PortalAPI;
    if (!student || !api || typeof api.blobUrl !== 'function') return;
    const regNo = student.regNo || student.regNumber || student.id;
    if ((!student.hasPhoto && !student.photoUrl && !student.photo) || !regNo) return;
    if (student.photo) { img.src = student.photo; return; }
    api.blobUrl('/children/' + encodeURIComponent(regNo) + '/photo')
      .then((url) => { if (img.isConnected) img.src = url; })
      .catch(() => { /* keep the placeholder */ });
  }

  // Make the photo wrapper tappable. The zoom is active only while the <img>
  // shows a real photo (it may arrive later, e.g. loaded from the API).
  function attach(wrap, img, getName, getStudent) {
    if (!wrap || !img || wrap.dataset.photoViewer) return;
    wrap.dataset.photoViewer = '1';

    const refresh = () => {
      const real = isRealPhoto(img.currentSrc || img.getAttribute('src'));
      wrap.classList.toggle('has-photo-zoom', real);
      if (real) {
        wrap.setAttribute('role', 'button');
        wrap.tabIndex = 0;
        wrap.setAttribute('aria-label', tr('viewPhoto', 'View photo'));
      } else {
        wrap.removeAttribute('role');
        wrap.removeAttribute('tabindex');
        wrap.removeAttribute('aria-label');
      }
    };
    refresh();
    img.addEventListener('load', refresh);
    // No real photo on screen yet? Load it from the API, like the Home page does.
    if (!isRealPhoto(img.currentSrc || img.getAttribute('src'))) {
      loadFromApi(img, typeof getStudent === 'function' ? getStudent() : null);
    }
    if (window.MutationObserver) {
      new MutationObserver(refresh).observe(img, { attributes: true, attributeFilter: ['src'] });
    }

    const show = () => {
      const src = img.currentSrc || img.src;
      if (!isRealPhoto(src)) return;
      open(src, typeof getName === 'function' ? getName() : '');
    };
    wrap.addEventListener('click', show);
    wrap.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && wrap.classList.contains('has-photo-zoom')) {
        e.preventDefault();
        show();
      }
    });
  }

  window.PortalPhotoViewer = { attach, open, close };
})();
