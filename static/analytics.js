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

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', ...opts });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = '/login.html';
    return {};
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.data = data;
    throw err;
  }
  return data;
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
  document.querySelector('#kpi-r-multiple').textContent = summary.avgR !== null ? summary.avgR.toFixed(2) : '—';
  document.querySelector('#kpi-drawdown').textContent = formatNumber(dd.maxDrawdown || 0);
  document.querySelector('#kpi-drawdown-duration').textContent = dd.durationDays || 0;
  document.querySelector('#kpi-median').textContent = `${formatNumber(dist.median || 0)} median`;
  document.querySelector('#kpi-stddev').textContent = dist.stddev !== null ? formatNumber(dist.stddev) : '—';
  document.querySelector('#kpi-streaks').textContent = `${streaks.maxWinStreak || 0}W / ${streaks.maxLossStreak || 0}L`;
}

function renderEquityCurve(curve = []) {
  if (!curve.length) {
    showEmptyState('equity-chart', 'No equity data yet.');
    return;
  }
  const labels = curve.map(p => p.date);
  const values = curve.map(p => p.cumulative);
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
  document.querySelector('#calendar-btn')?.addEventListener('click', () => window.location.href = '/');
  document.querySelector('#trades-btn')?.addEventListener('click', () => window.location.href = '/trades.html');
  document.querySelector('#profile-btn')?.addEventListener('click', () => window.location.href = '/profile.html');
  document.querySelector('#logout-btn')?.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login.html';
  });
}

function bindFilters() {
  document.querySelector('#apply-filters-btn')?.addEventListener('click', () => refreshAnalytics().catch(console.error));
  document.querySelector('#reset-filters-btn')?.addEventListener('click', resetFilters);
}

function init() {
  bindNav();
  bindFilters();
  refreshAnalytics().catch(console.error);
}

window.addEventListener('DOMContentLoaded', init);
