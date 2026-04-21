// PolyMind Service Worker — notification support
// This SW enables push notifications for live alerts

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(self.clients.claim());
});

// Bridge from page context — the page posts { type:'NOTIFY', ... } and the SW
// shows the OS-level notification via self.registration.
self.addEventListener('message', function(e) {
  var data = e.data || {};
  if (data.type !== 'NOTIFY') return;
  var title = data.title || 'PolyMind Alert';
  var options = {
    body: data.body || 'New signal detected',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'polymind-alert',
    renotify: true,
    data: { alertId: data.alertId || null },
  };
  try { self.registration.showNotification(title, options); } catch (err) {}
});

// Handle notification clicks — focus or open the app
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].url.includes(self.location.origin) && 'focus' in clients[i]) {
          return clients[i].focus();
        }
      }
      return self.clients.openWindow('/');
    })
  );
});

// Listen for push events (future use)
self.addEventListener('push', function(e) {
  var data = e.data ? e.data.json() : {};
  var title = data.title || 'PolyMind Alert';
  var options = {
    body: data.body || 'New signal detected',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'polymind-alert',
    renotify: true
  };
  e.waitUntil(self.registration.showNotification(title, options));
});
