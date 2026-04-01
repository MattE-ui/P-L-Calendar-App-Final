const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateWeeklyRecap } = require('../server');

function buildUserWithTrades(trades = []) {
  return {
    username: 'tester',
    tradeJournal: {
      '2026-03-23': trades
    }
  };
}

test('calculateWeeklyRecap returns expected metrics for mixed closed trades', () => {
  const user = buildUserWithTrades([
    { id: 't1', symbol: 'AAPL', status: 'closed', closeDate: '2026-03-24', realizedPnlGBP: 120, direction: 'long' },
    { id: 't2', symbol: 'TSLA', status: 'closed', closeDate: '2026-03-26', realizedPnlGBP: -50, direction: 'short' },
    { id: 't3', symbol: 'MSFT', status: 'open', closeDate: '2026-03-27', realizedPnlGBP: 100 }
  ]);

  const recap = calculateWeeklyRecap(user, {
    weekKey: '2026-03-23',
    weekStart: '2026-03-23',
    weekEnd: '2026-03-29'
  }, { GBP: 1 });

  assert.equal(recap.metrics.closedTrades, 2);
  assert.equal(recap.metrics.netPnlGBP, 70);
  assert.equal(Number(recap.metrics.winRatePct.toFixed(2)), 50.00);
  assert.equal(recap.metrics.bestTrade.ticker, 'AAPL');
  assert.equal(recap.metrics.worstTrade.ticker, 'TSLA');
  assert.equal(recap.notes, 'Profitable week overall.');
});

test('calculateWeeklyRecap handles no closed trades', () => {
  const user = buildUserWithTrades([
    { id: 't1', symbol: 'AAPL', status: 'open', closeDate: '2026-03-24', realizedPnlGBP: 120, direction: 'long' }
  ]);

  const recap = calculateWeeklyRecap(user, {
    weekKey: '2026-03-23',
    weekStart: '2026-03-23',
    weekEnd: '2026-03-29'
  }, { GBP: 1 });

  assert.equal(recap.metrics.closedTrades, 0);
  assert.equal(recap.metrics.netPnlGBP, 0);
  assert.equal(recap.metrics.winRatePct, null);
  assert.equal(recap.metrics.bestTrade, null);
  assert.equal(recap.notes, 'No closed trades were recorded for this week.');
});
