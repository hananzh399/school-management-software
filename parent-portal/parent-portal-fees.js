// Parent Portal – Fee & Bills page script
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
  const isUrdu = () => !!I18n && I18n.getLang() === 'ur';

  // ===================================================
  // Mock data
  // ===================================================
  const CURRENT_MONTH_FEE = { challan: '—', monthLabel: '', issueDate: '', dueDate: '', tuition: 0,
    totalWithinDue: 0, totalAfterDue: 0, paidAmount: 0, status: 'paid', empty: true };
  const FEE_HISTORY = [];

  // Real data from the school: newest billed month first; the rest is the history.
  async function loadData() {
    const d = await PortalAPI.get(PortalAPI.forChild('/fees'));
    const map = (f) => ({
      challan: f.challan, monthLabel: f.monthLabel,
      issueDate: PortalAPI.fmtDate(f.issueDate), dueDate: PortalAPI.fmtDate(f.dueDate),
      tuition: f.tuition, totalWithinDue: f.totalWithinDue, totalAfterDue: f.totalAfterDue,
      paidAmount: f.paidAmount, status: f.status, empty: false
    });
    FEE_HISTORY.length = 0;
    const list = (d && d.fees) || [];
    if (list.length) {
      Object.assign(CURRENT_MONTH_FEE, map(list[0]));
      list.slice(1).forEach((f) => FEE_HISTORY.push(map(f)));
    }
  }

  // ===================================================
  // Helpers
  // ===================================================
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMoney(n) {
    return 'Rs ' + Number(n).toLocaleString('en-PK');
  }

  function statusLabel(status) {
    switch (status) {
      case 'paid':    return tr('statusPaid', 'Paid');
      case 'due':     return tr('statusPending', 'Pending');
      case 'overdue': return tr('statusOverdue', 'Overdue');
      default:        return status;
    }
  }

  const EN_SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const EN_FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // "01 Oct 2026" -> same in English, translated month name in Urdu
  function localDate(str) {
    if (!I18n || !isUrdu()) return str;
    const m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(str || '');
    const idx = m ? EN_SHORT_MONTHS.indexOf(m[2]) : -1;
    if (idx < 0) return str;
    return onScreen(`${m[1]} ${I18n.monthShort(idx)} ${m[3]}`);
  }

  // "October 2026" -> same in English, "اکتوبر 2026" in Urdu
  function localMonth(str) {
    if (!I18n || !isUrdu()) return str;
    const m = /^([A-Za-z]+) (\d{4})$/.exec(str || '');
    const idx = m ? EN_FULL_MONTHS.indexOf(m[1]) : -1;
    if (idx < 0) return str;
    return I18n.formatMonth(`${m[2]}-${String(idx + 1).padStart(2, '0')}`);
  }

  function monthsText(n) {
    return onScreen(tr(n === 1 ? 'monthsOne' : 'monthsMany', n === 1 ? '{n} month' : '{n} months').replace('{n}', String(n)));
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el && value != null) el.textContent = value;
  }

  // ===================================================
  // Overall summary
  // ===================================================
  function computeOverall() {
    const all = [CURRENT_MONTH_FEE].concat(FEE_HISTORY);

    let totalBilled = 0;
    let totalPaid = 0;

    all.forEach((fee) => {
      totalBilled += Number(fee.totalWithinDue) || 0;
      totalPaid += Number(fee.paidAmount) || 0;
    });

    return {
      billed: totalBilled,
      paid: totalPaid,
      due: totalBilled - totalPaid
    };
  }

  function renderOverall() {
    const { billed, paid, due } = computeOverall();
    setText('feesOverallBilled', formatMoney(billed));
    setText('feesOverallPaid', formatMoney(paid));
    setText('feesOverallDue', formatMoney(due));
  }

  // ===================================================
  // Current month render
  // ===================================================
  function renderFee() {
    const fee = CURRENT_MONTH_FEE;

    if (fee.empty) {   // the school has not issued any fee voucher yet
      setText('feesMonthLabel', onScreen(tr('noFeeYet', 'No fee voucher issued yet')));
      setText('feeChallan', '—'); setText('feeIssueDate', '—'); setText('feeDueDate', '—');
      const tb = document.getElementById('feeTableBody'); if (tb) tb.innerHTML = '';
      const bd = document.getElementById('feesStatusBadge'); if (bd) bd.innerHTML = '';
      const pb = document.getElementById('feesPayNowBtn'); if (pb) pb.disabled = true;
      return;
    }

    setText('feesMonthLabel', localMonth(fee.monthLabel));
    setText('feeChallan', fee.challan);
    setText('feeIssueDate', localDate(fee.issueDate));
    setText('feeDueDate', localDate(fee.dueDate));

    const badge = document.getElementById('feesStatusBadge');
    if (badge) {
      badge.className = 'fee-status-badge status-' + fee.status;
      badge.innerHTML = `<span>${escapeHtml(onScreen(statusLabel(fee.status)))}</span>`;
    }

    const tbody = document.getElementById('feeTableBody');
    if (tbody) {
      tbody.innerHTML = `
        <tr class="fee-row-tuition">
          <td class="fee-cell-label">${escapeHtml(onScreen(tr('tuitionFee', 'Tuition Fee')))}</td>
          <td class="fee-cell-value">${formatMoney(fee.tuition)}</td>
        </tr>

        <tr class="fee-row-dues">
          <td class="fee-cell-label">${escapeHtml(onScreen(tr('paymentTotal', 'Payment Total')))}</td>
          <td class="fee-cell-value">
            <div class="fee-dues-wrap">
              <div class="fee-dues-block fee-dues-within">
                <span class="fee-dues-block-label">${escapeHtml(onScreen(tr('withinDue', 'Within Due')))}</span>
                <span class="fee-dues-block-value">${formatMoney(fee.totalWithinDue)}</span>
              </div>
              <div class="fee-dues-block fee-dues-after">
                <span class="fee-dues-block-label">${escapeHtml(onScreen(tr('afterDue', 'After Due')))}</span>
                <span class="fee-dues-block-value">${formatMoney(fee.totalAfterDue)}</span>
              </div>
            </div>
          </td>
        </tr>
      `;
    }

    // Pay Now button context (subtitle + enabled/disabled state)
    const payBtn = document.getElementById('feesPayNowBtn');
    const paySub = document.getElementById('feesPayAmountSub');
    if (payBtn) {
      if (fee.status === 'paid') {
        payBtn.disabled = true;
        if (paySub) paySub.textContent = onScreen(tr('alreadyPaid', 'Already paid for this month'));
      } else {
        payBtn.disabled = false;
        if (paySub) {
          paySub.textContent = onScreen(tr('payWithinDue', 'Pay {amount} within due date').replace('{amount}', formatMoney(fee.totalWithinDue)));
        }
      }
    }
  }

  // ===================================================
  // Fee History render
  // ===================================================
  function renderHistory() {
    const listEl = document.getElementById('feesHistoryList');
    if (!listEl) return;

    listEl.innerHTML = '';

    let totalPaid = 0;
    let totalDue = 0;
    let paidMonths = 0;
    let dueMonths = 0;

    FEE_HISTORY.forEach((fee) => {
      const paid = Number(fee.paidAmount) || 0;
      const dueAmount = Math.max(0, (Number(fee.totalWithinDue) || 0) - paid);

      totalPaid += paid;
      totalDue += dueAmount;

      if (fee.status === 'paid' || (paid >= (Number(fee.totalWithinDue) || 0) && paid > 0)) {
        paidMonths++;
      } else {
        dueMonths++;
      }
    });

    setText('historyTotalPaid', formatMoney(totalPaid));
    setText('historyTotalDue', formatMoney(totalDue));
    setText('historyPaidMonths', monthsText(paidMonths));
    setText('historyDueMonths', monthsText(dueMonths));

    // Subtitle on the history button inside the Overall Summary card
    setText(
      'feesHistoryBtnSub',
      onScreen(totalDue > 0
        ? tr('outstandingAmount', 'Outstanding: {amount}').replace('{amount}', formatMoney(totalDue))
        : tr('allDuesCleared', 'All dues cleared'))
    );

    FEE_HISTORY.forEach((fee) => {
      const paid = Number(fee.paidAmount) || 0;
      const dueAmount = Math.max(0, (Number(fee.totalWithinDue) || 0) - paid);

      const card = document.createElement('article');
      card.className = 'fee-history-card status-' + fee.status;

      const isPaid = fee.status === 'paid' || dueAmount === 0;

      card.innerHTML = `
        <div class="fee-history-head">
          <div class="fee-history-head-left">
            <span class="fee-history-month">${escapeHtml(localMonth(fee.monthLabel))}</span>
            <span class="fee-history-challan">${escapeHtml(fee.challan)}</span>
          </div>
          <span class="fee-status-badge status-${fee.status}">
            <span>${escapeHtml(onScreen(statusLabel(fee.status)))}</span>
          </span>
        </div>

        <div class="fee-history-detail-grid">
          <div class="fee-history-detail">
            <span class="fee-history-detail-label">${escapeHtml(onScreen(tr('issueDate', 'Issue Date')))}</span>
            <span class="fee-history-detail-value">${escapeHtml(localDate(fee.issueDate))}</span>
          </div>
          <div class="fee-history-detail">
            <span class="fee-history-detail-label">${escapeHtml(onScreen(tr('dueDate', 'Due Date')))}</span>
            <span class="fee-history-detail-value">${escapeHtml(localDate(fee.dueDate))}</span>
          </div>
          <div class="fee-history-detail">
            <span class="fee-history-detail-label">${escapeHtml(onScreen(tr('tuitionFee', 'Tuition Fee')))}</span>
            <span class="fee-history-detail-value">${formatMoney(fee.tuition)}</span>
          </div>
          <div class="fee-history-detail">
            <span class="fee-history-detail-label">${escapeHtml(onScreen(tr('totalWithinDue', 'Total (Within Due)')))}</span>
            <span class="fee-history-detail-value">${formatMoney(fee.totalWithinDue)}</span>
          </div>
        </div>

        <div class="fee-history-amounts">
          <div class="fee-history-amount ${isPaid ? 'fee-history-amount-paid' : 'fee-history-amount-neutral'}">
            <span class="fee-history-amount-label">${escapeHtml(onScreen(tr('statusPaid', 'Paid')))}</span>
            <span class="fee-history-amount-value">${formatMoney(paid)}</span>
          </div>
          <div class="fee-history-amount ${dueAmount > 0 ? 'fee-history-amount-due' : 'fee-history-amount-paid'}">
            <span class="fee-history-amount-label">${escapeHtml(onScreen(tr('dueLabel', 'Due')))}</span>
            <span class="fee-history-amount-value">${formatMoney(dueAmount)}</span>
          </div>
        </div>
      `;

      listEl.appendChild(card);
    });
  }

  // ===================================================
  // View switching
  // ===================================================
  // The page scrolls inside .app-content (not the window) in this layout
  function scrollViewToTop() {
    const scroller = document.querySelector('.app-content');
    if (scroller && scroller.scrollTo) scroller.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showCurrentView() {
    const current = document.getElementById('feesViewCurrent');
    const history = document.getElementById('feesViewHistory');
    if (current) current.hidden = false;
    if (history) history.hidden = true;
    scrollViewToTop();
  }

  function showHistoryView() {
    const current = document.getElementById('feesViewCurrent');
    const history = document.getElementById('feesViewHistory');
    if (current) current.hidden = true;
    if (history) history.hidden = false;
    scrollViewToTop();
  }

  function initViewToggles() {
    const historyBtn = document.getElementById('feesHistoryBtn');
    const backBtn = document.getElementById('feesBackBtn');

    if (historyBtn) historyBtn.addEventListener('click', showHistoryView);
    if (backBtn) backBtn.addEventListener('click', showCurrentView);
  }

  // ===================================================
  // Pay Now
  // ===================================================
  function initPayNow() {
    const payBtn = document.getElementById('feesPayNowBtn');
    if (!payBtn) return;

    payBtn.addEventListener('click', () => {
      const fee = CURRENT_MONTH_FEE;

      if (fee.status === 'paid') return;

      // Demo confirmation — replace with real payment flow
      const amountText = formatMoney(fee.totalWithinDue);
      const monthPlain = isUrdu() ? localMonth(fee.monthLabel).replace(/[\u2066-\u2069]/g, '') : fee.monthLabel;
      const duePlain = isUrdu() ? localDate(fee.dueDate).replace(/[\u2066-\u2069]/g, '') : fee.dueDate;
      const ok = window.confirm(
        tr('confirmPay', 'Proceed to pay {amount} for {month}?')
          .replace('{amount}', amountText).replace('{month}', monthPlain) + '\n\n' +
        `${tr('challanLine', 'Challan')}: ${fee.challan}\n` +
        `${tr('dueDate', 'Due Date')}: ${duePlain}`
      );

      if (ok) {
        // Placeholder — in a real app, redirect to payment gateway
        console.log('→ Pay Now clicked for', fee.challan, amountText);
        alert(tr('gatewayAlert', 'Payment gateway would open here (demo).'));
      }
    });
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
  async function boot() {
    try { await loadData(); } catch (err) { PortalAPI.showError(err); }
    renderOverall();
    renderFee();
    renderHistory();
    initViewToggles();
    initPayNow();
    initDrawer();
    console.log('Fee & Bills page ready.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();