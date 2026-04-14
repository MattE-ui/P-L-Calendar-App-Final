const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getUserTickerUniverse,
  getUserEventRelevance,
  buildUserRelevanceDiagnostics
} = require('../services/news/newsUserRelevanceService');

test('getUserTickerUniverse normalizes watchlist tickers and fails soft', () => {
  const healthy = getUserTickerUniverse('alice', {
    resolvePortfolioTickerUniverse: () => new Set(['AAPL']),
    resolveWatchlistTickerUniverse: () => ['tsla', '', '$$$', 'AAPL', 'msft']
  });

  assert.deepEqual(Array.from(healthy.portfolioTickers), ['AAPL']);
  assert.deepEqual(Array.from(healthy.watchlistTickers).sort(), ['MSFT', 'TSLA']);
  assert.equal(healthy.diagnostics.watchlistSkippedInvalid, 2);

  const degraded = getUserTickerUniverse('alice', {
    resolvePortfolioTickerUniverse: () => new Set(['AAPL']),
    resolveWatchlistTickerUniverse: () => {
      throw new Error('watchlist store unavailable');
    }
  });

  assert.equal(degraded.portfolioTickers.has('AAPL'), true);
  assert.equal(degraded.watchlistTickers.size, 0);
  assert.equal(degraded.diagnostics.watchlistResolved, false);
});

test('portfolio relevance dominates watchlist and global classes', () => {
  const universe = getUserTickerUniverse('alice', {
    resolvePortfolioTickerUniverse: () => new Set(['AAPL']),
    resolveWatchlistTickerUniverse: () => ['TSLA']
  });

  const portfolio = getUserEventRelevance({ canonicalTicker: 'AAPL', metadataJson: {} }, { userId: 'alice', userTickerUniverse: universe, rankingMode: 'balanced' });
  const watchlist = getUserEventRelevance({ canonicalTicker: 'TSLA', metadataJson: {} }, { userId: 'alice', userTickerUniverse: universe, rankingMode: 'balanced' });
  const global = getUserEventRelevance({ importance: 99, metadataJson: {}, eventType: 'world_news' }, { userId: 'alice', userTickerUniverse: universe, sourceProfile: { trustTier: 'high' }, rankingMode: 'balanced' });

  assert.equal(portfolio.relevanceTier, 'portfolio');
  assert.equal(watchlist.relevanceTier, 'watchlist');
  assert.equal(global.relevanceTier, 'global_high_signal');
  assert.ok(portfolio.relevanceScore > watchlist.relevanceScore);
  assert.ok(watchlist.relevanceScore > global.relevanceScore);
});

test('relevance diagnostics include aggregate tier distribution', () => {
  const universe = getUserTickerUniverse('alice', {
    resolvePortfolioTickerUniverse: () => new Set(['AAPL']),
    resolveWatchlistTickerUniverse: () => ['TSLA']
  });
  const diagnostics = buildUserRelevanceDiagnostics([
    { canonicalTicker: 'AAPL', metadataJson: {} },
    { canonicalTicker: 'TSLA', metadataJson: {} },
    { importance: 99, metadataJson: {} },
    { canonicalTicker: 'NFLX', metadataJson: {} }
  ], {
    userId: 'alice',
    userTickerUniverse: universe,
    sourceProfile: { trustTier: 'high' }
  });

  assert.equal(diagnostics.distribution.portfolio, 1);
  assert.equal(diagnostics.distribution.watchlist, 1);
  assert.equal(diagnostics.distribution.global_high_signal, 1);
  assert.equal(diagnostics.distribution.neutral, 1);
});
