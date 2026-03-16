const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_FILE = path.join(__dirname, 'data-trade-groups-test.json');
process.env.SKIP_RATE_FETCH = 'true';

const { app, saveDB, loadDB } = require('../server');

const DATA_FILE = process.env.DATA_FILE;
const leader = 'leader';
const member = 'member';
const outsider = 'outsider';
const tokens = { leader: 'token-leader', member: 'token-member', outsider: 'token-outsider' };
let server;
let baseUrl;

function seedDatabase() {
  fs.rmSync(DATA_FILE, { force: true });
  const now = new Date().toISOString();
  const db = {
    users: {
      [leader]: { username: leader, passwordHash: 'x', profileComplete: true, portfolio: 10000, initialPortfolio: 10000, tradeJournal: {}, nickname: 'Leader One', friendCode: 'LEAD-0001' },
      [member]: { username: member, passwordHash: 'x', profileComplete: true, portfolio: 10000, initialPortfolio: 10000, tradeJournal: {}, nickname: 'Member One', friendCode: 'MEMB-0001' },
      [outsider]: { username: outsider, passwordHash: 'x', profileComplete: true, portfolio: 10000, initialPortfolio: 10000, tradeJournal: {}, nickname: 'Outsider', friendCode: 'OUTS-0001' }
    },
    sessions: {
      [tokens.leader]: leader,
      [tokens.member]: member,
      [tokens.outsider]: outsider
    },
    socialProfiles: [
      { id: 'sp-1', user_id: leader, friend_code: 'LEAD-0001', social_visibility: 'private', created_at: now, updated_at: now },
      { id: 'sp-2', user_id: member, friend_code: 'MEMB-0001', social_visibility: 'private', created_at: now, updated_at: now },
      { id: 'sp-3', user_id: outsider, friend_code: 'OUTS-0001', social_visibility: 'private', created_at: now, updated_at: now }
    ],
    socialSettings: [],
    friendRequests: [],
    friendships: [{ id: 'f-1', user_one_id: leader, user_two_id: member, created_at: now }],
    tradeShareSettings: [],
    leaderboardStats: [],
    socialEventLog: []
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

async function authedFetch(token, pathName, options = {}) {
  const headers = {
    ...(options.headers || {}),
    cookie: `auth_token=${token}`
  };
  const res = await fetch(`${baseUrl}${pathName}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

test('leader can create group, add friend, and member receives alert for qualifying new trade', async () => {
  const created = await authedFetch(tokens.leader, '/api/social/trade-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Alpha Group' })
  });
  assert.equal(created.res.status, 201);
  const groupId = created.data.group.id;

  const addMember = await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friend_user_id: member })
  });
  assert.equal(addMember.res.status, 201);

  const tradeCreate = await authedFetch(tokens.leader, '/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entry: 100,
      stop: 95,
      riskPct: 1,
      symbol: 'NVDA',
      date: '2024-04-01'
    })
  });
  assert.equal(tradeCreate.res.status, 200);

  const unread = await authedFetch(tokens.member, '/api/social/trade-groups/notifications/unread');
  assert.equal(unread.res.status, 200);
  assert.equal(unread.data.notifications.length, 1);
  assert.equal(unread.data.notifications[0].ticker, 'NVDA');

  const alerts = await authedFetch(tokens.member, `/api/social/trade-groups/${groupId}/alerts`);
  assert.equal(alerts.res.status, 200);
  assert.equal(alerts.data.alerts.length, 1);
  assert.equal(alerts.data.alerts[0].risk_pct, 1);

  const db = loadDB();
  assert.equal(db.tradeGroupAlerts.length, 1);
});

test('does not create group alert when stop or risk is missing and blocks non-members', async () => {
  const created = await authedFetch(tokens.leader, '/api/social/trade-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'No Leak Group' })
  });
  const groupId = created.data.group.id;
  await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friend_user_id: member })
  });

  const noStopTrade = await authedFetch(tokens.leader, '/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry: 10, riskPct: 1, symbol: 'TSLA', date: '2024-04-02', sizeUnits: 10 })
  });
  assert.equal(noStopTrade.res.status, 200);

  const unread = await authedFetch(tokens.member, '/api/social/trade-groups/notifications/unread');
  assert.equal(unread.res.status, 200);
  assert.equal(unread.data.notifications.length, 0);

  const outsiderView = await authedFetch(tokens.outsider, `/api/social/trade-groups/${groupId}`);
  assert.equal(outsiderView.res.status, 403);
});
