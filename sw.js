// PolyMind Service Worker — offline cache + push notifications
const CACHE_VERSION = 'polymind-v3';
const PRECACHE = ['/', '/index.html', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

// ── Install: pre-cache shell ──────────────────────────────────────────────────
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(c) { return c.addAll(PRECACHE); })
  );
  self.skipWaiting();
});

// ── Activate: delete old cache versions ───────────────────────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_VERSION; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ── Fetch: network-first for navigation, cache-first for assets ───────────────
self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  // Skip cross-origin requests (APIs, CDN fonts, flags)
  if (!req.url.startsWith(self.location.origin)) return;
  // Skip Netlify function calls
  if (req.url.includes('/api/') || req.url.includes('/.netlify/')) return;

  if (req.mode === 'navigate') {
    // Navigation: network-first, fall back to cached shell
    e.respondWith(
      fetch(req).then(function(res) {
        var clone = res.clone();
        caches.open(CACHE_VERSION).then(function(c) { c.put('/index.html', clone); });
        return res;
      }).catch(function() { return caches.match('/index.html'); })
    );
    return;
  }

  // Assets: cache-first, update cache in background
  e.respondWith(
    caches.match(req).then(function(cached) {
      var network = fetch(req).then(function(res) {
        if (res && res.status === 200) {
          var clone = res.clone();
          caches.open(CACHE_VERSION).then(function(c) { c.put(req, clone); });
        }
        return res;
      });
      return cached || network;
    })
  );
});

// ── Notifications: bridge from page context ───────────────────────────────────
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
    data: { alertId: data.alertId || null }
  };
  try { self.registration.showNotification(title, options); } catch(err) {}
});

// ── Notification click: focus or open app ────────────────────────────────────
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

// ── Push (future use) ─────────────────────────────────────────────────────────
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
