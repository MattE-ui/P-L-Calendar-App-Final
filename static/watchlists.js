(() => {
  const state = { watchlists: [], selectedId: '', marketRows: [], editingId: '' };

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

  function parseWatchlistPaste(rawText) {
    const lines = String(rawText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const title = lines[0] || '';
    const sections = [];
    lines.slice(1).forEach((line, index) => {
      const sep = line.indexOf(':');
      if (sep <= 0) return;
      const sectionTitle = line.slice(0, sep).trim();
      if (!sectionTitle) return;
      const seen = new Set();
      const tickers = line.slice(sep + 1).split(',').map((ticker) => ticker.trim().toUpperCase()).filter((ticker) => {
        if (!ticker || seen.has(ticker)) return false;
        seen.add(ticker);
        return true;
      });
      sections.push({ id: `section-${index + 1}`, title: sectionTitle, tickers });
    });
    return { title, sections };
  }

  async function loadWatchlists(selectId = '') {
    const payload = await api('/api/watchlists');
    state.watchlists = Array.isArray(payload.watchlists) ? payload.watchlists : [];
    if (selectId) state.selectedId = selectId;
    if (!state.selectedId) state.selectedId = state.watchlists[0]?.id || '';
    if (!state.watchlists.some((w) => w.id === state.selectedId)) state.selectedId = state.watchlists[0]?.id || '';
    render();
    if (state.selectedId) await loadMarketData(state.selectedId);
  }

  async function loadMarketData(watchlistId) {
    const payload = await api(`/api/watchlists/${encodeURIComponent(watchlistId)}/market-data`);
    state.marketRows = Array.isArray(payload.rows) ? payload.rows : [];
    renderTable();
  }

  function render() {
    const sidebar = el('watchlists-sidebar');
    if (sidebar) {
      sidebar.innerHTML = '';
      if (!state.watchlists.length) sidebar.innerHTML = '<div class="social-list-row">No watchlists yet.</div>';
      state.watchlists.forEach((w) => {
        const row = document.createElement('article');
        row.className = `social-list-row social-watchlist-tile ${w.id === state.selectedId ? 'is-selected' : ''}`;
        row.innerHTML = `<div class="social-watchlist-tile-head"><strong>${w.title || w.name}</strong><span class="helper">${w.sectionCount || 0} sections • ${w.tickerCount || 0} tickers</span></div>`;
        row.onclick = async () => { state.selectedId = w.id; render(); await loadMarketData(w.id); };
        sidebar.appendChild(row);
      });
    }
    const selected = state.watchlists.find((w) => w.id === state.selectedId);
    el('watchlist-detail-title').textContent = selected ? (selected.title || selected.name) : 'Select a watchlist';
    el('watchlist-detail-meta').textContent = selected
      ? `${selected.sectionCount || 0} sections • ${selected.tickerCount || 0} tickers • Updated ${selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : 'Recently'}`
      : '';
  }

  function renderTable() {
    const wrap = el('watchlist-table-wrap');
    const selected = state.watchlists.find((w) => w.id === state.selectedId);
    if (!wrap) return;
    if (!selected) { wrap.innerHTML = '<div class="social-list-row">Select a watchlist.</div>'; return; }
    if (!state.marketRows.length) { wrap.innerHTML = '<div class="social-list-row">No symbols in this watchlist.</div>'; return; }
    wrap.innerHTML = '<table class="social-watchlist-table"><thead><tr><th>Ticker</th><th>Current</th><th>Open</th><th>% Today</th><th>ADR%</th><th>$ Volume</th></tr></thead><tbody></tbody></table>';
    const body = wrap.querySelector('tbody');
    state.marketRows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><strong>${row.ticker || '—'}</strong>${row.name ? `<div class="helper">${row.name}</div>` : ''}</td>
        <td>${fmt(row.currentPrice, 'price')}</td>
        <td>${fmt(row.dayOpenPrice, 'price')}</td>
        <td class="${Number(row.percentChangeToday) > 0 ? 'is-pos' : (Number(row.percentChangeToday) < 0 ? 'is-neg' : '')}">${fmt(row.percentChangeToday, 'pct')}</td>
        <td>${fmt(row.adrPercent, 'pct')}</td>
        <td>${row.dollarVolumeDisplay || '—'}</td>`;
      body.appendChild(tr);
    });
  }

  function openWatchlistModal(mode = 'create') {
    const modal = el('watchlist-modal');
    if (!modal) return;
    const selected = state.watchlists.find((w) => w.id === state.selectedId);
    state.editingId = mode === 'edit' ? selected?.id || '' : '';
    el('watchlist-modal-title').textContent = mode === 'edit' ? 'Edit watchlist' : 'Create watchlist';
    el('watchlist-modal-name').value = mode === 'edit' ? (selected?.title || selected?.name || '') : '';
    el('watchlist-modal-notes').value = mode === 'edit' ? String(selected?.notes || '') : '';
    el('watchlist-modal-sections').value = mode === 'edit' ? JSON.stringify(selected?.sections || [], null, 2) : '';
    el('watchlist-modal-paste').value = '';
    setFeedback('watchlist-modal-feedback', '', 'muted');
    modal.showModal();
  }

  function closeWatchlistModal() {
    el('watchlist-modal')?.close();
  }

  function onParsePaste() {
    const parsed = parseWatchlistPaste(el('watchlist-modal-paste')?.value || '');
    if (!parsed.title) return setFeedback('watchlist-modal-feedback', 'Paste content is empty.', 'error');
    el('watchlist-modal-name').value = parsed.title;
    el('watchlist-modal-sections').value = JSON.stringify(parsed.sections, null, 2);
    setFeedback('watchlist-modal-feedback', `Parsed ${parsed.sections.length} sections.`, 'success');
  }

  async function onSaveModal() {
    const title = String(el('watchlist-modal-name')?.value || '').trim();
    if (!title) return setFeedback('watchlist-modal-feedback', 'Title is required.', 'error');
    let sections = [];
    try {
      sections = JSON.parse(el('watchlist-modal-sections')?.value || '[]');
    } catch (_error) {
      return setFeedback('watchlist-modal-feedback', 'Sections JSON is invalid.', 'error');
    }
    const payload = {
      title,
      notes: String(el('watchlist-modal-notes')?.value || '').trim(),
      sections
    };
    if (state.editingId) {
      await api(`/api/watchlists/${encodeURIComponent(state.editingId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      await loadWatchlists(state.editingId);
      setFeedback('watchlist-page-feedback', 'Watchlist updated.', 'success');
    } else {
      const created = await api('/api/watchlists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      await loadWatchlists(created.watchlist?.id || '');
      setFeedback('watchlist-page-feedback', 'Watchlist created.', 'success');
    }
    closeWatchlistModal();
  }

  async function onDelete() {
    const selected = state.watchlists.find((w) => w.id === state.selectedId); if (!selected) return;
    await api(`/api/watchlists/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
    state.selectedId = '';
    await loadWatchlists();
    setFeedback('watchlist-page-feedback', 'Watchlist deleted.', 'success');
  }

  async function init() {
    el('watchlist-new-btn')?.addEventListener('click', () => openWatchlistModal('create'));
    el('watchlist-edit-btn')?.addEventListener('click', () => openWatchlistModal('edit'));
    el('watchlist-delete-btn')?.addEventListener('click', () => onDelete().catch((e) => setFeedback('watchlist-page-feedback', e.message, 'error')));
    el('watchlist-modal-close')?.addEventListener('click', closeWatchlistModal);
    el('watchlist-modal-parse')?.addEventListener('click', onParsePaste);
    el('watchlist-modal-save')?.addEventListener('click', () => onSaveModal().catch((e) => setFeedback('watchlist-modal-feedback', e.message, 'error')));
    await loadWatchlists();
  }

  init().catch((error) => setFeedback('watchlist-page-feedback', error.message || 'Unable to load watchlists.', 'error'));
})();
