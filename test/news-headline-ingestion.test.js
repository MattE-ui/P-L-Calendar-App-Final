const test = require('node:test');
const assert = require('node:assert/strict');

const { runHeadlineIngestion, shouldOpenCircuitForProvider } = require('../services/news/headlineIngestionService');
const { buildEventDedupeKey } = require('../services/news/newsEventService');

function createDb() {
  return {
    users: { alice: {}, bob: {} },
    trades: [
      { username: 'alice', status: 'open', canonicalTicker: 'AAPL' },
      { username: 'bob', status: 'open', canonicalTicker: 'MSFT' }
    ],
    newsEvents: [],
    newsIngestionStatus: {
      headlines: {
        lastAttemptedRunAt: null,
        lastSuccessfulRunAt: null,
        lastDiagnostics: null,
        lastProviderStatuses: [],
        providerStates: {}
      }
    }
  };
}

function ensureNewsEventTables(db) {
  db.newsEvents ||= [];
  db.newsIngestionStatus ||= {};
  db.newsIngestionStatus.headlines ||= {
    lastAttemptedRunAt: null,
    lastSuccessfulRunAt: null,
    lastDiagnostics: null,
    lastProviderStatuses: [],
    providerStates: {}
  };
  db.newsIngestionStatus.headlines.providerStates ||= {};
}

function createNewsEventService(db) {
  return {
    listPublishedNews: () => db.newsEvents.filter((item) => item.sourceType === 'news'),
    upsertManyEvents: (rows) => {
      const results = [];
      for (const row of rows) {
        const dedupeKey = buildEventDedupeKey(row);
        const existing = db.newsEvents.find((item) => item.dedupeKey === dedupeKey);
        if (existing) {
          Object.assign(existing, row, { dedupeKey });
          results.push(existing);
        } else {
          const inserted = { ...row, id: row.id || `id-${db.newsEvents.length + 1}`, dedupeKey };
          db.newsEvents.push(inserted);
          results.push(inserted);
        }
      }
      return results;
    }
  };
}

function withFlags(flags, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(flags)) {
    previous[key] = process.env[key];
    process.env[key] = String(value);
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function makeProviders() {
  return [
    {
      name: 'stock_a',
      category: 'stock',
      fetch: async () => ([
        { id: 's1', title: 'AAPL beats estimates', publishedAt: '2026-04-14T10:00:00.000Z', canonicalTicker: 'AAPL', importance: 90 },
        { id: 's2', title: 'Random ticker', publishedAt: '2026-04-14T11:00:00.000Z', canonicalTicker: 'ZZZZ', importance: 80 }
      ]),
      normalize: (row) => ({
        sourceType: 'news',
        eventType: 'stock_news',
        title: row.title,
        summary: '',
        body: '',
        canonicalTicker: row.canonicalTicker,
        ticker: row.canonicalTicker,
        importance: row.importance,
        publishedAt: row.publishedAt,
        sourceName: 'StockA',
        sourceExternalId: row.id,
        metadataJson: { provider: 'stock_a' },
        status: 'active'
      })
    },
    {
      name: 'world_a',
      category: 'world',
      fetch: async () => ([
        { id: 'w1', title: 'Fed signals slower cuts', publishedAt: '2026-04-14T09:00:00.000Z', importance: 85, category: 'macro' },
        { id: 'w2', title: 'General lifestyle update', publishedAt: '2026-04-14T08:00:00.000Z', importance: 20, category: 'lifestyle' }
      ]),
      normalize: (row) => ({
        sourceType: 'news',
        eventType: 'world_news',
        title: row.title,
        summary: '',
        body: '',
        importance: row.importance,
        publishedAt: row.publishedAt,
        sourceName: 'WorldA',
        sourceExternalId: row.id,
        metadataJson: { provider: 'world_a', rawCategory: row.category },
        status: 'active'
      })
    }
  ];
}

test('headline ingestion is feature-flag gated', async () => {
  const db = createDb();
  const diagnostics = await withFlags({ NEWS_HEADLINE_INGESTION_ENABLED: 'false' }, () => runHeadlineIngestion({
    trigger: 'test',
    loadDB: () => db,
    saveDB: () => {},
    ensureNewsEventTables,
    newsEventService: createNewsEventService(db),
    providers: makeProviders(),
    logger: { info: () => {}, warn: () => {} }
  }));

  assert.equal(diagnostics.skipped, true);
  assert.equal(db.newsEvents.length, 0);
});

test('headline ingestion enforces per-run and per-provider caps', async () => {
  const db = createDb();
  const providers = [
    {
      name: 'stock_cap',
      category: 'stock',
      fetch: async () => Array.from({ length: 5 }, (_, index) => ({ id: `s${index}`, title: `AAPL ${index}`, publishedAt: `2026-04-14T0${index}:00:00.000Z`, canonicalTicker: 'AAPL' })),
      normalize: (row) => ({
        sourceType: 'news',
        eventType: 'stock_news',
        title: row.title,
        summary: '',
        publishedAt: row.publishedAt,
        canonicalTicker: row.canonicalTicker,
        ticker: row.canonicalTicker,
        importance: 90,
        sourceName: 'StockCap',
        sourceExternalId: row.id,
        metadataJson: {},
        status: 'active'
      })
    }
  ];

  const diagnostics = await withFlags({
    NEWS_HEADLINE_INGESTION_ENABLED: 'true',
    NEWS_STOCK_HEADLINES_ENABLED: 'true',
    NEWS_WORLD_HEADLINES_ENABLED: 'false',
    NEWS_HEADLINE_MAX_ITEMS_PER_RUN: '2',
    NEWS_STOCK_HEADLINE_MAX_ITEMS_PER_RUN: '4',
    NEWS_HEADLINE_MAX_ITEMS_PER_PROVIDER_PER_RUN: '3'
  }, () => runHeadlineIngestion({
    trigger: 'test',
    loadDB: () => db,
    saveDB: () => {},
    ensureNewsEventTables,
    newsEventService: createNewsEventService(db),
    providers,
    logger: { info: () => {}, warn: () => {} }
  }));

  assert.equal(db.newsEvents.length, 2);
  assert.ok(diagnostics.capApplications.providerCapTrimmed >= 2);
  assert.ok(diagnostics.capApplications.runCapTrimmed >= 1);
});

test('circuit breaker opens on repeated failures and skips provider', async () => {
  const db = createDb();
  const providers = [{
    name: 'bad_provider',
    category: 'stock',
    fetch: async () => { throw new Error('down'); },
    normalize: () => null
  }];

  await withFlags({
    NEWS_HEADLINE_INGESTION_ENABLED: 'true',
    NEWS_STOCK_HEADLINES_ENABLED: 'true',
    NEWS_WORLD_HEADLINES_ENABLED: 'false',
    NEWS_HEADLINE_CIRCUIT_FAILURE_THRESHOLD: '2',
    NEWS_HEADLINE_CIRCUIT_COOLDOWN_MS: String(60 * 60 * 1000)
  }, async () => {
    await runHeadlineIngestion({ trigger: 'run1', loadDB: () => db, saveDB: () => {}, ensureNewsEventTables, newsEventService: createNewsEventService(db), providers, logger: { info: () => {}, warn: () => {} } });
    await runHeadlineIngestion({ trigger: 'run2', loadDB: () => db, saveDB: () => {}, ensureNewsEventTables, newsEventService: createNewsEventService(db), providers, logger: { info: () => {}, warn: () => {} } });
    const third = await runHeadlineIngestion({ trigger: 'run3', loadDB: () => db, saveDB: () => {}, ensureNewsEventTables, newsEventService: createNewsEventService(db), providers, logger: { info: () => {}, warn: () => {} } });
    assert.equal(db.newsIngestionStatus.headlines.providerStates.bad_provider.isOpen, true);
    assert.equal(third.providers[0].skippedByCircuit, true);
  });
});

test('stock relevance filters against owned ticker universe and world is bounded high signal', async () => {
  const db = createDb();
  await withFlags({
    NEWS_HEADLINE_INGESTION_ENABLED: 'true',
    NEWS_STOCK_HEADLINES_ENABLED: 'true',
    NEWS_WORLD_HEADLINES_ENABLED: 'true'
  }, async () => {
    const diagnostics = await runHeadlineIngestion({
      trigger: 'test',
      loadDB: () => db,
      saveDB: () => {},
      ensureNewsEventTables,
      newsEventService: createNewsEventService(db),
      providers: makeProviders(),
      logger: { info: () => {}, warn: () => {} }
    });

    assert.deepEqual(db.newsEvents.map((item) => item.sourceExternalId).sort(), ['s1', 'w1']);
    assert.equal(diagnostics.countsByEventType.stock_news, 1);
    assert.equal(diagnostics.countsByEventType.world_news, 1);
  });
});

test('provider partial failure is isolated', async () => {
  const db = createDb();
  const providers = [
    {
      name: 'stock_ok',
      category: 'stock',
      fetch: async () => ([{ id: 's-ok', title: 'AAPL update', publishedAt: '2026-04-14T10:00:00.000Z', canonicalTicker: 'AAPL' }]),
      normalize: (row) => ({ sourceType: 'news', eventType: 'stock_news', title: row.title, summary: '', publishedAt: row.publishedAt, canonicalTicker: row.canonicalTicker, ticker: row.canonicalTicker, importance: 88, sourceName: 'ok', sourceExternalId: row.id, metadataJson: {}, status: 'active' })
    },
    {
      name: 'world_bad',
      category: 'world',
      fetch: async () => { throw new Error('timeout'); },
      normalize: () => null
    }
  ];

  await withFlags({
    NEWS_HEADLINE_INGESTION_ENABLED: 'true',
    NEWS_STOCK_HEADLINES_ENABLED: 'true',
    NEWS_WORLD_HEADLINES_ENABLED: 'true'
  }, async () => {
    const diagnostics = await runHeadlineIngestion({
      trigger: 'test',
      loadDB: () => db,
      saveDB: () => {},
      ensureNewsEventTables,
      newsEventService: createNewsEventService(db),
      providers,
      logger: { info: () => {}, warn: () => {} }
    });

    assert.equal(db.newsEvents.length, 1);
    assert.ok(diagnostics.errors.some((error) => error.provider === 'world_bad'));
  });
});

test('headline dedupe key remains stable for formatting differences', () => {
  const keyA = buildEventDedupeKey({
    sourceType: 'news',
    eventType: 'stock_news',
    sourceName: 'Wire',
    title: 'Apple Beats  Expectations',
    publishedAt: '2026-04-14T10:02:00.000Z',
    canonicalTicker: 'AAPL'
  });
  const keyB = buildEventDedupeKey({
    sourceType: 'news',
    eventType: 'stock_news',
    sourceName: 'Wire',
    title: 'Apple beats expectations!',
    publishedAt: '2026-04-14T10:35:00.000Z',
    canonicalTicker: 'AAPL'
  });
  assert.equal(keyA, keyB);
});

test('circuit helper opens based on malformed ratio threshold', () => {
  const shouldOpen = shouldOpenCircuitForProvider(
    { failureCount: 0, zeroValidCount: 0 },
    { fetchFailed: false, rowsParsed: 10, rowsMalformed: 8, rowsFetched: 10, rowsValid: 2 },
    { circuitFailureThreshold: 3, circuitMalformedRatioThreshold: 0.65, circuitZeroValidThreshold: 4 }
  );
  assert.equal(shouldOpen, true);
});
