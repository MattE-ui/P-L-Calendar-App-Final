function normalizeTimeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return null;
  const [hours, minutes] = trimmed.split(':').map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function defaultNewsPreferences(userId, existing = null) {
  const nowIso = new Date().toISOString();
  return {
    userId,
    macroEnabled: existing?.macroEnabled ?? true,
    earningsEnabled: existing?.earningsEnabled ?? true,
    stockNewsEnabled: existing?.stockNewsEnabled ?? true,
    worldNewsEnabled: existing?.worldNewsEnabled ?? true,
    internalPostsEnabled: existing?.internalPostsEnabled ?? true,
    portfolioOnly: existing?.portfolioOnly ?? false,
    watchlistOnly: existing?.watchlistOnly ?? false,
    highImportanceOnly: existing?.highImportanceOnly ?? false,
    notifyPush: existing?.notifyPush ?? true,
    notifyInApp: existing?.notifyInApp ?? true,
    notifyEmail: existing?.notifyEmail ?? false,
    notifyImmediate: existing?.notifyImmediate ?? true,
    notifyOneDayBefore: existing?.notifyOneDayBefore ?? false,
    notifyOneHourBefore: existing?.notifyOneHourBefore ?? false,
    notifyFifteenMinutesBefore: existing?.notifyFifteenMinutesBefore ?? false,
    dailyDigestEnabled: existing?.dailyDigestEnabled ?? false,
    quietHoursStart: existing?.quietHoursStart || null,
    quietHoursEnd: existing?.quietHoursEnd || null,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso
  };
}

function createNewsPreferenceService({ loadDB, saveDB, ensureNewsEventTables, logger = console, resolveUserTickerUniverse = null }) {
  function getUserNewsPreferences(userId) {
    const db = loadDB();
    ensureNewsEventTables(db);
    let row = db.userNewsPreferences.find((item) => item.userId === userId);
    if (!row) {
      row = defaultNewsPreferences(userId);
      db.userNewsPreferences.push(row);
      saveDB(db);
    }
    logger.info('[NewsPreferences] read preferences.', { userId });
    return row;
  }

  function saveUserNewsPreferences(userId, payload = {}) {
    const db = loadDB();
    ensureNewsEventTables(db);
    let row = db.userNewsPreferences.find((item) => item.userId === userId);
    if (!row) {
      row = defaultNewsPreferences(userId);
      db.userNewsPreferences.push(row);
    }

    const booleanFields = [
      'macroEnabled', 'earningsEnabled', 'stockNewsEnabled', 'worldNewsEnabled', 'internalPostsEnabled',
      'portfolioOnly', 'watchlistOnly', 'highImportanceOnly', 'notifyPush', 'notifyInApp', 'notifyEmail',
      'notifyImmediate', 'notifyOneDayBefore', 'notifyOneHourBefore', 'notifyFifteenMinutesBefore',
      'dailyDigestEnabled'
    ];

    for (const field of booleanFields) {
      if (typeof payload[field] === 'boolean') row[field] = payload[field];
    }
    if (payload.quietHoursStart !== undefined) row.quietHoursStart = normalizeTimeString(payload.quietHoursStart);
    if (payload.quietHoursEnd !== undefined) row.quietHoursEnd = normalizeTimeString(payload.quietHoursEnd);
    row.updatedAt = new Date().toISOString();

    saveDB(db);
    logger.info('[NewsPreferences] write preferences.', { userId });
    return row;
  }

  function eventEnabledByType(preferences, event) {
    switch (event.eventType) {
      case 'fomc':
      case 'cpi':
      case 'rate_decision':
        return preferences.macroEnabled;
      case 'earnings':
        return preferences.earningsEnabled;
      case 'stock_news':
        return preferences.stockNewsEnabled;
      case 'world_news':
        return preferences.worldNewsEnabled;
      case 'internal_post':
        return preferences.internalPostsEnabled;
      default:
        return true;
    }
  }

  function shouldNotifyUserForEvent(userId, event) {
    const preferences = getUserNewsPreferences(userId);
    if (!event || event.isActive === false) return false;
    if (!eventEnabledByType(preferences, event)) return false;
    if (preferences.highImportanceOnly && Number(event.importance || 0) < 80) return false;

    if ((preferences.portfolioOnly || preferences.watchlistOnly) && typeof resolveUserTickerUniverse === 'function') {
      const allowedTickers = resolveUserTickerUniverse(userId);
      const eventTicker = String(event.canonicalTicker || event.ticker || '').toUpperCase();
      if (eventTicker && !allowedTickers.has(eventTicker)) return false;
    }

    return Boolean(preferences.notifyPush || preferences.notifyInApp || preferences.notifyEmail || preferences.dailyDigestEnabled);
  }

  return {
    getUserNewsPreferences,
    saveUserNewsPreferences,
    shouldNotifyUserForEvent,
    defaultNewsPreferences
  };
}

module.exports = {
  createNewsPreferenceService,
  defaultNewsPreferences
};
