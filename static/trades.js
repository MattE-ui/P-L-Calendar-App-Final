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
  editingTrade: null,
  defaults: {
    tradeType: '',
    assetClass: '',
    strategyTag: '',
    marketCondition: '',
    setupTags: [],
    emotionTags: []
  },
  currency: 'GBP',
  portfolioGBP: 0,
  isAdmin: false,
  rates: { GBP: 1 },
  ibkrHistory: {
    batches: [],
    showAll: false,
    showRemoved: false,
    collapsedLimit: 4
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

function getTradeDisplaySymbol(trade) {
  if (!trade) return '—';
  return trade.displayTicker || trade.displaySymbol || trade.symbol || '—';
}

function shouldShowMappingBadge(trade) {
  if (!trade?.mappingScope) return false;
  if (!trade.displayTicker || !trade.brokerTicker) return true;
  return trade.displayTicker !== trade.brokerTicker;
}

function createMappingBadge() {
  const badge = document.createElement('span');
  badge.className = 'mapping-badge';
  badge.textContent = 'Mapped';
  badge.title = 'Display ticker overridden (uses Trading 212 instrument for pricing)';
  return badge;
}

function setMetricTrend(el, value) {
  if (!el) return;
  window.ThemeUtils?.applyPnlColorClass(el, value);
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
    state.portfolioGBP = portfolioValue;
    const netDepositsValue = Number.isFinite(netDeposits) ? netDeposits : 0;
    const netPerformance = portfolioValue - netDepositsValue;
    await loadRates();
    const netPerfPct = netDepositsValue ? (netPerformance / Math.abs(netDepositsValue)) * 100 : 0;
    const altCurrency = state.currency === 'GBP'
      ? (state.rates.USD ? 'USD' : (state.rates.EUR ? 'EUR' : null))
      : 'GBP';
    const portfolioEl = document.querySelector('#header-portfolio-value');
    if (portfolioEl) portfolioEl.textContent = formatCurrency(portfolioValue);
    const portfolioSub = document.querySelector('#header-portfolio-sub');
    if (portfolioSub) {
      const altValue = altCurrency ? formatCurrency(portfolioValue, altCurrency) : '—';
      portfolioSub.textContent = altCurrency && altValue !== '—' ? `≈ ${altValue}` : '';
    }
    const netDepositsEl = document.querySelector('#hero-net-deposits-value');
    if (netDepositsEl) netDepositsEl.textContent = formatSignedCurrency(netDepositsValue);
    const netDepositsSub = document.querySelector('#hero-net-deposits-sub');
    if (netDepositsSub) {
      const altDeposits = altCurrency ? formatSignedCurrency(netDepositsValue, altCurrency) : '—';
      netDepositsSub.textContent = altCurrency && altDeposits !== '—' ? `≈ ${altDeposits}` : '';
    }
    const netPerfEl = document.querySelector('#hero-net-performance-value');
    if (netPerfEl) netPerfEl.textContent = formatSignedCurrency(netPerformance);
    const netPerfSub = document.querySelector('#hero-net-performance-sub');
    if (netPerfSub) {
      const pieces = [];
      if (altCurrency) {
        const altPerf = formatSignedCurrency(netPerformance, altCurrency);
        if (altPerf !== '—') pieces.push(`≈ ${altPerf}`);
      }
      pieces.push(formatPercent(netPerfPct));
      netPerfSub.textContent = pieces.join(' • ');
    }
    setMetricTrend(document.querySelector('#hero-net-performance'), netPerformance);
    const portfolioCard = document.querySelector('#hero-portfolio');
    if (portfolioCard) {
      setMetricTrend(portfolioCard, portfolioValue - netDepositsValue);
    }
    const netDepositsCard = document.querySelector('#hero-net-deposits');
    if (netDepositsCard) {
      netDepositsCard.classList.remove('positive', 'negative');
    }
  } catch (e) {
    console.warn('Failed to load hero metrics', e);
    state.portfolioGBP = 0;
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


function createExecutionLegRow(side, leg = {}) {
  const row = document.createElement('div');
  row.className = 'execution-leg-row';
  row.dataset.side = side;
  row.innerHTML = `
    <div class="tool-field"><label>Date</label><input type="date" data-field="date" value="${leg.date || ''}"></div>
    <div class="tool-field"><label>Qty</label><input type="number" min="0" step="0.0001" data-field="quantity" value="${Number.isFinite(Number(leg.quantity)) ? Number(leg.quantity) : ''}"></div>
    <div class="tool-field"><label>Price</label><input type="number" min="0" step="0.0001" data-field="price" value="${Number.isFinite(Number(leg.price)) ? Number(leg.price) : ''}"></div>
    <div class="tool-field"><label>Fee</label><input type="number" min="0" step="0.0001" data-field="fee" value="${Number.isFinite(Number(leg.fee)) ? Number(leg.fee) : ''}"></div>
    <div class="tool-field"><label>Note</label><input type="text" data-field="note" value="${leg.note || ''}"></div>
    <button type="button" class="ghost small" data-action="remove-leg">Remove</button>
  `;
  row.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateRiskMetrics);
    input.addEventListener('change', updateRiskMetrics);
  });
  row.querySelector('[data-action="remove-leg"]')?.addEventListener('click', () => {
    row.remove();
    updateRiskMetrics();
  });
  return row;
}

function renderExecutionLegs(trade = null) {
  const entriesWrap = document.querySelector('#entry-legs');
  const exitsWrap = document.querySelector('#exit-legs');
  if (!entriesWrap || !exitsWrap) return;
  entriesWrap.classList.add('leg-list');
  exitsWrap.classList.add('leg-list');
  entriesWrap.innerHTML = '';
  exitsWrap.innerHTML = '';
  const sourceLegs = Array.isArray(trade?.executions) ? trade.executions : [];
  const legacyEntry = (!sourceLegs.length && trade && Number.isFinite(Number(trade.entry)) && Number.isFinite(Number(trade.totalEnteredQuantity || trade.sizeUnits || trade.optionContracts)))
    ? [{ side: 'entry', quantity: Number(trade.totalEnteredQuantity || trade.initialSizeUnits || trade.sizeUnits || ((Number(trade.optionContracts) || 0) * 100)), price: Number(trade.entry), date: trade.openDate }]
    : [];
  const legacyExit = (!sourceLegs.length && trade && Number.isFinite(Number(trade.closePrice)) && Number.isFinite(Number(trade.totalExitedQuantity || trade.sizeUnits || 0)) && Number(trade.totalExitedQuantity || trade.sizeUnits || 0) > 0)
    ? [{ side: 'exit', quantity: Number(trade.totalExitedQuantity), price: Number(trade.closePrice), date: trade.closeDate }]
    : [];
  const legs = sourceLegs.length ? sourceLegs : [...legacyEntry, ...legacyExit];
  const entries = legs.filter((leg) => leg.side === 'entry');
  const exits = legs.filter((leg) => leg.side === 'exit');
  (entries.length ? entries : [{}]).forEach((leg) => entriesWrap.appendChild(createExecutionLegRow('entry', leg)));
  (exits.length ? exits : []).forEach((leg) => exitsWrap.appendChild(createExecutionLegRow('exit', leg)));
  updateRiskMetrics();
}

function setCheckboxes(name, values = []) {
  const set = new Set(values);
  document.querySelectorAll(`input[name="${name}"]`).forEach(el => {
    el.checked = set.has(el.value);
  });
}


function readExecutionLegs(side) {
  return Array.from(document.querySelectorAll(`.execution-leg-row[data-side="${side}"]`)).map((row) => {
    const date = row.querySelector('[data-field="date"]')?.value || '';
    const quantity = Number(row.querySelector('[data-field="quantity"]')?.value);
    const price = Number(row.querySelector('[data-field="price"]')?.value);
    const feeRaw = row.querySelector('[data-field="fee"]')?.value;
    const fee = feeRaw === '' ? 0 : Number(feeRaw);
    const note = row.querySelector('[data-field="note"]')?.value || '';
    return { date, quantity, price, fee, note, side };
  }).filter((leg) => Number.isFinite(leg.quantity) && leg.quantity > 0 && Number.isFinite(leg.price) && leg.price >= 0);
}

function computeExecutionSummary(entries, exits) {
  const totalEntered = entries.reduce((sum, leg) => sum + leg.quantity, 0);
  const totalExited = exits.reduce((sum, leg) => sum + leg.quantity, 0);
  const entryValue = entries.reduce((sum, leg) => sum + (leg.quantity * leg.price), 0);
  const exitValue = exits.reduce((sum, leg) => sum + (leg.quantity * leg.price), 0);
  const avgEntry = totalEntered > 0 ? entryValue / totalEntered : NaN;
  const avgExit = totalExited > 0 ? exitValue / totalExited : NaN;
  const openQuantity = totalEntered - totalExited;
  const feeTotal = [...entries, ...exits].reduce((sum, leg) => sum + (Number.isFinite(leg.fee) ? leg.fee : 0), 0);
  const realized = totalExited > 0 && Number.isFinite(avgEntry) ? (exitValue - (avgEntry * totalExited)) - feeTotal : 0;
  const status = totalExited <= 0 ? 'Open' : (openQuantity <= 0 ? 'Closed' : 'Partially Closed');
  return { totalEntered, totalExited, avgEntry, avgExit, openQuantity, realized, status };
}

function updateRiskMetrics() {
  const entries = readExecutionLegs('entry');
  const exits = readExecutionLegs('exit');
  const summary = computeExecutionSummary(entries, exits);
  const currency = document.querySelector('#form-currency')?.value || 'GBP';
  const symbol = currencySymbols[currency] || '';
  const positionValue = Number.isFinite(summary.avgEntry) && summary.openQuantity > 0
    ? summary.avgEntry * summary.openQuantity
    : NaN;
  const setText = (id, val) => { const el = document.querySelector(id); if (el) el.textContent = val; };
  setText('#risk-metric-entered', Number.isFinite(summary.totalEntered) ? summary.totalEntered.toFixed(4).replace(/\.?0+$/, '') : '—');
  setText('#risk-metric-exited', Number.isFinite(summary.totalExited) ? summary.totalExited.toFixed(4).replace(/\.?0+$/, '') : '—');
  setText('#risk-metric-open-qty', Number.isFinite(summary.openQuantity) ? summary.openQuantity.toFixed(4).replace(/\.?0+$/, '') : '—');
  setText('#risk-metric-avg-entry', Number.isFinite(summary.avgEntry) ? `${symbol}${summary.avgEntry.toFixed(4)}` : '—');
  setText('#risk-metric-avg-exit', Number.isFinite(summary.avgExit) ? `${symbol}${summary.avgExit.toFixed(4)}` : '—');
  setText('#risk-metric-realised', `${symbol}${(Number(summary.realized) || 0).toFixed(2)}`);
  setText('#risk-metric-position-value', Number.isFinite(positionValue) ? `${symbol}${positionValue.toFixed(2)}` : '—');
  setText('#risk-metric-status', summary.status);
}

function bindRiskMetrics() {
  ['#form-stop', '#form-current-stop', '#form-currency', '#form-asset-class'].forEach((selector) => {
    document.querySelector(selector)?.addEventListener('input', updateRiskMetrics);
    document.querySelector(selector)?.addEventListener('change', updateRiskMetrics);
  });
  updateRiskMetrics();
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


function optionSummary(trade) {
  const type = trade.optionType ? String(trade.optionType).toUpperCase() : '';
  const strike = Number(trade.optionStrike);
  const expiry = trade.optionExpiration || '';
  const contracts = Number(trade.optionContracts);
  const parts = [];
  if (type) parts.push(type);
  if (Number.isFinite(strike) && strike > 0) parts.push(`$${strike.toFixed(2)}`);
  if (expiry) parts.push(expiry);
  if (Number.isFinite(contracts) && contracts > 0) parts.push(`${contracts} ctr`);
  return parts.join(' • ');
}

function toggleOptionsFields() {
  const assetClass = document.querySelector('#form-asset-class')?.value || '';
  const optionsFields = document.querySelector('#options-fields');
  const unitsField = document.querySelector('#stock-units-field');
  const unitsInput = document.querySelector('#form-units');
  const contractsInput = document.querySelector('#form-option-contracts');
  const optionTypeInput = document.querySelector('#form-option-type');
  const optionStrikeInput = document.querySelector('#form-option-strike');
  const optionExpirationInput = document.querySelector('#form-option-expiration');
  if (optionsFields) optionsFields.classList.toggle('is-hidden', assetClass !== 'options');
  if (unitsField) unitsField.classList.toggle('is-hidden', assetClass === 'options');
  if (unitsInput) unitsInput.required = assetClass !== 'options';
  if (contractsInput) contractsInput.required = assetClass === 'options';
  if (optionTypeInput) optionTypeInput.required = assetClass === 'options';
  if (optionStrikeInput) optionStrikeInput.required = assetClass === 'options';
  if (optionExpirationInput) optionExpirationInput.required = assetClass === 'options';
  updateRiskMetrics();
}

async function loadTrades() {
  readFilters();
  const query = toQuery(state.filters);
  const res = await api(`/api/trades${query}`);
  state.trades = Array.isArray(res.trades) ? res.trades : [];
  renderTrades();
}

async function shareTradeToGroupChat(trade) {
  if (!trade?.id) return;
  try {
    const sidebar = window.VeracityUtilitySidebar;
    if (!sidebar?.shareTradeToGroupChats) {
      throw new Error('Trading chat sidebar is unavailable.');
    }
    const groupName = await sidebar.shareTradeToGroupChats(trade.id);
    if (groupName) {
      alert(`Trade shared to ${groupName}.`);
    }
  } catch (error) {
    alert(error?.message || 'Unable to share trade to group chat.');
  }
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
    const aDate = Date.parse(a.openDate || '') || 0;
    const bDate = Date.parse(b.openDate || '') || 0;
    return bDate - aDate;
  });
  sortedTrades.forEach(trade => {
    const tr = document.createElement('tr');
    const dateCell = document.createElement('td');
    dateCell.textContent = trade.openDate || '—';
    tr.appendChild(dateCell);

    const symCell = document.createElement('td');
    const symLabel = document.createElement('span');
    symLabel.textContent = getTradeDisplaySymbol(trade);
    symCell.appendChild(symLabel);
    if (shouldShowMappingBadge(trade)) {
      symCell.appendChild(createMappingBadge());
    }
    if ((trade.assetClass || '').toLowerCase() === 'options') {
      const summary = optionSummary(trade);
      if (summary) {
        const meta = document.createElement('div');
        meta.className = 'metric-sub';
        meta.textContent = summary;
        symCell.appendChild(meta);
      }
    }
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
    sourceCell.textContent = trade.source === 'trading212'
      ? 'Trading 212'
      : (trade.source === 'ibkr' ? 'IBKR' : 'Manual');
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

    const shareBtn = document.createElement('button');
    shareBtn.className = 'ghost';
    shareBtn.textContent = 'Share';
    shareBtn.addEventListener('click', () => shareTradeToGroupChat(trade));
    wrap.appendChild(shareBtn);

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
  state.editingTrade = trade;
  document.querySelector('#form-title').textContent = 'Edit trade';
  document.querySelector('#trade-id').value = trade.id;
  document.querySelector('#form-symbol').value = getTradeDisplaySymbol(trade);
  document.querySelector('#form-currency').value = trade.currency || 'GBP';
  document.querySelector('#form-stop').value = trade.stop ?? '';
  const currentStopInput = document.querySelector('#form-current-stop');
  if (currentStopInput) currentStopInput.value = trade.currentStop ?? '';
  document.querySelector('#form-trade-type').value = trade.tradeType || 'day';
  document.querySelector('#form-asset-class').value = trade.assetClass || 'stocks';
  document.querySelector('#form-option-type').value = trade.optionType || '';
  document.querySelector('#form-option-strike').value = trade.optionStrike ?? '';
  document.querySelector('#form-option-expiration').value = trade.optionExpiration || '';
  document.querySelector('#form-option-contracts').value = trade.optionContracts ?? '';
  toggleOptionsFields();
  renderExecutionLegs(trade);
  document.querySelector('#form-strategy').value = trade.strategyTag || '';
  document.querySelector('#form-market-condition').value = trade.marketCondition || '';
  document.querySelector('#form-screenshot').value = trade.screenshotUrl || '';
  const isProviderTrade = trade.source === 'trading212' || trade.trading212Id || trade.source === 'ibkr' || trade.ibkrPositionId;
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
  toggleOptionsFields();
  document.querySelector('#form-notes').value = trade.note || '';
  updateRiskMetrics();
  const status = document.querySelector('#form-status');
  if (status) status.textContent = 'Editing existing trade';
  const mappingBadge = document.querySelector('#form-mapping-badge');
  const promoteBtn = document.querySelector('#form-promote-mapping-btn');
  if (mappingBadge) {
    mappingBadge.classList.toggle('is-hidden', !shouldShowMappingBadge(trade));
  }
  if (promoteBtn) {
    const canPromote = state.isAdmin && trade.mappingScope === 'user' && trade.mappingId;
    promoteBtn.classList.toggle('is-hidden', !canPromote);
    if (canPromote) {
      promoteBtn.dataset.mappingId = trade.mappingId;
    } else {
      promoteBtn.dataset.mappingId = '';
    }
  }
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
  toggleOptionsFields();
  renderExecutionLegs();
  updateRiskMetrics();
}

function resetForm() {
  state.editingId = null;
  state.editingTrade = null;
  document.querySelector('#trade-id').value = '';
  document.querySelector('#form-title').textContent = 'Log a trade';
  document.querySelector('#trade-form').reset();
  setCheckboxes('form-setup', []);
  setCheckboxes('form-emotion', []);
  applyDefaultsToForm();
  const status = document.querySelector('#form-status');
  if (status) status.textContent = 'Ready to log a new trade';
  document.querySelector('#form-mapping-badge')?.classList.add('is-hidden');
  document.querySelector('#form-promote-mapping-btn')?.classList.add('is-hidden');
  toggleOptionsFields();
  updateRiskMetrics();
}

function collectFormData() {
  const numberOrUndefined = (id) => {
    const raw = document.querySelector(id)?.value;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const num = Number(raw);
    return Number.isNaN(num) ? undefined : num;
  };
  const nullableNumber = (id) => {
    const raw = document.querySelector(id)?.value;
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return null;
    const num = Number(raw);
    return Number.isNaN(num) ? undefined : num;
  };
  const assetClass = document.querySelector('#form-asset-class')?.value;
  const optionContracts = numberOrUndefined('#form-option-contracts');
  const executions = [...readExecutionLegs('entry'), ...readExecutionLegs('exit')]
    .map((leg) => ({
      side: leg.side,
      quantity: leg.quantity,
      price: leg.price,
      date: leg.date,
      fee: Number.isFinite(leg.fee) ? leg.fee : 0,
      note: leg.note || ''
    }));

  return {
    displaySymbol: document.querySelector('#form-symbol')?.value,
    currency: document.querySelector('#form-currency')?.value || 'GBP',
    stop: nullableNumber('#form-stop'),
    currentStop: nullableNumber('#form-current-stop'),
    date: executions.find((leg) => leg.side === 'entry')?.date,
    tradeType: document.querySelector('#form-trade-type')?.value,
    assetClass,
    optionType: document.querySelector('#form-option-type')?.value,
    optionStrike: numberOrUndefined('#form-option-strike'),
    optionExpiration: document.querySelector('#form-option-expiration')?.value,
    optionContracts,
    strategyTag: document.querySelector('#form-strategy')?.value,
    marketCondition: document.querySelector('#form-market-condition')?.value,
    setupTags: selectedTags('form-setup'),
    emotionTags: selectedTags('form-emotion'),
    screenshotUrl: document.querySelector('#form-screenshot')?.value,
    note: document.querySelector('#form-notes')?.value,
    executions
  };
}

async function saveTrade(event) {
  event.preventDefault();
  const payload = collectFormData();
  const status = document.querySelector('#form-status');
  try {
    const summary = computeExecutionSummary(readExecutionLegs('entry'), readExecutionLegs('exit'));
    if (summary.totalEntered <= 0) {
      throw new Error('Add at least one valid entry execution');
    }
    if (summary.totalExited > summary.totalEntered) {
      throw new Error('Exit quantity total cannot exceed entered quantity total');
    }
    const isTrading212 = state.editingTrade?.source === 'trading212' || state.editingTrade?.trading212Id;
    if (state.editingId && isTrading212 && typeof window.computeSourceKey === 'function') {
      const instrument = {
        isin: state.editingTrade?.trading212Isin || '',
        uid: state.editingTrade?.trading212Id || '',
        ticker: state.editingTrade?.brokerTicker || state.editingTrade?.trading212Ticker || state.editingTrade?.symbol || '',
        currency: state.editingTrade?.currency || ''
      };
      const sourceKey = window.computeSourceKey(instrument);
      await api('/api/instrument-mappings/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceKey,
          brokerTicker: instrument.ticker,
          brokerName: state.editingTrade?.trading212Name || '',
          currency: instrument.currency,
          isin: instrument.isin,
          canonicalTicker: payload.displaySymbol || '',
          canonicalName: state.editingTrade?.trading212Name || ''
        })
      });
    }
    if (isTrading212) {
      delete payload.displaySymbol;
    }
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

function setIbkrImportFeedback(message, kind = 'info') {
  const panel = document.querySelector('#ibkr-import-summary');
  if (!panel) return;
  panel.classList.remove('is-hidden', 'success', 'error');
  panel.textContent = message || '';
  if (!message) {
    panel.classList.add('is-hidden');
    return;
  }
  if (kind === 'success') panel.classList.add('success');
  if (kind === 'error') panel.classList.add('error');
}

async function importIbkrCsv(file) {
  if (!file) return;
  const importButton = document.querySelector('#import-ibkr-btn');
  const fileInput = document.querySelector('#import-ibkr-file');
  if (importButton) {
    importButton.disabled = true;
    importButton.textContent = 'Importing...';
  }
  setIbkrImportFeedback('Validating and importing IBKR CSV...');
  try {
    const formData = new FormData();
    formData.append('file', file, file.name || 'ibkr-trades.csv');
    const result = await api('/api/trades/import/ibkr', {
      method: 'POST',
      body: formData
    });
    const summary = result?.summary || {};
    const imported = Number(summary.imported) || 0;
    const importedOpenings = Number(summary.importedOpenings) || 0;
    const importedExits = Number(summary.importedExits) || 0;
    const duplicates = Number(summary.duplicates) || 0;
    const invalidRows = Number(summary.invalidRows) || 0;
    const skippedCashRows = Number(summary.skippedCashRows) || 0;
    const unmatchedClosingRows = Number(summary.unmatchedClosingRows) || 0;
    let message = `IBKR import complete — ${imported} imported (${importedOpenings} openings, ${importedExits} exits), ${duplicates} skipped as duplicates, ${invalidRows} invalid rows, ${skippedCashRows} skipped CASH rows, ${unmatchedClosingRows} unmatched closing rows.`;
    if (Array.isArray(result?.errors) && result.errors.length) {
      const firstError = result.errors[0];
      message += ` First issue: row ${firstError.rowNumber} (${firstError.error}).`;
    }
    setIbkrImportFeedback(message, imported > 0 ? 'success' : 'info');
    await loadTrades();
    await loadIbkrImportHistory();
  } catch (error) {
    const reason = error?.message || 'Failed to import CSV.';
    setIbkrImportFeedback(`IBKR import failed: ${reason}`, 'error');
  } finally {
    if (importButton) {
      importButton.disabled = false;
      importButton.textContent = 'Import IBKR CSV';
    }
    if (fileInput) fileInput.value = '';
  }
}

function formatIsoDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function removeIbkrImportBatch(batch) {
  if (!batch?.id) return;
  const importedCount = Number(batch.importedCount) || 0;
  const duplicateCount = Number(batch.duplicateCount) || 0;
  const skippedCashCount = Number(batch.skippedCashCount) || 0;
  const invalidCount = Number(batch.invalidCount) || 0;
  const confirmed = window.confirm(
    `Remove trades from import "${batch.originalFilename || 'upload.csv'}"?\n\n`
    + `Imported: ${importedCount}\nDuplicates: ${duplicateCount}\nSkipped CASH: ${skippedCashCount}\nInvalid: ${invalidCount}\n\n`
    + 'This only removes entries/exits created by this import batch.'
  );
  if (!confirmed) return;
  try {
    await api(`/api/trades/import/ibkr/${encodeURIComponent(batch.id)}`, { method: 'DELETE' });
    setIbkrImportFeedback('Import batch removed. Trades linked to that batch were deleted.', 'success');
    await Promise.all([loadTrades(), loadIbkrImportHistory()]);
  } catch (error) {
    setIbkrImportFeedback(`Failed to remove import batch: ${error?.message || 'Unknown error.'}`, 'error');
  }
}

function renderIbkrImportHistory(batches = []) {
  const container = document.querySelector('#ibkr-import-history');
  const summary = document.querySelector('#ibkr-history-summary');
  const toggleHistoryButton = document.querySelector('#ibkr-toggle-history-btn');
  const toggleRemovedButton = document.querySelector('#ibkr-toggle-removed-btn');
  if (!container) return;
  if (!Array.isArray(batches) || !batches.length) {
    container.textContent = 'No IBKR imports yet.';
    container.classList.remove('ibkr-history-scroll');
    summary?.classList.add('is-hidden');
    if (toggleHistoryButton) toggleHistoryButton.classList.add('is-hidden');
    if (toggleRemovedButton) toggleRemovedButton.classList.add('is-hidden');
    return;
  }
  const removedCount = batches.filter(batch => (batch?.status || 'completed') === 'rolled_back').length;
  const activeCount = batches.length - removedCount;
  const visibleBatches = batches.filter((batch) => {
    const status = batch?.status || 'completed';
    return state.ibkrHistory.showRemoved || status !== 'rolled_back';
  });
  const hiddenByStatusCount = Math.max(0, batches.length - visibleBatches.length);
  const limitedBatches = state.ibkrHistory.showAll
    ? visibleBatches
    : visibleBatches.slice(0, state.ibkrHistory.collapsedLimit);
  const hiddenByLimitCount = Math.max(0, visibleBatches.length - limitedBatches.length);
  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'ibkr-history-list';
  limitedBatches.forEach((batch) => {
    const row = document.createElement('div');
    row.className = 'ibkr-history-row';
    const status = batch.status || 'completed';
    const removed = status === 'rolled_back';
    if (removed) row.classList.add('is-removed');
    row.innerHTML = `
      <div class="ibkr-history-main">
        <div class="ibkr-history-file">${batch.originalFilename || 'upload.csv'}</div>
        <div class="ibkr-history-meta">${formatIsoDateTime(batch.importedAt)}</div>
      </div>
      <div class="ibkr-history-status ${removed ? 'is-removed' : 'is-complete'}">${removed ? 'Removed' : 'Completed'}</div>
      <div class="ibkr-history-metrics">
        <span class="ibkr-metric-chip">Imported <strong>${Number(batch.importedCount) || 0}</strong></span>
        <span class="ibkr-metric-chip">Openings <strong>${Number(batch?.metadata?.importedOpenings) || 0}</strong></span>
        <span class="ibkr-metric-chip">Exits <strong>${Number(batch?.metadata?.importedExits) || 0}</strong></span>
        <span class="ibkr-metric-chip">Duplicates <strong>${Number(batch.duplicateCount) || 0}</strong></span>
        <span class="ibkr-metric-chip">Unmatched closes <strong>${Number(batch?.metadata?.unmatchedClosingRows) || 0}</strong></span>
      </div>
      <div class="ibkr-history-actions">
        <button type="button" class="${removed ? 'ghost small' : 'danger small'}" ${removed ? 'disabled' : ''}>${removed ? 'Already removed' : 'Remove imported trades'}</button>
      </div>
    `;
    const button = row.querySelector('button');
    button.addEventListener('click', () => removeIbkrImportBatch(batch));
    list.appendChild(row);
  });
  if (!limitedBatches.length) {
    container.textContent = state.ibkrHistory.showRemoved
      ? 'No IBKR imports yet.'
      : 'No active imports to show. Toggle “Show removed” to review archived entries.';
    container.classList.remove('ibkr-history-scroll');
  } else {
    container.appendChild(list);
    container.classList.toggle('ibkr-history-scroll', state.ibkrHistory.showAll && limitedBatches.length > 5);
  }
  if (summary) {
    summary.classList.remove('is-hidden');
    const hiddenParts = [];
    if (hiddenByStatusCount > 0 && !state.ibkrHistory.showRemoved) hiddenParts.push(`${hiddenByStatusCount} removed hidden`);
    if (hiddenByLimitCount > 0 && !state.ibkrHistory.showAll) hiddenParts.push(`${hiddenByLimitCount} older hidden`);
    summary.textContent = `${activeCount} active · ${removedCount} removed${hiddenParts.length ? ` · ${hiddenParts.join(' · ')}` : ''}`;
  }
  if (toggleHistoryButton) {
    const canExpand = visibleBatches.length > state.ibkrHistory.collapsedLimit;
    toggleHistoryButton.classList.toggle('is-hidden', !canExpand && !state.ibkrHistory.showAll);
    toggleHistoryButton.textContent = state.ibkrHistory.showAll ? 'Collapse history' : `View all history (${visibleBatches.length})`;
  }
  if (toggleRemovedButton) {
    toggleRemovedButton.classList.toggle('is-hidden', removedCount < 1);
    toggleRemovedButton.classList.toggle('active', state.ibkrHistory.showRemoved);
    toggleRemovedButton.textContent = state.ibkrHistory.showRemoved
      ? `Hide removed (${removedCount})`
      : `Show removed (${removedCount})`;
  }
}

async function loadIbkrImportHistory() {
  try {
    const result = await api('/api/trades/import/ibkr/history');
    state.ibkrHistory.batches = Array.isArray(result?.batches) ? result.batches : [];
    renderIbkrImportHistory(state.ibkrHistory.batches);
  } catch (_error) {
    state.ibkrHistory.batches = [];
    renderIbkrImportHistory([]);
  }
}

function bindNav() {
  const closeNav = setupNavDrawer();
  document.querySelector('#calendar-btn')?.addEventListener('click', () => window.location.href = '/');
  document.querySelector('#analytics-btn')?.addEventListener('click', () => window.location.href = '/analytics.html');
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
    document.querySelector('#trade-settings-modal')?.classList.remove('hidden');
  });
  api('/api/profile')
    .then(profile => {
      state.isAdmin = !!profile?.isAdmin;
      const show = profile?.username === 'mevs.0404@gmail.com' || profile?.username === 'dummy1';
      document.querySelectorAll('#devtools-btn').forEach(btn => btn.classList.toggle('is-hidden', !show));
    })
    .catch(() => {
      state.isAdmin = false;
      document.querySelectorAll('#devtools-btn').forEach(btn => btn.classList.add('is-hidden'));
    });
}

function bindForm() {
  document.querySelector('#trade-form')?.addEventListener('submit', saveTrade);
  document.querySelector('#add-entry-leg-btn')?.addEventListener('click', () => {
    document.querySelector('#entry-legs')?.appendChild(createExecutionLegRow('entry'));
    updateRiskMetrics();
  });
  document.querySelector('#add-exit-leg-btn')?.addEventListener('click', () => {
    document.querySelector('#exit-legs')?.appendChild(createExecutionLegRow('exit'));
    updateRiskMetrics();
  });
  document.querySelector('#reset-form-btn')?.addEventListener('click', resetForm);
  document.querySelector('#apply-filters-btn')?.addEventListener('click', applyFilters);
  document.querySelector('#reset-filters-btn')?.addEventListener('click', resetFilters);
  document.querySelector('#export-csv-btn')?.addEventListener('click', exportCsv);
  document.querySelector('#import-ibkr-btn')?.addEventListener('click', () => {
    document.querySelector('#import-ibkr-file')?.click();
  });
  document.querySelector('#import-ibkr-file')?.addEventListener('change', (event) => {
    const file = event?.target?.files?.[0];
    importIbkrCsv(file);
  });
  document.querySelector('#ibkr-toggle-history-btn')?.addEventListener('click', () => {
    state.ibkrHistory.showAll = !state.ibkrHistory.showAll;
    renderIbkrImportHistory(state.ibkrHistory.batches);
  });
  document.querySelector('#ibkr-toggle-removed-btn')?.addEventListener('click', () => {
    state.ibkrHistory.showRemoved = !state.ibkrHistory.showRemoved;
    renderIbkrImportHistory(state.ibkrHistory.batches);
  });
  document.querySelector('#add-trade-btn')?.addEventListener('click', () => {
    resetForm();
    document.querySelector('#trade-form-modal')?.classList.remove('hidden');
  });
  document.querySelector('#close-trade-form-btn')?.addEventListener('click', () => {
    document.querySelector('#trade-form-modal')?.classList.add('hidden');
  });
  document.querySelector('#cancel-trade-form-btn')?.addEventListener('click', () => {
    document.querySelector('#trade-form-modal')?.classList.add('hidden');
  });
  document.querySelector('#form-asset-class')?.addEventListener('change', toggleOptionsFields);
  bindRiskMetrics();
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
  document.querySelector('#form-promote-mapping-btn')?.addEventListener('click', async () => {
    const button = document.querySelector('#form-promote-mapping-btn');
    const status = document.querySelector('#form-status');
    const mappingId = Number(button?.dataset?.mappingId);
    if (!mappingId) return;
    if (!window.confirm('Promote this ticker mapping for all users?')) {
      return;
    }
    if (status) status.textContent = '';
    try {
      await api('/api/instrument-mappings/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappingId })
      });
      if (status) {
        status.textContent = 'Mapping promoted globally.';
        status.classList.add('success');
      }
      await loadTrades();
    } catch (e) {
      if (status) {
        status.textContent = e?.message || 'Failed to promote mapping.';
        status.classList.remove('success');
      }
    }
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
  await loadIbkrImportHistory();
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
