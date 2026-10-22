// Parent Portal – Messages (Teacher List) page script
// Requires parent-portal-chat-store.js to be loaded first.
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

  const Store = window.ChatStore;
  if (!Store) {
    console.error('parent-portal-chat-store.js must be loaded before parent-portal-messages.js');
    return;
  }

  // ---------- Language ----------
  const I18n = window.PortalI18n;
  if (I18n) I18n.apply();
  const tr = (key, fallback) => (I18n ? I18n.t(key) : fallback);
  const onScreen = (text) => (I18n ? I18n.iso(text) : text);
  const isUrdu = () => !!I18n && I18n.getLang() === 'ur';
  // New strings fall back to English until their keys are added to parent-portal-i18n.js
  const trf = (key, fallback) => {
    const v = I18n ? I18n.t(key) : '';
    return !v || v === key ? fallback : v;
  };

  // Teacher names and message text are real data and are shown as written.
  // The subject, time labels, receipts and status words are translated.
  const SUBJECT_KEYS = {
    'Mathematics': 'subMathematics',
    'English': 'subEnglish',
    'Science': 'ttScience',
    'Social Studies': 'ttSocial',
    'Hindi': 'ttHindi',
    'Computer Science': 'subComputerScience'
  };
  function subjectLabel(subject) {
    return SUBJECT_KEYS[subject] ? tr(SUBJECT_KEYS[subject], subject) : subject;
  }

  const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "10:32 AM" / "Yesterday" / "3 Oct" / "3 Oct 2025" -> Urdu equivalents
  function localTimeLabel(label) {
    if (!isUrdu() || !label) return label;
    if (label === 'Yesterday') return tr('yesterday', label);
    let m = /^(\d{1,2}:\d{2}) (AM|PM)$/i.exec(label);
    if (m) return `${m[1]} ${tr(m[2].toUpperCase() === 'AM' ? 'timeAM' : 'timePM', m[2])}`;
    m = /^(\d{1,2}) ([A-Za-z]{3})(?: (\d{4}))?$/.exec(label);
    if (m) {
      const idx = EN_MONTHS.indexOf(m[2]);
      if (idx >= 0) return `${m[1]} ${I18n.monthShort(idx)}${m[3] ? ' ' + m[3] : ''}`;
    }
    return label;
  }

  // The store builds the receipt icon with English labels; swap them for Urdu
  function localReceiptHTML(status) {
    const html = Store.receiptHTML(status);
    if (!isUrdu()) return html;
    const keys = { Sending: 'receiptSending', Sent: 'receiptSent', Delivered: 'receiptDelivered', Read: 'receiptRead' };
    return html.replace(/(aria-label|title)="(Sending|Sent|Delivered|Read)"/g,
      (m, attr, word) => `${attr}="${tr(keys[word], word)}"`);
  }

  // ---------- State ----------
  let filter = 'all';   // 'all' | 'unread'
  let query = '';

  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function localLastSeen(value) {
    return value || tr('offline', 'Offline');
  }

  // ---------- Row ----------
  function buildRow(t) {
    const last = Store.lastMessage(t.id);
    const unread = Store.unreadCount(t.id);

    const row = el('a', 'msg-row' + (unread ? ' is-unread' : ''));
    row.href = 'parent-portal-chat.html?teacher=' + encodeURIComponent(t.id) +
      '&child=' + encodeURIComponent(Store.currentRegNo() || '');
    row.dataset.teacherId = t.id;

    // Avatar + presence
    const avatarWrap = el('div', 'msg-row-avatar-wrap');
    const avatar = el('div', 'msg-row-avatar', t.initials);
    avatar.style.background = t.color;
    const presence = el('span', 'msg-row-presence' + (t.online ? ' is-online' : ''));
    presence.title = t.online === true ? tr('online', 'Online') :
      (t.lastSeen ? localLastSeen(t.lastSeen) : tr('presenceUnavailable', 'Live status unavailable'));
    avatarWrap.appendChild(avatar);
    avatarWrap.appendChild(presence);

    // Name + time
    const body = el('div', 'msg-row-body');
    const top = el('div', 'msg-row-top');
    top.appendChild(el('span', 'msg-row-name', t.name));
    if (last) top.appendChild(el('span', 'msg-row-time', onScreen(localTimeLabel(Store.listTimeLabel(last)))));
    body.appendChild(top);

    // Subject
    body.appendChild(el('span', 'msg-row-subject', onScreen(subjectLabel(t.subject))));

    // Preview (+ receipt when the last message was sent by the parent)
    const bottom = el('div', 'msg-row-bottom');
    const typing = Store.isTyping(t.id);
    const preview = el('div', 'msg-row-preview' + (last || typing ? '' : ' is-empty'));

    if (typing) {
      // Teacher is typing right now
      const wrap = el('span', 'msg-row-typing', onScreen(tr('typing', 'typing')));
      const dots = el('span', 'msg-row-typing-dots');
      dots.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));
      wrap.appendChild(dots);
      preview.appendChild(wrap);
    } else if (!last) {
      preview.appendChild(el('span', 'msg-row-preview-text', onScreen(tr('noMessagesYet', 'No messages yet'))));
    } else {
      if (last.from === 'parent') {
        const r = el('span');
        r.innerHTML = localReceiptHTML(last.status);
        preview.appendChild(r.firstChild);
      }
      preview.appendChild(el('span', 'msg-row-preview-text', last.text));
    }
    bottom.appendChild(preview);

    if (unread) {
      const badge = el('span', 'msg-row-badge', String(unread));
      badge.setAttribute('aria-label', tr('unreadN', '{n} unread').replace('{n}', String(unread)));
      bottom.appendChild(badge);
    }
    body.appendChild(bottom);

    row.appendChild(avatarWrap);
    row.appendChild(body);
    return row;
  }

  // ---------- Siblings ----------
  let switching = false;

  function renderSiblings() {
    const box = $('siblingSwitch');
    const chips = $('siblingChips');
    if (!box || !chips) return;
    const sibs = Store.siblings();
    if (sibs.length < 2) { box.hidden = true; return; }   // single child: nothing changes

    const current = sibs.find((s) => s.active) || sibs[0];
    $('siblingLabel').textContent =
      trf('messagesFor', 'Messages for {name}').replace('{name}', current.name) +
      (current.className ? ' · ' + current.className : '');

    chips.innerHTML = '';
    sibs.forEach((s) => {
      const btn = el('button', 'sibling-chip' + (s.active ? ' active' : ''));
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', s.active ? 'true' : 'false');
      btn.dataset.regNo = s.regNo;
      btn.disabled = switching;

      const avatar = el('span', 'sibling-chip-avatar', s.initials);
      avatar.style.background = s.color;
      btn.appendChild(avatar);
      btn.appendChild(el('span', 'sibling-chip-name', s.firstName));
      if (s.unread) {
        const badge = el('span', 'sibling-chip-badge', String(s.unread));
        badge.setAttribute('aria-label', tr('unreadN', '{n} unread').replace('{n}', String(s.unread)));
        btn.appendChild(badge);
      }
      btn.addEventListener('click', () => switchTo(s.regNo));
      chips.appendChild(btn);
    });
    box.hidden = false;
  }

  function switchTo(regNo) {
    if (switching || regNo === Store.currentRegNo()) return;
    switching = true;
    renderSiblings();
    Store.switchChild(regNo).catch((err) => {
      if (window.PortalAPI) window.PortalAPI.showError(err);
    }).then(() => {
      switching = false;
      renderAll();
    });
  }

  function renderAll() {
    renderSiblings();
    renderList();
  }

  // ---------- List ----------
  function renderList() {
    const list = $('msgTeacherList');
    const empty = $('msgEmpty');
    const q = query.trim().toLowerCase();

    const items = Store.list().filter((t) => {
      if (filter === 'unread' && Store.unreadCount(t.id) === 0) return false;
      if (q && t.name.toLowerCase().indexOf(q) === -1 && t.subject.toLowerCase().indexOf(q) === -1 &&
          subjectLabel(t.subject).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    list.innerHTML = '';
    items.forEach((t) => list.appendChild(buildRow(t)));

    // Unread count on the filter chip
    const total = Store.totalUnread();
    const countEl = $('msgUnreadCount');
    countEl.textContent = total;
    countEl.hidden = total === 0;

    // Empty states
    if (items.length === 0) {
      if (q) {
        $('msgEmptyTitle').textContent = onScreen(tr('noTeachers', 'No teachers found'));
        $('msgEmptyText').textContent = onScreen(tr('noTeachersText', 'Try a different name or subject.'));
      } else if (filter === 'all') {
        $('msgEmptyTitle').textContent = onScreen(trf('noConversations', 'No conversations yet'));
        $('msgEmptyText').textContent = onScreen(trf('noConversationsText', 'No teachers are linked to this child yet.'));
      } else {
        $('msgEmptyTitle').textContent = onScreen(tr('caughtUp', 'You\'re all caught up'));
        $('msgEmptyText').textContent = onScreen(tr('noUnread', 'There are no unread messages right now.'));
      }
      empty.hidden = false;
    } else {
      empty.hidden = true;
    }
  }

  // ---------- Search + filters ----------
  function initToolbar() {
    const search = $('msgSearch');
    const clear = $('msgSearchClear');

    search.addEventListener('input', () => {
      query = search.value;
      clear.hidden = query.length === 0;
      renderList();
    });

    clear.addEventListener('click', () => {
      search.value = '';
      query = '';
      clear.hidden = true;
      renderList();
      search.focus();
    });

    document.querySelectorAll('.msg-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        filter = btn.dataset.filter;
        document.querySelectorAll('.msg-filter').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        renderList();
      });
    });
  }

  // ---------- Drawer ----------
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
    const hamburger = $('hamburgerBtn');
    const drawer = $('sidePanel');
    const overlay = $('sidePanelOverlay');
    const closeBtn = $('sidePanelClose');
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

  // ---------- Boot ----------
  function boot() {
    initDrawer();
    initToolbar();
    renderAll();

    // Live updates: typing, receipts, new messages and sibling switches while this page is open
    Store.subscribe(renderAll);

    // Coming back with the browser's Back button can show a cached copy of
    // this page, so re-read the store to pick up new previews and receipts.
    window.addEventListener('pageshow', (e) => { if (e.persisted) renderAll(); });
  }

  function start() {
    const ready = Store.ready || Promise.resolve();
    ready.then(boot).catch((err) => {
      boot();
      if (window.PortalAPI) window.PortalAPI.showError(err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();