/**
 * ============================================================
 * SOFT SCHOOL — SUPER ADMIN PANEL LOGIC
 * ------------------------------------------------------------
 * There's no login screen here on purpose: this file is only
 * ever opened directly from the repo/hosting by you — it isn't
 * linked from anywhere inside the app itself, so that's what
 * keeps it private. If you ever host this publicly and want a
 * password on top of that, that's easy to add back in later.
 * ============================================================
 */

const SSA = window.SoftSchoolAdmin; // from access-control.js

let currentPlanId = "basic";
let managingSchoolId = null;

/* ── TOAST ─────────────────────────────────────────────────── */
function saToast(msg, type = "success") {
  const wrap = document.getElementById("saToastWrap");
  const el = document.createElement("div");
  el.className = "sa-toast " + type;
  el.innerHTML = `<i class="fas ${type === "error" ? "fa-circle-xmark" : "fa-circle-check"}"></i><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

document.getElementById("saApp").classList.add("show");
renderAll();

/* ── RENDER: PLAN CARDS (Add School modal) ───────────────── */
function planFeatureList(planId) {
  const bio = planId === "premium";
  return `
    <ul>
      <li class="yes"><i class="fas fa-check"></i> Student &amp; Staff management</li>
      <li class="yes"><i class="fas fa-check"></i> Attendance &amp; Fees/Finance</li>
      <li class="${bio ? "yes" : "no"}"><i class="fas fa-${bio ? "check" : "xmark"}"></i> Biometric attendance</li>
    </ul>`;
}
function renderPlanCards() {
  const wrap = document.getElementById("planCards");
  wrap.innerHTML = Object.values(SSA.PLANS).map(plan => `
    <div class="sa-plan-card ${plan.id === currentPlanId ? "selected" : ""}" data-plan="${plan.id}">
      <div class="plan-check"></div>
      <div class="plan-name">${plan.label}</div>
      <div class="plan-price">Rs ${plan.price.toLocaleString()}<span>/month</span></div>
      <div class="sa-hint" style="margin-bottom:2px;">${plan.studentLimit} students or less</div>
      ${planFeatureList(plan.id)}
    </div>
  `).join("");
  wrap.querySelectorAll(".sa-plan-card").forEach(card => {
    card.addEventListener("click", () => {
      currentPlanId = card.getAttribute("data-plan");
      renderPlanCards();
    });
  });
}

/* Extra-lock dropdown in Add School modal */
function renderExtraLockOptions() {
  const sel = document.getElementById("newSchoolExtraLock");
  sel.innerHTML = '<option value="">None</option>' +
    SSA.FEATURES.map(f => `<option value="${f.key}">${f.label}</option>`).join("");
}

/* ── ADD SCHOOL MODAL ─────────────────────────────────────── */
let newSchoolLogoData = "";

function openAddSchoolModal() {
  document.getElementById("newSchoolName").value = "";
  document.getElementById("newSchoolUsername").value = "";
  document.getElementById("newSchoolPassword").value = "";
  document.getElementById("newSchoolStudentLimit").value = "";
  newSchoolLogoData = "";
  document.getElementById("newSchoolLogoPreview").src = "logo-icon.png";
  currentPlanId = "basic";
  renderPlanCards();
  renderExtraLockOptions();
  document.getElementById("addSchoolOverlay").classList.add("open");
}
function closeAddSchoolModal() {
  document.getElementById("addSchoolOverlay").classList.remove("open");
}

document.getElementById("btnOpenAddSchool").addEventListener("click", openAddSchoolModal);
document.getElementById("closeAddSchool").addEventListener("click", closeAddSchoolModal);
document.getElementById("cancelAddSchool").addEventListener("click", closeAddSchoolModal);
document.getElementById("addSchoolOverlay").addEventListener("click", function (e) {
  if (e.target === this) closeAddSchoolModal();
});

document.getElementById("newSchoolLogoInput").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (ev) {
    newSchoolLogoData = ev.target.result;
    document.getElementById("newSchoolLogoPreview").src = newSchoolLogoData;
  };
  reader.readAsDataURL(file);
});

document.getElementById("saveNewSchool").addEventListener("click", function () {
  const name = document.getElementById("newSchoolName").value.trim();
  const username = document.getElementById("newSchoolUsername").value.trim();
  const password = document.getElementById("newSchoolPassword").value;
  const customLimit = document.getElementById("newSchoolStudentLimit").value;
  const extraLock = document.getElementById("newSchoolExtraLock").value;

  if (!name) { saToast("Please enter a school name.", "error"); return; }
  if (!username || !password) { saToast("Please set a username and password for this school.", "error"); return; }

  const existing = SSA.getSchools();
  if (existing.some(s => s.username.toLowerCase() === username.toLowerCase())) {
    saToast("That username is already taken by another school.", "error");
    return;
  }

  const plan = SSA.PLANS[currentPlanId];
  const locks = plan.defaultLocks.slice();
  if (extraLock && locks.indexOf(extraLock) === -1) locks.push(extraLock);

  const school = SSA.addSchool({
    name, username, password,
    logo: newSchoolLogoData,
    planId: currentPlanId,
    studentLimit: customLimit ? parseInt(customLimit, 10) : plan.studentLimit,
    locks
  });

  closeAddSchoolModal();
  renderAll();
  saToast(`${school.name} added — ID ${school.id}`, "success");
});

/* ── SCHOOLS TABLE ────────────────────────────────────────── */
function planBadgeClass(planId) { return "sa-badge-" + planId; }

function schoolLogoCell(school) {
  if (school.logo) {
    return `<img class="sa-school-logo" src="${school.logo}" alt="">`;
  }
  const initial = (school.name || "?").trim().charAt(0).toUpperCase();
  return `<div class="sa-school-logo placeholder">${initial}</div>`;
}

function renderSchoolsTable(filterText) {
  const wrap = document.getElementById("schoolsTableWrap");
  let schools = SSA.getSchools();
  if (filterText) {
    const q = filterText.toLowerCase();
    schools = schools.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  }
  if (!schools.length) {
    wrap.innerHTML = `<div class="sa-empty"><i class="fas fa-school"></i>No schools yet — click "Add School" to onboard your first one.</div>`;
    return;
  }
  wrap.innerHTML = `
    <table class="sa-table">
      <thead>
        <tr>
          <th>School</th><th>ID</th><th>Plan</th><th>Students</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${schools.map(s => {
          const plan = SSA.PLANS[s.planId] || SSA.PLANS.basic;
          return `
          <tr data-id="${s.id}">
            <td>
              <div class="sa-school-cell">
                ${schoolLogoCell(s)}
                <div><div class="sa-school-name">${s.name}</div></div>
              </div>
            </td>
            <td><span class="sa-school-id">${s.id}</span></td>
            <td><span class="sa-badge ${planBadgeClass(s.planId)}">${plan.label}</span></td>
            <td>${s.studentLimit} max</td>
            <td><span class="sa-badge ${s.status === "blocked" ? "sa-badge-blocked" : "sa-badge-active"}">${s.status === "blocked" ? "Blocked" : "Active"}</span></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
  wrap.querySelectorAll("tbody tr").forEach(row => {
    row.addEventListener("click", () => openManageSchool(row.getAttribute("data-id")));
  });
}

function renderStats() {
  const schools = SSA.getSchools();
  document.getElementById("statTotal").textContent = schools.length;
  document.getElementById("statActive").textContent = schools.filter(s => s.status !== "blocked").length;
  document.getElementById("statBlocked").textContent = schools.filter(s => s.status === "blocked").length;
  const revenue = schools.reduce((sum, s) => {
    if (s.status === "blocked") return sum;
    const plan = SSA.PLANS[s.planId] || SSA.PLANS.basic;
    return sum + plan.price;
  }, 0);
  document.getElementById("statRevenue").textContent = "Rs " + revenue.toLocaleString();
}

function renderAll() {
  renderStats();
  renderSchoolsTable(document.getElementById("schoolSearch").value);
}

document.getElementById("schoolSearch").addEventListener("input", function () {
  renderSchoolsTable(this.value);
});

/* ── MANAGE SCHOOL MODAL ──────────────────────────────────── */
function featureIcon(key) {
  const map = { students: "fa-user-graduate", staff: "fa-chalkboard-teacher", attendance: "fa-clipboard-check", biometric: "fa-fingerprint", finance: "fa-file-invoice-dollar", settings: "fa-cog" };
  return map[key] || "fa-puzzle-piece";
}

function openManageSchool(id) {
  const school = SSA.getSchoolById(id);
  if (!school) return;
  managingSchoolId = id;
  document.getElementById("manageSchoolTitle").innerHTML = `<i class="fas fa-school"></i> ${school.name}`;

  const plan = SSA.PLANS[school.planId] || SSA.PLANS.basic;
  const isBlocked = school.status === "blocked";

  document.getElementById("manageSchoolBody").innerHTML = `
    <div class="sa-form-row full">
      <div class="sa-field-group">
        <label>School ID</label>
        <input type="text" value="${school.id}" disabled>
      </div>
    </div>
    <div class="sa-form-row full sa-field-group">
      <div>
        <label>School name</label>
        <input type="text" id="mgName" value="${school.name.replace(/"/g, "&quot;")}">
      </div>
    </div>

    <div class="sa-form-row">
      <div class="sa-field-group">
        <label>Plan</label>
        <select id="mgPlan">
          ${Object.values(SSA.PLANS).map(p => `<option value="${p.id}" ${p.id === school.planId ? "selected" : ""}>${p.label} — Rs ${p.price.toLocaleString()}/mo</option>`).join("")}
        </select>
      </div>
      <div class="sa-field-group">
        <label>Student limit</label>
        <input type="number" id="mgStudentLimit" value="${school.studentLimit}">
      </div>
    </div>

    <div class="sa-form-row">
      <div class="sa-field-group">
        <label>Username</label>
        <input type="text" id="mgUsername" value="${school.username.replace(/"/g, "&quot;")}">
      </div>
      <div class="sa-field-group">
        <label>Password</label>
        <input type="text" id="mgPassword" value="${school.password.replace(/"/g, "&quot;")}">
      </div>
    </div>

    <div class="sa-credentials-box">
      <b>Login to give this school:</b> username <b>${school.username}</b>, password <b>${school.password}</b> — they sign in from the normal login page.
    </div>

    <div class="sa-limits-box" style="margin-top:18px;">
      <h4><i class="fas fa-lock"></i> Feature access — toggle ON to lock a feature for this school</h4>
      <div class="sa-lock-list">
        ${SSA.FEATURES.map(f => `
          <div class="sa-lock-row">
            <span class="name"><i class="fas ${featureIcon(f.key)}"></i>${f.label}</span>
            <label class="sa-switch">
              <input type="checkbox" class="mgLockToggle" data-feature="${f.key}" ${(school.locks || []).includes(f.key) ? "checked" : ""}>
              <span class="slider"></span>
            </label>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="sa-form-row full" style="margin-top:18px;">
      <div>
        <label style="display:block;font-size:0.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:8px;">Overall access</label>
        <button type="button" id="mgToggleBlock" class="${isBlocked ? "sa-btn-unblock" : "sa-btn-block"}" style="width:100%;">
          <i class="fas ${isBlocked ? "fa-lock-open" : "fa-ban"}"></i> ${isBlocked ? "Unblock this school (restore access)" : "Block this school (suspend access, keep their data)"}
        </button>
      </div>
    </div>
  `;

  document.getElementById("mgToggleBlock").addEventListener("click", function () {
    const s = SSA.getSchoolById(managingSchoolId);
    const newStatus = s.status === "blocked" ? "active" : "blocked";
    SSA.updateSchool(managingSchoolId, { status: newStatus });
    saToast(newStatus === "blocked" ? "School blocked — their data is untouched." : "School unblocked.", newStatus === "blocked" ? "error" : "success");
    openManageSchool(managingSchoolId);
    renderAll();
  });

  document.getElementById("manageSchoolOverlay").classList.add("open");
}

function closeManageSchool() {
  document.getElementById("manageSchoolOverlay").classList.remove("open");
  managingSchoolId = null;
}
document.getElementById("closeManageSchool").addEventListener("click", closeManageSchool);
document.getElementById("closeManageSchool2").addEventListener("click", closeManageSchool);
document.getElementById("manageSchoolOverlay").addEventListener("click", function (e) {
  if (e.target === this) closeManageSchool();
});

document.getElementById("saveManageSchool").addEventListener("click", function () {
  if (!managingSchoolId) return;
  const name = document.getElementById("mgName").value.trim();
  const username = document.getElementById("mgUsername").value.trim();
  const password = document.getElementById("mgPassword").value;
  const planId = document.getElementById("mgPlan").value;
  const studentLimit = parseInt(document.getElementById("mgStudentLimit").value, 10) || SSA.PLANS[planId].studentLimit;

  if (!name || !username || !password) { saToast("Name, username and password can't be empty.", "error"); return; }

  const dupe = SSA.getSchools().some(s => s.id !== managingSchoolId && s.username.toLowerCase() === username.toLowerCase());
  if (dupe) { saToast("That username is already used by another school.", "error"); return; }

  const locks = Array.from(document.querySelectorAll(".mgLockToggle"))
    .filter(cb => cb.checked)
    .map(cb => cb.getAttribute("data-feature"));

  SSA.updateSchool(managingSchoolId, { name, username, password, planId, studentLimit, locks });
  closeManageSchool();
  renderAll();
  saToast("Changes saved.", "success");
});

document.getElementById("deleteSchoolBtn").addEventListener("click", function () {
  if (!managingSchoolId) return;
  const school = SSA.getSchoolById(managingSchoolId);
  if (!confirm(`Delete "${school.name}"? This removes their login and registry entry (it does not touch any operational data already stored on their own device).`)) return;
  SSA.deleteSchool(managingSchoolId);
  closeManageSchool();
  renderAll();
  saToast("School deleted.", "success");
});
