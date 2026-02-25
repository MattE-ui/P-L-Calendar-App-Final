require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const { z } = require('zod');
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (error) {
  console.warn('Nodemailer not installed; falling back to console email logging.');
}
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const analytics = require('./lib/analytics');

const TRADE_TYPES = ['scalp', 'day', 'swing', 'position'];
const ASSET_CLASSES = ['stocks', 'options', 'forex', 'crypto', 'futures', 'other'];
const MARKET_CONDITIONS = ['bull', 'bear', 'range', 'volatile', 'news-driven'];
const DEFAULT_SETUP_TAGS = ['breakout', 'pullback', 'mean reversion', 'trend', 'news', 'momentum'];
const DEFAULT_EMOTION_TAGS = ['FOMO', 'revenge', 'disciplined', 'hesitant', 'confident'];
const DIRECTIONS = ['long', 'short'];

process.on('unhandledRejection', (reason, promise) => {
  console.error('UnhandledRejection:', reason, { promise });
});

process.on('uncaughtException', (error) => {
  console.error('UncaughtException:', error);
});

const app = express();
const PORT = process.env.PORT || 3000;
const GUEST_TTL_HOURS = Number(process.env.GUEST_TTL_HOURS) || 24;
const GUEST_TTL_MS = GUEST_TTL_HOURS * 60 * 60 * 1000;
const GUEST_RATE_LIMIT_MAX = Number(process.env.GUEST_RATE_LIMIT_MAX) || 10;
const GUEST_RATE_LIMIT_WINDOW_MS = Number(process.env.GUEST_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000;
const isProduction = process.env.RENDER || process.env.NODE_ENV === 'production';
const IBKR_TOKEN_SECRET = process.env.IBKR_TOKEN_SECRET || '';
const IBKR_TOKEN_SECRET_FALLBACK = IBKR_TOKEN_SECRET || (isProduction ? crypto.randomBytes(32).toString('hex') : 'ibkr-dev-secret');
if (!IBKR_TOKEN_SECRET) {
  console.warn('[IBKR] IBKR_TOKEN_SECRET is not set. Connector token exchange will not work reliably across deploys.');
}
const IBKR_CACHE_TTL_MS = Number(process.env.IBKR_CACHE_TTL_MS) || 15000;
const IBKR_CONNECTOR_TOKEN_TTL_MS = Number(process.env.IBKR_CONNECTOR_TOKEN_TTL_MS) || 15 * 60 * 1000;
const IBKR_RATE_LIMIT_MAX = Number(process.env.IBKR_RATE_LIMIT_MAX) || 60;
const IBKR_RATE_LIMIT_WINDOW_MS = Number(process.env.IBKR_RATE_LIMIT_WINDOW_MS) || 60 * 1000;
const PORTFOLIO_SOURCE_T212_STALE_MS = Number(process.env.PORTFOLIO_SOURCE_T212_STALE_MS) || 36 * 60 * 60 * 1000;
const PORTFOLIO_SOURCE_IBKR_STALE_MS = Number(process.env.PORTFOLIO_SOURCE_IBKR_STALE_MS) || 5 * 60 * 1000;
const IBKR_CONNECTOR_WINDOWS_URL = process.env.IBKR_CONNECTOR_WINDOWS_URL || '';
const IBKR_CONNECTOR_WINDOWS_FILE = process.env.IBKR_CONNECTOR_WINDOWS_FILE || '';
const IBKR_CONNECTOR_WINDOWS_META_PATH = process.env.IBKR_CONNECTOR_WINDOWS_META_PATH || '';
const IBKR_CONNECTOR_WINDOWS_VERSION = process.env.IBKR_CONNECTOR_WINDOWS_VERSION || '';
const IBKR_CONNECTOR_WINDOWS_PUBLISHED_AT = process.env.IBKR_CONNECTOR_WINDOWS_PUBLISHED_AT || '';
const IBKR_CONNECTOR_WINDOWS_SHA256 = process.env.IBKR_CONNECTOR_WINDOWS_SHA256 || '';
const IBKR_CONNECTOR_WINDOWS_NOTES = process.env.IBKR_CONNECTOR_WINDOWS_NOTES || '';
const IBKR_CONNECTOR_WINDOWS_RELEASE_NOTES_URL = process.env.IBKR_CONNECTOR_WINDOWS_RELEASE_NOTES_URL || '';
const IBKR_INSTALLER_URL = process.env.IBKR_INSTALLER_URL || '';
const INVESTOR_PORTAL_DISABLED = String(process.env.INVESTOR_PORTAL_DISABLED || 'false').toLowerCase() === 'true';
const INVESTOR_TOKEN_SECRET = process.env.INVESTOR_TOKEN_SECRET || process.env.SESSION_SECRET || 'investor-dev-secret';

const guestRateLimit = new Map();
const ibkrRateLimit = new Map();

const DEFAULT_DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'storage');
const DB_PATH = process.env.DB_PATH || process.env.DATA_FILE || path.join(DEFAULT_DATA_DIR, 'data.json');
const LEGACY_DATA_FILE = path.join(__dirname, 'data.json');
const INSTANCE_ID = crypto.randomBytes(4).toString('hex');

function ensureDataStore() {
  const dataDir = path.dirname(DB_PATH);
  fs.mkdirSync(dataDir, { recursive: true });

  if (!fs.existsSync(DB_PATH)) {
    if (fs.existsSync(LEGACY_DATA_FILE) && LEGACY_DATA_FILE !== DB_PATH) {
      try {
        const legacy = fs.readFileSync(LEGACY_DATA_FILE, 'utf-8');
        if (legacy && legacy.trim()) {
          fs.writeFileSync(DB_PATH, legacy, 'utf-8');
          return;
        }
      } catch (error) {
        console.warn('Unable to migrate legacy data file:', error);
      }
    }

    const initialPayload = JSON.stringify({
      users: {},
      sessions: {}
    }, null, 2);
    fs.writeFileSync(DB_PATH, initialPayload, 'utf-8');
  }
}

ensureDataStore();

function isStrongPassword(password) {
  if (typeof password !== 'string' || password.length < 12) return false;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  return hasUpper && hasLower && hasNumber && hasSymbol;
}

function normalizeNickname(raw) {
  if (typeof raw !== 'string') return { value: '', error: 'Nickname must be a string.' };
  const trimmed = raw.trim();
  if (!trimmed) return { value: '' };
  if (trimmed.length > 20) {
    return { value: '', error: 'Nicknames must be 20 characters or less.' };
  }
  if (!/^[A-Za-z0-9 ]+$/.test(trimmed)) {
    return { value: '', error: 'Nicknames can only contain letters, numbers, and spaces.' };
  }
  return { value: trimmed };
}

function loadIbkrInstallerMeta() {
  let meta = {};
  if (IBKR_CONNECTOR_WINDOWS_META_PATH && fs.existsSync(IBKR_CONNECTOR_WINDOWS_META_PATH)) {
    try {
      const raw = fs.readFileSync(IBKR_CONNECTOR_WINDOWS_META_PATH, 'utf-8');
      meta = JSON.parse(raw || '{}') || {};
    } catch (error) {
      console.warn('[IBKR] Unable to read installer metadata:', error);
    }
  }
  const version = meta.version || IBKR_CONNECTOR_WINDOWS_VERSION || 'latest';
  const publishedAt = meta.publishedAt || IBKR_CONNECTOR_WINDOWS_PUBLISHED_AT || null;
  const sha256 = meta.sha256 || IBKR_CONNECTOR_WINDOWS_SHA256 || null;
  const notes = meta.notes || IBKR_CONNECTOR_WINDOWS_NOTES || '';
  const releaseNotesUrl = meta.releaseNotesUrl || IBKR_CONNECTOR_WINDOWS_RELEASE_NOTES_URL || '';
  const filename = meta.filename || `veracity-ibkr-connector-${version}.exe`;
  let sizeBytes = meta.sizeBytes || null;
  if (!sizeBytes && IBKR_CONNECTOR_WINDOWS_FILE && fs.existsSync(IBKR_CONNECTOR_WINDOWS_FILE)) {
    try {
      const stats = fs.statSync(IBKR_CONNECTOR_WINDOWS_FILE);
      sizeBytes = stats.size;
    } catch (error) {
      sizeBytes = null;
    }
  }
  return {
    version,
    publishedAt,
    sha256,
    notes,
    releaseNotesUrl,
    sizeBytes,
    filename
  };
}

function resolveProjectRoot() {
  let current = path.resolve(__dirname);
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(current, 'package.json');
    if (fs.existsSync(candidate)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(__dirname, '..');
}

function resolveIbkrInstallerPath() {
  if (IBKR_CONNECTOR_WINDOWS_FILE) {
    const absolutePath = path.isAbsolute(IBKR_CONNECTOR_WINDOWS_FILE)
      ? IBKR_CONNECTOR_WINDOWS_FILE
      : path.resolve(resolveProjectRoot(), IBKR_CONNECTOR_WINDOWS_FILE);
    return { source: 'env', path: absolutePath };
  }
  const root = resolveProjectRoot();
  const fallbackPath = path.join(root, 'assets', 'installers', 'VeracityInstaller.exe');
  return { source: 'assets', path: fallbackPath };
}

function isNicknameAvailable(db, nickname, username) {
  if (!nickname) return true;
  const candidate = nickname.toLowerCase();
  return !Object.entries(db.users).some(([key, other]) => {
    if (key === username) return false;
    const otherUsername = typeof other?.username === 'string' ? other.username : key;
    const otherNickname = typeof other?.nickname === 'string' ? other.nickname : '';
    return (otherUsername && otherUsername.toLowerCase() === candidate)
      || (otherNickname && otherNickname.toLowerCase() === candidate);
  });
}

const Trading212Error = (() => {
  if (global.__Trading212Error__) {
    return global.__Trading212Error__;
  }
  class Trading212ErrorImpl extends Error {
    constructor(message, { status, retryAfter, code } = {}) {
      super(message);
      this.name = 'Trading212Error';
      if (status !== undefined) this.status = status;
      if (retryAfter !== undefined) this.retryAfter = retryAfter;
      if (code !== undefined) this.code = code;
    }
  }
  class Trading212AuthError extends Trading212ErrorImpl {
    constructor(message, meta = {}) {
      super(message, { ...meta, code: meta.code || 'auth_error' });
      this.name = 'Trading212AuthError';
    }
  }
  class Trading212HttpError extends Trading212ErrorImpl {
    constructor(message, meta = {}) {
      super(message, { ...meta, code: meta.code || 'http_error' });
      this.name = 'Trading212HttpError';
    }
  }
  class Trading212RateLimitError extends Trading212ErrorImpl {
    constructor(message, meta = {}) {
      super(message, { ...meta, code: meta.code || 'rate_limited' });
      this.name = 'Trading212RateLimitError';
    }
  }
  class Trading212NetworkError extends Trading212ErrorImpl {
    constructor(message, meta = {}) {
      super(message, { ...meta, code: meta.code || 'network_error' });
      this.name = 'Trading212NetworkError';
    }
  }
  class Trading212ParseError extends Trading212ErrorImpl {
    constructor(message, meta = {}) {
      super(message, { ...meta, code: meta.code || 'parse_error' });
      this.name = 'Trading212ParseError';
    }
  }
  global.__Trading212Error__ = Trading212ErrorImpl;
  global.__Trading212AuthError__ = Trading212AuthError;
  global.__Trading212HttpError__ = Trading212HttpError;
  global.__Trading212RateLimitError__ = Trading212RateLimitError;
  global.__Trading212NetworkError__ = Trading212NetworkError;
  global.__Trading212ParseError__ = Trading212ParseError;
  return Trading212ErrorImpl;
})();

const Trading212AuthError = global.__Trading212AuthError__;
const Trading212HttpError = global.__Trading212HttpError__;
const Trading212RateLimitError = global.__Trading212RateLimitError__;
const Trading212NetworkError = global.__Trading212NetworkError__;
const Trading212ParseError = global.__Trading212ParseError__;

const IbkrError = (() => {
  if (global.__IbkrError__) {
    return global.__IbkrError__;
  }
  class IbkrErrorImpl extends Error {
    constructor(message, { status, code } = {}) {
      super(message);
      this.name = 'IbkrError';
      if (status !== undefined) this.status = status;
      if (code !== undefined) this.code = code;
    }
  }
  class IbkrAuthError extends IbkrErrorImpl {
    constructor(message, meta = {}) {
      super(message, { ...meta, code: meta.code || 'auth_error' });
      this.name = 'IbkrAuthError';
    }
  }
  class IbkrHttpError extends IbkrErrorImpl {
    constructor(message, meta = {}) {
      super(message, { ...meta, code: meta.code || 'http_error' });
      this.name = 'IbkrHttpError';
    }
  }
  class IbkrNetworkError extends IbkrErrorImpl {
    constructor(message, meta = {}) {
      super(message, { ...meta, code: meta.code || 'network_error' });
      this.name = 'IbkrNetworkError';
    }
  }
  class IbkrParseError extends IbkrErrorImpl {
    constructor(message, meta = {}) {
      super(message, { ...meta, code: meta.code || 'parse_error' });
      this.name = 'IbkrParseError';
    }
  }
  global.__IbkrError__ = IbkrErrorImpl;
  global.__IbkrAuthError__ = IbkrAuthError;
  global.__IbkrHttpError__ = IbkrHttpError;
  global.__IbkrNetworkError__ = IbkrNetworkError;
  global.__IbkrParseError__ = IbkrParseError;
  return IbkrErrorImpl;
})();

const IbkrAuthError = global.__IbkrAuthError__;
const IbkrHttpError = global.__IbkrHttpError__;
const IbkrNetworkError = global.__IbkrNetworkError__;
const IbkrParseError = global.__IbkrParseError__;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfter(header) {
  if (!header) return null;
  const numeric = Number(header);
  if (Number.isFinite(numeric)) {
    return Math.max(0, numeric);
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const diff = Math.ceil((date - Date.now()) / 1000);
    return diff > 0 ? diff : 0;
  }
  return null;
}

function checkIbkrRateLimit(key, res) {
  const now = Date.now();
  const entry = ibkrRateLimit.get(key) || { count: 0, resetAt: now + IBKR_RATE_LIMIT_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + IBKR_RATE_LIMIT_WINDOW_MS;
  }
  entry.count += 1;
  ibkrRateLimit.set(key, entry);
  if (entry.count > IBKR_RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Too many IBKR requests. Please retry shortly.' });
    return false;
  }
  return true;
}

// --- helpers ---
function loadDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const db = JSON.parse(raw);
    db.users ||= {};
    db.sessions ||= {};
    db.verifications ||= {};
    db.emailChangeRequests ||= {};
    if (!Array.isArray(db.instrumentMappings)) {
      db.instrumentMappings = [];
    }
    if (!Array.isArray(db.brokerSnapshots)) {
      db.brokerSnapshots = [];
    }
    if (!Array.isArray(db.ibkrConnectorTokens)) {
      db.ibkrConnectorTokens = [];
    }
    if (!Array.isArray(db.ibkrConnectorKeys)) {
      db.ibkrConnectorKeys = [];
    }
    if (!Array.isArray(db.investorProfiles)) {
      db.investorProfiles = [];
    }
    if (!Array.isArray(db.investorLogins)) {
      db.investorLogins = [];
    }
    if (!Array.isArray(db.investorPermissions)) {
      db.investorPermissions = [];
    }
    if (!Array.isArray(db.investorCashflows)) {
      db.investorCashflows = [];
    }
    if (!Array.isArray(db.investorValuations)) {
      db.investorValuations = [];
    }
    if (!Array.isArray(db.investorInvites)) {
      db.investorInvites = [];
    }
    db.investorSessions ||= {};
    const mutated = reconcileIbkrTokenSecret(db);
    if (mutated) {
      try {
        saveDB(db);
      } catch (error) {
        console.warn('Unable to persist IBKR connector secret migration:', error);
      }
    }
    return db;
  } catch (e) {
    console.warn('Falling back to empty database in loadDB:', e?.message || e);
    return {
      users: {},
      sessions: {},
      instrumentMappings: [],
      brokerSnapshots: [],
      ibkrConnectorTokens: [],
      ibkrConnectorKeys: [],
      investorProfiles: [],
      investorLogins: [],
      investorPermissions: [],
      investorCashflows: [],
      investorValuations: [],
      investorInvites: [],
      investorSessions: {}
    };
  }
}

function saveDB(db) {
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.tmp-${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  );

  const payload = JSON.stringify(db, null, 2);
  try {
    fs.writeFileSync(tmp, payload, 'utf-8');
    fs.renameSync(tmp, DB_PATH);
  } catch (error) {
    console.error('Failed to persist database snapshot:', error);
    throw error;
  } finally {
    if (fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch (cleanupError) {
        console.warn('Could not remove temporary data file:', cleanupError);
      }
    }
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function applyGuestRateLimit(req) {
  const key = getClientIp(req);
  const now = Date.now();
  const entry = guestRateLimit.get(key);
  if (!entry || entry.resetAt <= now) {
    guestRateLimit.set(key, { count: 1, resetAt: now + GUEST_RATE_LIMIT_WINDOW_MS });
    return null;
  }
  if (entry.count >= GUEST_RATE_LIMIT_MAX) {
    return entry.resetAt - now;
  }
  entry.count += 1;
  return null;
}

function clearSessionsForUser(db, username) {
  const tokens = Object.keys(db.sessions);
  for (const token of tokens) {
    if (db.sessions[token] === username) {
      delete db.sessions[token];
    }
  }
}

function cleanupExpiredGuests(db, now = new Date()) {
  if (!db?.users) return false;
  const nowMs = now.getTime();
  let mutated = false;
  for (const [username, user] of Object.entries(db.users)) {
    if (!user?.guest) continue;
    const expiresAt = Date.parse(user.expiresAt);
    if (Number.isNaN(expiresAt) || expiresAt > nowMs) continue;
    delete db.users[username];
    clearSessionsForUser(db, username);
    mutated = true;
  }
  return mutated;
}

function auth(req, res, next) {
  const token = req.cookies?.auth_token;
  if (!token) return res.status(401).json({ error: 'Unauthenticated' });
  const db = loadDB();
  const username = db.sessions[token];
  if (!username) return res.status(401).json({ error: 'Unauthenticated' });
  const user = db.users[username];
  if (!user) return res.status(401).json({ error: 'Unauthenticated' });
  if (user.guest && user.expiresAt) {
    const expiresAt = Date.parse(user.expiresAt);
    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
      delete db.users[username];
      clearSessionsForUser(db, username);
      saveDB(db);
      res.clearCookie('auth_token');
      return res.status(401).json({
        error: 'Guest session expired. Continue as Guest again or sign up.'
      });
    }
  }
  req.username = username;
  req.user = user;
  req.isGuest = !!user.guest;
  next();
}

function rejectGuest(req, res) {
  if (req.user?.guest) {
    res.status(403).json({ error: 'Guests cannot perform this action. Please create an account.' });
    return true;
  }
  return false;
}

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function ensureInvestorTables(db) {
  db.investorProfiles ||= [];
  db.investorLogins ||= [];
  db.investorPermissions ||= [];
  db.investorCashflows ||= [];
  db.investorValuations ||= [];
  db.investorInvites ||= [];
  db.investorSessions ||= {};
}

function createSignedToken(payload, ttlMs) {
  const fullPayload = { ...payload, exp: Date.now() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto.createHmac('sha256', INVESTOR_TOKEN_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifySignedToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', INVESTOR_TOKEN_SECRET).update(encoded).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (error) {
    return null;
  }
  if (!payload?.exp || payload.exp < Date.now()) return null;
  return payload;
}

function hashInviteToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getInvestorPermissions(db, investorProfileId) {
  return db.investorPermissions.find(p => p.investorProfileId === investorProfileId) || {
    investorProfileId,
    canViewPositions: false,
    canViewTradeLog: false,
    canViewNotes: true,
    createdAt: new Date().toISOString()
  };
}

function computeInvestorSummary(db, investorProfileId) {
  const cashflows = db.investorCashflows.filter(c => c.investorProfileId === investorProfileId);
  const valuations = db.investorValuations
    .filter(v => v.investorProfileId === investorProfileId)
    .sort((a, b) => String(a.valuationDate).localeCompare(String(b.valuationDate)));
  const latest = valuations[valuations.length - 1] || null;
  const netDeposits = cashflows.reduce((sum, flow) => {
    const amount = Number(flow.amount) || 0;
    if (flow.type === 'deposit') return sum + amount;
    if (flow.type === 'withdrawal' || flow.type === 'fee') return sum - amount;
    return sum;
  }, 0);
  const nav = Number(latest?.nav) || 0;
  const totalPnl = nav - netDeposits;
  const totalReturnPct = netDeposits === 0 ? 0 : (totalPnl / netDeposits) * 100;
  return {
    nav,
    netDeposits,
    totalPnl,
    totalReturnPct,
    mtdPnl: latest?.pnlMtd ?? null,
    mtdPct: null,
    ytdPnl: latest?.pnlYtd ?? null,
    ytdPct: null
  };
}

function requireMasterAuth(req, res, next) {
  return auth(req, res, next);
}

function requireMasterInvestorAccess(req, res, next) {
  if (INVESTOR_PORTAL_DISABLED) return res.status(503).json({ error: 'Investor portal is temporarily unavailable.' });
  if (req.user?.guest) return res.status(403).json({ error: 'Guests cannot perform this action. Please create an account.' });
  if (!req.user?.investorAccountsEnabled) {
    return res.status(403).json({ error: 'Investor accounts are not enabled for this account.' });
  }
  return next();
}

function requireInvestorAuth(req, res, next) {
  const db = loadDB();
  ensureInvestorTables(db);
  let authContext = null;
  const bearer = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : '';
  if (bearer) {
    const payload = verifySignedToken(bearer);
    if (payload && (payload.role === 'investor_preview' || payload.role === 'investor')) {
      authContext = payload;
    }
  }
  if (!authContext) {
    const investorToken = req.cookies?.investor_session;
    const investorSession = investorToken ? db.investorSessions[investorToken] : null;
    if (investorSession) authContext = investorSession;
  }
  if (!authContext?.investorProfileId) return res.status(401).json({ error: 'Unauthenticated investor session.' });
  const profile = db.investorProfiles.find(p => p.id === authContext.investorProfileId);
  if (!profile || profile.status !== 'active') return res.status(403).json({ error: 'Investor account inactive.' });
  req.investorAuth = authContext;
  req.investorProfile = profile;
  req.investorPermissions = getInvestorPermissions(db, profile.id);
  req.investorDb = db;
  next();
}

function ensurePortfolioHistory(user) {
  if (!user) return {};
  if (!user.portfolioHistory || typeof user.portfolioHistory !== 'object') {
    user.portfolioHistory = user.profits && typeof user.profits === 'object'
      ? user.profits
      : {};
    delete user.profits;
  }
  return user.portfolioHistory;
}

function ensureTradeJournal(user) {
  if (!user) return {};
  if (!user.tradeJournal || typeof user.tradeJournal !== 'object') {
    user.tradeJournal = {};
  }
  return user.tradeJournal;
}

function ensureTrading212Config(user) {
  if (!user) return { mutated: false, config: {} };
  let mutated = false;
  if (!user.trading212 || typeof user.trading212 !== 'object') {
    user.trading212 = {};
    mutated = true;
  }
  const cfg = user.trading212;
  if (!Array.isArray(cfg.accounts)) {
    cfg.accounts = [];
    mutated = true;
  }
  if (typeof cfg.enabled !== 'boolean') {
    cfg.enabled = false;
    mutated = true;
  }
  if (typeof cfg.apiKey !== 'string') {
    cfg.apiKey = '';
    mutated = true;
  }
  if (typeof cfg.apiSecret !== 'string') {
    cfg.apiSecret = '';
    mutated = true;
  }
  if (typeof cfg.baseUrl !== 'string') {
    cfg.baseUrl = '';
    mutated = true;
  }
  if (typeof cfg.endpoint !== 'string' || !cfg.endpoint.trim()) {
    cfg.endpoint = '/api/v0/equity/portfolio/summary';
    mutated = true;
  } else if (!cfg.endpoint.startsWith('/')) {
    cfg.endpoint = `/${cfg.endpoint.replace(/^\/+/, '')}`;
    mutated = true;
  }
  if (typeof cfg.snapshotTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.snapshotTime)) {
    cfg.snapshotTime = '21:00';
    mutated = true;
  }
  if (typeof cfg.mode !== 'string' || !['live', 'practice'].includes(cfg.mode)) {
    cfg.mode = 'live';
    mutated = true;
  }
  if (typeof cfg.timezone !== 'string' || !cfg.timezone) {
    cfg.timezone = 'Europe/London';
    mutated = true;
  }
  if (cfg.cooldownUntil !== undefined) {
    const ts = Date.parse(cfg.cooldownUntil);
    if (Number.isNaN(ts)) {
      delete cfg.cooldownUntil;
      mutated = true;
    }
  }
  if (cfg.lastBaseUrl !== undefined && typeof cfg.lastBaseUrl !== 'string') {
    delete cfg.lastBaseUrl;
    mutated = true;
  }
  if (cfg.lastEndpoint !== undefined && typeof cfg.lastEndpoint !== 'string') {
    delete cfg.lastEndpoint;
    mutated = true;
  }
  if (cfg.lastNetDeposits !== undefined && !Number.isFinite(Number(cfg.lastNetDeposits))) {
    delete cfg.lastNetDeposits;
    mutated = true;
  }
  if (!Array.isArray(cfg.processedReferences)) {
    cfg.processedReferences = [];
    mutated = true;
  }
  if (!cfg.symbolOverrides || typeof cfg.symbolOverrides !== 'object' || Array.isArray(cfg.symbolOverrides)) {
    cfg.symbolOverrides = {};
    mutated = true;
  }
  const accounts = Array.isArray(cfg.accounts) ? cfg.accounts : [];
  const normalizedAccounts = accounts
    .filter(account => account && typeof account === 'object')
    .map(account => ({
      id: typeof account.id === 'string' && account.id.trim() ? account.id.trim() : crypto.randomBytes(6).toString('hex'),
      label: typeof account.label === 'string' ? account.label.trim() : '',
      apiKey: typeof account.apiKey === 'string' ? account.apiKey.trim() : '',
      apiSecret: typeof account.apiSecret === 'string' ? account.apiSecret.trim() : '',
      mode: typeof account.mode === 'string' && ['live', 'practice'].includes(account.mode) ? account.mode : undefined,
      baseUrl: typeof account.baseUrl === 'string' ? account.baseUrl.trim() : ''
    }))
    .filter(account => account.apiKey || account.apiSecret || account.label);
  if (normalizedAccounts.length !== accounts.length) {
    cfg.accounts = normalizedAccounts;
    mutated = true;
  } else {
    cfg.accounts = normalizedAccounts;
  }
  if (!cfg.accounts.length && (cfg.apiKey || cfg.apiSecret)) {
    cfg.accounts = [{
      id: 'primary',
      label: '',
      apiKey: cfg.apiKey.trim(),
      apiSecret: cfg.apiSecret.trim()
    }];
    mutated = true;
  }
  if (cfg.accounts.length) {
    cfg.apiKey = cfg.accounts[0].apiKey || '';
    cfg.apiSecret = cfg.accounts[0].apiSecret || '';
  }
  return { mutated, config: cfg };
}

function getTrading212Accounts(cfg) {
  if (!cfg) return [];
  const accounts = Array.isArray(cfg.accounts) ? cfg.accounts : [];
  return accounts.filter(account => account?.apiKey && account?.apiSecret);
}

function resolveTrading212AccountForTrade(cfg, trade) {
  const accounts = getTrading212Accounts(cfg);
  if (!accounts.length) return null;
  const accountId = trade?.trading212AccountId;
  if (accountId) {
    const matched = accounts.find(account => account?.id === accountId);
    return matched || accounts[0];
  }
  return accounts[0];
}

function ensureIbkrConfig(user) {
  if (!user) return { mutated: false, config: {} };
  let mutated = false;
  if (!user.ibkr || typeof user.ibkr !== 'object') {
    user.ibkr = {};
    mutated = true;
  }
  const cfg = user.ibkr;
  if (typeof cfg.enabled !== 'boolean') {
    cfg.enabled = false;
    mutated = true;
  }
  if (cfg.mode !== 'connector') {
    cfg.mode = 'connector';
    mutated = true;
  }
  if (typeof cfg.accountId !== 'string') {
    cfg.accountId = '';
    mutated = true;
  }
  if (typeof cfg.lastHeartbeatAt !== 'string') {
    cfg.lastHeartbeatAt = '';
    mutated = true;
  }
  if (typeof cfg.lastSnapshotAt !== 'string') {
    cfg.lastSnapshotAt = '';
    mutated = true;
  }
  if (typeof cfg.connectionStatus !== 'string') {
    cfg.connectionStatus = 'disconnected';
    mutated = true;
  }
  if (cfg.lastSyncAt !== undefined && typeof cfg.lastSyncAt !== 'string') {
    delete cfg.lastSyncAt;
    mutated = true;
  }
  if (cfg.lastStatus !== undefined && typeof cfg.lastStatus !== 'object') {
    delete cfg.lastStatus;
    mutated = true;
  }
  if (cfg.gatewayUrl !== undefined && typeof cfg.gatewayUrl !== 'string') {
    delete cfg.gatewayUrl;
    mutated = true;
  }
  if (cfg.lastSessionCheckAt !== undefined && typeof cfg.lastSessionCheckAt !== 'string') {
    delete cfg.lastSessionCheckAt;
    mutated = true;
  }
  if (cfg.encryptedTokens !== undefined && typeof cfg.encryptedTokens !== 'string') {
    delete cfg.encryptedTokens;
    mutated = true;
  }
  if (cfg.sessionMetadata && typeof cfg.sessionMetadata !== 'object') {
    delete cfg.sessionMetadata;
    mutated = true;
  }
  if (cfg.lastPortfolioValue !== undefined && !Number.isFinite(Number(cfg.lastPortfolioValue))) {
    delete cfg.lastPortfolioValue;
    mutated = true;
  }
  if (cfg.lastPortfolioCurrency !== undefined && typeof cfg.lastPortfolioCurrency !== 'string') {
    delete cfg.lastPortfolioCurrency;
    mutated = true;
  }
  if (cfg.lastNetDeposits !== undefined && !Number.isFinite(Number(cfg.lastNetDeposits))) {
    delete cfg.lastNetDeposits;
    mutated = true;
  }
  if (cfg.lastConnectorStatus !== undefined && typeof cfg.lastConnectorStatus !== 'object') {
    delete cfg.lastConnectorStatus;
    mutated = true;
  }
  if (!Array.isArray(cfg.livePositions)) {
    cfg.livePositions = [];
    mutated = true;
  }
  if (!Array.isArray(cfg.liveOrders)) {
    cfg.liveOrders = [];
    mutated = true;
  }
  if (!cfg.live || typeof cfg.live !== 'object') {
    cfg.live = {};
    mutated = true;
  }
  if (!Array.isArray(cfg.live.positions)) {
    cfg.live.positions = [];
    mutated = true;
  }
  if (!Array.isArray(cfg.live.orders)) {
    cfg.live.orders = [];
    mutated = true;
  }
  if (cfg.live.updatedAt !== undefined && typeof cfg.live.updatedAt !== 'string') {
    delete cfg.live.updatedAt;
    mutated = true;
  }
  if (cfg.raw !== undefined && (typeof cfg.raw !== 'object' || Array.isArray(cfg.raw))) {
    delete cfg.raw;
    mutated = true;
  }
  if (cfg.connectorKeys !== undefined) {
    delete cfg.connectorKeys;
    mutated = true;
  }
  return { mutated, config: cfg };
}

function ensureUserShape(user, identifier) {
  if (!user) return false;
  let mutated = false;
  if (identifier && user.username !== identifier) {
    user.username = identifier;
    mutated = true;
  }
  if (!user.username && typeof user.email === 'string') {
    user.username = user.email;
    mutated = true;
  }
  if (user.nickname !== undefined && typeof user.nickname !== 'string') {
    delete user.nickname;
    mutated = true;
  }
  if (typeof user.nickname === 'string') {
    const normalized = normalizeNickname(user.nickname);
    if (normalized.error) {
      user.nickname = '';
      mutated = true;
    } else if (normalized.value !== user.nickname) {
      user.nickname = normalized.value;
      mutated = true;
    }
  }
  if (user.email !== undefined) {
    delete user.email;
    mutated = true;
  }
  if (user.emailVerified !== undefined) {
    delete user.emailVerified;
    mutated = true;
  }
  if (!user.security || typeof user.security !== 'object') {
    user.security = {};
    mutated = true;
  }
  if (user.guest === undefined) {
    user.guest = false;
    mutated = true;
  }
  if (user.guest) {
    if (!user.expiresAt || Number.isNaN(Date.parse(user.expiresAt))) {
      user.expiresAt = new Date(Date.now() + GUEST_TTL_MS).toISOString();
      mutated = true;
    }
  } else if (user.expiresAt !== undefined) {
    delete user.expiresAt;
    mutated = true;
  }
  if (user.security.pendingEmail !== undefined) {
    delete user.security.pendingEmail;
    mutated = true;
  }
  if (user.security.pendingPassword !== undefined) {
    delete user.security.pendingPassword;
    mutated = true;
  }
  if (user.security.verification !== undefined) {
    delete user.security.verification;
    mutated = true;
  }
  ensurePortfolioHistory(user);
  const { mutated: tradingMutated } = ensureTrading212Config(user);
  if (tradingMutated) mutated = true;
  const { mutated: ibkrMutated } = ensureIbkrConfig(user);
  if (ibkrMutated) mutated = true;
  if (user.initialNetDeposits === undefined) {
    user.initialNetDeposits = 0;
    mutated = true;
  }
  if (user.profileComplete === undefined) {
    const history = user.portfolioHistory || {};
    const hasEntries = Object.values(history).some(days => days && Object.keys(days).length);
    user.profileComplete = hasEntries;
    mutated = true;
  }
  if (typeof user.investorAccountsEnabled !== 'boolean') {
    user.investorAccountsEnabled = false;
    mutated = true;
  }
  if (user.investorPortalEnabledAt !== null && user.investorPortalEnabledAt !== undefined && typeof user.investorPortalEnabledAt !== 'string') {
    user.investorPortalEnabledAt = null;
    mutated = true;
  }
  if (user.investorPortalEnabledAt === undefined) {
    user.investorPortalEnabledAt = null;
    mutated = true;
  }
  if (!Number.isFinite(user.initialPortfolio)) {
    const fallback = Number.isFinite(user.portfolio) ? Number(user.portfolio) : 0;
    user.initialPortfolio = fallback;
    mutated = true;
  }
  if (!Number.isFinite(user.portfolio)) {
    user.portfolio = Number.isFinite(user.initialPortfolio) ? Number(user.initialPortfolio) : 0;
    mutated = true;
  }
  if (user.portfolioSource !== undefined && typeof user.portfolioSource !== 'string') {
    delete user.portfolioSource;
    mutated = true;
  }
  if (!user.portfolioSource || !['manual', 'trading212', 'ibkr'].includes(user.portfolioSource)) {
    user.portfolioSource = 'manual';
    mutated = true;
  }
  if (user.portfolioCurrency !== undefined && typeof user.portfolioCurrency !== 'string') {
    delete user.portfolioCurrency;
    mutated = true;
  }
  if (!user.portfolioCurrency) {
    user.portfolioCurrency = 'GBP';
    mutated = true;
  }
  if (user.lastPortfolioSyncAt !== undefined && typeof user.lastPortfolioSyncAt !== 'string') {
    delete user.lastPortfolioSyncAt;
    mutated = true;
  }
  if (user.netDepositsAnchor === undefined) {
    user.netDepositsAnchor = null;
    mutated = true;
  } else if (user.netDepositsAnchor !== null && typeof user.netDepositsAnchor !== 'string') {
    user.netDepositsAnchor = null;
    mutated = true;
  }
  if (!user.tradeJournal || typeof user.tradeJournal !== 'object') {
    user.tradeJournal = {};
    mutated = true;
  }
  if (!user.uiPrefs || typeof user.uiPrefs !== 'object') {
    user.uiPrefs = {};
    mutated = true;
  }
  if (!user.transactionPrefs || typeof user.transactionPrefs !== 'object') {
    user.transactionPrefs = {};
    mutated = true;
  }
  if (!Array.isArray(user.transactionProfiles)) {
    user.transactionProfiles = [];
    mutated = true;
  }
  if (!Array.isArray(user.ibkrSnapshots)) {
    user.ibkrSnapshots = [];
    mutated = true;
  }
  return mutated;
}

function normalizePortfolioHistory(user) {
  const history = ensurePortfolioHistory(user);
  let mutated = false;
  const anchor = typeof user.netDepositsAnchor === 'string' ? user.netDepositsAnchor : null;
  for (const [monthKey, days] of Object.entries(history)) {
    for (const [dateKey, record] of Object.entries(days)) {
      if (record === null || record === undefined) {
        delete days[dateKey];
        mutated = true;
        continue;
      }
      if (typeof record === 'number') {
        const preBaseline = anchor && dateKey < anchor;
        days[dateKey] = preBaseline
          ? { end: record, cashIn: 0, cashOut: 0, preBaseline: true }
          : { end: record, cashIn: 0, cashOut: 0 };
        mutated = true;
        continue;
      }
      if (typeof record === 'object') {
        if (record.end === undefined && typeof record.value === 'number') {
          const preBaseline = anchor && dateKey < anchor;
          days[dateKey] = preBaseline
            ? { end: record.value, cashIn: 0, cashOut: 0, preBaseline: true }
            : { end: record.value, cashIn: 0, cashOut: 0 };
          mutated = true;
          continue;
        }
        const cashInRaw = Number(record.cashIn ?? 0);
        const cashOutRaw = Number(record.cashOut ?? 0);
        const cashIn = Number.isFinite(cashInRaw) && cashInRaw >= 0 ? cashInRaw : 0;
        const cashOut = Number.isFinite(cashOutRaw) && cashOutRaw >= 0 ? cashOutRaw : 0;
        const noteRaw = typeof record.note === 'string' ? record.note : '';
        const note = noteRaw.trim();
        const preBaseline = anchor && dateKey < anchor;
        const end = Number(record.end);
        if (!Number.isFinite(end) || end < 0) {
          if (cashIn > 0 || cashOut > 0 || note) {
            const cashPayload = preBaseline
              ? { cashIn, cashOut, preBaseline: true }
              : { cashIn, cashOut };
            if (note) {
              cashPayload.note = note;
            }
            if (
              record.end !== undefined ||
              cashIn !== cashInRaw ||
              cashOut !== cashOutRaw ||
              (note && note !== noteRaw) ||
              (!note && record.note !== undefined)
            ) {
              mutated = true;
            }
            days[dateKey] = cashPayload;
          } else {
            delete days[dateKey];
            mutated = true;
          }
          continue;
        }
        if (
          cashIn !== cashInRaw ||
          cashOut !== cashOutRaw ||
          record.start !== undefined ||
          (note && note !== noteRaw) ||
          (!note && record.note !== undefined)
        ) {
          mutated = true;
        }
        const payload = preBaseline
          ? { end, cashIn, cashOut, preBaseline: true }
          : { end, cashIn, cashOut };
        if (note) {
          payload.note = note;
        }
        days[dateKey] = payload;
        continue;
      }
      delete days[dateKey];
      mutated = true;
    }
    if (!Object.keys(days).length) {
      delete history[monthKey];
      mutated = true;
    }
  }
  return mutated;
}

function listChronologicalEntries(history) {
  const entries = [];
  for (const days of Object.values(history || {})) {
    for (const [dateKey, record] of Object.entries(days || {})) {
      if (!record || typeof record !== 'object') continue;
      const end = Number(record.end);
      if (!Number.isFinite(end) || end < 0) continue;
      const cashIn = Number(record.cashIn ?? 0);
      const cashOut = Number(record.cashOut ?? 0);
      const noteRaw = typeof record.note === 'string' ? record.note : '';
      const note = noteRaw.trim();
      const payload = {
        date: dateKey,
        end,
        cashIn: Number.isFinite(cashIn) && cashIn >= 0 ? cashIn : 0,
        cashOut: Number.isFinite(cashOut) && cashOut >= 0 ? cashOut : 0,
        preBaseline: record.preBaseline === true
      };
      if (note) {
        payload.note = note;
      }
      entries.push(payload);
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}

function normalizeTradeJournal(user) {
  const journal = ensureTradeJournal(user);
  let mutated = false;
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/;
  for (const [dateKey, trades] of Object.entries(journal)) {
    if (!cleanDate.test(dateKey)) {
      delete journal[dateKey];
      mutated = true;
      continue;
    }
    if (!Array.isArray(trades)) {
      delete journal[dateKey];
      mutated = true;
      continue;
    }
    const normalized = [];
    for (const trade of trades) {
      if (!trade || typeof trade !== 'object') continue;
      const entry = Number(trade.entry);
      const stop = Number(trade.stop);
      const riskPct = Number(trade.riskPct);
      const currency = ['GBP', 'USD', 'EUR'].includes(trade.currency) ? trade.currency : 'GBP';
      const status = trade.status === 'closed' ? 'closed' : 'open';
      const symbol = typeof trade.symbol === 'string' ? trade.symbol.trim().toUpperCase() : '';
      const displaySymbol = typeof trade.displaySymbol === 'string' ? trade.displaySymbol.trim().toUpperCase() : '';
      const trading212Name = typeof trade.trading212Name === 'string' ? trade.trading212Name : '';
      const trading212Isin = typeof trade.trading212Isin === 'string' ? trade.trading212Isin : '';
      const trading212Ticker = typeof trade.trading212Ticker === 'string' ? trade.trading212Ticker : '';
      const trading212PositionKey = typeof trade.trading212PositionKey === 'string' ? trade.trading212PositionKey : '';
      const typeRaw = typeof trade.tradeType === 'string' ? trade.tradeType.trim().toLowerCase() : '';
      const assetRaw = typeof trade.assetClass === 'string' ? trade.assetClass.trim().toLowerCase() : '';
      const conditionRaw = typeof trade.marketCondition === 'string' ? trade.marketCondition.trim().toLowerCase() : '';
      const strategyTag = typeof trade.strategyTag === 'string' ? trade.strategyTag.trim() : '';
      const setupTags = sanitizeTagList(trade.setupTags ?? trade.tags ?? []);
      const emotionTags = sanitizeTagList(trade.emotionTags ?? []);
      const screenshotUrl = typeof trade.screenshotUrl === 'string' ? trade.screenshotUrl.trim() : '';
      const riskAmountGBP = Number(trade.riskAmountGBP);
      const positionGBP = Number(trade.positionGBP);
      const sizeUnits = Number(trade.sizeUnits ?? trade.quantity ?? trade.units ?? trade.shares);
      const perUnitRiskRaw = Number(trade.perUnitRisk);
      const currentStopRaw = Number(trade.currentStop);
      const currentStopSourceRaw = typeof trade.currentStopSource === 'string' ? trade.currentStopSource.trim().toLowerCase() : '';
      const currentStopLastSyncedAtRaw = typeof trade.currentStopLastSyncedAt === 'string' ? trade.currentStopLastSyncedAt : '';
      const t212StopOrderIdRaw = typeof trade.t212StopOrderId === 'string' ? trade.t212StopOrderId : '';
      const currentStopStale = trade.currentStopStale === true;
      const stopManualOverride = trade.stopManualOverride === true;
      const originalStopRaw = Number(trade.originalStopPrice);
      const directionRaw = typeof trade.direction === 'string' ? trade.direction.trim().toLowerCase() : '';
      const feesRaw = Number(trade.fees);
      const slippageRaw = Number(trade.slippage);
      const rounding = trade.rounding === 'whole' ? 'whole' : 'fractional';
      const portfolioGBPAtCalc = Number(trade.portfolioGBPAtCalc);
      const portfolioCurrencyAtCalc = Number(trade.portfolioCurrencyAtCalc);
      const fxFeeEligible = trade.fxFeeEligible === true;
      const fxFeeRate = Number(trade.fxFeeRate);
      if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(sizeUnits) || sizeUnits <= 0) {
        mutated = true;
        continue;
      }
      const stopValue = Number.isFinite(stop) && stop > 0 ? stop : undefined;
      const originalStopPrice = Number.isFinite(originalStopRaw) && originalStopRaw > 0
        ? originalStopRaw
        : stopValue;
      let perUnitRisk = Number.isFinite(perUnitRiskRaw) && perUnitRiskRaw > 0 ? perUnitRiskRaw : undefined;
      if (stopValue !== undefined) {
        const calculatedRisk = Math.abs(entry - stopValue);
        perUnitRisk = calculatedRisk > 0 ? calculatedRisk : perUnitRisk;
      }
      const riskAmountCurrencyRaw = Number(trade.riskAmountCurrency);
      const derivedRiskAmountCurrency = Number.isFinite(riskAmountCurrencyRaw) && riskAmountCurrencyRaw > 0
        ? riskAmountCurrencyRaw
        : (Number.isFinite(perUnitRisk) && Number.isFinite(sizeUnits) ? perUnitRisk * sizeUnits : undefined);
      const derivedRiskPct = Number.isFinite(portfolioCurrencyAtCalc) && portfolioCurrencyAtCalc > 0 && Number.isFinite(derivedRiskAmountCurrency)
        ? (derivedRiskAmountCurrency / portfolioCurrencyAtCalc) * 100
        : undefined;
      const id = typeof trade.id === 'string' && trade.id ? trade.id : crypto.randomBytes(8).toString('hex');
      const createdAt = typeof trade.createdAt === 'string' ? trade.createdAt : new Date().toISOString();
      const noteRaw = typeof trade.note === 'string' ? trade.note.trim() : '';
      const closePrice = Number(trade.closePrice);
      const closeDate = typeof trade.closeDate === 'string' ? trade.closeDate : undefined;
      const partialCloses = normalizePartialCloses(trade.partialCloses, cleanDate);
      const normalizedTrade = {
        id,
        entry,
        stop: stopValue,
        symbol: symbol || undefined,
        displaySymbol: displaySymbol || undefined,
        currency,
        riskPct: Number.isFinite(riskPct) && riskPct > 0
          ? riskPct
          : (Number.isFinite(derivedRiskPct) && derivedRiskPct > 0 ? derivedRiskPct : 0),
        perUnitRisk,
        sizeUnits,
        status,
        tradeType: TRADE_TYPES.includes(typeRaw) ? typeRaw : 'day',
        assetClass: ASSET_CLASSES.includes(assetRaw) ? assetRaw : 'stocks',
        strategyTag,
        marketCondition: MARKET_CONDITIONS.includes(conditionRaw) ? conditionRaw : '',
        direction: DIRECTIONS.includes(directionRaw) ? directionRaw : 'long',
        fees: Number.isFinite(feesRaw) && feesRaw >= 0 ? feesRaw : 0,
        slippage: Number.isFinite(slippageRaw) && slippageRaw >= 0 ? slippageRaw : 0,
        rounding,
        source: trade.source === 'trading212'
          ? 'trading212'
          : (trade.source === 'ibkr' ? 'ibkr' : 'manual'),
        setupTags,
        emotionTags,
        screenshotUrl: screenshotUrl || undefined,
        riskAmountGBP: Number.isFinite(riskAmountGBP) ? riskAmountGBP : undefined,
        positionGBP: Number.isFinite(positionGBP) ? positionGBP : undefined,
        portfolioGBPAtCalc: Number.isFinite(portfolioGBPAtCalc) ? portfolioGBPAtCalc : undefined,
        portfolioCurrencyAtCalc: Number.isFinite(portfolioCurrencyAtCalc) ? portfolioCurrencyAtCalc : undefined,
        createdAt,
        originalStopPrice
      };
      if (partialCloses.length) {
        normalizedTrade.partialCloses = partialCloses;
      }
      if (Number.isFinite(currentStopRaw) && currentStopRaw > 0) {
        normalizedTrade.currentStop = currentStopRaw;
      }
      if (currentStopSourceRaw === 'manual' || currentStopSourceRaw === 't212' || currentStopSourceRaw === 'ibkr') {
        normalizedTrade.currentStopSource = currentStopSourceRaw;
      }
      if (currentStopLastSyncedAtRaw) {
        normalizedTrade.currentStopLastSyncedAt = currentStopLastSyncedAtRaw;
      }
      if (t212StopOrderIdRaw) {
        normalizedTrade.t212StopOrderId = t212StopOrderIdRaw;
      }
      const ibkrStopOrderIdRaw = typeof trade.ibkrStopOrderId === 'string' ? trade.ibkrStopOrderId : '';
      if (ibkrStopOrderIdRaw) {
        normalizedTrade.ibkrStopOrderId = ibkrStopOrderIdRaw;
      }
      if (currentStopStale) {
        normalizedTrade.currentStopStale = true;
      }
      if (stopManualOverride) {
        normalizedTrade.stopManualOverride = true;
      }
      if (typeof trade.trading212Id === 'string' && trade.trading212Id) {
        normalizedTrade.trading212Id = trade.trading212Id;
      }
      if (trading212PositionKey) {
        normalizedTrade.trading212PositionKey = trading212PositionKey;
      }
      if (trading212Name) {
        normalizedTrade.trading212Name = trading212Name;
      }
      if (trading212Isin) {
        normalizedTrade.trading212Isin = trading212Isin;
      }
      if (trading212Ticker) {
        normalizedTrade.trading212Ticker = trading212Ticker;
      }
      if (typeof trade.ibkrPositionId === 'string' && trade.ibkrPositionId) {
        normalizedTrade.ibkrPositionId = trade.ibkrPositionId;
      }
      if (typeof trade.ibkrTicker === 'string' && trade.ibkrTicker) {
        normalizedTrade.ibkrTicker = trade.ibkrTicker;
      }
      if (typeof trade.ibkrConid === 'string' && trade.ibkrConid) {
        normalizedTrade.ibkrConid = trade.ibkrConid;
      }
      const lastSyncPrice = parseTradingNumber(trade.lastSyncPrice);
      const ppl = parseTradingNumber(trade.ppl);
      if (Number.isFinite(lastSyncPrice)) {
        normalizedTrade.lastSyncPrice = lastSyncPrice;
      }
      if (Number.isFinite(ppl)) {
        normalizedTrade.ppl = ppl;
      }
      if (fxFeeEligible) {
        normalizedTrade.fxFeeEligible = true;
        if (Number.isFinite(fxFeeRate) && fxFeeRate > 0) {
          normalizedTrade.fxFeeRate = fxFeeRate;
        }
      }
      if (Number.isFinite(trade.riskAmountCurrency)) normalizedTrade.riskAmountCurrency = trade.riskAmountCurrency;
      if (!Number.isFinite(normalizedTrade.riskAmountCurrency) && Number.isFinite(derivedRiskAmountCurrency)) {
        normalizedTrade.riskAmountCurrency = derivedRiskAmountCurrency;
      }
      if (Number.isFinite(trade.positionCurrency)) normalizedTrade.positionCurrency = trade.positionCurrency;
      if (status === 'closed' && Number.isFinite(closePrice) && closePrice > 0) {
        normalizedTrade.closePrice = closePrice;
        if (closeDate && cleanDate.test(closeDate)) {
          normalizedTrade.closeDate = closeDate;
        }
      }
      if (noteRaw) normalizedTrade.note = noteRaw;
      normalized.push(normalizedTrade);
      if (normalized.length >= 50) break; // guard against runaway growth
    }
    if (!normalized.length) {
      delete journal[dateKey];
      mutated = true;
    } else if (normalized.length !== trades.length) {
      journal[dateKey] = normalized;
      mutated = true;
    } else {
      journal[dateKey] = normalized;
    }
  }
  return mutated;
}

function computeRealizedPnl(trade, rates = {}) {
  if (!trade) return null;
  const entry = Number(trade.entry);
  if (!Number.isFinite(entry)) {
    return null;
  }
  const partialCloses = Array.isArray(trade.partialCloses) ? trade.partialCloses : [];
  const partialPnlCurrency = partialCloses.reduce((sum, close) => {
    const units = Number(close?.units);
    const price = Number(close?.price);
    if (!Number.isFinite(units) || units <= 0 || !Number.isFinite(price) || price <= 0) {
      return sum;
    }
    return sum + computePartialClosePnlCurrency(trade, units, price);
  }, 0);
  let finalPnlCurrency = 0;
  if (trade.status === 'closed') {
    const closePrice = Number(trade.closePrice);
    const sizeUnits = Number(trade.sizeUnits);
    if (!Number.isFinite(closePrice) || !Number.isFinite(sizeUnits)) {
      return null;
    }
    finalPnlCurrency = computePartialClosePnlCurrency(trade, sizeUnits, closePrice);
  }
  const grossPnlCurrency = partialPnlCurrency + finalPnlCurrency;
  const pnlGBP = convertToGBP(grossPnlCurrency, trade.currency || 'GBP', rates);
  const feesCurrency = Number(trade.fees) || 0;
  const netPnlCurrency = grossPnlCurrency - feesCurrency;
  const realizedPnlGBP = Number.isFinite(Number(trade.realizedPnlGBP))
    ? Number(trade.realizedPnlGBP)
    : (Number.isFinite(pnlGBP) ? pnlGBP - convertToGBP(feesCurrency, trade.currency || 'GBP', rates) : netPnlCurrency);
  const riskGBP = Number(trade.riskAmountGBP);
  const rMultiple = Number.isFinite(riskGBP) && riskGBP !== 0 ? realizedPnlGBP / riskGBP : null;
  return { realizedPnlGBP, realizedPnlCurrency: netPnlCurrency, rMultiple };
}

function computeGuaranteedPnl(trade, rates = {}) {
  if (!trade) return null;
  const currentStop = Number(trade.currentStop);
  const entry = Number(trade.entry);
  const sizeUnits = Number(trade.sizeUnits);
  if (!Number.isFinite(currentStop) || currentStop <= 0 || !Number.isFinite(entry) || !Number.isFinite(sizeUnits)) {
    return null;
  }
  const direction = trade.direction === 'short' ? 'short' : 'long';
  const pnlCurrency = direction === 'long'
    ? (currentStop - entry) * sizeUnits
    : (entry - currentStop) * sizeUnits;
  let pnlGBP = convertToGBP(pnlCurrency, trade.currency || 'GBP', rates);
  const fxFeeEligible = trade.fxFeeEligible === true;
  const fxFeeRate = Number(trade.fxFeeRate);
  if (fxFeeEligible && Number.isFinite(fxFeeRate) && fxFeeRate > 0) {
    const entryValueGBP = convertToGBP(entry * sizeUnits, trade.currency || 'GBP', rates);
    const stopValueGBP = convertToGBP(currentStop * sizeUnits, trade.currency || 'GBP', rates);
    if (Number.isFinite(entryValueGBP)) {
      const entryFeeGBP = Math.abs(entryValueGBP) * fxFeeRate;
      const exitBasisGBP = Number.isFinite(stopValueGBP) ? Math.abs(stopValueGBP) : Math.abs(entryValueGBP);
      const exitFeeGBP = exitBasisGBP * fxFeeRate;
      const fxFeeGBP = entryFeeGBP + exitFeeGBP;
      if (Number.isFinite(pnlGBP)) {
        pnlGBP -= fxFeeGBP;
      }
    }
  }
  return Number.isFinite(pnlGBP) ? pnlGBP : pnlCurrency;
}

function flattenTrades(user, rates = {}) {
  const journal = ensureTradeJournal(user);
  const trades = [];
  for (const [dateKey, items] of Object.entries(journal)) {
    for (const trade of items || []) {
      if (!trade || typeof trade !== 'object') continue;
      const normalized = normalizeTradeMeta(trade);
      const base = { ...normalized, openDate: dateKey };
      base.status = base.status === 'closed' ? 'closed' : 'open';
      base.currency = base.currency || 'GBP';
      if (!base.createdAt) {
        base.createdAt = new Date().toISOString();
      }
      const pnl = computeRealizedPnl(base, rates);
      if (pnl) {
        base.realizedPnlGBP = pnl.realizedPnlGBP;
        base.realizedPnlCurrency = pnl.realizedPnlCurrency;
        base.rMultiple = pnl.rMultiple;
      }
      const guaranteedPnlGBP = computeGuaranteedPnl(base, rates);
      if (guaranteedPnlGBP !== null) {
        base.guaranteedPnlGBP = guaranteedPnlGBP;
      }
      const closeDate = typeof base.closeDate === 'string' ? base.closeDate : null;
      base.closeDate = closeDate || base.close_at || base.openDate;
      trades.push(base);
    }
  }
  return trades;
}

function filterTrades(trades = [], filters = {}) {
  const from = typeof filters.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(filters.from) ? filters.from : null;
  const to = typeof filters.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(filters.to) ? filters.to : null;
  const symbol = typeof filters.symbol === 'string' ? filters.symbol.trim().toUpperCase() : null;
  const tradeType = typeof filters.tradeType === 'string' ? filters.tradeType.trim().toLowerCase() : null;
  const assetClass = typeof filters.assetClass === 'string' ? filters.assetClass.trim().toLowerCase() : null;
  const strategyTag = typeof filters.strategyTag === 'string' ? filters.strategyTag.trim().toLowerCase() : null;
  const marketCondition = typeof filters.marketCondition === 'string' ? filters.marketCondition.trim().toLowerCase() : null;
  const tags = sanitizeTagList(filters.tags);
  const winLoss = typeof filters.winLoss === 'string' ? filters.winLoss.trim().toLowerCase() : null;
  const status = typeof filters.status === 'string' ? filters.status.trim().toLowerCase() : null;

  return trades.filter(trade => {
    const dateKey = trade.status === 'closed' ? trade.closeDate : trade.openDate;
    if (from && dateKey < from) return false;
    if (to && dateKey > to) return false;
    if (symbol) {
      const display = (trade.displayTicker || trade.displaySymbol || trade.symbol || '').toUpperCase();
      if (display !== symbol && (trade.symbol || '').toUpperCase() !== symbol) return false;
    }
    if (tradeType && (trade.tradeType || '').toLowerCase() !== tradeType) return false;
    if (assetClass && (trade.assetClass || '').toLowerCase() !== assetClass) return false;
    if (strategyTag && (trade.strategyTag || '').toLowerCase() !== strategyTag) return false;
    if (marketCondition && (trade.marketCondition || '').toLowerCase() !== marketCondition) return false;
    if (status && status !== (trade.status || '').toLowerCase()) return false;
    if (tags.length) {
      const allTags = [
        ...(trade.setupTags || []),
        ...(trade.emotionTags || []),
        trade.strategyTag || ''
      ].map(t => (t || '').toString().toLowerCase());
      const missing = tags.some(tag => !allTags.includes(tag.toLowerCase()));
      if (missing) return false;
    }
    const pnl = Number(trade.realizedPnlGBP);
    if (winLoss === 'win' && !(pnl > 0)) return false;
    if (winLoss === 'loss' && !(pnl < 0)) return false;
    return true;
  });
}

function findTradeById(user, id) {
  const journal = ensureTradeJournal(user);
  for (const [dateKey, trades] of Object.entries(journal)) {
    for (let index = 0; index < (trades || []).length; index += 1) {
      const trade = trades[index];
      if (trade && trade.id === id) {
        return { trade, dateKey, index };
      }
    }
  }
  return null;
}

function updateHistoryForClose(user, history, closeDateKey, pnlGBP) {
  const ym = closeDateKey.slice(0, 7);
  history[ym] ||= {};
  const existing = history[ym][closeDateKey] || {};
  const endRaw = Number(existing.end);
  const cashIn = Number.isFinite(existing.cashIn) ? existing.cashIn : 0;
  const cashOut = Number.isFinite(existing.cashOut) ? existing.cashOut : 0;
  const note = typeof existing.note === 'string' ? existing.note.trim() : '';
  const preBaseline = existing.preBaseline === true;
  const baseEnd = Number.isFinite(endRaw) ? endRaw : (Number.isFinite(user.portfolio) ? user.portfolio : 0);
  const end = baseEnd + pnlGBP;
  const payload = preBaseline
    ? { end, cashIn, cashOut, preBaseline: true }
    : { end, cashIn, cashOut };
  if (note) payload.note = note;
  history[ym][closeDateKey] = payload;
}

function revertHistoryForClose(user, history, closeDateKey, pnlGBP) {
  if (!Number.isFinite(pnlGBP) || pnlGBP === 0) return;
  updateHistoryForClose(user, history, closeDateKey, -pnlGBP);
  refreshAnchors(user, history);
}

function normalizePartialCloses(partialCloses, cleanDate) {
  if (!Array.isArray(partialCloses)) return [];
  const normalized = [];
  for (const close of partialCloses) {
    if (!close || typeof close !== 'object') continue;
    const units = Number(close.units);
    const price = Number(close.price);
    if (!Number.isFinite(units) || units <= 0 || !Number.isFinite(price) || price <= 0) continue;
    const payload = { units, price };
    if (typeof close.id === 'string' && close.id) {
      payload.id = close.id;
    }
    if (typeof close.date === 'string' && cleanDate.test(close.date)) {
      payload.date = close.date;
    }
    if (typeof close.createdAt === 'string' && close.createdAt) {
      payload.createdAt = close.createdAt;
    }
    normalized.push(payload);
  }
  return normalized;
}

function computePartialClosePnlCurrency(trade, units, price) {
  const direction = trade.direction === 'short' ? 'short' : 'long';
  const slippage = Number(trade.slippage) || 0;
  const effectiveClose = direction === 'long'
    ? price - slippage
    : price + slippage;
  return direction === 'long'
    ? (effectiveClose - Number(trade.entry)) * units
    : (Number(trade.entry) - effectiveClose) * units;
}

function addTradeTrim(user, trade, units, price, closeDate, rates, defaultDate) {
  const history = ensurePortfolioHistory(user);
  const targetDate = (typeof closeDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(closeDate))
    ? closeDate
    : (defaultDate || currentDateKey());
  const isProviderTrade = trade.source === 'trading212' || trade.trading212Id || trade.source === 'ibkr' || trade.ibkrPositionId;
  const pnlCurrency = computePartialClosePnlCurrency(trade, units, price);
  const pnlGBP = convertToGBP(pnlCurrency, trade.currency || 'GBP', rates);
  const pnlSafe = Number.isFinite(pnlGBP) ? pnlGBP : pnlCurrency;
  trade.partialCloses ||= [];
  trade.partialCloses.push({
    id: crypto.randomBytes(8).toString('hex'),
    units,
    price,
    date: targetDate,
    createdAt: new Date().toISOString()
  });
  trade.sizeUnits = Number(trade.sizeUnits) - units;
  if (!isProviderTrade) {
    updateHistoryForClose(user, history, targetDate, pnlSafe);
    refreshAnchors(user, history);
  }
  return { pnlGBP: pnlSafe, closeDateKey: targetDate };
}

function applyTradeClose(user, trade, closePrice, closeDate, rates, defaultDate) {
  const history = ensurePortfolioHistory(user);
  const targetDate = (typeof closeDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(closeDate))
    ? closeDate
    : (defaultDate || currentDateKey());
  const isProviderTrade = trade.source === 'trading212' || trade.trading212Id || trade.source === 'ibkr' || trade.ibkrPositionId;
  const pnlCurrency = computePartialClosePnlCurrency(trade, Number(trade.sizeUnits), closePrice);
  const feesCurrency = Number(trade.fees) || 0;
  const netPnlCurrency = pnlCurrency - feesCurrency;
  const pnlGBP = convertToGBP(netPnlCurrency, trade.currency || 'GBP', rates);
  const pnlSafe = Number.isFinite(pnlGBP) ? pnlGBP : netPnlCurrency;
  trade.status = 'closed';
  trade.closePrice = closePrice;
  trade.closeDate = targetDate;
  trade.closedAt = trade.closedAt || new Date().toISOString();
  trade.realizedPnlGBP = pnlSafe;
  trade.realizedPnlCurrency = netPnlCurrency;
  const risk = Number(trade.riskAmountGBP);
  trade.rMultiple = Number.isFinite(risk) && risk !== 0 ? pnlSafe / risk : null;
  if (!isProviderTrade) {
    updateHistoryForClose(user, history, targetDate, pnlSafe);
    refreshAnchors(user, history);
  }
  return { pnlGBP: pnlSafe, closeDateKey: targetDate };
}

function buildSnapshots(history, initial, tradeJournal = {}) {
  const snapshots = {};
  const records = [];
  for (const [monthKey, days] of Object.entries(history || {})) {
    for (const [dateKey, record] of Object.entries(days || {})) {
      if (!record || typeof record !== 'object') continue;
      const endRaw = Number(record.end);
      const hasEnd = Number.isFinite(endRaw) && endRaw >= 0;
      const cashInRaw = Number(record.cashIn ?? 0);
      const cashOutRaw = Number(record.cashOut ?? 0);
      const cashIn = Number.isFinite(cashInRaw) && cashInRaw >= 0 ? cashInRaw : 0;
      const cashOut = Number.isFinite(cashOutRaw) && cashOutRaw >= 0 ? cashOutRaw : 0;
      const noteRaw = typeof record.note === 'string' ? record.note : '';
      const note = noteRaw.trim();
      if (!hasEnd && cashIn === 0 && cashOut === 0 && !note) continue;
      records.push({
        date: dateKey,
        monthKey,
        end: hasEnd ? endRaw : null,
        cashIn,
        cashOut,
        preBaseline: record.preBaseline === true,
        note
      });
    }
  }
  records.sort((a, b) => a.date.localeCompare(b.date));
  let baseline = Number.isFinite(initial) ? initial : null;
  records.forEach(record => {
    if (!snapshots[record.monthKey]) snapshots[record.monthKey] = {};
    const payload = {};
    if (record.end !== null) {
      const start = baseline !== null ? baseline : record.end;
      payload.start = start;
      payload.end = record.end;
      payload.cashIn = record.cashIn;
      payload.cashOut = record.cashOut;
      baseline = record.end;
    } else {
      if (record.cashIn || record.cashOut) {
        payload.cashIn = record.cashIn;
        payload.cashOut = record.cashOut;
      }
      if (baseline !== null) {
        baseline += record.cashIn - record.cashOut;
      }
    }
    if (record.preBaseline) {
      payload.preBaseline = true;
    }
    if (record.note) {
      payload.note = record.note;
    }
    snapshots[record.monthKey][record.date] = payload;
  });
  for (const [dateKey, trades] of Object.entries(tradeJournal)) {
    const monthKey = dateKey.slice(0, 7);
    if (!snapshots[monthKey]) snapshots[monthKey] = {};
    if (!snapshots[monthKey][dateKey]) {
      snapshots[monthKey][dateKey] = {};
    }
    snapshots[monthKey][dateKey].trades = trades;
  }
  return snapshots;
}

function refreshAnchors(user, history = ensurePortfolioHistory(user)) {
  const entries = listChronologicalEntries(history);
  let mutated = false;
  if (entries.length) {
    const baseline = entries[0].end;
    const latest = entries[entries.length - 1].end;
    if (user.initialPortfolio !== baseline) {
      user.initialPortfolio = baseline;
      mutated = true;
    }
    const allowPortfolioUpdate = !user.portfolioSource || user.portfolioSource === 'manual';
    if (allowPortfolioUpdate && user.portfolio !== latest) {
      user.portfolio = latest;
      mutated = true;
    }
    return { baseline, mutated };
  }
  const fallback = Number.isFinite(user.initialPortfolio)
    ? user.initialPortfolio
    : (Number.isFinite(user.portfolio) ? user.portfolio : 0);
  const normalized = Number.isFinite(fallback) ? fallback : 0;
  if (user.initialPortfolio !== normalized) {
    user.initialPortfolio = normalized;
    mutated = true;
  }
  const allowPortfolioUpdate = !user.portfolioSource || user.portfolioSource === 'manual';
  if (allowPortfolioUpdate && user.portfolio !== normalized) {
    user.portfolio = normalized;
    mutated = true;
  }
  return { baseline: normalized, mutated };
}

function computeNetDepositsTotals(user, history = ensurePortfolioHistory(user)) {
  const baseline = Number.isFinite(Number(user?.initialNetDeposits))
    ? Number(user.initialNetDeposits)
    : 0;
  let total = baseline;
  for (const days of Object.values(history || {})) {
    for (const record of Object.values(days || {})) {
      if (!record || typeof record !== 'object') continue;
      if (record.preBaseline === true) continue;
      const cashIn = Number(record.cashIn ?? 0);
      const cashOut = Number(record.cashOut ?? 0);
      total += (Number.isFinite(cashIn) ? cashIn : 0) - (Number.isFinite(cashOut) ? cashOut : 0);
    }
  }
  return { baseline, total };
}

function dateKeyInTimezone(timezone, date = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch (e) {
    console.warn('Unable to derive timezone-specific date', e);
  }
  return currentDateKey();
}

function parseSnapshotTime(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return { hour: match[1], minute: match[2] };
}

function parseTradingNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object') {
    if (typeof value.value === 'number' || typeof value.value === 'string') {
      return parseTradingNumber(value.value);
    }
    if (typeof value.amount === 'number' || typeof value.amount === 'string') {
      return parseTradingNumber(value.amount);
    }
  }
  return null;
}

function normalizeIbkrTicker(raw) {
  return String(raw || '').trim().toUpperCase();
}

function hmacHex(secret, value) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

function hashConnectorToken(rawToken) {
  return hmacHex(IBKR_TOKEN_SECRET_FALLBACK, rawToken);
}

function hashConnectorKey(rawKey) {
  return hmacHex(IBKR_TOKEN_SECRET_FALLBACK, rawKey);
}

function hashConnectorCredential(value) {
  return hmacHex(IBKR_TOKEN_SECRET_FALLBACK, value);
}

function getIbkrTokenSecretHash() {
  if (!IBKR_TOKEN_SECRET) return null;
  return crypto.createHash('sha256').update(IBKR_TOKEN_SECRET, 'utf8').digest('hex');
}

function reconcileIbkrTokenSecret(db) {
  if (!db) return false;
  const secretHash = getIbkrTokenSecretHash();
  if (!secretHash) return false;
  let mutated = false;
  const now = new Date().toISOString();
  if (db.ibkrTokenSecretHash && db.ibkrTokenSecretHash !== secretHash) {
    console.warn('[IBKR] Token secret changed; revoking existing connector keys/tokens.');
    ensureIbkrConnectorTokens(db).forEach(entry => {
      if (entry && !entry.usedAt) {
        entry.usedAt = now;
      }
    });
    ensureIbkrConnectorKeys(db).forEach(entry => {
      if (entry && !entry.revokedAt) {
        entry.revokedAt = now;
      }
    });
    mutated = true;
  }
  if (db.ibkrTokenSecretHash !== secretHash) {
    db.ibkrTokenSecretHash = secretHash;
    mutated = true;
  }
  return mutated;
}

function parseBearerToken(authHeader) {
  const raw = String(authHeader || '').trim();
  if (!raw) return '';
  return raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw;
}

function logIbkrConnectorAuthFailure(endpoint, reason) {
  console.warn(`[IBKR] ${endpoint} auth failed: ${reason}`);
}

function ensureIbkrConnectorTokens(db) {
  if (!Array.isArray(db.ibkrConnectorTokens)) {
    db.ibkrConnectorTokens = [];
  }
  return db.ibkrConnectorTokens;
}

function getActiveIbkrConnectorToken(db, username) {
  const tokens = ensureIbkrConnectorTokens(db);
  const now = Date.now();
  return tokens.find(token => token.username === username && !token.usedAt && Date.parse(token.expiresAt) > now);
}

async function createIbkrConnectorToken(db, username) {
  const tokens = ensureIbkrConnectorTokens(db);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + IBKR_CONNECTOR_TOKEN_TTL_MS).toISOString();
  for (const token of tokens) {
    if (token.username === username && !token.usedAt) {
      token.usedAt = now;
    }
  }
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashConnectorToken(rawToken);
  tokens.push({
    tokenHash,
    username,
    createdAt: now,
    expiresAt,
    usedAt: null
  });
  return { rawToken, expiresAt };
}

async function verifyIbkrConnectorToken(db, token) {
  const tokens = ensureIbkrConnectorTokens(db);
  const tokenHash = hashConnectorToken(token);
  const entry = tokens.find(item => item.tokenHash === tokenHash);
  if (!entry) return null;
  if (entry.expiresAt && Date.parse(entry.expiresAt) <= Date.now()) return null;
  if (entry.usedAt) return null;
  return entry;
}

function ensureIbkrConnectorKeys(db) {
  if (!Array.isArray(db.ibkrConnectorKeys)) {
    db.ibkrConnectorKeys = [];
  }
  return db.ibkrConnectorKeys;
}

function getActiveIbkrConnectorKey(db, username) {
  const keys = ensureIbkrConnectorKeys(db);
  return keys.find(entry => entry && entry.username === username && !entry.revokedAt);
}

async function createIbkrConnectorKey(db, username) {
  const keys = ensureIbkrConnectorKeys(db);
  const now = new Date().toISOString();
  for (const entry of keys) {
    if (entry.username === username && !entry.revokedAt) {
      entry.revokedAt = now;
    }
  }
  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyHash = hashConnectorKey(rawKey);
  keys.push({
    keyHash,
    username,
    createdAt: now,
    revokedAt: null,
    lastUsedAt: null
  });
  return rawKey;
}

async function findIbkrConnectorKeyOwner(db, connectorKey) {
  const keys = ensureIbkrConnectorKeys(db);
  const keyHash = hashConnectorKey(connectorKey);
  const keyRecord = keys.find(entry => entry && !entry.revokedAt && entry.keyHash === keyHash);
  if (!keyRecord) return null;
  const username = keyRecord.username;
  const user = db.users?.[username];
  if (!user) return null;
  return { username, user, keyRecord };
}

async function exchangeIbkrConnectorToken(db, token) {
  const tokenRecord = await verifyIbkrConnectorToken(db, token);
  if (!tokenRecord) return null;
  const user = db.users?.[tokenRecord.username];
  if (!user) return null;
  ensureUserShape(user, tokenRecord.username);
  const connectorKey = await createIbkrConnectorKey(db, tokenRecord.username);
  if (!connectorKey) return null;
  tokenRecord.usedAt = new Date().toISOString();
  return { connectorKey, tokenRecord, user };
}

function getIbkrTokenKey() {
  if (!IBKR_TOKEN_SECRET) return null;
  return crypto.createHash('sha256').update(IBKR_TOKEN_SECRET, 'utf8').digest();
}

function encryptIbkrTokens(payload) {
  const key = getIbkrTokenKey();
  if (!key) {
    throw new IbkrError('IBKR token secret is not configured.', { code: 'missing_secret' });
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptIbkrTokens(serialized) {
  if (!serialized) return null;
  const key = getIbkrTokenKey();
  if (!key) {
    throw new IbkrError('IBKR token secret is not configured.', { code: 'missing_secret' });
  }
  const raw = Buffer.from(serialized, 'base64');
  if (raw.length < 28) {
    throw new IbkrParseError('IBKR token payload is malformed.', { code: 'invalid_payload' });
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

function normalizeTrading212Symbol(raw) {
  const base = String(raw || '').trim().toUpperCase();
  if (!base) return '';
  const core = base.split('_')[0] || base;
  if (core === 'FB') return 'META';
  const cleaned = core.replace(/\d+/g, '');
  return cleaned || '';
}

function normalizeTrading212TickerValue(raw) {
  return String(raw || '').trim().toUpperCase();
}

function normalizeTrading212Name(raw) {
  if (!raw) return '';
  return String(raw).trim().replace(/\s+/g, ' ').toUpperCase();
}

function resolveTrading212BaseUrl(config) {
  const base = String(config?.baseUrl || process.env.T212_BASE_URL || '').trim();
  if (base) return base.replace(/\/+$/, '');
  return config?.mode === 'practice'
    ? 'https://demo.trading212.com'
    : 'https://live.trading212.com';
}

function buildTrading212AuthHeaders(config) {
  const apiKey = String(config?.apiKey || '').trim();
  const apiSecret = String(config?.apiSecret || '').trim();
  if (!apiKey || !apiSecret) {
    throw new Trading212AuthError('Trading 212 credentials are incomplete.', { status: 401 });
  }
  const encodedCredentials = Buffer.from(`${apiKey}:${apiSecret}`, 'utf8').toString('base64');
  return {
    'Accept': 'application/json',
    'User-Agent': 'VeracitySuite/1.0',
    Authorization: `Basic ${encodedCredentials}`
  };
}

const trading212OrdersCache = new Map();
const TRADING212_ORDERS_CACHE_MS = 20000;

function normalizeTrading212OrderStatus(raw) {
  return String(raw || '').trim().toUpperCase();
}

function extractTrading212Orders(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.orders)) return payload.orders;
  if (Array.isArray(payload?.data)) return payload.data;
  return null;
}

function parseTrading212Orders(payload) {
  const orders = extractTrading212Orders(payload);
  if (!Array.isArray(orders)) return [];
  return orders.map(raw => {
    const instrument = raw?.instrument || {};
    const ticker = normalizeTrading212TickerValue(
      instrument?.ticker ?? raw?.ticker ?? raw?.symbol ?? ''
    );
    const isin = String(instrument?.isin ?? raw?.isin ?? '').trim();
    const uid = String(instrument?.id ?? instrument?.uid ?? raw?.instrumentId ?? raw?.instrumentUid ?? '').trim();
    const type = normalizeTrading212OrderStatus(raw?.type ?? raw?.orderType ?? raw?.orderTypeName ?? '');
    const status = normalizeTrading212OrderStatus(raw?.status ?? raw?.state ?? raw?.orderStatus ?? '');
    const side = normalizeTrading212OrderStatus(raw?.side ?? raw?.direction ?? '');
    const quantity = parseTradingNumber(raw?.quantity ?? raw?.qty ?? raw?.units ?? raw?.size ?? raw?.shares);
    const stopPrice = parseTradingNumber(
      raw?.stopPrice ??
      raw?.stop ??
      raw?.stop?.price ??
      raw?.stop?.value
    );
    const limitPrice = parseTradingNumber(
      raw?.limitPrice ??
      raw?.limit ??
      raw?.limit?.price ??
      raw?.limit?.value
    );
    const createdAt = raw?.createdAt ?? raw?.createdAtUtc ?? raw?.dateCreated ?? raw?.created ?? null;
    const id = raw?.id ?? raw?.orderId ?? raw?.uid ?? null;
    return {
      id: id ? String(id) : '',
      instrumentTicker: ticker,
      instrumentIsin: isin || '',
      instrumentUid: uid || '',
      type,
      status,
      side,
      quantity,
      stopPrice,
      limitPrice,
      createdAt
    };
  }).filter(order => {
    if (!order.stopPrice || !Number.isFinite(order.stopPrice)) return false;
    const type = order.type;
    if (!['STOP', 'STOP_LIMIT'].includes(type)) return false;
    const status = order.status;
    const isOpen = ['OPEN', 'PENDING', 'ACTIVE', 'WORKING', 'PLACED', 'TRIGGERED', 'NEW'].includes(status);
    if (!isOpen) return false;
    const isSell = order.side === 'SELL' || (Number.isFinite(order.quantity) && order.quantity < 0);
    return isSell;
  });
}

const ibkrCache = new Map();
const ibkrPositionSchema = z.object({});
const ibkrOrderSchema = z.object({
  id: z.string().optional(),
  ticker: z.string().optional(),
  conid: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  side: z.string().optional(),
  quantity: z.number().optional(),
  stopPrice: z.number().optional(),
  createdAt: z.string().optional()
});
const ibkrSnapshotSchema = z.object({
  accountId: z.string().optional(),
  portfolioValue: z.number(),
  rootCurrency: z.string().min(1),
  positions: z.array(ibkrPositionSchema),
  orders: z.array(ibkrOrderSchema).optional(),
  raw: z.object({}).optional(),
  meta: z.object({
    gatewayUrl: z.string().optional(),
    connectorVersion: z.string().optional(),
    ts: z.string().optional(),
    rootCurrencySource: z.string().optional(),
    currencyConfidence: z.enum(['high', 'medium', 'low']).optional(),
    currencyReason: z.string().optional()
  }).optional()
});
const ibkrHeartbeatSchema = z.object({
  status: z.enum(['online', 'disconnected', 'error']).optional(),
  reason: z.string().optional(),
  authStatus: z.object({
    authenticated: z.boolean().optional(),
    connected: z.boolean().optional()
  }).optional(),
  connectorVersion: z.string().optional(),
  gatewayUrl: z.string().optional()
});

function getIbkrCacheEntry(key) {
  const cached = ibkrCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > IBKR_CACHE_TTL_MS) {
    ibkrCache.delete(key);
    return null;
  }
  return cached;
}

function setIbkrCacheEntry(key, payload) {
  ibkrCache.set(key, { fetchedAt: Date.now(), payload });
}

function ensureBrokerSnapshots(db) {
  if (!Array.isArray(db.brokerSnapshots)) {
    db.brokerSnapshots = [];
  }
  return db.brokerSnapshots;
}

function recordBrokerSnapshot(db, username, provider, snapshot) {
  const list = ensureBrokerSnapshots(db);
  list.push({
    id: crypto.randomBytes(8).toString('hex'),
    userId: username,
    provider,
    timestamp: new Date().toISOString(),
    portfolioValue: snapshot.portfolioValue,
    rootCurrency: snapshot.rootCurrency,
    positions: snapshot.positions,
    orders: snapshot.orders || [],
    derivedStopByTicker: snapshot.derivedStopByTicker || {}
  });
  if (list.length > 5000) {
    list.splice(0, list.length - 5000);
  }
}

function recordIbkrUserSnapshot(user, snapshot) {
  if (!user) return;
  if (!Array.isArray(user.ibkrSnapshots)) {
    user.ibkrSnapshots = [];
  }
  user.ibkrSnapshots.push({
    ...snapshot,
    receivedAt: new Date().toISOString()
  });
  if (user.ibkrSnapshots.length > 250) {
    user.ibkrSnapshots.splice(0, user.ibkrSnapshots.length - 250);
  }
}

function updateIbkrLivePositions(user, snapshot, derivedStopByTicker = {}) {
  if (!user?.ibkr) return;
  const cfg = user.ibkr;
  const next = [];
  const now = new Date().toISOString();
  const normalized = normalizeIbkrPositions(snapshot.positions || []);
  for (const position of normalized) {
    const symbol = normalizeIbkrTicker(position.ticker);
    if (!symbol) continue;
    const units = Number(position.units);
    if (!Number.isFinite(units) || units === 0) continue;
    const conid = position.conid ? String(position.conid) : '';
    const key = conid || symbol;
    const derived = derivedStopByTicker[symbol] || null;
    next.push({
      id: key,
      symbol,
      conid,
      quantity: units,
      avgPrice: Number(position.buyPrice),
      marketPrice: Number.isFinite(position.livePrice) ? Number(position.livePrice) : null,
      marketValue: Number.isFinite(position.marketValue) ? Number(position.marketValue) : null,
      unrealizedPnl: Number.isFinite(position.pnlValue) ? Number(position.pnlValue) : null,
      currency: position.currency || 'USD',
      derivedStopPrice: derived ? Number(derived.stopPrice) : null,
      updatedAt: now
    });
  }
  cfg.livePositions = next;
  if (cfg.live && typeof cfg.live === 'object') {
    cfg.live.positions = next;
    cfg.live.updatedAt = new Date().toISOString();
  }
}

function updateIbkrLiveOrders(user, orders = []) {
  if (!user?.ibkr) return;
  const cfg = user.ibkr;
  const normalized = normalizeIbkrSnapshotOrders(orders);
  cfg.liveOrders = normalized;
  if (cfg.live && typeof cfg.live === 'object') {
    cfg.live.orders = normalized;
    cfg.live.updatedAt = new Date().toISOString();
  }
}

function applyIbkrDerivedStopsToLivePositions(user, derivedStops = {}) {
  const cfg = user?.ibkr;
  if (!cfg?.livePositions || !Array.isArray(cfg.livePositions)) return { updated: 0 };
  let updated = 0;
  cfg.livePositions.forEach(position => {
    const derived = derivedStops[normalizeIbkrTicker(position.symbol)] || null;
    const nextStop = derived ? Number(derived.stopPrice) : null;
    if (position.derivedStopPrice !== nextStop) {
      position.derivedStopPrice = nextStop;
      updated += 1;
    }
  });
  return { updated };
}

function getLatestBrokerSnapshot(db, username, provider) {
  const list = ensureBrokerSnapshots(db);
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const entry = list[index];
    if (entry?.userId === username && entry?.provider === provider) {
      return entry;
    }
  }
  return null;
}

function extractIbkrAccounts(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.accounts)) return payload.accounts;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function pickIbkrAccountId(accounts, preferred) {
  if (!Array.isArray(accounts)) return '';
  if (preferred && accounts.some(account => String(account?.accountId || account?.id || account).trim() === preferred)) {
    return preferred;
  }
  const primary = accounts.find(account => account?.accountId || account?.id || account);
  return primary ? String(primary.accountId || primary.id || primary).trim() : '';
}

function extractIbkrSummaryValue(summary, tags = []) {
  if (!summary) return null;
  const tagList = tags.map(tag => String(tag).toUpperCase());
  if (Array.isArray(summary)) {
    const found = summary.find(item => tagList.includes(String(item?.tag || item?.key || '').toUpperCase()));
    if (!found) return null;
    return parseTradingNumber(found?.value ?? found?.amount ?? found?.val);
  }
  if (typeof summary === 'object') {
    for (const tag of tagList) {
      if (summary[tag] !== undefined) {
        return parseTradingNumber(summary[tag]);
      }
      const fallback = Object.entries(summary).find(([key]) => key.toUpperCase() === tag);
      if (fallback) {
        return parseTradingNumber(fallback[1]);
      }
    }
    if (summary?.data && Array.isArray(summary.data)) {
      return extractIbkrSummaryValue(summary.data, tags);
    }
  }
  return null;
}

function extractIbkrSummaryAmount(summary, key) {
  if (!summary) return null;
  if (Array.isArray(summary)) {
    return extractIbkrSummaryValue(summary, [key]);
  }
  if (summary?.data && Array.isArray(summary.data)) {
    return extractIbkrSummaryValue(summary.data, [key]);
  }
  const entry = summary?.[key];
  if (!entry) return null;
  if (typeof entry.amount === 'number') return entry.amount;
  if (typeof entry.value === 'number') return entry.value;
  if (typeof entry.value === 'string') {
    const parsed = Number(entry.value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractIbkrSummaryCurrency(summary, key) {
  if (Array.isArray(summary)) {
    const found = summary.find(item => String(item?.tag || item?.key || '').toLowerCase() === key.toLowerCase());
    return found?.currency && typeof found.currency === 'string' ? found.currency : null;
  }
  if (summary?.data && Array.isArray(summary.data)) {
    const found = summary.data.find(item => String(item?.tag || item?.key || '').toLowerCase() === key.toLowerCase());
    return found?.currency && typeof found.currency === 'string' ? found.currency : null;
  }
  const entry = summary?.[key];
  if (entry && typeof entry.currency === 'string' && entry.currency) {
    return entry.currency;
  }
  return null;
}

function extractIbkrValueEntry(payload, key) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload[key] !== undefined) return payload[key];
  const entry = Object.entries(payload).find(([entryKey]) => entryKey.toLowerCase() === key.toLowerCase());
  return entry ? entry[1] : null;
}

function extractIbkrNetDeposits(summary, ledger) {
  const summaryEntry = extractIbkrValueEntry(summary, 'netdeposits');
  const ledgerEntry = extractIbkrValueEntry(ledger, 'netdeposits');
  const entry = summaryEntry ?? ledgerEntry;
  if (entry === null || entry === undefined) return null;
  const value = parseTradingNumber(entry?.amount ?? entry?.value ?? entry);
  if (!Number.isFinite(value)) return null;
  const currency = entry?.currency && typeof entry.currency === 'string'
    ? entry.currency
    : (summary?.baseCurrency || summary?.currency || ledger?.baseCurrency || ledger?.currency || null);
  return {
    value,
    currency: currency || null
  };
}

function extractIbkrPortfolioValue(summary) {
  const value = extractIbkrSummaryAmount(summary, 'netliquidation')
    ?? extractIbkrSummaryAmount(summary, 'equitywithloanvalue')
    ?? extractIbkrSummaryAmount(summary, 'totalcashvalue');
  if (!Number.isFinite(value)) return null;
  return value;
}

function mapIbkrPosition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ticker = normalizeIbkrTicker(
    raw?.ticker
    ?? raw?.symbol
    ?? raw?.contract?.symbol
    ?? raw?.contractDesc
    ?? raw?.description
    ?? raw?.name
    ?? ''
  );
  const units = parseTradingNumber(raw?.position ?? raw?.quantity ?? raw?.qty ?? raw?.units ?? raw?.size);
  const buyPrice = parseTradingNumber(
    raw?.avgPrice ?? raw?.avgCost ?? raw?.avgFillPrice ?? raw?.averagePrice ?? raw?.buyPrice
  );
  const pnlValue = parseTradingNumber(
    raw?.unrealizedPnl ?? raw?.unrealizedPnL ?? raw?.pnl ?? raw?.pnlUnrealized ?? raw?.pnlValue
  );
  const livePrice = parseTradingNumber(
    raw?.mktPrice ?? raw?.marketPrice ?? raw?.lastPrice ?? raw?.price ?? raw?.livePrice
  );
  const marketValue = parseTradingNumber(raw?.marketValue ?? raw?.mktValue ?? raw?.value);
  const currency = String(raw?.currency || raw?.asset?.currency || raw?.fxCurrency || '').trim() || 'USD';
  const conid = raw?.conid ?? raw?.conidex ?? raw?.contract?.conid ?? raw?.contract?.conidex ?? null;
  if (!ticker || !Number.isFinite(units) || !Number.isFinite(buyPrice)) return null;
  return {
    ticker,
    units,
    buyPrice,
    pnlValue: Number.isFinite(pnlValue) ? pnlValue : null,
    currency,
    livePrice: Number.isFinite(livePrice) ? livePrice : null,
    conid: conid ? String(conid) : '',
    marketValue: Number.isFinite(marketValue) ? marketValue : null
  };
}

function normalizeIbkrPositions(positions = []) {
  if (!Array.isArray(positions)) return [];
  return positions.map(mapIbkrPosition).filter(Boolean);
}

function normalizeIbkrPayloadArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.positions)) return payload.positions;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function buildIbkrActivePositionSummaries(positions = []) {
  const normalized = normalizeIbkrPositions(positions);
  return normalized.filter(position => Number.isFinite(position.units) && position.units !== 0).map(position => {
    const costBasis = Math.abs(position.units) * Number(position.buyPrice);
    const unrealizedPnl = Number.isFinite(position.pnlValue) ? position.pnlValue : null;
    const unrealizedPct = Number.isFinite(unrealizedPnl) && costBasis > 0
      ? (unrealizedPnl / costBasis) * 100
      : 0;
    const marketPrice = Number.isFinite(position.livePrice) ? position.livePrice : null;
    const marketValue = Number.isFinite(position.marketValue)
      ? position.marketValue
      : (Number.isFinite(marketPrice) ? position.units * marketPrice : null);
    return {
      symbol: position.ticker,
      position: position.units,
      avgCost: position.buyPrice,
      marketPrice,
      marketValue,
      unrealizedPnl,
      unrealizedPct,
      currency: position.currency,
      conid: position.conid
    };
  });
}

function extractIbkrOrders(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.orders)) {
    return payload.orders.flatMap(entry => {
      if (Array.isArray(entry?.orders)) return entry.orders;
      return entry;
    }).filter(Boolean);
  }
  if (Array.isArray(payload?.order)) return payload.order;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function normalizeIbkrOrderStatus(raw) {
  return String(raw || '').trim().toUpperCase();
}

function normalizeIbkrOrderType(raw) {
  return String(raw || '').trim().toUpperCase();
}

function parseIbkrOrders(payload) {
  const orders = extractIbkrOrders(payload);
  if (!Array.isArray(orders)) return [];
  return orders.map(raw => {
    const ticker = normalizeIbkrTicker(raw?.ticker ?? raw?.symbol ?? raw?.contract?.symbol ?? raw?.contractDesc ?? '');
    const conid = raw?.conid ?? raw?.conidex ?? raw?.contract?.conid ?? raw?.contract?.conidex ?? '';
    const type = normalizeIbkrOrderType(raw?.orderType ?? raw?.orderTypeDesc ?? raw?.orderTypeId ?? raw?.type);
    const status = normalizeIbkrOrderStatus(raw?.status ?? raw?.orderStatus ?? raw?.state);
    const side = normalizeIbkrOrderStatus(raw?.side ?? raw?.action ?? raw?.direction);
    const quantity = parseTradingNumber(raw?.totalQuantity ?? raw?.qty ?? raw?.quantity ?? raw?.size ?? raw?.orderSize);
    const stopPrice = parseTradingNumber(raw?.auxPrice ?? raw?.stopPrice ?? raw?.stop ?? raw?.stopPriceLimit);
    const createdAt = raw?.orderTime ?? raw?.createdTime ?? raw?.time ?? raw?.submittedTime ?? null;
    const id = raw?.orderId ?? raw?.id ?? raw?.order_id ?? null;
    return {
      id: id ? String(id) : '',
      instrumentTicker: ticker,
      conid: conid ? String(conid) : '',
      type,
      status,
      side,
      quantity,
      stopPrice,
      createdAt
    };
  }).filter(order => {
    if (!order.stopPrice || !Number.isFinite(order.stopPrice)) return false;
    const type = order.type;
    const isStop = type.includes('STOP') || type.includes('STP');
    if (!isStop) return false;
    const status = order.status;
    const isOpen = ['PRESUBMITTED', 'SUBMITTED', 'OPEN', 'PENDING', 'ACTIVE', 'WORKING', 'APISUBMITTED'].includes(status);
    if (!isOpen) return false;
    const isSell = order.side === 'SELL' || (Number.isFinite(order.quantity) && order.quantity < 0);
    return isSell;
  });
}

function normalizeIbkrSnapshotOrders(orders = []) {
  if (!Array.isArray(orders)) return [];
  return orders.map(order => ({
    id: order.id ? String(order.id) : '',
    ticker: normalizeIbkrTicker(order.ticker || order.instrumentTicker || ''),
    conid: order.conid ? String(order.conid) : '',
    type: normalizeIbkrOrderType(order.type || order.orderType || ''),
    status: normalizeIbkrOrderStatus(order.status || ''),
    side: normalizeIbkrOrderStatus(order.side || ''),
    quantity: Number.isFinite(order.quantity) ? Number(order.quantity) : undefined,
    stopPrice: Number.isFinite(order.stopPrice) ? Number(order.stopPrice) : undefined,
    createdAt: order.createdAt || ''
  })).filter(order => order.stopPrice !== undefined);
}

function computeIbkrDerivedStops(positions = [], orders = []) {
  const normalizedOrders = normalizeIbkrSnapshotOrders(orders);
  const activeStops = normalizedOrders.filter(order => {
    if (!Number.isFinite(order.stopPrice)) return false;
    const type = order.type || '';
    const isStop = type.includes('STOP') || type.includes('STP');
    if (!isStop) return false;
    const status = order.status || '';
    const isOpen = ['PRESUBMITTED', 'SUBMITTED', 'OPEN', 'PENDING', 'ACTIVE', 'WORKING', 'APISUBMITTED'].includes(status);
    return isOpen;
  });
  const derived = {};
  const normalizedPositions = normalizeIbkrPositions(positions);
  for (const position of normalizedPositions) {
    const ticker = normalizeIbkrTicker(position.ticker);
    const conid = position.conid ? String(position.conid) : '';
    const livePrice = Number.isFinite(position.livePrice) ? Number(position.livePrice) : null;
    const units = Number(position.units);
    const isShort = Number.isFinite(units) && units < 0;
    const candidates = activeStops.filter(order => {
      if (conid && order.conid && order.conid === conid) return true;
      return ticker && order.ticker && order.ticker === ticker;
    }).filter(order => {
      if (isShort) {
        return order.side === 'BUY';
      }
      return order.side === 'SELL';
    });
    if (!candidates.length) continue;
    let picked = candidates[0];
    for (const order of candidates) {
      const stop = Number(order.stopPrice);
      const pickedStop = Number(picked.stopPrice);
      if (isShort) {
        if (livePrice !== null) {
          const valid = stop > livePrice;
          const pickedValid = pickedStop > livePrice;
          if (valid && (!pickedValid || stop < pickedStop)) {
            picked = order;
          } else if (!pickedValid && valid) {
            picked = order;
          } else if (!valid && !pickedValid && stop < pickedStop) {
            picked = order;
          }
        } else if (stop < pickedStop) {
          picked = order;
        }
      } else {
        if (livePrice !== null) {
          const valid = stop < livePrice;
          const pickedValid = pickedStop < livePrice;
          if (valid && (!pickedValid || stop > pickedStop)) {
            picked = order;
          } else if (!pickedValid && valid) {
            picked = order;
          } else if (!valid && !pickedValid && stop > pickedStop) {
            picked = order;
          }
        } else if (stop > pickedStop) {
          picked = order;
        }
      }
    }
    if (picked && Number.isFinite(picked.stopPrice)) {
      derived[ticker || conid] = {
        stopPrice: Number(picked.stopPrice),
        orderId: picked.id || '',
        ticker,
        conid
      };
    }
  }
  return derived;
}

function applyIbkrDerivedStopsToTrades(user, derivedStops = {}) {
  const journal = ensureTradeJournal(user);
  let updated = 0;
  for (const items of Object.values(journal)) {
    for (const trade of items || []) {
      if (!trade || trade.status === 'closed') continue;
      if (trade.source !== 'ibkr' && !trade.ibkrPositionId) continue;
      const key = normalizeIbkrTicker(trade.ibkrTicker || trade.brokerTicker || trade.symbol || '');
      const conid = trade.ibkrConid ? String(trade.ibkrConid) : '';
      const derived = derivedStops[key] || (conid ? derivedStops[conid] : null);
      const shouldAutoSync = trade.currentStopSource !== 'manual';
      if (!derived || !Number.isFinite(derived.stopPrice)) {
        if (!shouldAutoSync) continue;
        delete trade.currentStop;
        trade.currentStopSource = 'ibkr';
        trade.currentStopLastSyncedAt = new Date().toISOString();
        trade.currentStopStale = true;
        trade.ibkrStopOrderId = '';
        updated += 1;
        continue;
      }
      const stopPrice = Number(derived.stopPrice);
      const shouldUpdate = shouldAutoSync
        && (!Number.isFinite(Number(trade.currentStop))
          || Number(trade.currentStop) !== stopPrice
          || trade.currentStopStale === true
          || trade.ibkrStopOrderId !== (derived.orderId || ''));
      if (!shouldUpdate) continue;
      trade.currentStop = stopPrice;
      trade.currentStopSource = 'ibkr';
      trade.currentStopLastSyncedAt = new Date().toISOString();
      trade.currentStopStale = false;
      trade.ibkrStopOrderId = derived.orderId || '';
      updated += 1;
    }
  }
  return { updated };
}

function upsertIbkrTradesFromSnapshot(user, snapshot, derivedStopByTicker = {}, rates = {}, snapshotDate = new Date()) {
  const journal = ensureTradeJournal(user);
  const timezone = 'Europe/London';
  const dateKey = dateKeyInTimezone(timezone, snapshotDate);
  journal[dateKey] ||= [];
  const openTrades = [];
  const lookup = new Map();
  for (const [tradeDate, items] of Object.entries(journal)) {
    for (const trade of items || []) {
      if (!trade || trade.status === 'closed' || Number.isFinite(Number(trade.closePrice))) continue;
      if (trade.source !== 'ibkr' && !trade.ibkrPositionId) continue;
      openTrades.push({ tradeDate, trade });
      const ticker = normalizeIbkrTicker(trade.ibkrTicker || trade.brokerTicker || trade.symbol || '');
      const conid = trade.ibkrConid ? String(trade.ibkrConid) : '';
      const positionId = trade.ibkrPositionId || conid || ticker;
      if (positionId) lookup.set(positionId, { tradeDate, trade });
      if (conid) lookup.set(`conid:${conid}`, { tradeDate, trade });
      if (ticker) lookup.set(`ticker:${ticker}`, { tradeDate, trade });
    }
  }
  let positionsMutated = false;
  const positions = normalizeIbkrPositions(snapshot.positions || []);
  if (positions.length) {
    for (const position of positions) {
      const ticker = normalizeIbkrTicker(position.ticker);
      if (!ticker) continue;
      const conid = position.conid ? String(position.conid) : '';
      const positionId = conid || ticker;
      const entryValue = Number(position.buyPrice);
      const units = Number(position.units);
      if (!Number.isFinite(units) || units === 0) continue;
      const sizeUnits = Math.abs(units);
      const direction = units < 0 ? 'short' : 'long';
      const tradeCurrency = position.currency || 'USD';
      const derived = derivedStopByTicker[ticker] || (conid ? derivedStopByTicker[conid] : null);
      const matched = lookup.get(positionId)
        || (conid ? lookup.get(`conid:${conid}`) : null)
        || (ticker ? lookup.get(`ticker:${ticker}`) : null);
      const resolvedTradeDate = matched?.tradeDate || dateKey;
      if (matched && matched.tradeDate !== dateKey) {
        const fromItems = journal[matched.tradeDate] || [];
        const index = fromItems.indexOf(matched.trade);
        if (index >= 0) {
          fromItems.splice(index, 1);
        }
        journal[dateKey].push(matched.trade);
      }
      if (matched?.trade) {
        const existingTrade = matched.trade;
        if (!existingTrade.symbol) {
          existingTrade.symbol = ticker;
        }
        existingTrade.entry = entryValue;
        existingTrade.sizeUnits = sizeUnits;
        existingTrade.currency = tradeCurrency;
        existingTrade.direction = direction;
        existingTrade.status = 'open';
        existingTrade.source = 'ibkr';
        existingTrade.ibkrPositionId = positionId;
        existingTrade.ibkrTicker = ticker;
        existingTrade.ibkrConid = conid || '';
        if (Number.isFinite(position.livePrice)) {
          existingTrade.lastSyncPrice = Number(position.livePrice);
        }
        if (Number.isFinite(position.pnlValue)) {
          existingTrade.ppl = Number(position.pnlValue);
        }
        positionsMutated = true;
        continue;
      }
      const nowIso = new Date().toISOString();
      const newTrade = normalizeTradeMeta({
        id: crypto.randomBytes(8).toString('hex'),
        symbol: ticker,
        currency: tradeCurrency,
        entry: entryValue,
        sizeUnits,
        lastSyncPrice: Number.isFinite(position.livePrice) ? Number(position.livePrice) : undefined,
        riskPct: 0,
        perUnitRisk: derived ? Math.abs(entryValue - Number(derived.stopPrice)) : 0,
        riskAmountCurrency: 0,
        positionCurrency: entryValue * sizeUnits,
        riskAmountGBP: 0,
        positionGBP: convertToGBP(entryValue * sizeUnits, tradeCurrency, rates),
        portfolioGBPAtCalc: Number.isFinite(user.portfolio) ? user.portfolio : 0,
        portfolioCurrencyAtCalc: convertGBPToCurrency(Number.isFinite(user.portfolio) ? user.portfolio : 0, tradeCurrency, rates),
        createdAt: nowIso,
        direction,
        status: 'open',
        tradeType: 'day',
        assetClass: 'stocks',
        source: 'ibkr',
        ibkrPositionId: positionId,
        ibkrTicker: ticker,
        ibkrConid: conid || '',
        ppl: Number.isFinite(position.pnlValue) ? Number(position.pnlValue) : undefined
      });
      if (derived && Number.isFinite(derived.stopPrice)) {
        newTrade.currentStop = Number(derived.stopPrice);
        newTrade.currentStopSource = 'ibkr';
        newTrade.currentStopLastSyncedAt = nowIso;
        newTrade.currentStopStale = false;
        newTrade.ibkrStopOrderId = derived.orderId || '';
      }
      journal[resolvedTradeDate] ||= [];
      journal[resolvedTradeDate].push(newTrade);
      positionsMutated = true;
    }
  } else if (Array.isArray(snapshot.positions)) {
    const closeDate = new Date(snapshotDate).toISOString();
    for (const entry of openTrades) {
      const trade = entry.trade;
      if (!trade || (!trade.ibkrPositionId && trade.source !== 'ibkr')) continue;
      trade.status = 'closed';
      trade.closeDate = trade.closeDate || dateKey;
      trade.closedAt = trade.closedAt || closeDate;
      if (!Number.isFinite(Number(trade.closePrice)) && Number.isFinite(Number(trade.lastSyncPrice))) {
        trade.closePrice = Number(trade.lastSyncPrice);
      }
      positionsMutated = true;
    }
  }
  return { mutated: positionsMutated, dateKey };
}

function inferTrading212AddedEntryPrice(previousEntry, previousUnits, nextEntry, nextUnits) {
  const prevEntry = Number(previousEntry);
  const prevUnits = Number(previousUnits);
  const incomingEntry = Number(nextEntry);
  const incomingUnits = Number(nextUnits);
  if (!Number.isFinite(prevEntry) || prevEntry <= 0) return null;
  if (!Number.isFinite(prevUnits) || prevUnits <= 0) return null;
  if (!Number.isFinite(incomingEntry) || incomingEntry <= 0) return null;
  if (!Number.isFinite(incomingUnits) || incomingUnits <= prevUnits) return null;
  const addedUnits = incomingUnits - prevUnits;
  if (!Number.isFinite(addedUnits) || addedUnits <= 0) return null;
  const inferredEntry = ((incomingEntry * incomingUnits) - (prevEntry * prevUnits)) / addedUnits;
  if (!Number.isFinite(inferredEntry) || inferredEntry <= 0) return null;
  return inferredEntry;
}

function isTrading212AddToPosition(existingTrade, incomingSizeUnits) {
  const existingUnits = Number(existingTrade?.sizeUnits);
  const nextUnits = Number(incomingSizeUnits);
  if (!Number.isFinite(existingUnits) || existingUnits <= 0) return false;
  if (!Number.isFinite(nextUnits)) return false;
  const EPSILON = 1e-8;
  return nextUnits > (existingUnits + EPSILON);
}

function findTrading212OpenTradeMatch(openTrades, {
  accountId,
  trading212Id,
  trading212IdBase,
  trading212Key,
  trading212PositionKey,
  symbol,
  rawIsin,
  normalizedName,
  rawTickerValue
}) {
  const exactTradeEntry = openTrades.find(entry => {
    if (entry.trade?.status === 'closed') return false;
    if (entry.trade?.trading212AccountId && accountId && entry.trade.trading212AccountId !== accountId) {
      return false;
    }
    return (
      entry.trade?.trading212Id === trading212Id ||
      entry.trade?.trading212Id === trading212IdBase ||
      (trading212Key && typeof entry.trade?.trading212Id === 'string' && entry.trade.trading212Id.endsWith(`${trading212Key}`))
    );
  });
  const aggregateTradeEntry = !exactTradeEntry ? openTrades.find(entry => {
    if (entry.trade?.status === 'closed') return false;
    if (entry.trade?.trading212AccountId && accountId && entry.trade.trading212AccountId !== accountId) {
      return false;
    }
    return (
      entry.trade?.trading212PositionKey === trading212PositionKey ||
      entry.trade?.symbol === symbol ||
      (rawIsin && entry.trade?.trading212Isin === rawIsin) ||
      (normalizedName && normalizeTrading212Name(entry.trade?.trading212Name) === normalizedName) ||
      (rawTickerValue && normalizeTrading212TickerValue(entry.trade?.trading212Ticker) === rawTickerValue)
    );
  }) : null;
  return { exactTradeEntry, aggregateTradeEntry };
}

function updateTrading212LayerMetadata(trade, {
  symbol,
  trading212Id,
  trading212PositionKey,
  accountId,
  rawName,
  rawIsin,
  rawTickerValue,
  tradeCurrency,
  direction,
  currentPrice,
  stop,
  lowStop,
  user,
  rates
}) {
  if (!trade) return;
  if (!trade.symbol) {
    trade.symbol = symbol;
  }
  trade.currency = tradeCurrency;
  trade.direction = direction;
  trade.status = 'open';
  trade.source = 'trading212';
  trade.trading212Id = trading212Id;
  trade.trading212PositionKey = trading212PositionKey;
  trade.trading212AccountId = accountId || trade.trading212AccountId || '';
  if (rawName) trade.trading212Name = rawName;
  if (rawIsin) trade.trading212Isin = rawIsin;
  if (rawTickerValue) trade.trading212Ticker = rawTickerValue;
  if (Number.isFinite(currentPrice) && currentPrice > 0) {
    trade.lastSyncPrice = currentPrice;
  }
  const nextStop = Number.isFinite(stop) && stop > 0 ? stop : (Number.isFinite(lowStop) ? lowStop : null);
  if (Number.isFinite(nextStop) && nextStop > 0) {
    trade.currentStop = nextStop;
    if (Number.isFinite(stop) && stop > 0) {
      trade.currentStopSource = 't212';
      trade.currentStopStale = false;
    }
    if (trade.stopManualOverride !== true) {
      trade.stop = nextStop;
    }
  }
  recalculateTradeRiskFromImportedStop(trade, user, rates);
}

function isFreshTimestamp(value, windowMs) {
  if (!value) return false;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return false;
  return (Date.now() - ts) <= windowMs;
}

function getCurrentPortfolioValue(user) {
  const portfolioValue = Number.isFinite(Number(user?.portfolio)) ? Number(user.portfolio) : 0;
  const portfolioCurrency = typeof user?.portfolioCurrency === 'string' && user.portfolioCurrency
    ? user.portfolioCurrency
    : 'GBP';
  const fallbackUpdatedAt = typeof user?.lastPortfolioSyncAt === 'string' ? user.lastPortfolioSyncAt : null;
  const tradingCfg = user?.trading212;
  if (tradingCfg?.enabled && getTrading212Accounts(tradingCfg).length) {
    if (isFreshTimestamp(tradingCfg.lastSyncAt, PORTFOLIO_SOURCE_T212_STALE_MS)) {
      return {
        value: portfolioValue,
        currency: portfolioCurrency,
        source: 'trading212',
        lastUpdatedAt: tradingCfg.lastSyncAt || fallbackUpdatedAt
      };
    }
  }
  const ibkrCfg = user?.ibkr;
  if (ibkrCfg?.enabled && ibkrCfg?.mode === 'connector') {
    updateIbkrConnectorStatus(ibkrCfg);
    if (ibkrCfg.connectionStatus === 'online' && isFreshTimestamp(ibkrCfg.lastSnapshotAt, PORTFOLIO_SOURCE_IBKR_STALE_MS)) {
      return {
        value: portfolioValue,
        currency: portfolioCurrency,
        source: 'ibkr',
        lastUpdatedAt: ibkrCfg.lastSnapshotAt || fallbackUpdatedAt
      };
    }
  }
  return {
    value: portfolioValue,
    currency: portfolioCurrency,
    source: user?.portfolioSource === 'trading212' || user?.portfolioSource === 'ibkr' ? user.portfolioSource : 'manual',
    lastUpdatedAt: fallbackUpdatedAt
  };
}

function matchIbkrStopOrderForTrade(trade, orders) {
  if (!trade || !orders.length) return null;
  if (trade.ibkrStopOrderId) {
    const found = orders.find(order => order.id && order.id === trade.ibkrStopOrderId);
    if (found) return found;
  }
  const tradeTicker = normalizeIbkrTicker(trade.ibkrTicker || trade.brokerTicker || trade.symbol || '');
  const tradeConid = String(trade.ibkrConid || '').trim();
  const filtered = orders.filter(order => {
    if (tradeConid && order.conid && order.conid === tradeConid) return true;
    const orderTicker = normalizeIbkrTicker(order.instrumentTicker || '');
    return tradeTicker && orderTicker && tradeTicker === orderTicker;
  });
  return pickBestStopOrder(filtered, trade);
}

async function requestIbkrEndpoint(pathSuffix, options = {}) {
  const method = options.method || 'GET';
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'VeracitySuite/1.0',
    ...(options.headers || {})
  };
  const target = `${IBKR_API_BASE_URL}${pathSuffix}`;
  let res;
  try {
    res = await fetch(target, {
      method,
      headers,
      body: options.body,
      signal: options.signal || AbortSignal.timeout(15000)
    });
  } catch (networkErr) {
    const code = networkErr?.code || networkErr?.cause?.code || networkErr?.name;
    const isNetwork = ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'AbortError'].includes(code);
    throw isNetwork
      ? new IbkrNetworkError('Unable to reach IBKR Client Portal.', { code: 'network_error' })
      : new IbkrError('IBKR request failed.', { code: 'ibkr_error' });
  }
  const status = res.status;
  const contentType = res.headers.get('content-type') || '';
  const bodyText = await res.text().catch(() => '');
  if (status === 401 || status === 403) {
    throw new IbkrAuthError('IBKR session is not authenticated.', { status });
  }
  if (!res.ok) {
    throw new IbkrHttpError(bodyText || `IBKR responded with ${status}`, { status });
  }
  if (!bodyText) return null;
  if (!contentType.includes('application/json')) {
    throw new IbkrParseError('IBKR returned an unexpected response format.', { status, code: 'invalid_payload' });
  }
  try {
    return JSON.parse(bodyText);
  } catch (e) {
    throw new IbkrParseError('IBKR returned an unexpected response format.', { status, code: 'invalid_payload' });
  }
}

async function fetchIbkrAccounts() {
  const cacheKey = 'ibkr:accounts';
  const cached = getIbkrCacheEntry(cacheKey);
  if (cached) return cached.payload;
  const payload = await requestIbkrEndpoint('/portfolio/accounts');
  setIbkrCacheEntry(cacheKey, payload);
  return payload;
}

async function fetchIbkrSummary(accountId) {
  const cacheKey = `ibkr:summary:${accountId}`;
  const cached = getIbkrCacheEntry(cacheKey);
  if (cached) return cached.payload;
  const payload = await requestIbkrEndpoint(`/portfolio/${accountId}/summary`);
  setIbkrCacheEntry(cacheKey, payload);
  return payload;
}

async function fetchIbkrLedger(accountId) {
  const cacheKey = `ibkr:ledger:${accountId}`;
  const cached = getIbkrCacheEntry(cacheKey);
  if (cached) return cached.payload;
  const payload = await requestIbkrEndpoint(`/portfolio/${accountId}/ledger`);
  setIbkrCacheEntry(cacheKey, payload);
  return payload;
}

async function fetchIbkrPositions(accountId) {
  const cacheKey = `ibkr:positions:${accountId}`;
  const cached = getIbkrCacheEntry(cacheKey);
  if (cached) return cached.payload;
  try {
    const payload = await requestIbkrEndpoint(`/portfolio2/${accountId}/positions`);
    setIbkrCacheEntry(cacheKey, payload);
    return payload;
  } catch (e) {
    if (e instanceof IbkrHttpError && e.status === 404) {
      // fallback below
    } else {
      throw e;
    }
  }
  const positions = [];
  let pageId = 0;
  while (pageId < 20) {
    const payload = await requestIbkrEndpoint(`/portfolio/${accountId}/positions/${pageId}`);
    const list = Array.isArray(payload) ? payload : payload?.positions;
    if (!Array.isArray(list) || list.length === 0) break;
    positions.push(...list);
    pageId += 1;
  }
  const payload = { positions };
  setIbkrCacheEntry(cacheKey, payload);
  return payload;
}

async function fetchIbkrOrders() {
  const cacheKey = 'ibkr:orders';
  const cached = getIbkrCacheEntry(cacheKey);
  if (cached) return cached.payload;
  const payload = await requestIbkrEndpoint('/iserver/account/orders');
  setIbkrCacheEntry(cacheKey, payload);
  return payload;
}

function upsertIbkrStopOrders(user, ordersPayload) {
  const orders = parseIbkrOrders(ordersPayload);
  const journal = ensureTradeJournal(user);
  let updated = 0;
  for (const items of Object.values(journal)) {
    for (const trade of items || []) {
      if (!trade || trade.status === 'closed') continue;
      if (trade.source !== 'ibkr' && !trade.ibkrPositionId) continue;
      const matched = matchIbkrStopOrderForTrade(trade, orders);
      const shouldAutoSync = trade.currentStopSource !== 'manual';
      if (!matched || !Number.isFinite(matched.stopPrice)) {
        if (!shouldAutoSync) continue;
        const hadStop = Number.isFinite(Number(trade.currentStop));
        if (!hadStop && trade.currentStopStale === true) continue;
        delete trade.currentStop;
        trade.currentStopSource = 'ibkr';
        trade.currentStopLastSyncedAt = new Date().toISOString();
        trade.currentStopStale = true;
        trade.ibkrStopOrderId = '';
        updated += 1;
        continue;
      }
      const stopPrice = Number(matched.stopPrice);
      const shouldUpdate = shouldAutoSync
        && (!Number.isFinite(Number(trade.currentStop))
          || Number(trade.currentStop) !== stopPrice
          || trade.currentStopStale === true
          || trade.ibkrStopOrderId !== (matched.id || ''));
      if (!shouldUpdate) continue;
      trade.currentStop = stopPrice;
      trade.currentStopSource = 'ibkr';
      trade.currentStopLastSyncedAt = new Date().toISOString();
      trade.currentStopStale = false;
      trade.ibkrStopOrderId = matched.id || '';
      updated += 1;
    }
  }
  return { updated, orders };
}

function resolveMappedBrokerTicker(db, username, displayTicker) {
  const trimmed = String(displayTicker || '').trim().toUpperCase();
  if (!trimmed) return '';
  const mappings = ensureInstrumentMappings(db);
  const userMapping = mappings.find(mapping => (
    mapping?.status === 'active'
    && mapping.scope === 'user'
    && mapping.user_id === username
    && String(mapping.canonical_ticker || '').toUpperCase() === trimmed
  ));
  if (userMapping?.broker_ticker) return String(userMapping.broker_ticker).trim().toUpperCase();
  const globalMapping = mappings.find(mapping => (
    mapping?.status === 'active'
    && mapping.scope === 'global'
    && !mapping.user_id
    && String(mapping.canonical_ticker || '').toUpperCase() === trimmed
  ));
  return globalMapping?.broker_ticker ? String(globalMapping.broker_ticker).trim().toUpperCase() : '';
}

function pickBestStopOrder(orders, trade) {
  if (!orders.length) return null;
  const tradeQty = Number(trade.sizeUnits);
  const scored = orders.map(order => {
    const orderQty = Number.isFinite(order.quantity) ? Math.abs(order.quantity) : null;
    const qtyDiff = (Number.isFinite(tradeQty) && Number.isFinite(orderQty))
      ? Math.abs(orderQty - tradeQty)
      : Infinity;
    const createdAt = Date.parse(order.createdAt || '');
    return {
      order,
      qtyDiff,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0
    };
  });
  scored.sort((a, b) => {
    if (a.qtyDiff !== b.qtyDiff) return a.qtyDiff - b.qtyDiff;
    return b.createdAt - a.createdAt;
  });
  return scored[0]?.order || null;
}

function normalizeOrderQuantity(value) {
  const qty = Number(value);
  return Number.isFinite(qty) ? Math.abs(qty) : null;
}

function quantitiesMatch(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) <= 1e-8;
}

function matchStopOrderForTrade(trade, orders, context = {}) {
  if (!trade || !orders.length) return null;
  if (trade.t212StopOrderId) {
    const found = orders.find(order => order.id && order.id === trade.t212StopOrderId);
    if (found) return found;
  }
  const tradeTicker = normalizeTrading212TickerValue(trade.trading212Ticker || '');
  const tradeIsin = String(trade.trading212Isin || '').trim().toUpperCase();
  const filtered = orders.filter(order => {
    const orderTicker = normalizeTrading212TickerValue(order.instrumentTicker || '');
    if (tradeTicker && orderTicker && orderTicker === tradeTicker) return true;
    if (tradeIsin && String(order.instrumentIsin || '').trim().toUpperCase() === tradeIsin) return true;
    return false;
  });
  if (!filtered.length) return null;
  const tradeQty = normalizeOrderQuantity(trade.sizeUnits);
  const exactQtyOrders = Number.isFinite(tradeQty)
    ? filtered.filter(order => quantitiesMatch(normalizeOrderQuantity(order.quantity), tradeQty))
    : [];
  if (exactQtyOrders.length) {
    return pickBestStopOrder(exactQtyOrders, trade);
  }
  const relatedTrades = Array.isArray(context.relatedTrades) ? context.relatedTrades : [];
  if (relatedTrades.length > 1) {
    const combinedQty = relatedTrades.reduce((sum, item) => {
      const units = Number(item?.sizeUnits);
      return Number.isFinite(units) && units > 0 ? sum + units : sum;
    }, 0);
    const combinedQtyOrders = combinedQty > 0
      ? filtered.filter(order => quantitiesMatch(normalizeOrderQuantity(order.quantity), combinedQty))
      : [];
    if (combinedQtyOrders.length) {
      return pickBestStopOrder(combinedQtyOrders, { ...trade, sizeUnits: combinedQty });
    }
  }
  return null;
}

async function fetchTrading212Orders(config, username, { bypassCache = false, accountId = '' } = {}) {
  if (!config?.apiKey || !config?.apiSecret) {
    throw new Trading212AuthError('Trading 212 credentials are incomplete.', { status: 401 });
  }
  const baseUrl = resolveTrading212BaseUrl(config);
  const endpoint = '/api/v0/equity/orders';
  const cacheKey = `${String(username || '')}|${String(accountId || '')}|${baseUrl}|${endpoint}`;
  const cached = trading212OrdersCache.get(cacheKey);
  if (!bypassCache && cached && Date.now() - cached.fetchedAt < TRADING212_ORDERS_CACHE_MS) {
    console.info(`[T212] cache hit orders key=${cacheKey}`);
    return {
      raw: cached.raw,
      orders: cached.orders,
      rawCount: cached.rawCount,
      filteredCount: cached.filteredCount,
      fromCache: true
    };
  }
  console.info(`[T212] cache miss orders key=${cacheKey}`);
  const headers = buildTrading212AuthHeaders(config);
  const url = `${baseUrl}${endpoint}`;
  console.info(`[T212] baseUrl=${baseUrl} endpoint=${endpoint}`);
  const payload = await requestTrading212RawEndpoint(url, headers, {
    signal: AbortSignal.timeout(15000)
  });
  if (payload === null) {
    throw new Trading212ParseError('Trading 212 orders response was empty.', { status: 200 });
  }
  const rawOrders = extractTrading212Orders(payload);
  if (!Array.isArray(rawOrders)) {
    throw new Trading212ParseError('Trading 212 orders response was in an unexpected format.', {
      status: 200,
      details: { sample: JSON.stringify(payload).slice(0, 500) }
    });
  }
  const orders = parseTrading212Orders(payload);
  const rawCount = rawOrders.length;
  const filteredCount = orders.length;
  trading212OrdersCache.set(cacheKey, {
    fetchedAt: Date.now(),
    raw: payload,
    orders,
    rawCount,
    filteredCount
  });
  console.info(`[T212] orders rawCount=${rawCount} filteredCount=${filteredCount}`);
  return {
    raw: payload,
    orders,
    rawCount,
    filteredCount,
    fromCache: false
  };
}

function computeSourceKey(instrument = {}) {
  if (instrument.isin) {
    return `TRADING212|ISIN:${instrument.isin}`;
  }
  if (instrument.uid) {
    return `TRADING212|UID:${instrument.uid}`;
  }
  return `TRADING212|TICKER:${instrument.ticker}|CCY:${instrument.currency}`;
}

function ensureInstrumentMappings(db) {
  if (!db.instrumentMappings || !Array.isArray(db.instrumentMappings)) {
    db.instrumentMappings = [];
  }
  return db.instrumentMappings;
}

function parseSourceKey(sourceKey) {
  if (typeof sourceKey !== 'string') return { source: 'TRADING212', sourceKey: '' };
  const trimmed = sourceKey.trim();
  if (!trimmed) return { source: 'TRADING212', sourceKey: '' };
  const [source] = trimmed.split('|');
  return { source: source || 'TRADING212', sourceKey: trimmed };
}

function nextInstrumentMappingId(mappings) {
  const maxId = mappings.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0);
  return maxId + 1;
}

function isAdminUser(user, username) {
  if (user?.isAdmin === true) return true;
  const list = String(process.env.ADMIN_USERS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (!list.length) return false;
  return list.includes(username);
}

function resolveInstrumentMapping(db, instrument, username) {
  const mappings = ensureInstrumentMappings(db);
  const sourceKey = computeSourceKey(instrument);
  if (!sourceKey) {
    return {
      sourceKey: null,
      displayTicker: instrument.ticker || '',
      displayName: instrument.name || '',
      scope: 'broker'
    };
  }
  const { source, sourceKey: normalizedKey } = parseSourceKey(sourceKey);
  const userMapping = mappings.find(mapping => (
    mapping?.status === 'active'
    && mapping.source === source
    && mapping.source_key === normalizedKey
    && mapping.scope === 'user'
    && mapping.user_id === username
  ));
  if (userMapping) {
    return {
      sourceKey: normalizedKey,
      displayTicker: userMapping.canonical_ticker,
      displayName: userMapping.canonical_name || userMapping.broker_name || instrument.name || '',
      scope: 'user',
      mapping: userMapping
    };
  }
  const globalMapping = mappings.find(mapping => (
    mapping?.status === 'active'
    && mapping.source === source
    && mapping.source_key === normalizedKey
    && mapping.scope === 'global'
    && !mapping.user_id
  ));
  if (globalMapping) {
    return {
      sourceKey: normalizedKey,
      displayTicker: globalMapping.canonical_ticker,
      displayName: globalMapping.canonical_name || globalMapping.broker_name || instrument.name || '',
      scope: 'global',
      mapping: globalMapping
    };
  }
  return {
    sourceKey: normalizedKey,
    displayTicker: instrument.ticker || '',
    displayName: instrument.name || '',
    scope: 'broker'
  };
}

function buildInstrumentFromTrade(trade = {}) {
  const brokerTicker = normalizeTrading212TickerValue(
    trade.trading212Ticker ?? trade.symbol ?? ''
  );
  return {
    isin: trade.trading212Isin || '',
    uid: trade.trading212Id || '',
    ticker: brokerTicker,
    currency: trade.currency || '',
    name: trade.trading212Name || ''
  };
}

function applyInstrumentMappingToTrade(trade, db, username) {
  if (!trade || typeof trade !== 'object') return trade;
  const isTrading212 = trade.source === 'trading212' || trade.trading212Id;
  if (!isTrading212) {
    return {
      ...trade,
      displayTicker: trade.displaySymbol || trade.symbol || '',
      displayName: trade.displayName || trade.trading212Name || '',
      brokerTicker: trade.symbol || ''
    };
  }
  const instrument = buildInstrumentFromTrade(trade);
  const resolved = resolveInstrumentMapping(db, instrument, username);
  const fallbackTicker = trade.displaySymbol || trade.symbol || instrument.ticker || '';
  const displayTicker = resolved.scope === 'broker'
    ? fallbackTicker
    : (resolved.displayTicker || fallbackTicker);
  return {
    ...trade,
    displayTicker,
    displayName: resolved.displayName || trade.displayName || trade.trading212Name || '',
    mappingScope: resolved.scope === 'broker' ? null : resolved.scope,
    mappingId: resolved.mapping?.id,
    sourceKey: resolved.sourceKey,
    brokerTicker: instrument.ticker || trade.symbol || ''
  };
}

function deriveTrading212Root(endpointPath) {
  if (typeof endpointPath !== 'string') return '/api/v0';
  const trimmed = endpointPath.trim();
  if (!trimmed) return '/api/v0';
  const match = trimmed.match(/(\/api\/v\d+)/i);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }
  return '/api/v0';
}

async function requestTrading212Endpoint(url, headers, options = {}) {
  const maxAttempts = 3;
  let attempt = 0;
  let lastError = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers, signal: options.signal });
    } catch (networkErr) {
      const code = networkErr?.code || networkErr?.cause?.code || networkErr?.name;
      const isNetwork = ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'AbortError'].includes(code);
      lastError = isNetwork
        ? new Trading212NetworkError('Unable to reach Trading 212', { code: 'network_error' })
        : new Trading212Error('Trading 212 request failed.', { code: 'trading212_error' });
      await sleep(Math.min(1000 * attempt, 3000));
      continue;
    }
    const status = res.status;
    const contentType = res.headers.get('content-type') || '';
    const bodyText = await res.text().catch(() => '');
    console.info(`Trading 212 request ${url} -> ${status}`);
    if (status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      lastError = new Trading212RateLimitError('Trading 212 rate limited the request. Please try again later.', {
        status,
        retryAfter
      });
      const wait = retryAfter !== null ? Math.min(retryAfter * 1000, 5000) : Math.min(1000 * attempt, 5000);
      if (attempt < maxAttempts) {
        await sleep(wait);
        continue;
      }
      throw lastError;
    }
    if (status === 401 || status === 403) {
      console.warn(`Trading 212 auth failure ${status} for ${url}: ${bodyText.slice(0, 500)}`);
      throw new Trading212AuthError('Invalid API key or missing Orders Read permission.', { status });
    }
    if (!res.ok) {
      console.warn(`Trading 212 non-OK ${status} for ${url}: ${bodyText.slice(0, 500)}`);
      throw new Trading212HttpError(bodyText || `Trading 212 responded with ${status}`, { status });
    }
    let data = {};
    if (bodyText) {
      if (!contentType.includes('application/json')) {
        throw new Trading212HttpError('Trading 212 returned an unexpected response format.', {
          status,
          code: 'invalid_payload'
        });
      }
      try {
        data = JSON.parse(bodyText);
      } catch (e) {
        throw new Trading212HttpError('Trading 212 returned an unexpected response format.', {
          status,
          code: 'invalid_payload'
        });
      }
    }
    const portfolioCandidates = [
      data?.totalValue?.value,
      data?.totalValue?.amount,
      data?.totalValue,
      data?.total?.portfolioValue,
      data?.portfolioValue,
      data?.portfolio?.totalValue,
      data?.summary?.totalValue,
      data?.summary?.equity,
      data?.summary?.total?.value,
      data?.summary?.total?.amount,
      data?.overall?.portfolioValue,
      data?.overall?.totalValue,
      data?.accountValue,
      data?.netLiq,
      data?.equity?.value,
      data?.equity?.amount,
      data?.equityValue,
      data?.portfolio?.value,
      data?.portfolio?.amount,
      data?.portfolio?.total?.value,
      data?.portfolio?.total?.amount,
      data?.portfolio?.equity?.value,
      data?.portfolio?.equity?.amount
    ];
    const netDepositsCandidates = [
      data?.totalNetDeposits,
      data?.netDeposits,
      data?.total?.netDeposits,
      data?.summary?.netDeposits,
      data?.summary?.netDeposits?.value,
      data?.summary?.netDeposits?.amount,
      data?.overall?.netDeposits,
      data?.cashFlows?.net,
      data?.cashFlows?.net?.value,
      data?.cashFlows?.net?.amount,
      data?.netCash
    ];
    let portfolioValue = portfolioCandidates
      .map(parseTradingNumber)
      .find(value => Number.isFinite(value));
    const netDeposits = netDepositsCandidates
      .map(parseTradingNumber)
      .find(value => Number.isFinite(value));
    if (!Number.isFinite(portfolioValue)) {
      const account = data?.account || data?.portfolio || data?.summary || data?.total || data?.overall;
      if (account && typeof account === 'object') {
        const numericValues = Object.values(account)
          .map(parseTradingNumber)
          .filter(value => Number.isFinite(value));
        if (numericValues.length) {
          portfolioValue = Math.max(...numericValues);
        }
      }
    }
    if (!Number.isFinite(portfolioValue)) {
      const err = new Trading212Error('Trading 212 payload was missing a portfolio value.', {
        status,
        code: 'invalid_payload'
      });
      err.raw = data;
      throw err;
    }
        return {
          portfolioValue,
          netDeposits: Number.isFinite(netDeposits) ? netDeposits : null,
          raw: data
        };
      }
      throw lastError || new Trading212Error('Trading 212 request failed.');
    }

async function requestTrading212RawEndpoint(url, headers, options = {}) {
  const maxAttempts = 3;
  let attempt = 0;
  let lastError = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers, signal: options.signal });
    } catch (networkErr) {
      const code = networkErr?.code || networkErr?.cause?.code || networkErr?.name;
      const isNetwork = ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'AbortError'].includes(code);
      lastError = isNetwork
        ? new Trading212NetworkError('Unable to reach Trading 212', { code: 'network_error' })
        : new Trading212Error('Trading 212 request failed.', { code: 'trading212_error' });
      await sleep(Math.min(1000 * attempt, 3000));
      continue;
    }
    const status = res.status;
    const contentType = res.headers.get('content-type') || '';
    const bodyText = await res.text().catch(() => '');
    console.info(`Trading 212 request ${url} -> ${status}`);
    console.info(`[T212] status=${status} content-type=${contentType} body=${bodyText.slice(0, 300)}`);
    if (status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      lastError = new Trading212RateLimitError('Trading 212 rate limited the request. Please try again later.', {
        status,
        retryAfter
      });
      const wait = retryAfter !== null ? Math.min(retryAfter * 1000, 5000) : Math.min(1000 * attempt, 5000);
      if (attempt < maxAttempts) {
        await sleep(wait);
        continue;
      }
      throw lastError;
    }
    if (status === 401 || status === 403) {
      console.warn(`Trading 212 auth failure ${status} for ${url}: ${bodyText.slice(0, 500)}`);
      throw new Trading212AuthError('Invalid API key or missing Orders Read permission.', { status });
    }
    if (!res.ok) {
      console.warn(`Trading 212 non-OK ${status} for ${url}: ${bodyText.slice(0, 500)}`);
      throw new Trading212HttpError(bodyText || `Trading 212 responded with ${status}`, { status });
    }
    if (bodyText) {
      if (!contentType.includes('application/json')) {
        throw new Trading212ParseError('Trading 212 returned an unexpected response format.', {
          status,
          code: 'invalid_payload'
        });
      }
      try {
        return JSON.parse(bodyText);
      } catch (e) {
        throw new Trading212ParseError('Trading 212 returned an unexpected response format.', {
          status,
          code: 'invalid_payload'
        });
      }
    }
    return null;
  }
  throw lastError || new Trading212Error('Trading 212 request failed.');
}

function recalculateTradeRiskFromImportedStop(trade, user, rates) {
  if (!trade || typeof trade !== 'object') return false;
  const entry = Number(trade.entry);
  const stop = Number(trade.stop);
  const sizeUnits = Number(trade.sizeUnits);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop) || stop <= 0 || !Number.isFinite(sizeUnits) || sizeUnits <= 0) {
    return false;
  }
  const direction = String(trade.direction || 'long').toLowerCase() === 'short' ? 'short' : 'long';
  let perUnitRisk = direction === 'short' ? (stop - entry) : (entry - stop);
  if (!Number.isFinite(perUnitRisk) || perUnitRisk <= 0) {
    perUnitRisk = Math.abs(entry - stop);
  }
  if (!Number.isFinite(perUnitRisk) || perUnitRisk <= 0) return false;
  const tradeCurrency = trade.currency || 'GBP';
  const riskAmountCurrency = perUnitRisk * sizeUnits;
  const positionCurrency = entry * sizeUnits;
  const portfolioGBP = Number.isFinite(Number(user?.portfolio)) ? Number(user.portfolio) : 0;
  const portfolioCurrency = convertGBPToCurrency(portfolioGBP, tradeCurrency, rates);
  trade.perUnitRisk = perUnitRisk;
  trade.riskAmountCurrency = riskAmountCurrency;
  trade.positionCurrency = positionCurrency;
  trade.riskAmountGBP = convertToGBP(riskAmountCurrency, tradeCurrency, rates);
  trade.positionGBP = convertToGBP(positionCurrency, tradeCurrency, rates);
  trade.portfolioGBPAtCalc = portfolioGBP;
  trade.portfolioCurrencyAtCalc = Number.isFinite(portfolioCurrency) ? portfolioCurrency : 0;
  trade.riskPct = Number.isFinite(portfolioCurrency) && portfolioCurrency > 0
    ? (riskAmountCurrency / portfolioCurrency) * 100
    : 0;
  if (!Number.isFinite(Number(trade.originalStopPrice)) || Number(trade.originalStopPrice) <= 0) {
    trade.originalStopPrice = stop;
  }
  return true;
}

function upsertTrading212StopOrders(user, ordersPayload, accountId = '', rates = null) {
  const orders = ordersPayload?.orders || [];
  const journal = ensureTradeJournal(user);
  const openTrades = [];
  for (const [dateKey, items] of Object.entries(journal)) {
    for (const trade of items || []) {
      if (!trade || trade.status === 'closed') continue;
      if (trade.source !== 'trading212' && !trade.trading212Id) continue;
      if (accountId && trade.trading212AccountId && trade.trading212AccountId !== accountId) continue;
      openTrades.push(trade);
    }
  }
  let updated = 0;
  for (const trade of openTrades) {
    const relatedTrades = openTrades.filter(candidate => {
      if (!candidate || candidate.id === trade.id) return false;
      if (accountId && candidate.trading212AccountId && candidate.trading212AccountId !== accountId) return false;
      const samePositionKey = trade.trading212PositionKey && candidate.trading212PositionKey && trade.trading212PositionKey === candidate.trading212PositionKey;
      const sameTicker = normalizeTrading212TickerValue(trade.trading212Ticker || '')
        && normalizeTrading212TickerValue(trade.trading212Ticker || '') === normalizeTrading212TickerValue(candidate.trading212Ticker || '');
      const sameIsin = trade.trading212Isin && candidate.trading212Isin && String(trade.trading212Isin).toUpperCase() === String(candidate.trading212Isin).toUpperCase();
      const sameSymbol = trade.symbol && candidate.symbol && String(trade.symbol).toUpperCase() === String(candidate.symbol).toUpperCase();
      return samePositionKey || sameTicker || sameIsin || sameSymbol;
    });
    const matched = matchStopOrderForTrade(trade, orders, { relatedTrades: [trade, ...relatedTrades] });
    const shouldAutoSync = trade.currentStopSource !== 'manual';
    if (!matched || !Number.isFinite(matched.stopPrice)) {
      if (!shouldAutoSync) continue;
      const hadStop = Number.isFinite(Number(trade.currentStop));
      if (!hadStop && trade.currentStopStale === true) continue;
      delete trade.currentStop;
      trade.currentStopSource = 't212';
      trade.currentStopLastSyncedAt = new Date().toISOString();
      trade.currentStopStale = true;
      trade.t212StopOrderId = '';
      updated += 1;
      continue;
    }
    const stopPrice = Number(matched.stopPrice);
    const shouldUpdate = shouldAutoSync
      && (!Number.isFinite(Number(trade.currentStop))
        || Number(trade.currentStop) !== stopPrice
        || trade.currentStopStale === true
        || trade.t212StopOrderId !== (matched.id || ''));
    if (!shouldUpdate) continue;
    trade.currentStop = stopPrice;
    trade.currentStopSource = 't212';
    trade.currentStopLastSyncedAt = new Date().toISOString();
    trade.currentStopStale = false;
    trade.t212StopOrderId = matched.id || '';
    if (trade.stopManualOverride !== true) {
      trade.stop = stopPrice;
    }
    recalculateTradeRiskFromImportedStop(trade, user, rates);
    updated += 1;
  }
  return { updated };
}

async function fetchTrading212Snapshot(config) {
  if (!config?.apiKey || !config?.apiSecret) {
    throw new Trading212AuthError('Trading 212 credentials are incomplete.', { status: 401 });
  }
  const baseUrl = resolveTrading212BaseUrl(config);
  if (!baseUrl) {
    throw new Trading212Error('Trading 212 base URL could not be determined.');
  }
  const headers = buildTrading212AuthHeaders(config);
  const endpointCandidates = [];
  const seenEndpoints = new Set();
  const appendEndpoint = (value) => {
    if (!value || typeof value !== 'string') return;
    let normalized = value.trim();
    if (!normalized) return;
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized.replace(/^\/+/, '')}`;
    }
    if (seenEndpoints.has(normalized)) return;
    seenEndpoints.add(normalized);
    endpointCandidates.push(normalized);
  };
  appendEndpoint(config.endpoint || '/api/v0/equity/portfolio/summary');
  appendEndpoint('/api/v0/equity/portfolio-summary');
  appendEndpoint('/api/v0/equities/portfolio-summary');
  appendEndpoint('/api/v0/equity/portfolio/summary');
  appendEndpoint('/api/v0/equity/portfolio');
  appendEndpoint('/api/v0/equity/portfolios/summary');
  appendEndpoint('/api/v0/equity/account/info');
  appendEndpoint('/api/v0/equity/account-info');
  appendEndpoint('/api/v0/equity/account/summary');
  appendEndpoint('/api/v0/account/summary');
  appendEndpoint('/api/v0/portfolio/summary');
  let lastError = null;
  for (const pathSuffix of endpointCandidates) {
    const endpoint = `${baseUrl}${pathSuffix}`;
    try {
      console.info(`[T212] baseUrl=${baseUrl} endpoint=${pathSuffix}`);
      const snapshot = await requestTrading212Endpoint(endpoint, headers);
      const root = deriveTrading212Root(pathSuffix);
      const positionsEndpoints = [
        `${root}/equity/positions`,
        `${root}/equity/portfolio`,
        `${root}/equity/portfolio/positions`,
        `${root}/equity/account/positions`,
        `${root}/portfolio/positions`
      ];
      const transactionEndpoints = [
        `${root}/equity/history/transactions?limit=50`,
        `${root}/history/transactions`,
        `${root}/history/transactions?type=CASH`,
        `${root}/history/cash`,
        `${root}/transactions`,
        `${root}/cash/transactions`
      ];
      let positions = null;
      let positionsRaw = null;
      let transactions = null;
      let transactionsRaw = null;
      for (const candidate of positionsEndpoints) {
        try {
          const payload = await requestTrading212RawEndpoint(`${baseUrl}${candidate}`, headers);
          const list = Array.isArray(payload) ? payload : payload?.items || payload?.positions;
          if (Array.isArray(list)) {
            positions = list;
            positionsRaw = payload;
            break;
          }
        } catch (e) {
          if (e instanceof Trading212Error && e.status === 404) continue;
        }
      }
      for (const candidate of transactionEndpoints) {
        try {
          const payload = await requestTrading212RawEndpoint(`${baseUrl}${candidate}`, headers);
          const list = Array.isArray(payload) ? payload : payload?.items || payload?.transactions;
          if (Array.isArray(list)) {
            transactions = list;
            transactionsRaw = payload ?? { items: [] };
            break;
          }
        } catch (e) {
          if (e instanceof Trading212Error && e.status === 404) continue;
        }
      }
      return {
        ...snapshot,
        baseUrl,
        endpoint: pathSuffix,
        positions,
        positionsRaw,
        transactions,
        transactionsRaw
      };
    } catch (error) {
      if (error instanceof Trading212Error && error.status === 404) {
        const notFoundError = new Trading212Error(`Trading 212 could not find ${endpoint}`, {
          status: 404,
          code: 'not_found'
        });
        notFoundError.baseUrl = baseUrl;
        notFoundError.endpoint = pathSuffix;
        lastError = notFoundError;
        continue;
      }
      if (error instanceof Trading212Error) {
        error.baseUrl = baseUrl;
        error.endpoint = pathSuffix;
      }
      throw error;
    }
  }
  throw lastError || new Trading212Error('Trading 212 portfolio summary endpoint not found.', { status: 404 });
}

const trading212Jobs = new Map();
const ibkrJobs = new Map();

async function syncTrading212ForUser(username, runDate = new Date()) {
  const db = loadDB();
  const user = db.users[username];
  if (!user) return;
  ensureUserShape(user, username);
  const cfg = user.trading212;
  const accounts = getTrading212Accounts(cfg);
  if (!cfg || !cfg.enabled || !accounts.length) return;
  const rates = await fetchRates();
  const now = Date.now();
  if (cfg.cooldownUntil) {
    const cooldownTs = Date.parse(cfg.cooldownUntil);
    if (!Number.isNaN(cooldownTs) && cooldownTs > now) {
      const seconds = Math.max(1, Math.ceil((cooldownTs - now) / 1000));
      cfg.lastStatus = {
        ok: false,
        status: 429,
        retryAfter: seconds,
        message: `Trading 212 asked us to wait ${seconds} seconds before the next sync.`
      };
      saveDB(db);
      return;
    }
    delete cfg.cooldownUntil;
  }
  try {
    const accountResults = await Promise.allSettled(accounts.map(async (account, index) => {
      const accountId = account.id || `account-${index + 1}`;
      const accountConfig = {
        ...cfg,
        apiKey: account.apiKey,
        apiSecret: account.apiSecret,
        mode: account.mode || cfg.mode,
        baseUrl: account.baseUrl || cfg.baseUrl
      };
      const snapshot = await fetchTrading212Snapshot(accountConfig);
      const ordersPayload = await fetchTrading212Orders(accountConfig, username, { accountId });
      return {
        accountId,
        accountConfig,
        snapshot,
        ordersPayload
      };
    }));
    const fulfilled = accountResults.filter(result => result.status === 'fulfilled').map(result => result.value);
    const rejected = accountResults.filter(result => result.status === 'rejected').map(result => result.reason);
    if (!fulfilled.length) {
      throw rejected[0] || new Trading212Error('Trading 212 sync failed.');
    }
    let totalStopUpdates = 0;
    for (const result of fulfilled) {
      const { updated: stopUpdates } = upsertTrading212StopOrders(user, result.ordersPayload, result.accountId, rates);
      totalStopUpdates += stopUpdates;
    }
    if (totalStopUpdates > 0) {
      console.info(`[T212] synced current stops for ${totalStopUpdates} trade(s)`);
    }
    const history = ensurePortfolioHistory(user);
    normalizePortfolioHistory(user);
    const { total: currentTotal } = computeNetDepositsTotals(user, history);
    const timezone = cfg.timezone || 'Europe/London';
    const dateKey = dateKeyInTimezone(timezone, runDate);
    const ym = dateKey.slice(0, 7);
    history[ym] ||= {};
    const existing = history[ym][dateKey] || {};
    let cashIn = Number(existing.cashIn ?? 0);
    let cashOut = Number(existing.cashOut ?? 0);
    const combinedTransactions = fulfilled.flatMap(result => {
      const snapshot = result.snapshot || {};
      const inlineTransactions = Array.isArray(snapshot.raw?.transactions?.items)
        ? snapshot.raw.transactions.items
        : Array.isArray(snapshot.raw?.transactions?.records)
          ? snapshot.raw.transactions.records
          : Array.isArray(snapshot.raw?.transactions)
            ? snapshot.raw.transactions
            : null;
      const effectiveTransactions = Array.isArray(snapshot.transactions)
        ? snapshot.transactions
        : Array.isArray(snapshot.transactionsRaw?.items)
          ? snapshot.transactionsRaw.items
          : Array.isArray(snapshot.transactionsRaw)
            ? snapshot.transactionsRaw
            : inlineTransactions;
      if (!Array.isArray(effectiveTransactions)) return [];
      return effectiveTransactions.map(tx => ({ tx, accountId: result.accountId }));
    });
    if (combinedTransactions.length) {
      const enabledAtTs = cfg.integrationEnabledAt ? Date.parse(cfg.integrationEnabledAt) : null;
      const lastTxAt = cfg.lastTransactionAt ? Date.parse(cfg.lastTransactionAt) : null;
      const portfolioValue = fulfilled.reduce((sum, result) => {
        const value = Number(result.snapshot?.portfolioValue);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0);
      const effectivePortfolioValue = Number.isFinite(portfolioValue) && portfolioValue > 0
        ? portfolioValue
        : (Number.isFinite(user.portfolio) ? Number(user.portfolio) : 0);
      const minDeposit = Number.isFinite(effectivePortfolioValue) && effectivePortfolioValue > 0
        ? effectivePortfolioValue * 0.00015
        : 0;
      const txs = combinedTransactions
        .map(item => {
          const ts = Date.parse(item.tx?.timestamp || item.tx?.time || item.tx?.date || item.tx?.dateTime || item.tx?.processedAt || '');
          return { ...item, ts };
        })
        .filter(item => Number.isFinite(item.ts))
        .sort((a, b) => a.ts - b.ts);
      let newest = lastTxAt;
      for (const item of txs) {
        if (lastTxAt && item.ts <= lastTxAt) continue;
        if (enabledAtTs && item.ts < enabledAtTs) continue;
        const tx = item.tx || {};
        const reference = String(tx.reference || tx.id || tx.transactionId || '').trim();
        const referenceKey = reference && item.accountId ? `${item.accountId}:${reference}` : reference;
        if (referenceKey && cfg.processedReferences.includes(referenceKey)) {
          continue;
        }
        const type = String(tx.type || tx.transactionType || tx.reason || '').toLowerCase();
        if (type && !type.includes('deposit') && !type.includes('withdraw') && !type.includes('cash') && !type.includes('transfer')) {
          continue;
        }
        const amount = parseTradingNumber(
          tx.amount?.value ??
          tx.amount?.amount ??
          tx.amount ??
          tx.cash ??
          tx.value ??
          tx.money
        );
        if (!Number.isFinite(amount) || amount === 0) continue;
        const txCurrency = tx.currency || tx.amount?.currency || tx.money?.currency || 'GBP';
        const amountGBP = txCurrency && txCurrency !== 'GBP'
          ? convertToGBP(amount, txCurrency, rates)
          : amount;
        if (amountGBP > 0 && minDeposit > 0 && amountGBP < minDeposit) {
          continue;
        }
        const date = dateKeyInTimezone(timezone, new Date(item.ts));
        const monthKey = date.slice(0, 7);
        history[monthKey] ||= {};
        const entry = history[monthKey][date] || {};
        const entryCashIn = Number(entry.cashIn ?? 0);
        const entryCashOut = Number(entry.cashOut ?? 0);
        if (amountGBP > 0) {
          entry.cashIn = entryCashIn + amountGBP;
          if (date === dateKey) {
            cashIn += amountGBP;
          }
        } else {
          entry.cashOut = entryCashOut + Math.abs(amountGBP);
          if (date === dateKey) {
            cashOut += Math.abs(amountGBP);
          }
        }
        history[monthKey][date] = entry;
        if (referenceKey) {
          cfg.processedReferences.push(referenceKey);
          if (cfg.processedReferences.length > 500) {
            cfg.processedReferences = cfg.processedReferences.slice(-500);
          }
        }
        if (!newest || item.ts > newest) newest = item.ts;
      }
      if (newest) {
        cfg.lastTransactionAt = new Date(newest).toISOString();
      }
    }
    const existingNote = typeof existing.note === 'string' ? existing.note.trim() : '';
    const combinedPortfolioValue = fulfilled.reduce((sum, result) => {
      const value = Number(result.snapshot?.portfolioValue);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
    const payload = {
      end: Number.isFinite(combinedPortfolioValue) ? combinedPortfolioValue : user.portfolio,
      cashIn,
      cashOut
    };
    if (existing.preBaseline) {
      payload.preBaseline = true;
    }
    if (existingNote) {
      payload.note = existingNote;
    }
    history[ym][dateKey] = payload;
    if (Number.isFinite(combinedPortfolioValue)) {
      user.portfolio = combinedPortfolioValue;
    }
    user.portfolioCurrency = 'GBP';
    user.portfolioSource = 'trading212';
    user.lastPortfolioSyncAt = new Date().toISOString();
    if (user.initialPortfolio === undefined && Number.isFinite(combinedPortfolioValue)) {
      user.initialPortfolio = combinedPortfolioValue;
    }
    user.profileComplete = true;
    const { total: updatedTotal } = computeNetDepositsTotals(user, history);
    cfg.lastNetDeposits = Number.isFinite(Number(cfg.lastNetDeposits))
      ? Number(cfg.lastNetDeposits)
      : updatedTotal;
    refreshAnchors(user, history);
    cfg.lastSyncAt = new Date().toISOString();
    const rawAccounts = fulfilled.map(result => ({
      accountId: result.accountId,
      portfolio: result.snapshot?.raw || null,
      positions: result.snapshot?.positionsRaw || null,
      transactions: result.snapshot?.transactionsRaw || null,
      orders: result.ordersPayload?.raw || null
    }));
    const lastSnapshot = fulfilled[fulfilled.length - 1]?.snapshot;
    if (lastSnapshot?.baseUrl) {
      cfg.lastBaseUrl = lastSnapshot.baseUrl;
      if (!cfg.baseUrl) {
        cfg.baseUrl = lastSnapshot.baseUrl;
      }
      const lowerBase = lastSnapshot.baseUrl.toLowerCase();
      if (lowerBase.includes('demo.trading212.com') || lowerBase.includes('api-demo.trading212.com')) {
        cfg.mode = 'practice';
      } else if (lowerBase.includes('api.trading212.com') || lowerBase.includes('live.trading212.com')) {
        cfg.mode = 'live';
      }
    }
    if (lastSnapshot?.endpoint) {
      cfg.lastEndpoint = lastSnapshot.endpoint;
      if (!cfg.endpoint) {
        cfg.endpoint = lastSnapshot.endpoint;
      }
    }
    cfg.lastRaw = {
      accounts: rawAccounts
    };
    const positionEntries = fulfilled.flatMap(result => {
      const snapshot = result.snapshot || {};
      const inlinePositions = Array.isArray(snapshot.raw?.positions)
        ? snapshot.raw.positions
        : Array.isArray(snapshot.raw?.positions?.items)
          ? snapshot.raw.positions.items
          : Array.isArray(snapshot.raw?.portfolio?.positions)
            ? snapshot.raw.portfolio.positions
            : null;
      const effectivePositions = Array.isArray(snapshot.positions)
        ? snapshot.positions
        : Array.isArray(snapshot.positionsRaw?.items)
          ? snapshot.positionsRaw.items
          : Array.isArray(snapshot.positionsRaw)
            ? snapshot.positionsRaw
            : inlinePositions;
      if (!Array.isArray(effectivePositions)) return [];
      return effectivePositions.map(position => ({ position, accountId: result.accountId }));
    });
    let positionsMutated = false;
    const journal = ensureTradeJournal(user);
    const openTrades = [];
    for (const [tradeDate, items] of Object.entries(journal)) {
      for (const trade of items || []) {
        if (!trade || trade.status === 'closed') continue;
        openTrades.push({ tradeDate, trade });
      }
    }
    if (positionEntries.length) {
      const sortedPositions = positionEntries.slice().sort((a, b) => {
        const aSymbol = String(a?.position?.instrument?.ticker ?? a?.position?.ticker ?? a?.position?.symbol ?? '').toUpperCase();
        const bSymbol = String(b?.position?.instrument?.ticker ?? b?.position?.ticker ?? b?.position?.symbol ?? '').toUpperCase();
        return aSymbol.localeCompare(bSymbol);
      });
      for (const entry of sortedPositions) {
        const raw = entry.position;
        const accountId = entry.accountId || '';
        const instrument = raw?.instrument || {};
        const walletImpact = raw?.walletImpact || {};
        const rawName = instrument?.name ?? raw?.name ?? '';
        const rawIsin = instrument?.isin ?? raw?.isin ?? '';
        const rawTickerValue = normalizeTrading212TickerValue(
          raw?.ticker ??
          raw?.symbol ??
          instrument?.ticker ??
          instrument?.symbol ??
          rawIsin ??
          ''
        );
        const symbol = normalizeTrading212Symbol(rawTickerValue);
        if (!symbol) continue;
        const quantity = parseTradingNumber(
          raw?.quantity ??
          raw?.qty ??
          raw?.units ??
          raw?.size ??
          raw?.shares ??
          raw?.quantityAvailableForTrading ??
          raw?.availableQuantity
        );
        const entryPrice = parseTradingNumber(
          raw?.averagePricePaid ??
          raw?.averagePrice ??
          raw?.avgPrice ??
          raw?.openPrice ??
          raw?.price ??
          raw?.averagePrice?.value ??
          raw?.averagePrice?.amount
        );
        const currentPrice = parseTradingNumber(
          raw?.currentPrice ??
          raw?.lastPrice ??
          raw?.price ??
          raw?.marketPrice ??
          instrument?.currentPrice ??
          instrument?.price
        );
        const ppl = parseTradingNumber(
          raw?.ppl ??
          raw?.profitLoss ??
          raw?.unrealizedPnl ??
          raw?.pnl ??
          raw?.openPnl ??
          walletImpact?.unrealizedProfitLoss ??
          walletImpact?.unrealizedPnl ??
          walletImpact?.profitLoss ??
          walletImpact?.pnl
        );
        if (!Number.isFinite(quantity) || !Number.isFinite(entryPrice)) continue;
        const createdAt = Date.parse(raw?.createdAt || raw?.openDate || raw?.dateOpened || '');
        const createdAtDate = Number.isFinite(createdAt) ? new Date(createdAt) : runDate;
        const normalizedDate = dateKeyInTimezone(timezone, createdAtDate);
        const normalizedName = normalizeTrading212Name(rawName);
        const rawPositionId = raw?.id || raw?.positionId;
        const trading212Key = rawIsin
          ? `isin:${rawIsin.toUpperCase()}`
          : (normalizedName ? `name:${normalizedName}` : symbol);
        const trading212IdBase = rawPositionId ? String(rawPositionId) : trading212Key;
        const trading212Id = accountId ? `${accountId}:${trading212IdBase}` : trading212IdBase;
        const trading212PositionKey = accountId ? `${accountId}:${symbol}` : symbol;
        const { exactTradeEntry, aggregateTradeEntry } = findTrading212OpenTradeMatch(openTrades, {
          accountId,
          trading212Id,
          trading212IdBase,
          trading212Key,
          trading212PositionKey,
          symbol,
          rawIsin,
          normalizedName,
          rawTickerValue
        });
        const existingTradeEntry = exactTradeEntry || aggregateTradeEntry;
        const existingTrade = existingTradeEntry?.trade;
        const resolvedSymbol = existingTrade?.displaySymbol || existingTrade?.symbol || symbol;
        journal[normalizedDate] ||= [];
        const direction = quantity < 0 || String(raw?.side || '').toLowerCase() === 'short' ? 'short' : 'long';
        const stop = parseTradingNumber(
          raw?.stopLoss ??
          raw?.stopPrice ??
          raw?.stop ??
          raw?.stopLossPrice ??
          raw?.trailingStopLoss ??
          raw?.trailingStopPrice
        );
        const sizeUnits = Math.abs(quantity);
        const tradeCurrency = instrument?.currency ?? raw?.currency ?? walletImpact?.currency ?? 'GBP';
        const tradeDateKey = getNyDateKeyForDate(createdAtDate, false);
        let lowStop = null;
        try {
          const lowQuote = await fetchDailyLow(resolvedSymbol, tradeDateKey);
          lowStop = Number(lowQuote?.low);
        } catch (e) {
          lowStop = null;
        }
        const relatedOpenTrades = openTrades.filter(entry => {
          const trade = entry?.trade;
          if (!trade || trade.status === 'closed') return false;
          if (trade.trading212AccountId && accountId && trade.trading212AccountId !== accountId) return false;
          return (
            trade.trading212PositionKey === trading212PositionKey
            || trade.trading212Id === trading212Id
            || trade.symbol === symbol
            || (rawIsin && trade.trading212Isin === rawIsin)
            || (rawTickerValue && normalizeTrading212TickerValue(trade.trading212Ticker) === rawTickerValue)
          );
        });
        if (relatedOpenTrades.length) {
          const totalTrackedUnits = relatedOpenTrades.reduce((sum, entry) => {
            const units = Number(entry?.trade?.sizeUnits);
            return Number.isFinite(units) && units > 0 ? sum + units : sum;
          }, 0);
          for (const related of relatedOpenTrades) {
            updateTrading212LayerMetadata(related.trade, {
              symbol: related.trade?.displaySymbol || related.trade?.symbol || resolvedSymbol,
              trading212Id: related.trade?.trading212Id || trading212Id,
              trading212PositionKey,
              accountId,
              rawName,
              rawIsin,
              rawTickerValue,
              tradeCurrency,
              direction,
              currentPrice,
              stop,
              lowStop,
              user,
              rates
            });
          }
          const addToPosition = isTrading212AddToPosition({ sizeUnits: totalTrackedUnits }, sizeUnits);
          if (addToPosition) {
            const weightedNotional = relatedOpenTrades.reduce((sum, entry) => {
              const units = Number(entry?.trade?.sizeUnits);
              const tradeEntry = Number(entry?.trade?.entry);
              if (!Number.isFinite(units) || units <= 0 || !Number.isFinite(tradeEntry) || tradeEntry <= 0) return sum;
              return sum + (units * tradeEntry);
            }, 0);
            const previousUnits = totalTrackedUnits;
            const previousEntry = previousUnits > 0 ? weightedNotional / previousUnits : Number(existingTrade?.entry);
            const addedUnits = sizeUnits - previousUnits;
            const inferredAddedEntry = inferTrading212AddedEntryPrice(previousEntry, previousUnits, entryPrice, sizeUnits);
            const layerEntryPrice = Number.isFinite(inferredAddedEntry) ? inferredAddedEntry : entryPrice;
            const seedTrade = existingTrade || relatedOpenTrades[relatedOpenTrades.length - 1]?.trade;
            const layeredTrade = normalizeTradeMeta({
              ...seedTrade,
              id: crypto.randomBytes(8).toString('hex'),
              createdAt: createdAtDate.toISOString(),
              entry: layerEntryPrice,
              sizeUnits: addedUnits,
              symbol: resolvedSymbol,
              status: 'open',
              closeDate: undefined,
              closePrice: undefined,
              closedAt: undefined,
              partialCloses: undefined,
              trading212Id: `${trading212Id}#layer:${Date.now()}`
            });
            delete layeredTrade.realizedPnlGBP;
            delete layeredTrade.realizedPnlCurrency;
            delete layeredTrade.rMultiple;
            updateTrading212LayerMetadata(layeredTrade, {
              symbol: resolvedSymbol,
              trading212Id: layeredTrade.trading212Id,
              trading212PositionKey,
              accountId,
              rawName,
              rawIsin,
              rawTickerValue,
              tradeCurrency,
              direction,
              currentPrice,
              stop,
              lowStop,
              user,
              rates
            });
            if (Number.isFinite(ppl)) {
              layeredTrade.ppl = ppl;
            }
            journal[normalizedDate].push(layeredTrade);
            openTrades.push({ tradeDate: normalizedDate, trade: layeredTrade });
          }
          positionsMutated = true;
          continue;
        }
        const initialStop = Number.isFinite(stop) && stop > 0
          ? stop
          : (Number.isFinite(lowStop) ? lowStop : undefined);
        const trade = normalizeTradeMeta({
          id: crypto.randomBytes(8).toString('hex'),
          symbol: resolvedSymbol,
          currency: tradeCurrency,
          entry: entryPrice,
          stop: initialStop,
          currentStop: initialStop,
          currentStopSource: Number.isFinite(stop) && stop > 0 ? 't212' : undefined,
          currentStopStale: Number.isFinite(stop) && stop > 0 ? false : undefined,
          sizeUnits,
          lastSyncPrice: Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : undefined,
          riskPct: 0,
          perUnitRisk: Number.isFinite(initialStop) ? Math.abs(entryPrice - initialStop) : 0,
          riskAmountCurrency: 0,
          positionCurrency: entryPrice * sizeUnits,
          riskAmountGBP: 0,
          positionGBP: convertToGBP(entryPrice * sizeUnits, tradeCurrency, rates),
          portfolioGBPAtCalc: Number.isFinite(user.portfolio) ? user.portfolio : 0,
          portfolioCurrencyAtCalc: convertGBPToCurrency(Number.isFinite(user.portfolio) ? user.portfolio : 0, tradeCurrency, rates),
          createdAt: createdAtDate.toISOString(),
          direction,
          status: 'open',
          tradeType: 'day',
          assetClass: 'stocks',
          source: 'trading212',
          trading212Id,
          trading212PositionKey,
          trading212AccountId: accountId || undefined,
          trading212Name: rawName || undefined,
          trading212Isin: rawIsin || undefined,
          trading212Ticker: rawTickerValue || undefined,
          lastSyncPrice: Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : undefined,
          ppl: Number.isFinite(ppl) ? ppl : undefined
        });
        recalculateTradeRiskFromImportedStop(trade, user, rates);
        journal[normalizedDate].push(trade);
        positionsMutated = true;
      }
    } else if (fulfilled.length) {
      const closeDate = new Date(runDate).toISOString();
      for (const entry of openTrades) {
        const trade = entry.trade;
        if (!trade || (!trade.trading212Id && trade.source !== 'trading212')) continue;
        trade.status = 'closed';
        trade.closeDate = trade.closeDate || dateKeyInTimezone(timezone, runDate);
        trade.closedAt = trade.closedAt || closeDate;
        if (!Number.isFinite(Number(trade.closePrice)) && Number.isFinite(Number(trade.lastSyncPrice))) {
          trade.closePrice = Number(trade.lastSyncPrice);
        }
        positionsMutated = true;
      }
    }
    cfg.lastSyncAt = new Date().toISOString();
    if (!cfg.minuteSync) {
      cfg.minuteSync = true;
      scheduleTrading212Job(username, user);
    }
    delete cfg.cooldownUntil;
    if (rejected.length) {
      const rateLimit = rejected.find(err => err instanceof Trading212RateLimitError);
      if (rateLimit && rateLimit.retryAfter) {
        cfg.cooldownUntil = new Date(now + rateLimit.retryAfter * 1000).toISOString();
      }
      cfg.lastStatus = {
        ok: false,
        status: 207,
        message: `Trading 212 sync completed with ${rejected.length} account(s) failing.`
      };
    } else {
      cfg.lastStatus = { ok: true, status: 200 };
    }
    saveDB(db);
  } catch (e) {
    cfg.lastSyncAt = new Date().toISOString();
    const retryAfter = e instanceof Trading212Error ? e.retryAfter : null;
    if (retryAfter !== null && retryAfter !== undefined) {
      cfg.cooldownUntil = new Date(now + retryAfter * 1000).toISOString();
    }
    if (e instanceof Trading212Error && e.baseUrl) {
      cfg.lastBaseUrl = e.baseUrl;
    }
    if (e instanceof Trading212Error && e.endpoint) {
      cfg.lastEndpoint = e.endpoint;
    }
    cfg.lastStatus = {
      ok: false,
      status: e instanceof Trading212Error && e.status !== undefined ? e.status : undefined,
      retryAfter: retryAfter !== null && retryAfter !== undefined ? retryAfter : undefined,
      message: e && e.message ? e.message : 'Unknown Trading 212 error'
    };
    if (e instanceof Trading212Error && e.raw) {
      cfg.lastRaw = e.raw;
    }
    saveDB(db);
    console.error(`Trading 212 sync failed for ${username}`, e);
  }
}

function stopTrading212Job(username) {
  const job = trading212Jobs.get(username);
  if (job) {
    if (job.type === 'cron') {
      job.handle.stop();
    } else {
      clearInterval(job.handle);
    }
    trading212Jobs.delete(username);
  }
}

function scheduleTrading212Job(username, user) {
  stopTrading212Job(username);
  const cfg = user?.trading212;
  if (!cfg || !cfg.enabled || !getTrading212Accounts(cfg).length) return;
  const parsed = parseSnapshotTime(cfg.snapshotTime);
  const timezone = cfg.timezone || 'Europe/London';
  if (cfg.lastSyncAt) {
    const handle = setInterval(() => {
      syncTrading212ForUser(username, new Date());
    }, 30 * 1000);
    trading212Jobs.set(username, { type: 'interval', handle });
    return;
  }
  if (!parsed) return;
  const expression = `${parsed.minute} ${parsed.hour} * * *`;
  const handle = cron.schedule(expression, async () => {
    await syncTrading212ForUser(username, new Date());
  }, { timezone });
  trading212Jobs.set(username, { type: 'cron', handle });
}

async function fetchIbkrAuthStatus() {
  return requestIbkrEndpoint('/iserver/auth/status');
}

async function applyIbkrSnapshotToUser(user, snapshot, derivedStopByTicker = {}) {
  updateIbkrLivePositions(user, snapshot, derivedStopByTicker);
  updateIbkrLiveOrders(user, snapshot.orders || []);
  recordIbkrUserSnapshot(user, snapshot);
  const rates = await fetchRates();
  const snapshotDate = snapshot.meta?.ts ? new Date(snapshot.meta.ts) : new Date();
  const rootCurrency = snapshot.rootCurrency || 'GBP';
  const nextPortfolio = rootCurrency !== 'GBP'
    ? convertToGBP(snapshot.portfolioValue, rootCurrency, rates)
    : snapshot.portfolioValue;
  if (Number.isFinite(nextPortfolio)) {
    user.portfolio = nextPortfolio;
    user.portfolioCurrency = 'GBP';
    user.portfolioSource = 'ibkr';
    user.lastPortfolioSyncAt = new Date().toISOString();
    if (user.initialPortfolio === undefined) {
      user.initialPortfolio = nextPortfolio;
    }
  }
  const history = ensurePortfolioHistory(user);
  normalizePortfolioHistory(user);
  const dateKey = dateKeyInTimezone('Europe/London', snapshotDate);
  const ym = dateKey.slice(0, 7);
  history[ym] ||= {};
  const existing = history[ym][dateKey] || {};
  let cashIn = Number(existing.cashIn ?? 0);
  let cashOut = Number(existing.cashOut ?? 0);
  const netDepositsMeta = extractIbkrNetDeposits(snapshot.raw?.summary, snapshot.raw?.ledger);
  if (netDepositsMeta && Number.isFinite(netDepositsMeta.value)) {
    const netDepositsCurrency = netDepositsMeta.currency || rootCurrency || 'GBP';
    const netDepositsGBP = netDepositsCurrency !== 'GBP'
      ? convertToGBP(netDepositsMeta.value, netDepositsCurrency, rates)
      : netDepositsMeta.value;
    if (Number.isFinite(netDepositsGBP)) {
      const cfg = user.ibkr || {};
      const previousNetDeposits = Number.isFinite(Number(cfg.lastNetDeposits))
        ? Number(cfg.lastNetDeposits)
        : null;
      const delta = previousNetDeposits === null ? netDepositsGBP : netDepositsGBP - previousNetDeposits;
      if (Number.isFinite(delta) && delta !== 0) {
        if (delta > 0) {
          cashIn += delta;
        } else {
          cashOut += Math.abs(delta);
        }
      }
      cfg.lastNetDeposits = netDepositsGBP;
    }
  }
  history[ym][dateKey] = {
    ...existing,
    end: Number.isFinite(nextPortfolio) ? nextPortfolio : existing.end,
    cashIn,
    cashOut
  };
  if (existing.preBaseline) {
    history[ym][dateKey].preBaseline = true;
  }
  if (existing.note) {
    history[ym][dateKey].note = existing.note;
  }
  user.profileComplete = true;
  refreshAnchors(user, history);
  upsertIbkrTradesFromSnapshot(user, snapshot, derivedStopByTicker, rates, snapshotDate);
  const { updated: stopUpdates } = applyIbkrDerivedStopsToTrades(user, derivedStopByTicker);
  if (stopUpdates > 0) {
    console.info(`[IBKR] synced current stops for ${stopUpdates} trade(s)`);
  }
}

function updateIbkrConnectorStatus(cfg) {
  const lastHeartbeat = cfg.lastHeartbeatAt ? Date.parse(cfg.lastHeartbeatAt) : null;
  const now = Date.now();
  const isOnline = lastHeartbeat && Number.isFinite(lastHeartbeat) && (now - lastHeartbeat < 90 * 1000);
  const reportedStatus = cfg.lastConnectorStatus?.status;
  if (reportedStatus === 'disconnected' || reportedStatus === 'error') {
    cfg.connectionStatus = reportedStatus;
    return cfg.connectionStatus;
  }
  cfg.connectionStatus = isOnline ? 'online' : 'offline';
  return cfg.connectionStatus;
}

function applyIbkrHeartbeat(user, heartbeat) {
  const cfg = user?.ibkr;
  if (!cfg) return;
  cfg.enabled = true;
  cfg.mode = 'connector';
  cfg.lastHeartbeatAt = new Date().toISOString();
  cfg.lastConnectorStatus = {
    status: heartbeat.status || 'online',
    reason: heartbeat.reason || '',
    authStatus: heartbeat.authStatus || null,
    connectorVersion: heartbeat.connectorVersion || '',
    gatewayUrl: heartbeat.gatewayUrl || '',
    receivedAt: cfg.lastHeartbeatAt
  };
  cfg.connectionStatus = cfg.lastConnectorStatus.status;
}

async function syncIbkrForUser(username, runDate = new Date()) {
  const db = loadDB();
  const user = db.users[username];
  if (!user) return;
  ensureUserShape(user, username);
  const cfg = user.ibkr;
  if (!cfg || !cfg.enabled || cfg.mode !== 'connector') return;
  const status = updateIbkrConnectorStatus(cfg);
  if (status === 'offline') {
    cfg.lastStatus = {
      ok: false,
      status: 503,
      message: 'Connector offline. Please run the local IBKR connector.'
    };
    saveDB(db);
    return;
  }
  if (!cfg.lastSnapshotAt) {
    cfg.lastStatus = {
      ok: false,
      status: 404,
      message: 'No IBKR snapshots received yet.'
    };
  } else {
    cfg.lastStatus = { ok: true, status: 200 };
  }
  saveDB(db);
}

function stopIbkrJob(username) {
  const job = ibkrJobs.get(username);
  if (job) {
    clearInterval(job.handle);
    ibkrJobs.delete(username);
  }
}

function scheduleIbkrJob(username, user) {
  stopIbkrJob(username);
  const cfg = user?.ibkr;
  if (!cfg || !cfg.enabled || cfg.mode !== 'connector') return;
  const handle = setInterval(() => {
    syncIbkrForUser(username, new Date());
  }, 30 * 1000);
  ibkrJobs.set(username, { type: 'interval', handle });
}

function bootstrapIbkrSchedules() {
  const db = loadDB();
  for (const [username, user] of Object.entries(db.users || {})) {
    ensureUserShape(user, username);
    if (user?.ibkr?.enabled && user?.ibkr?.mode === 'connector') {
      scheduleIbkrJob(username, user);
    }
  }
}

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// static
app.use('/static', express.static(path.join(__dirname, 'static')));
app.get('/serviceWorker.js', (req,res)=>{
  res.set('Content-Type','application/javascript').send(fs.readFileSync(path.join(__dirname,'serviceWorker.js'),'utf-8'));
});
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// pages
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  const themeEnabled = String(process.env.NEXT_PUBLIC_UI_THEME_V1 ?? 'true').toLowerCase() !== 'false';
  fs.readFile(indexPath, 'utf8', (err, html) => {
    if (err) {
      res.sendFile(indexPath);
      return;
    }
    res.type('html').send(html.replace('__UI_THEME_V1__', themeEnabled ? 'true' : 'false'));
  });
});
app.get('/login.html', (req,res)=>{ res.sendFile(path.join(__dirname,'login.html')); });
app.get('/signup.html', (req,res)=>{ res.sendFile(path.join(__dirname,'signup.html')); });
app.get('/profile.html', (req,res)=>{ res.sendFile(path.join(__dirname,'profile.html')); });
app.get('/investor/login', (req, res) => {
  if (INVESTOR_PORTAL_DISABLED) return res.status(503).send('Investor portal disabled');
  res.sendFile(path.join(__dirname, 'investor-login.html'));
});
app.get('/investor/dashboard', (req, res) => {
  if (INVESTOR_PORTAL_DISABLED) return res.status(503).send('Investor portal disabled');
  res.sendFile(path.join(__dirname, 'investor-dashboard.html'));
});
app.get('/investor/activate', (req, res) => {
  if (INVESTOR_PORTAL_DISABLED) return res.status(503).send('Investor portal disabled');
  res.sendFile(path.join(__dirname, 'investor-activate.html'));
});
app.get('/investor/preview', (req, res) => {
  if (INVESTOR_PORTAL_DISABLED) return res.status(503).send('Investor portal disabled');
  res.sendFile(path.join(__dirname, 'investor-preview.html'));
});
app.get('/analytics.html', (req,res)=>{ res.sendFile(path.join(__dirname,'analytics.html')); });
app.get('/trades.html', (req,res)=>{ res.sendFile(path.join(__dirname,'trades.html')); });
app.get('/transactions.html', (req,res)=>{ res.sendFile(path.join(__dirname,'transactions.html')); });
app.get('/manifest.json', (req,res)=>{ res.sendFile(path.join(__dirname,'manifest.json')); });
app.get('/devtools.html', auth, (req, res) => {
  if (req.user?.guest) {
    return res.status(403).send('Guests cannot perform this action. Please create an account.');
  }
  if (req.username !== 'mevs.0404@gmail.com' && req.username !== 'dummy1') {
    return res.status(403).send('Forbidden');
  }
  res.sendFile(path.join(__dirname,'devtools.html'));
});

// --- auth api ---
function currentDateKey() {
  const now = new Date();
  const tzAdjusted = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return tzAdjusted.toISOString().slice(0, 10);
}

function createSession(db, username, res, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = username;
  saveDB(db);
  res.cookie('auth_token', token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: !!process.env.RENDER,
    maxAge: maxAgeMs
  });
}

app.post('/api/signup', asyncHandler(async (req,res)=>{
  const rawUsername = typeof req.body?.username === 'string' ? req.body.username : '';
  const password = req.body?.password;
  const username = rawUsername.trim();
  if (!username) {
    return res.status(400).json({ error: 'Choose a username to create your account.' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: 'Usernames must be at least 3 characters long.' });
  }
  if (/\s/.test(username)) {
    return res.status(400).json({ error: 'Usernames cannot contain spaces.' });
  }
  if (!isStrongPassword(password)) {
    return res.status(400).json({ error: 'Choose a stronger password (12+ characters with upper, lower, number, symbol).' });
  }
  const db = loadDB();
  if (db.users[username]) {
    return res.status(409).json({ error: 'That username is already in use.' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  db.users[username] = {
    username,
    passwordHash,
    nickname: '',
    portfolio: 0,
    initialPortfolio: 0,
    initialNetDeposits: 0,
    profileComplete: false,
    portfolioHistory: {},
    netDepositsAnchor: null,
    trading212: {},
    security: {}
  };
  ensureUserShape(db.users[username], username);
  saveDB(db);
  res.json({ ok: true, profileComplete: false });
}));

app.post('/api/auth/resend-verification', asyncHandler(async (req, res) => {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email : req.body?.username;
  const email = normalizeEmail(rawEmail);
  if (!email || !emailRegex().test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address before requesting a new link.' });
  }

  const db = loadDB();
  purgeExpiredVerifications(db);
  const user = db.users[email];
  if (!user) {
    return res.json({ ok: true, status: 'unknown', retryAfter: 60 });
  }

  const mutated = ensureUserShape(user);
  if (mutated) saveDB(db);

  if (user.emailVerified) {
    return res.json({ ok: true, status: 'already-verified' });
  }

  if (!user.security) user.security = {};
  if (!user.security.verification || typeof user.security.verification !== 'object') {
    user.security.verification = {};
  }
  const now = Date.now();
  const lastSent = user.security.verification.lastSentAt ? Date.parse(user.security.verification.lastSentAt) : NaN;
  if (!Number.isNaN(lastSent) && now - lastSent < 60000) {
    const waitSeconds = Math.ceil((60000 - (now - lastSent)) / 1000);
    res.set('Retry-After', String(waitSeconds));
    saveDB(db);
    return res.status(429).json({
      error: `Please wait ${waitSeconds} seconds before requesting another verification email.`,
      retryAfter: waitSeconds
    });
  }

  const token = createVerification(db, { type: 'signup', username: email });
  saveDB(db);

  const base = appBaseUrl(req);
  const verifyLink = `${base}/api/auth/verify-email?token=${token}`;
  try {
    await sendMail({
      to: email,
      subject: 'Confirm your P&L Calendar account',
      html: `<p>We noticed you requested another verification link.</p>
        <p>Click below to confirm your email address and finish setting up your account:</p>
        <p><a href="${verifyLink}">${verifyLink}</a></p>
        <p>If you didn't ask for this, you can ignore the message.</p>`
    });
  } catch (mailError) {
    console.error('Failed to resend verification email:', mailError);
    delete db.verifications[token];
    saveDB(db);
    return res.status(500).json({ error: 'We could not send a new verification email right now. Please try again soon.' });
  }

  user.security.verification.lastSentAt = new Date().toISOString();
  saveDB(db);

  res.json({ ok: true, status: 'sent', retryAfter: 60 });
}));

app.post('/api/auth/guest', asyncHandler(async (req, res) => {
  const retryAfter = applyGuestRateLimit(req);
  if (retryAfter !== null) {
    const waitSeconds = Math.ceil(retryAfter / 1000);
    res.set('Retry-After', String(waitSeconds));
    return res.status(429).json({
      error: `Too many guest sessions. Try again in ${waitSeconds} seconds.`,
      retryAfter: waitSeconds
    });
  }
  const db = loadDB();
  const now = Date.now();
  const expiresAt = new Date(now + GUEST_TTL_MS).toISOString();
  let username;
  let attempts = 0;
  while (!username || db.users[username]) {
    const suffix = crypto.randomBytes(4).toString('hex');
    username = `guest_${suffix}`;
    attempts += 1;
    if (attempts > 5) break;
  }
  if (!username || db.users[username]) {
    return res.status(500).json({ error: 'Unable to create guest session. Please try again.' });
  }
  const displayName = `Guest ${username.slice(-4)}`;
  db.users[username] = {
    username,
    displayName,
    guest: true,
    expiresAt,
    passwordHash: '',
    nickname: '',
    portfolio: 0,
    initialPortfolio: 0,
    initialNetDeposits: 0,
    profileComplete: false,
    portfolioHistory: {},
    netDepositsAnchor: null,
    trading212: {},
    security: {},
    tradeJournal: {}
  };
  ensureUserShape(db.users[username], username);
  createSession(db, username, res, GUEST_TTL_MS);
  res.json({ ok: true, profileComplete: false, isGuest: true });
}));

app.post('/api/login', async (req,res)=>{
  const rawUsername = typeof req.body?.username === 'string' ? req.body.username : '';
  const username = rawUsername.trim();
  const password = req.body?.password;
  if (!username || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const db = loadDB();
  const user = db.users[username];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  ensureUserShape(user, username);
  createSession(db, username, res);
  res.json({ ok: true, profileComplete: !!user.profileComplete });
});

app.post('/api/logout', (req,res)=>{
  const token = req.cookies?.auth_token;
  if (token) {
    const db = loadDB();
    delete db.sessions[token];
    saveDB(db);
  }
  res.clearCookie('auth_token');
  res.json({ ok: true });
});


app.post('/api/investor/auth/login', asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const db = loadDB();
  ensureInvestorTables(db);
  const login = db.investorLogins.find(l => l.email === email);
  if (!login || !login.passwordHash) return res.status(401).json({ error: 'Invalid credentials.' });
  const ok = await bcrypt.compare(password, login.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });
  const profile = db.investorProfiles.find(p => p.id === login.investorProfileId);
  if (!profile || profile.status !== 'active') return res.status(403).json({ error: 'Investor account inactive.' });
  const token = crypto.randomBytes(24).toString('hex');
  db.investorSessions[token] = {
    role: 'investor',
    investorProfileId: profile.id,
    masterUserId: profile.masterUserId,
    email
  };
  login.lastLoginAt = new Date().toISOString();
  saveDB(db);
  res.cookie('investor_session', token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: !!process.env.RENDER,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  res.json({ ok: true });
}));

app.post('/api/investor/auth/logout', (req, res) => {
  const token = req.cookies?.investor_session;
  const db = loadDB();
  ensureInvestorTables(db);
  if (token) {
    delete db.investorSessions[token];
    saveDB(db);
  }
  res.clearCookie('investor_session');
  res.json({ ok: true });
});

app.post('/api/investor/auth/activate', asyncHandler(async (req, res) => {
  const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!rawToken || !password) return res.status(400).json({ error: 'Token and password are required.' });
  if (!isStrongPassword(password)) return res.status(400).json({ error: 'Choose a stronger password (12+ characters with upper, lower, number, symbol).' });
  const db = loadDB();
  ensureInvestorTables(db);
  const invite = db.investorInvites.find(inv => inv.tokenHash === hashInviteToken(rawToken));
  if (!invite) return res.status(400).json({ error: 'Invalid invite token.' });
  if (invite.usedAt) return res.status(400).json({ error: 'Invite link has already been used.' });
  if (Date.parse(invite.expiresAt) <= Date.now()) return res.status(400).json({ error: 'Invite link has expired.' });
  const profile = db.investorProfiles.find(p => p.id === invite.investorProfileId);
  if (!profile) return res.status(404).json({ error: 'Investor profile not found.' });
  const passwordHash = await bcrypt.hash(password, 10);
  let login = db.investorLogins.find(l => l.investorProfileId === profile.id);
  if (!login) {
    login = {
      id: crypto.randomUUID(),
      investorProfileId: profile.id,
      email: `investor+${profile.id}@example.local`,
      passwordHash,
      lastLoginAt: null,
      createdAt: new Date().toISOString()
    };
    db.investorLogins.push(login);
  } else {
    login.passwordHash = passwordHash;
  }
  invite.usedAt = new Date().toISOString();
  saveDB(db);
  res.json({ ok: true });
}));

app.get('/api/investor/me', requireInvestorAuth, (req, res) => {
  res.json({
    displayName: req.investorProfile.displayName,
    status: req.investorProfile.status,
    permissions: req.investorPermissions,
    preview: req.investorAuth.role === 'investor_preview'
  });
});

app.get('/api/investor/summary', requireInvestorAuth, (req, res) => {
  const summary = computeInvestorSummary(req.investorDb, req.investorProfile.id);
  res.json(summary);
});

app.get('/api/investor/equity-curve', requireInvestorAuth, (req, res) => {
  const range = typeof req.query?.range === 'string' ? req.query.range : 'ALL';
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const days = range === '1M' ? 31 : range === '3M' ? 93 : range === '1Y' ? 366 : null;
  const minDate = days ? new Date(now.getTime() - (days * dayMs)).toISOString().slice(0, 10) : null;
  const points = req.investorDb.investorValuations
    .filter(v => v.investorProfileId === req.investorProfile.id)
    .filter(v => !minDate || v.valuationDate >= minDate)
    .sort((a, b) => String(a.valuationDate).localeCompare(String(b.valuationDate)));
  res.json({ points });
});

app.get('/api/investor/cashflows', requireInvestorAuth, (req, res) => {
  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 20;
  const cashflows = req.investorDb.investorCashflows
    .filter(c => c.investorProfileId === req.investorProfile.id)
    .sort((a, b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)))
    .slice(0, limit);
  res.json({ cashflows });
});

app.get('/api/master/investors', requireMasterAuth, requireMasterInvestorAccess, (req, res) => {
  const db = loadDB();
  ensureInvestorTables(db);
  const list = db.investorProfiles
    .filter(p => p.masterUserId === req.username)
    .map(profile => {
      const login = db.investorLogins.find(l => l.investorProfileId === profile.id) || null;
      const permissions = getInvestorPermissions(db, profile.id);
      return { ...profile, email: login?.email || null, lastLoginAt: login?.lastLoginAt || null, permissions };
    });
  res.json({ investors: list });
});

app.post('/api/master/investors', requireMasterAuth, requireMasterInvestorAccess, (req, res) => {
  if (rejectGuest(req, res)) return;
  const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.trim() : '';
  if (!displayName) return res.status(400).json({ error: 'display_name is required.' });
  const db = loadDB();
  ensureInvestorTables(db);
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  db.investorProfiles.push({ id, masterUserId: req.username, displayName, status: 'active', createdAt: nowIso });
  db.investorPermissions.push({ investorProfileId: id, canViewPositions: false, canViewTradeLog: false, canViewNotes: true, createdAt: nowIso });
  saveDB(db);
  res.status(201).json({ id, displayName, status: 'active' });
});

(typeof app.patch === 'function' ? app.patch.bind(app) : app.post.bind(app))('/api/master/investors/:id', requireMasterAuth, requireMasterInvestorAccess, (req, res) => {
  if (rejectGuest(req, res)) return;
  const db = loadDB();
  ensureInvestorTables(db);
  const profile = db.investorProfiles.find(p => p.id === req.params.id && p.masterUserId === req.username);
  if (!profile) return res.status(404).json({ error: 'Investor not found.' });
  const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.trim() : null;
  if (displayName) profile.displayName = displayName;
  if (req.body?.status === 'active' || req.body?.status === 'suspended') profile.status = req.body.status;
  const perms = getInvestorPermissions(db, profile.id);
  if (!db.investorPermissions.find(p => p.investorProfileId === profile.id)) db.investorPermissions.push(perms);
  if (req.body?.permissions && typeof req.body.permissions === 'object') {
    if (typeof req.body.permissions.can_view_positions === 'boolean') perms.canViewPositions = req.body.permissions.can_view_positions;
    if (typeof req.body.permissions.can_view_trade_log === 'boolean') perms.canViewTradeLog = req.body.permissions.can_view_trade_log;
    if (typeof req.body.permissions.can_view_notes === 'boolean') perms.canViewNotes = req.body.permissions.can_view_notes;
  }
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/master/investors/:id/invite', requireMasterAuth, requireMasterInvestorAccess, (req, res) => {
  if (rejectGuest(req, res)) return;
  const db = loadDB();
  ensureInvestorTables(db);
  const profile = db.investorProfiles.find(p => p.id === req.params.id && p.masterUserId === req.username);
  if (!profile) return res.status(404).json({ error: 'Investor not found.' });
  const rawToken = crypto.randomBytes(32).toString('hex');
  const nowIso = new Date().toISOString();
  const invite = {
    id: crypto.randomUUID(),
    investorProfileId: profile.id,
    tokenHash: hashInviteToken(rawToken),
    expiresAt: new Date(Date.now() + (72 * 60 * 60 * 1000)).toISOString(),
    usedAt: null,
    createdAt: nowIso
  };
  db.investorInvites.push(invite);
  saveDB(db);
  const inviteUrl = `${appBaseUrl(req)}/investor/activate?token=${rawToken}`;
  res.json({ inviteUrl });
});

app.post('/api/master/investors/:id/reset-password', requireMasterAuth, requireMasterInvestorAccess, asyncHandler(async (req, res) => {
  if (rejectGuest(req, res)) return;
  const db = loadDB();
  ensureInvestorTables(db);
  const profile = db.investorProfiles.find(p => p.id === req.params.id && p.masterUserId === req.username);
  if (!profile) return res.status(404).json({ error: 'Investor not found.' });
  const tempPassword = `${crypto.randomBytes(6).toString('base64url')}Aa1!`;
  let login = db.investorLogins.find(l => l.investorProfileId === profile.id);
  if (!login) {
    login = {
      id: crypto.randomUUID(),
      investorProfileId: profile.id,
      email: typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '',
      passwordHash: '',
      lastLoginAt: null,
      createdAt: new Date().toISOString()
    };
    if (!login.email) return res.status(400).json({ error: 'Email required when creating investor login.' });
    if (db.investorLogins.find(l => l.email === login.email)) return res.status(409).json({ error: 'Email already in use.' });
    db.investorLogins.push(login);
  }
  login.passwordHash = await bcrypt.hash(tempPassword, 10);
  saveDB(db);
  res.json({ tempPassword, email: login.email });
}));

app.get('/api/master/investors/:id/preview-token', requireMasterAuth, requireMasterInvestorAccess, (req, res) => {
  const db = loadDB();
  ensureInvestorTables(db);
  const profile = db.investorProfiles.find(p => p.id === req.params.id && p.masterUserId === req.username);
  if (!profile) return res.status(404).json({ error: 'Investor not found.' });
  const token = createSignedToken({
    role: 'investor_preview',
    investorProfileId: profile.id,
    masterUserId: req.username,
    email: null
  }, 5 * 60 * 1000);
  res.json({ token, expiresInSeconds: 300 });
});

app.post('/api/master/investors/:id/valuation', requireMasterAuth, requireMasterInvestorAccess, (req, res) => {
  if (rejectGuest(req, res)) return;
  const db = loadDB();
  ensureInvestorTables(db);
  const profile = db.investorProfiles.find(p => p.id === req.params.id && p.masterUserId === req.username);
  if (!profile) return res.status(404).json({ error: 'Investor not found.' });
  const valuationDate = typeof req.body?.date === 'string' ? req.body.date : '';
  const nav = Number(req.body?.nav);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valuationDate) || !Number.isFinite(nav)) {
    return res.status(400).json({ error: 'Valid date and nav are required.' });
  }
  const existing = db.investorValuations.find(v => v.investorProfileId === profile.id && v.valuationDate === valuationDate);
  if (existing) {
    existing.nav = nav;
  } else {
    db.investorValuations.push({
      id: crypto.randomUUID(),
      investorProfileId: profile.id,
      valuationDate,
      nav,
      pnlDay: null,
      pnlMtd: null,
      pnlYtd: null,
      createdAt: new Date().toISOString()
    });
  }
  saveDB(db);
  res.json({ ok: true });
});


// --- user data ---
app.get('/api/portfolio', auth, async (req,res)=>{
  const db = loadDB();
  const user = db.users[req.username];
  const mutated = ensureUserShape(user, req.username);
  const history = ensurePortfolioHistory(user);
  const normalized = normalizePortfolioHistory(user);
  const totals = computeNetDepositsTotals(user, history);
  const anchors = refreshAnchors(user, history);
  const rates = await fetchRates();
  const { trades, liveOpenPnlGBP, openLossPotentialGBP } = await buildActiveTrades(user, rates);
  const portfolioSnapshot = getCurrentPortfolioValue(user);
  const livePortfolio = portfolioSnapshot.value;
  if (mutated || normalized || anchors.mutated) saveDB(db);
  res.json({
    portfolio: portfolioSnapshot.value,
    portfolioSource: portfolioSnapshot.source,
    portfolioCurrency: portfolioSnapshot.currency,
    portfolioLastUpdatedAt: portfolioSnapshot.lastUpdatedAt,
    initialNetDeposits: totals.baseline,
    netDepositsTotal: totals.total,
    profileComplete: !!user.profileComplete,
    liveOpenPnl: liveOpenPnlGBP,
    openLossPotential: openLossPotentialGBP,
    livePortfolio,
    activeTrades: trades.length,
    isGuest: !!user.guest
  });
});

app.get('/api/portfolio/snapshot', auth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const mutated = ensureUserShape(user, req.username);
  const snapshot = getCurrentPortfolioValue(user);
  if (mutated) saveDB(db);
  res.json({
    portfolio: snapshot.value,
    portfolioSource: snapshot.source,
    portfolioCurrency: snapshot.currency,
    portfolioLastUpdatedAt: snapshot.lastUpdatedAt
  });
});

app.post('/api/portfolio', auth, (req,res)=>{
  const { portfolio } = req.body || {};
  if (typeof portfolio !== 'number' || isNaN(portfolio) || portfolio < 0) {
    return res.status(400).json({ error: 'Bad portfolio value' });
  }
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  user.portfolio = portfolio;
  user.portfolioCurrency = 'GBP';
  user.portfolioSource = 'manual';
  user.lastPortfolioSyncAt = new Date().toISOString();
  const history = ensurePortfolioHistory(user);
  const dateKey = currentDateKey();
  const ym = dateKey.slice(0, 7);
  history[ym] ||= {};
  const existing = history[ym][dateKey] || {};
  history[ym][dateKey] = {
    ...existing,
    end: portfolio
  };
  refreshAnchors(user, history);
  saveDB(db);
  res.json({ ok: true, portfolio });
});

app.get('/api/profile', auth, (req,res)=>{
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  let mutated = ensureUserShape(user, req.username);
  const history = ensurePortfolioHistory(user);
  if (normalizePortfolioHistory(user)) mutated = true;
  const { baseline, total } = computeNetDepositsTotals(user, history);
  const { baseline: portfolioBaseline, mutated: anchorMutated } = refreshAnchors(user, history);
  if (anchorMutated) mutated = true;
  if (mutated) saveDB(db);
  const portfolioSnapshot = getCurrentPortfolioValue(user);
  const portfolioValue = Number.isFinite(portfolioSnapshot.value)
    ? portfolioSnapshot.value
    : (portfolioBaseline || 0);
  res.json({
    profileComplete: !!user.profileComplete,
    portfolio: portfolioValue,
    portfolioSource: portfolioSnapshot.source,
    portfolioCurrency: portfolioSnapshot.currency,
    portfolioLastUpdatedAt: portfolioSnapshot.lastUpdatedAt,
    initialNetDeposits: baseline,
    netDepositsTotal: total,
    today: currentDateKey(),
    netDepositsAnchor: user.netDepositsAnchor || null,
    username: user.username || req.username,
    displayName: user.displayName || user.username || req.username,
    nickname: user.nickname || user.displayName || user.username || req.username,
    isGuest: !!user.guest,
    isAdmin: isAdminUser(user, req.username),
    investorAccountsEnabled: !!user.investorAccountsEnabled,
    investorPortalAvailable: !INVESTOR_PORTAL_DISABLED
  });
});

app.get('/api/prefs', auth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const mutated = ensureUserShape(user, req.username);
  if (mutated) saveDB(db);
  res.json(user.uiPrefs || {});
});

app.post('/api/prefs', auth, (req, res) => {
  const { defaultRiskPct, defaultRiskCurrency } = req.body || {};
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  if (Number.isFinite(Number(defaultRiskPct)) && Number(defaultRiskPct) > 0) {
    user.uiPrefs.defaultRiskPct = Number(defaultRiskPct);
  }
  if (typeof defaultRiskCurrency === 'string' && ['GBP', 'USD', 'EUR'].includes(defaultRiskCurrency)) {
    user.uiPrefs.defaultRiskCurrency = defaultRiskCurrency;
  }
  saveDB(db);
  res.json(user.uiPrefs || {});
});

app.get('/api/instrument-mappings/resolve', auth, (req, res) => {
  const brokerTicker = typeof req.query?.brokerTicker === 'string' ? req.query.brokerTicker.trim() : '';
  const brokerName = typeof req.query?.brokerName === 'string' ? req.query.brokerName.trim() : '';
  const currency = typeof req.query?.currency === 'string' ? req.query.currency.trim().toUpperCase() : '';
  const isin = typeof req.query?.isin === 'string' ? req.query.isin.trim().toUpperCase() : '';
  const uid = typeof req.query?.uid === 'string' ? req.query.uid.trim() : '';
  const instrument = {
    isin,
    uid,
    ticker: brokerTicker,
    currency,
    name: brokerName
  };
  const sourceKeyInput = typeof req.query?.sourceKey === 'string' ? req.query.sourceKey.trim() : '';
  const canCompute = Boolean(isin || uid || (brokerTicker && currency));
  const computedKey = canCompute ? computeSourceKey(instrument) : '';
  const sourceKey = computedKey || sourceKeyInput;
  if (!sourceKey) {
    return res.status(400).json({ error: 'Missing source key or instrument data.' });
  }
  const db = loadDB();
  const resolved = resolveInstrumentMapping(db, instrument, req.username);
  res.json({
    displayTicker: resolved.displayTicker || brokerTicker,
    displayName: resolved.displayName || brokerName,
    scope: resolved.scope
  });
});

app.post('/api/instrument-mappings/user', auth, asyncHandler(async (req, res) => {
  if (rejectGuest(req, res)) return;
  const brokerTicker = typeof req.body?.brokerTicker === 'string' ? req.body.brokerTicker.trim().toUpperCase() : '';
  const brokerName = typeof req.body?.brokerName === 'string' ? req.body.brokerName.trim() : '';
  const currency = typeof req.body?.currency === 'string' ? req.body.currency.trim().toUpperCase() : '';
  const isin = typeof req.body?.isin === 'string' ? req.body.isin.trim().toUpperCase() : '';
  const uid = typeof req.body?.uid === 'string' ? req.body.uid.trim() : '';
  const canonicalTicker = typeof req.body?.canonicalTicker === 'string'
    ? req.body.canonicalTicker.trim().toUpperCase()
    : '';
  const canonicalName = typeof req.body?.canonicalName === 'string' ? req.body.canonicalName.trim() : '';
  if (!canonicalTicker) {
    return res.status(400).json({ error: 'Canonical ticker is required.' });
  }
  const instrument = { isin, uid, ticker: brokerTicker, currency };
  const canCompute = Boolean(isin || uid || (brokerTicker && currency));
  const computedKey = canCompute ? computeSourceKey(instrument) : '';
  const providedKey = typeof req.body?.sourceKey === 'string' ? req.body.sourceKey.trim() : '';
  const sourceKey = computedKey || providedKey;
  if (!sourceKey) {
    return res.status(400).json({ error: 'Unable to compute source key.' });
  }
  const db = loadDB();
  const mappings = ensureInstrumentMappings(db);
  const { source, sourceKey: normalizedKey } = parseSourceKey(sourceKey);
  const now = new Date().toISOString();
  let mapping = mappings.find(item => (
    item.source === source
    && item.source_key === normalizedKey
    && item.scope === 'user'
    && item.user_id === req.username
  ));
  if (mapping) {
    mapping.broker_ticker = brokerTicker || mapping.broker_ticker;
    mapping.broker_name = brokerName || mapping.broker_name;
    mapping.currency = currency || mapping.currency;
    mapping.isin = isin || mapping.isin;
    mapping.canonical_ticker = canonicalTicker;
    mapping.canonical_name = canonicalName || mapping.canonical_name;
    mapping.status = 'active';
    mapping.updated_at = now;
  } else {
    mapping = {
      id: nextInstrumentMappingId(mappings),
      source,
      source_key: normalizedKey,
      scope: 'user',
      user_id: req.username,
      broker_ticker: brokerTicker,
      broker_name: brokerName,
      currency,
      isin,
      canonical_ticker: canonicalTicker,
      canonical_name: canonicalName,
      status: 'active',
      confidence: 0.6,
      created_at: now,
      updated_at: now
    };
    mappings.push(mapping);
  }
  saveDB(db);
  res.json(mapping);
}));

app.post('/api/instrument-mappings/promote', auth, asyncHandler(async (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!isAdminUser(user, req.username)) {
    return res.status(403).json({ error: 'Admin privileges required.' });
  }
  const mappingId = Number(req.body?.mappingId);
  if (!Number.isFinite(mappingId)) {
    return res.status(400).json({ error: 'Mapping id is required.' });
  }
  const mappings = ensureInstrumentMappings(db);
  const sourceMapping = mappings.find(mapping => Number(mapping.id) === mappingId);
  if (!sourceMapping) {
    return res.status(404).json({ error: 'Mapping not found.' });
  }
  const conflict = mappings.find(mapping => (
    mapping.scope === 'global'
    && mapping.status === 'active'
    && mapping.source === sourceMapping.source
    && mapping.source_key === sourceMapping.source_key
    && mapping.canonical_ticker !== sourceMapping.canonical_ticker
  ));
  if (conflict) {
    return res.status(409).json({ error: 'Conflicting global mapping already exists.' });
  }
  const now = new Date().toISOString();
  let globalMapping = mappings.find(mapping => (
    mapping.scope === 'global'
    && mapping.source === sourceMapping.source
    && mapping.source_key === sourceMapping.source_key
  ));
  if (globalMapping) {
    globalMapping.broker_ticker = sourceMapping.broker_ticker || globalMapping.broker_ticker;
    globalMapping.broker_name = sourceMapping.broker_name || globalMapping.broker_name;
    globalMapping.currency = sourceMapping.currency || globalMapping.currency;
    globalMapping.isin = sourceMapping.isin || globalMapping.isin;
    globalMapping.canonical_ticker = sourceMapping.canonical_ticker;
    globalMapping.canonical_name = sourceMapping.canonical_name || globalMapping.canonical_name;
    globalMapping.status = 'active';
    globalMapping.user_id = null;
    globalMapping.updated_at = now;
  } else {
    globalMapping = {
      id: nextInstrumentMappingId(mappings),
      source: sourceMapping.source,
      source_key: sourceMapping.source_key,
      scope: 'global',
      user_id: null,
      broker_ticker: sourceMapping.broker_ticker,
      broker_name: sourceMapping.broker_name,
      currency: sourceMapping.currency,
      isin: sourceMapping.isin,
      canonical_ticker: sourceMapping.canonical_ticker,
      canonical_name: sourceMapping.canonical_name,
      status: 'active',
      confidence: sourceMapping.confidence ?? 0.6,
      created_at: now,
      updated_at: now
    };
    mappings.push(globalMapping);
  }
  saveDB(db);
  res.json(globalMapping);
}));

app.get('/api/transactions/prefs', auth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const mutated = ensureUserShape(user, req.username);
  if (mutated) saveDB(db);
  res.json(user.transactionPrefs || {});
});

app.post('/api/transactions/prefs', auth, (req, res) => {
  const { splitProfits } = req.body || {};
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  if (typeof splitProfits === 'boolean') {
    user.transactionPrefs.splitProfits = splitProfits;
  }
  saveDB(db);
  res.json(user.transactionPrefs || {});
});

app.get('/api/transactions/profiles', auth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const mutated = ensureUserShape(user, req.username);
  if (mutated) saveDB(db);
  res.json({ profiles: user.transactionProfiles || [] });
});

app.post('/api/transactions/profiles', auth, (req, res) => {
  const { profiles } = req.body || {};
  if (!Array.isArray(profiles)) {
    return res.status(400).json({ error: 'Profiles must be an array' });
  }
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const cleaned = profiles.map(profile => {
    if (!profile || typeof profile !== 'object') return null;
    const name = typeof profile.name === 'string' ? profile.name.trim() : '';
    if (!name) return null;
    const note = typeof profile.note === 'string' ? profile.note.trim() : '';
    const id = typeof profile.id === 'string' ? profile.id : `${Date.now()}-${Math.random()}`;
    return { id, name, note };
  }).filter(Boolean);
  user.transactionProfiles = cleaned;
  saveDB(db);
  res.json({ profiles: user.transactionProfiles });
});

app.post('/api/profile', auth, (req,res)=>{
  const { portfolio, netDeposits, date, nickname } = req.body || {};
  if (portfolio === '' || portfolio === null || portfolio === undefined) {
    return res.status(400).json({ error: 'Portfolio value is required' });
  }
  const portfolioNumber = Number(portfolio);
  if (!Number.isFinite(portfolioNumber) || portfolioNumber < 0) {
    return res.status(400).json({ error: 'Invalid portfolio value' });
  }
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  if (nickname !== undefined) {
    const normalized = normalizeNickname(nickname);
    if (normalized.error) {
      return res.status(400).json({ error: normalized.error });
    }
    if (!isNicknameAvailable(db, normalized.value, req.username)) {
      return res.status(409).json({ error: 'That nickname is already taken.' });
    }
    user.nickname = normalized.value;
  }
  const wasComplete = !!user.profileComplete;
  const history = ensurePortfolioHistory(user);
  normalizePortfolioHistory(user);
  const { baseline: previousBaseline, total: previousTotal } = computeNetDepositsTotals(user, history);
  let netDepositsNumber;
  const netDepositsProvided = !(netDeposits === '' || netDeposits === null || netDeposits === undefined);
  if (!wasComplete) {
    if (!netDepositsProvided) {
      return res.status(400).json({ error: 'Net deposits value is required' });
    }
    netDepositsNumber = Number(netDeposits);
    if (!Number.isFinite(netDepositsNumber)) {
      return res.status(400).json({ error: 'Invalid net deposits value' });
    }
  } else if (!netDepositsProvided) {
    netDepositsNumber = previousTotal;
  } else {
    netDepositsNumber = Number(netDeposits);
    if (!Number.isFinite(netDepositsNumber)) {
      return res.status(400).json({ error: 'Invalid net deposits value' });
    }
  }
  const resetNetDeposits = wasComplete && netDepositsProvided && netDepositsNumber !== previousTotal;
  const netDelta = resetNetDeposits
    ? 0
    : netDepositsNumber - (wasComplete ? previousTotal : previousBaseline);
  const targetDate = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
    ? date
    : currentDateKey();
  if (!user.netDepositsAnchor || resetNetDeposits) {
    user.netDepositsAnchor = targetDate;
  }
  const ym = targetDate.slice(0, 7);
  history[ym] ||= {};
  const existing = history[ym][targetDate] || {};
  let cashIn = Number.isFinite(existing.cashIn) ? Number(existing.cashIn) : 0;
  let cashOut = Number.isFinite(existing.cashOut) ? Number(existing.cashOut) : 0;
  if (resetNetDeposits) {
    cashIn = 0;
    cashOut = 0;
  } else if (!wasComplete) {
    if (netDepositsNumber > 0) {
      cashIn += netDepositsNumber;
    } else if (netDepositsNumber < 0) {
      cashOut += Math.abs(netDepositsNumber);
    }
  } else if (netDelta !== 0) {
    if (netDelta > 0) {
      cashIn += netDelta;
    } else {
      cashOut += Math.abs(netDelta);
    }
  }
  history[ym][targetDate] = {
    end: portfolioNumber,
    cashIn,
    cashOut
  };
  if (!wasComplete) {
    user.initialNetDeposits = 0;
  } else if (resetNetDeposits) {
    user.initialNetDeposits = netDepositsNumber;
  }
  user.profileComplete = true;
  const { config: tradingCfg } = ensureTrading212Config(user);
  if (resetNetDeposits) {
    normalizePortfolioHistory(user);
  }
  const totals = computeNetDepositsTotals(user, history);
  tradingCfg.lastNetDeposits = totals.total;
  refreshAnchors(user, history);
  saveDB(db);
  res.json({ ok: true, netDeposits: totals.total });
});

app.post('/api/account/password', auth, async (req, res) => {
  if (rejectGuest(req, res)) return;
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = req.body?.password ?? req.body?.newPassword;
  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({ error: 'Passwords must be 12+ characters and include upper, lower, number, and symbol.' });
  }
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) {
    return res.status(403).json({ error: 'Your current password is incorrect.' });
  }
  const samePassword = await bcrypt.compare(newPassword, user.passwordHash);
  if (samePassword) {
    return res.status(400).json({ error: 'Choose a password you have not used before.' });
  }
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.security ||= {};
  user.security.passwordUpdatedAt = new Date().toISOString();
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/account/nickname', auth, (req, res) => {
  if (rejectGuest(req, res)) return;
  if (req.body?.nickname === undefined) {
    return res.status(400).json({ error: 'Nickname is required.' });
  }
  const normalized = normalizeNickname(req.body.nickname);
  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const nickname = normalized.value;
  if (!isNicknameAvailable(db, nickname, req.username)) {
    return res.status(409).json({ error: 'That nickname is already taken.' });
  }
  user.nickname = nickname;
  saveDB(db);
  res.json({ ok: true, nickname });
});

app.get('/api/master/settings', auth, (req, res) => {
  if (rejectGuest(req, res)) return;
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  res.json({
    investor_portal_enabled: !!user.investorAccountsEnabled,
    investor_portal_enabled_at: user.investorPortalEnabledAt || null
  });
});

(typeof app.patch === 'function' ? app.patch.bind(app) : app.post.bind(app))('/api/master/settings', auth, (req, res) => {
  if (rejectGuest(req, res)) return;
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  if (typeof req.body?.investor_portal_enabled === 'boolean') {
    user.investorAccountsEnabled = req.body.investor_portal_enabled;
    user.investorPortalEnabledAt = user.investorAccountsEnabled ? new Date().toISOString() : null;
  }
  saveDB(db);
  res.json({
    investor_portal_enabled: !!user.investorAccountsEnabled,
    investor_portal_enabled_at: user.investorPortalEnabledAt || null
  });
});

app.post('/api/account/investor-accounts', auth, (req, res) => {
  if (rejectGuest(req, res)) return;
  const enabled = !!req.body?.enabled;
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  user.investorAccountsEnabled = enabled;
  user.investorPortalEnabledAt = enabled ? new Date().toISOString() : null;
  saveDB(db);
  res.json({ ok: true, investorAccountsEnabled: !!user.investorAccountsEnabled, investorPortalEnabledAt: user.investorPortalEnabledAt });
});


app.delete('/api/profile', auth, (req, res) => {
  if (rejectGuest(req, res)) return;
  const db = loadDB();
  const username = req.username;
  const user = db.users[username];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  stopTrading212Job(username);
  stopIbkrJob(username);
  delete db.users[username];
  const tokens = Object.keys(db.sessions);
  for (const token of tokens) {
    if (db.sessions[token] === username) {
      delete db.sessions[token];
    }
  }
  saveDB(db);
  res.clearCookie('auth_token');
  res.json({ ok: true });
});

app.get('/api/integrations/trading212', auth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const cfg = user.trading212 || {};
  const parsed = parseSnapshotTime(cfg.snapshotTime);
  const accountSummaries = Array.isArray(cfg.accounts)
    ? cfg.accounts.map((account, index) => ({
      id: account?.id || `account-${index + 1}`,
      label: account?.label || '',
      hasApiKey: !!account?.apiKey,
      hasApiSecret: !!account?.apiSecret,
      mode: account?.mode || cfg.mode || 'live'
    }))
    : [];
  const hasApiKey = accountSummaries.some(account => account.hasApiKey);
  const hasApiSecret = accountSummaries.some(account => account.hasApiSecret);
  res.json({
    enabled: !!cfg.enabled,
    snapshotTime: parsed ? `${parsed.hour}:${parsed.minute}` : '21:00',
    mode: cfg.mode || 'live',
    timezone: cfg.timezone || 'Europe/London',
    hasApiKey,
    hasApiSecret,
    accounts: accountSummaries,
    baseUrl: cfg.baseUrl || '',
    endpoint: cfg.endpoint || '/api/v0/equity/portfolio/summary',
    lastBaseUrl: cfg.lastBaseUrl || null,
    lastEndpoint: cfg.lastEndpoint || null,
    lastSyncAt: cfg.lastSyncAt || null,
    lastStatus: cfg.lastStatus || null,
    lastRaw: cfg.lastRaw || null,
    cooldownUntil: cfg.cooldownUntil || null
  });
});

app.get('/api/integrations/trading212/raw', auth, async (req, res) => {
  if (req.username !== 'mevs.0404@gmail.com' && req.username !== 'dummy1') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const cfg = user.trading212 || {};
  const accounts = getTrading212Accounts(cfg);
  if (accounts.length) {
    const results = await Promise.allSettled(accounts.map(async (account, index) => {
      const accountId = account.id || `account-${index + 1}`;
      const accountConfig = {
        ...cfg,
        apiKey: account.apiKey,
        apiSecret: account.apiSecret,
        mode: account.mode || cfg.mode,
        baseUrl: account.baseUrl || cfg.baseUrl
      };
      try {
        const payload = await fetchTrading212Orders(accountConfig, req.username, { bypassCache: true, accountId });
        return { accountId, payload };
      } catch (error) {
        const wrapped = error instanceof Error ? error : new Trading212Error('Unable to fetch orders.');
        wrapped.accountId = accountId;
        throw wrapped;
      }
    }));
    const lastRaw = cfg.lastRaw && typeof cfg.lastRaw === 'object' ? cfg.lastRaw : {};
    const rawAccounts = Array.isArray(lastRaw.accounts) ? lastRaw.accounts : [];
    const mergedAccounts = accounts.map((account, index) => {
      const accountId = account.id || `account-${index + 1}`;
      const existing = rawAccounts.find(entry => entry?.accountId === accountId) || {};
      const result = results.find(item => item.status === 'fulfilled' && item.value.accountId === accountId);
      const error = results.find(item => item.status === 'rejected' && item.reason?.accountId === accountId)?.reason;
      const ordersPayload = result?.value?.payload?.raw ?? null;
      return {
        accountId,
        label: account.label || '',
        portfolio: existing.portfolio ?? null,
        positions: existing.positions ?? null,
        transactions: existing.transactions ?? null,
        orders: ordersPayload ?? existing.orders ?? null,
        ordersError: error ? (error.message || 'Unable to fetch orders.') : null
      };
    });
    cfg.lastRaw = { accounts: mergedAccounts };
    saveDB(db);
    const primary = mergedAccounts[0] || {};
    return res.json({
      portfolio: primary.portfolio ?? null,
      positions: primary.positions ?? null,
      transactions: primary.transactions ?? null,
      orders: primary.orders ?? null,
      ordersError: primary.ordersError ?? null,
      accounts: mergedAccounts
    });
  }
  const raw = cfg.lastRaw || { portfolio: null, positions: null, transactions: null, orders: null };
  return res.json({ ...raw, ordersError: null });
});

app.get('/api/downloads/ibkr-connector/windows/meta', auth, (req, res) => {
  const meta = loadIbkrInstallerMeta();
  res.json(meta);
});

app.get('/api/downloads/ibkr-connector/windows/latest', auth, (req, res) => {
  const meta = loadIbkrInstallerMeta();
  if (IBKR_CONNECTOR_WINDOWS_URL || IBKR_INSTALLER_URL) {
    return res.redirect(IBKR_CONNECTOR_WINDOWS_URL || IBKR_INSTALLER_URL);
  }
  const resolved = resolveIbkrInstallerPath();
  if (!resolved.path || !fs.existsSync(resolved.path)) {
    return res.status(404).json({
      error: 'Installer not available.',
      details: {
        installerUrlSet: Boolean(IBKR_CONNECTOR_WINDOWS_URL || IBKR_INSTALLER_URL),
        attemptedPath: resolved.path,
        source: resolved.source,
        instructions: 'Set IBKR_INSTALLER_URL to a hosted installer asset or place assets/installers/VeracityInstaller.exe in the repo.'
      }
    });
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${meta.filename}"`);
  return res.sendFile(path.resolve(resolved.path));
});

app.get('/api/integrations/ibkr/installer', auth, (req, res) => {
  if (IBKR_INSTALLER_URL) {
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.redirect(IBKR_INSTALLER_URL);
  }
  const resolved = resolveIbkrInstallerPath();
  if (!resolved.path || !fs.existsSync(resolved.path)) {
    return res.status(500).json({
      error: 'Installer not configured.',
      details: {
        installerUrlSet: Boolean(IBKR_INSTALLER_URL),
        attemptedPath: resolved.path,
        source: resolved.source,
        instructions: 'Set IBKR_INSTALLER_URL to a GitHub Release asset download URL.'
      }
    });
  }
  return res.download(resolved.path, 'VeracitySetup.exe');
});

app.get('/api/integrations/ibkr/installer/download', auth, (req, res) => {
  if (!IBKR_INSTALLER_URL) {
    return res.status(500).json({
      error: 'Installer not configured.',
      details: {
        installerUrlSet: false,
        instructions: 'Set IBKR_INSTALLER_URL to a GitHub Release asset download URL.'
      }
    });
  }
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.redirect(IBKR_INSTALLER_URL);
});

app.get('/api/integrations/ibkr/installer/status', auth, (req, res) => {
  const resolved = resolveIbkrInstallerPath();
  res.json({
    installerUrlSet: Boolean(IBKR_INSTALLER_URL),
    attemptedPath: resolved.path,
    localExists: resolved.path ? fs.existsSync(resolved.path) : false
  });
});

app.get('/api/integrations/ibkr/raw', auth, (req, res) => {
  if (req.username !== 'mevs.0404@gmail.com' && req.username !== 'dummy1') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const cfg = user.ibkr || {};
  const lastUserSnapshot = Array.isArray(user.ibkrSnapshots) && user.ibkrSnapshots.length
    ? user.ibkrSnapshots[user.ibkrSnapshots.length - 1]
    : null;
  const brokerSnapshot = lastUserSnapshot ? null : getLatestBrokerSnapshot(db, req.username, 'IBKR');
  const snapshot = lastUserSnapshot || brokerSnapshot;
  const snapshotRaw = lastUserSnapshot?.raw || {};
  const rawStore = cfg.raw && typeof cfg.raw === 'object' ? cfg.raw : {};
  const legacyRaw = cfg.lastRaw || {};
  const accountsRaw = snapshotRaw.accounts ?? rawStore.accountsRaw ?? legacyRaw.accounts ?? null;
  const summaryRaw = snapshotRaw.summary ?? rawStore.summaryRaw ?? legacyRaw.summary ?? null;
  const ledgerRaw = snapshotRaw.ledger ?? rawStore.ledgerRaw ?? legacyRaw.ledger ?? null;
  const positionsRaw = snapshotRaw.positions ?? rawStore.positionsRaw ?? legacyRaw.positions ?? null;
  const ordersRaw = snapshotRaw.orders ?? rawStore.ordersRaw ?? legacyRaw.orders ?? null;
  const accountId = cfg.accountId
    || snapshot?.accountId
    || pickIbkrAccountId(extractIbkrAccounts(accountsRaw), cfg.accountId)
    || '';
  const snapshotPositions = Array.isArray(snapshot?.positions) ? snapshot.positions : null;
  const snapshotOrders = Array.isArray(snapshot?.orders) ? snapshot.orders : null;
  const livePositions = Array.isArray(cfg.live?.positions) ? cfg.live.positions : cfg.livePositions;
  const liveOrders = Array.isArray(cfg.live?.orders) ? cfg.live.orders : cfg.liveOrders;
  const portfolioValue = Number.isFinite(Number(snapshot?.portfolioValue))
    ? Number(snapshot.portfolioValue)
    : (Number.isFinite(Number(cfg.lastPortfolioValue)) ? Number(cfg.lastPortfolioValue) : null);
  const rootCurrency = snapshot?.rootCurrency || cfg.lastPortfolioCurrency || null;
  const summary = (portfolioValue !== null || rootCurrency || summaryRaw)
    ? {
      portfolioValue,
      rootCurrency,
      raw: summaryRaw
    }
    : null;
  const accounts = accountId || accountsRaw
    ? {
      accountId,
      raw: accountsRaw
    }
    : null;
  const positions = positionsRaw
    ?? snapshotPositions
    ?? (Array.isArray(livePositions) ? livePositions : null);
  const orders = ordersRaw
    ?? snapshotOrders
    ?? (Array.isArray(liveOrders) ? liveOrders : null);
  const ledger = ledgerRaw ?? (snapshot ? { message: 'Ledger payload not available yet.' } : null);
  const hasSnapshot = Boolean(snapshot || positions || orders || accounts || summary || ledger);
  if (!hasSnapshot) {
    console.debug('[IBKR] DevTools payload requested without any stored snapshot.');
  }
  res.json({
    accounts,
    summary,
    ledger,
    positions,
    orders,
    ibkr: {
      lastSnapshotTs: snapshot?.meta?.ts || cfg.lastSnapshotAt || null,
      lastHeartbeatAt: cfg.lastHeartbeatAt || null
    },
    message: hasSnapshot ? null : 'No IBKR snapshot received yet.'
  });
});

app.use('/api/integrations/ibkr/gateway', auth, (req, res) => {
  res.status(410).json({
    error: 'IBKR gateway proxy has been disabled.',
    details: 'Use the local IBKR connector to talk to the Client Portal Gateway.'
  });
});

app.get('/api/integrations/ibkr', auth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const cfg = user.ibkr || {};
  if (cfg.mode === 'connector') {
    updateIbkrConnectorStatus(cfg);
  }
  const activeToken = getActiveIbkrConnectorToken(db, req.username);
  const activeKey = getActiveIbkrConnectorKey(db, req.username);
  const connectorOnline = cfg.connectionStatus === 'online';
  res.json({
    enabled: !!cfg.enabled,
    mode: cfg.mode || 'connector',
    accountId: cfg.accountId || '',
    connectionStatus: cfg.connectionStatus || 'disconnected',
    lastHeartbeatAt: cfg.lastHeartbeatAt || null,
    lastSnapshotAt: cfg.lastSnapshotAt || null,
    lastSyncAt: cfg.lastSyncAt || null,
    lastStatus: cfg.lastStatus || null,
    lastSessionCheckAt: cfg.lastSessionCheckAt || null,
    lastPortfolioValue: Number.isFinite(Number(cfg.lastPortfolioValue)) ? Number(cfg.lastPortfolioValue) : null,
    lastPortfolioCurrency: cfg.lastPortfolioCurrency || null,
    lastConnectorStatus: cfg.lastConnectorStatus || null,
    connectorOnline,
    lastDisconnectReason: cfg.lastConnectorStatus?.reason || null,
    connectorConfigured: !!activeToken || !!activeKey
  });
});

app.get('/api/integrations/ibkr/positions', auth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const cfg = user.ibkr || {};
  const snapshot = getLatestBrokerSnapshot(db, req.username, 'IBKR');
  const snapshotPositions = Array.isArray(snapshot?.positions)
    ? snapshot.positions
    : normalizeIbkrPayloadArray(snapshot?.raw?.positions);
  const sourcePositions = snapshotPositions.length
    ? snapshotPositions
    : (Array.isArray(cfg.livePositions) ? cfg.livePositions : []);
  const positions = buildIbkrActivePositionSummaries(sourcePositions || []);
  let updatedAt = cfg.lastSnapshotAt || cfg.lastHeartbeatAt || null;
  if (snapshot) {
    updatedAt = snapshot.meta?.ts || snapshot.timestamp || updatedAt;
  }
  res.json({
    positions,
    updatedAt
  });
});

app.get('/api/integrations/ibkr/orders', auth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const cfg = user.ibkr || {};
  let orders = Array.isArray(cfg.liveOrders) ? cfg.liveOrders : [];
  let updatedAt = cfg.lastSnapshotAt || cfg.lastHeartbeatAt || null;
  if (!orders.length) {
    const snapshot = getLatestBrokerSnapshot(db, req.username, 'IBKR');
    if (snapshot) {
      orders = normalizeIbkrSnapshotOrders(snapshot.orders || []);
      updatedAt = snapshot.meta?.ts || snapshot.timestamp || updatedAt;
    }
  }
  res.json({
    orders,
    updatedAt
  });
});

app.use('/api/integrations/ibkr/connector', (req, res, next) => {
  res.set('X-Veracity-Instance', INSTANCE_ID);
  const startedAt = Date.now();
  res.on('finish', () => {
    console.log(`[IBKR][${INSTANCE_ID}] ${req.method} ${req.originalUrl} ${res.statusCode} (${Date.now() - startedAt}ms)`);
  });
  next();
});

app.post('/api/integrations/ibkr', auth, asyncHandler(async (req, res) => {
  if (rejectGuest(req, res)) return;
  if (!checkIbkrRateLimit(`${req.username}:ibkr-config`, res)) return;
  const { enabled, accountId, oauthTokens, runNow } = req.body || {};
  if (oauthTokens) {
    return res.status(400).json({ error: 'IBKR OAuth is no longer supported. Use the local connector.' });
  }
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const cfg = user.ibkr;
  if (typeof enabled === 'boolean') {
    cfg.enabled = enabled;
  }
  if (typeof accountId === 'string') {
    cfg.accountId = accountId.trim();
  }
  cfg.mode = 'connector';
  saveDB(db);
  scheduleIbkrJob(req.username, user);
  if (runNow && cfg.enabled) {
    await syncIbkrForUser(req.username);
  }
  const activeToken = getActiveIbkrConnectorToken(db, req.username);
  const activeKey = getActiveIbkrConnectorKey(db, req.username);
  const connectorOnline = cfg.connectionStatus === 'online';
  res.json({
    enabled: !!cfg.enabled,
    mode: cfg.mode || 'connector',
    accountId: cfg.accountId || '',
    connectionStatus: cfg.connectionStatus || 'disconnected',
    lastHeartbeatAt: cfg.lastHeartbeatAt || null,
    lastSnapshotAt: cfg.lastSnapshotAt || null,
    lastSyncAt: cfg.lastSyncAt || null,
    lastStatus: cfg.lastStatus || null,
    lastSessionCheckAt: cfg.lastSessionCheckAt || null,
    lastPortfolioValue: Number.isFinite(Number(cfg.lastPortfolioValue)) ? Number(cfg.lastPortfolioValue) : null,
    lastPortfolioCurrency: cfg.lastPortfolioCurrency || null,
    lastConnectorStatus: cfg.lastConnectorStatus || null,
    connectorOnline,
    lastDisconnectReason: cfg.lastConnectorStatus?.reason || null,
    connectorConfigured: !!activeToken || !!activeKey
  });
}));

app.post('/api/integrations/ibkr/connector/token', auth, asyncHandler(async (req, res) => {
  if (rejectGuest(req, res)) return;
  if (!checkIbkrRateLimit(`${req.username}:ibkr-connector-token`, res)) return;
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const cfg = user.ibkr;
  const { rawToken, expiresAt } = await createIbkrConnectorToken(db, req.username);
  cfg.enabled = true;
  cfg.mode = 'connector';
  cfg.connectionStatus = 'offline';
  cfg.lastStatus = { ok: true, status: 200, message: 'Connector token generated for exchange.' };
  saveDB(db);
  res.json({
    connectorToken: rawToken,
    expiresAt,
    message: 'Store this token securely. It will be shown only once.'
  });
}));

app.post('/api/integrations/ibkr/connector/exchange', asyncHandler(async (req, res) => {
  const token = parseBearerToken(req.headers.authorization) || String(req.body?.token || '').trim();
  if (!token) return res.status(401).json({ error: 'Missing connector token.' });
  if (!checkIbkrRateLimit(`ibkr-connector-exchange:${hashConnectorCredential(token)}`, res)) return;
  const db = loadDB();
  const exchange = await exchangeIbkrConnectorToken(db, token);
  if (!exchange) return res.status(401).json({ error: 'Invalid connector token.' });
  const { connectorKey, user } = exchange;
  const cfg = user.ibkr;
  cfg.enabled = true;
  cfg.mode = 'connector';
  cfg.connectionStatus = 'offline';
  cfg.lastStatus = { ok: true, status: 200, message: 'Connector key exchanged.' };
  saveDB(db);
  res.json({ connectorKey });
}));

app.post('/api/integrations/ibkr/connector/revoke', auth, asyncHandler(async (req, res) => {
  if (rejectGuest(req, res)) return;
  if (!checkIbkrRateLimit(`${req.username}:ibkr-connector-revoke`, res)) return;
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const cfg = user.ibkr;
  const now = new Date().toISOString();
  const keys = ensureIbkrConnectorKeys(db);
  keys.forEach(entry => {
    if (entry?.username === req.username && !entry.revokedAt) {
      entry.revokedAt = now;
    }
  });
  const tokens = ensureIbkrConnectorTokens(db);
  tokens.forEach(entry => {
    if (entry?.username === req.username && !entry.usedAt) {
      entry.usedAt = now;
    }
  });
  cfg.connectionStatus = 'disconnected';
  cfg.lastConnectorStatus = {
    status: 'disconnected',
    reason: 'Connector key revoked.',
    authStatus: null,
    connectorVersion: '',
    gatewayUrl: '',
    receivedAt: new Date().toISOString()
  };
  cfg.lastStatus = { ok: true, status: 200, message: 'Connector key revoked.' };
  saveDB(db);
  res.json({ ok: true });
}));

app.post('/api/integrations/ibkr/connector/verify', asyncHandler(async (req, res) => {
  const connectorKey = parseBearerToken(req.headers.authorization);
  if (!connectorKey) {
    logIbkrConnectorAuthFailure('verify', 'missing connector key');
    return res.status(401).json({ error: 'Missing connector key.' });
  }
  const db = loadDB();
  const match = await findIbkrConnectorKeyOwner(db, connectorKey);
  if (!match) {
    logIbkrConnectorAuthFailure('verify', 'invalid connector key');
    return res.status(401).json({ error: 'Invalid connector key.' });
  }
  const { username, keyRecord } = match;
  keyRecord.lastUsedAt = new Date().toISOString();
  saveDB(db);
  res.json({ ok: true, userId: username });
}));

app.post('/api/integrations/ibkr/connector/heartbeat', asyncHandler(async (req, res) => {
  const connectorKey = parseBearerToken(req.headers.authorization);
  if (!connectorKey) {
    logIbkrConnectorAuthFailure('heartbeat', 'missing connector key');
    return res.status(401).json({ error: 'Missing connector key.' });
  }
  if (!checkIbkrRateLimit(`ibkr-connector-heartbeat:${hashConnectorCredential(connectorKey)}`, res)) return;
  const db = loadDB();
  const match = await findIbkrConnectorKeyOwner(db, connectorKey);
  if (!match) {
    logIbkrConnectorAuthFailure('heartbeat', 'invalid connector key');
    return res.status(401).json({ error: 'Invalid connector key.' });
  }
  const { username, user, keyRecord } = match;
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, username);
  const parseResult = ibkrHeartbeatSchema.safeParse(req.body || {});
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid heartbeat payload.', details: parseResult.error.flatten() });
  }
  const heartbeat = parseResult.data;
  applyIbkrHeartbeat(user, heartbeat);
  keyRecord.lastUsedAt = user.ibkr.lastHeartbeatAt;
  saveDB(db);
  res.json({ ok: true });
}));

app.post('/api/integrations/ibkr/connector/snapshot', asyncHandler(async (req, res) => {
  const connectorKey = parseBearerToken(req.headers.authorization);
  if (!connectorKey) {
    logIbkrConnectorAuthFailure('snapshot', 'missing connector key');
    return res.status(401).json({ error: 'Missing connector key.' });
  }
  if (!checkIbkrRateLimit(`ibkr-connector-snapshot:${hashConnectorCredential(connectorKey)}`, res)) return;
  const db = loadDB();
  const match = await findIbkrConnectorKeyOwner(db, connectorKey);
  if (!match) {
    logIbkrConnectorAuthFailure('snapshot', 'invalid connector key');
    return res.status(401).json({ error: 'Invalid connector key.' });
  }
  const { username, user, keyRecord } = match;
  const parseResult = ibkrSnapshotSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid snapshot payload.', details: parseResult.error.flatten() });
  }
  const payload = parseResult.data;
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, username);
  const cfg = user.ibkr;
  cfg.enabled = true;
  cfg.mode = 'connector';
  cfg.accountId = payload.accountId || cfg.accountId;
  cfg.lastHeartbeatAt = new Date().toISOString();
  cfg.lastSnapshotAt = new Date().toISOString();
  cfg.lastSyncAt = cfg.lastSnapshotAt;
  cfg.connectionStatus = 'online';
  const derivedStopByTicker = computeIbkrDerivedStops(payload.positions, payload.orders || []);
  const snapshot = {
    ...payload,
    derivedStopByTicker,
    orders: payload.orders || []
  };
  console.debug(`[IBKR] Snapshot received: ${snapshot.positions?.length || 0} positions, ${snapshot.orders?.length || 0} orders.`);
  await applyIbkrSnapshotToUser(user, snapshot, derivedStopByTicker);
  recordBrokerSnapshot(db, username, 'IBKR', snapshot);
  cfg.lastStatus = { ok: true, status: 200, message: 'Snapshot received.' };
  cfg.lastPortfolioValue = snapshot.portfolioValue;
  cfg.lastPortfolioCurrency = snapshot.rootCurrency;
  cfg.lastRaw = {
    accounts: snapshot.raw?.accounts ?? null,
    summary: snapshot.raw?.summary ?? null,
    ledger: snapshot.raw?.ledger ?? null,
    positions: snapshot.raw?.positions ?? null,
    orders: snapshot.raw?.orders ?? null
  };
  cfg.raw = {
    ...(cfg.raw && typeof cfg.raw === 'object' ? cfg.raw : {}),
    accountsRaw: snapshot.raw?.accounts ?? null,
    summaryRaw: snapshot.raw?.summary ?? null,
    ledgerRaw: snapshot.raw?.ledger ?? null,
    positionsRaw: snapshot.raw?.positions ?? null,
    ordersRaw: snapshot.raw?.orders ?? null,
    lastUpdated: cfg.lastSnapshotAt
  };
  cfg.lastConnectorStatus = {
    status: 'online',
    reason: '',
    authStatus: cfg.lastConnectorStatus?.authStatus || null,
    connectorVersion: snapshot.meta?.connectorVersion || cfg.lastConnectorStatus?.connectorVersion || '',
    gatewayUrl: snapshot.meta?.gatewayUrl || cfg.lastConnectorStatus?.gatewayUrl || '',
    receivedAt: cfg.lastSnapshotAt
  };
  keyRecord.lastUsedAt = cfg.lastSnapshotAt;
  saveDB(db);
  res.json({ ok: true });
}));

app.post('/api/integrations/ibkr/start-session', auth, asyncHandler(async (req, res) => {
  res.status(410).json({
    error: 'Server-side IBKR sessions are disabled.',
    details: 'Use the local IBKR connector to establish a session.'
  });
}));

app.get('/api/integrations/ibkr/session-status', auth, asyncHandler(async (req, res) => {
  res.status(410).json({
    error: 'Server-side IBKR session status is no longer available.',
    details: 'Use the local IBKR connector to monitor session health.'
  });
}));

app.post('/api/integrations/ibkr/end-session', auth, asyncHandler(async (req, res) => {
  if (rejectGuest(req, res)) return;
  if (!checkIbkrRateLimit(`${req.username}:ibkr-end`, res)) return;
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const cfg = user.ibkr;
  cfg.connectionStatus = 'offline';
  cfg.lastStatus = { ok: true, status: 200, message: 'Connector marked offline.' };
  saveDB(db);
  res.json({ ok: true });
}));

app.post('/api/integrations/ibkr/sync', auth, asyncHandler(async (req, res) => {
  if (rejectGuest(req, res)) return;
  if (!checkIbkrRateLimit(`${req.username}:ibkr-sync`, res)) return;
  await syncIbkrForUser(req.username);
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const cfg = user.ibkr || {};
  const connectorOnline = cfg.connectionStatus === 'online';
  res.json({
    enabled: !!cfg.enabled,
    mode: cfg.mode || 'connector',
    accountId: cfg.accountId || '',
    connectionStatus: cfg.connectionStatus || 'disconnected',
    lastHeartbeatAt: cfg.lastHeartbeatAt || null,
    lastSnapshotAt: cfg.lastSnapshotAt || null,
    lastSyncAt: cfg.lastSyncAt || null,
    lastStatus: cfg.lastStatus || null,
    lastSessionCheckAt: cfg.lastSessionCheckAt || null,
    lastPortfolioValue: Number.isFinite(Number(cfg.lastPortfolioValue)) ? Number(cfg.lastPortfolioValue) : null,
    lastPortfolioCurrency: cfg.lastPortfolioCurrency || null,
    lastConnectorStatus: cfg.lastConnectorStatus || null,
    connectorOnline,
    lastDisconnectReason: cfg.lastConnectorStatus?.reason || null
  });
}));

app.post('/api/integrations/trading212', auth, async (req, res) => {
  const { enabled, apiKey, apiSecret, accounts, snapshotTime, mode, timezone, baseUrl, endpoint, runNow } = req.body || {};
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const cfg = user.trading212;
  const history = ensurePortfolioHistory(user);
  normalizePortfolioHistory(user);
  const totals = computeNetDepositsTotals(user, history);
  if (typeof enabled === 'boolean') {
    cfg.enabled = enabled;
  }
  if (typeof mode === 'string' && ['live', 'practice'].includes(mode)) {
    cfg.mode = mode;
  }
  cfg.timezone = 'Europe/London';
  cfg.snapshotTime = '21:00';
  cfg.baseUrl = cfg.mode === 'practice'
    ? 'https://demo.trading212.com'
    : 'https://live.trading212.com';
  cfg.endpoint = '/api/v0/equity/account/summary';
  if (Array.isArray(accounts)) {
    const existingAccounts = Array.isArray(cfg.accounts) ? cfg.accounts : [];
    const existingMap = new Map(existingAccounts.map(account => [account.id, account]));
    const normalized = accounts
      .filter(account => account && typeof account === 'object')
      .map((account, index) => {
        const id = typeof account.id === 'string' && account.id.trim()
          ? account.id.trim()
          : (existingAccounts[index]?.id || crypto.randomBytes(6).toString('hex'));
        const previous = existingMap.get(id);
        const next = {
          id,
          label: typeof account.label === 'string' ? account.label.trim() : (previous?.label || ''),
          apiKey: previous?.apiKey || '',
          apiSecret: previous?.apiSecret || ''
        };
        if (account.apiKey !== undefined) {
          next.apiKey = typeof account.apiKey === 'string' ? account.apiKey.trim() : '';
        }
        if (account.apiSecret !== undefined) {
          next.apiSecret = typeof account.apiSecret === 'string' ? account.apiSecret.trim() : '';
        }
        if (typeof account.mode === 'string' && ['live', 'practice'].includes(account.mode)) {
          next.mode = account.mode;
        }
        if (typeof account.baseUrl === 'string') {
          next.baseUrl = account.baseUrl.trim();
        }
        return next;
      })
      .filter(account => account.apiKey || account.apiSecret || account.label);
    cfg.accounts = normalized;
  }
  if (apiKey !== undefined) {
    if (typeof apiKey === 'string' && apiKey.trim()) {
      if (!Array.isArray(cfg.accounts) || !cfg.accounts.length) {
        cfg.accounts = [{
          id: 'primary',
          label: '',
          apiKey: apiKey.trim(),
          apiSecret: cfg.apiSecret || ''
        }];
      } else {
        cfg.accounts[0].apiKey = apiKey.trim();
      }
    } else if (apiKey === '') {
      if (Array.isArray(cfg.accounts) && cfg.accounts[0]) {
        cfg.accounts[0].apiKey = '';
      }
    }
  }
  if (apiSecret !== undefined) {
    if (typeof apiSecret === 'string' && apiSecret.trim()) {
      if (!Array.isArray(cfg.accounts) || !cfg.accounts.length) {
        cfg.accounts = [{
          id: 'primary',
          label: '',
          apiKey: cfg.apiKey || '',
          apiSecret: apiSecret.trim()
        }];
      } else {
        cfg.accounts[0].apiSecret = apiSecret.trim();
      }
    } else if (apiSecret === '') {
      if (Array.isArray(cfg.accounts) && cfg.accounts[0]) {
        cfg.accounts[0].apiSecret = '';
      }
    }
  }
  const savedAccounts = getTrading212Accounts(cfg);
  if (cfg.enabled && !savedAccounts.length) {
    return res.status(400).json({ error: 'Provide your Trading 212 API key and secret to enable automation.' });
  }
  if (cfg.enabled) {
    delete cfg.authoritativeSyncAt;
    cfg.integrationEnabledAt = new Date().toISOString();
    cfg.lastTransactionAt = null;
    cfg.processedReferences = [];
  }
  if (cfg.enabled && cfg.lastNetDeposits === undefined) {
    cfg.lastNetDeposits = totals.total;
  }
  if (!cfg.enabled) {
    delete cfg.cooldownUntil;
  }
  if (Array.isArray(cfg.accounts) && cfg.accounts.length) {
    cfg.apiKey = cfg.accounts[0].apiKey || '';
    cfg.apiSecret = cfg.accounts[0].apiSecret || '';
  }
  saveDB(db);
  scheduleTrading212Job(req.username, user);
  let responseCfg = cfg;
  if (runNow && cfg.enabled && getTrading212Accounts(cfg).length) {
    await syncTrading212ForUser(req.username);
    const latestDb = loadDB();
    responseCfg = latestDb.users[req.username]?.trading212 || responseCfg;
  }
  res.json({
    enabled: !!responseCfg.enabled,
    snapshotTime: responseCfg.snapshotTime,
    mode: responseCfg.mode,
    timezone: responseCfg.timezone,
    hasApiKey: getTrading212Accounts(responseCfg).some(account => account.apiKey),
    hasApiSecret: getTrading212Accounts(responseCfg).some(account => account.apiSecret),
    accounts: Array.isArray(responseCfg.accounts)
      ? responseCfg.accounts.map(account => ({
        id: account.id,
        label: account.label || '',
        hasApiKey: !!account.apiKey,
        hasApiSecret: !!account.apiSecret,
        mode: account.mode || responseCfg.mode || 'live'
      }))
      : [],
    baseUrl: responseCfg.baseUrl || '',
    endpoint: responseCfg.endpoint || '/api/v0/equity/account/summary',
    lastBaseUrl: responseCfg.lastBaseUrl || null,
    lastEndpoint: responseCfg.lastEndpoint || null,
    lastSyncAt: responseCfg.lastSyncAt || null,
    lastStatus: responseCfg.lastStatus || null,
    lastRaw: responseCfg.lastRaw || null,
    cooldownUntil: responseCfg.cooldownUntil || null
  });
});

// profits endpoints
app.get('/api/pl', auth, (req,res)=>{
  const { year, month } = req.query;
  const db = loadDB();
  const user = db.users[req.username];
  ensureUserShape(user, req.username);
  if (!user.profileComplete) {
    return res.status(409).json({ error: 'Profile incomplete', code: 'profile_incomplete' });
  }
  const history = ensurePortfolioHistory(user);
  let mutated = normalizePortfolioHistory(user);
  const journal = ensureTradeJournal(user);
  if (normalizeTradeJournal(user)) mutated = true;
  const { baseline, mutated: anchorMutated } = refreshAnchors(user, history);
  if (anchorMutated) mutated = true;
  const snapshots = buildSnapshots(history, baseline, journal);
  Object.values(snapshots).forEach(month => {
    Object.values(month || {}).forEach(entry => {
      if (!entry || !Array.isArray(entry.trades)) return;
      entry.trades = entry.trades.map(trade => applyInstrumentMappingToTrade({ ...trade }, db, req.username));
    });
  });
  if (mutated) saveDB(db);
  if (year && month) {
    const key = `${year}-${String(month).padStart(2,'0')}`;
    return res.json(snapshots[key] || {});
  }
  res.json(snapshots);
});

app.post('/api/pl', auth, (req,res)=>{
  const { date, value, cashIn, cashOut, note } = req.body || {};
  if (!date) return res.status(400).json({ error: 'Missing date' });
  const db = loadDB();
  const user = db.users[req.username];
  ensureUserShape(user, req.username);
  if (!user.profileComplete) {
    return res.status(409).json({ error: 'Profile incomplete', code: 'profile_incomplete' });
  }
  const history = ensurePortfolioHistory(user);
  normalizePortfolioHistory(user);
  if (user.initialPortfolio === undefined) {
    user.initialPortfolio = Number.isFinite(user.portfolio) ? user.portfolio : 0;
  }
  const ym = date.slice(0,7);
  history[ym] ||= {};
  const existingRecord = history[ym][date];
  let anchorDate = user.netDepositsAnchor || null;
  if (anchorDate && date < anchorDate) {
    user.netDepositsAnchor = date;
    user.initialNetDeposits = 0;
    anchorDate = date;
  }
  const deposit = cashIn === undefined || cashIn === '' ? 0 : Number(cashIn);
  const withdrawal = cashOut === undefined || cashOut === '' ? 0 : Number(cashOut);
  if (!Number.isFinite(deposit) || deposit < 0) {
    return res.status(400).json({ error: 'Invalid deposit value' });
  }
  if (!Number.isFinite(withdrawal) || withdrawal < 0) {
    return res.status(400).json({ error: 'Invalid withdrawal value' });
  }
  let normalizedNote;
  if (note !== undefined) {
    if (note === null) {
      normalizedNote = '';
    } else if (typeof note === 'string') {
      normalizedNote = note.trim();
    } else {
      return res.status(400).json({ error: 'Invalid note value' });
    }
  }
  if (value === null || value === '') {
    const hasCash = deposit > 0 || withdrawal > 0;
    const hasNote = normalizedNote !== undefined ? !!normalizedNote : !!existingRecord?.note;
    if (hasCash || hasNote) {
      const entryPayload = {
        cashIn: deposit,
        cashOut: withdrawal
      };
      if (normalizedNote !== undefined) {
        if (normalizedNote) {
          entryPayload.note = normalizedNote;
        }
      } else if (existingRecord && typeof existingRecord.note === 'string') {
        const carryNote = existingRecord.note.trim();
        if (carryNote) {
          entryPayload.note = carryNote;
        }
      }
      history[ym][date] = entryPayload;
    } else {
      delete history[ym][date];
      if (!Object.keys(history[ym]).length) {
        delete history[ym];
      }
    }
  } else {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      return res.status(400).json({ error: 'Invalid portfolio value' });
    }
    const entryPayload = {
      end: num,
      cashIn: deposit,
      cashOut: withdrawal
    };
    if (normalizedNote !== undefined) {
      if (normalizedNote) {
        entryPayload.note = normalizedNote;
      }
    } else if (existingRecord && typeof existingRecord.note === 'string') {
      const carryNote = existingRecord.note.trim();
      if (carryNote) {
        entryPayload.note = carryNote;
      }
    }
    history[ym][date] = entryPayload;
  }
  normalizePortfolioHistory(user);
  refreshAnchors(user, history);
  saveDB(db);
  res.json({ ok: true });
});

// --- exchange rates ---
let cachedRates = { GBP: 1 };
let cachedRatesAt = 0;
async function fetchRates() {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const now = Date.now();
  if (process.env.SKIP_RATE_FETCH === 'true') {
    if (!cachedRates.USD || !cachedRates.EUR) {
      cachedRates = { GBP: 1, USD: 1, EUR: 1 };
    }
    cachedRatesAt = now;
    return cachedRates;
  }
  if (cachedRatesAt && (now - cachedRatesAt) < SIX_HOURS && cachedRates.USD) {
    return cachedRates;
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/GBP');
    if (!res.ok) throw new Error(`Rate fetch failed: ${res.status}`);
    const data = await res.json();
    const rates = data?.rates;
    if (rates && typeof rates === 'object') {
      cachedRates = { ...rates, GBP: 1 };
      cachedRatesAt = now;
    }
  } catch (e) {
    console.warn('Unable to refresh exchange rates', e.message || e);
    if (!cachedRates.USD || !cachedRates.EUR) {
      cachedRates = { GBP: 1 };
    }
  }
  return cachedRates;
}

function convertGBPToCurrency(valueGBP, currency, rates) {
  if (!Number.isFinite(valueGBP)) return null;
  if (currency === 'GBP') return valueGBP;
  const rate = rates?.[currency];
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return valueGBP * rate;
}

function convertToGBP(value, currency, rates) {
  if (!Number.isFinite(value)) return null;
  if (currency === 'GBP') return value;
  const rate = rates?.[currency];
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return value / rate;
}

function sanitizeTagList(value, limit = 10) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(',');
  const deduped = [];
  items.forEach(item => {
    if (!item) return;
    const normalized = String(item).trim();
    if (!normalized) return;
    if (deduped.length >= limit) return;
    if (!deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  });
  return deduped;
}

function normalizeTradeMeta(trade = {}) {
  if (!trade || typeof trade !== 'object') return {};
  const type = typeof trade.tradeType === 'string' ? trade.tradeType.trim().toLowerCase() : '';
  const asset = typeof trade.assetClass === 'string' ? trade.assetClass.trim().toLowerCase() : '';
  const condition = typeof trade.marketCondition === 'string' ? trade.marketCondition.trim().toLowerCase() : '';
  const strategy = typeof trade.strategyTag === 'string' ? trade.strategyTag.trim() : '';
  const screenshotRaw = typeof trade.screenshotUrl === 'string' ? trade.screenshotUrl.trim() : '';
  const noteRaw = typeof trade.note === 'string' ? trade.note.trim() : '';
  const directionRaw = typeof trade.direction === 'string' ? trade.direction.trim().toLowerCase() : 'long';
  const feesRaw = Number(trade.fees);
  const slippageRaw = Number(trade.slippage);
  const rounding = trade.rounding === 'whole' ? 'whole' : 'fractional';
  const sourceRaw = typeof trade.source === 'string' ? trade.source.trim().toLowerCase() : '';
  const source = sourceRaw === 'trading212'
    ? 'trading212'
    : (sourceRaw === 'ibkr' ? 'ibkr' : 'manual');
  return {
    ...trade,
    tradeType: TRADE_TYPES.includes(type) ? type : 'day',
    assetClass: ASSET_CLASSES.includes(asset) ? asset : 'stocks',
    marketCondition: MARKET_CONDITIONS.includes(condition) ? condition : '',
    direction: DIRECTIONS.includes(directionRaw) ? directionRaw : 'long',
    fees: Number.isFinite(feesRaw) && feesRaw >= 0 ? feesRaw : 0,
    slippage: Number.isFinite(slippageRaw) && slippageRaw >= 0 ? slippageRaw : 0,
    rounding,
    source,
    strategyTag: strategy,
    setupTags: sanitizeTagList(trade.setupTags ?? trade.tags ?? [], 15),
    emotionTags: sanitizeTagList(trade.emotionTags ?? [], 15),
    screenshotUrl: screenshotRaw || undefined,
    note: noteRaw || undefined
  };
}

const marketCache = new Map();
const dailyLowCache = new Map();

function getTimezoneOffset(date, timeZone) {
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone }));
  return (date - tzDate) / 60000;
}

function getNyDateKeyForDate(date, adjustForMarketOpen = false) {
  const nyNow = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hours = nyNow.getHours();
  const minutes = nyNow.getMinutes();
  const localDate = new Date(nyNow);
  if (adjustForMarketOpen && (hours < 9 || (hours === 9 && minutes < 30))) {
    localDate.setDate(localDate.getDate() - 1);
  }
  const year = localDate.getFullYear();
  const month = `${localDate.getMonth() + 1}`.padStart(2, '0');
  const day = `${localDate.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNyDateKey() {
  return getNyDateKeyForDate(new Date(), true);
}
async function fetchYahooQuote(symbol) {
  const baseUrls = [
    'https://query1.finance.yahoo.com/v7/finance/quote',
    'https://query2.finance.yahoo.com/v7/finance/quote'
  ];
  const trimmed = (symbol || '').toUpperCase();
  if (!trimmed) throw new Error('Missing symbol');
  const headers = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'application/json,text/plain,*/*'
  };
  for (const baseUrl of baseUrls) {
    const url = `${baseUrl}?symbols=${encodeURIComponent(trimmed)}&includePrePost=true`;
    const res = await fetch(url, { headers });
    if (!res.ok) continue;
    const data = await res.json();
    const quote = data?.quoteResponse?.result?.[0];
    if (!quote) continue;
    const marketState = typeof quote?.marketState === 'string' ? quote.marketState.toLowerCase() : '';
    const preferPre = marketState.startsWith('pre');
    const preferPost = marketState.startsWith('post');
    const preferredExtended = (preferPre ? quote?.preMarketPrice : null)
      ?? (preferPost ? quote?.postMarketPrice : null)
      ?? quote?.extendedMarketPrice
      ?? quote?.preMarketPrice
      ?? quote?.postMarketPrice;
    const price = preferredExtended
      ?? quote?.regularMarketPrice
      ?? quote?.regularMarketPreviousClose;
    const currency = quote?.currency || 'GBP';
    if (!Number.isFinite(price) || price <= 0) continue;
    const isExtended = Number.isFinite(preferredExtended) && preferredExtended > 0;
    return {
      symbol: trimmed,
      price,
      currency,
      isExtended,
      marketState
    };
  }
  throw new Error('Yahoo quote not available');
}

async function fetchYahooChartQuote(symbol) {
  const trimmed = (symbol || '').toUpperCase();
  if (!trimmed) throw new Error('Missing symbol');
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(trimmed)}?interval=1m&range=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json,text/plain,*/*'
    }
  });
  if (!res.ok) throw new Error('Yahoo chart not available');
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes) || closes.length === 0) throw new Error('Yahoo chart missing data');
  let last = null;
  for (let i = closes.length - 1; i >= 0; i -= 1) {
    const value = closes[i];
    if (Number.isFinite(value) && value > 0) {
      last = value;
      break;
    }
  }
  if (!Number.isFinite(last) || last <= 0) throw new Error('Yahoo chart missing price');
  const currency = result?.meta?.currency || 'GBP';
  const marketState = typeof result?.meta?.marketState === 'string'
    ? result.meta.marketState.toLowerCase()
    : '';
  return {
    symbol: trimmed,
    price: last,
    currency,
    isExtended: true,
    marketState
  };
}

async function fetchYahooDayLow(symbol) {
  const trimmed = (symbol || '').toUpperCase();
  if (!trimmed) throw new Error('Missing symbol');
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(trimmed)}?interval=1m&range=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json,text/plain,*/*'
    }
  });
  if (!res.ok) throw new Error('Yahoo chart not available');
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const lows = result?.indicators?.quote?.[0]?.low;
  if (!Array.isArray(lows) || lows.length === 0) throw new Error('Yahoo chart missing low');
  let min = null;
  for (const value of lows) {
    if (!Number.isFinite(value) || value <= 0) continue;
    if (min === null || value < min) min = value;
  }
  if (!Number.isFinite(min) || min <= 0) throw new Error('Yahoo chart missing low');
  return {
    symbol: trimmed,
    low: min,
    currency: result?.meta?.currency || 'USD'
  };
}

async function fetchYahooRegularDayLow(symbol) {
  const trimmed = (symbol || '').toUpperCase();
  if (!trimmed) throw new Error('Missing symbol');
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(trimmed)}&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json,text/plain,*/*'
    }
  });
  if (!res.ok) throw new Error('Yahoo quote not available');
  const data = await res.json();
  const quote = data?.quoteResponse?.result?.[0];
  const low = Number(quote?.regularMarketDayLow);
  if (!Number.isFinite(low) || low <= 0) {
    throw new Error('Yahoo quote missing regular day low');
  }
  return {
    symbol: trimmed,
    low,
    currency: quote?.currency || 'USD'
  };
}

async function fetchStooqQuote(symbol) {
  const trimmed = (symbol || '').trim();
  if (!trimmed) throw new Error('Missing symbol');
  const candidates = [trimmed, `${trimmed}.us`];
  for (const candidate of candidates) {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(candidate.toLowerCase())}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const text = await res.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) continue;
    const cols = lines[1].split(',');
    const price = Number(cols[6]);
    if (!Number.isFinite(price) || price <= 0) continue;
    return { symbol: trimmed.toUpperCase(), price, currency: 'USD' };
  }
  throw new Error('Stooq quote not available');
}

async function fetchMarketPrice(symbol) {
  const trimmed = (symbol || '').toUpperCase();
  if (!trimmed) throw new Error('Missing symbol');
  const cacheKey = trimmed;
  const cached = marketCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.at) < 15 * 1000) {
    return cached.quote;
  }
  let normalized = null;
  let yahooQuote = null;
  let yahooChart = null;
  if (process.env.MARKET_DATA_URL) {
    const url = `${process.env.MARKET_DATA_URL}?symbols=${encodeURIComponent(trimmed)}&includePrePost=true`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const quote = data?.quoteResponse?.result?.[0];
      const marketState = typeof quote?.marketState === 'string' ? quote.marketState.toLowerCase() : '';
      const preferPre = marketState.startsWith('pre');
      const preferPost = marketState.startsWith('post');
      const preferredExtended = (preferPre ? quote?.preMarketPrice : null)
        ?? (preferPost ? quote?.postMarketPrice : null)
        ?? quote?.extendedMarketPrice
        ?? quote?.preMarketPrice
        ?? quote?.postMarketPrice;
      const price = preferredExtended
        ?? quote?.regularMarketPrice
        ?? quote?.regularMarketPreviousClose;
      const currency = quote?.currency || 'GBP';
      if (Number.isFinite(price) && price > 0) {
        normalized = {
          symbol: trimmed,
          price,
          currency,
          isExtended: Number.isFinite(preferredExtended) && preferredExtended > 0,
          marketState
        };
      }
    }
  }
  if (!normalized) {
    try {
      yahooQuote = await fetchYahooQuote(trimmed);
    } catch (e) {
    }
    try {
      yahooChart = await fetchYahooChartQuote(trimmed);
    } catch (e) {
      // ignore chart failures
    }
    if (yahooQuote?.isExtended) {
      normalized = yahooQuote;
    } else if (yahooChart?.price && (!yahooQuote?.price || Math.abs(yahooChart.price - yahooQuote.price) > 0.0001)) {
      normalized = yahooChart;
    } else if (yahooQuote) {
      normalized = yahooQuote;
    }
    if (!normalized) {
      normalized = await fetchStooqQuote(trimmed);
    }
  }
  marketCache.set(cacheKey, { quote: normalized, at: now });
  return normalized;
}

async function fetchYahooDayLowForDate(symbol, dateKey) {
  const trimmed = (symbol || '').toUpperCase();
  if (!trimmed) throw new Error('Missing symbol');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('Invalid date key');
  const [year, month, day] = dateKey.split('-').map(Number);
  const baseUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMinutes = getTimezoneOffset(baseUtc, 'America/New_York');
  const start = baseUtc.getTime() + offsetMinutes * 60000;
  const end = start + 24 * 60 * 60 * 1000;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(trimmed)}?interval=1m&period1=${Math.floor(start / 1000)}&period2=${Math.floor(end / 1000)}&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json,text/plain,*/*'
    }
  });
  if (!res.ok) throw new Error('Yahoo chart not available');
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const lows = result?.indicators?.quote?.[0]?.low;
  if (!Array.isArray(lows) || lows.length === 0) throw new Error('Yahoo chart missing low');
  let min = null;
  for (const value of lows) {
    if (!Number.isFinite(value) || value <= 0) continue;
    if (min === null || value < min) min = value;
  }
  if (!Number.isFinite(min) || min <= 0) throw new Error('Yahoo chart missing low');
  return {
    symbol: trimmed,
    low: min,
    currency: result?.meta?.currency || 'USD'
  };
}

async function fetchDailyLow(symbol, dateKey = null) {
  const trimmed = (symbol || '').toUpperCase();
  if (!trimmed) throw new Error('Missing symbol');
  const resolvedDateKey = dateKey || getNyDateKey();
  const cacheKey = `${trimmed}:${resolvedDateKey}`;
  const cached = dailyLowCache.get(cacheKey);
  if (cached) return cached;
  const isToday = resolvedDateKey === getNyDateKey();
  let low;
  if (isToday) {
    try {
      low = await fetchYahooRegularDayLow(trimmed);
    } catch (e) {
      low = await fetchYahooDayLow(trimmed);
    }
  } else {
    low = await fetchYahooDayLowForDate(trimmed, resolvedDateKey);
  }
  dailyLowCache.set(cacheKey, low);
  return low;
}

async function buildActiveTrades(user, rates = {}) {
  const journal = ensureTradeJournal(user);
  const trades = [];
  let liveOpenPnlGBP = 0;
  let openLossPotentialGBP = 0;
  let providerTrades = 0;
  let manualTrades = 0;
  let providerCurrency = null;
  const ibkrTradeKeys = new Set();
  for (const [dateKey, items] of Object.entries(journal)) {
    for (const trade of items || []) {
      if (!trade || trade.status === 'closed' || Number.isFinite(Number(trade.closePrice))) continue;
      const base = { ...trade, date: dateKey };
      trades.push(base);
      if (trade.source === 'ibkr' || trade.ibkrPositionId) {
        const ticker = normalizeIbkrTicker(trade.ibkrTicker || trade.brokerTicker || trade.symbol || '');
        const conid = trade.ibkrConid ? String(trade.ibkrConid) : '';
        const positionId = trade.ibkrPositionId || conid || ticker;
        if (positionId) ibkrTradeKeys.add(positionId);
        if (conid) ibkrTradeKeys.add(`conid:${conid}`);
        if (ticker) ibkrTradeKeys.add(`ticker:${ticker}`);
      }
    }
  }
  const ibkrLivePositions = user?.ibkr?.livePositions;
  if (Array.isArray(ibkrLivePositions) && ibkrLivePositions.length) {
    const timezone = 'Europe/London';
    ibkrLivePositions.forEach(position => {
      const symbolKey = normalizeIbkrTicker(position.symbol);
      const conidKey = position.conid ? String(position.conid) : '';
      const positionId = position.id || conidKey || symbolKey;
      if (
        (positionId && ibkrTradeKeys.has(positionId))
        || (conidKey && ibkrTradeKeys.has(`conid:${conidKey}`))
        || (symbolKey && ibkrTradeKeys.has(`ticker:${symbolKey}`))
      ) {
        return;
      }
      const updatedAt = position.updatedAt ? new Date(position.updatedAt) : new Date();
      const dateKey = dateKeyInTimezone(timezone, updatedAt);
      trades.push({
        id: `ibkr-live-${position.id || position.symbol}`,
        symbol: position.symbol,
        currency: position.currency || 'USD',
        entry: position.avgPrice,
        sizeUnits: Math.abs(Number(position.quantity)),
        direction: Number(position.quantity) < 0 ? 'short' : 'long',
        status: 'open',
        source: 'ibkr',
        ibkrPositionId: position.id || position.symbol,
        ibkrTicker: position.symbol,
        ibkrConid: position.conid || '',
        lastSyncPrice: position.marketPrice,
        ppl: position.unrealizedPnl,
        currentStop: position.derivedStopPrice,
        currentStopSource: position.derivedStopPrice ? 'ibkr' : undefined,
        createdAt: updatedAt.toISOString(),
        date: dateKey
      });
    });
  }
  const enriched = [];
  for (const trade of trades) {
    const symbol = typeof trade.symbol === 'string' ? trade.symbol.trim().toUpperCase() : '';
    const quoteSymbol = normalizeTrading212Symbol(symbol);
    let livePrice = null;
    let liveCurrency = trade.currency || 'GBP';
    const tradeCurrency = trade.currency || 'GBP';
    const isTrading212 = trade.source === 'trading212' || trade.trading212Id;
    const isIbkr = trade.source === 'ibkr' || trade.ibkrPositionId;
    const isProvider = isTrading212 || isIbkr;
    try {
      if (isProvider && Number.isFinite(Number(trade.lastSyncPrice))) {
        livePrice = Number(trade.lastSyncPrice);
        liveCurrency = tradeCurrency;
      } else if (quoteSymbol) {
        const quote = await fetchMarketPrice(quoteSymbol);
        livePrice = quote.price;
        liveCurrency = quote.currency || liveCurrency;
      }
    } catch (e) {
      // ignore fetch failures; leave livePrice null
    }
    const sizeUnits = Number(trade.sizeUnits);
    const entry = Number(trade.entry);
    const direction = trade.direction === 'short' ? 'short' : 'long';
    const slippage = Number(trade.slippage) || 0;
    const feesCurrency = Number(trade.fees) || 0;
    const fxFeeRate = Number(trade.fxFeeRate);
    const fxFeeEligible = trade.fxFeeEligible === true;
    const syncPpl = parseTradingNumber(trade.ppl);
    if (isIbkr && Number.isFinite(syncPpl)) {
      const ibkrPnlGBP = isIbkr ? convertToGBP(syncPpl, tradeCurrency, rates) : null;
      const providerPnlGBP = Number.isFinite(ibkrPnlGBP) ? ibkrPnlGBP : syncPpl;
      const guaranteedPnlGBP = computeGuaranteedPnl(trade, rates);
      if (guaranteedPnlGBP !== null) {
        const potentialDropGBP = providerPnlGBP - guaranteedPnlGBP;
        if (potentialDropGBP > 0) openLossPotentialGBP -= potentialDropGBP;
      }
      liveOpenPnlGBP += providerPnlGBP;
      providerTrades += 1;
      const providerCurrencyValue = isIbkr && Number.isFinite(ibkrPnlGBP) ? 'GBP' : tradeCurrency;
      if (providerCurrency === null) {
        providerCurrency = providerCurrencyValue;
      } else if (providerCurrency !== providerCurrencyValue) {
        providerCurrency = null;
      }
      const liveFromProvider = Number.isFinite(Number(trade.lastSyncPrice)) ? Number(trade.lastSyncPrice) : null;
      const riskPct = Number.isFinite(Number(trade.riskPct)) ? Number(trade.riskPct) : 0;
      const entryValueGBP = Number.isFinite(entry) && Number.isFinite(sizeUnits)
        ? convertToGBP(entry * sizeUnits, tradeCurrency, rates)
        : null;
      enriched.push({
        id: trade.id,
        symbol: quoteSymbol || symbol,
        displaySymbol: trade.displaySymbol,
        createdAt: trade.createdAt,
        date: trade.date,
        trading212Isin: trade.trading212Isin,
        trading212Ticker: trade.trading212Ticker,
        trading212Name: trade.trading212Name,
        trading212Id: trade.trading212Id,
        ibkrTicker: trade.ibkrTicker,
        ibkrConid: trade.ibkrConid,
        ibkrPositionId: trade.ibkrPositionId,
        entry,
        stop: Number(trade.stop),
        currency: tradeCurrency,
        sizeUnits,
        riskPct,
        direction: trade.direction || 'long',
        fees: Number(trade.fees) || 0,
        slippage: Number(trade.slippage) || 0,
        fxFeeEligible,
        fxFeeRate: Number.isFinite(fxFeeRate) && fxFeeRate > 0 ? fxFeeRate : undefined,
        livePrice: liveFromProvider !== null ? liveFromProvider : undefined,
        liveCurrency: tradeCurrency,
        unrealizedGBP: providerPnlGBP,
        guaranteedPnlGBP: guaranteedPnlGBP !== null ? guaranteedPnlGBP : undefined,
        positionGBP: entryValueGBP !== null ? entryValueGBP : undefined,
        currentStop: Number.isFinite(Number(trade.currentStop)) ? Number(trade.currentStop) : undefined,
        currentStopSource: trade.currentStopSource,
        currentStopLastSyncedAt: trade.currentStopLastSyncedAt,
        currentStopStale: trade.currentStopStale === true,
        originalStopPrice: Number.isFinite(Number(trade.originalStopPrice)) ? Number(trade.originalStopPrice) : undefined,
        source: trade.source || (trade.trading212Id ? 'trading212' : (trade.ibkrPositionId ? 'ibkr' : 'manual')),
        note: trade.note
      });
      continue;
    }
    const positionCurrency = Number.isFinite(livePrice) ? livePrice * sizeUnits : null;
    const positionGBP = Number.isFinite(positionCurrency)
      ? convertToGBP(positionCurrency, liveCurrency, rates)
      : null;
    const entryValueGBP = Number.isFinite(entry) && Number.isFinite(sizeUnits)
      ? convertToGBP(entry * sizeUnits, tradeCurrency, rates)
      : null;
    const effectiveLive = Number.isFinite(livePrice)
      ? (direction === 'short' ? livePrice + slippage : livePrice - slippage)
      : null;
    let pnlCurrency = (Number.isFinite(effectiveLive) && Number.isFinite(entry) && Number.isFinite(sizeUnits))
      ? (direction === 'short'
        ? (entry - effectiveLive) * sizeUnits
        : (effectiveLive - entry) * sizeUnits)
      : null;
    if (isIbkr && Number.isFinite(syncPpl)) {
      pnlCurrency = syncPpl;
    }
    let pnlGBP = null;
    if (isIbkr && Number.isFinite(syncPpl)) {
      pnlGBP = syncPpl;
    } else if (pnlCurrency !== null) {
      pnlGBP = convertToGBP(pnlCurrency, tradeCurrency || liveCurrency || 'GBP', rates);
    }
    let feesGBP = null;
    let fxFeeGBP = null;
    if (!isProvider && Number.isFinite(feesCurrency)) {
      feesGBP = convertToGBP(feesCurrency, tradeCurrency, rates);
    }
    if (!isProvider && fxFeeEligible && Number.isFinite(fxFeeRate) && fxFeeRate > 0 && entryValueGBP !== null) {
      const entryFeeGBP = Math.abs(entryValueGBP) * fxFeeRate;
      const exitBasisGBP = positionGBP !== null ? Math.abs(positionGBP) : Math.abs(entryValueGBP);
      const exitFeeGBP = exitBasisGBP * fxFeeRate;
      fxFeeGBP = entryFeeGBP + exitFeeGBP;
    }
    const unrealizedGBP = (pnlGBP !== null)
      ? (isIbkr && Number.isFinite(syncPpl) ? syncPpl : pnlGBP - (feesGBP ?? 0) - (fxFeeGBP ?? 0))
      : null;
    if (unrealizedGBP !== null) {
      liveOpenPnlGBP += unrealizedGBP;
    }
    const guaranteedPnlGBP = computeGuaranteedPnl(trade, rates);
    if (guaranteedPnlGBP !== null && unrealizedGBP !== null) {
      const potentialDropGBP = unrealizedGBP - guaranteedPnlGBP;
      if (potentialDropGBP > 0) openLossPotentialGBP -= potentialDropGBP;
    }
    manualTrades += 1;
    const perUnitRisk = Number.isFinite(Number(trade.perUnitRisk)) && Number(trade.perUnitRisk) > 0
      ? Number(trade.perUnitRisk)
      : (Number.isFinite(entry) && Number.isFinite(Number(trade.stop)) ? Math.abs(entry - Number(trade.stop)) : null);
    const riskAmountCurrency = Number.isFinite(Number(trade.riskAmountCurrency)) && Number(trade.riskAmountCurrency) > 0
      ? Number(trade.riskAmountCurrency)
      : (Number.isFinite(perUnitRisk) && Number.isFinite(sizeUnits) ? perUnitRisk * sizeUnits : null);
    const portfolioCurrencyAtCalc = Number(trade.portfolioCurrencyAtCalc);
    const derivedRiskPct = Number.isFinite(Number(trade.riskPct)) && Number(trade.riskPct) > 0
      ? Number(trade.riskPct)
      : (Number.isFinite(portfolioCurrencyAtCalc) && portfolioCurrencyAtCalc > 0 && Number.isFinite(riskAmountCurrency)
        ? (riskAmountCurrency / portfolioCurrencyAtCalc) * 100
        : null);
      enriched.push({
        id: trade.id,
        symbol: quoteSymbol || symbol,
        displaySymbol: trade.displaySymbol,
        createdAt: trade.createdAt,
        date: trade.date,
        trading212Isin: trade.trading212Isin,
        trading212Ticker: trade.trading212Ticker,
        trading212Name: trade.trading212Name,
        trading212Id: trade.trading212Id,
        ibkrTicker: trade.ibkrTicker,
        ibkrConid: trade.ibkrConid,
        ibkrPositionId: trade.ibkrPositionId,
        entry,
        stop: Number(trade.stop),
        currency: tradeCurrency,
      sizeUnits,
      riskPct: Number.isFinite(derivedRiskPct) ? derivedRiskPct : 0,
      direction: trade.direction || 'long',
      fees: Number(trade.fees) || 0,
      slippage: Number(trade.slippage) || 0,
      fxFeeEligible,
      fxFeeRate: Number.isFinite(fxFeeRate) && fxFeeRate > 0 ? fxFeeRate : undefined,
      fxFeeImpactGBP: fxFeeGBP !== null ? fxFeeGBP : undefined,
      livePrice: livePrice !== null ? livePrice : undefined,
      liveCurrency,
      unrealizedGBP: unrealizedGBP !== null ? unrealizedGBP : undefined,
      guaranteedPnlGBP: guaranteedPnlGBP !== null ? guaranteedPnlGBP : undefined,
      positionGBP: entryValueGBP !== null ? entryValueGBP : undefined,
      currentStop: Number.isFinite(Number(trade.currentStop)) ? Number(trade.currentStop) : undefined,
      currentStopSource: trade.currentStopSource,
      currentStopLastSyncedAt: trade.currentStopLastSyncedAt,
      currentStopStale: trade.currentStopStale === true,
      originalStopPrice: Number.isFinite(Number(trade.originalStopPrice)) ? Number(trade.originalStopPrice) : undefined,
        source: trade.source || (trade.trading212Id ? 'trading212' : (trade.ibkrPositionId ? 'ibkr' : 'manual')),
        note: trade.note
      });
  }
  return {
    trades: enriched,
    liveOpenPnlGBP,
    openLossPotentialGBP,
    liveOpenPnlMode: providerTrades > 0 && manualTrades === 0 ? 'provider' : 'computed',
    liveOpenPnlCurrency: providerTrades > 0 && manualTrades === 0 ? (providerCurrency || 'GBP') : undefined
  };
}

app.get('/api/trades', auth, async (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  normalizeTradeJournal(user);
  const rates = await fetchRates();
  const trades = flattenTrades(user, rates).map(trade => applyInstrumentMappingToTrade(trade, db, req.username));
  const filtered = filterTrades(trades, req.query || {})
    .sort((a, b) => {
      const aDate = a.closeDate || a.openDate || '';
      const bDate = b.closeDate || b.openDate || '';
      return bDate.localeCompare(aDate);
    });
  res.json({ trades: filtered });
});

app.get('/api/trades/export', auth, async (req, res) => {
  if (rejectGuest(req, res)) return;
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  normalizeTradeJournal(user);
  const rates = await fetchRates();
  const mappedTrades = flattenTrades(user, rates).map(trade => applyInstrumentMappingToTrade(trade, db, req.username));
  const trades = filterTrades(mappedTrades, req.query || {});
  const headers = [
    'id', 'symbol', 'broker_ticker', 'display_ticker', 'status', 'openDate', 'closeDate', 'entry', 'stop', 'currentStop', 'closePrice',
    'currency', 'sizeUnits', 'riskPct', 'riskAmountGBP', 'positionGBP', 'realizedPnlGBP',
    'guaranteedPnlGBP', 'rMultiple', 'tradeType', 'assetClass', 'strategyTag', 'marketCondition',
    'setupTags', 'emotionTags', 'note', 'screenshotUrl'
  ];
  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const str = Array.isArray(val) ? val.join('|') : String(val);
    if (str.includes(',') || str.includes('"')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const rows = trades.map(trade => [
    trade.id,
    trade.symbol || '',
    trade.brokerTicker || '',
    trade.displayTicker || trade.displaySymbol || trade.symbol || '',
    trade.status || 'open',
    trade.openDate || '',
    trade.closeDate || '',
    Number(trade.entry) || '',
    Number(trade.stop) || '',
    Number(trade.currentStop) || '',
    Number(trade.closePrice) || '',
    trade.currency || 'GBP',
    Number(trade.sizeUnits) || '',
    Number(trade.riskPct) || '',
    Number(trade.riskAmountGBP) || '',
    Number(trade.positionGBP) || '',
    Number(trade.realizedPnlGBP) || '',
    Number(trade.guaranteedPnlGBP) || '',
    Number(trade.rMultiple) || '',
    trade.tradeType || '',
    trade.assetClass || '',
    trade.strategyTag || '',
    trade.marketCondition || '',
    (trade.setupTags || []).join('|'),
    (trade.emotionTags || []).join('|'),
    trade.note || '',
    trade.screenshotUrl || ''
  ]);
  const csv = [headers.map(escape).join(','), ...rows.map(row => row.map(escape).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
  res.send(csv);
});

app.post('/api/trades', auth, async (req, res) => {
  const {
    date,
    entry,
    stop,
    currentStop,
    riskPct,
    riskAmount,
    sizeUnits: sizeUnitsInput,
    currency,
    baseCurrency,
    note,
    symbol,
    displaySymbol,
    direction,
    rounding,
    tradeType,
    assetClass,
    strategyTag,
    marketCondition,
    setupTags,
    emotionTags,
    screenshotUrl,
    status,
    closePrice,
    closeDate
  } = req.body || {};
  const supportedCurrencies = ['GBP', 'USD', 'EUR'];
  const tradeCurrency = supportedCurrencies.includes(currency) ? currency : 'GBP';
  const tradeBaseCurrency = supportedCurrencies.includes(baseCurrency) ? baseCurrency : 'GBP';
  const entryNum = Number(entry);
  const stopNum = Number(stop);
  const currentStopNum = Number(currentStop);
  const pctNum = Number(riskPct);
    const riskAmountNum = Number(riskAmount);
  const sizeUnitsNum = Number(sizeUnitsInput);
  const symbolInput = typeof displaySymbol === 'string' ? displaySymbol : symbol;
  const symbolClean = typeof symbolInput === 'string' ? symbolInput.trim().toUpperCase() : '';
  const directionClean = DIRECTIONS.includes((direction || '').toLowerCase()) ? direction.toLowerCase() : 'long';
  if (!Number.isFinite(entryNum) || entryNum <= 0) {
    return res.status(400).json({ error: 'Enter a valid entry price' });
  }
  if (!Number.isFinite(stopNum) || stopNum <= 0) {
    return res.status(400).json({ error: 'Enter a valid stop-loss price' });
  }
  if (directionClean === 'long' && stopNum >= entryNum) {
    return res.status(400).json({ error: 'For long trades, stop-loss must be below entry.' });
  }
  if (directionClean === 'short' && stopNum <= entryNum) {
    return res.status(400).json({ error: 'For short trades, stop-loss must be above entry.' });
  }
  if (!Number.isFinite(entryNum) || entryNum <= 0) {
    return res.status(400).json({ error: 'Enter a valid entry price' });
  }
  if (!Number.isFinite(stopNum) || stopNum <= 0) {
    return res.status(400).json({ error: 'Enter a valid stop-loss price' });
  }
  const perUnitRisk = directionClean === 'long'
    ? entryNum - stopNum
    : stopNum - entryNum;
  if (perUnitRisk === 0) {
    return res.status(400).json({ error: 'Entry and stop-loss cannot match' });
  }
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  if (!user.profileComplete) {
    return res.status(409).json({ error: 'Profile incomplete', code: 'profile_incomplete' });
  }
  const rates = await fetchRates();
  if (tradeCurrency !== 'GBP' && !rates?.[tradeCurrency]) {
    return res.status(400).json({ error: `Missing FX rate for ${tradeCurrency}` });
  }
  const journal = ensureTradeJournal(user);
  const history = ensurePortfolioHistory(user);
  normalizePortfolioHistory(user);
  normalizeTradeJournal(user);
  const portfolioGBP = Number.isFinite(user.portfolio) ? Number(user.portfolio) : 0;
  const portfolioInCurrency = convertGBPToCurrency(portfolioGBP, tradeCurrency, rates);
  if (!Number.isFinite(portfolioInCurrency) || portfolioInCurrency <= 0) {
    return res.status(400).json({ error: 'Add your portfolio value first' });
  }
  let pctToUse = Number.isFinite(pctNum) && pctNum > 0 ? pctNum : null;
  let riskAmountCurrency = Number.isFinite(riskAmountNum) && riskAmountNum > 0
    ? riskAmountNum
    : null;
  let unitsToUse = Number.isFinite(sizeUnitsNum) && sizeUnitsNum > 0 ? sizeUnitsNum : null;
  if (unitsToUse) {
    riskAmountCurrency = perUnitRisk * unitsToUse;
    pctToUse = portfolioInCurrency > 0 ? (riskAmountCurrency / portfolioInCurrency) * 100 : null;
  } else if (!riskAmountCurrency && pctToUse) {
    riskAmountCurrency = portfolioInCurrency * (pctToUse / 100);
  } else if (riskAmountCurrency && !pctToUse) {
    pctToUse = portfolioInCurrency > 0 ? (riskAmountCurrency / portfolioInCurrency) * 100 : null;
  }
  if (!Number.isFinite(riskAmountCurrency) || riskAmountCurrency <= 0) {
    return res.status(400).json({ error: 'Enter a valid risk percentage, amount, or units' });
  }
  const sizeUnits = unitsToUse || (riskAmountCurrency / perUnitRisk);
  const positionCurrency = sizeUnits * entryNum;
  const riskAmountGBP = convertToGBP(riskAmountCurrency, tradeCurrency, rates);
  const positionGBP = convertToGBP(positionCurrency, tradeCurrency, rates);
  const feesNum = Number(req.body?.fees);
  const slippageNum = Number(req.body?.slippage);
  const fees = Number.isFinite(feesNum) && feesNum >= 0 ? feesNum : 0;
  const slippage = Number.isFinite(slippageNum) && slippageNum >= 0 ? slippageNum : 0;
  const targetDate = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
    ? date
    : currentDateKey();
  const fxFeeRate = Number(process.env.FX_FEE_RATE ?? 0.005);
  const fxFeeEligible = tradeCurrency !== tradeBaseCurrency;
  const trade = normalizeTradeMeta({
    id: crypto.randomBytes(8).toString('hex'),
    entry: entryNum,
    stop: stopNum,
    originalStopPrice: stopNum,
    currentStop: Number.isFinite(currentStopNum) && currentStopNum > 0 ? currentStopNum : undefined,
    symbol: symbolClean || undefined,
    currency: tradeCurrency,
    riskPct: pctToUse || pctNum || 0,
    perUnitRisk,
    sizeUnits,
    riskAmountCurrency,
    positionCurrency,
    riskAmountGBP,
    positionGBP,
    portfolioGBPAtCalc: portfolioGBP,
    portfolioCurrencyAtCalc: portfolioInCurrency,
    createdAt: new Date().toISOString(),
    direction: directionClean,
    fees,
    slippage,
    rounding,
    status: status === 'closed' ? 'closed' : 'open',
    tradeType,
    assetClass,
    strategyTag,
    marketCondition,
    setupTags,
      emotionTags,
      screenshotUrl,
      note,
      fxFeeEligible,
      fxFeeRate: Number.isFinite(fxFeeRate) && fxFeeRate > 0 ? fxFeeRate : undefined,
      source: 'manual'
    });
  journal[targetDate] ||= [];
  journal[targetDate].push(trade);
  if (journal[targetDate].length > 50) {
    journal[targetDate] = journal[targetDate].slice(-50);
  }
  if (trade.status === 'closed' || Number.isFinite(Number(closePrice))) {
    const closeNum = Number(closePrice);
    if (!Number.isFinite(closeNum) || closeNum <= 0) {
      return res.status(400).json({ error: 'Enter a valid closing price to log a closed trade' });
    }
    applyTradeClose(user, trade, closeNum, closeDate, rates, targetDate);
  }
  saveDB(db);
  res.json({ ok: true, trade, date: targetDate });
});

app.put('/api/trades/:id', auth, async (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  normalizeTradeJournal(user);
  const found = findTradeById(user, req.params.id);
  if (!found) return res.status(404).json({ error: 'Trade not found' });
  const trade = found.trade;
  const updates = req.body || {};
  const { config: tradingCfg } = ensureTrading212Config(user);
  const rates = await fetchRates();
  const tradeCurrency = trade.currency || 'GBP';
  if (tradeCurrency !== 'GBP' && !rates?.[tradeCurrency]) {
    return res.status(400).json({ error: `Missing FX rate for ${tradeCurrency}` });
  }
  const requestedUnitsNum = updates.sizeUnits !== undefined ? Number(updates.sizeUnits) : null;
  const isTrimRequest = (
    trade.status !== 'closed'
    && Number.isFinite(requestedUnitsNum)
    && requestedUnitsNum > 0
    && requestedUnitsNum < Number(trade.sizeUnits)
  );
  if (isTrimRequest) {
    const trimUnits = Number(trade.sizeUnits) - requestedUnitsNum;
    const trimPrice = Number(updates.trimPrice);
    if (!Number.isFinite(trimPrice) || trimPrice <= 0) {
      return res.status(400).json({ error: 'Enter a valid trim fill price' });
    }
    const trimDate = typeof updates.trimDate === 'string' ? updates.trimDate : undefined;
    const trimResult = addTradeTrim(user, trade, trimUnits, trimPrice, trimDate, rates, found.dateKey);
    if (requestedUnitsNum <= 0) {
      const closeNum = Number(updates.closePrice);
      if (!Number.isFinite(closeNum) || closeNum <= 0) {
        return res.status(400).json({ error: 'Enter a valid closing price' });
      }
      applyTradeClose(user, trade, closeNum, updates.closeDate, rates, found.dateKey);
    }
    saveDB(db);
    return res.json({ ok: true, trade, trim: trimResult });
  }
  const wantsRiskUpdate = (
    updates.entry !== undefined ||
    updates.stop !== undefined ||
    updates.riskPct !== undefined ||
    updates.riskAmount !== undefined ||
    updates.sizeUnits !== undefined
  );
  if (trade.status === 'closed' && wantsRiskUpdate) {
    return res.status(400).json({ error: 'Closed trades cannot change entry, stop, or risk.' });
  }
  const incomingSymbol = typeof updates.displaySymbol === 'string'
    ? updates.displaySymbol
    : (typeof updates.symbol === 'string' ? updates.symbol : null);
  if (incomingSymbol !== null) {
    const trimmed = incomingSymbol.trim().toUpperCase();
    const isTrading212 = trade.source === 'trading212' || trade.trading212Id;
    if (isTrading212) {
      if (trimmed) {
        trade.displaySymbol = trimmed;
      } else {
        delete trade.displaySymbol;
      }
    } else {
      if (!trimmed) {
        return res.status(400).json({ error: 'Enter a valid ticker symbol.' });
      }
      trade.symbol = trimmed;
      delete trade.displaySymbol;
    }
  }
  if (updates.currentStop !== undefined) {
    const stopVal = Number(updates.currentStop);
    if (updates.currentStop === '' || updates.currentStop === null) {
      delete trade.currentStop;
    } else if (!Number.isFinite(stopVal) || stopVal <= 0) {
      return res.status(400).json({ error: 'Enter a valid current stop price' });
    } else {
      trade.currentStop = stopVal;
    }
  }
  const incomingStopSource = typeof updates.currentStopSource === 'string'
    ? updates.currentStopSource.trim().toLowerCase()
    : '';
  if (incomingStopSource === 'manual') {
    trade.currentStopSource = 'manual';
    trade.currentStopStale = false;
  }
  if ((trade.source === 'trading212' || trade.trading212Id) && (updates.stop !== undefined || updates.currentStop !== undefined || incomingStopSource === 'manual')) {
    trade.stopManualOverride = true;
  }
  if (wantsRiskUpdate && trade.status !== 'closed') {
    const entryNum = Number(updates.entry ?? trade.entry);
    const stopNum = Number(updates.stop ?? trade.stop);
    const pctNum = Number(updates.riskPct ?? trade.riskPct);
    const riskAmountNum = Number(updates.riskAmount);
    const sizeUnitsNum = Number(updates.sizeUnits);
    const dir = DIRECTIONS.includes((updates.direction || trade.direction || '').toLowerCase())
      ? (updates.direction || trade.direction).toLowerCase()
      : 'long';
    if (!Number.isFinite(entryNum) || entryNum <= 0) {
      return res.status(400).json({ error: 'Enter a valid entry price' });
    }
    if (!Number.isFinite(stopNum) || stopNum <= 0) {
      return res.status(400).json({ error: 'Enter a valid stop-loss price' });
    }
    if (dir === 'long' && stopNum >= entryNum) {
      return res.status(400).json({ error: 'For long trades, stop-loss must be below entry.' });
    }
    if (dir === 'short' && stopNum <= entryNum) {
      return res.status(400).json({ error: 'For short trades, stop-loss must be above entry.' });
    }
    const perUnitRisk = dir === 'long' ? (entryNum - stopNum) : (stopNum - entryNum);
    if (perUnitRisk === 0) {
      return res.status(400).json({ error: 'Entry and stop-loss cannot match' });
    }
    const portfolioGBP = Number.isFinite(user.portfolio) ? Number(user.portfolio) : 0;
    const portfolioCurrency = convertGBPToCurrency(portfolioGBP, tradeCurrency, rates);
    if (!Number.isFinite(portfolioCurrency) || portfolioCurrency <= 0) {
      return res.status(400).json({ error: 'Add your portfolio value first' });
    }
    let pctToUse = Number.isFinite(pctNum) && pctNum > 0 ? pctNum : null;
    let riskAmountCurrency = Number.isFinite(riskAmountNum) && riskAmountNum > 0 ? riskAmountNum : null;
    let sizeUnits = Number.isFinite(sizeUnitsNum) && sizeUnitsNum > 0 ? sizeUnitsNum : null;
    if (sizeUnits) {
      riskAmountCurrency = perUnitRisk * sizeUnits;
      pctToUse = portfolioCurrency > 0 ? (riskAmountCurrency / portfolioCurrency) * 100 : null;
    } else if (!riskAmountCurrency && pctToUse) {
      riskAmountCurrency = portfolioCurrency * (pctToUse / 100);
    } else if (riskAmountCurrency && !pctToUse) {
      pctToUse = portfolioCurrency > 0 ? (riskAmountCurrency / portfolioCurrency) * 100 : null;
    }
    if (!Number.isFinite(riskAmountCurrency) || riskAmountCurrency <= 0) {
      return res.status(400).json({ error: 'Enter a valid risk percentage, amount, or units' });
    }
    sizeUnits = sizeUnits || (riskAmountCurrency / perUnitRisk);
    const positionCurrency = sizeUnits * entryNum;
    trade.entry = entryNum;
    trade.stop = stopNum;
    trade.perUnitRisk = perUnitRisk;
    if (!Number.isFinite(Number(trade.originalStopPrice))) {
      trade.originalStopPrice = stopNum;
    }
    trade.riskPct = pctToUse || pctNum || 0;
    trade.sizeUnits = sizeUnits;
    trade.riskAmountCurrency = riskAmountCurrency;
    trade.positionCurrency = positionCurrency;
    trade.riskAmountGBP = convertToGBP(riskAmountCurrency, tradeCurrency, rates);
    trade.positionGBP = convertToGBP(positionCurrency, tradeCurrency, rates);
    trade.portfolioGBPAtCalc = portfolioGBP;
    trade.portfolioCurrencyAtCalc = portfolioCurrency;
    trade.direction = dir;
  }
  const meta = normalizeTradeMeta({
    ...trade,
    fees: updates.fees ?? trade.fees,
    slippage: updates.slippage ?? trade.slippage,
    tradeType: updates.tradeType ?? trade.tradeType,
    assetClass: updates.assetClass ?? trade.assetClass,
    strategyTag: updates.strategyTag ?? trade.strategyTag,
    marketCondition: updates.marketCondition ?? trade.marketCondition,
    setupTags: updates.setupTags ?? trade.setupTags,
    emotionTags: updates.emotionTags ?? trade.emotionTags,
    screenshotUrl: updates.screenshotUrl ?? trade.screenshotUrl,
    note: updates.note !== undefined ? updates.note : trade.note,
    rounding: updates.rounding ?? trade.rounding,
    currentStop: trade.currentStop
  });
  trade.tradeType = meta.tradeType;
  trade.assetClass = meta.assetClass;
  trade.strategyTag = meta.strategyTag;
  trade.marketCondition = meta.marketCondition;
  trade.setupTags = meta.setupTags;
  trade.emotionTags = meta.emotionTags;
  trade.screenshotUrl = meta.screenshotUrl;
  trade.note = meta.note;
  const shouldClose = (updates.status && updates.status === 'closed') || Number.isFinite(Number(updates.closePrice));
  if (shouldClose) {
    if (trade.status === 'closed') {
      return res.status(400).json({ error: 'Trade already closed' });
    }
    const closeNum = Number(updates.closePrice);
    if (!Number.isFinite(closeNum) || closeNum <= 0) {
      return res.status(400).json({ error: 'Enter a valid closing price' });
    }
    applyTradeClose(user, trade, closeNum, updates.closeDate, rates, found.dateKey);
  }
  saveDB(db);
  res.json({ ok: true, trade });
});

app.post('/api/trades/:id/trim', auth, async (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  normalizeTradeJournal(user);
  const found = findTradeById(user, req.params.id);
  if (!found) return res.status(404).json({ error: 'Trade not found' });
  const trade = found.trade;
  if (trade.status === 'closed') {
    return res.status(400).json({ error: 'Trade already closed' });
  }
  const units = Number(req.body?.units);
  const price = Number(req.body?.price);
  const date = typeof req.body?.date === 'string' ? req.body.date : undefined;
  if (!Number.isFinite(units) || units <= 0 || units >= Number(trade.sizeUnits)) {
    return res.status(400).json({ error: 'Enter units less than the current position size' });
  }
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: 'Enter a valid trim fill price' });
  }
  const rates = await fetchRates();
  const result = addTradeTrim(user, trade, units, price, date, rates, found.dateKey);
  saveDB(db);
  res.json({ ok: true, trade, trim: result });
});

app.delete('/api/trades/:id', auth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  normalizeTradeJournal(user);
  const found = findTradeById(user, req.params.id);
  if (!found) return res.status(404).json({ error: 'Trade not found' });
  const { dateKey, index, trade } = found;
  const journal = ensureTradeJournal(user);
  const isProviderTrade = trade?.source === 'trading212' || trade?.trading212Id || trade?.source === 'ibkr' || trade?.ibkrPositionId;
  const closedDate = typeof trade?.closeDate === 'string' ? trade.closeDate : dateKey;
  const pnl = Number(trade?.realizedPnlGBP);
  if (
    trade?.status === 'closed'
    && !isProviderTrade
    && /^\d{4}-\d{2}-\d{2}$/.test(closedDate)
    && Number.isFinite(pnl)
  ) {
    const history = ensurePortfolioHistory(user);
    revertHistoryForClose(user, history, closedDate, pnl);
  }
  journal[dateKey].splice(index, 1);
  if (!journal[dateKey].length) {
    delete journal[dateKey];
  }
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/trades/close', auth, (req, res) => {
  const { id, price, date } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing trade id' });
  const closePrice = Number(price);
  if (!Number.isFinite(closePrice) || closePrice <= 0) {
    return res.status(400).json({ error: 'Enter a valid closing price' });
  }
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const journal = ensureTradeJournal(user);
  const history = ensurePortfolioHistory(user);
  const found = findTradeById(user, id);
  if (!found || found.trade.status === 'closed') {
    return res.status(404).json({ error: 'Trade not found' });
  }
  const trade = found.trade;
  const defaultDate = found.dateKey;
  fetchRates()
    .then((rates) => {
      const result = applyTradeClose(user, trade, closePrice, date, rates, defaultDate);
      saveDB(db);
      res.json({ ok: true, pnlGBP: result.pnlGBP });
    })
    .catch((err) => {
      console.error('Failed to compute PnL on trade close', err);
      saveDB(db);
      res.status(500).json({ error: 'Failed to apply trade close' });
    });
});

app.get('/api/rates', auth, async (req,res)=>{
  const rates = await fetchRates();
  res.json({ rates, cachedAt: cachedRatesAt || Date.now() });
});

app.get('/api/trades/active', auth, async (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user, req.username);
  const tradingCfg = user.trading212;
  const tradingAccounts = getTrading212Accounts(tradingCfg);
  if (tradingCfg?.enabled && tradingAccounts.length) {
    try {
      let totalUpdates = 0;
      for (const account of tradingAccounts) {
        const accountId = account.id || '';
        const accountConfig = {
          ...tradingCfg,
          apiKey: account.apiKey,
          apiSecret: account.apiSecret,
          mode: account.mode || tradingCfg.mode,
          baseUrl: account.baseUrl || tradingCfg.baseUrl
        };
        const ordersPayload = await fetchTrading212Orders(accountConfig, req.username, { accountId });
        const { updated: stopUpdates } = upsertTrading212StopOrders(user, ordersPayload, accountId, rates);
        totalUpdates += stopUpdates;
      }
      if (totalUpdates > 0) {
        saveDB(db);
        console.info(`[T212] refreshed ${totalUpdates} trade stop(s) during active trades poll`);
      }
    } catch (e) {
      console.warn('Trading 212 stop refresh failed during active trades poll', e);
    }
  }
  const ibkrCfg = user.ibkr;
  if (ibkrCfg?.enabled && ibkrCfg?.mode === 'connector') {
    const snapshot = getLatestBrokerSnapshot(db, req.username, 'IBKR');
    if (snapshot) {
      const derived = snapshot.derivedStopByTicker || computeIbkrDerivedStops(snapshot.positions || [], snapshot.orders || []);
      const { updated: stopUpdates } = applyIbkrDerivedStopsToLivePositions(user, derived);
      if (stopUpdates > 0) {
        saveDB(db);
        console.info(`[IBKR] refreshed ${stopUpdates} live position stop(s) during active trades poll`);
      }
    }
  }
  const rates = await fetchRates();
  const { trades, liveOpenPnlGBP, openLossPotentialGBP, liveOpenPnlMode, liveOpenPnlCurrency } = await buildActiveTrades(user, rates);
  const mappedTrades = trades.map(trade => applyInstrumentMappingToTrade(trade, db, req.username));
  res.json({
    trades: mappedTrades,
    liveOpenPnl: liveOpenPnlGBP,
    openLossPotential: openLossPotentialGBP,
    liveOpenPnlMode,
    liveOpenPnlCurrency
  });
});

app.get('/api/trades/:id/stop-sync', auth, async (req, res) => {
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  ensureUserShape(user, req.username);
  normalizeTradeJournal(user);
  const found = findTradeById(user, req.params.id);
  if (!found) return res.status(404).json({ ok: false, error: 'Trade not found' });
  const trade = found.trade;
  const isTrading212 = trade.source === 'trading212' || trade.trading212Id;
  const isIbkr = trade.source === 'ibkr' || trade.ibkrPositionId;
  if (!isTrading212 && !isIbkr) {
    return res.json({
      ok: true,
      currentStopPrice: Number.isFinite(Number(trade.currentStop)) ? Number(trade.currentStop) : null,
      source: trade.currentStopSource || 'manual',
      lastSyncedAt: trade.currentStopLastSyncedAt || null,
      stale: trade.currentStopStale === true,
      message: 'Broker sync not enabled for this trade.'
    });
  }
  if (isIbkr) {
    try {
      const snapshot = getLatestBrokerSnapshot(db, req.username, 'IBKR');
      if (!snapshot) {
        return res.status(404).json({
          error: 'No IBKR snapshot received yet.'
        });
      }
      const derived = snapshot.derivedStopByTicker || computeIbkrDerivedStops(snapshot.positions || [], snapshot.orders || []);
      const matched = matchIbkrStopOrderForTrade(trade, normalizeIbkrSnapshotOrders(snapshot.orders || []));
      const syncedAt = new Date().toISOString();
      if (matched) {
        trade.currentStop = matched.stopPrice;
        trade.currentStopSource = 'ibkr';
        trade.currentStopLastSyncedAt = syncedAt;
        trade.currentStopStale = false;
        trade.ibkrStopOrderId = matched.id || '';
        saveDB(db);
        return res.json({
          ok: true,
          currentStopPrice: matched.stopPrice,
          source: 'ibkr',
          lastSyncedAt: syncedAt,
          stale: false,
          matchedOrder: {
            id: matched.id || null,
            type: matched.type || null,
            stopPrice: matched.stopPrice || null,
            createdAt: matched.createdAt || null,
            status: matched.status || null,
            quantity: matched.quantity || null
          }
        });
      }
      trade.currentStopLastSyncedAt = syncedAt;
      if (trade.currentStopSource === 'ibkr') {
        trade.currentStopStale = true;
      }
      trade.ibkrStopOrderId = '';
      if (derived) {
        applyIbkrDerivedStopsToTrades(user, derived);
      }
      saveDB(db);
      return res.json({
        ok: true,
        currentStopPrice: Number.isFinite(Number(trade.currentStop)) ? Number(trade.currentStop) : null,
        source: trade.currentStopSource || 'manual',
        lastSyncedAt: syncedAt,
        stale: trade.currentStopStale === true,
        message: 'No active stop order found.'
      });
    } catch (e) {
      console.warn('IBKR stop sync failed', e);
      return res.status(500).json({
        error: 'IBKR stop sync failed.'
      });
    }
  }
  const { config: tradingCfg } = ensureTrading212Config(user);
  const account = resolveTrading212AccountForTrade(tradingCfg, trade);
  if (!account?.apiKey || !account?.apiSecret) {
    return res.status(401).json({
      error: 'Trading 212 API key is invalid or lacks Orders Read permission.'
    });
  }
  try {
    const accountConfig = {
      ...tradingCfg,
      apiKey: account.apiKey,
      apiSecret: account.apiSecret,
      mode: account.mode || tradingCfg.mode,
      baseUrl: account.baseUrl || tradingCfg.baseUrl
    };
    const ordersPayload = await fetchTrading212Orders(accountConfig, req.username, { accountId: account.id || '' });
    console.info(`[T212] stop sync trade=${trade.id} display=${trade.displaySymbol || trade.symbol || ''} t212Ticker=${trade.trading212Ticker || ''} isin=${trade.trading212Isin || ''}`);
    console.info(`[T212] orders rawCount=${ordersPayload.rawCount} filteredCount=${ordersPayload.filteredCount}`);
    const matched = matchStopOrderForTrade(trade, ordersPayload.orders);
    const syncedAt = new Date().toISOString();
    if (matched) {
      trade.currentStop = matched.stopPrice;
      trade.currentStopSource = 't212';
      trade.currentStopLastSyncedAt = syncedAt;
      trade.currentStopStale = false;
      trade.t212StopOrderId = matched.id || '';
      saveDB(db);
      console.info(`Trading 212 stop sync matched trade ${trade.id} -> order ${matched.id || 'unknown'}`);
      return res.json({
        ok: true,
        currentStopPrice: matched.stopPrice,
        source: 't212',
        lastSyncedAt: syncedAt,
        stale: false,
        matchedOrder: {
          id: matched.id || null,
          type: matched.type || null,
          stopPrice: matched.stopPrice || null,
          limitPrice: matched.limitPrice || null,
          createdAt: matched.createdAt || null,
          status: matched.status || null,
          quantity: matched.quantity || null
        }
      });
    }
    trade.currentStopLastSyncedAt = syncedAt;
    if (trade.currentStopSource === 't212') {
      trade.currentStopStale = true;
    }
    trade.t212StopOrderId = '';
    saveDB(db);
    const orderTickers = ordersPayload.orders.map(order => order.instrumentTicker).filter(Boolean);
    const orderIsins = ordersPayload.orders.map(order => order.instrumentIsin).filter(Boolean);
    console.info(`[T212] stop sync no match trade=${trade.id} t212Ticker=${trade.trading212Ticker || ''} isin=${trade.trading212Isin || ''} orderTickers=${orderTickers.join(',')} orderIsins=${orderIsins.join(',')}`);
    const noOrders = ordersPayload.rawCount === 0;
    return res.json({
      ok: true,
      currentStopPrice: Number.isFinite(Number(trade.currentStop)) ? Number(trade.currentStop) : null,
      source: trade.currentStopSource || 'manual',
      lastSyncedAt: syncedAt,
      stale: trade.currentStopStale === true,
      message: noOrders
        ? 'No open equity orders returned by Trading 212 API.'
        : 'No active stop order found.'
    });
  } catch (e) {
    console.warn('Trading 212 stop sync failed', e);
    if (e instanceof Trading212AuthError) {
      return res.status(e.status || 401).json({
        error: 'Trading 212 API key is invalid or lacks Orders Read permission.'
      });
    }
    if (e instanceof Trading212RateLimitError) {
      return res.status(429).json({
        error: 'Rate limited by Trading 212, retry shortly.'
      });
    }
    if (e instanceof Trading212NetworkError) {
      return res.status(503).json({
        error: 'Unable to reach Trading 212 (network).'
      });
    }
    return res.status(500).json({
      error: 'Trading 212 stop sync failed.'
    });
  }
});

app.get('/api/market/low', auth, async (req, res) => {
  const symbol = typeof req.query?.symbol === 'string' ? req.query.symbol.trim() : '';
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
  try {
    const low = await fetchDailyLow(symbol);
    res.json(low);
  } catch (e) {
    console.error('Failed to fetch daily low', e);
    res.status(502).json({ error: 'Unable to fetch daily low' });
  }
});

async function loadFilteredTrades(username, query = {}) {
  const db = loadDB();
  const user = db.users[username];
  if (!user) return { trades: [], user: null, rates: {} };
  ensureUserShape(user, username);
  normalizeTradeJournal(user);
  const rates = await fetchRates();
  const trades = flattenTrades(user, rates).map(trade => applyInstrumentMappingToTrade(trade, db, username));
  const filtered = filterTrades(trades, query);
  return { trades: filtered, user, rates };
}

app.get('/api/analytics/summary', auth, async (req, res) => {
  const { trades, user } = await loadFilteredTrades(req.username, req.query || {});
  if (!user) return res.status(404).json({ error: 'User not found' });
  const closed = trades.filter(t => t.status === 'closed');
  const summary = analytics.summarizeTrades(closed);
  const curve = analytics.equityCurve(closed);
  const dd = analytics.drawdowns(curve);
  const dist = analytics.distribution(closed);
  const streak = analytics.streaks(closed);
  const breakdown = analytics.breakdowns(closed);
  res.json({
    range: {
      from: req.query?.from || null,
      to: req.query?.to || null
    },
    summary,
    drawdown: {
      maxDrawdown: dd.maxDrawdown,
      durationDays: dd.durationDays,
      peakDate: dd.peakDate,
      troughDate: dd.troughDate
    },
    distribution: {
      median: dist.median,
      stddev: dist.stddev,
      best: dist.best,
      worst: dist.worst
    },
    breakdowns: breakdown,
    streaks: streak
  });
});

app.get('/api/analytics/equity-curve', auth, async (req, res) => {
  const { trades, user } = await loadFilteredTrades(req.username, req.query || {});
  if (!user) return res.status(404).json({ error: 'User not found' });
  const closed = trades.filter(t => t.status === 'closed');
  const curve = analytics.equityCurve(closed);
  res.json({ curve });
});

app.get('/api/analytics/drawdown', auth, async (req, res) => {
  const { trades, user } = await loadFilteredTrades(req.username, req.query || {});
  if (!user) return res.status(404).json({ error: 'User not found' });
  const closed = trades.filter(t => t.status === 'closed');
  const curve = analytics.equityCurve(closed);
  const dd = analytics.drawdowns(curve);
  res.json({ drawdown: dd });
});

app.get('/api/analytics/distribution', auth, async (req, res) => {
  const { trades, user } = await loadFilteredTrades(req.username, req.query || {});
  if (!user) return res.status(404).json({ error: 'User not found' });
  const closed = trades.filter(t => t.status === 'closed');
  const dist = analytics.distribution(closed);
  res.json({ distribution: dist });
});

app.get('/api/analytics/streaks', auth, async (req, res) => {
  const { trades, user } = await loadFilteredTrades(req.username, req.query || {});
  if (!user) return res.status(404).json({ error: 'User not found' });
  const closed = trades.filter(t => t.status === 'closed');
  const streak = analytics.streaks(closed);
  res.json({ streaks: streak });
});

function bootstrapTrading212Schedules() {
  const db = loadDB();
  let mutated = false;
  for (const [username, user] of Object.entries(db.users || {})) {
    const changed = ensureUserShape(user, username);
    if (changed) mutated = true;
    scheduleTrading212Job(username, user);
  }
  if (mutated) {
    saveDB(db);
  }
}

function runGuestCleanup() {
  const db = loadDB();
  const mutated = cleanupExpiredGuests(db);
  if (mutated) saveDB(db);
}

if (require.main === module) {
  bootstrapTrading212Schedules();
  bootstrapIbkrSchedules();
  runGuestCleanup();
  setInterval(runGuestCleanup, 60 * 60 * 1000);
  app.listen(PORT, ()=>{
    console.log(`P&L Calendar server listening on port ${PORT}`);
  });
}

module.exports = {
  app,
  loadDB,
  saveDB,
  ensureUserShape,
  ensurePortfolioHistory,
  ensureTradeJournal,
  flattenTrades,
  filterTrades,
  cleanupExpiredGuests,
  parseTrading212Orders,
  matchStopOrderForTrade,
  pickBestStopOrder,
  inferTrading212AddedEntryPrice,
  isTrading212AddToPosition,
  findTrading212OpenTradeMatch,
  upsertTrading212StopOrders,
  extractIbkrPortfolioValue,
  mapIbkrPosition,
  parseIbkrOrders,
  matchIbkrStopOrderForTrade,
  createIbkrConnectorToken,
  verifyIbkrConnectorToken,
  ibkrSnapshotSchema,
  buildIbkrActivePositionSummaries,
  updateIbkrLivePositions,
  applyIbkrHeartbeat,
  createIbkrConnectorKey,
  findIbkrConnectorKeyOwner,
  exchangeIbkrConnectorToken
};

// global error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('Unhandled error', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Unexpected server error' });
});
