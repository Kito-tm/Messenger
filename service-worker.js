/* Kitogram service worker
   Кэшируем только «оболочку» и иконки. HTML/JS/CSS всегда берём из сети,
   чтобы после обновления приложения не показывалась старая версия. */
const CACHE = 'kitogram-shell-v4';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './js/core.js',
  './js/viewer.js',
  './js/data.js',
  './js/auth.js',
  './js/ui.js',
  './js/messages.js',
  './js/groups.js',
  './js/settings.js',
  './js/newchat.js',
  './js/profile.js',
  './js/boot.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Firebase и любые сторонние запросы не трогаем
  if (url.origin !== self.location.origin) return;

  const isAsset = /\.(png|jpg|jpeg|webp|svg|ico|woff2?|ttf)$/i.test(url.pathname);

  if (isAsset) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // HTML / JS / CSS / manifest: сначала сеть, при офлайне — кэш
  event.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});

/* Push-уведомления (если сервер начнёт их присылать) */
self.addEventListener('push', (event) => {
  let data = { title: 'Kitogram', body: 'Новое сообщение' };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; }
    catch (e) { data.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      vibrate: [80, 40, 80],
      data: { url: data.url || './' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow((event.notification.data && event.notification.data.url) || './');
    })
  );
});
