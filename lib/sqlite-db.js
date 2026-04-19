'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'storage', 'veracity.db');
const ERROR_LOG = process.env.SQLITE_ERROR_LOG || path.join(__dirname, '..', 'storage', 'sqlite-errors.log');

let _db = null;

function getDb() {
  if (!_db) {
    fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });
    _db = new Database(SQLITE_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

// New user columns added in schema v2. Each is attempted via ALTER TABLE so
// existing databases upgrade without being wiped.
const USER_V2_COLUMNS = [
  ['portfolio_history_json',          'TEXT'],
  ['portfolio',                        'REAL'],
  ['portfolio_currency',               'TEXT'],
  ['portfolio_source',                 'TEXT'],
  ['initial_portfolio',                'REAL'],
  ['initial_net_deposits',             'REAL'],
  ['manual_portfolio_baseline',        'REAL'],
  ['manual_net_deposits_baseline',     'REAL'],
  ['manual_baseline_updated_at',       'TEXT'],
  ['net_deposits_anchor',              'TEXT'],
  ['last_portfolio_sync_at',           'TEXT'],
  ['investor_accounts_enabled',        'INTEGER'],
  ['investor_portal_enabled_at',       'TEXT'],
  ['multi_trading_accounts_enabled',   'INTEGER'],
  ['friend_code',                      'TEXT'],
  ['trading_accounts_json',            'TEXT'],
  ['weekly_recaps_json',               'TEXT'],
  ['review_planning_json',             'TEXT'],
  ['transaction_prefs_json',           'TEXT'],
  ['transaction_profiles_json',        'TEXT'],
  ['ui_prefs_json',                    'TEXT'],
  ['ibkr_snapshots_json',              'TEXT'],
  ['import_batches_json',              'TEXT'],
];

function initDB() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT,
      nickname TEXT,
      role TEXT DEFAULT 'user',
      guest INTEGER DEFAULT 0,
      expires_at TEXT,
      avatar_url TEXT,
      profile_complete INTEGER DEFAULT 0,
      created_at TEXT,
      settings_json TEXT,
      trading212_json TEXT,
      ibkr_json TEXT,
      security_json TEXT,
      prefs_json TEXT,
      risk_settings_json TEXT,
      portfolio_history_json TEXT,
      portfolio REAL,
      portfolio_currency TEXT,
      portfolio_source TEXT,
      initial_portfolio REAL,
      initial_net_deposits REAL,
      manual_portfolio_baseline REAL,
      manual_net_deposits_baseline REAL,
      manual_baseline_updated_at TEXT,
      net_deposits_anchor TEXT,
      last_portfolio_sync_at TEXT,
      investor_accounts_enabled INTEGER,
      investor_portal_enabled_at TEXT,
      multi_trading_accounts_enabled INTEGER,
      friend_code TEXT,
      trading_accounts_json TEXT,
      weekly_recaps_json TEXT,
      review_planning_json TEXT,
      transaction_prefs_json TEXT,
      transaction_profiles_json TEXT,
      ui_prefs_json TEXT,
      ibkr_snapshots_json TEXT,
      import_batches_json TEXT
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      ticker TEXT,
      direction TEXT,
      trade_type TEXT,
      asset_class TEXT,
      status TEXT,
      entry_price REAL,
      stop_loss REAL,
      quantity REAL,
      remaining_qty REAL,
      pnl REAL,
      realized_pnl_gbp REAL,
      r_multiple REAL,
      risk_amount REAL,
      entry_date TEXT,
      close_date TEXT,
      account TEXT,
      note TEXT,
      strategy_tag TEXT,
      executions_json TEXT,
      t212_metadata_json TEXT,
      ibkr_metadata_json TEXT,
      extra_json TEXT,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (username) REFERENCES users(username)
    );
    CREATE INDEX IF NOT EXISTS idx_trades_username ON trades(username);
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(username, status);
    CREATE INDEX IF NOT EXISTS idx_trades_entry_date ON trades(username, entry_date);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at TEXT,
      expires_at TEXT,
      user_agent TEXT,
      ip TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);

    CREATE TABLE IF NOT EXISTS group_chat_messages (
      id TEXT PRIMARY KEY,
      group_chat_id TEXT NOT NULL,
      sender_user_id TEXT,
      sender_nickname TEXT,
      message_type TEXT,
      content TEXT,
      raw_text TEXT,
      entities_json TEXT,
      mentions_json TEXT,
      attachments_json TEXT,
      reply_to_message_id TEXT,
      metadata_json TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON group_chat_messages(group_chat_id, created_at);

    CREATE TABLE IF NOT EXISTS news_events (
      id TEXT PRIMARY KEY,
      source_type TEXT,
      event_type TEXT,
      title TEXT,
      summary TEXT,
      ticker TEXT,
      canonical_ticker TEXT,
      importance INTEGER,
      scheduled_at TEXT,
      published_at TEXT,
      source_name TEXT,
      source_url TEXT,
      dedupe_key TEXT UNIQUE,
      status TEXT,
      is_active INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_news_ticker ON news_events(canonical_ticker);
    CREATE INDEX IF NOT EXISTS idx_news_published ON news_events(published_at);

    CREATE TABLE IF NOT EXISTS collections (
      collection TEXT NOT NULL,
      record_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      updated_at TEXT,
      PRIMARY KEY (collection, record_id)
    );
    CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(collection);
  `);

  // Upgrade existing databases: add any v2 columns that don't exist yet.
  // ALTER TABLE fails if the column already exists, so each is wrapped individually.
  for (const [col, type] of USER_V2_COLUMNS) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
    } catch (_) {
      // Column already exists — safe to ignore
    }
  }

  return db;
}

// Collections handled by dedicated tables — excluded from the generic collections sync
const KNOWN_COLLECTIONS = new Set(['users', 'sessions', 'sessionMetadata', 'groupChatMessages', 'newsEvents']);

// Collections stored in the collections table that should be reconstructed as arrays.
// Non-numeric record_ids are the item's natural id (item.id / item.token / item.key).
const ARRAY_COLLECTIONS = new Set([
  // from loadDB() explicit init
  'instrumentMappings', 'brokerInstrumentRegistry', 'instrumentResolutionHistory',
  'brokerSnapshots', 'ibkrConnectorTokens', 'ibkrConnectorKeys',
  'investorProfiles', 'investorLogins', 'investorProfitSplits', 'investorCashflows',
  'masterValuations', 'investorInvites',
  // from ensureNotificationTables
  'notificationDevices', 'notificationEvents', 'notificationPushDedupe', 'notificationPreferences',
  // from ensureNewsEventTables
  'newsSourceRegistry', 'userNewsPreferences', 'userEventDeliveryLog',
  'newsNotificationOutbox', 'newsInAppNotifications',
  // from ensureSiteAnnouncementTables
  'siteAnnouncements', 'siteAnnouncementStates',
  // from ensureSocialTables
  'socialProfiles', 'socialSettings', 'friendRequests', 'friendships',
  'tradeShareSettings', 'leaderboardStats', 'socialEventLog',
  'tradeGroups', 'tradeGroupMembers', 'tradeGroupAlerts', 'tradeGroupNotifications',
  'tradeGroupInvites', 'tradeGroupAnnouncements', 'tradeGroupPendingAlerts',
  'watchlists', 'watchlistItems', 'tradeGroupWatchlists',
  'groupChats', 'groupChatReadStates', 'groupChatRoles', 'groupChatRoleAssignments', 'groupChatTypingStates',
  // confirmed by inspection of live data
  'connectorTokens', 'investorPermissions',
]);

// Collections stored in the collections table that should be reconstructed as keyed objects.
// record_id becomes the object key; data_json the value.
const OBJECT_COLLECTIONS = new Set([
  'verifications', 'emailChangeRequests', 'investorSessions',
  'twoFactorSetups', 'twoFactorLoginChallenges', 'watchlistPreviousCloseReferences',
  'newsNotificationStatus', 'newsDiagnosticsSnapshots',
  'newsIngestionStatus', 'newsEventIndexCatalog',
]);

function j(val) {
  return val === undefined || val === null ? null : JSON.stringify(val);
}

function parseJson(raw) {
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Replicates the server.js normalizeExecutionLegs → summarizeExecutionLegs →
// convertToGBP pipeline so that syncFromJSON can compute realized PnL without
// depending on server.js or live FX rates.
// For non-GBP trades without a pre-computed ppl, returns null (rates unavailable).
function computeTradeRealizedPnlGBP(trade) {
  // T212 / pre-computed value — highest priority
  const ppl = Number(trade?.ppl);
  if (Number.isFinite(ppl)) return ppl;

  const isIbkrOption = trade?.source === 'ibkr' && (trade?.assetClass === 'options' || trade?.ibkrAssetClass === 'OPT');
  if (isIbkrOption) {
    console.log('[PnL Debug]', {
      ticker: trade.ticker,
      id: trade.id,
      hasExecutions: Array.isArray(trade.executions) && trade.executions.length > 0,
      executionCount: trade.executions?.length,
      entry: trade.entry,
      entryPrice: trade.entryPrice,
      sizeUnits: trade.sizeUnits,
      quantity: trade.quantity,
      closePrice: trade.closePrice,
      assetClass: trade.assetClass,
      ibkrAssetClass: trade.ibkrAssetClass,
      ibkrMultiplier: trade.ibkrMultiplier,
    });
  }

  // Build execution legs from executions array or scalar fields
  const entries = [];
  const exits = [];

  const addLeg = (raw, fallbackSide) => {
    if (!raw || typeof raw !== 'object') return;
    const sideRaw = String(raw.side || fallbackSide || '').toLowerCase();
    const side = sideRaw === 'exit' ? 'exit' : (sideRaw === 'entry' ? 'entry' : '');
    const qty = Number(raw.quantity ?? raw.units ?? raw.contracts);
    const price = Number(raw.price);
    if (!side || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) return;
    const fee = Number(raw.fee);
    const leg = { qty, price, fee: (Number.isFinite(fee) && fee >= 0) ? fee : 0 };
    if (side === 'entry') entries.push(leg);
    else exits.push(leg);
  };

  if (Array.isArray(trade?.executions) && trade.executions.length) {
    trade.executions.forEach(leg => addLeg(leg));
  } else {
    const entryPrice = Number(trade?.entry ?? trade?.entryPrice);
    const entryQty = Number(trade?.enteredUnits ?? trade?.initialSizeUnits ?? trade?.sizeUnits);
    if (Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(entryQty) && entryQty > 0) {
      entries.push({ qty: entryQty, price: entryPrice, fee: 0 });
    }
    const partials = Array.isArray(trade?.partialCloses) ? trade.partialCloses : [];
    partials.forEach(c => addLeg({ side: 'exit', quantity: c?.units, price: c?.price }, 'exit'));
    if (trade?.status === 'closed' && Number.isFinite(Number(trade?.closePrice))) {
      const partialQty = partials.reduce((s, c) => s + (Number(c?.units) || 0), 0);
      const remaining = (Number.isFinite(entryQty) ? entryQty : 0) - partialQty;
      if (remaining > 0) {
        exits.push({ qty: remaining, price: Number(trade.closePrice), fee: 0 });
      }
    }
  }

  const totalEntered = entries.reduce((s, l) => s + l.qty, 0);
  const totalExited = exits.reduce((s, l) => s + l.qty, 0);

  if (totalEntered > 0 && totalExited > 0) {
    // Execution leg quantities for IBKR CSV imports are already expanded by the
    // contract multiplier (e.g. 1 SPY options contract → quantity: 100 shares).
    // Do NOT apply ibkrMultiplier here — that would double-count it.
    const weightedEntryValue = entries.reduce((s, l) => s + l.qty * l.price, 0);
    const weightedExitValue = exits.reduce((s, l) => s + l.qty * l.price, 0);
    const avgEntry = weightedEntryValue / totalEntered;
    const direction = trade?.direction === 'short' ? 'short' : 'long';
    const grossPnl = direction === 'long'
      ? weightedExitValue - (avgEntry * totalExited)
      : (avgEntry * totalExited) - weightedExitValue;
    const fees = entries.reduce((s, l) => s + l.fee, 0) + exits.reduce((s, l) => s + l.fee, 0);
    const netPnl = grossPnl - fees;
    if (Number.isFinite(netPnl)) {
      const resultGbp = convertPnlToGBP(netPnl, trade);
      if (isIbkrOption) console.log('[PnL Debug] returning from execution-legs path:', resultGbp);
      return resultGbp;
    }
  }

  // Final fallback — old-style scalar fields (entryPrice, quantity, closePrice).
  // These trades have no executions array and use field names that pre-date the
  // entry/sizeUnits rename, so the execution-legs path above yields no legs.
  // Scalar quantity is in contracts (not pre-expanded), so multiplier IS needed here.
  const entryP = Number(trade?.entryPrice);
  const qty    = Number(trade?.quantity);
  const closeP = Number(trade?.closePrice);
  if (Number.isFinite(entryP) && entryP > 0 && Number.isFinite(qty) && qty > 0 && Number.isFinite(closeP) && closeP >= 0) {
    const dir = trade?.direction === 'short' ? -1 : 1;
    const multiplier = (trade?.assetClass === 'options' || trade?.ibkrAssetClass === 'OPT')
      ? Number(trade?.ibkrMultiplier ?? trade?.multiplier ?? 100)
      : 1;
    const grossPnlNative = (closeP - entryP) * qty * dir * multiplier;
    const fees = Number(trade?.fees) || 0;
    const netPnlNative = grossPnlNative - fees;
    const resultGbp = convertPnlToGBP(netPnlNative, trade);
    if (isIbkrOption) console.log('[PnL Debug] returning from scalar fallback:', resultGbp);
    return resultGbp;
  }

  if (isIbkrOption) console.log('[PnL Debug] returning null');
  return null;
}

// Shared FX conversion used by computeTradeRealizedPnlGBP.
// Path 1 — GBP trades: identity.
// Path 2 — T212: positionGBP/positionCurrency ratio stored on the trade.
// Path 3 — IBKR: FXRateToBase from the raw import row (rate × native = GBP).
function convertPnlToGBP(netPnlNative, trade) {
  const currency = trade?.currency || 'GBP';
  if (currency === 'GBP') return netPnlNative;
  const posGBP = Number(trade?.positionGBP);
  const posCurr = Number(trade?.positionCurrency);
  if (Number.isFinite(posGBP) && Number.isFinite(posCurr) && posCurr !== 0) {
    return netPnlNative * (posGBP / posCurr);
  }
  const ibkrFxRate = parseFloat(trade?.rawImportRow?.FXRateToBase);
  if (Number.isFinite(ibkrFxRate) && ibkrFxRate > 0) {
    return netPnlNative * ibkrFxRate;
  }
  return null;
}

function syncFromJSON(db) {
  const sqliteDb = getDb();
  const now = new Date().toISOString();

  const upsertUser = sqliteDb.prepare(`
    INSERT INTO users (
      username, password_hash, nickname, role, guest, expires_at, avatar_url,
      profile_complete, created_at, settings_json, trading212_json, ibkr_json,
      security_json, prefs_json, risk_settings_json,
      portfolio_history_json, portfolio, portfolio_currency, portfolio_source,
      initial_portfolio, initial_net_deposits, manual_portfolio_baseline,
      manual_net_deposits_baseline, manual_baseline_updated_at, net_deposits_anchor,
      last_portfolio_sync_at, investor_accounts_enabled, investor_portal_enabled_at,
      multi_trading_accounts_enabled, friend_code, trading_accounts_json,
      weekly_recaps_json, review_planning_json, transaction_prefs_json,
      transaction_profiles_json, ui_prefs_json, ibkr_snapshots_json, import_batches_json
    ) VALUES (
      @username, @password_hash, @nickname, @role, @guest, @expires_at, @avatar_url,
      @profile_complete, @created_at, @settings_json, @trading212_json, @ibkr_json,
      @security_json, @prefs_json, @risk_settings_json,
      @portfolio_history_json, @portfolio, @portfolio_currency, @portfolio_source,
      @initial_portfolio, @initial_net_deposits, @manual_portfolio_baseline,
      @manual_net_deposits_baseline, @manual_baseline_updated_at, @net_deposits_anchor,
      @last_portfolio_sync_at, @investor_accounts_enabled, @investor_portal_enabled_at,
      @multi_trading_accounts_enabled, @friend_code, @trading_accounts_json,
      @weekly_recaps_json, @review_planning_json, @transaction_prefs_json,
      @transaction_profiles_json, @ui_prefs_json, @ibkr_snapshots_json, @import_batches_json
    )
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      nickname = excluded.nickname,
      role = excluded.role,
      guest = excluded.guest,
      expires_at = excluded.expires_at,
      avatar_url = excluded.avatar_url,
      profile_complete = excluded.profile_complete,
      created_at = excluded.created_at,
      settings_json = excluded.settings_json,
      trading212_json = excluded.trading212_json,
      ibkr_json = excluded.ibkr_json,
      security_json = excluded.security_json,
      prefs_json = excluded.prefs_json,
      risk_settings_json = excluded.risk_settings_json,
      portfolio_history_json = excluded.portfolio_history_json,
      portfolio = excluded.portfolio,
      portfolio_currency = excluded.portfolio_currency,
      portfolio_source = excluded.portfolio_source,
      initial_portfolio = excluded.initial_portfolio,
      initial_net_deposits = excluded.initial_net_deposits,
      manual_portfolio_baseline = excluded.manual_portfolio_baseline,
      manual_net_deposits_baseline = excluded.manual_net_deposits_baseline,
      manual_baseline_updated_at = excluded.manual_baseline_updated_at,
      net_deposits_anchor = excluded.net_deposits_anchor,
      last_portfolio_sync_at = excluded.last_portfolio_sync_at,
      investor_accounts_enabled = excluded.investor_accounts_enabled,
      investor_portal_enabled_at = excluded.investor_portal_enabled_at,
      multi_trading_accounts_enabled = excluded.multi_trading_accounts_enabled,
      friend_code = excluded.friend_code,
      trading_accounts_json = excluded.trading_accounts_json,
      weekly_recaps_json = excluded.weekly_recaps_json,
      review_planning_json = excluded.review_planning_json,
      transaction_prefs_json = excluded.transaction_prefs_json,
      transaction_profiles_json = excluded.transaction_profiles_json,
      ui_prefs_json = excluded.ui_prefs_json,
      ibkr_snapshots_json = excluded.ibkr_snapshots_json,
      import_batches_json = excluded.import_batches_json
  `);

  const upsertTrade = sqliteDb.prepare(`
    INSERT INTO trades (id, username, ticker, direction, trade_type, asset_class, status,
      entry_price, stop_loss, quantity, remaining_qty, pnl, realized_pnl_gbp, r_multiple,
      risk_amount, entry_date, close_date, account, note, strategy_tag,
      executions_json, t212_metadata_json, ibkr_metadata_json, extra_json, created_at, updated_at)
    VALUES (@id, @username, @ticker, @direction, @trade_type, @asset_class, @status,
      @entry_price, @stop_loss, @quantity, @remaining_qty, @pnl, @realized_pnl_gbp, @r_multiple,
      @risk_amount, @entry_date, @close_date, @account, @note, @strategy_tag,
      @executions_json, @t212_metadata_json, @ibkr_metadata_json, @extra_json, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      ticker = excluded.ticker,
      direction = excluded.direction,
      trade_type = excluded.trade_type,
      asset_class = excluded.asset_class,
      status = excluded.status,
      entry_price = excluded.entry_price,
      stop_loss = excluded.stop_loss,
      quantity = excluded.quantity,
      remaining_qty = excluded.remaining_qty,
      pnl = excluded.pnl,
      realized_pnl_gbp = excluded.realized_pnl_gbp,
      r_multiple = excluded.r_multiple,
      risk_amount = excluded.risk_amount,
      entry_date = excluded.entry_date,
      close_date = excluded.close_date,
      account = excluded.account,
      note = excluded.note,
      strategy_tag = excluded.strategy_tag,
      executions_json = excluded.executions_json,
      t212_metadata_json = excluded.t212_metadata_json,
      ibkr_metadata_json = excluded.ibkr_metadata_json,
      extra_json = excluded.extra_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);

  const upsertSession = sqliteDb.prepare(`
    INSERT INTO sessions (token, username, created_at, expires_at, user_agent, ip)
    VALUES (@token, @username, @created_at, @expires_at, @user_agent, @ip)
    ON CONFLICT(token) DO UPDATE SET
      username = excluded.username,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at,
      user_agent = excluded.user_agent,
      ip = excluded.ip
  `);

  const upsertMessage = sqliteDb.prepare(`
    INSERT INTO group_chat_messages (id, group_chat_id, sender_user_id, sender_nickname,
      message_type, content, raw_text, entities_json, mentions_json, attachments_json,
      reply_to_message_id, metadata_json, created_at, updated_at, deleted_at)
    VALUES (@id, @group_chat_id, @sender_user_id, @sender_nickname,
      @message_type, @content, @raw_text, @entities_json, @mentions_json, @attachments_json,
      @reply_to_message_id, @metadata_json, @created_at, @updated_at, @deleted_at)
    ON CONFLICT(id) DO UPDATE SET
      group_chat_id = excluded.group_chat_id,
      sender_user_id = excluded.sender_user_id,
      sender_nickname = excluded.sender_nickname,
      message_type = excluded.message_type,
      content = excluded.content,
      raw_text = excluded.raw_text,
      entities_json = excluded.entities_json,
      mentions_json = excluded.mentions_json,
      attachments_json = excluded.attachments_json,
      reply_to_message_id = excluded.reply_to_message_id,
      metadata_json = excluded.metadata_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);

  const upsertNewsEvent = sqliteDb.prepare(`
    INSERT OR IGNORE INTO news_events (id, source_type, event_type, title, summary, ticker,
      canonical_ticker, importance, scheduled_at, published_at, source_name, source_url,
      dedupe_key, status, is_active, created_at, updated_at)
    VALUES (@id, @source_type, @event_type, @title, @summary, @ticker,
      @canonical_ticker, @importance, @scheduled_at, @published_at, @source_name, @source_url,
      @dedupe_key, @status, @is_active, @created_at, @updated_at)
  `);

  const upsertCollection = sqliteDb.prepare(`
    INSERT INTO collections (collection, record_id, data_json, updated_at)
    VALUES (@collection, @record_id, @data_json, @updated_at)
    ON CONFLICT(collection, record_id) DO UPDATE SET
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
  `);

  const counts = { users: 0, trades: 0, sessions: 0, messages: 0, newsEvents: 0, collections: 0 };

  sqliteDb.transaction(() => {
    // Users + their trades
    const users = db.users || {};
    for (const [username, user] of Object.entries(users)) {
      upsertUser.run({
        username,
        password_hash:               user.passwordHash ?? user.password_hash ?? null,
        nickname:                    user.nickname ?? null,
        role:                        user.role ?? 'user',
        guest:                       user.guest ? 1 : 0,
        expires_at:                  user.expiresAt ?? user.expires_at ?? null,
        avatar_url:                  user.avatarUrl ?? user.avatar_url ?? null,
        profile_complete:            user.profileComplete ? 1 : 0,
        created_at:                  user.createdAt ?? user.created_at ?? null,
        settings_json:               j(user.settings),
        trading212_json:             j(user.trading212),
        ibkr_json:                   j(user.ibkr),
        security_json:               j(user.security),
        prefs_json:                  j(user.prefs),
        risk_settings_json:          j(user.riskSettings ?? user.risk_settings),
        // v2 fields
        portfolio_history_json:      j(user.portfolioHistory),
        portfolio:                   user.portfolio ?? null,
        portfolio_currency:          user.portfolioCurrency ?? null,
        portfolio_source:            user.portfolioSource ?? null,
        initial_portfolio:           user.initialPortfolio ?? null,
        initial_net_deposits:        user.initialNetDeposits ?? null,
        manual_portfolio_baseline:   user.manualPortfolioBaseline ?? null,
        manual_net_deposits_baseline: user.manualNetDepositsBaseline ?? null,
        manual_baseline_updated_at:  user.manualBaselineUpdatedAt ?? null,
        net_deposits_anchor:         user.netDepositsAnchor ?? null,
        last_portfolio_sync_at:      user.lastPortfolioSyncAt ?? null,
        investor_accounts_enabled:   user.investorAccountsEnabled ? 1 : 0,
        investor_portal_enabled_at:  user.investorPortalEnabledAt ?? null,
        multi_trading_accounts_enabled: user.multiTradingAccountsEnabled ? 1 : 0,
        friend_code:                 user.friendCode ?? null,
        trading_accounts_json:       j(user.tradingAccounts),
        weekly_recaps_json:          j(user.weeklyRecaps),
        review_planning_json:        j(user.reviewPlanning),
        transaction_prefs_json:      j(user.transactionPrefs),
        transaction_profiles_json:   j(user.transactionProfiles),
        ui_prefs_json:               j(user.uiPrefs),
        ibkr_snapshots_json:         j(user.ibkrSnapshots),
        import_batches_json:         j(user.importBatches),
      });
      counts.users++;

      const trades = user.trades || [];
      for (const trade of trades) {
        if (!trade || !trade.id) continue;
        const knownKeys = new Set([
          'id','ticker','symbol','direction','tradeType','trade_type','assetClass','asset_class','status',
          'entry','entryPrice','entry_price','stopLoss','stop_loss',
          'sizeUnits','quantity','remainingQty','remaining_qty',
          'ppl','pnl','realizedPnlGbp','realized_pnl_gbp','rMultiple','r_multiple',
          'riskAmountGBP','riskAmount','risk_amount',
          'entryDate','entry_date','closeDate','close_date','account','note','strategyTag','strategy_tag',
          'executions','t212Metadata','t212_metadata','ibkrMetadata','ibkr_metadata','createdAt','created_at','updatedAt','updated_at'
        ]);
        const extra = {};
        for (const [k, v] of Object.entries(trade)) {
          if (!knownKeys.has(k)) extra[k] = v;
        }
        const computedPnlGBP = computeTradeRealizedPnlGBP(trade);
        const resolvedPnlGBP = trade.ppl ?? trade.realizedPnlGbp ?? trade.realized_pnl_gbp ?? computedPnlGBP;
        const riskGBP = Number(trade.riskAmountGBP ?? trade.riskAmount ?? trade.risk_amount);
        const resolvedRMultiple = trade.rMultiple ?? trade.r_multiple ??
          (Number.isFinite(resolvedPnlGBP) && Number.isFinite(riskGBP) && riskGBP !== 0
            ? resolvedPnlGBP / riskGBP : null);
        upsertTrade.run({
          id: trade.id,
          username,
          ticker: trade.symbol ?? trade.ticker ?? null,
          direction: trade.direction ?? null,
          trade_type: trade.tradeType ?? trade.trade_type ?? null,
          asset_class: trade.assetClass ?? trade.asset_class ?? null,
          status: trade.status ?? null,
          entry_price: trade.entry ?? trade.entryPrice ?? trade.entry_price ?? null,
          stop_loss: trade.stopLoss ?? trade.stop_loss ?? null,
          quantity: trade.sizeUnits ?? trade.quantity ?? null,
          remaining_qty: trade.remainingQty ?? trade.remaining_qty ?? null,
          pnl: trade.ppl ?? trade.pnl ?? computedPnlGBP,
          realized_pnl_gbp: resolvedPnlGBP,
          r_multiple: resolvedRMultiple,
          risk_amount: trade.riskAmountGBP ?? trade.riskAmount ?? trade.risk_amount ?? null,
          entry_date: trade.entryDate ?? trade.entry_date ?? trade.createdAt ?? trade.created_at ?? null,
          close_date: trade.closeDate ?? trade.close_date ?? null,
          account: trade.account ?? null,
          note: trade.note ?? null,
          strategy_tag: trade.strategyTag ?? trade.strategy_tag ?? null,
          executions_json: j(trade.executions),
          t212_metadata_json: j(trade.t212Metadata ?? trade.t212_metadata),
          ibkr_metadata_json: j(trade.ibkrMetadata ?? trade.ibkr_metadata),
          extra_json: Object.keys(extra).length ? j(extra) : null,
          created_at: trade.createdAt ?? trade.created_at ?? null,
          updated_at: trade.updatedAt ?? trade.updated_at ?? null,
        });
        counts.trades++;
      }
    }

    // Sessions
    const sessions = db.sessions || {};
    const sessionMeta = db.sessionMetadata || {};
    for (const [token, sess] of Object.entries(sessions)) {
      if (!token || !sess) continue;
      const meta = sessionMeta[token] || {};
      const resolvedUsername = typeof sess === 'string'
        ? sess
        : (sess.username ?? sess.userId ?? null);
      if (!resolvedUsername) continue;
      upsertSession.run({
        token,
        username: resolvedUsername,
        created_at: meta.createdAt ?? meta.created_at ?? null,
        expires_at: meta.expiresAt ?? meta.expires_at ?? null,
        user_agent: meta.userAgent ?? meta.user_agent ?? null,
        ip: meta.ip ?? null,
      });
      counts.sessions++;
    }

    // Group chat messages
    const messages = db.groupChatMessages || [];
    const msgArray = Array.isArray(messages) ? messages : Object.values(messages);
    for (const msg of msgArray) {
      if (!msg || !msg.id) continue;
      upsertMessage.run({
        id: msg.id,
        group_chat_id: msg.groupChatId ?? msg.group_chat_id ?? null,
        sender_user_id: msg.senderUserId ?? msg.sender_user_id ?? null,
        sender_nickname: msg.senderNickname ?? msg.sender_nickname ?? null,
        message_type: msg.messageType ?? msg.message_type ?? null,
        content: typeof msg.content === 'string' ? msg.content : j(msg.content),
        raw_text: msg.rawText ?? msg.raw_text ?? null,
        entities_json: j(msg.entities),
        mentions_json: j(msg.mentions),
        attachments_json: j(msg.attachments),
        reply_to_message_id: msg.replyToMessageId ?? msg.reply_to_message_id ?? null,
        metadata_json: j(msg.metadata),
        created_at: msg.createdAt ?? msg.created_at ?? null,
        updated_at: msg.updatedAt ?? msg.updated_at ?? null,
        deleted_at: msg.deletedAt ?? msg.deleted_at ?? null,
      });
      counts.messages++;
    }

    // News events
    const newsEvents = db.newsEvents || [];
    for (const evt of newsEvents) {
      if (!evt || !evt.id) continue;
      upsertNewsEvent.run({
        id: evt.id,
        source_type: evt.sourceType ?? evt.source_type ?? null,
        event_type: evt.eventType ?? evt.event_type ?? null,
        title: evt.title ?? null,
        summary: evt.summary ?? null,
        ticker: evt.ticker ?? null,
        canonical_ticker: evt.canonicalTicker ?? evt.canonical_ticker ?? null,
        importance: evt.importance ?? null,
        scheduled_at: evt.scheduledAt ?? evt.scheduled_at ?? null,
        published_at: evt.publishedAt ?? evt.published_at ?? null,
        source_name: evt.sourceName ?? evt.source_name ?? null,
        source_url: evt.sourceUrl ?? evt.source_url ?? null,
        dedupe_key: evt.dedupeKey ?? evt.dedupe_key ?? null,
        status: evt.status ?? null,
        is_active: evt.isActive != null ? (evt.isActive ? 1 : 0) : null,
        created_at: evt.createdAt ?? evt.created_at ?? null,
        updated_at: evt.updatedAt ?? evt.updated_at ?? null,
      });
      counts.newsEvents++;
    }

    // Everything else → collections table
    for (const [key, val] of Object.entries(db)) {
      if (KNOWN_COLLECTIONS.has(key)) continue;
      if (Array.isArray(val)) {
        val.forEach((item, idx) => {
          const recordId = (item && (item.id || item.token || item.key)) ? String(item.id ?? item.token ?? item.key) : String(idx);
          upsertCollection.run({ collection: key, record_id: recordId, data_json: j(item), updated_at: now });
          counts.collections++;
        });
      } else if (val && typeof val === 'object') {
        for (const [k, v] of Object.entries(val)) {
          upsertCollection.run({ collection: key, record_id: String(k), data_json: j(v), updated_at: now });
          counts.collections++;
        }
      }
    }
  })();

  return counts;
}

function isSqliteReadsEnabled() {
  return process.env.USE_SQLITE_READS === 'true';
}

// ---------------------------------------------------------------------------
// computePlFromSQLite
//
// Fast path for GET /api/pl. Replicates the snapshot-building logic from
// buildSnapshots / buildJournalViewFromTrades / refreshAnchors in server.js
// entirely from SQLite — no loadDB() call needed.
//
// Returns the exact same response shape as the existing handler, or null if
// the fast path cannot produce a valid result (falls back to JSON path).
// ---------------------------------------------------------------------------
function computePlFromSQLite(username, query) {
  try {
    const db = getDb();

    // --- 1. Parse query params (matching GET /api/pl handler) ---
    const year  = String(query.year  || '');
    const month = String(query.month || '');
    const selectedMonthKey = (year && month)
      ? `${year}-${month.padStart(2, '0')}`
      : '';
    const includeTrades = query.includeTrades !== '0';

    // --- 2. Fetch user row ---
    const userRow = db.prepare(
      'SELECT profile_complete, portfolio_history_json FROM users WHERE username = ?'
    ).get(username);
    if (!userRow) return null;

    // Let the JSON path handle the 409 for incomplete profiles
    if (!userRow.profile_complete) return null;

    const portfolioHistory = parseJson(userRow.portfolio_history_json) || {};

    // --- 3. Build the flat sorted record list (replicates buildSnapshots preamble) ---
    const allRecords = [];
    for (const [monthKey, days] of Object.entries(portfolioHistory)) {
      for (const [dateKey, record] of Object.entries(days || {})) {
        if (!record || typeof record !== 'object') continue;
        const endRaw   = Number(record.end);
        const hasEnd   = Number.isFinite(endRaw) && endRaw >= 0;
        const cashIn   = Math.max(0, Number.isFinite(Number(record.cashIn))  ? Number(record.cashIn)  : 0);
        const cashOut  = Math.max(0, Number.isFinite(Number(record.cashOut)) ? Number(record.cashOut) : 0);
        const note     = typeof record.note === 'string' ? record.note.trim() : '';
        if (!hasEnd && cashIn === 0 && cashOut === 0 && !note) continue;
        allRecords.push({
          date:        dateKey,
          monthKey,
          end:         hasEnd ? endRaw : null,
          cashIn,
          cashOut,
          preBaseline: record.preBaseline === true,
          note,
          accounts:    (record.accounts && typeof record.accounts === 'object') ? record.accounts : null,
        });
      }
    }
    allRecords.sort((a, b) => a.date.localeCompare(b.date));

    // --- 4. firstRecordedDate (first entry that has an end value) ---
    let firstRecordedDate = null;
    for (const r of allRecords) {
      if (r.end !== null) { firstRecordedDate = r.date; break; }
    }

    // --- 5. Build snapshots with rolling baseline (replicates buildSnapshots body) ---
    const snapshots = {};
    let baseline = null; // same start condition as buildSnapshots when initial is null

    for (const record of allRecords) {
      const inScope = !selectedMonthKey || selectedMonthKey === record.monthKey;
      if (inScope) {
        if (!snapshots[record.monthKey]) snapshots[record.monthKey] = {};
        const payload = {};
        if (record.end !== null) {
          payload.start   = baseline !== null ? baseline : record.end;
          payload.end     = record.end;
          payload.cashIn  = record.cashIn;
          payload.cashOut = record.cashOut;
        } else if (record.cashIn || record.cashOut) {
          payload.cashIn  = record.cashIn;
          payload.cashOut = record.cashOut;
        }
        if (record.preBaseline)  payload.preBaseline = true;
        if (record.note)         payload.note        = record.note;
        if (record.accounts)     payload.accounts    = record.accounts;
        snapshots[record.monthKey][record.date] = payload;
      }
      if (record.end !== null) {
        baseline = record.end;
      } else if (baseline !== null) {
        baseline += record.cashIn - record.cashOut;
      }
    }

    // --- 6. Compute date range for the trades query ---
    let tradeStartDate, tradeEndDate;
    if (selectedMonthKey) {
      const [y, m] = selectedMonthKey.split('-').map(Number);
      tradeStartDate = `${selectedMonthKey}-01`;
      tradeEndDate   = m === 12
        ? `${y + 1}-01-01`
        : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    } else {
      tradeStartDate = '0000-01-01';
      tradeEndDate   = '9999-12-31';
    }

    // --- 7. Inject trade data from trades table ---
    if (includeTrades) {
      // Fetch full trade rows and group by entry_date (replicates buildJournalViewFromTrades)
      const tradeRows = db.prepare(`
        SELECT * FROM trades
        WHERE username = ?
          AND DATE(entry_date) >= ?
          AND DATE(entry_date) <  ?
        ORDER BY entry_date ASC
      `).all(username, tradeStartDate, tradeEndDate);

      const tradesByDate = {};
      for (const row of tradeRows) {
        const dateKey = typeof row.entry_date === 'string' ? row.entry_date.slice(0, 10) : '';
        if (!dateKey) continue;
        const trade = {
          id:             row.id,
          ticker:         row.ticker,
          direction:      row.direction,
          tradeType:      row.trade_type,
          assetClass:     row.asset_class,
          status:         row.status,
          entryPrice:     row.entry_price,
          stopLoss:       row.stop_loss,
          quantity:       row.quantity,
          remainingQty:   row.remaining_qty,
          pnl:            row.pnl,
          realizedPnlGbp: row.realized_pnl_gbp,
          rMultiple:      row.r_multiple,
          riskAmount:     row.risk_amount,
          entryDate:      row.entry_date,
          closeDate:      row.close_date,
          account:        row.account,
          note:           row.note,
          strategyTag:    row.strategy_tag,
          executions:     parseJson(row.executions_json) ?? [],
          t212Metadata:   parseJson(row.t212_metadata_json),
          ibkrMetadata:   parseJson(row.ibkr_metadata_json),
          createdAt:      row.created_at,
          updatedAt:      row.updated_at,
        };
        const extra = parseJson(row.extra_json);
        if (extra && typeof extra === 'object') Object.assign(trade, extra);
        (tradesByDate[dateKey] ||= []).push(trade);
      }

      // Merge into snapshots (replicates the tradeJournal injection in buildSnapshots)
      for (const [dateKey, trades] of Object.entries(tradesByDate)) {
        const mk = dateKey.slice(0, 7);
        if (selectedMonthKey && selectedMonthKey !== mk) continue;
        (snapshots[mk] ||= {})[dateKey] ||= {};
        snapshots[mk][dateKey].tradesCount = trades.length;
        snapshots[mk][dateKey].trades      = trades;
      }
    } else {
      // Aggregated count only — no full trade objects needed
      const countRows = db.prepare(`
        SELECT
          DATE(entry_date)                                              AS trade_date,
          COUNT(*)                                                      AS trade_count,
          SUM(CASE WHEN status = 'closed' THEN realized_pnl_gbp ELSE 0 END) AS realized_pnl,
          SUM(CASE WHEN status = 'open'   THEN 1               ELSE 0 END) AS open_count
        FROM trades
        WHERE username = ?
          AND DATE(entry_date) >= ?
          AND DATE(entry_date) <  ?
        GROUP BY DATE(entry_date)
      `).all(username, tradeStartDate, tradeEndDate);

      for (const row of countRows) {
        const dateKey = String(row.trade_date);
        const mk      = dateKey.slice(0, 7);
        if (selectedMonthKey && selectedMonthKey !== mk) continue;
        (snapshots[mk] ||= {})[dateKey] ||= {};
        snapshots[mk][dateKey].tradesCount = row.trade_count;
      }
    }

    // --- 8. Return in the exact shape the handler returns ---
    if (selectedMonthKey) {
      const monthPayload      = snapshots[selectedMonthKey] || {};
      const originTileInWindow = !!(firstRecordedDate && firstRecordedDate.startsWith(`${selectedMonthKey}-`));
      return {
        ...monthPayload,
        __meta: {
          firstRecordedDate,
          selectedMonthKey,
          originTileInWindow,
        },
      };
    }

    return snapshots;
  } catch (_err) {
    return null;
  }
}

// Module-level flag so we only emit the reconstruction log once per process startup.
let _firstLoad = true;

function loadFromSQLite() {
  const sqliteDb = getDb();

  // ------------------------------------------------------------------
  // 1. Users
  // ------------------------------------------------------------------
  const userRows = sqliteDb.prepare('SELECT * FROM users').all();
  const users = {};
  for (const row of userRows) {
    const user = {
      username:                   row.username,
      passwordHash:               row.password_hash,
      nickname:                   row.nickname,
      role:                       row.role,
      guest:                      row.guest === 1,
      profileComplete:            row.profile_complete === 1,
      createdAt:                  row.created_at,
      // JSON blob fields
      settings:                   parseJson(row.settings_json),
      trading212:                 parseJson(row.trading212_json),
      ibkr:                       parseJson(row.ibkr_json),
      security:                   parseJson(row.security_json) ?? {},
      prefs:                      parseJson(row.prefs_json),
      riskSettings:               parseJson(row.risk_settings_json),
      // v2 fields — portfolio & financial state
      portfolioHistory:           parseJson(row.portfolio_history_json) ?? {},
      portfolio:                  row.portfolio,
      portfolioCurrency:          row.portfolio_currency,
      portfolioSource:            row.portfolio_source,
      initialPortfolio:           row.initial_portfolio,
      initialNetDeposits:         row.initial_net_deposits,
      manualPortfolioBaseline:    row.manual_portfolio_baseline,
      manualNetDepositsBaseline:  row.manual_net_deposits_baseline,
      manualBaselineUpdatedAt:    row.manual_baseline_updated_at,
      netDepositsAnchor:          row.net_deposits_anchor,
      lastPortfolioSyncAt:        row.last_portfolio_sync_at,
      // v2 fields — account & integration state
      investorAccountsEnabled:    row.investor_accounts_enabled === 1,
      investorPortalEnabledAt:    row.investor_portal_enabled_at,
      multiTradingAccountsEnabled: row.multi_trading_accounts_enabled === 1,
      friendCode:                 row.friend_code,
      tradingAccounts:            parseJson(row.trading_accounts_json) ?? [],
      // v2 fields — misc user data
      weeklyRecaps:               parseJson(row.weekly_recaps_json) ?? [],
      reviewPlanning:             parseJson(row.review_planning_json),
      transactionPrefs:           parseJson(row.transaction_prefs_json),
      transactionProfiles:        parseJson(row.transaction_profiles_json) ?? [],
      uiPrefs:                    parseJson(row.ui_prefs_json),
      ibkrSnapshots:              parseJson(row.ibkr_snapshots_json) ?? [],
      importBatches:              parseJson(row.import_batches_json) ?? [],
      // Reconstructed below from the trades table
      trades: [],
      // Explicitly empty — cleared by consolidation, not stored in SQLite
      tradeJournal: {},
    };
    if (row.avatar_url) user.avatarUrl = row.avatar_url;
    if (row.guest === 1 && row.expires_at) user.expiresAt = row.expires_at;
    users[row.username] = user;
  }

  // ------------------------------------------------------------------
  // 2. Trades — attach to owning user
  // ------------------------------------------------------------------
  const tradeRows = sqliteDb.prepare('SELECT * FROM trades ORDER BY entry_date ASC, created_at ASC').all();
  for (const row of tradeRows) {
    const user = users[row.username];
    if (!user) continue;
    const trade = {
      id:             row.id,
      ticker:         row.ticker,
      direction:      row.direction,
      tradeType:      row.trade_type,
      assetClass:     row.asset_class,
      status:         row.status,
      entryPrice:     row.entry_price,
      stopLoss:       row.stop_loss,
      quantity:       row.quantity,
      remainingQty:   row.remaining_qty,
      pnl:            row.pnl,
      realizedPnlGbp: row.realized_pnl_gbp,
      rMultiple:      row.r_multiple,
      riskAmount:     row.risk_amount,
      entryDate:      row.entry_date,
      closeDate:      row.close_date,
      account:        row.account,
      note:           row.note,
      strategyTag:    row.strategy_tag,
      executions:     parseJson(row.executions_json) ?? [],
      t212Metadata:   parseJson(row.t212_metadata_json),
      ibkrMetadata:   parseJson(row.ibkr_metadata_json),
      createdAt:      row.created_at,
      updatedAt:      row.updated_at,
    };
    // Spread any extra fields that were captured at write time
    const extra = parseJson(row.extra_json);
    if (extra && typeof extra === 'object') Object.assign(trade, extra);
    user.trades.push(trade);
  }

  // ------------------------------------------------------------------
  // 3. Sessions + sessionMetadata (same table, two views)
  // ------------------------------------------------------------------
  const sessionRows = sqliteDb.prepare('SELECT * FROM sessions').all();
  const sessions = {};
  const sessionMetadata = {};
  for (const row of sessionRows) {
    sessions[row.token] = row.username; // shape: { [token]: username }
    sessionMetadata[row.token] = {
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      userAgent: row.user_agent,
      ip:        row.ip,
    };
  }

  // ------------------------------------------------------------------
  // 4. Group chat messages
  // ------------------------------------------------------------------
  const messageRows = sqliteDb.prepare(
    'SELECT * FROM group_chat_messages ORDER BY created_at ASC'
  ).all();
  const groupChatMessages = messageRows.map(row => ({
    id:                 row.id,
    groupChatId:        row.group_chat_id,
    senderUserId:       row.sender_user_id,
    senderNickname:     row.sender_nickname,
    messageType:        row.message_type,
    content:            row.content,
    rawText:            row.raw_text,
    entities:           parseJson(row.entities_json),
    mentions:           parseJson(row.mentions_json),
    attachments:        parseJson(row.attachments_json),
    replyToMessageId:   row.reply_to_message_id,
    metadata:           parseJson(row.metadata_json),
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
    deletedAt:          row.deleted_at,
  }));

  // ------------------------------------------------------------------
  // 5. News events
  // ------------------------------------------------------------------
  const newsEventRows = sqliteDb.prepare('SELECT * FROM news_events').all();
  const newsEvents = newsEventRows.map(row => ({
    id:              row.id,
    sourceType:      row.source_type,
    eventType:       row.event_type,
    title:           row.title,
    summary:         row.summary,
    ticker:          row.ticker,
    canonicalTicker: row.canonical_ticker,
    importance:      row.importance,
    scheduledAt:     row.scheduled_at,
    publishedAt:     row.published_at,
    sourceName:      row.source_name,
    sourceUrl:       row.source_url,
    dedupeKey:       row.dedupe_key,
    status:          row.status,
    isActive:        row.is_active === null ? null : row.is_active === 1,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  }));

  // ------------------------------------------------------------------
  // 6. Collections table → all other top-level keys
  // ------------------------------------------------------------------
  const collectionRows = sqliteDb.prepare(
    'SELECT collection, record_id, data_json FROM collections ORDER BY collection, record_id'
  ).all();

  // Group rows by collection name
  const collectionGroups = {};
  for (const row of collectionRows) {
    (collectionGroups[row.collection] ||= []).push(row);
  }

  const extraCollections = {};
  for (const [name, rows] of Object.entries(collectionGroups)) {
    if (ARRAY_COLLECTIONS.has(name)) {
      // Sort: numeric record_ids by value, string ids lexicographically
      const sorted = rows.slice().sort((a, b) => {
        const an = Number(a.record_id), bn = Number(b.record_id);
        if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
        return a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0;
      });
      extraCollections[name] = sorted.map(r => parseJson(r.data_json));
    } else if (OBJECT_COLLECTIONS.has(name)) {
      const obj = {};
      for (const r of rows) obj[r.record_id] = parseJson(r.data_json);
      extraCollections[name] = obj;
    } else {
      // Unknown collection: all-numeric record_ids → ordered array; otherwise keyed object
      const allNumeric = rows.every(r => /^\d+$/.test(r.record_id));
      if (allNumeric) {
        extraCollections[name] = rows
          .slice()
          .sort((a, b) => Number(a.record_id) - Number(b.record_id))
          .map(r => parseJson(r.data_json));
      } else {
        const obj = {};
        for (const r of rows) obj[r.record_id] = parseJson(r.data_json);
        extraCollections[name] = obj;
      }
    }
  }

  // ------------------------------------------------------------------
  // 7. Assemble the final db object
  //
  // Start with the same defaults as the catch-block fallback in loadDB()
  // so every expected key exists even when SQLite has no rows for it.
  // Then overlay with real SQLite data (extraCollections).
  // ------------------------------------------------------------------
  const db = {
    // Dedicated-table collections
    users,
    sessions,
    sessionMetadata,
    groupChatMessages,
    newsEvents,
    // Defaults matching loadDB() catch block + ensure* functions
    verifications:                   {},
    emailChangeRequests:              {},
    instrumentMappings:              [],
    brokerInstrumentRegistry:        [],
    instrumentResolutionHistory:     [],
    brokerSnapshots:                 [],
    ibkrConnectorTokens:             [],
    ibkrConnectorKeys:               [],
    investorProfiles:                [],
    investorLogins:                  [],
    investorProfitSplits:            [],
    investorCashflows:               [],
    masterValuations:                [],
    investorInvites:                 [],
    investorSessions:                {},
    twoFactorSetups:                 {},
    twoFactorLoginChallenges:        {},
    notificationDevices:             [],
    notificationEvents:              [],
    notificationPushDedupe:          [],
    notificationPreferences:         [],
    newsSourceRegistry:              [],
    userNewsPreferences:             [],
    userEventDeliveryLog:            [],
    newsNotificationOutbox:          [],
    newsInAppNotifications:          [],
    newsNotificationStatus:          {},
    newsDiagnosticsSnapshots:        { ranking: [], thresholds: [], notifications: [] },
    siteAnnouncements:               [],
    siteAnnouncementStates:          [],
    socialProfiles:                  [],
    socialSettings:                  [],
    friendRequests:                  [],
    friendships:                     [],
    tradeShareSettings:              [],
    leaderboardStats:                [],
    socialEventLog:                  [],
    tradeGroups:                     [],
    tradeGroupMembers:               [],
    tradeGroupAlerts:                [],
    tradeGroupNotifications:         [],
    tradeGroupInvites:               [],
    tradeGroupAnnouncements:         [],
    tradeGroupPendingAlerts:         [],
    watchlists:                      [],
    watchlistItems:                  [],
    tradeGroupWatchlists:            [],
    groupChats:                      [],
    groupChatReadStates:             [],
    groupChatRoles:                  [],
    groupChatRoleAssignments:        [],
    groupChatTypingStates:           [],
    watchlistPreviousCloseReferences: {},
  };

  // Overlay actual SQLite data — overwrites the defaults above
  Object.assign(db, extraCollections);

  // ------------------------------------------------------------------
  // 8. One-time reconstruction log
  // ------------------------------------------------------------------
  if (_firstLoad) {
    _firstLoad = false;
    const totalTrades = Object.values(users).reduce((s, u) => s + (u.trades?.length || 0), 0);
    console.log('[SQLite Read] Reconstructed DB:', {
      users:             Object.keys(db.users).length,
      trades:            totalTrades,
      sessions:          Object.keys(db.sessions).length,
      groupChatMessages: db.groupChatMessages.length,
      newsEvents:        db.newsEvents.length,
      collections:       Object.keys(extraCollections),
    });
  }

  return db;
}

function logError(err) {
  try {
    const line = `[${new Date().toISOString()}] ${err?.message || err}\n`;
    fs.appendFileSync(ERROR_LOG, line, 'utf-8');
  } catch (_) {
    // swallow — logging must never throw
  }
}

function shadowWrite(db) {
  if (process.env.SQLITE_ENABLED !== 'true') return;
  try {
    syncFromJSON(db);
  } catch (err) {
    logError(err);
  }
}

// ---------------------------------------------------------------------------
// Analytics fast paths
//
// All five analytics endpoints call loadFilteredTrades() → flattenTrades() →
// filterTrades() → analytics.*().  The fast path replaces the data-loading
// step only: we query the trades table, reconstruct lightweight objects with
// the field names analytics.js expects, and call the same analytics functions.
// No analytics logic is duplicated.
//
// Field name mapping (SQLite column → analytics.js field):
//   realized_pnl_gbp → realizedPnlGBP
//   r_multiple       → rMultiple
//   risk_amount      → riskAmountGBP  (used as fallback when rMultiple is null)
//   trade_type       → tradeType
//   strategy_tag     → strategyTag
//   close_date       → closeDate
//   entry_date       → openDate
// ---------------------------------------------------------------------------
const analytics = require('./analytics');

/**
 * Build + run the closed-trades query with optional filters translated from
 * the query-string params that filterTrades() supports.
 *
 * Returns an array of lightweight trade objects ready for analytics.*(), or
 * null when an unsupported filter is present (triggers JSON fallback).
 */
function queryAnalyticsTrades(username, query) {
  // Filters with no SQLite column → cannot honour → fall back to JSON path
  if (query.marketCondition || query.tags) return null;

  const from        = /^\d{4}-\d{2}-\d{2}$/.test(query.from  || '') ? query.from  : null;
  const to          = /^\d{4}-\d{2}-\d{2}$/.test(query.to    || '') ? query.to    : null;
  const symbol      = typeof query.symbol      === 'string' ? query.symbol.trim().toUpperCase()     : null;
  const tradeType   = typeof query.tradeType   === 'string' ? query.tradeType.trim().toLowerCase()  : null;
  const assetClass  = typeof query.assetClass  === 'string' ? query.assetClass.trim().toLowerCase() : null;
  const strategyTag = typeof query.strategyTag === 'string' ? query.strategyTag.trim().toLowerCase(): null;
  const winLoss     = typeof query.winLoss     === 'string' ? query.winLoss.trim().toLowerCase()    : null;

  const db = getDb();

  // User must exist — if not, let the JSON path return its own 404
  const userExists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (!userExists) return null;

  const conditions = [
    'username = ?',
    "status = 'closed'",
    'realized_pnl_gbp IS NOT NULL',
  ];
  const params = [username];

  if (from)                  { conditions.push('DATE(entry_date) >= ?');    params.push(from); }
  if (to)                    { conditions.push('DATE(entry_date) <= ?');     params.push(to); }
  if (symbol)                { conditions.push('UPPER(ticker) = ?');          params.push(symbol); }
  if (tradeType)             { conditions.push('LOWER(trade_type) = ?');      params.push(tradeType); }
  if (assetClass)            { conditions.push('LOWER(asset_class) = ?');     params.push(assetClass); }
  if (strategyTag)           { conditions.push('LOWER(strategy_tag) = ?');    params.push(strategyTag); }
  if (winLoss === 'win')     { conditions.push('realized_pnl_gbp > 0'); }
  if (winLoss === 'loss')    { conditions.push('realized_pnl_gbp < 0'); }

  const rows = db.prepare(`
    SELECT realized_pnl_gbp, r_multiple, risk_amount, trade_type, strategy_tag,
           close_date, entry_date, ticker
    FROM   trades
    WHERE  ${conditions.join(' AND ')}
    ORDER  BY close_date ASC, entry_date ASC
  `).all(...params);

  // Reconstruct objects with exactly the field names analytics.js reads
  return rows.map(row => ({
    realizedPnlGBP: row.realized_pnl_gbp,
    rMultiple:      row.r_multiple,
    riskAmountGBP:  row.risk_amount,          // fallback for R when rMultiple is null
    tradeType:      row.trade_type,
    strategyTag:    row.strategy_tag,
    closeDate:      row.close_date,
    openDate:       typeof row.entry_date === 'string' ? row.entry_date.slice(0, 10) : null,
  }));
}

// --- endpoint functions ---

function computeAnalyticsSummaryFromSQLite(username, query) {
  try {
    const trades = queryAnalyticsTrades(username, query);
    if (!trades) return null;

    const summary   = analytics.summarizeTrades(trades);
    const curve     = analytics.equityCurve(trades);
    const dd        = analytics.drawdowns(curve);
    const dist      = analytics.distribution(trades);
    const streak    = analytics.streaks(trades);
    const breakdown = analytics.breakdowns(trades);

    return {
      range: {
        from: query.from || null,
        to:   query.to   || null,
      },
      summary,
      drawdown: {                 // summary uses a 4-field subset of drawdowns()
        maxDrawdown:  dd.maxDrawdown,
        durationDays: dd.durationDays,
        peakDate:     dd.peakDate,
        troughDate:   dd.troughDate,
      },
      distribution: {             // summary uses a 4-field subset of distribution()
        median: dist.median,
        stddev: dist.stddev,
        best:   dist.best,
        worst:  dist.worst,
      },
      breakdowns: breakdown,
      streaks:    streak,
    };
  } catch (_) { return null; }
}

function computeEquityCurveFromSQLite(username, query) {
  try {
    const trades = queryAnalyticsTrades(username, query);
    if (!trades) return null;
    return { curve: analytics.equityCurve(trades) };
  } catch (_) { return null; }
}

function computeDrawdownFromSQLite(username, query) {
  try {
    const trades = queryAnalyticsTrades(username, query);
    if (!trades) return null;
    const curve = analytics.equityCurve(trades);
    // drawdown endpoint returns the FULL dd object (incl. series + recoveryDate)
    return { drawdown: analytics.drawdowns(curve) };
  } catch (_) { return null; }
}

function computeDistributionFromSQLite(username, query) {
  try {
    const trades = queryAnalyticsTrades(username, query);
    if (!trades) return null;
    // distribution endpoint wraps the full distribution() result
    return { distribution: analytics.distribution(trades) };
  } catch (_) { return null; }
}

function computeStreaksFromSQLite(username, query) {
  try {
    const trades = queryAnalyticsTrades(username, query);
    if (!trades) return null;
    return { streaks: analytics.streaks(trades) };
  } catch (_) { return null; }
}

module.exports = {
  initDB,
  syncFromJSON,
  shadowWrite,
  loadFromSQLite,
  isSqliteReadsEnabled,
  computePlFromSQLite,
  computeAnalyticsSummaryFromSQLite,
  computeEquityCurveFromSQLite,
  computeDrawdownFromSQLite,
  computeDistributionFromSQLite,
  computeStreaksFromSQLite,
  computeTradeRealizedPnlGBP,
};
