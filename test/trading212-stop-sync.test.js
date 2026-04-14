const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');

const { upsertTrading212StopOrders, updateTrading212LayerMetadata } = require('../server');

test('upsertTrading212StopOrders keeps stop equal to provider currentStop when no manual override', () => {
  const user = {
    portfolio: 10000,
    tradeJournal: {
      '2026-02-20': [{
        id: 't1',
        source: 'trading212',
        symbol: 'SNDK',
        trading212Ticker: 'SNDK_US_EQ',
        entry: 619.74993721,
        stop: 596,
        currentStop: 596,
        currentStopSource: 't212',
        sizeUnits: 2.05981465,
        currency: 'GBP',
        direction: 'long',
        status: 'open'
      }]
    }
  };

  const ordersPayload = {
    orders: [{
      id: 'order-1',
      status: 'OPEN',
      side: 'SELL',
      type: 'STOP',
      quantity: -2.05981465,
      stopPrice: 590.1,
      instrumentTicker: 'SNDK_US_EQ'
    }]
  };

  const result = upsertTrading212StopOrders(user, ordersPayload, '', { GBP: 1 });
  const trade = user.tradeJournal['2026-02-20'][0];
  assert.equal(result.updated, 1);
  assert.equal(trade.currentStop, 590.1);
  assert.equal(trade.stop, 590.1);
  assert.ok(Number(trade.riskPct) > 0);
});

test('upsertTrading212StopOrders preserves manual stop override while updating currentStop', () => {
  const user = {
    portfolio: 10000,
    tradeJournal: {
      '2026-02-20': [{
        id: 't2',
        source: 'trading212',
        symbol: 'SNDK',
        trading212Ticker: 'SNDK_US_EQ',
        entry: 619.74993721,
        stop: 596,
        currentStop: 596,
        currentStopSource: 't212',
        stopManualOverride: true,
        sizeUnits: 2.05981465,
        currency: 'GBP',
        direction: 'long',
        status: 'open'
      }]
    }
  };

  const ordersPayload = {
    orders: [{
      id: 'order-2',
      status: 'OPEN',
      side: 'SELL',
      type: 'STOP',
      quantity: -2.05981465,
      stopPrice: 590.1,
      instrumentTicker: 'SNDK_US_EQ'
    }]
  };

  upsertTrading212StopOrders(user, ordersPayload, '', { GBP: 1 });
  const trade = user.tradeJournal['2026-02-20'][0];
  assert.equal(trade.currentStop, 590.1);
  assert.equal(trade.stop, 596);
});

test('updateTrading212LayerMetadata preserves existing currentStop when snapshot has no authoritative stop', () => {
  const trade = {
    id: 't3',
    source: 'trading212',
    symbol: 'SNDK',
    entry: 619.74,
    stop: 596,
    currentStop: 590.1,
    originalStopPrice: 596,
    currentStopSource: 'manual',
    stopManualOverride: true,
    sizeUnits: 2,
    currency: 'GBP',
    direction: 'long',
    status: 'open'
  };

  updateTrading212LayerMetadata(trade, {
    symbol: 'SNDK',
    trading212Id: 'position-1',
    trading212PositionKey: 'SNDK',
    accountId: '',
    rawName: 'Sandisk',
    rawIsin: '',
    rawTickerValue: 'SNDK_US_EQ',
    optionContract: {},
    tradeCurrency: 'GBP',
    direction: 'long',
    currentPrice: 640.12,
    stop: null,
    lowStop: 580.0,
    user: { portfolio: 10000 },
    rates: { GBP: 1 }
  });

  assert.equal(trade.currentStop, 590.1);
  assert.equal(trade.stop, 596);
  assert.equal(trade.originalStopPrice, 596);
});


test('saving trading accounts preserves assigned integration flags when not explicitly toggled', async () => {
  const { app, loadDB, saveDB } = require('../server');
  const { once } = require('node:events');
  const http = require('node:http');

  const username = `integration-persist-${Date.now()}`;
  const password = 'Passw0rd!';

  const db = loadDB();
  db.users[username] = {
    username,
    passwordHash: await bcrypt.hash(password, 10),
    security: {},
    guest: false,
    profileComplete: true,
    portfolio: 1000,
    initialPortfolio: 1000,
    initialNetDeposits: 500,
    portfolioHistory: {},
    multiTradingAccountsEnabled: true,
    tradingAccounts: [
      {
        id: 'primary',
        label: 'Primary account',
        currentValue: 800,
        currentNetDeposits: 400,
        integrationProvider: 'trading212',
        integrationEnabled: true
      },
      {
        id: 'acc-2',
        label: 'Account 2',
        currentValue: 200,
        currentNetDeposits: 100,
        integrationProvider: null,
        integrationEnabled: false
      }
    ],
    uiPrefs: {},
    trading212: { enabled: false, accounts: [] },
    ibkr: { enabled: false }
  };
  saveDB(db);

  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const loginRes = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.headers.get('set-cookie');
    assert.ok(cookie);

    const saveRes = await fetch(`${base}/api/account/trading-accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie
      },
      body: JSON.stringify({
        enabled: true,
        accounts: [
          { id: 'primary', label: 'Primary account', currentValue: 900, currentNetDeposits: 450 },
          { id: 'acc-2', label: 'Account 2', currentValue: 250, currentNetDeposits: 120 }
        ]
      })
    });
    assert.equal(saveRes.status, 200);
    const payload = await saveRes.json();
    const primary = payload.accounts.find(account => account.id === 'primary');
    assert.equal(primary.integrationProvider, 'trading212');
    assert.equal(primary.integrationEnabled, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('profile endpoint backfills integration-linked trading account current value from latest portfolio history account snapshot', async () => {
  const { app, loadDB, saveDB } = require('../server');
  const { once } = require('node:events');
  const http = require('node:http');

  const username = `integration-history-backfill-${Date.now()}`;
  const password = 'Passw0rd!';

  const db = loadDB();
  db.users[username] = {
    username,
    passwordHash: await bcrypt.hash(password, 10),
    security: {},
    guest: false,
    profileComplete: true,
    portfolio: 1000,
    initialPortfolio: 1000,
    initialNetDeposits: 500,
    portfolioHistory: {
      '2026-03': {
        '2026-03-01': {
          end: 1000,
          cashIn: 0,
          cashOut: 0,
          accounts: {
            primary: { end: 1000, cashIn: 0, cashOut: 0 }
          }
        },
        '2026-03-02': {
          end: 1250,
          cashIn: 0,
          cashOut: 0,
          accounts: {
            primary: { end: 1250, cashIn: 0, cashOut: 0 }
          }
        }
      }
    },
    multiTradingAccountsEnabled: true,
    tradingAccounts: [
      {
        id: 'primary',
        label: 'Primary account',
        currentValue: 900,
        currentNetDeposits: 400,
        integrationProvider: 'trading212',
        integrationEnabled: true
      }
    ],
    uiPrefs: {},
    trading212: { enabled: false, accounts: [] },
    ibkr: { enabled: false }
  };
  saveDB(db);

  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const loginRes = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.headers.get('set-cookie');
    assert.ok(cookie);

    const profileRes = await fetch(`${base}/api/profile`, {
      headers: { cookie }
    });
    assert.equal(profileRes.status, 200);
    const profile = await profileRes.json();
    const primary = profile.tradingAccounts.find(account => account.id === 'primary');
    assert.equal(primary.currentValue, 1250);

    const reloaded = loadDB().users[username];
    assert.equal(reloaded.tradingAccounts[0].currentValue, 1250);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('saving trading accounts migrates Trading 212 ownership from deleted fallback account to canonical Main ISA account', async () => {
  const { app, loadDB, saveDB } = require('../server');
  const { once } = require('node:events');
  const http = require('node:http');

  const username = `integration-owner-migrate-${Date.now()}`;
  const password = 'Passw0rd!';

  const db = loadDB();
  db.users[username] = {
    username,
    passwordHash: await bcrypt.hash(password, 10),
    security: {},
    guest: false,
    profileComplete: true,
    portfolio: 6000,
    initialPortfolio: 6000,
    initialNetDeposits: 3000,
    portfolioHistory: {
      '2026-04': {
        '2026-04-10': {
          end: 6000,
          cashIn: 0,
          cashOut: 0,
          accounts: {
            fallback: { end: 6000, cashIn: 0, cashOut: 0 }
          }
        }
      }
    },
    multiTradingAccountsEnabled: true,
    tradingAccounts: [
      {
        id: 'fallback',
        label: 'Trading 212',
        currentValue: 6000,
        currentNetDeposits: 3000,
        integrationProvider: 'trading212',
        integrationEnabled: true,
        linkedBrokerAccountId: 'broker-main-isa',
        providerAccountId: 'broker-main-isa'
      },
      {
        id: 'main-isa',
        label: 'Main ISA',
        currentValue: 0,
        currentNetDeposits: 0,
        integrationProvider: null,
        integrationEnabled: false,
        linkedBrokerAccountId: '',
        providerAccountId: ''
      }
    ],
    uiPrefs: {},
    trading212: {
      enabled: true,
      accounts: [{
        id: 'broker-main-isa',
        label: 'Main ISA',
        apiKey: 'key-123',
        apiSecret: 'secret-123',
        active: true,
        connectionStatus: 'connected',
        syncStatus: 'idle'
      }]
    },
    ibkr: { enabled: false }
  };
  saveDB(db);

  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const loginRes = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.headers.get('set-cookie');
    assert.ok(cookie);

    const saveRes = await fetch(`${base}/api/account/trading-accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie
      },
      body: JSON.stringify({
        enabled: true,
        accounts: [
          { id: 'main-isa', label: 'Main ISA', currentValue: 0, currentNetDeposits: 0 }
        ]
      })
    });
    assert.equal(saveRes.status, 200);
    const payload = await saveRes.json();
    assert.equal(payload.accounts.length, 1);
    const mainIsa = payload.accounts.find(account => account.id === 'main-isa');
    assert.equal(mainIsa.integrationProvider, 'trading212');
    assert.equal(mainIsa.integrationEnabled, true);
    assert.equal(mainIsa.linkedBrokerAccountId, 'broker-main-isa');

    const reloaded = loadDB().users[username];
    const relinked = reloaded.portfolioHistory?.['2026-04']?.['2026-04-10']?.accounts || {};
    assert.equal(relinked['fallback'], undefined);
    assert.equal(relinked['main-isa']?.end, 6000);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
