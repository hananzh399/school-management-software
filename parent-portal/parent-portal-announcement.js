// Parent Portal – Announcement page script
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

  // ===================================================
  // Mock announcement data
  //
  // Each entry can optionally include:
  //   images: [ 'url1', 'url2', ... ]  (any number)
  //   video:  'url.mp4'                (optional)
  //   attachment: { name, size, url }  (optional)
  //   isNew:  true                     (optional)
  // ===================================================
  const ANNOUNCEMENTS = [];

  // Everything the school sent this child's parent: announcements for all parents / the class, and result notices.
  // The category (Notice / Event / Holiday / Result) is the one the school chose; it drives the filter chips.
  let newestAnnouncementId = null;   // newest id on screen, used to spot a new one arriving live

  async function loadData() {
    const list = await PortalAPI.get(PortalAPI.forChild('/announcements'));
    newestAnnouncementId = (list || []).reduce((max, a) => (a.id > max ? a.id : max), 0);
    // The parent has now seen these: clear the red number on the dashboard card.
    if (window.PortalBadges) window.PortalBadges.markAnnouncementsSeen(list || []);
    ANNOUNCEMENTS.length = 0;
    (list || []).forEach((a) => {
      const date = PortalAPI.fmtDate(a.date), time = PortalAPI.fmtTime(a.date);
      const cat = ['event', 'holiday', 'result'].indexOf(a.category) >= 0 ? a.category : 'notice';
      ANNOUNCEMENTS.push({
        id: 'a' + a.id, category: cat, categoryLabel: cat.charAt(0).toUpperCase() + cat.slice(1),
        heading: a.title, text: a.body, date: date, time: time,
        timestamp: date + ' · ' + time, isNew: !!a.isNew
      });
    });
  }

  // ===================================================
  // Helpers
  // ===================================================
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const CATEGORY_KEYS = {
    event: 'catEvent',
    notice: 'catNotice',
    holiday: 'catHoliday',
    result: 'catResult'
  };

  const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "05 Oct 2026 · 09:15 AM" -> same in English, translated month + AM/PM in Urdu
  function localizeTimestamp(item) {
    if (!I18n || I18n.getLang() === 'en') return item.timestamp || '';
    const d = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(item.date || '');
    const idx = d ? EN_MONTHS.indexOf(d[2]) : -1;
    if (idx < 0) return item.timestamp || '';
    const datePart = `${d[1]} ${I18n.monthShort(idx)} ${d[3]}`;
    const t = /^(\d{1,2}:\d{2}) (AM|PM)$/i.exec(item.time || '');
    const timePart = t
      ? `${t[1]} ${tr(t[2].toUpperCase() === 'AM' ? 'timeAM' : 'timePM', t[2])}`
      : (item.time || '');
    return `${datePart} · ${timePart}`;
  }

  const CATEGORY_ICONS = {
    event: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    notice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    holiday: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
    result: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>'
  };

  const ATTACHMENT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

  const CLOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

  const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20"/></svg>';

  const ARROW_ICON = '<svg class="ann-attachment-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

  // ===================================================
  // Render
  // ===================================================
  function buildImageGrid(images) {
    if (!images || !images.length) return '';
    const count = Math.min(images.length, 3);
    const cls = count === 1 ? 'single' : (count === 2 ? 'double' : 'triple');
    const grid = images.slice(0, 3).map((src, i) => `
      <div class="ann-image" data-index="${i}">
        <img src="${src}" alt="${escapeHtml(tr('annImageAlt', 'Announcement image {n}').replace('{n}', i + 1))}" loading="lazy">
      </div>
    `).join('');
    return `<div class="ann-image-grid ${cls}">${grid}</div>`;
  }

  function buildVideo(video, poster) {
    if (!video) return '';
    return `
      <div class="ann-video">
        <video preload="metadata" muted playsinline ${poster ? `poster="${poster}"` : ''}>
          <source src="${video}" type="video/mp4">
        </video>
        <div class="ann-video-overlay">
          <span class="ann-video-play">${PLAY_ICON}</span>
        </div>
      </div>
    `;
  }

  function buildAttachment(att) {
    if (!att) return '';
    return `
      <a class="ann-attachment" href="${escapeHtml(att.url || '#')}" target="_blank" rel="noopener">
        <span class="ann-attachment-icon">${ATTACHMENT_ICON}</span>
        <span class="ann-attachment-text">
          <span class="ann-attachment-name">${escapeHtml(att.name || tr('annAttachment', 'Attachment'))}</span>
          <span class="ann-attachment-meta">${escapeHtml(att.size || '')} · ${escapeHtml(onScreen(tr('annTapToView', 'Tap to view')))}</span>
        </span>
        ${ARROW_ICON}
      </a>
    `;
  }

  function buildCard(item) {
    const hasMedia = item.images?.length || item.video || item.attachment;
    const cat = item.category || 'notice';
    const catIcon = CATEGORY_ICONS[cat] || CATEGORY_ICONS.notice;
    const catLabel = tr(CATEGORY_KEYS[cat], item.categoryLabel || cat.charAt(0).toUpperCase() + cat.slice(1));

    return `
      <article class="ann-card cat-${cat}" data-category="${cat}">
        ${item.isNew ? `<span class="ann-new-dot" aria-label="${escapeHtml(tr('annNew', 'New'))}"></span>` : ''}
        <div class="ann-card-accent"></div>
        <div class="ann-card-body">
          <div class="ann-card-head">
            <span class="ann-cat-badge">${catIcon}<span>${escapeHtml(onScreen(catLabel))}</span></span>
            <span class="ann-timestamp">${CLOCK_ICON}<span>${escapeHtml(onScreen(localizeTimestamp(item)))}</span></span>
          </div>

          <h2 class="ann-heading">${escapeHtml(item.heading || '')}</h2>
          <p class="ann-text">${escapeHtml(item.text || '')}</p>

          ${hasMedia ? `<div class="ann-media">
            ${buildImageGrid(item.images)}
            ${buildVideo(item.video, item.videoPoster)}
            ${buildAttachment(item.attachment)}
          </div>` : ''}
        </div>
      </article>
    `;
  }

  function renderFeed(filter) {
    const feed = document.getElementById('annFeed');
    if (!feed) return;

    const list = (filter && filter !== 'all')
      ? ANNOUNCEMENTS.filter((a) => a.category === filter)
      : ANNOUNCEMENTS;

    if (!list.length) {
      feed.innerHTML = `<div class="ann-empty">${escapeHtml(onScreen(tr('annEmpty', 'No announcements in this category.')))}</div>`;
      return;
    }

    feed.innerHTML = list.map(buildCard).join('');

    // Video play interaction
    feed.querySelectorAll('.ann-video').forEach((wrap) => {
      wrap.addEventListener('click', () => {
        const video = wrap.querySelector('video');
        if (!video) return;
        if (video.paused) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    });
  }

  // ===================================================
  // Filter chips
  // ===================================================
  function initFilters() {
    const chips = document.querySelectorAll('.ann-filter-chip');
    if (!chips.length) return;

    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => {
          c.classList.remove('active');
          c.setAttribute('aria-selected', 'false');
        });
        chip.classList.add('active');
        chip.setAttribute('aria-selected', 'true');
        renderFeed(chip.dataset.filter || 'all');
      });
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
      case 'change-password':
        window.location.href = 'parent-portal-change-password.html';
        break;
      case 'settings':
        window.location.href = 'parent-portal-settings.html';
        break;
      case 'info':            console.log('→ Info'); break;
      case 'demo-videos':     console.log('→ Demo Videos'); break;
      case 'submit-feedback':
        window.location.href = 'parent-portal-feedback.html';
        break;
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
  function activeFilter() {
    const chip = document.querySelector('.ann-filter-chip.active');
    return (chip && chip.dataset.filter) || 'all';
  }

  // Live: when the pulse says a newer announcement exists, reload the list by itself.
  let refreshing = false;
  window.addEventListener('portal-pulse', async (e) => {
    const reg = String(PortalAPI.childId() || '');
    const newest = Number(e.detail && e.detail.annByChild && e.detail.annByChild[reg]);
    if (!reg || !newest || newestAnnouncementId === null || newest === newestAnnouncementId || refreshing) return;
    refreshing = true;
    try {
      await loadData();
      renderFeed(activeFilter());
    } catch (err) { /* try again on the next pulse */ }
    refreshing = false;
  });

  async function boot() {
    // The menu and filter chips work immediately; they do not wait for the network.
    initFilters();
    initDrawer();
    try { await loadData(); } catch (err) { PortalAPI.showError(err); }
    renderFeed(activeFilter());
    console.log('Announcement page ready.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();