/**
 * SOFT SCHOOL — XSS SAFETY HELPERS
 * ------------------------------------------------------------
 * Load this file BEFORE any other app script on every page.
 *
 *   SSX.esc(v)      HTML-escape text for element content or a quoted
 *                   attribute value:   <td>${SSX.esc(name)}</td>
 *   SSX.url(v)      Escape + validate a URL placed in href/src/action.
 *                   Only http(s), mailto, tel, relative, #hash, blob: and
 *                   data:image/* are allowed; javascript:, vbscript:,
 *                   data:text/html etc. become "#".
 *   SSX.jsStr(v)    Make a value safe INSIDE a quoted JS string that lives
 *                   in an inline handler:  onclick="open('${SSX.jsStr(id)}')"
 *                   (HTML-escaping alone is NOT enough there: the browser
 *                   decodes &#39; back to ' before the JS runs.)
 *   SSX.jsArg(v)    For a bare handler argument:  onclick="open(${SSX.jsArg(id)})"
 *                   Numbers stay numbers; anything else becomes a safe quoted string.
 *
 * Prefer element.textContent / safeSetText over innerHTML wherever
 * you do not need markup.
 */
(function (global) {
  "use strict";

  var HTML_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

  function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"'`]/g, function (c) { return HTML_MAP[c]; });
  }

  // Control chars + anything that could end a JS string or an HTML attribute.
  function jsStr(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[\\'"`<>&\u0000-\u001f\u2028\u2029\u007f]/g, function (c) {
      var code = c.charCodeAt(0);
      return code < 256
        ? "\\x" + (code < 16 ? "0" : "") + code.toString(16)
        : "\\u" + ("0000" + code.toString(16)).slice(-4);
    });
  }

  function jsArg(value) {
    if (typeof value === "number" && isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    var s = value === null || value === undefined ? "" : String(value);
    if (/^-?\d{1,15}(\.\d{1,10})?$/.test(s)) return s;
    return "'" + jsStr(s) + "'";
  }

  var SAFE_URL = /^(?:https?:|mailto:|tel:|blob:|data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml|x-icon);|[#/?.]|[a-z0-9_\-][^:]*$)/i;

  function url(value) {
    if (value === null || value === undefined) return "";
    // Browsers ignore tabs/newlines/control chars inside a scheme ("java\tscript:") — strip before testing.
    var s = String(value).replace(/[\u0000-\u0020\u007f-\u009f\u2028\u2029]/g, function (c) { return c === " " ? " " : ""; }).trim();
    if (!s) return "";
    return SAFE_URL.test(s) ? esc(s) : "#";
  }

  global.SSX = Object.freeze({ esc: esc, url: url, jsStr: jsStr, jsArg: jsArg });
})(typeof window !== "undefined" ? window : globalThis);
