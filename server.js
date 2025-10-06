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
  if (!user.portfolioHistory) {
    user.portfolioHistory = user.profits || {};
    delete user.profits;
  }
  return user.portfolioHistory;
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
        days[dateKey] = { end: record };
        mutated = true;
        continue;
      }
      if (typeof record === 'object') {
        if (record.end === undefined && typeof record.value === 'number') {
          days[dateKey] = { end: record.value };
          mutated = true;
          continue;
        }
        if (typeof record.end !== 'number') {
          delete days[dateKey];
          mutated = true;
        }
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
      const end = typeof record === 'object' && record !== null ? record.end : record;
      const num = Number(end);
      if (!Number.isFinite(num) || num < 0) continue;
      entries.push({ date: dateKey, end: num });
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
    snapshots[monthKey][entry.date] = { start, end: entry.end };
    baseline = entry.end;
  }
  return snapshots;
}

function getLatestClosing(history) {
  const entries = listChronologicalEntries(history);
  if (!entries.length) return null;
  return entries[entries.length - 1].end;
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
app.get('/manifest.json', (req,res)=>{ res.sendFile(path.join(__dirname,'manifest.json')); });

// --- auth api ---
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
    portfolio: isNaN(initialPortfolio) ? 0 : initialPortfolio,
    initialPortfolio: isNaN(initialPortfolio) ? 0 : initialPortfolio,
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
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = username;
  saveDB(db);
  res.cookie('auth_token', token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: !!process.env.RENDER, // Render uses HTTPS
    maxAge: 7*24*60*60*1000
  });
  res.json({ ok: true });
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
  res.json({ portfolio: user.portfolio || 0 });
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

// profits endpoints
app.get('/api/pl', auth, (req,res)=>{
  const { year, month } = req.query;
  const db = loadDB();
  const user = db.users[req.username];
  const history = ensurePortfolioHistory(user);
  let mutated = normalizePortfolioHistory(user);
  if (user.initialPortfolio === undefined) {
    user.initialPortfolio = Number.isFinite(user.portfolio) ? user.portfolio : 0;
    mutated = true;
  }
  const snapshots = buildSnapshots(history, user.initialPortfolio);
  if (mutated) saveDB(db);
  if (year && month) {
    const key = `${year}-${String(month).padStart(2,'0')}`;
    return res.json(snapshots[key] || {});
  }
  res.json(snapshots);
});

app.post('/api/pl', auth, (req,res)=>{
  const { date, value } = req.body || {};
  if (!date) return res.status(400).json({ error: 'Missing date' });
  const db = loadDB();
  const user = db.users[req.username];
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
    history[ym][date] = { end: num };
  }
  const latest = getLatestClosing(history);
  if (latest !== null) {
    user.portfolio = latest;
  } else if (Number.isFinite(user.initialPortfolio)) {
    user.portfolio = user.initialPortfolio;
  } else {
    user.portfolio = 0;
  }
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
