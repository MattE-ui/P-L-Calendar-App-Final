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
  'leaderboard_data_source',
  // New fields (backend migration may be required for persistence)
  'accept_group_invitations',
  'show_online_status',
  'show_r_multiple',
  'show_entry_stop',
  'bio',
  'timezone',
  'display_name'
];

const LEADERBOARD_PERIODS = ['7D', '30D', 'YTD'];
const LEADERBOARD_MODES = ['trade'];
const DEFAULT_LEADERBOARD_PERIOD = '30D';
const DEFAULT_LEADERBOARD_MODE = 'trade';

const DEFAULT_SOCIAL_SETTINGS = {
  leaderboard_enabled: false,
  trade_sharing_enabled: true,
  allow_friend_requests: true,
  share_open_trades: false,
  share_closed_trades: true,
  show_pnl_percent: true,
  show_pnl_currency: false,
  show_position_size: false,
  leaderboard_visibility: 'public',
  trade_sharing_scope: 'friends_only',
  leaderboard_data_source: 'auto',
  verification_status: 'none',
  verification_source: null,
  // New fields — defaults per spec
  accept_group_invitations: true,
  show_online_status: true,
  show_r_multiple: true,
  show_entry_stop: true,
  bio: '',
  timezone: '',
  display_name: ''
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
  friendsSearch: '',
  friendsSortKey: 'recent',
  friendsFilter: 'all',
  pendingRemoveFriendId: null,
  pendingRemoveFriendName: '',
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
  selectedTradeGroupWatchlists: [],
  selectedTradeGroupWatchlistDetailById: {},
  myWatchlists: [],
  activeGroupWatchlistId: '',
  unreadTradeGroupNotifications: [],
  pendingTradeGroupInvites: [],
  createGroupBusy: false,
  eligibleTradeGroupFriends: [],
  tradeGroupPollTimer: null,
  lastSeenTradeGroupFeedId: '',
  overviewFeedFilter: 'all',
  liveFeedFlashUntil: 0,
  expandedGroupWatchlistIds: new Set(),
  expandedGroupWatchlistSections: {},
  friendStateSignature: '',
  socialOverviewSignature: '',
  tradeGroupFeedSignature: '',
  tradeGroupDetailRenderSignature: '',
  pendingRefreshTimers: new Map()
};


const initialParams = new URLSearchParams(window.location.search);
const initialGroupId = initialParams.get('group') || '';
if (initialGroupId) {
  socialState.selectedTradeGroupId = initialGroupId;
}
const initialWatchlistId = initialParams.get('watchlist') || '';
if (initialWatchlistId) socialState.activeGroupWatchlistId = initialWatchlistId;

const TRANSIENT_FEEDBACK_TTL_MS = 15000;
const feedbackTimers = new WeakMap();

const SOCIAL_SYNC_EVENT = 'social:state-changed';
const SOCIAL_REFRESH_EVENT = 'social:refresh-requested';
const ALERT_RISK_PREFILL_STORAGE_KEY = 'plc-risk-calculator-prefill-v1';
const DASHBOARD_ROUTE = '/dashboard';

const SOCIAL_ACTIVITY_DEBUG = (() => {
  try {
    return window.localStorage?.getItem('social-activity-debug') === '1'
      || new URLSearchParams(window.location.search).get('socialActivityDebug') === '1';
  } catch (_error) {
    return false;
  }
})();

function toNumericOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeTradeGroupActivityEvent(item = {}) {
  const itemType = String(item?.type || '').trim().toLowerCase();
  if (itemType === 'announcement' || String(item?.normalized_event_type || '').trim().toUpperCase() === 'ANNOUNCEMENT') {
    return 'announcement';
  }

  const normalizedEventType = String(item?.normalized_event_type || '').trim().toUpperCase();
  if (normalizedEventType === 'TRADE_TRIMMED') return 'trim';
  if (normalizedEventType === 'TRADE_CLOSED') return 'close';
  if (normalizedEventType === 'TRADE_OPENED') return 'open';

  const eventType = String(item?.position_event_type || item?.event_type || '').trim().toUpperCase();
  if (eventType === 'POSITION_TRIM') return 'trim';
  if (eventType === 'POSITION_CLOSED') return 'close';
  if (eventType === 'POSITION_OPENED' || eventType === 'NEW_POSITION') return 'open';
  if (eventType === 'POSITION_INCREASE') return 'add';
  if (eventType === 'POSITION_STOP_MOVED' || eventType === 'STOP_MOVED') return 'stop_move';

  const explicitSignals = [
    item?.event_subtype,
    item?.subtype,
    item?.action,
    item?.trade_action,
    item?.action_type
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  const hasTrimSignal = explicitSignals.some((value) => /(trim|partial|partial_close|reduce|reduced|scale[_\s-]?out)/.test(value));
  if (hasTrimSignal) return 'trim';
  const hasCloseSignal = explicitSignals.some((value) => /(full[_\s-]?exit|full[_\s-]?close|close|closed|exit|exited)/.test(value));
  if (hasCloseSignal) return 'close';

  const classification = String(item?.alert_classification || '').trim().toLowerCase();
  if (classification === 'add' || classification === 'position_increase') return 'add';
  if (classification === 'buy' || classification === 'new_position') return 'open';
  if (classification === 'partial_sell') return 'trim';
  if (classification === 'full_close') return 'close';

  if (eventType === 'POSITION_INCREASE') return 'add';
  if (eventType === 'NEW_POSITION') return 'open';
  if (eventType === 'POSITION_REDUCED') return 'trim';

  const side = String(item?.side || '').trim().toUpperCase();
  if (side === 'BUY') return 'open';

  const trimPct = toNumericOrNull(item?.trim_pct ?? item?.trim_percent ?? item?.percent ?? item?.percentage);
  if (trimPct !== null) {
    if (trimPct < 100) return 'trim';
    if (trimPct >= 100) return 'close';
  }

  const remainingQuantity = toNumericOrNull(item?.remaining_quantity ?? item?.remainingQuantity ?? item?.position_remaining_quantity);
  if (remainingQuantity !== null) {
    if (remainingQuantity > 0) return 'trim';
    if (remainingQuantity === 0) return 'close';
  }

  const quantityDelta = toNumericOrNull(item?.quantity_delta ?? item?.quantityDelta ?? item?.delta_quantity);
  if (quantityDelta !== null && quantityDelta < 0 && remainingQuantity !== null) {
    return remainingQuantity > 0 ? 'trim' : 'close';
  }

  if (side === 'SELL') return 'close';
  return 'other';
}

function getTradeGroupActivityOverviewLabel(item = {}, classification = normalizeTradeGroupActivityEvent(item)) {
  if (classification === 'announcement') return 'Announcement';
  if (classification === 'trim') {
    const pct = toNumericOrNull(item?.trim_pct);
    const ticker = String(item?.ticker || '').trim().toUpperCase();
    if (pct !== null && ticker) return `Trimmed ${pct}% of ${ticker}`;
    if (pct !== null) return `Trimmed ${pct}%`;
    return 'Trimmed position';
  }
  if (classification === 'close') return 'Closed position';
  if (classification === 'stop_move') return 'Stop moved';
  return 'Opened position';
}

function logActivityNormalization(item, classification, renderedLabel) {
  if (!SOCIAL_ACTIVITY_DEBUG) return;
  console.info('[social-activity-normalized]', {
    eventId: item?.id || null,
    rawType: item?.type || null,
    rawSubtype: item?.event_subtype || item?.subtype || null,
    rawAction: item?.action || item?.trade_action || item?.action_type || null,
    quantityDelta: item?.quantity_delta ?? item?.quantityDelta ?? null,
    remainingQuantity: item?.remaining_quantity ?? item?.remainingQuantity ?? null,
    trimPercentage: item?.trim_pct ?? item?.trim_percent ?? null,
    normalizedClassification: classification,
    renderedOverviewLabel: renderedLabel
  });
}
const SOCIAL_PAGE_KIND = (() => {
  const path = String(window.location.pathname || '').toLowerCase();
  if (path === '/social/groups' || path.endsWith('/social-groups.html')) return 'groups';
  if (path === '/social/network' || path.endsWith('/social-network.html')) return 'network';
  if (path === '/social/profile' || path.endsWith('/social-profile.html')) return 'profile';
  return 'overview';
})();

function logSocialPerf(marker, detail = {}) {
  window.PerfDiagnostics?.log(marker, { page: SOCIAL_PAGE_KIND, ...detail });
}

function toStableWatchlistSectionId(watchlistId, section = {}, index = 0) {
  const explicitId = String(section?.id || '').trim();
  if (explicitId) return explicitId;
  const normalizedTitle = String(section?.title || '').trim().toLowerCase();
  if (normalizedTitle) return `${watchlistId || 'watchlist'}::${normalizedTitle}`;
  return `${watchlistId || 'watchlist'}::section-${index + 1}`;
}

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
  try {
    const payloadBytes = JSON.stringify(data || {}).length;
    if (path.includes('/api/social/trade-groups') || path.includes('/api/trading-groups/') || path.includes('/api/watchlists')) {
      logSocialPerf('social-route-response', { path, payloadBytes });
    }
  } catch (_error) {}
  return data;
}

function getEl(id) {
  return document.getElementById(id);
}

function computeTradeGroupDetailRenderSignature(groupId, summaryOnly = false) {
  const memberSignature = socialState.selectedTradeGroupMembers
    .map((member) => `${member?.user_id || ''}:${member?.status || ''}:${member?.role || ''}`)
    .join('|');
  const inviteSignature = socialState.selectedTradeGroupPendingInvites
    .map((invite) => invite?.invite_id || invite?.id || '')
    .join('|');
  const positionSignature = socialState.selectedTradeGroupPositions
    .slice(0, 12)
    .map((position) => `${position?.ticker || ''}:${position?.status || ''}:${position?.updated_at || position?.created_at || ''}`)
    .join('|');
  const feedSignature = socialState.selectedTradeGroupAlerts
    .slice(0, 12)
    .map((item) => item?.id || item?.created_at || '')
    .join('|');
  const watchlistSignature = socialState.selectedTradeGroupWatchlists
    .map((watchlist) => `${watchlist?.id || ''}:${watchlist?.updatedAt || watchlist?.createdAt || ''}`)
    .join('|');
  const myWatchlistsSignature = socialState.myWatchlists
    .map((watchlist) => `${watchlist?.id || ''}:${watchlist?.updatedAt || watchlist?.createdAt || ''}`)
    .join('|');
  const eligibleSignature = socialState.eligibleTradeGroupFriends
    .map((friend) => `${friend?.user_id || ''}:${friend?.nickname || ''}`)
    .join('|');
  return [
    groupId,
    summaryOnly ? 'summary' : 'full',
    socialState.selectedTradeGroupRole || '',
    memberSignature,
    inviteSignature,
    positionSignature,
    feedSignature,
    watchlistSignature,
    myWatchlistsSignature,
    eligibleSignature
  ].join('||');
}

function normalizeAlertRiskPrefillPayload(alert = {}) {
  const ticker = String(alert.ticker || '').trim().toUpperCase();
  const entryPrice = Number(alert.entry_price);
  const stopPrice = Number(alert.stop_price);
  const rawRiskPercent = alert.risk_pct ?? alert.riskPercent ?? alert.riskPct ?? alert.risk_percentage;
  const parsedRiskPercent = Number(rawRiskPercent);
  const sideRaw = String(alert.side || '').trim().toUpperCase();
  const side = sideRaw === 'BUY' || sideRaw === 'LONG' ? 'long' : sideRaw === 'SELL' || sideRaw === 'SHORT' ? 'short' : '';
  const assetType = String(alert.asset_type || alert.assetType || '').trim().toLowerCase();
  const unsupportedAsset = assetType === 'options' || assetType === 'multi_leg' || assetType === 'multileg';
  if (!ticker || !side || unsupportedAsset) return null;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(stopPrice) || stopPrice <= 0 || entryPrice === stopPrice) return null;
  if (rawRiskPercent !== undefined && rawRiskPercent !== null && (!Number.isFinite(parsedRiskPercent) || parsedRiskPercent <= 0)) {
    console.info('[trade-group-alert] invalid alert risk percent ignored', { alertId: alert?.id, rawRiskPercent });
  }
  console.info('[trade-group-alert] raw alert risk field', { alertId: alert?.id, rawRiskPercent });
  return {
    source: 'trade_group_alert',
    alertId: String(alert.id || ''),
    ticker,
    side,
    entryPrice,
    stopPrice,
    riskPercent: Number.isFinite(parsedRiskPercent) && parsedRiskPercent > 0 ? parsedRiskPercent : undefined,
    assetType: assetType || null,
    groupId: String(socialState.selectedTradeGroupId || '')
  };
}

/**
 * @typedef {Object} RiskCalculatorPrefill
 * @property {"trade_group_alert"} source
 * @property {string} alertId
 * @property {string=} groupId
 * @property {string} ticker
 * @property {"long"|"short"} side
 * @property {number} entryPrice
 * @property {number} stopPrice
 * @property {number=} riskPercent
 * @property {string|null=} assetType
 */

function isDashboardRoute(pathname = window.location.pathname || '/') {
  return pathname === '/' || pathname === '/dashboard';
}

function launchAlertRiskSizing(alert) {
  /** @type {RiskCalculatorPrefill|null} */
  const payload = normalizeAlertRiskPrefillPayload(alert);
  console.info('[trade-group-alert] alert CTA clicked', { alertId: alert?.id, groupId: socialState.selectedTradeGroupId });
  window.dispatchEvent(new CustomEvent('analytics:event', { detail: { name: 'trade_alert_size_clicked', alertId: alert?.id } }));
  if (!payload) {
    console.info('[trade-group-alert] calculator prefill rejected due to validation', { alertId: alert?.id });
    return;
  }

  const currentPath = window.location.pathname || '/';
  const routerTarget = isDashboardRoute(currentPath) ? currentPath : DASHBOARD_ROUTE;
  console.info('[trade-group-alert] router target selected', { currentPath, routerTarget });

  localStorage.setItem(ALERT_RISK_PREFILL_STORAGE_KEY, JSON.stringify(payload));
  console.info('[trade-group-alert] prefill state stored', { alertId: payload.alertId, ticker: payload.ticker, routerTarget });
  window.dispatchEvent(new CustomEvent('risk-prefill:store', { detail: payload }));
  if (isDashboardRoute(currentPath)) {
    window.dispatchEvent(new CustomEvent('risk-prefill:apply', { detail: payload }));
    return;
  }
  window.open(routerTarget, '_self');
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

  const previewLimit = Number(listEl?.dataset?.previewLimit || 0);
  const leaderboardEntries = previewLimit > 0
    ? (Array.isArray(socialState.leaderboardEntries) ? socialState.leaderboardEntries.slice(0, previewLimit) : [])
    : (Array.isArray(socialState.leaderboardEntries) ? socialState.leaderboardEntries : []);
  const hasEntries = leaderboardEntries.length > 0;
  if (emptyEl) emptyEl.classList.toggle('hidden', socialState.leaderboardLoading || !!socialState.leaderboardError || hasEntries);

  if (!listEl) {
    renderSocialOverview();
    return;
  }
  clearNode(listEl);
  listEl.classList.toggle('hidden', !hasEntries || !!socialState.leaderboardError);
  if (!hasEntries || socialState.leaderboardError) {
    renderSocialOverview();
    return;
  }

  leaderboardEntries.forEach(entry => {
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
  renderGroupWatchlistsSection(isLeader);
  renderSocialOverview();
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

function scheduleSocialRefresh(key, handler, delayMs = 0) {
  if (!key || typeof handler !== 'function') return;
  const existing = socialState.pendingRefreshTimers.get(key);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    socialState.pendingRefreshTimers.delete(key);
    handler();
  }, Math.max(0, Number(delayMs) || 0));
  socialState.pendingRefreshTimers.set(key, timer);
}

function canLoadTradeGroupHeavySections() {
  return SOCIAL_PAGE_KIND === 'groups';
}

// ── Toast system ────────────────────────────────────────────
function showToast(message, variant = 'neutral') {
  const container = getEl('social-toast-container');
  if (!container || !message) return;
  const toast = document.createElement('div');
  toast.className = `social-toast social-toast--${variant}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('is-visible')));
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    toast.classList.remove('is-visible');
    const cleanup = () => toast.remove();
    toast.addEventListener('transitionend', cleanup, { once: true });
    window.setTimeout(cleanup, 400);
  };
  const timer = window.setTimeout(dismiss, 3000);
  toast.addEventListener('click', () => { window.clearTimeout(timer); dismiss(); });
}

// ── Friend code helpers ─────────────────────────────────────
async function copyOwnFriendCode() {
  const code = socialState.profile?.friend_code;
  if (!code || code === 'Unavailable') { showToast('No friend code available.', 'error'); return; }
  try {
    await navigator.clipboard.writeText(code);
    showToast('Code copied', 'success');
  } catch (_err) {
    showToast('Clipboard unavailable — copy manually.', 'error');
  }
}

async function shareOwnFriendCode() {
  const code = socialState.profile?.friend_code;
  if (!code) return;
  const shareData = { title: 'My Veracity Friend Code', text: `Add me on Veracity: ${code}` };
  if (navigator.share && navigator.canShare?.(shareData)) {
    try { await navigator.share(shareData); } catch (_err) {}
  } else {
    try { await navigator.clipboard.writeText(code); } catch (_err) {}
    showToast('Link copied', 'success');
  }
}

// ── Remove friend modal ─────────────────────────────────────
function showRemoveFriendModal(friendUserId, friendName) {
  socialState.pendingRemoveFriendId = friendUserId;
  socialState.pendingRemoveFriendName = friendName || 'this friend';
  const nameEl = getEl('friends-remove-modal-name');
  if (nameEl) nameEl.textContent = socialState.pendingRemoveFriendName;
  getEl('friends-remove-modal')?.classList.remove('hidden');
  getEl('friends-remove-cancel-btn')?.focus();
}

function hideRemoveFriendModal() {
  socialState.pendingRemoveFriendId = null;
  socialState.pendingRemoveFriendName = '';
  getEl('friends-remove-modal')?.classList.add('hidden');
}

// ── Friends page subtitle ───────────────────────────────────
function renderFriendsPageSubtitle() {
  const el = getEl('friends-page-subtitle');
  if (!el) return;
  const friendCount = Array.isArray(socialState.friends) ? socialState.friends.length : 0;
  const pendingCount = (Array.isArray(socialState.incomingRequests) ? socialState.incomingRequests.length : 0)
    + (Array.isArray(socialState.outgoingRequests) ? socialState.outgoingRequests.length : 0);
  const parts = [`${friendCount} ${friendCount === 1 ? 'friend' : 'friends'}`];
  if (pendingCount > 0) parts.push(`${pendingCount} pending`);
  parts.push('share a friend code to connect');
  el.textContent = parts.join(' · ');
}

// ── Apply sort/search/filter to friends list ────────────────
function applyFriendsSortFilter(friends) {
  let list = Array.isArray(friends) ? [...friends] : [];

  // Search by nickname
  const query = String(socialState.friendsSearch || '').trim().toLowerCase();
  if (query) {
    list = list.filter(f => String(f.nickname || '').toLowerCase().includes(query));
  }

  // Filter: online (no online data yet — pass-through), groups
  if (socialState.friendsFilter === 'groups') {
    const groupMemberIds = new Set(
      (Array.isArray(socialState.selectedTradeGroupMembers) ? socialState.selectedTradeGroupMembers : [])
        .map(m => String(m?.user_id || ''))
        .filter(Boolean)
    );
    list = list.filter(f => groupMemberIds.has(String(f.friend_user_id || '')));
  }

  // Sort
  const key = socialState.friendsSortKey || 'recent';
  if (key === 'name') {
    list.sort((a, b) => String(a.nickname || '').localeCompare(String(b.nickname || '')));
  } else if (key === 'since_newest') {
    list.sort((a, b) => (b.created_at ? new Date(b.created_at).getTime() : 0) - (a.created_at ? new Date(a.created_at).getTime() : 0));
  } else if (key === 'since_oldest') {
    list.sort((a, b) => (a.created_at ? new Date(a.created_at).getTime() : 0) - (b.created_at ? new Date(b.created_at).getTime() : 0));
  }
  // 'recent' — keep server order (already sorted by activity)
  return list;
}

// ── Build a friend row (grid layout) ───────────────────────
function buildFriendRow(friend) {
  const groupMemberIds = new Set(
    (Array.isArray(socialState.selectedTradeGroupMembers) ? socialState.selectedTradeGroupMembers : [])
      .map(m => String(m?.user_id || ''))
      .filter(Boolean)
  );
  const isInGroup = groupMemberIds.has(String(friend.friend_user_id || ''));
  const isNew = (() => {
    if (!friend.created_at) return false;
    const ms = Date.now() - new Date(friend.created_at).getTime();
    return ms < 7 * 24 * 60 * 60 * 1000;
  })();
  const statsPrivate = !!friend.stats_private;

  const row = document.createElement('article');
  row.className = 'friends-friend-row';
  row.setAttribute('role', 'row');
  row.tabIndex = 0;

  // 1) Avatar
  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'friends-avatar-wrap';
  const avatar = window.VeracitySocialAvatar?.createAvatar({
    nickname: friend.nickname,
    avatar_url: friend.avatar_url,
    avatar_initials: friend.avatar_initials
  }, 'sm');
  if (avatar) avatarWrap.appendChild(avatar);
  row.appendChild(avatarWrap);

  // 2) Identity
  const identity = document.createElement('div');
  identity.className = 'friends-friend-identity';

  const nameRow = document.createElement('div');
  nameRow.className = 'friends-friend-name-row';
  const nameEl = document.createElement('span');
  nameEl.className = 'friends-friend-name';
  nameEl.textContent = friend.nickname || 'Unknown trader';
  nameRow.appendChild(nameEl);
  if (isInGroup) {
    const b = document.createElement('span');
    b.className = 'friends-friend-badge friends-friend-badge--group';
    b.textContent = 'IN YOUR GROUP';
    nameRow.appendChild(b);
  }
  if (statsPrivate) {
    const b = document.createElement('span');
    b.className = 'friends-friend-badge friends-friend-badge--private';
    b.textContent = 'STATS PRIVATE';
    nameRow.appendChild(b);
  }
  if (isNew) {
    const b = document.createElement('span');
    b.className = 'friends-friend-badge friends-friend-badge--new';
    b.textContent = 'NEW';
    nameRow.appendChild(b);
  }
  identity.appendChild(nameRow);

  const metaEl = document.createElement('div');
  metaEl.className = 'friends-friend-meta';
  const sinceParts = [];
  if (friend.created_at) {
    const d = new Date(friend.created_at);
    if (!Number.isNaN(d.getTime())) {
      sinceParts.push(`friends since ${d.toLocaleString('default', { month: 'short', year: 'numeric' })}`);
    }
  }
  metaEl.textContent = sinceParts.join(' · ') || 'friends';
  identity.appendChild(metaEl);
  row.appendChild(identity);

  // 3) 7d R stat
  const rCol = document.createElement('div');
  rCol.className = 'friends-stat-col';
  const rLabel = document.createElement('span');
  rLabel.className = 'friends-stat-label';
  rLabel.textContent = '7D R';
  const rVal = document.createElement('span');
  const rRaw = statsPrivate ? null : (Number.isFinite(Number(friend.return_7d)) ? Number(friend.return_7d) : null);
  rVal.className = `friends-stat-value ${rRaw === null ? 'friends-stat-value--na' : rRaw >= 0 ? 'friends-stat-value--pos' : 'friends-stat-value--neg'}`;
  rVal.textContent = rRaw === null ? '—' : `${rRaw >= 0 ? '+' : ''}${rRaw.toFixed(2)}%`;
  rCol.appendChild(rLabel);
  rCol.appendChild(rVal);
  row.appendChild(rCol);

  // 4) Win rate
  const wrCol = document.createElement('div');
  wrCol.className = 'friends-stat-col';
  const wrLabel = document.createElement('span');
  wrLabel.className = 'friends-stat-label';
  wrLabel.textContent = 'WIN RATE';
  const wrVal = document.createElement('span');
  const wrRaw = statsPrivate ? null : (Number.isFinite(Number(friend.win_rate_7d)) ? Number(friend.win_rate_7d) : null);
  wrVal.className = `friends-stat-value ${wrRaw === null ? 'friends-stat-value--na' : ''}`;
  if (wrRaw !== null) {
    const pct = wrRaw <= 1 ? wrRaw * 100 : wrRaw;
    wrVal.textContent = `${pct.toFixed(1)}%`;
  } else {
    wrVal.textContent = '—';
  }
  wrCol.appendChild(wrLabel);
  wrCol.appendChild(wrVal);
  row.appendChild(wrCol);

  // 5) 7d trades
  const tradesCol = document.createElement('div');
  tradesCol.className = 'friends-stat-col';
  const tradesLabel = document.createElement('span');
  tradesLabel.className = 'friends-stat-label';
  tradesLabel.textContent = '7D TRADES';
  const tradesVal = document.createElement('span');
  const tradesRaw = statsPrivate ? null : (Number.isFinite(Number(friend.trades_7d)) ? Number(friend.trades_7d) : null);
  tradesVal.className = `friends-stat-value ${tradesRaw === null ? 'friends-stat-value--na' : ''}`;
  tradesVal.textContent = tradesRaw === null ? '—' : String(tradesRaw);
  tradesCol.appendChild(tradesLabel);
  tradesCol.appendChild(tradesVal);
  row.appendChild(tradesCol);

  // 6) Actions: message + more
  const actionsCol = document.createElement('div');
  actionsCol.className = 'friends-actions-col';

  const msgBtn = document.createElement('button');
  msgBtn.type = 'button';
  msgBtn.className = 'friends-icon-btn';
  msgBtn.title = 'Message';
  msgBtn.setAttribute('aria-label', `Message ${friend.nickname || 'friend'}`);
  msgBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 3h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4l-3 2V4a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  msgBtn.addEventListener('click', (e) => { e.stopPropagation(); });
  actionsCol.appendChild(msgBtn);

  // More menu
  const moreWrap = document.createElement('div');
  moreWrap.className = 'friends-more-menu-wrap';

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'friends-icon-btn';
  moreBtn.title = 'More options';
  moreBtn.setAttribute('aria-label', `More options for ${friend.nickname || 'friend'}`);
  moreBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="3" r="1.25" fill="currentColor"/><circle cx="8" cy="8" r="1.25" fill="currentColor"/><circle cx="8" cy="13" r="1.25" fill="currentColor"/></svg>`;

  const moreMenu = document.createElement('div');
  moreMenu.className = 'friends-more-dropdown hidden';

  const viewProfileOpt = document.createElement('button');
  viewProfileOpt.type = 'button';
  viewProfileOpt.className = 'friends-more-option';
  viewProfileOpt.textContent = 'View profile';
  viewProfileOpt.addEventListener('click', (e) => { e.stopPropagation(); moreMenu.classList.add('hidden'); });
  moreMenu.appendChild(viewProfileOpt);

  const removeOpt = document.createElement('button');
  removeOpt.type = 'button';
  removeOpt.className = 'friends-more-option friends-more-option--danger';
  removeOpt.textContent = 'Remove friend';
  removeOpt.disabled = socialState.friendActionIds.has(friend.friend_user_id) || socialState.isGuest || socialState.nicknameRequired;
  removeOpt.addEventListener('click', (e) => {
    e.stopPropagation();
    moreMenu.classList.add('hidden');
    showRemoveFriendModal(friend.friend_user_id, friend.nickname || 'this friend');
  });
  moreMenu.appendChild(removeOpt);

  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = moreMenu.classList.toggle('hidden');
    moreBtn.setAttribute('aria-expanded', String(!isHidden));
    if (!isHidden) {
      const closeOnOutside = (ev) => {
        if (!moreWrap.contains(ev.target)) {
          moreMenu.classList.add('hidden');
          document.removeEventListener('click', closeOnOutside);
        }
      };
      document.addEventListener('click', closeOnOutside);
    }
  });

  moreWrap.appendChild(moreBtn);
  moreWrap.appendChild(moreMenu);
  actionsCol.appendChild(moreWrap);
  row.appendChild(actionsCol);

  return row;
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
  const incomingWrap = getEl('friends-incoming-wrap');
  const outgoingWrap = getEl('friends-outgoing-wrap');
  const howItWorksWrap = getEl('friends-howitworks-wrap');
  const incomingPill = getEl('friends-incoming-pill');
  const outgoingPill = getEl('friends-outgoing-pill');
  const countPill = getEl('friends-list-count-pill');

  clearNode(incomingEl);
  clearNode(outgoingEl);
  clearNode(friendsEl);

  renderFriendsPageSubtitle();

  if (socialState.friendsError) {
    const makeErr = () => {
      const d = document.createElement('div');
      d.className = 'friends-empty-state';
      const t = document.createElement('p'); t.className = 'friends-empty-state-title'; t.textContent = 'Friend data unavailable';
      const s = document.createElement('p'); s.className = 'friends-empty-state-detail'; s.textContent = socialState.friendsError;
      d.appendChild(t); d.appendChild(s);
      return d;
    };
    if (friendsEl) friendsEl.appendChild(makeErr());
    if (incomingWrap) incomingWrap.classList.add('hidden');
    if (outgoingWrap) outgoingWrap.classList.add('hidden');
    renderSocialOverview();
    return;
  }

  // ── Incoming requests ─────────────────────────────────────
  const incoming = socialState.incomingRequests;
  if (incomingWrap) incomingWrap.classList.toggle('hidden', incoming.length === 0);
  if (incomingPill) incomingPill.textContent = String(incoming.length);

  incoming.forEach(request => {
    const display = getRequestUserDisplay(request);
    const busy = socialState.requestActionIds.has(request.id);
    const disabled = busy || socialState.isGuest || socialState.nicknameRequired;

    const requestRow = document.createElement('div');
    requestRow.className = 'friends-request-row';

    const identity = document.createElement('div');
    identity.className = 'friends-request-identity';
    const av = window.VeracitySocialAvatar?.createAvatar({ nickname: display.name, avatar_url: request.counterparty_avatar_url, avatar_initials: request.counterparty_avatar_initials }, 'sm');
    if (av) identity.appendChild(av);
    const textWrap = document.createElement('div');
    textWrap.className = 'friends-request-identity-text';
    const nameEl = document.createElement('span'); nameEl.className = 'friends-request-name'; nameEl.textContent = display.name;
    const metaEl = document.createElement('span'); metaEl.className = 'friends-request-meta';
    metaEl.textContent = request.created_at ? formatRelativeTime(request.created_at) + ' ago' : 'Recently';
    textWrap.appendChild(nameEl); textWrap.appendChild(metaEl);
    identity.appendChild(textWrap);
    requestRow.appendChild(identity);

    const actions = document.createElement('div');
    actions.className = 'friends-request-actions';
    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button'; acceptBtn.className = 'friends-request-accept-btn';
    acceptBtn.textContent = 'Accept'; acceptBtn.disabled = disabled;
    acceptBtn.addEventListener('click', () => respondToRequest(request.id, 'accept'));
    const declineBtn = document.createElement('button');
    declineBtn.type = 'button'; declineBtn.className = 'friends-request-decline-btn';
    declineBtn.textContent = 'Decline'; declineBtn.disabled = disabled;
    declineBtn.addEventListener('click', () => respondToRequest(request.id, 'decline'));
    actions.appendChild(acceptBtn); actions.appendChild(declineBtn);
    requestRow.appendChild(actions);

    incomingEl?.appendChild(requestRow);
  });

  // ── Outgoing requests ─────────────────────────────────────
  const outgoing = socialState.outgoingRequests;
  if (outgoingWrap) outgoingWrap.classList.toggle('hidden', outgoing.length === 0);
  if (outgoingPill) outgoingPill.textContent = String(outgoing.length);

  outgoing.forEach(request => {
    const display = getRequestUserDisplay(request);
    const disabled = socialState.requestActionIds.has(request.id) || socialState.isGuest || socialState.nicknameRequired;

    const requestRow = document.createElement('div');
    requestRow.className = 'friends-request-row';

    const identity = document.createElement('div');
    identity.className = 'friends-request-identity';
    const av = window.VeracitySocialAvatar?.createAvatar({ nickname: display.name, avatar_url: request.counterparty_avatar_url, avatar_initials: request.counterparty_avatar_initials }, 'sm');
    if (av) identity.appendChild(av);
    const textWrap = document.createElement('div');
    textWrap.className = 'friends-request-identity-text';
    const nameEl = document.createElement('span'); nameEl.className = 'friends-request-name'; nameEl.textContent = display.name;
    const metaEl = document.createElement('span'); metaEl.className = 'friends-request-meta';
    metaEl.textContent = request.created_at ? 'Sent ' + formatRelativeTime(request.created_at) + ' ago' : 'Sent recently';
    textWrap.appendChild(nameEl); textWrap.appendChild(metaEl);
    identity.appendChild(textWrap);
    requestRow.appendChild(identity);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'friends-request-cancel-btn';
    cancelBtn.textContent = 'Cancel request'; cancelBtn.disabled = disabled;
    cancelBtn.addEventListener('click', () => respondToRequest(request.id, 'cancel'));
    requestRow.appendChild(cancelBtn);

    outgoingEl?.appendChild(requestRow);
  });

  // ── How it works card ─────────────────────────────────────
  const friendCount = Array.isArray(socialState.friends) ? socialState.friends.length : 0;
  if (howItWorksWrap) howItWorksWrap.classList.toggle('hidden', friendCount > 3);

  // ── Friends list ──────────────────────────────────────────
  if (countPill) countPill.textContent = String(friendCount);

  const filtered = applyFriendsSortFilter(socialState.friends);

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'friends-empty-state';
    const title = document.createElement('p'); title.className = 'friends-empty-state-title';
    const detail = document.createElement('p'); detail.className = 'friends-empty-state-detail';
    if (friendCount === 0) {
      title.textContent = 'No friends yet';
      detail.textContent = 'Enter a friend code above to send your first request.';
    } else {
      title.textContent = 'No friends match your search';
      detail.textContent = 'Try a different name or clear the filter.';
    }
    empty.appendChild(title); empty.appendChild(detail);
    friendsEl?.appendChild(empty);
  } else {
    filtered.forEach(friend => {
      friendsEl?.appendChild(buildFriendRow(friend));
    });
  }

  renderSocialOverview();
}

// Relative time helper for request cards (e.g. "2h")
function formatRelativeTime(value) {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  if (ms < 0) return '';
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}


function formatInviteTimestamp(value) {
  if (!value) return 'Pending';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Pending';
  return parsed.toLocaleString();
}

function formatRelativeTimestamp(value) {
  if (!value) return 'No recent activity';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No recent activity';
  const deltaMs = Date.now() - parsed.getTime();
  if (deltaMs < 60_000) return 'Just now';
  if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs < 86_400_000) return `${Math.floor(deltaMs / 3_600_000)}h ago`;
  return parsed.toLocaleString();
}

function truncateActivitySummary(text, maxLength = 96) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function summarizeSellActivity(item, classification = normalizeTradeGroupActivityEvent(item)) {
  const rawText = String(item?.text || '').trim();
  const lower = rawText.toLowerCase();
  const realizedPercent = Number(item?.pnl_percent ?? item?.realized_pnl_percent ?? item?.percent_change);

  if (classification === 'trim') {
    const trimPct = toNumericOrNull(item?.trim_pct ?? item?.trim_percent);
    const ticker = String(item?.ticker || '').trim().toUpperCase();
    if (trimPct !== null && ticker) return `Trimmed ${trimPct}% of ${ticker}`;
    if (trimPct !== null) return `Trimmed ${trimPct}%`;
    if (rawText && !/(close|closed|exit|exited)/.test(lower)) return truncateActivitySummary(rawText, 60);
    return 'Trimmed position';
  }

  if (classification === 'close') {
    if (Number.isFinite(realizedPercent)) {
      const sign = realizedPercent > 0 ? '+' : '';
      return `Closed ${sign}${realizedPercent.toFixed(2)}%`;
    }
    if (!rawText) return 'Closed position';
    if (/(stopped out|hit stop|stop loss|closed at stop|at stop)/.test(lower)) return 'Closed at stop';
    if (/(close|closed|exit|exited)/.test(lower)) return 'Closed position';
  }

  if (classification === 'stop_move') {
    if (/stop/.test(lower)) {
      const stopMatch = rawText.match(/(?:to|at)\s*([0-9]+(?:\.[0-9]+)?)/i);
      if (stopMatch?.[1]) return `Stop moved to ${Number(stopMatch[1]).toFixed(2)}`;
    }
    return 'Stop moved';
  }

  if (!rawText) return classification === 'open' ? 'Opened position' : 'Position update';
  if (/(partial|partially|scale|scaled|trim|trimmed|reduce|reduced)/.test(lower)) return 'Trimmed position';
  if (/(close|closed|exit|exited)/.test(lower)) return 'Closed position';
  return truncateActivitySummary(rawText, 60);
}

function formatBuyDecisionStrip(item) {
  const entry = Number(item?.entry_price);
  const stop = Number(item?.stop_price);
  const risk = Number(item?.risk_pct);
  const entryLabel = Number.isFinite(entry) ? entry.toFixed(2) : '—';
  const stopLabel = Number.isFinite(stop) ? stop.toFixed(2) : '—';
  const riskLabel = Number.isFinite(risk) ? `${risk.toFixed(2)}%` : '—';
  return `Entry ${entryLabel} • Stop ${stopLabel} • Risk ${riskLabel}`;
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


function formatWatchlistValue(value, kind = 'number') {
  if (value === null || value === undefined) return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  if (kind === 'price') return `$${num.toFixed(num >= 100 ? 2 : 4)}`;
  if (kind === 'percent') return `${num > 0 ? '+' : ''}${num.toFixed(2)}%`;
  if (kind === 'volume') {
    const abs = Math.abs(num);
    if (abs >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return num.toFixed(0);
  }
  return num.toFixed(2);
}

function renderGroupWatchlistsSection(isLeader = false) {
  const listEl = getEl('social-group-watchlists-list');
  const postSelect = getEl('social-group-post-watchlist-select');
  const postBtn = getEl('social-group-post-watchlist-btn');
  const feedback = getEl('social-group-watchlist-feedback');
  if (listEl) listEl.innerHTML = '';

  if (postSelect) {
    postSelect.innerHTML = '';
    const mine = Array.isArray(socialState.myWatchlists) ? socialState.myWatchlists : [];
    if (!isLeader || !mine.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = isLeader ? 'No personal watchlists found' : 'Leader only';
      postSelect.appendChild(option);
      postSelect.disabled = true;
      if (postBtn) postBtn.disabled = true;
    } else {
      mine.forEach((watchlist) => {
        const option = document.createElement('option');
        option.value = watchlist.id;
        option.textContent = `${watchlist.name} (${watchlist.tickerCount || 0})`;
        postSelect.appendChild(option);
      });
      postSelect.disabled = false;
      if (postBtn) postBtn.disabled = false;
    }
  }

  const rows = Array.isArray(socialState.selectedTradeGroupWatchlists) ? socialState.selectedTradeGroupWatchlists : [];
  if (!rows.length) {
    listEl?.appendChild(createEmptyState('No shared watchlists yet', isLeader ? 'Post one of your personal watchlists to this group.' : 'The group leader has not posted any watchlists yet.'));
    setFeedback(feedback, '', 'muted');
    return;
  }

  const activeWatchlistIds = new Set(rows.map((item) => String(item?.id || '')).filter(Boolean));
  socialState.expandedGroupWatchlistIds = new Set(
    [...socialState.expandedGroupWatchlistIds].filter((id) => activeWatchlistIds.has(id))
  );
  Object.keys(socialState.expandedGroupWatchlistSections).forEach((watchlistId) => {
    if (!activeWatchlistIds.has(watchlistId)) delete socialState.expandedGroupWatchlistSections[watchlistId];
  });

  rows.forEach((posted) => {
    const watchlistId = String(posted?.id || '');
    const card = document.createElement('article');
    card.className = 'social-list-row social-list-row--request social-watchlist-card';
    if (watchlistId) card.dataset.watchlistId = watchlistId;
    const head = document.createElement('div');
    head.className = 'social-watchlist-head';

    const cachedDetail = watchlistId ? socialState.selectedTradeGroupWatchlistDetailById[watchlistId] : null;
    const detailRows = Array.isArray(cachedDetail?.rows) ? cachedDetail.rows : [];
    const rowsByTicker = new Map(detailRows.map((row) => [String(row.ticker || '').toUpperCase(), row]));
    const summarySections = Array.isArray(posted.sections) ? posted.sections : [];
    const totalTickerCount = Number.isFinite(Number(posted.tickerCount))
      ? Number(posted.tickerCount)
      : summarySections.reduce((sum, section) => sum + Number(section?.tickerCount || 0), 0);
    const visibleSections = cachedDetail && Array.isArray(cachedDetail.sections)
      ? cachedDetail.sections
        .map((section, index) => ({
          id: toStableWatchlistSectionId(watchlistId, section, index),
          title: section?.title || `Section ${index + 1}`,
          tickers: (section?.tickers || []).map((ticker) => String(ticker || '').toUpperCase()).filter(Boolean)
        }))
        .filter((section) => section.tickers.length > 0)
      : summarySections.map((section, index) => ({
        id: toStableWatchlistSectionId(watchlistId, section, index),
        title: section?.title || `Section ${index + 1}`,
        tickerCount: Number(section?.tickerCount || 0)
      }));
    const visibleSectionIds = new Set(visibleSections.map((section) => section.id));
    const expandedSectionState = Object.entries(socialState.expandedGroupWatchlistSections[watchlistId] || {})
      .reduce((acc, [sectionId, isExpanded]) => {
        if (visibleSectionIds.has(sectionId) && Boolean(isExpanded)) acc[sectionId] = true;
        return acc;
      }, {});
    socialState.expandedGroupWatchlistSections[watchlistId] = expandedSectionState;
    const isWatchlistExpanded = socialState.expandedGroupWatchlistIds.has(watchlistId);

    head.innerHTML = `
      <div class="social-watchlist-title-row">
        <strong>${posted.title || posted.name || 'Watchlist'}</strong>
        <button class="ghost social-watchlist-expand-toggle" type="button" data-expand-watchlist="${watchlistId}">${isWatchlistExpanded ? 'Collapse' : 'Expand'}</button>
      </div>
      <div class="social-watchlist-chip-row">
        <span class="social-watchlist-chip">By ${posted.postedByName || 'Leader'}</span>
        <span class="social-watchlist-chip">${posted.createdAt ? new Date(posted.createdAt).toLocaleString() : 'Recently'}</span>
        <span class="social-watchlist-chip">${visibleSections.length} sections</span>
        <span class="social-watchlist-chip">${totalTickerCount} tickers</span>
      </div>
    `;
    card.appendChild(head);

    if (isLeader) {
      const removeBtn = createActionButton('Remove', 'danger outline');
      removeBtn.addEventListener('click', async () => {
        try {
          await socialApi(`/api/trading-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/watchlists/${encodeURIComponent(posted.id)}`, { method: 'DELETE' });
          setFeedback(feedback, 'Shared watchlist removed.', 'success');
          await loadTradeGroupDetail(socialState.selectedTradeGroupId);
        } catch (error) {
          setFeedback(feedback, error?.message || 'Unable to remove watchlist.', 'error');
        }
      });
      const wrap = document.createElement('div'); wrap.className = 'social-row-actions'; wrap.appendChild(removeBtn);
      card.appendChild(wrap);
    }

    const details = document.createElement('div');
    details.className = `social-watchlist-details ${isWatchlistExpanded ? '' : 'hidden'}`.trim();
    visibleSections.forEach((section) => {
      const sectionCard = document.createElement('details');
      sectionCard.className = 'social-watchlist-section-card';
      sectionCard.dataset.sectionId = section.id;
      sectionCard.open = Boolean(expandedSectionState[section.id]);
      const summary = document.createElement('summary');
      const sectionTickerCount = Array.isArray(section.tickers)
        ? section.tickers.length
        : Number(section.tickerCount || 0);
      summary.innerHTML = `<span>${section.title || 'Section'}</span><span class="helper">${sectionTickerCount} tickers</span>`;
      sectionCard.appendChild(summary);
      const sectionBody = document.createElement('div');
      sectionBody.className = 'social-watchlist-section-body';
      if (cachedDetail && Array.isArray(section.tickers)) {
        section.tickers.forEach((ticker) => {
          const tickerRow = rowsByTicker.get(ticker);
          if (!tickerRow) return;
          const row = document.createElement('div');
          row.className = 'social-watchlist-mini-row';
          row.innerHTML = `<strong>${tickerRow.ticker}</strong><span>${formatWatchlistValue(tickerRow.currentPrice, 'price')}</span><span class="${Number(tickerRow.percentChangeToday) > 0 ? 'is-pos' : (Number(tickerRow.percentChangeToday) < 0 ? 'is-neg' : '')}">${formatWatchlistValue(tickerRow.percentChangeToday, 'percent')}</span>`;
          sectionBody.appendChild(row);
        });
      } else {
        const loadingHint = document.createElement('div');
        loadingHint.className = 'helper';
        loadingHint.textContent = 'Expand to load live ticker rows.';
        sectionBody.appendChild(loadingHint);
      }
      sectionCard.appendChild(sectionBody);
      sectionCard.addEventListener('toggle', () => {
        if (!watchlistId || !section.id) return;
        if (!socialState.expandedGroupWatchlistSections[watchlistId]) {
          socialState.expandedGroupWatchlistSections[watchlistId] = {};
        }
        socialState.expandedGroupWatchlistSections[watchlistId][section.id] = sectionCard.open;
      });
      details.appendChild(sectionCard);
    });
    card.appendChild(details);

    head.querySelector('[data-expand-watchlist]')?.addEventListener('click', async (event) => {
      const isHidden = details.classList.toggle('hidden');
      event.currentTarget.textContent = isHidden ? 'Expand' : 'Collapse';
      if (!watchlistId) return;
      if (isHidden) socialState.expandedGroupWatchlistIds.delete(watchlistId);
      else {
        socialState.expandedGroupWatchlistIds.add(watchlistId);
        if (!socialState.selectedTradeGroupWatchlistDetailById[watchlistId]) {
          try {
            const detailPayload = await socialApi(`/api/trading-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/watchlists/${encodeURIComponent(watchlistId)}?includeMarketRows=1`);
            socialState.selectedTradeGroupWatchlistDetailById[watchlistId] = detailPayload?.watchlist || null;
            logSocialPerf('shared-watchlist-detail-loaded', { groupId: socialState.selectedTradeGroupId, watchlistId });
          } catch (_error) {}
          renderGroupWatchlistsSection(isLeader);
        }
      }
    });
    listEl?.appendChild(card);
  });
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
  const groupWatchlistWrap = getEl('social-group-watchlists-wrap');
  const postWatchlistBtn = getEl('social-group-post-watchlist-btn');

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
    renderSocialOverview();
    return;
  }

  groups.forEach(group => {
    const row = document.createElement('article');
    row.className = 'social-list-row social-list-row--friend';
    row.classList.toggle('is-selected', group.id === socialState.selectedTradeGroupId);
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.appendChild(createIdentityRow(group.name || 'Unnamed group', `${group.member_count || 0} members`, group.role === 'leader' ? 'Leader' : 'Member', group?.leader || {}));
    row.addEventListener('click', () => loadTradeGroupDetail(group.id));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        loadTradeGroupDetail(group.id);
      }
    });
    listEl?.appendChild(row);
  });

  const selected = groups.find(group => group.id === socialState.selectedTradeGroupId);
  if (!selected) {
    if (detailPanelEl) detailPanelEl.classList.add('hidden');
    if (detailContentEl) detailContentEl.classList.add('hidden');
    renderSocialOverview();
    return;
  }

  if (detailPanelEl) detailPanelEl.classList.remove('hidden');
  if (detailContentEl) detailContentEl.classList.remove('hidden');
  if (headingEl) headingEl.textContent = `${selected.name} • ${selected.role === 'leader' ? 'Leader view' : 'Member view'}`;

  const inviteShortcutBtn = getEl('social-group-invite-shortcut');
  const leaveGroupBtn = getEl('social-group-leave-btn');
  const settingsShortcutBtn = getEl('social-group-settings-shortcut');

  const isLeader = selected.role === 'leader';
  leaderOnlyNodes.forEach(node => node.classList.toggle('hidden', !isLeader));
  if (inviteShortcutBtn) {
    inviteShortcutBtn.disabled = !isLeader;
    inviteShortcutBtn.onclick = () => getEl('social-group-friend-select')?.focus();
  }
  if (settingsShortcutBtn) {
    settingsShortcutBtn.onclick = () => { window.location.href = '/social/profile'; };
  }
  if (leaveGroupBtn) {
    leaveGroupBtn.disabled = isLeader || !socialState.profile?.user_id;
    leaveGroupBtn.title = isLeader ? 'Leaders can delete the group instead.' : '';
    leaveGroupBtn.onclick = async () => {
      if (!socialState.profile?.user_id || !socialState.selectedTradeGroupId) return;
      if (!window.confirm('Leave this trade group?')) return;
      try {
        await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/members/${encodeURIComponent(socialState.profile.user_id)}`, { method: 'DELETE' });
        await loadTradeGroups();
      } catch (_error) {}
    };
  }

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
  if (groupWatchlistWrap) groupWatchlistWrap.classList.remove('hidden');
  if (postWatchlistBtn) {
    postWatchlistBtn.classList.toggle('hidden', !isLeader);
    postWatchlistBtn.onclick = async () => {
      const select = getEl('social-group-post-watchlist-select');
      const feedback = getEl('social-group-watchlist-feedback');
      const sourceWatchlistId = String(select?.value || '').trim();
      if (!sourceWatchlistId) return setFeedback(feedback, 'Select a watchlist to post.', 'error');
      try {
        await socialApi(`/api/trading-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/watchlists`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceWatchlistId })
        });
        setFeedback(feedback, 'Watchlist posted to group.', 'success');
        await loadTradeGroupDetail(socialState.selectedTradeGroupId);
      } catch (error) {
        setFeedback(feedback, error?.message || 'Unable to post watchlist.', 'error');
      }
    };
  }

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
      const normalizedClassification = normalizeTradeGroupActivityEvent(item);
      if (SOCIAL_ACTIVITY_DEBUG) {
        console.info('[social-activity-render]', {
          itemId: item?.id || null,
          source: item?.type || 'alert',
          side: String(item?.side || '').trim().toUpperCase() || null,
          classification: String(item?.alert_classification || '').trim().toLowerCase() || null,
          positionEventType: String(item?.position_event_type || item?.event_type || '').trim().toUpperCase() || null,
          normalizedClassification
        });
      }
      const isTrim = normalizedClassification === 'trim';
      const isAdd = normalizedClassification === 'add';
      const isSell = normalizedClassification === 'trim' || normalizedClassification === 'close';
      const eventType = String(item?.position_event_type || item?.event_type || '').trim().toUpperCase();
      const copyLabel = isSell
        ? (isTrim ? 'reduced' : 'closed')
        : (isAdd ? 'added to' : 'opened');
      console.info('[trade-alert-copy] eventType and chosen copy label', { eventType: eventType || null, copyLabel });
      if (!isSell) {
        console.info('[trade-alert-copy] buy-path', {
          eventType: eventType || null,
          branch: isAdd ? 'POSITION_INCREASE' : 'NEW_POSITION'
        });
      }
      if (isTrim) row.classList.add('social-list-row--trim');
      const prefillPayload = normalizeAlertRiskPrefillPayload(item);
      const canSizeTrade = !isSell && !!prefillPayload;
      const missingStop = !isSell && Number(item.stop_price) <= 0;
      const trimPctLabel = Number.isFinite(Number(item.trim_pct)) ? `${Number(item.trim_pct).toFixed(Number(item.trim_pct) % 1 === 0 ? 0 : 1)}%` : '';
      const fillPriceLabel = Number.isFinite(Number(item.fill_price)) ? Number(item.fill_price).toFixed(2) : '';
      row.appendChild(createIdentityRow(
        item.leader_nickname || 'Leader',
        item.created_at ? new Date(item.created_at).toLocaleString() : '',
        isSell
          ? (isTrim ? `${item.ticker} · Trimmed${trimPctLabel ? ` ${trimPctLabel}` : ''}` : `${item.ticker} · Closed`)
          : (isAdd ? `${item.ticker} · Added to` : `${item.ticker} · Opened`),
        { avatar_url: item.leader_avatar_url, avatar_initials: item.leader_avatar_initials }
      ));
      const meta = document.createElement('div');
      meta.className = 'helper';
      meta.textContent = isSell
        ? (isTrim
          ? `${item.leader_nickname || 'Leader'} trimmed ${trimPctLabel || 'part of'} ${item.ticker}${fillPriceLabel ? ` at $${fillPriceLabel}` : ''}.`
          : `${item.leader_nickname || 'Leader'} closed ${item.ticker}${fillPriceLabel ? ` at $${fillPriceLabel}` : ''}.`)
        : `${item.leader_nickname || 'Leader'} ${isAdd ? 'added to' : 'opened'} ${item.ticker}${fillPriceLabel ? ` at $${fillPriceLabel}` : ''}.`;
      row.appendChild(meta);
      if (canSizeTrade || isLeader || missingStop) {
        const actionWrap = document.createElement('div');
        actionWrap.className = 'social-row-actions';
        if (!isLeader) {
          const sizeBtn = createActionButton('Size This Trade', 'ghost social-size-alert-btn');
          if (missingStop) {
            sizeBtn.disabled = true;
            sizeBtn.title = 'Stop required for risk sizing';
          } else if (canSizeTrade) {
            sizeBtn.addEventListener('click', () => launchAlertRiskSizing(item));
          } else {
            sizeBtn.disabled = true;
          }
          actionWrap.appendChild(sizeBtn);
        }
        if (isLeader) {
          const delBtn = createActionButton('Delete', 'danger outline');
          delBtn.addEventListener('click', async () => { try { await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/alerts/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); await loadTradeGroupDetail(socialState.selectedTradeGroupId); } catch (_e) {} });
          actionWrap.appendChild(delBtn);
        }
        row.appendChild(actionWrap);
      }
    }
    alertsEl?.appendChild(row);
  });
  renderGroupWatchlistsSection(isLeader);
  renderSocialOverview();
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
      await loadTradeGroupDetail(socialState.selectedTradeGroupId, { rerenderList: false, summaryOnly: !canLoadTradeGroupHeavySections(), reason: 'group-initial-selected' });
      return;
    }
    if (socialState.selectedTradeGroupId) {
      await loadTradeGroupDetail(socialState.selectedTradeGroupId, { rerenderList: false, reason: 'groups_poll_refresh', summaryOnly: !canLoadTradeGroupHeavySections() });
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
  const refreshReason = opts.reason || 'manual';
  const summaryOnly = opts.summaryOnly === true || !canLoadTradeGroupHeavySections();
  if (socialState.selectedTradeGroupId && socialState.selectedTradeGroupId !== groupId) {
    socialState.selectedTradeGroupWatchlistDetailById = {};
  }
  try {
    const basePath = `/api/social/trade-groups/${encodeURIComponent(groupId)}`;
    const detailPath = summaryOnly ? `${basePath}?view=summary&feed_limit=8` : basePath;
    const response = await socialApi(detailPath);
    socialState.selectedTradeGroupId = groupId;
    socialState.selectedTradeGroupMembers = Array.isArray(response?.members) ? response.members : [];
    socialState.selectedTradeGroupPendingInvites = Array.isArray(response?.pending_invites) ? response.pending_invites : [];
    socialState.selectedTradeGroupPositions = Array.isArray(response?.current_positions) ? response.current_positions : [];
    socialState.selectedTradeGroupAlerts = Array.isArray(response?.feed) ? response.feed : [];
    socialState.selectedTradeGroupRole = response?.group?.role || '';
    if (!summaryOnly) {
      try {
        const watchlistPayload = await socialApi(`/api/trading-groups/${encodeURIComponent(groupId)}/watchlists?view=summary`);
        socialState.selectedTradeGroupWatchlists = Array.isArray(watchlistPayload?.watchlists) ? watchlistPayload.watchlists : [];
        const validIds = new Set(socialState.selectedTradeGroupWatchlists.map((item) => String(item?.id || '')).filter(Boolean));
        socialState.selectedTradeGroupWatchlistDetailById = Object.fromEntries(
          Object.entries(socialState.selectedTradeGroupWatchlistDetailById || {}).filter(([watchlistId]) => validIds.has(watchlistId))
        );
      } catch (_error) {
        socialState.selectedTradeGroupWatchlists = [];
        socialState.selectedTradeGroupWatchlistDetailById = {};
      }

      if (response?.group?.role === 'leader') {
        try {
          const mine = await socialApi('/api/watchlists?view=summary');
          socialState.myWatchlists = Array.isArray(mine?.watchlists) ? mine.watchlists : [];
        } catch (_error) {
          socialState.myWatchlists = [];
        }
      } else {
        socialState.myWatchlists = [];
      }
    } else {
      socialState.selectedTradeGroupWatchlists = [];
      socialState.selectedTradeGroupWatchlistDetailById = {};
      socialState.myWatchlists = [];
    }

    const newestFeedId = socialState.selectedTradeGroupAlerts[0]?.id || '';
    if (newestFeedId && newestFeedId !== socialState.lastSeenTradeGroupFeedId) {
      if (socialState.lastSeenTradeGroupFeedId) {
        socialState.liveFeedFlashUntil = Date.now() + 1200;
        window.setTimeout(() => renderSocialOverview(), 1250);
      }
      console.info(`[social] trade-group feed updated group=${groupId} topFeedId=${newestFeedId} reason=${refreshReason}`);
      socialState.lastSeenTradeGroupFeedId = newestFeedId;
    }
    if (!summaryOnly && response?.group?.role === 'leader') {
      try {
        const eligibleResponse = await socialApi(`/api/social/trade-groups/${encodeURIComponent(groupId)}/eligible-friends`);
        socialState.eligibleTradeGroupFriends = Array.isArray(eligibleResponse?.eligible) ? eligibleResponse.eligible : [];
      } catch (_error) {
        socialState.eligibleTradeGroupFriends = [];
      }
    } else {
      socialState.eligibleTradeGroupFriends = [];
    }
    const nextFeedSignature = `${groupId}|${socialState.selectedTradeGroupAlerts.slice(0, 8).map((item) => item?.id || item?.created_at || '').join('|')}`;
    if (socialState.tradeGroupFeedSignature === nextFeedSignature) {
      logSocialPerf('social-refresh-skipped', { reason: 'trade-group-feed-signature-match', summaryOnly, refreshReason });
    } else {
      socialState.tradeGroupFeedSignature = nextFeedSignature;
      logSocialPerf(summaryOnly ? 'social-bootstrap-used' : 'social-thread-detail-loaded', { section: 'trade-groups', refreshReason, feedCount: socialState.selectedTradeGroupAlerts.length });
    }
  } catch (_error) {
    socialState.selectedTradeGroupMembers = [];
    socialState.selectedTradeGroupPendingInvites = [];
    socialState.selectedTradeGroupPositions = [];
    socialState.selectedTradeGroupAlerts = [];
    socialState.selectedTradeGroupWatchlists = [];
    socialState.selectedTradeGroupWatchlistDetailById = {};
    socialState.myWatchlists = [];
  }
  const nextRenderSignature = computeTradeGroupDetailRenderSignature(groupId, summaryOnly);
  if (socialState.tradeGroupDetailRenderSignature === nextRenderSignature) {
    logSocialPerf('social-refresh-skipped', {
      reason: 'trade-group-render-signature-match',
      summaryOnly,
      refreshReason
    });
    return;
  }
  socialState.tradeGroupDetailRenderSignature = nextRenderSignature;
  renderTradeGroupSection();
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
  socialState.selectedTradeGroupWatchlists = [];
  socialState.myWatchlists = [];
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
  const previousSignature = JSON.stringify({
    unread: (socialState.unreadTradeGroupNotifications || []).map((item) => item?.notification_id || '').join('|'),
    pending: (socialState.pendingTradeGroupInvites || []).map((item) => item?.invite_id || '').join('|')
  });
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
  const nextSignature = JSON.stringify({
    unread: (socialState.unreadTradeGroupNotifications || []).map((item) => item?.notification_id || '').join('|'),
    pending: (socialState.pendingTradeGroupInvites || []).map((item) => item?.invite_id || '').join('|')
  });
  if (previousSignature === nextSignature) {
    logSocialPerf('social-refresh-skipped', { reason: 'trade-group-notification-signature-match' });
    return;
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

const FRIEND_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4,9}$/;

function updateAddFriendState() {
  const input = getEl('social-add-friend-code');
  const button = getEl('social-add-friend-btn');
  const rawVal = String(input?.value || '');
  const isValidFormat = FRIEND_CODE_PATTERN.test(rawVal);
  const canSubmit = isValidFormat && !socialState.addFriendBusy && !socialState.friendsLoading && !socialState.isGuest && !socialState.nicknameRequired;
  if (button) {
    button.disabled = !canSubmit;
    button.textContent = socialState.addFriendBusy ? 'Sending…' : 'Send request';
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
    setFeedback(feedback, '');
    if (response?.autoAccepted) {
      showToast(`Connected with ${response?.nickname || 'trader'}.`, 'success');
    } else {
      const name = response?.nickname;
      showToast(name ? `Request sent to ${name}` : 'Request sent', 'success');
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
    if (action === 'accept') {
      const accepted = socialState.incomingRequests.find((item) => item.id === requestId);
      if (accepted) {
        socialState.friends = [normalizeFriend(accepted.counterparty || {
          friend_user_id: accepted.counterparty_user_id,
          nickname: accepted.counterparty_nickname,
          friend_code: accepted.counterparty_friend_code,
          verification_status: accepted.counterparty_verification_status,
          verification_source: accepted.counterparty_verification_source,
          avatar_url: accepted.counterparty_avatar_url,
          avatar_initials: accepted.counterparty_avatar_initials
        }), ...socialState.friends].filter(Boolean);
      }
    }
    socialState.incomingRequests = socialState.incomingRequests.filter((item) => item.id !== requestId);
    socialState.outgoingRequests = socialState.outgoingRequests.filter((item) => item.id !== requestId);
    renderFriendSection();
    logSocialPerf('social-action-patch-applied', { action: `friend-request-${action}` });
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

  const removedName = (Array.isArray(socialState.friends) ? socialState.friends : [])
    .find(f => String(f?.friend_user_id || '') === String(friendUserId))?.nickname || '';

  try {
    await socialApi(`/api/social/friends/${encodeURIComponent(friendUserId)}`, { method: 'DELETE' });
    socialState.friends = socialState.friends.filter((friend) => String(friend?.friend_user_id || '') !== String(friendUserId));
    renderFriendSection();
    if (removedName) showToast(`Removed ${removedName}`, 'neutral');
    logSocialPerf('social-action-patch-applied', { action: 'friend-remove' });
    await triggerSocialRefresh('friend-removed');
  } catch (error) {
    socialState.friendsError = error.message || 'Unable to remove friend.';
    renderFriendSection();
    showToast('Could not remove friend. Try again.', 'error');
  } finally {
    socialState.friendActionIds.delete(friendUserId);
    renderFriendSection();
  }
}

function applySharedSocialState(shared) {
  if (!shared || typeof shared !== 'object') return;
  const nextSignature = JSON.stringify({
    nicknameRequired: !!shared.nicknameRequired,
    error: shared.error || '',
    friends: (Array.isArray(shared.friends) ? shared.friends : []).map((item) => item?.friend_user_id || '').join('|'),
    incoming: (Array.isArray(shared.incomingRequests) ? shared.incomingRequests : []).map((item) => item?.id || '').join('|'),
    outgoing: (Array.isArray(shared.outgoingRequests) ? shared.outgoingRequests : []).map((item) => item?.id || '').join('|'),
    accepted: (Array.isArray(shared.acceptedOutgoingRequests) ? shared.acceptedOutgoingRequests : []).map((item) => item?.id || '').join('|')
  });
  if (socialState.friendStateSignature === nextSignature) {
    logSocialPerf('social-refresh-skipped', { reason: 'shared-friend-state-signature-match' });
    return;
  }
  socialState.friendStateSignature = nextSignature;
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
    // Auto-uppercase and auto-insert hyphen after position 4
    const raw = String(input.value || '').replace(/[^A-Z0-9a-z]/gi, '').toUpperCase().slice(0, 8);
    const formatted = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
    if (input.value !== formatted) input.value = formatted;
    setFeedback(getEl('social-add-friend-feedback'), '');
    updateAddFriendState();
  });
  // Handle paste: strip dashes and spaces then re-format
  input?.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    e.preventDefault();
    const raw = text.replace(/[^A-Z0-9a-z]/gi, '').toUpperCase().slice(0, 8);
    input.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
    setFeedback(getEl('social-add-friend-feedback'), '');
    updateAddFriendState();
  });
}

function bindFriendsPageActions() {
  // Own code copy/share
  getEl('friends-copy-code-btn')?.addEventListener('click', copyOwnFriendCode);
  getEl('friends-share-code-btn')?.addEventListener('click', shareOwnFriendCode);

  // Remove modal
  getEl('friends-remove-cancel-btn')?.addEventListener('click', hideRemoveFriendModal);
  getEl('friends-remove-modal-backdrop')?.addEventListener('click', hideRemoveFriendModal);
  getEl('friends-remove-confirm-btn')?.addEventListener('click', () => {
    const id = socialState.pendingRemoveFriendId;
    hideRemoveFriendModal();
    if (id) removeFriend(id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideRemoveFriendModal();
  });

  // Search
  getEl('friends-search-input')?.addEventListener('input', (e) => {
    socialState.friendsSearch = String(e.target.value || '').toLowerCase();
    renderFriendSection();
  });

  // Sort dropdown
  const sortBtn = getEl('friends-sort-btn');
  const sortDropdown = getEl('friends-sort-dropdown');
  sortBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const hidden = sortDropdown?.classList.toggle('hidden');
    sortBtn.setAttribute('aria-expanded', String(!hidden));
  });
  sortDropdown?.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-sort]');
    if (!opt) return;
    socialState.friendsSortKey = opt.dataset.sort;
    const labelEl = getEl('friends-sort-label');
    if (labelEl) labelEl.textContent = opt.textContent;
    sortDropdown.querySelectorAll('.friends-sort-option').forEach(o => {
      o.classList.toggle('is-selected', o.dataset.sort === socialState.friendsSortKey);
      o.setAttribute('aria-selected', o.dataset.sort === socialState.friendsSortKey ? 'true' : 'false');
    });
    sortDropdown.classList.add('hidden');
    sortBtn?.setAttribute('aria-expanded', 'false');
    renderFriendSection();
  });
  document.addEventListener('click', (e) => {
    const sortControl = getEl('friends-sort-control');
    if (sortControl && !sortControl.contains(e.target)) {
      sortDropdown?.classList.add('hidden');
      sortBtn?.setAttribute('aria-expanded', 'false');
    }
  });

  // Segment filter
  document.querySelectorAll('.friends-segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socialState.friendsFilter = btn.dataset.filter || 'all';
      document.querySelectorAll('.friends-segment-btn').forEach(b =>
        b.classList.toggle('is-active', b.dataset.filter === socialState.friendsFilter)
      );
      renderFriendSection();
    });
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

  // New profile page pill
  const spPill = getEl('sp-verification-pill');
  if (spPill) {
    spPill.textContent = view.label;
    spPill.className = `social-status-pill ${view.badgeClass}`;
  }
}

function renderSocialOverview() {
  const nextSignature = JSON.stringify({
    friends: Array.isArray(socialState.friends) ? socialState.friends.length : 0,
    groups: Array.isArray(socialState.tradeGroups) ? socialState.tradeGroups.length : 0,
    selectedTradeGroupId: socialState.selectedTradeGroupId || '',
    selectedTradeGroupRole: socialState.selectedTradeGroupRole || '',
    feedTop: (Array.isArray(socialState.selectedTradeGroupAlerts) ? socialState.selectedTradeGroupAlerts : []).slice(0, 4).map((item) => item?.id || item?.created_at || '').join('|'),
    feedFilter: socialState.overviewFeedFilter || 'all',
    rankTop: (Array.isArray(socialState.leaderboardEntries) ? socialState.leaderboardEntries : []).slice(0, 3).map((item) => item?.nickname || '').join('|'),
    nickname: socialState.nickname || '',
    verification: socialState.settings?.verification_status || socialState.profile?.verification_status || 'none'
  });
  if (socialState.socialOverviewSignature === nextSignature) {
    logSocialPerf('social-refresh-skipped', { reason: 'overview-signature-match' });
    return;
  }
  socialState.socialOverviewSignature = nextSignature;
  const friendsEl = getEl('social-overview-friends');
  const groupsEl = getEl('social-overview-groups');
  const rankEl = getEl('social-overview-rank');
  const verificationEl = getEl('social-overview-verification');

  if (friendsEl) friendsEl.textContent = String(Array.isArray(socialState.friends) ? socialState.friends.length : 0);
  if (groupsEl) groupsEl.textContent = String(Array.isArray(socialState.tradeGroups) ? socialState.tradeGroups.length : 0);

  if (rankEl) {
    const myNickname = String(socialState.nickname || '').trim().toLowerCase();
    const myEntry = (Array.isArray(socialState.leaderboardEntries) ? socialState.leaderboardEntries : [])
      .find(entry => String(entry?.nickname || '').trim().toLowerCase() === myNickname);
    rankEl.textContent = myEntry?.rank ? `#${myEntry.rank}` : '—';
  }

  if (verificationEl) {
    const status = socialState.settings?.verification_status || socialState.profile?.verification_status || 'none';
    verificationEl.textContent = getVerificationDisplay(status, socialState.settings?.verification_source).label;
  }

  const selectedGroupEl = getEl('social-overview-selected-group');
  const groupMetaEl = getEl('social-overview-group-meta');
  const groupActivityEl = getEl('social-overview-group-activity');
  const groupFeedEl = getEl('social-overview-group-feed');
  const liveIndicatorEl = getEl('social-live-indicator');
  const feedFilterEl = getEl('social-overview-feed-filter');
  const openGroupActionEl = getEl('social-overview-open-group-action');
  const inviteActionEl = getEl('social-overview-invite-action');
  const announceActionEl = getEl('social-overview-announce-action');
  const positionsActionEl = getEl('social-overview-positions-action');
  const group = (Array.isArray(socialState.tradeGroups) ? socialState.tradeGroups : []).find(item => String(item.id) === String(socialState.selectedTradeGroupId))
    || (Array.isArray(socialState.tradeGroups) ? socialState.tradeGroups[0] : null);
  if (selectedGroupEl) selectedGroupEl.textContent = group?.name || 'No group selected';
  if (groupMetaEl) {
    const roleLabel = group?.role === 'leader' ? 'LEADER' : group?.role ? 'MEMBER' : '—';
    const memberCountLabel = Number.isFinite(Number(group?.member_count)) ? String(Number(group.member_count)) : '—';
    groupMetaEl.innerHTML = '';
    if (group?.role) {
      const roleBadge = document.createElement('span');
      roleBadge.className = 'social-role-badge';
      roleBadge.textContent = roleLabel;
      groupMetaEl.appendChild(roleBadge);
    }
    const membersText = document.createTextNode(`${memberCountLabel} members`);
    groupMetaEl.appendChild(membersText);
  }
  const latestAlert = Array.isArray(socialState.selectedTradeGroupAlerts) ? socialState.selectedTradeGroupAlerts[0] : null;
  if (groupActivityEl) {
    const recentActivity = formatRelativeTimestamp(latestAlert?.created_at || latestAlert?.updated_at || null);
    groupActivityEl.textContent = `Last active: ${recentActivity || 'No recent activity'}`;
  }
  if (feedFilterEl) {
    const selectedFilter = socialState.overviewFeedFilter || 'all';
    Array.from(feedFilterEl.querySelectorAll('.social-feed-filter-btn')).forEach((btn) => {
      const value = btn.dataset.feedFilter || 'all';
      const isActive = value === selectedFilter;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }
  if (liveIndicatorEl) {
    liveIndicatorEl.classList.toggle('is-flashing', Date.now() < Number(socialState.liveFeedFlashUntil || 0));
  }
  if (groupFeedEl) {
    clearNode(groupFeedEl);
    const allItems = Array.isArray(socialState.selectedTradeGroupAlerts) ? socialState.selectedTradeGroupAlerts : [];
    const selectedFilter = socialState.overviewFeedFilter || 'all';
    const previewItems = allItems.filter((item) => {
      const type = String(item?.type || '').toLowerCase();
      const side = String(item?.side || '').toUpperCase();
      const isAnnouncement = type === 'announcement';
      const isTrade = side === 'BUY' || side === 'SELL' || type === 'closed' || (!isAnnouncement && type !== 'announcement');
      if (selectedFilter === 'announcements') return isAnnouncement;
      if (selectedFilter === 'trades') return isTrade && !isAnnouncement;
      return true;
    }).slice(0, 4);
    if (!group?.id) {
      groupFeedEl.appendChild(createEmptyState('No active group selected', 'Open Groups to select or create a trading group.'));
    } else if (!previewItems.length) {
      const emptyDetail = selectedFilter === 'all'
        ? 'Activity from your selected group will appear here.'
        : `No ${selectedFilter} activity in this group yet.`;
      groupFeedEl.appendChild(createEmptyState('No recent activity', emptyDetail));
    } else {
      previewItems.forEach(item => {
        const row = document.createElement('article');
        row.className = 'social-list-row social-list-row--request social-list-row--activity';
        const normalizedClassification = normalizeTradeGroupActivityEvent(item);
        const rawType = String(item.type || '').toLowerCase();
        const isAnnouncement = normalizedClassification === 'announcement' || rawType === 'announcement';
        const isSell = normalizedClassification === 'trim' || normalizedClassification === 'close';
        const isBuy = normalizedClassification === 'open';
        const badgeLabel = isAnnouncement
          ? 'ANNOUNCEMENT'
          : normalizedClassification === 'trim'
            ? 'TRIM'
            : isSell
              ? 'SELL'
              : 'BUY';
        if (isBuy) row.classList.add('social-list-row--activity-buy');
        if (isSell) row.classList.add('social-list-row--activity-sell');
        if (isAnnouncement) row.classList.add('social-list-row--activity-announcement');
        const avatarWrap = document.createElement('div');
        const avatar = window.VeracitySocialAvatar?.createAvatar({
          nickname: item.leader_nickname || 'Leader',
          avatar_url: item.leader_avatar_url,
          avatar_initials: item.leader_avatar_initials
        }, 'sm');
        if (avatar) avatarWrap.appendChild(avatar);
        row.appendChild(avatarWrap);

        const main = document.createElement('div');
        main.className = 'social-activity-main';

        const top = document.createElement('div');
        top.className = 'social-activity-top';
        const identity = document.createElement('div');
        identity.className = 'social-activity-identity';
        const user = document.createElement('span');
        user.className = 'social-activity-user';
        user.textContent = item.leader_nickname || 'Leader';
        const ticker = document.createElement('span');
        ticker.className = 'social-activity-ticker';
        ticker.textContent = String(item.ticker || (isAnnouncement ? 'ANNOUNCEMENT' : isSell ? 'POSITION' : 'TRADE'));
        const badge = document.createElement('span');
        badge.className = `social-activity-badge${isBuy ? ' is-buy' : ''}${isSell ? ' is-sell' : ''}${isAnnouncement ? ' is-announcement' : ''}`;
        badge.textContent = badgeLabel;
        identity.appendChild(user);
        identity.appendChild(ticker);
        top.appendChild(identity);
        top.appendChild(badge);
        main.appendChild(top);

        if (isAnnouncement) {
          const announcementWrap = document.createElement('div');
          announcementWrap.className = 'social-activity-announcement';

          const summary = document.createElement('p');
          summary.className = 'social-activity-message social-activity-keyline social-activity-keyline-announcement';
          summary.textContent = item.text || 'Announcement posted to the group.';
          summary.title = item.text || '';
          announcementWrap.appendChild(summary);

          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = 'social-activity-announcement-toggle';
          toggleBtn.textContent = 'View more';
          toggleBtn.setAttribute('aria-expanded', 'false');
          toggleBtn.hidden = true;
          announcementWrap.appendChild(toggleBtn);

          const setExpanded = (expanded) => {
            announcementWrap.classList.toggle('is-expanded', expanded);
            toggleBtn.textContent = expanded ? 'Show less' : 'View more';
            toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          };

          toggleBtn.addEventListener('click', () => {
            setExpanded(!announcementWrap.classList.contains('is-expanded'));
          });

          requestAnimationFrame(() => {
            announcementWrap.classList.add('is-truncated');
            const isOverflowing = summary.scrollHeight > summary.clientHeight + 1;
            announcementWrap.classList.toggle('is-truncated', isOverflowing);
            if (!isOverflowing) setExpanded(false);
            toggleBtn.hidden = !isOverflowing;
          });

          main.appendChild(announcementWrap);
        } else if (isSell) {
          const summary = document.createElement('p');
          summary.className = 'social-activity-message social-activity-keyline';
          summary.textContent = summarizeSellActivity(item, normalizedClassification);
          const overviewLabel = getTradeGroupActivityOverviewLabel(item, normalizedClassification);
          logActivityNormalization(item, normalizedClassification, overviewLabel);
          main.appendChild(summary);
        } else {
          const tradeRow = document.createElement('div');
          tradeRow.className = 'social-activity-trade-row';
          const keyline = document.createElement('p');
          keyline.className = 'social-activity-message social-activity-keyline social-activity-keyline-buy';
          keyline.textContent = formatBuyDecisionStrip(item);
          tradeRow.appendChild(keyline);
          const prefillPayload = normalizeAlertRiskPrefillPayload(item);
          const sizeBtn = createActionButton('Size this trade', 'social-size-alert-btn social-size-alert-btn--compact');
          if (prefillPayload) {
            sizeBtn.addEventListener('click', () => launchAlertRiskSizing(item));
          } else {
            sizeBtn.disabled = true;
            sizeBtn.title = 'Price and stop are required for risk sizing';
          }
          tradeRow.appendChild(sizeBtn);
          main.appendChild(tradeRow);
        }

        const footer = document.createElement('div');
        footer.className = 'social-activity-footer';
        const timestamp = document.createElement('span');
        timestamp.className = 'social-activity-time';
        timestamp.textContent = formatRelativeTimestamp(item.created_at || item.updated_at);
        footer.appendChild(timestamp);
        main.appendChild(footer);

        row.appendChild(main);
        groupFeedEl.appendChild(row);
      });
    }
  }
  const selectedGroupId = String(group?.id || '');
  const groupsHref = selectedGroupId ? `/social/groups?group=${encodeURIComponent(selectedGroupId)}` : '/social/groups';
  if (openGroupActionEl) openGroupActionEl.href = groupsHref;
  if (inviteActionEl) inviteActionEl.href = `${groupsHref}#invite`;
  if (announceActionEl) {
    announceActionEl.href = `${groupsHref}#announcement`;
    announceActionEl.classList.toggle('hidden', group?.role !== 'leader');
  }
  if (positionsActionEl) positionsActionEl.href = `${groupsHref}#positions`;

  const friendsPreviewEl = getEl('social-overview-friends-preview');
  if (friendsPreviewEl) {
    clearNode(friendsPreviewEl);
    const previewFriends = Array.isArray(socialState.friends) ? socialState.friends.slice(0, 3) : [];
    if (!previewFriends.length) {
      friendsPreviewEl.appendChild(createEmptyState('No friends yet', 'Add traders in Friends to build your list.'));
    } else {
      previewFriends.forEach(friend => {
        const row = document.createElement('article');
        row.className = 'social-list-row social-list-row--friend';
        row.appendChild(createIdentityRow(friend.nickname || 'Unknown trader', friend.friend_code || '', '', {
          avatar_url: friend.avatar_url,
          avatar_initials: friend.avatar_initials
        }));
        friendsPreviewEl.appendChild(row);
      });
    }
  }
  logSocialPerf('social-section-reused', { section: 'overview' });
}

function applyProfile(profile) {
  const friendCodeEl = getEl('social-friend-code');
  if (friendCodeEl) {
    friendCodeEl.textContent = profile?.friend_code || 'Unavailable';
  }
  const ownCodeBox = getEl('friends-own-code-box');
  if (ownCodeBox) {
    ownCodeBox.textContent = profile?.friend_code || '—';
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

  // New profile page elements
  const spFriendCode = getEl('sp-friend-code');
  if (spFriendCode) spFriendCode.textContent = profile?.friend_code || 'Unavailable';

  const spAvatarSlot = getEl('sp-profile-avatar');
  if (spAvatarSlot) {
    clearNode(spAvatarSlot);
    const av = window.VeracitySocialAvatar?.createAvatar({
      nickname: socialState.nickname,
      avatar_url: profile?.avatar_url,
      avatar_initials: profile?.avatar_initials
    }, 'lg');
    if (av) spAvatarSlot.appendChild(av);
  }

  const spMockAvatar = getEl('sp-mock-avatar');
  if (spMockAvatar) {
    clearNode(spMockAvatar);
    const av = window.VeracitySocialAvatar?.createAvatar({
      nickname: socialState.nickname,
      avatar_url: profile?.avatar_url,
      avatar_initials: profile?.avatar_initials
    }, 'xs');
    if (av) spMockAvatar.appendChild(av);
  }

  const displayName = socialState.nickname || profile?.nickname || '';
  const spPreviewName = getEl('sp-display-name-preview');
  if (spPreviewName) spPreviewName.textContent = displayName || '—';
  const spMockName = getEl('sp-mock-name');
  if (spMockName) spMockName.textContent = displayName || '—';

  const spMeta = getEl('sp-identity-meta');
  if (spMeta) {
    const src = profile?.verification_source || socialState.settings?.verification_source;
    const created = profile?.created_at
      ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : null;
    const parts = [];
    if (src && src !== 'none') parts.push(`Verified via ${formatVerificationSource(src)}`);
    if (created) parts.push(`member since ${created}`);
    spMeta.textContent = parts.join(' · ') || 'Member';
  }

  // Populate display name input if empty
  const displayNameInput = getEl('sp-input-display-name');
  if (displayNameInput && !displayNameInput.value && displayName) {
    displayNameInput.value = displayName;
  }

  applyVerification(profile, socialState.settings);
  renderSocialOverview();
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
      if (control.options) {
        // select element — fall back to a safe default if value not in options
        const hasOption = Array.from(control.options).some(opt => opt.value === value);
        const fallbackValue = key === 'leaderboard_data_source' ? 'auto' : (control.options[0]?.value ?? '');
        control.value = hasOption ? value : fallbackValue;
      } else {
        // text input or textarea
        control.value = value;
      }
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

  // Legacy data-social-dependent rows (other social pages)
  setDependentGroupState('leaderboard', !leaderboardEnabled);
  setDependentGroupState('trade-sharing', !sharingEnabled);

  // New nested panels on profile page
  const leaderboardPanel = getEl('sp-leaderboard-nested');
  if (leaderboardPanel) leaderboardPanel.classList.toggle('is-visible', leaderboardEnabled);
  const tradeSharingPanel = getEl('sp-trade-sharing-nested');
  if (tradeSharingPanel) tradeSharingPanel.classList.toggle('is-visible', sharingEnabled);
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

  // New profile page elements
  const spRegenBtn = getEl('sp-regenerate-btn');
  if (spRegenBtn) spRegenBtn.disabled = socialState.loading || socialState.isRegenerating || socialState.isGuest || socialState.nicknameRequired;
  const spCopyBtn = getEl('sp-copy-code-btn');
  if (spCopyBtn) spCopyBtn.disabled = socialState.loading;

  updateSaveBar();
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

  const loadingEl = getEl('social-profile-loading') || getEl('sp-settings-loading');
  const errorEl = getEl('social-profile-error') || getEl('sp-settings-error');
  const contentEl = getEl('social-profile-content') || getEl('sp-settings-content');

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
      // Seed display_name from nickname so it starts clean (not dirty) on the profile page
      if (!socialState.initialSettings.display_name && socialState.nickname) {
        socialState.initialSettings.display_name = socialState.nickname;
        socialState.settings.display_name = socialState.nickname;
      }

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

    // New profile page: initial preview render
    if (SOCIAL_PAGE_KIND === 'profile') {
      updatePreview();
      validateTradeSharingWarning();
    }
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
  if (event?.preventDefault) event.preventDefault();
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
    if (SOCIAL_PAGE_KIND === 'profile') showToast('Settings saved.', 'success');
  } catch (error) {
    setFeedback(feedbackEl, error.message || 'Unable to save settings.', 'error');
    if (SOCIAL_PAGE_KIND === 'profile') showToast(error.message || 'Unable to save settings.', 'error');
  } finally {
    socialState.isSaving = false;
    updateActionState();
  }
}

async function regenerateFriendCode() {
  if (socialState.isRegenerating || socialState.isGuest || socialState.nicknameRequired) return;

  // New profile page uses a modal — skip window.confirm there
  if (SOCIAL_PAGE_KIND !== 'profile') {
    const confirmed = window.confirm(
      'Regenerate your friend code? Your previous code will stop working immediately.'
    );
    if (!confirmed) return;
  }

  socialState.isRegenerating = true;
  updateActionState();
  const feedbackEl = getEl('social-regenerate-feedback') || getEl('sp-regen-feedback');

  try {
    await socialApi('/api/social/friend-code/regenerate', { method: 'POST' });
    await loadSocialData();
    if (SOCIAL_PAGE_KIND === 'profile') {
      showToast('New friend code generated — your old code no longer works.', 'success');
    } else {
      setFeedback(feedbackEl, 'Friend code regenerated successfully.', 'success');
    }
  } catch (error) {
    setFeedback(feedbackEl, error.message || 'Unable to regenerate friend code.', 'error');
  } finally {
    socialState.isRegenerating = false;
    updateActionState();
  }
}

async function copyFriendCode() {
  const code = socialState.profile?.friend_code;
  if (!code || code === 'Unavailable') {
    if (SOCIAL_PAGE_KIND === 'profile') showToast('No friend code available.', 'error');
    else setFeedback(getEl('social-regenerate-feedback'), 'No friend code available to copy.', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
    if (SOCIAL_PAGE_KIND === 'profile') showToast('Code copied.', 'success');
    else setFeedback(getEl('social-regenerate-feedback'), 'Friend code copied.', 'success');
  } catch (_err) {
    if (SOCIAL_PAGE_KIND === 'profile') showToast('Clipboard unavailable — copy manually.', 'error');
    else setFeedback(getEl('social-regenerate-feedback'), 'Clipboard unavailable. Copy manually.', 'error');
  }
}


// ── Profile page redesign functions ────────────────────────

function populateTimezones() {
  const select = document.querySelector('[name="timezone"]');
  if (!select) return;
  const detected = (typeof Intl !== 'undefined')
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : '';
  const tzList = [
    ['America/New_York', 'Eastern Time (ET)'],
    ['America/Chicago', 'Central Time (CT)'],
    ['America/Denver', 'Mountain Time (MT)'],
    ['America/Los_Angeles', 'Pacific Time (PT)'],
    ['America/Anchorage', 'Alaska (AKT)'],
    ['Pacific/Honolulu', 'Hawaii (HT)'],
    ['America/Toronto', 'Toronto (ET)'],
    ['America/Vancouver', 'Vancouver (PT)'],
    ['Europe/London', 'London (GMT/BST)'],
    ['Europe/Dublin', 'Dublin (GMT/IST)'],
    ['Europe/Paris', 'Paris (CET/CEST)'],
    ['Europe/Berlin', 'Berlin (CET/CEST)'],
    ['Europe/Amsterdam', 'Amsterdam (CET/CEST)'],
    ['Europe/Zurich', 'Zurich (CET/CEST)'],
    ['Europe/Stockholm', 'Stockholm (CET/CEST)'],
    ['Europe/Oslo', 'Oslo (CET/CEST)'],
    ['Europe/Helsinki', 'Helsinki (EET/EEST)'],
    ['Europe/Warsaw', 'Warsaw (CET/CEST)'],
    ['Europe/Bucharest', 'Bucharest (EET/EEST)'],
    ['Europe/Athens', 'Athens (EET/EEST)'],
    ['Europe/Istanbul', 'Istanbul (TRT)'],
    ['Europe/Moscow', 'Moscow (MSK)'],
    ['Africa/Cairo', 'Cairo (EET)'],
    ['Africa/Johannesburg', 'Johannesburg (SAST)'],
    ['Asia/Dubai', 'Dubai (GST)'],
    ['Asia/Karachi', 'Karachi (PKT)'],
    ['Asia/Kolkata', 'Mumbai / Kolkata (IST)'],
    ['Asia/Bangkok', 'Bangkok (ICT)'],
    ['Asia/Singapore', 'Singapore (SGT)'],
    ['Asia/Hong_Kong', 'Hong Kong (HKT)'],
    ['Asia/Shanghai', 'Shanghai (CST)'],
    ['Asia/Tokyo', 'Tokyo (JST)'],
    ['Asia/Seoul', 'Seoul (KST)'],
    ['Australia/Sydney', 'Sydney (AEST/AEDT)'],
    ['Australia/Melbourne', 'Melbourne (AEST/AEDT)'],
    ['Australia/Perth', 'Perth (AWST)'],
    ['Pacific/Auckland', 'Auckland (NZST/NZDT)'],
  ];
  const allVals = tzList.map(([v]) => v);
  const list = detected && !allVals.includes(detected) ? [[detected, detected], ...tzList] : tzList;
  select.innerHTML = '';
  list.forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === detected) opt.selected = true;
    select.appendChild(opt);
  });
}

function initScrollSpy() {
  const sections = document.querySelectorAll('.sp-section[id]');
  const navItems = document.querySelectorAll('.sp-sidenav-item[data-section]');
  if (!sections.length || !navItems.length) return;

  const ratios = new Map();
  sections.forEach(s => ratios.set(s.id, 0));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => ratios.set(e.target.id, e.intersectionRatio));
    let maxId = null, maxRatio = -1;
    ratios.forEach((ratio, id) => { if (ratio > maxRatio) { maxRatio = ratio; maxId = id; } });
    if (maxId) navItems.forEach(item => item.classList.toggle('is-active', item.dataset.section === maxId));
  }, { threshold: [0, 0.1, 0.25, 0.5], rootMargin: '-10% 0px -60% 0px' });

  sections.forEach(s => observer.observe(s));

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(item.dataset.section);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function updateSaveBar() {
  const bar = getEl('sp-save-bar');
  if (!bar) return;
  const dirty = isDirty();
  const blocked = socialState.loading || socialState.isGuest || socialState.nicknameRequired;
  bar.classList.toggle('hidden', !dirty || blocked);

  const countEl = getEl('sp-save-count');
  if (countEl && socialState.initialSettings) {
    const current = readFormSettings();
    const changed = SOCIAL_SETTING_KEYS.filter(k => current[k] !== undefined && current[k] !== socialState.initialSettings[k]).length;
    countEl.textContent = changed === 1 ? '1 unsaved change' : `${changed} unsaved changes`;
  }

  const spSaveBtn = getEl('sp-save-btn');
  if (spSaveBtn) {
    spSaveBtn.disabled = socialState.isSaving;
    spSaveBtn.textContent = socialState.isSaving ? 'Saving…' : 'Save changes';
  }
}

function updatePreview() {
  if (SOCIAL_PAGE_KIND !== 'profile') return;
  const form = getEl('social-settings-form');
  if (!form) return;

  const sharingEnabled = !!form.elements.namedItem('trade_sharing_enabled')?.checked;
  const showPct = !!form.elements.namedItem('show_pnl_percent')?.checked;
  const showR = !!form.elements.namedItem('show_r_multiple')?.checked;
  const showCash = !!form.elements.namedItem('show_pnl_currency')?.checked;
  const showSize = !!form.elements.namedItem('show_position_size')?.checked;
  const showEntryStop = !!form.elements.namedItem('show_entry_stop')?.checked;
  const showClosed = !!form.elements.namedItem('share_closed_trades')?.checked;
  const showOpen = !!form.elements.namedItem('share_open_trades')?.checked;
  const scope = form.elements.namedItem('trade_sharing_scope')?.value || 'friends_only';

  const scopeText = {
    friends_only: 'friends only',
    friends_and_groups: 'friends and group members',
    groups_only: 'group members only',
    public: 'everyone',
    private: 'nobody (private)'
  };
  const spScopeLabel = getEl('sp-mock-scope-label');
  if (spScopeLabel) {
    spScopeLabel.textContent = !sharingEnabled
      ? 'Trade sharing is off'
      : `Visible to ${scopeText[scope] || scope}`;
  }

  const metricsEl = getEl('sp-mock-metrics');
  if (metricsEl) {
    metricsEl.innerHTML = '';
    if (!sharingEnabled) {
      const msg = document.createElement('p');
      msg.className = 'sp-mock-off-msg';
      msg.textContent = 'Trade sharing is off — nothing shown.';
      metricsEl.appendChild(msg);
    } else {
      const add = (text, cls) => {
        const s = document.createElement('span');
        s.className = `sp-mock-metric ${cls}`;
        s.textContent = text;
        metricsEl.appendChild(s);
      };
      if (showPct) add('+2.4%', 'sp-mock-metric--pos');
      if (showR) add('+2.4R', 'sp-mock-metric--r');
      if (showCash) add('+£187.99', 'sp-mock-metric--cash');
      if (showSize) add('100 shares', 'sp-mock-metric--size');
      if (showEntryStop) add('Entry $45.20 · Stop $43.80', 'sp-mock-metric--entry');
      if (!showPct && !showR && !showCash && !showSize && !showEntryStop) {
        const msg = document.createElement('p');
        msg.className = 'sp-mock-off-msg';
        msg.textContent = 'No fields selected.';
        metricsEl.appendChild(msg);
      }
    }
  }

  const fieldsList = getEl('sp-preview-fields');
  if (!fieldsList) return;
  fieldsList.innerHTML = '';
  const fields = [
    { label: 'Ticker', on: sharingEnabled },
    { label: 'R-multiple', on: sharingEnabled && showR },
    { label: 'Percentage return', on: sharingEnabled && showPct },
    { label: 'Duration held', on: sharingEnabled && showClosed },
    { label: 'Entry / stop prices', on: sharingEnabled && showEntryStop },
    { label: 'Cash amounts', on: sharingEnabled && showCash },
    { label: 'Position size', on: sharingEnabled && showSize },
    { label: 'Open positions', on: sharingEnabled && showOpen },
  ];
  fields.forEach(f => {
    const li = document.createElement('li');
    li.className = `sp-preview-field ${f.on ? 'sp-preview-field--on' : 'sp-preview-field--off'}`;
    const icon = f.on
      ? '<svg class="sp-pf-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 6l3 3 5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg class="sp-pf-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke-linecap="round"/></svg>';
    li.innerHTML = icon + f.label;
    fieldsList.appendChild(li);
  });
}

function validateTradeSharingWarning() {
  const form = getEl('social-settings-form');
  if (!form) return;
  const sharingOn = !!form.elements.namedItem('trade_sharing_enabled')?.checked;
  const openOff = !form.elements.namedItem('share_open_trades')?.checked;
  const closedOff = !form.elements.namedItem('share_closed_trades')?.checked;
  const warning = getEl('sp-both-trades-off-warning');
  if (warning) warning.classList.toggle('hidden', !(sharingOn && openOff && closedOff));
}

function initProfilePage() {
  if (SOCIAL_PAGE_KIND !== 'profile') return;

  populateTimezones();
  initScrollSpy();

  // Bio character counter
  const bioInput = getEl('sp-input-bio');
  const bioCounter = getEl('sp-bio-counter');
  if (bioInput && bioCounter) {
    const updateCounter = () => {
      const len = bioInput.value.length;
      bioCounter.textContent = `${len} / 280`;
      bioCounter.classList.toggle('sp-char-counter--warn', len > 250);
    };
    bioInput.addEventListener('input', updateCounter);
  }

  // Display name live preview
  const displayNameInput = getEl('sp-input-display-name');
  if (displayNameInput) {
    displayNameInput.addEventListener('input', () => {
      const v = displayNameInput.value || '—';
      const p = getEl('sp-display-name-preview');
      if (p) p.textContent = v;
      const m = getEl('sp-mock-name');
      if (m) m.textContent = v;
    });
  }

  // Nested panel visibility via master toggles
  const form = getEl('social-settings-form');
  if (form) {
    form.addEventListener('change', updateDependentControls);
    form.addEventListener('input', () => { updateSaveBar(); updatePreview(); setFeedback(getEl('social-settings-feedback'), ''); });
    form.addEventListener('change', () => {
      updateSaveBar();
      updatePreview();
      validateTradeSharingWarning();
    });
  }

  // Regenerate modal
  getEl('sp-regenerate-btn')?.addEventListener('click', () => {
    getEl('sp-regen-modal')?.classList.remove('hidden');
    getEl('sp-regen-modal')?.querySelector('button')?.focus();
  });
  getEl('sp-regen-cancel-btn')?.addEventListener('click', () => getEl('sp-regen-modal')?.classList.add('hidden'));
  getEl('sp-regen-confirm-btn')?.addEventListener('click', async () => {
    getEl('sp-regen-modal')?.classList.add('hidden');
    await regenerateFriendCode();
  });

  // Copy code
  getEl('sp-copy-code-btn')?.addEventListener('click', copyFriendCode);

  // Disable social modal
  getEl('sp-disable-social-btn')?.addEventListener('click', () => getEl('sp-disable-modal')?.classList.remove('hidden'));
  getEl('sp-disable-cancel-btn')?.addEventListener('click', () => getEl('sp-disable-modal')?.classList.add('hidden'));
  getEl('sp-disable-confirm-btn')?.addEventListener('click', () => {
    getEl('sp-disable-modal')?.classList.add('hidden');
    // TODO: implement disable social endpoint
    showToast('Disable social (endpoint not yet implemented).', 'neutral');
  });

  // Delete profile modal
  getEl('sp-delete-profile-btn')?.addEventListener('click', () => {
    getEl('sp-delete-modal')?.classList.remove('hidden');
    getEl('sp-delete-confirm-input')?.focus();
  });
  getEl('sp-delete-cancel-btn')?.addEventListener('click', () => {
    getEl('sp-delete-modal')?.classList.add('hidden');
    const inp = getEl('sp-delete-confirm-input');
    if (inp) inp.value = '';
    const btn = getEl('sp-delete-confirm-btn');
    if (btn) btn.disabled = true;
  });
  const deleteInput = getEl('sp-delete-confirm-input');
  const deleteConfirmBtn = getEl('sp-delete-confirm-btn');
  if (deleteInput && deleteConfirmBtn) {
    deleteInput.addEventListener('input', () => {
      const name = (socialState.profile?.nickname || socialState.nickname || '').trim();
      deleteConfirmBtn.disabled = !name || deleteInput.value.trim() !== name;
    });
  }
  getEl('sp-delete-confirm-btn')?.addEventListener('click', () => {
    getEl('sp-delete-modal')?.classList.add('hidden');
    // TODO: implement delete profile endpoint
    showToast('Delete profile (endpoint not yet implemented).', 'neutral');
  });

  // Export & brokers
  getEl('sp-export-btn')?.addEventListener('click', () => showToast('Export requested (not yet implemented).', 'neutral'));
  getEl('sp-manage-brokers-btn')?.addEventListener('click', () => { window.location.href = '/profile.html'; });

  // Save bar
  getEl('sp-save-btn')?.addEventListener('click', () => saveSettings({ preventDefault() {} }));
  getEl('sp-discard-btn')?.addEventListener('click', () => {
    if (socialState.initialSettings) {
      applyFormSettings({ ...socialState.initialSettings });
      updateSaveBar();
      updatePreview();
    }
  });

  // Dismiss modals on overlay click / Escape
  document.querySelectorAll('.sp-modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.sp-modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
  });

  // Warn before leaving with unsaved changes
  window.addEventListener('beforeunload', e => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
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
  const tradeGroupPollMs = SOCIAL_PAGE_KIND === 'groups' ? 10000 : 18000;
  socialState.tradeGroupPollTimer = window.setInterval(() => {
    if (document.hidden) return;
    loadTradeGroups();
    if (SOCIAL_PAGE_KIND === 'groups' || SOCIAL_PAGE_KIND === 'overview') {
      loadTradeGroupNotifications();
    }
  }, tradeGroupPollMs);
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
  bindFriendsPageActions();
  getEl('social-create-group-form')?.addEventListener('submit', createTradeGroup);
  getEl('social-group-add-member-form')?.addEventListener('submit', addTradeGroupMember);
  getEl('social-group-announcement-form')?.addEventListener('submit', postGroupAnnouncement);
  getEl('social-group-delete-btn')?.addEventListener('click', deleteSelectedGroup);
  getEl('social-overview-feed-filter')?.addEventListener('click', (event) => {
    const btn = event.target instanceof Element ? event.target.closest('.social-feed-filter-btn') : null;
    const nextFilter = btn?.dataset?.feedFilter;
    if (!nextFilter || nextFilter === socialState.overviewFeedFilter) return;
    socialState.overviewFeedFilter = nextFilter;
    renderSocialOverview();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindActions();
  if (SOCIAL_PAGE_KIND === 'profile') initProfilePage();
  const initialLoads = [loadSocialData()];
  if (SOCIAL_PAGE_KIND === 'overview') {
    initialLoads.push(loadFriendData(), loadTradeGroups());
    logSocialPerf('social-bootstrap-used', { sections: ['profile', 'friends', 'trade-groups-summary'] });
    window.setTimeout(() => {
      loadLeaderboard().then(() => logSocialPerf('social-section-deferred', { section: 'leaderboard' }));
      loadTradeGroupNotifications().then(() => logSocialPerf('social-section-deferred', { section: 'trade-group-notifications' }));
    }, 180);
  } else if (SOCIAL_PAGE_KIND === 'groups') {
    initialLoads.push(loadTradeGroups(), loadTradeGroupNotifications());
    window.setTimeout(() => {
      loadFriendData().then(() => logSocialPerf('social-section-deferred', { section: 'friends' }));
      loadLeaderboard().then(() => logSocialPerf('social-section-deferred', { section: 'leaderboard' }));
    }, 220);
  } else if (SOCIAL_PAGE_KIND === 'network') {
    initialLoads.push(loadFriendData());
    window.setTimeout(() => {
      loadTradeGroups().then(() => logSocialPerf('social-section-deferred', { section: 'trade-groups-summary' }));
      loadLeaderboard().then(() => logSocialPerf('social-section-deferred', { section: 'leaderboard' }));
    }, 220);
  } else {
    initialLoads.push(loadLeaderboard());
    window.setTimeout(() => {
      loadFriendData().then(() => logSocialPerf('social-section-deferred', { section: 'friends' }));
      loadTradeGroups().then(() => logSocialPerf('social-section-deferred', { section: 'trade-groups-summary' }));
    }, 220);
  }

  Promise.allSettled(initialLoads).finally(() => {
    startFriendPolling();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !socialState.isGuest && !socialState.nicknameRequired) {
      scheduleSocialRefresh('visible-friends', () => loadFriendData(), 60);
      scheduleSocialRefresh('visible-leaderboard', () => loadLeaderboard(), 120);
      scheduleSocialRefresh('visible-trade-groups', () => loadTradeGroups(), 80);
      if (SOCIAL_PAGE_KIND === 'groups' || SOCIAL_PAGE_KIND === 'overview') {
        scheduleSocialRefresh('visible-trade-notifications', () => loadTradeGroupNotifications(), 160);
      }
    }
  });
  window.addEventListener(SOCIAL_SYNC_EVENT, (event) => {
    const sharedState = event?.detail?.state;
    if (sharedState) {
      applySharedSocialState(sharedState);
    } else {
      scheduleSocialRefresh('sync-friends', () => loadFriendData(), 0);
    }
    scheduleSocialRefresh('sync-trade-groups', () => loadTradeGroups(), 40);
    if (SOCIAL_PAGE_KIND === 'groups' || SOCIAL_PAGE_KIND === 'overview') {
      scheduleSocialRefresh('sync-trade-notifications', () => loadTradeGroupNotifications(), 80);
    }
  });
  window.addEventListener(SOCIAL_REFRESH_EVENT, () => {
    scheduleSocialRefresh('event-friends', () => loadFriendData(), 0);
    scheduleSocialRefresh('event-trade-groups', () => loadTradeGroups(), 45);
    if (SOCIAL_PAGE_KIND === 'groups' || SOCIAL_PAGE_KIND === 'overview') {
      scheduleSocialRefresh('event-trade-notifications', () => loadTradeGroupNotifications(), 100);
    }
  });
  window.addEventListener('beforeunload', stopFriendPolling);
});

})();
