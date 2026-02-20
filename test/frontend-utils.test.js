const test = require('node:test');
const assert = require('node:assert');

const { computeRiskPlan, summarizeWeek, computeAverageChangePercent } = require('../static/script.js');

test('computeRiskPlan supports long vs short and fees', () => {
  const long = computeRiskPlan({
    entry: 10,
    stop: 9,
    portfolio: 10000,
    riskPct: 1,
    fees: 5,
    slippage: 0.1,
    direction: 'long',
    allowFractional: false
  });
  assert.ok(!long.error);
  assert.ok(long.shares > 0);
  assert.ok(long.unusedRisk >= 0);

  const short = computeRiskPlan({
    entry: 10,
    stop: 11,
    portfolio: 10000,
    riskPct: 1,
    fees: 5,
    slippage: 0.1,
    direction: 'short',
    allowFractional: true
  });
  assert.ok(!short.error);
  assert.ok(short.shares > 0);
});

test('computeRiskPlan validates invalid direction stops', () => {
  const bad = computeRiskPlan({
    entry: 10,
    stop: 9.5,
    portfolio: 10000,
    riskPct: 1,
    direction: 'short'
  });
  assert.ok(bad.error);
});

test('summarizeWeek totals cash and trades', () => {
  const result = summarizeWeek([
    { change: 10, cashFlow: 5, tradesCount: 2 },
    { change: -5, cashFlow: 0, tradesCount: 1 }
  ]);
  assert.equal(result.totalChange, 5);
  assert.equal(result.totalCashFlow, 5);
  assert.equal(result.totalTrades, 3);
});

test('computeAverageChangePercent uses latest portfolio value as denominator', () => {
  const pct = computeAverageChangePercent(154, 18989.11);
  assert.ok(Math.abs(pct - 0.8109937) < 0.0001);
});

test('computeAverageChangePercent handles invalid denominators', () => {
  assert.equal(computeAverageChangePercent(10, 0), null);
  assert.equal(computeAverageChangePercent(10, null), null);
});
