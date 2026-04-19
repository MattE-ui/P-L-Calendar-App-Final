(() => {
  const C = () => window.WatchlistsCompute;
  const R = () => window.WatchlistsRender;

  // ── State ────────────────────────────────────────────────────────────────────
  const state = {
    watchlists: [],
    watchlistDetailsById: {},
    loadedTickerSetByWatchlist: {},
    selectedId: '',
    marketRows: [],
    marketRowsSignature: '',
    sectionStructureSignature: '',
    editingId: '',
    builder: { ungrouped: [], groups: [] },
    sortableInstances: [],
    detailAccordion: {},
    holdingTickers: new Set(),
    sidebarSearch: '',
    refreshTimer: null,
    refreshInFlight: false,
    refreshQueued: false,
    lastRefreshAt: 0,
    lastLoadedWatchlistsAt: 0
  };

  const TICKER_PATTERN = /^[A-Z0-9._-]{1,15}$/;
  const WATCHLIST_REFRESH_INTERVAL_MS = 15000;
  const WATCHLIST_REFRESH_COOLDOWN_MS = 5000;
  const WATCHLIST_RECENT_REUSE_MS = 7000;
  const WATCHLIST_PERF_DEBUG = window.localStorage?.getItem('watchlistPerfDebug') === '1';
  const refreshChannel = window.AppRefreshCoordinator?.createChannel('watchlists-market-data');

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function setFeedback(id, msg = '', type = 'muted') {
    const node = el(id);
    if (!node) return;
    node.textContent = msg;
    node.classList.remove('is-error', 'is-success');
    if (type === 'error') node.classList.add('is-error');
    if (type === 'success') node.classList.add('is-success');
  }

  function debugPerf(marker, meta = null) {
    if (!WATCHLIST_PERF_DEBUG) return;
    window.PerfDiagnostics?.mark?.(marker);
    if (meta) console.info(`[WATCHLIST_PERF] ${marker}`, meta);
  }

  // ── API ──────────────────────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const fetchPromise = fetch(path, { credentials: 'include', ...opts });
    const res = window.PerfDiagnostics
      ? await window.PerfDiagnostics.trackApi(`watchlists-api:${method}:${path}`, fetchPromise)
      : await fetchPromise;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { window.location.href = '/login.html'; throw new Error('Unauthenticated'); }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ── URL routing ──────────────────────────────────────────────────────────────
  function getUrlId() {
    return new URLSearchParams(location.search).get('id') || '';
  }

  function pushUrlId(id) {
    const next = id ? `${location.pathname}?id=${encodeURIComponent(id)}` : location.pathname;
    const current = location.pathname + location.search;
    if (current !== next) history.pushState({ watchlistId: id }, '', next);
  }

  // ── Holding tickers (piggybacked on every market-data poll) ──────────────────
  async function loadHoldingTickers() {
    try {
      const res = await api('/api/trades/active');
      const trades = Array.isArray(res?.trades) ? res.trades : [];
      state.holdingTickers = new Set(
        trades
          .map((t) => C().normalizeTicker(t.canonicalTicker || t.ticker || ''))
          .filter(Boolean)
      );
    } catch { /* silent degradation — badge simply won't render */ }
  }

  // ── Data loading ─────────────────────────────────────────────────────────────
  async function loadWatchlists(selectId = '') {
    clearTimeout(state.refreshTimer);
    const shouldReuseRecent = !selectId
      && state.watchlists.length
      && state.selectedId
      && (Date.now() - state.lastLoadedWatchlistsAt) <= WATCHLIST_RECENT_REUSE_MS;
    if (shouldReuseRecent) {
      debugPerf('watchlist-recent-data-reused', { ageMs: Date.now() - state.lastLoadedWatchlistsAt });
      render();
      scheduleWatchlistRefresh();
      return;
    }
    const payload = await api('/api/watchlists?view=summary');
    state.watchlists = Array.isArray(payload.watchlists) ? payload.watchlists : [];
    state.lastLoadedWatchlistsAt = Date.now();
    if (selectId) state.selectedId = selectId;
    if (!state.selectedId) state.selectedId = state.watchlists[0]?.id || '';
    if (!state.watchlists.some((w) => w.id === state.selectedId)) {
      state.selectedId = state.watchlists[0]?.id || '';
    }
    if (state.selectedId && !state.loadedTickerSetByWatchlist[state.selectedId]) {
      state.loadedTickerSetByWatchlist[state.selectedId] = new Set();
    }
    render();
    if (state.selectedId) {
      pushUrlId(state.selectedId);
      await ensureWatchlistDetail(state.selectedId, { reason: 'watchlist-load' });
      renderTable({ forceFullRender: true, reason: 'watchlist-load-structure' });
      await loadVisibleMarketData(state.selectedId, { reason: 'watchlist-load', forceRender: true });
    }
    scheduleWatchlistRefresh();
  }

  async function ensureWatchlistDetail(watchlistId, { reason = 'manual', force = false } = {}) {
    if (!watchlistId) return null;
    if (!force && state.watchlistDetailsById[watchlistId]) return state.watchlistDetailsById[watchlistId];
    const payload = await api(`/api/watchlists/${encodeURIComponent(watchlistId)}/detail`);
    const detail = payload?.watchlist && typeof payload.watchlist === 'object' ? payload.watchlist : null;
    if (detail) {
      state.watchlistDetailsById[watchlistId] = detail;
      debugPerf('watchlist-detail-loaded', { reason, watchlistId });
    }
    return detail;
  }

  function getSelectedDetail() {
    if (!state.selectedId) return null;
    return state.watchlistDetailsById[state.selectedId]
      || state.watchlists.find((w) => w.id === state.selectedId)
      || null;
  }

  function collectVisibleTickers(watchlistId) {
    const { buildDetailSections, normalizeTicker } = C();
    const src = state.watchlistDetailsById[watchlistId]
      || state.watchlists.find((w) => w.id === watchlistId);
    const sections = buildDetailSections(src);
    if (!sections.length) return [];
    const wrap = el('wl-sections');
    const openFromDom = wrap
      ? [...wrap.querySelectorAll('.social-watchlist-group-card[open]')]
          .map((n) => n.getAttribute('data-group-key')).filter(Boolean)
      : [];
    const fallback = [...ensureAccordionState(watchlistId, sections)];
    const openSet = new Set(openFromDom.length ? openFromDom : fallback);
    const tickers = [];
    sections.forEach((s) => {
      if (!openSet.has(s.key)) return;
      s.tickers.forEach((t) => { const n = normalizeTicker(t); if (n) tickers.push(n); });
    });
    return [...new Set(tickers)];
  }

  async function loadMarketData(watchlistId, { reason = 'manual', forceRender = false } = {}) {
    const { normalizeTicker, buildMarketRowsSignature } = C();
    const visible = collectVisibleTickers(watchlistId);
    const q = visible.length ? `?tickers=${encodeURIComponent(visible.join(','))}` : '';
    const payload = await api(`/api/watchlists/${encodeURIComponent(watchlistId)}/market-data${q}`);
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const loadedSet = state.loadedTickerSetByWatchlist[watchlistId] || new Set();
    rows.forEach((r) => loadedSet.add(normalizeTicker(r?.ticker)));
    state.loadedTickerSetByWatchlist[watchlistId] = loadedSet;
    const nextSig = buildMarketRowsSignature(rows);
    const shouldSkip = !forceRender
      && state.selectedId === watchlistId
      && nextSig && nextSig === state.marketRowsSignature;
    state.marketRows = rows;
    if (shouldSkip) {
      debugPerf('watchlist-refresh-skipped', { reason, rowCount: rows.length });
      return;
    }
    state.marketRowsSignature = nextSig;
    renderHeader();
    renderTable({ forceFullRender: forceRender, reason });
  }

  async function loadVisibleMarketData(watchlistId, opts) {
    if (!watchlistId) return;
    await loadMarketData(watchlistId, opts);
  }

  function scheduleWatchlistRefresh() {
    clearTimeout(state.refreshTimer);
    if (!state.selectedId) return;
    state.refreshTimer = window.setTimeout(() => {
      refreshSelectedWatchlist('poll').catch((err) => {
        debugPerf('watchlist-refresh-failed', { error: err?.message });
      });
    }, WATCHLIST_REFRESH_INTERVAL_MS);
  }

  async function refreshSelectedWatchlist(reason = 'manual') {
    if (!state.selectedId) return;
    if (document.visibilityState === 'hidden') { scheduleWatchlistRefresh(); return; }
    if (state.refreshInFlight) { state.refreshQueued = true; return; }
    if (reason === 'poll' && (Date.now() - state.lastRefreshAt) < WATCHLIST_REFRESH_COOLDOWN_MS) {
      scheduleWatchlistRefresh(); return;
    }
    state.refreshInFlight = true;
    try {
      const runner = async () => Promise.all([
        loadMarketData(state.selectedId, { reason, forceRender: false }),
        loadHoldingTickers()
      ]);
      if (refreshChannel) {
        await refreshChannel.run(runner, {
          reason,
          minIntervalMs: reason === 'poll' ? WATCHLIST_REFRESH_COOLDOWN_MS : 0,
          allowWhenHidden: reason !== 'poll',
          reuseResultMs: reason === 'visibility' ? 2000 : 0
        });
      } else {
        await runner();
      }
      state.lastRefreshAt = Date.now();
    } finally {
      state.refreshInFlight = false;
      if (state.refreshQueued) {
        state.refreshQueued = false;
        window.setTimeout(() => refreshSelectedWatchlist('queued').catch(() => {}), 0);
      }
      scheduleWatchlistRefresh();
    }
  }

  // ── Accordion state ──────────────────────────────────────────────────────────
  function ensureAccordionState(watchlistId, sections) {
    const allKeys = sections.map((s) => s.key);
    const existing = state.detailAccordion[watchlistId];
    if (!existing || !Array.isArray(existing.openKeys)) {
      state.detailAccordion[watchlistId] = { openKeys: allKeys.length ? [allKeys[0]] : [] };
      return new Set(state.detailAccordion[watchlistId].openKeys);
    }
    const sanitized = existing.openKeys.filter((k) => allKeys.includes(k));
    if (!sanitized.length && allKeys.length) sanitized.push(allKeys[0]);
    state.detailAccordion[watchlistId].openKeys = sanitized;
    return new Set(sanitized);
  }

  function setAccordionState(watchlistId, openKeys) {
    state.detailAccordion[watchlistId] = { openKeys: [...new Set(openKeys)] };
  }

  // ── Render orchestration ─────────────────────────────────────────────────────
  function render() {
    renderSidebarList();
    renderHeader();
  }

  function renderSidebarList() {
    const container = el('wl-sidebar-lists');
    if (!container) return;
    container.innerHTML = R().renderSidebarGroups(
      state.watchlists, state.selectedId, state.sidebarSearch
    );
  }

  function renderHeader() {
    const card = el('wl-header-card');
    if (!card) return;
    const selected = getSelectedDetail();
    if (!selected) {
      card.innerHTML = state.watchlists.length
        ? R().renderNoSelection()
        : R().renderEmptyNoWatchlists();
      return;
    }
    card.innerHTML = R().renderWatchlistHeader(selected, state.marketRows, state.holdingTickers);
  }

  function renderTable({ forceFullRender = false, reason = 'render' } = {}) {
    const { buildDetailSections, sectionStructureSignature, normalizeTicker } = C();
    const wrap = el('wl-sections');
    const selected = getSelectedDetail();
    if (!wrap) return;
    if (!selected) { state.sectionStructureSignature = ''; wrap.innerHTML = ''; return; }
    const sections = buildDetailSections(selected);
    if (!sections.length) {
      state.sectionStructureSignature = '';
      wrap.innerHTML = R().renderEmptyWatchlist();
      return;
    }
    const rowLookup = new Map((state.marketRows || []).map((r) => [normalizeTicker(r.ticker), r]));
    const accordionState = ensureAccordionState(selected.id, sections);
    const structureSig = sectionStructureSignature(sections);
    const canReuse = !forceFullRender
      && state.sectionStructureSignature === structureSig
      && wrap.getAttribute('data-watchlist-id') === selected.id;

    if (canReuse) {
      updateRenderedRows(wrap, sections, rowLookup);
      debugPerf('watchlist-group-reused', { reason, groupCount: sections.length });
      return;
    }
    wrap.setAttribute('data-watchlist-id', selected.id);
    state.sectionStructureSignature = structureSig;

    const cardsHtml = sections.map((s, i) =>
      R().renderSectionCard({ section: s, index: i, isOpen: accordionState.has(s.key), rowLookup })
    ).join('');

    wrap.innerHTML = `
      <div class="wl-sections-toolbar">
        <button type="button" class="wl-btn" data-watchlist-accordion="expand-all">Expand all</button>
        <button type="button" class="wl-btn" data-watchlist-accordion="collapse-all">Collapse all</button>
      </div>
      <div class="social-watchlist-groups-list">${cardsHtml}</div>`;
    debugPerf('watchlist-full-render', { reason, groupCount: sections.length });
  }

  function updateRenderedRows(wrap, sections, rowLookup) {
    const { normalizeTicker, buildMarketRowsSignature } = C();
    sections.forEach((s) => {
      s.tickers.forEach((ticker) => {
        const nt = normalizeTicker(ticker);
        if (!nt) return;
        const row = rowLookup.get(nt) || { ticker: nt };
        const nextSig = buildMarketRowsSignature([row]);
        wrap.querySelectorAll(`tr[data-watchlist-ticker="${CSS.escape(nt)}"]`).forEach((rowNode) => {
          if (rowNode.getAttribute('data-row-sig') === nextSig) return;
          rowNode.innerHTML = R().renderRowMarkup(row);
          rowNode.setAttribute('data-row-sig', nextSig);
        });
      });
    });
  }

  // ── Modal / builder ──────────────────────────────────────────────────────────
  function toSectionsModel() {
    syncBuilderFromDom();
    const { UNGROUPED_TITLE } = C();
    const sections = [{ title: UNGROUPED_TITLE, tickers: [...state.builder.ungrouped] }];
    state.builder.groups.forEach((g) => {
      sections.push({ id: g.id, title: String(g.name || '').trim() || `Group ${g.id.slice(-4)}`, tickers: [...g.tickers] });
    });
    return sections;
  }

  function doRenderBuilder() {
    const board = el('watchlist-builder-board');
    if (!board) return;
    destroySortables();
    board.innerHTML = R().renderBuilder(state.builder);
    attachSortables();
  }

  function attachSortables() {
    if (!window.Sortable) return;
    document.querySelectorAll('.watchlist-pill-zone').forEach((zone) => {
      state.sortableInstances.push(new window.Sortable(zone, {
        group: 'watchlist-tickers', animation: 140,
        easing: 'cubic-bezier(0.2, 0.6, 0.2, 1)',
        ghostClass: 'watchlist-pill-ghost', dragClass: 'watchlist-pill-drag',
        onEnd: () => syncBuilderFromDom()
      }));
    });
  }

  function destroySortables() {
    state.sortableInstances.forEach((inst) => inst?.destroy?.());
    state.sortableInstances = [];
  }

  function syncBuilderFromDom() {
    const zones = document.querySelectorAll('.watchlist-pill-zone[data-container]');
    const next = { ungrouped: [], groups: state.builder.groups.map((g) => ({ ...g, tickers: [] })) };
    const byId = new Map(next.groups.map((g) => [g.id, g]));
    zones.forEach((zone) => {
      const cid = zone.getAttribute('data-container');
      const tickers = [...zone.querySelectorAll('[data-ticker]')]
        .map((n) => C().normalizeTicker(n.getAttribute('data-ticker'))).filter(Boolean);
      if (cid === 'ungrouped') next.ungrouped = tickers;
      else if (byId.has(cid)) byId.get(cid).tickers = tickers;
    });
    state.builder = next;
  }

  function addTicker(raw) {
    const ticker = C().normalizeTicker(raw);
    if (!ticker) return;
    if (!TICKER_PATTERN.test(ticker)) {
      setFeedback('watchlist-modal-feedback', 'Use valid ticker characters only (A-Z, 0-9, ., _, -).', 'error');
      return;
    }
    const all = new Set([...state.builder.ungrouped, ...state.builder.groups.flatMap((g) => g.tickers)]);
    if (all.has(ticker)) {
      setFeedback('watchlist-modal-feedback', `${ticker} is already in this watchlist.`, 'error');
      return;
    }
    state.builder.ungrouped.push(ticker);
    doRenderBuilder();
    setFeedback('watchlist-modal-feedback', `Added ${ticker}.`, 'success');
  }

  function addGroup() {
    const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    state.builder.groups.push({ id, name: `Group ${state.builder.groups.length + 1}`, tickers: [] });
    doRenderBuilder();
  }

  function deleteGroup(groupId) {
    const idx = state.builder.groups.findIndex((g) => g.id === groupId);
    if (idx < 0) return;
    const [removed] = state.builder.groups.splice(idx, 1);
    state.builder.ungrouped.push(...(removed?.tickers || []));
    doRenderBuilder();
  }

  function moveTickerWithin(cid, index, dir) {
    syncBuilderFromDom();
    const list = cid === 'ungrouped'
      ? state.builder.ungrouped
      : state.builder.groups.find((g) => g.id === cid)?.tickers;
    if (!Array.isArray(list)) return;
    const next = index + dir;
    if (next < 0 || next >= list.length) return;
    [list[index], list[next]] = [list[next], list[index]];
    doRenderBuilder();
  }

  async function openWatchlistModal(mode = 'create') {
    const modal = el('watchlist-modal');
    if (!modal) return;
    if (mode === 'edit' && state.selectedId) {
      await ensureWatchlistDetail(state.selectedId, { reason: 'watchlist-edit' });
    }
    const selected = getSelectedDetail();
    state.editingId = mode === 'edit' ? selected?.id || '' : '';
    el('watchlist-modal-title').textContent = mode === 'edit' ? 'Edit watchlist' : 'Create watchlist';
    el('watchlist-modal-name').value = mode === 'edit' ? (selected?.title || selected?.name || '') : '';
    el('watchlist-modal-notes').value = mode === 'edit' ? String(selected?.notes || '') : '';
    el('watchlist-modal-ticker-input').value = '';
    state.builder = mode === 'edit' ? C().toBuilderModel(selected?.sections || []) : { ungrouped: [], groups: [] };
    setFeedback('watchlist-modal-feedback', '', 'muted');
    doRenderBuilder();
    modal.showModal();
  }

  function closeWatchlistModal() {
    destroySortables();
    el('watchlist-modal')?.close();
  }

  async function onSaveModal() {
    const title = String(el('watchlist-modal-name')?.value || '').trim();
    if (!title) return setFeedback('watchlist-modal-feedback', 'Title is required.', 'error');
    const payload = {
      title,
      notes: String(el('watchlist-modal-notes')?.value || '').trim(),
      sections: toSectionsModel()
    };
    if (state.editingId) {
      await api(`/api/watchlists/${encodeURIComponent(state.editingId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      await loadWatchlists(state.editingId);
      setFeedback('wl-page-feedback', 'Watchlist updated.', 'success');
    } else {
      const created = await api('/api/watchlists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      await loadWatchlists(created.watchlist?.id || '');
      setFeedback('wl-page-feedback', 'Watchlist created.', 'success');
    }
    closeWatchlistModal();
  }

  async function onDelete() {
    const selected = state.watchlists.find((w) => w.id === state.selectedId);
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.title || selected.name}"? This cannot be undone.`)) return;
    await api(`/api/watchlists/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
    state.selectedId = '';
    pushUrlId('');
    await loadWatchlists();
    setFeedback('wl-page-feedback', 'Watchlist deleted.', 'success');
  }

  // ── Event binding ────────────────────────────────────────────────────────────
  function bindBuilderEvents() {
    el('watchlist-modal-add-group')?.addEventListener('click', addGroup);
    el('watchlist-modal-ticker-input')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      addTicker(e.currentTarget.value);
      e.currentTarget.value = '';
    });
    el('watchlist-builder-board')?.addEventListener('click', (e) => {
      const del = e.target.closest('[data-delete-group]');
      if (del) { deleteGroup(del.getAttribute('data-delete-group')); return; }
      const mv = e.target.closest('[data-action][data-container-id][data-index]');
      if (mv) {
        const dir = mv.getAttribute('data-action') === 'up' ? -1 : 1;
        moveTickerWithin(mv.getAttribute('data-container-id'), Number(mv.getAttribute('data-index')), dir);
      }
    });
    el('watchlist-builder-board')?.addEventListener('input', (e) => {
      const input = e.target.closest('[data-group-name]');
      if (!input) return;
      const g = state.builder.groups.find((x) => x.id === input.getAttribute('data-group-name'));
      if (g) g.name = String(input.value || '').slice(0, 80);
    });
  }

  async function init() {
    const pageStart = window.PerfDiagnostics?.mark('watchlists-page-init-start');

    // Back/forward navigation
    window.addEventListener('popstate', (e) => {
      const id = e.state?.watchlistId || getUrlId();
      if (!id || id === state.selectedId) return;
      state.selectedId = id;
      state.marketRowsSignature = '';
      state.sectionStructureSignature = '';
      state.loadedTickerSetByWatchlist[id] = new Set();
      render();
      ensureWatchlistDetail(id, { reason: 'popstate' })
        .then(() => {
          renderTable({ forceFullRender: true, reason: 'popstate' });
          return loadVisibleMarketData(id, { reason: 'popstate', forceRender: true });
        })
        .then(() => scheduleWatchlistRefresh())
        .catch(() => {});
    });

    // Sidebar: select watchlist or toggle pin
    el('wl-sidebar-lists')?.addEventListener('click', (e) => {
      const pinBtn = e.target.closest('[data-pin-id]');
      if (pinBtn) {
        e.stopPropagation();
        C().pinStore.toggle(pinBtn.getAttribute('data-pin-id'));
        renderSidebarList();
        return;
      }
      const item = e.target.closest('[data-watchlist-id]');
      if (!item) return;
      const id = item.getAttribute('data-watchlist-id');
      if (!id || id === state.selectedId) return;
      state.selectedId = id;
      state.marketRowsSignature = '';
      state.sectionStructureSignature = '';
      state.loadedTickerSetByWatchlist[id] = new Set();
      pushUrlId(id);
      render();
      ensureWatchlistDetail(id, { reason: 'watchlist-select' })
        .then(() => {
          renderTable({ forceFullRender: true, reason: 'watchlist-select' });
          return loadVisibleMarketData(id, { reason: 'watchlist-select', forceRender: true });
        })
        .then(() => scheduleWatchlistRefresh())
        .catch((err) => setFeedback('wl-page-feedback', err.message, 'error'));
    });
    el('wl-sidebar-lists')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') e.target.closest('[data-watchlist-id]')?.click();
    });

    // Sidebar search
    el('wl-search')?.addEventListener('input', (e) => {
      state.sidebarSearch = e.target.value;
      renderSidebarList();
    });

    // New watchlist button (sidebar)
    el('wl-new-btn')?.addEventListener('click', () =>
      openWatchlistModal('create').catch((err) => setFeedback('wl-page-feedback', err.message, 'error'))
    );

    // Header card actions (delegated — innerHTML re-renders on data update)
    el('wl-header-card')?.addEventListener('click', (e) => {
      const action = e.target.closest('[data-wl-action]')?.getAttribute('data-wl-action');
      if (!action) return;
      if (action === 'edit' || action === 'add-ticker') {
        openWatchlistModal('edit').catch((err) => setFeedback('wl-page-feedback', err.message, 'error'));
      } else if (action === 'delete') {
        onDelete().catch((err) => setFeedback('wl-page-feedback', err.message, 'error'));
      } else if (action === 'new') {
        openWatchlistModal('create').catch((err) => setFeedback('wl-page-feedback', err.message, 'error'));
      }
    });

    // Sections: accordion toggle + lazy-load on expand
    el('wl-sections')?.addEventListener('toggle', (e) => {
      const details = e.target.closest('.social-watchlist-group-card');
      if (!details) return;
      const allCards = [...el('wl-sections').querySelectorAll('.social-watchlist-group-card')];
      const openKeys = allCards.filter((c) => c.open).map((c) => c.getAttribute('data-group-key')).filter(Boolean);
      const allKeys = allCards.map((c) => c.getAttribute('data-group-key')).filter(Boolean);
      setAccordionState(state.selectedId, openKeys.length ? openKeys : [allKeys[0]].filter(Boolean));
      const ch = details.querySelector('.social-watchlist-group-chevron');
      if (ch) ch.textContent = details.open ? '\u25be' : '\u25b8';
      if (details.open) {
        const { buildDetailSections, normalizeTicker } = C();
        const sections = buildDetailSections(getSelectedDetail());
        const key = details.getAttribute('data-group-key');
        const section = sections.find((s) => s.key === key);
        const body = details.querySelector('.social-watchlist-group-body');
        if (section && body && !body.querySelector('table')) {
          const rowLookup = new Map((state.marketRows || []).map((r) => [normalizeTicker(r.ticker), r]));
          body.innerHTML = R().renderSectionTable(section, rowLookup);
        }
        loadVisibleMarketData(state.selectedId, { reason: 'section-expand' }).catch(() => {});
      }
    }, true);

    el('wl-sections')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-watchlist-accordion]');
      if (!btn) return;
      const mode = btn.getAttribute('data-watchlist-accordion');
      const cards = [...el('wl-sections').querySelectorAll('.social-watchlist-group-card')];
      cards.forEach((c) => {
        c.open = mode === 'expand-all';
        const ch = c.querySelector('.social-watchlist-group-chevron');
        if (ch) ch.textContent = c.open ? '\u25be' : '\u25b8';
      });
      const openKeys = cards.filter((c) => c.open).map((c) => c.getAttribute('data-group-key')).filter(Boolean);
      const allKeys = cards.map((c) => c.getAttribute('data-group-key')).filter(Boolean);
      setAccordionState(state.selectedId, openKeys.length ? openKeys : [allKeys[0]].filter(Boolean));
    });

    // Modal
    el('watchlist-modal-close')?.addEventListener('click', closeWatchlistModal);
    el('watchlist-modal-save')?.addEventListener('click', () =>
      onSaveModal().catch((err) => setFeedback('watchlist-modal-feedback', err.message, 'error'))
    );
    bindBuilderEvents();

    // Tab visibility: resume polling on focus
    let visDebounce = null;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(visDebounce);
      visDebounce = window.setTimeout(() => refreshSelectedWatchlist('visibility').catch(() => {}), 150);
    });

    // Bootstrap
    await loadHoldingTickers();
    await loadWatchlists(getUrlId());
    window.PerfDiagnostics?.mark('watchlists-first-meaningful-data');
    if (pageStart) window.PerfDiagnostics?.measure('watchlists-page-ready', pageStart);
  }

  init().catch((err) => setFeedback('wl-page-feedback', err.message || 'Unable to load watchlists.', 'error'));
})();
