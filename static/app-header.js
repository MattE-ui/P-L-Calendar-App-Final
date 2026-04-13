(function initGlobalHeader() {
  if (document.getElementById('global-app-header')) return;

  const path = window.location.pathname || '/';
  const isDashboardRoute = path === '/' || path.endsWith('/index.html');
  const activeKey = (() => {
    if (path.endsWith('/analytics.html')) return 'analytics';
    if (path.endsWith('/trades.html')) return 'trades';
    if (path.endsWith('/transactions.html')) return 'portfolio';
    if (path.endsWith('/social.html') || path === '/social' || path.startsWith('/social/')) return 'social';
    if (path.endsWith('/watchlists.html') || path === '/watchlists' || path.startsWith('/watchlists/')) return 'watchlists';
    if (path.endsWith('/review.html') || path === '/review' || path.startsWith('/review/')) return 'review';
    if (path.endsWith('/profile.html') || path.startsWith('/profile/')) return 'profile';
    if (isDashboardRoute) return 'dashboard';
    return '';
  })();

  const navItems = [
    { key: 'dashboard', label: 'Dashboard', href: '/' },
    { key: 'trades', label: 'Trades', href: '/trades.html' },
    { key: 'analytics', label: 'Analytics', href: '/analytics.html' },
    { key: 'portfolio', label: 'Transactions', href: '/transactions.html' },
    { key: 'watchlists', label: 'Watchlists', href: '/watchlists' },
    { key: 'social', label: 'Social', href: '/social' },
    { key: 'review', label: 'Review', href: '/review' },
    { key: 'profile', label: 'Profile', href: '/profile.html' }
  ];

  const header = document.createElement('header');
  header.id = 'global-app-header';
  header.className = 'app-shell-header';

  header.innerHTML = `
    <div class="app-shell-header__inner">
      <a class="app-shell-brand" href="/" aria-label="Veracity dashboard home">
        <img class="app-shell-brand__logo" src="/static/veracity-logo.png" alt="Veracity Trading Suite">
      </a>
      <button id="app-shell-menu-toggle" class="ghost app-shell-menu-toggle" type="button" aria-expanded="false" aria-controls="app-shell-mobile-panel">
        Menu
      </button>
      <div id="app-shell-mobile-panel" class="app-shell-mobile-panel">
        <nav class="app-shell-nav" aria-label="Primary">
          ${navItems.map((item) => {
            const labelHtml = item.key === 'social'
              ? `${item.label}<span id="social-nav-pending-badge" class="social-nav-pending-badge hidden" aria-live="polite" aria-label="Pending incoming friend requests"></span>`
              : item.label;
            return `<a id="${item.key}-btn" class="app-shell-nav__link ${activeKey === item.key ? 'is-active' : ''}" href="${item.href}">${labelHtml}</a>`;
          }).join('')}
        </nav>
      </div>
      <div class="app-shell-account">
        <button
          id="app-shell-account-toggle"
          class="ghost app-shell-account-toggle"
          type="button"
          aria-haspopup="menu"
          aria-expanded="false"
          aria-controls="app-shell-account-menu"
        >
          Account
        </button>
        <div id="app-shell-account-menu" class="app-shell-account-menu" role="menu" aria-label="Account menu">
          <button id="quick-settings-btn" class="ghost app-shell-account-item" type="button" role="menuitem">Settings</button>
          <div id="app-shell-owner-tools" class="app-shell-account-owner is-hidden">
            <p class="app-shell-account-owner__label">Admin tools</p>
            <a
              id="site-announcements-admin-btn"
              class="ghost app-shell-account-item"
              href="/site-announcements-admin.html"
              role="menuitem"
            >
              Site announcements
            </a>
            <button id="devtools-btn" class="ghost app-shell-account-item" type="button" role="menuitem">Devtools</button>
          </div>
          <button id="logout-btn" class="ghost app-shell-account-item app-shell-account-item--logout" type="button" role="menuitem">Logout</button>
        </div>
      </div>
    </div>
  `;

  document.body.prepend(header);
  document.body.classList.add('with-app-shell-header');

  const menuToggle = document.getElementById('app-shell-menu-toggle');
  const menuPanel = document.getElementById('app-shell-mobile-panel');
  const accountToggle = document.getElementById('app-shell-account-toggle');
  const accountMenu = document.getElementById('app-shell-account-menu');

  function closeMobileMenu() {
    if (!menuToggle || !menuPanel) return;
    menuToggle.setAttribute('aria-expanded', 'false');
    menuPanel.classList.remove('is-open');
    document.body.classList.remove('app-shell-mobile-menu-open');
  }

  if (menuToggle && menuPanel) {
    menuToggle.addEventListener('click', () => {
      const willOpen = menuToggle.getAttribute('aria-expanded') !== 'true';
      menuToggle.setAttribute('aria-expanded', String(willOpen));
      menuPanel.classList.toggle('is-open', willOpen);
      document.body.classList.toggle('app-shell-mobile-menu-open', willOpen);
    });

    menuPanel.addEventListener('click', (event) => {
      if (event.target.closest('a,button')) closeMobileMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 760) closeMobileMenu();
    });
  }

  function closeAccountMenu() {
    if (!accountToggle || !accountMenu) return;
    accountToggle.setAttribute('aria-expanded', 'false');
    accountMenu.classList.remove('is-open');
  }

  if (accountToggle && accountMenu) {
    accountToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = accountToggle.getAttribute('aria-expanded') !== 'true';
      accountToggle.setAttribute('aria-expanded', String(willOpen));
      accountMenu.classList.toggle('is-open', willOpen);
    });

    document.addEventListener('click', (event) => {
      if (!accountMenu.contains(event.target) && !accountToggle.contains(event.target)) {
        closeAccountMenu();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeAccountMenu();
    });

    accountMenu.addEventListener('click', (event) => {
      if (event.target.closest('a,button')) closeAccountMenu();
    });
  }
})();


(function initAppBootstrapStore() {
  if (window.AppBootstrap?.getProfile) return;

  const PROFILE_CACHE_TTL_MS = 15000;
  const PROFILE_SESSION_CACHE_KEY = 'appBootstrap:profileCache:v2';
  const profileState = {
    recordsByUrl: new Map(),
    listeners: new Set(),
    inFlightByUrl: new Map()
  };

  function notifyProfile(payload) {
    profileState.listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (_error) {
        // noop
      }
    });
  }

  function readSessionCache() {
    try {
      const raw = window.sessionStorage?.getItem(PROFILE_SESSION_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function writeSessionCache(url, value, fetchedAt) {
    try {
      const cache = readSessionCache() || {};
      cache[url] = { value, fetchedAt };
      window.sessionStorage?.setItem(PROFILE_SESSION_CACHE_KEY, JSON.stringify(cache));
    } catch (_error) {
      // noop
    }
  }

  function getFreshRecord(url) {
    const inMemory = profileState.recordsByUrl.get(url);
    if (inMemory?.value && (Date.now() - inMemory.fetchedAt) <= PROFILE_CACHE_TTL_MS) {
      return { ...inMemory, source: 'memory' };
    }
    const persisted = readSessionCache()?.[url];
    if (persisted?.value && (Date.now() - Number(persisted.fetchedAt || 0)) <= PROFILE_CACHE_TTL_MS) {
      const restored = { value: persisted.value, fetchedAt: Number(persisted.fetchedAt || Date.now()) };
      profileState.recordsByUrl.set(url, restored);
      return { ...restored, source: 'session' };
    }
    return null;
  }

  function buildProfileUrl({ refreshIntegrations = false, detail = 'shell' } = {}) {
    if (detail === 'full') {
      return refreshIntegrations ? '/api/profile?refreshIntegrations=true' : '/api/profile';
    }
    return '/api/profile/bootstrap';
  }

  async function fetchProfile(url) {
    const fetchPromise = fetch(url, { credentials: 'include' });
    const response = window.PerfDiagnostics
      ? await window.PerfDiagnostics.trackApi(`app-bootstrap-api:GET:${url}`, fetchPromise)
      : await fetchPromise;
    if (!response.ok) {
      throw new Error('Request failed');
    }
    return response.json();
  }

  async function getProfile(options = {}) {
    const {
      forceRefresh = false,
      refreshIntegrations = false,
      consumer = 'unknown',
      detail = 'shell'
    } = options;
    const url = buildProfileUrl({ refreshIntegrations, detail });

    if (!forceRefresh && !refreshIntegrations) {
      const fresh = getFreshRecord(url);
      if (fresh?.value) {
        window.PerfDiagnostics?.log('bootstrap-profile-cache-hit', {
          consumer,
          url,
          cacheSource: fresh.source,
          shellBootstrapUsed: detail !== 'full',
          sharedSummaryReused: true
        });
        return fresh.value;
      }
    }

    if (profileState.inFlightByUrl.has(url)) {
      window.PerfDiagnostics?.log('bootstrap-profile-coalesced', { consumer, url });
      return profileState.inFlightByUrl.get(url);
    }

    const requestPromise = fetchProfile(url)
      .then((profile) => {
        const normalized = profile || null;
        if (!refreshIntegrations && normalized) {
          const fetchedAt = Date.now();
          profileState.recordsByUrl.set(url, { value: normalized, fetchedAt });
          writeSessionCache(url, normalized, fetchedAt);
          notifyProfile(normalized);
        }
        window.PerfDiagnostics?.log('bootstrap-profile-response', {
          consumer,
          url,
          shellBootstrapUsed: detail !== 'full',
          profileDetailDeferred: detail !== 'full',
          payloadTrimmed: detail !== 'full'
        });
        return normalized;
      })
      .finally(() => {
        profileState.inFlightByUrl.delete(url);
      });

    profileState.inFlightByUrl.set(url, requestPromise);
    window.PerfDiagnostics?.log('bootstrap-profile-request', {
      consumer,
      url,
      forceRefresh: !!forceRefresh,
      shellBootstrapUsed: detail !== 'full'
    });
    return requestPromise;
  }

  window.AppBootstrap = {
    ...(window.AppBootstrap || {}),
    getProfile,
    peekProfile: (options = {}) => {
      const url = buildProfileUrl({ detail: options.detail === 'full' ? 'full' : 'shell' });
      return profileState.recordsByUrl.get(url)?.value || null;
    },
    subscribeProfile: (listener) => {
      if (typeof listener !== 'function') return () => {};
      profileState.listeners.add(listener);
      return () => profileState.listeners.delete(listener);
    }
  };
})();

(function initRefreshCoordinator() {
  if (window.AppRefreshCoordinator?.createChannel) return;

  function createChannel(channelName) {
    const state = {
      inFlight: null,
      queued: false,
      queuedReason: '',
      lastRunAt: 0,
      lastSuccessAt: 0,
      lastResult: null
    };

    async function run(task, options = {}) {
      const {
        reason = 'manual',
        minIntervalMs = 0,
        reuseResultMs = 0,
        allowWhenHidden = false,
        force = false
      } = options;

      const now = Date.now();
      if (!allowWhenHidden && document.visibilityState === 'hidden') {
        window.PerfDiagnostics?.log('refresh-hidden-poll-suppressed', { channel: channelName, reason });
        return state.lastResult;
      }

      if (!force && reuseResultMs > 0 && state.lastResult && (now - state.lastSuccessAt) < reuseResultMs) {
        window.PerfDiagnostics?.log('refresh-recent-data-reused', { channel: channelName, reason, ageMs: now - state.lastSuccessAt });
        return state.lastResult;
      }

      if (!force && minIntervalMs > 0 && (now - state.lastRunAt) < minIntervalMs) {
        window.PerfDiagnostics?.log('refresh-skipped-cooldown', { channel: channelName, reason, ageMs: now - state.lastRunAt, minIntervalMs });
        return state.lastResult;
      }

      if (state.inFlight) {
        state.queued = true;
        state.queuedReason = reason;
        window.PerfDiagnostics?.log('refresh-coalesced-inflight', { channel: channelName, reason });
        return state.inFlight;
      }

      state.lastRunAt = now;
      state.inFlight = Promise.resolve()
        .then(task)
        .then((result) => {
          state.lastResult = result;
          state.lastSuccessAt = Date.now();
          return result;
        })
        .finally(() => {
          state.inFlight = null;
          if (!state.queued) return;
          const queuedReason = state.queuedReason || 'queued';
          state.queued = false;
          state.queuedReason = '';
          window.setTimeout(() => {
            run(task, { ...options, reason: `${queuedReason}:coalesced` }).catch(() => {});
          }, 0);
        });

      window.PerfDiagnostics?.log('refresh-start', { channel: channelName, reason });
      return state.inFlight;
    }

    return {
      run,
      getLastSuccessAt: () => state.lastSuccessAt
    };
  }

  window.AppRefreshCoordinator = { createChannel };
})();

(function initOwnerActions() {
  const adminBtn = document.getElementById('site-announcements-admin-btn');
  const devtoolsBtn = document.getElementById('devtools-btn');
  const ownerGroup = document.getElementById('app-shell-owner-tools');
  if (!adminBtn || !devtoolsBtn || !ownerGroup) return;

  let lastOwnerVisibility = null;
  const setOwnerVisibility = (showOwnerTools) => {
    if (lastOwnerVisibility === showOwnerTools) return;
    lastOwnerVisibility = showOwnerTools;
    adminBtn.classList.toggle('is-hidden', !showOwnerTools);
    devtoolsBtn.classList.toggle('is-hidden', !showOwnerTools);
    ownerGroup.classList.toggle('is-hidden', !showOwnerTools);
  };

  const startedAt = window.PerfDiagnostics?.mark('app-header-profile-bootstrap-start');
  window.AppBootstrap.getProfile({ consumer: 'app-header-owner-tools' })
    .then((profile) => {
      if (startedAt) window.PerfDiagnostics?.measure('app-header-profile-bootstrap-end', startedAt, { owner: !!profile?.isOwner });
      setOwnerVisibility(!!profile?.isOwner);
    })
    .catch(() => {
      setOwnerVisibility(false);
    });
})();

(function initFriendRequestAlertPolling() {
  const SOCIAL_SYNC_EVENT = 'social:state-changed';
  const SOCIAL_REFRESH_EVENT = 'social:refresh-requested';

  function isGuestSession() {
    return (sessionStorage.getItem('guestMode') === 'true' || localStorage.getItem('guestMode') === 'true')
      && typeof window.handleGuestRequest === 'function';
  }

  function createSocialRequestSync() {
    const refreshChannel = window.AppRefreshCoordinator?.createChannel('social-request-sync');
    const state = {
      pollTimer: null,
      pollingStarted: false,
      refreshInFlight: null,
      listenersBound: false,
      data: {
        friends: [],
        incomingRequests: [],
        outgoingRequests: [],
        acceptedOutgoingRequests: [],
        nicknameRequired: false,
        authenticated: false,
        lastRefreshAt: 0,
        error: ''
      }
    };

    async function api(path, opts = {}) {
      const res = await fetch(path, { credentials: 'include', ...opts });
      if (res.status === 401) return null;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    }

    function normalizeRequests(list) {
      if (!Array.isArray(list)) return [];
      return list.filter(item => item && item.status === 'pending');
    }

    function emitChange(reason) {
      window.dispatchEvent(new CustomEvent(SOCIAL_SYNC_EVENT, {
        detail: {
          reason,
          state: { ...state.data }
        }
      }));
    }

    async function refresh(reason = 'manual') {
      if (isGuestSession()) return { ...state.data };
      if (refreshChannel) {
        return refreshChannel.run(async () => {
          try {
            const me = await api('/api/social/me');
            if (!me) {
              state.data = {
                friends: [],
                incomingRequests: [],
                outgoingRequests: [],
                acceptedOutgoingRequests: [],
                nicknameRequired: false,
                authenticated: false,
                lastRefreshAt: Date.now(),
                error: ''
              };
              emitChange('unauthenticated');
              return { ...state.data };
            }

            const nicknameRequired = !!me.nickname_required;
            if (nicknameRequired) {
              state.data = {
                friends: [],
                incomingRequests: [],
                outgoingRequests: [],
                acceptedOutgoingRequests: [],
                nicknameRequired: true,
                authenticated: true,
                lastRefreshAt: Date.now(),
                error: ''
              };
              emitChange(reason);
              return { ...state.data };
            }

            const [friendsResponse, requestsResponse] = await Promise.all([
              api('/api/social/friends'),
              api('/api/social/friends/requests')
            ]);

            state.data = {
              friends: Array.isArray(friendsResponse?.friends) ? friendsResponse.friends : [],
              incomingRequests: normalizeRequests(requestsResponse?.incoming),
              outgoingRequests: normalizeRequests(requestsResponse?.outgoing),
              acceptedOutgoingRequests: Array.isArray(requestsResponse?.acceptedOutgoing) ? requestsResponse.acceptedOutgoing : [],
              nicknameRequired: false,
              authenticated: true,
              lastRefreshAt: Date.now(),
              error: ''
            };
            emitChange(reason);
          } catch (error) {
            state.data = {
              ...state.data,
              error: error?.message || 'Unable to refresh social request state.',
              lastRefreshAt: Date.now()
            };
            console.warn('[social-sync] refresh failed; polling will continue', error);
            emitChange('error');
          }
          return { ...state.data };
        }, {
          reason,
          minIntervalMs: reason === 'poll' ? 12000 : 0,
          allowWhenHidden: reason !== 'poll',
          reuseResultMs: reason === 'tab-visible' ? 2000 : 0
        });
      }
      if (state.refreshInFlight) return state.refreshInFlight;
      state.refreshInFlight = (async () => {
        try {
          const me = await api('/api/social/me');
          if (!me) {
            state.data = {
              friends: [],
              incomingRequests: [],
              outgoingRequests: [],
              acceptedOutgoingRequests: [],
              nicknameRequired: false,
              authenticated: false,
              lastRefreshAt: Date.now(),
              error: ''
            };
            emitChange('unauthenticated');
            return { ...state.data };
          }

          const nicknameRequired = !!me.nickname_required;
          if (nicknameRequired) {
            state.data = {
              friends: [],
              incomingRequests: [],
              outgoingRequests: [],
              acceptedOutgoingRequests: [],
              nicknameRequired: true,
              authenticated: true,
              lastRefreshAt: Date.now(),
              error: ''
            };
            emitChange(reason);
            return { ...state.data };
          }

          const [friendsResponse, requestsResponse] = await Promise.all([
            api('/api/social/friends'),
            api('/api/social/friends/requests')
          ]);

          state.data = {
            friends: Array.isArray(friendsResponse?.friends) ? friendsResponse.friends : [],
            incomingRequests: normalizeRequests(requestsResponse?.incoming),
            outgoingRequests: normalizeRequests(requestsResponse?.outgoing),
            acceptedOutgoingRequests: Array.isArray(requestsResponse?.acceptedOutgoing) ? requestsResponse.acceptedOutgoing : [],
            nicknameRequired: false,
            authenticated: true,
            lastRefreshAt: Date.now(),
            error: ''
          };
          emitChange(reason);
        } catch (error) {
          state.data = {
            ...state.data,
            error: error?.message || 'Unable to refresh social request state.',
            lastRefreshAt: Date.now()
          };
          console.warn('[social-sync] refresh failed; polling will continue', error);
          emitChange('error');
        } finally {
          state.refreshInFlight = null;
        }
        return { ...state.data };
      })();

      return state.refreshInFlight;
    }

    function requestRefresh(reason = 'external-refresh') {
      return refresh(reason);
    }

    function startPolling() {
      if (state.pollingStarted || isGuestSession()) return;
      state.pollingStarted = true;
      console.info('[social-sync] starting polling loop');
      refresh('startup');
      refreshTradeGroupNotifications().finally(renderFromSharedState);
      state.pollTimer = window.setInterval(() => {
        if (!document.hidden) {
          refresh('poll');
          refreshTradeGroupNotifications().finally(renderFromSharedState);
        }
      }, 15000);

      if (!state.listenersBound) {
        state.listenersBound = true;
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) refresh('tab-visible');
        });
        window.addEventListener(SOCIAL_REFRESH_EVENT, (event) => {
          const reason = event?.detail?.reason || 'external-event';
          requestRefresh(reason);
        });
        window.addEventListener('beforeunload', () => {
          if (state.pollTimer) {
            window.clearInterval(state.pollTimer);
            state.pollTimer = null;
          }
        });
      }
    }

    return {
      getState: () => ({ ...state.data }),
      refresh: requestRefresh,
      startPolling
    };
  }

  if (!window.socialRequestSync) {
    window.socialRequestSync = createSocialRequestSync();
  }

  window.socialRequestSync.startPolling();

  const state = {
    activeBanner: null,
    actionBusy: false,
    lastBadgeCount: null,
    hiddenIncomingRequestIds: new Set(),
    hiddenAcceptedRequestIds: new Set(),
    autoDismissTimer: null,
    hideAnimationTimer: null,
    seededAcceptedRequestIds: false,
    tradeGroupNotifications: [],
    hiddenTradeGroupNotificationIds: new Set()
  };
  const tradeGroupRefreshChannel = window.AppRefreshCoordinator?.createChannel('social-trade-group-notifications');

  function createAlertShell() {
    if (document.getElementById('global-friend-request-alert')) return;
    const shell = document.createElement('aside');
    shell.id = 'global-friend-request-alert';
    shell.className = 'social-global-alert hidden';
    shell.setAttribute('aria-live', 'polite');
    document.body.appendChild(shell);
  }

  function dismissActive() {
    state.activeBanner = null;
    if (state.autoDismissTimer) {
      window.clearTimeout(state.autoDismissTimer);
      state.autoDismissTimer = null;
    }
    if (state.hideAnimationTimer) {
      window.clearTimeout(state.hideAnimationTimer);
      state.hideAnimationTimer = null;
    }
    const shell = document.getElementById('global-friend-request-alert');
    if (shell) {
      shell.classList.add('is-leaving');
      state.hideAnimationTimer = window.setTimeout(() => {
        shell.classList.remove('is-leaving');
        shell.classList.add('hidden');
        shell.innerHTML = '';
        state.hideAnimationTimer = null;
      }, 220);
    }
  }

  function scheduleAutoDismiss(bannerType, id) {
    if (state.autoDismissTimer) window.clearTimeout(state.autoDismissTimer);
    state.autoDismissTimer = window.setTimeout(() => {
      if (!state.activeBanner || state.activeBanner.type !== bannerType || state.activeBanner.id !== id) return;
      if (bannerType === 'incoming') state.hiddenIncomingRequestIds.add(id);
      if (bannerType === 'accepted') state.hiddenAcceptedRequestIds.add(id);
      if (bannerType === 'trade-group') dismissTradeGroupNotification(id);
      dismissActive();
    }, 15000);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'include', ...opts });
    if (res.status === 401) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function handleAction(id, action) {
    if (!id || state.actionBusy) return;
    state.actionBusy = true;
    try {
      await api(`/api/social/friends/requests/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      state.hiddenIncomingRequestIds.add(id);
      dismissActive();
      await window.socialRequestSync.refresh(`banner-${action}`);
    } catch (_error) {
      // Keep unobtrusive: we silently ignore here and poll will continue.
    } finally {
      state.actionBusy = false;
      window.socialRequestSync.refresh('banner-action-finalize');
    }
  }


  function createBannerIdentityNode(request) {
    const wrap = document.createElement('div');
    wrap.className = 'social-global-alert__identity';
    const avatar = window.VeracitySocialAvatar?.createAvatar({
      nickname: request?.counterparty_nickname || 'A trader',
      avatar_url: request?.counterparty_avatar_url || '',
      avatar_initials: request?.counterparty_avatar_initials || ''
    }, 'xs');
    if (avatar) wrap.appendChild(avatar);
    const name = document.createElement('strong');
    name.textContent = request?.counterparty_nickname || 'A trader';
    wrap.appendChild(name);
    return wrap;
  }

  function renderIncomingRequest(request) {
    createAlertShell();
    const shell = document.getElementById('global-friend-request-alert');
    if (!shell || !request?.id) return;
    state.activeBanner = { type: 'incoming', id: request.id };
    if (state.hideAnimationTimer) {
      window.clearTimeout(state.hideAnimationTimer);
      state.hideAnimationTimer = null;
    }
    shell.classList.remove('is-leaving');
    shell.classList.remove('hidden');
    shell.innerHTML = `
      <div class="social-global-alert__title">Friend request</div>
      <div class="social-global-alert__body"></div>
      <div class="social-global-alert__actions">
        <button type="button" class="primary" data-social-alert-action="accept">Accept</button>
        <button type="button" class="ghost" data-social-alert-action="decline">Decline</button>
        <button type="button" class="ghost" data-social-alert-action="dismiss">Dismiss</button>
      </div>
    `;
    const body = shell.querySelector('.social-global-alert__body');
    if (body) {
      body.appendChild(createBannerIdentityNode(request));
      const text = document.createElement('span');
      text.textContent = 'sent you a friend request.';
      body.appendChild(text);
    }
    shell.querySelector('[data-social-alert-action="accept"]')?.addEventListener('click', () => handleAction(request.id, 'accept'));
    shell.querySelector('[data-social-alert-action="decline"]')?.addEventListener('click', () => handleAction(request.id, 'decline'));
    shell.querySelector('[data-social-alert-action="dismiss"]')?.addEventListener('click', () => {
      state.hiddenIncomingRequestIds.add(request.id);
      dismissActive();
    });
    scheduleAutoDismiss('incoming', request.id);
  }

  function renderAcceptedRequest(request) {
    createAlertShell();
    const shell = document.getElementById('global-friend-request-alert');
    if (!shell || !request?.id) return;
    state.activeBanner = { type: 'accepted', id: request.id };
    if (state.hideAnimationTimer) {
      window.clearTimeout(state.hideAnimationTimer);
      state.hideAnimationTimer = null;
    }
    shell.classList.remove('is-leaving');
    shell.classList.remove('hidden');
    shell.innerHTML = `
      <div class="social-global-alert__title">Friend connection</div>
      <div class="social-global-alert__body"></div>
      <div class="social-global-alert__actions">
        <button type="button" class="ghost" data-social-alert-action="dismiss">Dismiss</button>
      </div>
    `;
    const body = shell.querySelector('.social-global-alert__body');
    if (body) {
      body.appendChild(createBannerIdentityNode(request));
      const text = document.createElement('span');
      text.textContent = 'is now your friend.';
      body.appendChild(text);
    }
    shell.querySelector('[data-social-alert-action="dismiss"]')?.addEventListener('click', () => {
      state.hiddenAcceptedRequestIds.add(request.id);
      dismissActive();
    });
    scheduleAutoDismiss('accepted', request.id);
  }


  async function refreshTradeGroupNotifications() {
    const runner = async () => {
      try {
        const previousTopId = Array.isArray(state.tradeGroupNotifications) && state.tradeGroupNotifications.length
          ? String(state.tradeGroupNotifications[0].notification_id || '')
          : '';
        const payload = await api('/api/social/trade-groups/notifications/unread');
        state.tradeGroupNotifications = Array.isArray(payload?.notifications) ? payload.notifications : [];
        const nextTopId = state.tradeGroupNotifications.length
          ? String(state.tradeGroupNotifications[0].notification_id || '')
          : '';
        if (nextTopId && nextTopId !== previousTopId) {
          window.dispatchEvent(new CustomEvent(SOCIAL_REFRESH_EVENT, {
            detail: { reason: 'trade-group-notification-updated' }
          }));
        }
      } catch (_error) {
        state.tradeGroupNotifications = [];
      }
    };
    if (tradeGroupRefreshChannel) {
      return tradeGroupRefreshChannel.run(runner, { reason: 'trade-group-refresh', minIntervalMs: 2000, allowWhenHidden: false });
    }
    return runner();
  }

  async function dismissTradeGroupNotification(notificationId) {
    if (!notificationId) return;
    state.hiddenTradeGroupNotificationIds.add(notificationId);
    try {
      await api(`/api/social/trade-groups/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' });
    } catch (_error) {
      // ignore and keep local dismissal
    }
    dismissActive();
    await refreshTradeGroupNotifications();
    refreshTradeGroupNotifications().finally(renderFromSharedState);
  }

  async function respondToTradeGroupInvite(notification, action) {
    if (!notification?.invite_id || state.actionBusy) return;
    state.actionBusy = true;
    try {
      await api(`/api/social/trade-groups/invites/${encodeURIComponent(notification.invite_id)}/${action}`, { method: 'POST' });
      await dismissTradeGroupNotification(notification.notification_id);
      window.dispatchEvent(new CustomEvent(SOCIAL_REFRESH_EVENT));
      if (window.socialRequestSync && typeof window.socialRequestSync.refresh === 'function') {
        await window.socialRequestSync.refresh(`trade-group-invite-${action}`);
      }
    } catch (_error) {
      // keep unobtrusive; polling will reconcile state
    } finally {
      state.actionBusy = false;
      refreshTradeGroupNotifications().finally(renderFromSharedState);
    }
  }

  function renderTradeGroupNotification(notification) {
    createAlertShell();
    const shell = document.getElementById('global-friend-request-alert');
    if (!shell || !notification?.notification_id) return;
    state.activeBanner = { type: 'trade-group', id: notification.notification_id };
    shell.classList.remove('is-leaving');
    shell.classList.remove('hidden');

    const type = notification?.type;
    const isInvite = type === 'trade_group_invite';
    const isAnnouncement = type === 'trade_group_announcement';
    const isAlert = type === 'trade_group_alert';
    const isMemberJoined = type === 'trade_group_member_joined';
    const isWatchlistPosted = type === 'trade_group_watchlist_posted';

    const title = isInvite
      ? 'Trade group invite'
      : (isAnnouncement
        ? `${notification.group_name || 'Trade group'} announcement`
        : (isMemberJoined ? 'Group membership update' : (isWatchlistPosted ? 'New group watchlist' : 'Trade group alert')));

    shell.innerHTML = `
      <div class="social-global-alert__title">${title}</div>
      <div class="social-global-alert__body"></div>
      <div class="social-global-alert__actions"></div>
    `;

    const body = shell.querySelector('.social-global-alert__body');
    const actions = shell.querySelector('.social-global-alert__actions');
    if (body) {
      body.appendChild(createBannerIdentityNode({
        counterparty_nickname: notification.leader_nickname,
        counterparty_avatar_url: notification.leader_avatar_url,
        counterparty_avatar_initials: notification.leader_avatar_initials
      }));
      const text = document.createElement('span');
      if (isInvite) {
        text.textContent = `invited you to join ${notification.group_name}.`;
      } else if (isAnnouncement) {
        text.textContent = notification.text || 'New announcement.';
      } else if (isMemberJoined) {
        text.textContent = `joined ${notification.group_name || 'your trade group'}.`;
      } else if (isWatchlistPosted) {
        text.textContent = `${notification.leader_nickname || 'Leader'} posted a new watchlist: ${notification.watchlist_name || 'Watchlist'}.`;
      } else if (isAlert && notification.ticker) {
        const isSell = String(notification.side || '').toUpperCase() === 'SELL';
        const normalizedEventType = String(notification.normalized_event_type || '').toUpperCase();
        const isTrim = normalizedEventType === 'TRADE_TRIMMED'
          || String(notification.position_event_type || '').toUpperCase() === 'POSITION_TRIM'
          || String(notification.alert_classification || '').toLowerCase() === 'partial_sell';
        const fillPriceLabel = Number.isFinite(Number(notification.fill_price))
          ? `$${Number(notification.fill_price).toFixed(2)}`
          : '';
        const trimPctLabel = Number.isFinite(Number(notification.trim_pct))
          ? `${Number(notification.trim_pct).toFixed(Number(notification.trim_pct) % 1 === 0 ? 0 : 1)}%`
          : '';
        text.textContent = isSell
          ? (isTrim
            ? `${notification.group_name}: ${notification.leader_nickname || 'Leader'} trimmed ${trimPctLabel || 'part of'} ${notification.ticker}${fillPriceLabel ? ` at ${fillPriceLabel}` : ''}.`
            : `${notification.group_name}: ${notification.leader_nickname || 'Leader'} closed ${notification.ticker}${fillPriceLabel ? ` at ${fillPriceLabel}` : ''}.`)
          : `${notification.group_name}: ${notification.ticker} entry ${Number(notification.entry_price || 0).toFixed(2)} stop ${Number(notification.stop_price || 0).toFixed(2)} risk ${Number(notification.risk_pct || 0).toFixed(2)}%`;
      } else {
        text.textContent = `${notification.group_name}: New trade group activity.`;
      }
      body.appendChild(text);
    }

    if (actions) {
      if (isInvite) {
        actions.innerHTML = `
          <button type="button" class="primary" data-social-alert-action="accept">Accept</button>
          <button type="button" class="ghost" data-social-alert-action="decline">Decline</button>
          <button type="button" class="ghost" data-social-alert-action="dismiss">Dismiss</button>
        `;
        actions.querySelector('[data-social-alert-action="accept"]')?.addEventListener('click', () => respondToTradeGroupInvite(notification, 'accept'));
        actions.querySelector('[data-social-alert-action="decline"]')?.addEventListener('click', () => respondToTradeGroupInvite(notification, 'decline'));
        actions.querySelector('[data-social-alert-action="dismiss"]')?.addEventListener('click', async () => {
          await dismissTradeGroupNotification(notification.notification_id);
        });
      } else {
        actions.innerHTML = `
          <button type="button" class="primary" data-social-alert-action="open">Open</button>
          <button type="button" class="ghost" data-social-alert-action="dismiss">Dismiss</button>
        `;
        actions.querySelector('[data-social-alert-action="open"]')?.addEventListener('click', async () => {
          await dismissTradeGroupNotification(notification.notification_id);
          const target = isWatchlistPosted
            ? `/social/groups?group=${encodeURIComponent(notification.group_id)}&tab=watchlists&watchlist=${encodeURIComponent(notification.group_watchlist_id || '')}`
            : `/social/groups?group=${encodeURIComponent(notification.group_id)}`;
          window.location.href = target;
        });
        actions.querySelector('[data-social-alert-action="dismiss"]')?.addEventListener('click', async () => {
          await dismissTradeGroupNotification(notification.notification_id);
        });
      }
    }

    scheduleAutoDismiss('trade-group', notification.notification_id);
  }

  function pickRequestForBanner(incoming) {
    // Intentional behavior: show the newest pending request not dismissed by this browser session.
    const sorted = [...incoming].sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
    return sorted.find((request) => request?.id && !state.hiddenIncomingRequestIds.has(request.id)) || null;
  }

  function pickAcceptedForBanner(acceptedOutgoing) {
    // Intentional behavior: acceptance banners are shown once per request id in this browser session.
    const sorted = [...acceptedOutgoing].sort((a, b) => String(b?.updated_at || b?.created_at || '').localeCompare(String(a?.updated_at || a?.created_at || '')));
    return sorted.find((request) => request?.id && !state.hiddenAcceptedRequestIds.has(request.id)) || null;
  }

  function renderFromSharedState() {
    const socialData = window.socialRequestSync.getState();
    renderPendingBadge(socialData);
    if (!socialData.authenticated || socialData.nicknameRequired) {
      dismissActive();
      return;
    }
    if (!state.seededAcceptedRequestIds) {
      // UX intent: only surface newly-detected acceptances after this session starts.
      (socialData.acceptedOutgoingRequests || []).forEach((request) => {
        if (request?.id) state.hiddenAcceptedRequestIds.add(request.id);
      });
      state.seededAcceptedRequestIds = true;
    }
    const pendingIds = new Set((socialData.incomingRequests || []).map(item => item.id));
    const acceptedIds = new Set((socialData.acceptedOutgoingRequests || []).map(item => item.id));
    if (state.activeBanner?.type === 'incoming' && state.activeBanner?.id && !pendingIds.has(state.activeBanner.id)) {
      dismissActive();
    }
    if (state.activeBanner?.type === 'accepted' && state.activeBanner?.id && !acceptedIds.has(state.activeBanner.id)) {
      dismissActive();
    }
    if (state.activeBanner?.id) return;
    const tradeGroupNext = (state.tradeGroupNotifications || []).find(item => item?.notification_id && !state.hiddenTradeGroupNotificationIds.has(item.notification_id));
    if (tradeGroupNext) {
      renderTradeGroupNotification(tradeGroupNext);
      return;
    }
    const incomingNext = pickRequestForBanner(socialData.incomingRequests || []);
    if (incomingNext) {
      renderIncomingRequest(incomingNext);
      return;
    }
    const acceptedNext = pickAcceptedForBanner(socialData.acceptedOutgoingRequests || []);
    if (acceptedNext) renderAcceptedRequest(acceptedNext);
  }

  function renderPendingBadge(socialData) {
    const badge = document.getElementById('social-nav-pending-badge');
    if (!badge) return;
    if (!socialData?.authenticated || socialData.nicknameRequired || isGuestSession()) {
      if (!badge.classList.contains('hidden')) badge.classList.add('hidden');
      badge.textContent = '';
      badge.removeAttribute('data-count');
      state.lastBadgeCount = 0;
      return;
    }
    const pendingCount = Array.isArray(socialData.incomingRequests) ? socialData.incomingRequests.length : 0;
    if (state.lastBadgeCount === pendingCount) return;
    state.lastBadgeCount = pendingCount;
    if (pendingCount <= 0) {
      badge.textContent = '';
      badge.classList.add('hidden');
      badge.removeAttribute('data-count');
      return;
    }
    badge.textContent = String(pendingCount);
    badge.setAttribute('data-count', String(pendingCount));
    badge.classList.remove('hidden');
  }

  refreshTradeGroupNotifications().finally(renderFromSharedState);
  window.addEventListener(SOCIAL_SYNC_EVENT, () => {
    refreshTradeGroupNotifications().finally(renderFromSharedState);
  });
})();

(function initUtilitySidebar() {
  const isGuestSession = () => (sessionStorage.getItem('guestMode') === 'true' || localStorage.getItem('guestMode') === 'true')
    && typeof window.handleGuestRequest === 'function';
  if (isGuestSession()) return;

  const root = document.createElement('aside');
  root.className = 'utility-sidebar';
  root.innerHTML = `
    <div class="utility-sidebar__dock">
      <button class="utility-sidebar__icon" data-tab="chat" type="button" aria-label="Toggle chats panel">💬<span id="utility-chat-unread" class="utility-sidebar__badge hidden"></span></button>
      <button class="utility-sidebar__icon" data-tab="watchlist" type="button" aria-label="Toggle watchlists panel">◎</button>
    </div>
    <div class="utility-sidebar__panel" aria-hidden="true">
      <div class="utility-sidebar__head">
        <div class="utility-sidebar__tabs">
          <button class="utility-sidebar__tab" data-tab="chat" type="button">Chats</button>
          <button class="utility-sidebar__tab" data-tab="watchlist" type="button">Watchlists</button>
        </div>
        <button class="utility-sidebar__close" type="button" data-action="close" aria-label="Close utility panel">→</button>
      </div>
      <div class="utility-sidebar__search-wrap"><input id="utility-sidebar-search" class="utility-sidebar__search" type="search" placeholder="Search"></div>
      <div id="utility-sidebar-body" class="utility-sidebar__body"></div>
    </div>
  `;
  document.body.append(root);

  const state = {
    isUtilitySidebarOpen: false,
    activeUtilitySidebarTab: 'chat',
    chats: [],
    selectedGroupId: '',
    activeChatGroupId: '',
    activeChatByGroupId: {},
    draftByGroupId: {},
    composerUiByGroupId: {},
    chatDom: {
      mountedGroupId: '',
      textareaRef: null
    },
    watchlists: [],
    selectedWatchlistId: '',
    selectedWatchlistRows: [],
    query: '',
    chatsLoading: false,
    watchlistsLoading: false,
    chatError: '',
    watchlistError: '',
    chatsInitialized: false,
    watchlistsInitialized: false
  };
  const ALERT_RISK_PREFILL_STORAGE_KEY = 'plc-risk-calculator-prefill-v1';
  const SHARE_TOAST_TIMEOUT_MS = 2600;

  const body = root.querySelector('#utility-sidebar-body');
  const searchInput = root.querySelector('#utility-sidebar-search');
  const panelEl = root.querySelector('.utility-sidebar__panel');
  const chatDebugEnabled = localStorage.getItem('plcChatDebug') === '1';
  const chatDebug = (...args) => {
    if (!chatDebugEnabled) return;
    console.debug('[utility-chat]', ...args);
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'include', ...opts });
    if (res.status === 401) throw new Error('Unauthenticated');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || 'Request failed');
      error.status = res.status;
      error.body = data;
      throw error;
    }
    return data;
  }

  function ensureToastContainer() {
    let container = document.getElementById('global-toast-container');
    if (container) return container;
    container = document.createElement('div');
    container.id = 'global-toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
  }

  function showToast(message, tone = 'success') {
    if (!message) return;
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast-item toast-${tone === 'error' ? 'error' : (tone === 'info' ? 'info' : 'success')}`;
    toast.textContent = message;
    container.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 220);
    }, SHARE_TOAST_TIMEOUT_MS);
  }

  async function openTradeSharePicker(chats) {
    const rankedChats = [...chats].sort((a, b) => {
      const aMs = Date.parse(a?.latestMessage?.createdAt || '') || 0;
      const bMs = Date.parse(b?.latestMessage?.createdAt || '') || 0;
      return bMs - aMs;
    });
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'trade-share-picker-overlay';
      overlay.innerHTML = `
        <section class="trade-share-picker" role="dialog" aria-modal="true" aria-labelledby="trade-share-picker-title">
          <header class="trade-share-picker__head">
            <h4 id="trade-share-picker-title">Share trade to chat</h4>
            <button class="trade-share-picker__close" type="button" data-action="cancel" aria-label="Close share picker">×</button>
          </header>
          <p class="trade-share-picker__sub">Choose a trading group.</p>
          <div class="trade-share-picker__list">
            ${rankedChats.map((chat) => `
              <button class="trade-share-picker__group" type="button" data-action="pick-group" data-group-id="${chat.groupId}">
                <strong>${chat.groupName}</strong>
                <span>${chat.latestMessage?.createdAt ? `Active ${new Date(chat.latestMessage.createdAt).toLocaleDateString()}` : 'No recent activity'}</span>
              </button>
            `).join('')}
          </div>
        </section>
      `;
      let isDone = false;
      const onEsc = (event) => {
        if (event.key !== 'Escape') return;
        finish(null);
      };
      const finish = (value) => {
        if (isDone) return;
        isDone = true;
        window.removeEventListener('keydown', onEsc);
        overlay.remove();
        resolve(value);
      };
      overlay.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.dataset.action === 'cancel' || target === overlay) {
          finish(null);
          return;
        }
        if (target.dataset.action === 'pick-group') {
          const groupId = target.dataset.groupId;
          const selected = rankedChats.find((chat) => chat.groupId === groupId);
          finish(selected || null);
          return;
        }
        const row = target.closest('[data-action="pick-group"]');
        if (row instanceof HTMLElement) {
          const selected = rankedChats.find((chat) => chat.groupId === row.dataset.groupId);
          finish(selected || null);
        }
      });
      window.addEventListener('keydown', onEsc);
      document.body.appendChild(overlay);
      overlay.querySelector('[data-action="pick-group"]')?.focus();
    });
  }

  async function openChatTradeCardPicker(groupId) {
    if (!groupId) return null;
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'trade-share-picker-overlay';
      overlay.innerHTML = `
        <section class="trade-share-picker trade-share-picker--trades" role="dialog" aria-modal="true" aria-labelledby="trade-card-picker-title">
          <header class="trade-share-picker__head">
            <h4 id="trade-card-picker-title">Share trade card</h4>
            <button class="trade-share-picker__close" type="button" data-action="cancel" aria-label="Close trade picker">×</button>
          </header>
          <div class="trade-share-picker__filters">
            <input type="search" id="trade-picker-search" placeholder="Search ticker">
            <select id="trade-picker-status">
              <option value="all">All statuses</option>
              <option value="open">Open only</option>
              <option value="closed">Closed only</option>
            </select>
            <select id="trade-picker-sort">
              <option value="recent">Most recent</option>
            </select>
          </div>
          <div class="trade-share-picker__list" id="trade-picker-list"><p class="trade-share-picker__sub">Loading trades…</p></div>
          <footer class="trade-share-picker__footer">
            <button type="button" data-action="cancel">Cancel</button>
            <button type="button" data-action="confirm" disabled>Share selected trade</button>
          </footer>
        </section>
      `;
      let selectedTradeId = '';
      let rows = [];
      let done = false;
      let searchDebounce = null;
      const searchInput = overlay.querySelector('#trade-picker-search');
      const statusInput = overlay.querySelector('#trade-picker-status');
      const confirmBtn = overlay.querySelector('[data-action="confirm"]');
      const listEl = overlay.querySelector('#trade-picker-list');
      const finish = (value) => {
        if (done) return;
        done = true;
        overlay.remove();
        resolve(value);
      };
      const renderList = () => {
        if (!listEl) return;
        if (!rows.length) {
          listEl.innerHTML = '<p class="trade-share-picker__sub">No matching trades found.</p>';
          if (confirmBtn) confirmBtn.disabled = true;
          return;
        }
        listEl.innerHTML = rows.map((trade) => `
          <button type="button" data-action="pick-trade" data-trade-id="${trade.tradeId}" class="trade-share-picker__group ${selectedTradeId === trade.tradeId ? 'is-selected' : ''}">
            <strong>${trade.ticker || '—'} · ${trade.direction === 'short' ? 'Short' : 'Long'}</strong>
            <span>${trade.status === 'closed' ? 'Closed' : 'Open'} · ${trade.entryDate ? new Date(trade.entryDate).toLocaleDateString() : 'No entry date'}${trade.account ? ` · ${trade.account}` : ''}</span>
          </button>
        `).join('');
        if (confirmBtn) confirmBtn.disabled = !selectedTradeId;
      };
      const loadTrades = async () => {
        if (!listEl) return;
        listEl.innerHTML = '<p class="trade-share-picker__sub">Loading trades…</p>';
        const q = encodeURIComponent(String(searchInput?.value || '').trim());
        const status = encodeURIComponent(String(statusInput?.value || 'all'));
        try {
          const result = await api(`/api/group-chats/${encodeURIComponent(groupId)}/shareable-trades?q=${q}&status=${status}`);
          rows = Array.isArray(result?.trades) ? result.trades : [];
        } catch (error) {
          rows = [];
          listEl.innerHTML = `<p class="trade-share-picker__sub">${escapeHtml(error?.message || 'Unable to load trades.')}</p>`;
          return;
        }
        if (selectedTradeId && !rows.some((row) => row.tradeId === selectedTradeId)) selectedTradeId = '';
        renderList();
      };
      overlay.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.dataset.action === 'cancel' || target === overlay) return finish(null);
        if (target.dataset.action === 'confirm') {
          if (!selectedTradeId) return;
          const picked = rows.find((row) => row.tradeId === selectedTradeId) || null;
          return finish(picked);
        }
        const pick = target.closest('[data-action="pick-trade"]');
        if (pick instanceof HTMLElement && pick.dataset.tradeId) {
          selectedTradeId = pick.dataset.tradeId;
          renderList();
        }
      });
      searchInput?.addEventListener('input', () => {
        if (searchDebounce) window.clearTimeout(searchDebounce);
        searchDebounce = window.setTimeout(loadTrades, 120);
      });
      statusInput?.addEventListener('change', loadTrades);
      document.body.appendChild(overlay);
      loadTrades();
      searchInput?.focus();
    });
  }

  function setUtilitySidebarOpen(nextOpen) {
    state.isUtilitySidebarOpen = !!nextOpen;
    root.classList.toggle('is-open', state.isUtilitySidebarOpen);
    panelEl.setAttribute('aria-hidden', String(!state.isUtilitySidebarOpen));
    if (!state.isUtilitySidebarOpen) state.activeChatGroupId = '';
  }

  function getActiveChatData() {
    if (!state.activeChatGroupId) return null;
    return state.activeChatByGroupId[state.activeChatGroupId] || null;
  }

  function ensureComposerUi(groupId) {
    if (!groupId) return null;
    if (!state.composerUiByGroupId[groupId]) {
      state.composerUiByGroupId[groupId] = {
        announcement: false,
        isSending: false,
        sendPhase: 'idle',
        sendError: '',
        suggestions: [],
        suggestionIndex: 0,
        selectedEntities: [],
        activeTokenRange: null,
        lastDraft: '',
        suggestionsSeq: 0,
        cachedSuggestions: {
          users: [],
          roles: [],
          systemMentions: [],
          pageTags: []
        }
      };
    }
    return state.composerUiByGroupId[groupId];
  }

  function shiftComposerEntities(entities, pivot, delta) {
    return (Array.isArray(entities) ? entities : []).map((entity) => {
      const next = { ...entity };
      if (!Number.isFinite(next.start) || !Number.isFinite(next.end)) return next;
      if (next.start >= pivot) {
        next.start += delta;
        next.end += delta;
      }
      return next;
    });
  }

  function reconcileComposerEntities(text, entities) {
    const safeText = String(text || '');
    const dedupe = new Set();
    return (Array.isArray(entities) ? entities : []).filter((entity) => {
      if (!entity || entity.type !== 'mention') return false;
      if (!Number.isFinite(entity.start) || !Number.isFinite(entity.end)) return false;
      if (entity.start < 0 || entity.end <= entity.start || entity.end > safeText.length) return false;
      const expected = String(entity.displayText || '');
      if (!expected) return false;
      const actual = safeText.slice(entity.start, entity.end);
      if (actual !== expected) return false;
      const key = `${entity.mentionType || 'user'}:${entity.targetId || expected}:${entity.start}:${entity.end}`;
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    });
  }

  function handleTabToggle(tab) {
    const sameTab = state.activeUtilitySidebarTab === tab;
    if (!state.isUtilitySidebarOpen) {
      state.activeUtilitySidebarTab = tab;
      setUtilitySidebarOpen(true);
    } else if (sameTab) {
      setUtilitySidebarOpen(false);
    } else {
      state.activeUtilitySidebarTab = tab;
      setUtilitySidebarOpen(true);
    }
    if (!state.isUtilitySidebarOpen) {
      render();
      return;
    }
    if (state.activeUtilitySidebarTab === 'watchlist') {
      if (!state.watchlistsInitialized) {
        state.watchlistsInitialized = true;
        loadWatchlists();
      }
    } else if (state.activeUtilitySidebarTab === 'chat') {
      if (!state.chatsInitialized) {
        state.chatsInitialized = true;
        loadChats();
      }
    }
    render();
  }

  function renderUnread() {
    const chatUnread = state.chats.reduce((sum, chat) => sum + Number(chat.unreadCount || 0), 0);
    const badge = document.getElementById('utility-chat-unread');
    if (!badge) return;
    badge.classList.toggle('hidden', chatUnread <= 0);
    badge.textContent = chatUnread > 99 ? '99+' : String(chatUnread || '');
  }

  function getMessageType(msg) {
    const raw = String(msg?.messageType || '').trim();
    return raw === 'user' ? 'user_message' : (raw || 'user_message');
  }

  function isLeaderAnnouncement(msg) {
    return getMessageType(msg) === 'leader_announcement';
  }

  function renderTradeShareMessage(msg) {
    const meta = msg?.metadata || {};
    const ticker = String(meta.ticker || '—').toUpperCase();
    const directionRaw = String(meta.direction || 'long').toLowerCase();
    const direction = directionRaw === 'short' ? 'Short' : 'Long';
    const entry = Number(meta.entryPrice);
    const stop = Number(meta.stopPrice);
    const riskPct = Number(meta.riskPercent);
    const status = String(meta.status || '').trim() || 'Open';
    return `
      <div class="utility-trade-ticket">
        <div class="utility-trade-ticket__top">
          <strong class="utility-trade-ticket__ticker">${ticker}</strong>
          <span class="utility-trade-ticket__direction utility-trade-ticket__direction--${directionRaw === 'short' ? 'short' : 'long'}">${direction}</span>
          <span class="utility-trade-ticket__status">${status}</span>
        </div>
        <div class="utility-trade-ticket__grid">
          <div><span>Entry</span><strong>${Number.isFinite(entry) ? entry.toFixed(4) : '—'}</strong></div>
          <div><span>Stop</span><strong>${Number.isFinite(stop) ? stop.toFixed(4) : '—'}</strong></div>
          <div><span>Risk %</span><strong>${Number.isFinite(riskPct) ? `${riskPct.toFixed(2)}%` : '—'}</strong></div>
        </div>
        <div class="utility-trade-ticket__bottom">
          <span class="utility-trade-ticket__meta">Trade share</span>
          <button data-action="size-trade" data-mid="${msg.id}" type="button" class="utility-chat-msg__workflow-btn">Size this trade</button>
        </div>
      </div>
    `;
  }

  function renderTradeEventSystemMessage(msg) {
    const meta = msg?.metadata || {};
    const eventType = String(meta.eventType || '').toUpperCase().trim();
    const label = eventType === 'TRADE_TRIMMED' ? 'Trimmed' : (eventType === 'TRADE_CLOSED' ? 'Closed' : 'Opened');
    const ticker = String(meta.ticker || '—').toUpperCase();
    const keyInfo = String(msg.content || meta.summary || '').trim() || 'System update';
    return `
      <div class="utility-trade-event-line">
        <span class="utility-trade-event-line__type">${label}</span>
        <span class="utility-trade-event-line__main"><strong>${ticker}</strong><span>${keyInfo}</span></span>
      </div>
    `;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function renderStructuredText(msg) {
    const text = String(msg?.rawText || msg?.content || '');
    const entities = Array.isArray(msg?.entities) ? [...msg.entities] : [];
    if (!entities.length) return `<p>${escapeHtml(text)}</p>`;
    const ordered = entities
      .filter((entity) => Number.isFinite(Number(entity?.start)) && Number.isFinite(Number(entity?.end)))
      .sort((a, b) => Number(a.start) - Number(b.start));
    let cursor = 0;
    const chunks = [];
    ordered.forEach((entity) => {
      const start = Math.max(0, Number(entity.start));
      const end = Math.max(start, Number(entity.end));
      if (start > cursor) chunks.push(escapeHtml(text.slice(cursor, start)));
      const raw = text.slice(start, end);
      if (entity.type === 'mention') {
        chunks.push(`<span class="utility-chat-token utility-chat-token--mention">${escapeHtml(raw || entity.displayText || '')}</span>`);
      } else if (entity.type === 'page_link' && entity.route) {
        chunks.push(`<a class="utility-chat-token utility-chat-token--page" href="${entity.route}">${escapeHtml(raw || entity.displayText || '')}</a>`);
      } else {
        chunks.push(escapeHtml(raw));
      }
      cursor = end;
    });
    if (cursor < text.length) chunks.push(escapeHtml(text.slice(cursor)));
    return `<p>${chunks.join('')}</p>`;
  }

  function renderAttachments(msg) {
    const attachments = Array.isArray(msg?.attachments) ? msg.attachments : [];
    if (!attachments.length) return '';
    return `<div class="utility-chat-attachments">${attachments.map((attachment) => `
      <button class="utility-chat-attachment ${attachment.type === 'trade_card' ? 'is-trade-card' : ''}" data-action="open-attachment" data-url="${attachment.url}" type="button">
        <img src="${attachment.url}" loading="lazy" alt="${attachment.type === 'trade_card' ? 'Trade card' : 'Attachment'}">
      </button>
    `).join('')}</div>`;
  }

  function renderChatMessageBody(msg) {
    const type = getMessageType(msg);
    if (type === 'trade_share') return renderTradeShareMessage(msg);
    if (type === 'trade_event_system') return renderTradeEventSystemMessage(msg);
    if (type === 'leader_announcement') return `<div class="utility-chat-msg__type">Leader announcement</div>${renderStructuredText(msg)}${renderAttachments(msg)}`;
    return `${renderStructuredText(msg)}${renderAttachments(msg)}`;
  }

  function buildChatMessagesHtml(chat) {
    const messages = chat.messages || [];
    if (!messages.length) return '<div class="utility-empty"><strong>No messages yet</strong><p>Start the desk conversation with the first update.</p></div>';
    return messages.map((msg, index) => {
      const prev = messages[index - 1];
      const type = getMessageType(msg);
      const sameSender = prev && prev.senderNickname === msg.senderNickname;
      const sameType = prev && getMessageType(prev) === type;
      const isGrouped = !!(sameSender && sameType);
      const createdAtMs = new Date(msg.createdAt).getTime();
      const isFresh = Number.isFinite(createdAtMs) && (Date.now() - createdAtMs) <= 12000;
      const avatar = msg.senderAvatarUrl
        ? `<img src="${msg.senderAvatarUrl}" alt="${msg.senderNickname}" loading="lazy">`
        : `<span>${(msg.senderAvatarInitials || msg.senderNickname || '?').slice(0, 2).toUpperCase()}</span>`;
      const badges = Array.isArray(msg.senderRoleBadges) && msg.senderRoleBadges.length
        ? `<div class="utility-chat-msg__badges">${msg.senderRoleBadges.map((badge) => `<span style="--role-color:${badge.color || '#3cb982'}">${badge.name}</span>`).join('')}</div>`
        : '';
      const senderLabel = !sameSender ? `<div class="utility-chat-msg__sender"><div class="utility-chat-avatar">${avatar}</div><div><strong>${msg.senderNickname}</strong>${badges}</div></div>` : '';
      return `
      <article class="utility-chat-msg ${isLeaderAnnouncement(msg) ? 'is-announcement' : ''} ${type === 'trade_share' ? 'is-trade-share' : ''} ${type === 'trade_event_system' ? 'is-trade-event-system' : ''} ${isGrouped ? 'is-grouped' : 'is-group-break'} ${isFresh ? 'is-fresh' : ''}">
        ${senderLabel}
        <header><span>${new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></header>
        ${renderChatMessageBody(msg)}
        ${chat.chat.canModerate ? `<div class="utility-chat-msg__actions"><button data-action="pin" data-mid="${msg.id}" type="button">Pin</button><button data-action="delete" data-mid="${msg.id}" type="button">Delete</button></div>` : ''}
      </article>
    `;
    }).join('');
  }

  function getTypingText(chat) {
    const typingUsers = Array.isArray(chat.typingUsers) ? chat.typingUsers : [];
    if (typingUsers.length === 1) return `${typingUsers[0].nickname} is typing…`;
    if (typingUsers.length === 2) return `${typingUsers[0].nickname} and ${typingUsers[1].nickname} are typing…`;
    return typingUsers.length > 2 ? 'Several people are typing…' : '';
  }

  function mountChatRoom(groupId) {
    const chat = state.activeChatByGroupId[groupId];
    if (!chat) return;
    const composerUi = ensureComposerUi(groupId);
    const draftValue = state.draftByGroupId[groupId] || '';
    const pinned = chat.pinnedMessage;
    const typingText = getTypingText(chat);
    body.innerHTML = `
      <div class="utility-chat-room" data-chat-room-id="${groupId}">
        <div class="utility-chat-room__header" id="utility-chat-room-header"></div>
        <div class="utility-chat-context-strip" id="utility-chat-context-strip"></div>
        <div id="utility-chat-pinned-slot"></div>
        <div class="utility-chat-feed" id="utility-chat-feed"></div>
        <div class="utility-chat-typing" id="utility-chat-typing" ${typingText ? '' : 'aria-hidden="true"'}></div>
        <form class="utility-chat-composer" data-action="send" data-composer-group-id="${groupId}">
          ${chat.chat.canSend ? '' : '<div class="utility-chat-locked">Chat is locked. Only moderators can post right now.</div>'}
          <textarea name="content" data-composer-textarea-id="${groupId}" placeholder="Share market context, execution notes, or risk updates…" ${!chat.chat.canSend || composerUi.isSending ? 'disabled' : ''}>${escapeHtml(draftValue)}</textarea>
          <div class="utility-chat-composer__suggestions hidden" id="utility-chat-suggestions"></div>
          ${composerUi.sendError ? `<div class="utility-chat-composer__error" role="status" aria-live="polite">${escapeHtml(composerUi.sendError)}</div>` : ''}
          <div>
            <div class="utility-chat-composer__left">${chat.chat.canModerate ? `<label class="utility-chat-composer__announcement"><input type="checkbox" name="announcement" ${composerUi.announcement ? 'checked' : ''}> Post as leader announcement</label>` : '<span></span>'}<button data-action="attach-trade-card" type="button">Share trade card</button></div>
            <button type="submit" ${!chat.chat.canSend || composerUi.isSending ? 'disabled' : ''}>${composerUi.isSending ? 'Sending…' : 'Send'}</button>
          </div>
        </form>
      </div>
    `;
    state.chatDom.mountedGroupId = groupId;
    state.chatDom.textareaRef = body.querySelector('.utility-chat-composer textarea');
    chatDebug('composer-mount', { groupId, textareaId: state.chatDom.textareaRef?.dataset?.composerTextareaId });
    patchActiveChatRoom(groupId);
  }

  function patchActiveChatRoom(groupId) {
    const chat = state.activeChatByGroupId[groupId];
    if (!chat) return;
    const composerUi = ensureComposerUi(groupId);
    const pinned = chat.pinnedMessage;
    const typingText = getTypingText(chat);
    const header = body.querySelector('#utility-chat-room-header');
    const contextStrip = body.querySelector('#utility-chat-context-strip');
    const pinnedSlot = body.querySelector('#utility-chat-pinned-slot');
    const feed = body.querySelector('#utility-chat-feed');
    const typing = body.querySelector('#utility-chat-typing');
    const composer = body.querySelector('.utility-chat-composer');
    if (header) {
      header.innerHTML = `
        <button class="utility-link-btn" data-action="back" type="button">← Chats</button>
        <div class="utility-chat-room__title-wrap">
          <h4>${chat.chat.groupName}</h4>
          <p>${chat.chat.participantCount || 0} participants${chat.chat.isLocked ? ' · Locked by leader' : ''}</p>
        </div>
        ${chat.chat.canModerate ? `<div class="utility-chat-room__mod"><button data-action="${chat.chat.isLocked ? 'unlock' : 'lock'}" type="button">${chat.chat.isLocked ? 'Unlock room' : 'Lock room'}</button>${chat.chat.pinnedMessageId ? '<button data-action="unpin" type="button">Unpin note</button>' : ''}</div>` : ''}
      `;
    }
    if (contextStrip) {
      contextStrip.innerHTML = `
        <span>${chat.chat.groupName}</span>
        <span>${chat.chat.participantCount || 0} members</span>
        ${chat.chat.latestTradeEvent ? `<span>${chat.chat.latestTradeEvent}</span>` : '<span>No recent trade event</span>'}
        ${chat.chat.hasGroupWatchlist ? '<button data-action="open-group-watchlist" type="button">Open group watchlist</button>' : ''}
      `;
    }
    if (pinnedSlot) pinnedSlot.innerHTML = pinned ? `<div class="utility-chat-pinned"><span class="utility-chat-pinned__label">Pinned note</span><strong>${pinned.senderNickname}</strong><p>${pinned.content}</p></div>` : '';
    if (feed) feed.innerHTML = buildChatMessagesHtml(chat);
    chatDebug('rendered-message-data', {
      groupId,
      messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
      latestMessage: Array.isArray(chat.messages) && chat.messages.length ? chat.messages[chat.messages.length - 1] : null
    });
    if (typing) {
      typing.textContent = typingText;
      typing.setAttribute('aria-hidden', typingText ? 'false' : 'true');
    }
    if (composer) {
      const sendButton = composer.querySelector('button[type="submit"]');
      if (sendButton) {
        sendButton.disabled = !chat.chat.canSend || composerUi.isSending;
        sendButton.textContent = composerUi.isSending ? 'Sending…' : 'Send';
      }
      const announcement = composer.querySelector('input[name="announcement"]');
      if (announcement) announcement.checked = !!composerUi.announcement;
      const textarea = composer.querySelector('textarea[name="content"]');
      if (textarea) {
        if (state.chatDom.textareaRef && state.chatDom.textareaRef !== textarea) {
          chatDebug('composer-replaced', { from: state.chatDom.textareaRef.dataset?.composerTextareaId, to: textarea.dataset?.composerTextareaId, groupId });
        }
        state.chatDom.textareaRef = textarea;
        const shouldDisable = !chat.chat.canSend || composerUi.isSending;
        if (textarea.disabled !== shouldDisable) textarea.disabled = shouldDisable;
      }
    }
    chatDebug('chat-patch', { groupId, messages: (chat.messages || []).length, typing: !!typingText });
  }

  function focusComposer(groupId, options = {}) {
    const chatGroupId = String(groupId || state.activeChatGroupId || '');
    const textarea = root.querySelector(`.utility-chat-composer textarea[data-composer-textarea-id="${chatGroupId}"]`)
      || root.querySelector('.utility-chat-composer textarea');
    if (!textarea) return;
    textarea.focus();
    if (options.atEnd) {
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    }
  }

  function selectComposerSuggestion(index) {
    if (!state.activeChatGroupId) return false;
    const composer = root.querySelector('.utility-chat-composer textarea');
    const composerUi = ensureComposerUi(state.activeChatGroupId);
    const suggestion = composerUi?.suggestions?.[Number(index)];
    if (!composer || !suggestion) return false;
    const cursor = composer.selectionStart || 0;
    const range = composerUi?.activeTokenRange && Number.isFinite(composerUi.activeTokenRange.start) && Number.isFinite(composerUi.activeTokenRange.end)
      ? composerUi.activeTokenRange
      : { start: cursor, end: cursor };
    const before = composer.value.slice(0, Math.max(0, range.start));
    const after = composer.value.slice(Math.max(0, range.end));
    const replacement = `${suggestion.insert} `;
    composer.value = before + replacement + after;
    const replacementStart = before.length;
    const replacementEnd = replacementStart + suggestion.insert.length;
    const delta = replacement.length - (range.end - range.start);
    composerUi.selectedEntities = shiftComposerEntities(composerUi.selectedEntities, range.end, delta);
    if (suggestion.type === 'user' || suggestion.type === 'role' || suggestion.type === 'system') {
      const mentionType = suggestion.type === 'system' ? (suggestion.mentionType || 'everyone') : suggestion.type;
      composerUi.selectedEntities.push({
        type: 'mention',
        mentionType,
        targetId: suggestion.targetId || null,
        displayText: suggestion.insert,
        start: replacementStart,
        end: replacementEnd
      });
    }
    state.draftByGroupId[state.activeChatGroupId] = composer.value;
    composerUi.lastDraft = composer.value;
    composer.focus();
    const pos = replacementStart + replacement.length;
    composer.setSelectionRange(pos, pos);
    const wrap = root.querySelector('#utility-chat-suggestions');
    if (wrap) {
      wrap.classList.add('hidden');
      wrap.innerHTML = '';
    }
    composerUi.activeTokenRange = null;
    composerUi.selectedEntities = reconcileComposerEntities(composer.value, composerUi.selectedEntities);
    chatDebug('composer-suggestion-selected', {
      groupId: state.activeChatGroupId,
      index,
      suggestion,
      draft: composer.value,
      entities: composerUi.selectedEntities
    });
    return true;
  }

  function renderChatRoom() {
    const chat = getActiveChatData();
    if (!chat) return;
    const groupId = String(chat.chat?.groupId || '');
    const mountedRoom = body.querySelector('.utility-chat-room');
    if (!mountedRoom || state.chatDom.mountedGroupId !== groupId) {
      mountChatRoom(groupId);
      return;
    }
    patchActiveChatRoom(groupId);
  }

  function renderChats() {
    if (getActiveChatData()) return renderChatRoom();
    const filtered = state.chats.filter((chat) => `${chat.groupName} ${chat.latestMessage?.content || ''}`.toLowerCase().includes(state.query.toLowerCase()));
    if (state.chatsLoading) {
      body.innerHTML = '<div class="utility-empty utility-empty--loading"><strong>Loading chats</strong><p>Syncing your desk rooms…</p></div>';
      return;
    }
    if (state.chatError) {
      body.innerHTML = `<div class="utility-empty"><strong>Chat feed unavailable</strong><p>${state.chatError}</p></div>`;
      return;
    }
    body.innerHTML = `
      <div class="utility-list">
        ${filtered.length ? filtered.map((chat) => `
          <button class="utility-chat-row ${chat.unreadCount ? 'has-unread' : ''} ${state.activeChatGroupId === chat.groupId ? 'is-active' : ''}" data-group-id="${chat.groupId}" type="button">
            <div class="utility-chat-row__top"><strong>${chat.groupName}</strong><span class="utility-chat-row__time">${chat.latestMessage?.createdAt ? new Date(chat.latestMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>
            <p title="${chat.latestMessage?.content || 'No messages yet'}">${chat.latestMessage?.content || 'No messages yet'}</p>
            <div class="utility-chat-row__meta">${chat.isLeaderOwned ? '<span class="utility-chat-row__leader">Leader</span>' : '<span></span>'}${chat.unreadCount ? `<span class="utility-pill">${chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>` : '<span class="utility-chat-row__read">Read</span>'}</div>
          </button>
        `).join('') : '<div class="utility-empty"><strong>No chats yet</strong><p>Join or create a trading group to start collaborating.</p></div>'}
      </div>
    `;
  }

  function renderWatchlists() {
    const active = state.watchlists.find((w) => w.id === state.selectedWatchlistId) || state.watchlists[0];
    const personalWatchlists = state.watchlists.filter((w) => (w.scope || 'personal') !== 'group');
    const groupWatchlists = state.watchlists.filter((w) => w.scope === 'group');
    const rows = (state.selectedWatchlistRows || []).map((row) => {
      const ticker = String(row?.ticker || row?.displayTicker || row?.symbol || '—').trim() || '—';
      const currentPrice = Number(row?.currentPrice);
      const percentChangeToday = Number(row?.percentChangeToday);
      return {
        itemId: row?.itemId || '',
        ticker,
        currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
        percentChangeToday: Number.isFinite(percentChangeToday) ? percentChangeToday : null
      };
    });
    const formatPrice = (value) => Number.isFinite(Number(value))
      ? `$${Number(value).toFixed(Number(value) >= 100 ? 2 : 4)}`
      : '—';
    const formatChange = (value) => {
      if (!Number.isFinite(Number(value))) return '—';
      const numeric = Number(value);
      return `${numeric > 0 ? '+' : ''}${numeric.toFixed(2)}%`;
    };
    if (state.watchlistsLoading) {
      body.innerHTML = '<div class="utility-empty utility-empty--loading"><strong>Loading watchlists</strong><p>Pulling latest symbols and quotes…</p></div>';
      return;
    }
    if (state.watchlistError) {
      body.innerHTML = `<div class="utility-empty"><strong>Watchlist unavailable</strong><p>${state.watchlistError}</p></div>`;
      return;
    }
    body.innerHTML = `
        <div class="utility-watchlists">
        <div class="utility-watchlists__select-wrap"><select id="utility-watchlist-select" ${state.watchlists.length ? '' : 'disabled'}>
          ${personalWatchlists.length ? `<optgroup label="Personal">${personalWatchlists.map((w) => `<option value="${w.id}" ${w.id === active?.id ? 'selected' : ''}>${w.name}</option>`).join('')}</optgroup>` : ''}
          ${groupWatchlists.length ? `<optgroup label="Group">${groupWatchlists.map((w) => `<option value="${w.id}" ${w.id === active?.id ? 'selected' : ''}>${w.name} · ${w.tradingGroupId ? 'Desk' : 'Group'}</option>`).join('')}</optgroup>` : ''}
        </select></div>
        ${active ? `<div class="utility-watchlist-scope">${active.scope === 'group' ? `Group watchlist${active.canMembersEdit ? ' · Member editable' : ' · Leader managed'}` : 'Personal watchlist'}</div>` : ''}
        ${state.watchlists.length ? `
          <div class="utility-watchlist-actions"><input id="utility-watchlist-add" placeholder="Ticker" ${active?.scope === 'group' && !active?.canEdit ? 'disabled' : ''}><button id="utility-watchlist-add-btn" type="button" ${active?.scope === 'group' && !active?.canEdit ? 'disabled' : ''}>Add</button></div>
          <div class="utility-watchlist-rows">${rows.length ? rows.map((row) => `<div class="utility-watchlist-row"><strong>${row.ticker}</strong><span>${formatPrice(row.currentPrice)}</span><span class="${row.percentChangeToday === null ? 'is-flat' : (row.percentChangeToday >= 0 ? 'is-up' : 'is-down')}">${formatChange(row.percentChangeToday)}</span><button data-action="remove-symbol" data-item-id="${row.itemId}" type="button" ${active?.canEdit ? '' : 'disabled'} aria-label="Remove ${row.ticker} from watchlist">Remove</button></div>`).join('') : '<div class="utility-empty"><strong>No symbols in this watchlist</strong><p>Add tickers to monitor real-time movement.</p></div>'}</div>
        ` : '<div class="utility-empty"><strong>No watchlists yet</strong><p>Create one from the Watchlists page to pin symbols here.</p></div>'}
      </div>
    `;
  }

  function render() {
    root.querySelectorAll('[data-tab]').forEach((el) => {
      const tab = el.dataset.tab;
      const isActive = state.activeUtilitySidebarTab === tab;
      const shouldHighlight = state.isUtilitySidebarOpen ? isActive : false;
      el.classList.toggle('is-active', shouldHighlight);
    });
    if (!state.isUtilitySidebarOpen) return renderUnread();
    if (state.activeUtilitySidebarTab === 'chat') {
      renderChats();
    } else {
      state.chatDom.mountedGroupId = '';
      state.chatDom.textareaRef = null;
      renderWatchlists();
    }
    renderUnread();
  }

  function maybeScrollChatToBottom(force = false) {
    const feed = root.querySelector('#utility-chat-feed');
    if (!feed) return;
    const distance = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    if (force || distance < 80) feed.scrollTop = feed.scrollHeight;
  }

  let typingDebounce = null;
  async function publishTyping(isTyping = true) {
    if (!state.activeChatGroupId) return;
    try {
      await api(`/api/group-chats/${encodeURIComponent(state.activeChatGroupId)}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping })
      });
    } catch (_) {}
  }

  function hydrateComposerSuggestionCache(groupId, seed = {}) {
    const composerUi = ensureComposerUi(groupId);
    if (!composerUi) return;
    composerUi.cachedSuggestions = {
      users: Array.isArray(seed.users) ? seed.users : [],
      roles: Array.isArray(seed.roles) ? seed.roles : [],
      systemMentions: Array.isArray(seed.systemMentions) ? seed.systemMentions : [],
      pageTags: Array.isArray(seed.pageTags) ? seed.pageTags : []
    };
    chatDebug('suggestions-cache-hydrated', {
      groupId,
      users: composerUi.cachedSuggestions.users.length,
      roles: composerUi.cachedSuggestions.roles.length,
      systemMentions: composerUi.cachedSuggestions.systemMentions.length,
      pageTags: composerUi.cachedSuggestions.pageTags.length
    });
  }

  function buildSuggestionsFromCache(cache = {}, marker = '@', query = '') {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (marker === '#') {
      return (cache.pageTags || [])
        .filter((item) => !normalizedQuery || String(item.slug || '').toLowerCase().includes(normalizedQuery))
        .map((item) => ({ label: `#${item.slug}`, insert: `#${item.slug}`, type: 'page', slug: item.slug }))
        .slice(0, 8);
    }
    const users = (cache.users || [])
      .filter((item) => !normalizedQuery || String(item.nickname || '').toLowerCase().includes(normalizedQuery))
      .map((item) => ({ label: `@${item.nickname}`, insert: `@${item.nickname}`, type: 'user', targetId: item.userId }));
    const roles = (cache.roles || [])
      .filter((item) => !normalizedQuery || String(item.name || '').toLowerCase().includes(normalizedQuery))
      .map((item) => ({ label: `@${item.name}`, insert: `@${item.name}`, type: 'role', targetId: item.roleId }));
    const systems = (cache.systemMentions || [])
      .filter((item) => !normalizedQuery || String(item.displayText || '').toLowerCase().includes(normalizedQuery))
      .map((item) => ({ label: item.displayText, insert: item.displayText, type: 'system', mentionType: item.type }));
    return [...users, ...roles, ...systems].slice(0, 8);
  }

  function renderComposerSuggestions(composerUi, tokenRange) {
    const wrap = root.querySelector('#utility-chat-suggestions');
    if (!wrap || !composerUi) return;
    composerUi.activeTokenRange = tokenRange || null;
    if (!composerUi.suggestions.length) {
      wrap.classList.add('hidden');
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = composerUi.suggestions.map((item, idx) => `<button type="button" data-action="pick-suggestion" data-index="${idx}" class="${idx === composerUi.suggestionIndex ? 'is-active' : ''}"><span>${item.label}</span><small>${item.type}</small></button>`).join('');
    wrap.classList.remove('hidden');
  }

  async function updateComposerSuggestions(textarea) {
    if (!textarea || !state.activeChatGroupId) return;
    const composerUi = ensureComposerUi(state.activeChatGroupId);
    const cursor = textarea.selectionStart || 0;
    const textBefore = textarea.value.slice(0, cursor);
    const mentionMatch = textBefore.match(/(^|\s)([@#])([A-Za-z0-9_-]{0,24})$/);
    if (!mentionMatch) {
      composerUi.activeTokenRange = null;
      composerUi.suggestions = [];
      renderComposerSuggestions(composerUi, null);
      return;
    }
    const marker = mentionMatch[2];
    const query = mentionMatch[3] || '';
    const tokenStart = cursor - query.length - 1;
    const tokenEnd = cursor;
    composerUi.suggestions = buildSuggestionsFromCache(composerUi.cachedSuggestions, marker, query);
    composerUi.suggestionIndex = 0;
    renderComposerSuggestions(composerUi, { start: tokenStart, end: tokenEnd });
    chatDebug('suggestions-local-render', {
      groupId: state.activeChatGroupId,
      marker,
      query,
      count: composerUi.suggestions.length
    });
    const requestSeq = (composerUi.suggestionsSeq || 0) + 1;
    composerUi.suggestionsSeq = requestSeq;
    let data = null;
    try {
      data = await api(`/api/group-chats/${encodeURIComponent(state.activeChatGroupId)}/suggestions?q=${encodeURIComponent(query)}`);
    } catch (error) {
      chatDebug('suggestions-refresh-failed', { groupId: state.activeChatGroupId, marker, query, error: error?.message || 'request failed' });
      return;
    }
    if (requestSeq !== composerUi.suggestionsSeq) return;
    hydrateComposerSuggestionCache(state.activeChatGroupId, data);
    composerUi.suggestions = buildSuggestionsFromCache(composerUi.cachedSuggestions, marker, query);
    composerUi.suggestionIndex = 0;
    renderComposerSuggestions(composerUi, { start: tokenStart, end: tokenEnd });
    chatDebug('suggestions-network-refresh', { groupId: state.activeChatGroupId, marker, query, count: composerUi.suggestions.length });
  }

  function classifySendError(error) {
    const status = Number(error?.status || 0);
    if (status === 400) return 'Validation failed. Please review your message and try again.';
    if (status === 403) return String(error?.message || '').includes('@everyone')
      ? 'You do not have permission to mention @everyone.'
      : (error?.message || 'You do not have permission to send in this chat.');
    if (status >= 500) return 'Server error while sending. Please retry.';
    if (status > 0) return error?.message || 'Unable to send message.';
    return 'Network error while sending. Please retry.';
  }

  function upsertMessageInActiveChat(groupId, message) {
    if (!groupId || !message) return false;
    const active = state.activeChatByGroupId[groupId];
    if (!active) return false;
    const list = Array.isArray(active.messages) ? active.messages : [];
    const existingIndex = list.findIndex((item) => item.id === message.id);
    if (existingIndex >= 0) {
      list[existingIndex] = message;
      active.messages = list;
      return true;
    }
    active.messages = [...list, message].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    active.chat = { ...(active.chat || {}), latestTradeEvent: active.chat?.latestTradeEvent || '' };
    return true;
  }

  async function loadChats(options = {}) {
    const skipRender = !!options.skipRender;
    state.chatsLoading = true;
    state.chatError = '';
    if (!skipRender) render();
    try {
      const data = await api('/api/group-chats');
      state.chats = Array.isArray(data.chats) ? data.chats : [];
    } catch (error) {
      state.chatError = error?.message || 'Unable to load chat rooms.';
    } finally {
      state.chatsLoading = false;
      if (!skipRender) render();
    }
  }

  async function openChat(groupId, options = {}) {
    try {
      const shouldMarkRead = options.markRead !== false;
      const shouldRefreshList = options.refreshList !== false;
      const feed = root.querySelector('#utility-chat-feed');
      const wasNearBottom = feed ? (feed.scrollHeight - feed.scrollTop - feed.clientHeight) < 100 : true;
      const data = await api(`/api/group-chats/${encodeURIComponent(groupId)}/messages`);
      state.activeChatByGroupId[groupId] = data;
      state.activeChatGroupId = groupId;
      state.selectedGroupId = groupId;
      ensureComposerUi(groupId);
      hydrateComposerSuggestionCache(groupId, data.suggestionsSeed || {});
      if (!Object.prototype.hasOwnProperty.call(state.draftByGroupId, groupId)) state.draftByGroupId[groupId] = '';
      const composerUi = ensureComposerUi(groupId);
      if (composerUi) composerUi.lastDraft = String(state.draftByGroupId[groupId] || '');
      if (shouldMarkRead) await api(`/api/group-chats/${encodeURIComponent(groupId)}/read`, { method: 'POST' });
      if (shouldRefreshList) await loadChats({ skipRender: true });
      render();
      maybeScrollChatToBottom(wasNearBottom);
    } catch (_) {}
  }

  async function loadWatchlists() {
    state.watchlistsLoading = true;
    state.watchlistError = '';
    render();
    try {
      const data = await api('/api/watchlists');
      state.watchlists = Array.isArray(data.watchlists) ? data.watchlists : [];
      if (!state.selectedWatchlistId && state.watchlists[0]) state.selectedWatchlistId = state.watchlists[0].id;
      if (state.selectedWatchlistId) {
        const market = await api(`/api/watchlists/${encodeURIComponent(state.selectedWatchlistId)}/market-data`);
        state.selectedWatchlistRows = Array.isArray(market.rows) ? market.rows : [];
      }
    } catch (error) {
      state.watchlistError = error?.message || 'Unable to load watchlists.';
    } finally {
      state.watchlistsLoading = false;
      render();
    }
  }

  root.addEventListener('click', async (event) => {
    const toggle = event.target.closest('.utility-sidebar__icon,.utility-sidebar__tab');
    if (toggle?.dataset.tab) {
      handleTabToggle(toggle.dataset.tab);
      return;
    }
    if (event.target.dataset.action === 'close') {
      setUtilitySidebarOpen(false);
      render();
      return;
    }
    const chatRow = event.target.closest('[data-group-id]');
    if (chatRow) return openChat(chatRow.dataset.groupId);

    const action = event.target.dataset.action;
    if (!action || !state.activeChatGroupId) return;
    const groupId = state.activeChatGroupId;
    if (action === 'back') {
      state.activeChatGroupId = '';
      render();
      return;
    }
    if (action === 'lock' || action === 'unlock') {
      await api(`/api/group-chats/${encodeURIComponent(groupId)}/${action}`, { method: 'POST' });
      return openChat(groupId);
    }
    if (action === 'unpin') {
      await api(`/api/group-chats/${encodeURIComponent(groupId)}/unpin`, { method: 'POST' });
      return openChat(groupId);
    }
    if (action === 'pin' && event.target.dataset.mid) {
      await api(`/api/group-chats/${encodeURIComponent(groupId)}/pin/${encodeURIComponent(event.target.dataset.mid)}`, { method: 'POST' });
      return openChat(groupId);
    }
    if (action === 'delete' && event.target.dataset.mid) {
      await api(`/api/group-chats/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(event.target.dataset.mid)}`, { method: 'DELETE' });
      return openChat(groupId);
    }
    if (action === 'open-group-watchlist' && state.activeChatGroupId) {
      const target = state.watchlists.find((item) => item.scope === 'group' && item.tradingGroupId === state.activeChatGroupId);
      if (target) {
        state.activeUtilitySidebarTab = 'watchlist';
        state.selectedWatchlistId = target.id;
        setUtilitySidebarOpen(true);
        await loadWatchlists();
      }
      return;
    }
    const activeChat = getActiveChatData();
    if (action === 'size-trade' && event.target.dataset.mid && activeChat?.messages?.length) {
      const message = activeChat.messages.find((item) => item.id === event.target.dataset.mid);
      const meta = message?.metadata || {};
      if (!meta?.ticker || !Number.isFinite(Number(meta.entryPrice)) || !Number.isFinite(Number(meta.stopPrice))) return;
      const payload = {
        source: 'chat_trade_share',
        groupId: state.activeChatGroupId,
        ticker: String(meta.ticker || '').toUpperCase(),
        side: String(meta.direction || 'long').toUpperCase(),
        entryPrice: Number(meta.entryPrice),
        stopPrice: Number(meta.stopPrice),
        riskPercent: Number.isFinite(Number(meta.riskPercent)) ? Number(meta.riskPercent) : undefined
      };
      localStorage.setItem(ALERT_RISK_PREFILL_STORAGE_KEY, JSON.stringify(payload));
      window.location.href = '/index.html?focus=risk';
      return;
    }
    if (action === 'remove-symbol' && state.selectedWatchlistId && event.target.dataset.itemId) {
      await api(`/api/watchlists/${encodeURIComponent(state.selectedWatchlistId)}/items/${encodeURIComponent(event.target.dataset.itemId)}`, { method: 'DELETE' });
      return loadWatchlists();
    }
    if (action === 'open-attachment' && event.target.dataset.url) {
      window.open(event.target.dataset.url, '_blank', 'noopener');
      return;
    }
    if (action === 'attach-trade-card') {
      const selectedTrade = await openChatTradeCardPicker(state.activeChatGroupId);
      if (!selectedTrade?.tradeId || !state.activeChatGroupId) return;
      await api(`/api/group-chats/${encodeURIComponent(state.activeChatGroupId)}/share-trade/${encodeURIComponent(selectedTrade.tradeId)}`, { method: 'POST' });
      await openChat(state.activeChatGroupId);
      return;
    }
    if (action === 'pick-suggestion' && event.target.dataset.index !== undefined) {
      selectComposerSuggestion(Number(event.target.dataset.index));
      return;
    }
  });

  root.addEventListener('mousedown', (event) => {
    const suggestionButton = event.target.closest('[data-action="pick-suggestion"]');
    if (!suggestionButton) return;
    event.preventDefault();
  });

  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-action="send"]');
    if (!form || !state.activeChatGroupId) return;
    event.preventDefault();
    const composerUi = ensureComposerUi(state.activeChatGroupId);
    const rawDraft = String(state.draftByGroupId[state.activeChatGroupId] || '');
    const content = rawDraft.trim();
    if (!content) {
      chatDebug('submit-blocked-empty', { groupId: state.activeChatGroupId, draft: rawDraft });
      return;
    }
    if (composerUi) {
      composerUi.isSending = true;
      composerUi.sendPhase = 'sending';
      composerUi.sendError = '';
      composerUi.announcement = !!form.querySelector('input[name="announcement"]')?.checked;
    }
    render();
    const messageType = composerUi?.announcement ? 'leader_announcement' : 'user_message';
    const selectedEntities = reconcileComposerEntities(rawDraft, composerUi?.selectedEntities || []);
    if (composerUi) composerUi.selectedEntities = selectedEntities;
    const selectedMentions = selectedEntities
      .filter((entity) => entity.type === 'mention')
      .map((entity) => ({
        type: entity.mentionType,
        targetId: entity.targetId || null,
        displayText: entity.displayText
      }));
    const payload = { content, rawText: rawDraft, messageType, entities: selectedEntities, mentions: selectedMentions };
    chatDebug('submit-attempt', {
      groupId: state.activeChatGroupId,
      draft: rawDraft,
      hasSuggestionsOpen: !root.querySelector('#utility-chat-suggestions')?.classList.contains('hidden'),
      payload
    });
    try {
      chatDebug('submit-fetch-started', { groupId: state.activeChatGroupId, payload });
      const sendResponse = await api(`/api/group-chats/${encodeURIComponent(state.activeChatGroupId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      chatDebug('submit-response', { groupId: state.activeChatGroupId, response: sendResponse });
      const appendResult = upsertMessageInActiveChat(state.activeChatGroupId, sendResponse?.message || null);
      chatDebug('submit-ui-append', {
        groupId: state.activeChatGroupId,
        appended: appendResult,
        messageId: sendResponse?.message?.id || null,
        visibleCount: state.activeChatByGroupId[state.activeChatGroupId]?.messages?.length || 0
      });
      state.draftByGroupId[state.activeChatGroupId] = '';
      if (composerUi) {
        composerUi.selectedEntities = [];
        composerUi.sendError = '';
        composerUi.lastDraft = '';
        composerUi.sendPhase = 'success';
      }
      await publishTyping(false);
      render();
      maybeScrollChatToBottom(true);
      openChat(state.activeChatGroupId, { markRead: false, refreshList: false });
      window.setTimeout(() => focusComposer(state.activeChatGroupId, { atEnd: true }), 0);
    } catch (error) {
      chatDebug('submit-failed', {
        groupId: state.activeChatGroupId,
        status: error?.status || null,
        response: error?.body || null,
        message: error?.message || 'Request failed'
      });
      console.error('[utility-chat] send-failed', error?.status || '', error?.body || error);
      if (composerUi) {
        composerUi.sendError = classifySendError(error);
        composerUi.sendPhase = 'error';
      }
      const textarea = root.querySelector('.utility-chat-composer textarea');
      textarea?.focus();
    } finally {
      if (composerUi) composerUi.isSending = false;
      render();
      chatDebug('submit-final-state', {
        groupId: state.activeChatGroupId,
        phase: composerUi?.sendPhase || 'idle',
        hasError: !!composerUi?.sendError,
        draftLength: (state.draftByGroupId[state.activeChatGroupId] || '').length
      });
      if (composerUi?.sendError) {
        window.setTimeout(() => {
          const textarea = root.querySelector('.utility-chat-composer textarea');
          textarea?.focus();
        }, 0);
      } else if (composerUi) {
        composerUi.sendPhase = 'idle';
      }
    }
  });

  root.addEventListener('keydown', async (event) => {
    const textarea = event.target.closest('.utility-chat-composer textarea');
    if (!textarea) return;
    const suggestionsWrap = root.querySelector('#utility-chat-suggestions');
    const suggestionsOpen = !!(suggestionsWrap && !suggestionsWrap.classList.contains('hidden'));
    const composerUi = ensureComposerUi(state.activeChatGroupId);
    if (suggestionsOpen && composerUi?.suggestions?.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const max = composerUi.suggestions.length - 1;
        const dir = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = Math.max(0, Math.min(max, Number(composerUi.suggestionIndex || 0) + dir));
        composerUi.suggestionIndex = nextIndex;
        suggestionsWrap.querySelectorAll('button[data-action="pick-suggestion"]').forEach((button, idx) => {
          button.classList.toggle('is-active', idx === nextIndex);
        });
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        event.preventDefault();
        if (selectComposerSuggestion(Number(composerUi.suggestionIndex || 0))) return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      textarea.closest('form')?.requestSubmit();
      return;
    }
    if (event.key === 'Escape') {
      const wrap = root.querySelector('#utility-chat-suggestions');
      if (wrap) {
        wrap.classList.add('hidden');
        wrap.innerHTML = '';
      }
      return;
    }
    if (typingDebounce) window.clearTimeout(typingDebounce);
    if (state.activeChatGroupId) {
      state.draftByGroupId[state.activeChatGroupId] = textarea.value;
      const composerUi = ensureComposerUi(state.activeChatGroupId);
      if (composerUi) composerUi.lastDraft = textarea.value;
    }
    publishTyping(true);
    typingDebounce = window.setTimeout(() => publishTyping(false), 4500);
    window.setTimeout(() => updateComposerSuggestions(textarea), 0);
  });

  root.addEventListener('input', (event) => {
    const textarea = event.target.closest('.utility-chat-composer textarea');
    if (!textarea || !state.activeChatGroupId) return;
    const composerUi = ensureComposerUi(state.activeChatGroupId);
    const previousValue = String(composerUi?.lastDraft || '');
    const nextValue = textarea.value;
    const delta = nextValue.length - previousValue.length;
    const pivot = Math.max(0, (textarea.selectionStart || 0) - Math.max(0, delta));
    if (composerUi) {
      composerUi.selectedEntities = shiftComposerEntities(composerUi.selectedEntities, pivot, delta);
      composerUi.selectedEntities = reconcileComposerEntities(nextValue, composerUi.selectedEntities);
      composerUi.lastDraft = nextValue;
    }
    state.draftByGroupId[state.activeChatGroupId] = textarea.value;
    window.setTimeout(() => updateComposerSuggestions(textarea), 0);
  });

  root.addEventListener('focusin', (event) => {
    const textarea = event.target.closest('.utility-chat-composer textarea');
    if (!textarea) return;
    chatDebug('composer-focus', { groupId: state.activeChatGroupId });
  });

  root.addEventListener('focusout', (event) => {
    const textarea = event.target.closest('.utility-chat-composer textarea');
    if (!textarea) return;
    chatDebug('composer-blur', { groupId: state.activeChatGroupId });
  });

  root.addEventListener('change', (event) => {
    const announcement = event.target.closest('.utility-chat-composer input[name="announcement"]');
    if (!announcement || !state.activeChatGroupId) return;
    const composerUi = ensureComposerUi(state.activeChatGroupId);
    if (composerUi) composerUi.announcement = !!announcement.checked;
  });

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value || '';
    render();
  });

  root.addEventListener('change', async (event) => {
    if (event.target.id === 'utility-watchlist-select') {
      state.selectedWatchlistId = event.target.value;
      return loadWatchlists();
    }
  });

  root.addEventListener('click', async (event) => {
    if (event.target.id !== 'utility-watchlist-add-btn') return;
    const input = root.querySelector('#utility-watchlist-add');
    const ticker = String(input?.value || '').trim();
    if (!ticker || !state.selectedWatchlistId) return;
    await api(`/api/watchlists/${encodeURIComponent(state.selectedWatchlistId)}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker })
    });
    if (input) input.value = '';
    await loadWatchlists();
  });

  window.VeracityUtilitySidebar = {
    async shareTradeToGroupChats(tradeId) {
      if (!tradeId) throw new Error('Missing tradeId');
      const chatsData = await api('/api/group-chats');
      const chats = Array.isArray(chatsData?.chats)
        ? chatsData.chats.filter((chat) => chat?.groupId && chat?.groupName)
        : [];
      if (!chats.length) throw new Error('No eligible group chats found.');
      const selected = await openTradeSharePicker(chats);
      if (!selected?.groupId) return null;
      await api(`/api/group-chats/${encodeURIComponent(selected.groupId)}/share-trade/${encodeURIComponent(tradeId)}`, { method: 'POST' });
      showToast(`Shared to ${selected.groupName}`, 'success');
      return selected.groupName;
    }
  };

  render();
  window.setTimeout(() => {
    if (state.chatsInitialized || document.hidden) return;
    state.chatsInitialized = true;
    loadChats({ skipRender: true }).finally(render);
  }, 1200);
  const chatListRefreshChannel = window.AppRefreshCoordinator?.createChannel('utility-chat-list');
  const openChatRefreshChannel = window.AppRefreshCoordinator?.createChannel('utility-chat-open-group');
  window.setInterval(() => {
    if (!state.chatsInitialized) return;
    if (chatListRefreshChannel) {
      chatListRefreshChannel.run(loadChats, { reason: 'chat-list-poll', minIntervalMs: 14000, allowWhenHidden: false }).catch(() => {});
      return;
    }
    if (!document.hidden) loadChats();
  }, 15000);
  window.setInterval(() => {
    if (!state.chatsInitialized) return;
    if (!state.activeChatGroupId || !state.isUtilitySidebarOpen || state.activeUtilitySidebarTab !== 'chat') return;
    if (openChatRefreshChannel) {
      openChatRefreshChannel.run(
        () => openChat(state.activeChatGroupId, { markRead: false, refreshList: false }),
        { reason: 'open-chat-poll', minIntervalMs: 4500, allowWhenHidden: false }
      ).catch(() => {});
      return;
    }
    if (!document.hidden) openChat(state.activeChatGroupId, { markRead: false, refreshList: false });
  }, 5000);
})();
