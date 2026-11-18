/*
 * Settings > WhatsApp > fee message boxes: "Codes" button.
 * Adds a Codes button above the Fee voucher / Fee reminder message boxes. Clicking it opens a popup in
 * the centre of the page listing every heading and its code; "Insert" puts the code into the message
 * at the cursor. The Style buttons wrap the selected words in *{b}*...*{/b}* (bold), {i} (italic) or {s}
 * (strikethrough) tags. The backend (WhatsAppService.fillCodes) replaces each %[code]% with the real value.
 *
 * Needs only the two textareas that already exist in settings.html (#wa-voucher-tpl, #wa-reminder-tpl).
 */
(function () {
  'use strict';

  var CODES = [
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

  var TARGETS = ['wa-voucher-tpl', 'wa-reminder-tpl'];

  function tag(c) { return '%[' + c + ']%'; }

  function sampleTemplate() {
    return CODES.map(function (r) { return r.heading + ' : ' + tag(r.code); }).join('\n');
  }

  var overlay, status, activeBox, lastFocus;

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
      'Each code is replaced with the real fee detail of the student when the message is sent.');

    var fmt = el('div', 'wa-codes-fmt');
    fmt.appendChild(el('span', 'wa-codes-fmt-label', 'Style text:'));
    FORMATS.forEach(function (f) {
      var fb = el('button', 'wa-codes-insert wa-codes-fmt-btn', f.label);
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
    var hr = el('div', 'wa-codes-row wa-codes-row-h');
    hr.appendChild(el('span', null, 'Heading'));
    hr.appendChild(el('span', null, 'Code'));
    hr.appendChild(el('span', null, ''));
    table.appendChild(hr);

    CODES.forEach(function (r) {
      var row = el('div', 'wa-codes-row');
      row.appendChild(el('span', 'wa-codes-name', r.heading));
      row.appendChild(el('code', 'wa-codes-code', tag(r.code)));
      var b = el('button', 'wa-codes-insert', 'Insert');
      b.type = 'button';
      b.addEventListener('click', function () { insert(tag(r.code)); });
      row.appendChild(b);
      table.appendChild(row);
    });

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

  function open(textareaId) {
    activeBox = document.getElementById(textareaId);
    if (!activeBox) return;
    if (!overlay) build();
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
    var t = sampleTemplate();
    if (box.maxLength > 0 && t.length > box.maxLength) { say('Sample is longer than the message limit.'); return; }
    if (box.value.trim() && !window.confirm('Replace the current message with the sample template?')) return;
    box.value = t;
    fire(box);
    say('Sample template added.');
  }

  function attach(id) {
    var box = document.getElementById(id);
    if (!box || box.getAttribute('data-wa-codes') === '1') return;
    var label = document.querySelector('label[for="' + id + '"]');
    if (!label) return;
    box.setAttribute('data-wa-codes', '1');

    var bar = el('div', 'wa-codes-bar');
    label.parentNode.insertBefore(bar, label);
    bar.appendChild(label);
    var btn = el('button', 'btn-outline wa-codes-btn');
    btn.type = 'button';
    btn.innerHTML = '<i class="fas fa-code"></i> Codes';
    btn.addEventListener('click', function () { open(id); });
    bar.appendChild(btn);
  }

  function init() { TARGETS.forEach(attach); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
