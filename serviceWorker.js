const CACHE_NAME = 'pl-calendar-cache-v30';
const STATIC_ASSETS = [
  '/manifest.json',
  '/static/style.css',
  '/static/script.js',
  '/static/login.js',
  '/static/signup.js',
  '/static/profile.js',
  '/static/transactions.js',
  '/static/Veracity-notification-logo.png'
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
const DEFAULT_NOTIFICATION_ICON = '/static/Veracity-notification-logo.png';
let messaging = null;
const CANONICAL_RENDER_HANDLER = 'push:event';
const HARD_RENDER_DEDUPE_MS = 5 * 60 * 1000;
const EMERGENCY_ANNOUNCEMENT_DEDUPE_MS = 30 * 1000;
const recentRenderedNotifications = new Map();

function hasFcmConfig() {
  return !!(FCM_CONFIG && FCM_CONFIG.apiKey && FCM_CONFIG.projectId && FCM_CONFIG.messagingSenderId && FCM_CONFIG.appId);
}

function cleanupRecentNotificationKeys(nowTs = Date.now()) {
  for (const [key, seenAt] of recentRenderedNotifications.entries()) {
    if ((nowTs - seenAt) > HARD_RENDER_DEDUPE_MS) {
      recentRenderedNotifications.delete(key);
    }
  }
}

function stablePayloadHash(input) {
  const text = String(input || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return String(hash >>> 0);
}

function extractNotificationDescriptor(payload = {}, fallbackTitle = 'Veracity Trading Suite') {
  const notification = payload?.notification || {};
  const data = payload?.data || {};
  const title = notification.title || payload.title || data.title || fallbackTitle;
  const body = notification.body || payload.body || data.body || 'New Veracity notification';
  const correlationId = data.correlationId || payload.correlationId || '';
  const announcementId = data.announcementId || payload.announcementId || '';
  const recipientUserId = data.userId || payload.userId || '';
  const type = data.type || payload.type || '';
  const dedupeBase = correlationId
    || `${announcementId}:${recipientUserId}:${stablePayloadHash(`${title}|${body}`)}`;
  const dedupeKey = `render:${dedupeBase || stablePayloadHash(JSON.stringify(payload || {}))}`;
  return {
    title,
    body,
    dedupeKey,
    correlationId: correlationId || null,
    eventId: data.eventId || payload.eventId || null,
    announcementId: announcementId || null,
    recipientUserId: recipientUserId || null,
    type: type || null
  };
}

function logSwPipelineStage(stage, {
  sourceHandler,
  descriptor,
  skipped = false,
  details = {}
} = {}) {
  console.info('[SW][NotificationPipeline]', {
    stage,
    at: new Date().toISOString(),
    sourceHandler: sourceHandler || 'unknown',
    correlationId: descriptor?.correlationId || null,
    announcementId: descriptor?.announcementId || null,
    recipientUserId: descriptor?.recipientUserId || null,
    dedupeKey: descriptor?.dedupeKey || null,
    skipped,
    ...details
  });
}

async function showNotificationWithGuard({ source, payload, options }) {
  const now = Date.now();
  cleanupRecentNotificationKeys(now);
  const descriptor = extractNotificationDescriptor(payload);
  logSwPipelineStage('9.service_worker_handler_entered', {
    sourceHandler: source,
    descriptor,
    skipped: false,
    details: { notificationType: descriptor.type || null }
  });
  if (source !== CANONICAL_RENDER_HANDLER) {
    logSwPipelineStage('11.service_worker_dedupe_skip', {
      sourceHandler: source,
      descriptor,
      skipped: true,
      details: {
        reason: 'non_canonical_handler',
        message: 'SECONDARY RENDER PATH SKIPPED'
      }
    });
    return;
  }
  logSwPipelineStage('9.service_worker_handler_entered', {
    sourceHandler: source,
    descriptor,
    skipped: false,
    details: {
      message: 'CANONICAL RENDER PATH USED'
    }
  });
  const alreadySeenAt = recentRenderedNotifications.get(descriptor.dedupeKey);
  const duplicateWithinWindow = !!alreadySeenAt && (now - alreadySeenAt) <= HARD_RENDER_DEDUPE_MS;
  const logBase = {
    timestamp: new Date(now).toISOString(),
    sourceHandler: source,
    title: descriptor.title,
    body: descriptor.body,
    dedupeKey: descriptor.dedupeKey,
    correlationId: descriptor.correlationId,
    eventId: descriptor.eventId,
    announcementId: descriptor.announcementId,
    recipientUserId: descriptor.recipientUserId
  };
  if (duplicateWithinWindow) {
    const duplicateAgeMs = now - alreadySeenAt;
    if (descriptor.type === 'trade_group_announcement' && duplicateAgeMs <= EMERGENCY_ANNOUNCEMENT_DEDUPE_MS) {
      logSwPipelineStage('11.service_worker_dedupe_skip', {
        sourceHandler: source,
        descriptor,
        skipped: true,
        details: {
          reason: 'emergency_announcement_duplicate',
          duplicateAgeMs,
          message: 'EMERGENCY DUPLICATE SUPPRESSED'
        }
      });
      return;
    }
    logSwPipelineStage('11.service_worker_dedupe_skip', {
      sourceHandler: source,
      descriptor,
      skipped: true,
      details: {
        reason: 'hard_render_dedupe',
        duplicateAgeMs
      }
    });
    console.info('[SW][NotificationRender] Duplicate render skipped.', {
      ...logBase,
      skipped: true,
      reason: 'recent-render-dedupe',
      firstSeenAt: new Date(alreadySeenAt).toISOString()
    });
    return;
  }
  recentRenderedNotifications.set(descriptor.dedupeKey, now);
  logSwPipelineStage('11.service_worker_dedupe_skip', {
    sourceHandler: source,
    descriptor,
    skipped: false,
    details: {
      reason: 'not_skipped'
    }
  });
  logSwPipelineStage('10.service_worker_showNotification_called', {
    sourceHandler: source,
    descriptor,
    skipped: false
  });
  console.info('[SW][NotificationRender] Rendering notification.', {
    ...logBase,
    skipped: false
  });
  await self.registration.showNotification(descriptor.title, options);
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
        icon: notification.icon || data.icon || DEFAULT_NOTIFICATION_ICON,
        badge: notification.badge || data.badge || DEFAULT_NOTIFICATION_ICON,
        image: notification.image || data.image || undefined,
        tag: notification.tag || data.tag || 'veracity-alert',
        requireInteraction: String(data.requireInteraction || '') === 'true',
        data: {
          link: data.link || payload?.fcmOptions?.link || '/'
        }
      };
      return showNotificationWithGuard({ source: 'firebase.onBackgroundMessage', payload, options });
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
    fetch(request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return resp;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw new Error(`Static asset unavailable: ${url.pathname}`);
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
    icon: payload.icon || payload.notification?.icon || DEFAULT_NOTIFICATION_ICON,
    badge: payload.badge || payload.notification?.badge || DEFAULT_NOTIFICATION_ICON,
    image: payload.image || undefined,
    tag: payload.tag || 'veracity-alert',
    requireInteraction: !!payload.requireInteraction,
    data: payload.data || { link: '/' },
    actions: Array.isArray(payload.actions) ? payload.actions : []
  };
  event.waitUntil(showNotificationWithGuard({ source: 'push:event', payload, options }));
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
