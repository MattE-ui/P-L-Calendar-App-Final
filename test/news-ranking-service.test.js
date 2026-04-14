const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreNewsEvent, rankNewsEvents } = require('../services/news/newsRankingService');

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
    userTickers: new Set(['AAPL'])
  };

  const relevant = scoreNewsEvent(headline({ canonicalTicker: 'AAPL' }), context);
  const irrelevant = scoreNewsEvent(headline({ canonicalTicker: 'TSLA' }), context);

  assert.ok(relevant.totalScore > irrelevant.totalScore);
  assert.equal(relevant.relevanceScore, 1);
  assert.equal(irrelevant.relevanceScore, 0);
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
