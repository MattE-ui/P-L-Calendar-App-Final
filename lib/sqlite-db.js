'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const SQLITE_PATH = path.join(__dirname, '..', 'storage', 'veracity.db');
const ERROR_LOG = path.join(__dirname, '..', 'storage', 'sqlite-errors.log');

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
      risk_settings_json TEXT
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

  return db;
}

const KNOWN_COLLECTIONS = new Set(['users', 'sessions', 'sessionMetadata', 'groupChatMessages', 'newsEvents']);

function j(val) {
  return val === undefined || val === null ? null : JSON.stringify(val);
}

function syncFromJSON(db) {
  const sqliteDb = getDb();
  const now = new Date().toISOString();

  const upsertUser = sqliteDb.prepare(`
    INSERT INTO users (username, password_hash, nickname, role, guest, expires_at, avatar_url,
      profile_complete, created_at, settings_json, trading212_json, ibkr_json, security_json,
      prefs_json, risk_settings_json)
    VALUES (@username, @password_hash, @nickname, @role, @guest, @expires_at, @avatar_url,
      @profile_complete, @created_at, @settings_json, @trading212_json, @ibkr_json,
      @security_json, @prefs_json, @risk_settings_json)
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
      risk_settings_json = excluded.risk_settings_json
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
    INSERT INTO news_events (id, source_type, event_type, title, summary, ticker,
      canonical_ticker, importance, scheduled_at, published_at, source_name, source_url,
      dedupe_key, status, is_active, created_at, updated_at)
    VALUES (@id, @source_type, @event_type, @title, @summary, @ticker,
      @canonical_ticker, @importance, @scheduled_at, @published_at, @source_name, @source_url,
      @dedupe_key, @status, @is_active, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      source_type = excluded.source_type,
      event_type = excluded.event_type,
      title = excluded.title,
      summary = excluded.summary,
      ticker = excluded.ticker,
      canonical_ticker = excluded.canonical_ticker,
      importance = excluded.importance,
      scheduled_at = excluded.scheduled_at,
      published_at = excluded.published_at,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      status = excluded.status,
      is_active = excluded.is_active,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
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
        password_hash: user.passwordHash ?? user.password_hash ?? null,
        nickname: user.nickname ?? null,
        role: user.role ?? 'user',
        guest: user.guest ? 1 : 0,
        expires_at: user.expiresAt ?? user.expires_at ?? null,
        avatar_url: user.avatarUrl ?? user.avatar_url ?? null,
        profile_complete: user.profileComplete ? 1 : 0,
        created_at: user.createdAt ?? user.created_at ?? null,
        settings_json: j(user.settings),
        trading212_json: j(user.trading212),
        ibkr_json: j(user.ibkr),
        security_json: j(user.security),
        prefs_json: j(user.prefs),
        risk_settings_json: j(user.riskSettings ?? user.risk_settings),
      });
      counts.users++;

      const trades = user.trades || [];
      for (const trade of trades) {
        if (!trade || !trade.id) continue;
        const knownKeys = new Set([
          'id','ticker','direction','tradeType','trade_type','assetClass','asset_class','status',
          'entryPrice','entry_price','stopLoss','stop_loss','quantity','remainingQty','remaining_qty',
          'pnl','realizedPnlGbp','realized_pnl_gbp','rMultiple','r_multiple','riskAmount','risk_amount',
          'entryDate','entry_date','closeDate','close_date','account','note','strategyTag','strategy_tag',
          'executions','t212Metadata','t212_metadata','ibkrMetadata','ibkr_metadata','createdAt','created_at','updatedAt','updated_at'
        ]);
        const extra = {};
        for (const [k, v] of Object.entries(trade)) {
          if (!knownKeys.has(k)) extra[k] = v;
        }
        upsertTrade.run({
          id: trade.id,
          username,
          ticker: trade.ticker ?? null,
          direction: trade.direction ?? null,
          trade_type: trade.tradeType ?? trade.trade_type ?? null,
          asset_class: trade.assetClass ?? trade.asset_class ?? null,
          status: trade.status ?? null,
          entry_price: trade.entryPrice ?? trade.entry_price ?? null,
          stop_loss: trade.stopLoss ?? trade.stop_loss ?? null,
          quantity: trade.quantity ?? null,
          remaining_qty: trade.remainingQty ?? trade.remaining_qty ?? null,
          pnl: trade.pnl ?? null,
          realized_pnl_gbp: trade.realizedPnlGbp ?? trade.realized_pnl_gbp ?? null,
          r_multiple: trade.rMultiple ?? trade.r_multiple ?? null,
          risk_amount: trade.riskAmount ?? trade.risk_amount ?? null,
          entry_date: trade.entryDate ?? trade.entry_date ?? null,
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
      const resolvedUsername = sess.username ?? sess.userId ?? null;
      if (!resolvedUsername) continue;
      upsertSession.run({
        token,
        username: resolvedUsername,
        created_at: sess.createdAt ?? sess.created_at ?? null,
        expires_at: sess.expiresAt ?? sess.expires_at ?? null,
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

module.exports = { initDB, syncFromJSON, shadowWrite };
