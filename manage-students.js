/**
 * ============================================================================
 * EDULOW PRO v2.0 - CORE STUDENT MANAGEMENT SYSTEM ENGINE
 * ============================================================================
 * Developed for: St. Lawrence International School
 * Module: Student Information System (SIS)
 *
 * Features
 * 1. Intelligent CRUD (Create, Read, Update, Delete)
 * 2. Real-time Age & Financial Calculations
 * 3. Base64 Image Processing for Photos & Documents
 * 4. Advanced Search & Filtering
 * 5. Data Persistence via LocalStorage
 * 6. Responsive UI Controllers & Modal Architecture
 * 7. Sibling Detection & Shared Sibling-Group IDs
 * ============================================================================
 *
 * ID SYSTEM EXPLANATION
 * ─────────────────────
 * Every student gets TWO identifiers:
 *
 *   regNo  →  PREFIX_X  (e.g. PSC_1, PSC_2, PSC_3 …) — PREFIX is whatever
 *             prefix Super Admin set for this school (falls back to "HRK"
 *             only when no school is logged in at all).
 *             Sequential, unique per student, assigned at registration.
 *             This is what appears in the MAIN TABLE and on the profile header.
 *
 *   id     →  For independent students : same as regNo  (PREFIX_X)
 *             For sibling students      : shared sibling-group code (00X)
 *
 * SIBLING-GROUP ID (stored as `id` on sibling records):
 *   - ALL members of the same family share ONE sibling-group code.
 *   - Format: 00X  where X is a sequential group counter (001, 002 …)
 *   - The group code is generated ONCE when the first sibling is detected
 *     and reused for every subsequent sibling added to that family.
 *   - The original (first-registered) student also gets their id updated
 *     to the same group code so everyone is linked symmetrically.
 *
 * DISPLAYED "SIBLING OF" STRING:
 *   Every member shows all OTHER members' first names, e.g.
 *   "Sibling of Muhammad Tahir, Timur and Aman"
 *   This string is re-computed and written back to ALL family members
 *   each time a new sibling joins the group.
 *
 * WHAT SHOWS WHERE:
 *   Main table   → regNo badge (PREFIX_X) for every student
 *   Full profile → regNo badge in header  +  Sibling ID (00X) in details
 *                  +  "Sibling of …" list for every family member
 * ============================================================================
 */

let API_STUDENTS = [];

"use strict";

// ============================================================================
// ⚙️  SETTINGS — CLASS / SECTION / FEE / FUND CONFIGURATION
// ----------------------------------------------------------------------------
// All class structure, sections, monthly tuition, and annual fund values
// are now managed centrally on the Settings page (settings.html).
// They are persisted in localStorage under the key `edu_class_configs` and
// read here at runtime so the admission form always stays in sync.
//
// The helpers below provide safe defaults if settings have never been saved.
// ============================================================================
const SETTINGS_CLASSES_KEY = 'edu_class_configs';

// Sentinel value for the "All Students" master card in the View / Edit
// class-card selectors — means "no class filter applied".
const ALL_STUDENTS_KEY = '__ALL__';

const DEFAULT_CLASS_CONFIGS = [
    { name: 'Montessori', fee: 3000, fund: 2000, sections: ['A', 'B'] },
    { name: 'Nursery',    fee: 3500, fund: 2000, sections: ['A', 'B'] },
    { name: 'Prep',       fee: 4000, fund: 2000, sections: ['A', 'B'] },
    { name: 'Grade 1',    fee: 4500, fund: 2000, sections: ['A', 'B'] },
    { name: 'Grade 2',    fee: 4800, fund: 2000, sections: ['A', 'B'] },
];

/** Read class configs from settings page (localStorage), with fallback. */
function getClassConfigs() {
    try {
        const raw = localStorage.getItem(SETTINGS_CLASSES_KEY);
        const arr = raw ? JSON.parse(raw) : null;
        if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) { /* ignore */ }
    return DEFAULT_CLASS_CONFIGS;
}

/** Build a quick lookup map: { [className]: configObject } */
function getClassConfigMap() {
    const map = {};
    getClassConfigs().forEach(c => { if (c && c.name) map[c.name] = c; });
    return map;
}

/** Lookup standard tuition fee for a given class. */
function getStandardFeeForClass(className) {
    const c = getClassConfigMap()[className];
    return c ? Number(c.fee) || 0 : 0;
}

/** Lookup annual fund amount for a given class (falls back to first class's fund). */
function getAnnualFundForClass(className) {
    const map = getClassConfigMap();
    if (className && map[className] && map[className].fund != null) {
        return Number(map[className].fund) || 0;
    }
    const first = getClassConfigs()[0];
    return first ? Number(first.fund) || 0 : 0;
}

// Back-compat shims (read live from settings each access)
const CLASS_STANDARD_FEES = new Proxy({}, {
    get: (_t, prop) => getStandardFeeForClass(prop),
    has: (_t, prop) => prop in getClassConfigMap(),
});
// ANNUAL_FUND_AMOUNT is now resolved per-class via getAnnualFundForClass().
// Kept as a getter for any legacy reads (returns the first class's fund).
const ANNUAL_FUND_AMOUNT = getAnnualFundForClass();

// --- GLOBAL STATE & CONFIGURATION ---
const DB_KEY        = 'edu_students';
const SIBLING_PREFIX = '00';       // prefix for sibling-group IDs

// ── BACKEND API CONFIG ──────────────────────────────────────────────────
// Spring Boot backend — StudentController.java exposes CRUD under this base.
const API_BASE = 'http://localhost:8080/api/students';

/**
 * Derive a short registration prefix from the logged-in school's name.
 * e.g. school prefix "PSC" set in Super Admin → "PSC_"  (so IDs read PSC_1, PSC_2, PSC_3 …)
 * Falls back to "HRK_" when no school session exists (demo / superadmin mode).
 *
 * IMPORTANT: this is re-read from the school's session/record every time the
 * page loads, so whatever prefix Super Admin has set for THIS school is what
 * gets used — it is never hardcoded to "HRK".
 */
function getSchoolPrefix() {
    if (window.SoftSchoolAdmin) {
        const school = window.SoftSchoolAdmin.getCurrentSchool();
        if (school) {
            // 1. Use the custom prefix set by superadmin (stored on the school record)
            if (school.prefix && school.prefix.trim().length > 0) {
                return school.prefix.trim().toUpperCase() + '_';
            }
            // 2. Derive from school name initials if no prefix was set
            if (school.name) {
                const words = school.name.trim().split(/[\s\.\-\/]+/);
                const initials = words
                    .filter(w => w.length > 0 && /[A-Za-z]/.test(w[0]))
                    .map(w => w[0].toUpperCase())
                    .join('');
                return (initials.slice(0, 4) || 'SCH') + '_';
            }
        }
    }
    return 'HRK_'; // final fallback (demo / superadmin mode, no school logged in)
}
const SYSTEM_PREFIX = getSchoolPrefix();

/**
 * The logged-in school's real School ID (School.schoolId, e.g. "SS_77_1") —
 * NOT the display prefix above. StudentController scopes every read/write by
 * this value (schools only ever see their own students), so every call to
 * the backend API must send it. Returns '' when no school session exists
 * (demo / superadmin mode) — callers should treat that as "can't sync yet".
 */
function getCurrentSchoolId() {
    if (window.SoftSchoolAdmin) {
        const school = window.SoftSchoolAdmin.getCurrentSchool();
        if (school && school.schoolId) return school.schoolId;
    }
    return '';
}

/**
 * Read the logged-in school's logo (Base64 data URL, set in Super Admin →
 * school → "School logo") for use in print-ready documents that build their
 * own standalone HTML (Admission Form, Student Record, Student List Report).
 * These pages open in a brand-new window via window.open()/document.write(),
 * so they can't rely on the .school-branding logo already injected into the
 * live page by access-control.js — each one needs its own copy of the URL.
 * Returns '' when no school is logged in / no logo was uploaded, so callers
 * can fall back to the default icon crest.
 */
function getSchoolLogoUrl() {
    try {
        if (window.SoftSchoolAdmin) {
            const school = window.SoftSchoolAdmin.getCurrentSchool();
            if (school && school.logo) return school.logo;
        }
    } catch (e) { /* ignore — fall back to icon */ }
    return '';
}

/** Escape a string for safe use inside a RegExp (prefix may contain odd chars). */
function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Orphan filter state — declared at top-level (script) scope, NOT inside the
// DOMContentLoaded closure below, because toggleUpdOrphanFilter/toggleVoOrphanFilter
// are defined later in this file OUTSIDE that closure and need to read/write
// these same bindings. Declaring them inside the closure caused
// "ReferenceError: voOrphanFilterActive is not defined" when the buttons were clicked.
let updOrphanFilterActive = false;
let voOrphanFilterActive = false;

document.addEventListener('DOMContentLoaded', () => {

    // UI References: Navigation & Layout
    const sidebar        = document.getElementById('sidebar');
    const openSidebarBtn = document.getElementById('open-sidebar');
    const closeSidebarBtn= document.getElementById('close-sidebar');

    // UI References: Admission Form Elements
    const admissionForm    = document.getElementById('student-admission-form');
    const editIdHidden     = document.getElementById('edit-student-id');
    const previewImg       = document.getElementById('student-img-preview');
    const studentPhotoInput= document.getElementById('student-photo');
    const certUploadInput  = document.getElementById('cert-upload');
    const certDataHidden   = document.getElementById('cert-data');
    const studentPhotoError= document.getElementById('student-photo-error');
    const certUploadError  = document.getElementById('cert-upload-error');

    // UI References: Form Inputs for Calculation
    const dobInput         = document.getElementById('student-dob');
    const ageInput         = document.getElementById('student-age');
    const admissionDateInput=document.getElementById('admission-date');
    const rollNoInput      = document.getElementById('roll-no-input');
    const displayRegBadge  = document.getElementById('display-reg-no');

    // UI References: Finance
    const feeStandard      = document.getElementById('fee-standard');
    const feeAdmission     = document.getElementById('fee-admission');
    const feeTuitionDisc   = document.getElementById('fee-discount-tuition');
    const feeTransDisc     = document.getElementById('fee-discount-transport');
    const feeSiblingDisc   = document.getElementById('fee-discount-sibling');
    const transportFeeInput= document.querySelector('input[name="transportFee"]');
    const netTotalInput    = document.getElementById('fee-net-total');

    // UI References: Address & Logic
    const permAddress    = document.getElementById('perm-address');
    const mailAddress    = document.getElementById('mail-address');
    const copyAddressBtn = document.getElementById('copy-address-btn');
    const lifetimeCheck  = document.getElementById('is-lifetime');
    const expiryGroup    = document.getElementById('expiry-date-group');

    // UI References: Search
    const searchName   = document.getElementById('search-name');
    const searchFather  = document.getElementById('search-father');
    const searchClass   = document.getElementById('search-class');
    const searchId      = document.getElementById('search-id');

    // UI References: Books & Other Fees
    const takeBooksBtn   = document.getElementById('take-books-btn');
    const booksFeePanel  = document.getElementById('books-fee-panel');
    const feeBooks       = document.getElementById('fee-books');
    const feeBooksDisc   = document.getElementById('fee-books-discount');
    const addOtherFeeBtn = document.getElementById('add-other-fee-btn');
    const otherFeesContainer = document.getElementById('other-fees-container');
    const otherFeesDataHidden= document.getElementById('other-fees-data');

    // UI References: Annual Fund
    const annualFundEnabled = document.getElementById('annual-fund-enabled');
    const annualFundPanel   = document.getElementById('annual-fund-panel');
    const annualFundAmount  = document.getElementById('annual-fund-amount');

    // (Orphan filter state now declared at top-level scope — see above)

    // Plan-enforcement constants (used by renderPlanLimitBanners/checkExpiry,
    // called from updateDashboardStats() below during initial page load) —
    // declared here, before that first call, so they're not still in the
    // temporal dead zone when referenced. They used to live further down
    // near the plan-enforcement block, which is fine for function
    // declarations (hoisted) but NOT for const/let: those stay unusable
    // until the line that declares them actually runs.
    /** How many free slots remain before the "getting close to the limit" warning shows. */
    const LIMIT_WARNING_THRESHOLD = 5;
    /** Days before School.expiryDate the blinking subscription badge starts showing. */
    const EXPIRY_WARNING_DAYS = 30;

    // ── 1. CORE SYSTEM INITIALIZATION ───────────────────────────────────────

    // Ensure orphan-filter buttons always start in a known, inactive visual
    // state on page load, regardless of any leftover markup/classes.
    updOrphanFilterActive = false;
    voOrphanFilterActive = false;
    ['upd-orphan-filter-btn', 'vo-orphan-filter-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.remove('active-filter');
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
    });

    if (admissionDateInput) admissionDateInput.valueAsDate = new Date();
    updateDashboardStats();

    // Pull the live roster from MySQL as soon as the page loads, so the
    // tables/dashboard reflect the database instead of a stale local cache.
    syncWithBackend();

    // ── THEME TOGGLE ─────────────────────────────────────────────────────────
    (function initTheme() {
        const toggleBtn = document.getElementById('theme-toggle');
        const root = document.documentElement;
        const savedTheme = localStorage.getItem('eduflow-theme') || 'dark';
        root.setAttribute('data-theme', savedTheme);
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const current = root.getAttribute('data-theme');
                const next = current === 'dark' ? 'light' : 'dark';
                root.setAttribute('data-theme', next);
                localStorage.setItem('eduflow-theme', next);
            });
        }
    })();

    // ── HEADER DATE ──────────────────────────────────────────────────────────
    (function initDate() {
        const dateEl = document.getElementById('header-date');
        if (dateEl) {
            const now = new Date();
            const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
            dateEl.textContent = now.toLocaleDateString('en-US', options);
        }
    })();

    // ── 2. SIDEBAR & NAVIGATION CONTROLS ────────────────────────────────────

    // Create overlay for sidebar
    const sidebarOverlay = document.createElement('div');
    sidebarOverlay.className = 'sidebar-overlay';
    document.body.appendChild(sidebarOverlay);

    function closeSidebar() {
        sidebar.classList.remove('active');
        sidebarOverlay.classList.remove('active');
    }

    if (openSidebarBtn)  openSidebarBtn.addEventListener ('click', () => {
        sidebar.classList.add('active');
        sidebarOverlay.classList.add('active');
    });
    if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);

    // ── 3. MODAL ARCHITECTURE ────────────────────────────────────────────────

    window.openModal = function(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        if (modalId === 'student-modal') {
            const isEdit = editIdHidden.value !== "";
            if (!isEdit && !canAdmitNewStudent()) {
                showToast("Limit Reached", `Your plan allows up to ${getStudentLimit()} active students. Upgrade your plan to register more.`, "danger");
                return;
            }
            if (!isEdit) {
                admissionForm.reset();
                editIdHidden.value = "";
                previewImg.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJQAAACUCAYAAAB1Va3RAAAACXBIWXMAAAsTAAALEwEAmpwYAAADu0lEQVR4nO3dy0pUYRSG4f9mZpYjSclS0DSIIAsZonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXonmZInoXInoXf6S/8AvW7ZicAAAAASUVORK5CYII=";
                document.getElementById('form-modal-title').innerHTML =
                    '<i class="fas fa-user-plus"></i> Student Admission Entry';
                document.getElementById('form-submit-btn').innerText = 'Finalize Admission';

                const nextRegNo = generateNextRegistrationNumber();
                rollNoInput.value = '—';
                displayRegBadge.innerText = nextRegNo;
                admissionForm.dataset.pendingRegNo = nextRegNo;

                // New admission — never a sibling badge to show yet
                const newSiblingBadge = document.getElementById('edit-sibling-badge');
                if (newSiblingBadge) { newSiblingBadge.style.display = 'none'; newSiblingBadge.innerHTML = ''; }

                if (booksFeePanel) {
                    booksFeePanel.style.display = 'none';
                    if (takeBooksBtn) takeBooksBtn.innerHTML = '<i class="fas fa-book"></i> Take Books';
                }
                resetOtherFeesUI([]);

                // Reset annual fund
                if (annualFundEnabled) {
                    annualFundEnabled.checked = false;
                    if (annualFundPanel) annualFundPanel.style.display = 'none';
                    if (annualFundAmount) annualFundAmount.value = ANNUAL_FUND_AMOUNT;
                }
            }
        }

        if (modalId === 'view-modal') {
            // Clear hidden search inputs (kept for backward compat)
            [searchName, searchFather, searchClass, searchId].forEach(inp => {
                if (inp) inp.value = '';
            });
            // Clear the new unified search bar
            const updSearch = document.getElementById('upd-search-input');
            if (updSearch) updSearch.value = '';
            // Always re-open on the class-cards stage
            updActiveClass = null;
            updActiveSection = null;
            updOrphanFilterActive = false;
            const updOrphanBtn = document.getElementById('upd-orphan-filter-btn');
            if (updOrphanBtn) {
                updOrphanBtn.classList.remove('active-filter');
                updOrphanBtn.setAttribute('aria-pressed', 'false');
                updOrphanBtn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
            }
            updRenderClassCards();
            updShowStage('classes');
        }

        if (modalId === 'view-only-modal') {
            const searchEl = document.getElementById('vo-search-name');
            if (searchEl) searchEl.value = '';
            // Always re-open on the class-cards stage
            voActiveClass = null;
            voActiveSection = null;
            voOrphanFilterActive = false;
            const voOrphanBtn = document.getElementById('vo-orphan-filter-btn');
            if (voOrphanBtn) {
                voOrphanBtn.classList.remove('active-filter');
                voOrphanBtn.setAttribute('aria-pressed', 'false');
                voOrphanBtn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
            }
            voRenderClassCards();
            voShowStage('classes');
        }

        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    };

    window.closeModal = function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
            if (modalId === 'student-modal') {
                editIdHidden.value = "";
            }
        }
    };

    // ── 4. FORM LOGIC & CALCULATION ENGINES ──────────────────────────────────

    function calculateAge(dobString) {
        if (!dobString) return "";
        const dob   = new Date(dobString);
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
        return age >= 0 ? age + " Years" : "Invalid Date";
    }

    if (dobInput) {
        dobInput.addEventListener('change', () => {
            ageInput.value = calculateAge(dobInput.value);
        });
    }

    function getOtherFeesTotal() {
        try {
            const rows = JSON.parse(otherFeesDataHidden.value || '[]');
            return rows.reduce((sum, r) => sum + ((parseFloat(r.amount) || 0) - (parseFloat(r.discount) || 0)), 0);
        } catch (e) { return 0; }
    }

    function performFinancialAudit() {
        const v = el => (el && el.value !== undefined) ? (parseFloat(el.value) || 0) : 0;
        const standard     = v(feeStandard);
        const admission    = v(feeAdmission);
        const tDisc        = v(feeTuitionDisc);
        const trDisc       = v(feeTransDisc);
        const sibDisc      = v(feeSiblingDisc);
        const monthlyTrans = v(transportFeeInput);
        // NOTE: Books fee and Other fees are intentionally excluded from the
        // database net total — they appear only on the voucher at print time.
        const netTotal = (standard + admission + monthlyTrans) - (tDisc + trDisc + sibDisc);
        if (netTotalInput) netTotalInput.value = Math.max(0, netTotal).toFixed(0);
    }

    [feeStandard, feeAdmission, feeTuitionDisc, feeTransDisc, feeSiblingDisc, transportFeeInput, feeBooks, feeBooksDisc].forEach(el => {
        if (el) el.addEventListener('input', performFinancialAudit);
    });

    // ── TAKE BOOKS TOGGLE ────────────────────────────────────────────────────
    if (takeBooksBtn) {
        takeBooksBtn.addEventListener('click', () => {
            const isHidden = booksFeePanel.style.display === 'none' || booksFeePanel.style.display === '';
            booksFeePanel.style.display = isHidden ? 'grid' : 'none';
            takeBooksBtn.innerHTML = isHidden
                ? '<i class="fas fa-book-open"></i> Hide Books Fee'
                : '<i class="fas fa-book"></i> Take Books';
            performFinancialAudit();
        });
    }

    // ── OTHER FEES: DYNAMIC ROWS ─────────────────────────────────────────────

    function readOtherFeesFromDOM() {
        const rows = [];
        if (!otherFeesContainer) return rows;
        otherFeesContainer.querySelectorAll('.other-fee-row').forEach(rowEl => {
            rows.push({
                description: rowEl.querySelector('.other-fee-desc').value || '',
                amount:      rowEl.querySelector('.other-fee-amount').value || 0,
                discount:    rowEl.querySelector('.other-fee-discount').value || 0
            });
        });
        return rows;
    }

    function syncOtherFeesHidden() {
        otherFeesDataHidden.value = JSON.stringify(readOtherFeesFromDOM());
        performFinancialAudit();
    }

    function addOtherFeeRow(data = { description: '', amount: 0, discount: 0 }) {
        if (!otherFeesContainer) return;
        const row = document.createElement('div');
        row.className = 'other-fee-row';
        row.style.cssText = 'display:grid; grid-template-columns: 2fr 1fr 1fr auto; gap:12px; align-items:end; background:#f8fafc; padding:14px; border-radius:10px; border:1px solid var(--border-color);';
        row.innerHTML = `
            <div class="form-input-group">
                <label>Description</label>
                <input type="text" class="other-fee-desc" placeholder="e.g. Lab Fee" value="${data.description || ''}">
            </div>
            <div class="form-input-group">
                <label>Amount</label>
                <input type="number" class="other-fee-amount" value="${data.amount || 0}">
            </div>
            <div class="form-input-group">
                <label>Discount</label>
                <input type="number" class="other-fee-discount" value="${data.discount || 0}">
            </div>
            <button type="button" class="btn-icon delete remove-other-fee" title="Remove"><i class="fas fa-trash-alt"></i></button>
        `;
        otherFeesContainer.appendChild(row);

        row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', syncOtherFeesHidden));
        row.querySelector('.remove-other-fee').addEventListener('click', () => {
            row.remove();
            syncOtherFeesHidden();
        });
    }

    if (addOtherFeeBtn) {
        addOtherFeeBtn.addEventListener('click', () => addOtherFeeRow());
    }

    function resetOtherFeesUI(rows = []) {
        if (!otherFeesContainer) return;
        otherFeesContainer.innerHTML = '';
        rows.forEach(r => addOtherFeeRow(r));
        otherFeesDataHidden.value = JSON.stringify(rows);
    }

    if (copyAddressBtn) {
        copyAddressBtn.addEventListener('click', () => {
            mailAddress.value = permAddress.value;
            showToast("Address Synced", "Mailing address updated to match permanent address.", "info");
        });
    }

    if (lifetimeCheck) {
        lifetimeCheck.addEventListener('change', function() {
            expiryGroup.style.opacity      = this.checked ? "0.4" : "1";
            expiryGroup.style.pointerEvents= this.checked ? "none" : "all";
        });
    }

    // ── ANNUAL FUND TOGGLE ───────────────────────────────────────────────────
    if (annualFundEnabled) {
        annualFundEnabled.addEventListener('change', function() {
            annualFundPanel.style.display = this.checked ? 'block' : 'none';
        });
    }

    // ── CLASS / SECTION DROPDOWNS — POPULATED FROM SETTINGS ─────────────────
    const classSelect   = admissionForm ? admissionForm.querySelector('[name="studentClass"]') : null;
    const sectionSelect = document.getElementById('section-select');

    /**
     * Rebuild the Class <select> using the configs saved on the Settings page.
     * Preserves the currently-selected class if it still exists.
     */
    function populateClassDropdown() {
        if (!classSelect) return;
        const previous = classSelect.value;
        const configs  = getClassConfigs();
        classSelect.innerHTML =
            '<option value="">Select Class</option>' +
            configs.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        if (previous && configs.some(c => c.name === previous)) {
            classSelect.value = previous;
        }
    }

    /**
     * Rebuild the Section <select> for the currently-selected class.
     * Only shows sections configured in Settings. If the class has NO sections
     * configured, the field is hidden and required is removed so the form can submit.
     */
    function populateSectionDropdown(className) {
        if (!sectionSelect) return;
        const previous = sectionSelect.value;
        const cfg = getClassConfigMap()[className];
        // Only use configured sections — no fallback so "None" in settings = no sections
        const sections = (cfg && Array.isArray(cfg.sections) && cfg.sections.length)
            ? cfg.sections
            : [];

        const fieldGroup = document.getElementById('section-field-group');

        if (sections.length === 0) {
            // No sections configured: hide field, clear value, remove required
            sectionSelect.innerHTML = '<option value="">No sections configured</option>';
            sectionSelect.value = '';
            sectionSelect.removeAttribute('required');
            if (fieldGroup) fieldGroup.style.display = 'none';
        } else {
            // Sections available: show field, make it required
            sectionSelect.innerHTML =
                '<option value="">Select Section</option>' +
                sections.map(s => `<option value="${s}">${s}</option>`).join('');
            sectionSelect.setAttribute('required', '');
            if (fieldGroup) fieldGroup.style.display = '';
            if (previous && sections.includes(previous)) {
                sectionSelect.value = previous;
            }
        }
    }

    populateClassDropdown();
    populateSectionDropdown('');

    // Re-sync when the Settings page saves changes in another tab
    window.addEventListener('storage', (e) => {
        if (e.key === SETTINGS_CLASSES_KEY) {
            populateClassDropdown();
            populateSectionDropdown(classSelect ? classSelect.value : '');
        }
    });

    if (classSelect) {
        classSelect.addEventListener('change', function() {
            // Rebuild sections list for the chosen class
            populateSectionDropdown(this.value);

            if (this.value) {
                rollNoInput.value = generateClassRollNumber(this.value);

                // Auto-populate standard tuition fee from settings
                const classFee = getStandardFeeForClass(this.value);
                feeStandard.value = classFee;

                // Auto-populate annual fund amount from settings
                if (annualFundAmount) {
                    annualFundAmount.value = getAnnualFundForClass(this.value);
                }

                performFinancialAudit();
            }
        });
    }

    // ── 5. MEDIA & FILE HANDLING ─────────────────────────────────────────────

    const MAX_UPLOAD_SIZE_BYTES = 200 * 1024; // 200KB
    const MAX_UPLOAD_SIZE_LABEL = "200KB";

    /** Hide/reset a field's inline error message. */
    function clearUploadError(errorEl) {
        if (!errorEl) return;
        errorEl.classList.remove('show');
        const span = errorEl.querySelector('span');
        if (span) span.textContent = '';
    }

    /** Show a field's inline error message (red, fade-in via CSS). */
    function showUploadError(errorEl, message) {
        if (!errorEl) return;
        const span = errorEl.querySelector('span');
        if (span) span.textContent = message;
        else errorEl.textContent = message;
        // Restart the fade-in animation even if it's already visible
        errorEl.classList.remove('show');
        void errorEl.offsetWidth; // force reflow to re-trigger CSS animation
        errorEl.classList.add('show');
    }

    /**
     * Validates a file's size against the 200KB limit.
     * On failure: clears the input, shows the red error message, and returns false.
     * On success: clears any prior error message and returns true.
     */
    function validateUploadSize(inputEl, file, errorEl) {
        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
            inputEl.value = ''; // clear the input so the rejected file isn't submitted
            showUploadError(errorEl, `File exceeds ${MAX_UPLOAD_SIZE_LABEL}. Choose a smaller file.`);
            showToast("File Too Large", `File exceeds ${MAX_UPLOAD_SIZE_LABEL}. Choose a smaller file.`, "danger");
            return false;
        }
        clearUploadError(errorEl);
        return true;
    }

    if (studentPhotoInput) {
    studentPhotoInput.addEventListener('change', async function() {
        const file = this.files[0];
        if (file) {
            if (!validateUploadSize(this, file, studentPhotoError)) {
                return;
            }
            showToast("Processing", "Optimizing photo...", "info");
            // Face photo: 500px width is plenty
            const compressedBase64 = await compressImage(file, 500, 0.8);
            previewImg.src = compressedBase64;
        }
    });
}

// --- UPDATED B-FORM HANDLER ---
if (certUploadInput) {
    certUploadInput.addEventListener('change', async function() {
        const file = this.files[0];
        if (file) {
            if (!validateUploadSize(this, file, certUploadError)) {
                return;
            }
            showToast("Processing", "Optimizing document...", "info");
            
            // If it's a PDF, we can't compress via Canvas, just read as is
            if (file.type === 'application/pdf') {
                const reader = new FileReader();
                reader.onload = (e) => { certDataHidden.value = e.target.result; };
                reader.readAsDataURL(file);
            } else {
                // For B-Form images: 1600px width ensures text remains sharp
                const compressedBase64 = await compressImage(file, 1600, 0.7);
                certDataHidden.value = compressedBase64;
            }
            showToast("File Ready", "Document optimized and attached.", "success");
        }
    });
}

    // ── 6. DATA PERSISTENCE (CRUD) ───────────────────────────────────────────

    /**
     * Generate the next registration number using THIS school's own prefix
     * (set in Super Admin → school → "Registration prefix"; falls back to
     * name initials, then to "HRK" only if no school is logged in at all).
     * Scans ALL records (including siblings) for the highest number already
     * used WITH THE CURRENT PREFIX, so switching a school's prefix in Super
     * Admin cleanly starts a fresh sequence under the new prefix instead of
     * silently reusing/colliding with old numbers.
     * Format: PREFIX_1, PREFIX_2, PREFIX_3 … (no leading zeros, starts at 1)
     */
    function generateNextRegistrationNumber() {
        const db = getDatabase();
        let maxSeq = 0;
        const prefixRegex = new RegExp('^' + escapeRegExp(SYSTEM_PREFIX) + '(\\d+)$');
        db.forEach(s => {
    // Check both regNo and id fields so we never collide
    [s.regNo, s.id].forEach(val => {
        if (val !== undefined && val !== null) {
            // Force val to a string to prevent .match is not a function error
            const strVal = String(val); 
            const match = strVal.match(prefixRegex);
            if (match) {
                const seq = parseInt(match[1], 10);
                if (!isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
            }
        }
    });
});
        // next number — no leading zeros, starts at 1
        return `${SYSTEM_PREFIX}${maxSeq + 1}`;
    }

    /**
     * The "next reg no" badge shown when the admission modal opens is cached in
     * admissionForm.dataset.pendingRegNo so it stays visible while the form is filled in.
     * If enough time passes — or another admission/import happens in another tab — before
     * the form is submitted, that cached number can go stale and collide with a regNo that
     * was assigned to someone else in the meantime. This re-validates against the live
     * database right before the regNo is actually used, and silently generates a fresh one
     * if the cached value is no longer free. This was the root cause of two different
     * students ending up with the same Reg No (which then made Delete/Edit sometimes act
     * on the wrong — already archived — record).
     */
    function resolveFreshRegNo(db, cachedRegNo) {
        const taken = cachedRegNo && db.some(s => s.regNo === cachedRegNo || s.id === cachedRegNo);
        return (cachedRegNo && !taken) ? cachedRegNo : generateNextRegistrationNumber();
    }

    /**
     * Generate class-based roll number.
     * Sequential within each class, starting from 1.
     */
    function generateClassRollNumber(studentClass) {
        if (!studentClass) return '1';
        const db = getActiveDatabase();
        const classStudents = db.filter(s => s.studentClass === studentClass);
        let maxRoll = 0;
        classStudents.forEach(s => {
            const roll = parseInt(s.rollNo, 10);
            if (!isNaN(roll)) maxRoll = Math.max(maxRoll, roll);
        });
        return String(maxRoll + 1);
    }

    /**
     * Get (or create) the sibling-group ID for a family.
     *
     * Logic:
     *   - If the matched (original) student already has a sibling-group id
     *     (i.e. their `id` starts with "00"), reuse it — everyone in that
     *     family already shares it.
     *   - Otherwise generate a brand-new 00X code (next available number).
     *
     * Format: 001, 002, 003 … (always 3 digits after "00")
     */
    function getOrCreateSiblingGroupId(matchedStudent) {
        // Already has a group id?
        if (matchedStudent.id && matchedStudent.id.startsWith(SIBLING_PREFIX)) {
            return matchedStudent.id;
        }
        // Generate next group number
        const db = getDatabase();
        let maxGroup = 0;
        db.forEach(s => {
            if (s.id) {
                const match = s.id.match(/^00(\d+)$/);
                if (match) maxGroup = Math.max(maxGroup, parseInt(match[1], 10));
            }
        });
        return `${SIBLING_PREFIX}${String(maxGroup + 1).padStart(1, '0')}`;
        // Produces: 001, 002, 003 …
    }

    /**
     * Build the "Sibling of X, Y and Z" display string for one member,
     * given the full list of OTHER members' names.
     */
    function buildSiblingOfString(otherNames) {
        if (!otherNames || otherNames.length === 0) return '';
        if (otherNames.length === 1) return otherNames[0];
        const allButLast = otherNames.slice(0, -1);
        const last       = otherNames[otherNames.length - 1];
        return `${allButLast.join(', ')} and ${last}`;
    }

    /**
     * After any sibling addition/deletion, rebuild "siblingOf" strings for
     * every member of a family group so the text is always up-to-date.
     *
     * @param {Array}  db          — the full database array (mutated in place)
     * @param {string} groupId     — the shared 00X id of the family
     */
    function refreshSiblingOfStrings(db, groupId) {
        // Collect ALL members of this group (original + all siblings)
        const members = db.filter(s => s.id === groupId || s.regNo === undefined ? false : s.siblingGroupId === groupId);

        // Simpler: collect by groupId stored directly
        const groupMembers = db.filter(s => s.siblingGroupId === groupId);

        if (groupMembers.length === 0) return;

        const allNames = groupMembers.map(s => s.fullName);

        groupMembers.forEach(member => {
            const otherNames = allNames.filter(n => n !== member.fullName);
            member.siblingOf = buildSiblingOfString(otherNames);
        });
    }

    /**
     * Normalize a string for comparison (trim + lowercase)
     */
    function normalizeForCompare(value) {
        return (value || "").toString().trim().toLowerCase();
    }

    /**
     * Unified student search matcher — used by the View and Update search bars.
     * Supports the "~" (tilde) shortcut to search by Student Name AND Father /
     * Guardian Name together in one go, e.g. typing:
     *   Ali~Khan
     * finds students named "Ali" whose guardian's name includes "Khan".
     * Without a "~" it falls back to a general match across name, reg no,
     * student ID and guardian name.
     */
    function studentMatchesSearch(s, rawQuery) {
         const query = (rawQuery || '').toLowerCase().trim();
    if (!query) return true;

       const name     = (s.fullName || '').toLowerCase();
    const guardian = (s.guardianName || '').toLowerCase();
    // FIX: Force to string before calling toLowerCase
    const regNo    = String(s.regNo || '').toLowerCase(); 
    const id       = String(s.id || '').toLowerCase();

        if (query.includes('~')) {
            const [namePartRaw, fatherPartRaw] = query.split('~');
            const namePart   = (namePartRaw || '').trim();
            const fatherPart = (fatherPartRaw || '').trim();
            const nameOk   = !namePart   || name.includes(namePart);
            const fatherOk = !fatherPart || guardian.includes(fatherPart);
            return nameOk && fatherOk;
        }

        return name.includes(query) || guardian.includes(query) || regNo.includes(query) || id.includes(query);
    }

    /**
     * Check if the new student's guardian details match an existing record.
     * Match criteria: Guardian Name, Guardian CNIC, Permanent Address, Guardian Role.
     */
    function findGuardianMatch(newData, db) {
        return db.find(s =>
            normalizeForCompare(s.guardianName)    === normalizeForCompare(newData.guardianName)    &&
            normalizeForCompare(s.guardianCnic)    === normalizeForCompare(newData.guardianCnic)    &&
            normalizeForCompare(s.permanentAddress)=== normalizeForCompare(newData.permanentAddress) &&
            normalizeForCompare(s.guardianRole)    === normalizeForCompare(newData.guardianRole)
        ) || null;
    }

    function getDatabase() {
        try {
            return JSON.parse(localStorage.getItem(DB_KEY) || '[]');
        } catch (e) {
            console.error('Failed to read student database from localStorage', e);
            return [];
        }
    }
    function saveDatabase(d)  {
        localStorage.setItem(DB_KEY, JSON.stringify(d));
        API_STUDENTS = d; // keep the in-memory mirror in sync too
    }

    // ── ARCHIVE HELPERS ──────────────────────────────────────────────────────
    // A student with no `status` (or status "active") is on the live roster.
    // "graduated" / "dropped" students are excluded from every active list
    // (dashboard counters, class cards, roll numbers, search tables) and only
    // surface inside the Archive Center.
    function isActiveStudent(s)     { return !s.status || s.status === 'active'; }
    function getActiveDatabase() {
        return getDatabase().filter(s => !s.status || s.status === 'active');
    }
    function getGraduatedStudents() { return getDatabase().filter(s => s.status === 'graduated'); }
    function getDroppedStudents()   { return getDatabase().filter(s => s.status === 'dropped'); }

    // ── BACKEND SYNC HELPERS ─────────────────────────────────────────────────
    // Fields on the Java Student entity typed as Double. Form inputs / FormData
    // hand everything back as strings, so these need coercing before they're
    // sent to Spring, or Jackson throws a 400 (can't map "4500" (String) -> Double).
    const NUMERIC_FIELDS = [
        'standardFee', 'admissionFee', 'tuitionDiscount',
        'transportDiscount', 'siblingDiscount', 'transportFee', 'netPayable'
    ];

    /**
     * Build a payload safe to POST to the Spring Boot API.
     * - Drops the frontend's `id` field. In the browser `id` is a regNo/sibling
     *   group string (e.g. "PSC_1" or "003") used for local lookups, but the
     *   Java Student entity's `id` is an auto-generated Long primary key —
     *   sending the string would fail deserialization. The backend already
     *   re-associates the correct row using `regNo` (see StudentController).
     * - Coerces numeric-looking strings into real numbers for the Double fields.
     */
    function toApiPayload(studentData) {
        const payload = Object.assign({}, studentData);
        delete payload.id;
        NUMERIC_FIELDS.forEach(f => {
            if (payload[f] !== undefined && payload[f] !== null && payload[f] !== '') {
                const n = parseFloat(payload[f]);
                payload[f] = isNaN(n) ? 0 : n;
            }
        });
        // StudentController rejects any write without schoolId — always stamp
        // the logged-in school's real ID on the way out, regardless of what
        // (if anything) was already on the local record.
        payload.schoolId = getCurrentSchoolId();
        return payload;
    }

    /** Thin fetch() wrapper that throws a readable error on non-2xx responses. */
    async function apiRequest(method, url, body) {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`${method} ${url} -> ${res.status} ${text}`);
        }
        const contentType = res.headers.get('content-type') || '';
        return contentType.includes('application/json') ? res.json() : null;
    }

    /** Save (create or update) a student in MySQL. Returns the row Spring saved. */
    function apiSaveStudent(studentData) {
        return apiRequest('POST', API_BASE, toApiPayload(studentData));
    }

    /** Remove a student on the backend (StudentController does a soft delete — status -> "dropped"). */
    function apiDeleteStudent(regNo) {
        const schoolId = getCurrentSchoolId();
        return apiRequest('DELETE', `${API_BASE}/${encodeURIComponent(regNo)}?schoolId=${encodeURIComponent(schoolId)}`);
    }

    /**
     * Pull the current roster from MySQL on page load and refresh localStorage
     * so every view (dashboard counters, tables, archive) reflects the database
     * instead of whatever was last cached in the browser.
     *
     * Server rows are merged ON TOP OF the local cache (matched by regNo) so
     * frontend-only bookkeeping the Student entity doesn't persist yet
     * (isSibling / siblingGroupId / hasSiblings / booksFee / booksDiscount /
     * annualFundEnabled) isn't wiped out every time this runs. If you want
     * those to be fully server-backed too, add matching columns to Student.java.
     */
    async function syncWithBackend() {
        try {
            const schoolId = getCurrentSchoolId();
            if (!schoolId) {
                // No school session (demo / superadmin preview) — nothing to
                // scope the request to, so skip the call instead of sending
                // a schoolId-less request the backend will always reject.
                console.warn('syncWithBackend: no logged-in school, staying on local cache.');
                return;
            }
            const serverStudents = await apiRequest('GET', `${API_BASE}?schoolId=${encodeURIComponent(schoolId)}`);
            if (!Array.isArray(serverStudents)) return;

            const local        = getDatabase();
            const localByRegNo = new Map(local.map(s => [s.regNo, s]));
            const merged        = serverStudents.map(srv =>
                Object.assign({}, localByRegNo.get(srv.regNo) || {}, srv)
            );

            saveDatabase(merged);
            updateDashboardStats();
            if (typeof renderStudentTable === 'function') renderStudentTable();
            if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
        } catch (err) {
            // Backend not reachable (e.g. Spring Boot not running) — keep working
            // off the local cache instead of breaking the page.
            console.warn('syncWithBackend: could not reach the server, using local cache.', err.message);
        }
    }

    // ── FORM SUBMISSION ──────────────────────────────────────────────────────

    if (admissionForm) {
    admissionForm.onsubmit = async function(e) {
        e.preventDefault();

        const db         = getDatabase();
        const formData   = new FormData(admissionForm);
        const studentData= Object.fromEntries(formData);

        // Standardize properties
        delete studentData['_editRegNo'];
        studentData.photo      = previewImg.src;
        studentData.age        = ageInput.value;
        studentData.netPayable = netTotalInput.value;
        studentData.rollNo     = rollNoInput.value;
        
        // CRITICAL FIX: Ensure new students are marked as active
        if (!studentData.status) {
            studentData.status = 'active';
        }

        const existingId = editIdHidden.value.trim();

        if (existingId) {
            // UPDATING
            const index = db.findIndex(s => s.regNo === existingId || s.id === existingId);
            if (index === -1) {
                showToast("Error", "Could not find student.", "danger");
                return;
            }
            db[index] = Object.assign({}, db[index], studentData);
            saveDatabase(db);
            showToast("Updated", "Record updated successfully", "info");
            closeModal('student-modal');

            // Push the update to MySQL. StudentController matches on regNo and
            // reuses the existing row's primary key, so this is a true UPDATE
            // rather than a duplicate insert.
            try {
                const saved = await apiSaveStudent(db[index]);
                if (saved) db[index] = Object.assign({}, db[index], saved, { id: db[index].id });
                saveDatabase(db);
            } catch (err) {
                console.error('Backend sync failed (update):', err);
                showToast("Offline", "Saved locally — couldn't reach the server.", "danger");
            }
        } else {
            // NEW ADMISSION
            if (!canAdmitNewStudent()) {
                showToast("Limit Reached", `Your plan allows up to ${getStudentLimit()} active students. Upgrade your plan to register more.`, "danger");
                return;
            }
            const matchedStudent = findGuardianMatch(studentData, db);
            if (matchedStudent) {
                showSiblingDialog(matchedStudent.fullName, studentData, db, matchedStudent);
            } else {
                const regNo = resolveFreshRegNo(db, admissionForm.dataset.pendingRegNo);
                studentData.regNo = regNo;
                studentData.id    = regNo;
                
                db.push(studentData);
                saveDatabase(db);
                showToast("Admission Complete", `${studentData.fullName} registered.`, "success");
                closeModal('student-modal');
                showAdmissionPrintPrompt(studentData);

                try {
                    await apiSaveStudent(studentData);
                } catch (err) {
                    console.error('Backend sync failed (new admission):', err);
                    showToast("Offline", "Saved locally — couldn't reach the server.", "danger");
                }
            }
        }
        
        // REFRESH ALL VIEWS
        updateDashboardStats();
        if (typeof renderStudentTable === 'function') renderStudentTable();
        if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
    };
}

    /**
     * Sibling confirmation dialog
     */
    function showSiblingDialog(matchedName, studentData, db, matchedStudent) {
        const existing = document.getElementById('sibling-dialog-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'sibling-dialog-overlay';
        overlay.innerHTML = `
            <div class="sibling-dialog-box">
                <div class="sibling-dialog-icon">
                    <i class="fas fa-user-friends"></i>
                </div>
                <h3 class="sibling-dialog-title">Sibling Detected</h3>
                <p class="sibling-dialog-body">
                    The guardian details for <strong>${studentData.fullName}</strong> match an existing record for:
                </p>
                <div class="sibling-match-card">
                    <i class="fas fa-user-graduate"></i>
                    <span>${matchedName}</span>
                </div>
                <p class="sibling-dialog-question">
                    Would you like to register <strong>${studentData.fullName}</strong>
                    as a sibling of <strong>${matchedName}</strong>?
                </p>
                <div class="sibling-dialog-actions">
                    <button id="sibling-yes-btn" class="sibling-btn-yes">
                        <i class="fas fa-check-circle"></i> Yes, Mark as Sibling
                    </button>
                    <button id="sibling-no-btn" class="sibling-btn-no">
                        <i class="fas fa-times-circle"></i> No, Register Independently
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // ── YES: register as sibling ─────────────────────────────────────────
        document.getElementById('sibling-yes-btn').addEventListener('click', async () => {

            // 1. Get or create the shared sibling-group id (00X)
            const groupId = getOrCreateSiblingGroupId(matchedStudent);

            // 2. Generate a real registration number (school prefix) for the new student
            const newRegNo = resolveFreshRegNo(db, admissionForm.dataset.pendingRegNo);

            // 3. Configure the NEW student
            studentData.regNo         = newRegNo;
            studentData.id            = groupId;   // shared 00X — NOT shown in main table
            studentData.isSibling     = true;
            studentData.siblingGroupId= groupId;

            // 4. If the ORIGINAL student is not yet in a group, update their id too
            const originalIndex = db.findIndex(s => s.id === matchedStudent.id || s.regNo === matchedStudent.regNo);
            if (originalIndex !== -1) {
                if (!db[originalIndex].siblingGroupId) {
                    // First time a sibling is added — bring the original into the group
                    db[originalIndex].id             = groupId;
                    db[originalIndex].isSibling      = true;
                    db[originalIndex].siblingGroupId = groupId;
                    if (!db[originalIndex].hasSiblings) db[originalIndex].hasSiblings = [];
                }
                // Record the new student in the original's hasSiblings list
                db[originalIndex].hasSiblings.push({
                    name : studentData.fullName,
                    regNo: newRegNo
                });
            }

            // 5. Also build hasSiblings on the new student (pointing back to all others)
            const groupMembersBeforeAdd = db.filter(s => s.siblingGroupId === groupId);
            studentData.hasSiblings = groupMembersBeforeAdd.map(s => ({
                name : s.fullName,
                regNo: s.regNo
            }));

            // 6. Save the new student
            db.push(studentData);

            // 7. Refresh "Sibling of …" strings for EVERY group member
            refreshSiblingOfStrings(db, groupId);

            saveDatabase(db);
            overlay.remove();
            showToast("Sibling Registered", `${studentData.fullName} linked as sibling. Group ID: ${groupId}`, "success");
            closeModal('student-modal');
            showAdmissionPrintPrompt(studentData);
            updateDashboardStats();
            renderStudentTable();

            try {
                await apiSaveStudent(studentData);
            } catch (err) {
                console.error('Backend sync failed (sibling registration):', err);
                showToast("Offline", "Saved locally — couldn't reach the server.", "danger");
            }
        });

        // ── NO: register independently ───────────────────────────────────────
        document.getElementById('sibling-no-btn').addEventListener('click', async () => {
            const regNo       = resolveFreshRegNo(db, admissionForm.dataset.pendingRegNo);
            studentData.regNo = regNo;
            studentData.id    = regNo;
            db.push(studentData);
            saveDatabase(db);
            overlay.remove();
            showToast("Admission Complete", `${studentData.fullName} registered independently.`, "success");
            closeModal('student-modal');
            showAdmissionPrintPrompt(studentData);
            updateDashboardStats();
            renderStudentTable();

            try {
                await apiSaveStudent(studentData);
            } catch (err) {
                console.error('Backend sync failed (independent registration):', err);
                showToast("Offline", "Saved locally — couldn't reach the server.", "danger");
            }
        });
    }

    /**
     * "Finalize Admission" follow-up — ask whether to print the Admission Form.
     * Shown right after a NEW student is successfully registered.
     */
    function showAdmissionPrintPrompt(studentData) {
        const existing = document.getElementById('admission-print-dialog-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'admission-print-dialog-overlay';
        overlay.innerHTML = `
            <div class="admission-print-dialog-box">
                <div class="admission-print-dialog-icon">
                    <i class="fas fa-print"></i>
                </div>
                <h3 class="admission-print-dialog-title">Admission Finalized</h3>
                <p class="admission-print-dialog-body">
                    Would you like to print the Admission Form for
                    <strong>${escapeHtmlForPrint(studentData.fullName || 'this student')}</strong>?
                </p>
                <div class="admission-print-dialog-actions">
                    <button id="admission-print-yes-btn" class="admission-print-btn-yes">
                        <i class="fas fa-print"></i> Print Admission Form
                    </button>
                    <button id="admission-print-no-btn" class="admission-print-btn-no">
                        <i class="fas fa-times"></i> Close / Not Now
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('admission-print-yes-btn').addEventListener('click', () => {
            printAdmissionForm(studentData);
            overlay.remove();
        });

        document.getElementById('admission-print-no-btn').addEventListener('click', () => {
            overlay.remove();
        });

        // Allow closing by clicking the dark backdrop
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    /** Minimal HTML-escaping helper used when injecting student data into markup. */
    function escapeHtmlForPrint(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Build and open a print-ready Admission Form for the freshly-registered student.
     * Includes all text fields captured during admission + the student's photo.
     * Deliberately EXCLUDES the uploaded certificate / B-Form document image.
     */
    function printAdmissionForm(studentData) {
    const esc = escapeHtmlForPrint;

    // System Data
    const schoolEl = document.querySelector('.school-name');
    const schoolName = schoolEl ? schoolEl.textContent.trim() : 'ST. LAWRENCE INTERNATIONAL SCHOOL';
    const schoolLogoUrl = getSchoolLogoUrl();
    const crestInner = schoolLogoUrl ? `<img src="${esc(schoolLogoUrl)}" alt="School Logo">` : `<i class="fas fa-graduation-cap"></i>`;
    const academicSession = getCurrentAcademicSession(); // Uses the helper in your JS
    const printedOn = new Date().toLocaleDateString('en-US', {
        day: '2-digit', month: 'short', year: 'numeric'
    }) + '  ·  ' + new Date().toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true
    });

    // Student Data Mapping
    const photoSrc = (studentData.photo && !/placeholder\.com/i.test(studentData.photo)) ? studentData.photo : '';
    const registrationNo = studentData.regNo || studentData.id || '—';
    const dobISO = studentData.dob || '';
    const dateOfBirth = studentData.dob ? new Date(studentData.dob).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const admissionDate = studentData.admissionDate ? new Date(studentData.admissionDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    // ── Fee & Transport figures (formatted, blank-safe) ──
    const fmtRs = (v) => (v === undefined || v === null || v === '') ? '—' : ('Rs. ' + Number(v).toLocaleString('en-PK'));
    const transportMode = studentData.transportMode || 'Private (Self)';
    const transportType = studentData.transportType && studentData.transportType !== 'None' ? studentData.transportType : 'N/A';
    const totalDiscount = [studentData.tuitionDiscount, studentData.transportDiscount, studentData.siblingDiscount]
        .map(v => Number(v) || 0).reduce((a, b) => a + b, 0);

    // ── Siblings section (only rendered when the student has a sibling link) ──
    // Two independent signals, same as the on-screen Profile view:
    //   • studentData.isSibling / .siblingOf / .siblingGroupId — this student IS a
    //     sibling of one or more names already in the system (reverse-lookup string).
    //   • studentData.hasSiblings — {name, regNo}[] of the other student(s) in the
    //     same sibling group; looked up against the live DB for current class/section.
    const siblingList = Array.isArray(studentData.hasSiblings) ? studentData.hasSiblings : [];
    const isSiblingLinked = !!(studentData.isSibling && studentData.siblingOf);
    let siblingsSectionHtml = '';
    if (siblingList.length > 0 || isSiblingLinked) {
        let fullDb = [];
        try { fullDb = getDatabase(); } catch (e) { fullDb = []; }

        const siblingOfNoticeHtml = isSiblingLinked ? `
            <div class="sibling-of-notice">
                <i class="fas fa-user-friends"></i>
                <span>This student is a <strong>sibling of ${esc(studentData.siblingOf)}</strong>${studentData.siblingGroupId ? ` &nbsp;·&nbsp; Sibling Group ID: <strong>${esc(studentData.siblingGroupId)}</strong>` : ''}</span>
            </div>` : '';

        const siblingRowsHtml = siblingList.map(sib => {
            const matched = fullDb.find(s => s.regNo === sib.regNo || s.id === sib.regNo) || null;
            const sibClass   = matched && matched.studentClass ? matched.studentClass : '—';
            const sibSection = matched && matched.section      ? matched.section      : '—';
            return `
                    <tr>
                        <td>${esc(sib.regNo || '—')}</td>
                        <td>${esc(sib.name || '—')}</td>
                        <td>${esc(sibClass)}</td>
                        <td>${esc(sibSection)}</td>
                    </tr>`;
        }).join('');

        const siblingTableHtml = siblingList.length > 0 ? `
            <table class="sibling-table" ${isSiblingLinked ? 'style="margin-top:9px;"' : ''}>
                <thead>
                    <tr>
                        <th>Reg. No.</th>
                        <th>Full Name</th>
                        <th>Class</th>
                        <th>Section</th>
                    </tr>
                </thead>
                <tbody>${siblingRowsHtml}
                </tbody>
            </table>` : '';

        siblingsSectionHtml = `
        <section class="section">
            <div class="section-label"><span class="num">5</span><span class="txt">Sibling Information</span></div>
            ${siblingOfNoticeHtml}
            ${siblingTableHtml}
        </section>`;
    }

    const safeFileName = (studentData.fullName || 'student').replace(/[^a-z0-9]+/gi, '_');

    const printWin = window.open('', '_blank', 'width=1000,height=1000');

    printWin.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Admission Form — ${esc(studentData.fullName)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
    <style>
        @page { size: A4; margin: 0; }
        :root {
            --ink-900:#0f172a; --ink-700:#1e293b; --ink-500:#475569; --ink-400:#64748b;
            --line:#e2e8f0; --line-strong:#cbd5e1; --surface:#ffffff; --surface-tint:#f8fafc;
            --steel:#4682b4; --steel-dark:#2c5c80; --steel-deep:#1f4a6b; --steel-light:#eaf3fa; --steel-line:#bcd7ea;
            --accent:#2c5c80; --gold:#a97c1f;
        }
        * { box-sizing:border-box; margin:0; padding:0; }
        html, body { width:210mm; }
        body { font-family:'Inter', sans-serif; color:var(--ink-700); background:#dce8f0; }

        /* ── On-screen toolbar (hidden on print / capture) ── */
        .toolbar { position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:center; gap:10px;
            padding:12px 16px; background:#0f172a; box-shadow:0 2px 10px rgba(0,0,0,.25); }
        .toolbar-hint { color:#94a3b8; font-size:12px; margin-right:auto; padding-left:4px; }
        .tb-btn { display:inline-flex; align-items:center; gap:7px; border:none; cursor:pointer; padding:9px 16px;
            border-radius:7px; font-family:'Inter',sans-serif; font-weight:600; font-size:12.5px; transition:opacity .15s; }
        .tb-btn:hover { opacity:.88; }
        .tb-btn:disabled { opacity:.55; cursor:default; }
        .tb-print { background:var(--steel); color:#fff; }
        .tb-share { background:#25D366; color:#fff; }
        .tb-close { background:#334155; color:#e2e8f0; }

        .page-frame { width:210mm; min-height:297mm; margin:14px auto; padding:7mm; background:linear-gradient(160deg, var(--steel) 0%, var(--steel-dark) 55%, var(--steel-deep) 100%); border-radius:10px; display:flex; }
        .page { width:100%; min-height:calc(297mm - 14mm); padding:10mm 12mm; position:relative; margin:0; background:#fff; border-radius:6px; box-shadow:0 1px 3px rgba(15,23,42,0.15); display:flex; flex-direction:column; }
        .page::before { content:""; position:absolute; top:6px; left:6px; right:6px; bottom:6px; border:1px solid var(--steel-line); border-radius:4px; pointer-events:none; }
        .corner { position:absolute; width:20px; height:20px; pointer-events:none; }
        .corner-tl { top:12px; left:12px; border-top:2.2px solid var(--gold); border-left:2.2px solid var(--gold); }
        .corner-tr { top:12px; right:12px; border-top:2.2px solid var(--gold); border-right:2.2px solid var(--gold); }
        .corner-bl { bottom:12px; left:12px; border-bottom:2.2px solid var(--gold); border-left:2.2px solid var(--gold); }
        .corner-br { bottom:12px; right:12px; border-bottom:2.2px solid var(--gold); border-right:2.2px solid var(--gold); }
        .watermark { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-32deg); font-size:70px; font-weight:800; letter-spacing:6px; color:var(--steel); opacity:0.045; text-transform:uppercase; white-space:nowrap; pointer-events:none; z-index:0; }
        .doc-header, .title-bar, .section, .declaration, .doc-footer { position:relative; z-index:1; }
        .doc-header { display:flex; align-items:flex-start; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid var(--steel-line); }
        .crest { width:46px; height:46px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:19px;
            background:linear-gradient(135deg, var(--steel) 0%, var(--steel-deep) 100%); box-shadow:0 3px 10px rgba(31,74,107,0.4); border:1.6px solid var(--gold); }
        .crest img { width:100%; height:100%; object-fit:cover; border-radius:50%; }
        .school-name-title { font-size:18px; font-weight:800; color:var(--ink-900); line-height:1.15; }
        .school-sub { font-size:9px; color:var(--steel-dark); text-transform:uppercase; margin-top:2px; letter-spacing:0.5px; }
        .meta-badge { text-align:right; border:1px solid var(--steel-line); padding:5px 10px; border-radius:4px; background:var(--steel-light); }
        .meta-label { font-size:7.5px; text-transform:uppercase; color:var(--steel-dark); font-weight:600; display:block; }
        .meta-value { font-family:'Roboto Mono', monospace; font-size:10px; color:var(--ink-900); }
        .title-bar { margin-top:10px; padding:8px 0; border-top:2.2px solid var(--steel); border-bottom:1px solid var(--steel-line); text-align:center; background:linear-gradient(180deg, var(--steel-light) 0%, #ffffff 100%); }
        .title-bar h1 { font-size:15px; letter-spacing:2.5px; font-weight:800; text-transform:uppercase; color:var(--steel-deep); }
        .section { margin-top:10px; }
        .section-label { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
        .section-label .num { width:16px; height:16px; border-radius:3px; background:var(--steel-dark); color:#fff; font-size:9px; font-weight:700; display:flex; align-items:center; justify-content:center; }
        .section-label .txt { font-size:9.5px; font-weight:700; letter-spacing:1.2px; text-transform:uppercase; color:var(--ink-900); }
        .section-label::after { content:""; flex:1; height:1px; background:linear-gradient(90deg, var(--steel-line), transparent); }
        .profile-grid { display:grid; grid-template-columns:1fr 108px; gap:14px; }
        .field-grid { display:grid; grid-template-columns:1fr 1fr 1fr; column-gap:14px; row-gap:7px; }
        .field { display:flex; align-items:baseline; gap:5px; border-bottom:1px solid var(--line-strong); padding-bottom:2.5px; }
        .f-label { font-size:7.2px; text-transform:uppercase; color:var(--ink-400); font-weight:700; white-space:nowrap; }
        .f-value { font-size:10px; font-weight:500; color:var(--ink-900); }
        .photo-box { width:108px; height:132px; border:1.4px dashed var(--steel-line); border-radius:3px; background:var(--steel-light); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; color:var(--steel-dark); }
        .panel { border:1px solid var(--steel-line); border-radius:4px; padding:8px 12px; background:#fff; }
        .panel-title { font-size:8px; font-weight:700; color:var(--accent); margin-bottom:6px; text-transform:uppercase; padding-bottom:4px; border-bottom:1px solid var(--line); }
        .row-3 { display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; background:var(--steel-light); border:1px solid var(--steel-line); padding:8px 14px; border-radius:4px; }
        .row-4 { display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; background:var(--steel-light); border:1px solid var(--steel-line); padding:8px 14px; border-radius:4px; }
        .fee-summary-row { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:7px; padding:7px 12px; background:var(--surface-tint); border:1px dashed var(--steel-line); border-radius:4px; }
        .fee-summary-row .net-label { font-size:8.5px; font-weight:700; text-transform:uppercase; color:var(--steel-dark); }
        .fee-summary-row .net-value { font-family:'Roboto Mono', monospace; font-size:13px; font-weight:700; color:var(--accent); }
        .sibling-table { width:100%; border-collapse:collapse; border:1px solid var(--steel-line); border-radius:4px; overflow:hidden; }
        .sibling-table th, .sibling-table td { border:1px solid var(--steel-line); padding:5px 10px; text-align:left; }
        .sibling-table th { background:var(--steel-light); font-size:7.6px; text-transform:uppercase; letter-spacing:0.6px; color:var(--steel-dark); font-weight:700; }
        .sibling-table td { font-size:9.5px; color:var(--ink-900); font-weight:500; }
        .sibling-table tbody tr:nth-child(even) { background:var(--surface-tint); }
        .sibling-of-notice { display:flex; align-items:center; gap:8px; font-size:9.2px; font-weight:500; color:var(--ink-900); background:var(--steel-light); border:1px solid var(--steel-line); border-left:3px solid var(--gold); border-radius:0 4px 4px 0; padding:7px 12px; }
        .sibling-of-notice i { color:var(--gold); font-size:11px; }
        .declaration { margin-top:11px; padding:9px 14px; border-left:3px solid var(--steel); background:var(--steel-light); font-size:8.5px; font-style:italic; border-radius:0 4px 4px 0; }
        .doc-footer { margin-top:auto; padding-top:14px; }
        .sign-row { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:22px; }
        .sign-block { text-align:center; }
        .sign-line { border-bottom:1.4px dotted var(--ink-400); height:26px; }
        .sign-label { font-size:8.3px; font-weight:600; text-transform:uppercase; margin-top:5px; color:var(--steel-dark); }
        @media print {
            .toolbar { display:none !important; }
            html, body { width:210mm; height:297mm; background:#fff; }
            body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .page-frame { width:210mm; height:297mm; min-height:297mm; padding:4mm; margin:0; border-radius:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .page { height:100%; min-height:0; box-shadow:none; border-radius:2px; }
        }
    </style>
</head>
<body>
    <div class="toolbar no-print">
        <span class="toolbar-hint"><i class="fas fa-circle-info"></i> Review the form below, then print or share it.</span>
        <button class="tb-btn tb-print" onclick="window.print()"><i class="fas fa-print"></i> Print</button>
        <button class="tb-btn tb-share" id="admShareBtn" onclick="shareAdmissionForm()"><i class="fab fa-whatsapp"></i> Share on WhatsApp</button>
        <button class="tb-btn tb-close" onclick="window.close()"><i class="fas fa-times"></i> Close</button>
    </div>
    <div class="page-frame" id="admPageFrame">
    <div class="page">
        <div class="corner corner-tl"></div>
        <div class="corner corner-tr"></div>
        <div class="corner corner-bl"></div>
        <div class="corner corner-br"></div>
        <div class="watermark">${esc(schoolName).split(' ').slice(0,2).join(' ')}</div>
        <header class="doc-header">
            <div style="display:flex; gap:10px; align-items:center;">
                <div class="crest">${crestInner}</div>
                <div>
                    <div class="school-name-title">${esc(schoolName)}</div>
                    <div class="school-sub">Official Admission Record</div>
                </div>
            </div>
            <div class="meta-badge">
                <span class="meta-label">Printed On</span>
                <span class="meta-value">${printedOn}</span>
            </div>
        </header>

        <div class="title-bar">
            <h1>Official Admission Form</h1>
            <div style="font-size:8.5px; text-transform:uppercase; color:var(--ink-400);">Academic Session ${academicSession}</div>
        </div>

        <section class="section">
            <div class="section-label"><span class="num">1</span><span class="txt">Student Profile</span></div>
            <div class="profile-grid">
                <div class="field-grid">
                    <div class="field" style="grid-column: span 3;">
                        <span class="f-label">Full Name:</span>
                        <span class="f-value">${esc(studentData.fullName)}</span>
                    </div>
                    <div class="field" style="grid-column: span 2;">
                        <span class="f-label">Reg No / B-Form:</span>
                        <span class="f-value" style="font-family:monospace;">${esc(registrationNo)} | ${esc(studentData.studentBform)}</span>
                    </div>
                    <div class="field">
                        <span class="f-label">Gender:</span>
                        <span class="f-value">${esc(studentData.gender)}</span>
                    </div>
                    <div class="field">
                        <span class="f-label">Class / Section:</span>
                        <span class="f-value">${esc(studentData.studentClass)} - ${esc(studentData.section || 'N/A')}</span>
                    </div>
                    <div class="field">
                        <span class="f-label">Admission Date:</span>
                        <span class="f-value">${admissionDate}</span>
                    </div>
                    <div class="field">
                        <span class="f-label">DOB / Age:</span>
                        <span class="f-value">${dateOfBirth} | ${esc(studentData.age)}</span>
                    </div>
                    <div class="field">
                        <span class="f-label">Orphan Status:</span>
                        <span class="f-value">${esc(studentData.orphanStatus || 'Not Orphan')}</span>
                    </div>
                    <div class="field" style="grid-column: span 2;">
                        <span class="f-label">Medical Issues / Allergies:</span>
                        <span class="f-value">${esc(studentData.medicalIssues || 'None')}</span>
                    </div>
                </div>
                <div class="photo-box">
                    ${photoSrc ? `<img src="${photoSrc}" style="width:100%; height:100%; object-fit:cover;">` : '<div style="font-size:8px;">AFFIX PHOTO</div>'}
                </div>
            </div>
        </section>

        <section class="section">
            <div class="section-label"><span class="num">2</span><span class="txt">Academic History</span></div>
            <div class="row-3">
                <div class="field"><span class="f-label">Previous School:</span><span class="f-value">${esc(studentData.previousSchool || 'None')}</span></div>
                <div class="field"><span class="f-label">Last Class:</span><span class="f-value">${esc(studentData.previousClass || 'N/A')}</span></div>
                <div class="field"><span class="f-label">Roll No:</span><span class="f-value">${esc(studentData.rollNo)}</span></div>
            </div>
        </section>

        <section class="section">
            <div class="section-label"><span class="num">3</span><span class="txt">Guardian & Contact</span></div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
                <div class="panel">
                    <div class="panel-title">Guardian Details</div>
                    <div class="field" style="margin-bottom:7px;"><span class="f-label">Name:</span><span class="f-value">${esc(studentData.guardianName)}</span></div>
                    <div class="field" style="margin-bottom:7px;"><span class="f-label">Relation:</span><span class="f-value">${esc(studentData.guardianRole)}</span></div>
                    <div class="field"><span class="f-label">CNIC:</span><span class="f-value">${esc(studentData.guardianCnic)}</span></div>
                </div>
                <div class="panel">
                    <div class="panel-title">Contact Information</div>
                    <div class="field" style="margin-bottom:7px;"><span class="f-label">Phones:</span><span class="f-value">${esc(studentData.phone1)} / ${esc(studentData.phone2)}</span></div>
                    <div class="field" style="margin-bottom:7px;"><span class="f-label">Permanent Address:</span><span class="f-value" style="font-size:9px;">${esc(studentData.permanentAddress)}</span></div>
                    <div class="field"><span class="f-label">Mailing Address:</span><span class="f-value" style="font-size:9px;">${esc(studentData.mailingAddress || 'Same as permanent')}</span></div>
                </div>
            </div>
        </section>

        <section class="section">
            <div class="section-label"><span class="num">4</span><span class="txt">Transport &amp; Fee Summary</span></div>
            <div class="row-4">
                <div class="field"><span class="f-label">Transport:</span><span class="f-value">${esc(transportMode)} (${esc(transportType)})</span></div>
                <div class="field"><span class="f-label">Transport Fee:</span><span class="f-value">${fmtRs(studentData.transportFee)}</span></div>
                <div class="field"><span class="f-label">Standard Tuition Fee:</span><span class="f-value">${fmtRs(studentData.standardFee)}</span></div>
                <div class="field"><span class="f-label">Admission Fee:</span><span class="f-value">${fmtRs(studentData.admissionFee)}</span></div>
            </div>
            <div class="fee-summary-row">
                <span class="net-label">Total Discounts Applied: <span style="font-family:'Roboto Mono',monospace; color:var(--ink-900); font-weight:700;">${fmtRs(totalDiscount)}</span>${studentData.isLifetime ? ' &nbsp;·&nbsp; Lifetime' : (studentData.discountExpiry ? ` &nbsp;·&nbsp; Valid Until ${esc(studentData.discountExpiry)}` : '')}</span>
                <span class="net-label">Net Payable (First Month): <span class="net-value">${fmtRs(studentData.netPayable)}</span></span>
            </div>
        </section>
        ${siblingsSectionHtml}

        <section class="declaration">
            <div style="font-weight:700; color:var(--accent); text-transform:uppercase; margin-bottom:5px; font-size:8.3px;">Guardian Declaration</div>
            I, ${esc(studentData.guardianName)}, do hereby declare that the information provided is correct. I agree to abide by all school rules and regulations.
        </section>

        <footer class="doc-footer">
            <div class="sign-row">
                <div class="sign-block"><div class="sign-line"></div><div class="sign-label">Guardian Signature</div></div>
                <div class="sign-block"><div class="sign-line"></div><div class="sign-label">Principal Stamp</div></div>
            </div>
        </footer>
    </div>
    </div>

    <script>
        async function shareAdmissionForm() {
            const btn = document.getElementById('admShareBtn');
            const oldHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...';
            try {
                const target = document.getElementById('admPageFrame');
                const canvas = await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
                const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
                if (!blob) throw new Error('Capture failed');
                const filename = 'Admission_Form_${esc(safeFileName)}.png';
                const file = new File([blob], filename, { type: 'image/png' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Admission Form',
                        text: 'Admission Form for ${esc(studentData.fullName || "")}'
                    });
                    return;
                }

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 4000);

                const msg = encodeURIComponent('Admission Form for ${esc(studentData.fullName || "student")}.\\n(The form image has been downloaded — please attach "' + filename + '" in WhatsApp.)');
                window.open('https://wa.me/?text=' + msg, '_blank');
            } catch (err) {
                console.error('Share failed', err);
                alert('Sharing failed. The admission form image could not be generated.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = oldHtml;
            }
        }
    <\/script>
</body>
</html>`);
    printWin.document.close();
    printWin.focus();
}

    window.printAdmissionFormForStudent = function(regNo) {
        const db = getDatabase();
        const s = db.find(x => x.regNo === regNo) || db.find(x => x.id === regNo);
        if (!s) {
            showToast("Not Found", "Could not locate this student's record to print.", "danger");
            return;
        }
        printAdmissionForm(s);
    };

    /**
     * Build and open a print-ready, WhatsApp-shareable "Complete Student Record"
     * — the same information shown in the on-screen Profile modal (Academic,
     * Personal, Guardian & Contact, Finance & Transport, sibling links), laid
     * out on a single branded A4 page with the school name/logo, instead of
     * relying on the browser's raw window.print() of the live modal DOM.
     */
    function printStudentRecord(studentData) {
        const esc = escapeHtmlForPrint;
        const s = studentData;

        const schoolEl = document.querySelector('.school-name');
        const schoolName = schoolEl ? schoolEl.textContent.trim() : 'ST. LAWRENCE INTERNATIONAL SCHOOL';
        const schoolLogoUrl = getSchoolLogoUrl();
        const recCrestInner = schoolLogoUrl ? `<img src="${esc(schoolLogoUrl)}" alt="School Logo">` : `<i class="fas fa-id-card-clip"></i>`;
        const printedOn = new Date().toLocaleDateString('en-US', {
            day: '2-digit', month: 'short', year: 'numeric'
        }) + '  ·  ' + new Date().toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: true
        });

        const safeVal = v => (v !== undefined && v !== null && v !== '') ? esc(v) : '—';
        const fmtRs = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? '—' : ('Rs. ' + Number(v).toLocaleString('en-PK'));
        const photoSrc = (s.photo && !/placeholder\.com/i.test(s.photo)) ? s.photo : '';
        const registrationNo = s.regNo || s.id || '—';

        // ── Sibling info (mirrors the Profile modal's two independent signals) ──
        const isSiblingLinked = !!(s.isSibling && s.siblingOf);
        const hasSiblingsList = Array.isArray(s.hasSiblings) ? s.hasSiblings : [];
        let siblingHtml = '';
        if (isSiblingLinked || hasSiblingsList.length > 0) {
            const linkedNotice = isSiblingLinked ? `
                <div class="sibling-of-notice">
                    <i class="fas fa-user-friends"></i>
                    <span>Sibling of <strong>${esc(s.siblingOf)}</strong>${s.siblingGroupId ? ` &nbsp;·&nbsp; Sibling Group ID: <strong>${esc(s.siblingGroupId)}</strong>` : ''}</span>
                </div>` : '';
            const hasRows = hasSiblingsList.map(sib => `
                    <tr><td>${esc(sib.regNo || '—')}</td><td>${esc(sib.name || '—')}</td></tr>`).join('');
            const hasTable = hasSiblingsList.length > 0 ? `
                <table class="sibling-table" ${isSiblingLinked ? 'style="margin-top:9px;"' : ''}>
                    <thead><tr><th>Reg. No.</th><th>Full Name</th></tr></thead>
                    <tbody>${hasRows}</tbody>
                </table>` : '';
            siblingHtml = `
        <section class="rec-section">
            <div class="rec-section-label"><span class="rec-ico"><i class="fas fa-people-roof"></i></span><span class="rec-txt">Sibling Information</span></div>
            ${linkedNotice}${hasTable}
        </section>`;
        }

        // ── Books / other fees / discounts (same math as the on-screen profile) ──
        const booksFee = parseFloat(s.booksFee || 0);
        const booksDiscount = parseFloat(s.booksDiscount || 0);
        let otherFeesArr = [];
        try { otherFeesArr = JSON.parse(s.otherFeesData || '[]'); } catch (e) { otherFeesArr = []; }
        otherFeesArr = otherFeesArr.filter(f => (parseFloat(f.amount || 0) > 0 || parseFloat(f.discount || 0) > 0));

        const otherFeeRowsHtml = otherFeesArr.map(f => `
                <div class="rec-field"><span class="rec-flabel">${esc(f.description || 'Other Fee')}:</span><span class="rec-fvalue">${fmtRs(f.amount)}</span></div>`).join('');
        const otherDiscountsTotal = otherFeesArr.reduce((sum, f) => sum + (parseFloat(f.discount || 0)), 0);

        const totalDiscount = [s.tuitionDiscount, s.transportDiscount, s.siblingDiscount, booksDiscount]
            .map(v => Number(v) || 0).reduce((a, b) => a + b, 0) + otherDiscountsTotal;

        // ── Certificate-on-file note (the actual document is viewed separately) ──
        const certNoticeHtml = s.certData ? `
            <div class="rec-field"><span class="rec-flabel">B-Form / Certificate:</span><span class="rec-fvalue" style="color:var(--sg-dark);"><i class="fas fa-check-circle"></i> On file with the school office</span></div>`
            : `<div class="rec-field"><span class="rec-flabel">B-Form / Certificate:</span><span class="rec-fvalue">Not on file</span></div>`;

        const safeFileName = (s.fullName || 'student').replace(/[^a-z0-9]+/gi, '_');

        const printWin = window.open('', '_blank', 'width=1000,height=1000');

        printWin.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Student Record — ${esc(s.fullName)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
    <style>
        @page { size: A4; margin: 0; }
        :root {
            --ink-900:#0f172a; --ink-700:#1e293b; --ink-500:#475569; --ink-400:#64748b;
            --line:#e2e8f0; --line-strong:#cbd5e1; --surface:#ffffff; --surface-tint:#f6fbf8;
            /* ── Sea Green palette (deliberately distinct from the Admission Form's steel-blue theme) ── */
            --sg:#2e8b57; --sg-dark:#1f6b44; --sg-deep:#134d32; --sg-light:#e8f7ee; --sg-line:#bfe3cd;
            --accent:#1f6b44; --amber:#b9791f;
        }
        * { box-sizing:border-box; margin:0; padding:0; }
        html, body { width:210mm; }
        body { font-family:'Inter', sans-serif; color:var(--ink-700); background:#dcefe3; }

        .toolbar { position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:center; gap:10px;
            padding:12px 16px; background:#0f172a; box-shadow:0 2px 10px rgba(0,0,0,.25); }
        .toolbar-hint { color:#94a3b8; font-size:12px; margin-right:auto; padding-left:4px; }
        .tb-btn { display:inline-flex; align-items:center; gap:7px; border:none; cursor:pointer; padding:9px 16px;
            border-radius:7px; font-family:'Inter',sans-serif; font-weight:600; font-size:12.5px; transition:opacity .15s; }
        .tb-btn:hover { opacity:.88; }
        .tb-btn:disabled { opacity:.55; cursor:default; }
        .tb-print { background:var(--sg); color:#fff; }
        .tb-share { background:#25D366; color:#fff; }
        .tb-close { background:#334155; color:#e2e8f0; }

        /* ── Different frame treatment: no gradient border frame like the Admission
           Form — instead a flat card with a bold top ribbon and a left rail. ── */
        .page-frame { width:210mm; min-height:297mm; margin:14px auto; padding:0; background:transparent; display:flex; }
        .page { width:100%; min-height:297mm; padding:0; position:relative; margin:0; background:#fff; border-radius:8px; box-shadow:0 1px 3px rgba(15,23,42,0.15); display:flex; flex-direction:column; overflow:hidden; }
        .rec-ribbon { height:9mm; width:100%; background:linear-gradient(90deg, var(--sg-deep) 0%, var(--sg) 55%, var(--sg-dark) 100%); flex-shrink:0; }
        .rec-body { padding:9mm 12mm 10mm; display:flex; flex-direction:column; flex:1; position:relative; }
        .rec-railtext { position:absolute; top:50%; right:-38px; transform:translateY(-50%) rotate(90deg); transform-origin:center; font-size:9px; letter-spacing:3px; text-transform:uppercase; color:var(--sg-line); font-weight:700; opacity:0.7; white-space:nowrap; pointer-events:none; }
        .watermark { position:absolute; bottom:14mm; right:8mm; font-size:52px; font-weight:800; letter-spacing:4px; color:var(--sg); opacity:0.05; text-transform:uppercase; white-space:nowrap; pointer-events:none; z-index:0; transform:rotate(-8deg); }
        .rec-header, .rec-title-wrap, .rec-section, .rec-footer { position:relative; z-index:1; }
        .rec-header { display:flex; align-items:center; justify-content:space-between; padding-bottom:9px; border-bottom:2px solid var(--sg-light); }
        .rec-crest { width:44px; height:44px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:18px;
            background:linear-gradient(135deg, var(--sg) 0%, var(--sg-deep) 100%); box-shadow:0 3px 10px rgba(19,77,50,0.35); overflow:hidden; }
        .rec-crest img { width:100%; height:100%; object-fit:cover; border-radius:12px; }
        .rec-school-name { font-size:17px; font-weight:800; color:var(--ink-900); line-height:1.15; }
        .rec-school-sub { font-size:8.6px; color:var(--sg-dark); text-transform:uppercase; margin-top:2px; letter-spacing:0.6px; font-weight:600; }
        .rec-meta-pill { display:flex; align-items:center; gap:6px; border:1px solid var(--sg-line); padding:5px 12px; border-radius:999px; background:var(--sg-light); }
        .rec-meta-pill i { color:var(--sg-dark); font-size:10px; }
        .rec-meta-value { font-family:'Roboto Mono', monospace; font-size:9.5px; color:var(--ink-900); }

        /* ── Title block: centered avatar + name, unlike the Admission Form's boxed title-bar ── */
        .rec-title-wrap { display:flex; align-items:center; gap:14px; margin-top:14px; padding:10px 4px 12px; }
        .rec-avatar { width:64px; height:64px; border-radius:50%; flex-shrink:0; overflow:hidden; border:3px solid var(--sg-light); box-shadow:0 0 0 2px var(--sg); background:var(--sg-light); display:flex; align-items:center; justify-content:center; color:var(--sg-dark); font-size:10px; text-align:center; }
        .rec-avatar img { width:100%; height:100%; object-fit:cover; }
        .rec-title-name { font-size:19px; font-weight:800; color:var(--ink-900); letter-spacing:0.2px; }
        .rec-title-tags { margin-top:5px; display:flex; gap:6px; flex-wrap:wrap; }
        .rec-tag { display:inline-flex; align-items:center; gap:5px; font-size:8.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:var(--sg-deep); background:var(--sg-light); border:1px solid var(--sg-line); padding:3px 9px; border-radius:999px; }

        .rec-section { margin-top:12px; }
        .rec-section-label { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
        .rec-ico { width:20px; height:20px; border-radius:50%; background:var(--sg); color:#fff; font-size:9.5px; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 2px 5px rgba(46,139,87,0.35); }
        .rec-txt { font-size:9.8px; font-weight:800; letter-spacing:1.1px; text-transform:uppercase; color:var(--sg-deep); }
        .rec-section-label::after { content:""; flex:1; height:1px; background:linear-gradient(90deg, var(--sg-line), transparent); }

        .rec-field-grid { display:grid; grid-template-columns:1fr 1fr 1fr; column-gap:14px; row-gap:8px; }
        .rec-field { display:flex; align-items:baseline; gap:5px; border-bottom:1px solid var(--line-strong); padding-bottom:3px; }
        .rec-flabel { font-size:7.2px; text-transform:uppercase; color:var(--ink-400); font-weight:700; white-space:nowrap; }
        .rec-fvalue { font-size:10px; font-weight:500; color:var(--ink-900); }

        .rec-panel { border:1px solid var(--sg-line); border-radius:8px; padding:9px 13px; background:var(--surface-tint); }
        .rec-panel-title { font-size:8px; font-weight:800; color:var(--sg-dark); margin-bottom:7px; text-transform:uppercase; padding-bottom:4px; border-bottom:1px solid var(--sg-line); letter-spacing:0.4px; }

        .rec-fee-summary { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:8px; padding:9px 14px; background:var(--sg-deep); border-radius:8px; }
        .rec-fee-summary .rec-net-label { font-size:8.3px; font-weight:700; text-transform:uppercase; color:#bfe3cd; }
        .rec-fee-summary .rec-net-value { font-family:'Roboto Mono', monospace; font-size:14px; font-weight:800; color:#fff; }
        .rec-fee-summary .rec-net-label span.disc-val { font-family:'Roboto Mono',monospace; color:#fff; font-weight:700; }

        .sibling-table { width:100%; border-collapse:collapse; border:1px solid var(--sg-line); border-radius:6px; overflow:hidden; }
        .sibling-table th, .sibling-table td { border:1px solid var(--sg-line); padding:5px 10px; text-align:left; }
        .sibling-table th { background:var(--sg-light); font-size:7.6px; text-transform:uppercase; letter-spacing:0.6px; color:var(--sg-dark); font-weight:700; }
        .sibling-table td { font-size:9.5px; color:var(--ink-900); font-weight:500; }
        .sibling-table tbody tr:nth-child(even) { background:var(--surface-tint); }
        .sibling-of-notice { display:flex; align-items:center; gap:8px; font-size:9.2px; font-weight:500; color:var(--ink-900); background:var(--sg-light); border:1px solid var(--sg-line); border-left:3px solid var(--sg); border-radius:0 6px 6px 0; padding:7px 12px; }
        .sibling-of-notice i { color:var(--sg-dark); font-size:11px; }

        .rec-footer { margin-top:auto; padding-top:14px; text-align:center; }
        .rec-footer-rule { height:2px; background:linear-gradient(90deg, transparent, var(--sg), transparent); margin-bottom:10px; }
        .rec-footer p { font-size:7.6px; color:var(--ink-400); text-transform:uppercase; letter-spacing:0.6px; }

        @media print {
            .toolbar { display:none !important; }
            html, body { width:210mm; height:297mm; background:#fff; }
            body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .page-frame { width:210mm; height:297mm; min-height:297mm; padding:0; margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .page { height:100%; min-height:0; box-shadow:none; border-radius:0; }
        }
    </style>
</head>
<body>
    <div class="toolbar no-print">
        <span class="toolbar-hint"><i class="fas fa-circle-info"></i> Review the record below, then print or share it.</span>
        <button class="tb-btn tb-print" onclick="window.print()"><i class="fas fa-print"></i> Print</button>
        <button class="tb-btn tb-share" id="recShareBtn" onclick="shareStudentRecordImage()"><i class="fab fa-whatsapp"></i> Share on WhatsApp</button>
        <button class="tb-btn tb-close" onclick="window.close()"><i class="fas fa-times"></i> Close</button>
    </div>
    <div class="page-frame" id="recPageFrame">
    <div class="page">
        <div class="rec-ribbon"></div>
        <div class="rec-body">
        <div class="watermark">${esc(schoolName).split(' ').slice(0,2).join(' ')}</div>
        <header class="rec-header">
            <div style="display:flex; gap:10px; align-items:center;">
                <div class="rec-crest">${recCrestInner}</div>
                <div>
                    <div class="rec-school-name">${esc(schoolName)}</div>
                    <div class="rec-school-sub">Complete Student Record</div>
                </div>
            </div>
            <div class="rec-meta-pill">
                <i class="fas fa-clock"></i>
                <span class="rec-meta-value">${printedOn}</span>
            </div>
        </header>

        <div class="rec-title-wrap">
            <div class="rec-avatar">
                ${photoSrc ? `<img src="${photoSrc}">` : '<span>NO<br>PHOTO</span>'}
            </div>
            <div>
                <div class="rec-title-name">${esc(s.fullName)}</div>
                <div class="rec-title-tags">
                    <span class="rec-tag"><i class="fas fa-hashtag"></i> ${esc(registrationNo)}</span>
                    <span class="rec-tag"><i class="fas fa-graduation-cap"></i> ${esc(s.studentClass || 'N/A')}${s.section ? ' - ' + esc(s.section) : ''}</span>
                    ${s.orphanStatus === 'Orphan' ? '<span class="rec-tag" style="color:#b91c1c;background:#fef2f2;border-color:#fecaca;"><i class="fas fa-heart"></i> Orphan</span>' : ''}
                </div>
            </div>
        </div>

        <section class="rec-section">
            <div class="rec-section-label"><span class="rec-ico"><i class="fas fa-graduation-cap"></i></span><span class="rec-txt">Academic Information</span></div>
            <div class="rec-field-grid">
                <div class="rec-field"><span class="rec-flabel">Registration No.:</span><span class="rec-fvalue" style="font-family:monospace;">${safeVal(registrationNo)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Roll No. (Class):</span><span class="rec-fvalue">${safeVal(s.rollNo)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Class / Section:</span><span class="rec-fvalue">${safeVal(s.studentClass)}${s.section ? ' - ' + esc(s.section) : ''}</span></div>
                <div class="rec-field"><span class="rec-flabel">Admission Date:</span><span class="rec-fvalue">${safeVal(s.admissionDate)}</span></div>
                ${s.siblingGroupId ? `<div class="rec-field"><span class="rec-flabel">Sibling Group ID:</span><span class="rec-fvalue">${esc(s.siblingGroupId)}</span></div>` : ''}
            </div>
        </section>

        <section class="rec-section">
            <div class="rec-section-label"><span class="rec-ico"><i class="fas fa-user"></i></span><span class="rec-txt">Personal Data</span></div>
            <div class="rec-field-grid">
                <div class="rec-field"><span class="rec-flabel">Gender:</span><span class="rec-fvalue">${safeVal(s.gender)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Date of Birth:</span><span class="rec-fvalue">${safeVal(s.dob)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Computed Age:</span><span class="rec-fvalue">${safeVal(s.age)}</span></div>
                <div class="rec-field"><span class="rec-flabel">B-Form / CNIC:</span><span class="rec-fvalue">${safeVal(s.studentBform)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Orphan Status:</span><span class="rec-fvalue">${safeVal(s.orphanStatus)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Previous School:</span><span class="rec-fvalue">${safeVal(s.previousSchool)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Previous Class:</span><span class="rec-fvalue">${safeVal(s.previousClass)}</span></div>
                <div class="rec-field" style="grid-column: span 2;"><span class="rec-flabel">Medical Conditions:</span><span class="rec-fvalue">${safeVal(s.medicalIssues)}</span></div>
                ${certNoticeHtml}
            </div>
        </section>

        <section class="rec-section">
            <div class="rec-section-label"><span class="rec-ico"><i class="fas fa-address-book"></i></span><span class="rec-txt">Guardian & Contact</span></div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
                <div class="rec-panel">
                    <div class="rec-panel-title">Guardian Details</div>
                    <div class="rec-field" style="margin-bottom:7px;"><span class="rec-flabel">Name:</span><span class="rec-fvalue">${safeVal(s.guardianName)}</span></div>
                    <div class="rec-field" style="margin-bottom:7px;"><span class="rec-flabel">Relation:</span><span class="rec-fvalue">${safeVal(s.guardianRole)}</span></div>
                    <div class="rec-field"><span class="rec-flabel">CNIC:</span><span class="rec-fvalue">${safeVal(s.guardianCnic)}</span></div>
                </div>
                <div class="rec-panel">
                    <div class="rec-panel-title">Contact Information</div>
                    <div class="rec-field" style="margin-bottom:7px;"><span class="rec-flabel">Phones:</span><span class="rec-fvalue">${safeVal(s.phone1)} / ${safeVal(s.phone2)}</span></div>
                    <div class="rec-field"><span class="rec-flabel">Permanent Address:</span><span class="rec-fvalue" style="font-size:9px;">${safeVal(s.permanentAddress)}</span></div>
                </div>
            </div>
        </section>

        <section class="rec-section">
            <div class="rec-section-label"><span class="rec-ico"><i class="fas fa-sack-dollar"></i></span><span class="rec-txt">Finance & Transport</span></div>
            <div class="rec-field-grid">
                <div class="rec-field"><span class="rec-flabel">Tuition Fee:</span><span class="rec-fvalue">${fmtRs(s.standardFee)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Admission Fee:</span><span class="rec-fvalue">${fmtRs(s.admissionFee || 0)}</span></div>
                <div class="rec-field"><span class="rec-flabel">Transport Fee:</span><span class="rec-fvalue">${fmtRs(s.transportFee)}</span></div>
                ${booksFee > 0 ? `<div class="rec-field"><span class="rec-flabel">Books Fee:</span><span class="rec-fvalue">${fmtRs(booksFee)}</span></div>` : ''}
                ${otherFeeRowsHtml}
            </div>
            <div class="rec-fee-summary">
                <span class="rec-net-label">Total Discount: <span class="disc-val">${fmtRs(totalDiscount)}</span></span>
                <span class="rec-net-label">Net Payable: <span class="rec-net-value">${fmtRs(s.netPayable)}</span></span>
            </div>
        </section>
        ${siblingHtml}

        <footer class="rec-footer">
            <div class="rec-footer-rule"></div>
            <p>This is a system-generated record from the Student Management System &nbsp;·&nbsp; ${esc(schoolName)}</p>
        </footer>
        </div>
    </div>
    </div>

    <script>
        async function shareStudentRecordImage() {
            const btn = document.getElementById('recShareBtn');
            const oldHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...';
            try {
                const target = document.getElementById('recPageFrame');
                const canvas = await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
                const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
                if (!blob) throw new Error('Capture failed');
                const filename = 'Student_Record_${esc(safeFileName)}.png';
                const file = new File([blob], filename, { type: 'image/png' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Student Record',
                        text: 'Student Record for ${esc(s.fullName || "")}'
                    });
                    return;
                }

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 4000);

                const msg = encodeURIComponent('Student Record for ${esc(s.fullName || "student")}.\\n(The record image has been downloaded — please attach "' + filename + '" in WhatsApp.)');
                window.open('https://wa.me/?text=' + msg, '_blank');
            } catch (err) {
                console.error('Share failed', err);
                alert('Sharing failed. The student record image could not be generated.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = oldHtml;
            }
        }
    <\/script>
</body>
</html>`);
        printWin.document.close();
        printWin.focus();
    }

    /**
     * Print the "Complete Student Record" for an EXISTING student, looked up by
     * regNo (falls back to id) from the live database. Used by the "Print
     * Record" button in the Student Profile modal footer, replacing the old
     * raw window.print() of the on-screen modal (which had no dedicated print
     * layout, no school letterhead, and printed the surrounding page chrome).
     */
    window.printStudentRecordForStudent = function(regNo) {
        const db = getDatabase();
        const s = db.find(x => x.regNo === regNo) || db.find(x => x.id === regNo);
        if (!s) {
            showToast("Not Found", "Could not locate this student's record to print.", "danger");
            return;
        }
        printStudentRecord(s);
    };

    // ── FOOTER "PRINT RECORD" BUTTON HANDLER ─────────────────────────────────
    // Prints the Complete Student Record for whichever student's profile is
    // currently open (tracked via profile-modal's data-current-reg-no).
    window.printCurrentStudentRecord = function() {
        const modal = document.getElementById('profile-modal');
        const regNo = modal ? modal.dataset.currentRegNo : null;
        if (regNo) window.printStudentRecordForStudent(regNo);
    };

    // ── CLASS / SECTION / WHOLE-SCHOOL STUDENT LIST PRINT ────────────────────
    /**
     * Build and open a print-ready "Student List" report — a compact table
     * (numbering, name, guardian name, combined Class-Section e.g. "2-A",
     * B-Form / CNIC No., Guardian CNIC, Contact No.) for either:
     *   - the ENTIRE school   → call with (ALL_STUDENTS_KEY, null)
     *   - one class, all sections → call with (className, null) or (className, 'ALL')
     *   - one class + one specific section → call with (className, sectionLetter)
     * Triggered from the small print buttons on the class/section selector
     * cards in the View Database / Update Record modals.
     */
    function buildStudentListReport(filterClass, filterSection) {
        const esc = escapeHtmlForPrint;
        const db = getActiveDatabase();

        let list = db;
        let scopeLabel = 'All Students — Every Class & Section';

        if (filterClass && filterClass !== ALL_STUDENTS_KEY) {
            list = list.filter(s => s.studentClass === filterClass);
            if (filterSection && filterSection !== 'ALL') {
                list = list.filter(s => s.section === filterSection);
                scopeLabel = `${filterClass} — Section ${filterSection}`;
            } else {
                scopeLabel = `${filterClass} — All Sections`;
            }
        }

        // Sort by class (if mixed), then section, then roll number, then name.
        list = list.slice().sort((a, b) => {
            const ca = (a.studentClass || '').localeCompare(b.studentClass || '', undefined, { numeric: true });
            if (ca !== 0) return ca;
            const sa = (a.section || '').localeCompare(b.section || '');
            if (sa !== 0) return sa;
            const ra = parseInt(a.rollNo) || 0, rb = parseInt(b.rollNo) || 0;
            if (ra !== rb) return ra - rb;
            return (a.fullName || '').localeCompare(b.fullName || '');
        });

        const schoolEl = document.querySelector('.school-name');
        const schoolName = schoolEl ? schoolEl.textContent.trim() : 'ST. LAWRENCE INTERNATIONAL SCHOOL';
        const schoolLogoUrl = getSchoolLogoUrl();
        const slCrestInner = schoolLogoUrl ? `<img src="${esc(schoolLogoUrl)}" alt="School Logo">` : `<i class="fas fa-users"></i>`;
        const printedOn = new Date().toLocaleDateString('en-US', {
            day: '2-digit', month: 'short', year: 'numeric'
        }) + '  ·  ' + new Date().toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: true
        });

        const rowsHtml = list.length === 0
            ? `<tr><td colspan="7" class="sl-empty">No student records found for this selection.</td></tr>`
            : list.map((s, idx) => {
                const classSection = `${s.studentClass || '—'}${s.section ? '-' + s.section : ''}`;
                return `
                <tr>
                    <td class="sl-num">${idx + 1}</td>
                    <td class="sl-name">${esc(s.fullName || '—')}</td>
                    <td>${esc(s.guardianName || '—')}</td>
                    <td class="sl-center"><span class="sl-chip">${esc(classSection)}</span></td>
                    <td class="sl-mono">${esc(s.studentBform || '—')}</td>
                    <td class="sl-mono">${esc(s.guardianCnic || '—')}</td>
                    <td class="sl-mono">${esc(s.phone1 || '—')}</td>
                </tr>`;
            }).join('');

        const printWin = window.open('', '_blank', 'width=1100,height=850');
        if (!printWin) {
            showToast('Pop-up Blocked', 'Please allow pop-ups to print the student list.', 'danger');
            return;
        }

        printWin.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Student List — ${esc(scopeLabel)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        @page { size: A4 landscape; margin: 10mm; }
        :root {
            --ink-900:#0f172a; --ink-700:#1e293b; --ink-500:#475569; --ink-400:#64748b;
            --line:#e2e8f0; --line-strong:#cbd5e1;
            --sg:#2e8b57; --sg-dark:#1f6b44; --sg-deep:#134d32; --sg-light:#e8f7ee; --sg-line:#bfe3cd;
        }
        * { box-sizing:border-box; margin:0; padding:0; }
        body { font-family:'Inter', sans-serif; color:var(--ink-700); background:#dcefe3; }

        .toolbar { position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:center; gap:10px;
            padding:12px 16px; background:#0f172a; box-shadow:0 2px 10px rgba(0,0,0,.25); }
        .toolbar-hint { color:#94a3b8; font-size:12px; margin-right:auto; padding-left:4px; }
        .tb-btn { display:inline-flex; align-items:center; gap:7px; border:none; cursor:pointer; padding:9px 16px;
            border-radius:7px; font-family:'Inter',sans-serif; font-weight:600; font-size:12.5px; transition:opacity .15s; }
        .tb-btn:hover { opacity:.88; }
        .tb-print { background:var(--sg); color:#fff; }
        .tb-share { background:#25D366; color:#fff; }
        .tb-close { background:#334155; color:#e2e8f0; }

        .sl-page { width:277mm; min-height:190mm; margin:16px auto; padding:10mm 12mm; background:#fff;
            border-radius:8px; box-shadow:0 1px 3px rgba(15,23,42,0.15); }

        .sl-header { display:flex; align-items:center; justify-content:space-between; padding-bottom:10px; border-bottom:2px solid var(--sg-light); }
        .sl-crest { width:44px; height:44px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:18px;
            background:linear-gradient(135deg, var(--sg) 0%, var(--sg-deep) 100%); box-shadow:0 3px 10px rgba(19,77,50,0.35); overflow:hidden; }
        .sl-crest img { width:100%; height:100%; object-fit:cover; border-radius:12px; }
        .sl-school-name { font-size:17px; font-weight:800; color:var(--ink-900); line-height:1.15; }
        .sl-school-sub { font-size:8.6px; color:var(--sg-dark); text-transform:uppercase; margin-top:2px; letter-spacing:0.6px; font-weight:600; }
        .sl-meta-pill { display:flex; align-items:center; gap:6px; border:1px solid var(--sg-line); padding:5px 12px; border-radius:999px; background:var(--sg-light); }
        .sl-meta-pill i { color:var(--sg-dark); font-size:10px; }
        .sl-meta-value { font-family:'Roboto Mono', monospace; font-size:9.5px; color:var(--ink-900); }

        .sl-title-row { display:flex; align-items:baseline; justify-content:space-between; margin-top:14px; margin-bottom:10px; }
        .sl-title { font-size:15px; font-weight:800; color:var(--ink-900); display:flex; align-items:center; gap:8px; }
        .sl-title i { color:var(--sg-dark); }
        .sl-count { font-size:10.5px; font-weight:700; color:var(--sg-dark); background:var(--sg-light); border:1px solid var(--sg-line); padding:3px 10px; border-radius:999px; }

        table.sl-table { width:100%; border-collapse:collapse; }
        table.sl-table thead th { background:var(--sg-deep); color:#fff; font-size:9px; text-transform:uppercase; letter-spacing:0.5px;
            font-weight:700; text-align:left; padding:7px 9px; }
        table.sl-table thead th.sl-center, table.sl-table td.sl-center { text-align:center; }
        table.sl-table tbody td { font-size:10.5px; padding:6px 9px; border-bottom:1px solid var(--line); color:var(--ink-900); }
        table.sl-table tbody tr:nth-child(even) { background:#f6fbf8; }
        table.sl-table td.sl-num { color:var(--ink-400); font-weight:600; width:28px; }
        table.sl-table td.sl-name { font-weight:700; }
        table.sl-table td.sl-mono { font-family:'Roboto Mono', monospace; font-size:9.5px; }
        table.sl-table td.sl-empty { text-align:center; padding:40px; color:var(--ink-400); }
        .sl-chip { display:inline-block; font-size:9.5px; font-weight:700; color:var(--sg-deep); background:var(--sg-light);
            border:1px solid var(--sg-line); padding:2px 9px; border-radius:999px; }

        .sl-footer { margin-top:16px; padding-top:10px; text-align:center; }
        .sl-footer-rule { height:2px; background:linear-gradient(90deg, transparent, var(--sg), transparent); margin-bottom:8px; }
        .sl-footer p { font-size:7.6px; color:var(--ink-400); text-transform:uppercase; letter-spacing:0.6px; }

        @media print {
            .toolbar { display:none !important; }
            body { background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .sl-page { width:100%; min-height:0; margin:0; padding:0; box-shadow:none; border-radius:0; }
            table.sl-table thead { display:table-header-group; }
            table.sl-table tr { page-break-inside:avoid; }
        }
    </style>
</head>
<body>
    <div class="toolbar no-print">
        <span class="toolbar-hint"><i class="fas fa-circle-info"></i> Review the list below, then print or share it.</span>
        <button class="tb-btn tb-share" onclick="shareStudentList()"><i class="fab fa-whatsapp"></i> Share</button>
        <button class="tb-btn tb-print" onclick="window.print()"><i class="fas fa-print"></i> Print</button>
        <button class="tb-btn tb-close" onclick="window.close()"><i class="fas fa-times"></i> Close</button>
    </div>
    <div class="sl-page">
        <header class="sl-header">
            <div style="display:flex; gap:10px; align-items:center;">
                <div class="sl-crest">${slCrestInner}</div>
                <div>
                    <div class="sl-school-name">${esc(schoolName)}</div>
                    <div class="sl-school-sub">Student List Report</div>
                </div>
            </div>
            <div class="sl-meta-pill">
                <i class="fas fa-calendar-day"></i>
                <span class="sl-meta-value">${esc(printedOn)}</span>
            </div>
        </header>

        <div class="sl-title-row">
            <div class="sl-title"><i class="fas fa-layer-group"></i> ${esc(scopeLabel)}</div>
            <div class="sl-count"><i class="fas fa-user-graduate"></i> ${list.length} Student${list.length === 1 ? '' : 's'}</div>
        </div>

        <table class="sl-table">
            <thead>
                <tr>
                    <th style="width:28px;">#</th>
                    <th>Student Name</th>
                    <th>Guardian / Father Name</th>
                    <th class="sl-center">Class-Section</th>
                    <th>B-Form / CNIC No.</th>
                    <th>Guardian CNIC</th>
                    <th>Contact No.</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>

        <div class="sl-footer">
            <div class="sl-footer-rule"></div>
            <p>Generated by EduFlow Pro · ${esc(schoolName)}</p>
        </div>
    </div>
    <script>
        var shareListData   = ${JSON.stringify(list.map(s => ({
            name: s.fullName || '—',
            guardian: s.guardianName || '—',
            cls: `${s.studentClass || '—'}${s.section ? '-' + s.section : ''}`,
            phone: s.phone1 || ''
        })))};
        var shareListLabel  = ${JSON.stringify(scopeLabel)};
        var shareListSchool = ${JSON.stringify(schoolName)};

        /* Share this list — Web Share API first (WhatsApp, Messages, Email, etc.
           on mobile), falling back to a WhatsApp Web link with the text prefilled. */
        function shareStudentList() {
            var lines = shareListData.map(function(s, i) {
                return (i + 1) + '. ' + s.name + ' (' + s.cls + ')' + (s.phone ? ' - ' + s.phone : '');
            });
            var text = '*' + shareListSchool + '*\n*Student List — ' + shareListLabel + '*\n' +
                'Total: ' + shareListData.length + ' student(s)\n\n' + lines.join('\n');

            if (navigator.share) {
                navigator.share({ title: 'Student List — ' + shareListLabel, text: text })
                    .catch(function(err) {
                        // Ignore the user simply cancelling the native share sheet.
                        if (err && err.name === 'AbortError') return;
                        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
                    });
            } else {
                window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
            }
        }
    </script>
</body>
</html>
        `);
        printWin.document.close();
    }

    /** Public entry point wired to the print buttons on the class/section cards. */
    window.printStudentListReport = function(filterClass, filterSection) {
        buildStudentListReport(filterClass, filterSection);
    };

    // ── 7. TABLE RENDERING ───────────────────────────────────────────────────

    /**
     * Render the Students Table.
     * Main table ALWAYS shows the PREFIX_X reg number — never the 00X sibling id.
     */
    // ── State for update database modal tabs ──────────────────────────────────
    let updActiveClass   = null;
    let updActiveSection = null;

    /**
     * Get the class teacher for a given class+section from staff management localStorage.
     * Staff data expected in 'edu_staff' key as array of {fullName, assignedClass, assignedSection, role}.
     */
    function getClassTeacher(className, section) {
        try {
            // Staff Management (manage-staff.js) persists via shared-data.js, which
            // stores everything under the 'eduflow-db' localStorage key. Reading from
            // 'edu_global_data' here was the bug — that key is never written to, so
            // the class-teacher lookup always silently failed.
            let allTeachers = [];
            try {
                const gd = (typeof getGlobalData === 'function')
                    ? getGlobalData()
                    : JSON.parse(localStorage.getItem('eduflow-db') || '{}');
                allTeachers = (gd.staff && Array.isArray(gd.staff['Teaching'])) ? gd.staff['Teaching'] : [];
            } catch(e) {}

            // Legacy fallbacks, kept in case older data was ever saved under these keys
            if (!allTeachers.length) {
                try {
                    const gd2 = JSON.parse(localStorage.getItem('edu_global_data') || '{}');
                    if (gd2.staff && Array.isArray(gd2.staff['Teaching'])) allTeachers = gd2.staff['Teaching'];
                } catch(e) {}
            }
            if (!allTeachers.length) {
                try { allTeachers = JSON.parse(localStorage.getItem('edu_staff') || '[]'); } catch(e) {}
            }

            for (const s of allTeachers) {
                // Check inchargeAssignments JSON (new format)
                if (s.inchargeAssignments) {
                    try {
                        const arr = JSON.parse(s.inchargeAssignments);
                        if (Array.isArray(arr)) {
                            const match = arr.find(a =>
                                a.cls === className &&
                                (section === 'ALL' || !section || a.section === section || a.section === '')
                            );
                            if (match) return s.name || s.fullName || null;
                        }
                    } catch(e) {}
                }
                // Fallback: check assignedClass/assignedSection fields
                if (s.assignedClass === className &&
                    (section === 'ALL' || !section || s.assignedSection === section || !s.assignedSection)) {
                    return s.name || s.fullName || null;
                }
            }
            return null;
        } catch(e) { return null; }
    }

    /** Update the class teacher badge in the update modal */
    function updRefreshTeacherBadge() {
        const badge   = document.getElementById('upd-class-teacher-badge');
        const nameEl  = document.getElementById('upd-teacher-name');
        const topName = document.getElementById('upd-class-incharge-name');
        const topWrap = document.getElementById('upd-class-incharge-top');

        // "All Students" view has no single class, so hide the incharge readout
        if (!updActiveClass || updActiveClass === ALL_STUDENTS_KEY) {
            if (badge) badge.style.display = 'none';
            if (topWrap) topWrap.style.display = 'none';
            return;
        }
        if (topWrap) topWrap.style.display = '';

        const teacher = getClassTeacher(updActiveClass, updActiveSection);
        // Inline badge next to sections (only when assigned)
        if (badge && nameEl) {
            if (teacher) {
                nameEl.textContent = teacher;
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        }
        // Top-row badge — always visible, shows assigned name or "Not Assigned"
        if (topName && topWrap) {
            topName.textContent = teacher || 'Not Assigned';
            topWrap.classList.toggle('upd-class-incharge-top--none', !teacher);
        }
    }

    /** Update the class teacher badge in the view-only modal */
    function voRefreshTeacherBadge() {
        const badge   = document.getElementById('vo-class-teacher-badge');
        const nameEl  = document.getElementById('vo-teacher-name');
        const topName = document.getElementById('vo-class-incharge-name');
        const topWrap = document.getElementById('vo-class-incharge-top');

        // "All Students" view has no single class, so hide the incharge readout
        if (!voActiveClass || voActiveClass === ALL_STUDENTS_KEY) {
            if (badge) badge.style.display = 'none';
            if (topWrap) topWrap.style.display = 'none';
            return;
        }
        if (topWrap) topWrap.style.display = '';

        const teacher = getClassTeacher(voActiveClass, voActiveSection);
        if (badge && nameEl) {
            if (teacher) {
                nameEl.textContent = teacher;
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        }
        if (topName && topWrap) {
            topName.textContent = teacher || 'Not Assigned';
            topWrap.classList.toggle('upd-class-incharge-top--none', !teacher);
        }
    }

    /** Show one of the three Edit-modal stages: 'classes' | 'sections' | 'table' */
    function updShowStage(stage) {
        ['classes', 'sections', 'table'].forEach(s => {
            const el = document.getElementById('upd-stage-' + s);
            if (el) el.classList.toggle('hidden', s !== stage);
        });
    }

    /**
     * Render the class-cards grid for the Edit modal — an "All Students" master
     * card plus one card per class configured in Settings (edu_class_configs),
     * regardless of whether that class has any students yet.
     */
    function updRenderClassCards() {
        const configs = getClassConfigs();
        const db      = getActiveDatabase();
        const grid    = document.getElementById('upd-classes-grid');
        if (!grid) return;

        let html = `
            <div class="msc-class-card msc-class-card--all" onclick="updOpenAllStudents()">
                <div class="class-name"><i class="fas fa-users"></i> All Students</div>
                <div class="class-meta">Every class &amp; section</div>
                <div class="class-count"><i class="fas fa-user-graduate"></i> ${db.length} students</div>
            </div>
        `;

        if (configs.length === 0) {
            html += `<div style="grid-column:1/-1;text-align:center;padding:32px 12px;color:var(--text-muted);">
                <i class="fas fa-school" style="font-size:2rem;margin-bottom:10px;display:block;opacity:0.4;"></i>
                No classes configured yet. Add classes in <a href="settings.html" style="color:var(--accent-primary);">Admin Settings</a>.
            </div>`;
        } else {
            configs.forEach(c => {
                const count    = db.filter(s => s.studentClass === c.name).length;
                const sections = (Array.isArray(c.sections) && c.sections.length) ? c.sections.join(', ') : 'No sections configured';
                html += `
                    <div class="msc-class-card" onclick="updOpenClass('${c.name}')">
                        <div class="class-name">${c.name}</div>
                        <div class="class-meta">Sections: ${sections}</div>
                        <div class="class-count"><i class="fas fa-users"></i> ${count} students</div>
                    </div>
                `;
            });
        }

        grid.innerHTML = html;
    }

    /** Render the section-cards grid for the active class in the Edit modal */
    function updRenderSectionCards() {
        const grid    = document.getElementById('upd-sections-grid');
        const titleEl = document.getElementById('upd-sections-title');
        if (titleEl) titleEl.textContent = updActiveClass;
        if (!grid) return;

        const cfg      = getClassConfigMap()[updActiveClass];
        const sections = (cfg && Array.isArray(cfg.sections) && cfg.sections.length) ? cfg.sections : [];
        const db       = getActiveDatabase();
        const classStu = db.filter(s => s.studentClass === updActiveClass);
        const allTeacher = getClassTeacher(updActiveClass, 'ALL');

        let html = `
            <div class="msc-incharge-header" style="grid-column:1/-1;">
                <i class="fas fa-chalkboard-teacher"></i>
                <span>Class Incharge: <strong>${allTeacher || 'Not Assigned'}</strong></span>
            </div>
            <div class="msc-class-card msc-class-card--all" onclick="updOpenSection('ALL')">
                <div class="class-name"><i class="fas fa-layer-group"></i> All Sections</div>
                <div class="class-meta">All ${classStu.length} students</div>
                <div class="class-count"><i class="fas fa-users"></i> ${classStu.length} students</div>
            </div>
        `;

        if (sections.length === 0) {
            html += `<div style="grid-column:1/-1;text-align:center;padding:24px 12px;color:var(--text-muted);">
                No sections configured for this class in <a href="settings.html" style="color:var(--accent-primary);">Admin Settings</a>.
            </div>`;
        } else {
            sections.forEach(sec => {
                const cnt = classStu.filter(s => s.section === sec).length;
                const t   = getClassTeacher(updActiveClass, sec);
                html += `
                    <div class="msc-class-card" onclick="updOpenSection('${sec}')">
                        <div class="class-name">Section ${sec}</div>
                        <div class="class-meta">${t ? 'Incharge: ' + t : 'No incharge assigned'}</div>
                        <div class="class-count"><i class="fas fa-users"></i> ${cnt} students</div>
                    </div>
                `;
            });
        }

        grid.innerHTML = html;
    }

    /** "All Students" card clicked — skip class/section filtering entirely */
    window.updOpenAllStudents = function() {
        updActiveClass   = ALL_STUDENTS_KEY;
        updActiveSection = null;
        const srch = document.getElementById('upd-search-input');
        if (srch) srch.value = '';
        const titleEl = document.getElementById('upd-table-context-title');
        if (titleEl) titleEl.textContent = 'All Students';
        updShowStage('table');
        updRefreshTeacherBadge();
        renderStudentTable();
    };

    /** A class card was clicked — move to the section-cards stage */
    window.updOpenClass = function(className) {
        updActiveClass   = className;
        updActiveSection = null;
        updRenderSectionCards();
        updShowStage('sections');
    };

    /** A section card (or "All Sections") was clicked — show the student table */
    window.updOpenSection = function(section) {
        updActiveSection = section;
        const srch = document.getElementById('upd-search-input');
        if (srch) srch.value = '';
        const titleEl = document.getElementById('upd-table-context-title');
        if (titleEl) {
            titleEl.textContent = section === 'ALL'
                ? `${updActiveClass} — All Sections`
                : `${updActiveClass} — Section ${section}`;
        }
        updShowStage('table');
        updRefreshTeacherBadge();
        renderStudentTable();
    };

    /** Back button: table -> sections (or straight to classes if we came from "All Students") */
    window.updBackToSections = function() {
        if (updActiveClass === ALL_STUDENTS_KEY) { window.updBackToClasses(); return; }
        updActiveSection = null;
        updRenderSectionCards();
        updShowStage('sections');
    };

    /** Back button: sections -> classes */
    window.updBackToClasses = function() {
    updActiveClass = null;
    updActiveSection = null;
    updOrphanFilterActive = false; // Reset filter
    const updOrphanBtn = document.getElementById('upd-orphan-filter-btn');
    if (updOrphanBtn) {
        updOrphanBtn.classList.remove('active-filter');
        updOrphanBtn.setAttribute('aria-pressed', 'false');
        updOrphanBtn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
    }
    updRenderClassCards();
    updShowStage('classes');
};

    window.renderStudentTable = function() {
    const db = getActiveDatabase(); 
    const tbody = document.getElementById('student-list-tbody');
    if (!tbody) return;

    tbody.innerHTML = "";

    // Determine filter context
    const useTabFilter = (updActiveClass !== null && updActiveClass !== ALL_STUDENTS_KEY);
    const qUnified = (document.getElementById('upd-search-input') ? document.getElementById('upd-search-input').value : '').toLowerCase().trim();

    let filtered = db;

    // 1. Filter by Class
    if (useTabFilter && updActiveClass) {
        filtered = filtered.filter(s => s.studentClass === updActiveClass);
    }

    // 2. Filter by Section
    if (useTabFilter && updActiveSection && updActiveSection !== 'ALL') {
        filtered = filtered.filter(s => s.section === updActiveSection);
    }

    // 3. Filter by Orphan Status (New Feature)
    if (updOrphanFilterActive) {
        filtered = filtered.filter(s => s.orphanStatus === 'Orphan');
    }

    // 4. Filter by Search Query (Name, ID, Guardian)
    if (qUnified) {
        filtered = filtered.filter(s => studentMatchesSearch(s, qUnified));
    }

    // 5. Sort by Roll Number
    filtered.sort((a, b) => (parseInt(a.rollNo) || 0) - (parseInt(b.rollNo) || 0));

    // UI Adjustments for Headers
    const showClassCol = (updActiveClass === ALL_STUDENTS_KEY);
    const updClassColHeader = document.getElementById('upd-class-col-header');
    if (updClassColHeader) updClassColHeader.textContent = showClassCol ? 'Class' : 'Section';

    const promoteMode = document.body.classList.contains('promote-mode-active');

    // Handle Empty State
    if (filtered.length === 0) {
        const colCount = promoteMode ? 11 : 10;
        const emptyMsg = updOrphanFilterActive
            ? '<i class="fas fa-child" style="font-size:22px;display:block;margin-bottom:10px;opacity:0.6;"></i>No orphan records found.'
            : 'No matching records found.';
        tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;padding:50px;color:#94a3b8;">${emptyMsg}</td></tr>`;
        return;
    }

    // Render Rows
    filtered.forEach((s, idx) => {
        const displayId = s.regNo || s.id;
        const siblingTag = (s.isSibling && s.siblingOf)
            ? `<br><span class="sibling-tag"><i class="fas fa-user-friends"></i> Sibling of ${s.siblingOf}</span>`
            : '';

        // Checkbox for Promotion Mode
        const checkboxCell = promoteMode
            ? `<td><input type="checkbox" class="promote-checkbox" data-regno="${s.regNo}" ${s.promoted ? '' : 'checked'} style="width:18px;height:18px;"></td>`
            : '';

        // Status Badge for Promotion Mode
        const statusCell = promoteMode
            ? `<td>${s.promoted
                    ? '<span class="promotion-status-badge promoted"><i class="fas fa-check-circle"></i> Promoted</span>'
                    : '<span class="promotion-status-badge pending"><i class="fas fa-hourglass-half"></i> Not Promoted</span>'}</td>`
            : '';

        const classSectionCell = showClassCol
            ? `${s.studentClass || '—'}${s.section ? ' ' + s.section : ''}`
            : (s.section || '—');

        const row = `
            <tr class="${s.orphanStatus === 'Orphan' ? 'orphan-highlight' : ''}">
                ${checkboxCell}
                <td class="msc-sr-cell">${idx + 1}</td>
                <td><span class="hrk-id-badge">${displayId}</span></td>
                <td>${s.rollNo || '—'}</td>
                <td>
                    <strong>${s.fullName}</strong>
                    ${s.orphanStatus === 'Orphan' ? ' <i class="fas fa-heart" style="color:#ef4444; font-size:10px;" title="Orphan"></i>' : ''}
                    ${siblingTag}
                </td>
                <td>${s.guardianName}</td>
                <td><span class="class-chip">${classSectionCell}</span></td>
                <td>${s.gender}</td>
                ${statusCell}
                <td>
                    <div class="action-btn-group">
                        <button class="btn-icon view" onclick="viewFullProfile('${s.regNo}')" title="View Profile"><i class="fas fa-eye"></i></button>
                        <button class="btn-icon edit" onclick="editStudentInfo('${s.regNo}')" title="Edit Record"><i class="fas fa-user-edit"></i></button>
                        <button class="btn-icon delete" onclick="deleteRecord('${s.regNo}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
};


    // ── VIEW-ONLY TABLE (read-only directory with class/section tabs) ─────────

    // State for view-only modal tabs
    let voActiveClass   = null;  // currently selected class name
    let voActiveSection = null;  // currently selected section, or 'ALL'

    /** Show one of the three View-only modal stages: 'classes' | 'sections' | 'table' */
    function voShowStage(stage) {
        ['classes', 'sections', 'table'].forEach(s => {
            const el = document.getElementById('vo-stage-' + s);
            if (el) el.classList.toggle('hidden', s !== stage);
        });
    }

    /**
     * Render the class-cards grid for the View-only modal — an "All Students"
     * master card plus one card per class configured in Settings, regardless
     * of whether that class currently has any students.
     */
    function voRenderClassCards() {
        const configs = getClassConfigs();
        const db      = getActiveDatabase();
        const grid    = document.getElementById('vo-classes-grid');
        if (!grid) return;

        let html = `
            <div class="msc-class-card msc-class-card--all" onclick="voOpenAllStudents()">
                <button type="button" class="msc-print-btn" onclick="event.stopPropagation(); printStudentListReport('${ALL_STUDENTS_KEY}', null);" title="Print full school student list"><i class="fas fa-print"></i></button>
                <div class="class-name"><i class="fas fa-users"></i> All Students</div>
                <div class="class-meta">Every class &amp; section</div>
                <div class="class-count"><i class="fas fa-user-graduate"></i> ${db.length} students</div>
            </div>
        `;

        if (configs.length === 0) {
            html += `<div style="grid-column:1/-1;text-align:center;padding:32px 12px;color:var(--text-muted);">
                <i class="fas fa-school" style="font-size:2rem;margin-bottom:10px;display:block;opacity:0.4;"></i>
                No classes configured yet. Add classes in <a href="settings.html" style="color:var(--accent-primary);">Admin Settings</a>.
            </div>`;
        } else {
            configs.forEach(c => {
                const count    = db.filter(s => s.studentClass === c.name).length;
                const sections = (Array.isArray(c.sections) && c.sections.length) ? c.sections.join(', ') : 'No sections configured';
                html += `
                    <div class="msc-class-card" onclick="voOpenClass('${c.name}')">
                        <button type="button" class="msc-print-btn" onclick="event.stopPropagation(); printStudentListReport('${c.name}', null);" title="Print ${c.name} student list"><i class="fas fa-print"></i></button>
                        <div class="class-name">${c.name}</div>
                        <div class="class-meta">Sections: ${sections}</div>
                        <div class="class-count"><i class="fas fa-users"></i> ${count} students</div>
                    </div>
                `;
            });
        }

        grid.innerHTML = html;
    }

    /** Render the section-cards grid for the currently active class */
    function voRenderSectionCards() {
        const grid    = document.getElementById('vo-sections-grid');
        const titleEl = document.getElementById('vo-sections-title');
        if (titleEl) titleEl.textContent = voActiveClass;
        if (!grid) return;

        const cfg      = getClassConfigMap()[voActiveClass];
        const sections = (cfg && Array.isArray(cfg.sections) && cfg.sections.length) ? cfg.sections : [];
        const db       = getActiveDatabase();
        const classStudents = db.filter(s => s.studentClass === voActiveClass);
        const allTeacher = getClassTeacher(voActiveClass, 'ALL');

        let html = `
            <div class="msc-incharge-header" style="grid-column:1/-1;">
                <i class="fas fa-chalkboard-teacher"></i>
                <span>Class Incharge: <strong>${allTeacher || 'Not Assigned'}</strong></span>
            </div>
            <div class="msc-class-card msc-class-card--all" onclick="voOpenSection('ALL')">
                <button type="button" class="msc-print-btn" onclick="event.stopPropagation(); printStudentListReport('${voActiveClass}', 'ALL');" title="Print ${voActiveClass} — all sections student list"><i class="fas fa-print"></i></button>
                <div class="class-name"><i class="fas fa-layer-group"></i> All Sections</div>
                <div class="class-meta">All ${classStudents.length} students</div>
                <div class="class-count"><i class="fas fa-users"></i> ${classStudents.length} students</div>
            </div>
        `;

        if (sections.length === 0) {
            html += `<div style="grid-column:1/-1;text-align:center;padding:24px 12px;color:var(--text-muted);">
                No sections configured for this class in <a href="settings.html" style="color:var(--accent-primary);">Admin Settings</a>.
            </div>`;
        } else {
            sections.forEach(sec => {
                const cnt = classStudents.filter(s => s.section === sec).length;
                const t   = getClassTeacher(voActiveClass, sec);
                html += `
                    <div class="msc-class-card" onclick="voOpenSection('${sec}')">
                        <button type="button" class="msc-print-btn" onclick="event.stopPropagation(); printStudentListReport('${voActiveClass}', '${sec}');" title="Print ${voActiveClass} — Section ${sec} student list"><i class="fas fa-print"></i></button>
                        <div class="class-name">Section ${sec}</div>
                        <div class="class-meta">${t ? 'Incharge: ' + t : 'No incharge assigned'}</div>
                        <div class="class-count"><i class="fas fa-users"></i> ${cnt} students</div>
                    </div>
                `;
            });
        }

        grid.innerHTML = html;
    }

    /** "All Students" card clicked — skip class/section filtering entirely */
    window.voOpenAllStudents = function() {
        voActiveClass   = ALL_STUDENTS_KEY;
        voActiveSection = null;
        const srch = document.getElementById('vo-search-name');
        if (srch) srch.value = '';
        const titleEl = document.getElementById('vo-table-context-title');
        if (titleEl) titleEl.textContent = 'All Students';
        voShowStage('table');
        renderViewOnlyTable();
    };

    /** A class card was clicked — move to the section-cards stage */
    window.voOpenClass = function(className) {
        voActiveClass   = className;
        voActiveSection = null;
        voRenderSectionCards();
        voShowStage('sections');
    };

    /** A section card (or "All Sections") was clicked — show the student table */
    window.voOpenSection = function(section) {
        voActiveSection = section;
        const srch = document.getElementById('vo-search-name');
        if (srch) srch.value = '';
        const titleEl = document.getElementById('vo-table-context-title');
        if (titleEl) {
            titleEl.textContent = section === 'ALL'
                ? `${voActiveClass} — All Sections`
                : `${voActiveClass} — Section ${section}`;
        }
        voShowStage('table');
        renderViewOnlyTable();
    };

    /** Back button: table -> sections (or straight to classes if we came from "All Students") */
    window.voBackToSections = function() {
        if (voActiveClass === ALL_STUDENTS_KEY) { window.voBackToClasses(); return; }
        voActiveSection = null;
        voRenderSectionCards();
        voShowStage('sections');
    };

    /** Back button: sections -> classes */
    window.voBackToClasses = function() {
    voActiveClass = null;
    voActiveSection = null;
    voOrphanFilterActive = false; // Reset filter
    const voOrphanBtn = document.getElementById('vo-orphan-filter-btn');
    if (voOrphanBtn) {
        voOrphanBtn.classList.remove('active-filter');
        voOrphanBtn.setAttribute('aria-pressed', 'false');
        voOrphanBtn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
    }
    voRenderClassCards();
    voShowStage('classes');
};

    window.renderViewOnlyTable = function() {
    // Refresh the teacher badge if logic exists
    try { if(typeof voRefreshTeacherBadge === 'function') voRefreshTeacherBadge(); } catch(e) {}
    
    const db = getActiveDatabase();
    const tbody = document.getElementById('vo-student-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const qName = (document.getElementById('vo-search-name') ? document.getElementById('vo-search-name').value : '').toLowerCase().trim();

    let filtered = db;

    // 1. Filter by Class
    if (voActiveClass && voActiveClass !== ALL_STUDENTS_KEY) {
        filtered = filtered.filter(s => s.studentClass === voActiveClass);

        // 2. Filter by Section
        if (voActiveSection && voActiveSection !== 'ALL') {
            filtered = filtered.filter(s => s.section === voActiveSection);
        }
    }

    // 3. Filter by Orphan Status (New Feature)
    if (voOrphanFilterActive) {
        filtered = filtered.filter(s => s.orphanStatus === 'Orphan');
    }

    // 4. Filter by Search Query
    if (qName) {
        filtered = filtered.filter(s => studentMatchesSearch(s, qName));
    }

    // Handle Empty State
    if (filtered.length === 0) {
        const emptyMsg = voOrphanFilterActive
            ? '<i class="fas fa-child" style="font-size:22px;display:block;margin-bottom:10px;opacity:0.6;"></i>No orphan records found.'
            : 'No matching records found.';
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:50px;color:#94a3b8;">${emptyMsg}</td></tr>`;
        return;
    }

    // 5. Sort by Roll Number
    filtered.sort((a, b) => (parseInt(a.rollNo) || 0) - (parseInt(b.rollNo) || 0));

    // UI Adjustments for Headers
    const showClassCol = (voActiveClass === ALL_STUDENTS_KEY);
    const voClassColHeader = document.getElementById('vo-class-col-header');
    if (voClassColHeader) voClassColHeader.textContent = showClassCol ? 'Class' : 'Section';

    // Render Rows
    filtered.forEach((s, idx) => {
        const displayId = s.regNo || s.id;
        const siblingTag = (s.isSibling && s.siblingOf)
            ? `<br><span class="sibling-tag"><i class="fas fa-user-friends"></i> Sibling of ${s.siblingOf}</span>`
            : '';
        
        const classSectionCell = showClassCol
            ? `${s.studentClass || '—'}${s.section ? ' ' + s.section : ''}`
            : (s.section || '—');

        tbody.innerHTML += `
            <tr class="${s.orphanStatus === 'Orphan' ? 'orphan-highlight' : ''}">
                <td class="msc-sr-cell">${idx + 1}</td>
                <td><span class="hrk-id-badge">${displayId}</span></td>
                <td>${s.rollNo || '—'}</td>
                <td>
                    <strong>${s.fullName}</strong>
                    ${s.orphanStatus === 'Orphan' ? ' <i class="fas fa-heart" style="color:#ef4444; font-size:10px;" title="Orphan"></i>' : ''}
                    ${siblingTag}
                </td>
                <td>${s.guardianName}</td>
                <td><span class="class-chip">${classSectionCell}</span></td>
                <td>${s.gender}</td>
                <td style="text-align:center;">
                    <div class="vo-action-btn-group">
                        <button class="btn-icon vo-view" onclick="viewFullProfile('${s.regNo}')" title="View Profile">
                            <i class="fas fa-eye"></i><span>View</span>
                        </button>
                        <button class="btn-icon print-admission" onclick="printAdmissionFormForStudent('${s.regNo}')" title="Print Admission Form">
                            <i class="fas fa-file-signature"></i><span>Admission</span>
                        </button>
                        <button class="btn-icon print-record" onclick="printStudentRecordForStudent('${s.regNo}')" title="Print Student Record">
                            <i class="fas fa-print"></i><span>Record</span>
                        </button>
                    </div>
                </td>
            </tr>`;
    });
};
    // Wire view-only search to re-render
    const voSearchEl = document.getElementById('vo-search-name');
    if (voSearchEl) voSearchEl.addEventListener('input', renderViewOnlyTable);

    // Wire update-database search bar
    const updSearchEl = document.getElementById('upd-search-input');
    if (updSearchEl) updSearchEl.addEventListener('input', renderStudentTable);

    // Re-sync class cards if settings change in another tab
    window.addEventListener('storage', (e) => {
        if (e.key === SETTINGS_CLASSES_KEY) {
            if (document.getElementById('vo-stage-classes') && !document.getElementById('vo-stage-classes').classList.contains('hidden')) {
                voRenderClassCards();
            }
            if (document.getElementById('upd-stage-classes') && !document.getElementById('upd-stage-classes').classList.contains('hidden')) {
                updRenderClassCards();
            }
        }
    });

    // ── PROMOTE ALL STUDENTS ─────────────────────────────────────────────────

    // Fallback progression, only used if no classes have been configured yet
    // in Settings (edu_class_configs).
    const CLASS_PROGRESSION = [
        "Montessori", "Nursery", "Prep",
        "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5",
        "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10"
    ];

    /**
     * The real class ladder is whatever the school configured on the Settings
     * page (could stop at Grade 5, Grade 10, or anywhere else). Promoting a
     * student out of the LAST class in this list is what triggers graduation.
     */
    function getClassProgression() {
        const configs = getClassConfigs();
        if (Array.isArray(configs) && configs.length) return configs.map(c => c.name);
        return CLASS_PROGRESSION;
    }

    function getNextClass(currentClass) {
        const progression = getClassProgression();
        const idx = progression.indexOf(currentClass);
        if (idx === -1 || idx === progression.length - 1) return null; // unknown or final (graduating) class
        return progression[idx + 1];
    }

    window.togglePromoteMode = function() {
        const active = document.body.classList.toggle('promote-mode-active');
        const header = document.getElementById('promote-checkbox-header');
        const statusHeader = document.getElementById('promote-status-header');
        const actionsBar = document.getElementById('promote-actions-bar');
        const promoteBtn = document.getElementById('promote-all-btn');

        if (header) header.style.display = active ? '' : 'none';
        if (statusHeader) statusHeader.style.display = active ? '' : 'none';
        if (actionsBar) actionsBar.style.display = active ? 'flex' : 'none';
        if (promoteBtn) promoteBtn.style.display = active ? 'none' : '';

        renderStudentTable();
    };

    window.confirmPromotion = function() {
        const checkboxes = document.querySelectorAll('.promote-checkbox');
        const selectedRegNos = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.regno);

        if (selectedRegNos.length === 0) {
            showToast("No Students Selected", "Select at least one student to promote.", "warning");
            return;
        }

        const db = getDatabase();

        // How many of the selected students are being promoted OUT of the
        // school's last configured class — those are the ones that will land
        // in the Archive Center as "graduated", so they're what counts against
        // the plan's archiveStudentLimit.
        const willGraduateCount = db.filter(s =>
            selectedRegNos.includes(s.regNo) && !getNextClass(s.studentClass)
        ).length;

        if (willGraduateCount > 0 && !canArchiveMoreStudents(willGraduateCount)) {
            const limit = getArchiveLimit();
            const used  = getGraduatedStudents().length + getDroppedStudents().length;
            showToast(
                "Archive Limit Reached",
                `This would move ${willGraduateCount} student(s) into the archive, but your plan only allows ${limit} archived students (currently ${used}). Deselect some students or upgrade your plan.`,
                "danger"
            );
            return;
        }

        if (!confirm(`Promote ${selectedRegNos.length} selected student(s) to their next class?`)) return;

        const todayISO = new Date().toISOString().slice(0, 10);
        const thisYear = new Date().getFullYear();
        let promotedCount = 0;
        let graduatedCount = 0;

        db.forEach(s => {
            if (selectedRegNos.includes(s.regNo)) {
                const nextClass = getNextClass(s.studentClass);
                if (nextClass) {
                    s.studentClass = nextClass;
                    s.rollNo = generateClassRollNumber(nextClass);
                    s.promoted = true;
                    promotedCount++;
                } else {
                    // Being promoted out of the school's LAST configured class
                    // means this student has completed school — graduate them
                    // into the Archive Center instead of leaving them stuck.
                    s.status           = 'graduated';
                    s.graduatedDate    = todayISO;
                    s.graduatedYear    = thisYear;
                    s.graduatedClass   = s.studentClass;
                    s.graduatedSection = s.section || '';
                    s.promoted         = true;
                    graduatedCount++;
                }
            }
        });

        saveDatabase(db);
        showToast(
            "Promotion Complete",
            `${promotedCount} student(s) promoted.` + (graduatedCount ? ` ${graduatedCount} graduated and moved to the Archive Center.` : ''),
            "success"
        );

        togglePromoteMode();
        updateDashboardStats();
    };

    // ── ARCHIVE CENTER ───────────────────────────────────────────────────────
    // Two archives: "graduated" (promoted out of the school's final configured
    // class) and "dropped" (removed via the Delete button). Both are read-only
    // browsing views — records live permanently in the same DB_KEY store, just
    // filtered out of every active list by their `status` field.

    /** Open the Archive Center inline page (same pattern as Certificates / Data I-O) */
    window.openArchivePage = function() {
        _hideMainSections();
        const certView   = document.getElementById('cert-page-view');
        const dataIoView = document.getElementById('data-io-page-view');
        const archiveView= document.getElementById('archive-page-view');
        if (certView)    certView.style.display = 'none';
        if (dataIoView)  dataIoView.style.display = 'none';
        if (archiveView) archiveView.style.display = 'block';
        archiveBackToHub();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.closeArchivePage = function() {
        const archiveView = document.getElementById('archive-page-view');
        if (archiveView) archiveView.style.display = 'none';
        _showMainSections();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    function archiveShowStage(stage) {
        ['hub', 'graduated', 'dropped'].forEach(s => {
            const el = document.getElementById('archive-stage-' + s);
            if (el) el.classList.toggle('hidden', s !== stage);
        });
    }

    window.archiveBackToHub = function() {
        archiveShowStage('hub');
    };

    /** Section filter state for the graduated "class roster" table: 'BOTH' | 'A' | 'B' | any configured section value */
    let archiveGradSection = 'BOTH';
    window.archiveSetGradSection = function(val) {
        archiveGradSection = val;
        document.querySelectorAll('#archive-grad-section-seg .archive-seg-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.val === val);
        });
        renderArchiveGraduatedTable();
    };

    window.archiveOpenGraduated = function() {
        archiveShowStage('graduated');
        archiveGradSection = 'BOTH';
        document.querySelectorAll('#archive-grad-section-seg .archive-seg-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.val === 'BOTH');
        });
        const classSearch = document.getElementById('archive-grad-class-search');
        if (classSearch) classSearch.value = '';
        archivePopulateGradClassFilter();
        renderArchiveGraduatedTable();
    };

    window.archiveOpenDropped = function() {
        archiveShowStage('dropped');
        const dropSearch = document.getElementById('archive-drop-search');
        if (dropSearch) dropSearch.value = '';
        renderArchiveDroppedTable();
    };

    /** Populate the class dropdown for the graduated "class roster" filter bar */
    function archivePopulateGradClassFilter() {
        const sel = document.getElementById('archive-grad-class-filter');
        if (!sel) return;

        const configNames = getClassConfigs().map(c => c.name);
        const grads       = getGraduatedStudents();
        const classNames  = configNames.slice();
        grads.forEach(s => {
            if (s.graduatedClass && !classNames.includes(s.graduatedClass)) classNames.push(s.graduatedClass);
        });

        const current = sel.value;
        sel.innerHTML = `<option value="${ALL_STUDENTS_KEY}">All Classes</option>` +
            classNames.map(c => `<option value="${c}">${c}</option>`).join('');
        if (current && Array.from(sel.options).some(o => o.value === current)) sel.value = current;
    }

    /** Single merged table inside Graduated: full roster across ALL graduating batches, filterable by class / section / year */
    window.renderArchiveGraduatedTable = function() {
        const tbody = document.getElementById('archive-grad-tbody');
        const label = document.getElementById('archive-grad-this-year-label');
        if (!tbody) return;

        const classSel = document.getElementById('archive-grad-class-filter');
        const yearSel  = document.getElementById('archive-grad-year-filter');
        const qEl      = document.getElementById('archive-grad-class-search');

        const classVal = classSel ? classSel.value : ALL_STUDENTS_KEY;
        const yearVal  = yearSel ? yearSel.value : '0';
        const q        = qEl ? qEl.value.toLowerCase().trim() : '';

        if (label) label.textContent = yearVal === '0' ? new Date().getFullYear() : '';

        let list = getGraduatedStudents();

        if (classVal && classVal !== ALL_STUDENTS_KEY) {
            list = list.filter(s => s.graduatedClass === classVal);
        }
        if (archiveGradSection === 'A' || archiveGradSection === 'B' ||
            (archiveGradSection !== 'BOTH' && archiveGradSection)) {
            list = list.filter(s => s.graduatedSection === archiveGradSection);
        }
        if (yearVal !== 'ALL') {
            const targetYear = new Date().getFullYear() - parseInt(yearVal, 10);
            list = list.filter(s => Number(s.graduatedYear) === targetYear);
        }
        if (q) list = list.filter(s => studentMatchesSearch(s, q));

        list.sort((a, b) =>
            (Number(b.graduatedYear) || 0) - (Number(a.graduatedYear) || 0) ||
            (a.fullName || '').localeCompare(b.fullName || '')
        );

        renderArchiveTableRows(tbody, list, 'graduated');
    };

    /** Dropped Out: single searchable table, newest removal first */
    window.renderArchiveDroppedTable = function() {
        const tbody = document.getElementById('archive-drop-tbody');
        if (!tbody) return;

        const qEl = document.getElementById('archive-drop-search');
        const q   = qEl ? qEl.value.toLowerCase().trim() : '';

        let list = getDroppedStudents();
        if (q) list = list.filter(s => studentMatchesSearch(s, q));
        list.sort((a, b) => new Date(b.droppedDate || 0) - new Date(a.droppedDate || 0));

        renderArchiveTableRows(tbody, list, 'dropped');
    };

    /** Shared row-renderer for all three archive tables */
    function renderArchiveTableRows(tbody, list, kind) {
        if (!list.length) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:50px;color:#94a3b8;">No ${kind === 'graduated' ? 'graduated' : 'dropped-out'} students found.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map((s, idx) => {
            const displayId = s.regNo || s.id;
            const cls    = kind === 'graduated' ? (s.graduatedClass   || s.studentClass || '—') : (s.studentClass || '—');
            const sec    = kind === 'graduated' ? (s.graduatedSection || s.section      || '—') : (s.section      || '—');
            const dateVal= kind === 'graduated' ? (s.graduatedDate    || '—')                    : (s.droppedDate  || '—');

            return `
                <tr>
                    <td class="msc-sr-cell">${idx + 1}</td>
                    <td><span class="hrk-id-badge">${displayId}</span></td>
                    <td><strong>${s.fullName || '—'}</strong></td>
                    <td>${s.guardianName || '—'}</td>
                    <td><span class="class-chip">${cls}</span></td>
                    <td><span class="class-chip">${sec}</span></td>
                    <td>${dateVal}</td>
                    <td style="text-align:center;">
                        <button class="btn-icon view" onclick="viewFullProfile('${s.regNo}')" title="View Profile">
                            <i class="fas fa-eye"></i>
                        </button>
                        ${kind === 'dropped' ? `<button class="btn-icon reactivate" onclick="reactivateStudent('${s.regNo}')" title="Reactivate Student">
                            <i class="fas fa-user-check"></i>
                        </button>` : ''}
                    </td>
                </tr>`;
        }).join('');
    }

    /**
     * Reactivate a dropped-out student — moves them back onto the live/active
     * roster (status -> 'active') so they reappear in the dashboard counters,
     * class cards, and every search/print/share list. Mirrors deleteRecord's
     * pattern: update local cache immediately, then best-effort sync to MySQL.
     */
    window.reactivateStudent = async function(studentId) {
        const db    = getDatabase();
        const index = db.findIndex(s => s.regNo === studentId || s.id === studentId);
        if (index === -1) {
            showToast("Error", "Could not find that student to reactivate.", "danger");
            return;
        }

        const student = db[index];
        if (!confirm(`Reactivate ${student.fullName || 'this student'} and move them back to the active roster?`)) return;

        student.status = 'active';
        delete student.droppedDate;
        saveDatabase(db);

        showToast("Success", `${student.fullName || 'Student'} has been reactivated.`, "success");
        updateDashboardStats();
        if (typeof renderStudentTable === 'function') renderStudentTable();
        if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();
        if (typeof renderArchiveDroppedTable === 'function') renderArchiveDroppedTable();

        // Best-effort sync so the backend record stops showing as "dropped" too.
        try {
            if (student.regNo) await apiSaveStudent(student);
        } catch (err) {
            console.error('Backend reactivate failed:', err);
            showToast("Offline", "Reactivated locally — couldn't reach the server.", "danger");
        }
    };

    // ── 8. EDIT STUDENT ──────────────────────────────────────────────────────

   window.editStudentInfo = function(studentId) {
    const db = getDatabase();
    // Match against the ACTIVE roster first — this button only ever appears next to an
    // active student's row, so a duplicate regNo on an already-archived record must never
    // be picked up instead of the real active student.
    let student = db.find(s => s.regNo === studentId && isActiveStudent(s));
    if (!student) student = db.find(s => s.regNo === studentId); // fallback, shouldn't normally be needed

    if (!student) {
        showToast("Error", "Student record not found.", "danger");
        return;
    }

    closeModal('view-modal');
    closeModal('profile-modal');

    // Reset the form so no stale values linger from a previous new-admission session
    admissionForm.reset();

    // CRITICAL FIX: clear pendingRegNo so the submit handler never treats this
    // as a new registration or triggers the sibling detection path
    delete admissionForm.dataset.pendingRegNo;

    // Set the hidden field strictly to regNo — this is what flags UPDATE mode
    editIdHidden.value = student.regNo;

    // Populate form fields — skip system/computed fields that must be preserved
    // exactly from the stored record and must not be overwritten by FormData
    const SKIP_FIELDS = new Set([
        '_editRegNo', 'regNo', 'id', 'siblingGroupId',
        'isSibling', 'siblingOf', 'hasSiblings', 'promoted',
        'photo', 'age', 'netPayable', 'rollNo', 'certData', 'otherFeesData'
    ]);

    // Populate class first so section dropdown can be built before section is restored
    if (classSelect && student.studentClass) {
        classSelect.value = student.studentClass;
        try { populateSectionDropdown(student.studentClass); } catch(e) {}
    }

    Object.keys(student).forEach(key => {
        if (SKIP_FIELDS.has(key)) return;
        const input = admissionForm.querySelector(`[name="${key}"]`);
        if (input) {
            if (input.type === 'checkbox') {
                input.checked = (student[key] === 'on' || student[key] === true);
            } else if (input.type === 'radio') {
                // Radio groups share a name, so find the specific option that
                // matches the stored value rather than setting .value on the
                // first radio the querySelector happens to find.
                const radios = admissionForm.querySelectorAll(`[name="${key}"]`);
                radios.forEach(r => { r.checked = (r.value === student[key]); });
            } else {
                input.value = student[key] ?? '';
            }
        }
    });

    // Orphan Status defaults to "Not Orphan" for legacy records saved before
    // this field existed (student.orphanStatus will be undefined for those).
    if (!student.orphanStatus) {
        const defaultOrphanRadio = admissionForm.querySelector('[name="orphanStatus"][value="Not Orphan"]');
        if (defaultOrphanRadio) defaultOrphanRadio.checked = true;
    }

    previewImg.src = student.photo || "https://via.placeholder.com/150?text=No+Photo";
    displayRegBadge.innerText = student.regNo;
    rollNoInput.value = student.rollNo || '';

    // Highlighted "Sibling of …" badge shown right below the name/reg-no area
    const editSiblingBadge = document.getElementById('edit-sibling-badge');
    if (editSiblingBadge) {
        if (student.isSibling && student.siblingOf) {
            editSiblingBadge.style.display = 'inline-flex';
            editSiblingBadge.innerHTML = `<i class="fas fa-user-friends"></i> Sibling of ${student.siblingOf}`;
        } else {
            editSiblingBadge.style.display = 'none';
            editSiblingBadge.innerHTML = '';
        }
    }

    // Books fee panel — show if there's existing books data
    const hasBooks = (parseFloat(student.booksFee || 0) > 0) || (parseFloat(student.booksDiscount || 0) > 0);
    if (booksFeePanel) {
        booksFeePanel.style.display = hasBooks ? 'grid' : 'none';
        if (takeBooksBtn) {
            takeBooksBtn.innerHTML = hasBooks
                ? '<i class="fas fa-book-open"></i> Hide Books Fee'
                : '<i class="fas fa-book"></i> Take Books';
        }
    }

    // Annual fund — restore state
    if (annualFundEnabled) {
        const hasAnnual = student.annualFundEnabled === 'on' || student.annualFundEnabled === true;
        annualFundEnabled.checked = hasAnnual;
        if (annualFundPanel) annualFundPanel.style.display = hasAnnual ? 'block' : 'none';
        if (annualFundAmount) annualFundAmount.value = ANNUAL_FUND_AMOUNT;
    }

    // Other fees rows
    let existingOtherFees = [];
    try { existingOtherFees = JSON.parse(student.otherFeesData || '[]'); } catch (e) { existingOtherFees = []; }
    resetOtherFeesUI(existingOtherFees);

    document.getElementById('form-modal-title').innerHTML = '<i class="fas fa-user-edit"></i> Edit Student Profile';
    document.getElementById('form-submit-btn').innerText  = 'Save Changes';

    ageInput.value = calculateAge(student.dob);
    performFinancialAudit();

    const modal = document.getElementById('student-modal');
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
};
    // ── 9. DELETE STUDENT ────────────────────────────────────────────────────

    window.deleteRecord = async function(studentId) {
        // Dropping a student moves them into the Archive Center ("dropped"),
        // so it counts against the plan's archiveStudentLimit just like a
        // graduation does.
        if (!canArchiveMoreStudents(1)) {
            showToast("Archive Limit Reached", `Your plan allows up to ${getArchiveLimit()} archived students. Upgrade your plan to remove more students.`, "danger");
            return;
        }
        if (!confirm("Are you sure you want to remove this student from the Database?")) return;

        const db    = getDatabase();
        const index = db.findIndex(s => s.regNo === studentId || s.id === studentId);
        if (index === -1) {
            showToast("Error", "Could not find that student to delete.", "danger");
            return;
        }
        const regNo = db[index].regNo;
        db.splice(index, 1);
        saveDatabase(db);

        showToast("Success", "Student removed from the database", "success");
        closeModal('student-modal');
        updateDashboardStats();
        renderStudentTable();
        if (typeof renderViewOnlyTable === 'function') renderViewOnlyTable();

        // NOTE: StudentController's DELETE endpoint is a SOFT delete — it sets
        // status = "dropped" rather than removing the MySQL row. That's fine for
        // the Archive Center's "dropped" list, but it means this record will
        // still be pulled back down by syncWithBackend() (as status "dropped"),
        // not truly erased from the database. If you want this button to
        // permanently delete the row, add a hard-delete repository method and
        // call studentRepository.delete(s) instead of s.setStatus("dropped").
        try {
            if (regNo) await apiDeleteStudent(regNo);
        } catch (err) {
            console.error('Backend delete failed:', err);
            showToast("Offline", "Removed locally — couldn't reach the server.", "danger");
        }
    };

    // ── 10. FULL PROFILE VIEW ────────────────────────────────────────────────

    /**
     * viewFullProfile — look up by regNo (what the table buttons pass in).
     */
    window.viewFullProfile = function(regNo) {
        const db = getDatabase();
        // Find by regNo first, fall back to id
        const s = db.find(x => x.regNo === regNo) || db.find(x => x.id === regNo);
        if (!s) return;

        const safeVal = v => (v && v !== "") ? v : '<span style="color:#cbd5e1">Not Provided</span>';

        // ── Sibling ID row (00X) — profile only ──
        const siblingIdRow = (s.isSibling && s.siblingGroupId)
            ? `<div class="detail-item">
                   <label>Sibling Group ID</label>
                   <span class="hrk-id-badge" style="font-size:0.85rem;background:#d97706;">${s.siblingGroupId}</span>
               </div>`
            : '';

        // ── "Sibling of …" row ──
        const siblingOfRow = (s.isSibling && s.siblingOf)
            ? `<div class="detail-item full-width-detail">
                   <label>Sibling Status</label>
                   <span class="sibling-tag" style="font-size:0.9rem;padding:5px 12px;">
                       <i class="fas fa-user-friends"></i> Sibling of ${s.siblingOf}
                   </span>
               </div>`
            : '';

        // ── hasSiblings list ──
        const hasSiblingsRows = (s.hasSiblings && s.hasSiblings.length > 0)
            ? s.hasSiblings.map(sib =>
                `<div class="detail-item full-width-detail">
                    <label>Has Sibling</label>
                    <span class="sibling-tag sibling-tag--has">
                        <i class="fas fa-user-friends"></i> ${sib.name}
                        <span style="margin-left:8px;opacity:0.75;font-size:0.78rem;">(Reg: ${sib.regNo})</span>
                    </span>
                </div>`
              ).join('')
            : '';

        // ── Certificate viewer (B-Form / School Certificate uploaded in admission form) ──
        // IMPORTANT: only the student's regNo/id is passed into these onclick handlers — never
        // the raw base64 certData. viewCertificate()/downloadCertificate() resolve the record and
        // turn certData into a short-lived Blob URL under the hood. This is the fix for the
        // View/Download bug: modern Chrome silently blocks window.open()/top-frame navigation to
        // data: URIs, and Safari's <a download> support for data: URIs is unreliable — Blob URLs
        // work consistently across all of them.
        let certViewer = '';
        let bformActionBtn = '';
        if (s.certData) {
            const certRegNo = s.regNo || s.id;
            const isPdf = s.certData.startsWith('data:application/pdf');

            bformActionBtn = `
                <div class="profile-section-title"><i class="fas fa-id-card"></i> B-Form / School Certificate (from Admission Form)</div>
                <div style="padding:18px 25px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
                    <button type="button" class="btn-primary-submit" onclick="viewCertificate('${certRegNo}')"
                        style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:8px;border:none;cursor:pointer;">
                        <i class="fas fa-eye"></i> View B-Form
                    </button>
                    <button type="button" onclick="downloadCertificate('${certRegNo}')"
                        class="btn-secondary" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:8px;border:none;cursor:pointer;">
                        <i class="fas fa-download"></i> Download B-Form
                    </button>
                </div>`;

            if (s.certData.startsWith('data:image')) {
                certViewer = `
                    <div class="profile-section-title"><i class="fas fa-certificate"></i> School Certificate / B-Form</div>
                    <div style="padding:20px 25px;">
                        <img src="${s.certData}" alt="Certificate" class="cert-preview-img"
                             onclick="viewCertificate('${certRegNo}')" title="Click to view full page">
                        <p style="font-size:0.75rem;color:var(--text-muted);margin-top:8px;">
                            <i class="fas fa-search-plus"></i> Click to open full size
                        </p>
                    </div>`;
            } else if (isPdf) {
                certViewer = `
                    <div class="profile-section-title"><i class="fas fa-certificate"></i> School Certificate / B-Form</div>
                    <div style="padding:20px 25px;">
                        <div class="cert-pdf-card" onclick="viewCertificate('${certRegNo}')" title="Click to view full page">
                            <i class="fas fa-file-pdf"></i>
                            <div>
                                <strong>PDF Document Attached</strong>
                                <p>Click to open the full-page viewer</p>
                            </div>
                        </div>
                    </div>`;
            }
        }

        // ── Books fee row ──
        const booksRow = (parseFloat(s.booksFee||0) > 0 || parseFloat(s.booksDiscount||0) > 0)
            ? `<div class="detail-item"><label>Books Fee</label><span>Rs. ${safeVal(s.booksFee) || '0'}</span></div>`
            : '';
        const booksDiscRow = (parseFloat(s.booksDiscount||0) > 0)
            ? `<div class="detail-item discount-item"><label><i class="fas fa-tag" style="color:#d97706;margin-right:4px;"></i>Books Discount</label><span style="color:#d97706;">− Rs. ${parseFloat(s.booksDiscount).toFixed(0)}</span></div>`
            : '';

        // ── Other fees rows ──
        let otherFeesRows = '';
        let otherFeesArr = [];
        try { otherFeesArr = JSON.parse(s.otherFeesData || '[]'); } catch (e) { otherFeesArr = []; }
        otherFeesArr.forEach(f => {
            // Skip placeholder / empty rows: must have at least a real amount or a discount > 0
            const amt  = parseFloat(f.amount   || 0);
            const disc = parseFloat(f.discount || 0);
            if (amt <= 0 && disc <= 0) return;
            otherFeesRows += `<div class="detail-item"><label>${f.description || 'Other Fee'}</label><span>Rs. ${parseFloat(f.amount||0).toFixed(0)}</span></div>`;
            if (parseFloat(f.discount||0) > 0) {
                otherFeesRows += `<div class="detail-item discount-item"><label><i class="fas fa-tag" style="color:#d97706;margin-right:4px;"></i>${f.description || 'Other Fee'} Discount</label><span style="color:#d97706;">− Rs. ${parseFloat(f.discount).toFixed(0)}</span></div>`;
            }
        });

        const profileContent = `
            <div class="profile-card-header">
                <div class="profile-header-decor"></div>
                <div class="profile-avatar-ring">
                    <img src="${s.photo}" class="profile-main-img"
                         onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(s.fullName)}&background=3b82f6&color=fff&bold=true'">
                </div>
                <h2 class="profile-name-title">${s.fullName}</h2>
                ${(s.isSibling && s.siblingOf) ? `<div class="sibling-tag" style="margin:2px 0 8px;"><i class="fas fa-user-friends"></i> Sibling of ${s.siblingOf}</div>` : ''}
                <div class="profile-header-badges">
                    <span class="hrk-id-badge">${s.regNo || s.id}</span>
                    ${s.studentClass ? `<span class="profile-class-badge"><i class="fas fa-graduation-cap"></i> ${s.studentClass}${s.section ? ' – ' + s.section : ''}</span>` : ''}
                </div>
            </div>

            <div class="profile-section-title">Academic Information</div>
            <div class="profile-details-grid">
                <div class="detail-item">
                    <label>Registration No.</label>
                    <span class="hrk-id-badge" style="font-size:0.85rem;">${safeVal(s.regNo || s.id)}</span>
                </div>
                <div class="detail-item"><label>Roll Number (Class)</label><span>${safeVal(s.rollNo)}</span></div>
                <div class="detail-item"><label>Class</label><span>${safeVal(s.studentClass)}</span></div>
                <div class="detail-item"><label>Section</label><span>${safeVal(s.section)}</span></div>
                <div class="detail-item"><label>Admission Date</label><span>${safeVal(s.admissionDate)}</span></div>
                ${siblingIdRow}
                ${siblingOfRow}
                ${hasSiblingsRows}
            </div>

            <div class="profile-section-title">Personal Data</div>
            <div class="profile-details-grid">
                <div class="detail-item"><label>Gender</label><span>${safeVal(s.gender)}</span></div>
                <div class="detail-item"><label>Date of Birth</label><span>${safeVal(s.dob)}</span></div>
                <div class="detail-item"><label>Computed Age</label><span>${safeVal(s.age)}</span></div>
                <div class="detail-item"><label>B-Form / CNIC</label><span>${safeVal(s.studentBform)}</span></div>
                <div class="detail-item full-width-detail"><label>Medical Conditions</label><span>${safeVal(s.medicalIssues)}</span></div>
                <div class="detail-item"><label>Orphan Status</label><span>${safeVal(s.orphanStatus)}</span></div>
                <div class="detail-item"><label>Previous School Attended</label><span>${safeVal(s.previousSchool)}</span></div>
                <div class="detail-item"><label>Previous Class</label><span>${safeVal(s.previousClass)}</span></div>
            </div>

            <div class="profile-section-title">Guardian & Contact</div>
            <div class="profile-details-grid">
                <div class="detail-item"><label>Guardian Name</label><span>${safeVal(s.guardianName)}</span></div>
                <div class="detail-item"><label>Relation</label><span>${safeVal(s.guardianRole)}</span></div>
                <div class="detail-item"><label>Guardian CNIC</label><span>${safeVal(s.guardianCnic)}</span></div>
                <div class="detail-item"><label>Contact 1</label><span>${safeVal(s.phone1)}</span></div>
                <div class="detail-item"><label>Contact 2</label><span>${safeVal(s.phone2)}</span></div>
                <div class="detail-item full-width-detail"><label>Permanent Address</label><span>${safeVal(s.permanentAddress)}</span></div>
            </div>

            <div class="profile-section-title">Finance & Transport</div>
            <div class="profile-details-grid">
                <div class="detail-item"><label>Tuition Fee</label><span>Rs. ${safeVal(s.standardFee)}</span></div>
                <div class="detail-item"><label>Admission Fee</label><span>Rs. ${safeVal(s.admissionFee) || '0'}</span></div>
                <div class="detail-item"><label>Transport Fee</label><span>Rs. ${safeVal(s.transportFee)}</span></div>
                ${booksRow}
                ${otherFeesRows}
                ${parseFloat(s.tuitionDiscount||0) > 0 ? `<div class="detail-item discount-item"><label><i class="fas fa-tag" style="color:#d97706;margin-right:4px;"></i>Tuition Discount</label><span style="color:#d97706;">− Rs. ${parseFloat(s.tuitionDiscount).toFixed(0)}</span></div>` : ''}
                ${parseFloat(s.transportDiscount||0) > 0 ? `<div class="detail-item discount-item"><label><i class="fas fa-tag" style="color:#d97706;margin-right:4px;"></i>Transport Discount</label><span style="color:#d97706;">− Rs. ${parseFloat(s.transportDiscount).toFixed(0)}</span></div>` : ''}
                ${parseFloat(s.siblingDiscount||0) > 0 ? `<div class="detail-item discount-item"><label><i class="fas fa-tag" style="color:#d97706;margin-right:4px;"></i>Sibling Discount</label><span style="color:#d97706;">− Rs. ${parseFloat(s.siblingDiscount).toFixed(0)}</span></div>` : ''}
                ${booksDiscRow}
                <div class="detail-item total-discount-item">
                    <label>Total Discount</label>
                    <span class="total-discount-value">− Rs. ${(parseFloat(s.tuitionDiscount||0) + parseFloat(s.transportDiscount||0) + parseFloat(s.siblingDiscount||0) + parseFloat(s.booksDiscount||0) + otherFeesArr.reduce((sum,f)=>sum+(parseFloat(f.discount||0)),0)).toFixed(0)}</span>
                </div>
                <div class="detail-item net-payable-item">
                    <label>Net Payable</label>
                    <span class="net-payable-value">Rs. ${s.netPayable}</span>
                </div>
            </div>
            ${certViewer}
            ${bformActionBtn}
        `;

        document.getElementById('profile-content').innerHTML = profileContent;
        const profileModal = document.getElementById('profile-modal');
        profileModal.dataset.currentRegNo = s.regNo || s.id;
        profileModal.style.display = 'block';
    };

    // ── CERTIFICATE / B-FORM VIEWER & DOWNLOAD ENGINE ────────────────────────
    //
    // WHY THIS EXISTS:
    // certData is stored as a base64 "data:" URI. Feeding that raw string straight into
    // window.open(...) or an <a href="data:..."> is what was breaking View/Download:
    //   • Chrome (and most Chromium browsers) silently block top-frame navigation to
    //     data: URIs — window.open('data:...') just opens a blank tab, no error shown to
    //     the user, only a console warning ("Not allowed to navigate top frame to data URL").
    //   • Safari's handling of <a download href="data:...."> for large payloads is
    //     inconsistent — it will often just navigate/preview instead of saving the file.
    // The fix: decode the base64 payload into a real Blob and hand out a short-lived
    // blob: Object URL instead. Blob URLs are same-origin, are not subject to the data:
    // navigation block, and are supported identically across Chrome, Edge, Firefox and Safari.

    let _certViewerBlobUrl  = null; // currently active blob: URL shown in the full-page viewer
    let _certViewerFilename = null; // filename to use if the user downloads straight from the viewer

    /** Decode a "data:<mime>;base64,xxxx" string into a real Blob object. */
    function certDataUrlToBlob(dataUrl) {
        const commaIdx = dataUrl.indexOf(',');
        const header   = dataUrl.slice(0, commaIdx);
        const base64   = dataUrl.slice(commaIdx + 1);
        const mimeMatch = header.match(/data:(.*?);base64/);
        const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';

        const binary = atob(base64);
        const len    = binary.length;
        const bytes  = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    }

    /** Look up a student by regNo (falls back to id) and build a {blob, isPdf, filename} bundle for their certData. */
    function resolveCertForStudent(regNo) {
        const db = getDatabase();
        const s = db.find(x => x.regNo === regNo) || db.find(x => x.id === regNo);
        if (!s || !s.certData) return null;

        const isPdf    = s.certData.startsWith('data:application/pdf');
        const blob     = certDataUrlToBlob(s.certData);
        const filename = `bform_${s.regNo || s.id}${isPdf ? '.pdf' : '.png'}`;
        return { blob, isPdf, filename };
    }

    /** Open the student's certificate / B-Form in the in-page, full-screen viewer. Works for both images and PDFs. */
    window.viewCertificate = function(regNo) {
        const cert = resolveCertForStudent(regNo);
        if (!cert) { showToast("No File", "No certificate / B-Form is attached for this student.", "danger"); return; }

        // Free the previous blob before creating a new one, so repeated opens don't leak memory
        if (_certViewerBlobUrl) { URL.revokeObjectURL(_certViewerBlobUrl); _certViewerBlobUrl = null; }

        _certViewerBlobUrl  = URL.createObjectURL(cert.blob);
        _certViewerFilename = cert.filename;

        const overlay = document.getElementById('cert-viewer-overlay');
        const imgEl   = document.getElementById('cert-viewer-image');
        const pdfEl   = document.getElementById('cert-viewer-pdf');
        const nameEl  = document.getElementById('cert-viewer-filename');
        if (!overlay || !imgEl || !pdfEl) return;

        if (cert.isPdf) {
            pdfEl.src = _certViewerBlobUrl;
            pdfEl.style.display = 'block';
            imgEl.style.display = 'none';
            imgEl.removeAttribute('src');
        } else {
            imgEl.src = _certViewerBlobUrl;
            imgEl.style.display = 'block';
            pdfEl.style.display = 'none';
            pdfEl.removeAttribute('src');
        }

        if (nameEl) nameEl.textContent = cert.filename;

        overlay.classList.add('active');
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };

    /** Close the full-page certificate viewer and release its Blob URL. */
    window.closeCertViewer = function() {
        const overlay = document.getElementById('cert-viewer-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            overlay.style.display = 'none';
        }

        // The viewer is opened FROM WITHIN another modal (e.g. "View Student").
        // Only unlock body scroll if no other modal is still open behind it —
        // otherwise the page behind the still-open modal would start scrolling.
        const anyModalStillOpen = Array.from(document.querySelectorAll('.modal-overlay'))
            .some(m => m.style.display === 'block' || m.style.display === 'flex');
        document.body.style.overflow = anyModalStillOpen ? 'hidden' : 'auto';

        if (_certViewerBlobUrl) { URL.revokeObjectURL(_certViewerBlobUrl); _certViewerBlobUrl = null; }
        _certViewerFilename = null;

        const imgEl = document.getElementById('cert-viewer-image');
        const pdfEl = document.getElementById('cert-viewer-pdf');
        if (imgEl) imgEl.removeAttribute('src');
        if (pdfEl) pdfEl.removeAttribute('src');
    };

    // Close the viewer with the Escape key, same as the other modals in this app
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('cert-viewer-overlay');
            if (overlay && overlay.classList.contains('active')) window.closeCertViewer();
        }
    });

    /**
     * Download a student's certificate / B-Form as a real file save.
     * Builds (or re-uses, if the viewer already has this exact file open) a blob: Object URL
     * and clicks a temporary, invisible <a download> against it — the only download method that
     * behaves consistently across Chrome, Edge, Firefox and Safari for locally-generated files.
     */
    window.downloadCertificate = function(regNo) {
        let blobUrl  = _certViewerBlobUrl;
        let filename = _certViewerFilename;
        let isReusedUrl = !!blobUrl;

        if (!blobUrl) {
            const cert = resolveCertForStudent(regNo);
            if (!cert) { showToast("No File", "No certificate / B-Form is attached for this student.", "danger"); return; }
            blobUrl  = URL.createObjectURL(cert.blob);
            filename = cert.filename;
        }

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Only revoke a URL we created just for this call — the viewer owns and revokes its own
        if (!isReusedUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);

        showToast("Downloading", `${filename} is downloading…`, "success");
    };

    // ── FOOTER SHARE BUTTON HANDLER ──────────────────────────────────────────
    window.shareCurrentProfile = function() {
        const modal = document.getElementById('profile-modal');
        const regNo = modal ? modal.dataset.currentRegNo : null;
        if (regNo) window.shareStudentProfile(regNo);
    };

    // ── FOOTER "PRINT ADMISSION FORM" BUTTON HANDLER ─────────────────────────
    // Prints the official Admission Form for whichever student's profile is
    // currently open (tracked via profile-modal's data-current-reg-no).
    window.printCurrentAdmissionForm = function() {
        const modal = document.getElementById('profile-modal');
        const regNo = modal ? modal.dataset.currentRegNo : null;
        if (regNo) window.printAdmissionFormForStudent(regNo);
    };

    // ── SHARE STUDENT PROFILE (Web Share API + clipboard fallback) ──────────
    window.shareStudentProfile = async function(regNo) {
        const db = getDatabase();
        const s  = db.find(x => (x.regNo || x.id) === regNo);
        if (!s) { showToast && showToast("Error", "Student not found.", "danger"); return; }

        const line = (label, val) => (val !== undefined && val !== null && val !== '') ? `${label}: ${val}\n` : '';
        const text =
            `📘 STUDENT PROFILE — ST. LAWRENCE INTERNATIONAL SCHOOL\n` +
            `────────────────────────────────────────\n` +
            line('Name',         s.fullName) +
            line('Reg No.',      s.regNo || s.id) +
            line('Roll No.',     s.rollNo) +
            line('Class',        s.studentClass) +
            line('Section',      s.section) +
            line('Gender',       s.gender) +
            line('Date of Birth',s.dob) +
            line('Age',          s.age) +
            line('Guardian',     s.guardianName) +
            line('Relation',     s.guardianRole) +
            line('Contact',      s.phone1) +
            line('Address',      s.permanentAddress) +
            `────────────────────────────────────────\n` +
            line('Tuition Fee',  s.standardFee     ? 'Rs. ' + s.standardFee     : '') +
            line('Transport',    s.transportFee    ? 'Rs. ' + s.transportFee    : '') +
            line('Net Payable',  s.netPayable      ? 'Rs. ' + s.netPayable      : '');

        const title = `Student Profile — ${s.fullName}`;
        try {
            if (navigator.share) {
                await navigator.share({ title, text });
                return;
            }
        } catch (e) { /* user cancelled — fall through */ }
        try {
            await navigator.clipboard.writeText(text);
            showToast && showToast("Copied", "Student profile copied to clipboard.", "success");
        } catch (e) {
            // Final fallback: open a print/preview window
            const w = window.open('', '_blank');
            if (w) {
                w.document.write('<pre style="font-family:monospace;padding:20px;white-space:pre-wrap;">'
                    + text.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) + '</pre>');
                w.document.close();
            } else {
                alert(text);
            }
        }
    };


    function updateDashboardStats() {
        const db      = getActiveDatabase();
        const total   = db.length;
        const males   = db.filter(s => s.gender === "Male").length;
        const females = db.filter(s => s.gender === "Female").length;

        const countTotal  = document.getElementById('counter-total');
        const countMale   = document.getElementById('counter-male');
        const countFemale = document.getElementById('counter-female');

        if (countTotal)  countTotal.innerText  = total;
        if (countMale)   countMale.innerText   = males;
        if (countFemale) countFemale.innerText = females;

        // Keep the plan's usage banners / locked-out "New Admission" card in
        // sync every time the roster changes (see PLAN ENFORCEMENT block below).
        renderPlanLimitBanners();
    }

    // ============================================================================
    // PLAN ENFORCEMENT — feature locks, student/archive limits, subscription expiry
    // ----------------------------------------------------------------------------
    // Driven entirely by the School record Super Admin configured for this school
    // (School.java / SchoolAuthController.SchoolPublicView): `locks`,
    // `studentLimit`, `archiveStudentLimit`, `expiryDate`.
    //
    // FEATURE LOCKS: whole-module locks (the "students" key locking this entire
    // page) are already enforced by access-control.js's page guard, which
    // redirects away before this file even runs if Student Management itself is
    // locked. The only feature key from access-control.js's real FEATURES
    // catalog (SSA.FEATURES, extended in superadmin.js) that applies to
    // something INSIDE this page is "bform_pic" (Student B-Form Picture), tagged
    // on the #bform-upload-group wrapper below via data-feature="bform_pic".
    // Lock-checking itself is delegated to window.SoftSchoolAdmin.isFeatureLocked
    // (the same function every other page uses) so this page never drifts out of
    // sync with the real catalog.
    //
    // USAGE LIMITS: studentLimit caps ACTIVE students, archiveStudentLimit caps
    // graduated+dropped students. Either can be left blank/0 on the school or
    // plan to mean "unlimited".
    // ============================================================================

    function getCurrentSchoolRecord() {
        try {
            if (window.SoftSchoolAdmin) return window.SoftSchoolAdmin.getCurrentSchool();
        } catch (e) { /* ignore — demo / no session */ }
        return null;
    }

    /**
     * True if ANY of a comma-separated list of feature keys is locked for this
     * school. Delegates to SoftSchoolAdmin.isFeatureLocked (access-control.js) —
     * the same check every other page uses — so this stays correct even if that
     * function's normalization logic (array vs comma-string locks, blocked
     * status, etc.) changes later.
     */
    function isFeatureLocked(keysCsv) {
        const school = getCurrentSchoolRecord();
        if (!school) return false;
        const keys = String(keysCsv || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        if (window.SoftSchoolAdmin && typeof window.SoftSchoolAdmin.isFeatureLocked === 'function') {
            return keys.some(k => window.SoftSchoolAdmin.isFeatureLocked(school, k));
        }
        // Fallback if access-control.js somehow isn't loaded.
        const raw = String(school.locks || '');
        const locked = new Set(raw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean));
        return keys.some(k => locked.has(k));
    }

    /** Active-student cap from the school record. null = unlimited. */
    function getStudentLimit() {
        const school = getCurrentSchoolRecord();
        const n = school ? Number(school.studentLimit) : NaN;
        return (Number.isFinite(n) && n > 0) ? n : null;
    }
    /** Archived-student (graduated + dropped) cap from the school record. null = unlimited. */
    function getArchiveLimit() {
        const school = getCurrentSchoolRecord();
        const n = school ? Number(school.archiveStudentLimit) : NaN;
        return (Number.isFinite(n) && n > 0) ? n : null;
    }

    /** Is there room to register one more ACTIVE student right now? */
    function canAdmitNewStudent() {
        const limit = getStudentLimit();
        return limit === null || getActiveDatabase().length < limit;
    }
    /** Is there room to move `count` more students into the archive (graduated/dropped)? */
    function canArchiveMoreStudents(count) {
        const limit = getArchiveLimit();
        if (limit === null) return true;
        const used = getGraduatedStudents().length + getDroppedStudents().length;
        return (used + (count || 1)) <= limit;
    }

    /**
     * Blur/fade every data-feature element that Super Admin has locked for this
     * plan, strip its click handler, and wire up the "Not available in this
     * plan" hover tooltip via the data-tooltip attribute (see CSS). Runs once
     * on load — the lock list doesn't change without a fresh page/session.
     */
    function applyFeatureLocks() {
        document.querySelectorAll('[data-feature]').forEach(el => {
            if (!isFeatureLocked(el.dataset.feature)) return;
            el.classList.add('feature-locked');
            el.setAttribute('data-tooltip', 'Not available in this plan');
            el.onclick = null; // strip any inline onclick="..." on the element itself
            el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); }, true);
            // Also disable any real form controls nested inside (e.g. the file
            // input in #bform-upload-group) so the lock can't be bypassed by
            // interacting with the control directly rather than the wrapper.
            el.querySelectorAll('input, button, select, textarea').forEach(ctrl => {
                ctrl.disabled = true;
            });
        });
    }

    /**
     * Refresh the two usage-limit banners (active-student cap on the Manage
     * Students home, archive cap on the Archive Center) and grey out "New
     * Admission" once the active-student cap is hit. Called after every
     * roster mutation via updateDashboardStats().
     */
    function renderPlanLimitBanners() {
        const studentBanner = document.getElementById('student-limit-banner');
        if (studentBanner) {
            const limit = getStudentLimit();
            const used  = getActiveDatabase().length;
            if (limit === null) {
                studentBanner.style.display = 'none';
            } else {
                const remaining = limit - used;
                if (remaining <= 0) {
                    studentBanner.className   = 'plan-limit-banner danger';
                    studentBanner.innerHTML   = `<i class="fas fa-ban"></i> Student limit reached (${used}/${limit}). Upgrade your plan to register more students.`;
                    studentBanner.style.display = 'flex';
                } else if (remaining <= LIMIT_WARNING_THRESHOLD) {
                    studentBanner.className   = 'plan-limit-banner warning';
                    studentBanner.innerHTML   = `<i class="fas fa-triangle-exclamation"></i> Only ${remaining} student slot${remaining === 1 ? '' : 's'} left before you reach your plan's limit of ${limit}.`;
                    studentBanner.style.display = 'flex';
                } else {
                    studentBanner.style.display = 'none';
                }
            }
        }

        const archiveBanner = document.getElementById('archive-limit-banner');
        if (archiveBanner) {
            const limit = getArchiveLimit();
            const used  = getGraduatedStudents().length + getDroppedStudents().length;
            if (limit === null) {
                archiveBanner.style.display = 'none';
            } else {
                const remaining = limit - used;
                if (remaining <= 0) {
                    archiveBanner.className   = 'plan-limit-banner danger';
                    archiveBanner.innerHTML   = `<i class="fas fa-ban"></i> Archive limit reached (${used}/${limit}). No more students can be graduated or dropped until you upgrade your plan.`;
                    archiveBanner.style.display = 'flex';
                } else if (remaining <= LIMIT_WARNING_THRESHOLD) {
                    archiveBanner.className   = 'plan-limit-banner warning';
                    archiveBanner.innerHTML   = `<i class="fas fa-triangle-exclamation"></i> Only ${remaining} archive slot${remaining === 1 ? '' : 's'} left before you reach your plan's limit of ${limit}.`;
                    archiveBanner.style.display = 'flex';
                } else {
                    archiveBanner.style.display = 'none';
                }
            }
        }

        // Grey out "New Admission" once the active-student cap is hit — separate
        // class from .feature-locked so it's never confused with a Super-Admin lock.
        const addCard = document.getElementById('card-add-student');
        if (addCard) addCard.classList.toggle('feature-locked-limit', !canAdmitNewStudent());
    }

    /**
     * Small blinking badge, fixed to the corner of the viewport (doesn't shift
     * any layout), warning that the school's subscription is about to expire.
     */
    function renderSubscriptionExpiryBadge() {
        const badge = document.getElementById('subscription-expiry-badge');
        const text  = document.getElementById('subscription-expiry-text');
        if (!badge || !text) return;

        const school = getCurrentSchoolRecord();
        if (!school || !school.expiryDate) { badge.style.display = 'none'; return; }

        const expiry = new Date(school.expiryDate + 'T00:00:00');
        if (isNaN(expiry.getTime())) { badge.style.display = 'none'; return; }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

        if (daysLeft < 0) {
            text.textContent = 'Subscription expired';
            badge.style.display = 'flex';
        } else if (daysLeft <= EXPIRY_WARNING_DAYS) {
            text.textContent = daysLeft === 0
                ? 'Subscription expires today'
                : `Subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    function showToast(title, body, type = "success") {
        const toast = document.getElementById('toast-msg');
        if (!toast) return;

        document.getElementById('toast-title').innerText = title;
        document.getElementById('toast-body').innerText  = body;

        const types = { success:"#27ae60", danger:"#e74c3c", info:"#3498db", warning:"#f39c12" };
        toast.querySelector('.toast-indicator').style.background = types[type] || types.success;

        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 4000);
    }

    window.exportToCSV = function() {
        const db = getDatabase();
        if (db.length === 0) { alert("No student data available to export."); return; }

        const headers = ["RegNo","FullName","Class","Guardian","Phone","NetPayable","SiblingGroupID"];
        let csv = headers.join(",") + "\n";

        db.forEach(s => {
            const row = [
                s.regNo || s.id,
                s.fullName,
                s.studentClass,
                s.guardianName,
                s.phone1,
                s.netPayable,
                s.siblingGroupId || ''
            ];
            csv += row.map(v => `"${v}"`).join(",") + "\n";
        });

        const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `EDULOW_RECORDS_${new Date().toLocaleDateString()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    [searchName, searchFather, searchClass, searchId].forEach(inp => {
        if (inp) inp.addEventListener('input', () => renderStudentTable());
    });

    document.querySelectorAll('.mask-cnic').forEach(input => {
        input.addEventListener('input', e => {
            let v = e.target.value.replace(/\D/g, '');
            let f = "";
            if (v.length > 0) {
                f += v.substring(0, 5);
                if (v.length > 5)  f += "-" + v.substring(5, 12);
                if (v.length > 12) f += "-" + v.substring(12, 13);
            }
            e.target.value = f;
        });
    });

    // ── PLAN ENFORCEMENT: initial pass ──────────────────────────────────────
    applyFeatureLocks();
    renderPlanLimitBanners();
    renderSubscriptionExpiryBadge();

}); // End DOMContentLoaded

/**
 * ============================================================================
 * END OF SCRIPT — EDULOW PRO SIS ENGINE
 * ============================================================================
 */
/* ============================================================================
   CERTIFICATES — PAGE VIEW, MANUAL INPUT & PRINT
============================================================================ */

/* Open the certificate page view (hides main sections, shows cert page) */
function openCertPage() {
    _hideMainSections();
    document.getElementById('data-io-page-view').style.display = 'none';
    const archiveView = document.getElementById('archive-page-view');
    if (archiveView) archiveView.style.display = 'none';
    document.getElementById('cert-page-view').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* Close the certificate page view and restore main sections */
function closeCertPage() {
    document.getElementById('cert-page-view').style.display = 'none';
    document.getElementById('data-io-page-view').style.display = 'none';
    _showMainSections();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* Helpers: toggle only the real "home" sections, never the inline page-views */
const _INLINE_PAGE_VIEW_IDS = ['cert-page-view', 'data-io-page-view', 'archive-page-view'];
function _hideMainSections() {
    document.querySelectorAll('main > section').forEach(s => {
        if (_INLINE_PAGE_VIEW_IDS.includes(s.id)) return;
        s.style.display = 'none';
    });
}
function _showMainSections() {
    document.querySelectorAll('main > section').forEach(s => {
        if (_INLINE_PAGE_VIEW_IDS.includes(s.id)) return;
        s.style.display = '';
    });
}

/* ============================================================
   ENHANCED SLC — Search, fill, conduct, print
   ============================================================ */

/* Search bar for SLC modal */
function slcSearchStudents() {
    const input    = document.getElementById('slc-search-input');
    const dropdown = document.getElementById('slc-search-results');
    if (!input || !dropdown) return;
    const query = input.value.trim().toLowerCase();

    dropdown.innerHTML = '';
    if (!query) { dropdown.classList.remove('open'); return; }

    const students = JSON.parse(localStorage.getItem(DB_KEY) || '[]');
    let matches;

    if (query.includes('~')) {
        // Combined search: "Student Name~Guardian Name"
        const [namePartRaw, guardianPartRaw] = query.split('~');
        const namePart     = (namePartRaw || '').trim();
        const guardianPart = (guardianPartRaw || '').trim();
        matches = students.filter(s => {
    const name     = (s.name || s.fullName || '').toLowerCase();
    const guardian = (s.fatherName || s.guardianName || '').toLowerCase();
    // FIX: Force to string
    const regNo    = String(s.regNo || '').toLowerCase();
    const id       = String(s.id || '').toLowerCase();
    return name.includes(query) || guardian.includes(query) || regNo.includes(query) || id.includes(query);
}).slice(0, 8);
    } else {
        matches = students.filter(s => {
    const name     = (s.name || s.fullName || '').toLowerCase();
    const guardian = (s.fatherName || s.guardianName || '').toLowerCase();
    // FIX: Force to string
    const regNo    = String(s.regNo || '').toLowerCase();
    const id       = String(s.id || '').toLowerCase();
    return name.includes(query) || guardian.includes(query) || regNo.includes(query) || id.includes(query);
}).slice(0, 8);
    }

    if (!matches.length) {
        dropdown.innerHTML = '<div class="slc-dropdown-item"><span class="slc-di-name" style="color:var(--text-secondary)">No students found</span></div>';
        dropdown.classList.add('open');
        return;
    }

    matches.forEach(s => {
        const sName     = s.name || s.fullName || 'Unknown';
        const sGuardian = s.fatherName || s.guardianName || '—';
        const sId       = s.regNo || s.id || '—';
        const sClass    = s.class || s.studentClass || '—';
        const item = document.createElement('div');
        item.className = 'slc-dropdown-item';
        item.innerHTML = `
            <div class="slc-di-name"><i class="fas fa-user-graduate"></i> ${sName}</div>
            <div class="slc-di-meta">ID: ${sId} &nbsp;|&nbsp; Class: ${sClass} &nbsp;|&nbsp; Guardian: ${sGuardian}</div>`;
        item.addEventListener('click', () => {
            input.value = sName;
            dropdown.classList.remove('open');
            slcFillFromStudent(s);
        });
        dropdown.appendChild(item);
    });
    dropdown.classList.add('open');
}

/* Close SLC dropdown when clicking outside */
document.addEventListener('click', e => {
    const input    = document.getElementById('slc-search-input');
    const dropdown = document.getElementById('slc-search-results');
    if (input && dropdown && !input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
    }
});

/* Generate certificate manually when student isn't in the database */
function slcManualGenerate() {
    const idVal    = (document.getElementById('slc-manual-id')?.value || '').trim();
    const namesVal = (document.getElementById('slc-manual-names')?.value || '').trim();

    let studentName = namesVal;
    let guardianName = '';
    if (namesVal.includes('~')) {
        const [n, g] = namesVal.split('~');
        studentName  = (n || '').trim();
        guardianName = (g || '').trim();
    }

    if (!studentName) {
        alert('Please enter at least the student name (use Student~Guardian format if you want to add the guardian too).');
        return;
    }

    const leavingInput = document.getElementById('slc-leaving-date-input');
    const manualStudent = {
        name: studentName,
        fatherName: guardianName || '—',
        regNo: idVal || '—',
        id: idVal || '—',
        admissionDate: '—',
        dob: '—',
        class: '—',
        leavingDate: leavingInput && leavingInput.value ? leavingInput.value : ''
    };

    slcFillFromStudent(manualStudent);
}

/* Fill certificate from a student object */
function slcFillFromStudent(s) {
    const today     = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });
    const certNo    = 'SLC-' + String(Math.floor(1000 + Math.random() * 9000));
    const studentName  = s.name || s.fullName || '—';
    const regNo        = s.regNo || s.id || '—';
    const fatherName   = s.fatherName || s.guardianName || '—';
    const admissionDate= s.admissionDate || s.dateOfAdmission || '—';
    const dob          = s.dob || s.dateOfBirth || '—';
    const studentClass = s.class || s.studentClass || '—';

    // Date the student actually left the school (from record if available, else today; editable via input)
    const rawLeavingDate = s.leavingDate || s.dateOfLeaving || s.leftDate || '';
    const leavingDateInput = document.getElementById('slc-leaving-date-input');
    let leavingDateDisplay;
    if (rawLeavingDate) {
        leavingDateDisplay = new Date(rawLeavingDate).toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });
        if (leavingDateInput) leavingDateInput.value = rawLeavingDate;
    } else {
        leavingDateDisplay = today;
        if (leavingDateInput) leavingDateInput.value = new Date().toISOString().slice(0, 10);
    }

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    setText('slc-name-display', studentName);
    setText('slc-leaving-date', leavingDateDisplay);   // date student left the school
    setText('slc-issue-date', today);                  // date this certificate/voucher was generated
    setText('slc-cert-no', certNo);

    // Remember for share filename
    window.__slcCurrentName = studentName;
    window.__slcCurrentStudent = s;

    // School name from header if present
    const schoolEl = document.querySelector('.school-name');
    if (schoolEl) setText('slc-school-name', schoolEl.textContent);

    // Compose the beautiful bottom paragraph from real student details
    const recordEl = document.getElementById('slc-record-para');
    if (recordEl) {
        recordEl.innerHTML =
            `For official record, <strong>${studentName}</strong> (Student ID <strong>${regNo}</strong>), ` +
            `son/daughter of <strong>${fatherName}</strong>, was born on <strong>${dob}</strong> and ` +
            `was admitted to this institution on <strong>${admissionDate}</strong>. ` +
            `At the time of leaving, the student was enrolled in <strong>Class ${studentClass}</strong>. ` +
            `The school administration wishes him/her continued success in all future academic and personal endeavours.`;
    }

    document.getElementById('slc-empty-state').style.display = 'none';
    document.getElementById('slc-preview').style.display     = 'block';
    const printBtn = document.getElementById('slc-print-btn'); if (printBtn) printBtn.style.display = '';
    const shareBtn = document.getElementById('slc-share-btn'); if (shareBtn) shareBtn.style.display = '';
}

/* Let the user manually override the "Date of Leaving" shown on the certificate */
function slcUpdateLeavingDate() {
    const input = document.getElementById('slc-leaving-date-input');
    if (!input || !input.value) return;
    const display = new Date(input.value).toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });
    const el = document.getElementById('slc-leaving-date');
    if (el) el.textContent = display;
}

/* Capture SLC certificate as an image blob using html2canvas */
async function slcCaptureBlob() {
    const doc = document.getElementById('slc-document');
    if (!doc || typeof html2canvas === 'undefined') return null;
    const canvas = await html2canvas(doc, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    return new Promise(res => canvas.toBlob(res, 'image/png'));
}

/* Share SLC certificate as image (Web Share API → fallback to WhatsApp / download) */
async function shareSLC() {
    const name = (window.__slcCurrentName || 'student').replace(/[^a-z0-9]+/gi, '_');
    const filename = `School_Leaving_Certificate_${name}.png`;
    const shareBtn = document.getElementById('slc-share-btn');
    const oldHtml = shareBtn ? shareBtn.innerHTML : '';
    if (shareBtn) { shareBtn.disabled = true; shareBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...'; }
    try {
        const blob = await slcCaptureBlob();
        if (!blob) throw new Error('Capture failed');
        const file = new File([blob], filename, { type: 'image/png' });

        // 1) Native share with file (mobile WhatsApp, etc.)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: 'School Leaving Certificate',
                text: `School Leaving Certificate for ${window.__slcCurrentName || ''}`
            });
            return;
        }

        // 2) Fallback: download image + open WhatsApp Web with a prefilled message
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);

        const msg = encodeURIComponent(
            `School Leaving Certificate for ${window.__slcCurrentName || 'student'}.\n` +
            `(The certificate image has been downloaded — please attach "${filename}" in WhatsApp.)`
        );
        window.open(`https://wa.me/?text=${msg}`, '_blank');
    } catch (err) {
        console.error('Share failed', err);
        alert('Sharing failed. The certificate image could not be generated.');
    } finally {
        if (shareBtn) { shareBtn.disabled = false; shareBtn.innerHTML = oldHtml; }
    }
}

/* No-op kept for backward compatibility (conduct dropdown removed) */
function slcUpdateConduct() { /* removed: conduct & performance no longer shown */ }


/* Print the SLC */
function printSLC() {
    const doc = document.getElementById('slc-document');
    if (!doc) return;

    const printWin = window.open('', '_blank', 'width=1180,height=820');
    printWin.document.write(`<!DOCTYPE html>
<html>
<head>
<title>School Leaving Certificate</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Cormorant Garamond',Georgia,serif;background:#eef2f7;padding:24px;display:flex;justify-content:center;align-items:center;min-height:100vh}
.slc-cert-outer.slc-landscape{position:relative;background:#fff;width:1050px;height:740px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.18);border-radius:6px;color:#0f172a}

/* Decorative blue geometric corner shapes (like reference) */
.slc-geo{position:absolute;background:#3b6fb8;z-index:0}
.slc-geo-tl{top:-60px;left:-60px;width:260px;height:260px;transform:rotate(45deg);background:linear-gradient(135deg,#5a8acd,#3b6fb8)}
.slc-geo-tl2{top:-30px;left:80px;width:140px;height:140px;transform:rotate(45deg);background:#7ba6dd;opacity:.7}
.slc-geo-bl{bottom:-80px;left:-40px;width:280px;height:280px;transform:rotate(45deg);background:linear-gradient(135deg,#3b6fb8,#2c5797)}
.slc-geo-bl2{bottom:40px;left:-40px;width:120px;height:120px;transform:rotate(45deg);background:#7ba6dd;opacity:.6}
.slc-geo-tr{top:-70px;right:-60px;width:260px;height:260px;transform:rotate(45deg);background:linear-gradient(135deg,#3b6fb8,#5a8acd)}
.slc-geo-tr2{top:80px;right:-50px;width:140px;height:140px;transform:rotate(45deg);background:#7ba6dd;opacity:.7}
.slc-geo-br{bottom:-70px;right:-60px;width:240px;height:240px;transform:rotate(45deg);background:linear-gradient(135deg,#2c5797,#3b6fb8)}
.slc-geo-br2{bottom:60px;right:80px;width:120px;height:120px;transform:rotate(45deg);background:#7ba6dd;opacity:.6}

.slc-inner{position:relative;z-index:2;background:#fff;margin:46px;height:calc(100% - 92px);padding:32px 56px 72px;display:flex;flex-direction:column}

.slc-l-header{display:flex;align-items:center;gap:18px;padding-bottom:14px;border-bottom:1px solid #e2e8f0}
.slc-l-logo{width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#2c5797,#3b6fb8);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;box-shadow:0 4px 14px rgba(59,111,184,.4)}
.slc-l-school-block{flex:1;text-align:center}
.slc-l-school-name{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;letter-spacing:.18em;color:#0f172a;text-transform:uppercase}
.slc-l-school-meta{margin-top:4px;font-family:'Inter',sans-serif;font-size:11px;color:#64748b;letter-spacing:.04em}
.slc-l-dot{margin:0 8px;color:#cbd5e1}
.slc-l-serial{text-align:right;flex-shrink:0;font-family:'Inter',sans-serif}
.slc-l-serial-label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}
.slc-l-serial-value{font-size:13px;font-weight:700;color:#2c5797;margin-top:2px}

.slc-l-title{text-align:center;margin-top:26px;font-family:'Cormorant Garamond',serif;font-size:42px;font-weight:700;color:#1e293b;letter-spacing:.04em}
.slc-l-certify{text-align:center;margin-top:14px;font-size:18px;color:#475569;font-style:italic}
.slc-l-name{text-align:center;margin-top:6px;font-family:'Great Vibes',cursive;font-size:72px;color:#3b6fb8;line-height:1.05}

.slc-l-main-para{text-align:center;margin:14px auto 0;max-width:780px;font-size:18px;line-height:1.55;color:#334155;font-family:'Cormorant Garamond',serif}

.slc-l-dates-row{display:flex;align-items:center;justify-content:center;gap:36px;margin:18px auto 0;max-width:780px}
.slc-l-date-item{text-align:center}
.slc-l-date-label{font-family:'Inter',sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8}
.slc-l-date-label i{margin-right:4px;color:#3b6fb8}
.slc-l-date-value{font-family:'Inter',sans-serif;font-size:14px;font-weight:700;color:#1e293b;margin-top:3px}
.slc-l-date-sep{width:1px;height:30px;background:#cbd5e1}

.slc-l-record-para{margin-top:18px;padding:14px 22px;font-size:14px;line-height:1.7;color:#475569;font-family:'Inter',sans-serif;text-align:justify;border-top:1px dashed #cbd5e1;border-bottom:1px dashed #cbd5e1;background:#f8fafc;border-radius:6px}
.slc-l-record-para strong{color:#1e293b}

.slc-l-footer{margin-top:auto;padding-top:22px;padding-bottom:24px;display:flex;align-items:flex-end;justify-content:space-around;gap:40px}
.slc-l-footer-principal-only{justify-content:flex-end;padding-right:40px}
.slc-l-sig-principal{min-width:220px}
.slc-l-stamp-spacer{min-width:120px}
.slc-l-sig{text-align:center;min-width:200px}
.slc-l-sig-line{width:180px;height:1px;background:#334155;margin:0 auto 8px}
.slc-l-sig-title{font-family:'Inter',sans-serif;font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.06em}
.slc-l-sig-sub{font-family:'Inter',sans-serif;font-size:10px;color:#94a3b8;margin-top:2px}
.slc-l-stamp{display:flex;justify-content:center}
.slc-l-stamp-ring{width:96px;height:96px;border:2px dashed #94a3b8;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#94a3b8;text-align:center;font-family:'Inter',sans-serif}
.slc-l-stamp-ring i{font-size:22px;margin-bottom:4px}
.slc-l-stamp-ring span{font-size:8px;font-weight:700;letter-spacing:.12em;line-height:1.2}

@media print{
  html,body{padding:0;margin:0;background:#fff;width:100%;height:100%}
  @page{size:A4 landscape;margin:6mm}
  .slc-cert-outer.slc-landscape{box-shadow:none;border-radius:0;margin:0 auto;page-break-after:avoid;page-break-inside:avoid}
}
</style>
</head>
<body>${doc.outerHTML}</body>
</html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); printWin.close(); }, 700);
}


/* ============================================================
   ENHANCED CHARACTER CERTIFICATE — Search, fill, conduct, print
   ============================================================ */

/* Search bar for Character Certificate modal */
function charSearchStudents() {
    const input    = document.getElementById('char-search-input');
    const dropdown = document.getElementById('char-search-results');
    if (!input || !dropdown) return;
    const query = input.value.trim().toLowerCase();

    dropdown.innerHTML = '';
    if (!query) { dropdown.classList.remove('open'); return; }

    const students = JSON.parse(localStorage.getItem(DB_KEY) || '[]');
    let matches;

    if (query.includes('~')) {
        const [namePartRaw, guardianPartRaw] = query.split('~');
        const namePart     = (namePartRaw || '').trim();
        const guardianPart = (guardianPartRaw || '').trim();
        matches = students.filter(s => {
            const name     = (s.name || s.fullName || '').toLowerCase();
            const guardian = (s.fatherName || s.guardianName || '').toLowerCase();
            const nameOk     = !namePart || name.includes(namePart);
            const guardianOk = !guardianPart || guardian.includes(guardianPart);
            return nameOk && guardianOk;
        }).slice(0, 8);
    } else {
        matches = students.filter(s => {
            const name     = (s.name || s.fullName || '').toLowerCase();
            const guardian = (s.fatherName || s.guardianName || '').toLowerCase();
            
            // FIX APPLIED HERE: Force numeric IDs to String
            const regNo    = String(s.regNo || '').toLowerCase();
            const id       = String(s.id || '').toLowerCase();
            
            return name.includes(query) || guardian.includes(query) || regNo.includes(query) || id.includes(query);
        }).slice(0, 8);
    }

    if (!matches.length) {
        dropdown.innerHTML = '<div class="slc-dropdown-item"><span class="slc-di-name" style="color:var(--text-secondary)">No students found</span></div>';
        dropdown.classList.add('open');
        return;
    }

    matches.forEach(s => {
        const sName     = s.name || s.fullName || 'Unknown';
        const sGuardian = s.fatherName || s.guardianName || '—';
        const sId       = s.regNo || s.id || '—';
        const sClass    = s.class || s.studentClass || '—';
        const item = document.createElement('div');
        item.className = 'slc-dropdown-item';
        item.innerHTML = `
            <div class="slc-di-name"><i class="fas fa-user-graduate"></i> ${sName}</div>
            <div class="slc-di-meta">ID: ${sId} &nbsp;|&nbsp; Class: ${sClass} &nbsp;|&nbsp; Guardian: ${sGuardian}</div>`;
        item.addEventListener('click', () => {
            input.value = sName;
            dropdown.classList.remove('open');
            charFillFromStudent(s);
        });
        dropdown.appendChild(item);
    });
    dropdown.classList.add('open');
}

/* Close char dropdown when clicking outside */
document.addEventListener('click', e => {
    const input    = document.getElementById('char-search-input');
    const dropdown = document.getElementById('char-search-results');
    if (input && dropdown && !input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
    }
});

/* Generate certificate manually when student isn't in the database */
function charManualGenerate() {
    const idVal     = (document.getElementById('char-manual-id')?.value || '').trim();
    const namesVal  = (document.getElementById('char-manual-names')?.value || '').trim();
    const genderVal = document.getElementById('char-manual-gender')?.value || 'Female';

    let studentName  = namesVal;
    let guardianName = '';
    if (namesVal.includes('~')) {
        const [n, g] = namesVal.split('~');
        studentName  = (n || '').trim();
        guardianName = (g || '').trim();
    }

    if (!studentName) {
        alert('Please enter at least the student name (use Student~Guardian format if you want to add the guardian too).');
        return;
    }

    const fromInput = document.getElementById('char-from-date-input');
    const toInput   = document.getElementById('char-to-date-input');

    const manualStudent = {
        name: studentName,
        fatherName: guardianName || '—',
        regNo: idVal || '—',
        id: idVal || '—',
        gender: genderVal,
        admissionDate: fromInput && fromInput.value ? fromInput.value : '',
        leavingDate: toInput && toInput.value ? toInput.value : ''
    };

    charFillFromStudent(manualStudent);
}

/* Build the moral-character paragraph based on the conduct level selected */
function charBuildParagraph(studentName, guardianLabel, fatherName, fromDisplay, toDisplay, pronouns, conduct) {
    const { sub, poss, obj } = pronouns; // sub: He/She, poss: His/Her, obj: him/her

    const opening = `It is to certify that <strong>${studentName}</strong> ${guardianLabel} <strong>${fatherName}</strong> ` +
        `who has studied in this institution from <strong>${fromDisplay}</strong> to <strong>${toDisplay}</strong>, `;

    const templates = {
        excellent: opening +
            `bears an <strong>excellent moral character</strong>. ${poss} behaviour was outstanding with teachers and students alike. ` +
            `${sub} consistently displayed honesty, discipline, and respect, and never showed any sign of violent or aggressive behaviour, ` +
            `nor any desire to harm others. ${sub} is held in the highest regard by the institution.`,
        good: opening +
            `bears a <strong>good moral character</strong>. ${poss} behaviour was good with teachers and students. ` +
            `${sub} neither displayed persistent violent or aggressive behaviour nor any desire to harm others.`,
        moderate: opening +
            `bears a <strong>moderate moral character</strong>. ${poss} behaviour with teachers and students was generally acceptable, ` +
            `though there were occasional instances requiring guidance and correction. ${sub} showed no serious signs of violent or ` +
            `aggressive behaviour, nor any desire to harm others.`,
        bad: opening +
            `was found to bear a <strong>poor moral character</strong> during ${poss.toLowerCase()} time at this institution. ` +
            `${poss} behaviour with teachers and students raised repeated concerns, including instances of disruptive, ` +
            `aggressive, or disrespectful conduct that required disciplinary action.`
    };

    return templates[conduct] || templates.good;
}

/* Fill certificate from a student object */
function charFillFromStudent(s) {
    const today = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });
    const studentName = s.name || s.fullName || '—';
    const regNo       = s.regNo || s.id || '—';
    const fatherName  = s.fatherName || s.guardianName || '—';
    const gender      = s.gender || 'Female';

    const guardianLabel = gender === 'Male' ? 'Son of' : 'Daughter of';
    const pronouns = gender === 'Male'
        ? { sub: 'He', poss: 'His', obj: 'him' }
        : { sub: 'She', poss: 'Her', obj: 'her' };

    const fromInput = document.getElementById('char-from-date-input');
    const toInput   = document.getElementById('char-to-date-input');

    const rawFrom = s.admissionDate || s.dateOfAdmission || '';
    const rawTo   = s.leavingDate || s.dateOfLeaving || '';

    if (rawFrom && fromInput) fromInput.value = rawFrom;
    if (rawTo && toInput)     toInput.value   = rawTo;

    const fromDisplay = (fromInput && fromInput.value) ? new Date(fromInput.value).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const toDisplay   = (toInput && toInput.value)     ? new Date(toInput.value).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    setText('char-name-display', studentName);
    setText('char-id-display', regNo);
    setText('char-issue-date', today);

    const schoolEl = document.querySelector('.school-name');
    const schoolName = schoolEl ? schoolEl.textContent : 'ST. LAWRENCE INTERNATIONAL SCHOOL';
    setText('char-school-name', schoolName);
    setText('char-taught-at', schoolName);

    // Remember for conduct re-render & print
    window.__charCurrentName     = studentName;
    window.__charCurrentStudent  = s;
    window.__charGuardianLabel   = guardianLabel;
    window.__charFatherName      = fatherName;
    window.__charPronouns        = pronouns;
    window.__charFromDisplay     = fromDisplay;
    window.__charToDisplay       = toDisplay;

    charRenderParagraph();

    document.getElementById('char-empty-state').style.display = 'none';
    document.getElementById('char-preview').style.display     = 'block';
    const printBtn = document.getElementById('char-print-btn'); if (printBtn) printBtn.style.display = '';
    const shareBtn = document.getElementById('char-share-btn'); if (shareBtn) shareBtn.style.display = '';
}

/* Re-render the paragraph using the currently selected conduct option */
function charRenderParagraph() {
    if (!window.__charCurrentName) return;
    const conduct = document.getElementById('char-conduct-select')?.value || 'good';
    const para = charBuildParagraph(
        window.__charCurrentName,
        window.__charGuardianLabel,
        window.__charFatherName,
        window.__charFromDisplay,
        window.__charToDisplay,
        window.__charPronouns,
        conduct
    );
    const el = document.getElementById('char-main-para');
    if (el) el.innerHTML = para;
}

/* Conduct dropdown changed -> update paragraph live */
function charUpdateConduct() {
    charRenderParagraph();
}

/* "Studied From"/"Studied To" date inputs changed -> update dates + paragraph */
function charUpdateDates() {
    const fromInput = document.getElementById('char-from-date-input');
    const toInput   = document.getElementById('char-to-date-input');
    window.__charFromDisplay = (fromInput && fromInput.value) ? new Date(fromInput.value).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    window.__charToDisplay   = (toInput && toInput.value)     ? new Date(toInput.value).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    charRenderParagraph();
}

/* Capture Character Certificate as an image blob using html2canvas */
async function charCaptureBlob() {
    const doc = document.getElementById('char-document');
    if (!doc || typeof html2canvas === 'undefined') return null;
    const canvas = await html2canvas(doc, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    return new Promise(res => canvas.toBlob(res, 'image/png'));
}

/* Share Character Certificate as image (Web Share API → fallback to WhatsApp / download) */
async function shareCharCert() {
    const name = (window.__charCurrentName || 'student').replace(/[^a-z0-9]+/gi, '_');
    const filename = `Character_Certificate_${name}.png`;
    const shareBtn = document.getElementById('char-share-btn');
    const oldHtml = shareBtn ? shareBtn.innerHTML : '';
    if (shareBtn) { shareBtn.disabled = true; shareBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...'; }
    try {
        const blob = await charCaptureBlob();
        if (!blob) throw new Error('Capture failed');
        const file = new File([blob], filename, { type: 'image/png' });

        // 1) Native share with file (mobile WhatsApp, etc.)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: 'Character Certificate',
                text: `Character Certificate for ${window.__charCurrentName || ''}`
            });
            return;
        }

        // 2) Fallback: download image + open WhatsApp Web with a prefilled message
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);

        const msg = encodeURIComponent(
            `Character Certificate for ${window.__charCurrentName || 'student'}.\n` +
            `(The certificate image has been downloaded — please attach "${filename}" in WhatsApp.)`
        );
        window.open(`https://wa.me/?text=${msg}`, '_blank');
    } catch (err) {
        console.error('Share failed', err);
        alert('Sharing failed. The certificate image could not be generated.');
    } finally {
        if (shareBtn) { shareBtn.disabled = false; shareBtn.innerHTML = oldHtml; }
    }
}

/* Print the Character Certificate */
function printCharCert() {
    const doc = document.getElementById('char-document');
    if (!doc) return;

    const printWin = window.open('', '_blank', 'width=900,height=1100');
    printWin.document.write(`<!DOCTYPE html>
<html>
<head>
<title>Character Certificate</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Cormorant Garamond',Georgia,serif;background:#eef2f7;padding:24px;display:flex;justify-content:center;align-items:center;min-height:100vh}
.char-cert-outer{position:relative;background:#fff;width:760px;min-height:980px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.18);border-radius:4px;color:#0f172a;margin:0 auto}
.char-geo{position:absolute;width:0;height:0;z-index:1}
.char-geo-tl{top:0;left:0;border-top:170px solid #c8a753;border-right:170px solid transparent}
.char-geo-bl{bottom:0;left:0;border-bottom:170px solid #1a2744;border-right:170px solid transparent}
.char-geo-tr{top:0;right:0;border-top:130px solid #1a2744;border-left:130px solid transparent}
.char-geo-br{bottom:0;right:0;border-bottom:130px solid #c8a753;border-left:130px solid transparent}
.char-border-frame{position:absolute;inset:26px;border:2px solid #c8a753;z-index:2;pointer-events:none}
.char-inner{position:relative;z-index:3;padding:64px 64px 50px;display:flex;flex-direction:column;align-items:center;text-align:center;height:100%}
.char-l-header{display:flex;align-items:center;gap:14px;width:100%;margin-bottom:18px}
.char-l-logo{width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#1a2744,#3b6fb8);color:#fff;display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0;box-shadow:0 4px 14px rgba(26,39,68,.35)}
.char-l-school-block{flex:1;text-align:center}
.char-l-school-meta{margin-top:3px;font-family:'Inter',sans-serif;font-size:10.5px;color:#64748b;letter-spacing:.04em}
.char-l-dot{margin:0 8px;color:#cbd5e1}
.char-school-name{font-family:'Inter',sans-serif;font-size:11px;letter-spacing:.18em;color:#64748b;text-transform:uppercase;margin-bottom:0}
.char-certify-line{font-family:'Cormorant Garamond',serif;font-size:15px;font-style:italic;color:#475569;margin-bottom:18px}
.char-title{font-family:'Great Vibes',cursive;font-size:54px;color:#1a2744;line-height:1;margin-bottom:4px}
.char-subtitle{font-family:'Inter',sans-serif;font-size:20px;font-weight:700;letter-spacing:.1em;color:#c8a753;text-transform:uppercase;margin-bottom:18px}
.char-medal-icons{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:22px;color:#1a2744}
.char-medal-icons i{font-size:26px}
.char-medal-main{font-size:40px;color:#c8a753}
.char-name{font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:700;color:#0f172a;letter-spacing:.03em;margin-top:6px}
.char-name-underline{width:260px;height:1px;background:#c8a753;margin:8px auto 22px}
.char-main-para{font-family:'Inter',sans-serif;font-size:14.5px;line-height:1.85;color:#334155;max-width:560px;text-align:justify;margin-bottom:30px}
.char-main-para strong{color:#0f172a}
.char-meta-row{display:flex;align-items:center;justify-content:center;gap:30px;margin-bottom:auto;padding-bottom:30px;width:100%;flex-wrap:wrap}
.char-meta-item{text-align:center}
.char-meta-label{font-family:'Inter',sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}
.char-meta-value{font-family:'Inter',sans-serif;font-size:13px;font-weight:700;color:#1a2744;margin-top:3px}
.char-footer{margin-top:auto;padding-top:30px;display:flex;justify-content:center;width:100%}
.char-sig{text-align:center;min-width:220px}
.char-sig-line{width:200px;height:1px;background:#334155;margin:0 auto 8px}
.char-sig-title{font-family:'Inter',sans-serif;font-size:12px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.06em}
@media print{
  html,body{padding:0;margin:0;background:#fff;width:100%;height:100%}
  @page{size:A4 portrait;margin:6mm}
  .char-cert-outer{box-shadow:none;border-radius:0;margin:0 auto;page-break-after:avoid;page-break-inside:avoid}
}
</style>
</head>
<body>${doc.outerHTML}</body>
</html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); printWin.close(); }, 700);
}

function getCurrentAcademicSession() {
    const now   = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();
    if (month >= 4) {
        return `${year} – ${year + 1}`;
    } else {
        return `${year - 1} – ${year}`;
    }
}

function printCertificate(docId) {
    const doc = document.getElementById(docId);
    if (!doc) return;

    const printWin = window.open('', '_blank', 'width=800,height=700');
    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Certificate</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: Georgia, serif; background: #fff; padding: 20px; }
                .cert-header-band { height: 8px; background: linear-gradient(90deg,#1e40af,#6d28d9,#be185d); }
                .cert-footer-band { margin-top: 0; }
                .cert-school-header { display: flex; align-items: center; gap: 16px; padding: 20px 28px 12px; border-bottom: 1px solid #e5e7eb; }
                .cert-school-logo { width:52px; height:52px; border-radius:50%; background:linear-gradient(135deg,#1e40af,#6d28d9); display:flex; align-items:center; justify-content:center; color:#fff; font-size:22px; flex-shrink:0; }
                .cert-school-name { font-size:20px; font-weight:700; color:#111827; }
                .cert-school-tagline { font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:.04em; font-family:sans-serif; }
                .cert-title-banner { background:#f8fafc; text-align:center; padding:16px 28px; border-bottom:1px solid #e5e7eb; }
                .cert-main-title { font-size:18px; font-weight:700; color:#1e3a5f; text-transform:uppercase; letter-spacing:.08em; }
                .cert-body-text { padding:20px 28px; font-size:13.5px; line-height:1.75; color:#374151; }
                .cert-body-text p { margin-bottom:12px; }
                .cert-meta-grid { display:grid; grid-template-columns:repeat(2,1fr); margin:0 28px 20px; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; }
                .cert-meta-item { padding:10px 14px; border-right:1px solid #e5e7eb; border-bottom:1px solid #e5e7eb; }
                .cert-meta-item:nth-child(even){ border-right:none; }
                .cert-meta-item:nth-last-child(-n+2){ border-bottom:none; }
                .cert-meta-label { font-size:10px; font-weight:600; text-transform:uppercase; color:#9ca3af; font-family:sans-serif; }
                .cert-meta-value { font-size:13px; font-weight:600; color:#111827; }
                .cert-footer-row { display:flex; align-items:flex-end; justify-content:space-between; padding:20px 40px 24px; }
                .cert-sig-block { text-align:center; font-size:11px; color:#6b7280; font-family:sans-serif; }
                .cert-sig-block p { margin:6px 0 0; }
                .cert-sig-line { width:120px; height:1px; background:#374151; }
                .cert-stamp-circle { width:64px; height:64px; border-radius:50%; border:2px dashed #d1d5db; display:flex; align-items:center; justify-content:center; color:#d1d5db; font-size:22px; }
            </style>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
        </head>
        <body>${doc.outerHTML}</body>
        </html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); printWin.close(); }, 600);
}
/* ============================================================
   DATA EXPORT & IMPORT — openDataIOPage / closeDataIOPage
   ============================================================ */

function openDataIOPage() {
    _hideMainSections();
    document.getElementById('cert-page-view').style.display = 'none';
    const archiveView = document.getElementById('archive-page-view');
    if (archiveView) archiveView.style.display = 'none';
    document.getElementById('data-io-page-view').style.display = 'block';
    const statusEl = document.getElementById('data-io-status');
    if (statusEl) statusEl.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeDataIOPage() {
    document.getElementById('data-io-page-view').style.display = 'none';
    document.getElementById('cert-page-view').style.display = 'none';
    _showMainSections();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showDataIOStatus(message, type) {
    const el = document.getElementById('data-io-status');
    if (!el) return;
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
    el.className = 'data-io-status ' + (type || 'info');
    el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${message}`;
    el.style.display = 'flex';
}

/* ============================================================
   EXPORT — Build a formatted xlsx workbook from localStorage
   Includes: Student Photos, B-Form Images, Full Discount Breakdown
   ============================================================ */

/**
 * Convert a base64 data URL to a plain base64 string (strips the prefix).
 * Returns null if the input is not a valid image data URL.
 */
function _b64ImageOnly(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i);
    return match ? match[2] : null;
}

/**
 * Embed a base64 image into a worksheet at a given cell (top-left anchor).
 * Uses XLSX's addImage API (requires xlsx-js-style or the full xlsx build).
 * Falls back silently if addImage is unavailable.
 *
 * @param {object} wb          XLSX workbook
 * @param {object} ws          Target worksheet
 * @param {string} wsName      Worksheet name (needed for addImage)
 * @param {string} b64         Pure base64 image data (no prefix)
 * @param {string} ext         Extension: 'png' | 'jpeg' | 'gif'
 * @param {number} col         0-indexed column
 * @param {number} row         0-indexed row
 * @param {number} colW        Width in EMU (pixels × 9525)
 * @param {number} rowH        Height in EMU (pixels × 9525)
 */
function _addImageToSheet(wb, ws, wsName, b64, ext, col, row, colW, rowH) {
    try {
        if (!wb.addImage || !ws['!images']) {
            // Fallback: attach images array directly on the worksheet
            if (!ws['!images']) ws['!images'] = [];
        }
        const imgId = wb.addImage ? wb.addImage({ base64: b64, extension: ext }) : null;

        const imgObj = {
            '!pos': { r: row, c: col, x: 0, y: 0, w: colW, h: rowH },
        };
        if (imgId !== null) imgObj['!id'] = imgId;
        else imgObj['!data'] = { base64: b64, extension: ext };

        if (!ws['!images']) ws['!images'] = [];
        ws['!images'].push(imgObj);
    } catch (e) {
        // Image embedding is a best-effort feature; silently skip on failure
    }
}

/**
 * Build a small single-image worksheet showing a student's photo or B-Form scan.
 * The image is embedded using an <img> tag written into an HTML worksheet
 * so it always renders regardless of XLSX engine support.
 *
 * Since SheetJS CE (the CDN version) does not support image embedding natively
 * we use a workaround: we build a dedicated "Photos" sheet that lists
 * each student's name, ID, and the base64 data URL as a hyperlink/note,
 * AND we generate a separate standalone HTML file with all photos embedded.
 *
 * The HTML photo gallery is packaged as a Blob and downloaded alongside the xlsx.
 */
function _buildPhotoGalleryHTML(students) {
    const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const now = new Date();
    const dateStr = `${now.getDate()} ${MONTHS[now.getMonth()+1]} ${now.getFullYear()}`;

    const cards = students.map(s => {
        const name  = s.fullName || s.name || 'Unknown';
        const regNo = s.regNo || s.id || '—';
        const cls   = s.studentClass || s.class || '—';
        const photoSrc  = (s.photo && s.photo.startsWith('data:image')) ? s.photo : '';
        const bformSrc  = (s.certData && s.certData.startsWith('data:')) ? s.certData : '';

        const photoBlock = photoSrc
            ? `<img src="${photoSrc}" alt="Photo of ${name}" style="width:110px;height:120px;object-fit:cover;border-radius:6px;border:2px solid #3b82f6;">`
            : `<div style="width:110px;height:120px;background:#e2e8f0;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;border:2px dashed #cbd5e1;">No Photo</div>`;

        const bformBlock = bformSrc
            ? (bformSrc.startsWith('data:image')
                ? `<img src="${bformSrc}" alt="B-Form" style="max-width:180px;max-height:130px;object-fit:contain;border-radius:4px;border:1px solid #e2e8f0;">`
                : `<a href="${bformSrc}" style="display:inline-block;padding:6px 12px;background:#3b82f6;color:#fff;border-radius:4px;text-decoration:none;font-size:11px;" download="${regNo}_bform.pdf">📄 Download B-Form PDF</a>`)
            : `<span style="color:#94a3b8;font-size:11px;font-style:italic;">Not uploaded</span>`;

        return `
        <div style="display:flex;gap:16px;align-items:flex-start;padding:16px;background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,0.1);margin-bottom:12px;border-left:4px solid #3b82f6;">
            <div style="flex-shrink:0;">${photoBlock}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:4px;">${name}</div>
                <div style="font-size:12px;color:#64748b;margin-bottom:8px;">ID: <b>${regNo}</b> &nbsp;|&nbsp; Class: <b>${cls}</b></div>
                <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;">B-Form / Certificate</div>
                ${bformBlock}
            </div>
        </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>EduFlow Pro — Student Photo Gallery</title>
<style>
  body { font-family: Arial, sans-serif; background: #f1f5f9; margin: 0; padding: 20px; color: #1e293b; }
  h1 { font-size: 20px; margin-bottom: 4px; color: #1e293b; }
  .meta { font-size: 12px; color: #64748b; margin-bottom: 20px; }
  .grid { max-width: 820px; margin: 0 auto; }
  @media print { body { background:#fff; } }
</style>
</head>
<body>
<div class="grid">
  <h1>📸 Student Photo & Document Gallery</h1>
  <div class="meta">ST. LAWRENCE INTERNATIONAL SCHOOL &nbsp;|&nbsp; Generated: ${dateStr} &nbsp;|&nbsp; ${students.length} student(s)</div>
  ${cards}
</div>
</body>
</html>`;
}

function exportStudentsToExcel() {
    if (typeof XLSX === 'undefined') {
        showDataIOStatus('Excel library not loaded yet. Please wait a moment and try again.', 'error');
        return;
    }

    const students = JSON.parse(localStorage.getItem(DB_KEY) || '[]');
    if (!students.length) {
        showDataIOStatus('No student records found to export.', 'error');
        return;
    }

    // ── Confirmation before exporting ──
    const ok = window.confirm(
        `Export ${students.length} student record(s) to Excel?\n\n` +
        `This will download:\n` +
        `  • EduSoft (Student Data).xlsx — full directory & discount breakdown\n` +
        `  • EduSoft (Student Photos).html — photos & B-Form images (if any)\n\n` +
        `Click OK to continue, or Cancel to abort.`
    );
    if (!ok) {
        showDataIOStatus('Export cancelled.', 'info');
        return;
    }

    showDataIOStatus('Preparing Excel file… please wait.', 'info');

    try {
        const wb = XLSX.utils.book_new();

        /* ── Sheet 1: Full Student Directory (all fields) ── */
        const dirHeaders = [
            'Reg No', 'Sibling Group ID', 'Full Name', 'Father / Guardian', 'Guardian Role',
            'Guardian CNIC', 'Gender', 'Date of Birth', 'Age', 'Class', 'Section', 'Roll No',
            'Admission Date', 'Phone 1', 'Phone 2', 'Permanent Address', 'Mailing Address',
            'Student B-Form No.', 'Medical Issues',
            'Orphan Status', 'Previous School Attended', 'Previous Class',
            'Transport Mode', 'Transport Type', 'Transport Fee (PKR)',
            'Monthly Tuition Fee (PKR)', 'Annual Fund (PKR)', 'Annual Fund Month',
            'Tuition Discount (PKR)', 'Transport Discount (PKR)', 'Sibling Discount (PKR)',
            'Total Discount (PKR)', 'Discount Type', 'Discount Valid Until',
            'Net Payable (PKR)', 'Has Sibling', 'Sibling Of',
            'Student Photo (Link)', 'B-Form / Cert (Link)'
        ];

        const dirRows = students.map(s => {
            const tuitionDisc   = Number(s.tuitionDiscount)   || 0;
            const transportDisc = Number(s.transportDiscount) || 0;
            const siblingDisc   = Number(s.siblingDiscount)   || 0;
            const totalDiscount = tuitionDisc + transportDisc + siblingDisc;

            const annualFundEnabled = s.annualFundEnabled === 'on' || s.annualFundEnabled === true;
            const annualFund = annualFundEnabled
                ? (s.annualFundAmount != null && s.annualFundAmount !== '' ? Number(s.annualFundAmount) : '')
                : 0;

            const MONTH_NAMES = ['','January','February','March','April','May','June',
                                  'July','August','September','October','November','December'];
            const annualFundMonth = annualFundEnabled && s.annualFundMonth
                ? (MONTH_NAMES[Number(s.annualFundMonth)] || s.annualFundMonth)
                : '';

            const discountType = (s.isLifetime === 'on' || s.isLifetime === true)
                ? 'Lifetime'
                : (s.discountExpiry ? 'Temporary' : 'None');

            // Student photo — embed note if it exists
            const hasPhoto = s.photo && s.photo.startsWith('data:image');
            const hasBform = s.certData && s.certData.startsWith('data:');

            return [
                s.regNo                         || '',
                s.isSibling && s.siblingGroupId ? s.siblingGroupId : '',
                s.fullName  || s.name           || '',
                s.guardianName || s.fatherName  || '',
                s.guardianRole                  || '',
                s.guardianCnic                  || '',
                s.gender                        || '',
                s.dob                           || '',
                s.age                           || '',
                s.studentClass || s.class       || '',
                s.section                       || '',
                s.rollNo                        || '',
                s.admissionDate                 || '',
                s.phone1                        || '',
                s.phone2                        || '',
                s.permanentAddress || s.address || '',
                s.mailingAddress                || '',
                s.studentBform                  || '',
                s.medicalIssues                 || '',
                s.orphanStatus                  || '',
                s.previousSchool                || '',
                s.previousClass                 || '',
                s.transportMode                 || '',
                s.transportType                 || '',
                s.transportFee != null && s.transportFee !== '' ? Number(s.transportFee) : 0,
                s.standardFee  != null && s.standardFee  !== '' ? Number(s.standardFee)  : '',
                annualFund,
                annualFundMonth,
                tuitionDisc,
                transportDisc,
                siblingDisc,
                totalDiscount,
                discountType,
                s.discountExpiry || (discountType === 'Lifetime' ? 'Lifetime' : ''),
                s.netPayable != null && s.netPayable !== '' ? Number(s.netPayable) : '',
                s.isSibling ? 'Yes' : 'No',
                s.siblingOf || '',
                hasPhoto ? '✔ Saved (see Photo Gallery HTML)' : '✘ Not uploaded',
                hasBform ? '✔ Saved (see Photo Gallery HTML)' : '✘ Not uploaded'
            ];
        });

        const dirData = [dirHeaders, ...dirRows];
        const wsDir   = XLSX.utils.aoa_to_sheet(dirData);
        wsDir['!cols'] = [
            { wch: 12 }, { wch: 14 }, { wch: 26 }, { wch: 26 }, { wch: 16 },
            { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 7  }, { wch: 14 },
            { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
            { wch: 30 }, { wch: 30 }, { wch: 20 }, { wch: 22 },
            { wch: 16 }, { wch: 26 }, { wch: 16 },
            { wch: 16 }, { wch: 14 }, { wch: 18 },
            { wch: 22 }, { wch: 18 }, { wch: 20 },
            { wch: 22 }, { wch: 24 }, { wch: 22 },
            { wch: 20 }, { wch: 16 }, { wch: 22 },
            { wch: 18 }, { wch: 12 }, { wch: 30 },
            { wch: 28 }, { wch: 28 }
        ];
        XLSX.utils.book_append_sheet(wb, wsDir, 'Student Directory');

        /* ── Sheet 2: Discount Breakdown ── */
        const discHeaders = [
            'Reg No', 'Student Name', 'Class',
            'Standard Fee (PKR)', 'Transport Fee (PKR)',
            'Tuition Discount (PKR)', 'Transport Discount (PKR)', 'Sibling Discount (PKR)',
            'Total Discount (PKR)', 'Total Discount (%)',
            'Net Monthly Payable (PKR)', 'Discount Type', 'Valid Until'
        ];

        const discRows = students.map(s => {
            const stdFee        = Number(s.standardFee)     || 0;
            const transFee      = Number(s.transportFee)    || 0;
            const tuitionDisc   = Number(s.tuitionDiscount)   || 0;
            const transportDisc = Number(s.transportDiscount) || 0;
            const siblingDisc   = Number(s.siblingDiscount)   || 0;
            const totalDiscount = tuitionDisc + transportDisc + siblingDisc;
            const grossTotal    = stdFee + transFee;
            const discPct       = grossTotal > 0 ? parseFloat(((totalDiscount / grossTotal) * 100).toFixed(2)) : 0;
            const netPayable    = s.netPayable != null && s.netPayable !== '' ? Number(s.netPayable) : (grossTotal - totalDiscount);

            const discountType  = (s.isLifetime === 'on' || s.isLifetime === true)
                ? 'Lifetime'
                : (s.discountExpiry ? 'Temporary' : (totalDiscount > 0 ? 'Unspecified' : 'None'));

            return [
                s.regNo || '',
                s.fullName || s.name || '',
                s.studentClass || s.class || '',
                stdFee,
                transFee,
                tuitionDisc,
                transportDisc,
                siblingDisc,
                totalDiscount,
                discPct,
                netPayable,
                discountType,
                s.discountExpiry || (discountType === 'Lifetime' ? 'Lifetime' : '—')
            ];
        });

        /* Totals row */
        const totTuition    = discRows.reduce((a, r) => a + (r[5] || 0), 0);
        const totTransport  = discRows.reduce((a, r) => a + (r[6] || 0), 0);
        const totSibling    = discRows.reduce((a, r) => a + (r[7] || 0), 0);
        const totDiscount   = discRows.reduce((a, r) => a + (r[8] || 0), 0);
        const totNet        = discRows.reduce((a, r) => a + (r[10] || 0), 0);

        const discData = [
            discHeaders,
            ...discRows,
            [],
            ['TOTALS', '', '', '', '', totTuition, totTransport, totSibling, totDiscount, '', totNet, '', '']
        ];

        const wsDisc = XLSX.utils.aoa_to_sheet(discData);
        wsDisc['!cols'] = [
            { wch: 12 }, { wch: 26 }, { wch: 14 },
            { wch: 20 }, { wch: 20 },
            { wch: 24 }, { wch: 26 }, { wch: 24 },
            { wch: 22 }, { wch: 20 },
            { wch: 24 }, { wch: 16 }, { wch: 18 }
        ];
        XLSX.utils.book_append_sheet(wb, wsDisc, 'Discount Breakdown');

        /* ── Sheet 3: Class Summary ── */
        const classCounts = {};
        students.forEach(s => {
            const cls = s.studentClass || s.class || 'Unknown';
            classCounts[cls] = (classCounts[cls] || 0) + 1;
        });

        const summaryData = [
            ['Class', 'Total Students', 'Male', 'Female'],
            ...Object.entries(classCounts).map(([cls, total]) => {
                const inClass = students.filter(s => (s.studentClass || s.class || 'Unknown') === cls);
                const male    = inClass.filter(s => (s.gender || '').toLowerCase() === 'male').length;
                const female  = inClass.filter(s => (s.gender || '').toLowerCase() === 'female').length;
                return [cls, total, male, female];
            }),
            [],
            ['TOTAL', students.length,
             students.filter(s => (s.gender || '').toLowerCase() === 'male').length,
             students.filter(s => (s.gender || '').toLowerCase() === 'female').length]
        ];

        const wsSum = XLSX.utils.aoa_to_sheet(summaryData);
        wsSum['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, wsSum, 'Class Summary');

        /* ── Sheet 4: Fee Overview ── */
        const feeHeaders = [
            'Reg No', 'Student Name', 'Class',
            'Monthly Tuition (PKR)', 'Annual Fund (PKR)',
            'Tuition Disc.', 'Transport Disc.', 'Sibling Disc.',
            'Net Monthly (PKR)', 'Total Annual (PKR)'
        ];
        const feeRows = students.map(s => {
            const monthly       = Number(s.standardFee) || 0;
            const tuitionDisc   = Number(s.tuitionDiscount)   || 0;
            const transportDisc = Number(s.transportDiscount) || 0;
            const siblingDisc   = Number(s.siblingDiscount)   || 0;
            const fund = (s.annualFundEnabled === 'on' || s.annualFundEnabled === true)
                ? (Number(s.annualFundAmount) || 0) : 0;
            const net = s.netPayable != null && s.netPayable !== '' ? Number(s.netPayable) : (monthly - tuitionDisc - siblingDisc);
            return [
                s.regNo || '',
                s.fullName || s.name || '',
                s.studentClass || s.class || '',
                monthly,
                fund,
                tuitionDisc,
                transportDisc,
                siblingDisc,
                net,
                net * 12 + fund
            ];
        });
        const feeData = [feeHeaders, ...feeRows];
        const wsFee   = XLSX.utils.aoa_to_sheet(feeData);
        wsFee['!cols'] = [
            { wch: 12 }, { wch: 26 }, { wch: 14 },
            { wch: 20 }, { wch: 18 },
            { wch: 16 }, { wch: 18 }, { wch: 16 },
            { wch: 18 }, { wch: 18 }
        ];
        XLSX.utils.book_append_sheet(wb, wsFee, 'Fee Overview');

        /* ── Sheet 5: Photo Index (text reference since SheetJS CE can't embed images) ── */
        const photoHeaders = [
            '#', 'Reg No', 'Student Name', 'Class',
            'Has Student Photo', 'Has B-Form / Certificate', 'Document Type'
        ];
        const photoRows = students.map((s, i) => {
            const hasPhoto = !!(s.photo    && s.photo.startsWith('data:image'));
            const hasBform = !!(s.certData && s.certData.startsWith('data:'));
            const docType  = hasBform
                ? (s.certData.startsWith('data:image') ? 'Image' : 'PDF')
                : '—';
            return [
                i + 1,
                s.regNo || '',
                s.fullName || s.name || '',
                s.studentClass || s.class || '',
                hasPhoto ? 'YES ✔' : 'NO ✘',
                hasBform ? 'YES ✔' : 'NO ✘',
                docType
            ];
        });

        const photoData = [photoHeaders, ...photoRows];
        const wsPhoto   = XLSX.utils.aoa_to_sheet(photoData);
        wsPhoto['!cols'] = [
            { wch: 5 }, { wch: 12 }, { wch: 26 }, { wch: 14 },
            { wch: 20 }, { wch: 26 }, { wch: 14 }
        ];
        XLSX.utils.book_append_sheet(wb, wsPhoto, 'Photo Index');

        /* ── Metadata ── */
        const now = new Date();
        const exportedOn = now.toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' })
                         + '  ' + now.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });

        const studentsWithPhotos = students.filter(s => s.photo && s.photo.startsWith('data:image')).length;
        const studentsWithBforms = students.filter(s => s.certData && s.certData.startsWith('data:')).length;
        const studentsWithDiscount = students.filter(s =>
            (Number(s.tuitionDiscount) || 0) + (Number(s.transportDiscount) || 0) + (Number(s.siblingDiscount) || 0) > 0
        ).length;

        const metaData = [
            ['EduSoft — Student Data Export'],
            [],
            ['School', 'ST. LAWRENCE INTERNATIONAL SCHOOL'],
            ['Exported On', exportedOn],
            ['Total Students', students.length],
            ['Students with Photos', studentsWithPhotos],
            ['Students with B-Form / Certificate', studentsWithBforms],
            ['Students with Active Discounts', studentsWithDiscount],
            ['Exported By', 'EduFlow Pro v2.0'],
            [],
            ['NOTES'],
            ['• Student photos and B-Form images are embedded in the companion HTML gallery file.'],
            ['• Open "EduSoft (Student Photos).html" alongside this Excel file to view all images.'],
            ['• The "Discount Breakdown" sheet shows itemised discounts per student.'],
            ['• Photo Index sheet lists which students have uploaded photos/documents.']
        ];
        const wsMeta = XLSX.utils.aoa_to_sheet(metaData);
        wsMeta['!cols'] = [{ wch: 38 }, { wch: 46 }];
        XLSX.utils.book_append_sheet(wb, wsMeta, 'Export Info');

        /* ── Trigger Excel download ── */
        XLSX.writeFile(wb, 'EduSoft (Student Data).xlsx');

        /* ── Generate & download the Photo Gallery HTML ── */
        const studentsWithAnyMedia = students.filter(s =>
            (s.photo && s.photo.startsWith('data:image')) ||
            (s.certData && s.certData.startsWith('data:'))
        );

        if (studentsWithAnyMedia.length > 0) {
            const galleryHtml = _buildPhotoGalleryHTML(students);
            const blob = new Blob([galleryHtml], { type: 'text/html;charset=utf-8' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'EduSoft (Student Photos).html';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);

            showDataIOStatus(
                `✓ Export successful! <strong>${students.length} student record(s)</strong> saved to <em>EduSoft (Student Data).xlsx</em> with full discount breakdown. ` +
                `A companion <em>EduSoft (Student Photos).html</em> file was also downloaded containing photos and B-Form images for <strong>${studentsWithAnyMedia.length}</strong> student(s). Check your Downloads folder.`,
                'success'
            );
        } else {
            showDataIOStatus(
                `✓ Export successful! <strong>${students.length} student record(s)</strong> saved to <em>EduSoft (Student Data).xlsx</em> with full discount breakdown. No student photos or B-Form images found (none uploaded yet). Check your Downloads folder.`,
                'success'
            );
        }

    } catch (err) {
        console.error('Export failed', err);
        showDataIOStatus('Export failed: ' + err.message, 'error');
    }
}

/* ============================================================
   IMPORT — Read xlsx and merge into localStorage
   ============================================================ */
function importStudentsFromExcel(event) {
    if (typeof XLSX === 'undefined') {
        showDataIOStatus('Excel library not loaded yet. Please wait a moment and try again.', 'error');
        return;
    }

    const file = event.target.files && event.target.files[0];
    if (!file) return;

    showDataIOStatus('Reading file… please wait.', 'info');

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data    = new Uint8Array(e.target.result);
            const wb      = XLSX.read(data, { type: 'array' });

            /* Expect the first sheet "Student Directory" */
            const sheetName = wb.SheetNames[0];
            const ws        = wb.Sheets[sheetName];
            const rows      = XLSX.utils.sheet_to_json(ws, { defval: '' });

            if (!rows.length) {
                showDataIOStatus('The file appears to be empty or has no recognisable student rows.', 'error');
                return;
            }

            /* Map header names back to our student object keys.
               IMPORTANT: keys here must match what the form saves to localStorage,
               i.e. the HTML input[name] attributes — not display aliases.
               This list must stay in sync with the `dirHeaders` array in
               exportStudentsToExcel(); a mismatch here is what causes fields to
               come back blank (showing "Select…" / "Not Provided") after import. */
            const colMap = {
                'Reg No'                      : 'regNo',
                'Student ID'                  : 'id',
                'Sibling Group ID'            : 'siblingGroupId',
                'Full Name'                   : 'fullName',        // form saves as fullName, not name
                'Father / Guardian'           : 'guardianName',    // form saves as guardianName, not fatherName
                'Guardian Role'                : 'guardianRole',
                'Guardian CNIC'                : 'guardianCnic',
                'Gender'                       : 'gender',
                'Date of Birth'                : 'dob',
                'Age'                          : 'age',
                'Class'                        : 'studentClass',    // form saves as studentClass, not class
                'Section'                      : 'section',
                'Roll No'                      : 'rollNo',
                'Admission Date'               : 'admissionDate',
                'Phone 1'                      : 'phone1',
                'Phone 2'                      : 'phone2',
                'Permanent Address'            : 'permanentAddress', // form saves as permanentAddress, not address
                'Mailing Address'               : 'mailingAddress',
                'Student B-Form No.'           : 'studentBform',
                'Medical Issues'               : 'medicalIssues',
                'Orphan Status'                : 'orphanStatus',
                'Previous School Attended'     : 'previousSchool',
                'Previous Class'               : 'previousClass',
                'Transport Mode'               : 'transportMode',
                'Transport Type'               : 'transportType',
                'Transport Fee (PKR)'          : 'transportFee',
                'Monthly Tuition Fee (PKR)'    : 'standardFee',
                'Annual Fund (PKR)'            : 'annualFundAmount',
                'Annual Fund Month'            : 'annualFundMonth',
                'Tuition Discount (PKR)'       : 'tuitionDiscount',
                'Transport Discount (PKR)'     : 'transportDiscount',
                'Sibling Discount (PKR)'       : 'siblingDiscount',
                'Discount Valid Until'         : 'discountExpiry',
                'Net Payable (PKR)'            : 'netPayable',
                'Sibling Of'                   : 'siblingOf'
                /* 'Total Discount (PKR)' is a computed display column, not a stored field — skip.
                   'Discount Type' and 'Has Sibling' need value translation — handled below.
                   'Student Photo (Link)' / 'B-Form / Cert (Link)' only ever hold a status note in
                   the export, never the actual image data (that lives in the separate photo-gallery
                   HTML file), so they're intentionally not mapped back to photo/certData. */
            };

            const MONTH_NAME_TO_NUM = {
                january:1, february:2, march:3, april:4, may:5, june:6,
                july:7, august:8, september:9, october:10, november:11, december:12
            };

            const existing  = JSON.parse(localStorage.getItem(DB_KEY) || '[]');
            const existingRegNos = new Set(existing.map(s => s.regNo || s.id).filter(Boolean));

            let added = 0, skipped = 0;
            rows.forEach(row => {
                const student = {};
                Object.entries(colMap).forEach(([header, key]) => {
                    if (row[header] !== undefined && row[header] !== '') {
                        student[key] = row[header];
                    }
                });

                /* "Annual Fund Month" is exported as a month name (e.g. "January") but the
                   form's <select> stores it as a number (1-12) — convert back. */
                if (student.annualFundMonth) {
                    const num = MONTH_NAME_TO_NUM[String(student.annualFundMonth).toLowerCase().trim()];
                    if (num) {
                        student.annualFundMonth = String(num);
                        student.annualFundEnabled = 'on';
                    }
                }

                /* "Discount Type" tells us whether the discount is Lifetime, Temporary or None —
                   translate that into the isLifetime checkbox + discountExpiry date the form uses. */
                const discountTypeVal = row['Discount Type'];
                if (discountTypeVal === 'Lifetime') {
                    student.isLifetime = 'on';
                    delete student.discountExpiry; // "Lifetime" text may have leaked into this column — never a real date
                } else if (student.discountExpiry === 'Lifetime') {
                    delete student.discountExpiry;
                }

                /* "Has Sibling" is exported as Yes/No text — translate to the boolean the app expects. */
                if (row['Has Sibling'] === 'Yes') student.isSibling = true;
                else if (row['Has Sibling'] === 'No') student.isSibling = false;

                /* Skip rows without a registration number */
                if (!student.regNo && !student.id) { skipped++; return; }

                const regNo = student.regNo || student.id;
                if (existingRegNos.has(regNo)) { skipped++; return; }

                /* Ensure both id and regNo are populated */
                if (!student.id)    student.id    = regNo;
                if (!student.regNo) student.regNo = regNo;
                if (!student.fullName && !student.name) { skipped++; return; }
                /* Normalise: ensure fullName is always set (used throughout the app) */
                if (!student.fullName && student.name) student.fullName = student.name;

                existing.push(student);
                existingRegNos.add(regNo);
                added++;
            });

            localStorage.setItem(DB_KEY, JSON.stringify(existing));

            /* Reset file input so same file can be re-imported if needed */
            event.target.value = '';

            showDataIOStatus(
                `Import complete! <strong>${added} new record(s)</strong> added. ${skipped > 0 ? `${skipped} row(s) skipped (already exist or missing required fields).` : ''}`,
                'success'
            );

            /* Refresh counters if visible */
            if (typeof updateCounters === 'function') updateCounters();

        } catch (err) {
            console.error('Import failed', err);
            showDataIOStatus('Import failed: ' + err.message + '. Make sure the file was exported by EduFlow Pro.', 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

async function compressImage(file, maxWidth, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scaleFactor = maxWidth / img.width;
                
                // Only resize if the image is wider than maxWidth
                if (img.width > maxWidth) {
                    canvas.width = maxWidth;
                    canvas.height = img.height * scaleFactor;
                } else {
                    canvas.width = img.width;
                    canvas.height = img.height;
                }

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // Convert to Base64 (JPEG format is best for compression)
                const base64 = canvas.toDataURL('image/jpeg', quality);
                resolve(base64);
            };
        };
        reader.onerror = error => reject(error);
    });
}

window.toggleUpdOrphanFilter = function() {
    updOrphanFilterActive = !updOrphanFilterActive;
    const btn = document.getElementById('upd-orphan-filter-btn');
    if (updOrphanFilterActive) {
        btn.classList.add('active-filter');
        btn.setAttribute('aria-pressed', 'true');
        btn.innerHTML = '<i class="fas fa-check"></i> Showing Orphans';
    } else {
        btn.classList.remove('active-filter');
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
    }
    renderStudentTable();
};

// Toggle for View Directory Modal
window.toggleVoOrphanFilter = function() {
    voOrphanFilterActive = !voOrphanFilterActive;
    const btn = document.getElementById('vo-orphan-filter-btn');

    if (voOrphanFilterActive) {
        btn.classList.add('active-filter');
        btn.setAttribute('aria-pressed', 'true');
        btn.innerHTML = '<i class="fas fa-check"></i> Showing Orphans';
    } else {
        btn.classList.remove('active-filter');
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = '<i class="fas fa-child"></i> Show Orphans Only';
    }
    renderViewOnlyTable();
};