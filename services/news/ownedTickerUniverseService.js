// Known SPAC renames and ticker aliases — keeps the owned ticker universe in sync
// with current canonical symbols even when stored trades still reference old identifiers.
const TICKER_RENAMES = new Map([
  ['SOI', 'SEI'],
  ['YNDX', 'NBIS'],
  ['DMYI', 'IONQ'],
  ['APPLE', 'AAPL']
]);

function normalizeTicker(raw) {
  const value = String(raw || '').trim().toUpperCase();
  if (!value) return '';
  const clean = value
    .replace(/[^A-Z0-9.\-_]/g, '')
    .replace(/(_[A-Z]{2,5}){1,2}$/, '');
  const normalized = clean || '';
  return TICKER_RENAMES.get(normalized) || normalized;
}

function resolveTickerCandidate(record = {}) {
  return record?.canonicalTicker
    || record?.ticker
    || record?.symbol
    || record?.trading212Ticker
    || record?.instrumentTicker
    || record?.contractDesc
    || record?.name
    || '';
}

function isTradeActive(trade = {}) {
  const status = String(trade?.status || '').trim().toLowerCase();
  if (!status) {
    const isExplicitlyClosed = Boolean(trade?.closedAt || trade?.closeDate || trade?.closedDate);
    if (isExplicitlyClosed) return false;
    return true;
  }
  return status === 'open';
}

function summarizeTrade(trade = {}) {
  return {
    id: trade?.id || trade?.tradeId || null,
    status: trade?.status ?? null,
    canonicalTicker: trade?.canonicalTicker ?? null,
    ticker: trade?.ticker ?? trade?.symbol ?? trade?.trading212Ticker ?? trade?.instrumentTicker ?? null
  };
}

function flattenTradeJournalForUser(user = {}, userId = '') {
  const trades = Array.isArray(user?.trades) ? user.trades : [];
  return trades
    .filter(t => t && typeof t === 'object')
    .map(t => ({
      ...t,
      __ownerUserId: userId,
      __tradeDate: typeof t.openDate === 'string' && t.openDate ? t.openDate
        : typeof t.entryDate === 'string' && t.entryDate ? t.entryDate
        : (typeof t.createdAt === 'string' && t.createdAt.length >= 10 ? t.createdAt.slice(0, 10) : ''),
      __tradeSource: 'user.trades'
    }));
}

function tradeMatchesUser(trade = {}, userId = '', user = null) {
  const expectedEmail = String(user?.email || '').trim().toLowerCase();
  const candidates = [
    { field: '__ownerUserId', value: trade?.__ownerUserId },
    { field: 'username', value: trade?.username },
    { field: 'userId', value: trade?.userId },
    { field: 'ownerUserId', value: trade?.ownerUserId },
    { field: 'email', value: trade?.email }
  ];

  for (const candidate of candidates) {
    if (candidate.value == null) continue;
    const raw = String(candidate.value).trim();
    if (!raw) continue;
    if (candidate.field === 'email') {
      if (expectedEmail && raw.toLowerCase() === expectedEmail) return { matched: true, field: candidate.field };
      continue;
    }
    if (raw === userId) return { matched: true, field: candidate.field };
  }
  return { matched: false, field: null };
}

function summarizePosition(position = {}) {
  return {
    symbol: position?.symbol ?? position?.ticker ?? null,
    canonicalTicker: position?.canonicalTicker ?? null,
    quantity: position?.position ?? position?.quantity ?? position?.size ?? null
  };
}

function deriveUserCurrentHoldingTickers(db, userId, logger = console) {
  const tickers = new Set();
  const user = db?.users?.[userId] || null;
  const journalTrades = flattenTradeJournalForUser(user, userId);
  const tableTrades = Array.isArray(db?.trades) ? db.trades : [];
  const trades = [...journalTrades, ...tableTrades];
  const diagnostics = {
    totalTradesInDb: trades.length,
    tradeSources: {
      userTrades: journalTrades.length,
      tradesTable: tableTrades.length
    },
    rawTradesFound: 0,
    tradesConsidered: 0,
    tradesIncluded: 0,
    tradeTickersExtracted: [],
    tradesMatchedByField: {},
    tradesExcluded: {
      ownerMismatch: [],
      inactive: [],
      invalidTicker: []
    },
    ibkrPositionsFound: 0,
    ibkrPositionsIncluded: 0,
    ibkrTickersExtracted: [],
    invalidSkippedTickers: []
  };

  for (const trade of trades) {
    const ownerMatch = tradeMatchesUser(trade, userId, user);
    if (!ownerMatch.matched) {
      diagnostics.tradesExcluded.ownerMismatch.push({
        reason: 'owner_mismatch',
        trade: summarizeTrade(trade),
        ownershipFields: {
          username: trade?.username ?? null,
          userId: trade?.userId ?? null,
          ownerUserId: trade?.ownerUserId ?? null,
          email: trade?.email ?? null,
          ownerFromJournal: trade?.__ownerUserId ?? null
        }
      });
      continue;
    }
    diagnostics.rawTradesFound += 1;
    diagnostics.tradesMatchedByField[ownerMatch.field] = (diagnostics.tradesMatchedByField[ownerMatch.field] || 0) + 1;
    diagnostics.tradesConsidered += 1;
    if (!isTradeActive(trade)) {
      diagnostics.tradesExcluded.inactive.push({ reason: 'inactive', trade: summarizeTrade(trade) });
      continue;
    }
    diagnostics.tradesIncluded += 1;

    const rawTicker = resolveTickerCandidate(trade);
    const normalized = normalizeTicker(rawTicker);
    if (!normalized) {
      diagnostics.invalidSkippedTickers.push({ source: 'trade', rawTicker, trade: summarizeTrade(trade) });
      diagnostics.tradesExcluded.invalidTicker.push({ reason: 'invalid_ticker', rawTicker, trade: summarizeTrade(trade) });
      continue;
    }
    diagnostics.tradeTickersExtracted.push(normalized);
    tickers.add(normalized);
  }

  const ibkrLivePositions = Array.isArray(user?.ibkr?.live?.positions)
    ? user.ibkr.live.positions
    : (Array.isArray(user?.ibkr?.livePositions) ? user.ibkr.livePositions : []);
  diagnostics.ibkrPositionsFound = ibkrLivePositions.length;
  for (const position of ibkrLivePositions) {
    const quantity = Number(position?.position ?? position?.quantity ?? position?.size ?? 0);
    if (Number.isFinite(quantity) && quantity === 0) continue;
    diagnostics.ibkrPositionsIncluded += 1;
    const rawTicker = resolveTickerCandidate(position);
    const normalized = normalizeTicker(rawTicker);
    if (!normalized) {
      diagnostics.invalidSkippedTickers.push({ source: 'ibkr', rawTicker, position: summarizePosition(position) });
      continue;
    }
    diagnostics.ibkrTickersExtracted.push(normalized);
    tickers.add(normalized);
  }

  const canonicalTickers = Array.from(tickers).sort();

  return {
    userId,
    tickers,
    tickerList: canonicalTickers,
    invalidCount: diagnostics.invalidSkippedTickers.length,
    diagnostics
  };
}

function resolveOwnedTickerUniverse({ db, logger = console } = {}) {
  const users = Object.keys(db?.users || {});
  const tableTrades = Array.isArray(db?.trades) ? db.trades : [];
  const journalTrades = users.flatMap((userId) => flattenTradeJournalForUser(db?.users?.[userId], userId));
  const totalTradesInDb = tableTrades.length + journalTrades.length;
  const perUserUniverse = [];
  const aggregateTickerSet = new Set();
  const tickerToUsers = new Map();
  let skippedInvalidTickers = 0;
  const aggregateDiagnostics = {
    totalTradesConsidered: 0,
    tradesIncluded: 0,
    tradeTickersExtracted: [],
    ibkrPositionsIncluded: 0,
    ibkrTickersExtracted: [],
    invalidSkippedTickers: []
  };

  for (const userId of users) {
    const userUniverse = deriveUserCurrentHoldingTickers(db, userId, logger);
    perUserUniverse.push(userUniverse);
    skippedInvalidTickers += userUniverse.invalidCount;
    aggregateDiagnostics.totalTradesConsidered += userUniverse.diagnostics?.tradesConsidered || 0;
    aggregateDiagnostics.tradesIncluded += userUniverse.diagnostics?.tradesIncluded || 0;
    aggregateDiagnostics.tradeTickersExtracted.push(...(userUniverse.diagnostics?.tradeTickersExtracted || []));
    aggregateDiagnostics.ibkrPositionsIncluded += userUniverse.diagnostics?.ibkrPositionsIncluded || 0;
    aggregateDiagnostics.ibkrTickersExtracted.push(...(userUniverse.diagnostics?.ibkrTickersExtracted || []));
    aggregateDiagnostics.invalidSkippedTickers.push(...(userUniverse.diagnostics?.invalidSkippedTickers || []));
    for (const ticker of userUniverse.tickerList) {
      aggregateTickerSet.add(ticker);
      const owners = tickerToUsers.get(ticker) || new Set();
      owners.add(userId);
      tickerToUsers.set(ticker, owners);
    }
  }

  const tickerOwnerMap = {};
  for (const [ticker, ownerSet] of tickerToUsers.entries()) {
    tickerOwnerMap[ticker] = Array.from(ownerSet).sort();
  }

  return {
    usersConsidered: users.length,
    perUserUniverse,
    aggregateTickers: Array.from(aggregateTickerSet).sort(),
    tickerOwnerMap,
    skippedInvalidTickers
  };
}

function isEventRelevantToUser(event, userId) {
  const relevance = Array.isArray(event?.metadataJson?.relevanceUserIds)
    ? event.metadataJson.relevanceUserIds
    : [];
  if (relevance.length) return relevance.includes(userId);
  return false;
}

module.exports = {
  normalizeTicker,
  deriveUserCurrentHoldingTickers,
  resolveOwnedTickerUniverse,
  isEventRelevantToUser
};
