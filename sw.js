/* Offline shell for kateb.html / hanan.html (installable app). Reading still needs the internet.
   Same-origin files: network first (updates arrive at once), cache as fallback.
   CDN libraries (versioned URLs): cache first. Gemini calls are never touched. */
var CACHE = 'kateb-v56';
var SHELL = ['kateb.html', 'hanan.html', 'kateb.webmanifest', 'hanan.webmanifest',
  'kateb/style.css?v=56', 'kateb/engine.js?v=56', 'kateb/verify.js?v=56', 'kateb/docx.js?v=56', 'kateb/exam.js?v=56', 'kateb/app.js?v=56',
  'kateb/office.js?v=56', 'kateb/bank.js?v=56', 'kateb/arabic.js?v=56', 'kateb/scan.js?v=56', 'kateb/store.js?v=56', 'kateb/sync.js?v=56', 'kateb/learn.js?v=56', 'kateb/fields.js?v=56', 'kateb/memory.js?v=56', 'kateb/bank/memory.json?v=56', 'kateb/speech.js?v=56', 'kateb/localasr.js?v=56', 'kateb/geminilive.js?v=56', 'kateb/practice.js?v=56', 'kateb/vendor/temml.min.js?v=56', 'kateb/vendor/mathml2omml.js?v=56', 'kateb/vendor/temml.css?v=56', 'kateb/raster.js?v=56', 'kateb/dict.js?v=56', 'kateb/ocr.js?v=56', 'kateb/bank/glossary.json?v=56', 'kateb/templates/templates.json?v=56',
  'kateb/templates/announce.docx?v=56', 'kateb/templates/gift.docx?v=56', 'kateb/templates/inherit_announce.docx?v=56', 'kateb/templates/inherit_request.docx?v=56', 'kateb/templates/iqrar.docx?v=56', 'kateb/templates/memo.docx?v=56', 'kateb/templates/price.docx?v=56', 'kateb/templates/reannounce.docx?v=56', 'kateb/templates/sahifa.docx?v=56', 'kateb/templates/sale.docx?v=56', 'kateb/templates/sihha.docx?v=56', 'kateb/templates/warning.docx?v=56',
  'kateb/icons/kateb-192.png', 'kateb/icons/hanan-192.png',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  ];   // v56: pdf.js (1.4 MB) is no longer precached — it is cached on first use

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
  if (req.method !== 'GET' || /generativelanguage\.googleapis\.com$|api\.anthropic\.com$/.test(url.hostname) || /version\.json/.test(url.pathname)) return;
  if (url.origin === location.origin) {
    /* v55: versioned scripts/styles and data files are served from the cache at once (a start no longer waits on the
       network for ~40 files) and refreshed in the background; the HTML itself still revalidates, so a new version's
       new ?v= names are fetched fresh */
    var script = /\.(js|css)$/.test(url.pathname), versioned = /[?&]v=\d+/.test(url.search) || /\/vendor\/|\/templates\/|\/bank\/|\/dict\/|\/icons\//.test(url.pathname);
    if (req.mode !== 'navigate' && versioned) {
      e.respondWith(caches.match(req, { ignoreSearch: !script }).then(function (hit) {
        var net = fetch(req).then(function (r) { if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); } return r; });
        if (hit) { net.catch(function () {}); return hit; }
        return net;
      }));
      return;
    }
    /* v56: the page itself opens from the cache at once and is refreshed behind it (the app's own version check
       reloads when a new version has landed); first visit or no copy → network as before */
    if (req.mode === 'navigate') {
      e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(new Request(req, { cache: 'no-cache' })).then(function (r) { if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); } return r; });
        if (hit) { net.catch(function () {}); return hit; }
        return net.catch(function () { return caches.match(url.pathname.replace(/^\//, '') || 'kateb.html', { ignoreSearch: true }); });
      }));
      return;
    }
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return r;
    }).catch(function () {
      /* v52: data files (templates, banks, dictionaries) are looked up without their ?v= — the code and the precache
         list carry different numbers, so offline Word export with an office template used to fail */
      return caches.match(req, { ignoreSearch: req.mode === 'navigate' || !script });
    }));
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
