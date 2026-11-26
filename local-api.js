/*!
 * local-api.js - answers the app's /api/students requests from the phone's database (Step 3).
 *
 * HOW IT WORKS: the pages call fetch("https://.../api/students...") exactly as before. This file wraps fetch:
 *
 *   ONLINE school (or nobody logged in) -> every request goes straight to the server, UNTOUCHED.
 *   OFFLINE school                      -> /api/students is answered from the phone's database. Every other
 *                                          /api/ call is refused (those modules are not on the phone yet), so
 *                                          NOTHING of an offline school is ever sent to the server.
 *                                          (Sign-in and status checks, /api/school/*, still reach the server.)
 *   HYBRID school                       -> /api/students is answered from the phone's database; modules that
 *                                          are not on the phone yet still use the server.
 *
 * The student rules copy the server's StudentController: edits merge onto the existing record, a new student is
 * checked against the plan's student limit, "delete" only sets status "dropped", and a locked feature is refused.
 *
 * Modules on the phone so far: STUDENTS, ATTENDANCE, STAFF, SETTINGS, SESSIONS and the finance whole-list stores
 * (custom fees, staff bonus, staff fines, expenses, vouchers; staff advances for offline-only schools), and for
 * OFFLINE-ONLY schools the fee/fine/payment ledger (Step 10; hybrid schools still use the server for that).
 * NOT on the phone yet: photos / B-Form files, automatic sibling linking, biometric devices, WhatsApp and parent
 * notices for absences, and photos, and the other modules.
 * HYBRID upload/download (Steps 5-6) and BACKUP/RESTORE (Step 7) are the blocks at the bottom of this file.
 */
(function () {
  'use strict';
  if (window.__softschoolLocalApi) return;
  window.__softschoolLocalApi = true;
  if (typeof window.fetch !== 'function') return;

  var realFetch = window.fetch.bind(window);
  window.__softschoolRealFetch = realFetch;   // the sync code below uses this to reach the SERVER
  var SESSION_KEY = 'softschool_session';
  var ALWAYS_SERVER = ['/api/school/', '/api/push/'];     // sign-in, status checks, push: always the server

  // ───────────── small helpers ─────────────
  function json(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
  }
  function empty(status) { return new Response(null, { status: status }); }
  function text(status, body) { return new Response(body, { status: status, headers: { 'Content-Type': 'text/plain' } }); }
  function fail(status, error, message, extra) {
    var b = { error: error };
    if (message) b.message = message;
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) b[k] = extra[k];
    return json(status, b);
  }
  function isBlank(v) { return v == null || String(v).trim() === ''; }
  function parse(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }

  function currentSchool() {
    try { var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return s && s.school && s.school.schoolId ? s.school : null; }
    catch (e) { return null; }
  }
  function mode() { return window.SoftSchoolMode && window.SoftSchoolMode.get ? window.SoftSchoolMode.get() : null; }

  // One request at a time, so two quick saves can never both pass the student-limit check.
  var queue = Promise.resolve();
  window.__softschoolSerial = function (fn) { return serial(fn); };   // used by the backup block below
  function serial(fn) {
    var p = queue.then(function () { return fn(); });
    queue = p.catch(function () { /* keep the chain alive */ });
    return p;
  }

  // ───────────── server rules ─────────────
  function lockError(sc, feature) {
    var locks = String(sc.locks || '').split(',').map(function (x) { return x.trim().toLowerCase(); });
    if (locks.indexOf(feature) < 0) return null;
    return fail(403, 'feature_locked', 'The "' + feature + '" feature is not available on this school\'s current plan.', { featureKey: feature });
  }

  async function capacityError(db, sc) {
    var limit = Number(sc.studentLimit);
    if (sc.studentLimit == null || !isFinite(limit) || limit < 0) return null;          // no limit set
    var rows = await db.query('SELECT COUNT(*) AS n FROM students');                    // every student counts, like the server
    var current = Number(rows[0] && rows[0].n) || 0;
    if (current < limit) return null;
    return fail(402, 'plan_limit_exceeded',
      'This school\'s plan allows at most ' + limit + ' students (currently at ' + current + '). Upgrade the plan or increase the limit to add more.',
      { limitType: 'students', limit: limit, current: current });
  }

  // Fields an edit always overwrites (a field the form did not send becomes null, exactly like the server).
  var ALWAYS = ['fullName', 'rollNo', 'studentClass', 'section', 'admissionDate', 'gender', 'dob', 'age', 'studentBform',
    'medicalIssues', 'orphanStatus', 'previousSchool', 'previousClass', 'guardianName', 'guardianRole', 'guardianCnic',
    'phone1', 'phone2', 'permanentAddress', 'mailingAddress', 'standardFee', 'admissionFee', 'tuitionDiscount',
    'transportDiscount', 'siblingDiscount', 'transportMode', 'transportType', 'transportFee', 'netPayable',
    'otherFeesData', 'isLifetime', 'discountExpiry', 'graduatedDate', 'graduatedYear', 'graduatedClass',
    'graduatedSection', 'siblingGroupId', 'isSibling', 'siblingOf', 'hasSiblings', 'droppedDate', 'arrears',
    'voucherCustomFees', 'voucherCustomFeesMonth', 'voucherBulkDiscount', 'voucherNote'];

  function storable(v) { return !isBlank(v) && !/^https?:\/\//i.test(String(v).trim()); }

  function merge(existing, incoming) {
    var next = Object.assign({}, existing);
    ALWAYS.forEach(function (f) { next[f] = incoming[f] === undefined ? null : incoming[f]; });
    if (!isBlank(incoming.admissionClass)) next.admissionClass = incoming.admissionClass;   // only if the form sent one
    if (incoming.fatherFullName != null) next.fatherFullName = incoming.fatherFullName;
    if (incoming.fatherCnic != null) next.fatherCnic = incoming.fatherCnic;
    if (incoming.status != null) next.status = incoming.status;
    if (storable(incoming.photo)) next.photo = incoming.photo;
    if (storable(incoming.certData)) next.certData = incoming.certData;
    return next;
  }

  function withId(row) { var o = parse(row.json); o.id = row.id; return o; }

  // → { ok: true, student } or { ok: false, response }
  async function persist(db, sc, incoming) {
    if (!incoming || typeof incoming !== 'object') return { ok: false, response: fail(400, 'Request body is required.') };
    if (isBlank(incoming.regNo)) return { ok: false, response: fail(400, 'regNo is required.') };
    var locked = lockError(sc, 'students');
    if (locked) return { ok: false, response: locked };

    var regNo = String(incoming.regNo);
    var rows = await db.query('SELECT id, json FROM students WHERE reg_no = ?', [regNo]);
    var next, id = null;
    if (rows.length) {                                   // edit: only the feature lock applies, not the seat limit
      id = rows[0].id;
      next = merge(parse(rows[0].json), incoming);
    } else {                                             // new student: seat limit applies
      var cap = await capacityError(db, sc);
      if (cap) return { ok: false, response: cap };
      next = Object.assign({ arrears: 0, voucherCustomFees: false, voucherBulkDiscount: 0 }, incoming);
    }
    next.schoolId = sc.schoolId;
    next.regNo = regNo;
    delete next.id;
    if (next.status == null) next.status = 'active';

    var cols = [next.fullName == null ? null : String(next.fullName), next.studentClass == null ? null : String(next.studentClass),
                next.section == null ? null : String(next.section), String(next.status), JSON.stringify(next), Date.now()];
    if (id != null) {
      await db.run('UPDATE students SET full_name = ?, student_class = ?, section = ?, status = ?, json = ?, dirty = 1, updated_at = ? WHERE id = ?',
        cols.concat([id]));
    } else {
      await db.run('INSERT INTO students (full_name, student_class, section, status, json, dirty, updated_at, reg_no) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
        [cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], regNo]);
      var got = await db.query('SELECT id FROM students WHERE reg_no = ?', [regNo]);
      id = got[0].id;
    }
    next.id = id;
    return { ok: true, student: next };
  }

  // ───────────── the /api/students routes ─────────────
  async function listFull(c) {
    var rows = await c.db.query('SELECT id, json FROM students ORDER BY id');
    return json(200, rows.map(function (r) { var o = withId(r); delete o.hasPhoto; return o; }));
  }
  // list / summary / sync: everything except the heavy photo + certificate fields, plus a hasPhoto flag
  async function listLight(c) {
    var rows = await c.db.query('SELECT id, json FROM students ORDER BY id');
    return json(200, rows.map(function (r) {
      var o = withId(r);
      var hasPhoto = !isBlank(o.photo) || o.hasPhoto === true;
      if (typeof o.photo === 'string' && o.photo.indexOf('data:') !== 0) o.photoPath = o.photo;
      delete o.photo; delete o.certData;
      o.hasPhoto = hasPhoto;
      return o;
    }));
  }
  async function getOne(c) {
    var rows = await c.db.query('SELECT id, json FROM students WHERE reg_no = ?', [decodeURIComponent(c.args[0])]);
    return rows.length ? json(200, withId(rows[0])) : empty(404);
  }
  async function saveOne(c) {
    var body = c.body && typeof c.body === 'object' ? c.body : null;
    if (body && isBlank(body.schoolId)) body.schoolId = c.sc.schoolId;
    var r = await persist(c.db, c.sc, body);
    return r.ok ? json(200, r.student) : r.response;
  }
  async function updateOne(c) {
    var body = c.body && typeof c.body === 'object' ? c.body : null;
    if (!body) return fail(400, 'Request body is required.');
    if (isBlank(body.regNo)) body.regNo = decodeURIComponent(c.args[0]);
    var r = await persist(c.db, c.sc, body);
    return r.ok ? json(200, r.student) : r.response;
  }
  async function saveBulk(c) {
    var body = c.body;
    if (!body || typeof body !== 'object') return fail(400, 'Request body is required.');
    if (isBlank(body.schoolId)) return fail(400, 'schoolId is required.');
    if (!Array.isArray(body.items)) return fail(400, 'items array is required.');
    var saved = 0;
    for (var i = 0; i < body.items.length; i++) {
      try {
        var r = await persist(c.db, c.sc, body.items[i]);
        if (r.ok) saved++;                               // a refused item (limit, no regNo) is skipped, like the server
      } catch (e) { /* skip this item, keep going */ }
    }
    return json(200, { saved: saved });
  }
  async function dropOne(c) {
    var rows = await c.db.query('SELECT id, json FROM students WHERE reg_no = ?', [decodeURIComponent(c.args[0])]);
    if (!rows.length) return empty(404);
    var o = parse(rows[0].json);
    o.status = 'dropped';                                // the server never really deletes: it marks "dropped"
    await c.db.run('UPDATE students SET status = ?, json = ?, dirty = 1, updated_at = ? WHERE id = ?',
      ['dropped', JSON.stringify(o), Date.now(), rows[0].id]);
    return empty(200);
  }
  async function noFiles() {
    return fail(501, 'offline_not_available', 'Photos and documents are not available in offline mode yet.');
  }
  async function noFile404() { return empty(404); }

  // ───────────── photos and B-Forms kept on the phone (table local_files: path -> data URI) ─────────────
  function fileToDataUri(f) { return new Promise(function (ok, bad) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { bad(r.error); }; r.readAsDataURL(f); }); }
  function uri2blob(u) { var i = u.indexOf(','), mime = (/^data:([^;,]+)/.exec(u) || [])[1] || 'application/octet-stream', bin = atob(u.slice(i + 1)), a = new Uint8Array(bin.length); for (var k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k); return new Blob([a], { type: mime }); }
  var UPC = {};                                           // pictures uploaded this session: path -> data URI
  async function fileSave(c) {                           // POST /api/students/files/photo|bform  (multipart) -> { path }
    var kind = c.args[0], b = c.req.init && c.req.init.body, f = b && typeof b.get === 'function' ? b.get('file') : null;
    if (!f) return fail(400, 'No file was sent.');
    var uri = await fileToDataUri(f), ext = (/^data:image\/(png|webp|gif)/.exec(uri) || [])[1] || (/^data:application\/pdf/.test(uri) ? 'pdf' : 'jpg');
    var path = (kind === 'bform' ? 'bforms/' : 'photos/') + 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.' + ext;
    await c.db.run('INSERT OR REPLACE INTO local_files (path, data, created_at) VALUES (?, ?, ?)', [path, uri, Date.now()]);
    UPC[path] = uri;
    return json(200, { path: path });
  }
  async function fileData(db, regNo, kind) {            // the stored picture of one student as a data URI, or null
    var rows = await db.query('SELECT json FROM students WHERE reg_no = ?', [regNo]);
    if (!rows.length) return null;
    var o = parse(rows[0].json), v = kind === 'bform' ? o.certData : o.photo;
    if (typeof v === 'string' && v.indexOf('data:') === 0) return v;
    if (v) { var f = await db.query('SELECT data FROM local_files WHERE path = ?', [v]); if (f.length) return f[0].data; }
    var g = await db.query("SELECT data FROM local_files WHERE path LIKE ? ORDER BY created_at DESC LIMIT 1", ['reg:' + regNo + ':' + kind + ':%']);
    return g.length ? g[0].data : null;
  }
  async function fileGet(c) {
    var d = await fileData(c.db, decodeURIComponent(c.args[0]), c.args[1]);
    if (!d) return empty(404);
    return new Response(uri2blob(d), { status: 200, headers: { 'Content-Type': (/^data:([^;,]+)/.exec(d) || [])[1] || 'image/jpeg' } });
  }
  async function mediaToken() { return json(200, { token: 'local' }); }

  // ───────────── exam pictures kept on the phone: exam-images/<uuid>.jpg|png -> data URI in local_files ─────────────
  function uuid4() { var h = '0123456789abcdef', o = ''; for (var i = 0; i < 36; i++) { if (i === 8 || i === 13 || i === 18 || i === 23) o += '-'; else if (i === 14) o += '4'; else if (i === 19) o += h[8 + Math.floor(Math.random() * 4)]; else o += h[Math.floor(Math.random() * 16)]; } return o; }
  async function exImgSave(c) {                          // POST /api/exams/images (multipart) -> { path }
    var b = c.req.init && c.req.init.body, f = b && typeof b.get === 'function' ? b.get('file') : null;
    if (!f) return fail(400, 'No file was sent.');
    var uri = await fileToDataUri(f);
    if (!/^data:image\/(png|jpeg|jpg)/.test(uri)) return fail(400, 'Only JPG or PNG pictures can be used.');
    var path = 'exam-images/' + uuid4() + (/^data:image\/png/.test(uri) ? '.png' : '.jpg');
    await c.db.run('INSERT OR REPLACE INTO local_files (path, data, created_at) VALUES (?, ?, ?)', [path, uri, Date.now()]);
    return json(200, { path: path });
  }
  async function examImgGet(req, input, init, m) {       // GET /api/exams/images/<name>: the phone first, then (hybrid) the server
    var name = decodeURIComponent(req.path.split('/').pop()), db = await window.SoftSchoolLocalDB.ready();
    var r = await db.query('SELECT data FROM local_files WHERE path = ? OR path = ?', ['exam-images/' + name, 'srv:exam-images/' + name]);
    if (r.length) return new Response(uri2blob(r[0].data), { status: 200, headers: { 'Content-Type': (/^data:([^;,]+)/.exec(r[0].data) || [])[1] || 'image/jpeg' } });
    if (m !== 'hybrid') return empty(404);
    var res = await realFetch(input, init);
    if (res && res.ok) { try { var uri = await fileToDataUri(await res.clone().blob()); if (/^data:image\//.test(uri)) await db.run('INSERT OR REPLACE INTO local_files (path, data, created_at) VALUES (?, ?, ?)', ['srv:exam-images/' + name, uri, Date.now()]); } catch (e) { /* not cached: fine */ } }
    return res;
  }

  // ───────────── attendance ─────────────
  var ATT_KEYS = ['id', 'schoolId', 'memberId', 'memberName', 'memberType', 'className', 'section', 'role', 'date',
                  'status', 'reason', 'capturedPhoto', 'checkIn', 'checkOut'];

  function isoDate(v) {                                   // "2026-11-25" (a longer timestamp is cut to its date)
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v == null ? '' : v));
    if (!m) return null;
    var d = new Date(m[1] + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === m[1] ? m[1] : null;
  }
  function isoTime(v) {                                   // "08:30" -> "08:30:00", like the server
    if (v == null || v === '') return null;
    var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v));
    if (!m) return null;
    var p = function (x) { return ('0' + x).slice(-2); };
    return p(m[1]) + ':' + m[2] + ':' + p(m[3] || '00');
  }
  function orNull(v) { return v === undefined ? null : v; }

  function attOut(row) {                                  // same fields, same order as the server's JSON
    var o = parse(row.json), out = {};
    ATT_KEYS.forEach(function (k) { out[k] = orNull(o[k]); });
    out.id = row.id;
    return out;
  }
  function needDate(c) {
    var d = isoDate(c.req.query.get('date'));
    return d ? { date: d } : { error: fail(400, 'A valid date (YYYY-MM-DD) is required.') };
  }

  async function attSave(c) {
    var list = c.body;
    if (!Array.isArray(list) || list.length === 0) return text(400, 'No records provided');
    for (var i = 0; i < list.length; i++) {
      var a = list[i] || {};
      if (isBlank(a.schoolId)) return text(400, 'schoolId is required on every attendance record (missing for memberId=' + (a.memberId == null ? 'null' : a.memberId) + ')');
      if (a.schoolId !== c.sc.schoolId) return fail(403, 'forbidden', 'This request is for a different school.');
    }
    var locked = lockError(c.sc, 'attendance');
    if (locked) return locked;

    var saved = 0;
    for (var k = 0; k < list.length; k++) {
      var inc = list[k], date = isoDate(inc.date);
      if (!date || inc.memberId == null) continue;        // malformed rows are skipped, never stored
      var mid = String(inc.memberId);
      var rows = await c.db.query('SELECT id, json FROM attendance WHERE member_id = ? AND att_date = ?', [mid, date]);
      var next, id = null;
      if (rows.length) {                                  // same person + same day: update it (like the server)
        id = rows[0].id;
        next = parse(rows[0].json);
        ['memberName', 'memberType', 'className', 'section', 'role', 'status', 'reason'].forEach(function (f) { next[f] = orNull(inc[f]); });
        if (!isBlank(inc.capturedPhoto)) next.capturedPhoto = inc.capturedPhoto;
        if (inc.checkIn != null) next.checkIn = isoTime(inc.checkIn);
        if (inc.checkOut != null) next.checkOut = isoTime(inc.checkOut);
      } else {
        next = {};
        ATT_KEYS.forEach(function (f) { next[f] = orNull(inc[f]); });
        next.checkIn = isoTime(inc.checkIn);
        next.checkOut = isoTime(inc.checkOut);
      }
      next.schoolId = c.sc.schoolId; next.date = date; delete next.id;
      if (id == null) next.memberId = mid;                // an update keeps the ID as first stored ("r1" updates "R1"), like the server
      var cols = [next.memberType == null ? null : String(next.memberType), next.className == null ? null : String(next.className),
                  next.section == null ? null : String(next.section), next.status == null ? null : String(next.status),
                  next.checkIn, next.checkOut, JSON.stringify(next), Date.now()];
      if (id != null) {
        await c.db.run('UPDATE attendance SET member_type = ?, class_name = ?, section = ?, status = ?, check_in = ?, check_out = ?, json = ?, dirty = 1, updated_at = ? WHERE id = ?',
          cols.concat([id]));
      } else {
        await c.db.run('INSERT INTO attendance (member_type, class_name, section, status, check_in, check_out, json, dirty, updated_at, member_id, att_date) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
          cols.slice(0, 7).concat([cols[7], mid, date]));
      }
      saved++;
    }
    return text(200, 'Saved ' + saved + ' records successfully!');
  }

  async function attAll(c) {
    var rows = await c.db.query('SELECT id, json FROM attendance ORDER BY id');
    return json(200, rows.map(attOut));
  }
  async function attByType(c, type) {
    var d = needDate(c); if (d.error) return d.error;
    var cls = c.req.query.get('className');
    var sql = 'SELECT id, json FROM attendance WHERE att_date = ? AND UPPER(member_type) = ?', vals = [d.date, type];
    if (type === 'STUDENT' && !isBlank(cls)) { sql += ' AND LOWER(class_name) = LOWER(?)'; vals.push(cls); }
    var rows = await c.db.query(sql + ' ORDER BY id', vals);
    return json(200, rows.map(attOut));
  }
  async function attStudents(c) { return attByType(c, 'STUDENT'); }
  async function attStaff(c) { return attByType(c, 'STAFF'); }
  async function attHistory(c) {
    var rows = await c.db.query('SELECT id, json FROM attendance WHERE member_id = ? ORDER BY att_date DESC, id DESC', [decodeURIComponent(c.args[0])]);
    return json(200, rows.map(attOut));
  }
  async function attSummary(c) {                          // the dashboard's "present today" numbers
    var d = needDate(c); if (d.error) return d.error;
    var n = async function (sql) { var r = await c.db.query(sql, [d.date]); return Number(r[0] && r[0].n) || 0; };
    var students = await n("SELECT COUNT(*) AS n FROM attendance WHERE att_date = ? AND UPPER(member_type) = 'STUDENT' AND LOWER(status) = 'present'");
    var staff = await n("SELECT COUNT(*) AS n FROM attendance WHERE att_date = ? AND UPPER(member_type) = 'STAFF' AND (LOWER(status) = 'present' OR check_in IS NOT NULL)");
    var any = await n('SELECT COUNT(*) AS n FROM attendance WHERE att_date = ?');
    return json(200, { presentStudents: students, presentStaff: staff, hasData: any > 0 });
  }

  // ───────────── staff ─────────────
  // Every field the server's Staff record has, in the server's order, with the server's defaults
  // (money fields are numbers that start at 0; everything else starts empty).
  var STAFF_FIELDS = ['id', 'schoolId', 'staffId', 'type', 'name', 'category', 'role', 'salary', 'phone', 'gender', 'cnic',
    'address', 'guardianType', 'guardianName', 'qualification', 'classes', 'subjects', 'joined', 'incharge', 'assignedClass',
    'assignedSection', 'isClassIncharge', 'classAssignments', 'inchargeAssignments', 'subjectAssignments', 'job',
    'startTime', 'endTime', 'securityTotal', 'securityCollected', 'securityMonthly', 'archived', 'leavingDate', 'fines',
    'absentDaysThisMonth', 'photo', 'agreementData'];
  var STAFF_MONEY = { salary: 1, securityTotal: 1, securityCollected: 1, securityMonthly: 1, fines: 1 };

  function num(v) { var n = Number(v); return v == null || v === '' || !isFinite(n) ? 0 : n; }

  function staffRecord(src, id) {                          // a full, normalised staff record
    var o = {};
    STAFF_FIELDS.forEach(function (f) { o[f] = STAFF_MONEY[f] ? num(src[f]) : orNull(src[f]); });
    o.absentDaysThisMonth = null;                          // never stored: worked out when the list is read
    o.id = id == null ? null : id;
    return o;
  }

  // Same wording as the server's SubjectAssignments.validate
  function assignmentError(json) {
    if (json == null || String(json).trim() === '') return null;
    var text = String(json);
    if (text.length > 20000) return 'Too many subject assignments.';
    var arr;
    try { arr = JSON.parse(text); } catch (e) { return 'Subject assignments are invalid.'; }
    if (!Array.isArray(arr)) return 'Subject assignments are invalid.';
    for (var i = 0; i < arr.length; i++) {
      var n = arr[i] || {};
      var sub = n.subject == null ? '' : String(n.subject).trim();
      var cls = n.cls == null ? '' : String(n.cls).trim();
      if (!sub) return 'Every class assignment needs a subject.';
      if (!cls) return 'Subject "' + sub + '" needs a class. Choose the class this teacher teaches it in.';
    }
    return null;
  }

  async function staffCapacityError(db, sc) {
    var limit = Number(sc.staffLimit);
    if (sc.staffLimit == null || !isFinite(limit) || limit < 0) return null;
    var rows = await db.query('SELECT COUNT(*) AS n FROM staff');
    var current = Number(rows[0] && rows[0].n) || 0;
    if (current < limit) return null;
    return fail(402, 'plan_limit_exceeded',
      'This school\'s plan allows at most ' + limit + ' staff (currently at ' + current + '). Upgrade the plan or increase the limit to add more.',
      { limitType: 'staff', limit: limit, current: current });
  }

  async function staffSave(c) {
    var inc = c.body && typeof c.body === 'object' && !Array.isArray(c.body) ? c.body : null;
    if (!inc) return fail(400, 'Request body is required.');
    if (isBlank(inc.schoolId)) inc.schoolId = c.sc.schoolId;
    if (isBlank(inc.staffId)) return fail(400, 'staffId is required.');
    var bad = assignmentError(inc.subjectAssignments);
    if (bad) return fail(400, bad);
    var locked = lockError(c.sc, 'staff');
    if (locked) return locked;

    var staffId = String(inc.staffId);
    var rows = await c.db.query('SELECT id, json FROM staff WHERE staff_id = ?', [staffId]);
    var id = null, reactivating = false;
    if (rows.length) {
      id = rows[0].id;
      var before = parse(rows[0].json);
      reactivating = before.archived === true && inc.archived !== true;
    }
    if (id == null || reactivating) {                      // a NEW staff member (or one being un-archived) uses a seat
      var cap = await staffCapacityError(c.db, c.sc);
      if (cap) return cap;
    }
    var next = staffRecord(inc, id);                       // the server saves the whole record as sent
    next.schoolId = c.sc.schoolId;
    next.staffId = staffId;                                // saved as sent, like the server
    var cols = [next.type == null ? null : String(next.type), next.name == null ? null : String(next.name),
                next.archived === true ? 1 : 0, JSON.stringify(Object.assign({}, next, { id: undefined })), Date.now()];
    if (id != null) {
      await c.db.run('UPDATE staff SET type = ?, name = ?, archived = ?, json = ?, dirty = 1, updated_at = ?, staff_id = ? WHERE id = ?', cols.concat([staffId, id]));
    } else {
      await c.db.run('INSERT INTO staff (type, name, archived, json, dirty, updated_at, staff_id) VALUES (?, ?, ?, ?, 1, ?, ?)', cols.concat([staffId]));
      id = (await c.db.query('SELECT id FROM staff WHERE staff_id = ?', [staffId]))[0].id;
    }
    next.id = id;
    return json(200, next);
  }

  // Absent days this month + the salary-fine rule (percent of salary per absent day, or a fixed amount per day)
  async function fineContext(db) {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
    var pad = function (x) { return ('0' + x).slice(-2); };
    var start = y + '-' + pad(m) + '-01', end = y + '-' + pad(m) + '-' + pad(new Date(y, m, 0).getDate());
    var rows = await db.query("SELECT member_id FROM attendance WHERE UPPER(member_type) = 'STAFF' AND att_date BETWEEN ? AND ? AND LOWER(status) = 'absent'", [start, end]);
    var days = {};
    rows.forEach(function (r) { days[r.member_id] = (days[r.member_id] || 0) + 1; });
    var meta = await db.query("SELECT k, v FROM meta WHERE k IN ('pay_penalty_type', 'pay_penalty_value')");
    var type = 'percent', value = 3;                       // the server's defaults
    var sj = await db.query("SELECT v FROM meta WHERE k = 'settings'");
    if (sj.length) { var so = parse(sj[0].v); if (!isBlank(so.payPenaltyType)) type = String(so.payPenaltyType); if (so.payPenaltyValue != null && isFinite(Number(so.payPenaltyValue))) value = Number(so.payPenaltyValue); }
    else meta.forEach(function (r) {
      if (r.k === 'pay_penalty_type' && !isBlank(r.v)) type = String(r.v);
      if (r.k === 'pay_penalty_value' && !isBlank(r.v) && isFinite(Number(r.v))) value = Number(r.v);
    });
    return { days: days, type: type, value: value };
  }
  function fineFor(ctx, salary, absent) {
    if (absent <= 0) return 0;
    var fine = ctx.type.toLowerCase() === 'percent' ? (salary * (ctx.value / 100)) * absent : ctx.value * absent;
    return Math.round(fine);
  }

  async function staffAll(c) {
    var rows = await c.db.query('SELECT id, json FROM staff ORDER BY id');
    var ctx = await fineContext(c.db);
    return json(200, rows.map(function (r) {
      var o = staffRecord(parse(r.json), r.id);
      var absent = ctx.days[o.staffId] || 0;
      o.absentDaysThisMonth = absent;
      o.fines = fineFor(ctx, o.salary, absent);
      return o;
    }));
  }
  async function staffSummary(c) {
    var rows = await c.db.query('SELECT id, json FROM staff ORDER BY id');
    var ctx = await fineContext(c.db);
    return json(200, rows.map(function (r) {
      var o = staffRecord(parse(r.json), r.id), absent = ctx.days[o.staffId] || 0;
      return { staffId: o.staffId, salary: o.salary, fines: fineFor(ctx, o.salary, absent), absentDaysThisMonth: absent,
               type: o.type, name: o.name, role: o.role, subjects: o.subjects, job: o.job };
    }));
  }
  async function staffDelete(c) {
    var rows = await c.db.query('SELECT id FROM staff WHERE staff_id = ?', [decodeURIComponent(c.args[0])]);
    if (!rows.length) return empty(404);
    if (mode() !== 'hybrid') {                                        // offline-only: keep the paid-salary history, then wipe the rest (hybrid: the server does this)
      var gone = await staffRow(c.db, decodeURIComponent(c.args[0]));
      if (gone) { await archiveDropout(c.db, gone, String(gone.staffId)); await purgeStaffFinance(c.db, String(gone.staffId)); }
    }
    await c.db.run('DELETE FROM staff WHERE id = ?', [rows[0].id]);   // removed for good, like the server
    if (mode() === 'hybrid') {                                        // hybrid: remember to delete it on the server too
      await c.db.run('INSERT INTO pending_deletes (module, item_key, created_at) VALUES (?, ?, ?)', ['staff', decodeURIComponent(c.args[0]), Date.now()]);
    }
    return empty(200);
  }


  // ───────────── settings (school info, class fees, late fee, pay variables, attendance timing) ─────────────
  var SETTINGS_DEFAULTS = {
    schoolName: null, schoolAddress: null, schoolPhone: null, schoolPhoneAlt: null, schoolEmail: null, schoolWebsite: null, schoolPrincipal: null, schoolRegNo: null,
    lateFeeEnabled: true, lateFeeDeadlineDay: 10, lateFeeType: 'fixed', lateFeeAmount: 200, lateFeeGrace: 0,
    payPenaltyType: 'percent', payPenaltyValue: 3, payBonus: 1000,
    autosave1Hour: 10, autosave1Minute: 0, autosave1Meridiem: 'AM', autosave1Enabled: true,
    autosave2Hour: 2, autosave2Minute: 0, autosave2Meridiem: 'PM', autosave2Enabled: true,
    dailyAbsentNotify: false
  };
  var SETTINGS_INFO = ['schoolName', 'schoolAddress', 'schoolPhone', 'schoolPhoneAlt', 'schoolEmail', 'schoolWebsite', 'schoolPrincipal', 'schoolRegNo',
                       'lateFeeEnabled', 'lateFeeDeadlineDay', 'lateFeeType', 'lateFeeAmount', 'lateFeeGrace', 'lateFeeRepeatEnabled', 'lateFeeIntervalDays',
                       'payPenaltyType', 'payPenaltyValue', 'payBonus'];
  var SETTINGS_TIMING = ['autosave1Hour', 'autosave1Minute', 'autosave1Meridiem', 'autosave1Enabled', 'autosave2Hour', 'autosave2Minute', 'autosave2Meridiem', 'autosave2Enabled', 'dailyAbsentNotify'];

  async function metaGet(db, k) { var r = await db.query('SELECT v FROM meta WHERE k = ?', [k]); return r.length ? r[0].v : null; }
  async function metaSet(db, k, v) { await db.run('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', [k, v == null ? null : String(v)]); }

  async function settingsLoad(db, sc) {
    var o = parse(await metaGet(db, 'settings'));
    var out = Object.assign({ id: 1, schoolId: sc.schoolId }, SETTINGS_DEFAULTS, o);
    out.schoolId = sc.schoolId; out.id = o.id != null ? o.id : 1;
    if (!Array.isArray(out.classes)) out.classes = [];
    return out;
  }
  async function settingsStore(db, o) {
    await metaSet(db, 'settings', JSON.stringify(o));
    if (mode() === 'hybrid') { await metaSet(db, 'settings_dirty', '1'); await metaSet(db, 'settings_stamp', Date.now() + '.' + Math.random()); }
  }
  function settingsGuard(c) {
    if (decodeURIComponent(c.args[0]) !== c.sc.schoolId) return fail(403, 'forbidden', 'This request is for a different school.');
    return null;
  }
  function pickFields(src, keys, base) {                 // a field the client did not send gets the server's default
    var out = Object.assign({}, base);
    keys.forEach(function (k) {
      if (src && Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
      else if (Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, k)) out[k] = SETTINGS_DEFAULTS[k];
    });
    return out;
  }
  function amt(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function norm(v) { return v == null ? '' : String(v).trim().toLowerCase(); }

  async function settingsGet(c) { var g = settingsGuard(c); if (g) return g; return json(200, await settingsLoad(c.db, c.sc)); }
  async function settingsClasses(c) { var g = settingsGuard(c); if (g) return g; return json(200, (await settingsLoad(c.db, c.sc)).classes); }

  async function settingsSave(c) {
    var g = settingsGuard(c); if (g) return g;
    var locked = lockError(c.sc, 'settings'); if (locked) return locked;
    var inc = c.body && typeof c.body === 'object' ? c.body : {};
    var cur = await settingsLoad(c.db, c.sc);
    var prevFees = {};
    (cur.classes || []).forEach(function (k) { if (k && !isBlank(k.className)) prevFees[norm(k.className)] = amt(k.fee); });
    var next = pickFields(inc, SETTINGS_INFO, cur);
    var classes = Array.isArray(inc.classes) ? inc.classes : [];
    next.classes = classes.map(function (k) { return { className: k.className == null ? null : k.className, fee: k.fee == null ? null : k.fee, fund: k.fund == null ? null : k.fund, sections: k.sections == null ? null : k.sections }; });
    // a changed class fee is applied to the students already in that class (same as the server)
    var changed = {};
    next.classes.forEach(function (k) {
      if (isBlank(k.className)) return;
      var key = norm(k.className), nf = amt(k.fee);
      if (!(key in prevFees) || prevFees[key] !== nf) changed[key] = nf;
    });
    if (Object.keys(changed).length) {
      var rows = await c.db.query('SELECT id, json FROM students');
      for (var i = 0; i < rows.length; i++) {
        var st = parse(rows[i].json);
        if (isBlank(st.studentClass)) continue;
        var nf2 = changed[norm(st.studentClass)];
        if (nf2 == null || (st.standardFee != null && Number(st.standardFee) === nf2)) continue;
        st.standardFee = nf2;
        st.netPayable = Math.max(0, nf2 + amt(st.admissionFee) + amt(st.transportFee) - amt(st.tuitionDiscount) - amt(st.transportDiscount) - amt(st.siblingDiscount));
        await c.db.run('UPDATE students SET json = ?, dirty = 1, updated_at = ? WHERE id = ?', [JSON.stringify(st), Date.now(), rows[i].id]);
      }
    }
    await settingsStore(c.db, next);
    return json(200, next);
  }
  async function settingsTiming(c) {
    var g = settingsGuard(c); if (g) return g;
    var locked = lockError(c.sc, 'settings'); if (locked) return locked;
    var inc = c.body && typeof c.body === 'object' ? c.body : {};
    var next = pickFields(inc, SETTINGS_TIMING, await settingsLoad(c.db, c.sc));
    await settingsStore(c.db, next);
    return json(200, next);
  }
  async function settingsReset(c) {
    var g = settingsGuard(c); if (g) return g;
    var locked = lockError(c.sc, 'settings'); if (locked) return locked;
    var fresh = Object.assign({ id: 1, schoolId: c.sc.schoolId }, SETTINGS_DEFAULTS, { classes: [] });
    await settingsStore(c.db, fresh);
    return json(200, fresh);
  }

  // ───────────── finance: the simple whole-list stores (custom fees, bonuses, fines, expenses, vouchers, advances) ─────────────
  // The server keeps each of these as ONE list per school: GET returns it, PUT replaces it.
  var FIN_LISTS = { 'custom-fees': 1, 'staff-bonus': 1, 'staff-fines': 1, 'expenses': 1, 'vouchers': 1, 'staff-advances': 1 };
  async function finList(db, name) { var v = await metaGet(db, 'fin:' + name); var a = v == null ? [] : parse2(v); return Array.isArray(a) ? a : []; }
  function parse2(s) { try { return JSON.parse(s); } catch (e) { return []; } }
  async function finGet(c) {
    return json(200, await finList(c.db, c.args[0]));
  }
  async function finPut(c) {
    var name = c.args[0], b = c.body && typeof c.body === 'object' ? c.body : {};
    if (isBlank(b.schoolId)) return fail(400, 'schoolId is required.');
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    if (!Array.isArray(b.items)) return fail(400, 'items array is required.');
    await metaSet(c.db, 'fin:' + name, JSON.stringify(b.items));
    if (mode() === 'hybrid') { await metaSet(c.db, 'fin:' + name + ':dirty', '1'); await metaSet(c.db, 'fin:' + name + ':stamp', Date.now() + '.' + Math.random()); }
    return json(200, b.items);
  }

  // ───────────── academic sessions ─────────────
  function sessOut(r) { return { id: r.id, schoolId: null, startMonth: r.start_month, endMonth: r.end_month, firstSession: r.first_session === 1, currentSession: r.current_session === 1 }; }
  function sessAll(c) { return c.db.query('SELECT * FROM sessions ORDER BY start_month ASC, id ASC').then(function (rows) { return rows.map(function (r) { var o = sessOut(r); o.schoolId = c.sc.schoolId; return o; }); }); }
  function sessRangeError(a, b) {
    var ok = function (v) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(v); };
    if (!ok(a) || !ok(b)) return 'startMonth and endMonth must use yyyy-MM format.';
    if (b < a) return 'endMonth must be the same as or later than startMonth.';
    return null;
  }
  function sv(v) { return v == null ? '' : String(v).trim(); }
  async function sessList(c) { return json(200, await sessAll(c)); }
  async function sessCurrent(c) {
    var all = await sessAll(c), cur = all.filter(function (x) { return x.currentSession; })[0];
    return cur ? json(200, cur) : fail(404, 'No current session has been set.');
  }
  async function sessCreate(c) {
    var b = c.body && typeof c.body === 'object' ? c.body : null;
    if (!b) return fail(400, 'Request body is required.');
    var start = sv(b.startMonth), end = sv(b.endMonth), first = b.firstSession === true;
    var err = sessRangeError(start, end); if (err) return fail(400, err);
    if ((await c.db.query('SELECT id FROM sessions WHERE start_month = ? AND end_month = ?', [start, end])).length) return fail(409, 'This session range already exists.');
    if (first) await c.db.run('UPDATE sessions SET first_session = 0, dirty = 1, updated_at = ? WHERE first_session = 1', [Date.now()]);
    await c.db.run('INSERT INTO sessions (start_month, end_month, first_session, current_session, dirty, updated_at) VALUES (?, ?, ?, 0, 1, ?)', [start, end, first ? 1 : 0, Date.now()]);
    var row = (await c.db.query('SELECT * FROM sessions WHERE start_month = ? AND end_month = ?', [start, end]))[0];
    var o = sessOut(row); o.schoolId = c.sc.schoolId;
    return json(201, o);
  }
  async function sessUpdate(c) {
    var b = c.body && typeof c.body === 'object' ? c.body : null;
    if (!b) return fail(400, 'Request body is required.');
    var id = Number(c.args[0]), rows = await c.db.query('SELECT * FROM sessions WHERE id = ?', [id]);
    if (!rows.length) return fail(404, 'Session not found.');
    var start = sv(b.startMonth), end = sv(b.endMonth);
    var err = sessRangeError(start, end); if (err) return fail(400, err);
    var same = await c.db.query('SELECT id FROM sessions WHERE start_month = ? AND end_month = ?', [start, end]);
    if (same.length && same[0].id !== id) return fail(409, 'This session range already exists.');
    var first = rows[0].first_session;
    if (Object.prototype.hasOwnProperty.call(b, 'firstSession')) {
      first = b.firstSession === true ? 1 : 0;
      if (first === 1 && rows[0].first_session !== 1) await c.db.run('UPDATE sessions SET first_session = 0, dirty = 1, updated_at = ? WHERE first_session = 1', [Date.now()]);
    }
    await c.db.run('UPDATE sessions SET start_month = ?, end_month = ?, first_session = ?, dirty = 1, updated_at = ? WHERE id = ?', [start, end, first, Date.now(), id]);
    var o = sessOut((await c.db.query('SELECT * FROM sessions WHERE id = ?', [id]))[0]); o.schoolId = c.sc.schoolId;
    return json(200, o);
  }
  async function sessMakeCurrent(c) {
    var id = Number(c.args[0]);
    if (!(await c.db.query('SELECT id FROM sessions WHERE id = ?', [id])).length) return fail(404, 'Session not found.');
    await c.db.run('UPDATE sessions SET current_session = CASE WHEN id = ? THEN 1 ELSE 0 END, dirty = 1, updated_at = ?', [id, Date.now()]);
    var o = sessOut((await c.db.query('SELECT * FROM sessions WHERE id = ?', [id]))[0]); o.schoolId = c.sc.schoolId;
    return json(200, o);
  }
  async function sessDelete(c) {
    var id = Number(c.args[0]), rows = await c.db.query('SELECT * FROM sessions WHERE id = ?', [id]);
    if (!rows.length) return fail(404, 'Session not found.');
    await c.db.run('DELETE FROM sessions WHERE id = ?', [id]);
    if (mode() === 'hybrid' && rows[0].server_id != null) await c.db.run('INSERT INTO pending_deletes (module, item_key, created_at) VALUES (?, ?, ?)', ['sessions', String(rows[0].server_id), Date.now()]);
    return empty(204);
  }

  // ═════════════ FEES & FINANCE LEDGER (Step 10) ═════════════
  // A faithful copy of the server's FinanceController rules for student fees, fines, payments, late-fine waivers
  // and voucher-print marks. Money is only ever changed by these actions. (Salaries and promotion: Step 11.)
  var FIN_FIELDS = ['id', 'schoolId', 'recordType', 'monthKey', 'createdAt', 'regNo', 'studentName', 'studentClass', 'section', 'guardianName', 'staffId',
    'baseTuitionFee', 'transportFee', 'otherCharges', 'fineAmount', 'totalFineCharged', 'fineReason', 'totalDiscountApplied', 'discountExpiryDate',
    'netPayable', 'paidAmount', 'remainingBalance', 'paymentStatus', 'lastTransactionDate', 'amount', 'reason', 'applyDate', 'applyTime', 'payDate', 'payTime',
    'baseSalary', 'bonus', 'fines', 'securityDeducted', 'advanceDeducted', 'netPaid', 'grossSalary', 'totalDue', 'amountPaid', 'pendingAmount', 'paymentDate', 'payloadJson'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function nz(v) { var n = Number(v); return v == null || !isFinite(n) ? 0 : n; }
  function p2(n) { return ('0' + n).slice(-2); }
  function fmtDate(d) { return p2(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtTime(d) { var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 === 0 ? 12 : h % 12; return p2(h12) + ':' + p2(d.getMinutes()) + ' ' + ap; }
  function nowIso() { return new Date().toISOString(); }
  function numOrNull(v, key) {                           // the server parses numbers strictly
    if (v == null) return null;
    var n = Number(v);
    if (String(v).trim() === '' || !isFinite(n)) { var e = new Error('Invalid number for ' + key); e.badNumber = true; throw e; }
    return n;
  }

  function newFin(type, sc) {
    var f = {};
    FIN_FIELDS.forEach(function (k) { f[k] = null; });
    ['baseTuitionFee', 'transportFee', 'otherCharges', 'fineAmount', 'totalFineCharged', 'totalDiscountApplied', 'netPayable', 'paidAmount', 'remainingBalance'].forEach(function (k) { f[k] = 0; });
    f.schoolId = sc.schoolId; f.recordType = type; f.createdAt = nowIso();
    return f;
  }
  function calcNet(f) {                                   // Finance.calculateNetPayable()
    var gross = nz(f.baseTuitionFee) + nz(f.transportFee) + nz(f.otherCharges) + nz(f.totalFineCharged);
    f.netPayable = Math.max(0, gross - nz(f.totalDiscountApplied));
    f.remainingBalance = Math.max(0, f.netPayable - nz(f.paidAmount));
    if (f.remainingBalance <= 0.01) f.paymentStatus = 'Paid';
    else if (nz(f.paidAmount) > 0) f.paymentStatus = 'Partial';
    else f.paymentStatus = 'Pending';
  }
  function stampApply(f) { var d = new Date(); f.applyDate = fmtDate(d); f.applyTime = fmtTime(d); }
  function stampPay(f) { var d = new Date(); f.payDate = fmtDate(d); f.payTime = fmtTime(d); }
  function applyPaymentDate(f, iso) {
    var day = null;
    var m = iso == null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
    if (m) { var t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); if (t.getFullYear() === Number(m[1]) && t.getMonth() === Number(m[2]) - 1 && t.getDate() === Number(m[3])) day = t; }
    var now = new Date(), when;
    if (day == null || (day.getFullYear() === now.getFullYear() && day.getMonth() === now.getMonth() && day.getDate() === now.getDate())) when = now;
    else when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0);
    f.lastTransactionDate = when.toISOString(); f.payDate = fmtDate(when); f.payTime = fmtTime(when);
  }
  function nextMonthKey(mk) {
    var m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(mk));
    if (!m) return mk;
    var y = Number(m[1]), mo = Number(m[2]) + 1; if (mo > 12) { mo = 1; y++; }
    return y + '-' + p2(mo);
  }
  function validMonth(mk) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mk)); }
  function isFinePaid(f) { return f != null && (String(f.paymentStatus).toLowerCase() === 'paid' || String(f.paymentStatus).toLowerCase() === 'settled'); }

  function finRow(r) { var o = parse(r.json); o.id = r.id; return o; }
  async function finAll(db, type, month) {
    var rows = month == null ? await db.query('SELECT id, json FROM finance WHERE record_type = ? ORDER BY id', [type])
                             : await db.query('SELECT id, json FROM finance WHERE record_type = ? AND month_key = ? ORDER BY id', [type, month]);
    return rows.map(finRow);
  }
  async function finFind(db, type, reg, month) {
    var rows = await db.query('SELECT id, json FROM finance WHERE record_type = ? AND reg_no = ? AND month_key = ? ORDER BY id LIMIT 1', [type, reg, month]);
    return rows.length ? finRow(rows[0]) : null;
  }
  async function finByReg(db, reg) { return (await db.query('SELECT id, json FROM finance WHERE reg_no = ? ORDER BY id', [reg])).map(finRow); }
  async function finSave(db, f) {
    var js = JSON.stringify(Object.assign({}, f, { id: undefined }));
    if (f.id == null) {
      await db.run('INSERT INTO finance (record_type, month_key, reg_no, json, updated_at) VALUES (?, ?, ?, ?, ?)', [f.recordType, f.monthKey == null ? null : f.monthKey, f.regNo == null ? (f.staffId == null ? null : f.staffId) : f.regNo, js, Date.now()]);
      f.id = (await db.query('SELECT MAX(id) AS id FROM finance'))[0].id;
    } else {
      await db.run('UPDATE finance SET record_type = ?, month_key = ?, reg_no = ?, json = ?, updated_at = ? WHERE id = ?', [f.recordType, f.monthKey == null ? null : f.monthKey, f.regNo == null ? (f.staffId == null ? null : f.staffId) : f.regNo, js, Date.now(), f.id]);
    }
    return f;
  }

  async function studentOf(db, regNoOrId) {              // findStudentInSchool(): by reg no, then by numeric id; must be active
    var rows = await db.query('SELECT id, json FROM students WHERE reg_no = ?', [String(regNoOrId)]);
    if (!rows.length && /^\d+$/.test(String(regNoOrId))) rows = await db.query('SELECT id, json FROM students WHERE id = ?', [Number(regNoOrId)]);
    if (!rows.length) return null;
    var st = parse(rows[0].json); st.id = rows[0].id;
    var status = st.status == null ? '' : String(st.status).trim();
    return status === '' || status.toLowerCase() === 'active' ? st : null;
  }
  async function previousOutstanding(db, st, monthKey) {
    if (st == null || isBlank(st.regNo) || isBlank(monthKey)) return st != null ? nz(st.arrears) : 0;
    if (!validMonth(monthKey)) return nz(st.arrears);
    var latest = null, pendingFines = 0, recs = await finByReg(db, st.regNo);
    recs.forEach(function (r) {
      if (isBlank(r.monthKey) || r.monthKey >= monthKey) return;
      if (r.recordType === 'STUDENT_FEE' && (latest == null || r.monthKey > latest.monthKey)) latest = r;
      else if (r.recordType === 'FINE' && !isFinePaid(r)) pendingFines += nz(r.amount);
    });
    var ledger = latest != null ? nz(latest.remainingBalance) : nz(st.arrears);
    return Math.max(ledger, pendingFines);
  }
  async function buildMaster(db, sc, st, monthKey) {      // the new bill: roster fees + rolled-over arrears + profile discounts
    var f = newFin('STUDENT_FEE', sc);
    f.regNo = st.regNo; f.studentName = st.fullName == null ? null : st.fullName; f.studentClass = st.studentClass == null ? null : st.studentClass;
    f.section = st.section == null ? null : st.section; f.guardianName = st.guardianName == null ? null : st.guardianName;
    f.baseTuitionFee = st.standardFee == null ? null : st.standardFee; f.transportFee = st.transportFee == null ? null : st.transportFee;
    f.otherCharges = await previousOutstanding(db, st, monthKey);
    f.monthKey = monthKey;
    f.totalDiscountApplied = nz(st.tuitionDiscount) + nz(st.transportDiscount) + nz(st.siblingDiscount);
    calcNet(f);
    return f;
  }
  async function getOrCreateMaster(db, sc, regNoOrId, monthKey) {
    var st = await studentOf(db, regNoOrId);
    if (!st) return null;
    var ex = await finFind(db, 'STUDENT_FEE', String(regNoOrId), monthKey);
    if (ex) return ex;
    return finSave(db, await buildMaster(db, sc, st, monthKey));
  }
  async function masterForPayment(db, sc, regNoOrId, monthKey) {
    var ex = await finFind(db, 'STUDENT_FEE', String(regNoOrId), monthKey);
    return ex || getOrCreateMaster(db, sc, regNoOrId, monthKey);
  }

  async function settleCovered(db, master) {
    if (!master || master.recordType !== 'STUDENT_FEE' || nz(master.fineAmount) <= 0.01) return false;
    var feesWithoutFines = Math.max(0, nz(master.netPayable) - nz(master.totalFineCharged));
    var covered = nz(master.paidAmount) - feesWithoutFines;
    if (covered <= 0.01) return false;
    var fines = (await db.query("SELECT id, json FROM finance WHERE record_type = 'FINE' AND reg_no = ? AND month_key = ? ORDER BY id DESC", [master.regNo, master.monthKey])).map(finRow);
    if (!fines.length) return false;
    var changed = false, unpaid = 0, reasons = [];
    for (var i = 0; i < fines.length; i++) {
      var fine = fines[i], paid = isFinePaid(fine), amt = nz(fine.amount);
      if (!paid && covered + 0.01 >= amt) { fine.paymentStatus = 'Paid'; stampPay(fine); await finSave(db, fine); paid = true; covered -= amt; changed = true; }
      if (!paid) { unpaid += amt; if (!isBlank(fine.reason)) reasons.push(fine.reason); }
    }
    var rebuilt = reasons.length ? reasons.join(', ') : null;
    if (Math.abs(nz(master.fineAmount) - unpaid) > 0.01 || (master.fineReason == null ? null : master.fineReason) !== rebuilt) { master.fineAmount = unpaid; master.fineReason = rebuilt; changed = true; }
    if (changed) { calcNet(master); await finSave(db, master); }
    return changed;
  }
  async function refreshCarrySnapshot(db, regNo, monthKey, remaining) {
    var list = await finList(db, 'vouchers'), changed = false;
    list.forEach(function (v) {
      if (!v || typeof v !== 'object' || String(v.studentId) !== String(regNo) || String(v.monthKey) !== String(monthKey)) return;
      if (!v.snapshot || typeof v.snapshot !== 'object' || v.snapshot.promotionCarryTracking !== true) return;
      v.snapshot.promotionCarryAmount = remaining; v.snapshot.promotionCarryAt = nowIso(); changed = true;
    });
    if (changed) {
      await metaSet(db, 'fin:vouchers', JSON.stringify(list));
      if (mode() === 'hybrid') { await metaSet(db, 'fin:vouchers:dirty', '1'); await metaSet(db, 'fin:vouchers:stamp', Date.now() + '.' + Math.random()); }
    }
  }

  function needSchool(b) { return !b || isBlank(b.schoolId) ? fail(400, 'schoolId is required.') : null; }
  function badNum(e) { return e && e.badNumber ? fail(400, e.message) : null; }

  async function finStatus(c) {
    var reg = decodeURIComponent(c.args[0]), mk = decodeURIComponent(c.args[1]);
    var ex = await finFind(c.db, 'STUDENT_FEE', reg, mk), f;
    if (ex) { f = ex; await settleCovered(c.db, f); }
    else {
      var st = await studentOf(c.db, reg);
      if (!st) return fail(404, 'Student not found.');
      f = await buildMaster(c.db, c.sc, st, mk);           // a plain read never saves anything
    }
    return json(200, f);
  }
  async function finAllFines(c) { return json(200, (await finAll(c.db, 'STUDENT_FEE', decodeURIComponent(c.args[0]))).filter(function (f) { return f.fineAmount != null && f.fineAmount > 0; })); }
  async function finStatusAll(c) { return json(200, await finAll(c.db, 'STUDENT_FEE', decodeURIComponent(c.args[0]))); }

  async function finGenerate(c) {
    var b = c.body || {}, bad = needSchool(b); if (bad) return bad;
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    var reg = b.regNo == null ? null : String(b.regNo), mk = b.monthKey == null ? null : String(b.monthKey);
    if (isBlank(reg) || isBlank(mk)) return fail(400, 'regNo and monthKey are required.');
    var f = await getOrCreateMaster(c.db, c.sc, reg, mk);
    if (!f) return fail(404, 'Student not found.');
    try {
      var tuition = numOrNull(b.baseTuitionFee, 'baseTuitionFee'), transport = numOrNull(b.transportFee, 'transportFee'), other = numOrNull(b.otherCharges, 'otherCharges'),
          disc = numOrNull(b.totalDiscountApplied, 'totalDiscountApplied'), fineTotal = numOrNull(b.totalFineCharged, 'totalFineCharged');
    } catch (e) { return badNum(e) || fail(400, e.message); }
    if (tuition != null || transport != null || other != null || disc != null || fineTotal != null) {
      if (tuition != null) f.baseTuitionFee = tuition;
      if (transport != null) f.transportFee = transport;
      if (other != null) f.otherCharges = other;
      if (disc != null) f.totalDiscountApplied = disc;
      if (fineTotal != null && fineTotal > nz(f.totalFineCharged)) f.totalFineCharged = fineTotal;
      calcNet(f); await finSave(c.db, f);
    }
    return json(200, f);                                   // (the WhatsApp voucher message is a server job: not sent from the phone)
  }

  async function finAddFine(c) {
    var b = c.body || {}, bad = needSchool(b); if (bad) return bad;
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    var reg = b.regNo == null ? null : String(b.regNo), mk = b.monthKey == null ? null : String(b.monthKey), reason = b.reason == null ? null : String(b.reason), amount;
    try { amount = numOrNull(b.amount, 'amount'); } catch (e) { return fail(400, e.message); }
    if (isBlank(reg) || isBlank(mk) || amount == null) return fail(400, 'regNo, monthKey and amount are required.');
    var cur = await getOrCreateMaster(c.db, c.sc, reg, mk);
    if (!cur) return fail(400, 'Student not found.');
    var paid = String(cur.paymentStatus).toLowerCase() === 'paid' || (cur.remainingBalance != null && cur.remainingBalance <= 0.01);
    var fmk = paid ? nextMonthKey(mk) : mk, master = cur;
    if (fmk !== mk) { master = await getOrCreateMaster(c.db, c.sc, reg, fmk); if (!master) return fail(400, 'Student not found.'); }
    master.fineAmount = nz(master.fineAmount) + amount;
    master.totalFineCharged = nz(master.totalFineCharged) + amount;
    master.fineReason = isBlank(master.fineReason) ? reason : master.fineReason + ', ' + reason;
    calcNet(master); await finSave(c.db, master);
    var fine = newFin('FINE', c.sc);
    fine.regNo = master.regNo; fine.studentName = master.studentName; fine.studentClass = master.studentClass; fine.section = master.section; fine.guardianName = master.guardianName;
    fine.monthKey = fmk; fine.amount = amount; fine.reason = reason; fine.paymentStatus = 'Pending'; stampApply(fine);
    await finSave(c.db, fine);
    return json(200, master);
  }

  async function finPay(c) {
    var b = c.body || {}, bad = needSchool(b); if (bad) return bad;
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    var reg = b.regNo == null ? null : String(b.regNo), mk = b.monthKey == null ? null : String(b.monthKey), amount, discount;
    try { amount = numOrNull(b.amount, 'amount'); discount = b.discount == null ? 0 : numOrNull(b.discount, 'discount'); } catch (e) { return fail(400, e.message); }
    if (isBlank(reg) || isBlank(mk) || amount == null) return fail(400, 'regNo, monthKey and amount are required.');
    var master = await masterForPayment(c.db, c.sc, reg, mk);
    if (!master) return fail(400, 'Student not found.');
    master.paidAmount = nz(master.paidAmount) + amount;
    if (discount > 0) master.totalDiscountApplied = nz(master.totalDiscountApplied) + discount;
    applyPaymentDate(master, b.paymentDate == null ? null : String(b.paymentDate));
    calcNet(master);
    await settleCovered(c.db, master);
    await finSave(c.db, master);
    await refreshCarrySnapshot(c.db, reg, mk, nz(master.remainingBalance));
    return json(200, master);
  }

  async function finPayFine(c) {
    var b = c.body && typeof c.body === 'object' ? c.body : null;
    if (!b || isBlank(b.schoolId)) return fail(400, 'schoolId is required.');
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    var rows = await c.db.query('SELECT id, json FROM finance WHERE id = ?', [Number(c.args[0])]);
    if (!rows.length) return empty(404);
    var fine = finRow(rows[0]);
    if (fine.recordType !== 'FINE') return empty(404);
    if (isFinePaid(fine)) return fail(400, 'Already paid');
    fine.paymentStatus = 'Paid'; stampPay(fine); await finSave(c.db, fine);
    var master = await finFind(c.db, 'STUDENT_FEE', fine.regNo, fine.monthKey);
    if (master) {
      master.fineAmount = Math.max(0, nz(master.fineAmount) - nz(fine.amount));
      master.paidAmount = nz(master.paidAmount) + nz(fine.amount);
      master.lastTransactionDate = nowIso();
      if (master.fineReason != null && fine.reason != null) {
        var upd = String(master.fineReason).split(String(fine.reason)).join('').replace(/,\s*,/g, ',').replace(/^,\s*|\s*,\s*$/g, '');
        master.fineReason = upd === '' ? null : upd;
      }
      calcNet(master);
      if (nz(master.remainingBalance) <= 0.01) applyPaymentDate(master, null);
      await finSave(c.db, master);
      await refreshCarrySnapshot(c.db, fine.regNo, fine.monthKey, nz(master.remainingBalance));
    }
    return json(200, fine);
  }
  async function finFineDetails(c) {
    var rows = await c.db.query("SELECT id, json FROM finance WHERE record_type = 'FINE' AND reg_no = ? AND month_key = ? ORDER BY id DESC", [decodeURIComponent(c.args[0]), decodeURIComponent(c.args[1])]);
    return json(200, rows.map(finRow));
  }
  async function finFineDetailsAll(c) { return json(200, await finAll(c.db, 'FINE', decodeURIComponent(c.args[0]))); }

  // late-fine waivers
  function waiverView(r) { return { regNo: r.regNo, monthKey: r.monthKey, amount: nz(r.amount), reason: r.reason != null ? r.reason : '', payDate: r.payDate, payTime: r.payTime, date: r.lastTransactionDate }; }
  async function finWaive(c) {
    var b = c.body || {}, bad = needSchool(b); if (bad) return bad;
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    var reg = b.regNo == null ? null : String(b.regNo), mk = b.monthKey == null ? null : String(b.monthKey), amount;
    try { amount = numOrNull(b.amount, 'amount'); } catch (e) { return fail(400, e.message); }
    if (isBlank(reg) || isBlank(mk)) return fail(400, 'regNo and monthKey are required.');
    var st = await studentOf(c.db, reg);
    if (!st) return fail(400, 'Student not found.');
    var row = await finFind(c.db, 'LATE_FINE_WAIVER', st.regNo, mk);
    if (!row) { row = newFin('LATE_FINE_WAIVER', c.sc); row.regNo = st.regNo; row.monthKey = mk; stampApply(row); }
    row.studentName = st.fullName == null ? null : st.fullName; row.studentClass = st.studentClass == null ? null : st.studentClass; row.section = st.section == null ? null : st.section; row.guardianName = st.guardianName == null ? null : st.guardianName;
    row.amount = amount != null && amount > 0 ? amount : 0;
    row.reason = isBlank(b.reason) ? '' : String(b.reason).trim();
    row.paymentStatus = 'Waived'; stampPay(row); row.lastTransactionDate = nowIso();
    await finSave(c.db, row);
    return json(200, waiverView(row));
  }
  async function finUnwaive(c) {
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    var reg = decodeURIComponent(c.args[0]), mk = decodeURIComponent(c.args[1]), row = await finFind(c.db, 'LATE_FINE_WAIVER', reg, mk);
    if (row) await c.db.run('DELETE FROM finance WHERE id = ?', [row.id]);
    return json(200, { regNo: reg, monthKey: mk, removed: !!row });
  }
  async function finWaivers(c) { return json(200, (await finAll(c.db, 'LATE_FINE_WAIVER', decodeURIComponent(c.args[0]))).map(waiverView)); }

  // voucher "printed" marks, one per family per month
  function lng(v) { if (v == null) return 0; var n = Number(v); return isFinite(n) ? Math.trunc(n) : 0; }
  async function finPrintMark(c) {
    var b = c.body || {}, bad = needSchool(b); if (bad) return bad;
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    var mk = b.monthKey == null ? null : String(b.monthKey);
    if (isBlank(mk)) return fail(400, 'monthKey is required.');
    if (!Array.isArray(b.families)) return fail(400, 'families array is required.');
    var force = String(b.force).toLowerCase() === 'true', printedAt = lng(b.printedAt); if (printedAt <= 0) printedAt = Date.now();
    var printed = {}; (await finAll(c.db, 'VOUCHER_PRINT', mk)).forEach(function (r) { if (!isBlank(r.guardianName)) printed[r.guardianName] = r; });
    var toPrint = [], skipped = [], seen = {};
    for (var i = 0; i < b.families.length; i++) {
      var fam = b.families[i];
      if (!fam || typeof fam !== 'object' || Array.isArray(fam)) continue;
      var raw = fam.familyKey == null ? null : String(fam.familyKey);
      if (isBlank(raw)) continue;
      var key = raw.trim().toLowerCase();
      if (seen[key]) continue; seen[key] = true;
      var row = printed[key], regen = false;
      if (row) {
        var latestAt = lng(fam.latestVoucherAt), lastAt = 0;
        var pj = row.payloadJson ? parse(row.payloadJson) : {};
        lastAt = lng(pj.printedAtMs);
        if (lastAt === 0 && row.lastTransactionDate) lastAt = new Date(row.lastTransactionDate).getTime();
        regen = latestAt > lastAt;
      }
      if (row && !force && !regen) { skipped.push(raw); continue; }
      var count = 1;
      if (!row) { row = newFin('VOUCHER_PRINT', c.sc); row.monthKey = mk; row.guardianName = key; printed[key] = row; }
      else { var old = row.payloadJson ? parse(row.payloadJson) : null; count = old && old.printCount != null ? lng(old.printCount) + 1 : 2; if (old && old.printCount == null) count = 2; }
      var regNos = []; if (Array.isArray(fam.regNos)) fam.regNos.forEach(function (r) { if (r != null) regNos.push(String(r)); });
      row.payloadJson = JSON.stringify({ familyKey: key, regNos: regNos, printCount: count, printedAtMs: printedAt, lastPrintedAt: new Date().toISOString().replace('Z', '') });
      row.paymentStatus = 'Printed'; stampPay(row); row.lastTransactionDate = nowIso();
      await finSave(c.db, row);
      toPrint.push(raw);
    }
    return json(200, { monthKey: mk, toPrint: toPrint, skipped: skipped });
  }
  async function finPrintReset(c) {
    var b = c.body || {}, bad = needSchool(b); if (bad) return bad;
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    var mk = b.monthKey == null ? null : String(b.monthKey);
    if (isBlank(mk)) return fail(400, 'monthKey is required.');
    var only = {}, any = false;
    if (Array.isArray(b.familyKeys)) b.familyKeys.forEach(function (k) { if (k != null && !isBlank(String(k))) { only[String(k).trim().toLowerCase()] = true; any = true; } });
    var n = 0, rows = await finAll(c.db, 'VOUCHER_PRINT', mk);
    for (var i = 0; i < rows.length; i++) { if (!any || only[rows[i].guardianName]) { await c.db.run('DELETE FROM finance WHERE id = ?', [rows[i].id]); n++; } }
    return json(200, { monthKey: mk, reset: n });
  }
  async function finPrintStatus(c) {
    var mk = c.req.query.get('monthKey');
    if (isBlank(mk)) return fail(400, 'monthKey is required.');
    var list = []; (await finAll(c.db, 'VOUCHER_PRINT', mk)).forEach(function (r) { if (!isBlank(r.guardianName)) list.push(r.guardianName); });
    return json(200, { monthKey: mk, printedFamilies: list });
  }

  // ═════════════ SALARIES, ADVANCES, DROPOUT STAFF, PROMOTION (Step 11) ═════════════
  function dOr(v, def, key) { return v == null ? def : numOrNull(v, key); }
  async function saveList(db, name, list) {
    await metaSet(db, 'fin:' + name, JSON.stringify(list));
    if (mode() === 'hybrid') { await metaSet(db, 'fin:' + name + ':dirty', '1'); await metaSet(db, 'fin:' + name + ':stamp', Date.now() + '.' + Math.random()); }
  }
  function calcSalary(f) {                                 // Finance.calculateSalaryDue()
    var gross = nz(f.baseSalary) + nz(f.bonus);
    f.grossSalary = gross;
    f.totalDue = Math.max(0, gross - nz(f.fines) - nz(f.securityDeducted));
    f.amountPaid = nz(f.advanceDeducted) + nz(f.netPaid);
    f.pendingAmount = Math.max(0, f.totalDue - f.amountPaid);
    if (f.pendingAmount <= 0.01) f.paymentStatus = 'Paid';
    else if (f.amountPaid > 0) f.paymentStatus = 'Partial';
    else f.paymentStatus = 'Pending';
  }
  function localIso() { return new Date().toISOString().replace('Z', ''); }
  async function staffRow(db, staffId) {
    var rows = await db.query('SELECT id, json FROM staff WHERE staff_id = ?', [String(staffId)]);
    if (!rows.length) return null;
    var s = parse(rows[0].json); s.__rowId = rows[0].id; return s;
  }
  async function staffRowSave(db, s) {
    var id = s.__rowId; delete s.__rowId;
    await db.run('UPDATE staff SET json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(s), Date.now(), id]);
  }
  function itemStaffId(it) { return it && typeof it === 'object' ? (it.staffId != null ? String(it.staffId) : (it.id != null ? String(it.id) : null)) : null; }
  async function staffFineTotal(db, staffId, mk) {
    var total = 0;
    (await finList(db, 'staff-fines')).forEach(function (it) {
      if (itemStaffId(it) === staffId && (it.monthKey == null || String(it.monthKey) === mk)) total += nz(it.amount);
    });
    return total;
  }
  async function staffRowsOf(db, type, staffId) { return (await db.query('SELECT id, json FROM finance WHERE record_type = ? AND reg_no = ? ORDER BY id', [type, staffId])).map(finRow); }

  async function salPay(c) {
    var b = c.body || {}, bad = needSchool(b); if (bad) return bad;
    var staffId = b.staffId == null ? null : String(b.staffId), mk = b.monthKey == null ? null : String(b.monthKey), bonus, finePayload, input;
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    try { bonus = dOr(b.bonus, 0, 'bonus'); finePayload = dOr(b.fine, 0, 'fine'); input = b.amountPaid == null ? null : numOrNull(b.amountPaid, 'amountPaid'); }
    catch (e) { return fail(400, 'Invalid request data.'); }
    if (isBlank(staffId) || isBlank(mk)) return fail(400, 'staffId and monthKey are required.');
    var staff = await staffRow(c.db, staffId);
    if (!staff) return fail(400, 'Staff not found.');
    if (staff.archived === true) return fail(400, 'This staff member is deactivated and cannot be paid or given an advance.');
    var again = (await staffRowsOf(c.db, 'SALARY', staffId)).filter(function (r) { return r.monthKey === mk; });
    if (again.length) return fail(400, 'Salary for this month has already been paid.');
    var base = nz(staff.salary);
    var fine = Math.max(finePayload, await staffFineTotal(c.db, staffId, mk));
    var advanceDeducted = 0, pend = (await staffRowsOf(c.db, 'ADVANCE', staffId)).filter(function (a) { return a.paymentStatus === 'Advance'; });
    for (var i = 0; i < pend.length; i++) { advanceDeducted += nz(pend[i].amount); pend[i].paymentStatus = 'Settled'; await finSave(c.db, pend[i]); }
    var securityDeducted = 0, st = nz(staff.securityTotal), sc2 = nz(staff.securityCollected);
    if (st > 0 && sc2 < st) { securityDeducted = Math.min(nz(staff.securityMonthly), st - sc2); staff.securityCollected = sc2 + securityDeducted; await staffRowSave(c.db, staff); }
    var totalDue = Math.max(0, base + bonus - fine - securityDeducted);
    var rec = newFin('SALARY', c.sc);
    rec.staffId = staffId; rec.regNo = staffId; rec.monthKey = mk; rec.baseSalary = base; rec.bonus = bonus; rec.fines = fine; rec.securityDeducted = securityDeducted;
    rec.advanceDeducted = advanceDeducted; rec.netPaid = input != null ? input : Math.max(0, totalDue - advanceDeducted); rec.paymentDate = localIso();
    calcSalary(rec);
    await finSave(c.db, rec);
    return json(200, rec);
  }
  async function salAdvance(c) {
    var b = c.body || {}, bad = needSchool(b); if (bad) return bad;
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    var staffId = b.staffId == null ? null : String(b.staffId), mk = b.monthKey == null ? null : String(b.monthKey), amount;
    try { amount = numOrNull(b.amount, 'amount'); } catch (e) { return fail(400, 'Invalid request data.'); }
    if (isBlank(staffId) || isBlank(mk) || amount == null) return fail(400, 'staffId, monthKey and amount are required.');
    var staff = await staffRow(c.db, staffId);
    if (!staff) return fail(400, 'Staff not found.');
    if (staff.archived === true) return fail(400, 'This staff member is deactivated and cannot be paid or given an advance.');
    var adv = newFin('ADVANCE', c.sc);
    adv.staffId = staffId; adv.regNo = staffId; adv.monthKey = mk; adv.amount = amount; adv.paymentStatus = 'Advance'; stampApply(adv);
    await finSave(c.db, adv);
    return json(200, adv);
  }
  async function salStatus(c) {
    var staffId = decodeURIComponent(c.args[0]), mk = decodeURIComponent(c.args[1]);
    var rec = (await staffRowsOf(c.db, 'SALARY', staffId)).filter(function (r) { return r.monthKey === mk; })[0];
    return json(200, { paid: !!rec && String(rec.paymentStatus).toLowerCase() === 'paid' });
  }
  async function salRecords(c) { return json(200, await finAll(c.db, 'SALARY')); }
  async function dropoutStaff(c) {
    var recs = (await finAll(c.db, 'DROPOUT_STAFF')).reverse(), total = 0, fines = 0;
    recs.forEach(function (r) { total += nz(r.total); fines += nz(r.finesTotal); });
    return json(200, { total: total, finesTotal: fines, records: recs });
  }
  async function advancesGet(c) {                           // real advance rows first, then the saved list (like the server)
    var out = (await finAll(c.db, 'ADVANCE')).map(function (a) { return { staffId: a.staffId, amount: a.amount, monthKey: a.monthKey, applyDate: a.applyDate, applyTime: a.applyTime, paymentStatus: a.paymentStatus }; });
    return json(200, out.concat(await finList(c.db, 'staff-advances')));
  }
  async function bonusPut(c) {                              // saving bonuses also corrects salaries already paid
    var r = await finPut(c);
    if (r.status !== 200) return r;
    var totals = {};
    (c.body.items || []).forEach(function (it) {
      var sid = itemStaffId(it), mk = it && it.monthKey != null ? String(it.monthKey) : null, amt = it ? Number(it.amount) : NaN;
      if (isBlank(sid) || isBlank(mk) || it.amount == null || !isFinite(amt)) return;
      totals[sid + '\u0000' + mk] = (totals[sid + '\u0000' + mk] || 0) + amt;
    });
    var sal = await finAll(c.db, 'SALARY');
    for (var i = 0; i < sal.length; i++) {
      var nb = totals[sal[i].staffId + '\u0000' + sal[i].monthKey] || 0;
      if (Math.abs(nz(sal[i].bonus) - nb) <= 0.01) continue;
      sal[i].bonus = nb; calcSalary(sal[i]); await finSave(c.db, sal[i]);
    }
    return r;
  }
  async function archiveDropout(db, staff, staffId) {       // called by staff delete (offline-only schools)
    var paid = 0, advance = 0, bonus = 0, fines = 0;
    (await staffRowsOf(db, 'SALARY', staffId)).forEach(function (r) { paid += r.amountPaid != null ? nz(r.amountPaid) : nz(r.netPaid) + nz(r.advanceDeducted); });
    (await staffRowsOf(db, 'ADVANCE', staffId)).forEach(function (r) { if (String(r.paymentStatus).toLowerCase() !== 'settled') advance += nz(r.amount); });
    (await finList(db, 'staff-bonus')).forEach(function (it) { if (itemStaffId(it) === staffId) bonus += nz(it.amount); });
    (await finList(db, 'staff-fines')).forEach(function (it) { if (itemStaffId(it) === staffId) fines += nz(it.amount); });
    var total = paid + advance + bonus;
    if (total <= 0 && fines <= 0) return;
    var d = newFin('DROPOUT_STAFF', { schoolId: staff.schoolId || null });
    d.staffId = staffId; d.studentName = null; d.staffName = staff.name == null ? null : staff.name;
    d.paidSalaryTotal = paid; d.advancePaidTotal = advance; d.bonusPaidTotal = bonus; d.finesTotal = fines; d.total = total; d.deletedAt = nowIso();
    await finSave(db, d);
  }
  async function purgeStaffFinance(db, staffId) {
    await db.run("DELETE FROM finance WHERE reg_no = ? AND record_type IN ('SALARY','ADVANCE')", [staffId]);
    for (var n of ['staff-bonus', 'staff-fines', 'staff-advances']) {
      var list = await finList(db, n), kept = list.filter(function (it) { return itemStaffId(it) !== staffId; });
      if (kept.length !== list.length) await saveList(db, n, kept);
    }
  }

  // promotion: move a promoted student's fee history to the new registration number
  async function promoteFinances(c) {
    var b = c.body || {}, bad = needSchool(b); if (bad) return bad;
    var src = b.sourceRegNo == null ? null : String(b.sourceRegNo), tgt = b.targetRegNo == null ? null : String(b.targetRegNo), nsm = b.nextSessionMonth == null ? null : String(b.nextSessionMonth);
    if (isBlank(src) || isBlank(tgt) || isBlank(nsm)) return fail(400, 'sourceRegNo, targetRegNo and nextSessionMonth are required.');
    if (src === tgt) return fail(400, 'Source and destination registration numbers must be different.');
    if (!validMonth(nsm)) return fail(400, 'nextSessionMonth must use yyyy-MM format.');
    var marks = await finAll(c.db, 'PROMOTION_TRANSFER');
    for (var m = 0; m < marks.length; m++) {
      var mk0 = marks[m].payloadJson ? parse(marks[m].payloadJson) : {};
      if (mk0.sourceRegNo === src && mk0.targetRegNo === tgt) return json(200, { success: true, sourceRegNo: src, targetRegNo: tgt, carryForwardAmount: nz(mk0.carryForwardAmount), alreadyTransferred: true });
    }
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    var sRows = await c.db.query('SELECT id, json FROM students WHERE reg_no = ?', [src]), tRows = await c.db.query('SELECT id, json FROM students WHERE reg_no = ?', [tgt]);
    if (!sRows.length || !tRows.length) return fail(404, 'Source or promoted student was not found.');
    var source = parse(sRows[0].json), target = parse(tRows[0].json);
    if (String(source.status || '').toLowerCase() !== 'promoted') return fail(400, 'The source student must be marked promoted before finance can be transferred.');
    if (target.status != null && String(target.status).toLowerCase() !== 'active') return fail(400, 'The destination student must be active.');
    var recs = await finByReg(c.db, src), priorLedger = null, overallLedger = null, pendBefore = 0, pendAll = 0;
    recs.forEach(function (r) {
      if (isBlank(r.monthKey)) return;
      if (r.recordType === 'STUDENT_FEE') {
        if (!overallLedger || r.monthKey > overallLedger.monthKey) overallLedger = r;
        if (r.monthKey < nsm && (!priorLedger || r.monthKey > priorLedger.monthKey)) priorLedger = r;
      } else if (r.recordType === 'FINE' && !isFinePaid(r)) { pendAll += nz(r.amount); if (r.monthKey < nsm) pendBefore += nz(r.amount); }
    });
    var carry = priorLedger ? nz(priorLedger.remainingBalance) : nz(source.arrears);
    carry = Math.max(carry, pendBefore);
    var track = overallLedger ? nz(overallLedger.remainingBalance) : carry;
    track = Math.max(track, pendAll);
    var moved = 0;
    for (var i = 0; i < recs.length; i++) { if (recs[i].recordType === 'STUDENT_FEE' || recs[i].recordType === 'FINE') { recs[i].regNo = tgt; await finSave(c.db, recs[i]); moved++; } }
    var mv = await moveBulk(c.db, 'vouchers', src, tgt, track, target), mc = await moveBulk(c.db, 'custom-fees', src, tgt, track, target);
    target.arrears = carry;
    await c.db.run('UPDATE students SET json = ?, dirty = 1, updated_at = ? WHERE id = ?', [JSON.stringify(target), Date.now(), tRows[0].id]);
    var mark = newFin('PROMOTION_TRANSFER', c.sc);
    mark.regNo = tgt; mark.studentName = target.fullName == null ? null : target.fullName; mark.studentClass = target.studentClass == null ? null : target.studentClass; mark.monthKey = nsm;
    mark.payloadJson = JSON.stringify({ sourceRegNo: src, targetRegNo: tgt, nextSessionMonth: nsm, carryForwardAmount: carry });
    await finSave(c.db, mark);
    return json(200, { success: true, sourceRegNo: src, targetRegNo: tgt, carryForwardAmount: carry, movedLedgerRecords: moved, movedVoucherRecords: mv, movedCustomFeeRecords: mc, alreadyTransferred: false });
  }
  async function moveBulk(db, name, src, tgt, track, st) {
    var list = await finList(db, name), moved = 0, latest = null, lm = '', lg = '', changed = false;
    list.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      if (name === 'vouchers' && String(it.studentId) === src) {
        it.studentId = tgt;
        var key = it.key == null ? '' : String(it.key);
        if (key.indexOf(src + '::') === 0) it.key = tgt + key.substring(src.length);
        changed = true; moved++;
        var im = it.monthKey == null ? '' : String(it.monthKey), ga = it.generatedAt == null ? '' : String(it.generatedAt);
        if (!isBlank(im) && (!latest || im > lm || (im === lm && ga > lg))) { latest = it; lm = im; lg = ga; }
      } else if (name === 'custom-fees' && Array.isArray(it.records)) {
        it.records.forEach(function (r) {
          if (r && typeof r === 'object' && String(r.studentId) === src) {
            r.studentId = tgt;
            if (r.paid !== true) { r.studentName = st.fullName == null ? null : st.fullName; r.studentClass = st.studentClass == null ? null : st.studentClass; r.section = st.section == null ? null : st.section; r.guardianName = st.guardianName == null ? null : st.guardianName; }
            changed = true; moved++;
          }
        });
      }
    });
    if (latest) {
      if (!latest.snapshot || typeof latest.snapshot !== 'object') latest.snapshot = {};
      latest.snapshot.promotionCarryTracking = true; latest.snapshot.promotionCarryAmount = track; latest.snapshot.promotionCarryAt = localIso(); changed = true;
    }
    if (changed) await saveList(db, name, list);
    return moved;
  }

  async function advPut(c) {                              // the saved advances list; hybrid: also queued for the server
    var b = c.body && typeof c.body === 'object' ? c.body : {};
    if (isBlank(b.schoolId)) return fail(400, 'schoolId is required.');
    var locked = lockError(c.sc, 'finance'); if (locked) return locked;
    if (!Array.isArray(b.items)) return fail(400, 'items array is required.');
    await metaSet(c.db, 'fin:staff-advances', JSON.stringify(b.items));
    return json(200, b.items);
  }

  // ═════════════ EXAMINATION: papers, results (marks), date sheet, grading scale (Step 15) ═════════════
  // The same checks as the server's ExamValidator, so anything the screen can save on the server can be saved here too.
  function Bad(msg) { this.message = msg; }
  function bad(m) { return new Bad(m); }
  var EX_ID = /^[A-Za-z0-9_-]{1,40}$/, EX_TIME = /^([01]\d|2[0-3]):[0-5]\d$/, EX_ABSENT = /^a(b|bs|bsent)?$/i;
  function exId(raw, what) { if (raw == null || !EX_ID.test(raw)) throw bad('The ' + what + ' id is invalid (use letters, digits, - or _, up to 40 characters).'); return raw; }
  function exStr(v) { if (v == null) return ''; if (typeof v === 'object') throw bad('Unexpected nested value.'); return String(v); }
  function exOpt(b, f, max) { var v = exStr(b[f]).trim(); if (v.length > max) throw bad('"' + f + '" is too long (maximum ' + max + ' characters).'); return v; }
  function exReq(b, f, max, label) { var v = exOpt(b, f, max); if (!v) throw bad(label + ' is required.'); return v; }
  function exDate(b, f, label) {
    var v = exOpt(b, f, 10); if (!v) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v), d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw bad(label + ' must be a valid date (yyyy-mm-dd).');
    return v;
  }
  function exNum(b, f, fb, min, max, label) {
    var n = b[f];
    if (n == null || (typeof n === 'string' && n.trim() === '')) return fb;
    var v;
    if (typeof n === 'number') v = n;
    else if (typeof n === 'string') { v = Number(n.trim()); if (!isFinite(v) && !/^[-+]?(inf|nan)/i.test(n)) throw bad(label + ' must be a number.'); if (isNaN(v)) throw bad(label + ' must be a number.'); }
    else throw bad(label + ' must be a number.');
    if (isNaN(v) || !isFinite(v) || v < min || v > max) throw bad(label + ' must be between ' + min + ' and ' + max + '.');
    return v;
  }
  function r2(v) { return Math.round(v * 100) / 100; }

  function exKeep(from, to, skip) {                      // keep plain values (numbers, short text, yes/no) the page stores next to a question, picture or shape; a long text (a raw picture) is never kept
    if (from && typeof from === 'object' && !Array.isArray(from)) Object.keys(from).forEach(function (k) {
      if (skip[k] || k === '__proto__') return; var v = from[k];
      if (typeof v === 'number' ? isFinite(v) : typeof v === 'boolean' || (typeof v === 'string' && v.length <= 300)) to[k] = v;
    });
    return to;
  }
  function exPaper(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('A JSON object is required.');
    var p = {};
    p.term = exReq(b, 'term', 40, 'Exam / Term'); p.className = exReq(b, 'cls', 80, 'Class'); p.section = exOpt(b, 'section', 40); p.subject = exReq(b, 'subj', 80, 'Subject');
    p.date = exDate(b, 'date', 'Paper date'); p.minutes = Math.round(exNum(b, 'mins', 90, 1, 1000, 'Time (minutes)')); p.instructions = exOpt(b, 'instr', 2000);
    var title = exOpt(b, 'title', 200);
    p.title = title === '' ? p.subject + ' — ' + p.term + ' (' + p.className + (p.section === '' ? '' : ' (' + p.section + ')') + ')' : title;
    var secs = b.sections;
    if (!Array.isArray(secs)) throw bad('The paper has no sections.');
    if (secs.length > 20) throw bad('A paper can have at most 20 sections.');
    var out = [], total = 0, filledAll = 0;
    secs.forEach(function (s) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) throw bad('Invalid section.');
      var type = exReq(s, 'type', 40, 'Section type'), attempt = exNum(s, 'attempt', 0, 0, 300, 'Attempt count'), marks = exNum(s, 'marks', 0, 0, 1000, 'Marks per question');
      var qs = s.questions;
      if (!Array.isArray(qs)) throw bad('Section "' + type + '" has no questions list.');
      if (qs.length > 300) throw bad('A section can have at most 300 questions.');
      var oq = [], filled = 0;
      qs.forEach(function (q) {
        if (!q || typeof q !== 'object' || Array.isArray(q)) throw bad('Invalid question.');
        var text = exStr(q.text);
        if (text.length > 5000) throw bad('A question is longer than 5000 characters.');
        var opts = [];
        if (q.opts != null) {
          if (!Array.isArray(q.opts) || q.opts.length > 10) throw bad('A question can have at most 10 options.');
          q.opts.forEach(function (o) { var t = exStr(o); if (t.length > 1000) throw bad('An answer option is longer than 1000 characters.'); opts.push(t); });
        }
        var qo = { text: text, opts: opts }; exKeep(q, qo, { text: 1, opts: 1, imgs: 1 });
        if (Array.isArray(q.imgs)) { if (q.imgs.length > 30) throw bad('A question can have at most 30 pictures.'); qo.imgs = q.imgs.map(function (x) { return exKeep(x, {}, {}); }); }
        oq.push(qo);
        if (text.trim() !== '') filled++;
      });
      var effective = attempt > 0 && attempt < filled ? attempt : filled;
      total += effective * marks; filledAll += filled;
      var so = { type: type, attempt: Math.trunc(attempt), marks: marks, questions: oq }; exKeep(s, so, { type: 1, attempt: 1, marks: 1, questions: 1 });
      out.push(so);
    });
    if (filledAll === 0) throw bad('Write at least one question.');
    if (Array.isArray(b.items)) { if (b.items.length > 60) throw bad('A paper can have at most 60 pictures and shapes.'); p.itemsJson = JSON.stringify(b.items.map(function (x) { return exKeep(x, {}, {}); })); }
    p.total = r2(total); p.sectionsJson = JSON.stringify(out);
    if (p.sectionsJson.length > 600000) throw bad('The paper is too large to save.');
    return p;
  }
  function exMark(v, reg, total) {
    if (v == null) return null;
    var d, raw;
    if (typeof v === 'number') { if (!isFinite(v)) throw bad('Marks for ' + reg + ' must be a number or A (absent).'); d = v; }
    else if (typeof v === 'string') {
      raw = v.trim(); if (raw === '') return null;
      if (EX_ABSENT.test(raw)) return 'A';
      if (raw.length > 24 || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(raw)) throw bad('Marks for ' + reg + ' must be a number or A (absent).');
      d = Number(raw);
    } else throw bad('Marks for ' + reg + ' must be a number or A (absent).');
    if (d < 0 || d > total + 1e-9) throw bad('Marks for ' + reg + ' must be between 0 and ' + total + '.');
    if (Math.abs(d * 100 - Math.round(d * 100)) > 1e-6) throw bad('Marks for ' + reg + ' can have at most 2 decimal places.');
    return d === 0 ? '0' : String(Number(d.toFixed(2)));
  }
  function exResult(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('A JSON object is required.');
    var r = {}; r.total = exNum(b, 'total', NaN, 0.01, 100000, 'Maximum marks');
    if (isNaN(r.total)) throw bad('Maximum marks is required.');
    r.total = r2(r.total);
    var status = exOpt(b, 'status', 12).toLowerCase(); if (status === '') status = 'draft';
    if (status !== 'draft' && status !== 'published') throw bad('Status must be draft or published.');
    r.status = status; r.marks = {};
    var marks = b.marks;
    if (marks != null) {
      if (typeof marks !== 'object' || Array.isArray(marks)) throw bad('Marks must be an object of student -> marks.');
      var keys = Object.keys(marks);
      if (keys.length > 5000) throw bad('Too many marks in one request.');
      keys.forEach(function (k) {
        var reg = k.trim();
        if (reg === '' || reg.length > 60) throw bad('A student reference is invalid.');
        var m = exMark(marks[k], reg, r.total); if (m != null) r.marks[reg] = m;
      });
    }
    if (r.status === 'published' && Object.keys(r.marks).length === 0) throw bad('Enter at least one mark before publishing.');
    return r;
  }
  function exSheet(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('A JSON object is required.');
    var d = {}; d.term = exReq(b, 'term', 40, 'Term'); d.className = exReq(b, 'cls', 80, 'Class'); d.subject = exReq(b, 'subject', 80, 'Subject');
    d.date = exDate(b, 'date', 'Date'); if (d.date === '') throw bad('Pick a date.');
    d.start = exOpt(b, 'start', 5); d.end = exOpt(b, 'end', 5);
    if (!EX_TIME.test(d.start) || !EX_TIME.test(d.end)) throw bad('Start and end times must look like 09:00.');
    if (d.end <= d.start) throw bad('End time must be after the start time.');
    d.room = exOpt(b, 'room', 60);
    return d;
  }
  function exScale(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('A JSON object is required.');
    var sc = b.scale;
    if (!Array.isArray(sc) || sc.length === 0) throw bad('Add at least one grade.');
    if (sc.length > 20) throw bad('A grading scheme can have at most 20 grades.');
    var rows = [], names = {}, mins = {}, anyPass = false, hasZero = false;
    sc.forEach(function (g) {
      if (!g || typeof g !== 'object' || Array.isArray(g)) throw bad('Invalid grade row.');
      var name = exReq(g, 'grade', 10, 'Grade name'), min = exNum(g, 'min', NaN, 0, 100, 'Grade "' + name + '": \'From %\'');
      if (isNaN(min)) throw bad('Grade ' + name + ": 'From %' must be a number between 0 and 100.");
      if (names[name.toLowerCase()]) throw bad('The grade ' + name + ' is used twice.'); names[name.toLowerCase()] = 1;
      if (mins[min]) throw bad('Two grades start at ' + min + '%. Each grade needs its own starting percentage.'); mins[min] = 1;
      var pn = g.pass, pass = pn == null || (typeof pn === 'boolean' ? pn : String(pn).toLowerCase() !== 'false');
      if (pass) anyPass = true; if (min === 0) hasZero = true;
      rows.push({ min: min, grade: name, remark: exOpt(g, 'remark', 60), pass: pass });
    });
    if (!hasZero) throw bad('One grade must start at 0% so every mark gets a grade (normally the fail grade).');
    if (!anyPass) throw bad('Mark at least one grade as Pass.');
    rows.sort(function (a, b2) { return b2.min - a.min; });
    return JSON.stringify(rows);
  }
  function stable(v) { return JSON.stringify(v, function (k, x) { if (x && typeof x === 'object' && !Array.isArray(x)) { var o = {}; Object.keys(x).sort().forEach(function (kk) { o[kk] = x[kk]; }); return o; } return x; }); }

  async function exRows(db, kind) { return (await db.query('SELECT id, item_id, json, created_at, updated_at FROM exams WHERE kind = ? ORDER BY id', [kind])); }
  async function exOne(db, kind, id) { var r = await db.query('SELECT id, item_id, json, created_at, updated_at FROM exams WHERE kind = ? AND item_id = ?', [kind, id]); return r.length ? r[0] : null; }
  async function exPut(db, kind, id, obj, existing) {
    var js = JSON.stringify(obj), now = Date.now();
    if (existing) await db.run('UPDATE exams SET json = ?, updated_at = ? WHERE id = ?', [js, now, existing.id]);
    else await db.run('INSERT INTO exams (kind, item_id, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [kind, id, js, now, now]);
  }
  function paperOut(row) { var p = parse(row.json); return { id: row.item_id, title: p.title, term: p.term, cls: p.className, section: p.section || '', subj: p.subject, date: p.date || '', mins: p.minutes, instr: p.instructions || '', total: p.total, at: row.updated_at, sections: parse2(p.sectionsJson), items: p.itemsJson ? parse2(p.itemsJson) : undefined }; }
  function resultOut(row) { var r = parse(row.json); return { paperId: row.item_id, total: r.total, status: r.status, marks: r.marks || {}, at: row.updated_at }; }
  function sheetOut(row) { var d = parse(row.json); return { id: row.item_id, term: d.term, cls: d.className, subject: d.subject, date: d.date, start: d.start, end: d.end, room: d.room || '' }; }
  function exFail(e) { if (e instanceof Bad) return fail(400, e.message); throw e; }

  async function exBootstrap(c) {
    if (mode() === 'hybrid' && window.SoftSchoolSync && window.SoftSchoolSync.pullExamsInside && navigator.onLine !== false) {   // first time on this phone: bring the school's exam data down first
      var seen = await c.db.query("SELECT v FROM meta WHERE k = 'exam_pulled'");
      if (!seen.length) { try { await window.SoftSchoolSync.pullExamsInside(c.db, c.sc); } catch (e) { /* offline: answer from the phone */ } }
    }
    var papers = (await exRows(c.db, 'paper')).reverse().map(paperOut), results = {}, sheet = (await exRows(c.db, 'sheet')).map(sheetOut).sort(sheetCmp), g = await exOne(c.db, 'grading', 'x');
    (await exRows(c.db, 'result')).forEach(function (r) { results[r.item_id] = resultOut(r); });
    return json(200, { papers: papers, results: results, datesheet: sheet, grading: g ? { scale: parse2(parse(g.json).scaleJson) } : null });
  }
  function sheetCmp(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : 0; }
  async function exPapers(c) { return json(200, (await exRows(c.db, 'paper')).reverse().map(paperOut)); }
  async function exPaperGet(c) { try { exId(c.args[0], 'paper'); } catch (e) { return exFail(e); } var r = await exOne(c.db, 'paper', c.args[0]); return r ? json(200, paperOut(r)) : fail(404, 'Paper not found.'); }
  async function exPaperPut(c) {
    try {
      var id = exId(c.args[0], 'paper'), d = exPaper(c.body), ex = await exOne(c.db, 'paper', id);
      if (!ex && Number((await c.db.query("SELECT count(*) AS n FROM exams WHERE kind = 'paper'"))[0].n) >= 1000) throw bad('This school has reached the limit of 1000 saved papers. Delete old papers first.');
      await exPut(c.db, 'paper', id, d, ex);
      return json(200, paperOut(await exOne(c.db, 'paper', id)));
    } catch (e) { return exFail(e); }
  }
  async function exPaperDel(c) {
    try { exId(c.args[0], 'paper'); } catch (e) { return exFail(e); }
    await c.db.run("DELETE FROM exams WHERE kind = 'result' AND item_id = ?", [c.args[0]]);
    var had = await exOne(c.db, 'paper', c.args[0]);
    if (!had) return fail(404, 'Paper not found.');
    await c.db.run('DELETE FROM exams WHERE id = ?', [had.id]);
    return empty(204);
  }
  async function exResultGet(c) { try { exId(c.args[0], 'paper'); } catch (e) { return exFail(e); } var r = await exOne(c.db, 'result', c.args[0]); return r ? json(200, resultOut(r)) : fail(404, 'No results uploaded for this paper.'); }
  async function exResultPut(c) {
    try {
      var pid = exId(c.args[0], 'paper');
      if (!(await exOne(c.db, 'paper', pid))) return fail(404, 'Paper not found. Save the paper first.');
      var d = exResult(c.body), ex = await exOne(c.db, 'result', pid);
      if (ex) {
        var old = parse(ex.json);
        if (old.status === 'published' && d.status === 'published') {
          if (Math.abs(old.total - d.total) <= 1e-9 && stable(old.marks || {}) === stable(d.marks)) return json(200, resultOut(ex));
          return fail(409, 'These results are published. Unpublish them before editing.');
        }
      }
      await exPut(c.db, 'result', pid, d, ex);
      return json(200, resultOut(await exOne(c.db, 'result', pid)));
    } catch (e) { return exFail(e); }
  }
  async function exResultDel(c) {
    try { exId(c.args[0], 'paper'); } catch (e) { return exFail(e); }
    var had = await exOne(c.db, 'result', c.args[0]);
    if (!had) return fail(404, 'No results found for this paper.');
    await c.db.run('DELETE FROM exams WHERE id = ?', [had.id]);
    return empty(204);
  }
  async function exSheetList(c) { return json(200, (await exRows(c.db, 'sheet')).map(sheetOut).sort(sheetCmp)); }
  async function exSheetPut(c) {
    try {
      var id = exId(c.args[0], 'date sheet entry'), d = exSheet(c.body), ex = await exOne(c.db, 'sheet', id);
      if (!ex && Number((await c.db.query("SELECT count(*) AS n FROM exams WHERE kind = 'sheet'"))[0].n) >= 2000) throw bad('The date sheet is full (2000 entries). Remove old entries first.');
      await exPut(c.db, 'sheet', id, d, ex);
      return json(200, sheetOut(await exOne(c.db, 'sheet', id)));
    } catch (e) { return exFail(e); }
  }
  async function exSheetDel(c) {
    try { exId(c.args[0], 'date sheet entry'); } catch (e) { return exFail(e); }
    var had = await exOne(c.db, 'sheet', c.args[0]);
    if (!had) return fail(404, 'Date sheet entry not found.');
    await c.db.run('DELETE FROM exams WHERE id = ?', [had.id]);
    return empty(204);
  }
  async function exGradeGet(c) { var g = await exOne(c.db, 'grading', 'x'); return json(200, { scale: g ? parse2(parse(g.json).scaleJson) : null }); }
  async function exGradePut(c) {
    try { var s = exScale(c.body), ex = await exOne(c.db, 'grading', 'x'); await exPut(c.db, 'grading', 'x', { scaleJson: s }, ex); return json(200, { scale: parse2(s) }); }
    catch (e) { return exFail(e); }
  }
  async function exGradeDel(c) { await c.db.run("DELETE FROM exams WHERE kind = 'grading'"); return empty(204); }
  async function exImport(c) {                              // one-time upload of what an older screen kept in the browser: add what is missing, never overwrite
    var b = c.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return fail(400, 'A JSON object is required.');
    var ok = { papers: 0, results: 0, datesheet: 0, grading: 0 }, sk = { papers: 0, results: 0, datesheet: 0, grading: 0 };
    var have = {}; (await exRows(c.db, 'paper')).forEach(function (r) { have[r.item_id] = 1; });
    var count = Object.keys(have).length;
    if (Array.isArray(b.papers)) b.papers.slice().reverse().forEach(function () {});
    var items = Array.isArray(b.papers) ? b.papers.slice().reverse() : [];
    for (var i = 0; i < items.length; i++) {
      try { var id = exId(items[i] && items[i].id != null ? String(items[i].id) : '', 'paper'); if (have[id] || count >= 1000) { sk.papers++; continue; }
        await exPut(c.db, 'paper', id, exPaper(items[i]), null); have[id] = 1; count++; ok.papers++; } catch (e) { if (e instanceof Bad) sk.papers++; else throw e; }
    }
    if (b.results && typeof b.results === 'object' && !Array.isArray(b.results)) {
      for (var k of Object.keys(b.results)) {
        try { var pid = exId(k, 'paper'); if (!have[pid] || await exOne(c.db, 'result', pid)) { sk.results++; continue; } await exPut(c.db, 'result', pid, exResult(b.results[k]), null); ok.results++; }
        catch (e) { if (e instanceof Bad) sk.results++; else throw e; }
      }
    }
    if (Array.isArray(b.datesheet)) {
      for (var j = 0; j < b.datesheet.length; j++) {
        try { var sid2 = exId(b.datesheet[j] && b.datesheet[j].id != null ? String(b.datesheet[j].id) : '', 'date sheet entry'); if (await exOne(c.db, 'sheet', sid2)) { sk.datesheet++; continue; } await exPut(c.db, 'sheet', sid2, exSheet(b.datesheet[j]), null); ok.datesheet++; }
        catch (e) { if (e instanceof Bad) sk.datesheet++; else throw e; }
      }
    }
    if (b.grading && typeof b.grading === 'object' && !Array.isArray(b.grading)) {
      try { if (await exOne(c.db, 'grading', 'x')) sk.grading++; else { await exPut(c.db, 'grading', 'x', { scaleJson: exScale(b.grading) }, null); ok.grading++; } } catch (e) { if (e instanceof Bad) sk.grading++; else throw e; }
    }
    return json(200, { imported: ok, skipped: sk });
  }

  // order matters: the fixed words (list, summary, sync, media-token) come before the {regNo} routes
  var ROUTES = [
    { m: 'GET',    re: /^\/api\/students$/,                         fn: listFull,   school: true },
    { m: 'GET',    re: /^\/api\/students\/(list|summary|sync)$/,    fn: listLight,  school: true },
    { m: 'GET',    re: /^\/api\/students\/media-token$/,            fn: mediaToken, offlineOnly: true },
    { m: 'POST',   re: /^\/api\/students\/files\/(photo|bform)$/,   fn: fileSave },
    { m: 'GET',    re: /^\/api\/students\/([^/]+)\/(photo|bform)$/, fn: fileGet, offlineOnly: true },
    { m: 'POST',   re: /^\/api\/students$/,                         fn: saveOne,    body: true },
    { m: 'PUT',    re: /^\/api\/students$/,                         fn: saveBulk,   body: true },
    { m: 'GET',    re: /^\/api\/students\/([^/]+)$/,                fn: getOne,     school: true },
    { m: 'PUT',    re: /^\/api\/students\/([^/]+)$/,                fn: updateOne,  body: true },
    { m: 'DELETE', re: /^\/api\/students\/([^/]+)$/,                fn: dropOne,    school: true },
    { m: 'POST',   re: /^\/api\/attendance\/save$/,                 fn: attSave,     body: true },
    { m: 'GET',    re: /^\/api\/attendance\/all$/,                  fn: attAll,      school: true },
    { m: 'GET',    re: /^\/api\/attendance\/students$/,             fn: attStudents, school: true },
    { m: 'GET',    re: /^\/api\/attendance\/staff$/,                fn: attStaff,    school: true },
    { m: 'GET',    re: /^\/api\/attendance\/history\/([^/]+)$/,      fn: attHistory,  school: true },
    { m: 'GET',    re: /^\/api\/attendance$/,                       fn: attSummary,  school: true },
    { m: 'POST',   re: /^\/api\/staff$/,                            fn: staffSave,   body: true },
    { m: 'GET',    re: /^\/api\/staff$/,                            fn: staffAll,    school: true },
    { m: 'GET',    re: /^\/api\/staff\/summary$/,                    fn: staffSummary, school: true },
    { m: 'DELETE', re: /^\/api\/staff\/([^/]+)$/,                   fn: staffDelete, school: true },
    { m: 'GET',    re: /^\/api\/settings\/([^/]+)$/,                  fn: settingsGet },
    { m: 'PUT',    re: /^\/api\/settings\/([^/]+)$/,                  fn: settingsSave,   body: true },
    { m: 'PUT',    re: /^\/api\/settings\/([^/]+)\/timing$/,          fn: settingsTiming, body: true },
    { m: 'GET',    re: /^\/api\/settings\/([^/]+)\/classes$/,         fn: settingsClasses },
    { m: 'POST',   re: /^\/api\/settings\/([^/]+)\/reset$/,           fn: settingsReset },
    { m: 'PUT',    re: /^\/api\/finance\/(staff-bonus)$/,                fn: bonusPut,         body: true },
    { m: 'POST',   re: /^\/api\/finance\/salary\/pay$/,                    fn: salPay,           body: true, log: true },
    { m: 'POST',   re: /^\/api\/finance\/salary\/advance$/,                fn: salAdvance,       body: true, log: true },
    { m: 'GET',    re: /^\/api\/finance\/salary\/status\/([^/]+)\/([^/]+)$/, fn: salStatus,        school: true },
    { m: 'GET',    re: /^\/api\/finance\/salary\/records$/,                fn: salRecords,       school: true },
    { m: 'GET',    re: /^\/api\/finance\/dropout-staff$/,                  fn: dropoutStaff,     school: true },
    { m: 'POST',   re: /^\/api\/finance\/promote-student-finances$/,       fn: promoteFinances,  body: true, log: true },
    { m: 'POST',   re: /^\/api\/exams\/images$/,                     fn: exImgSave },
    { m: 'GET',    re: /^\/api\/exams\/bootstrap$/,                  fn: exBootstrap },
    { m: 'GET',    re: /^\/api\/exams\/papers$/,                     fn: exPapers },
    { m: 'GET',    re: /^\/api\/exams\/papers\/([^/]+)$/,             fn: exPaperGet },
    { m: 'PUT',    re: /^\/api\/exams\/papers\/([^/]+)$/,             fn: exPaperPut,   body: true, log: true },
    { m: 'DELETE', re: /^\/api\/exams\/papers\/([^/]+)$/,             fn: exPaperDel,   log: true },
    { m: 'GET',    re: /^\/api\/exams\/results\/([^/]+)$/,            fn: exResultGet },
    { m: 'PUT',    re: /^\/api\/exams\/results\/([^/]+)$/,            fn: exResultPut,  body: true, log: true },
    { m: 'DELETE', re: /^\/api\/exams\/results\/([^/]+)$/,            fn: exResultDel,  log: true },
    { m: 'GET',    re: /^\/api\/exams\/datesheet$/,                  fn: exSheetList },
    { m: 'PUT',    re: /^\/api\/exams\/datesheet\/([^/]+)$/,          fn: exSheetPut,   body: true, log: true },
    { m: 'DELETE', re: /^\/api\/exams\/datesheet\/([^/]+)$/,          fn: exSheetDel,   log: true },
    { m: 'GET',    re: /^\/api\/exams\/grading$/,                    fn: exGradeGet },
    { m: 'PUT',    re: /^\/api\/exams\/grading$/,                    fn: exGradePut,   body: true, log: true },
    { m: 'DELETE', re: /^\/api\/exams\/grading$/,                    fn: exGradeDel,   log: true },
    { m: 'POST',   re: /^\/api\/exams\/import$/,                     fn: exImport,     body: true, log: true },
    { m: 'GET',    re: /^\/api\/finance\/(custom-fees|staff-bonus|staff-fines|expenses|vouchers)$/, fn: finGet, school: true },
    { m: 'PUT',    re: /^\/api\/finance\/(custom-fees|staff-bonus|staff-fines|expenses|vouchers)$/, fn: finPut, body: true },
    { m: 'GET',    re: /^\/api\/finance\/staff-advances$/,               fn: advancesGet, school: true },
    { m: 'PUT',    re: /^\/api\/finance\/(staff-advances)$/,           fn: advPut, body: true, log: true },
    { m: 'GET',    re: /^\/api\/finance\/status\/([^/]+)\/([^/]+)$/,        fn: finStatus,        school: true },
    { m: 'GET',    re: /^\/api\/finance\/all-fines\/([^/]+)$/,               fn: finAllFines,      school: true },
    { m: 'GET',    re: /^\/api\/finance\/status-all\/([^/]+)$/,              fn: finStatusAll,     school: true },
    { m: 'POST',   re: /^\/api\/finance\/generate-voucher$/,                 fn: finGenerate,      body: true, log: true },
    { m: 'POST',   re: /^\/api\/finance\/add-fine$/,                         fn: finAddFine,       body: true, log: true },
    { m: 'POST',   re: /^\/api\/finance\/pay$/,                              fn: finPay,           body: true, log: true },
    { m: 'POST',   re: /^\/api\/finance\/pay-fine\/(\d+)$/,                  fn: finPayFine,       body: true, log: true },
    { m: 'GET',    re: /^\/api\/finance\/fine-details\/([^/]+)\/([^/]+)$/,   fn: finFineDetails,   school: true },
    { m: 'GET',    re: /^\/api\/finance\/fine-details-all\/([^/]+)$/,        fn: finFineDetailsAll, school: true },
    { m: 'POST',   re: /^\/api\/finance\/waive-late-fine$/,                  fn: finWaive,         body: true, log: true },
    { m: 'DELETE', re: /^\/api\/finance\/waive-late-fine\/([^/]+)\/([^/]+)$/, fn: finUnwaive,       school: true, log: true },
    { m: 'GET',    re: /^\/api\/finance\/late-fine-waivers\/([^/]+)$/,       fn: finWaivers,       school: true },
    { m: 'POST',   re: /^\/api\/finance\/voucher-print$/,                    fn: finPrintMark,     body: true, log: true },
    { m: 'POST',   re: /^\/api\/finance\/voucher-print-reset$/,              fn: finPrintReset,    body: true, log: true },
    { m: 'GET',    re: /^\/api\/finance\/voucher-print-status$/,             fn: finPrintStatus,   school: true },
    { m: 'GET',    re: /^\/api\/sessions$/,                            fn: sessList,       school: true },
    { m: 'GET',    re: /^\/api\/sessions\/current$/,                   fn: sessCurrent,    school: true },
    { m: 'POST',   re: /^\/api\/sessions$/,                            fn: sessCreate,     body: true },
    { m: 'PUT',    re: /^\/api\/sessions\/(\d+)$/,                     fn: sessUpdate,     body: true },
    { m: 'PUT',    re: /^\/api\/sessions\/(\d+)\/current$/,            fn: sessMakeCurrent, school: true },
    { m: 'DELETE', re: /^\/api\/sessions\/(\d+)$/,                     fn: sessDelete,     school: true }
  ];

  // ───────────── request plumbing ─────────────
  function describe(input, init) {
    try {
      var urlStr = typeof input === 'string' ? input : (input && input.url) || String(input);
      var u = new URL(urlStr, window.location.href);
      return {
        path: u.pathname.replace(/\/+$/, '') || '/',
        query: u.searchParams,
        method: String((init && init.method) || (input && input.method) || 'GET').toUpperCase(),
        init: init, input: input
      };
    } catch (e) { return null; }
  }

  function findRoute(req) {
    for (var i = 0; i < ROUTES.length; i++) {
      if (ROUTES[i].m !== req.method) continue;
      var m = ROUTES[i].re.exec(req.path);
      if (m && ROUTES[i].offlineOnly && mode() === 'hybrid') return null;     // hybrid: this one stays on the server (do not let a later, broader route catch it)
      if (m) return { route: ROUTES[i], args: m.slice(1) };
    }
    return null;
  }

  async function readBody(req) {
    try {
      var b = req.init && req.init.body;
      if (typeof b === 'string') return JSON.parse(b);
      if (b == null && req.input && typeof req.input.clone === 'function') return JSON.parse(await req.input.clone().text());
    } catch (e) { /* unreadable body: treated as missing */ }
    return null;
  }

  function run(found, req) {
    var sc = currentSchool();
    if (!sc) return Promise.resolve(fail(401, 'Please log in again.'));
    var qid = req.query.get('schoolId');
    if (found.route.school && isBlank(qid)) return Promise.resolve(fail(400, 'schoolId query parameter is required.'));
    if (!isBlank(qid) && qid !== sc.schoolId) return Promise.resolve(fail(403, 'forbidden', 'This request is for a different school.'));

    return serial(async function () {
      var db;
      try { db = await window.SoftSchoolLocalDB.ready(); }
      catch (e) { return fail(503, 'local_db_unavailable', 'The offline database is not available: ' + (e && e.message ? e.message : 'unknown error')); }
      var body = found.route.body ? await readBody(req) : null;
      if (body && typeof body === 'object' && !Array.isArray(body) && !isBlank(body.schoolId) && body.schoolId !== sc.schoolId) {
        return fail(403, 'forbidden', 'This request is for a different school.');
      }
      try {
        var res = await found.route.fn({ db: db, sc: sc, args: found.args, body: body, req: req });
        if (found.route.log && mode() === 'hybrid' && res && res.status >= 200 && res.status < 300) {   // hybrid money action: remember it, replay on the server later
          var qs = req.query.toString();
          await db.run('INSERT INTO finance_ops (method, url, body, created_at) VALUES (?, ?, ?, ?)', [req.method, req.path + (qs ? '?' + qs : ''), body == null ? null : JSON.stringify(body), Date.now()]);
          await metaSet(db, 'fin_seq', Date.now() + '.' + Math.random());
        }
        if (req.method !== 'GET') {
          try { if (req.path === '/api/students' && body && body.regNo) { [['photo', body.photo], ['bform', body.certData]].forEach(function (p) { if (typeof p[1] === 'string') { var d = p[1].indexOf('data:') === 0 ? p[1] : UPC[p[1]]; if (d) IMGC[body.regNo + '|' + p[0]] = d; } }); } } catch (e) { /* ignore */ }
          loadImgCache();
        }
        if (req.method !== 'GET' && window.SoftSchoolSync) window.SoftSchoolSync.poke();   // hybrid: upload soon
        return res;
      }
      catch (e) { return fail(500, 'local_error', (e && e.message) || 'Unexpected error in the offline database.'); }
    });
  }

  // ───────────── hybrid: WhatsApp + announcements are sent at once when online, kept in a queue when offline ─────────────
  var DEFERRED = [
    { m: 'POST', re: /^\/api\/announcements$/,                    kind: 'ann' },
    { m: 'POST', re: /^\/api\/messages\/broadcast$/,              kind: 'bc' },
    { m: 'POST', re: /^\/api\/whatsapp\/send\/(fee|attendance)$/, kind: 'wa' },
    { m: 'POST', re: /^\/api\/whatsapp\/test$/,                   kind: 'watest' },
    { m: 'DELETE', re: /^\/api\/announcements\/(q\d+)$/,          kind: 'annq' },
    { m: 'GET',  re: /^\/api\/announcements$/,                    kind: 'annlist' },
    { m: 'GET',  re: /^\/api\/whatsapp\/status$/,                 kind: 'wastatus' },
    { m: 'GET',  re: /^\/api\/whatsapp\/recipients$/,             kind: 'warec' }
  ];
  function deferredSpec(req) {
    for (var i = 0; i < DEFERRED.length; i++) { if (DEFERRED[i].m === req.method) { var m = DEFERRED[i].re.exec(req.path); if (m) return { kind: DEFERRED[i].kind, args: m.slice(1) }; } }
    return null;
  }
  function isOnline() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
  function badServerAnswer(res) { return res.status >= 500 || res.status === 408 || res.status === 429; }
  function cacheKey(req) { return 'cache:' + req.path + '?' + req.query.toString(); }
  function waPhone(v) { var d = v == null ? '' : String(v).replace(/\D/g, ''); return d.length >= 10 && d.length <= 15 ? String(v).trim() : null; }
  function classRank(c) { var m = /\d+/.exec(c); return m ? Number(m[0]) : -1; }

  async function runDeferred(spec, req, input, init) {
    var sc = currentSchool();
    if (!sc) return fail(401, 'Please log in again.');
    var isGet = req.method === 'GET', isWrite = req.method === 'POST';
    var body = isWrite ? await readBody(req) : null;
    var key = cacheKey(req);
    if (spec.kind === 'annq') {                              // delete a notice that is still waiting on this phone
      return serial(async function () {
        var db = await window.SoftSchoolLocalDB.ready();
        await db.run("DELETE FROM finance_ops WHERE id = ? AND url = '/api/announcements'", [Number(spec.args[0].slice(1))]);
        return empty(204);
      });
    }
    var waiting = 0;
    if (isWrite || spec.kind === 'annlist') {
      waiting = await serial(async function () { var db = await window.SoftSchoolLocalDB.ready(); return Number((await db.query('SELECT count(*) AS n FROM finance_ops'))[0].n); });
    }
    if (isOnline() && !(isWrite && waiting > 0)) {           // internet on and nothing older waiting: straight to the online server
      try {
        var res = await realFetch(input, init);
        if (!badServerAnswer(res)) {
          if (isGet && res.ok) {
            var txt = await res.clone().text();
            await serial(async function () { var db = await window.SoftSchoolLocalDB.ready(); await metaSet(db, key, txt); });
          }
          return res;
        }
      } catch (e) { /* no connection after all: fall through to the phone */ }
    }
    return serial(async function () {
      var db = await window.SoftSchoolLocalDB.ready();
      if (isWrite) {
        var qs = req.query.toString();
        await db.run('INSERT INTO finance_ops (method, url, body, created_at) VALUES (?, ?, ?, ?)', [req.method, req.path + (qs ? '?' + qs : ''), body == null ? null : JSON.stringify(body), Date.now()]);
        var opId = (await db.query('SELECT MAX(id) AS id FROM finance_ops'))[0].id;
        await metaSet(db, 'fin_seq', Date.now() + '.' + Math.random());
        if (window.SoftSchoolSync) window.SoftSchoolSync.poke();
        body = body || {};
        if (spec.kind === 'ann') return json(201, { id: 'q' + opId, title: body.title, body: body.body, from: body.senderName || 'Admin', senderType: 'ADMIN', audience: body.audience, className: body.className || null, priority: body.priority || 'normal', date: nowIso(), waiting: true });
        if (spec.kind === 'bc') { var n = Array.isArray(body.regNos) ? body.regNos.length : (Array.isArray(body.staffIds) ? body.staffIds.length : 1); return json(200, { sent: n, waiting: true }); }
        if (spec.kind === 'wa') { var c = Array.isArray(body.regNos) ? body.regNos.length : 0; return json(200, { queued: c, etaMinutes: Math.max(1, Math.ceil(c / 6)), quietNow: false, waiting: true }); }
        return json(200, { ok: true, sent: false, waiting: true });
      }
      if (spec.kind === 'annlist') {
        var cached = await metaGet(db, key), list = cached == null ? [] : parse2(cached);
        if (!Array.isArray(list)) list = [];
        var q = await db.query("SELECT id, body, created_at FROM finance_ops WHERE url = '/api/announcements' ORDER BY id DESC");
        var mine = q.map(function (r) { var b = parse2(r.body) || {}; return { id: 'q' + r.id, title: b.title, body: b.body, from: b.senderName || 'Admin', senderType: 'ADMIN', audience: b.audience, className: b.className || null, priority: b.priority || 'normal', date: new Date(Number(r.created_at)).toISOString(), waiting: true }; });
        return json(200, mine.concat(list));
      }
      if (spec.kind === 'wastatus') {
        var st = await metaGet(db, key);
        if (st == null) return fail(503, 'Connect to the internet once so the WhatsApp status can be checked.');
        var o = parse2(st); if (o && typeof o === 'object') o.offlineCached = true; return json(200, o);
      }
      // recipients: built from the students on the phone
      var cn = req.query.get('className'), sec = req.query.get('section'), mk = req.query.get('monthKey');
      var rows = await db.query('SELECT json FROM students ORDER BY id'), classes = {}, sections = {}, out = [];
      for (var i = 0; i < rows.length; i++) {
        var st2 = parse(rows[i].json);
        if (st2.status != null && String(st2.status).trim() !== '' && String(st2.status).toLowerCase() !== 'active') continue;
        var cls = st2.studentClass == null ? '' : String(st2.studentClass).trim();
        if (cls) classes[cls] = 1;
        if (isBlank(cn) || String(cn).trim().toLowerCase() !== cls.toLowerCase()) continue;
        var sc2 = st2.section == null ? '' : String(st2.section).trim();
        if (sc2) sections[sc2] = 1;
        if (!isBlank(sec) && String(sec).trim().toLowerCase() !== sc2.toLowerCase()) continue;
        var shown = waPhone(st2.phone2), bal = null;
        if (!isBlank(mk)) { var fr = await finFind(db, 'STUDENT_FEE', st2.regNo, mk); if (fr) bal = fr.remainingBalance == null ? 0 : Number(fr.remainingBalance); }
        out.push({ regNo: st2.regNo, name: st2.fullName || '', className: cls, section: sc2, phone: shown, hasPhone: shown != null, balance: bal });
      }
      out.sort(function (a, b) { return String(a.name).toLowerCase() < String(b.name).toLowerCase() ? -1 : 1; });
      var cl = Object.keys(classes).sort(function (a, b) { return classRank(a) - classRank(b) || (a < b ? -1 : 1); });
      return json(200, { classes: cl, sections: Object.keys(sections).sort(), students: out, maxPerSend: 100, offlineCached: true });
    });
  }

  // ───────────── <img> tags pointing at /api/students/{reg}/photo|bform are answered from the phone ─────────────
  var IMG_RE = /\/api\/students\/([^/?#]+)\/(photo|bform)(?:[?#]|$)/;
  var IMGC = {};                                          // 'regNo|photo' -> data URI, kept in memory so a picture can be swapped in AT ONCE (before the page sees a failed load)
  function imgSync(src) { var x = IMG_RE.exec(src || ''); return x ? (IMGC[decodeURIComponent(x[1]) + '|' + x[2]] || null) : null; }
  async function loadImgCache() {
    try {
      var db = await window.SoftSchoolLocalDB.ready(), rows = await db.query('SELECT reg_no, json FROM students'), files = {};
      (await db.query("SELECT path, data FROM local_files WHERE data <> 'data:,'")).forEach(function (f) { files[f.path] = f.data; });
      var c = {};
      rows.forEach(function (r) {
        var o = parse(r.json);
        [['photo', o.photo], ['bform', o.certData]].forEach(function (p) {
          var v = p[1], d = null;
          if (typeof v === 'string' && v.indexOf('data:') === 0) d = v; else if (v && files[v]) d = files[v];
          if (!d && p[0] === 'photo') { var pre = 'reg:' + r.reg_no + ':photo:'; for (var k in files) if (k.indexOf(pre) === 0) { d = files[k]; break; } }
          if (d) c[r.reg_no + '|' + p[0]] = d;
        });
      });
      IMGC = c;
      var imgs = document.querySelectorAll('img[src*="/api/students/"]'); for (var i = 0; i < imgs.length; i++) localImage(imgs[i]);
    } catch (e) { /* ignore */ }
  }
  async function localImage(img) {
    try {
      var m = mode(); if (m !== 'offline' && m !== 'hybrid') return;
      var src = img.getAttribute('src') || ''; var x = IMG_RE.exec(src); if (!x || src.indexOf('data:') === 0) return;
      var hit = imgSync(src); if (hit) { img.setAttribute('src', hit); return; }
      var db = await window.SoftSchoolLocalDB.ready(), d = await fileData(db, decodeURIComponent(x[1]), x[2]);
      if (d && img.getAttribute('src') === src) img.setAttribute('src', d);
    } catch (e) { /* the normal address stays */ }
  }
  setTimeout(loadImgCache, 800);
  window.__softschoolLoadImgCache = loadImgCache;
  function scanImages(root) {
    try {
      if (root.nodeType !== 1) return;
      if (root.tagName === 'IMG') localImage(root);
      var l = root.querySelectorAll ? root.querySelectorAll('img[src*="/api/students/"]') : [];
      for (var i = 0; i < l.length; i++) localImage(l[i]);
    } catch (e) { /* ignore */ }
  }
  try {
    var IS = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');       // img.src = url  and  setAttribute('src', url): swap in the local picture before anything is requested
    if (IS && IS.set) Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, enumerable: IS.enumerable, get: IS.get, set: function (v) { var h = (mode() === 'offline' || mode() === 'hybrid') ? imgSync(String(v)) : null; IS.set.call(this, h || v); } });
    var SA = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (n, v) { if (this.tagName === 'IMG' && String(n).toLowerCase() === 'src' && (mode() === 'offline' || mode() === 'hybrid')) { var h = imgSync(String(v)); if (h) v = h; } return SA.call(this, n, v); };
  } catch (e) { /* ignore */ }
  try {
    if (window.MutationObserver && document.documentElement) {
      new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var r = list[i];
          if (r.type === 'attributes') { if (r.target.tagName === 'IMG') localImage(r.target); }
          else for (var j = 0; j < r.addedNodes.length; j++) scanImages(r.addedNodes[j]);
        }
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }
    if (mode() === 'offline' && document.head && !document.querySelector('meta[data-ss-csp]')) {   // offline only: the browser may not fetch pictures from the internet
      var csp = document.createElement('meta'); csp.setAttribute('http-equiv', 'Content-Security-Policy'); csp.setAttribute('data-ss-csp', '1');
      csp.setAttribute('content', "img-src 'self' data: blob:"); document.head.appendChild(csp);
    }
  } catch (e) { /* ignore */ }

  var OFFLINE_SERVER_OK = ['/api/school/login', '/api/school/login-token', '/api/school/status', '/api/school/logout'];
  function offlineAllowed(path) {                       // only the account check; every school record stays on the phone
    for (var i = 0; i < OFFLINE_SERVER_OK.length; i++) if (path === OFFLINE_SERVER_OK[i]) return true;
    return !(path.indexOf('/api/school/') === 0 || path.indexOf('/api/push/') === 0);
  }
  function pathOf(u) { try { return new URL(String(u), window.location.href).pathname.replace(/\/+$/, ''); } catch (e) { return ''; } }
  function leaks(u) { var p = pathOf(u); return mode() === 'offline' && p.indexOf('/api/') === 0 && OFFLINE_SERVER_OK.indexOf(p) < 0; }
  try {                                                 // other ways a page could reach the server: XHR, beacons, event streams, sockets
    var XO = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
    if (XO) window.XMLHttpRequest.prototype.open = function (method, url) { if (leaks(url)) throw new Error('offline_not_available'); return XO.apply(this, arguments); };
    if (navigator.sendBeacon) { var SB = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = function (url) { return leaks(url) ? false : SB.apply(null, arguments); }; }
    if (window.EventSource) { var ES = window.EventSource; window.EventSource = function (url, o) { if (leaks(url)) throw new Error('offline_not_available'); return new ES(url, o); }; }
    if (window.WebSocket) { var WS = window.WebSocket; window.WebSocket = function (url, p) { if (mode() === 'offline') throw new Error('offline_not_available'); return p === undefined ? new WS(url) : new WS(url, p); }; window.WebSocket.prototype = WS.prototype; }
  } catch (e) { /* ignore */ }

  window.fetch = function (input, init) {
    var m = mode();
    if (m !== 'offline' && m !== 'hybrid') return realFetch(input, init);          // ONLINE school: untouched

    var req = describe(input, init);
    if (!req || req.path.indexOf('/api/') !== 0) return realFetch(input, init);    // not an app API call
    if (m === 'offline') {                                                          // offline only: the server is used for sign-in / status checks and NOTHING else
      if (!offlineAllowed(req.path)) return Promise.resolve(fail(501, 'offline_not_available', 'This feature is not available in offline mode.'));
      if (req.path.indexOf('/api/school/') === 0 || req.path.indexOf('/api/app/') === 0) return realFetch(input, init);   // sign-in/status, app version and event picture: not school data
    } else {
      for (var i = 0; i < ALWAYS_SERVER.length; i++) {
        if (req.path.indexOf(ALWAYS_SERVER[i]) === 0) return realFetch(input, init);
      }
    }
    if (req.method === 'GET' && /^\/api\/exams\/images\/[^/]+$/.test(req.path)) { if (!currentSchool()) return Promise.resolve(fail(401, 'Please log in again.')); return examImgGet(req, input, init, m).catch(function () { return empty(404); }); }
    if (m === 'hybrid') { var dspec = deferredSpec(req); if (dspec) return runDeferred(dspec, req, input, init); }
    var found = findRoute(req);
    if (found) return run(found, req);
    if (m === 'offline') {                                                          // fail closed: never leak to the server
      return Promise.resolve(fail(501, 'offline_not_available', 'This feature is not available in offline mode yet.'));
    }
    return realFetch(input, init);                                                  // hybrid: modules not on the phone yet
  };
})();

/*!
 * HYBRID UPLOAD (Step 5) - copies what was saved on the phone to the online database.
 *
 * Only runs for a HYBRID school. Online schools and offline-only schools never upload anything.
 * What it does, whenever the phone is online (app start, internet comes back, app reopened, every minute,
 * and a few seconds after each save):
 *   1. deletes on the server what was deleted on the phone (staff),
 *   2. uploads students, staff and attendance marked dirty=1, one by one, through the normal server routes
 *      (so the server's own rules and plan limits apply),
 *   3. marks each row uploaded (dirty=0, server_id saved) - but only if it was not changed meanwhile.
 * Then (Step 6) it DOWNLOADS the school's students, staff and attendance from the server (first time right after
 * sign-in, then every 10 minutes), never touching a row that still waits to upload.
 * A row the server refuses (plan limit, locked feature, bad data) stays on the phone and is retried later.
 * No internet / sign-in expired: stops quietly and tries again later. Nothing is ever lost.
 */
(function () {
  'use strict';
  if (window.SoftSchoolSync) return;
  var SESSION_KEY = 'softschool_session';
  var ATT_BATCH = 100;

  var state = { running: false, again: false, lastSync: null, lastError: null, pending: 0, refused: 0, timer: null };

  function school() { try { var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return s && s.school && s.school.schoolId ? s.school : null; } catch (e) { return null; } }
  function active() {
    var M = window.SoftSchoolMode;
    return !!(school() && M && M.get && M.get() === 'hybrid' && window.SoftSchoolLocalDB && window.__softschoolRealFetch);
  }
  function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
  function parse(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }
  function emit() {
    try { window.dispatchEvent(new window.CustomEvent('softschool:sync', { detail: status() })); } catch (e) { /* ignore */ }
    pill();
  }
  function status() { return { pending: state.pending, refused: state.refused, running: state.running, lastSync: state.lastSync, lastError: state.lastError }; }

  // small label at the bottom-left, only while something is waiting or refused
  var pillEl = null;
  function pill() {
    try {
      if (!active()) { if (pillEl) pillEl.style.display = 'none'; return; }
      if (!pillEl) {
        pillEl = document.createElement('div');
        pillEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99998;padding:4px 10px;border-radius:12px;font:12px sans-serif;color:#fff;background:#555;opacity:.9;pointer-events:none';
        document.body.appendChild(pillEl);
      }
      var t = '';
      if (state.running) t = state.pending > 0 ? 'Copying data to the server…' : 'Syncing…';
      else if (state.refused > 0) t = state.refused + ' not accepted by server';
      else if (state.pending > 0) t = state.pending + ' waiting to upload';
      pillEl.textContent = t;
      pillEl.style.display = t ? 'block' : 'none';
      pillEl.style.background = (!state.running && state.refused > 0) ? '#b45309' : '#555';
    } catch (e) { /* the label is optional */ }
  }

  function sessToken() { try { return window.sessionStorage.getItem('softschool_api_token') || ''; } catch (e) { return ''; } }
  function rawPost(path, method, body) {
    var origin = (window.SOFTSCHOOL_API_BASE || 'https://thesoftschool.com'), headers = { 'Content-Type': 'application/json' }, t = sessToken();
    if (t) headers.Authorization = 'Bearer ' + t;
    return window.__softschoolRealFetch(origin + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  // The sign-in token lives only until the app is closed. If the app was opened without internet it is missing:
  // trade the saved "remember me" key for a new one (the same call the login page makes), once at a time.
  var refreshing = null;
  function refreshToken() {
    if (refreshing) return refreshing;
    refreshing = (async function () {
      try {
        var raw = window.localStorage.getItem('softschool_remember'), rem = raw ? JSON.parse(raw) : null;
        if (!rem || !rem.username || !rem.token) return false;
        var origin = (window.SOFTSCHOOL_API_BASE || 'https://thesoftschool.com');
        var res = await window.__softschoolRealFetch(origin + '/api/school/login-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: rem.username, token: rem.token }) });
        if (!res.ok) return false;
        var j = await res.json();
        if (!j || !j.sessionToken) return false;
        window.sessionStorage.setItem('softschool_api_token', j.sessionToken);
        if (j.rememberToken) window.localStorage.setItem('softschool_remember', JSON.stringify({ username: j.username || rem.username, token: j.rememberToken }));
        return true;
      } catch (e) { return false; }
    })();
    var done = function () { refreshing = null; };
    refreshing.then(done, done);
    return refreshing;
  }
  async function post(path, method, body) {
    if (!sessToken()) await refreshToken();
    var res = await rawPost(path, method, body);
    if (res.status === 401 && await refreshToken()) res = await rawPost(path, method, body);
    return res;
  }
  // network down / expired sign-in -> stop everything now and retry later
  function Stop(msg) { this.message = msg; }
  function check(res) {
    if (res.status === 401) throw new Stop('sign-in expired');
    if (res.status >= 500 || res.status === 429 || res.status === 408) throw new Stop('server busy (' + res.status + ')');
    return res;
  }

  async function count(db) {
    var n = 0;
    var q = ['SELECT count(*) AS n FROM students WHERE dirty = 1', 'SELECT count(*) AS n FROM staff WHERE dirty = 1',
             'SELECT count(*) AS n FROM attendance WHERE dirty = 1', 'SELECT count(*) AS n FROM pending_deletes'];
    q.push("SELECT count(*) AS n FROM meta WHERE k = 'settings_dirty' AND v = '1'");
    q.push("SELECT count(*) AS n FROM meta WHERE k LIKE 'fin:%:dirty' AND v = '1'");
    q.push('SELECT count(*) AS n FROM sessions WHERE dirty = 1');
    q.push('SELECT count(*) AS n FROM finance_ops');
    for (var i = 0; i < q.length; i++) { var r = await db.query(q[i]); n += Number(r[0].n) || 0; }
    return n;
  }

  async function doDeletes(db, sc) {
    var rows = await db.query('SELECT id, module, item_key FROM pending_deletes ORDER BY id');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], path = (r.module === 'sessions' ? '/api/sessions/' : '/api/staff/') + encodeURIComponent(r.item_key) + '?schoolId=' + encodeURIComponent(sc.schoolId);
      var res = check(await post(path, 'DELETE'));
      if (res.ok || res.status === 404) await db.run('DELETE FROM pending_deletes WHERE id = ?', [r.id]);
      else state.refused++;
    }
  }

  function fileToDataUri(f) { return new Promise(function (ok, bad) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { bad(r.error); }; r.readAsDataURL(f); }); }
  function uri2blob(u) { var i = u.indexOf(','), mime = (/^data:([^;,]+)/.exec(u) || [])[1] || 'application/octet-stream', bin = atob(u.slice(i + 1)), a = new Uint8Array(bin.length); for (var k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k); return new Blob([a], { type: mime }); }
  function isLocalPath(v) { return typeof v === 'string' && /^(photos|bforms)\/local-/.test(v); }
  // photos made on the phone: upload the picture first, then the student record carries the server's path
  async function doFiles(db, sc) {
    var rows = await db.query('SELECT id, json FROM students WHERE dirty = 1 ORDER BY id');
    for (var i = 0; i < rows.length; i++) {
      var o = parse(rows[i].json), changed = false;
      for (var k = 0; k < 2; k++) {
        var field = k ? 'certData' : 'photo', kind = k ? 'bform' : 'photo', v = o[field];
        if (!isLocalPath(v)) continue;
        var f = await db.query('SELECT data FROM local_files WHERE path = ?', [v]);
        if (!f.length) { delete o[field]; changed = true; continue; }
        var fd = new FormData(); fd.append('file', uri2blob(f[0].data), kind + (/pdf/.test(f[0].data.slice(0, 30)) ? '.pdf' : '.jpg'));
        var h = {}, t = sessToken(); if (!t && await refreshToken()) t = sessToken(); if (t) h.Authorization = 'Bearer ' + t;
        var res = check(await window.__softschoolRealFetch((window.SOFTSCHOOL_API_BASE || 'https://thesoftschool.com') + '/api/students/files/' + kind + '?schoolId=' + encodeURIComponent(sc.schoolId), { method: 'POST', headers: h, body: fd }));
        if (!res.ok) { state.refused++; state.lastError = 'photo refused (' + res.status + ')'; continue; }
        var j = null; try { j = await res.json(); } catch (e) { /* ignore */ }
        if (!j || !j.path) continue;
        await db.run('INSERT OR REPLACE INTO local_files (path, data, created_at) VALUES (?, ?, ?)', [j.path, f[0].data, Date.now()]);
        o[field] = j.path; changed = true;
      }
      if (changed) await db.run('UPDATE students SET json = ? WHERE id = ?', [JSON.stringify(o), rows[i].id]);   // still waiting for upload (dirty stays 1)
    }
  }

  // exam pictures made on the phone: upload them, then swap the old path for the server's path inside papers and waiting changes
  async function localExamImgs(db) { return (await db.query("SELECT path FROM local_files WHERE path LIKE 'exam-images/%'")).map(function (r) { return r.path; }); }
  async function doExamImages(db, sc) {
    var rows = await db.query("SELECT path, data FROM local_files WHERE path LIKE 'exam-images/%'");
    for (var i = 0; i < rows.length; i++) {
      var fd = new FormData(); fd.append('file', uri2blob(rows[i].data), 'picture.' + (/^data:image\/png/.test(rows[i].data) ? 'png' : 'jpg'));
      var h = {}, t = sessToken(); if (!t && await refreshToken()) t = sessToken(); if (t) h.Authorization = 'Bearer ' + t;
      var res = check(await window.__softschoolRealFetch((window.SOFTSCHOOL_API_BASE || 'https://thesoftschool.com') + '/api/exams/images?schoolId=' + encodeURIComponent(sc.schoolId), { method: 'POST', headers: h, body: fd }));
      if (!res.ok) { state.refused++; state.lastError = 'exam picture refused (' + res.status + ')'; continue; }
      var j = null; try { j = await res.json(); } catch (e) { /* ignore */ }
      if (!j || !/^exam-images\//.test(j.path || '')) continue;
      await db.run('UPDATE exams SET json = REPLACE(json, ?, ?)', [rows[i].path, j.path]);
      await db.run('UPDATE finance_ops SET body = REPLACE(body, ?, ?) WHERE url LIKE ?', [rows[i].path, j.path, '/api/exams/%']);
      await db.run('INSERT OR REPLACE INTO local_files (path, data, created_at) VALUES (?, ?, ?)', ['srv:' + j.path, rows[i].data, Date.now()]);
      await db.run('DELETE FROM local_files WHERE path = ?', [rows[i].path]);
    }
  }

  // students + staff: one request per row
  async function doRows(db, sc, table, path, label) {
    var rows = await db.query('SELECT id, json, updated_at FROM ' + table + ' WHERE dirty = 1 ORDER BY id');
    for (var i = 0; i < rows.length; i++) {
      var rec = parse(rows[i].json); delete rec.id; delete rec.hasPhoto; rec.schoolId = sc.schoolId;
      if (table === 'students' && (isLocalPath(rec.photo) || isLocalPath(rec.certData))) continue;   // its picture is not on the server yet
      if (table === 'staff') { delete rec.password; delete rec.passwordHash; }
      var res = check(await post(path, 'POST', rec));
      if (!res.ok) { state.refused++; state.lastError = label + ' refused (' + res.status + ')'; continue; }
      var serverId = null;
      try { var j = await res.json(); serverId = j && j.id != null ? j.id : null; } catch (e) { /* keep null */ }
      await db.run('UPDATE ' + table + ' SET dirty = 0, server_id = ? WHERE id = ? AND updated_at = ?', [serverId, rows[i].id, rows[i].updated_at]);
    }
  }

  async function doAttendance(db, sc) {
    var rows = await db.query('SELECT id, json, updated_at FROM attendance WHERE dirty = 1 ORDER BY id');
    for (var i = 0; i < rows.length; i += ATT_BATCH) {
      var part = rows.slice(i, i + ATT_BATCH);
      var body = part.map(function (r) { var o = parse(r.json); delete o.id; o.schoolId = sc.schoolId; return o; });
      var res = check(await post('/api/attendance/save', 'POST', body));
      if (!res.ok) { state.refused += part.length; state.lastError = 'attendance refused (' + res.status + ')'; continue; }
      for (var k = 0; k < part.length; k++) {
        await db.run('UPDATE attendance SET dirty = 0 WHERE id = ? AND updated_at = ?', [part[k].id, part[k].updated_at]);
      }
    }
  }

  async function doSettings(db, sc) {
    var d = await db.query("SELECT v FROM meta WHERE k = 'settings_dirty'");
    if (!d.length || d[0].v !== '1') return;
    var stamp = await db.query("SELECT v FROM meta WHERE k = 'settings_stamp'");
    var sj = await db.query("SELECT v FROM meta WHERE k = 'settings'");
    if (!sj.length) return;
    var o = parse(sj[0].v), body = {}, tim = {};
    Object.keys(o).forEach(function (k) { if (k !== 'id' && k !== 'schoolId') body[k] = o[k]; });
    ['autosave1Hour', 'autosave1Minute', 'autosave1Meridiem', 'autosave1Enabled', 'autosave2Hour', 'autosave2Minute', 'autosave2Meridiem', 'autosave2Enabled', 'dailyAbsentNotify'].forEach(function (k) { if (k in o) tim[k] = o[k]; });
    var base = '/api/settings/' + encodeURIComponent(sc.schoolId);
    var r1 = check(await post(base, 'PUT', body));
    var r2 = r1.ok ? check(await post(base + '/timing', 'PUT', tim)) : null;
    if (!r1.ok || !r2 || !r2.ok) { state.refused++; state.lastError = 'settings refused (' + (r1.ok ? r2 && r2.status : r1.status) + ')'; return; }
    var now = await db.query("SELECT v FROM meta WHERE k = 'settings_stamp'");
    if ((now.length ? now[0].v : null) === (stamp.length ? stamp[0].v : null)) await db.run("INSERT OR REPLACE INTO meta (k, v) VALUES ('settings_dirty', '0')");
  }
  async function pullSettings(db, sc) {
    var d = await db.query("SELECT v FROM meta WHERE k = 'settings_dirty'");
    if (d.length && d[0].v === '1') return;               // a change on the phone is still waiting
    var res = check(await post('/api/settings/' + encodeURIComponent(sc.schoolId), 'GET'));
    if (!res.ok) throw new Stop('download refused (' + res.status + ')');
    var j = await res.json();
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Stop('unexpected server answer');
    delete j.teacherPasswordHash;
    await db.run("INSERT OR REPLACE INTO meta (k, v) VALUES ('settings', ?)", [JSON.stringify(j)]);
  }

  // ───────────── finance lists + sessions ─────────────
  function parse2(s) { try { return JSON.parse(s); } catch (e) { return []; } }
  var BLOBS = ['custom-fees', 'staff-bonus', 'staff-fines', 'expenses', 'vouchers'];   // staff-advances stays on the server in hybrid
  function sameItem(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  async function doBlobs(db, sc) {
    for (var i = 0; i < BLOBS.length; i++) {
      var name = BLOBS[i], k = 'fin:' + name;
      var d = await db.query('SELECT v FROM meta WHERE k = ?', [k + ':dirty']);
      if (!d.length || d[0].v !== '1') continue;
      var stamp = await db.query('SELECT v FROM meta WHERE k = ?', [k + ':stamp']);
      var cur = await db.query('SELECT v FROM meta WHERE k = ?', [k]);
      var items = cur.length ? parse2(cur[0].v) : [];
      var pulled = await db.query('SELECT v FROM meta WHERE k = ?', [k + ':pulled']);
      if (!pulled.length) {                               // never downloaded: add what the server already has, so nothing there is replaced
        var g = check(await post('/api/finance/' + name + '?schoolId=' + encodeURIComponent(sc.schoolId), 'GET'));
        if (!g.ok) { state.refused++; state.lastError = name + ' refused (' + g.status + ')'; continue; }
        var srv = await g.json();
        if (Array.isArray(srv)) srv.forEach(function (it) { if (!items.some(function (x) { return sameItem(x, it); })) items.push(it); });
        await db.run('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', [k, JSON.stringify(items)]);
      }
      var res = check(await post('/api/finance/' + name, 'PUT', { items: items, schoolId: sc.schoolId }));
      if (!res.ok) { state.refused++; state.lastError = name + ' refused (' + res.status + ')'; continue; }
      await db.run('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', [k + ':pulled', '1']);
      var now = await db.query('SELECT v FROM meta WHERE k = ?', [k + ':stamp']);
      if ((now.length ? now[0].v : null) === (stamp.length ? stamp[0].v : null)) await db.run('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', [k + ':dirty', '0']);
    }
  }
  async function pullBlobs(db, sc) {
    for (var i = 0; i < BLOBS.length; i++) {
      var name = BLOBS[i], k = 'fin:' + name;
      var d = await db.query('SELECT v FROM meta WHERE k = ?', [k + ':dirty']);
      if (d.length && d[0].v === '1') continue;
      var res = check(await post('/api/finance/' + name + '?schoolId=' + encodeURIComponent(sc.schoolId), 'GET'));
      if (!res.ok) continue;                              // e.g. finance locked on the plan: leave as is
      var j = await res.json();
      if (!Array.isArray(j)) throw new Stop('unexpected server answer');
      await db.run('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', [k, JSON.stringify(j)]);
      await db.run('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', [k + ':pulled', '1']);
    }
  }
  async function doSessions(db, sc) {
    var rows = await db.query('SELECT * FROM sessions WHERE dirty = 1 ORDER BY id');
    var q = '?schoolId=' + encodeURIComponent(sc.schoolId);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], body = { schoolId: sc.schoolId, startMonth: r.start_month, endMonth: r.end_month, firstSession: r.first_session === 1 };
      var sid = r.server_id, res;
      if (sid == null) {
        res = check(await post('/api/sessions' + q, 'POST', body));
        if (res.status === 409) {                          // the same range already exists online: link to it
          var l = check(await post('/api/sessions' + q, 'GET'));
          var list = l.ok ? await l.json() : [];
          var hit = Array.isArray(list) ? list.filter(function (x) { return x.startMonth === r.start_month && x.endMonth === r.end_month; })[0] : null;
          if (!hit) { state.refused++; continue; }
          sid = hit.id;
        } else if (res.ok) { sid = (await res.json()).id; }
        else { state.refused++; state.lastError = 'session refused (' + res.status + ')'; continue; }
      } else {
        res = check(await post('/api/sessions/' + sid + q, 'PUT', body));
        if (!res.ok) { state.refused++; state.lastError = 'session refused (' + res.status + ')'; continue; }
      }
      if (r.current_session === 1) { var cr = check(await post('/api/sessions/' + sid + '/current' + q, 'PUT')); if (!cr.ok) { state.refused++; continue; } }
      await db.run('UPDATE sessions SET dirty = 0, server_id = ? WHERE id = ? AND updated_at = ?', [sid, r.id, r.updated_at]);
    }
  }
  async function pullSessions(db, sc) {
    var res = check(await post('/api/sessions?schoolId=' + encodeURIComponent(sc.schoolId), 'GET'));
    if (!res.ok) return;
    var list = await res.json();
    if (!Array.isArray(list)) throw new Stop('unexpected server answer');
    var local = await db.query('SELECT id, start_month, end_month, server_id, dirty FROM sessions');
    var byRange = {}; local.forEach(function (r) { byRange[r.start_month + '|' + r.end_month] = r; });
    var now = Date.now(), sql = [], onServer = {};
    list.forEach(function (x) {
      if (!x || !x.startMonth || !x.endMonth) return;
      var key = x.startMonth + '|' + x.endMonth, cur = byRange[key]; onServer[key] = true;
      if (cur && cur.dirty === 1) return;
      if (cur) sql.push('UPDATE sessions SET first_session=' + (x.firstSession ? 1 : 0) + ', current_session=' + (x.currentSession ? 1 : 0) + ', server_id=' + lit(x.id) + ', dirty=0, updated_at=' + now + ' WHERE id=' + cur.id);
      else sql.push('INSERT INTO sessions (start_month, end_month, first_session, current_session, server_id, dirty, updated_at) VALUES (' + [lit(x.startMonth), lit(x.endMonth), x.firstSession ? 1 : 0, x.currentSession ? 1 : 0, lit(x.id)].join(',') + ',0,' + now + ')');
    });
    local.forEach(function (r) { if (!onServer[r.start_month + '|' + r.end_month] && r.dirty === 0 && r.server_id != null) sql.push('DELETE FROM sessions WHERE id=' + r.id); });
    await runSql(db, sql);
  }

  // ───────────── Step 6: download the server's data to the phone ─────────────
  var PULL_EVERY = 25 * 1000;                          // bring down what changed on the server (web, other phones) at most every 25 seconds while the app is open
  var FULL_FINANCE_EVERY = 10 * 60 * 1000;             // all fee months: every 10 minutes (the current months come with every 25-second round)
  var PULL_CHUNK = 200;
  function lit(v) {                                   // a value as an SQL literal
    if (v == null) return 'NULL';
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? '1' : '0';
    return "'" + String(v).replace(/'/g, "''") + "'";
  }
  async function runSql(db, list) {                   // many statements, a few bridge calls
    for (var i = 0; i < list.length; i += PULL_CHUNK) {
      var part = list.slice(i, i + PULL_CHUNK);
      if (db.batch) await db.batch(part); else await db.exec(part.join(';\n'));
    }
  }
  async function getList(path) {
    var sc = school();
    var res = check(await post(path + '?schoolId=' + encodeURIComponent(sc.schoolId), 'GET'));
    if (!res.ok) throw new Stop('download refused (' + res.status + ')');
    var j = await res.json();
    if (!Array.isArray(j)) throw new Stop('unexpected server answer');
    return j;
  }
  function textOrNull(v) { return v == null ? null : String(v); }

  async function pullStudents(db, sc) {
    var list = await getList('/api/students/list');   // the FULL student record (everything except the photo files); /sync only carries ~25 fee fields
    var local = await db.query('SELECT reg_no, dirty, json FROM students');
    var have = {}, mine = {}; local.forEach(function (r) { have[r.reg_no] = r.dirty; if (r.dirty === 1) mine[r.reg_no] = r.json; });
    var now = Date.now(), sql = [];
    list.forEach(function (st) {
      if (!st || st.regNo == null || String(st.regNo) === '') return;
      var reg = String(st.regNo);
      var sid = st.id == null ? null : st.id;
      var o = Object.assign({}, st); delete o.id; delete o.photo; delete o.certData; o.schoolId = sc.schoolId;
      if (have[reg] === 1) {                           // changed on the phone: the phone version wins, but fill in anything it is missing from the server copy
        var cur = parse(mine[reg]), changed = false;
        Object.keys(o).forEach(function (k) { if (k !== 'hasPhoto' && (cur[k] === undefined || cur[k] === null) && o[k] !== undefined && o[k] !== null) { cur[k] = o[k]; changed = true; } });
        if (changed) sql.push('UPDATE students SET json=' + lit(JSON.stringify(cur)) + ' WHERE reg_no=' + lit(reg) + ' AND dirty=1');
        return;
      }
      var js = JSON.stringify(o);
      if (reg in have) {
        sql.push('UPDATE students SET full_name=' + lit(textOrNull(o.fullName)) + ', student_class=' + lit(textOrNull(o.studentClass)) + ', section=' + lit(textOrNull(o.section)) +
          ', status=' + lit(textOrNull(o.status == null ? 'active' : o.status)) + ', json=' + lit(js) + ', server_id=' + lit(sid) + ', dirty=0, updated_at=' + now + ' WHERE reg_no=' + lit(reg));
      } else {
        sql.push('INSERT INTO students (reg_no, full_name, student_class, section, status, json, server_id, dirty, updated_at) VALUES (' + [lit(reg), lit(textOrNull(o.fullName)), lit(textOrNull(o.studentClass)),
          lit(textOrNull(o.section)), lit(textOrNull(o.status == null ? 'active' : o.status)), lit(js), lit(sid)].join(',') + ',0,' + now + ')');
      }
    });
    await runSql(db, sql);
  }

  async function pullStaff(db, sc) {
    var list = await getList('/api/staff');
    var local = await db.query('SELECT staff_id, dirty, server_id FROM staff');
    var have = {}; local.forEach(function (r) { have[String(r.staff_id).toLowerCase()] = r; });
    var now = Date.now(), sql = [], onServer = {};
    list.forEach(function (st) {
      if (!st || st.staffId == null || String(st.staffId) === '') return;
      var key = String(st.staffId).toLowerCase(); onServer[key] = true;
      var cur = have[key];
      if (cur && cur.dirty === 1) return;
      var sid = st.id == null ? null : st.id;
      var o = Object.assign({}, st); delete o.id; delete o.password; delete o.passwordHash; o.schoolId = sc.schoolId;
      var js = JSON.stringify(o), arch = o.archived === true ? 1 : 0;
      if (cur) {
        sql.push('UPDATE staff SET type=' + lit(textOrNull(o.type)) + ', name=' + lit(textOrNull(o.name)) + ', archived=' + arch + ', json=' + lit(js) + ', server_id=' + lit(sid) + ', dirty=0, updated_at=' + now +
          ', staff_id=' + lit(String(o.staffId)) + ' WHERE staff_id=' + lit(String(cur.staff_id)));
      } else {
        sql.push('INSERT INTO staff (staff_id, type, name, archived, json, server_id, dirty, updated_at) VALUES (' + [lit(String(o.staffId)), lit(textOrNull(o.type)), lit(textOrNull(o.name)), arch, lit(js), lit(sid)].join(',') + ',0,' + now + ')');
      }
    });
    Object.keys(have).forEach(function (key) {         // removed on the server and not changed here -> remove here too
      var r = have[key];
      if (!onServer[key] && r.dirty === 0 && r.server_id != null) sql.push('DELETE FROM staff WHERE staff_id=' + lit(String(r.staff_id)));
    });
    await runSql(db, sql);
  }

  async function pullAttendance(db, sc) {
    var list = await getList('/api/attendance/all');
    var local = await db.query('SELECT member_id, att_date, dirty FROM attendance');
    var have = {}; local.forEach(function (r) { have[String(r.member_id).toLowerCase() + '|' + r.att_date] = r.dirty; });
    var now = Date.now(), sql = [];
    list.forEach(function (a) {
      if (!a || a.memberId == null || a.date == null) return;
      var d = /^(\d{4}-\d{2}-\d{2})/.exec(String(a.date)); if (!d) return;
      var mid = String(a.memberId), key = mid.toLowerCase() + '|' + d[1];
      if (have[key] === 1) return;
      var o = Object.assign({}, a); delete o.id; delete o.capturedPhoto; o.schoolId = sc.schoolId; o.date = d[1];
      var js = JSON.stringify(o);
      if (key in have) {
        sql.push('UPDATE attendance SET member_type=' + lit(textOrNull(o.memberType)) + ', class_name=' + lit(textOrNull(o.className)) + ', section=' + lit(textOrNull(o.section)) + ', status=' + lit(textOrNull(o.status)) +
          ', check_in=' + lit(textOrNull(o.checkIn)) + ', check_out=' + lit(textOrNull(o.checkOut)) + ', json=' + lit(js) + ', dirty=0, updated_at=' + now + ' WHERE member_id=' + lit(mid) + ' AND att_date=' + lit(d[1]));
      } else {
        sql.push('INSERT INTO attendance (member_id, att_date, member_type, class_name, section, status, check_in, check_out, json, dirty, updated_at) VALUES (' +
          [lit(mid), lit(d[1]), lit(textOrNull(o.memberType)), lit(textOrNull(o.className)), lit(textOrNull(o.section)), lit(textOrNull(o.status)), lit(textOrNull(o.checkIn)), lit(textOrNull(o.checkOut)), lit(js)].join(',') + ',0,' + now + ')');
        have[key] = 0;
      }
    });
    await runSql(db, sql);
  }

  // ───────────── hybrid finance: replay the money actions on the server, then copy the server's ledger back ─────────────
  async function addRefused(db, op, why) {
    var v = await db.query("SELECT v FROM meta WHERE k = 'fin_ops_refused'"), list = v.length ? parse2(v[0].v) : [];
    list.push({ method: op.method, url: op.url, body: op.body ? parse2(op.body) : null, why: why, at: Date.now() });
    await db.run("INSERT OR REPLACE INTO meta (k, v) VALUES ('fin_ops_refused', ?)", [JSON.stringify(list.slice(-50))]);
  }
  async function doFinanceOps(db, sc) {
    var ops = await db.query('SELECT id, method, url, body FROM finance_ops ORDER BY id'), done = 0;
    var q = 'schoolId=' + encodeURIComponent(sc.schoolId);
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i], url = op.url, body = op.body ? parse2(op.body) : undefined;
      if (op.body && /exam-images\//.test(op.body) && /^\/api\/exams\//.test(url)) { var lp = await localExamImgs(db); if (lp.some(function (x) { return op.body.indexOf(x) >= 0; })) continue; }   // its picture is not on the server yet
      if (body && typeof body === 'object' && !Array.isArray(body) && url.indexOf('/api/finance') === 0) body.schoolId = sc.schoolId;
      var fm = /^\/api\/finance\/pay-fine\/(\d+)$/.exec(url);
      if (fm) {                                        // the fine's number on the phone is not its number on the server: find the same fine there
        var lr = await db.query('SELECT json FROM finance WHERE id = ?', [Number(fm[1])]);
        if (!lr.length) { await db.run('DELETE FROM finance_ops WHERE id = ?', [op.id]); continue; }
        var lf = parse2(lr[0].json), g = check(await post('/api/finance/fine-details/' + encodeURIComponent(lf.regNo) + '/' + encodeURIComponent(lf.monthKey) + '?' + q, 'GET'));
        var sl = g.ok ? await g.json() : [], hit = Array.isArray(sl) ? sl.filter(function (x) {
          var st = String(x.paymentStatus || '').toLowerCase();
          return st !== 'paid' && st !== 'settled' && Number(x.amount) === Number(lf.amount) && String(x.reason == null ? '' : x.reason) === String(lf.reason == null ? '' : lf.reason);
        })[0] : null;
        if (!hit) { await addRefused(db, op, 'fine not found on the server (maybe already paid)'); await db.run('DELETE FROM finance_ops WHERE id = ?', [op.id]); state.refused++; continue; }
        url = '/api/finance/pay-fine/' + hit.id;
      }
      var res = await post(url, op.method, body);
      if (/^\/api\/(whatsapp|announcements|messages)/.test(url) && res.status >= 500) continue;   // server trouble with a message: try again next time, do not block the others
      check(res);
      if (res.ok || (res.status === 404 && op.method === 'DELETE')) { await db.run('DELETE FROM finance_ops WHERE id = ?', [op.id]); done++; continue; }
      var why = res.status + ''; try { var e = await res.json(); if (e && e.error) why += ' ' + e.error; } catch (x) { /* ignore */ }
      await addRefused(db, op, why);                   // refused for good (e.g. salary already paid): keep a copy, do not block the rest
      await db.run('DELETE FROM finance_ops WHERE id = ?', [op.id]); state.refused++; state.lastError = 'finance entry refused (' + why + ')';
    }
    return done;
  }

  function monthsToPull(sessions) {
    var now = new Date(), cur = now.getFullYear() * 12 + now.getMonth(), end = cur + 1, start = cur - 12;
    var c = (sessions || []).filter(function (x) { return x.current_session === 1; })[0];
    if (c && /^\d{4}-\d{2}$/.test(c.start_month)) { var s0 = Number(c.start_month.slice(0, 4)) * 12 + Number(c.start_month.slice(5)) - 1; if (s0 < start && end - s0 <= 36) start = s0; }
    var out = []; for (var m = start; m <= end; m++) out.push(Math.floor(m / 12) + '-' + ('0' + (m % 12 + 1)).slice(-2));
    return out;
  }
  async function pullFinance(db, sc, full) {
    if (Number((await db.query('SELECT count(*) AS n FROM finance_ops'))[0].n) > 0) return;     // never overwrite money not yet uploaded
    var seq0 = await db.query("SELECT v FROM meta WHERE k = 'fin_seq'"), q = 'schoolId=' + encodeURIComponent(sc.schoolId);
    var months = monthsToPull(await db.query('SELECT start_month, current_session FROM sessions'));
    if (!full) { var nowD = new Date(), ck = nowD.getFullYear() * 12 + nowD.getMonth(), near = {}; [ck - 1, ck, ck + 1].forEach(function (v) { near[Math.floor(v / 12) + '-' + ('0' + (v % 12 + 1)).slice(-2)] = 1; }); months = months.filter(function (m) { return near[m]; }); }
    async function get(path) {
      var r = check(await post(path, 'GET'));
      if (!r.ok) throw new Stop('finance not available (' + r.status + ')');
      return r.json();
    }
    var rows = [];                                       // [type, month, reg, obj]
    function add(type, mk, reg, o) { var x = Object.assign({}, o); delete x.id; x.recordType = type; rows.push([type, mk == null ? null : mk, reg == null ? null : String(reg), JSON.stringify(x)]); }
    try {
      for (var i = 0; i < months.length; i++) {
        var mk = months[i], enc = encodeURIComponent(mk);
        var fees = await get('/api/finance/status-all/' + enc + '?' + q), fines = await get('/api/finance/fine-details-all/' + enc + '?' + q);
        var waivers = await get('/api/finance/late-fine-waivers/' + enc + '?' + q), pr = await get('/api/finance/voucher-print-status?' + q + '&monthKey=' + enc);
        if (!Array.isArray(fees) || !Array.isArray(fines) || !Array.isArray(waivers)) throw new Stop('unexpected server answer');
        fees.sort(function (a, b) { return Number(a.id) - Number(b.id); }).forEach(function (f) { add('STUDENT_FEE', f.monthKey || mk, f.regNo, f); });
        fines.sort(function (a, b) { return Number(a.id) - Number(b.id); }).forEach(function (f) { add('FINE', f.monthKey || mk, f.regNo, f); });
        waivers.forEach(function (w) { add('LATE_FINE_WAIVER', mk, w.regNo, { regNo: w.regNo, monthKey: mk, amount: w.amount, reason: w.reason, paymentStatus: 'Waived', payDate: w.payDate, payTime: w.payTime, lastTransactionDate: w.date }); });
        ((pr && pr.printedFamilies) || []).forEach(function (k) { add('VOUCHER_PRINT', mk, null, { monthKey: mk, guardianName: String(k), paymentStatus: 'Printed', lastTransactionDate: new Date().toISOString(), payloadJson: JSON.stringify({ familyKey: String(k), regNos: [], printCount: 1, printedAtMs: Date.now() }) }); });
      }
      var sal = await get('/api/finance/salary/records?' + q), drop = await get('/api/finance/dropout-staff?' + q), advs = await get('/api/finance/staff-advances?' + q);
      if (!Array.isArray(sal) || !Array.isArray(advs) || !drop || !Array.isArray(drop.records)) throw new Stop('unexpected server answer');
      sal.sort(function (a, b) { return Number(a.id) - Number(b.id); }).forEach(function (f) { add('SALARY', f.monthKey, f.staffId, f); });
      drop.records.slice().reverse().forEach(function (d) { add('DROPOUT_STAFF', null, d.staffId, d); });
      var bulk = [];
      advs.forEach(function (a) {
        var st = a && a.paymentStatus;
        if (a && a.applyDate != null && (st === 'Advance' || st === 'Settled')) add('ADVANCE', a.monthKey, a.staffId, a); else bulk.push(a);
      });
    } catch (e) { if (e instanceof Stop && /not available|unexpected/.test(e.message)) return; throw e; }   // e.g. finance locked on the plan: leave as is
    await window.__softschoolSerial(async function () {
      var seq1 = await db.query("SELECT v FROM meta WHERE k = 'fin_seq'");
      if ((seq1.length ? seq1[0].v : null) !== (seq0.length ? seq0[0].v : null)) return;                       // something changed on the phone meanwhile: try next time
      if (Number((await db.query('SELECT count(*) AS n FROM finance_ops'))[0].n) > 0) return;
      var sql = ["DELETE FROM finance WHERE record_type IN ('SALARY','ADVANCE','DROPOUT_STAFF')",
                 "DELETE FROM finance WHERE record_type IN ('STUDENT_FEE','FINE','LATE_FINE_WAIVER','VOUCHER_PRINT') AND month_key IN (" + months.map(function (m) { return lit(m); }).join(',') + ')'];
      var now = Date.now();
      rows.forEach(function (r) { sql.push('INSERT INTO finance (record_type, month_key, reg_no, json, updated_at) VALUES (' + [lit(r[0]), lit(r[1]), lit(r[2]), lit(r[3])].join(',') + ',' + now + ')'); });
      sql.push("INSERT OR REPLACE INTO meta (k, v) VALUES ('fin:staff-advances', " + lit(JSON.stringify(bulk)) + ')');
      await runSql(db, sql);
    });
  }

  async function pullExams(db, sc, inside) {
    if (Number((await db.query('SELECT count(*) AS n FROM finance_ops'))[0].n) > 0) return;     // unsent exam changes win
    var seq0 = await db.query("SELECT v FROM meta WHERE k = 'fin_seq'");
    var res = check(await post('/api/exams/bootstrap?schoolId=' + encodeURIComponent(sc.schoolId), 'GET'));
    if (!res.ok) return;
    var b = await res.json();
    if (!b || !Array.isArray(b.papers) || !Array.isArray(b.datesheet)) return;                  // not the answer we expect: leave the phone's exam data as it is
    var now = Date.now(), sql = ['DELETE FROM exams'];
    function ins(kind, id, obj, at) { sql.push('INSERT INTO exams (kind, item_id, json, created_at, updated_at) VALUES (' + [lit(kind), lit(id), lit(JSON.stringify(obj)), now, Number(at) || now].join(',') + ')'); }
    b.papers.slice().reverse().forEach(function (p) {       // oldest first, so the newest ends up on top
      ins('paper', String(p.id), { title: p.title, term: p.term, className: p.cls, section: p.section || '', subject: p.subj, date: p.date || '', minutes: p.mins, instructions: p.instr || '', total: p.total, sectionsJson: JSON.stringify(p.sections || []), itemsJson: Array.isArray(p.items) ? JSON.stringify(p.items) : undefined }, p.at);
    });
    Object.keys(b.results || {}).forEach(function (k) { var r = b.results[k]; ins('result', String(k), { total: r.total, status: r.status, marks: r.marks || {} }, r.at); });
    b.datesheet.forEach(function (d) { ins('sheet', String(d.id), { term: d.term, className: d.cls, subject: d.subject, date: d.date, start: d.start, end: d.end, room: d.room || '' }, now); });
    if (b.grading && b.grading.scale) ins('grading', 'x', { scaleJson: JSON.stringify(b.grading.scale) }, now);
    sql.push("INSERT OR REPLACE INTO meta (k, v) VALUES ('exam_pulled', '1')");
    var swap = async function () {
      var seq1 = await db.query("SELECT v FROM meta WHERE k = 'fin_seq'");
      if ((seq1.length ? seq1[0].v : null) !== (seq0.length ? seq0[0].v : null)) return;
      if (Number((await db.query('SELECT count(*) AS n FROM finance_ops'))[0].n) > 0) return;
      await runSql(db, sql);
    };
    if (inside) await swap(); else await window.__softschoolSerial(swap);
  }

  async function prefetchPhotos(db, sc) {             // keep a copy of the server's student photos on the phone (a few per round)
    var rows = await db.query("SELECT reg_no, json FROM students WHERE json LIKE '%\"hasPhoto\":true%' LIMIT 400"), got = 0;
    for (var i = 0; i < rows.length && got < 12; i++) {
      var o = parse(rows[i].json); if (o.photo) continue;
      var key = 'reg:' + rows[i].reg_no + ':photo:' + (o.photoPath || '');
      if ((await db.query('SELECT 1 FROM local_files WHERE path = ?', [key])).length) continue;
      var r = await post('/api/students/' + encodeURIComponent(rows[i].reg_no) + '/photo?schoolId=' + encodeURIComponent(sc.schoolId), 'GET');
      check(r); got++;
      if (!r.ok) { await db.run('INSERT OR REPLACE INTO local_files (path, data, created_at) VALUES (?, ?, ?)', [key, 'data:,', Date.now()]); continue; }
      var uri = await fileToDataUri(await r.blob());
      await db.run("DELETE FROM local_files WHERE path LIKE ?", ['reg:' + rows[i].reg_no + ':photo:%']);
      await db.run('INSERT OR REPLACE INTO local_files (path, data, created_at) VALUES (?, ?, ?)', [key, uri, Date.now()]);
    }
  }

  async function doPull(db, sc, force) {
    var m = await db.query("SELECT v FROM meta WHERE k = 'last_pull'");
    var last = m.length ? Number(m[0].v) : 0;
    var sigBefore = await dataSig(db);
    var fullDone = await db.query("SELECT v FROM meta WHERE k = 'students_full_pull'");     // older app versions saved only part of each student: refresh once
    if (!fullDone.length) force = true;
    if (!force && Date.now() - last < PULL_EVERY && Date.now() >= last) return;
    await pullSettings(db, sc); await pullSessions(db, sc); await pullBlobs(db, sc); await pullStudents(db, sc); await db.run("INSERT OR REPLACE INTO meta (k, v) VALUES ('students_full_pull', '1')"); await pullStaff(db, sc); await pullAttendance(db, sc); var lf = await db.query("SELECT v FROM meta WHERE k = 'last_full_finance'"), fullFin = force === true || !lf.length || Date.now() - Number(lf[0].v) > FULL_FINANCE_EVERY || Date.now() < Number(lf[0].v);
    await pullFinance(db, sc, fullFin); if (fullFin) await db.run("INSERT OR REPLACE INTO meta (k, v) VALUES ('last_full_finance', ?)", [String(Date.now())]);
    await pullExams(db, sc);
    try { await prefetchPhotos(db, sc); } catch (e) { if (e instanceof Stop) throw e; }
    try { if (window.__softschoolLoadImgCache) window.__softschoolLoadImgCache(); } catch (e) { /* ignore */ }
    await db.run("INSERT OR REPLACE INTO meta (k, v) VALUES ('last_pull', ?)", [String(Date.now())]);
    try {                                              // did the server bring anything new? tell the open page
      var sigAfter = await dataSig(db);
      if (sigBefore !== sigAfter) window.dispatchEvent(new window.CustomEvent('softschool:data-changed', { detail: { source: 'sync' } }));
    } catch (e) { /* ignore */ }
  }

  async function dataSig(db) {                         // cheap fingerprint of everything a page can show
    var qs = ["SELECT COUNT(*) c, COALESCE(SUM(LENGTH(json)),0) l FROM students", "SELECT COUNT(*) c, COALESCE(SUM(LENGTH(json)),0) l FROM staff",
      "SELECT COUNT(*) c, COALESCE(SUM(LENGTH(json)),0) l FROM finance", "SELECT COUNT(*) c, COALESCE(SUM(LENGTH(json)),0) l FROM exams",
      "SELECT COUNT(*) c, COALESCE(SUM(LENGTH(COALESCE(check_in,''))+LENGTH(COALESCE(check_out,''))),0) l FROM attendance",
      "SELECT COUNT(*) c, COALESCE(SUM(current_session*7+LENGTH(start_month)),0) l FROM sessions",
      "SELECT COUNT(*) c, COALESCE(SUM(LENGTH(v)),0) l FROM meta WHERE k LIKE 'setting%' OR k LIKE 'blob%'"];
    var out = [];
    for (var i = 0; i < qs.length; i++) { try { var r = await db.query(qs[i]); out.push(r[0].c + ':' + r[0].l); } catch (e) { out.push('x'); } }
    return out.join('|');
  }

  async function run(force) {
    if (!active() || !online()) return;
    if (state.running) { state.again = true; return; }
    state.running = true; state.refused = 0; emit();
    try {
      var db = await window.SoftSchoolLocalDB.ready();
      var sc = school();
      await applyDone(db);
      state.pending = await count(db); emit();
      await doDeletes(db, sc);
      await doSettings(db, sc);
      await doSessions(db, sc);
      await doBlobs(db, sc);
      await doFiles(db, sc);
      await doRows(db, sc, 'students', '/api/students', 'student');
      await doRows(db, sc, 'staff', '/api/staff', 'staff');
      await doAttendance(db, sc);
      await doExamImages(db, sc);
      var sent = await doFinanceOps(db, sc);
      if (sent > 0) force = true;                       // money was just uploaded: bring the server's ledger back now
      if (!state.refused && !state.lastError) { /* nothing blocked the upload */ }
      await doPull(db, sc, force === true);
      state.lastSync = Date.now();
      if (!state.refused) state.lastError = null;
    } catch (e) {
      state.lastError = e instanceof Stop ? e.message : ((e && e.message) || 'network error');   // retry later
    }
    try { state.pending = await count(await window.SoftSchoolLocalDB.ready()); } catch (e) { /* ignore */ }
    state.running = false; emit(); exportOutbox();
    if (state.again) { state.again = false; poke(); }
  }

  function poke() {                                   // "something was saved": upload in a few seconds
    if (!active()) return;
    setTimeout(exportOutbox, 300);
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(function () { state.timer = null; run(); }, 1000);
  }

  // ───────── Android background upload (Step 16) ─────────
  // The phone job (SyncWorker) cannot run this file, so after every save we hand it a ready-to-send list ("outbox").
  // It uploads while the app is closed and writes down what it finished; the next time the app runs, applyDone() marks those rows as uploaded.
  var BG = function () { return window.SoftSchoolBg || null; };
  async function applyDone(db) {
    var bg = BG(); if (!bg) return;
    var list = []; try { list = JSON.parse(bg.takeDone() || '[]'); } catch (e) { return; }
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      try {
        if (d.k === 'row') await db.run('UPDATE ' + (d.t === 'staff' ? 'staff' : 'students') + ' SET dirty = 0, server_id = ? WHERE id = ? AND updated_at = ?', [d.sid == null ? null : d.sid, d.id, d.u]);
        else if (d.k === 'att') { for (var j = 0; j < d.ids.length; j++) await db.run('UPDATE attendance SET dirty = 0 WHERE id = ? AND updated_at = ?', [d.ids[j][0], d.ids[j][1]]); }
        else if (d.k === 'del') await db.run('DELETE FROM pending_deletes WHERE id = ?', [d.id]);
        else if (d.k === 'op') await db.run('DELETE FROM finance_ops WHERE id = ?', [d.id]);
      } catch (e) { /* ignore one bad entry */ }
    }
  }
  var exporting = false;
  async function exportOutbox() {
    var bg = BG(); if (!bg || !active() || exporting) return Promise.resolve();
    exporting = true;
    try {
      var db = await window.SoftSchoolLocalDB.ready(), sc = school(), q = 'schoolId=' + encodeURIComponent(sc.schoolId), items = [];
      await applyDone(db);
      (await db.query('SELECT id, module, item_key FROM pending_deletes ORDER BY id')).forEach(function (r) {
        items.push({ ref: { k: 'del', id: r.id }, method: 'DELETE', url: (r.module === 'sessions' ? '/api/sessions/' : '/api/staff/') + encodeURIComponent(r.item_key) + '?' + q });
      });
      var tabs = [['students', '/api/students'], ['staff', '/api/staff']];
      for (var t = 0; t < tabs.length; t++) {
        (await db.query('SELECT id, json, updated_at FROM ' + tabs[t][0] + ' WHERE dirty = 1 ORDER BY id')).forEach(function (r) {
          var rec = parse(r.json); delete rec.id; delete rec.hasPhoto; rec.schoolId = sc.schoolId;
          if (tabs[t][0] === 'students' && (isLocalPath(rec.photo) || isLocalPath(rec.certData))) return;   // the app uploads its picture first
          if (tabs[t][0] === 'staff') { delete rec.password; delete rec.passwordHash; }
          items.push({ ref: { k: 'row', t: tabs[t][0], id: r.id, u: r.updated_at }, method: 'POST', url: tabs[t][1], body: rec });
        });
      }
      var att = await db.query('SELECT id, json, updated_at FROM attendance WHERE dirty = 1 ORDER BY id');
      for (var a = 0; a < att.length; a += ATT_BATCH) {
        var part = att.slice(a, a + ATT_BATCH);
        items.push({ ref: { k: 'att', ids: part.map(function (r) { return [r.id, r.updated_at]; }) }, method: 'POST', url: '/api/attendance/save',
          body: part.map(function (r) { var o = parse(r.json); delete o.id; o.schoolId = sc.schoolId; return o; }) });
      }
      var ops = await db.query('SELECT id, method, url, body FROM finance_ops ORDER BY id');
      for (var o = 0; o < ops.length; o++) {
        if (/^\/api\/finance\/pay-fine\/\d+$/.test(ops[o].url)) break;
        if (ops[o].body && /exam-images\//.test(ops[o].body) && (await localExamImgs(db)).some(function (x) { return ops[o].body.indexOf(x) >= 0; })) break;   // picture still on the phone: the app uploads it first           // needs a look-up on the server: leave it (and what follows) for the app
        var b = ops[o].body ? parse(ops[o].body) : undefined;
        if (b && typeof b === 'object' && !Array.isArray(b) && ops[o].url.indexOf('/api/finance') === 0) b.schoolId = sc.schoolId;
        items.push({ ref: { k: 'op', id: ops[o].id }, method: ops[o].method, url: ops[o].url, body: b });
      }
      bg.saveOutbox(JSON.stringify({ base: window.SOFTSCHOOL_API_BASE || 'https://thesoftschool.com', token: sessToken(), items: items }));
    } catch (e) { /* the app's own sync still works */ }
    exporting = false;
  }

  function askBattery() {                                // first time in hybrid mode: ask the user to allow background upload
    try {
      var bg = BG(); if (!bg || !active() || localStorage.getItem('softschool_bg_asked')) return;
      if (bg.ignoringBattery()) { localStorage.setItem('softschool_bg_asked', '1'); return; }
      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;top:0;background:rgba(0,0,0,.5);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px';
      box.innerHTML = '<div style="background:#fff;color:#222;border-radius:14px;padding:20px;max-width:340px;font:15px sans-serif;line-height:1.4"><b>Allow background upload</b><p>To copy your changes to the server even when the app is closed, turn off battery optimization for Soft School.</p><button id="ssb-go" style="width:100%;padding:12px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:15px">Open battery settings</button><button id="ssb-no" style="width:100%;padding:10px;border:0;background:none;color:#555;margin-top:6px">Later</button></div>';
      document.body.appendChild(box);
      var close = function () { try { localStorage.setItem('softschool_bg_asked', '1'); } catch (e) { /* ignore */ } box.remove(); };
      box.querySelector('#ssb-go').onclick = function () { try { bg.openBatterySettings(); } catch (e) { /* ignore */ } close(); };
      box.querySelector('#ssb-no').onclick = close;
    } catch (e) { /* ignore */ }
  }
  setInterval(function () { try { if (BG() && active() && !document.hidden) BG().heartbeat(); } catch (e) { /* ignore */ } }, 20000);
  setTimeout(function () { try { if (BG() && active()) BG().heartbeat(); } catch (e) { /* ignore */ } askBattery(); }, 6000);
  function leaving() { exportOutbox().then(function () { try { BG() && BG().appClosed(); } catch (e) { /* ignore */ } }); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) leaving(); });
  document.addEventListener('pause', leaving);

  window.SoftSchoolSync = { pullExamsInside: function (db, sc) { return pullExams(db, sc, true); }, run: run, pullNow: function () { return run(true); }, poke: poke, status: status };

  try {
    window.addEventListener('online', function () { run(); });
    document.addEventListener('visibilitychange', function () { run(); });      // coming back OR leaving the app: upload right away
    document.addEventListener('pause', function () { run(); });
    setInterval(function () { if (!document.hidden) run(); }, 20000);
  } catch (e) { /* ignore */ }
  setTimeout(function () { run(); }, 4000);           // shortly after the page opens
})();


/*!
 * BACKUP AND RESTORE (Step 7) - protects a school's data that lives ONLY on the phone.
 *
 * "Backup" saves the school's whole phone database into one file (.softschool-backup.json) that the user shares
 * to Google Drive / WhatsApp / email / files. "Restore" reads such a file back (same school only) and replaces
 * the phone's data with it. Nothing is ever sent to the SoftSchool server by this.
 * A small round button at the bottom-right opens the panel (offline and hybrid schools only; online schools
 * never see it). The button turns amber when an offline-only school has had no backup for 7 days.
 * Saving the file uses the Capacitor plugins @capacitor/filesystem and @capacitor/share; without them it
 * falls back to a normal browser download.
 */
(function () {
  'use strict';
  if (window.SoftSchoolBackup) return;
  var SESSION_KEY = 'softschool_session';
  var TABLES = ['students', 'staff', 'attendance', 'meta', 'pending_deletes', 'sessions', 'finance', 'finance_ops', 'exams', 'local_files'];
  var REMIND_DAYS = 7;

  function school() { try { var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return s && s.school && s.school.schoolId ? s.school : null; } catch (e) { return null; } }
  function mode() { return window.SoftSchoolMode && window.SoftSchoolMode.get ? window.SoftSchoolMode.get() : null; }
  function active() { var m = mode(); return !!school() && (m === 'offline' || m === 'hybrid') && !!window.SoftSchoolLocalDB; }
  function lastKey() { return 'softschool_last_backup_' + school().schoolId; }
  function lastBackup() { try { return Number(localStorage.getItem(lastKey())) || 0; } catch (e) { return 0; } }
  function lit(v) {
    if (v == null) return 'NULL';
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'NULL';
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  // ───────────── the data ─────────────
  async function exportData() {
    if (!active()) throw new Error('Backup is only for offline and hybrid schools.');
    var db = await window.SoftSchoolLocalDB.ready(), tables = {};
    for (var i = 0; i < TABLES.length; i++) tables[TABLES[i]] = await db.query('SELECT * FROM ' + TABLES[i]);
    tables.meta = tables.meta.filter(function (r) { return r.k !== 'schema_version'; });
    return { app: 'softschool-backup', format: 1, schoolId: school().schoolId, createdAt: new Date().toISOString(),
             schemaVersion: window.SoftSchoolLocalDB.migrations(), counts: { students: tables.students.length, staff: tables.staff.length, attendance: tables.attendance.length }, tables: tables };
  }

  function validate(b) {
    if (!b || typeof b !== 'object' || b.app !== 'softschool-backup' || !b.tables || typeof b.tables !== 'object') throw new Error('This is not a SoftSchool backup file.');
    if (b.schoolId !== school().schoolId) throw new Error('This backup belongs to a different school (' + b.schoolId + ').');
    if (Number(b.schemaVersion) > window.SoftSchoolLocalDB.migrations()) throw new Error('This backup was made by a newer version of the app. Update the app first.');
    TABLES.forEach(function (t) {
      var rows = b.tables[t];
      if (rows === undefined) return;
      if (!Array.isArray(rows)) throw new Error('The backup file is damaged (' + t + ').');
      rows.forEach(function (r) {
        if (!r || typeof r !== 'object') throw new Error('The backup file is damaged (' + t + ').');
        Object.keys(r).forEach(function (c) { if (!/^[a-z_]+$/.test(c)) throw new Error('The backup file is damaged (' + t + ').'); });
      });
    });
  }

  function importData(b) {
    return window.__softschoolSerial(async function () {
      if (!active()) throw new Error('Restore is only for offline and hybrid schools.');
      validate(b);
      var db = await window.SoftSchoolLocalDB.ready(), sql = [];
      TABLES.forEach(function (t) {
        var rows = b.tables[t];
        if (rows === undefined) return;                                 // an older backup without this table: leave it alone
        if (t === 'meta') { sql.push("DELETE FROM meta WHERE k <> 'schema_version'"); rows = rows.filter(function (r) { return r.k !== 'schema_version'; }); }
        else sql.push('DELETE FROM ' + t);
        rows.forEach(function (r) {
          var cols = Object.keys(r);
          if (!cols.length) return;
          sql.push('INSERT INTO ' + t + ' (' + cols.join(',') + ') VALUES (' + cols.map(function (c) { return lit(r[c]); }).join(',') + ')');
        });
      });
      // the whole restore is ONE transaction: if anything is wrong, the phone keeps its current data
      try {
        if (db.batch) await db.batch(sql); else await db.exec(sql.join(';\n'));
      } catch (e) {
        throw new Error('Restore failed, nothing was changed: ' + ((e && e.message) || 'database error'));
      }
      await db.run("DELETE FROM meta WHERE k = 'last_pull'");           // hybrid: download fresh server data next time
      return { students: (b.tables.students || []).length, staff: (b.tables.staff || []).length, attendance: (b.tables.attendance || []).length };
    });
  }

  // ───────────── saving / opening the file ─────────────
  function fileName() {
    var d = new Date(), p = function (n) { return ('0' + n).slice(-2); };
    return school().schoolId + '-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.softschool-backup.json';
  }
  async function saveFile() {
    var data = await exportData(), text = JSON.stringify(data), name = fileName();
    var P = window.Capacitor && window.Capacitor.Plugins, done = false;
    if (P && P.Filesystem && P.Share) {
      try {
        var w = await P.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
        await P.Share.share({ title: 'SoftSchool backup', text: 'SoftSchool backup ' + name, url: w.uri, dialogTitle: 'Save the backup file somewhere safe' });
        done = true;
      } catch (e) { if (e && /cancel/i.test(String(e.message || e))) return { cancelled: true }; }
    }
    if (!done) {
      var a = document.createElement('a');
      a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(text); a.download = name;
      document.body.appendChild(a); if (a.click) a.click();
    }
    try { localStorage.setItem(lastKey(), String(Date.now())); } catch (e) { /* ignore */ }
    refreshButton();
    return { name: name, counts: data.counts };
  }
  function readPickedFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { try { resolve(JSON.parse(String(fr.result))); } catch (e) { reject(new Error('This file is not a SoftSchool backup.')); } };
      fr.onerror = function () { reject(new Error('The file could not be read.')); };
      fr.readAsText(file);
    });
  }

  // ───────────── the small button + panel ─────────────
  var btn = null;
  function needsReminder() { return mode() === 'offline' && Date.now() - lastBackup() > REMIND_DAYS * 86400000; }
  function refreshButton() {
    try {
      if (!btn) return;
      btn.style.display = active() ? 'block' : 'none';
      btn.style.background = needsReminder() ? '#d97706' : '#0F423D';
      btn.title = needsReminder() ? 'No backup for 7 days - tap to back up' : 'Backup and restore';
    } catch (e) { /* optional */ }
  }
  function el(tag, css, txt) { var e = document.createElement(tag); e.style.cssText = css || ''; if (txt != null) e.textContent = txt; return e; }
  function openPanel() {
    var wrap = el('div', 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center');
    var box = el('div', 'background:#fff;color:#222;border-radius:12px;padding:18px;width:min(92vw,360px);font:14px sans-serif');
    var msg = el('div', 'margin:10px 0;min-height:18px;font-size:13px');
    var lb = lastBackup();
    box.appendChild(el('div', 'font-weight:700;font-size:16px', 'Backup and restore'));
    box.appendChild(el('div', 'margin-top:8px;color:#555', lb ? 'Last backup: ' + new Date(lb).toLocaleString() : 'No backup made yet.'));
    box.appendChild(el('div', 'margin-top:6px;color:#555;font-size:12px', mode() === 'offline' ? 'Your data lives only on this phone. Save a backup file to Google Drive or send it to yourself.' : 'Your data is also copied to the online database; a backup is an extra safety copy.'));
    box.appendChild(msg);
    var b1 = el('button', 'width:100%;padding:10px;margin:4px 0;border:0;border-radius:8px;background:#0F423D;color:#fff;font-size:14px', 'Save backup file');
    var b2 = el('button', 'width:100%;padding:10px;margin:4px 0;border:1px solid #0F423D;border-radius:8px;background:#fff;color:#0F423D;font-size:14px', 'Restore from backup file');
    var b3 = el('button', 'width:100%;padding:8px;margin:4px 0;border:0;background:none;color:#666;font-size:13px', 'Close');
    var input = el('input', 'display:none'); input.type = 'file'; input.accept = '.json,application/json';
    b1.onclick = async function () { msg.textContent = 'Saving…'; try { var r = await saveFile(); msg.textContent = r.cancelled ? 'Cancelled.' : 'Backup ready: ' + r.counts.students + ' students, ' + r.counts.staff + ' staff, ' + r.counts.attendance + ' attendance records.'; } catch (e) { msg.textContent = e.message; } };
    b2.onclick = function () { input.click(); };
    input.onchange = async function () {
      var f = input.files && input.files[0]; if (!f) return;
      try {
        var b = await readPickedFile(f); validate(b);
        if (!window.confirm('Replace ALL data on this phone with the backup from ' + new Date(b.createdAt).toLocaleString() + ' (' + b.counts.students + ' students, ' + b.counts.staff + ' staff)? This cannot be undone.')) return;
        msg.textContent = 'Restoring…'; var r = await importData(b);
        msg.textContent = 'Restored ' + r.students + ' students, ' + r.staff + ' staff, ' + r.attendance + ' attendance records.';
        setTimeout(function () { window.location.reload(); }, 1500);
      } catch (e) { msg.textContent = e.message; }
    };
    b3.onclick = function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); else wrap.style.display = 'none'; };
    [b1, b2, input, b3].forEach(function (x) { box.appendChild(x); });
    wrap.appendChild(box); document.body.appendChild(wrap);
  }
  function mount() {
    try {
      btn = el('div', 'position:fixed;right:10px;bottom:70px;z-index:99997;width:38px;height:38px;border-radius:19px;color:#fff;text-align:center;line-height:38px;font:18px sans-serif;opacity:.85;display:none', '⛁');
      btn.onclick = openPanel;
      document.body.appendChild(btn);
      refreshButton();
      setTimeout(refreshButton, 3000);
      window.addEventListener('softschool:mode-changed', refreshButton);
    } catch (e) { /* the button is optional */ }
  }

  window.SoftSchoolBackup = { export: exportData, import: importData, validate: validate, save: saveFile, needsReminder: needsReminder, lastBackup: lastBackup };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
