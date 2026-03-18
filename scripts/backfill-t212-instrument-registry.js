#!/usr/bin/env node
const {
  loadDB,
  saveDB,
  ensureInstrumentRegistry,
  upsertRegistryEntry,
  lookupCanonicalInstrument,
  applyRegistryResolution
} = require('../server');

async function run() {
  const db = loadDB();
  ensureInstrumentRegistry(db);
  let created = 0;
  let resolved = 0;
  let unresolved = 0;
  for (const [username, user] of Object.entries(db.users || {})) {
    const journal = user?.tradeJournal || {};
    for (const trades of Object.values(journal)) {
      for (const trade of Array.isArray(trades) ? trades : []) {
        if (!trade || (trade.source !== 'trading212' && !trade.trading212Id)) continue;
        const { entry, created: wasCreated } = upsertRegistryEntry(db, {
          broker: 'trading212',
          brokerInstrumentId: trade.trading212Id || '',
          rawTicker: trade.trading212Ticker || trade.brokerTicker || trade.symbol || '',
          rawName: trade.trading212Name || '',
          isin: trade.trading212Isin || '',
          rawCurrency: trade.currency || '',
          rawExchange: trade.trading212Exchange || ''
        });
        if (wasCreated) created += 1;
        if (!entry.lastVerifiedAt && entry.manualOverride !== true) {
          const resolution = await lookupCanonicalInstrument({
            broker: 'trading212',
            brokerInstrumentId: entry.brokerInstrumentId,
            rawTicker: entry.rawTicker,
            rawName: entry.rawName,
            isin: entry.isin,
            rawCurrency: entry.rawCurrency,
            rawExchange: entry.rawExchange
          }, db);
          applyRegistryResolution(db, entry, resolution, `backfill:${username}`, 'backfill_script');
        }
        if (entry.resolutionStatus === 'resolved' || entry.resolutionStatus === 'manual_override') resolved += 1;
        else unresolved += 1;
      }
    }
  }
  saveDB(db);
  console.log(JSON.stringify({ ok: true, created, resolved, unresolved, total: ensureInstrumentRegistry(db).length }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
