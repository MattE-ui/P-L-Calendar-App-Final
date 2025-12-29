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

function ensureGuestMonth(pl, dateKey) {
  const ym = dateKey.slice(0, 7);
  pl[ym] ||= {};
  return { ym, bucket: pl[ym] };
}

function computeGuestActiveTrades(data) {
  const trades = data.trades.filter(trade => trade.status !== 'closed' && !Number.isFinite(Number(trade.closePrice)));
  const liveOpenPnl = trades.reduce((sum, trade) => sum + (Number(trade.unrealizedGBP) || 0), 0);
  return { trades, liveOpenPnl };
}

window.GUEST_DATA = loadGuestData();
window.handleGuestRequest = (path, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase();
  const data = window.GUEST_DATA;
  const rates = data.rates || { GBP: 1, USD: 1.24, EUR: 1.12 };
  if (path.startsWith('/api/rates')) {
    return { rates, cachedAt: Date.now() };
  }
  if (path.startsWith('/api/profile')) {
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
    if (date) {
      const { bucket } = ensureGuestMonth(data.pl, date);
      bucket[date] = {
        ...bucket[date],
        start: bucket[date]?.start ?? data.portfolio.portfolio,
        end: payload.value ?? bucket[date]?.end ?? data.portfolio.portfolio,
        cashIn: Number(payload.cashIn ?? 0),
        cashOut: Number(payload.cashOut ?? 0),
        note: payload.note ?? bucket[date]?.note ?? '',
        trades: bucket[date]?.trades ?? []
      };
    }
    saveGuestData(data);
    return { ok: true };
  }
  if (path.startsWith('/api/market/low')) {
    return { low: 220.5 };
  }
  if (path.startsWith('/api/trades/active')) {
    const active = computeGuestActiveTrades(data);
    return {
      trades: active.trades,
      liveOpenPnl: active.liveOpenPnl,
      liveOpenPnlMode: 'computed',
      liveOpenPnlCurrency: 'GBP'
    };
  }
  if (path.startsWith('/api/trades/export')) {
    return { ok: true };
  }
  if (path.startsWith('/api/trades/close')) {
    const payload = opts.body ? JSON.parse(opts.body) : {};
    const trade = data.trades.find(item => item.id === payload.tradeId);
    if (trade) {
      trade.status = 'closed';
      trade.closePrice = Number(payload.closePrice) || trade.closePrice;
      trade.closeDate = payload.closeDate || trade.closeDate;
      const pnlCurrency = (Number(trade.closePrice) - Number(trade.entry)) * Number(trade.sizeUnits || 0);
      trade.realizedPnlGBP = convertToGBP(pnlCurrency, trade.currency || 'GBP', rates) || 0;
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
      saveGuestData(data);
      return { ok: true };
    }
    if (method === 'PUT') {
      const payload = opts.body ? JSON.parse(opts.body) : {};
      Object.assign(trade, payload);
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
