const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runNewsNotificationFanout,
  getDueDeliveryWindowsForEvent,
  shouldDeliverEventToUser,
  buildDeliveryLogKeyFields,
  buildChannelPayload,
  WINDOW_KEY_IMMEDIATE,
  WINDOW_KEY_ONE_DAY_BEFORE,
  WINDOW_KEY_ONE_HOUR_BEFORE,
  WINDOW_KEY_FIFTEEN_MINUTES_BEFORE,
  WINDOW_KEY_DAILY_DIGEST
} = require('../services/news/newsNotificationFanoutService');

function pref(overrides = {}) {
  return {
    macroEnabled: true,
    earningsEnabled: true,
    stockNewsEnabled: true,
    worldNewsEnabled: true,
    internalPostsEnabled: true,
    portfolioOnly: false,
    watchlistOnly: false,
    highImportanceOnly: false,
    notifyPush: true,
    notifyInApp: true,
    notifyEmail: true,
    notifyImmediate: true,
    notifyOneDayBefore: true,
    notifyOneHourBefore: true,
    notifyFifteenMinutesBefore: true,
    dailyDigestEnabled: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    ...overrides
  };
}

function event(overrides = {}) {
  return {
    id: 'evt-1',
    sourceType: 'earnings',
    eventType: 'earnings',
    title: 'AAPL Earnings',
    summary: 'Quarterly report',
    importance: 90,
    scheduledAt: '2026-04-15T10:00:00.000Z',
    publishedAt: null,
    isActive: true,
    metadataJson: { relevanceUserIds: ['alice'] },
    ...overrides
  };
}

test('delivery windows calculate deterministically for scheduled events', () => {
  const scheduled = event({ scheduledAt: '2026-04-15T10:00:00.000Z' });

  let windows = getDueDeliveryWindowsForEvent(scheduled, '2026-04-14T10:03:00.000Z', pref(), { windowGraceMs: 5 * 60 * 1000 });
  assert.ok(windows.some((item) => item.key === WINDOW_KEY_ONE_DAY_BEFORE));

  windows = getDueDeliveryWindowsForEvent(scheduled, '2026-04-15T09:03:00.000Z', pref(), { windowGraceMs: 5 * 60 * 1000 });
  assert.ok(windows.some((item) => item.key === WINDOW_KEY_ONE_HOUR_BEFORE));

  windows = getDueDeliveryWindowsForEvent(scheduled, '2026-04-15T09:48:00.000Z', pref(), { windowGraceMs: 5 * 60 * 1000 });
  assert.ok(windows.some((item) => item.key === WINDOW_KEY_FIFTEEN_MINUTES_BEFORE));

  windows = getDueDeliveryWindowsForEvent(scheduled, '2026-04-15T10:02:00.000Z', pref(), { windowGraceMs: 5 * 60 * 1000 });
  assert.ok(windows.some((item) => item.key === WINDOW_KEY_IMMEDIATE));
});

test('published events trigger immediate window only', () => {
  const published = event({
    id: 'pub-1',
    sourceType: 'news',
    eventType: 'stock_news',
    scheduledAt: null,
    publishedAt: '2026-04-15T10:00:00.000Z'
  });
  const windows = getDueDeliveryWindowsForEvent(published, '2026-04-15T10:02:00.000Z', pref(), { windowGraceMs: 5 * 60 * 1000 });
  assert.deepEqual(windows.map((item) => item.key).filter((key) => key !== WINDOW_KEY_DAILY_DIGEST), [WINDOW_KEY_IMMEDIATE]);
});

test('world headline immediate delivery respects worldNewsEnabled preference', () => {
  const decisionDisabled = shouldDeliverEventToUser({
    userId: 'alice',
    event: event({
      sourceType: 'news',
      eventType: 'world_news',
      scheduledAt: null,
      publishedAt: '2026-04-15T10:00:00.000Z'
    }),
    preferences: pref({ worldNewsEnabled: false }),
    now: '2026-04-15T10:01:00.000Z',
    deliveryWindow: { key: WINDOW_KEY_IMMEDIATE },
    shouldNotifyUserForEvent: () => true,
    isEventRelevantToUser: () => true
  });
  assert.equal(decisionDisabled.allowed, false);

  const decisionEnabled = shouldDeliverEventToUser({
    userId: 'alice',
    event: event({
      sourceType: 'news',
      eventType: 'world_news',
      scheduledAt: null,
      publishedAt: '2026-04-15T10:00:00.000Z'
    }),
    preferences: pref({ worldNewsEnabled: true }),
    now: '2026-04-15T10:01:00.000Z',
    deliveryWindow: { key: WINDOW_KEY_IMMEDIATE },
    shouldNotifyUserForEvent: () => true,
    isEventRelevantToUser: () => true
  });
  assert.equal(decisionEnabled.allowed, true);
});

test('eligibility uses preference gating and portfolio relevance', () => {
  const decisionA = shouldDeliverEventToUser({
    userId: 'alice',
    event: event({ importance: 30 }),
    preferences: pref({ highImportanceOnly: true }),
    now: '2026-04-15T10:00:00.000Z',
    deliveryWindow: { key: WINDOW_KEY_IMMEDIATE },
    shouldNotifyUserForEvent: () => true,
    isEventRelevantToUser: () => true
  });
  assert.equal(decisionA.allowed, false);

  const decisionB = shouldDeliverEventToUser({
    userId: 'alice',
    event: event(),
    preferences: pref({ portfolioOnly: true }),
    now: '2026-04-15T10:00:00.000Z',
    deliveryWindow: { key: WINDOW_KEY_IMMEDIATE },
    shouldNotifyUserForEvent: () => true,
    isEventRelevantToUser: () => false
  });
  assert.equal(decisionB.allowed, false);

  const decisionC = shouldDeliverEventToUser({
    userId: 'alice',
    event: event(),
    preferences: pref(),
    now: '2026-04-15T10:00:00.000Z',
    deliveryWindow: { key: WINDOW_KEY_IMMEDIATE },
    shouldNotifyUserForEvent: () => true,
    isEventRelevantToUser: () => true
  });
  assert.equal(decisionC.allowed, true);
});

test('headline immediate notifications require ranking threshold', () => {
  const lowScoreHeadline = shouldDeliverEventToUser({
    userId: 'alice',
    event: event({
      sourceType: 'news',
      eventType: 'world_news',
      scheduledAt: null,
      publishedAt: '2026-04-15T10:00:00.000Z',
      importance: 5
    }),
    preferences: pref(),
    now: '2026-04-15T10:01:00.000Z',
    deliveryWindow: { key: WINDOW_KEY_IMMEDIATE },
    shouldNotifyUserForEvent: () => true,
    isEventRelevantToUser: () => false
  });
  assert.equal(lowScoreHeadline.allowed, false);
  assert.equal(lowScoreHeadline.reason, 'headline_ranking_threshold');

  const highScoreHeadline = shouldDeliverEventToUser({
    userId: 'alice',
    event: event({
      sourceType: 'news',
      eventType: 'stock_news',
      canonicalTicker: 'AAPL',
      scheduledAt: null,
      publishedAt: '2026-04-15T10:00:00.000Z',
      importance: 95
    }),
    preferences: pref(),
    now: '2026-04-15T10:01:00.000Z',
    deliveryWindow: { key: WINDOW_KEY_IMMEDIATE },
    shouldNotifyUserForEvent: () => true,
    isEventRelevantToUser: () => true
  });
  assert.equal(highScoreHeadline.allowed, true);
});

test('fanout dedupes repeated runs and tolerates single-channel dispatch failure', async () => {
  const db = {
    users: { alice: {}, bob: {} },
    newsEvents: [
      event({ id: 'evt-1', scheduledAt: '2026-04-15T10:00:00.000Z' }),
      event({ id: 'evt-2', sourceType: 'macro', eventType: 'cpi', title: 'CPI', scheduledAt: '2026-04-16T10:00:00.000Z', metadataJson: {} })
    ],
    userEventDeliveryLog: []
  };

  const deliveryKeys = new Set();
  const appendUserEventDeliveryLog = (_db, payload) => {
    const key = `${payload.userId}:${payload.newsEventId}:${payload.deliveryChannel}:${payload.deliveryWindowKey}`;
    if (deliveryKeys.has(key)) return { inserted: false, reason: 'duplicate' };
    deliveryKeys.add(key);
    db.userEventDeliveryLog.push(payload);
    return { inserted: true, reason: 'inserted', row: payload };
  };

  const sent = [];
  const run1 = await runNewsNotificationFanout({
    loadDB: () => db,
    saveDB: () => {},
    ensureNewsEventTables: (value) => {
      if (!Array.isArray(value.userEventDeliveryLog)) value.userEventDeliveryLog = [];
      if (!Array.isArray(value.newsEvents)) value.newsEvents = [];
    },
    getUserNewsPreferences: (userId) => pref({ notifyEmail: userId === 'alice' }),
    shouldNotifyUserForEvent: (_userId, ev) => ev.eventType !== 'world_news',
    isEventRelevantToUser: (ev, userId) => userId === 'alice' || ev.eventType === 'cpi',
    appendUserEventDeliveryLog,
    dispatchChannelPayload: async (payload) => {
      if (payload.channel === 'email') throw new Error('email provider unavailable');
      sent.push(payload);
      return { ok: true };
    },
    now: '2026-04-15T10:02:00.000Z',
    windowGraceMs: 5 * 60 * 1000
  });

  assert.ok(run1.deliveryLog.inserted > 0);
  assert.ok(run1.dispatchErrorsByChannel.email >= 1);

  const run2 = await runNewsNotificationFanout({
    loadDB: () => db,
    saveDB: () => {},
    ensureNewsEventTables: () => {},
    getUserNewsPreferences: () => pref(),
    shouldNotifyUserForEvent: () => true,
    isEventRelevantToUser: () => true,
    appendUserEventDeliveryLog,
    dispatchChannelPayload: async (payload) => {
      sent.push(payload);
      return { ok: true };
    },
    now: '2026-04-15T10:02:00.000Z',
    windowGraceMs: 5 * 60 * 1000
  });

  assert.ok(run2.deliveryLog.deduped > 0);
});

test('daily digest batches events per user and dedupe key is digest-granular', async () => {
  const db = {
    users: { alice: {} },
    newsEvents: [
      event({ id: 'evt-a', scheduledAt: '2026-04-15T09:30:00.000Z' }),
      event({ id: 'evt-b', sourceType: 'news', eventType: 'stock_news', scheduledAt: null, publishedAt: '2026-04-15T11:00:00.000Z' })
    ],
    userEventDeliveryLog: []
  };

  const inserted = new Set();
  const sent = [];
  const diagnostics = await runNewsNotificationFanout({
    loadDB: () => db,
    saveDB: () => {},
    ensureNewsEventTables: () => {},
    getUserNewsPreferences: () => pref({
      notifyImmediate: false,
      notifyOneDayBefore: false,
      notifyOneHourBefore: false,
      notifyFifteenMinutesBefore: false,
      dailyDigestEnabled: true,
      notifyPush: false,
      notifyInApp: true,
      notifyEmail: false
    }),
    shouldNotifyUserForEvent: () => true,
    isEventRelevantToUser: () => true,
    appendUserEventDeliveryLog: (_db, payload) => {
      const key = `${payload.userId}:${payload.newsEventId}:${payload.deliveryChannel}:${payload.deliveryWindowKey}`;
      if (inserted.has(key)) return { inserted: false, reason: 'duplicate' };
      inserted.add(key);
      db.userEventDeliveryLog.push(payload);
      return { inserted: true, reason: 'inserted', row: payload };
    },
    dispatchChannelPayload: async (payload) => {
      sent.push(payload);
      return { ok: true };
    },
    now: '2026-04-15T16:03:00.000Z',
    windowGraceMs: 5 * 60 * 1000
  });

  assert.equal(diagnostics.totalsByDeliveryWindow[WINDOW_KEY_DAILY_DIGEST], 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].eventId, /^digest:daily_digest:/);
  const keyFields = buildDeliveryLogKeyFields({
    userId: 'alice',
    event: { id: sent[0].eventId },
    channel: 'in_app',
    deliveryWindow: { digestWindowKey: sent[0].deliveryWindowKey }
  });
  assert.equal(keyFields.deliveryWindowKey, sent[0].deliveryWindowKey);
});

test('channel payload deep links are stable for earnings, macro, and digest contexts', () => {
  const earningsPayload = buildChannelPayload({
    userId: 'alice',
    event: event({ sourceType: 'earnings', eventType: 'earnings' }),
    channel: 'in_app',
    deliveryWindow: { key: WINDOW_KEY_IMMEDIATE },
    context: {}
  });
  assert.equal(earningsPayload.deepLinkUrl.includes('tab=for-you'), true);

  const macroPayload = buildChannelPayload({
    userId: 'alice',
    event: event({ sourceType: 'macro', eventType: 'cpi', scheduledAt: '2026-04-16T10:00:00.000Z' }),
    channel: 'in_app',
    deliveryWindow: { key: WINDOW_KEY_ONE_HOUR_BEFORE },
    context: {}
  });
  assert.equal(macroPayload.deepLinkUrl.includes('tab=calendar'), true);

  const digestPayload = buildChannelPayload({
    userId: 'alice',
    event: {
      id: 'digest:daily_digest:2026-04-15',
      sourceType: 'news',
      eventType: 'internal_post',
      title: 'Digest',
      summary: 'Summary'
    },
    channel: 'in_app',
    deliveryWindow: { key: WINDOW_KEY_DAILY_DIGEST, digestWindowKey: 'daily_digest:2026-04-15' },
    context: { digest: true, digestWindowKey: 'daily_digest:2026-04-15' }
  });
  assert.equal(digestPayload.deepLinkUrl.includes('tab=for-you'), true);
  assert.equal(digestPayload.deepLinkUrl.includes('digestWindowKey=daily_digest%3A2026-04-15'), true);
});
