const NEWS_TABS = {
  'for-you': { key: 'for-you', label: 'For You', endpoint: '/api/news/for-you', sectionOrder: ['upcomingEvents', 'recentRelevantHeadlines', 'recentlyUpdatedRelevant', 'portfolioUpcomingEarnings', 'macroUpcoming'] },
  calendar: { key: 'calendar', label: 'Calendar', endpoint: '/api/news/calendar', sectionOrder: ['today', 'next7Days', 'later'] },
  news: { key: 'news', label: 'News', endpoint: '/api/news/latest', sectionOrder: ['headlines'] },
  // Custom-render tabs: no backend endpoint, rendered entirely from client-side state
  'analyst-ratings': { key: 'analyst-ratings', label: 'Analyst Ratings', endpoint: null, sectionOrder: [], customRender: true },
  macro: { key: 'macro', label: 'Macro', endpoint: null, sectionOrder: [], customRender: true }
};

const TAB_QUERY_KEY = 'tab';
const DEFAULT_TAB = 'for-you';
const DEFAULT_LIMIT = 25;
const NEWS_SECTION_INFO = {
  marketPulse: 'A live snapshot of key market conditions. Shows the S&P 500 (via SPY), the VIX volatility index, the 10-year Treasury yield, and the current Fed Funds Rate with the next FOMC meeting date.',
  fearGreed: 'A composite sentiment score from 0 (Extreme Fear) to 100 (Extreme Greed), synthesised from three market signals: VIX volatility level, SPY daily momentum, and SPY\'s position within its 52-week range. Note: previous week and previous month values are approximated on the current data plan.',
  portfolioSentiment: 'A relative activity score per holding based on news volume and recency over the last 7 days. A higher score means more news coverage than usual — it does not indicate whether the news is positive or negative. Full sentiment analysis requires a paid data plan.',
  upcomingEvents: 'A chronological list of market events relevant to your portfolio, including earnings dates, FOMC meetings, and dividend ex-dates. Events marked HIGH have a position value over £1,000. Earnings estimates shown where available.',
  analystRatings: 'Recent analyst upgrades, downgrades, and new coverage initiations for your held tickers, sourced from Finnhub\'s recommendation trend data. Only actionable changes are shown by default — use the Analyst Ratings tab to see all ratings including reiterations.'
};

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
    exposureByTicker: {},
    exposureLoaded: false,
    // ── Enhancement state ─────────────────────────────────────
    marketPulse: { data: null, loaded: false, loading: false },
    sentimentData: { fearGreed: null, portfolio: [], loaded: false, loading: false },
    analystRatings: { items: [], loaded: false, loading: false },
    analystRatingsFilter: { ticker: '', actionType: '' },
    newsFeedOffset: 0, // for "Load more" in the news feed
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
    { key: 'nfpEnabled', label: 'Jobs reports (NFP)', group: 'Categories' },
    { key: 'gdpEnabled', label: 'GDP releases', group: 'Categories' },
    { key: 'ipoEnabled', label: 'IPO calendar', group: 'Categories' },
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
      || (item.eventType === 'nfp' || item.eventType === 'gdp' ? 'macro' : '')
      || (item.eventType === 'ipo' ? 'catalyst' : '')
      || (item.eventType === 'dividend' ? 'dividend' : '')
      || (item.eventType === 'news' || item.eventType === 'stock_news' || item.eventType === 'world_news' ? 'news' : '')
      || 'catalyst';
    return `event-accent-${variant}`;
  }

  function compactTypeLabel(item = {}) {
    if (item.eventType === 'earnings') return 'Earnings';
    if (item.eventType === 'macro') return 'Macro';
    if (item.eventType === 'nfp') return 'Jobs Report';
    if (item.eventType === 'gdp') return 'GDP Release';
    if (item.eventType === 'ipo') return 'IPO';
    if (item.eventType === 'dividend') return 'Dividend';
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
    if (item.eventType === 'nfp') return 'jobs';
    if (item.eventType === 'gdp') return 'gdp';
    if (item.eventType === 'ipo') return 'ipo';
    if (item.eventType === 'dividend') return 'dividend';
    if (item.eventType === 'news' || item.eventType === 'stock_news' || item.eventType === 'world_news') return 'news';
    return String(item.badgeLabel || 'update').toLowerCase();
  }

  function normalizeTicker(value) {
    return String(value || '').trim().toUpperCase();
  }

  // Countdown is intentionally render-time only (no interval) so we preserve scroll stability and keep updates cheap.
  function computeTimeToEvent(eventDate, now = new Date()) {
    const parsed = eventDate ? new Date(eventDate) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return null;
    const diffMs = parsed.getTime() - now.getTime();
    if (diffMs <= 0) return 'Today';
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const totalHours = Math.floor(totalMinutes / 60);
    const totalDays = Math.floor(totalHours / 24);
    if (totalDays >= 1) return `in ${totalDays}d ${totalHours % 24}h`;
    if (totalHours >= 1) return `in ${totalHours}h ${totalMinutes % 60}m`;
    return `in ${Math.max(1, totalMinutes)}m`;
  }

  // Exposure lookup is built once from already-available trade/account context and used as a lightweight ticker map.
  function resolveExposureLabel(item = {}) {
    const ticker = normalizeTicker(item.canonicalTicker || item.ticker);
    if (!ticker) return '';
    const exposureValue = Number(state.exposureByTicker[ticker]);
    if (!Number.isFinite(exposureValue) || exposureValue <= 0) return '';
    return `Position: ${formatCurrencyCompact(exposureValue)}`;
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

  function renderInfoTrigger(key, label) {
    const text = NEWS_SECTION_INFO[key];
    if (!text) return '';
    return `<button class="news-info-trigger" type="button" aria-label="${label}" data-news-info="${key}">i</button>`;
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
    const ticker = normalizeTicker(item.canonicalTicker || item.ticker);

    // ── Earnings enhancements ────────────────────────────────────
    // EPS estimate text appended inline to the row description
    const formattedEps = item.earningsEpsEstimate != null ? formatEpsEstimate(item.earningsEpsEstimate) : null;
    const earningsEpsText = (item.eventType === 'earnings' && formattedEps) ? ` · Est. EPS ${formattedEps}` : '';

    // "HIGH" badge: position value above $1,000 threshold
    const exposureValue = Number(state.exposureByTicker[ticker] || 0);
    const isHighPosition = item.eventType === 'earnings' && Number.isFinite(exposureValue) && exposureValue > 1000;
    const highBadge = isHighPosition
      ? '<span class="news-event-row__badge news-event-row__badge--high">HIGH</span>' : '';

    // "NEW EST" badge: EPS estimate revised within last 7 days
    const epsRevisedAt = item.earningsEpsEstimateRevisedAt;
    const isNewEst = item.eventType === 'earnings' && epsRevisedAt
      && (Date.now() - new Date(epsRevisedAt).getTime() < 7 * 24 * 3600 * 1000);
    const newEstBadge = isNewEst
      ? '<span class="news-event-row__badge news-event-row__badge--new-est">NEW EST</span>' : '';

    // ── FOMC probability ─────────────────────────────────────────
    // TODO: Replace stub — source: CME FedWatch API, expected field: item.fomcHoldProbability (0–1 decimal)
    const fomcProb = (item.eventType === 'macro' && item.fomcHoldProbability != null)
      ? `<span class="news-event-row__fomc-prob">Prob. hold ${Math.round(Number(item.fomcHoldProbability) * 100)}%</span>` : '';

    // ── Dividend extras ──────────────────────────────────────────
    let dividendText = '';
    if (item.eventType === 'dividend') {
      const amt = item.dividendAmount != null ? `$${Number(item.dividendAmount).toFixed(4)}/share` : null;
      const yld = item.dividendYield != null ? `${(Number(item.dividendYield) * 100).toFixed(2)}% yield` : null;
      dividendText = [amt, yld].filter(Boolean).map((v) => ` · ${v}`).join('');
    }

    const summaryText = item.summary || '';
    const middleText = `${item.title || 'Untitled event'}${summaryText ? ` · ${summaryText}` : ''}${earningsEpsText}${dividendText}`;
    const timingText = item.timeLabel || item.earningsTiming || (item.__sessionOrder < 50 ? compactPillLabel(item).toUpperCase() : 'Time TBC');
    const countdownText = computeTimeToEvent(rowDate) || '';
    const exposureLabel = resolveExposureLabel(item);
    const isPortfolioEarnings = item.eventType === 'earnings' && item.isPortfolioRelevant;
    const isMarketEarnings = item.isMarketEarnings === true && !item.isPortfolioRelevant;
    const rowPriorityClass = isPortfolioEarnings
      ? 'news-event-row--priority'
      : isMarketEarnings
        ? 'news-event-row--market'
        : (item.isHighImportance ? 'news-event-row--elevated' : 'news-event-row--standard');
    const macroClass = item.eventType === 'macro' ? 'news-event-row--macro' : '';
    const dividendClass = item.eventType === 'dividend' ? 'news-event-row--dividend' : '';
    const marketBadge = isMarketEarnings
      ? '<span class="news-event-row__badge news-event-row__badge--market">Market</span>' : '';
    const sourceLink = item.sourceUrl
      ? `<a class="news-source-link news-source-link--row" href="${item.sourceUrl}" target="_blank" rel="noopener noreferrer">↗</a>`
      : '';
    return `
      <article class="news-event-row ${accentClass(item)} ${rowPriorityClass} ${macroClass} ${dividendClass}" title="${item.badgeLabel || compactTypeLabel(item)}">
        <div class="news-event-row__type">${compactTypeLabel(item)}</div>
        <div class="news-event-row__main">
          ${ticker ? `<span class="news-card-ticker">${ticker}</span>` : ''}
          <span class="news-event-row__text">${middleText}</span>
        </div>
        <div class="news-event-row__time">${timingText}</div>
        <div class="news-event-row__meta">
          ${marketBadge}
          ${highBadge}
          ${newEstBadge}
          ${fomcProb}
          ${countdownText ? `<span class="news-event-row__countdown">${countdownText}</span>` : ''}
          ${exposureLabel ? `<span class="news-event-row__exposure">${exposureLabel}</span>` : ''}
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
    // Analyst-ratings tab shows tickers from ratings data (handled in tab content itself)
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

  // renderTab() — defined below after the new enhancement functions

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

  async function loadExposureMap() {
    if (state.exposureLoaded) return;
    try {
      const payload = await api('/api/trades?summaryMode=1&limit=200');
      const trades = Array.isArray(payload?.trades) ? payload.trades : [];
      const nextExposureByTicker = {};
      for (const trade of trades) {
        const ticker = normalizeTicker(trade?.symbol || trade?.ticker || trade?.canonicalTicker);
        if (!ticker) continue;
        const isOpen = String(trade?.status || '').toLowerCase() === 'open' || !trade?.closeDate;
        if (!isOpen) continue;
        const notional = Math.abs(Number(trade?.positionGBP));
        if (!Number.isFinite(notional) || notional <= 0) continue;
        nextExposureByTicker[ticker] = (nextExposureByTicker[ticker] || 0) + notional;
      }
      state.exposureByTicker = nextExposureByTicker;
    } catch (error) {
      console.warn('[NewsPage] exposure map load failed', error?.message || error);
      state.exposureByTicker = {};
    } finally {
      state.exposureLoaded = true;
    }
  }

  async function fetchTab(tabKey, { append = false, reset = false } = {}) {
    const tabState = state.tabData[tabKey];
    const activeSignature = filterSignature();
    if (tabState.loading) return;

    // Custom-render tabs (analyst-ratings, macro) have no backend endpoint; mark loaded and render.
    if (NEWS_TABS[tabKey]?.customRender) {
      tabState.loaded = true;
      tabState.loading = false;
      state.pageLoading = false;
      renderTab();
      return;
    }

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

  // ═══════════════════════════════════════════════════════
  //  MARKET PULSE — load + render
  // ═══════════════════════════════════════════════════════

  async function loadMarketPulse() {
    if (state.marketPulse.loaded) return;
    state.marketPulse.loading = true;
    try {
      // TODO: Replace stub — expected shape: { sp500: { price, change, changePct }, vix: { value },
      //   treasury10y: { value, direction: 'up'|'down'|'flat' }, fedFunds: { range, nextFomcDate } }
      const payload = await api('/api/news/market-pulse');
      state.marketPulse.data = payload?.data || null;
    } catch {
      // Endpoint not yet available — use visually-obvious stub values
      state.marketPulse.data = {
        _stub: true,
        sp500: { price: 5234.18, change: -12.45, changePct: -0.24 },
        vix: { value: 18.4 },
        treasury10y: { value: 4.42, direction: 'up' },
        fedFunds: { range: '4.25–4.50%', nextFomcDate: '2026-06-11' }
      };
    } finally {
      state.marketPulse.loading = false;
      state.marketPulse.loaded = true;
    }
  }

  function renderMarketPulseBar() {
    const d = state.marketPulse.data;
    if (state.marketPulse.loading && !d) {
      return '<div class="news-skeleton-wrap news-pulse-skeleton"><div class="news-skeleton" style="height:72px"></div></div>';
    }
    if (!d) return '';
    const stubBanner = d._stub
      ? '<div class="news-stub-banner">[STUB] Market Pulse data — live endpoint not yet connected. See <code>loadMarketPulse()</code> for expected shape.</div>'
      : '';
    const sp = d.sp500 || {};
    const spChangeClass = sp.changePct > 0 ? 'up' : sp.changePct < 0 ? 'down' : 'flat';
    const spSign = sp.changePct > 0 ? '+' : '';
    const vix = d.vix || {};
    const vixVal = Number(vix.value || 0);
    const vixLabel = vixVal > 25 ? 'Elevated' : vixVal >= 15 ? 'Normal' : 'Low';
    const vixClass = vixVal > 25 ? 'down' : vixVal < 15 ? 'up' : 'flat';
    const t10 = d.treasury10y || {};
    const t10Unavailable = t10.direction === 'unavailable' || t10.value == null;
    const dirArrow = t10.direction === 'up' ? '↑' : t10.direction === 'down' ? '↓' : '→';
    const dirClass = t10Unavailable ? 'flat' : (t10.direction === 'up' ? 'down' : t10.direction === 'down' ? 'up' : 'flat'); // rising yield = pressure
    const ff = d.fedFunds || {};
    const nextFomcText = ff.nextFomcDate
      ? (() => {
        const diff = computeTimeToEvent(ff.nextFomcDate + 'T14:00:00Z');
        return diff ? `Next FOMC ${diff}` : 'Next FOMC soon';
      })()
      : 'Next FOMC TBD';
    return `
      ${stubBanner}
      <section class="news-section">
        <div class="section-header">
          <h3>Market Pulse</h3>
          ${renderInfoTrigger('marketPulse', 'About Market Pulse')}
        </div>
        <div class="news-pulse-bar" aria-label="Market Pulse">
          <div class="news-pulse-card">
            <div class="news-pulse-card__label">S&amp;P 500</div>
            <div class="news-pulse-card__value">${sp.price != null ? sp.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</div>
            <div class="news-pulse-card__change news-pulse-card__change--${spChangeClass}">${spSign}${sp.changePct != null ? sp.changePct.toFixed(2) : '—'}%</div>
          </div>
          <div class="news-pulse-card">
            <div class="news-pulse-card__label">VIX</div>
            <div class="news-pulse-card__value">${vixVal ? vixVal.toFixed(1) : '—'}</div>
            <div class="news-pulse-card__change news-pulse-card__change--${vixClass}">${vixLabel}</div>
          </div>
          <div class="news-pulse-card">
            <div class="news-pulse-card__label">10Y Treasury</div>
            <div class="news-pulse-card__value ${t10Unavailable ? 'news-pulse-card__value--muted' : ''}">${t10Unavailable ? '—' : `${t10.value.toFixed(2)}%`}</div>
            <div class="news-pulse-card__change news-pulse-card__change--${dirClass}">${t10Unavailable ? 'Unavailable' : `${dirArrow} vs yesterday`}</div>
          </div>
          <div class="news-pulse-card">
            <div class="news-pulse-card__label">Fed Funds Rate</div>
            <div class="news-pulse-card__value">${ff.range || '—'}</div>
            <div class="news-pulse-card__change news-pulse-card__change--flat">${nextFomcText}</div>
          </div>
        </div>
      </section>
    `;
  }

  // ═══════════════════════════════════════════════════════
  //  SENTIMENT — load + render
  // ═══════════════════════════════════════════════════════

  async function loadSentimentData() {
    if (state.sentimentData.loaded) return;
    state.sentimentData.loading = true;
    try {
      // TODO: Replace stub — Fear & Greed expected shape: { score: number (0–100), label: string,
      //   prevWeek: number, prevMonth: number } — source: CNN Fear & Greed or equivalent API
      const fgPayload = await api('/api/news/fear-greed');
      state.sentimentData.fearGreed = fgPayload?.data || null;
    } catch {
      state.sentimentData.fearGreed = {
        _stub: true,
        score: 38,
        label: 'Fear',
        prevWeek: 44,
        prevMonth: 62
      };
    }
    try {
      // TODO: Replace stub — Portfolio sentiment expected shape: { items: [{ ticker: string, score: number }] }
      //   score is -100 (extreme negative) to +100 (extreme positive), derived from recent news sentiment
      const psPayload = await api('/api/news/portfolio-sentiment');
      state.sentimentData.portfolio = Array.isArray(psPayload?.data) ? psPayload.data : [];
    } catch {
      // Stub: derive tickers from exposure map; assign placeholder scores
      state.sentimentData.portfolio = Object.keys(state.exposureByTicker).slice(0, 8).map((ticker, i) => ({
        _stub: true,
        ticker,
        score: [42, -18, 71, -55, 28, 83, -9, 16][i % 8]
      }));
    }
    state.sentimentData.loading = false;
    state.sentimentData.loaded = true;
  }

  function renderSentimentGauge(score) {
    // Colour stop: red (0) → amber (50) → green (100)
    const pct = Math.max(0, Math.min(100, Number(score || 0)));
    const hue = Math.round(pct * 1.2); // 0→0°(red), 50→60°(amber), 100→120°(green)
    return `
      <div class="news-fg-gauge" role="img" aria-label="Fear &amp; Greed score ${pct}">
        <div class="news-fg-gauge__track">
          <div class="news-fg-gauge__fill" style="width:${pct}%;background:hsl(${hue},72%,46%)"></div>
          <div class="news-fg-gauge__marker" style="left:${pct}%"></div>
        </div>
        <div class="news-fg-gauge__ends"><span>0</span><span>100</span></div>
      </div>
    `;
  }

  function renderSentimentSection(portfolioOnly = false) {
    const sd = state.sentimentData;
    if (sd.loading && !sd.fearGreed) {
      return `
        <div class="news-sentiment-section">
          <div class="news-skeleton" style="height:140px;border-radius:12px"></div>
          <div class="news-skeleton" style="height:140px;border-radius:12px"></div>
        </div>
      `;
    }
    const fg = sd.fearGreed || {};
    const fgStub = fg._stub ? '<div class="news-stub-banner">[STUB] Fear &amp; Greed data — live endpoint not yet connected.</div>' : '';
    const fgScore = Number(fg.score || 0);
    const fgLabel = fg.label || (fgScore >= 75 ? 'Extreme Greed' : fgScore >= 55 ? 'Greed' : fgScore >= 45 ? 'Neutral' : fgScore >= 25 ? 'Fear' : 'Extreme Fear');

    let portfolio = Array.isArray(sd.portfolio) ? sd.portfolio : [];
    if (portfolioOnly) {
      const held = new Set(Object.keys(state.exposureByTicker));
      portfolio = portfolio.filter((p) => held.has(normalizeTicker(p.ticker)));
    }
    const psStub = portfolio.some((p) => p._stub) ? '<div class="news-stub-banner">[STUB] Portfolio sentiment — live scoring not yet connected.</div>' : '';

    const psRows = portfolio.length ? portfolio.map((p) => {
      const s = Number(p.score || 0);
      const pct = ((s + 100) / 2); // map -100..+100 → 0..100%
      const colorClass = s > 15 ? 'positive' : s < -15 ? 'negative' : 'neutral';
      return `
        <div class="news-ps-row">
          <span class="news-ps-row__ticker">${p.ticker}</span>
          <div class="news-ps-bar">
            <div class="news-ps-bar__fill news-ps-bar__fill--${colorClass}" style="width:${pct.toFixed(1)}%"></div>
          </div>
          <span class="news-ps-row__score news-ps-row__score--${colorClass}">${s > 0 ? '+' : ''}${s}</span>
        </div>
      `;
    }).join('') : '<p class="news-empty-micro">No held positions to score.</p>';

    return `
      <div class="news-sentiment-section">
        <div class="news-sentiment-card">
          <div class="news-sentiment-card__header">
            <h4>Fear &amp; Greed Index</h4>
            ${renderInfoTrigger('fearGreed', 'About Fear & Greed Index')}
          </div>
          ${fgStub}
          ${renderSentimentGauge(fgScore)}
          <div class="news-fg-score-row">
            <span class="news-fg-score">${fgScore}</span>
            <span class="news-fg-label">${fgLabel}</span>
          </div>
          <div class="news-fg-history">
            <span>Last week: <strong>${fg.prevWeek ?? '—'}</strong></span>
            <span>Last month: <strong>${fg.prevMonth ?? '—'}</strong></span>
          </div>
        </div>
        <div class="news-sentiment-card">
          <div class="news-sentiment-card__header">
            <h4>Portfolio Sentiment</h4>
            ${renderInfoTrigger('portfolioSentiment', 'About Portfolio Sentiment')}
          </div>
          ${psStub}
          <div class="news-ps-list">${psRows}</div>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════
  //  NEWS FEED — render from section items
  // ═══════════════════════════════════════════════════════

  function newsSentimentDot(item = {}) {
    // Sentiment classification from backend field, or derive from tone/badge
    const tone = String(item.sentimentClass || item.badgeTone || '').toLowerCase();
    if (tone === 'positive' || tone === 'highlight' || tone === 'bullish') return 'positive';
    if (tone === 'negative' || tone === 'critical' || tone === 'bearish') return 'negative';
    return 'neutral';
  }

  function newsTimeAgo(dateValue) {
    const parsed = dateValue ? new Date(dateValue) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return '';
    const diffMs = Date.now() - parsed.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function renderNewsFeedItem(item = {}) {
    const dotClass = newsSentimentDot(item);
    const ticker = item.canonicalTicker || item.ticker;
    const tagLabel = ticker || 'MACRO';
    const source = item.sourceName || item.sourceType || 'Unknown';
    const timeAgo = newsTimeAgo(item.publishedAt || item.scheduledAt);
    const signalNote = item.signalNote || item.signalLabel || '';
    return `
      <div class="news-feed-item">
        <div class="news-feed-item__dot news-feed-item__dot--${dotClass}" aria-hidden="true"></div>
        <div class="news-feed-item__body">
          <div class="news-feed-item__source">${source}${timeAgo ? ` · ${timeAgo}` : ''}</div>
          <div class="news-feed-item__headline">${item.title || 'Untitled'}</div>
          <div class="news-feed-item__meta">
            <span class="news-feed-item__tag">${tagLabel}</span>
            ${signalNote ? `<span class="news-feed-item__signal">${signalNote}</span>` : ''}
            ${item.sourceUrl ? `<a class="news-source-link news-feed-item__link" href="${item.sourceUrl}" target="_blank" rel="noopener noreferrer">↗</a>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function renderNewsFeed(items = [], portfolioOnly = false) {
    if (!items.length) return '';
    let filtered = items;
    if (portfolioOnly) {
      const held = new Set(Object.keys(state.exposureByTicker));
      // Keep items that match a held ticker, or have no ticker (macro headlines)
      filtered = items.filter((it) => {
        const t = normalizeTicker(it.canonicalTicker || it.ticker);
        return !t || held.has(t);
      });
    }
    // Rank: (a) portfolio-relevant first, (b) recency (publishedAt desc), (c) importance score desc
    const ranked = [...filtered].sort((a, b) => {
      const aPort = a.isPortfolioRelevant ? 1 : 0;
      const bPort = b.isPortfolioRelevant ? 1 : 0;
      if (bPort !== aPort) return bPort - aPort;
      const aTs = new Date(a.publishedAt || a.scheduledAt || 0).getTime();
      const bTs = new Date(b.publishedAt || b.scheduledAt || 0).getTime();
      if (bTs !== aTs) return bTs - aTs;
      return Number(b.importance || 0) - Number(a.importance || 0);
    });
    const PAGE = 10;
    const offset = state.newsFeedOffset;
    const visible = ranked.slice(0, offset + PAGE);
    const hasMore = ranked.length > visible.length;
    return `
      <section class="news-section">
        <div class="section-header">
          <h3>News Feed</h3>
          <span class="pill">${ranked.length}</span>
        </div>
        <div class="news-feed-list" id="news-feed-list">
          ${visible.map(renderNewsFeedItem).join('')}
        </div>
        <div class="news-load-more-wrap">
          ${hasMore ? `<button id="news-feed-load-more" class="ghost" type="button" data-total="${ranked.length}">Load more</button>` : ''}
        </div>
      </section>
    `;
  }

  // ═══════════════════════════════════════════════════════
  //  ANALYST RATINGS — load + render
  // ═══════════════════════════════════════════════════════

  async function loadAnalystRatings() {
    if (state.analystRatings.loaded) return;
    state.analystRatings.loading = true;
    try {
      const payload = await api('/api/news/analyst-ratings');
      state.analystRatings.items = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.data) ? payload.data : []);
    } catch (error) {
      console.warn('[NewsPage] analyst ratings unavailable', error);
      state.analystRatings.items = [];
    }
    state.analystRatings.loading = false;
    state.analystRatings.loaded = true;
  }

  function renderAnalystRatingCard(item = {}) {
    const actionBadgeClass = {
      UPGRADE: 'upgrade',
      DOWNGRADE: 'downgrade',
      INITIATED: 'initiated',
      REITERATED: 'reiterated'
    }[item.action] || 'reiterated';
    const ptRaised = item.oldPt != null && item.newPt != null && item.newPt > item.oldPt;
    const ptLowered = item.oldPt != null && item.newPt != null && item.newPt < item.oldPt;
    const ptClass = ptRaised ? 'raised' : ptLowered ? 'lowered' : '';
    const ptText = item.oldPt != null
      ? `$${item.oldPt} → <span class="news-analyst-pt__new news-analyst-pt--${ptClass}">$${item.newPt}</span>`
      : `<span class="news-analyst-pt__new news-analyst-pt--${ptClass}">$${item.newPt ?? '—'}</span>`;
    return `
      <div class="news-analyst-card">
        <div class="news-analyst-card__top">
          <span class="news-analyst-ticker">${item.ticker || '—'}</span>
          <span class="news-analyst-badge news-analyst-badge--${actionBadgeClass}">${item.action || 'UPDATE'}</span>
        </div>
        <div class="news-analyst-firm">${item.firm || 'Unknown'} → <strong>${item.newRating || '—'}</strong></div>
        <div class="news-analyst-pt">PT: ${ptText}</div>
        <div class="news-analyst-time">${newsTimeAgo(item.timestamp)}</div>
      </div>
    `;
  }

  function renderAnalystRatingsSection(items, { preview = false, portfolioOnly = false, filterTicker = '', filterAction = '' } = {}) {
    let filtered = items;
    if (portfolioOnly) {
      const held = new Set(Object.keys(state.exposureByTicker));
      filtered = filtered.filter((it) => held.has(normalizeTicker(it.ticker)));
    }
    if (filterTicker) {
      filtered = filtered.filter((it) => normalizeTicker(it.ticker) === normalizeTicker(filterTicker));
    }
    if (filterAction) {
      filtered = filtered.filter((it) => String(it.action || '').toUpperCase() === filterAction.toUpperCase());
    }
    const visible = preview ? filtered.slice(0, 4) : filtered;
    if (!visible.length) {
      return `
        <section class="news-section">
          <div class="section-header">
            <h3>${preview ? 'Recent Analyst Ratings' : 'Analyst Ratings'}</h3>
            ${renderInfoTrigger('analystRatings', 'About Recent Analyst Ratings')}
          </div>
          <div class="news-empty-state"><p>No recent rating changes for your holdings.</p></div>
        </section>
      `;
    }
    const seeAllLink = preview && filtered.length > 4
      ? `<a class="news-analyst-see-all ghost" href="/news.html?tab=analyst-ratings">See all ${filtered.length} ratings ↗</a>`
      : '';
    return `
      <section class="news-section">
        <div class="section-header">
          <h3>${preview ? 'Recent Analyst Ratings' : 'Analyst Ratings'}</h3>
          ${renderInfoTrigger('analystRatings', 'About Recent Analyst Ratings')}
          <span class="pill">${filtered.length}</span>
          ${seeAllLink}
        </div>
        <div class="news-analyst-grid">
          ${visible.map(renderAnalystRatingCard).join('')}
        </div>
      </section>
    `;
  }

  // ═══════════════════════════════════════════════════════
  //  ANALYST RATINGS TAB — full view with filters
  // ═══════════════════════════════════════════════════════

  function renderAnalystRatingsTabContent() {
    const ACTION_TYPES = ['', 'UPGRADE', 'DOWNGRADE', 'INITIATED', 'REITERATED'];
    const activeAction = state.analystRatingsFilter.actionType;
    const activeTicker = state.analystRatingsFilter.ticker;

    // Unique tickers from ratings data for chip filter
    const ratingTickers = [...new Set(state.analystRatings.items.map((it) => normalizeTicker(it.ticker)).filter(Boolean))];
    const chipHtml = ratingTickers.map((t) => `
      <span class="news-ticker-chip news-analyst-ticker-chip ${activeTicker === t ? 'is-active' : ''}" data-ar-ticker="${t}">${t}</span>
    `).join('');
    const actionBtns = ACTION_TYPES.map((a) => `
      <button class="news-analyst-action-btn ${activeAction === a ? 'is-active' : ''}" type="button" data-ar-action="${a}">${a || 'All'}</button>
    `).join('');

    const portfolioOnly = state.filters.portfolioOnly;
    return `
      <div class="news-analyst-tab-filters">
        <div class="news-analyst-action-row">${actionBtns}</div>
        ${ratingTickers.length ? `<div class="news-analyst-chip-row">${chipHtml}</div>` : ''}
      </div>
      ${renderAnalystRatingsSection(state.analystRatings.items, {
        portfolioOnly,
        filterTicker: activeTicker,
        filterAction: activeAction
      })}
    `;
  }

  function bindAnalystRatingsTabEvents() {
    document.querySelectorAll('[data-ar-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.analystRatingsFilter.actionType = btn.dataset.arAction || '';
        els.panel.innerHTML = renderAnalystRatingsTabContent();
        bindAnalystRatingsTabEvents();
      });
    });
    document.querySelectorAll('[data-ar-ticker]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const t = normalizeTicker(chip.dataset.arTicker || '');
        state.analystRatingsFilter.ticker = state.analystRatingsFilter.ticker === t ? '' : t;
        els.panel.innerHTML = renderAnalystRatingsTabContent();
        bindAnalystRatingsTabEvents();
      });
    });
  }

  let infoPopoverEl = null;
  let activeInfoTrigger = null;

  function ensureInfoPopover() {
    if (infoPopoverEl) return infoPopoverEl;
    infoPopoverEl = document.createElement('div');
    infoPopoverEl.className = 'news-info-popover hidden';
    infoPopoverEl.setAttribute('role', 'tooltip');
    document.body.appendChild(infoPopoverEl);
    return infoPopoverEl;
  }

  function hideInfoPopover() {
    if (!infoPopoverEl) return;
    infoPopoverEl.classList.add('hidden');
    activeInfoTrigger = null;
  }

  function showInfoPopover(trigger) {
    const key = trigger?.dataset?.newsInfo || '';
    const text = NEWS_SECTION_INFO[key];
    if (!text) return;
    const pop = ensureInfoPopover();
    pop.textContent = text;
    pop.classList.remove('hidden');

    const rect = trigger.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const spacing = 8;
    const showAbove = rect.bottom + spacing + popRect.height > window.innerHeight - 8;
    const top = showAbove
      ? Math.max(8, rect.top - popRect.height - spacing)
      : Math.min(window.innerHeight - popRect.height - 8, rect.bottom + spacing);
    const left = Math.min(
      window.innerWidth - popRect.width - 8,
      Math.max(8, rect.left + (rect.width / 2) - (popRect.width / 2))
    );
    pop.style.top = `${top + window.scrollY}px`;
    pop.style.left = `${left + window.scrollX}px`;
    activeInfoTrigger = trigger;
  }

  let infoPopoverGlobalBound = false;
  function bindInfoPopovers() {
    document.querySelectorAll('[data-news-info]').forEach((trigger) => {
      if (trigger.dataset.newsInfoBound === '1') return;
      trigger.dataset.newsInfoBound = '1';
      trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        if (activeInfoTrigger === trigger) {
          hideInfoPopover();
          return;
        }
        showInfoPopover(trigger);
      });
      trigger.addEventListener('mouseenter', () => showInfoPopover(trigger));
      trigger.addEventListener('focus', () => showInfoPopover(trigger));
      trigger.addEventListener('mouseleave', () => {
        if (activeInfoTrigger !== trigger) return;
        hideInfoPopover();
      });
      trigger.addEventListener('blur', () => {
        if (activeInfoTrigger !== trigger) return;
        hideInfoPopover();
      });
    });

    if (infoPopoverGlobalBound) return;
    infoPopoverGlobalBound = true;
    document.addEventListener('click', (event) => {
      if (!activeInfoTrigger || !infoPopoverEl) return;
      if (event.target.closest('[data-news-info]') || event.target.closest('.news-info-popover')) return;
      hideInfoPopover();
    });
    window.addEventListener('resize', () => {
      if (activeInfoTrigger) showInfoPopover(activeInfoTrigger);
    });
    window.addEventListener('scroll', () => {
      if (activeInfoTrigger) showInfoPopover(activeInfoTrigger);
    }, { passive: true });
  }

  // ═══════════════════════════════════════════════════════
  //  MACRO TAB — FOMC events + yield metrics + macro headlines
  // ═══════════════════════════════════════════════════════

  function renderMacroTabContent(model = {}) {
    const d = state.marketPulse.data;
    const ff = d?.fedFunds || {};
    const t10 = d?.treasury10y || {};
    const hasMetrics = d != null;
    const stubBanner = d?._stub
      ? '<div class="news-stub-banner">[STUB] Macro metrics — live endpoint not yet connected.</div>'
      : '';

    const metricsHtml = hasMetrics ? `
      <section class="news-section">
        <div class="section-header"><h3>Macro Metrics</h3></div>
        ${stubBanner}
        <div class="news-macro-metrics">
          <div class="news-pulse-card">
            <div class="news-pulse-card__label">Fed Funds Rate</div>
            <div class="news-pulse-card__value">${ff.range || '—'}</div>
            <div class="news-pulse-card__change news-pulse-card__change--flat">${ff.nextFomcDate ? `Next FOMC ${computeTimeToEvent(ff.nextFomcDate + 'T14:00:00Z') || ''}` : 'Date TBD'}</div>
          </div>
          <div class="news-pulse-card">
            <div class="news-pulse-card__label">10Y Treasury Yield</div>
            <div class="news-pulse-card__value">${t10.value != null ? t10.value.toFixed(2) : '—'}%</div>
            <div class="news-pulse-card__change news-pulse-card__change--${t10.direction === 'up' ? 'down' : t10.direction === 'down' ? 'up' : 'flat'}">${t10.direction === 'up' ? '↑' : t10.direction === 'down' ? '↓' : '→'} vs yesterday</div>
          </div>
          <div class="news-pulse-card">
            <div class="news-pulse-card__label">VIX</div>
            <div class="news-pulse-card__value">${d.vix?.value != null ? Number(d.vix.value).toFixed(1) : '—'}</div>
            <div class="news-pulse-card__change news-pulse-card__change--${Number(d.vix?.value || 0) > 25 ? 'down' : Number(d.vix?.value || 0) < 15 ? 'up' : 'flat'}">${Number(d.vix?.value || 0) > 25 ? 'Elevated' : Number(d.vix?.value || 0) < 15 ? 'Low' : 'Normal'}</div>
          </div>
        </div>
      </section>
    ` : '';

    // Pull FOMC + macro events from the for-you model cache if available
    const forYouModel = state.tabData['for-you']?.model || {};
    const allSections = Array.isArray(forYouModel.sections) ? forYouModel.sections : [];
    const macroSection = allSections.find((s) => s?.summary?.key === 'macroUpcoming');
    const macroItems = macroSection ? macroSection.items || [] : [];
    const fomcItems = macroItems.filter((it) => it.eventType === 'macro');
    const macroEventsHtml = fomcItems.length ? `
      <section class="news-section">
        <div class="section-header"><h3>FOMC &amp; Macro Events</h3><span class="pill">${fomcItems.length}</span></div>
        <div class="news-row-list">${fomcItems.map(renderCompactEventRow).join('')}</div>
      </section>
    ` : '';

    // Macro headlines from for-you model
    const headlineSection = allSections.find((s) => s?.summary?.key === 'recentRelevantHeadlines');
    const macroHeadlines = (headlineSection?.items || []).filter((it) =>
      it.eventType === 'macro' || it.eventType === 'world_news'
    );
    const macroHeadlinesHtml = macroHeadlines.length ? `
      <section class="news-section">
        <div class="section-header"><h3>Macro Headlines</h3><span class="pill">${macroHeadlines.length}</span></div>
        <div class="news-feed-list">${macroHeadlines.map(renderNewsFeedItem).join('')}</div>
      </section>
    ` : '';

    if (!hasMetrics && !fomcItems.length && !macroHeadlines.length) {
      return `<div class="news-empty-state"><p>Load the For You tab first to populate macro events, or connect the macro endpoint.</p></div>`;
    }
    return `${metricsHtml}${macroEventsHtml}${macroHeadlinesHtml}`;
  }

  // ═══════════════════════════════════════════════════════
  //  renderTab — handles new tabs + For You extras
  // ═══════════════════════════════════════════════════════

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

    // ── Custom-render tabs ────────────────────────────────
    if (state.activeTab === 'analyst-ratings') {
      renderFilterTickerChips({});
      els.panel.innerHTML = renderAnalystRatingsTabContent();
      bindAnalystRatingsTabEvents();
      return;
    }
    if (state.activeTab === 'macro') {
      renderFilterTickerChips({});
      els.panel.innerHTML = renderMacroTabContent();
      return;
    }

    // ── Standard tabs (for-you / calendar / news) ─────────
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
    if (!totalRenderedItems && state.activeTab !== 'for-you') {
      log('empty-state', { tab: state.activeTab, reason: 'no-items' });
      return renderEmpty('No events to show', 'Try relaxing filters or check back soon.');
    }

    const portfolioContext = model?.portfolioContext || {};
    const portfolioOnly = state.filters.portfolioOnly;

    // Collect news-feed items from relevant sections (rendered separately on For You)
    const newsFeedSectionKeys = new Set(['recentRelevantHeadlines', 'recentlyUpdatedRelevant']);
    const newsFeedItems = state.activeTab === 'for-you'
      ? sections
        .filter((s) => newsFeedSectionKeys.has(s?.summary?.key))
        .flatMap((s) => getSectionItems(s))
      : [];

    const sectionsHtml = sections.map((section) => {
      const sectionKey = section.summary?.key || '';
      const items = getSectionItems(section);

      // On For You tab, news sections are rendered as the dedicated news feed below — skip here
      if (state.activeTab === 'for-you' && newsFeedSectionKeys.has(sectionKey)) return '';

      if (sectionKey === 'upcomingEvents' && !items.length) {
        return `
          <section class="news-section">
            <div class="section-header">
              <h3>${section.summary?.title || 'Upcoming Events'}</h3>
              ${renderInfoTrigger('upcomingEvents', 'About Upcoming Events')}
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
              ${renderInfoTrigger('upcomingEvents', 'About Upcoming Events')}
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

    // ── For You extras ─────────────────────────────────────
    const forYouTopHtml = state.activeTab === 'for-you'
      ? `${renderMarketPulseBar()}${renderSentimentSection(portfolioOnly)}`
      : '';
    const forYouBottomHtml = state.activeTab === 'for-you'
      ? `${renderNewsFeed(newsFeedItems, portfolioOnly)}
         ${renderAnalystRatingsSection(state.analystRatings.items, { preview: true, portfolioOnly })}`
      : '';

    els.panel.innerHTML = `
      ${forYouTopHtml}
      ${sectionsHtml}
      ${forYouBottomHtml}
      <div class="news-load-more-wrap">
        ${hasMore ? '<button id="news-load-more-btn" class="ghost" type="button">Load more</button>' : ''}
      </div>
    `;

    document.getElementById('news-load-more-btn')?.addEventListener('click', () => fetchTab(state.activeTab, { append: true }));

    // "Load more" for news feed
    document.getElementById('news-feed-load-more')?.addEventListener('click', () => {
      state.newsFeedOffset += 10;
      renderTab();
    });
    bindInfoPopovers();
  }

  async function init() {
    const restoredTab = resolveInitialTab(window.location.search);
    log('tab-restored', restoredTab);
    log('page-load-start', { tab: state.activeTab });
    bindEvents();
    renderLoading();
    await Promise.all([
      loadPreferences(),
      loadExposureMap(),
      fetchTab(state.activeTab),
      loadInAppNotifications()
    ]);
    // Load enhancement data in parallel after primary data is ready (exposure map populated)
    await Promise.all([loadMarketPulse(), loadSentimentData(), loadAnalystRatings()]);
    renderTab();
    log('page-load-end', { tab: state.activeTab });
  }

  init();
}
