const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getNewsDiagnosticsOverview,
  getRankingDiagnostics,
  getRelevanceDistribution,
  getThresholdDropoffStats,
  getNotificationDiagnostics,
  getSourceContributionStats,
  getDiagnosticsTrendSeries,
  getBaselineComparison,
  getRankingTrendSeries,
  getThresholdTrendSeries,
  getNotificationTrendSeries,
  getSourceTrendSeries
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
      ranking: [
        {
          createdAt: '2026-04-12T08:30:00.000Z',
          summary: {
            byMode: {
              balanced: {
                count: 2,
                distribution: { min: 0.2, avg: 0.44, max: 0.71, buckets: { '0.0-0.2': 0, '0.2-0.5': 1, '0.5-0.7': 1, '0.7-0.9': 0, '0.9-1.0': 0 } },
                relevanceTiers: { portfolio: 1, watchlist: 1, global_high_signal: 0, neutral: 0 }
              }
            }
          }
        },
        {
          createdAt: '2026-04-13T08:30:00.000Z',
          summary: {
            byMode: {
              balanced: {
                count: 3,
                distribution: { min: 0.3, avg: 0.61, max: 0.88, buckets: { '0.0-0.2': 0, '0.2-0.5': 1, '0.5-0.7': 1, '0.7-0.9': 1, '0.9-1.0': 0 } },
                relevanceTiers: { portfolio: 2, watchlist: 1, global_high_signal: 0, neutral: 0 }
              }
            }
          }
        },
        {
          createdAt: '2026-04-14T08:30:00.000Z',
          summary: {
            byMode: {
              balanced: {
                count: 3,
                distribution: { min: 0.3, avg: 0.65, max: 0.91, buckets: { '0.0-0.2': 0, '0.2-0.5': 1, '0.5-0.7': 1, '0.7-0.9': 0, '0.9-1.0': 1 } },
                relevanceTiers: { portfolio: 2, watchlist: 0, global_high_signal: 1, neutral: 0 }
              }
            }
          }
        }
      ],
      thresholds: [
        {
          createdAt: '2026-04-12T08:30:00.000Z',
          summary: {
            thresholds: {
              latest: { dropped: 4, surfaced: 8, totalIngested: 12, byTier: { portfolio: 1, watchlist: 2, global_high_signal: 1, neutral: 0 }, byMode: { balanced: 4 }, bySource: { NoisyBlog: 3, TrustedWire: 1 } },
              for_you: { dropped: 3, surfaced: 9, totalIngested: 12, byTier: { portfolio: 1, watchlist: 1, global_high_signal: 1, neutral: 0 }, byMode: { balanced: 3 }, bySource: { NoisyBlog: 2, TrustedWire: 1 } },
              notification: { dropped: 2, surfaced: 10, totalIngested: 12, byTier: { portfolio: 0, watchlist: 1, global_high_signal: 1, neutral: 0 }, byMode: { balanced: 2 }, bySource: { NoisyBlog: 2 } }
            },
            sourceRollups: {
              TrustedWire: { surfaced: 5, suppressed: 1, headlines: 2, trustTier: 'high' },
              NoisyBlog: { surfaced: 3, suppressed: 5, headlines: 2, trustTier: 'low' },
              MidWire: { surfaced: 1, suppressed: 2, headlines: 1, trustTier: 'medium' }
            }
          }
        },
        {
          createdAt: '2026-04-13T08:30:00.000Z',
          summary: {
            thresholds: {
              latest: { dropped: 5, surfaced: 7, totalIngested: 12, byTier: { portfolio: 2, watchlist: 1, global_high_signal: 2, neutral: 0 }, byMode: { balanced: 5 }, bySource: { NoisyBlog: 4, TrustedWire: 1 } },
              for_you: { dropped: 4, surfaced: 8, totalIngested: 12, byTier: { portfolio: 1, watchlist: 1, global_high_signal: 2, neutral: 0 }, byMode: { balanced: 4 }, bySource: { NoisyBlog: 3, TrustedWire: 1 } },
              notification: { dropped: 3, surfaced: 9, totalIngested: 12, byTier: { portfolio: 0, watchlist: 1, global_high_signal: 2, neutral: 0 }, byMode: { balanced: 3 }, bySource: { NoisyBlog: 3 } }
            },
            sourceRollups: {
              TrustedWire: { surfaced: 5, suppressed: 1, headlines: 2, trustTier: 'high' },
              NoisyBlog: { surfaced: 2, suppressed: 6, headlines: 2, trustTier: 'low' },
              MidWire: { surfaced: 1, suppressed: 2, headlines: 1, trustTier: 'medium' }
            }
          }
        },
        {
          createdAt: '2026-04-14T08:30:00.000Z',
          summary: {
            thresholds: {
              latest: { dropped: 3, surfaced: 9, totalIngested: 12, byTier: { portfolio: 1, watchlist: 1, global_high_signal: 1, neutral: 0 }, byMode: { balanced: 3 }, bySource: { NoisyBlog: 2, TrustedWire: 1 } },
              for_you: { dropped: 2, surfaced: 10, totalIngested: 12, byTier: { portfolio: 1, watchlist: 0, global_high_signal: 1, neutral: 0 }, byMode: { balanced: 2 }, bySource: { NoisyBlog: 1, TrustedWire: 1 } },
              notification: { dropped: 2, surfaced: 10, totalIngested: 12, byTier: { portfolio: 0, watchlist: 1, global_high_signal: 1, neutral: 0 }, byMode: { balanced: 2 }, bySource: { NoisyBlog: 2 } }
            },
            sourceRollups: {
              TrustedWire: { surfaced: 6, suppressed: 1, headlines: 2, trustTier: 'high' },
              NoisyBlog: { surfaced: 2, suppressed: 4, headlines: 2, trustTier: 'low' },
              MidWire: { surfaced: 1, suppressed: 2, headlines: 1, trustTier: 'medium' }
            }
          }
        }
      ],
      notifications: [
        {
          createdAt: '2026-04-13T10:30:00.000Z',
          eligible: 5,
          blocked: 5,
          blockReasons: { below_threshold: 3, preference_disabled: 1, not_relevant: 1, channel_disabled: 0 },
          byRankingMode: { balanced: 10 },
          byRelevanceTier: { portfolio: 3, watchlist: 1, global_high_signal: 1, neutral: 0 },
          byEventType: { stock_news: 5, world_news: 5, earnings: 0, macro: 0 },
          byChannel: { in_app: 5, push: 2, email: 1 },
          channelErrors: { in_app: 0, push: 1, email: 0 }
        },
        {
          createdAt: '2026-04-14T10:30:00.000Z',
          eligible: 6,
          blocked: 4,
          blockReasons: { below_threshold: 2, preference_disabled: 1, not_relevant: 1, channel_disabled: 0 },
          byRankingMode: { balanced: 10 },
          byRelevanceTier: { portfolio: 3, watchlist: 2, global_high_signal: 1, neutral: 0 },
          byEventType: { stock_news: 4, world_news: 2, earnings: 0, macro: 0 },
          byChannel: { in_app: 6, push: 3, email: 2 },
          channelErrors: { in_app: 0, push: 0, email: 1 }
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

test('trend series supports daily grouping and bounded fallback metadata', () => {
  const db = buildDb();
  const rankingTrends = getRankingTrendSeries({ ...options(db), timeRange: '30d', interval: 'daily' });
  assert.equal(rankingTrends.metadata.timeRange, '30d');
  assert.equal(rankingTrends.metadata.interval, 'daily');
  assert.equal(rankingTrends.metadata.retentionLimited, true);
  assert.ok(rankingTrends.series.length >= 2);
  assert.ok(rankingTrends.series[0].scoreBuckets['0.0-0.2'] >= 0);
});

test('threshold trend series returns counts and percentages by stage', () => {
  const db = buildDb();
  const trends = getThresholdTrendSeries({ ...options(db), timeRange: '7d', interval: 'daily' });
  assert.ok(trends.series[0].thresholds.latest.dropped >= 0);
  assert.ok(Number.isFinite(trends.series[0].thresholds.latest.percentDropped));
  assert.ok(trends.series[0].thresholds.latest.byMode.balanced >= 0);
});

test('notification trend series carries channel and block reason mix', () => {
  const db = buildDb();
  const trends = getNotificationTrendSeries({ ...options(db), timeRange: '7d', interval: 'daily' });
  const point = trends.series.at(-1);
  assert.ok(point.notifications.byChannel.in_app >= 0);
  assert.ok(point.notifications.blockReasons.below_threshold >= 0);
  assert.ok(Number.isFinite(point.notifications.eligiblePct));
});

test('source trend series keeps top-N bounded and supports other bucket', () => {
  const db = buildDb();
  const trends = getSourceTrendSeries({ ...options(db), timeRange: '7d', interval: 'daily' });
  const first = trends.series[0];
  assert.ok(Object.keys(first.sourceContribution).length <= 9);
  assert.ok(first.trustTierMix.high >= 0);
});

test('baseline comparison computes deterministic deltas and drift indicators', () => {
  const db = buildDb();
  const baseline = getBaselineComparison({ ...options(db), baselineWindow: '24h' });
  assert.equal(baseline.metadata.insufficientBaseline, false);
  assert.ok(Number.isFinite(baseline.comparisons.rankingScoreAverages.absoluteDelta));
  assert.ok(['up', 'down', 'flat'].includes(baseline.comparisons.rankingScoreAverages.direction));
  assert.ok(['improving', 'worsening', 'stable'].includes(baseline.driftIndicators.thresholdDropoff.label));
});

test('baseline comparison reports insufficient baseline when previous data missing', () => {
  const db = buildDb();
  db.newsDiagnosticsSnapshots.ranking = db.newsDiagnosticsSnapshots.ranking.slice(-1);
  db.newsDiagnosticsSnapshots.thresholds = db.newsDiagnosticsSnapshots.thresholds.slice(-1);
  db.newsDiagnosticsSnapshots.notifications = db.newsDiagnosticsSnapshots.notifications.slice(-1);
  const baseline = getBaselineComparison({ ...options(db), baselineWindow: '24h' });
  assert.equal(baseline.metadata.insufficientBaseline, true);
  assert.equal(baseline.comparisons, null);
});

test('combined trend series returns overview and baseline availability metadata', () => {
  const db = buildDb();
  const data = getDiagnosticsTrendSeries({ ...options(db), timeRange: '7d', interval: 'daily' });
  assert.ok(Array.isArray(data.overviewSeries));
  assert.ok(data.metadata.baselineAvailability.ranking !== undefined);
});

test('trend functions are backward compatible when snapshots are missing newer fields', () => {
  const db = buildDb();
  db.newsDiagnosticsSnapshots.notifications[0] = {
    createdAt: '2026-04-12T01:00:00.000Z',
    eligible: 2,
    blocked: 1,
    blockReasons: { below_threshold: 1 }
  };
  delete db.newsDiagnosticsSnapshots.thresholds[0].summary.sourceRollups;
  const notification = getNotificationTrendSeries({ ...options(db), timeRange: '7d', interval: 'daily' });
  const source = getSourceTrendSeries({ ...options(db), timeRange: '7d', interval: 'daily' });
  assert.ok(notification.series.length >= 1);
  assert.ok(source.series.length >= 1);
});
