const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findTrading212OpenTradeMatch,
  inferTrading212AddedEntryPrice,
  isTrading212AddToPosition
} = require('../server');

test('findTrading212OpenTradeMatch prefers exact id match over aggregate symbol match', () => {
  const openTrades = [
    { tradeDate: '2025-01-01', trade: { id: 'a', symbol: 'AAPL', trading212Id: 'acct:old-pos' } },
    { tradeDate: '2025-01-01', trade: { id: 'b', symbol: 'AAPL', trading212Id: 'acct:new-pos' } }
  ];

  const result = findTrading212OpenTradeMatch(openTrades, {
    accountId: 'acct',
    trading212Id: 'acct:new-pos',
    trading212IdBase: 'new-pos',
    trading212Key: 'isin:US0378331005',
    trading212PositionKey: 'acct:AAPL',
    symbol: 'AAPL',
    rawIsin: 'US0378331005',
    normalizedName: 'apple-inc',
    rawTickerValue: 'AAPL_US_EQ'
  });

  assert.equal(result.exactTradeEntry?.trade?.id, 'b');
  assert.equal(result.aggregateTradeEntry, null);
});

test('findTrading212OpenTradeMatch falls back to aggregate key when id changed on add-to-position', () => {
  const openTrades = [
    {
      tradeDate: '2025-01-01',
      trade: {
        id: 'existing-layer',
        symbol: 'AAPL',
        trading212Id: 'acct:position-1',
        trading212PositionKey: 'acct:AAPL',
        trading212AccountId: 'acct'
      }
    }
  ];

  const result = findTrading212OpenTradeMatch(openTrades, {
    accountId: 'acct',
    trading212Id: 'acct:position-2',
    trading212IdBase: 'position-2',
    trading212Key: 'isin:US0378331005',
    trading212PositionKey: 'acct:AAPL',
    symbol: 'AAPL',
    rawIsin: 'US0378331005',
    normalizedName: 'apple-inc',
    rawTickerValue: 'AAPL_US_EQ'
  });

  assert.equal(result.exactTradeEntry, undefined);
  assert.equal(result.aggregateTradeEntry?.trade?.id, 'existing-layer');
});


test('inferTrading212AddedEntryPrice derives buy price from avg change and unit increase', () => {
  const inferred = inferTrading212AddedEntryPrice(100, 10, 110, 20);
  assert.equal(inferred, 120);
});

test('isTrading212AddToPosition only returns true when units increase', () => {
  assert.equal(isTrading212AddToPosition({ sizeUnits: 10 }, 12), true);
  assert.equal(isTrading212AddToPosition({ sizeUnits: 10 }, 10), false);
  assert.equal(isTrading212AddToPosition({ sizeUnits: 10 }, 9), false);
});
