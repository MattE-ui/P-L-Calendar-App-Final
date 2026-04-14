function normalizeTicker(raw) {
  const value = String(raw || '').trim().toUpperCase();
  if (!value) return '';
  const clean = value
    .replace(/[^A-Z0-9.\-_]/g, '')
    .replace(/(_[A-Z]{2,5}){1,2}$/, '');
  return clean || '';
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

function summarizePosition(position = {}) {
  return {
    symbol: position?.symbol ?? position?.ticker ?? null,
    canonicalTicker: position?.canonicalTicker ?? null,
    quantity: position?.position ?? position?.quantity ?? position?.size ?? null
  };
}

function deriveUserCurrentHoldingTickers(db, userId, logger = console) {
  const tickers = new Set();
  const diagnostics = {
    rawTradesFound: 0,
    tradesConsidered: 0,
    tradesIncluded: 0,
    tradeTickersExtracted: [],
    ibkrPositionsFound: 0,
    ibkrPositionsIncluded: 0,
    ibkrTickersExtracted: [],
    invalidSkippedTickers: []
  };

  const trades = Array.isArray(db?.trades) ? db.trades : [];
  diagnostics.rawTradesFound = trades.filter((trade) => trade?.username === userId).length;
  for (const trade of trades) {
    if (trade?.username !== userId) continue;
    diagnostics.tradesConsidered += 1;
    if (!isTradeActive(trade)) continue;
    diagnostics.tradesIncluded += 1;

    const rawTicker = resolveTickerCandidate(trade);
    const normalized = normalizeTicker(rawTicker);
    if (!normalized) {
      diagnostics.invalidSkippedTickers.push({ source: 'trade', rawTicker, trade: summarizeTrade(trade) });
      continue;
    }
    diagnostics.tradeTickersExtracted.push(normalized);
    tickers.add(normalized);
  }

  const user = db?.users?.[userId] || null;
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

  logger.info('[OwnedTickerUniverse] user universe resolved.', {
    userId,
    tickerCount: tickers.size,
    rawTradesFound: diagnostics.rawTradesFound,
    tradesConsidered: diagnostics.tradesConsidered,
    tradesIncluded: diagnostics.tradesIncluded,
    tradeTickersExtracted: diagnostics.tradeTickersExtracted,
    ibkrPositionsFound: diagnostics.ibkrPositionsFound,
    ibkrPositionsIncluded: diagnostics.ibkrPositionsIncluded,
    ibkrTickersExtracted: diagnostics.ibkrTickersExtracted,
    canonicalTickers,
    invalidSkippedTickers: diagnostics.invalidSkippedTickers
  });

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

  logger.info('[OwnedTickerUniverse] aggregate universe resolved.', {
    usersConsidered: users.length,
    userUniversesResolved: perUserUniverse.length,
    aggregateTickersResolved: aggregateTickerSet.size,
    totalTradesConsidered: aggregateDiagnostics.totalTradesConsidered,
    tradesIncluded: aggregateDiagnostics.tradesIncluded,
    tradeTickersExtracted: aggregateDiagnostics.tradeTickersExtracted,
    ibkrPositionsIncluded: aggregateDiagnostics.ibkrPositionsIncluded,
    ibkrTickersExtracted: aggregateDiagnostics.ibkrTickersExtracted,
    skippedInvalidTickers,
    invalidSkippedTickers: aggregateDiagnostics.invalidSkippedTickers,
    aggregateTickers: Array.from(aggregateTickerSet).sort()
  });

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
