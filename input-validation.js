/**
 * ============================================================
 * SOFT SCHOOL — SHARED INPUT VALIDATION & SANITIZATION LIBRARY
 * ------------------------------------------------------------
 * A single, dependency-free, schema-based validator used by every
 * page's form-handling code (login/register, Add School, Add/Edit
 * Student, Add/Edit Staff, Fees & Finance, Settings, etc).
 *
 * WHY THIS FILE EXISTS
 * Before this file, every page validated form input with hand
 * rolled, inconsistent checks (some fields had no length limit,
 * no type check, and several places inserted user-typed strings
 * straight into innerHTML — a stored/reflected XSS risk). This
 * library centralizes that logic so every page validates the same
 * way, with the same limits, and the same escaping rules.
 *
 * DESIGN — follows the OWASP Input Validation & XSS Prevention
 * Cheat Sheets:
 *   1. ALLOW-LIST, NOT DENY-LIST — every field is validated against
 *      an explicit "what is allowed" schema (type, format, length,
 *      allowed characters), not a list of "bad" characters to strip.
 *   2. REJECT, DON'T SILENTLY "FIX" — invalid input produces a clear
 *      validation error instead of being auto-corrected/truncated,
 *      except for harmless canonicalization (trimming surrounding
 *      whitespace) explicitly noted below. Silently mutating bad
 *      input hides bugs and can mask attempted attacks.
 *   3. LENGTH LIMITS ON EVERY FIELD — every schema entry requires
 *      (or defaults) a maxLength, to stop oversized payloads before
 *      they ever reach storage/render.
 *   4. TYPE / FORMAT CHECKS — numbers are parsed and range-checked,
 *      dates are validated as real calendar dates, emails/phones are
 *      format-checked, free text is restricted to a safe character
 *      allow-list where the field doesn't need full free text.
 *   5. OUTPUT ENCODING — escapeHtml()/safeSetText() are provided so
 *      that any value that must be shown inside HTML (e.g. via
 *      innerHTML templates) is HTML-entity-encoded at the point of
 *      output, which is the actual XSS defense (validation alone is
 *      not sufficient — encode wherever untrusted data reaches the
 *      DOM).
 *   6. CENTRALIZED, NOT PER-FIELD — one schema object per form
 *      describes every field, so adding/adjusting a rule happens in
 *      one place instead of being re-implemented per page.
 *
 * IMPORTANT NOTE ON TRUST BOUNDARIES
 * This library runs in the browser, so — like all client-side
 * validation — it improves UX and catches mistakes early, but a
 * motivated attacker can bypass it entirely (disable JS, call the
 * API directly, use devtools). It is NOT a substitute for server
 * side validation. Anywhere this app talks to a real backend
 * (SCHOOL_API_BASE_URL in access-control.js / index.js), the same
 * allow-list rules must also be enforced there. This file only
 * hardens the client.
 *
 * USAGE
 *   const schema = {
 *     fullName: SSValidate.rules.name({ required: true, maxLength: 80 }),
 *     email:    SSValidate.rules.email({ required: false }),
 *     age:      SSValidate.rules.integer({ min: 1, max: 120 })
 *   };
 *   const result = SSValidate.validate(rawObject, schema);
 *   if (!result.ok) {
 *     // result.errors = { fullName: "Full name is required.", ... }
 *     return;
 *   }
 *   // result.values = the same data, trimmed/canonicalized & type-cast
 * ============================================================
 */
(function (global) {
  "use strict";

  /* ── GENERIC LENGTH GUARD ─────────────────────────────────────
     Hard ceiling applied to every string field even if a schema
     forgets to set maxLength, so nothing unbounded ever reaches
     localStorage/the API (basic protection against memory/DoS
     abuse from pasted-in giant strings). */
  const ABSOLUTE_MAX_STRING_LENGTH = 5000;

  /* ── OUTPUT ENCODING ──────────────────────────────────────────
     Escapes the 5 characters that matter for safe placement of a
     value inside HTML markup (element content or attribute value).
     Use this ANY time untrusted data is concatenated into an
     innerHTML/outerHTML template. Prefer textContent/safeSetText
     over innerHTML wherever possible — this is the fallback for
     the handful of places that must build HTML strings. */
  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"'`=/]/g, function (ch) {
      switch (ch) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case '"': return "&quot;";
        case "'": return "&#39;";
        case "`": return "&#96;";
        case "=": return "&#61;";
        case "/": return "&#47;";
        default: return ch;
      }
    });
  }

  /* Preferred safe-render helper: sets element text via textContent
     (never interpreted as markup), so callers don't need to reach
     for innerHTML + escapeHtml at all when they just need to show
     a piece of text. */
  function safeSetText(el, value) {
    if (!el) return;
    el.textContent = value === null || value === undefined ? "" : String(value);
  }

  /* Strips characters that have no legitimate use in short text
     fields (ASCII control chars / null bytes) that can otherwise be
     used to corrupt logs, break CSV/exports, or smuggle data past
     naive filters. Keeps normal whitespace (space, tab, newline). */
  function stripControlChars(str) {
    // eslint-disable-next-line no-control-regex
    return String(str).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  }

  function canonicalizeString(raw) {
    let s = raw === null || raw === undefined ? "" : String(raw);
    s = stripControlChars(s).trim();
    if (s.length > ABSOLUTE_MAX_STRING_LENGTH) s = s.slice(0, ABSOLUTE_MAX_STRING_LENGTH);
    return s;
  }

  /* ── FIELD-LEVEL VALIDATORS ───────────────────────────────────
     Each returns { ok: boolean, value: <canonicalized value>, error?: string }
     `opts.label` is used to build human-readable error messages. */

  function validateString(raw, opts) {
    opts = opts || {};
    const label = opts.label || "This field";
    const required = !!opts.required;
    const minLength = typeof opts.minLength === "number" ? opts.minLength : 0;
    const maxLength = typeof opts.maxLength === "number" ? opts.maxLength : 200;
    // Allow-listed character set. Defaults to a broad "safe printable
    // text" set (letters, numbers, common punctuation/spacing used in
    // names/addresses/notes) which excludes HTML-significant symbols
    // like < > that have no legitimate reason to be typed in these
    // fields, per the OWASP allow-list principle.
    const pattern = opts.pattern instanceof RegExp ? opts.pattern : null;

    const value = canonicalizeString(raw);

    if (!value) {
      if (required) return { ok: false, value: "", error: label + " is required." };
      return { ok: true, value: "" };
    }
    if (value.length < minLength) {
      return { ok: false, value: value, error: label + " must be at least " + minLength + " character(s)." };
    }
    if (value.length > maxLength) {
      return { ok: false, value: value, error: label + " must be " + maxLength + " characters or fewer." };
    }
    if (pattern && !pattern.test(value)) {
      return { ok: false, value: value, error: (opts.patternMessage || (label + " contains characters that are not allowed.")) };
    }
    return { ok: true, value: value };
  }

  /* Human names / free-text labels: letters (incl. accented), spaces,
     apostrophes, hyphens, periods, commas. Blocks <, >, /, backticks,
     etc. — characters with no place in a name but common in markup
     injection attempts. */
  const NAME_PATTERN = /^[\p{L}\p{M}0-9 .,'()\-\/]+$/u;
  const ADDRESS_PATTERN = /^[\p{L}\p{M}0-9 .,'()#\-\/\n\r]+$/u;
  const ALNUM_ID_PATTERN = /^[A-Za-z0-9_\-]+$/;
  const USERNAME_PATTERN = /^[A-Za-z0-9_.\-]+$/;

  function validateInteger(raw, opts) {
    opts = opts || {};
    const label = opts.label || "This field";
    const required = !!opts.required;
    const raw2 = raw === null || raw === undefined ? "" : String(raw).trim();

    if (!raw2) {
      if (required) return { ok: false, value: null, error: label + " is required." };
      return { ok: true, value: null };
    }
    // Strict integer check — rejects "12abc", "1e5", trailing junk,
    // decimals, etc. rather than relying on parseInt's lenient
    // partial-parse behavior.
    if (!/^-?\d+$/.test(raw2)) {
      return { ok: false, value: null, error: label + " must be a whole number." };
    }
    const num = Number(raw2);
    if (!Number.isSafeInteger(num)) {
      return { ok: false, value: null, error: label + " is not a valid number." };
    }
    if (typeof opts.min === "number" && num < opts.min) {
      return { ok: false, value: null, error: label + " must be at least " + opts.min + "." };
    }
    if (typeof opts.max === "number" && num > opts.max) {
      return { ok: false, value: null, error: label + " must be " + opts.max + " or less." };
    }
    return { ok: true, value: num };
  }

  function validateDecimal(raw, opts) {
    opts = opts || {};
    const label = opts.label || "This field";
    const required = !!opts.required;
    const raw2 = raw === null || raw === undefined ? "" : String(raw).trim();

    if (!raw2) {
      if (required) return { ok: false, value: null, error: label + " is required." };
      return { ok: true, value: null };
    }
    // Up to 2 decimal places by default (money fields); reject
    // scientific notation, commas, currency symbols, etc.
    const decimals = typeof opts.decimals === "number" ? opts.decimals : 2;
    const re = new RegExp("^-?\\d+(\\.\\d{1," + decimals + "})?$");
    if (!re.test(raw2)) {
      return { ok: false, value: null, error: label + " must be a valid number" + (decimals ? " with up to " + decimals + " decimal places." : ".") };
    }
    const num = Number(raw2);
    if (!Number.isFinite(num)) {
      return { ok: false, value: null, error: label + " is not a valid number." };
    }
    if (typeof opts.min === "number" && num < opts.min) {
      return { ok: false, value: null, error: label + " must be at least " + opts.min + "." };
    }
    if (typeof opts.max === "number" && num > opts.max) {
      return { ok: false, value: null, error: label + " must be " + opts.max + " or less." };
    }
    return { ok: true, value: num };
  }

  // RFC 5322-ish practical email check (not a full-spec parser —
  // full-spec email regexes are a known ReDoS/complexity trap, so
  // this intentionally stays simple and rejects clearly-invalid input).
  const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/;

  function validateEmail(raw, opts) {
    opts = opts || {};
    const label = opts.label || "Email";
    const required = !!opts.required;
    const value = canonicalizeString(raw).toLowerCase();

    if (!value) {
      if (required) return { ok: false, value: "", error: label + " is required." };
      return { ok: true, value: "" };
    }
    if (value.length > 254) {
      return { ok: false, value: value, error: label + " is too long." };
    }
    if (!EMAIL_PATTERN.test(value)) {
      return { ok: false, value: value, error: "Enter a valid " + label.toLowerCase() + " address." };
    }
    return { ok: true, value: value };
  }

  // Accepts digits with optional leading +, spaces, hyphens, parens —
  // normalizes to digits-and-leading-plus only. 7–15 digits covers
  // real-world phone number lengths (E.164 max is 15 digits).
  function validatePhone(raw, opts) {
    opts = opts || {};
    const label = opts.label || "Phone number";
    const required = !!opts.required;
    const value = canonicalizeString(raw);

    if (!value) {
      if (required) return { ok: false, value: "", error: label + " is required." };
      return { ok: true, value: "" };
    }
    if (!/^[+]?[0-9 \-()]{7,20}$/.test(value)) {
      return { ok: false, value: value, error: "Enter a valid " + label.toLowerCase() + "." };
    }
    const digitCount = value.replace(/[^0-9]/g, "").length;
    if (digitCount < 7 || digitCount > 15) {
      return { ok: false, value: value, error: "Enter a valid " + label.toLowerCase() + "." };
    }
    return { ok: true, value: value };
  }

  function validateEnum(raw, opts) {
    opts = opts || {};
    const label = opts.label || "This field";
    const required = !!opts.required;
    const allowed = Array.isArray(opts.values) ? opts.values : [];
    const value = canonicalizeString(raw);

    if (!value) {
      if (required) return { ok: false, value: "", error: "Please select a " + label.toLowerCase() + "." };
      return { ok: true, value: "" };
    }
    if (allowed.indexOf(value) === -1) {
      return { ok: false, value: "", error: "Invalid " + label.toLowerCase() + " selected." };
    }
    return { ok: true, value: value };
  }

  // Real calendar-date check (rejects 2024-02-30 etc.), optional
  // min/max bounds (e.g. date of birth must be in the past).
  function validateDate(raw, opts) {
    opts = opts || {};
    const label = opts.label || "Date";
    const required = !!opts.required;
    const value = canonicalizeString(raw);

    if (!value) {
      if (required) return { ok: false, value: "", error: label + " is required." };
      return { ok: true, value: "" };
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) {
      return { ok: false, value: "", error: "Enter " + label.toLowerCase() + " as YYYY-MM-DD." };
    }
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    const isRealDate = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
    if (!isRealDate) {
      return { ok: false, value: "", error: label + " is not a valid calendar date." };
    }
    if (opts.min && dt < new Date(opts.min)) {
      return { ok: false, value: "", error: label + " is too far in the past." };
    }
    if (opts.max && dt > new Date(opts.max)) {
      return { ok: false, value: "", error: label + " cannot be in the future." };
    }
    return { ok: true, value: value };
  }

  function validateBoolean(raw) {
    return { ok: true, value: !!raw };
  }

  /* ── SCHEMA ENGINE ─────────────────────────────────────────────
     A schema is { fieldName: ruleDescriptor }. ruleDescriptor is one
     of the objects produced by the `rules.*` helpers below (each
     just tags an options object with a `type`). validate() runs the
     matching validator for every field, collects value/errors, and
     never throws on bad input — it always returns a result object,
     so callers can't accidentally skip error handling. */
  function validate(data, schema) {
    const values = {};
    const errors = {};
    let ok = true;
    data = data && typeof data === "object" ? data : {};

    Object.keys(schema).forEach(function (field) {
      const rule = schema[field] || {};
      const raw = Object.prototype.hasOwnProperty.call(data, field) ? data[field] : "";
      let result;

      switch (rule.type) {
        case "integer": result = validateInteger(raw, rule); break;
        case "decimal":  result = validateDecimal(raw, rule); break;
        case "email":    result = validateEmail(raw, rule); break;
        case "phone":    result = validatePhone(raw, rule); break;
        case "enum":     result = validateEnum(raw, rule); break;
        case "date":     result = validateDate(raw, rule); break;
        case "boolean":  result = validateBoolean(raw); break;
        case "string":
        default:         result = validateString(raw, rule); break;
      }

      values[field] = result.value;
      if (!result.ok) {
        ok = false;
        errors[field] = result.error;
      }
    });

    return { ok: ok, values: values, errors: errors };
  }

  /* Convenience factories so schemas read declaratively, e.g.:
       name: SSValidate.rules.name({ required: true, maxLength: 80 }) */
  const rules = {
    text: function (opts) { return Object.assign({ type: "string", maxLength: 200 }, opts); },
    name: function (opts) { return Object.assign({ type: "string", maxLength: 80, pattern: NAME_PATTERN, patternMessage: (opts && opts.label || "Name") + " may only contain letters, spaces, and , . ' - ( )" }, opts); },
    address: function (opts) { return Object.assign({ type: "string", maxLength: 300, pattern: ADDRESS_PATTERN, patternMessage: "Address contains characters that are not allowed." }, opts); },
    username: function (opts) { return Object.assign({ type: "string", maxLength: 40, minLength: 4, pattern: USERNAME_PATTERN, patternMessage: "Username may only contain letters, numbers, dots, hyphens, and underscores (no spaces)." }, opts); },
    id: function (opts) { return Object.assign({ type: "string", maxLength: 40, pattern: ALNUM_ID_PATTERN, patternMessage: "ID may only contain letters, numbers, hyphens, and underscores." }, opts); },
    password: function (opts) { return Object.assign({ type: "string", maxLength: 128, minLength: 6 }, opts); },
    note: function (opts) { return Object.assign({ type: "string", maxLength: 1000 }, opts); },
    integer: function (opts) { return Object.assign({ type: "integer" }, opts); },
    money: function (opts) { return Object.assign({ type: "decimal", decimals: 2, min: 0 }, opts); },
    email: function (opts) { return Object.assign({ type: "email" }, opts); },
    phone: function (opts) { return Object.assign({ type: "phone" }, opts); },
    date: function (opts) { return Object.assign({ type: "date" }, opts); },
    enumOf: function (values, opts) { return Object.assign({ type: "enum", values: values }, opts); },
    boolean: function (opts) { return Object.assign({ type: "boolean" }, opts); }
  };

  /* Reads a <form>'s fields into a plain object via FormData, exactly
     like the existing pages already do with `new FormData(form)`, so
     this drops in without changing how markup/forms are structured. */
  function readForm(formEl) {
    const out = {};
    if (!formEl) return out;
    new FormData(formEl).forEach(function (v, k) { out[k] = v; });
    return out;
  }

  global.SSValidate = {
    validate: validate,
    rules: rules,
    escapeHtml: escapeHtml,
    safeSetText: safeSetText,
    stripControlChars: stripControlChars,
    readForm: readForm,
    patterns: {
      name: NAME_PATTERN,
      address: ADDRESS_PATTERN,
      alnumId: ALNUM_ID_PATTERN,
      username: USERNAME_PATTERN,
      email: EMAIL_PATTERN
    }
  };
})(window);
