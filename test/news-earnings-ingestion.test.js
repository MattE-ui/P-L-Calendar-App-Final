const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEventDedupeKey } = require('../services/news/newsEventService');
const { resolveOwnedTickerUniverse, isEventRelevantToUser } = require('../services/news/ownedTickerUniverseService');
const {
  computeDateRange,
  normalizeFinnhubEarningsRow,
  selectNextUpcomingEarningsPerTicker,
  fetchFinnhubEarningsEvents
} = require('../providers/earnings/finnhubEarningsProvider');
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

test('normalizeFinnhubEarningsRow returns earnings-shaped event with ISO date', () => {
  const row = normalizeFinnhubEarningsRow({
    symbol: 'aapl',
    date: '2026-04-29',
    hour: 'amc',
    epsEstimate: 1.8,
    revenueEstimate: 12300000000
  }, { tickerUniverse: new Set(['AAPL']), nowMs: Date.parse('2026-04-01T00:00:00.000Z') });

  assert.equal(row.sourceType, 'earnings');
  assert.equal(row.eventType, 'earnings');
  assert.equal(row.source, 'finnhub');
  assert.equal(row.canonicalTicker, 'AAPL');
  assert.equal(row.scheduledAt, '2026-04-29T21:00:00.000Z');
  assert.match(row.sourceExternalId, /^finnhub:earnings:AAPL:2026-04-29$/);
});

test('computeDateRange builds default 45-day request window', () => {
  const range = computeDateRange({ nowMs: Date.parse('2026-04-14T00:00:00.000Z') });
  assert.equal(range.fromDate, '2026-04-14');
  assert.equal(range.toDate, '2026-05-29');
});

test('fetchFinnhubEarningsEvents requests each tracked symbol and filters mismatched rows', async () => {
  const requests = [];
  const result = await fetchFinnhubEarningsEvents({
    tickers: ['AAPL', 'MSFT'],
    apiKey: 'test-token',
    logger: createLogger(),
    fetcher: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes('symbol=AAPL')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            earningsCalendar: [
              { symbol: 'AAPL', date: '2026-04-29', hour: 'amc', quarter: 1, year: 2026, epsEstimate: 1.2 },
              { symbol: 'TSLA', date: '2026-04-30', hour: 'amc', quarter: 1, year: 2026, epsEstimate: 0.8 }
            ]
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          earningsCalendar: [
            { symbol: 'MSFT', date: '2026-05-03', hour: 'bmo', quarter: 1, year: 2026, epsEstimate: 2.3 }
          ]
        })
      };
    }
  });

  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map((row) => row.canonicalTicker).sort(), ['AAPL', 'MSFT']);
  assert.equal(result.diagnostics.totalRowsFetched, 3);
  assert.equal(result.diagnostics.rowsMatchedToPortfolio, 2);
  assert.equal(result.diagnostics.nextEarningsPerTickerCount, 2);
  assert.equal(result.diagnostics.uniquePortfolioTickersMatched, 2);
  assert.equal(result.diagnostics.requestMode, 'tracked_symbol');
  assert.equal(result.diagnostics.perSymbolRequests.length, 2);
  assert.ok(result.diagnostics.excludedRows.some((row) => row.reason === 'dropped_symbol_mismatch'));
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /from=\d{4}-\d{2}-\d{2}/);
  assert.match(requests[0].url, /to=\d{4}-\d{2}-\d{2}/);
  assert.match(requests[0].url, /symbol=(AAPL|MSFT)/);
  assert.match(requests[0].url, /token=test-token/);
});

test('fetchFinnhubEarningsEvents keeps only one next event per ticker', async () => {
  const result = await fetchFinnhubEarningsEvents({
    tickers: ['AAPL'],
    apiKey: 'test-token',
    logger: createLogger(),
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        earningsCalendar: [
          { symbol: 'AAPL', date: '2026-05-10', hour: 'amc' },
          { symbol: 'AAPL', date: '2026-05-02', hour: 'bmo' }
        ]
      })
    })
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].scheduledAt, '2026-05-02T13:00:00.000Z');
});

test('fetchFinnhubEarningsEvents fails clearly when FINNHUB_API_KEY missing', async () => {
  await assert.rejects(
    () => fetchFinnhubEarningsEvents({
      tickers: ['AAPL'],
      apiKey: '',
      logger: createLogger(),
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({ earningsCalendar: [] }) })
    }),
    (error) => {
      assert.match(error.message, /FINNHUB_API_KEY/);
      assert.equal(error.diagnostics.apiKeyPresent, false);
      assert.equal(error.diagnostics.failureReason, 'missing_finnhub_api_key');
      return true;
    }
  );
});

test('fetchFinnhubEarningsEvents captures per-symbol non-OK diagnostics without throwing', async () => {
  const result = await fetchFinnhubEarningsEvents({
    tickers: ['AAPL'],
    apiKey: 'test-token',
    logger: createLogger(),
    fetcher: async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate limit exceeded' })
    })
  });

  assert.equal(result.rows.length, 0);
  assert.equal(result.diagnostics.symbolErrors.length, 1);
  assert.equal(result.diagnostics.symbolErrors[0].error, 'http_429');
  assert.match(result.diagnostics.perSymbolRequests[0].failureBodySnippet, /rate limit/);
});

test('fetchFinnhubEarningsEvents tolerates one symbol failing and keeps others', async () => {
  const result = await fetchFinnhubEarningsEvents({
    tickers: ['AAPL', 'MSFT'],
    apiKey: 'test-token',
    logger: createLogger(),
    fetcher: async (url) => {
      if (String(url).includes('symbol=AAPL')) throw new Error('network down');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          earningsCalendar: [
            { symbol: 'MSFT', date: '2026-05-03', hour: 'bmo', quarter: 1, year: 2026, epsEstimate: 2.3 }
          ]
        })
      };
    }
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].canonicalTicker, 'MSFT');
  assert.equal(result.diagnostics.symbolErrors.length, 1);
  assert.equal(result.diagnostics.symbolErrors[0].symbol, 'AAPL');
});

test('selectNextUpcomingEarningsPerTicker keeps earliest future row per ticker', () => {
  const result = selectNextUpcomingEarningsPerTicker([
    { canonicalTicker: 'AAPL', scheduledAt: '2026-07-30T16:00:00.000Z' },
    { canonicalTicker: 'AAPL', scheduledAt: '2026-07-29T16:00:00.000Z' },
    { canonicalTicker: 'MSFT', scheduledAt: '2026-07-31T16:00:00.000Z' }
  ], Date.parse('2026-07-28T00:00:00.000Z'));

  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.find((row) => row.canonicalTicker === 'AAPL').scheduledAt, '2026-07-29T16:00:00.000Z');
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
      title: 'Earnings: AAPL',
      scheduledAt: '2026-07-28T21:00:00.000Z',
      sourceName: 'Finnhub',
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

test('earnings ingestion captures provider diagnostics payload shape and rowsInserted', async () => {
  const diagnostics = await runEarningsIngestion({
    loadDB: () => ({ users: { alice: {} }, trades: [{ username: 'alice', status: 'open', canonicalTicker: 'AAPL' }] }),
    newsEventService: {
      listUpcomingEvents: () => [],
      upsertManyEvents: (rows) => rows.map((row, index) => ({ ...row, dedupeKey: `k-${index}` }))
    },
    logger: createLogger(),
    provider: async () => ({
      rows: [{
        sourceType: 'earnings',
        eventType: 'earnings',
        ticker: 'AAPL',
        canonicalTicker: 'AAPL',
        title: 'Earnings: AAPL',
        scheduledAt: '2026-07-28T16:00:00.000Z',
        sourceName: 'Finnhub',
        sourceUrl: 'https://example.test',
        sourceExternalId: 'x'
      }],
      diagnostics: { totalRowsFetched: 4, rowsMatchedToPortfolio: 2, nextEarningsPerTickerCount: 1 }
    }),
    trigger: 'test'
  });

  assert.equal(diagnostics.success, true);
  assert.equal(diagnostics.providerStatus.providerDiagnostics.totalRowsFetched, 4);
  assert.equal(diagnostics.providerStatus.providerDiagnostics.rowsMatchedToPortfolio, 2);
  assert.equal(diagnostics.providerStatus.providerDiagnostics.rowsInserted, 1);
});
