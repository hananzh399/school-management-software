// Parent Portal – persistent chat store backed by the parent API.
// Load parent-portal-api.js before this file.
(function (global) {
  'use strict';

  var api = global.PortalAPI;
  var state = { teachers: {} };
  var listeners = [];
  var activeChat = null;
  var currentRegNo = null;
  var sequence = 0;
  var COLORS = [
    'linear-gradient(135deg, #2E8B7A 0%, #4CAF8F 100%)',
    'linear-gradient(135deg, #4267A8 0%, #6794D3 100%)',
    'linear-gradient(135deg, #7B2D8E 0%, #A855C4 100%)',
    'linear-gradient(135deg, #C45050 0%, #E87979 100%)',
    'linear-gradient(135deg, #E08A2E 0%, #F0A22E 100%)',
    'linear-gradient(135deg, #297C8C 0%, #4AAFC1 100%)'
  ];
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var RECEIPT_LABEL = { sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read' };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayLabel(key) {
    var d = parseKey(key);
    var today = dateKey(new Date());
    var yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    if (key === today) return 'Today';
    if (key === dateKey(yesterdayDate)) return 'Yesterday';
    return DAY_NAMES[d.getDay()] + ', ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
  }
  function parseKey(key) {
    var parts = String(key || '').split('-');
    return new Date(Number(parts[0]) || 1970, (Number(parts[1]) || 1) - 1, Number(parts[2]) || 1);
  }
  function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  function listTimeLabel(msg) {
    if (msg.date === dateKey(new Date())) return msg.time;
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (msg.date === dateKey(yesterday)) return 'Yesterday';
    var d = parseKey(msg.date);
    var label = d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
    return d.getFullYear() === new Date().getFullYear() ? label : label + ' ' + d.getFullYear();
  }
  function fullStamp(msg) { return dayLabel(msg.date) + ', ' + msg.time; }
  function stampLabel(ms) {
    var d = new Date(ms);
    return dayLabel(dateKey(d)) + ', ' + formatTime(d);
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (part) {
      return part.charAt(0);
    }).join('').toUpperCase() || '?';
  }
  function notify(events) {
    if (!events.length) return;
    listeners.slice().forEach(function (fn) {
      try { fn(events); } catch (err) { console.error(err); }
    });
  }
  function fromBackend(row) {
    var date = new Date(row.createdAt || Date.now());
    var sentAt = date.getTime();
    return {
      id: String(row.id),
      from: row.from === 'parent' ? 'parent' : 'teacher',
      date: dateKey(date),
      time: formatTime(date),
      text: row.body || '',
      status: row.from === 'parent' ? (row.read ? 'read' : 'sent') : undefined,
      unread: false,
      edited: !!row.editedAt,
      ts: sentAt,
      at: { sent: sentAt, delivered: null, read: null },
      backend: true
    };
  }
  function unreadForThread(threads, id) {
    var thread = threads.find(function (item) {
      return String(item.thread || '') === 't:' + id ||
        (item.staffId != null && String(item.staffId) === String(id));
    });
    return thread ? Number(thread.unread) || 0 : 0;
  }
  function mergeTeachers(teachers, messages, threads) {
    var next = {};
    (Array.isArray(teachers) ? teachers : []).forEach(function (row, index) {
      if (row.staffId == null) return;
      var id = String(row.staffId);
      var threadMessages = messages.filter(function (msg) {
        return String(msg.staffId || '') === id && msg.channel === 'parent_teacher';
      }).map(fromBackend);
      threadMessages.sort(function (a, b) { return a.ts - b.ts; });

      var unread = unreadForThread(threads, id);
      for (var i = threadMessages.length - 1; i >= 0 && unread > 0; i--) {
        if (threadMessages[i].from !== 'parent') {
          threadMessages[i].unread = true;
          unread--;
        }
      }

      var last = threadMessages[threadMessages.length - 1];
      var current = state.teachers[id];
      var teacher = current || {};
      teacher.id = id;
      teacher.rank = last ? last.ts : index;
      teacher.name = row.name || 'Teacher';
      teacher.subject = row.subject || '';
      teacher.initials = initials(teacher.name);
      teacher.color = COLORS[index % COLORS.length];
      teacher.online = null; // the backend does not expose presence
      teacher.lastSeen = '';
      teacher.messages = threadMessages;
      teacher.unread = unreadForThread(threads, id);
      next[id] = teacher;
    });

    Object.keys(state.teachers).forEach(function (id) {
      if (!next[id]) delete state.teachers[id];
    });
    Object.keys(next).forEach(function (id) { state.teachers[id] = next[id]; });
  }
  function loadData() {
    if (!api) return Promise.reject(new Error('Load parent-portal-api.js before parent-portal-chat-store.js.'));
    return api.ensureChildren().then(function () {
      currentRegNo = api.childId();
      return Promise.all([
        api.teachers(),
        api.messages(currentRegNo),
        api.messageThreads(currentRegNo)
      ]);
    }).then(function (results) {
      mergeTeachers(results[0], results[1], results[2]);
      return state;
    });
  }
  function refresh() {
    if (!api || !currentRegNo) return Promise.resolve();
    return Promise.all([
      api.teachers(),
      api.messages(currentRegNo),
      api.messageThreads(currentRegNo)
    ]).then(function (results) {
      mergeTeachers(results[0], results[1], results[2]);
      notify([{ type: 'refresh', teacherId: activeChat }]);
      return state;
    }).catch(function (err) {
      console.warn('Could not refresh parent messages:', err && err.message ? err.message : err);
    });
  }
  var ready = loadData();
  ready.then(function () {
    global.setInterval(refresh, 30000);
  }).catch(function () { /* the page reports the initial connection error */ });

  function get(id) { return state.teachers[String(id)] || null; }
  function list() {
    return Object.keys(state.teachers).map(function (id) { return state.teachers[id]; })
      .sort(function (a, b) { return b.rank - a.rank; });
  }
  function lastMessage(id) {
    var teacher = get(id);
    return teacher && teacher.messages.length ? teacher.messages[teacher.messages.length - 1] : null;
  }
  function unreadCount(id) {
    var teacher = get(id);
    return teacher ? teacher.unread || 0 : 0;
  }
  function totalUnread() {
    return list().reduce(function (sum, teacher) { return sum + unreadCount(teacher.id); }, 0);
  }
  function firstUnreadId(id) {
    var teacher = get(id);
    if (!teacher) return null;
    for (var i = 0; i < teacher.messages.length; i++) {
      if (teacher.messages[i].from !== 'parent' && teacher.messages[i].unread) return teacher.messages[i].id;
    }
    return null;
  }
  function getMessage(id, msgId) {
    var teacher = get(id);
    if (!teacher) return null;
    for (var i = 0; i < teacher.messages.length; i++) {
      if (String(teacher.messages[i].id) === String(msgId)) return teacher.messages[i];
    }
    return null;
  }
  function canChange(id, msgId) {
    var message = getMessage(id, msgId);
    return !!message && message.from === 'parent' && message.status !== 'read' &&
      message.backend === true && /^\d+$/.test(String(message.id));
  }
  function addMessage(id, partial) {
    var teacher = get(id);
    if (!teacher || !currentRegNo || !api) return null;
    var now = new Date();
    var clientId = 'p-' + now.getTime() + '-' + (++sequence);
    var message = {
      id: 'local-' + clientId,
      from: 'parent',
      date: dateKey(now),
      time: formatTime(now),
      text: partial.text || '',
      status: 'sending',
      unread: false,
      edited: false,
      ts: now.getTime(),
      at: { sent: now.getTime(), delivered: null, read: null },
      backend: false
    };
    teacher.messages.push(message);
    teacher.rank = now.getTime();
    api.sendMessage({
      regNo: currentRegNo,
      channel: 'parent_teacher',
      staffId: String(id),
      body: message.text,
      clientId: clientId
    }).then(function () {
      refresh();
    }).catch(function (err) {
      teacher.messages = teacher.messages.filter(function (item) { return item !== message; });
      notify([{ type: 'send-error', teacherId: String(id), error: err }]);
    });
    return message;
  }
  function setStatus(id, msgId, status) {
    var message = getMessage(id, msgId);
    if (!message) return false;
    message.status = status;
    return true;
  }
  function editMessage(id, msgId, text) {
    if (!canChange(id, msgId) || !api) return false;
    var message = getMessage(id, msgId);
    var oldText = message.text;
    message.text = text;
    message.edited = true;
    api.put('/messages/' + encodeURIComponent(message.id), { body: text }).then(refresh).catch(function (err) {
      message.text = oldText;
      message.edited = false;
      notify([{ type: 'edit-error', teacherId: String(id), error: err }]);
    });
    return true;
  }
  function deleteMessage(id, msgId) {
    if (!canChange(id, msgId) || !api) return false;
    var teacher = get(id);
    var message = getMessage(id, msgId);
    teacher.messages = teacher.messages.filter(function (item) { return item !== message; });
    api.del('/messages/' + encodeURIComponent(message.id)).then(refresh).catch(function (err) {
      teacher.messages.push(message);
      teacher.messages.sort(function (a, b) { return a.ts - b.ts; });
      notify([{ type: 'delete-error', teacherId: String(id), error: err }]);
    });
    return true;
  }
  function markRead(id) {
    var teacher = get(id);
    if (!teacher) return;
    teacher.unread = 0;
    teacher.messages.forEach(function (message) { message.unread = false; });
    if (api && currentRegNo) {
      api.markMessagesRead(currentRegNo, 't:' + String(id)).then(refresh).catch(function (err) {
        console.warn('Could not mark the parent thread read:', err && err.message ? err.message : err);
      });
    }
  }
  function markUnread() { return false; } // no mark-unread endpoint exists in the backend
  function clear() { return false; } // no clear-thread endpoint exists in the backend
  function subscribe(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (item) { return item !== fn; }); };
  }
  function setActive(id) { activeChat = id == null ? null : String(id); }
  function isTyping() { return false; } // no live typing/push channel exists in the backend
  function receiptHTML(status) {
    var key = RECEIPT_LABEL[status] ? status : 'sent';
    var svg;
    if (key === 'sending') {
      svg = '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.8"/><path d="M6 3.4V6l1.8 1.1"/></svg>';
    } else if (key === 'sent') {
      svg = '<svg viewBox="0 0 14.5 11" aria-hidden="true"><path d="M1.5 5.8 5.3 9.4 13 1.6"/></svg>';
    } else {
      svg = '<svg viewBox="0 0 19 11" aria-hidden="true"><path d="M1.5 5.8 5.3 9.4 13 1.6"/><path d="M6 5.8 9.8 9.4 17.5 1.6"/></svg>';
    }
    return '<span class="receipt receipt-' + key + '" role="img" aria-label="' + RECEIPT_LABEL[key] +
      '" title="' + RECEIPT_LABEL[key] + '">' + svg + '</span>';
  }

  global.ChatStore = {
    ready: ready,
    refresh: refresh,
    error: null,
    list: list,
    get: get,
    lastMessage: lastMessage,
    unreadCount: unreadCount,
    totalUnread: totalUnread,
    firstUnreadId: firstUnreadId,
    addMessage: addMessage,
    setStatus: setStatus,
    getMessage: getMessage,
    canChange: canChange,
    editMessage: editMessage,
    deleteMessage: deleteMessage,
    markRead: markRead,
    markUnread: markUnread,
    clear: clear,
    receiptHTML: receiptHTML,
    dayLabel: dayLabel,
    stampLabel: stampLabel,
    subscribe: subscribe,
    isTyping: isTyping,
    setActive: setActive,
    listTimeLabel: listTimeLabel,
    fullStamp: fullStamp
  };
})(window);
