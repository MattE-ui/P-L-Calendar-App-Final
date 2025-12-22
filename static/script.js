const state = {
  view: 'month',
  selected: new Date(),
  data: {},
  portfolioGBP: 0,
  netDepositsBaselineGBP: 0,
  netDepositsTotalGBP: 0,
  firstEntryKey: null,
  currency: 'GBP',
  riskCurrency: 'GBP',
  rates: { GBP: 1 },
  liveOpenPnlGBP: 0,
  livePortfolioGBP: 0,
  activeTrades: [],
  metrics: {
    baselineGBP: 0,
    latestGBP: 0,
    netDepositsGBP: 0,
    netPerformanceGBP: 0,
    netPerformancePct: null
  },
  direction: 'long',
  fees: 0,
  slippage: 0,
  rounding: 'fractional'
};

const currencySymbols = { GBP: '£', USD: '$' };
const viewAvgLabels = { day: 'Daily', week: 'Weekly', month: 'Daily', year: 'Monthly' };

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', ...opts });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (res.status === 401) {
    window.location.href = '/login.html';
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

function formatPrice(value, currency = state.currency) {
  const symbol = currencySymbols[currency] || '';
  if (!Number.isFinite(value)) return '—';
  return `${symbol}${value.toFixed(4)}`;
}

function toGBP(value, currency = state.currency) {
  if (currency === 'GBP') return value;
  const rate = state.rates[currency];
  if (!rate) return value;
  return value / rate;
}

function signPrefix(num) {
  return num > 0 ? '+' : '';
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
      createdAt
    };
  }).filter(Boolean);
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
  if (!hasClosing && !trades.length) return null;
  const cashInRaw = Number(record.cashIn ?? 0);
  const cashOutRaw = Number(record.cashOut ?? 0);
  const cashIn = Number.isFinite(cashInRaw) && cashInRaw >= 0 ? cashInRaw : 0;
  const cashOut = Number.isFinite(cashOutRaw) && cashOutRaw >= 0 ? cashOutRaw : 0;
  const noteRaw = typeof record.note === 'string' ? record.note : '';
  const note = noteRaw.trim();
  const hasOpening = Number.isFinite(opening);
  const netCash = cashIn - cashOut;
  const change = hasOpening && hasClosing ? closing - opening - netCash : null;
  const pct = hasOpening && hasClosing && opening !== 0 ? (change / opening) * 100 : null;
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
    const firstEntry = changeEntries[0] || days[0];
    const baseline = firstEntry ? (firstEntry.opening ?? firstEntry.closing ?? null) : null;
    const pct = !changeEntries.length || baseline === null || baseline === 0
      ? null
      : (totalChange / baseline) * 100;
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
    const firstEntry = changeEntries[0] || days[0];
    const baseline = firstEntry ? (firstEntry.opening ?? firstEntry.closing) : null;
    const pct = !changeEntries.length || baseline === null || baseline === 0
      ? null
      : (totalChange / baseline) * 100;
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
  if (state.view === 'year') {
    return getYearMonths(state.selected).map(item => ({
      change: item.hasChange ? item.totalChange : null,
      pct: item.hasChange ? item.pct : null,
      cashFlow: item.totalCashFlow ?? 0
    }));
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
  let computedTotalDeposits = baselineDeposits;
  entries.forEach(entry => {
    if (baseline === null && entry?.opening !== null && entry?.opening !== undefined) {
      baseline = entry.opening;
    }
    if (!entry?.preBaseline && entry?.cashFlow !== undefined && entry?.cashFlow !== null) {
      computedTotalDeposits += entry.cashFlow;
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
  const totalNetDeposits = entries.length
    ? computedTotalDeposits
    : (Number.isFinite(state.netDepositsTotalGBP) ? state.netDepositsTotalGBP : baselineDeposits);
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
  positionNote && (positionNote.textContent = shares > 0
    ? `Position ≈ ${formatCurrency(positionGBP, riskCurrency)}${riskCurrency !== 'GBP' && Number.isFinite(positionCurrency) ? ` (${formatCurrency(positionCurrency, 'GBP')})` : ''}`
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
  const riskPct = Number(riskPctInput.value);
  const portfolioGBP = getLatestPortfolioGBP();
  const riskCurrency = state.riskCurrency || 'GBP';
  const direction = state.direction || 'long';
  const fees = Number($('#risk-fees-input')?.value) || 0;
  const slippage = Number($('#risk-slippage-input')?.value) || 0;
  const allowFractional = state.rounding !== 'whole';

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
  const directionSelect = $('#risk-direction-select');
  if (directionSelect) {
    const safeDirection = ['long', 'short'].includes(state.direction) ? state.direction : 'long';
    state.direction = safeDirection;
    directionSelect.value = safeDirection;
  }
  const tradeTypeInput = $('#trade-type-input');
  if (tradeTypeInput && !tradeTypeInput.value) tradeTypeInput.value = 'day';
  const assetClassInput = $('#asset-class-input');
  if (assetClassInput && !assetClassInput.value) assetClassInput.value = 'stocks';
  const marketConditionInput = $('#market-condition-input');
  if (marketConditionInput && !marketConditionInput.value) marketConditionInput.value = '';
  const roundingSelect = $('#risk-rounding-select');
  if (roundingSelect) roundingSelect.value = state.rounding;
  const entryLabel = $('#risk-entry-label');
  if (entryLabel) entryLabel.textContent = `Entry price (${state.riskCurrency})`;
  const stopLabel = $('#risk-stop-label');
  if (stopLabel) stopLabel.textContent = `Stop-loss price (${state.riskCurrency})`;
  const portfolioEl = $('#risk-portfolio-display');
  if (portfolioEl) portfolioEl.textContent = formatCurrency(getLatestPortfolioGBP(), state.riskCurrency);
  const pctInput = $('#risk-percent-input');
  if (pctInput && !pctInput.value) pctInput.value = '1';
  const dateInput = $('#risk-date-input');
  if (dateInput && !dateInput.value) {
    dateInput.valueAsDate = new Date();
  }
  const symbolInput = $('#risk-symbol-input');
  if (symbolInput && !symbolInput.value) symbolInput.value = '';
  const riskCurrencySelect = $('#risk-calc-currency');
  if (riskCurrencySelect) {
    const allowedCurrencies = ['GBP', 'USD'];
    const safeCurrency = allowedCurrencies.includes(state.riskCurrency) ? state.riskCurrency : 'GBP';
    state.riskCurrency = safeCurrency;
    riskCurrencySelect.value = safeCurrency;
  }
  calculateRiskPosition(false);
}

function renderActiveTrades() {
  const list = $('#active-trade-list');
  const empty = $('#active-trade-empty');
  const pnlEl = $('#live-pnl-display');
  if (!list) return;
  list.innerHTML = '';
  const trades = Array.isArray(state.activeTrades) ? state.activeTrades : [];
  if (pnlEl) pnlEl.textContent = formatSignedCurrency(state.liveOpenPnlGBP, state.currency);
  if (!trades.length) {
    if (empty) empty.classList.remove('is-hidden');
    return;
  }
  if (empty) empty.classList.add('is-hidden');
  trades.forEach(trade => {
    const pill = document.createElement('div');
    pill.className = 'trade-pill';
    const priceLine = document.createElement('div');
    priceLine.className = 'trade-line';
    const sym = trade.symbol || '—';
    const livePrice = Number.isFinite(trade.livePrice) ? trade.livePrice : null;
    priceLine.textContent = `${sym} (${trade.direction === 'short' ? 'Short' : 'Long'}) @ ${formatPrice(trade.entry, trade.currency)} • Stop ${formatPrice(trade.stop, trade.currency)} • Live ${formatPrice(livePrice, trade.currency)}`;
    pill.appendChild(priceLine);
    const badges = document.createElement('div');
    badges.className = 'trade-meta';
    const pnl = Number.isFinite(trade.unrealizedGBP) ? trade.unrealizedGBP : 0;
    const pnlBadge = document.createElement('span');
    pnlBadge.className = `trade-badge ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`;
    pnlBadge.textContent = `PnL ${formatSignedCurrency(pnl)}`;
    badges.appendChild(pnlBadge);
    badges.insertAdjacentHTML('beforeend', `
      <span class="trade-badge">Units ${formatShares(trade.sizeUnits)}</span>
      <span class="trade-badge">Risk ${Number.isFinite(trade.riskPct) ? trade.riskPct.toFixed(2) : '—'}%</span>
      ${Number.isFinite(trade.fees) && trade.fees > 0 ? `<span class="trade-badge">Fees ${formatCurrency(trade.fees, trade.currency)}</span>` : ''}
    `);
    pill.appendChild(badges);
    const closeRow = document.createElement('div');
    closeRow.className = 'close-row';
    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.step = '0.0001';
    priceInput.min = '0';
    priceInput.value = livePrice ? livePrice : '';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.valueAsDate = new Date();
    const closeBtn = document.createElement('button');
    closeBtn.className = 'primary outline';
    closeBtn.textContent = 'Close trade';
    const status = document.createElement('div');
    status.className = 'tool-note';
    closeBtn.addEventListener('click', async () => {
      status.textContent = '';
      const priceVal = Number(priceInput.value);
      if (!Number.isFinite(priceVal) || priceVal <= 0) {
        status.textContent = 'Enter a valid closing price.';
        return;
      }
      try {
        await api('/api/trades/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: trade.id, price: priceVal, date: dateInput.value })
        });
        await loadData();
        render();
      } catch (e) {
        status.textContent = e?.message || 'Failed to close trade.';
      }
    });
    closeRow.append(priceInput, dateInput, closeBtn, status);
    pill.appendChild(closeRow);
    list.appendChild(pill);
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
  const max = Math.max(...last.map(e => e.closing ?? e.opening ?? 0));
  const min = Math.min(...last.map(e => e.closing ?? e.opening ?? 0));
  const range = Math.max(max - min, 1);
  last.forEach(entry => {
    const val = entry.closing ?? entry.opening ?? 0;
    const heightPct = ((val - min) / range) * 100;
    const bar = document.createElement('div');
    bar.className = 'mini-bar';
    bar.style.height = `${Math.max(8, heightPct)}%`;
    bar.title = `${entry.date.toLocaleDateString()} • ${formatCurrency(val)}`;
    el.appendChild(bar);
  });
}

function setMetricTrend(el, value) {
  if (!el) return;
  const isPositive = Number.isFinite(value) && value > 0;
  const isNegative = Number.isFinite(value) && value < 0;
  el.classList.toggle('positive', isPositive);
  el.classList.toggle('negative', isNegative);
  if (!isPositive && !isNegative) {
    el.classList.remove('positive');
    el.classList.remove('negative');
  }
}

function renderMetrics() {
  const metrics = state.metrics || {};
  const latestGBP = Number.isFinite(metrics.latestGBP) ? metrics.latestGBP : state.portfolioGBP;
  const liveGBP = Number.isFinite(state.livePortfolioGBP) ? state.livePortfolioGBP : latestGBP;
  const netDepositsGBP = Number.isFinite(metrics.netDepositsGBP) ? metrics.netDepositsGBP : 0;
  const netPerformanceGBP = Number.isFinite(metrics.netPerformanceGBP) ? metrics.netPerformanceGBP : 0;
  const netPerformancePct = Number.isFinite(metrics.netPerformancePct) ? metrics.netPerformancePct : null;
  const altCurrency = state.currency === 'GBP'
    ? (state.rates.USD ? 'USD' : null)
    : 'GBP';

  const portfolioValueEl = $('#metric-portfolio-value');
  if (portfolioValueEl) {
    portfolioValueEl.textContent = formatCurrency(liveGBP);
  }
  const portfolioSubEl = $('#metric-portfolio-sub');
  if (portfolioSubEl) {
    const pieces = [];
    if (altCurrency) {
      const altValue = formatCurrency(liveGBP, altCurrency);
      if (altValue !== '—') pieces.push(`≈ ${altValue}`);
    }
    const openPnl = Number.isFinite(state.liveOpenPnlGBP) ? state.liveOpenPnlGBP : 0;
    if (openPnl !== 0) pieces.push(`Live PnL: ${formatSignedCurrency(openPnl)}`);
    portfolioSubEl.textContent = pieces.join(' • ');
  }

  const netDepositsEl = $('#metric-net-deposits-value');
  if (netDepositsEl) {
    netDepositsEl.textContent = formatSignedCurrency(netDepositsGBP);
  }
  const netDepositsSub = $('#metric-net-deposits-sub');
  if (netDepositsSub) {
    if (altCurrency) {
      const altDeposits = formatSignedCurrency(netDepositsGBP, altCurrency);
      netDepositsSub.textContent = altDeposits === '—' ? '' : `≈ ${altDeposits}`;
    } else {
      netDepositsSub.textContent = '';
    }
  }
  const netCard = $('#metric-net-deposits');
  if (netCard) {
    netCard.classList.remove('positive', 'negative');
  }

  const netPerfEl = $('#metric-net-performance-value');
  if (netPerfEl) {
    netPerfEl.textContent = formatSignedCurrency(netPerformanceGBP);
  }
  const netPerfSub = $('#metric-net-performance-sub');
  if (netPerfSub) {
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
  setMetricTrend($('#metric-net-performance'), netPerformanceGBP);

  const portfolioCard = $('#metric-portfolio');
  if (portfolioCard) {
    const deltaFromBaseline = Number.isFinite(metrics.baselineGBP)
      ? latestGBP - metrics.baselineGBP
      : 0;
    setMetricTrend(portfolioCard, deltaFromBaseline);
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
  const hasUSD = !!state.rates.USD;
  if (usdOption) {
    usdOption.disabled = !hasUSD;
  }
  if (!hasUSD && state.currency === 'USD') {
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
    : (state.rates.USD ? formatCurrency(latestGBP, 'USD') : null);
  if (el) {
    if (state.currency === 'USD') {
      el.innerHTML = `Portfolio: ${base} <span>≈ ${alt}</span>`;
    } else if (state.rates.USD) {
      el.innerHTML = `Portfolio: ${base} <span>≈ ${alt}</span>`;
    } else {
      el.textContent = `Portfolio: ${base}`;
    }
  }
  if (heroVal) {
    heroVal.textContent = base;
  }
  if (heroSub) {
    heroSub.textContent = alt ? `≈ ${alt}` : '';
  }
}

function updatePeriodSelect() {
  const sel = $('#period-select');
  if (!sel) return;
  const desired = state.view === 'year'
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
    if (state.view === 'year') {
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
    if (state.view === 'year') {
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
    title.textContent = `${state.selected.getFullYear()} Performance`;
  } else if (state.view === 'month') {
    title.textContent = monthFormatter.format(state.selected);
  } else if (state.view === 'week') {
    title.textContent = `${monthFormatter.format(state.selected)} Weekly View`;
  } else {
    title.textContent = `${monthFormatter.format(state.selected)} Daily View`;
  }
}

function renderSummary() {
  const avgEl = $('#avg');
  if (!avgEl) return;
  const values = getValuesForSummary();
  let changeSum = 0;
  let changeCount = 0;
  let pctSum = 0;
  let pctCount = 0;
  let cashSum = 0;
  values.forEach(item => {
    if (item?.change !== null && item?.change !== undefined) {
      changeSum += item.change;
      changeCount++;
    }
    if (item?.pct !== null && item?.pct !== undefined) {
      pctSum += item.pct;
      pctCount++;
    }
    cashSum += item?.cashFlow ?? 0;
  });
  const periodLabel = state.view === 'year' ? 'year' : 'month';
  const cashClass = cashSum > 0 ? 'positive' : cashSum < 0 ? 'negative' : '';
  const cashValue = formatSignedCurrency(cashSum);
  const cashClassName = cashClass ? ` ${cashClass}` : '';
  const cashFlowHtml = `Net deposits this ${periodLabel}: <span class="cashflow${cashClassName}">${cashValue}</span>`;
  if (!changeCount) {
    avgEl.innerHTML = `<div class="summary-line"><strong>No performance data yet</strong></div><div class="summary-line">${cashFlowHtml}</div>`;
    avgEl.classList.remove('positive', 'negative');
    return;
  }
  const avgGBP = changeSum / changeCount;
  const avgPct = pctCount ? (pctSum / pctCount) : null;
  const label = viewAvgLabels[state.view] || 'Average';
  const pctText = avgPct === null ? '' : ` (${formatPercent(avgPct)})`;
  avgEl.innerHTML = `<div class="summary-line"><strong>${label} avg change: ${formatSignedCurrency(avgGBP)}${pctText}</strong></div><div class="summary-line">${cashFlowHtml}</div>`;
  avgEl.classList.toggle('positive', avgGBP > 0);
  avgEl.classList.toggle('negative', avgGBP < 0);
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
    const changeText = change === null
      ? 'Δ —'
      : `Δ ${formatSignedCurrency(change)}${pct === null ? '' : ` (${formatPercent(pct)})`}`;
    const cashHtml = cashFlow === 0
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
        <strong>${closing === null ? '—' : formatCurrency(closing)}</strong>
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
    const changeText = hasChange ? `Δ ${formatSignedCurrency(week.totalChange)}` : 'Δ —';
    const pctText = hasChange ? formatPercent(week.pct) : '—';
    const cashFlow = week.totalCashFlow ?? 0;
    const cashHtml = cashFlow === 0
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
    const tradeList = (week.trades || []).map(t => `${t.symbol || '—'} ${t.tradeType || ''} ${t.status || ''}`.trim());
    detail.innerHTML = `
      <div class="week-detail-grid">
        <div><strong>Cash flow</strong><span>${formatSignedCurrency(summary.totalCashFlow || 0)}</span></div>
        <div><strong>Realized P&L</strong><span>${formatSignedCurrency(summary.realized || 0)}</span></div>
        <div><strong>Trades</strong><span>${summary.totalTrades || 0}</span></div>
      </div>
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

function renderMonth() {
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = '';
  const headers = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  headers.forEach(day => {
    const h = document.createElement('div');
    h.className = 'dow';
    h.textContent = day;
    grid.appendChild(h);
  });

  const first = startOfMonth(state.selected);
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
    const cashFlow = entry?.cashFlow ?? 0;
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
    const changeText = change === null
      ? 'Δ —'
      : `Δ ${formatSignedCurrency(change)}${pct === null ? '' : ` (${formatPercent(pct)})`}`;
    const cashHtml = cashFlow === 0
      ? ''
      : `<div class="cashflow">Cash flow: ${formatSignedCurrency(cashFlow)}</div>`;
    const tradeHtml = tradeCount
      ? `<div class="trade-count">Trades: ${tradeCount}</div>`
      : '';
    cell.innerHTML = `
      <div class="date">${day}</div>
      <div class="val">${closing === null ? '—' : formatCurrency(closing)}</div>
      <div class="pct">${changeText}</div>
      ${cashHtml}
      ${tradeHtml}
    `;
    if (entry?.note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'note';
      noteEl.textContent = entry.note;
      noteEl.insertAdjacentText('afterbegin', '📝 ');
      noteEl.title = entry.note;
      cell.appendChild(noteEl);
    }
    cell.addEventListener('click', () => openEntryModal(key, entry));
    grid.appendChild(cell);
  }
}

function renderYear() {
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = '';
  const months = getYearMonths(state.selected);
  months.forEach(item => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (item.totalChange > 0) cell.classList.add('profit');
    if (item.totalChange < 0) cell.classList.add('loss');
    const hasData = item.recordedDays > 0;
    const hasChange = item.hasChange;
    const pctText = hasChange ? formatPercent(item.pct) : '—';
    const cashFlow = item.totalCashFlow ?? 0;
    const cashHtml = cashFlow === 0
      ? ''
      : `<div class="cashflow">Cash flow: ${formatSignedCurrency(cashFlow)}</div>`;
    const metaText = hasData
      ? `${item.recordedDays} recorded day${item.recordedDays === 1 ? '' : 's'}`
      : 'No entries yet';
    cell.innerHTML = `
      <div class="date">${item.monthDate.toLocaleDateString('en-GB', { month: 'short' })}</div>
      <div class="val">${hasChange ? `Δ ${formatSignedCurrency(item.totalChange)}` : 'Δ —'}</div>
      <div class="pct">${pctText}</div>
      ${cashHtml}
      <div class="meta">${metaText}</div>
    `;
    cell.addEventListener('click', () => {
      state.view = 'month';
      state.selected = startOfMonth(item.monthDate);
      updatePeriodSelect();
      render();
    });
    grid.appendChild(cell);
  });
}

function renderView() {
  const grid = $('#grid');
  if (!grid) return;
  grid.className = `grid view-${state.view}`;
  if (state.view === 'day') return renderDay();
  if (state.view === 'week') return renderWeek();
  if (state.view === 'month') return renderMonth();
  return renderYear();
}

function render() {
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
}

async function loadRates() {
  try {
    const res = await api('/api/rates');
    const rates = res?.rates || {};
    state.rates = { GBP: 1, ...rates };
  } catch (e) {
    console.warn('Unable to load exchange rates', e);
    state.rates = { GBP: 1, ...(state.rates.USD ? { USD: state.rates.USD } : {}) };
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
    const livePortfolio = Number.isFinite(res?.livePortfolio) ? res.livePortfolio : state.portfolioGBP;
    state.livePortfolioGBP = livePortfolio;
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
      state.livePortfolioGBP = (Number.isFinite(state.portfolioGBP) ? state.portfolioGBP : 0) + activeRes.liveOpenPnl;
    }
  } catch (e) {
    console.warn('Failed to load active trades', e);
    state.activeTrades = [];
  }
}

function renderTradeList(trades = []) {
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
    const sym = trade.symbol || '—';
    const status = trade.status === 'closed' ? 'Closed' : 'Open';
    metaLine.textContent = `${sym} • ${status} • Entry ${formatPrice(trade.entry, currency)} • Stop ${formatPrice(trade.stop, currency)}`;
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
  renderTradeList(entry?.trades || []);
  modal.classList.remove('hidden');
  const saveBtn = $('#save-profit-btn');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const rawStr = $('#edit-profit-input').value.trim();
      if (rawStr === '') return;
      const raw = Number(rawStr);
      if (Number.isNaN(raw) || raw < 0) return;
      const depositStr = depositInput ? depositInput.value.trim() : '';
      const withdrawalStr = withdrawalInput ? withdrawalInput.value.trim() : '';
      const depositVal = depositStr === '' ? 0 : Number(depositStr);
      const withdrawalVal = withdrawalStr === '' ? 0 : Number(withdrawalStr);
      if (Number.isNaN(depositVal) || depositVal < 0) return;
      if (Number.isNaN(withdrawalVal) || withdrawalVal < 0) return;
      const noteVal = noteInput ? noteInput.value.trim() : '';
      try {
        await api('/api/pl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: dateStr,
            value: toGBP(raw),
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
      if (state.view === 'year') {
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
      if (view === 'year') {
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

  $('#portfolio-btn')?.addEventListener('click', () => {
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
  });

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

  $('#logout-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (e) {
      console.warn(e);
    }
    window.location.href = '/login.html';
  });

  $('#risk-calc-btn')?.addEventListener('click', () => calculateRiskPosition(true));
  ['#risk-entry-input', '#risk-stop-input', '#risk-percent-input'].forEach(sel => {
    $(sel)?.addEventListener('input', () => calculateRiskPosition(false));
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
    const feesInput = $('#risk-fees-input');
    const slippageInput = $('#risk-slippage-input');
    const roundingSelect = $('#risk-rounding-select');
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
      symbol: symbolInput?.value,
      date: dateInput?.value,
      note: noteInput?.value || undefined,
      direction: state.direction,
      fees: Number(feesInput?.value) || 0,
      slippage: Number(slippageInput?.value) || 0,
      rounding: roundingSelect?.value || 'fractional',
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
  $('#risk-calc-currency')?.addEventListener('change', (e) => {
    const cur = e.target.value;
    if (!['GBP', 'USD'].includes(cur)) return;
    state.riskCurrency = cur;
    renderRiskCalculator();
  });
  $('#risk-direction-select')?.addEventListener('change', (e) => {
    const dir = e.target.value === 'short' ? 'short' : 'long';
    state.direction = dir;
    renderRiskCalculator();
  });
  $('#risk-rounding-select')?.addEventListener('change', (e) => {
    state.rounding = e.target.value === 'whole' ? 'whole' : 'fractional';
    renderRiskCalculator();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#profit-modal')?.classList.add('hidden');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#profit-modal')?.classList.add('hidden');
    }
  });
  $('#risk-rounding-select')?.addEventListener('change', (e) => {
    state.rounding = e.target.value === 'whole' ? 'whole' : 'fractional';
    renderRiskCalculator();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#profit-modal')?.classList.add('hidden');
    }
  });
}

if (typeof module !== 'undefined') {
  module.exports = { computeRiskPlan, summarizeWeek };
}

if (typeof module !== 'undefined') {
  module.exports = { computeRiskPlan, summarizeWeek };
}

if (typeof module !== 'undefined') {
  module.exports = { computeRiskPlan, summarizeWeek };
}

if (typeof module !== 'undefined') {
  module.exports = { computeRiskPlan, summarizeWeek };
}

async function init() {
  state.selected = startOfMonth(new Date());
  bindControls();
  updatePeriodSelect();
  setActiveView();
  try {
    await loadRates();
  } catch (e) {
    console.warn(e);
  }
  await loadData();
  render();
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', init);
}
