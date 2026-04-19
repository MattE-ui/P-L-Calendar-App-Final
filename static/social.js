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

// Compute the R-multiple for a closed trade item. Returns null when data is insufficient.
function computeRMultiple(item) {
  const entry = Number(item?.entry_price);
  const stop  = Number(item?.stop_price);
  const exit  = Number(item?.fill_price);
  const side  = String(item?.side || '').toUpperCase();
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(exit)) return null;
  const riskPerUnit = Math.abs(entry - stop);
  if (riskPerUnit < 0.00001) return null;
  const profit = side === 'SELL' ? entry - exit : exit - entry;
  return profit / riskPerUnit;
}

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

// Shared row builder used by both the full leaderboard page and the compact sidebar.
// opts.compact = true → rank | avatar | name | metric (no verification pill, no stats)
// opts.compact = false (default) → full layout with verification and stats
function createLeaderboardRow(entry, opts = {}) {
  const compact = opts.compact === true;
  const isMine = opts.myNickname
    ? String(entry?.nickname || '').trim().toLowerCase() === opts.myNickname
    : false;

  if (compact) {
    const row = document.createElement('div');
    row.className = `sov-lb-row${isMine ? ' sov-lb-row--mine' : ''}`;

    const rank = document.createElement('span');
    rank.className = `sov-lb-rank${entry.rank === 1 ? ' sov-lb-rank--gold' : ''}`;
    rank.textContent = `#${entry.rank}`;

    const av = window.VeracitySocialAvatar?.createAvatar({
      nickname: entry.nickname,
      avatar_url: entry.avatar_url,
      avatar_initials: entry.avatar_initials,
    }, 'xs');

    const name = document.createElement('span');
    name.className = 'sov-lb-name';
    name.textContent = entry.nickname || 'Unknown';

    const isPos = Number.isFinite(entry.return_pct) && entry.return_pct >= 0;
    const isNeg = Number.isFinite(entry.return_pct) && entry.return_pct < 0;
    const metric = document.createElement('span');
    metric.className = `sov-lb-metric${isPos ? ' sov-lb-metric--pos' : isNeg ? ' sov-lb-metric--neg' : ''}`;
    metric.textContent = formatReturnPct(entry.return_pct);

    row.appendChild(rank);
    if (av) row.appendChild(av);
    row.appendChild(name);
    row.appendChild(metric);
    return row;
  }

  // Full layout (existing profile/leaderboard page style)
  const row = document.createElement('article');
  row.className = 'social-list-row social-list-row--leaderboard';
  if (entry.rank <= 3) row.classList.add('is-top-rank');

  const left = document.createElement('div');
  left.className = 'social-leaderboard-left';
  const rankSpan = document.createElement('span');
  rankSpan.className = 'social-rank';
  rankSpan.textContent = `#${entry.rank}`;
  left.appendChild(rankSpan);
  left.appendChild(createIdentityRow(entry.nickname, '', '', {
    nickname: entry.nickname,
    avatar_url: entry.avatar_url,
    avatar_initials: entry.avatar_initials,
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
  return row;
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
  // social-leaderboard-list is hidden on the overview page; always hide it here
  // so that only sov-lb-rows (rendered by renderSidebarLeaderboard) is visible.
  listEl.classList.toggle('hidden', true);
  if (!hasEntries || socialState.leaderboardError) {
    renderSocialOverview();
    return;
  }

  leaderboardEntries.forEach(entry => {
    listEl.appendChild(createLeaderboardRow(entry, { compact: false }));
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
  const card = getEl('sg-watchlists-card');
  if (!card) return; // not on the groups page redesign
  card.innerHTML = '';

  // Card header
  const header = document.createElement('div');
  header.className = 'sg-card-header';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'sg-card-title-wrap';
  const titleEl = document.createElement('span');
  titleEl.className = 'sg-card-title';
  titleEl.textContent = 'Shared watchlists';
  const rows = Array.isArray(socialState.selectedTradeGroupWatchlists) ? socialState.selectedTradeGroupWatchlists : [];
  const countEl = document.createElement('span');
  countEl.className = 'sg-count-pill';
  countEl.textContent = String(rows.length);
  titleWrap.appendChild(titleEl);
  titleWrap.appendChild(countEl);
  header.appendChild(titleWrap);
  if (isLeader) {
    const shareBtn = createActionButton('+ Share a watchlist', 'ghost sg-card-header-btn');
    shareBtn.addEventListener('click', () => showSgModal('share-watchlist'));
    header.appendChild(shareBtn);
  }
  card.appendChild(header);

  const listEl = document.createElement('div');
  card.appendChild(listEl);
  const feedback = { _msg: '' }; // local feedback handle for watchlist operations

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'sg-watchlists-empty';
    const icon = document.createElement('div');
    icon.className = 'sg-watchlists-empty-icon';
    icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
    const emptyTitle = document.createElement('p');
    emptyTitle.className = 'sg-watchlists-empty-title';
    emptyTitle.textContent = 'No shared watchlists yet';
    const emptyBody = document.createElement('p');
    emptyBody.className = 'sg-watchlists-empty-body';
    emptyBody.textContent = 'Share a watchlist from your personal lists so the group can track the same setups.';
    empty.appendChild(icon);
    empty.appendChild(emptyTitle);
    empty.appendChild(emptyBody);
    if (isLeader) {
      const browseBtn = createActionButton('Browse my watchlists', 'ghost sg-watchlists-browse-btn');
      browseBtn.addEventListener('click', () => showSgModal('share-watchlist'));
      empty.appendChild(browseBtn);
    }
    listEl.appendChild(empty);
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
          await loadTradeGroupDetail(socialState.selectedTradeGroupId);
        } catch (_error) {}
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
  if (SOCIAL_PAGE_KIND === 'groups') {
    renderSgSidebar();
    const groups = Array.isArray(socialState.tradeGroups) ? socialState.tradeGroups : [];
    const selected = groups.find(g => g.id === socialState.selectedTradeGroupId);
    renderSgWorkspace(selected);
  }
  renderSocialOverview();
}

// ---- GROUPS PAGE (sg-*) -------------------------------------------------------

function initSgPage() {
  getEl('sg-new-group-btn')?.addEventListener('click', () => showSgModal('new-group'));
  getEl('sg-join-code-btn')?.addEventListener('click', () => showSgModal('join-code'));
  getEl('sg-search')?.addEventListener('input', () => renderSgGroupsList());
  const collapseBtn = getEl('sg-groups-collapse');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      const list = getEl('sg-groups-list');
      const collapsed = list?.classList.toggle('hidden');
      collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    });
  }
  getEl('sg-modal-backdrop')?.addEventListener('click', (e) => {
    if (e.target === getEl('sg-modal-backdrop')) closeSgModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !getEl('sg-modal-backdrop')?.classList.contains('hidden')) closeSgModal();
  });
  // Restore group from URL
  const urlGroup = new URLSearchParams(window.location.search).get('group');
  if (urlGroup && !socialState.selectedTradeGroupId) socialState.selectedTradeGroupId = urlGroup;
  window.addEventListener('popstate', () => {
    const id = new URLSearchParams(window.location.search).get('group') || '';
    if (id !== socialState.selectedTradeGroupId) loadTradeGroupDetail(id);
  });
}

function renderSgSidebar() {
  renderSgPendingPanel();
  renderSgGroupsList();
}

function renderSgPendingPanel() {
  const panel = getEl('sg-pending-panel');
  if (!panel) return;
  const invites = Array.isArray(socialState.pendingTradeGroupInvites) ? socialState.pendingTradeGroupInvites : [];
  if (!invites.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  panel.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'sg-pending-header';
  header.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg><span>${invites.length} INVITATION${invites.length !== 1 ? 'S' : ''}</span>`;
  panel.appendChild(header);
  invites.forEach(invite => {
    const item = document.createElement('div');
    item.className = 'sg-invite-item';
    const info = document.createElement('div'); info.className = 'sg-invite-info';
    const name = document.createElement('div'); name.className = 'sg-invite-name'; name.textContent = invite.group_name || 'Unnamed group';
    const meta = document.createElement('div'); meta.className = 'sg-invite-meta';
    meta.textContent = `Invited by ${invite.leader_nickname || 'Unknown'}`;
    info.appendChild(name); info.appendChild(meta); item.appendChild(info);
    const actions = document.createElement('div'); actions.className = 'sg-invite-actions';
    const acceptBtn = document.createElement('button'); acceptBtn.type = 'button'; acceptBtn.className = 'sg-invite-accept'; acceptBtn.textContent = 'Accept';
    acceptBtn.addEventListener('click', () => respondToInviteFromPage(invite.invite_id, 'accept'));
    const declineBtn = document.createElement('button'); declineBtn.type = 'button'; declineBtn.className = 'sg-invite-decline'; declineBtn.textContent = 'Decline';
    declineBtn.addEventListener('click', () => respondToInviteFromPage(invite.invite_id, 'decline'));
    actions.appendChild(acceptBtn); actions.appendChild(declineBtn); item.appendChild(actions);
    panel.appendChild(item);
  });
}

function renderSgGroupsList() {
  const listEl = getEl('sg-groups-list');
  const labelEl = getEl('sg-groups-label');
  if (!listEl) return;
  const groups = Array.isArray(socialState.tradeGroups) ? socialState.tradeGroups : [];
  const query = String(getEl('sg-search')?.value || '').trim().toLowerCase();
  const filtered = query ? groups.filter(g => (g.name || '').toLowerCase().includes(query)) : groups;
  if (labelEl) labelEl.textContent = `YOUR GROUPS (${groups.length})`;
  listEl.innerHTML = '';
  if (!groups.length) {
    listEl.appendChild(createEmptyState('No groups yet', 'Create one or accept an invitation.'));
    return;
  }
  filtered.forEach(group => {
    const item = document.createElement('div');
    item.className = `sg-group-item${group.id === socialState.selectedTradeGroupId ? ' is-active' : ''}`;
    item.setAttribute('role', 'button'); item.tabIndex = 0;
    const av = window.VeracitySocialAvatar?.createSeededAvatar(group.name || 'G', 'xs');
    if (av) item.appendChild(av);
    const text = document.createElement('div'); text.className = 'sg-group-item-text';
    const nameRow = document.createElement('div'); nameRow.className = 'sg-group-item-name-row';
    const nameSpan = document.createElement('span'); nameSpan.className = 'sg-group-item-name'; nameSpan.textContent = group.name || 'Unnamed group';
    const badge = document.createElement('span'); badge.className = `sg-role-badge sg-role-badge--${group.role === 'leader' ? 'leader' : 'member'}`; badge.textContent = group.role === 'leader' ? 'LEADER' : 'MEMBER';
    nameRow.appendChild(nameSpan); nameRow.appendChild(badge);
    const metaLine = document.createElement('div'); metaLine.className = 'sg-group-item-meta'; metaLine.textContent = `${group.member_count || 0} members`;
    text.appendChild(nameRow); text.appendChild(metaLine); item.appendChild(text);
    item.addEventListener('click', () => selectSgGroup(group.id));
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSgGroup(group.id); } });
    listEl.appendChild(item);
  });
}

function selectSgGroup(groupId) {
  const url = new URL(window.location.href);
  url.searchParams.set('group', groupId);
  window.history.pushState({ groupId }, '', url.toString());
  loadTradeGroupDetail(groupId);
}

function renderSgWorkspace(selected) {
  const emptyEl = getEl('sg-workspace-empty');
  const headerCard = getEl('sg-group-header');
  const cardsRow = getEl('sg-cards-row');
  const watchlistsCard = getEl('sg-watchlists-card');
  const activityCard = getEl('sg-activity-card');
  if (!selected) {
    emptyEl?.classList.remove('hidden');
    [headerCard, cardsRow, watchlistsCard, activityCard].forEach(el => el?.classList.add('hidden'));
    return;
  }
  emptyEl?.classList.add('hidden');
  [headerCard, cardsRow, watchlistsCard, activityCard].forEach(el => el?.classList.remove('hidden'));
  const members = Array.isArray(socialState.selectedTradeGroupMembers) ? socialState.selectedTradeGroupMembers : [];
  const positions = Array.isArray(socialState.selectedTradeGroupPositions) ? socialState.selectedTradeGroupPositions : [];
  const feed = Array.isArray(socialState.selectedTradeGroupAlerts) ? socialState.selectedTradeGroupAlerts : [];
  const isLeader = selected.role === 'leader';
  renderSgGroupHeader(selected, members, positions, isLeader);
  renderSgMembersCard(members, isLeader);
  renderSgPositionsCard(positions);
  renderGroupWatchlistsSection(isLeader);
  renderSgActivityFeed(feed, isLeader);
}

function renderSgGroupHeader(group, members, positions, isLeader) {
  const card = getEl('sg-group-header');
  if (!card) return;
  card.innerHTML = '';
  const topRow = document.createElement('div'); topRow.className = 'sg-header-top';
  const av = window.VeracitySocialAvatar?.createSeededAvatar(group.name || 'G', 'sm');
  if (av) { av.classList.add('sg-header-avatar'); topRow.appendChild(av); }
  const info = document.createElement('div'); info.className = 'sg-header-info';
  const nameRow = document.createElement('div'); nameRow.className = 'sg-header-name-row';
  const nameSpan = document.createElement('span'); nameSpan.className = 'sg-header-name'; nameSpan.textContent = group.name || 'Unnamed group';
  const roleBadge = document.createElement('span'); roleBadge.className = `sg-role-badge sg-role-badge--${isLeader ? 'leader' : 'member'}`; roleBadge.textContent = isLeader ? 'LEADER' : 'MEMBER';
  const privBadge = document.createElement('span'); privBadge.className = 'sg-privacy-badge'; privBadge.textContent = 'PRIVATE';
  nameRow.appendChild(nameSpan); nameRow.appendChild(roleBadge); nameRow.appendChild(privBadge);
  const metaLine = document.createElement('div'); metaLine.className = 'sg-header-meta';
  const created = group.created_at ? new Date(group.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  metaLine.textContent = `A private trading group · Created ${created}`;
  info.appendChild(nameRow); info.appendChild(metaLine); topRow.appendChild(info);
  const actions = document.createElement('div'); actions.className = 'sg-header-actions';
  const invBtn = document.createElement('button'); invBtn.type = 'button'; invBtn.className = 'ghost sg-header-btn'; invBtn.textContent = '+ Invite';
  invBtn.addEventListener('click', () => showSgModal('invite'));
  actions.appendChild(invBtn);
  if (isLeader) {
    const annBtn = document.createElement('button'); annBtn.type = 'button'; annBtn.className = 'ghost sg-header-btn'; annBtn.textContent = 'Post announcement';
    annBtn.addEventListener('click', () => showSgModal('announce'));
    actions.appendChild(annBtn);
    const setBtn = document.createElement('button'); setBtn.type = 'button'; setBtn.className = 'ghost sg-header-btn'; setBtn.textContent = 'Settings';
    setBtn.addEventListener('click', () => showSgModal('settings'));
    actions.appendChild(setBtn);
  } else {
    const leaveBtn = document.createElement('button'); leaveBtn.type = 'button'; leaveBtn.className = 'ghost sg-header-btn sg-leave-btn'; leaveBtn.textContent = 'Leave';
    leaveBtn.addEventListener('click', () => showSgModal('leave'));
    actions.appendChild(leaveBtn);
  }
  topRow.appendChild(actions); card.appendChild(topRow);
  const hr = document.createElement('hr'); hr.className = 'sg-divider'; card.appendChild(hr);
  const strip = document.createElement('div'); strip.className = 'sg-stats-strip';
  [
    { label: 'MEMBERS', value: String(group.member_count || 0) },
    { label: 'OPEN POSITIONS', value: String(positions.length) },
    { label: 'GROUP AVG R (7D)', value: '\u2014', dim: true },
    { label: 'TRADES THIS WEEK', value: '\u2014', dim: true },
  ].forEach(def => {
    const stat = document.createElement('div'); stat.className = 'sg-stat';
    const lbl = document.createElement('div'); lbl.className = 'sg-stat-label'; lbl.textContent = def.label;
    const val = document.createElement('div'); val.className = `sg-stat-value${def.dim ? ' sg-stat-value--dim' : ''}`; val.textContent = def.value;
    if (def.dim) val.title = 'Requires a dedicated trades history endpoint \u2014 coming soon.';
    stat.appendChild(lbl); stat.appendChild(val); strip.appendChild(stat);
  });
  card.appendChild(strip);
}

function renderSgMembersCard(members, isLeader) {
  const card = getEl('sg-members-card');
  if (!card) return;
  card.innerHTML = '';
  const header = document.createElement('div'); header.className = 'sg-card-header';
  const tw = document.createElement('div'); tw.className = 'sg-card-title-wrap';
  const title = document.createElement('span'); title.className = 'sg-card-title'; title.textContent = 'Members';
  const count = document.createElement('span'); count.className = 'sg-count-pill'; count.textContent = String(members.length);
  tw.appendChild(title); tw.appendChild(count); header.appendChild(tw);
  const invBtn = createActionButton('+ Invite', 'ghost sg-card-header-btn');
  invBtn.addEventListener('click', () => showSgModal('invite'));
  header.appendChild(invBtn); card.appendChild(header);
  if (!members.length) { card.appendChild(createEmptyState('No members yet')); return; }
  members.forEach(member => {
    const row = document.createElement('div'); row.className = 'sg-member-row';
    const avWrap = document.createElement('div'); avWrap.className = 'sg-member-av-wrap';
    const av = window.VeracitySocialAvatar?.createSeededAvatar(member.nickname || 'U', 'xs');
    if (av) avWrap.appendChild(av);
    const info = document.createElement('div'); info.className = 'sg-member-info';
    const nameRow = document.createElement('div'); nameRow.className = 'sg-member-name-row';
    const nameSpan = document.createElement('span'); nameSpan.className = 'sg-member-name'; nameSpan.textContent = member.nickname || 'Unknown trader';
    const badge = document.createElement('span'); badge.className = `sg-role-badge sg-role-badge--${member.role === 'leader' ? 'leader' : 'member'}`; badge.textContent = member.role === 'leader' ? 'LEADER' : 'MEMBER';
    nameRow.appendChild(nameSpan); nameRow.appendChild(badge);
    const status = document.createElement('div'); status.className = 'sg-member-status'; status.textContent = 'Offline';
    info.appendChild(nameRow); info.appendChild(status);
    const perf = document.createElement('div'); perf.className = 'sg-member-perf';
    const pv = document.createElement('div'); pv.className = 'sg-member-perf-val'; pv.textContent = '\u2014';
    const pl = document.createElement('div'); pl.className = 'sg-member-perf-label'; pl.textContent = '7d';
    perf.appendChild(pv); perf.appendChild(pl);
    row.appendChild(avWrap); row.appendChild(info); row.appendChild(perf);
    if (isLeader && member.role !== 'leader') {
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'sg-member-remove'; rm.textContent = '\u2715'; rm.title = `Remove ${member.nickname}`;
      rm.addEventListener('click', async () => { try { await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/members/${encodeURIComponent(member.user_id)}`, { method: 'DELETE' }); await loadTradeGroupDetail(socialState.selectedTradeGroupId); } catch (_e) {} });
      row.appendChild(rm);
    }
    card.appendChild(row);
  });
  const footer = document.createElement('div'); footer.className = 'sg-members-footer'; footer.textContent = 'Live presence coming soon';
  card.appendChild(footer);
}

function renderSgPositionsCard(positions) {
  const card = getEl('sg-positions-card');
  if (!card) return;
  card.innerHTML = '';
  const header = document.createElement('div'); header.className = 'sg-card-header';
  const tw = document.createElement('div'); tw.className = 'sg-card-title-wrap';
  const title = document.createElement('span'); title.className = 'sg-card-title'; title.textContent = 'Group positions';
  const count = document.createElement('span'); count.className = 'sg-count-pill'; count.textContent = `${positions.length} open`;
  tw.appendChild(title); tw.appendChild(count); header.appendChild(tw); card.appendChild(header);
  if (!positions.length) {
    card.appendChild(createEmptyState('No open positions across the group \u2014 all flat'));
    return;
  }
  positions.forEach(pos => {
    const row = document.createElement('div'); row.className = 'sg-position-row';
    const isShort = pos.direction === 'short';
    const col1 = document.createElement('div'); col1.className = 'sg-pos-col1';
    const tr = document.createElement('div'); tr.className = 'sg-pos-ticker-row';
    const tk = document.createElement('span'); tk.className = 'sg-pos-ticker'; tk.textContent = pos.ticker || '\u2014';
    const dir = document.createElement('span'); dir.className = `sg-dir-badge sg-dir-badge--${isShort ? 'short' : 'long'}`; dir.textContent = isShort ? 'SHORT' : 'LONG';
    tr.appendChild(tk); tr.appendChild(dir);
    const ml = document.createElement('div'); ml.className = 'sg-pos-member';
    ml.textContent = [pos.member_nickname, pos.entry_price ? `entry $${Number(pos.entry_price).toFixed(2)}` : ''].filter(Boolean).join(' \u00b7 ');
    col1.appendChild(tr); col1.appendChild(ml);
    const col2 = document.createElement('div'); col2.className = 'sg-pos-col2';
    const glPct = Number(pos.gain_loss_pct);
    const glEl = document.createElement('div'); glEl.className = `sg-pos-gl${Number.isFinite(glPct) ? (glPct >= 0 ? ' is-pos' : ' is-neg') : ''}`;
    glEl.textContent = Number.isFinite(glPct) ? `${glPct >= 0 ? '+' : '\u2212'}${Math.abs(glPct).toFixed(2)}%` : '\u2014';
    col2.appendChild(glEl);
    const col3 = document.createElement('div'); col3.className = 'sg-pos-col3';
    const rk = document.createElement('div'); rk.className = 'sg-pos-risk';
    rk.textContent = pos.risk_pct ? `Risk ${Number(pos.risk_pct).toFixed(2)}%` : '\u2014';
    col3.appendChild(rk);
    const col4 = document.createElement('div'); col4.className = 'sg-pos-col4';
    const sizeBtn = createActionButton('Size', 'ghost sg-size-btn');
    if (pos.stop_price && pos.entry_price) {
      sizeBtn.addEventListener('click', () => launchAlertRiskSizing({ ticker: pos.ticker, side: isShort ? 'SELL' : 'BUY', entry_price: pos.entry_price, stop_price: pos.stop_price, risk_pct: pos.risk_pct }));
    } else { sizeBtn.disabled = true; sizeBtn.title = 'Stop price required for risk sizing'; }
    col4.appendChild(sizeBtn);
    row.appendChild(col1); row.appendChild(col2); row.appendChild(col3); row.appendChild(col4);
    card.appendChild(row);
  });
}

function renderSgActivityFeed(feed, isLeader) {
  const card = getEl('sg-activity-card');
  if (!card) return;
  card.innerHTML = '';
  const header = document.createElement('div'); header.className = 'sg-card-header';
  const title = document.createElement('span'); title.className = 'sg-card-title'; title.textContent = 'Recent activity';
  header.appendChild(title);
  const filterBar = document.createElement('div'); filterBar.className = 'sg-feed-filter';
  ['All', 'Trades', 'Notes'].forEach(label => {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = `sg-feed-filter-btn${label === 'All' ? ' is-active' : ''}`; btn.dataset.filter = label.toLowerCase(); btn.textContent = label;
    filterBar.appendChild(btn);
  });
  header.appendChild(filterBar); card.appendChild(header);
  const feedList = document.createElement('div'); feedList.className = 'sg-feed-list'; card.appendChild(feedList);
  filterBar.addEventListener('click', e => {
    const btn = e.target.closest('.sg-feed-filter-btn');
    if (!btn) return;
    filterBar.querySelectorAll('.sg-feed-filter-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    renderSgFeedItems(feedList, feed, isLeader, btn.dataset.filter);
  });
  renderSgFeedItems(feedList, feed, isLeader, 'all');
  if (feed.length) {
    const footer = document.createElement('div'); footer.className = 'sg-feed-footer';
    const viewAll = document.createElement('button'); viewAll.type = 'button'; viewAll.className = 'sg-feed-view-all'; viewAll.textContent = 'View all activity';
    footer.appendChild(viewAll); card.appendChild(footer);
  }
}

function renderSgFeedItems(container, feed, isLeader, filter) {
  container.innerHTML = '';
  const filtered = filter === 'trades' ? feed.filter(i => i.type === 'alert')
    : filter === 'notes' ? feed.filter(i => i.type === 'announcement') : feed;
  if (!filtered.length) { container.appendChild(createEmptyState(feed.length ? 'No matching activity' : 'No activity yet')); return; }
  filtered.forEach(item => {
    const row = document.createElement('div'); row.className = 'sg-feed-item';
    const av = window.VeracitySocialAvatar?.createSeededAvatar(item.leader_nickname || 'L', 'xs');
    const hrow = document.createElement('div'); hrow.className = 'sg-feed-item-header';
    if (av) hrow.appendChild(av);
    const ts = item.created_at ? formatRelativeTimestamp(item.created_at) : '';
    if (item.type === 'announcement') {
      row.classList.add('sg-feed-item--note');
      const who = document.createElement('span'); who.className = 'sg-feed-item-who';
      who.innerHTML = `<strong>${item.leader_nickname || 'Leader'}</strong> posted a note <span class="sg-feed-ts">${ts}</span>`;
      hrow.appendChild(who); row.appendChild(hrow);
      const body = document.createElement('div'); body.className = 'sg-feed-item-body'; body.textContent = item.text || ''; row.appendChild(body);
      if (isLeader) {
        const del = createActionButton('Delete', 'danger outline sg-feed-del-btn');
        del.addEventListener('click', async () => { try { await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/announcements/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); await loadTradeGroupDetail(socialState.selectedTradeGroupId); } catch (_e) {} });
        row.appendChild(del);
      }
    } else {
      row.classList.add('sg-feed-item--trade');
      const nc = normalizeTradeGroupActivityEvent(item);
      const isTrim = nc === 'trim', isAdd = nc === 'add', isSell = nc === 'trim' || nc === 'close';
      const verb = isSell ? (isTrim ? 'trimmed' : 'closed') : (isAdd ? 'added to' : 'opened a long in');
      const price = Number.isFinite(Number(item.fill_price)) ? Number(item.fill_price) : (Number.isFinite(Number(item.entry_price)) ? Number(item.entry_price) : null);
      const priceStr = price !== null ? ` at $${price.toFixed(2)}` : '';
      const badgeCls = isSell ? 'sell' : 'buy';
      const who = document.createElement('span'); who.className = 'sg-feed-item-who';
      who.innerHTML = `<strong>${item.leader_nickname || 'Leader'}</strong> ${verb} ${item.ticker || '\u2014'} <span class="sg-feed-badge sg-feed-badge--${badgeCls}">${isSell ? 'SELL' : 'BUY'}</span>${priceStr} <span class="sg-feed-ts">${ts}</span>`;
      hrow.appendChild(who); row.appendChild(hrow);
      const actRow = document.createElement('div'); actRow.className = 'sg-feed-item-actions';
      if (!isSell && !isLeader) {
        const missingStop = Number(item.stop_price) <= 0;
        const prefill = normalizeAlertRiskPrefillPayload(item);
        const sizeBtn = createActionButton('Size this trade', 'ghost sg-feed-size-btn');
        if (missingStop || !prefill) { sizeBtn.disabled = true; if (missingStop) sizeBtn.title = 'Stop required for risk sizing'; }
        else sizeBtn.addEventListener('click', () => launchAlertRiskSizing(item));
        actRow.appendChild(sizeBtn);
      }
      if (isLeader) {
        const del = createActionButton('Delete', 'danger outline sg-feed-del-btn');
        del.addEventListener('click', async () => { try { await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/alerts/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); await loadTradeGroupDetail(socialState.selectedTradeGroupId); } catch (_e) {} });
        actRow.appendChild(del);
      }
      if (actRow.childElementCount) row.appendChild(actRow);
    }
    container.appendChild(row);
  });
}

// Modal system ----------------------------------------------------------------

function showSgModal(type) {
  const backdrop = getEl('sg-modal-backdrop');
  const container = getEl('sg-modal-container');
  if (!backdrop || !container) return;
  container.innerHTML = '';
  const content = buildSgModalContent(type);
  if (!content) return;
  container.appendChild(content);
  backdrop.classList.remove('hidden');
  backdrop.removeAttribute('aria-hidden');
  container.querySelector('input:not([disabled]), button:not([disabled]), select, textarea')?.focus();
}

function closeSgModal() {
  const backdrop = getEl('sg-modal-backdrop');
  if (backdrop) { backdrop.classList.add('hidden'); backdrop.setAttribute('aria-hidden', 'true'); }
}

function buildSgModalContent(type) {
  const groups = Array.isArray(socialState.tradeGroups) ? socialState.tradeGroups : [];
  const selected = groups.find(g => g.id === socialState.selectedTradeGroupId);
  const isLeader = selected?.role === 'leader';
  switch (type) {
    case 'new-group':    return buildSgNewGroupModal();
    case 'join-code':   return buildSgJoinCodeModal();
    case 'invite':      return buildSgInviteModal(selected, isLeader);
    case 'leave':       return buildSgLeaveModal(selected, isLeader);
    case 'settings':    return buildSgSettingsModal(selected, isLeader);
    case 'announce':    return buildSgAnnouncementModal(selected);
    case 'share-watchlist': return buildSgShareWatchlistModal(selected, isLeader);
    default: return null;
  }
}

function sgModalShell(titleText) {
  const wrap = document.createElement('div'); wrap.className = 'sg-modal-body';
  const title = document.createElement('h2'); title.className = 'sg-modal-title'; title.textContent = titleText;
  const fbEl = document.createElement('p'); fbEl.className = 'sg-modal-feedback';
  return { wrap, title, fbEl };
}

function buildSgNewGroupModal() {
  const { wrap, title, fbEl } = sgModalShell('Create a new group');
  const nameField = document.createElement('div'); nameField.className = 'sg-modal-field';
  const nameLbl = document.createElement('label'); nameLbl.className = 'sg-modal-label'; nameLbl.textContent = 'Group name'; nameLbl.htmlFor = 'sg-modal-name';
  const nameInput = document.createElement('input'); nameInput.id = 'sg-modal-name'; nameInput.className = 'sg-modal-input'; nameInput.type = 'text'; nameInput.maxLength = 64; nameInput.placeholder = 'e.g. Swing setups'; nameInput.autocomplete = 'off';
  const nameHint = document.createElement('p'); nameHint.className = 'sg-modal-helper'; nameHint.textContent = 'Choose something your members will recognise.';
  nameField.appendChild(nameLbl); nameField.appendChild(nameInput); nameField.appendChild(nameHint);
  const descField = document.createElement('div'); descField.className = 'sg-modal-field';
  const descLbl = document.createElement('label'); descLbl.className = 'sg-modal-label'; descLbl.textContent = 'Description (optional)'; descLbl.htmlFor = 'sg-modal-desc';
  const descInput = document.createElement('textarea'); descInput.id = 'sg-modal-desc'; descInput.className = 'sg-modal-input sg-modal-textarea'; descInput.maxLength = 200; descInput.placeholder = 'What does this group focus on?';
  descField.appendChild(descLbl); descField.appendChild(descInput);
  const privField = document.createElement('div'); privField.className = 'sg-modal-field';
  const privLbl = document.createElement('div'); privLbl.className = 'sg-modal-label'; privLbl.textContent = 'Privacy';
  const privStatic = document.createElement('div'); privStatic.className = 'sg-modal-static';
  const privVal = document.createElement('div'); privVal.className = 'sg-modal-static-value'; privVal.textContent = 'Private \u00b7 Invite only';
  const privHint = document.createElement('div'); privHint.className = 'sg-modal-static-label'; privHint.textContent = 'Members join by invite only. You control who\u2019s in.';
  privStatic.appendChild(privVal); privStatic.appendChild(privHint); privField.appendChild(privLbl); privField.appendChild(privStatic);
  const footer = document.createElement('div'); footer.className = 'sg-modal-footer';
  const cancelBtn = createActionButton('Cancel', 'ghost'); cancelBtn.addEventListener('click', closeSgModal);
  const createBtn = document.createElement('button'); createBtn.type = 'button'; createBtn.className = 'primary'; createBtn.textContent = 'Create group \u2192';
  createBtn.addEventListener('click', async () => {
    const name = String(nameInput.value || '').trim();
    if (!name) { fbEl.textContent = 'Group name is required.'; fbEl.className = 'sg-modal-feedback is-error'; return; }
    if (name.length > 64) { fbEl.textContent = 'Group name is too long.'; fbEl.className = 'sg-modal-feedback is-error'; return; }
    createBtn.disabled = true; createBtn.textContent = 'Creating\u2026';
    try {
      await socialApi('/api/social/trade-groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      closeSgModal(); await loadTradeGroups();
    } catch (err) { fbEl.textContent = err?.message || 'Unable to create group.'; fbEl.className = 'sg-modal-feedback is-error'; createBtn.disabled = false; createBtn.textContent = 'Create group \u2192'; }
  });
  footer.appendChild(cancelBtn); footer.appendChild(createBtn);
  wrap.appendChild(title); wrap.appendChild(nameField); wrap.appendChild(descField); wrap.appendChild(privField); wrap.appendChild(fbEl); wrap.appendChild(footer);
  return wrap;
}

function buildSgJoinCodeModal() {
  const { wrap, title, fbEl } = sgModalShell('Join a group by invite code');
  const field = document.createElement('div'); field.className = 'sg-modal-field';
  const lbl = document.createElement('label'); lbl.className = 'sg-modal-label'; lbl.textContent = 'Invite code'; lbl.htmlFor = 'sg-modal-code';
  const input = document.createElement('input'); input.id = 'sg-modal-code'; input.className = 'sg-modal-input'; input.type = 'text'; input.placeholder = 'TG-XXXX'; input.autocomplete = 'off';
  input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
  const hint = document.createElement('p'); hint.className = 'sg-modal-helper'; hint.textContent = 'Ask a group leader for their invite code.';
  field.appendChild(lbl); field.appendChild(input); field.appendChild(hint);
  const footer = document.createElement('div'); footer.className = 'sg-modal-footer';
  const cancelBtn = createActionButton('Cancel', 'ghost'); cancelBtn.addEventListener('click', closeSgModal);
  const joinBtn = document.createElement('button'); joinBtn.type = 'button'; joinBtn.className = 'primary'; joinBtn.textContent = 'Join group \u2192';
  joinBtn.addEventListener('click', async () => {
    const code = String(input.value || '').trim().toUpperCase();
    if (!code) { fbEl.textContent = 'Enter an invite code.'; fbEl.className = 'sg-modal-feedback is-error'; return; }
    joinBtn.disabled = true; joinBtn.textContent = 'Joining\u2026';
    try {
      await socialApi('/api/social/trade-groups/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteCode: code }) });
      closeSgModal(); await loadTradeGroups();
    } catch (err) {
      const msg = err?.message || '';
      fbEl.textContent = msg.includes('501') || msg.includes('not implemented') ? 'Join by code is coming soon.' : (msg || 'Invalid or expired invite code.');
      fbEl.className = 'sg-modal-feedback is-error'; joinBtn.disabled = false; joinBtn.textContent = 'Join group \u2192';
    }
  });
  footer.appendChild(cancelBtn); footer.appendChild(joinBtn);
  wrap.appendChild(title); wrap.appendChild(field); wrap.appendChild(fbEl); wrap.appendChild(footer);
  return wrap;
}

function buildSgInviteModal(group, isLeader) {
  const { wrap, title, fbEl } = sgModalShell(`Invite someone to ${group?.name || 'this group'}`);
  const field = document.createElement('div'); field.className = 'sg-modal-field';
  const lbl = document.createElement('label'); lbl.className = 'sg-modal-label'; lbl.textContent = 'Friend'; lbl.htmlFor = 'sg-modal-friend';
  const sel = document.createElement('select'); sel.id = 'sg-modal-friend'; sel.className = 'sg-modal-input';
  const friends = Array.isArray(socialState.eligibleTradeGroupFriends) ? socialState.eligibleTradeGroupFriends : [];
  if (!friends.length) {
    const opt = document.createElement('option'); opt.value = ''; opt.textContent = isLeader ? 'No eligible friends to invite' : 'Leader only'; sel.appendChild(opt); sel.disabled = true;
  } else {
    friends.forEach(f => { const opt = document.createElement('option'); opt.value = f.friend_user_id; opt.textContent = f.nickname || 'Unknown trader'; sel.appendChild(opt); });
  }
  field.appendChild(lbl); field.appendChild(sel);
  const codeField = document.createElement('div'); codeField.className = 'sg-modal-field';
  const codeLbl = document.createElement('div'); codeLbl.className = 'sg-modal-label'; codeLbl.textContent = 'Or share invite code';
  const codeStatic = document.createElement('div'); codeStatic.className = 'sg-modal-static';
  const codeVal = document.createElement('div'); codeVal.className = 'sg-modal-static-value'; codeVal.textContent = '\u2014';
  const codeHint = document.createElement('div'); codeHint.className = 'sg-modal-static-label'; codeHint.textContent = 'Invite codes are not yet supported by the backend.';
  codeStatic.appendChild(codeVal); codeStatic.appendChild(codeHint); codeField.appendChild(codeLbl); codeField.appendChild(codeStatic);
  const footer = document.createElement('div'); footer.className = 'sg-modal-footer';
  const cancelBtn = createActionButton('Cancel', 'ghost'); cancelBtn.addEventListener('click', closeSgModal);
  const sendBtn = document.createElement('button'); sendBtn.type = 'button'; sendBtn.className = 'primary'; sendBtn.textContent = 'Send invite \u2192';
  if (!isLeader || !friends.length) sendBtn.disabled = true;
  sendBtn.addEventListener('click', async () => {
    const friendId = String(sel.value || '').trim();
    if (!friendId) { fbEl.textContent = 'Select a friend to invite.'; fbEl.className = 'sg-modal-feedback is-error'; return; }
    sendBtn.disabled = true; sendBtn.textContent = 'Sending\u2026';
    try {
      await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ friend_user_id: friendId }) });
      fbEl.textContent = 'Invitation sent.'; fbEl.className = 'sg-modal-feedback is-success';
      sendBtn.textContent = 'Sent'; window.setTimeout(closeSgModal, 1200);
      await loadTradeGroupDetail(socialState.selectedTradeGroupId);
    } catch (err) { fbEl.textContent = err?.message || 'Unable to send invitation.'; fbEl.className = 'sg-modal-feedback is-error'; sendBtn.disabled = false; sendBtn.textContent = 'Send invite \u2192'; }
  });
  footer.appendChild(cancelBtn); footer.appendChild(sendBtn);
  wrap.appendChild(title); wrap.appendChild(field); wrap.appendChild(codeField); wrap.appendChild(fbEl); wrap.appendChild(footer);
  return wrap;
}

function buildSgLeaveModal(group, isLeader) {
  const { wrap, title, fbEl } = sgModalShell(isLeader ? 'Transfer leadership first' : `Leave ${group?.name || 'this group'}?`);
  if (isLeader) {
    const copy = document.createElement('p'); copy.className = 'sg-modal-danger-copy';
    copy.textContent = `You're the leader of ${group?.name || 'this group'}. Leaders can't leave without transferring ownership. Go to group settings to transfer leadership, then leave.`;
    const footer = document.createElement('div'); footer.className = 'sg-modal-footer';
    const settingsBtn = document.createElement('button'); settingsBtn.type = 'button'; settingsBtn.className = 'primary'; settingsBtn.textContent = 'Open settings';
    settingsBtn.addEventListener('click', () => { closeSgModal(); showSgModal('settings'); });
    const cancelBtn = createActionButton('Cancel', 'ghost'); cancelBtn.addEventListener('click', closeSgModal);
    footer.appendChild(settingsBtn); footer.appendChild(cancelBtn);
    wrap.appendChild(title); wrap.appendChild(copy); wrap.appendChild(footer);
  } else {
    const copy = document.createElement('p'); copy.style.cssText = 'font-size:13px;color:var(--text-muted);margin:0';
    copy.textContent = `You'll lose access to the group workspace, shared watchlists, and activity feed. This cannot be undone.`;
    const footer = document.createElement('div'); footer.className = 'sg-modal-footer';
    const cancelBtn = createActionButton('Cancel', 'ghost'); cancelBtn.addEventListener('click', closeSgModal);
    const leaveBtn = document.createElement('button'); leaveBtn.type = 'button'; leaveBtn.className = 'danger'; leaveBtn.textContent = `Leave ${group?.name || 'group'} \u2192`;
    leaveBtn.addEventListener('click', async () => {
      if (!socialState.profile?.user_id || !socialState.selectedTradeGroupId) return;
      leaveBtn.disabled = true; leaveBtn.textContent = 'Leaving\u2026';
      try {
        await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/members/${encodeURIComponent(socialState.profile.user_id)}`, { method: 'DELETE' });
        closeSgModal(); await loadTradeGroups();
      } catch (err) { fbEl.textContent = err?.message || 'Unable to leave group.'; fbEl.className = 'sg-modal-feedback is-error'; leaveBtn.disabled = false; leaveBtn.textContent = `Leave ${group?.name || 'group'} \u2192`; }
    });
    footer.appendChild(cancelBtn); footer.appendChild(leaveBtn);
    wrap.appendChild(title); wrap.appendChild(copy); wrap.appendChild(fbEl); wrap.appendChild(footer);
  }
  return wrap;
}

function buildSgSettingsModal(group, isLeader) {
  const { wrap, title, fbEl } = sgModalShell(`${group?.name || 'Group'} settings`);
  if (isLeader) {
    // Post announcement section
    const annField = document.createElement('div'); annField.className = 'sg-modal-field';
    const annLbl = document.createElement('label'); annLbl.className = 'sg-modal-label'; annLbl.textContent = 'Post announcement'; annLbl.htmlFor = 'sg-modal-announcement';
    const annInput = document.createElement('input'); annInput.id = 'sg-modal-announcement'; annInput.className = 'sg-modal-input'; annInput.type = 'text'; annInput.maxLength = 500; annInput.placeholder = 'Market plan update\u2026';
    const annBtn = createActionButton('Post', 'ghost');
    annBtn.addEventListener('click', async () => {
      const text = String(annInput.value || '').trim();
      if (!text) { fbEl.textContent = 'Enter announcement text.'; fbEl.className = 'sg-modal-feedback is-error'; return; }
      annBtn.disabled = true; annBtn.textContent = 'Posting\u2026';
      try {
        await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/announcements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        annInput.value = ''; fbEl.textContent = 'Announcement posted.'; fbEl.className = 'sg-modal-feedback is-success';
        await loadTradeGroupDetail(socialState.selectedTradeGroupId);
        annBtn.disabled = false; annBtn.textContent = 'Post';
      } catch (err) { fbEl.textContent = err?.message || 'Unable to post.'; fbEl.className = 'sg-modal-feedback is-error'; annBtn.disabled = false; annBtn.textContent = 'Post'; }
    });
    annField.appendChild(annLbl); annField.appendChild(annInput); annField.appendChild(annBtn);
    // Delete group section
    const delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.className = 'danger outline'; delBtn.style.cssText = 'width:100%;margin-top:8px'; delBtn.textContent = 'Delete group\u2026';
    delBtn.addEventListener('click', async () => {
      if (!window.confirm(`Delete "${group?.name}"? This will close access for all members.`)) return;
      const deletingId = socialState.selectedTradeGroupId;
      socialState.tradeGroups = socialState.tradeGroups.filter(g => g.id !== deletingId);
      socialState.selectedTradeGroupId = '';
      closeSgModal(); renderTradeGroupSection();
      try { await socialApi(`/api/social/trade-groups/${encodeURIComponent(deletingId)}`, { method: 'DELETE' }); await loadTradeGroups(); } catch (_e) { await loadTradeGroups(); }
    });
    const footer = document.createElement('div'); footer.className = 'sg-modal-footer';
    const closeBtn = createActionButton('Close', 'ghost'); closeBtn.addEventListener('click', closeSgModal);
    footer.appendChild(closeBtn);
    wrap.appendChild(title); wrap.appendChild(annField); wrap.appendChild(fbEl); wrap.appendChild(delBtn); wrap.appendChild(footer);
  } else {
    const note = document.createElement('p'); note.style.cssText = 'font-size:13px;color:var(--text-muted);margin:0';
    note.textContent = 'Only the group leader can change settings.';
    const footer = document.createElement('div'); footer.className = 'sg-modal-footer';
    const closeBtn = createActionButton('Close', 'ghost'); closeBtn.addEventListener('click', closeSgModal);
    footer.appendChild(closeBtn);
    wrap.appendChild(title); wrap.appendChild(note); wrap.appendChild(footer);
  }
  return wrap;
}

function buildSgAnnouncementModal(group) {
  const { wrap, title, fbEl } = sgModalShell('Post announcement');
  const field = document.createElement('div'); field.className = 'sg-modal-field';
  const lbl = document.createElement('label'); lbl.className = 'sg-modal-label'; lbl.textContent = 'Message'; lbl.htmlFor = 'sg-modal-announce-text';
  const textarea = document.createElement('textarea');
  textarea.id = 'sg-modal-announce-text';
  textarea.className = 'sg-modal-input sg-modal-textarea';
  textarea.maxLength = 280;
  textarea.rows = 4;
  textarea.placeholder = 'Share a market update, trade plan, or reminder\u2026';
  const charCount = document.createElement('div'); charCount.className = 'sg-modal-char-count'; charCount.textContent = '0 / 280';
  textarea.addEventListener('input', () => { charCount.textContent = `${textarea.value.length} / 280`; });
  field.appendChild(lbl); field.appendChild(textarea); field.appendChild(charCount);
  const footer = document.createElement('div'); footer.className = 'sg-modal-footer';
  const cancelBtn = createActionButton('Cancel', 'ghost'); cancelBtn.addEventListener('click', closeSgModal);
  const postBtn = createActionButton('Post', 'primary');
  postBtn.addEventListener('click', async () => {
    const text = String(textarea.value || '').trim();
    if (!text) { fbEl.textContent = 'Enter a message.'; fbEl.className = 'sg-modal-feedback is-error'; return; }
    postBtn.disabled = true; postBtn.textContent = 'Posting\u2026';
    try {
      await socialApi(`/api/social/trade-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/announcements`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
      });
      closeSgModal();
      await loadTradeGroupDetail(socialState.selectedTradeGroupId);
    } catch (err) {
      fbEl.textContent = err?.message || 'Unable to post.'; fbEl.className = 'sg-modal-feedback is-error';
      postBtn.disabled = false; postBtn.textContent = 'Post';
    }
  });
  footer.appendChild(cancelBtn); footer.appendChild(postBtn);
  wrap.appendChild(title); wrap.appendChild(field); wrap.appendChild(fbEl); wrap.appendChild(footer);
  return wrap;
}

function buildSgShareWatchlistModal(group, isLeader) {
  const { wrap, title, fbEl } = sgModalShell('Share a watchlist with the group');
  const mine = Array.isArray(socialState.myWatchlists) ? socialState.myWatchlists : [];
  if (!isLeader) {
    const note = document.createElement('p'); note.style.cssText = 'font-size:13px;color:var(--text-muted);margin:0'; note.textContent = 'Only the group leader can share watchlists.';
    const footer = document.createElement('div'); footer.className = 'sg-modal-footer';
    const closeBtn = createActionButton('Close', 'ghost'); closeBtn.addEventListener('click', closeSgModal); footer.appendChild(closeBtn);
    wrap.appendChild(title); wrap.appendChild(note); wrap.appendChild(footer);
    return wrap;
  }
  if (!mine.length) {
    const note = document.createElement('p'); note.style.cssText = 'font-size:13px;color:var(--text-muted);margin:0'; note.textContent = 'You don\u2019t have any personal watchlists to share yet.';
    const footer = document.createElement('div'); footer.className = 'sg-modal-footer';
    const closeBtn = createActionButton('Close', 'ghost'); closeBtn.addEventListener('click', closeSgModal); footer.appendChild(closeBtn);
    wrap.appendChild(title); wrap.appendChild(note); wrap.appendChild(footer);
    return wrap;
  }
  const list = document.createElement('div'); list.className = 'sg-modal-watchlist-list';
  mine.forEach(wl => {
    const row = document.createElement('div'); row.className = 'sg-modal-watchlist-row';
    const info = document.createElement('div');
    const wname = document.createElement('div'); wname.className = 'sg-modal-watchlist-name'; wname.textContent = wl.name || 'Watchlist';
    const wmeta = document.createElement('div'); wmeta.className = 'sg-modal-watchlist-meta'; wmeta.textContent = `${wl.tickerCount || 0} tickers`;
    info.appendChild(wname); info.appendChild(wmeta); row.appendChild(info);
    const shareBtn = createActionButton('Share', 'ghost sg-modal-share-btn');
    shareBtn.addEventListener('click', async () => {
      shareBtn.disabled = true; shareBtn.textContent = 'Sharing\u2026';
      try {
        await socialApi(`/api/trading-groups/${encodeURIComponent(socialState.selectedTradeGroupId)}/watchlists`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceWatchlistId: wl.id }) });
        shareBtn.textContent = 'Shared \u2713';
        fbEl.textContent = `${wl.name} shared with the group.`; fbEl.className = 'sg-modal-feedback is-success';
        await loadTradeGroupDetail(socialState.selectedTradeGroupId);
      } catch (err) { fbEl.textContent = err?.message || 'Unable to share watchlist.'; fbEl.className = 'sg-modal-feedback is-error'; shareBtn.disabled = false; shareBtn.textContent = 'Share'; }
    });
    row.appendChild(shareBtn); list.appendChild(row);
  });
  const footer = document.createElement('div'); footer.className = 'sg-modal-footer';
  const closeBtn = createActionButton('Done', 'ghost'); closeBtn.addEventListener('click', closeSgModal); footer.appendChild(closeBtn);
  wrap.appendChild(title); wrap.appendChild(list); wrap.appendChild(fbEl); wrap.appendChild(footer);
  return wrap;
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
    memberCount: Array.isArray(socialState.selectedTradeGroupMembers) ? socialState.selectedTradeGroupMembers.length : 0,
    feedTop: (Array.isArray(socialState.selectedTradeGroupAlerts) ? socialState.selectedTradeGroupAlerts : []).slice(0, 5).map((item) => item?.id || item?.created_at || '').join('|'),
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

  const friendCount = Array.isArray(socialState.friends) ? socialState.friends.length : 0;
  const groupCount  = Array.isArray(socialState.tradeGroups) ? socialState.tradeGroups.length : 0;

  // Header subtitle counts
  const friendsEl = getEl('social-overview-friends');
  const groupsEl  = getEl('social-overview-groups');
  if (friendsEl) friendsEl.textContent = String(friendCount);
  if (groupsEl)  groupsEl.textContent  = String(groupCount);

  // Sidebar stat mirrors (profile mini-card)
  const statFriendsEl = getEl('sov-stat-friends');
  const statGroupsEl  = getEl('sov-stat-groups');
  if (statFriendsEl) statFriendsEl.textContent = String(friendCount);
  if (statGroupsEl)  statGroupsEl.textContent  = String(groupCount);

  // Rank (sidebar stat + used by both overview and profile mini)
  const myNickname = String(socialState.nickname || '').trim().toLowerCase();
  const rankEl = getEl('social-overview-rank');
  if (rankEl) {
    const myEntry = (Array.isArray(socialState.leaderboardEntries) ? socialState.leaderboardEntries : [])
      .find(entry => String(entry?.nickname || '').trim().toLowerCase() === myNickname);
    const hasRank = !!myEntry?.rank;
    rankEl.textContent = hasRank ? `#${myEntry.rank}` : '—';
    rankEl.classList.toggle('is-ranked', hasRank);
  }

  // Verification pill — show only when broker_verified or platform_verified
  const verificationEl = getEl('social-overview-verification');
  if (verificationEl) {
    const status = socialState.settings?.verification_status || socialState.profile?.verification_status || 'none';
    const display = getVerificationDisplay(status, socialState.settings?.verification_source);
    verificationEl.textContent = display.label;
    const show = status === 'broker_verified' || status === 'platform_verified';
    verificationEl.classList.toggle('hidden', !show);
  }

  // Profile mini-card identity
  const profileNameEl  = getEl('sov-profile-mini-name');
  const profileSinceEl = getEl('sov-profile-mini-since');
  if (profileNameEl) profileNameEl.textContent = socialState.nickname || 'Your profile';
  if (profileSinceEl) {
    const status = socialState.settings?.verification_status || socialState.profile?.verification_status || 'none';
    if (status === 'broker_verified')   profileSinceEl.textContent = 'Broker verified';
    else if (status === 'platform_verified') profileSinceEl.textContent = 'Platform verified';
    else profileSinceEl.textContent = 'Unverified';
  }
  const profileAvatarSlot = getEl('sov-profile-avatar');
  if (profileAvatarSlot) {
    clearNode(profileAvatarSlot);
    const av = window.VeracitySocialAvatar?.createAvatar({
      nickname: socialState.nickname,
      avatar_url: socialState.profile?.avatar_url,
      avatar_initials: socialState.profile?.avatar_initials,
    }, 'sm');
    if (av) profileAvatarSlot.appendChild(av);
  }

  // Active group
  const group = (Array.isArray(socialState.tradeGroups) ? socialState.tradeGroups : [])
    .find(item => String(item.id) === String(socialState.selectedTradeGroupId))
    || (Array.isArray(socialState.tradeGroups) ? socialState.tradeGroups[0] : null);

  const selectedGroupEl = getEl('social-overview-selected-group');
  if (selectedGroupEl) selectedGroupEl.textContent = group?.name || 'No group selected';

  // Role badge
  const roleBadgeEl = getEl('sov-group-role-badge');
  if (roleBadgeEl) {
    const roleLabel = group?.role === 'leader' ? 'LEADER' : group?.role ? 'MEMBER' : '';
    roleBadgeEl.textContent = roleLabel;
    roleBadgeEl.classList.toggle('hidden', !roleLabel);
    if (roleLabel) {
      roleBadgeEl.className = `sov-member-badge${group?.role === 'leader' ? ' is-leader' : ''}`;
    }
  }

  // Group footer: combined "N members · last active Xm ago"
  const latestAlert = Array.isArray(socialState.selectedTradeGroupAlerts) ? socialState.selectedTradeGroupAlerts[0] : null;
  const groupMetaEl = getEl('social-overview-group-meta');
  if (groupMetaEl) {
    const memberCount = Number(group?.member_count);
    const memberLabel = Number.isFinite(memberCount)
      ? `${memberCount} member${memberCount !== 1 ? 's' : ''}`
      : '—';
    const activityTs = formatRelativeTimestamp(latestAlert?.created_at || latestAlert?.updated_at || null);
    const activityLabel = activityTs !== 'No recent activity' ? activityTs : '—';
    groupMetaEl.textContent = `${memberLabel} · last active ${activityLabel}`;
  }

  // Member avatar stack
  const avatarStackEl = getEl('sov-avatar-stack');
  if (avatarStackEl) {
    clearNode(avatarStackEl);
    (Array.isArray(socialState.selectedTradeGroupMembers) ? socialState.selectedTradeGroupMembers : [])
      .slice(0, 4)
      .forEach(member => {
        const av = window.VeracitySocialAvatar?.createAvatar({
          nickname: member.nickname,
          avatar_url: member.avatar_url,
          avatar_initials: member.avatar_initials,
        }, 'xs');
        if (av) {
          av.classList.add('sov-stack-avatar');
          avatarStackEl.appendChild(av);
        }
      });
  }

  // Feed filter active state
  const feedFilterEl = getEl('social-overview-feed-filter');
  if (feedFilterEl) {
    const selectedFilter = socialState.overviewFeedFilter || 'all';
    Array.from(feedFilterEl.querySelectorAll('.social-feed-filter-btn')).forEach((btn) => {
      const value = btn.dataset.feedFilter || 'all';
      const isActive = value === selectedFilter;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  // Live indicator
  const liveIndicatorEl = getEl('social-live-indicator');
  if (liveIndicatorEl) {
    liveIndicatorEl.classList.toggle('is-flashing', Date.now() < Number(socialState.liveFeedFlashUntil || 0));
  }

  // Feed items
  const groupFeedEl = getEl('social-overview-group-feed');
  if (groupFeedEl) {
    clearNode(groupFeedEl);
    const allItems = Array.isArray(socialState.selectedTradeGroupAlerts) ? socialState.selectedTradeGroupAlerts : [];
    const selectedFilter = socialState.overviewFeedFilter || 'all';
    const filteredItems = allItems.filter((item) => {
      const nc = normalizeTradeGroupActivityEvent(item);
      const isAnnouncement = nc === 'announcement';
      // Notes match only explicit type === 'note'; 'other' is a grab-bag, not notes.
      const isNote = String(item?.type || '').toLowerCase() === 'note';
      const isTrade = !isAnnouncement && !isNote;
      if (selectedFilter === 'announcements') return isAnnouncement;
      if (selectedFilter === 'notes')         return isNote;
      if (selectedFilter === 'trades')        return isTrade;
      return true;
    }).slice(0, 5);

    if (!group?.id) {
      groupFeedEl.appendChild(createEmptyState('No active group selected', 'Open Groups to select or create a trading group.'));
    } else if (!filteredItems.length) {
      const notesEmptyDetail = 'Notes are posts your group members write outside of a trade — analysis, observations, and market thoughts will appear here.';
      const emptyDetail = selectedFilter === 'notes'
        ? notesEmptyDetail
        : selectedFilter === 'all'
          ? 'Activity from your selected group will appear here.'
          : `No ${selectedFilter} activity in this group yet.`;
      groupFeedEl.appendChild(createEmptyState('No recent activity', emptyDetail));
    } else {
      filteredItems.forEach(item => {
        groupFeedEl.appendChild(createSovFeedItem(item));
      });
    }
  }

  // Group action links
  const selectedGroupId = String(group?.id || '');
  const groupsHref = selectedGroupId ? `/social/groups?group=${encodeURIComponent(selectedGroupId)}` : '/social/groups';
  const openGroupActionEl   = getEl('social-overview-open-group-action');
  const inviteActionEl      = getEl('social-overview-invite-action');
  const announceActionEl    = getEl('social-overview-announce-action');
  const positionsActionEl   = getEl('social-overview-positions-action');
  if (openGroupActionEl)  openGroupActionEl.href = groupsHref;
  if (inviteActionEl)     inviteActionEl.href    = `${groupsHref}#invite`;
  if (announceActionEl) {
    announceActionEl.href = `${groupsHref}#announcement`;
    announceActionEl.classList.toggle('hidden', group?.role !== 'leader');
  }
  if (positionsActionEl)  positionsActionEl.href = `${groupsHref}#positions`;

  // Friends card — no user IDs displayed
  const friendsPreviewEl = getEl('social-overview-friends-preview');
  if (friendsPreviewEl) {
    clearNode(friendsPreviewEl);
    const previewFriends = Array.isArray(socialState.friends) ? socialState.friends.slice(0, 4) : [];
    if (!previewFriends.length) {
      const empty = document.createElement('p');
      empty.className = 'sov-empty-hint';
      empty.textContent = 'No friends yet.';
      friendsPreviewEl.appendChild(empty);
    } else {
      previewFriends.forEach(friend => {
        const row = document.createElement('div');
        row.className = 'sov-friend-row';

        const avatarWrap = document.createElement('div');
        avatarWrap.className = 'sov-friend-avatar-wrap';
        const av = window.VeracitySocialAvatar?.createAvatar({
          nickname: friend.nickname,
          avatar_url: friend.avatar_url,
          avatar_initials: friend.avatar_initials,
        }, 'xs');
        if (av) avatarWrap.appendChild(av);
        row.appendChild(avatarWrap);

        const info = document.createElement('div');
        info.className = 'sov-friend-info';

        const nameEl = document.createElement('span');
        nameEl.className = 'sov-friend-name';
        nameEl.textContent = friend.nickname || 'Unknown trader';

        const statusEl = document.createElement('span');
        statusEl.className = 'sov-friend-status';
        const activityTs = friend.last_activity_at || friend.last_seen_at || null;
        statusEl.textContent = activityTs
          ? `Active ${formatRelativeTimestamp(activityTs)}`
          : 'Offline';

        info.appendChild(nameEl);
        info.appendChild(statusEl);
        row.appendChild(info);
        friendsPreviewEl.appendChild(row);
      });
    }
  }

  // Sidebar sub-renders
  renderSidebarGroupsCard();
  renderSidebarLeaderboard();
  renderGroupPerformanceCard();
  renderTrendingTickersCard();
  renderUpcomingEventsCard();

  logSocialPerf('social-section-reused', { section: 'overview' });
}

// Creates a single feed item element for the activity feed.
function createSovFeedItem(item) {
  const nc = normalizeTradeGroupActivityEvent(item);
  const isAnnouncement = nc === 'announcement';
  const isClose = nc === 'close' || nc === 'trim';
  const isNote  = String(item?.type || '').toLowerCase() === 'note';
  const isOpen  = !isAnnouncement && !isClose && !isNote;

  const article = document.createElement('article');
  article.className = `sov-feed-item${isAnnouncement ? ' sov-feed-item--announcement' : ''}`;

  // Left: avatar or announcement icon
  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'sov-feed-item-avatar';
  if (isAnnouncement) {
    const iconBox = document.createElement('div');
    iconBox.className = 'sov-announcement-icon';
    iconBox.setAttribute('aria-hidden', 'true');
    iconBox.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2a6 6 0 100 12A6 6 0 008 2zm0 3.5a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 5.5zm0 6a.875.875 0 110-1.75.875.875 0 010 1.75z" fill="currentColor"/></svg>';
    avatarWrap.appendChild(iconBox);
  } else {
    const av = window.VeracitySocialAvatar?.createAvatar({
      nickname: item.leader_nickname || 'Leader',
      avatar_url: item.leader_avatar_url,
      avatar_initials: item.leader_avatar_initials,
    }, 'sm');
    if (av) avatarWrap.appendChild(av);
  }
  article.appendChild(avatarWrap);

  const body = document.createElement('div');
  body.className = 'sov-feed-item-body';

  // Header line
  const head = document.createElement('div');
  head.className = 'sov-feed-item-head';

  const timestamp = document.createElement('span');
  timestamp.className = 'sov-feed-item-timestamp';
  timestamp.textContent = formatRelativeTimestamp(item.created_at || item.updated_at);

  if (isAnnouncement) {
    const label = document.createElement('span');
    label.className = 'sov-feed-item-announcement-label';
    label.textContent = 'Group announcement';
    head.appendChild(label);
    head.appendChild(timestamp);
  } else {
    const actor = document.createElement('span');
    actor.className = 'sov-feed-item-actor';
    actor.textContent = item.leader_nickname || 'Leader';
    head.appendChild(actor);

    if (isNote) {
      const action = document.createElement('span');
      action.className = 'sov-feed-item-action';
      action.textContent = 'posted a note';
      head.appendChild(action);
    } else if (isClose) {
      const side     = String(item?.side || '').toUpperCase();
      const sideText = side === 'SELL' ? 'short' : 'long';
      const verb     = nc === 'trim' ? 'trimmed' : 'closed';
      const action   = document.createElement('span');
      action.className = 'sov-feed-item-action';
      action.textContent = `${verb} a ${sideText} in`;
      head.appendChild(action);
      if (item.ticker) {
        const tickerEl = document.createElement('span');
        tickerEl.className = 'sov-feed-item-ticker';
        tickerEl.textContent = String(item.ticker).toUpperCase();
        head.appendChild(tickerEl);
      }
      const rVal = computeRMultiple(item);
      if (rVal !== null) {
        const sign   = rVal >= 0 ? '+' : '\u2212';
        const rBadge = document.createElement('span');
        rBadge.className = `sov-r-badge ${rVal >= 0 ? 'sov-r-badge--win' : 'sov-r-badge--loss'}`;
        rBadge.textContent = `${sign}${Math.abs(rVal).toFixed(1)}R`;
        head.appendChild(rBadge);
      }
    } else {
      // Open trade
      const side     = String(item?.side || '').toUpperCase();
      const sideText = side === 'SELL' ? 'short' : 'long';
      const action   = document.createElement('span');
      action.className = 'sov-feed-item-action';
      action.textContent = `opened a ${sideText} in`;
      head.appendChild(action);
      if (item.ticker) {
        const tickerEl = document.createElement('span');
        tickerEl.className = 'sov-feed-item-ticker';
        tickerEl.textContent = String(item.ticker).toUpperCase();
        head.appendChild(tickerEl);
      }
      const dirBadge = document.createElement('span');
      dirBadge.className = `sov-dir-badge ${side === 'SELL' ? 'sov-dir-badge--sell' : 'sov-dir-badge--buy'}`;
      dirBadge.textContent = side === 'SELL' ? 'SELL' : 'BUY';
      head.appendChild(dirBadge);
    }
    head.appendChild(timestamp);
  }
  body.appendChild(head);

  // Content
  if (isAnnouncement) {
    const announcementBody = document.createElement('p');
    announcementBody.className = 'sov-feed-item-announcement-body';
    announcementBody.textContent = item.text || 'Announcement posted to the group.';
    body.appendChild(announcementBody);
  } else if (isNote) {
    const noteBody = document.createElement('p');
    noteBody.className = 'sov-feed-item-note-body';
    noteBody.textContent = item.text || '';
    body.appendChild(noteBody);
  } else if (isClose) {
    const entry  = Number(item?.entry_price);
    const exit   = Number(item?.fill_price);
    const pnlPct = Number(item?.pnl_percent ?? item?.realized_pnl_percent ?? item?.percent_change);
    body.appendChild(sovStatsGrid([
      { label: 'Entry',  value: Number.isFinite(entry) ? entry.toFixed(2) : '—', cls: '' },
      { label: 'Exit',   value: Number.isFinite(exit)  ? exit.toFixed(2)  : '—', cls: '' },
      { label: 'Held',   value: '—', cls: 'sov-stats-value--muted' },
      {
        label: 'Result',
        value: Number.isFinite(pnlPct)
          ? `${pnlPct > 0 ? '+' : '\u2212'}${Math.abs(pnlPct).toFixed(2)}%`
          : '—',
        cls: Number.isFinite(pnlPct)
          ? (pnlPct >= 0 ? 'sov-stats-value--success' : 'sov-stats-value--danger')
          : '',
      },
    ]));
  } else {
    // Open trade stats
    const entry = Number(item?.entry_price);
    const stop  = Number(item?.stop_price);
    const risk  = Number(item?.risk_pct);
    body.appendChild(sovStatsGrid([
      { label: 'Entry',   value: Number.isFinite(entry) ? entry.toFixed(2)       : '—', cls: '' },
      { label: 'Stop',    value: Number.isFinite(stop)  ? stop.toFixed(2)        : '—', cls: 'sov-stats-value--danger' },
      { label: 'Risk',    value: Number.isFinite(risk)  ? `${risk.toFixed(2)}%`  : '—', cls: '' },
      { label: 'Current', value: '—', cls: 'sov-stats-value--muted' }, // TODO: live price
    ]));

    // "Size this trade" CTA
    const actions = document.createElement('div');
    actions.className = 'sov-feed-item-actions';
    const prefill = normalizeAlertRiskPrefillPayload(item);
    const sizeBtn = document.createElement('button');
    sizeBtn.type = 'button';
    sizeBtn.className = 'sov-action-btn-primary';
    sizeBtn.textContent = 'Size this trade';
    if (prefill) {
      sizeBtn.addEventListener('click', () => launchAlertRiskSizing(item));
    } else {
      sizeBtn.disabled = true;
      sizeBtn.title = 'Price and stop are required for risk sizing';
    }
    actions.appendChild(sizeBtn);
    body.appendChild(actions);
  }

  article.appendChild(body);
  return article;
}

// Shared stats grid builder for feed items.
function sovStatsGrid(cells) {
  const grid = document.createElement('div');
  grid.className = 'sov-stats-grid';
  cells.forEach(({ label, value, cls }) => {
    const cell = document.createElement('div');
    cell.className = 'sov-stats-cell';
    const lbl = document.createElement('span');
    lbl.className = 'sov-stats-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = cls ? `sov-stats-value ${cls}` : 'sov-stats-value';
    val.textContent = value;
    cell.appendChild(lbl);
    cell.appendChild(val);
    grid.appendChild(cell);
  });
  return grid;
}

// Sidebar: groups list
function renderSidebarGroupsCard() {
  const listEl = getEl('sov-sidebar-groups');
  if (!listEl) return;
  clearNode(listEl);
  const groups = Array.isArray(socialState.tradeGroups) ? socialState.tradeGroups.slice(0, 3) : [];
  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'sov-empty-hint';
    empty.textContent = 'No groups yet.';
    listEl.appendChild(empty);
    return;
  }
  groups.forEach(group => {
    const isActive = String(group.id) === String(socialState.selectedTradeGroupId)
      || (!socialState.selectedTradeGroupId && groups[0] === group);
    const row = document.createElement('div');
    row.className = `sov-group-row${isActive ? ' sov-group-row--active' : ''}`;

    const left = document.createElement('div');
    left.className = 'sov-group-row-left';
    const name = document.createElement('span');
    name.className = 'sov-group-row-name';
    name.textContent = group.name || 'Unnamed group';
    const sub = document.createElement('span');
    sub.className = 'sov-group-row-sub';
    const roleLabel   = group.role === 'leader' ? 'Leader' : 'Member';
    const memberCount = Number(group.member_count);
    const memberLabel = Number.isFinite(memberCount)
      ? `${memberCount} member${memberCount !== 1 ? 's' : ''}`
      : '';
    sub.textContent = [roleLabel, memberLabel].filter(Boolean).join(' · ');
    left.appendChild(name);
    left.appendChild(sub);

    const online = document.createElement('span');
    online.className = 'sov-group-row-online';
    online.textContent = ''; // TODO: per-group online count when API provides it

    row.appendChild(left);
    row.appendChild(online);
    listEl.appendChild(row);
  });
}

// Sidebar: compact leaderboard using shared createLeaderboardRow
function renderSidebarLeaderboard() {
  const rowsEl = getEl('sov-lb-rows');
  if (!rowsEl) return;
  clearNode(rowsEl);

  if (socialState.leaderboardLoading || socialState.leaderboardError) return;

  const allEntries = Array.isArray(socialState.leaderboardEntries) ? socialState.leaderboardEntries : [];
  const top3 = allEntries.slice(0, 3);
  if (!top3.length) return;

  const myNickname = String(socialState.nickname || '').trim().toLowerCase();
  const myEntryFound = allEntries.find(e =>
    String(e?.nickname || '').trim().toLowerCase() === myNickname
  );
  const myIsOutside = myEntryFound && !top3.find(e => e === myEntryFound);

  top3.forEach(entry => {
    rowsEl.appendChild(createLeaderboardRow(entry, { compact: true, myNickname }));
  });

  if (myIsOutside) {
    const sep = document.createElement('div');
    sep.className = 'sov-lb-sep';
    sep.textContent = '\u00b7\u00b7\u00b7';
    rowsEl.appendChild(sep);
    rowsEl.appendChild(createLeaderboardRow(myEntryFound, { compact: true, myNickname }));
  }
}

// Insights: weekly group performance card
function renderGroupPerformanceCard() {
  const tilesEl      = getEl('sov-perf-tiles');
  const dateRangeEl  = getEl('sov-perf-date-range');
  const sparkSection = getEl('sov-sparkline-section');
  if (!tilesEl) return;
  clearNode(tilesEl);

  const alerts = Array.isArray(socialState.selectedTradeGroupAlerts) ? socialState.selectedTradeGroupAlerts : [];
  const now    = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  const closedThisWeek = alerts.filter(item => {
    const nc = normalizeTradeGroupActivityEvent(item);
    const ts = new Date(item?.created_at || 0).getTime();
    return nc === 'close' && now - ts <= weekMs;
  });

  const pnlValues = closedThisWeek
    .map(item => Number(item?.pnl_percent ?? item?.realized_pnl_percent ?? item?.percent_change))
    .filter(v => Number.isFinite(v));

  const groupAvgPct  = pnlValues.length > 0
    ? (pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length)
    : null;
  const wins         = pnlValues.filter(v => v > 0).length;
  const groupWinRate = pnlValues.length > 0
    ? Math.round(wins / pnlValues.length * 100)
    : null;

  if (dateRangeEl) {
    const start = new Date(now - weekMs);
    const end   = new Date(now);
    const fmt   = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    dateRangeEl.textContent = `${fmt(start)} – ${fmt(end)}`;
  }

  const avgTile = document.createElement('div');
  avgTile.className = 'sov-perf-tile';
  const avgVal = document.createElement('div');
  const avgNum = groupAvgPct !== null ? groupAvgPct : null;
  avgVal.className = `sov-perf-tile-value${avgNum === null ? '' : avgNum >= 0 ? ' sov-perf-tile-value--pos' : ' sov-perf-tile-value--neg'}`;
  avgVal.textContent = avgNum !== null ? `${avgNum >= 0 ? '+' : ''}${avgNum.toFixed(2)}%` : '—';
  const avgLbl = document.createElement('div');
  avgLbl.className = 'sov-perf-tile-label';
  avgLbl.textContent = 'Group avg return';
  avgTile.appendChild(avgVal);
  avgTile.appendChild(avgLbl);

  const wrTile = document.createElement('div');
  wrTile.className = 'sov-perf-tile';
  const wrVal = document.createElement('div');
  wrVal.className = 'sov-perf-tile-value';
  wrVal.textContent = groupWinRate !== null ? `${groupWinRate}%` : '—';
  const wrLbl = document.createElement('div');
  wrLbl.className = 'sov-perf-tile-label';
  wrLbl.textContent = 'Group win rate';
  wrTile.appendChild(wrVal);
  wrTile.appendChild(wrLbl);

  tilesEl.appendChild(avgTile);
  tilesEl.appendChild(wrTile);

  if (sparkSection) {
    sparkSection.style.display = closedThisWeek.length >= 2 ? '' : 'none';
    if (closedThisWeek.length >= 2) drawPerformanceSparkline(closedThisWeek);
  }
}

// Draws a simple sparkline on the canvas using closed-trade pnl values.
function drawPerformanceSparkline(closedItems) {
  const canvas = getEl('sov-perf-canvas');
  if (!canvas || !canvas.getContext) return;
  const ctx  = canvas.getContext('2d');
  const w    = canvas.offsetWidth || 220;
  const h    = 56;
  canvas.width  = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);

  const sorted = closedItems
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const values = sorted.map(item =>
    Number(item?.pnl_percent ?? item?.realized_pnl_percent ?? 0)
  );

  const minV  = Math.min(0, ...values) * 1.1;
  const maxV  = Math.max(0, ...values) * 1.1;
  const range = maxV - minV || 1;
  const toY   = v => h - ((v - minV) / range) * (h - 4) - 2;
  const toX   = i => (i / (values.length - 1)) * w;

  // Dashed zero line
  const zeroY = toY(0);
  ctx.beginPath();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 0.5;
  ctx.moveTo(0, zeroY);
  ctx.lineTo(w, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Group performance line (group avg = green)
  ctx.beginPath();
  ctx.strokeStyle = '#10B981';
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'round';
  values.forEach((v, i) => {
    i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v));
  });
  ctx.stroke();
}

// Insights: trending tickers card
function renderTrendingTickersCard() {
  const listEl = getEl('sov-trending-list');
  if (!listEl) return;
  clearNode(listEl);

  const alerts   = Array.isArray(socialState.selectedTradeGroupAlerts) ? socialState.selectedTradeGroupAlerts : [];
  const now      = Date.now();
  const sevenDay = 7 * 24 * 60 * 60 * 1000;

  const recent = alerts.filter(item => {
    const nc = normalizeTradeGroupActivityEvent(item);
    const ts = new Date(item?.created_at || 0).getTime();
    return nc !== 'announcement' && item?.ticker && now - ts <= sevenDay;
  });

  // Aggregate by ticker: count trades + unique members
  const tradeCount  = {};
  const memberSets  = {};
  recent.forEach(item => {
    const ticker = String(item.ticker || '').toUpperCase();
    if (!ticker) return;
    tradeCount[ticker]  = (tradeCount[ticker] || 0) + 1;
    if (!memberSets[ticker]) memberSets[ticker] = new Set();
    if (item.leader_nickname) memberSets[ticker].add(item.leader_nickname);
  });

  const sorted = Object.entries(tradeCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (!sorted.length) {
    const empty = document.createElement('p');
    empty.className = 'sov-empty-hint';
    empty.textContent = 'No trades this week — check back after open.';
    listEl.appendChild(empty);
    return;
  }

  sorted.forEach(([ticker, count]) => {
    const members = memberSets[ticker]?.size || 0;
    const row     = document.createElement('div');
    row.className = 'sov-trending-row';

    const tickerEl = document.createElement('span');
    tickerEl.className = 'sov-trending-ticker';
    tickerEl.textContent = ticker;

    const meta = document.createElement('span');
    meta.className = 'sov-trending-meta';
    meta.textContent = `${count} trade${count !== 1 ? 's' : ''} · ${members} member${members !== 1 ? 's' : ''}`;

    const change = document.createElement('span');
    change.className = 'sov-trending-change sov-trending-change--neutral';
    change.textContent = '—'; // TODO: live price % change when quotes endpoint is available

    row.appendChild(tickerEl);
    row.appendChild(meta);
    row.appendChild(change);
    listEl.appendChild(row);
  });
}

// Insights: upcoming events card
function renderUpcomingEventsCard() {
  const listEl = getEl('sov-events-list');
  if (!listEl) return;
  clearNode(listEl);

  // TODO: Pull from group calendar API when available.
  // TODO: Cross-reference group member holdings with earnings calendar when available.
  // TODO: Include relevant macro events (FOMC, CPI, NFP) from macro calendar when available.
  const empty = document.createElement('p');
  empty.className = 'sov-empty-hint';
  empty.textContent = 'Upcoming earnings for tickers your group is trading and group calendar events will appear here.';
  listEl.appendChild(empty);
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
  if (SOCIAL_PAGE_KIND === 'groups') initSgPage();
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
