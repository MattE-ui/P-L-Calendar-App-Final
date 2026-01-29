const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createIbkrConnectorToken,
  verifyIbkrConnectorToken
} = require('../server');

test('createIbkrConnectorToken stores hashed token and returns raw token', async () => {
  const db = { users: { 'user@example.com': { username: 'user@example.com', ibkr: {} } }, connectorTokens: [] };
  const token = await createIbkrConnectorToken(db, 'user@example.com');
  assert.ok(token);
  assert.equal(db.connectorTokens.length, 1);
  assert.equal(db.connectorTokens[0].provider, 'IBKR');
  assert.ok(db.connectorTokens[0].tokenHash);
  assert.equal(db.connectorTokens[0].revokedAt, null);
});

test('verifyIbkrConnectorToken validates active token and rejects revoked token', async () => {
  const db = { users: { 'user@example.com': { username: 'user@example.com', ibkr: {} } }, connectorTokens: [] };
  const token1 = await createIbkrConnectorToken(db, 'user@example.com');
  const token2 = await createIbkrConnectorToken(db, 'user@example.com');
  const verifiedOld = await verifyIbkrConnectorToken(db, token1);
  assert.equal(verifiedOld, null);
  const verifiedNew = await verifyIbkrConnectorToken(db, token2);
  assert.ok(verifiedNew);
  assert.equal(verifiedNew.userId, 'user@example.com');
});
