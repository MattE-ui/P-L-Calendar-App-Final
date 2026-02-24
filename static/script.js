const state = {
  view: 'day',
  selected: new Date(),
  data: {},
  portfolioGBP: 0,
  netDepositsBaselineGBP: 0,
  netDepositsTotalGBP: 0,
  firstEntryKey: null,
  currency: 'GBP',
  riskCurrency: 'GBP',
  defaultRiskCurrency: 'GBP',
  rates: { GBP: 1 },
  liveOpenPnlGBP: 0,
  openLossPotentialGBP: 0,
  livePortfolioGBP: 0,
  activeTrades: [],
  activeTradeSort: 'newest',
  liveOpenPnlMode: 'computed',
  liveOpenPnlCurrency: 'GBP',
  isGuest: false,
  isAdmin: false,
  profile: null,
  metrics: {
    baselineGBP: 0,
    latestGBP: 0,
    netDepositsGBP: 0,
    netPerformanceGBP: 0,
    netPerformancePct: null
  },
  direction: 'long',
  defaultRiskPct: 1,
  safeScreenshot: false,
  fees: 0,
  slippage: 0,
  rounding: 'fractional',
  autoStopSymbol: '',
  autoStopValue: null,
  manualStopOverride: false
};

const ACTIVE_TRADE_SORTS = new Set([
  'newest',
  'oldest',
  'best-percent',
  'worst-percent',
  'best-amount',
  'worst-amount'
]);
const SHOW_MAPPING_BADGE = false;

const currencySymbols = { GBP: '£', USD: '$', EUR: '€' };
const shareCardState = { blob: null, url: null, trade: null, orientation: 'landscape' };
const viewAvgLabels = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' };
const SAFE_SCREENSHOT_LABEL = 'Hidden';

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const isGuestSession = () => (sessionStorage.getItem('guestMode') === 'true'
  || localStorage.getItem('guestMode') === 'true')
  && typeof window.handleGuestRequest === 'function';
const clearGuestMode = () => {
  sessionStorage.removeItem('guestMode');
  localStorage.removeItem('guestMode');
};

async function api(path, opts = {}) {
  const isGuest = isGuestSession();
  const method = (opts.method || 'GET').toUpperCase();
  if (isGuest && typeof window.handleGuestRequest === 'function') {
    if (method !== 'GET') {
      return window.handleGuestRequest(path, opts);
    }
    return window.handleGuestRequest(path, opts);
  }
  const res = await fetch(path, { credentials: 'include', ...opts });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (res.status === 401) {
    if (data?.error && data.error.includes('Guest session expired')) {
      window.location.href = '/login.html?expired=guest';
    } else {
      window.location.href = '/login.html';
    }
    throw new Error('Unauthenticated');
  }
  if (res.status === 409 && data?.code === 'profile_incomplete') {
    window.location.href = '/profile.html';
    throw new Error('Profile incomplete');
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.data = data;
    err.status = res.status;
    throw err;
  }
  if (!isGuestSession()) {
    clearGuestMode();
  }
  return data;
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday start
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function ym(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currencyAmount(valueGBP, currency = state.currency) {
  const base = Number(valueGBP);
  if (Number.isNaN(base)) return null;
  if (currency === 'GBP') return base;
  const rate = state.rates[currency];
  if (!rate) return null;
  return base * rate;
}

function formatCurrency(valueGBP, currency = state.currency) {
  if (currency === 'GBP') {
    const amount = Number(valueGBP) || 0;
    const sign = amount < 0 ? '-' : '';
    return `${sign}${currencySymbols[currency]}${Math.abs(amount).toFixed(2)}`;
  }
  const amount = currencyAmount(Math.abs(valueGBP), currency);
  if (amount === null) return '—';
  const sign = valueGBP < 0 ? '-' : '';
  return `${sign}${currencySymbols[currency]}${amount.toFixed(2)}`;
}

function formatSignedCurrency(valueGBP, currency = state.currency) {
  if (valueGBP === 0) return `${currencySymbols[currency]}0.00`;
  const amount = currencyAmount(Math.abs(valueGBP), currency);
  if (amount === null) return '—';
  const sign = valueGBP > 0 ? '+' : '-';
  return `${sign}${currencySymbols[currency]}${amount.toFixed(2)}`;
}

function formatSignedRaw(value, currency = state.currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  const symbol = currencySymbols[currency] || '';
  return `${sign}${symbol}${Math.abs(amount).toFixed(2)}`;
}

function formatLiveOpenPnl(value) {
  return formatSignedCurrency(value, state.currency);
}

function formatShares(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

function computeRiskPlan({
  entry,
  stop,
  portfolio,
  riskPct,
  fees = 0,
  slippage = 0,
  direction = 'long',
  allowFractional = true
}) {
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(portfolio) || portfolio <= 0) {
    return { error: 'Missing prices or portfolio value.' };
  }
  const dir = direction === 'short' ? 'short' : 'long';
  if (dir === 'long' && stop >= entry) return { error: 'Stop must be below entry for long trades.' };
  if (dir === 'short' && stop <= entry) return { error: 'Stop must be above entry for short trades.' };
  if (!Number.isFinite(riskPct) || riskPct <= 0) return { error: 'Enter a risk percentage above 0.' };
  const perShareRiskBase = dir === 'long' ? (entry - stop) : (stop - entry);
  const perShareRisk = perShareRiskBase + (slippage > 0 ? slippage : 0);
  if (perShareRisk <= 0) return { error: 'Entry and stop-loss cannot match.' };
  const riskAmount = portfolio * (riskPct / 100);
  const spendable = Math.max(riskAmount - fees, 0);
  const sharesRaw = spendable / perShareRisk;
  const shares = allowFractional ? sharesRaw : Math.floor(sharesRaw);
  const positionValue = shares * entry;
  const unusedRisk = allowFractional ? 0 : (spendable - shares * perShareRisk);
  return {
    riskAmount,
    perShareRisk,
    shares,
    positionValue,
    unusedRisk,
    fees
  };
}

function formatPrice(value, currency = state.currency, decimals = 4) {
  const symbol = currencySymbols[currency] || '';
  if (!Number.isFinite(value)) return '—';
  return `${symbol}${value.toFixed(decimals)}`;
}

function toGBP(value, currency = state.currency) {
  if (currency === 'GBP') return value;
  const rate = state.rates[currency];
  if (!rate) return value;
  return value / rate;
}

function signPrefix(num) {
  return num > 0 ? '+' : num < 0 ? '-' : '';
}

function getMonthData(date) {
  const key = ym(date);
  return state.data?.[key] || {};
}

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '0.00%';
  return `${signPrefix(value)}${Math.abs(value).toFixed(2)}%`;
}

function computeAverageChangePercent(avgChangeGBP, portfolioValueGBP) {
  const avgChange = Number(avgChangeGBP);
  const portfolioValue = Number(portfolioValueGBP);
  if (!Number.isFinite(avgChange) || !Number.isFinite(portfolioValue) || portfolioValue === 0) {
    return null;
  }
  return (avgChange / Math.abs(portfolioValue)) * 100;
}

function computeChangePercentFromLatestPortfolio(changeGBP) {
  return computeAverageChangePercent(changeGBP, getLatestPortfolioGBP());
}

function formatRiskMultiple(value) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const formatted = abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1);
  return `${sign}${formatted}R`;
}

function getTradeRiskAmountGBP(trade) {
  if (Number.isFinite(trade?.riskAmountGBP)) return trade.riskAmountGBP;
  if (Number.isFinite(trade?.riskAmountCurrency)) {
    return toGBP(trade.riskAmountCurrency, trade.currency || 'GBP');
  }
  if (Number.isFinite(trade?.perUnitRisk) && Number.isFinite(trade?.sizeUnits)) {
    return toGBP(trade.perUnitRisk * trade.sizeUnits, trade.currency || 'GBP');
  }
  const entry = Number(trade?.entry);
  const stop = Number(trade?.stop);
  const units = Number(trade?.sizeUnits);
  if (Number.isFinite(entry) && Number.isFinite(stop) && Number.isFinite(units)) {
    return toGBP(Math.abs(entry - stop) * units, trade.currency || 'GBP');
  }
  return null;
}

function getTradeRiskMultiple(trade, pnlGBP) {
  if (Number.isFinite(trade?.rMultiple)) return trade.rMultiple;
  const pnl = Number.isFinite(pnlGBP)
    ? pnlGBP
    : (Number.isFinite(trade?.realizedPnlGBP)
      ? trade.realizedPnlGBP
      : (Number.isFinite(trade?.unrealizedGBP) ? trade.unrealizedGBP : null));
  const riskGBP = getTradeRiskAmountGBP(trade);
  if (!Number.isFinite(pnl) || !Number.isFinite(riskGBP) || riskGBP === 0) return null;
  return pnl / riskGBP;
}

function summarizeWeek(entries = []) {
  const totalChange = entries.reduce((sum, e) => sum + (e.change ?? 0), 0);
  const totalCashFlow = entries.reduce((sum, e) => sum + (e.cashFlow ?? 0), 0);
  const totalTrades = entries.reduce((sum, e) => sum + (e.tradesCount ?? 0), 0);
  const realized = entries
    .filter(e => e.change !== null && e.change !== undefined)
    .reduce((sum, e) => sum + e.change, 0);
  return { totalChange, totalCashFlow, totalTrades, realized };
}

function getSelectedTags(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(el => el.value);
}

function normalizeTradeRecords(trades) {
  if (!Array.isArray(trades)) return [];
  return trades.map(trade => {
    if (!trade || typeof trade !== 'object') return null;
    const entry = Number(trade.entry);
    const stop = Number(trade.stop);
    const riskPct = Number(trade.riskPct);
    const currency = trade.currency === 'USD' ? 'USD' : 'GBP';
    const perUnitRisk = Number(trade.perUnitRisk);
    const sizeUnits = Number(trade.sizeUnits);
    const status = trade.status === 'closed' ? 'closed' : 'open';
    const symbol = typeof trade.symbol === 'string' ? trade.symbol : '';
    const displaySymbol = typeof trade.displaySymbol === 'string' ? trade.displaySymbol : '';
    const displayTicker = typeof trade.displayTicker === 'string' ? trade.displayTicker : '';
    if (!Number.isFinite(entry) || entry <= 0) return null;
    if (!Number.isFinite(stop) || stop <= 0) return null;
    if (!Number.isFinite(riskPct) || riskPct <= 0) return null;
    if (!Number.isFinite(perUnitRisk) || perUnitRisk <= 0) return null;
    if (!Number.isFinite(sizeUnits) || sizeUnits <= 0) return null;
    const riskAmountGBP = Number(trade.riskAmountGBP);
    const positionGBP = Number(trade.positionGBP);
    const riskAmountCurrency = Number(trade.riskAmountCurrency);
    const positionCurrency = Number(trade.positionCurrency);
    const note = typeof trade.note === 'string' ? trade.note.trim() : '';
    const createdAt = typeof trade.createdAt === 'string' ? trade.createdAt : '';
    const tradeType = typeof trade.tradeType === 'string' ? trade.tradeType : 'day';
    const assetClass = typeof trade.assetClass === 'string' ? trade.assetClass : 'stocks';
    const strategyTag = typeof trade.strategyTag === 'string' ? trade.strategyTag : '';
    const marketCondition = typeof trade.marketCondition === 'string' ? trade.marketCondition : '';
    const setupTags = Array.isArray(trade.setupTags) ? trade.setupTags : [];
    const emotionTags = Array.isArray(trade.emotionTags) ? trade.emotionTags : [];
    const screenshotUrl = typeof trade.screenshotUrl === 'string' ? trade.screenshotUrl : '';
    const direction = trade.direction === 'short' ? 'short' : 'long';
    const fees = Number(trade.fees);
    const slippage = Number(trade.slippage);
    const rounding = trade.rounding === 'whole' ? 'whole' : 'fractional';
    const currentStop = Number(trade.currentStop);
    const currentStopSource = typeof trade.currentStopSource === 'string' ? trade.currentStopSource : '';
    const currentStopLastSyncedAt = typeof trade.currentStopLastSyncedAt === 'string' ? trade.currentStopLastSyncedAt : '';
    const currentStopStale = trade.currentStopStale === true;
    return {
      id: typeof trade.id === 'string' ? trade.id : `${entry}-${stop}-${riskPct}-${Math.random()}`,
      entry,
      stop,
      currency,
      riskPct,
      perUnitRisk,
      sizeUnits,
      status,
      symbol,
      displaySymbol,
      displayTicker,
      mappingScope: trade.mappingScope || null,
      brokerTicker: trade.brokerTicker || '',
      riskAmountGBP: Number.isFinite(riskAmountGBP) ? riskAmountGBP : null,
      positionGBP: Number.isFinite(positionGBP) ? positionGBP : null,
      riskAmountCurrency: Number.isFinite(riskAmountCurrency) ? riskAmountCurrency : null,
      positionCurrency: Number.isFinite(positionCurrency) ? positionCurrency : null,
      portfolioGBPAtCalc: Number.isFinite(trade.portfolioGBPAtCalc) ? Number(trade.portfolioGBPAtCalc) : null,
      portfolioCurrencyAtCalc: Number.isFinite(trade.portfolioCurrencyAtCalc) ? Number(trade.portfolioCurrencyAtCalc) : null,
      closePrice: Number.isFinite(trade.closePrice) ? trade.closePrice : null,
      closeDate: typeof trade.closeDate === 'string' ? trade.closeDate : null,
      note,
      tradeType,
      assetClass,
      strategyTag,
      marketCondition,
      setupTags,
      emotionTags,
      screenshotUrl,
      direction,
      fees: Number.isFinite(fees) ? fees : 0,
      slippage: Number.isFinite(slippage) ? slippage : 0,
      rounding,
      currentStop: Number.isFinite(currentStop) ? currentStop : null,
      currentStopSource,
      currentStopLastSyncedAt,
      currentStopStale,
      createdAt
    };
  }).filter(Boolean);
}

function getTradeDisplaySymbol(trade) {
  if (!trade) return '—';
  return trade.displayTicker || trade.displaySymbol || trade.symbol || '—';
}

function shouldShowMappingBadge(trade) {
  if (!SHOW_MAPPING_BADGE) return false;
  if (!trade?.mappingScope) return false;
  if (!trade.displayTicker || !trade.brokerTicker) return true;
  return trade.displayTicker !== trade.brokerTicker;
}

function createMappingBadge() {
  const badge = document.createElement('span');
  badge.className = 'mapping-badge';
  badge.textContent = 'Mapped';
  badge.title = 'Display ticker overridden (uses Trading 212 instrument for pricing)';
  return badge;
}

function getDailyEntry(date) {
  const key = formatDate(date);
  const month = getMonthData(date);
  if (!(key in month)) return null;
  const record = month[key] || {};
  const opening = Number(record.start);
  const closing = Number(record.end);
  const trades = normalizeTradeRecords(record.trades);
  const hasClosing = Number.isFinite(closing);
  const hasOpening = Number.isFinite(opening);
  const cashInRaw = Number(record.cashIn ?? 0);
  const cashOutRaw = Number(record.cashOut ?? 0);
  const cashIn = Number.isFinite(cashInRaw) && cashInRaw >= 0 ? cashInRaw : 0;
  const cashOut = Number.isFinite(cashOutRaw) && cashOutRaw >= 0 ? cashOutRaw : 0;
  const noteRaw = typeof record.note === 'string' ? record.note : '';
  const note = noteRaw.trim();
  if (!hasClosing && !trades.length && cashIn === 0 && cashOut === 0 && !note) return null;
  const netCash = cashIn - cashOut;
  let change = null;
  let pct = null;
  if (hasClosing && hasOpening) {
    const base = opening + netCash;
    change = closing - base;
    pct = base !== 0 ? (change / base) * 100 : null;
    if (opening === closing && netCash !== 0) {
      change = 0;
      pct = 0;
    }
  }
  return {
    date,
    opening: hasOpening ? opening : null,
    closing: hasClosing ? closing : null,
    hasClosing,
    change,
    pct,
    cashIn,
    cashOut,
    cashFlow: netCash,
    preBaseline: record.preBaseline === true,
    note,
    trades,
    tradesCount: trades.length
  };
}

function getDaysInMonth(date) {
  const start = startOfMonth(date);
  const total = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const days = [];
  for (let i = 1; i <= total; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), i));
  }
  return days;
}

function getWeeksInMonth(date) {
  const start = startOfMonth(date);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const weeks = [];
  let cursor = startOfWeek(start);
  while (cursor <= end) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const displayStart = weekStart < start ? start : weekStart;
    const displayEnd = weekEnd > end ? end : weekEnd;
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      if (day < start || day > end) continue;
      const entry = getDailyEntry(day);
      if (entry) days.push(entry);
    }
    const changeEntries = days.filter(entry => entry?.change !== null);
    const totalChange = changeEntries.reduce((sum, entry) => sum + entry.change, 0);
    const totalCashFlow = days.reduce((sum, entry) => sum + (entry?.cashFlow ?? 0), 0);
    const totalTrades = days.reduce((sum, entry) => sum + (entry?.tradesCount ?? 0), 0);
    const pct = changeEntries.length
      ? computeChangePercentFromLatestPortfolio(totalChange)
      : null;
    const trades = days.flatMap(d => d.trades || []);
    weeks.push({
      totalChange,
      pct,
      hasChange: changeEntries.length > 0,
      totalCashFlow,
      totalTrades,
      recordedDays: days.length,
      entries: days,
      trades,
      displayStart: displayStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      displayEnd: displayEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function getYearMonths(date) {
  const year = date.getFullYear();
  const months = [];
  for (let m = 0; m < 12; m++) {
    const monthDate = new Date(year, m, 1);
    const days = getDaysInMonth(monthDate)
      .map(getDailyEntry)
      .filter(Boolean);
    const changeEntries = days.filter(entry => entry.change !== null);
    const totalChange = changeEntries.reduce((sum, entry) => sum + entry.change, 0);
    const totalCashFlow = days.reduce((sum, entry) => sum + (entry.cashFlow ?? 0), 0);
    const pct = changeEntries.length
      ? computeChangePercentFromLatestPortfolio(totalChange)
      : null;
    months.push({
      monthDate,
      totalChange,
      pct,
      totalCashFlow,
      recordedDays: days.length,
      hasChange: changeEntries.length > 0
    });
  }
  return months;
}

function getValuesForSummary() {
  if (state.view === 'month') {
    return getYearMonths(state.selected).map(item => ({
      change: item.hasChange ? item.totalChange : null,
      pct: item.hasChange ? item.pct : null,
      cashFlow: item.totalCashFlow ?? 0
    }));
  }
  if (state.view === 'year') {
    const entries = getAllEntries();
    if (!entries.length) return [];
    const years = entries.reduce((acc, entry) => {
      const year = entry.date.getFullYear();
      if (!acc[year]) acc[year] = [];
      acc[year].push(entry);
      return acc;
    }, {});
    return Object.values(years).map(yearEntries => {
      const totalChange = yearEntries.reduce((sum, entry) => sum + (entry.change ?? 0), 0);
      const totalCashFlow = yearEntries.reduce((sum, entry) => sum + (entry.cashFlow ?? 0), 0);
      const baseline = yearEntries[0]?.opening ?? yearEntries[0]?.closing ?? null;
      const pct = baseline ? (totalChange / baseline) * 100 : null;
      return { change: totalChange, pct, cashFlow: totalCashFlow };
    });
  }
  if (state.view === 'week') {
    return getWeeksInMonth(state.selected).map(item => ({
      change: item.hasChange ? item.totalChange : null,
      pct: item.hasChange ? item.pct : null,
      cashFlow: item.totalCashFlow ?? 0
    }));
  }
  return getDaysInMonth(state.selected)
    .map(getDailyEntry)
    .filter(Boolean)
    .map(item => ({ change: item.change, pct: item.pct, cashFlow: item.cashFlow ?? 0 }));
}

function getAllEntries() {
  const entries = [];
  Object.entries(state.data || {}).forEach(([, days]) => {
    Object.keys(days || {}).forEach(dateKey => {
      const date = new Date(dateKey);
      if (Number.isNaN(date.getTime())) return;
      const entry = getDailyEntry(date);
      if (entry?.hasClosing) entries.push(entry);
    });
  });
  entries.sort((a, b) => a.date - b.date);
  return entries;
}

function computeLifetimeMetrics() {
  const entries = getAllEntries();
  const baselineDeposits = Number.isFinite(state.netDepositsBaselineGBP)
    ? state.netDepositsBaselineGBP
    : 0;
  const knownTotalDeposits = Number.isFinite(state.netDepositsTotalGBP)
    ? state.netDepositsTotalGBP
    : baselineDeposits;
  state.firstEntryKey = entries.length ? formatDate(entries[0].date) : null;
  if (!entries.length) {
    const fallback = Number.isFinite(state.portfolioGBP) ? state.portfolioGBP : 0;
    const totalNetDeposits = Number.isFinite(knownTotalDeposits)
      ? knownTotalDeposits
      : baselineDeposits;
    const netPerformance = fallback - totalNetDeposits;
    const denominator = totalNetDeposits !== 0
      ? totalNetDeposits
      : (fallback !== 0 ? fallback : null);
    const pct = denominator ? (netPerformance / denominator) * 100 : null;
    state.netDepositsTotalGBP = Number.isFinite(totalNetDeposits) ? totalNetDeposits : 0;
    state.metrics = {
      baselineGBP: fallback,
      latestGBP: fallback,
      netDepositsGBP: state.netDepositsTotalGBP,
      netPerformanceGBP: netPerformance,
      netPerformancePct: Number.isFinite(pct) ? pct : null
    };
    return;
  }
  let baseline = null;
  let latest = Number.isFinite(entries[entries.length - 1]?.closing)
    ? entries[entries.length - 1].closing
    : Number.isFinite(state.portfolioGBP) ? state.portfolioGBP : null;
  entries.forEach(entry => {
    if (baseline === null && entry?.opening !== null && entry?.opening !== undefined) {
      baseline = entry.opening;
    }
    if (entry?.closing !== null && entry?.closing !== undefined) {
      latest = entry.closing;
    }
  });
  if (baseline === null || baseline === undefined) {
    const first = entries[0];
    baseline = (first?.opening !== null && first?.opening !== undefined)
      ? first.opening
      : (first?.closing ?? 0);
  }
  const safeBaseline = Number.isFinite(baseline) ? baseline : 0;
  const safeLatest = Number.isFinite(latest) ? latest : safeBaseline;
  const totalNetDeposits = Number.isFinite(knownTotalDeposits)
    ? knownTotalDeposits
    : baselineDeposits;
  state.netDepositsTotalGBP = Number.isFinite(totalNetDeposits) ? totalNetDeposits : 0;
  const netPerformance = safeLatest - state.netDepositsTotalGBP;
  const denominator = state.netDepositsTotalGBP !== 0
    ? state.netDepositsTotalGBP
    : (safeBaseline !== 0 ? safeBaseline : null);
  const pct = denominator ? (netPerformance / denominator) * 100 : null;
  state.metrics = {
    baselineGBP: safeBaseline,
    latestGBP: safeLatest,
    netDepositsGBP: state.netDepositsTotalGBP,
    netPerformanceGBP: netPerformance,
    netPerformancePct: Number.isFinite(pct) ? pct : null
  };
}

function getLatestPortfolioGBP() {
  const live = Number(state.livePortfolioGBP);
  if (Number.isFinite(live) && live > 0) return live;
  const latestMetric = Number(state.metrics?.latestGBP);
  if (Number.isFinite(latestMetric) && latestMetric > 0) return latestMetric;
  const portfolioVal = Number(state.portfolioGBP);
  return Number.isFinite(portfolioVal) && portfolioVal > 0 ? portfolioVal : 0;
}

function setRiskOutputs(values = null) {
  const riskAmountEl = $('#risk-amount-display');
  const positionEl = $('#risk-position-display');
  const sharesEl = $('#risk-shares-display');
  const perShareEl = $('#risk-per-share-display');
  const amountNote = $('#risk-amount-note');
  const positionNote = $('#risk-position-note');
  const shareNote = $('#risk-share-note');
  const perShareNote = $('#risk-per-share-note');

  if (!values) {
    riskAmountEl && (riskAmountEl.textContent = '—');
    positionEl && (positionEl.textContent = '—');
    perShareEl && (perShareEl.textContent = '—');
    sharesEl && (sharesEl.textContent = '0');
    amountNote && (amountNote.textContent = '');
    positionNote && (positionNote.textContent = '');
    shareNote && (shareNote.textContent = '');
    perShareNote && (perShareNote.textContent = '');
    return;
  }

  const { riskAmountGBP, positionGBP, shares, perShareRiskGBP, riskPct, entryGBP, riskAmountCurrency, positionCurrency, unusedRisk } = values;
  const riskCurrency = state.riskCurrency || state.currency;
  riskAmountEl && (riskAmountEl.textContent = formatCurrency(riskAmountGBP, riskCurrency));
  positionEl && (positionEl.textContent = formatCurrency(positionGBP, riskCurrency));
  sharesEl && (sharesEl.textContent = formatShares(shares));
  perShareEl && (perShareEl.textContent = formatCurrency(perShareRiskGBP, riskCurrency));
  amountNote && (amountNote.textContent = `Risking ${riskPct.toFixed(2)}% of your portfolio`);
  let secondaryCurrency = null;
  if (riskCurrency === 'USD') {
    secondaryCurrency = state.currency && state.currency !== 'USD' ? state.currency : null;
  } else {
    secondaryCurrency = 'USD';
  }
  const secondaryValue = secondaryCurrency
    ? formatCurrency(positionGBP, secondaryCurrency)
    : null;
  const secondaryText = secondaryValue && secondaryValue !== '—' && secondaryCurrency !== riskCurrency
    ? ` (${secondaryValue})`
    : '';
  positionNote && (positionNote.textContent = shares > 0
    ? `Position ≈ ${formatCurrency(positionGBP, riskCurrency)}${secondaryText}`
    : 'Position too small for the chosen risk');
  shareNote && (shareNote.textContent = shares > 0 ? 'Fractional units allowed for sizing' : '');
  perShareNote && (perShareNote.textContent = `Difference between entry and stop-loss${state.direction === 'short' ? ' (short)' : ''}`);
  if (unusedRisk && unusedRisk > 0) {
    amountNote && (amountNote.textContent += ` • Unused risk: ${formatCurrency(unusedRisk, riskCurrency)}`);
  }
}

function calculateRiskPosition(showErrors = false) {
  const entryInput = $('#risk-entry-input');
  const stopInput = $('#risk-stop-input');
  const riskPctInput = $('#risk-percent-input');
  const errorEl = $('#risk-error');
  if (!entryInput || !stopInput || !riskPctInput) return;

  const entryRaw = Number(entryInput.value);
  const stopRaw = Number(stopInput.value);
  const riskPct = Number(state.riskPct ?? riskPctInput.value);
  const portfolioGBP = getLatestPortfolioGBP();
  const riskCurrency = state.riskCurrency || 'GBP';
  const direction = state.direction || 'long';
  const fees = 0;
  const slippage = 0;
  const allowFractional = true;

  let error = '';
  const entryGBP = toGBP(entryRaw, riskCurrency);
  const stopGBP = toGBP(stopRaw, riskCurrency);
  const portfolioInRiskCurrency = currencyAmount(portfolioGBP, riskCurrency);
  const computed = computeRiskPlan({
    entry: entryRaw,
    stop: stopRaw,
    portfolio: portfolioInRiskCurrency,
    riskPct,
    fees,
    slippage,
    direction,
    allowFractional
  });
  if (computed.error) error = computed.error;
  if (!Number.isFinite(portfolioInRiskCurrency)) {
    error = 'Missing exchange rate to convert your portfolio.';
  }

  if (errorEl) {
    errorEl.textContent = showErrors ? error : '';
  }

  if (error) {
    setRiskOutputs(null);
    return;
  }

  const riskAmountInCurrency = currencyAmount(portfolioGBP * (riskPct / 100), riskCurrency) ?? (portfolioGBP * (riskPct/100));
  const shares = computed.shares;
  const positionInCurrency = computed.positionValue;
  const positionGBP = toGBP(positionInCurrency, riskCurrency);
  const perShareRiskInCurrency = computed.perShareRisk;

  setRiskOutputs({
    riskAmountGBP: toGBP(riskAmountInCurrency, riskCurrency),
    positionGBP,
    shares,
    perShareRiskGBP: toGBP(perShareRiskInCurrency, riskCurrency),
    riskPct: Number.isFinite(riskPct) ? riskPct : 0,
    entryGBP,
    riskAmountCurrency: riskAmountInCurrency,
    positionCurrency: positionInCurrency,
    unusedRisk: computed.unusedRisk
  });
}

function renderRiskCalculator() {
  if (state.riskCurrency === 'USD' && !state.rates.USD) {
    state.riskCurrency = 'GBP';
  }
  if (state.riskCurrency === 'EUR' && !state.rates.EUR) {
    state.riskCurrency = 'GBP';
  }
  const safeDirection = ['long', 'short'].includes(state.direction) ? state.direction : 'long';
  state.direction = safeDirection;
  $$('#risk-direction-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.direction === safeDirection);
  });
  const tradeTypeInput = $('#trade-type-input');
  if (tradeTypeInput && !tradeTypeInput.value) tradeTypeInput.value = 'day';
  const assetClassInput = $('#asset-class-input');
  if (assetClassInput && !assetClassInput.value) assetClassInput.value = 'stocks';
  const marketConditionInput = $('#market-condition-input');
  if (marketConditionInput && !marketConditionInput.value) marketConditionInput.value = '';
  const entryLabel = $('#risk-entry-label');
  const symbol = currencySymbols[state.riskCurrency] || '£';
  if (entryLabel) entryLabel.textContent = 'Entry price';
  const stopLabel = $('#risk-stop-label');
  if (stopLabel) stopLabel.textContent = 'Stop price';
  const entryInput = $('#risk-entry-input');
  if (entryInput) entryInput.placeholder = symbol;
  const stopInput = $('#risk-stop-input');
  if (stopInput) stopInput.placeholder = symbol;
  const portfolioEl = $('#risk-portfolio-display');
  if (portfolioEl) portfolioEl.textContent = formatCurrency(getLatestPortfolioGBP(), state.riskCurrency);
  const pctInput = $('#risk-percent-input');
  if (pctInput) {
    const pctVal = Number(state.riskPct) || Number(pctInput.value) || 1;
    pctInput.value = String(pctVal);
  }
  $$('#risk-percent-toggle button').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.riskPct) === Number(state.riskPct || pctInput?.value || 1));
  });
  const dateInput = $('#risk-date-input');
  if (dateInput && !dateInput.value) {
    dateInput.valueAsDate = new Date();
  }
  const symbolInput = $('#risk-symbol-input');
  if (symbolInput && !symbolInput.value) symbolInput.value = '';
  const allowedCurrencies = ['GBP', 'USD', 'EUR'];
  const safeCurrency = allowedCurrencies.includes(state.riskCurrency) ? state.riskCurrency : 'GBP';
  state.riskCurrency = safeCurrency;
  $$('#risk-currency-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.riskCurrency === safeCurrency);
  });
  calculateRiskPosition(false);
}

async function fetchDailyLow(symbol) {
  if (!symbol) return null;
  const res = await api(`/api/market/low?symbol=${encodeURIComponent(symbol)}`);
  const low = Number(res?.low);
  return Number.isFinite(low) && low > 0 ? low : null;
}

async function updateAutoStop(symbol, stopInput, markAuto) {
  if (!symbol || !stopInput || state.manualStopOverride) return;
  try {
    const low = await fetchDailyLow(symbol);
    if (low === null) return;
    state.autoStopValue = low;
    markAuto(true);
    stopInput.value = low.toFixed(2);
    markAuto(false);
    calculateRiskPosition(false);
  } catch (e) {
    console.warn('Failed to fetch daily low', e);
  }
}

function renderActiveTrades() {
  const list = $('#active-trade-list');
  const empty = $('#active-trade-empty');
  const showAll = $('#active-trade-show-all');
  const pnlEl = $('#live-pnl-display');
  const pnlCard = pnlEl?.closest('.tool-portfolio');
  const openLossEl = $('#open-loss-potential-display');
  const openLossCard = $('#open-loss-potential-card');
  if (!list) return;
  const trades = Array.isArray(state.activeTrades) ? state.activeTrades : [];
  const livePnl = Number.isFinite(state.liveOpenPnlGBP) ? state.liveOpenPnlGBP : 0;
  const openLossPotential = Number.isFinite(state.openLossPotentialGBP) ? state.openLossPotentialGBP : 0;
  if (pnlEl) pnlEl.textContent = state.safeScreenshot ? SAFE_SCREENSHOT_LABEL : formatLiveOpenPnl(livePnl);
  if (openLossEl) openLossEl.textContent = state.safeScreenshot ? SAFE_SCREENSHOT_LABEL : formatLiveOpenPnl(openLossPotential);
  if (pnlCard && !state.safeScreenshot) {
    pnlCard.classList.toggle('positive', livePnl > 0);
    pnlCard.classList.toggle('negative', livePnl < 0);
  } else if (pnlCard) {
    pnlCard.classList.remove('positive', 'negative');
  }
  if (openLossCard && !state.safeScreenshot) {
    openLossCard.classList.toggle('negative', openLossPotential < 0);
  } else if (openLossCard) {
    openLossCard.classList.remove('negative');
  }
  if (list.querySelector('.trade-note-input:focus')) {
    updateActiveTradeDisplay(trades);
    return;
  }
  const noteDrafts = new Map();
  list.querySelectorAll('.trade-pill[data-trade-id]').forEach(pill => {
    const tradeId = pill.dataset.tradeId;
    if (!tradeId) return;
    const noteInput = pill.querySelector('.trade-note-input');
    const notePanel = pill.querySelector('.trade-note-panel');
    const detailsWrap = pill.querySelector('.trade-details-collapsible');
    const isFocused = document.activeElement === noteInput;
    const selection = noteInput && typeof noteInput.selectionStart === 'number'
      ? { start: noteInput.selectionStart, end: noteInput.selectionEnd }
      : null;
    noteDrafts.set(tradeId, {
      note: noteInput ? noteInput.value : '',
      isOpen: notePanel ? !notePanel.classList.contains('is-collapsed') : false,
      detailsOpen: detailsWrap ? !detailsWrap.classList.contains('is-collapsed') : false,
      height: noteInput ? noteInput.style.height : '',
      selection,
      isFocused,
      scrollTop: noteInput ? noteInput.scrollTop : 0
    });
  });
  list.innerHTML = '';
  if (!trades.length) {
    if (empty) empty.classList.remove('is-hidden');
    if (showAll) showAll.classList.add('is-hidden');
    return;
  }
  if (empty) empty.classList.add('is-hidden');
  const parseTradeDate = trade => Date.parse(trade.createdAt || trade.date || trade.openDate || '') || 0;
  const sortedTrades = [...trades].sort((a, b) => {
    const aDate = parseTradeDate(a);
    const bDate = parseTradeDate(b);
    switch (state.activeTradeSort) {
      case 'oldest':
        return aDate - bDate;
      case 'best-percent':
      case 'worst-percent': {
        const aBase = Number.isFinite(a.positionGBP)
          ? a.positionGBP
          : (Number.isFinite(a.entry) && Number.isFinite(a.sizeUnits) && (a.currency || 'GBP') === 'GBP'
            ? a.entry * a.sizeUnits
            : null);
        const bBase = Number.isFinite(b.positionGBP)
          ? b.positionGBP
          : (Number.isFinite(b.entry) && Number.isFinite(b.sizeUnits) && (b.currency || 'GBP') === 'GBP'
            ? b.entry * b.sizeUnits
            : null);
        const aPct = Number.isFinite(a.unrealizedGBP) && Number.isFinite(aBase) && aBase !== 0
          ? (a.unrealizedGBP / aBase) * 100
          : -Infinity;
        const bPct = Number.isFinite(b.unrealizedGBP) && Number.isFinite(bBase) && bBase !== 0
          ? (b.unrealizedGBP / bBase) * 100
          : -Infinity;
        return state.activeTradeSort === 'best-percent' ? bPct - aPct : aPct - bPct;
      }
      case 'best-amount':
      case 'worst-amount': {
        const aAmt = Number.isFinite(a.unrealizedGBP) ? a.unrealizedGBP : -Infinity;
        const bAmt = Number.isFinite(b.unrealizedGBP) ? b.unrealizedGBP : -Infinity;
        return state.activeTradeSort === 'best-amount' ? bAmt - aAmt : aAmt - bAmt;
      }
      case 'newest':
      default:
        return bDate - aDate;
    }
  });

  sortedTrades.forEach(trade => {
    const pill = document.createElement('div');
    pill.className = 'trade-pill';
    if (trade.id) pill.dataset.tradeId = trade.id;
    const sym = getTradeDisplaySymbol(trade);
    const livePrice = Number.isFinite(trade.livePrice) ? trade.livePrice : null;
    const currentStopValue = Number(trade.currentStop);
    const currentStop = Number.isFinite(currentStopValue) ? currentStopValue : null;
    const directionLabel = trade.direction === 'short' ? 'Short' : 'Long';
    const pnl = Number.isFinite(trade.unrealizedGBP) ? trade.unrealizedGBP : 0;
    const guaranteed = Number.isFinite(trade.guaranteedPnlGBP) ? trade.guaranteedPnlGBP : null;
    const riskMultiple = getTradeRiskMultiple(trade, pnl);
    const headerRow = document.createElement('div');
    headerRow.className = 'trade-header-row';
    const title = document.createElement('div');
    title.className = 'trade-title';
    const titleText = document.createElement('span');
    titleText.textContent = `${sym} (${directionLabel})`;
    title.appendChild(titleText);
    if (shouldShowMappingBadge(trade)) {
      title.appendChild(createMappingBadge());
    }
    const pctBase = Number.isFinite(trade.positionGBP)
      ? trade.positionGBP
      : (Number.isFinite(trade.entry) && Number.isFinite(trade.sizeUnits) && (trade.currency || 'GBP') === 'GBP'
        ? trade.entry * trade.sizeUnits
        : null);
    const pctChange = Number.isFinite(pnl) && Number.isFinite(pctBase) && pctBase !== 0
      ? (pnl / pctBase) * 100
      : null;
    const pctSpan = document.createElement('span');
    pctSpan.className = 'trade-percent';
    if (pctChange !== null) {
      pctSpan.textContent = `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(2)}%`;
      if (pctChange > 0) pctSpan.classList.add('positive');
      if (pctChange < 0) pctSpan.classList.add('negative');
    } else {
      pctSpan.textContent = '—';
    }
    title.appendChild(pctSpan);
    headerRow.appendChild(title);
    if (trade.source === 'trading212' || trade.source === 'ibkr') {
      const sourceLogo = document.createElement('div');
      sourceLogo.className = 'trade-source-logo';
      if (trade.source === 'trading212') {
        sourceLogo.innerHTML = '<img src="static/trading212-logo.svg" alt="Trading 212" />';
      } else {
        sourceLogo.textContent = 'IBKR';
      }
      headerRow.appendChild(sourceLogo);
    }
    const isMissingStop = (trade.source === 'trading212' || trade.source === 'ibkr') && trade.currentStopStale === true;
    if (isMissingStop) {
      pill.classList.add('trade-pill-alert');
      const alertBanner = document.createElement('div');
      alertBanner.className = 'trade-alert-banner';
      alertBanner.textContent = 'No active stop order found!';
      pill.appendChild(alertBanner);
    }
    pill.appendChild(headerRow);

    const bodyRow = document.createElement('div');
    bodyRow.className = 'trade-body';

    const pnlStack = document.createElement('div');
    pnlStack.className = 'trade-pnl-stack';

    const pnlCard = document.createElement('div');
    pnlCard.className = `trade-pnl-card ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`;
    pnlCard.dataset.role = 'trade-pnl-card';
    const pnlLabel = document.createElement('span');
    pnlLabel.className = 'trade-pnl-label';
    pnlLabel.textContent = 'Live PnL';
    const pnlValue = document.createElement('strong');
    pnlValue.className = 'trade-pnl-value';
    pnlValue.dataset.role = 'trade-pnl';
    pnlValue.textContent = state.safeScreenshot ? SAFE_SCREENSHOT_LABEL : formatSignedCurrency(pnl);
    pnlCard.append(pnlLabel, pnlValue);
    pnlStack.appendChild(pnlCard);

    if (guaranteed !== null && !isMissingStop) {
      const guaranteedCard = document.createElement('div');
      guaranteedCard.className = `trade-pnl-card trade-pnl-guaranteed-card ${guaranteed > 0 ? 'positive' : guaranteed < 0 ? 'negative' : ''}`;
      guaranteedCard.dataset.role = 'trade-guaranteed-card';
      const guaranteedLabel = document.createElement('span');
      guaranteedLabel.className = 'trade-pnl-label';
      guaranteedLabel.textContent = 'Guaranteed';
      const guaranteedValue = document.createElement('strong');
      guaranteedValue.className = 'trade-pnl-value';
      guaranteedValue.dataset.role = 'trade-guaranteed';
      guaranteedValue.textContent = state.safeScreenshot ? SAFE_SCREENSHOT_LABEL : formatSignedCurrency(guaranteed);
      guaranteedCard.append(guaranteedLabel, guaranteedValue);
      pnlStack.appendChild(guaranteedCard);
    }
    const detailsToggle = document.createElement('button');
    detailsToggle.className = 'ghost trade-details-toggle';
    detailsToggle.type = 'button';
    detailsToggle.textContent = 'Show price info';

    const detailsWrap = document.createElement('div');
    detailsWrap.className = 'trade-details-collapsible is-collapsed';

    const details = document.createElement('dl');
    details.className = 'trade-details';
    const detailItems = [
      ['Buy Price', formatPrice(trade.entry, trade.currency, 2)],
      ['Original Stop', formatPrice(trade.stop, trade.currency, 2)],
      ...(currentStop !== null ? [['Current Stop', formatPrice(currentStop, trade.currency, 2)]] : []),
      ['Live Price', formatPrice(livePrice, trade.currency, 2)]
    ];
    detailItems.forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = `${label}:`;
      const dd = document.createElement('dd');
      dd.textContent = value;
      if (label === 'Live Price') dd.dataset.role = 'detail-live-price';
      if (label === 'Current Stop') dd.dataset.role = 'detail-current-stop';
      if (label === 'Buy Price') dd.dataset.role = 'detail-entry';
      if (label === 'Original Stop') dd.dataset.role = 'detail-stop';
      details.append(dt, dd);
    });
    detailsWrap.appendChild(details);
    const draft = trade.id ? noteDrafts.get(trade.id) : null;
    if (draft?.detailsOpen) {
      detailsWrap.classList.remove('is-collapsed');
      detailsToggle.textContent = 'Hide price info';
    }
    detailsToggle.addEventListener('click', () => {
      const isCollapsed = detailsWrap.classList.toggle('is-collapsed');
      detailsToggle.textContent = isCollapsed ? 'Show price info' : 'Hide price info';
    });
    bodyRow.appendChild(pnlStack);
    if (state.safeScreenshot) {
      pnlStack.classList.add('is-hidden');
      detailsToggle.classList.add('is-hidden');
      detailsWrap.classList.add('is-hidden');
    }
    bodyRow.appendChild(detailsToggle);
    bodyRow.appendChild(detailsWrap);
    pill.appendChild(bodyRow);

    const metaRow = document.createElement('div');
    metaRow.className = 'trade-meta-row';
    const badges = document.createElement('div');
    badges.className = 'trade-meta trade-badges';
    const badgeItems = [{
      label: `Units ${formatShares(trade.sizeUnits)}`,
      className: ''
    }, {
      label: `Risk ${Number.isFinite(trade.riskPct) ? trade.riskPct.toFixed(2) : '—'}%`,
      className: ''
    }, {
      label: formatRiskMultiple(riskMultiple),
      className: ''
    }];
    badgeItems.forEach(item => {
      const badge = document.createElement('span');
      badge.className = `trade-badge ${item.className}`.trim();
      badge.textContent = item.label;
      badges.appendChild(badge);
    });
    const noteToggle = document.createElement('button');
    noteToggle.className = 'ghost trade-note-toggle';
    noteToggle.type = 'button';
    noteToggle.setAttribute('aria-label', 'Toggle trade notes');
    noteToggle.setAttribute('aria-expanded', 'false');
    noteToggle.textContent = '📝';
    metaRow.append(badges, noteToggle);
    pill.appendChild(metaRow);

    const notePanel = document.createElement('div');
    notePanel.className = 'trade-note-panel is-collapsed';
    const noteInput = document.createElement('textarea');
    noteInput.className = 'trade-note-input';
    noteInput.rows = 3;
    noteInput.placeholder = 'Add a note about this trade...';
    const noteValue = draft?.note ?? trade.note ?? '';
    noteInput.value = noteValue;
    if (noteValue.trim()) {
      noteToggle.classList.add('has-note');
      noteToggle.setAttribute('aria-label', 'Trade notes available');
    }
    if (draft?.height) {
      noteInput.style.height = draft.height;
    }
    const noteStatus = document.createElement('div');
    noteStatus.className = 'trade-note-status';
    noteStatus.setAttribute('aria-live', 'polite');
    notePanel.append(noteInput, noteStatus);
    if (draft?.isOpen || draft?.isFocused) {
      notePanel.classList.remove('is-collapsed');
      noteToggle.setAttribute('aria-expanded', 'true');
    }
    if (draft?.isFocused) {
      noteInput.focus();
      if (draft.selection) {
        noteInput.setSelectionRange(draft.selection.start, draft.selection.end);
      }
      noteInput.scrollTop = draft.scrollTop || 0;
    }
    noteToggle.addEventListener('click', () => {
      const isCollapsed = notePanel.classList.toggle('is-collapsed');
      noteToggle.setAttribute('aria-expanded', String(!isCollapsed));
      if (!isCollapsed) {
        noteInput.focus();
      }
    });
    const refreshNoteIndicator = () => {
      if (noteInput.value.trim()) {
        noteToggle.classList.add('has-note');
        noteToggle.setAttribute('aria-label', 'Trade notes available');
      } else {
        noteToggle.classList.remove('has-note');
        noteToggle.setAttribute('aria-label', 'Toggle trade notes');
      }
    };
    const saveNote = async () => {
      if (!trade.id) return;
      const nextNote = noteInput.value.trim();
      refreshNoteIndicator();
      if (nextNote === (trade.note || '')) return;
      noteStatus.textContent = 'Saving...';
      try {
        await api(`/api/trades/${trade.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: nextNote })
        });
        trade.note = nextNote;
        noteInput.value = nextNote;
        noteStatus.textContent = 'Saved.';
        refreshNoteIndicator();
      } catch (e) {
        noteStatus.textContent = e?.message || 'Failed to save note.';
      }
    };
    let noteSaveTimer;
    noteInput.addEventListener('input', () => {
      noteStatus.textContent = 'Drafting...';
      refreshNoteIndicator();
      window.clearTimeout(noteSaveTimer);
      noteSaveTimer = window.setTimeout(saveNote, 600);
    });
    noteInput.addEventListener('blur', saveNote);
    pill.appendChild(notePanel);

    const editToggle = document.createElement('button');
    editToggle.className = 'primary outline';
    editToggle.textContent = 'Edit trade';
    editToggle.addEventListener('click', () => {
      openEditTradeModal(trade);
    });
    const actionRow = document.createElement('div');
    actionRow.className = 'close-row trade-action-row trade-actions';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'danger outline';
    closeBtn.textContent = 'Close trade';
    closeBtn.addEventListener('click', () => {
      openCloseTradeModal(trade);
    });
    const shareBtn = document.createElement('button');
    shareBtn.className = 'ghost trade-share-btn';
    shareBtn.textContent = 'Share card';
    shareBtn.addEventListener('click', () => {
      openShareCardModal(trade);
    });
    actionRow.append(editToggle, closeBtn, shareBtn);
    pill.appendChild(actionRow);
    list.appendChild(pill);
  });
  updateActiveTradesOverflow();
}

function updateActiveTradeDisplay(trades) {
  const list = $('#active-trade-list');
  if (!list) return;
  const tradeMap = new Map(trades.filter(trade => trade?.id).map(trade => [trade.id, trade]));
  list.querySelectorAll('.trade-pill[data-trade-id]').forEach(pill => {
    const tradeId = pill.dataset.tradeId;
    if (!tradeId) return;
    const trade = tradeMap.get(tradeId);
    if (!trade) return;
    const pnl = Number.isFinite(trade.unrealizedGBP) ? trade.unrealizedGBP : 0;
    const pnlCard = pill.querySelector('[data-role="trade-pnl-card"]');
    const pnlValue = pill.querySelector('[data-role="trade-pnl"]');
    if (pnlValue) pnlValue.textContent = state.safeScreenshot ? SAFE_SCREENSHOT_LABEL : formatSignedCurrency(pnl);
    if (pnlCard && !state.safeScreenshot) {
      pnlCard.classList.toggle('positive', pnl > 0);
      pnlCard.classList.toggle('negative', pnl < 0);
    } else if (pnlCard) {
      pnlCard.classList.remove('positive', 'negative');
    }
    const guaranteed = Number.isFinite(trade.guaranteedPnlGBP) ? trade.guaranteedPnlGBP : null;
    const guaranteedCard = pill.querySelector('[data-role="trade-guaranteed-card"]');
    const guaranteedValue = pill.querySelector('[data-role="trade-guaranteed"]');
    const livePrice = Number.isFinite(trade.livePrice) ? trade.livePrice : null;
    const currentStopValue = Number(trade.currentStop);
    const currentStop = Number.isFinite(currentStopValue) ? currentStopValue : null;
    const isMissingStop = (trade.source === 'trading212' || trade.source === 'ibkr') && trade.currentStopStale === true;
    const alertBanner = pill.querySelector('.trade-alert-banner');
    if (isMissingStop) {
      pill.classList.add('trade-pill-alert');
      if (!alertBanner) {
        const headerRow = pill.querySelector('.trade-header');
        const newBanner = document.createElement('div');
        newBanner.className = 'trade-alert-banner';
        newBanner.textContent = 'No active stop order found!';
        if (headerRow) {
          pill.insertBefore(newBanner, headerRow);
        } else {
          pill.prepend(newBanner);
        }
      }
    } else {
      pill.classList.remove('trade-pill-alert');
      if (alertBanner) alertBanner.remove();
    }
    if (guaranteedValue && guaranteed !== null && !isMissingStop) {
      guaranteedValue.textContent = state.safeScreenshot ? SAFE_SCREENSHOT_LABEL : formatSignedCurrency(guaranteed);
    }
    if (guaranteedCard) {
      guaranteedCard.classList.toggle('positive', guaranteed !== null && guaranteed > 0 && !isMissingStop);
      guaranteedCard.classList.toggle('negative', guaranteed !== null && guaranteed < 0 && !isMissingStop);
      guaranteedCard.classList.toggle('is-hidden', guaranteed === null || isMissingStop || state.safeScreenshot);
    } else if (guaranteed !== null && !isMissingStop) {
      const pnlStack = pill.querySelector('.trade-pnl-stack');
      const pnlCardEl = pill.querySelector('[data-role="trade-pnl-card"]');
      if (pnlStack && pnlCardEl) {
        const newCard = document.createElement('div');
        newCard.className = `trade-pnl-card trade-pnl-guaranteed-card ${guaranteed > 0 ? 'positive' : guaranteed < 0 ? 'negative' : ''}`;
        newCard.dataset.role = 'trade-guaranteed-card';
        const label = document.createElement('span');
        label.className = 'trade-pnl-label';
        label.textContent = 'Guaranteed';
        const value = document.createElement('strong');
        value.className = 'trade-pnl-value';
        value.dataset.role = 'trade-guaranteed';
        value.textContent = state.safeScreenshot ? SAFE_SCREENSHOT_LABEL : formatSignedCurrency(guaranteed);
        newCard.append(label, value);
        pnlStack.insertBefore(newCard, pnlCardEl.nextSibling);
      }
    }
    const pnlStack = pill.querySelector('.trade-pnl-stack');
    if (pnlStack) pnlStack.classList.toggle('is-hidden', state.safeScreenshot);
    const detailsToggle = pill.querySelector('.trade-details-toggle');
    const detailsWrap = pill.querySelector('.trade-details-collapsible');
    if (detailsToggle) detailsToggle.classList.toggle('is-hidden', state.safeScreenshot);
    if (detailsWrap) detailsWrap.classList.toggle('is-hidden', state.safeScreenshot);
    const livePriceEl = pill.querySelector('[data-role="detail-live-price"]');
    if (livePriceEl) livePriceEl.textContent = formatPrice(livePrice, trade.currency, 2);
    const currentStopEl = pill.querySelector('[data-role="detail-current-stop"]');
    if (currentStop !== null) {
      if (currentStopEl) {
        currentStopEl.textContent = formatPrice(currentStop, trade.currency, 2);
      } else {
        const detailList = pill.querySelector('.trade-details');
        const livePriceElNode = pill.querySelector('[data-role="detail-live-price"]');
        if (detailList && livePriceElNode) {
          const livePriceDt = livePriceElNode.previousElementSibling;
          const dt = document.createElement('dt');
          dt.textContent = 'Current Stop:';
          const dd = document.createElement('dd');
          dd.dataset.role = 'detail-current-stop';
          dd.textContent = formatPrice(currentStop, trade.currency, 2);
          if (livePriceDt && livePriceDt.parentElement === detailList) {
            detailList.insertBefore(dt, livePriceDt);
            detailList.insertBefore(dd, livePriceDt);
          } else {
            detailList.append(dt, dd);
          }
        }
      }
    } else if (currentStopEl) {
      const currentStopDt = currentStopEl.previousElementSibling;
      if (currentStopDt && currentStopDt.tagName === 'DT') {
        currentStopDt.remove();
      }
      currentStopEl.remove();
    }
  });
}

function renderPortfolioTrend() {
  const el = $('#portfolio-trend');
  if (!el) return;
  el.innerHTML = '';
  const entries = getAllEntries();
  const last = entries.slice(-12);
  if (!last.length) {
    el.innerHTML = '<p class="tool-note">No portfolio data yet.</p>';
    return;
  }
  const values = last.map(entry => entry.closing ?? entry.opening ?? 0);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(max - min, 1);
  const width = 100;
  const height = 48;
  const padding = 6;
  const plotHeight = height - padding * 2;
  const pointCount = values.length;
  const points = values.map((val, index) => {
    const x = pointCount === 1 ? width / 2 : (index / (pointCount - 1)) * width;
    const normalized = (val - min) / range;
    const y = height - padding - normalized * plotHeight;
    return { x, y, value: val, date: last[index].date };
  });
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(height));
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const lineGradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  const gradientId = `trendGrad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  lineGradient.setAttribute('id', gradientId);
  lineGradient.setAttribute('x1', '0%');
  lineGradient.setAttribute('y1', '0%');
  lineGradient.setAttribute('x2', '100%');
  lineGradient.setAttribute('y2', '0%');

  const startStop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  startStop.setAttribute('offset', '0%');
  startStop.setAttribute('stop-color', 'var(--emerald)');

  const holdStop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  holdStop.setAttribute('offset', '74%');
  holdStop.setAttribute('stop-color', 'var(--emerald)');

  const transitionStartStop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  transitionStartStop.setAttribute('offset', '75%');
  transitionStartStop.setAttribute('stop-color', 'var(--emerald)');

  const endStop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  endStop.setAttribute('offset', '100%');
  endStop.setAttribute('stop-color', 'var(--amber)');

  lineGradient.append(startStop, holdStop, transitionStartStop, endStop);
  defs.appendChild(lineGradient);

  const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  area.setAttribute('d', areaPath);
  area.setAttribute('class', 'line-area');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', linePath);
  line.setAttribute('class', 'line-path');
  line.style.stroke = `url(#${gradientId})`;
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const lastPoint = points[points.length - 1];
  dot.setAttribute('cx', lastPoint.x);
  dot.setAttribute('cy', lastPoint.y);
  dot.setAttribute('r', '2.5');
  dot.setAttribute('class', 'line-dot line-dot-latest');
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = `${lastPoint.date.toLocaleDateString()} • ${state.safeScreenshot ? SAFE_SCREENSHOT_LABEL : formatCurrency(lastPoint.value)}`;
  svg.append(title, defs, area, line, dot);
  el.appendChild(svg);
}

function syncActiveTradesHeight() {
  const riskCard = $('#risk-card');
  const activeCard = $('#active-trades-card');
  if (!riskCard || !activeCard) return;
  activeCard.style.height = `${riskCard.offsetHeight}px`;
  updateActiveTradesOverflow();
}

function updateActiveTradesOverflow() {
  const list = $('#active-trade-list');
  const showAll = $('#active-trade-show-all');
  const empty = $('#active-trade-empty');
  if (!list || !showAll) return;
  const hasTrades = list.children.length > 0;
  if (!hasTrades || (empty && !empty.classList.contains('is-hidden'))) {
    showAll.classList.add('is-hidden');
    return;
  }
  const overflowing = list.scrollHeight > list.clientHeight + 1;
  showAll.classList.toggle('is-hidden', !overflowing);
}

function openCloseTradeModal(trade) {
  const modal = $('#close-trade-modal');
  if (!modal) return;
  const title = $('#close-trade-title');
  const priceInput = $('#close-trade-price');
  const dateInput = $('#close-trade-date');
  const preview = $('#close-trade-preview');
  const status = $('#close-trade-status');
  const closeLabel = $('#close-trade-close-label');
  if (title) {
    const sym = getTradeDisplaySymbol(trade);
    title.textContent = `Close ${sym}`;
  }
  if (closeLabel) {
    closeLabel.textContent = `Close Fill (${trade.currency || 'GBP'})`;
  }
  if (priceInput) {
    priceInput.value = Number.isFinite(trade.livePrice) ? trade.livePrice : '';
  }
  if (dateInput) {
    dateInput.valueAsDate = new Date();
  }
  if (preview) preview.textContent = 'PnL if closed: —';
  if (status) status.textContent = '';
  modal.dataset.tradeId = trade.id;
  modal.dataset.direction = trade.direction || 'long';
  modal.dataset.currency = trade.currency || 'GBP';
  modal.dataset.entry = Number.isFinite(trade.entry) ? trade.entry : '';
  modal.dataset.units = Number.isFinite(trade.sizeUnits) ? trade.sizeUnits : '';
  modal.dataset.fees = Number.isFinite(trade.fees) ? trade.fees : '';
  modal.dataset.slippage = Number.isFinite(trade.slippage) ? trade.slippage : '';
  modal.dataset.fxFeeEligible = trade.fxFeeEligible ? 'true' : 'false';
  modal.dataset.fxFeeRate = Number.isFinite(trade.fxFeeRate) ? trade.fxFeeRate : '';
  modal.classList.remove('hidden');
}

function buildTradeSummary(trade) {
  const entryVal = Number(trade.entry);
  const stopVal = Number(trade.stop);
  const sizeUnitsVal = Number(trade.sizeUnits);
  const derivedPerUnitRisk = Number.isFinite(entryVal) && Number.isFinite(stopVal)
    ? Math.abs(entryVal - stopVal)
    : null;
  const derivedRiskCurrency = Number.isFinite(derivedPerUnitRisk) && Number.isFinite(sizeUnitsVal)
    ? derivedPerUnitRisk * sizeUnitsVal
    : null;
  const pnl = Number.isFinite(trade.realizedPnlGBP)
    ? trade.realizedPnlGBP
    : (Number.isFinite(trade.unrealizedGBP) ? trade.unrealizedGBP : null);
  const riskGBP = getTradeRiskAmountGBP(trade)
    ?? (Number.isFinite(derivedRiskCurrency)
      ? toGBP(derivedRiskCurrency, trade.currency || 'GBP')
      : null);
  const positionBase = Number.isFinite(trade.positionGBP)
    ? trade.positionGBP
    : (Number.isFinite(trade.entry) && Number.isFinite(trade.sizeUnits) && (trade.currency || 'GBP') === 'GBP'
      ? trade.entry * trade.sizeUnits
      : null);
  const roiPct = pnl !== null && Number.isFinite(positionBase) && positionBase !== 0
    ? (pnl / positionBase) * 100
    : undefined;
  const rMultiple = getTradeRiskMultiple(trade, pnl);
  return {
    ticker: getTradeDisplaySymbol(trade) || '—',
    direction: trade.direction === 'short' ? 'SHORT' : 'LONG',
    roiPct,
    rMultiple,
    entryPrice: trade.entry,
    stopPrice: trade.stop,
    entryDate: trade.openDate || trade.createdAt || trade.date,
    closeDate: trade.closeDate ?? null,
    username: state.profile?.nickname || state.profile?.displayName || state.profile?.username,
    sharedAt: new Date()
  };
}

function resetShareCardState() {
  if (shareCardState.url) {
    URL.revokeObjectURL(shareCardState.url);
  }
  shareCardState.url = null;
  shareCardState.blob = null;
  shareCardState.trade = null;
  shareCardState.orientation = 'landscape';
  const preview = $('#share-card-preview-img');
  if (preview) preview.removeAttribute('src');
}

function getShareCardOrientation() {
  const selector = $('#share-card-layout');
  return selector?.value === 'portrait' ? 'portrait' : 'landscape';
}

async function renderShareCardPreview(trade) {
  const status = $('#share-card-status');
  const preview = $('#share-card-preview-img');
  const download = $('#share-card-download');
  const shareBtn = $('#share-card-share');
  if (status) status.textContent = 'Generating card...';
  try {
    const renderer = window.tradeCardRenderer?.renderTradeCard;
    if (!renderer) throw new Error('Trade card renderer unavailable.');
    const summary = buildTradeSummary(trade);
    const orientation = getShareCardOrientation();
    const payload = { ...summary, orientation };
    const blob = await renderer(payload);
    if (!blob || blob.size === 0) throw new Error('Unable to generate trade card.');
    shareCardState.blob = blob;
    shareCardState.url = URL.createObjectURL(blob);
    shareCardState.orientation = orientation;
    if (preview) preview.src = shareCardState.url;
    if (download) {
      const safeTicker = summary.ticker ? summary.ticker.replace(/\W+/g, '-').toLowerCase() : 'trade';
      const suffix = orientation === 'portrait' ? '-portrait' : '-landscape';
      download.href = shareCardState.url;
      download.download = `${safeTicker}-summary${suffix}.png`;
    }
    if (status) status.textContent = '';
    if (shareBtn) {
      const shareFile = new File([blob], 'trade-summary.png', { type: 'image/png' });
      const canShare = !!navigator.share && (!navigator.canShare || navigator.canShare({ files: [shareFile] }));
      shareBtn.classList.toggle('is-hidden', !canShare);
    }
  } catch (e) {
    if (status) status.textContent = e?.message || 'Failed to generate card.';
  }
}

function closeShareCardModal() {
  resetShareCardState();
  const status = $('#share-card-status');
  if (status) status.textContent = '';
  $('#share-card-modal')?.classList.add('hidden');
}

async function openShareCardModal(trade) {
  const modal = $('#share-card-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  resetShareCardState();
  shareCardState.trade = trade;
  await renderShareCardPreview(trade);
}

function openEditTradeModal(trade) {
  const modal = $('#edit-trade-modal');
  if (!modal) return;
  const title = $('#edit-trade-title');
  const symbolInput = $('#edit-trade-symbol');
  const entryInput = $('#edit-trade-entry');
  const stopInput = $('#edit-trade-stop');
  const currentStopInput = $('#edit-trade-current-stop');
  const currentStopSync = $('#edit-current-stop-sync');
  const currentStopWarning = $('#edit-current-stop-warning');
  const currentStopOverride = $('#edit-current-stop-override');
  const unitsInput = $('#edit-trade-units');
  const status = $('#edit-trade-status');
  const mappingBadge = $('#edit-mapping-badge');
  const promoteBtn = $('#edit-promote-mapping-btn');
  if (title) {
    const sym = getTradeDisplaySymbol(trade);
    title.textContent = `Edit ${sym}`;
  }
  if (symbolInput) symbolInput.value = getTradeDisplaySymbol(trade);
  if (entryInput) entryInput.value = Number.isFinite(trade.entry) ? trade.entry : '';
  if (stopInput) stopInput.value = Number.isFinite(trade.stop) ? trade.stop : '';
  if (currentStopInput) {
    currentStopInput.value = Number.isFinite(trade.currentStop) ? trade.currentStop : '';
    currentStopInput.readOnly = false;
  }
  if (unitsInput) unitsInput.value = Number.isFinite(trade.sizeUnits) ? trade.sizeUnits : '';
  if (status) status.textContent = '';
  if (currentStopSync) currentStopSync.textContent = '';
  if (currentStopWarning) {
    currentStopWarning.textContent = '';
    currentStopWarning.classList.add('is-hidden');
  }
  if (currentStopOverride) {
    currentStopOverride.classList.add('is-hidden');
  }
  if (mappingBadge) {
    mappingBadge.classList.toggle('is-hidden', !shouldShowMappingBadge(trade));
  }
  if (promoteBtn) {
    const canPromote = state.isAdmin && trade.mappingScope === 'user' && trade.mappingId;
    promoteBtn.classList.toggle('is-hidden', !canPromote);
    if (canPromote) {
      promoteBtn.dataset.mappingId = trade.mappingId;
    } else {
      promoteBtn.dataset.mappingId = '';
    }
  }
  const isTrading212 = trade.source === 'trading212' || trade.trading212Id;
  const isIbkr = trade.source === 'ibkr' || trade.ibkrPositionId;
  modal.dataset.tradeId = trade.id;
  modal.dataset.direction = trade.direction || 'long';
  modal.dataset.isTrading212 = isTrading212 ? 'true' : 'false';
  modal.dataset.isIbkr = isIbkr ? 'true' : 'false';
  modal.dataset.currentStopSource = trade.currentStopSource || 'manual';
  modal.dataset.currentStopOverride = 'false';
  modal.dataset.brokerTicker = trade.brokerTicker || trade.trading212Ticker || trade.ibkrTicker || trade.symbol || '';
  modal.dataset.brokerName = trade.trading212Name || '';
  modal.dataset.currency = trade.currency || '';
  modal.dataset.isin = trade.trading212Isin || '';
  modal.dataset.uid = trade.trading212Id || '';
  modal.dataset.sourceKey = trade.sourceKey || '';
  modal.classList.remove('hidden');

  const updateCurrentStopUi = (payload = {}) => {
    if (!currentStopInput) return;
    const source = payload.source || modal.dataset.currentStopSource || 'manual';
    const lastSyncedAt = payload.lastSyncedAt || null;
    const stale = payload.stale === true;
    const hasOverride = modal.dataset.currentStopOverride === 'true';
    const formattedTime = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : '';
    if (payload.currentStopPrice !== undefined && Number.isFinite(payload.currentStopPrice)) {
      currentStopInput.value = payload.currentStopPrice;
    }
    const isProviderSource = source === 't212' || source === 'ibkr';
    currentStopInput.readOnly = isProviderSource && !hasOverride;
    if (currentStopSync) {
      if (source === 't212' || source === 'ibkr') {
        currentStopSync.textContent = stale
          ? `No active stop order found • last checked ${formattedTime || 'just now'}`
          : `Synced from ${source === 't212' ? 'Trading 212' : 'IBKR'} • ${formattedTime || 'just now'}`;
      } else if (source === 'manual' && hasOverride) {
        currentStopSync.textContent = 'Manual override enabled';
      } else {
        currentStopSync.textContent = '';
      }
    }
    if (currentStopOverride) {
      currentStopOverride.classList.toggle('is-hidden', !(source === 't212' || source === 'ibkr'));
    }
  };

  updateCurrentStopUi({
    currentStopPrice: Number.isFinite(trade.currentStop) ? trade.currentStop : undefined,
    source: trade.currentStopSource,
    lastSyncedAt: trade.currentStopLastSyncedAt,
    stale: trade.currentStopStale
  });

  if (currentStopOverride) {
    currentStopOverride.onclick = () => {
      modal.dataset.currentStopOverride = 'true';
      modal.dataset.currentStopSource = 'manual';
      if (currentStopInput) {
        currentStopInput.readOnly = false;
        currentStopInput.focus();
      }
      updateCurrentStopUi({ source: 'manual' });
    };
  }

  if ((isTrading212 || isIbkr) && currentStopSync) {
    currentStopSync.textContent = `Syncing ${isTrading212 ? 'Trading 212' : 'IBKR'} stop...`;
  }
  if (isTrading212 || isIbkr) {
    api(`/api/trades/${trade.id}/stop-sync`)
      .then((payload) => {
        if (payload?.warning) {
          if (currentStopWarning) {
            currentStopWarning.textContent = payload.warning;
            currentStopWarning.classList.remove('is-hidden');
          }
        }
        if (payload?.source) {
          modal.dataset.currentStopSource = payload.source;
        }
        updateCurrentStopUi({
          currentStopPrice: payload?.currentStopPrice,
          source: payload?.source,
          lastSyncedAt: payload?.lastSyncedAt,
          stale: payload?.stale
        });
      })
      .catch((err) => {
        if (currentStopWarning) {
          currentStopWarning.textContent = err?.message || 'Could not sync broker stop.';
          currentStopWarning.classList.remove('is-hidden');
        }
        updateCurrentStopUi();
      });
  }
}

function setMetricTrend(el, value) {
  if (!el) return;
  window.ThemeUtils?.applyPnlColorClass(el, value);
}

function renderMetrics() {
  const metrics = state.metrics || {};
  const latestGBP = Number.isFinite(metrics.latestGBP) ? metrics.latestGBP : state.portfolioGBP;
  const liveGBP = Number.isFinite(state.livePortfolioGBP) ? state.livePortfolioGBP : latestGBP;
  const netDepositsGBP = Number.isFinite(metrics.netDepositsGBP) ? metrics.netDepositsGBP : 0;
  const netPerformanceGBP = Number.isFinite(metrics.netPerformanceGBP) ? metrics.netPerformanceGBP : 0;
  const netPerformancePct = Number.isFinite(metrics.netPerformancePct) ? metrics.netPerformancePct : null;
  const altCurrency = state.currency === 'GBP'
    ? (state.rates.USD ? 'USD' : (state.rates.EUR ? 'EUR' : null))
    : 'GBP';

  const portfolioValueEl = $('#metric-portfolio-value');
  if (portfolioValueEl) {
    portfolioValueEl.textContent = state.safeScreenshot ? SAFE_SCREENSHOT_LABEL : formatCurrency(liveGBP);
  }
  const portfolioSubEl = $('#metric-portfolio-sub');
  if (portfolioSubEl) {
    if (state.safeScreenshot) {
      portfolioSubEl.textContent = '';
    } else {
      const pieces = [];
      if (altCurrency) {
        const altValue = formatCurrency(liveGBP, altCurrency);
        if (altValue !== '—') pieces.push(`≈ ${altValue}`);
      }
      const openPnl = Number.isFinite(state.liveOpenPnlGBP) ? state.liveOpenPnlGBP : 0;
      if (openPnl !== 0) pieces.push(`Live PnL: ${formatLiveOpenPnl(openPnl)}`);
      portfolioSubEl.textContent = pieces.join(' • ');
    }
  }

  const netDepositsEl = $('#hero-net-deposits-value');
  if (netDepositsEl) {
    netDepositsEl.textContent = state.safeScreenshot ? SAFE_SCREENSHOT_LABEL : formatSignedCurrency(netDepositsGBP);
  }
  const netDepositsSub = $('#hero-net-deposits-sub');
  if (netDepositsSub) {
    if (state.safeScreenshot) {
      netDepositsSub.textContent = '';
    } else if (altCurrency) {
      const altDeposits = formatSignedCurrency(netDepositsGBP, altCurrency);
      netDepositsSub.textContent = altDeposits === '—' ? '' : `≈ ${altDeposits}`;
    } else {
      netDepositsSub.textContent = '';
    }
  }
  const netCard = $('#hero-net-deposits');
  if (netCard) {
    netCard.classList.remove('positive', 'negative');
  }

  const netPerfEl = $('#hero-net-performance-value');
  if (netPerfEl) {
    netPerfEl.textContent = state.safeScreenshot
      ? formatPercent(netPerformancePct)
      : formatSignedCurrency(netPerformanceGBP);
  }
  const netPerfSub = $('#hero-net-performance-sub');
  if (netPerfSub) {
    if (state.safeScreenshot) {
      netPerfSub.textContent = '';
    } else {
      const pieces = [];
      if (altCurrency) {
        const altPerf = formatSignedCurrency(netPerformanceGBP, altCurrency);
        if (altPerf !== '—') pieces.push(`≈ ${altPerf}`);
      }
      if (netPerformancePct !== null && netPerformancePct !== undefined) {
        pieces.push(formatPercent(netPerformancePct));
      }
      netPerfSub.textContent = pieces.join(' • ');
    }
  }
  setMetricTrend($('#hero-net-performance'), netPerformanceGBP);

  const portfolioCard = $('#hero-portfolio');
  if (portfolioCard) {
    const deltaFromDeposits = Number.isFinite(netDepositsGBP)
      ? latestGBP - netDepositsGBP
      : 0;
    setMetricTrend(portfolioCard, deltaFromDeposits);
  }
}

function setActiveView() {
  $$('#view-controls button[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === state.view);
    btn.setAttribute('aria-pressed', btn.dataset.view === state.view ? 'true' : 'false');
  });
}

function updateCurrencySelect() {
  const sel = $('#currency-select');
  if (!sel) return;
  const usdOption = sel.querySelector('option[value="USD"]');
  const eurOption = sel.querySelector('option[value="EUR"]');
  const hasUSD = !!state.rates.USD;
  const hasEUR = !!state.rates.EUR;
  if (usdOption) {
    usdOption.disabled = !hasUSD;
  }
  if (eurOption) {
    eurOption.disabled = !hasEUR;
  }
  if (!hasUSD && state.currency === 'USD') {
    state.currency = 'GBP';
  }
  if (!hasEUR && state.currency === 'EUR') {
    state.currency = 'GBP';
  }
  sel.value = state.currency;
}

function updatePortfolioPill() {
  const el = $('#portfolio-display');
  const heroVal = $('#header-portfolio-value');
  const heroSub = $('#header-portfolio-sub');
  const latestGBP = Number.isFinite(state.livePortfolioGBP)
    ? state.livePortfolioGBP
    : (Number.isFinite(state.metrics?.latestGBP)
      ? state.metrics.latestGBP
      : state.portfolioGBP);
  const base = formatCurrency(latestGBP);
  const alt = state.currency === 'USD'
    ? formatCurrency(latestGBP, 'GBP')
    : state.currency === 'EUR'
      ? formatCurrency(latestGBP, 'GBP')
      : (state.rates.USD ? formatCurrency(latestGBP, 'USD') : null);
  if (el) {
    if (state.safeScreenshot) {
      el.textContent = `Portfolio: ${SAFE_SCREENSHOT_LABEL}`;
    } else if (state.currency === 'USD') {
      el.innerHTML = `Portfolio: ${base} <span>≈ ${alt}</span>`;
    } else if (state.rates.USD) {
      el.innerHTML = `Portfolio: ${base} <span>≈ ${alt}</span>`;
    } else {
      el.textContent = `Portfolio: ${base}`;
    }
  }
  if (heroVal) {
    heroVal.textContent = state.safeScreenshot ? SAFE_SCREENSHOT_LABEL : base;
  }
  if (heroSub) {
    heroSub.textContent = state.safeScreenshot ? '' : (alt ? `≈ ${alt}` : '');
  }
}

function updatePeriodSelect() {
  const sel = $('#period-select');
  if (!sel) return;
  const isYearPicker = state.view === 'month' || state.view === 'year';
  const desired = isYearPicker
    ? String(state.selected.getFullYear())
    : startOfMonth(state.selected).toISOString();

  let needsRebuild = sel.dataset.view !== state.view;
  if (!needsRebuild) {
    const exists = Array.from(sel.options).some(opt => opt.value === desired);
    if (!exists) needsRebuild = true;
  }

  if (needsRebuild) {
    sel.dataset.view = state.view;
    sel.innerHTML = '';
    if (isYearPicker) {
      const now = new Date();
      for (let i = 0; i < 10; i++) {
        const year = now.getFullYear() - i;
        const opt = document.createElement('option');
        opt.value = String(year);
        opt.textContent = String(year);
        sel.appendChild(opt);
      }
    } else {
      const now = new Date();
      for (let i = 0; i < 24; i++) {
        const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const opt = document.createElement('option');
        opt.value = dt.toISOString();
        opt.textContent = dt.toLocaleString('en-GB', { month: 'short', year: 'numeric' });
        sel.appendChild(opt);
      }
    }
  }

  const optionValues = Array.from(sel.options).map(o => o.value);
  if (optionValues.includes(desired)) {
    sel.value = desired;
  } else if (sel.options.length) {
    sel.selectedIndex = 0;
    const value = sel.value;
    if (isYearPicker) {
      state.selected = new Date(Number(value), 0, 1);
    } else {
      state.selected = startOfMonth(new Date(value));
    }
  }
}

function renderTitle() {
  const title = $('#title');
  if (!title) return;
  const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
  if (state.view === 'year') {
    title.textContent = 'All-time performance';
  } else if (state.view === 'month') {
    title.textContent = `${state.selected.getFullYear()} Performance`;
  } else if (state.view === 'week') {
    title.textContent = `${monthFormatter.format(state.selected)} Weekly View`;
  } else {
    title.textContent = monthFormatter.format(state.selected);
  }
}

function renderSummary() {
  const avgEl = $('#avg');
  if (!avgEl) return;
  const values = getValuesForSummary();
  let changeSum = 0;
  let changeCount = 0;
  let cashSum = 0;
  values.forEach(item => {
    if (item?.change !== null && item?.change !== undefined) {
      changeSum += item.change;
      changeCount++;
    }
    cashSum += item?.cashFlow ?? 0;
  });
  const periodLabel = state.view === 'month' ? 'year' : 'month';
  const cashClass = cashSum > 0 ? 'positive' : cashSum < 0 ? 'negative' : '';
  const cashValue = formatSignedCurrency(cashSum);
  const cashClassName = cashClass ? ` ${cashClass}` : '';
  const cashFlowHtml = state.safeScreenshot || state.view === 'year'
    ? ''
    : `Net deposits this ${periodLabel}: <span class="cashflow${cashClassName}">${cashValue}</span>`;
  if (!changeCount) {
    const cashRow = cashFlowHtml ? `<div class="summary-line">${cashFlowHtml}</div>` : '';
    avgEl.innerHTML = `<div class="summary-line"><strong>No performance data yet</strong></div>${cashRow}`;
    avgEl.classList.remove('positive', 'negative');
    return;
  }
  const avgGBP = changeSum / changeCount;
  const avgPct = computeAverageChangePercent(avgGBP, getLatestPortfolioGBP());
  const label = viewAvgLabels[state.view] || 'Average';
  const pctText = avgPct === null ? '' : ` (${formatPercent(avgPct)})`;
  const cashRow = cashFlowHtml ? `<div class="summary-line">${cashFlowHtml}</div>` : '';
  if (state.safeScreenshot) {
    const avgPctText = avgPct === null ? '—' : formatPercent(avgPct);
    avgEl.innerHTML = `<div class="summary-line"><strong>${label} avg change: ${avgPctText}</strong></div>`;
    avgEl.classList.toggle('positive', avgPct > 0);
    avgEl.classList.toggle('negative', avgPct < 0);
  } else {
    avgEl.innerHTML = `<div class="summary-line"><strong>${label} avg change: ${formatSignedCurrency(avgGBP)}${pctText}</strong></div>${cashRow}`;
    avgEl.classList.toggle('positive', avgGBP > 0);
    avgEl.classList.toggle('negative', avgGBP < 0);
  }
}

function renderDay() {
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = '';
  const days = getDaysInMonth(state.selected);
  days.forEach(date => {
    const key = formatDate(date);
    const entry = getDailyEntry(date);
    const closing = entry?.closing ?? null;
    const change = entry?.change ?? null;
    const pct = entry?.pct ?? null;
    const cashFlow = entry?.cashFlow ?? 0;
    const tradeCount = entry?.tradesCount ?? 0;
    const row = document.createElement('div');
    row.className = 'list-row';
    if (change > 0) row.classList.add('profit');
    if (change < 0) row.classList.add('loss');
    const changeText = state.safeScreenshot
      ? (pct === null ? 'Δ —' : `Δ ${formatPercent(pct)}`)
      : (change === null ? 'Δ —' : `Δ ${formatSignedCurrency(change)}`);
    const cashHtml = state.safeScreenshot || cashFlow === 0
      ? ''
      : `<span class="cashflow">Cash flow: ${formatSignedCurrency(cashFlow)}</span>`;
    const tradesHtml = tradeCount
      ? `<span class="cashflow">Trades: ${tradeCount}</span>`
      : '';
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
        <div class="row-sub">${key}</div>
      </div>
      <div class="row-value">
        <strong>${state.safeScreenshot ? SAFE_SCREENSHOT_LABEL : (closing === null ? '—' : formatCurrency(closing))}</strong>
        <span>${changeText}</span>
        ${cashHtml}
        ${tradesHtml}
      </div>
    `;
    if (entry?.note) {
      const main = row.querySelector('.row-main');
      if (main) {
        const noteEl = document.createElement('div');
        noteEl.className = 'note';
        noteEl.textContent = entry.note;
        noteEl.insertAdjacentText('afterbegin', '📝 ');
        main.appendChild(noteEl);
      }
    }
    row.addEventListener('click', () => openEntryModal(key, entry));
    grid.appendChild(row);
  });
}

function renderWeek() {
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = '';
  const weeks = getWeeksInMonth(state.selected);
  weeks.forEach(week => {
    const row = document.createElement('div');
    row.className = 'list-row week-row';
    if (week.totalChange > 0) row.classList.add('profit');
    if (week.totalChange < 0) row.classList.add('loss');
    const hasEntries = week.recordedDays > 0;
    const hasChange = week.hasChange;
    const changeText = state.safeScreenshot
      ? (hasChange ? `Δ ${formatPercent(week.pct)}` : 'Δ —')
      : (hasChange ? `Δ ${formatSignedCurrency(week.totalChange)}` : 'Δ —');
    const pctText = state.safeScreenshot ? '—' : (hasChange ? formatPercent(week.pct) : '—');
    const cashFlow = week.totalCashFlow ?? 0;
    const cashHtml = state.safeScreenshot || cashFlow === 0
      ? ''
      : `<span class="cashflow">Cash flow: ${formatSignedCurrency(cashFlow)}</span>`;
    const tradesHtml = week.totalTrades
      ? `<span class="cashflow">Trades: ${week.totalTrades}</span>`
      : '';
    const rangeLabel = week.displayStart === week.displayEnd
      ? week.displayStart
      : `${week.displayStart} – ${week.displayEnd}`;
    const subLabel = hasEntries
      ? `${week.recordedDays} recorded day${week.recordedDays === 1 ? '' : 's'}`
      : 'No entries recorded';
    const toggle = document.createElement('button');
    toggle.className = 'collapse-btn';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = '▸';
    const main = document.createElement('div');
    main.className = 'row-main';
    main.innerHTML = `
      <div class="row-title">${rangeLabel}</div>
      <div class="row-sub">${subLabel}</div>
    `;
    const value = document.createElement('div');
    value.className = 'row-value';
    value.innerHTML = `
      <strong>${changeText}</strong>
      <span>${pctText}</span>
      ${cashHtml}
      ${tradesHtml}
    `;
    row.append(toggle, main, value);

    const detail = document.createElement('div');
    detail.className = 'week-detail hidden';
    const summary = summarizeWeek(week.entries || []);
    const tradeList = (week.trades || []).map(t => `${getTradeDisplaySymbol(t)} ${t.tradeType || ''} ${t.status || ''}`.trim());
    const detailMetricsHtml = state.safeScreenshot
      ? `<div class="week-detail-grid">
        <div><strong>Trades:</strong><span>${summary.totalTrades || 0}</span></div>
      </div>`
      : `<div class="week-detail-grid">
        <div><strong>Cash flow:</strong><span>${formatSignedCurrency(summary.totalCashFlow || 0)}</span></div>
        <div><strong>Realized P&L:</strong><span>${formatSignedCurrency(summary.realized || 0)}</span></div>
        <div><strong>Trades:</strong><span>${summary.totalTrades || 0}</span></div>
      </div>`;
    detail.innerHTML = `
      ${detailMetricsHtml}
      ${tradeList.length
        ? `<div class="week-trades">${tradeList.map(t => `<span class="tag-chip">${t}</span>`).join('')}</div>`
        : `<p class="tool-note">No trades recorded this week.</p>`}
    `;
    row.appendChild(detail);

    toggle.addEventListener('click', () => {
      const nowHidden = detail.classList.toggle('hidden');
      toggle.setAttribute('aria-expanded', String(!nowHidden));
      toggle.textContent = nowHidden ? '▸' : '▾';
    });
    grid.appendChild(row);
  });
}

function renderMonthGrid(targetDate, grid) {
  if (!grid) return;
  grid.innerHTML = '';
  const headers = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  headers.forEach(day => {
    const h = document.createElement('div');
    h.className = 'dow';
    h.textContent = day;
    grid.appendChild(h);
  });

  const first = startOfMonth(targetDate);
  const startDay = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const firstEntryKey = state.firstEntryKey;

  for (let i = 0; i < startDay; i++) {
    const placeholder = document.createElement('div');
    placeholder.className = 'cell';
    placeholder.style.visibility = 'hidden';
    grid.appendChild(placeholder);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(first.getFullYear(), first.getMonth(), day);
    const key = formatDate(date);
    const entry = getDailyEntry(date);
    const closing = entry?.closing ?? null;
    const change = entry?.change ?? null;
    const pct = entry?.pct ?? null;
    const tradeCount = entry?.tradesCount ?? 0;
    const cell = document.createElement('div');
    cell.className = 'cell';
    const isFirstEntry = firstEntryKey && key === firstEntryKey;
    if (isFirstEntry) {
      cell.classList.add('first-entry');
      cell.title = 'First recorded portfolio day';
    } else {
      if (change > 0) cell.classList.add('profit');
      if (change < 0) cell.classList.add('loss');
    }
    const changeText = state.safeScreenshot
      ? ''
      : (change === null
        ? 'Δ —'
        : `Δ ${formatSignedCurrency(change)}${pct === null ? '' : ` (${formatPercent(pct)})`}`);
    const pctDisplay = pct === null ? '—' : formatPercent(pct);
    const tradeHtml = `<div class="trade-count">Trades: ${tradeCount}</div>`;
    cell.innerHTML = `
      <div class="date">${day}</div>
      <div class="val">${state.safeScreenshot ? pctDisplay : (closing === null ? '—' : formatCurrency(closing))}</div>
      <div class="pct">${changeText}</div>
      ${tradeHtml}
    `;
    cell.addEventListener('click', () => openEntryModal(key, entry));
    grid.appendChild(cell);
  }
}

function renderMonth() {
  const grid = $('#grid');
  if (!grid) return;
  renderYearGrid(state.selected, grid);
}

function renderYearGrid(targetDate, grid) {
  if (!grid) return;
  grid.innerHTML = '';
  const months = getYearMonths(targetDate);
  months.forEach(item => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (item.totalChange > 0) cell.classList.add('profit');
    if (item.totalChange < 0) cell.classList.add('loss');
    const hasData = item.recordedDays > 0;
    const hasChange = item.hasChange;
    const pctText = state.safeScreenshot ? '' : (hasChange ? formatPercent(item.pct) : '—');
    const cashFlow = item.totalCashFlow ?? 0;
    const cashHtml = state.safeScreenshot || cashFlow === 0
      ? ''
      : `<div class="cashflow">Cash flow: ${formatSignedCurrency(cashFlow)}</div>`;
    const metaText = hasData
      ? `${item.recordedDays} recorded day${item.recordedDays === 1 ? '' : 's'}`
      : 'No entries yet';
    const changeText = state.safeScreenshot
      ? (hasChange ? `Δ ${formatPercent(item.pct)}` : 'Δ —')
      : (hasChange ? `Δ ${formatSignedCurrency(item.totalChange)}` : 'Δ —');
    cell.innerHTML = `
      <div class="date">${item.monthDate.toLocaleDateString('en-GB', { month: 'short' })}</div>
      <div class="val">${changeText}</div>
      <div class="pct">${pctText}</div>
      ${cashHtml}
      <div class="meta">${metaText}</div>
    `;
    cell.addEventListener('click', () => {
      state.view = 'day';
      state.selected = startOfMonth(item.monthDate);
      updatePeriodSelect();
      render();
    });
    grid.appendChild(cell);
  });
}

function renderYear() {
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = '';
  const entries = getAllEntries();
  const firstYear = entries.length ? entries[0].date.getFullYear() : state.selected.getFullYear();
  const lastYear = entries.length ? entries[entries.length - 1].date.getFullYear() : state.selected.getFullYear();
  for (let year = firstYear; year <= lastYear; year++) {
    const yearDate = new Date(year, 0, 1);
    const months = getYearMonths(yearDate);
    const totalChange = months.reduce((sum, item) => sum + (item.hasChange ? item.totalChange : 0), 0);
    const totalCashFlow = months.reduce((sum, item) => sum + (item.totalCashFlow ?? 0), 0);
    const hasChange = months.some(item => item.hasChange);
    const pct = hasChange
      ? computeChangePercentFromLatestPortfolio(totalChange)
      : null;
    const row = document.createElement('div');
    row.className = 'list-row year-row';
    if (totalChange > 0) row.classList.add('profit');
    if (totalChange < 0) row.classList.add('loss');
    const changeText = state.safeScreenshot
      ? (hasChange && pct !== null ? `Δ ${formatPercent(pct)}` : 'Δ —')
      : (hasChange ? `Δ ${formatSignedCurrency(totalChange)}` : 'Δ —');
    const pctText = state.safeScreenshot ? '' : (hasChange && pct !== null ? formatPercent(pct) : '—');
    const cashHtml = state.safeScreenshot || totalCashFlow === 0
      ? ''
      : `<span class="cashflow">Cash flow: ${formatSignedCurrency(totalCashFlow)}</span>`;
    const recordedDays = months.reduce((sum, item) => sum + (item.recordedDays ?? 0), 0);
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${year}</div>
        <div class="row-sub">${recordedDays ? `${recordedDays} recorded day${recordedDays === 1 ? '' : 's'}` : 'No entries recorded'}</div>
      </div>
      <div class="row-value">
        <strong>${changeText}</strong>
        <span>${pctText}</span>
        ${cashHtml}
      </div>
    `;
    row.addEventListener('click', () => {
      state.view = 'month';
      state.selected = new Date(year, 0, 1);
      updatePeriodSelect();
      render();
    });
    grid.appendChild(row);
  }
}

function renderView() {
  const grid = $('#grid');
  if (!grid) return;
  if (state.view === 'day') {
    grid.className = 'grid view-month';
    return renderMonthGrid(state.selected, grid);
  }
  if (state.view === 'week') {
    grid.className = 'grid view-week';
    return renderWeek();
  }
  if (state.view === 'month') {
    grid.className = 'grid view-year';
    return renderMonth();
  }
  grid.className = 'grid view-year view-year-list';
  return renderYear();
}

function renderGuestBanner() {
  const banner = $('#guest-banner');
  if (!banner) return;
  banner.classList.toggle('hidden', !state.isGuest);
}

function render() {
  renderGuestBanner();
  document.body.classList.toggle('safe-screenshot', state.safeScreenshot);
  const safeAlert = $('#safe-screenshot-alert');
  if (safeAlert) safeAlert.classList.toggle('hidden', !state.safeScreenshot);
  updateCurrencySelect();
  updatePortfolioPill();
  setActiveView();
  updatePeriodSelect();
  renderTitle();
  renderMetrics();
  renderRiskCalculator();
  renderActiveTrades();
  renderPortfolioTrend();
  renderView();
  renderSummary();
  syncActiveTradesHeight();
}

async function loadRates() {
  try {
    const res = await api('/api/rates');
    const rates = res?.rates || {};
    state.rates = { GBP: 1, ...rates };
  } catch (e) {
    console.warn('Unable to load exchange rates', e);
    state.rates = {
      GBP: 1,
      ...(state.rates.USD ? { USD: state.rates.USD } : {}),
      ...(state.rates.EUR ? { EUR: state.rates.EUR } : {})
    };
  }
}

function persistLocalPrefs() {
  try {
    localStorage.setItem('plc-prefs', JSON.stringify({
      defaultRiskPct: state.defaultRiskPct,
      defaultRiskCurrency: state.defaultRiskCurrency,
      safeScreenshot: state.safeScreenshot
    }));
  } catch (e) {
    console.warn(e);
  }
}

async function loadUiPrefs() {
  if (isGuestSession()) return;
  let localPrefs = null;
  try {
    const saved = localStorage.getItem('plc-prefs');
    localPrefs = saved ? JSON.parse(saved) : null;
  } catch (e) {
    console.warn(e);
  }
  if (typeof localPrefs?.safeScreenshot === 'boolean') {
    state.safeScreenshot = localPrefs.safeScreenshot;
  }
  try {
    const prefs = await api('/api/prefs');
    const hasServerPrefs = Number.isFinite(prefs?.defaultRiskPct)
      || (prefs?.defaultRiskCurrency && ['GBP', 'USD', 'EUR'].includes(prefs.defaultRiskCurrency));
    if (hasServerPrefs) {
      if (Number.isFinite(prefs?.defaultRiskPct)) state.defaultRiskPct = Number(prefs.defaultRiskPct);
      if (prefs?.defaultRiskCurrency && ['GBP', 'USD', 'EUR'].includes(prefs.defaultRiskCurrency)) {
        state.defaultRiskCurrency = prefs.defaultRiskCurrency;
      }
    } else if (localPrefs) {
      if (Number.isFinite(localPrefs?.defaultRiskPct)) state.defaultRiskPct = Number(localPrefs.defaultRiskPct);
      if (localPrefs?.defaultRiskCurrency && ['GBP', 'USD', 'EUR'].includes(localPrefs.defaultRiskCurrency)) {
        state.defaultRiskCurrency = localPrefs.defaultRiskCurrency;
      }
      await saveUiPrefs();
    }
    state.riskPct = state.defaultRiskPct;
    state.riskCurrency = state.defaultRiskCurrency;
    persistLocalPrefs();
  } catch (e) {
    console.warn('Failed to load ui prefs', e);
  }
}

async function saveUiPrefs() {
  if (isGuestSession()) return;
  try {
    await api('/api/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultRiskPct: state.defaultRiskPct,
        defaultRiskCurrency: state.defaultRiskCurrency
      })
    });
  } catch (e) {
    console.warn('Failed to save ui prefs', e);
  }
}

async function loadData() {
  try {
    state.data = await api('/api/pl');
  } catch (e) {
    if (e?.message !== 'Profile incomplete') {
      console.error('Failed to load profit data', e);
    }
    state.data = {};
  }
  try {
    const res = await api('/api/portfolio');
    const portfolioVal = Number(res?.portfolio);
    state.portfolioGBP = Number.isFinite(portfolioVal) ? portfolioVal : 0;
    const baselineVal = Number(res?.initialNetDeposits);
    const totalVal = Number(res?.netDepositsTotal);
    state.netDepositsBaselineGBP = Number.isFinite(baselineVal) ? baselineVal : 0;
    state.netDepositsTotalGBP = Number.isFinite(totalVal)
      ? totalVal
      : state.netDepositsBaselineGBP;
    state.liveOpenPnlGBP = Number.isFinite(res?.liveOpenPnl) ? res.liveOpenPnl : 0;
    state.livePortfolioGBP = state.portfolioGBP;
    state.isGuest = !!res?.isGuest;
    if (!res?.profileComplete) {
      window.location.href = '/profile.html';
      return;
    }
  } catch (e) {
    console.error('Failed to load portfolio', e);
    state.portfolioGBP = 0;
    state.netDepositsBaselineGBP = 0;
    state.netDepositsTotalGBP = 0;
  }
  computeLifetimeMetrics();
  try {
    const activeRes = await api('/api/trades/active');
    state.activeTrades = Array.isArray(activeRes?.trades) ? activeRes.trades : [];
    if (Number.isFinite(activeRes?.liveOpenPnl)) {
      state.liveOpenPnlGBP = activeRes.liveOpenPnl;
      state.livePortfolioGBP = Number.isFinite(state.portfolioGBP) ? state.portfolioGBP : 0;
    }
    state.openLossPotentialGBP = Number.isFinite(activeRes?.openLossPotential)
      ? activeRes.openLossPotential
      : 0;
    state.liveOpenPnlMode = activeRes?.liveOpenPnlMode || 'computed';
    state.liveOpenPnlCurrency = activeRes?.liveOpenPnlCurrency || 'GBP';
  } catch (e) {
    console.warn('Failed to load active trades', e);
    state.activeTrades = [];
    state.openLossPotentialGBP = 0;
  }
}

async function refreshActiveTrades() {
  try {
    const activeRes = await api('/api/trades/active');
    state.activeTrades = Array.isArray(activeRes?.trades) ? activeRes.trades : [];
    if (Number.isFinite(activeRes?.liveOpenPnl)) {
      state.liveOpenPnlGBP = activeRes.liveOpenPnl;
      state.livePortfolioGBP = Number.isFinite(state.portfolioGBP) ? state.portfolioGBP : 0;
    }
    state.openLossPotentialGBP = Number.isFinite(activeRes?.openLossPotential)
      ? activeRes.openLossPotential
      : 0;
    state.liveOpenPnlMode = activeRes?.liveOpenPnlMode || 'computed';
    state.liveOpenPnlCurrency = activeRes?.liveOpenPnlCurrency || 'GBP';
    renderActiveTrades();
    updatePortfolioPill();
    renderMetrics();
  } catch (e) {
    console.warn('Failed to refresh active trades', e);
    state.openLossPotentialGBP = 0;
  }
}

function renderTradeList(trades = [], dateStr = null) {
  const list = $('#trade-list');
  const sub = $('#trade-count-sub');
  if (!list || !sub) return;
  list.innerHTML = '';
  if (!trades.length) {
    sub.textContent = 'No trades logged for this day.';
    return;
  }
  sub.textContent = trades.length === 1 ? '1 trade logged.' : `${trades.length} trades logged.`;
  trades.forEach(trade => {
    const pill = document.createElement('div');
    pill.className = 'trade-pill';
    const currency = trade.currency || 'GBP';
    const riskAmountDisplay = Number.isFinite(trade.riskAmountGBP)
      ? formatCurrency(trade.riskAmountGBP, currency)
      : formatPrice(trade.riskAmountCurrency, currency);
    const positionDisplay = Number.isFinite(trade.positionGBP)
      ? formatCurrency(trade.positionGBP, currency)
      : formatPrice(trade.positionCurrency, currency);
    const perShareDisplay = formatPrice(trade.perUnitRisk, currency);
    const metaLine = document.createElement('div');
    metaLine.className = 'trade-line';
    const sym = getTradeDisplaySymbol(trade);
    const status = trade.status === 'closed' ? 'Closed' : 'Open';
    const metaText = document.createElement('span');
    metaText.textContent = `${sym} • ${status} • Entry ${formatPrice(trade.entry, currency)} • Stop ${formatPrice(trade.stop, currency)}`;
    metaLine.appendChild(metaText);
    if (shouldShowMappingBadge(trade)) {
      metaLine.appendChild(createMappingBadge());
    }
    pill.appendChild(metaLine);

    const badges = document.createElement('div');
    badges.className = 'trade-meta';
    badges.innerHTML = `
      <span class="trade-badge">Risk ${trade.riskPct.toFixed(2)}%</span>
      <span class="trade-badge">Units ${formatShares(trade.sizeUnits)}</span>
      <span class="trade-badge">Risk ${riskAmountDisplay}</span>
      <span class="trade-badge">Position ${positionDisplay}</span>
      <span class="trade-badge">Risk/share ${perShareDisplay}</span>
    `;
    pill.appendChild(badges);
    const tags = document.createElement('div');
    tags.className = 'tag-chips';
    const addChip = (label, tone = '') => {
      const chip = document.createElement('span');
      chip.className = `tag-chip ${tone}`;
      chip.textContent = label;
      tags.appendChild(chip);
    };
    if (trade.tradeType) addChip(trade.tradeType);
    if (trade.assetClass) addChip(trade.assetClass);
    if (trade.strategyTag) addChip(trade.strategyTag);
    if (trade.marketCondition) addChip(trade.marketCondition);
    (trade.setupTags || []).forEach(tag => addChip(tag));
    (trade.emotionTags || []).forEach(tag => addChip(tag));
    if (tags.childElementCount) {
      pill.appendChild(tags);
    }
    if (trade.status === 'closed' && Number.isFinite(trade.closePrice)) {
      const closed = document.createElement('div');
      closed.className = 'trade-meta';
      closed.textContent = `Closed at ${formatPrice(trade.closePrice, currency)}${trade.closeDate ? ` on ${trade.closeDate}` : ''}`;
      pill.appendChild(closed);
    }
    if (trade.note) {
      const note = document.createElement('p');
      note.className = 'trade-note';
      note.textContent = trade.note;
      pill.appendChild(note);
    }
    if (trade.createdAt) {
      const meta = document.createElement('div');
      meta.className = 'trade-meta';
      const dt = new Date(trade.createdAt);
      if (!Number.isNaN(dt.getTime())) {
        meta.textContent = `Logged ${dt.toLocaleString()}`;
      }
      pill.appendChild(meta);
    }
    if (trade.id) {
      const actionRow = document.createElement('div');
      actionRow.className = 'close-row';
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'danger outline';
      deleteBtn.textContent = 'Delete trade';
      deleteBtn.addEventListener('click', async () => {
        if (!window.confirm('Delete this trade? This cannot be undone.')) {
          return;
        }
        try {
          await api(`/api/trades/${trade.id}`, { method: 'DELETE' });
          await loadData();
          if (dateStr) {
            const refreshed = getDailyEntry(new Date(dateStr));
            renderTradeList(refreshed?.trades || [], dateStr);
            render();
          }
        } catch (e) {
          console.error(e);
        }
      });
      actionRow.appendChild(deleteBtn);
      pill.appendChild(actionRow);
    }
    list.appendChild(pill);
  });
}

function openEntryModal(dateStr, existingEntry = null) {
  const modal = $('#profit-modal');
  if (!modal) return;
  const title = $('#modal-date');
  if (title) {
    title.textContent = new Date(dateStr).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }
  const entry = existingEntry ?? getDailyEntry(new Date(dateStr));
  const currentValGBP = entry?.closing ?? null;
  const depositGBP = entry?.cashIn ?? 0;
  const withdrawalGBP = entry?.cashOut ?? 0;
  const noteText = entry?.note ?? '';
  const label = $('#profit-modal-label');
  if (label) label.textContent = `Closing portfolio value (${state.currency})`;
  const depositLabel = $('#cash-in-label');
  if (depositLabel) depositLabel.textContent = `Deposits (${state.currency})`;
  const withdrawalLabel = $('#cash-out-label');
  if (withdrawalLabel) withdrawalLabel.textContent = `Withdrawals (${state.currency})`;
  const input = $('#edit-profit-input');
  if (input) {
    if (currentValGBP === null || currentValGBP === undefined) {
      input.value = '';
    } else {
      const amount = currencyAmount(currentValGBP, state.currency);
      const fallback = currencyAmount(currentValGBP, 'GBP');
      const value = amount === null ? fallback : amount;
      input.value = Number.isFinite(value) ? value.toFixed(2) : '';
    }
  }
  const depositInput = $('#cash-in-input');
  if (depositInput) {
    if (depositGBP > 0) {
      const amount = currencyAmount(depositGBP, state.currency);
      const fallback = currencyAmount(depositGBP, 'GBP');
      const value = amount === null ? fallback : amount;
      depositInput.value = Number.isFinite(value) ? value.toFixed(2) : '';
    } else {
      depositInput.value = '';
    }
  }
  const withdrawalInput = $('#cash-out-input');
  if (withdrawalInput) {
    if (withdrawalGBP > 0) {
      const amount = currencyAmount(withdrawalGBP, state.currency);
      const fallback = currencyAmount(withdrawalGBP, 'GBP');
      const value = amount === null ? fallback : amount;
      withdrawalInput.value = Number.isFinite(value) ? value.toFixed(2) : '';
    } else {
      withdrawalInput.value = '';
    }
  }
  const noteInput = $('#note-input');
  if (noteInput) {
    noteInput.value = noteText;
  }
  renderTradeList(entry?.trades || [], dateStr);
  modal.classList.remove('hidden');
  const saveBtn = $('#save-profit-btn');
    if (saveBtn) {
    saveBtn.onclick = async () => {
      const rawStr = $('#edit-profit-input').value.trim();
      const depositStr = depositInput ? depositInput.value.trim() : '';
      const withdrawalStr = withdrawalInput ? withdrawalInput.value.trim() : '';
      const depositVal = depositStr === '' ? 0 : Number(depositStr);
      const withdrawalVal = withdrawalStr === '' ? 0 : Number(withdrawalStr);
      if (Number.isNaN(depositVal) || depositVal < 0) return;
      if (Number.isNaN(withdrawalVal) || withdrawalVal < 0) return;
      const noteVal = noteInput ? noteInput.value.trim() : '';
      let valuePayload = null;
      if (rawStr !== '') {
        const raw = Number(rawStr);
        if (Number.isNaN(raw) || raw < 0) return;
        valuePayload = toGBP(raw);
      } else if (!depositVal && !withdrawalVal && !noteVal) {
        return;
      }
      try {
        await api('/api/pl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: dateStr,
            value: valuePayload,
            cashIn: toGBP(depositVal),
            cashOut: toGBP(withdrawalVal),
            note: noteVal
          })
        });
        modal.classList.add('hidden');
        await loadData();
        render();
      } catch (e) {
        console.error(e);
      }
    };
  }
  const deleteBtn = $('#delete-profit-btn');
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      try {
        await api('/api/pl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: dateStr, value: null })
        });
        modal.classList.add('hidden');
        await loadData();
        render();
      } catch (e) {
        console.error(e);
      }
    };
  }
  const closeBtn = $('#profit-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.classList.add('hidden');
    };
    closeBtn.focus();
  }
}

function bindControls() {
  const periodSelect = $('#period-select');
  if (periodSelect) {
    periodSelect.addEventListener('change', () => {
      if (state.view === 'month' || state.view === 'year') {
        state.selected = new Date(Number(periodSelect.value), 0, 1);
      } else {
        state.selected = startOfMonth(new Date(periodSelect.value));
      }
      render();
    });
  }

  const currencySelect = $('#currency-select');
  if (currencySelect) {
    currencySelect.addEventListener('change', () => {
      state.currency = currencySelect.value;
      render();
    });
  }

  $$('#view-controls button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (!view || state.view === view) return;
      state.view = view;
      if (view === 'month' || view === 'year') {
        state.selected = new Date(state.selected.getFullYear(), 0, 1);
      } else {
        state.selected = startOfMonth(state.selected);
      }
      updatePeriodSelect();
      render();
    });
  });

  $('#profile-btn')?.addEventListener('click', () => {
    window.location.href = '/profile.html';
  });

  $('#analytics-btn')?.addEventListener('click', () => {
    window.location.href = '/analytics.html';
  });

  $('#trades-btn')?.addEventListener('click', () => {
    window.location.href = '/trades.html';
  });
  $('#calendar-btn')?.addEventListener('click', () => {
    window.location.href = '/';
  });
  $('#transactions-btn')?.addEventListener('click', () => {
    window.location.href = '/transactions.html';
  });
  $('#devtools-btn')?.addEventListener('click', () => {
    setNavOpen(false);
    window.location.href = '/devtools.html';
  });

  const navToggle = $('#nav-toggle-btn');
  const navDrawer = $('#nav-drawer');
  const navOverlay = $('#nav-drawer-overlay');
  const navClose = $('#nav-close-btn');
  const setNavOpen = open => {
    if (!navDrawer || !navOverlay || !navToggle) return;
    navDrawer.classList.toggle('hidden', !open);
    navOverlay.classList.toggle('hidden', !open);
    navOverlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  navToggle?.addEventListener('click', () => {
    if (!navDrawer || !navOverlay) return;
    const isOpen = !navDrawer.classList.contains('hidden');
    setNavOpen(!isOpen);
  });
  navClose?.addEventListener('click', () => setNavOpen(false));
  navOverlay?.addEventListener('click', () => setNavOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    setNavOpen(false);
  });

  $('#active-trade-show-all')?.addEventListener('click', () => {
    window.location.href = '/trades.html';
  });
  const sortBlocks = $$('#active-trades-card .trade-sort');
  if (sortBlocks.length > 1) {
    sortBlocks.slice(0, -1).forEach(block => block.remove());
  }
  const activeTradeSortSelect = $('#active-trade-sort');
  if (activeTradeSortSelect) {
    activeTradeSortSelect.addEventListener('change', event => {
      const value = event.target?.value || 'newest';
      if (ACTIVE_TRADE_SORTS.has(value)) {
        state.activeTradeSort = value;
        try {
          localStorage.setItem('plc-active-trade-sort', value);
        } catch (e) {
          console.warn('Failed to save active trade sort preference', e);
        }
      }
      renderActiveTrades();
    });
    if (ACTIVE_TRADE_SORTS.has(state.activeTradeSort)) {
      activeTradeSortSelect.value = state.activeTradeSort;
    }
  }

  const openPortfolioModal = () => {
    setNavOpen(false);
    const modalTitle = $('#portfolio-modal-title');
    if (modalTitle) modalTitle.textContent = `Portfolio value (${state.currency})`;
    const input = $('#portfolio-input');
    if (input) {
      const amount = currencyAmount(state.portfolioGBP, state.currency);
      const fallback = currencyAmount(state.portfolioGBP, 'GBP');
      const value = amount === null ? fallback : amount;
      input.value = (Number.isFinite(value) ? value : 0).toFixed(2);
    }
    $('#portfolio-modal')?.classList.remove('hidden');
  };
  $('#qs-portfolio-btn')?.addEventListener('click', openPortfolioModal);

  $('#save-portfolio-btn')?.addEventListener('click', async () => {
    const input = $('#portfolio-input');
    if (!input) return;
    const raw = Number(input.value);
    if (Number.isNaN(raw) || raw < 0) return;
    try {
      await api('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio: toGBP(raw) })
      });
      $('#portfolio-modal')?.classList.add('hidden');
      await loadData();
      render();
    } catch (e) {
      console.error(e);
    }
  });

  $('#close-portfolio-btn')?.addEventListener('click', () => {
    $('#portfolio-modal')?.classList.add('hidden');
  });

  $('#close-profit-btn')?.addEventListener('click', () => {
    $('#profit-modal')?.classList.add('hidden');
  });

  $('#close-edit-trade-btn')?.addEventListener('click', () => {
    $('#edit-trade-modal')?.classList.add('hidden');
  });

  $('#close-close-trade-btn')?.addEventListener('click', () => {
    $('#close-trade-modal')?.classList.add('hidden');
  });
  $('#close-share-card-btn')?.addEventListener('click', closeShareCardModal);
  $('#share-card-layout')?.addEventListener('change', () => {
    if (shareCardState.trade) {
      renderShareCardPreview(shareCardState.trade);
    }
  });

  $('#share-card-copy')?.addEventListener('click', async () => {
    const status = $('#share-card-status');
    if (!shareCardState.blob) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      if (status) status.textContent = 'Copy is not supported in this browser.';
      return;
    }
    try {
      const item = new ClipboardItem({ 'image/png': shareCardState.blob });
      await navigator.clipboard.write([item]);
      if (status) status.textContent = 'Copied to clipboard.';
    } catch (e) {
      if (status) status.textContent = e?.message || 'Failed to copy image.';
    }
  });

  $('#share-card-share')?.addEventListener('click', async () => {
    const status = $('#share-card-status');
    if (!shareCardState.blob || !navigator.share) return;
    try {
      const file = new File([shareCardState.blob], 'trade-summary.png', { type: 'image/png' });
      await navigator.share({ files: [file], title: 'Trade summary card' });
      if (status) status.textContent = '';
    } catch (e) {
      if (status && e?.name !== 'AbortError') {
        status.textContent = e?.message || 'Failed to share image.';
      }
    }
  });

  const updateCloseTradePreview = () => {
    const modal = $('#close-trade-modal');
    if (!modal) return;
    const priceInput = $('#close-trade-price');
    const preview = $('#close-trade-preview');
    if (!priceInput || !preview) return;
    const priceVal = Number(priceInput.value);
    if (!Number.isFinite(priceVal) || priceVal <= 0) {
      preview.textContent = 'PnL if closed: —';
      return;
    }
    const entryVal = Number(modal.dataset.entry);
    const unitsVal = Number(modal.dataset.units);
    if (!Number.isFinite(entryVal) || !Number.isFinite(unitsVal)) {
      preview.textContent = 'PnL if closed: —';
      return;
    }
    const direction = modal.dataset.direction === 'short' ? 'short' : 'long';
    const slippage = Number(modal.dataset.slippage) || 0;
    const effectivePrice = direction === 'short' ? priceVal + slippage : priceVal - slippage;
    const pnlRaw = direction === 'short'
      ? (entryVal - effectivePrice) * unitsVal
      : (effectivePrice - entryVal) * unitsVal;
    const currency = modal.dataset.currency || 'GBP';
    const fees = Number(modal.dataset.fees) || 0;
    const pnlGBP = currency === 'GBP' ? pnlRaw : toGBP(pnlRaw, currency);
    const feesGBP = currency === 'GBP' ? fees : toGBP(fees, currency);
    let fxFeeGBP = null;
    if (modal.dataset.fxFeeEligible === 'true') {
      const fxRate = Number(modal.dataset.fxFeeRate);
      if (Number.isFinite(fxRate) && fxRate > 0) {
        const entryValueGBP = currency === 'GBP' ? entryVal * unitsVal : toGBP(entryVal * unitsVal, currency);
        const positionGBP = currency === 'GBP' ? priceVal * unitsVal : toGBP(priceVal * unitsVal, currency);
        if (Number.isFinite(entryValueGBP)) {
          const entryFeeGBP = Math.abs(entryValueGBP) * fxRate;
          const exitBasisGBP = Number.isFinite(positionGBP) ? Math.abs(positionGBP) : Math.abs(entryValueGBP);
          const exitFeeGBP = exitBasisGBP * fxRate;
          fxFeeGBP = entryFeeGBP + exitFeeGBP;
        }
      }
    }
    const pnlNetGBP = pnlGBP - (feesGBP ?? 0) - (fxFeeGBP ?? 0);
    preview.textContent = `PnL if closed: ${formatSignedCurrency(pnlNetGBP, state.currency)}`;
  };

  $('#close-trade-price')?.addEventListener('input', updateCloseTradePreview);
  $('#close-trade-price')?.addEventListener('change', updateCloseTradePreview);

  $('#save-close-trade-btn')?.addEventListener('click', async () => {
    const modal = $('#close-trade-modal');
    if (!modal) return;
    const tradeId = modal.dataset.tradeId;
    if (!tradeId) return;
    const priceInput = $('#close-trade-price');
    const dateInput = $('#close-trade-date');
    const status = $('#close-trade-status');
    if (status) status.textContent = '';
    const priceVal = Number(priceInput?.value);
    if (!Number.isFinite(priceVal) || priceVal <= 0) {
      if (status) status.textContent = 'Enter a valid closing price.';
      return;
    }
    try {
      await api('/api/trades/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tradeId, price: priceVal, date: dateInput?.value })
      });
      modal.classList.add('hidden');
      await loadData();
      render();
    } catch (e) {
      if (status) status.textContent = e?.message || 'Failed to close trade.';
    }
  });

  $('#cancel-close-trade-btn')?.addEventListener('click', () => {
    $('#close-trade-modal')?.classList.add('hidden');
  });

  $('#save-edit-trade-btn')?.addEventListener('click', async () => {
    const modal = $('#edit-trade-modal');
    if (!modal) return;
    const tradeId = modal.dataset.tradeId;
    if (!tradeId) return;
    const symbolInput = $('#edit-trade-symbol');
    const entryInput = $('#edit-trade-entry');
    const stopInput = $('#edit-trade-stop');
    const currentStopInput = $('#edit-trade-current-stop');
    const unitsInput = $('#edit-trade-units');
    const status = $('#edit-trade-status');
    if (status) status.textContent = '';
    const symbolVal = symbolInput?.value.trim() ?? '';
    const entryVal = Number(entryInput?.value);
    const stopVal = Number(stopInput?.value);
    const currentStopVal = currentStopInput?.value.trim() ?? '';
    const unitsVal = Number(unitsInput?.value);
    if (!symbolVal) {
      if (status) status.textContent = 'Enter a valid ticker symbol.';
      return;
    }
    if (!Number.isFinite(entryVal) || entryVal <= 0) {
      if (status) status.textContent = 'Enter a valid entry price.';
      return;
    }
    if (!Number.isFinite(stopVal) || stopVal <= 0) {
      if (status) status.textContent = 'Enter a valid stop price.';
      return;
    }
    if (!Number.isFinite(unitsVal) || unitsVal <= 0) {
      if (status) status.textContent = 'Enter a valid unit size.';
      return;
    }
    const direction = modal.dataset.direction === 'short' ? 'short' : 'long';
    if (direction === 'long' && stopVal >= entryVal) {
      if (status) status.textContent = 'Stop must be below entry for long trades.';
      return;
    }
    if (direction === 'short' && stopVal <= entryVal) {
      if (status) status.textContent = 'Stop must be above entry for short trades.';
      return;
    }
    let currentStopPayload;
    if (currentStopVal) {
      const parsedCurrentStop = Number(currentStopVal);
      if (!Number.isFinite(parsedCurrentStop) || parsedCurrentStop <= 0) {
        if (status) status.textContent = 'Enter a valid current stop price.';
        return;
      }
      currentStopPayload = parsedCurrentStop;
    }
    const currentStopSource = modal.dataset.currentStopSource;
    try {
      const isTrading212 = modal.dataset.isTrading212 === 'true';
      if (isTrading212 && typeof window.computeSourceKey === 'function') {
        const instrument = {
          isin: modal.dataset.isin || '',
          uid: modal.dataset.uid || '',
          ticker: modal.dataset.brokerTicker || '',
          currency: modal.dataset.currency || ''
        };
        const sourceKey = window.computeSourceKey(instrument);
        await api('/api/instrument-mappings/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceKey,
            brokerTicker: modal.dataset.brokerTicker || '',
            brokerName: modal.dataset.brokerName || '',
            currency: modal.dataset.currency || '',
            isin: modal.dataset.isin || '',
            canonicalTicker: symbolVal,
            canonicalName: modal.dataset.brokerName || ''
          })
        });
      }
      const tradePayload = {
        entry: entryVal,
        stop: stopVal,
        currentStop: currentStopPayload ?? null,
        sizeUnits: unitsVal
      };
      if (currentStopSource === 'manual') {
        tradePayload.currentStopSource = 'manual';
      }
      if (modal.dataset.isTrading212 !== 'true') {
        tradePayload.displaySymbol = symbolVal;
      }
      await api(`/api/trades/${tradeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tradePayload)
      });
      modal.classList.add('hidden');
      await loadData();
      render();
    } catch (e) {
      if (status) status.textContent = e?.message || 'Failed to update trade.';
    }
  });
  $('#edit-promote-mapping-btn')?.addEventListener('click', async () => {
    const modal = $('#edit-trade-modal');
    const status = $('#edit-trade-status');
    const mappingId = Number($('#edit-promote-mapping-btn')?.dataset?.mappingId);
    if (!modal || !mappingId) return;
    if (!window.confirm('Promote this ticker mapping for all users?')) {
      return;
    }
    if (status) status.textContent = '';
    try {
      await api('/api/instrument-mappings/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappingId })
      });
      if (status) status.textContent = 'Mapping promoted globally.';
      await loadData();
      render();
    } catch (e) {
      if (status) status.textContent = e?.message || 'Failed to promote mapping.';
    }
  });
  $('#delete-edit-trade-btn')?.addEventListener('click', async () => {
    const modal = $('#edit-trade-modal');
    if (!modal) return;
    const tradeId = modal.dataset.tradeId;
    if (!tradeId) return;
    const status = $('#edit-trade-status');
    if (status) status.textContent = '';
    if (!window.confirm('Delete this trade? This cannot be undone.')) {
      return;
    }
    try {
      await api(`/api/trades/${tradeId}`, { method: 'DELETE' });
      modal.classList.add('hidden');
      await loadData();
      render();
    } catch (e) {
      if (status) status.textContent = e?.message || 'Failed to delete trade.';
    }
  });
  $('#cancel-edit-trade-btn')?.addEventListener('click', () => {
    $('#edit-trade-modal')?.classList.add('hidden');
  });

  $('#logout-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (e) {
      console.warn(e);
    }
    sessionStorage.removeItem('guestMode');
    localStorage.removeItem('guestMode');
    window.location.href = '/login.html';
  });

  let isAutoStopUpdate = false;
  const markAuto = value => {
    isAutoStopUpdate = value;
  };
  ['#risk-entry-input', '#risk-stop-input', '#risk-percent-input'].forEach(sel => {
    $(sel)?.addEventListener('input', () => calculateRiskPosition(false));
  });
  const stopInput = $('#risk-stop-input');
  if (stopInput) {
    stopInput.addEventListener('input', () => {
      if (isAutoStopUpdate) return;
      state.manualStopOverride = true;
    });
  }
  const symbolInput = $('#risk-symbol-input');
  if (symbolInput) {
    let autoStopTimer = null;
    const scheduleAutoStop = () => {
      if (autoStopTimer) clearTimeout(autoStopTimer);
      const rawSymbol = symbolInput.value.trim();
      if (!rawSymbol) return;
      const normalized = rawSymbol.toUpperCase();
      autoStopTimer = setTimeout(() => {
        if (state.autoStopSymbol !== normalized) {
          state.autoStopSymbol = normalized;
          state.manualStopOverride = false;
          state.autoStopValue = null;
        }
        updateAutoStop(normalized, stopInput, markAuto);
      }, 400);
    };
    symbolInput.addEventListener('input', scheduleAutoStop);
    symbolInput.addEventListener('blur', scheduleAutoStop);
    setInterval(() => {
      if (!symbolInput.value.trim() || state.manualStopOverride) return;
      updateAutoStop(symbolInput.value.trim().toUpperCase(), stopInput, markAuto);
    }, 5 * 60 * 1000);
  }
  $$('#risk-percent-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      const pct = Number(btn.dataset.riskPct);
      if (!Number.isFinite(pct) || pct <= 0) return;
      state.riskPct = pct;
      const pctInput = $('#risk-percent-input');
      if (pctInput) pctInput.value = String(pct);
      renderRiskCalculator();
    });
  });
  const openQuickSettings = () => {
    setNavOpen(false);
    const modal = $('#quick-settings-modal');
    const riskSel = $('#qs-risk-select');
    const curSel = $('#qs-currency-select');
    const safeToggle = $('#qs-safe-screenshot');
    if (riskSel) riskSel.value = String(state.defaultRiskPct || 1);
    if (curSel) curSel.value = state.defaultRiskCurrency || 'GBP';
    if (safeToggle) safeToggle.checked = !!state.safeScreenshot;
    modal?.classList.remove('hidden');
  };
  $('#quick-settings-btn')?.addEventListener('click', openQuickSettings);
  $('#safe-screenshot-open-qs')?.addEventListener('click', openQuickSettings);
  const closeQs = () => $('#quick-settings-modal')?.classList.add('hidden');
  $('#close-qs-btn')?.addEventListener('click', closeQs);
  $('#save-qs-btn')?.addEventListener('click', () => {
    const riskSel = $('#qs-risk-select');
    const curSel = $('#qs-currency-select');
    const safeToggle = $('#qs-safe-screenshot');
    const pct = Number(riskSel?.value);
    const cur = curSel?.value;
    if (Number.isFinite(pct) && pct > 0) {
      state.defaultRiskPct = pct;
      state.riskPct = pct;
    }
    if (cur && ['GBP', 'USD', 'EUR'].includes(cur)) {
      state.defaultRiskCurrency = cur;
      state.riskCurrency = cur;
    }
    if (safeToggle) {
      state.safeScreenshot = safeToggle.checked;
    }
    persistLocalPrefs();
    saveUiPrefs();
    renderRiskCalculator();
    render();
    closeQs();
  });
  $$('#risk-currency-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      const cur = btn.dataset.riskCurrency;
      if (!cur || !['GBP', 'USD', 'EUR'].includes(cur)) return;
      state.riskCurrency = cur;
      renderRiskCalculator();
    });
  });
  $$('#risk-direction-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.direction;
      if (!dir || !['long', 'short'].includes(dir)) return;
      state.direction = dir;
      renderRiskCalculator();
    });
  });
  $('#risk-log-btn')?.addEventListener('click', async () => {
    calculateRiskPosition(true);
    const errorText = $('#risk-error')?.textContent?.trim();
    if (errorText) return;
    const entryInput = $('#risk-entry-input');
    const stopInput = $('#risk-stop-input');
    const riskPctInput = $('#risk-percent-input');
    const dateInput = $('#risk-date-input');
    const noteInput = $('#risk-trade-note');
    const symbolInput = $('#risk-symbol-input');
    const tradeTypeInput = $('#trade-type-input');
    const assetClassInput = $('#asset-class-input');
    const strategyTagInput = $('#strategy-tag-input');
    const marketConditionInput = $('#market-condition-input');
    const screenshotInput = $('#screenshot-url-input');
    const statusEl = $('#risk-log-status');
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.remove('success', 'error');
    }
    if (!entryInput || !stopInput || !riskPctInput) return;
    const payload = {
      entry: Number(entryInput.value),
      stop: Number(stopInput.value),
      riskPct: Number(riskPctInput.value),
      currency: state.riskCurrency,
      baseCurrency: state.currency,
      symbol: symbolInput?.value,
      date: dateInput?.value,
      note: noteInput?.value || undefined,
      direction: state.direction,
      fees: 0,
      slippage: 0,
      rounding: 'fractional',
      tradeType: tradeTypeInput?.value,
      assetClass: assetClassInput?.value,
      strategyTag: strategyTagInput?.value,
      marketCondition: marketConditionInput?.value,
      setupTags: getSelectedTags('setup-tag'),
      emotionTags: getSelectedTags('emotion-tag'),
      screenshotUrl: screenshotInput?.value || undefined
    };
    try {
      await api('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (statusEl) {
        statusEl.classList.remove('error');
        statusEl.classList.add('success');
        statusEl.textContent = 'Trade saved to calendar.';
      }
      await loadData();
      render();
    } catch (e) {
      console.error(e);
      if (statusEl) {
        statusEl.classList.remove('success');
        statusEl.classList.add('error');
        statusEl.textContent = e?.message || 'Failed to save trade.';
      }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#profit-modal')?.classList.add('hidden');
      $('#edit-trade-modal')?.classList.add('hidden');
      $('#close-trade-modal')?.classList.add('hidden');
      closeShareCardModal();
    }
  });
  window.addEventListener('resize', () => {
    syncActiveTradesHeight();
  });
  window.addEventListener('resize', () => {
    syncActiveTradesHeight();
  });
}

async function updateDevtoolsNav() {
  try {
    const profile = await api('/api/profile');
    const show = profile?.username === 'mevs.0404@gmail.com' || profile?.username === 'dummy1';
    $$('#devtools-btn').forEach(btn => btn.classList.toggle('is-hidden', !show));
  } catch (e) {
    $$('#devtools-btn').forEach(btn => btn.classList.add('is-hidden'));
  }
}

if (typeof module !== 'undefined') {
  module.exports = { computeRiskPlan, summarizeWeek, computeAverageChangePercent };
}

async function loadProfile() {
  try {
    const profile = await api('/api/profile');
    state.isAdmin = !!profile?.isAdmin;
    state.profile = profile || null;
  } catch (e) {
    state.isAdmin = false;
    state.profile = null;
  }
}

async function updateDevtoolsNav() {
  try {
    const profile = await api('/api/profile');
    const show = profile?.username === 'mevs.0404@gmail.com' || profile?.username === 'dummy1';
    $$('#devtools-btn').forEach(btn => btn.classList.toggle('is-hidden', !show));
  } catch (e) {
    $$('#devtools-btn').forEach(btn => btn.classList.add('is-hidden'));
  }
}

if (typeof module !== 'undefined') {
  module.exports = { computeRiskPlan, summarizeWeek, computeAverageChangePercent };
}

async function updateDevtoolsNav() {
  try {
    const profile = await api('/api/profile');
    const show = profile?.username === 'mevs.0404@gmail.com' || profile?.username === 'dummy1';
    $$('#devtools-btn').forEach(btn => btn.classList.toggle('is-hidden', !show));
  } catch (e) {
    $$('#devtools-btn').forEach(btn => btn.classList.add('is-hidden'));
  }
}

if (typeof module !== 'undefined') {
  module.exports = { computeRiskPlan, summarizeWeek, computeAverageChangePercent };
}

async function updateDevtoolsNav() {
  try {
    const profile = await api('/api/profile');
    const show = profile?.username === 'mevs.0404@gmail.com' || profile?.username === 'dummy1';
    $$('#devtools-btn').forEach(btn => btn.classList.toggle('is-hidden', !show));
  } catch (e) {
    $$('#devtools-btn').forEach(btn => btn.classList.add('is-hidden'));
  }
}

if (typeof module !== 'undefined') {
  module.exports = { computeRiskPlan, summarizeWeek, computeAverageChangePercent };
}

async function init() {
  state.selected = startOfMonth(new Date());
  try {
    const saved = localStorage.getItem('plc-prefs');
    if (saved) {
      const prefs = JSON.parse(saved);
      if (Number.isFinite(prefs?.defaultRiskPct)) state.defaultRiskPct = Number(prefs.defaultRiskPct);
      if (prefs?.defaultRiskCurrency && ['GBP', 'USD', 'EUR'].includes(prefs.defaultRiskCurrency)) state.defaultRiskCurrency = prefs.defaultRiskCurrency;
      if (typeof prefs?.safeScreenshot === 'boolean') state.safeScreenshot = prefs.safeScreenshot;
      state.riskPct = state.defaultRiskPct;
      state.riskCurrency = state.defaultRiskCurrency;
    }
    const savedTradeSort = localStorage.getItem('plc-active-trade-sort');
    if (ACTIVE_TRADE_SORTS.has(savedTradeSort)) {
      state.activeTradeSort = savedTradeSort;
    }
  } catch (e) {
    console.warn(e);
  }
  await loadUiPrefs();
  await loadProfile();
  bindControls();
  updatePeriodSelect();
  setActiveView();
  try {
    await loadRates();
  } catch (e) {
    console.warn(e);
  }
  await loadData();
  updateDevtoolsNav();
  render();
  setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    refreshActiveTrades();
  }, 15000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', init);
}
