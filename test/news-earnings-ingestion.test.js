const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEventDedupeKey } = require('../services/news/newsEventService');
const { resolveOwnedTickerUniverse, isEventRelevantToUser } = require('../services/news/ownedTickerUniverseService');
const {
  buildDateRange,
  buildDateRangePlan,
  normalizeNasdaqEarningsRow,
  fetchNasdaqEarningsEvents
} = require('../providers/earnings/nasdaqEarningsProvider');
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

test('owned ticker universe resolves trades persisted in per-user tradeJournal', () => {
  const db = {
    users: {
      alice: {
        tradeJournal: {
          '2026-04-10': [
            { id: 't1', status: 'open', symbol: 'aapl' },
            { id: 't2', status: 'closed', symbol: 'msft' }
          ]
        }
      },
      bob: {
        tradeJournal: {
          '2026-04-10': [{ id: 't3', symbol: 'nvda' }]
        }
      }
    }
  };

  const resolved = resolveOwnedTickerUniverse({ db, logger: createLogger() });
  assert.deepEqual(resolved.aggregateTickers, ['AAPL', 'NVDA']);
  assert.deepEqual(resolved.tickerOwnerMap.AAPL, ['alice']);
  assert.deepEqual(resolved.tickerOwnerMap.NVDA, ['bob']);
});

test('Nasdaq row normalization returns earnings-shaped event', () => {
  const row = normalizeNasdaqEarningsRow({
    symbol: 'aapl',
    companyName: 'Apple Inc.',
    reportDate: '2026-07-28',
    fiscalQuarterEnding: '2026-06-30',
    epsForecast: '1.22',
    time: 'After-Hours'
  }, { tickerUniverse: new Set(['AAPL']) });

  assert.equal(row.sourceType, 'earnings');
  assert.equal(row.eventType, 'earnings');
  assert.equal(row.canonicalTicker, 'AAPL');
  assert.equal(row.title, 'Earnings: AAPL');
  assert.match(row.scheduledAt, /^2026-07-28T21:00:00\.000Z$/);
  assert.match(row.sourceExternalId, /^nasdaq:earnings:AAPL:2026-07-28$/);
});

test('buildDateRange iterates today through configured horizon', () => {
  const dates = buildDateRange({ from: '2026-04-14', to: '2026-04-16' });
  assert.deepEqual(dates, ['2026-04-14', '2026-04-15', '2026-04-16']);
});

test('buildDateRange default horizon generates inclusive date count', () => {
  const plan = buildDateRangePlan({ daysAhead: 2 });
  assert.equal(plan.dates.length, 3);
  assert.equal(plan.dates[0], plan.fromDate);
  assert.equal(plan.dates[2], plan.toDate);
});

test('buildDateRangePlan returns empty list for invalid explicit range', () => {
  const plan = buildDateRangePlan({ from: '2026-07-30', to: '2026-07-28' });
  assert.equal(plan.strategy, 'explicit');
  assert.equal(plan.isValidRange, false);
  assert.deepEqual(plan.dates, []);
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
      sourceName: 'Nasdaq',
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

test('fetchNasdaqEarningsEvents filters rows to ticker universe', async () => {
  const result = await fetchNasdaqEarningsEvents({
    tickers: ['AAPL'],
    from: '2026-07-28',
    to: '2026-07-28',
    logger: createLogger(),
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          calendar: {
            rows: [
              { symbol: 'AAPL', companyName: 'Apple', reportDate: '2026-07-28', epsForecast: '1.22', time: 'pre-market' },
              { symbol: 'MSFT', companyName: 'Microsoft', reportDate: '2026-07-28', epsForecast: '2.10', time: 'after-hours' }
            ]
          }
        }
      })
    })
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].canonicalTicker, 'AAPL');
  assert.equal(result.diagnostics.totalRowsFetched, 2);
  assert.equal(result.diagnostics.rowsMatchedToPortfolio, 1);
});

test('fetchNasdaqEarningsEvents handles empty calendar rows', async () => {
  const result = await fetchNasdaqEarningsEvents({
    tickers: ['AAPL'],
    from: '2026-07-28',
    to: '2026-07-28',
    logger: createLogger(),
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({ data: { calendar: { rows: [] } } }) })
  });

  assert.equal(result.rows.length, 0);
  assert.equal(result.diagnostics.totalRowsFetched, 0);
  assert.equal(result.diagnostics.rowsMatchedToPortfolio, 0);
});

test('fetchNasdaqEarningsEvents supports alternate nested shape data.rows', async () => {
  const result = await fetchNasdaqEarningsEvents({
    tickers: ['AAPL'],
    from: '2026-07-28',
    to: '2026-07-28',
    logger: createLogger(),
    fetcher: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-type' ? 'application/json; charset=utf-8' : null) },
      text: async () => JSON.stringify({
        data: {
          rows: [{ symbol: 'AAPL', companyName: 'Apple', reportDate: '2026-07-28', time: 'after-hours' }]
        }
      })
    })
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.diagnostics.totalRowsFetched, 1);
});

test('fetchNasdaqEarningsEvents classifies HTML anti-bot responses', async () => {
  const result = await fetchNasdaqEarningsEvents({
    tickers: ['AAPL'],
    from: '2026-07-28',
    to: '2026-07-28',
    logger: createLogger(),
    fetcher: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-type' ? 'text/html' : null) },
      text: async () => '<html><body>Access denied. Please verify you are human.</body></html>'
    })
  });

  assert.equal(result.rows.length, 0);
  assert.equal(result.diagnostics.htmlResponses, 1);
  assert.equal(result.diagnostics.unexpectedResponseShapes[0].reason, 'anti_bot_html');
});

test('fetchNasdaqEarningsEvents treats empty valid JSON as parsed but empty', async () => {
  const result = await fetchNasdaqEarningsEvents({
    tickers: ['AAPL'],
    from: '2026-07-28',
    to: '2026-07-28',
    logger: createLogger(),
    fetcher: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-type' ? 'application/json' : null) },
      text: async () => JSON.stringify({ data: { calendar: { rows: [] } } })
    })
  });

  assert.equal(result.rows.length, 0);
  assert.equal(result.diagnostics.successfulJsonResponses, 1);
  assert.equal(result.diagnostics.totalRowsFetched, 0);
  assert.equal(result.diagnostics.unexpectedResponseShapes.length, 0);
});

test('fetchNasdaqEarningsEvents captures unexpected JSON shape diagnostics', async () => {
  const result = await fetchNasdaqEarningsEvents({
    tickers: ['AAPL'],
    from: '2026-07-28',
    to: '2026-07-28',
    logger: createLogger(),
    fetcher: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-type' ? 'application/json' : null) },
      text: async () => JSON.stringify({ payload: { records: [] } })
    })
  });

  assert.equal(result.rows.length, 0);
  assert.equal(result.diagnostics.successfulJsonResponses, 1);
  assert.equal(result.diagnostics.unexpectedResponseShapes.length, 1);
  assert.deepEqual(result.diagnostics.unexpectedResponseShapes[0].topLevelKeys, ['payload']);
  assert.equal(result.diagnostics.unexpectedResponseShapes[0].reason, 'rows_not_found_in_known_paths');
});

test('fetchNasdaqEarningsEvents diagnostics show planned fetches for default horizon', async () => {
  const loggerCalls = [];
  const result = await fetchNasdaqEarningsEvents({
    tickers: ['AAPL'],
    daysAhead: 1,
    logger: {
      info: (...args) => loggerCalls.push(args),
      warn: () => {},
      error: () => {}
    },
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({ data: { calendar: { rows: [] } } }) })
  });

  assert.equal(result.diagnostics.fetchAttemptsPlanned, 2);
  assert.equal(result.diagnostics.generatedDateCount, 2);
  assert.equal(result.diagnostics.fetchAttempts, 2);
  assert.equal(result.diagnostics.datesFetched, 2);
  assert.ok(loggerCalls.some((entry) => entry[0] === '[Earnings][Nasdaq] date plan computed.'));
});

test('fetchNasdaqEarningsEvents captures partial date failures', async () => {
  const result = await fetchNasdaqEarningsEvents({
    tickers: ['AAPL'],
    from: '2026-07-28',
    to: '2026-07-29',
    logger: createLogger(),
    fetcher: async (url) => {
      if (String(url).includes('date=2026-07-28')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { calendar: { rows: [{ symbol: 'AAPL', companyName: 'Apple', reportDate: '2026-07-28', time: 'after-hours' }] } } })
        };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    }
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.diagnostics.fetchFailures.length, 1);
  assert.equal(result.diagnostics.fetchFailures[0].date, '2026-07-29');
});

test('earnings ingestion captures provider diagnostics payload shape', async () => {
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
        sourceName: 'Nasdaq',
        sourceUrl: 'https://example.test',
        sourceExternalId: 'x'
      }],
      diagnostics: { datesFetched: 2, totalRowsFetched: 12, rowsMatchedToPortfolio: 1, rowsSkipped: 11 }
    }),
    trigger: 'test'
  });

  assert.equal(diagnostics.success, true);
  assert.equal(diagnostics.providerStatus.providerDiagnostics.datesFetched, 2);
  assert.equal(diagnostics.providerStatus.providerDiagnostics.totalRowsFetched, 12);
});
