/* Soft School — splash screen controller
   Plays once per browser tab/session (logging out or going back to the
   login page does not replay it). To show it on EVERY load of index.html,
   set SHOW_ONCE_PER_SESSION = false. */
(function () {
  var SHOW_ONCE_PER_SESSION = true;
  var KEY = 'softschool_splash_seen';
  var TOTAL_MS = 2600;      // when the splash starts fading out
  var REMOVE_MS = 450;      // fade duration (matches CSS)

  var root = document.documentElement;
  var el = document.getElementById('splash');
  if (!el) return;

  if (root.classList.contains('splash-skip')) { el.remove(); return; }

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.classList.add('splash-on');
  try { if (SHOW_ONCE_PER_SESSION) sessionStorage.setItem(KEY, '1'); } catch (e) {}

  var finished = false;
  function finish() {
    if (finished) return; finished = true;
    el.classList.add('splash-hide');
    // release the page (and its entrance animations) as the fade begins
    root.classList.remove('splash-on');
    // tell the page the splash is gone (starts the hero typing animation)
    window.__splashDone = true;
    try { document.dispatchEvent(new Event('splash:done')); } catch (e) {}
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, REMOVE_MS + 50);
  }

  // Start once the logo layers are decoded (no pop-in), but never wait long.
  var started = false;
  function start() {
    if (started) return; started = true;
    requestAnimationFrame(function () {
      el.classList.add('go');
      setTimeout(finish, reduce ? 700 : TOTAL_MS);
    });
  }
  var imgs = Array.prototype.slice.call(el.querySelectorAll('img'));
  Promise.all(imgs.map(function (i) {
    return (i.decode ? i.decode() : Promise.resolve()).catch(function () {});
  })).then(start);
  setTimeout(start, 600); // safety net

  // click / key = skip
  el.addEventListener('click', finish);
  document.addEventListener('keydown', function (e) {
    if (!finished && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) finish();
  });
})();
