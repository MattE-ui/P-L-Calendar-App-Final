const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_FILE = path.join(__dirname, 'data-social-leaderboard-test.json');
process.env.SKIP_RATE_FETCH = 'true';

const { app, saveDB } = require('../server');

const DATA_FILE = process.env.DATA_FILE;
let server;
let baseUrl;

function isoDayOffset(offsetDays) {
  return new Date(Date.now() + (offsetDays * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function monthKey(day) {
  return day.slice(0, 7);
}

function resetDatabase() {
  fs.rmSync(DATA_FILE, { force: true });
  const avatarDir = path.join(path.dirname(DATA_FILE), 'uploads', 'avatars');
  fs.rmSync(avatarDir, { recursive: true, force: true });
  fs.mkdirSync(avatarDir, { recursive: true });
  fs.writeFileSync(path.join(avatarDir, 'leader.png'), 'avatar');

  const openOld = isoDayOffset(-40);
  const closeA = isoDayOffset(-6);
  const closeB = isoDayOffset(-4);
  const closeC = isoDayOffset(-2);
  const beforeWindow = isoDayOffset(-10);
  const withinWindow = isoDayOffset(-1);

  const db = {
    users: {
      leader: {
        username: 'leader',
        passwordHash: 'x',
        portfolio: 1200,
        initialPortfolio: 1000,
        initialNetDeposits: 1000,
        profileComplete: true,
        portfolioSource: 'manual',
        portfolioCurrency: 'GBP',
        netDepositsAnchor: null,
        avatarUrl: '/static/uploads/avatars/leader.png',
        nickname: 'Leader One',
        security: {},
        trading212: { enabled: true },
        ibkr: { enabled: false },
        multiTradingAccountsEnabled: true,
        tradingAccounts: [
          {
            id: 'primary',
            label: 'Primary account',
            currentValue: 1200,
            currentNetDeposits: 0,
            integrationProvider: 'trading212',
            integrationEnabled: true
          }
        ],
        portfolioHistory: {
          [monthKey(beforeWindow)]: {
            [beforeWindow]: {
              end: 1000, cashIn: 0, cashOut: 0,
              accounts: { primary: { end: 1000, cashIn: 0, cashOut: 0 } }
            }
          },
          [monthKey(withinWindow)]: {
            [withinWindow]: {
              end: 1200, cashIn: 100, cashOut: 0,
              accounts: { primary: { end: 1200, cashIn: 100, cashOut: 0 } }
            }
          }
        },
        tradeJournal: {
          [openOld]: [
            { id: 't1', status: 'closed', entry: 100, closePrice: 140, sizeUnits: 1, closeDate: closeA, currency: 'GBP', source: 'trading212' },
            { id: 't2', status: 'closed', entry: 100, closePrice: 130, sizeUnits: 1, closeDate: closeB, currency: 'GBP', source: 'trading212' },
            { id: 't3', status: 'closed', entry: 100, closePrice: 130, sizeUnits: 1, closeDate: closeC, currency: 'GBP', source: 'trading212' }
          ]
        }
      }
    },
    sessions: { token: 'leader' },
    socialSettings: [
      {
        id: 'social-leader',
        user_id: 'leader',
        trade_sharing_enabled: true,
        share_open_trades: true,
        share_closed_trades: true,
        leaderboard_enabled: true,
        leaderboard_visibility: 'public',
        verification_status: 'none',
        verification_source: 'manual',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ]
  };

  saveDB(db);
}

async function authedFetch(pathname) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    headers: { cookie: 'auth_token=token' }
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

test.beforeEach(() => {
  resetDatabase();
  if (server) server.close();
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(DATA_FILE, { force: true });
  fs.rmSync(path.join(path.dirname(DATA_FILE), 'uploads'), { recursive: true, force: true });
});

test('leaderboard includes persisted avatar and computes 7D return from deployed trade capital with source metadata', async () => {
  const { res, data } = await authedFetch('/api/social/leaderboard?period=7D&verification=trusted');
  assert.equal(res.status, 200);
  assert.equal(data.period, '7D');
  assert.equal(Array.isArray(data.entries), true);
  assert.equal(data.entries.length, 1);

  const [entry] = data.entries;
  assert.equal(entry.avatar_url, '/static/uploads/avatars/leader.png');
  assert.equal(entry.avatar_initials, 'LO');
  assert.equal(entry.trade_count, 3);
  assert.equal(Math.round(entry.return_pct * 100) / 100, 10);
  assert.equal(entry.leaderboard_source, 'trading212');
});


test('leaderboard supports account mode using source-specific equity history', async () => {
  const { res, data } = await authedFetch('/api/social/leaderboard?period=7D&verification=trusted&mode=account');
  assert.equal(res.status, 200);
  assert.equal(data.period, '7D');
  assert.equal(data.mode, 'account');
  assert.equal(Array.isArray(data.entries), true);
  assert.equal(data.entries.length, 1);

  const [entry] = data.entries;
  assert.equal(entry.leaderboard_mode, 'account');
  assert.equal(entry.leaderboard_source, 'trading212');
  assert.equal(Math.round(entry.return_pct * 100) / 100, 10);
});
