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
          { id: 'primary', label: 'Trading 212', currentValue: 4000, currentNetDeposits: 3000, integrationProvider: 'trading212', integrationEnabled: true },
          { id: 'ibkr', label: 'IBKR', currentValue: 6500, currentNetDeposits: 4500, integrationProvider: 'ibkr', integrationEnabled: true }
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

test('manual baseline save does not override live multi-account aggregation in profile and portfolio reads', async () => {
  const saveBaseline = await authedFetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      portfolio: 12000,
      netDeposits: 18000
    })
  });
  assert.equal(saveBaseline.res.status, 200);
  assert.equal(saveBaseline.data.manualNetDepositsBaseline, 18000);

  const profile = await authedFetch('/api/profile');
  assert.equal(profile.res.status, 200);
  assert.equal(profile.data.netDepositsTotal, 18000);
  assert.equal(profile.data.initialNetDeposits, 18000);
  assert.equal(profile.data.portfolio, 10500);
  const primary = profile.data.tradingAccounts.find(account => account.id === 'primary');
  const ibkr = profile.data.tradingAccounts.find(account => account.id === 'ibkr');
  assert.ok(primary);
  assert.ok(ibkr);
  assert.equal(primary.currentValue, 4000);
  assert.equal(ibkr.currentValue, 6500);

  const portfolio = await authedFetch('/api/portfolio');
  assert.equal(portfolio.res.status, 200);
  assert.equal(portfolio.data.netDepositsTotal, 18000);
  assert.equal(portfolio.data.initialNetDeposits, 18000);
  assert.equal(portfolio.data.portfolioValue, 10500);
});

test('manual baseline save clears stale baseline while preserving multi-account attribution', async () => {
  const saveBaseline = await authedFetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      portfolio: 15000,
      netDeposits: 18000
    })
  });
  assert.equal(saveBaseline.res.status, 200);

  const profile = await authedFetch('/api/profile');
  assert.equal(profile.res.status, 200);
  assert.equal(profile.data.portfolio, 10500);
  const primary = profile.data.tradingAccounts.find(account => account.id === 'primary');
  const ibkr = profile.data.tradingAccounts.find(account => account.id === 'ibkr');
  assert.ok(primary);
  assert.ok(ibkr);
  assert.equal(primary.currentValue, 4000);
  assert.equal(ibkr.currentValue, 6500);

  const tradingAccounts = await authedFetch('/api/account/trading-accounts');
  assert.equal(tradingAccounts.res.status, 200);
  const primaryFromAccountApi = tradingAccounts.data.accounts.find(account => account.id === 'primary');
  const ibkrFromAccountApi = tradingAccounts.data.accounts.find(account => account.id === 'ibkr');
  assert.ok(primaryFromAccountApi);
  assert.ok(ibkrFromAccountApi);
  assert.equal(primaryFromAccountApi.currentValue, 4000);
  assert.equal(ibkrFromAccountApi.currentValue, 6500);
});

test('single integrated account is still used for portfolio and net deposit aggregation when multi-account flag is off', async () => {
  seedDatabase();
  const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  db.users[username].multiTradingAccountsEnabled = false;
  db.users[username].tradingAccounts = [
    { id: 'main-isa', label: 'Main ISA', currentValue: 7312.45, currentNetDeposits: 6900, integrationProvider: 'trading212', integrationEnabled: true }
  ];
  db.users[username].portfolio = 10;
  db.users[username].initialNetDeposits = 20;
  saveDB(db);

  const profile = await authedFetch('/api/profile');
  assert.equal(profile.res.status, 200);
  assert.equal(profile.data.portfolio, 7312.45);
  assert.equal(profile.data.netDepositsTotal, 6900);

  const portfolio = await authedFetch('/api/portfolio');
  assert.equal(portfolio.res.status, 200);
  assert.equal(portfolio.data.portfolioValue, 7312.45);
  assert.equal(portfolio.data.netDepositsTotal, 6900);
});
