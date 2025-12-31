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
    document.getElementById('header-portfolio-value').textContent = `£${portfolioValue.toFixed(2)}`;
    document.getElementById('hero-net-deposits-value').textContent = `${netDepositsValue < 0 ? '-' : ''}£${Math.abs(netDepositsValue).toFixed(2)}`;
    document.getElementById('hero-net-performance-value').textContent = `${netPerformance < 0 ? '-' : ''}£${Math.abs(netPerformance).toFixed(2)}`;
    document.getElementById('hero-net-performance-sub').textContent = `${(netPerfPct * 100).toFixed(1)}%`;
  } catch (e) {
    console.warn('Failed to load hero metrics', e);
  }
}

async function loadTrading212Payloads() {
  try {
    const data = await api('/api/integrations/trading212/raw');
    document.getElementById('devtools-portfolio').textContent = JSON.stringify(data.portfolio ?? null, null, 2);
    document.getElementById('devtools-positions').textContent = JSON.stringify(data.positions ?? null, null, 2);
    document.getElementById('devtools-transactions').textContent = JSON.stringify(data.transactions ?? null, null, 2);
  } catch (e) {
    const message = e?.data?.error || e.message || 'Unable to load payloads.';
    document.getElementById('devtools-portfolio').textContent = message;
  }
}

function bindNav() {
  const closeNav = setupNavDrawer();
  document.getElementById('calendar-btn')?.addEventListener('click', () => window.location.href = '/');
  document.getElementById('analytics-btn')?.addEventListener('click', () => window.location.href = '/analytics.html');
  document.getElementById('trades-btn')?.addEventListener('click', () => window.location.href = '/trades.html');
  document.getElementById('transactions-btn')?.addEventListener('click', () => window.location.href = '/transactions.html');
  document.getElementById('profile-btn')?.addEventListener('click', () => window.location.href = '/profile.html');
  document.getElementById('devtools-btn')?.addEventListener('click', () => {
    closeNav?.(false);
    window.location.href = '/devtools.html';
  });
  document.getElementById('quick-settings-btn')?.addEventListener('click', () => {
    closeNav?.(false);
    window.location.href = '/';
  });
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (e) {
      console.warn(e);
    }
    window.location.href = '/login.html';
  });
}

window.addEventListener('DOMContentLoaded', () => {
  bindNav();
  loadHeroMetrics();
  loadTrading212Payloads();
});
