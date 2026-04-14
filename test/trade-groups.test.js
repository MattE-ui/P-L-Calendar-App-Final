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
  normalizeTradeGroupActivityEvent,
  emitTradeGroupSellAlertForClosedTrade,
  emitTradeGroupTrimAlertForTrade,
  emitTradeGroupAlertFromTrading212Fill,
  coalesceTrading212FillEvents,
  processLeaderTradeDisappearancesAfterValidSnapshot,
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

async function createAcceptedGroup() {
  const created = await authedFetch(tokens.leader, '/api/social/trade-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Chat Group' })
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
  const invite = inviteUnread.data.notifications.find((item) => item.type === 'trade_group_invite');
  assert.ok(invite);
  const acceptInvite = await authedFetch(tokens.member, `/api/social/trade-groups/invites/${invite.invite_id}/accept`, { method: 'POST' });
  assert.equal(acceptInvite.res.status, 200);
  return groupId;
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

test('emitTradeGroupAlertFromTrading212Fill emits SELL alerts for partial and full closes', () => {
  const db = loadDB();
  const now = new Date().toISOString();
  db.tradeGroups = [{
    id: 'group-sell-1',
    leader_user_id: leader,
    name: 'Sell Group',
    is_active: true,
    created_at: now
  }];
  db.tradeGroupMembers = [{
    id: 'member-sell-1',
    group_id: 'group-sell-1',
    user_id: leader,
    role: 'leader',
    status: 'active',
    joined_at: now
  }, {
    id: 'member-sell-2',
    group_id: 'group-sell-1',
    user_id: member,
    role: 'member',
    status: 'active',
    joined_at: now
  }];
  db.tradeGroupAlerts = [];
  db.tradeGroupNotifications = [];
  saveDB(db);

  const partial = emitTradeGroupAlertFromTrading212Fill(db, leader, {
    fillId: 'sell-fill-partial',
    orderId: 'sell-order-1',
    side: 'SELL',
    ticker: 'AAPL',
    quantity: 1,
    previousQuantity: 10,
    remainingQuantity: 2,
    fillPrice: 182.75,
    tradeStatus: 'open',
    filledAt: now,
    sourceTradeId: 'trade-1'
  });
  const full = emitTradeGroupAlertFromTrading212Fill(db, leader, {
    fillId: 'sell-fill-full',
    orderId: 'sell-order-2',
    side: 'SELL',
    ticker: 'AAPL',
    quantity: 2,
    remainingQuantity: 0,
    tradeStatus: 'closed',
    filledAt: now,
    sourceTradeId: 'trade-1'
  });

  assert.equal(partial.alertsCreated, 1);
  assert.equal(full.alertsCreated, 1);
  const sellAlerts = db.tradeGroupAlerts.filter((item) => item.side === 'SELL');
  assert.equal(sellAlerts.length, 2);
  assert.equal(sellAlerts[0].alert_classification, 'partial_sell');
  assert.equal(sellAlerts[0].position_event_type, 'POSITION_TRIM');
  assert.equal(sellAlerts[0].trim_pct, 80);
  assert.equal(sellAlerts[0].fill_price, 182.75);
  assert.equal(sellAlerts[1].alert_classification, 'full_close');
});

test('manual trim emits one POSITION_TRIM alert without quantity disclosure', () => {
  const db = loadDB();
  const now = new Date().toISOString();
  db.tradeGroups = [{
    id: 'group-trim-1',
    leader_user_id: leader,
    name: 'Trim Group',
    is_active: true,
    created_at: now
  }];
  db.tradeGroupMembers = [{
    id: 'member-trim-1',
    group_id: 'group-trim-1',
    user_id: leader,
    role: 'leader',
    status: 'active',
    joined_at: now
  }, {
    id: 'member-trim-2',
    group_id: 'group-trim-1',
    user_id: member,
    role: 'member',
    status: 'active',
    joined_at: now
  }];
  const trade = { id: 'trim-trade-1', symbol: 'NVDA', source: 'manual', sizeUnits: 90 };
  const result = emitTradeGroupTrimAlertForTrade(db, leader, trade, {
    previousQty: 100,
    newQty: 90,
    fillPrice: 842.15,
    trimDate: now,
    eventKey: 'manual-trim:1'
  });
  assert.equal(result.alertsCreated, 1);
  assert.equal(db.tradeGroupAlerts.length, 1);
  assert.equal(db.tradeGroupAlerts[0].position_event_type, 'POSITION_TRIM');
  assert.equal(db.tradeGroupAlerts[0].trim_pct, 10);
  assert.equal(db.tradeGroupAlerts[0].fill_price, 842.15);
  assert.equal(db.tradeGroupAlerts[0].quantity ?? null, null);
});

test('manual trim unread payload and notification body are trim-specific (not close)', async () => {
  const created = await authedFetch(tokens.leader, '/api/social/trade-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Trim Banner Group' })
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
  const inviteId = inviteUnread.data.notifications[0]?.invite_id;
  const acceptInvite = await authedFetch(tokens.member, `/api/social/trade-groups/invites/${inviteId}/accept`, { method: 'POST' });
  assert.equal(acceptInvite.res.status, 200);

  const tradeCreate = await authedFetch(tokens.leader, '/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entry: 40,
      stop: 36,
      riskPct: 1,
      symbol: 'TEST',
      date: '2026-04-01'
    })
  });
  assert.equal(tradeCreate.res.status, 200);
  const tradeId = tradeCreate.data.trade.id;

  const trimRes = await authedFetch(tokens.leader, `/api/trades/${tradeId}/trim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      units: 1,
      price: 40.87,
      date: '2026-04-02'
    })
  });
  assert.equal(trimRes.res.status, 200);

  const unread = await authedFetch(tokens.member, '/api/social/trade-groups/notifications/unread');
  assert.equal(unread.res.status, 200);
  const trimNotification = unread.data.notifications.find((item) => item.type === 'trade_group_alert' && item.ticker === 'TEST');
  assert.ok(trimNotification);
  assert.equal(trimNotification.position_event_type, 'POSITION_TRIM');
  assert.equal(trimNotification.normalized_event_type, 'TRADE_TRIMMED');

  const pushed = await waitFor(() => {
    const current = loadDB();
    return Array.isArray(current.notificationEvents)
      && current.notificationEvents.some((item) => item.userId === member && item.eventType === 'trade_group_alert' && /trimmed/i.test(item.body || ''));
  });
  assert.equal(pushed, true);

  const db = loadDB();
  const trimPush = db.notificationEvents
    .filter((item) => item.userId === member && item.eventType === 'trade_group_alert')
    .find((item) => /trimmed/i.test(item.body || ''));
  assert.ok(trimPush);
  assert.equal(/closed/i.test(trimPush.body || ''), false);
});



test('normalizeTradeGroupActivityEvent classifies trim and close semantics consistently', () => {
  assert.equal(normalizeTradeGroupActivityEvent({ side: 'SELL', remaining_quantity: 3, trim_pct: 10 }), 'trim');
  assert.equal(normalizeTradeGroupActivityEvent({ side: 'SELL', event_subtype: 'trim' }), 'trim');
  assert.equal(normalizeTradeGroupActivityEvent({ side: 'SELL', remaining_quantity: 0 }), 'close');
  assert.equal(normalizeTradeGroupActivityEvent({ type: 'announcement' }), 'announcement');
});

test('summary and full trade-group feeds keep trim classification aligned for same event', async () => {
  const groupId = await createAcceptedGroup();

  const tradeCreate = await authedFetch(tokens.leader, '/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entry: 50,
      stop: 45,
      riskPct: 1,
      symbol: 'BE',
      date: '2026-04-03'
    })
  });
  assert.equal(tradeCreate.res.status, 200);
  const tradeId = tradeCreate.data.trade.id;

  const trimRes = await authedFetch(tokens.leader, `/api/trades/${tradeId}/trim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      units: 1,
      price: 55,
      date: '2026-04-04'
    })
  });
  assert.equal(trimRes.res.status, 200);

  const summary = await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}?view=summary&feed_limit=8`);
  assert.equal(summary.res.status, 200);
  const full = await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}`);
  assert.equal(full.res.status, 200);

  const summaryTrim = summary.data.feed.find((item) => item.type === 'alert' && item.ticker === 'BE' && item.side === 'SELL');
  const fullTrim = full.data.feed.find((item) => item.type === 'alert' && item.ticker === 'BE' && item.side === 'SELL');
  assert.ok(summaryTrim);
  assert.ok(fullTrim);
  assert.equal(summaryTrim.normalized_event_type, 'TRADE_TRIMMED');
  assert.equal(fullTrim.normalized_event_type, 'TRADE_TRIMMED');
});
test('coalesceTrading212FillEvents merges nearby partial sell fills with weighted average price', () => {
  const merged = coalesceTrading212FillEvents([
    { fillId: 'f1', orderId: 'o-1', accountId: 'acc', sourceTradeId: 'trade-1', side: 'SELL', ticker: 'SOUN', quantity: 10, fillPrice: 7.0, remainingQuantity: 90, tradeStatus: 'open', filledAt: '2026-04-08T10:00:00.000Z' },
    { fillId: 'f2', orderId: 'o-1', accountId: 'acc', sourceTradeId: 'trade-1', side: 'SELL', ticker: 'SOUN', quantity: 30, fillPrice: 8.0, remainingQuantity: 60, tradeStatus: 'open', filledAt: '2026-04-08T10:00:05.000Z' }
  ], { windowMs: 15000 });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].quantity, 40);
  assert.equal(merged[0].fillPrice, 7.75);
  assert.equal(merged[0].remainingQuantity, 60);
});

test('derived fill identity dedupes repeated BUY events without fillId', () => {
  const db = loadDB();
  const now = new Date().toISOString();
  db.tradeGroups = [{
    id: 'group-buy-1',
    leader_user_id: leader,
    name: 'Buy Group',
    is_active: true,
    created_at: now
  }];
  db.tradeGroupMembers = [{
    id: 'member-buy-1',
    group_id: 'group-buy-1',
    user_id: leader,
    role: 'leader',
    status: 'active',
    joined_at: now
  }];
  db.tradeGroupAlerts = [];
  saveDB(db);

  const fillEvent = {
    fillId: '',
    orderId: 'order-buy-1',
    side: 'BUY',
    ticker: 'NVDA',
    quantity: 3,
    filledAt: '2026-03-25T10:00:00Z',
    sourceTradeId: 'trade-buy-1'
  };
  const first = emitTradeGroupAlertFromTrading212Fill(db, leader, fillEvent);
  const second = emitTradeGroupAlertFromTrading212Fill(db, leader, fillEvent);

  assert.equal(first.alertsCreated, 1);
  assert.equal(second.alertsCreated, 0);
  assert.equal(second.duplicates, 1);
  assert.equal(db.tradeGroupAlerts.length, 1);
  assert.match(String(db.tradeGroupAlerts[0].broker_event_key || ''), /^derived\|/);
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

test('group detail refresh returns newly emitted alerts without requiring full page reload', async () => {
  const created = await authedFetch(tokens.leader, '/api/social/trade-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Refresh Group' })
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

  const db = loadDB();
  emitTradeGroupAlertFromTrading212Fill(db, leader, {
    fillId: 'refresh-fill-1',
    orderId: 'refresh-order-1',
    side: 'BUY',
    ticker: 'MSFT',
    fillPrice: 410,
    quantity: 1,
    filledAt: '2026-03-20T10:00:00Z',
    sourceTradeId: 'refresh-trade-1'
  });
  saveDB(db);

  const firstFetch = await authedFetch(tokens.member, `/api/social/trade-groups/${groupId}`);
  assert.equal(firstFetch.res.status, 200);
  assert.equal(firstFetch.data.feed[0].id ? true : false, true);

  const dbAfter = loadDB();
  emitTradeGroupAlertFromTrading212Fill(dbAfter, leader, {
    fillId: 'refresh-fill-2',
    orderId: 'refresh-order-2',
    side: 'SELL',
    ticker: 'MSFT',
    fillPrice: 420,
    quantity: 1,
    remainingQuantity: 0,
    tradeStatus: 'closed',
    filledAt: '2026-03-20T10:30:00Z',
    sourceTradeId: 'refresh-trade-1'
  });
  saveDB(dbAfter);

  const secondFetch = await authedFetch(tokens.member, `/api/social/trade-groups/${groupId}`);
  assert.equal(secondFetch.res.status, 200);
  assert.equal(secondFetch.data.feed[0].id === firstFetch.data.feed[0].id, false);
  assert.equal(secondFetch.data.feed[0].side, 'SELL');
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

test('legacy notification device rows are backfilled and still eligible to receive sends', async () => {
  const now = new Date().toISOString();
  const db = loadDB();
  db.notificationDevices = [{
    id: 'legacy-row-1',
    userId: member,
    deviceId: 'legacy-phone',
    platform: 'ios-pwa',
    browser: 'safari',
    userAgent: 'Mobile Safari',
    token: 'legacy-token-abcdefghijklmnopqrstuvwxyz',
    isActive: true,
    createdAt: now
  }];
  saveDB(db);

  const devices = await authedFetch(tokens.member, '/api/notifications/devices');
  assert.equal(devices.res.status, 200);
  assert.equal(devices.data.devices.length, 1);
  assert.equal(devices.data.devices[0].permissionState, 'granted');
  assert.equal(devices.data.devices[0].categories.tradeGroupAlerts, true);

  const testPush = await authedFetch(tokens.member, '/api/notifications/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.notEqual(testPush.res.status, 400);
  assert.notEqual(testPush.data.error, 'No active push-registered devices found. Enable notifications on this device first.');
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
  assert.equal(db.tradeGroupAlerts[0].fill_price, 120.5);
  assert.equal(db.tradeGroupAlerts[0].quantity, null);

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

test('snapshot disappearance requires confirmation and cancels on reappearance', () => {
  const db = loadDB();
  const now = new Date().toISOString();
  db.tradeGroups = [{ id: 'g-disappear', leader_user_id: leader, name: 'Disappear Group', is_active: true, created_at: now }];
  db.tradeGroupMembers = [
    { id: 'gd-l', group_id: 'g-disappear', user_id: leader, role: 'leader', status: 'active', joined_at: now },
    { id: 'gd-m', group_id: 'g-disappear', user_id: member, role: 'member', status: 'active', joined_at: now }
  ];
  db.users[leader].tradeJournal = {
    '2024-05-01': [{
      id: 'trade-disappear',
      symbol: 'KOS',
      source: 'trading212',
      status: 'open',
      entry: 10,
      trading212AccountId: 'acc-1',
      trading212PositionKey: 'acc-1:KOS',
      createdAt: now
    }]
  };
  db.users[leader].trading212 = { leaderAlertState: { accounts: {} } };

  processLeaderTradeDisappearancesAfterValidSnapshot(db, {
    user: db.users[leader],
    username: leader,
    cfg: db.users[leader].trading212,
    accountId: 'acc-1',
    presentPositionByKey: {}
  });
  assert.equal(db.tradeGroupAlerts.length, 0);

  processLeaderTradeDisappearancesAfterValidSnapshot(db, {
    user: db.users[leader],
    username: leader,
    cfg: db.users[leader].trading212,
    accountId: 'acc-1',
    presentPositionByKey: { 'acc-1:KOS': 1 }
  });
  assert.equal(db.tradeGroupAlerts.length, 0);

  processLeaderTradeDisappearancesAfterValidSnapshot(db, {
    user: db.users[leader],
    username: leader,
    cfg: db.users[leader].trading212,
    accountId: 'acc-1',
    presentPositionByKey: {}
  });
  assert.equal(db.tradeGroupAlerts.length, 0);

  processLeaderTradeDisappearancesAfterValidSnapshot(db, {
    user: db.users[leader],
    username: leader,
    cfg: db.users[leader].trading212,
    accountId: 'acc-1',
    presentPositionByKey: {}
  });
  assert.equal(db.tradeGroupAlerts.length, 1);
  assert.equal(db.tradeGroupAlerts[0].side, 'SELL');
  assert.equal(db.tradeGroupAlerts[0].alert_classification, 'full_close');
});

test('manual close sell alert dedupes against later reconciliation alert', () => {
  const db = loadDB();
  const now = new Date().toISOString();
  db.tradeGroups = [{ id: 'g-manual', leader_user_id: leader, name: 'Manual Group', is_active: true, created_at: now }];
  db.tradeGroupMembers = [
    { id: 'gm-l', group_id: 'g-manual', user_id: leader, role: 'leader', status: 'active', joined_at: now },
    { id: 'gm-m', group_id: 'g-manual', user_id: member, role: 'member', status: 'active', joined_at: now }
  ];
  const trade = {
    id: 'trade-manual',
    symbol: 'KOS',
    source: 'trading212',
    status: 'closed',
    closePrice: 14,
    trading212AccountId: 'acc-1',
    trading212PositionKey: 'acc-1:KOS',
    createdAt: now
  };
  db.users[leader].tradeJournal = { '2024-05-01': [trade] };
  const manual = emitTradeGroupSellAlertForClosedTrade(db, leader, trade, { reason: 'manual_close', classification: 'full_close' });
  assert.equal(manual.alertsCreated, 1);
  assert.equal(db.tradeGroupAlerts.length, 1);
  const reconcileAttempt = emitTradeGroupAlertFromTrading212Fill(db, leader, {
    fillId: 'fill-manual',
    side: 'SELL',
    ticker: 'KOS',
    sourceTradeId: 'trade-manual',
    quantity: 1
  });
  assert.equal(reconcileAttempt.alertsCreated, 0);
  assert.equal(reconcileAttempt.duplicates, 1);
  assert.equal(db.tradeGroupAlerts.length, 1);
});

test('group chat mention pipeline sends user mentions and preserves unknown mentions as text', async () => {
  const groupId = await createAcceptedGroup();
  const sent = await authedFetch(tokens.leader, `/api/group-chats/${groupId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '@member yoooo hello @notarealuser', rawText: '@member yoooo hello @notarealuser', messageType: 'user_message' })
  });
  assert.equal(sent.res.status, 201);
  assert.equal(sent.data.message.rawText, '@member yoooo hello @notarealuser');
  assert.equal(sent.data.message.mentions.length, 1);
  assert.equal(sent.data.message.mentions[0].type, 'user');
  assert.equal(sent.data.message.mentions[0].targetId, member);
  const unread = await authedFetch(tokens.member, '/api/social/trade-groups/notifications/unread');
  assert.equal(unread.res.status, 200);
  assert.equal(unread.data.notifications.some((item) => item.type === 'trade_group_chat_mention'), true);
});

test('group chat accepts structured selected role mentions from composer payload', async () => {
  const groupId = await createAcceptedGroup();
  const roleCreate = await authedFetch(tokens.leader, `/api/group-chats/${groupId}/roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Risk Team' })
  });
  assert.equal(roleCreate.res.status, 201);
  const roleId = roleCreate.data.role.id;

  const assign = await authedFetch(tokens.leader, `/api/group-chats/${groupId}/roles/assignments`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: member, roleIds: [roleId] })
  });
  assert.equal(assign.res.status, 200);

  const content = '@Risk Team please review';
  const sent = await authedFetch(tokens.leader, `/api/group-chats/${groupId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      rawText: content,
      messageType: 'user_message',
      entities: [{ type: 'mention', mentionType: 'role', targetId: roleId, displayText: '@Risk Team', start: 0, end: 10 }],
      mentions: [{ type: 'role', targetId: roleId, displayText: '@Risk Team' }]
    })
  });
  assert.equal(sent.res.status, 201);
  assert.equal(sent.data.message.mentions.some((item) => item.type === 'role' && item.targetId === roleId), true);

  const unread = await authedFetch(tokens.member, '/api/social/trade-groups/notifications/unread');
  assert.equal(unread.res.status, 200);
  assert.equal(unread.data.notifications.some((item) => item.type === 'trade_group_chat_mention'), true);
});

test('group chat reserved mention permissions return explicit errors and @time degrades to plain text', async () => {
  const groupId = await createAcceptedGroup();
  const blockedEveryone = await authedFetch(tokens.member, `/api/group-chats/${groupId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '@everyone test', messageType: 'user_message' })
  });
  assert.equal(blockedEveryone.res.status, 403);
  assert.equal(blockedEveryone.data.error, 'You do not have permission to mention @everyone.');

  const plainTime = await authedFetch(tokens.member, `/api/group-chats/${groupId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '@time check this', messageType: 'user_message' })
  });
  assert.equal(plainTime.res.status, 201);
  assert.equal(plainTime.data.message.rawText, '@time check this');
  assert.equal(Array.isArray(plainTime.data.message.mentions), true);
  assert.equal(plainTime.data.message.mentions.length, 0);

  const allowedEveryone = await authedFetch(tokens.leader, `/api/group-chats/${groupId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '@everyone heads up', messageType: 'user_message' })
  });
  assert.equal(allowedEveryone.res.status, 201);
});
