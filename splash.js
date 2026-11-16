/* Soft School — splash screen controller
   Shows once each time the software is opened (per browser tab / app session),
   so logging out or navigating back to the login page does not replay it.
   To show it on EVERY load of index.html, set SHOW_ONCE_PER_SESSION = false. */
(function () {
  var SHOW_ONCE_PER_SESSION = true;
  var KEY = 'softschool_splash_seen';
  var TOTAL_MS = 5000;      // when the splash starts fading out
  var REMOVE_MS = 700;      // fade duration (matches CSS)

  var root = document.documentElement;
  var el = document.getElementById('splash');
  if (!el) return;

  if (root.classList.contains('splash-skip')) { el.remove(); return; }

  root.classList.add('splash-on');
  try { if (SHOW_ONCE_PER_SESSION) sessionStorage.setItem(KEY, '1'); } catch (e) {}

  var finished = false;
  function finish() {
    if (finished) return; finished = true;
    el.classList.add('splash-hide');
    setTimeout(function () {
      root.classList.remove('splash-on');
      if (el.parentNode) el.parentNode.removeChild(el);
    }, REMOVE_MS + 50);
  }

  // Start animations only after all logo layers are decoded (no pop-in)
  var imgs = Array.prototype.slice.call(el.querySelectorAll('img'));
  var started = false;
  function start() {
    if (started) return; started = true;
    el.classList.add('go');
    setTimeout(finish, TOTAL_MS);
  }
  Promise.all(imgs.map(function (i) {
    return (i.decode ? i.decode() : Promise.resolve()).catch(function () {});
  })).then(start);
  setTimeout(start, 1500); // safety net

  // click / key = skip
  el.addEventListener('click', finish);
  document.addEventListener('keydown', function (e) {
    if (!finished && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) finish();
  });
})();
