const state = {
  trades: [],
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
  editingId: null,
  defaults: {
    tradeType: '',
    assetClass: '',
    strategyTag: '',
    marketCondition: '',
    setupTags: [],
    emotionTags: []
  }
};

const currencySymbols = { GBP: '£', USD: '$', EUR: '€' };

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

function formatCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const sign = num < 0 ? '-' : '';
  return `${sign}£${Math.abs(num).toFixed(2)}`;
}

function formatSignedCurrency(value) {
  return formatCurrency(value);
}

function setupNavDrawer() {
  const navToggle = document.querySelector('#nav-toggle-btn');
  const navDrawer = document.querySelector('#nav-drawer');
  const navOverlay = document.querySelector('#nav-drawer-overlay');
  const navClose = document.querySelector('#nav-close-btn');
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
    const portfolioEl = document.querySelector('#header-portfolio-value');
    if (portfolioEl) portfolioEl.textContent = formatCurrency(portfolioValue);
    const netDepositsEl = document.querySelector('#hero-net-deposits-value');
    if (netDepositsEl) netDepositsEl.textContent = formatSignedCurrency(netDepositsValue);
    const netPerfEl = document.querySelector('#hero-net-performance-value');
    if (netPerfEl) netPerfEl.textContent = formatSignedCurrency(netPerformance);
    const netPerfSub = document.querySelector('#hero-net-performance-sub');
    if (netPerfSub) netPerfSub.textContent = `${(netPerfPct * 100).toFixed(1)}%`;
  } catch (e) {
    console.warn('Failed to load hero metrics', e);
  }
}

function toQuery(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function selectedTags(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(el => el.value);
}

function parseTagList(value) {
  if (!value) return [];
  return value.split(',').map(tag => tag.trim()).filter(Boolean);
}

function setCheckboxes(name, values = []) {
  const set = new Set(values);
  document.querySelectorAll(`input[name="${name}"]`).forEach(el => {
    el.checked = set.has(el.value);
  });
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

async function loadTrades() {
  readFilters();
  const query = toQuery(state.filters);
  const res = await api(`/api/trades${query}`);
  state.trades = Array.isArray(res.trades) ? res.trades : [];
  renderTrades();
}

function renderTrades() {
  const tbody = document.querySelector('#trade-table tbody');
  const empty = document.querySelector('#trade-empty');
  const pill = document.querySelector('#trade-count-pill');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!state.trades.length) {
    if (empty) empty.classList.remove('is-hidden');
    if (pill) pill.textContent = '0 trades';
    return;
  }
  if (empty) empty.classList.add('is-hidden');
  if (pill) pill.textContent = `${state.trades.length} trades`;
  const sortedTrades = [...state.trades].sort((a, b) => {
    const aDate = Date.parse(a.closeDate || a.openDate || '') || 0;
    const bDate = Date.parse(b.closeDate || b.openDate || '') || 0;
    return bDate - aDate;
  });
  sortedTrades.forEach(trade => {
    const tr = document.createElement('tr');
    const dateCell = document.createElement('td');
    dateCell.textContent = trade.closeDate || trade.openDate || '—';
    tr.appendChild(dateCell);

    const symCell = document.createElement('td');
    symCell.textContent = trade.symbol || '—';
    tr.appendChild(symCell);

    const typeCell = document.createElement('td');
    typeCell.textContent = trade.tradeType || '—';
    tr.appendChild(typeCell);

    const assetCell = document.createElement('td');
    assetCell.textContent = trade.assetClass || '—';
    tr.appendChild(assetCell);

    const guaranteedCell = document.createElement('td');
    guaranteedCell.textContent = formatCurrency(trade.guaranteedPnlGBP);
    guaranteedCell.className = trade.guaranteedPnlGBP > 0 ? 'positive' : trade.guaranteedPnlGBP < 0 ? 'negative' : '';
    tr.appendChild(guaranteedCell);

    const pnlCell = document.createElement('td');
    pnlCell.textContent = formatCurrency(trade.realizedPnlGBP);
    pnlCell.className = trade.realizedPnlGBP > 0 ? 'positive' : trade.realizedPnlGBP < 0 ? 'negative' : '';
    tr.appendChild(pnlCell);

    const sourceCell = document.createElement('td');
    sourceCell.textContent = trade.source === 'trading212' ? 'Trading 212' : 'Manual';
    tr.appendChild(sourceCell);

    const tagsCell = document.createElement('td');
    const chips = document.createElement('div');
    chips.className = 'tag-chips';
    const addChip = (label) => {
      const span = document.createElement('span');
      span.className = 'tag-chip';
      span.textContent = label;
      chips.appendChild(span);
    };
    if (trade.strategyTag) addChip(trade.strategyTag);
    (trade.setupTags || []).forEach(addChip);
    (trade.emotionTags || []).forEach(addChip);
    tagsCell.appendChild(chips);
    tr.appendChild(tagsCell);

    const actionsCell = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'ghost';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => populateForm(trade));
    wrap.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'danger outline';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!window.confirm('Delete this trade? This cannot be undone.')) {
        return;
      }
      try {
        await api(`/api/trades/${trade.id}`, { method: 'DELETE' });
        await loadTrades();
      } catch (e) {
        alert(e?.message || 'Unable to delete trade');
      }
    });
    wrap.appendChild(deleteBtn);

    if (trade.status !== 'closed') {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'primary';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => closeTradePrompt(trade));
      wrap.appendChild(closeBtn);
    }
    actionsCell.appendChild(wrap);
    tr.appendChild(actionsCell);

    tbody.appendChild(tr);
  });
}

function populateForm(trade) {
  state.editingId = trade.id;
  document.querySelector('#form-title').textContent = 'Edit trade';
  document.querySelector('#trade-id').value = trade.id;
  document.querySelector('#form-symbol').value = trade.symbol || '';
  document.querySelector('#form-currency').value = trade.currency || 'GBP';
  document.querySelector('#form-entry').value = trade.entry ?? '';
  document.querySelector('#form-stop').value = trade.stop ?? '';
  const currentStopInput = document.querySelector('#form-current-stop');
  if (currentStopInput) currentStopInput.value = trade.currentStop ?? '';
  document.querySelector('#form-risk-pct').value = trade.riskPct ?? '';
  document.querySelector('#form-risk-amount').value = trade.riskAmountCurrency ?? '';
  document.querySelector('#form-units').value = trade.sizeUnits ?? '';
  document.querySelector('#form-open-date').value = trade.openDate || '';
  document.querySelector('#form-close-date').value = trade.closeDate || '';
  document.querySelector('#form-close-price').value = trade.closePrice ?? '';
  document.querySelector('#form-trade-type').value = trade.tradeType || 'day';
  document.querySelector('#form-asset-class').value = trade.assetClass || 'stocks';
  document.querySelector('#form-strategy').value = trade.strategyTag || '';
  document.querySelector('#form-market-condition').value = trade.marketCondition || '';
  document.querySelector('#form-screenshot').value = trade.screenshotUrl || '';
  const isProviderTrade = trade.source === 'trading212' || trade.trading212Id;
  const setupTags = (trade.setupTags && trade.setupTags.length) ? trade.setupTags : (isProviderTrade ? state.defaults.setupTags : []);
  const emotionTags = (trade.emotionTags && trade.emotionTags.length) ? trade.emotionTags : (isProviderTrade ? state.defaults.emotionTags : []);
  setCheckboxes('form-setup', setupTags);
  setCheckboxes('form-emotion', emotionTags);
  if (isProviderTrade) {
    if (state.defaults.tradeType && (!trade.tradeType || trade.tradeType === 'day')) {
      document.querySelector('#form-trade-type').value = state.defaults.tradeType;
    }
    if (state.defaults.assetClass && (!trade.assetClass || trade.assetClass === 'stocks')) {
      document.querySelector('#form-asset-class').value = state.defaults.assetClass;
    }
    if (state.defaults.strategyTag && !trade.strategyTag) {
      document.querySelector('#form-strategy').value = state.defaults.strategyTag;
    }
    if (state.defaults.marketCondition && !trade.marketCondition) {
      document.querySelector('#form-market-condition').value = state.defaults.marketCondition;
    }
  }
  document.querySelector('#form-notes').value = trade.note || '';
  const status = document.querySelector('#form-status');
  if (status) status.textContent = 'Editing existing trade';
  document.querySelector('#trade-form-modal')?.classList.remove('hidden');
}

function applyDefaultsToForm() {
  if (state.defaults.tradeType) {
    document.querySelector('#form-trade-type').value = state.defaults.tradeType;
  }
  if (state.defaults.assetClass) {
    document.querySelector('#form-asset-class').value = state.defaults.assetClass;
  }
  if (state.defaults.strategyTag) {
    document.querySelector('#form-strategy').value = state.defaults.strategyTag;
  }
  if (state.defaults.marketCondition) {
    document.querySelector('#form-market-condition').value = state.defaults.marketCondition;
  }
  if (state.defaults.setupTags.length) {
    setCheckboxes('form-setup', state.defaults.setupTags);
  }
  if (state.defaults.emotionTags.length) {
    setCheckboxes('form-emotion', state.defaults.emotionTags);
  }
}

function resetForm() {
  state.editingId = null;
  document.querySelector('#trade-id').value = '';
  document.querySelector('#form-title').textContent = 'Log a trade';
  document.querySelector('#trade-form').reset();
  setCheckboxes('form-setup', []);
  setCheckboxes('form-emotion', []);
  applyDefaultsToForm();
  const status = document.querySelector('#form-status');
  if (status) status.textContent = 'Ready to log a new trade';
}

function collectFormData() {
  const numberOrUndefined = (id) => {
    const raw = document.querySelector(id)?.value;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const num = Number(raw);
    return Number.isNaN(num) ? undefined : num;
  };
  return {
    symbol: document.querySelector('#form-symbol')?.value,
    currency: document.querySelector('#form-currency')?.value || 'GBP',
    entry: numberOrUndefined('#form-entry'),
    stop: numberOrUndefined('#form-stop'),
    currentStop: numberOrUndefined('#form-current-stop'),
    riskPct: numberOrUndefined('#form-risk-pct'),
    riskAmount: numberOrUndefined('#form-risk-amount'),
    sizeUnits: numberOrUndefined('#form-units'),
    date: document.querySelector('#form-open-date')?.value,
    closeDate: document.querySelector('#form-close-date')?.value,
    closePrice: numberOrUndefined('#form-close-price'),
    tradeType: document.querySelector('#form-trade-type')?.value,
    assetClass: document.querySelector('#form-asset-class')?.value,
    strategyTag: document.querySelector('#form-strategy')?.value,
    marketCondition: document.querySelector('#form-market-condition')?.value,
    setupTags: selectedTags('form-setup'),
    emotionTags: selectedTags('form-emotion'),
    screenshotUrl: document.querySelector('#form-screenshot')?.value,
    note: document.querySelector('#form-notes')?.value
  };
}

async function saveTrade(event) {
  event.preventDefault();
  const payload = collectFormData();
  const status = document.querySelector('#form-status');
  try {
    if (state.editingId) {
      await api(`/api/trades/${state.editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      await api('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    if (status) {
      status.textContent = 'Saved';
      status.classList.add('success');
    }
    await loadTrades();
    resetForm();
    document.querySelector('#trade-form-modal')?.classList.add('hidden');
  } catch (e) {
    if (status) {
      status.textContent = e?.message || 'Unable to save trade';
      status.classList.remove('success');
    }
  }
}

async function closeTradePrompt(trade) {
  const price = window.prompt('Enter closing price', trade.closePrice || trade.entry || '');
  if (price === null) return;
  const closeDate = window.prompt('Enter close date (YYYY-MM-DD) or leave blank', trade.closeDate || '');
  const payload = { id: trade.id, price: Number(price) };
  if (closeDate) payload.date = closeDate;
  try {
    await api('/api/trades/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    await loadTrades();
  } catch (e) {
    alert(e?.message || 'Unable to close trade');
  }
}

function applyFilters() {
  loadTrades().catch(console.error);
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
  loadTrades().catch(console.error);
}

function exportCsv() {
  readFilters();
  const query = toQuery(state.filters);
  window.location.href = `/api/trades/export${query}`;
}

function bindNav() {
  const closeNav = setupNavDrawer();
  document.querySelector('#calendar-btn')?.addEventListener('click', () => window.location.href = '/');
  document.querySelector('#analytics-btn')?.addEventListener('click', () => window.location.href = '/analytics.html');
  document.querySelector('#profile-btn')?.addEventListener('click', () => window.location.href = '/profile.html');
  document.querySelector('#devtools-btn')?.addEventListener('click', () => {
    closeNav?.(false);
    window.location.href = '/devtools.html';
  });
  document.querySelector('#logout-btn')?.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login.html';
  });
  document.querySelector('#quick-settings-btn')?.addEventListener('click', () => {
    closeNav?.(false);
    document.querySelector('#trade-settings-modal')?.classList.remove('hidden');
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

function bindForm() {
  document.querySelector('#trade-form')?.addEventListener('submit', saveTrade);
  document.querySelector('#reset-form-btn')?.addEventListener('click', resetForm);
  document.querySelector('#apply-filters-btn')?.addEventListener('click', applyFilters);
  document.querySelector('#reset-filters-btn')?.addEventListener('click', resetFilters);
  document.querySelector('#export-csv-btn')?.addEventListener('click', exportCsv);
  document.querySelector('#add-trade-btn')?.addEventListener('click', () => {
    resetForm();
    document.querySelector('#trade-form-modal')?.classList.remove('hidden');
  });
  document.querySelector('#close-trade-form-btn')?.addEventListener('click', () => {
    document.querySelector('#trade-form-modal')?.classList.add('hidden');
  });
  document.querySelector('#trade-settings-btn')?.addEventListener('click', () => {
    document.querySelector('#trade-settings-modal')?.classList.remove('hidden');
  });
  document.querySelector('#close-trade-settings-btn')?.addEventListener('click', () => {
    document.querySelector('#trade-settings-modal')?.classList.add('hidden');
  });
  document.querySelector('#cancel-trade-settings-btn')?.addEventListener('click', () => {
    document.querySelector('#trade-settings-modal')?.classList.add('hidden');
  });
  document.querySelector('#save-quick-settings-btn')?.addEventListener('click', () => {
    state.defaults = {
      tradeType: document.querySelector('#qs-trade-type')?.value || '',
      assetClass: document.querySelector('#qs-asset-class')?.value || '',
      strategyTag: document.querySelector('#qs-strategy')?.value || '',
      marketCondition: document.querySelector('#qs-market-condition')?.value || '',
      setupTags: parseTagList(document.querySelector('#qs-setup-tags')?.value || ''),
      emotionTags: parseTagList(document.querySelector('#qs-emotion-tags')?.value || '')
    };
    localStorage.setItem('trade-defaults', JSON.stringify(state.defaults));
    applyDefaultsToForm();
    document.querySelector('#trade-settings-modal')?.classList.add('hidden');
  });
}

async function init() {
  bindNav();
  bindForm();
  loadHeroMetrics();
  try {
    const saved = localStorage.getItem('trade-defaults');
    if (saved) {
      const parsed = JSON.parse(saved);
      state.defaults = {
        tradeType: parsed.tradeType || '',
        assetClass: parsed.assetClass || '',
        strategyTag: parsed.strategyTag || '',
        marketCondition: parsed.marketCondition || '',
        setupTags: Array.isArray(parsed.setupTags) ? parsed.setupTags : [],
        emotionTags: Array.isArray(parsed.emotionTags) ? parsed.emotionTags : []
      };
    }
  } catch (e) {
    console.warn(e);
  }
  document.querySelector('#qs-trade-type').value = state.defaults.tradeType || '';
  document.querySelector('#qs-asset-class').value = state.defaults.assetClass || '';
  document.querySelector('#qs-strategy').value = state.defaults.strategyTag || '';
  document.querySelector('#qs-market-condition').value = state.defaults.marketCondition || '';
  document.querySelector('#qs-setup-tags').value = state.defaults.setupTags.join(', ');
  document.querySelector('#qs-emotion-tags').value = state.defaults.emotionTags.join(', ');
  const today = new Date().toISOString().slice(0, 10);
  const openInput = document.querySelector('#form-open-date');
  if (openInput && !openInput.value) openInput.value = today;
  resetForm();
  await loadTrades();
}

window.addEventListener('DOMContentLoaded', () => {
  init().catch(console.error);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelector('#trade-form-modal')?.classList.add('hidden');
      document.querySelector('#trade-settings-modal')?.classList.add('hidden');
    }
  });
});
