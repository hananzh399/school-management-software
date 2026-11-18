/*
 * Settings > WhatsApp > fee message boxes: "Codes" button.
 * Adds a Codes button above the Fee voucher / Fee reminder message boxes. Clicking it opens a popup in
 * the centre of the page listing every heading and its code; "Insert" puts the code into the message
 * at the cursor. The Style buttons wrap the selected words in *{b}*...*{/b}* (bold), {i} (italic) or {s}
 * (strikethrough) tags. The backend (WhatsAppService.fillCodes) replaces each %[code]% with the real value.
 *
 * Works on: Fee voucher + Fee reminder (fee codes AND student codes), Absent message and the message to
 * parents (student codes only). Any other textarea can opt in with data-wa-codes-for="student" or "fee,student".
 * The student codes are filled by WhatsAppService.render() for every message type.
 */
(function () {
  'use strict';

  // Codes that exist for every message: filled from the student record.
  var STUDENT_CODES = [
    { heading: 'Student Name',  code: 'stName' },
    { heading: 'Class',         code: 'stClass' },
    { heading: 'Section',       code: 'stSection' },
    { heading: 'Guardian Name', code: 'grdName' },
    { heading: 'Reg. Number',   code: 'regNo' },
    { heading: 'Date (today)',  code: 'date' }
  ];

  var FEE_CODES = [
    { heading: 'Student Name',        code: 'stName' },
    { heading: 'Fee Month',           code: 'feeMonth' },
    { heading: 'Due Date',            code: 'dueDate' },
    { heading: 'Tuition/Monthly Fee', code: 'tutionFee' },
    { heading: 'Arrears',             code: 'arr' },
    { heading: 'Transport Fee',       code: 'transportFee' },
    { heading: 'Total Discount',      code: 'ttlDisc' },
    { heading: 'Other Fees',          code: 'otherFee' },
    { heading: 'Fine',                code: 'fine' },
    { heading: 'Total Fee',           code: 'ttlFee' },
    { heading: 'Within Due Date',     code: 'winDue' },
    { heading: 'After Due Date',      code: 'AfDue' }
  ];

  // Formatting tags. The backend (WhatsAppService.applyFormatting) turns them into WhatsApp bold / italic / strike.
  var FORMATS = [
    { label: 'Bold',          key: 'b', sample: 'Fee Month' },
    { label: 'Italic',        key: 'i', sample: 'Fee Month' },
    { label: 'Strikethrough', key: 's', sample: 'Fee Month' }
  ];

  // textarea id -> which code sets it offers. The ids must match the textareas in settings.html;
  // a textarea can also opt in itself with  data-wa-codes-for="student"  (see init()).
  var TARGETS = [
    { id: 'wa-voucher-tpl',  sets: ['fee', 'student'] },
    { id: 'wa-reminder-tpl', sets: ['fee', 'student'] },
    { id: 'wa-absent-tpl',   sets: ['student'] },
    { id: 'wa-broadcast-tpl', sets: ['student'] },
    { id: 'wa-broadcast-msg', sets: ['student'] }
  ];

  var SAMPLES = {
    student: 'Dear %[grdName]%,*{nL}*Your child %[stName]% (Class %[stClass]%-%[stSection]%, Reg# %[regNo]%) was absent on %[date]%.'
  };

  function codesFor(sets) {
    var seen = {}, out = [];
    (sets.indexOf('fee') >= 0 ? FEE_CODES.concat(STUDENT_CODES) : STUDENT_CODES).forEach(function (r) {
      if (!seen[r.code]) { seen[r.code] = 1; out.push(r); }
    });
    // fee boxes list the fee codes first, student codes after; student-only boxes just the student codes
    return out;
  }


  function tag(c) { return '%[' + c + ']%'; }

  function sampleTemplate(sets) {
    if (sets.indexOf('fee') >= 0) {
      return FEE_CODES.map(function (r) { return r.heading + ' : ' + tag(r.code); }).join('\n');
    }
    return SAMPLES.student.replace(/\*\{nL\}\*/g, '\n');
  }

  var overlay, status, activeBox, activeSets = ['fee', 'student'], lastFocus, listEl;

  function el(name, cls, text) {
    var n = document.createElement(name);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function say(msg) { if (status) status.textContent = msg || ''; }

  function build() {
    overlay = el('div', 'wa-codes-overlay');
    overlay.setAttribute('hidden', '');
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });

    var box = el('div', 'wa-codes-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'wa-codes-title');

    var head = el('div', 'wa-codes-head');
    var title = el('h3', null, 'Message codes');
    title.id = 'wa-codes-title';
    var x = el('button', 'wa-codes-x', '\u00D7');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', close);
    head.appendChild(title);
    head.appendChild(x);

    var intro = el('p', 'wa-codes-intro',
      'Write your message, then put a code where the value should appear. ' +
      'Each code is replaced with the real detail of the student when the message is sent.');

    var fmt = el('div', 'wa-codes-fmt');
    fmt.appendChild(el('span', 'wa-codes-fmt-label', 'Style text:'));
    FORMATS.forEach(function (f) {
      var fb = el('button', 'wa-codes-insert wa-codes-fmt-btn', f.label);
      fb.setAttribute('dir', 'ltr');
      fb.type = 'button';
      fb.title = '*{' + f.key + '}*' + f.sample + '*{/' + f.key + '}*';
      fb.addEventListener('click', function () { wrap(f.key); });
      fmt.appendChild(fb);
    });
    var nlb = el('button', 'wa-codes-insert wa-codes-fmt-btn', 'New line');
    nlb.type = 'button';
    nlb.title = 'Inserts *{nL}* \u2013 the message continues on the next line';
    nlb.addEventListener('click', function () { insert('*{nL}*'); });
    fmt.appendChild(nlb);
    var fmtHelp = el('p', 'wa-codes-intro wa-codes-fmt-help',
      'Select the words in the message and press a style button, or type the tags yourself, e.g. ' +
      '*{b}*Fee Month*{/b}* shows as bold in WhatsApp. ' +
      'Put *{nL}* at the end of a line to continue on the next line.');

    var table = el('div', 'wa-codes-list');
    listEl = table;

    var foot = el('div', 'wa-codes-foot');
    status = el('span', 'wa-codes-status');
    status.setAttribute('aria-live', 'polite');
    var sample = el('button', 'wa-codes-sample', 'Use sample template');
    sample.type = 'button';
    sample.addEventListener('click', useSample);
    var done = el('button', 'wa-codes-done', 'Done');
    done.type = 'button';
    done.addEventListener('click', close);
    foot.appendChild(status);
    foot.appendChild(sample);
    foot.appendChild(done);

    box.appendChild(head);
    box.appendChild(intro);
    box.appendChild(fmt);
    box.appendChild(fmtHelp);
    box.appendChild(table);
    box.appendChild(foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && !overlay.hasAttribute('hidden')) close();
    });
  }

  // (Re)fills the code list for the message box that was opened.
  function renderRows() {
    listEl.innerHTML = '';
    var hr = el('div', 'wa-codes-row wa-codes-row-h');
    hr.appendChild(el('span', null, 'Heading'));
    hr.appendChild(el('span', null, 'Code'));
    hr.appendChild(el('span', null, ''));
    listEl.appendChild(hr);
    codesFor(activeSets).forEach(function (r) {
      var row = el('div', 'wa-codes-row');
      row.appendChild(el('span', 'wa-codes-name', r.heading));
      var cd = el('code', 'wa-codes-code', tag(r.code));
      cd.setAttribute('dir', 'ltr');   // keep %[code]% readable even if the page/browser is RTL
      row.appendChild(cd);
      var b = el('button', 'wa-codes-insert', 'Insert');
      b.type = 'button';
      b.addEventListener('click', function () { insert(tag(r.code)); });
      row.appendChild(b);
      listEl.appendChild(row);
    });
  }

  function open(textareaId, sets) {
    activeBox = document.getElementById(textareaId);
    if (!activeBox) return;
    activeSets = sets;
    if (!overlay) build();
    renderRows();
    lastFocus = document.activeElement;
    say('');
    overlay.removeAttribute('hidden');
    document.body.classList.add('wa-codes-lock');
    var first = overlay.querySelector('.wa-codes-insert');
    if (first) first.focus();
  }

  function close() {
    if (!overlay) return;
    overlay.setAttribute('hidden', '');
    document.body.classList.remove('wa-codes-lock');
    if (activeBox) activeBox.focus();
    else if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function fire(box) { box.dispatchEvent(new Event('input', { bubbles: true })); }

  function insert(text) {
    var box = activeBox;
    if (!box) return;
    var max = box.maxLength > 0 ? box.maxLength : Infinity;
    var v = box.value;
    var s = typeof box.selectionStart === 'number' ? box.selectionStart : v.length;
    var e = typeof box.selectionEnd === 'number' ? box.selectionEnd : v.length;
    if (v.length - (e - s) + text.length > max) { say('Message is too long (limit ' + max + ' characters).'); return; }
    box.value = v.slice(0, s) + text + v.slice(e);
    var pos = s + text.length;
    box.setSelectionRange(pos, pos);
    fire(box);
    say('Added ' + text);
  }

  // Wraps the selected text in *{b}*...*{/b}* (or {i}/{s}); with nothing selected, adds the pair and
  // puts the cursor between them.
  function wrap(key) {
    var box = activeBox;
    if (!box) return;
    var open = '*{' + key + '}*', close = '*{/' + key + '}*';
    var max = box.maxLength > 0 ? box.maxLength : Infinity;
    var v = box.value;
    var s = typeof box.selectionStart === 'number' ? box.selectionStart : v.length;
    var e = typeof box.selectionEnd === 'number' ? box.selectionEnd : v.length;
    if (v.length + open.length + close.length > max) { say('Message is too long (limit ' + max + ' characters).'); return; }
    box.value = v.slice(0, s) + open + v.slice(s, e) + close + v.slice(e);
    var pos = s === e ? s + open.length : e + open.length + close.length;
    box.setSelectionRange(pos, pos);
    fire(box);
    say(s === e ? 'Type your text between the tags.' : 'Style applied.');
  }

  function useSample() {
    var box = activeBox;
    if (!box) return;
    var t = sampleTemplate(activeSets);
    if (box.maxLength > 0 && t.length > box.maxLength) { say('Sample is longer than the message limit.'); return; }
    if (box.value.trim() && !window.confirm('Replace the current message with the sample template?')) return;
    box.value = t;
    fire(box);
    say('Sample template added.');
  }

  function attach(id, sets) {
    var box = document.getElementById(id);
    if (!box || box.getAttribute('data-wa-codes') === '1') return;
    box.setAttribute('data-wa-codes', '1');
    box.setAttribute('dir', 'auto');   // Urdu/Arabic lines start from the right, English lines from the left
    box.classList.add('wa-rtl-aware');

    var bar = el('div', 'wa-codes-bar');
    var label = document.querySelector('label[for="' + id + '"]');
    if (label) {
      label.parentNode.insertBefore(bar, label);
      bar.appendChild(label);
    } else {
      box.parentNode.insertBefore(bar, box);   // no label: the button sits right above the box
    }
    var btn = el('button', 'btn-outline wa-codes-btn');
    btn.type = 'button';
    btn.innerHTML = '<i class="fas fa-code"></i> Codes';
    btn.addEventListener('click', function () { open(id, sets); });
    bar.appendChild(btn);
  }

  function init() {
    TARGETS.forEach(function (t) { attach(t.id, t.sets); });
    // any other message box can opt in:  <textarea id="..." data-wa-codes-for="student">
    Array.prototype.forEach.call(document.querySelectorAll('textarea[data-wa-codes-for]'), function (ta) {
      if (!ta.id) return;
      attach(ta.id, ta.getAttribute('data-wa-codes-for').split(',').map(function (x) { return x.trim(); }));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
