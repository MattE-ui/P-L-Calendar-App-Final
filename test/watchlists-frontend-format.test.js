const test = require('node:test');
const assert = require('node:assert');

const { toFiniteDisplayNumber, formatWatchlistValue } = require('../static/watchlists.js');

test('toFiniteDisplayNumber preserves nullish values as null instead of coercing to zero', () => {
  assert.equal(toFiniteDisplayNumber(null), null);
  assert.equal(toFiniteDisplayNumber(undefined), null);
  assert.equal(toFiniteDisplayNumber(''), null);
  assert.equal(toFiniteDisplayNumber('0'), 0);
  assert.equal(toFiniteDisplayNumber(0), 0);
});

test('formatWatchlistValue renders missing values as em dash and real zeros correctly', () => {
  assert.equal(formatWatchlistValue(null, 'price'), '—');
  assert.equal(formatWatchlistValue(undefined, 'pct'), '—');
  assert.equal(formatWatchlistValue('', 'volume'), '—');
  assert.equal(formatWatchlistValue(0, 'price'), '$0.0000');
  assert.equal(formatWatchlistValue(0, 'pct'), '0.00%');
  assert.equal(formatWatchlistValue(0, 'volume'), '0');
});
