const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');

process.env.DATA_FILE = path.join(__dirname, 'data-2fa-challenge-stability-test.json');
process.env.SKIP_RATE_FETCH = 'true';

const { app, saveDB, loadDB } = require('../server');

const DATA_FILE = process.env.DATA_FILE;
let server;
let baseUrl;

function hashBackupCode(code) {
  return crypto.createHash('sha256').update(String(code || ''), 'utf8').digest('hex');
}

async function buildUser(password) {
  return {
    username: 'alice',
    passwordHash: await bcrypt.hash(password, 10),
    portfolio: 0,
    initialPortfolio: 0,
    initialNetDeposits: 0,
    profileComplete: true,
    portfolioHistory: {},
    netDepositsAnchor: null,
    trading212: {},
    security: {
      twoFactorEnabled: true,
      twoFactorSecretEnc: 'placeholder-encrypted-secret',
      twoFactorBackupCodeHashes: [hashBackupCode('ABCDEF1234')]
    }
  };
}

test.beforeEach(async () => {
  fs.rmSync(DATA_FILE, { force: true });
  const user = await buildUser('pw1234567890!AA');
  const lastActiveAt = '2025-01-01T00:00:00.000Z';
  saveDB({
    users: { alice: user },
    sessions: { existingtoken: 'alice' },
    sessionMetadata: {
      existingtoken: {
        createdAt: lastActiveAt,
        lastActiveAt,
        userAgent: 'test',
        ip: '127.0.0.1'
      }
    },
    twoFactorLoginChallenges: {}
  });
  if (server) server.close();
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(DATA_FILE, { force: true });
});

test('bootstrap polling does not mutate session metadata and pending challenge still verifies', async () => {
  const loginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'auth_token=existingtoken'
    },
    body: JSON.stringify({ username: 'alice', password: 'pw1234567890!AA' })
  });
  assert.equal(loginRes.status, 202);
  const loginBody = await loginRes.json();
  assert.equal(loginBody.requiresTwoFactor, true);

  const bootstrapRes = await fetch(`${baseUrl}/api/profile/bootstrap`, {
    headers: {
      cookie: 'auth_token=existingtoken'
    }
  });
  assert.equal(bootstrapRes.status, 200);

  const dbAfterBootstrap = loadDB();
  assert.equal(dbAfterBootstrap.sessionMetadata.existingtoken.lastActiveAt, '2025-01-01T00:00:00.000Z');

  const verifyRes = await fetch(`${baseUrl}/api/login/2fa`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'auth_token=existingtoken'
    },
    body: JSON.stringify({
      challengeId: loginBody.challengeId,
      method: 'backup_code',
      code: 'ABCDEF1234'
    })
  });
  const verifyBody = await verifyRes.json();
  assert.equal(verifyRes.status, 200);
  assert.equal(verifyBody.ok, true);
});
