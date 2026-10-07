/* ============================================================
   SOFT SCHOOL — TEACHER AUTH
   Loaded by index.html (login modal) and teacher-portal.html.

   BACKEND CONTRACT (one endpoint is needed):
   POST /api/school/teacher-login   { staffId, password }
     200 -> { token, schoolId, staff: { ...Staff row... }, passwordChanged,
              school: { name, logo, address, phone, prefix } }   <- school is what the portal shows as the real
                                                                    school name/logo (else it falls back to /api/settings)
     Teachers sign in with the DEFAULT password the admin sets in Settings until
     they change their own (allowed once): POST /api/staff/change-password.
            (token = school-scoped session, same kind /api/school/login issues)
     401 -> wrong ID or password (same reply for both)   429 -> locked out
     403 -> school blocked/expired   (error text is in { error })
   ============================================================ */
(function () {
  "use strict";
  const API = "https://167-86-120-247.sslip.io/api/school";
  const KEY = "softschool_teacher";
  let pending = null;

  async function authenticateTeacher(id, password) {
    try {
      const res = await fetch(API + "/teacher-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: String(id).trim(), password: password })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err && err.error;
        if (res.status === 404) return { ok: false, reason: "not_found", message };
        if (res.status === 401) return { ok: false, reason: "bad_password", message };
        if (res.status === 429 || res.status === 403) return { ok: false, reason: "blocked", message };
        return { ok: false, reason: "error", message };
      }
      const d = await res.json();
      if (!d || !d.token || !d.staff) return { ok: false, reason: "error" };
      pending = d;
      return { ok: true, teacher: { id: d.staff.staffId || String(id).trim(), name: d.staff.name || "Teacher" } };
    } catch (e) {
      return { ok: false, reason: "error" };
    }
  }

  function setSession() {
    if (!pending) return;
    localStorage.setItem(KEY, JSON.stringify({
      token: pending.token, schoolId: pending.schoolId, staff: pending.staff,
      school: pending.school ? { name: pending.school.name, logo: pending.school.logo, prefix: pending.school.prefix, address: pending.school.address, phone: pending.school.phone } : null,
      passwordChanged: !!pending.passwordChanged, at: Date.now()
    }));
  }
  function getSession() {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; }
  }
  function updateSession(patch) {
    const s = getSession();
    if (s) localStorage.setItem(KEY, JSON.stringify(Object.assign(s, patch)));
  }
  function clearSession() { localStorage.removeItem(KEY); }

  window.SoftSchoolTeacher = { authenticateTeacher, setSession, getSession, updateSession, clearSession };
})();
