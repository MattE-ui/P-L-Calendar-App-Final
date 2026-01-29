const test = require('node:test');
const assert = require('node:assert/strict');

require('./support/mock-server-deps');

const { updateIbkrLivePositions } = require('../server');

test('updateIbkrLivePositions upserts one entry per symbol', () => {
  const user = { ibkr: {} };
  const snapshot = {
    positions: [
      { ticker: 'AAPL', units: 10, buyPrice: 100, pnlValue: 5, currency: 'USD', livePrice: 105, conid: '123' }
    ]
  };
  updateIbkrLivePositions(user, snapshot, {});
  assert.equal(user.ibkr.livePositions.length, 1);
  updateIbkrLivePositions(user, snapshot, {});
  assert.equal(user.ibkr.livePositions.length, 1);
});

test('updateIbkrLivePositions removes stale symbols', () => {
  const user = { ibkr: {} };
  const snapshot = {
    positions: [
      { ticker: 'AAPL', units: 10, buyPrice: 100, pnlValue: 5, currency: 'USD', livePrice: 105, conid: '123' }
    ]
  };
  updateIbkrLivePositions(user, snapshot, {});
  assert.equal(user.ibkr.livePositions.length, 1);
  updateIbkrLivePositions(user, { positions: [] }, {});
  assert.equal(user.ibkr.livePositions.length, 0);
});
