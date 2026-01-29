const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'dotenv') {
    return { config: () => ({}) };
  }
  return originalLoad(request, parent, isMain);
};

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
