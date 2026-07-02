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
  const SCHOOLS_KEY  = "softschool_schools";   // array of school records
  const SESSION_KEY   = "softschool_session";   // currently logged-in school

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
  function setSession(schoolId) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ schoolId: schoolId, at: Date.now() }));
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
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
    return (school.locks || []).indexOf(featureKey) !== -1;
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
    return getSchoolById(session.schoolId);
  }

  function studentCount() {
    try { return (JSON.parse(localStorage.getItem("edu_students")) || []).length; }
    catch (e) { return 0; }
  }

  /* Expose the API for superadmin.js, index.js and this file's own guard */
  window.SoftSchoolAdmin = {
    PLANS: PLANS,
    FEATURES: FEATURES,
    getSchools, saveSchools, getSession, setSession, clearSession,
    addSchool, updateSchool, deleteSchool, getSchoolById,
    isFeatureLocked, authenticateSchool, getCurrentSchool, studentCount
  };

  /* ── PAGE GUARD ───────────────────────────────────────────────
     Runs automatically on every page that includes this script,
     EXCEPT index.html / superadmin.html (those manage their own
     auth flows and just use the functions above). ────────────── */
  const path = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  const isPublicPage = path === "" || path === "index.html" || path === "superadmin.html";

  if (!isPublicPage) {
    /* If Super Admin hasn't added any school yet, don't force a login —
       let every page open directly like before, so the software works
       normally out of the box. The guard activates automatically the
       moment the first school is added in superadmin.html. */
    if (getSchools().length === 0) {
      return;
    }

    const session = getSession();
    if (!session) {
      window.location.href = "index.html";
      return;
    }
    const school = getSchoolById(session.schoolId);
    if (!school || school.status === "blocked") {
      clearSession();
      window.location.href = "index.html?blocked=1";
      return;
    }
    const requiredFeature = PAGE_FEATURE[path];
    if (requiredFeature && isFeatureLocked(school, requiredFeature)) {
      window.location.href = "main.html?locked=" + requiredFeature;
      return;
    }

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

      /* Enforce student limit on the Manage Students page */
      if (path === "manage-students.html") {
        const addCard = document.getElementById("card-add-student");
        const count = studentCount();
        if (addCard && count >= (school.studentLimit || 0)) {
          addCard.style.opacity = "0.5";
          addCard.style.pointerEvents = "none";
          addCard.title = "Student limit reached for your plan (" + school.studentLimit + ")";
          addCard.addEventListener("click", function (e) {
            e.preventDefault(); e.stopImmediatePropagation();
            alert("You've reached your plan's student limit (" + school.studentLimit + " students). Please contact your administrator to upgrade your plan.");
          }, true);
        }
      }

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
