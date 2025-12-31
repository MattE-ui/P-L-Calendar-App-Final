const charts = {};

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
  }
};

const currencySymbols = { GBP: '£', USD: '$', EUR: '€' };

async function api(path, opts = {}) {
  const isGuest = sessionStorage.getItem('guestMode') === 'true' || localStorage.getItem('guestMode') === 'true';
  const method = (opts.method || 'GET').toUpperCase();
  if (isGuest && typeof window.handleGuestRequest === 'function') {
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
  return data;
}

function formatCurrency(value, currency = 'GBP') {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const symbol = currencySymbols[currency] || '£';
  return `${symbol}${num.toFixed(2)}`;
}

function formatSignedCurrency(value, currency = 'GBP') {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const symbol = currencySymbols[currency] || '£';
  const sign = num < 0 ? '-' : '';
  return `${sign}${symbol}${Math.abs(num).toFixed(2)}`;
}

function toQuery(params = {}) {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!parts.length) return '';
  return '?' + parts.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  return `${(Number(value) * 100 || 0).toFixed(1)}%`;
}

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `£${num.toFixed(2)}`;
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
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
  destroyChart(id);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const parent = ctx.parentElement;
  if (parent) {
    parent.querySelectorAll('.chart-empty').forEach(el => el.remove());
  }
  charts[id] = new Chart(ctx, config);
}

function setupNavDrawer() {
  const navToggle = document.getElementById('nav-toggle-btn');
  const navDrawer = document.getElementById('nav-drawer');
  const navOverlay = document.getElementById('nav-drawer-overlay');
  const navClose = document.getElementById('nav-close-btn');
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
  return setNavOpen;
}

async function loadHeroMetrics() {
  try {
    const res = await api('/api/portfolio');
    const portfolio = Number(res?.portfolio);
    const netDeposits = Number(res?.netDepositsTotal);
    const portfolioValue = Number.isFinite(portfolio) ? portfolio : 0;
    const netDepositsValue = Number.isFinite(netDeposits) ? netDeposits : 0;
    const netPerformance = portfolioValue - netDepositsValue;
    const netPerfPct = netDepositsValue ? netPerformance / Math.abs(netDepositsValue) : 0;
    const portfolioEl = document.getElementById('header-portfolio-value');
    if (portfolioEl) portfolioEl.textContent = formatCurrency(portfolioValue);
    const netDepositsEl = document.getElementById('hero-net-deposits-value');
    if (netDepositsEl) netDepositsEl.textContent = formatSignedCurrency(netDepositsValue);
    const netPerfEl = document.getElementById('hero-net-performance-value');
    if (netPerfEl) netPerfEl.textContent = formatSignedCurrency(netPerformance);
    const netPerfSub = document.getElementById('hero-net-performance-sub');
    if (netPerfSub) netPerfSub.textContent = formatPercent(netPerfPct);
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
  document.querySelector('#kpi-profit-factor').textContent = summary.profitFactor ? summary.profitFactor.toFixed(2) : '—';
  const pfSecondary = document.querySelector('#kpi-profit-factor-secondary');
  if (pfSecondary) {
    pfSecondary.textContent = summary.profitFactor ? summary.profitFactor.toFixed(2) : '—';
  }
  document.querySelector('#kpi-r-multiple').textContent = summary.avgR !== null ? summary.avgR.toFixed(2) : '—';
  document.querySelector('#kpi-drawdown').textContent = formatNumber(dd.maxDrawdown || 0);
  document.querySelector('#kpi-drawdown-duration').textContent = dd.durationDays || 0;
  document.querySelector('#kpi-median').textContent = `${formatNumber(dist.median || 0)} median`;
  document.querySelector('#kpi-stddev').textContent = dist.stddev !== null ? formatNumber(dist.stddev) : '—';
  document.querySelector('#kpi-streaks').textContent = `${streaks.maxWinStreak || 0}W / ${streaks.maxLossStreak || 0}L`;
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
  renderChart('equity-chart', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Equity (GBP)',
        data: values,
        tension: 0.2,
        borderColor: '#4fb7ff',
        fill: false
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { display: true }, y: { display: true } }
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
        borderColor: '#ff5a8f',
        backgroundColor: 'rgba(255,90,143,0.25)',
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: v => formatNumber(v) } } }
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
        backgroundColor: '#4fb7ff'
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 8 } } }
    }
  });
}

function renderBreakdown(canvasId, dataObj = {}, label) {
  const entries = Object.entries(dataObj || {});
  const labels = entries.map(([k]) => k);
  const values = entries.map(([, v]) => v);
  renderChart(canvasId, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: label || '',
        data: values,
        backgroundColor: '#ffba4f'
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
}

function renderHeatmap(curve = []) {
  const grid = document.querySelector('#heatmap-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const byDate = {};
  curve.forEach(point => {
    if (!point.date) return;
    byDate[point.date] = (byDate[point.date] || 0) + (point.pnl || 0);
  });
  if (!Object.keys(byDate).length) {
    const note = document.createElement('p');
    note.className = 'tool-note';
    note.textContent = 'No monthly data yet.';
    grid.appendChild(note);
    return;
  }
  const entries = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
  entries.forEach(([date, pnl]) => {
    const card = document.createElement('div');
    card.className = 'heatmap-day';
    if (pnl > 0) card.classList.add('positive');
    if (pnl < 0) card.classList.add('negative');
    const dateEl = document.createElement('div');
    dateEl.textContent = date;
    const valueEl = document.createElement('div');
    valueEl.className = 'value';
    valueEl.textContent = formatNumber(pnl);
    card.append(dateEl, valueEl);
    grid.appendChild(card);
  });
}

async function refreshAnalytics() {
  readFilters();
  const query = toQuery(state.filters);
  const rangeText = [];
  if (state.filters.from) rangeText.push(`From ${state.filters.from}`);
  if (state.filters.to) rangeText.push(`to ${state.filters.to}`);
  document.querySelector('#analytics-range').textContent = rangeText.join(' ') || 'All time';

  const summary = await api(`/api/analytics/summary${query}`);
  const equityRes = await api(`/api/analytics/equity-curve${query}`);
  const drawdownRes = await api(`/api/analytics/drawdown${query}`);
  const distRes = await api(`/api/analytics/distribution${query}`);
  const streakRes = await api(`/api/analytics/streaks${query}`);

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
  }));
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
  const closeNav = setupNavDrawer();
  document.querySelector('#calendar-btn')?.addEventListener('click', () => window.location.href = '/');
  document.querySelector('#trades-btn')?.addEventListener('click', () => window.location.href = '/trades.html');
  document.querySelector('#transactions-btn')?.addEventListener('click', () => window.location.href = '/transactions.html');
  document.querySelector('#profile-btn')?.addEventListener('click', () => window.location.href = '/profile.html');
  document.querySelector('#devtools-btn')?.addEventListener('click', () => {
    closeNav?.(false);
    window.location.href = '/devtools.html';
  });
  document.querySelector('#logout-btn')?.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    sessionStorage.removeItem('guestMode');
    localStorage.removeItem('guestMode');
    window.location.href = '/login.html';
  });
  document.querySelector('#quick-settings-btn')?.addEventListener('click', () => {
    closeNav?.(false);
    const modal = document.querySelector('#quick-settings-modal');
    const riskSel = document.querySelector('#qs-risk-select');
    const curSel = document.querySelector('#qs-currency-select');
    try {
      const saved = localStorage.getItem('plc-prefs');
      if (saved) {
        const prefs = JSON.parse(saved);
        if (riskSel && Number.isFinite(prefs?.defaultRiskPct)) riskSel.value = String(prefs.defaultRiskPct);
        if (curSel && prefs?.defaultRiskCurrency) curSel.value = prefs.defaultRiskCurrency;
      }
    } catch (e) {
      console.warn(e);
    }
    modal?.classList.remove('hidden');
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
    closeQs();
  });
  api('/api/profile')
    .then(profile => {
      const show = profile?.username === 'mevs.0404@gmail.com' || profile?.username === 'dummy1';
      document.querySelectorAll('#devtools-btn').forEach(btn => btn.classList.toggle('is-hidden', !show));
    })
    .catch(() => {
      document.querySelectorAll('#devtools-btn').forEach(btn => btn.classList.add('is-hidden'));
    });
}

function bindFilters() {
  document.querySelector('#apply-filters-btn')?.addEventListener('click', () => refreshAnalytics().catch(console.error));
  document.querySelector('#reset-filters-btn')?.addEventListener('click', resetFilters);
}

function init() {
  bindNav();
  bindFilters();
  loadHeroMetrics();
  refreshAnalytics().catch(console.error);
}

window.addEventListener('DOMContentLoaded', init);
