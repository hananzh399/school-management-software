/* ============================================================
   Soft School — login.js
   ============================================================ */

/* ══════════════════════════════════════════════════════
   DEMO VIDEO CONFIGURATION
   ══════════════════════════════════════════════════════
   To add your demo video, choose one option:
   Option A — YouTube video:
     1. Get your YouTube video ID from the URL
        e.g. https://youtube.com/watch?v=ABC123  → ID is "ABC123"
     2. Paste it below between the quotes
        DEMO_VIDEO_ID = 'ABC123';

   Option B — Direct video file (MP4, WebM, etc.):
     Leave DEMO_VIDEO_ID empty and set DEMO_VIDEO_SRC to
     the full URL of your video file:
        DEMO_VIDEO_SRC = 'https://yoursite.com/your-demo.mp4';

   Leave both empty to show a "coming soon" placeholder.
   ══════════════════════════════════════════════════════ */
const DEMO_VIDEO_ID = "PJYZTVhMNfo"; // YouTube video ID
const DEMO_VIDEO_SRC = ""; // Direct video URL  e.g. 'https://example.com/demo.mp4'

/* ── SHOW A TOAST IF REDIRECTED HERE AFTER A BLOCK ── */
(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get("blocked")) {
    window.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => showToast("Your school's access has been suspended. Please contact support.", "error"), 400);
    });
  }
})();

/* ── SCROLL PROGRESS BAR ── */
(function () {
  const bar = document.getElementById("scrollProgress");
  if (!bar) return;
  function updateProgress() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight =
      document.documentElement.scrollHeight - window.innerHeight;
    const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    bar.style.width = pct + "%";
  }
  document.addEventListener("scroll", updateProgress, { passive: true });
  updateProgress();
})();

/* ── RIPPLE EFFECT ── */
document.querySelectorAll(".btn-ripple").forEach((btn) => {
  btn.addEventListener("click", function (e) {
    const rect = this.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    const ripple = document.createElement("span");
    ripple.className = "ripple-wave";
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px;`;
    this.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  });
});

/* ── TOAST NOTIFICATIONS ── */
function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const icons = {
    success: "fa-circle-check",
    error: "fa-circle-xmark",
    info: "fa-circle-info",
  };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3700);
}

/* ── PASSWORD TOGGLE ── */
function togglePw() {
  const pw = document.getElementById("password");
  const icon = document.getElementById("eyeIcon");
  if (pw.type === "password") {
    pw.type = "text";
    icon.className = "fas fa-eye-slash";
  } else {
    pw.type = "password";
    icon.className = "fas fa-eye";
  }
}

/* ── LOGIN FORM ──
   SECURITY: input is now validated through the shared SSValidate
   schema (input-validation.js) before it is ever sent to
   SoftSchoolAuth.authenticate(). This rejects empty/oversized/
   malformed values up front (allow-list validation, length limits)
   instead of only checking "is it non-empty". The actual credential
   check still happens server-side — this only stops obviously bad
   input from being submitted. */
async function handleLogin(e) {
  e.preventDefault();
  const phone = document.getElementById("phone");
  const pass = document.getElementById("password");
  const btn = document.getElementById("loginBtn");

  [phone, pass].forEach((el) => el.classList.remove("error"));

  const loginSchema = {
    // The field is labeled "phone" in the markup but is actually used
    // as the school's login identifier (username/phone/email), so it
    // is validated as free-form text with a firm length cap rather
    // than a strict phone format, to avoid rejecting legitimate
    // usernames or emails already registered by existing schools.
    phone: SSValidate.rules.text({ required: true, maxLength: 100, label: "Phone number / username" }),
    password: SSValidate.rules.password({ required: true, minLength: 1, maxLength: 128, label: "Password" }),
  };
  const { ok, values, errors } = SSValidate.validate(
    { phone: phone.value, password: pass.value },
    loginSchema
  );

  function shakeLoginCard() {
    phone.closest(".login-card").classList.add("shake");
    phone.closest(".login-card").addEventListener(
      "animationend",
      () => phone.closest(".login-card").classList.remove("shake"),
      { once: true },
    );
  }

  if (!ok) {
    if (errors.phone) {
      phone.classList.add("error");
      shakeLoginCard();
      showToast(errors.phone, "error");
    } else if (errors.password) {
      pass.classList.add("error");
      shakeLoginCard();
      showToast(errors.password, "error");
    }
    return;
  }

  const origText = btn.textContent;
  btn.textContent = "Signing in…";
  btn.disabled = true;
  btn.style.opacity = "0.8";

  const rememberBox = document.getElementById("rememberAdmin");
  const remember = !!(rememberBox && rememberBox.checked);

  // Note: the password is intentionally NOT run through the
  // canonicalizing/allow-list string validator beyond a length cap —
  // passwords must be sent to auth exactly as typed (trimming or
  // restricting characters would silently reject valid passwords
  // that use punctuation/symbols/whitespace).
  const result = await SoftSchoolAuth.authenticate(values.phone, pass.value, remember);

  btn.textContent = origText;
  btn.disabled = false;
  btn.style.opacity = "";

  if (!result.ok) {
    if (result.reason === "blocked") {
      showToast("Your school's access has been suspended. Please contact support.", "error");
    } else if (result.reason === "expired") {
      showToast("Your school's plan has expired. Please contact support to renew.", "error");
    } else if (result.reason === "network") {
      showToast(result.message, "error");
    } else {
      showToast("Invalid username or password.", "error");
    }
    pass.classList.add("error");
    phone.closest(".login-card").classList.add("shake");
    phone.closest(".login-card").addEventListener("animationend", () => {
      phone.closest(".login-card").classList.remove("shake");
    }, { once: true });
    return;
  }

  if (remember && result.school && result.school.rememberToken) {
    SoftSchoolAuth.saveRememberMe(result.school.username, result.school.rememberToken);
  } else if (!remember) {
    // Unchecked on this login → don't leave an old token from a previous
    // "Remember Me" login still sitting in this browser.
    SoftSchoolAuth.clearRememberMe();
  }

  SoftSchoolAuth.startSession(result);
  showToast("Redirecting to your dashboard…", "success");
  setTimeout(() => { window.location.href = "main.html"; }, 900);
}

/* ════════════════════════════════════════
   FOCUS TRAP UTILITY
   ════════════════════════════════════════ */
const FOCUSABLE =
  'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])';

function createFocusTrap(modalEl) {
  return function handler(e) {
    if (e.key !== "Tab") return;
    const nodes = Array.from(modalEl.querySelectorAll(FOCUSABLE)).filter(
      (el) => !el.closest("[hidden]"),
    );
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
}

/* ════════════════════════════════════════
   GET STARTED MODAL
   ════════════════════════════════════════ */
let _gsTrap = null;
let _gsLastFocused = null;

function openGetStarted() {
  const modal = document.getElementById("getStartedModal");
  if (!modal) return;
  _gsLastFocused = document.activeElement;
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  /* Move focus into modal */
  setTimeout(() => {
    const first = modal.querySelector(FOCUSABLE);
    if (first) first.focus();
  }, 80);
  if (_gsTrap) modal.removeEventListener("keydown", _gsTrap);
  _gsTrap = createFocusTrap(modal);
  modal.addEventListener("keydown", _gsTrap);
}
function closeGetStarted() {
  const modal = document.getElementById("getStartedModal");
  if (!modal) return;
  modal.classList.remove("open");
  document.body.style.overflow = "";
  if (_gsTrap) {
    modal.removeEventListener("keydown", _gsTrap);
    _gsTrap = null;
  }
  if (_gsLastFocused) {
    _gsLastFocused.focus();
    _gsLastFocused = null;
  }
}
function closeGetStartedOutside(e) {
  if (e.target === document.getElementById("getStartedModal"))
    closeGetStarted();
}

/* Open video from inside the Get Started modal */
function openVideoFromGs() {
  closeGetStarted();
  setTimeout(openVideo, 180);
}

/* Open login from inside the Get Started modal */
function openLoginFromGs() {
  closeGetStarted();
  setTimeout(openLogin, 180);
}

/* ════════════════════════════════════════
   VIDEO MODAL
   ════════════════════════════════════════ */
let _videoClearTimer = null;
let _videoTrap = null;
let _videoLastFocused = null;

function buildVideoContent() {
  const container = document.getElementById("videoContent");
  if (!container) return;

  container.innerHTML = "";

  if (DEMO_VIDEO_ID) {
    /* YouTube embed */
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube.com/embed/${DEMO_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1`;
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.title = "Soft School Demo Video";
    container.appendChild(iframe);
  } else if (DEMO_VIDEO_SRC) {
    /* Direct video file */
    const video = document.createElement("video");
    video.src = DEMO_VIDEO_SRC;
    video.controls = true;
    video.autoplay = true;
    video.style.cssText =
      "width:100%;height:100%;object-fit:contain;background:#0C3531;";
    container.appendChild(video);
  } else {
    /* Placeholder — video not configured yet */
    const placeholder = document.createElement("div");
    placeholder.className = "video-placeholder-inner";
    placeholder.innerHTML = `
      <div class="play-giant"><i class="fas fa-play"></i></div>
      <p style="font-size:1rem;font-weight:600;margin-top:0.5rem;">Demo video coming soon</p>
      <p style="font-size:0.88rem;opacity:0.7;max-width:340px;line-height:1.5;">
        Set <code style="background:rgba(255,255,255,0.15);padding:2px 6px;border-radius:4px;font-size:0.82rem;">DEMO_VIDEO_ID</code>
        in <code style="background:rgba(255,255,255,0.15);padding:2px 6px;border-radius:4px;font-size:0.82rem;">login.js</code>
        to embed your YouTube video here.
      </p>
      <a href="https://wa.me/923181909541?text=Hello%20Soft%20School,%20I%20want%20to%20book%20a%20live%20demo!"
         target="_blank" rel="noopener noreferrer"
         style="margin-top:1.2rem;display:inline-flex;align-items:center;gap:8px;padding:12px 22px;background:var(--amber-500);color:var(--teal-900);border-radius:10px;font-weight:700;font-size:0.9rem;text-decoration:none;transition:all 0.25s;"
         onmouseover="this.style.background='#C97A1B';this.style.color='#fff';"
         onmouseout="this.style.background='var(--amber-500)';this.style.color='var(--teal-900)';">
        <i class="fab fa-whatsapp" style="font-size:18px;"></i>
        Book a live demo instead
      </a>`;
    container.appendChild(placeholder);
  }
}

function openVideo() {
  const modal = document.getElementById("videoModal");
  if (!modal) return;
  /* Cancel any pending content-clear timer to avoid race condition */
  if (_videoClearTimer) {
    clearTimeout(_videoClearTimer);
    _videoClearTimer = null;
  }
  _videoLastFocused = document.activeElement;
  buildVideoContent();
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  setTimeout(() => {
    const close = modal.querySelector(".modal-close");
    if (close) close.focus();
  }, 80);
  if (_videoTrap) modal.removeEventListener("keydown", _videoTrap);
  _videoTrap = createFocusTrap(modal);
  modal.addEventListener("keydown", _videoTrap);
}

function closeVideo() {
  const modal = document.getElementById("videoModal");
  if (!modal) return;
  modal.classList.remove("open");
  document.body.style.overflow = "";
  if (_videoTrap) {
    modal.removeEventListener("keydown", _videoTrap);
    _videoTrap = null;
  }
  if (_videoLastFocused) {
    _videoLastFocused.focus();
    _videoLastFocused = null;
  }
  /* Stop video playback by clearing the content after transition */
  _videoClearTimer = setTimeout(() => {
    const container = document.getElementById("videoContent");
    if (container) container.innerHTML = "";
    _videoClearTimer = null;
  }, 300);
}

function closeVideoOutside(e) {
  if (e.target === document.getElementById("videoModal")) closeVideo();
}


/* ════════════════════════════════════════
   SCHOOL REGISTRATION + LOGIN (real backend)
   ────────────────────────────────────────
   Schools register with the School ID and 7-character security code
   issued from the super admin portal, then set their own username/password.
   Both are stored on the backend (School.username / School.loginPasswordHash)
   so the school can log in from any device — not just the one that
   registered. Talks to the same Spring Boot backend as the super admin
   portal (see superadmin.js -> API_BASE_URL), just under the public
   "/api/school" path instead of the admin-only "/api/admin" path.
   ════════════════════════════════════════ */
const SoftSchoolAuth = (function () {
  // Point this at your deployed backend in production, e.g.
  // "https://api.yourdomain.com/api/school"
  const API_BASE_URL = "http://localhost:8080/api/school";
  const SESSION_KEY = "softschool_session";
  const REMEMBER_KEY = "softschool_remember";
  const API_TOKEN_KEY = "softschool_api_token";
  const CODE_RE = /^(?=.*[a-z])(?=.*[0-9])[a-z0-9]{7}$/;

  function isValidCode(code) {
    return CODE_RE.test(code);
  }

  async function apiRequest(path, body) {
    let res;
    try {
      res = await fetch(API_BASE_URL + path, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, getApiToken() ? { "Authorization": "Bearer " + getApiToken() } : {}),
        body: JSON.stringify(body),
      });
    } catch (err) {
      return { ok: false, reason: "network", message: "Couldn't reach the server. Check your connection and try again." };
    }

    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      /* empty/non-JSON body */
    }

    if (!res.ok) {
      const message = (data && data.error) || "Something went wrong. Please try again.";
      let reason = "error";
      if (res.status === 401) reason = "invalid_login";
      else if (res.status === 403 && message === "blocked") reason = "blocked";
      else if (res.status === 403 && message === "expired") reason = "expired";
      else if (res.status === 409) reason = "conflict";
      return { ok: false, reason: reason, message: message };
    }

    return { ok: true, school: data };
  }

  /* schoolId + code = activation key from the super admin portal.
     username + password = chosen by the school, stored on the backend. */
  function register({ schoolId, username, password, code }) {
    return apiRequest("/register", { schoolId, username, password, code });
  }

  function authenticate(username, password, remember) {
    return apiRequest("/login", { username, password, remember: !!remember });
  }

  /* schoolId + code = activation key from the super admin portal (same
     proof of ownership as register). username must match the school's
     EXISTING username; newPassword replaces loginPasswordHash. */
  function resetPassword({ schoolId, code, username, newPassword }) {
    return apiRequest("/reset-password", { schoolId, code, username, newPassword });
  }

  function getApiToken() {
    return sessionStorage.getItem(API_TOKEN_KEY);
  }

  function startSession(result) {
    /* rememberToken is a one-time credential, not part of the school's
       profile — strip it before the school object gets stored as the
       "logged in" session (which access-control.js may read back out
       elsewhere in the app). It's persisted separately via saveRememberMe(). */
    const school = result.school ? Object.assign({}, result.school) : null;
    if (school) {
      if (school.sessionToken) sessionStorage.setItem(API_TOKEN_KEY, school.sessionToken);
      delete school.sessionToken;
      delete school.rememberToken;
    }

    const payload = {
      schoolId: school ? school.schoolId : null,
      school: school,
      at: Date.now(),
    };
    /* Prefer access-control.js's setSession so both files always agree on
       the session shape — but pass it the FULL school object (not just the
       id) so the page guard on main.html etc. doesn't need a network round
       trip just to know who's logged in. Falls back to writing localStorage
       directly if access-control.js isn't loaded for some reason. */
    if (window.SoftSchoolAdmin && typeof window.SoftSchoolAdmin.setSession === "function" && school) {
      window.SoftSchoolAdmin.setSession(school);
      return;
    }
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    } catch (err) {
      /* ignore — session just won't persist across reloads */
    }
  }

  function currentSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  /* ── "REMEMBER ME" TOKEN STORAGE ──
     Only the school's username + a random, single-use-until-rotated token
     live here — never the password. The token by itself is useless without
     the backend's matching salted hash, and it's rotated (a new one issued)
     every time it's used, so it can't just be replayed forever if it leaks. */
  function saveRememberMe(username, token) {
    if (!username || !token) return;
    try {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username, token }));
    } catch (err) {
      /* ignore — remember-me just won't persist */
    }
  }

  function getRememberMe() {
    try {
      const raw = localStorage.getItem(REMEMBER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function clearRememberMe() {
    try {
      localStorage.removeItem(REMEMBER_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  /* Tells the backend to invalidate the stored token too (not just the
     copy in this browser) — call this from wherever "Log out" lives. */
  function forgetMe() {
    const remembered = getRememberMe();
    clearRememberMe();
    if (remembered && remembered.username) {
      apiRequest("/logout", { username: remembered.username }).catch(() => {});
    }
  }

  /* Trades a saved remember-me token for a fresh session. Used on page
     load to log the school straight in without showing the login form. */
  async function tryAutoLogin() {
    const remembered = getRememberMe();
    if (!remembered || !remembered.username || !remembered.token) {
      return { ok: false, reason: "no_token" };
    }
    const result = await apiRequest("/login-token", {
      username: remembered.username,
      token: remembered.token,
    });
    if (!result.ok) {
      clearRememberMe();
      return result;
    }
    if (result.school && result.school.rememberToken) {
      saveRememberMe(result.school.username, result.school.rememberToken);
    }
    return result;
  }

  return {
    register,
    authenticate,
    resetPassword,
    startSession,
    currentSession,
    isValidCode,
    saveRememberMe,
    getRememberMe,
    clearRememberMe,
    forgetMe,
    tryAutoLogin,
  };
})();
window.SoftSchoolAuth = SoftSchoolAuth;

/* ── REMEMBER ME: SILENT AUTO-LOGIN ──
   If this browser already has a valid "Remember Me" token from a previous
   visit, skip the login modal entirely — trade the token for a session and
   go straight to the dashboard. A full-page overlay covers the marketing
   page while this check happens so the school never sees it flash by. */
(function () {
  document.addEventListener("DOMContentLoaded", async () => {
    const remembered = SoftSchoolAuth.getRememberMe();
    if (!remembered) return;

    const overlay = document.createElement("div");
    overlay.id = "autoLoginOverlay";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;" +
      "justify-content:center;gap:.6rem;background:var(--paper,#FAF8F3);" +
      "color:var(--ink,#0B2B28);font-family:'Inter',sans-serif;font-size:1rem;font-weight:500;";
    overlay.innerHTML =
      '<i class="fas fa-circle-notch fa-spin" style="color:var(--teal-500,#1E8F86);"></i> Signing you in…';
    document.body.appendChild(overlay);

    let result;
    try {
      result = await SoftSchoolAuth.tryAutoLogin();
    } catch (err) {
      result = { ok: false };
    }

    if (result.ok) {
      SoftSchoolAuth.startSession(result);
      window.location.href = "main.html";
      return; // leave the overlay up until the browser navigates away
    }

    overlay.remove();
  });
})();

/* ── REGISTRATION MODAL ── */
let _regTrap = null;
let _regLastFocused = null;

function openRegister() {
  const modal = document.getElementById("registerModal");
  if (!modal) return;
  _regLastFocused = document.activeElement;
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  setTimeout(() => {
    const first = document.getElementById("regSchoolId");
    if (first) first.focus();
  }, 200);
  if (_regTrap) modal.removeEventListener("keydown", _regTrap);
  _regTrap = createFocusTrap(modal);
  modal.addEventListener("keydown", _regTrap);
}

function closeRegister() {
  const modal = document.getElementById("registerModal");
  if (!modal) return;
  modal.classList.remove("open");
  document.body.style.overflow = "";
  if (_regTrap) {
    modal.removeEventListener("keydown", _regTrap);
    _regTrap = null;
  }
  if (_regLastFocused) {
    _regLastFocused.focus();
    _regLastFocused = null;
  }
}

function closeRegisterOutside(e) {
  if (e.target === document.getElementById("registerModal")) closeRegister();
}

function openRegisterFromGs() {
  closeGetStarted();
  setTimeout(openRegister, 180);
}

function openRegisterFromLogin() {
  closeLogin();
  setTimeout(openRegister, 180);
}

function openLoginFromRegister() {
  closeRegister();
  setTimeout(openLogin, 180);
}

function toggleRegPw(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (!input || !icon) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  icon.className = show ? "fas fa-eye-slash" : "fas fa-eye";
}

function shakeRegisterCard(field) {
  const card = document.getElementById("registerCard");
  if (field) field.classList.add("error");
  if (!card) return;
  card.classList.add("shake");
  card.addEventListener("animationend", () => card.classList.remove("shake"), { once: true });
  if (field) field.focus();
}

/* SECURITY: schema-based validation (allow-list character set +
   length limits) replaces the previous ad-hoc checks. School ID is
   restricted to the alnum/hyphen/underscore ID format actually issued
   by the super admin (see access-control.js genSchoolId()), and
   username is restricted to a safe character set so it can't smuggle
   markup/script content into anything that later renders it. */
async function handleRegister(e) {
  e.preventDefault();

  const schoolId = document.getElementById("regSchoolId");
  const username = document.getElementById("regUsername");
  const password = document.getElementById("regPassword");
  const password2 = document.getElementById("regPassword2");
  const code = document.getElementById("regCode");
  const btn = document.getElementById("registerBtn");

  [schoolId, username, password, password2, code].forEach((el) => el.classList.remove("error"));

  const registerSchema = {
    schoolId: SSValidate.rules.id({ required: true, maxLength: 40, label: "School ID" }),
    username: SSValidate.rules.username({ required: true, label: "Username" }),
    password: SSValidate.rules.password({ required: true, label: "Password" }),
    // Security code format is enforced by SoftSchoolAuth.isValidCode()
    // below (7 lowercase-alnum chars); here we just cap length/type so
    // an oversized/garbage value never reaches that check or the API.
    code: SSValidate.rules.text({ required: true, maxLength: 20, label: "Security code" }),
  };
  const { ok, values, errors } = SSValidate.validate(
    {
      schoolId: schoolId.value,
      username: username.value,
      password: password.value,
      code: code.value,
    },
    registerSchema
  );

  if (!ok) {
    if (errors.schoolId) { showToast(errors.schoolId, "error"); return shakeRegisterCard(schoolId); }
    if (errors.username) { showToast(errors.username, "error"); return shakeRegisterCard(username); }
    if (errors.password) { showToast(errors.password, "error"); return shakeRegisterCard(password); }
    if (errors.code) { showToast(errors.code, "error"); return shakeRegisterCard(code); }
  }

  const schoolIdVal = values.schoolId;
  const usernameVal = values.username;
  const codeVal = values.code.toLowerCase();

  if (password.value !== password2.value) {
    showToast("Passwords do not match.", "error");
    return shakeRegisterCard(password2);
  }
  if (!SoftSchoolAuth.isValidCode(codeVal)) {
    showToast("Security code must be 7 characters using lowercase letters and numbers.", "error");
    return shakeRegisterCard(code);
  }

  const origText = btn.innerHTML;
  btn.innerHTML = "Registering…";
  btn.disabled = true;
  btn.style.opacity = "0.8";

  const result = await SoftSchoolAuth.register({
    schoolId: schoolIdVal,
    username: usernameVal,
    password: password.value,
    code: codeVal,
  });

  btn.innerHTML = origText;
  btn.disabled = false;
  btn.style.opacity = "";

  if (!result.ok) {
    if (result.reason === "conflict" && /already registered/i.test(result.message)) {
      showToast(result.message, "error");
      shakeRegisterCard(schoolId);
    } else if (result.reason === "conflict") {
      showToast(result.message, "error");
      shakeRegisterCard(username);
    } else if (result.reason === "network") {
      showToast(result.message, "error");
    } else {
      showToast(result.message || "School ID or security code is not valid. Please check and try again.", "error");
      shakeRegisterCard(code);
    }
    return;
  }

  document.getElementById("registerForm").reset();
  showToast("Registration successful! You can now login.", "success");
  setTimeout(() => {
    closeRegister();
    setTimeout(() => {
      openLogin();
      const loginUser = document.getElementById("phone");
      if (loginUser) loginUser.value = usernameVal;
    }, 200);
  }, 900);
}

/* ── FORGOT PASSWORD MODAL ── */
let _fpTrap = null;
let _fpLastFocused = null;

function openForgotPassword() {
  const modal = document.getElementById("forgotPasswordModal");
  if (!modal) return;
  _fpLastFocused = document.activeElement;
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  setTimeout(() => {
    const first = document.getElementById("fpSchoolId");
    if (first) first.focus();
  }, 200);
  if (_fpTrap) modal.removeEventListener("keydown", _fpTrap);
  _fpTrap = createFocusTrap(modal);
  modal.addEventListener("keydown", _fpTrap);
}

function closeForgotPassword() {
  const modal = document.getElementById("forgotPasswordModal");
  if (!modal) return;
  modal.classList.remove("open");
  document.body.style.overflow = "";
  if (_fpTrap) {
    modal.removeEventListener("keydown", _fpTrap);
    _fpTrap = null;
  }
  if (_fpLastFocused) {
    _fpLastFocused.focus();
    _fpLastFocused = null;
  }
}

function closeForgotPasswordOutside(e) {
  if (e.target === document.getElementById("forgotPasswordModal")) closeForgotPassword();
}

function openForgotPasswordFromLogin() {
  closeLogin();
  setTimeout(openForgotPassword, 180);
}

function openLoginFromForgotPassword() {
  closeForgotPassword();
  setTimeout(openLogin, 180);
}

function shakeForgotPasswordCard(field) {
  const card = document.getElementById("forgotPasswordCard");
  if (field) field.classList.add("error");
  if (!card) return;
  card.classList.add("shake");
  card.addEventListener("animationend", () => card.classList.remove("shake"), { once: true });
  if (field) field.focus();
}

/* SECURITY: same shared schema validation as login/register. */
async function handleForgotPassword(e) {
  e.preventDefault();

  const schoolId = document.getElementById("fpSchoolId");
  const code = document.getElementById("fpCode");
  const username = document.getElementById("fpUsername");
  const password = document.getElementById("fpPassword");
  const password2 = document.getElementById("fpPassword2");
  const btn = document.getElementById("forgotPasswordBtn");

  [schoolId, code, username, password, password2].forEach((el) => el.classList.remove("error"));

  const fpSchema = {
    schoolId: SSValidate.rules.id({ required: true, maxLength: 40, label: "School ID" }),
    code: SSValidate.rules.text({ required: true, maxLength: 20, label: "Security code" }),
    username: SSValidate.rules.username({ required: true, label: "Username" }),
    password: SSValidate.rules.password({ required: true, label: "New password" }),
  };
  const { ok, values, errors } = SSValidate.validate(
    {
      schoolId: schoolId.value,
      code: code.value,
      username: username.value,
      password: password.value,
    },
    fpSchema
  );

  if (!ok) {
    if (errors.schoolId) { showToast(errors.schoolId, "error"); return shakeForgotPasswordCard(schoolId); }
    if (errors.code) { showToast(errors.code, "error"); return shakeForgotPasswordCard(code); }
    if (errors.username) { showToast(errors.username, "error"); return shakeForgotPasswordCard(username); }
    if (errors.password) { showToast(errors.password, "error"); return shakeForgotPasswordCard(password); }
  }

  const schoolIdVal = values.schoolId;
  const codeVal = values.code.toLowerCase();
  const usernameVal = values.username;

  if (!SoftSchoolAuth.isValidCode(codeVal)) {
    showToast("Security code must be 7 characters using lowercase letters and numbers.", "error");
    return shakeForgotPasswordCard(code);
  }
  if (password.value !== password2.value) {
    showToast("Passwords do not match.", "error");
    return shakeForgotPasswordCard(password2);
  }

  const origText = btn.innerHTML;
  btn.innerHTML = "Resetting…";
  btn.disabled = true;
  btn.style.opacity = "0.8";

  const result = await SoftSchoolAuth.resetPassword({
    schoolId: schoolIdVal,
    code: codeVal,
    username: usernameVal,
    newPassword: password.value,
  });

  btn.innerHTML = origText;
  btn.disabled = false;
  btn.style.opacity = "";

  if (!result.ok) {
    if (result.reason === "network") {
      showToast(result.message, "error");
    } else if (result.message && /username/i.test(result.message)) {
      showToast(result.message, "error");
      shakeForgotPasswordCard(username);
    } else {
      showToast(result.message || "School ID or security code is not valid. Please check and try again.", "error");
      shakeForgotPasswordCard(code);
    }
    return;
  }

  document.getElementById("forgotPasswordForm").reset();
  showToast("Password reset successful! You can now login.", "success");
  setTimeout(() => {
    closeForgotPassword();
    setTimeout(() => {
      openLogin();
      const loginUser = document.getElementById("phone");
      if (loginUser) loginUser.value = usernameVal;
    }, 200);
  }, 900);
}

/* ── LOGIN MODAL ── */
let _loginTrap = null;
let _loginLastFocused = null;

function openLogin() {
  const modal = document.getElementById("loginModal");
  if (!modal) return;
  _loginLastFocused = document.activeElement;
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  selectLoginRole("admin");
  setTimeout(() => {
    const first = modal.querySelector(".login-step:not([style*='display: none']) input");
    if (first) first.focus();
  }, 300);
  if (_loginTrap) modal.removeEventListener("keydown", _loginTrap);
  _loginTrap = createFocusTrap(modal);
  modal.addEventListener("keydown", _loginTrap);
}
function closeLogin() {
  const modal = document.getElementById("loginModal");
  if (!modal) return;
  modal.classList.remove("open");
  document.body.style.overflow = "";
  if (_loginTrap) {
    modal.removeEventListener("keydown", _loginTrap);
    _loginTrap = null;
  }
  if (_loginLastFocused) {
    _loginLastFocused.focus();
    _loginLastFocused = null;
  }
}
function closeLoginOutside(e) {
  if (e.target === document.getElementById("loginModal")) closeLogin();
}

/* ── LOGIN ROLE SWITCHING (admin / teacher / parent) ──
   A persistent tab row stays visible at the top of the login card;
   clicking a tab just swaps which form is shown beneath it. ── */
const LOGIN_STEP_IDS = ["adminLoginStep", "teacherLoginStep", "parentLoginStep"];
const LOGIN_STEP_BY_ROLE = { admin: "adminLoginStep", teacher: "teacherLoginStep", parent: "parentLoginStep" };

function showLoginStep(stepId) {
  LOGIN_STEP_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === stepId ? "" : "none";
  });
  const modal = document.getElementById("loginModal");
  setTimeout(() => {
    if (!modal) return;
    const first = modal.querySelector(`#${stepId} input`);
    if (first) first.focus();
  }, 60);
}

function selectLoginRole(role) {
  const stepId = LOGIN_STEP_BY_ROLE[role];
  if (!stepId) return;
  showLoginStep(stepId);
  document.querySelectorAll(".role-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.getAttribute("data-role") === role);
  });
}

/* ── TEACHER LOGIN (from the unified modal) ── */
function toggleTeacherPwIndex() {
  const pw = document.getElementById("teacherPassIndex");
  const icon = document.getElementById("eyeIconTeacherIndex");
  if (!pw || !icon) return;
  if (pw.type === "password") {
    pw.type = "text";
    icon.className = "fas fa-eye-slash";
  } else {
    pw.type = "password";
    icon.className = "fas fa-eye";
  }
}

function handleTeacherLoginIndex(e) {
  e.preventDefault();
  const idInput = document.getElementById("teacherIdIndex");
  const passInput = document.getElementById("teacherPassIndex");
  const btn = document.getElementById("teacherLoginBtnIndex");
  const card = document.getElementById("loginCard");

  [idInput, passInput].forEach((el) => el.classList.remove("error"));

  if (!idInput.value.trim()) {
    idInput.classList.add("error");
    showToast("Please enter your Teacher ID.", "error");
    return;
  }
  if (!passInput.value.trim()) {
    passInput.classList.add("error");
    showToast("Please enter your password.", "error");
    return;
  }
  if (!window.SoftSchoolTeacher) {
    showToast("Teacher login isn't available right now.", "error");
    return;
  }

  const origText = btn.textContent;
  btn.textContent = "Signing in…";
  btn.disabled = true;
  btn.style.opacity = "0.8";

  setTimeout(() => {
    btn.textContent = origText;
    btn.disabled = false;
    btn.style.opacity = "";

    const result = window.SoftSchoolTeacher.authenticateTeacher(idInput.value, passInput.value);

    if (!result.ok) {
      passInput.classList.add("error");
      if (card) {
        card.classList.add("shake");
        card.addEventListener("animationend", () => card.classList.remove("shake"), { once: true });
      }
      if (result.reason === "not_found") {
        showToast("No teacher found with that ID. Check with your admin.", "error");
      } else {
        showToast("Incorrect password. Please try again.", "error");
      }
      return;
    }

    window.SoftSchoolTeacher.setSession(result.teacher.id);
    showToast("Welcome back, " + result.teacher.name.split(" ")[0] + "!", "success");
    setTimeout(() => { window.location.href = "teacher-portal.html"; }, 700);
  }, 700);
}

/* ── PARENT LOGIN (dummy placeholder until the portal ships) ── */
function handleParentDummy(e) {
  e.preventDefault();
  showToast("Parent portal is coming soon — check back later!", "info");
}

/* ── GLOBAL ESCAPE KEY ── */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeLogin();
  closeVideo();
  closeGetStarted();
});

/* ── MOBILE NAV TOGGLE ── */
const navToggle = document.getElementById("navToggle");
const mainNav = document.getElementById("mainNav");
if (navToggle && mainNav) {
  navToggle.addEventListener("click", () => {
    const isOpen = mainNav.classList.toggle("nav-open");
    navToggle.setAttribute("aria-expanded", isOpen);
    navToggle.querySelector("i").className = isOpen
      ? "fas fa-times"
      : "fas fa-bars";
  });
  mainNav.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => {
      mainNav.classList.remove("nav-open");
      navToggle.setAttribute("aria-expanded", "false");
      navToggle.querySelector("i").className = "fas fa-bars";
    });
  });
}

/* ── PAGE ROUTER (hash-based, single-file) ── */
(function () {
  const TITLES = {
    "#privacy-policy": "Privacy Policy | Soft School",
    "#terms": "Terms & Conditions | Soft School",
  };
  const PAGE_MAP = {
    "#privacy-policy": "page-privacy",
    "#terms": "page-terms",
  };

  function showPage(id) {
    ["page-main", "page-privacy", "page-terms"].forEach((p) => {
      const el = document.getElementById(p);
      if (el) el.hidden = p !== id;
    });
  }

  function route() {
    const hash = location.hash;
    const pageId = PAGE_MAP[hash];
    const isLegal = Boolean(pageId);

    if (
      !isLegal &&
      document.getElementById("page-main") &&
      !document.getElementById("page-main").hidden
    ) {
      return;
    }

    showPage(pageId || "page-main");
    document.title = TITLES[hash] || "Soft School | School Management Software";

    if (
      isLegal ||
      (!isLegal &&
        document.getElementById("page-privacy") &&
        !document.getElementById("page-privacy").hidden) ||
      (!isLegal &&
        document.getElementById("page-terms") &&
        !document.getElementById("page-terms").hidden)
    ) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }

    document.querySelectorAll(".footer-legal a").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("href") === hash);
      a.setAttribute(
        "aria-current",
        a.getAttribute("href") === hash ? "page" : "false",
      );
    });

    if (!isLegal) {
      document.querySelectorAll(".reveal, .reveal-stagger").forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight) {
          el.classList.add("in-view");
        }
      });
    }
  }

  window.addEventListener("hashchange", route);
  window.addEventListener("load", route);
})();

/* ── FAQ ACCORDION ── */
document.querySelectorAll(".faq-item").forEach((item) => {
  const q = item.querySelector(".faq-q");
  if (!q) return;
  q.addEventListener("click", () => {
    const wasOpen = item.classList.contains("open");
    document.querySelectorAll(".faq-item").forEach((i) => {
      i.classList.remove("open");
      const btn = i.querySelector(".faq-q");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
    if (!wasOpen) {
      item.classList.add("open");
      q.setAttribute("aria-expanded", "true");
    }
  });
});

/* ── SCROLL-SPY ACTIVE NAV ── */
(function () {
  const sections = ["hero", "features", "how", "news", "contact"];
  const navLinks = document.querySelectorAll("nav a[data-section]");
  if (!navLinks.length) return;

  function updateActiveNav() {
    let current = "hero";
    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top <= 120) current = id;
    });
    navLinks.forEach((a) => {
      a.classList.toggle("active", a.dataset.section === current);
    });
  }
  document.addEventListener("scroll", updateActiveNav, { passive: true });
  updateActiveNav();
})();

/* ── STAT COUNTER ANIMATION ── */
function animateCount(el) {
  const target = parseFloat(el.dataset.count);
  const suffix = el.dataset.suffix || "";
  const isDecimal = target % 1 !== 0;
  const duration = 1600;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = target * eased;
    el.textContent =
      (isDecimal ? current.toFixed(1) : Math.floor(current).toLocaleString()) +
      suffix;
    if (progress < 1) requestAnimationFrame(tick);
    else
      el.textContent =
        (isDecimal ? target.toFixed(1) : target.toLocaleString()) + suffix;
  }
  requestAnimationFrame(tick);
}

const countEls = document.querySelectorAll("[data-count]");
if (countEls.length) {
  const countObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !entry.target.dataset.done) {
          entry.target.dataset.done = "true";
          animateCount(entry.target);
          countObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.4 },
  );
  countEls.forEach((el) => countObserver.observe(el));
}

/* ── SCROLL-REVEAL (all directions) ── */
const revealEls = document.querySelectorAll(
  ".reveal, .reveal-stagger, .reveal-left, .reveal-right",
);
if (revealEls.length) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -50px 0px" },
  );
  revealEls.forEach((el) => revealObserver.observe(el));
}

/* ── HEADER SCROLL SHADOW ── */
const siteHeader = document.getElementById("siteHeader");
if (siteHeader) {
  function onHeaderScroll() {
    siteHeader.classList.toggle("scrolled", window.scrollY > 12);
  }
  document.addEventListener("scroll", onHeaderScroll, { passive: true });
  onHeaderScroll();
}

/* ── HERO PARALLAX ON MOUSE MOVE ── */
(function () {
  const orbs = document.getElementById("heroOrbs");
  if (!orbs) return;
  document.addEventListener(
    "mousemove",
    (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 18;
      const y = (e.clientY / window.innerHeight - 0.5) * 18;
      orbs.style.transform = `translate(${x}px, ${y}px)`;
    },
    { passive: true },
  );
})();

/* ── TYPEWRITER EFFECT ON HERO TITLE ── */
(function () {
  const target = document.getElementById("twTarget");
  if (!target) return;
  const fullText = target.textContent;
  target.textContent = "";
  const cursor = document.createElement("span");
  cursor.className = "tw-cursor";
  target.appendChild(cursor);

  let i = 0;
  const speed = 65;

  function type() {
    if (i < fullText.length) {
      target.insertBefore(document.createTextNode(fullText[i]), cursor);
      i++;
      setTimeout(type, speed + Math.random() * 30);
    } else {
      setTimeout(() => {
        cursor.style.transition = "opacity 0.6s";
        cursor.style.opacity = "0";
        setTimeout(() => cursor.remove(), 700);
      }, 2000);
    }
  }

  setTimeout(type, 900);
})();

/* ── MAGNETIC BUTTON EFFECT (subtle, non-touch only) ── */
(function () {
  if (window.matchMedia("(hover: none)").matches) return;
  document
    .querySelectorAll(".btn-whatsapp:not(.btn-whatsapp-login), .btn-login")
    .forEach((btn) => {
      btn.addEventListener("mousemove", function (e) {
        const rect = this.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = (e.clientX - cx) * 0.14;
        const dy = (e.clientY - cy) * 0.14;
        this.style.transform = `translate(${dx}px, calc(${dy}px - 3px)) scale(1.02)`;
      });
      btn.addEventListener("mouseleave", function () {
        this.style.transform = "";
      });
    });
})();

/* ── FEATURE CARD TILT EFFECT (desktop only) ── */
(function () {
  if (window.matchMedia("(hover: none)").matches) return;
  document.querySelectorAll(".feature-card").forEach((card) => {
    card.addEventListener("mousemove", function (e) {
      const rect = this.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      const tiltX = y * 6;
      const tiltY = x * -6;
      this.style.transform = `translateY(-10px) scale(1.02) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
    });
    card.addEventListener("mouseleave", function () {
      this.style.transform = "";
      /* Let CSS transition handle the reset */
    });
  });
})();