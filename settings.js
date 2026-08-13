// ═══════════════════════════════════════════════
//  EduFlow Pro — Admin Settings
//  settings.js  (updated: dark mode + attendane link)
// ═══════════════════════════════════════════════

const CLASSES_KEY     = 'edu_class_configs';
const LATEFEE_KEY     = 'edu_latefee_config';
const TEACHERS_KEY    = 'edu_teacher_configs';
const NONTEACHING_KEY = 'edu_nonteaching_configs';
const VARIABLES_KEY   = 'edu_pay_variables';
const SCHOOL_INFO_KEY  = 'edu_school_info';

// ── Pending delete state ─────────────────────
let _pendingDeleteEl   = null;
let _pendingDeleteType = '';

// ── Default data ─────────────────────────────
const DEFAULT_CLASSES = [
  { name: 'Montessori', fee: 3000, fund: 2000, sections: ['A', 'B'] },
  { name: 'Nursery',    fee: 3500, fund: 2000, sections: ['A', 'B'] },
  { name: 'Prep',       fee: 4000, fund: 2000, sections: ['A', 'B'] },
  { name: 'Grade 1',    fee: 4500, fund: 2000, sections: ['A', 'B'] },
  { name: 'Grade 2',    fee: 4800, fund: 2000, sections: ['A', 'B'] },
];

const DEFAULT_LATEFEE = {
  enabled:     true,
  deadlineDay: 10,
  type:        'fixed',
  amount:      200,
  grace:       0,
};

const DEFAULT_TEACHERS = [
  { name: 'Ayesha Siddiqui', subject: 'Mathematics',   salary: 28000, penaltyType: 'percent', penaltyValue: 3.5, bonus: 1500 },
  { name: 'Tariq Mehmood',   subject: 'English',       salary: 26000, penaltyType: 'percent', penaltyValue: 3,   bonus: 1000 },
  { name: 'Sana Fatima',     subject: 'Science',       salary: 27000, penaltyType: 'fixed',   penaltyValue: 500, bonus: 1200 },
];

const DEFAULT_NONTEACHING = [
  { name: 'Imran Khan',   subject: 'Accountant',     salary: 22000, penaltyType: 'percent', penaltyValue: 3, bonus: 800 },
  { name: 'Rabia Aslam',  subject: 'Receptionist',   salary: 18000, penaltyType: 'fixed',   penaltyValue: 400, bonus: 700 },
  { name: 'Abdul Rehman', subject: 'Security Guard',  salary: 16000, penaltyType: 'fixed',   penaltyValue: 350, bonus: 500 },
];

const DEFAULT_VARIABLES = {
  penaltyType:    'percent',
  penaltyValue:   3,
  bonus:          1000,
};

// School / contact details, used anywhere the school's identity is printed
// (certificates, ID cards, student lists, fee vouchers, reports).
const DEFAULT_SCHOOL_INFO = {
  name:      '',
  address:   '',
  phone:     '',
  phoneAlt:  '',
  email:     '',
  website:   '',
  principal: '',
  regNo:     '',
};

const CLASS_ICONS  = ['fa-chalkboard','fa-book','fa-pencil-alt','fa-star','fa-medal','fa-award','fa-graduation-cap','fa-bookmark'];
const CLASS_COLORS = ['#1a9e6e','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#06b6d4'];

// ═══════════════════════════════════════════════
//  BACKEND API  (SchoolSettingsController)
// ═══════════════════════════════════════════════
// Same-origin relative path — works when this page is served by the same
// Spring Boot app / behind the same reverse proxy as the API. Point this
// at an absolute URL (e.g. 'http://localhost:8080/api/settings') if the
// frontend and backend are hosted separately.
const SETTINGS_API_BASE = 'http://localhost:8080/api/settings';

// Last-known settings row fetched from the backend (the single source of truth).
let _serverSettings = null;

/**
 * Every settings route is now scoped to a school: /api/settings/{schoolId}...
 * (see SchoolSettingsController). Pull the logged-in school's schoolId from
 * the session that access-control.js sets up at login — it embeds the full
 * backend School record, so `.schoolId` (e.g. "SS_77_12") is always there
 * by the time this page runs (access-control.js redirects to index.html
 * first if nobody's logged in).
 */
function _getSchoolId() {
  if (window.SoftSchoolAdmin && typeof window.SoftSchoolAdmin.getCurrentSchool === 'function') {
    const school = window.SoftSchoolAdmin.getCurrentSchool();
    if (school && school.schoolId) return school.schoolId;
  }
  // Fallback: read the session straight out of localStorage in case
  // SoftSchoolAdmin isn't available for some reason.
  try {
    const session = JSON.parse(localStorage.getItem('softschool_session'));
    if (session && session.schoolId) return session.schoolId;
  } catch (e) { /* ignore */ }
  return null;
}

/** Builds /api/settings/{schoolId}[suffix], throwing early with a clear
 *  message instead of letting a bad URL silently 404 against the API. */
function _settingsUrl(suffix = '') {
  const schoolId = _getSchoolId();
  if (!schoolId) {
    throw new Error('No logged-in school found — please log in again before changing settings.');
  }
  return `${SETTINGS_API_BASE}/${encodeURIComponent(schoolId)}${suffix}`;
}

async function apiRequest(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${options.method || 'GET'} ${url} failed (${res.status}) ${body}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

const apiGetSettings   = ()        => apiRequest(_settingsUrl());
const apiSaveAll       = (payload) => apiRequest(_settingsUrl(), { method: 'PUT', body: JSON.stringify(payload) });
const apiSaveTiming    = (payload) => apiRequest(_settingsUrl('/timing'), { method: 'PUT', body: JSON.stringify(payload) });
const apiResetSettings = ()        => apiRequest(_settingsUrl('/reset'), { method: 'POST' });

// ── Shape converters: backend (SchoolSettings.ClassFee) <-> frontend (name/sections[]) ──
function _classesApiToLocal(apiClasses) {
  return (Array.isArray(apiClasses) ? apiClasses : []).map(c => ({
    name:     c.className || '',
    fee:      c.fee  != null ? c.fee  : 0,
    fund:     c.fund != null ? c.fund : 0,
    sections: (c.sections || '').split(',').map(s => s.trim()).filter(Boolean),
  }));
}

function _classesLocalToApi(localClasses) {
  return (localClasses || []).map(c => ({
    className: c.name,
    fee:       c.fee,
    fund:      c.fund,
    sections:  (c.sections || []).join(','),
  }));
}

/**
 * Caches a SchoolSettings row from the backend into the in-memory
 * _serverSettings object. The backend is the sole source of truth;
 * no localStorage writes are made.
 */
function _mirrorServerSettingsToLocalStorage(s) {
  // Data is already stored in _serverSettings by loadSettingsFromServer().
  // This function is kept for compatibility but no longer writes to localStorage.
}

/** Fetches the settings row from the backend and caches it locally. */
async function loadSettingsFromServer() {
  try {
    const s = await apiGetSettings();
    _serverSettings = s;
    _mirrorServerSettingsToLocalStorage(s);
    return s;
  } catch (err) {
    console.warn('[Settings] Could not load settings from the server, falling back to local cache.', err);
    showToast('Could not reach the server — showing locally cached settings.', 'error');
    return null;
  }
}

// ═══════════════════════════════════════════════
//  DARK MODE
// ═══════════════════════════════════════════════
function toggleDarkMode() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  if (isDark) {
    html.removeAttribute('data-theme');
    localStorage.setItem('eduflow-theme', 'light');
  } else {
    html.setAttribute('data-theme', 'dark');
    localStorage.setItem('eduflow-theme', 'dark');
  }
  updateThemeIcon();
}

function updateThemeIcon() {
  const icon = document.getElementById('theme-icon');
  if (!icon) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
}

function initDarkMode() {
  const saved = localStorage.getItem('eduflow-theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  updateThemeIcon();
}

// ═══════════════════════════════════════════════
//  ATTENDANCE → ABSENCE FINE HELPERS
// ═══════════════════════════════════════════════

/**
 * Returns absent days for a staff member this month.
 * Attendance data is managed by the backend — this returns 0
 * as the backend handles absence fine calculations server-side.
 */
function getAbsentDaysThisMonth(staffId) {
  return 0; // Absence data is fetched from the backend, not localStorage
}

/**
 * Calculates the fine amount for a staff card based on their penalty settings
 * and attendance records for the current month.
 */
function computeAbsenceFine(salary, penaltyType, penaltyValue, staffId) {
  const absentDays = getAbsentDaysThisMonth(staffId);
  if (!absentDays) return { fine: 0, absentDays: 0 };
  let fine = 0;
  if (penaltyType === 'percent') {
    // Per-day % of monthly salary
    fine = (salary * (penaltyValue / 100)) * absentDays;
  } else {
    fine = penaltyValue * absentDays;
  }
  return { fine: Math.round(fine), absentDays };
}

/**
 * Injects an absence-deduction badge into a teacher card if there are
 * absent records this month.
 */
function injectAbsenceBadge(card, salary, penaltyType, penaltyValue, staffId) {
  // Remove any existing badge first
  const old = card.querySelector('.absence-deduction-badge');
  if (old) old.remove();
  if (!staffId) return;

  const { fine, absentDays } = computeAbsenceFine(salary, penaltyType, penaltyValue, staffId);
  if (absentDays === 0) return;

  const badge = document.createElement('div');
  badge.className = 'absence-deduction-badge';
  badge.innerHTML = `
    <i class="fas fa-calendar-times"></i>
    <span>
      <strong>${absentDays} absent day${absentDays !== 1 ? 's' : ''}</strong> this month —
      deduction: <strong>Rs ${fine.toLocaleString()}</strong>
      <span style="color:var(--text-muted);font-size:11px;">(auto from attendance)</span>
    </span>
  `;
  card.querySelector('.penalty-section').after(badge);
}

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  initDarkMode();

  // Fetch the settings row from the backend first, then render every tab
  // from that (mirrored into localStorage as a cache along the way).
  await loadSettingsFromServer();

  loadSchoolInfo();
  loadClasses();
  loadLateFee();
  loadVariables();
  wirePayVariableLiveSync();
  syncCardsFromVariables();
  renderAttendanceTiming();

  // Sync penalty prefix in variables panel
  document.getElementById('var-penalty-type').addEventListener('change', function () {
    document.getElementById('var-penalty-prefix').textContent = this.value === 'percent' ? '%' : 'Rs';
  });

  // Sync late fee fine type prefix + live preview
  document.getElementById('latefee-type').addEventListener('change', () => {
    syncLateFeePrefix();
    updateLateFeePreview();
  });
  ['latefee-deadline-day', 'latefee-amount', 'latefee-grace'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateLateFeePreview);
  });
});

// ═══════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════
//  TABS
// ═══════════════════════════════════════════════
function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}

// ═══════════════════════════════════════════════
//  DELETE CONFIRM MODAL
// ═══════════════════════════════════════════════
function openDeleteModal(el, type) {
  _pendingDeleteEl   = el;
  _pendingDeleteType = type;

  const titleMap = {
    class: 'Delete this class?',
    teacher: 'Remove this teacher?',
    nonteaching: 'Remove this staff member?',
  };
  const bodyMap  = {
    class:       'This will permanently remove the class and its fee configuration. Students already admitted won\'t be affected.',
    teacher:     'This will remove the teacher record and their pay configuration from this system.',
    nonteaching: 'This will remove the non-teaching staff record and their pay configuration from this system.',
  };

  document.getElementById('modal-title').textContent = titleMap[type] || 'Confirm deletion';
  document.getElementById('modal-body').textContent  = bodyMap[type]  || 'Are you sure you want to delete this item?';
  document.getElementById('confirm-modal').classList.add('active');
}

function closeModal() {
  document.getElementById('confirm-modal').classList.remove('active');
  _pendingDeleteEl   = null;
  _pendingDeleteType = '';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-confirm-btn').addEventListener('click', () => {
    if (_pendingDeleteEl) {
      if (_pendingDeleteType === 'teacher') {
        const staffId = _pendingDeleteEl.dataset && _pendingDeleteEl.dataset.staffId;
        if (staffId) {
          const shared = getSharedTeachers();
          if (shared) setSharedTeachers(shared.filter(s => s.id !== staffId));
        }
      }
      if (_pendingDeleteType === 'nonteaching') {
        const staffId = _pendingDeleteEl.dataset && _pendingDeleteEl.dataset.staffId;
        if (staffId) {
          const shared = getSharedNonTeaching();
          if (shared) setSharedNonTeaching(shared.filter(s => s.id !== staffId));
        }
      }
      _pendingDeleteEl.remove();
      updateStaffCounts();
      showToast('Item deleted.', 'success');
    }
    closeModal();
  });

  document.getElementById('confirm-modal').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });
});

// ═══════════════════════════════════════════════
//  CLASSES
// ═══════════════════════════════════════════════
function loadClasses() {
  const classes = _serverSettings ? _classesApiToLocal(_serverSettings.classes) : DEFAULT_CLASSES;
  const grid  = document.getElementById('class-grid');
  grid.innerHTML = '';
  classes.forEach(c => appendClassCard(c.name, c.fee, c.fund, false, c.sections || []));
}

function appendClassCard(name, fee, fund, isNew = false, sections = []) {
  const grid  = document.getElementById('class-grid');
  const div   = document.createElement('div');
  div.className = 'class-card' + (isNew ? ' is-new' : '');
  const icon  = CLASS_ICONS[grid.children.length % CLASS_ICONS.length];
  const color = CLASS_COLORS[grid.children.length % CLASS_COLORS.length];

  div.innerHTML = `
    <button class="delete-card-btn" title="Remove class">
      <i class="fas fa-times"></i>
    </button>
    <div class="class-card-header">
      <div class="class-icon" style="background:${color}22; color:${color}"><i class="fas ${icon}"></i></div>
      <span class="class-badge ${isNew ? 'new-badge' : ''}">${isNew ? 'New' : 'Active'}</span>
    </div>
    <input type="text" class="class-name-input" value="${name}" placeholder="Class name (e.g. Grade 3)">
    <div class="fee-row">
      <div>
        <div class="fee-label">Monthly Tuition</div>
        <div class="input-prefix-wrap">
          <span class="input-prefix">Rs</span>
          <input type="number" class="fee-input-field" value="${fee}" placeholder="0" min="0" style="padding-left:28px;">
        </div>
      </div>
      <div>
        <div class="fee-label">Annual Fund</div>
        <div class="input-prefix-wrap">
          <span class="input-prefix">Rs</span>
          <input type="number" class="fund-input-field" value="${fund}" placeholder="0" min="0" style="padding-left:28px;">
        </div>
      </div>
    </div>

    <div class="sections-block">
      <div class="sections-header">
        <div class="fee-label" style="margin:0;">Sections <span class="sections-count">(${sections.length})</span></div>
        <button type="button" class="btn-add-section" title="Add section">
          <i class="fas fa-plus"></i> Add
        </button>
      </div>
      <div class="sections-list"></div>
      <div class="sections-empty" style="${sections.length ? 'display:none' : ''}">
        No sections yet. Click <b>Add</b> to create one (e.g. A, B, Rose).
      </div>
    </div>
  `;

  div.querySelector('.delete-card-btn').addEventListener('click', () => {
    openDeleteModal(div, 'class');
  });

  const listEl = div.querySelector('.sections-list');
  sections.forEach(s => listEl.appendChild(buildSectionChip(s, div)));

  div.querySelector('.btn-add-section').addEventListener('click', () => {
    const chip = buildSectionChip('', div, true);
    listEl.appendChild(chip);
    chip.querySelector('input').focus();
    updateSectionsCount(div);
  });

  grid.appendChild(div);
}

function buildSectionChip(value, cardEl, isNew = false) {
  const chip = document.createElement('span');
  chip.className = 'section-chip' + (isNew ? ' is-new' : '');
  chip.innerHTML = `
    <input type="text" class="section-chip-input" value="${value || ''}" placeholder="A" maxlength="20">
    <button type="button" class="section-chip-remove" title="Remove section">
      <i class="fas fa-times"></i>
    </button>
  `;
  chip.querySelector('.section-chip-remove').addEventListener('click', () => {
    chip.remove();
    updateSectionsCount(cardEl);
  });
  return chip;
}

function updateSectionsCount(cardEl) {
  const n = cardEl.querySelectorAll('.section-chip').length;
  const countEl = cardEl.querySelector('.sections-count');
  if (countEl) countEl.textContent = `(${n})`;
  const emptyEl = cardEl.querySelector('.sections-empty');
  if (emptyEl) emptyEl.style.display = n ? 'none' : '';
}

function addClassCard() {
  appendClassCard('', 0, 0, true, []);
  document.querySelector('.class-grid').lastElementChild.querySelector('.class-name-input').focus();
}

// ═══════════════════════════════════════════════
//  SCHOOL INFO / CONTACT DETAILS
// ═══════════════════════════════════════════════
function loadSchoolInfo() {
  const s = _serverSettings || {};
  document.getElementById('school-name').value      = s.schoolName      || '';
  document.getElementById('school-address').value   = s.schoolAddress   || '';
  document.getElementById('school-phone').value      = s.schoolPhone     || '';
  document.getElementById('school-phone-alt').value  = s.schoolPhoneAlt  || '';
  document.getElementById('school-email').value      = s.schoolEmail     || '';
  document.getElementById('school-website').value    = s.schoolWebsite   || '';
  document.getElementById('school-principal').value  = s.schoolPrincipal || '';
  document.getElementById('school-reg-no').value     = s.schoolRegNo     || '';
}

function collectSchoolInfo() {
  return {
    name:      document.getElementById('school-name').value.trim(),
    address:   document.getElementById('school-address').value.trim(),
    phone:     document.getElementById('school-phone').value.trim(),
    phoneAlt:  document.getElementById('school-phone-alt').value.trim(),
    email:     document.getElementById('school-email').value.trim(),
    website:   document.getElementById('school-website').value.trim(),
    principal: document.getElementById('school-principal').value.trim(),
    regNo:     document.getElementById('school-reg-no').value.trim(),
  };
}

function saveSchoolInfo() {
  // School info is saved to the backend via saveAll() — no localStorage write needed.
}

// ═══════════════════════════════════════════════
//  LATE FEE
// ═══════════════════════════════════════════════
function loadLateFee() {
  const s = _serverSettings || {};
  const saved = {
    enabled:     s.lateFeeEnabled !== false,
    deadlineDay: s.lateFeeDeadlineDay ?? DEFAULT_LATEFEE.deadlineDay,
    type:        s.lateFeeType        ?? DEFAULT_LATEFEE.type,
    amount:      s.lateFeeAmount      ?? DEFAULT_LATEFEE.amount,
    grace:       s.lateFeeGrace       ?? DEFAULT_LATEFEE.grace,
  };

  document.getElementById('latefee-enabled').checked    = saved.enabled;
  document.getElementById('latefee-deadline-day').value = saved.deadlineDay;
  document.getElementById('latefee-type').value         = saved.type;
  document.getElementById('latefee-amount').value       = saved.amount;
  document.getElementById('latefee-grace').value        = saved.grace;

  applyLateFeeToggle(saved.enabled);
  syncLateFeePrefix();
  updateLateFeePreview();
}

function toggleLateFee() {
  const enabled = document.getElementById('latefee-enabled').checked;
  applyLateFeeToggle(enabled);
}

function applyLateFeeToggle(enabled) {
  document.getElementById('latefee-body').classList.toggle('hidden', !enabled);
  document.getElementById('latefee-disabled-msg').style.display = enabled ? 'none' : 'block';
}

function syncLateFeePrefix() {
  const type = document.getElementById('latefee-type').value;
  document.getElementById('latefee-amount-prefix').textContent = type === 'percent' ? '%' : 'Rs';
}

function updateLateFeePreview() {
  const day    = parseInt(document.getElementById('latefee-deadline-day').value, 10) || 0;
  const grace  = parseInt(document.getElementById('latefee-grace').value, 10)         || 0;
  const type   = document.getElementById('latefee-type').value;
  const amount = parseFloat(document.getElementById('latefee-amount').value)          || 0;
  const cutoff = day + grace;

  const amountText = type === 'percent'
    ? `${amount}% of that month's tuition fee`
    : `Rs ${amount.toLocaleString()}`;

  document.getElementById('latefee-preview-text').textContent =
    `Fees paid after day ${cutoff} of the month will be fined ${amountText}.`;
}

// ═══════════════════════════════════════════════
//  TEACHERS  (linked to Staff Management)
// ═══════════════════════════════════════════════
function _hasSharedStore() {
  return typeof getGlobalData === 'function' && typeof saveGlobalData === 'function';
}
function getSharedTeachers() {
  if (_hasSharedStore()) {
    const db = getGlobalData();
    if (db && db.staff && Array.isArray(db.staff['Teaching'])) {
      return db.staff['Teaching'];
    }
  }
  return null;
}
function setSharedTeachers(list) {
  if (!_hasSharedStore()) return false;
  const db = getGlobalData();
  db.staff = db.staff || { 'Teaching': [], 'Non-Teaching': [] };
  db.staff['Teaching'] = list;
  saveGlobalData(db);
  return true;
}

function _staffToTeacher(s) {
  return {
    id:           s.id || null,
    name:         s.name || '',
    subject:      s.subjects || s.subject || '',
    salary:       parseFloat(s.salary) || 0,
    penaltyType:  s.penaltyType  ?? undefined,
    penaltyValue: s.penaltyValue ?? undefined,
    bonus:        s.bonus        ?? undefined,
    _linked:      !!s.id,
  };
}

function loadTeachers() {
  _sanitizeStaffBuckets();
  const grid = document.getElementById('teacher-grid');
  grid.innerHTML = '';

  const sharedTeaching = getSharedTeachers();
  if (sharedTeaching && sharedTeaching.length) {
    sharedTeaching.forEach(s => appendTeacherCard(_staffToTeacher(s), false));
    return;
  }

  DEFAULT_TEACHERS.forEach(t => appendTeacherCard(t, false));
}

function appendTeacherCard(t = {}, isNew = true) {
  const grid = document.getElementById('teacher-grid');
  const vars = getVariables();
  const div  = document.createElement('div');
  div.className = 'teacher-card' + (isNew ? ' is-new' : '');

  if (t.id) div.dataset.staffId = t.id;

  const salary       = t.salary       ?? 25000;
  const customPType  = t.penaltyType  != null && t.penaltyType  !== '';
  const customPVal   = t.penaltyValue != null && t.penaltyValue !== '';
  const customBonus  = t.bonus        != null && t.bonus        !== '';
  const penaltyType  = customPType ? t.penaltyType  : vars.penaltyType;
  const penaltyValue = customPVal  ? t.penaltyValue : vars.penaltyValue;
  const bonus        = customBonus ? t.bonus        : vars.bonus;

  const linkedBadge = t.id
    ? `<span class="teacher-badge" style="background:var(--blue-light);color:#1d4ed8;margin-left:6px;" title="Synced from Staff Management"><i class="fas fa-link"></i> ${t.id}</span>`
    : '';

  div.innerHTML = `
    <button class="delete-card-btn" title="Remove teacher">
      <i class="fas fa-times"></i>
    </button>
    <div class="teacher-card-header">
      <div class="teacher-avatar"><i class="fas fa-user-tie"></i></div>
      <span class="teacher-badge ${isNew ? 'new-badge' : ''}">${isNew ? 'New' : 'Active'}</span>
      ${linkedBadge}
    </div>
    <input type="text" class="teacher-name-input" value="${t.name || ''}" placeholder="Teacher full name">
    <input type="text" class="teacher-subject-input" value="${t.subject || ''}" placeholder="Subject / Role">

    <div class="pay-grid">
      <div>
        <div class="pay-label">Monthly Salary</div>
        <div class="input-prefix-wrap">
          <span class="input-prefix">Rs</span>
          <input type="number" class="pay-input teacher-salary" value="${salary}" min="0" style="padding-left:28px;">
        </div>
      </div>
      <div>
        <div class="pay-label">Leave Penalty <span class="var-src-tag var-src-penaltyType">(src: pay variable)</span></div>
        <select class="penalty-type-select teacher-penalty-type">
          <option value="percent" ${penaltyType === 'percent' ? 'selected' : ''}>% per day</option>
          <option value="fixed"   ${penaltyType === 'fixed'   ? 'selected' : ''}>Rs per day</option>
        </select>
      </div>
    </div>

    <div class="penalty-section">
      <div class="penalty-section-title"><i class="fas fa-calendar-times" style="margin-right:4px;color:var(--red);"></i>Absence Deduction &amp; Attendance Bonus</div>
      <div class="pay-grid">
        <div>
          <div class="pay-label">Deduction Value <span class="var-src-tag var-src-penaltyValue">(src: pay variable)</span></div>
          <div class="input-prefix-wrap">
            <span class="input-prefix teacher-penalty-prefix">${penaltyType === 'percent' ? '%' : 'Rs'}</span>
            <input type="number" class="pay-input teacher-penalty-value" value="${penaltyValue}" min="0" step="0.5" style="padding-left:28px;">
          </div>
          <div class="var-hint" style="font-size:11px;color:var(--text-light);margin-top:4px;">Per day of leave taken</div>
        </div>
        <div>
          <div class="bonus-label-row"><i class="fas fa-star"></i> Full-Attendance Bonus <span class="var-src-tag var-src-bonus">(src: pay variable)</span></div>
          <div class="input-prefix-wrap">
            <span class="input-prefix">Rs</span>
            <input type="number" class="pay-input teacher-bonus" value="${bonus}" min="0" style="padding-left:28px;">
          </div>
          <div class="var-hint" style="font-size:11px;color:var(--text-light);margin-top:4px;">Paid if zero absences</div>
        </div>
      </div>
    </div>
  `;

  div.querySelector('.delete-card-btn').addEventListener('click', () => {
    openDeleteModal(div, 'teacher');
  });

  div.querySelector('.teacher-penalty-type').addEventListener('change', function () {
    div.querySelector('.teacher-penalty-prefix').textContent = this.value === 'percent' ? '%' : 'Rs';
    refreshAbsenceBadge(div);
  });

  // Refresh absence badge when salary/penalty changes
  ['teacher-salary', 'teacher-penalty-value'].forEach(cls => {
    const el = div.querySelector('.' + cls);
    if (el) el.addEventListener('input', () => refreshAbsenceBadge(div));
  });

  _attachVarSync(div, 'penaltyType',  customPType);
  _attachVarSync(div, 'penaltyValue', customPVal);
  _attachVarSync(div, 'bonus',        customBonus);

  grid.appendChild(div);

  // Show absence fine from real attendance data
  if (t.id) {
    injectAbsenceBadge(div, salary, penaltyType, penaltyValue, t.id);
  }

  return div;
}

function refreshAbsenceBadge(card) {
  const staffId = card.dataset.staffId;
  if (!staffId) return;
  const salary    = parseFloat(card.querySelector('.teacher-salary')?.value) || 0;
  const ptype     = card.querySelector('.teacher-penalty-type')?.value || 'percent';
  const pval      = parseFloat(card.querySelector('.teacher-penalty-value')?.value) || 0;
  injectAbsenceBadge(card, salary, ptype, pval, staffId);
}

function addTeacherCard() {
  showToast('Add teachers from the Staff Management page.', 'success');
}

// ═══════════════════════════════════════════════
//  VARIABLES
// ═══════════════════════════════════════════════
function getVariables() {
  if (_serverSettings) {
    return {
      penaltyType:  _serverSettings.payPenaltyType  ?? DEFAULT_VARIABLES.penaltyType,
      penaltyValue: _serverSettings.payPenaltyValue ?? DEFAULT_VARIABLES.penaltyValue,
      bonus:        _serverSettings.payBonus         ?? DEFAULT_VARIABLES.bonus,
    };
  }
  return DEFAULT_VARIABLES;
}

function loadVariables() {
  const v = getVariables();
  document.getElementById('var-penalty-type').value    = v.penaltyType;
  document.getElementById('var-penalty-value').value   = v.penaltyValue;
  document.getElementById('var-penalty-prefix').textContent = v.penaltyType === 'percent' ? '%' : 'Rs';
  document.getElementById('var-bonus').value           = v.bonus;
}

// ═══════════════════════════════════════════════
//  PAY-VARIABLE LIVE SYNC
// ═══════════════════════════════════════════════
function _attachVarSync(card, fieldKey, isCustom) {
  const labelSel = {
    penaltyType:  '.var-src-penaltyType',
    penaltyValue: '.var-src-penaltyValue',
    bonus:        '.var-src-bonus',
  }[fieldKey];
  const inputSel = {
    penaltyType:  '.teacher-penalty-type',
    penaltyValue: '.teacher-penalty-value',
    bonus:        '.teacher-bonus',
  }[fieldKey];
  const input = card.querySelector(inputSel);
  const label = card.querySelector(labelSel);
  if (!input) return;
  card.dataset[fieldKey + 'Custom'] = isCustom ? '1' : '0';
  if (label) label.style.display = isCustom ? 'none' : '';
  const markCustom = () => {
    card.dataset[fieldKey + 'Custom'] = '1';
    if (label) label.style.display = 'none';
  };
  input.addEventListener('input',  markCustom);
  input.addEventListener('change', markCustom);
}

function syncCardsFromVariables() {
  const v = {
    penaltyType:  document.getElementById('var-penalty-type').value,
    penaltyValue: parseFloat(document.getElementById('var-penalty-value').value) || 0,
    bonus:        parseFloat(document.getElementById('var-bonus').value) || 0,
  };
  document.querySelectorAll('#teacher-grid .teacher-card, #nonteaching-grid .teacher-card').forEach(card => {
    const sel  = card.querySelector('.teacher-penalty-type');
    const pref = card.querySelector('.teacher-penalty-prefix');
    if (card.dataset.penaltyTypeCustom !== '1') {
      if (sel) sel.value = v.penaltyType;
      if (pref) pref.textContent = v.penaltyType === 'percent' ? '%' : 'Rs';
    } else if (sel && pref) {
      pref.textContent = sel.value === 'percent' ? '%' : 'Rs';
    }
    if (card.dataset.penaltyValueCustom !== '1') {
      const inp = card.querySelector('.teacher-penalty-value');
      if (inp) inp.value = v.penaltyValue;
    }
    if (card.dataset.bonusCustom !== '1') {
      const inp = card.querySelector('.teacher-bonus');
      if (inp) inp.value = v.bonus;
    }
    refreshAbsenceBadge(card);
  });
}

function persistVariablesLive() {
  const vars = {
    penaltyType:  document.getElementById('var-penalty-type').value,
    penaltyValue: parseFloat(document.getElementById('var-penalty-value').value) || 0,
    bonus:        parseFloat(document.getElementById('var-bonus').value) || 0,
  };
  // Variables are persisted to the backend via saveAll() — no localStorage write needed.
}

function wirePayVariableLiveSync() {
  ['var-penalty-type', 'var-penalty-value', 'var-bonus'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const handler = () => {
      if (id === 'var-penalty-type') {
        document.getElementById('var-penalty-prefix').textContent =
          el.value === 'percent' ? '%' : 'Rs';
      }
      syncCardsFromVariables();
      persistVariablesLive();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });
}

// ═══════════════════════════════════════════════
//  STAFF BUCKET SANITIZER
// ═══════════════════════════════════════════════
function _looksNonTeaching(s) {
  if (!s) return false;
  if (s.type === 'Non-Teaching') return true;
  if (s.type === 'Teaching') return false;
  if (s.role || s.job || s.startTime || s.endTime) return true;
  if (s.subjects || s.qualification || s.classes || s.incharge) return false;
  return false;
}
function _sanitizeStaffBuckets() {
  if (!_hasSharedStore()) return;
  const db = getGlobalData();
  if (!db || !db.staff) return;
  const teaching    = Array.isArray(db.staff['Teaching'])    ? db.staff['Teaching']    : [];
  const nonTeaching = Array.isArray(db.staff['Non-Teaching']) ? db.staff['Non-Teaching'] : [];
  const cleanT = [];
  const cleanNT = [...nonTeaching];
  let changed = false;
  teaching.forEach(s => {
    if (_looksNonTeaching(s)) {
      cleanNT.push({ ...s, type: 'Non-Teaching' });
      changed = true;
    } else {
      if (!s.type) changed = true;
      cleanT.push({ ...s, type: s.type || 'Teaching' });
    }
  });
  const stampedNT = cleanNT.map(s => {
    if (!s.type) { changed = true; return { ...s, type: 'Non-Teaching' }; }
    return s;
  });
  if (changed) {
    db.staff['Teaching']    = cleanT;
    db.staff['Non-Teaching'] = stampedNT;
    saveGlobalData(db);
  }
}

// ═══════════════════════════════════════════════
//  SAVE ALL  (PUT /api/settings)
// ═══════════════════════════════════════════════
async function saveAll() {
  // — Classes —
  const cards   = document.querySelectorAll('.class-card');
  const classes = [];
  cards.forEach(card => {
    const name = card.querySelector('.class-name-input').value.trim();
    const fee  = parseFloat(card.querySelector('.fee-input-field').value)  || 0;
    const fund = parseFloat(card.querySelector('.fund-input-field').value) || 0;
    const sections = Array.from(card.querySelectorAll('.section-chip-input'))
      .map(i => i.value.trim())
      .filter(Boolean);
    const seen = new Set();
    const uniqueSections = sections.filter(s => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    if (name) classes.push({ name, fee, fund, sections: uniqueSections });
  });

  // — Late Fee —
  const lateFee = {
    enabled:     document.getElementById('latefee-enabled').checked,
    deadlineDay: parseInt(document.getElementById('latefee-deadline-day').value, 10) || 0,
    type:        document.getElementById('latefee-type').value,
    amount:      parseFloat(document.getElementById('latefee-amount').value) || 0,
    grace:       parseInt(document.getElementById('latefee-grace').value, 10) || 0,
  };

  // — School Info —
  const schoolInfo = collectSchoolInfo();

  // SECURITY: schema-validate the school profile fields (same shared
  // library used across every other form in the app) before they're
  // sent to the backend and rendered on every page via `.school-name`
  // etc. Rejects invalid input with a toast instead of saving it.
  const schoolInfoCheck = SSValidate.validate(schoolInfo, {
    name:      SSValidate.rules.name({ required: true, maxLength: 120, label: "School name" }),
    address:   SSValidate.rules.address({ required: false, maxLength: 300, label: "School address" }),
    phone:     SSValidate.rules.phone({ required: false, label: "School phone" }),
    phoneAlt:  SSValidate.rules.phone({ required: false, label: "Alternate phone" }),
    email:     SSValidate.rules.email({ required: false, label: "School email" }),
    website:   SSValidate.rules.text({ required: false, maxLength: 200, label: "Website" }),
    principal: SSValidate.rules.name({ required: false, maxLength: 80, label: "Principal name" }),
    regNo:     SSValidate.rules.id({ required: false, maxLength: 40, label: "Registration number" }),
  });
  if (!schoolInfoCheck.ok) {
    const firstError = Object.values(schoolInfoCheck.errors).find(Boolean);
    if (typeof showToast === 'function') showToast(firstError, 'error');
    return;
  }
  Object.assign(schoolInfo, schoolInfoCheck.values);

  // SECURITY: validate class name / fee / fund the same way (allow-list
  // text + non-negative money) before they're pushed into `classes`.
  const classSchema = {
    name: SSValidate.rules.name({ required: true, maxLength: 60, label: "Class name" }),
    fee:  SSValidate.rules.money({ required: false, max: 10000000, label: "Class fee" }),
    fund: SSValidate.rules.money({ required: false, max: 10000000, label: "Class fund" }),
  };
  for (const cls of classes) {
    const check = SSValidate.validate(cls, classSchema);
    if (!check.ok) {
      const firstError = Object.values(check.errors).find(Boolean);
      if (typeof showToast === 'function') showToast(firstError, 'error');
      return;
    }
    Object.assign(cls, check.values);
  }

  // — Pay Variables —
  const vars = {
    penaltyType:  document.getElementById('var-penalty-type').value,
    penaltyValue: parseFloat(document.getElementById('var-penalty-value').value) || 0,
    bonus:        parseFloat(document.getElementById('var-bonus').value)          || 0,
  };

  // Build the payload exactly matching the SchoolSettings entity fields.
  const payload = {
    schoolName:      schoolInfo.name,
    schoolAddress:   schoolInfo.address,
    schoolPhone:     schoolInfo.phone,
    schoolPhoneAlt:  schoolInfo.phoneAlt,
    schoolEmail:     schoolInfo.email,
    schoolWebsite:   schoolInfo.website,
    schoolPrincipal: schoolInfo.principal,
    schoolRegNo:     schoolInfo.regNo,

    lateFeeEnabled:     lateFee.enabled,
    lateFeeDeadlineDay: lateFee.deadlineDay,
    lateFeeType:        lateFee.type,
    lateFeeAmount:      lateFee.amount,
    lateFeeGrace:       lateFee.grace,

    payPenaltyType:  vars.penaltyType,
    payPenaltyValue: vars.penaltyValue,
    payBonus:        vars.bonus,

    classes: _classesLocalToApi(classes),
  };

  try {
    const saved = await apiSaveAll(payload);
    _serverSettings = saved;
    _mirrorServerSettingsToLocalStorage(saved); // keep local cache + other pages in sync

    showBadge();
    showToast('All configurations saved successfully.', 'success');
  } catch (err) {
    console.error('[Settings] Save All failed:', err);
    showToast('Could not save to the server. Check your connection and try again.', 'error');
  }
}

// ═══════════════════════════════════════════════
//  RESET  (POST /api/settings/reset)
// ═══════════════════════════════════════════════
async function resetSettings() {
  const resetConfirmed = await showConfirmDialog(
    'Reset all settings to defaults?',
    { title: 'Reset Settings', confirmLabel: 'Reset', danger: false }
  );
  if (!resetConfirmed) return;
  try {
    const fresh = await apiResetSettings();
    _serverSettings = fresh;
    _mirrorServerSettingsToLocalStorage(fresh);

    loadClasses();
    loadLateFee();
    loadVariables();
    loadSchoolInfo();
    renderAttendanceTiming();

    showToast('Settings reset to defaults.', 'success');
  } catch (err) {
    console.error('[Settings] Reset failed:', err);
    showToast('Could not reset settings on the server.', 'error');
  }
}

// ═══════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════
function showBadge() {
  const b = document.getElementById('saved-badge');
  b.classList.add('show');
  setTimeout(() => b.classList.remove('show'), 2500);
}

function showToast(msg, type = 'success') {
  const t   = document.getElementById('toast');
  const dot = document.getElementById('toast-dot');
  document.getElementById('toast-text').textContent = msg;
  dot.className = 'toast-dot ' + type;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

/* ── Generic in-app confirm dialog (replaces window.confirm) ──
   Reuses the same .modal-overlay / .modal-box visual style as the
   existing delete-confirmation modal, but as its own overlay so it
   doesn't interfere with that modal's dedicated click handlers. */
function showConfirmDialog(message, opts = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-icon"><i class="fas ${opts.danger === false ? 'fa-circle-question' : 'fa-triangle-exclamation'}"></i></div>
        <h3></h3>
        <p></p>
        <div class="modal-actions">
          <button type="button" class="btn-cancel"></button>
          <button type="button" class="${opts.danger === false ? 'btn-danger' : 'btn-danger'}"></button>
        </div>
      </div>`;
    overlay.querySelector('h3').textContent = opts.title || 'Please Confirm';
    overlay.querySelector('p').textContent = message;
    overlay.querySelector('.btn-cancel').textContent = opts.cancelLabel || 'Cancel';
    const confirmBtn = overlay.querySelector('.btn-danger');
    confirmBtn.textContent = opts.confirmLabel || 'Confirm';
    if (opts.danger === false) {
      confirmBtn.style.background = 'var(--accent)';
    }

    document.body.appendChild(overlay);

    function close(result) {
      overlay.remove();
      resolve(result);
    }
    overlay.querySelector('.btn-cancel').addEventListener('click', () => close(false));
    confirmBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
  });
}

// ═══════════════════════════════════════════════
//  STAFF SUB-TABS / SEARCH / COUNTS
// ═══════════════════════════════════════════════
function switchStaffSub(name, btn) {
  document.querySelectorAll('.staff-subpanel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.staff-subtab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('staff-sub-' + name).classList.add('active');
  btn.classList.add('active');
}

function filterStaff(which, query) {
  const gridId  = which === 'teaching' ? 'teacher-grid' : 'nonteaching-grid';
  const emptyId = which === 'teaching' ? 'teaching-empty' : 'nonteaching-empty';
  const q = (query || '').trim().toLowerCase();
  const cards = document.querySelectorAll('#' + gridId + ' .teacher-card');
  let visible = 0;
  cards.forEach(card => {
    const name = (card.querySelector('.teacher-name-input')?.value || '').toLowerCase();
    const subj = (card.querySelector('.teacher-subject-input')?.value || '').toLowerCase();
    const match = !q || name.includes(q) || subj.includes(q);
    card.classList.toggle('is-hidden', !match);
    if (match) visible++;
  });
  const emptyEl = document.getElementById(emptyId);
  if (emptyEl) emptyEl.style.display = (cards.length > 0 && visible === 0) ? 'block' : 'none';
}

function updateStaffCounts() {
  const t  = document.querySelectorAll('#teacher-grid .teacher-card').length;
  const n  = document.querySelectorAll('#nonteaching-grid .teacher-card').length;
  const tc = document.getElementById('teaching-count');
  const nc = document.getElementById('nonteaching-count');
  if (tc) tc.textContent = t;
  if (nc) nc.textContent = n;
}

// ═══════════════════════════════════════════════
//  NON-TEACHING STAFF
// ═══════════════════════════════════════════════
function getSharedNonTeaching() {
  if (_hasSharedStore()) {
    const db = getGlobalData();
    if (db && db.staff && Array.isArray(db.staff['Non-Teaching'])) {
      return db.staff['Non-Teaching'];
    }
  }
  return null;
}
function setSharedNonTeaching(list) {
  if (!_hasSharedStore()) return false;
  const db = getGlobalData();
  db.staff = db.staff || { 'Teaching': [], 'Non-Teaching': [] };
  db.staff['Non-Teaching'] = list;
  saveGlobalData(db);
  return true;
}

function _staffToNonTeacher(s) {
  return {
    id:           s.id || null,
    name:         s.name || '',
    subject:      s.role || s.subjects || s.subject || '',
    salary:       parseFloat(s.salary) || 0,
    penaltyType:  s.penaltyType  ?? undefined,
    penaltyValue: s.penaltyValue ?? undefined,
    bonus:        s.bonus        ?? undefined,
    _linked:      !!s.id,
  };
}

function loadNonTeaching() {
  _sanitizeStaffBuckets();
  const grid = document.getElementById('nonteaching-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const shared = getSharedNonTeaching();
  if (shared && shared.length) {
    shared.forEach(s => appendNonTeachingCard(_staffToNonTeacher(s), false));
    return;
  }

  DEFAULT_NONTEACHING.forEach(t => appendNonTeachingCard(t, false));
}

function appendNonTeachingCard(t = {}, isNew = true) {
  const grid = document.getElementById('nonteaching-grid');
  const vars = getVariables();
  const div  = document.createElement('div');
  div.className = 'teacher-card is-nonteaching' + (isNew ? ' is-new' : '');
  if (t.id) div.dataset.staffId = t.id;

  const salary       = t.salary       ?? 20000;
  const customPType  = t.penaltyType  != null && t.penaltyType  !== '';
  const customPVal   = t.penaltyValue != null && t.penaltyValue !== '';
  const customBonus  = t.bonus        != null && t.bonus        !== '';
  const penaltyType  = customPType ? t.penaltyType  : vars.penaltyType;
  const penaltyValue = customPVal  ? t.penaltyValue : vars.penaltyValue;
  const bonus        = customBonus ? t.bonus        : vars.bonus;

  const linkedBadge = t.id
    ? `<span class="teacher-badge" style="background:var(--blue-light);color:#1d4ed8;margin-left:6px;" title="Synced from Staff Management"><i class="fas fa-link"></i> ${t.id}</span>`
    : '';

  div.innerHTML = `
    <button class="delete-card-btn" title="Remove staff member">
      <i class="fas fa-times"></i>
    </button>
    <div class="teacher-card-header">
      <div class="teacher-avatar"><i class="fas fa-user-cog"></i></div>
      <span class="teacher-badge ${isNew ? 'new-badge' : ''}">${isNew ? 'New' : 'Active'}</span>
      ${linkedBadge}
    </div>
    <input type="text" class="teacher-name-input" value="${t.name || ''}" placeholder="Staff full name">
    <input type="text" class="teacher-subject-input" value="${t.subject || ''}" placeholder="Role (e.g. Accountant, Driver)">

    <div class="pay-grid">
      <div>
        <div class="pay-label">Monthly Salary</div>
        <div class="input-prefix-wrap">
          <span class="input-prefix">Rs</span>
          <input type="number" class="pay-input teacher-salary" value="${salary}" min="0" style="padding-left:28px;">
        </div>
      </div>
      <div>
        <div class="pay-label">Leave Penalty <span class="var-src-tag var-src-penaltyType">(src: pay variable)</span></div>
        <select class="penalty-type-select teacher-penalty-type">
          <option value="percent" ${penaltyType === 'percent' ? 'selected' : ''}>% per day</option>
          <option value="fixed"   ${penaltyType === 'fixed'   ? 'selected' : ''}>Rs per day</option>
        </select>
      </div>
    </div>

    <div class="penalty-section">
      <div class="penalty-section-title"><i class="fas fa-calendar-times" style="margin-right:4px;color:var(--red);"></i>Absence Deduction &amp; Attendance Bonus</div>
      <div class="pay-grid">
        <div>
          <div class="pay-label">Deduction Value <span class="var-src-tag var-src-penaltyValue">(src: pay variable)</span></div>
          <div class="input-prefix-wrap">
            <span class="input-prefix teacher-penalty-prefix">${penaltyType === 'percent' ? '%' : 'Rs'}</span>
            <input type="number" class="pay-input teacher-penalty-value" value="${penaltyValue}" min="0" step="0.5" style="padding-left:28px;">
          </div>
          <div class="var-hint" style="font-size:11px;color:var(--text-light);margin-top:4px;">Per day of leave taken</div>
        </div>
        <div>
          <div class="bonus-label-row"><i class="fas fa-star"></i> Full-Attendance Bonus <span class="var-src-tag var-src-bonus">(src: pay variable)</span></div>
          <div class="input-prefix-wrap">
            <span class="input-prefix">Rs</span>
            <input type="number" class="pay-input teacher-bonus" value="${bonus}" min="0" style="padding-left:28px;">
          </div>
          <div class="var-hint" style="font-size:11px;color:var(--text-light);margin-top:4px;">Paid if zero absences</div>
        </div>
      </div>
    </div>
  `;

  div.querySelector('.delete-card-btn').addEventListener('click', () => {
    openDeleteModal(div, 'nonteaching');
  });
  div.querySelector('.teacher-penalty-type').addEventListener('change', function () {
    div.querySelector('.teacher-penalty-prefix').textContent = this.value === 'percent' ? '%' : 'Rs';
    refreshAbsenceBadge(div);
  });
  ['teacher-salary', 'teacher-penalty-value'].forEach(cls => {
    const el = div.querySelector('.' + cls);
    if (el) el.addEventListener('input', () => refreshAbsenceBadge(div));
  });
  ['teacher-name-input', 'teacher-subject-input'].forEach(cls => {
    const el = div.querySelector('.' + cls);
    if (el) el.addEventListener('input', () => {
      const q = document.getElementById('nonteaching-search')?.value || '';
      filterStaff('nonteaching', q);
    });
  });

  _attachVarSync(div, 'penaltyType',  customPType);
  _attachVarSync(div, 'penaltyValue', customPVal);
  _attachVarSync(div, 'bonus',        customBonus);

  grid.appendChild(div);
  updateStaffCounts();

  if (t.id) {
    injectAbsenceBadge(div, salary, penaltyType, penaltyValue, t.id);
  }

  return div;
}

function addNonTeachingCard() {
  if (_hasSharedStore()) {
    const shared  = getSharedNonTeaching() || [];
    const newId   = 'NTS-' + Math.floor(1000 + Math.random() * 9000);
    const newStaff = {
      id: newId, name: '', role: '', gender: 'Other',
      salary: 20000, joined: new Date().toISOString().slice(0, 10),
      cnic: '', phone: '', address: '',
      fines: 0, securityTotal: 0, securityMonthly: 0, securityCollected: 0,
    };
    shared.push(newStaff);
    setSharedNonTeaching(shared);
    const card = appendNonTeachingCard(_staffToNonTeacher(newStaff), true);
    card.querySelector('.teacher-name-input').focus();
    return;
  }
  const card = appendNonTeachingCard({}, true);
  card.querySelector('.teacher-name-input').focus();
}

function saveNonTeaching() {
  const cards = document.querySelectorAll('#nonteaching-grid .teacher-card');
  const list  = [];
  const sharedList = getSharedNonTeaching();
  const sharedById = {};
  if (sharedList) sharedList.forEach(s => { sharedById[s.id] = s; });
  const updatedShared = [];

  cards.forEach(card => {
    const name  = card.querySelector('.teacher-name-input').value.trim();
    const role  = card.querySelector('.teacher-subject-input').value.trim();
    const sal   = parseFloat(card.querySelector('.teacher-salary').value)        || 0;
    const ptype = card.querySelector('.teacher-penalty-type').value;
    const pval  = parseFloat(card.querySelector('.teacher-penalty-value').value) || 0;
    const bon   = parseFloat(card.querySelector('.teacher-bonus').value)         || 0;
    if (!name) return;

    const ptCust = card.dataset.penaltyTypeCustom === '1';
    const pvCust = card.dataset.penaltyValueCustom === '1';
    const bnCust = card.dataset.bonusCustom === '1';
    list.push({
      name, subject: role, salary: sal,
      penaltyType:  ptCust ? ptype : null,
      penaltyValue: pvCust ? pval  : null,
      bonus:        bnCust ? bon   : null,
    });

    if (sharedList) {
      const staffId = card.dataset.staffId;
      const base = (staffId && sharedById[staffId]) ? sharedById[staffId] : {
        id: 'NTS-' + Math.floor(1000 + Math.random() * 9000),
        gender: 'Other', joined: new Date().toISOString().slice(0, 10),
        cnic: '', phone: '', address: '', fines: 0,
        securityTotal: 0, securityMonthly: 0, securityCollected: 0,
      };
      updatedShared.push({
        ...base, name, role, type: 'Non-Teaching', salary: sal,
        penaltyType:  ptCust ? ptype : null,
        penaltyValue: pvCust ? pval  : null,
        bonus:        bnCust ? bon   : null,
      });
    }
  });
  // Non-teaching list is saved to backend via saveAll() — no localStorage write needed.
  if (sharedList) setSharedNonTeaching(updatedShared);
}

// Keep teaching counts/search live as cards are added
const _origAppendTeacherCard = appendTeacherCard;
appendTeacherCard = function (t, isNew) {
  const card = _origAppendTeacherCard(t, isNew);
  if (card) {
    ['teacher-name-input', 'teacher-subject-input'].forEach(cls => {
      const el = card.querySelector('.' + cls);
      if (el) el.addEventListener('input', () => {
        const q = document.getElementById('teaching-search')?.value || '';
        filterStaff('teaching', q);
      });
    });
  }
  updateStaffCounts();
  return card;
};
// ═══════════════════════════════════════════════
//  Attendance Timing Control
//  Two daily auto-save times for staff attendance
// ═══════════════════════════════════════════════
const ATT_TIMING_KEY = 'edu_attendance_timing';

// Optional: point this at your real DB endpoint. If blank, only localStorage
// is updated (eduflow-db → attendance.autoSaves[]) so the app keeps working.
const ATTENDANCE_DB_ENDPOINT = ''; // e.g. 'https://your-api.example.com/attendance/auto-save'

const DEFAULT_ATT_TIMING = {
  first:  { hour: 10, minute: 0, meridiem: 'AM', enabled: true },
  second: { hour: 2,  minute: 0, meridiem: 'PM', enabled: true },
};

function loadAttendanceTiming() {
  const s = _serverSettings || {};
  return {
    first:  Object.assign({}, DEFAULT_ATT_TIMING.first,  {
      hour:     s.autosave1Hour     ?? DEFAULT_ATT_TIMING.first.hour,
      minute:   s.autosave1Minute   ?? DEFAULT_ATT_TIMING.first.minute,
      meridiem: s.autosave1Meridiem ?? DEFAULT_ATT_TIMING.first.meridiem,
      enabled:  s.autosave1Enabled  ?? DEFAULT_ATT_TIMING.first.enabled,
    }),
    second: Object.assign({}, DEFAULT_ATT_TIMING.second, {
      hour:     s.autosave2Hour     ?? DEFAULT_ATT_TIMING.second.hour,
      minute:   s.autosave2Minute   ?? DEFAULT_ATT_TIMING.second.minute,
      meridiem: s.autosave2Meridiem ?? DEFAULT_ATT_TIMING.second.meridiem,
      enabled:  s.autosave2Enabled  ?? DEFAULT_ATT_TIMING.second.enabled,
    }),
  };
}

function renderAttendanceTiming() {
  const t = loadAttendanceTiming();
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const check = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

  set('autosave1-hour',     t.first.hour);
  set('autosave1-minute',   t.first.minute);
  set('autosave1-meridiem', t.first.meridiem);
  check('autosave1-enabled', t.first.enabled);

  set('autosave2-hour',     t.second.hour);
  set('autosave2-minute',   t.second.minute);
  set('autosave2-meridiem', t.second.meridiem);
  check('autosave2-enabled', t.second.enabled);
}

function _readTimingSlot(prefix) {
  const h   = parseInt(document.getElementById(prefix + '-hour').value, 10);
  const m   = parseInt(document.getElementById(prefix + '-minute').value, 10);
  const mer = document.getElementById(prefix + '-meridiem').value;
  const en  = document.getElementById(prefix + '-enabled').checked;
  if (isNaN(h) || h < 1 || h > 12) throw new Error('Hour must be between 1 and 12');
  if (isNaN(m) || m < 0 || m > 59) throw new Error('Minutes must be between 0 and 59');
  return { hour: h, minute: m, meridiem: mer, enabled: en };
}

async function saveAttendanceTiming() {
  const status = document.getElementById('timing-status');
  let timing;
  try {
    timing = {
      first:  _readTimingSlot('autosave1'),
      second: _readTimingSlot('autosave2'),
    };
  } catch (e) {
    if (status) status.textContent = '⚠ ' + e.message;
    return;
  }

  const payload = {
    autosave1Hour:     timing.first.hour,
    autosave1Minute:   timing.first.minute,
    autosave1Meridiem: timing.first.meridiem,
    autosave1Enabled:  timing.first.enabled,
    autosave2Hour:     timing.second.hour,
    autosave2Minute:   timing.second.minute,
    autosave2Meridiem: timing.second.meridiem,
    autosave2Enabled:  timing.second.enabled,
  };

  try {
    const saved = await apiSaveTiming(payload);
    _serverSettings = saved;

    if (status) {
      status.textContent = '✓ Saved. Auto-save times updated.';
      setTimeout(() => (status.textContent = ''), 2500);
    }
    window.dispatchEvent(new CustomEvent('eduflow-attendance-timing-changed', { detail: timing }));
    if (typeof showToast === 'function') showToast('Attendance timings saved.', 'success');
  } catch (e) {
    if (status) status.textContent = '⚠ ' + e.message;
    if (typeof showToast === 'function') showToast('Could not save timings to the server.', 'error');
  }
}

// ── Scheduler ─────────────────────────────────────
function _to24Hour(hour, meridiem) {
  let h = hour % 12;
  if (meridiem === 'PM') h += 12;
  return h;
}
function _msUntil(hour24, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour24, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

let _attAutoSaveTimers = [];
function scheduleAttendanceAutoSaves() {
  _attAutoSaveTimers.forEach(clearTimeout);
  _attAutoSaveTimers = [];

  const t = loadAttendanceTiming();
  [['first', t.first], ['second', t.second]].forEach(([label, slot]) => {
    if (!slot.enabled) return;
    const h24 = _to24Hour(slot.hour, slot.meridiem);
    const delay = _msUntil(h24, slot.minute);
    const id = setTimeout(async function fire() {
      await runStaffAttendanceAutoSave(label, slot);
      // reschedule for next day
      _attAutoSaveTimers.push(setTimeout(fire, 24 * 60 * 60 * 1000));
    }, delay);
    _attAutoSaveTimers.push(id);
  });
}

async function runStaffAttendanceAutoSave(label, slot) {
  const today = new Date().toISOString().slice(0, 10);
  const snapshot = {
    date: today,
    slot: label,
    time: `${slot.hour}:${String(slot.minute).padStart(2, '0')} ${slot.meridiem}`,
    savedAt: new Date().toISOString(),
  };

  // Push to real database if endpoint configured
  if (ATTENDANCE_DB_ENDPOINT) {
    try {
      await fetch(ATTENDANCE_DB_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
    } catch (err) {
      console.warn('[Attendance] Auto-save network error:', err);
    }
  }
  console.log(`[Attendance] Auto-saved (${label}) at`, snapshot.time);
}

// Hook into DOM ready — render inputs and start schedulers
// NOTE: renderAttendanceTiming() is called from the main DOMContentLoaded
// handler above, after loadSettingsFromServer() resolves, so the Timing
// tab reflects the backend rather than a possibly-stale local cache.
//
// Actually *executing* the auto-save (clicking the real Save buttons and
// writing attendance to the database) still happens over in attendance.js,
// which reads this same 'edu_attendance_timing' localStorage key. That
// keeps a single source of truth: whatever time is saved here in Settings
// (to the backend, and mirrored to that key) is exactly what the
// Attendance page acts on.