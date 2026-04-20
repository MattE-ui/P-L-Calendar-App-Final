const state = {
  trades: [],
  sortedTrades: [],
  tradeDetailCache: new Map(),
  listSignature: '',
  rowSignatures: new Map(),
  rowCache: new Map(),
  pagination: {
    limit: 100,
    offset: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
    clientPage: 1,
    pageSize: 25
  },
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
  sort: { key: 'date-desc' },
  searchText: '',
  selectedIds: new Set(),
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
    collapsedLimit: 4,
    panelExpanded: false
  }
};

function buildTradeSignature(trade) {
  return [
    trade?.id || '',
    trade?.openDate || '',
    trade?.closeDate || '',
    trade?.status || '',
    trade?.displayTicker || trade?.displaySymbol || trade?.symbol || '',
    trade?.brokerTicker || '',
    trade?.mappingScope || '',
    trade?.tradeType || '',
    trade?.assetClass || '',
    Number(trade?.guaranteedPnlGBP) || 0,
    Number(trade?.realizedPnlGBP) || 0,
    trade?.source || '',
    trade?.strategyTag || '',
    Array.isArray(trade?.setupTags) ? trade.setupTags.join('|') : '',
    Array.isArray(trade?.emotionTags) ? trade.emotionTags.join('|') : ''
  ].join('¦');
}

function buildTradeListSignature(trades = []) {
  return trades.map(buildTradeSignature).join('||');
}

function sortTradesByOpenDate(trades = []) {
  return [...trades].sort((a, b) => {
    const aDate = Date.parse(a.openDate || '') || 0;
    const bDate = Date.parse(b.openDate || '') || 0;
    return bDate - aDate;
  });
}

function setTrades(nextTrades = [], { source = 'api' } = {}) {
  const normalized = Array.isArray(nextTrades) ? nextTrades : [];
  const nextSignature = buildTradeListSignature(normalized);
  if (nextSignature === state.listSignature) {
    window.PerfDiagnostics?.log('trades-refresh-skipped', { source, reason: 'same-signature', count: normalized.length });
    return false;
  }
  state.trades = normalized;
  state.sortedTrades = sortTradesByOpenDate(normalized);
  state.listSignature = nextSignature;
  return true;
}

function upsertTradeInState(trade, { source = 'action' } = {}) {
  if (!trade?.id) return false;
  state.tradeDetailCache.set(trade.id, trade);
  const list = [...state.trades];
  const index = list.findIndex(item => item.id === trade.id);
  if (index >= 0) list[index] = trade;
  else list.push(trade);
  const changed = setTrades(list, { source });
  if (changed) {
    window.PerfDiagnostics?.log('trades-action-patch-applied', { source, action: 'upsert', tradeId: trade.id });
  }
  return changed;
}

function patchLocalTradeStateAfterSave(savedTrade, { source = 'edit' } = {}) {
  if (!savedTrade?.id) return false;
  console.info('[display-name-ui] save success payload', {
    tradeId: savedTrade.id,
    displayTicker: savedTrade.displayTicker || savedTrade.displaySymbol || savedTrade.symbol || null,
    brokerTicker: savedTrade.brokerTicker || null,
    source
  });
  const changed = upsertTradeInState(savedTrade, { source });
  if (state.editingId && String(state.editingId) === String(savedTrade.id)) {
    state.editingTrade = savedTrade;
  }
  console.info(`[display-name-ui] local state patched for trade id ${savedTrade.id}`);
  console.info('[display-name-ui] selected trade/source after patch', {
    editingId: state.editingId || null,
    editingTradeId: state.editingTrade?.id || null,
    editingDisplayTicker: state.editingTrade?.displayTicker || state.editingTrade?.displaySymbol || state.editingTrade?.symbol || null,
    cacheHasTrade: state.tradeDetailCache.has(savedTrade.id)
  });
  return changed;
}

function removeTradeFromState(tradeId, { source = 'action' } = {}) {
  if (!tradeId) return false;
  state.tradeDetailCache.delete(tradeId);
  const next = state.trades.filter(item => item.id !== tradeId);
  const changed = setTrades(next, { source });
  if (changed) {
    window.PerfDiagnostics?.log('trades-action-patch-applied', { source, action: 'delete', tradeId });
  }
  return changed;
}

const currencySymbols = { GBP: '£', USD: '$', EUR: '€' };

async function api(path, opts = {}) {
  const isGuest = sessionStorage.getItem('guestMode') === 'true' || localStorage.getItem('guestMode') === 'true';
  const method = (opts.method || 'GET').toUpperCase();
  if (isGuest && typeof window.handleGuestRequest === 'function') {
    return window.handleGuestRequest(path, opts);
  }
  const fetchPromise = fetch(path, { credentials: 'include', ...opts });
  const res = window.PerfDiagnostics
    ? await window.PerfDiagnostics.trackApi(`trades-api:${method}:${path}`, fetchPromise)
    : await fetchPromise;
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


async function getBootstrapProfile({ consumer = 'trades' } = {}) {
  if (window.AppBootstrap?.getProfile) {
    return window.AppBootstrap.getProfile({ consumer, detail: 'shell' });
  }
  return api('/api/profile/bootstrap');
}

async function loadHeroMetrics() {
  try {
    const res = await api('/api/portfolio');
    const portfolio = Number(res?.portfolioValue ?? res?.portfolio);
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


function pushFiltersToUrl() {
  if (!window.history?.replaceState) return;
  const params = new URLSearchParams();
  Object.entries(state.filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  const search = params.toString();
  history.replaceState(null, '', location.pathname + (search ? '?' + search : ''));
}

function readFiltersFromUrl() {
  const params = new URLSearchParams(location.search);
  const keys = ['from', 'to', 'symbol', 'tradeType', 'assetClass', 'strategyTag', 'tags', 'winLoss'];
  keys.forEach(k => {
    const v = params.get(k) || '';
    const input = document.querySelector(`#filter-${k === 'tradeType' ? 'trade-type' : k === 'assetClass' ? 'asset-class' : k === 'strategyTag' ? 'strategy' : k === 'winLoss' ? 'winloss' : k}`);
    if (input && v) input.value = v;
  });
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
  state.pagination.clientPage = 1;
  const query = toQuery({
    ...state.filters,
    limit: state.pagination.limit,
    offset: 0,
    summaryMode: 1
  });
  const startedAt = window.PerfDiagnostics?.mark('trades-load-start');
  const res = await api(`/api/trades${query}`);
  state.pagination.offset = Number(res?.offset) || 0;
  state.pagination.total = Number(res?.total) || 0;
  state.pagination.hasMore = Boolean(res?.hasMore);
  state.tradeDetailCache.clear();
  const changed = setTrades(Array.isArray(res.trades) ? res.trades : [], { source: 'api' });
  if (changed) {
    renderTrades();
  } else {
    renderSummaryStrip();
    renderPaginationFooter();
    window.PerfDiagnostics?.log('trades-list-reused', { count: state.trades.length });
  }
  renderFilterPills();
  updateSubtitle();
  pushFiltersToUrl();
  window.PerfDiagnostics?.log('trades-summary-page-loaded', {
    summaryModeUsed: Boolean(res?.summaryMode),
    initialWindowSize: state.trades.length,
    hasMore: state.pagination.hasMore,
    total: state.pagination.total
  });
  if (startedAt) window.PerfDiagnostics?.measure('trades-load-end', startedAt, { changed, count: state.trades.length, hasMore: state.pagination.hasMore, total: state.pagination.total });
}

async function loadMoreTrades() {
  if (state.pagination.loadingMore || !state.pagination.hasMore) return;
  state.pagination.loadingMore = true;
  updateLoadMoreUi();
  try {
    const query = toQuery({
      ...state.filters,
      limit: state.pagination.limit,
      offset: state.trades.length,
      summaryMode: 1
    });
    const res = await api(`/api/trades${query}`);
    const nextChunk = Array.isArray(res?.trades) ? res.trades : [];
    state.pagination.offset = Number(res?.offset) || state.trades.length;
    state.pagination.total = Number(res?.total) || state.pagination.total;
    state.pagination.hasMore = Boolean(res?.hasMore);
    if (nextChunk.length) {
      setTrades([...state.trades, ...nextChunk], { source: 'api:load-more' });
      renderTrades();
    }
    window.PerfDiagnostics?.log('trades-pagination-load-more', { fetched: nextChunk.length, loadedRows: state.trades.length, hasMore: state.pagination.hasMore });
  } finally {
    state.pagination.loadingMore = false;
    updateLoadMoreUi();
  }
}

async function getTradeDetail(tradeId) {
  if (!tradeId) return null;
  if (state.tradeDetailCache.has(tradeId)) return state.tradeDetailCache.get(tradeId);
  const result = await api(`/api/trades/${tradeId}`);
  const trade = result?.trade || null;
  if (trade) {
    state.tradeDetailCache.set(tradeId, trade);
    window.PerfDiagnostics?.log('trades-detail-loaded', { tradeId, detailLoadedOnDemand: true });
  }
  return trade;
}

async function withTradeDetail(trade, callback) {
  if (!trade?.id) return;
  const detail = await getTradeDetail(trade.id);
  if (!detail) throw new Error('Unable to load trade details');
  return callback(detail);
}

function updateLoadMoreUi() {
  renderPaginationFooter();
}

/* ── Summary strip ─────────────────────────────────────── */
function computeTradesSummary(trades) {
  const closed = trades.filter(t => t.status === 'closed' || (t.closeDate && !t.status));
  const open = trades.filter(t => t.status === 'open' || (!t.closeDate && !t.status));
  const wins = closed.filter(t => Number(t.realizedPnlGBP) > 0);
  const totalPnl = closed.reduce((sum, t) => sum + (Number(t.realizedPnlGBP) || 0), 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : null;
  const rValues = closed.map(t => t.rMultiple).filter(r => r !== null && r !== undefined && Number.isFinite(Number(r)));
  const avgR = rValues.length ? rValues.reduce((s, r) => s + Number(r), 0) / rValues.length : null;
  return {
    totalTrades: trades.length,
    winRate,
    avgR,
    realisedPnl: totalPnl,
    openPositions: open.length
  };
}

function renderSummaryStrip() {
  const metrics = computeTradesSummary(state.trades);
  const totalEl = document.querySelector('#tj-metric-total');
  const winRateEl = document.querySelector('#tj-metric-winrate');
  const avgREl = document.querySelector('#tj-metric-avgr');
  const pnlEl = document.querySelector('#tj-metric-pnl');
  const openEl = document.querySelector('#tj-metric-open');
  if (totalEl) totalEl.textContent = metrics.totalTrades;
  if (winRateEl) {
    winRateEl.textContent = metrics.winRate !== null ? `${metrics.winRate.toFixed(1)}%` : '—';
    winRateEl.className = 'tj-metric-value';
  }
  if (avgREl) {
    if (metrics.avgR !== null) {
      const sign = metrics.avgR >= 0 ? '+' : '';
      avgREl.textContent = `${sign}${metrics.avgR.toFixed(1)}R`;
      avgREl.className = `tj-metric-value ${metrics.avgR > 0 ? 'positive' : metrics.avgR < 0 ? 'negative' : ''}`;
    } else {
      avgREl.textContent = '—';
      avgREl.className = 'tj-metric-value';
    }
  }
  if (pnlEl) {
    const pnl = metrics.realisedPnl;
    pnlEl.textContent = pnl !== 0 ? formatSignedCurrency(pnl) : `${currencySymbols[state.currency] || '£'}0.00`;
    pnlEl.className = `tj-metric-value ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`;
  }
  if (openEl) openEl.textContent = metrics.openPositions;
}

/* ── Page subtitle ─────────────────────────────────────── */
function updateSubtitle() {
  const el = document.querySelector('#tj-subtitle');
  if (!el) return;
  const total = state.pagination.total || state.trades.length;
  const symbols = new Set(state.trades.map(t => getTradeDisplaySymbol(t)).filter(s => s && s !== '—'));
  const lastBatch = state.ibkrHistory.batches.find(b => (b.status || 'completed') !== 'rolled_back');
  const parts = [`${total} trade${total !== 1 ? 's' : ''} across ${symbols.size} symbol${symbols.size !== 1 ? 's' : ''}`];
  if (lastBatch?.importedAt) {
    const d = new Date(lastBatch.importedAt);
    if (!Number.isNaN(d.getTime())) {
      parts.push(`last imported ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`);
    }
  }
  el.textContent = parts.join(' · ');
}

/* ── Filter bar pills ──────────────────────────────────── */
const SORT_LABELS = {
  'date-desc': 'Date, newest',
  'date-asc': 'Date, oldest',
  'pnl-desc': 'Result, highest',
  'pnl-asc': 'Result, lowest',
  'symbol-asc': 'Symbol, A–Z'
};

const TYPE_LABELS = { '': 'Any', scalp: 'Scalp', day: 'Day', swing: 'Swing', position: 'Position' };
const ASSET_LABELS = { '': 'Any', stocks: 'Stocks', options: 'Options', forex: 'Forex', crypto: 'Crypto', futures: 'Futures', other: 'Other' };
const RESULT_LABELS = { '': 'Any', win: 'Win', loss: 'Loss' };

function makePillSvgChevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('tj-pill-chevron');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', '4,6 8,10 12,6');
  svg.appendChild(poly);
  return svg;
}

function closeAllPopovers(except = null) {
  document.querySelectorAll('.tj-pill-popover, .tj-add-filter-menu, #tj-sort-dropdown').forEach(el => {
    if (el !== except) el.classList.add('is-hidden');
  });
}

function renderFilterPills() {
  const container = document.querySelector('#tj-filter-pills');
  if (!container) return;
  container.innerHTML = '';

  // Date pill
  const datePill = document.createElement('button');
  datePill.type = 'button';
  const from = state.filters.from;
  const to = state.filters.to;
  let dateLabel = 'Date: All';
  if (from && to) dateLabel = `${from} – ${to}`;
  else if (from) dateLabel = `From ${from}`;
  else if (to) dateLabel = `To ${to}`;
  datePill.className = `tj-filter-pill${(from || to) ? ' is-applied' : ''}`;
  datePill.textContent = dateLabel;
  datePill.appendChild(makePillSvgChevron());
  container.appendChild(datePill);

  const datePop = document.createElement('div');
  datePop.className = 'tj-pill-popover is-hidden';
  datePop.innerHTML = `
    <div class="tj-popover-date-row">
      <input type="date" id="tjp-from" value="${from}" placeholder="From">
      <input type="date" id="tjp-to" value="${to}" placeholder="To">
    </div>
    <button class="tj-popover-apply">Apply</button>
  `;
  datePop.querySelector('.tj-popover-apply').addEventListener('click', () => {
    document.querySelector('#filter-from').value = datePop.querySelector('#tjp-from').value;
    document.querySelector('#filter-to').value = datePop.querySelector('#tjp-to').value;
    closeAllPopovers();
    applyFilters();
  });
  datePill.style.position = 'relative';
  datePill.appendChild(datePop);
  datePill.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = datePop.classList.contains('is-hidden');
    closeAllPopovers();
    datePop.classList.toggle('is-hidden', !isHidden);
  });

  // Type pill
  const typePill = document.createElement('button');
  typePill.type = 'button';
  const typeVal = state.filters.tradeType;
  typePill.className = `tj-filter-pill${typeVal ? ' is-applied' : ''}`;
  typePill.textContent = `Type: ${TYPE_LABELS[typeVal] || typeVal || 'Any'}`;
  typePill.appendChild(makePillSvgChevron());
  container.appendChild(typePill);

  const typePop = document.createElement('div');
  typePop.className = 'tj-pill-popover is-hidden';
  Object.entries(TYPE_LABELS).forEach(([val, label]) => {
    const btn = document.createElement('button');
    btn.className = `tj-popover-option${typeVal === val ? ' is-selected' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      document.querySelector('#filter-trade-type').value = val;
      closeAllPopovers();
      applyFilters();
    });
    typePop.appendChild(btn);
  });
  typePill.style.position = 'relative';
  typePill.appendChild(typePop);
  typePill.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = typePop.classList.contains('is-hidden');
    closeAllPopovers();
    typePop.classList.toggle('is-hidden', !isHidden);
  });

  // Asset pill
  const assetPill = document.createElement('button');
  assetPill.type = 'button';
  const assetVal = state.filters.assetClass;
  assetPill.className = `tj-filter-pill${assetVal ? ' is-applied' : ''}`;
  assetPill.textContent = `Asset: ${ASSET_LABELS[assetVal] || assetVal || 'Any'}`;
  assetPill.appendChild(makePillSvgChevron());
  container.appendChild(assetPill);

  const assetPop = document.createElement('div');
  assetPop.className = 'tj-pill-popover is-hidden';
  Object.entries(ASSET_LABELS).forEach(([val, label]) => {
    const btn = document.createElement('button');
    btn.className = `tj-popover-option${assetVal === val ? ' is-selected' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      document.querySelector('#filter-asset-class').value = val;
      closeAllPopovers();
      applyFilters();
    });
    assetPop.appendChild(btn);
  });
  assetPill.style.position = 'relative';
  assetPill.appendChild(assetPop);
  assetPill.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = assetPop.classList.contains('is-hidden');
    closeAllPopovers();
    assetPop.classList.toggle('is-hidden', !isHidden);
  });

  // Applied optional filters as removable pills
  if (state.filters.strategyTag) {
    const p = buildRemovablePill(`Strategy: ${state.filters.strategyTag}`, () => {
      document.querySelector('#filter-strategy').value = '';
      applyFilters();
    });
    container.appendChild(p);
  }
  if (state.filters.tags) {
    const p = buildRemovablePill(`Tags: ${state.filters.tags}`, () => {
      document.querySelector('#filter-tags').value = '';
      applyFilters();
    });
    container.appendChild(p);
  }
  if (state.filters.winLoss) {
    const p = buildRemovablePill(`Result: ${RESULT_LABELS[state.filters.winLoss] || state.filters.winLoss}`, () => {
      document.querySelector('#filter-winloss').value = '';
      applyFilters();
    });
    container.appendChild(p);
  }

  // + Add filter pill
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'tj-add-filter-pill';
  addBtn.innerHTML = '+ Add filter';
  container.appendChild(addBtn);

  const addMenu = document.createElement('div');
  addMenu.className = 'tj-add-filter-menu is-hidden';
  addMenu.style.position = 'absolute';

  const addMenuItems = [
    { label: 'Strategy tag', action: () => { const v = window.prompt('Strategy tag'); if (v !== null) { document.querySelector('#filter-strategy').value = v; applyFilters(); } } },
    { label: 'Tags', action: () => { const v = window.prompt('Tags (comma separated)'); if (v !== null) { document.querySelector('#filter-tags').value = v; applyFilters(); } } },
    { label: 'Result', action: () => {
      const v = window.prompt('Result (win/loss)');
      if (v !== null) { document.querySelector('#filter-winloss').value = v.toLowerCase().trim() === 'win' ? 'win' : v.toLowerCase().trim() === 'loss' ? 'loss' : ''; applyFilters(); }
    }}
  ];
  addMenuItems.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'tj-popover-option';
    btn.textContent = item.label;
    btn.addEventListener('click', () => { closeAllPopovers(); item.action(); });
    addMenu.appendChild(btn);
  });
  addBtn.style.position = 'relative';
  addBtn.appendChild(addMenu);
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = addMenu.classList.contains('is-hidden');
    closeAllPopovers();
    addMenu.classList.toggle('is-hidden', !isHidden);
  });
}

function buildRemovablePill(label, onRemove) {
  const pill = document.createElement('span');
  pill.className = 'tj-filter-pill is-applied';
  pill.textContent = label;
  const removeBtn = document.createElement('button');
  removeBtn.className = 'tj-pill-remove';
  removeBtn.type = 'button';
  removeBtn.setAttribute('aria-label', `Remove ${label} filter`);
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
  pill.appendChild(removeBtn);
  return pill;
}

/* ── Sort helpers ──────────────────────────────────────── */
function applySort(trades, key) {
  const arr = [...trades];
  if (key === 'date-asc') return arr.sort((a, b) => (a.openDate || '') > (b.openDate || '') ? 1 : -1);
  if (key === 'pnl-desc') return arr.sort((a, b) => (Number(b.realizedPnlGBP) || 0) - (Number(a.realizedPnlGBP) || 0));
  if (key === 'pnl-asc') return arr.sort((a, b) => (Number(a.realizedPnlGBP) || 0) - (Number(b.realizedPnlGBP) || 0));
  if (key === 'symbol-asc') return arr.sort((a, b) => getTradeDisplaySymbol(a).localeCompare(getTradeDisplaySymbol(b)));
  return arr.sort((a, b) => (b.openDate || '') > (a.openDate || '') ? 1 : -1); // date-desc default
}

function updateSortPillLabel() {
  const label = document.querySelector('#tj-sort-label');
  if (label) label.textContent = `Sort: ${SORT_LABELS[state.sort.key] || state.sort.key}`;
  document.querySelectorAll('.tj-sort-option').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.sort === state.sort.key);
  });
}

/* ── Client-side filtered + paged view ────────────────── */
function getVisibleTrades() {
  const sorted = applySort(state.sortedTrades, state.sort.key);
  const search = state.searchText.toLowerCase().trim();
  const filtered = search ? sorted.filter(t => {
    const sym = getTradeDisplaySymbol(t).toLowerCase();
    const tags = [
      ...(t.setupTags || []),
      ...(t.emotionTags || []),
      t.strategyTag || '',
      t.strategyTag || ''
    ].join(' ').toLowerCase();
    const note = (t.note || '').toLowerCase();
    return sym.includes(search) || tags.includes(search) || note.includes(search);
  }) : sorted;
  const { clientPage, pageSize } = state.pagination;
  const start = (clientPage - 1) * pageSize;
  return {
    visible: filtered.slice(start, start + pageSize),
    filtered,
    total: filtered.length
  };
}

/* ── Pagination footer ─────────────────────────────────── */
function renderPaginationFooter() {
  const infoEl = document.querySelector('#tj-pagination-info');
  const ctrlEl = document.querySelector('#tj-pagination-controls');
  if (!infoEl || !ctrlEl) return;

  const { visible, filtered, total } = getVisibleTrades();
  const { clientPage, pageSize } = state.pagination;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (clientPage - 1) * pageSize + 1;
  const end = Math.min(clientPage * pageSize, total);
  const serverTotal = state.pagination.total;

  infoEl.textContent = total === 0 ? 'No trades' : `Showing ${start}–${end} of ${serverTotal} trades`;

  ctrlEl.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'tj-page-btn';
  prevBtn.innerHTML = '&#8249;';
  prevBtn.disabled = clientPage <= 1;
  prevBtn.addEventListener('click', () => {
    if (clientPage > 1) { state.pagination.clientPage--; renderTrades(); }
  });
  ctrlEl.appendChild(prevBtn);

  const makePageBtn = (page, label = page) => {
    const btn = document.createElement('button');
    btn.className = `tj-page-btn${page === clientPage ? ' is-active' : ''}`;
    btn.textContent = label;
    btn.disabled = page === clientPage;
    btn.addEventListener('click', () => {
      if (page !== clientPage) { state.pagination.clientPage = page; renderTrades(); }
    });
    return btn;
  };

  const makeEllipsis = () => {
    const span = document.createElement('span');
    span.className = 'tj-page-ellipsis';
    span.textContent = '…';
    return span;
  };

  if (totalPages <= 7) {
    for (let p = 1; p <= totalPages; p++) ctrlEl.appendChild(makePageBtn(p));
  } else {
    ctrlEl.appendChild(makePageBtn(1));
    if (clientPage > 3) ctrlEl.appendChild(makeEllipsis());
    const lo = Math.max(2, clientPage - 1);
    const hi = Math.min(totalPages - 1, clientPage + 1);
    for (let p = lo; p <= hi; p++) ctrlEl.appendChild(makePageBtn(p));
    if (clientPage < totalPages - 2) ctrlEl.appendChild(makeEllipsis());
    ctrlEl.appendChild(makePageBtn(totalPages));
  }

  const nextBtn = document.createElement('button');
  nextBtn.className = 'tj-page-btn';
  nextBtn.innerHTML = '&#8250;';
  const atLastClientPage = clientPage >= totalPages;
  nextBtn.disabled = atLastClientPage && !state.pagination.hasMore;
  nextBtn.addEventListener('click', async () => {
    if (!atLastClientPage) {
      state.pagination.clientPage++;
      renderTrades();
    } else if (state.pagination.hasMore) {
      await loadMoreTrades();
      state.pagination.clientPage++;
      renderTrades();
    }
  });
  ctrlEl.appendChild(nextBtn);
}

/* ── Bulk action bar ───────────────────────────────────── */
function renderBulkBar() {
  const bar = document.querySelector('#tj-bulk-bar');
  const countEl = document.querySelector('#tj-bulk-count');
  if (!bar || !countEl) return;
  const count = state.selectedIds.size;
  bar.classList.toggle('is-hidden', count === 0);
  countEl.textContent = `${count} selected`;
  const selectAll = document.querySelector('#tj-select-all');
  if (selectAll) {
    const { visible } = getVisibleTrades();
    const allSelected = visible.length > 0 && visible.every(t => state.selectedIds.has(t.id));
    const someSelected = visible.some(t => state.selectedIds.has(t.id));
    selectAll.checked = allSelected;
    selectAll.indeterminate = someSelected && !allSelected;
  }
}

/* ── Import status panel ───────────────────────────────── */
function renderImportPanel() {
  const panel = document.querySelector('#tj-import-panel');
  if (!panel) return;
  const activeBatch = state.ibkrHistory.batches.find(b => (b.status || 'completed') !== 'rolled_back');
  if (!activeBatch) {
    panel.classList.add('is-hidden');
    return;
  }
  panel.classList.remove('is-hidden');
  const imported = Number(activeBatch.importedCount) || 0;
  const openings = Number(activeBatch?.metadata?.importedOpenings) || 0;
  const exits = Number(activeBatch?.metadata?.importedExits) || 0;
  const duplicates = Number(activeBatch.duplicateCount) || 0;
  const unmatched = Number(activeBatch?.metadata?.unmatchedClosingRows) || 0;
  const filename = activeBatch.originalFilename || 'upload.csv';
  const when = formatIsoDateTime(activeBatch.importedAt);
  const source = (activeBatch.source || '').replace(/_/g, ' ') || '';

  const filenameEl = document.querySelector('#tj-import-filename');
  const metaEl = document.querySelector('#tj-import-meta');
  const countPillEl = document.querySelector('#tj-import-count-pill');
  const detailRowEl = document.querySelector('#tj-import-detail-row');
  const removedBtnCollapsed = document.querySelector('#tj-import-show-removed-btn');
  const removedBtnExpanded = document.querySelector('#tj-import-detail-removed-btn');

  if (filenameEl) filenameEl.textContent = filename;
  if (metaEl) metaEl.textContent = `${source ? source + ' · ' : ''}${when}`;
  if (countPillEl) countPillEl.textContent = `${imported} imported`;

  if (detailRowEl) {
    const successSpan = `<span class="success">${imported} imported</span>`;
    const openText = `${openings} openings, ${exits} exits`;
    const unmatchedText = unmatched > 0 ? ` · <span class="warning">${unmatched} unmatched close${unmatched !== 1 ? 's' : ''}</span>` : '';
    const dupText = duplicates > 0 ? ` · ${duplicates} duplicate${duplicates !== 1 ? 's' : ''} skipped` : '';
    detailRowEl.innerHTML = `${successSpan} · ${openText}${unmatchedText}${dupText}`;
  }

  const removedBatches = state.ibkrHistory.batches.filter(b => (b.status || 'completed') === 'rolled_back');
  const removedLabel = state.ibkrHistory.showRemoved
    ? `Hide removed (${removedBatches.length})`
    : `Show removed (${removedBatches.length})`;
  if (removedBtnCollapsed) {
    removedBtnCollapsed.textContent = removedLabel;
    removedBtnCollapsed.classList.toggle('is-hidden', removedBatches.length === 0);
  }
  if (removedBtnExpanded) {
    removedBtnExpanded.textContent = removedLabel;
    removedBtnExpanded.classList.toggle('is-hidden', removedBatches.length === 0);
  }

  const removeBtn = document.querySelector('#tj-import-remove-btn');
  const removeDetailBtn = document.querySelector('#tj-import-detail-remove-btn');
  const bindRemove = (btn) => {
    if (btn) btn.onclick = () => removeIbkrImportBatch(activeBatch);
  };
  bindRemove(removeBtn);
  bindRemove(removeDetailBtn);

  const removedHandler = () => {
    state.ibkrHistory.showRemoved = !state.ibkrHistory.showRemoved;
    renderIbkrImportHistory(state.ibkrHistory.batches);
    renderImportPanel();
  };
  if (removedBtnCollapsed) removedBtnCollapsed.onclick = removedHandler;
  if (removedBtnExpanded) removedBtnExpanded.onclick = removedHandler;

  // Expand/collapse panel
  const collapsed = document.querySelector('#tj-import-collapsed');
  const expanded = document.querySelector('#tj-import-expanded');
  if (collapsed) collapsed.classList.toggle('is-hidden', state.ibkrHistory.panelExpanded);
  if (expanded) expanded.classList.toggle('is-hidden', !state.ibkrHistory.panelExpanded);

  const expandBtn = document.querySelector('#tj-import-expand-btn');
  const collapseBtn = document.querySelector('#tj-import-collapse-btn');
  if (expandBtn) expandBtn.onclick = () => { state.ibkrHistory.panelExpanded = true; renderImportPanel(); };
  if (collapseBtn) collapseBtn.onclick = () => { state.ibkrHistory.panelExpanded = false; renderImportPanel(); };
}

async function shareTradeToGroupChat(trade) {
  if (!trade?.id) return;
  try {
    const sidebar = window.VeracityUtilitySidebar;
    if (!sidebar?.shareTradeToGroupChats) {
      throw new Error('Trading chat sidebar is unavailable.');
    }
    await sidebar.shareTradeToGroupChats(trade.id);
  } catch (error) {
    alert(error?.message || 'Unable to share trade to group chat.');
  }
}

function formatDateTwoLine(dateStr) {
  if (!dateStr) return { primary: '—', year: '' };
  const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return { primary: dateStr, year: '' };
  const primary = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const year = String(d.getFullYear());
  return { primary, year };
}

function formatSignedPnl(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sym = currencySymbols[state.currency] || '£';
  const abs = Math.abs(n);
  const rate = state.currency === 'GBP' ? 1 : (state.rates[state.currency] || 1);
  const converted = abs * rate;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${sym}${converted.toFixed(2)}`;
}

function getSourceLabel(trade) {
  if (trade.source === 'trading212') return 'Trading 212';
  if (trade.source === 'ibkr') return 'IBKR';
  return 'Manual';
}

function buildTradeRow(trade) {
  const signature = buildTradeSignature(trade);
  const row = document.createElement('div');
  row.className = 'tj-row';
  row.role = 'listitem';
  row.dataset.tradeId = trade.id;

  // Checkbox cell
  const checkCell = document.createElement('div');
  checkCell.className = 'tj-row-check';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = state.selectedIds.has(trade.id);
  checkbox.setAttribute('aria-label', `Select trade ${getTradeDisplaySymbol(trade)}`);
  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    if (checkbox.checked) state.selectedIds.add(trade.id);
    else state.selectedIds.delete(trade.id);
    renderBulkBar();
  });
  checkCell.appendChild(checkbox);
  row.appendChild(checkCell);

  // Date cell — two lines
  const dateCell = document.createElement('div');
  dateCell.className = 'tj-row-date';
  const { primary, year } = formatDateTwoLine(trade.openDate);
  const datePrimary = document.createElement('span');
  datePrimary.className = 'tj-date-primary';
  datePrimary.textContent = primary;
  const dateYear = document.createElement('span');
  dateYear.className = 'tj-date-year';
  dateYear.textContent = year;
  dateCell.appendChild(datePrimary);
  dateCell.appendChild(dateYear);
  row.appendChild(dateCell);

  // Symbol cell
  const symCell = document.createElement('div');
  symCell.className = 'tj-row-symbol';
  const symRow = document.createElement('div');
  symRow.className = 'tj-sym-row';
  const ticker = document.createElement('span');
  ticker.className = 'tj-sym-ticker';
  ticker.textContent = getTradeDisplaySymbol(trade);
  symRow.appendChild(ticker);
  if (shouldShowMappingBadge(trade)) {
    const badge = document.createElement('span');
    badge.className = 'tj-badge tj-badge-mapped';
    badge.textContent = 'MAPPED';
    symRow.appendChild(badge);
  }
  const tradeStatus = String(trade.status || '').toLowerCase();
  const isClosed = tradeStatus === 'closed';
  const isPartial = tradeStatus === 'partial';
  const isOpen = !isClosed && !isPartial;
  const statusBadgeInfo = isClosed
    ? { label: 'CLOSED', cls: 'tj-badge-closed' }
    : isPartial
      ? { label: 'PARTIAL', cls: 'tj-badge-partial' }
      : { label: 'OPEN', cls: 'tj-badge-open' };
  const statusBadge = document.createElement('span');
  statusBadge.className = `tj-badge ${statusBadgeInfo.cls}`;
  statusBadge.textContent = statusBadgeInfo.label;
  symRow.appendChild(statusBadge);
  symCell.appendChild(symRow);
  if ((trade.assetClass || '').toLowerCase() === 'options') {
    const summary = optionSummary(trade);
    if (summary) {
      const meta = document.createElement('div');
      meta.className = 'tj-sym-meta';
      meta.textContent = summary;
      symCell.appendChild(meta);
    }
  }
  row.appendChild(symCell);

  // Type cell
  const typeCell = document.createElement('div');
  typeCell.className = 'tj-row-type';
  const typeText = trade.tradeType || '—';
  typeCell.textContent = typeText.charAt(0).toUpperCase() + typeText.slice(1);
  row.appendChild(typeCell);

  // Asset cell
  const assetCell = document.createElement('div');
  assetCell.className = 'tj-row-asset';
  const assetText = trade.assetClass || '—';
  assetCell.textContent = assetText.charAt(0).toUpperCase() + assetText.slice(1);
  row.appendChild(assetCell);

  // Guaranteed PnL cell
  const guarCell = document.createElement('div');
  guarCell.className = 'tj-row-guaranteed';
  const guarVal = Number(trade.guaranteedPnlGBP);
  if (isClosed || !Number.isFinite(guarVal) || guarVal === 0) {
    guarCell.innerHTML = '<span class="tj-dash">—</span>';
  } else {
    guarCell.textContent = formatSignedPnl(guarVal);
    guarCell.classList.add(guarVal > 0 ? 'positive' : 'negative');
  }
  row.appendChild(guarCell);

  // Result cell — two lines (PnL + R-multiple)
  const resultCell = document.createElement('div');
  resultCell.className = 'tj-row-result';
  // TODO: realizedPnlGbp vs realizedPnlGBP exist with different values (~5p delta).
  // Using realizedPnlGbp here as it matches pnl. Rationalise in Stage 2 rebuild.
  const pnlVal = Number(trade.realizedPnlGbp);
  const pnlLine = document.createElement('div');
  pnlLine.className = 'tj-pnl';
  if (isOpen || !Number.isFinite(pnlVal)) {
    pnlLine.innerHTML = '<span class="tj-dash">—</span>';
  } else {
    pnlLine.textContent = formatSignedPnl(pnlVal);
    if (isPartial) {
      const partialMark = document.createElement('span');
      partialMark.className = 'tj-pnl-partial';
      partialMark.textContent = ' (partial)';
      pnlLine.appendChild(partialMark);
    }
    if (pnlVal > 0) pnlLine.classList.add('positive');
    else if (pnlVal < 0) pnlLine.classList.add('negative');
  }
  resultCell.appendChild(pnlLine);
  const rVal = Number(trade.rMultiple);
  if (Number.isFinite(rVal)) {
    const rLine = document.createElement('div');
    rLine.className = 'tj-r-multiple';
    const rSign = rVal >= 0 ? '+' : '';
    rLine.textContent = `${rSign}${rVal.toFixed(1)}R`;
    if (rVal > 0) rLine.classList.add('positive');
    else if (rVal < 0) rLine.classList.add('negative');
    resultCell.appendChild(rLine);
  }
  row.appendChild(resultCell);

  // Source / tags cell
  const sourceCell = document.createElement('div');
  sourceCell.className = 'tj-row-source';
  const sourceName = document.createElement('span');
  sourceName.className = 'tj-source-name';
  sourceName.textContent = getSourceLabel(trade);
  sourceCell.appendChild(sourceName);
  const allTags = [
    ...(trade.strategyTag ? [trade.strategyTag] : []),
    ...(trade.setupTags || []),
    ...(trade.emotionTags || [])
  ];
  if (allTags.length) {
    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'tj-tag-chips';
    const visible = allTags.slice(0, 2);
    const overflow = allTags.length - 2;
    visible.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'tj-tag-chip';
      chip.textContent = tag;
      chipsWrap.appendChild(chip);
    });
    if (overflow > 0) {
      const more = document.createElement('span');
      more.className = 'tj-tag-more';
      more.textContent = `+${overflow}`;
      chipsWrap.appendChild(more);
    }
    sourceCell.appendChild(chipsWrap);
  }
  row.appendChild(sourceCell);

  // Actions cell
  const actionsCell = document.createElement('div');
  actionsCell.className = 'tj-row-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'tj-action-btn';
  editBtn.title = 'Edit trade';
  editBtn.setAttribute('aria-label', 'Edit trade');
  editBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M11 2l3 3L5 14H2v-3L11 2z"/></svg>`;
  editBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await withTradeDetail(trade, populateForm); }
    catch (err) { alert(err?.message || 'Unable to load trade details'); }
  });
  actionsCell.appendChild(editBtn);

  const moreBtn = document.createElement('button');
  moreBtn.className = 'tj-action-btn';
  moreBtn.title = 'More actions';
  moreBtn.setAttribute('aria-label', 'More actions');
  moreBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="3" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="13" cy="8" r="1.3" fill="currentColor"/></svg>`;

  const moreMenu = document.createElement('div');
  moreMenu.className = 'tj-more-menu is-hidden';

  const menuItems = [
    { label: 'View details', action: async () => {
      try { await withTradeDetail(trade, populateForm); }
      catch (err) { alert(err?.message || 'Unable to load trade details'); }
    }},
    { label: 'Share to chat', action: () => shareTradeToGroupChat(trade) },
    ...(isOpen ? [{ label: 'Close position', action: async () => {
      try { await withTradeDetail(trade, closeTradePrompt); }
      catch (err) { alert(err?.message || 'Unable to load trade details'); }
    }}] : []),
    { label: 'Delete', className: 'danger', action: async () => {
      if (!window.confirm('Delete this trade? This cannot be undone.')) return;
      try {
        await api(`/api/trades/${trade.id}`, { method: 'DELETE' });
        removeTradeFromState(trade.id, { source: 'delete' });
        state.selectedIds.delete(trade.id);
        renderTrades();
      } catch (err) { alert(err?.message || 'Unable to delete trade'); }
    }}
  ];

  menuItems.forEach(item => {
    const btn = document.createElement('button');
    btn.className = `tj-more-option${item.className ? ' ' + item.className : ''}`;
    btn.textContent = item.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      moreMenu.classList.add('is-hidden');
      item.action();
    });
    moreMenu.appendChild(btn);
  });

  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = moreMenu.classList.contains('is-hidden');
    document.querySelectorAll('.tj-more-menu').forEach(m => m.classList.add('is-hidden'));
    moreMenu.classList.toggle('is-hidden', !isHidden);
  });
  actionsCell.appendChild(moreBtn);
  actionsCell.appendChild(moreMenu);
  row.appendChild(actionsCell);

  // Row click → open edit form
  row.addEventListener('click', async (e) => {
    if (e.target.closest('.tj-row-check') || e.target.closest('.tj-row-actions')) return;
    try { await withTradeDetail(trade, populateForm); }
    catch (err) { alert(err?.message || 'Unable to load trade details'); }
  });

  return { row, signature };
}

function renderTrades() {
  const container = document.querySelector('#tj-rows');
  const empty = document.querySelector('#trade-empty');
  const countPill = document.querySelector('#tj-table-count-pill');
  if (!container) return;
  const renderStart = window.PerfDiagnostics?.mark('trades-full-render');

  const { visible, filtered, total } = getVisibleTrades();
  const serverTotal = state.pagination.total || state.sortedTrades.length;

  if (!state.sortedTrades.length) {
    container.innerHTML = '';
    state.rowCache.clear();
    state.rowSignatures.clear();
    if (empty) empty.classList.remove('is-hidden');
    if (countPill) countPill.textContent = '';
    renderPaginationFooter();
    renderBulkBar();
    renderSummaryStrip();
    return;
  }
  if (empty) empty.classList.add('is-hidden');
  if (countPill) {
    const showing = visible.length;
    countPill.textContent = total < serverTotal
      ? `${showing} of ${total} filtered (${serverTotal} total)`
      : `Showing ${showing} of ${serverTotal}`;
  }

  const fragment = document.createDocumentFragment();
  const nextCache = new Map();
  const nextSignatures = new Map();

  visible.forEach(trade => {
    try {
      const signature = buildTradeSignature(trade);
      const existingRow = state.rowCache.get(trade.id);
      if (existingRow && state.rowSignatures.get(trade.id) === signature) {
        const cb = existingRow.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = state.selectedIds.has(trade.id);
        fragment.appendChild(existingRow);
        nextCache.set(trade.id, existingRow);
        nextSignatures.set(trade.id, signature);
        return;
      }
      const { row } = buildTradeRow(trade);
      fragment.appendChild(row);
      nextCache.set(trade.id, row);
      nextSignatures.set(trade.id, signature);
    } catch (err) {
      console.error('[tj-render] buildTradeRow threw for trade', trade?.id, err);
    }
  });
  console.log('[tj-render] fragment children after forEach:', fragment.childNodes.length, 'of', visible.length, 'visible');

  container.replaceChildren(fragment);
  state.rowCache = nextCache;
  state.rowSignatures = nextSignatures;

  renderPaginationFooter();
  renderBulkBar();
  renderSummaryStrip();
  if (renderStart) window.PerfDiagnostics?.measure('trades-full-render:end', renderStart, { count: visible.length });
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
      const result = await api(`/api/trades/${state.editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (result?.trade) {
        patchLocalTradeStateAfterSave(result.trade, { source: 'edit' });
        renderTrades();
      } else {
        const editedTradeId = state.editingId;
        await loadTrades();
        const mergedTrade = state.trades.find((item) => String(item?.id) === String(editedTradeId));
        if (mergedTrade) {
          state.tradeDetailCache.set(mergedTrade.id, mergedTrade);
          state.editingTrade = mergedTrade;
          console.info(`[display-name-ui] refetch merged trade id ${mergedTrade.id}`);
        }
      }
    } else {
      const result = await api('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (result?.trade) {
        upsertTradeInState({ ...result.trade, openDate: result?.date || result.trade.openDate }, { source: 'create' });
        renderTrades();
      } else {
        await loadTrades();
      }
    }
    if (status) {
      status.textContent = 'Saved';
      status.classList.add('success');
    }
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
    const result = await api('/api/trades/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (result?.trade) {
      upsertTradeInState(result.trade, { source: 'close' });
      renderTrades();
    } else {
      await loadTrades();
    }
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
  state.searchText = '';
  const searchInput = document.querySelector('#tj-search');
  if (searchInput) searchInput.value = '';
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
    renderImportPanel();
    updateSubtitle();
  } catch (_error) {
    state.ibkrHistory.batches = [];
    renderIbkrImportHistory([]);
    renderImportPanel();
  }
}

function bindNav() {
  getBootstrapProfile({ consumer: 'trades-nav-bootstrap' })
    .then(profile => {
      state.isAdmin = !!profile?.isAdmin;
      const show = profile?.username === 'mevs.0404@gmail.com' || profile?.username === 'dummy1';
      document.querySelectorAll('[data-app-menu-item-id=\"devtools\"]').forEach(btn => btn.classList.toggle('is-hidden', !show));
    })
    .catch(() => {
      state.isAdmin = false;
      document.querySelectorAll('[data-app-menu-item-id=\"devtools\"]').forEach(btn => btn.classList.add('is-hidden'));
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

  // Search input — client-side filter, debounced
  let searchTimer;
  document.querySelector('#tj-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchText = e.target.value || '';
      state.pagination.clientPage = 1;
      renderTrades();
    }, 150);
  });

  // Reset button (new filter bar)
  document.querySelector('#tj-reset-btn')?.addEventListener('click', resetFilters);

  // Sort pill
  document.querySelector('#tj-sort-pill-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.querySelector('#tj-sort-dropdown');
    if (!dropdown) return;
    const isHidden = dropdown.classList.contains('is-hidden');
    closeAllPopovers();
    dropdown.classList.toggle('is-hidden', !isHidden);
  });
  document.querySelectorAll('.tj-sort-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.sort.key = btn.dataset.sort || 'date-desc';
      try { localStorage.setItem('tj-sort-key', state.sort.key); } catch (_) {}
      closeAllPopovers();
      updateSortPillLabel();
      state.pagination.clientPage = 1;
      renderTrades();
    });
  });

  // Select-all checkbox
  document.querySelector('#tj-select-all')?.addEventListener('change', (e) => {
    const { visible } = getVisibleTrades();
    visible.forEach(t => {
      if (e.target.checked) state.selectedIds.add(t.id);
      else state.selectedIds.delete(t.id);
    });
    renderTrades();
  });

  // Bulk actions
  document.querySelector('#tj-bulk-clear-btn')?.addEventListener('click', () => {
    state.selectedIds.clear();
    renderTrades();
  });
  document.querySelector('#tj-bulk-delete-btn')?.addEventListener('click', async () => {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} trade${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await Promise.all(ids.map(id => api(`/api/trades/${id}`, { method: 'DELETE' })));
      ids.forEach(id => removeTradeFromState(id, { source: 'bulk-delete' }));
      state.selectedIds.clear();
      renderTrades();
    } catch (e) {
      alert(e?.message || 'Some deletes failed');
    }
  });
  document.querySelector('#tj-bulk-export-btn')?.addEventListener('click', () => {
    exportCsv();
  });
  document.querySelector('#tj-bulk-close-btn')?.addEventListener('click', () => {
    alert('Bulk close: select trades individually using the row More menu to close each position.');
  });

  // Page size selector
  document.querySelector('#tj-page-size-sel')?.addEventListener('change', (e) => {
    state.pagination.pageSize = Number(e.target.value) || 25;
    state.pagination.clientPage = 1;
    renderTrades();
  });

  // Close popovers / menus on outside click
  document.addEventListener('click', () => {
    closeAllPopovers();
    document.querySelectorAll('.tj-more-menu').forEach(m => m.classList.add('is-hidden'));
  });
}

async function init() {
  const pageStart = window.PerfDiagnostics?.mark('trades-page-init-start');
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
  // Restore sort state from localStorage
  try {
    const savedSort = localStorage.getItem('tj-sort-key');
    if (savedSort && SORT_LABELS[savedSort]) state.sort.key = savedSort;
  } catch (_) {}
  updateSortPillLabel();
  // Read any URL filter params before loading
  readFiltersFromUrl();
  await loadTrades();
  window.PerfDiagnostics?.mark('trades-first-meaningful-data');
  await loadIbkrImportHistory();
  if (pageStart) window.PerfDiagnostics?.measure('trades-page-ready', pageStart);
}

window.addEventListener('DOMContentLoaded', () => {
  init().catch(console.error);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelector('#trade-form-modal')?.classList.add('hidden');
      document.querySelector('#trade-settings-modal')?.classList.add('hidden');
      closeAllPopovers();
      document.querySelectorAll('.tj-more-menu').forEach(m => m.classList.add('is-hidden'));
    }
  });
});
