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
        ${navItems.map((item) => `<a id="${item.key}-btn" class="app-shell-nav__link ${activeKey === item.key ? 'is-active' : ''}" href="${item.href}">${item.label}</a>`).join('')}
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
  const isGuest = (sessionStorage.getItem('guestMode') === 'true' || localStorage.getItem('guestMode') === 'true')
    && typeof window.handleGuestRequest === 'function';
  if (isGuest) return;

  const state = {
    seenIncoming: new Set(),
    activeRequestId: '',
    pollTimer: null,
    actionBusy: false,
    hiddenByUser: new Set(),
    nicknameRequired: false
  };

  function createAlertShell() {
    if (document.getElementById('global-friend-request-alert')) return;
    const shell = document.createElement('aside');
    shell.id = 'global-friend-request-alert';
    shell.className = 'social-global-alert hidden';
    shell.setAttribute('aria-live', 'polite');
    document.body.appendChild(shell);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'include', ...opts });
    if (res.status === 401) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }


  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function dismissActive() {
    state.activeRequestId = '';
    const shell = document.getElementById('global-friend-request-alert');
    if (shell) {
      shell.classList.add('hidden');
      shell.innerHTML = '';
    }
  }

  async function handleAction(id, action) {
    if (!id || state.actionBusy) return;
    state.actionBusy = true;
    try {
      await api(`/api/social/friends/requests/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      state.hiddenByUser.add(id);
      dismissActive();
      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('social:friend-requests-updated', { detail: { action, requestId: id } }));
      }
    } catch (_error) {
      // Keep unobtrusive: we silently ignore here and poll will continue.
    } finally {
      state.actionBusy = false;
      pollOnce();
    }
  }

  function renderRequest(request) {
    createAlertShell();
    const shell = document.getElementById('global-friend-request-alert');
    if (!shell || !request?.id) return;
    state.activeRequestId = request.id;
    shell.classList.remove('hidden');
    shell.innerHTML = `
      <div class="social-global-alert__title">Friend request</div>
      <div class="social-global-alert__body"><strong>${request.counterparty_nickname || 'A trader'}</strong> sent you a friend request.</div>
      <div class="social-global-alert__actions">
        <button type="button" class="primary" data-social-alert-action="accept">Accept</button>
        <button type="button" class="ghost" data-social-alert-action="decline">Decline</button>
        <button type="button" class="ghost" data-social-alert-action="dismiss">Dismiss</button>
      </div>
    `;
    shell.querySelector('[data-social-alert-action="accept"]')?.addEventListener('click', () => handleAction(request.id, 'accept'));
    shell.querySelector('[data-social-alert-action="decline"]')?.addEventListener('click', () => handleAction(request.id, 'decline'));
    shell.querySelector('[data-social-alert-action="dismiss"]')?.addEventListener('click', () => {
      state.hiddenByUser.add(request.id);
      dismissActive();
    });
  }

  function pickNewIncoming(incoming) {
    for (const request of incoming) {
      if (!request?.id || request.status !== 'pending') continue;
      if (state.hiddenByUser.has(request.id)) continue;
      if (!state.seenIncoming.has(request.id)) return request;
    }
    return null;
  }

  async function pollOnce() {
    if (document.hidden) return;
    try {
      const me = await api('/api/social/me');
      if (!me) {
        stopPolling();
        dismissActive();
        return;
      }
      state.nicknameRequired = !!me.nickname_required;
      if (state.nicknameRequired) {
        dismissActive();
        return;
      }
      const payload = await api('/api/social/friends/requests');
      if (!payload) return;
      const incoming = Array.isArray(payload.incoming) ? payload.incoming : [];
      const pendingIds = new Set(incoming.filter(item => item?.status === 'pending').map(item => item.id));
      state.seenIncoming = new Set([...state.seenIncoming].filter(id => pendingIds.has(id)));
      if (state.activeRequestId && !pendingIds.has(state.activeRequestId)) {
        dismissActive();
      }
      const next = pickNewIncoming(incoming);
      incoming.forEach(item => { if (item?.id) state.seenIncoming.add(item.id); });
      if (next && !state.activeRequestId) {
        renderRequest(next);
      }
    } catch (_error) {
      // keep polling resilient and quiet
    }
  }

  pollOnce();
  state.pollTimer = window.setInterval(pollOnce, 20000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollOnce();
  });
  window.addEventListener('beforeunload', () => {
    stopPolling();
  });
})();
