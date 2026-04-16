'use strict';

/**
 * Trade consolidation script — Step 1 of trades migration.
 *
 * Merges user.tradeJournal (legacy) → user.trades (canonical flat array).
 *
 * Usage:
 *   node scripts/consolidate-trades.js            # Analysis + dry-run only
 *   node scripts/consolidate-trades.js --commit   # Also writes to disk
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT        = path.resolve(__dirname, '..');
const DB_PATH     = process.env.DATA_PATH || path.join(ROOT, 'storage', 'data.json');
const DATA_PATH   = DB_PATH;
const BACKUP_PATH = path.join(ROOT, 'storage', 'data_consolidation_backup.json');
const TEMP_PATH   = path.join(ROOT, 'storage', 'data_consolidation_tmp.json');

const COMMIT = process.argv.includes('--commit');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hr(char = '─', len = 72) {
  return char.repeat(len);
}

function log(msg = '') {
  process.stdout.write(msg + '\n');
}

function warn(msg) {
  process.stdout.write(`  ⚠  ${msg}\n`);
}

/**
 * Generate a deterministic ID for a trade that has no id field.
 * Uses symbol + createdAt + direction + entry price.
 */
function generateId(trade, journalDateKey) {
  const parts = [
    trade.symbol  || trade.ticker || '',
    trade.createdAt || journalDateKey || '',
    trade.direction || '',
    String(trade.entry ?? trade.entryPrice ?? ''),
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * Flatten a tradeJournal object into a plain array of trade objects.
 *
 * Handles two shapes defensively:
 *   Shape A (actual): { "YYYY-MM-DD": [trade, ...] }
 *   Shape B (legacy): { "YYYY-MM": { "YYYY-MM-DD": [trade, ...] } }
 *
 * Returns { trades: [...], missingIdCount: N, malformedCount: N, dateKeyMap: Map<trade, dateKey> }
 */
function flattenJournal(tradeJournal) {
  const trades      = [];
  const dateKeyMap  = new Map(); // trade object → journal date key (for fallback id gen)
  let missingIdCount = 0;
  let malformedCount = 0;

  if (!tradeJournal || typeof tradeJournal !== 'object') {
    return { trades, missingIdCount, malformedCount, dateKeyMap };
  }

  for (const topKey of Object.keys(tradeJournal)) {
    const topVal = tradeJournal[topKey];

    if (Array.isArray(topVal)) {
      // Shape A: topKey is a date string, value is array of trades
      for (const t of topVal) {
        if (!t || typeof t !== 'object') { malformedCount++; continue; }
        if (!t.id) missingIdCount++;
        dateKeyMap.set(t, topKey);
        trades.push(t);
      }
    } else if (topVal && typeof topVal === 'object') {
      // Shape B: topKey is a month, value is { dayKey: [trade,...] }
      for (const dayKey of Object.keys(topVal)) {
        const dayVal = topVal[dayKey];
        if (!Array.isArray(dayVal)) { malformedCount++; continue; }
        for (const t of dayVal) {
          if (!t || typeof t !== 'object') { malformedCount++; continue; }
          if (!t.id) missingIdCount++;
          dateKeyMap.set(t, dayKey);
          trades.push(t);
        }
      }
    } else {
      malformedCount++;
    }
  }

  return { trades, missingIdCount, malformedCount, dateKeyMap };
}

/**
 * Sort trades by date ascending.
 * Uses createdAt if present, otherwise journalDateKey, otherwise ''.
 */
function sortKey(trade, dateKeyMap) {
  return trade.createdAt || dateKeyMap.get(trade) || '';
}

// ─── Phase 1 — Analysis ───────────────────────────────────────────────────────

function runAnalysis(data) {
  const users = data.users || {};
  const usernames = Object.keys(users);

  log('');
  log(hr('═'));
  log('  PHASE 1 — ANALYSIS (read-only)');
  log(hr('═'));

  const globalStats = {
    totalUsers: usernames.length,
    usersWithTradesArray: 0,
    usersWithJournal: 0,
    usersWithBoth: 0,
    usersWithNeither: 0,
    totalTradesFlat: 0,
    totalTradesJournal: 0,
    totalOnlyInJournal: 0,
    totalMissingIds: 0,
    totalDuplicateIds: 0,
    totalMalformed: 0,
  };

  const perUserResults = [];

  for (const username of usernames) {
    const user = users[username];
    if (!user || typeof user !== 'object') {
      perUserResults.push({ username, error: 'user object is null/invalid' });
      continue;
    }

    // ── user.trades (flat array) ──────────────────────────────────────────
    const hasTradesArray = Array.isArray(user.trades);
    const flatTrades     = hasTradesArray ? user.trades.filter(t => t && typeof t === 'object') : [];

    // Detect duplicate IDs in flat array
    const flatIdCounts = new Map();
    const flatMissingId = [];
    for (const t of flatTrades) {
      if (!t.id) { flatMissingId.push(t); continue; }
      flatIdCounts.set(t.id, (flatIdCounts.get(t.id) || 0) + 1);
    }
    const flatDuplicateIds = [...flatIdCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id);

    // ── user.tradeJournal ─────────────────────────────────────────────────
    const hasJournal = user.tradeJournal && typeof user.tradeJournal === 'object';
    const journalEmpty = hasJournal && Object.keys(user.tradeJournal).length === 0;

    const { trades: journalTrades, missingIdCount, malformedCount, dateKeyMap } =
      flattenJournal(hasJournal ? user.tradeJournal : null);

    // Detect duplicate IDs in journal
    const journalIdCounts = new Map();
    const journalMissingId = [];
    for (const t of journalTrades) {
      if (!t.id) { journalMissingId.push(t); continue; }
      journalIdCounts.set(t.id, (journalIdCounts.get(t.id) || 0) + 1);
    }
    const journalDuplicateIds = [...journalIdCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id);

    // ── Overlap: journal trades NOT in flat array ─────────────────────────
    const flatIdSet = new Set(flatTrades.filter(t => t.id).map(t => t.id));
    const onlyInJournal = journalTrades.filter(t => t.id && !flatIdSet.has(t.id));
    // Trades in journal with no id — can't match, treat as "only in journal" for now
    const journalNoId = journalTrades.filter(t => !t.id);

    // ── Global counters ───────────────────────────────────────────────────
    if (hasTradesArray)               globalStats.usersWithTradesArray++;
    if (hasJournal && !journalEmpty)  globalStats.usersWithJournal++;
    if (hasTradesArray && hasJournal && !journalEmpty) globalStats.usersWithBoth++;
    if (!hasTradesArray && (!hasJournal || journalEmpty)) globalStats.usersWithNeither++;
    globalStats.totalTradesFlat    += flatTrades.length;
    globalStats.totalTradesJournal += journalTrades.length;
    globalStats.totalOnlyInJournal += onlyInJournal.length + journalNoId.length;
    globalStats.totalMissingIds    += flatMissingId.length + missingIdCount;
    globalStats.totalDuplicateIds  += flatDuplicateIds.length + journalDuplicateIds.length;
    globalStats.totalMalformed     += malformedCount;

    perUserResults.push({
      username,
      hasTradesArray,
      flatCount: flatTrades.length,
      flatMissingIdCount: flatMissingId.length,
      flatDuplicateIds,
      hasJournal: hasJournal && !journalEmpty,
      journalCount: journalTrades.length,
      journalMissingIdCount: missingIdCount,
      journalDuplicateIds,
      malformedCount,
      onlyInJournalCount: onlyInJournal.length,
      journalNoIdCount: journalNoId.length,
      dateKeyMap,
      // carry forward for phase 2
      _flatTrades: flatTrades,
      _journalTrades: journalTrades,
      _journalDateKeyMap: dateKeyMap,
    });
  }

  // ── Print per-user table ──────────────────────────────────────────────────
  log('');
  log('  Per-user breakdown:');
  log(hr());

  for (const r of perUserResults) {
    if (r.error) {
      log(`  ${r.username}: ERROR — ${r.error}`);
      continue;
    }

    log('');
    log(`  User: ${r.username}`);
    log(`    user.trades (flat array) : ${r.hasTradesArray ? `YES — ${r.flatCount} trade(s)` : 'NOT PRESENT'}`);
    if (r.flatMissingIdCount > 0)   warn(`${r.flatMissingIdCount} trade(s) in user.trades missing id`);
    if (r.flatDuplicateIds.length)  warn(`Duplicate IDs in user.trades: ${r.flatDuplicateIds.join(', ')}`);

    log(`    user.tradeJournal        : ${r.hasJournal ? `YES — ${r.journalCount} trade(s)` : 'EMPTY / NOT PRESENT'}`);
    if (r.journalMissingIdCount > 0) warn(`${r.journalMissingIdCount} trade(s) in tradeJournal missing id`);
    if (r.journalDuplicateIds.length) warn(`Duplicate IDs in tradeJournal: ${r.journalDuplicateIds.join(', ')}`);
    if (r.malformedCount > 0)        warn(`${r.malformedCount} malformed entry/entries skipped`);

    if (r.hasJournal) {
      log(`    Only in journal (new)    : ${r.onlyInJournalCount} trade(s) not yet in user.trades`);
      if (r.journalNoIdCount > 0)
        warn(`${r.journalNoIdCount} journal trade(s) have no id — will receive generated id on consolidation`);
    }
  }

  log('');
  log(hr());
  log('  GLOBAL SUMMARY');
  log(hr());
  log(`  Total users             : ${globalStats.totalUsers}`);
  log(`  Users with trades array : ${globalStats.usersWithTradesArray}`);
  log(`  Users with journal data : ${globalStats.usersWithJournal}`);
  log(`  Users with BOTH         : ${globalStats.usersWithBoth}`);
  log(`  Users with NEITHER      : ${globalStats.usersWithNeither}`);
  log(`  Trades in user.trades   : ${globalStats.totalTradesFlat}`);
  log(`  Trades in tradeJournal  : ${globalStats.totalTradesJournal}`);
  log(`  New from journal        : ${globalStats.totalOnlyInJournal}`);
  log(`  Missing IDs (total)     : ${globalStats.totalMissingIds}`);
  log(`  Duplicate IDs (total)   : ${globalStats.totalDuplicateIds}`);
  log(`  Malformed entries       : ${globalStats.totalMalformed}`);
  log('');

  return perUserResults;
}

// ─── Phase 2 — Dry Run ────────────────────────────────────────────────────────

function runDryRun(perUserResults) {
  log('');
  log(hr('═'));
  log('  PHASE 2 — DRY RUN CONSOLIDATION (no writes)');
  log(hr('═'));
  log('');

  const mergedMap = new Map(); // username → merged trades array

  for (const r of perUserResults) {
    if (r.error) continue;

    const dateKeyMap = r._journalDateKeyMap;

    // Build a map of existing flat trades by id
    const byId = new Map();
    for (const t of r._flatTrades) {
      if (t.id) byId.set(t.id, t);
    }

    // Start with flat trades (copy)
    const merged = [...r._flatTrades];
    let addedCount    = 0;
    let generatedIds  = 0;

    for (let jt of r._journalTrades) {
      let tid = jt.id;

      if (!tid) {
        tid = generateId(jt, dateKeyMap.get(jt));
        generatedIds++;
        jt = { ...jt, id: tid };
      }

      if (!byId.has(tid)) {
        byId.set(tid, jt);
        merged.push(jt);
        addedCount++;
      }
    }

    // Sort by createdAt → journalDateKey → ''
    merged.sort((a, b) => {
      const ka = a.createdAt || dateKeyMap.get(a) || '';
      const kb = b.createdAt || dateKeyMap.get(b) || '';
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    mergedMap.set(r.username, merged);

    log(`  ${r.username}`);
    log(`    Current user.trades     : ${r.flatCount} trade(s)`);
    log(`    Current tradeJournal    : ${r.journalCount} trade(s)`);
    log(`    Would add from journal  : ${addedCount} trade(s)`);
    if (generatedIds > 0) log(`    IDs to be generated     : ${generatedIds}`);
    log(`    Merged total            : ${merged.length} trade(s)`);
    log('');
  }

  return mergedMap;
}

// ─── Phase 3 — Commit ────────────────────────────────────────────────────────

function runCommit(data, perUserResults, mergedMap) {
  log('');
  log(hr('═'));
  log('  PHASE 3 — COMMIT');
  log(hr('═'));
  log('');

  // Backup first
  log(`  Writing backup to: ${BACKUP_PATH}`);
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(data, null, 2), 'utf8');
  log('  Backup written OK');
  log('');

  let totalWritten = 0;

  for (const r of perUserResults) {
    if (r.error) continue;
    const merged = mergedMap.get(r.username);
    if (!merged) continue;

    data.users[r.username].trades       = merged;
    data.users[r.username].tradeJournal = {};

    log(`  ${r.username} — wrote ${merged.length} trade(s) to user.trades, cleared tradeJournal`);
    totalWritten += merged.length;
  }

  // Atomic write: temp file then rename
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(TEMP_PATH, json, 'utf8');
  fs.renameSync(TEMP_PATH, DATA_PATH);

  log('');
  log(hr());
  log(`  DONE — ${totalWritten} total trade(s) written across ${perUserResults.filter(r => !r.error).length} user(s)`);
  log(`  data.json updated atomically (temp → rename)`);
  log(`  Backup preserved at: ${BACKUP_PATH}`);
  log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  log('');
  log(hr('═'));
  log('  TRADE CONSOLIDATION SCRIPT');
  log(`  Mode: ${COMMIT ? 'COMMIT (will write to disk)' : 'DRY RUN (read-only)'}`);
  log(`  Data: ${DATA_PATH}`);
  log(hr('═'));

  if (!fs.existsSync(DATA_PATH)) {
    log(`ERROR: data.json not found at ${DATA_PATH}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (e) {
    log(`ERROR: Failed to parse data.json — ${e.message}`);
    process.exit(1);
  }

  if (!data.users || typeof data.users !== 'object') {
    log('ERROR: data.json has no top-level "users" object');
    process.exit(1);
  }

  const perUserResults = runAnalysis(data);
  const mergedMap      = runDryRun(perUserResults);

  if (COMMIT) {
    runCommit(data, perUserResults, mergedMap);
  } else {
    log('');
    log(hr('─'));
    log('  DRY RUN COMPLETE — no files were written.');
    log('  To apply these changes, re-run with the --commit flag:');
    log('    node scripts/consolidate-trades.js --commit');
    log(hr('─'));
    log('');
  }
}

main();
