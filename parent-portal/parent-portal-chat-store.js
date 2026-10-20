// Parent Portal – shared chat store
// Used by parent-portal-messages.js and parent-portal-chat.js so that unread
// counts, last-message previews and read receipts stay in sync between pages.
//
// Data lives in sessionStorage for now. When a backend is ready, replace the
// load()/save() functions and the methods below with API calls; the pages only
// talk to the ChatStore API at the bottom of this file.
(function (global) {
  'use strict';

  var STORAGE_KEY = 'ppChatState.v3';

  // ---------------------------------------------------
  // Dates. Messages store a local 'YYYY-MM-DD' date; the label shown in the
  // chat ("Today", "Yesterday", "Sat, 10 Oct 2026") is worked out when rendering,
  // so it stays correct after midnight.
  // ---------------------------------------------------
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return dateKey(d); }
  function parseKey(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

  // Divider label inside a chat
  function dayLabel(key) {
    if (key === daysAgo(0)) return 'Today';
    if (key === daysAgo(1)) return 'Yesterday';
    var d = parseKey(key);
    return DAY_NAMES[d.getDay()] + ', ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
  }

  // Short stamp used in the Messages list: time today, otherwise the day
  function listTimeLabel(msg) {
    if (msg.date === daysAgo(0)) return msg.time;
    if (msg.date === daysAgo(1)) return 'Yesterday';
    var d = parseKey(msg.date);
    var label = d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
    return d.getFullYear() === new Date().getFullYear() ? label : label + ' ' + d.getFullYear();
  }

  // Tooltip on a message time: full date + time
  function fullStamp(msg) { return dayLabel(msg.date) + ', ' + msg.time; }

  // Message shape:
  //   id, from ('teacher' | 'parent'), text, time, date ('YYYY-MM-DD', local),
  //   status  (parent messages only: 'sending' | 'sent' | 'delivered' | 'read')
  //   unread  (teacher messages only: true until the parent opens the chat)
  //   edited  (true once the parent has edited the text)
  //   ts, at  (parent messages: send time in ms, and { sent, delivered, read }
  //            timestamps in ms; delivered/read stay null until they happen)
  var SEED = {
    seq: 100,
    teachers: {
      1: {
        id: 1, rank: 6, name: 'Mrs. Ritu Sharma', subject: 'Mathematics', initials: 'RS',
        color: 'linear-gradient(135deg, #2E8B7A 0%, #4CAF8F 100%)',
        online: true, lastSeen: '',
        messages: [
          { id: 't1-0a', from: 'teacher', date: daysAgo(1), time: '03:40 PM', text: 'Hello! Please check Aarav\'s diary today. I have noted the homework for Chapter 5.' },
          { id: 't1-0b', from: 'parent',  date: daysAgo(1), time: '04:05 PM', status: 'read', text: 'Noted, thank you. We will make sure he completes it.' },
          { id: 't1-1', from: 'teacher', date: daysAgo(0), time: '09:15 AM', text: 'Good morning! I wanted to discuss Aarav\'s progress in Mathematics. He has been doing well in class.' },
          { id: 't1-2', from: 'parent',  date: daysAgo(0), time: '09:22 AM', status: 'read', text: 'Good morning, Mrs. Sharma! That\'s wonderful to hear. Is there anything specific we should focus on at home?' },
          { id: 't1-3', from: 'teacher', date: daysAgo(0), time: '09:28 AM', text: 'Yes, I\'d recommend practicing the multiplication tables daily. He\'s a bit slow with 7s and 8s. Also, the upcoming unit test will cover fractions.' },
          { id: 't1-4', from: 'parent',  date: daysAgo(0), time: '09:35 AM', status: 'read', text: 'Thank you for the heads up. We\'ll make sure he practices regularly. When is the unit test?' },
          { id: 't1-5', from: 'teacher', date: daysAgo(0), time: '10:30 AM', unread: true, text: 'The unit test is scheduled for next Friday, the 28th. I\'ll share the revision sheet by tomorrow.' },
          { id: 't1-6', from: 'teacher', date: daysAgo(0), time: '10:32 AM', unread: true, text: 'Please also remind Aarav to bring his geometry box on Monday.' }
        ]
      },
      2: {
        id: 2, rank: 5, name: 'Mr. Arun Kumar', subject: 'English', initials: 'AK',
        color: 'linear-gradient(135deg, #4682B4 0%, #6FA4CC 100%)',
        online: true, lastSeen: '',
        messages: [
          { id: 't2-1', from: 'teacher', date: daysAgo(1), time: '02:10 PM', text: 'Hello! Just wanted to let you know that Aarav\'s essay on "My Favorite Season" was excellent. He has a natural flair for descriptive writing.' },
          { id: 't2-2', from: 'parent',  date: daysAgo(1), time: '02:18 PM', status: 'read', text: 'That\'s great to hear! He\'s been reading a lot of storybooks lately.' },
          { id: 't2-3', from: 'teacher', date: daysAgo(1), time: '02:24 PM', text: 'That\'s wonderful! I\'d suggest he try writing a short story of his own. I can give him some prompts if you\'d like.' },
          { id: 't2-4', from: 'parent',  date: daysAgo(1), time: '02:31 PM', status: 'read', text: 'Yes, please! He would love that. Thank you so much.' }
        ]
      },
      3: {
        id: 3, rank: 4, name: 'Ms. Sneha Patel', subject: 'Science', initials: 'SP',
        color: 'linear-gradient(135deg, #7B9E4E 0%, #A3B96A 100%)',
        online: false, lastSeen: 'yesterday at 6:40 PM',
        messages: [
          { id: 't3-1', from: 'teacher', date: daysAgo(2), time: '11:05 AM', text: 'Good afternoon. I\'m planning a small science exhibition next month. Would Aarav be interested in participating?' },
          { id: 't3-2', from: 'parent',  date: daysAgo(2), time: '11:20 AM', status: 'read', text: 'Good afternoon! Yes, he would absolutely love to participate. What does he need to prepare?' },
          { id: 't3-3', from: 'teacher', date: daysAgo(2), time: '11:42 AM', text: 'He can choose any topic related to the solar system or plants. I\'ll share the guidelines this week.' }
        ]
      },
      4: {
        id: 4, rank: 3, name: 'Mr. Vikram Gupta', subject: 'Social Studies', initials: 'VG',
        color: 'linear-gradient(135deg, #C9A227 0%, #E0B93D 100%)',
        online: true, lastSeen: '',
        messages: [
          { id: 't4-1', from: 'teacher', date: daysAgo(3), time: '05:00 PM', text: 'Hello! The history project on "Ancient Civilizations" is due next Monday. Please ensure Aarav submits it on time.' },
          { id: 't4-2', from: 'parent',  date: daysAgo(3), time: '05:20 PM', status: 'read', text: 'Thank you for the reminder. He\'s almost done with it and will submit it by Friday.' },
          { id: 't4-3', from: 'teacher', date: daysAgo(3), time: '05:45 PM', unread: true, text: 'Perfect, thank you! Friday works well.' }
        ]
      },
      5: {
        id: 5, rank: 2, name: 'Mrs. Meera Joshi', subject: 'Hindi', initials: 'MJ',
        color: 'linear-gradient(135deg, #E08A2E 0%, #F0A22E 100%)',
        online: false, lastSeen: 'on Saturday at 8:30 PM',
        messages: [
          { id: 't5-1', from: 'teacher', date: daysAgo(4), time: '08:10 AM', text: 'Namaste! Aarav\'s Hindi recitation was beautiful last week. He has improved a lot in pronunciation.' },
          { id: 't5-2', from: 'parent',  date: daysAgo(4), time: '08:40 PM', status: 'delivered', text: 'Dhanyavaad! He practices every evening. Your encouragement means a lot.' }
        ]
      },
      6: {
        id: 6, rank: 1, name: 'Mr. Pankaj Nair', subject: 'Computer Science', initials: 'PN',
        color: 'linear-gradient(135deg, #7B2D8E 0%, #A855C4 100%)',
        online: true, lastSeen: '',
        messages: [
          { id: 't6-1', from: 'teacher', date: daysAgo(5), time: '04:05 PM', text: 'Hi! Aarav has shown great interest in the coding club. He built a simple calculator app last week — very impressive!' },
          { id: 't6-2', from: 'parent',  date: daysAgo(5), time: '04:20 PM', status: 'read', text: 'That\'s amazing to hear! He spends hours on the computer at home. We\'re glad it\'s productive.' },
          { id: 't6-3', from: 'teacher', date: daysAgo(5), time: '04:35 PM', text: 'Definitely! I\'ll send some beginner-friendly resources he can explore at home.' }
        ]
      }
    }
  };

  // ---------------------------------------------------
  // Persistence
  // ---------------------------------------------------
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // Sample messages only have a clock time; work out delivered / read times
  // for them so "Message info" has something to show.
  function parseStamp(dateStr, timeStr) {
    var d = parseKey(dateStr);
    var m = /(\d+):(\d+)\s*(AM|PM)/i.exec(timeStr || '');
    if (m) {
      var h = parseInt(m[1], 10) % 12;
      if (m[3].toUpperCase() === 'PM') h += 12;
      d.setHours(h, parseInt(m[2], 10), 0, 0);
    }
    return d.getTime();
  }

  function normalize(st) {
    Object.keys(st.teachers).forEach(function (k) {
      st.teachers[k].messages.forEach(function (m, i) {
        if (m.from !== 'parent' || m.at) return;
        var base = parseStamp(m.date, m.time);
        m.at = {
          sent: base,
          delivered: m.status === 'sending' || m.status === 'sent' ? null : base + 2000,
          read: m.status === 'read' ? base + (2 + (i % 4)) * 60000 + 15000 : null
        };
      });
    });
    return st;
  }

  function load() {
    try {
      var raw = global.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.teachers) return normalize(parsed);
      }
    } catch (e) { /* storage unavailable, fall back to seed */ }
    return normalize(clone(SEED));
  }

  var state = load();

  function save() {
    try { global.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------
  // Helpers
  // ---------------------------------------------------
  function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function get(id) { return state.teachers[id] || null; }

  function list() {
    return Object.keys(state.teachers)
      .map(function (k) { return state.teachers[k]; })
      .sort(function (a, b) { return b.rank - a.rank; });
  }

  function lastMessage(id) {
    var t = get(id);
    return t && t.messages.length ? t.messages[t.messages.length - 1] : null;
  }

  function unreadCount(id) {
    var t = get(id);
    if (!t) return 0;
    return t.messages.filter(function (m) { return m.from === 'teacher' && m.unread; }).length;
  }

  function totalUnread() {
    return list().reduce(function (sum, t) { return sum + unreadCount(t.id); }, 0);
  }

  function firstUnreadId(id) {
    var t = get(id);
    if (!t) return null;
    for (var i = 0; i < t.messages.length; i++) {
      if (t.messages[i].from === 'teacher' && t.messages[i].unread) return t.messages[i].id;
    }
    return null;
  }

  // ---------------------------------------------------
  // Mutations
  // ---------------------------------------------------
  function appendMsg(t, partial) {
    state.seq += 1;
    var now = new Date();
    var msg = {
      id: 't' + t.id + '-n' + state.seq,
      from: partial.from || 'parent',
      date: dateKey(now),
      time: formatTime(now),
      text: partial.text || ''
    };
    if (msg.from === 'parent') {
      msg.status = 'sending';
      msg.ts = now.getTime();
      msg.at = { sent: msg.ts, delivered: null, read: null };
    } else if (partial.unread) {
      msg.unread = true;
    }
    t.messages.push(msg);
    t.rank = Math.max.apply(null, list().map(function (x) { return x.rank; })) + 1;
    return msg;
  }

  function addMessage(id, partial) {
    var t = get(id);
    if (!t) return null;
    var msg = appendMsg(t, partial);
    save();
    return msg;
  }

  // Returns false when the message no longer exists (e.g. chat was cleared)
  function setStatus(id, msgId, status) {
    var t = get(id);
    if (!t) return false;
    for (var i = 0; i < t.messages.length; i++) {
      if (t.messages[i].id === msgId) {
        t.messages[i].status = status;
        save();
        return true;
      }
    }
    return false;
  }

  function getMessage(id, msgId) {
    var t = get(id);
    if (!t) return null;
    for (var i = 0; i < t.messages.length; i++) {
      if (t.messages[i].id === msgId) return t.messages[i];
    }
    return null;
  }

  // A parent's message can be changed until the teacher has read it.
  // The pages check this too; the store enforces it so it can't be bypassed.
  function canChange(id, msgId) {
    var m = getMessage(id, msgId);
    return !!m && m.from === 'parent' && m.status !== 'read';
  }

  function editMessage(id, msgId, text) {
    if (!canChange(id, msgId)) return false;
    var m = getMessage(id, msgId);
    m.text = text;
    m.edited = true;
    save();
    return true;
  }

  function deleteMessage(id, msgId) {
    if (!canChange(id, msgId)) return false;
    var t = get(id);
    t.messages = t.messages.filter(function (m) { return m.id !== msgId; });
    save();
    return true;
  }

  function markRead(id) {
    var t = get(id);
    if (!t) return;
    t.messages.forEach(function (m) { delete m.unread; });
    save();
  }

  function markUnread(id) {
    var t = get(id);
    if (!t) return;
    for (var i = t.messages.length - 1; i >= 0; i--) {
      if (t.messages[i].from === 'teacher') { t.messages[i].unread = true; break; }
    }
    save();
  }

  function clear(id) {
    var t = get(id);
    if (!t) return;
    t.messages = [];
    t.reply = null;
    save();
  }

  // ---------------------------------------------------
  // Receipt icon (shared so list + chat look identical)
  //   sending → clock, sent → ✓, delivered → ✓✓ grey, read → ✓✓ blue
  // ---------------------------------------------------
  var RECEIPT_LABEL = { sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read' };

  function receiptHTML(status) {
    var s = RECEIPT_LABEL[status] ? status : 'sent';
    var svg;
    if (s === 'sending') {
      svg = '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.8"/><path d="M6 3.4V6l1.8 1.1"/></svg>';
    } else if (s === 'sent') {
      svg = '<svg viewBox="0 0 14.5 11" aria-hidden="true"><path d="M1.5 5.8 5.3 9.4 13 1.6"/></svg>';
    } else {
      svg = '<svg viewBox="0 0 19 11" aria-hidden="true"><path d="M1.5 5.8 5.3 9.4 13 1.6"/><path d="M6 5.8 9.8 9.4 17.5 1.6"/></svg>';
    }
    return '<span class="receipt receipt-' + s + '" role="img" aria-label="' + RECEIPT_LABEL[s] +
           '" title="' + RECEIPT_LABEL[s] + '">' + svg + '</span>';
  }

  // Full stamp for a timestamp in ms, e.g. "Today, 09:35 AM"
  function stampLabel(ms) {
    var d = new Date(ms);
    return dayLabel(dateKey(d)) + ', ' + formatTime(d);
  }

  // ---------------------------------------------------
  // DEMO "SERVER" – simulates delivery, read receipts, typing and replies
  // from the time a message was sent, so it keeps working while the parent
  // moves between pages. Replace this whole section with real events from
  // your backend (WebSocket / push) that call emit([...]) with the same shapes:
  //   { type: 'status', teacherId, msgId, status }
  //   { type: 'typing', teacherId, typing }
  //   { type: 'message', teacherId, msg }
  // ---------------------------------------------------
  var SIMULATE_REPLIES = true;
  var SIMULATED_REPLY = 'Thank you for your message. I will get back to you shortly.';
  var SIM = { delivered: 1450, read: 3850, sentAfter: 450, typeAfterRead: 900, typeFor: 2800 };
  var STATUS_RANK = { sending: 0, sent: 1, delivered: 2, read: 3 };

  var listeners = [];
  var prevTyping = {};
  var activeChat = null;

  function subscribe(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  function emit(events) {
    if (!events.length) return;
    listeners.slice().forEach(function (fn) { try { fn(events); } catch (e) { console.error(e); } });
  }

  // The chat page tells the store which chat is open, so replies that arrive
  // there are not counted as unread.
  function setActive(id) { activeChat = id; }

  function isTyping(id) {
    var t = get(id);
    var now = Date.now();
    return !!(t && t.reply && now >= t.reply.typeFrom && now < t.reply.typeTo);
  }

  function scheduleReply(t, m) {
    if (!SIMULATE_REPLIES || t.reply) return;
    var readAt = m.ts + SIM.read;
    t.reply = {
      typeFrom: readAt + SIM.typeAfterRead,
      typeTo: readAt + SIM.typeAfterRead + SIM.typeFor
    };
  }

  function tick() {
    var now = Date.now();
    var events = [];
    var changed = false;

    list().forEach(function (t) {
      // 1. Receipts
      t.messages.forEach(function (m) {
        if (m.from !== 'parent' || !m.ts || m.status === 'read') return;
        var elapsed = now - m.ts;
        var target = elapsed < SIM.sentAfter ? 'sending'
          : elapsed < SIM.delivered ? 'sent'
          : (t.online && elapsed >= SIM.read) ? 'read'
          : 'delivered';
        if (STATUS_RANK[target] <= STATUS_RANK[m.status]) return;

        m.status = target;
        if (target === 'delivered' || target === 'read') m.at.delivered = m.at.delivered || m.ts + SIM.delivered;
        if (target === 'read') {
          m.at.read = m.ts + SIM.read;
          scheduleReply(t, m);
        }
        events.push({ type: 'status', teacherId: t.id, msgId: m.id, status: target });
        changed = true;
      });

      // 2. Typing + reply
      var due = !!t.reply && now >= t.reply.typeTo;
      var typing = !!t.reply && !due && now >= t.reply.typeFrom;
      if (!!prevTyping[t.id] !== typing) {
        prevTyping[t.id] = typing;
        events.push({ type: 'typing', teacherId: t.id, typing: typing });
      }
      if (due) {
        t.reply = null;
        var msg = appendMsg(t, { from: 'teacher', text: SIMULATED_REPLY, unread: activeChat !== t.id });
        events.push({ type: 'message', teacherId: t.id, msg: msg });
        changed = true;
      }
    });

    if (changed) save();
    emit(events);
  }

  tick(); // catch up after a page change, before anyone is listening
  setInterval(tick, 300);

  global.ChatStore = {
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