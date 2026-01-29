const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./support/mock-server-deps');

test('connector key persists after save/load', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veracity-db-'));
  const dbPath = path.join(dir, 'db.json');
  process.env.DB_PATH = dbPath;

  delete require.cache[require.resolve('../server')];
  const {
    loadDB,
    saveDB,
    createIbkrConnectorToken,
    exchangeIbkrConnectorToken,
    findIbkrConnectorKeyOwner
  } = require('../server');

  const db = loadDB();
  db.users['user@example.com'] = { username: 'user@example.com', ibkr: {} };
  const token = await createIbkrConnectorToken(db, 'user@example.com');
  const exchange = await exchangeIbkrConnectorToken(db, token.rawToken);
  assert.ok(exchange.connectorKey);
  saveDB(db);

  const reloaded = loadDB();
  const owner = await findIbkrConnectorKeyOwner(reloaded, exchange.connectorKey);
  assert.ok(owner);
});
