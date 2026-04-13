const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_FILE = path.join(__dirname, 'data-profile-baseline-manual.json');
process.env.SKIP_RATE_FETCH = 'true';

const { app, saveDB } = require('../server');

const DATA_FILE = process.env.DATA_FILE;
const username = 'single_user';
const token = 'single-session-token';
let server;
let baseUrl;

function seedDatabase() {
  fs.rmSync(DATA_FILE, { force: true });
  saveDB({
    users: {
      [username]: {
        username,
        passwordHash: 'hashed',
        portfolio: 19500,
        initialPortfolio: 19500,
        initialNetDeposits: 19500,
        profileComplete: true,
        portfolioHistory: {},
        netDepositsAnchor: null,
        trading212: {},
        security: {},
        tradeJournal: {},
        multiTradingAccountsEnabled: false,
        tradingAccounts: [
          { id: 'primary', label: 'Primary', currentValue: 19500, currentNetDeposits: 19500 }
        ]
      }
    },
    sessions: { [token]: username }
  });
}

test.beforeEach(() => {
  seedDatabase();
  if (server) server.close();
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(DATA_FILE, { force: true });
});

async function authedFetch(route, options = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      cookie: `auth_token=${token}`
    }
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

test('manual baseline persists after save and refresh for single-account profile endpoints', async () => {
  const saveBaseline = await authedFetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      portfolio: 20000,
      netDeposits: 18000
    })
  });
  assert.equal(saveBaseline.res.status, 200);
  assert.equal(saveBaseline.data.manualNetDepositsBaseline, 18000);

  const refreshedProfile = await authedFetch('/api/profile');
  assert.equal(refreshedProfile.res.status, 200);
  assert.equal(refreshedProfile.data.netDepositsTotal, 18000);
  assert.equal(refreshedProfile.data.initialNetDeposits, 18000);
  assert.equal(refreshedProfile.data.portfolio, 20000);

  const refreshedPortfolio = await authedFetch('/api/portfolio');
  assert.equal(refreshedPortfolio.res.status, 200);
  assert.equal(refreshedPortfolio.data.netDepositsTotal, 18000);
  assert.equal(refreshedPortfolio.data.initialNetDeposits, 18000);
  assert.equal(refreshedPortfolio.data.portfolio, 20000);
});
