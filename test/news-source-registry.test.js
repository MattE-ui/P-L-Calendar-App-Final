const test = require('node:test');
const assert = require('node:assert/strict');

const { createNewsSourceRegistryService } = require('../services/news/newsSourceRegistry');

test('source registry upserts and defaults unknown source conservatively', () => {
  const db = {};
  const service = createNewsSourceRegistryService({
    loadDB: () => db,
    saveDB: () => {},
    ensureNewsEventTables: (value) => {
      if (!Array.isArray(value.newsSourceRegistry)) value.newsSourceRegistry = [];
    }
  });

  const inserted = service.upsertSource('TrustedWire', { trustTier: 'high', priorityBoost: 8, isAllowed: true, isMuted: false });
  assert.equal(inserted.trustTier, 'high');

  const unknown = service.getSourceProfile('UnlistedSource');
  assert.equal(unknown.trustTier, 'low');
  assert.equal(unknown.isAllowed, true);
  assert.equal(unknown.isMuted, false);

  const listed = service.listSources();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].sourceName, 'TrustedWire');
});
