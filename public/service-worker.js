const CACHE_PREFIX = 'comlab-static-';
const CACHE_NAME = 'comlab-static-v1';
const OFFLINE_PAGE = '/offline.html';
const STATIC_PATH = /^\/(?:css|js|images)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([OFFLINE_PAGE, '/images/comlab-app-192.png', '/images/comlab-app-512.png']))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(async () => {
        const cachedOfflinePage = await caches.match(OFFLINE_PAGE);
        return cachedOfflinePage || new Response('ComLab is offline. Reconnect and try again.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
    );
    return;
  }

  if (!STATIC_PATH.test(url.pathname)) return;
  event.respondWith(
    fetch(request, { cache: 'no-cache' }).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
      }
      return response;
    }).catch(async () => {
      const cachedAsset = await caches.match(request);
      if (cachedAsset) return cachedAsset;
      return new Response('', { status: 504, statusText: 'Asset unavailable offline' });
    })
  );
});
