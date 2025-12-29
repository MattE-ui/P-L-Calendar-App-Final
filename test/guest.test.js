const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_FILE = path.join(__dirname, 'data-guest-test.json');
process.env.SKIP_RATE_FETCH = 'true';
process.env.GUEST_TTL_HOURS = '24';

const { app, saveDB, loadDB, cleanupExpiredGuests } = require('../server');

const DATA_FILE = process.env.DATA_FILE;
let server;
let baseUrl;

function resetDatabase() {
  fs.rmSync(DATA_FILE, { force: true });
  saveDB({ users: {}, sessions: {} });
}

function extractAuthCookie(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/auth_token=([^;]+)/);
  return match ? match[1] : null;
}

async function authedFetch(cookie, path, options = {}) {
  const headers = {
    ...(options.headers || {}),
    cookie: `auth_token=${cookie}`
  };
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

test.beforeEach(() => {
  resetDatabase();
  if (server) server.close();
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(DATA_FILE, { force: true });
});

test('creates a guest session and marks profile as guest', async () => {
  const res = await fetch(`${baseUrl}/api/auth/guest`, { method: 'POST' });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.isGuest, true);
  const token = extractAuthCookie(res);
  assert.ok(token);
  const profile = await authedFetch(token, '/api/profile');
  assert.equal(profile.res.status, 200);
  assert.equal(profile.data.isGuest, true);
});

test('blocks guest exports with a 403', async () => {
  const res = await fetch(`${baseUrl}/api/auth/guest`, { method: 'POST' });
  const token = extractAuthCookie(res);
  const exportRes = await authedFetch(token, '/api/trades/export');
  assert.equal(exportRes.res.status, 403);
  assert.ok(/Guests cannot perform/.test(exportRes.data.error));
});

test('rejects expired guest sessions at request time', async () => {
  const expiredUser = {
    username: 'guest_expired',
    guest: true,
    expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    passwordHash: '',
    portfolio: 0,
    initialPortfolio: 0,
    initialNetDeposits: 0,
    profileComplete: false,
    portfolioHistory: {},
    netDepositsAnchor: null,
    trading212: {},
    security: {},
    tradeJournal: {}
  };
  saveDB({
    users: { [expiredUser.username]: expiredUser },
    sessions: { expiredtoken: expiredUser.username }
  });
  const { res, data } = await authedFetch('expiredtoken', '/api/portfolio');
  assert.equal(res.status, 401);
  assert.ok(data.error.includes('Guest session expired'));
});

test('cleanup job removes expired guest users and sessions', () => {
  const now = Date.now();
  const db = {
    users: {
      guest_old: {
        username: 'guest_old',
        guest: true,
        expiresAt: new Date(now - 1000).toISOString(),
        passwordHash: '',
        portfolio: 0,
        initialPortfolio: 0,
        initialNetDeposits: 0,
        profileComplete: false,
        portfolioHistory: {},
        netDepositsAnchor: null,
        trading212: {},
        security: {},
        tradeJournal: {}
      },
      guest_new: {
        username: 'guest_new',
        guest: true,
        expiresAt: new Date(now + 1000 * 60).toISOString(),
        passwordHash: '',
        portfolio: 0,
        initialPortfolio: 0,
        initialNetDeposits: 0,
        profileComplete: false,
        portfolioHistory: {},
        netDepositsAnchor: null,
        trading212: {},
        security: {},
        tradeJournal: {}
      }
    },
    sessions: {
      oldtoken: 'guest_old',
      newtoken: 'guest_new'
    }
  };
  const mutated = cleanupExpiredGuests(db, new Date(now + 2000));
  assert.equal(mutated, true);
  assert.equal(db.users.guest_old, undefined);
  assert.equal(db.sessions.oldtoken, undefined);
  assert.ok(db.users.guest_new);
});
