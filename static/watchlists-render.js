(() => {
  // Lazy accessor so load order doesn't matter between the three watchlists files.
  const C = () => window.WatchlistsCompute;

  // ── Sidebar ──────────────────────────────────────────────────────────────────

  function renderSidebarGroups(watchlists, selectedId, searchText) {
    const { pinStore, escapeHtml: esc } = C();
    const q = (searchText || '').toLowerCase();
    const filtered = q
      ? watchlists.filter((w) => (w.title || w.name || '').toLowerCase().includes(q))
      : watchlists;

    if (!filtered.length) {
      return `<div class="wl-sidebar__empty">
        ${q ? 'No matching watchlists.' : 'No watchlists yet.'}
      </div>`;
    }

    const pinnedIds = pinStore.getAll();
    const pinned = filtered.filter((w) => pinnedIds.has(w.id));
    const recent = filtered.filter((w) => !pinnedIds.has(w.id));
    const parts = [];

    if (pinned.length) {
      parts.push(`
        <div class="wl-sidebar__group">
          <p class="wl-sidebar__group-label">Pinned</p>
          <div class="wl-sidebar__group-items">
            ${pinned.map((w) => renderSidebarItem(w, w.id === selectedId, true)).join('')}
          </div>
        </div>`);
    }
    if (recent.length) {
      parts.push(`
        <div class="wl-sidebar__group">
          ${pinned.length ? '<p class="wl-sidebar__group-label">Recent</p>' : ''}
          <div class="wl-sidebar__group-items">
            ${recent.map((w) => renderSidebarItem(w, w.id === selectedId, false)).join('')}
          </div>
        </div>`);
    }
    return parts.join('');
  }

  function renderSidebarItem(watchlist, isActive, isPinned) {
    const { escapeHtml: esc } = C();
    const name = esc(watchlist.title || watchlist.name || 'Untitled');
    const tc = watchlist.tickerCount || 0;
    const sc = watchlist.sectionCount || 0;
    const meta = (tc === 0 && sc === 0) ? 'Empty'
      : `${tc} ticker${tc !== 1 ? 's' : ''} \u00b7 ${sc} section${sc !== 1 ? 's' : ''}`;
    return `
      <div class="wl-sidebar-item${isActive ? ' is-active' : ''}"
           data-watchlist-id="${esc(watchlist.id)}"
           role="button" tabindex="0" aria-selected="${isActive}">
        ${isPinned ? '<span class="wl-sidebar-item__pin" aria-label="Pinned">\u2605</span>' : ''}
        <div class="wl-sidebar-item__main">
          <div class="wl-sidebar-item__name">${name}</div>
          <div class="wl-sidebar-item__meta">${esc(meta)}</div>
        </div>
        <button class="wl-sidebar-item__menu-btn" data-pin-id="${esc(watchlist.id)}"
                aria-label="Watchlist options" title="${isPinned ? 'Unpin' : 'Pin'}">
          ${isPinned
            ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="var(--warning)"><path d="M6 1l1.5 3.5L11 5l-2.5 2.5.5 3.5L6 9.5 3 11l.5-3.5L1 5l3.5-.5z"/></svg>'
            : '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M6 1l1.5 3.5L11 5l-2.5 2.5.5 3.5L6 9.5 3 11l.5-3.5L1 5l3.5-.5z"/></svg>'}
        </button>
      </div>`;
  }

  // ── Watchlist header card ────────────────────────────────────────────────────

  function renderWatchlistHeader(selected, rows, holdingTickers) {
    const { fmtPct, fmtRelativeOrAbsolute, normalizeTicker, escapeHtml: esc, computeWatchlistStats } = C();
    const stats = computeWatchlistStats(rows);
    const isLive = (rows || []).some(
      (r) => r.session === 'regular' || r.selectedPriceSource === 'regularMarketPrice'
    );

    const title = esc(selected.title || selected.name || 'Untitled');
    const tc = Number(selected.tickerCount || 0);
    const sc = Number(selected.sectionCount || 0);
    const metaParts = [
      `${tc} ticker${tc !== 1 ? 's' : ''}`,
      `${sc} section${sc !== 1 ? 's' : ''}`
    ];
    if (selected.updatedAt) metaParts.push(`Updated ${fmtRelativeOrAbsolute(selected.updatedAt)}`);
    const meta = esc(metaParts.join(' \u00b7 '));

    // Gainers stat: "32" green, " / 42" dim
    const gainersHtml = stats.total > 0
      ? `<span class="wl-stat__gainers-num">${stats.gainers}</span><span class="wl-stat__gainers-denom"> / ${stats.total}</span>`
      : '<span class="wl-stat__value--dim">\u2014</span>';

    // Avg change stat
    const avgChangeClass = stats.avgChange === null ? 'wl-stat__value--dim'
      : stats.avgChange > 0 ? 'wl-stat__value--pos'
      : stats.avgChange < 0 ? 'wl-stat__value--neg' : '';
    const avgChangeHtml = stats.avgChange !== null
      ? `<span class="${avgChangeClass}">${fmtPct(stats.avgChange)}</span>`
      : '<span class="wl-stat__value--dim">\u2014</span>';

    // Biggest mover stat
    let biggestMoverHtml = '<span class="wl-stat__value--dim">\u2014</span>';
    if (stats.biggestMover) {
      const bm = stats.biggestMover;
      const bmClass = bm.displayChangePct > 0 ? 'wl-stat__value--pos'
        : bm.displayChangePct < 0 ? 'wl-stat__value--neg' : '';
      biggestMoverHtml = `<span class="${bmClass}">${esc(normalizeTicker(bm.ticker))} ${fmtPct(bm.displayChangePct)}</span>`;
    }

    // Avg ADR stat (always positive, no colour treatment)
    const avgAdrHtml = stats.avgAdr !== null
      ? `<span>${stats.avgAdr.toFixed(2)}%</span>`
      : '<span class="wl-stat__value--dim">\u2014</span>';

    return `
      <div class="wl-header__top">
        <div class="wl-header__title-group">
          <h2 class="wl-header__title">${title}</h2>
          ${isLive ? '<span class="wl-badge-live">Live</span>' : ''}
        </div>
        <div class="wl-header__actions">
          <button type="button" class="wl-btn wl-btn--primary" data-wl-action="add-ticker">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg>
            Add ticker
          </button>
          <button type="button" class="wl-btn" data-wl-action="edit">Edit</button>
          <button type="button" class="wl-btn wl-btn--danger" data-wl-action="delete">Delete</button>
        </div>
      </div>
      <p class="wl-header__meta">${meta}</p>
      <hr class="wl-header__divider">
      <div class="wl-header__stats">
        <div class="wl-stat">
          <span class="wl-stat__label">Gainers</span>
          <div class="wl-stat__value">${gainersHtml}</div>
        </div>
        <div class="wl-stat">
          <span class="wl-stat__label">Avg change</span>
          <div class="wl-stat__value">${avgChangeHtml}</div>
        </div>
        <div class="wl-stat">
          <span class="wl-stat__label">Biggest mover</span>
          <div class="wl-stat__value">${biggestMoverHtml}</div>
        </div>
        <div class="wl-stat">
          <span class="wl-stat__label">Avg ADR</span>
          <div class="wl-stat__value">${avgAdrHtml}</div>
        </div>
      </div>`;
  }

  // ── Empty states ─────────────────────────────────────────────────────────────

  function renderEmptyNoWatchlists() {
    return `
      <div class="wl-empty-state wl-empty-state--page">
        <p class="wl-empty-state__heading">Start your first watchlist</p>
        <p class="wl-empty-state__body">Create a watchlist to organise tickers by setup, theme, or timeframe \u2014 then track price, change, and ADR at a glance.</p>
        <button type="button" class="wl-btn wl-btn--primary" data-wl-action="new">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg>
          New watchlist
        </button>
      </div>`;
  }

  function renderEmptyWatchlist() {
    return `
      <div class="wl-empty-state">
        <p class="wl-empty-state__heading">This watchlist is empty</p>
        <p class="wl-empty-state__body">Add a section to organise your tickers, then add the symbols you want to track.</p>
        <div class="wl-empty-state__actions">
          <button type="button" class="wl-btn" data-wl-action="edit">Add section</button>
          <button type="button" class="wl-btn wl-btn--primary" data-wl-action="add-ticker">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg>
            Add ticker
          </button>
        </div>
      </div>`;
  }

  function renderEmptySection() {
    return `
      <div class="wl-section-empty-row">
        <span class="wl-section-empty-row__text">No tickers in this section.</span>
        <button type="button" class="wl-btn wl-btn--ghost wl-section-empty-row__btn" data-wl-action="add-ticker">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><line x1="5.5" y1="1" x2="5.5" y2="10"/><line x1="1" y1="5.5" x2="10" y2="5.5"/></svg>
          Add ticker
        </button>
      </div>`;
  }

  function renderNoSelection() {
    return `<div class="wl-empty-state wl-empty-state--no-selection">
      <p class="wl-empty-state__body">Select a watchlist from the sidebar.</p>
    </div>`;
  }

  // ── Section card + ticker table (checkpoint: ported from original code) ───────
  // These will be replaced in steps 4-5 with the grid-based redesign.

  function renderSectionCard({ section, index, isOpen, rowLookup }) {
    const { escapeHtml: esc } = C();
    const chevron = isOpen ? '\u25be' : '\u25b8';
    const bodyMarkup = isOpen
      ? renderSectionTable(section, rowLookup)
      : '<div class="helper" style="padding:8px 10px">Expand to load rows.</div>';
    return `
      <details class="social-watchlist-group-card" data-group-key="${esc(section.key)}" ${isOpen ? 'open' : ''}>
        <summary class="social-watchlist-group-summary">
          <span class="social-watchlist-group-heading">
            <span class="social-watchlist-group-chevron" aria-hidden="true">${chevron}</span>
            <span class="social-watchlist-group-name">${esc(section.title || `Group ${index + 1}`)}</span>
          </span>
          <span class="social-watchlist-group-count">${section.tickers.length}</span>
        </summary>
        <div class="social-watchlist-group-body">
          ${bodyMarkup}
        </div>
      </details>`;
  }

  function renderSectionTable(section, rowLookup) {
    const { escapeHtml: esc, normalizeTicker, buildMarketRowsSignature } = C();
    const rows = section.tickers.map((t) => rowLookup.get(normalizeTicker(t)) || { ticker: t });
    if (!rows.length) return renderEmptySection();
    return `
      <div class="social-watchlist-table-wrap social-watchlist-table-wrap--group">
        <table class="social-watchlist-table">
          <thead><tr>
            <th>Ticker</th><th>Price</th><th>Change</th><th>ADR%</th><th>Volume</th>
          </tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr data-watchlist-ticker="${esc(normalizeTicker(row.ticker))}"
                  data-row-sig="${esc(buildMarketRowsSignature([row]))}">
                ${renderRowMarkup(row)}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderRowMarkup(row) {
    const { escapeHtml: esc, fmtPct, fmtPrice, fmtVolume, fmtAsOf, sessionLabel, sessionClass } = C();
    const change = row.displayChangePct ?? row.percentChangeToday;
    const changeClass = Number(change) > 0 ? 'is-pos' : Number(change) < 0 ? 'is-neg' : '';
    const priceStr = row.displayPrice != null ? fmtPrice(row.displayPrice, row.currency === 'GBP' ? '\u00a3' : row.currency === 'EUR' ? '\u20ac' : '$') : '\u2014';
    const asOf = fmtAsOf(row.asOf);
    return `
      <td>
        <strong>${esc(row.ticker || '\u2014')}</strong>
        <span class="social-watchlist-session-badge ${sessionClass(row)}">${esc(sessionLabel(row))}</span>
        ${row.isStale ? '<span class="social-watchlist-stale-indicator">Stale</span>' : ''}
        ${row.name ? `<div class="helper">${esc(row.name)}</div>` : ''}
        ${asOf ? `<div class="helper">${esc(asOf)}${row.isDelayed ? ' \u00b7 Delayed' : ''}</div>` : ''}
      </td>
      <td>${esc(priceStr)}</td>
      <td class="${changeClass}">${esc(fmtPct(change))}</td>
      <td>${esc(fmtPct(row.adrPercent))}</td>
      <td>${esc(fmtVolume(row.dollarVolume) || row.dollarVolumeDisplay || '\u2014')}</td>`;
  }

  // ── Modal builder (ported from original code) ────────────────────────────────

  function buildTickerPill(ticker, containerId, index) {
    const { escapeHtml: esc } = C();
    const st = esc(ticker);
    return `
      <div class="watchlist-builder-pill" data-ticker="${st}" tabindex="0" role="listitem" aria-label="Ticker ${st}">
        <span>${st}</span>
        <div class="watchlist-pill-actions">
          <button type="button" class="watchlist-pill-btn" data-action="up"
            data-container-id="${esc(containerId)}" data-index="${index}" aria-label="Move ${st} up">\u2191</button>
          <button type="button" class="watchlist-pill-btn" data-action="down"
            data-container-id="${esc(containerId)}" data-index="${index}" aria-label="Move ${st} down">\u2193</button>
        </div>
      </div>`;
  }

  function renderBuilder(builder) {
    const { escapeHtml: esc, UNGROUPED_TITLE } = C();
    const groupsMarkup = builder.groups.map((group, groupIndex) => `
      <section class="watchlist-dropzone-card" data-group-id="${esc(group.id)}">
        <header class="watchlist-dropzone-head">
          <input type="text" class="watchlist-group-name" data-group-name="${esc(group.id)}"
            value="${esc(group.name)}" aria-label="Group name" maxlength="80">
          <button type="button" class="ghost watchlist-group-delete"
            data-delete-group="${esc(group.id)}">Delete</button>
        </header>
        <div class="watchlist-pill-zone" data-container="${esc(group.id)}" role="list"
          aria-label="${esc(group.name || `Group ${groupIndex + 1}`)} tickers">
          ${group.tickers.map((t, i) => buildTickerPill(t, group.id, i)).join('')}
        </div>
      </section>`).join('');

    return `
      <section class="watchlist-dropzone-card watchlist-dropzone-card--ungrouped">
        <header class="watchlist-dropzone-head">
          <strong>${UNGROUPED_TITLE}</strong>
          <span class="helper">Drop newly added tickers here</span>
        </header>
        <div class="watchlist-pill-zone" data-container="ungrouped" role="list" aria-label="Ungrouped tickers">
          ${builder.ungrouped.map((t, i) => buildTickerPill(t, 'ungrouped', i)).join('')}
        </div>
      </section>
      ${groupsMarkup || '<p class="helper">No groups yet. Add one when you are ready to organize.</p>'}`;
  }

  window.WatchlistsRender = {
    renderSidebarGroups,
    renderSidebarItem,
    renderWatchlistHeader,
    renderEmptyNoWatchlists,
    renderEmptyWatchlist,
    renderEmptySection,
    renderNoSelection,
    renderSectionCard,
    renderSectionTable,
    renderRowMarkup,
    buildTickerPill,
    renderBuilder
  };
})();
