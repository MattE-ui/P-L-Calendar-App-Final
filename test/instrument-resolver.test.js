const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeInstrumentName,
  scoreInstrumentCandidate,
  pickBestCandidate
} = require('../services/instrumentResolver');
const { resolveAndUpsertTrading212InstrumentMapping, getDisplayInstrumentIdentity } = require('../server');

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

test('manual override mapping beats metadata-scored alternatives', () => {
  const db = {
    instrumentMappings: [{
      id: 1,
      source_key: 'TRADING212|INSTRUMENT:inst-2',
      scope: 'global',
      status: 'active',
      resolution_status: 'manual_override',
      resolution_source: 'manual_override',
      confidence_score: 1,
      canonical_ticker: 'MSFT',
      canonical_name: 'Microsoft Corporation'
    }],
    instrumentResolutionMetrics: [],
    t212MetadataCache: []
  };
  const result = resolveAndUpsertTrading212InstrumentMapping(db, 'alice', {
    brokerInstrumentId: 'inst-2',
    rawTicker: 'MSTF_US_EQ',
    rawName: 'Microsoft Corp',
    rawCurrency: 'USD'
  }, {
    instruments: [{ id: 'inst-2', ticker: 'WRONG', name: 'Wrong Mapping', currency: 'USD', type: 'EQUITY' }]
  });
  assert.equal(result.canonicalTicker, 'MSFT');
  assert.equal(result.resolutionStatus, 'manual_override');
});

test('low-confidence candidate remains unresolved', () => {
  const db = { instrumentMappings: [], instrumentResolutionMetrics: [], t212MetadataCache: [] };
  const result = resolveAndUpsertTrading212InstrumentMapping(db, 'alice', {
    rawTicker: 'X1_US_EQ',
    rawName: 'Random Unknown Name',
    rawCurrency: 'USD'
  }, {
    instruments: [
      { id: 'a', ticker: 'AAA', name: 'Totally Different Corp', currency: 'USD', type: 'EQUITY' },
      { id: 'b', ticker: 'BBB', name: 'Another Different Co', currency: 'USD', type: 'EQUITY' }
    ]
  });
  assert.ok(['unresolved', 'ambiguous'].includes(result.resolutionStatus));
  assert.equal(result.requiresManualReview, true);
});

test('scored mapping with ticker-prefix-only evidence stays unresolved', () => {
  const db = { instrumentMappings: [], instrumentResolutionMetrics: [], t212MetadataCache: [] };
  const result = resolveAndUpsertTrading212InstrumentMapping(db, 'alice', {
    rawTicker: 'SNDK1_US_EQ',
    rawName: 'SANDISK CORPORATION',
    rawCurrency: 'USD'
  }, {
    instruments: [
      { id: 'a', ticker: 'SNDK', name: 'Sandvik AB', exchange: 'NYSE', currency: 'USD', type: 'EQUITY' },
      { id: 'b', ticker: 'SNDKW', name: 'Sundek Warrant', exchange: 'NYSE', currency: 'USD', type: 'EQUITY' }
    ]
  });
  assert.ok(['unresolved', 'ambiguous'].includes(result.resolutionStatus));
  assert.equal(result.canonicalTicker, '');
});

test('high-confidence cached mapping is reused', () => {
  const db = {
    instrumentMappings: [{
      id: 2,
      source_key: 'TRADING212|ISIN:US1234567890',
      scope: 'global',
      status: 'active',
      resolution_status: 'resolved',
      resolution_source: 'local_cache',
      confidence_score: 0.98,
      canonical_ticker: 'NVDA'
    }],
    instrumentResolutionMetrics: [],
    t212MetadataCache: []
  };
  const result = resolveAndUpsertTrading212InstrumentMapping(db, 'alice', {
    rawIsin: 'US1234567890',
    rawTicker: 'NVDA1_US_EQ',
    rawName: 'NVIDIA Corp'
  }, { instruments: [] });
  assert.equal(result.canonicalTicker, 'NVDA');
  assert.equal(result.resolutionSource, 'local_cache');
});

test('share-class and ADR distinctions are preserved in scoring', () => {
  const ranked = pickBestCandidate(
    { rawName: 'Acme Holdings Class B ADR', rawTicker: 'ACMB_US_EQ', rawCurrency: 'USD' },
    [
      { ticker: 'ACMA', name: 'Acme Holdings Class A ADR', currency: 'USD', isActive: true },
      { ticker: 'ACMB', name: 'Acme Holdings Class B ADR', currency: 'USD', isActive: true }
    ]
  );
  assert.equal(ranked.best.candidate.ticker, 'ACMB');
});

test('same-brand ETF names across exchanges use exchange hint', () => {
  const db = { instrumentMappings: [], instrumentResolutionMetrics: [], t212MetadataCache: [] };
  const result = resolveAndUpsertTrading212InstrumentMapping(db, 'alice', {
    rawTicker: 'QQQ_US_EQ',
    rawName: 'Invesco QQQ Trust',
    rawExchange: 'NASDAQ',
    rawCurrency: 'USD',
    rawInstrumentType: 'ETF'
  }, {
    instruments: [
      { id: 'uk', ticker: 'QQQ', name: 'Invesco QQQ Trust', exchange: 'LSE', currency: 'GBP', type: 'ETF' },
      { id: 'us', ticker: 'QQQ', name: 'Invesco QQQ Trust', exchange: 'NASDAQ', currency: 'USD', type: 'ETF' }
    ]
  });
  assert.ok(['resolved', 'ambiguous', 'unresolved'].includes(result.resolutionStatus));
  if (result.resolutionStatus === 'resolved') {
    assert.equal(result.canonicalExchange, 'NASDAQ');
  }
});

test('metadata conflicts do not overwrite manual/high-confidence mapping', () => {
  const db = {
    instrumentMappings: [{
      id: 3,
      source_key: 'TRADING212|ISIN:US9999999999',
      scope: 'global',
      status: 'active',
      resolution_status: 'resolved',
      resolution_source: 'local_cache',
      confidence_score: 0.97,
      canonical_ticker: 'OLD'
    }],
    instrumentResolutionMetrics: [],
    instrumentResolutionSummary: {},
    t212MetadataCache: []
  };
  const result = resolveAndUpsertTrading212InstrumentMapping(db, 'alice', {
    rawIsin: 'US9999999999',
    rawName: 'Old Name'
  }, {
    instruments: [{ isin: 'US9999999999', ticker: 'NEW', name: 'New Name', exchange: 'NASDAQ', currency: 'USD', type: 'EQUITY' }]
  });
  assert.equal(result.canonicalTicker, 'OLD');
  assert.equal(result.resolutionStatus, 'ambiguous');
  assert.equal(db.instrumentResolutionSummary.conflicting_remap_attempts, 1);
});

test('conflicting metadata clears stale canonical mapping instead of blindly reusing cache', () => {
  const db = {
    instrumentMappings: [{
      id: 4,
      source_key: 'TRADING212|ISIN:US1111111111',
      scope: 'global',
      status: 'active',
      resolution_status: 'resolved',
      resolution_source: 'local_cache',
      confidence_score: 0.97,
      canonical_ticker: 'OLD'
    }],
    instrumentResolutionMetrics: [],
    instrumentResolutionSummary: {},
    t212MetadataCache: []
  };
  const result = resolveAndUpsertTrading212InstrumentMapping(db, 'alice', {
    rawIsin: 'US1111111111',
    rawTicker: 'OLD1_US_EQ',
    rawName: 'Legacy Name',
    rawCurrency: 'USD'
  }, {
    instruments: [
      { isin: 'US1111111111', ticker: 'NEWA', name: 'New Name A', exchange: 'NASDAQ', currency: 'USD', type: 'EQUITY' },
      { isin: 'US1111111111', ticker: 'NEWB', name: 'New Name B', exchange: 'NASDAQ', currency: 'USD', type: 'EQUITY' }
    ]
  });
  assert.equal(result.resolutionStatus, 'ambiguous');
  assert.equal(result.requiresManualReview, true);
});

test('getDisplayInstrumentIdentity returns canonical identity when resolved', () => {
  const identity = getDisplayInstrumentIdentity({
    canonicalTicker: 'META',
    canonicalName: 'Meta Platforms',
    canonicalExchange: 'XNAS',
    resolutionStatus: 'resolved',
    resolutionSource: 't212_metadata_exact',
    trading212Ticker: 'FB_US_EQ'
  });
  assert.equal(identity.ticker, 'META');
  assert.equal(identity.displayTicker, 'META');
  assert.equal(identity.canonicalTicker, 'META');
  assert.equal(identity.rawTicker, 'FB_US_EQ');
  assert.equal(identity.requiresManualReview, false);
  assert.equal(identity.isCanonical, true);
  assert.equal(identity.resolutionStatus, 'resolved');
});

test('getDisplayInstrumentIdentity exposes unresolved state when using raw fallback', () => {
  const identity = getDisplayInstrumentIdentity({
    trading212Ticker: 'RAWTICK_US_EQ',
    trading212Name: 'Raw Name Co',
    resolutionStatus: 'unresolved'
  });
  assert.equal(identity.ticker, 'RAWTICK');
  assert.equal(identity.displayTicker, 'RAWTICK');
  assert.equal(identity.canonicalTicker, '');
  assert.equal(identity.rawTicker, 'RAWTICK_US_EQ');
  assert.equal(identity.requiresManualReview, true);
  assert.equal(identity.isCanonical, false);
  assert.equal(identity.resolutionStatus, 'unresolved');
});

test('getDisplayInstrumentIdentity prefers clean display fallback over raw broker ticker when unresolved', () => {
  const identity = getDisplayInstrumentIdentity({
    trading212Ticker: 'RCAT_US_EQ',
    displayTicker: 'RCAT',
    resolutionStatus: 'unresolved'
  });
  assert.equal(identity.displayTicker, 'RCAT');
  assert.equal(identity.isCanonical, false);
  assert.equal(identity.requiresManualReview, true);
});
