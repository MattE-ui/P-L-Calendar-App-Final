const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEventDedupeKey } = require('../services/news/newsEventService');
const { resolveOwnedTickerUniverse, isEventRelevantToUser } = require('../services/news/ownedTickerUniverseService');
const { normalizeFmpEarningsRow, fetchFmpEarningsEvents } = require('../providers/earnings/fmpEarningsProvider');
const { runEarningsIngestion } = require('../services/news/earningsIngestionService');

function createLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

test('earnings dedupe key is stable across title/source formatting changes', () => {
  const base = {
    sourceType: 'earnings',
    eventType: 'earnings',
    ticker: 'AAPL',
    canonicalTicker: 'AAPL',
    scheduledAt: '2026-07-28T21:00:00.000Z',
    title: 'AAPL Earnings Call',
    sourceUrl: 'https://a.example.com'
  };
  const changed = {
    ...base,
    title: 'Apple Inc. Q3 Earnings',
    sourceUrl: 'https://b.example.com'
  };
  assert.equal(buildEventDedupeKey(base), buildEventDedupeKey(changed));
});

test('owned ticker universe resolves only active/open holdings', () => {
  const db = {
    users: { alice: {}, bob: {} },
    trades: [
      { username: 'alice', status: 'open', canonicalTicker: 'AAPL' },
      { username: 'alice', status: 'closed', canonicalTicker: 'MSFT' },
      { username: 'bob', status: 'open', ticker: 'NVDA' }
    ]
  };

  const resolved = resolveOwnedTickerUniverse({ db, logger: createLogger() });
  assert.deepEqual(resolved.aggregateTickers, ['AAPL', 'NVDA']);
  assert.deepEqual(resolved.tickerOwnerMap.AAPL, ['alice']);
  assert.deepEqual(resolved.tickerOwnerMap.NVDA, ['bob']);
});

test('owned ticker universe includes missing-status active trades and normalizes raw broker tickers', () => {
  const db = {
    users: {
      alice: {
        ibkr: {
          live: {
            positions: [
              { symbol: ' msft_us_eq ', quantity: 2 },
              { symbol: 'ignore', quantity: 0 }
            ]
          }
        }
      }
    },
    trades: [
      { username: 'alice', canonicalTicker: ' aapl ' },
      { username: 'alice', ticker: ' nvda_us_eq ' },
      { username: 'alice', status: 'closed', ticker: 'TSLA' },
      { username: 'alice', ticker: '   ', closedAt: '2026-04-12T00:00:00.000Z' }
    ]
  };

  const resolved = resolveOwnedTickerUniverse({ db, logger: createLogger() });
  assert.deepEqual(resolved.aggregateTickers, ['AAPL', 'MSFT', 'NVDA']);
  assert.deepEqual(resolved.tickerOwnerMap.AAPL, ['alice']);
  assert.deepEqual(resolved.tickerOwnerMap.NVDA, ['alice']);
  assert.deepEqual(resolved.tickerOwnerMap.MSFT, ['alice']);
});

test('FMP row normalization returns earnings-shaped event', () => {
  const row = normalizeFmpEarningsRow({
    symbol: 'aapl',
    date: '2026-07-28',
    time: 'amc',
    eps: 1.22,
    revenue: 1000
  }, { tickerUniverse: new Set(['AAPL']) });

  assert.equal(row.sourceType, 'earnings');
  assert.equal(row.eventType, 'earnings');
  assert.equal(row.canonicalTicker, 'AAPL');
  assert.match(row.scheduledAt, /^2026-07-28T21:00:00\.000Z$/);
  assert.match(row.sourceExternalId, /^fmp:earnings:AAPL:/);
});

test('earnings ingestion tolerates provider failure', async () => {
  const diagnostics = await runEarningsIngestion({
    loadDB: () => ({ users: { alice: {} }, trades: [{ username: 'alice', status: 'open', canonicalTicker: 'AAPL' }] }),
    newsEventService: {
      listUpcomingEvents: () => [],
      upsertManyEvents: () => []
    },
    logger: createLogger(),
    provider: async () => { throw new Error('provider down'); },
    trigger: 'test'
  });

  assert.equal(diagnostics.success, false);
  assert.equal(diagnostics.providerStatus.fetchFailed, true);
  assert.match(diagnostics.safeErrors[0], /provider:/);
});

test('portfolio relevance uses per-user earnings mapping', async () => {
  const loadDB = () => ({
    users: { alice: {}, bob: {} },
    trades: [{ username: 'alice', status: 'open', canonicalTicker: 'AAPL' }]
  });
  const captured = [];

  await runEarningsIngestion({
    loadDB,
    newsEventService: {
      listUpcomingEvents: () => [],
      upsertManyEvents: (rows) => {
        captured.push(...rows);
        return rows.map((row, index) => ({ ...row, id: `id-${index}`, dedupeKey: `key-${index}` }));
      }
    },
    logger: createLogger(),
    provider: async () => ([{
      sourceType: 'earnings',
      eventType: 'earnings',
      ticker: 'AAPL',
      canonicalTicker: 'AAPL',
      title: 'AAPL earnings',
      scheduledAt: '2026-07-28T21:00:00.000Z',
      sourceName: 'Provider',
      sourceUrl: 'https://example.test',
      sourceExternalId: 'x'
    }]),
    trigger: 'test'
  });

  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].metadataJson.relevanceUserIds, ['alice']);
  assert.equal(isEventRelevantToUser(captured[0], 'alice'), true);
  assert.equal(isEventRelevantToUser(captured[0], 'bob'), false);
});

test('fetchFmpEarningsEvents filters rows to ticker universe', async () => {
  const rows = await fetchFmpEarningsEvents({
    tickers: ['AAPL'],
    from: '2026-07-01',
    to: '2026-08-01',
    logger: createLogger(),
    fetcher: async () => ({
      ok: true,
      json: async () => ([
        { symbol: 'AAPL', date: '2026-07-28', time: 'amc' },
        { symbol: 'MSFT', date: '2026-07-29', time: 'amc' }
      ])
    })
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].canonicalTicker, 'AAPL');
});
