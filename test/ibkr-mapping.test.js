const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractIbkrPortfolioValue,
  mapIbkrPosition,
  parseIbkrOrders,
  matchIbkrStopOrderForTrade
} = require('../server');

test('extractIbkrPortfolioValue reads NetLiquidation from summary array', () => {
  const summary = [{ tag: 'NetLiquidation', value: '125000.50' }];
  const value = extractIbkrPortfolioValue(summary);
  assert.equal(value, 125000.5);
});

test('mapIbkrPosition maps core fields', () => {
  const raw = {
    ticker: 'AAPL',
    position: 10,
    avgPrice: 190.25,
    unrealizedPnl: 55.5,
    currency: 'USD',
    mktPrice: 195.8,
    conid: 265598
  };
  const mapped = mapIbkrPosition(raw);
  assert.equal(mapped.ticker, 'AAPL');
  assert.equal(mapped.units, 10);
  assert.equal(mapped.buyPrice, 190.25);
  assert.equal(mapped.pnlValue, 55.5);
  assert.equal(mapped.currency, 'USD');
  assert.equal(mapped.livePrice, 195.8);
  assert.equal(mapped.conid, '265598');
});

test('parseIbkrOrders filters to open SELL stop orders', () => {
  const payload = {
    orders: [
      {
        orderId: '1',
        ticker: 'MSFT',
        orderType: 'STP',
        status: 'Submitted',
        side: 'SELL',
        auxPrice: '300',
        totalQuantity: '-15',
        conid: '1234'
      },
      {
        orderId: '2',
        ticker: 'MSFT',
        orderType: 'LMT',
        status: 'Submitted',
        side: 'SELL',
        auxPrice: '310',
        totalQuantity: '-15',
        conid: '1234'
      }
    ]
  };
  const parsed = parseIbkrOrders(payload);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, '1');
  assert.equal(parsed[0].stopPrice, 300);
});

test('matchIbkrStopOrderForTrade prefers conid match', () => {
  const trade = {
    id: 'trade-1',
    sizeUnits: 10,
    ibkrConid: '9999'
  };
  const orders = [
    {
      id: 'order-1',
      instrumentTicker: 'TSLA',
      conid: '1111',
      stopPrice: 190,
      type: 'STOP',
      status: 'SUBMITTED',
      side: 'SELL',
      quantity: -10,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'order-2',
      instrumentTicker: 'TSLA',
      conid: '9999',
      stopPrice: 180,
      type: 'STOP',
      status: 'SUBMITTED',
      side: 'SELL',
      quantity: -10,
      createdAt: '2024-01-02T00:00:00Z'
    }
  ];
  const matched = matchIbkrStopOrderForTrade(trade, orders);
  assert.equal(matched.id, 'order-2');
});
