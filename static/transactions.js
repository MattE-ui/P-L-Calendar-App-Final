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

const state = {
  currency: 'GBP',
  rates: { GBP: 1 }
};

const currencySymbols = { GBP: '£', USD: '$', EUR: '€' };

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

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '0.00%';
  const num = Number(value);
  const sign = num < 0 ? '-' : '';
  return `${sign}${Math.abs(num).toFixed(2)}%`;
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
    await loadRates();
    const netPerfPct = netDepositsValue ? (netPerformance / Math.abs(netDepositsValue)) * 100 : 0;
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
  document.getElementById('portfolio-btn')?.addEventListener('click', () => {
    window.location.href = '/';
  });
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login.html';
    }
  });
  document.getElementById('quick-settings-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('quick-settings-modal');
    const riskSel = document.getElementById('qs-risk-select');
    const curSel = document.getElementById('qs-currency-select');
    const splitToggle = document.getElementById('qs-split-profits');
    try {
      const saved = localStorage.getItem('plc-prefs');
      if (saved) {
        const prefs = JSON.parse(saved);
        if (riskSel && Number.isFinite(prefs?.defaultRiskPct)) riskSel.value = String(prefs.defaultRiskPct);
        if (curSel && prefs?.defaultRiskCurrency) curSel.value = prefs.defaultRiskCurrency;
        if (splitToggle) splitToggle.checked = !!prefs?.splitProfits;
      }
    } catch (e) {
      console.warn(e);
    }
    modal?.classList.remove('hidden');
  });
  const closeQs = () => document.getElementById('quick-settings-modal')?.classList.add('hidden');
  document.getElementById('close-qs-btn')?.addEventListener('click', closeQs);
  document.getElementById('save-qs-btn')?.addEventListener('click', () => {
    const riskSel = document.getElementById('qs-risk-select');
    const curSel = document.getElementById('qs-currency-select');
    const splitToggle = document.getElementById('qs-split-profits');
    const pct = Number(riskSel?.value);
    const cur = curSel?.value;
    const prefs = {};
    if (Number.isFinite(pct) && pct > 0) prefs.defaultRiskPct = pct;
    if (cur && ['GBP', 'USD', 'EUR'].includes(cur)) prefs.defaultRiskCurrency = cur;
    if (splitToggle) prefs.splitProfits = splitToggle.checked;
    try {
      localStorage.setItem('plc-prefs', JSON.stringify(prefs));
    } catch (e) {
      console.warn(e);
    }
    closeQs();
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
