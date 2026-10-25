// Parent Portal – service worker.
// It lets the portal show system notifications (Android Chrome needs a service worker for this) and opens the
// right page when one is tapped. It also understands real Web Push messages, so server push can be added later
// without touching the portal pages. It does not cache anything.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

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
