const test = require('node:test');
const assert = require('node:assert/strict');

const { createNewsPreferenceService } = require('../services/news/newsPreferenceService');

test('news preferences persist rankingMode with backwards-compatible default', () => {
  const db = { userNewsPreferences: [] };
  const service = createNewsPreferenceService({
    loadDB: () => db,
    saveDB: () => {},
    ensureNewsEventTables: (value) => {
      if (!Array.isArray(value.userNewsPreferences)) value.userNewsPreferences = [];
    },
    logger: { info: () => {} }
  });

  const initial = service.getUserNewsPreferences('alice');
  assert.equal(initial.rankingMode, 'balanced');

  const saved = service.saveUserNewsPreferences('alice', { rankingMode: 'strict_signal' });
  assert.equal(saved.rankingMode, 'strict_signal');

  const invalid = service.saveUserNewsPreferences('alice', { rankingMode: 'aggressive-random' });
  assert.equal(invalid.rankingMode, 'balanced');
});
