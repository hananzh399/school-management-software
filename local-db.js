/*!
 * local-db.js - the school's database ON THE PHONE (Step 3 of the offline / hybrid app)
 *
 * Only used by OFFLINE and HYBRID schools (SoftSchoolMode.usesLocalDb()). For an ONLINE school this file does
 * nothing at all: it never opens a database and never touches the SQLite plugin.
 *
 * Each school gets its OWN database file, so two schools on the same phone can never see each other's data.
 * Needs the Capacitor plugin @capacitor-community/sqlite (see the Step 3 instructions).
 *
 *   SoftSchoolLocalDB.available()      -> true when this school should use the local database
 *   SoftSchoolLocalDB.ready()          -> Promise of the open database (opened once, then reused)
 *   SoftSchoolLocalDB.query(sql, vals) -> Promise of an array of row objects
 *   SoftSchoolLocalDB.run(sql, vals)   -> Promise of { changes, lastId }
 *   SoftSchoolLocalDB.dbName()         -> the database name for the logged-in school
 *
 * SCHEMA: versioned migrations (MIGRATIONS below). To change the schema later, ADD a new entry with a higher
 * version - never edit an old one - and every phone upgrades itself the next time the app opens.
 */
(function () {
  'use strict';
  if (window.SoftSchoolLocalDB) return;

  var SESSION_KEY = 'softschool_session';
  var OK_FLAG = 'softschool_localdb_ok';

  // ───────────── schema (add new versions at the END only) ─────────────
  var MIGRATIONS = [
    {
      version: 1,
      statements: [
        // One row per student. The whole student record is kept as JSON (same shape the server sends), plus a
        // few real columns for searching. The last three columns are for hybrid sync (Step 5):
        //   server_id = the student's id on the server, dirty = 1 means "not uploaded yet".
        'CREATE TABLE IF NOT EXISTS students (' +
          'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
          'reg_no TEXT NOT NULL UNIQUE,' +
          'full_name TEXT,' +
          'student_class TEXT,' +
          'section TEXT,' +
          'status TEXT,' +
          'json TEXT NOT NULL,' +
          'server_id INTEGER,' +
          'dirty INTEGER NOT NULL DEFAULT 1,' +
          'updated_at INTEGER NOT NULL)',
        'CREATE INDEX IF NOT EXISTS idx_students_class ON students(student_class, section)',
        'CREATE INDEX IF NOT EXISTS idx_students_dirty ON students(dirty)'
      ]
    },
    {
      version: 2,
      statements: [
        // Attendance: one row per person per day (same rule as the server). member_id ignores upper/lower case,
        // like the server's MySQL. check_in / check_out are real columns so the dashboard count is plain SQL.
        'CREATE TABLE IF NOT EXISTS attendance (' +
          'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
          'member_id TEXT NOT NULL COLLATE NOCASE,' +
          'att_date TEXT NOT NULL,' +
          'member_type TEXT,' +
          'class_name TEXT,' +
          'section TEXT,' +
          'status TEXT,' +
          'check_in TEXT,' +
          'check_out TEXT,' +
          'json TEXT NOT NULL,' +
          'server_id INTEGER,' +
          'dirty INTEGER NOT NULL DEFAULT 1,' +
          'updated_at INTEGER NOT NULL,' +
          'UNIQUE (member_id, att_date))',
        'CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(att_date, member_type)',
        'CREATE INDEX IF NOT EXISTS idx_att_dirty ON attendance(dirty)'
      ]
    },
    {
      version: 3,
      statements: [
        // Staff: one row per staff member. staff_id ignores upper/lower case like the server's MySQL.
        // The staff member's password is NOT stored on the phone (teacher sign-in is done by the server).
        'CREATE TABLE IF NOT EXISTS staff (' +
          'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
          'staff_id TEXT NOT NULL UNIQUE COLLATE NOCASE,' +
          'type TEXT,' +
          'name TEXT,' +
          'archived INTEGER NOT NULL DEFAULT 0,' +
          'json TEXT NOT NULL,' +
          'server_id INTEGER,' +
          'dirty INTEGER NOT NULL DEFAULT 1,' +
          'updated_at INTEGER NOT NULL)',
        'CREATE INDEX IF NOT EXISTS idx_staff_type ON staff(type)',
        'CREATE INDEX IF NOT EXISTS idx_staff_dirty ON staff(dirty)',
        // Small key/value settings the phone needs (e.g. the salary-fine rule for absent staff).
        "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)"
      ]
    },
    {
      version: 4,
      statements: [
        // Hybrid upload (Step 5): things deleted on the phone that still have to be deleted on the server.
        'CREATE TABLE IF NOT EXISTS pending_deletes (' +
          'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
          'module TEXT NOT NULL,' +
          'item_key TEXT NOT NULL,' +
          'created_at INTEGER NOT NULL)'
      ]
    },
    {
      version: 5,
      statements: [
        // Academic sessions (Sessions page; Fees & Finance follows the "current" one)
        'CREATE TABLE IF NOT EXISTS sessions (' +
          'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
          'start_month TEXT NOT NULL,' +
          'end_month TEXT NOT NULL,' +
          'first_session INTEGER NOT NULL DEFAULT 0,' +
          'current_session INTEGER NOT NULL DEFAULT 0,' +
          'server_id INTEGER,' +
          'dirty INTEGER NOT NULL DEFAULT 1,' +
          'updated_at INTEGER NOT NULL,' +
          'UNIQUE(start_month, end_month))'
      ]
    },
    {
      version: 6,
      statements: [
        // Money ledger (Fees & Finance): student fee rows, fines, late-fine waivers, voucher-print marks (and later salary rows).
        // Same shape as the server's "finance" table: the full record is kept as JSON, a few columns are for searching.
        'CREATE TABLE IF NOT EXISTS finance (' +
          'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
          'record_type TEXT NOT NULL,' +
          'month_key TEXT,' +
          'reg_no TEXT,' +
          'json TEXT NOT NULL,' +
          'updated_at INTEGER NOT NULL)',
        'CREATE INDEX IF NOT EXISTS idx_finance_type_month ON finance(record_type, month_key)',
        'CREATE INDEX IF NOT EXISTS idx_finance_reg ON finance(reg_no)'
      ]
    },
    {
      version: 7,
      statements: [
        // Hybrid schools: every money action done on the phone is queued here and replayed, in order, on the server.
        'CREATE TABLE IF NOT EXISTS finance_ops (' +
          'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
          'method TEXT NOT NULL,' +
          'url TEXT NOT NULL,' +
          'body TEXT,' +
          'created_at INTEGER NOT NULL)'
      ]
    },
    {
      version: 8,
      statements: [
        // Examination: one row per paper / result / date-sheet line, plus the grading scale (kind = paper | result | sheet | grading).
        'CREATE TABLE IF NOT EXISTS exams (' +
          'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
          'kind TEXT NOT NULL,' +
          'item_id TEXT NOT NULL,' +
          'json TEXT NOT NULL,' +
          'created_at INTEGER NOT NULL,' +
          'updated_at INTEGER NOT NULL)',
        'CREATE INDEX IF NOT EXISTS idx_exams_kind_item ON exams(kind, item_id)'
      ]
    },
    {
      version: 9,
      statements: [
        // Student photos and B-Forms kept on the phone (path -> the picture as a data URI)
        'CREATE TABLE IF NOT EXISTS local_files (path TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL)'
      ]
    }
  ];

  // ───────────── who is logged in? ─────────────
  function session() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function school() { var s = session(); return s && s.school && s.school.schoolId ? s.school : null; }

  function available() {
    var M = window.SoftSchoolMode;
    return !!(M && typeof M.usesLocalDb === 'function' && M.usesLocalDb());
  }

  function dbName() {
    var sc = school();
    if (!sc) return null;
    return 'softschool_' + String(sc.schoolId).replace(/[^A-Za-z0-9_]/g, '_').toLowerCase();
  }

  // ───────────── the real SQLite plugin (Android) ─────────────
  function nativeDriver(name) {
    var C = window.Capacitor;
    var P = C && C.Plugins && C.Plugins.CapacitorSQLite;
    if (!P) return Promise.reject(new Error('The SQLite plugin is not installed in this app build.'));
    return Promise.resolve()
      .then(function () {
        return P.createConnection({ database: name, version: 1, encrypted: false, mode: 'no-encryption', readonly: false });
      })
      .catch(function () { /* the connection already exists: fine */ })
      .then(function () { return P.open({ database: name, readonly: false }); })
      .then(function () {
        return {
          exec: function (statements) {
            return P.execute({ database: name, statements: statements, transaction: true, readonly: false });
          },
          // many ready-made statements in ONE transaction (all or nothing); used by sync and restore
          batch: function (statements) {
            return P.executeSet({ database: name, set: statements.map(function (st) { return { statement: st, values: [] }; }), transaction: true, readonly: false });
          },
          run: function (sql, values) {
            return P.run({ database: name, statement: sql, values: values || [], transaction: true, readonly: false, returnMode: 'no' })
              .then(function (r) { return { changes: r && r.changes ? r.changes.changes : 0, lastId: r && r.changes ? r.changes.lastId : null }; });
          },
          query: function (sql, values) {
            return P.query({ database: name, statement: sql, values: values || [], readonly: false })
              .then(function (r) { return (r && r.values) || []; });
          }
        };
      });
  }

  // ───────────── open + migrate ─────────────
  function migrate(d) {
    return d.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)')
      .then(function () { return d.query("SELECT v FROM meta WHERE k = 'schema_version'"); })
      .then(function (rows) {
        var current = rows.length ? parseInt(rows[0].v, 10) || 0 : 0;
        var chain = Promise.resolve();
        MIGRATIONS.forEach(function (m) {
          if (m.version <= current) return;
          chain = chain
            .then(function () { return d.exec(m.statements.join(';\n') + ';'); })
            .then(function () {
              return d.run("INSERT INTO meta (k, v) VALUES ('schema_version', ?) " +
                           "ON CONFLICT(k) DO UPDATE SET v = excluded.v", [String(m.version)]);
            });
        });
        return chain;
      })
      .then(function () { return d; });
  }

  var opening = null, openedFor = null;

  function ready() {
    if (!available()) return Promise.reject(new Error('This school does not use the local database.'));
    var name = dbName();
    if (!name) return Promise.reject(new Error('No school is logged in.'));
    if (opening && openedFor === name) return opening;      // opened once, then reused
    openedFor = name;
    var factory = window.__softschoolSqlDriverFactory || nativeDriver;   // (the factory hook is for automated tests)
    opening = Promise.resolve()
      .then(function () { return factory(name); })
      .then(migrate)
      .then(function (d) { notify(true); return d; })
      .catch(function (err) { opening = null; notify(false, err); throw err; });
    return opening;
  }

  // ───────────── tiny status message (so you can SEE it work on a real phone) ─────────────
  function banner(text, ms, bad) {
    try {
      var el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);' +
        'z-index:2147483600;padding:10px 14px;border-radius:10px;color:#fff;font:14px/1.35 system-ui,sans-serif;' +
        'background:' + (bad ? '#b42318' : '#1E8F86') + ';box-shadow:0 6px 24px rgba(0,0,0,.35)';
      (document.body || document.documentElement).appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
    } catch (e) { /* never break the page */ }
  }

  var told = false;
  function notify(good, err) {
    if (told) return;
    told = true;
    try {
      if (!good) { banner('Offline database problem: ' + ((err && err.message) || 'unknown error'), 9000, true); return; }
      var key = OK_FLAG + ':' + dbName();
      if (!localStorage.getItem(key)) {          // tell the user only the FIRST time on this phone
        localStorage.setItem(key, '1');
        banner('Offline database is ready on this phone.', 4000, false);
      }
    } catch (e) { /* ignore */ }
  }

  // ───────────── public API ─────────────
  window.SoftSchoolLocalDB = {
    available: available,
    dbName: dbName,
    ready: ready,
    query: function (sql, values) { return ready().then(function (d) { return d.query(sql, values); }); },
    run: function (sql, values) { return ready().then(function (d) { return d.run(sql, values); }); },
    migrations: function () { return MIGRATIONS.length; }
  };

  // Offline / hybrid school: open the database in the background as soon as the page loads.
  function start() { if (available() && dbName()) ready().catch(function () { /* already reported by notify() */ }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
