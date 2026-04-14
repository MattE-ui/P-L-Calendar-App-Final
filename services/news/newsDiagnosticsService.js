const { scoreNewsEvent, getRankingModeProfile } = require('./newsRankingService');
const { RELEVANCE_TIERS } = require('./newsUserRelevanceService');

const SUPPORTED_TIME_RANGES = Object.freeze({
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
});

const SCORE_BUCKETS = Object.freeze([
  { key: '0.0-0.2', min: 0, max: 0.2 },
  { key: '0.2-0.5', min: 0.2, max: 0.5 },
  { key: '0.5-0.7', min: 0.5, max: 0.7 },
  { key: '0.7-0.9', min: 0.7, max: 0.9 },
  { key: '0.9-1.0', min: 0.9, max: 1.000001 }
]);

const RANKING_MODES = Object.freeze(['strict_signal', 'balanced', 'discovery']);
const TREND_MAX_SOURCES = 8;

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

function resolveTrendInterval(rangeKey, interval) {
  const normalized = String(interval || '').trim().toLowerCase();
  if (normalized === 'hourly' || normalized === 'daily') return normalized;
  return rangeKey === '30d' ? 'daily' : 'hourly';
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

function deltaDirection(value, epsilon = 0.25) {
  if (Math.abs(Number(value || 0)) <= epsilon) return 'flat';
  return value > 0 ? 'up' : 'down';
}

function calcDelta(current, previous) {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  const absoluteDelta = Number((currentValue - previousValue).toFixed(4));
  return {
    current: currentValue,
    previous: previousValue,
    absoluteDelta,
    percentageDelta: previousValue === 0 ? null : Number((((currentValue - previousValue) / previousValue) * 100).toFixed(2)),
    direction: deltaDirection(absoluteDelta)
  };
}

function zeroTierMap() {
  return {
    [RELEVANCE_TIERS.PORTFOLIO]: 0,
    [RELEVANCE_TIERS.WATCHLIST]: 0,
    [RELEVANCE_TIERS.GLOBAL_HIGH_SIGNAL]: 0,
    [RELEVANCE_TIERS.NEUTRAL]: 0
  };
}

function zeroEventTypeMap() {
  return {
    stock_news: 0,
    world_news: 0,
    earnings: 0,
    macro: 0
  };
}

function zeroNotificationReasons() {
  return {
    below_threshold: 0,
    preference_disabled: 0,
    not_relevant: 0,
    channel_disabled: 0
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
    blockReasons: zeroNotificationReasons(),
    byRankingMode: {},
    byRelevanceTier: zeroTierMap(),
    byEventType: zeroEventTypeMap(),
    byChannel: { in_app: 0, push: 0, email: 0 },
    channelErrors: { in_app: 0, push: 0, email: 0 }
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
    for (const [channel, count] of Object.entries(snapshot?.byChannel || {})) {
      if (totals.byChannel[channel] === undefined) continue;
      totals.byChannel[channel] += Number(count || 0);
    }
    for (const [channel, count] of Object.entries(snapshot?.channelErrors || {})) {
      if (totals.channelErrors[channel] === undefined) continue;
      totals.channelErrors[channel] += Number(count || 0);
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

function resolveSnapshotMeta(snapshots, range) {
  const ordered = (Array.isArray(snapshots) ? snapshots : [])
    .map((row) => ({ ...row, createdAt: normalizeIsoDate(row?.createdAt) }))
    .filter((row) => !!row.createdAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const earliest = ordered[0]?.createdAt || null;
  const coverageComplete = !earliest || earliest <= range.from;
  return {
    ordered,
    earliest,
    coverageComplete,
    retentionLimited: !coverageComplete,
    requestedFrom: range.from,
    effectiveFrom: coverageComplete ? range.from : (earliest || range.from)
  };
}

function makeBucketKey(iso, interval) {
  const ts = Date.parse(iso);
  const date = new Date(ts);
  if (interval === 'daily') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)).toISOString();
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), 0, 0, 0)).toISOString();
}

function bucketSnapshots(snapshots, range, interval) {
  const filtered = snapshots.filter((row) => row.createdAt >= range.from && row.createdAt <= range.now);
  const byBucket = new Map();
  for (const row of filtered) {
    const key = makeBucketKey(row.createdAt, interval);
    if (!byBucket.has(key)) byBucket.set(key, []);
    byBucket.get(key).push(row);
  }
  return Array.from(byBucket.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function sumObject(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = (target[key] || 0) + Number(value || 0);
  }
}

function summarizeRankingBucket(rows) {
  const stats = {
    sampleCount: rows.length,
    averageScore: 0,
    minScore: null,
    maxScore: null,
    rankingModeCounts: {},
    relevanceTierCounts: zeroTierMap(),
    scoreBuckets: Object.fromEntries(SCORE_BUCKETS.map((bucket) => [bucket.key, 0]))
  };
  if (!rows.length) return stats;
  let averageAccumulator = 0;
  let averageCount = 0;
  for (const row of rows) {
    const summary = row?.summary || {};
    const modeRows = summary.byMode || {};
    const balanced = modeRows.balanced?.distribution;
    if (Number.isFinite(Number(balanced?.avg))) {
      averageAccumulator += Number(balanced.avg);
      averageCount += 1;
    }
    for (const [mode, modeSummary] of Object.entries(modeRows)) {
      stats.rankingModeCounts[mode] = (stats.rankingModeCounts[mode] || 0) + Number(modeSummary?.count || 0);
      sumObject(stats.scoreBuckets, modeSummary?.distribution?.buckets || {});
      sumObject(stats.relevanceTierCounts, modeSummary?.relevanceTiers || {});
      const min = Number(modeSummary?.distribution?.min);
      const max = Number(modeSummary?.distribution?.max);
      if (Number.isFinite(min)) stats.minScore = stats.minScore === null ? min : Math.min(stats.minScore, min);
      if (Number.isFinite(max)) stats.maxScore = stats.maxScore === null ? max : Math.max(stats.maxScore, max);
    }
  }
  stats.averageScore = averageCount ? Number((averageAccumulator / averageCount).toFixed(4)) : 0;
  stats.minScore = Number((stats.minScore === null ? 0 : stats.minScore).toFixed(4));
  stats.maxScore = Number((stats.maxScore === null ? 0 : stats.maxScore).toFixed(4));
  return stats;
}

function summarizeThresholdBucket(rows) {
  const stages = ['latest', 'for_you', 'notification'];
  const baseStage = () => ({ dropped: 0, surfaced: 0, totalIngested: 0, percentDropped: 0, percentSurfaced: 0, byTier: zeroTierMap(), byMode: {}, bySource: {} });
  const summary = Object.fromEntries(stages.map((stage) => [stage, baseStage()]));
  for (const row of rows) {
    const thresholds = row?.summary?.thresholds || {};
    for (const stage of stages) {
      const source = thresholds[stage] || {};
      summary[stage].dropped += Number(source.dropped || 0);
      summary[stage].surfaced += Number(source.surfaced || 0);
      summary[stage].totalIngested += Number(source.totalIngested || 0);
      sumObject(summary[stage].byTier, source.byTier || {});
      sumObject(summary[stage].byMode, source.byMode || {});
      sumObject(summary[stage].bySource, source.bySource || {});
    }
  }
  for (const stage of stages) {
    summary[stage].percentDropped = toPercent(summary[stage].dropped, summary[stage].totalIngested);
    summary[stage].percentSurfaced = toPercent(summary[stage].surfaced, summary[stage].totalIngested);
  }
  return summary;
}

function summarizeNotificationBucket(rows) {
  const summary = {
    eligible: 0,
    blocked: 0,
    blockReasons: zeroNotificationReasons(),
    byRankingMode: {},
    byRelevanceTier: zeroTierMap(),
    byEventType: zeroEventTypeMap(),
    byChannel: { in_app: 0, push: 0, email: 0 },
    channelErrors: { in_app: 0, push: 0, email: 0 }
  };
  for (const row of rows) {
    summary.eligible += Number(row?.eligible || 0);
    summary.blocked += Number(row?.blocked || 0);
    sumObject(summary.blockReasons, row?.blockReasons || {});
    sumObject(summary.byRankingMode, row?.byRankingMode || {});
    sumObject(summary.byRelevanceTier, row?.byRelevanceTier || {});
    sumObject(summary.byEventType, row?.byEventType || {});
    sumObject(summary.byChannel, row?.byChannel || {});
    sumObject(summary.channelErrors, row?.channelErrors || {});
  }
  const total = summary.eligible + summary.blocked;
  summary.eligiblePct = toPercent(summary.eligible, total);
  summary.blockedPct = toPercent(summary.blocked, total);
  return summary;
}

function bucketTopN(map = {}, limit = TREND_MAX_SOURCES) {
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, limit);
  const other = sorted.slice(limit).reduce((acc, [, value]) => acc + Number(value || 0), 0);
  const result = Object.fromEntries(top);
  if (other > 0) result.other = other;
  return result;
}

function summarizeSourceBucket(rows) {
  const sources = {};
  const trustTier = { high: 0, medium: 0, low: 0 };
  for (const row of rows) {
    const bySource = row?.summary?.topSourceRollups || row?.summary?.sourceRollups || {};
    for (const [source, sourceStats] of Object.entries(bySource)) {
      sources[source] ||= { surfaced: 0, suppressed: 0 };
      sources[source].surfaced += Number(sourceStats?.surfaced || 0);
      sources[source].suppressed += Number(sourceStats?.suppressed || 0);
      if (trustTier[sourceStats?.trustTier] !== undefined) {
        trustTier[sourceStats.trustTier] += Number(sourceStats?.headlines || 0);
      }
    }
  }
  const surfacedMap = {};
  const suppressedMap = {};
  for (const [source, stats] of Object.entries(sources)) {
    surfacedMap[source] = stats.surfaced;
    suppressedMap[source] = stats.suppressed;
  }
  return {
    sourceContribution: bucketTopN(surfacedMap),
    sourceSuppression: bucketTopN(suppressedMap),
    trustTierMix: trustTier
  };
}

function getRankingTrendSeries(options = {}) {
  const db = typeof options.loadDB === 'function' ? options.loadDB() : {};
  const range = resolveTimeRange(options.timeRange, options.now);
  const interval = resolveTrendInterval(range.key, options.interval);
  const meta = resolveSnapshotMeta(db?.newsDiagnosticsSnapshots?.ranking, range);
  const buckets = bucketSnapshots(meta.ordered, range, interval);

  const series = buckets.map(([bucketStart, rows]) => ({
    bucketStart,
    bucketEnd: rows[rows.length - 1]?.createdAt || bucketStart,
    ...summarizeRankingBucket(rows)
  }));

  return {
    metadata: {
      family: 'ranking',
      timeRange: range.key,
      interval,
      sampleCount: meta.ordered.filter((row) => row.createdAt >= range.from && row.createdAt <= range.now).length,
      requestedWindow: { from: range.from, to: range.now },
      effectiveWindow: { from: meta.effectiveFrom, to: range.now },
      retentionLimited: meta.retentionLimited,
      fallbackReason: meta.retentionLimited ? 'bounded_snapshot_retention' : null
    },
    scoreBuckets: SCORE_BUCKETS.map((bucket) => bucket.key),
    series
  };
}

function getThresholdTrendSeries(options = {}) {
  const db = typeof options.loadDB === 'function' ? options.loadDB() : {};
  const range = resolveTimeRange(options.timeRange, options.now);
  const interval = resolveTrendInterval(range.key, options.interval);
  const meta = resolveSnapshotMeta(db?.newsDiagnosticsSnapshots?.thresholds, range);
  const buckets = bucketSnapshots(meta.ordered, range, interval);
  const series = buckets.map(([bucketStart, rows]) => ({
    bucketStart,
    bucketEnd: rows[rows.length - 1]?.createdAt || bucketStart,
    thresholds: summarizeThresholdBucket(rows)
  }));

  return {
    metadata: {
      family: 'thresholds',
      timeRange: range.key,
      interval,
      sampleCount: meta.ordered.filter((row) => row.createdAt >= range.from && row.createdAt <= range.now).length,
      requestedWindow: { from: range.from, to: range.now },
      effectiveWindow: { from: meta.effectiveFrom, to: range.now },
      retentionLimited: meta.retentionLimited,
      fallbackReason: meta.retentionLimited ? 'bounded_snapshot_retention' : null
    },
    series
  };
}

function getNotificationTrendSeries(options = {}) {
  const db = typeof options.loadDB === 'function' ? options.loadDB() : {};
  const range = resolveTimeRange(options.timeRange, options.now);
  const interval = resolveTrendInterval(range.key, options.interval);
  const meta = resolveSnapshotMeta(db?.newsDiagnosticsSnapshots?.notifications, range);
  const buckets = bucketSnapshots(meta.ordered, range, interval);
  const series = buckets.map(([bucketStart, rows]) => ({
    bucketStart,
    bucketEnd: rows[rows.length - 1]?.createdAt || bucketStart,
    notifications: summarizeNotificationBucket(rows)
  }));

  return {
    metadata: {
      family: 'notifications',
      timeRange: range.key,
      interval,
      sampleCount: meta.ordered.filter((row) => row.createdAt >= range.from && row.createdAt <= range.now).length,
      requestedWindow: { from: range.from, to: range.now },
      effectiveWindow: { from: meta.effectiveFrom, to: range.now },
      retentionLimited: meta.retentionLimited,
      fallbackReason: meta.retentionLimited ? 'bounded_snapshot_retention' : null
    },
    series
  };
}

function getSourceTrendSeries(options = {}) {
  const db = typeof options.loadDB === 'function' ? options.loadDB() : {};
  const range = resolveTimeRange(options.timeRange, options.now);
  const interval = resolveTrendInterval(range.key, options.interval);
  const meta = resolveSnapshotMeta(db?.newsDiagnosticsSnapshots?.thresholds, range);
  const buckets = bucketSnapshots(meta.ordered, range, interval);
  const series = buckets.map(([bucketStart, rows]) => ({
    bucketStart,
    bucketEnd: rows[rows.length - 1]?.createdAt || bucketStart,
    ...summarizeSourceBucket(rows)
  }));

  return {
    metadata: {
      family: 'sources',
      timeRange: range.key,
      interval,
      sampleCount: meta.ordered.filter((row) => row.createdAt >= range.from && row.createdAt <= range.now).length,
      requestedWindow: { from: range.from, to: range.now },
      effectiveWindow: { from: meta.effectiveFrom, to: range.now },
      retentionLimited: meta.retentionLimited,
      fallbackReason: meta.retentionLimited ? 'bounded_snapshot_retention' : null
    },
    topN: TREND_MAX_SOURCES,
    series
  };
}

function getDiagnosticsTrendSeries(options = {}) {
  const ranking = getRankingTrendSeries(options);
  const thresholds = getThresholdTrendSeries(options);
  const notifications = getNotificationTrendSeries(options);
  const sources = getSourceTrendSeries(options);

  const overviewSeries = ranking.series.map((point, index) => {
    const thresholdPoint = thresholds.series[index] || {};
    const notificationPoint = notifications.series[index] || {};
    const tierTotal = Object.values(point.relevanceTierCounts || {}).reduce((acc, value) => acc + value, 0);
    return {
      bucketStart: point.bucketStart,
      bucketEnd: point.bucketEnd,
      averageScore: point.averageScore,
      latestDropoffPct: thresholdPoint?.thresholds?.latest?.percentDropped || 0,
      forYouDropoffPct: thresholdPoint?.thresholds?.for_you?.percentDropped || 0,
      notificationDropoffPct: thresholdPoint?.thresholds?.notification?.percentDropped || 0,
      surfacedPortfolioPct: toPercent(point.relevanceTierCounts?.portfolio || 0, tierTotal),
      surfacedWatchlistPct: toPercent(point.relevanceTierCounts?.watchlist || 0, tierTotal),
      surfacedGlobalHighSignalPct: toPercent(point.relevanceTierCounts?.global_high_signal || 0, tierTotal),
      surfacedNeutralPct: toPercent(point.relevanceTierCounts?.neutral || 0, tierTotal),
      eligiblePct: notificationPoint?.notifications?.eligiblePct || 0,
      blockedPct: notificationPoint?.notifications?.blockedPct || 0
    };
  });

  return {
    metadata: {
      timeRange: ranking.metadata.timeRange,
      interval: ranking.metadata.interval,
      sampleCount: overviewSeries.length,
      baselineAvailability: {
        ranking: ranking.series.length >= 2,
        thresholds: thresholds.series.length >= 2,
        notifications: notifications.series.length >= 2,
        sources: sources.series.length >= 2
      },
      retentionLimited: ranking.metadata.retentionLimited || thresholds.metadata.retentionLimited || notifications.metadata.retentionLimited || sources.metadata.retentionLimited,
      fallbackReason: ranking.metadata.fallbackReason || thresholds.metadata.fallbackReason || notifications.metadata.fallbackReason || sources.metadata.fallbackReason || null
    },
    overviewSeries,
    ranking,
    thresholds,
    notifications,
    sources
  };
}

function getRangeForWindow(window, now) {
  const nowIso = normalizeIsoDate(now) || new Date().toISOString();
  const duration = SUPPORTED_TIME_RANGES[window] || SUPPORTED_TIME_RANGES['24h'];
  const from = new Date(Date.parse(nowIso) - duration).toISOString();
  return { now: nowIso, from };
}

function aggregateRankingSnapshots(snapshots) {
  const summary = { avgScoreBalanced: 0, minScore: 0, maxScore: 0, modeCounts: {}, relevanceMix: zeroTierMap(), sampleCount: snapshots.length };
  if (!snapshots.length) return summary;
  let avgAccumulator = 0;
  let minScore = Infinity;
  let maxScore = -Infinity;
  for (const row of snapshots) {
    const balanced = Number(row?.summary?.byMode?.balanced?.distribution?.avg || 0);
    avgAccumulator += balanced;
    for (const [mode, stats] of Object.entries(row?.summary?.byMode || {})) {
      summary.modeCounts[mode] = (summary.modeCounts[mode] || 0) + Number(stats?.count || 0);
      minScore = Math.min(minScore, Number(stats?.distribution?.min || 0));
      maxScore = Math.max(maxScore, Number(stats?.distribution?.max || 0));
      sumObject(summary.relevanceMix, stats?.relevanceTiers || {});
    }
  }
  summary.avgScoreBalanced = Number((avgAccumulator / snapshots.length).toFixed(4));
  summary.minScore = Number((Number.isFinite(minScore) ? minScore : 0).toFixed(4));
  summary.maxScore = Number((Number.isFinite(maxScore) ? maxScore : 0).toFixed(4));
  return summary;
}

function aggregateThresholdSnapshots(snapshots) {
  const stage = () => ({ dropped: 0, surfaced: 0, totalIngested: 0, byTier: zeroTierMap(), byMode: {}, bySource: {} });
  const summary = { latest: stage(), for_you: stage(), notification: stage(), sampleCount: snapshots.length };
  for (const row of snapshots) {
    for (const key of ['latest', 'for_you', 'notification']) {
      const item = row?.summary?.thresholds?.[key] || {};
      summary[key].dropped += Number(item?.dropped || 0);
      summary[key].surfaced += Number(item?.surfaced || 0);
      summary[key].totalIngested += Number(item?.totalIngested || 0);
      sumObject(summary[key].byTier, item?.byTier || {});
      sumObject(summary[key].byMode, item?.byMode || {});
      sumObject(summary[key].bySource, item?.bySource || {});
    }
  }
  for (const key of ['latest', 'for_you', 'notification']) {
    summary[key].percentDropped = toPercent(summary[key].dropped, summary[key].totalIngested);
    summary[key].percentSurfaced = toPercent(summary[key].surfaced, summary[key].totalIngested);
  }
  return summary;
}

function aggregateNotificationSnapshots(snapshots) {
  return summarizeNotificationBucket(snapshots);
}

function trendLabel(metric, direction) {
  if (direction === 'flat') return 'stable';
  if (metric === 'dropoff' || metric === 'blockedPct' || metric === 'suppression') {
    return direction === 'up' ? 'worsening' : 'improving';
  }
  return direction === 'up' ? 'improving' : 'worsening';
}

function getBaselineComparison(options = {}) {
  const db = typeof options.loadDB === 'function' ? options.loadDB() : {};
  const window = String(options.baselineWindow || options.timeRange || '24h').trim();
  const normalizedWindow = window === '7d' ? '7d' : '24h';
  const nowIso = normalizeIsoDate(options.now) || new Date().toISOString();
  const current = getRangeForWindow(normalizedWindow, nowIso);
  const previous = {
    now: current.from,
    from: new Date(Date.parse(current.from) - SUPPORTED_TIME_RANGES[normalizedWindow]).toISOString()
  };

  const rankingRows = resolveSnapshotMeta(db?.newsDiagnosticsSnapshots?.ranking, { from: previous.from, now: current.now }).ordered;
  const thresholdRows = resolveSnapshotMeta(db?.newsDiagnosticsSnapshots?.thresholds, { from: previous.from, now: current.now }).ordered;
  const notificationRows = resolveSnapshotMeta(db?.newsDiagnosticsSnapshots?.notifications, { from: previous.from, now: current.now }).ordered;

  const inWindow = (rows, range) => rows.filter((row) => row.createdAt >= range.from && row.createdAt <= range.now);
  const rankingCurrent = inWindow(rankingRows, current);
  const rankingPrevious = inWindow(rankingRows, previous);
  const thresholdCurrent = inWindow(thresholdRows, current);
  const thresholdPrevious = inWindow(thresholdRows, previous);
  const notificationCurrent = inWindow(notificationRows, current);
  const notificationPrevious = inWindow(notificationRows, previous);

  const baselineAvailability = {
    ranking: rankingPrevious.length > 0,
    thresholds: thresholdPrevious.length > 0,
    notifications: notificationPrevious.length > 0
  };

  if (!baselineAvailability.ranking || !baselineAvailability.thresholds || !baselineAvailability.notifications) {
    return {
      metadata: {
        baselineWindow: normalizedWindow,
        now: nowIso,
        current,
        previous,
        baselineAvailability,
        insufficientBaseline: true
      },
      comparisons: null
    };
  }

  const currentRanking = aggregateRankingSnapshots(rankingCurrent);
  const previousRanking = aggregateRankingSnapshots(rankingPrevious);
  const currentThreshold = aggregateThresholdSnapshots(thresholdCurrent);
  const previousThreshold = aggregateThresholdSnapshots(thresholdPrevious);
  const currentNotification = aggregateNotificationSnapshots(notificationCurrent);
  const previousNotification = aggregateNotificationSnapshots(notificationPrevious);

  const currentRelevanceTotal = Object.values(currentRanking.relevanceMix).reduce((acc, value) => acc + value, 0);
  const previousRelevanceTotal = Object.values(previousRanking.relevanceMix).reduce((acc, value) => acc + value, 0);

  const blockReasonsCurrentTotal = Object.values(currentNotification.blockReasons).reduce((acc, value) => acc + value, 0);
  const blockReasonsPrevTotal = Object.values(previousNotification.blockReasons).reduce((acc, value) => acc + value, 0);

  const eligibleRatioCurrent = toPercent(currentNotification.eligible, currentNotification.eligible + currentNotification.blocked);
  const eligibleRatioPrev = toPercent(previousNotification.eligible, previousNotification.eligible + previousNotification.blocked);

  const comparisons = {
    rankingScoreAverages: calcDelta(currentRanking.avgScoreBalanced, previousRanking.avgScoreBalanced),
    thresholdDropoffPercentages: {
      latest: calcDelta(currentThreshold.latest.percentDropped, previousThreshold.latest.percentDropped),
      forYou: calcDelta(currentThreshold.for_you.percentDropped, previousThreshold.for_you.percentDropped),
      notification: calcDelta(currentThreshold.notification.percentDropped, previousThreshold.notification.percentDropped)
    },
    surfacedRelevanceMix: {
      portfolio: calcDelta(toPercent(currentRanking.relevanceMix.portfolio, currentRelevanceTotal), toPercent(previousRanking.relevanceMix.portfolio, previousRelevanceTotal)),
      watchlist: calcDelta(toPercent(currentRanking.relevanceMix.watchlist, currentRelevanceTotal), toPercent(previousRanking.relevanceMix.watchlist, previousRelevanceTotal)),
      globalHighSignal: calcDelta(toPercent(currentRanking.relevanceMix.global_high_signal, currentRelevanceTotal), toPercent(previousRanking.relevanceMix.global_high_signal, previousRelevanceTotal)),
      neutral: calcDelta(toPercent(currentRanking.relevanceMix.neutral, currentRelevanceTotal), toPercent(previousRanking.relevanceMix.neutral, previousRelevanceTotal))
    },
    sourceSuppressionPercentage: calcDelta(currentThreshold.latest.percentDropped, previousThreshold.latest.percentDropped),
    notificationBlockReasonMix: {
      below_threshold: calcDelta(toPercent(currentNotification.blockReasons.below_threshold, blockReasonsCurrentTotal), toPercent(previousNotification.blockReasons.below_threshold, blockReasonsPrevTotal)),
      preference_disabled: calcDelta(toPercent(currentNotification.blockReasons.preference_disabled, blockReasonsCurrentTotal), toPercent(previousNotification.blockReasons.preference_disabled, blockReasonsPrevTotal)),
      not_relevant: calcDelta(toPercent(currentNotification.blockReasons.not_relevant, blockReasonsCurrentTotal), toPercent(previousNotification.blockReasons.not_relevant, blockReasonsPrevTotal)),
      channel_disabled: calcDelta(toPercent(currentNotification.blockReasons.channel_disabled, blockReasonsCurrentTotal), toPercent(previousNotification.blockReasons.channel_disabled, blockReasonsPrevTotal))
    },
    eligibleVsBlockedRatios: {
      eligibleRatio: calcDelta(eligibleRatioCurrent, eligibleRatioPrev),
      blockedRatio: calcDelta(100 - eligibleRatioCurrent, 100 - eligibleRatioPrev)
    }
  };

  const driftIndicators = {
    thresholdDropoff: {
      direction: comparisons.thresholdDropoffPercentages.latest.direction,
      label: trendLabel('dropoff', comparisons.thresholdDropoffPercentages.latest.direction)
    },
    portfolioShare: {
      direction: comparisons.surfacedRelevanceMix.portfolio.direction,
      label: trendLabel('portfolio', comparisons.surfacedRelevanceMix.portfolio.direction)
    },
    rankingAverage: {
      direction: comparisons.rankingScoreAverages.direction,
      label: trendLabel('score', comparisons.rankingScoreAverages.direction)
    },
    notificationBlocked: {
      direction: comparisons.eligibleVsBlockedRatios.blockedRatio.direction,
      label: trendLabel('blockedPct', comparisons.eligibleVsBlockedRatios.blockedRatio.direction)
    }
  };

  return {
    metadata: {
      baselineWindow: normalizedWindow,
      now: nowIso,
      current,
      previous,
      baselineAvailability,
      insufficientBaseline: false,
      sampleCount: {
        rankingCurrent: rankingCurrent.length,
        rankingPrevious: rankingPrevious.length,
        thresholdCurrent: thresholdCurrent.length,
        thresholdPrevious: thresholdPrevious.length,
        notificationCurrent: notificationCurrent.length,
        notificationPrevious: notificationPrevious.length
      }
    },
    comparisons,
    driftIndicators
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
  SCORE_BUCKETS,
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
};
