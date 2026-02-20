const test = require('node:test');
const assert = require('node:assert/strict');

const { upsertTrading212StopOrders } = require('../server');

test('upsertTrading212StopOrders keeps stop equal to provider currentStop when no manual override', () => {
  const user = {
    portfolio: 10000,
    tradeJournal: {
      '2026-02-20': [{
        id: 't1',
        source: 'trading212',
        symbol: 'SNDK',
        trading212Ticker: 'SNDK_US_EQ',
        entry: 619.74993721,
        stop: 596,
        currentStop: 596,
        currentStopSource: 't212',
        sizeUnits: 2.05981465,
        currency: 'GBP',
        direction: 'long',
        status: 'open'
      }]
    }
  };

  const ordersPayload = {
    orders: [{
      id: 'order-1',
      status: 'OPEN',
      side: 'SELL',
      type: 'STOP',
      quantity: -2.05981465,
      stopPrice: 590.1,
      instrumentTicker: 'SNDK_US_EQ'
    }]
  };

  const result = upsertTrading212StopOrders(user, ordersPayload, '', { GBP: 1 });
  const trade = user.tradeJournal['2026-02-20'][0];
  assert.equal(result.updated, 1);
  assert.equal(trade.currentStop, 590.1);
  assert.equal(trade.stop, 590.1);
  assert.ok(Number(trade.riskPct) > 0);
});

test('upsertTrading212StopOrders preserves manual stop override while updating currentStop', () => {
  const user = {
    portfolio: 10000,
    tradeJournal: {
      '2026-02-20': [{
        id: 't2',
        source: 'trading212',
        symbol: 'SNDK',
        trading212Ticker: 'SNDK_US_EQ',
        entry: 619.74993721,
        stop: 596,
        currentStop: 596,
        currentStopSource: 't212',
        stopManualOverride: true,
        sizeUnits: 2.05981465,
        currency: 'GBP',
        direction: 'long',
        status: 'open'
      }]
    }
  };

  const ordersPayload = {
    orders: [{
      id: 'order-2',
      status: 'OPEN',
      side: 'SELL',
      type: 'STOP',
      quantity: -2.05981465,
      stopPrice: 590.1,
      instrumentTicker: 'SNDK_US_EQ'
    }]
  };

  upsertTrading212StopOrders(user, ordersPayload, '', { GBP: 1 });
  const trade = user.tradeJournal['2026-02-20'][0];
  assert.equal(trade.currentStop, 590.1);
  assert.equal(trade.stop, 596);
});
