const { fetchFedFomcEvents } = require('../../providers/macro/fedFomcProvider');
const { fetchBlsCpiEvents } = require('../../providers/macro/blsCpiProvider');
const { fetchBlsNfpEvents } = require('../../providers/macro/blsNfpProvider');
const { fetchBeaGdpEvents } = require('../../providers/macro/beaGdpProvider');

function createProviderDiagnostic(name) {
  return {
    provider: name,
    attempted: true,
    success: false,
    fetchFailed: false,
    parseFailed: false,
    upsertFailed: false,
    rowsFetched: 0,
    rowsParsed: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    collisionsEncountered: 0,
    error: null,
    elapsedMs: 0
  };
}

async function runMacroIngestion({ newsEventService, providers, logger = console } = {}) {
  const startedAt = Date.now();
  const providerConfig = providers || [
    { name: 'fomc', fetch: fetchFedFomcEvents },
    { name: 'cpi', fetch: fetchBlsCpiEvents },
    { name: 'nfp', fetch: fetchBlsNfpEvents },
    { name: 'gdp', fetch: fetchBeaGdpEvents }
  ];

  const diagnostics = {
    providersAttempted: providerConfig.map((item) => item.name),
    providers: [],
    totals: {
      rowsFetched: 0,
      rowsParsed: 0,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsSkipped: 0,
      collisionsEncountered: 0
    },
    success: false,
    elapsedMs: 0
  };

  const normalizedRows = [];

  for (const provider of providerConfig) {
    const providerStartedAt = Date.now();
    const item = createProviderDiagnostic(provider.name);
    diagnostics.providers.push(item);
    try {
      const rows = await provider.fetch({ logger });
      item.rowsFetched = Array.isArray(rows) ? rows.length : 0;
      if (!Array.isArray(rows)) throw new Error('Provider returned non-array rows.');

      const validRows = rows.filter((row) => row && row.sourceType && row.eventType && row.scheduledAt);
      item.rowsSkipped = rows.length - validRows.length;
      item.rowsParsed = validRows.length;
      normalizedRows.push(...validRows);
      item.success = true;
    } catch (error) {
      item.fetchFailed = true;
      item.error = error?.message || String(error);
      logger.warn('[MacroIngestion] provider failed.', { provider: provider.name, error: item.error });
    } finally {
      item.elapsedMs = Date.now() - providerStartedAt;
      diagnostics.totals.rowsFetched += item.rowsFetched;
      diagnostics.totals.rowsParsed += item.rowsParsed;
      diagnostics.totals.rowsSkipped += item.rowsSkipped;
    }
  }

  if (normalizedRows.length && newsEventService) {
    try {
      const beforeByKey = new Map(newsEventService.listUpcomingEvents({ sourceType: 'macro' }).map((event) => [event.dedupeKey, event.id]));
      const upserted = newsEventService.upsertManyEvents(normalizedRows);
      for (const event of upserted) {
        const existed = event?.dedupeKey ? beforeByKey.has(event.dedupeKey) : false;
        if (existed) diagnostics.totals.rowsUpdated += 1;
        else diagnostics.totals.rowsInserted += 1;
      }
      diagnostics.totals.collisionsEncountered = Math.max(0, normalizedRows.length - upserted.length);
    } catch (error) {
      diagnostics.providers.forEach((provider) => {
        if (provider.success) {
          provider.upsertFailed = true;
          provider.success = false;
        }
      });
      logger.error('[MacroIngestion] upsert failed.', { error: error?.message || error });
    }
  }

  diagnostics.success = diagnostics.providers.some((item) => item.success);
  diagnostics.elapsedMs = Date.now() - startedAt;
  logger.info('[MacroIngestion] run completed.', { success: diagnostics.success, elapsedMs: diagnostics.elapsedMs, totals: diagnostics.totals });
  return diagnostics;
}

module.exports = {
  runMacroIngestion
};
