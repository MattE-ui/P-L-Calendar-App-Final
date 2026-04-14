const { resolveSourceProfile, TRUST_TIER_BASE_SCORES } = require('./newsSourceRegistry');
const {
  getUserEventRelevance,
  RELEVANCE_TIERS,
  resolveRankingMode
} = require('./newsUserRelevanceService');

const RANKING_MODE_PROFILES = Object.freeze({
  strict_signal: Object.freeze({
    mode: 'strict_signal',
    weights: Object.freeze({ relevance: 0.64, recency: 0.16, source: 0.13, importance: 0.07 }),
    thresholds: Object.freeze({ latestMinScore: 0.32, forYouHeadlineMinScore: 0.58, forYouGlobalMinScore: 0.91, notificationHeadlineMinScore: 0.75 })
  }),
  balanced: Object.freeze({
    mode: 'balanced',
    weights: Object.freeze({ relevance: 0.55, recency: 0.2, source: 0.15, importance: 0.1 }),
    thresholds: Object.freeze({ latestMinScore: 0.2, forYouHeadlineMinScore: 0.5, forYouGlobalMinScore: 0.82, notificationHeadlineMinScore: 0.6 })
  }),
  discovery: Object.freeze({
    mode: 'discovery',
    weights: Object.freeze({ relevance: 0.48, recency: 0.24, source: 0.16, importance: 0.12 }),
    thresholds: Object.freeze({ latestMinScore: 0.18, forYouHeadlineMinScore: 0.46, forYouGlobalMinScore: 0.78, notificationHeadlineMinScore: 0.48 })
  })
});

function getRankingModeProfile(mode) {
  const resolved = resolveRankingMode(mode);
  return RANKING_MODE_PROFILES[resolved] || RANKING_MODE_PROFILES.balanced;
}

function normalizeIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function computeRelevanceScore(event, context = {}) {
  const relevance = getUserEventRelevance(event, {
    ...context,
    sourceProfile: context.sourceProfile
  });

  return {
    relevanceScore: relevance.relevanceScore,
    relevanceTier: relevance.relevanceTier,
    relevanceReason: relevance.reason
  };
}

function computeRecencyScore(event, context = {}) {
  const nowIso = normalizeIsoDate(context.now) || new Date().toISOString();
  const nowTs = Date.parse(nowIso);
  const publishedAt = normalizeIsoDate(event?.publishedAt || event?.updatedAt || event?.createdAt);
  if (!publishedAt) return 0.2;
  const ageHours = Math.max(0, (nowTs - Date.parse(publishedAt)) / (60 * 60 * 1000));
  const maxWindowHours = Number.isFinite(Number(context.recencyWindowHours)) ? Number(context.recencyWindowHours) : 72;
  return clamp01(1 - (ageHours / maxWindowHours));
}

function computeSourceScore(event, context = {}) {
  const profile = resolveSourceProfile(context.sourceProfiles || [], event?.sourceName);
  const tierBase = TRUST_TIER_BASE_SCORES[profile.trustTier] ?? TRUST_TIER_BASE_SCORES.low;
  const boostNormalized = clamp01((Number(profile.priorityBoost || 0) + 20) / 40);
  const weighted = clamp01((tierBase * 0.8) + (boostNormalized * 0.2));
  return {
    sourceScore: weighted,
    sourceProfile: profile
  };
}

function computeImportanceScore(event) {
  const providerSignal = Number(event?.metadataJson?.providerImportance ?? event?.metadataJson?.newsScore);
  if (Number.isFinite(providerSignal)) return clamp01(providerSignal / 100);
  const importance = Number(event?.importance || 0);
  return clamp01(importance / 100);
}

function scoreNewsEvent(event, context = {}) {
  const modeProfile = getRankingModeProfile(context.rankingMode);
  const { sourceScore, sourceProfile } = computeSourceScore(event, context);
  const { relevanceScore, relevanceTier, relevanceReason } = computeRelevanceScore(event, {
    ...context,
    sourceProfile
  });
  const recencyScore = computeRecencyScore(event, context);
  const importanceScore = computeImportanceScore(event);

  const totalScore = clamp01(
    (relevanceScore * modeProfile.weights.relevance)
    + (recencyScore * modeProfile.weights.recency)
    + (sourceScore * modeProfile.weights.source)
    + (importanceScore * modeProfile.weights.importance)
  );

  return {
    eventId: String(event?.id || ''),
    rankingMode: modeProfile.mode,
    totalScore,
    relevanceScore,
    relevanceTier,
    relevanceReason,
    recencyScore,
    sourceScore,
    importanceScore,
    sourceProfile
  };
}

function rankNewsEvents(events = [], context = {}) {
  const scored = (Array.isArray(events) ? events : []).map((event) => ({
    event,
    score: scoreNewsEvent(event, context)
  }));

  return scored.sort((a, b) => {
    if (b.score.totalScore !== a.score.totalScore) return b.score.totalScore - a.score.totalScore;
    const bAt = normalizeIsoDate(b.event?.publishedAt || b.event?.updatedAt || b.event?.createdAt) || '1970-01-01T00:00:00.000Z';
    const aAt = normalizeIsoDate(a.event?.publishedAt || a.event?.updatedAt || a.event?.createdAt) || '1970-01-01T00:00:00.000Z';
    if (bAt !== aAt) return bAt.localeCompare(aAt);
    return String(a.event?.id || '').localeCompare(String(b.event?.id || ''));
  });
}

function buildRankingDiagnostics(events = [], scoredRows = [], context = {}) {
  const rows = Array.isArray(scoredRows) && scoredRows.length
    ? scoredRows
    : rankNewsEvents(events, context);
  const totals = rows.map((row) => Number(row?.score?.totalScore || 0));
  const min = totals.length ? Math.min(...totals) : 0;
  const max = totals.length ? Math.max(...totals) : 0;
  const avg = totals.length ? (totals.reduce((sum, value) => sum + value, 0) / totals.length) : 0;
  const sourceBreakdown = rows.reduce((acc, row) => {
    const source = String(row?.event?.sourceName || 'unknown');
    if (!acc[source]) {
      acc[source] = {
        count: 0,
        avgScore: 0,
        trustTier: row?.score?.sourceProfile?.trustTier || 'low'
      };
    }
    acc[source].count += 1;
    acc[source].avgScore += Number(row?.score?.totalScore || 0);
    return acc;
  }, {});
  const relevanceBreakdown = rows.reduce((acc, row) => {
    const tier = row?.score?.relevanceTier || RELEVANCE_TIERS.NEUTRAL;
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {
    [RELEVANCE_TIERS.PORTFOLIO]: 0,
    [RELEVANCE_TIERS.WATCHLIST]: 0,
    [RELEVANCE_TIERS.GLOBAL_HIGH_SIGNAL]: 0,
    [RELEVANCE_TIERS.NEUTRAL]: 0
  });

  for (const source of Object.keys(sourceBreakdown)) {
    sourceBreakdown[source].avgScore = sourceBreakdown[source].count
      ? Number((sourceBreakdown[source].avgScore / sourceBreakdown[source].count).toFixed(4))
      : 0;
  }

  return {
    rankingMode: getRankingModeProfile(context.rankingMode).mode,
    modeProfile: getRankingModeProfile(context.rankingMode),
    distribution: {
      min: Number(min.toFixed(4)),
      avg: Number(avg.toFixed(4)),
      max: Number(max.toFixed(4))
    },
    relevanceBreakdown,
    sourceBreakdown
  };
}

module.exports = {
  RANKING_MODE_PROFILES,
  getRankingModeProfile,
  scoreNewsEvent,
  rankNewsEvents,
  buildRankingDiagnostics
};
