const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseTrading212Orders,
  matchStopOrderForTrade
} = require('../server');

test('parseTrading212Orders filters to open SELL stop orders', () => {
  const payload = [
    {
      id: '1',
      instrument: { ticker: 'SNDK1_US_EQ', isin: 'US0000000001' },
      side: 'SELL',
      type: 'STOP',
      status: 'OPEN',
      stopPrice: '12.34',
      quantity: '-10',
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: '2',
      instrument: { ticker: 'SNDK1_US_EQ' },
      side: 'BUY',
      type: 'STOP',
      status: 'OPEN',
      stopPrice: '9.87',
      quantity: '5'
    },
    {
      id: '3',
      instrument: { ticker: 'SNDK1_US_EQ' },
      side: 'SELL',
      type: 'LIMIT',
      status: 'OPEN',
      stopPrice: '8.76',
      quantity: '-5'
    }
  ];
  const parsed = parseTrading212Orders(payload);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, '1');
  assert.equal(parsed[0].instrumentTicker, 'SNDK1_US_EQ');
  assert.equal(parsed[0].stopPrice, 12.34);
});

test('matchStopOrderForTrade matches Trading 212 instrument ticker and closest quantity', () => {
  const trade = {
    id: 'trade-1',
    sizeUnits: 100,
    trading212Ticker: 'BBAI1_US_EQ'
  };
  const orders = [
    {
      id: 'g1',
      instrumentTicker: 'GIG_US_EQ',
      stopPrice: 10.55,
      type: 'STOP',
      status: 'OPEN',
      side: 'SELL',
      quantity: -5,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'b1',
      instrumentTicker: 'BBAI1_US_EQ',
      stopPrice: 6.19,
      type: 'STOP',
      status: 'OPEN',
      side: 'SELL',
      quantity: -100,
      createdAt: '2024-01-02T00:00:00Z'
    }
  ];
  const matched = matchStopOrderForTrade(trade, orders);
  assert.equal(matched.id, 'b1');
});

test('matchStopOrderForTrade honors stored Trading 212 stop order id', () => {
  const trade = {
    id: 'trade-2',
    sizeUnits: 50,
    trading212Ticker: 'SNDK1_US_EQ',
    t212StopOrderId: 'order-42'
  };
  const orders = [
    {
      id: 'order-42',
      instrumentTicker: 'SNDK1_US_EQ',
      stopPrice: 5.5,
      type: 'STOP',
      status: 'OPEN',
      side: 'SELL',
      quantity: -50,
      createdAt: '2024-01-03T00:00:00Z'
    },
    {
      id: 'order-99',
      instrumentTicker: 'SNDK1_US_EQ',
      stopPrice: 4.4,
      type: 'STOP',
      status: 'OPEN',
      side: 'SELL',
      quantity: -50,
      createdAt: '2024-01-04T00:00:00Z'
    }
  ];
  const matched = matchStopOrderForTrade(trade, orders);
  assert.equal(matched.id, 'order-42');
});

test('matchStopOrderForTrade prefers exact quantity match for layered trade', () => {
  const trade = {
    id: 'trade-layer',
    sizeUnits: 0.02,
    trading212Ticker: 'ICHR_US_EQ'
  };
  const orders = [
    {
      id: 'combined',
      instrumentTicker: 'ICHR_US_EQ',
      stopPrice: 22.1,
      type: 'STOP',
      status: 'OPEN',
      side: 'SELL',
      quantity: -0.07,
      createdAt: '2025-01-01T00:00:00Z'
    },
    {
      id: 'exact-layer',
      instrumentTicker: 'ICHR_US_EQ',
      stopPrice: 21.5,
      type: 'STOP',
      status: 'OPEN',
      side: 'SELL',
      quantity: -0.02,
      createdAt: '2025-01-02T00:00:00Z'
    }
  ];
  const matched = matchStopOrderForTrade(trade, orders, {
    relatedTrades: [trade, { id: 'orig', sizeUnits: 0.05, trading212Ticker: 'ICHR_US_EQ' }]
  });
  assert.equal(matched?.id, 'exact-layer');
});

test('matchStopOrderForTrade falls back to combined quantity stop across related layers', () => {
  const trade = {
    id: 'trade-layer',
    sizeUnits: 0.02,
    trading212Ticker: 'ICHR_US_EQ'
  };
  const orders = [
    {
      id: 'combined',
      instrumentTicker: 'ICHR_US_EQ',
      stopPrice: 22.1,
      type: 'STOP',
      status: 'OPEN',
      side: 'SELL',
      quantity: -0.07,
      createdAt: '2025-01-01T00:00:00Z'
    }
  ];
  const matched = matchStopOrderForTrade(trade, orders, {
    relatedTrades: [trade, { id: 'orig', sizeUnits: 0.05, trading212Ticker: 'ICHR_US_EQ' }]
  });
  assert.equal(matched?.id, 'combined');
});
