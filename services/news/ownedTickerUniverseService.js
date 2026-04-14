function normalizeTicker(raw) {
  const value = String(raw || '').trim().toUpperCase();
  if (!value) return '';
  const clean = value.replace(/[^A-Z0-9.\-_]/g, '');
  return clean || '';
}

function deriveUserCurrentHoldingTickers(db, userId, logger = console) {
  const tickers = new Set();
  let invalidCount = 0;

  const trades = Array.isArray(db?.trades) ? db.trades : [];
  for (const trade of trades) {
    if (trade?.username !== userId) continue;
    const status = String(trade?.status || '').trim().toLowerCase();
    if (status && status !== 'open') continue;
    const normalized = normalizeTicker(trade?.canonicalTicker || trade?.ticker || trade?.symbol);
    if (!normalized) {
      invalidCount += 1;
      continue;
    }
    tickers.add(normalized);
  }

  const user = db?.users?.[userId] || null;
  const ibkrLivePositions = Array.isArray(user?.ibkr?.live?.positions)
    ? user.ibkr.live.positions
    : (Array.isArray(user?.ibkr?.livePositions) ? user.ibkr.livePositions : []);
  for (const position of ibkrLivePositions) {
    const quantity = Number(position?.position ?? position?.quantity ?? position?.size ?? 0);
    if (Number.isFinite(quantity) && quantity === 0) continue;
    const normalized = normalizeTicker(position?.canonicalTicker || position?.ticker || position?.symbol || position?.contractDesc);
    if (!normalized) {
      invalidCount += 1;
      continue;
    }
    tickers.add(normalized);
  }

  logger.info('[OwnedTickerUniverse] user universe resolved.', {
    userId,
    tickerCount: tickers.size,
    invalidCount
  });

  return {
    userId,
    tickers,
    tickerList: Array.from(tickers).sort(),
    invalidCount
  };
}

function resolveOwnedTickerUniverse({ db, logger = console } = {}) {
  const users = Object.keys(db?.users || {});
  const perUserUniverse = [];
  const aggregateTickerSet = new Set();
  const tickerToUsers = new Map();
  let skippedInvalidTickers = 0;

  for (const userId of users) {
    const userUniverse = deriveUserCurrentHoldingTickers(db, userId, logger);
    perUserUniverse.push(userUniverse);
    skippedInvalidTickers += userUniverse.invalidCount;
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
    skippedInvalidTickers
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
