/**
 * ============================================================
 * SOFT SCHOOL — SUPER ADMIN PANEL LOGIC
 * ------------------------------------------------------------
 * SECURITY FIX: this panel used to have "no login on purpose",
 * relying only on the URL being unpublicized — not a real
 * protection, especially in a public repo. It now requires a
 * real login (see the auth gate below): the browser exchanges a
 * username/password for a short-lived signed session token from
 * the backend (/api/admin-auth/login) and sends that token on
 * every admin API call. No static API key is ever embedded in
 * this file or stored long-term in the browser — see
 * AdminSessionService.java on the backend for why that's safe.
 *
 * UPDATED:
 *  • No built-in plans anymore — every plan is one you create.
 *  • Plans can be shared (WhatsApp / native share / copy) and printed.
 * ============================================================
 */

const SSA = window.SoftSchoolAdmin; // from access-control.js — still used for the static FEATURES catalog

/* ══════════════ ADMIN AUTH GATE ══════════════
   Session token lives ONLY in sessionStorage (cleared when the tab
   closes) — never localStorage, never hardcoded in this file, and
   never logged. Every admin API call below attaches it as
   "Authorization: Bearer <token>"; a 401 clears it and re-shows the
   login screen.
   ══════════════════════════════════════════════ */
const ADMIN_TOKEN_KEY = "ssa_admin_token";

function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}
function setAdminToken(token) {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}
function clearAdminToken() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

function showAdminLoginGate() {
  const app = document.getElementById("saApp");
  if (app) app.style.display = "none";

  let gate = document.getElementById("saLoginGate");
  if (!gate) {
    gate = document.createElement("div");
    gate.id = "saLoginGate";
    gate.style.cssText =
      "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
      "background:#0f1115;font-family:Inter,sans-serif;z-index:9999;";
    gate.innerHTML = `
      <form id="saLoginForm" style="background:#181b22;padding:32px;border-radius:12px;width:280px;box-shadow:0 8px 30px rgba(0,0,0,.4);">
        <h2 style="color:#fff;font-size:18px;margin:0 0 16px;">Super Admin Login</h2>
        <input id="saLoginUsername" type="text" placeholder="Username" autocomplete="username"
          style="width:100%;padding:10px;margin-bottom:10px;border-radius:6px;border:1px solid #333;background:#0f1115;color:#fff;box-sizing:border-box;" required>
        <input id="saLoginPassword" type="password" placeholder="Password" autocomplete="current-password"
          style="width:100%;padding:10px;margin-bottom:14px;border-radius:6px;border:1px solid #333;background:#0f1115;color:#fff;box-sizing:border-box;" required>
        <button type="submit" style="width:100%;padding:10px;border-radius:6px;border:none;background:#4f7cff;color:#fff;font-weight:600;cursor:pointer;">Log in</button>
        <div id="saLoginError" style="color:#ff6b6b;font-size:13px;margin-top:10px;min-height:16px;"></div>
      </form>`;
    document.body.appendChild(gate);

    gate.querySelector("#saLoginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = gate.querySelector("#saLoginUsername").value.trim();
      const password = gate.querySelector("#saLoginPassword").value;
      const errorEl = gate.querySelector("#saLoginError");
      errorEl.textContent = "";
      try {
        const res = await fetch(ADMIN_AUTH_LOGIN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token) {
          errorEl.textContent = data.error || "Login failed.";
          return;
        }
        setAdminToken(data.token);
        gate.remove();
        if (app) app.style.display = "";
        if (typeof initSuperAdminApp === "function") initSuperAdminApp();
      } catch (err) {
        errorEl.textContent = "Could not reach the server.";
      }
    });
  } else {
    gate.style.display = "flex";
  }
}

/* ── NEW LOCKABLE FEATURES ────────────────────────────────────
   Registered here (rather than requiring an edit to access-control.js)
   so plans/schools can lock or unlock:
     • Reports & Analysis page
     • Student B-Form picture upload
     • Staff Agreement picture upload
   Added only if not already present, so this is safe to keep even
   after access-control.js is updated to include them natively.
   ═══════════════════════════════════════════════════════════ */
[
  { key: "reports", label: "Reports & Analysis" },
  { key: "bform_pic", label: "Student B-Form Picture" },
  { key: "staff_agreement_pic", label: "Staff Agreement Picture" }
].forEach(nf => {
  if (!SSA.FEATURES.some(f => f.key === nf.key)) SSA.FEATURES.push(nf);
});

let currentPlanId = "";
let managingSchoolId = null;
let managingLogoData = null; // null = unchanged

/* ══════════════ LOGO AUTO-OPTIMIZE ══════════════════════════
   School logos come in from <input type=file> as raw base64
   data URLs (readAsDataURL) with no size limit — a phone photo
   can easily be several MB, which is what was making the
   LONGTEXT logo column balloon. This resizes the image on a
   canvas and re-encodes it as JPEG, stepping quality (and, if
   needed, dimensions) down until the resulting data URL is
   under the target size (default 40KB). Runs entirely in the
   browser before the logo is ever sent to the backend.
   ═════════════════════════════════════════════════════════ */
function compressLogoFile(file, maxSizeKB = 40, maxDimension = 512) {
  const maxBytes = maxSizeKB * 1024;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read the file."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file doesn't look like a valid image."));
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (!width || !height) { reject(new Error("Couldn't read image dimensions.")); return; }

        // Scale down to a sane max dimension up front — logos never need
        // to be bigger than this, and it makes the quality search below
        // converge much faster.
        if (width > maxDimension || height > maxDimension) {
          const scale = Math.min(maxDimension / width, maxDimension / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const render = (w, h) => {
          canvas.width = w;
          canvas.height = h;
          // Flatten onto white first — JPEG has no alpha channel, so a
          // transparent PNG logo would otherwise turn black.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
        };

        render(width, height);

        let quality = 0.9;
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        const approxBytes = (durl) => Math.round(durl.length * 0.75);

        let guard = 0;
        while (approxBytes(dataUrl) > maxBytes && guard < 20) {
          if (quality > 0.2) {
            quality -= 0.1;
          } else {
            // Quality is already low and it's still too big — shrink
            // the canvas further instead of degrading quality more.
            width = Math.round(width * 0.85);
            height = Math.round(height * 0.85);
            if (width < 40 || height < 40) break; // don't go below usable size
            render(width, height);
            quality = 0.6;
          }
          dataUrl = canvas.toDataURL("image/jpeg", quality);
          guard++;
        }

        resolve(dataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ══════════════ SCHOOLS API (real backend, no more localStorage) ══════════════
   Schools now live in the Spring Boot / MySQL backend. Plans stay client-side
   (see PLAN STORE below) — only school records themselves are server-backed.
   ═══════════════════════════════════════════════════════════════════════════ */
const API_BASE_URL = "https://softschool-production.up.railway.app/api/admin";
const ADMIN_AUTH_LOGIN_URL = "https://softschool-production.up.railway.app/api/admin-auth/login";

// Local cache of the last list fetched from the server, so search/stats/expiry
// checks don't need to hit the network on every keystroke.
let cachedSchools = [];

async function apiRequest(path, options) {
  const token = getAdminToken();
  const res = await fetch(API_BASE_URL + path, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": "Bearer " + token } : {})
    },
    ...options
  });

  if (res.status === 401) {
    // Session expired or missing — drop the stale token and force a
    // fresh login rather than silently failing every call after this.
    clearAdminToken();
    showAdminLoginGate();
    throw new Error("Your admin session expired. Please log in again.");
  }

  if (!res.ok) {
    let message = "Request failed (" + res.status + ")";
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch (e) { /* not JSON, ignore */ }
    throw new Error(message);
  }
  if (res.status === 204) return null; // no content (e.g. DELETE)
  return res.json();
}

function apiGetSchools() {
  return apiRequest("/schools");
}
function apiPreviewNextSchoolId() {
  return apiRequest("/schools/next-id");
}
function apiCreateSchool(payload) {
  return apiRequest("/schools", { method: "POST", body: JSON.stringify(payload) });
}
function apiUpdateSchool(id, patch) {
  return apiRequest(`/schools/${id}`, { method: "PUT", body: JSON.stringify(patch) });
}
function apiSetStatus(id, status) {
  return apiRequest(`/schools/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}
function apiRenewSchool(id) {
  return apiRequest(`/schools/${id}/renew`, { method: "PUT" });
}
function apiDeleteSchool(id) {
  return apiRequest(`/schools/${id}`, { method: "DELETE" });
}
function getCachedSchoolById(id) {
  return cachedSchools.find(s => String(s.id) === String(id));
}

function apiGetPlans() {
  return apiRequest("/plans");
}

function apiCreatePlan(planData) {
  return apiRequest("/plans", { method: "POST", body: JSON.stringify(planData) });
}

function apiDeletePlan(id) {
  return apiRequest(`/plans/${id}`, { method: "DELETE" });
}
function apiUpdatePlan(id, planData) {
  return apiRequest(`/plans/${id}`, { method: "PUT", body: JSON.stringify(planData) });
}
/* ── PLAN STORE (server-backed — plans now live in MySQL via /api/admin/plans) ──
   The backend stores each plan's locked-out features as a single comma-separated
   "locks" string (see Plan.java). The UI works with two derived arrays instead:
     • defaultLocks — feature keys that are OFF (locked) for this plan
     • features     — feature keys that are ON (included) for this plan
   normalizePlanFromServer() / planToServerShape() convert between the two shapes.
   ═══════════════════════════════════════════════════════════════════════════ */
let cachedPlans = [];

function normalizePlanFromServer(p) {
  const defaultLocks = (p.locks || "").split(",").map(s => s.trim()).filter(Boolean);
  return {
    id: p.id,
    label: p.label,
    price: p.price,
    studentLimit: p.studentLimit,
    staffLimit: p.staffLimit,
    defaultLocks,
    features: SSA.FEATURES.map(f => f.key).filter(k => defaultLocks.indexOf(k) === -1),
    custom: true
  };
}
function planToServerShape(plan) {
  return {
    id: plan.id,
    label: plan.label,
    price: plan.price,
    studentLimit: plan.studentLimit,
    staffLimit: plan.staffLimit,
    locks: (plan.defaultLocks || []).join(",")
  };
}
/** Refreshes the local plan cache from the server. Call after any create/delete. */
async function loadPlans() {
  cachedPlans = (await apiGetPlans()).map(normalizePlanFromServer);
}
function allPlans() {
  const map = {};
  cachedPlans.forEach(p => { map[p.id] = p; });
  return map;
}
function planList() {
  return cachedPlans;
}
function hasPlans() {
  return cachedPlans.length > 0;
}
/** Returns the plan, or a neutral placeholder if it no longer exists. */
function getPlan(id) {
  return allPlans()[id] || { id: id || "", label: id ? "Unassigned plan" : "No plan", price: 0, studentLimit: 0, defaultLocks: [], missing: true };
}
function planLocks(plan) {
  return plan.defaultLocks || [];
}
function firstPlanId() {
  const list = planList();
  return list.length ? list[0].id : "";
}

/* ══════════════ BRANDING (print / share header) ══════════════ */
const SOFT_SCHOOL_BRAND = {
  name: "Soft School",
  tagline: "School Management Software",
  logo: "logo-icon.png"
};

/* ══════════════ ANNUAL PLAN VALIDITY ══════════════
   Every plan is a 1-YEAR (annual) plan. The day a school is
   registered is remembered and the expiry date is fixed to
   exactly one year later. One month before that date the panel
   keeps reminding you (and the school's own dashboard).
   ══════════════════════════════════════════════════ */
const EXPIRY_WARN_DAYS = 30;

function todayISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}
function addYears(iso, years) {
  const d = new Date(iso);
  const day = d.getDate();
  d.setFullYear(d.getFullYear() + years);
  if (d.getDate() !== day) d.setDate(0); // 29 Feb -> 28 Feb
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function daysUntil(iso) {
  if (!iso) return null;
  const a = new Date(todayISO()).getTime();
  const b = new Date(iso).getTime();
  return Math.round((b - a) / 86400000);
}
function expiryInfo(school) {
  const iso = school.expiryDate;
  const days = daysUntil(iso);
  if (days === null) return { state: "none", days: null, iso: "", label: "No expiry set", cls: "sa-badge-basic" };
  if (days < 0)  return { state: "expired", days, iso, label: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`, cls: "sa-badge-blocked" };
  if (days === 0) return { state: "expired", days, iso, label: "Expires today", cls: "sa-badge-blocked" };
  if (days <= EXPIRY_WARN_DAYS) return { state: "warn", days, iso, label: `${days} day${days === 1 ? "" : "s"} left`, cls: "sa-badge-pro" };
  return { state: "ok", days, iso, label: `${days} days left`, cls: "sa-badge-active" };
}
/** Renews a school for another full year from today (or from expiry if still valid). Returns the updated school. */
async function renewSchoolYear(id) {
  return apiRenewSchool(id);
}

/* ── TOAST ─────────────────────────────────────────────────── */
function saToast(msg, type = "success") {
  const wrap = document.getElementById("saToastWrap");
  const el = document.createElement("div");
  el.className = "sa-toast " + type;
  el.innerHTML = `<i class="fas ${type === "error" ? "fa-circle-xmark" : "fa-circle-check"}"></i><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}


/* ── RENDER: PLAN CARDS (Add School modal) ───────────────── */
function planFeatureList(planId) {
  const locks = planLocks(getPlan(planId));
  return `
    <ul>
      ${SSA.FEATURES.map(f => {
        const on = locks.indexOf(f.key) === -1;
        return `<li class="${on ? "yes" : "no"}"><i class="fas fa-${on ? "check" : "xmark"}"></i> ${f.label}</li>`;
      }).join("")}
    </ul>`;
}
function renderPlanCards() {
  const wrap = document.getElementById("planCards");
  const plans = planList();

  if (!plans.length) {
    wrap.innerHTML = `
      <div class="sa-plans-empty" style="grid-column:1/-1;">
        <i class="fas fa-layer-group"></i>
        No plans yet. Close this and click <strong>Create Plan</strong> to make your first one.
      </div>`;
    currentPlanId = "";
    return;
  }
  if (!allPlans()[currentPlanId]) currentPlanId = plans[0].id;

  wrap.innerHTML = plans.map(plan => `
    <div class="sa-plan-card ${plan.id === currentPlanId ? "selected" : ""}" data-plan="${plan.id}">
      <div class="plan-check"></div>
      <div class="plan-name">${plan.label}</div>
      <div class="plan-price">Rs ${Number(plan.price).toLocaleString()}<span>/year</span></div>
      <div class="sa-hint" style="margin-bottom:2px;">${plan.studentLimit} students or less</div>
      <div class="sa-hint" style="margin-bottom:2px;">${plan.staffLimit || 0} staff members or less</div>
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

/* ══════════════ SHARE & PRINT PLANS ══════════════ */
function planFeatureNames(plan) {
  const locks = planLocks(plan);
  return {
    included: SSA.FEATURES.filter(f => locks.indexOf(f.key) === -1).map(f => f.label),
    excluded: SSA.FEATURES.filter(f => locks.indexOf(f.key) !== -1).map(f => f.label)
  };
}

/** Plain-text version of one plan (WhatsApp friendly). */
function planToText(plan) {
  const { included, excluded } = planFeatureNames(plan);
  let t = `*${plan.label}*\n`;
  t += `Rs ${Number(plan.price).toLocaleString()} / year (annual plan)\n`;
  t += `Validity: 1 year from the date of registration\n`;
  t += `Up to ${plan.studentLimit} students\n`;
  t += `Up to ${plan.staffLimit || 0} staff members\n`;
  t += `Included: ${included.length ? included.join(", ") : "—"}\n`;
  if (excluded.length) t += `Not included: ${excluded.join(", ")}\n`;
  return t;
}

/** Plain-text version of all plans. */
function allPlansToText() {
  const plans = planList();
  if (!plans.length) return "";
  const header = "*Soft School — Plans & Pricing*\n\n";
  const footer = `\n_Shared on ${new Date().toLocaleDateString()}_`;
  return header + plans.map(planToText).join("\n") + footer;
}

function shareOnWhatsApp(text) {
  if (!text) { saToast("No plans to share yet — create a plan first.", "error"); return; }
  window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
}

async function shareNative(text, title) {
  if (!text) { saToast("No plans to share yet — create a plan first.", "error"); return; }
  if (navigator.share) {
    try { await navigator.share({ title: title || "Soft School Plans", text }); }
    catch (e) { /* user cancelled */ }
  } else {
    copyText(text, "Sharing isn't supported here — plans copied to clipboard instead.");
  }
}

async function copyText(text, msg) {
  if (!text) { saToast("No plans to share yet — create a plan first.", "error"); return; }
  try {
    await navigator.clipboard.writeText(text);
    saToast(msg || "Copied to clipboard.", "success");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
    saToast(msg || "Copied to clipboard.", "success");
  }
}

/** Builds the hidden print sheet and opens the browser print dialog. */
function printPlans(only) {
  const plans = only ? [only] : planList();
  if (!plans.length) { saToast("No plans to print yet — create a plan first.", "error"); return; }

  let area = document.getElementById("saPrintArea");
  if (!area) {
    area = document.createElement("div");
    area.id = "saPrintArea";
    document.body.appendChild(area);
  }

  area.innerHTML = `
    <div class="pr-head">
      <div class="pr-brand">
        <img class="pr-logo" src="${SOFT_SCHOOL_BRAND.logo}" alt="${SOFT_SCHOOL_BRAND.name}">
        <div class="pr-brand-text">
          <div class="pr-brand-name">${SOFT_SCHOOL_BRAND.name}</div>
          <div class="pr-brand-tag">${SOFT_SCHOOL_BRAND.tagline}</div>
        </div>
      </div>
      <h1>Plans &amp; Pricing — Annual</h1>
      <p>${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</p>
    </div>
    <div class="pr-grid">
      ${plans.map(p => {
        const { included, excluded } = planFeatureNames(p);
        return `
        <div class="pr-card">
          <h3>${p.label}</h3>
          <div class="pr-price">Rs ${Number(p.price).toLocaleString()}<span> / year</span></div>
          <div class="pr-validity">Valid for 1 year from registration date</div>
          <div style="font-size:0.82rem;color:#44615D;">Up to ${p.studentLimit} students</div>
          <ul>
            ${included.map(l => `<li>&#10003; ${l}</li>`).join("")}
            ${excluded.map(l => `<li style="color:#8AA29E;">&#10007; ${l}</li>`).join("")}
          </ul>
        </div>`;
      }).join("")}
    </div>
    <div class="pr-foot"><img src="${SOFT_SCHOOL_BRAND.logo}" alt=""> ${SOFT_SCHOOL_BRAND.name} — ${SOFT_SCHOOL_BRAND.tagline} · All plans are annual (1 year)</div>
  `;

  window.print();
}

/* Header shortcuts */
document.getElementById("btnSharePlansTop").addEventListener("click", () => shareOnWhatsApp(allPlansToText()));
document.getElementById("btnPrintPlansTop").addEventListener("click", () => printPlans());

/* Plans-modal actions */
document.getElementById("btnShareAllWhatsApp").addEventListener("click", () => shareOnWhatsApp(allPlansToText()));
document.getElementById("btnShareAllOther").addEventListener("click", () => shareNative(allPlansToText()));
document.getElementById("btnCopyAllPlans").addEventListener("click", () => copyText(allPlansToText(), "All plans copied."));
document.getElementById("btnPrintAllPlans").addEventListener("click", () => printPlans());

/* ── AUTO-GENERATED LOGIN CREDENTIALS ─────────────────────────
   Schools don't have a username at all — there's no username
   field, and the super admin can't set or view one. Login is by
   School ID (the auto-generated public ID, e.g. SS_77_12) plus:
     • a 7-character security code (0-9, a-z) used as the password
   The code is PERMANENT — it never expires or gets regenerated.
   It's shown once right after creation in a copy-friendly modal,
   and can also be viewed any time afterwards from that school's
   details page (Manage school → Login credentials). See
   generateSecurityCode in SuperAdminController.java for the
   generation logic.
   ═════════════════════════════════════════════════════════ */

/* ── ADD SCHOOL MODAL ─────────────────────────────────────── */
let newSchoolLogoData = "";

async function openAddSchoolModal() {
  try {
    await loadPlans();
  } catch (err) {
    saToast("Couldn't load plans: " + err.message, "error");
  }
  if (!hasPlans()) {
    saToast("Create a plan first — there are no built-in plans.", "error");
    openCreatePlanModal();
    return;
  }
  document.getElementById("newSchoolName").value = "";
  document.getElementById("newSchoolPrefix").value = "";
  document.getElementById("newSchoolStudentLimit").value = "";
  document.getElementById("newSchoolStaffLimit").value = "";
  newSchoolLogoData = "";
  document.getElementById("newSchoolLogoPreview").src = "logo-icon.png";
  currentPlanId = firstPlanId();
  renderPlanCards();
  renderExtraLockOptions();

  const idPreview = document.getElementById("newSchoolIdPreview");
  idPreview.value = "Generating…";
  apiPreviewNextSchoolId()
    .then(res => { idPreview.value = res.schoolId; })
    .catch(() => { idPreview.value = "Assigned when saved"; });

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

document.getElementById("newSchoolLogoInput").addEventListener("change", async function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const input = this;
  const preview = document.getElementById("newSchoolLogoPreview");
  input.disabled = true;
  try {
    newSchoolLogoData = await compressLogoFile(file, 40);
    preview.src = newSchoolLogoData;
  } catch (err) {
    saToast("Couldn't process that image: " + err.message, "error");
    input.value = "";
  } finally {
    input.disabled = false;
  }
});

/* SECURITY: Add School is a privileged super-admin action, so every
   field is run through the shared schema validator (allow-list text
   for the name, real integer checks with sane bounds for the seat
   limits) instead of only checking "name is non-empty". Prefix
   sanitization is unchanged (still forced to A-Z, max 4 chars) since
   it feeds directly into generated student/staff IDs. */
document.getElementById("saveNewSchool").addEventListener("click", async function () {
  const btn = this;
  const nameField = document.getElementById("newSchoolName");
  const prefix = document.getElementById("newSchoolPrefix").value.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  const customLimitField = document.getElementById("newSchoolStudentLimit");
  const customStaffLimitField = document.getElementById("newSchoolStaffLimit");
  const extraLock = document.getElementById("newSchoolExtraLock").value;

  const addSchoolSchema = {
    name: SSValidate.rules.name({ required: true, maxLength: 120, label: "School name" }),
    studentLimit: SSValidate.rules.integer({ required: false, min: 1, max: 100000, label: "Student limit" }),
    staffLimit: SSValidate.rules.integer({ required: false, min: 1, max: 10000, label: "Staff limit" }),
  };
  const { ok, values, errors } = SSValidate.validate(
    {
      name: nameField.value,
      studentLimit: customLimitField.value,
      staffLimit: customStaffLimitField.value,
    },
    addSchoolSchema
  );

  if (!ok) {
    saToast(errors.name || errors.studentLimit || errors.staffLimit, "error");
    return;
  }
  if (!currentPlanId) { saToast("Please create and choose a plan first.", "error"); return; }

  const name = values.name;
  const customLimit = values.studentLimit;
  const customStaffLimit = values.staffLimit;

  // No username is generated or set here — schools log in with their
  // School ID + the auto-generated permanent security code (password).

  const plan = getPlan(currentPlanId);
  const locks = planLocks(plan).slice();
  if (extraLock && locks.indexOf(extraLock) === -1) locks.push(extraLock);

  btn.disabled = true;
  try {
    const created = await apiCreateSchool({
      name, prefix,
      planId: currentPlanId,
      studentLimit: customLimit || plan.studentLimit,
      staffLimit: customStaffLimit || plan.staffLimit,
      locks,
      logo: newSchoolLogoData
    });

    closeAddSchoolModal();
    await renderAll();
    openCredentialsModal(
      created.name, created.password,
      `${created.name} added as ${created.schoolId}.`,
      created.schoolId
    );
  } catch (err) {
    saToast("Couldn't add school: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

/* ── NEW SCHOOL CREDENTIALS MODAL ────────────────────────────
   Shown right after a school is created. Displays the School ID
   and the permanent security code, with copy buttons. There's no
   username — login is School ID + security code. This code isn't
   one-time either — it can also be viewed later from that school's
   "Manage school" page.
   ═══════════════════════════════════════════════════════════ */
function openCredentialsModal(schoolName, code, toastMsg, schoolId) {
  document.getElementById("credSchoolName").textContent = schoolName;
  document.getElementById("credSchoolId").textContent = schoolId || "—";
  document.getElementById("credSecurityCode").textContent = code;
  document.getElementById("credentialsOverlay").classList.add("open");
  if (toastMsg) saToast(toastMsg, "success");
}
function closeCredentialsModal() {
  document.getElementById("credentialsOverlay").classList.remove("open");
  document.getElementById("credSecurityCode").textContent = "— — — — — — —";
  document.getElementById("credSchoolName").textContent = "—";
  document.getElementById("credSchoolId").textContent = "—";
}
document.getElementById("closeCredentialsModal").addEventListener("click", closeCredentialsModal);

document.getElementById("copyCredCode").addEventListener("click", () => {
  copyText(document.getElementById("credSecurityCode").textContent, "Security code copied.");
});
document.getElementById("copyCredAll").addEventListener("click", () => {
  const id = document.getElementById("credSchoolId").textContent;
  const c = document.getElementById("credSecurityCode").textContent;
  copyText(`School ID: ${id}\nSecurity code: ${c}`, "School ID & security code copied.");
});

/* ── USAGE (student/staff limits) ────────────────────────────
   A school's "used" count (studentCount/staffCount) comes live
   from the server on every /schools fetch — see SchoolWithUsage
   on the backend. state:
     "ok"   → under 90% used, nothing to show
     "warn" → 90%+ used (10% or less of the limit left)
     "full" → at or over the limit
   ═══════════════════════════════════════════════════════════ */
const USAGE_WARN_PCT = 90;

function usageInfo(count, limit) {
  const c = Number(count) || 0;
  const l = Number(limit) || 0;
  if (!l) return { count: c, limit: l, pct: 0, state: "ok" };
  const pct = Math.min(100, Math.round((c / l) * 100));
  let state = "ok";
  if (c >= l) state = "full";
  else if (pct >= USAGE_WARN_PCT) state = "warn";
  return { count: c, limit: l, pct, state };
}

function usageCell(info) {
  const cls = info.state === "full" ? "danger" : info.state === "warn" ? "warn" : "";
  const icon = info.state !== "ok"
    ? `<i class="fas fa-triangle-exclamation sa-usage-alert-icon ${cls}" title="${info.state === "full" ? "Limit reached" : "Nearing limit"}"></i>`
    : "";
  return `
    <div class="sa-usage-cell">
      <div class="sa-usage-nums">${info.count} / ${info.limit || "—"} ${icon}</div>
      <div class="sa-usage-bar"><div class="sa-usage-fill ${cls}" style="width:${info.limit ? info.pct : 0}%;"></div></div>
    </div>`;
}

/** Renders the "close to limit" banner above the table, and wires clicks to open that school. */
function renderLimitAlerts() {
  const wrap = document.getElementById("limitAlertBanner");
  if (!wrap) return;

  const flagged = [];
  cachedSchools.forEach(s => {
    const stu = usageInfo(s.studentCount, s.studentLimit);
    const staff = usageInfo(s.staffCount, s.staffLimit);
    if (stu.state !== "ok") flagged.push({ school: s, type: "student", info: stu });
    if (staff.state !== "ok") flagged.push({ school: s, type: "staff", info: staff });
  });

  if (!flagged.length) { wrap.innerHTML = ""; return; }

  wrap.innerHTML = `
    <div class="sa-limit-banner">
      <div class="sa-limit-banner-head">
        <i class="fas fa-triangle-exclamation"></i>
        <span>${flagged.length} limit${flagged.length > 1 ? "s are" : " is"} close to being reached</span>
      </div>
      <div class="sa-limit-banner-list">
        ${flagged.map(item => `
          <div class="sa-limit-chip ${item.info.state === "full" ? "danger" : "warn"}" data-id="${item.school.id}">
            <i class="fas ${item.type === "student" ? "fa-user-graduate" : "fa-chalkboard-teacher"}"></i>
            <b>${item.school.name}</b>
            <span>${item.info.count}/${item.info.limit} ${item.type === "student" ? "students" : "staff"}${item.info.state === "full" ? " — full" : ""}</span>
          </div>
        `).join("")}
      </div>
    </div>`;

  wrap.querySelectorAll(".sa-limit-chip").forEach(chip => {
    chip.addEventListener("click", () => openManageSchool(chip.getAttribute("data-id")));
  });
}

/* ── SCHOOLS TABLE ────────────────────────────────────────── */
function planBadgeClass(planId) { return allPlans()[planId] ? "sa-badge-basic" : "sa-badge-blocked"; }

function schoolLogoCell(school) {
  if (school.logo) {
    return `<img class="sa-school-logo" src="${school.logo}" alt="">`;
  }
  const initial = (school.name || "?").trim().charAt(0).toUpperCase();
  return `<div class="sa-school-logo placeholder">${initial}</div>`;
}

function renderSchoolsTable(filterText) {
  const wrap = document.getElementById("schoolsTableWrap");
  let schools = cachedSchools;
  if (filterText) {
    const q = filterText.toLowerCase();
    schools = schools.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.schoolId || "").toLowerCase().includes(q)
    );
  }
  if (!schools.length) {
    wrap.innerHTML = `<div class="sa-empty"><i class="fas fa-school"></i>${cachedSchools.length ? "No schools found." : 'No schools yet — click "Add School" to onboard your first one.'}</div>`;
    return;
  }
  wrap.innerHTML = `
    <table class="sa-table">
      <thead>
        <tr>
          <th>School</th><th>School ID</th><th>Plan</th><th>Students</th><th>Staff</th><th>Registered</th><th>Expires</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${schools.map(s => {
          const plan = getPlan(s.planId);
          return `
          <tr data-id="${s.id}">
            <td>
              <div class="sa-school-cell">
                ${schoolLogoCell(s)}
                <div><div class="sa-school-name">${SSValidate.escapeHtml(s.name)}</div></div>
              </div>
            </td>
            <td><span class="sa-school-id">${SSValidate.escapeHtml(s.schoolId || "—")}</span></td>
            <td><span class="sa-badge ${planBadgeClass(s.planId)}">${plan.label}</span></td>
            <td>${usageCell(usageInfo(s.studentCount, s.studentLimit))}</td>
            <td>${usageCell(usageInfo(s.staffCount, s.staffLimit))}</td>
            <td>${fmtDate(s.registeredAt)}</td>
            <td>
              <div>${fmtDate(s.expiryDate)}</div>
              <span class="sa-badge ${expiryInfo(s).cls}" style="margin-top:4px;">${expiryInfo(s).label}</span>
            </td>
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
  const schools = cachedSchools;
  document.getElementById("statTotal").textContent = schools.length;
  document.getElementById("statActive").textContent = schools.filter(s => s.status !== "blocked").length;
  document.getElementById("statBlocked").textContent = schools.filter(s => s.status === "blocked").length;
  const revenue = schools.reduce((sum, s) => {
    if (s.status === "blocked") return sum;
    const plan = getPlan(s.planId);
    return sum + (Number(plan.price) || 0);
  }, 0);
  document.getElementById("statRevenue").textContent = "Rs " + revenue.toLocaleString();
}

/** Fetches the latest schools from the server, then repaints the table + stats. */
async function renderAll() {
  const tableWrap = document.getElementById("schoolsTableWrap");
  try {
    tableWrap.innerHTML = '<div class="sa-empty">Loading schools from server…</div>';
    cachedSchools = await apiGetSchools();
    renderStats();
    renderSchoolsTable(document.getElementById("schoolSearch").value);
    renderLimitAlerts();
  } catch (error) {
    console.error("Backend Error:", error);
    saToast("Could not load schools. Is the Java server running?", "error");
    tableWrap.innerHTML = `
      <div class="sa-empty" style="color:var(--red-600)">
        <i class="fas fa-exclamation-triangle"></i>
        Backend connection error: ${error.message}
      </div>`;
  }
}

document.getElementById("schoolSearch").addEventListener("input", function () {
  renderSchoolsTable(this.value);
});

/* ── MANAGE SCHOOL MODAL ──────────────────────────────────── */
function featureIcon(key) {
  const map = {
    students: "fa-user-graduate",
    staff: "fa-chalkboard-teacher",
    attendance: "fa-clipboard-check",
    biometric: "fa-fingerprint",
    finance: "fa-file-invoice-dollar",
    settings: "fa-cog",
    reports: "fa-chart-line",
    bform_pic: "fa-id-card",
    staff_agreement_pic: "fa-file-signature"
  };
  return map[key] || "fa-puzzle-piece";
}

function openManageSchool(id) {
  const school = getCachedSchoolById(id);
  if (!school) return;
  const schoolLocks = school.locks ? school.locks.split(",").filter(Boolean) : [];
  managingSchoolId = id;
  managingLogoData = null;
  document.getElementById("manageSchoolTitle").innerHTML = `<i class="fas fa-school"></i> ${SSValidate.escapeHtml(school.name)}`;

  const isBlocked = school.status === "blocked";
  const plans = planList();
  const planOptions = plans.length
    ? plans.map(p => `<option value="${p.id}" ${p.id === school.planId ? "selected" : ""}>${p.label} — Rs ${Number(p.price).toLocaleString()}/year</option>`).join("")
    : `<option value="">No plans created yet</option>`;
  const orphanPlan = school.planId && !allPlans()[school.planId];
  const studentUsage = usageInfo(school.studentCount, school.studentLimit);
  const staffUsage = usageInfo(school.staffCount, school.staffLimit);
  const usageHint = (info, noun) => info.state === "ok"
    ? `<p class="sa-hint">${info.count} ${noun} currently in use.</p>`
    : `<p class="sa-hint"><span class="sa-usage-alert-inline ${info.state === "full" ? "danger" : "warn"}"><i class="fas fa-triangle-exclamation"></i> ${info.state === "full" ? `Limit reached — ${info.count}/${info.limit} ${noun}` : `${info.count}/${info.limit} ${noun} used, nearing the limit`}</span></p>`;

  document.getElementById("manageSchoolBody").innerHTML = `
    <div class="sa-form-row full">
      <div class="sa-field-group">
        <label>School ID <span style="font-size:0.76rem;font-weight:400;color:var(--ink-faint);">(auto-generated, can't be edited)</span></label>
        <input type="text" value="${school.schoolId || "—"}" disabled>
      </div>
    </div>
    <div class="sa-form-row full sa-field-group">
      <div>
        <label>School name</label>
        <input type="text" id="mgName" value="${school.name.replace(/"/g, "&quot;")}">
      </div>
    </div>
    <div class="sa-form-row full sa-field-group">
      <div>
        <label>Registration prefix <span style="font-size:0.76rem;font-weight:400;color:var(--ink-faint);">(2–4 letters · used in student IDs)</span></label>
        <input type="text" id="mgPrefix" value="${(school.prefix || "").replace(/"/g, "&quot;")}" maxlength="4" placeholder="Auto from name" style="text-transform:uppercase;letter-spacing:0.08em;">
        <p class="sa-hint">Student IDs look like <strong>${school.prefix || "HRK"}_77001</strong>. Leave blank to auto-derive from school name initials.</p>
      </div>
    </div>

    <div class="sa-form-row full">
      <div class="sa-field-group">
        <label>School logo</label>
        <div class="sa-logo-upload">
          <img id="mgLogoPreview" class="sa-logo-preview" src="${school.logo || "logo-icon.png"}" alt="">
          <label class="btn-choose" for="mgLogoInput"><i class="fas fa-upload"></i> Change logo</label>
          <input type="file" id="mgLogoInput" accept="image/*">
          <button type="button" class="sa-btn-secondary" id="mgLogoRemove" style="padding:8px 14px;font-size:0.82rem;">Remove</button>
        </div>
        <p class="sa-hint">Square PNG/JPG works best. Click "Save changes" to apply.</p>
      </div>
    </div>

    <div class="sa-form-row">
      <div class="sa-field-group">
        <label>Plan</label>
        <select id="mgPlan">${planOptions}</select>
        ${orphanPlan ? `<p class="sa-hint" style="color:var(--red-600);">The plan this school was on no longer exists — pick a new one.</p>` : ""}
      </div>
      <div class="sa-field-group">
        <label>Student limit</label>
        <input type="number" id="mgStudentLimit" value="${school.studentLimit}">
        ${usageHint(studentUsage, "students")}
      </div>
    </div>

    <div class="sa-form-row">
      <div class="sa-field-group">
        <label>Staff limit</label>
        <input type="number" id="mgStaffLimit" min="1" value="${school.staffLimit || 0}">
        ${usageHint(staffUsage, "staff")}
      </div>
    </div>

    <div class="sa-validity-box ${expiryInfo(school).state}">
      <h4><i class="fas fa-calendar-check"></i> Annual plan validity</h4>
      <div class="sa-validity-grid">
        <div><small>Registered on</small><b>${fmtDate(school.registeredAt)}</b></div>
        <div><small>Expires on</small><b>${fmtDate(school.expiryDate)}</b></div>
        <div><small>Status</small><b><span class="sa-badge ${expiryInfo(school).cls}">${expiryInfo(school).label}</span></b></div>
      </div>
      <button type="button" class="sa-btn-add" id="mgRenewYear" style="margin-top:12px;"><i class="fas fa-rotate"></i> Renew for 1 more year</button>
    </div>

    <div class="sa-limits-box" style="margin-top:18px;">
      <h4><i class="fas fa-key"></i> Login credentials</h4>
      <p class="sa-hint" style="margin-top:0;margin-bottom:10px;">This school logs in with its School ID and permanent security code below — there's no username.</p>
      <div class="sa-cred-item">
        <label>School ID</label>
        <div class="sa-cred-value">
          <span id="mgCredSchoolId">${(school.schoolId || "—").replace(/"/g, "&quot;")}</span>
          <button type="button" class="sa-cred-copy-btn" id="mgCopySchoolId" title="Copy School ID"><i class="fas fa-copy"></i></button>
        </div>
      </div>
      <div class="sa-cred-item">
        <label>Security code</label>
        <div class="sa-cred-code-box">
          <span class="sa-cred-code" id="mgCredCode">${(school.password || "—").replace(/"/g, "&quot;")}</span>
          <button type="button" class="sa-cred-copy-btn" id="mgCopyCode" title="Copy security code"><i class="fas fa-copy"></i></button>
        </div>
      </div>
      <button type="button" class="sa-btn-secondary sa-cred-copy-all" id="mgCopyCredAll"><i class="fas fa-copy"></i> Copy School ID &amp; code together</button>
    </div>

    <div class="sa-limits-box" style="margin-top:18px;">
      <h4><i class="fas fa-lock"></i> Feature access — toggle ON to lock a feature for this school</h4>
      <div class="sa-lock-list">
        ${SSA.FEATURES.map(f => `
          <div class="sa-lock-row">
            <span class="name"><i class="fas ${featureIcon(f.key)}"></i>${f.label}</span>
            <label class="sa-switch">
              <input type="checkbox" class="mgLockToggle" data-feature="${f.key}" ${schoolLocks.includes(f.key) ? "checked" : ""}>
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

  document.getElementById("mgLogoInput").addEventListener("change", async function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const input = this;
    const preview = document.getElementById("mgLogoPreview");
    input.disabled = true;
    try {
      managingLogoData = await compressLogoFile(file, 40);
      preview.src = managingLogoData;
    } catch (err) {
      saToast("Couldn't process that image: " + err.message, "error");
      input.value = "";
    } finally {
      input.disabled = false;
    }
  });

  document.getElementById("mgLogoRemove").addEventListener("click", function () {
    managingLogoData = "";
    document.getElementById("mgLogoPreview").src = "logo-icon.png";
    document.getElementById("mgLogoInput").value = "";
  });

  document.getElementById("mgRenewYear").addEventListener("click", async function () {
    try {
      const s = await renewSchoolYear(managingSchoolId);
      saToast(`Renewed — new expiry ${fmtDate(s.expiryDate)}.`, "success");
      dismissedThisSession = {};
      await renderAll();
      openManageSchool(managingSchoolId);
      checkExpiries(true);
    } catch (err) {
      saToast("Couldn't renew: " + err.message, "error");
    }
  });

  document.getElementById("mgToggleBlock").addEventListener("click", async function () {
    const s = getCachedSchoolById(managingSchoolId);
    const newStatus = s.status === "blocked" ? "active" : "blocked";
    try {
      await apiSetStatus(managingSchoolId, newStatus);
      saToast(newStatus === "blocked" ? "School blocked — their data is untouched." : "School unblocked.", newStatus === "blocked" ? "error" : "success");
      await renderAll();
      openManageSchool(managingSchoolId);
    } catch (err) {
      saToast("Couldn't update status: " + err.message, "error");
    }
  });

  document.getElementById("mgCopySchoolId").addEventListener("click", () => {
    copyText(document.getElementById("mgCredSchoolId").textContent, "School ID copied.");
  });
  document.getElementById("mgCopyCode").addEventListener("click", () => {
    copyText(document.getElementById("mgCredCode").textContent, "Security code copied.");
  });
  document.getElementById("mgCopyCredAll").addEventListener("click", () => {
    const id = document.getElementById("mgCredSchoolId").textContent;
    const c = document.getElementById("mgCredCode").textContent;
    copyText(`School ID: ${id}\nSecurity code: ${c}`, "School ID & security code copied.");
  });

  document.getElementById("manageSchoolOverlay").classList.add("open");
}

function closeManageSchool() {
  document.getElementById("manageSchoolOverlay").classList.remove("open");
  managingSchoolId = null;
  managingLogoData = null;
}
document.getElementById("closeManageSchool").addEventListener("click", closeManageSchool);
document.getElementById("closeManageSchool2").addEventListener("click", closeManageSchool);
document.getElementById("manageSchoolOverlay").addEventListener("click", function (e) {
  if (e.target === this) closeManageSchool();
});

/* SECURITY: same allow-list/length-limit schema as Add School. */
document.getElementById("saveManageSchool").addEventListener("click", async function () {
  if (!managingSchoolId) return;
  const prefix = document.getElementById("mgPrefix").value.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  const planId = document.getElementById("mgPlan").value;

  const mgSchema = {
    name: SSValidate.rules.name({ required: true, maxLength: 120, label: "School name" }),
    studentLimit: SSValidate.rules.integer({ required: false, min: 1, max: 100000, label: "Student limit" }),
    staffLimit: SSValidate.rules.integer({ required: false, min: 1, max: 10000, label: "Staff limit" }),
  };
  const { ok, values, errors } = SSValidate.validate(
    {
      name: document.getElementById("mgName").value,
      studentLimit: document.getElementById("mgStudentLimit").value,
      staffLimit: document.getElementById("mgStaffLimit").value,
    },
    mgSchema
  );
  if (!ok) { saToast(errors.name || errors.studentLimit || errors.staffLimit, "error"); return; }
  if (!planId) { saToast("Create a plan first, then assign it to this school.", "error"); return; }

  const name = values.name;
  const studentLimit = values.studentLimit || getPlan(planId).studentLimit;
  const staffLimit = values.staffLimit || getPlan(planId).staffLimit;

  const locks = Array.from(document.querySelectorAll(".mgLockToggle"))
    .filter(cb => cb.checked)
    .map(cb => cb.getAttribute("data-feature"));

  const patch = { name, prefix, planId, studentLimit, staffLimit, locks };
  if (managingLogoData !== null) patch.logo = managingLogoData;

  const btn = this;
  btn.disabled = true;
  try {
    await apiUpdateSchool(managingSchoolId, patch);
    closeManageSchool();
    await renderAll();
    saToast("Changes saved.", "success");
  } catch (err) {
    saToast("Couldn't save changes: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("deleteSchoolBtn").addEventListener("click", async function () {
  if (!managingSchoolId) return;
  const school = getCachedSchoolById(managingSchoolId);
  if (!school) return;
  if (!confirm(`Delete "${school.name}"? This removes their login and registry entry (it does not touch any operational data already stored on their own device).`)) return;
  try {
    await apiDeleteSchool(managingSchoolId);
    closeManageSchool();
    await renderAll();
    saToast("School deleted.", "success");
  } catch (err) {
    saToast("Couldn't delete school: " + err.message, "error");
  }
});


/* ══════════════ CREATE PLAN ══════════════ */
function planIdFromName(name) {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "plan";
  const existing = allPlans();
  let id = base, n = 2;
  while (existing[id]) { id = base + "_" + n; n++; }
  return id;
}

function renderPlanFeatureToggles() {
  document.getElementById("planFeatureToggles").innerHTML = SSA.FEATURES.map(f => `
    <div class="sa-lock-row">
      <span class="name"><i class="fas ${featureIcon(f.key)}"></i>${f.label}</span>
      <label class="sa-switch">
        <input type="checkbox" class="planFeatureToggle" data-feature="${f.key}" checked>
        <span class="slider" style="background:var(--green-600);"></span>
      </label>
    </div>`).join("");
  document.querySelectorAll(".planFeatureToggle").forEach(cb => {
    const paint = () => { cb.nextElementSibling.style.background = cb.checked ? "var(--green-600)" : "var(--ink-faint)"; };
    paint();
    cb.addEventListener("change", paint);
  });
}

function renderExistingPlans() {
  const wrap = document.getElementById("existingPlansList");
  const plans = planList();

  if (!plans.length) {
    wrap.innerHTML = `
      <div class="sa-plans-empty">
        <i class="fas fa-layer-group"></i>
        No plans yet — there are no built-in plans. Fill the form above to create your first one.
      </div>`;
    return;
  }

  wrap.innerHTML = plans.map(p => {
    const included = SSA.FEATURES.filter(f => planLocks(p).indexOf(f.key) === -1).length;
    return `
      <div class="sa-plan-row">
        <div class="info">
          <b>${p.label}</b>
          <small>Rs ${Number(p.price).toLocaleString()}/year · up to ${p.studentLimit} students · up to ${p.staffLimit || 0} staff · ${included}/${SSA.FEATURES.length} features</small>
        </div>
        <div class="row-actions">
          <button class="icon-btn wa" data-share="${p.id}" title="Share on WhatsApp"><i class="fab fa-whatsapp"></i></button>
          <button class="icon-btn" data-copy="${p.id}" title="Copy plan details"><i class="fas fa-copy"></i></button>
          <button class="icon-btn" data-print="${p.id}" title="Print this plan"><i class="fas fa-print"></i></button>
          <button class="icon-btn danger" data-plan="${p.id}" title="Delete plan"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
  }).join("");

  wrap.querySelectorAll("[data-share]").forEach(btn => {
    btn.addEventListener("click", () => shareOnWhatsApp(planToText(getPlan(btn.getAttribute("data-share")))));
  });
  wrap.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", () => copyText(planToText(getPlan(btn.getAttribute("data-copy"))), "Plan copied."));
  });
  wrap.querySelectorAll("[data-print]").forEach(btn => {
    btn.addEventListener("click", () => printPlans(getPlan(btn.getAttribute("data-print"))));
  });
  wrap.querySelectorAll("[data-plan]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-plan");
      const inUse = cachedSchools.some(s => s.planId === id);
      if (inUse) { saToast("Some schools are still on this plan — move them first.", "error"); return; }
      btn.disabled = true;
      try {
        await apiDeletePlan(id);
        await loadPlans();
        if (currentPlanId === id) currentPlanId = firstPlanId();
        renderExistingPlans();
        renderAll();
        saToast("Plan deleted.", "success");
      } catch (err) {
        saToast("Couldn't delete plan: " + err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function openCreatePlanModal() {
  document.getElementById("newPlanName").value = "";
  document.getElementById("newPlanPrice").value = "";
  document.getElementById("newPlanLimit").value = "";
  document.getElementById("newPlanStaffLimit").value = "";
  renderPlanFeatureToggles();
  document.getElementById("createPlanOverlay").classList.add("open");
  try {
    await loadPlans();
  } catch (err) {
    saToast("Couldn't load plans: " + err.message, "error");
  }
  renderExistingPlans();
}
function closeCreatePlanModal() {
  document.getElementById("createPlanOverlay").classList.remove("open");
}

document.getElementById("btnOpenCreatePlan").addEventListener("click", openCreatePlanModal);
document.getElementById("closeCreatePlan").addEventListener("click", closeCreatePlanModal);
document.getElementById("cancelCreatePlan").addEventListener("click", closeCreatePlanModal);
document.getElementById("createPlanOverlay").addEventListener("click", function (e) {
  if (e.target === this) closeCreatePlanModal();
});

document.getElementById("saveNewPlan").addEventListener("click", async function () {
  const label = document.getElementById("newPlanName").value.trim();
  const price = parseInt(document.getElementById("newPlanPrice").value, 10);
  const limit = parseInt(document.getElementById("newPlanLimit").value, 10);
  const staffLimit = parseInt(document.getElementById("newPlanStaffLimit").value, 10);

  if (!label) { saToast("Please enter a plan name.", "error"); return; }
  if (isNaN(price) || price < 0) { saToast("Please enter the plan amount.", "error"); return; }
  if (isNaN(limit) || limit < 1) { saToast("Please enter the initial student limit.", "error"); return; }
  if (isNaN(staffLimit) || staffLimit < 1) { saToast("Please enter the initial staff limit.", "error"); return; }
  if (planList().some(p => p.label.toLowerCase() === label.toLowerCase())) {
    saToast("A plan with that name already exists.", "error"); return;
  }

  const chosen = Array.from(document.querySelectorAll(".planFeatureToggle"))
    .filter(cb => cb.checked).map(cb => cb.getAttribute("data-feature"));
  const defaultLocks = SSA.FEATURES.map(f => f.key).filter(k => chosen.indexOf(k) === -1);

  const plan = {
    id: planIdFromName(label),
    label, price, studentLimit: limit,
    staffLimit,
    features: chosen,
    defaultLocks,
    custom: true
  };

  const btn = this;
  btn.disabled = true;
  try {
    await apiCreatePlan(planToServerShape(plan));
    await loadPlans();
    if (!currentPlanId) currentPlanId = plan.id;
    renderExistingPlans();
    renderPlanFeatureToggles();
    document.getElementById("newPlanName").value = "";
    document.getElementById("newPlanPrice").value = "";
    document.getElementById("newPlanLimit").value = "";
    document.getElementById("newPlanStaffLimit").value = "";
    renderAll();
    saToast(`Plan "${plan.label}" created.`, "success");
  } catch (err) {
    saToast("Couldn't create plan: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
});


/* ══════════════ VIEW & MANAGE PLANS (edit / delete) ══════════════ */
let editingPlanId = null;

async function openManagePlansModal() {
  editingPlanId = null;
  try {
    await loadPlans();
  } catch (err) {
    saToast("Couldn't load plans: " + err.message, "error");
  }
  renderManagePlansList();
  document.getElementById("managePlansOverlay").classList.add("open");
}
function closeManagePlansModal() {
  document.getElementById("managePlansOverlay").classList.remove("open");
  editingPlanId = null;
}

function renderManagePlansList() {
  document.getElementById("managePlansTitle").innerHTML = `<i class="fas fa-layer-group"></i> View & manage plans`;
  document.getElementById("managePlansFoot").innerHTML = `
    <button class="sa-btn-secondary" id="closeManagePlans2">Close</button>`;
  document.getElementById("closeManagePlans2").addEventListener("click", closeManagePlansModal);

  const body = document.getElementById("managePlansBody");
  const plans = planList();

  if (!plans.length) {
    body.innerHTML = `
      <div class="sa-plans-empty">
        <i class="fas fa-layer-group"></i>
        No plans yet — create one first from the "Create Plan" button.
      </div>`;
    return;
  }

  body.innerHTML = plans.map(p => {
    const included = SSA.FEATURES.filter(f => planLocks(p).indexOf(f.key) === -1).length;
    return `
      <div class="sa-plan-row">
        <div class="info">
          <b>${p.label}</b>
          <small>Rs ${Number(p.price).toLocaleString()}/year · up to ${p.studentLimit} students · up to ${p.staffLimit || 0} staff · ${included}/${SSA.FEATURES.length} features</small>
        </div>
        <div class="row-actions">
          <button class="icon-btn" data-edit="${p.id}" title="Edit plan"><i class="fas fa-pen"></i></button>
          <button class="icon-btn danger" data-delete="${p.id}" title="Delete plan"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
  }).join("");

  body.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => renderManagePlanEditForm(btn.getAttribute("data-edit")));
  });
  body.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-delete");
      const inUse = cachedSchools.some(s => s.planId === id);
      if (inUse) { saToast("Some schools are still on this plan — move them first.", "error"); return; }
      const plan = getPlan(id);
      if (!confirm(`Delete the plan "${plan.label}"? This cannot be undone.`)) return;
      btn.disabled = true;
      try {
        await apiDeletePlan(id);
        await loadPlans();
        if (currentPlanId === id) currentPlanId = firstPlanId();
        renderManagePlansList();
        renderAll();
        saToast("Plan deleted.", "success");
      } catch (err) {
        saToast("Couldn't delete plan: " + err.message, "error");
        btn.disabled = false;
      }
    });
  });
}

function renderManagePlanEditForm(planId) {
  const plan = getPlan(planId);
  editingPlanId = planId;

  document.getElementById("managePlansTitle").innerHTML = `<i class="fas fa-pen"></i> Edit "${plan.label}"`;

  const body = document.getElementById("managePlansBody");
  body.innerHTML = `
    <div class="sa-form-row full sa-field-group">
      <div>
        <label>Plan name</label>
        <input type="text" id="editPlanName" value="${plan.label.replace(/"/g, "&quot;")}">
      </div>
    </div>
    <div class="sa-form-row">
      <div class="sa-field-group">
        <label>Amount (Rs / year — annual plan)</label>
        <input type="number" id="editPlanPrice" min="0" value="${plan.price}">
      </div>
      <div class="sa-field-group">
        <label>Student limit</label>
        <input type="number" id="editPlanLimit" min="1" value="${plan.studentLimit}">
      </div>
    </div>
    <div class="sa-form-row">
      <div class="sa-field-group">
        <label>Staff limit</label>
        <input type="number" id="editPlanStaffLimit" min="1" value="${plan.staffLimit || 0}">
      </div>
    </div>
    <div class="sa-limits-box">
      <h4><i class="fas fa-unlock"></i> Features included in this plan — toggle ON to include</h4>
      <div class="sa-lock-list" id="editPlanFeatureToggles"></div>
      <p class="sa-hint" style="color:var(--red-600);"><i class="fas fa-triangle-exclamation"></i> Saving applies the student limit, staff limit, and locked features here to <strong>every school currently on this plan</strong> right away, overriding any per-school customizations they had.</p>
    </div>`;

  document.getElementById("editPlanFeatureToggles").innerHTML = SSA.FEATURES.map(f => {
    const isOn = planLocks(plan).indexOf(f.key) === -1;
    return `
    <div class="sa-lock-row">
      <span class="name"><i class="fas ${featureIcon(f.key)}"></i>${f.label}</span>
      <label class="sa-switch">
        <input type="checkbox" class="editPlanFeatureToggle" data-feature="${f.key}" ${isOn ? "checked" : ""}>
        <span class="slider" style="background:${isOn ? "var(--green-600)" : "var(--ink-faint)"};"></span>
      </label>
    </div>`;
  }).join("");
  document.querySelectorAll(".editPlanFeatureToggle").forEach(cb => {
    const paint = () => { cb.nextElementSibling.style.background = cb.checked ? "var(--green-600)" : "var(--ink-faint)"; };
    cb.addEventListener("change", paint);
  });

  document.getElementById("managePlansFoot").innerHTML = `
    <button class="sa-btn-secondary" id="cancelEditPlan">Back</button>
    <button class="sa-btn-add" id="saveEditPlan"><i class="fas fa-check"></i> Save changes</button>`;

  document.getElementById("cancelEditPlan").addEventListener("click", () => renderManagePlansList());

  document.getElementById("saveEditPlan").addEventListener("click", async function () {
    const label = document.getElementById("editPlanName").value.trim();
    const price = parseInt(document.getElementById("editPlanPrice").value, 10);
    const limit = parseInt(document.getElementById("editPlanLimit").value, 10);
    const staffLimit = parseInt(document.getElementById("editPlanStaffLimit").value, 10);

    if (!label) { saToast("Please enter a plan name.", "error"); return; }
    if (isNaN(price) || price < 0) { saToast("Please enter the plan amount.", "error"); return; }
    if (isNaN(limit) || limit < 1) { saToast("Please enter the student limit.", "error"); return; }
    if (isNaN(staffLimit) || staffLimit < 1) { saToast("Please enter a valid staff limit.", "error"); return; }
    if (planList().some(p => p.id !== editingPlanId && p.label.toLowerCase() === label.toLowerCase())) {
      saToast("A plan with that name already exists.", "error"); return;
    }

    const chosen = Array.from(document.querySelectorAll(".editPlanFeatureToggle"))
      .filter(cb => cb.checked).map(cb => cb.getAttribute("data-feature"));
    const defaultLocks = SSA.FEATURES.map(f => f.key).filter(k => chosen.indexOf(k) === -1);

    const updated = {
      id: editingPlanId,
      label, price, studentLimit: limit,
      staffLimit,
      defaultLocks
    };

    const affectedCount = cachedSchools.filter(s => s.planId === editingPlanId).length;
    if (affectedCount > 0 && !confirm(
      `This plan is used by ${affectedCount} school${affectedCount === 1 ? "" : "s"}. Saving will immediately apply this student limit and these locked features to ${affectedCount === 1 ? "that school" : "all of them"}, overriding any per-school customization. Continue?`
    )) {
      return;
    }

    const btn = this;
    btn.disabled = true;
    try {
      await apiUpdatePlan(editingPlanId, planToServerShape(updated));
      await loadPlans();
      await renderAll();
      saToast(
        affectedCount > 0
          ? `Plan "${label}" updated — applied to ${affectedCount} school${affectedCount === 1 ? "" : "s"}.`
          : `Plan "${label}" updated.`,
        "success"
      );
      renderManagePlansList();
    } catch (err) {
      saToast("Couldn't save changes: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}

document.getElementById("btnOpenManagePlans").addEventListener("click", openManagePlansModal);
document.getElementById("closeManagePlans").addEventListener("click", closeManagePlansModal);
document.getElementById("managePlansOverlay").addEventListener("click", function (e) {
  if (e.target === this) closeManagePlansModal();
});

/* ══════════════════════════════════════════════════════════
   EXPIRY REMINDER — SUPER ADMIN
   Pops up continuously (every few minutes) starting one month
   before any school's annual plan expires, and keeps popping
   after it has expired until you renew.
   ══════════════════════════════════════════════════════════ */
let dismissedThisSession = {};
const EXPIRY_RECHECK_MS = 3 * 60 * 1000; // keep reminding every 3 minutes

function expiringSchools() {
  return cachedSchools
    .map(s => ({ school: s, info: expiryInfo(s) }))
    .filter(x => x.info.state === "warn" || x.info.state === "expired")
    .sort((a, b) => (a.info.days || 0) - (b.info.days || 0));
}

function buildExpiryModal() {
  if (document.getElementById("saExpiryOverlay")) return;
  const el = document.createElement("div");
  el.className = "sa-modal-overlay sa-expiry-overlay";
  el.id = "saExpiryOverlay";
  el.innerHTML = `
    <div class="sa-modal sa-expiry-modal">
      <div class="sa-modal-head">
        <h2><i class="fas fa-triangle-exclamation"></i> Plans expiring soon</h2>
        <button class="sa-modal-close" id="saExpiryClose"><i class="fas fa-times"></i></button>
      </div>
      <div class="sa-modal-body" id="saExpiryBody"></div>
      <div class="sa-modal-foot">
        <button class="sa-btn-secondary" id="saExpiryRemind">Remind me later</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  document.getElementById("saExpiryClose").addEventListener("click", closeExpiryModal);
  document.getElementById("saExpiryRemind").addEventListener("click", closeExpiryModal);
}
function closeExpiryModal() {
  const el = document.getElementById("saExpiryOverlay");
  if (el) el.classList.remove("open");
}

function checkExpiries(force) {
  const list = expiringSchools();
  if (!list.length) { closeExpiryModal(); return; }

  // Don't stack on top of a modal you're actively working in.
  const busy = ["addSchoolOverlay", "manageSchoolOverlay", "createPlanOverlay", "managePlansOverlay"]
    .some(id => document.getElementById(id).classList.contains("open"));
  if (busy && !force) return;

  buildExpiryModal();
  document.getElementById("saExpiryBody").innerHTML = `
    <p class="sa-hint" style="margin-bottom:14px;font-size:0.88rem;">
      These schools are within one month of their annual plan expiry. Renew them to keep their access running.
    </p>
    ${list.map(({ school, info }) => `
      <div class="sa-expiry-row ${info.state}">
        <div class="info">
          <b>${school.name}</b>
          <small>${school.schoolId || "—"} · ${getPlan(school.planId).label} · expires ${fmtDate(school.expiryDate)}</small>
        </div>
        <div class="right">
          <span class="sa-badge ${info.cls}">${info.label}</span>
          <button class="sa-mini-btn" data-renew="${school.id}"><i class="fas fa-rotate"></i> Renew 1 year</button>
        </div>
      </div>`).join("")}
  `;
  document.querySelectorAll("#saExpiryBody [data-renew]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-renew");
      try {
        const s = await renewSchoolYear(id);
        saToast(`${s.name} renewed till ${fmtDate(s.expiryDate)}.`, "success");
        await renderAll();
        checkExpiries(true);
      } catch (err) {
        saToast("Couldn't renew: " + err.message, "error");
      }
    });
  });
  document.getElementById("saExpiryOverlay").classList.add("open");
}

function startExpiryWatcher() {
  setTimeout(() => checkExpiries(false), 800);
  setInterval(() => checkExpiries(false), EXPIRY_RECHECK_MS);
}

/* ── BOOT (runs last so all consts are initialized) ──
   Gated behind admin auth: if there's no valid session token yet, show
   the login form instead of loading any data. initSuperAdminApp() is
   called either immediately below (token already present, e.g. same
   tab/session) or after a successful login (see showAdminLoginGate). */
async function initSuperAdminApp() {
  document.getElementById("saApp").classList.add("show");
  try {
    await loadPlans();
  } catch (err) {
    if (err && /session expired/i.test(err.message)) return; // already redirected to login
    saToast("Couldn't load plans from server: " + err.message, "error");
  }
  await renderAll();
  startExpiryWatcher();
}

if (getAdminToken()) {
  initSuperAdminApp();
} else {
  showAdminLoginGate();
}