const { resolveSourceProfile, TRUST_TIER_BASE_SCORES } = require('./newsSourceRegistry');

const RANKING_WEIGHTS = Object.freeze({
  relevance: 0.55,
  recency: 0.2,
  source: 0.15,
  importance: 0.1
});

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
  if (typeof context.isPortfolioRelevant === 'boolean') return context.isPortfolioRelevant ? 1 : 0;
  const userTickers = context.userTickers instanceof Set ? context.userTickers : new Set();
  const ticker = String(event?.canonicalTicker || event?.ticker || '').toUpperCase();
  const mapped = Array.isArray(event?.metadataJson?.relevanceUserIds) && context.userId
    ? event.metadataJson.relevanceUserIds.includes(context.userId)
    : false;
  return ticker && userTickers.has(ticker) || mapped ? 1 : 0;
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
  const relevanceScore = computeRelevanceScore(event, context);
  const recencyScore = computeRecencyScore(event, context);
  const { sourceScore, sourceProfile } = computeSourceScore(event, context);
  const importanceScore = computeImportanceScore(event);

  const totalScore = clamp01(
    (relevanceScore * RANKING_WEIGHTS.relevance)
    + (recencyScore * RANKING_WEIGHTS.recency)
    + (sourceScore * RANKING_WEIGHTS.source)
    + (importanceScore * RANKING_WEIGHTS.importance)
  );

  return {
    eventId: String(event?.id || ''),
    totalScore,
    relevanceScore,
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

function buildRankingDiagnostics(events = [], scoredRows = []) {
  const rows = Array.isArray(scoredRows) && scoredRows.length
    ? scoredRows
    : rankNewsEvents(events, {});
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

  for (const source of Object.keys(sourceBreakdown)) {
    sourceBreakdown[source].avgScore = sourceBreakdown[source].count
      ? Number((sourceBreakdown[source].avgScore / sourceBreakdown[source].count).toFixed(4))
      : 0;
  }

  return {
    weights: RANKING_WEIGHTS,
    distribution: {
      min: Number(min.toFixed(4)),
      avg: Number(avg.toFixed(4)),
      max: Number(max.toFixed(4))
    },
    sourceBreakdown
  };
}

module.exports = {
  RANKING_WEIGHTS,
  scoreNewsEvent,
  rankNewsEvents,
  buildRankingDiagnostics
};
