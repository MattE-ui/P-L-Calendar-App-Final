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
      assetClass: 'stocks',
      strategyTag: 'breakout',
      setupTags: ['breakout'],
      emotionTags: ['disciplined'],
      note: 'Test trade'
    })
  });
  assert.equal(res.status, 200);
  assert.equal(data.trade.tradeType, 'swing');
  const list = await authedFetch('/api/trades');
  assert.equal(list.res.status, 200);
  assert.equal(list.data.trades.length, 1);
  assert.equal(list.data.trades[0].strategyTag, 'breakout');
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
  assert.equal(closed.realizedPnlGBP, 90);
});
