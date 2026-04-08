function toFiniteDisplayNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatWatchlistValue(value, kind = 'num') {
  const n = toFiniteDisplayNumber(value);
  if (!Number.isFinite(n)) return '—';
  if (kind === 'price') return `$${n.toFixed(n >= 100 ? 2 : 4)}`;
  if (kind === 'pct') return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
  if (kind === 'volume') {
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return n.toFixed(0);
  }
  return String(n);
}

(() => {
  const state = {
    watchlists: [],
    selectedId: '',
    marketRows: [],
    lastUpdated: '',
    loadingWatchlists: false,
    loadingMarketData: false,
    sortBy: 'manual',
    sortDir: 'asc',
    addTickerPending: new Set(),
    addTickerQueue: Promise.resolve(),
    localRowsByWatchlist: new Map(),
    localUpdatedByWatchlist: new Map()
  };

  const SORTABLE_COLUMNS = [
    { key: 'ticker', label: 'Ticker', type: 'string' },
    { key: 'currentPrice', label: 'Current', type: 'number' },
    { key: 'dayOpenPrice', label: 'Open', type: 'number' },
    { key: 'percentChangeToday', label: '% Today', type: 'number' },
    { key: 'adrPercent', label: 'ADR%', type: 'number' },
    { key: 'dollarVolume', label: '$ Volume', type: 'number' }
  ];

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'include', ...opts });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { window.location.href = '/login.html'; throw new Error('Unauthenticated'); }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function el(id) { return document.getElementById(id); }
  function setFeedback(id, msg = '', type = 'muted') {
    const node = el(id); if (!node) return;
    node.textContent = msg;
    node.classList.remove('is-error', 'is-success');
    if (type === 'error') node.classList.add('is-error');
    if (type === 'success') node.classList.add('is-success');
  }

  function fmt(value, kind = 'num') {
    return formatWatchlistValue(value, kind);
  }

  function updateManualSortButton() {
    const btn = el('watchlist-sort-manual-btn');
    if (!btn) return;
    const active = state.sortBy === 'manual';
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function sortRows(rows = []) {
    const source = Array.isArray(rows) ? [...rows] : [];
    if (state.sortBy === 'manual') {
      return source.sort((a, b) => Number(a.orderIndex || 0) - Number(b.orderIndex || 0));
    }
    const col = SORTABLE_COLUMNS.find((item) => item.key === state.sortBy);
    if (!col) return source;
    const dir = state.sortDir === 'desc' ? -1 : 1;
    return source.sort((a, b) => {
      const av = a?.[col.key];
      const bv = b?.[col.key];
      const aNull = av === null || av === undefined || av === '' || Number.isNaN(Number(av));
      const bNull = bv === null || bv === undefined || bv === '' || Number.isNaN(Number(bv));
      if (aNull && bNull) return Number(a.orderIndex || 0) - Number(b.orderIndex || 0);
      if (aNull) return 1;
      if (bNull) return -1;
      if (col.type === 'number') {
        const diff = Number(av) - Number(bv);
        if (Math.abs(diff) < 1e-9) return Number(a.orderIndex || 0) - Number(b.orderIndex || 0);
        return diff * dir;
      }
      const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
      if (cmp === 0) return Number(a.orderIndex || 0) - Number(b.orderIndex || 0);
      return cmp * dir;
    });
  }

  function setRowsForSelected(rows = [], lastUpdated = '') {
    state.marketRows = Array.isArray(rows) ? rows : [];
    state.lastUpdated = lastUpdated || state.lastUpdated || '';
    state.localRowsByWatchlist.set(state.selectedId, state.marketRows);
    state.localUpdatedByWatchlist.set(state.selectedId, state.lastUpdated);
  }

  async function loadWatchlists(selectId = '') {
    state.loadingWatchlists = true;
    render();
    const payload = await api('/api/watchlists');
    state.watchlists = Array.isArray(payload.watchlists) ? payload.watchlists : [];
    if (selectId) state.selectedId = selectId;
    if (!state.selectedId) state.selectedId = state.watchlists[0]?.id || '';
    if (!state.watchlists.some((w) => w.id === state.selectedId)) state.selectedId = state.watchlists[0]?.id || '';
    state.loadingWatchlists = false;
    render();
    if (state.selectedId) await loadMarketData(state.selectedId);
  }

  async function loadMarketData(watchlistId, { preferCached = true } = {}) {
    state.selectedId = watchlistId;
    const cachedRows = state.localRowsByWatchlist.get(watchlistId);
    const cachedUpdated = state.localUpdatedByWatchlist.get(watchlistId);
    if (preferCached && cachedRows) {
      state.marketRows = cachedRows;
      state.lastUpdated = cachedUpdated || '';
      state.loadingMarketData = true;
      renderTable();
    } else {
      state.loadingMarketData = true;
      renderTable();
    }
    const payload = await api(`/api/watchlists/${encodeURIComponent(watchlistId)}/market-data`);
    if (typeof window !== 'undefined') {
      const traceTicker = String(window.localStorage?.getItem('watchlistQuoteDebugTicker') || '').trim().toUpperCase();
      if (traceTicker) {
        const tracedRow = (payload.rows || []).find((row) => String(row?.ticker || '').trim().toUpperCase() === traceTicker);
        console.info('[WATCHLIST_QUOTE_DEBUG] frontend fetch row', { watchlistId, traceTicker, row: tracedRow || null });
      }
    }
    setRowsForSelected(payload.rows || [], payload.lastUpdated || '');
    state.loadingMarketData = false;
    renderTable();
  }

  function onSortHeader(columnKey) {
    if (!columnKey) return;
    if (state.sortBy !== columnKey) {
      state.sortBy = columnKey;
      state.sortDir = 'asc';
    } else {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    }
    updateManualSortButton();
    renderTable();
  }

  function render() {
    const sidebar = el('watchlists-sidebar');
    if (sidebar) {
      sidebar.innerHTML = '';
      if (state.loadingWatchlists) {
        sidebar.innerHTML = '<div class="social-list-row">Loading watchlists…</div>';
      }
      if (!state.watchlists.length) {
        sidebar.innerHTML = '<div class="social-empty-state"><p class="social-empty-state-title">No watchlists yet</p><p class="social-empty-state-detail">Create a personal watchlist to track symbols with live market context.</p></div>';
      }
      state.watchlists.forEach((w) => {
        const row = document.createElement('article');
        row.className = `social-list-row social-list-row--friend watchlist-sidebar-row ${w.id === state.selectedId ? 'is-selected' : ''}`;
        row.innerHTML = `<div><strong>${w.name}</strong><div class="helper">${w.tickerCount || 0} symbols</div></div>`;
        row.onclick = async () => { state.selectedId = w.id; render(); await loadMarketData(w.id); };
        sidebar.appendChild(row);
      });
    }
    const selected = state.watchlists.find((w) => w.id === state.selectedId);
    el('watchlist-detail-title').textContent = selected ? selected.name : 'Select a watchlist';
    const renameInput = el('watchlist-rename-input');
    if (renameInput) renameInput.value = selected?.name || '';
    updateManualSortButton();
  }

  function buildHeaderHtml() {
    return SORTABLE_COLUMNS.map((column) => {
      const isSorted = state.sortBy === column.key;
      const indicator = isSorted ? (state.sortDir === 'asc' ? '▲' : '▼') : '↕';
      const cls = column.key === 'ticker' ? 'col-ticker' : 'col-num';
      return `<th class="${cls}"><button class="watchlist-sort-btn ${isSorted ? 'is-active' : ''}" data-sort="${column.key}" type="button">${column.label}<span>${indicator}</span></button></th>`;
    }).join('');
  }

  function renderTable() {
    const wrap = el('watchlist-table-wrap');
    const selected = state.watchlists.find((w) => w.id === state.selectedId);
    if (!wrap) return;
    if (!selected) { wrap.innerHTML = '<div class="social-list-row">Select a watchlist.</div>'; return; }
    if (state.loadingMarketData && !state.marketRows.length) { wrap.innerHTML = '<div class="social-list-row">Loading market data…</div>'; return; }
    if (!state.marketRows.length) { wrap.innerHTML = '<div class="social-empty-state"><p class="social-empty-state-title">No symbols yet</p><p class="social-empty-state-detail">Add a ticker above to populate this table.</p></div>'; return; }

    const sorted = sortRows(state.marketRows);
    const refreshing = state.loadingMarketData ? '<span class="helper watchlist-refresh-indicator">Refreshing…</span>' : '';
    wrap.innerHTML = `<div class="watchlist-table-meta helper">${state.lastUpdated ? `Updated ${new Date(state.lastUpdated).toLocaleTimeString()}` : ''} ${refreshing}</div>
      <table class="social-watchlist-table"><thead><tr>${buildHeaderHtml()}<th class="col-actions"></th></tr></thead><tbody></tbody></table>
      <div class="watchlist-mobile-cards"></div>`;
    const body = wrap.querySelector('tbody');
    const mobileCards = wrap.querySelector('.watchlist-mobile-cards');

    sorted.forEach((row) => {
      const today = Number(row.percentChangeToday);
      const todayClass = today > 0 ? 'is-pos' : (today < 0 ? 'is-neg' : '');
      if (typeof window !== 'undefined') {
        const traceTicker = String(window.localStorage?.getItem('watchlistQuoteDebugTicker') || '').trim().toUpperCase();
        if (traceTicker && String(row?.ticker || '').trim().toUpperCase() === traceTicker) {
          console.info('[WATCHLIST_QUOTE_DEBUG] frontend render row', {
            row,
            rendered: {
              current: fmt(row.currentPrice, 'price'),
              open: fmt(row.dayOpenPrice, 'price'),
              pctToday: fmt(row.percentChangeToday, 'pct'),
              dollarVolume: row.dollarVolumeDisplay || fmt(row.dollarVolume, 'volume')
            }
          });
        }
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="col-ticker"><strong>${row.ticker || '—'}</strong>${row.name ? `<div class="helper watchlist-company-name">${row.name}</div>` : ''}</td>
        <td>${fmt(row.currentPrice, 'price')}</td>
        <td>${fmt(row.dayOpenPrice, 'price')}</td>
        <td class="${todayClass}">${fmt(row.percentChangeToday, 'pct')}</td>
        <td>${fmt(row.adrPercent, 'pct')}</td>
        <td>${row.dollarVolumeDisplay || fmt(row.dollarVolume, 'volume')}</td>
        <td class="col-actions"><button class="ghost" data-remove="${row.itemId}">Remove</button></td>`;
      tr.querySelector('[data-remove]')?.addEventListener('click', async () => {
        try {
          await api(`/api/watchlists/${encodeURIComponent(state.selectedId)}/items/${encodeURIComponent(row.itemId)}`, { method: 'DELETE' });
          setFeedback('watchlist-detail-feedback', 'Ticker removed.', 'success');
          await loadWatchlists(state.selectedId);
        } catch (error) {
          setFeedback('watchlist-detail-feedback', error.message, 'error');
        }
      });
      body.appendChild(tr);

      const card = document.createElement('article');
      card.className = 'watchlist-mobile-card';
      card.innerHTML = `<div class="watchlist-mobile-card-top"><strong>${row.ticker || '—'}</strong><span class="${todayClass}">${fmt(row.percentChangeToday, 'pct')}</span></div>
        ${row.name ? `<div class="helper watchlist-company-name">${row.name}</div>` : ''}
        <div class="watchlist-mobile-grid">
          <span>Current</span><strong>${fmt(row.currentPrice, 'price')}</strong>
          <span>Open</span><strong>${fmt(row.dayOpenPrice, 'price')}</strong>
          <span>ADR%</span><strong>${fmt(row.adrPercent, 'pct')}</strong>
          <span>$ Volume</span><strong>${row.dollarVolumeDisplay || fmt(row.dollarVolume, 'volume')}</strong>
        </div>
        <div class="watchlist-mobile-actions"><button class="ghost" data-remove-mobile="${row.itemId}">Remove</button></div>`;
      card.querySelector('[data-remove-mobile]')?.addEventListener('click', () => tr.querySelector('[data-remove]')?.click());
      mobileCards?.appendChild(card);
    });

    wrap.querySelectorAll('[data-sort]').forEach((node) => {
      node.addEventListener('click', () => onSortHeader(node.getAttribute('data-sort') || ''));
    });
  }

  async function onCreate() {
    const input = el('watchlist-new-name');
    const name = String(input?.value || '').trim();
    if (!name) return setFeedback('watchlist-page-feedback', 'Enter a watchlist name.', 'error');
    const payload = await api('/api/watchlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (input) input.value = '';
    await loadWatchlists(payload.watchlist?.id || '');
    setFeedback('watchlist-page-feedback', 'Watchlist created.', 'success');
  }

  async function onRename() {
    const selected = state.watchlists.find((w) => w.id === state.selectedId); if (!selected) return;
    const name = String(el('watchlist-rename-input')?.value || '').trim();
    if (!name) return setFeedback('watchlist-page-feedback', 'Enter a new watchlist name.', 'error');
    await api(`/api/watchlists/${encodeURIComponent(selected.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    await loadWatchlists(selected.id);
    setFeedback('watchlist-page-feedback', 'Watchlist renamed.', 'success');
  }

  async function onDelete() {
    const selected = state.watchlists.find((w) => w.id === state.selectedId); if (!selected) return;
    await api(`/api/watchlists/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
    state.selectedId = '';
    await loadWatchlists();
    setFeedback('watchlist-page-feedback', 'Watchlist deleted.', 'success');
  }

  function enqueueTickerAdd(tickerRaw) {
    const ticker = normalizeTicker(tickerRaw);
    if (!ticker || !state.selectedId) return;
    if (state.addTickerPending.has(ticker)) return;
    state.addTickerPending.add(ticker);
    updateAddTickerUi();
    const selectedIdAtSubmit = state.selectedId;
    state.addTickerQueue = state.addTickerQueue
      .then(async () => {
        await api(`/api/watchlists/${encodeURIComponent(selectedIdAtSubmit)}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker })
        });
        setFeedback('watchlist-detail-feedback', `Added ${ticker}.`, 'success');
        await loadWatchlists(selectedIdAtSubmit);
      })
      .catch((error) => {
        setFeedback('watchlist-detail-feedback', error.message, 'error');
      })
      .finally(() => {
        state.addTickerPending.delete(ticker);
        updateAddTickerUi();
      });
  }

  function normalizeTicker(value) {
    return String(value || '').trim().toUpperCase();
  }

  function updateAddTickerUi() {
    const busy = state.addTickerPending.size > 0;
    const btn = el('watchlist-add-ticker-btn');
    if (btn) {
      btn.disabled = busy;
      btn.textContent = busy ? 'Adding…' : 'Add';
    }
  }

  function onAddTickerRequest() {
    if (!state.selectedId) return;
    const input = el('watchlist-add-ticker-input');
    const captured = normalizeTicker(input?.value || '');
    if (!captured) return;
    if (input) input.value = '';
    enqueueTickerAdd(captured);
  }

  async function init() {
    el('watchlist-new-btn')?.addEventListener('click', () => onCreate().catch((e) => setFeedback('watchlist-page-feedback', e.message, 'error')));
    el('watchlist-rename-btn')?.addEventListener('click', () => onRename().catch((e) => setFeedback('watchlist-page-feedback', e.message, 'error')));
    el('watchlist-delete-btn')?.addEventListener('click', () => onDelete().catch((e) => {
      if (e?.message?.includes('Remove it from each group first')) {
        setFeedback('watchlist-page-feedback', `${e.message} Open Trading Groups → Watchlists to remove shared posts first.`, 'error');
        return;
      }
      setFeedback('watchlist-page-feedback', e.message, 'error');
    }));
    el('watchlist-add-ticker-btn')?.addEventListener('click', () => onAddTickerRequest());
    el('watchlist-add-ticker-input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onAddTickerRequest();
      }
    });
    el('watchlist-sort-manual-btn')?.addEventListener('click', () => {
      state.sortBy = 'manual';
      state.sortDir = 'asc';
      updateManualSortButton();
      renderTable();
    });
    await loadWatchlists();
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    init().catch((error) => setFeedback('watchlist-page-feedback', error.message || 'Unable to load watchlists.', 'error'));
  }
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { toFiniteDisplayNumber, formatWatchlistValue };
}
