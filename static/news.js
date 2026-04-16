const NEWS_TABS = {
  'for-you': { key: 'for-you', label: 'For You', endpoint: '/api/news/for-you', sectionOrder: ['upcomingEvents', 'recentRelevantHeadlines', 'recentlyUpdatedRelevant', 'portfolioUpcomingEarnings', 'macroUpcoming'] },
  calendar: { key: 'calendar', label: 'Calendar', endpoint: '/api/news/calendar', sectionOrder: ['today', 'next7Days', 'later'] },
  news: { key: 'news', label: 'News', endpoint: '/api/news/latest', sectionOrder: ['headlines'] }
};

const TAB_QUERY_KEY = 'tab';
const DEFAULT_TAB = 'for-you';
const DEFAULT_LIMIT = 25;

function normalizeTab(value) {
  if (value === 'latest') return 'news';
  return NEWS_TABS[value] ? value : DEFAULT_TAB;
}

function resolveInitialTab(search = '') {
  const requestedTab = new URLSearchParams(search).get(TAB_QUERY_KEY) || DEFAULT_TAB;
  return {
    requestedTab,
    activeTab: normalizeTab(requestedTab)
  };
}

function mergeUniqueById(existing = [], incoming = []) {
  const seen = new Set();
  const merged = [];
  for (const item of [...existing, ...incoming]) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

function buildSectionList(tabKey, response) {
  const sections = Array.isArray(response?.sections) ? response.sections : [];
  const sectionMap = new Map(sections.map((section) => [section?.summary?.key, section]));
  const order = NEWS_TABS[tabKey]?.sectionOrder || [];
  return order.map((key) => sectionMap.get(key)).filter(Boolean);
}

function formatCurrencyCompact(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return null;
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 100e9 ? 0 : 1).replace(/\.0$/, '')}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 100e6 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `${sign}$${num.toFixed(2)}`;
}

function formatEpsEstimate(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const sign = num < 0 ? '-' : '';
  return `${sign}$${Math.abs(num).toFixed(2)}`;
}

function timelineDateValue(item = {}) {
  return item.scheduledAt || item.eventDate || item.publishedAt || '';
}

function parseTimelineDate(item = {}) {
  const raw = timelineDateValue(item);
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function hasExplicitTimestamp(item = {}) {
  const raw = String(timelineDateValue(item) || '');
  if (!raw) return false;
  if (raw.includes('T')) return !/T00:00(:00(\.000)?)?Z?$/.test(raw);
  return false;
}

function sessionOrder(item = {}) {
  const marker = String(item.timeLabel || item.earningsTiming || item.session || '').toLowerCase();
  if (!marker) return 50;
  if (marker.includes('pre') || marker.includes('before open') || marker.includes('bmo')) return 10;
  if (marker.includes('open') || marker.includes('intraday')) return 20;
  if (marker.includes('close')) return 30;
  if (marker.includes('after') || marker.includes('post') || marker.includes('ah') || marker.includes('pm')) return 40;
  return 50;
}

function buildTimelineIdentity(item = {}) {
  return [
    item.eventType || 'event',
    (item.canonicalTicker || item.ticker || '').toUpperCase(),
    String(item.title || '').trim().toLowerCase(),
    String(item.summary || '').trim().toLowerCase(),
    String(timelineDateValue(item) || ''),
    String(item.timeLabel || item.earningsTiming || '').toLowerCase()
  ].join('|');
}

function buildUnifiedTimelineItems(items = []) {
  const seenIds = new Set();
  const seenIdentity = new Set();
  const prepared = [];
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== 'object') continue;
    if (item.id && seenIds.has(item.id)) continue;
    if (item.id) seenIds.add(item.id);
    const identity = buildTimelineIdentity(item);
    if (seenIdentity.has(identity)) continue;
    seenIdentity.add(identity);
    const parsed = parseTimelineDate(item);
    prepared.push({
      ...item,
      __timelineIndex: index,
      __timelineTs: parsed ? parsed.getTime() : Number.POSITIVE_INFINITY,
      __hasExplicitTimestamp: hasExplicitTimestamp(item),
      __sessionOrder: sessionOrder(item)
    });
  }
  return prepared.sort((a, b) => {
    if (a.__timelineTs !== b.__timelineTs) return a.__timelineTs - b.__timelineTs;
    if (a.__hasExplicitTimestamp !== b.__hasExplicitTimestamp) return a.__hasExplicitTimestamp ? -1 : 1;
    if (a.__sessionOrder !== b.__sessionOrder) return a.__sessionOrder - b.__sessionOrder;
    return a.__timelineIndex - b.__timelineIndex;
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    normalizeTab,
    resolveInitialTab,
    mergeUniqueById,
    buildSectionList,
    formatCurrencyCompact,
    formatEpsEstimate,
    buildUnifiedTimelineItems,
    sessionOrder
  };
}

if (typeof window === 'undefined' || typeof document === 'undefined') {
  // no-op in test environment
} else {
  const state = {
    activeTab: resolveInitialTab(window.location.search).activeTab,
    pageLoading: true,
    filters: {
      portfolioOnly: false,
      highImportanceOnly: false,
      calendarFrom: ''
    },
    preferences: null,
    preferencesDraft: null,
    notificationCenter: {
      items: [],
      unreadCount: 0
    },
    tabData: Object.keys(NEWS_TABS).reduce((acc, key) => {
      acc[key] = {
        loaded: false,
        loading: false,
        error: null,
        model: null,
        items: [],
        pagination: null,
        lastFilterSignature: ''
      };
      return acc;
    }, {})
  };

  const els = {
    panel: document.getElementById('news-tab-panel'),
    refreshBtn: document.getElementById('news-refresh-btn'),
    prefsBtn: document.getElementById('news-preferences-btn'),
    tabs: Array.from(document.querySelectorAll('.news-tab')),
    portfolioOnly: document.getElementById('filter-portfolio-only'),
    highImportanceOnly: document.getElementById('filter-high-importance'),
    calendarFrom: document.getElementById('filter-calendar-from'),
    calendarFromWrap: document.getElementById('news-date-filter-wrap'),
    filterTickerChips: document.getElementById('news-filter-ticker-chips'),
    prefsModal: document.getElementById('news-preferences-modal'),
    prefsGrid: document.getElementById('news-preferences-grid'),
    prefsStatus: document.getElementById('news-preferences-status'),
    prefsClose: document.getElementById('close-news-preferences-btn'),
    prefsCancel: document.getElementById('cancel-news-preferences-btn'),
    prefsSave: document.getElementById('save-news-preferences-btn'),
    notificationCenter: document.getElementById('news-notification-center'),
    notificationList: document.getElementById('news-notification-list'),
    notificationUnread: document.getElementById('news-notification-unread-count')
  };

  const preferenceControls = [
    { key: 'macroEnabled', label: 'Macro events', group: 'Categories' },
    { key: 'earningsEnabled', label: 'Earnings events', group: 'Categories' },
    { key: 'stockNewsEnabled', label: 'Stock headlines (coming soon)', group: 'Categories', comingSoon: true },
    { key: 'worldNewsEnabled', label: 'World headlines (coming soon)', group: 'Categories', comingSoon: true },
    { key: 'internalPostsEnabled', label: 'Internal posts (coming soon)', group: 'Categories', comingSoon: true },
    { key: 'portfolioOnly', label: 'Portfolio-only notifications', group: 'Scope' },
    { key: 'highImportanceOnly', label: 'High-importance notifications', group: 'Scope' },
    {
      key: 'rankingMode',
      label: 'Headline ranking mode',
      group: 'Personalization',
      type: 'select',
      options: [
        { value: 'strict_signal', label: 'Strict signal — portfolio-first and quiet' },
        { value: 'balanced', label: 'Balanced — default portfolio + selective watchlist' },
        { value: 'discovery', label: 'Discovery — bounded watchlist + market context' }
      ]
    },
    { key: 'notifyPush', label: 'Push notifications', group: 'Channels' },
    { key: 'notifyInApp', label: 'In-app notifications', group: 'Channels' },
    { key: 'notifyEmail', label: 'Email notifications', group: 'Channels' },
    { key: 'notifyImmediate', label: 'Immediate alert', group: 'Timing' },
    { key: 'notifyOneDayBefore', label: '1 day before', group: 'Timing' },
    { key: 'notifyOneHourBefore', label: '1 hour before', group: 'Timing' },
    { key: 'notifyFifteenMinutesBefore', label: '15 minutes before', group: 'Timing' },
    { key: 'dailyDigestEnabled', label: 'Daily digest', group: 'Timing' }
  ];

  function log(event, payload = {}) {
    window.PerfDiagnostics?.log(`news-${event}`, payload);
  }

  function diagnostics(event, payload = {}) {
    console.info('[NewsPage:Diagnostics]', event, payload);
    log(`diagnostics-${event}`, payload);
  }

  async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const fetchPromise = fetch(path, { credentials: 'include', ...opts });
    const res = window.PerfDiagnostics
      ? await window.PerfDiagnostics.trackApi(`news-api:${method}:${path}`, fetchPromise)
      : await fetchPromise;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      window.location.href = '/login.html';
      return {};
    }
    if (!res.ok) {
      const error = new Error(data?.error || `Request failed (${res.status})`);
      error.data = data;
      throw error;
    }
    return data;
  }

  function filterSignature() {
    return JSON.stringify(state.filters);
  }

  function buildQueryParams(tabKey, cursor = null) {
    const params = new URLSearchParams();
    params.set('limit', String(DEFAULT_LIMIT));
    if (cursor) params.set('cursor', cursor);
    if (state.filters.highImportanceOnly) {
      params.set('highImportanceOnly', 'true');
      params.set('importance', '80');
    }
    if (state.filters.portfolioOnly) params.set('portfolioOnly', 'true');
    if (tabKey === 'calendar' && state.filters.calendarFrom) {
      params.set('from', new Date(`${state.filters.calendarFrom}T00:00:00.000Z`).toISOString());
    }
    return params;
  }

  function setTabInUrl(tab) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set(TAB_QUERY_KEY, tab);
    window.history.replaceState({}, '', nextUrl.toString());
  }

  function renderTabs() {
    els.tabs.forEach((tabBtn) => {
      const active = tabBtn.dataset.tab === state.activeTab;
      tabBtn.classList.toggle('is-active', active);
      tabBtn.setAttribute('aria-selected', String(active));
    });
    els.calendarFromWrap.classList.toggle('is-hidden', state.activeTab !== 'calendar');
  }

  function toneClass(tone) {
    return `news-card-badge--${tone || 'neutral'}`;
  }

  function accentClass(item = {}) {
    const variant = item.accentVariant
      || (item.eventType === 'earnings' ? 'earnings' : '')
      || (item.eventType === 'macro' ? (Number(item.importance || 0) >= 80 ? 'macro-critical' : 'macro') : '')
      || (item.eventType === 'news' || item.eventType === 'stock_news' || item.eventType === 'world_news' ? 'news' : '')
      || 'catalyst';
    return `event-accent-${variant}`;
  }

  function compactTypeLabel(item = {}) {
    if (item.eventType === 'earnings') return 'Earnings';
    if (item.eventType === 'macro') return 'Macro';
    if (item.eventType === 'news' || item.eventType === 'stock_news' || item.eventType === 'world_news') return 'News';
    const badge = String(item.badgeLabel || '').toLowerCase();
    if (badge.includes('earnings')) return 'Earnings';
    if (badge.includes('macro')) return 'Macro';
    if (badge.includes('news')) return 'News';
    return 'Event';
  }

  function compactPillLabel(item = {}) {
    if (item.eventType === 'earnings') return 'earnings';
    if (item.eventType === 'macro') return 'macro';
    if (item.eventType === 'news' || item.eventType === 'stock_news' || item.eventType === 'world_news') return 'news';
    return String(item.badgeLabel || 'update').toLowerCase();
  }

  function getSectionItems(section = {}) {
    return Array.isArray(section.items) ? section.items : [];
  }

  function renderCard(item = {}, { compact = false } = {}) {
    const marker = [
      item.isPortfolioRelevant ? '<span class="pill">Portfolio</span>' : '',
      item.isHighImportance ? '<span class="pill warning">High impact</span>' : ''
    ].join('');
    const ticker = item.canonicalTicker || item.ticker;
    const sourceLink = item.sourceUrl
      ? `<a class="news-source-link" href="${item.sourceUrl}" target="_blank" rel="noopener noreferrer">Source</a>`
      : '';
    const formattedEps = item.earningsEpsEstimate != null ? formatEpsEstimate(item.earningsEpsEstimate) : null;
    const formattedRev = item.earningsRevenueEstimate != null ? formatCurrencyCompact(item.earningsRevenueEstimate) : null;
    const earningsExtras = item.eventType === 'earnings' ? [
      item.earningsTiming ? `<span class="news-card-earning-timing">${item.earningsTiming}</span>` : '',
      item.earningsQuarter ? `<span class="news-card-quarter">${item.earningsQuarter}</span>` : ''
    ].join('') : '';
    // For earnings cards build the summary from formatted fields so stored raw-number summaries don't leak through
    let summaryText = item.summary || 'No summary available.';
    if (item.eventType === 'earnings') {
      const earningsTicker = ticker || '';
      const parts = [];
      if (item.earningsTiming) parts.push(item.earningsTiming);
      if (formattedEps) parts.push(`EPS est ${formattedEps}`);
      if (formattedRev) parts.push(`Rev est ${formattedRev}`);
      summaryText = parts.length
        ? `${earningsTicker} earnings (${parts.join(', ')})`
        : `${earningsTicker} earnings scheduled`;
    }
    const rowDate = compact ? (item.eventDate || item.scheduledAt || item.publishedAt) : null;
    const compactDate = rowDate ? new Date(rowDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' }) : 'TBD';
    return `
      <article class="news-card ${compact ? 'news-card--compact' : ''} ${accentClass(item)} relevance-${item.relevanceClass || 'neutral'} urgency-${item.urgencyClass || 'none'}">
        <div class="news-card-topline">
          <span class="news-card-badge ${toneClass(item.badgeTone)}">${item.badgeLabel || 'Update'}</span>
          <span class="news-card-time">${compact ? `${compactDate} · ${item.timeLabel || 'No time set'}` : (item.timeLabel || 'No time set')}</span>
        </div>
        <h4>${item.title || 'Untitled event'}</h4>
        <p class="news-card-summary">${summaryText}</p>
        <div class="news-card-meta">
          ${ticker ? `<span class="news-card-ticker">${ticker}</span>` : ''}
          ${earningsExtras}
          <span class="news-card-source">${item.sourceName || item.sourceType || 'Unknown source'}</span>
          ${marker}
          ${sourceLink}
        </div>
      </article>
    `;
  }

  function renderUpcomingEventsByDate(items = []) {
    const timelineItems = buildUnifiedTimelineItems(items);
    const grouped = new Map();
    for (const item of timelineItems) {
      const rawDate = timelineDateValue(item);
      const parsed = new Date(rawDate);
      const key = Number.isNaN(parsed.getTime()) ? 'Date TBD' : parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    }
    return Array.from(grouped.entries()).map(([dateLabel, groupItems]) => `
      <div class="news-date-group">
        <div class="news-date-header">${dateLabel}</div>
        <div class="news-row-list">
          ${groupItems.map((item) => renderCompactEventRow(item)).join('')}
        </div>
      </div>
    `).join('');
  }

  function renderCompactEventRow(item = {}) {
    const formatShortDate = (value) => {
      const parsed = value ? new Date(value) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) return null;
      return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    };
    const rowDate = item.eventDate || item.scheduledAt || item.publishedAt;
    const endDateValue = item.endDate
      || item.endAt
      || item.scheduledEnd
      || item.eventDateEnd
      || item.metadataJson?.endDate
      || item.metadataJson?.endAt
      || null;
    const startDateLabel = formatShortDate(rowDate);
    const endDateLabel = formatShortDate(endDateValue);
    const dateLabel = startDateLabel && endDateLabel && startDateLabel !== endDateLabel
      ? `${startDateLabel}–${endDateLabel.replace(/^[A-Za-z]{3}\s/, '')}`
      : (startDateLabel || 'TBD');
    const ticker = item.canonicalTicker || item.ticker;
    const summaryText = item.summary || '';
    const middleText = `${item.title || 'Untitled event'}${summaryText ? ` · ${summaryText}` : ''}`;
    const timingText = item.timeLabel || item.earningsTiming || (item.__sessionOrder < 50 ? compactPillLabel(item).toUpperCase() : 'Time TBC');
    const isPortfolioEarnings = item.eventType === 'earnings' && item.isPortfolioRelevant;
    const rowPriorityClass = isPortfolioEarnings
      ? 'news-event-row--priority'
      : (item.isHighImportance ? 'news-event-row--elevated' : 'news-event-row--standard');
    const sourceLink = item.sourceUrl
      ? `<a class="news-source-link news-source-link--row" href="${item.sourceUrl}" target="_blank" rel="noopener noreferrer">Source</a>`
      : '';
    return `
      <article class="news-event-row ${accentClass(item)} ${rowPriorityClass}" title="${item.badgeLabel || compactTypeLabel(item)}">
        <div class="news-event-row__type">${compactTypeLabel(item)}</div>
        <div class="news-event-row__main">
          ${ticker ? `<span class="news-card-ticker">${ticker}</span>` : ''}
          <span class="news-event-row__text">${middleText}</span>
        </div>
        <div class="news-event-row__time">${timingText}</div>
        <div class="news-event-row__meta">
          <span class="news-row-pill">${compactPillLabel(item)}</span>
          <span class="news-event-row__date">${dateLabel}</span>
          ${sourceLink}
        </div>
      </article>
    `;
  }

  function renderEmpty(title, subtitle, withRetry = false) {
    els.panel.innerHTML = `
      <div class="news-empty-state">
        <h3>${title}</h3>
        <p>${subtitle}</p>
        ${withRetry ? '<button id="news-retry-btn" class="primary" type="button">Retry</button>' : ''}
      </div>
    `;
    if (withRetry) {
      document.getElementById('news-retry-btn')?.addEventListener('click', () => fetchTab(state.activeTab, { reset: true }));
    }
  }

  function renderLoading() {
    els.panel.innerHTML = `
      <div class="news-skeleton-wrap">
        <div class="news-skeleton"></div>
        <div class="news-skeleton"></div>
        <div class="news-skeleton"></div>
      </div>
    `;
  }

  function buildPortfolioContextHtml(model = {}) {
    const context = model?.portfolioContext || {};
    const tickers = Array.isArray(context?.trackedTickers) ? context.trackedTickers : [];
    const count = tickers.length;
    if (count === 0) return '';
    const chips = tickers.map((t) => `<span class="news-ticker-chip">${t}</span>`).join('');
    const nextLine = context.nextEarningsTicker
      ? `<div class="news-context-next">Next earnings: <strong>${context.nextEarningsTicker}</strong> — ${context.nextEarningsTimeLabel || 'date TBC'}</div>`
      : '';
    return `
      <div class="news-portfolio-context">
        <div class="news-context-label">Tracking ${count} position${count !== 1 ? 's' : ''}</div>
        <div class="news-context-tickers">${chips}</div>
        ${nextLine}
      </div>
    `;
  }

  function renderFilterTickerChips(model = {}) {
    if (!els.filterTickerChips) return;
    if (state.activeTab !== 'for-you') {
      els.filterTickerChips.innerHTML = '';
      return;
    }
    const tickers = Array.isArray(model?.portfolioContext?.trackedTickers)
      ? model.portfolioContext.trackedTickers
      : [];
    if (!tickers.length) {
      els.filterTickerChips.innerHTML = '';
      return;
    }
    els.filterTickerChips.innerHTML = tickers.map((ticker) => `<span class="news-ticker-chip">${ticker}</span>`).join('');
  }

  function renderTab() {
    renderTabs();
    const tabState = state.tabData[state.activeTab];

    if (tabState.loading && !tabState.loaded) {
      renderLoading();
      return;
    }
    if (tabState.error) {
      log('error-state', { tab: state.activeTab, message: tabState.error.message });
      renderEmpty('Unable to load this tab', tabState.error.message || 'Please try again.', true);
      return;
    }

    const model = tabState.model || {};
    renderFilterTickerChips(model);
    const sections = buildSectionList(state.activeTab, model);
    const sectionPayloadLengths = sections.map((section) => ({
      key: section.summary?.key || 'unknown',
      itemCount: getSectionItems(section).length
    }));
    diagnostics('render-tab-state', {
      tab: state.activeTab,
      filters: { ...state.filters },
      tabItemsLength: tabState.items.length,
      sectionPayloadLengths
    });

    if (state.activeTab === 'news' && !tabState.items.length) {
      log('empty-state', { tab: state.activeTab, reason: 'latest-empty' });
      return renderEmpty('No headlines available', model?.emptyState?.message || 'News headlines are not available right now. Check back soon.');
    }

    const totalRenderedItems = sections.reduce((sum, section) => sum + getSectionItems(section).length, 0);
    // For the 'for-you' tab we always render sections (portfolio earnings shows its own empty state)
    if (!totalRenderedItems && state.activeTab !== 'for-you') {
      log('empty-state', { tab: state.activeTab, reason: 'no-items' });
      return renderEmpty('No events to show', 'Try relaxing filters or check back soon.');
    }

    const portfolioContext = model?.portfolioContext || {};
    const sectionsHtml = sections.map((section) => {
      const sectionKey = section.summary?.key || '';
      const items = getSectionItems(section);

      if (sectionKey === 'upcomingEvents' && !items.length) {
        return `
          <section class="news-section">
            <div class="section-header">
              <h3>${section.summary?.title || 'Upcoming Events'}</h3>
              <span class="pill">0</span>
            </div>
            <div class="news-empty-state">
              <p>No upcoming events are available right now.</p>
            </div>
          </section>
        `;
      }

      if (sectionKey === 'portfolioUpcomingEarnings' && !items.length) {
        const hasPositions = (portfolioContext.trackedTickerCount || 0) > 0;
        const emptyMsg = hasPositions
          ? 'No earnings scheduled in the next 45 days for your active positions.'
          : 'No active positions found. Add trades to your journal to track upcoming earnings.';
        return `
          <section class="news-section">
            <div class="section-header">
              <h3>${section.summary?.title || 'Upcoming Earnings'}</h3>
              <span class="pill">0</span>
            </div>
            <div class="news-empty-state">
              <p>${emptyMsg}</p>
            </div>
          </section>
        `;
      }

      if (!items.length) return '';
      if (state.activeTab === 'for-you' && sectionKey === 'upcomingEvents') {
        const sectionLookup = Object.fromEntries(sections.map((entry) => [entry?.summary?.key, entry]));
        const upcoming = getSectionItems(sectionLookup.upcomingEvents || {});
        const earnings = getSectionItems(sectionLookup.portfolioUpcomingEarnings || {});
        const macro = getSectionItems(sectionLookup.macroUpcoming || {});
        // Canonical timeline source: visible upcoming, plus dedicated earnings/macro sections as fallback.
        const canonicalTimeline = buildUnifiedTimelineItems([...upcoming, ...earnings, ...macro]);
        const nextItem = canonicalTimeline[0];
        const parsedNextDate = nextItem ? parseTimelineDate(nextItem) : null;
        const nextDateText = parsedNextDate
          ? parsedNextDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
          : 'date TBC';
        const nextTimingText = nextItem?.timeLabel || nextItem?.earningsTiming || 'time TBC';
        const nextTitleText = nextItem
          ? `${nextItem.canonicalTicker || nextItem.ticker || compactTypeLabel(nextItem)} ${compactTypeLabel(nextItem)}`
          : 'No upcoming events';
        const nextLine = `<span class="news-inline-next">Next: <strong>${nextTitleText}</strong> — ${nextDateText}${nextItem ? ` (${nextTimingText})` : ''}</span>`;
        return `
          <section class="news-section">
            <div class="section-header news-upcoming-header">
              <h3>${section.summary?.title || 'Upcoming events'}</h3>
              <span class="news-upcoming-dot" aria-hidden="true">·</span>
              <span class="pill">${canonicalTimeline.length}</span>
              <span class="news-upcoming-dot" aria-hidden="true">·</span>
              ${nextLine}
            </div>
            ${renderUpcomingEventsByDate(canonicalTimeline)}
          </section>
        `;
      }
      if (state.activeTab === 'for-you' && (sectionKey === 'portfolioUpcomingEarnings' || sectionKey === 'macroUpcoming')) return '';
      return `
        <section class="news-section">
          <div class="section-header">
            <h3>${section.summary?.title || 'Section'}</h3>
            <span class="pill">${items.length}</span>
          </div>
          <div class="news-card-list">
            ${items.map(renderCard).join('')}
          </div>
        </section>
      `;
    }).join('');

    const hasMore = Boolean(tabState.pagination?.hasMore && tabState.pagination?.cursor);
    els.panel.innerHTML = `
      ${sectionsHtml}
      <div class="news-load-more-wrap">
        ${hasMore ? '<button id="news-load-more-btn" class="ghost" type="button">Load more</button>' : ''}
      </div>
    `;

    document.getElementById('news-load-more-btn')?.addEventListener('click', () => fetchTab(state.activeTab, { append: true }));
  }

  function formatNotificationTime(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Unknown time';
    return parsed.toLocaleString();
  }

  function renderNotificationCenter() {
    if (!els.notificationList || !els.notificationUnread || !els.notificationCenter) return;
    const items = Array.isArray(state.notificationCenter.items) ? state.notificationCenter.items : [];
    // Hide the entire notification center when there are no items
    els.notificationCenter.classList.toggle('hidden', !items.length);
    if (!items.length) {
      els.notificationList.innerHTML = '';
      return;
    }
    els.notificationUnread.textContent = String(state.notificationCenter.unreadCount || 0);
    els.notificationList.innerHTML = items.map((item) => `
      <article class="news-notification-item ${item.isRead ? '' : 'is-unread'}" data-notification-id="${item.id}">
        <div class="news-notification-item__meta">
          <span>${item.badge || 'News'}</span>
          <span>${formatNotificationTime(item.deliveredAt || item.createdAt)}</span>
        </div>
        <h4>${item.title || 'Market update'}</h4>
        <p>${item.summary || item.body || ''}</p>
        <div class="news-notification-item__actions">
          <a class="ghost" href="${item.deepLinkUrl || '/news.html?tab=for-you'}">Open</a>
          ${item.isRead ? '' : '<button class="ghost" type="button" data-mark-read="true">Mark read</button>'}
        </div>
      </article>
    `).join('');

    els.notificationList.querySelectorAll('[data-mark-read="true"]').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        const card = event.target.closest('[data-notification-id]');
        const notificationId = card?.getAttribute('data-notification-id');
        if (!notificationId) return;
        try {
          await api(`/api/news/notifications/in-app/${encodeURIComponent(notificationId)}/read`, { method: 'POST' });
          await loadInAppNotifications();
        } catch (error) {
          console.warn('[NewsPage] mark-read failed', error?.message || error);
        }
      });
    });
  }

  async function loadInAppNotifications() {
    try {
      const payload = await api('/api/news/notifications/in-app?limit=12');
      state.notificationCenter.items = Array.isArray(payload?.data) ? payload.data : [];
      state.notificationCenter.unreadCount = Number(payload?.unreadCount || 0);
    } catch (error) {
      console.warn('[NewsPage] notification-center load failed', error?.message || error);
      state.notificationCenter.items = [];
      state.notificationCenter.unreadCount = 0;
    }
    renderNotificationCenter();
  }

  async function fetchTab(tabKey, { append = false, reset = false } = {}) {
    const tabState = state.tabData[tabKey];
    const activeSignature = filterSignature();
    if (tabState.loading) return;

    if (!reset && tabState.loaded && !append && tabState.lastFilterSignature === activeSignature) {
      diagnostics('fetch-cache-hit', {
        tab: tabKey,
        activeSignature,
        cachedItemsLength: tabState.items.length,
        cachedPortfolioUpcomingEarningsLength: Array.isArray(tabState.model?.portfolioUpcomingEarnings) ? tabState.model.portfolioUpcomingEarnings.length : 0
      });
      return;
    }

    diagnostics('fetch-begin', {
      tab: tabKey,
      append,
      reset,
      activeSignature,
      usingCachedTabDataBeforeFetch: !!tabState.loaded,
      existingItemsLength: tabState.items.length,
      existingPortfolioUpcomingEarningsLength: Array.isArray(tabState.model?.portfolioUpcomingEarnings) ? tabState.model.portfolioUpcomingEarnings.length : 0
    });

    if (reset) {
      tabState.loaded = false;
      tabState.items = [];
      tabState.model = null;
      tabState.pagination = null;
      tabState.lastFilterSignature = '';
      diagnostics('fetch-reset-cleared-cache', { tab: tabKey });
    }

    tabState.loading = true;
    tabState.error = null;
    renderTab();

    const cursor = append ? tabState.pagination?.cursor : null;
    const params = buildQueryParams(tabKey, cursor);
    const requestPath = `${NEWS_TABS[tabKey].endpoint}?${params.toString()}`;
    log('tab-fetch-start', { tab: tabKey, append, reset, requestPath });
    const startedAt = Date.now();

    try {
      const payload = await api(requestPath);
      diagnostics('fetch-response', {
        tab: tabKey,
        append,
        payloadDataLength: Array.isArray(payload?.data) ? payload.data.length : 0,
        payloadSectionsLength: Array.isArray(payload?.sections) ? payload.sections.length : 0,
        payloadPortfolioUpcomingEarningsLength: Array.isArray(payload?.portfolioUpcomingEarnings) ? payload.portfolioUpcomingEarnings.length : 0,
        payloadUpcomingEventsLength: Array.isArray(payload?.upcomingEvents) ? payload.upcomingEvents.length : 0
      });
      const previousItems = append ? tabState.items : [];
      tabState.items = mergeUniqueById(previousItems, payload?.data || []);
      tabState.pagination = payload?.pagination || null;
      tabState.model = {
        ...(payload || {}),
        sections: Array.isArray(payload?.sections)
          ? payload.sections.map((section) => ({
            ...section,
            items: mergeUniqueById(
              append ? (tabState.model?.sections || []).find((candidate) => candidate?.summary?.key === section?.summary?.key)?.items || [] : [],
              section?.items || []
            )
          }))
          : []
      };
      diagnostics('fetch-cache-overwrite', {
        tab: tabKey,
        append,
        replacedCachedData: !append,
        cachedItemsLengthAfterMerge: tabState.items.length,
        cachedPortfolioUpcomingEarningsLength: Array.isArray(tabState.model?.portfolioUpcomingEarnings) ? tabState.model.portfolioUpcomingEarnings.length : 0
      });
      tabState.lastFilterSignature = activeSignature;
      tabState.loaded = true;
      log('tab-fetch-end', { tab: tabKey, append, durationMs: Date.now() - startedAt, count: tabState.items.length, hasMore: !!tabState.pagination?.hasMore });
    } catch (error) {
      tabState.error = error;
      console.error('[NewsPage] tab fetch failed', { tab: tabKey, error });
    } finally {
      tabState.loading = false;
      state.pageLoading = false;
      renderTab();
    }
  }

  function openPreferencesModal() {
    if (!state.preferencesDraft) return;
    els.prefsModal.classList.remove('hidden');
  }

  function closePreferencesModal() {
    els.prefsModal.classList.add('hidden');
  }

  function renderPreferencesForm() {
    const grouped = preferenceControls.reduce((acc, control) => {
      if (!acc[control.group]) acc[control.group] = [];
      acc[control.group].push(control);
      return acc;
    }, {});

    els.prefsGrid.innerHTML = Object.entries(grouped).map(([group, controls]) => `
      <section class="news-pref-group">
        <h4>${group}</h4>
        <div class="news-pref-list">
          ${controls.map((control) => {
            if (control.type === 'select') {
              return `
                <label class="toggle-control">
                  <span>${control.label}</span>
                  <select data-pref-select-key="${control.key}">
                    ${(control.options || []).map((option) => `
                      <option value="${option.value}" ${state.preferencesDraft?.[control.key] === option.value ? 'selected' : ''}>${option.label}</option>
                    `).join('')}
                  </select>
                </label>
              `;
            }
            return `
              <label class="toggle-control ${control.comingSoon ? 'is-coming-soon' : ''}">
                <input type="checkbox" data-pref-key="${control.key}" ${state.preferencesDraft?.[control.key] ? 'checked' : ''}>
                <span>${control.label}</span>
              </label>
            `;
          }).join('')}
        </div>
      </section>
    `).join('');

    els.prefsGrid.querySelectorAll('[data-pref-key]').forEach((input) => {
      input.addEventListener('change', (event) => {
        const key = event.target.getAttribute('data-pref-key');
        state.preferencesDraft[key] = !!event.target.checked;
      });
    });
    els.prefsGrid.querySelectorAll('[data-pref-select-key]').forEach((input) => {
      input.addEventListener('change', (event) => {
        const key = event.target.getAttribute('data-pref-select-key');
        state.preferencesDraft[key] = String(event.target.value || 'balanced');
      });
    });
  }

  async function loadPreferences() {
    log('preferences-load-start');
    try {
      const payload = await api('/api/news/preferences');
      state.preferences = payload?.data || {};
      state.preferencesDraft = { ...state.preferences };
      renderPreferencesForm();
      els.prefsStatus.textContent = '';
      log('preferences-load-end');
    } catch (error) {
      els.prefsStatus.textContent = 'Could not load preferences.';
      console.error('[NewsPage] preference load failed', error);
    }
  }

  async function savePreferences() {
    els.prefsStatus.textContent = 'Saving...';
    log('preferences-save-start');
    try {
      const payload = await api('/api/news/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state.preferencesDraft)
      });
      state.preferences = payload?.data || { ...state.preferencesDraft };
      state.preferencesDraft = { ...state.preferences };
      els.prefsStatus.textContent = 'Saved.';
      log('preferences-save-end', { success: true });
      setTimeout(closePreferencesModal, 300);
    } catch (error) {
      els.prefsStatus.textContent = error.message || 'Could not save preferences.';
      log('preferences-save-end', { success: false });
    }
  }

  function bindEvents() {
    els.tabs.forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        const nextTab = normalizeTab(tabBtn.dataset.tab || '');
        if (nextTab === state.activeTab) return;
        state.activeTab = nextTab;
        setTabInUrl(nextTab);
        renderTab();
        fetchTab(nextTab);
      });
    });

    els.refreshBtn.addEventListener('click', () => fetchTab(state.activeTab, { reset: true }));
    els.prefsBtn.addEventListener('click', openPreferencesModal);
    els.prefsClose.addEventListener('click', closePreferencesModal);
    els.prefsCancel.addEventListener('click', closePreferencesModal);
    els.prefsSave.addEventListener('click', savePreferences);

    els.portfolioOnly.addEventListener('change', () => {
      state.filters.portfolioOnly = els.portfolioOnly.checked;
      fetchTab(state.activeTab, { reset: true });
    });
    els.highImportanceOnly.addEventListener('change', () => {
      state.filters.highImportanceOnly = els.highImportanceOnly.checked;
      fetchTab(state.activeTab, { reset: true });
    });
    els.calendarFrom.addEventListener('change', () => {
      state.filters.calendarFrom = els.calendarFrom.value || '';
      if (state.activeTab === 'calendar') fetchTab('calendar', { reset: true });
    });
  }

  async function init() {
    const restoredTab = resolveInitialTab(window.location.search);
    log('tab-restored', restoredTab);
    log('page-load-start', { tab: state.activeTab });
    bindEvents();
    renderLoading();
    await Promise.all([loadPreferences(), fetchTab(state.activeTab), loadInAppNotifications()]);
    renderTab();
    log('page-load-end', { tab: state.activeTab });
  }

  init();
}
