const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getNewsDiagnosticsOverview,
  getRankingDiagnostics,
  getRelevanceDistribution,
  getThresholdDropoffStats,
  getNotificationDiagnostics,
  getSourceContributionStats
} = require('../services/news/newsDiagnosticsService');

function buildDb() {
  return {
    users: { alice: {}, bob: {} },
    newsEvents: [
      {
        id: 'n-1',
        sourceType: 'news',
        eventType: 'stock_news',
        title: 'AAPL beats',
        canonicalTicker: 'AAPL',
        sourceName: 'TrustedWire',
        importance: 95,
        publishedAt: '2026-04-14T10:00:00.000Z',
        createdAt: '2026-04-14T10:00:00.000Z',
        metadataJson: { providerImportance: 95 },
        isActive: true
      },
      {
        id: 'n-2',
        sourceType: 'news',
        eventType: 'world_news',
        title: 'Macro pulse',
        sourceName: 'NoisyBlog',
        importance: 25,
        publishedAt: '2026-04-14T09:00:00.000Z',
        createdAt: '2026-04-14T09:00:00.000Z',
        metadataJson: { providerImportance: 25 },
        isActive: true
      },
      {
        id: 'n-3',
        sourceType: 'news',
        eventType: 'stock_news',
        title: 'Old headline',
        sourceName: 'TrustedWire',
        importance: 60,
        publishedAt: '2026-04-10T09:00:00.000Z',
        createdAt: '2026-04-10T09:00:00.000Z',
        metadataJson: {},
        isActive: true
      }
    ],
    newsDiagnosticsSnapshots: {
      notifications: [
        {
          createdAt: '2026-04-14T10:30:00.000Z',
          eligible: 6,
          blocked: 4,
          blockReasons: {
            below_threshold: 2,
            preference_disabled: 1,
            not_relevant: 1,
            channel_disabled: 0
          },
          byRankingMode: { balanced: 10 },
          byRelevanceTier: { portfolio: 3, watchlist: 2, global_high_signal: 1, neutral: 0 },
          byEventType: { stock_news: 4, world_news: 2, earnings: 0, macro: 0 }
        }
      ]
    }
  };
}

function options(db) {
  return {
    loadDB: () => db,
    now: '2026-04-14T11:00:00.000Z',
    timeRange: '24h',
    listNewsSourceProfiles: () => [
      { sourceName: 'TrustedWire', trustTier: 'high', priorityBoost: 8, isAllowed: true, isMuted: false },
      { sourceName: 'NoisyBlog', trustTier: 'low', priorityBoost: -8, isAllowed: true, isMuted: false }
    ],
    resolveUserTickerUniverse: (userId) => (userId === 'alice' ? new Set(['AAPL']) : new Set()),
    resolveUserWatchlistTickerUniverse: (userId) => (userId === 'bob' ? new Set(['TSLA']) : new Set())
  };
}

test('ranking diagnostics returns distribution and mode counts', () => {
  const data = getRankingDiagnostics(options(buildDb()));
  assert.equal(data.timeRange, '24h');
  assert.equal(data.totals.eventsConsidered, 2);
  assert.ok(data.byMode.balanced.distribution.max >= data.byMode.balanced.distribution.min);
  assert.ok(Object.keys(data.byMode.balanced.distribution.buckets).length >= 4);
});

test('time range filtering excludes old events', () => {
  const db = buildDb();
  const oneHour = getRankingDiagnostics({ ...options(db), timeRange: '1h', now: '2026-04-14T10:45:00.000Z' });
  assert.equal(oneHour.totals.eventsConsidered, 1);
});

test('threshold diagnostics aggregates dropped and percentages', () => {
  const data = getThresholdDropoffStats(options(buildDb()));
  assert.ok(data.thresholds.latest.dropped >= 1);
  assert.ok(data.thresholds.notification.percentDropped >= 0);
  assert.equal(data.totalIngested, 6);
});

test('notification diagnostics aggregates snapshot reasons', () => {
  const data = getNotificationDiagnostics(options(buildDb()));
  assert.equal(data.eligible, 6);
  assert.equal(data.blocked, 4);
  assert.equal(data.blockReasons.below_threshold, 2);
});

test('overview and source diagnostics expose expected summary fields', () => {
  const db = buildDb();
  const overview = getNewsDiagnosticsOverview(options(db));
  const sources = getSourceContributionStats(options(db));
  const relevance = getRelevanceDistribution(options(db));

  assert.ok(Number.isFinite(overview.thresholds.latestDropPct));
  assert.ok(sources.sources.find((row) => row.sourceName === 'TrustedWire'));
  assert.ok(relevance.byMode.discovery);
});
