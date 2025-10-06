require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// --- helpers ---
function loadDB() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const db = JSON.parse(raw);
    db.users ||= {};
    db.sessions ||= {};
    return db;
  } catch (e) {
    return { users: {}, sessions: {} };
  }
}
function saveDB(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

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

function ensureUserShape(user) {
  if (!user) return false;
  let mutated = false;
  ensurePortfolioHistory(user);
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
  return mutated;
}

function normalizePortfolioHistory(user) {
  const history = ensurePortfolioHistory(user);
  let mutated = false;
  for (const [monthKey, days] of Object.entries(history)) {
    for (const [dateKey, record] of Object.entries(days)) {
      if (record === null || record === undefined) {
        delete days[dateKey];
        mutated = true;
        continue;
      }
      if (typeof record === 'number') {
        days[dateKey] = { end: record, cashIn: 0, cashOut: 0 };
        mutated = true;
        continue;
      }
      if (typeof record === 'object') {
        if (record.end === undefined && typeof record.value === 'number') {
          days[dateKey] = { end: record.value, cashIn: 0, cashOut: 0 };
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
        if (cashIn !== cashInRaw || cashOut !== cashOutRaw || record.start !== undefined) {
          mutated = true;
        }
        days[dateKey] = { end, cashIn, cashOut };
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
      entries.push({
        date: dateKey,
        end,
        cashIn: Number.isFinite(cashIn) && cashIn >= 0 ? cashIn : 0,
        cashOut: Number.isFinite(cashOut) && cashOut >= 0 ? cashOut : 0
      });
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}

function buildSnapshots(history, initial) {
  const entries = listChronologicalEntries(history);
  const snapshots = {};
  let baseline = Number.isFinite(initial) ? initial : null;
  for (const entry of entries) {
    const monthKey = entry.date.slice(0, 7);
    if (!snapshots[monthKey]) snapshots[monthKey] = {};
    const start = baseline !== null ? baseline : entry.end;
    snapshots[monthKey][entry.date] = {
      start,
      end: entry.end,
      cashIn: entry.cashIn,
      cashOut: entry.cashOut
    };
    baseline = entry.end;
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
  const { username, password, portfolio } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const initialPortfolio = Number(portfolio);
  if (portfolio !== undefined && (isNaN(initialPortfolio) || initialPortfolio < 0)) {
    return res.status(400).json({ error: 'Invalid portfolio value' });
  }
  const db = loadDB();
  if (db.users[username]) return res.status(409).json({ error: 'User already exists' });
  const passwordHash = await bcrypt.hash(password, 10);
  db.users[username] = {
    passwordHash,
    portfolio: 0,
    initialPortfolio: 0,
    initialNetDeposits: 0,
    profileComplete: false,
    portfolioHistory: {}
  };
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/login', async (req,res)=>{
  const { username, password } = req.body || {};
  const db = loadDB();
  const user = db.users[username];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  ensureUserShape(user);
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
  const mutated = ensureUserShape(user);
  if (mutated) saveDB(db);
  res.json({
    portfolio: Number.isFinite(user.portfolio) ? user.portfolio : 0,
    initialNetDeposits: Number.isFinite(user.initialNetDeposits) ? user.initialNetDeposits : 0,
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
  let mutated = ensureUserShape(user);
  const history = ensurePortfolioHistory(user);
  if (normalizePortfolioHistory(user)) mutated = true;
  const { baseline, mutated: anchorMutated } = refreshAnchors(user, history);
  if (anchorMutated) mutated = true;
  if (mutated) saveDB(db);
  res.json({
    profileComplete: !!user.profileComplete,
    portfolio: Number.isFinite(user.portfolio) ? user.portfolio : baseline || 0,
    initialNetDeposits: Number.isFinite(user.initialNetDeposits) ? user.initialNetDeposits : 0,
    today: currentDateKey()
  });
});

app.post('/api/profile', auth, (req,res)=>{
  const { portfolio, netDeposits, date } = req.body || {};
  if (portfolio === '' || portfolio === null || portfolio === undefined) {
    return res.status(400).json({ error: 'Portfolio value is required' });
  }
  if (netDeposits === '' || netDeposits === null || netDeposits === undefined) {
    return res.status(400).json({ error: 'Net deposits value is required' });
  }
  const portfolioNumber = Number(portfolio);
  const netDepositsNumber = Number(netDeposits);
  if (!Number.isFinite(portfolioNumber) || portfolioNumber < 0) {
    return res.status(400).json({ error: 'Invalid portfolio value' });
  }
  if (!Number.isFinite(netDepositsNumber)) {
    return res.status(400).json({ error: 'Invalid net deposits value' });
  }
  const targetDate = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
    ? date
    : currentDateKey();
  const db = loadDB();
  const user = db.users[req.username];
  if (!user) return res.status(404).json({ error: 'User not found' });
  ensureUserShape(user);
  const history = ensurePortfolioHistory(user);
  normalizePortfolioHistory(user);
  const ym = targetDate.slice(0, 7);
  history[ym] ||= {};
  const existing = history[ym][targetDate] || {};
  history[ym][targetDate] = {
    end: portfolioNumber,
    cashIn: Number.isFinite(existing.cashIn) ? Number(existing.cashIn) : 0,
    cashOut: Number.isFinite(existing.cashOut) ? Number(existing.cashOut) : 0
  };
  user.initialNetDeposits = netDepositsNumber;
  user.profileComplete = true;
  refreshAnchors(user, history);
  saveDB(db);
  res.json({ ok: true });
});

// profits endpoints
app.get('/api/pl', auth, (req,res)=>{
  const { year, month } = req.query;
  const db = loadDB();
  const user = db.users[req.username];
  ensureUserShape(user);
  if (!user.profileComplete) {
    return res.status(409).json({ error: 'Profile incomplete', code: 'profile_incomplete' });
  }
  const history = ensurePortfolioHistory(user);
  let mutated = normalizePortfolioHistory(user);
  const { baseline, mutated: anchorMutated } = refreshAnchors(user, history);
  if (anchorMutated) mutated = true;
  const snapshots = buildSnapshots(history, baseline);
  if (mutated) saveDB(db);
  if (year && month) {
    const key = `${year}-${String(month).padStart(2,'0')}`;
    return res.json(snapshots[key] || {});
  }
  res.json(snapshots);
});

app.post('/api/pl', auth, (req,res)=>{
  const { date, value, cashIn, cashOut } = req.body || {};
  if (!date) return res.status(400).json({ error: 'Missing date' });
  const db = loadDB();
  const user = db.users[req.username];
  ensureUserShape(user);
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
    history[ym][date] = {
      end: num,
      cashIn: deposit,
      cashOut: withdrawal
    };
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

app.get('/api/rates', auth, async (req,res)=>{
  const rates = await fetchRates();
  res.json({ rates, cachedAt: cachedRatesAt || Date.now() });
});

// --- optional daily sync with Trading 212 at 21:00 Europe/London ---
const T212_API_KEY = process.env.T212_API_KEY;
async function syncTrading212ForUser(username) {
  if (!T212_API_KEY) return; // quietly skip if not configured
  // Placeholder: call Trading212 endpoints if available to fetch P&L.
  // The real implementation depends on the official API you enable.
  return;
}
// Run every day at 21:00 London time
cron.schedule('0 21 * * *', async ()=>{
  try {
    const db = loadDB();
    await Promise.all(Object.keys(db.users).map(syncTrading212ForUser));
  } catch (e) {
    console.error('Sync error', e);
  }
}, { timezone: 'Europe/London' });

app.listen(PORT, ()=>{
  console.log(`P&L Calendar server listening on port ${PORT}`);
});
