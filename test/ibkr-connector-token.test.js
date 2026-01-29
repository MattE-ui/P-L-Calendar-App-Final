const test = require('node:test');
const assert = require('node:assert/strict');
require('./support/mock-server-deps');

const {
  createIbkrConnectorToken,
  verifyIbkrConnectorToken,
  findIbkrConnectorKeyOwner,
  exchangeIbkrConnectorToken
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
