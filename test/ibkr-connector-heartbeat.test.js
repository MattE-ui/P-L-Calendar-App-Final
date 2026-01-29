const test = require('node:test');
const assert = require('node:assert/strict');
require('./support/mock-server-deps');

test('heartbeat updates connector status', async () => {
  const { applyIbkrHeartbeat } = require('../server');
  const user = { username: 'user@example.com', ibkr: {} };
  applyIbkrHeartbeat(user, {
    status: 'disconnected',
    reason: 'Login required',
    authStatus: { authenticated: false, connected: false }
  });
  assert.equal(user.ibkr.connectionStatus, 'disconnected');
  assert.equal(user.ibkr.lastConnectorStatus.reason, 'Login required');
});
