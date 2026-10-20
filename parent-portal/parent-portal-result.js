// Parent Portal – Result page script
(function () {
  'use strict';

  // ---------- Redirect to index on page refresh ----------
  (function redirectOnRefresh() {
    const navEntries = performance.getEntriesByType && performance.getEntriesByType('navigation');
    const isReload = (navEntries && navEntries[0] && navEntries[0].type === 'reload')
      || (performance.navigation && performance.navigation.type === 1);
    if (isReload) {
      window.location.replace('parent-portal-index.html');
    }
  })();

  // ===================================================
  // Language
  // ===================================================
  const I18n = window.PortalI18n;
  if (I18n) I18n.apply();
  const tr = (key, fallback) => (I18n ? I18n.t(key) : fallback);
  const onScreen = (text) => (I18n ? I18n.iso(text) : text);

  // ===================================================
  // Student info (fallback defaults)
  // ===================================================
  const studentDefaults = {
    name: 'Aarav Sharma',
    regNumber: 'GH/2024/056',
    className: '5',
    section: 'B',
    classSection: '5 – B',
    photo: null
  };

  let studentData = studentDefaults;
  try {
    const saved = sessionStorage.getItem('studentData');
    if (saved) studentData = Object.assign({}, studentDefaults, JSON.parse(saved));
  } catch (e) { /* ignore */ }

  if (!studentData.classSection) {
    studentData.classSection = `${studentData.className || ''} – ${studentData.section || ''}`;
  }

  // ===================================================
  // Result data per session + term
  // ===================================================
  const RESULT_DATA = {
    '2025-2026': {
      'first-term': {
        subjects: [
          { name: 'Maths',     total: 100, obtained: 88 },
          { name: 'English',   total: 100, obtained: 85 },
          { name: 'Physics',   total: 100, obtained: 82 },
          { name: 'Chemistry', total: 100, obtained: 79 },
          { name: 'Biology',   total: 100, obtained: 90 },
          { name: 'Computer',  total: 100, obtained: 92 },
          { name: 'Urdu',      total: 100, obtained: 76 },
          { name: 'Islamiat',  total: 100, obtained: 88 }
        ]
      },
      'second-term': {
        subjects: [
          { name: 'Maths',     total: 100, obtained: 91 },
          { name: 'English',   total: 100, obtained: 88 },
          { name: 'Physics',   total: 100, obtained: 85 },
          { name: 'Chemistry', total: 100, obtained: 83 },
          { name: 'Biology',   total: 100, obtained: 92 },
          { name: 'Computer',  total: 100, obtained: 94 },
          { name: 'Urdu',      total: 100, obtained: 80 },
          { name: 'Islamiat',  total: 100, obtained: 90 }
        ]
      }
    },
    '2026-2027': {
      'first-term': {
        subjects: [
          { name: 'Maths',     total: 100, obtained: 93 },
          { name: 'English',   total: 100, obtained: 90 },
          { name: 'Physics',   total: 100, obtained: 88 },
          { name: 'Chemistry', total: 100, obtained: 86 },
          { name: 'Biology',   total: 100, obtained: 94 },
          { name: 'Computer',  total: 100, obtained: 96 },
          { name: 'Urdu',      total: 100, obtained: 84 },
          { name: 'Islamiat',  total: 100, obtained: 92 }
        ]
      },
      'second-term': {
        subjects: [
          { name: 'Maths',     total: 100, obtained: 95 },
          { name: 'English',   total: 100, obtained: 92 },
          { name: 'Physics',   total: 100, obtained: 90 },
          { name: 'Chemistry', total: 100, obtained: 89 },
          { name: 'Biology',   total: 100, obtained: 96 },
          { name: 'Computer',  total: 100, obtained: 98 },
          { name: 'Urdu',      total: 100, obtained: 86 },
          { name: 'Islamiat',  total: 100, obtained: 94 }
        ]
      }
    }
  };

  // ===================================================
  // Human-readable labels
  // ===================================================
  const SESSION_LABELS = {
    '2025-2026': '2025 – 2026',
    '2026-2027': '2026 – 2027'
  };

  const TERM_LABELS = {
    'first-term': 'First Term',
    'second-term': 'Second Term'
  };

  const TERM_KEYS = { 'first-term': 'firstTerm', 'second-term': 'secondTerm' };

  const SUBJECT_KEYS = {
    'Maths': 'subMaths', 'English': 'subEnglish', 'Physics': 'subPhysics',
    'Chemistry': 'subChemistry', 'Biology': 'subBiology', 'Computer': 'subComputer',
    'Urdu': 'subUrdu', 'Islamiat': 'subIslamiat'
  };
  function subjectLabel(name) {
    return SUBJECT_KEYS[name] ? tr(SUBJECT_KEYS[name], name) : name;
  }

  // ===================================================
  // Grade calculator
  // ===================================================
  function computeGrade(percent) {
    if (percent >= 90) return 'A+';
    if (percent >= 80) return 'A';
    if (percent >= 70) return 'B';
    if (percent >= 60) return 'C';
    if (percent >= 50) return 'D';
    if (percent >= 40) return 'E';
    return 'F';
  }

  // ===================================================
  // Remarks — returns { level, badge, text }
  // ===================================================
  function getRemarks(percent, name) {
    const student = name || tr('theStudent', 'The student');
    const fill = (key, fallback) => tr(key, fallback).split('{name}').join(student);

    if (percent >= 90) {
      return {
        level: 'excellent',
        badge: tr('badgeOutstanding', 'Outstanding'),
        text: fill('remarkExcellent', 'Excellent work, {name}! An outstanding performance across all subjects. Keep up this remarkable dedication and continue to shine.')
      };
    }
    if (percent >= 80) {
      return {
        level: 'very-good',
        badge: tr('badgeVeryGood', 'Very Good'),
        text: fill('remarkVeryGood', 'Very good performance, {name}. A strong and consistent result. A little more focus on weaker areas will take you to the top.')
      };
    }
    if (percent >= 70) {
      return {
        level: 'good',
        badge: tr('badgeGood', 'Good'),
        text: fill('remarkGood', 'Good effort, {name}. A solid result overall. Regular revision and consistent practice will help improve further.')
      };
    }
    if (percent >= 60) {
      return {
        level: 'fair',
        badge: tr('badgeSatisfactory', 'Satisfactory'),
        text: fill('remarkSatisfactory', 'A satisfactory result, {name}. There is room for improvement — focus more on daily study and homework to strengthen the weaker subjects.')
      };
    }
    if (percent >= 50) {
      return {
        level: 'needs-improvement',
        badge: tr('badgeNeedsImprovement', 'Needs Improvement'),
        text: fill('remarkNeedsImprovement', '{name} needs to put in more effort. Regular study habits, revision, and attention in class will help improve the overall performance.')
      };
    }
    if (percent >= 40) {
      return {
        level: 'needs-improvement',
        badge: tr('badgeBelowAverage', 'Below Average'),
        text: fill('remarkBelowAverage', "{name}'s performance is below the expected level. A structured study plan and additional support from teachers is strongly recommended.")
      };
    }
    return {
      level: 'weak',
      badge: tr('badgeUnsatisfactory', 'Unsatisfactory'),
      text: fill('remarkUnsatisfactory', '{name} requires urgent attention. Please meet the class teacher to discuss an improvement plan. Consistent guidance and daily practice are essential.')
    };
  }

  // ===================================================
  // Populate student header (name / reg / class)
  // ===================================================
  function populateStudentHeader() {
    const nameEl = document.getElementById('resultName');
    const regEl = document.getElementById('resultReg');
    const csEl = document.getElementById('resultClassSection');
    const photoEl = document.getElementById('resultPhoto');

    if (nameEl) nameEl.textContent = studentData.name || '—';
    if (regEl) regEl.textContent = studentData.regNumber || '—';
    if (csEl) csEl.textContent = studentData.classSection || '—';

    if (photoEl && studentData.photo) {
      photoEl.src = studentData.photo;
    }
    if (photoEl) {
      photoEl.alt = tr('photoAlt', "{name}'s photo").replace('{name}', studentData.name || 'Student');
    }
  }

  // ===================================================
  // Show / hide sections based on selection state
  // ===================================================
  function updateVisibilityState(session, term) {
    const promptEl = document.getElementById('resultPrompt');
    const cardEl = document.getElementById('resultCard');

    const bothSelected = Boolean(session) && Boolean(term);

    if (promptEl) promptEl.hidden = bothSelected;
    if (cardEl) cardEl.hidden = !bothSelected;

    return bothSelected;
  }

  // ===================================================
  // Render remarks block
  // ===================================================
  function renderRemarks(percent) {
    const badgeEl = document.getElementById('resultRemarksBadge');
    const textEl = document.getElementById('resultRemarksText');
    if (!badgeEl && !textEl) return;

    const remarks = getRemarks(percent, studentData.name || 'The student');

    if (badgeEl) {
      badgeEl.textContent = onScreen(remarks.badge);
      badgeEl.className = 'result-remarks-badge level-' + remarks.level;
    }
    if (textEl) {
      textEl.textContent = onScreen(remarks.text);
    }
  }

  // ===================================================
  // Render report card
  // ===================================================
  function renderResult() {
    const sessionEl = document.getElementById('resultSession');
    const termEl = document.getElementById('resultTerm');
    const tableBody = document.getElementById('resultTableBody');

    const session = sessionEl ? sessionEl.value : '';
    const term = termEl ? termEl.value : '';

    const bothSelected = updateVisibilityState(session, term);
    if (!bothSelected) return;

    // Update applied banner
    const appliedSessionEl = document.getElementById('resultAppliedSession');
    const appliedTermEl = document.getElementById('resultAppliedTerm');
    if (appliedSessionEl) appliedSessionEl.textContent = SESSION_LABELS[session] || session;
    if (appliedTermEl) appliedTermEl.textContent = onScreen(tr(TERM_KEYS[term], TERM_LABELS[term] || term));

    const sessionData = RESULT_DATA[session];
    const termData = sessionData ? sessionData[term] : null;

    if (!termData || !termData.subjects || termData.subjects.length === 0) {
      if (tableBody) {
        tableBody.innerHTML = `
          <div class="result-row" style="grid-template-columns:1fr;text-align:center;color:#98A8AD;font-weight:600;">
            ${escapeHtml(onScreen(tr('noSubjectData', 'No subject data available.')))}
          </div>
        `;
      }
      ['resultTotalMarks', 'resultTotalObtained', 'resultTotalPercent',
       'resultOverallPercent', 'resultOverallGrade'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
      });
      renderRemarks(0);
      return;
    }

    // Build subject rows
    if (tableBody) {
      tableBody.innerHTML = '';

      let totalMarks = 0;
      let totalObtained = 0;

      termData.subjects.forEach((subject) => {
        totalMarks += Number(subject.total) || 0;
        totalObtained += Number(subject.obtained) || 0;

        const percent = subject.total > 0
          ? (subject.obtained / subject.total) * 100
          : 0;
        const percentRounded = Math.round(percent * 10) / 10;

        const row = document.createElement('div');
        row.className = 'result-row';
        row.innerHTML = `
          <span class="result-subject">${escapeHtml(onScreen(subjectLabel(subject.name)))}</span>
          <span class="result-cell">${subject.total}</span>
          <span class="result-cell result-cell-obtained">${subject.obtained}</span>
          <span class="result-cell result-cell-percent">
            <span class="result-percent-pill${percentRounded < 60 ? ' low' : ''}">${percentRounded}%</span>
          </span>
        `;
        tableBody.appendChild(row);
      });

      // Totals
      const overallPercent = totalMarks > 0
        ? (totalObtained / totalMarks) * 100
        : 0;
      const overallPercentRounded = Math.round(overallPercent * 10) / 10;

      const totalMarksEl = document.getElementById('resultTotalMarks');
      const totalObtainedEl = document.getElementById('resultTotalObtained');
      const totalPercentEl = document.getElementById('resultTotalPercent');
      const overallPercentEl = document.getElementById('resultOverallPercent');
      const overallGradeEl = document.getElementById('resultOverallGrade');

      if (totalMarksEl) totalMarksEl.textContent = totalMarks;
      if (totalObtainedEl) totalObtainedEl.textContent = totalObtained;
      if (totalPercentEl) totalPercentEl.textContent = `${overallPercentRounded}%`;
      if (overallPercentEl) overallPercentEl.textContent = `${overallPercentRounded}%`;
      if (overallGradeEl) overallGradeEl.textContent = computeGrade(overallPercentRounded);

      // Remarks based on overall percentage
      renderRemarks(overallPercentRounded);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===================================================
  // Filter wiring
  // ===================================================
  function initFilters() {
    const sessionEl = document.getElementById('resultSession');
    const termEl = document.getElementById('resultTerm');

    if (sessionEl) sessionEl.addEventListener('change', renderResult);
    if (termEl) termEl.addEventListener('change', renderResult);
  }

  // ===================================================
  // Drawer
  // ===================================================
  function openDrawer(drawer, overlay, hamburger) {
    drawer.classList.add('open');
    overlay.classList.add('active');
    drawer.setAttribute('aria-hidden', 'false');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer(drawer, overlay, hamburger) {
    drawer.classList.remove('open');
    overlay.classList.remove('active');
    drawer.setAttribute('aria-hidden', 'true');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function handleDrawerAction(action) {
    switch (action) {
      case 'change-password':
        window.location.href = 'parent-portal-change-password.html';
        break;
      case 'settings':
        window.location.href = 'parent-portal-settings.html';
        break;
      case 'info':            console.log('→ Info'); break;
      case 'demo-videos':     console.log('→ Demo Videos'); break;
      case 'submit-feedback':
        window.location.href = 'parent-portal-feedback.html';
        break;
      case 'logout':
        if (window.confirm(tr('logoutConfirm', 'Are you sure you want to logout?'))) {
          try { sessionStorage.clear(); } catch (e) {}
          console.log('→ Logged out');
        }
        break;
      default: console.warn('Unknown drawer action:', action);
    }
  }

  function initDrawer() {
    const hamburger = document.getElementById('hamburgerBtn');
    const drawer = document.getElementById('sidePanel');
    const overlay = document.getElementById('sidePanelOverlay');
    const closeBtn = document.getElementById('sidePanelClose');
    if (!drawer || !overlay) return;

    if (hamburger) hamburger.addEventListener('click', () => openDrawer(drawer, overlay, hamburger));
    if (closeBtn) closeBtn.addEventListener('click', () => closeDrawer(drawer, overlay, hamburger));
    overlay.addEventListener('click', () => closeDrawer(drawer, overlay, hamburger));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) {
        closeDrawer(drawer, overlay, hamburger);
      }
    });

    drawer.querySelectorAll('.drawer-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        handleDrawerAction(link.dataset.action);
        closeDrawer(drawer, overlay, hamburger);
      });
    });
  }

  // ===================================================
  // Boot
  // ===================================================
  function boot() {
    populateStudentHeader();
    initFilters();
    initDrawer();
    updateVisibilityState('', '');
    console.log('Result page ready — awaiting filter selection.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();