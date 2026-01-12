const test = require('node:test');
const assert = require('node:assert');

const {
  formatROI,
  formatR,
  formatDate
} = require('../static/trade-card.js');

test('formatROI formats percent values with sign', () => {
  assert.equal(formatROI(41.36), '+41.36%');
  assert.equal(formatROI(-12.04), '-12.04%');
  assert.equal(formatROI(null), '—');
});

test('formatR formats R-multiple values with sign', () => {
  assert.equal(formatR(6.2), '+6.2R');
  assert.equal(formatR(-1.4), '-1.4R');
  assert.equal(formatR(2), '+2R');
  assert.equal(formatR(undefined), '—');
});

test('formatDate formats ISO dates', () => {
  assert.equal(formatDate('2024-04-23'), 'Apr 23, 2024');
  assert.equal(formatDate(null), '—');
});
