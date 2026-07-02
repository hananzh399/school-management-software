/**
 * ============================================================================
 * EDULOW PRO v2.0 - CORE STUDENT MANAGEMENT SYSTEM ENGINE
 * ============================================================================
 * Developed for: St. Lawrence International School
 * Module: Student Information System (SIS)
 *
 * Features:
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
 *   regNo  →  HRK_77XXX  (e.g. HRK_771, HRK_772, HRK_773 …)
 *             Sequential, unique per student, assigned at registration.
 *             This is what appears in the MAIN TABLE and on the profile header.
 *
 *   id     →  For independent students : same as regNo  (HRK_77XXX)
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
 *   Main table   → regNo badge (HRK_77XXX) for every student
 *   Full profile → regNo badge in header  +  Sibling ID (00X) in details
 *                  +  "Sibling of …" list for every family member
 * ============================================================================
 */

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

/**
 * Derive a short registration prefix from the logged-in school's name.
 * e.g. "St. Lawrence International School" → "SLIS_77"
 * Falls back to "HRK_77" when no school session exists (demo / superadmin mode).
 */
function getSchoolPrefix() {
    if (window.SoftSchoolAdmin) {
        const school = window.SoftSchoolAdmin.getCurrentSchool();
        if (school) {
            // 1. Use the custom prefix set by superadmin (stored on the school record)
            if (school.prefix && school.prefix.trim().length > 0) {
                return school.prefix.trim().toUpperCase() + '_77';
            }
            // 2. Derive from school name initials if no prefix was set
            if (school.name) {
                const words = school.name.trim().split(/[\s\.\-\/]+/);
                const initials = words
                    .filter(w => w.length > 0 && /[A-Za-z]/.test(w[0]))
                    .map(w => w[0].toUpperCase())
                    .join('');
                return (initials.slice(0, 4) || 'SCH') + '_77';
            }
        }
    }
    return 'HRK_77'; // final fallback (demo / superadmin mode)
}
const SYSTEM_PREFIX = getSchoolPrefix();

// ============================================================================
// INITIALIZATION
// ============================================================================
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

    // ── 1. CORE SYSTEM INITIALIZATION ───────────────────────────────────────

    if (admissionDateInput) admissionDateInput.valueAsDate = new Date();
    updateDashboardStats();

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
            if (!isEdit) {
                admissionForm.reset();
                editIdHidden.value = "";
                previewImg.src = "https://via.placeholder.com/150?text=Select+Photo";
                document.getElementById('form-modal-title').innerHTML =
                    '<i class="fas fa-user-plus"></i> Student Admission Entry';
                document.getElementById('form-submit-btn').innerText = 'Finalize Admission';

                const nextRegNo = generateNextRegistrationNumber();
                rollNoInput.value = '—';
                displayRegBadge.innerText = nextRegNo;
                admissionForm.dataset.pendingRegNo = nextRegNo;

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
            updRenderClassCards();
            updShowStage('classes');
        }

        if (modalId === 'view-only-modal') {
            const searchEl = document.getElementById('vo-search-name');
            if (searchEl) searchEl.value = '';
            // Always re-open on the class-cards stage
            voActiveClass = null;
            voActiveSection = null;
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

    if (studentPhotoInput) {
        studentPhotoInput.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => { previewImg.src = e.target.result; };
                reader.readAsDataURL(file);
            }
        });
    }

    if (certUploadInput) {
        certUploadInput.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    certDataHidden.value = e.target.result;
                    showToast("File Ready", "Document processed and attached to record.", "success");
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // ── 6. DATA PERSISTENCE (CRUD) ───────────────────────────────────────────

    /**
     * Generate next HRK_77 registration number.
     * Scans ALL records (including siblings) for the highest number already used.
     * Format: HRK_771, HRK_772, HRK_773 … (no leading zeros, never "00")
     */
    function generateNextRegistrationNumber() {
        const db = getDatabase();
        let maxSeq = 0;
        db.forEach(s => {
            // Check both regNo and id fields so we never collide
            [s.regNo, s.id].forEach(val => {
                if (val) {
                    const match = val.match(/^HRK_77(\d+)$/);
                    if (match) maxSeq = Math.max(maxSeq, parseInt(match[1], 10));
                }
            });
        });
        // next number — no leading zeros, starts at 1
        return `${SYSTEM_PREFIX}${maxSeq + 1}`;
    }

    /**
     * Generate class-based roll number.
     * Sequential within each class, starting from 1.
     */
    function generateClassRollNumber(studentClass) {
        if (!studentClass) return '1';
        const db = getDatabase();
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

    function getDatabase()    { return JSON.parse(localStorage.getItem(DB_KEY) || '[]'); }
    function saveDatabase(d)  { localStorage.setItem(DB_KEY, JSON.stringify(d)); }

    // ── FORM SUBMISSION ──────────────────────────────────────────────────────

    if (admissionForm) {
        admissionForm.onsubmit = function(e) {
            e.preventDefault();

            const db         = getDatabase();
            const formData   = new FormData(admissionForm);
            const studentData= Object.fromEntries(formData);

            // Strip the hidden _editRegNo field — it is a UI-only sentinel
            // and must never appear as a data field in the student record
            delete studentData['_editRegNo'];

            studentData.photo      = previewImg.src;
            studentData.age        = ageInput.value;
            studentData.netPayable = netTotalInput.value;
            studentData.rollNo     = rollNoInput.value;

            const existingId = editIdHidden.value.trim();

            if (existingId) {
    // ── UPDATE MODE ──────────────────────────────────────────────
    const index = db.findIndex(s => s.regNo === existingId);
    
    if (index !== -1) {
        // Preserve system fields that aren't in the form
        const originalData = db[index];
        
        // Merge new data over old data
        db[index] = { 
            ...originalData, 
            ...studentData,
            regNo: originalData.regNo, // Ensure ID never changes
            id: originalData.id,       // Ensure Group ID is preserved
            siblingGroupId: originalData.siblingGroupId 
        };

        // If they are a sibling, refresh the text labels for the whole family
        if (db[index].siblingGroupId) {
            refreshSiblingOfStrings(db, db[index].siblingGroupId);
        }

        saveDatabase(db);
        showToast("Update Successful", `Record for ${studentData.fullName} updated.`, "info");
        closeModal('student-modal');
        updateDashboardStats();
        renderStudentTable();
    }
       } else {
                // ── CREATE MODE ──────────────────────────────────────────────
                const guardianMatch = findGuardianMatch(studentData, db);

                if (guardianMatch) {
                    showSiblingDialog(guardianMatch.fullName, studentData, db, guardianMatch);
                } else {
                    // Independent student — regNo = id = HRK_77X
                    const regNo       = admissionForm.dataset.pendingRegNo || generateNextRegistrationNumber();
                    studentData.regNo = regNo;
                    studentData.id    = regNo;
                    db.push(studentData);
                    saveDatabase(db);
                    showToast("Admission Complete", `${studentData.fullName} registered successfully.`, "success");
                    closeModal('student-modal');
                    updateDashboardStats();
                    renderStudentTable();
                }
            }
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
        document.getElementById('sibling-yes-btn').addEventListener('click', () => {

            // 1. Get or create the shared sibling-group id (00X)
            const groupId = getOrCreateSiblingGroupId(matchedStudent);

            // 2. Generate a real HRK_77 registration number for the new student
            const newRegNo = admissionForm.dataset.pendingRegNo || generateNextRegistrationNumber();

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
            updateDashboardStats();
            renderStudentTable();
        });

        // ── NO: register independently ───────────────────────────────────────
        document.getElementById('sibling-no-btn').addEventListener('click', () => {
            const regNo       = admissionForm.dataset.pendingRegNo || generateNextRegistrationNumber();
            studentData.regNo = regNo;
            studentData.id    = regNo;
            db.push(studentData);
            saveDatabase(db);
            overlay.remove();
            showToast("Admission Complete", `${studentData.fullName} registered independently.`, "success");
            closeModal('student-modal');
            updateDashboardStats();
            renderStudentTable();
        });
    }

    // ── 7. TABLE RENDERING ───────────────────────────────────────────────────

    /**
     * Render the Students Table.
     * Main table ALWAYS shows the HRK_77 reg number — never the 00X sibling id.
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
        const db      = getDatabase();
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
        const db       = getDatabase();
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
        updActiveClass   = null;
        updActiveSection = null;
        updRenderClassCards();
        updShowStage('classes');
    };

    window.renderStudentTable = function() {
        const db    = getDatabase();
        const tbody = document.getElementById('student-list-tbody');
        if (!tbody) return;

        tbody.innerHTML = "";

        // Card flow sets updActiveClass to a real class name, or to ALL_STUDENTS_KEY
        // for the "All Students" master card (which applies no class filter).
        const useTabFilter = (updActiveClass !== null && updActiveClass !== ALL_STUDENTS_KEY);

        // Unified search bar (new)
        const qUnified = (document.getElementById('upd-search-input')
            ? document.getElementById('upd-search-input').value : '').toLowerCase().trim();

        // Legacy hidden inputs (kept for backward compat, now unused in normal flow)
        const qName   = useTabFilter ? '' : (document.getElementById('search-name')   ? document.getElementById('search-name').value   : '').toLowerCase().trim();
        const qFather = useTabFilter ? '' : (document.getElementById('search-father') ? document.getElementById('search-father').value : '').toLowerCase().trim();
        const qClass  = useTabFilter ? '' : (document.getElementById('search-class')  ? document.getElementById('search-class').value  : '').toLowerCase().trim();
        const qId     = useTabFilter ? '' : (document.getElementById('search-id')     ? document.getElementById('search-id').value     : '').toLowerCase().trim();

        let filtered = db;

        // Apply class filter (skipped entirely for "All Students")
        if (useTabFilter && updActiveClass) {
            filtered = filtered.filter(s => s.studentClass === updActiveClass);
        }

        // Apply section filter
        if (useTabFilter && updActiveSection && updActiveSection !== 'ALL') {
            filtered = filtered.filter(s => s.section === updActiveSection);
        }

        // Apply legacy search filters
        if (!useTabFilter) {
            filtered = filtered.filter(s => {
                const matchName   = !qName   || (s.fullName     || "").toLowerCase().includes(qName);
                const matchFather = !qFather || (s.guardianName || "").toLowerCase().includes(qFather);
                const matchClass  = !qClass  || (s.studentClass || "").toLowerCase().includes(qClass);
                const matchId     = !qId     || (s.regNo || "").toLowerCase().includes(qId) || (s.id || "").toLowerCase().includes(qId);
                return matchName && matchFather && matchClass && matchId;
            });
        }

        // Apply unified search (name, ID, guardian)
        if (qUnified) {
            filtered = filtered.filter(s =>
                (s.fullName     || "").toLowerCase().includes(qUnified) ||
                (s.regNo        || "").toLowerCase().includes(qUnified) ||
                (s.id           || "").toLowerCase().includes(qUnified) ||
                (s.guardianName || "").toLowerCase().includes(qUnified)
            );
        }

        // Sort by roll number
        filtered.sort((a, b) => (parseInt(a.rollNo) || 0) - (parseInt(b.rollNo) || 0));

        const promoteMode = document.body.classList.contains('promote-mode-active');

        if (filtered.length === 0) {
            const colCount = promoteMode ? 11 : 10;
            tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;padding:50px;color:#94a3b8;">No matching records found in this class/section.</td></tr>`;
            return;
        }

        filtered.forEach((s, idx) => {
            // ── MAIN TABLE always shows HRK_77 number ──
            const displayId = s.regNo || s.id;

            // ── "Sibling of …" tag under the name ──
            const siblingTag = (s.isSibling && s.siblingOf)
                ? `<br><span class="sibling-tag"><i class="fas fa-user-friends"></i> Sibling of ${s.siblingOf}</span>`
                : '';

            const checkboxCell = promoteMode
                ? `<td><input type="checkbox" class="promote-checkbox" data-regno="${s.regNo}" ${s.promoted ? '' : 'checked'} style="width:18px;height:18px;"></td>`
                : '';

            const statusCell = promoteMode
                ? `<td>${s.promoted
                        ? '<span class="promotion-status-badge promoted"><i class="fas fa-check-circle"></i> Promoted</span>'
                        : '<span class="promotion-status-badge pending"><i class="fas fa-hourglass-half"></i> Not Promoted</span>'}</td>`
                : '';

            const row = `
                <tr>
                    ${checkboxCell}
                    <td class="msc-sr-cell">${idx + 1}</td>
                    <td><span class="hrk-id-badge">${displayId}</span></td>
                    <td>${s.rollNo || '—'}</td>
                    <td><strong>${s.fullName}</strong>${siblingTag}</td>
                    <td>${s.guardianName}</td>
                    <td><span class="class-chip">${s.section || '—'}</span></td>
                    <td>${s.gender}</td>
                    ${statusCell}
                    <td>
                        <div class="action-btn-group">
                            <button class="btn-icon view"   onclick="viewFullProfile('${s.regNo}')" title="View Profile"><i class="fas fa-eye"></i></button>
                            <button class="btn-icon edit"   onclick="editStudentInfo('${s.regNo}')" title="Edit Record"><i class="fas fa-user-edit"></i></button>
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
        const db      = getDatabase();
        const grid    = document.getElementById('vo-classes-grid');
        if (!grid) return;

        let html = `
            <div class="msc-class-card msc-class-card--all" onclick="voOpenAllStudents()">
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
        const db       = getDatabase();
        const classStudents = db.filter(s => s.studentClass === voActiveClass);
        const allTeacher = getClassTeacher(voActiveClass, 'ALL');

        let html = `
            <div class="msc-incharge-header" style="grid-column:1/-1;">
                <i class="fas fa-chalkboard-teacher"></i>
                <span>Class Incharge: <strong>${allTeacher || 'Not Assigned'}</strong></span>
            </div>
            <div class="msc-class-card msc-class-card--all" onclick="voOpenSection('ALL')">
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
        voActiveClass   = null;
        voActiveSection = null;
        voRenderClassCards();
        voShowStage('classes');
    };

    window.renderViewOnlyTable = function() {
        try { voRefreshTeacherBadge(); } catch(e) {}
        const db    = getDatabase();
        const tbody = document.getElementById('vo-student-tbody');
        if (!tbody) return;

        tbody.innerHTML = '';

        const qName = (document.getElementById('vo-search-name') ? document.getElementById('vo-search-name').value : '').toLowerCase().trim();

        // "All Students" master card applies no class filter at all
        let filtered = db;
        if (voActiveClass && voActiveClass !== ALL_STUDENTS_KEY) {
            filtered = filtered.filter(s => s.studentClass === voActiveClass);

            // Then by active section (unless ALL)
            if (voActiveSection && voActiveSection !== 'ALL') {
                filtered = filtered.filter(s => s.section === voActiveSection);
            }
        }

        // Then by search query (name or reg no)
        if (qName) {
            filtered = filtered.filter(s =>
                (s.fullName || '').toLowerCase().includes(qName) ||
                (s.regNo   || '').toLowerCase().includes(qName) ||
                (s.id      || '').toLowerCase().includes(qName) ||
                (s.guardianName || '').toLowerCase().includes(qName)
            );
        }

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:50px;color:#94a3b8;">No students found in this class/section.</td></tr>';
            return;
        }

        // Sort by roll number
        filtered.sort((a, b) => (parseInt(a.rollNo) || 0) - (parseInt(b.rollNo) || 0));

        filtered.forEach((s, idx) => {
            const displayId  = s.regNo || s.id;
            const siblingTag = (s.isSibling && s.siblingOf)
                ? `<br><span class="sibling-tag"><i class="fas fa-user-friends"></i> Sibling of ${s.siblingOf}</span>`
                : '';

            tbody.innerHTML += `
                <tr>
                    <td class="msc-sr-cell">${idx + 1}</td>
                    <td><span class="hrk-id-badge">${displayId}</span></td>
                    <td>${s.rollNo || '—'}</td>
                    <td><strong>${s.fullName}</strong>${siblingTag}</td>
                    <td>${s.guardianName}</td>
                    <td><span class="class-chip">${s.section || '—'}</span></td>
                    <td>${s.gender}</td>
                    <td style="text-align:center;">
                        <button class="btn-icon view" onclick="viewFullProfile('${s.regNo}')" title="View Profile">
                            <i class="fas fa-eye"></i>
                        </button>
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

    const CLASS_PROGRESSION = [
        "Montessori", "Nursery", "Prep",
        "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5",
        "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10"
    ];

    function getNextClass(currentClass) {
        const idx = CLASS_PROGRESSION.indexOf(currentClass);
        if (idx === -1 || idx === CLASS_PROGRESSION.length - 1) return null; // unknown or final class
        return CLASS_PROGRESSION[idx + 1];
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

        if (!confirm(`Promote ${selectedRegNos.length} selected student(s) to their next class?`)) return;

        const db = getDatabase();
        let promotedCount = 0;
        let skippedCount = 0;

        db.forEach(s => {
            if (selectedRegNos.includes(s.regNo)) {
                const nextClass = getNextClass(s.studentClass);
                if (nextClass) {
                    s.studentClass = nextClass;
                    s.rollNo = generateClassRollNumber(nextClass);
                    s.promoted = true;
                    promotedCount++;
                } else {
                    skippedCount++;
                }
            }
        });

        saveDatabase(db);
        showToast(
            "Promotion Complete",
            `${promotedCount} student(s) promoted.` + (skippedCount ? ` ${skippedCount} already at final class.` : ''),
            "success"
        );

        togglePromoteMode();
        updateDashboardStats();
    };

    // ── 8. EDIT STUDENT ──────────────────────────────────────────────────────

   window.editStudentInfo = function(studentId) {
    const db = getDatabase();
    // Strictly find by regNo to avoid sibling group confusion
    const student = db.find(s => s.regNo === studentId);

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
            } else {
                input.value = student[key] ?? '';
            }
        }
    });

    previewImg.src = student.photo || "https://via.placeholder.com/150?text=No+Photo";
    displayRegBadge.innerText = student.regNo;
    rollNoInput.value = student.rollNo || '';

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

    window.deleteRecord = function(studentId) {
        if (!confirm(`CRITICAL ACTION: Are you sure you want to permanently delete this record?`)) return;

        let db      = getDatabase();
        const student = db.find(s => (s.regNo || s.id) === studentId);

        if (student && student.siblingGroupId) {
            const groupId = student.siblingGroupId;

            // Remove from every other group member's hasSiblings list
            db.forEach(s => {
                if (s.siblingGroupId === groupId && (s.regNo || s.id) !== studentId) {
                    if (s.hasSiblings) {
                        s.hasSiblings = s.hasSiblings.filter(sib => sib.regNo !== student.regNo);
                    }
                }
            });

            // Remove the student
            db = db.filter(s => (s.regNo || s.id) !== studentId);

            // Rebuild "Sibling of …" for remaining group members
            refreshSiblingOfStrings(db, groupId);

            // If only one member left in the group, dissolve the group:
            // restore their id to their regNo and clear sibling flags
            const remaining = db.filter(s => s.siblingGroupId === groupId);
            if (remaining.length === 1) {
                remaining[0].id             = remaining[0].regNo;
                remaining[0].isSibling      = false;
                remaining[0].siblingOf      = null;
                remaining[0].siblingGroupId = null;
                remaining[0].hasSiblings    = [];
            } else if (remaining.length === 0) {
                // nothing left — already fine
            }
        } else {
            db = db.filter(s => (s.regNo || s.id) !== studentId);
        }

        saveDatabase(db);
        showToast("Record Deleted", "The student has been removed from the system.", "danger");
        updateDashboardStats();
        renderStudentTable();
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
        let certViewer = '';
        let bformActionBtn = '';
        if (s.certData) {
            // A clear, always-visible action at the end of the profile to open the uploaded B-Form
            const isPdf = s.certData.startsWith('data:application/pdf');
            bformActionBtn = `
                <div class="profile-section-title"><i class="fas fa-id-card"></i> B-Form / School Certificate (from Admission Form)</div>
                <div style="padding:18px 25px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
                    <button type="button" class="btn-primary" onclick="window.open('${s.certData}','_blank')"
                        style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:8px;border:none;cursor:pointer;">
                        <i class="fas fa-eye"></i> View B-Form
                    </button>
                    <a href="${s.certData}" download="bform_${s.regNo || s.id}${isPdf ? '.pdf' : '.png'}"
                        class="btn-secondary" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:8px;text-decoration:none;">
                        <i class="fas fa-download"></i> Download B-Form
                    </a>
                </div>`;
            if (s.certData.startsWith('data:image')) {
                certViewer = `
                    <div class="profile-section-title"><i class="fas fa-certificate"></i> School Certificate / B-Form</div>
                    <div style="padding:20px 25px;">
                        <img src="${s.certData}" alt="Certificate" class="cert-preview-img"
                             onclick="window.open(this.src,'_blank')" title="Click to enlarge">
                        <p style="font-size:0.75rem;color:var(--text-muted);margin-top:8px;">
                            <i class="fas fa-search-plus"></i> Click to open full size
                        </p>
                    </div>`;
            } else if (s.certData.startsWith('data:application/pdf')) {
                certViewer = `
                    <div class="profile-section-title"><i class="fas fa-certificate"></i> School Certificate / B-Form</div>
                    <div style="padding:20px 25px;">
                        <a href="${s.certData}" download="certificate_${s.regNo}.pdf"
                           class="btn-primary" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;padding:10px 20px;border-radius:8px;">
                            <i class="fas fa-file-pdf"></i> Download Certificate PDF
                        </a>
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

    // ── FOOTER SHARE BUTTON HANDLER ──────────────────────────────────────────
    window.shareCurrentProfile = function() {
        const modal = document.getElementById('profile-modal');
        const regNo = modal ? modal.dataset.currentRegNo : null;
        if (regNo) window.shareStudentProfile(regNo);
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
        const db      = getDatabase();
        const total   = db.length;
        const males   = db.filter(s => s.gender === "Male").length;
        const females = db.filter(s => s.gender === "Female").length;

        const countTotal  = document.getElementById('counter-total');
        const countMale   = document.getElementById('counter-male');
        const countFemale = document.getElementById('counter-female');

        if (countTotal)  countTotal.innerText  = total;
        if (countMale)   countMale.innerText   = males;
        if (countFemale) countFemale.innerText = females;
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
function _hideMainSections() {
    document.querySelectorAll('main > section').forEach(s => {
        if (s.id === 'cert-page-view' || s.id === 'data-io-page-view') return;
        s.style.display = 'none';
    });
}
function _showMainSections() {
    document.querySelectorAll('main > section').forEach(s => {
        if (s.id === 'cert-page-view' || s.id === 'data-io-page-view') return;
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
            const nameOk     = !namePart || name.includes(namePart);
            const guardianOk = !guardianPart || guardian.includes(guardianPart);
            return nameOk && guardianOk;
        }).slice(0, 8);
    } else {
        matches = students.filter(s => {
            const name     = (s.name || s.fullName || '').toLowerCase();
            const guardian = (s.fatherName || s.guardianName || '').toLowerCase();
            const regNo    = (s.regNo || '').toLowerCase();
            const id       = (s.id || '').toLowerCase();
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
            const regNo    = (s.regNo || '').toLowerCase();
            const id       = (s.id || '').toLowerCase();
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
               i.e. the HTML input[name] attributes — not display aliases. */
            const colMap = {
                'Reg No'              : 'regNo',
                'Student ID'          : 'id',
                'Full Name'           : 'fullName',        // form saves as fullName, not name
                'Father / Guardian'   : 'guardianName',    // form saves as guardianName, not fatherName
                'Gender'              : 'gender',
                'Date of Birth'       : 'dob',
                'Age'                 : 'age',
                'Class'               : 'studentClass',    // form saves as studentClass, not class
                'Section'             : 'section',
                'Roll No'             : 'rollNo',
                'Admission Date'      : 'admissionDate',
                'Monthly Fee (PKR)'   : 'monthlyFee',
                'Annual Fund (PKR)'   : 'annualFund',
                'Phone'               : 'phone',
                'Address'             : 'permanentAddress', // form saves as permanentAddress, not address
                'Sibling Of'          : 'siblingOf'
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