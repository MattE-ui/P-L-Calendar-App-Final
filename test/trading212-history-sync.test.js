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

test('parseTrading212HistoryOrders parses native fill object fields', () => {
  const parsed = parseTrading212HistoryOrders({
    items: [{
      id: 'order-native-1',
      status: 'FILLED',
      side: 'BUY',
      type: 'MARKET',
      instrument: { ticker: 'NVDA_US_EQ', isin: 'US67066G1040', uid: 'inst-1' },
      fill: {
        id: 'fill-native-1',
        price: 121.33,
        quantity: 3,
        filledAt: '2026-03-03T14:00:00Z'
      },
      walletImpact: { value: -363.99 }
    }]
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].order.id, 'order-native-1');
  assert.equal(parsed[0].order.side, 'BUY');
  assert.equal(parsed[0].order.type, 'MARKET');
  assert.equal(parsed[0].fill.id, 'fill-native-1');
  assert.equal(parsed[0].fill.price, 121.33);
  assert.equal(parsed[0].fill.quantity, 3);
  assert.equal(parsed[0].fill.filledAt, '2026-03-03T14:00:00Z');
  assert.equal(parsed[0].walletImpact, -363.99);
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
  assert.equal(first.importedFillEvents.length, 2);
  assert.equal(first.importedFillEvents[0].side, 'SELL');
  assert.equal(trade.status, 'closed');
  assert.equal(trade.sizeUnits, 0);
  assert.equal(trade.executions.filter(leg => leg.side === 'exit').length, 2);

  const second = reconcileTrading212HistoricalExits(user, cfg, payload, 'acc-1', { orders: [] }, { USD: 1 });
  assert.equal(second.imported, 0);
  assert.equal(second.importedFillEvents.length, 0);
  assert.equal(trade.executions.filter(leg => leg.side === 'exit').length, 2);
});

test('reconcileTrading212HistoricalExits emits buy fill events even without open trade match', () => {
  const user = { tradeJournal: {} };
  const cfg = { historySync: { accounts: {} } };
  const payload = {
    orders: [{
      id: 'buy-1',
      fillId: 'fill-buy-1',
      side: 'BUY',
      status: 'FILLED',
      quantity: 3,
      fillPrice: 33.5,
      filledAt: '2026-03-03T11:00:00Z',
      instrumentTicker: 'MSFT_US_EQ'
    }]
  };
  const result = reconcileTrading212HistoricalExits(user, cfg, payload, 'acc-1', { orders: [] }, { USD: 1 });
  assert.equal(result.imported, 0);
  assert.equal(result.importedFillEvents.length, 1);
  assert.equal(result.importedFillEvents[0].fillId, 'fill-buy-1');
  assert.equal(result.importedFillEvents[0].side, 'BUY');
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

test('reconcileTrading212HistoricalExits coalesces multiple trim fills into weighted average price', () => {
  const user = {
    tradeJournal: {
      '2026-03-01': [{
        id: 't-coalesce',
        source: 'trading212',
        status: 'open',
        direction: 'long',
        symbol: 'AAPL',
        trading212Ticker: 'AAPL_US_EQ',
        trading212Isin: 'US0378331005',
        trading212AccountId: 'acc-1',
        currency: 'USD',
        entry: 100,
        sizeUnits: 10
      }]
    }
  };
  const cfg = { historySync: { accounts: {} } };
  const payload = {
    orders: [{
      id: 'order-same',
      fillId: 'fill-a',
      side: 'SELL',
      status: 'FILLED',
      quantity: 2,
      fillPrice: 110,
      filledAt: '2026-03-03T10:00:00Z',
      instrumentTicker: 'AAPL_US_EQ',
      instrumentIsin: 'US0378331005'
    }, {
      id: 'order-same',
      fillId: 'fill-b',
      side: 'SELL',
      status: 'FILLED',
      quantity: 3,
      fillPrice: 112,
      filledAt: '2026-03-03T10:00:10Z',
      instrumentTicker: 'AAPL_US_EQ',
      instrumentIsin: 'US0378331005'
    }]
  };
  const result = reconcileTrading212HistoricalExits(user, cfg, payload, 'acc-1', { orders: [] }, { USD: 1 });
  const trade = user.tradeJournal['2026-03-01'][0];
  assert.equal(result.imported, 1);
  assert.equal(result.importedFillEvents.length, 1);
  const exit = trade.executions.filter(leg => leg.side === 'exit')[0];
  assert.equal(exit.quantity, 5);
  assert.equal(Number(exit.price.toFixed(4)), 111.2);
  assert.equal(trade.sizeUnits, 5);
  assert.equal(trade.status, 'open');
});
