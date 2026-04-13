(() => {
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
    refreshTimer: null,
    refreshInFlight: false,
    refreshQueued: false,
    lastRefreshAt: 0,
    lastLoadedWatchlistsAt: 0
  };

  const UNGROUPED_TITLE = 'Ungrouped';
  const TICKER_PATTERN = /^[A-Z0-9._-]{1,15}$/;
  const WATCHLIST_DEBUG_TICKERS = new Set(['LWLG', 'NBIS', 'GLW']);
  const WATCHLIST_REFRESH_INTERVAL_MS = 15000;
  const WATCHLIST_REFRESH_COOLDOWN_MS = 5000;
  const WATCHLIST_RECENT_REUSE_MS = 7000;
  const WATCHLIST_PERF_DEBUG = window.localStorage?.getItem('watchlistPerfDebug') === '1';
  const refreshChannel = window.AppRefreshCoordinator?.createChannel('watchlists-market-data');

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

  function debugPerf(marker, meta = null) {
    if (!WATCHLIST_PERF_DEBUG) return;
    window.PerfDiagnostics?.mark?.(marker);
    if (meta) console.info(`[WATCHLIST_PERF] ${marker}`, meta);
  }

  function buildMarketRowsSignature(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const ticker = normalizeTicker(row?.ticker);
        return [
          ticker,
          row?.displayPrice ?? 'null',
          row?.displayChangePct ?? row?.percentChangeToday ?? 'null',
          row?.asOf || '',
          row?.session || '',
          row?.isStale === true ? 1 : 0,
          row?.dollarVolumeDisplay || '—'
        ].join('|');
      })
      .join('||');
  }

  function sectionStructureSignature(sections) {
    return (Array.isArray(sections) ? sections : [])
      .map((section) => `${section.key}:${section.tickers.join(',')}`)
      .join('||');
  }

  function el(id) { return document.getElementById(id); }

  function setFeedback(id, msg = '', type = 'muted') {
    const node = el(id);
    if (!node) return;
    node.textContent = msg;
    node.classList.remove('is-error', 'is-success');
    if (type === 'error') node.classList.add('is-error');
    if (type === 'success') node.classList.add('is-success');
  }

  function fmt(value, kind = 'num') {
    if (value === null || value === undefined) return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (kind === 'price') return `$${n.toFixed(n >= 100 ? 2 : 4)}`;
    if (kind === 'pct') return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
    return String(n);
  }

  function priceSourceKey(row = {}) {
    return String(row.selectedPriceSource || row.priceSource || '').trim();
  }

  function sessionLabel(row = {}) {
    const source = priceSourceKey(row);
    if (source === 'preMarketPrice') return 'PRE';
    if (source === 'postMarketPrice') return 'POST';
    if (source === 'extendedHoursPrice') return 'EXT';
    if (source === 'regularMarketPrice') return 'LIVE';
    if (source === 'previousClose') return 'CLOSE';
    const session = String(row.session || '').trim().toLowerCase();
    if (session === 'premarket') return 'PRE';
    if (session === 'afterhours') return 'AH';
    if (session === 'extended') return 'EXT';
    if (session === 'stale') return 'STALE';
    if (session === 'regular') return 'LIVE';
    return 'CLOSED';
  }

  function sessionClass(row = {}) {
    const source = priceSourceKey(row);
    if (source === 'preMarketPrice') return 'is-premarket';
    if (source === 'postMarketPrice') return 'is-afterhours';
    if (source === 'extendedHoursPrice') return 'is-afterhours';
    if (source === 'regularMarketPrice') return 'is-live';
    const session = String(row.session || '').trim().toLowerCase();
    if (session === 'premarket') return 'is-premarket';
    if (session === 'afterhours') return 'is-afterhours';
    if (session === 'extended') return 'is-afterhours';
    if (session === 'stale') return 'is-closed';
    if (session === 'regular') return 'is-live';
    return 'is-closed';
  }

  function fmtAsOf(value) {
    if (!value) return 'As of —';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'As of —';
    return `As of ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }

  function normalizeTicker(raw) {
    return String(raw || '').trim().toUpperCase();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function toBuilderModel(sections) {
    const normalized = Array.isArray(sections) ? sections : [];
    const seen = new Set();
    const builder = { ungrouped: [], groups: [] };

    normalized.forEach((section, index) => {
      const name = String(section?.title || '').trim();
      const tickers = Array.isArray(section?.tickers)
        ? section.tickers.map(normalizeTicker).filter((ticker) => ticker && !seen.has(ticker) && seen.add(ticker))
        : [];

      if (!name || name.toLowerCase() === UNGROUPED_TITLE.toLowerCase()) {
        builder.ungrouped.push(...tickers);
        return;
      }

      builder.groups.push({
        id: String(section?.id || `group-${index + 1}`),
        name,
        tickers
      });
    });

    return builder;
  }

  function toSectionsModel() {
    syncBuilderFromDom();
    const sections = [];
    sections.push({ title: UNGROUPED_TITLE, tickers: [...state.builder.ungrouped] });
    state.builder.groups.forEach((group) => {
      sections.push({
        id: group.id,
        title: String(group.name || '').trim() || `Group ${group.id.slice(-4)}`,
        tickers: [...group.tickers]
      });
    });
    return sections;
  }

  function buildTickerPill(ticker, containerId, index) {
    const safeTicker = escapeHtml(ticker);
    return `
      <div class="watchlist-builder-pill" data-ticker="${safeTicker}" tabindex="0" role="listitem" aria-label="Ticker ${safeTicker}">
        <span>${safeTicker}</span>
        <div class="watchlist-pill-actions">
          <button type="button" class="watchlist-pill-btn" data-action="up" data-container-id="${containerId}" data-index="${index}" aria-label="Move ${safeTicker} up">↑</button>
          <button type="button" class="watchlist-pill-btn" data-action="down" data-container-id="${containerId}" data-index="${index}" aria-label="Move ${safeTicker} down">↓</button>
        </div>
      </div>
    `;
  }

  function renderBuilder() {
    const board = el('watchlist-builder-board');
    if (!board) return;

    destroySortables();

    const groupsMarkup = state.builder.groups.map((group, groupIndex) => `
      <section class="watchlist-dropzone-card" data-group-id="${group.id}">
        <header class="watchlist-dropzone-head">
          <input
            type="text"
            class="watchlist-group-name"
            data-group-name="${group.id}"
            value="${escapeHtml(group.name)}"
            aria-label="Group name"
            maxlength="80"
          >
          <button type="button" class="ghost watchlist-group-delete" data-delete-group="${group.id}">Delete</button>
        </header>
        <div class="watchlist-pill-zone" data-container="${group.id}" role="list" aria-label="${group.name || `Group ${groupIndex + 1}`} tickers">
          ${group.tickers.map((ticker, index) => buildTickerPill(ticker, group.id, index)).join('')}
        </div>
      </section>
    `).join('');

    board.innerHTML = `
      <section class="watchlist-dropzone-card watchlist-dropzone-card--ungrouped">
        <header class="watchlist-dropzone-head">
          <strong>${UNGROUPED_TITLE}</strong>
          <span class="helper">Drop newly added tickers here</span>
        </header>
        <div class="watchlist-pill-zone" data-container="ungrouped" role="list" aria-label="Ungrouped tickers">
          ${state.builder.ungrouped.map((ticker, index) => buildTickerPill(ticker, 'ungrouped', index)).join('')}
        </div>
      </section>
      ${groupsMarkup || '<p class="helper">No groups yet. Add one when you are ready to organize.</p>'}
    `;

    attachSortables();
  }

  function attachSortables() {
    if (!window.Sortable) return;
    document.querySelectorAll('.watchlist-pill-zone').forEach((zone) => {
      const sortable = new window.Sortable(zone, {
        group: 'watchlist-tickers',
        animation: 140,
        easing: 'cubic-bezier(0.2, 0.6, 0.2, 1)',
        ghostClass: 'watchlist-pill-ghost',
        dragClass: 'watchlist-pill-drag',
        onEnd: () => syncBuilderFromDom()
      });
      state.sortableInstances.push(sortable);
    });
  }

  function destroySortables() {
    state.sortableInstances.forEach((instance) => instance?.destroy?.());
    state.sortableInstances = [];
  }

  function syncBuilderFromDom() {
    const zones = document.querySelectorAll('.watchlist-pill-zone[data-container]');
    const next = { ungrouped: [], groups: state.builder.groups.map((group) => ({ ...group, tickers: [] })) };
    const groupById = new Map(next.groups.map((group) => [group.id, group]));

    zones.forEach((zone) => {
      const containerId = zone.getAttribute('data-container');
      const tickers = [...zone.querySelectorAll('[data-ticker]')]
        .map((node) => normalizeTicker(node.getAttribute('data-ticker')))
        .filter(Boolean);
      if (containerId === 'ungrouped') {
        next.ungrouped = tickers;
      } else if (groupById.has(containerId)) {
        groupById.get(containerId).tickers = tickers;
      }
    });

    state.builder = next;
  }

  function addTicker(raw) {
    const ticker = normalizeTicker(raw);
    if (!ticker) return;
    if (!TICKER_PATTERN.test(ticker)) {
      setFeedback('watchlist-modal-feedback', 'Use valid ticker characters only (A-Z, 0-9, ., _, -).', 'error');
      return;
    }
    const allTickers = new Set([...state.builder.ungrouped, ...state.builder.groups.flatMap((group) => group.tickers)]);
    if (allTickers.has(ticker)) {
      setFeedback('watchlist-modal-feedback', `${ticker} is already in this watchlist.`, 'error');
      return;
    }
    state.builder.ungrouped.push(ticker);
    renderBuilder();
    setFeedback('watchlist-modal-feedback', `Added ${ticker}.`, 'success');
  }

  function addGroup() {
    const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    state.builder.groups.push({ id: groupId, name: `Group ${state.builder.groups.length + 1}`, tickers: [] });
    renderBuilder();
  }

  function deleteGroup(groupId) {
    const idx = state.builder.groups.findIndex((group) => group.id === groupId);
    if (idx < 0) return;
    const [removed] = state.builder.groups.splice(idx, 1);
    state.builder.ungrouped.push(...(removed?.tickers || []));
    renderBuilder();
  }

  function moveTickerWithin(containerId, index, direction) {
    syncBuilderFromDom();
    const list = containerId === 'ungrouped'
      ? state.builder.ungrouped
      : state.builder.groups.find((group) => group.id === containerId)?.tickers;
    if (!Array.isArray(list)) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= list.length) return;
    [list[index], list[nextIndex]] = [list[nextIndex], list[index]];
    renderBuilder();
  }

  async function loadWatchlists(selectId = '') {
    clearTimeout(state.refreshTimer);
    const shouldReuseRecent = !selectId
      && state.watchlists.length
      && state.selectedId
      && (Date.now() - state.lastLoadedWatchlistsAt) <= WATCHLIST_RECENT_REUSE_MS;
    if (shouldReuseRecent) {
      debugPerf('watchlist-recent-data-reused', { source: 'load-watchlists', ageMs: Date.now() - state.lastLoadedWatchlistsAt });
      render();
      scheduleWatchlistRefresh();
      return;
    }
    const payload = await api('/api/watchlists?view=summary');
    state.watchlists = Array.isArray(payload.watchlists) ? payload.watchlists : [];
    debugPerf('watchlists-summary-bootstrap-used', { watchlistCount: state.watchlists.length });
    state.lastLoadedWatchlistsAt = Date.now();
    if (selectId) state.selectedId = selectId;
    if (!state.selectedId) state.selectedId = state.watchlists[0]?.id || '';
    if (!state.watchlists.some((w) => w.id === state.selectedId)) state.selectedId = state.watchlists[0]?.id || '';
    if (state.selectedId && !state.loadedTickerSetByWatchlist[state.selectedId]) {
      state.loadedTickerSetByWatchlist[state.selectedId] = new Set();
    }
    render();
    if (state.selectedId) {
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
      debugPerf('watchlist-detail-loaded', {
        reason,
        watchlistId,
        sectionCount: Number(detail.sectionCount || 0),
        tickerCount: Number(detail.tickerCount || 0)
      });
    }
    return detail;
  }

  function getSelectedDetailWatchlist() {
    if (!state.selectedId) return null;
    return state.watchlistDetailsById[state.selectedId]
      || state.watchlists.find((watchlist) => watchlist.id === state.selectedId)
      || null;
  }

  function collectVisibleTickersForWatchlist(watchlistId) {
    const selected = state.watchlistDetailsById[watchlistId] || state.watchlists.find((watchlist) => watchlist.id === watchlistId);
    const sections = buildDetailSections(selected);
    if (!sections.length) return [];
    const wrap = el('watchlist-table-wrap');
    const openKeysFromDom = wrap
      ? [...wrap.querySelectorAll('.social-watchlist-group-card[open]')].map((node) => node.getAttribute('data-group-key')).filter(Boolean)
      : [];
    const fallbackOpenKeys = [...ensureAccordionState(watchlistId, sections)];
    const openKeySet = new Set(openKeysFromDom.length ? openKeysFromDom : fallbackOpenKeys);
    const tickers = [];
    sections.forEach((section) => {
      if (!openKeySet.has(section.key)) return;
      section.tickers.forEach((ticker) => {
        const normalized = normalizeTicker(ticker);
        if (normalized) tickers.push(normalized);
      });
    });
    return [...new Set(tickers)];
  }

  async function loadMarketData(watchlistId, { reason = 'manual', forceRender = false } = {}) {
    const start = window.PerfDiagnostics?.mark('watchlist-marketdata-start');
    const visibleTickers = collectVisibleTickersForWatchlist(watchlistId);
    const tickerQuery = visibleTickers.length ? `?tickers=${encodeURIComponent(visibleTickers.join(','))}` : '';
    if (visibleTickers.length) {
      const selected = state.watchlistDetailsById[watchlistId];
      const totalTickers = Number(selected?.tickerCount || 0);
      if (totalTickers > visibleTickers.length) {
        debugPerf('watchlist-marketdata-deferred', { watchlistId, visibleTickerCount: visibleTickers.length, totalTickerCount: totalTickers, reason });
      }
    }
    const payload = await api(`/api/watchlists/${encodeURIComponent(watchlistId)}/market-data${tickerQuery}`);
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const loadedSet = state.loadedTickerSetByWatchlist[watchlistId] || new Set();
    rows.forEach((row) => loadedSet.add(normalizeTicker(row?.ticker)));
    state.loadedTickerSetByWatchlist[watchlistId] = loadedSet;
    const nextSignature = buildMarketRowsSignature(rows);
    const shouldSkip = !forceRender
      && state.selectedId === watchlistId
      && nextSignature
      && nextSignature === state.marketRowsSignature;
    state.marketRows = rows;
    if (shouldSkip) {
      debugPerf('watchlist-refresh-skipped', { reason, watchlistId, rowCount: rows.length });
      return;
    }
    state.marketRowsSignature = nextSignature;
    renderTable({ forceFullRender: forceRender, reason });
    if (start) window.PerfDiagnostics?.measure('watchlist-marketdata-cycle', start);
  }

  async function loadVisibleMarketData(watchlistId, { reason = 'manual', forceRender = false } = {}) {
    if (!watchlistId) return;
    await loadMarketData(watchlistId, { reason, forceRender });
  }

  function scheduleWatchlistRefresh() {
    clearTimeout(state.refreshTimer);
    if (!state.selectedId) return;
    state.refreshTimer = window.setTimeout(() => {
      refreshSelectedWatchlist('poll').catch((error) => {
        debugPerf('watchlist-refresh-failed', { error: error?.message || error });
      });
    }, WATCHLIST_REFRESH_INTERVAL_MS);
  }

  async function refreshSelectedWatchlist(reason = 'manual') {
    if (!state.selectedId) return;
    if (document.visibilityState === 'hidden') {
      debugPerf('watchlist-hidden-poll-suppressed', { reason, watchlistId: state.selectedId });
      scheduleWatchlistRefresh();
      return;
    }
    if (state.refreshInFlight) {
      state.refreshQueued = true;
      debugPerf('watchlist-refresh-coalesced', { reason, watchlistId: state.selectedId });
      return;
    }
    if (reason === 'poll' && (Date.now() - state.lastRefreshAt) < WATCHLIST_REFRESH_COOLDOWN_MS) {
      debugPerf('watchlist-refresh-cooldown-skip', {
        reason,
        watchlistId: state.selectedId,
        ageMs: Date.now() - state.lastRefreshAt
      });
      scheduleWatchlistRefresh();
      return;
    }
    state.refreshInFlight = true;
    try {
      const runner = () => loadMarketData(state.selectedId, { reason, forceRender: false });
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
        window.setTimeout(() => {
          refreshSelectedWatchlist('queued').catch(() => {});
        }, 0);
      }
      scheduleWatchlistRefresh();
    }
  }

  function render() {
    const sidebar = el('watchlists-sidebar');
    if (sidebar) {
      sidebar.innerHTML = '';
      if (!state.watchlists.length) sidebar.innerHTML = '<div class="social-list-row">No watchlists yet.</div>';
      state.watchlists.forEach((watchlist) => {
        const row = document.createElement('article');
        row.className = `social-list-row social-watchlist-tile ${watchlist.id === state.selectedId ? 'is-selected' : ''}`;
        row.innerHTML = `<div class="social-watchlist-tile-head"><strong>${watchlist.title || watchlist.name}</strong><span class="helper">${watchlist.sectionCount || 0} sections • ${watchlist.tickerCount || 0} tickers</span></div>`;
        row.onclick = async () => {
          if (state.selectedId === watchlist.id) return;
          state.selectedId = watchlist.id;
          state.marketRowsSignature = '';
          state.sectionStructureSignature = '';
          state.loadedTickerSetByWatchlist[watchlist.id] = new Set();
          render();
          await ensureWatchlistDetail(watchlist.id, { reason: 'watchlist-select' });
          renderTable({ forceFullRender: true, reason: 'watchlist-select-structure' });
          await loadVisibleMarketData(watchlist.id, { reason: 'watchlist-select', forceRender: true });
          scheduleWatchlistRefresh();
        };
        sidebar.appendChild(row);
      });
    }

    const selected = getSelectedDetailWatchlist() || state.watchlists.find((watchlist) => watchlist.id === state.selectedId);
    el('watchlist-detail-title').textContent = selected ? (selected.title || selected.name) : 'Select a watchlist';
    el('watchlist-detail-meta').textContent = selected
      ? `${selected.sectionCount || 0} sections • ${selected.tickerCount || 0} tickers • Updated ${selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : 'Recently'}`
      : '';
  }

  function renderTable({ forceFullRender = false, reason = 'render' } = {}) {
    const wrap = el('watchlist-table-wrap');
    const selected = getSelectedDetailWatchlist() || state.watchlists.find((watchlist) => watchlist.id === state.selectedId);
    if (!wrap) return;
    if (!selected) {
      state.sectionStructureSignature = '';
      wrap.innerHTML = '<div class="social-list-row">Select a watchlist.</div>';
      return;
    }
    const sections = buildDetailSections(selected);
    if (!sections.length) {
      state.sectionStructureSignature = '';
      wrap.innerHTML = '<div class="social-list-row">No symbols in this watchlist.</div>';
      return;
    }

    const rowLookup = new Map((state.marketRows || []).map((row) => [normalizeTicker(row.ticker), row]));
    const accordionState = ensureAccordionState(selected.id, sections);
    const structureSig = sectionStructureSignature(sections);
    const canReuseStructure = !forceFullRender
      && state.sectionStructureSignature === structureSig
      && wrap.getAttribute('data-watchlist-id') === selected.id;

    if (canReuseStructure) {
      updateRenderedRows(wrap, sections, rowLookup);
      debugPerf('watchlist-group-reused', { reason, groupCount: sections.length, rowCount: state.marketRows.length });
      return;
    }

    wrap.setAttribute('data-watchlist-id', selected.id);
    state.sectionStructureSignature = structureSig;
    wrap.innerHTML = `
      <div class="social-watchlist-groups-wrap">
        <div class="social-watchlist-groups-toolbar">
          <button type="button" class="ghost social-watchlist-groups-btn" data-watchlist-accordion="expand-all">Expand all</button>
          <button type="button" class="ghost social-watchlist-groups-btn" data-watchlist-accordion="collapse-all">Collapse all</button>
        </div>
        <div class="social-watchlist-groups-list">
          ${sections.map((section, index) => renderSectionCard({
            section,
            index,
            isOpen: accordionState.has(section.key),
            rowLookup
          })).join('')}
        </div>
      </div>
    `;
    debugPerf('watchlist-full-render', { reason, groupCount: sections.length, rowCount: state.marketRows.length });
  }

  function buildDetailSections(selected) {
    const rawSections = Array.isArray(selected?.sections) ? selected.sections : [];
    const normalized = rawSections
      .map((section, index) => ({
        key: String(section?.id || `${selected?.id || 'watchlist'}-${index + 1}`),
        title: String(section?.title || '').trim() || `Section ${index + 1}`,
        tickers: Array.isArray(section?.tickers) ? section.tickers.map(normalizeTicker).filter(Boolean) : []
      }))
      .filter((section) => section.tickers.length);

    if (!normalized.length) return [];

    const grouped = normalized.filter((section) => section.title.toLowerCase() !== UNGROUPED_TITLE.toLowerCase());
    if (!grouped.length) return normalized.map((section) => ({ ...section, isUngrouped: false }));

    return normalized.map((section) => ({
      ...section,
      title: section.title.toLowerCase() === UNGROUPED_TITLE.toLowerCase() ? UNGROUPED_TITLE : section.title,
      isUngrouped: section.title.toLowerCase() === UNGROUPED_TITLE.toLowerCase()
    }));
  }

  function ensureAccordionState(watchlistId, sections) {
    const allKeys = sections.map((section) => section.key);
    const existing = state.detailAccordion[watchlistId];
    if (!existing || !Array.isArray(existing.openKeys)) {
      state.detailAccordion[watchlistId] = { openKeys: allKeys.length ? [allKeys[0]] : [] };
      return new Set(state.detailAccordion[watchlistId].openKeys);
    }
    const sanitized = existing.openKeys.filter((key) => allKeys.includes(key));
    if (!sanitized.length && allKeys.length) sanitized.push(allKeys[0]);
    state.detailAccordion[watchlistId].openKeys = sanitized;
    return new Set(sanitized);
  }

  function setAccordionState(watchlistId, openKeys) {
    state.detailAccordion[watchlistId] = { openKeys: [...new Set(openKeys)] };
  }

  function renderSectionCard({ section, index, isOpen, rowLookup }) {
    const chevron = isOpen ? '▾' : '▸';
    const bodyMarkup = isOpen
      ? renderSectionTable(section, rowLookup)
      : '<div class="helper">Expand to load rows.</div>';
    if (!isOpen) debugPerf('watchlist-section-deferred', { sectionKey: section.key, tickerCount: section.tickers.length });
    return `
      <details class="social-watchlist-group-card" data-group-key="${escapeHtml(section.key)}" ${isOpen ? 'open' : ''}>
        <summary class="social-watchlist-group-summary">
          <span class="social-watchlist-group-heading">
            <span class="social-watchlist-group-chevron" aria-hidden="true">${chevron}</span>
            <span class="social-watchlist-group-name">${escapeHtml(section.title || `Group ${index + 1}`)}</span>
          </span>
          <span class="social-watchlist-group-count">${section.tickers.length}</span>
        </summary>
        <div class="social-watchlist-group-body">
          ${bodyMarkup}
        </div>
      </details>
    `;
  }

  function renderRowMarkup(row) {
    const change = row.displayChangePct ?? row.percentChangeToday;
    const changeClass = Number(change) > 0 ? 'is-pos' : (Number(change) < 0 ? 'is-neg' : '');
    return `
      <td>
        <strong>${escapeHtml(row.ticker || '—')}</strong>
        <span class="social-watchlist-session-badge ${sessionClass(row)}">${escapeHtml(sessionLabel(row))}</span>
        ${row.isStale ? '<span class="social-watchlist-stale-indicator">Stale</span>' : ''}
        ${row.name ? `<div class="helper">${escapeHtml(row.name)}</div>` : ''}
        <div class="helper">${escapeHtml(fmtAsOf(row.asOf))}${row.isDelayed ? ' • Delayed' : ''}</div>
      </td>
      <td>${fmt(row.displayPrice, 'price')}</td>
      <td>${Number.isFinite(Number(row.regularOpen ?? row.dayOpenPrice)) && Number(row.regularOpen ?? row.dayOpenPrice) > 0 ? fmt(row.regularOpen ?? row.dayOpenPrice, 'price') : '—'}</td>
      <td class="${changeClass}">${fmt(change, 'pct')}</td>
      <td>${fmt(row.adrPercent, 'pct')}</td>
      <td>${escapeHtml(row.dollarVolumeDisplay || '—')}</td>
    `;
  }

  function renderSectionTable(section, rowLookup) {
    const rows = section.tickers.map((ticker) => rowLookup.get(ticker) || { ticker });
    rows.forEach((row) => {
      const normalizedTicker = normalizeTicker(row?.ticker);
      if (!WATCHLIST_DEBUG_TICKERS.has(normalizedTicker)) return;
      const computedPercentRaw = row.displayChangePct ?? row.percentChangeToday;
      console.info('[WATCHLIST_UI_DEBUG]', {
        ticker: normalizedTicker,
        targetSessionDate: row.previousCloseDate || null,
        hasReferenceForDate: Number.isFinite(Number(row.previousClose)) && Number(row.previousClose) > 0 && !!row.previousCloseDate,
        storedPreviousClose: row.previousClose ?? null,
        storedReferenceDate: row.previousCloseDate || null,
        providerPreviousCloseFetchAttempted: null,
        providerPreviousCloseFetchSucceeded: null,
        computedPercentRaw,
        finalRenderedPercentValue: fmt(computedPercentRaw, 'pct')
      });
    });
    return `
      <div class="social-watchlist-table-wrap social-watchlist-table-wrap--group">
        <table class="social-watchlist-table">
          <thead><tr><th>Ticker</th><th>Display</th><th>Regular Open</th><th>% vs Prev Close</th><th>ADR%</th><th>$ Volume</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr data-watchlist-ticker="${escapeHtml(normalizeTicker(row.ticker))}" data-row-sig="${escapeHtml(buildMarketRowsSignature([row]))}">
                ${renderRowMarkup(row)}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function updateRenderedRows(wrap, sections, rowLookup) {
    sections.forEach((section) => {
      section.tickers.forEach((ticker) => {
        const normalizedTicker = normalizeTicker(ticker);
        if (!normalizedTicker) return;
        const row = rowLookup.get(normalizedTicker) || { ticker: normalizedTicker };
        const nextSig = buildMarketRowsSignature([row]);
        wrap.querySelectorAll(`tr[data-watchlist-ticker="${CSS.escape(normalizedTicker)}"]`).forEach((rowNode) => {
          if (rowNode.getAttribute('data-row-sig') === nextSig) return;
          rowNode.innerHTML = renderRowMarkup(row);
          rowNode.setAttribute('data-row-sig', nextSig);
          debugPerf('watchlist-row-updated', { ticker: normalizedTicker });
        });
      });
    });
  }

  async function openWatchlistModal(mode = 'create') {
    const modal = el('watchlist-modal');
    if (!modal) return;
    if (mode === 'edit' && state.selectedId) {
      await ensureWatchlistDetail(state.selectedId, { reason: 'watchlist-edit' });
    }
    const selected = getSelectedDetailWatchlist() || state.watchlists.find((watchlist) => watchlist.id === state.selectedId);
    state.editingId = mode === 'edit' ? selected?.id || '' : '';
    el('watchlist-modal-title').textContent = mode === 'edit' ? 'Edit watchlist' : 'Create watchlist';
    el('watchlist-modal-name').value = mode === 'edit' ? (selected?.title || selected?.name || '') : '';
    el('watchlist-modal-notes').value = mode === 'edit' ? String(selected?.notes || '') : '';
    el('watchlist-modal-ticker-input').value = '';
    state.builder = mode === 'edit' ? toBuilderModel(selected?.sections || []) : { ungrouped: [], groups: [] };
    setFeedback('watchlist-modal-feedback', '', 'muted');
    renderBuilder();
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
    const selected = state.watchlists.find((watchlist) => watchlist.id === state.selectedId);
    if (!selected) return;
    await api(`/api/watchlists/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
    state.selectedId = '';
    await loadWatchlists();
    setFeedback('watchlist-page-feedback', 'Watchlist deleted.', 'success');
  }

  function bindBuilderEvents() {
    el('watchlist-modal-add-group')?.addEventListener('click', addGroup);
    el('watchlist-modal-ticker-input')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      addTicker(event.currentTarget.value);
      event.currentTarget.value = '';
    });

    el('watchlist-builder-board')?.addEventListener('click', (event) => {
      const deleteBtn = event.target.closest('[data-delete-group]');
      if (deleteBtn) {
        deleteGroup(deleteBtn.getAttribute('data-delete-group'));
        return;
      }

      const moveBtn = event.target.closest('[data-action][data-container-id][data-index]');
      if (moveBtn) {
        const direction = moveBtn.getAttribute('data-action') === 'up' ? -1 : 1;
        moveTickerWithin(moveBtn.getAttribute('data-container-id'), Number(moveBtn.getAttribute('data-index')), direction);
      }
    });

    el('watchlist-builder-board')?.addEventListener('input', (event) => {
      const input = event.target.closest('[data-group-name]');
      if (!input) return;
      const group = state.builder.groups.find((item) => item.id === input.getAttribute('data-group-name'));
      if (group) group.name = String(input.value || '').slice(0, 80);
    });
  }

  async function init() {
    const pageStart = window.PerfDiagnostics?.mark('watchlists-page-init-start');
    el('watchlist-new-btn')?.addEventListener('click', () => openWatchlistModal('create').catch((error) => setFeedback('watchlist-page-feedback', error.message, 'error')));
    el('watchlist-edit-btn')?.addEventListener('click', () => openWatchlistModal('edit').catch((error) => setFeedback('watchlist-page-feedback', error.message, 'error')));
    el('watchlist-delete-btn')?.addEventListener('click', () => onDelete().catch((error) => setFeedback('watchlist-page-feedback', error.message, 'error')));
    el('watchlist-modal-close')?.addEventListener('click', closeWatchlistModal);
    el('watchlist-modal-save')?.addEventListener('click', () => onSaveModal().catch((error) => setFeedback('watchlist-modal-feedback', error.message, 'error')));

    bindBuilderEvents();
    el('watchlist-table-wrap')?.addEventListener('toggle', (event) => {
      const details = event.target.closest('.social-watchlist-group-card');
      if (!details) return;
      const selected = state.watchlists.find((watchlist) => watchlist.id === state.selectedId);
      if (!selected) return;
      const groupKeys = [...el('watchlist-table-wrap').querySelectorAll('.social-watchlist-group-card')]
        .map((node) => node.getAttribute('data-group-key'))
        .filter(Boolean);
      const openKeys = groupKeys.filter((key) => el('watchlist-table-wrap').querySelector(`.social-watchlist-group-card[data-group-key="${CSS.escape(key)}"]`)?.open);
      setAccordionState(selected.id, openKeys.length ? openKeys : [groupKeys[0]].filter(Boolean));
      const chevron = details.querySelector('.social-watchlist-group-chevron');
      if (chevron) chevron.textContent = details.open ? '▾' : '▸';
      if (details.open) {
        const selectedDetail = getSelectedDetailWatchlist();
        const sections = buildDetailSections(selectedDetail);
        const sectionKey = details.getAttribute('data-group-key');
        const section = sections.find((item) => item.key === sectionKey);
        const body = details.querySelector('.social-watchlist-group-body');
        if (section && body && !body.querySelector('table')) {
          const rowLookup = new Map((state.marketRows || []).map((row) => [normalizeTicker(row.ticker), row]));
          body.innerHTML = renderSectionTable(section, rowLookup);
        }
        loadVisibleMarketData(selected.id, { reason: 'section-expand', forceRender: false }).catch(() => {});
      }
    }, true);
    el('watchlist-table-wrap')?.addEventListener('click', (event) => {
      const actionBtn = event.target.closest('[data-watchlist-accordion]');
      if (!actionBtn) return;
      const selected = state.watchlists.find((watchlist) => watchlist.id === state.selectedId);
      if (!selected) return;
      const detailCards = [...el('watchlist-table-wrap').querySelectorAll('.social-watchlist-group-card')];
      if (!detailCards.length) return;
      const mode = actionBtn.getAttribute('data-watchlist-accordion');
      if (mode === 'expand-all') detailCards.forEach((card) => { card.open = true; });
      if (mode === 'collapse-all') detailCards.forEach((card) => { card.open = false; });
      const openKeys = detailCards.filter((card) => card.open).map((card) => card.getAttribute('data-group-key')).filter(Boolean);
      setAccordionState(selected.id, openKeys.length ? openKeys : [detailCards[0]?.getAttribute('data-group-key')].filter(Boolean));
      detailCards.forEach((card) => {
        const chevron = card.querySelector('.social-watchlist-group-chevron');
        if (chevron) chevron.textContent = card.open ? '▾' : '▸';
      });
    });
    let visibilityRefreshDebounce = null;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(visibilityRefreshDebounce);
      visibilityRefreshDebounce = window.setTimeout(() => {
        refreshSelectedWatchlist('visibility').catch(() => {});
      }, 150);
    });
    await loadWatchlists();
    window.PerfDiagnostics?.mark('watchlists-first-meaningful-data');
    if (pageStart) window.PerfDiagnostics?.measure('watchlists-page-ready', pageStart);
  }

  init().catch((error) => setFeedback('watchlist-page-feedback', error.message || 'Unable to load watchlists.', 'error'));
})();
