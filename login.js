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
const DEMO_VIDEO_ID  = '';  // YouTube video ID  e.g. 'dQw4w9WgXcQ'
const DEMO_VIDEO_SRC = '';  // Direct video URL  e.g. 'https://example.com/demo.mp4'


/* ── SCROLL PROGRESS BAR ── */
(function () {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;
  function updateProgress() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    bar.style.width = pct + '%';
  }
  document.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();
})();

/* ── RIPPLE EFFECT ── */
document.querySelectorAll('.btn-ripple').forEach(btn => {
  btn.addEventListener('click', function (e) {
    const rect   = this.getBoundingClientRect();
    const size   = Math.max(rect.width, rect.height);
    const x      = e.clientX - rect.left - size / 2;
    const y      = e.clientY - rect.top  - size / 2;
    const ripple = document.createElement('span');
    ripple.className = 'ripple-wave';
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px;`;
    this.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
});

/* ── TOAST NOTIFICATIONS ── */
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3700);
}

/* ── PASSWORD TOGGLE ── */
function togglePw() {
  const pw   = document.getElementById('password');
  const icon = document.getElementById('eyeIcon');
  if (pw.type === 'password') {
    pw.type = 'text';
    icon.className = 'fas fa-eye-slash';
  } else {
    pw.type = 'password';
    icon.className = 'fas fa-eye';
  }
}

/* ── LOGIN FORM ── */
function handleLogin(e) {
  e.preventDefault();
  const phone = document.getElementById('phone');
  const pass  = document.getElementById('password');
  const btn   = document.getElementById('loginBtn');
  let valid = true;

  [phone, pass].forEach(el => el.classList.remove('error'));

  if (!phone.value.trim()) {
    phone.classList.add('error');
    phone.closest('.login-card').classList.add('shake');
    phone.closest('.login-card').addEventListener('animationend', () => {
      phone.closest('.login-card').classList.remove('shake');
    }, { once: true });
    showToast('Please enter your phone number.', 'error');
    valid = false;
  } else if (!pass.value.trim()) {
    pass.classList.add('error');
    pass.closest('.login-card').classList.add('shake');
    pass.closest('.login-card').addEventListener('animationend', () => {
      pass.closest('.login-card').classList.remove('shake');
    }, { once: true });
    showToast('Please enter your password.', 'error');
    valid = false;
  }

  if (!valid) return;

  const origText = btn.textContent;
  btn.textContent = 'Signing in…';
  btn.disabled = true;
  btn.style.opacity = '0.8';

  setTimeout(() => {
    btn.textContent = origText;
    btn.disabled = false;
    btn.style.opacity = '';
    showToast('Redirecting to your dashboard…', 'success');
  }, 1400);
}

/* ════════════════════════════════════════
   FOCUS TRAP UTILITY
   ════════════════════════════════════════ */
const FOCUSABLE = 'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])';

function createFocusTrap(modalEl) {
  return function handler(e) {
    if (e.key !== 'Tab') return;
    const nodes = Array.from(modalEl.querySelectorAll(FOCUSABLE)).filter(el => !el.closest('[hidden]'));
    if (!nodes.length) return;
    const first = nodes[0];
    const last  = nodes[nodes.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
}

/* ════════════════════════════════════════
   GET STARTED MODAL
   ════════════════════════════════════════ */
let _gsTrap = null;
let _gsLastFocused = null;

function openGetStarted() {
  const modal = document.getElementById('getStartedModal');
  if (!modal) return;
  _gsLastFocused = document.activeElement;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  /* Move focus into modal */
  setTimeout(() => {
    const first = modal.querySelector(FOCUSABLE);
    if (first) first.focus();
  }, 80);
  if (_gsTrap) modal.removeEventListener('keydown', _gsTrap);
  _gsTrap = createFocusTrap(modal);
  modal.addEventListener('keydown', _gsTrap);
}
function closeGetStarted() {
  const modal = document.getElementById('getStartedModal');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
  if (_gsTrap) { modal.removeEventListener('keydown', _gsTrap); _gsTrap = null; }
  if (_gsLastFocused) { _gsLastFocused.focus(); _gsLastFocused = null; }
}
function closeGetStartedOutside(e) {
  if (e.target === document.getElementById('getStartedModal')) closeGetStarted();
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
  const container = document.getElementById('videoContent');
  if (!container) return;

  container.innerHTML = '';

  if (DEMO_VIDEO_ID) {
    /* YouTube embed */
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${DEMO_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1`;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.title = 'Soft School Demo Video';
    container.appendChild(iframe);
  } else if (DEMO_VIDEO_SRC) {
    /* Direct video file */
    const video = document.createElement('video');
    video.src = DEMO_VIDEO_SRC;
    video.controls = true;
    video.autoplay = true;
    video.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#0C3531;';
    container.appendChild(video);
  } else {
    /* Placeholder — video not configured yet */
    const placeholder = document.createElement('div');
    placeholder.className = 'video-placeholder-inner';
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
  const modal = document.getElementById('videoModal');
  if (!modal) return;
  /* Cancel any pending content-clear timer to avoid race condition */
  if (_videoClearTimer) { clearTimeout(_videoClearTimer); _videoClearTimer = null; }
  _videoLastFocused = document.activeElement;
  buildVideoContent();
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    const close = modal.querySelector('.modal-close');
    if (close) close.focus();
  }, 80);
  if (_videoTrap) modal.removeEventListener('keydown', _videoTrap);
  _videoTrap = createFocusTrap(modal);
  modal.addEventListener('keydown', _videoTrap);
}

function closeVideo() {
  const modal = document.getElementById('videoModal');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
  if (_videoTrap) { modal.removeEventListener('keydown', _videoTrap); _videoTrap = null; }
  if (_videoLastFocused) { _videoLastFocused.focus(); _videoLastFocused = null; }
  /* Stop video playback by clearing the content after transition */
  _videoClearTimer = setTimeout(() => {
    const container = document.getElementById('videoContent');
    if (container) container.innerHTML = '';
    _videoClearTimer = null;
  }, 300);
}

function closeVideoOutside(e) {
  if (e.target === document.getElementById('videoModal')) closeVideo();
}

/* ── LOGIN MODAL ── */
let _loginTrap = null;
let _loginLastFocused = null;

function openLogin() {
  const modal = document.getElementById('loginModal');
  if (!modal) return;
  _loginLastFocused = document.activeElement;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const f = document.getElementById('phone'); if (f) f.focus(); }, 300);
  if (_loginTrap) modal.removeEventListener('keydown', _loginTrap);
  _loginTrap = createFocusTrap(modal);
  modal.addEventListener('keydown', _loginTrap);
}
function closeLogin() {
  const modal = document.getElementById('loginModal');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
  if (_loginTrap) { modal.removeEventListener('keydown', _loginTrap); _loginTrap = null; }
  if (_loginLastFocused) { _loginLastFocused.focus(); _loginLastFocused = null; }
}
function closeLoginOutside(e) {
  if (e.target === document.getElementById('loginModal')) closeLogin();
}

/* ── GLOBAL ESCAPE KEY ── */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeLogin();
  closeVideo();
  closeGetStarted();
});

/* ── MOBILE NAV TOGGLE ── */
const navToggle = document.getElementById('navToggle');
const mainNav   = document.getElementById('mainNav');
if (navToggle && mainNav) {
  navToggle.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', isOpen);
    navToggle.querySelector('i').className = isOpen ? 'fas fa-times' : 'fas fa-bars';
  });
  mainNav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      mainNav.classList.remove('nav-open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.querySelector('i').className = 'fas fa-bars';
    });
  });
}

/* ── PAGE ROUTER (hash-based, single-file) ── */
(function () {
  const TITLES = {
    '#privacy-policy': 'Privacy Policy | Soft School',
    '#terms':          'Terms & Conditions | Soft School',
  };
  const PAGE_MAP = {
    '#privacy-policy': 'page-privacy',
    '#terms':          'page-terms',
  };

  function showPage(id) {
    ['page-main', 'page-privacy', 'page-terms'].forEach(p => {
      const el = document.getElementById(p);
      if (el) el.hidden = (p !== id);
    });
  }

  function route() {
    const hash    = location.hash;
    const pageId  = PAGE_MAP[hash];
    const isLegal = Boolean(pageId);

    if (!isLegal && document.getElementById('page-main') &&
        !document.getElementById('page-main').hidden) {
      return;
    }

    showPage(pageId || 'page-main');
    document.title = TITLES[hash] || 'Soft School | School Management Software';

    if (isLegal || (!isLegal && document.getElementById('page-privacy') &&
        !document.getElementById('page-privacy').hidden) ||
        (!isLegal && document.getElementById('page-terms') &&
        !document.getElementById('page-terms').hidden)) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }

    document.querySelectorAll('.footer-legal a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === hash);
      a.setAttribute('aria-current', a.getAttribute('href') === hash ? 'page' : 'false');
    });

    if (!isLegal) {
      document.querySelectorAll('.reveal, .reveal-stagger').forEach(el => {
        if (el.getBoundingClientRect().top < window.innerHeight) {
          el.classList.add('in-view');
        }
      });
    }
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('load', route);
})();

/* ── FAQ ACCORDION ── */
document.querySelectorAll('.faq-item').forEach(item => {
  const q = item.querySelector('.faq-q');
  if (!q) return;
  q.addEventListener('click', () => {
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(i => {
      i.classList.remove('open');
      const btn = i.querySelector('.faq-q');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
    if (!wasOpen) {
      item.classList.add('open');
      q.setAttribute('aria-expanded', 'true');
    }
  });
});

/* ── SCROLL-SPY ACTIVE NAV ── */
(function () {
  const sections = ['hero', 'features', 'how', 'news', 'contact'];
  const navLinks = document.querySelectorAll('nav a[data-section]');
  if (!navLinks.length) return;

  function updateActiveNav() {
    let current = 'hero';
    sections.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top <= 120) current = id;
    });
    navLinks.forEach(a => {
      a.classList.toggle('active', a.dataset.section === current);
    });
  }
  document.addEventListener('scroll', updateActiveNav, { passive: true });
  updateActiveNav();
})();

/* ── STAT COUNTER ANIMATION ── */
function animateCount(el) {
  const target   = parseFloat(el.dataset.count);
  const suffix   = el.dataset.suffix || '';
  const isDecimal = target % 1 !== 0;
  const duration  = 1600;
  const start     = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3);
    const current  = target * eased;
    el.textContent = (isDecimal ? current.toFixed(1) : Math.floor(current).toLocaleString()) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = (isDecimal ? target.toFixed(1) : target.toLocaleString()) + suffix;
  }
  requestAnimationFrame(tick);
}

const countEls = document.querySelectorAll('[data-count]');
if (countEls.length) {
  const countObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.dataset.done) {
        entry.target.dataset.done = 'true';
        animateCount(entry.target);
        countObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.4 });
  countEls.forEach(el => countObserver.observe(el));
}

/* ── SCROLL-REVEAL (all directions) ── */
const revealEls = document.querySelectorAll('.reveal, .reveal-stagger, .reveal-left, .reveal-right');
if (revealEls.length) {
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });
  revealEls.forEach(el => revealObserver.observe(el));
}

/* ── HEADER SCROLL SHADOW ── */
const siteHeader = document.getElementById('siteHeader');
if (siteHeader) {
  function onHeaderScroll() {
    siteHeader.classList.toggle('scrolled', window.scrollY > 12);
  }
  document.addEventListener('scroll', onHeaderScroll, { passive: true });
  onHeaderScroll();
}

/* ── HERO PARALLAX ON MOUSE MOVE ── */
(function () {
  const orbs = document.getElementById('heroOrbs');
  if (!orbs) return;
  document.addEventListener('mousemove', e => {
    const x = (e.clientX / window.innerWidth  - 0.5) * 18;
    const y = (e.clientY / window.innerHeight - 0.5) * 18;
    orbs.style.transform = `translate(${x}px, ${y}px)`;
  }, { passive: true });
})();

/* ── TYPEWRITER EFFECT ON HERO TITLE ── */
(function () {
  const target = document.getElementById('twTarget');
  if (!target) return;
  const fullText = target.textContent;
  target.textContent = '';
  const cursor = document.createElement('span');
  cursor.className = 'tw-cursor';
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
        cursor.style.transition = 'opacity 0.6s';
        cursor.style.opacity = '0';
        setTimeout(() => cursor.remove(), 700);
      }, 2000);
    }
  }

  setTimeout(type, 900);
})();

/* ── MAGNETIC BUTTON EFFECT (subtle, non-touch only) ── */
(function () {
  if (window.matchMedia('(hover: none)').matches) return;
  document.querySelectorAll('.btn-whatsapp:not(.btn-whatsapp-login), .btn-login').forEach(btn => {
    btn.addEventListener('mousemove', function (e) {
      const rect = this.getBoundingClientRect();
      const cx   = rect.left + rect.width  / 2;
      const cy   = rect.top  + rect.height / 2;
      const dx   = (e.clientX - cx) * 0.14;
      const dy   = (e.clientY - cy) * 0.14;
      this.style.transform = `translate(${dx}px, calc(${dy}px - 3px)) scale(1.02)`;
    });
    btn.addEventListener('mouseleave', function () {
      this.style.transform = '';
    });
  });
})();

/* ── FEATURE CARD TILT EFFECT (desktop only) ── */
(function () {
  if (window.matchMedia('(hover: none)').matches) return;
  document.querySelectorAll('.feature-card').forEach(card => {
    card.addEventListener('mousemove', function (e) {
      const rect = this.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width  - 0.5;
      const y = (e.clientY - rect.top)  / rect.height - 0.5;
      const tiltX = y * 6;
      const tiltY = x * -6;
      this.style.transform = `translateY(-10px) scale(1.02) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
    });
    card.addEventListener('mouseleave', function () {
      this.style.transform = '';
      /* Let CSS transition handle the reset */
    });
  });
})();
