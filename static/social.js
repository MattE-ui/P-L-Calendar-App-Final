(() => {
  if (window.__veracitySocialPageInitialized) {
    // Defensive guard: tolerate accidental duplicate script inclusion without re-binding listeners.
    return;
  }
  window.__veracitySocialPageInitialized = true;

const SOCIAL_SETTING_KEYS = [
  'leaderboard_enabled',
  'trade_sharing_enabled',
  'allow_friend_requests',
  'share_open_trades',
  'share_closed_trades',
  'show_pnl_percent',
  'show_pnl_currency',
  'show_position_size',
  'leaderboard_visibility',
  'trade_sharing_scope',
  'leaderboard_data_source'
];

const LEADERBOARD_PERIODS = ['7D', '30D', '90D', 'YTD', 'ALL'];
const LEADERBOARD_MODES = ['trade', 'account'];
const DEFAULT_LEADERBOARD_PERIOD = '30D';
const DEFAULT_LEADERBOARD_MODE = 'trade';

const DEFAULT_SOCIAL_SETTINGS = {
  leaderboard_enabled: false,
  trade_sharing_enabled: false,
  allow_friend_requests: false,
  share_open_trades: false,
  share_closed_trades: false,
  show_pnl_percent: true,
  show_pnl_currency: false,
  show_position_size: false,
  leaderboard_visibility: 'private',
  trade_sharing_scope: 'private',
  leaderboard_data_source: 'auto',
  verification_status: 'none',
  verification_source: null
};

const socialState = {
  loading: true,
  profile: null,
  settings: null,
  initialSettings: null,
  isSaving: false,
  isRegenerating: false,
  isGuest: false,
  friendsLoading: false,
  friendsError: '',
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  acceptedOutgoingRequests: [],
  addFriendBusy: false,
  addFriendCode: '',
  requestActionIds: new Set(),
  friendActionIds: new Set(),
  nicknameRequired: false,
  nickname: '',
  friendPollTimer: null,
  leaderboardLoading: false,
  leaderboardError: '',
  leaderboardEntries: [],
  leaderboardPeriod: DEFAULT_LEADERBOARD_PERIOD,
  leaderboardMode: DEFAULT_LEADERBOARD_MODE,
  leaderboardDataSourceOptions: [],
  tradeGroupsLoading: false,
  tradeGroups: [],
  selectedTradeGroupId: '',
  selectedTradeGroupMembers: [],
  selectedTradeGroupAlerts: [],
  selectedTradeGroupPendingInvites: [],
  selectedTradeGroupPositions: [],
  selectedTradeGroupRole: '',
  unreadTradeGroupNotifications: [],
  pendingTradeGroupInvites: [],
  createGroupBusy: false,
  eligibleTradeGroupFriends: [],
  tradeGroupPollTimer: null
};


const initialGroupId = new URLSearchParams(window.location.search).get('group') || '';
if (initialGroupId) {
  socialState.selectedTradeGroupId = initialGroupId;
}

const TRANSIENT_FEEDBACK_TTL_MS = 15000;
const feedbackTimers = new WeakMap();

const SOCIAL_SYNC_EVENT = 'social:state-changed';
const SOCIAL_REFRESH_EVENT = 'social:refresh-requested';

function isGuestSession() {
  return (sessionStorage.getItem('guestMode') === 'true' || localStorage.getItem('guestMode') === 'true')
    && typeof window.handleGuestRequest === 'function';
}

async function socialApi(path, opts = {}) {
  if (isGuestSession()) {
    const data = await window.handleGuestRequest(path, opts);
    if (data?.ok === false) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }
  const res = await fetch(path, { credentials: 'include', ...opts });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Unauthenticated');
  }
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function getEl(id) {
  return document.getElementById(id);
}

function formatVerificationSource(source) {
  switch (source) {
    case 'ibkr':
      return 'IBKR';
    case 'trading212':
      return 'Trading 212';
    case 'platform_locked':
      return 'Platform Locked';
    case 'manual':
      return 'Manual';
    default:
      return source ? String(source).replace(/_/g, ' ') : '';
  }
}

function getVerificationDisplay(status, source) {
  if (status === 'broker_verified') {
    return {
      label: 'Broker Verified',
      badgeClass: 'is-verified',
      sourceLabel: source ? `Source: ${formatVerificationSource(source)}` : '',
      description: 'Calculated from broker-synced account data for trusted verification.'
    };
  }
  if (status === 'platform_verified') {
    return {
      label: 'Platform Verified',
      badgeClass: 'is-platform',
      sourceLabel: source ? `Source: ${formatVerificationSource(source)}` : 'Source: Platform Tracked',
      description: 'Calculated from tracked platform trade history. Eligibility for trusted rankings may depend on this status.'
    };
  }
  return {
    label: 'Unverified',
    badgeClass: 'is-unverified',
    sourceLabel: source ? `Source: ${formatVerificationSource(source)}` : '',
    description: 'Not currently eligible for trusted rankings. You can still keep social features private and opt in later.'
  };
}



function normalizeSocialSettings(settings = {}) {
  const safe = (settings && typeof settings === 'object') ? settings : {};
  return {
    ...DEFAULT_SOCIAL_SETTINGS,
    ...safe
  };
}

function normalizeFriendCode(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function normalizeRequestList(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(item => item && item.status === 'pending');
}

function getRequestUserDisplay(request) {
  if (!request || typeof request !== 'object') return { name: 'Unknown trader', secondary: '' };
  return {
    name: request.counterparty_nickname || 'Unknown trader',
    secondary: request.counterparty_friend_code || ''
  };
}

function createEmptyState(title, detail = '') {
  const empty = document.createElement('div');
  empty.className = 'social-empty-state';

  const titleEl = document.createElement('p');
  titleEl.className = 'social-empty-state-title';
  titleEl.textContent = title;
  empty.appendChild(titleEl);

  if (detail) {
    const detailEl = document.createElement('p');
    detailEl.className = 'social-empty-state-detail';
    detailEl.textContent = detail;
    empty.appendChild(detailEl);
  }

  return empty;
}

function createActionButton(label, tone = 'ghost') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = tone;
  button.textContent = label;
  return button;
}

function createIdentityRow(name, secondary, badge, identity = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'social-row-identity';

  const avatar = window.VeracitySocialAvatar?.createAvatar({
    nickname: name,
    avatar_url: identity.avatar_url,
    avatar_initials: identity.avatar_initials
  }, 'sm');
  if (avatar) wrap.appendChild(avatar);

  const textWrap = document.createElement('div');
  textWrap.className = 'social-row-identity-text';

  const primary = document.createElement('div');
  primary.className = 'social-row-primary';
  primary.textContent = name || 'Unknown trader';
  textWrap.appendChild(primary);

  const meta = document.createElement('div');
  meta.className = 'social-row-meta';

  if (secondary) {
    const secondaryEl = document.createElement('span');
    secondaryEl.textContent = secondary;
    meta.appendChild(secondaryEl);
  }

  if (badge) {
    const badgeEl = document.createElement('span');
    badgeEl.className = 'social-row-badge';
    badgeEl.textContent = badge;
    meta.appendChild(badgeEl);
  }

  if (meta.childElementCount) textWrap.appendChild(meta);
  wrap.appendChild(textWrap);
  return wrap;
}

function normalizeLeaderboardEntry(entry = {}, rank = 0) {
  if (!entry || typeof entry !== 'object') return null;
  const verificationStatus = typeof entry.verification_status === 'string' ? entry.verification_status : 'none';
  return {
    rank: rank + 1,
    nickname: String(entry.nickname || '').trim() || 'Unknown trader',
    avatar_url: entry.avatar_url || '',
    avatar_initials: entry.avatar_initials || '',
    return_pct: Number(entry.return_pct),
    trade_count: Number(entry.trade_count),
    win_rate: Number(entry.win_rate),
    verification_status: verificationStatus,
    verification_source: entry.verification_source || null,
    leaderboard_source: entry.leaderboard_source || null,
    leaderboard_mode: LEADERBOARD_MODES.includes(String(entry.leaderboard_mode || '').toLowerCase())
      ? String(entry.leaderboard_mode).toLowerCase()
      : DEFAULT_LEADERBOARD_MODE
  };
}

function formatReturnPct(value) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatWinRate(value) {
  if (!Number.isFinite(value)) return '';
  const normalized = value <= 1 ? value * 100 : value;
  return `Win ${normalized.toFixed(0)}%`;
}

function modeLabel(mode) {
  return mode === 'account' ? 'Account Performance' : 'Trade Performance';
}

function modeHelperText(mode) {
  return mode === 'account'
    ? 'Rankings based on account equity performance.'
    : 'Rankings based on realized trade performance.';
}

function renderLeaderboardModes() {
  const wrap = getEl('social-leaderboard-modes');
  if (!wrap) return;
  clearNode(wrap);

  LEADERBOARD_MODES.forEach(mode => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'social-period-pill social-mode-pill';
    if (mode === socialState.leaderboardMode) button.classList.add('is-active');
    button.disabled = socialState.leaderboardLoading;
    button.textContent = modeLabel(mode);
    button.setAttribute('aria-pressed', mode === socialState.leaderboardMode ? 'true' : 'false');
    button.addEventListener('click', () => {
      if (socialState.leaderboardLoading || socialState.leaderboardMode === mode) return;
      socialState.leaderboardMode = mode;
      renderLeaderboardSection();
      loadLeaderboard();
    });
    wrap.appendChild(button);
  });
}

function renderLeaderboardFilters() {
  const wrap = getEl('social-leaderboard-periods');
  if (!wrap) return;
  clearNode(wrap);

  LEADERBOARD_PERIODS.forEach(period => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'social-period-pill';
    if (period === socialState.leaderboardPeriod) button.classList.add('is-active');
    button.disabled = socialState.leaderboardLoading;
    button.textContent = period;
    button.setAttribute('aria-pressed', period === socialState.leaderboardPeriod ? 'true' : 'false');
    button.addEventListener('click', () => {
      if (socialState.leaderboardLoading || socialState.leaderboardPeriod === period) return;
      socialState.leaderboardPeriod = period;
      renderLeaderboardSection();
      loadLeaderboard();
    });
    wrap.appendChild(button);
  });
}

function renderLeaderboardSection() {
  const listEl = getEl('social-leaderboard-list');
  const loadingEl = getEl('social-leaderboard-loading');
  const errorEl = getEl('social-leaderboard-error');
  const emptyEl = getEl('social-leaderboard-empty');

  renderLeaderboardModes();
  renderLeaderboardFilters();

  const helperEl = getEl('social-leaderboard-helper');
  if (helperEl) helperEl.textContent = modeHelperText(socialState.leaderboardMode);

  if (loadingEl) loadingEl.classList.toggle('hidden', !socialState.leaderboardLoading);
  if (errorEl) {
    if (socialState.leaderboardError) {
      errorEl.classList.remove('hidden');
      errorEl.textContent = '';
      const title = document.createElement('p');
      title.className = 'social-empty-state-title';
      title.textContent = 'Unable to load leaderboard';
      const detail = document.createElement('p');
      detail.className = 'social-empty-state-detail';
      detail.textContent = socialState.leaderboardError;
      const retry = createActionButton('Retry', 'ghost');
      retry.addEventListener('click', () => loadLeaderboard());
      errorEl.appendChild(title);
      errorEl.appendChild(detail);
      errorEl.appendChild(retry);
    } else {
      errorEl.classList.add('hidden');
      errorEl.textContent = '';
    }
  }

  const hasEntries = Array.isArray(socialState.leaderboardEntries) && socialState.leaderboardEntries.length > 0;
  if (emptyEl) emptyEl.classList.toggle('hidden', socialState.leaderboardLoading || !!socialState.leaderboardError || hasEntries);

  if (!listEl) return;
  clearNode(listEl);
  listEl.classList.toggle('hidden', !hasEntries || !!socialState.leaderboardError);
  if (!hasEntries || socialState.leaderboardError) return;

  socialState.leaderboardEntries.forEach(entry => {
    const row = document.createElement('article');
    row.className = 'social-list-row social-list-row--leaderboard';
    if (entry.rank <= 3) row.classList.add('is-top-rank');

    const left = document.createElement('div');
    left.className = 'social-leaderboard-left';

    const rank = document.createElement('span');
    rank.className = 'social-rank';
    rank.textContent = `#${entry.rank}`;
    left.appendChild(rank);

    left.appendChild(createIdentityRow(entry.nickname, '', '', {
      nickname: entry.nickname,
      avatar_url: entry.avatar_url,
      avatar_initials: entry.avatar_initials
    }));

    const right = document.createElement('div');
    right.className = 'social-leaderboard-right';

    const ret = document.createElement('div');
    ret.className = 'social-leaderboard-return';
    ret.textContent = formatReturnPct(entry.return_pct);
    ret.classList.toggle('is-negative', Number.isFinite(entry.return_pct) && entry.return_pct < 0);
    right.appendChild(ret);

    const verification = getVerificationDisplay(entry.verification_status, entry.verification_source);
    const meta = document.createElement('div');
    meta.className = 'social-row-meta';

    const statusBadge = document.createElement('span');
    statusBadge.className = `social-status-pill ${verification.badgeClass}`;
    statusBadge.textContent = verification.label;
    meta.appendChild(statusBadge);

    if (entry.leaderboard_source) {
      const source = document.createElement('span');
      source.textContent = formatVerificationSource(entry.leaderboard_source);
      meta.appendChild(source);
    }

    const stats = [];
    if (socialState.leaderboardMode === 'account') {
      stats.push('Account performance');
    } else {
      if (Number.isFinite(entry.trade_count)) stats.push(`${entry.trade_count} trades`);
      const winRateLabel = formatWinRate(entry.win_rate);
      if (winRateLabel) stats.push(winRateLabel);
    }
    if (stats.length) {
      const secondary = document.createElement('span');
      secondary.textContent = stats.join(' • ');
      meta.appendChild(secondary);
    }

    right.appendChild(meta);
    row.appendChild(left);
    row.appendChild(right);
    listEl.appendChild(row);
  });
}

async function loadLeaderboard() {
  socialState.leaderboardLoading = true;
  socialState.leaderboardError = '';
  renderLeaderboardSection();

  try {
    const period = LEADERBOARD_PERIODS.includes(socialState.leaderboardPeriod)
      ? socialState.leaderboardPeriod
      : DEFAULT_LEADERBOARD_PERIOD;
    const mode = LEADERBOARD_MODES.includes(socialState.leaderboardMode)
      ? socialState.leaderboardMode
      : DEFAULT_LEADERBOARD_MODE;
    const response = await socialApi(`/api/social/leaderboard?period=${encodeURIComponent(period)}&verification=trusted&mode=${encodeURIComponent(mode)}`);
    const entries = Array.isArray(response?.entries) ? response.entries : [];
    socialState.leaderboardEntries = entries
      .map((entry, index) => normalizeLeaderboardEntry(entry, index))
      .filter(Boolean);
    socialState.leaderboardPeriod = typeof response?.period === 'string' ? response.period.toUpperCase() : period;
    socialState.leaderboardMode = LEADERBOARD_MODES.includes(String(response?.mode || '').toLowerCase())
      ? String(response.mode).toLowerCase()
      : mode;
  } catch (error) {
    socialState.leaderboardEntries = [];
    socialState.leaderboardError = error?.message || 'Please try again in a moment.';
  } finally {
    socialState.leaderboardLoading = false;
    renderLeaderboardSection();
  }
}

function clearNode(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

function setFriendsDisabled(disabled) {
  const areaMessage = getEl('social-friends-disabled');
  if (disabled) {
    if (areaMessage) {
      areaMessage.classList.remove('hidden');
      areaMessage.textContent = socialState.nicknameRequired
        ? 'Set a nickname in Profile to enable friend requests and social actions.'
        : 'Sign in to send and manage friend requests.';
    }
  } else if (areaMessage) {
    areaMessage.classList.add('hidden');
    areaMessage.textContent = '';
  }

  const controls = document.querySelectorAll('#social-add-friend-form input, #social-add-friend-form button');
  controls.forEach(control => {
    control.disabled = disabled || socialState.addFriendBusy || socialState.friendsLoading;
  });
}

function renderFriendSection() {
  const incomingEl = getEl('social-incoming-requests');
  const outgoingEl = getEl('social-outgoing-requests');
  const friendsEl = getEl('social-friends-list');

  clearNode(incomingEl);
  clearNode(outgoingEl);
  clearNode(friendsEl);

  if (socialState.friendsError) {
    const err = createEmptyState('Friend data unavailable', socialState.friendsError);
    err.classList.add('is-error');
    incomingEl?.appendChild(err.cloneNode(true));
    outgoingEl?.appendChild(err.cloneNode(true));
    friendsEl?.appendChild(err);
    return;
  }

  const incoming = socialState.incomingRequests;
  if (!incoming.length) {
    incomingEl?.appendChild(createEmptyState('No incoming requests', 'New requests will appear here.'));
  } else {
    incoming.forEach(request => {
      const row = document.createElement('article');
      row.className = 'social-list-row social-list-row--request';
      const display = getRequestUserDisplay(request);
      row.appendChild(createIdentityRow(display.name, display.secondary, '', { avatar_url: request.counterparty_avatar_url, avatar_initials: request.counterparty_avatar_initials }));

      const actionWrap = document.createElement('div');
      actionWrap.className = 'social-row-actions';
      const busy = socialState.requestActionIds.has(request.id);

      const acceptBtn = createActionButton('Accept', 'primary');
      acceptBtn.disabled = busy || socialState.isGuest || socialState.nicknameRequired;
      acceptBtn.addEventListener('click', () => respondToRequest(request.id, 'accept'));

      const declineBtn = createActionButton('Decline', 'ghost');
      declineBtn.disabled = busy || socialState.isGuest || socialState.nicknameRequired;
      declineBtn.addEventListener('click', () => respondToRequest(request.id, 'decline'));

      actionWrap.append(acceptBtn, declineBtn);
      row.appendChild(actionWrap);
      incomingEl?.appendChild(row);
    });
  }

  const outgoing = socialState.outgoingRequests;
  if (!outgoing.length) {
    outgoingEl?.appendChild(createEmptyState('No outgoing requests', 'Sent requests stay here until accepted or cancelled.'));
  } else {
    outgoing.forEach(request => {
      const row = document.createElement('article');
      row.className = 'social-list-row social-list-row--request';
      const display = getRequestUserDisplay(request);
      row.appendChild(createIdentityRow(display.name, display.secondary, '', { avatar_url: request.counterparty_avatar_url, avatar_initials: request.counterparty_avatar_initials }));

      const cancelBtn = createActionButton('Cancel', 'ghost');
      cancelBtn.disabled = socialState.requestActionIds.has(request.id) || socialState.isGuest || socialState.nicknameRequired;
      cancelBtn.addEventListener('click', () => respondToRequest(request.id, 'cancel'));
      const actionWrap = document.createElement('div');
      actionWrap.className = 'social-row-actions';
      actionWrap.appendChild(cancelBtn);

      row.appendChild(actionWrap);
      outgoingEl?.appendChild(row);
    });
  }

  const friends = socialState.friends;
  if (!friends.length) {
    friendsEl?.appendChild(createEmptyState('No friends added yet', 'Send a friend-code request to build your network.'));
  } else {
    friends.forEach(friend => {
      const row = document.createElement('article');
      row.className = 'social-list-row social-list-row--friend';
      const badge = friend.verification_status === 'broker_verified' ? 'Broker verified'
        : friend.verification_status === 'platform_verified' ? 'Platform verified'
        : '';
      row.appendChild(createIdentityRow(friend.nickname || 'Unknown trader', friend.friend_code || '', badge, { avatar_url: friend.avatar_url, avatar_initials: friend.avatar_initials }));

      const removeBtn = createActionButton('Remove', 'danger outline');
      removeBtn.disabled = socialState.friendActionIds.has(friend.friend_user_id) || socialState.isGuest || socialState.nicknameRequired;
      removeBtn.addEventListener('click', () => removeFriend(friend.friend_user_id));
      const actionWrap = document.createElement('div');
      actionWrap.className = 'social-row-actions';
      actionWrap.appendChild(removeBtn);
      row.appendChild(actionWrap);
      friendsEl?.appendChild(row);
    });
  }
}


function formatInviteTimestamp(value) {
  if (!value) return 'Pending';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Pending';
  return parsed.toLocaleString();
}

async function respondToInviteFromPage(inviteId, action) {
  if (!inviteId || !action) return;
  const feedback = getEl('social-trade-group-notification-feedback');
  try {
    await socialApi(`/api/social/trade-groups/invites/${encodeURIComponent(inviteId)}/${action}`, { method: 'POST' });
    setFeedback(feedback, action === 'accept' ? 'Invitation accepted.' : 'Invitation declined.', 'success');
    await Promise.all([loadTradeGroupNotifications(), loadTradeGroups()]);
    window.dispatchEvent(new CustomEvent(SOCIAL_REFRESH_EVENT));
  } catch (error) {
    setFeedback(feedback, error?.message || 'Unable to update invitation.', 'error');
  }
}



function renderTradeGroupSection() {
  const listEl = getEl('social-trade-groups-list');
  const invitesEl = getEl('social-trade-group-invitations');
  const membersEl = getEl('social-trade-group-members');
  const pendingEl = getEl('social-trade-group-pending-invites');
  const alertsEl = getEl('social-trade-group-alerts');
  const positionsEl = getEl('social-trade-group-positions');
  const headingEl = getEl('social-group-detail-heading');
  const detailPanelEl = getEl('social-trade-group-detail-panel');
  const detailEmptyEl = getEl('social-group-detail-empty');
  const detailContentEl = getEl('social-group-detail-content');
  const friendSelect = getEl('social-group-friend-select');
  const addMemberBtn = getEl('social-group-add-member-btn');
  const announcementBtn = getEl('social-group-announcement-btn');
  const deleteGroupBtn = getEl('social-group-delete-btn');

  const leaderOnlyNodes = document.querySelectorAll('.social-leader-only');

  [listEl, invitesEl, membersEl, pendingEl, alertsEl, positionsEl, detailEmptyEl].forEach(el => { if (el) el.innerHTML = ''; });
  if (headingEl) headingEl.textContent = 'Select a joined group to view members and alerts.';

  const pendingInvites = Array.isArray(socialState.pendingTradeGroupInvites) ? socialState.pendingTradeGroupInvites : [];
  if (!pendingInvites.length) {
    invitesEl?.appendChild(createEmptyState('No pending invitations'));
  } else {
    pendingInvites.forEach(invite => {
      const row = document.createElement('article');
      row.className = 'social-list-row social-list-row--request';
      row.appendChild(createIdentityRow(invite.group_name || 'Unnamed group', formatInviteTimestamp(invite.created_at), 'Invite', {
        avatar_url: invite.leader_avatar_url,
        avatar_initials: invite.leader_avatar_initials
      }));
      const actionWrap = document.createElement('div');
      actionWrap.className = 'social-row-actions';
      const acceptBtn = createActionButton('Accept', 'primary');
      acceptBtn.addEventListener('click', () => respondToInviteFromPage(invite.invite_id, 'accept'));
      const declineBtn = createActionButton('Decline', 'ghost');
      declineBtn.addEventListener('click', () => respondToInviteFromPage(invite.invite_id, 'decline'));
      actionWrap.appendChild(acceptBtn);
      actionWrap.appendChild(declineBtn);
      row.appendChild(actionWrap);
      invitesEl?.appendChild(row);
    });
  }

  const groups = Array.isArray(socialState.tradeGroups) ? socialState.tradeGroups : [];
  if (!groups.length) {
    listEl?.appendChild(createEmptyState('No active trade groups yet', 'Accept an invitation or create a private group to get started.'));
    if (detailPanelEl) detailPanelEl.classList.add('hidden');
    if (detailContentEl) detailContentEl.classList.add('hidden');
    return;
  }

  groups.forEach(group => {
    const row = document.createElement('article');
    row.className = 'social-list-row social-list-row--friend';
    row.appendChild(createIdentityRow(group.name || 'Unnamed group', `${group.member_count || 0} members`, group.role === 'leader' ? 'Leader' : 'Member', group?.leader || {}));
    const openBtn = createActionButton('Open', 'ghost');
    openBtn.disabled = socialState.tradeGroupsLoading;
    openBtn.addEventListener('click', () => loadTradeGroupDetail(group.id));
    const actionWrap = document.createElement('div');
    actionWrap.className = 'social-row-actions';
    actionWrap.appendChild(openBtn);
    row.appendChild(actionWrap);
    listEl?.appendChild(row);
  });

  const selected = groups.find(group => group.id === socialState.selectedTradeGroupId);
  if (!selected) {
    if (detailPanelEl) detailPanelEl.classList.add('hidden');
    if (detailContentEl) detailContentEl.classList.add('hidden');
    return;
  }

  if (detailPanelEl) detailPanelEl.classList.remove('hidden');
  if (detailContentEl) detailContentEl.classList.remove('hidden');
  if (headingEl) headingEl.textContent = `${selected.name} • ${selected.role === 'leader' ? 'Leader view' : 'Member view'}`;

  const isLeader = selected.role === 'leader';
  leaderOnlyNodes.forEach(node => node.classList.toggle('hidden', !isLeader));

  if (friendSelect) {
    friendSelect.innerHTML = '';
    const friends = Array.isArray(socialState.eligibleTradeGroupFriends) ? socialState.eligibleTradeGroupFriends : [];
    if (!isLeader || !friends.length) {
      friendSelect.disabled = true;
      const option = document.createElement('option'); option.value = ''; option.textContent = isLeader ? 'No eligible friends' : 'Leader only';
      friendSelect.appendChild(option);
      if (addMemberBtn) addMemberBtn.disabled = true;
    } else {
      friendSelect.disabled = false;
      friends.forEach(friend => { const option = document.createElement('option'); option.value = friend.friend_user_id; option.textContent = friend.nickname || 'Unknown trader'; friendSelect.appendChild(option); });
      if (addMemberBtn) addMemberBtn.disabled = false;
    }
  }
  if (announcementBtn) announcementBtn.disabled = !isLeader;
  if (deleteGroupBtn) deleteGroupBtn.classList.toggle('hidden', !isLeader);

  const members = Array.isArray(socialState.selectedTradeGroupMembers) ? socialState.selectedTradeGroupMembers : [];
  if (!members.length) membersEl?.appendChild(createEmptyState('No active members'));
  members.forEach(member => {
    const row = document.createElement('article');
    row.className = 'social-list-row social-list-row--friend';
    row.appendChild(createIdentityRow(member.nickname || 'Unknown trader', '', member.role === 'leader' ? 'Leader' : 'Member', member));
    if (isLeader && member.role !== 'leader') {
      const removeBtn = createActionButton('Remove', 'danger outline');
      removeBtn.addEventListener('click', async () => {
        try { await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/members/${encodeURIComponent(member.user_id)}`, { method: 'DELETE' }); await loadTradeGroupDetail(socialState.selectedTradeGroupId); } catch (_e) {}
      });
      const actionWrap = document.createElement('div'); actionWrap.className = 'social-row-actions'; actionWrap.appendChild(removeBtn); row.appendChild(actionWrap);
    }
    membersEl?.appendChild(row);
  });

  const pending = Array.isArray(socialState.selectedTradeGroupPendingInvites) ? socialState.selectedTradeGroupPendingInvites : [];
  if (isLeader) {
    if (!pending.length) pendingEl?.appendChild(createEmptyState('No pending invites'));
    pending.forEach(invite => {
      const row = document.createElement('article'); row.className = 'social-list-row social-list-row--request';
      row.appendChild(createIdentityRow(invite.nickname || 'Unknown trader', '', 'Pending', invite));
      const cancelBtn = createActionButton('Cancel', 'ghost');
      cancelBtn.addEventListener('click', async () => {
        try { await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/invites/${encodeURIComponent(invite.id || invite.invite_id || '')}/cancel`, { method: 'POST' }); await loadTradeGroupDetail(socialState.selectedTradeGroupId); } catch (_e) {}
      });
      const actionWrap = document.createElement('div'); actionWrap.className = 'social-row-actions'; actionWrap.appendChild(cancelBtn); row.appendChild(actionWrap);
      pendingEl?.appendChild(row);
    });
  }

  const positions = Array.isArray(socialState.selectedTradeGroupPositions) ? socialState.selectedTradeGroupPositions : [];
  if (!positions.length) positionsEl?.appendChild(createEmptyState('No qualifying active positions'));
  positions.forEach(pos => {
    const row = document.createElement('article'); row.className = 'social-list-row social-list-row--request';
    row.appendChild(createIdentityRow(pos.ticker || 'N/A', `Entry ${Number(pos.entry_price || 0).toFixed(2)} • Stop ${Number(pos.stop_price || 0).toFixed(2)}`, `Risk ${Number(pos.risk_pct || 0).toFixed(2)}% • P/L ${Number(pos.gain_loss_pct || 0).toFixed(2)}%`));
    positionsEl?.appendChild(row);
  });

  const feed = Array.isArray(socialState.selectedTradeGroupAlerts) ? socialState.selectedTradeGroupAlerts : [];
  if (!feed.length) alertsEl?.appendChild(createEmptyState('No activity yet'));
  feed.forEach(item => {
    const row = document.createElement('article'); row.className = 'social-list-row social-list-row--request';
    if (item.type === 'announcement') {
      row.appendChild(createIdentityRow(item.leader_nickname || 'Leader', item.created_at ? new Date(item.created_at).toLocaleString() : '', 'Announcement', { avatar_url: item.leader_avatar_url, avatar_initials: item.leader_avatar_initials }));
      const meta = document.createElement('div'); meta.className = 'helper'; meta.textContent = item.text || ''; row.appendChild(meta);
      if (isLeader) {
        const delBtn = createActionButton('Delete', 'danger outline');
        delBtn.addEventListener('click', async () => {
          try {
            await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/announcements/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
            await loadTradeGroupDetail(socialState.selectedTradeGroupId);
          } catch (_e) {}
        });
        const actionWrap = document.createElement('div'); actionWrap.className = 'social-row-actions'; actionWrap.appendChild(delBtn); row.appendChild(actionWrap);
      }
    } else {
      row.appendChild(createIdentityRow(item.leader_nickname || 'Leader', item.created_at ? new Date(item.created_at).toLocaleString() : '', `${item.ticker} · Risk ${Number(item.risk_pct || 0).toFixed(2)}%`, { avatar_url: item.leader_avatar_url, avatar_initials: item.leader_avatar_initials }));
      const meta = document.createElement('div'); meta.className = 'helper'; meta.textContent = `Entry ${Number(item.entry_price || 0).toFixed(2)} • Stop ${Number(item.stop_price || 0).toFixed(2)}`; row.appendChild(meta);
      if (isLeader) {
        const delBtn = createActionButton('Delete', 'danger outline');
        delBtn.addEventListener('click', async () => { try { await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/alerts/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); await loadTradeGroupDetail(socialState.selectedTradeGroupId); } catch (_e) {} });
        const actionWrap = document.createElement('div'); actionWrap.className = 'social-row-actions'; actionWrap.appendChild(delBtn); row.appendChild(actionWrap);
      }
    }
    alertsEl?.appendChild(row);
  });
}


async function loadTradeGroups() {
  socialState.tradeGroupsLoading = true;
  try {
    const response = await socialApi('/api/social/trade-groups');
    socialState.tradeGroups = Array.isArray(response?.groups) ? response.groups : [];
    const stillValid = socialState.tradeGroups.some(group => group.id === socialState.selectedTradeGroupId);
    if (!stillValid) socialState.selectedTradeGroupId = '';
    if (!socialState.selectedTradeGroupId && socialState.tradeGroups[0]?.id) {
      socialState.selectedTradeGroupId = socialState.tradeGroups[0].id;
      await loadTradeGroupDetail(socialState.selectedTradeGroupId, { rerenderList: false });
      return;
    }
    renderTradeGroupSection();
  } catch (_error) {
    renderTradeGroupSection();
  } finally {
    socialState.tradeGroupsLoading = false;
  }
}

async function loadTradeGroupDetail(groupId, opts = {}) {
  if (!groupId) return;
  try {
    const response = await socialApi(`/api/social/trade-groups/${encodeURIComponent(groupId)}`);
    socialState.selectedTradeGroupId = groupId;
    socialState.selectedTradeGroupMembers = Array.isArray(response?.members) ? response.members : [];
    socialState.selectedTradeGroupPendingInvites = Array.isArray(response?.pending_invites) ? response.pending_invites : [];
    socialState.selectedTradeGroupPositions = Array.isArray(response?.current_positions) ? response.current_positions : [];
    socialState.selectedTradeGroupAlerts = Array.isArray(response?.feed) ? response.feed : [];
    socialState.selectedTradeGroupRole = response?.group?.role || '';
    if (response?.group?.role === 'leader') {
      try {
        const eligibleResponse = await socialApi(`/api/social/trade-groups/${encodeURIComponent(groupId)}/eligible-friends`);
        socialState.eligibleTradeGroupFriends = Array.isArray(eligibleResponse?.eligible) ? eligibleResponse.eligible : [];
      } catch (_error) {
        socialState.eligibleTradeGroupFriends = [];
      }
    } else {
      socialState.eligibleTradeGroupFriends = [];
    }
  } catch (_error) {
    socialState.selectedTradeGroupMembers = [];
    socialState.selectedTradeGroupPendingInvites = [];
    socialState.selectedTradeGroupPositions = [];
    socialState.selectedTradeGroupAlerts = [];
  }
  if (opts.rerenderList !== false) renderTradeGroupSection();
  else renderTradeGroupSection();
}


async function addTradeGroupMember(event) {
  event.preventDefault();
  if (!socialState.selectedTradeGroupId) return;
  const select = getEl('social-group-friend-select');
  const feedback = getEl('social-group-member-feedback');
  const friendUserId = String(select?.value || '').trim();
  if (!friendUserId) {
    setFeedback(feedback, 'Select a friend to invite.', 'error');
    return;
  }
  try {
    await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friend_user_id: friendUserId })
    });
    setFeedback(feedback, 'Invitation sent.', 'success');
    await loadTradeGroupDetail(socialState.selectedTradeGroupId);
  } catch (error) {
    setFeedback(feedback, error?.message || 'Unable to add member.', 'error');
  }
}



async function postGroupAnnouncement(event) {
  event.preventDefault();
  if (!socialState.selectedTradeGroupId) return;
  const input = getEl('social-group-announcement-input');
  const feedback = getEl('social-group-announcement-feedback');
  const text = String(input?.value || '').trim();
  if (!text) return setFeedback(feedback, 'Enter announcement text.', 'error');
  try {
    await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/announcements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
    });
    if (input) input.value = '';
    setFeedback(feedback, 'Announcement posted.', 'success');
    await loadTradeGroupDetail(socialState.selectedTradeGroupId);
  } catch (error) {
    setFeedback(feedback, error?.message || 'Unable to post announcement.', 'error');
  }
}

async function deleteSelectedGroup() {
  if (!socialState.selectedTradeGroupId) return;
  if (!window.confirm('Delete this trade group? This will close access for all members.')) return;
  const deletingId = socialState.selectedTradeGroupId;
  socialState.tradeGroups = socialState.tradeGroups.filter(group => group.id !== deletingId);
  socialState.selectedTradeGroupId = '';
  socialState.selectedTradeGroupMembers = [];
  socialState.selectedTradeGroupPendingInvites = [];
  socialState.selectedTradeGroupPositions = [];
  socialState.selectedTradeGroupAlerts = [];
  socialState.selectedTradeGroupRole = '';
  renderTradeGroupSection();
  try {
    await socialApi(`/api/social/trade-groups/${encodeURIComponent(deletingId)}`, { method: 'DELETE' });
    await loadTradeGroups();
    window.dispatchEvent(new CustomEvent(SOCIAL_REFRESH_EVENT));
  } catch (_error) {
    await loadTradeGroups();
  }
}

async function loadTradeGroupNotifications() {
  const feedback = getEl('social-trade-group-notification-feedback');
  try {
    const [notificationResponse, pendingResponse] = await Promise.all([
      socialApi('/api/social/trade-groups/notifications/unread'),
      socialApi('/api/social/trade-groups/invites/pending')
    ]);
    socialState.unreadTradeGroupNotifications = Array.isArray(notificationResponse?.notifications) ? notificationResponse.notifications : [];
    socialState.pendingTradeGroupInvites = Array.isArray(pendingResponse?.invites) ? pendingResponse.invites : [];
  } catch (_error) {
    socialState.unreadTradeGroupNotifications = [];
    socialState.pendingTradeGroupInvites = [];
  }
  const firstInvite = socialState.pendingTradeGroupInvites[0];
  if (firstInvite) {
    setFeedback(feedback, `Group invite from ${firstInvite.leader_nickname} to ${firstInvite.group_name}. You can respond here or in the header banner.`, 'muted');
  } else {
    setFeedback(feedback, '', 'muted');
  }
  renderTradeGroupSection();
}

async function createTradeGroup(event) {
  event.preventDefault();
  if (socialState.createGroupBusy || socialState.isGuest || socialState.nicknameRequired) return;
  const input = getEl('social-group-name');
  const feedback = getEl('social-group-feedback');
  const name = String(input?.value || '').trim();
  if (!name) {
    setFeedback(feedback, 'Enter a group name.', 'error');
    return;
  }
  socialState.createGroupBusy = true;
  const btn = getEl('social-create-group-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  try {
    await socialApi('/api/social/trade-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (input) input.value = '';
    setFeedback(feedback, 'Trade group created.', 'success');
    await loadTradeGroups();
  } catch (error) {
    setFeedback(feedback, error?.message || 'Unable to create trade group.', 'error');
  } finally {
    socialState.createGroupBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Create'; }
  }
}

function updateAddFriendState() {
  const input = getEl('social-add-friend-code');
  const button = getEl('social-add-friend-btn');
  const value = normalizeFriendCode(input?.value || '');
  const canSubmit = !!value && !socialState.addFriendBusy && !socialState.friendsLoading && !socialState.isGuest && !socialState.nicknameRequired;
  if (button) {
    button.disabled = !canSubmit;
    button.textContent = socialState.addFriendBusy ? 'Sending…' : 'Send';
  }
}

async function loadFriendData() {
  if (window.socialRequestSync && typeof window.socialRequestSync.refresh === 'function') {
    socialState.friendsLoading = true;
    socialState.friendsError = '';
    updateAddFriendState();
    setFriendsDisabled(socialState.isGuest || socialState.nicknameRequired);
    try {
      await window.socialRequestSync.refresh('social-page-load-friends');
      const shared = window.socialRequestSync.getState();
      socialState.friendsError = shared?.error || '';
      socialState.friends = Array.isArray(shared?.friends) ? shared.friends : [];
      socialState.incomingRequests = Array.isArray(shared?.incomingRequests) ? shared.incomingRequests : [];
      socialState.outgoingRequests = Array.isArray(shared?.outgoingRequests) ? shared.outgoingRequests : [];
      socialState.acceptedOutgoingRequests = Array.isArray(shared?.acceptedOutgoingRequests) ? shared.acceptedOutgoingRequests : [];
      renderFriendSection();
    } catch (error) {
      socialState.friends = [];
      socialState.incomingRequests = [];
      socialState.outgoingRequests = [];
      socialState.acceptedOutgoingRequests = [];
      socialState.friendsError = error?.message || 'Unable to load friend data.';
      renderFriendSection();
      // Keep the failure isolated to Friends so profile/settings/leaderboard continue working.
      console.warn('[social] friends sync refresh failed:', error);
    } finally {
      socialState.friendsLoading = false;
      updateAddFriendState();
      setFriendsDisabled(socialState.isGuest || socialState.nicknameRequired);
    }
    return;
  }

  socialState.friendsLoading = true;
  socialState.friendsError = '';
  updateAddFriendState();
  setFriendsDisabled(socialState.isGuest);

  try {
    if (socialState.isGuest || socialState.nicknameRequired) {
      socialState.friends = [];
      socialState.incomingRequests = [];
      socialState.outgoingRequests = [];
      socialState.acceptedOutgoingRequests = [];
      renderFriendSection();
      return;
    }

    const [friendsResponse, requestsResponse] = await Promise.all([
      socialApi('/api/social/friends'),
      socialApi('/api/social/friends/requests')
    ]);

    socialState.friends = Array.isArray(friendsResponse?.friends) ? friendsResponse.friends : [];
    socialState.incomingRequests = normalizeRequestList(requestsResponse?.incoming);
    socialState.outgoingRequests = normalizeRequestList(requestsResponse?.outgoing);
    socialState.acceptedOutgoingRequests = [];
    renderFriendSection();
  } catch (error) {
    socialState.friendsError = error.message || 'Unable to load friend data.';
    renderFriendSection();
  } finally {
    socialState.friendsLoading = false;
    updateAddFriendState();
    setFriendsDisabled(socialState.isGuest);
  }
}

async function sendFriendRequest(event) {
  event.preventDefault();
  if (socialState.isGuest || socialState.nicknameRequired || socialState.addFriendBusy) return;

  const input = getEl('social-add-friend-code');
  const feedback = getEl('social-add-friend-feedback');
  const code = normalizeFriendCode(input?.value || '');
  if (!code) {
    setFeedback(feedback, 'Enter a friend code before sending.', 'error');
    updateAddFriendState();
    return;
  }

  socialState.addFriendBusy = true;
  updateAddFriendState();
  setFeedback(feedback, 'Sending friend request...');

  try {
    const response = await socialApi('/api/social/friends/request/by-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendCode: code })
    });

    input.value = '';
    if (response?.autoAccepted) {
      setFeedback(feedback, 'Request auto-accepted. You are now friends.', 'success');
    } else {
      setFeedback(feedback, 'Friend request sent.', 'success');
    }
    await triggerSocialRefresh('request-sent');
  } catch (error) {
    setFeedback(feedback, error.message || 'Unable to send friend request.', 'error');
  } finally {
    socialState.addFriendBusy = false;
    updateAddFriendState();
  }
}

async function respondToRequest(requestId, action) {
  if (!requestId || socialState.requestActionIds.has(requestId) || socialState.isGuest || socialState.nicknameRequired) return;
  socialState.requestActionIds.add(requestId);
  renderFriendSection();

  const endpoint = action === 'accept'
    ? `/api/social/friends/requests/${encodeURIComponent(requestId)}/accept`
    : action === 'decline'
      ? `/api/social/friends/requests/${encodeURIComponent(requestId)}/decline`
      : `/api/social/friends/requests/${encodeURIComponent(requestId)}/cancel`;

  try {
    await socialApi(endpoint, { method: 'POST' });
    await triggerSocialRefresh(`request-${action}`);
  } catch (error) {
    socialState.friendsError = error.message || 'Unable to update request.';
    renderFriendSection();
  } finally {
    socialState.requestActionIds.delete(requestId);
    renderFriendSection();
  }
}

async function removeFriend(friendUserId) {
  if (!friendUserId || socialState.friendActionIds.has(friendUserId) || socialState.isGuest || socialState.nicknameRequired) return;
  socialState.friendActionIds.add(friendUserId);
  renderFriendSection();

  try {
    await socialApi(`/api/social/friends/${encodeURIComponent(friendUserId)}`, { method: 'DELETE' });
    await triggerSocialRefresh('friend-removed');
  } catch (error) {
    socialState.friendsError = error.message || 'Unable to remove friend.';
    renderFriendSection();
  } finally {
    socialState.friendActionIds.delete(friendUserId);
    renderFriendSection();
  }
}

function applySharedSocialState(shared) {
  if (!shared || typeof shared !== 'object') return;
  socialState.nicknameRequired = !!shared.nicknameRequired;
  socialState.friendsError = shared.error || '';
  socialState.friends = Array.isArray(shared.friends) ? shared.friends : [];
  socialState.incomingRequests = Array.isArray(shared.incomingRequests) ? shared.incomingRequests : [];
  socialState.outgoingRequests = Array.isArray(shared.outgoingRequests) ? shared.outgoingRequests : [];
  socialState.acceptedOutgoingRequests = Array.isArray(shared.acceptedOutgoingRequests) ? shared.acceptedOutgoingRequests : [];
  renderFriendSection();
  updateAddFriendState();
}

async function triggerSocialRefresh(reason) {
  if (window.socialRequestSync && typeof window.socialRequestSync.refresh === 'function') {
    await window.socialRequestSync.refresh(reason);
    applySharedSocialState(window.socialRequestSync.getState());
    return;
  }
  if (typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(SOCIAL_REFRESH_EVENT, { detail: { reason } }));
    return;
  }
  await loadFriendData();
}

function bindFriendActions() {
  const form = getEl('social-add-friend-form');
  const input = getEl('social-add-friend-code');
  form?.addEventListener('submit', sendFriendRequest);
  input?.addEventListener('input', () => {
    const normalized = normalizeFriendCode(input.value).replace(/[^A-Z0-9-]/g, '');
    if (input.value !== normalized) input.value = normalized;
    setFeedback(getEl('social-add-friend-feedback'), '');
    updateAddFriendState();
  });
}

function setFeedback(el, message, kind = 'muted') {
  if (!el) return;
  const existingTimer = feedbackTimers.get(el);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
    feedbackTimers.delete(el);
  }
  el.textContent = message || '';
  el.classList.toggle('is-error', kind === 'error');
  el.classList.toggle('success', kind === 'success');
  if (message && kind !== 'error') {
    const capturedMessage = message;
    const timer = window.setTimeout(() => {
      if (el.textContent === capturedMessage) {
        el.textContent = '';
        el.classList.remove('is-error', 'success');
      }
      feedbackTimers.delete(el);
    }, TRANSIENT_FEEDBACK_TTL_MS);
    feedbackTimers.set(el, timer);
  }
}

function applyVerification(profile, settings) {
  const badgeEl = getEl('social-verification-badge');
  const sourceEl = getEl('social-verification-source');
  const descriptionEl = getEl('social-verification-description');

  const status = settings?.verification_status || profile?.verification_status || 'none';
  const source = settings?.verification_source || profile?.verification_source || null;
  const view = getVerificationDisplay(status, source);

  if (badgeEl) {
    badgeEl.textContent = view.label;
    badgeEl.className = `social-status-pill ${view.badgeClass}`;
  }
  if (sourceEl) sourceEl.textContent = view.sourceLabel;
  if (descriptionEl) descriptionEl.textContent = view.description;
}

function applyProfile(profile) {
  const friendCodeEl = getEl('social-friend-code');
  if (friendCodeEl) {
    friendCodeEl.textContent = profile?.friend_code || 'Unavailable';
  }
  const nicknameEl = getEl('social-profile-nickname');
  if (nicknameEl) {
    nicknameEl.textContent = socialState.nickname || 'Nickname required';
  }
  const avatarSlot = getEl('social-profile-avatar');
  if (avatarSlot) {
    clearNode(avatarSlot);
    avatarSlot.appendChild(window.VeracitySocialAvatar?.createAvatar({
      nickname: socialState.nickname,
      avatar_url: profile?.avatar_url,
      avatar_initials: profile?.avatar_initials
    }, 'md') || document.createTextNode(''));
  }
  applyVerification(profile, socialState.settings);
}


function renderLeaderboardDataSourceOptions() {
  const form = getEl('social-settings-form');
  const control = form?.elements?.namedItem('leaderboard_data_source');
  if (!control || !control.options) return;
  const options = Array.isArray(socialState.leaderboardDataSourceOptions)
    ? socialState.leaderboardDataSourceOptions
    : [];
  if (!options.length) return;
  const current = socialState.settings?.leaderboard_data_source || 'auto';
  control.innerHTML = '';
  options.forEach(option => {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.available ? option.label : `${option.label} (unavailable)`;
    opt.disabled = !option.available;
    if (option.reason) opt.title = option.reason;
    control.appendChild(opt);
  });
  const hasCurrent = options.some(option => option.value === current && option.available);
  control.value = hasCurrent ? current : 'auto';
}

function readFormSettings() {
  const form = getEl('social-settings-form');
  const values = {};
  if (!form) return values;
  for (const key of SOCIAL_SETTING_KEYS) {
    const control = form.elements.namedItem(key);
    if (!control) continue;
    values[key] = control.type === 'checkbox' ? !!control.checked : control.value;
  }
  return values;
}

function applyFormSettings(settings) {
  const form = getEl('social-settings-form');
  renderLeaderboardDataSourceOptions();
  if (!form) return;
  for (const key of SOCIAL_SETTING_KEYS) {
    const control = form.elements.namedItem(key);
    if (!control) continue;
    const value = settings?.[key];
    if (control.type === 'checkbox') {
      control.checked = !!value;
    } else if (typeof value === 'string') {
      const hasOption = Array.from(control.options || []).some(opt => opt.value === value);
      const fallbackValue = key === 'leaderboard_data_source' ? 'auto' : 'private';
      control.value = hasOption ? value : fallbackValue;
    }
  }
  updateDependentControls();
}

function isDirty() {
  if (!socialState.initialSettings) return false;
  const current = readFormSettings();
  return SOCIAL_SETTING_KEYS.some(key => current[key] !== socialState.initialSettings[key]);
}

function setFormDisabled(disabled) {
  const form = getEl('social-settings-form');
  if (!form) return;
  const controls = form.querySelectorAll('input, select, button');
  controls.forEach(control => {
    control.disabled = disabled;
  });
}

function setDependentGroupState(type, disabled) {
  const rows = document.querySelectorAll(`[data-social-dependent="${type}"]`);
  rows.forEach(row => {
    row.classList.toggle('is-muted', disabled);
    row.querySelectorAll('input, select').forEach(control => {
      control.disabled = disabled || socialState.loading || socialState.isGuest;
    });
  });
}

function updateDependentControls() {
  const form = getEl('social-settings-form');
  if (!form) return;

  const leaderboardEnabled = !!form.elements.namedItem('leaderboard_enabled')?.checked;
  const sharingEnabled = !!form.elements.namedItem('trade_sharing_enabled')?.checked;

  setDependentGroupState('leaderboard', !leaderboardEnabled);
  setDependentGroupState('trade-sharing', !sharingEnabled);
}

function updateActionState() {
  const saveBtn = getEl('social-save-btn');
  const regenBtn = getEl('social-regenerate-btn');
  const copyBtn = getEl('social-copy-code-btn');

  const dirty = isDirty();
  const disableSave = socialState.loading || socialState.isSaving || socialState.isGuest || socialState.nicknameRequired || !dirty;

  if (saveBtn) {
    saveBtn.disabled = disableSave;
    saveBtn.textContent = socialState.isSaving ? 'Saving…' : 'Save settings';
  }
  if (regenBtn) {
    regenBtn.disabled = socialState.loading || socialState.isRegenerating || socialState.isGuest || socialState.nicknameRequired;
    regenBtn.textContent = socialState.isRegenerating ? 'Regenerating…' : 'Regenerate code';
  }
  if (copyBtn) {
    copyBtn.disabled = socialState.loading;
  }

  updateDependentControls();
}

function bindSettingsChangeTracking() {
  const form = getEl('social-settings-form');
  if (!form) return;
  form.addEventListener('input', () => {
    updateActionState();
    setFeedback(getEl('social-settings-feedback'), '');
  });
}

async function loadSocialData() {
  socialState.loading = true;
  updateActionState();

  const loadingEl = getEl('social-profile-loading');
  const errorEl = getEl('social-profile-error');
  const contentEl = getEl('social-profile-content');

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorEl) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }

  try {
    if (isGuestSession()) {
      socialState.isGuest = true;
      const guestMessage = getEl('social-settings-disabled');
      if (guestMessage) {
        guestMessage.classList.remove('hidden');
        guestMessage.textContent = 'Guest mode: social profile and sharing settings are unavailable until you sign in.';
      }
      socialState.nicknameRequired = false;
      socialState.nickname = '';
      socialState.profile = { friend_code: 'GUEST', verification_status: 'none', verification_source: 'manual' };
      socialState.settings = normalizeSocialSettings({ verification_source: 'manual' });
      socialState.initialSettings = { ...socialState.settings };
      socialState.leaderboardDataSourceOptions = [
        { value: 'auto', label: 'Auto', available: true }
      ];
      applyProfile(socialState.profile);
      applyFormSettings(socialState.settings);
      setFormDisabled(true);
      setFeedback(getEl('social-settings-feedback'), 'Sign in to change social settings.', 'muted');
      setFriendsDisabled(true);
    } else {
      socialState.isGuest = false;
      const response = await socialApi('/api/social/me');
      socialState.profile = response?.profile || {};
      socialState.settings = normalizeSocialSettings(response?.settings);
      socialState.nicknameRequired = !!response?.nickname_required;
      socialState.nickname = response?.nickname || '';
      socialState.leaderboardDataSourceOptions = Array.isArray(response?.leaderboard_data_source_options)
        ? response.leaderboard_data_source_options
        : [];
      socialState.initialSettings = SOCIAL_SETTING_KEYS.reduce((acc, key) => {
        acc[key] = socialState.settings[key];
        return acc;
      }, {});

      applyProfile(socialState.profile);
      applyFormSettings(socialState.settings);
      setFormDisabled(socialState.nicknameRequired);
      getEl('social-settings-disabled')?.classList.add('hidden');
      setFeedback(getEl('social-settings-feedback'), '');
      setFriendsDisabled(false);
    }

    const gateEl = getEl('social-nickname-gate');
    if (gateEl) gateEl.classList.toggle('hidden', !socialState.nicknameRequired);
    const disabledMessageEl = getEl('social-settings-disabled');
    if (!socialState.isGuest && disabledMessageEl) {
      disabledMessageEl.classList.toggle('hidden', !socialState.nicknameRequired);
      disabledMessageEl.textContent = socialState.nicknameRequired
        ? 'Set a nickname in Profile to enable social settings and participation.'
        : '';
    }
    if (contentEl) contentEl.classList.remove('hidden');
  } catch (error) {
    if (errorEl) {
      errorEl.classList.remove('hidden');
      errorEl.textContent = error.message || 'Unable to load social profile.';
    }
  } finally {
    socialState.loading = false;
    if (loadingEl) loadingEl.classList.add('hidden');
    updateActionState();
  }
}

async function saveSettings(event) {
  event.preventDefault();
  if (socialState.isSaving || socialState.isGuest || socialState.nicknameRequired || !isDirty()) return;

  socialState.isSaving = true;
  updateActionState();
  const feedbackEl = getEl('social-settings-feedback');
  setFeedback(feedbackEl, 'Saving settings...');

  try {
    const payload = readFormSettings();
    const response = await socialApi('/api/social/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    socialState.settings = response?.settings || payload;
    socialState.initialSettings = { ...payload };
    applyVerification(socialState.profile, socialState.settings);
    setFeedback(feedbackEl, 'Settings saved.', 'success');
  } catch (error) {
    setFeedback(feedbackEl, error.message || 'Unable to save settings.', 'error');
  } finally {
    socialState.isSaving = false;
    updateActionState();
  }
}

async function regenerateFriendCode() {
  if (socialState.isRegenerating || socialState.isGuest || socialState.nicknameRequired) return;

  const confirmed = window.confirm(
    'Regenerate your friend code? Your previous code will stop working immediately.'
  );
  if (!confirmed) return;

  socialState.isRegenerating = true;
  updateActionState();
  const feedbackEl = getEl('social-regenerate-feedback');
  setFeedback(feedbackEl, 'Regenerating code...');

  try {
    await socialApi('/api/social/friend-code/regenerate', { method: 'POST' });
    await loadSocialData();
    setFeedback(feedbackEl, 'Friend code regenerated successfully.', 'success');
  } catch (error) {
    setFeedback(feedbackEl, error.message || 'Unable to regenerate friend code.', 'error');
  } finally {
    socialState.isRegenerating = false;
    updateActionState();
  }
}

async function copyFriendCode() {
  const code = socialState.profile?.friend_code;
  const feedbackEl = getEl('social-regenerate-feedback');
  if (!code || code === 'Unavailable') {
    setFeedback(feedbackEl, 'No friend code available to copy.', 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(code);
    setFeedback(feedbackEl, 'Friend code copied.', 'success');
  } catch (error) {
    setFeedback(feedbackEl, 'Clipboard unavailable. Copy manually.', 'error');
  }
}


function startFriendPolling() {
  stopFriendPolling();
  if (socialState.isGuest || socialState.nicknameRequired) return;
  if (window.socialRequestSync && typeof window.socialRequestSync.startPolling === 'function') {
    window.socialRequestSync.startPolling();
  } else {
    socialState.friendPollTimer = window.setInterval(() => {
      if (!document.hidden) {
        loadFriendData();
      }
    }, 20000);
  }

  socialState.tradeGroupPollTimer = window.setInterval(() => {
    if (!document.hidden) {
      loadTradeGroups();
      loadTradeGroupNotifications();
    }
  }, 10000);
}

function stopFriendPolling() {
  if (socialState.friendPollTimer) {
    window.clearInterval(socialState.friendPollTimer);
    socialState.friendPollTimer = null;
  }
  if (socialState.tradeGroupPollTimer) {
    window.clearInterval(socialState.tradeGroupPollTimer);
    socialState.tradeGroupPollTimer = null;
  }
}

function bindActions() {
  getEl('social-settings-form')?.addEventListener('submit', saveSettings);
  getEl('social-regenerate-btn')?.addEventListener('click', regenerateFriendCode);
  getEl('social-copy-code-btn')?.addEventListener('click', copyFriendCode);
  bindSettingsChangeTracking();
  bindFriendActions();
  getEl('social-create-group-form')?.addEventListener('submit', createTradeGroup);
  getEl('social-group-add-member-form')?.addEventListener('submit', addTradeGroupMember);
  getEl('social-group-announcement-form')?.addEventListener('submit', postGroupAnnouncement);
  getEl('social-group-delete-btn')?.addEventListener('click', deleteSelectedGroup);
}

document.addEventListener('DOMContentLoaded', () => {
  bindActions();

  Promise.allSettled([
    loadSocialData(),
    loadLeaderboard(),
    loadFriendData(),
    loadTradeGroups(),
    loadTradeGroupNotifications()
  ]).finally(() => {
    // Start polling after initial section loads settle so one failure does not block others.
    startFriendPolling();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !socialState.isGuest && !socialState.nicknameRequired) {
      loadFriendData();
      loadLeaderboard();
      loadTradeGroups();
      loadTradeGroupNotifications();
    }
  });
  window.addEventListener(SOCIAL_SYNC_EVENT, (event) => {
    const sharedState = event?.detail?.state;
    if (sharedState) {
      applySharedSocialState(sharedState);
    } else {
      loadFriendData();
    }
    loadTradeGroups();
    loadTradeGroupNotifications();
  });
  window.addEventListener(SOCIAL_REFRESH_EVENT, () => {
    loadFriendData();
    loadTradeGroups();
    loadTradeGroupNotifications();
  });
  window.addEventListener('beforeunload', stopFriendPolling);
});

})();
