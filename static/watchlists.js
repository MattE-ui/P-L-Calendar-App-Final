(() => {
  const state = {
    watchlists: [],
    selectedId: '',
    marketRows: [],
    editingId: '',
    builder: { ungrouped: [], groups: [] },
    sortableInstances: [],
    detailAccordion: {}
  };

  const UNGROUPED_TITLE = 'Ungrouped';
  const TICKER_PATTERN = /^[A-Z0-9._-]{1,15}$/;

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'include', ...opts });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { window.location.href = '/login.html'; throw new Error('Unauthenticated'); }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
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
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (kind === 'price') return `$${n.toFixed(n >= 100 ? 2 : 4)}`;
    if (kind === 'pct') return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
    return String(n);
  }

  function sessionLabel(rawSession) {
    const session = String(rawSession || '').trim().toLowerCase();
    if (session === 'premarket') return 'Premarket';
    if (session === 'afterhours') return 'After Hours';
    if (session === 'regular') return 'Live';
    return 'Closed';
  }

  function sessionClass(rawSession) {
    const session = String(rawSession || '').trim().toLowerCase();
    if (session === 'premarket') return 'is-premarket';
    if (session === 'afterhours') return 'is-afterhours';
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
      state.watchlists.forEach((watchlist) => {
        const row = document.createElement('article');
        row.className = `social-list-row social-watchlist-tile ${watchlist.id === state.selectedId ? 'is-selected' : ''}`;
        row.innerHTML = `<div class="social-watchlist-tile-head"><strong>${watchlist.title || watchlist.name}</strong><span class="helper">${watchlist.sectionCount || 0} sections • ${watchlist.tickerCount || 0} tickers</span></div>`;
        row.onclick = async () => { state.selectedId = watchlist.id; render(); await loadMarketData(watchlist.id); };
        sidebar.appendChild(row);
      });
    }

    const selected = state.watchlists.find((watchlist) => watchlist.id === state.selectedId);
    el('watchlist-detail-title').textContent = selected ? (selected.title || selected.name) : 'Select a watchlist';
    el('watchlist-detail-meta').textContent = selected
      ? `${selected.sectionCount || 0} sections • ${selected.tickerCount || 0} tickers • Updated ${selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : 'Recently'}`
      : '';
  }

  function renderTable() {
    const wrap = el('watchlist-table-wrap');
    const selected = state.watchlists.find((watchlist) => watchlist.id === state.selectedId);
    if (!wrap) return;
    if (!selected) {
      wrap.innerHTML = '<div class="social-list-row">Select a watchlist.</div>';
      return;
    }
    const sections = buildDetailSections(selected);
    if (!sections.length) {
      wrap.innerHTML = '<div class="social-list-row">No symbols in this watchlist.</div>';
      return;
    }

    const rowLookup = new Map((state.marketRows || []).map((row) => [normalizeTicker(row.ticker), row]));
    const accordionState = ensureAccordionState(selected.id, sections);
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
          ${renderSectionTable(section, rowLookup)}
        </div>
      </details>
    `;
  }

  function renderSectionTable(section, rowLookup) {
    const rows = section.tickers.map((ticker) => rowLookup.get(ticker) || { ticker });
    return `
      <div class="social-watchlist-table-wrap social-watchlist-table-wrap--group">
        <table class="social-watchlist-table">
          <thead><tr><th>Ticker</th><th>Display</th><th>Regular Open</th><th>% vs Prev Close</th><th>ADR%</th><th>$ Volume</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>
                  <strong>${escapeHtml(row.ticker || '—')}</strong>
                  <span class="social-watchlist-session-badge ${sessionClass(row.session)}">${escapeHtml(sessionLabel(row.session))}</span>
                  ${row.isStale ? '<span class="social-watchlist-stale-indicator">Stale</span>' : ''}
                  ${row.name ? `<div class="helper">${escapeHtml(row.name)}</div>` : ''}
                  <div class="helper">${escapeHtml(fmtAsOf(row.asOf))}${row.isDelayed ? ' • Delayed' : ''}</div>
                </td>
                <td>${fmt(row.displayPrice, 'price')}</td>
                <td>${fmt(row.regularOpen ?? row.dayOpenPrice, 'price')}</td>
                <td class="${Number(row.displayChangePct) > 0 ? 'is-pos' : (Number(row.displayChangePct) < 0 ? 'is-neg' : '')}">${fmt(row.displayChangePct ?? row.percentChangeToday, 'pct')}</td>
                <td>${fmt(row.adrPercent, 'pct')}</td>
                <td>${escapeHtml(row.dollarVolumeDisplay || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function openWatchlistModal(mode = 'create') {
    const modal = el('watchlist-modal');
    if (!modal) return;
    const selected = state.watchlists.find((watchlist) => watchlist.id === state.selectedId);
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
    el('watchlist-new-btn')?.addEventListener('click', () => openWatchlistModal('create'));
    el('watchlist-edit-btn')?.addEventListener('click', () => openWatchlistModal('edit'));
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
    await loadWatchlists();
  }

  init().catch((error) => setFeedback('watchlist-page-feedback', error.message || 'Unable to load watchlists.', 'error'));
})();
