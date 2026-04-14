const { scoreNewsEvent, getRankingModeProfile } = require('./newsRankingService');
const { RELEVANCE_TIERS } = require('./newsUserRelevanceService');

const SUPPORTED_TIME_RANGES = Object.freeze({
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
});

const SCORE_BUCKETS = Object.freeze([
  { key: '0.0-0.2', min: 0, max: 0.2 },
  { key: '0.2-0.5', min: 0.2, max: 0.5 },
  { key: '0.5-0.7', min: 0.5, max: 0.7 },
  { key: '0.7-0.9', min: 0.7, max: 0.9 },
  { key: '0.9-1.0', min: 0.9, max: 1.000001 }
]);

const RANKING_MODES = Object.freeze(['strict_signal', 'balanced', 'discovery']);

function normalizeIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function resolveTimeRange(timeRange = '24h', now = new Date().toISOString()) {
  const nowIso = normalizeIsoDate(now) || new Date().toISOString();
  const key = SUPPORTED_TIME_RANGES[timeRange] ? timeRange : '24h';
  const from = new Date(Date.parse(nowIso) - SUPPORTED_TIME_RANGES[key]).toISOString();
  return { key, now: nowIso, from, durationMs: SUPPORTED_TIME_RANGES[key] };
}

function eventTimestamp(event) {
  return normalizeIsoDate(event?.publishedAt || event?.scheduledAt || event?.updatedAt || event?.createdAt);
}

function withinRange(event, range) {
  const compareAt = eventTimestamp(event);
  return !!compareAt && compareAt >= range.from && compareAt <= range.now;
}

function toPercent(count, total) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(2));
}

function zeroTierMap() {
  return {
    [RELEVANCE_TIERS.PORTFOLIO]: 0,
    [RELEVANCE_TIERS.WATCHLIST]: 0,
    [RELEVANCE_TIERS.GLOBAL_HIGH_SIGNAL]: 0,
    [RELEVANCE_TIERS.NEUTRAL]: 0
  };
}

function listScopedEvents(db, range) {
  const rows = Array.isArray(db?.newsEvents) ? db.newsEvents : [];
  return rows.filter((event) => event?.isActive !== false && withinRange(event, range));
}

function buildSystemUniverse({ db, resolvePortfolioTickerUniverse, resolveWatchlistTickerUniverse }) {
  const portfolioTickers = new Set();
  const watchlistTickers = new Set();
  const users = Object.keys(db?.users || {});
  for (const userId of users) {
    const p = typeof resolvePortfolioTickerUniverse === 'function' ? resolvePortfolioTickerUniverse(userId) : [];
    const w = typeof resolveWatchlistTickerUniverse === 'function' ? resolveWatchlistTickerUniverse(userId) : [];
    for (const ticker of (p instanceof Set ? p : p || [])) {
      if (!ticker) continue;
      portfolioTickers.add(String(ticker).toUpperCase());
    }
    for (const ticker of (w instanceof Set ? w : w || [])) {
      if (!ticker) continue;
      const normalized = String(ticker).toUpperCase();
      if (portfolioTickers.has(normalized)) continue;
      watchlistTickers.add(normalized);
    }
  }
  return { portfolioTickers, watchlistTickers };
}

function scoreRows(events, mode, sourceProfiles, context = {}) {
  return events.map((event) => {
    const score = scoreNewsEvent(event, {
      rankingMode: mode,
      sourceProfiles,
      now: context.now,
      userTickerUniverse: context.systemUniverse
    });
    return { event, score };
  });
}

function buildDistribution(rows) {
  const totals = rows.map((row) => Number(row?.score?.totalScore || 0));
  const min = totals.length ? Math.min(...totals) : 0;
  const max = totals.length ? Math.max(...totals) : 0;
  const avg = totals.length ? totals.reduce((acc, value) => acc + value, 0) / totals.length : 0;

  const buckets = {};
  for (const bucket of SCORE_BUCKETS) buckets[bucket.key] = 0;

  for (const row of rows) {
    const total = Number(row?.score?.totalScore || 0);
    const bucket = SCORE_BUCKETS.find((item) => total >= item.min && total < item.max) || SCORE_BUCKETS[SCORE_BUCKETS.length - 1];
    buckets[bucket.key] += 1;
  }

  return {
    min: Number(min.toFixed(4)),
    avg: Number(avg.toFixed(4)),
    max: Number(max.toFixed(4)),
    buckets
  };
}

function buildTierFromScore(row) {
  const tier = String(row?.score?.relevanceTier || RELEVANCE_TIERS.NEUTRAL);
  return zeroTierMap()[tier] === undefined ? RELEVANCE_TIERS.NEUTRAL : tier;
}

function buildThresholdStatsForMode(rows, modeProfile) {
  const total = rows.length;
  const byStage = {
    latest: { threshold: modeProfile.thresholds.latestMinScore, dropped: 0, surfaced: 0, byTier: zeroTierMap(), bySource: {}, byMode: {} },
    for_you: { threshold: modeProfile.thresholds.forYouHeadlineMinScore, dropped: 0, surfaced: 0, byTier: zeroTierMap(), bySource: {}, byMode: {} },
    notification: { threshold: modeProfile.thresholds.notificationHeadlineMinScore, dropped: 0, surfaced: 0, byTier: zeroTierMap(), bySource: {}, byMode: {} }
  };

  for (const row of rows) {
    const score = Number(row?.score?.totalScore || 0);
    const tier = buildTierFromScore(row);
    const source = String(row?.event?.sourceName || 'unknown');
    for (const [stage, stats] of Object.entries(byStage)) {
      const dropped = score < stats.threshold;
      if (dropped) {
        stats.dropped += 1;
        stats.byTier[tier] += 1;
        stats.bySource[source] = (stats.bySource[source] || 0) + 1;
        stats.byMode[modeProfile.mode] = (stats.byMode[modeProfile.mode] || 0) + 1;
      } else {
        stats.surfaced += 1;
      }
    }
  }

  for (const stats of Object.values(byStage)) {
    stats.percentDropped = toPercent(stats.dropped, total);
    stats.percentSurfaced = toPercent(stats.surfaced, total);
    stats.totalConsidered = total;
  }

  return byStage;
}

function aggregateNotificationHistory(range, db) {
  const notifications = Array.isArray(db?.newsDiagnosticsSnapshots?.notifications)
    ? db.newsDiagnosticsSnapshots.notifications.filter((row) => {
      const at = normalizeIsoDate(row?.createdAt);
      return !!at && at >= range.from && at <= range.now;
    })
    : [];

  const totals = {
    eligible: 0,
    blocked: 0,
    blockReasons: {
      below_threshold: 0,
      preference_disabled: 0,
      not_relevant: 0,
      channel_disabled: 0
    },
    byRankingMode: {},
    byRelevanceTier: zeroTierMap(),
    byEventType: {
      stock_news: 0,
      world_news: 0,
      earnings: 0,
      macro: 0
    }
  };

  for (const snapshot of notifications) {
    totals.eligible += Number(snapshot?.eligible || 0);
    totals.blocked += Number(snapshot?.blocked || 0);
    const reasons = snapshot?.blockReasons || {};
    for (const key of Object.keys(totals.blockReasons)) {
      totals.blockReasons[key] += Number(reasons[key] || 0);
    }
    for (const [mode, count] of Object.entries(snapshot?.byRankingMode || {})) {
      totals.byRankingMode[mode] = (totals.byRankingMode[mode] || 0) + Number(count || 0);
    }
    for (const [tier, count] of Object.entries(snapshot?.byRelevanceTier || {})) {
      if (totals.byRelevanceTier[tier] === undefined) continue;
      totals.byRelevanceTier[tier] += Number(count || 0);
    }
    for (const [eventType, count] of Object.entries(snapshot?.byEventType || {})) {
      if (totals.byEventType[eventType] === undefined) continue;
      totals.byEventType[eventType] += Number(count || 0);
    }
  }

  return { sampleCount: notifications.length, ...totals };
}

function getRankingDiagnostics(options = {}) {
  const db = typeof options.loadDB === 'function' ? options.loadDB() : {};
  const range = resolveTimeRange(options.timeRange, options.now);
  const events = listScopedEvents(db, range).filter((event) => event?.eventType === 'stock_news' || event?.eventType === 'world_news');
  const sourceProfiles = typeof options.listNewsSourceProfiles === 'function' ? options.listNewsSourceProfiles() : [];
  const systemUniverse = buildSystemUniverse({
    db,
    resolvePortfolioTickerUniverse: options.resolveUserTickerUniverse,
    resolveWatchlistTickerUniverse: options.resolveUserWatchlistTickerUniverse
  });

  const byMode = {};
  const modeCounts = {};
  const relevanceTierCounts = zeroTierMap();

  for (const mode of RANKING_MODES) {
    const rows = scoreRows(events, mode, sourceProfiles, { now: range.now, systemUniverse });
    const distribution = buildDistribution(rows);
    const relevance = zeroTierMap();
    for (const row of rows) {
      const tier = buildTierFromScore(row);
      relevance[tier] += 1;
      relevanceTierCounts[tier] += 1;
      modeCounts[mode] = (modeCounts[mode] || 0) + 1;
    }

    byMode[mode] = {
      count: rows.length,
      distribution,
      relevanceTiers: relevance
    };
  }

  return {
    timeRange: range.key,
    window: { from: range.from, to: range.now },
    totals: {
      eventsConsidered: events.length,
      rankingModeCounts: modeCounts,
      relevanceTierCounts
    },
    byMode
  };
}

function getThresholdDropoffStats(options = {}) {
  const db = typeof options.loadDB === 'function' ? options.loadDB() : {};
  const range = resolveTimeRange(options.timeRange, options.now);
  const events = listScopedEvents(db, range).filter((event) => event?.eventType === 'stock_news' || event?.eventType === 'world_news');
  const sourceProfiles = typeof options.listNewsSourceProfiles === 'function' ? options.listNewsSourceProfiles() : [];
  const systemUniverse = buildSystemUniverse({
    db,
    resolvePortfolioTickerUniverse: options.resolveUserTickerUniverse,
    resolveWatchlistTickerUniverse: options.resolveUserWatchlistTickerUniverse
  });

  const aggregate = {
    latest: { dropped: 0, surfaced: 0, byTier: zeroTierMap(), bySource: {}, byMode: {} },
    for_you: { dropped: 0, surfaced: 0, byTier: zeroTierMap(), bySource: {}, byMode: {} },
    notification: { dropped: 0, surfaced: 0, byTier: zeroTierMap(), bySource: {}, byMode: {} }
  };

  for (const mode of RANKING_MODES) {
    const rows = scoreRows(events, mode, sourceProfiles, { now: range.now, systemUniverse });
    const modeProfile = getRankingModeProfile(mode);
    const modeStats = buildThresholdStatsForMode(rows, modeProfile);
    for (const stage of Object.keys(aggregate)) {
      aggregate[stage].dropped += modeStats[stage].dropped;
      aggregate[stage].surfaced += modeStats[stage].surfaced;
      for (const [tier, count] of Object.entries(modeStats[stage].byTier)) {
        aggregate[stage].byTier[tier] += count;
      }
      for (const [source, count] of Object.entries(modeStats[stage].bySource)) {
        aggregate[stage].bySource[source] = (aggregate[stage].bySource[source] || 0) + count;
      }
      for (const [rankingMode, count] of Object.entries(modeStats[stage].byMode)) {
        aggregate[stage].byMode[rankingMode] = (aggregate[stage].byMode[rankingMode] || 0) + count;
      }
    }
  }

  const totalIngested = events.length * RANKING_MODES.length;
  for (const stage of Object.keys(aggregate)) {
    aggregate[stage].totalIngested = totalIngested;
    aggregate[stage].percentDropped = toPercent(aggregate[stage].dropped, totalIngested);
    aggregate[stage].percentSurfaced = toPercent(aggregate[stage].surfaced, totalIngested);
  }

  return {
    timeRange: range.key,
    window: { from: range.from, to: range.now },
    totalIngested,
    thresholds: aggregate
  };
}

function getSourceContributionStats(options = {}) {
  const db = typeof options.loadDB === 'function' ? options.loadDB() : {};
  const range = resolveTimeRange(options.timeRange, options.now);
  const sourceProfiles = typeof options.listNewsSourceProfiles === 'function' ? options.listNewsSourceProfiles() : [];
  const profileByName = sourceProfiles.reduce((acc, source) => {
    acc[String(source?.sourceName || '').trim()] = source;
    return acc;
  }, {});
  const events = listScopedEvents(db, range).filter((event) => event?.eventType === 'stock_news' || event?.eventType === 'world_news');

  const thresholdStats = getThresholdDropoffStats({ ...options, timeRange: range.key, now: range.now });
  const totalHeadlines = events.length;
  const surfacedBySource = {};
  const suppressedBySource = {};
  for (const stage of Object.values(thresholdStats.thresholds)) {
    for (const [source, count] of Object.entries(stage.bySource || {})) {
      suppressedBySource[source] = (suppressedBySource[source] || 0) + count;
    }
  }

  for (const mode of RANKING_MODES) {
    const rows = scoreRows(events, mode, sourceProfiles, { now: range.now, systemUniverse: buildSystemUniverse({ db, resolvePortfolioTickerUniverse: options.resolveUserTickerUniverse, resolveWatchlistTickerUniverse: options.resolveUserWatchlistTickerUniverse }) });
    const modeProfile = getRankingModeProfile(mode);
    for (const row of rows) {
      const source = String(row?.event?.sourceName || 'unknown');
      if (Number(row?.score?.totalScore || 0) >= modeProfile.thresholds.latestMinScore) {
        surfacedBySource[source] = (surfacedBySource[source] || 0) + 1;
      }
    }
  }

  const sources = {};
  for (const event of events) {
    const sourceName = String(event?.sourceName || 'unknown');
    sources[sourceName] ||= {
      sourceName,
      headlines: 0,
      surfaced: 0,
      suppressed: 0,
      trustTierDistribution: { high: 0, medium: 0, low: 0 }
    };
    sources[sourceName].headlines += 1;
    const trustTier = String(profileByName[sourceName]?.trustTier || 'low');
    if (sources[sourceName].trustTierDistribution[trustTier] !== undefined) {
      sources[sourceName].trustTierDistribution[trustTier] += 1;
    }
  }

  for (const source of Object.values(sources)) {
    source.surfaced = surfacedBySource[source.sourceName] || 0;
    source.suppressed = suppressedBySource[source.sourceName] || 0;
    source.surfacedPctOfTotal = toPercent(source.surfaced, totalHeadlines * RANKING_MODES.length);
    source.suppressedPctOfTotal = toPercent(source.suppressed, totalHeadlines * RANKING_MODES.length);
  }

  return {
    timeRange: range.key,
    window: { from: range.from, to: range.now },
    totals: {
      sources: Object.keys(sources).length,
      headlines: totalHeadlines
    },
    sources: Object.values(sources).sort((a, b) => b.headlines - a.headlines)
  };
}

function getRelevanceDistribution(options = {}) {
  const ranking = getRankingDiagnostics(options);
  const surfacedByTier = zeroTierMap();
  const byMode = {};

  for (const mode of RANKING_MODES) {
    const modeRanking = ranking.byMode[mode] || { relevanceTiers: zeroTierMap(), count: 0 };
    const profile = getRankingModeProfile(mode);
    const thresholdStats = getThresholdDropoffStats({ ...options, timeRange: ranking.timeRange }).thresholds.latest;
    byMode[mode] = {
      relevanceTiers: modeRanking.relevanceTiers,
      latestThreshold: profile.thresholds.latestMinScore,
      total: modeRanking.count
    };
    for (const [tier, count] of Object.entries(modeRanking.relevanceTiers || {})) {
      surfacedByTier[tier] += count;
    }
    byMode[mode].latestDropCount = thresholdStats.byMode?.[mode] || 0;
  }

  const total = Object.values(surfacedByTier).reduce((acc, value) => acc + value, 0);
  return {
    timeRange: ranking.timeRange,
    window: ranking.window,
    surfacedByTier,
    surfacedPctByTier: Object.fromEntries(Object.entries(surfacedByTier).map(([tier, count]) => [tier, toPercent(count, total)])),
    byMode
  };
}

function getNotificationDiagnostics(options = {}) {
  const db = typeof options.loadDB === 'function' ? options.loadDB() : {};
  const range = resolveTimeRange(options.timeRange, options.now);
  return {
    timeRange: range.key,
    window: { from: range.from, to: range.now },
    ...aggregateNotificationHistory(range, db)
  };
}

function getNewsDiagnosticsOverview(options = {}) {
  const ranking = getRankingDiagnostics(options);
  const thresholds = getThresholdDropoffStats(options);
  const relevance = getRelevanceDistribution(options);
  const notifications = getNotificationDiagnostics(options);
  const sources = getSourceContributionStats(options);
  return {
    timeRange: ranking.timeRange,
    window: ranking.window,
    ranking: {
      eventsConsidered: ranking.totals.eventsConsidered,
      avgScoreBalanced: ranking.byMode?.balanced?.distribution?.avg || 0
    },
    thresholds: {
      latestDropPct: thresholds.thresholds.latest.percentDropped,
      forYouDropPct: thresholds.thresholds.for_you.percentDropped,
      notificationDropPct: thresholds.thresholds.notification.percentDropped
    },
    relevance: relevance.surfacedPctByTier,
    notifications: {
      eligible: notifications.eligible,
      blocked: notifications.blocked,
      blockReasons: notifications.blockReasons
    },
    sources: {
      sourceCount: sources.totals.sources,
      headlineCount: sources.totals.headlines
    }
  };
}

module.exports = {
  SUPPORTED_TIME_RANGES,
  getNewsDiagnosticsOverview,
  getRankingDiagnostics,
  getRelevanceDistribution,
  getThresholdDropoffStats,
  getNotificationDiagnostics,
  getSourceContributionStats
};
