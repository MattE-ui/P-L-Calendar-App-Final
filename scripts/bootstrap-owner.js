#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const USER_ROLES = new Set(['user', 'admin', 'owner']);

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeRole(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return USER_ROLES.has(normalized) ? normalized : 'user';
}

function resolveDbPath() {
  const defaultDir = process.env.DATA_DIR || path.join(__dirname, '..', 'storage');
  return process.env.DB_PATH || process.env.DATA_FILE || path.join(defaultDir, 'data.json');
}

function saveDbAtomic(dbPath, db) {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-owner-bootstrap-${Date.now()}-${process.pid}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpPath, dbPath);
}

function main() {
  const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL);
  if (!ownerEmail) {
    console.error('[owner-bootstrap] OWNER_EMAIL is required. No changes made.');
    process.exit(1);
  }

  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`[owner-bootstrap] DB file not found at ${dbPath}. No changes made.`);
    process.exit(1);
  }

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  db.users ||= {};

  const users = Object.entries(db.users);
  const ownerUsers = users
    .filter(([username, user]) => normalizeRole(user?.role) === 'owner')
    .map(([username]) => username);

  if (ownerUsers.length > 1) {
    console.error(`[owner-bootstrap] Multiple owner accounts already exist (${ownerUsers.join(', ')}). Refusing to continue.`);
    process.exit(1);
  }

  const matched = users.find(([username, user]) => {
    const usernameEmail = normalizeEmail(username);
    const userFieldEmail = normalizeEmail(user?.username);
    return usernameEmail === ownerEmail || userFieldEmail === ownerEmail;
  });

  if (!matched) {
    console.error(`[owner-bootstrap] OWNER_EMAIL (${ownerEmail}) does not match any existing user. No changes made.`);
    process.exit(1);
  }

  const [matchedUsername, matchedUser] = matched;
  if (ownerUsers.length === 1 && ownerUsers[0] !== matchedUsername) {
    console.error(`[owner-bootstrap] Owner already assigned to ${ownerUsers[0]}; refusing to replace with ${matchedUsername}.`);
    process.exit(1);
  }

  if (normalizeRole(matchedUser.role) === 'owner') {
    console.log(`[owner-bootstrap] ${matchedUsername} is already the owner. No changes needed.`);
    return;
  }

  matchedUser.role = 'owner';
  saveDbAtomic(dbPath, db);
  console.log(`[owner-bootstrap] Assigned owner role to ${matchedUsername}.`);
}

main();
