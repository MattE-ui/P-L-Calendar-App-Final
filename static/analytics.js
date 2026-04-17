const charts = {};
const chartRenderCache = {};

const state = {
  filters: {
    from: '',
    to: '',
    symbol: '',
    tradeType: '',
    assetClass: '',
    strategyTag: '',
    tags: '',
    winLoss: ''
  },
  currency: 'GBP',
  rates: { GBP: 1 },
  account: {
    portfolioValue: 0,
    netDeposits: 0,
    netPerformance: 0,
    returnPct: 0
  },
  heatmap: {
    selectedMonth: '',
    monthKeys: []
  }
};

const currencySymbols = { GBP: '£', USD: '$', EUR: '€' };

function getThemeColor(token, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || fallback;
}

const CHART_THEME = {
  accent: () => getThemeColor('--accent', '#0BBF7A'),
  info: () => getThemeColor('--info', '#4F8CFF'),
  danger: () => getThemeColor('--danger', '#FF5C5C'),
  warning: () => getThemeColor('--highlight', '#E4B84C'),
  grid: () => getThemeColor('--border-soft', 'rgba(255,255,255,0.06)'),
  ticks: () => getThemeColor('--text-dim', '#7F8A9A'),
  accentSoft: () => getThemeColor('--accent-soft', 'rgba(11,191,122,0.14)')
};

const isGuestSession = () => (sessionStorage.getItem('guestMode') === 'true'
  || localStorage.getItem('guestMode') === 'true')
  && typeof window.handleGuestRequest === 'function';
const clearGuestMode = () => {
  sessionStorage.removeItem('guestMode');
  localStorage.removeItem('guestMode');
};

async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  if (isGuestSession()) {
    return window.handleGuestRequest(path, opts);
  }
  const res = await fetch(path, { credentials: 'include', ...opts });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    if (data?.error && data.error.includes('Guest session expired')) {
      window.location.href = '/login.html?expired=guest';
    } else {
      window.location.href = '/login.html';
    }
    return {};
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.data = data;
    throw err;
  }
  if (!isGuestSession()) {
    clearGuestMode();
  }
  return data;
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
  const sign = valueGBP < 0 ? '-' : '';
  return `${sign}${currencySymbols[currency]}${amount.toFixed(2)}`;
}

function toQuery(params = {}) {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!parts.length) return '';
  return '?' + parts.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  if (num === 0) return '0.00%';
  const normalized = Math.abs(num) <= 1 ? num * 100 : num;
  const sign = normalized < 0 ? '-' : '';
  return `${sign}${Math.abs(normalized).toFixed(2)}%`;
}

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return formatSignedCurrency(num);
}

function setMetricTrend(el, value) {
  if (!el) return;
  window.ThemeUtils?.applyPnlColorClass(el, value);
}

function formatRangeDate(date) {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getPresetRange(key) {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  if (key === '1w') start.setDate(end.getDate() - 6);
  else if (key === '1m') start.setMonth(end.getMonth() - 1);
  else if (key === '3m') start.setMonth(end.getMonth() - 3);
  else if (key === 'ytd') start.setMonth(0, 1);
  else if (key === '1y') start.setFullYear(end.getFullYear() - 1);
  else if (key === 'all') return { from: '', to: '' };
  else return null;
  const toISO = d => d.toISOString().slice(0, 10);
  return { from: toISO(start), to: toISO(end) };
}

function updateFilterChips() {
  const chipHost = document.querySelector('#active-filter-chips');
  if (!chipHost) return;
  const filterLabels = {
    from: 'From', to: 'To', symbol: 'Symbol', tradeType: 'Type',
    assetClass: 'Asset', strategyTag: 'Strategy', tags: 'Tags', winLoss: 'Result'
  };
  const entries = Object.entries(state.filters).filter(([, value]) => value);
  chipHost.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('span');
    empty.className = 'pill';
    empty.textContent = 'No active filters';
    chipHost.appendChild(empty);
    return;
  }
  entries.forEach(([key, value]) => {
    const chip = document.createElement('span');
    chip.className = 'pill active-filter-chip';
    chip.textContent = `${filterLabels[key] || key}: ${value}`;
    chipHost.appendChild(chip);
  });
}

function setFilterPanel(open) {
  const panel = document.querySelector('#analytics-filter-panel');
  const toggle = document.querySelector('#filter-toggle-btn');
  if (!panel || !toggle) return;
  panel.classList.toggle('hidden', !open);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.textContent = open ? 'Hide Filters' : 'Filters';
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

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
    delete chartRenderCache[id];
  }
}

function showEmptyState(id, message) {
  const el = document.getElementById(id);
  if (!el) return false;
  if (!message) {
    el.dataset.empty = '';
    return false;
  }
  const container = el.parentElement;
  if (container) {
    const existing = container.querySelector('.chart-empty');
    if (existing) existing.remove();
    const note = document.createElement('p');
    note.className = 'tool-note chart-empty';
    note.textContent = message;
    container.appendChild(note);
  }
  return true;
}

function renderChart(id, config) {
  const cacheKey = JSON.stringify({ type: config?.type, data: config?.data, options: config?.options });
  if (chartRenderCache[id] === cacheKey && charts[id]) return;
  destroyChart(id);
  chartRenderCache[id] = cacheKey;
  if (config?.options?.scales) {
    Object.values(config.options.scales).forEach(scale => {
      if (!scale) return;
      scale.grid = { ...(scale.grid || {}), color: CHART_THEME.grid() };
      scale.ticks = { ...(scale.ticks || {}), color: CHART_THEME.ticks() };
      scale.border = { ...(scale.border || {}), color: CHART_THEME.grid() };
    });
  }
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const parent = ctx.parentElement;
  if (parent) {
    parent.querySelectorAll('.chart-empty').forEach(el => el.remove());
  }
  charts[id] = new Chart(ctx, config);
}

async function loadHeroMetrics() {
  try {
    const res = await api('/api/portfolio');
    const portfolio = Number(res?.portfolioValue ?? res?.portfolio);
    const netDeposits = Number(res?.netDepositsTotal);
    const portfolioValue = Number.isFinite(portfolio) ? portfolio : 0;
    const netDepositsValue = Number.isFinite(netDeposits) ? netDeposits : 0;
    const netPerformance = portfolioValue - netDepositsValue;
    await loadRates();
    const netPerfPct = netDepositsValue ? (netPerformance / Math.abs(netDepositsValue)) * 100 : 0;
    state.account = {
      portfolioValue,
      netDeposits: netDepositsValue,
      netPerformance,
      returnPct: netPerfPct
    };
    const altCurrency = state.currency === 'GBP'
      ? (state.rates.USD ? 'USD' : (state.rates.EUR ? 'EUR' : null))
      : 'GBP';
    const portfolioEl = document.getElementById('header-portfolio-value');
    if (portfolioEl) portfolioEl.textContent = formatCurrency(portfolioValue);
    const portfolioSub = document.getElementById('header-portfolio-sub');
    if (portfolioSub) {
      const altValue = altCurrency ? formatCurrency(portfolioValue, altCurrency) : '—';
      portfolioSub.textContent = altCurrency && altValue !== '—' ? `≈ ${altValue}` : '';
    }
    const netDepositsEl = document.getElementById('hero-net-deposits-value');
    if (netDepositsEl) netDepositsEl.textContent = formatSignedCurrency(netDepositsValue);
    const netDepositsSub = document.getElementById('hero-net-deposits-sub');
    if (netDepositsSub) {
      const altDeposits = altCurrency ? formatSignedCurrency(netDepositsValue, altCurrency) : '—';
      netDepositsSub.textContent = altCurrency && altDeposits !== '—' ? `≈ ${altDeposits}` : '';
    }
    const netPerfEl = document.getElementById('hero-net-performance-value');
    if (netPerfEl) netPerfEl.textContent = formatSignedCurrency(netPerformance);
    const netPerfSub = document.getElementById('hero-net-performance-sub');
    if (netPerfSub) {
      const pieces = [];
      if (altCurrency) {
        const altPerf = formatSignedCurrency(netPerformance, altCurrency);
        if (altPerf !== '—') pieces.push(`≈ ${altPerf}`);
      }
      pieces.push(formatPercent(netPerfPct));
      netPerfSub.textContent = pieces.join(' • ');
    }
    setMetricTrend(document.getElementById('hero-net-performance'), netPerformance);

    const returnPctEl = document.getElementById('kpi-return-pct');
    if (returnPctEl) returnPctEl.textContent = formatPercent(netPerfPct);
    setMetricTrend(document.getElementById('hero-return-card'), netPerfPct);

    const portfolioCard = document.getElementById('hero-portfolio');
    if (portfolioCard) {
      setMetricTrend(portfolioCard, portfolioValue - netDepositsValue);
    }
    const netDepositsCard = document.getElementById('hero-net-deposits');
    if (netDepositsCard) {
      netDepositsCard.classList.remove('positive', 'negative');
    }
  } catch (e) {
    console.warn('Failed to load hero metrics', e);
  }
}

function readFilters() {
  state.filters = {
    from: document.querySelector('#filter-from')?.value || '',
    to: document.querySelector('#filter-to')?.value || '',
    symbol: document.querySelector('#filter-symbol')?.value || '',
    tradeType: document.querySelector('#filter-trade-type')?.value || '',
    assetClass: document.querySelector('#filter-asset-class')?.value || '',
    strategyTag: document.querySelector('#filter-strategy')?.value || '',
    tags: document.querySelector('#filter-tags')?.value || '',
    winLoss: document.querySelector('#filter-winloss')?.value || ''
  };
}

function updateKpis(summary, dist, dd, streaks) {
  document.querySelector('#kpi-win-rate').textContent = formatPercent(summary.winRate);
  document.querySelector('#kpi-loss-rate').textContent = formatPercent(summary.lossRate);
  document.querySelector('#kpi-avg-win').textContent = formatNumber(summary.avgWin);
  document.querySelector('#kpi-avg-loss').textContent = formatNumber(summary.avgLoss);
  document.querySelector('#kpi-expectancy').textContent = formatNumber(summary.expectancy);

  const pf = Number(summary.profitFactor);
  const pfDisplay = Number.isFinite(pf) && pf > 0 ? pf.toFixed(2) : '—';
  const pfPrimary = document.querySelector('#kpi-profit-factor-primary');
  if (pfPrimary) pfPrimary.textContent = pfDisplay;
  const pfSecondary = document.querySelector('#kpi-profit-factor');
  if (pfSecondary) pfSecondary.textContent = pfDisplay;

  document.querySelector('#kpi-r-multiple').textContent = summary.avgR !== null ? Number(summary.avgR || 0).toFixed(2) : '—';
  document.querySelector('#kpi-drawdown').textContent = formatNumber(dd.maxDrawdown || 0);
  document.querySelector('#kpi-drawdown-duration').textContent = dd.durationDays || 0;

  const returnPctEl = document.querySelector('#kpi-return-pct');
  const accountReturnPct = Number(state.account?.returnPct);
  const resolvedReturn = Number.isFinite(accountReturnPct) ? accountReturnPct : Number(summary.returnPct);
  if (returnPctEl) returnPctEl.textContent = Number.isFinite(resolvedReturn) ? formatPercent(resolvedReturn) : 'N/A';
  setMetricTrend(document.querySelector('#hero-return-card'), Number.isFinite(resolvedReturn) ? resolvedReturn : 0);
  setMetricTrend(document.querySelector('#hero-net-performance'), Number(state.account?.netPerformance) || 0);

  document.querySelector('#snapshot-best-streak').textContent = streaks.maxWinStreak || 0;
  document.querySelector('#snapshot-worst-streak').textContent = streaks.maxLossStreak || 0;
  document.querySelector('#snapshot-closed-trades').textContent = summary.closedTrades || summary.total || 0;
  document.querySelector('#snapshot-median').textContent = formatNumber(dist.median || 0);
  document.querySelector('#snapshot-stddev').textContent = dist.stddev !== null ? formatNumber(dist.stddev) : '—';
}

function renderEquityCurve(curve = []) {
  const latestEl = document.querySelector('#equity-latest-value');
  const emptyNote = document.querySelector('#equity-empty-note');
  if (!curve.length) {
    showEmptyState('equity-chart', 'No equity data yet.');
    if (latestEl) latestEl.textContent = '—';
    if (emptyNote) emptyNote.classList.remove('is-hidden');
    return;
  }
  if (emptyNote) emptyNote.classList.add('is-hidden');
  const labels = curve.map(p => p.date);
  const values = curve.map(p => p.cumulative);
  if (latestEl) {
    const latest = values[values.length - 1];
    latestEl.textContent = formatNumber(latest);
  }
  const gradient = (() => {
    const ctx = document.getElementById('equity-chart')?.getContext('2d');
    if (!ctx) return CHART_THEME.accentSoft();
    const g = ctx.createLinearGradient(0, 0, 0, 320);
    g.addColorStop(0, 'rgba(11,191,122,0.26)');
    g.addColorStop(1, 'rgba(11,191,122,0.02)');
    return g;
  })();
  renderChart('equity-chart', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Equity (GBP)',
        data: values,
        tension: 0.24,
        borderColor: CHART_THEME.accent(),
        borderWidth: 2.4,
        pointRadius: values.length < 60 ? 2 : 0,
        pointHoverRadius: 4,
        pointBackgroundColor: CHART_THEME.accent(),
        fill: true,
        backgroundColor: gradient
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { display: true, ticks: { maxTicksLimit: 8 } },
        y: { display: true, ticks: { callback: v => formatNumber(v) } }
      }
    }
  });
}

function renderDrawdown(drawdown = {}) {
  if (!drawdown.series || !drawdown.series.length) {
    showEmptyState('drawdown-chart', 'No drawdown data yet.');
    return;
  }
  const labels = (drawdown.series || []).map(p => p.date);
  const values = (drawdown.series || []).map(p => p.drawdown);
  renderChart('drawdown-chart', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Drawdown (GBP)',
        data: values,
        borderColor: CHART_THEME.danger(),
        backgroundColor: 'rgba(255,92,92,0.18)',
        fill: true,
        tension: 0.24
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { maxTicksLimit: 7 } }, y: { ticks: { callback: v => formatNumber(v) } } }
    }
  });
}

function renderDistribution(dist = {}) {
  if (!dist.histogram || !dist.histogram.length) {
    showEmptyState('distribution-chart', 'No trades to chart.');
    return;
  }
  const labels = (dist.histogram || []).map(b => `${Number(b.start || 0).toFixed(0)} → ${Number(b.end || 0).toFixed(0)}`);
  const values = (dist.histogram || []).map(b => b.count || 0);
  renderChart('distribution-chart', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Trades',
        data: values,
        backgroundColor: CHART_THEME.info()
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 8 } }, y: { beginAtZero: true } }
    }
  });
}


function normalizeCategoryLabel(raw) {
  if (raw === null || raw === undefined || raw === '') return 'Unspecified';
  const value = String(raw).trim();
  if (!value) return 'Unspecified';
  const presets = {
    scalp: 'Scalp',
    day: 'Day',
    swing: 'Swing',
    position: 'Position',
    unknown: 'Unspecified',
    none: 'Unspecified'
  };
  if (presets[value.toLowerCase()]) return presets[value.toLowerCase()];
  return value;
}

function renderSparseBreakdownSummary(canvasId, entries, isPct) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const frame = canvas.closest('.chart-frame');
  const card = canvas.closest('.chart-card');
  if (!frame || !card) return;
  frame.classList.add('hidden');
  let host = card.querySelector('.category-summary');
  if (!host) {
    host = document.createElement('div');
    host.className = 'category-summary';
    card.appendChild(host);
  }
  host.innerHTML = '';
  entries.forEach(([label, rawValue]) => {
    const value = Number(rawValue) || 0;
    const row = document.createElement('div');
    row.className = `category-summary-row ${value > 0 ? 'positive' : value < 0 ? 'negative' : ''}`;

    const name = document.createElement('span');
    name.className = 'category-name';
    name.textContent = normalizeCategoryLabel(label);

    const num = document.createElement('strong');
    num.textContent = isPct ? formatPercent(value) : formatNumber(value);

    const meter = document.createElement('div');
    meter.className = 'category-meter';
    const fill = document.createElement('div');
    fill.className = 'category-meter-fill';
    fill.style.width = `${Math.max(8, Math.min(100, Math.abs(value)))}%`;
    meter.appendChild(fill);

    row.append(name, num, meter);
    host.appendChild(row);
  });
}

function clearSparseBreakdownSummary(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const frame = canvas.closest('.chart-frame');
  const card = canvas.closest('.chart-card');
  frame?.classList.remove('hidden');
  card?.querySelector('.category-summary')?.remove();
}

function renderBreakdown(canvasId, dataObj = {}, label) {
  const entries = Object.entries(dataObj || {});
  clearSparseBreakdownSummary(canvasId);
  if (!entries.length) {
    showEmptyState(canvasId, 'No data for current filters.');
    return;
  }
  const isPct = (label || '').toLowerCase().includes('win');
  const sortedEntries = entries
    .map(([k, v]) => [normalizeCategoryLabel(k), Number(v) || 0])
    .sort((a, b) => b[1] - a[1]);

  if (sortedEntries.length <= 2) {
    destroyChart(canvasId);
    renderSparseBreakdownSummary(canvasId, sortedEntries, isPct);
    return;
  }

  const labels = sortedEntries.map(([k]) => k);
  const values = sortedEntries.map(([, v]) => v);
  renderChart(canvasId, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: label || '',
        data: values,
        borderRadius: 6,
        barThickness: 12,
        maxBarThickness: 14,
        backgroundColor: values.map(v => (v >= 0 ? CHART_THEME.accent() : CHART_THEME.danger()))
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { callback: v => (isPct ? `${Number(v).toFixed(0)}%` : formatNumber(v)) } },
        y: { ticks: { autoSkip: false } }
      }
    }
  });
}

function percentile(values = [], p = 0.9) {
  if (!Array.isArray(values) || !values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx] || 0;
}

function normalizeWeekday(dateStr = '') {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  return (day + 6) % 7;
}

function monthKeyToIndex(monthKey = '') {
  const [year, month] = monthKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return Number.NaN;
  return (year * 12) + (month - 1);
}

function deriveFilterMonthKey(filters = {}) {
  const candidate = filters.to || filters.from;
  if (!candidate) return '';
  return candidate.slice(0, 7);
}

function resolveHeatmapMonth(monthKeys = [], preferredMonth = '', fallbackMonth = '') {
  if (!monthKeys.length) return '';
  if (preferredMonth && monthKeys.includes(preferredMonth)) return preferredMonth;
  if (preferredMonth) {
    const preferredIdx = monthKeyToIndex(preferredMonth);
    if (Number.isFinite(preferredIdx)) {
      return monthKeys.reduce((closest, key) => {
        const idx = monthKeyToIndex(key);
        if (!Number.isFinite(idx)) return closest;
        if (!closest) return key;
        const closestDiff = Math.abs(monthKeyToIndex(closest) - preferredIdx);
        const diff = Math.abs(idx - preferredIdx);
        return diff < closestDiff ? key : closest;
      }, '');
    }
  }
  if (fallbackMonth && monthKeys.includes(fallbackMonth)) return fallbackMonth;
  return monthKeys[monthKeys.length - 1];
}

function syncHeatmapControls(monthKeys = [], activeMonth = '', lockSelection = false) {
  const monthSelect = document.querySelector('#heatmap-month-select');
  const prevBtn = document.querySelector('#heatmap-prev-month');
  const nextBtn = document.querySelector('#heatmap-next-month');
  if (!monthSelect || !prevBtn || !nextBtn) return;

  monthSelect.innerHTML = '';
  monthKeys.forEach(monthKey => {
    const [year, month] = monthKey.split('-').map(Number);
    const option = document.createElement('option');
    option.value = monthKey;
    option.textContent = new Date(year, month - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
    monthSelect.appendChild(option);
  });

  const hasMonths = monthKeys.length > 0;
  monthSelect.disabled = !hasMonths || lockSelection;
  if (hasMonths) monthSelect.value = activeMonth;

  const activeIndex = monthKeys.indexOf(activeMonth);
  prevBtn.disabled = lockSelection || !hasMonths || activeIndex <= 0;
  nextBtn.disabled = lockSelection || !hasMonths || activeIndex < 0 || activeIndex >= monthKeys.length - 1;
}

function formatHeatmapTooltip(dayData = {}, modeLabel = 'PnL') {
  const lines = [`${formatRangeDate(dayData.date)} • ${modeLabel}: ${formatNumber(dayData.value)}`];
  if (Number.isFinite(dayData.tradeCount)) lines.push(`Trades: ${dayData.tradeCount}`);
  if (Number.isFinite(dayData.winRate)) lines.push(`Win rate: ${dayData.winRate.toFixed(1)}%`);
  if (Number.isFinite(dayData.bestTrade)) lines.push(`Best trade: ${formatNumber(dayData.bestTrade)}`);
  if (Number.isFinite(dayData.worstTrade)) lines.push(`Worst trade: ${formatNumber(dayData.worstTrade)}`);
  return lines.join('\n');
}

function getDirectionalIntensity(value, monthStats) {
  const sign = value > 0 ? 'positive' : value < 0 ? 'negative' : 'flat';
  if (!Number.isFinite(value)) return { sign: 'no-data', scale: 0, alpha: 0.08 };
  if (sign === 'flat') return { sign: 'flat', scale: 0, alpha: 0.1 };

  const maxScale = sign === 'positive' ? monthStats.maxPositive : monthStats.maxNegative;
  if (!maxScale) return { sign, scale: 0.28, alpha: 0.26 };

  const normalized = Math.min(1, Math.max(0, Math.abs(value) / maxScale));
  const shaped = Math.pow(normalized, 0.68);
  const minVisible = 0.24;
  const scale = minVisible + (shaped * (1 - minVisible));
  return {
    sign,
    scale,
    alpha: 0.2 + (scale * 0.6)
  };
}

function buildMonthNormalization(days = []) {
  const positives = days.map(day => day.value).filter(v => v > 0);
  const negatives = days.map(day => Math.abs(day.value)).filter(v => v > 0);
  return {
    maxPositive: percentile(positives, 0.9) || Math.max(...positives, 0),
    maxNegative: percentile(negatives, 0.9) || Math.max(...negatives, 0)
  };
}

function renderHeatmap(curve = [], options = {}) {
  const grid = document.querySelector('#heatmap-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const modeLabel = options.modeLabel || 'PnL';
  const valueAccessor = options.valueAccessor || (point => point.pnl);
  state.heatmap.lastCurve = curve;
  state.heatmap.lastOptions = options;

  const byDate = {};
  curve.forEach(point => {
    if (!point.date) return;
    if (!byDate[point.date]) {
      byDate[point.date] = {
        date: point.date,
        value: 0,
        tradeCount: 0,
        winCount: 0,
        bestTrade: Number.NEGATIVE_INFINITY,
        worstTrade: Number.POSITIVE_INFINITY
      };
    }
    const value = Number(valueAccessor(point)) || 0;
    byDate[point.date].value += value;
    if (Number.isFinite(point.tradeCount)) byDate[point.date].tradeCount += point.tradeCount;
    if (Number.isFinite(point.winCount)) byDate[point.date].winCount += point.winCount;
    if (Number.isFinite(point.bestTrade)) byDate[point.date].bestTrade = Math.max(byDate[point.date].bestTrade, point.bestTrade);
    if (Number.isFinite(point.worstTrade)) byDate[point.date].worstTrade = Math.min(byDate[point.date].worstTrade, point.worstTrade);
  });
  const entries = Object.values(byDate)
    .map(day => ({
      ...day,
      winRate: day.tradeCount > 0 ? (day.winCount / day.tradeCount) * 100 : null,
      bestTrade: Number.isFinite(day.bestTrade) ? day.bestTrade : null,
      worstTrade: Number.isFinite(day.worstTrade) ? day.worstTrade : null
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!entries.length) {
    const note = document.createElement('p');
    note.className = 'tool-note';
    note.textContent = 'No monthly data yet.';
    grid.appendChild(note);
    document.querySelector('#snapshot-best-day').textContent = '—';
    document.querySelector('#snapshot-worst-day').textContent = '—';
    state.heatmap.monthKeys = [];
    state.heatmap.selectedMonth = '';
    syncHeatmapControls([], '');
    return;
  }

  let best = entries[0];
  let worst = entries[0];
  const monthBuckets = new Map();

  entries.forEach(day => {
    if (day.value > best.value) best = day;
    if (day.value < worst.value) worst = day;
    const monthKey = day.date.slice(0, 7);
    if (!monthBuckets.has(monthKey)) monthBuckets.set(monthKey, []);
    monthBuckets.get(monthKey).push(day);
  });

  const monthKeys = [...monthBuckets.keys()].sort();
  const filterMonth = deriveFilterMonthKey(state.filters);
  const followsFilter = Boolean(filterMonth);
  const activeMonth = resolveHeatmapMonth(monthKeys, filterMonth, state.heatmap.selectedMonth);
  state.heatmap.monthKeys = monthKeys;
  state.heatmap.selectedMonth = activeMonth;
  syncHeatmapControls(monthKeys, activeMonth, followsFilter);

  const monthData = monthBuckets.get(activeMonth) || [];
  const [year, month] = activeMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDate = `${activeMonth}-01`;
  const monthStats = buildMonthNormalization(monthData);

  const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const section = document.createElement('section');
  section.className = 'heatmap-month';

  const title = document.createElement('h4');
  title.className = 'heatmap-month-title';
  title.textContent = new Date(year, month - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
  section.appendChild(title);

  const weekdayRow = document.createElement('div');
  weekdayRow.className = 'heatmap-weekdays';
  weekdayLabels.forEach(label => {
    const dayHead = document.createElement('span');
    dayHead.textContent = label;
    weekdayRow.appendChild(dayHead);
  });
  section.appendChild(weekdayRow);

  const monthGrid = document.createElement('div');
  monthGrid.className = 'heatmap-month-grid';
  const leadBlanks = normalizeWeekday(firstDate);
  for (let i = 0; i < leadBlanks; i += 1) {
    const blank = document.createElement('div');
    blank.className = 'heatmap-day heatmap-day-empty';
    monthGrid.appendChild(blank);
  }

  const monthDataByDay = new Map(monthData.map(day => [day.date, day]));

  for (let dayNum = 1; dayNum <= daysInMonth; dayNum += 1) {
    const isoDate = `${activeMonth}-${String(dayNum).padStart(2, '0')}`;
    const dayData = monthDataByDay.get(isoDate);
    if (!dayData) {
      const empty = document.createElement('div');
      empty.className = 'heatmap-day heatmap-day-no-data';
      empty.innerHTML = `<div class="date">${dayNum}</div><div class="value">No data</div>`;
      monthGrid.appendChild(empty);
      continue;
    }

    const card = document.createElement('button');
    card.type = 'button';
    const intensity = getDirectionalIntensity(dayData.value, monthStats);
    card.className = `heatmap-day ${intensity.sign}`;
    card.style.setProperty('--heat-strength', intensity.scale.toFixed(4));
    card.style.setProperty('--heat-alpha', intensity.alpha.toFixed(4));
    card.title = formatHeatmapTooltip(dayData, modeLabel);

    const dateEl = document.createElement('div');
    dateEl.className = 'date';
    dateEl.textContent = dayNum;
    const valueEl = document.createElement('div');
    valueEl.className = 'value';
    valueEl.textContent = dayData.value === 0 ? 'Flat' : formatNumber(dayData.value);

    card.append(dateEl, valueEl);
    monthGrid.appendChild(card);
  }

  section.appendChild(monthGrid);
  grid.appendChild(section);

  document.querySelector('#snapshot-best-day').textContent = `${formatRangeDate(best.date)} • ${formatNumber(best.value)}`;
  document.querySelector('#snapshot-worst-day').textContent = `${formatRangeDate(worst.date)} • ${formatNumber(worst.value)}`;
}


async function refreshAnalytics() {
  readFilters();
  const query = toQuery(state.filters);
  const rangeText = [];
  if (state.filters.from) rangeText.push(`From ${formatRangeDate(state.filters.from)}`);
  if (state.filters.to) rangeText.push(`to ${formatRangeDate(state.filters.to)}`);
  document.querySelector('#analytics-range').textContent = rangeText.join(' ') || 'All time';
  updateFilterChips();

  const [summary, equityRes, drawdownRes, distRes, streakRes] = await Promise.all([
    api(`/api/analytics/summary${query}`),
    api(`/api/analytics/equity-curve${query}`),
    api(`/api/analytics/drawdown${query}`),
    api(`/api/analytics/distribution${query}`),
    api(`/api/analytics/streaks${query}`),
  ]);

  updateKpis(summary.summary || {}, distRes.distribution || {}, drawdownRes.drawdown || {}, streakRes.streaks || {});
  renderEquityCurve(equityRes.curve || []);
  renderDrawdown(drawdownRes.drawdown || {});
  renderDistribution(distRes.distribution || {});
  renderBreakdown('type-chart', summary.breakdowns?.pnlByType, 'P&L');
  renderBreakdown('strategy-chart', summary.breakdowns?.pnlByStrategy, 'P&L');
  renderBreakdown('winrate-type-chart', summary.breakdowns?.winRateByType, 'Win rate');
  renderHeatmap((equityRes.curve || []).map((point, idx, arr) => {
    const prev = arr[idx - 1];
    const prevCum = prev ? prev.cumulative : 0;
    return { date: point.date, pnl: point.cumulative - prevCum };
  }), { mode: 'pnl', modeLabel: 'PnL', valueAccessor: point => point.pnl });
}

function resetFilters() {
  document.querySelector('#filter-from').value = '';
  document.querySelector('#filter-to').value = '';
  document.querySelector('#filter-symbol').value = '';
  document.querySelector('#filter-trade-type').value = '';
  document.querySelector('#filter-asset-class').value = '';
  document.querySelector('#filter-strategy').value = '';
  document.querySelector('#filter-tags').value = '';
  document.querySelector('#filter-winloss').value = '';
  state.filters = {
    from: '', to: '', symbol: '', tradeType: '', assetClass: '', strategyTag: '', tags: '', winLoss: ''
  };
  if (window?.history?.replaceState) {
    history.replaceState(null, '', location.pathname);
  }
  refreshAnalytics().catch(console.error);
}

function bindNav() {
  document.addEventListener('app-menu:open-quick-settings', () => {
    const modal = document.querySelector('#quick-settings-modal');
    const riskSel = document.querySelector('#qs-risk-select');
    const curSel = document.querySelector('#qs-currency-select');
    const applyPrefs = prefs => {
      if (riskSel && Number.isFinite(prefs?.defaultRiskPct)) riskSel.value = String(prefs.defaultRiskPct);
      if (curSel && prefs?.defaultRiskCurrency) curSel.value = prefs.defaultRiskCurrency;
    };
    try {
      const saved = localStorage.getItem('plc-prefs');
      if (saved) {
        applyPrefs(JSON.parse(saved));
      }
    } catch (e) {
      console.warn(e);
    }
    if (!isGuestSession()) {
      api('/api/prefs')
        .then(applyPrefs)
        .catch(err => console.warn('Failed to load ui prefs', err));
    }
  });
  const closeQs = () => document.querySelector('#quick-settings-modal')?.classList.add('hidden');
  document.querySelector('#close-qs-btn')?.addEventListener('click', closeQs);
  document.querySelector('#save-qs-btn')?.addEventListener('click', () => {
    const riskSel = document.querySelector('#qs-risk-select');
    const curSel = document.querySelector('#qs-currency-select');
    const pct = Number(riskSel?.value);
    const cur = curSel?.value;
    const prefs = {};
    if (Number.isFinite(pct) && pct > 0) prefs.defaultRiskPct = pct;
    if (cur && ['GBP', 'USD', 'EUR'].includes(cur)) prefs.defaultRiskCurrency = cur;
    try {
      localStorage.setItem('plc-prefs', JSON.stringify(prefs));
    } catch (e) {
      console.warn(e);
    }
    if (!isGuestSession()) {
      api('/api/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs)
      }).catch(err => console.warn('Failed to save ui prefs', err));
    }
    closeQs();
  });
  api('/api/profile')
    .then(profile => {
      const show = profile?.username === 'mevs.0404@gmail.com' || profile?.username === 'dummy1';
      document.querySelectorAll('[data-app-menu-item-id=\"devtools\"]').forEach(btn => btn.classList.toggle('is-hidden', !show));
    })
    .catch(() => {
      document.querySelectorAll('[data-app-menu-item-id=\"devtools\"]').forEach(btn => btn.classList.add('is-hidden'));
    });
}

function bindFilters() {
  document.querySelector('#apply-filters-btn')?.addEventListener('click', () => refreshAnalytics().catch(console.error));
  document.querySelector('#reset-filters-btn')?.addEventListener('click', resetFilters);

  document.querySelector('#filter-toggle-btn')?.addEventListener('click', () => {
    const panel = document.querySelector('#analytics-filter-panel');
    const open = panel?.classList.contains('hidden');
    setFilterPanel(Boolean(open));
  });

  document.querySelectorAll('.range-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const range = getPresetRange(btn.dataset.range);
      if (!range) return;
      document.querySelector('#filter-from').value = range.from;
      document.querySelector('#filter-to').value = range.to;
      refreshAnalytics().catch(console.error);
      document.querySelectorAll('.range-preset').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function bindHeatmapControls() {
  const monthSelect = document.querySelector('#heatmap-month-select');
  const prevBtn = document.querySelector('#heatmap-prev-month');
  const nextBtn = document.querySelector('#heatmap-next-month');

  monthSelect?.addEventListener('change', () => {
    if (!monthSelect.value) return;
    state.heatmap.selectedMonth = monthSelect.value;
    renderHeatmap(state.heatmap.lastCurve || [], state.heatmap.lastOptions || {});
  });

  prevBtn?.addEventListener('click', () => {
    const idx = state.heatmap.monthKeys.indexOf(state.heatmap.selectedMonth);
    if (idx <= 0) return;
    state.heatmap.selectedMonth = state.heatmap.monthKeys[idx - 1];
    renderHeatmap(state.heatmap.lastCurve || [], state.heatmap.lastOptions || {});
  });

  nextBtn?.addEventListener('click', () => {
    const idx = state.heatmap.monthKeys.indexOf(state.heatmap.selectedMonth);
    if (idx < 0 || idx >= state.heatmap.monthKeys.length - 1) return;
    state.heatmap.selectedMonth = state.heatmap.monthKeys[idx + 1];
    renderHeatmap(state.heatmap.lastCurve || [], state.heatmap.lastOptions || {});
  });
}

function init() {
  bindNav();
  bindFilters();
  bindHeatmapControls();
  loadHeroMetrics();
  setFilterPanel(false);
  refreshAnalytics().catch(console.error);
}

window.addEventListener('DOMContentLoaded', init);
