require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (error) {
  console.warn('Nodemailer not installed; falling back to console email logging.');
}
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'storage');
const DATA_FILE = process.env.DATA_FILE || path.join(DEFAULT_DATA_DIR, 'data.json');
const LEGACY_DATA_FILE = path.join(__dirname, 'data.json');

function ensureDataStore() {
  const dataDir = path.dirname(DATA_FILE);
  fs.mkdirSync(dataDir, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    if (fs.existsSync(LEGACY_DATA_FILE) && LEGACY_DATA_FILE !== DATA_FILE) {
      try {
        const legacy = fs.readFileSync(LEGACY_DATA_FILE, 'utf-8');
        if (legacy && legacy.trim()) {
          fs.writeFileSync(DATA_FILE, legacy, 'utf-8');
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
    fs.writeFileSync(DATA_FILE, initialPayload, 'utf-8');
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
  global.__Trading212Error__ = Trading212ErrorImpl;
  return Trading212ErrorImpl;
})();

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

// --- helpers ---
function loadDB() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const db = JSON.parse(raw);
    db.users ||= {};
    db.sessions ||= {};
    db.verifications ||= {};
    db.emailChangeRequests ||= {};
    return db;
  } catch (e) {
    console.warn('Falling back to empty database in loadDB:', e?.message || e);
    return { users: {}, sessions: {} };
  }
}

function saveDB(db) {
  const dir = path.dirname(DATA_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.tmp-${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  );

  const payload = JSON.stringify(db, null, 2);
  try {
    fs.writeFileSync(tmp, payload, 'utf-8');
    fs.renameSync(tmp, DATA_FILE);
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

function auth(req, res, next) {
  const token = req.cookies?.auth_token;
  if (!token) return res.status(401).json({ error: 'Unauthenticated' });
  const db = loadDB();
  const username = db.sessions[token];
  if (!username) return res.status(401).json({ error: 'Unauthenticated' });
  req.username = username;
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
  if (!Number.isFinite(user.initialPortfolio)) {
    const fallback = Number.isFinite(user.portfolio) ? Number(user.portfolio) : 0;
    user.initialPortfolio = fallback;
    mutated = true;
  }
  if (!Number.isFinite(user.portfolio)) {
    user.portfolio = Number.isFinite(user.initialPortfolio) ? Number(user.initialPortfolio) : 0;
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
          const preBaseline = (record.preBaseline === true) || (anchor && dateKey < anchor);
          days[dateKey] = preBaseline
            ? { end: record.value, cashIn: 0, cashOut: 0, preBaseline: true }
            : { end: record.value, cashIn: 0, cashOut: 0 };
          mutated = true;
          continue;
        }
        const end = Number(record.end);
        if (!Number.isFinite(end) || end < 0) {
          delete days[dateKey];
          mutated = true;
          continue;
        }
        const cashInRaw = Number(record.cashIn ?? 0);
        const cashOutRaw = Number(record.cashOut ?? 0);
        const cashIn = Number.isFinite(cashInRaw) && cashInRaw >= 0 ? cashInRaw : 0;
        const cashOut = Number.isFinite(cashOutRaw) && cashOutRaw >= 0 ? cashOutRaw : 0;
        const noteRaw = typeof record.note === 'string' ? record.note : '';
        const note = noteRaw.trim();
        const preBaselineRaw = record.preBaseline === true;
        const shouldBePreBaseline = anchor && dateKey < anchor;
        const preBaseline = preBaselineRaw || shouldBePreBaseline;
        if (
          cashIn !== cashInRaw ||
          cashOut !== cashOutRaw ||
          record.start !== undefined ||
          (!!record.preBaseline !== preBaseline) ||
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
      const currency = trade.currency === 'USD' ? 'USD' : 'GBP';
      const riskAmountGBP = Number(trade.riskAmountGBP);
      const positionGBP = Number(trade.positionGBP);
      const sizeUnits = Number(trade.sizeUnits);
      const perUnitRisk = Number(trade.perUnitRisk);
      const portfolioGBPAtCalc = Number(trade.portfolioGBPAtCalc);
      const portfolioCurrencyAtCalc = Number(trade.portfolioCurrencyAtCalc);
      if (
        !Number.isFinite(entry) || entry <= 0 ||
        !Number.isFinite(stop) || stop <= 0 ||
        !Number.isFinite(riskPct) || riskPct <= 0 ||
        !Number.isFinite(perUnitRisk) || perUnitRisk <= 0 ||
        !Number.isFinite(sizeUnits) || sizeUnits <= 0
      ) {
        mutated = true;
        continue;
      }
      const id = typeof trade.id === 'string' && trade.id ? trade.id : crypto.randomBytes(8).toString('hex');
      const createdAt = typeof trade.createdAt === 'string' ? trade.createdAt : new Date().toISOString();
      const noteRaw = typeof trade.note === 'string' ? trade.note.trim() : '';
      const normalizedTrade = {
        id,
        entry,
        stop,
        currency,
        riskPct,
        perUnitRisk,
        sizeUnits,
        riskAmountGBP: Number.isFinite(riskAmountGBP) ? riskAmountGBP : undefined,
        positionGBP: Number.isFinite(positionGBP) ? positionGBP : undefined,
        portfolioGBPAtCalc: Number.isFinite(portfolioGBPAtCalc) ? portfolioGBPAtCalc : undefined,
        portfolioCurrencyAtCalc: Number.isFinite(portfolioCurrencyAtCalc) ? portfolioCurrencyAtCalc : undefined,
        createdAt
      };
      if (Number.isFinite(trade.riskAmountCurrency)) normalizedTrade.riskAmountCurrency = trade.riskAmountCurrency;
      if (Number.isFinite(trade.positionCurrency)) normalizedTrade.positionCurrency = trade.positionCurrency;
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

function buildSnapshots(history, initial, tradeJournal = {}) {
  const entries = listChronologicalEntries(history);
  const snapshots = {};
  let baseline = Number.isFinite(initial) ? initial : null;
  for (const entry of entries) {
    const monthKey = entry.date.slice(0, 7);
    if (!snapshots[monthKey]) snapshots[monthKey] = {};
    const start = baseline !== null ? baseline : entry.end;
    const payload = {
      start,
      end: entry.end,
      cashIn: entry.cashIn,
      cashOut: entry.cashOut
    };
    if (entry.preBaseline) {
      payload.preBaseline = true;
    }
    if (entry.note) {
      payload.note = entry.note;
    }
    snapshots[monthKey][entry.date] = payload;
    baseline = entry.end;
  }
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
    if (user.portfolio !== latest) {
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
  if (user.portfolio !== normalized) {
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
  const entries = listChronologicalEntries(history);
  for (const entry of entries) {
    if (entry.preBaseline) continue;
    const cashIn = Number.isFinite(entry.cashIn) ? entry.cashIn : 0;
    const cashOut = Number.isFinite(entry.cashOut) ? entry.cashOut : 0;
    total += cashIn - cashOut;
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

async function requestTrading212Endpoint(url, headers) {
  const maxAttempts = 3;
  let attempt = 0;
  let lastError = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch (networkErr) {
      lastError = new Trading212Error('Unable to reach Trading 212', { code: 'network_error' });
      await sleep(Math.min(1000 * attempt, 3000));
      continue;
    }
    const status = res.status;
    if (status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      lastError = new Trading212Error('Trading 212 rate limited the request. Please try again later.', {
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
      throw new Trading212Error('Trading 212 rejected the provided credentials. Double-check your API key and secret.', {
        status,
        code: 'unauthorised'
      });
    }
    if (status === 404) {
      throw new Trading212Error('Trading 212 could not find the portfolio summary endpoint.', {
        status,
        code: 'not_found'
      });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Trading212Error(text || `Trading 212 responded with ${status}`, { status });
    }
    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const raw = await res.text();
      try {
        data = JSON.parse(raw);
      } catch (e) {
        throw new Trading212Error('Trading 212 returned an unexpected response format.', {
          status,
          code: 'invalid_payload'
        });
      }
    }
    const portfolioValue = Number(
      data?.totalValue?.value ??
      data?.totalValue ??
      data?.total?.portfolioValue ??
      data?.portfolioValue ??
      data?.summary?.totalValue ??
      data?.overall?.portfolioValue ??
      data?.overall?.totalValue ??
      data?.accountValue ??
      data?.netLiq
    );
    const netDeposits = Number(
      data?.totalNetDeposits ??
      data?.netDeposits ??
      data?.total?.netDeposits ??
      data?.summary?.netDeposits ??
      data?.overall?.netDeposits ??
      data?.cashFlows?.net ??
      data?.netCash
    );
    if (!Number.isFinite(portfolioValue)) {
      throw new Trading212Error('Trading 212 payload was missing a portfolio value.', {
        status,
        code: 'invalid_payload'
      });
    }
    return {
      portfolioValue,
      netDeposits: Number.isFinite(netDeposits) ? netDeposits : null,
      raw: data
    };
  }
  throw lastError || new Trading212Error('Trading 212 request failed.');
}

async function fetchTrading212Snapshot(config) {
  if (!config.apiKey || !config.apiSecret) {
    throw new Trading212Error('Trading 212 credentials are incomplete', { code: 'credentials_incomplete' });
  }
  const baseCandidates = [];
  const seenBases = new Set();
  const appendBase = (value) => {
    if (!value || typeof value !== 'string') return;
    let normalized = value.trim();
    if (!normalized) return;
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized.replace(/^\/+/, '')}`;
    }
    normalized = normalized.replace(/\/+$/, '');
    if (seenBases.has(normalized)) return;
    seenBases.add(normalized);
    baseCandidates.push(normalized);
  };
  const practiceBases = [
    config.baseUrl,
    process.env.T212_PRACTICE_BASE,
    'https://demo.trading212.com',
    'https://api-demo.trading212.com'
  ];
  const liveBases = [
    config.baseUrl,
    process.env.T212_LIVE_BASE,
    'https://api.trading212.com',
    'https://live.trading212.com'
  ];
  const orderedBases = config.mode === 'practice'
    ? [...practiceBases, ...liveBases]
    : [...liveBases, ...practiceBases];
  for (const candidate of orderedBases) {
    appendBase(candidate);
  }
  if (!baseCandidates.length) {
    throw new Trading212Error('Trading 212 base URL could not be determined.');
  }
  const encodedCredentials = Buffer.from(`${config.apiKey}:${config.apiSecret}`, 'utf8').toString('base64');
  const headers = {
    'Authorization': `Basic ${encodedCredentials}`,
    'Accept': 'application/json',
    'User-Agent': 'PL-Calendar-App/1.0'
  };
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
  for (const base of baseCandidates) {
    for (const pathSuffix of endpointCandidates) {
      const endpoint = `${base}${pathSuffix}`;
      try {
        const snapshot = await requestTrading212Endpoint(endpoint, headers);
        return { ...snapshot, baseUrl: base, endpoint: pathSuffix };
      } catch (error) {
        if (error instanceof Trading212Error && error.status === 404) {
          const notFoundError = new Trading212Error(`Trading 212 could not find ${endpoint}`, {
            status: 404,
            code: 'not_found'
          });
          notFoundError.baseUrl = base;
          notFoundError.endpoint = pathSuffix;
          lastError = notFoundError;
          continue;
        }
        if (error instanceof Trading212Error) {
          error.baseUrl = base;
          error.endpoint = pathSuffix;
        }
        throw error;
      }
    }
  }
  throw lastError || new Trading212Error('Trading 212 portfolio summary endpoint not found.', { status: 404 });
}

const trading212Jobs = new Map();

async function syncTrading212ForUser(username, runDate = new Date()) {
  const db = loadDB();
  const user = db.users[username];
  if (!user) return;
  ensureUserShape(user, username);
  const cfg = user.trading212;
  if (!cfg || !cfg.enabled || !cfg.apiKey || !cfg.apiSecret) return;
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
    const snapshot = await fetchTrading212Snapshot(cfg);
    const history = ensurePortfolioHistory(user);
    normalizePortfolioHistory(user);
    const { total: currentTotal } = computeNetDepositsTotals(user, history);
    const timezone = cfg.timezone || 'Europe/London';
    const dateKey = dateKeyInTimezone(timezone, runDate);
    const ym = dateKey.slice(0, 7);
    history[ym] ||= {};
    const existing = history[ym][dateKey] || {};
    const previousNet = Number.isFinite(Number(cfg.lastNetDeposits))
      ? Number(cfg.lastNetDeposits)
      : currentTotal;
    let cashIn = Number(existing.cashIn ?? 0);
    let cashOut = Number(existing.cashOut ?? 0);
    if (snapshot.netDeposits !== null) {
      const delta = snapshot.netDeposits - previousNet;
      if (delta > 0) {
        cashIn += delta;
      } else if (delta < 0) {
        cashOut += Math.abs(delta);
      }
      cfg.lastNetDeposits = snapshot.netDeposits;
    }
    const existingNote = typeof existing.note === 'string' ? existing.note.trim() : '';
    const payload = {
      end: snapshot.portfolioValue,
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
    user.profileComplete = true;
    const { total: updatedTotal } = computeNetDepositsTotals(user, history);
    cfg.lastNetDeposits = Number.isFinite(Number(cfg.lastNetDeposits))
      ? Number(cfg.lastNetDeposits)
      : updatedTotal;
    refreshAnchors(user, history);
    cfg.lastSyncAt = new Date().toISOString();
    cfg.lastStatus = { ok: true, status: 200 };
    if (snapshot.baseUrl) {
      cfg.lastBaseUrl = snapshot.baseUrl;
      if (!cfg.baseUrl) {
        cfg.baseUrl = snapshot.baseUrl;
      }
      const lowerBase = snapshot.baseUrl.toLowerCase();
      if (lowerBase.includes('demo.trading212.com') || lowerBase.includes('api-demo.trading212.com')) {
        cfg.mode = 'practice';
      } else if (lowerBase.includes('api.trading212.com') || lowerBase.includes('live.trading212.com')) {
        cfg.mode = 'live';
      }
    }
    if (snapshot.endpoint) {
      cfg.lastEndpoint = snapshot.endpoint;
      if (!cfg.endpoint) {
        cfg.endpoint = snapshot.endpoint;
      }
    }
    delete cfg.cooldownUntil;
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
    saveDB(db);
    console.error(`Trading 212 sync failed for ${username}`, e);
  }
}

function stopTrading212Job(username) {
  const job = trading212Jobs.get(username);
  if (job) {
    job.stop();
    trading212Jobs.delete(username);
  }
}

function scheduleTrading212Job(username, user) {
  stopTrading212Job(username);
  const cfg = user?.trading212;
  if (!cfg || !cfg.enabled || !cfg.apiKey || !cfg.apiSecret) return;
  const parsed = parseSnapshotTime(cfg.snapshotTime);
  if (!parsed) return;
  const expression = `${parsed.minute} ${parsed.hour} * * *`;
  const timezone = cfg.timezone || 'Europe/London';
  const job = cron.schedule(expression, async () => {
    await syncTrading212ForUser(username, new Date());
  }, { timezone });
  trading212Jobs.set(username, job);
}

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// static
app.use('/static', express.static(path.join(__dirname, 'static')));
app.get('/serviceWorker.js', (req,res)=>{
  res.set('Content-Type','application/javascript').send(fs.readFileSync(path.join(__dirname,'serviceWorker.js'),'utf-8'));
});

// pages
app.get('/', (req,res)=>{ res.sendFile(path.join(__dirname,'index.html')); });
app.get('/login.html', (req,res)=>{ res.sendFile(path.join(__dirname,'login.html')); });
app.get('/signup.html', (req,res)=>{ res.sendFile(path.join(__dirname,'signup.html')); });
app.get('/profile.html', (req,res)=>{ res.sendFile(path.join(__dirname,'profile.html')); });
app.get('/manifest.json', (req,res)=>{ res.sendFile(path.join(__dirname,'manifest.json')); });

// --- auth api ---
function currentDateKey() {
  const now = new Date();
  const tzAdjusted = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return tzAdjusted.toISOString().slice(0, 10);
}

app.post('/api/signup', async (req,res)=>{
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

  const base = appBaseUrl(req);
  const verifyLink = `${base}/api/auth/verify-email?token=${token}`;
  try {
    await sendMail({
      to: email,
      subject: 'Confirm your P&L Calendar account',
      html: `<p>Welcome to the P&L Calendar!</p>
        <p>Click the link below to confirm your email address and finish setting up your account:</p>
        <p><a href="${verifyLink}">${verifyLink}</a></p>
        <p>If you didn't request this, you can ignore this message.</p>`
    });
  } catch (mailError) {
    console.error('Failed to send verification email:', mailError);
    delete db.users[email];
    delete db.verifications[token];
    saveDB(db);
    return res.status(500).json({ error: 'Unable to send verification email right now. Please try again.' });
  }

  const createdUser = db.users[email];
  if (createdUser) {
    if (!createdUser.security || typeof createdUser.security !== 'object') {
      createdUser.security = {};
    }
    if (!createdUser.security.verification || typeof createdUser.security.verification !== 'object') {
      createdUser.security.verification = {};
    }
    createdUser.security.verification.lastSentAt = new Date().toISOString();
    saveDB(db);
  }

  res.json({ ok: true });
});

app.post('/api/auth/resend-verification', async (req, res) => {
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
});

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
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = username;
  saveDB(db);
  res.cookie('auth_token', token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: !!process.env.RENDER, // Render uses HTTPS
    maxAge: 7*24*60*60*1000
  });
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

// --- user data ---
app.get('/api/portfolio', auth, (req,res)=>{
  const db = loadDB();
  const user = db.users[req.username];
  const mutated = ensureUserShape(user, req.username);
  const history = ensurePortfolioHistory(user);
  const normalized = normalizePortfolioHistory(user);
  const totals = computeNetDepositsTotals(user, history);
  const anchors = refreshAnchors(user, history);
  if (mutated || normalized || anchors.mutated) saveDB(db);
  res.json({
    portfolio: Number.isFinite(user.portfolio) ? user.portfolio : 0,
    initialNetDeposits: totals.baseline,
    netDepositsTotal: totals.total,
    profileComplete: !!user.profileComplete
  });
});

app.post('/api/portfolio', auth, (req,res)=>{
  const { portfolio } = req.body || {};
  if (typeof portfolio !== 'number' || isNaN(portfolio) || portfolio < 0) {
    return res.status(400).json({ error: 'Bad portfolio value' });
  }
  const db = loadDB();
  db.users[req.username].portfolio = portfolio;
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
  res.json({
    profileComplete: !!user.profileComplete,
    portfolio: Number.isFinite(user.portfolio) ? user.portfolio : portfolioBaseline || 0,
    initialNetDeposits: baseline,
    netDepositsTotal: total,
    today: currentDateKey(),
    netDepositsAnchor: user.netDepositsAnchor || null,
    username: user.username || req.username
  });
});

app.post('/api/profile', auth, (req,res)=>{
  const { portfolio, netDeposits, date } = req.body || {};
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
  const wasComplete = !!user.profileComplete;
  const history = ensurePortfolioHistory(user);
  normalizePortfolioHistory(user);
  const { baseline: previousBaseline, total: previousTotal } = computeNetDepositsTotals(user, history);
  let netDepositsNumber;
  if (!wasComplete) {
    if (netDeposits === '' || netDeposits === null || netDeposits === undefined) {
      return res.status(400).json({ error: 'Net deposits value is required' });
    }
    netDepositsNumber = Number(netDeposits);
    if (!Number.isFinite(netDepositsNumber)) {
      return res.status(400).json({ error: 'Invalid net deposits value' });
    }
  } else if (netDeposits === '' || netDeposits === null || netDeposits === undefined) {
    netDepositsNumber = previousTotal;
  } else {
    netDepositsNumber = Number(netDeposits);
    if (!Number.isFinite(netDepositsNumber)) {
      return res.status(400).json({ error: 'Invalid net deposits value' });
    }
  }
  const netDelta = netDepositsNumber - (wasComplete ? previousTotal : previousBaseline);
  const targetDate = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
    ? date
    : currentDateKey();
  if (!user.netDepositsAnchor) {
    user.netDepositsAnchor = targetDate;
  }
  const ym = targetDate.slice(0, 7);
  history[ym] ||= {};
  const existing = history[ym][targetDate] || {};
  let cashIn = Number.isFinite(existing.cashIn) ? Number(existing.cashIn) : 0;
  let cashOut = Number.isFinite(existing.cashOut) ? Number(existing.cashOut) : 0;
  if (wasComplete && netDelta !== 0) {
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
    user.initialNetDeposits = netDepositsNumber;
  }
  user.profileComplete = true;
  const { config: tradingCfg } = ensureTrading212Config(user);
  const totals = computeNetDepositsTotals(user, history);
  tradingCfg.lastNetDeposits = totals.total;
  refreshAnchors(user, history);
  saveDB(db);
  res.json({ ok: true, netDeposits: totals.total });
});

app.post('/api/account/password', auth, async (req, res) => {
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

app.delete('/api/profile', auth, (req, res) => {
  const db = loadDB();
  const username = req.username;
  const user = db.users[username];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  stopTrading212Job(username);
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
  res.json({
    enabled: !!cfg.enabled,
    snapshotTime: parsed ? `${parsed.hour}:${parsed.minute}` : '21:00',
    mode: cfg.mode || 'live',
    timezone: cfg.timezone || 'Europe/London',
    hasApiKey: !!cfg.apiKey,
    hasApiSecret: !!cfg.apiSecret,
    baseUrl: cfg.baseUrl || '',
    endpoint: cfg.endpoint || '/api/v0/equity/portfolio/summary',
    lastBaseUrl: cfg.lastBaseUrl || null,
    lastEndpoint: cfg.lastEndpoint || null,
    lastSyncAt: cfg.lastSyncAt || null,
    lastStatus: cfg.lastStatus || null,
    cooldownUntil: cfg.cooldownUntil || null
  });
});

app.post('/api/integrations/trading212', auth, async (req, res) => {
  const { enabled, apiKey, apiSecret, snapshotTime, mode, timezone, baseUrl, endpoint, runNow } = req.body || {};
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
  if (typeof timezone === 'string' && timezone.trim()) {
    cfg.timezone = timezone.trim();
  }
  if (baseUrl !== undefined) {
    if (typeof baseUrl === 'string' && baseUrl.trim()) {
      cfg.baseUrl = baseUrl.trim();
    } else if (baseUrl === '' || baseUrl === null) {
      cfg.baseUrl = '';
    }
  }
  if (endpoint !== undefined) {
    if (typeof endpoint === 'string' && endpoint.trim()) {
      cfg.endpoint = endpoint.startsWith('/')
        ? endpoint.trim()
        : `/${endpoint.trim().replace(/^\/+/, '')}`;
    } else if (endpoint === '' || endpoint === null) {
      cfg.endpoint = '/api/v0/equity/portfolio/summary';
    }
  }
  if (snapshotTime !== undefined) {
    const parsed = parseSnapshotTime(String(snapshotTime));
    if (!parsed) {
      return res.status(400).json({ error: 'Snapshot time must be HH:MM in 24-hour format' });
    }
    cfg.snapshotTime = `${parsed.hour}:${parsed.minute}`;
  }
  if (apiKey !== undefined) {
    if (typeof apiKey === 'string' && apiKey.trim()) {
      cfg.apiKey = apiKey.trim();
    } else if (apiKey === '') {
      cfg.apiKey = '';
    }
  }
  if (apiSecret !== undefined) {
    if (typeof apiSecret === 'string' && apiSecret.trim()) {
      cfg.apiSecret = apiSecret.trim();
    } else if (apiSecret === '') {
      cfg.apiSecret = '';
    }
  }
  if (cfg.enabled && (!cfg.apiKey || !cfg.apiSecret)) {
    return res.status(400).json({ error: 'Provide your Trading 212 API credentials to enable automation.' });
  }
  if (cfg.enabled && cfg.lastNetDeposits === undefined) {
    cfg.lastNetDeposits = totals.total;
  }
  if (!cfg.enabled) {
    delete cfg.cooldownUntil;
  }
  saveDB(db);
  scheduleTrading212Job(req.username, user);
  let responseCfg = cfg;
  if (runNow && cfg.enabled && cfg.apiKey && cfg.apiSecret) {
    await syncTrading212ForUser(req.username);
    const latestDb = loadDB();
    responseCfg = latestDb.users[req.username]?.trading212 || responseCfg;
  }
  res.json({
    enabled: !!responseCfg.enabled,
    snapshotTime: responseCfg.snapshotTime,
    mode: responseCfg.mode,
    timezone: responseCfg.timezone,
    hasApiKey: !!responseCfg.apiKey,
    hasApiSecret: !!responseCfg.apiSecret,
    baseUrl: responseCfg.baseUrl || '',
    endpoint: responseCfg.endpoint || '/api/v0/equity/portfolio/summary',
    lastBaseUrl: responseCfg.lastBaseUrl || null,
    lastEndpoint: responseCfg.lastEndpoint || null,
    lastSyncAt: responseCfg.lastSyncAt || null,
    lastStatus: responseCfg.lastStatus || null,
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
  const anchorDate = user.netDepositsAnchor || null;
  if (value === null || value === '') {
    delete history[ym][date];
    if (!Object.keys(history[ym]).length) {
      delete history[ym];
    }
  } else {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      return res.status(400).json({ error: 'Invalid portfolio value' });
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
    const existingPreBaseline = existingRecord?.preBaseline === true;
    const shouldFlagPreBaseline = existingPreBaseline || (anchorDate && date < anchorDate);
    const entryPayload = {
      end: num,
      cashIn: deposit,
      cashOut: withdrawal
    };
    if (shouldFlagPreBaseline) {
      entryPayload.preBaseline = true;
    }
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
  if (cachedRatesAt && (now - cachedRatesAt) < SIX_HOURS && cachedRates.USD) {
    return cachedRates;
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/GBP');
    if (!res.ok) throw new Error(`Rate fetch failed: ${res.status}`);
    const data = await res.json();
    const usd = data?.rates?.USD;
    if (usd && typeof usd === 'number') {
      cachedRates = { GBP: 1, USD: usd };
      cachedRatesAt = now;
    }
  } catch (e) {
    console.warn('Unable to refresh exchange rates', e.message || e);
    if (!cachedRates.USD) {
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

app.post('/api/trades', auth, async (req, res) => {
  const { date, entry, stop, riskPct, currency, note } = req.body || {};
  const tradeCurrency = currency === 'USD' ? 'USD' : 'GBP';
  const entryNum = Number(entry);
  const stopNum = Number(stop);
  const pctNum = Number(riskPct);
  if (!Number.isFinite(entryNum) || entryNum <= 0) {
    return res.status(400).json({ error: 'Enter a valid entry price' });
  }
  if (!Number.isFinite(stopNum) || stopNum <= 0) {
    return res.status(400).json({ error: 'Enter a valid stop-loss price' });
  }
  if (!Number.isFinite(pctNum) || pctNum <= 0) {
    return res.status(400).json({ error: 'Enter a valid risk percentage' });
  }
  const perUnitRisk = Math.abs(entryNum - stopNum);
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
  const riskAmountCurrency = portfolioInCurrency * (pctNum / 100);
  const sizeUnits = riskAmountCurrency / perUnitRisk;
  const positionCurrency = sizeUnits * entryNum;
  const riskAmountGBP = convertToGBP(riskAmountCurrency, tradeCurrency, rates);
  const positionGBP = convertToGBP(positionCurrency, tradeCurrency, rates);
  const targetDate = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
    ? date
    : currentDateKey();
  const trade = {
    id: crypto.randomBytes(8).toString('hex'),
    entry: entryNum,
    stop: stopNum,
    currency: tradeCurrency,
    riskPct: pctNum,
    perUnitRisk,
    sizeUnits,
    riskAmountCurrency,
    positionCurrency,
    riskAmountGBP,
    positionGBP,
    portfolioGBPAtCalc: portfolioGBP,
    portfolioCurrencyAtCalc: portfolioInCurrency,
    createdAt: new Date().toISOString()
  };
  if (typeof note === 'string' && note.trim()) {
    trade.note = note.trim();
  }
  journal[targetDate] ||= [];
  journal[targetDate].push(trade);
  if (journal[targetDate].length > 50) {
    journal[targetDate] = journal[targetDate].slice(-50);
  }
  saveDB(db);
  res.json({ ok: true, trade, date: targetDate });
});

app.get('/api/rates', auth, async (req,res)=>{
  const rates = await fetchRates();
  res.json({ rates, cachedAt: cachedRatesAt || Date.now() });
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

bootstrapTrading212Schedules();

app.listen(PORT, ()=>{
  console.log(`P&L Calendar server listening on port ${PORT}`);
});
