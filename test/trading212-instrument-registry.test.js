const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensureInstrumentRegistry,
  upsertRegistryEntry,
  applyRegistryResolution,
  lookupCanonicalInstrument,
  getDisplayInstrumentIdentity,
  findRegistryEntry
} = require('../server');

function baseDb() {
  return {
    users: {},
    sessions: {},
    brokerInstrumentRegistry: [],
    instrumentResolutionHistory: [],
    instrumentMappings: []
  };
}

test('registry creation for unseen Trading 212 instrument', () => {
  const db = baseDb();
  const { entry, created } = upsertRegistryEntry(db, {
    broker: 'trading212',
    brokerInstrumentId: 'acct-1:123',
    rawTicker: 'LWLG_US_EQ',
    rawName: 'Lightwave Logic',
    isin: 'US5322751042',
    rawCurrency: 'USD'
  });
  assert.equal(created, true);
  assert.equal(entry.brokerInstrumentId, 'acct-1:123');
  assert.equal(entry.rawTicker, 'LWLG_US_EQ');
  assert.equal(ensureInstrumentRegistry(db).length, 1);
});

test('ISIN-first resolution reuses trusted registry mapping', async () => {
  const db = baseDb();
  const { entry } = upsertRegistryEntry(db, {
    broker: 'trading212',
    brokerInstrumentId: 'old-1',
    rawTicker: 'OLD_US_EQ',
    rawName: 'Sample Co',
    isin: 'US1111111111',
    rawCurrency: 'USD'
  });
  applyRegistryResolution(db, entry, {
    canonicalTicker: 'SAMP',
    canonicalName: 'Sample Co',
    status: 'resolved',
    resolutionSource: 'isin_lookup',
    confidenceScore: 0.95
  }, 'seed', 'test');

  const result = await lookupCanonicalInstrument({
    broker: 'trading212',
    rawName: 'Sample Co',
    isin: 'US1111111111',
    rawCurrency: 'USD'
  }, db);

  assert.equal(result.canonicalTicker, 'SAMP');
  assert.equal(result.resolutionSource, 'isin_lookup');
  assert.equal(result.status, 'resolved');
});

test('name-based lookup path supports renamed ticker aliases', async () => {
  const db = baseDb();
  const result = await lookupCanonicalInstrument({
    broker: 'trading212',
    rawTicker: 'SOI_US_EQ',
    rawName: 'Solaris Energy Infrastructure',
    rawCurrency: 'USD'
  }, db);
  assert.equal(result.canonicalTicker, 'SEI');
  assert.equal(result.resolutionSource, 'name_lookup');
});

test('lookup remains unresolved when confidence is weak', async () => {
  const db = baseDb();
  const result = await lookupCanonicalInstrument({
    broker: 'trading212',
    rawTicker: '',
    rawName: '',
    isin: '',
    rawCurrency: 'USD'
  }, db);
  assert.equal(result.status, 'unresolved');
  assert.equal(result.canonicalTicker, '');
});

test('manual override precedence is preserved', () => {
  const db = baseDb();
  const { entry } = upsertRegistryEntry(db, {
    broker: 'trading212',
    brokerInstrumentId: 'x1',
    rawTicker: 'YNDX_US_EQ',
    rawName: 'Nebius Group',
    rawCurrency: 'USD'
  });
  entry.manualOverride = true;
  applyRegistryResolution(db, entry, {
    canonicalTicker: 'NBIS',
    canonicalName: 'Nebius Group',
    status: 'manual_override',
    resolutionSource: 'manual_override',
    confidenceScore: 1
  }, 'manual_override', 'admin');

  const identity = getDisplayInstrumentIdentity({
    source: 'trading212',
    trading212Id: 'x1',
    trading212Ticker: 'YNDX_US_EQ',
    trading212Name: 'Nebius Group',
    currency: 'USD'
  }, db, 'tester');

  assert.equal(identity.displayTicker, 'NBIS');
  assert.equal(identity.resolutionStatus, 'manual_override');
  assert.equal(identity.isCanonical, true);
});

test('display helper uses canonical ticker when resolved and safe fallback when unresolved', () => {
  const db = baseDb();
  const { entry } = upsertRegistryEntry(db, {
    broker: 'trading212',
    brokerInstrumentId: 'acct:1',
    rawTicker: 'RAW_US_EQ',
    rawName: 'Raw Co',
    rawCurrency: 'USD'
  });
  applyRegistryResolution(db, entry, {
    canonicalTicker: 'GOOD',
    canonicalName: 'Good Co',
    status: 'resolved',
    resolutionSource: 'name_lookup',
    confidenceScore: 0.8
  }, 'resolve', 'test');

  const resolvedIdentity = getDisplayInstrumentIdentity({
    source: 'trading212',
    trading212Id: 'acct:1',
    trading212Ticker: 'RAW_US_EQ',
    symbol: 'RAW',
    currency: 'USD'
  }, db, 'tester');
  assert.equal(resolvedIdentity.displayTicker, 'GOOD');
  assert.equal(resolvedIdentity.isCanonical, true);

  const unresolvedIdentity = getDisplayInstrumentIdentity({
    source: 'trading212',
    trading212Id: 'acct:2',
    trading212Ticker: 'MYST_US_EQ',
    symbol: 'MYST',
    currency: 'USD'
  }, db, 'tester');
  assert.equal(unresolvedIdentity.displayTicker, 'MYST');
  assert.equal(unresolvedIdentity.isCanonical, false);
});

test('backfill-style upsert keeps uncertain cases unresolved and preserves raw broker fields', () => {
  const db = baseDb();
  const { entry } = upsertRegistryEntry(db, {
    broker: 'trading212',
    brokerInstrumentId: 'acct:legacy',
    rawTicker: 'LEGACY_US_EQ',
    rawName: 'Legacy Holdings',
    rawCurrency: 'USD'
  });
  assert.equal(entry.rawTicker, 'LEGACY_US_EQ');
  assert.equal(entry.rawName, 'Legacy Holdings');
  assert.equal(entry.resolutionStatus, 'unresolved');

  const found = findRegistryEntry(db, {
    broker: 'trading212',
    brokerInstrumentId: 'acct:legacy',
    rawTicker: 'LEGACY_US_EQ',
    rawCurrency: 'USD'
  });
  assert.equal(found.id, entry.id);
});

test('renamed ticker examples resolve with shared alias mechanism', async () => {
  const db = baseDb();
  const soi = await lookupCanonicalInstrument({ broker: 'trading212', rawTicker: 'SOI_US_EQ', rawName: 'Solaris', rawCurrency: 'USD' }, db);
  const yndx = await lookupCanonicalInstrument({ broker: 'trading212', rawTicker: 'YNDX_US_EQ', rawName: 'Nebius Group', rawCurrency: 'USD' }, db);
  assert.equal(soi.canonicalTicker, 'SEI');
  assert.equal(yndx.canonicalTicker, 'NBIS');
});
