// Receipt Ledger service worker
// Caches the app shell so the camera + form work offline; all API calls
// (Google, Dropbox, currency) go to other origins and are left to the
// network untouched.

const CACHE_VERSION = 'receipt-ledger-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/idb.js',
  './js/config.js',
  './js/currency.js',
  './js/google.js',
  './js/dropbox.js',
  './js/xlsxHelper.js',
  './js/ocr.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only manage same-origin GET requests (the app shell). Everything else
  // (Google/Dropbox/currency APIs, CDN scripts) passes straight through so
  // we never accidentally cache or intercept a token exchange.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Network-first, falling back to the cache only when actually offline.
  // (This used to be cache-first-with-background-refresh, i.e. every load
  // showed whatever was cached and only picked up a code fix on the load
  // AFTER that — one reload to silently refresh the cache, a second reload
  // to finally show it. That's exactly why closing and reopening the app
  // once after a fix was deployed didn't seem to help. Trying the network
  // first means a bug fix shows up the moment you're online, and the app
  // still works offline via the cache exactly as before.)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
