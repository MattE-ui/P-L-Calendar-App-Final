const test = require('node:test');
const assert = require('node:assert');
const {
  summarizeTrades,
  equityCurve,
  drawdowns,
  distribution,
  streaks
} = require('../lib/analytics');

test('summarizeTrades handles empty input', () => {
  const result = summarizeTrades([]);
  assert.equal(result.total, 0);
  assert.equal(result.winRate, 0);
  assert.equal(result.expectancy, 0);
  assert.equal(result.profitFactor, null);
});

test('summarizeTrades calculates win/loss and expectancy', () => {
  const trades = [
    { realizedPnlGBP: 100, riskAmountGBP: 50 },
    { realizedPnlGBP: -50, riskAmountGBP: 25 },
    { realizedPnlGBP: 0, riskAmountGBP: 10 }
  ];
  const result = summarizeTrades(trades);
  assert.equal(result.total, 3);
  assert.equal(result.wins, 1);
  assert.equal(result.losses, 1);
  assert.ok(result.winRate > 0 && result.winRate < 1);
  assert.equal(result.avgWin, 100);
  assert.equal(result.avgLoss, 50);
  assert.equal(result.avgR, 0); // Balanced positive and negative R plus a flat trade
});

test('equity curve and drawdown detect trough', () => {
  const trades = [
    { closeDate: '2024-01-01', realizedPnlGBP: 100 },
    { closeDate: '2024-01-02', realizedPnlGBP: -200 },
    { closeDate: '2024-01-03', realizedPnlGBP: 150 }
  ];
  const curve = equityCurve(trades);
  assert.equal(curve[curve.length - 1].cumulative, 50);
  const dd = drawdowns(curve);
  assert.ok(dd.maxDrawdown < 0);
  assert.equal(dd.durationDays >= 1, true);
});

test('distribution summarises best and worst', () => {
  const trades = [
    { realizedPnlGBP: -10 },
    { realizedPnlGBP: 20 },
    { realizedPnlGBP: 30 }
  ];
  const dist = distribution(trades, 4);
  assert.equal(dist.best, 30);
  assert.equal(dist.worst, -10);
  assert.equal(dist.histogram.length, 4);
});

test('streaks counts wins and losses', () => {
  const trades = [
    { closeDate: '2024-01-01', realizedPnlGBP: 10 },
    { closeDate: '2024-01-02', realizedPnlGBP: 20 },
    { closeDate: '2024-01-03', realizedPnlGBP: -5 },
    { closeDate: '2024-01-04', realizedPnlGBP: -7 },
    { closeDate: '2024-01-05', realizedPnlGBP: 3 }
  ];
  const streak = streaks(trades);
  assert.equal(streak.maxWinStreak, 2);
  assert.equal(streak.maxLossStreak, 2);
});
