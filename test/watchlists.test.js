const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_FILE = path.join(__dirname, 'data-watchlists-test.json');
process.env.SKIP_RATE_FETCH = 'true';

const { app, saveDB, loadDB, composeWatchlistMetrics } = require('../server');

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
  saveDB({
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
  });
}

async function authedFetch(token, pathName, options = {}) {
  const headers = {
    ...(options.headers || {}),
    cookie: `auth_token=${token}`
  };
  const res = await fetch(`${baseUrl}${pathName}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function createGroupWithMember() {
  const created = await authedFetch(tokens.leader, '/api/social/trade-groups', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Alpha Group' })
  });
  assert.equal(created.res.status, 201);
  const groupId = created.data.group.id;

  const addMember = await authedFetch(tokens.leader, `/api/social/trade-groups/${groupId}/members`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ friend_user_id: member })
  });
  assert.equal(addMember.res.status, 201);

  const invites = await authedFetch(tokens.member, '/api/social/trade-groups/notifications/unread');
  const invite = invites.data.notifications.find((item) => item.type === 'trade_group_invite');
  assert.ok(invite?.invite_id);
  const accepted = await authedFetch(tokens.member, `/api/social/trade-groups/invites/${invite.invite_id}/accept`, { method: 'POST' });
  assert.equal(accepted.res.status, 200);
  return groupId;
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

test('watchlists CRUD, ticker validation, and duplicate prevention work', async () => {
  const created = await authedFetch(tokens.leader, '/api/watchlists', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Growth' })
  });
  assert.equal(created.res.status, 201);
  const watchlistId = created.data.watchlist.id;

  const addTicker = await authedFetch(tokens.leader, `/api/watchlists/${watchlistId}/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: 'AAPL' })
  });
  assert.equal(addTicker.res.status, 201);

  const duplicate = await authedFetch(tokens.leader, `/api/watchlists/${watchlistId}/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: 'aapl' })
  });
  assert.equal(duplicate.res.status, 409);

  const invalidTicker = await authedFetch(tokens.leader, `/api/watchlists/${watchlistId}/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: '$$$$' })
  });
  assert.equal(invalidTicker.res.status, 400);

  const renamed = await authedFetch(tokens.leader, `/api/watchlists/${watchlistId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Growth Core' })
  });
  assert.equal(renamed.res.status, 200);
  assert.equal(renamed.data.watchlist.name, 'Growth Core');

  const deleted = await authedFetch(tokens.leader, `/api/watchlists/${watchlistId}`, { method: 'DELETE' });
  assert.equal(deleted.res.status, 200);
});

test('group watchlist posting permissions and notifications are enforced', async () => {
  const groupId = await createGroupWithMember();
  const created = await authedFetch(tokens.leader, '/api/watchlists', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Leaders Picks' })
  });
  const watchlistId = created.data.watchlist.id;

  const nonLeaderPost = await authedFetch(tokens.member, `/api/trading-groups/${groupId}/watchlists`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceWatchlistId: watchlistId })
  });
  assert.equal(nonLeaderPost.res.status, 403);

  const leaderPost = await authedFetch(tokens.leader, `/api/trading-groups/${groupId}/watchlists`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceWatchlistId: watchlistId })
  });
  assert.equal(leaderPost.res.status, 201);

  const memberWatchlists = await authedFetch(tokens.member, `/api/trading-groups/${groupId}/watchlists`);
  assert.equal(memberWatchlists.res.status, 200);
  assert.equal(memberWatchlists.data.watchlists.length, 1);

  const memberUnread = await authedFetch(tokens.member, '/api/social/trade-groups/notifications/unread');
  const postedNotification = memberUnread.data.notifications.find((item) => item.type === 'trade_group_watchlist_posted');
  assert.ok(postedNotification);
  assert.equal(postedNotification.group_id, groupId);
  assert.equal(postedNotification.group_watchlist_id, leaderPost.data.groupWatchlist.id);

  const selfUnread = await authedFetch(tokens.leader, '/api/social/trade-groups/notifications/unread');
  assert.equal(selfUnread.data.notifications.some((item) => item.type === 'trade_group_watchlist_posted'), false);

  const updated = await authedFetch(tokens.leader, `/api/watchlists/${watchlistId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Leaders Picks v2' })
  });
  assert.equal(updated.res.status, 200);

  const db = loadDB();
  const postedNotifications = db.tradeGroupNotifications.filter((item) => item.type === 'trade_group_watchlist_posted');
  assert.equal(postedNotifications.length, 1);
});

test('deleting a watchlist posted to groups is blocked with a clear error', async () => {
  const groupId = await createGroupWithMember();
  const created = await authedFetch(tokens.leader, '/api/watchlists', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Shared WL' })
  });
  const watchlistId = created.data.watchlist.id;

  const leaderPost = await authedFetch(tokens.leader, `/api/trading-groups/${groupId}/watchlists`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceWatchlistId: watchlistId })
  });
  assert.equal(leaderPost.res.status, 201);

  const blockedDelete = await authedFetch(tokens.leader, `/api/watchlists/${watchlistId}`, { method: 'DELETE' });
  assert.equal(blockedDelete.res.status, 409);
  assert.equal(blockedDelete.data.code, 'watchlist_posted_to_group');
  assert.equal(blockedDelete.data.linkedGroupCount, 1);
});

test('composeWatchlistMetrics computes % today from previous close and handles missing previous close', () => {
  const withPreviousClose = composeWatchlistMetrics('AAPL', {
    currentPrice: 110,
    dayOpenPrice: 105,
    previousClosePrice: 100,
    volume: 2000000,
    currency: 'USD',
    marketState: 'regular',
    quoteAt: '2026-04-08T10:00:00.000Z'
  }, {
    adrPercent: 2.1,
    asOfSessionTs: '2026-04-07T21:00:00.000Z',
    historyAt: '2026-04-08T10:00:00.000Z'
  });
  assert.equal(withPreviousClose.dayOpenPrice, 105);
  assert.equal(withPreviousClose.previousClosePrice, 100);
  assert.ok(Math.abs(withPreviousClose.percentChangeToday - 10) < 0.0001);

  const withoutPreviousClose = composeWatchlistMetrics('AAPL', {
    currentPrice: 110,
    dayOpenPrice: 105,
    previousClosePrice: null,
    volume: 2000000,
    quoteAt: '2026-04-08T10:00:00.000Z'
  }, null);
  assert.equal(withoutPreviousClose.percentChangeToday, null);
});

test('group watchlist copy supports new/append, dedupes symbols, and blocks non-members', async () => {
  const groupId = await createGroupWithMember();
  const created = await authedFetch(tokens.leader, '/api/watchlists', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Leader Shared' })
  });
  const leaderWatchlistId = created.data.watchlist.id;
  await authedFetch(tokens.leader, `/api/watchlists/${leaderWatchlistId}/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: 'AAPL' })
  });
  await authedFetch(tokens.leader, `/api/watchlists/${leaderWatchlistId}/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: 'MSFT' })
  });
  const posted = await authedFetch(tokens.leader, `/api/trading-groups/${groupId}/watchlists`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceWatchlistId: leaderWatchlistId })
  });
  assert.equal(posted.res.status, 201);
  const groupWatchlistId = posted.data.groupWatchlist.id;

  const newCopy = await authedFetch(tokens.member, `/api/trading-groups/${groupId}/watchlists/${groupWatchlistId}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'new', name: 'Copied from Group' })
  });
  assert.equal(newCopy.res.status, 201);
  assert.equal(newCopy.data.addedCount, 2);
  const targetWatchlistId = newCopy.data.watchlist.id;

  const appendDuplicate = await authedFetch(tokens.member, `/api/trading-groups/${groupId}/watchlists/${groupWatchlistId}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'append', targetWatchlistId })
  });
  assert.equal(appendDuplicate.res.status, 200);
  assert.equal(appendDuplicate.data.addedCount, 0);
  assert.equal(appendDuplicate.data.skippedDuplicates, 2);

  const outsiderAttempt = await authedFetch(tokens.outsider, `/api/trading-groups/${groupId}/watchlists/${groupWatchlistId}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'new', name: 'Should fail' })
  });
  assert.equal(outsiderAttempt.res.status, 403);
});
