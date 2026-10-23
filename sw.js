// Service Worker（仕様書 8章）
// 同じオリジンに別アプリ（ジム記録アプリ）がいるため、触るキャッシュは shoppinglist- で始まるものだけにする。
importScripts('./version.js');

const PREFIX = 'shoppinglist-';
const CACHE = PREFIX + self.SHOPPINGLIST_VERSION;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './version.js',
  './util.js',
  './db.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // 新しい版は、次回の起動時に反映する（skipWaiting はしない）
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(PREFIX) && name !== CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // このアプリのパス配下の GET だけを扱う（他アプリのURLには触れない）
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;

  event.respondWith((async () => {
    // caches.match() は他アプリのキャッシュも探すため、自分のキャッシュだけを開いて探す
    const cache = await caches.open(CACHE);
    if (request.mode === 'navigate') {
      const page = await cache.match('./index.html');
      if (page) return page;
    }
    const hit = await cache.match(request, { ignoreSearch: true });
    return hit || fetch(request);
  })());
});
