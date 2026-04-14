const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_FILE = path.join(__dirname, 'data-pl-visible-window-origin.json');
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
        portfolio: 11100,
        initialPortfolio: 10000,
        initialNetDeposits: 0,
        profileComplete: true,
        portfolioHistory: {
          '2026-01': {
            '2026-01-05': { end: 10000, cashIn: 0, cashOut: 0 }
          },
          '2026-04': {
            '2026-04-02': { end: 11100, cashIn: 0, cashOut: 0 }
          }
        },
        tradeJournal: {},
        trading212: {},
        security: {}
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
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(DATA_FILE, { force: true });
});

async function authedFetch(route) {
  const res = await fetch(`${baseUrl}${route}`, {
    headers: { cookie: `auth_token=${token}` }
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

test('window payload includes global first recorded date metadata for origin tile classification', async () => {
  const april = await authedFetch('/api/pl?year=2026&month=04&visibleWindowOnly=1&includeTrades=0');
  assert.equal(april.res.status, 200);
  assert.deepEqual(april.data['2026-04-02'], {
    start: 10000,
    end: 11100,
    cashIn: 0,
    cashOut: 0
  });
  assert.equal(april.data.__meta?.firstRecordedDate, '2026-01-05');
  assert.equal(april.data.__meta?.selectedMonthKey, '2026-04');
  assert.equal(april.data.__meta?.originTileInWindow, false);

  const january = await authedFetch('/api/pl?year=2026&month=01&visibleWindowOnly=1&includeTrades=0');
  assert.equal(january.res.status, 200);
  assert.equal(january.data.__meta?.firstRecordedDate, '2026-01-05');
  assert.equal(january.data.__meta?.selectedMonthKey, '2026-01');
  assert.equal(january.data.__meta?.originTileInWindow, true);
});
