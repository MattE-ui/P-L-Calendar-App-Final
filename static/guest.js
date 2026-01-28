const DEFAULT_GUEST_DATA = {
  portfolio: {
    portfolio: 0,
    initialNetDeposits: 0,
    netDepositsTotal: 0,
    liveOpenPnl: 0,
    livePortfolio: 0,
    profileComplete: true,
    activeTrades: 0
  },
  pl: {},
  activeTrades: [],
  trades: [],
  analytics: {
    summary: {},
    drawdown: {},
    distribution: {},
    streaks: {},
    equityCurve: []
  },
  integrations: {
    trading212: {
      hasApiKey: false,
      hasApiSecret: false,
      enabled: false,
      snapshotTime: '21:00',
      mode: 'live',
      timezone: 'Europe/London',
      baseUrl: '',
      endpoint: '/api/v0/equity/account/summary',
      lastSyncAt: null,
      lastStatus: null,
      lastBaseUrl: null,
      lastEndpoint: null,
      cooldownUntil: null,
      lastRaw: null
    },
    ibkr: {
      enabled: false,
      mode: 'connector',
      accountId: '',
      connectionStatus: 'disconnected',
      lastSyncAt: null,
      lastHeartbeatAt: null,
      lastSnapshotAt: null,
      lastStatus: null,
      lastSessionCheckAt: null,
      gatewayUrl: '/api/integrations/ibkr/gateway',
      connectorConfigured: false
    }
  }
};

function cloneGuestData() {
  return JSON.parse(JSON.stringify(DEFAULT_GUEST_DATA));
}

function loadGuestData() {
  const navEntry = performance.getEntriesByType?.('navigation')?.[0];
  const isReload = navEntry?.type === 'reload';
  if (isReload) {
    sessionStorage.removeItem('guest-data');
  }
  const stored = sessionStorage.getItem('guest-data');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      sessionStorage.removeItem('guest-data');
    }
  }
  const fresh = cloneGuestData();
  sessionStorage.setItem('guest-data', JSON.stringify(fresh));
  return fresh;
}

function saveGuestData(data) {
  sessionStorage.setItem('guest-data', JSON.stringify(data));
}

function resetGuestData() {
  const fresh = cloneGuestData();
  window.GUEST_DATA = fresh;
  saveGuestData(fresh);
  return fresh;
}

function parseGuestQuery(path) {
  const url = new URL(path, window.location.origin);
  return url.searchParams;
}

function convertToGBP(value, currency, rates) {
  if (!Number.isFinite(value)) return null;
  if (currency === 'GBP') return value;
  const rate = rates?.[currency];
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return value / rate;
}

function getGuestDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function hashGuestSeed(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 100000;
  }
  return hash;
}

function computeGuestMarketLow(symbol, dateKey) {
  const seed = hashGuestSeed(`${symbol}:${dateKey}`);
  const base = 40 + (seed % 160);
  const variance = (seed % 90) / 100;
  return Math.max(1, base - variance);
}

function computeGuestLivePrice(trade, dateKey) {
  const entry = Number(trade.entry);
  const seed = hashGuestSeed(`${trade.symbol || 'SYM'}:${dateKey}`);
  const drift = ((seed % 21) - 10) / 100;
  const base = Number.isFinite(entry) && entry > 0 ? entry : 50 + (seed % 200);
  return Math.max(0.01, base * (1 + drift));
}

function computeUnrealizedGBP(trade, rates) {
  const entry = Number(trade.entry);
  const livePrice = Number.isFinite(Number(trade.livePrice)) ? Number(trade.livePrice) : entry;
  const sizeUnits = Number(trade.sizeUnits || 0);
  if (!Number.isFinite(entry) || !Number.isFinite(livePrice) || !Number.isFinite(sizeUnits)) return 0;
  const direction = trade.direction || trade.tradeDirection || 'long';
  const delta = direction === 'short' ? entry - livePrice : livePrice - entry;
  const pnlCurrency = delta * sizeUnits;
  return convertToGBP(pnlCurrency, trade.currency || 'GBP', rates) || 0;
}

function ensureGuestMonth(pl, dateKey) {
  const ym = dateKey.slice(0, 7);
  pl[ym] ||= {};
  return { ym, bucket: pl[ym] };
}

function computeGuestActiveTrades(data, rates) {
  const openTrades = data.trades.filter(trade => {
    const hasClosePrice = trade.closePrice !== null && trade.closePrice !== undefined && Number.isFinite(Number(trade.closePrice));
    return trade.status !== 'closed' && !hasClosePrice;
  });
  const activeTrades = Array.isArray(data.activeTrades) ? data.activeTrades : [];
  const activeMap = new Map(activeTrades.map(trade => [trade.id, trade]));
  const todayKey = getGuestDateKey();
  const trades = openTrades.map(trade => {
    const merged = { ...trade, ...activeMap.get(trade.id) };
    merged.livePrice = computeGuestLivePrice(merged, todayKey);
    merged.unrealizedGBP = computeUnrealizedGBP(merged, rates);
    return merged;
  });
  const liveOpenPnl = trades.reduce((sum, trade) => sum + (Number(trade.unrealizedGBP) || 0), 0);
  return { trades, liveOpenPnl };
}

window.GUEST_DATA = loadGuestData();
function injectGuestBanner() {
  if (document.getElementById('guest-mode-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'guest-mode-banner';
  banner.className = 'guest-banner';
  banner.innerHTML = `
    <strong>Guest mode</strong>
    <span>Features may not work as expected. Data is stored locally and will be lost on reload.</span>
    <a href="/signup.html" class="guest-banner-link">Create an account</a>
  `;
  const header = document.querySelector('header');
  if (header && header.parentNode) {
    header.parentNode.insertBefore(banner, header.nextSibling);
  } else {
    document.body.prepend(banner);
  }
}

if (sessionStorage.getItem('guestMode') === 'true' || localStorage.getItem('guestMode') === 'true') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectGuestBanner);
  } else {
    injectGuestBanner();
  }
}

window.handleGuestRequest = (path, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase();
  const data = window.GUEST_DATA;
  const rates = data.rates || { GBP: 1, USD: 1.24, EUR: 1.12 };
  if (path.startsWith('/api/rates')) {
    return { rates, cachedAt: Date.now() };
  }
  if (path.startsWith('/api/profile')) {
    if (method === 'POST') {
      const payload = opts.body ? JSON.parse(opts.body) : {};
      const portfolio = Number(payload.portfolio);
      const netDeposits = Number(payload.netDeposits);
      if (!Number.isFinite(portfolio) || portfolio < 0) {
        return { ok: false, error: 'Invalid portfolio value' };
      }
      if (!Number.isFinite(netDeposits)) {
        return { ok: false, error: 'Invalid net deposits value' };
      }
      data.portfolio.portfolio = portfolio;
      data.portfolio.netDepositsTotal = netDeposits;
      if (!Number.isFinite(Number(data.portfolio.initialNetDeposits))) {
        data.portfolio.initialNetDeposits = netDeposits;
      }
      data.portfolio.profileComplete = true;
      saveGuestData(data);
      return { ok: true };
    }
    if (method === 'DELETE') {
      resetGuestData();
      return { ok: true };
    }
    return {
      profileComplete: true,
      portfolio: data.portfolio.portfolio,
      initialNetDeposits: data.portfolio.initialNetDeposits,
      netDepositsTotal: data.portfolio.netDepositsTotal,
      today: new Date().toISOString().slice(0, 10),
      netDepositsAnchor: null,
      username: 'guest'
    };
  }
  if (path.startsWith('/api/portfolio')) {
    if (method === 'GET') return data.portfolio;
    const payload = opts.body ? JSON.parse(opts.body) : {};
    data.portfolio.portfolio = Number(payload.portfolio) || data.portfolio.portfolio;
    saveGuestData(data);
    return { ok: true, portfolio: data.portfolio.portfolio };
  }
  if (path.startsWith('/api/account/password')) {
    return { ok: true };
  }
  if (path.startsWith('/api/pl')) {
    if (method === 'GET') {
      const params = parseGuestQuery(path);
      const year = params.get('year');
      const month = params.get('month');
      if (year && month) {
        const key = `${year}-${String(month).padStart(2, '0')}`;
        return data.pl[key] || {};
      }
      return data.pl;
    }
    const payload = opts.body ? JSON.parse(opts.body) : {};
    const date = payload.date;
    if (!date) {
      return { ok: false, error: 'Missing date' };
    }
    if (date) {
      const { ym, bucket } = ensureGuestMonth(data.pl, date);
      const existing = bucket[date];
      const deposit = payload.cashIn === undefined || payload.cashIn === '' ? 0 : Number(payload.cashIn);
      const withdrawal = payload.cashOut === undefined || payload.cashOut === '' ? 0 : Number(payload.cashOut);
      if (!Number.isFinite(deposit) || deposit < 0) {
        return { ok: false, error: 'Invalid deposit value' };
      }
      if (!Number.isFinite(withdrawal) || withdrawal < 0) {
        return { ok: false, error: 'Invalid withdrawal value' };
      }
      let normalizedNote;
      if (payload.note !== undefined) {
        if (payload.note === null) {
          normalizedNote = '';
        } else if (typeof payload.note === 'string') {
          normalizedNote = payload.note.trim();
        } else {
          return { ok: false, error: 'Invalid note value' };
        }
      }
      const hasValue = Object.prototype.hasOwnProperty.call(payload, 'value');
      if (hasValue && (payload.value === null || payload.value === '')) {
        const hasCash = deposit > 0 || withdrawal > 0;
        const hasNote = normalizedNote !== undefined ? !!normalizedNote : !!existing?.note;
        if (hasCash || hasNote) {
          const entryPayload = {
            cashIn: deposit,
            cashOut: withdrawal,
            start: existing?.start ?? data.portfolio.portfolio,
            trades: existing?.trades ?? []
          };
          if (normalizedNote !== undefined) {
            if (normalizedNote) {
              entryPayload.note = normalizedNote;
            }
          } else if (existing && typeof existing.note === 'string') {
            const carryNote = existing.note.trim();
            if (carryNote) {
              entryPayload.note = carryNote;
            }
          }
          bucket[date] = entryPayload;
        } else {
          delete bucket[date];
          if (!Object.keys(bucket).length) {
            delete data.pl[ym];
          }
        }
      } else {
        const nextEnd = hasValue ? Number(payload.value) : existing?.end ?? data.portfolio.portfolio;
        if (!Number.isFinite(nextEnd) || nextEnd < 0) {
          return { ok: false, error: 'Invalid portfolio value' };
        }
        const entryPayload = {
          start: existing?.start ?? data.portfolio.portfolio,
          end: nextEnd,
          cashIn: deposit,
          cashOut: withdrawal,
          trades: existing?.trades ?? []
        };
        if (normalizedNote !== undefined) {
          if (normalizedNote) {
            entryPayload.note = normalizedNote;
          }
        } else if (existing && typeof existing.note === 'string') {
          const carryNote = existing.note.trim();
          if (carryNote) {
            entryPayload.note = carryNote;
          }
        }
        bucket[date] = entryPayload;
      }
    }
    saveGuestData(data);
    return { ok: true };
  }
  if (path.startsWith('/api/logout')) {
    return { ok: true };
  }
  if (path.startsWith('/api/market/low')) {
    const params = parseGuestQuery(path);
    const symbol = params.get('symbol');
    if (!symbol) {
      return { ok: false, error: 'Symbol is required' };
    }
    const todayKey = getGuestDateKey();
    return { symbol: symbol.toUpperCase(), low: computeGuestMarketLow(symbol.toUpperCase(), todayKey), currency: 'USD' };
  }
  if (path.startsWith('/api/trades/active')) {
    const active = computeGuestActiveTrades(data, rates);
    data.activeTrades = active.trades;
    saveGuestData(data);
    return {
      trades: active.trades,
      liveOpenPnl: active.liveOpenPnl,
      liveOpenPnlMode: 'computed',
      liveOpenPnlCurrency: 'GBP'
    };
  }
  if (path.startsWith('/api/integrations/trading212')) {
    data.integrations ||= { trading212: {} };
    const t212 = data.integrations.trading212 || {};
    if (method === 'GET') {
      return t212;
    }
    const payload = opts.body ? JSON.parse(opts.body) : {};
    const next = {
      ...t212,
      enabled: !!payload.enabled,
      mode: payload.mode || t212.mode || 'live',
      snapshotTime: payload.snapshotTime || t212.snapshotTime || '21:00',
      timezone: payload.timezone || t212.timezone || 'Europe/London',
      baseUrl: payload.baseUrl || t212.baseUrl || '',
      endpoint: payload.endpoint || t212.endpoint || '/api/v0/equity/account/summary'
    };
    if (Object.prototype.hasOwnProperty.call(payload, 'apiKey')) {
      next.hasApiKey = !!payload.apiKey;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'apiSecret')) {
      next.hasApiSecret = !!payload.apiSecret;
    }
    if (payload.runNow) {
      next.lastSyncAt = new Date().toISOString();
      next.lastStatus = { ok: true, message: 'Guest mode simulated sync.' };
      next.lastBaseUrl = next.baseUrl;
      next.lastEndpoint = next.endpoint;
    }
    data.integrations.trading212 = next;
    saveGuestData(data);
    return next;
  }
  if (path.startsWith('/api/integrations/ibkr')) {
    data.integrations ||= { ibkr: {} };
    const ibkr = data.integrations.ibkr || {};
    if (path.startsWith('/api/integrations/ibkr/connector/register')) {
      ibkr.enabled = true;
      ibkr.mode = 'connector';
      ibkr.connectionStatus = 'online';
      ibkr.lastHeartbeatAt = new Date().toISOString();
      ibkr.lastSnapshotAt = new Date().toISOString();
      data.integrations.ibkr = ibkr;
      saveGuestData(data);
      return { connectorToken: 'guest-connector-token' };
    }
    if (method === 'POST') {
      const payload = opts.body ? JSON.parse(opts.body) : {};
      if (typeof payload.enabled === 'boolean') {
        ibkr.enabled = payload.enabled;
      }
      if (typeof payload.accountId === 'string') {
        ibkr.accountId = payload.accountId;
      }
      if (payload.runNow) {
        ibkr.lastSyncAt = new Date().toISOString();
        ibkr.lastStatus = { ok: true, message: 'Guest mode simulated sync.' };
        ibkr.connectionStatus = 'connected';
      }
      data.integrations.ibkr = ibkr;
      saveGuestData(data);
    }
    return {
      enabled: !!ibkr.enabled,
      mode: ibkr.mode || 'connector',
      accountId: ibkr.accountId || '',
      connectionStatus: ibkr.connectionStatus || 'disconnected',
      lastSyncAt: ibkr.lastSyncAt || null,
      lastHeartbeatAt: ibkr.lastHeartbeatAt || null,
      lastSnapshotAt: ibkr.lastSnapshotAt || null,
      lastStatus: ibkr.lastStatus || null,
      lastSessionCheckAt: ibkr.lastSessionCheckAt || null,
      gatewayUrl: ibkr.gatewayUrl || '/api/integrations/ibkr/gateway',
      connectorConfigured: !!ibkr.connectorConfigured
    };
  }
  if (path.startsWith('/api/trades/export')) {
    return { ok: true };
  }
  if (path.startsWith('/api/trades/close')) {
    const payload = opts.body ? JSON.parse(opts.body) : {};
    const tradeId = payload.tradeId || payload.id;
    const trade = data.trades.find(item => item.id === tradeId);
    if (trade) {
      trade.status = 'closed';
      trade.closePrice = Number(payload.closePrice ?? payload.price) || trade.closePrice;
      trade.closeDate = payload.closeDate || payload.date || trade.closeDate;
      const pnlCurrency = (Number(trade.closePrice) - Number(trade.entry)) * Number(trade.sizeUnits || 0);
      trade.realizedPnlGBP = convertToGBP(pnlCurrency, trade.currency || 'GBP', rates) || 0;
      if (Array.isArray(data.activeTrades)) {
        data.activeTrades = data.activeTrades.filter(item => item.id !== trade.id);
      }
      saveGuestData(data);
    }
    return { ok: true };
  }
  if (path.startsWith('/api/trades')) {
    if (method === 'GET') {
      return { trades: data.trades };
    }
    if (method === 'POST') {
      const payload = opts.body ? JSON.parse(opts.body) : {};
      const id = `guest-${Date.now()}`;
      const todayKey = getGuestDateKey();
      const trade = {
        id,
        symbol: payload.symbol || '',
        status: payload.status || 'open',
        openDate: payload.date || new Date().toISOString().slice(0, 10),
        closeDate: payload.closeDate || '',
        entry: Number(payload.entry) || 0,
        stop: Number(payload.stop) || 0,
        currentStop: payload.currentStop ?? null,
        closePrice: payload.closePrice ?? null,
        currency: payload.currency || 'GBP',
        sizeUnits: Number(payload.sizeUnits) || 0,
        riskPct: Number(payload.riskPct) || 0,
        riskAmountGBP: Number(payload.riskAmount) || 0,
        positionGBP: Number(payload.positionGBP) || 0,
        realizedPnlGBP: 0,
        guaranteedPnlGBP: 0,
        tradeType: payload.tradeType || 'day',
        assetClass: payload.assetClass || 'stocks',
        strategyTag: payload.strategyTag || '',
        marketCondition: payload.marketCondition || '',
        setupTags: payload.setupTags || [],
        emotionTags: payload.emotionTags || [],
        note: payload.note || '',
        source: payload.source || 'manual'
      };
      data.trades.unshift(trade);
      if (trade.status !== 'closed') {
        data.activeTrades ||= [];
        const livePrice = computeGuestLivePrice(trade, todayKey);
        data.activeTrades.unshift({
          id,
          symbol: trade.symbol,
          entry: trade.entry,
          stop: trade.stop,
          currentStop: trade.currentStop ?? null,
          currency: trade.currency,
          sizeUnits: trade.sizeUnits,
          riskPct: trade.riskPct,
          direction: payload.direction || 'long',
          livePrice,
          unrealizedGBP: computeUnrealizedGBP({ ...trade, livePrice }, rates),
          guaranteedPnlGBP: 0,
          positionGBP: trade.positionGBP,
          source: trade.source
        });
      }
      saveGuestData(data);
      return { ok: true, trade };
    }
  }
  if (path.startsWith('/api/trades/')) {
    const parts = path.split('/');
    const tradeId = parts[3];
    const trade = data.trades.find(item => item.id === tradeId);
    if (!trade) return { ok: false };
    if (method === 'DELETE') {
      data.trades = data.trades.filter(item => item.id !== tradeId);
      if (Array.isArray(data.activeTrades)) {
        data.activeTrades = data.activeTrades.filter(item => item.id !== tradeId);
      }
      saveGuestData(data);
      return { ok: true };
    }
    if (method === 'PUT') {
      const payload = opts.body ? JSON.parse(opts.body) : {};
      Object.assign(trade, payload);
      if (trade.status !== 'closed') {
        data.activeTrades ||= [];
        const existing = data.activeTrades.find(item => item.id === tradeId);
        const todayKey = getGuestDateKey();
        const livePrice = computeGuestLivePrice(trade, todayKey);
        if (existing) {
          Object.assign(existing, payload, { livePrice });
          existing.unrealizedGBP = computeUnrealizedGBP(existing, rates);
        } else {
          data.activeTrades.unshift({
            id: trade.id,
            symbol: trade.symbol,
            entry: trade.entry,
            stop: trade.stop,
            currentStop: trade.currentStop ?? null,
            currency: trade.currency,
            sizeUnits: trade.sizeUnits,
            riskPct: trade.riskPct,
            direction: payload.direction || trade.direction || 'long',
            livePrice,
            unrealizedGBP: computeUnrealizedGBP({ ...trade, livePrice }, rates),
            guaranteedPnlGBP: trade.guaranteedPnlGBP ?? 0,
            positionGBP: trade.positionGBP,
            source: trade.source
          });
        }
      }
      if (trade.status === 'closed' && Array.isArray(data.activeTrades)) {
        data.activeTrades = data.activeTrades.filter(item => item.id !== tradeId);
      }
      saveGuestData(data);
      return { ok: true, trade };
    }
  }
  if (path.startsWith('/api/analytics/summary')) {
    return { summary: data.analytics?.summary || {}, breakdowns: {} };
  }
  if (path.startsWith('/api/analytics/equity-curve')) {
    return { curve: data.analytics?.equityCurve || [] };
  }
  if (path.startsWith('/api/analytics/drawdown')) {
    return { drawdown: data.analytics?.drawdown || {} };
  }
  if (path.startsWith('/api/analytics/distribution')) {
    return { distribution: data.analytics?.distribution || {} };
  }
  if (path.startsWith('/api/analytics/streaks')) {
    return { streaks: data.analytics?.streaks || {} };
  }
  return { ok: true };
};
