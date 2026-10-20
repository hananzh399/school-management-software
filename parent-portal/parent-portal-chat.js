// Parent Portal – Chat page script
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
    console.error('parent-portal-chat-store.js must be loaded before parent-portal-chat.js');
    return;
  }

  // ===================================================
  // Language
  // ===================================================
  const I18n = window.PortalI18n;
  if (I18n) I18n.apply();
  const tr = (key, fallback) => (I18n ? I18n.t(key) : fallback);
  const onScreen = (text) => (I18n ? I18n.iso(text) : text);
  const isUrdu = () => !!I18n && I18n.getLang() === 'ur';

  // Message text is real data and is shown as written. Everything around it
  // (dates, times, status words, menus, dialogs) follows the chosen language.
  const SUBJECT_KEYS = {
    'Mathematics': 'subMathematics', 'English': 'subEnglish', 'Science': 'ttScience',
    'Social Studies': 'ttSocial', 'Hindi': 'ttHindi', 'Computer Science': 'subComputerScience'
  };
  const subjectLabel = (s) => (SUBJECT_KEYS[s] ? tr(SUBJECT_KEYS[s], s) : s);

  const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const EN_DAYS_FULL = {
    Sunday: 'daySunday', Monday: 'dayMonday', Tuesday: 'dayTuesday', Wednesday: 'dayWednesday',
    Thursday: 'dayThursday', Friday: 'dayFriday', Saturday: 'daySaturday'
  };

  // "09:35 AM" -> "09:35 صبح" in Urdu
  function localClock(text) {
    if (!isUrdu() || !text) return text;
    const m = /^(\d{1,2}:\d{2}) (AM|PM)$/i.exec(text);
    return m ? `${m[1]} ${tr(m[2].toUpperCase() === 'AM' ? 'timeAM' : 'timePM', m[2])}` : text;
  }

  // "Today" / "Yesterday" / "Sat, 10 Oct 2026" -> Urdu
  function localDayLabel(label) {
    if (!isUrdu() || !label) return label;
    if (label === 'Today') return tr('periodToday', label);
    if (label === 'Yesterday') return tr('yesterday', label);
    const m = /^([A-Za-z]{3}), (\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(label);
    if (m) {
      const wd = EN_WEEKDAYS.indexOf(m[1]);
      const mo = EN_MONTHS.indexOf(m[3]);
      if (wd >= 0 && mo >= 0) return `${I18n.weekdayShort(wd)}، ${m[2]} ${I18n.monthShort(mo)} ${m[4]}`;
    }
    return label;
  }

  // "Today, 09:35 AM" -> Urdu date + time
  function localStamp(label) {
    if (!isUrdu() || !label) return label;
    const cut = label.lastIndexOf(', ');
    if (cut < 0) return label;
    return `${localDayLabel(label.slice(0, cut))}، ${localClock(label.slice(cut + 2))}`;
  }

  // Teacher.lastSeen is e.g. "yesterday at 6:40 PM" or "on Saturday at 8:30 PM"
  function lastSeenText(raw) {
    if (!isUrdu()) return 'Last seen ' + raw;
    let m = /^yesterday at (.+)$/i.exec(raw || '');
    if (m) return tr('lastSeenYesterday', 'Last seen yesterday at {time}').replace('{time}', localClock(m[1]));
    m = /^on ([A-Za-z]+) at (.+)$/i.exec(raw || '');
    if (m && EN_DAYS_FULL[m[1]]) {
      return tr('lastSeenDay', 'Last seen on {day} at {time}')
        .replace('{day}', tr(EN_DAYS_FULL[m[1]], m[1])).replace('{time}', localClock(m[2]));
    }
    return tr('lastSeenOther', 'Last seen {when}').replace('{when}', raw);
  }

  // ===================================================
  // Config
  // ===================================================
  const quickReplies = () => [
    tr('qrThanks', 'Thank you!'),
    tr('qrNoted', 'Noted, will do.'),
    tr('qrCall', 'Can we speak on a call?')
  ];

  // How long the parent must stop typing before "stopped typing" is sent
  const PARENT_TYPING_IDLE_MS = 3000;

  const READ_LOCK_MSG = 'Read messages can\'t be edited or deleted.';

  const CHAT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  // ===================================================
  // State
  // ===================================================
  let teacherId = 1;
  let teacher = null;
  let firstUnreadId = null;
  let openedUnreadCount = 0;
  let teacherTyping = false;
  let parentTypingActive = false;
  let parentTypingTimer = null;
  let editingId = null;      // id of the message being edited
  let savedDraft = '';       // text that was in the box before editing started
  let sheetMsgId = null;     // message the info / action sheet is open for
  let toastTimer = null;

  // ===================================================
  // Helpers
  // ===================================================
  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function getTeacherIdFromURL() {
    const params = new URLSearchParams(window.location.search);
    const id = parseInt(params.get('teacher'), 10);
    return (id && Store.get(id)) ? id : 1;
  }

  function lastMsg() {
    return teacher.messages[teacher.messages.length - 1] || null;
  }

  function showToast(message) {
    const t = $('chatToast');
    if (!t) return;
    t.textContent = onScreen(message);
    t.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-visible'), 2800);
  }

  function isNearBottom() {
    const c = $('chatMessages');
    return c.scrollHeight - c.scrollTop - c.clientHeight < 140;
  }

  function scrollToBottom(smooth) {
    const c = $('chatMessages');
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  // ===================================================
  // Render: top bar
  // ===================================================
  function renderPresence() {
    const presence = $('chatTopPresence');
    if (teacherTyping) {
      presence.textContent = onScreen(tr('typingEllipsis', 'typing…'));
      presence.classList.add('is-typing');
      presence.classList.remove('is-online');
    } else {
      presence.textContent = onScreen(teacher.online ? tr('online', 'Online') : lastSeenText(teacher.lastSeen));
      presence.classList.remove('is-typing');
      presence.classList.toggle('is-online', teacher.online);
    }
  }

  function renderTopBar() {
    const avatar = $('chatTopAvatar');
    avatar.textContent = teacher.initials;
    avatar.style.background = teacher.color;

    $('chatTopName').textContent = teacher.name;
    $('chatTopSubject').textContent = onScreen(subjectLabel(teacher.subject));
    $('chatTopDot').classList.toggle('is-online', teacher.online);
    renderPresence();

    document.title = teacher.name + ' · Greenwood High';
  }

  // ===================================================
  // Render: messages
  // ===================================================
  function buildDayDivider(label) {
    const d = el('div', 'chat-date-divider');
    d.appendChild(el('span', '', onScreen(label)));
    return d;
  }

  function buildUnreadDivider(count) {
    const d = el('div', 'chat-unread-divider');
    d.appendChild(el('span', '', onScreen(count === 1
      ? tr('chatUnreadOne', '1 unread message')
      : tr('chatUnreadMany', '{n} unread messages').replace('{n}', String(count)))));
    return d;
  }

  function createBubble(msg, prev, next) {
    const isSent = msg.from === 'parent';
    const sameAsPrev = prev && prev.from === msg.from && prev.date === msg.date;
    const sameAsNext = next && next.from === msg.from && next.date === msg.date;

    const bubble = el('div', 'chat-bubble chat-bubble-' + (isSent ? 'sent' : 'received'));
    if (!sameAsPrev) bubble.classList.add('is-first');
    if (!sameAsNext) bubble.classList.add('is-last');
    bubble.dataset.id = msg.id;

    // Your own messages can be tapped for details (and to edit / delete)
    if (isSent) {
      bubble.classList.add('is-tappable');
      bubble.tabIndex = 0;
      bubble.setAttribute('role', 'button');
      bubble.setAttribute('aria-label', tr('yourMessageAria', 'Your message. Press for details.'));
    }

    bubble.appendChild(el('p', 'chat-bubble-text', msg.text));

    const meta = el('div', 'chat-bubble-meta');
    if (msg.edited) meta.appendChild(el('span', 'chat-bubble-edited', onScreen(tr('edited', 'Edited'))));
    const timeEl = el('span', 'chat-bubble-time', onScreen(localClock(msg.time)));
    timeEl.title = isUrdu() ? localStamp(Store.dayLabel(msg.date) + ', ' + msg.time) : Store.dayLabel(msg.date) + ', ' + msg.time;
    meta.appendChild(timeEl);
    if (isSent) {
      const slot = el('span', 'receipt-slot');
      slot.innerHTML = Store.receiptHTML(msg.status);
      meta.appendChild(slot);
    }
    bubble.appendChild(meta);
    return bubble;
  }

  function buildEmptyState() {
    const wrap = el('div', 'chat-empty');
    const icon = el('span', 'chat-empty-icon');
    icon.innerHTML = CHAT_ICON;
    wrap.appendChild(icon);
    wrap.appendChild(el('p', 'chat-empty-title', onScreen(tr('noMessagesYet', 'No messages yet'))));
    wrap.appendChild(el('p', 'chat-empty-text', onScreen(tr('chatEmptyText', 'Send a message to start the conversation with {name}.').replace('{name}', teacher.name))));
    return wrap;
  }

  function renderMessages() {
    const c = $('chatMessages');
    c.innerHTML = '';
    const msgs = teacher.messages;

    if (!msgs.length) {
      c.appendChild(buildEmptyState());
      return;
    }

    msgs.forEach((m, i) => {
      const prev = msgs[i - 1];
      const next = msgs[i + 1];
      if (!prev || prev.date !== m.date) c.appendChild(buildDayDivider(localDayLabel(Store.dayLabel(m.date))));
      if (m.id === firstUnreadId) c.appendChild(buildUnreadDivider(openedUnreadCount));
      c.appendChild(createBubble(m, prev, next));
    });
  }

  function appendMessage(msg, prev) {
    const c = $('chatMessages');
    const empty = c.querySelector('.chat-empty');
    if (empty) empty.remove();

    if (!prev || prev.date !== msg.date) {
      c.insertBefore(buildDayDivider(localDayLabel(Store.dayLabel(msg.date))), $('chatTyping'));
    } else if (prev.from === msg.from) {
      const bubbles = c.querySelectorAll('.chat-bubble:not(.chat-typing)');
      const lastBubble = bubbles[bubbles.length - 1];
      if (lastBubble) lastBubble.classList.remove('is-last');
    }

    const bubble = createBubble(msg, prev, null);
    bubble.classList.add('is-new');
    // Keep the typing bubble (if any) as the very last item
    c.insertBefore(bubble, $('chatTyping'));
  }

  function updateReceipt(msgId, status) {
    const slot = document.querySelector('.chat-bubble[data-id="' + msgId + '"] .receipt-slot');
    if (slot) slot.innerHTML = Store.receiptHTML(status);
  }

  // Re-draw the conversation (after a delete) without losing the scroll spot
  function rerender() {
    const c = $('chatMessages');
    const top = c.scrollTop;
    renderMessages();
    if (teacherTyping) c.appendChild(buildTypingBubble());
    c.scrollTop = top;
  }

  // ===================================================
  // Typing indicator (teacher → parent)
  // ===================================================
  function buildTypingBubble() {
    const bubble = el('div', 'chat-bubble chat-bubble-received chat-typing is-first is-last');
    bubble.id = 'chatTyping';
    bubble.setAttribute('aria-label', tr('typingAria', '{name} is typing').replace('{name}', teacher.name));
    for (let i = 0; i < 3; i++) bubble.appendChild(el('span', 'chat-typing-dot'));
    return bubble;
  }

  function setTeacherTyping(on) {
    if (teacherTyping === on) return;
    teacherTyping = on;
    renderPresence();

    const c = $('chatMessages');
    const existing = $('chatTyping');

    if (on && !existing) {
      const nearBottom = isNearBottom();
      const empty = c.querySelector('.chat-empty');
      if (empty) empty.remove();
      c.appendChild(buildTypingBubble());
      if (nearBottom) scrollToBottom(true);
    } else if (!on && existing) {
      existing.remove();
    }
  }

  // Parent → teacher. Emits "typing" / "stopped typing" events so the other
  // side can show the indicator. Replace the body of emitParentTyping with a
  // real call (WebSocket, API, etc.) when the backend is ready.
  function emitParentTyping(isTyping) {
    // e.g. socket.emit('typing', { teacherId: teacherId, typing: isTyping });
  }

  function handleParentTyping(hasText) {
    clearTimeout(parentTypingTimer);
    if (!hasText) {
      stopParentTyping();
      return;
    }
    if (!parentTypingActive) {
      parentTypingActive = true;
      emitParentTyping(true);
    }
    parentTypingTimer = setTimeout(stopParentTyping, PARENT_TYPING_IDLE_MS);
  }

  function stopParentTyping() {
    clearTimeout(parentTypingTimer);
    if (parentTypingActive) {
      parentTypingActive = false;
      emitParentTyping(false);
    }
  }

  // ===================================================
  // Live updates from the store (receipts, typing, new messages)
  // ===================================================
  function onStoreEvents(events) {
    events.forEach((e) => {
      if (e.teacherId !== teacherId) return;

      if (e.type === 'status') {
        updateReceipt(e.msgId, e.status);
        if (sheetMsgId === e.msgId) renderSheet(Store.getMessage(teacherId, e.msgId));
        if (e.status === 'read' && editingId === e.msgId) {
          cancelEdit();
          showToast(tr('toastReadNoEdit', 'That message was just read, so it can no longer be edited.'));
        }
      } else if (e.type === 'typing') {
        setTeacherTyping(e.typing);
      } else if (e.type === 'message') {
        const nearBottom = isNearBottom();
        const prev = teacher.messages[teacher.messages.length - 2] || null;
        appendMessage(e.msg, prev);
        renderQuickReplies();
        if (nearBottom) scrollToBottom(true);
      }
    });
  }

  // ===================================================
  // Quick replies
  // ===================================================
  function renderQuickReplies() {
    const q = $('chatQuick');
    const last = lastMsg();
    const show = !!last && last.from === 'teacher' && !editingId;
    q.hidden = !show;

    if (show && !q.children.length) {
      quickReplies().forEach((label) => {
        const chip = el('button', 'chat-quick-chip', label);
        chip.type = 'button';
        chip.addEventListener('click', () => send(label));
        q.appendChild(chip);
      });
    }
  }

  // ===================================================
  // Sending
  // ===================================================
  function send(rawText) {
    const text = (rawText || '').trim();
    if (!text) return;

    stopParentTyping();
    const prev = lastMsg();
    const msg = Store.addMessage(teacherId, { from: 'parent', text: text });
    if (!msg) return;

    appendMessage(msg, prev);
    renderQuickReplies();
    scrollToBottom(true);
  }

  // ===================================================
  // Input
  // ===================================================
  function updateSendButton() {
    const input = $('chatInput');
    $('chatSendBtn').disabled = input.value.trim().length === 0;
  }

  function autoResizeInput() {
    const input = $('chatInput');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  function submitInput() {
    const input = $('chatInput');
    if (editingId) {
      saveEdit(input.value);
      input.focus();
      return;
    }
    send(input.value);
    input.value = '';
    input.style.height = 'auto';
    updateSendButton();
    input.focus(); // keeps the keyboard open on phones
  }

  function initInput() {
    const input = $('chatInput');
    const sendBtn = $('chatSendBtn');
    // Enter sends on desktop; on touch devices Enter adds a new line
    const finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

    input.addEventListener('input', () => {
      autoResizeInput();
      updateSendButton();
      handleParentTyping(input.value.trim().length > 0);
    });
    input.addEventListener('blur', stopParentTyping);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && finePointer) {
        e.preventDefault();
        if (input.value.trim()) submitInput();
      }
    });
    input.addEventListener('focus', () => setTimeout(() => scrollToBottom(false), 250));
    sendBtn.addEventListener('click', submitInput);
    updateSendButton();
  }

  // ===================================================
  // Message info + edit / delete (edit and delete only until read)
  // ===================================================
  const INFO_ROWS = [
    { key: 'sent',      label: 'Sent' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'read',      label: 'Read' }
  ];

  const PENDING_TEXT = { sent: 'Sending…', delivered: 'Not delivered yet', read: 'Not read yet' };
  const PENDING_KEYS = { sent: 'pendSending', delivered: 'pendNotDelivered', read: 'pendNotRead' };
  const INFO_KEYS = { sent: 'receiptSent', delivered: 'receiptDelivered', read: 'receiptRead' };

  function renderSheet(msg) {
    if (!msg) { closeSheet(); return; }

    $('chatSheetPreview').textContent = msg.text;

    // When the message was sent, delivered and read
    const info = $('chatInfo');
    info.innerHTML = '';
    const at = msg.at || {};
    INFO_ROWS.forEach((row) => {
      const done = row.key === 'sent' ? msg.status !== 'sending' : !!at[row.key];
      const line = el('div', 'chat-info-row');
      const icon = el('span', 'chat-info-icon');
      icon.innerHTML = Store.receiptHTML(row.key);
      line.appendChild(icon);
      line.appendChild(el('span', 'chat-info-label', onScreen(tr(INFO_KEYS[row.key], row.label))));
      line.appendChild(el('span', 'chat-info-value' + (done ? '' : ' is-pending'),
        onScreen(done ? localStamp(Store.stampLabel(at[row.key] || at.sent)) : tr(PENDING_KEYS[row.key], PENDING_TEXT[row.key]))));
      info.appendChild(line);
    });

    // Edit / delete are only offered until the message is read
    const canChange = Store.canChange(teacherId, msg.id);
    $('chatSheetActions').hidden = !canChange;
    $('chatSheetNote').textContent = canChange
      ? onScreen(tr('sheetNoteCan', 'You can edit or delete this message until it has been read.'))
      : onScreen(tr('sheetNoteLocked', 'This message has been read, so it can\'t be edited or deleted.'));
  }

  function openSheet(msgId) {
    const msg = Store.getMessage(teacherId, msgId);
    if (!msg || msg.from !== 'parent') return;
    sheetMsgId = msgId;
    renderSheet(msg);
    $('chatSheetOverlay').hidden = false;
    $('chatSheet').hidden = false;
    $('chatSheet').querySelector(Store.canChange(teacherId, msgId) ? '[data-action="edit"]' : '[data-action="cancel"]').focus();
  }

  function closeSheet() {
    sheetMsgId = null;
    $('chatSheetOverlay').hidden = true;
    $('chatSheet').hidden = true;
  }

  function markBubbleEditing(msgId, on) {
    const b = document.querySelector('.chat-bubble[data-id="' + msgId + '"]');
    if (b) b.classList.toggle('is-editing', on);
  }

  function startEdit(msg) {
    const input = $('chatInput');
    if (!editingId) savedDraft = input.value; // keep any half-typed message
    else markBubbleEditing(editingId, false);

    editingId = msg.id;
    markBubbleEditing(msg.id, true);
    input.value = msg.text;
    autoResizeInput();
    $('chatEditText').textContent = msg.text;
    $('chatEditBar').hidden = false;
    $('chatSendBtn').classList.add('is-editing');
    $('chatSendBtn').setAttribute('aria-label', tr('saveChanges', 'Save changes'));
    updateSendButton();
    renderQuickReplies();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function cancelEdit() {
    if (!editingId) return;
    markBubbleEditing(editingId, false);
    editingId = null;

    const input = $('chatInput');
    input.value = savedDraft;
    savedDraft = '';
    autoResizeInput();
    $('chatEditBar').hidden = true;
    $('chatSendBtn').classList.remove('is-editing');
    $('chatSendBtn').setAttribute('aria-label', tr('sendMessageAria', 'Send message'));
    updateSendButton();
    renderQuickReplies();
  }

  function saveEdit(rawText) {
    const text = (rawText || '').trim();
    const id = editingId;
    const msg = Store.getMessage(teacherId, id);

    if (!text) return;
    if (!msg || !Store.canChange(teacherId, id)) {
      cancelEdit();
      showToast(tr('toastReadLock', READ_LOCK_MSG));
      return;
    }
    if (text === msg.text) { // nothing changed
      cancelEdit();
      return;
    }

    Store.editMessage(teacherId, id, text);
    const bubble = document.querySelector('.chat-bubble[data-id="' + id + '"]');
    if (bubble) {
      bubble.querySelector('.chat-bubble-text').textContent = text;
      if (!bubble.querySelector('.chat-bubble-edited')) {
        const meta = bubble.querySelector('.chat-bubble-meta');
        meta.insertBefore(el('span', 'chat-bubble-edited', onScreen(tr('edited', 'Edited'))), meta.firstChild);
      }
    }
    cancelEdit();
    showToast(tr('toastUpdated', 'Message updated'));
  }

  function deleteMessage(msg) {
    if (!window.confirm(tr('confirmDelete', 'Delete this message? It will be removed from the conversation.'))) return;
    // Re-check: it may have been read while the confirm box was open
    if (!Store.deleteMessage(teacherId, msg.id)) {
      showToast(tr('toastReadLock', READ_LOCK_MSG));
      return;
    }
    if (editingId === msg.id) cancelEdit();
    rerender();
    renderQuickReplies();
    showToast(tr('toastDeleted', 'Message deleted'));
  }

  function handleSheetAction(action) {
    const msgId = sheetMsgId;
    closeSheet();
    if (action === 'cancel' || !msgId) return;

    const msg = Store.getMessage(teacherId, msgId);
    if (!msg || !Store.canChange(teacherId, msgId)) {
      showToast(tr('toastReadLock', READ_LOCK_MSG));
      return;
    }
    if (action === 'edit') startEdit(msg);
    if (action === 'delete') deleteMessage(msg);
  }

  function initSheet() {
    const c = $('chatMessages');

    // Tap one of your own messages
    c.addEventListener('click', (e) => {
      const bubble = e.target.closest('.chat-bubble-sent');
      if (bubble && bubble.dataset.id) openSheet(bubble.dataset.id);
    });
    c.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('is-tappable')) {
        e.preventDefault();
        openSheet(e.target.dataset.id);
      }
    });

    $('chatSheetOverlay').addEventListener('click', closeSheet);
    $('chatSheet').querySelectorAll('.chat-sheet-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleSheetAction(btn.dataset.action));
    });
    $('chatEditCancel').addEventListener('click', cancelEdit);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('chatSheet').hidden) closeSheet();
      else if (editingId) cancelEdit();
    });
  }

  // ===================================================
  // Scroll-to-latest button
  // ===================================================
  function initScrollButton() {
    const c = $('chatMessages');
    const btn = $('chatScrollBtn');
    c.addEventListener('scroll', () => {
      const distance = c.scrollHeight - c.scrollTop - c.clientHeight;
      btn.hidden = distance < 240;
    }, { passive: true });
    btn.addEventListener('click', () => scrollToBottom(true));
  }

  // ===================================================
  // Options menu
  // ===================================================
  function initMenu() {
    const btn = $('chatMenuBtn');
    const menu = $('chatMenu');

    function setOpen(open) {
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

    menu.querySelectorAll('.chat-menu-item').forEach((item) => {
      item.addEventListener('click', () => {
        setOpen(false);
        if (item.dataset.action === 'mark-unread') {
          Store.markUnread(teacherId);
          window.location.href = 'parent-portal-messages.html';
        } else if (item.dataset.action === 'clear') {
          if (window.confirm(tr('confirmClear', 'Clear all messages with {name}? This cannot be undone.').replace('{name}', teacher.name))) {
            cancelEdit();
            Store.clear(teacherId);
            firstUnreadId = null;
            setTeacherTyping(false);
            $('chatQuick').innerHTML = '';
            renderMessages();
            renderQuickReplies();
          }
        }
      });
    });
  }

  // ===================================================
  // Boot
  // ===================================================
  function boot() {
    teacherId = getTeacherIdFromURL();
    teacher = Store.get(teacherId);
    Store.setActive(teacherId); // replies that arrive here are not "unread"

    // Remember where the unread messages start, then mark them read
    openedUnreadCount = Store.unreadCount(teacherId);
    firstUnreadId = Store.firstUnreadId(teacherId);
    Store.markRead(teacherId);

    renderTopBar();
    renderMessages();
    renderQuickReplies();
    initInput();
    initScrollButton();
    initMenu();
    initSheet();

    // Land on the first unread message, otherwise the latest one
    const divider = document.querySelector('.chat-unread-divider');
    if (divider) {
      $('chatMessages').scrollTop = Math.max(0, divider.offsetTop - 12);
    } else {
      scrollToBottom(false);
    }

    // Teacher may already be typing (e.g. you came back from the list)
    if (Store.isTyping(teacherId)) setTeacherTyping(true);

    Store.subscribe(onStoreEvents);

    if (window.innerWidth > 600) $('chatInput').focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();