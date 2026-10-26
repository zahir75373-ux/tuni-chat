/* Tuni-Chat service worker: cache the app shell; big voice/vision files go to a separate, never-deleted cache. */
var CACHE = 'tuni-chat-v1';
var MODEL_CACHE = 'tuni-chat-model-v1';
var SHELL = ['./', 'index.html', 'app.css', 'app.js', 'store.js', 'content.js', 'safety.js', 'emotion.js', 'brain.js', 'tts.js', 'tts-worker.js', 'stt.js', 'face.js', 'cartoons.js', 'puppet.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'pack.json', 'model/bn.onnx.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE && k !== MODEL_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
function isBig(u) { return /\/(vendor|model)\//.test(u.pathname) && !/bn\.onnx\.json$/.test(u.pathname); }
self.addEventListener('fetch', function (e) {
  var req = e.request; if (req.method !== 'GET') return;
  var u = new URL(req.url); if (u.origin !== location.origin) return;
  if (req.mode === 'navigate' || /\/index\.html$/.test(u.pathname)) {
    e.respondWith(new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { caches.match('index.html').then(function (r) { if (r && !done) { done = true; resolve(r); } }); }, 4000);
      fetch(req).then(function (r) {
        clearTimeout(timer); if (done) return; done = true;
        if (r.ok) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put('index.html', cp); }); } resolve(r);
      }, function () { clearTimeout(timer); if (!done) { done = true; caches.match('index.html').then(function (r) { resolve(r || new Response('offline', { status: 503 })); }); } });
    }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: false }).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (r) {
      if (r && r.ok && r.status === 200) {
        var cp = r.clone(), big = isBig(u);
        // large files are cached only by the explicit voice download (progress shown); other small files lazily
        if (!big) caches.open(CACHE).then(function (c) { c.put(req, cp); });
      }
      return r;
    });
  }));
});
