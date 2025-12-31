async function api(path, opts = {}) {
  const isGuest = sessionStorage.getItem('guestMode') === 'true' || localStorage.getItem('guestMode') === 'true';
  if (isGuest && typeof window.handleGuestRequest === 'function') {
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
  return data;
}

const currencySymbols = { GBP: '£', USD: '$', EUR: '€' };

function formatCurrency(value, currency = 'GBP') {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const symbol = currencySymbols[currency] || '£';
  return `${symbol}${num.toFixed(2)}`;
}

function formatSignedCurrency(value, currency = 'GBP') {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const sign = num < 0 ? '-' : '';
  const symbol = currencySymbols[currency] || '£';
  return `${sign}${symbol}${Math.abs(num).toFixed(2)}`;
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const sign = num < 0 ? '-' : '';
  return `${sign}${Math.abs(num).toFixed(2)}%`;
}

function buildTransactions(data) {
  const transactions = [];
  Object.entries(data || {}).forEach(([, days]) => {
    Object.entries(days || {}).forEach(([dateKey, record]) => {
      if (!record) return;
      const cashIn = Number(record.cashIn ?? 0);
      const cashOut = Number(record.cashOut ?? 0);
      const note = typeof record.note === 'string' ? record.note.trim() : '';
      if (Number.isFinite(cashIn) && cashIn > 0) {
        transactions.push({
          id: `${dateKey}-deposit`,
          date: dateKey,
          type: 'Deposit',
          amount: cashIn,
          note
        });
      }
      if (Number.isFinite(cashOut) && cashOut > 0) {
        transactions.push({
          id: `${dateKey}-withdrawal`,
          date: dateKey,
          type: 'Withdrawal',
          amount: -cashOut,
          note
        });
      }
    });
  });
  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  return transactions;
}

function renderTransactions(transactions = []) {
  const tbody = document.getElementById('transactions-body');
  const empty = document.getElementById('transactions-empty');
  if (!tbody || !empty) return;
  tbody.innerHTML = '';
  if (!transactions.length) {
    empty.classList.remove('is-hidden');
    return;
  }
  empty.classList.add('is-hidden');
  transactions.forEach(tx => {
    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    const typeCell = document.createElement('td');
    const amountCell = document.createElement('td');
    const noteCell = document.createElement('td');
    dateCell.textContent = tx.date;
    typeCell.textContent = tx.type;
    amountCell.textContent = formatSignedCurrency(tx.amount, 'GBP');
    amountCell.classList.toggle('positive', tx.amount > 0);
    amountCell.classList.toggle('negative', tx.amount < 0);
    noteCell.textContent = tx.note || '—';
    row.append(dateCell, typeCell, amountCell, noteCell);
    tbody.appendChild(row);
  });
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

function setupNav() {
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
    const isOpen = !navDrawer?.classList.contains('hidden');
    setNavOpen(!isOpen);
  });
  navClose?.addEventListener('click', () => setNavOpen(false));
  navOverlay?.addEventListener('click', () => setNavOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    setNavOpen(false);
  });
  document.getElementById('calendar-btn')?.addEventListener('click', () => {
    window.location.href = '/';
  });
  document.getElementById('analytics-btn')?.addEventListener('click', () => {
    window.location.href = '/analytics.html';
  });
  document.getElementById('trades-btn')?.addEventListener('click', () => {
    window.location.href = '/trades.html';
  });
  document.getElementById('transactions-btn')?.addEventListener('click', () => {
    window.location.href = '/transactions.html';
  });
  document.getElementById('profile-btn')?.addEventListener('click', () => {
    window.location.href = '/profile.html';
  });
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login.html';
    }
  });
}

async function loadTransactions() {
  try {
    const data = await api('/api/pl');
    const transactions = buildTransactions(data);
    renderTransactions(transactions);
  } catch (e) {
    console.error('Failed to load transactions', e);
  }
}

setupNav();
loadHeroMetrics();
loadTransactions();
