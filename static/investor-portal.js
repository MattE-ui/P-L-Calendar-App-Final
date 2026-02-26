function investorApi(path, opts = {}, previewToken = '') {
  const headers = { ...(opts.headers || {}) };
  if (previewToken) headers.Authorization = `Bearer ${previewToken}`;
  return fetch(path, { credentials: 'include', ...opts, headers }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed');
      err.data = data;
      throw err;
    }
    return data;
  });
}

function metric(label, value) {
  return `<article class="metric-card hero-card"><h3>${label}</h3><div class="metric-value">${value}</div></article>`;
}

function formatMoney(value) {
  const num = Number(value) || 0;
  const sign = num < 0 ? '-' : '';
  return `${sign}£${Math.abs(num).toFixed(2)}`;
}

function formatMoneyCompact(value) {
  const num = Number(value) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}£${(abs / 1_000).toFixed(1)}K`;
  return `${sign}£${abs.toFixed(0)}`;
}

const investorDashboardState = {
  previewToken: '',
  equityRange: '1M',
  equityChart: null
};

function destroyInvestorChart() {
  if (investorDashboardState.equityChart) {
    investorDashboardState.equityChart.destroy();
    investorDashboardState.equityChart = null;
  }
}

function renderInvestorEquity(points = []) {
  const equityEl = document.getElementById('investor-equity');
  if (!equityEl) return;

  destroyInvestorChart();
  equityEl.innerHTML = '';

  if (!Array.isArray(points) || points.length === 0) {
    equityEl.innerHTML = '<p class="helper">No valuation history yet</p>';
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.id = 'investor-equity-chart';
  equityEl.appendChild(canvas);

  if (typeof Chart !== 'function') {
    equityEl.innerHTML = '<p class="helper">Chart library unavailable</p>';
    return;
  }

  const labels = points.map(p => p.date);
  const values = points.map(p => Number(p.value) || 0);
  const ctx = canvas.getContext('2d');
  investorDashboardState.equityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Net value',
        data: values,
        borderColor: '#0BBF7A',
        backgroundColor: 'rgba(11,191,122,0.12)',
        fill: true,
        borderWidth: 2,
        pointRadius: points.length === 1 ? 3 : 0,
        pointHoverRadius: 3,
        tension: points.length > 2 ? 0.25 : 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          intersect: false,
          mode: 'index',
          callbacks: {
            title(items) {
              return items?.[0]?.label || '';
            },
            label(item) {
              return ` ${formatMoney(item.raw)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { color: 'rgba(226,231,243,0.72)', maxTicksLimit: 6 }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: {
            color: 'rgba(226,231,243,0.72)',
            callback(value) { return formatMoneyCompact(value); },
            maxTicksLimit: 5
          }
        }
      }
    }
  });
}

async function loadInvestorEquity() {
  const equityEl = document.getElementById('investor-equity');
  if (!equityEl) return;
  equityEl.innerHTML = '<p class="helper">Loading…</p>';
  try {
    const equity = await investorApi(`/api/investor/equity-curve?range=${encodeURIComponent(investorDashboardState.equityRange)}`, {}, investorDashboardState.previewToken);
    renderInvestorEquity(equity.points || []);
  } catch (error) {
    equityEl.innerHTML = `<p class="helper">Failed to load equity curve: ${error.message}</p>`;
  }
}

async function loadInvestorDashboard(previewToken = '') {
  investorDashboardState.previewToken = previewToken;
  const summary = await investorApi('/api/investor/summary', {}, previewToken);
  const cashflows = await investorApi('/api/investor/cashflows?limit=20', {}, previewToken);
  const container = document.getElementById('investor-metrics');
  if (container) {
    container.innerHTML = [
      metric('Current value', formatMoney(summary.investor_net_value)),
      metric('Net contributions', formatMoney(summary.net_contributions)),
      metric('Profit share', formatMoney(summary.investor_profit_share)),
      metric('Return %', `${(Number(summary.investor_return_pct || 0) * 100).toFixed(2)}%`),
      metric('NAV today', formatMoney(summary.nav_today))
    ].join('');
  }

  const cashflowEl = document.getElementById('investor-cashflows');
  if (cashflowEl) {
    cashflowEl.innerHTML = `<table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Ref</th></tr></thead><tbody>${(cashflows.cashflows || []).map(row => `<tr><td>${row.effectiveDate}</td><td>${row.type}</td><td>${formatMoney(row.amount)}</td><td>${row.reference || ''}</td></tr>`).join('')}</tbody></table>`;
  }

  await loadInvestorEquity();
}

function initInvestorRangeSelector() {
  const rangesEl = document.getElementById('investor-equity-ranges');
  if (!rangesEl) return;
  rangesEl.addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-range]');
    if (!btn) return;
    const nextRange = btn.dataset.range;
    if (!nextRange || nextRange === investorDashboardState.equityRange) return;
    investorDashboardState.equityRange = nextRange;
    rangesEl.querySelectorAll('button[data-range]').forEach(el => {
      el.classList.toggle('is-active', el.dataset.range === nextRange);
    });
    await loadInvestorEquity();
  });
}

async function initInvestorLogin() {
  const btn = document.getElementById('investor-login-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const errorEl = document.getElementById('investor-login-error');
    if (errorEl) errorEl.textContent = '';
    try {
      const email = document.getElementById('investor-email')?.value?.trim();
      const password = document.getElementById('investor-password')?.value || '';
      await investorApi('/api/investor/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
      });
      window.location.href = '/investor/dashboard';
    } catch (error) {
      if (errorEl) errorEl.textContent = error.message;
    }
  });
}

async function initInvestorActivate() {
  const btn = document.getElementById('investor-activate-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const errorEl = document.getElementById('investor-activate-error');
    const okEl = document.getElementById('investor-activate-ok');
    if (errorEl) errorEl.textContent = '';
    if (okEl) okEl.textContent = '';
    try {
      const token = new URLSearchParams(window.location.search).get('token') || '';
      const password = document.getElementById('investor-activate-password')?.value || '';
      await investorApi('/api/investor/auth/activate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password })
      });
      if (okEl) okEl.textContent = 'Activation complete. Redirecting to login...';
      setTimeout(() => { window.location.href = '/investor/login'; }, 1200);
    } catch (error) {
      if (errorEl) errorEl.textContent = error.message;
    }
  });
}

async function initInvestorDashboardOrPreview() {
  const hasDashboard = !!document.getElementById('investor-metrics');
  if (!hasDashboard) return;
  initInvestorRangeSelector();
  const isPreview = window.location.pathname === '/investor/preview';
  const previewToken = isPreview ? (new URLSearchParams(window.location.search).get('token') || '') : '';
  try {
    await loadInvestorDashboard(previewToken);
  } catch (error) {
    const equityEl = document.getElementById('investor-equity');
    if (equityEl) equityEl.textContent = `Failed to load dashboard: ${error.message}`;
  }
  const logoutBtn = document.getElementById('investor-logout-btn');
  logoutBtn?.addEventListener('click', async () => {
    await investorApi('/api/investor/auth/logout', { method: 'POST' });
    window.location.href = '/investor/login';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initInvestorLogin();
  initInvestorActivate();
  initInvestorDashboardOrPreview();
});
