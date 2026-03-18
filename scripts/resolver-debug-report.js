#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || process.env.DATA_FILE || path.join(process.cwd(), 'storage', 'data.json');
const SAMPLE_LIMIT = Number(process.env.SAMPLE_LIMIT || 12);

function normalizeTicker(raw) {
  return String(raw || '').trim().toUpperCase();
}

function cleanBrokerTicker(raw) {
  return normalizeTicker(raw).replace(/_US_EQ$/i, '').replace(/_EQ$/i, '').replace(/\.[A-Z]+$/i, '');
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    return { users: {}, instrumentMappings: [] };
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8') || '{}');
}

function collectTradeHints(db) {
  const bySourceKey = new Map();
  for (const [username, user] of Object.entries(db.users || {})) {
    const journal = user?.tradeJournal || {};
    for (const entries of Object.values(journal)) {
      for (const trade of entries || []) {
        if (!trade || (!trade.trading212Ticker && !trade.sourceKey)) continue;
        const key = trade.sourceKey || (trade.trading212BrokerInstrumentId
          ? `TRADING212|INSTRUMENT:${trade.trading212BrokerInstrumentId}`
          : trade.trading212Isin
            ? `TRADING212|ISIN:${normalizeTicker(trade.trading212Isin)}`
            : `TRADING212|TICKER:${normalizeTicker(trade.trading212Ticker)}|CCY:${normalizeTicker(trade.currency)}|EX:${normalizeTicker(trade.trading212Exchange)}`);
        if (!bySourceKey.has(key)) {
          bySourceKey.set(key, {
            username,
            rawTicker: trade.trading212Ticker || trade.rawTicker || trade.symbol || '',
            rawName: trade.trading212Name || trade.rawName || '',
            brokerInstrumentId: trade.trading212BrokerInstrumentId || '',
            isin: trade.trading212Isin || '',
            displayTicker: trade.displayTicker || trade.displaySymbol || trade.symbol || '',
            canonicalTicker: trade.canonicalTicker || '',
            resolutionStatus: trade.resolutionStatus || '',
            resolutionSource: trade.resolutionSource || '',
            confidenceScore: Number(trade.confidenceScore || 0)
          });
        }
      }
    }
  }
  return bySourceKey;
}

function classify(mapping, hint) {
  const rawTicker = hint?.rawTicker || mapping.raw_ticker || mapping.broker_ticker || '';
  const canonicalTicker = hint?.canonicalTicker || mapping.canonical_ticker || '';
  const cleaned = cleanBrokerTicker(rawTicker);
  const status = String(hint?.resolutionStatus || mapping.resolution_status || 'unresolved').toLowerCase();
  const source = String(hint?.resolutionSource || mapping.resolution_source || 'local_cache').toLowerCase();
  const score = Number.isFinite(Number(hint?.confidenceScore)) ? Number(hint.confidenceScore) : Number(mapping.confidence_score || mapping.confidence || 0);
  const topCandidates = Array.isArray(mapping.debug_candidates) ? mapping.debug_candidates : [];
  const likelyArtifact = Boolean(canonicalTicker)
    && canonicalTicker.toUpperCase() === cleaned
    && status !== 'manual_override'
    && !source.includes('exact');
  const likelyCanonical = Boolean(canonicalTicker) && !likelyArtifact && (status === 'resolved' || status === 'manual_override');
  return {
    rawTicker,
    rawName: hint?.rawName || mapping.raw_name || mapping.broker_name || '',
    brokerInstrumentId: hint?.brokerInstrumentId || mapping.broker_instrument_id || '',
    isin: hint?.isin || mapping.raw_isin || mapping.isin || '',
    canonicalTicker,
    displayTicker: hint?.displayTicker || canonicalTicker || cleaned,
    resolutionStatus: status,
    resolutionSource: source,
    confidenceScore: Number(score.toFixed(4)),
    topCandidates,
    likelyCanonicalMarketTicker: likelyCanonical,
    likelyCleanedBrokerArtifact: likelyArtifact
  };
}

function main() {
  const db = loadDb();
  const mappings = Array.isArray(db.instrumentMappings) ? db.instrumentMappings : [];
  const hints = collectTradeHints(db);
  const samples = mappings
    .filter(m => m && m.status === 'active')
    .map(m => classify(m, hints.get(m.source_key)))
    .filter(item => {
      if (item.rawTicker && item.canonicalTicker && item.rawTicker !== item.canonicalTicker) return true;
      if (item.resolutionStatus === 'resolved' && item.confidenceScore < 0.9) return true;
      if (item.topCandidates.length > 1) return true;
      return false;
    })
    .slice(0, SAMPLE_LIMIT);

  const summary = {
    totalMappings: mappings.length,
    sampled: samples.length,
    categories: {
      likely_cleaned_artifact: samples.filter(s => s.likelyCleanedBrokerArtifact).length,
      weak_resolved_confidence: samples.filter(s => s.resolutionStatus === 'resolved' && s.confidenceScore < 0.9).length,
      unresolved_or_ambiguous: samples.filter(s => ['unresolved', 'ambiguous'].includes(s.resolutionStatus)).length
    }
  };

  console.log(JSON.stringify({ summary, samples }, null, 2));
}

main();
