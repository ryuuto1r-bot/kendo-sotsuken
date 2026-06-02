const CACHE_NAME = 'kendo-virtual-coach-mediapipe-precision-v132';
const APP_SHELL = [
  './',
  './index.html',
  './research/',
  './research/index.html',
  './research/history.html',
  './research/apple-research.css',
  './manifest.webmanifest',
  './icon.svg',
  './vendor/three/three.module.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.headers.has('range') || request.destination === 'video' || request.destination === 'audio') {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname === '/' || url.pathname.endsWith('/research/') || url.pathname.endsWith('/research/index.html')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).then(response => {
        const copy = response.clone();
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      }).catch(() => {
        if (url.pathname.endsWith('/research/') || url.pathname.endsWith('/research/index.html')) return caches.match('./research/index.html');
        return caches.match('./index.html');
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        const copy = response.clone();
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => {
        if (request.mode === 'navigate' && url.pathname.endsWith('/research/')) return caches.match('./research/index.html');
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
