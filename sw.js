/* Offline shell for kateb.html / hanan.html (installable app). Reading still needs the internet.
   Same-origin files: network first (updates arrive at once), cache as fallback.
   CDN libraries (versioned URLs): cache first. Gemini calls are never touched. */
var CACHE = 'kateb-v3';
var SHELL = ['kateb.html', 'hanan.html', 'kateb.webmanifest', 'hanan.webmanifest',
  'kateb/style.css?v=3', 'kateb/engine.js?v=3', 'kateb/verify.js?v=3', 'kateb/docx.js?v=3', 'kateb/exam.js?v=3', 'kateb/app.js?v=3',
  'kateb/icons/kateb-192.png', 'kateb/icons/hanan-192.png',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));   // one missing file must not block the rest
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || /generativelanguage\.googleapis\.com$/.test(url.hostname)) return;
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return r;
    }).catch(function () { return caches.match(req, { ignoreSearch: req.mode === 'navigate' }); }));
    return;
  }
  if (/^(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (r) {
        if (r.ok || r.type === 'opaque') { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return r;
      });
    }));
  }
});
