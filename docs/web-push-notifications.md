# Web Push Notifications (FCM)

This project now supports production-style browser push notifications for desktop, Android, and iOS/iPadOS **Home Screen PWAs**.

## Required environment variables

Client-visible Firebase config:

- `FCM_API_KEY`
- `FCM_AUTH_DOMAIN`
- `FCM_PROJECT_ID`
- `FCM_MESSAGING_SENDER_ID`
- `FCM_APP_ID`
- `FCM_VAPID_KEY`

Server-side Firebase Admin credentials (never expose to client):

- `FCM_PROJECT_ID`
- `FCM_CLIENT_EMAIL`
- `FCM_PRIVATE_KEY` (supports escaped `\n` line breaks)

Optional hardening:

- `NOTIFICATION_TEST_RATE_LIMIT_MAX` (default `5`)
- `NOTIFICATION_TEST_RATE_LIMIT_WINDOW_MS` (default `3600000`)
- `INTERNAL_NOTIFICATION_SECRET` (required for `/api/notifications/internal/send`)

## Render deployment notes

1. Add all variables above in Render service environment settings.
2. Redeploy so both the app server and service worker can consume the config.
3. Verify `/api/notifications/config` returns `supported: true`.

## How to test

### Desktop browser

1. Login and open `Profile -> Notifications`.
2. Click **Enable notifications**.
3. Allow permission in browser prompt.
4. Click **Send test notification**.
5. Confirm OS-level notification appears even when tab is backgrounded.

### Android

1. Open site in Chrome.
2. Enable notifications from the same Profile section.
3. Send test notification and verify Android system notification tray delivery.

### iPhone/iPad

Safari tabs do **not** support standard web push behavior for this app context.

1. Open the site in Safari.
2. Tap **Share** -> **Add to Home Screen**.
3. Launch the installed Home Screen app.
4. Enable notifications in Profile -> Notifications.
5. Send a test notification.

## API surface

- `GET /api/notifications/config`
- `GET /api/notifications/devices`
- `POST /api/notifications/devices/register`
- `PUT /api/notifications/devices/:id/preferences`
- `POST /api/notifications/devices/:id/disable`
- `DELETE /api/notifications/devices/:id`
- `POST /api/notifications/devices/:id/received`
- `POST /api/notifications/test`
- `POST /api/notifications/internal/send`

## Current platform limitations

- iOS/iPadOS push requires Home Screen-installed PWA context.
- Browser-level sound behavior is best effort and can be overridden by OS/browser policy.
- This app stores durable device subscriptions in the JSON datastore used by the app.
