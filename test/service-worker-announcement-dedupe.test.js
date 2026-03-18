const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSwHarness() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'serviceWorker.js'), 'utf8');
  const pushListeners = [];
  const infoLogs = [];
  const shown = [];
  const context = {
    __FCM_CONFIG__: null,
    console: {
      info: (...args) => infoLogs.push(args),
      warn: () => {},
      error: () => {}
    },
    self: {
      location: { origin: 'https://example.test' },
      registration: {
        showNotification: async (title, options) => {
          shown.push({ title, options });
        }
      },
      addEventListener: (name, cb) => {
        if (name === 'push') pushListeners.push(cb);
      },
      skipWaiting: () => {},
      clients: { claim: () => Promise.resolve() }
    },
    caches: {
      open: async () => ({ put: async () => {} }),
      keys: async () => [],
      match: async () => null,
      delete: async () => true
    },
    clients: {
      matchAll: async () => [],
      openWindow: async () => null
    },
    fetch: async () => ({ ok: true, clone: () => ({}) }),
    URL,
    importScripts: () => {},
    firebase: null,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'serviceWorker.js' });
  return { pushListeners, infoLogs, shown };
}

function makePushEvent(payload) {
  return {
    data: {
      json: () => payload,
      text: () => JSON.stringify(payload)
    },
    waitUntil: (promise) => promise
  };
}

test('trade group announcement suppresses repeated render by announcement id within 60s', async () => {
  const harness = createSwHarness();
  assert.equal(harness.pushListeners.length, 1);
  const onPush = harness.pushListeners[0];

  await onPush(makePushEvent({
    notification: { title: 'Alpha announcement', body: 'Body A' },
    data: {
      type: 'trade_group_announcement',
      correlationId: 'corr-abc',
      announcementId: 'ann-123',
      userId: 'member-1'
    }
  }));

  await onPush(makePushEvent({
    notification: { title: 'Alpha announcement', body: 'Body B changed' },
    data: {
      type: 'trade_group_announcement',
      announcementId: 'ann-123',
      userId: 'member-1'
    }
  }));

  assert.equal(harness.shown.length, 1);
  assert.equal(harness.shown[0].options.tag, 'trade-group-announcement:ann-123');

  const dedupeSkips = harness.infoLogs
    .map((entry) => entry[1])
    .filter((payload) => payload && payload.stage === '11.service_worker_dedupe_skip');
  assert.ok(dedupeSkips.some((item) => item.reason === 'announcement_repeat_within_60s'));
});
