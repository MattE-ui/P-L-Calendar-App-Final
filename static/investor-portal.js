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

async function loadInvestorDashboard(previewToken = '') {
  const summary = await investorApi('/api/investor/summary', {}, previewToken);
  const equity = await investorApi('/api/investor/equity-curve?range=ALL', {}, previewToken);
  const cashflows = await investorApi('/api/investor/cashflows?limit=20', {}, previewToken);
  const container = document.getElementById('investor-metrics');
  if (container) {
    container.innerHTML = [
      metric('Current value', formatMoney(summary.investor_net_value_today)),
      metric('Net contributions', formatMoney(summary.net_contributions)),
      metric('Profit share', formatMoney(summary.investor_profit_share)),
      metric('Return %', `${Number(summary.investor_return_pct || 0).toFixed(2)}%`),
      metric('NAV today', formatMoney(summary.nav_today))
    ].join('');
  }
  const equityEl = document.getElementById('investor-equity');
  if (equityEl) {
    equityEl.textContent = JSON.stringify(equity.points || [], null, 2);
  }
  const cashflowEl = document.getElementById('investor-cashflows');
  if (cashflowEl) {
    cashflowEl.innerHTML = `<table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Ref</th></tr></thead><tbody>${(cashflows.cashflows || []).map(row => `<tr><td>${row.effectiveDate}</td><td>${row.type}</td><td>${formatMoney(row.amount)}</td><td>${row.reference || ''}</td></tr>`).join('')}</tbody></table>`;
  }
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
