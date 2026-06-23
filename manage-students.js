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
 * ============================================================================
 */

"use strict";

// --- GLOBAL STATE & CONFIGURATION ---
const DB_KEY = 'edu_students';
const SYSTEM_PREFIX = 'HRK-77';
const SIBLING_PREFIX = '00';

/**
 * INITIALIZATION: Wait for DOM to be fully ready
 */
document.addEventListener('DOMContentLoaded', () => {
    
    // UI References: Navigation & Layout
    const sidebar = document.getElementById('sidebar');
    const openSidebarBtn = document.getElementById('open-sidebar');
    const closeSidebarBtn = document.getElementById('close-sidebar');
    
    // UI References: Admission Form Elements
    const admissionForm = document.getElementById('student-admission-form');
    const editIdHidden = document.getElementById('edit-student-id');
    const previewImg = document.getElementById('student-img-preview');
    const studentPhotoInput = document.getElementById('student-photo');
    const certUploadInput = document.getElementById('cert-upload');
    const certDataHidden = document.getElementById('cert-data');
    
    // UI References: Form Inputs for Calculation
    const dobInput = document.getElementById('student-dob');
    const ageInput = document.getElementById('student-age');
    const admissionDateInput = document.getElementById('admission-date');
    const rollNoInput = document.getElementById('roll-no-input');
    const displayRegBadge = document.getElementById('display-reg-no');
    
    // UI References: Finance
    const feeStandard = document.getElementById('fee-standard');
    const feeAdmission = document.getElementById('fee-admission');
    const feeTuitionDisc = document.getElementById('fee-discount-tuition');
    const feeTransDisc = document.getElementById('fee-discount-transport');
    const transportFeeInput = document.querySelector('input[name="transportFee"]');
    const netTotalInput = document.getElementById('fee-net-total');
    
    // UI References: Address & Logic
    const permAddress = document.getElementById('perm-address');
    const mailAddress = document.getElementById('mail-address');
    const copyAddressBtn = document.getElementById('copy-address-btn');
    const lifetimeCheck = document.getElementById('is-lifetime');
    const expiryGroup = document.getElementById('expiry-date-group');

    // UI References: Search
    const searchInput = document.getElementById('search-db');

    // --- 1. CORE SYSTEM INITIALIZATION ---
    
    // Set default admission date to today
    if (admissionDateInput) admissionDateInput.valueAsDate = new Date();
    
    // Load initial stats and table
    updateDashboardStats();
    
    // --- 2. SIDEBAR & NAVIGATION CONTROLS ---

    if (openSidebarBtn) {
        openSidebarBtn.addEventListener('click', () => sidebar.classList.add('active'));
    }

    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('active'));
    }

    // --- 3. MODAL ARCHITECTURE (FIXED EDIT LOGIC) ---

    /**
     * Comprehensive Modal Opener
     * Handles logic for New vs Edit state transitions
     */
    window.openModal = function(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        // SPECIFIC LOGIC: ADMISSION FORM
        if (modalId === 'student-modal') {
            const isEdit = editIdHidden.value !== "";
            
            if (!isEdit) {
                // If not in edit mode, this is a FRESH admission
                admissionForm.reset();
                editIdHidden.value = "";
                previewImg.src = "https://via.placeholder.com/150?text=Select+Photo";
                document.getElementById('form-modal-title').innerHTML = '<i class="fas fa-user-plus"></i> Student Admission Entry';
                document.getElementById('form-submit-btn').innerText = 'Finalize Admission';
                
                // Generate Next Registration Number (HRK_77XXX) — permanent system ID
                const nextRegNo = generateNextRegistrationNumber();
                rollNoInput.value = '—'; // Roll number assigned after class selection
                displayRegBadge.innerText = nextRegNo;
                // Store reg number in a data attribute on the form for later use
                admissionForm.dataset.pendingRegNo = nextRegNo;
            }
            // If isEdit is true, we DON'T reset. The editStudentInfo function has already filled it.
        }

        // SPECIFIC LOGIC: DATABASE VIEW
        if (modalId === 'view-modal') {
            renderStudentTable();
        }

        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    };

    /**
     * Modal Closer
     */
    window.closeModal = function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
            
            // Clean up: If closing admission form, clear the edit ID so next time isn't an "edit"
            if (modalId === 'student-modal') {
                editIdHidden.value = "";
            }
        }
    };

    // --- 4. FORM LOGIC & CALCULATION ENGINES ---

    /**
     * Automatic Age Calculation
     */
    function calculateAge(dobString) {
        if (!dobString) return "";
        const dob = new Date(dobString);
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
            age--;
        }
        return age >= 0 ? age + " Years" : "Invalid Date";
    }

    if (dobInput) {
        dobInput.addEventListener('change', () => {
            ageInput.value = calculateAge(dobInput.value);
        });
    }

    /**
     * Financial Calculation Engine
     * Formula: (Standard + Admission + Transport) - (Tuition Discount + Transport Discount)
     */
    function performFinancialAudit() {
        const standard = parseFloat(feeStandard.value) || 0;
        const admission = parseFloat(feeAdmission.value) || 0;
        const tDisc = parseFloat(feeTuitionDisc.value) || 0;
        const trDisc = parseFloat(feeTransDisc.value) || 0;
        const monthlyTrans = parseFloat(transportFeeInput.value) || 0;

        const netTotal = (standard + admission + monthlyTrans) - (tDisc + trDisc);
        netTotalInput.value = Math.max(0, netTotal).toFixed(0);
    }

    [feeStandard, feeAdmission, feeTuitionDisc, feeTransDisc, transportFeeInput].forEach(el => {
        if (el) el.addEventListener('input', performFinancialAudit);
    });

    /**
     * Address Syncing
     */
    if (copyAddressBtn) {
        copyAddressBtn.addEventListener('click', () => {
            mailAddress.value = permAddress.value;
            showToast("Address Synced", "Mailing address updated to match permanent address.", "info");
        });
    }

    /**
     * Discount Expiry UI Toggle
     */
    if (lifetimeCheck) {
        lifetimeCheck.addEventListener('change', function() {
            if (this.checked) {
                expiryGroup.style.opacity = "0.4";
                expiryGroup.style.pointerEvents = "none";
            } else {
                expiryGroup.style.opacity = "1";
                expiryGroup.style.pointerEvents = "all";
            }
        });
    }

    /**
     * Class Selection → Auto-assign Roll Number
     * Roll numbers are sequential per class.
     */
    const classSelect = admissionForm ? admissionForm.querySelector('[name="studentClass"]') : null;
    if (classSelect) {
        classSelect.addEventListener('change', function() {
            const isEdit = editIdHidden.value !== "";
            if (!isEdit && this.value) {
                const roll = generateClassRollNumber(this.value);
                rollNoInput.value = roll;
            }
        });
    }

    // --- 5. MEDIA & FILE HANDLING (Base64) ---

    /**
     * Profile Photo Preview & Base64 Store
     */
    if (studentPhotoInput) {
        studentPhotoInput.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewImg.src = e.target.result;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    /**
     * Document/Certificate Base64 Store
     */
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

    // --- 6. DATA PERSISTENCE (CRUD OPERATIONS) ---

    /**
     * Generate Sequential Registration Number (HRK_77 + 3-digit global sequence)
     * This is the unique system-wide ID assigned at admission.
     */
    function generateNextRegistrationNumber() {
        const db = getDatabase();
        // Find the highest reg number sequence used so far
        let maxSeq = 0;
        db.forEach(s => {
            if (s.regNo) {
                const match = s.regNo.match(/HRK_77(\d+)/);
                if (match) maxSeq = Math.max(maxSeq, parseInt(match[1], 10));
            }
        });
        return `HRK_77${String(maxSeq + 1).padStart(3, '0')}`;
    }

    /**
     * Generate Class-Based Roll Number
     * Roll numbers are sequential within each class, starting from 1.
     * Format: plain integer, e.g. 1, 2, 3...
     */
    function generateClassRollNumber(studentClass) {
        if (!studentClass) return '1';
        const db = getDatabase();
        const classStudents = db.filter(s => s.studentClass === studentClass && !s.isSibling);
        // Find the max roll number already in this class
        let maxRoll = 0;
        classStudents.forEach(s => {
            const roll = parseInt(s.rollNo, 10);
            if (!isNaN(roll)) maxRoll = Math.max(maxRoll, roll);
        });
        return String(maxRoll + 1);
    }

    /**
     * Generate Sequential Sibling ID
     * Format: 00XX (e.g. 0001, 0005, 0007...) — starts with 00, NOT HRK_77
     */
    function generateNextSiblingID() {
        const db = getDatabase();
        let maxSeq = 0;
        db.forEach(s => {
            if (s.isSibling && s.id) {
                const match = s.id.match(/^00(\d+)/);
                if (match) maxSeq = Math.max(maxSeq, parseInt(match[1], 10));
            }
        });
        return `${SIBLING_PREFIX}${String(maxSeq + 1).padStart(2, '0')}`;
    }

    /**
     * Normalize a string for comparison (trim + lowercase)
     */
    function normalizeForCompare(value) {
        return (value || "").toString().trim().toLowerCase();
    }

    /**
     * Check if the new student's guardian details match an existing record
     * Match criteria: Guardian Name, Guardian CNIC, Permanent Address, Guardian Role
     * Returns the matching student record, or null if no match found.
     */
    function findGuardianMatch(newData, db) {
        return db.find(s =>
            normalizeForCompare(s.guardianName) === normalizeForCompare(newData.guardianName) &&
            normalizeForCompare(s.guardianCnic) === normalizeForCompare(newData.guardianCnic) &&
            normalizeForCompare(s.permanentAddress) === normalizeForCompare(newData.permanentAddress) &&
            normalizeForCompare(s.guardianRole) === normalizeForCompare(newData.guardianRole)
        ) || null;
    }

    function getDatabase() {
        return JSON.parse(localStorage.getItem(DB_KEY) || '[]');
    }

    function saveDatabase(data) {
        localStorage.setItem(DB_KEY, JSON.stringify(data));
    }

    /**
     * Form Submission (Handles BOTH Create and Update)
     */
    if (admissionForm) {
        admissionForm.onsubmit = function(e) {
            e.preventDefault();

            const db = getDatabase();
            const formData = new FormData(admissionForm);
            const studentData = Object.fromEntries(formData);
            
            // Add non-input data
            studentData.photo = previewImg.src;
            studentData.age = ageInput.value;
            studentData.netPayable = netTotalInput.value;
            // Attach roll number (class-based)
            studentData.rollNo = rollNoInput.value;

            const existingId = editIdHidden.value;

            if (existingId) {
                // UPDATE MODE
                const index = db.findIndex(s => s.id === existingId);
                if (index !== -1) {
                    studentData.id = existingId;
                    // Preserve reg number
                    studentData.regNo = db[index].regNo;
                    if (db[index].isSibling) {
                        studentData.isSibling = db[index].isSibling;
                        studentData.siblingOf = db[index].siblingOf;
                    }
                    db[index] = studentData;
                    saveDatabase(db);
                    showToast("Update Successful", `Record for ${studentData.fullName} has been updated.`, "info");
                    closeModal('student-modal');
                    updateDashboardStats();
                    renderStudentTable();
                }
            } else {
                // CREATE MODE — check for sibling
                const guardianMatch = findGuardianMatch(studentData, db);

                if (guardianMatch) {
                    // Show styled sibling dialog instead of browser confirm()
                    showSiblingDialog(guardianMatch.fullName, studentData, db, guardianMatch);
                } else {
                    // Assign Registration Number and save
                    studentData.regNo = admissionForm.dataset.pendingRegNo || generateNextRegistrationNumber();
                    studentData.id = studentData.regNo;
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
     * Show a styled sibling confirmation dialog
     */
    function showSiblingDialog(matchedName, studentData, db, matchedStudent) {
        // Remove any existing sibling dialog
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
                    Would you like to register <strong>${studentData.fullName}</strong> as a sibling of <strong>${matchedName}</strong>?
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

        document.getElementById('sibling-yes-btn').addEventListener('click', () => {
            // Assign a sibling ID (00XX) as the system/display ID
            const siblingId = generateNextSiblingID();
            // But also generate a real HRK registration number for the sibling
            const siblingRegNo = admissionForm.dataset.pendingRegNo || generateNextRegistrationNumber();

            studentData.isSibling = true;
            studentData.siblingOf = matchedName;
            studentData.siblingOfId = matchedStudent.id;
            studentData.id = siblingId;
            studentData.regNo = siblingRegNo; // HRK number shown on main page & profile

            // --- BIDIRECTIONAL LINK: Update the original student's record ---
            const originalIndex = db.findIndex(s => s.id === matchedStudent.id);
            if (originalIndex !== -1) {
                if (!db[originalIndex].hasSiblings) {
                    db[originalIndex].hasSiblings = [];
                }
                db[originalIndex].hasSiblings.push({
                    name: studentData.fullName,
                    id: siblingId,
                    regNo: siblingRegNo
                });
            }

            db.push(studentData);
            saveDatabase(db);
            overlay.remove();
            showToast("Sibling Registered", `${studentData.fullName} linked as sibling of ${matchedName}.`, "success");
            closeModal('student-modal');
            updateDashboardStats();
            renderStudentTable();
        });

        document.getElementById('sibling-no-btn').addEventListener('click', () => {
            studentData.regNo = admissionForm.dataset.pendingRegNo || generateNextRegistrationNumber();
            studentData.id = studentData.regNo;
            db.push(studentData);
            saveDatabase(db);
            overlay.remove();
            showToast("Admission Complete", `${studentData.fullName} registered independently.`, "success");
            closeModal('student-modal');
            updateDashboardStats();
            renderStudentTable();
        });
    }

    /**
     * Render the Students Table with Search Filter
     */
    window.renderStudentTable = function(query = "") {
        const db = getDatabase();
        const tbody = document.getElementById('student-list-tbody');
        if (!tbody) return;

        tbody.innerHTML = "";
        
        const filtered = db.filter(s => 
            s.fullName.toLowerCase().includes(query.toLowerCase()) ||
            s.id.toLowerCase().includes(query.toLowerCase()) ||
            s.guardianName.toLowerCase().includes(query.toLowerCase())
        );

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:50px; color:#94a3b8;">No matching records found in database.</td></tr>`;
            return;
        }

        filtered.forEach(s => {
            // Sibling tag: shown under sibling's name
            const siblingTag = s.isSibling
                ? `<br><span class="sibling-tag"><i class="fas fa-user-friends"></i> Sibling of ${s.siblingOf}</span>`
                : '';

            // Original student: show "Has sibling(s)" tag
            const hasSiblingTag = (s.hasSiblings && s.hasSiblings.length > 0)
                ? s.hasSiblings.map(sib =>
                    `<br><span class="sibling-tag sibling-tag--has"><i class="fas fa-user-friends"></i> Has sibling: ${sib.name}</span>`
                  ).join('')
                : '';

            // For siblings: display HRK reg number in the ID column (not the 00XX sibling ID)
            const displayId = (s.isSibling && s.regNo) ? s.regNo : s.id;

            const row = `
                <tr>
                    <td><span class="hrk-id-badge">${displayId}</span></td>
                    <td><strong>${s.fullName}</strong>${siblingTag}${hasSiblingTag}</td>
                    <td>${s.guardianName}</td>
                    <td><span style="background:#f1f5f9; padding:4px 8px; border-radius:4px; font-size:0.85rem; font-weight:600;">${s.studentClass}</span></td>
                    <td>${s.gender}</td>
                    <td>
                        <div class="action-btn-group">
                            <button class="btn-icon view" onclick="viewFullProfile('${s.id}')" title="View Profile"><i class="fas fa-eye"></i></button>
                            <button class="btn-icon edit" onclick="editStudentInfo('${s.id}')" title="Edit Record"><i class="fas fa-user-edit"></i></button>
                            <button class="btn-icon delete" onclick="deleteRecord('${s.id}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
                        </div>
                    </td>
                </tr>
            `;
            tbody.innerHTML += row;
        });
    };

    /**
     * THE FIX: Edit Student Logic
     * Populates the form WITHOUT clearing it via the modal reset logic
     */
    window.editStudentInfo = function(studentId) {
        const db = getDatabase();
        const student = db.find(s => s.id === studentId);
        
        if (!student) {
            showToast("Error", "Student record not found.", "danger");
            return;
        }

        // 1. Prepare Hidden ID (Signals 'Update' mode to the form)
        editIdHidden.value = student.id;

        // 2. Populate all standard fields based on 'name' attributes
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

        // 3. Populate special UI elements
        previewImg.src = student.photo || "https://via.placeholder.com/150?text=No+Photo";
        displayRegBadge.innerText = student.regNo || student.id;
        rollNoInput.value = student.rollNo || student.id;
        
        // 4. Update Modal Titles
        document.getElementById('form-modal-title').innerHTML = '<i class="fas fa-user-edit"></i> Edit Student Profile';
        document.getElementById('form-submit-btn').innerText = 'Save Changes';

        // 5. Trigger Calculations to refresh UI state
        ageInput.value = calculateAge(student.dob);
        performFinancialAudit();

        // 6. Manually open modal (Avoiding the 'openModal' reset logic)
        const modal = document.getElementById('student-modal');
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    };

    /**
     * Delete Student Record
     */
    window.deleteRecord = function(studentId) {
        if (confirm(`CRITICAL ACTION: Are you sure you want to permanently delete record ${studentId}?`)) {
            let db = getDatabase();

            // Find the student being deleted
            const student = db.find(s => s.id === studentId);

            // If it's a sibling, remove it from the original student's hasSiblings list
            if (student && student.isSibling && student.siblingOfId) {
                const originalIndex = db.findIndex(s => s.id === student.siblingOfId);
                if (originalIndex !== -1 && db[originalIndex].hasSiblings) {
                    db[originalIndex].hasSiblings = db[originalIndex].hasSiblings.filter(sib => sib.id !== studentId);
                }
            }

            // If this student has siblings, clear their siblingOf references
            if (student && student.hasSiblings && student.hasSiblings.length > 0) {
                student.hasSiblings.forEach(sib => {
                    const sibIndex = db.findIndex(s => s.id === sib.id);
                    if (sibIndex !== -1) {
                        db[sibIndex].isSibling = false;
                        db[sibIndex].siblingOf = null;
                        db[sibIndex].siblingOfId = null;
                    }
                });
            }

            db = db.filter(s => s.id !== studentId);
            saveDatabase(db);
            showToast("Record Deleted", "The student has been removed from the system.", "danger");
            updateDashboardStats();
            renderStudentTable();
        }
    };

    // --- 7. PROFILE VIEW ENGINE ---

    /**
     * Generates a high-detail profile view
     */
    window.viewFullProfile = function(id) {
        const db = getDatabase();
        const s = db.find(x => x.id === id);
        if (!s) return;

        const safeVal = (v) => (v && v !== "") ? v : '<span style="color:#cbd5e1">Not Provided</span>';

        const siblingInfoRow = s.isSibling
            ? `<div class="detail-item full-width-detail">
                   <label>Sibling Status</label>
                   <span class="sibling-tag"><i class="fas fa-user-friends"></i> Sibling of ${s.siblingOf}</span>
               </div>
               <div class="detail-item">
                   <label>Sibling ID</label>
                   <span class="hrk-id-badge" style="font-size:0.85rem;">${s.id}</span>
               </div>`
            : '';

        const hasSiblingsRow = (s.hasSiblings && s.hasSiblings.length > 0)
            ? s.hasSiblings.map(sib =>
                `<div class="detail-item full-width-detail">
                    <label>Has Sibling</label>
                    <span class="sibling-tag sibling-tag--has">
                        <i class="fas fa-user-friends"></i> ${sib.name}
                        <span style="margin-left:8px; opacity:0.75; font-size:0.78rem;">(ID: ${sib.id} · Reg: ${sib.regNo})</span>
                    </span>
                </div>`
              ).join('')
            : '';

        // Certificate viewer: image or PDF link
        let certViewer = '';
        if (s.certData) {
            if (s.certData.startsWith('data:image')) {
                certViewer = `
                    <div class="profile-section-title"><i class="fas fa-certificate"></i> School Certificate / B-Form</div>
                    <div style="padding:20px 25px;">
                        <img src="${s.certData}" alt="School Certificate" class="cert-preview-img" onclick="window.open(this.src,'_blank')" title="Click to enlarge">
                        <p style="font-size:0.75rem;color:var(--text-muted);margin-top:8px;"><i class="fas fa-search-plus"></i> Click image to open full size</p>
                    </div>`;
            } else if (s.certData.startsWith('data:application/pdf')) {
                certViewer = `
                    <div class="profile-section-title"><i class="fas fa-certificate"></i> School Certificate / B-Form</div>
                    <div style="padding:20px 25px;">
                        <a href="${s.certData}" download="certificate_${s.id}.pdf" class="btn-primary" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;padding:10px 20px;border-radius:8px;">
                            <i class="fas fa-file-pdf"></i> Download Certificate PDF
                        </a>
                    </div>`;
            }
        }

        const profileContent = `
            <div class="profile-card-header">
                <img src="${s.photo}" class="profile-main-img" onerror="this.src='https://ui-avatars.com/api/?name=${s.fullName}&background=random'">
                <h2 class="profile-name-title">${s.fullName}</h2>
                <span class="hrk-id-badge">${s.id}</span>
            </div>

            <div class="profile-section-title">Academic Information</div>
            <div class="profile-details-grid">
                <div class="detail-item"><label>Registration No.</label><span class="hrk-id-badge" style="font-size:0.85rem;">${safeVal(s.regNo || s.id)}</span></div>
                <div class="detail-item"><label>Roll Number (Class)</label><span>${safeVal(s.rollNo)}</span></div>
                <div class="detail-item"><label>Class</label><span>${safeVal(s.studentClass)}</span></div>
                <div class="detail-item"><label>Section</label><span>${safeVal(s.section)}</span></div>
                <div class="detail-item"><label>Admission Date</label><span>${safeVal(s.admissionDate)}</span></div>
                ${siblingInfoRow}
                ${hasSiblingsRow}
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
                <div class="detail-item"><label>Transport Fee</label><span>Rs. ${safeVal(s.transportFee)}</span></div>
                <div class="detail-item"><label>Total Discount</label><span>Rs. ${parseFloat(s.tuitionDiscount || 0) + parseFloat(s.transportDiscount || 0)}</span></div>
                <div class="detail-item" style="background:#f0fdf4; padding:10px; border-radius:8px;">
                    <label style="color:#166534">Net Payable</label>
                    <span style="color:#166534; font-weight:800; font-size:1.2rem;">Rs. ${s.netPayable}</span>
                </div>
            </div>
            ${certViewer}
        `;

        document.getElementById('profile-content').innerHTML = profileContent;
        const modal = document.getElementById('profile-modal');
        modal.style.display = 'block';
    };

    // --- 8. UTILITIES & HELPER FUNCTIONS ---

    /**
     * Refresh Dashboard Statistics
     */
    function updateDashboardStats() {
        const db = getDatabase();
        const total = db.length;
        const males = db.filter(s => s.gender === "Male").length;
        const females = db.filter(s => s.gender === "Female").length;

        const countTotal = document.getElementById('counter-total');
        const countMale = document.getElementById('counter-male');
        const countFemale = document.getElementById('counter-female');

        if (countTotal) countTotal.innerText = total;
        if (countMale) countMale.innerText = males;
        if (countFemale) countFemale.innerText = females;
    }

    /**
     * System Toast Notifications
     */
    function showToast(title, body, type = "success") {
        const toast = document.getElementById('toast-msg');
        if (!toast) return;

        const titleEl = document.getElementById('toast-title');
        const bodyEl = document.getElementById('toast-body');
        const indicator = toast.querySelector('.toast-indicator');

        titleEl.innerText = title;
        bodyEl.innerText = body;

        // Color coding
        const types = {
            success: "#27ae60",
            danger: "#e74c3c",
            info: "#3498db",
            warning: "#f39c12"
        };
        indicator.style.background = types[type] || types.success;

        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 4000);
    }

    /**
     * CSV Export Utility
     */
    window.exportToCSV = function() {
        const db = getDatabase();
        if (db.length === 0) {
            alert("No student data available to export.");
            return;
        }

        const headers = ["ID", "FullName", "Class", "Guardian", "Phone", "NetPayable"];
        let csvContent = headers.join(",") + "\n";

        db.forEach(s => {
            const row = [s.id, s.fullName, s.studentClass, s.guardianName, s.phone1, s.netPayable];
            csvContent += row.map(v => `"${v}"`).join(",") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `EDULOW_RECORDS_${new Date().toLocaleDateString()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    /**
     * Live Search Listener
     */
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderStudentTable(e.target.value);
        });
    }

    // Handle Masking for CNIC Inputs (XXXXX-XXXXXXX-X)
    document.querySelectorAll('.mask-cnic').forEach(input => {
        input.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            let formatted = "";
            if (value.length > 0) {
                formatted += value.substring(0, 5);
                if (value.length > 5) formatted += "-" + value.substring(5, 12);
                if (value.length > 12) formatted += "-" + value.substring(12, 13);
            }
            e.target.value = formatted;
        });
    });

}); // End DOMContentLoaded

/**
 * ============================================================================
 * END OF SCRIPT - EDULOW PRO SIS ENGINE
 * ============================================================================
 */