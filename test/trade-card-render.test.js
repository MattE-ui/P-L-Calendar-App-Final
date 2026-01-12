const test = require('node:test');
const assert = require('node:assert');

const { renderTradeCard } = require('../static/trade-card.js');

test('renderTradeCard returns a non-empty PNG blob', async () => {
  const blob = await renderTradeCard({
    ticker: 'ETHUSD',
    direction: 'LONG',
    roiPct: 41.36,
    rMultiple: 6.2,
    entryPrice: 3641.75,
    stopPrice: 3500,
    entryDate: '2024-04-23',
    closeDate: '2024-04-24',
    username: 'ProTrader94',
    sharedAt: '2024-04-24T12:00:00Z'
  });
  assert.ok(blob);
  assert.equal(blob.type, 'image/png');
  assert.ok(blob.size > 0);
});
