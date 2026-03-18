const CACHE_NAME = 'pl-calendar-cache-v27';
const STATIC_ASSETS = [
  '/manifest.json',
  '/static/style.css',
  '/static/script.js',
  '/static/login.js',
  '/static/signup.js',
  '/static/profile.js',
  '/static/transactions.js'
];
const PRECACHE_URLS = [
  '/index.html',
  '/login.html',
  '/signup.html',
  '/profile.html',
  '/transactions.html',
  ...STATIC_ASSETS
];

const FCM_CONFIG = __FCM_CONFIG__;
let messaging = null;

function hasFcmConfig() {
  return !!(FCM_CONFIG && FCM_CONFIG.apiKey && FCM_CONFIG.projectId && FCM_CONFIG.messagingSenderId && FCM_CONFIG.appId);
}

if (hasFcmConfig()) {
  try {
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
    firebase.initializeApp(FCM_CONFIG);
    messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const notification = payload?.notification || {};
      const data = payload?.data || {};
      const options = {
        body: notification.body || data.body || 'New Veracity notification',
        icon: notification.icon || data.icon || '/static/icons/icon-192x192.png',
        badge: notification.badge || data.badge || '/static/icons/icon-192x192.png',
        image: notification.image || data.image || undefined,
        tag: notification.tag || data.tag || 'veracity-alert',
        requireInteraction: String(data.requireInteraction || '') === 'true',
        data: {
          link: data.link || payload?.fcmOptions?.link || '/'
        }
      };
      self.registration.showNotification(notification.title || data.title || 'Veracity Trading Suite', options);
    });
  } catch (error) {
    console.warn('[SW] Unable to initialize Firebase messaging:', error);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.info('[SW] Install started');
      for (const url of PRECACHE_URLS) {
        try {
          const response = await fetch(url, { cache: 'no-store' });
          if (!response || !response.ok) {
            console.warn('[SW] Skipping cache (bad response):', url, response?.status);
            continue;
          }
          await cache.put(url, response.clone());
          console.info('[SW] Cached asset:', url);
        } catch (error) {
          console.warn('[SW] Skipping cache (fetch failed):', url, error);
        }
      }
      console.info('[SW] Install completed');
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys
      .filter((k) => k !== CACHE_NAME)
      .map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return resp;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return caches.match('/login.html');
        })
    );
    return;
  }

  const url = new URL(request.url);
  if (!STATIC_ASSETS.includes(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return resp;
      });
    })
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch (error) {
    payload = { title: 'Veracity Trading Suite', body: event.data.text() };
  }
  const options = {
    body: payload.body || payload.notification?.body || 'New Veracity notification',
    icon: payload.icon || '/static/icons/icon-192x192.png',
    badge: payload.badge || '/static/icons/icon-192x192.png',
    image: payload.image || undefined,
    tag: payload.tag || 'veracity-alert',
    requireInteraction: !!payload.requireInteraction,
    data: payload.data || { link: '/' },
    actions: Array.isArray(payload.actions) ? payload.actions : []
  };
  event.waitUntil(self.registration.showNotification(payload.title || 'Veracity Trading Suite', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetPath = event.notification?.data?.link || '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      const sameOrigin = client.url.startsWith(self.location.origin);
      if (!sameOrigin) continue;
      if ('focus' in client) {
        await client.focus();
      }
      if ('navigate' in client) {
        await client.navigate(targetPath);
      }
      return;
    }
    if (clients.openWindow) {
      await clients.openWindow(targetPath);
    }
  })());
});
