const NEWS_TABS = {
  'for-you': { key: 'for-you', label: 'For You', endpoint: '/api/news/for-you', sectionOrder: ['portfolioUpcomingEarnings', 'macroUpcoming', 'recentlyUpdatedRelevant'] },
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

if (typeof module !== 'undefined') {
  module.exports = { normalizeTab, resolveInitialTab, mergeUniqueById, buildSectionList };
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
    prefsModal: document.getElementById('news-preferences-modal'),
    prefsGrid: document.getElementById('news-preferences-grid'),
    prefsStatus: document.getElementById('news-preferences-status'),
    prefsClose: document.getElementById('close-news-preferences-btn'),
    prefsCancel: document.getElementById('cancel-news-preferences-btn'),
    prefsSave: document.getElementById('save-news-preferences-btn'),
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

  function renderCard(item = {}) {
    const marker = [
      item.isPortfolioRelevant ? '<span class="pill">Portfolio</span>' : '',
      item.isHighImportance ? '<span class="pill warning">High impact</span>' : ''
    ].join('');
    const ticker = item.canonicalTicker || item.ticker;
    const sourceLink = item.sourceUrl
      ? `<a class="news-source-link" href="${item.sourceUrl}" target="_blank" rel="noopener noreferrer">Source</a>`
      : '<span class="news-source-link muted">No source link</span>';
    return `
      <article class="news-card relevance-${item.relevanceClass || 'neutral'} urgency-${item.urgencyClass || 'none'}">
        <div class="news-card-topline">
          <span class="news-card-badge ${toneClass(item.badgeTone)}">${item.badgeLabel || 'Update'}</span>
          <span class="news-card-time">${item.timeLabel || 'No time set'}</span>
        </div>
        <h4>${item.title || 'Untitled event'}</h4>
        <p class="news-card-summary">${item.summary || 'No summary available.'}</p>
        <div class="news-card-meta">
          <span>${item.sourceName || item.sourceType || 'Unknown source'}</span>
          ${ticker ? `<span class="news-card-ticker">${ticker}</span>` : ''}
          ${marker}
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
    const sections = buildSectionList(state.activeTab, model);

    if (state.activeTab === 'news' && !tabState.items.length) {
      log('empty-state', { tab: state.activeTab, reason: 'latest-empty' });
      return renderEmpty('No headline ingestion yet', model?.emptyState?.message || 'Latest headlines are intentionally empty right now.');
    }
    if (!tabState.items.length) {
      log('empty-state', { tab: state.activeTab, reason: 'no-items' });
      return renderEmpty('No events to show', 'Try relaxing filters or check back soon.');
    }

    const sectionsHtml = sections.map((section) => {
      const items = Array.isArray(section.items) ? section.items : [];
      if (!items.length) return '';
      return `
        <section class="news-section">
          <div class="section-header">
            <h3>${section.summary?.title || 'Section'}</h3>
            <span class="pill">${section.summary?.count || items.length}</span>
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
    if (!els.notificationList || !els.notificationUnread) return;
    const items = Array.isArray(state.notificationCenter.items) ? state.notificationCenter.items : [];
    els.notificationUnread.textContent = String(state.notificationCenter.unreadCount || 0);
    if (!items.length) {
      els.notificationList.innerHTML = '<p class="helper">No delivered in-app news notifications yet.</p>';
      return;
    }
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
      return;
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
