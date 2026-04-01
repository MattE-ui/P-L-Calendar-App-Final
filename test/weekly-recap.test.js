const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateWeeklyRecap } = require('../server');

function buildUserWithTrades(trades = []) {
  return {
    username: 'tester',
    tradeJournal: {
      '2026-03-23': trades
    },
    portfolioHistory: {
      '2026-03': {
        '2026-03-22': { end: 10000, cashIn: 0, cashOut: 0 },
        '2026-03-29': { end: 10200, cashIn: 100, cashOut: 0 }
      }
    }
  };
}

test('calculateWeeklyRecap returns expected metrics for mixed closed trades', () => {
  const user = buildUserWithTrades([
    {
      id: 't1',
      symbol: 'AAPL',
      direction: 'long',
      entryValue: 1000,
      executions: [
        { side: 'entry', quantity: 10, price: 100, date: '2026-03-24' },
        { side: 'exit', quantity: 10, price: 112, date: '2026-03-24' }
      ]
    },
    {
      id: 't2',
      symbol: 'TSLA',
      direction: 'short',
      entryValue: 500,
      executions: [
        { side: 'entry', quantity: 10, price: 100, date: '2026-03-26' },
        { side: 'exit', quantity: 10, price: 105, date: '2026-03-26' }
      ]
    },
    { id: 't3', symbol: 'MSFT', status: 'open', closeDate: '2026-03-27', realizedPnlGBP: 100 }
  ]);

  const recap = calculateWeeklyRecap(user, {
    weekKey: '2026-03-23',
    weekStart: '2026-03-23',
    weekEnd: '2026-03-29'
  }, { GBP: 1 });

  assert.equal(recap.metrics.closedTrades, 2);
  assert.equal(recap.metrics.netPnlGBP, 70);
  assert.equal(recap.metrics.weeklyRealisedPnlGBP, 70);
  assert.equal(Number(recap.metrics.winRatePct.toFixed(2)), 50.00);
  assert.equal(Number(recap.metrics.closedTradeReturnPct.toFixed(2)), 4.67);
  assert.equal(Number(recap.metrics.portfolioReturnPct.toFixed(2)), 1.00);
  assert.equal(recap.metrics.bestTrade.ticker, 'AAPL');
  assert.equal(recap.metrics.worstTrade.ticker, 'TSLA');
  assert.equal(recap.notes, 'Profitable week driven by strong average winners.');
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
