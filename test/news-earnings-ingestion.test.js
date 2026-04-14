const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEventDedupeKey } = require('../services/news/newsEventService');
const { resolveOwnedTickerUniverse, isEventRelevantToUser } = require('../services/news/ownedTickerUniverseService');
const {
  parseAlphaVantageCsv,
  normalizeAlphaVantageEarningsRow,
  fetchAlphaVantageEarningsEvents
} = require('../providers/earnings/alphaVantageEarningsProvider');
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

test('Alpha Vantage row normalization returns earnings-shaped event', () => {
  const row = normalizeAlphaVantageEarningsRow({
    symbol: 'aapl',
    reportDate: '2026-07-28',
    fiscalDateEnding: '2026-06-30',
    estimate: '1.22',
    currency: 'USD'
  }, { tickerUniverse: new Set(['AAPL']) });

  assert.equal(row.sourceType, 'earnings');
  assert.equal(row.eventType, 'earnings');
  assert.equal(row.canonicalTicker, 'AAPL');
  assert.match(row.scheduledAt, /^2026-07-28T16:00:00\.000Z$/);
  assert.match(row.sourceExternalId, /^alpha-vantage:earnings:AAPL:/);
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

test('fetchAlphaVantageEarningsEvents filters rows to ticker universe', async () => {
  const result = await fetchAlphaVantageEarningsEvents({
    tickers: ['AAPL'],
    horizon: '3month',
    logger: createLogger(),
    apiKey: 'test-key',
    fetcher: async (url) => ({
      ok: true,
      status: 200,
      text: async () => {
        if (String(url).includes('symbol=AAPL')) return 'symbol,name,reportDate,fiscalDateEnding,estimate,currency\nAAPL,Apple Inc,2026-07-28,2026-06-30,1.22,USD';
        return 'symbol,name,reportDate,fiscalDateEnding,estimate,currency\nMSFT,Microsoft Corp,2026-07-29,2026-06-30,2.10,USD';
      }
    })
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].canonicalTicker, 'AAPL');
  assert.equal(result.diagnostics.parsedRows, 1);
});


test('parseAlphaVantageCsv handles quoted fields and embedded commas', () => {
  const rows = parseAlphaVantageCsv('symbol,name,reportDate,fiscalDateEnding,estimate,currency\nAAPL,"Apple, Inc.",2026-07-28,2026-06-30,1.22,USD');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Apple, Inc.');
});

test('fetchAlphaVantageEarningsEvents fails clearly when API key is missing', async () => {
  await assert.rejects(() => fetchAlphaVantageEarningsEvents({
    tickers: ['AAPL'],
    logger: createLogger(),
    apiKey: ''
  }), /Missing ALPHA_VANTAGE_API_KEY/);
});

test('fetchAlphaVantageEarningsEvents returns provider diagnostics on unauthorized response', async () => {
  await assert.rejects(async () => {
    await fetchAlphaVantageEarningsEvents({
      tickers: ['AAPL'],
      apiKey: 'test-key',
      logger: createLogger(),
      fetcher: async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' })
    });
  }, (error) => {
    assert.equal(error.diagnostics.responseStatus, 401);
    assert.match(error.diagnostics.failureSnippet, /Unauthorized/);
    return true;
  });
});

test('fetchAlphaVantageEarningsEvents detects provider throttle hints', async () => {
  await assert.rejects(async () => {
    await fetchAlphaVantageEarningsEvents({
      tickers: ['AAPL'],
      apiKey: 'test-key',
      logger: createLogger(),
      fetcher: async () => ({ ok: true, status: 200, text: async () => 'Note: Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute.' })
    });
  }, (error) => {
    assert.equal(error.diagnostics.throttleHint, 'provider_rate_limit_message');
    return true;
  });
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
        title: 'AAPL earnings',
        scheduledAt: '2026-07-28T16:00:00.000Z',
        sourceName: 'Alpha Vantage',
        sourceUrl: 'https://example.test',
        sourceExternalId: 'x'
      }],
      diagnostics: { apiKeyPresent: true, horizon: '3month', rowsReturned: 1, parsedRows: 1, skippedRows: 0 }
    }),
    trigger: 'test'
  });

  assert.equal(diagnostics.success, true);
  assert.equal(diagnostics.providerStatus.providerDiagnostics.apiKeyPresent, true);
  assert.equal(diagnostics.providerStatus.providerDiagnostics.horizon, '3month');
});
