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
// ⚙️  SETTINGS — STANDARD FEE PER CLASS
// ----------------------------------------------------------------------------
// To configure standard (tuition) fees for each class, edit the values below.
// These values are read-only in the admission form and auto-populate when a
// class is selected. They can be changed here until a Settings page is built.
//
// Format:  'Class Name': fee_in_rupees
// ============================================================================
const CLASS_STANDARD_FEES = {
    'Montessori': 3000,
    'Nursery':    3500,
    'Prep':       4000,
    'Grade 1':    4500,
    'Grade 2':    4500,
    'Grade 3':    5000,
    'Grade 4':    5000,
    'Grade 5':    5500,
    'Grade 6':    5500,
    'Grade 7':    6000,
    'Grade 8':    6000,
    'Grade 9':    6500,
    'Grade 10':   6500,
};

// ============================================================================
// ⚙️  SETTINGS — ANNUAL FUND AMOUNT (added to voucher in the selected month)
// ============================================================================
const ANNUAL_FUND_AMOUNT = 2000; // Rs. — change this value as needed

// --- GLOBAL STATE & CONFIGURATION ---
const DB_KEY        = 'edu_students';
const SYSTEM_PREFIX = 'HRK_77';   // prefix for registration numbers
const SIBLING_PREFIX = '00';       // prefix for sibling-group IDs

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

    // ── 2. SIDEBAR & NAVIGATION CONTROLS ────────────────────────────────────

    if (openSidebarBtn)  openSidebarBtn.addEventListener ('click', () => sidebar.classList.add   ('active'));
    if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('active'));

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
            [searchName, searchFather, searchClass, searchId].forEach(inp => {
                if (inp) inp.value = '';
            });
            renderStudentTable();
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
        const standard     = parseFloat(feeStandard.value)      || 0;
        const admission    = parseFloat(feeAdmission.value)     || 0;
        const tDisc        = parseFloat(feeTuitionDisc.value)   || 0;
        const trDisc       = parseFloat(feeTransDisc.value)     || 0;
        const sibDisc      = parseFloat(feeSiblingDisc ? feeSiblingDisc.value : 0) || 0;
        const monthlyTrans = parseFloat(transportFeeInput.value) || 0;
        // NOTE: Books fee and Other fees are intentionally excluded from the
        // database net total — they appear only on the voucher at print time.
        const netTotal = (standard + admission + monthlyTrans) - (tDisc + trDisc + sibDisc);
        netTotalInput.value = Math.max(0, netTotal).toFixed(0);
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
        // Pre-fill the amount display from settings
        if (annualFundAmount) annualFundAmount.value = ANNUAL_FUND_AMOUNT;

        annualFundEnabled.addEventListener('change', function() {
            annualFundPanel.style.display = this.checked ? 'block' : 'none';
        });
    }

    const classSelect = admissionForm ? admissionForm.querySelector('[name="studentClass"]') : null;
if (classSelect) {
    classSelect.addEventListener('change', function() {
        if (this.value) {
            rollNoInput.value = generateClassRollNumber(this.value);
            // Auto-populate standard fee from settings
            const classFee = CLASS_STANDARD_FEES[this.value];
            if (classFee !== undefined) {
                feeStandard.value = classFee;
                performFinancialAudit();
            }
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

            studentData.photo      = previewImg.src;
            studentData.age        = ageInput.value;
            studentData.netPayable = netTotalInput.value;
            studentData.rollNo     = rollNoInput.value;

            const existingId = editIdHidden.value;

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
    window.renderStudentTable = function() {
        const db    = getDatabase();
        const tbody = document.getElementById('student-list-tbody');
        if (!tbody) return;

        tbody.innerHTML = "";

        const qName   = (document.getElementById('search-name')   ? document.getElementById('search-name').value   : '').toLowerCase().trim();
        const qFather = (document.getElementById('search-father') ? document.getElementById('search-father').value : '').toLowerCase().trim();
        const qClass  = (document.getElementById('search-class')  ? document.getElementById('search-class').value  : '').toLowerCase().trim();
        const qId     = (document.getElementById('search-id')     ? document.getElementById('search-id').value     : '').toLowerCase().trim();

        const filtered = db.filter(s => {
            const matchName   = !qName   || (s.fullName      || "").toLowerCase().includes(qName);
            const matchFather = !qFather || (s.guardianName  || "").toLowerCase().includes(qFather);
            const matchClass  = !qClass  || (s.studentClass  || "").toLowerCase().includes(qClass);
            const matchId     = !qId     || (s.regNo || "").toLowerCase().includes(qId) || (s.id || "").toLowerCase().includes(qId);
            return matchName && matchFather && matchClass && matchId;
        });

        const promoteMode = document.body.classList.contains('promote-mode-active');

        if (filtered.length === 0) {
            const colCount = promoteMode ? 8 : 6;
            tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;padding:50px;color:#94a3b8;">No matching records found in database.</td></tr>`;
            return;
        }

        filtered.forEach(s => {
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
                    <td><span class="hrk-id-badge">${displayId}</span></td>
                    <td><strong>${s.fullName}</strong>${siblingTag}</td>
                    <td>${s.guardianName}</td>
                    <td><span style="background:#f1f5f9;padding:4px 8px;border-radius:4px;font-size:0.85rem;font-weight:600;">${s.studentClass}</span></td>
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

    // Close any other open modals first. The view-modal and student-modal
    // share the same z-index, and view-modal comes later in the DOM, so if
    // it stays open it visually/functionally covers the edit form modal —
    // this was why the Edit button appeared to do nothing.
    closeModal('view-modal');
    closeModal('profile-modal');

    // Set the hidden field strictly to regNo
    editIdHidden.value = student.regNo; 

    // Populate all form fields
    Object.keys(student).forEach(key => {
        const input = admissionForm.querySelector(`[name="${key}"]`);
        if (input) {
            if (input.type === 'checkbox') {
                input.checked = (student[key] === 'on' || student[key] === true);
            } else {
                input.value = student[key];
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

        // ── Certificate viewer ──
        let certViewer = '';
        if (s.certData) {
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
            if (!f.description && !f.amount) return;
            otherFeesRows += `<div class="detail-item"><label>${f.description || 'Other Fee'}</label><span>Rs. ${parseFloat(f.amount||0).toFixed(0)}</span></div>`;
            if (parseFloat(f.discount||0) > 0) {
                otherFeesRows += `<div class="detail-item discount-item"><label><i class="fas fa-tag" style="color:#d97706;margin-right:4px;"></i>${f.description || 'Other Fee'} Discount</label><span style="color:#d97706;">− Rs. ${parseFloat(f.discount).toFixed(0)}</span></div>`;
            }
        });

        const profileContent = `
            <div class="profile-card-header">
                <img src="${s.photo}" class="profile-main-img"
                     onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(s.fullName)}&background=random'">
                <h2 class="profile-name-title">${s.fullName}</h2>
                <span class="hrk-id-badge">${s.regNo || s.id}</span>
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
                <div class="detail-item" style="background:#fef9c3;padding:10px;border-radius:8px;border-left:3px solid #d97706;">
                    <label style="color:#92400e;font-weight:700;">Total Discount</label>
                    <span style="color:#92400e;font-weight:800;">− Rs. ${(parseFloat(s.tuitionDiscount||0) + parseFloat(s.transportDiscount||0) + parseFloat(s.siblingDiscount||0) + parseFloat(s.booksDiscount||0) + otherFeesArr.reduce((sum,f)=>sum+(parseFloat(f.discount||0)),0)).toFixed(0)}</span>
                </div>
                <div class="detail-item" style="background:#f0fdf4;padding:10px;border-radius:8px;border-left:3px solid #10b981;">
                    <label style="color:#166534;font-weight:700;">Net Payable</label>
                    <span style="color:#166534;font-weight:800;font-size:1.2rem;">Rs. ${s.netPayable}</span>
                </div>
            </div>
            ${certViewer}
        `;

        document.getElementById('profile-content').innerHTML = profileContent;
        document.getElementById('profile-modal').style.display = 'block';
    };

    // ── 11. UTILITIES ────────────────────────────────────────────────────────

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
