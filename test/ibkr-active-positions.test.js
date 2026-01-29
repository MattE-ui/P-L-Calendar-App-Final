const test = require('node:test');
const assert = require('node:assert/strict');

require('./support/mock-server-deps');

const { buildIbkrActivePositionSummaries } = require('../server');

test('buildIbkrActivePositionSummaries filters inactive and computes percent', () => {
  const positions = [
    {
      position: 0,
      avgCost: 12,
      description: 'ZERO',
      unrealizedPnl: 0,
      marketPrice: 12
    },
    {
      position: 115,
      avgCost: 17.268695652173914,
      description: 'CIFR',
      unrealizedPnl: 55.35,
      marketPrice: 17.75,
      currency: 'USD',
      conid: '511470142'
    }
  ];

  const result = buildIbkrActivePositionSummaries(positions);
  assert.equal(result.length, 1);
  const entry = result[0];
  assert.equal(entry.symbol, 'CIFR');
  assert.equal(entry.position, 115);
  const expectedBasis = Math.abs(115) * 17.268695652173914;
  const expectedPct = (55.35 / expectedBasis) * 100;
  assert.ok(Math.abs(entry.unrealizedPct - expectedPct) < 0.001);
  assert.ok(Math.abs(entry.marketValue - (115 * 17.75)) < 0.001);
});
