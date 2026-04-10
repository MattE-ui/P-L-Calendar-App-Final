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

(function initOwnerActions() {
  const adminBtn = document.getElementById('site-announcements-admin-btn');
  const devtoolsBtn = document.getElementById('devtools-btn');
  const ownerGroup = document.getElementById('app-shell-owner-tools');
  if (!adminBtn || !devtoolsBtn || !ownerGroup) return;
  fetch('/api/profile', { credentials: 'include' })
    .then((res) => (res.ok ? res.json() : null))
    .then((profile) => {
      const showOwnerTools = !!profile?.isOwner;
      adminBtn.classList.toggle('is-hidden', !showOwnerTools);
      devtoolsBtn.classList.toggle('is-hidden', !showOwnerTools);
      ownerGroup.classList.toggle('is-hidden', !showOwnerTools);
    })
    .catch(() => {
      adminBtn.classList.add('is-hidden');
      devtoolsBtn.classList.add('is-hidden');
      ownerGroup.classList.add('is-hidden');
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
    activeChat: null,
    watchlists: [],
    selectedWatchlistId: '',
    selectedWatchlistRows: [],
    query: '',
    chatsLoading: false,
    watchlistsLoading: false,
    chatError: '',
    watchlistError: ''
  };
  const ALERT_RISK_PREFILL_STORAGE_KEY = 'plc-risk-calculator-prefill-v1';

  const body = root.querySelector('#utility-sidebar-body');
  const searchInput = root.querySelector('#utility-sidebar-search');
  const panelEl = root.querySelector('.utility-sidebar__panel');

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'include', ...opts });
    if (res.status === 401) throw new Error('Unauthenticated');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function setUtilitySidebarOpen(nextOpen) {
    state.isUtilitySidebarOpen = !!nextOpen;
    root.classList.toggle('is-open', state.isUtilitySidebarOpen);
    panelEl.setAttribute('aria-hidden', String(!state.isUtilitySidebarOpen));
    if (!state.isUtilitySidebarOpen) {
      state.activeChat = null;
    }
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
    if (state.activeUtilitySidebarTab === 'watchlist' && state.isUtilitySidebarOpen) {
      loadWatchlists();
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

  function renderChatMessageBody(msg) {
    const type = getMessageType(msg);
    if (type === 'trade_share') return renderTradeShareMessage(msg);
    if (type === 'trade_event_system') return renderTradeEventSystemMessage(msg);
    if (type === 'leader_announcement') return `<div class="utility-chat-msg__type">Leader announcement</div><p>${msg.content}</p>`;
    return `<p>${msg.content}</p>`;
  }

  function renderChatRoom() {
    const chat = state.activeChat;
    if (!chat) return;
    const pinned = chat.pinnedMessage;
    const messages = chat.messages || [];
    body.innerHTML = `
      <div class="utility-chat-room">
        <div class="utility-chat-room__header">
          <button class="utility-link-btn" data-action="back" type="button">← Chats</button>
          <div class="utility-chat-room__title-wrap">
            <h4>${chat.chat.groupName}</h4>
            <p>${chat.chat.participantCount || 0} participants${chat.chat.isLocked ? ' · Locked by leader' : ''}</p>
          </div>
          ${chat.chat.canModerate ? `<div class="utility-chat-room__mod"><button data-action="${chat.chat.isLocked ? 'unlock' : 'lock'}" type="button">${chat.chat.isLocked ? 'Unlock room' : 'Lock room'}</button>${chat.chat.pinnedMessageId ? '<button data-action="unpin" type="button">Unpin note</button>' : ''}</div>` : ''}
        </div>
        <div class="utility-chat-context-strip">
          <span>${chat.chat.groupName}</span>
          <span>${chat.chat.participantCount || 0} members</span>
          ${chat.chat.latestTradeEvent ? `<span>${chat.chat.latestTradeEvent}</span>` : '<span>No recent trade event</span>'}
          ${chat.chat.hasGroupWatchlist ? '<button data-action="open-group-watchlist" type="button">Open group watchlist</button>' : ''}
        </div>
        ${pinned ? `<div class="utility-chat-pinned"><span class="utility-chat-pinned__label">Pinned note</span><strong>${pinned.senderNickname}</strong><p>${pinned.content}</p></div>` : ''}
        <div class="utility-chat-feed">
          ${messages.length ? messages.map((msg, index) => {
            const prev = messages[index - 1];
            const type = getMessageType(msg);
            const sameSender = prev && prev.senderNickname === msg.senderNickname;
            const sameType = prev && getMessageType(prev) === type;
            const isGrouped = !!(sameSender && sameType);
            const createdAtMs = new Date(msg.createdAt).getTime();
            const isFresh = Number.isFinite(createdAtMs) && (Date.now() - createdAtMs) <= 12000;
            const senderLabel = !sameSender ? `<div class="utility-chat-msg__sender">${msg.senderNickname}</div>` : '';
            return `
            <article class="utility-chat-msg ${isLeaderAnnouncement(msg) ? 'is-announcement' : ''} ${type === 'trade_share' ? 'is-trade-share' : ''} ${type === 'trade_event_system' ? 'is-trade-event-system' : ''} ${isGrouped ? 'is-grouped' : 'is-group-break'} ${isFresh ? 'is-fresh' : ''}">
              ${senderLabel}
              <header><strong>${msg.senderNickname}</strong><span>${new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></header>
              ${renderChatMessageBody(msg)}
              ${chat.chat.canModerate ? `<div class="utility-chat-msg__actions"><button data-action="pin" data-mid="${msg.id}" type="button">Pin</button><button data-action="delete" data-mid="${msg.id}" type="button">Delete</button></div>` : ''}
            </article>
          `;
          }).join('') : '<div class="utility-empty"><strong>No messages yet</strong><p>Start the desk conversation with the first update.</p></div>'}
        </div>
        <form class="utility-chat-composer" data-action="send">
          ${chat.chat.canSend ? '' : '<div class="utility-chat-locked">Chat is locked. Only moderators can post right now.</div>'}
          <textarea name="content" placeholder="Share market context, execution notes, or risk updates…" ${!chat.chat.canSend ? 'disabled' : ''}></textarea>
          <div>
            ${chat.chat.canModerate ? '<label class="utility-chat-composer__announcement"><input type="checkbox" name="announcement"> Post as leader announcement</label>' : '<span></span>'}
            <button type="submit" ${!chat.chat.canSend ? 'disabled' : ''}>Send</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderChats() {
    if (state.activeChat) return renderChatRoom();
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
          <button class="utility-chat-row ${chat.unreadCount ? 'has-unread' : ''} ${state.activeChat?.chat?.groupId === chat.groupId ? 'is-active' : ''}" data-group-id="${chat.groupId}" type="button">
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
    if (state.activeUtilitySidebarTab === 'chat') renderChats();
    else renderWatchlists();
    renderUnread();
  }

  async function loadChats() {
    state.chatsLoading = true;
    state.chatError = '';
    render();
    try {
      const data = await api('/api/group-chats');
      state.chats = Array.isArray(data.chats) ? data.chats : [];
    } catch (error) {
      state.chatError = error?.message || 'Unable to load chat rooms.';
    } finally {
      state.chatsLoading = false;
      render();
    }
  }

  async function openChat(groupId) {
    try {
      const data = await api(`/api/group-chats/${encodeURIComponent(groupId)}/messages`);
      state.activeChat = data;
      state.selectedGroupId = groupId;
      await api(`/api/group-chats/${encodeURIComponent(groupId)}/read`, { method: 'POST' });
      await loadChats();
      render();
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
    if (!action || !state.activeChat?.chat?.groupId) return;
    const groupId = state.activeChat.chat.groupId;
    if (action === 'back') {
      state.activeChat = null;
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
    if (action === 'open-group-watchlist' && state.activeChat?.chat?.groupId) {
      const target = state.watchlists.find((item) => item.scope === 'group' && item.tradingGroupId === state.activeChat.chat.groupId);
      if (target) {
        state.activeUtilitySidebarTab = 'watchlist';
        state.selectedWatchlistId = target.id;
        setUtilitySidebarOpen(true);
        await loadWatchlists();
      }
      return;
    }
    if (action === 'size-trade' && event.target.dataset.mid && state.activeChat?.messages?.length) {
      const message = state.activeChat.messages.find((item) => item.id === event.target.dataset.mid);
      const meta = message?.metadata || {};
      if (!meta?.ticker || !Number.isFinite(Number(meta.entryPrice)) || !Number.isFinite(Number(meta.stopPrice))) return;
      const payload = {
        source: 'chat_trade_share',
        groupId: state.activeChat.chat.groupId,
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
  });

  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-action="send"]');
    if (!form || !state.activeChat?.chat?.groupId) return;
    event.preventDefault();
    const fd = new FormData(form);
    const content = String(fd.get('content') || '').trim();
    if (!content) return;
    const messageType = fd.get('announcement') ? 'leader_announcement' : 'user_message';
    await api(`/api/group-chats/${encodeURIComponent(state.activeChat.chat.groupId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, messageType })
    });
    form.reset();
    await openChat(state.activeChat.chat.groupId);
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
      const chats = Array.isArray(chatsData?.chats) ? chatsData.chats : [];
      if (!chats.length) throw new Error('No eligible group chats found.');
      const optionsText = chats.map((chat, index) => `${index + 1}. ${chat.groupName}`).join('\n');
      const pick = window.prompt(`Share trade to which group?\n${optionsText}`);
      if (!pick) return null;
      const selected = chats[Math.max(0, Number(pick) - 1)];
      if (!selected?.groupId) throw new Error('Invalid group selection.');
      await api(`/api/group-chats/${encodeURIComponent(selected.groupId)}/share-trade/${encodeURIComponent(tradeId)}`, { method: 'POST' });
      return selected.groupName;
    }
  };

  loadChats();
  render();
  window.setInterval(loadChats, 15000);
  window.setInterval(() => {
    if (state.activeChat?.chat?.groupId && state.isUtilitySidebarOpen && state.activeUtilitySidebarTab === 'chat') {
      openChat(state.activeChat.chat.groupId);
    }
  }, 5000);
})();
