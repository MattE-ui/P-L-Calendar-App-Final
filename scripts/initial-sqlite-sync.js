'use strict';

const fs = require('fs');
const path = require('path');
const { initDB, syncFromJSON } = require('../lib/sqlite-db');

const DB_PATH = path.join(__dirname, '..', 'storage', 'data.json');

console.log('[SQLite Sync] Loading', DB_PATH);
let raw;
try {
  raw = fs.readFileSync(DB_PATH, 'utf-8');
} catch (err) {
  console.error('[SQLite Sync] Could not read data.json:', err.message);
  process.exit(1);
}

let db;
try {
  db = JSON.parse(raw);
} catch (err) {
  console.error('[SQLite Sync] data.json is not valid JSON:', err.message);
  process.exit(1);
}

initDB();
const counts = syncFromJSON(db);

console.log('[SQLite Sync] Done.');
console.log(`  Users:       ${counts.users}`);
console.log(`  Trades:      ${counts.trades}`);
console.log(`  Sessions:    ${counts.sessions}`);
console.log(`  Messages:    ${counts.messages}`);
console.log(`  News events: ${counts.newsEvents}`);
console.log(`  Collections: ${counts.collections}`);
