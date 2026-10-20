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
  const ANNOUNCEMENTS = [
    {
      id: 'a1',
      category: 'event',
      categoryLabel: 'Event',
      heading: 'Annual Sports Day 2026',
      date: '05 Oct 2026',
      time: '09:15 AM',
      timestamp: '05 Oct 2026 · 09:15 AM',
      text: 'Greenwood High is proud to announce the Annual Sports Day 2026, taking place on Saturday, 24 October at the main school ground. All students from Class 1 to Class 10 will participate in track events, relays, and team sports. Parents are cordially invited to attend and cheer for the young athletes. Refreshments will be available on-site.',
      isNew: true,
      images: [
        'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Cdefs%3E%3ClinearGradient id=%22g1%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop offset=%220%22 stop-color=%22%232E8B7A%22/%3E%3Cstop offset=%221%22 stop-color=%22%234CAF8F%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%22400%22 height=%22300%22 fill=%22url(%23g1)%22/%3E%3Ctext x=%22200%22 y=%22155%22 font-family=%22Arial%22 font-size=%2240%22 font-weight=%22bold%22 fill=%22white%22 text-anchor=%22middle%22%3ESports Day%3C/text%3E%3C/svg%3E',
        'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23E3F2ED%22/%3E%3Ctext x=%22200%22 y=%22155%22 font-family=%22Arial%22 font-size=%2232%22 font-weight=%22bold%22 fill=%22%232E8B7A%22 text-anchor=%22middle%22%3ETrack%3C/text%3E%3C/svg%3E',
        'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23FBF4DE%22/%3E%3Ctext x=%22200%22 y=%22155%22 font-family=%22Arial%22 font-size=%2232%22 font-weight=%22bold%22 fill=%22%238A6B1C%22 text-anchor=%22middle%22%3ETrophies%3C/text%3E%3C/svg%3E'
      ]
    },
    {
      id: 'a2',
      category: 'notice',
      categoryLabel: 'Notice',
      heading: 'Parent-Teacher Meeting — Grade 5',
      date: '03 Oct 2026',
      time: '02:00 PM',
      timestamp: '03 Oct 2026 · 02:00 PM',
      text: 'A Parent-Teacher Meeting (PTM) has been scheduled for Grade 5 parents on Friday, 10 October 2026 from 2:00 PM to 5:00 PM. Please visit the class teacher to discuss your child\'s progress, and collect the mid-term report. Kindly arrive within your allotted time slot; slots will be shared on the class group.',
      images: [
        'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23E6EFF8%22/%3E%3Ctext x=%22200%22 y=%22155%22 font-family=%22Arial%22 font-size=%2230%22 font-weight=%22bold%22 fill=%22%234682B4%22 text-anchor=%22middle%22%3EPTM Notice%3C/text%3E%3C/svg%3E'
      ],
      attachment: {
        name: 'PTM-Schedule-Grade5.pdf',
        size: '218 KB',
        url: '#'
      }
    },
    {
      id: 'a3',
      category: 'holiday',
      categoryLabel: 'Holiday',
      heading: 'Autumn Break — 20 to 22 October',
      date: '01 Oct 2026',
      time: '11:00 AM',
      timestamp: '01 Oct 2026 · 11:00 AM',
      text: 'The school will remain closed for the Autumn Break from Monday, 20 October to Wednesday, 22 October 2026. Regular classes will resume on Thursday, 23 October 2026. Parents are advised to ensure that students complete the holiday assignments given by their subject teachers during the break.',
      images: [
        'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23EFF5E2%22/%3E%3Ctext x=%22200%22 y=%22155%22 font-family=%22Arial%22 font-size=%2232%22 font-weight=%22bold%22 fill=%22%237B9E4E%22 text-anchor=%22middle%22%3EAutumn Break%3C/text%3E%3C/svg%3E'
      ]
    },
    {
      id: 'a4',
      category: 'result',
      categoryLabel: 'Result',
      heading: 'Mid-Term Results Announced',
      date: '30 Sep 2026',
      time: '05:30 PM',
      timestamp: '30 Sep 2026 · 05:30 PM',
      text: 'Mid-Term examination results for all classes have been released. Parents can view their child\'s detailed marksheet in the Result section of the Parent Portal. For any clarification regarding grading, please contact the respective subject teacher during the next PTM.',
      video: 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAQxtZGF0',
      videoPoster: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 225%22%3E%3Cdefs%3E%3ClinearGradient id=%22g2%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop offset=%220%22 stop-color=%22%23C9A227%22/%3E%3Cstop offset=%221%22 stop-color=%22%23E0B93D%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%22400%22 height=%22225%22 fill=%22url(%23g2)%22/%3E%3Ctext x=%22200%22 y=%22125%22 font-family=%22Arial%22 font-size=%2234%22 font-weight=%22bold%22 fill=%22white%22 text-anchor=%22middle%22%3EMid-Term Result%3C/text%3E%3C/svg%3E'
    },
    {
      id: 'a5',
      category: 'event',
      categoryLabel: 'Event',
      heading: 'Science Exhibition — Young Innovators',
      date: '27 Sep 2026',
      time: '10:00 AM',
      timestamp: '27 Sep 2026 · 10:00 AM',
      text: 'The Science Department is organising a Science Exhibition titled "Young Innovators" on 15 November 2026. Students from Grades 4 to 10 are encouraged to submit project ideas to their science teachers by 5 November. Selected projects will be displayed in the school auditorium, and winners will receive certificates and prizes.',
      images: [
        'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23E3F2ED%22/%3E%3Ctext x=%22200%22 y=%22155%22 font-family=%22Arial%22 font-size=%2230%22 font-weight=%22bold%22 fill=%22%232E8B7A%22 text-anchor=%22middle%22%3EScience Fair%3C/text%3E%3C/svg%3E',
        'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23F0E9F8%22/%3E%3Ctext x=%22200%22 y=%22155%22 font-family=%22Arial%22 font-size=%2232%22 font-weight=%22bold%22 fill=%22%234B2E6E%22 text-anchor=%22middle%22%3EProjects%3C/text%3E%3C/svg%3E'
      ]
    },
    {
      id: 'a6',
      category: 'notice',
      categoryLabel: 'Notice',
      heading: 'Fee Submission Reminder',
      date: '25 Sep 2026',
      time: '09:00 AM',
      timestamp: '25 Sep 2026 · 09:00 AM',
      text: 'Parents are kindly reminded to submit the monthly fee by the 10th of every month to avoid late fee charges. Payments can be made online through the Fee & Bills section of this portal, or at the school accounts office between 8:30 AM and 1:00 PM on working days.',
      images: [
        'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23FBE9E9%22/%3E%3Ctext x=%22200%22 y=%22155%22 font-family=%22Arial%22 font-size=%2230%22 font-weight=%22bold%22 fill=%22%238B2020%22 text-anchor=%22middle%22%3EFee Reminder%3C/text%3E%3C/svg%3E'
      ]
    }
  ];

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
  function boot() {
    renderFeed('all');
    initFilters();
    initDrawer();
    console.log('Announcement page ready.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();