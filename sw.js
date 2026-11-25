const CACHE_NAME = 'golfos-jueves-v6';
const TAILWIND_URL = 'https://cdn.tailwindcss.com/';
const ASSETS = [
  '/',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/caddy.js',
  '/caddy.css',
  '/caddy-vivo.js',
  '/caddy-vivo.css',
  '/caddy-data.json',
  '/caddy-campos.json',
  '/caddy-grupo.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(ASSETS);
      // Los estilos también deben abrir sin señal en la cancha; si falla, no detiene la instalación
      try {
        await cache.put(TAILWIND_URL, await fetch(TAILWIND_URL, { mode: 'no-cors' }));
      } catch (e) { /* se guarda en la siguiente visita con red */ }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Tailwind: lo guardado primero para abrir sin señal; se refresca por detrás
  if (url.hostname === 'cdn.tailwindcss.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(TAILWIND_URL);
        const network = fetch(event.request)
          .then((response) => {
            if (response) cache.put(TAILWIND_URL, response.clone()).catch(() => {});
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Normalize /index.html requests to / so installed PWAs never hit a 308 redirect
  const isDocRequest =
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/index.html';

  if (isDocRequest) {
    event.respondWith(
      fetch('/', { cache: 'no-store' })
        .then((response) => {
          if (response && response.ok && !response.redirected) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Caddy PTC: red primero para que el dato de Garmin y el módulo salgan frescos
  if (/^\/caddy[.-]/.test(url.pathname)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok && !response.redirected) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
