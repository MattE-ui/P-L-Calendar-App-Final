const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_FILE = path.join(__dirname, 'data-trade-groups-test.json');
process.env.SKIP_RATE_FETCH = 'true';
process.env.TRADE_GROUP_BROKER_ALERT_DELAY_MS = '5';

const {
  app,
  saveDB,
  loadDB,
  buildGroupCurrentPositions,
  scheduleTrading212TradeGroupAlertsForNewPosition,
  processPendingTrading212GroupAlerts
} = require('../server');

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

  const inviteUnread = await authedFetch(tokens.member, '/api/social/trade-groups/notifications/unread');
  assert.equal(inviteUnread.res.status, 200);
  assert.equal(inviteUnread.data.notifications[0].type, 'trade_group_invite');
  const acceptInvite = await authedFetch(tokens.member, `/api/social/trade-groups/invites/${inviteUnread.data.notifications[0].invite_id}/accept`, { method: 'POST' });
  assert.equal(acceptInvite.res.status, 200);

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
  assert.equal(unread.data.notifications[0].type, 'trade_group_alert');
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
  const inviteUnread = await authedFetch(tokens.member, '/api/social/trade-groups/notifications/unread');
  await authedFetch(tokens.member, `/api/social/trade-groups/invites/${inviteUnread.data.notifications[0].invite_id}/accept`, { method: 'POST' });

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


test('leader can post announcement, delete alert, and close group', async () => {
  const created = await authedFetch(tokens.leader, '/api/social/trade-groups', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ops Group' })
  });
  const groupId = created.data.group.id;
  await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}/members`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ friend_user_id: member })
  });
  const inviteUnread = await authedFetch(tokens.member, '/api/social/trade-groups/notifications/unread');
  await authedFetch(tokens.member, `/api/social/trade-groups/invites/${inviteUnread.data.notifications[0].invite_id}/accept`, { method: 'POST' });

  const announcement = await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}/announcements`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Risk off into CPI' })
  });
  assert.equal(announcement.res.status, 201);

  await authedFetch(tokens.leader, '/api/trades', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: 100, stop: 95, riskPct: 1, symbol: 'MSFT', date: '2024-04-01' })
  });
  const alerts = await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}/alerts`);
  assert.equal(alerts.res.status, 200);
  const delAlert = await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}/alerts/${alerts.data.alerts[0].id}`, { method: 'DELETE' });
  assert.equal(delAlert.res.status, 200);

  const closeGroup = await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}`, { method: 'DELETE' });
  assert.equal(closeGroup.res.status, 200);
  const memberView = await authedFetch(tokens.member, `/api/social/trade-groups/${groupId}`);
  assert.equal(memberView.res.status, 404);
});


test('group current positions prefer mapped ticker and fallback to raw symbol', () => {
  const db = loadDB();
  const now = new Date().toISOString();
  db.tradeGroups = [{ id: 'g-map', leader_user_id: leader, name: 'Map Group', is_active: true, created_at: now }];
  db.tradeGroupMembers = [{ id: 'm1', group_id: 'g-map', user_id: leader, role: 'leader', status: 'active', joined_at: now }];
  db.instrumentMappings = [{
    id: 1,
    status: 'active',
    source: 'TRADING212',
    source_key: 'TRADING212|ISIN:US-MAPPED-1',
    scope: 'user',
    user_id: leader,
    canonical_ticker: 'MAPPED',
    canonical_name: 'Mapped Inc'
  }];
  db.users[leader].tradeJournal = {
    '2024-04': [{
      id: 't-mapped',
      source: 'trading212',
      symbol: 'RAWBAD',
      trading212Ticker: 'RAWBAD_US_EQ',
      trading212Isin: 'US-MAPPED-1',
      currency: 'USD',
      entry: 100,
      stop: 95,
      riskPct: 1,
      lastSyncPrice: 101,
      status: 'open',
      createdAt: now
    }, {
      id: 't-fallback',
      source: 'trading212',
      symbol: 'RAWTICK',
      trading212Ticker: 'RAWTICK_US_EQ',
      currency: 'USD',
      entry: 50,
      stop: 45,
      riskPct: 1,
      lastSyncPrice: 52,
      status: 'open',
      createdAt: now
    }]
  };
  saveDB(db);

  const positions = buildGroupCurrentPositions(loadDB(), db.tradeGroups[0]);
  assert.equal(positions.find(p => p.id === 't-mapped').ticker, 'MAPPED');
  assert.equal(positions.find(p => p.id === 't-fallback').ticker, 'RAWTICK');
});

test('new Trading212 position schedules delayed alert, dedupes, and emits enriched stop', () => {
  const db = loadDB();
  const now = new Date().toISOString();
  db.tradeGroups = [{ id: 'g-t212', leader_user_id: leader, name: 'T212 Group', is_active: true, created_at: now }];
  db.tradeGroupMembers = [
    { id: 'gm-l', group_id: 'g-t212', user_id: leader, role: 'leader', status: 'active', joined_at: now },
    { id: 'gm-m', group_id: 'g-t212', user_id: member, role: 'member', status: 'active', joined_at: now }
  ];
  const createdAt = new Date('2024-04-01T00:00:00.000Z').toISOString();
  const trade = {
    id: 't212-open-1',
    source: 'trading212',
    symbol: 'RAW1',
    trading212Id: 'pos-1',
    trading212PositionKey: 'acc:pos-1',
    createdAt,
    entry: 100,
    riskPct: 0,
    status: 'open'
  };
  db.users[leader].tradeJournal = { '2024-04-01': [trade] };
  saveDB(db);

  let working = loadDB();
  scheduleTrading212TradeGroupAlertsForNewPosition(working, leader, trade, new Date('2024-04-01T00:00:00.000Z'));
  scheduleTrading212TradeGroupAlertsForNewPosition(working, leader, trade, new Date('2024-04-01T00:00:01.000Z'));
  assert.equal(working.tradeGroupPendingAlerts.length, 1);

  working.users[leader].tradeJournal['2024-04-01'][0].stop = 95;
  working.users[leader].tradeJournal['2024-04-01'][0].riskPct = 1;
  processPendingTrading212GroupAlerts(working, { now: new Date('2024-04-01T00:00:40.000Z') });
  assert.equal(working.tradeGroupAlerts.length, 1);
  assert.equal(working.tradeGroupAlerts[0].stop_price, 95);
  assert.equal(working.tradeGroupPendingAlerts[0].status, 'sent');
});

test('Trading212 delayed alerts send best effort without stop and cancel when position closes early', () => {
  const db = loadDB();
  const now = new Date().toISOString();
  db.tradeGroups = [{ id: 'g-best-effort', leader_user_id: leader, name: 'T212 Group 2', is_active: true, created_at: now }];
  db.tradeGroupMembers = [
    { id: 'g2-l', group_id: 'g-best-effort', user_id: leader, role: 'leader', status: 'active', joined_at: now },
    { id: 'g2-m', group_id: 'g-best-effort', user_id: member, role: 'member', status: 'active', joined_at: now }
  ];
  const createdAt = new Date('2024-04-01T01:00:00.000Z').toISOString();
  const stillOpen = {
    id: 't212-open-2',
    source: 'trading212',
    symbol: 'RAW2',
    trading212Id: 'pos-2',
    trading212PositionKey: 'acc:pos-2',
    createdAt,
    entry: 55,
    status: 'open'
  };
  const closes = {
    id: 't212-open-3',
    source: 'trading212',
    symbol: 'RAW3',
    trading212Id: 'pos-3',
    trading212PositionKey: 'acc:pos-3',
    createdAt,
    entry: 66,
    status: 'closed',
    closePrice: 67
  };
  db.users[leader].tradeJournal = { '2024-04-01': [stillOpen, closes] };

  scheduleTrading212TradeGroupAlertsForNewPosition(db, leader, stillOpen, new Date('2024-04-01T01:00:00.000Z'));
  scheduleTrading212TradeGroupAlertsForNewPosition(db, leader, closes, new Date('2024-04-01T01:00:00.000Z'));
  processPendingTrading212GroupAlerts(db, { now: new Date('2024-04-01T01:00:40.000Z') });

  assert.equal(db.tradeGroupAlerts.length, 1);
  assert.equal(db.tradeGroupAlerts[0].ticker, 'RAW2');
  assert.equal(db.tradeGroupAlerts[0].stop_price, null);
  const cancelled = db.tradeGroupPendingAlerts.find(item => item.linked_trade_id === 't212-open-3');
  assert.equal(cancelled.status, 'cancelled');
});
