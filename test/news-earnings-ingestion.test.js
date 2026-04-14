const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEventDedupeKey } = require('../services/news/newsEventService');
const { resolveOwnedTickerUniverse, isEventRelevantToUser } = require('../services/news/ownedTickerUniverseService');
const {
  normalizeNasdaqEarningsRow,
  selectNextUpcomingEarningsPerTicker,
  extractEarningsDateFromApiPayload,
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

test('normalizeNasdaqEarningsRow returns earnings-shaped event with ISO date', () => {
  const row = normalizeNasdaqEarningsRow({
    ticker: 'aapl',
    earningsAnnouncementDate: 'Apr 29, 2026'
  }, { tickerUniverse: new Set(['AAPL']), nowMs: Date.parse('2026-04-01T00:00:00.000Z') });

  assert.equal(row.sourceType, 'earnings');
  assert.equal(row.eventType, 'earnings');
  assert.equal(row.source, 'nasdaq');
  assert.equal(row.canonicalTicker, 'AAPL');
  assert.equal(row.scheduledAt, '2026-04-29T16:00:00.000Z');
  assert.match(row.sourceExternalId, /^nasdaq:earnings:AAPL:2026-04-29$/);
});

test('extractEarningsDateFromApiPayload parses primary earningsDate path', () => {
  const payload = { data: { earnings: { earningsDate: 'Apr 29, 2026' } } };
  assert.equal(extractEarningsDateFromApiPayload(payload), '2026-04-29');
});

test('extractEarningsDateFromApiPayload supports fallback reportDate paths', () => {
  const payload = { data: { earnings: { calendar: [{ reportDate: '2026-05-03' }] } } };
  assert.equal(extractEarningsDateFromApiPayload(payload), '2026-05-03');
});

test('fetchNasdaqEarningsEvents fetches one next event per ticker via API', async () => {
  const requests = [];
  const result = await fetchNasdaqEarningsEvents({
    tickers: ['AAPL', 'MSFT'],
    logger: createLogger(),
    fetcher: async (url, options) => {
      requests.push({ url, options });
      if (String(url).includes('/aapl/earnings')) {
        return { ok: true, status: 200, json: async () => ({ data: { earnings: { earningsDate: 'Apr 29, 2026' } } }) };
      }
      if (String(url).includes('/msft/earnings')) {
        return { ok: true, status: 200, json: async () => ({ data: { earnings: { reportDate: 'May 01, 2026' } } }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }
  });

  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map((row) => row.canonicalTicker).sort(), ['AAPL', 'MSFT']);
  assert.equal(result.diagnostics.tickersProcessed, 2);
  assert.equal(result.diagnostics.successfulExtractions, 2);
  assert.equal(result.diagnostics.failedExtractions, 0);
  assert.equal(result.diagnostics.nextEarningsPerTickerCount, 2);
  assert.equal(result.diagnostics.extractedDatesSample.length, 2);
  assert.equal(requests[0].options.headers['User-Agent'], 'Mozilla/5.0');
  assert.equal(requests[0].options.headers.Accept, 'application/json');
});

test('fetchNasdaqEarningsEvents skips ticker when API request fails', async () => {
  const result = await fetchNasdaqEarningsEvents({
    tickers: ['AAPL', 'NVDA'],
    logger: createLogger(),
    fetcher: async (url) => {
      if (String(url).includes('/aapl/earnings')) {
        return { ok: true, status: 200, json: async () => ({ data: { earnings: { earningsDate: 'Apr 29, 2026' } } }) };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    }
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].canonicalTicker, 'AAPL');
  assert.equal(result.diagnostics.tickersProcessed, 2);
  assert.equal(result.diagnostics.successfulExtractions, 1);
  assert.equal(result.diagnostics.failedExtractions, 1);
  assert.equal(result.diagnostics.fetchFailures.length, 1);
});

test('fetchNasdaqEarningsEvents skips ticker when earnings date is not found', async () => {
  const result = await fetchNasdaqEarningsEvents({
    tickers: ['AAPL'],
    logger: createLogger(),
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({ data: { earnings: {} } }) })
  });

  assert.equal(result.rows.length, 0);
  assert.equal(result.diagnostics.successfulExtractions, 0);
  assert.equal(result.diagnostics.failedExtractions, 1);
  assert.equal(result.diagnostics.parseFailures[0].reason, 'earnings_date_not_found');
});

test('fetchNasdaqEarningsEvents returns no rows for past parsed date', async () => {
  const result = await fetchNasdaqEarningsEvents({
    tickers: ['AAPL'],
    logger: createLogger(),
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({ data: { earnings: { earningsDate: 'Jan 2, 2020' } } }) })
  });

  assert.equal(result.rows.length, 0);
  assert.equal(result.diagnostics.failedExtractions, 1);
  assert.equal(result.diagnostics.parseFailures[0].reason, 'dropped_past_date');
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
      diagnostics: { tickersProcessed: 2, successfulExtractions: 1, failedExtractions: 1 }
    }),
    trigger: 'test'
  });

  assert.equal(diagnostics.success, true);
  assert.equal(diagnostics.providerStatus.providerDiagnostics.tickersProcessed, 2);
  assert.equal(diagnostics.providerStatus.providerDiagnostics.successfulExtractions, 1);
});
