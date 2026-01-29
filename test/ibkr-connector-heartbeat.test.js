const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'dotenv') {
    return { config: () => ({}) };
  }
  return originalLoad(request, parent, isMain);
};

test('heartbeat updates connector status', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibkr-heartbeat-'));
  process.env.DATA_FILE = path.join(tempDir, 'data.json');
  delete require.cache[require.resolve('../server')];
  const {
    app,
    saveDB,
    loadDB,
    createIbkrConnectorToken,
    exchangeIbkrConnectorToken
  } = require('../server');

  const db = {
    users: { 'user@example.com': { username: 'user@example.com', ibkr: {} } },
    sessions: {},
    connectorTokens: []
  };
  const token = await createIbkrConnectorToken(db, 'user@example.com');
  const exchange = await exchangeIbkrConnectorToken(db, token.rawToken);
  saveDB(db);

  const server = app.listen(0);
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/integrations/ibkr/connector/heartbeat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${exchange.connectorKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'disconnected',
      reason: 'Login required',
      authStatus: { authenticated: false, connected: false }
    })
  });
  assert.equal(response.status, 200);
  server.close();

  const updated = loadDB();
  const cfg = updated.users['user@example.com'].ibkr;
  assert.equal(cfg.connectionStatus, 'disconnected');
  assert.equal(cfg.lastConnectorStatus.reason, 'Login required');
});
