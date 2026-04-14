const { fetchAlphaVantageEarningsEvents } = require('../../providers/earnings/alphaVantageEarningsProvider');
const { resolveOwnedTickerUniverse } = require('./ownedTickerUniverseService');

async function runEarningsIngestion({
  loadDB,
  newsEventService,
  logger = console,
  provider = fetchAlphaVantageEarningsEvents,
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

    let normalizedRows = [];
    try {
      const providerResult = await provider({
        tickers: universe.aggregateTickers,
        from,
        to,
        logger
      });

      if (Array.isArray(providerResult)) {
        normalizedRows = providerResult;
      } else {
        normalizedRows = Array.isArray(providerResult?.rows) ? providerResult.rows : [];
        if (providerResult?.diagnostics && typeof providerResult.diagnostics === 'object') {
          diagnostics.providerStatus.providerDiagnostics = providerResult.diagnostics;
        }
      }

      diagnostics.providerStatus.success = true;
      diagnostics.providerStatus.rowsFetched = Array.isArray(normalizedRows) ? normalizedRows.length : 0;
    } catch (error) {
      diagnostics.providerStatus.fetchFailed = true;
      diagnostics.providerStatus.error = error?.message || String(error);
      if (error?.diagnostics && typeof error.diagnostics === 'object') {
        diagnostics.providerStatus.providerDiagnostics = error.diagnostics;
      }
      diagnostics.safeErrors.push(`provider:${diagnostics.providerStatus.error}`);
      logger.warn('[EarningsIngestion] provider failed.', {
        trigger,
        error: diagnostics.providerStatus.error
      });
      diagnostics.completedAt = new Date().toISOString();
      diagnostics.elapsedMs = Date.now() - startedAtMs;
      return diagnostics;
    }

    const rows = Array.isArray(normalizedRows) ? normalizedRows : [];
    const preparedRows = [];
    let skippedRows = 0;
    for (const row of rows) {
      if (!row?.scheduledAt || !row?.eventType || !row?.sourceType) {
        skippedRows += 1;
        continue;
      }
      const ticker = String(row.canonicalTicker || row.ticker || '').trim().toUpperCase();
      const relevantUsers = ticker ? (universe.tickerOwnerMap[ticker] || []) : [];
      preparedRows.push({
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
    diagnostics.providerStatus.rowsParsed = preparedRows.length;
    diagnostics.providerStatus.rowsSkipped = skippedRows;

    const existing = new Set(newsEventService.listUpcomingEvents({ sourceType: 'earnings' }).map((event) => event.dedupeKey));
    const upserted = newsEventService.upsertManyEvents(preparedRows);
    for (const event of upserted) {
      if (existing.has(event.dedupeKey)) diagnostics.rowsUpdated += 1;
      else diagnostics.rowsInserted += 1;
    }
    diagnostics.collisionsEncountered = Math.max(0, preparedRows.length - upserted.length);
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
  logger.info('[EarningsIngestion] run completed.', diagnostics);
  return diagnostics;
}

module.exports = {
  runEarningsIngestion
};
