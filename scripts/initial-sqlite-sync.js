'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { initDB, syncFromJSON } = require('../lib/sqlite-db');

const DB_PATH = process.env.DATA_PATH || path.join(__dirname, '..', 'storage', 'data.json');
const CLEAN_MODE = process.argv.includes('--clean');

// ---------------------------------------------------------------------------
// Load JSON
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Confirmation prompt helper
// ---------------------------------------------------------------------------

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run() {
  // initDB() returns the better-sqlite3 Database instance (the same singleton
  // that syncFromJSON uses internally via getDb()). We hold onto it so we can
  // open an outer transaction that wraps both the deletes and the sync call.
  const sqliteInstance = initDB();

  if (!CLEAN_MODE) {
    // Upsert-only — safe, no deletes
    const counts = syncFromJSON(db);
    printSummary('upsert', counts);
    return;
  }

  // --clean mode: destructive delete + re-insert, wrapped in one transaction
  console.log('\n[SQLite Sync] --clean mode: all rows in users, trades, sessions,');
  console.log('  group_chat_messages, and collections will be DELETED before re-sync.');
  console.log('  news_events will NOT be deleted.\n');

  const answer = await confirm('Type "yes" to proceed: ');
  if (answer !== 'yes') {
    console.log('[SQLite Sync] Aborted.');
    process.exit(0);
  }

  // Wrap deletes + syncFromJSON in a single outer transaction.
  // When syncFromJSON calls sqliteDb.transaction() internally, better-sqlite3
  // automatically demotes it to a SAVEPOINT (nested transaction), so the entire
  // operation is atomic — either everything commits or nothing does.
  const cleanSync = sqliteInstance.transaction(() => {
    sqliteInstance.prepare('DELETE FROM collections').run();
    sqliteInstance.prepare('DELETE FROM group_chat_messages').run();
    sqliteInstance.prepare('DELETE FROM sessions').run();
    sqliteInstance.prepare('DELETE FROM trades').run();
    sqliteInstance.prepare('DELETE FROM users').run();
    // news_events intentionally skipped — historical rows are preserved
    return syncFromJSON(db);
  });

  const counts = cleanSync();
  printSummary('clean', counts);
}

function printSummary(mode, counts) {
  console.log(`\n[SQLite Sync] Done (${mode} mode).`);
  console.log(`  Users:       ${counts.users}`);
  console.log(`  Trades:      ${counts.trades}`);
  console.log(`  Sessions:    ${counts.sessions}`);
  console.log(`  Messages:    ${counts.messages}`);
  console.log(`  News events: ${counts.newsEvents}`);
  console.log(`  Collections: ${counts.collections}`);
}

run().catch((err) => {
  console.error('[SQLite Sync] Fatal error:', err.message || err);
  process.exit(1);
});
