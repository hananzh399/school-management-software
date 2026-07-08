/**
 * ============================================================
 * SOFT SCHOOL — TEACHER AUTH LAYER
 * ------------------------------------------------------------
 * Independent from access-control.js (which governs the school
 * admin / super-admin login). This layer authenticates TEACHERS
 * against the real staff records already created in
 * Manage Staff (stored in the 'eduflow-db' key, db.staff.Teaching).
 *
 * DEMO CREDENTIALS:
 * Manage Staff does not currently have username/password fields,
 * so until that's added, every teacher record gets a default
 * login derived from their Teacher ID:
 *   username: their Teacher ID (e.g. "TCH-9021"), case-insensitive
 *   password: "teacher123"
 * If a teacher record already has explicit `username`/`password`
 * fields (for when that gets added to Manage Staff later), those
 * are used instead automatically.
 * ============================================================
 */

(function () {
  "use strict";

  const SESSION_KEY = "softschool_teacher_session";
  const DEFAULT_PASSWORD = "teacher123";

  function getGlobalData() {
    try { return JSON.parse(localStorage.getItem("eduflow-db")) || {}; }
    catch (e) { return {}; }
  }

  function getTeachers() {
    const db = getGlobalData();
    return (db.staff && Array.isArray(db.staff.Teaching)) ? db.staff.Teaching : [];
  }

  function getTeacherById(id) {
    return getTeachers().find(t => t.id === id) || null;
  }

  function authenticateTeacher(username, password) {
    const uname = (username || "").trim().toLowerCase();
    const teachers = getTeachers();
    if (!uname) return { ok: false, reason: "empty" };

    const teacher = teachers.find(t => {
      const expectedUser = (t.username || t.id || "").trim().toLowerCase();
      return expectedUser === uname;
    });

    if (!teacher) return { ok: false, reason: "not_found" };

    const expectedPass = teacher.password || DEFAULT_PASSWORD;
    if (password !== expectedPass) return { ok: false, reason: "bad_password" };

    return { ok: true, teacher: teacher };
  }

  function setSession(teacherId) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ teacherId: teacherId, at: Date.now() }));
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }
    catch (e) { return null; }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function getCurrentTeacher() {
    const session = getSession();
    if (!session) return null;
    return getTeacherById(session.teacherId);
  }

  /* Persist edits (e.g. profile contact info) back into the same
     record Manage Staff reads, so admin + teacher stay in sync. */
  function updateTeacher(id, patch) {
    const db = getGlobalData();
    if (!db.staff || !Array.isArray(db.staff.Teaching)) return null;
    const idx = db.staff.Teaching.findIndex(t => t.id === id);
    if (idx === -1) return null;
    db.staff.Teaching[idx] = Object.assign({}, db.staff.Teaching[idx], patch);
    localStorage.setItem("eduflow-db", JSON.stringify(db));
    return db.staff.Teaching[idx];
  }

  window.SoftSchoolTeacher = {
    DEFAULT_PASSWORD,
    getTeachers, getTeacherById, authenticateTeacher,
    setSession, getSession, clearSession, getCurrentTeacher, updateTeacher
  };
})();
