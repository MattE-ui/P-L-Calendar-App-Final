const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_FILE = path.join(__dirname, 'data-pl-multi-account-sync.json');
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
        portfolio: 10500,
        initialPortfolio: 10500,
        initialNetDeposits: 0,
        profileComplete: true,
        portfolioHistory: {},
        netDepositsAnchor: null,
        trading212: {},
        security: {},
        tradeJournal: {},
        multiTradingAccountsEnabled: true,
        tradingAccounts: [
          { id: 'primary', label: 'Primary', currentValue: 4000, currentNetDeposits: 3000 },
          { id: 'ibkr', label: 'IBKR', currentValue: 6500, currentNetDeposits: 4500 }
        ]
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

async function authedFetch(route, options = {}) {
  const headers = {
    ...(options.headers || {}),
    cookie: `auth_token=${token}`
  };
  const res = await fetch(`${baseUrl}${route}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

test('saving a daily closing value for an account updates profile account current value and combined portfolio', async () => {
  const saveEntry = await authedFetch('/api/pl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: '2026-03-13',
      value: 6552.99,
      accountId: 'ibkr'
    })
  });
  assert.equal(saveEntry.res.status, 200);

  const profile = await authedFetch('/api/profile');
  assert.equal(profile.res.status, 200);
  const ibkr = profile.data.tradingAccounts.find(account => account.id === 'ibkr');
  const primary = profile.data.tradingAccounts.find(account => account.id === 'primary');
  assert.ok(ibkr);
  assert.ok(primary);
  assert.equal(ibkr.currentValue, 6552.99);
  assert.equal(primary.currentValue, 4000);
  assert.equal(profile.data.portfolio, 10552.99);
});

test('deleting a more recent account close rolls current value back to the latest remaining close', async () => {
  let response = await authedFetch('/api/pl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: '2026-03-12',
      value: 6400,
      accountId: 'ibkr'
    })
  });
  assert.equal(response.res.status, 200);

  response = await authedFetch('/api/pl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: '2026-03-13',
      value: 6552.99,
      accountId: 'ibkr'
    })
  });
  assert.equal(response.res.status, 200);

  response = await authedFetch('/api/pl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: '2026-03-13',
      value: null,
      accountId: 'ibkr'
    })
  });
  assert.equal(response.res.status, 200);

  const profile = await authedFetch('/api/profile');
  assert.equal(profile.res.status, 200);
  const ibkr = profile.data.tradingAccounts.find(account => account.id === 'ibkr');
  assert.ok(ibkr);
  assert.equal(ibkr.currentValue, 6400);
  assert.equal(profile.data.portfolio, 10400);
});

test('saving account cashflows updates account net deposits and combined net deposits total', async () => {
  const saveEntry = await authedFetch('/api/pl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: '2026-03-23',
      value: null,
      cashOut: 500,
      accountId: 'ibkr'
    })
  });
  assert.equal(saveEntry.res.status, 200);

  const profile = await authedFetch('/api/profile');
  assert.equal(profile.res.status, 200);
  const ibkr = profile.data.tradingAccounts.find(account => account.id === 'ibkr');
  assert.ok(ibkr);
  assert.equal(ibkr.currentNetDeposits, 4000);
  assert.equal(profile.data.netDepositsTotal, 7000);
});

test('profile backfills legacy aggregate cashflows into the integrated account once', async () => {
  const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  db.users[username].tradingAccounts = [
    { id: 'primary', label: 'Primary', currentValue: 4000, currentNetDeposits: 3000, integrationEnabled: false, integrationProvider: null },
    { id: 'ibkr', label: 'IBKR', currentValue: 6500, currentNetDeposits: 4500, integrationEnabled: true, integrationProvider: 'trading212' }
  ];
  db.users[username].portfolioHistory = {
    '2026-03': {
      '2026-03-19': {
        end: 10500,
        cashIn: 0,
        cashOut: 500
      }
    }
  };
  saveDB(db);

  const firstProfile = await authedFetch('/api/profile');
  assert.equal(firstProfile.res.status, 200);
  const firstIntegrated = firstProfile.data.tradingAccounts.find(account => account.id === 'ibkr');
  assert.ok(firstIntegrated);
  assert.equal(firstIntegrated.currentNetDeposits, 4000);
  assert.equal(firstProfile.data.netDepositsTotal, 7000);

  const secondProfile = await authedFetch('/api/profile');
  assert.equal(secondProfile.res.status, 200);
  const secondIntegrated = secondProfile.data.tradingAccounts.find(account => account.id === 'ibkr');
  assert.ok(secondIntegrated);
  assert.equal(secondIntegrated.currentNetDeposits, 4000);
  assert.equal(secondProfile.data.netDepositsTotal, 7000);
});
