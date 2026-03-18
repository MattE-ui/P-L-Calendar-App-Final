const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeInstrumentName,
  scoreInstrumentCandidate,
  pickBestCandidate
} = require('../services/instrumentResolver');
const { resolveAndUpsertTrading212InstrumentMapping } = require('../server');

test('normalizeInstrumentName keeps class information while removing suffix noise', () => {
  const normalized = normalizeInstrumentName('  Berkshire Hathaway Inc. Class B  ');
  assert.equal(normalized, 'berkshire hathaway class b');
});

test('scoreInstrumentCandidate rewards exchange/currency/type alignment', () => {
  const { score, reasons } = scoreInstrumentCandidate(
    {
      rawName: 'NVIDIA Corporation',
      rawTicker: 'NVDA_US_EQ',
      rawExchange: 'NASDAQ',
      rawCurrency: 'USD',
      rawInstrumentType: 'EQUITY'
    },
    {
      ticker: 'NVDA',
      name: 'NVIDIA Corp',
      exchange: 'NASDAQ',
      currency: 'USD',
      instrumentType: 'EQUITY',
      isActive: true
    }
  );
  assert.ok(score >= 0.8);
  assert.ok(reasons.includes('exchange_match'));
  assert.ok(reasons.includes('currency_match'));
});

test('pickBestCandidate ranks highest scoring candidate first', () => {
  const ranked = pickBestCandidate(
    { rawName: 'Alphabet Class A', rawTicker: 'GOOGL_US_EQ', rawCurrency: 'USD' },
    [
      { ticker: 'GOOG', name: 'Alphabet Class C', currency: 'USD', isActive: true },
      { ticker: 'GOOGL', name: 'Alphabet Class A', currency: 'USD', isActive: true }
    ]
  );
  assert.equal(ranked.best.candidate.ticker, 'GOOGL');
  assert.ok(ranked.best.score >= ranked.runnerUp.score);
});

test('resolver uses metadata exact match over raw Trading 212 ticker', () => {
  const db = {
    instrumentMappings: [],
    instrumentResolutionMetrics: [],
    t212MetadataCache: []
  };
  const metadata = {
    instruments: [
      {
        id: 'inst-1',
        ticker: 'META',
        name: 'Meta Platforms Inc Class A',
        exchange: 'NASDAQ',
        currency: 'USD',
        type: 'EQUITY',
        isin: 'US30303M1027'
      }
    ]
  };

  const result = resolveAndUpsertTrading212InstrumentMapping(db, 'alice', {
    rawTicker: 'FB_US_EQ',
    rawName: 'Meta Platforms, Inc. Class A',
    rawExchange: 'NASDAQ',
    rawCurrency: 'USD',
    rawInstrumentType: 'EQUITY',
    rawIsin: 'US30303M1027',
    brokerInstrumentId: 'inst-1'
  }, metadata);

  assert.equal(result.canonicalTicker, 'META');
  assert.equal(result.resolutionStatus, 'resolved');
  assert.equal(result.resolutionSource, 't212_metadata_exact');
  assert.equal(db.instrumentMappings.length, 1);
});
