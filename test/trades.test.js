const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_FILE = path.join(__dirname, 'data-test.json');
process.env.SKIP_RATE_FETCH = 'true';

const { app, saveDB } = require('../server');

const DATA_FILE = process.env.DATA_FILE;
const username = 'tester';
const token = 'sessiontoken';
let server;
let baseUrl;

function seedDatabase() {
  fs.rmSync(DATA_FILE, { force: true });
  const db = {
    users: {
      [username]: {
        username,
        passwordHash: 'hashed',
        portfolio: 10000,
        initialPortfolio: 10000,
        initialNetDeposits: 0,
        profileComplete: true,
        portfolioHistory: {},
        netDepositsAnchor: null,
        trading212: {},
        security: {},
        tradeJournal: {}
      }
    },
    sessions: { [token]: username }
  };
  saveDB(db);
}

test.beforeEach(() => {
  seedDatabase();
  if (server) server.close();
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(DATA_FILE, { force: true });
});

async function authedFetch(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
    cookie: `auth_token=${token}`
  };
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

test('creates a trade with metadata', async () => {
  const { res, data } = await authedFetch('/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entry: 10,
      stop: 9,
      riskPct: 1,
      date: '2024-01-01',
      symbol: 'AAPL',
      tradeType: 'swing',
      assetClass: 'options',
      optionType: 'call',
      optionStrike: 195,
      optionExpiration: '2024-03-15',
      optionContracts: 2,
      strategyTag: 'breakout',
      setupTags: ['breakout'],
      emotionTags: ['disciplined'],
      note: 'Test trade'
    })
  });
  assert.equal(res.status, 200);
  assert.equal(data.trade.tradeType, 'swing');
  assert.equal(data.trade.assetClass, 'options');
  assert.equal(data.trade.optionType, 'call');
  assert.equal(data.trade.optionStrike, 195);
  const list = await authedFetch('/api/trades');
  assert.equal(list.res.status, 200);
  assert.equal(list.data.trades.length, 1);
  assert.equal(list.data.trades[0].strategyTag, 'breakout');
  assert.equal(list.data.trades[0].optionContracts, 2);
});

test('updates and closes a trade then filters winners', async () => {
  const create = await authedFetch('/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entry: 20,
      stop: 18,
      riskPct: 1,
      date: '2024-02-01',
      symbol: 'MSFT',
      tradeType: 'day',
      assetClass: 'stocks'
    })
  });
  const id = create.data.trade.id;
  const closeRes = await authedFetch(`/api/trades/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      closePrice: 22,
      closeDate: '2024-02-02',
      status: 'closed',
      emotionTags: ['confident']
    })
  });
  assert.equal(closeRes.res.status, 200);
  const filtered = await authedFetch('/api/trades?winLoss=win');
  assert.equal(filtered.res.status, 200);
  assert.ok(filtered.data.trades.some(t => t.id === id && t.status === 'closed'));
  const byType = await authedFetch('/api/trades?tradeType=day');
  assert.equal(byType.res.status, 200);
  assert.ok(byType.data.trades.length >= 1);

  const byEntryDate = await authedFetch('/api/trades?from=2024-02-01&to=2024-02-01');
  assert.equal(byEntryDate.res.status, 200);
  assert.ok(byEntryDate.data.trades.some(t => t.id === id));

  const byExitDate = await authedFetch('/api/trades?from=2024-02-02&to=2024-02-02');
  assert.equal(byExitDate.res.status, 200);
  assert.ok(!byExitDate.data.trades.some(t => t.id === id));

  const editClosed = await authedFetch(`/api/trades/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entry: 21,
      stop: 19,
      note: 'Edited after close'
    })
  });
  assert.equal(editClosed.res.status, 200);
  assert.equal(editClosed.data.trade.entry, 21);
});



test('includes option metadata in trade export csv', async () => {
  await authedFetch('/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entry: 5,
      stop: 3,
      riskPct: 1,
      date: '2024-02-05',
      symbol: 'AAPL',
      assetClass: 'options',
      optionType: 'put',
      optionStrike: 170,
      optionExpiration: '2024-04-19',
      optionContracts: 3
    })
  });

  const res = await fetch(`${baseUrl}/api/trades/export`, {
    headers: { cookie: `auth_token=${token}` }
  });
  const csv = await res.text();
  assert.equal(res.status, 200);
  assert.match(csv, /optionType,optionStrike,optionExpiration,optionContracts/);
  assert.match(csv, /put,170,2024-04-19,3/);
});

test('records partial trims when reducing units and includes trim pnl in final realized pnl', async () => {
  const create = await authedFetch('/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entry: 20,
      stop: 18,
      riskPct: 1,
      date: '2024-03-01',
      symbol: 'NVDA'
    })
  });
  const id = create.data.trade.id;

  const trimRes = await authedFetch(`/api/trades/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sizeUnits: 40,
      trimPrice: 21,
      trimDate: '2024-03-02'
    })
  });
  assert.equal(trimRes.res.status, 200);
  assert.equal(trimRes.data.trade.sizeUnits, 40);
  assert.equal(trimRes.data.trade.partialCloses.length, 1);
  assert.equal(trimRes.data.trade.partialCloses[0].units, 10);

  const closeRes = await authedFetch('/api/trades/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, price: 22, date: '2024-03-03' })
  });
  assert.equal(closeRes.res.status, 200);

  const list = await authedFetch('/api/trades');
  const closed = list.data.trades.find(t => t.id === id);
  assert.ok(closed);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.realizedPnlGBP, 70);
});

test('persists and lists fully closed execution-leg trades', async () => {
  const create = await authedFetch('/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: 'AAPL',
      assetClass: 'stocks',
      currency: 'GBP',
      executions: [
        { side: 'entry', quantity: 3, price: 10, date: '2024-05-01' },
        { side: 'exit', quantity: 3, price: 11, date: '2024-05-02' }
      ]
    })
  });
  assert.equal(create.res.status, 200);

  const list = await authedFetch('/api/trades');
  assert.equal(list.res.status, 200);
  const trade = list.data.trades.find(t => t.id === create.data.trade.id);
  assert.ok(trade);
  assert.equal(trade.status, 'closed');
  assert.equal(trade.totalEnteredQuantity, 3);
  assert.equal(trade.totalExitedQuantity, 3);
  assert.equal(trade.openQuantity, 0);
});

test('imports IBKR CSV trades, skips non-trades, and is idempotent on re-upload', async () => {
  const csv = [
    'ClientAccountID,AssetClass,Symbol,Description,TradeID,DateTime,TradeDate,Quantity,TradePrice,Buy/Sell,IBCommission,NetCash,Exchange,CurrencyPrimary,Strike,Expiry,Put/Call,Multiplier,Open/CloseIndicator,TransactionType',
    'U12345,STK,AAPL,Apple Inc,1001,20260225;103454,2026-02-25,10,195.25,BUY,-1.2,-1953.7,NASDAQ,USD,,,,,O,',
    'U12345,STK,AAPL,Apple Inc,1001,20260225;103454,2026-02-25,10,195.25,BUY,-1.2,-1953.7,NASDAQ,USD,,,,,O,ExchTrade',
    'U12345,CASH,USD.USD,FX Conversion,,20260225;103500,2026-02-25,1000,1.00,SELL,0,1000,IDEALPRO,USD,,,,,O,ExchTrade',
    'U12345,OPT,AAPL,APPLE 2026-03-20 200 C,2001,20260226;111500,2026-02-26,2,4.5,BUY,-0.9,-900,CBOE,USD,200,2026-03-20,Call,100,O,ExchTrade'
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'ibkr-sample.csv');

  const first = await authedFetch('/api/trades/import/ibkr', {
    method: 'POST',
    body: form
  });
  assert.equal(first.res.status, 200);
  assert.ok(first.data.batchId);
  assert.equal(first.data.summary.imported, 2);
  assert.equal(first.data.summary.duplicates, 0);
  assert.equal(first.data.summary.invalidRows, 0);
  assert.equal(first.data.summary.skippedCashRows, 1);
  assert.equal(first.data.summary.skippedNonTradeRows, 1);

  const listAfterFirst = await authedFetch('/api/trades');
  assert.equal(listAfterFirst.res.status, 200);
  assert.equal(listAfterFirst.data.trades.length, 2);
  const optionTrade = listAfterFirst.data.trades.find(trade => trade.assetClass === 'options');
  assert.ok(optionTrade);
  assert.equal(optionTrade.optionType, 'call');
  assert.equal(optionTrade.optionStrike, 200);
  assert.equal(optionTrade.optionExpiration, '2026-03-20');
  assert.equal(optionTrade.optionContracts, 2);
  assert.equal(optionTrade.totalEnteredQuantity, 200);
  assert.equal(optionTrade.openQuantity, 200);

  const secondForm = new FormData();
  secondForm.append('file', new Blob([csv], { type: 'text/csv' }), 'ibkr-sample.csv');
  const second = await authedFetch('/api/trades/import/ibkr', {
    method: 'POST',
    body: secondForm
  });
  assert.equal(second.res.status, 200);
  assert.equal(second.data.summary.imported, 0);
  assert.equal(second.data.summary.duplicates, 2);
  assert.equal(second.data.summary.skippedCashRows, 1);
  assert.equal(second.data.summary.skippedNonTradeRows, 1);

  const history = await authedFetch('/api/trades/import/ibkr/history');
  assert.equal(history.res.status, 200);
  assert.ok(Array.isArray(history.data.batches));
  const firstBatch = history.data.batches.find(batch => batch.id === first.data.batchId);
  assert.ok(firstBatch);
  assert.equal(firstBatch.importedCount, 2);

  const remove = await authedFetch(`/api/trades/import/ibkr/${encodeURIComponent(first.data.batchId)}`, {
    method: 'DELETE'
  });
  assert.equal(remove.res.status, 200);
  assert.equal(remove.data.removedCount, 4);

  const listAfterRemove = await authedFetch('/api/trades');
  assert.equal(listAfterRemove.res.status, 200);
  assert.equal(listAfterRemove.data.trades.length, 0);
});

test('imports IBKR option symbols and groups multiple option fills under one parent trade lifecycle', async () => {
  const csv = [
    'ClientAccountID,AssetClass,Symbol,Description,TradeID,DateTime,TradeDate,Quantity,TradePrice,Buy/Sell,IBCommission,NetCash,Exchange,CurrencyPrimary,Strike,Expiry,Put/Call,Multiplier,Open/CloseIndicator,TransactionType,LevelOfDetail',
    'U12345,OPT,SPY   260402P00656000,SPY Apr02 656 Put,5001,20260301;101000,2026-03-01,3,2.5,BUY,-1.0,-750,CBOE,USD,,,,100,O,ExchTrade,EXECUTION',
    'U12345,OPT,SPY   260402P00656000,SPY Apr02 656 Put,5004,20260302;101000,2026-03-02,1,2.8,BUY,-0.5,-280,CBOE,USD,,,,100,O,ExchTrade,EXECUTION',
    'U12345,OPT,NVDA  260417C00250000,NVDA Apr17 250 Call,5002,20260301;102000,2026-03-01,1,3.0,BUY,-0.5,-300,CBOE,USD,,,,100,O,ExchTrade,EXECUTION',
    'U12345,OPT,SPY   260402P00656000,SPY Apr02 656 Put,5003,20260303;101000,2026-03-03,2,3.0,SELL,-0.5,600,CBOE,USD,,,,100,C,ExchTrade,EXECUTION',
    'U12345,OPT,SPY   260402P00656000,SPY Apr02 656 Put,5005,20260303;110000,2026-03-03,2,3.1,SELL,-0.5,620,CBOE,USD,,,,100,C,ExchTrade,EXECUTION',
    'U12345,CASH,USD.USD,FX Conversion,,20260302;102000,2026-03-02,1000,1.0,SELL,0,1000,IDEALPRO,USD,,,,,O,ExchTrade,EXECUTION'
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'ibkr-options.csv');
  const imported = await authedFetch('/api/trades/import/ibkr', { method: 'POST', body: form });
  assert.equal(imported.res.status, 200);
  assert.equal(imported.data.summary.importedOpenings, 3);
  assert.equal(imported.data.summary.importedExits, 2);
  assert.equal(imported.data.summary.unmatchedClosingRows, 0);
  assert.equal(imported.data.summary.skippedCashRows, 1);

  const list = await authedFetch('/api/trades');
  assert.equal(list.res.status, 200);
  assert.equal(list.data.trades.length, 2);
  const spyPut = list.data.trades.find(trade => trade.displaySymbol === 'SPY');
  assert.ok(spyPut);
  assert.equal(spyPut.assetClass, 'options');
  assert.equal(spyPut.optionType, 'put');
  assert.equal(spyPut.optionStrike, 656);
  assert.equal(spyPut.optionExpiration, '2026-04-02');
  assert.equal(spyPut.totalEnteredQuantity, 400);
  assert.equal(spyPut.totalExitedQuantity, 400);
  assert.equal(spyPut.openQuantity, 0);
  assert.equal(spyPut.status, 'closed');
  assert.equal(spyPut.entryExecutions.length, 2);
  assert.equal(spyPut.exitExecutions.length, 2);
  assert.equal(spyPut.entryExecutions[0].quantity, 300);
  assert.equal(spyPut.entryExecutions[0].price, 2.5);
  assert.equal(spyPut.entryExecutions[1].quantity, 100);
  assert.equal(spyPut.entryExecutions[1].price, 2.8);
  assert.equal(spyPut.exitExecutions[0].quantity, 200);
  assert.equal(spyPut.exitExecutions[0].price, 3);
  assert.equal(spyPut.exitExecutions[1].quantity, 200);
  assert.equal(spyPut.exitExecutions[1].price, 3.1);

  const nvdaCall = list.data.trades.find(trade => trade.displaySymbol === 'NVDA');
  assert.ok(nvdaCall);
  assert.equal(nvdaCall.optionType, 'call');
  assert.equal(nvdaCall.optionStrike, 250);
  assert.equal(nvdaCall.optionExpiration, '2026-04-17');
});

test('imports IBKR option execution quantities using contracts × multiplier', async () => {
  const csv = [
    'ClientAccountID,AssetClass,Symbol,Description,TradeID,DateTime,TradeDate,Quantity,TradePrice,Buy/Sell,IBCommission,NetCash,Exchange,CurrencyPrimary,Strike,Expiry,Put/Call,Multiplier,Open/CloseIndicator,TransactionType,LevelOfDetail',
    'U12345,OPT,TSLA  260417C00300000,TSLA Apr17 300 Call,8001,20260310;101000,2026-03-10,2,6.5,BUY,-1.0,-1300,CBOE,USD,,,,100,O,ExchTrade,EXECUTION',
    'U12345,OPT,TSLA  260417C00300000,TSLA Apr17 300 Call,8002,20260311;101000,2026-03-11,1,7.2,SELL,-1.0,720,CBOE,USD,,,,100,C,ExchTrade,EXECUTION'
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'ibkr-option-qty.csv');
  const imported = await authedFetch('/api/trades/import/ibkr', { method: 'POST', body: form });
  assert.equal(imported.res.status, 200);

  const list = await authedFetch('/api/trades');
  assert.equal(list.res.status, 200);
  const tslaCall = list.data.trades.find(trade => trade.displaySymbol === 'TSLA');
  assert.ok(tslaCall);
  assert.equal(tslaCall.optionContracts, 2);
  assert.equal(tslaCall.totalEnteredQuantity, 200);
  assert.equal(tslaCall.totalExitedQuantity, 100);
  assert.equal(tslaCall.openQuantity, 100);
  assert.equal(tslaCall.status, 'partial');
});

test('imports IBKR closing rows with full normalized exit quantity even when spanning multiple entry fills', async () => {
  const csv = [
    'ClientAccountID,AssetClass,Symbol,Description,TradeID,DateTime,TradeDate,Quantity,TradePrice,Buy/Sell,IBCommission,NetCash,Exchange,CurrencyPrimary,Strike,Expiry,Put/Call,Multiplier,Open/CloseIndicator,TransactionType,LevelOfDetail',
    'U12345,OPT,SPY   260417C00600000,SPY Apr17 600 Call,9001,20260320;101000,2026-03-20,3,5.8,BUY,-1.0,-1740,CBOE,USD,,,,100,O,ExchTrade,EXECUTION',
    'U12345,OPT,SPY   260417C00600000,SPY Apr17 600 Call,9002,20260321;101000,2026-03-21,1,6.1,BUY,-1.0,-610,CBOE,USD,,,,100,O,ExchTrade,EXECUTION',
    'U12345,OPT,SPY   260417C00600000,SPY Apr17 600 Call,9003,20260323;101000,2026-03-23,4,7.36,SELL,-1.0,2944,CBOE,USD,,,,100,C,ExchTrade,EXECUTION'
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'ibkr-option-close-qty.csv');
  const imported = await authedFetch('/api/trades/import/ibkr', { method: 'POST', body: form });
  assert.equal(imported.res.status, 200);
  assert.equal(imported.data.summary.importedOpenings, 2);
  assert.equal(imported.data.summary.importedExits, 1);
  assert.equal(imported.data.summary.unmatchedClosingRows, 0);

  const list = await authedFetch('/api/trades');
  assert.equal(list.res.status, 200);
  const spyCall = list.data.trades.find(trade => trade.displaySymbol === 'SPY');
  assert.ok(spyCall);
  assert.equal(spyCall.totalEnteredQuantity, 400);
  assert.equal(spyCall.totalExitedQuantity, 400);
  assert.equal(spyCall.openQuantity, 0);
  assert.equal(spyCall.status, 'closed');
  assert.equal(spyCall.exitExecutions.length, 1);
  assert.equal(spyCall.exitExecutions[0].price, 7.36);
  assert.equal(spyCall.exitExecutions[0].quantity, 400);
});
