const CACHE = 'kayroslab-v1';
const ASSETS = [
  './',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const ct = res.headers.get('content-type') || '';
      if (res.ok && (ct.startsWith('text/') || ct.startsWith('application/') || e.request.url.match(/\.(js|css|svg|png|woff2?)$/))) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, copy));
      }
      return res;
    })).catch(() => caches.match('./'))
  );
});
