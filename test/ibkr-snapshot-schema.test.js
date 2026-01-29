const test = require('node:test');
const assert = require('node:assert/strict');
require('./support/mock-server-deps');

const { ibkrSnapshotSchema } = require('../server');

test('ibkrSnapshotSchema requires rootCurrency', () => {
  const invalid = ibkrSnapshotSchema.safeParse({
    accountId: 'U123',
    portfolioValue: 1000,
    positions: []
  });
  assert.equal(invalid.success, false);
});

test('ibkrSnapshotSchema accepts minimal valid payload', () => {
  const valid = ibkrSnapshotSchema.safeParse({
    accountId: 'U123',
    portfolioValue: 1000,
    rootCurrency: 'USD',
    positions: [],
    orders: []
  });
  assert.equal(valid.success, true);
});
