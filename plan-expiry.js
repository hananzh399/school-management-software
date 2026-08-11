/**
 * ============================================================
 * SOFT SCHOOL — ANNUAL PLAN EXPIRY REMINDER (SCHOOL SIDE)
 * ------------------------------------------------------------
 * Include this on the school dashboard page, AFTER access-control.js:
 *
 *   <link rel="stylesheet" href="superadmin.css">   <!-- or copy the
 *        .ss-expiry-* rules from it into your dashboard stylesheet -->
 *   <script src="plan-expiry.js"></script>
 *
 * What it does:
 *  • Every plan is an ANNUAL (1 year) plan. The expiry date was fixed
 *    to exactly one year after the school's registration date.
 *  • Starting ONE MONTH before that date it shows a sticky banner and
 *    keeps popping up a reminder (every few minutes) until the plan is
 *    renewed by the super admin.
 * ============================================================
 */
(function () {
  var WARN_DAYS = 30;
  var REPOP_MS = 3 * 60 * 1000; // keep reminding every 3 minutes
  var BRAND = { name: "Soft School", logo: "logo-icon.png" };

  function todayISO() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
  }
  function addYears(iso, years) {
    var d = new Date(iso), day = d.getDate();
    d.setFullYear(d.getFullYear() + years);
    if (d.getDate() !== day) d.setDate(0);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
  }
  function daysUntil(iso) {
    if (!iso) return null;
    return Math.round((new Date(iso).getTime() - new Date(todayISO()).getTime()) / 86400000);
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  /** Finds the school record for whoever is logged in on this device. */
  function currentSchool() {
    var SSA = window.SoftSchoolAdmin;
    if (!SSA || typeof SSA.getSchools !== "function") return null;

    if (typeof SSA.getCurrentSchool === "function") {
      var s = SSA.getCurrentSchool();
      if (s) return s;
    }
    var schools = SSA.getSchools() || [];
    var keys = ["softschool_current_school", "softschool_session", "currentSchool", "schoolId", "softschool_school_id"];
    for (var i = 0; i < keys.length; i++) {
      var raw = localStorage.getItem(keys[i]);
      if (!raw) continue;
      var id = raw;
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") id = parsed.id || parsed.schoolId || parsed.school || "";
        else id = parsed;
      } catch (e) { /* plain string id */ }
      var found = schools.filter(function (s) { return s.id === id || s.username === id; })[0];
      if (found) return found;
    }
    return schools.length === 1 ? schools[0] : null;
  }

  function expiryOf(school) {
    if (school.expiryDate) return school.expiryDate;
    var reg = school.registeredAt || (school.createdAt ? String(school.createdAt).slice(0, 10) : todayISO());
    return addYears(reg, 1);
  }

  function showBanner(days, iso, expired) {
    var el = document.getElementById("ssExpiryBanner");
    if (!el) {
      el = document.createElement("div");
      el.id = "ssExpiryBanner";
      el.className = "ss-expiry-banner";
      document.body.insertBefore(el, document.body.firstChild);
    }
    el.className = "ss-expiry-banner" + (expired ? " expired" : "");
    el.innerHTML = expired
      ? '<i class="fas fa-triangle-exclamation"></i> Your ' + BRAND.name +
        " annual plan expired on " + fmtDate(iso) + ". Please contact the administrator to renew."
      : '<i class="fas fa-clock"></i> Your ' + BRAND.name + " annual plan expires on " +
        fmtDate(iso) + " — " + days + " day" + (days === 1 ? "" : "s") + " left. Please renew in time.";
  }

  function showPopup(days, iso, expired) {
    var overlay = document.getElementById("ssExpiryOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "ssExpiryOverlay";
      overlay.className = "ss-expiry-overlay";
      overlay.innerHTML =
        '<div class="ss-expiry-card" id="ssExpiryCard">' +
          '<img src="' + BRAND.logo + '" alt="' + BRAND.name + '">' +
          '<h3 id="ssExpiryTitle"></h3>' +
          '<div class="ss-days" id="ssExpiryDays"></div>' +
          '<p id="ssExpiryText"></p>' +
          '<button type="button" id="ssExpiryOk">Okay, got it</button>' +
        "</div>";
      document.body.appendChild(overlay);
      overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("open"); });
      document.getElementById("ssExpiryOk").addEventListener("click", function () { overlay.classList.remove("open"); });
    }
    document.getElementById("ssExpiryCard").className = "ss-expiry-card" + (expired ? " expired" : "");
    document.getElementById("ssExpiryTitle").textContent = expired
      ? "Your annual plan has expired"
      : "Your annual plan is expiring soon";
    document.getElementById("ssExpiryDays").textContent = expired
      ? "Expired"
      : days + (days === 1 ? " day" : " days");
    document.getElementById("ssExpiryText").textContent = expired
      ? "The plan ended on " + fmtDate(iso) + ". Please contact the " + BRAND.name + " administrator to renew for another year."
      : "Your plan is valid until " + fmtDate(iso) + ". Please renew it to keep using " + BRAND.name + " without interruption.";
    overlay.classList.add("open");
  }

  function check() {
    var school = currentSchool();
    if (!school) return;
    var iso = expiryOf(school);
    var days = daysUntil(iso);
    if (days === null || days > WARN_DAYS) return;
    var expired = days <= 0;
    showBanner(days, iso, expired);
    showPopup(days, iso, expired);
  }

  function start() {
    setTimeout(check, 900);
    setInterval(check, REPOP_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.SoftSchoolExpiry = { check: check, daysUntil: daysUntil, expiryOf: expiryOf };
})();
