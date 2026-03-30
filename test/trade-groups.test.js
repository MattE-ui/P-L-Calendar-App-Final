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
  emitTradeGroupAlertFromTrading212Fill,
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

async function waitFor(predicate, { timeoutMs = 1000, intervalMs = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
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

  const pushed = await waitFor(() => {
    const current = loadDB();
    return Array.isArray(current.notificationEvents)
      && current.notificationEvents.some((item) => item.userId === member && item.eventType === 'trade_group_alert');
  });
  assert.equal(pushed, true);

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


test('leader can post/delete announcement, delete alert, and close group', async () => {
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
  const announcementId = announcement.data.announcement.id;

  const announcementPushed = await waitFor(() => {
    const current = loadDB();
    return Array.isArray(current.notificationEvents)
      && current.notificationEvents.some((item) => item.userId === member && item.eventType === 'trade_group_announcement');
  });
  assert.equal(announcementPushed, true);

  const memberDeleteAnnouncement = await authedFetch(tokens.member, `/api/social/trade-groups/${groupId}/announcements/${announcementId}`, { method: 'DELETE' });
  assert.equal(memberDeleteAnnouncement.res.status, 403);
  const leaderDeleteAnnouncement = await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}/announcements/${announcementId}`, { method: 'DELETE' });
  assert.equal(leaderDeleteAnnouncement.res.status, 200);

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

test('announcement push targets one active device after duplicate token cleanup', async () => {
  const db = loadDB();
  const now = Date.now();
  db.notificationDevices = [
    {
      id: 'dup-device-1',
      userId: member,
      deviceId: 'iphone-1',
      platform: 'ios',
      browser: 'safari',
      userAgent: 'Mobile Safari',
      token: 'token-shared-1',
      providerType: 'fcm-web',
      permissionState: 'granted',
      isActive: true,
      installedAsPwa: true,
      categories: { criticalRiskAlerts: true, tradeAlerts: true, tradeGroupAlerts: true, brokerSyncFailures: true, dailyRecap: true, socialInvestorNotifications: true },
      createdAt: new Date(now - 30000).toISOString(),
      updatedAt: new Date(now - 30000).toISOString(),
      lastSeenAt: new Date(now - 30000).toISOString(),
      lastSentAt: null,
      lastErrorAt: null,
      lastRegistrationAt: new Date(now - 30000).toISOString(),
      lastReceivedAt: null,
      revokedAt: null
    },
    {
      id: 'dup-device-2',
      userId: member,
      deviceId: 'iphone-2',
      platform: 'ios',
      browser: 'safari',
      userAgent: 'Mobile Safari',
      token: 'token-shared-1',
      providerType: 'fcm-web',
      permissionState: 'granted',
      isActive: true,
      installedAsPwa: true,
      categories: { criticalRiskAlerts: true, tradeAlerts: true, tradeGroupAlerts: true, brokerSyncFailures: true, dailyRecap: true, socialInvestorNotifications: true },
      createdAt: new Date(now - 20000).toISOString(),
      updatedAt: new Date(now - 20000).toISOString(),
      lastSeenAt: new Date(now - 20000).toISOString(),
      lastSentAt: null,
      lastErrorAt: null,
      lastRegistrationAt: new Date(now - 20000).toISOString(),
      lastReceivedAt: null,
      revokedAt: null
    },
    {
      id: 'dup-device-3',
      userId: member,
      deviceId: 'iphone-3',
      platform: 'ios-pwa',
      browser: 'safari',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
      token: 'token-unique-mobile-3',
      providerType: 'fcm-web',
      permissionState: 'granted',
      isActive: true,
      installedAsPwa: false,
      categories: { criticalRiskAlerts: true, tradeAlerts: true, tradeGroupAlerts: true, brokerSyncFailures: true, dailyRecap: true, socialInvestorNotifications: true },
      createdAt: new Date(now - 10000).toISOString(),
      updatedAt: new Date(now - 10000).toISOString(),
      lastSeenAt: new Date(now - 10000).toISOString(),
      lastSentAt: null,
      lastErrorAt: null,
      lastRegistrationAt: new Date(now - 10000).toISOString(),
      lastReceivedAt: null,
      revokedAt: null
    }
  ];
  saveDB(db);

  const created = await authedFetch(tokens.leader, '/api/social/trade-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dedup Group' })
  });
  assert.equal(created.res.status, 201);
  const groupId = created.data.group.id;
  await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friend_user_id: member })
  });
  const inviteUnread = await authedFetch(tokens.member, '/api/social/trade-groups/notifications/unread');
  await authedFetch(tokens.member, `/api/social/trade-groups/invites/${inviteUnread.data.notifications[0].invite_id}/accept`, { method: 'POST' });

  const announcement = await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}/announcements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Single push please' })
  });
  assert.equal(announcement.res.status, 201);

  const sent = await waitFor(() => {
    const current = loadDB();
    return Array.isArray(current.notificationEvents)
      && current.notificationEvents.some((item) => item.eventType === 'trade_group_announcement' && item.userId === member);
  });
  assert.equal(sent, true);

  const after = loadDB();
  const announcementEvent = after.notificationEvents.find((item) => item.eventType === 'trade_group_announcement' && item.userId === member);
  assert.ok(announcementEvent);
  assert.equal(announcementEvent.deliveries.length, 1);

  const activeRows = after.notificationDevices.filter((item) => item.userId === member && item.isActive);
  assert.equal(activeRows.length, 1);
  assert.equal(activeRows[0].id, 'dup-device-3');
});

test('notification device delete endpoint is idempotent soft-delete and blocks future sends', async () => {
  const now = new Date().toISOString();
  const db = loadDB();
  db.notificationDevices = [{
    id: 'remove-me',
    userId: member,
    deviceId: 'member-phone',
    platform: 'ios-pwa',
    browser: 'safari',
    userAgent: 'Mobile Safari',
    token: 'token-remove-me-12345678901234567890',
    providerType: 'fcm-web',
    permissionState: 'granted',
    isActive: true,
    installedAsPwa: true,
    categories: { criticalRiskAlerts: true, tradeAlerts: true, tradeGroupAlerts: true, brokerSyncFailures: true, dailyRecap: true, socialInvestorNotifications: true },
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    lastSentAt: null,
    lastErrorAt: null,
    lastRegistrationAt: now,
    lastReceivedAt: null,
    revokedAt: null
  }];
  saveDB(db);

  const removeRes = await authedFetch(tokens.member, '/api/notifications/device/remove-me', { method: 'DELETE' });
  assert.equal(removeRes.res.status, 200);
  assert.equal(removeRes.data.ok, true);

  const removeAgainRes = await authedFetch(tokens.member, '/api/notifications/device/remove-me', { method: 'DELETE' });
  assert.equal(removeAgainRes.res.status, 200);
  assert.equal(removeAgainRes.data.ok, true);

  const after = loadDB();
  const removed = after.notificationDevices.find((item) => item.id === 'remove-me');
  assert.ok(removed);
  assert.equal(removed.isActive, false);

  const testPush = await authedFetch(tokens.member, '/api/notifications/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(testPush.res.status, 400);
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

test('Trading212 fill-based leader alerts emit sell metadata and dedupe on fill id', () => {
  const db = loadDB();
  const now = new Date().toISOString();
  db.tradeGroups = [{ id: 'g-fill', leader_user_id: leader, name: 'Fill Group', is_active: true, created_at: now }];
  db.tradeGroupMembers = [
    { id: 'gf-l', group_id: 'g-fill', user_id: leader, role: 'leader', status: 'active', joined_at: now },
    { id: 'gf-m', group_id: 'g-fill', user_id: member, role: 'member', status: 'active', joined_at: now }
  ];
  const first = emitTradeGroupAlertFromTrading212Fill(db, leader, {
    fillId: 'fill-1',
    side: 'SELL',
    ticker: 'AAPL',
    fillPrice: 120.5,
    quantity: 2,
    remainingQuantity: 1,
    realizedPnlGbp: 40,
    stopTriggered: true
  });
  assert.equal(first.alertsCreated, 1);
  assert.equal(db.tradeGroupAlerts[0].alert_classification, 'partial_sell');
  assert.equal(db.tradeGroupAlerts[0].side, 'SELL');
  assert.equal(db.tradeGroupAlerts[0].stop_triggered, true);

  const second = emitTradeGroupAlertFromTrading212Fill(db, leader, {
    fillId: 'fill-1',
    side: 'SELL',
    ticker: 'AAPL',
    fillPrice: 120.5,
    quantity: 2
  });
  assert.equal(second.alertsCreated, 0);
  assert.equal(second.duplicates, 1);
});
