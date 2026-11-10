// Eenvoudige offline-ondersteuning: eerst netwerk, anders de laatst bewaarde versie.
const CACHE = 'reisblog-v1';
const SHELL = ['./', 'index.html', 'beheer.html', 'config.json', 'manifest.webmanifest',
  'assets/style.css', 'assets/admin.css', 'assets/common.js', 'assets/app.js', 'assets/admin.js',
  'assets/icon.svg', 'assets/icon-192.png',
  'assets/vendor/leaflet/leaflet.js', 'assets/vendor/leaflet/leaflet.css',
  'data/trip.json', 'data/posts.json', 'data/crypto.json'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const key = url.origin + url.pathname; // zonder ?t=… zodat de cache bruikbaar blijft
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && !url.pathname.includes('/photos/')) c.put(key, res.clone());
      return res;
    } catch (err) {
      const hit = await c.match(key);
      if (hit) return hit;
      throw err;
    }
  })());
});
