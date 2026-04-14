#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createNewsEventService } = require('../services/news/newsEventService');
const { createNewsPreferenceService } = require('../services/news/newsPreferenceService');
const { createNewsReadModelService } = require('../services/news/newsReadModelService');
const { createNewsSourceRegistryService } = require('../services/news/newsSourceRegistry');
const { resolveOwnedTickerUniverse, normalizeTicker } = require('../services/news/ownedTickerUniverseService');
const { getHeadlineIngestionFeatureState } = require('../services/news/headlineIngestionService');

const DEFAULT_DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'storage');
const DB_PATH = process.env.DB_PATH || process.env.DATA_FILE || path.join(DEFAULT_DATA_DIR, 'data.json');

function ensureNewsEventTables(db) {
  db.users ||= {};
  db.trades ||= [];
  db.newsEvents ||= [];
  db.userNewsPreferences ||= [];
  db.watchlists ||= [];
  db.watchlistItems ||= [];
  db.newsIngestionStatus ||= {
    macro: { lastAttemptedRunAt: null, lastSuccessfulRunAt: null, lastDiagnostics: null, lastProviderStatuses: [] },
    earnings: { lastAttemptedRunAt: null, lastSuccessfulRunAt: null, lastDiagnostics: null, lastProviderStatuses: [] },
    headlines: { lastAttemptedRunAt: null, lastSuccessfulRunAt: null, lastDiagnostics: null, lastProviderStatuses: [], providerStates: {} }
  };
  db.newsIngestionStatus.macro ||= { lastAttemptedRunAt: null, lastSuccessfulRunAt: null, lastDiagnostics: null, lastProviderStatuses: [] };
  db.newsIngestionStatus.earnings ||= { lastAttemptedRunAt: null, lastSuccessfulRunAt: null, lastDiagnostics: null, lastProviderStatuses: [] };
  db.newsIngestionStatus.headlines ||= { lastAttemptedRunAt: null, lastSuccessfulRunAt: null, lastDiagnostics: null, lastProviderStatuses: [], providerStates: {} };
  db.newsIngestionStatus.headlines.providerStates ||= {};
}

function loadDbOrExit() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(JSON.stringify({ error: `DB file not found: ${DB_PATH}` }, null, 2));
    process.exit(1);
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  ensureNewsEventTables(db);
  return db;
}

function resolveUserWatchlistTickerUniverse(db, userId) {
  const tickers = new Set();
  const watchlists = Array.isArray(db.watchlists) ? db.watchlists : [];
  const items = Array.isArray(db.watchlistItems) ? db.watchlistItems : [];
  const ownedIds = new Set(watchlists.filter((w) => w?.owner_user_id === userId).map((w) => w.id).filter(Boolean));

  for (const item of items) {
    if (!ownedIds.has(item?.watchlist_id)) continue;
    const normalized = normalizeTicker(item?.canonical_ticker || item?.ticker);
    if (!normalized) continue;
    tickers.add(normalized);
  }
  return tickers;
}

function resolveRawHoldings(db, userId) {
  const rawTrades = (db.trades || []).filter((t) => t?.username === userId && String(t?.status || '').trim().toLowerCase() === 'open');
  const ibkrPositions = Array.isArray(db?.users?.[userId]?.ibkr?.live?.positions)
    ? db.users[userId].ibkr.live.positions
    : (Array.isArray(db?.users?.[userId]?.ibkr?.livePositions) ? db.users[userId].ibkr.livePositions : []);
  return { rawTrades, ibkrPositions };
}

function sumBy(list, keyFn) {
  return list.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { userId: '', limit: 25 };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--user' && args[i + 1]) out.userId = args[i + 1];
    if (args[i] === '--limit' && args[i + 1]) out.limit = Math.max(1, Math.min(100, Number(args[i + 1]) || 25));
  }
  return out;
}

function buildReport() {
  const { userId: requestedUser, limit } = parseArgs();
  const db = loadDbOrExit();
  const users = Object.keys(db.users || {});
  const userId = requestedUser || users[0] || null;

  const loadDB = () => db;
  const saveDB = () => {};
  const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

  const newsEventService = createNewsEventService({ loadDB, saveDB, ensureNewsEventTables, logger: silentLogger });
  const preferenceService = createNewsPreferenceService({
    loadDB,
    saveDB,
    ensureNewsEventTables,
    logger: silentLogger,
    resolveUserTickerUniverse: (uid) => {
      const universe = resolveOwnedTickerUniverse({ db, logger: silentLogger });
      return new Set((universe.perUserUniverse.find((u) => u.userId === uid)?.tickerList || []));
    },
    resolveUserWatchlistTickerUniverse: (uid) => resolveUserWatchlistTickerUniverse(db, uid)
  });
  const sourceRegistry = createNewsSourceRegistryService({ loadDB, saveDB, ensureNewsEventTables });
  const readModel = createNewsReadModelService({
    newsEventService,
    resolveUserTickerUniverse: (uid) => {
      const universe = resolveOwnedTickerUniverse({ db, logger: silentLogger });
      return new Set((universe.perUserUniverse.find((u) => u.userId === uid)?.tickerList || []));
    },
    resolveUserWatchlistTickerUniverse: (uid) => resolveUserWatchlistTickerUniverse(db, uid),
    getUserNewsPreferences: (uid) => preferenceService.getUserNewsPreferences(uid),
    listNewsSourceProfiles: () => sourceRegistry.listSources(),
    logger: silentLogger
  });

  const universe = resolveOwnedTickerUniverse({ db, logger: silentLogger });
  const userUniverse = userId ? universe.perUserUniverse.find((u) => u.userId === userId) : null;
  const { rawTrades, ibkrPositions } = userId ? resolveRawHoldings(db, userId) : { rawTrades: [], ibkrPositions: [] };

  const watchlistUniverse = userId ? resolveUserWatchlistTickerUniverse(db, userId) : new Set();
  const portfolioUniverse = new Set(userUniverse?.tickerList || []);
  const overlapTickers = Array.from(watchlistUniverse).filter((t) => portfolioUniverse.has(t));

  const activeEvents = (db.newsEvents || []).filter((event) => event?.isActive !== false);
  const earnings = activeEvents.filter((e) => e.eventType === 'earnings' || e.sourceType === 'earnings');
  const stockNews = activeEvents.filter((e) => e.eventType === 'stock_news');
  const worldNews = activeEvents.filter((e) => e.eventType === 'world_news');

  const now = Date.now();
  const userEarnings = userId
    ? earnings.filter((e) => (Array.isArray(e?.metadataJson?.relevanceUserIds) && e.metadataJson.relevanceUserIds.includes(userId))
      || (e.canonicalTicker && portfolioUniverse.has(String(e.canonicalTicker).toUpperCase())))
    : [];

  const forYou = userId ? readModel.getForYouNewsModel({ userId, limit }) : null;
  const calendar = userId ? readModel.getCalendarNewsModel({ userId, limit }) : null;
  const latest = userId ? readModel.getLatestNewsModel({ userId, limit }) : null;

  return {
    dbPath: DB_PATH,
    generatedAt: new Date().toISOString(),
    userContext: {
      requestedUser,
      resolvedUser: userId,
      usersCount: users.length
    },
    holdings: {
      aggregateUniverseCount: universe.aggregateTickers.length,
      aggregateUniverse: universe.aggregateTickers,
      userUniverse: {
        rawTradesCount: rawTrades.length,
        rawTradeTickers: rawTrades.map((t) => t.canonicalTicker || t.ticker || t.symbol || null),
        rawIbkrPositionsCount: ibkrPositions.length,
        rawIbkrPositionTickers: ibkrPositions.map((p) => p.canonicalTicker || p.ticker || p.symbol || p.contractDesc || null),
        canonicalPortfolioTickers: userUniverse?.tickerList || [],
        skippedInvalidTickers: userUniverse?.invalidCount || 0,
        watchlistTickers: Array.from(watchlistUniverse).sort(),
        overlapRemovedTickers: overlapTickers.sort()
      }
    },
    ingestionStatus: {
      earnings: db.newsIngestionStatus.earnings,
      headlines: db.newsIngestionStatus.headlines,
      headlineFeatureState: {
        ...getHeadlineIngestionFeatureState(),
        stockProviderUrlPresent: !!String(process.env.NEWS_STOCK_PROVIDER_URL || '').trim(),
        worldProviderUrlPresent: !!String(process.env.NEWS_WORLD_PROVIDER_URL || '').trim()
      }
    },
    storage: {
      activeEventCount: activeEvents.length,
      byEventType: sumBy(activeEvents, (e) => e.eventType || 'unknown'),
      earningsCount: earnings.length,
      stockNewsCount: stockNews.length,
      worldNewsCount: worldNews.length,
      userMatchingEarnings: {
        total: userEarnings.length,
        upcoming: userEarnings.filter((e) => Date.parse(e.scheduledAt || 0) >= now).length,
        past: userEarnings.filter((e) => Date.parse(e.scheduledAt || 0) < now).length
      }
    },
    readModel: userId
      ? {
        forYouSectionCounts: forYou?.sectionCounts || {},
        calendarSectionCounts: calendar?.sectionCounts || {},
        latestSectionCounts: latest?.sectionCounts || {},
        latestDiagnostics: latest?.diagnostics?.ranking || null,
        latestEmptyState: latest?.emptyState || null
      }
      : null,
    preferences: userId ? preferenceService.getUserNewsPreferences(userId) : null,
    notifications: {
      inAppCountForUser: userId ? (db.newsInAppNotifications || []).filter((row) => row.userId === userId).length : 0,
      outboxCountForUser: userId ? (db.newsNotificationOutbox || []).filter((row) => row.userId === userId).length : 0
    }
  };
}

const report = buildReport();
console.log(JSON.stringify(report, null, 2));
