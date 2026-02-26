const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

process.env.DATA_FILE = path.join(__dirname, 'data-investor-test.json');
process.env.SKIP_RATE_FETCH = 'true';
process.env.INVESTOR_TOKEN_SECRET = 'investor-test-secret';

const { app, saveDB } = require('../server');

const DATA_FILE = process.env.DATA_FILE;
let server;
let baseUrl;

function signToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.INVESTOR_TOKEN_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

test.beforeEach(async () => {
  fs.rmSync(DATA_FILE, { force: true });
  const passwordHash = await bcrypt.hash('MasterPass123!', 10);
  const investorHash = await bcrypt.hash('InvestorPass123!', 10);
  const now = new Date().toISOString();
  saveDB({
    users: {
      master: { username: 'master', passwordHash, profileComplete: true, investorAccountsEnabled: true, portfolioHistory: {}, tradeJournal: {}, trading212: {}, security: {} }
    },
    sessions: {
      mastertoken: 'master'
    },
    investorProfiles: [
      { id: 'inv-1', masterUserId: 'master', displayName: 'Alice', status: 'active', createdAt: now },
      { id: 'inv-2', masterUserId: 'master', displayName: 'Bob', status: 'active', createdAt: now },
      { id: 'inv-foreign', masterUserId: 'other-master', displayName: 'Mallory', status: 'active', createdAt: now }
    ],
    investorLogins: [
      { id: 'login-1', investorProfileId: 'inv-1', email: 'alice@example.com', passwordHash: investorHash, lastLoginAt: null, createdAt: now }
    ],
    investorPermissions: [
      { investorProfileId: 'inv-1', canViewPositions: false, canViewTradeLog: false, canViewNotes: true, createdAt: now },
      { investorProfileId: 'inv-2', canViewPositions: false, canViewTradeLog: false, canViewNotes: true, createdAt: now }
    ],
    investorCashflows: [
      { id: 'c1', investorProfileId: 'inv-1', type: 'deposit', amount: 1000, currency: 'GBP', effectiveDate: '2026-01-01', navReferenceDate: '2026-01-01', reference: '', createdAt: now },
      { id: 'c2', investorProfileId: 'inv-2', type: 'deposit', amount: 7000, currency: 'GBP', effectiveDate: '2026-01-01', navReferenceDate: '2026-01-01', reference: '', createdAt: now }
    ],
    masterValuations: [
      { id: 'mv1', masterUserId: 'master', valuationDate: '2026-01-01', nav: 1000, createdAt: now },
      { id: 'mv2', masterUserId: 'master', valuationDate: '2026-01-02', nav: 1200, createdAt: now }
    ],
    investorInvites: [],
    investorSessions: {}
  });
  if (server) server.close();
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(DATA_FILE, { force: true });
});

test('investor session cannot access master endpoints', async () => {
  const loginRes = await fetch(`${baseUrl}/api/investor/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'InvestorPass123!' })
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.get('set-cookie');
  const res = await fetch(`${baseUrl}/api/master/investors`, { headers: { cookie } });
  assert.equal(res.status, 401);
});

test('investor sees only own summary data', async () => {
  const loginRes = await fetch(`${baseUrl}/api/investor/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'InvestorPass123!' })
  });
  const cookie = loginRes.headers.get('set-cookie');
  const res = await fetch(`${baseUrl}/api/investor/summary`, { headers: { cookie } });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.net_contributions, 1000);
  assert.equal(data.nav_today, 1200);
  assert.equal(data.total_units, 1);
  assert.equal(data.current_value_gross, 1200);
  assert.equal(data.investor_profit_share, 160);
  assert.equal(data.investor_net_value, 1160);
  assert.equal(data.investor_return_pct, 0.16);
});

test('unit model handles multiple deposits, withdrawal, fee, and split updates deterministically', async () => {
  let res = await fetch(`${baseUrl}/api/master/valuations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ valuation_date: '2026-01-03', nav: 900 })
  });
  assert.equal(res.status, 201);

  // +1000/1000 = +1.0 units
  res = await fetch(`${baseUrl}/api/master/investors/inv-1/cashflows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ type: 'deposit', amount: 1000, effective_date: '2026-01-01' })
  });
  assert.equal(res.status, 201);

  // +500/1200 = +0.4166667 units
  res = await fetch(`${baseUrl}/api/master/investors/inv-1/cashflows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ type: 'deposit', amount: 500, effective_date: '2026-01-02' })
  });
  assert.equal(res.status, 201);

  // -200/900 = -0.2222222 units
  res = await fetch(`${baseUrl}/api/master/investors/inv-1/cashflows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ type: 'withdrawal', amount: 200, effective_date: '2026-01-03' })
  });
  assert.equal(res.status, 201);

  // -10/900 = -0.0111111 units
  res = await fetch(`${baseUrl}/api/master/investors/inv-1/cashflows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ type: 'fee', amount: 10, effective_date: '2026-01-03' })
  });
  assert.equal(res.status, 201);

  res = await fetch(`${baseUrl}/api/master/investors/inv-1/performance`, {
    headers: { cookie: 'auth_token=mastertoken' }
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.nav_today, 900);
  assert.equal(data.total_units, 2.1833);
  assert.equal(data.net_contributions, 2290);
  assert.equal(data.current_value_gross, 1965);
  assert.equal(data.gross_pnl, -325);
  assert.equal(data.investor_profit_share, -260);
  assert.equal(data.master_profit_share, -65);
  assert.equal(data.investor_net_value, 2030);
  assert.equal(data.investor_return_pct, -0.1135);

  // Update split and ensure instant recalculation against same gross pnl
  res = await fetch(`${baseUrl}/api/master/investors/inv-1/profit-split`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ investor_share_bps: 6000 })
  });
  assert.equal(res.status, 200);

  res = await fetch(`${baseUrl}/api/master/investors/inv-1/performance`, {
    headers: { cookie: 'auth_token=mastertoken' }
  });
  const dataAfterSplit = await res.json();
  assert.equal(res.status, 200);
  assert.equal(dataAfterSplit.investor_profit_share, -195);
  assert.equal(dataAfterSplit.master_profit_share, -130);
  assert.equal(dataAfterSplit.investor_net_value, 2095);
  assert.equal(dataAfterSplit.investor_return_pct, -0.0852);
});

test('summary returns controlled error when cashflows exist but no master NAV exists', async () => {
  const passwordHash = await bcrypt.hash('MasterPass123!', 10);
  const investorHash = await bcrypt.hash('InvestorPass123!', 10);
  const now = new Date().toISOString();
  saveDB({
    users: {
      master: { username: 'master', passwordHash, profileComplete: true, investorAccountsEnabled: true, portfolioHistory: {}, tradeJournal: {}, trading212: {}, security: {} }
    },
    sessions: { mastertoken: 'master' },
    investorProfiles: [
      { id: 'inv-1', masterUserId: 'master', displayName: 'Alice', status: 'active', createdAt: now }
    ],
    investorLogins: [
      { id: 'login-1', investorProfileId: 'inv-1', email: 'alice@example.com', passwordHash: investorHash, lastLoginAt: null, createdAt: now }
    ],
    investorCashflows: [
      { id: 'c1', investorProfileId: 'inv-1', type: 'deposit', amount: 1000, currency: 'GBP', effectiveDate: '2026-01-01', navReferenceDate: '2026-01-01', reference: '', createdAt: now }
    ],
    investorProfitSplits: [
      { investorProfileId: 'inv-1', investorShareBps: 8000, masterShareBps: 2000, effectiveFrom: '2026-01-01', createdAt: now }
    ],
    masterValuations: [],
    investorInvites: [],
    investorSessions: {}
  });

  if (server) server.close();
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const loginRes = await fetch(`${baseUrl}/api/investor/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'InvestorPass123!' })
  });
  const cookie = loginRes.headers.get('set-cookie');
  const res = await fetch(`${baseUrl}/api/investor/summary`, { headers: { cookie } });
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.error, 'No master valuations recorded yet.');
});

test('preview token cannot access master endpoints', async () => {
  const preview = signToken({ role: 'investor_preview', investorProfileId: 'inv-1', masterUserId: 'master', exp: Date.now() + 300000 });
  const res = await fetch(`${baseUrl}/api/master/investors`, { headers: { authorization: `Bearer ${preview}` } });
  assert.equal(res.status, 401);
});



test('user can enable investor accounts via account settings endpoint', async () => {
  const res = await fetch(`${baseUrl}/api/master/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ investor_portal_enabled: true })
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.investor_portal_enabled, true);
});




test('master settings endpoint returns persisted investor toggle', async () => {
  await fetch(`${baseUrl}/api/master/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ investor_portal_enabled: true })
  });
  const res = await fetch(`${baseUrl}/api/master/settings`, { headers: { cookie: 'auth_token=mastertoken' } });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.investor_portal_enabled, true);
});
test('master investor endpoints return 403 when investor portal is disabled for user', async () => {
  const disableRes = await fetch(`${baseUrl}/api/master/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ investor_portal_enabled: false })
  });
  assert.equal(disableRes.status, 200);
  const res = await fetch(`${baseUrl}/api/master/investors`, { headers: { cookie: 'auth_token=mastertoken' } });
  const data = await res.json();
  assert.equal(res.status, 403);
  assert.equal(data.error, 'Investor accounts are not enabled for this account.');
});


test('master can record and list master valuations via /valuations routes', async () => {
  const postRes = await fetch(`${baseUrl}/api/master/valuations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ valuation_date: '2026-02-25', nav: 1300 })
  });
  const postData = await postRes.json();
  assert.equal(postRes.status, 201);
  assert.equal(postData.valuation.valuationDate, '2026-02-25');
  assert.equal(postData.valuation.nav, 1300);

  const listRes = await fetch(`${baseUrl}/api/master/valuations`, {
    headers: { cookie: 'auth_token=mastertoken' }
  });
  const listData = await listRes.json();
  assert.equal(listRes.status, 200);
  assert.ok(Array.isArray(listData.valuations));
  assert.ok(listData.valuations.some(v => v.valuationDate === '2026-02-25'));
});
test('expired preview token is rejected by investor endpoints', async () => {
  const expired = signToken({ role: 'investor_preview', investorProfileId: 'inv-1', masterUserId: 'master', exp: Date.now() - 1000 });
  const res = await fetch(`${baseUrl}/api/investor/me`, { headers: { authorization: `Bearer ${expired}` } });
  assert.equal(res.status, 401);
});


test('profit split validation enforces integer bps and forbidden ownership', async () => {
  let res = await fetch(`${baseUrl}/api/master/investors/inv-1/profit-split`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ investor_share_bps: 7500 })
  });
  let data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.investor_share_bps, 7500);
  assert.equal(data.master_share_bps, 2500);

  res = await fetch(`${baseUrl}/api/master/investors/inv-1/profit-split`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ investor_share_bps: 10001 })
  });
  data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.error, 'Investor share must be an integer between 0 and 10000 bps.');

  res = await fetch(`${baseUrl}/api/master/investors/inv-foreign/profit-split`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ investor_share_bps: 5000 })
  });
  data = await res.json();
  assert.equal(res.status, 403);
  assert.equal(data.error, 'Forbidden');
});

test('master valuation endpoint enforces unique date and nav validation', async () => {
  let res = await fetch(`${baseUrl}/api/master/valuations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ valuation_date: '2026-02-01T12:00:00.000Z', nav: 101.5 })
  });
  let data = await res.json();
  assert.equal(res.status, 201);
  assert.equal(data.valuation.valuationDate, '2026-02-01');

  res = await fetch(`${baseUrl}/api/master/valuations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ valuation_date: '2026-02-01', nav: 200 })
  });
  data = await res.json();
  assert.equal(res.status, 409);
  assert.equal(data.error, 'A valuation already exists for this date.');

  res = await fetch(`${baseUrl}/api/master/valuations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ valuation_date: '2026-02-02', nav: 0 })
  });
  data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.error, 'NAV must be a number greater than 0.');
});

test('cashflow endpoint requires prior nav and stores nav reference date', async () => {
  let res = await fetch(`${baseUrl}/api/master/investors/inv-1/cashflows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ type: 'deposit', amount: 100, effective_date: '2025-12-31' })
  });
  let data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.error, 'Record a master NAV on or before this cashflow date.');

  res = await fetch(`${baseUrl}/api/master/valuations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ valuation_date: '2026-01-03', nav: 100 })
  });
  assert.equal(res.status, 201);

  res = await fetch(`${baseUrl}/api/master/investors/inv-1/cashflows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'auth_token=mastertoken' },
    body: JSON.stringify({ type: 'deposit', amount: 250, effective_date: '2026-01-05' })
  });
  data = await res.json();
  assert.equal(res.status, 201);
  assert.equal(data.cashflow.navReferenceDate, '2026-01-03');
});
