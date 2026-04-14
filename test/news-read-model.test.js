const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_FILE = path.join(__dirname, 'data-news-read-model-test.json');
process.env.SKIP_RATE_FETCH = 'true';

const { buildNewsEventCardModel, getForYouNewsModel, getCalendarNewsModel, getLatestNewsModel } = require('../services/news/newsReadModelService');
const { app, saveDB } = require('../server');

const DATA_FILE = process.env.DATA_FILE;

function isoFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

test.after(() => {
  fs.rmSync(DATA_FILE, { force: true });
});

test('For You prioritizes portfolio upcoming earnings then high-importance macro', () => {
  const events = [
    { id: 'm1', sourceType: 'macro', eventType: 'cpi', title: 'CPI', summary: '', importance: 90, scheduledAt: isoFromNow(2), metadataJson: {}, status: 'active' },
    { id: 'e1', sourceType: 'earnings', eventType: 'earnings', title: 'AAPL earnings', summary: '', canonicalTicker: 'AAPL', importance: 50, scheduledAt: isoFromNow(1), metadataJson: { relevanceUserIds: ['alice'] }, status: 'active' },
    { id: 'o1', sourceType: 'earnings', eventType: 'earnings', title: 'MSFT earnings', summary: '', canonicalTicker: 'MSFT', importance: 50, scheduledAt: isoFromNow(3), metadataJson: {}, status: 'active' }
  ];

  const model = getForYouNewsModel({
    newsEventService: { listUpcomingEvents: () => events },
    resolveUserTickerUniverse: () => new Set(['AAPL']),
    logger: { info: () => {} }
  }, { userId: 'alice', limit: 10, cursor: null, filters: {} });

  assert.equal(model.data[0].id, 'e1');
  assert.equal(model.data[1].id, 'm1');
  assert.equal(model.sectionCounts.portfolioUpcomingEarnings, 1);
  assert.equal(model.sectionCounts.macroUpcoming, 1);
});

test('Calendar groups and sorts events chronologically', () => {
  const events = [
    { id: 'later', sourceType: 'macro', eventType: 'fomc', title: 'later', summary: '', importance: 60, scheduledAt: isoFromNow(12), metadataJson: {}, status: 'active' },
    { id: 'today', sourceType: 'macro', eventType: 'cpi', title: 'today', summary: '', importance: 60, scheduledAt: isoFromNow(0.1), metadataJson: {}, status: 'active' },
    { id: 'next', sourceType: 'earnings', eventType: 'earnings', title: 'next', summary: '', canonicalTicker: 'AAPL', importance: 60, scheduledAt: isoFromNow(4), metadataJson: {}, status: 'active' }
  ];
  const model = getCalendarNewsModel({
    newsEventService: { listUpcomingEvents: () => events },
    resolveUserTickerUniverse: () => new Set(['AAPL']),
    logger: { info: () => {} }
  }, { userId: 'alice', limit: 10, cursor: null, filters: {} });

  assert.deepEqual(model.data.map((item) => item.id), ['today', 'next', 'later']);
  assert.equal(model.sectionCounts.today, 1);
  assert.equal(model.sectionCounts.next7Days, 1);
  assert.equal(model.sectionCounts.later, 1);
});

test('Card model derives badge, relevance, urgency and stable sort key', () => {
  const now = new Date().toISOString();
  const card = buildNewsEventCardModel({
    id: 'id-1',
    sourceType: 'earnings',
    eventType: 'earnings',
    title: 'AAPL earnings',
    summary: '',
    canonicalTicker: 'AAPL',
    importance: 90,
    scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    metadataJson: { relevanceUserIds: ['alice'] },
    status: 'active'
  }, { userId: 'alice', userTickers: new Set(['AAPL']), now });

  assert.equal(card.relevanceClass, 'portfolio');
  assert.equal(card.badgeLabel, 'Portfolio Earnings');
  assert.ok(['today', 'soon'].includes(card.urgencyClass));
  assert.match(card.stableSortKey, /id-1$/);
});

test('Deterministic tie-breaking uses id when timestamps tie', () => {
  const ts = '2099-01-01T00:00:00.000Z';
  const events = [
    { id: 'b', sourceType: 'macro', eventType: 'cpi', title: 'B', summary: '', importance: 80, scheduledAt: ts, metadataJson: {}, status: 'active' },
    { id: 'a', sourceType: 'macro', eventType: 'cpi', title: 'A', summary: '', importance: 80, scheduledAt: ts, metadataJson: {}, status: 'active' }
  ];
  const model = getCalendarNewsModel({
    newsEventService: { listUpcomingEvents: () => events },
    resolveUserTickerUniverse: () => new Set(),
    logger: { info: () => {} }
  }, { userId: 'alice', limit: 10, cursor: null, filters: {} });

  assert.deepEqual(model.data.map((item) => item.id), ['a', 'b']);
});

test('Latest model is minimal/empty before headline ingestion exists', () => {
  const model = getLatestNewsModel({
    newsEventService: { listPublishedNews: () => [] },
    resolveUserTickerUniverse: () => new Set(),
    logger: { info: () => {} }
  }, { userId: 'alice', limit: 10, cursor: null, filters: {} });

  assert.equal(model.sectionCounts.headlines, 0);
  assert.equal(model.emptyState.isHeadlineIngestionActive, false);
  assert.ok(model.emptyState.message);
});

test('Latest model returns ingested headline items in deterministic order', () => {
  const events = [
    { id: 'b', sourceType: 'news', eventType: 'stock_news', title: 'B', summary: '', importance: 85, canonicalTicker: 'AAPL', publishedAt: '2026-04-14T11:00:00.000Z', metadataJson: { relevanceUserIds: ['alice'] }, status: 'active' },
    { id: 'a', sourceType: 'news', eventType: 'world_news', title: 'A', summary: '', importance: 90, publishedAt: '2026-04-14T11:00:00.000Z', metadataJson: {}, status: 'active' }
  ];

  const model = getLatestNewsModel({
    newsEventService: { listPublishedNews: () => events },
    resolveUserTickerUniverse: () => new Set(['AAPL']),
    listNewsSourceProfiles: () => [],
    logger: { info: () => {} }
  }, { userId: 'alice', limit: 10, cursor: null, filters: {} });

  assert.equal(model.emptyState.isHeadlineIngestionActive, true);
  assert.deepEqual(model.data.map((item) => item.id), ['b', 'a']);
});

test('Latest model suppresses low-score and duplicate headlines after ranking', () => {
  const events = [
    { id: 'keep', sourceType: 'news', eventType: 'stock_news', title: 'Apple launches AI update', summary: '', importance: 90, sourceName: 'TrustedWire', canonicalTicker: 'AAPL', publishedAt: '2026-04-14T11:00:00.000Z', metadataJson: { relevanceUserIds: ['alice'] }, status: 'active' },
    { id: 'dupe', sourceType: 'news', eventType: 'stock_news', title: 'Apple launches AI update', summary: '', importance: 80, sourceName: 'TrustedWire', canonicalTicker: 'AAPL', publishedAt: '2026-04-14T11:30:00.000Z', metadataJson: { relevanceUserIds: ['alice'] }, status: 'active' },
    { id: 'muted', sourceType: 'news', eventType: 'world_news', title: 'General market color', summary: '', importance: 20, sourceName: 'NoisyWire', publishedAt: '2026-04-14T11:10:00.000Z', metadataJson: {}, status: 'active' }
  ];

  const model = getLatestNewsModel({
    newsEventService: { listPublishedNews: () => events },
    resolveUserTickerUniverse: () => new Set(['AAPL']),
    listNewsSourceProfiles: () => [
      { sourceName: 'TrustedWire', trustTier: 'high', priorityBoost: 5, isAllowed: true, isMuted: false },
      { sourceName: 'NoisyWire', trustTier: 'low', priorityBoost: -10, isAllowed: true, isMuted: true }
    ],
    logger: { info: () => {} }
  }, { userId: 'alice', limit: 10, cursor: null, filters: {} });

  assert.deepEqual(model.data.map((item) => item.id), ['keep']);
  assert.equal(model.diagnostics.ranking.duplicateCollapsedCount, 1);
});

test('For You mode profiles keep bounded headlines with portfolio-first behavior', () => {
  const published = [
    { id: 'portfolio-1', sourceType: 'news', eventType: 'stock_news', title: 'AAPL launch', summary: '', importance: 86, sourceName: 'TrustedWire', canonicalTicker: 'AAPL', publishedAt: '2026-04-14T12:00:00.000Z', metadataJson: {}, status: 'active' },
    { id: 'watch-1', sourceType: 'news', eventType: 'stock_news', title: 'TSLA launch', summary: '', importance: 86, sourceName: 'TrustedWire', canonicalTicker: 'TSLA', publishedAt: '2026-04-14T12:01:00.000Z', metadataJson: {}, status: 'active' },
    { id: 'global-1', sourceType: 'news', eventType: 'world_news', title: 'Global shock', summary: '', importance: 99, sourceName: 'TrustedWire', publishedAt: '2026-04-14T12:02:00.000Z', metadataJson: {}, status: 'active' }
  ];

  const strictModel = getForYouNewsModel({
    newsEventService: { listUpcomingEvents: () => [], listPublishedNews: () => published },
    resolveUserTickerUniverse: () => new Set(['AAPL']),
    resolveUserWatchlistTickerUniverse: () => new Set(['TSLA']),
    getUserNewsPreferences: () => ({ rankingMode: 'strict_signal' }),
    listNewsSourceProfiles: () => [{ sourceName: 'TrustedWire', trustTier: 'high', priorityBoost: 10, isAllowed: true, isMuted: false }],
    logger: { info: () => {} }
  }, { userId: 'alice', limit: 10, cursor: null, filters: {} });

  const discoveryModel = getForYouNewsModel({
    newsEventService: { listUpcomingEvents: () => [], listPublishedNews: () => published },
    resolveUserTickerUniverse: () => new Set(['AAPL']),
    resolveUserWatchlistTickerUniverse: () => new Set(['TSLA']),
    getUserNewsPreferences: () => ({ rankingMode: 'discovery' }),
    listNewsSourceProfiles: () => [{ sourceName: 'TrustedWire', trustTier: 'high', priorityBoost: 10, isAllowed: true, isMuted: false }],
    logger: { info: () => {} }
  }, { userId: 'alice', limit: 10, cursor: null, filters: {} });

  const strictIds = (strictModel.sections.find((section) => section.summary.key === 'recentRelevantHeadlines')?.items || []).map((item) => item.id);
  const discoveryIds = (discoveryModel.sections.find((section) => section.summary.key === 'recentRelevantHeadlines')?.items || []).map((item) => item.id);
  assert.ok(strictIds.includes('portfolio-1'));
  assert.ok(!strictIds.includes('global-1'));
  assert.ok(discoveryIds.includes('watch-1'));
});

test('Latest ordering stays deterministic with watchlist-aware relevance', () => {
  const events = [
    { id: 'z-watch', sourceType: 'news', eventType: 'stock_news', title: 'TSLA event', summary: '', importance: 85, sourceName: 'TrustedWire', canonicalTicker: 'TSLA', publishedAt: '2026-04-14T11:00:00.000Z', metadataJson: {}, status: 'active' },
    { id: 'a-portfolio', sourceType: 'news', eventType: 'stock_news', title: 'AAPL event', summary: '', importance: 85, sourceName: 'TrustedWire', canonicalTicker: 'AAPL', publishedAt: '2026-04-14T11:00:00.000Z', metadataJson: {}, status: 'active' }
  ];
  const model = getLatestNewsModel({
    newsEventService: { listPublishedNews: () => events },
    resolveUserTickerUniverse: () => new Set(['AAPL']),
    resolveUserWatchlistTickerUniverse: () => new Set(['TSLA']),
    getUserNewsPreferences: () => ({ rankingMode: 'balanced' }),
    listNewsSourceProfiles: () => [{ sourceName: 'TrustedWire', trustTier: 'high', priorityBoost: 0, isAllowed: true, isMuted: false }],
    logger: { info: () => {} }
  }, { userId: 'alice', limit: 10, cursor: null, filters: {} });

  assert.deepEqual(model.data.map((item) => item.id), ['a-portfolio', 'z-watch']);
});

test('watchlist lookup fallback does not break latest ranking', () => {
  const events = [
    { id: 'portfolio', sourceType: 'news', eventType: 'stock_news', title: 'AAPL', summary: '', importance: 80, canonicalTicker: 'AAPL', publishedAt: '2026-04-14T11:00:00.000Z', metadataJson: {}, status: 'active' }
  ];
  const model = getLatestNewsModel({
    newsEventService: { listPublishedNews: () => events },
    resolveUserTickerUniverse: () => new Set(['AAPL']),
    resolveUserWatchlistTickerUniverse: () => {
      throw new Error('store unavailable');
    },
    getUserNewsPreferences: () => ({ rankingMode: 'balanced' }),
    listNewsSourceProfiles: () => [],
    logger: { info: () => {} }
  }, { userId: 'alice', limit: 10, cursor: null, filters: {} });
  assert.equal(model.data[0].id, 'portfolio');
});

test('For You headline section is bounded and includes only high-signal headlines', () => {
  const published = [
    { id: 'r1', sourceType: 'news', eventType: 'stock_news', title: 'AAPL raises guidance', summary: '', importance: 92, sourceName: 'TrustedWire', canonicalTicker: 'AAPL', publishedAt: '2026-04-14T12:00:00.000Z', metadataJson: { relevanceUserIds: ['alice'] }, status: 'active' },
    { id: 'r2', sourceType: 'news', eventType: 'stock_news', title: 'AAPL raises guidance', summary: '', importance: 91, sourceName: 'TrustedWire', canonicalTicker: 'AAPL', publishedAt: '2026-04-14T12:10:00.000Z', metadataJson: { relevanceUserIds: ['alice'] }, status: 'active' },
    { id: 'g1', sourceType: 'news', eventType: 'world_news', title: 'Fed signals global liquidity shift', summary: '', importance: 98, sourceName: 'TrustedWire', publishedAt: '2026-04-14T12:05:00.000Z', metadataJson: {}, status: 'active' },
    { id: 'l1', sourceType: 'news', eventType: 'world_news', title: 'Minor market chatter', summary: '', importance: 20, sourceName: 'NoisyWire', publishedAt: '2026-04-14T12:06:00.000Z', metadataJson: {}, status: 'active' }
  ];

  const model = getForYouNewsModel({
    newsEventService: { listUpcomingEvents: () => [], listPublishedNews: () => published },
    resolveUserTickerUniverse: () => new Set(['AAPL']),
    listNewsSourceProfiles: () => [
      { sourceName: 'TrustedWire', trustTier: 'high', priorityBoost: 10, isAllowed: true, isMuted: false },
      { sourceName: 'NoisyWire', trustTier: 'low', priorityBoost: -10, isAllowed: true, isMuted: false }
    ],
    logger: { info: () => {} }
  }, { userId: 'alice', limit: 10, cursor: null, filters: {} });

  const headlineSection = model.sections.find((section) => section.summary.key === 'recentRelevantHeadlines');
  assert.ok(headlineSection);
  assert.ok(headlineSection.items.length <= 5);
  assert.deepEqual(headlineSection.items.map((item) => item.id), ['r1']);
});

test('Read model filters support portfolioOnly and highImportanceOnly without re-sorting', () => {
  const events = [
    {
      id: 'portfolio-high',
      sourceType: 'earnings',
      eventType: 'earnings',
      title: 'AAPL earnings',
      summary: '',
      canonicalTicker: 'AAPL',
      importance: 90,
      scheduledAt: isoFromNow(1),
      metadataJson: { relevanceUserIds: ['alice'] },
      status: 'active'
    },
    {
      id: 'macro-low',
      sourceType: 'macro',
      eventType: 'cpi',
      title: 'CPI',
      summary: '',
      importance: 50,
      scheduledAt: isoFromNow(2),
      metadataJson: {},
      status: 'active'
    }
  ];

  const model = getForYouNewsModel({
    newsEventService: { listUpcomingEvents: () => events },
    resolveUserTickerUniverse: () => new Set(['AAPL']),
    logger: { info: () => {} }
  }, {
    userId: 'alice',
    limit: 10,
    cursor: null,
    filters: { portfolioOnly: true, highImportanceOnly: true }
  });

  assert.deepEqual(model.data.map((item) => item.id), ['portfolio-high']);
});

test('Authenticated /api/news/for-you shapes portfolio relevance', async () => {
  fs.rmSync(DATA_FILE, { force: true });
  saveDB({
    users: { alice: { username: 'alice', passwordHash: '', portfolio: 0, initialPortfolio: 0, initialNetDeposits: 0, profileComplete: true } },
    sessions: { token123: 'alice' },
    trades: [{ username: 'alice', status: 'open', canonicalTicker: 'AAPL' }],
    newsEvents: [
      {
        id: 'earn-aapl',
        sourceType: 'earnings',
        eventType: 'earnings',
        title: 'AAPL earnings',
        summary: '',
        canonicalTicker: 'AAPL',
        importance: 70,
        scheduledAt: isoFromNow(2),
        metadataJson: { relevanceUserIds: ['alice'] },
        status: 'active',
        isActive: true
      }
    ]
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/news/for-you`, {
    headers: { cookie: 'auth_token=token123' }
  });
  const payload = await response.json();
  server.close();

  assert.equal(response.status, 200);
  assert.equal(payload.data[0].id, 'earn-aapl');
  assert.equal(payload.data[0].isPortfolioRelevant, true);
});
