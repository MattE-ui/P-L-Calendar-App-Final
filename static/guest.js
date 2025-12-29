const DEFAULT_GUEST_DATA = {
  portfolio: {
    portfolio: 12000,
    initialNetDeposits: 8000,
    netDepositsTotal: 9000,
    liveOpenPnl: 145.32,
    livePortfolio: 12000,
    profileComplete: true,
    activeTrades: 2
  },
  pl: {
    "2025-12": {
      "2025-12-20": {
        start: 10200,
        end: 10350,
        cashIn: 0,
        cashOut: 0,
        note: "First week trading",
        trades: []
      },
      "2025-12-21": {
        start: 10350,
        end: 10520,
        cashIn: 0,
        cashOut: 0,
        note: "",
        trades: []
      },
      "2025-12-22": {
        start: 10520,
        end: 10840,
        cashIn: 500,
        cashOut: 0,
        note: "Deposit",
        trades: []
      },
      "2025-12-23": {
        start: 10840,
        end: 11020,
        cashIn: 0,
        cashOut: 0,
        note: "",
        trades: []
      },
      "2025-12-24": {
        start: 11020,
        end: 11250,
        cashIn: 0,
        cashOut: 0,
        note: "",
        trades: []
      }
    }
  },
  activeTrades: [
    {
      id: "guest1",
      symbol: "SNDK",
      entry: 232.8,
      stop: 221.01,
      currentStop: 233.0,
      currency: "GBP",
      sizeUnits: 4,
      riskPct: 0.38,
      direction: "long",
      livePrice: 250.45,
      unrealizedGBP: 44.62,
      guaranteedPnlGBP: 0.59,
      positionGBP: 931.2,
      source: "manual"
    },
    {
      id: "guest2",
      symbol: "AAPL",
      entry: 183.2,
      stop: 175.4,
      currency: "USD",
      sizeUnits: 3,
      riskPct: 0.45,
      direction: "long",
      livePrice: 188.25,
      unrealizedGBP: 11.2,
      guaranteedPnlGBP: -6.3,
      positionGBP: 420,
      source: "manual"
    }
  ],
  trades: [
    {
      id: "guest1",
      symbol: "SNDK",
      status: "open",
      openDate: "2025-12-24",
      entry: 232.8,
      stop: 221.01,
      currentStop: 233.0,
      currency: "GBP",
      sizeUnits: 4,
      riskPct: 0.38,
      riskAmountGBP: 44.62,
      positionGBP: 931.2,
      realizedPnlGBP: 0,
      guaranteedPnlGBP: 0.59,
      tradeType: "swing",
      assetClass: "stocks",
      strategyTag: "Breakout",
      marketCondition: "Trend",
      setupTags: ["breakout"],
      emotionTags: ["confident"],
      note: "Guest demo trade",
      source: "manual"
    },
    {
      id: "guest2",
      symbol: "AAPL",
      status: "closed",
      openDate: "2025-12-20",
      closeDate: "2025-12-22",
      entry: 183.2,
      stop: 175.4,
      closePrice: 190.6,
      currency: "USD",
      sizeUnits: 3,
      riskPct: 0.45,
      riskAmountGBP: 23.5,
      positionGBP: 420,
      realizedPnlGBP: 18.4,
      guaranteedPnlGBP: 0,
      tradeType: "day",
      assetClass: "stocks",
      strategyTag: "Momentum",
      marketCondition: "Trending",
      setupTags: ["momentum"],
      emotionTags: ["focused"],
      note: "Closed winner",
      source: "manual"
    }
  ],
  analytics: {
    summary: {
      total: 12,
      wins: 7,
      losses: 5,
      winRate: 0.58,
      lossRate: 0.42,
      avgWin: 64.4,
      avgLoss: 38.2,
      expectancy: 14.6,
      profitFactor: 1.68,
      avgR: 1.2
    },
    drawdown: {
      maxDrawdown: -120,
      durationDays: 4,
      series: []
    },
    distribution: {
      median: 18,
      stddev: 42,
      histogram: []
    },
    streaks: {
      maxWinStreak: 3,
      maxLossStreak: 2
    },
    equityCurve: [
      { date: "2025-12-20", cumulative: 0 },
      { date: "2025-12-21", cumulative: 45 },
      { date: "2025-12-22", cumulative: 80 },
      { date: "2025-12-23", cumulative: 120 },
      { date: "2025-12-24", cumulative: 165 }
    ]
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
  const openTrades = data.trades.filter(trade => trade.status !== 'closed' && !Number.isFinite(Number(trade.closePrice)));
  const activeTrades = Array.isArray(data.activeTrades) ? data.activeTrades : [];
  const activeMap = new Map(activeTrades.map(trade => [trade.id, trade]));
  const trades = openTrades.map(trade => {
    const merged = { ...trade, ...activeMap.get(trade.id) };
    if (!Number.isFinite(Number(merged.livePrice))) {
      merged.livePrice = Number.isFinite(Number(trade.entry)) ? Number(trade.entry) : 0;
    }
    if (!Number.isFinite(Number(merged.unrealizedGBP))) {
      merged.unrealizedGBP = computeUnrealizedGBP(merged, rates);
    }
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
    return { low: 220.5 };
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
          livePrice: Number(payload.entry) || 0,
          unrealizedGBP: 0,
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
        if (existing) {
          Object.assign(existing, payload);
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
            livePrice: Number.isFinite(Number(trade.entry)) ? Number(trade.entry) : 0,
            unrealizedGBP: computeUnrealizedGBP(trade, rates),
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
