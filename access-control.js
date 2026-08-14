/**
 * ============================================================
 * SOFT SCHOOL — ACCESS CONTROL / MULTI-SCHOOL LAYER
 * ------------------------------------------------------------
 * This file is the bridge between the Super Admin panel
 * (superadmin.html) and every school-facing page.
 *
 * It is responsible for:
 *   1. Storing/reading the "schools registry" (every school the
 *      super admin has added, their plan, their login, their
 *      feature locks, their status).
 *   2. Authenticating a school's username/password at login.
 *   3. On every protected page: checking the logged-in school
 *      is still active & not blocked, hiding/blocking any
 *      feature the super admin has locked for that school, and
 *      enforcing student-count limits.
 *
 * IMPORTANT — READ THIS:
 * This whole app (as built) has NO server/database — everything
 * lives in the browser's localStorage. That means this access
 * control system works perfectly for demos and for any single
 * device/browser. For real production use across many different
 * schools on many different computers, the `SCHOOLS_KEY` registry
 * below must live in a real database/API instead of localStorage,
 * otherwise each device only knows about schools that were added
 * from that same device/browser. Everything here is written so
 * swapping localStorage for real API calls later only means
 * editing the functions in the "STORAGE" section below.
 * ============================================================
 */

(function () {
  "use strict";

  /* ── STORAGE KEYS ─────────────────────────────────────────── */
  const SCHOOLS_KEY  = "softschool_schools";   // legacy local-only registry (see NOTE below)
  const SESSION_KEY   = "softschool_session";   // currently logged-in school

  /* Real backend for school accounts (registered via index.html, managed via
     superadmin.html). SCHOOLS_KEY above predates the backend and is now only
     kept as a harmless fallback — schools created through the super admin
     portal live in the database, not in localStorage, so this file talks to
     the same "/api/school" endpoints index.js uses instead of SCHOOLS_KEY. */
  const SCHOOL_API_BASE_URL = "https://softschool-production.up.railway.app/api/school";

  /* ── PLAN DEFINITIONS ─────────────────────────────────────── */
  const PLANS = {
    basic:   { id: "basic",   label: "Basic",   price: 3999, studentLimit: 200,  defaultLocks: ["biometric"] },
    pro:     { id: "pro",     label: "Pro",     price: 4999, studentLimit: 500,  defaultLocks: ["biometric"] },
    premium: { id: "premium", label: "Premium", price: 6999, studentLimit: 1000, defaultLocks: [] }
  };

  /* Every lockable feature in the software */
  const FEATURES = [
    { key: "students",   label: "Student Management", page: "manage-students.html" },
    { key: "staff",      label: "Staff Management",   page: "manage-staff.html" },
    { key: "attendance", label: "Attendance",         page: "attendance.html" },
    { key: "biometric",  label: "Biometric Attendance", page: null }, // sub-feature inside attendance.html
    { key: "finance",    label: "Fees & Finance",     page: "manage-finance.html" },
    { key: "settings",   label: "Admin Settings",     page: "settings.html" }
  ];

  /* Map a filename to the feature key that guards it */
  const PAGE_FEATURE = {
    "manage-students.html": "students",
    "manage-staff.html": "staff",
    "attendance.html": "attendance",
    "manage-finance.html": "finance",
    "settings.html": "settings"
  };

  /* ── STORAGE (swap these for API calls if you add a backend) ─ */
  function getSchools() {
    try { return JSON.parse(localStorage.getItem(SCHOOLS_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveSchools(list) {
    localStorage.setItem(SCHOOLS_KEY, JSON.stringify(list));
  }
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }
    catch (e) { return null; }
  }
  /* Accepts either:
       setSession(schoolIdString)   — legacy callers, kept for compatibility
       setSession(fullSchoolObject) — the real backend school record
                                       (what index.js passes after login)
     Storing the full object means every protected page (main.html etc.)
     already has the school's name/logo/status/locks the instant it loads,
     with no extra network round trip. */
  function setSession(schoolOrId) {
    if (schoolOrId && typeof schoolOrId === "object") {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        schoolId: schoolOrId.schoolId,
        school: schoolOrId,
        at: Date.now()
      }));
    } else {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ schoolId: schoolOrId, at: Date.now() }));
    }
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("softschool_api_token");
  }

  /* Re-checks the logged-in school's live status against the real backend
     (status/expiry/locks/limits can change after login — e.g. the super
     admin blocks the school or changes its plan). Non-blocking: pages use
     the cached session data to render immediately, and this just corrects
     it shortly after / logs the school out if it's no longer valid. */
  function revalidateSession(onInvalid) {
    const session = getSession();
    const username = session && session.school && session.school.username;
    if (!username) return;

    fetch(SCHOOL_API_BASE_URL + "/status?username=" + encodeURIComponent(username))
      .then(function (res) {
        if (res.status === 404) throw new Error("not_found");
        return res.json();
      })
      .then(function (school) {
        if (school.status === "blocked") throw new Error("blocked");
        // Keep the cached session fresh (locks/limits/plan may have changed).
        setSession(school);
      })
      .catch(function () {
        clearSession();
        if (typeof onInvalid === "function") onInvalid();
      });
  }

  function genSchoolId() {
    const schools = getSchools();
    let n = 1001 + schools.length;
    let id;
    do { id = "SCH-" + n; n++; } while (schools.some(s => s.id === id));
    return id;
  }

  function addSchool(data) {
    const schools = getSchools();
    const plan = PLANS[data.planId] || PLANS.basic;
    const rawPrefix = (data.prefix || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    const record = {
      id: genSchoolId(),
      name: data.name,
      logo: data.logo || "",
      username: (data.username || "").trim(),
      password: data.password || "",
      planId: plan.id,
      studentLimit: data.studentLimit || plan.studentLimit,
      status: "active",
      locks: Array.isArray(data.locks) ? data.locks.slice() : plan.defaultLocks.slice(),
      prefix: rawPrefix,
      createdAt: new Date().toISOString()
    };
    schools.push(record);
    saveSchools(schools);
    return record;
  }

  function updateSchool(id, patch) {
    const schools = getSchools();
    const idx = schools.findIndex(s => s.id === id);
    if (idx === -1) return null;
    schools[idx] = Object.assign({}, schools[idx], patch);
    saveSchools(schools);
    return schools[idx];
  }

  function deleteSchool(id) {
    const schools = getSchools().filter(s => s.id !== id);
    saveSchools(schools);
  }

  function getSchoolById(id) {
    return getSchools().find(s => s.id === id) || null;
  }

  function isFeatureLocked(school, featureKey) {
    if (!school) return true;
    if (school.status === "blocked") return true;
    // Backend (School.locks) stores this as a comma-separated string
    // ("biometric,finance"); older local records used an array. Normalize
    // to an array of exact keys either way, so e.g. "fin" doesn't
    // false-positive match inside "finance" via a raw string .indexOf().
    const locks = Array.isArray(school.locks)
      ? school.locks
      : String(school.locks || "").split(",").map(s => s.trim()).filter(Boolean);
    return locks.indexOf(featureKey) !== -1;
  }

  function authenticateSchool(username, password) {
    const schools = getSchools();
    const uname = (username || "").trim().toLowerCase();
    const school = schools.find(s => (s.username || "").trim().toLowerCase() === uname);
    if (!school) return { ok: false, reason: "not_found" };
    if (school.password !== password) return { ok: false, reason: "bad_password" };
    if (school.status === "blocked") return { ok: false, reason: "blocked", school: school };
    return { ok: true, school: school };
  }

  function getCurrentSchool() {
    const session = getSession();
    if (!session) return null;
    // Real backend-issued session (from index.html login) embeds the full
    // school record — use it directly instead of the legacy local registry,
    // which nothing writes to anymore now that schools live in the database.
    if (session.school) return session.school;
    return getSchoolById(session.schoolId);
  }

  function studentCount() {
    try { return (JSON.parse(localStorage.getItem("edu_students")) || []).length; }
    catch (e) { return 0; }
  }


  /* ── STAFF ID PREFIX (from the school's Super Admin prefix) ──
     Staff IDs look like PREFIX_S_1, PREFIX_S_2 ... where PREFIX is
     exactly what the super admin typed when adding the school. */
  function getSchoolPrefix() {
    const s = getCurrentSchool();
    const p = (s && s.prefix ? String(s.prefix) : "").trim().toUpperCase();
    return p || "SCH";
  }

  function nextStaffId(existingIds) {
    const prefix = getSchoolPrefix();
    const re = new RegExp("^" + prefix + "_S_(\\d+)$", "i");
    let max = 0;
    (existingIds || []).forEach(function (id) {
      const m = re.exec(String(id || "").trim());
      if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
    });
    return prefix + "_S_" + (max + 1);
  }

  /* Expose the API for superadmin.js, index.js and this file's own guard */
  window.SoftSchoolAdmin = {
    PLANS: PLANS,
    FEATURES: FEATURES,
    getSchools, saveSchools, getSession, setSession, clearSession, revalidateSession,
    addSchool, updateSchool, deleteSchool, getSchoolById,
    isFeatureLocked, authenticateSchool, getCurrentSchool, studentCount,
    getSchoolPrefix, nextStaffId
  };

  /* ── PAGE GUARD ───────────────────────────────────────────────
     Runs automatically on every page that includes this script,
     EXCEPT index.html / superadmin.html (those manage their own
     auth flows and just use the functions above). ────────────── */
  const path = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  const isPublicPage = path === "" || path === "index.html" || path === "superadmin.html";

  if (!isPublicPage) {
    const session = getSession();

    /* Not logged in at all -> send to the login page. */
    if (!session || (!session.school && !session.schoolId)) {
      window.location.href = "index.html";
      return;
    }

    /* Use the school record embedded in the session at login time (from the
       real backend) rather than the legacy local SCHOOLS_KEY registry —
       nothing writes to that registry anymore now that schools live in the
       database, so looking a school up there always failed and incorrectly
       treated every logged-in school as "not found" -> blocked. */
    const school = getCurrentSchool();
    if (!school || school.status === "blocked") {
      clearSession();
      window.location.href = "index.html?blocked=1";
      return;
    }
    if (school.expiryDate && new Date(school.expiryDate) < new Date()) {
      clearSession();
      window.location.href = "index.html?blocked=1";
      return;
    }
    const requiredFeature = PAGE_FEATURE[path];
    if (requiredFeature && isFeatureLocked(school, requiredFeature)) {
      window.location.href = "main.html?locked=" + requiredFeature;
      return;
    }

    /* Confirm the cached session is still accurate against the live backend
       (in case the super admin blocked/changed the plan after this school
       logged in). Runs after the page has already rendered with the cached
       data, so it never blocks or delays the page — it only corrects things
       shortly after if something changed. */
    revalidateSession(function () {
      window.location.href = "index.html?blocked=1";
    });

    document.addEventListener("DOMContentLoaded", function () {
      /* Update school name/logo wherever it appears on the page */
      document.querySelectorAll(
        ".school-name, .slc-l-school-name, .char-school-name"
      ).forEach(el => { el.textContent = school.name; });

      const brandingEl = document.querySelector(".school-branding");
      if (brandingEl && school.logo) {
        brandingEl.style.display = "flex";
        brandingEl.style.alignItems = "center";
        brandingEl.style.gap = "10px";
        let img = brandingEl.querySelector(".school-branding-logo");
        if (!img) {
          img = document.createElement("img");
          img.className = "school-branding-logo";
          img.style.cssText = "height:34px;width:34px;border-radius:8px;object-fit:cover;flex-shrink:0;display:block;";
          brandingEl.insertBefore(img, brandingEl.firstChild);
        }
        img.src = school.logo;
      }

      /* Swap the placeholder icon for the school's actual logo inside the
         SLC / Character Certificate "crest" circles. These same DOM nodes
         get cloned verbatim (via outerHTML) when the certificate is printed,
         so fixing them here also fixes what shows up on the printed page. */
      if (school.logo) {
        ["#slc-document .slc-l-logo", "#char-document .char-l-logo"].forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            el.innerHTML = "";
            const logoImg = document.createElement("img");
            logoImg.src = school.logo;
            logoImg.alt = "School Logo";
            logoImg.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;";
            el.appendChild(logoImg);
          });
        });
      }

      /* Hide nav links for locked features */
      FEATURES.forEach(f => {
        if (!f.page) return;
        if (isFeatureLocked(school, f.key)) {
          document.querySelectorAll('a[href="' + f.page + '"]').forEach(a => {
            a.classList.add("softschool-locked-nav");
            a.style.opacity = "0.35";
            a.style.pointerEvents = "none";
            a.title = "Locked on your current plan — contact your administrator";
            const badge = document.createElement("i");
            badge.className = "fas fa-lock";
            badge.style.cssText = "margin-left:auto;font-size:11px;";
            a.appendChild(badge);
          });
        }
      });

      /* Hide the biometric attendance button specifically */
      if (isFeatureLocked(school, "biometric")) {
        const bioBtn = document.getElementById("link-biometric-btn");
        if (bioBtn) {
          bioBtn.disabled = true;
          bioBtn.title = "Biometric Attendance is not available on your plan";
          bioBtn.style.opacity = "0.4";
          bioBtn.style.cursor = "not-allowed";
          bioBtn.addEventListener("click", function (e) {
            e.preventDefault(); e.stopImmediatePropagation();
            alert("Biometric Attendance is not included in your current plan. Please contact your administrator to upgrade.");
          }, true);
        }
      }

      /* NOTE: the active-student limit on the Manage Students page ("New
         Admission" card + warning banner) is now handled entirely by
         manage-students.js (renderPlanLimitBanners() / canAdmitNewStudent()),
         which also covers the archiveStudentLimit and correctly counts only
         ACTIVE students (this file's old studentCount() counted everyone,
         archived students included). Kept out of this shared file so it
         doesn't double up with that page's own banner + click guard. */

      /* Show a toast if we were redirected here because a page was locked */
      const params = new URLSearchParams(window.location.search);
      const lockedFeature = params.get("locked");
      const blocked = params.get("blocked");
      if (lockedFeature) {
        setTimeout(function () {
          alert("That feature (" + lockedFeature + ") is not available on your current plan.");
        }, 150);
      }
      if (blocked) {
        setTimeout(function () { alert("Your school's access has been suspended. Please contact support."); }, 150);
      }
    });
  }
})();