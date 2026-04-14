const { normalizeTicker, isEventRelevantToUser } = require('./ownedTickerUniverseService');

const RELEVANCE_TIERS = Object.freeze({
  PORTFOLIO: 'portfolio',
  WATCHLIST: 'watchlist',
  GLOBAL_HIGH_SIGNAL: 'global_high_signal',
  NEUTRAL: 'neutral'
});

const BASE_RELEVANCE_SCORES = Object.freeze({
  strict_signal: Object.freeze({ portfolio: 1, watchlist: 0.45, global_high_signal: 0.2, neutral: 0 }),
  balanced: Object.freeze({ portfolio: 1, watchlist: 0.62, global_high_signal: 0.34, neutral: 0 }),
  discovery: Object.freeze({ portfolio: 1, watchlist: 0.72, global_high_signal: 0.45, neutral: 0 })
});

const GLOBAL_HIGH_SIGNAL_IMPORTANCE_THRESHOLD = 94;

function normalizeTickerSet(values) {
  const set = new Set();
  let skippedInvalid = 0;
  for (const value of values || []) {
    const normalized = normalizeTicker(value);
    if (!normalized) {
      skippedInvalid += 1;
      continue;
    }
    set.add(normalized);
  }
  return { tickers: set, skippedInvalid };
}

function resolveRankingMode(mode) {
  const value = String(mode || '').trim();
  return BASE_RELEVANCE_SCORES[value] ? value : 'balanced';
}

function getUserTickerUniverse(userId, options = {}) {
  const portfolioRaw = typeof options.resolvePortfolioTickerUniverse === 'function'
    ? options.resolvePortfolioTickerUniverse(userId)
    : new Set();

  let watchlistsResolved = true;
  let watchlistRaw = [];
  try {
    watchlistRaw = typeof options.resolveWatchlistTickerUniverse === 'function'
      ? options.resolveWatchlistTickerUniverse(userId)
      : [];
  } catch (_error) {
    watchlistsResolved = false;
  }

  const portfolioNormalized = normalizeTickerSet(portfolioRaw instanceof Set ? Array.from(portfolioRaw) : portfolioRaw);
  const watchlistNormalized = normalizeTickerSet(watchlistRaw instanceof Set ? Array.from(watchlistRaw) : watchlistRaw);

  for (const ticker of portfolioNormalized.tickers) {
    watchlistNormalized.tickers.delete(ticker);
  }

  const combined = new Set([...portfolioNormalized.tickers, ...watchlistNormalized.tickers]);

  return {
    userId,
    portfolioTickers: portfolioNormalized.tickers,
    watchlistTickers: watchlistNormalized.tickers,
    allTickers: combined,
    diagnostics: {
      portfolioCount: portfolioNormalized.tickers.size,
      watchlistCount: Array.isArray(watchlistRaw) || watchlistRaw instanceof Set ? (watchlistRaw.size || watchlistRaw.length || 0) : 0,
      watchlistValidTickerCount: watchlistNormalized.tickers.size,
      watchlistSkippedInvalid: watchlistNormalized.skippedInvalid,
      watchlistResolved: watchlistsResolved
    }
  };
}

function isGlobalHighSignal(event, context = {}) {
  const threshold = Number.isFinite(Number(context.globalHighSignalImportanceThreshold))
    ? Number(context.globalHighSignalImportanceThreshold)
    : GLOBAL_HIGH_SIGNAL_IMPORTANCE_THRESHOLD;
  const importance = Number(event?.metadataJson?.providerImportance ?? event?.metadataJson?.newsScore ?? event?.importance ?? 0);
  if (!Number.isFinite(importance) || importance < threshold) return false;
  const trustTier = String(context?.sourceProfile?.trustTier || '').toLowerCase();
  return trustTier === 'high' || trustTier === 'medium';
}

function getUserEventRelevance(event, context = {}) {
  const userId = context.userId || null;
  const rankingMode = resolveRankingMode(context.rankingMode);
  const universe = context.userTickerUniverse || {
    portfolioTickers: context.userTickers instanceof Set ? context.userTickers : new Set(),
    watchlistTickers: context.watchlistTickers instanceof Set ? context.watchlistTickers : new Set()
  };
  const ticker = normalizeTicker(event?.canonicalTicker || event?.ticker);

  const mappedPortfolio = userId ? isEventRelevantToUser(event, userId) : false;
  const portfolioHit = mappedPortfolio || (ticker && universe.portfolioTickers.has(ticker));
  if (portfolioHit) {
    return {
      relevanceTier: RELEVANCE_TIERS.PORTFOLIO,
      relevanceScore: BASE_RELEVANCE_SCORES[rankingMode].portfolio,
      reason: mappedPortfolio ? 'mapped_relevance_user' : 'portfolio_ticker'
    };
  }

  if (ticker && universe.watchlistTickers.has(ticker)) {
    return {
      relevanceTier: RELEVANCE_TIERS.WATCHLIST,
      relevanceScore: BASE_RELEVANCE_SCORES[rankingMode].watchlist,
      reason: 'watchlist_ticker'
    };
  }

  if (isGlobalHighSignal(event, context)) {
    return {
      relevanceTier: RELEVANCE_TIERS.GLOBAL_HIGH_SIGNAL,
      relevanceScore: BASE_RELEVANCE_SCORES[rankingMode].global_high_signal,
      reason: 'global_high_signal'
    };
  }

  return {
    relevanceTier: RELEVANCE_TIERS.NEUTRAL,
    relevanceScore: BASE_RELEVANCE_SCORES[rankingMode].neutral,
    reason: 'neutral'
  };
}

function buildUserRelevanceDiagnostics(events = [], context = {}) {
  const rows = Array.isArray(events) ? events : [];
  const distribution = {
    portfolio: 0,
    watchlist: 0,
    global_high_signal: 0,
    neutral: 0
  };

  for (const event of rows) {
    const relevance = getUserEventRelevance(event, context);
    distribution[relevance.relevanceTier] += 1;
  }

  return {
    rankingMode: resolveRankingMode(context.rankingMode),
    evaluatedCount: rows.length,
    distribution,
    tickerUniverse: context.userTickerUniverse?.diagnostics || null
  };
}

module.exports = {
  RELEVANCE_TIERS,
  BASE_RELEVANCE_SCORES,
  GLOBAL_HIGH_SIGNAL_IMPORTANCE_THRESHOLD,
  getUserEventRelevance,
  getUserTickerUniverse,
  buildUserRelevanceDiagnostics,
  resolveRankingMode
};
