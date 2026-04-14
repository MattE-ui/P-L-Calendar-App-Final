const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreNewsEvent, rankNewsEvents } = require('../services/news/newsRankingService');
const { getUserTickerUniverse } = require('../services/news/newsUserRelevanceService');

function headline(overrides = {}) {
  return {
    id: 'h-1',
    eventType: 'stock_news',
    sourceType: 'news',
    title: 'Apple beats expectations',
    sourceName: 'TrustedWire',
    canonicalTicker: 'AAPL',
    importance: 80,
    publishedAt: '2026-04-14T10:00:00.000Z',
    metadataJson: {},
    ...overrides
  };
}

test('portfolio relevance dominates ranking score', () => {
  const context = {
    userId: 'alice',
    now: '2026-04-14T12:00:00.000Z',
    sourceProfiles: [{ sourceName: 'TrustedWire', trustTier: 'high', priorityBoost: 0, isAllowed: true, isMuted: false }],
    userTickerUniverse: getUserTickerUniverse('alice', {
      resolvePortfolioTickerUniverse: () => new Set(['AAPL']),
      resolveWatchlistTickerUniverse: () => []
    })
  };

  const relevant = scoreNewsEvent(headline({ canonicalTicker: 'AAPL' }), context);
  const irrelevant = scoreNewsEvent(headline({ canonicalTicker: 'TSLA' }), context);

  assert.ok(relevant.totalScore > irrelevant.totalScore);
  assert.equal(relevant.relevanceScore, 1);
  assert.equal(irrelevant.relevanceScore, 0);
});

test('watchlist relevance ranks below portfolio but above neutral', () => {
  const context = {
    userId: 'alice',
    now: '2026-04-14T12:00:00.000Z',
    sourceProfiles: [{ sourceName: 'TrustedWire', trustTier: 'high', priorityBoost: 0, isAllowed: true, isMuted: false }],
    userTickerUniverse: getUserTickerUniverse('alice', {
      resolvePortfolioTickerUniverse: () => new Set(['AAPL']),
      resolveWatchlistTickerUniverse: () => ['TSLA']
    }),
    rankingMode: 'balanced'
  };

  const portfolio = scoreNewsEvent(headline({ canonicalTicker: 'AAPL' }), context);
  const watchlist = scoreNewsEvent(headline({ canonicalTicker: 'TSLA' }), context);
  const neutral = scoreNewsEvent(headline({ canonicalTicker: 'NFLX' }), context);

  assert.ok(portfolio.totalScore > watchlist.totalScore);
  assert.ok(watchlist.totalScore > neutral.totalScore);
  assert.equal(watchlist.relevanceTier, 'watchlist');
});

test('strict_signal mode is tighter than discovery mode for neutral headline', () => {
  const event = headline({ canonicalTicker: 'NFLX', importance: 50 });
  const strict = scoreNewsEvent(event, { rankingMode: 'strict_signal', userTickerUniverse: getUserTickerUniverse('alice', {}) });
  const discovery = scoreNewsEvent(event, { rankingMode: 'discovery', userTickerUniverse: getUserTickerUniverse('alice', {}) });
  assert.ok(strict.totalScore <= discovery.totalScore);
});

test('source trust tier and priority boost impact ranking', () => {
  const now = '2026-04-14T12:00:00.000Z';
  const baseEvent = headline({ canonicalTicker: 'TSLA' });
  const ranked = rankNewsEvents([
    { ...baseEvent, id: 'low', sourceName: 'NoisyBlog' },
    { ...baseEvent, id: 'high', sourceName: 'TrustedWire' }
  ], {
    now,
    sourceProfiles: [
      { sourceName: 'NoisyBlog', trustTier: 'low', priorityBoost: -10, isAllowed: true, isMuted: false },
      { sourceName: 'TrustedWire', trustTier: 'high', priorityBoost: 10, isAllowed: true, isMuted: false }
    ]
  });

  assert.deepEqual(ranked.map((row) => row.event.id), ['high', 'low']);
});
