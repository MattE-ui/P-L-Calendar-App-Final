process.env.TEST_USE_REAL_EXPRESS = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./support/mock-server-deps');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veracity-ibkr-'));
process.env.DB_PATH = path.join(tempDir, 'db.json');

const {
  createIbkrConnectorToken,
  verifyIbkrConnectorToken,
  findIbkrConnectorKeyOwner,
  exchangeIbkrConnectorToken,
  loadDB,
  saveDB,
  app
} = require('../server');

test('createIbkrConnectorToken stores hashed token and returns raw token', async () => {
  const db = { users: { 'user@example.com': { username: 'user@example.com', ibkr: {} } }, ibkrConnectorTokens: [] };
  const token = await createIbkrConnectorToken(db, 'user@example.com');
  assert.ok(token.rawToken);
  assert.ok(token.expiresAt);
  assert.equal(db.ibkrConnectorTokens.length, 1);
  assert.ok(db.ibkrConnectorTokens[0].tokenHash);
  assert.equal(db.ibkrConnectorTokens[0].usedAt, null);
});

test('exchangeIbkrConnectorToken returns connector key and revokes token', async () => {
  const db = {
    users: { 'user@example.com': { username: 'user@example.com', ibkr: {} } },
    ibkrConnectorTokens: [],
    ibkrConnectorKeys: []
  };
  const token = await createIbkrConnectorToken(db, 'user@example.com');
  const exchange = await exchangeIbkrConnectorToken(db, token.rawToken);
  assert.ok(exchange.connectorKey);
  const owner = await findIbkrConnectorKeyOwner(db, exchange.connectorKey);
  assert.ok(owner);
  const verifiedToken = await verifyIbkrConnectorToken(db, token.rawToken);
  assert.equal(verifiedToken, null);
});

test('new connector exchange revokes older keys', async () => {
  const db = {
    users: { 'user@example.com': { username: 'user@example.com', ibkr: {} } },
    ibkrConnectorTokens: [],
    ibkrConnectorKeys: []
  };
  const token1 = await createIbkrConnectorToken(db, 'user@example.com');
  const exchange1 = await exchangeIbkrConnectorToken(db, token1.rawToken);
  const token2 = await createIbkrConnectorToken(db, 'user@example.com');
  const exchange2 = await exchangeIbkrConnectorToken(db, token2.rawToken);
  const activeKeys = db.ibkrConnectorKeys.filter(entry => entry.username === 'user@example.com' && !entry.revokedAt);
  assert.equal(activeKeys.length, 1);
  const activeOwner = await findIbkrConnectorKeyOwner(db, exchange2.connectorKey);
  assert.ok(activeOwner);
  const revokedOwner = await findIbkrConnectorKeyOwner(db, exchange1.connectorKey);
  assert.equal(revokedOwner, null);
});

test('expired connector token cannot be exchanged', async () => {
  const db = { users: { 'user@example.com': { username: 'user@example.com', ibkr: {} } }, ibkrConnectorTokens: [] };
  const token = await createIbkrConnectorToken(db, 'user@example.com');
  db.ibkrConnectorTokens[0].expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
  const exchange = await exchangeIbkrConnectorToken(db, token.rawToken);
  assert.equal(exchange, null);
});

test('heartbeat and snapshot accept valid connector key and reject invalid keys', async () => {
  const db = loadDB();
  db.users['user@example.com'] = { username: 'user@example.com', ibkr: {} };
  const token = await createIbkrConnectorToken(db, 'user@example.com');
  const exchange = await exchangeIbkrConnectorToken(db, token.rawToken);
  saveDB(db);

  const listener = await new Promise((resolve, reject) => {
    const srv = app.listen(0);
    if (!srv || typeof srv.on !== 'function') {
      reject(new Error('Failed to start test server.'));
      return;
    }
    const timeout = setTimeout(() => {
      reject(new Error('Server failed to start.'));
    }, 2000);
    srv.on('listening', () => {
      clearTimeout(timeout);
      resolve(srv);
    });
    srv.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  const port = listener.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const http = require('node:http');
  const postJson = (path, body, auth) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  const heartbeatRes = await postJson(
    '/api/integrations/ibkr/connector/heartbeat',
    { status: 'online' },
    `Bearer ${exchange.connectorKey}`
  );
  assert.equal(heartbeatRes.status, 200);

  const snapshotRes = await postJson(
    '/api/integrations/ibkr/connector/snapshot',
    {
      accountId: 'DU123',
      portfolioValue: 100,
      rootCurrency: 'USD',
      positions: []
    },
    `Bearer ${exchange.connectorKey}`
  );
  assert.equal(snapshotRes.status, 200);

  const invalidRes = await postJson(
    '/api/integrations/ibkr/connector/heartbeat',
    { status: 'online' },
    'Bearer invalid'
  );
  assert.equal(invalidRes.status, 401);

  await new Promise(resolve => listener.close(resolve));
});
