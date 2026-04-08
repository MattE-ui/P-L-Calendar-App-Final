(() => {
  const state = { watchlists: [], selectedId: '', marketRows: [], lastUpdated: '', loadingWatchlists: false, loadingMarketData: false };

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
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (kind === 'price') return `$${n.toFixed(n >= 100 ? 2 : 4)}`;
    if (kind === 'pct') return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
    return String(n);
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

  async function loadMarketData(watchlistId) {
    state.loadingMarketData = true;
    renderTable();
    const payload = await api(`/api/watchlists/${encodeURIComponent(watchlistId)}/market-data`);
    state.marketRows = Array.isArray(payload.rows) ? payload.rows : [];
    state.lastUpdated = payload.lastUpdated || '';
    state.loadingMarketData = false;
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
        row.className = `social-list-row social-list-row--friend ${w.id === state.selectedId ? 'is-selected' : ''}`;
        row.innerHTML = `<div><strong>${w.name}</strong><div class="helper">${w.tickerCount || 0} symbols</div></div>`;
        row.onclick = async () => { state.selectedId = w.id; render(); await loadMarketData(w.id); };
        sidebar.appendChild(row);
      });
    }
    const selected = state.watchlists.find((w) => w.id === state.selectedId);
    el('watchlist-detail-title').textContent = selected ? selected.name : 'Select a watchlist';
    const renameInput = el('watchlist-rename-input');
    if (renameInput) renameInput.value = selected?.name || '';
  }

  function renderTable() {
    const wrap = el('watchlist-table-wrap');
    const selected = state.watchlists.find((w) => w.id === state.selectedId);
    if (!wrap) return;
    if (!selected) { wrap.innerHTML = '<div class="social-list-row">Select a watchlist.</div>'; return; }
    if (state.loadingMarketData) { wrap.innerHTML = '<div class="social-list-row">Loading market data…</div>'; return; }
    if (!state.marketRows.length) { wrap.innerHTML = '<div class="social-empty-state"><p class="social-empty-state-title">No symbols yet</p><p class="social-empty-state-detail">Add a ticker above to populate this table.</p></div>'; return; }
    wrap.innerHTML = '<table class="social-watchlist-table"><thead><tr><th class="col-ticker">Ticker</th><th class="col-num">Current</th><th class="col-num">Open</th><th class="col-num">% Today</th><th class="col-num">ADR%</th><th class="col-num">$ Volume</th><th class="col-actions"></th></tr></thead><tbody></tbody></table>';
    const body = wrap.querySelector('tbody');
    state.marketRows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="col-ticker"><strong>${row.ticker || '—'}</strong>${row.name ? `<div class="helper watchlist-company-name">${row.name}</div>` : ''}</td>
        <td>${fmt(row.currentPrice, 'price')}</td>
        <td>${fmt(row.dayOpenPrice, 'price')}</td>
        <td class="${Number(row.percentChangeToday) > 0 ? 'is-pos' : (Number(row.percentChangeToday) < 0 ? 'is-neg' : '')}">${fmt(row.percentChangeToday, 'pct')}</td>
        <td>${fmt(row.adrPercent, 'pct')}</td>
        <td>${row.dollarVolumeDisplay || '—'}</td>
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

  async function onAddTicker() {
    if (!state.selectedId) return;
    const input = el('watchlist-add-ticker-input');
    const ticker = String(input?.value || '').trim().toUpperCase();
    if (!ticker) return;
    try {
      await api(`/api/watchlists/${encodeURIComponent(state.selectedId)}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker }) });
      if (input) input.value = '';
      setFeedback('watchlist-detail-feedback', 'Ticker added.', 'success');
      await loadWatchlists(state.selectedId);
    } catch (error) {
      setFeedback('watchlist-detail-feedback', error.message, 'error');
    }
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
    el('watchlist-add-ticker-btn')?.addEventListener('click', () => onAddTicker());
    el('watchlist-add-ticker-input')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); onAddTicker(); } });
    await loadWatchlists();
  }

  init().catch((error) => setFeedback('watchlist-page-feedback', error.message || 'Unable to load watchlists.', 'error'));
})();
