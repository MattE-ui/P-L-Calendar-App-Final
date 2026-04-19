#!/usr/bin/env node
// Manual-only script. Not run automatically. Invoke via node scripts/backfill-auto-navs.js to populate historical auto-NAVs from portfolioHistory. Dry-run with --dry-run first.
/**
 * backfill-auto-navs.js
 *
 * One-time (but safely re-runnable) backfill that inserts historical auto-NAV
 * entries into masterValuations for every master with investor mode enabled.
 *
 * Source of truth: portfolioHistory[YYYY-MM][YYYY-MM-DD].end — the EOD
 * portfolio value written by the profile-save endpoint and broker syncs.
 *
 * Rules:
 *  - Skip masters with autoNavEnabled === false (flag in logs, count separately)
 *  - Skip dates where a masterValuations entry already exists (idempotent)
 *  - Skip dates where end is missing, zero, or non-finite
 *  - Only inserts for dates strictly before today (today is the live cron's job)
 *  - source field set to 'auto-backfill' so records are distinguishable
 *
 * Usage:
 *   node scripts/backfill-auto-navs.js [--dry-run]
 */
'use strict';

const crypto = require('crypto');
const {
  loadDB,
  saveDB,
  ensureUserShape,
  ensurePortfolioHistory,
  ensureInvestorTables,
  currentDateKey,
} = require('../server');

const DRY_RUN = process.argv.includes('--dry-run');

function run() {
  console.log(`[backfill-auto-navs] starting dry_run=${DRY_RUN}`);
  const db = loadDB();
  ensureInvestorTables(db);

  const today = currentDateKey();

  let inserted = 0;
  let skippedExists = 0;
  let skippedNoValue = 0;
  let skippedDisabled = 0;
  let skippedNoInvestorMode = 0;
  let usersProcessed = 0;

  for (const [username, user] of Object.entries(db.users || {})) {
    if (!user?.investorAccountsEnabled) {
      skippedNoInvestorMode++;
      continue;
    }

    ensureUserShape(user, username);

    if (user.autoNavEnabled === false) {
      skippedDisabled++;
      console.log(`[backfill-auto-navs] skip username=${username} reason=auto_nav_disabled`);
      continue;
    }

    usersProcessed++;
    const history = ensurePortfolioHistory(user);
    let userInserted = 0;

    for (const [ym, days] of Object.entries(history || {})) {
      if (typeof days !== 'object' || !days) continue;
      for (const [dateKey, record] of Object.entries(days)) {
        // Only backfill dates before today — today's NAV is the live cron's responsibility
        if (dateKey >= today) continue;

        const end = Number(record?.end);
        if (!Number.isFinite(end) || end <= 0) {
          skippedNoValue++;
          continue;
        }

        // Idempotency check: skip if any NAV already exists for this user+date
        const exists = db.masterValuations.find(
          v => v.masterUserId === username && v.valuationDate === dateKey
        );
        if (exists) {
          skippedExists++;
          continue;
        }

        if (!DRY_RUN) {
          db.masterValuations.push({
            id: crypto.randomUUID(),
            masterUserId: username,
            valuationDate: dateKey,
            nav: end,
            notes: null,
            source: 'auto-backfill',
            createdAt: new Date().toISOString(),
            updatedAt: null,
          });
        }

        inserted++;
        userInserted++;
      }
    }

    if (userInserted > 0) {
      console.log(`[backfill-auto-navs] username=${username} inserted=${userInserted}`);
    }
  }

  if (!DRY_RUN && inserted > 0) {
    saveDB(db);
  }

  const summary = {
    ok: true,
    dry_run: DRY_RUN,
    usersProcessed,
    inserted,
    skippedExists,
    skippedNoValue,
    skippedDisabled,
    skippedNoInvestorMode,
  };
  console.log('[backfill-auto-navs] done', JSON.stringify(summary, null, 2));
  return summary;
}

try {
  run();
} catch (err) {
  console.error('[backfill-auto-navs] fatal error:', err);
  process.exit(1);
}
