(function initGlobalHeader() {
  if (document.getElementById('global-app-header')) return;

  const path = window.location.pathname || '/';
  const isDashboardRoute = path === '/' || path.endsWith('/index.html');
  const activeKey = (() => {
    if (path.endsWith('/analytics.html')) return 'analytics';
    if (path.endsWith('/trades.html')) return 'trades';
    if (path.endsWith('/transactions.html')) return 'portfolio';
    if (path.endsWith('/social.html')) return 'social';
    if (path.endsWith('/profile.html')) return 'profile';
    if (isDashboardRoute) return 'dashboard';
    return '';
  })();

  const navItems = [
    { key: 'dashboard', label: 'Dashboard', href: '/' },
    { key: 'trades', label: 'Trades', href: '/trades.html' },
    { key: 'analytics', label: 'Analytics', href: '/analytics.html' },
    { key: 'portfolio', label: 'Transactions', href: '/transactions.html' },
    { key: 'social', label: 'Social', href: '/social.html' },
    { key: 'profile', label: 'Profile', href: '/profile.html' }
  ];

  const header = document.createElement('header');
  header.id = 'global-app-header';
  header.className = 'app-shell-header';

  header.innerHTML = `
    <div class="app-shell-header__inner">
      <a class="app-shell-brand" href="/" aria-label="Veracity dashboard home">
        <img class="app-shell-brand__logo" src="static/veracity-logo.png" alt="Veracity Trading Suite">
      </a>
      <nav class="app-shell-nav" aria-label="Primary">
        ${navItems.map((item) => {
          const labelHtml = item.key === 'social'
            ? `${item.label}<span id="social-nav-pending-badge" class="social-nav-pending-badge hidden" aria-live="polite" aria-label="Pending incoming friend requests"></span>`
            : item.label;
          return `<a id="${item.key}-btn" class="app-shell-nav__link ${activeKey === item.key ? 'is-active' : ''}" href="${item.href}">${labelHtml}</a>`;
        }).join('')}
      </nav>
      <div class="app-shell-actions">
        <button id="quick-settings-btn" class="ghost app-shell-action-btn" type="button">Settings</button>
        <button id="devtools-btn" class="ghost app-shell-action-btn is-hidden" type="button">Devtools</button>
        <button id="logout-btn" class="ghost app-shell-action-btn" type="button">Logout</button>
      </div>
    </div>
  `;

  document.body.prepend(header);
  document.body.classList.add('with-app-shell-header');
})();

(function initFriendRequestAlertPolling() {
  const SOCIAL_SYNC_EVENT = 'social:state-changed';
  const SOCIAL_REFRESH_EVENT = 'social:refresh-requested';

  function isGuestSession() {
    return (sessionStorage.getItem('guestMode') === 'true' || localStorage.getItem('guestMode') === 'true')
      && typeof window.handleGuestRequest === 'function';
  }

  function createSocialRequestSync() {
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
      state.pollTimer = window.setInterval(() => {
        if (!document.hidden) refresh('poll');
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
    seededAcceptedRequestIds: false
  };

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

  renderFromSharedState();
  window.addEventListener(SOCIAL_SYNC_EVENT, renderFromSharedState);
})();
