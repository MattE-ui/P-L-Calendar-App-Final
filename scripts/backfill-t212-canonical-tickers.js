#!/usr/bin/env node

const {
  loadDB,
  saveDB,
  ensureTradeJournal,
  resolveAndUpsertTrading212InstrumentMapping
} = require('../server');

function run() {
  const dryRun = process.argv.includes('--dry-run');
  const db = loadDB();
  let updatedTrades = 0;
  let unchangedTrades = 0;
  let unresolved = 0;
  let ambiguous = 0;
  let manualOverridePreserved = 0;

  for (const [username, user] of Object.entries(db.users || {})) {
    const journal = ensureTradeJournal(user);
    for (const trades of Object.values(journal)) {
      for (const trade of trades || []) {
        if (!trade || (trade.source !== 'trading212' && !trade.trading212Id)) continue;
        const result = resolveAndUpsertTrading212InstrumentMapping(db, username, {
          rawTicker: trade.trading212Ticker || trade.symbol || '',
          rawName: trade.trading212Name || '',
          rawExchange: trade.trading212Exchange || '',
          rawCurrency: trade.currency || '',
          rawInstrumentType: trade.trading212InstrumentType || '',
          rawIsin: trade.trading212Isin || '',
          brokerInstrumentId: trade.trading212BrokerInstrumentId || ''
        }, null);
        if (result?.resolutionStatus === 'manual_override') {
          manualOverridePreserved += 1;
        }
        if (result?.resolutionStatus === 'unresolved') {
          unresolved += 1;
        }
        if (result?.resolutionStatus === 'ambiguous') {
          ambiguous += 1;
        }
        if (result?.canonicalTicker && trade.canonicalTicker !== result.canonicalTicker) {
          trade.canonicalTicker = result.canonicalTicker;
          updatedTrades += 1;
        } else {
          unchangedTrades += 1;
        }
        trade.resolutionStatus = result?.resolutionStatus || trade.resolutionStatus || 'unresolved';
        trade.resolutionSource = result?.resolutionSource || trade.resolutionSource || 'local_cache';
        trade.confidenceScore = Number.isFinite(Number(result?.confidenceScore)) ? Number(result.confidenceScore) : (trade.confidenceScore || 0);
      }
    }
  }

  if (!dryRun) {
    saveDB(db);
  }
  console.log(`Backfill complete. dryRun=${dryRun} updated=${updatedTrades} unchanged=${unchangedTrades} unresolved=${unresolved} ambiguous=${ambiguous} manualOverridePreserved=${manualOverridePreserved}`);
}

if (require.main === module) {
  run();
}
