const { fetchFinnhubEarningsEvents, selectNextUpcomingEarningsPerTicker } = require('../../providers/earnings/finnhubEarningsProvider');
const { fetchFmpEarningsEvents } = require('../../providers/earnings/fmpEarningsProvider');
const { resolveOwnedTickerUniverse } = require('./ownedTickerUniverseService');

function prepareRowsForUpsert(rows, universe, nowMs = Date.now()) {
  const prepared = [];
  let skipped = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.scheduledAt || !row?.eventType || !row?.sourceType) { skipped += 1; continue; }
    const scheduledMs = Date.parse(String(row.scheduledAt));
    if (Number.isFinite(scheduledMs) && scheduledMs <= nowMs) { skipped += 1; continue; }
    const ticker = String(row.canonicalTicker || row.ticker || '').trim().toUpperCase();
    const relevantUsers = ticker ? (universe.tickerOwnerMap[ticker] || []) : [];
    prepared.push({
      ...row,
      metadataJson: {
        ...(row.metadataJson || {}),
        relevanceUserIds: relevantUsers,
        relevance: {
          portfolioHolderCount: relevantUsers.length,
          hasCurrentHolders: relevantUsers.length > 0
        }
      }
    });
  }
  return { prepared, skipped };
}

async function runEarningsIngestion({
  loadDB,
  newsEventService,
  logger = console,
  provider = fetchFinnhubEarningsEvents,
  trigger = 'unknown',
  from,
  to
} = {}) {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const diagnostics = {
    trigger,
    startedAt,
    completedAt: null,
    elapsedMs: 0,
    success: false,
    usersConsidered: 0,
    userUniversesResolved: 0,
    aggregateTickersResolved: 0,
    providerStatus: {
      attempted: true,
      success: false,
      fetchFailed: false,
      rowsFetched: 0,
      rowsParsed: 0,
      rowsSkipped: 0,
      error: null
    },
    fallbackProviderStatus: null,
    rowsInserted: 0,
    rowsUpdated: 0,
    collisionsEncountered: 0,
    safeErrors: []
  };

  try {
    const db = loadDB();
    const universe = resolveOwnedTickerUniverse({ db, logger });
    diagnostics.usersConsidered = universe.usersConsidered;
    diagnostics.userUniversesResolved = universe.perUserUniverse.length;
    diagnostics.aggregateTickersResolved = universe.aggregateTickers.length;
    diagnostics.aggregateTickers = universe.aggregateTickers;

    if (!universe.aggregateTickers.length) {
      diagnostics.success = true;
      diagnostics.providerStatus.success = true;
      diagnostics.completedAt = new Date().toISOString();
      diagnostics.elapsedMs = Date.now() - startedAtMs;
      logger.info('[EarningsIngestion] skipped provider call due to empty aggregate ticker universe.', {
        trigger,
        usersConsidered: diagnostics.usersConsidered
      });
      return diagnostics;
    }

    // --- Primary provider (Finnhub) ---
    let primaryRows = [];
    try {
      const providerResult = await provider({
        tickers: universe.aggregateTickers,
        from,
        to,
        logger
      });

      if (Array.isArray(providerResult)) {
        primaryRows = providerResult;
      } else {
        primaryRows = Array.isArray(providerResult?.rows) ? providerResult.rows : [];
        if (providerResult?.diagnostics && typeof providerResult.diagnostics === 'object') {
          diagnostics.providerStatus.providerDiagnostics = providerResult.diagnostics;
        }
      }

      diagnostics.providerStatus.success = true;
      diagnostics.providerStatus.rowsFetched = primaryRows.length;
    } catch (error) {
      diagnostics.providerStatus.fetchFailed = true;
      diagnostics.providerStatus.error = error?.message || String(error);
      if (error?.diagnostics && typeof error.diagnostics === 'object') {
        diagnostics.providerStatus.providerDiagnostics = error.diagnostics;
      }
      diagnostics.safeErrors.push(`provider:${diagnostics.providerStatus.error}`);
      logger.warn('[EarningsIngestion] primary provider failed.', {
        trigger,
        error: diagnostics.providerStatus.error
      });
      diagnostics.completedAt = new Date().toISOString();
      diagnostics.elapsedMs = Date.now() - startedAtMs;
      return diagnostics;
    }

    // Determine which tickers Finnhub matched
    const primaryMatchedTickers = new Set(
      primaryRows.map((r) => String(r?.canonicalTicker || r?.ticker || '').trim().toUpperCase()).filter(Boolean)
    );
    const unmatchedTickers = universe.aggregateTickers.filter((t) => !primaryMatchedTickers.has(t));

    // --- Fallback provider (FMP) for unmatched tickers ---
    let fallbackRows = [];
    const fmpApiKey = process.env.FMP_API_KEY;
    if (fmpApiKey && unmatchedTickers.length > 0) {
      diagnostics.fallbackProviderStatus = {
        provider: 'fmp',
        attempted: true,
        success: false,
        unmatchedTickersRequested: unmatchedTickers.length,
        rowsFetched: 0,
        rowsParsed: 0,
        error: null
      };
      logger.info('[EarningsIngestion] running FMP fallback for unmatched tickers.', {
        trigger,
        unmatchedCount: unmatchedTickers.length,
        sample: unmatchedTickers.slice(0, 10)
      });
      try {
        const rawFmpRows = await fetchFmpEarningsEvents({
          tickers: unmatchedTickers,
          from,
          to,
          logger
        });
        diagnostics.fallbackProviderStatus.rowsFetched = Array.isArray(rawFmpRows) ? rawFmpRows.length : 0;
        // Deduplicate: keep only the next upcoming event per ticker (matches Finnhub behaviour)
        const dedupedFmp = selectNextUpcomingEarningsPerTicker(
          Array.isArray(rawFmpRows) ? rawFmpRows : [],
          startedAtMs
        );
        fallbackRows = dedupedFmp.rows;
        diagnostics.fallbackProviderStatus.rowsParsed = fallbackRows.length;
        diagnostics.fallbackProviderStatus.success = true;
      } catch (error) {
        diagnostics.fallbackProviderStatus.error = error?.message || String(error);
        diagnostics.safeErrors.push(`fmp_fallback:${diagnostics.fallbackProviderStatus.error}`);
        logger.warn('[EarningsIngestion] FMP fallback failed.', {
          trigger,
          error: diagnostics.fallbackProviderStatus.error
        });
      }
    }

    const nowMs = Date.now();
    const allRows = [...primaryRows, ...fallbackRows];

    const { prepared: preparedRows, skipped: skippedRows } = prepareRowsForUpsert(allRows, universe, nowMs);
    diagnostics.providerStatus.rowsParsed = preparedRows.length;
    diagnostics.providerStatus.rowsSkipped = skippedRows;

    const existing = new Set(newsEventService.listUpcomingEvents({ sourceType: 'earnings' }).map((event) => event.dedupeKey));
    const upserted = newsEventService.upsertManyEvents(preparedRows);
    for (const event of upserted) {
      if (existing.has(event.dedupeKey)) diagnostics.rowsUpdated += 1;
      else diagnostics.rowsInserted += 1;
    }
    diagnostics.collisionsEncountered = Math.max(0, preparedRows.length - upserted.length);
    if (diagnostics.providerStatus.providerDiagnostics && typeof diagnostics.providerStatus.providerDiagnostics === 'object') {
      diagnostics.providerStatus.providerDiagnostics.rowsInserted = diagnostics.rowsInserted;
    }
    diagnostics.success = diagnostics.providerStatus.success;
  } catch (error) {
    diagnostics.safeErrors.push(error?.message || String(error));
    logger.error('[EarningsIngestion] run failed.', {
      trigger,
      error: error?.message || error
    });
  }

  diagnostics.completedAt = new Date().toISOString();
  diagnostics.elapsedMs = Date.now() - startedAtMs;

  logger.info('[EarningsIngestion] provider diagnostics summary.', {
    datesFetched: diagnostics.providerStatus.providerDiagnostics?.datesFetched || 0,
    totalRowsFetched: diagnostics.providerStatus.providerDiagnostics?.totalRowsFetched || 0,
    rowsMatchedToPortfolio: diagnostics.providerStatus.providerDiagnostics?.rowsMatchedToPortfolio || diagnostics.providerStatus.rowsParsed || 0,
    rowsInserted: diagnostics.rowsInserted,
    rowsSkipped: diagnostics.providerStatus.rowsSkipped || 0,
    fallbackProviderStatus: diagnostics.fallbackProviderStatus
  });

  logger.info('[EarningsIngestion] run completed.', diagnostics);
  return diagnostics;
}

module.exports = {
  runEarningsIngestion
};
