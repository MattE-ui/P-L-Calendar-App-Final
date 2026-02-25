const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

process.env.DATA_FILE = path.join(__dirname, 'data-investor-test.json');
process.env.SKIP_RATE_FETCH = 'true';
process.env.NEXT_PUBLIC_INVESTOR_PORTAL = 'true';
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
      master: { username: 'master', passwordHash, profileComplete: true, portfolioHistory: {}, tradeJournal: {}, trading212: {}, security: {} }
    },
    sessions: {
      mastertoken: 'master'
    },
    investorProfiles: [
      { id: 'inv-1', masterUserId: 'master', displayName: 'Alice', status: 'active', createdAt: now },
      { id: 'inv-2', masterUserId: 'master', displayName: 'Bob', status: 'active', createdAt: now }
    ],
    investorLogins: [
      { id: 'login-1', investorProfileId: 'inv-1', email: 'alice@example.com', passwordHash: investorHash, lastLoginAt: null, createdAt: now }
    ],
    investorPermissions: [
      { investorProfileId: 'inv-1', canViewPositions: false, canViewTradeLog: false, canViewNotes: true, createdAt: now },
      { investorProfileId: 'inv-2', canViewPositions: false, canViewTradeLog: false, canViewNotes: true, createdAt: now }
    ],
    investorCashflows: [
      { id: 'c1', investorProfileId: 'inv-1', type: 'deposit', amount: 1000, currency: 'GBP', effectiveDate: '2026-01-01', reference: '', createdAt: now },
      { id: 'c2', investorProfileId: 'inv-2', type: 'deposit', amount: 7000, currency: 'GBP', effectiveDate: '2026-01-01', reference: '', createdAt: now }
    ],
    investorValuations: [
      { id: 'v1', investorProfileId: 'inv-1', valuationDate: '2026-01-02', nav: 1200, pnlDay: 10, pnlMtd: 20, pnlYtd: 20, createdAt: now },
      { id: 'v2', investorProfileId: 'inv-2', valuationDate: '2026-01-02', nav: 8000, pnlDay: 10, pnlMtd: 20, pnlYtd: 20, createdAt: now }
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
  assert.equal(data.netDeposits, 1000);
  assert.equal(data.nav, 1200);
});

test('preview token cannot access master endpoints', async () => {
  const preview = signToken({ role: 'investor_preview', investorProfileId: 'inv-1', masterUserId: 'master', exp: Date.now() + 300000 });
  const res = await fetch(`${baseUrl}/api/master/investors`, { headers: { authorization: `Bearer ${preview}` } });
  assert.equal(res.status, 401);
});

test('expired preview token is rejected by investor endpoints', async () => {
  const expired = signToken({ role: 'investor_preview', investorProfileId: 'inv-1', masterUserId: 'master', exp: Date.now() - 1000 });
  const res = await fetch(`${baseUrl}/api/investor/me`, { headers: { authorization: `Bearer ${expired}` } });
  assert.equal(res.status, 401);
});
