const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseTrading212HistoryOrders,
  reconcileTrading212HistoricalExits
} = require('../server');

test('parseTrading212HistoryOrders keeps completed fills with actual fill price', () => {
  const parsed = parseTrading212HistoryOrders({
    items: [{
      id: 'order-1',
      fillId: 'fill-1',
      status: 'FILLED',
      side: 'SELL',
      filledQuantity: 2,
      fillPrice: 97.5,
      filledAt: '2026-03-01T10:30:00Z',
      instrument: { ticker: 'AAPL_US_EQ', isin: 'US0378331005' }
    }, {
      id: 'order-2',
      status: 'OPEN',
      side: 'SELL',
      quantity: 2,
      price: 99,
      instrument: { ticker: 'AAPL_US_EQ' }
    }]
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'order-1');
  assert.equal(parsed[0].fillPrice, 97.5);
  assert.equal(parsed[0].quantity, 2);
});

test('reconcileTrading212HistoricalExits imports partial then full closes idempotently', () => {
  const user = {
    tradeJournal: {
      '2026-02-28': [{
        id: 't1',
        source: 'trading212',
        status: 'open',
        direction: 'long',
        symbol: 'AAPL',
        trading212Ticker: 'AAPL_US_EQ',
        trading212Isin: 'US0378331005',
        trading212AccountId: 'acc-1',
        currency: 'USD',
        entry: 100,
        sizeUnits: 4
      }]
    }
  };
  const cfg = { historySync: { accounts: {} } };
  const payload = {
    orders: [{
      id: 'order-1',
      fillId: 'fill-1',
      side: 'SELL',
      status: 'FILLED',
      quantity: 2,
      fillPrice: 110,
      filledAt: '2026-03-01T11:00:00Z',
      instrumentTicker: 'AAPL_US_EQ',
      instrumentIsin: 'US0378331005'
    }, {
      id: 'order-2',
      fillId: 'fill-2',
      side: 'SELL',
      status: 'FILLED',
      quantity: 2,
      fillPrice: 120,
      filledAt: '2026-03-02T11:00:00Z',
      instrumentTicker: 'AAPL_US_EQ',
      instrumentIsin: 'US0378331005'
    }]
  };

  const first = reconcileTrading212HistoricalExits(user, cfg, payload, 'acc-1', { orders: [] }, { USD: 1 });
  const trade = user.tradeJournal['2026-02-28'][0];
  assert.equal(first.imported, 2);
  assert.equal(trade.status, 'closed');
  assert.equal(trade.sizeUnits, 0);
  assert.equal(trade.executions.filter(leg => leg.side === 'exit').length, 2);

  const second = reconcileTrading212HistoricalExits(user, cfg, payload, 'acc-1', { orders: [] }, { USD: 1 });
  assert.equal(second.imported, 0);
  assert.equal(trade.executions.filter(leg => leg.side === 'exit').length, 2);
});

test('reconcileTrading212HistoricalExits preserves option identity matching', () => {
  const user = {
    tradeJournal: {
      '2026-03-05': [{
        id: 'opt-1',
        source: 'trading212',
        status: 'open',
        direction: 'long',
        symbol: 'AAPL',
        trading212Ticker: 'AAPL_US_OPT',
        trading212AccountId: 'acc-1',
        currency: 'USD',
        entry: 2.5,
        sizeUnits: 1,
        optionType: 'call',
        optionStrike: 180,
        optionExpiration: '2026-06-19',
        optionMultiplier: 100
      }]
    }
  };
  const cfg = { historySync: { accounts: {} } };
  const payload = {
    orders: [{
      id: 'o-1',
      fillId: 'f-1',
      side: 'SELL',
      status: 'FILLED',
      quantity: 1,
      fillPrice: 3.1,
      filledAt: '2026-03-06T10:00:00Z',
      instrumentTicker: 'AAPL_US_OPT',
      optionType: 'call',
      optionStrike: 180,
      optionExpiration: '2026-06-19',
      optionMultiplier: 100
    }]
  };

  const result = reconcileTrading212HistoricalExits(user, cfg, payload, 'acc-1', { orders: [] }, { USD: 1 });
  const trade = user.tradeJournal['2026-03-05'][0];
  assert.equal(result.imported, 1);
  assert.equal(trade.status, 'closed');
  assert.equal(trade.optionMultiplier, 100);
});
