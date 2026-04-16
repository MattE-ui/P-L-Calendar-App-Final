const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {
  DEBUG_PORTFOLIO: false,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  PerfDiagnostics: null,
  AppBootstrap: null
};
global.document = global.document || {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: () => {},
  body: { classList: { add: () => {}, remove: () => {}, toggle: () => {} } },
  createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } })
};
global.localStorage = global.localStorage || {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

const { computeRiskPlan, summarizeWeek, computeAverageChangePercent, resolveRiskStopFromSources } = require('../static/script.js');

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

test('resolveRiskStopFromSources updates low-of-day fallback as lows decrease and does not rise on rebound', () => {
  const first = resolveRiskStopFromSources({
    sessionLow: 84.46,
    openPrice: 84.46
  });
  assert.equal(first.stop, 84.46);
  assert.equal(first.source, 'fallback_low_of_day');

  const second = resolveRiskStopFromSources({
    sessionLow: 83.20,
    openPrice: 84.46,
    previousResolvedStop: first.stop
  });
  assert.equal(second.stop, 83.20);

  const third = resolveRiskStopFromSources({
    sessionLow: 81.07,
    openPrice: 84.46,
    previousResolvedStop: second.stop
  });
  assert.equal(third.stop, 81.07);

  const rebound = resolveRiskStopFromSources({
    sessionLow: 81.07,
    openPrice: 84.46,
    previousResolvedStop: third.stop
  });
  assert.equal(rebound.stop, 81.07);
});

test('resolveRiskStopFromSources gives manual and explicit alert stops precedence over fallback', () => {
  const manual = resolveRiskStopFromSources({
    manualStop: 82.5,
    alertStop: 81.0,
    sessionLow: 80.0,
    openPrice: 84.46
  });
  assert.equal(manual.source, 'manual');
  assert.equal(manual.stop, 82.5);

  const alert = resolveRiskStopFromSources({
    alertStop: 81.0,
    sessionLow: 80.0,
    openPrice: 84.46
  });
  assert.equal(alert.source, 'alert');
  assert.equal(alert.stop, 81.0);
});

test('resolveRiskStopFromSources never lets stale open override lower valid session low', () => {
  const resolved = resolveRiskStopFromSources({
    sessionLow: 81.07,
    openPrice: 84.46
  });
  assert.equal(resolved.stop, 81.07);
  assert.equal(resolved.source, 'fallback_low_of_day');
});
