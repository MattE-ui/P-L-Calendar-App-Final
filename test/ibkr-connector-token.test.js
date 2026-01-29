const test = require('node:test');
const assert = require('node:assert/strict');
require('./support/mock-server-deps');

const {
  createIbkrConnectorToken,
  verifyIbkrConnectorToken,
  verifyIbkrConnectorKey,
  exchangeIbkrConnectorToken
} = require('../server');

test('createIbkrConnectorToken stores hashed token and returns raw token', async () => {
  const db = { users: { 'user@example.com': { username: 'user@example.com', ibkr: {} } }, connectorTokens: [] };
  const token = await createIbkrConnectorToken(db, 'user@example.com');
  assert.ok(token.rawToken);
  assert.ok(token.expiresAt);
  assert.equal(db.connectorTokens.length, 1);
  assert.equal(db.connectorTokens[0].provider, 'IBKR');
  assert.ok(db.connectorTokens[0].tokenHash);
  assert.equal(db.connectorTokens[0].revokedAt, null);
});

test('exchangeIbkrConnectorToken returns connector key and revokes token', async () => {
  const db = { users: { 'user@example.com': { username: 'user@example.com', ibkr: {} } }, connectorTokens: [] };
  const token = await createIbkrConnectorToken(db, 'user@example.com');
  const exchange = await exchangeIbkrConnectorToken(db, token.rawToken);
  assert.ok(exchange.connectorKey);
  assert.ok(db.users['user@example.com'].ibkr.connectorKeys.length === 1);
  const verifiedToken = await verifyIbkrConnectorToken(db, token.rawToken);
  assert.equal(verifiedToken, null);
});

test('verifyIbkrConnectorKey validates active key and revokes older keys', async () => {
  const db = { users: { 'user@example.com': { username: 'user@example.com', ibkr: {} } }, connectorTokens: [] };
  const token1 = await createIbkrConnectorToken(db, 'user@example.com');
  const exchange1 = await exchangeIbkrConnectorToken(db, token1.rawToken);
  const token2 = await createIbkrConnectorToken(db, 'user@example.com');
  const exchange2 = await exchangeIbkrConnectorToken(db, token2.rawToken);
  const user = db.users['user@example.com'];
  const verifiedOld = await verifyIbkrConnectorKey(user, exchange1.connectorKey);
  assert.equal(verifiedOld, null);
  const verifiedNew = await verifyIbkrConnectorKey(user, exchange2.connectorKey);
  assert.ok(verifiedNew);
});

test('expired connector token cannot be exchanged', async () => {
  const db = { users: { 'user@example.com': { username: 'user@example.com', ibkr: {} } }, connectorTokens: [] };
  const token = await createIbkrConnectorToken(db, 'user@example.com');
  db.connectorTokens[0].expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
  const exchange = await exchangeIbkrConnectorToken(db, token.rawToken);
  assert.equal(exchange, null);
});
