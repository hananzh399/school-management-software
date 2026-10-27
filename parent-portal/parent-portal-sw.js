// Parent Portal – service worker.
// It lets the portal show system notifications (Android Chrome needs a service worker for this) and opens the
// right page when one is tapped. It also understands real Web Push messages, so server push can be added later
// without touching the portal pages.
//
// It also keeps the portal's own static files (scripts, styles, images) so repeat visits and page-to-page
// navigation start instantly. Stale-while-revalidate: the saved copy is shown at once and refreshed in the
// background, so an update is picked up on the next open. API calls and HTML pages are never cached.
var STATIC_CACHE = 'pp-static-v1';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n.indexOf('pp-static-') === 0 && n !== STATIC_CACHE; })
        .map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                       // never the API
  if (!/\.(?:js|css|png|jpe?g|svg|webp|woff2?)$/i.test(url.pathname)) return;
  if (/parent-portal-sw\.js$/.test(url.pathname)) return;
  event.respondWith(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.match(req).then(function (saved) {
        var fresh = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () { return saved; });
        return saved || fresh;
      });
    })
  );
});

// Real push (only used once the backend sends Web Push): { title, body, url, tag }
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'School update', {
    body: data.body || '',
    icon: 'logo-icon.png',
    badge: 'logo-icon.png',
    tag: data.tag || undefined,
    data: { url: data.url || 'parent-portal-index.html' }
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = new URL((event.notification.data && event.notification.data.url) || 'parent-portal-index.html', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) {
        return c.focus().then(function (w) { return w && 'navigate' in w ? w.navigate(target) : null; });
      }
    }
    return self.clients.openWindow(target);
  }));
});
