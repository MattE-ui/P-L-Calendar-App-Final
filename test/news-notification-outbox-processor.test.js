const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runNewsNotificationOutboxProcessor,
  claimPendingOutboxItems,
  finalizeOutboxItemSuccess,
  finalizeOutboxItemFailure,
  shouldRetryOutboxItem
} = require('../services/news/newsNotificationOutboxProcessor');
const { buildNewsNotificationDeepLink } = require('../services/news/newsNotificationFanoutService');

function buildOutboxRow(overrides = {}) {
  return {
    id: 'out-1',
    userId: 'alice',
    newsEventId: 'evt-1',
    channel: 'in_app',
    payload: {
      channel: 'in_app',
      userId: 'alice',
      eventId: 'evt-1',
      title: 'Title',
      body: 'Body',
      deepLinkUrl: '/news.html?tab=for-you'
    },
    status: 'pending',
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: '2026-04-14T00:00:00.000Z',
    claimedAt: null,
    claimedBy: null,
    lastAttemptAt: null,
    sentAt: null,
    createdAt: '2026-04-14T00:00:00.000Z',
    updatedAt: '2026-04-14T00:00:00.000Z',
    ...overrides
  };
}

test('claimPendingOutboxItems only claims due pending items in bounded batches', () => {
  const db = {
    newsNotificationOutbox: [
      buildOutboxRow({ id: 'a', status: 'pending' }),
      buildOutboxRow({ id: 'b', status: 'pending', nextAttemptAt: '2099-01-01T00:00:00.000Z' }),
      buildOutboxRow({ id: 'c', status: 'sent' })
    ]
  };
  const claimed = claimPendingOutboxItems({ db, now: '2026-04-14T00:01:00.000Z', batchSize: 1, claimedBy: 'test-runner' });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, 'a');
  assert.equal(claimed[0].status, 'processing');
  assert.equal(claimed[0].claimedBy, 'test-runner');
});

test('retryable and non-retryable failures map to pending/failed/dead_letter', () => {
  const retryable = buildOutboxRow({ attemptCount: 1, maxAttempts: 3, status: 'processing' });
  const retryOutcome = finalizeOutboxItemFailure(retryable, { retryable: true, code: 'timeout', message: 'temporary' }, { baseBackoffMs: 1000 });
  assert.equal(retryOutcome.status, 'pending');
  assert.equal(retryOutcome.retryScheduled, true);
  assert.equal(shouldRetryOutboxItem(retryable, { retryable: true }), true);

  const exhausted = buildOutboxRow({ attemptCount: 3, maxAttempts: 3, status: 'processing' });
  const deadOutcome = finalizeOutboxItemFailure(exhausted, { retryable: true, code: 'timeout', message: 'temporary' });
  assert.equal(deadOutcome.status, 'dead_letter');

  const permanent = buildOutboxRow({ attemptCount: 1, maxAttempts: 3, status: 'processing' });
  const failOutcome = finalizeOutboxItemFailure(permanent, { retryable: false, code: 'invalid_payload', message: 'bad payload' });
  assert.equal(failOutcome.status, 'failed');
});

test('finalization guards reject stale or reclaimed claim tokens', () => {
  const item = buildOutboxRow({
    status: 'processing',
    claimToken: 'token-current'
  });

  const mismatch = finalizeOutboxItemSuccess(item, { ok: true, expectedClaimToken: 'token-stale' });
  assert.equal(mismatch.guardRejected, true);
  assert.equal(item.status, 'processing');

  const reclaimed = buildOutboxRow({
    status: 'pending',
    claimToken: null
  });
  const rejected = finalizeOutboxItemFailure(reclaimed, { retryable: true, code: 'timeout', message: 'x' }, { expectedClaimToken: 'token' });
  assert.equal(rejected.guardRejected, true);
  assert.equal(rejected.guardReason, 'state_not_processing');
});

test('outbox processor sends rows, retries retryables, and is idempotent on rerun', async () => {
  const db = {
    newsNotificationOutbox: [
      buildOutboxRow({ id: 'ok-1', channel: 'in_app' }),
      buildOutboxRow({ id: 'retry-1', channel: 'push', payload: { channel: 'push', eventId: 'evt-2', userId: 'alice' } })
    ]
  };
  let pushAttempts = 0;
  const ensureNewsEventTables = (value) => {
    if (!Array.isArray(value.newsNotificationOutbox)) value.newsNotificationOutbox = [];
  };

  const diagnostics = await runNewsNotificationOutboxProcessor({
    loadDB: () => db,
    saveDB: () => {},
    ensureNewsEventTables,
    now: '2026-04-14T00:05:00.000Z',
    dispatchChannelPayload: async (payload) => {
      if (payload.channel === 'push') {
        pushAttempts += 1;
        throw Object.assign(new Error('provider timeout'), { code: 'timeout' });
      }
      return { ok: true, messageId: 'in-app-1' };
    },
    baseBackoffMs: 1000
  });

  assert.equal(diagnostics.sentCount, 1);
  assert.equal(diagnostics.retriedCount, 1);

  const rerun = await runNewsNotificationOutboxProcessor({
    loadDB: () => db,
    saveDB: () => {},
    ensureNewsEventTables,
    now: '2026-04-14T00:05:01.000Z',
    dispatchChannelPayload: async () => ({ ok: true, messageId: 'noop' })
  });

  assert.equal(rerun.claimedCount, 0);
  assert.equal(pushAttempts, 1);
});

test('processor persists claims before dispatch and only releases truly stale processing rows', async () => {
  const db = {
    newsNotificationOutbox: [
      buildOutboxRow({
        id: 'stale-1',
        status: 'processing',
        claimedAt: '2026-04-14T00:00:00.000Z',
        lastAttemptAt: '2026-04-14T00:00:00.000Z',
        claimedBy: 'processor:a',
        claimToken: 'claim-old'
      }),
      buildOutboxRow({
        id: 'fresh-1',
        status: 'processing',
        claimedAt: '2026-04-14T00:24:00.000Z',
        lastAttemptAt: '2026-04-14T00:24:00.000Z',
        claimedBy: 'processor:b',
        claimToken: 'claim-fresh'
      }),
      buildOutboxRow({ id: 'pending-1', status: 'pending' })
    ]
  };
  let saveCalls = 0;

  await runNewsNotificationOutboxProcessor({
    loadDB: () => db,
    saveDB: () => { saveCalls += 1; },
    ensureNewsEventTables: () => {},
    now: '2026-04-14T00:40:00.000Z',
    dispatchChannelPayload: async () => ({ ok: true }),
    staleProcessingMs: 30 * 60 * 1000
  });

  assert.ok(saveCalls >= 2);
  assert.equal(db.newsNotificationOutbox.find((row) => row.id === 'stale-1').status, 'pending');
  assert.equal(db.newsNotificationOutbox.find((row) => row.id === 'fresh-1').status, 'processing');
});

test('deep-link generation routes deterministic tabs by context', () => {
  const digestLink = buildNewsNotificationDeepLink({
    event: { id: 'digest:daily_digest:2026-04-14', sourceType: 'news', eventType: 'internal_post' },
    deliveryWindow: { key: 'daily_digest' },
    context: { digest: true, digestWindowKey: 'daily_digest:2026-04-14' }
  });
  assert.equal(digestLink.includes('tab=for-you'), true);

  const macroLink = buildNewsNotificationDeepLink({
    event: { id: 'evt-macro', sourceType: 'macro', eventType: 'cpi' },
    deliveryWindow: { key: 'immediate' },
    context: {}
  });
  assert.equal(macroLink.includes('tab=calendar'), true);

  const earningsLink = buildNewsNotificationDeepLink({
    event: { id: 'evt-earnings', sourceType: 'earnings', eventType: 'earnings' },
    deliveryWindow: { key: 'immediate' },
    context: {}
  });
  assert.equal(earningsLink.includes('tab=for-you'), true);
});
