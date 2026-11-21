const prefix = 'echo-neck:' + new URL(self.registration.scope).pathname + ':';
const cacheName = prefix + '20261121.7';
const assets = [
  './',
  './index.html',
  './style.css',
  './main.js',
  './pad.js',
  './scope.js',
  './engine.js',
  './camera.js',
  './audio.js',
  './manifest.webmanifest',
  './assets/icon-192.png',
  './assets/icon-512.png',
  ...['up', 'down', 'left', 'right', 'ready', 'close', 'paused', 'end'].map(
    (n) => './assets/voice/' + n + '.wav',
  ),
  './vendor/mediapipe/vision_bundle.mjs',
  './vendor/mediapipe/face_landmarker.task',
  ...['vision_wasm_internal', 'vision_wasm_nosimd_internal'].flatMap((n) =>
    ['js', 'wasm'].map((ext) => './vendor/mediapipe/wasm/' + n + '.' + ext),
  ),
];
self.addEventListener('install', (e) =>
  e.waitUntil(
    (async () => {
      const c = await caches.open(cacheName);
      await c.addAll(assets.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;
  e.respondWith(
    (async () => {
      const c = await caches.open(cacheName);
      const hit = await c.match(e.request.mode === 'navigate' ? './index.html' : e.request, {
        ignoreSearch: true,
      });
      return hit || fetch(e.request);
    })(),
  );
});
