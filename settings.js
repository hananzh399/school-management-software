// ═══════════════════════════════════════════════
//  EduFlow Pro — Admin Settings
//  settings.js  (updated: dark mode + attendance link)
// ═══════════════════════════════════════════════

const CLASSES_KEY     = 'edu_class_configs';
const LATEFEE_KEY     = 'edu_latefee_config';
const TEACHERS_KEY    = 'edu_teacher_configs';
const NONTEACHING_KEY = 'edu_nonteaching_configs';
const VARIABLES_KEY   = 'edu_pay_variables';

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

const CLASS_ICONS  = ['fa-chalkboard','fa-book','fa-pencil-alt','fa-star','fa-medal','fa-award','fa-graduation-cap','fa-bookmark'];
const CLASS_COLORS = ['#1a9e6e','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#06b6d4'];

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
 * Reads saved staff attendance records from localStorage (written by attendance.js)
 * and counts absent days for a given staff member in the current month.
 * Key format: eduflow_staff_att_YYYY-MM-DD
 */
function getAbsentDaysThisMonth(staffId) {
  const now = new Date();
  const month = now.getMonth();
  const year  = now.getFullYear();
  let count = 0;

  for (let key in localStorage) {
    if (!key.startsWith('eduflow_staff_att_')) continue;
    const dateStr = key.replace('eduflow_staff_att_', '');
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;
    if (d.getMonth() !== month || d.getFullYear() !== year) continue;

    try {
      const payload = JSON.parse(localStorage.getItem(key));
      if (payload && payload.records && payload.records[staffId]) {
        if (payload.records[staffId].status === 'absent') count++;
      }
    } catch (e) { /* skip */ }
  }
  return count;
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
document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  loadClasses();
  loadLateFee();
  loadTeachers();
  loadNonTeaching();
  updateStaffCounts();
  loadVariables();
  wirePayVariableLiveSync();
  syncCardsFromVariables();

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
  const saved = JSON.parse(localStorage.getItem(CLASSES_KEY)) || DEFAULT_CLASSES;
  const grid  = document.getElementById('class-grid');
  grid.innerHTML = '';
  saved.forEach(c => appendClassCard(c.name, c.fee, c.fund, false, c.sections || []));
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
//  LATE FEE
// ═══════════════════════════════════════════════
function loadLateFee() {
  const saved = JSON.parse(localStorage.getItem(LATEFEE_KEY)) || DEFAULT_LATEFEE;

  document.getElementById('latefee-enabled').checked    = saved.enabled !== false;
  document.getElementById('latefee-deadline-day').value = saved.deadlineDay;
  document.getElementById('latefee-type').value         = saved.type;
  document.getElementById('latefee-amount').value       = saved.amount;
  document.getElementById('latefee-grace').value        = saved.grace;

  applyLateFeeToggle(saved.enabled !== false);
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

  const saved = JSON.parse(localStorage.getItem(TEACHERS_KEY)) || DEFAULT_TEACHERS;
  saved.forEach(t => appendTeacherCard(t, false));
}

window.addEventListener('storage', (e) => {
  if (e.key && e.key.toLowerCase().includes('staff')) {
    if (document.getElementById('teacher-grid')) loadTeachers();
  }
});

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
  return JSON.parse(localStorage.getItem(VARIABLES_KEY)) || DEFAULT_VARIABLES;
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
  localStorage.setItem(VARIABLES_KEY, JSON.stringify(vars));
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
//  SAVE ALL
// ═══════════════════════════════════════════════
function saveAll() {
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
  localStorage.setItem(CLASSES_KEY, JSON.stringify(classes));

  // — Late Fee —
  const lateFee = {
    enabled:     document.getElementById('latefee-enabled').checked,
    deadlineDay: parseInt(document.getElementById('latefee-deadline-day').value, 10) || 0,
    type:        document.getElementById('latefee-type').value,
    amount:      parseFloat(document.getElementById('latefee-amount').value) || 0,
    grace:       parseInt(document.getElementById('latefee-grace').value, 10) || 0,
  };
  localStorage.setItem(LATEFEE_KEY, JSON.stringify(lateFee));

  // — Teachers —
  const teacherCards  = document.querySelectorAll('#teacher-grid .teacher-card');
  const teachers      = [];
  const sharedList    = getSharedTeachers();
  const sharedById    = {};
  if (sharedList) sharedList.forEach(s => { sharedById[s.id] = s; });
  const updatedShared = [];

  teacherCards.forEach(card => {
    const name  = card.querySelector('.teacher-name-input').value.trim();
    const subj  = card.querySelector('.teacher-subject-input').value.trim();
    const sal   = parseFloat(card.querySelector('.teacher-salary').value)        || 0;
    const ptype = card.querySelector('.teacher-penalty-type').value;
    const pval  = parseFloat(card.querySelector('.teacher-penalty-value').value) || 0;
    const bon   = parseFloat(card.querySelector('.teacher-bonus').value)         || 0;
    if (!name) return;

    const ptCust = card.dataset.penaltyTypeCustom === '1';
    const pvCust = card.dataset.penaltyValueCustom === '1';
    const bnCust = card.dataset.bonusCustom === '1';
    teachers.push({
      name, subject: subj, salary: sal,
      penaltyType:  ptCust ? ptype : null,
      penaltyValue: pvCust ? pval  : null,
      bonus:        bnCust ? bon   : null,
    });

    if (sharedList) {
      const staffId = card.dataset.staffId;
      const base = (staffId && sharedById[staffId]) ? sharedById[staffId] : {
        id: 'TCH-' + Math.floor(1000 + Math.random() * 9000),
        qualification: '', classes: '', incharge: '',
        gender: 'Other', joined: new Date().toISOString().slice(0, 10),
        cnic: '', phone: '', address: '', fines: 0,
        securityTotal: 0, securityMonthly: 0, securityCollected: 0,
      };
      updatedShared.push({
        ...base,
        name,
        subjects: subj,
        type: 'Teaching',
        salary: sal,
        penaltyType:  ptCust ? ptype : null,
        penaltyValue: pvCust ? pval  : null,
        bonus:        bnCust ? bon   : null,
      });
    }
  });
  localStorage.setItem(TEACHERS_KEY, JSON.stringify(teachers));
  if (sharedList) setSharedTeachers(updatedShared);

  // — Non-Teaching Staff —
  saveNonTeaching();

  // — Variables —
  const vars = {
    penaltyType:  document.getElementById('var-penalty-type').value,
    penaltyValue: parseFloat(document.getElementById('var-penalty-value').value) || 0,
    bonus:        parseFloat(document.getElementById('var-bonus').value)          || 0,
  };
  localStorage.setItem(VARIABLES_KEY, JSON.stringify(vars));

  showBadge();
  showToast('All configurations saved successfully.', 'success');
}

// ═══════════════════════════════════════════════
//  RESET
// ═══════════════════════════════════════════════
function resetSettings() {
  if (!confirm('Reset all settings to defaults?')) return;
  localStorage.removeItem(CLASSES_KEY);
  localStorage.removeItem(LATEFEE_KEY);
  localStorage.removeItem(TEACHERS_KEY);
  localStorage.removeItem(NONTEACHING_KEY);
  localStorage.removeItem(VARIABLES_KEY);
  loadClasses();
  loadLateFee();
  loadTeachers();
  loadNonTeaching();
  loadVariables();
  updateStaffCounts();
  showToast('Settings reset to defaults.', 'success');
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

  const saved = JSON.parse(localStorage.getItem(NONTEACHING_KEY)) || DEFAULT_NONTEACHING;
  saved.forEach(t => appendNonTeachingCard(t, false));
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
  localStorage.setItem(NONTEACHING_KEY, JSON.stringify(list));
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
  try {
    const saved = JSON.parse(localStorage.getItem(ATT_TIMING_KEY) || '{}');
    return {
      first:  Object.assign({}, DEFAULT_ATT_TIMING.first,  saved.first  || {}),
      second: Object.assign({}, DEFAULT_ATT_TIMING.second, saved.second || {}),
    };
  } catch { return DEFAULT_ATT_TIMING; }
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

function saveAttendanceTiming() {
  const status = document.getElementById('timing-status');
  try {
    const timing = {
      first:  _readTimingSlot('autosave1'),
      second: _readTimingSlot('autosave2'),
    };
    localStorage.setItem(ATT_TIMING_KEY, JSON.stringify(timing));
    if (status) {
      status.textContent = '✓ Saved. Auto-save times updated.';
      setTimeout(() => (status.textContent = ''), 2500);
    }
    // The Attendance page (attendance.js) is what actually clicks the real
    // Save buttons at the configured time. Tell it right away — via a
    // same-tab custom event, and via the native 'storage' event for any
    // other open tab — so the new time takes effect immediately instead of
    // waiting for its next periodic check.
    window.dispatchEvent(new CustomEvent('eduflow-attendance-timing-changed', { detail: timing }));
    if (typeof showToast === 'function') showToast('Attendance timings saved.', 'success');
  } catch (e) {
    if (status) status.textContent = '⚠ ' + e.message;
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
  const db = JSON.parse(localStorage.getItem('eduflow-db') || '{}');
  const today = new Date().toISOString().slice(0, 10);

  const snapshot = {
    date: today,
    slot: label,                    // 'first' | 'second'
    time: `${slot.hour}:${String(slot.minute).padStart(2, '0')} ${slot.meridiem}`,
    savedAt: new Date().toISOString(),
    staff: (db.attendance && db.attendance.staff && db.attendance.staff[today]) || [],
  };

  // 1) Persist locally
  db.attendance = db.attendance || {};
  db.attendance.autoSaves = db.attendance.autoSaves || [];
  db.attendance.autoSaves.push(snapshot);
  localStorage.setItem('eduflow-db', JSON.stringify(db));

  // 2) Push to real database if endpoint configured
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
document.addEventListener('DOMContentLoaded', () => {
  renderAttendanceTiming();
  // NOTE: actually *executing* the auto-save (clicking the real Save
  // buttons and writing attendance to the database) now happens over in
  // attendance.js, which reads this same ATT_TIMING_KEY
  // ('edu_attendance_timing') value. That keeps a single source of truth:
  // whatever time is set here in Settings is exactly what the Attendance
  // page acts on.
});
