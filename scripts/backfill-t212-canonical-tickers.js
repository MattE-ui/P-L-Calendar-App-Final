#!/usr/bin/env node

const {
  loadDB,
  saveDB,
  ensureTradeJournal,
  resolveAndUpsertTrading212InstrumentMapping
} = require('../server');

function run() {
  const db = loadDB();
  let updatedTrades = 0;
  let updatedMappings = 0;

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
        if (result?.canonicalTicker && trade.canonicalTicker !== result.canonicalTicker) {
          trade.canonicalTicker = result.canonicalTicker;
          updatedTrades += 1;
        }
        trade.resolutionStatus = result?.resolutionStatus || trade.resolutionStatus || 'unresolved';
        trade.resolutionSource = result?.resolutionSource || trade.resolutionSource || 'local_cache';
        trade.confidenceScore = Number.isFinite(Number(result?.confidenceScore)) ? Number(result.confidenceScore) : (trade.confidenceScore || 0);
        if (result?.mapping) {
          updatedMappings += 1;
        }
      }
    }
  }

  saveDB(db);
  console.log(`Backfill complete. updatedTrades=${updatedTrades} mappingsTouched=${updatedMappings}`);
}

if (require.main === module) {
  run();
}
