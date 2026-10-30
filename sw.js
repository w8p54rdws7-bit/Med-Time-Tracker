/*
 * Service worker for Med Time Tracker.
 *
 * Strategy:
 *  - Same-origin requests: network-first, falling back to cache when offline.
 *    (Keeps every load fresh during development/updates, still works offline.)
 *  - Firebase SDK files on gstatic.com: cache-first (they are version-pinned).
 *  - Firestore/API traffic to googleapis.com: never intercepted.
 */
const CACHE_VERSION = 'mtt-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/state.js',
  './js/clock.js',
  './js/router.js',
  './js/util/dom.js',
  './js/util/time.js',
  './js/util/id.js',
  './js/store/localStore.js',
  './js/store/cloudStore.js',
  './js/views/components.js',
  './js/views/dashboard.js',
  './js/views/medForm.js',
  './js/views/history.js',
  './js/views/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    // Cache-first for the version-pinned Firebase SDK.
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Network-first with cache fallback for the app itself.
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || Response.error()))
    );
  }
});
