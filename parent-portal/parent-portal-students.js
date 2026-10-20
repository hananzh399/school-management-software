// Parent Portal – Students (siblings) module
//
// One parent account can have several children. This file:
//   1. holds the list of children,
//   2. remembers which child is selected,
//   3. keeps sessionStorage "studentData" pointing at the selected child, so
//      Dashboard, Profile, Timetable, Result and Feedback (which already read
//      "studentData") show the right student with no changes,
//   4. shows a small "Viewing <name> · Switch" bar on the student pages when the
//      account has more than one child.
//
// Load it in <head> right after parent-portal-i18n.js, before any page script.
//
// ---------------------------------------------------------------------------
// CONNECTING YOUR SERVER
// ---------------------------------------------------------------------------
// 1. After login, fetch the parent's children and call:
//        PortalStudents.setStudents([ { id, name, ... }, ... ]);
//    (replace the demo list below, or call this once you have the data).
// 2. In every page that loads student data (diary, tests, fees, attendance,
//    timetable, announcements, result...), request it for the selected child:
//        const studentId = PortalStudents.current().id;
//        fetch('/api/diary?studentId=' + encodeURIComponent(studentId)) ...
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  var LIST_KEY = 'studentsList';          // optional: list saved after login
  var SELECTED_KEY = 'selectedStudentId'; // which child is open right now
  var DATA_KEY = 'studentData';           // what the existing pages read

  var I18n = window.PortalI18n;
  function tr(key, fallback) {
    try {
      var v = I18n ? I18n.t(key) : null;
      return v && v !== key ? v : fallback;
    } catch (e) { return fallback; }
  }
  function onScreen(text) { return I18n && I18n.iso ? I18n.iso(text) : text; }

  // ---------- Placeholder photos (replace with real photo URLs) ----------
  function avatar(bg, fg) {
    var svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'>" +
      "<circle cx='60' cy='60' r='60' fill='" + bg + "'/>" +
      "<circle cx='60' cy='48' r='22' fill='" + fg + "'/>" +
      "<path d='M28 98 Q60 120 92 98 Q88 80 60 80 Q32 80 28 98Z' fill='" + fg + "'/></svg>";
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  // ---------- Demo children (a real app gets these from the server) ----------
  var guardian = {
    guardianName: 'Rajesh Sharma',
    primaryPhone: '+92 300 123 4567',
    secondaryPhone: '+92 321 987 6543',
    permanentAddress: 'House 24, Street 7, Block C,\nGulberg Greens, Islamabad,\nPakistan – 44000'
  };

  function child(base) {
    var s = Object.assign({}, guardian, base);
    s.fullName = s.fullName || s.name;
    s.classSection = s.classSection || (s.className + ' – ' + s.section);
    return s;
  }

  var DEMO_STUDENTS = [
    child({
      id: 'stu-1056', name: 'Aarav Sharma',
      className: '5', section: 'B',
      regNumber: 'GH/2024/056', rollNumber: '12',
      photo: avatar('#E3F2ED', '#4A7A8C')
    }),
    child({
      id: 'stu-1112', name: 'Zara Sharma',
      className: '3', section: 'A',
      regNumber: 'GH/2024/112', rollNumber: '7',
      photo: avatar('#F7E6EF', '#A0527A')
    })
  ];

  var students = loadList();

  function loadList() {
    try {
      var raw = sessionStorage.getItem(LIST_KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr.map(child);
      }
    } catch (e) { /* ignore */ }
    return [];                      // real children come from the login (sessionStorage "studentsList")
  }

  // ---------- API ----------
  function list() { return students.slice(); }

  function get(id) {
    for (var i = 0; i < students.length; i++) if (students[i].id === id) return students[i];
    return null;
  }

  function selectedId() {
    try { return sessionStorage.getItem(SELECTED_KEY); } catch (e) { return null; }
  }

  function current() { return get(selectedId()) || students[0] || null; }

  // Keep the key the existing pages read in step with the selected child
  function sync() {
    var s = current();
    if (!s) return null;
    try {
      sessionStorage.setItem(SELECTED_KEY, s.id);
      sessionStorage.setItem(DATA_KEY, JSON.stringify(s));
    } catch (e) { /* ignore */ }
    return s;
  }

  function select(id) {
    if (!get(id)) return current();
    try { sessionStorage.setItem(SELECTED_KEY, id); } catch (e) { /* ignore */ }
    return sync();
  }

  // Call this with the children you get from your server
  function setStudents(arr) {
    if (!Array.isArray(arr) || !arr.length) return;
    students = arr.map(child);
    try { sessionStorage.setItem(LIST_KEY, JSON.stringify(students)); } catch (e) { /* ignore */ }
    sync();
  }

  // "Class 5 – B" style label for compact places
  function classLabel(s) {
    return onScreen(tr('classWord', 'Class') + ' ' + (s.classSection || s.className || ''));
  }

  // "Class 5 · Section B" label for cards
  function classSectionLabel(s) {
    var text = tr('classWord', 'Class') + ' ' + (s.className || '');
    if (s.section) text += ' · ' + tr('sectionWord', 'Section') + ' ' + s.section;
    return onScreen(text.trim());
  }

  window.PortalStudents = {
    list: list,
    get: get,
    current: current,
    select: select,
    sync: sync,
    setStudents: setStudents,
    hasSiblings: function () { return students.length > 1; },
    classLabel: classLabel,
    classSectionLabel: classSectionLabel
  };

  // Make "studentData" match the selected child before any page script runs
  sync();

  // ---------- "Viewing <name> · Switch" bar ----------
  function injectBar() {
    if (students.length < 2) return;                         // no siblings: nothing to show
    var body = document.body;
    if (!body || body.classList.contains('page-index')) return;
    if (body.classList.contains('page-messages') || body.classList.contains('page-chat')) return;
    if (document.querySelector('.dash-student-card')) return; // the dashboard already shows the student

    var topbar = document.querySelector('.app-shell > .app-topbar');
    if (!topbar || document.querySelector('.student-bar')) return;

    var s = current();

    var bar = document.createElement('div');
    bar.className = 'student-bar';

    var img = document.createElement('img');
    img.className = 'student-bar-photo';
    img.src = s.photo || '';
    img.alt = '';
    bar.appendChild(img);

    var text = document.createElement('div');
    text.className = 'student-bar-text';
    var name = document.createElement('span');
    name.className = 'student-bar-name';
    name.textContent = s.name;
    var cls = document.createElement('span');
    cls.className = 'student-bar-class';
    cls.textContent = classLabel(s);
    text.appendChild(name);
    text.appendChild(cls);
    bar.appendChild(text);

    var sw = document.createElement('a');
    sw.className = 'student-bar-switch';
    sw.href = 'parent-portal-index.html';
    sw.textContent = onScreen(tr('switchStudent', 'Switch'));
    sw.setAttribute('aria-label', tr('switchStudentAria', 'Switch student'));
    bar.appendChild(sw);

    topbar.insertAdjacentElement('afterend', bar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBar);
  } else {
    injectBar();
  }
})();
