const { resolveOwnedTickerUniverse } = require('./ownedTickerUniverseService');
const {
  PROVIDER_NAME: CONFIGURED_STOCK_PROVIDER,
  normalizeStockHeadlineRow,
  fetchConfiguredStockNews
} = require('../../providers/news/configuredNewsStockProvider');
const {
  PROVIDER_NAME: CONFIGURED_WORLD_PROVIDER,
  normalizeWorldHeadlineRow,
  fetchConfiguredWorldNews
} = require('../../providers/news/configuredNewsWorldProvider');

const WORLD_HIGH_SIGNAL_CATEGORIES = new Set(['macro', 'market', 'markets', 'economy', 'central_bank', 'rates', 'inflation', 'policy', 'geopolitics']);

function envFlag(name, defaultValue = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function envInt(name, fallback, min = 0, max = 5000) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function getHeadlineIngestionFeatureState() {
  const enabled = envFlag('NEWS_HEADLINE_INGESTION_ENABLED', false);
  const stockEnabled = enabled && envFlag('NEWS_STOCK_HEADLINES_ENABLED', true);
  const worldEnabled = enabled && envFlag('NEWS_WORLD_HEADLINES_ENABLED', true);

  return {
    enabled,
    stockEnabled,
    worldEnabled,
    maxItemsPerRun: envInt('NEWS_HEADLINE_MAX_ITEMS_PER_RUN', 120, 1, 5000),
    stockMaxItemsPerRun: envInt('NEWS_STOCK_HEADLINE_MAX_ITEMS_PER_RUN', 80, 0, 5000),
    worldMaxItemsPerRun: envInt('NEWS_WORLD_HEADLINE_MAX_ITEMS_PER_RUN', 40, 0, 5000),
    maxItemsPerProviderPerRun: envInt('NEWS_HEADLINE_MAX_ITEMS_PER_PROVIDER_PER_RUN', 60, 1, 2000),
    circuitFailureThreshold: envInt('NEWS_HEADLINE_CIRCUIT_FAILURE_THRESHOLD', 3, 1, 50),
    circuitMalformedRatioThreshold: Number(process.env.NEWS_HEADLINE_CIRCUIT_MALFORMED_RATIO_THRESHOLD) || 0.65,
    circuitZeroValidThreshold: envInt('NEWS_HEADLINE_CIRCUIT_ZERO_VALID_THRESHOLD', 4, 1, 50),
    circuitCooldownMs: envInt('NEWS_HEADLINE_CIRCUIT_COOLDOWN_MS', 20 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000)
  };
}

function nowIso() {
  return new Date().toISOString();
}

function createProviderDiagnostics(provider) {
  return {
    provider: provider.name,
    category: provider.category,
    attempted: false,
    skippedByCircuit: false,
    fetchFailed: false,
    parseFailed: false,
    rowsFetched: 0,
    rowsParsed: 0,
    rowsValid: 0,
    rowsMalformed: 0,
    rowsSkipped: 0,
    rowsFilteredByRelevance: 0,
    rowsCapped: 0,
    elapsedMs: 0,
    error: null,
    circuitStateBefore: provider.circuitState || null,
    circuitStateAfter: null
  };
}

function normalizeCategory(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isHighSignalWorldItem(item) {
  const category = normalizeCategory(item?.metadataJson?.rawCategory);
  const importance = Number(item?.importance || 0);
  if (importance >= 80) return true;
  if (category && WORLD_HIGH_SIGNAL_CATEGORIES.has(category)) return true;
  return false;
}

function shouldOpenCircuitForProvider(providerState = {}, diagnostics = {}, thresholds = {}) {
  const fetchFailed = !!diagnostics.fetchFailed;
  const malformedRatio = diagnostics.rowsParsed > 0
    ? (diagnostics.rowsMalformed / diagnostics.rowsParsed)
    : 0;
  const zeroValid = diagnostics.rowsFetched > 0 && diagnostics.rowsValid === 0;
  const failureCount = Number(providerState.failureCount || 0) + (fetchFailed ? 1 : 0);
  const zeroValidCount = Number(providerState.zeroValidCount || 0) + (zeroValid ? 1 : 0);

  const hitFailureThreshold = failureCount >= Number(thresholds.circuitFailureThreshold || 3);
  const hitMalformedThreshold = malformedRatio >= Number(thresholds.circuitMalformedRatioThreshold || 0.65) && diagnostics.rowsParsed >= 3;
  const hitZeroValidThreshold = zeroValidCount >= Number(thresholds.circuitZeroValidThreshold || 4);

  return hitFailureThreshold || hitMalformedThreshold || hitZeroValidThreshold;
}

function buildHeadlineIngestionDiagnostics({ trigger, featureState }) {
  return {
    trigger,
    startedAt: nowIso(),
    finishedAt: null,
    elapsedMs: 0,
    success: false,
    skipped: false,
    featureState,
    countsByEventType: { stock_news: 0, world_news: 0 },
    totals: {
      rowsFetched: 0,
      rowsParsed: 0,
      rowsValid: 0,
      rowsSkipped: 0,
      rowsMalformed: 0,
      rowsFilteredByRelevance: 0,
      rowsCapped: 0,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsDeduped: 0
    },
    providers: [],
    capApplications: {
      runCapTrimmed: 0,
      stockCapTrimmed: 0,
      worldCapTrimmed: 0,
      providerCapTrimmed: 0
    },
    errors: []
  };
}

function buildDefaultProviders() {
  return [
    {
      name: CONFIGURED_STOCK_PROVIDER,
      category: 'stock',
      fetch: (ctx) => fetchConfiguredStockNews({ logger: ctx.logger }),
      normalize: normalizeStockHeadlineRow
    },
    {
      name: CONFIGURED_WORLD_PROVIDER,
      category: 'world',
      fetch: (ctx) => fetchConfiguredWorldNews({ logger: ctx.logger }),
      normalize: normalizeWorldHeadlineRow
    }
  ];
}

function circuitOpen(state = {}, featureState = {}, now = Date.now()) {
  const openedAt = Date.parse(state.openedAt || 0);
  if (!state.isOpen || !Number.isFinite(openedAt)) return false;
  return now < (openedAt + Number(featureState.circuitCooldownMs || 0));
}

function upsertCircuitState({ status, providerName, diagnostic, featureState }) {
  const now = Date.now();
  const existing = status.providerStates?.[providerName] || {};
  const zeroValid = diagnostic.rowsFetched > 0 && diagnostic.rowsValid === 0;
  const fetchFailed = !!diagnostic.fetchFailed;
  const next = {
    provider: providerName,
    isOpen: false,
    openedAt: null,
    lastAttemptedAt: nowIso(),
    lastSuccessfulAt: existing.lastSuccessfulAt || null,
    failureCount: fetchFailed ? Number(existing.failureCount || 0) + 1 : 0,
    zeroValidCount: zeroValid ? Number(existing.zeroValidCount || 0) + 1 : 0,
    lastError: diagnostic.error || null,
    recentMalformedRatio: diagnostic.rowsParsed > 0 ? (diagnostic.rowsMalformed / diagnostic.rowsParsed) : 0
  };

  if (!fetchFailed && diagnostic.rowsValid > 0) {
    next.lastSuccessfulAt = nowIso();
  }

  if (shouldOpenCircuitForProvider(existing, diagnostic, featureState)) {
    next.isOpen = true;
    next.openedAt = new Date(now).toISOString();
  }

  status.providerStates[providerName] = next;
  return next;
}

function applyCommonCaps(rows, limit, diagnostics, key) {
  if (rows.length <= limit) return rows;
  const trimmed = rows.slice(0, limit);
  const delta = rows.length - trimmed.length;
  diagnostics.totals.rowsCapped += delta;
  diagnostics.capApplications[key] += delta;
  return trimmed;
}

async function ingestStockHeadlines(options = {}) {
  return ingestByCategory({ ...options, category: 'stock' });
}

async function ingestWorldHeadlines(options = {}) {
  return ingestByCategory({ ...options, category: 'world' });
}

async function ingestByCategory(options = {}) {
  const {
    category,
    providers,
    diagnostics,
    status,
    featureState,
    relevance,
    logger = console
  } = options;

  const providerRows = [];
  for (const provider of providers.filter((item) => item.category === category)) {
    const startedAt = Date.now();
    const providerDiag = createProviderDiagnostics({ ...provider, circuitState: status.providerStates?.[provider.name] || null });
    diagnostics.providers.push(providerDiag);
    providerDiag.attempted = true;

    const providerState = status.providerStates?.[provider.name] || {};
    if (circuitOpen(providerState, featureState, Date.now())) {
      providerDiag.skippedByCircuit = true;
      providerDiag.circuitStateAfter = providerState;
      providerDiag.elapsedMs = Date.now() - startedAt;
      continue;
    }

    try {
      logger.info('[HeadlineIngestion] provider start.', { provider: provider.name, category });
      const rawRows = await provider.fetch({ logger, category, relevance, featureState });
      providerDiag.rowsFetched = Array.isArray(rawRows) ? rawRows.length : 0;
      const cappedRawRows = applyCommonCaps(rawRows, featureState.maxItemsPerProviderPerRun, diagnostics, 'providerCapTrimmed');
      providerDiag.rowsCapped += providerDiag.rowsFetched - cappedRawRows.length;

      for (const rawRow of cappedRawRows) {
        providerDiag.rowsParsed += 1;
        let normalized = null;
        try {
          normalized = provider.normalize(rawRow, { relevance, category, providerName: provider.name });
        } catch (parseError) {
          providerDiag.parseFailed = true;
          providerDiag.rowsMalformed += 1;
          continue;
        }
        if (!normalized || !normalized.title || !normalized.publishedAt) {
          providerDiag.rowsMalformed += 1;
          continue;
        }

        if (category === 'stock') {
          const ticker = String(normalized.canonicalTicker || normalized.ticker || '').toUpperCase();
          if (!ticker || !relevance.ownedTickerSet.has(ticker)) {
            providerDiag.rowsFilteredByRelevance += 1;
            continue;
          }
          normalized.metadataJson = {
            ...(normalized.metadataJson || {}),
            relevanceUserIds: relevance.tickerOwnerMap[ticker] || []
          };
        }

        if (category === 'world' && !isHighSignalWorldItem(normalized)) {
          providerDiag.rowsFilteredByRelevance += 1;
          continue;
        }

        providerDiag.rowsValid += 1;
        providerRows.push(normalized);
      }
      providerDiag.rowsSkipped = providerDiag.rowsFetched - providerDiag.rowsValid;
      logger.info('[HeadlineIngestion] provider end.', {
        provider: provider.name,
        category,
        fetched: providerDiag.rowsFetched,
        parsed: providerDiag.rowsParsed,
        valid: providerDiag.rowsValid,
        filtered: providerDiag.rowsFilteredByRelevance,
        malformed: providerDiag.rowsMalformed,
        capped: providerDiag.rowsCapped
      });
    } catch (error) {
      providerDiag.fetchFailed = true;
      providerDiag.error = error?.message || String(error);
      diagnostics.errors.push({ provider: provider.name, stage: 'fetch', error: providerDiag.error });
      logger.warn('[HeadlineIngestion] provider failed.', { provider: provider.name, category, error: providerDiag.error });
    } finally {
      providerDiag.elapsedMs = Date.now() - startedAt;
      providerDiag.circuitStateAfter = upsertCircuitState({
        status,
        providerName: provider.name,
        diagnostic: providerDiag,
        featureState
      });

      diagnostics.totals.rowsFetched += providerDiag.rowsFetched;
      diagnostics.totals.rowsParsed += providerDiag.rowsParsed;
      diagnostics.totals.rowsValid += providerDiag.rowsValid;
      diagnostics.totals.rowsSkipped += providerDiag.rowsSkipped;
      diagnostics.totals.rowsMalformed += providerDiag.rowsMalformed;
      diagnostics.totals.rowsFilteredByRelevance += providerDiag.rowsFilteredByRelevance;
    }
  }

  return providerRows;
}

async function runHeadlineIngestion(options = {}) {
  const startedAt = Date.now();
  const featureState = getHeadlineIngestionFeatureState();
  const diagnostics = buildHeadlineIngestionDiagnostics({ trigger: options.trigger || 'unknown', featureState });
  const logger = options.logger || console;

  logger.info('[HeadlineIngestion] run start.', { trigger: options.trigger || 'unknown', featureState });
  if (!featureState.enabled) {
    diagnostics.skipped = true;
    diagnostics.finishedAt = nowIso();
    diagnostics.elapsedMs = Date.now() - startedAt;
    diagnostics.success = true;
    return diagnostics;
  }

  const loadDB = options.loadDB;
  const saveDB = options.saveDB;
  const ensureNewsEventTables = options.ensureNewsEventTables;
  const newsEventService = options.newsEventService;
  if (typeof loadDB !== 'function' || typeof saveDB !== 'function' || typeof ensureNewsEventTables !== 'function' || !newsEventService) {
    throw new Error('runHeadlineIngestion requires loadDB/saveDB/ensureNewsEventTables/newsEventService');
  }

  const db = loadDB();
  ensureNewsEventTables(db);
  const status = db.newsIngestionStatus.headlines;
  status.lastAttemptedRunAt = nowIso();
  status.providerStates ||= {};

  const ownedUniverse = (options.resolveOwnedTickerUniverse || resolveOwnedTickerUniverse)({ db, logger });
  const relevance = {
    ownedTickerSet: new Set(ownedUniverse.aggregateTickers || []),
    tickerOwnerMap: ownedUniverse.tickerOwnerMap || {}
  };

  const providers = options.providers || buildDefaultProviders();
  let stockRows = [];
  let worldRows = [];

  if (featureState.stockEnabled) {
    stockRows = await ingestStockHeadlines({ providers, diagnostics, status, featureState, relevance, logger });
    stockRows = applyCommonCaps(stockRows, featureState.stockMaxItemsPerRun, diagnostics, 'stockCapTrimmed');
  }
  if (featureState.worldEnabled) {
    worldRows = await ingestWorldHeadlines({ providers, diagnostics, status, featureState, relevance, logger });
    worldRows = applyCommonCaps(worldRows, featureState.worldMaxItemsPerRun, diagnostics, 'worldCapTrimmed');
  }

  let rows = [...stockRows, ...worldRows]
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')) || String(a.sourceExternalId || '').localeCompare(String(b.sourceExternalId || '')));
  rows = applyCommonCaps(rows, featureState.maxItemsPerRun, diagnostics, 'runCapTrimmed');

  const before = new Set(newsEventService.listPublishedNews({ sourceType: 'news' }).map((item) => item.dedupeKey));
  const upserted = rows.length ? newsEventService.upsertManyEvents(rows) : [];
  for (const item of upserted) {
    const key = item?.dedupeKey;
    if (key && before.has(key)) diagnostics.totals.rowsUpdated += 1;
    else diagnostics.totals.rowsInserted += 1;
    diagnostics.countsByEventType[item.eventType] = (diagnostics.countsByEventType[item.eventType] || 0) + 1;
  }
  diagnostics.totals.rowsDeduped = Math.max(0, rows.length - upserted.length);

  const successful = diagnostics.totals.rowsInserted > 0 || diagnostics.totals.rowsUpdated > 0 || diagnostics.providers.every((item) => item.skippedByCircuit || !item.fetchFailed);
  diagnostics.success = successful;
  diagnostics.finishedAt = nowIso();
  diagnostics.elapsedMs = Date.now() - startedAt;

  status.lastDiagnostics = diagnostics;
  status.lastProviderStatuses = diagnostics.providers;
  if (successful) {
    status.lastSuccessfulRunAt = nowIso();
  }
  saveDB(db);

  logger.info('[HeadlineIngestion] run end.', {
    trigger: options.trigger || 'unknown',
    success: diagnostics.success,
    elapsedMs: diagnostics.elapsedMs,
    totals: diagnostics.totals,
    countsByEventType: diagnostics.countsByEventType,
    capApplications: diagnostics.capApplications
  });

  return diagnostics;
}

module.exports = {
  runHeadlineIngestion,
  ingestStockHeadlines,
  ingestWorldHeadlines,
  shouldOpenCircuitForProvider,
  getHeadlineIngestionFeatureState,
  buildHeadlineIngestionDiagnostics
};
