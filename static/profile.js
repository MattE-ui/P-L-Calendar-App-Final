const isGuestSession = () => (sessionStorage.getItem('guestMode') === 'true'
  || localStorage.getItem('guestMode') === 'true')
  && typeof window.handleGuestRequest === 'function';
const clearGuestMode = () => {
  sessionStorage.removeItem('guestMode');
  localStorage.removeItem('guestMode');
};

async function api(path, opts = {}) {
  if (isGuestSession()) {
    return window.handleGuestRequest(path, opts);
  }
  const res = await fetch(path, { credentials: 'include', ...opts });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (res.status === 401) {
    if (data?.error && data.error.includes('Guest session expired')) {
      window.location.href = '/login.html?expired=guest';
    } else {
      window.location.href = '/login.html';
    }
    throw new Error('Unauthenticated');
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.data = data;
    throw err;
  }
  if (!isGuestSession()) {
    clearGuestMode();
  }
  return data;
}

function logoutRequestOptions() {
  const headers = {};
  const deviceId = localStorage.getItem('veracity_notification_device_id');
  if (deviceId) headers['x-device-id'] = deviceId;
  return { method: 'POST', headers };
}

const profileState = {
  complete: false,
  netDeposits: 0,
  netDepositsBaseline: 0,
  username: '',
  nickname: '',
  avatarUrl: '',
  avatarInitials: 'V',
  avatarBusy: false,
  isGuest: false,
  currency: 'GBP',
  rates: { GBP: 1 },
  multiTradingAccountsEnabled: false,
  tradingAccounts: [{
    id: 'primary',
    label: 'Primary account',
    currentValue: 0,
    currentNetDeposits: 0,
    integrationProvider: null,
    integrationEnabled: false
  }],
  investorAccountsEnabled: false,
  investorPortalAvailable: false
};

const PROFILE_AUTO_REFRESH_MS = 5 * 1000;
let profileRefreshTimer = null;
let profileLoadInFlight = false;
let suppressProfileAutoRefreshUntil = 0;
const notificationState = {
  initialized: false,
  supported: false,
  config: null,
  deviceId: '',
  activeDeviceId: '',
  permission: 'default',
  scriptLoadPromise: null,
  firebaseInitPromise: null,
  messaging: null,
  registerInFlight: false,
  deviceList: [],
  lastStep: 'idle',
  lastError: '',
  lastDeleteActionResult: 'none',
  autoReregisterDetected: false,
  lastRegisterTriggerSource: 'none',
  categories: {
    criticalRiskAlerts: true,
    tradeAlerts: true,
    tradeGroupAlerts: true,
    socialInvestorNotifications: true,
    brokerSyncFailures: true,
    dailyRecap: false,
    soundEnabled: true
  }
};

const NOTIFICATION_REMOVED_CURRENT_DEVICE_KEY = 'veracity_notification_current_device_removed';

const avatarEditorState = {
  open: false,
  image: null,
  objectUrl: '',
  zoom: 1,
  minZoom: 1,
  maxZoom: 3,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragOriginX: 0,
  dragOriginY: 0,
  saving: false
};

const currencySymbols = { GBP: '£', USD: '$' };

function currencyAmount(valueGBP, currency = profileState.currency) {
  const base = Number(valueGBP);
  if (Number.isNaN(base)) return null;
  if (currency === 'GBP') return base;
  const rate = profileState.rates[currency];
  if (!rate) return null;
  return base * rate;
}

function formatCurrency(valueGBP, currency = profileState.currency) {
  if (currency === 'GBP') {
    const amount = Number(valueGBP) || 0;
    const sign = amount < 0 ? '-' : '';
    return `${sign}${currencySymbols[currency]}${Math.abs(amount).toFixed(2)}`;
  }
  const amount = currencyAmount(Math.abs(valueGBP), currency);
  if (amount === null) return '—';
  const sign = valueGBP < 0 ? '-' : '';
  return `${sign}${currencySymbols[currency]}${amount.toFixed(2)}`;
}

function formatSignedCurrency(valueGBP, currency = profileState.currency) {
  if (valueGBP === 0) return `${currencySymbols[currency]}0.00`;
  const amount = currencyAmount(Math.abs(valueGBP), currency);
  if (amount === null) return '—';
  const sign = valueGBP < 0 ? '-' : '';
  return `${sign}${currencySymbols[currency]}${amount.toFixed(2)}`;
}

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '0.00%';
  const num = Number(value);
  const sign = num < 0 ? '-' : '';
  return `${sign}${Math.abs(num).toFixed(2)}%`;
}

function setMetricTrend(el, value) {
  if (!el) return;
  window.ThemeUtils?.applyPnlColorClass(el, value);
}

async function loadRates() {
  try {
    const res = await api('/api/rates');
    const rates = res?.rates || {};
    profileState.rates = { GBP: 1, ...rates };
  } catch (e) {
    console.warn('Unable to load exchange rates', e);
    profileState.rates = {
      GBP: 1,
      ...(profileState.rates.USD ? { USD: profileState.rates.USD } : {}),
      ...(profileState.rates.EUR ? { EUR: profileState.rates.EUR } : {})
    };
  }
}

function setupNavDrawer() {
  const navToggle = document.getElementById('nav-toggle-btn');
  const navDrawer = document.getElementById('nav-drawer');
  const navOverlay = document.getElementById('nav-drawer-overlay');
  const navClose = document.getElementById('nav-close-btn');
  const setNavOpen = open => {
    if (!navDrawer || !navOverlay || !navToggle) return;
    navDrawer.classList.toggle('hidden', !open);
    navOverlay.classList.toggle('hidden', !open);
    navOverlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  navToggle?.addEventListener('click', () => {
    if (!navDrawer || !navOverlay) return;
    const isOpen = !navDrawer.classList.contains('hidden');
    setNavOpen(!isOpen);
  });
  navClose?.addEventListener('click', () => setNavOpen(false));
  navOverlay?.addEventListener('click', () => setNavOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    setNavOpen(false);
  });
  return setNavOpen;
}

function bindNav() {
  const closeNav = setupNavDrawer();
  document.getElementById('calendar-btn')?.addEventListener('click', () => {
    window.location.href = '/';
  });
  document.getElementById('analytics-btn')?.addEventListener('click', () => {
    window.location.href = '/analytics.html';
  });
  document.getElementById('trades-btn')?.addEventListener('click', () => {
    window.location.href = '/trades.html';
  });
  document.getElementById('transactions-btn')?.addEventListener('click', () => {
    window.location.href = '/transactions.html';
  });
  document.getElementById('devtools-btn')?.addEventListener('click', () => {
    closeNav?.(false);
    window.location.href = '/devtools.html';
  });
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/logout', logoutRequestOptions());
    } catch (e) {
      console.warn(e);
    }
    sessionStorage.removeItem('guestMode');
    localStorage.removeItem('guestMode');
    window.location.href = '/login.html';
  });
  document.getElementById('quick-settings-btn')?.addEventListener('click', () => {
    closeNav?.(false);
    const modal = document.getElementById('quick-settings-modal');
    const riskSel = document.getElementById('qs-risk-select');
    const curSel = document.getElementById('qs-currency-select');
    const applyPrefs = prefs => {
      if (riskSel && Number.isFinite(prefs?.defaultRiskPct)) riskSel.value = String(prefs.defaultRiskPct);
      if (curSel && prefs?.defaultRiskCurrency) curSel.value = prefs.defaultRiskCurrency;
    };
    try {
      const saved = localStorage.getItem('plc-prefs');
      if (saved) {
        applyPrefs(JSON.parse(saved));
      }
    } catch (e) {
      console.warn(e);
    }
    if (!isGuestSession()) {
      api('/api/prefs')
        .then(applyPrefs)
        .catch(err => console.warn('Failed to load ui prefs', err));
    }
    modal?.classList.remove('hidden');
  });
  const closeQs = () => document.getElementById('quick-settings-modal')?.classList.add('hidden');
  document.getElementById('close-qs-btn')?.addEventListener('click', closeQs);
  document.getElementById('save-qs-btn')?.addEventListener('click', () => {
    const riskSel = document.getElementById('qs-risk-select');
    const curSel = document.getElementById('qs-currency-select');
    const pct = Number(riskSel?.value);
    const cur = curSel?.value;
    const prefs = {};
    if (Number.isFinite(pct) && pct > 0) prefs.defaultRiskPct = pct;
    if (cur && ['GBP', 'USD'].includes(cur)) prefs.defaultRiskCurrency = cur;
    try {
      localStorage.setItem('plc-prefs', JSON.stringify(prefs));
    } catch (e) {
      console.warn(e);
    }
    if (!isGuestSession()) {
      api('/api/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs)
      }).catch(err => console.warn('Failed to save ui prefs', err));
    }
    closeQs();
  });
  api('/api/profile')
    .then(profile => {
      const show = profile?.username === 'mevs.0404@gmail.com' || profile?.username === 'dummy1';
      document.querySelectorAll('#devtools-btn').forEach(btn => btn.classList.toggle('is-hidden', !show));
    })
    .catch(() => {
      document.querySelectorAll('#devtools-btn').forEach(btn => btn.classList.add('is-hidden'));
    });
}

async function loadMasterSettings() {
  try {
    const settings = await api('/api/master/settings');
    profileState.investorAccountsEnabled = !!settings.investor_portal_enabled;
  } catch (error) {
    // Guests may receive 403; keep defaults.
  }
}

async function loadProfile({ refreshIntegrations = false } = {}) {
  if (profileLoadInFlight) return;
  profileLoadInFlight = true;
  try {
    const query = refreshIntegrations ? '?refreshIntegrations=1' : '';
    const data = await api(`/api/profile${query}`);
    const portfolio = Number(data.portfolio);
    const netDepositsBaseline = Number(data.initialNetDeposits);
    const netDepositsTotal = Number(data.netDepositsTotal);
    profileState.complete = !!data.profileComplete;
    profileState.netDepositsBaseline = Number.isFinite(netDepositsBaseline) ? netDepositsBaseline : 0;
    profileState.netDeposits = Number.isFinite(netDepositsTotal)
      ? netDepositsTotal
      : profileState.netDepositsBaseline;
    profileState.username = data.username || '';
    profileState.nickname = data.nickname || '';
    if (!isAvatarInteractionLocked()) {
      profileState.avatarUrl = data.avatarUrl || '';
      profileState.avatarInitials = data.avatarInitials || window.VeracitySocialAvatar?.deriveInitials(profileState.nickname) || 'V';
    }
    profileState.isGuest = !!data.isGuest;
    profileState.multiTradingAccountsEnabled = !!data.multiTradingAccountsEnabled;
    profileState.tradingAccounts = Array.isArray(data.tradingAccounts) && data.tradingAccounts.length
      ? data.tradingAccounts.map(account => ({
        id: account.id,
        label: account.label || '',
        currentValue: Number(account.currentValue) || 0,
        currentNetDeposits: Number(account.currentNetDeposits) || 0,
        integrationProvider: account.integrationProvider || null,
        integrationEnabled: !!account.integrationEnabled
      }))
      : [{ id: 'primary', label: 'Primary account', currentValue: 0, currentNetDeposits: 0, integrationProvider: null, integrationEnabled: false }];
    profileState.investorPortalAvailable = !!data.investorPortalAvailable;
    await loadMasterSettings();
    const portfolioInput = document.getElementById('profile-portfolio');
    const netInput = document.getElementById('profile-net-deposits');
    const deltaField = document.getElementById('profile-net-delta-field');
    const deltaInput = document.getElementById('profile-net-deposits-delta');
    const totalField = document.getElementById('profile-net-total-field');
    const helperInitial = document.getElementById('net-deposits-helper-initial');
    const helperExisting = document.getElementById('net-deposits-helper-existing');
    const dateEl = document.getElementById('profile-date');
    if (dateEl && typeof data.today === 'string') {
      const parsed = new Date(`${data.today}T00:00:00`);
      const formatted = Number.isNaN(parsed.getTime())
        ? data.today
        : parsed.toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          });
      dateEl.textContent = `As of ${formatted}`;
    }
    if (data.profileComplete) {
      if (portfolioInput && Number.isFinite(portfolio)) {
        portfolioInput.value = portfolio.toFixed(2);
      }
    }
    if (netInput) {
      const hasNet = Number.isFinite(profileState.netDeposits);
      netInput.value = hasNet ? profileState.netDeposits.toFixed(2) : '';
      netInput.readOnly = false;
      netInput.classList.remove('readonly');
      netInput.required = true;
    }
    if (totalField) {
      totalField.classList.remove('readonly');
    }
    if (deltaField) {
      deltaField.classList.toggle('is-hidden', !profileState.complete);
    }
    if (deltaInput) {
      deltaInput.value = '';
    }
    if (helperInitial) {
      helperInitial.classList.toggle('is-hidden', profileState.complete);
    }
    if (helperExisting) {
      helperExisting.classList.toggle('is-hidden', !profileState.complete);
    }
    const portfolioValue = Number.isFinite(portfolio) ? portfolio : 0;
    const netDepositsValue = Number.isFinite(profileState.netDeposits) ? profileState.netDeposits : 0;
    await loadRates();
    const netPerformance = portfolioValue - netDepositsValue;
    const netPerfPct = netDepositsValue ? (netPerformance / Math.abs(netDepositsValue)) * 100 : 0;
    const altCurrency = profileState.currency === 'GBP'
      ? (profileState.rates.USD ? 'USD' : (profileState.rates.EUR ? 'EUR' : null))
      : 'GBP';
    const heroPortfolio = document.getElementById('header-portfolio-value');
    if (heroPortfolio) heroPortfolio.textContent = formatCurrency(portfolioValue);
    const heroPortfolioSub = document.getElementById('header-portfolio-sub');
    if (heroPortfolioSub) {
      const altValue = altCurrency ? formatCurrency(portfolioValue, altCurrency) : '—';
      heroPortfolioSub.textContent = altCurrency && altValue !== '—' ? `≈ ${altValue}` : '';
    }
    const heroDeposits = document.getElementById('hero-net-deposits-value');
    if (heroDeposits) heroDeposits.textContent = formatSignedCurrency(netDepositsValue);
    const heroDepositsSub = document.getElementById('hero-net-deposits-sub');
    if (heroDepositsSub) {
      const altDeposits = altCurrency ? formatSignedCurrency(netDepositsValue, altCurrency) : '—';
      heroDepositsSub.textContent = altCurrency && altDeposits !== '—' ? `≈ ${altDeposits}` : '';
    }
    const heroPerformance = document.getElementById('hero-net-performance-value');
    if (heroPerformance) heroPerformance.textContent = formatSignedCurrency(netPerformance);
    const heroPerfSub = document.getElementById('hero-net-performance-sub');
    if (heroPerfSub) {
      const pieces = [];
      if (altCurrency) {
        const altPerf = formatSignedCurrency(netPerformance, altCurrency);
        if (altPerf !== '—') pieces.push(`≈ ${altPerf}`);
      }
      pieces.push(formatPercent(netPerfPct));
      heroPerfSub.textContent = pieces.join(' • ');
    }
    setMetricTrend(document.getElementById('hero-net-performance'), netPerformance);
    const heroPortfolioCard = document.getElementById('hero-portfolio');
    if (heroPortfolioCard) {
      setMetricTrend(heroPortfolioCard, portfolioValue - netDepositsValue);
    }
    const heroDepositsCard = document.getElementById('hero-net-deposits');
    if (heroDepositsCard) {
      heroDepositsCard.classList.remove('positive', 'negative');
    }
    applyGuestRestrictions();
    renderSecurityState();
    renderTradingAccounts();
    if (profileState.investorAccountsEnabled) {
      await loadInvestors();
    }
  } catch (e) {
    console.error('Unable to load profile details', e);
  } finally {
    profileLoadInFlight = false;
  }
}

function applyGuestRestrictions() {
  const banner = document.getElementById('guest-restriction');
  if (banner) {
    banner.classList.toggle('hidden', !profileState.isGuest);
  }
  const disable = profileState.isGuest;
  const disableIds = [
    'account-password-current',
    'account-password-new',
    'account-password-submit',
    'account-nickname',
    'account-nickname-submit',
    'account-avatar-input',
    'account-avatar-upload',
    'account-avatar-remove',
    'profile-reset',
    't212-enabled',
    't212-mode',
    't212-add-account',
    't212-save',
    't212-run-now',
    'investor-accounts-enabled',
    'investor-accounts-save',
    'trading-accounts-enabled',
    'trading-account-add',
    'trading-accounts-save',
    'investor-create-btn',
    'investor-valuation-btn'
  ];
  disableIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = disable;
      if (disable) {
        el.setAttribute('title', 'Guests cannot perform this action. Please create an account.');
      } else {
        el.removeAttribute('title');
      }
    }
  });
  const sections = ['account-profile-section', 'security-section', 'profile-reset-card'];
  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('guest-disabled', disable);
  });
  document.querySelectorAll('#t212-accounts input, #t212-accounts button').forEach(input => {
    input.disabled = disable;
  });
}

const profileSubsectionRouteConfig = {
  '/profile/manage': {
    title: 'Manage Profile',
    description: 'Update your identity, avatar, and portfolio baseline details for accurate reporting.',
    sectionIds: ['profile-setup-section', 'account-profile-section']
  },
  '/profile/trading-accounts': {
    title: 'Trading Accounts',
    description: 'Manage linked broker accounts, connection controls, and broker status from one place.',
    sectionIds: ['trading-accounts-section', 'ibkr-card']
  },
  '/profile/investor-accounts': {
    title: 'Investor Accounts',
    description: 'Control investor access, profit splits, NAV updates, and investor reporting operations.',
    sectionIds: ['investor-section']
  },
  '/profile/notifications': {
    title: 'Notifications',
    description: 'Manage permission status, registered devices, and notification preferences.',
    sectionIds: ['notification-settings-section']
  },
  '/profile/security': {
    title: 'Security',
    description: 'Update account password and secure access controls without mixing profile settings.',
    sectionIds: ['security-section']
  },
  '/profile/billing': {
    title: 'Billing & Subscription',
    description: 'Review your current plan and billing workspace details.',
    sectionIds: ['billing-section']
  },
  '/profile/settings': {
    title: 'Settings',
    description: 'Manage general app behaviors and account-level operational controls.',
    sectionIds: ['profile-reset-card']
  }
};

function applySubsectionRouteMode() {
  const route = profileSubsectionRouteConfig[window.location.pathname];
  if (!route || !Array.isArray(route.sectionIds)) return;
  const headerCard = document.getElementById('profile-subsection-header');
  const titleEl = document.getElementById('profile-subsection-title');
  const descriptionEl = document.getElementById('profile-subsection-description');
  const profileHeader = document.querySelector('.profile-header');
  const profileGrid = document.querySelector('.profile-grid');
  if (!profileGrid) return;
  if (headerCard) headerCard.classList.remove('is-hidden');
  if (profileHeader) profileHeader.classList.add('is-hidden');
  if (titleEl) titleEl.textContent = route.title || 'Account Center section';
  if (descriptionEl) descriptionEl.textContent = route.description || '';
  const visible = new Set(route.sectionIds);
  profileGrid.querySelectorAll('.profile-card').forEach(section => {
    section.classList.toggle('is-hidden', !visible.has(section.id));
  });
}


function isAvatarInteractionLocked() {
  return profileState.avatarBusy || avatarEditorState.open || avatarEditorState.saving;
}

function getAvatarEditorElements() {
  return {
    modal: document.getElementById('avatar-editor-modal'),
    canvas: document.getElementById('avatar-editor-canvas'),
    zoom: document.getElementById('avatar-editor-zoom'),
    save: document.getElementById('avatar-editor-save'),
    cancel: document.getElementById('avatar-editor-cancel'),
    close: document.getElementById('avatar-editor-close'),
    error: document.getElementById('avatar-editor-error')
  };
}

function renderAvatarControls() {
  const slot = document.getElementById('profile-avatar-preview');
  if (slot) {
    slot.innerHTML = '';
    const avatarNode = window.VeracitySocialAvatar?.createAvatar({
      nickname: profileState.nickname,
      avatar_url: profileState.avatarUrl,
      avatar_initials: profileState.avatarInitials
    }, 'lg');
    if (avatarNode) slot.appendChild(avatarNode);
  }

  const uploadBtn = document.getElementById('account-avatar-upload');
  const removeBtn = document.getElementById('account-avatar-remove');
  const hasAvatar = !!profileState.avatarUrl;
  if (uploadBtn) {
    uploadBtn.textContent = hasAvatar ? 'Replace avatar' : 'Upload avatar';
    uploadBtn.disabled = profileState.isGuest || isAvatarInteractionLocked();
  }
  if (removeBtn) {
    removeBtn.classList.toggle('hidden', !hasAvatar);
    removeBtn.disabled = profileState.isGuest || isAvatarInteractionLocked();
  }
}

function setAvatarFeedback(message = '', kind = 'muted') {
  const status = document.getElementById('account-avatar-status');
  const error = document.getElementById('account-avatar-error');
  if (error) error.textContent = kind === 'error' ? message : '';
  if (status) {
    status.textContent = kind === 'error' ? '' : message;
    status.classList.toggle('is-hidden', !(kind !== 'error' && message));
    status.classList.toggle('is-error', kind === 'error');
  }
}

function setAvatarEditorError(message = '') {
  const { error } = getAvatarEditorElements();
  if (error) error.textContent = message;
}

function clampAvatarOffsets() {
  if (!avatarEditorState.image) return;
  const canvas = document.getElementById('avatar-editor-canvas');
  if (!canvas) return;
  const cropSize = Math.min(canvas.width, canvas.height);
  const baseScale = Math.max(cropSize / avatarEditorState.image.naturalWidth, cropSize / avatarEditorState.image.naturalHeight);
  const drawWidth = avatarEditorState.image.naturalWidth * baseScale * avatarEditorState.zoom;
  const drawHeight = avatarEditorState.image.naturalHeight * baseScale * avatarEditorState.zoom;
  const maxX = Math.max(0, (drawWidth - cropSize) / 2);
  const maxY = Math.max(0, (drawHeight - cropSize) / 2);
  avatarEditorState.offsetX = Math.min(maxX, Math.max(-maxX, avatarEditorState.offsetX));
  avatarEditorState.offsetY = Math.min(maxY, Math.max(-maxY, avatarEditorState.offsetY));
}

function renderAvatarEditorCanvas() {
  const { canvas } = getAvatarEditorElements();
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!avatarEditorState.image) {
    ctx.fillStyle = 'rgba(10,16,24,0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const cropSize = Math.min(canvas.width, canvas.height);
  const baseScale = Math.max(cropSize / avatarEditorState.image.naturalWidth, cropSize / avatarEditorState.image.naturalHeight);
  const drawWidth = avatarEditorState.image.naturalWidth * baseScale * avatarEditorState.zoom;
  const drawHeight = avatarEditorState.image.naturalHeight * baseScale * avatarEditorState.zoom;
  const x = (canvas.width - drawWidth) / 2 + avatarEditorState.offsetX;
  const y = (canvas.height - drawHeight) / 2 + avatarEditorState.offsetY;

  ctx.fillStyle = '#070d14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(avatarEditorState.image, x, y, drawWidth, drawHeight);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = cropSize / 2 - 3;

  ctx.save();
  ctx.fillStyle = 'rgba(2,6,10,0.5)';
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(97, 241, 177, 0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function closeAvatarEditor({ resetFile = true } = {}) {
  const { modal } = getAvatarEditorElements();
  avatarEditorState.open = false;
  avatarEditorState.saving = false;
  avatarEditorState.dragging = false;
  avatarEditorState.image = null;
  avatarEditorState.zoom = 1;
  avatarEditorState.offsetX = 0;
  avatarEditorState.offsetY = 0;
  if (avatarEditorState.objectUrl) {
    URL.revokeObjectURL(avatarEditorState.objectUrl);
    avatarEditorState.objectUrl = '';
  }
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
  if (resetFile) {
    const fileInput = document.getElementById('account-avatar-input');
    if (fileInput) fileInput.value = '';
  }
  setAvatarEditorError('');
  renderAvatarControls();
}

async function openAvatarEditor(file) {
  if (!file || avatarEditorState.open || profileState.avatarBusy) return;
  const { modal, zoom } = getAvatarEditorElements();
  if (!modal || !zoom) return;

  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const maxBytes = 6 * 1024 * 1024;
  if (!allowedTypes.includes(file.type)) {
    setAvatarFeedback('Unsupported file type. Use JPG, PNG, or WEBP.', 'error');
    return;
  }
  if (file.size > maxBytes) {
    setAvatarFeedback('Selected image is too large. Please choose an image under 6MB.', 'error');
    return;
  }

  setAvatarFeedback('');
  setAvatarEditorError('');

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = objectUrl;
  try {
    await image.decode();
  } catch (_error) {
    URL.revokeObjectURL(objectUrl);
    setAvatarFeedback('Unable to read that image. Please try a different file.', 'error');
    return;
  }

  avatarEditorState.objectUrl = objectUrl;
  avatarEditorState.image = image;
  avatarEditorState.open = true;
  avatarEditorState.zoom = 1;
  avatarEditorState.offsetX = 0;
  avatarEditorState.offsetY = 0;
  avatarEditorState.minZoom = 1;
  avatarEditorState.maxZoom = 3;

  zoom.value = '1';
  zoom.min = String(avatarEditorState.minZoom);
  zoom.max = String(avatarEditorState.maxZoom);
  zoom.step = '0.01';

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  clampAvatarOffsets();
  renderAvatarEditorCanvas();
  renderAvatarControls();
}

function buildAvatarCroppedBlob() {
  const image = avatarEditorState.image;
  const canvas = document.getElementById('avatar-editor-canvas');
  if (!image || !canvas) return null;

  const cropSize = Math.min(canvas.width, canvas.height);
  const baseScale = Math.max(cropSize / image.naturalWidth, cropSize / image.naturalHeight);
  const scalePx = baseScale * avatarEditorState.zoom;
  const drawWidth = image.naturalWidth * scalePx;
  const drawHeight = image.naturalHeight * scalePx;
  const x = (canvas.width - drawWidth) / 2 + avatarEditorState.offsetX;
  const y = (canvas.height - drawHeight) / 2 + avatarEditorState.offsetY;

  const srcX = Math.max(0, (0 - x) / scalePx);
  const srcY = Math.max(0, (0 - y) / scalePx);
  const srcW = Math.min(image.naturalWidth - srcX, cropSize / scalePx);
  const srcH = Math.min(image.naturalHeight - srcY, cropSize / scalePx);

  const output = document.createElement('canvas');
  output.width = 512;
  output.height = 512;
  const outCtx = output.getContext('2d');
  if (!outCtx) return null;
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(image, srcX, srcY, srcW, srcH, 0, 0, output.width, output.height);

  return new Promise((resolve) => {
    output.toBlob((blob) => resolve(blob), 'image/webp', 0.92);
  });
}

async function saveAvatarFromEditor() {
  if (!avatarEditorState.open || avatarEditorState.saving || profileState.avatarBusy) return;
  avatarEditorState.saving = true;
  profileState.avatarBusy = true;
  renderAvatarControls();

  const { save, cancel, close, zoom } = getAvatarEditorElements();
  [save, cancel, close, zoom].forEach((el) => {
    if (el) el.disabled = true;
  });
  if (save) save.textContent = 'Saving...';
  setAvatarEditorError('');

  try {
    clampAvatarOffsets();
    renderAvatarEditorCanvas();
    const blob = await buildAvatarCroppedBlob();
    if (!blob) throw new Error('Could not prepare avatar crop.');
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const imageBase64 = btoa(binary);

    setAvatarFeedback('Uploading avatar...');
    const response = await api('/api/profile/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType: 'image/webp', imageBase64 })
    });

    profileState.avatarUrl = response.avatar_url || '';
    profileState.avatarInitials = response.avatar_initials || window.VeracitySocialAvatar?.deriveInitials(profileState.nickname) || 'V';
    suppressProfileAutoRefreshUntil = Date.now() + 8000;
    setAvatarFeedback('Avatar updated.', 'success');
    closeAvatarEditor();
    window.dispatchEvent(new CustomEvent('social:refresh-requested', { detail: { reason: 'avatar-uploaded' } }));
  } catch (error) {
    setAvatarEditorError(error?.data?.error || error.message || 'Unable to upload avatar right now.');
    setAvatarFeedback(error?.data?.error || error.message || 'Unable to upload avatar.', 'error');
  } finally {
    avatarEditorState.saving = false;
    profileState.avatarBusy = false;
    [save, cancel, close, zoom].forEach((el) => {
      if (el) el.disabled = false;
    });
    if (save) save.textContent = 'Save avatar';
    renderAvatarControls();
  }
}

async function removeAvatar() {
  if (isAvatarInteractionLocked() || !profileState.avatarUrl) return;
  profileState.avatarBusy = true;
  suppressProfileAutoRefreshUntil = Date.now() + 5000;
  renderAvatarControls();
  setAvatarFeedback('Removing avatar...');
  try {
    const response = await api('/api/profile/avatar', { method: 'DELETE' });
    profileState.avatarUrl = response.avatar_url || '';
    profileState.avatarInitials = response.avatar_initials || window.VeracitySocialAvatar?.deriveInitials(profileState.nickname) || 'V';
    setAvatarFeedback('Avatar removed.', 'success');
    window.dispatchEvent(new CustomEvent('social:refresh-requested', { detail: { reason: 'avatar-removed' } }));
  } catch (error) {
    setAvatarFeedback(error?.data?.error || error.message || 'Unable to remove avatar.', 'error');
  } finally {
    profileState.avatarBusy = false;
    renderAvatarControls();
  }
}

function bindAvatarActions() {
  const fileInput = document.getElementById('account-avatar-input');
  const uploadBtn = document.getElementById('account-avatar-upload');
  const removeBtn = document.getElementById('account-avatar-remove');
  const { canvas, zoom, save, cancel, close, modal } = getAvatarEditorElements();

  uploadBtn?.addEventListener('click', () => {
    if (profileState.isGuest || isAvatarInteractionLocked()) return;
    fileInput?.click();
  });

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    openAvatarEditor(file);
  });

  removeBtn?.addEventListener('click', removeAvatar);
  save?.addEventListener('click', saveAvatarFromEditor);

  const cancelEditor = () => {
    if (avatarEditorState.saving) return;
    closeAvatarEditor();
  };
  cancel?.addEventListener('click', cancelEditor);
  close?.addEventListener('click', cancelEditor);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) cancelEditor();
  });

  zoom?.addEventListener('input', () => {
    if (!avatarEditorState.open || avatarEditorState.saving) return;
    avatarEditorState.zoom = Number(zoom.value) || 1;
    clampAvatarOffsets();
    renderAvatarEditorCanvas();
  });

  if (canvas) {
    canvas.addEventListener('pointerdown', (event) => {
      if (!avatarEditorState.open || avatarEditorState.saving) return;
      avatarEditorState.dragging = true;
      avatarEditorState.dragStartX = event.clientX;
      avatarEditorState.dragStartY = event.clientY;
      avatarEditorState.dragOriginX = avatarEditorState.offsetX;
      avatarEditorState.dragOriginY = avatarEditorState.offsetY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!avatarEditorState.dragging || avatarEditorState.saving) return;
      avatarEditorState.offsetX = avatarEditorState.dragOriginX + (event.clientX - avatarEditorState.dragStartX);
      avatarEditorState.offsetY = avatarEditorState.dragOriginY + (event.clientY - avatarEditorState.dragStartY);
      clampAvatarOffsets();
      renderAvatarEditorCanvas();
    });
    const releaseDrag = (event) => {
      if (!avatarEditorState.dragging) return;
      avatarEditorState.dragging = false;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // ignore
      }
    };
    canvas.addEventListener('pointerup', releaseDrag);
    canvas.addEventListener('pointercancel', releaseDrag);
  }
}

function renderSecurityState() {
  const usernameInput = document.getElementById('account-username');
  if (usernameInput) {
    usernameInput.value = profileState.username || '';
  }
  const nicknameInput = document.getElementById('account-nickname');
  if (nicknameInput) {
    nicknameInput.value = profileState.nickname || '';
  }
  const investorToggle = document.getElementById('investor-accounts-enabled');
  if (investorToggle) {
    investorToggle.checked = !!profileState.investorAccountsEnabled;
    investorToggle.disabled = profileState.isGuest;
  }
  const investorManagedContent = document.getElementById('investor-managed-content');
  if (investorManagedContent) {
    investorManagedContent.classList.toggle('is-hidden', !(investorPortalEnabled() && profileState.investorAccountsEnabled));
  }
  const currentPasswordInput = document.getElementById('account-password-current');
  if (currentPasswordInput) {
    currentPasswordInput.value = '';
  }
  const newPasswordInput = document.getElementById('account-password-new');
  if (newPasswordInput) {
    newPasswordInput.value = '';
  }
  const statusLine = document.getElementById('account-security-status');
  if (statusLine) {
    statusLine.textContent = '';
    statusLine.classList.add('is-hidden');
  }
  const errorLine = document.getElementById('account-security-error');
  if (errorLine) {
    errorLine.textContent = '';
  }
  const nicknameStatus = document.getElementById('account-nickname-status');
  if (nicknameStatus) {
    nicknameStatus.textContent = '';
    nicknameStatus.classList.add('is-hidden');
  }
  const nicknameError = document.getElementById('account-nickname-error');
  if (nicknameError) {
    nicknameError.textContent = '';
  }
  if (!isAvatarInteractionLocked()) {
    const avatarStatus = document.getElementById('account-avatar-status');
    if (avatarStatus) {
      avatarStatus.textContent = '';
      avatarStatus.classList.add('is-hidden');
    }
    const avatarError = document.getElementById('account-avatar-error');
    if (avatarError) {
      avatarError.textContent = '';
    }
  }
  renderAvatarControls();
}

function renderTradingAccounts() {
  const toggle = document.getElementById('trading-accounts-enabled');
  const list = document.getElementById('trading-accounts-list');
  if (toggle) {
    toggle.checked = !!profileState.multiTradingAccountsEnabled;
    toggle.disabled = profileState.isGuest;
  }
  if (!list) return;
  const accounts = Array.isArray(profileState.tradingAccounts) && profileState.tradingAccounts.length
    ? profileState.tradingAccounts
    : [{ id: 'primary', label: 'Primary account' }];
  list.innerHTML = '';
  accounts.forEach((account, index) => {
    const provider = account.integrationEnabled ? account.integrationProvider : null;
    const useT212 = provider === 'trading212';
    const useIbkr = provider === 'ibkr';
    const row = document.createElement('div');
    row.className = 'profile-field';
    row.innerHTML = `
      <label>${index === 0 ? 'Primary account label' : `Account ${index + 1} label`}</label>
      <input type="text" data-account-id="${account.id}" data-account-field="label" value="${account.label || ''}" maxlength="40">
      <div class="profile-field two-col trading-account-metrics-row">
        <div class="trading-account-metric-field">
          <label>Current value (£)</label>
          <input type="number" min="0" step="0.01" ${provider ? 'disabled' : ''} data-account-id="${account.id}" data-account-field="currentValue" value="${Number(account.currentValue || 0).toFixed(2)}">
        </div>
        <div class="trading-account-metric-field">
          <label>Net deposits (£)</label>
          <input type="number" step="0.01" data-account-id="${account.id}" data-account-field="currentNetDeposits" value="${Number(account.currentNetDeposits || 0).toFixed(2)}">
        </div>
      </div>
      <div class="profile-actions trading-account-integration-actions">
        <button type="button" class="ghost small" data-account-id="${account.id}" data-account-action="integration-toggle" data-provider="trading212">${useT212 ? 'Turn off Trading 212 integration' : 'Use Trading 212 integration'}</button>
        <button type="button" class="ghost small" data-account-id="${account.id}" data-account-action="integration-toggle" data-provider="ibkr">${useIbkr ? 'Turn off IBKR integration' : 'Use IBKR integration'}</button>
      </div>
      <p class="helper trading-account-integration-note">${provider
    ? 'Integration active for broker market data. Log deposits and withdrawals manually for this account.'
    : 'Connect a broker for market data. Cashflows are managed manually on every account.'}</p>
    `;
    row.querySelectorAll('[data-account-action="integration-toggle"]').forEach(btn => {
      if (!(btn instanceof HTMLButtonElement)) return;
      const btnProvider = btn.dataset.provider;
      const usedElsewhere = accounts.some(item => item.id !== account.id && item.integrationEnabled && item.integrationProvider === btnProvider);
      if (usedElsewhere && btnProvider !== provider) {
        btn.disabled = true;
        btn.title = 'This integration is already assigned to another account.';
      }
    });
    list.appendChild(row);
  });
  const combinedPortfolio = accounts.reduce((sum, account) => sum + (Number(account.currentValue) || 0), 0);
  const combinedNet = accounts.reduce((sum, account) => sum + (Number(account.currentNetDeposits) || 0), 0);
  const portfolioInput = document.getElementById('profile-portfolio');
  const netInput = document.getElementById('profile-net-deposits');
  const deltaInput = document.getElementById('profile-net-deposits-delta');
  const multiEnabled = !!profileState.multiTradingAccountsEnabled;
  if (portfolioInput) {
    if (multiEnabled) {
      portfolioInput.value = combinedPortfolio.toFixed(2);
      portfolioInput.readOnly = true;
      portfolioInput.classList.add('readonly');
    } else {
      portfolioInput.readOnly = false;
      portfolioInput.classList.remove('readonly');
    }
  }
  if (netInput) {
    if (multiEnabled) {
      netInput.value = combinedNet.toFixed(2);
      netInput.readOnly = true;
      netInput.classList.add('readonly');
    } else {
      netInput.readOnly = false;
      netInput.classList.remove('readonly');
    }
  }
  if (deltaInput) {
    deltaInput.disabled = multiEnabled;
    if (multiEnabled) deltaInput.value = '';
  }
}

function getAssignedIntegrationProviders() {
  return new Map(
    profileState.tradingAccounts
      .filter(account => account.integrationEnabled && account.integrationProvider)
      .map(account => [account.integrationProvider, account.id])
  );
}

async function handleTradingAccountIntegrationToggle(accountId, provider) {
  const account = profileState.tradingAccounts.find(item => item.id === accountId);
  const status = document.getElementById('trading-accounts-status');
  const error = document.getElementById('trading-accounts-error');
  if (!account) return;
  if (status) {
    status.textContent = '';
    status.classList.add('is-hidden');
  }
  if (error) error.textContent = '';
  const turningOff = account.integrationEnabled && account.integrationProvider === provider;
  const integrationLabel = provider === 'ibkr' ? 'IBKR' : 'Trading 212';
  const assigned = getAssignedIntegrationProviders().get(provider);
  if (!turningOff && assigned && assigned !== account.id) {
    if (error) error.textContent = `${integrationLabel} is already assigned to another account. Remove it there first.`;
    return;
  }
  const confirmed = window.confirm(turningOff
    ? `Turn off ${integrationLabel} for this account and re-enable manual edits?`
    : `Use ${integrationLabel} to override this account values now? Manual portfolio/deposit edits for this account will be disabled until you turn integration off.`);
  if (!confirmed) return;
  try {
    const payload = await api('/api/account/trading-accounts/integration-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, provider, enabled: !turningOff })
    });
    profileState.tradingAccounts = Array.isArray(payload.accounts) && payload.accounts.length
      ? payload.accounts.map((item, index) => ({
        id: item.id,
        label: item.label || (index === 0 ? 'Primary account' : `Account ${index + 1}`),
        currentValue: Number(item.currentValue) || 0,
        currentNetDeposits: Number(item.currentNetDeposits) || 0,
        integrationProvider: item.integrationProvider || null,
        integrationEnabled: !!item.integrationEnabled
      }))
      : profileState.tradingAccounts;
    renderTradingAccounts();
    if (status) {
      status.textContent = payload.message || (turningOff
        ? `${integrationLabel} integration turned off for this account.`
        : `${integrationLabel} integration applied to this account.`);
      status.classList.remove('is-hidden');
    }
  } catch (e) {
    if (error) error.textContent = e?.data?.error || `Unable to toggle ${integrationLabel} for this account right now.`;
  }
}

async function handlePasswordChange() {
  const currentInput = document.getElementById('account-password-current');
  const newInput = document.getElementById('account-password-new');
  const error = document.getElementById('account-security-error');
  const status = document.getElementById('account-security-status');
  if (!currentInput || !newInput) return;
  const currentValue = currentInput.value.trim();
  const newValue = newInput.value.trim();
  if (error) error.textContent = '';
  if (status) status.textContent = '';
  if (!currentValue) {
    if (error) error.textContent = 'Enter your current password before updating it.';
    return;
  }
  const strong = newValue.length >= 12
    && /[A-Z]/.test(newValue)
    && /[a-z]/.test(newValue)
    && /\d/.test(newValue)
    && /[^A-Za-z0-9]/.test(newValue);
  if (!strong) {
    if (error) error.textContent = 'Enter a stronger password before updating it.';
    return;
  }
  try {
    await api('/api/account/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: currentValue, password: newValue })
    });
    currentInput.value = '';
    newInput.value = '';
    if (status) {
      status.textContent = 'Password updated successfully. Use your new password next time you log in.';
      status.classList.remove('is-hidden');
    }
  } catch (e) {
    console.error('Unable to update password', e);
    if (error) error.textContent = e?.data?.error || 'Unable to update your password right now.';
  }
}

async function handleNicknameUpdate() {
  const input = document.getElementById('account-nickname');
  const error = document.getElementById('account-nickname-error');
  const status = document.getElementById('account-nickname-status');
  if (!input) return;
  const raw = input.value.trim();
  if (error) error.textContent = '';
  if (status) {
    status.textContent = '';
    status.classList.add('is-hidden');
  }
  if (raw.length > 20) {
    if (error) error.textContent = 'Nicknames must be 20 characters or less.';
    return;
  }
  if (raw && !/^[A-Za-z0-9 ]+$/.test(raw)) {
    if (error) error.textContent = 'Nicknames can only use letters, numbers, and spaces.';
    return;
  }
  if (status) {
    status.textContent = 'Updating nickname…';
    status.classList.remove('is-hidden');
  }
  try {
    const data = await api('/api/account/nickname', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: raw })
    });
    profileState.nickname = data.nickname || '';
    profileState.avatarInitials = window.VeracitySocialAvatar?.deriveInitials(profileState.nickname) || 'V';
    input.value = profileState.nickname;
    renderAvatarControls();
    if (status) {
      status.textContent = profileState.nickname
        ? 'Nickname updated successfully.'
        : 'Nickname removed successfully.';
      status.classList.remove('is-hidden');
    }
  } catch (e) {
    console.error('Unable to update nickname', e);
    if (error) error.textContent = e?.data?.error || 'Unable to update nickname right now.';
  }
}

const integrationState = {
  hasApiKey: false,
  hasApiSecret: false,
  enabled: false,
  snapshotTime: '21:00',
  mode: 'live',
  timezone: 'Europe/London',
  baseUrl: '',
  endpoint: '/api/v0/equity/portfolio/summary',
  accounts: [],
  lastBaseUrl: null,
  lastEndpoint: null,
  cooldownUntil: null,
  lastRaw: null
};

const ibkrState = {
  enabled: false,
  mode: 'connector',
  accountId: '',
  connectionStatus: 'disconnected',
  lastHeartbeatAt: null,
  lastSnapshotAt: null,
  lastSyncAt: null,
  lastStatus: null,
  lastSessionCheckAt: null,
  lastPortfolioValue: null,
  lastPortfolioCurrency: null,
  lastConnectorStatus: null,
  connectorConfigured: false,
  tokenExpiresAt: null,
  connectorOnline: false,
  lastDisconnectReason: null
};

const ibkrDownloadState = {
  version: '',
  publishedAt: null,
  sizeBytes: null,
  sha256: '',
  releaseNotesUrl: '',
  notes: ''
};

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let num = size;
  while (num >= 1024 && idx < units.length - 1) {
    num /= 1024;
    idx += 1;
  }
  return `${num.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function setIntegrationFieldsDisabled(disabled) {
  const container = document.getElementById('t212-fields');
  const modeSelect = document.getElementById('t212-mode');
  const runBtn = document.getElementById('t212-run-now');
  const addBtn = document.getElementById('t212-add-account');
  if (container) container.classList.toggle('is-hidden', disabled);
  if (modeSelect) modeSelect.disabled = disabled;
  if (runBtn) runBtn.disabled = disabled;
  if (addBtn) addBtn.disabled = disabled;
  document.querySelectorAll('#t212-accounts input, #t212-accounts button').forEach(input => {
    input.disabled = disabled;
  });
}

function buildTrading212AccountRow(account, index) {
  const row = document.createElement('div');
  row.className = 't212-account-row';
  row.dataset.accountId = account.id || `account-${index + 1}`;
  row.dataset.hasApiKey = account.hasApiKey ? 'true' : 'false';
  row.dataset.hasApiSecret = account.hasApiSecret ? 'true' : 'false';

  const fields = document.createElement('div');
  fields.className = 't212-account-fields';

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'Account label (optional)';
  labelInput.value = account.label || '';
  labelInput.className = 't212-account-label';

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.placeholder = account.hasApiKey
    ? 'Key saved — paste a new key to replace'
    : 'Paste your API key';
  keyInput.autocomplete = 'off';
  keyInput.className = 't212-api-key';

  const secretInput = document.createElement('input');
  secretInput.type = 'password';
  secretInput.placeholder = account.hasApiSecret
    ? 'Secret saved — paste a new secret to replace'
    : 'Paste your API secret';
  secretInput.autocomplete = 'off';
  secretInput.className = 't212-api-secret';

  fields.append(labelInput, keyInput, secretInput);

  const actions = document.createElement('div');
  actions.className = 't212-account-actions';
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'ghost small';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    row.remove();
  });
  actions.append(removeBtn);

  row.append(fields, actions);
  return row;
}

function renderTrading212Accounts() {
  const container = document.getElementById('t212-accounts');
  if (!container) return;
  container.innerHTML = '';
  const accounts = Array.isArray(integrationState.accounts) && integrationState.accounts.length
    ? integrationState.accounts
    : [{ id: 'primary', label: '', hasApiKey: false, hasApiSecret: false }];
  accounts.forEach((account, index) => {
    container.appendChild(buildTrading212AccountRow(account, index));
  });
}

function collectTrading212Accounts() {
  const rows = Array.from(document.querySelectorAll('#t212-accounts .t212-account-row'));
  return rows.map((row, index) => {
    const labelInput = row.querySelector('.t212-account-label');
    const keyInput = row.querySelector('.t212-api-key');
    const secretInput = row.querySelector('.t212-api-secret');
    const labelValue = labelInput?.value.trim() || '';
    const apiKeyValue = keyInput?.value.trim() || '';
    const apiSecretValue = secretInput?.value.trim() || '';
    const payload = {
      id: row.dataset.accountId || `account-${index + 1}`,
      label: labelValue
    };
    if (apiKeyValue) {
      payload.apiKey = apiKeyValue;
    }
    if (apiSecretValue) {
      payload.apiSecret = apiSecretValue;
    }
    return payload;
  });
}

function renderIntegrationStatus(data) {
  const statusEl = document.getElementById('t212-status');
  const rawBtn = document.getElementById('t212-raw-btn');
  if (!statusEl) return;
  statusEl.classList.remove('is-error');
  if (rawBtn) {
    rawBtn.classList.toggle('is-hidden', !data.lastRaw);
  }
  if (!data.enabled) {
    statusEl.textContent = 'Automation is currently switched off.';
    return;
  }
  const timezone = data.timezone || 'Europe/London';
  const cooldownDate = data.cooldownUntil ? new Date(data.cooldownUntil) : null;
  if (data.lastSyncAt) {
    const date = new Date(data.lastSyncAt);
    const formatted = Number.isNaN(date.getTime())
      ? data.lastSyncAt
      : date.toLocaleString('en-GB', { timeZone: timezone });
    const hostDetail = data.lastBaseUrl ? ` via ${data.lastBaseUrl}${data.lastEndpoint || ''}` : '';
    if (data.lastStatus && data.lastStatus.ok) {
      statusEl.textContent = `Last synced ${formatted}${hostDetail ? ` ${hostDetail}` : ''}.`;
    } else if (data.lastStatus && data.lastStatus.message) {
      statusEl.classList.add('is-error');
      const statusCode = data.lastStatus.status ? ` (HTTP ${data.lastStatus.status})` : '';
      let message = data.lastStatus.message;
      if (cooldownDate && !Number.isNaN(cooldownDate.getTime()) && cooldownDate.getTime() > Date.now()) {
        const seconds = Math.max(0, Math.ceil((cooldownDate.getTime() - Date.now()) / 1000));
        const cooldownLabel = cooldownDate.toLocaleTimeString('en-GB', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        message += ` Next attempt after ${cooldownLabel} (${seconds}s).`;
      }
      const endpointInfo = hostDetail ? ` Endpoint tried:${hostDetail}` : '';
      statusEl.textContent = `Last sync failed${statusCode}: ${message}${endpointInfo}`;
    } else {
      statusEl.textContent = `Last sync attempted ${formatted}${hostDetail ? ` ${hostDetail}` : ''}.`;
    }
  } else if (data.lastStatus && !data.lastStatus.ok && data.lastStatus.message) {
    statusEl.classList.add('is-error');
    const statusCode = data.lastStatus.status ? ` (HTTP ${data.lastStatus.status})` : '';
    const hostDetail = data.lastBaseUrl ? ` via ${data.lastBaseUrl}${data.lastEndpoint || ''}` : '';
    statusEl.textContent = `Sync pending${statusCode}: ${data.lastStatus.message}${hostDetail}`;
  } else {
    statusEl.textContent = 'No Trading 212 data refresh has run yet.';
  }
}

function setIbkrFieldsDisabled(disabled) {
  const container = document.getElementById('ibkr-fields');
  if (container) container.classList.toggle('is-hidden', disabled);
}

function renderIbkrStatus(data) {
  const statusEl = document.getElementById('ibkr-status');
  const bannerEl = document.getElementById('ibkr-connector-banner');
  if (!statusEl) return;
  statusEl.classList.remove('is-error');
  if (!data.enabled) {
    statusEl.textContent = 'IBKR sync is currently switched off.';
    if (bannerEl) bannerEl.textContent = '';
    return;
  }
  const connection = data.connectionStatus || 'offline';
  const heartbeat = data.lastHeartbeatAt ? new Date(data.lastHeartbeatAt) : null;
  const snapshot = data.lastSnapshotAt ? new Date(data.lastSnapshotAt) : null;
  const heartbeatText = heartbeat && !Number.isNaN(heartbeat.getTime())
    ? `Last heartbeat ${heartbeat.toLocaleString('en-GB')}.`
    : 'No heartbeat yet.';
  const snapshotText = snapshot && !Number.isNaN(snapshot.getTime())
    ? `Last snapshot ${snapshot.toLocaleString('en-GB')}.`
    : 'No snapshot yet.';
  const connectorStatus = data.lastConnectorStatus || {};
  const statusLabel = connection === 'online'
    ? 'Connected'
    : connection === 'disconnected'
      ? 'Disconnected'
      : connection === 'error'
        ? 'Error'
        : 'Offline';
  const authStatus = connectorStatus.authStatus;
  if (connection !== 'online' && authStatus && authStatus.authenticated === false) {
    statusEl.classList.add('is-error');
    statusEl.textContent = 'IBKR session expired. Please login in the Client Portal Gateway.';
    if (bannerEl) bannerEl.textContent = 'Waiting for IBKR login — open the gateway UI to re-authenticate.';
    return;
  }
  if (connectorStatus.reason) {
    if (connection === 'error' || connection === 'disconnected') {
      statusEl.classList.add('is-error');
    }
    statusEl.textContent = `${statusLabel} • ${connectorStatus.reason} ${heartbeatText}`;
    if (bannerEl) bannerEl.textContent = data.connectorOnline
      ? ''
      : 'Connector offline — download and run the tray app to keep IBKR in sync.';
    return;
  }
  statusEl.textContent = `${statusLabel} • ${heartbeatText} ${snapshotText}`;
  if (bannerEl) bannerEl.textContent = data.connectorOnline
    ? ''
    : 'Connector offline — download and run the tray app to keep IBKR in sync.';
}

function renderIbkrSummary(data) {
  const accountEl = document.getElementById('ibkr-account-id');
  const currencyEl = document.getElementById('ibkr-root-currency');
  const portfolioEl = document.getElementById('ibkr-portfolio-value');
  if (accountEl) {
    accountEl.textContent = data.accountId ? data.accountId : 'Not connected';
  }
  if (currencyEl) {
    currencyEl.textContent = data.lastPortfolioCurrency || '—';
  }
  if (portfolioEl) {
    if (data.lastPortfolioValue !== null && data.lastPortfolioValue !== undefined) {
      const currency = data.lastPortfolioCurrency || '';
      const suffix = currency === 'UNKNOWN' ? ' (currency unknown)' : '';
      portfolioEl.textContent = `${Number(data.lastPortfolioValue).toLocaleString('en-GB', { maximumFractionDigits: 2 })} ${currency}${suffix}`.trim();
    } else {
      portfolioEl.textContent = '—';
    }
  }
}

function renderIbkrDownloadMeta() {
  const versionEl = document.getElementById('ibkr-installer-version');
  const publishedEl = document.getElementById('ibkr-installer-published');
  const sizeEl = document.getElementById('ibkr-installer-size');
  const shaEl = document.getElementById('ibkr-installer-sha');
  const notesLink = document.getElementById('ibkr-installer-notes-link');
  if (versionEl) versionEl.textContent = ibkrDownloadState.version || '—';
  if (publishedEl) {
    const date = ibkrDownloadState.publishedAt ? new Date(ibkrDownloadState.publishedAt) : null;
    publishedEl.textContent = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-GB') : '—';
  }
  if (sizeEl) sizeEl.textContent = formatBytes(ibkrDownloadState.sizeBytes);
  if (shaEl) shaEl.textContent = ibkrDownloadState.sha256 || '—';
  if (notesLink) {
    notesLink.href = ibkrDownloadState.releaseNotesUrl || '#';
    notesLink.classList.toggle('is-hidden', !ibkrDownloadState.releaseNotesUrl);
  }
}

async function loadIbkrDownloadMeta() {
  try {
    const data = await api('/api/downloads/ibkr-connector/windows/meta');
    ibkrDownloadState.version = data.version || '';
    ibkrDownloadState.publishedAt = data.publishedAt || null;
    ibkrDownloadState.sizeBytes = data.sizeBytes || null;
    ibkrDownloadState.sha256 = data.sha256 || '';
    ibkrDownloadState.releaseNotesUrl = data.releaseNotesUrl || '';
    ibkrDownloadState.notes = data.notes || '';
    renderIbkrDownloadMeta();
  } catch (e) {
    console.warn('Unable to load IBKR installer meta', e);
  }
}

function updateIbkrToggleState(data) {
  const toggle = document.getElementById('ibkr-enabled');
  if (!toggle) return;
  toggle.disabled = !data.connectorOnline;
}

async function loadIntegration() {
  try {
    const data = await api('/api/integrations/trading212');
    integrationState.hasApiKey = !!data.hasApiKey;
    integrationState.hasApiSecret = !!data.hasApiSecret;
    integrationState.enabled = !!data.enabled;
  integrationState.snapshotTime = data.snapshotTime || '21:00';
  integrationState.mode = data.mode || 'live';
  integrationState.timezone = data.timezone || 'Europe/London';
  integrationState.baseUrl = data.baseUrl || '';
  integrationState.endpoint = data.endpoint || '/api/v0/equity/account/summary';
    integrationState.accounts = Array.isArray(data.accounts) ? data.accounts : [];
    integrationState.lastBaseUrl = data.lastBaseUrl || null;
    integrationState.lastEndpoint = data.lastEndpoint || null;
    integrationState.cooldownUntil = data.cooldownUntil || null;
    integrationState.lastRaw = data.lastRaw || null;
    const toggle = document.getElementById('t212-enabled');
    const modeSelect = document.getElementById('t212-mode');
    if (toggle) toggle.checked = integrationState.enabled;
    if (modeSelect) modeSelect.value = integrationState.mode;
    renderTrading212Accounts();
    setIntegrationFieldsDisabled(!integrationState.enabled || profileState.isGuest);
    renderIntegrationStatus({
      enabled: integrationState.enabled,
      lastSyncAt: data.lastSyncAt,
      lastStatus: data.lastStatus,
      timezone: integrationState.timezone,
      cooldownUntil: integrationState.cooldownUntil,
      lastBaseUrl: integrationState.lastBaseUrl,
      lastEndpoint: integrationState.lastEndpoint,
      lastRaw: integrationState.lastRaw
    });
  } catch (e) {
    console.error('Unable to load Trading 212 settings', e);
    const statusEl = document.getElementById('t212-status');
    if (statusEl) statusEl.textContent = 'Trading 212 settings could not be loaded.';
  }
}

async function loadIbkrIntegration() {
  try {
    const data = await api('/api/integrations/ibkr');
    ibkrState.enabled = !!data.enabled;
    ibkrState.mode = data.mode || 'connector';
    ibkrState.accountId = data.accountId || '';
    ibkrState.connectionStatus = data.connectionStatus || 'disconnected';
    ibkrState.lastSyncAt = data.lastSyncAt || null;
    ibkrState.lastStatus = data.lastStatus || null;
    ibkrState.lastSessionCheckAt = data.lastSessionCheckAt || null;
    ibkrState.lastHeartbeatAt = data.lastHeartbeatAt || null;
    ibkrState.lastSnapshotAt = data.lastSnapshotAt || null;
    ibkrState.lastPortfolioValue = data.lastPortfolioValue ?? null;
    ibkrState.lastPortfolioCurrency = data.lastPortfolioCurrency || null;
    ibkrState.lastConnectorStatus = data.lastConnectorStatus || null;
    ibkrState.connectorOnline = !!data.connectorOnline;
    ibkrState.lastDisconnectReason = data.lastDisconnectReason || null;
    ibkrState.connectorConfigured = !!data.connectorConfigured;
    const tokenInput = document.getElementById('ibkr-connector-token');
    if (tokenInput && !ibkrState.connectorConfigured) {
      tokenInput.value = '';
    }
    const copyBtn = document.getElementById('ibkr-copy-token');
    if (copyBtn) {
      copyBtn.disabled = !tokenInput?.value;
    }
    const toggle = document.getElementById('ibkr-enabled');
    if (toggle) toggle.checked = ibkrState.enabled;
    updateIbkrToggleState(ibkrState);
    setIbkrFieldsDisabled(!ibkrState.enabled || profileState.isGuest);
    renderIbkrSummary(ibkrState);
    renderIbkrStatus(ibkrState);
  } catch (e) {
    console.error('Unable to load IBKR settings', e);
    const statusEl = document.getElementById('ibkr-status');
    if (statusEl) statusEl.textContent = 'IBKR settings could not be loaded.';
  }
}

async function saveIbkrIntegration({ runNow = false } = {}) {
  const errorEl = document.getElementById('ibkr-error');
  if (errorEl) errorEl.textContent = '';
  const toggle = document.getElementById('ibkr-enabled');
  const enabled = !!toggle?.checked;
  const payload = {
    enabled,
    mode: ibkrState.mode
  };
  if (runNow) payload.runNow = true;
  try {
    const data = await api('/api/integrations/ibkr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    ibkrState.enabled = !!data.enabled;
    ibkrState.accountId = data.accountId || ibkrState.accountId;
    ibkrState.connectionStatus = data.connectionStatus || ibkrState.connectionStatus;
    ibkrState.lastSyncAt = data.lastSyncAt || ibkrState.lastSyncAt;
    ibkrState.lastStatus = data.lastStatus || ibkrState.lastStatus;
    ibkrState.lastSessionCheckAt = data.lastSessionCheckAt || ibkrState.lastSessionCheckAt;
    ibkrState.lastHeartbeatAt = data.lastHeartbeatAt || ibkrState.lastHeartbeatAt;
    ibkrState.lastSnapshotAt = data.lastSnapshotAt || ibkrState.lastSnapshotAt;
    ibkrState.lastPortfolioValue = data.lastPortfolioValue ?? ibkrState.lastPortfolioValue;
    ibkrState.lastPortfolioCurrency = data.lastPortfolioCurrency || ibkrState.lastPortfolioCurrency;
    ibkrState.lastConnectorStatus = data.lastConnectorStatus || ibkrState.lastConnectorStatus;
    ibkrState.connectorOnline = !!data.connectorOnline;
    ibkrState.lastDisconnectReason = data.lastDisconnectReason || ibkrState.lastDisconnectReason;
    ibkrState.connectorConfigured = !!data.connectorConfigured;
    updateIbkrToggleState(ibkrState);
    setIbkrFieldsDisabled(!ibkrState.enabled || profileState.isGuest);
    renderIbkrSummary(ibkrState);
    renderIbkrStatus(ibkrState);
  } catch (e) {
    console.error('Unable to save IBKR settings', e);
    if (errorEl) errorEl.textContent = e?.data?.error || e.message || 'Unable to save IBKR settings.';
  }
}

async function refreshIbkrStatus() {
  const errorEl = document.getElementById('ibkr-error');
  if (errorEl) errorEl.textContent = '';
  try {
    await loadIbkrIntegration();
  } catch (e) {
    console.error('Unable to refresh IBKR status', e);
    if (errorEl) errorEl.textContent = e?.data?.error || e.message || 'Unable to refresh IBKR status.';
  }
}

async function generateIbkrConnectorToken() {
  const errorEl = document.getElementById('ibkr-error');
  if (errorEl) errorEl.textContent = '';
  try {
    const data = await api('/api/integrations/ibkr/connector/token', { method: 'POST' });
    const tokenInput = document.getElementById('ibkr-connector-token');
    if (tokenInput) {
      tokenInput.value = data.connectorToken || '';
    }
    ibkrState.connectorConfigured = true;
    ibkrState.enabled = true;
    const toggle = document.getElementById('ibkr-enabled');
    if (toggle) toggle.checked = true;
    const copyBtn = document.getElementById('ibkr-copy-token');
    if (copyBtn && tokenInput?.value) {
      copyBtn.disabled = false;
    }
    const warning = document.getElementById('ibkr-token-warning');
    if (warning) {
      const expiryText = data.expiresAt ? ` Valid until ${new Date(data.expiresAt).toLocaleTimeString('en-GB')}.` : '';
      warning.textContent = `This token will not be shown again and is exchanged for a connector key stored locally.${expiryText}`;
    }
    renderIbkrStatus(ibkrState);
  } catch (e) {
    console.error('Unable to generate IBKR connector token', e);
    if (errorEl) errorEl.textContent = e?.data?.error || e.message || 'Unable to generate connector token.';
  }
}

async function copyIbkrConnectorToken() {
  const tokenInput = document.getElementById('ibkr-connector-token');
  const warning = document.getElementById('ibkr-token-warning');
  const copyBtn = document.getElementById('ibkr-copy-token');
  if (!tokenInput || !tokenInput.value) return;
  try {
    await navigator.clipboard.writeText(tokenInput.value);
    if (warning) warning.textContent = 'Token copied to clipboard.';
    if (copyBtn) copyBtn.disabled = true;
  } catch (e) {
    if (warning) warning.textContent = 'Unable to copy token automatically. Please copy manually.';
  }
}

async function revokeIbkrConnectorKey() {
  const errorEl = document.getElementById('ibkr-error');
  if (errorEl) errorEl.textContent = '';
  try {
    await api('/api/integrations/ibkr/connector/revoke', { method: 'POST' });
    ibkrState.connectorConfigured = false;
    ibkrState.connectionStatus = 'disconnected';
    ibkrState.lastConnectorStatus = { status: 'disconnected', reason: 'Connector key revoked.' };
    renderIbkrStatus(ibkrState);
    renderIbkrSummary(ibkrState);
  } catch (e) {
    console.error('Unable to revoke IBKR connector key', e);
    if (errorEl) errorEl.textContent = e?.data?.error || e.message || 'Unable to revoke connector key.';
  }
}

function downloadIbkrInstaller() {
  const errorEl = document.getElementById('ibkr-error');
  if (errorEl) errorEl.textContent = '';
  fetch('/api/integrations/ibkr/installer/download', { credentials: 'include' })
    .then(async (res) => {
      if (res.status === 302 || res.redirected) {
        window.location.href = res.url;
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const details = data?.details?.instructions ? ` ${data.details.instructions}` : '';
        throw new Error(`${data?.error || 'Installer download failed.'}${details}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'VeracityInstaller.exe';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    })
    .catch((err) => {
      if (errorEl) {
        errorEl.textContent = `${err.message} Contact support or try again later.`;
      }
    });
}

async function copyIbkrInstallerSha() {
  const shaEl = document.getElementById('ibkr-installer-sha');
  if (!shaEl || !shaEl.textContent || shaEl.textContent === '—') return;
  try {
    await navigator.clipboard.writeText(shaEl.textContent.trim());
    shaEl.textContent = `${shaEl.textContent.trim()} (copied)`;
  } catch (e) {
    console.warn('Unable to copy SHA256', e);
  }
}

async function saveIntegration({ runNow = false } = {}) {
  const errorEl = document.getElementById('t212-error');
  if (errorEl) errorEl.textContent = '';
  const toggle = document.getElementById('t212-enabled');
  const modeSelect = document.getElementById('t212-mode');
  const enabled = !!toggle?.checked;
  const payload = {
    enabled,
    mode: modeSelect?.value || integrationState.mode,
    accounts: collectTrading212Accounts()
  };
  if (runNow) payload.runNow = true;
  try {
    const data = await api('/api/integrations/trading212', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    integrationState.hasApiKey = !!data.hasApiKey;
    integrationState.hasApiSecret = !!data.hasApiSecret;
    integrationState.enabled = !!data.enabled;
    integrationState.snapshotTime = data.snapshotTime || integrationState.snapshotTime;
    integrationState.mode = data.mode || integrationState.mode;
    integrationState.timezone = data.timezone || integrationState.timezone;
    integrationState.baseUrl = data.baseUrl || '';
    integrationState.endpoint = data.endpoint || '/api/v0/equity/account/summary';
    integrationState.accounts = Array.isArray(data.accounts) ? data.accounts : integrationState.accounts;
    integrationState.lastBaseUrl = data.lastBaseUrl || null;
    integrationState.lastEndpoint = data.lastEndpoint || null;
    integrationState.cooldownUntil = data.cooldownUntil || null;
    integrationState.lastRaw = data.lastRaw || null;
    if (toggle) toggle.checked = integrationState.enabled;
    renderTrading212Accounts();
    setIntegrationFieldsDisabled(!integrationState.enabled);
    renderIntegrationStatus({
      enabled: integrationState.enabled,
      lastSyncAt: data.lastSyncAt,
      lastStatus: data.lastStatus,
      timezone: integrationState.timezone,
      cooldownUntil: integrationState.cooldownUntil,
      lastBaseUrl: integrationState.lastBaseUrl,
      lastEndpoint: integrationState.lastEndpoint,
      lastRaw: integrationState.lastRaw
    });
    if (data.lastStatus && !data.lastStatus.ok && data.lastRaw) {
      const rawModal = document.getElementById('t212-raw-modal');
      const rawContent = document.getElementById('t212-raw-content');
      if (rawContent) rawContent.textContent = JSON.stringify(data.lastRaw, null, 2);
      rawModal?.classList.remove('hidden');
    }
    if (errorEl) {
      if (data.lastStatus && !data.lastStatus.ok && data.lastStatus.message) {
        const statusCode = data.lastStatus.status ? ` (HTTP ${data.lastStatus.status})` : '';
        errorEl.textContent = `Trading 212${statusCode}: ${data.lastStatus.message}`;
      } else {
        errorEl.textContent = '';
      }
    }
  } catch (e) {
    console.error(e);
    if (errorEl) errorEl.textContent = e?.data?.error || e.message || 'Unable to save Trading 212 settings.';
  }
}

async function saveProfile() {
  const errEl = document.getElementById('profile-error');
  if (errEl) errEl.textContent = '';
  const portfolioInput = document.getElementById('profile-portfolio');
  const netInput = document.getElementById('profile-net-deposits');
  const deltaInput = document.getElementById('profile-net-deposits-delta');
  const nicknameInput = document.getElementById('account-nickname');
  const nicknameError = document.getElementById('account-nickname-error');
  const portfolioRaw = portfolioInput?.value.trim() ?? '';
  const netRaw = netInput?.value.trim() ?? '';
  let portfolio = Number(portfolioRaw);
  const nicknameRaw = nicknameInput?.value.trim() ?? '';
  if (nicknameError) nicknameError.textContent = '';
  const multiEnabled = !!profileState.multiTradingAccountsEnabled;
  const accountPayload = multiEnabled
    ? profileState.tradingAccounts.map((account, index) => ({
      id: account.id,
      label: (account.label || '').trim() || (index === 0 ? 'Primary account' : `Account ${index + 1}`),
      currentValue: Number(account.currentValue) || 0,
      currentNetDeposits: Number(account.currentNetDeposits) || 0,
      integrationProvider: account.integrationProvider || null,
      integrationEnabled: !!account.integrationEnabled
    }))
    : null;
  if (multiEnabled && accountPayload?.length) {
    portfolio = accountPayload.reduce((sum, account) => sum + account.currentValue, 0);
  }
  if ((!multiEnabled && !portfolioRaw) || Number.isNaN(portfolio) || portfolio < 0) {
    if (errEl) errEl.textContent = 'Enter a non-negative portfolio value to continue.';
    return;
  }
  if (nicknameRaw.length > 20) {
    if (nicknameError) nicknameError.textContent = 'Nicknames must be 20 characters or less.';
    return;
  }
  if (nicknameRaw && !/^[A-Za-z0-9 ]+$/.test(nicknameRaw)) {
    if (nicknameError) nicknameError.textContent = 'Nicknames can only use letters, numbers, and spaces.';
    return;
  }
  let netDepositsTotal = Number(netRaw);
  if (multiEnabled && accountPayload?.length) {
    netDepositsTotal = accountPayload.reduce((sum, account) => sum + account.currentNetDeposits, 0);
  }
  if (!profileState.complete) {
    if (!netRaw || Number.isNaN(netDepositsTotal)) {
      if (errEl) errEl.textContent = 'Enter your cumulative net deposits (can be negative).';
      return;
    }
  } else {
    const deltaRaw = deltaInput?.value.trim() ?? '';
    if (netRaw && !Number.isNaN(netDepositsTotal) && netDepositsTotal !== profileState.netDeposits) {
      // use the edited total when resetting or overriding deposits
    } else if (deltaRaw) {
      const delta = Number(deltaRaw);
      if (Number.isNaN(delta)) {
        if (errEl) errEl.textContent = 'Additional deposits must be a number (use negative values for withdrawals).';
        return;
      }
      netDepositsTotal = profileState.netDeposits + delta;
    } else {
      netDepositsTotal = profileState.netDeposits;
    }
  }
  if (!Number.isFinite(netDepositsTotal)) {
    if (errEl) errEl.textContent = 'Net deposits value is invalid.';
    return;
  }
  try {
    await api('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portfolio,
        netDeposits: netDepositsTotal,
        tradingAccounts: accountPayload || undefined,
        nickname: nicknameInput ? nicknameRaw : undefined
      })
    });
    window.location.href = '/';
  } catch (e) {
    console.error(e);
    if (errEl) errEl.textContent = e?.data?.error || 'Unable to save profile details. Please try again.';
  }
}

async function resetProfile() {
  const errEl = document.getElementById('profile-reset-error');
  if (errEl) errEl.textContent = '';
  const confirmed = window.confirm('This will permanently delete all of your calendar data. Continue?');
  if (!confirmed) return;
  const button = document.getElementById('profile-reset');
  if (button) button.disabled = true;
  try {
    await api('/api/profile', { method: 'DELETE' });
    window.location.href = '/signup.html';
  } catch (e) {
    console.error(e);
    if (errEl) {
      errEl.textContent = e?.data?.error || 'Unable to remove your data. Please try again.';
    }
    if (button) button.disabled = false;
  }
}

async function logout() {
  try {
    await api('/api/logout', logoutRequestOptions());
  } catch (e) {
    console.warn(e);
  }
  sessionStorage.removeItem('guestMode');
  localStorage.removeItem('guestMode');
  window.location.href = '/login.html';
}



const investorPortalEnabled = () => profileState.investorPortalAvailable !== false;

const investorUiState = {
  investors: [],
  perfById: new Map(),
  valuations: [],
  cashflowsByInvestor: new Map(),
  selectedCashflowInvestorId: '',
  selectedSplitInvestorId: '',
  lastSelectedInvestorId: '',
  pendingDeleteCashflow: null,
  editingCashflow: null
};

let toastContainer;
let refreshInvestorActionAvailability = () => {};

function parseApiError(errorOrResponse) {
  const fallback = 'Something went wrong';
  if (!errorOrResponse) return fallback;
  if (typeof errorOrResponse === 'string') return errorOrResponse;
  if (typeof errorOrResponse?.data?.error === 'string' && errorOrResponse.data.error.trim()) return errorOrResponse.data.error.trim();
  if (typeof errorOrResponse?.data?.message === 'string' && errorOrResponse.data.message.trim()) return errorOrResponse.data.message.trim();
  if (typeof errorOrResponse?.error === 'string' && errorOrResponse.error.trim()) return errorOrResponse.error.trim();
  if (typeof errorOrResponse?.message === 'string' && errorOrResponse.message.trim()) return errorOrResponse.message.trim();
  return fallback;
}

function ensureToastContainer() {
  if (toastContainer) return toastContainer;
  toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);
  return toastContainer;
}

function showToast(type, message) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 200);
  }, 3800);
}

function setInlineError(id, message) {
  const el = document.getElementById(id);
  if (el) el.textContent = message || '';
}

function normalizeIsoDateString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year
    || utcDate.getUTCMonth() !== month - 1
    || utcDate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function setDisabled(ids, disabled) {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!disabled;
  });
}

function showInvestorFeedback(message, { isError = false } = {}) {
  const status = document.getElementById('investor-status');
  const error = document.getElementById('investor-error');
  if (isError) {
    if (error) error.textContent = message || '';
    if (status) status.textContent = '';
  } else {
    if (status) status.textContent = message || '';
    if (error) error.textContent = '';
  }
}

const toIsoDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
};

const formatGbp = (value) => formatCurrency(Number(value) || 0, 'GBP');
const formatPct = (value) => `${((Number(value) || 0) * 100).toFixed(2)}%`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function renderInvestorSummary() {
  const el = document.getElementById('investor-summary');
  if (!el) return;
  const totals = investorUiState.investors.reduce((acc, inv) => {
    const m = investorUiState.perfById.get(inv.id) || {};
    acc.capital += Number(m.net_contributions || 0);
    acc.value += Number(m.investor_net_value || 0);
    acc.profit += Number(m.investor_profit_share || 0);
    acc.master += Number(m.master_profit_share || 0);
    return acc;
  }, { capital: 0, value: 0, profit: 0, master: 0 });
  el.innerHTML = [
    ['Total Investor Capital', totals.capital],
    ['Total Investor Value', totals.value],
    ['Total Investor Profit', totals.profit],
    ['Your Earned Share', totals.master]
  ].map(([label, value]) => `<article class="investor-summary-card"><span>${label}</span><strong class="${Number(value) >= 0 ? 'pos' : 'neg'}">${formatGbp(value)}</strong></article>`).join('');
}

function renderValuationPanel() {
  const latest = investorUiState.valuations[0] || null;
  const latestNav = document.getElementById('investor-nav-latest');
  const latestDate = document.getElementById('investor-nav-last-date');
  const count = document.getElementById('investor-nav-count');
  if (latestNav) latestNav.textContent = formatGbp(latest?.nav || 0);
  if (latestDate) latestDate.textContent = latest?.valuationDate || '—';
  if (count) count.textContent = String(investorUiState.valuations.length);
  const history = document.getElementById('investor-valuation-history');
  if (history) {
    history.innerHTML = investorUiState.valuations.slice(0, 5).map((v) => `<div class="mini-row"><span>${v.valuationDate}</span><strong>${formatGbp(v.nav)}</strong></div>`).join('') || '<p class="helper">No valuations yet.</p>';
  }
}

function renderCashflowLedger() {
  const investorId = document.getElementById('investor-cashflow-id')?.value || '';
  if (investorId) investorUiState.lastSelectedInvestorId = investorId;
  const rows = investorUiState.cashflowsByInvestor.get(investorId) || [];
  const ledger = document.getElementById('investor-cashflow-ledger');
  if (!ledger) return;
  ledger.innerHTML = rows.slice(0, 8).map((row) => `
    <div class="mini-row ledger-row">
      <span>${row.effectiveDate} · ${escapeHtml(row.type)}</span>
      <strong>${formatGbp(row.amount)}</strong>
      <span class="muted">${escapeHtml(row.reference || '—')}</span>
      <div class="ledger-actions">
        <button class="ghost small investor-edit-cf" data-id="${row.id}" title="Edit cashflow" aria-label="Edit cashflow">✏️</button>
        <button class="ghost small investor-delete-cf" data-id="${row.id}" title="Delete cashflow" aria-label="Delete cashflow">🗑️</button>
      </div>
    </div>
  `).join('') || '<p class="helper">No cashflows for selected investor.</p>';
  ledger.querySelectorAll('.investor-delete-cf').forEach((btn) => btn.addEventListener('click', () => {
    const cashflowId = btn.getAttribute('data-id') || '';
    investorUiState.pendingDeleteCashflow = { investorId, cashflowId };
    document.getElementById('investor-delete-modal')?.classList.remove('hidden');
  }));
  ledger.querySelectorAll('.investor-edit-cf').forEach((btn) => btn.addEventListener('click', () => {
    const cashflowId = btn.getAttribute('data-id') || '';
    const cashflow = rows.find((row) => row.id === cashflowId);
    if (!cashflow) return;
    investorUiState.editingCashflow = { investorId, cashflowId };
    const typeInput = document.getElementById('investor-cashflow-edit-type');
    const amountInput = document.getElementById('investor-cashflow-edit-amount');
    const dateInput = document.getElementById('investor-cashflow-edit-date');
    const referenceInput = document.getElementById('investor-cashflow-edit-reference');
    if (typeInput) typeInput.value = cashflow.type || 'deposit';
    if (amountInput) amountInput.value = String(Number(cashflow.amount) || '');
    if (dateInput) dateInput.value = normalizeIsoDateString(cashflow.effectiveDate) || '';
    if (referenceInput) referenceInput.value = cashflow.reference || '';
    const err = document.getElementById('investor-cashflow-edit-error');
    if (err) err.textContent = '';
    document.getElementById('investor-cashflow-edit-modal')?.classList.remove('hidden');
  }));
}

function renderInvestorsTable() {
  const listEl = document.getElementById('investor-list');
  if (!listEl) return;
  listEl.innerHTML = `<table class="investor-dense-table"><thead><tr><th>Investor Name</th><th>Status</th><th>Last Login</th><th class="num">Split</th><th class="num optional-col">Net Contrib (£)</th><th class="num">Value (£)</th><th class="num">Profit (£)</th><th class="num optional-col">Return (%)</th><th class="num muted optional-col">Units</th><th class="optional-col">Last Cashflow Date</th><th>Actions</th></tr></thead><tbody>${investorUiState.investors.map((inv) => {
    const m = investorUiState.perfById.get(inv.id) || {};
    const profit = Number(m.investor_profit_share || 0);
    const ret = Number(m.investor_return_pct || 0);
    const split = Number(inv.investor_share_bps || m.investor_share_bps || 0) / 100;
    const lastCf = (investorUiState.cashflowsByInvestor.get(inv.id) || [])[0]?.effectiveDate || '—';
    const lastLogin = inv.lastLoginAt ? toIsoDate(inv.lastLoginAt) : 'Never';
    return `<tr>
      <td>${escapeHtml(inv.displayName)}</td>
      <td><span class="status-badge ${inv.status === 'active' ? 'active' : 'suspended'}">${inv.status === 'active' ? 'Active' : 'Suspended'}</span></td>
      <td>${lastLogin}</td>
      <td class="num">Investor ${split.toFixed(0)}% / You ${(100 - split).toFixed(0)}%</td>
      <td class="num optional-col">${formatGbp(m.net_contributions || 0)}</td>
      <td class="num">${formatGbp(m.investor_net_value || 0)}</td>
      <td class="num ${profit >= 0 ? 'pos' : 'neg'}">${formatGbp(profit)}</td>
      <td class="num optional-col ${ret >= 0 ? 'pos' : 'neg'}">${formatPct(ret)}</td>
      <td class="num muted optional-col">${Number(m.total_units || 0).toFixed(4)}</td>
      <td class="optional-col">${lastCf}</td>
      <td class="table-actions"><button class="ghost small investor-preview" data-id="${inv.id}">Preview</button><button class="ghost small investor-invite" data-id="${inv.id}">Invite</button><button class="ghost small investor-edit" data-id="${inv.id}">Edit</button><button class="ghost small investor-suspend" data-id="${inv.id}" data-next="${inv.status === 'active' ? 'suspended' : 'active'}">${inv.status === 'active' ? 'Suspend' : 'Activate'}</button></td>
    </tr>`;
  }).join('')}</tbody></table>`;

  listEl.querySelectorAll('.investor-preview').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.getAttribute('data-id');
    try {
      const dataPreview = await api(`/api/master/investors/${id}/preview-token`);
      window.open(`/investor/preview?token=${encodeURIComponent(dataPreview.token)}`, '_blank', 'noopener');
      showToast('success', 'Investor portal preview opened');
    } catch (error) {
      setInlineError('investor-preview-error', parseApiError(error));
    }
  }));

  listEl.querySelectorAll('.investor-edit').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-id') || '';
    const splitSelect = document.getElementById('investor-split-id');
    if (splitSelect) splitSelect.value = id;
    document.getElementById('investor-split-percent')?.focus();
  }));

  listEl.querySelectorAll('.investor-invite').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.getAttribute('data-id');
    const inviteModal = document.getElementById('investor-invite-modal');
    const inviteLinkInput = document.getElementById('investor-invite-link');
    setInlineError('investor-preview-error', '');
    try {
      const data = await api(`/api/master/investors/${id}/invite`, { method: 'POST' });
      if (inviteLinkInput) inviteLinkInput.value = data.inviteUrl || '';
      inviteModal?.classList.remove('hidden');
      showToast('success', 'Invite link generated');
    } catch (error) {
      setInlineError('investor-preview-error', parseApiError(error));
    }
  }));

  listEl.querySelectorAll('.investor-suspend').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.getAttribute('data-id');
    const next = btn.getAttribute('data-next');
    try {
      await api(`/api/master/investors/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) });
      showToast('success', `Investor ${next === 'active' ? 'activated' : 'suspended'}`);
      await loadInvestors();
    } catch (error) {
      setInlineError('investor-preview-error', parseApiError(error));
    }
  }));
}

function applyInvestorOptions() {
  const options = ['<option value="">Select investor</option>', ...investorUiState.investors.map((inv) => `<option value="${inv.id}">${escapeHtml(inv.displayName)}</option>`)].join('');
  const splitSelect = document.getElementById('investor-split-id');
  const cashflowSelect = document.getElementById('investor-cashflow-id');
  if (splitSelect) splitSelect.innerHTML = options;
  if (cashflowSelect) cashflowSelect.innerHTML = options;
  if (splitSelect && investorUiState.selectedSplitInvestorId) splitSelect.value = investorUiState.selectedSplitInvestorId;
  if (cashflowSelect) cashflowSelect.value = investorUiState.lastSelectedInvestorId || investorUiState.selectedCashflowInvestorId || '';
}

async function loadInvestors() {
  const investorManagedContent = document.getElementById('investor-managed-content');
  if (investorManagedContent) investorManagedContent.classList.toggle('is-hidden', !(investorPortalEnabled() && profileState.investorAccountsEnabled));
  if (!(investorPortalEnabled() && profileState.investorAccountsEnabled)) return;
  const [data, perf, valuations] = await Promise.all([
    api('/api/master/investors'),
    api('/api/master/investors/performance').catch(() => ({ investors: [] })),
    api('/api/master/valuations').catch(() => ({ valuations: [] }))
  ]);
  investorUiState.investors = Array.isArray(data.investors) ? data.investors : [];
  investorUiState.perfById = new Map((perf.investors || []).map((item) => [item.investor_profile_id, item]));
  investorUiState.valuations = Array.isArray(valuations.valuations) ? valuations.valuations : [];
  const latestCashflows = await Promise.all(investorUiState.investors.map(async (inv) => {
    const rows = await api(`/api/master/investors/${inv.id}/cashflows?limit=8`).catch(() => ({ cashflows: [] }));
    return [inv.id, rows.cashflows || []];
  }));
  investorUiState.cashflowsByInvestor = new Map(latestCashflows);
  applyInvestorOptions();
  renderInvestorSummary();
  renderValuationPanel();
  renderInvestorsTable();
  renderCashflowLedger();
  showInvestorFeedback(investorUiState.investors.length ? `Loaded ${investorUiState.investors.length} investors.` : 'No investors yet.');
  refreshInvestorActionAvailability();
}

function bindInvestorAccountToggle() {
  document.getElementById('investor-accounts-save')?.addEventListener('click', async () => {
    const enabled = !!document.getElementById('investor-accounts-enabled')?.checked;
    const status = document.getElementById('investor-accounts-status');
    const err = document.getElementById('investor-accounts-error');
    if (status) status.textContent = '';
    if (err) err.textContent = '';
    try {
      const data = await api('/api/master/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ investor_portal_enabled: enabled })
      });
      profileState.investorAccountsEnabled = !!data.investor_portal_enabled;
      await loadInvestors();
      if (status) status.textContent = profileState.investorAccountsEnabled ? 'Investor accounts enabled.' : 'Investor accounts disabled.';
    } catch (error) {
      if (err) err.textContent = parseApiError(error);
    }
  });
}

function bindInvestorActions() {
  const createIds = ['investor-display-name', 'investor-email', 'investor-create-btn'];
  const valuationIds = ['investor-valuation-date', 'investor-valuation-nav', 'investor-valuation-btn'];
  const splitIds = ['investor-split-id', 'investor-split-slider', 'investor-split-percent', 'investor-split-btn'];
  const cashflowIds = ['investor-cashflow-id', 'investor-cashflow-type', 'investor-cashflow-amount', 'investor-cashflow-date', 'investor-cashflow-reference', 'investor-cashflow-btn'];
  const formErrors = {
    create: '',
    valuation: '',
    split: '',
    cashflow: ''
  };

  const applyFormError = (form) => {
    const errorMap = {
      create: 'investor-create-error',
      valuation: 'investor-valuation-error',
      split: 'investor-split-error',
      cashflow: 'investor-cashflow-error'
    };
    const targetId = errorMap[form];
    if (!targetId) return;
    setInlineError(targetId, formErrors[form] || '');
  };

  const setFormError = (form, message) => {
    formErrors[form] = message || '';
    applyFormError(form);
  };

  const clearFormError = (form) => {
    setFormError(form, '');
  };

  const validateCreateForm = () => {
    const displayName = document.getElementById('investor-display-name')?.value?.trim() || '';
    const email = document.getElementById('investor-email')?.value?.trim() || '';
    if (displayName.length < 2 || displayName.length > 50) return 'Display name must be between 2 and 50 characters.';
    if (!email) return 'Investor login email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
    return '';
  };
  const validateValuationForm = () => {
    const valuationDateInput = document.getElementById('investor-valuation-date');
    const valuationDate = valuationDateInput?.value || '';
    const normalizedDate = normalizeIsoDateString(valuationDate);
    const nav = Number(document.getElementById('investor-valuation-nav')?.value || 0);
    const future = normalizedDate && normalizedDate > new Date().toISOString().slice(0, 10);
    if (!normalizedDate) return 'Invalid date. Use YYYY-MM-DD.';
    if (valuationDateInput) valuationDateInput.value = normalizedDate;
    if (future) return 'Valuation date cannot be in the future.';
    if (!Number.isFinite(nav) || nav <= 0) return 'NAV must be a number greater than 0.';
    if (investorUiState.valuations.some((v) => v.valuationDate === normalizedDate)) return 'A valuation already exists for this date.';
    return '';
  };
  const validateSplitForm = () => {
    const investorId = document.getElementById('investor-split-id')?.value || '';
    const pct = Number(document.getElementById('investor-split-percent')?.value || NaN);
    if (!investorId) return 'Select an investor for profit split.';
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) return 'Investor share must be an integer from 0 to 100.';
    return '';
  };
  const validateCashflowForm = () => {
    const investorId = document.getElementById('investor-cashflow-id')?.value || '';
    const type = document.getElementById('investor-cashflow-type')?.value || '';
    const amountRaw = document.getElementById('investor-cashflow-amount')?.value || '';
    const amount = Number(amountRaw);
    const effectiveDateInput = document.getElementById('investor-cashflow-date');
    const effectiveDate = effectiveDateInput?.value || '';
    const normalizedDate = normalizeIsoDateString(effectiveDate);
    const reference = document.getElementById('investor-cashflow-reference')?.value || '';
    if (!investorId) return 'Select an investor for cashflow.';
    if (!['deposit', 'withdrawal', 'fee'].includes(type)) return 'Select a valid cashflow type.';
    if (Number.isNaN(amount) || amount <= 0) return 'Amount must be a number greater than 0.';
    if (!normalizedDate) return 'Invalid date. Use YYYY-MM-DD.';
    if (effectiveDateInput) effectiveDateInput.value = normalizedDate;
    if (reference.length > 80) return 'Reference must be 80 characters or fewer.';
    return '';
  };

  const updateSplitText = () => {
    const pct = Number(document.getElementById('investor-split-percent')?.value || 0);
    const splitText = document.getElementById('investor-split-text');
    if (splitText) splitText.textContent = `Investor receives ${pct}% of profits · You receive ${100 - pct}%`;
  };

  const syncInvestorActionAvailability = () => {
    const createError = validateCreateForm();
    const valuationError = validateValuationForm();
    const splitError = validateSplitForm();
    const cashflowError = validateCashflowForm();
    applyFormError('create');
    applyFormError('valuation');
    applyFormError('split');
    applyFormError('cashflow');
    const createBtn = document.getElementById('investor-create-btn');
    const valuationBtn = document.getElementById('investor-valuation-btn');
    const splitBtn = document.getElementById('investor-split-btn');
    const cashflowBtn = document.getElementById('investor-cashflow-btn');
    if (createBtn && createBtn.dataset.loading !== 'true') createBtn.disabled = !!createError;
    if (valuationBtn && valuationBtn.dataset.loading !== 'true') valuationBtn.disabled = !!valuationError;
    if (splitBtn && splitBtn.dataset.loading !== 'true') splitBtn.disabled = !!splitError;
    if (cashflowBtn && cashflowBtn.dataset.loading !== 'true') cashflowBtn.disabled = !!cashflowError;
    updateSplitText();
  };

  refreshInvestorActionAvailability = syncInvestorActionAvailability;

  [...createIds, ...valuationIds, ...splitIds, ...cashflowIds, 'investor-cashflow-search'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', syncInvestorActionAvailability);
    document.getElementById(id)?.addEventListener('change', syncInvestorActionAvailability);
  });

  createIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => clearFormError('create'));
    document.getElementById(id)?.addEventListener('change', () => clearFormError('create'));
  });
  valuationIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => clearFormError('valuation'));
    document.getElementById(id)?.addEventListener('change', () => clearFormError('valuation'));
  });
  splitIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => clearFormError('split'));
    document.getElementById(id)?.addEventListener('change', () => clearFormError('split'));
  });
  cashflowIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => clearFormError('cashflow'));
    document.getElementById(id)?.addEventListener('change', () => clearFormError('cashflow'));
  });

  ['investor-valuation-date', 'investor-cashflow-date'].forEach((id) => {
    document.getElementById(id)?.addEventListener('blur', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      const normalized = normalizeIsoDateString(input.value);
      if (normalized) input.value = normalized;
      syncInvestorActionAvailability();
    });
  });

  document.getElementById('investor-open-valuation-modal')?.addEventListener('click', () => document.getElementById('investor-valuation-modal')?.classList.remove('hidden'));
  document.getElementById('investor-valuation-close')?.addEventListener('click', () => document.getElementById('investor-valuation-modal')?.classList.add('hidden'));
  document.getElementById('investor-delete-close')?.addEventListener('click', () => {
    investorUiState.pendingDeleteCashflow = null;
    document.getElementById('investor-delete-modal')?.classList.add('hidden');
  });
  document.getElementById('investor-delete-cancel')?.addEventListener('click', () => {
    investorUiState.pendingDeleteCashflow = null;
    document.getElementById('investor-delete-modal')?.classList.add('hidden');
  });
  document.getElementById('investor-cashflow-edit-close')?.addEventListener('click', () => {
    investorUiState.editingCashflow = null;
    document.getElementById('investor-cashflow-edit-modal')?.classList.add('hidden');
  });
  document.getElementById('investor-cashflow-edit-cancel')?.addEventListener('click', () => {
    investorUiState.editingCashflow = null;
    document.getElementById('investor-cashflow-edit-modal')?.classList.add('hidden');
  });
  document.getElementById('investor-invite-close')?.addEventListener('click', () => document.getElementById('investor-invite-modal')?.classList.add('hidden'));
  document.getElementById('investor-invite-copy')?.addEventListener('click', async () => {
    const inviteLinkInput = document.getElementById('investor-invite-link');
    const inviteLink = inviteLinkInput?.value || '';
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      showToast('success', 'Invite link copied');
    } catch (error) {
      showToast('error', 'Unable to copy invite link');
    }
  });


  document.getElementById('investor-delete-confirm')?.addEventListener('click', async () => {
    const pending = investorUiState.pendingDeleteCashflow;
    if (!pending?.investorId || !pending?.cashflowId) return;
    const btn = document.getElementById('investor-delete-confirm');
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; }
    try {
      await api(`/api/master/investors/${pending.investorId}/cashflows/${pending.cashflowId}`, { method: 'DELETE' });
      investorUiState.lastSelectedInvestorId = pending.investorId;
      showToast('success', 'Cashflow deleted');
      investorUiState.pendingDeleteCashflow = null;
      document.getElementById('investor-delete-modal')?.classList.add('hidden');
      await loadInvestors();
    } catch (error) {
      showToast('error', parseApiError(error));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Delete cashflow'; }
    }
  });

  document.getElementById('investor-cashflow-edit-save')?.addEventListener('click', async () => {
    const editing = investorUiState.editingCashflow;
    if (!editing?.investorId || !editing?.cashflowId) return;
    const type = document.getElementById('investor-cashflow-edit-type')?.value || '';
    const amount = Number(document.getElementById('investor-cashflow-edit-amount')?.value || 0);
    const effectiveDateInput = document.getElementById('investor-cashflow-edit-date');
    const effectiveDate = normalizeIsoDateString(effectiveDateInput?.value || '') || '';
    const reference = document.getElementById('investor-cashflow-edit-reference')?.value || '';
    const err = document.getElementById('investor-cashflow-edit-error');

    if (!['deposit', 'withdrawal', 'fee'].includes(type)) {
      if (err) err.textContent = 'Select a valid cashflow type.';
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      if (err) err.textContent = 'Cashflow amount must be greater than 0.';
      return;
    }
    if (!effectiveDate) {
      if (err) err.textContent = 'Enter an effective date.';
      return;
    }
    if (effectiveDateInput) effectiveDateInput.value = effectiveDate;
    if (err) err.textContent = '';

    const btn = document.getElementById('investor-cashflow-edit-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    try {
      await api(`/api/master/investors/${editing.investorId}/cashflows/${editing.cashflowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, amount, effective_date: effectiveDate, reference })
      });
      investorUiState.lastSelectedInvestorId = editing.investorId;
      investorUiState.editingCashflow = null;
      showToast('success', 'Cashflow updated');
      document.getElementById('investor-cashflow-edit-modal')?.classList.add('hidden');
      await loadInvestors();
    } catch (error) {
      if (err) err.textContent = parseApiError(error);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
    }
  });

  document.getElementById('investor-cashflow-id')?.addEventListener('change', renderCashflowLedger);
  document.getElementById('investor-cashflow-search')?.addEventListener('input', (e) => {
    const term = String(e.target?.value || '').toLowerCase();
    const select = document.getElementById('investor-cashflow-id');
    if (!select) return;
    const match = investorUiState.investors.find((inv) => inv.displayName.toLowerCase().includes(term));
    if (match) {
      select.value = match.id;
      renderCashflowLedger();
    }
  });

  const slider = document.getElementById('investor-split-slider');
  const pctInput = document.getElementById('investor-split-percent');
  slider?.addEventListener('input', () => { if (pctInput) pctInput.value = slider.value; updateSplitText(); });
  pctInput?.addEventListener('input', () => { if (slider) slider.value = String(Math.max(0, Math.min(100, Number(pctInput.value || 0)))); updateSplitText(); });
  document.getElementById('investor-split-id')?.addEventListener('change', () => {
    const investorId = document.getElementById('investor-split-id')?.value || '';
    investorUiState.selectedSplitInvestorId = investorId;
    const investor = investorUiState.investors.find((inv) => inv.id === investorId);
    const pct = Math.round(Number((investor?.investor_share_bps ?? 8000)) / 100);
    if (slider) slider.value = String(pct);
    if (pctInput) pctInput.value = String(pct);
    updateSplitText();
  });

  document.getElementById('investor-create-btn')?.addEventListener('click', async () => {
    const validationError = validateCreateForm();
    if (validationError) {
      setFormError('create', validationError);
      return;
    }
    const displayName = document.getElementById('investor-display-name')?.value?.trim();
    const email = document.getElementById('investor-email')?.value?.trim() || '';
    const btn = document.getElementById('investor-create-btn');
    if (btn) { btn.dataset.loading = 'true'; btn.textContent = 'Creating...'; }
    setDisabled(createIds, true);
    try {
      await api('/api/master/investors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: displayName, email }) });
      showToast('success', 'Investor created');
      clearFormError('create');
      document.getElementById('investor-display-name').value = '';
      document.getElementById('investor-email').value = '';
      await loadInvestors();
    } catch (error) {
      setFormError('create', parseApiError(error));
    } finally {
      if (btn) { btn.dataset.loading = 'false'; btn.textContent = 'Create investor'; }
      setDisabled(createIds, false);
      syncInvestorActionAvailability();
    }
  });

  document.getElementById('investor-valuation-btn')?.addEventListener('click', async () => {
    const validationError = validateValuationForm();
    if (validationError) {
      setFormError('valuation', validationError);
      return;
    }
    const valuationDateInput = document.getElementById('investor-valuation-date');
    const valuationDate = normalizeIsoDateString(valuationDateInput?.value || '') || '';
    const nav = Number(document.getElementById('investor-valuation-nav')?.value || 0);
    if (valuationDateInput && valuationDate) valuationDateInput.value = valuationDate;
    const btn = document.getElementById('investor-valuation-btn');
    if (btn) { btn.dataset.loading = 'true'; btn.textContent = 'Saving...'; }
    setDisabled(valuationIds, true);
    try {
      await api('/api/master/valuations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valuation_date: valuationDate, nav }) });
      showToast('success', 'Master NAV recorded');
      clearFormError('valuation');
      document.getElementById('investor-valuation-nav').value = '';
      document.getElementById('investor-valuation-modal')?.classList.add('hidden');
      await loadInvestors();
    } catch (error) {
      setFormError('valuation', parseApiError(error));
    } finally {
      if (btn) { btn.dataset.loading = 'false'; btn.textContent = 'Save NAV'; }
      setDisabled(valuationIds, false);
      syncInvestorActionAvailability();
    }
  });

  document.getElementById('investor-cashflow-btn')?.addEventListener('click', async () => {
    const validationError = validateCashflowForm();
    if (validationError) {
      setFormError('cashflow', validationError);
      return;
    }
    const investorId = document.getElementById('investor-cashflow-id')?.value || '';
    const type = document.getElementById('investor-cashflow-type')?.value || '';
    const amountRaw = document.getElementById('investor-cashflow-amount')?.value || '';
    const amount = Number(amountRaw);
    const effectiveDateInput = document.getElementById('investor-cashflow-date');
    const effectiveDate = normalizeIsoDateString(effectiveDateInput?.value || '') || '';
    const reference = document.getElementById('investor-cashflow-reference')?.value || '';
    if (effectiveDateInput && effectiveDate) effectiveDateInput.value = effectiveDate;
    const btn = document.getElementById('investor-cashflow-btn');
    if (btn) { btn.dataset.loading = 'true'; btn.textContent = 'Saving...'; }
    setDisabled(cashflowIds, true);
    try {
      await api(`/api/master/investors/${investorId}/cashflows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, amount, effective_date: effectiveDate, reference }) });
      investorUiState.lastSelectedInvestorId = investorId;
      showToast('success', 'Cashflow added');
      clearFormError('cashflow');
      document.getElementById('investor-cashflow-amount').value = '';
      document.getElementById('investor-cashflow-reference').value = '';
      await loadInvestors();
    } catch (error) {
      const message = parseApiError(error);
      setFormError('cashflow', message);
      showToast('error', message);
    } finally {
      if (btn) { btn.dataset.loading = 'false'; btn.textContent = 'Add cashflow'; }
      setDisabled(cashflowIds, false);
      syncInvestorActionAvailability();
    }
  });

  document.getElementById('investor-split-btn')?.addEventListener('click', async () => {
    const validationError = validateSplitForm();
    if (validationError) {
      setFormError('split', validationError);
      return;
    }
    const investorId = document.getElementById('investor-split-id')?.value || '';
    const investorShareBps = Number(document.getElementById('investor-split-percent')?.value || 0) * 100;
    const btn = document.getElementById('investor-split-btn');
    if (btn) { btn.dataset.loading = 'true'; btn.textContent = 'Saving...'; }
    setDisabled(splitIds, true);
    try {
      await api(`/api/master/investors/${investorId}/profit-split`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ investor_share_bps: investorShareBps }) });
      showToast('success', 'Profit split saved');
      clearFormError('split');
      await loadInvestors();
    } catch (error) {
      setFormError('split', parseApiError(error));
    } finally {
      if (btn) { btn.dataset.loading = 'false'; btn.textContent = 'Save profit split'; }
      setDisabled(splitIds, false);
      syncInvestorActionAvailability();
    }
  });

  syncInvestorActionAvailability();
}

function getOrCreateNotificationDeviceId() {
  const key = 'veracity_notification_device_id';
  let value = localStorage.getItem(key);
  if (!value) {
    const randomId = window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2);
    value = `${Date.now().toString(36)}-${randomId}`;
    localStorage.setItem(key, value);
  }
  return value;
}

function getNotificationPlatform() {
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isIos && standalone) return 'ios-pwa';
  if (isIos) return 'ios-browser';
  if (isAndroid) return 'android-browser';
  return 'desktop-browser';
}

function isLikelyIosSafariNotPwa() {
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;
  return !!(isIos && isSafari && !standalone);
}

function detectBrowserName() {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'edge';
  if (/OPR\//.test(ua)) return 'opera';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
  return 'unknown';
}

async function loadFirebaseMessagingCompat() {
  if (notificationState.scriptLoadPromise) {
    await notificationState.scriptLoadPromise;
    return;
  }
  const injectScript = src => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed loading ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  notificationState.scriptLoadPromise = (async () => {
    await injectScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    await injectScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
    console.info('[Notifications] Firebase compat scripts loaded.');
  })();
  await notificationState.scriptLoadPromise;
}

function hasValidNotificationConfig(configPayload) {
  const cfg = configPayload?.config || {};
  const required = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId', 'vapidKey'];
  return required.every((key) => typeof cfg[key] === 'string' && cfg[key].trim().length > 0);
}

async function ensureFirebaseMessagingReady(configPayload) {
  if (notificationState.messaging) {
    return notificationState.messaging;
  }
  if (notificationState.firebaseInitPromise) {
    return notificationState.firebaseInitPromise;
  }
  notificationState.firebaseInitPromise = (async () => {
    await loadFirebaseMessagingCompat();
    if (!window.firebase) {
      throw new Error('Firebase SDK failed to load.');
    }
    const config = configPayload?.config || {};
    if (!hasValidNotificationConfig(configPayload)) {
      throw new Error('Notification config is incomplete.');
    }
    const app = (Array.isArray(window.firebase.apps) && window.firebase.apps.length)
      ? window.firebase.apps[0]
      : window.firebase.initializeApp(config);
    console.info('[Notifications] Firebase app initialized.', { initializedApps: window.firebase.apps?.length || 0, projectId: config.projectId || 'unknown' });
    notificationState.messaging = window.firebase.messaging(app);
    console.info('[Notifications] Firebase messaging initialized.');
    return notificationState.messaging;
  })().catch((error) => {
    notificationState.firebaseInitPromise = null;
    notificationState.messaging = null;
    throw error;
  });
  return notificationState.firebaseInitPromise;
}

function setNotificationMessage(status = '', error = '') {
  const statusEl = document.getElementById('notification-status');
  const errorEl = document.getElementById('notification-error');
  if (statusEl) statusEl.textContent = status;
  if (errorEl) errorEl.textContent = error;
}

function setNotificationDebugState(step = 'idle', error = '') {
  notificationState.lastStep = step;
  notificationState.lastError = error || '';
  const stepEl = document.getElementById('notification-debug-step');
  const errorEl = document.getElementById('notification-debug-error');
  if (stepEl) stepEl.textContent = step;
  if (errorEl) {
    errorEl.textContent = notificationState.lastError ? ` · Error: ${notificationState.lastError}` : '';
  }
  const extraEl = document.getElementById('notification-debug-delete');
  if (extraEl) {
    extraEl.textContent = `Delete result: ${notificationState.lastDeleteActionResult || 'none'} · Auto re-register detected: ${notificationState.autoReregisterDetected ? 'Yes' : 'No'} · Last register trigger: ${notificationState.lastRegisterTriggerSource || 'none'}`;
  }
}

function notificationDebug(step, details = {}) {
  console.info(`[Notifications] ${step}`, details);
  setNotificationDebugState(step, details?.error || '');
}

function tokenSuffix(token) {
  const raw = typeof token === 'string' ? token.trim() : '';
  return raw ? raw.slice(-8) : '';
}

function installRawPushSubscribeProbe() {
  if (notificationState.rawPushSubscribeProbeInstalled) return;
  if (!window.PushManager || !window.PushManager.prototype || typeof window.PushManager.prototype.subscribe !== 'function') return;
  const originalSubscribe = window.PushManager.prototype.subscribe;
  window.PushManager.prototype.subscribe = function patchedRawPushSubscribe(...args) {
    console.error('RAW PUSH SUBSCRIBE PATH HIT', {
      source: 'window.PushManager.prototype.subscribe',
      stack: new Error('RAW PUSH SUBSCRIBE PATH HIT').stack,
      args
    });
    return originalSubscribe.apply(this, args);
  };
  notificationState.rawPushSubscribeProbeInstalled = true;
  notificationDebug('Raw push subscribe probe installed');
}

function formatNotificationRuntimeError(error) {
  const fallback = 'Notification registration failed.';
  if (!error) return fallback;
  const message = error?.data?.error || error?.message || String(error) || fallback;
  const sourceLine = typeof error?.stack === 'string'
    ? (error.stack.split('\n').find((line) => line.includes('http') || line.includes('static/') || line.includes('serviceWorker.js')) || '')
    : '';
  const source = sourceLine ? sourceLine.trim() : 'no-stack-source';
  return `[runtime ${new Date().toISOString()}] ${message} (source: ${source})`;
}

function renderNotificationControls() {
  const support = document.getElementById('notification-support-message');
  const permission = Notification?.permission || 'default';
  notificationState.permission = permission;
  const deviceMeta = document.getElementById('notification-device-meta');
  const platform = getNotificationPlatform();
  if (deviceMeta) {
    deviceMeta.textContent = `Platform: ${platform} · Browser: ${detectBrowserName()} · Permission: ${permission} · Device ID: ${notificationState.deviceId || '—'}`;
  }
  if (support) {
    if (!notificationState.supported) {
      support.textContent = 'Push notifications are not supported in this browser/device context.';
    } else if (isLikelyIosSafariNotPwa()) {
      support.textContent = 'On iPhone/iPad, web push works only from the Home Screen-installed app.';
    } else {
      support.textContent = 'Notifications are available on this device.';
    }
  }
  document.getElementById('notification-ios-onboarding')?.classList.toggle('is-hidden', !isLikelyIosSafariNotPwa());
  const fields = ['criticalRiskAlerts', 'tradeAlerts', 'tradeGroupAlerts', 'socialInvestorNotifications', 'brokerSyncFailures', 'dailyRecap', 'soundEnabled'];
  fields.forEach((name) => {
    const el = document.getElementById(`notif-${name}`);
    if (el) el.checked = !!notificationState.categories[name];
  });
  const master = document.getElementById('notif-master-enabled');
  if (master) master.checked = !!notificationState.activeDeviceId;
}

function renderNotificationDevices(devices) {
  const container = document.getElementById('notification-devices-list');
  if (!container) return;
  notificationState.deviceList = Array.isArray(devices) ? devices : [];
  if (!Array.isArray(devices) || !devices.length) {
    container.innerHTML = '<p class="helper">No registered notification devices yet.</p>';
    return;
  }
  container.innerHTML = devices.map((device) => {
    const marker = device.deviceId === notificationState.deviceId ? ' (this device)' : '';
    return `<div class="notification-device-row"><strong>${device.platform}</strong> · ${device.browser}${marker}<br>Permission: ${device.permissionState} · Active: ${device.isActive ? 'Yes' : 'No'}<br>Last registration: ${device.lastRegistrationAt || '—'} · Last received: ${device.lastReceivedAt || '—'}<br><button class="ghost danger" type="button" data-notification-remove-device-id="${device.id}">Remove</button></div>`;
  }).join('');
  const mine = devices.find((device) => device.deviceId === notificationState.deviceId && device.isActive);
  notificationState.activeDeviceId = mine?.id || '';
  if (mine?.categories) {
    notificationState.categories = { ...notificationState.categories, ...mine.categories };
  }
}

async function unsubscribeCurrentPushSubscription() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/serviceWorker.js');
    const subscription = await registration?.pushManager?.getSubscription?.();
    if (subscription) {
      await subscription.unsubscribe();
      console.info('[Notifications][DeviceLifecycle][Client] Web push subscription deleted for current device.', {
        action: 'token_deleted',
        deviceId: notificationState.deviceId || null
      });
    }
    if (notificationState.messaging && typeof notificationState.messaging.deleteToken === 'function') {
      await notificationState.messaging.deleteToken();
      console.info('[Notifications][DeviceLifecycle][Client] Firebase token deleted for current device.', {
        action: 'token_deleted',
        deviceId: notificationState.deviceId || null
      });
    }
  } catch (error) {
    notificationDebug('Current-device unsubscribe attempt failed', { error: error?.message || String(error) });
  }
}

async function removeNotificationDevice(deviceRowId) {
  const target = (notificationState.deviceList || []).find((item) => item.id === deviceRowId);
  if (!target) {
    setNotificationMessage('', 'Device not found in current list.');
    return;
  }
  notificationDebug('Remove device button clicked', {
    deviceRowId,
    targetDeviceId: target.deviceId || null,
    isCurrentDevice: target.deviceId === notificationState.deviceId
  });
  const confirmed = window.confirm('Stop notifications on this device?');
  notificationDebug('Remove device confirmation prompt result', { deviceRowId, confirmed });
  if (!confirmed) return;
  try {
    notificationState.lastDeleteActionResult = 'delete request started';
    setNotificationDebugState('delete request started');
    notificationDebug('Remove device API request started', { endpoint: `/api/notifications/device/${encodeURIComponent(deviceRowId)}`, deviceRowId });
    const deleteResponse = await api(`/api/notifications/device/${encodeURIComponent(deviceRowId)}`, { method: 'DELETE' });
    notificationDebug('Remove device API response received', { deviceRowId, response: deleteResponse });
    if (target.deviceId === notificationState.deviceId) {
      localStorage.setItem(NOTIFICATION_REMOVED_CURRENT_DEVICE_KEY, 'true');
      notificationState.activeDeviceId = '';
      console.info('[Notifications][DeviceLifecycle][Client] Current device removed by user.', {
        action: 'current_device_removed',
        deviceId: notificationState.deviceId || null,
        deviceRowId
      });
      await unsubscribeCurrentPushSubscription();
    }
    notificationState.lastDeleteActionResult = `success (removed=${deleteResponse?.removed ? 'yes' : 'no'})`;
    setNotificationMessage('Device removed from notifications.', '');
    await loadNotificationDevices();
  } catch (error) {
    notificationState.lastDeleteActionResult = `failed (${error?.data?.error || error?.message || 'unknown error'})`;
    setNotificationMessage('', error?.data?.error || 'Unable to remove this device.');
    notificationDebug('Remove device API request failed', { deviceRowId, error: error?.data?.error || error?.message || String(error) });
  } finally {
    setNotificationDebugState('delete flow completed');
  }
}

async function loadNotificationDevices() {
  setNotificationDebugState('refresh devices request started');
  notificationDebug('Device list refresh started');
  const payload = await api('/api/notifications/devices');
  notificationDebug('Device list refresh payload', { devices: payload.devices || [] });
  renderNotificationDevices(payload.devices || []);
  renderNotificationControls();
  setNotificationDebugState('refresh devices request completed');
  notificationDebug('Device list refresh completed', { count: Array.isArray(payload.devices) ? payload.devices.length : 0 });
}

async function registerNotificationToken({ force = false, triggerSource = 'unknown' } = {}) {
  notificationState.lastRegisterTriggerSource = triggerSource;
  notificationDebug('Registration requested', { force, triggerSource });
  if (localStorage.getItem(NOTIFICATION_REMOVED_CURRENT_DEVICE_KEY) === 'true' && triggerSource.startsWith('auto-')) {
    notificationState.autoReregisterDetected = true;
    notificationDebug('Auto re-register attempt blocked because current device was removed', { force, triggerSource });
    setNotificationDebugState('auto re-register blocked');
    return;
  }
  if (notificationState.registerInFlight) {
    notificationDebug('Registration skipped: already in flight');
    return;
  }
  notificationDebug('Registration started', { force });
  notificationState.registerInFlight = true;
  const registrationTimeoutMs = 10000;
  const registrationTimeoutId = setTimeout(() => {
    if (!notificationState.registerInFlight) return;
    notificationDebug('Registration timeout reached; auto-resetting in-flight flag', { timeoutMs: registrationTimeoutMs });
    notificationState.registerInFlight = false;
    notificationDebug('Registration flag reset', { reason: 'timeout' });
  }, registrationTimeoutMs);
  try {
    if (!notificationState.supported) {
      setNotificationMessage('', 'Notifications are not supported in this browser.');
      return;
    }
    if (Notification.permission === 'denied') {
      setNotificationMessage('', 'Browser permission is denied. Re-enable notifications in browser settings first.');
      return;
    }
    notificationDebug('current Notification.permission', { permission: Notification.permission });
    setNotificationDebugState('config fetch started');
    const configPayload = notificationState.config || await api('/api/notifications/config');
    notificationState.config = configPayload;
    setNotificationDebugState('config fetched successfully');
    notificationDebug('Config loaded', {
      supported: !!configPayload?.supported,
      missingKeys: Array.isArray(configPayload?.missingKeys) ? configPayload.missingKeys : []
    });
    if (!configPayload?.supported || !hasValidNotificationConfig(configPayload)) {
      setNotificationMessage('', 'Server-side notification configuration is incomplete.');
      setNotificationDebugState('config invalid', 'Server-side notification configuration is incomplete.');
      return;
    }
    setNotificationDebugState('service worker registration started');
    notificationDebug('Service worker registration found/created: started');
    const serviceWorkerRegistration = await navigator.serviceWorker.register('/serviceWorker.js?v=20260318-raw-subscribe-probe', {
      updateViaCache: 'none'
    });
    if (!serviceWorkerRegistration) {
      throw new Error('Service worker registration failed.');
    }
    await serviceWorkerRegistration.update();
    setNotificationDebugState('service worker registration found/created');
    notificationDebug('Service worker registration completed', { scope: serviceWorkerRegistration.scope });
    const swReady = await navigator.serviceWorker.ready;
    if (!swReady) {
      throw new Error('Service worker ready state unavailable.');
    }
    notificationDebug('Service worker ready', { scope: swReady?.scope || serviceWorkerRegistration.scope });
    installRawPushSubscribeProbe();
    const vapidKeyString = (configPayload?.config?.vapidKey || '').trim();
    setNotificationDebugState('Firebase app initialization started');
    const messaging = await ensureFirebaseMessagingReady(configPayload);
    setNotificationDebugState('Firebase app initialized');
    notificationDebug('Firebase app initialized');
    notificationDebug('messaging initialized', { hasMessaging: !!messaging });
    if (force && typeof messaging.deleteToken === 'function') {
      try {
        notificationDebug('Force re-register requested: deleting existing token before getToken');
        await messaging.deleteToken();
      } catch (deleteError) {
        notificationDebug('Token delete failed before re-register; continuing', { error: deleteError?.message || String(deleteError) });
      }
    }
    setNotificationDebugState('getToken started');
    notificationDebug('getToken started', { permission: Notification.permission, force });
    console.info('FCM GETTOKEN PATH HIT', {
      force,
      permission: Notification.permission,
      serviceWorkerScope: swReady?.scope || serviceWorkerRegistration.scope
    });
    notificationDebug('Using Firebase getToken registration path', {
      vapidKeyLength: vapidKeyString.length,
      serviceWorkerScope: swReady?.scope || serviceWorkerRegistration.scope
    });
    let token = '';
    try {
      token = await messaging.getToken({
        vapidKey: vapidKeyString,
        serviceWorkerRegistration: swReady
      });
    } catch (tokenError) {
      const sourceStack = tokenError?.stack || String(tokenError);
      notificationDebug('Firebase getToken call failed', {
        error: tokenError?.message || String(tokenError),
        stack: sourceStack
      });
      throw tokenError;
    }
    if (!token) {
      setNotificationDebugState('getToken returned empty', 'Unable to fetch a push token.');
      notificationDebug('getToken returned empty', { tokenLength: token?.length || 0 });
    } else {
      setNotificationDebugState('getToken succeeded');
      notificationDebug('getToken succeeded', { tokenLength: token?.length || 0 });
      console.info('[Notifications][DeviceLifecycle][Client] Token acquired from Firebase getToken.', {
        action: force ? 'token_refreshed' : 'token_created',
        deviceId: notificationState.deviceId || null,
        tokenSuffix: tokenSuffix(token)
      });
    }
    if (!token) {
      setNotificationMessage('', 'Unable to fetch a push token. Try again.');
      return;
    }
    const payload = {
      deviceId: notificationState.deviceId,
      token,
      platform: getNotificationPlatform(),
      browser: detectBrowserName(),
      userAgent: navigator.userAgent,
      permissionState: Notification.permission,
      installedAsPwa: !!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone),
      preferences: notificationState.categories,
      categories: notificationState.categories,
      isActive: true
    };
    setNotificationDebugState('register-device API request started');
    notificationDebug('Register API request started', { endpoint: '/api/notifications/devices/register', deviceId: payload.deviceId, permissionState: payload.permissionState });
    const registerResponse = await fetch('/api/notifications/devices/register', {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let registerBody = {};
    try {
      registerBody = await registerResponse.json();
    } catch (e) {
      registerBody = { error: 'Unable to parse register-device JSON response.' };
    }
    notificationDebug('register-device API response status/body', {
      status: registerResponse.status,
      ok: registerResponse.ok,
      body: registerBody
    });
    if (!registerResponse.ok) {
      const registerError = registerBody?.error || 'Device registration failed.';
      setNotificationDebugState('register-device API failed', registerError);
      throw Object.assign(new Error(registerError), { data: registerBody });
    }
    setNotificationDebugState('register-device API response received');
    console.info('[Notifications][DeviceLifecycle][Client] Device register API succeeded.', {
      action: force ? 'token_refreshed' : 'current_device_reenabled',
      deviceId: payload.deviceId || null,
      tokenSuffix: tokenSuffix(token),
      platform: payload.platform,
      browser: payload.browser
    });
    setNotificationMessage(force ? 'Notifications re-registered successfully.' : 'Notifications enabled on this device.', '');
    await loadNotificationDevices();
    notificationDebug('Registration completed', { force });
  } catch (error) {
    const runtimeError = formatNotificationRuntimeError(error);
    notificationDebug('Registration failed', { error: runtimeError });
    notificationDebug('Registration flow failed', { error: runtimeError, stack: error?.stack || null });
    setNotificationDebugState('registration flow failed', runtimeError);
    setNotificationMessage('', runtimeError);
  } finally {
    clearTimeout(registrationTimeoutId);
    notificationState.registerInFlight = false;
    notificationDebug('Registration flag reset', { reason: 'finally' });
  }
}

async function initNotificationSettings() {
  if (notificationState.initialized) return;
  notificationState.initialized = true;
  notificationState.deviceId = getOrCreateNotificationDeviceId();
  notificationState.supported = ('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window);
  renderNotificationControls();
  if (!notificationState.supported) return;
  try {
    notificationState.config = await api('/api/notifications/config');
    console.info('[Notifications] Config preload completed.', {
      supported: !!notificationState.config?.supported,
      missingKeys: Array.isArray(notificationState.config?.missingKeys) ? notificationState.config.missingKeys : []
    });
    await loadNotificationDevices();
  } catch (error) {
    setNotificationMessage('', 'Unable to load notification settings.');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  applySubsectionRouteMode();
  bindNav();
  loadProfile();
  loadIntegration();
  loadIbkrIntegration();
  loadIbkrDownloadMeta();
  if (profileRefreshTimer) clearInterval(profileRefreshTimer);
  profileRefreshTimer = setInterval(() => {
    if (Date.now() < suppressProfileAutoRefreshUntil || isAvatarInteractionLocked()) return;
    loadProfile();
  }, PROFILE_AUTO_REFRESH_MS);
  bindInvestorAccountToggle();
  bindInvestorActions();
  setTimeout(() => {
    initNotificationSettings();
  }, 0);
  window.addEventListener('focus', () => {
    if (Date.now() < suppressProfileAutoRefreshUntil || isAvatarInteractionLocked()) return;
    loadProfile();
  });
  const rawModal = document.getElementById('t212-raw-modal');
  const rawContent = document.getElementById('t212-raw-content');
  document.getElementById('t212-raw-btn')?.addEventListener('click', () => {
    if (rawContent) rawContent.textContent = integrationState.lastRaw
      ? JSON.stringify(integrationState.lastRaw, null, 2)
      : '';
    rawModal?.classList.remove('hidden');
  });
  document.getElementById('t212-raw-close')?.addEventListener('click', () => {
    rawModal?.classList.add('hidden');
  });
  const helpModal = document.getElementById('t212-help-modal');
  document.getElementById('t212-help-btn')?.addEventListener('click', () => {
    helpModal?.classList.remove('hidden');
  });
  document.getElementById('t212-help-close')?.addEventListener('click', () => {
    helpModal?.classList.add('hidden');
  });
  document.getElementById('t212-add-account')?.addEventListener('click', () => {
    const container = document.getElementById('t212-accounts');
    if (!container) return;
    const index = container.querySelectorAll('.t212-account-row').length;
    const row = buildTrading212AccountRow({
      id: `account-${Date.now()}`,
      label: '',
      hasApiKey: false,
      hasApiSecret: false
    }, index);
    container.appendChild(row);
  });
  document.getElementById('profile-save')?.addEventListener('click', saveProfile);
  document.getElementById('profile-logout')?.addEventListener('click', logout);
  document.getElementById('profile-net-deposits-delta')?.addEventListener('input', (ev) => {
    const netInput = document.getElementById('profile-net-deposits');
    if (!netInput) return;
    const raw = ev.target.value.trim();
    if (!raw) {
      netInput.value = Number.isFinite(profileState.netDeposits)
        ? profileState.netDeposits.toFixed(2)
        : '';
      return;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      netInput.value = Number.isFinite(profileState.netDeposits)
        ? profileState.netDeposits.toFixed(2)
        : '';
      return;
    }
    const updated = profileState.netDeposits + parsed;
    netInput.value = Number.isFinite(updated) ? updated.toFixed(2) : netInput.value;
  });
  document.getElementById('t212-enabled')?.addEventListener('change', (ev) => {
    const checked = ev.target.checked;
    setIntegrationFieldsDisabled(!checked);
  });
  document.getElementById('ibkr-enabled')?.addEventListener('change', (ev) => {
    const checked = ev.target.checked;
    setIbkrFieldsDisabled(!checked);
    saveIbkrIntegration();
  });
  document.getElementById('t212-save')?.addEventListener('click', () => saveIntegration());
  document.getElementById('t212-run-now')?.addEventListener('click', () => saveIntegration({ runNow: true }));
  document.getElementById('ibkr-generate-token')?.addEventListener('click', generateIbkrConnectorToken);
  document.getElementById('ibkr-sync')?.addEventListener('click', refreshIbkrStatus);
  document.getElementById('ibkr-copy-token')?.addEventListener('click', copyIbkrConnectorToken);
  document.getElementById('ibkr-revoke')?.addEventListener('click', revokeIbkrConnectorKey);
  document.getElementById('ibkr-download-installer')?.addEventListener('click', downloadIbkrInstaller);
  document.getElementById('ibkr-copy-sha')?.addEventListener('click', copyIbkrInstallerSha);
  document.getElementById('profile-reset')?.addEventListener('click', resetProfile);
  document.getElementById('account-password-submit')?.addEventListener('click', handlePasswordChange);
  document.getElementById('account-nickname-submit')?.addEventListener('click', handleNicknameUpdate);
  bindAvatarActions();
  document.getElementById('trading-account-add')?.addEventListener('click', () => {
    const id = `account-${Date.now()}`;
    profileState.tradingAccounts.push({
      id,
      label: `Account ${profileState.tradingAccounts.length + 1}`,
      currentValue: 0,
      currentNetDeposits: 0,
      integrationProvider: null,
      integrationEnabled: false
    });
    profileState.multiTradingAccountsEnabled = true;
    renderTradingAccounts();
  });
  document.getElementById('trading-accounts-enabled')?.addEventListener('change', event => {
    profileState.multiTradingAccountsEnabled = !!event.target?.checked;
    renderTradingAccounts();
  });
  document.getElementById('trading-accounts-list')?.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.dataset.accountAction !== 'integration-toggle') return;
    const accountId = target.dataset.accountId;
    const provider = target.dataset.provider;
    if (!accountId || !provider) return;
    handleTradingAccountIntegrationToggle(accountId, provider);
  });
  document.getElementById('trading-accounts-list')?.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const accountId = input.dataset.accountId;
    const field = input.dataset.accountField;
    if (!accountId || !field) return;
    const account = profileState.tradingAccounts.find(item => item.id === accountId);
    if (!account) return;
    if (field === 'label') {
      account.label = input.value;
    } else if (field === 'currentValue') {
      const value = Number(input.value);
      account.currentValue = Number.isFinite(value) && value >= 0 ? value : 0;
    } else if (field === 'currentNetDeposits') {
      const value = Number(input.value);
      account.currentNetDeposits = Number.isFinite(value) ? value : 0;
    }
    if (profileState.multiTradingAccountsEnabled) {
      const combinedPortfolio = profileState.tradingAccounts.reduce((sum, item) => sum + (Number(item.currentValue) || 0), 0);
      const combinedNet = profileState.tradingAccounts.reduce((sum, item) => sum + (Number(item.currentNetDeposits) || 0), 0);
      const portfolioInput = document.getElementById('profile-portfolio');
      const netInput = document.getElementById('profile-net-deposits');
      if (portfolioInput) portfolioInput.value = combinedPortfolio.toFixed(2);
      if (netInput) netInput.value = combinedNet.toFixed(2);
    }
  });
  document.getElementById('trading-accounts-save')?.addEventListener('click', async () => {
    const status = document.getElementById('trading-accounts-status');
    const error = document.getElementById('trading-accounts-error');
    if (status) {
      status.textContent = '';
      status.classList.add('is-hidden');
    }
    if (error) error.textContent = '';
    const accounts = profileState.tradingAccounts.map((account, index) => ({
      id: account.id,
      label: (account.label || '').trim() || (index === 0 ? 'Primary account' : `Account ${index + 1}`),
      currentValue: Number(account.currentValue) || 0,
      currentNetDeposits: Number(account.currentNetDeposits) || 0,
      integrationProvider: account.integrationProvider || null,
      integrationEnabled: !!account.integrationEnabled
    }));
    try {
      const payload = await api('/api/account/trading-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: !!profileState.multiTradingAccountsEnabled,
          accounts
        })
      });
      profileState.multiTradingAccountsEnabled = !!payload.enabled;
      profileState.tradingAccounts = Array.isArray(payload.accounts) && payload.accounts.length
        ? payload.accounts.map(account => ({
          id: account.id,
          label: account.label || '',
          currentValue: Number(account.currentValue) || 0,
          currentNetDeposits: Number(account.currentNetDeposits) || 0,
          integrationProvider: account.integrationProvider || null,
          integrationEnabled: !!account.integrationEnabled
        }))
        : [{ id: 'primary', label: 'Primary account', currentValue: 0, currentNetDeposits: 0, integrationProvider: null, integrationEnabled: false }];
      await loadProfile();
      if (status) {
        status.textContent = 'Trading accounts saved and combined totals updated.';
        status.classList.remove('is-hidden');
      }
    } catch (e) {
      if (error) error.textContent = e?.data?.error || 'Unable to save trading accounts right now.';
    }
  });
  document.getElementById('notification-enable-btn')?.addEventListener('click', async () => {
    setNotificationDebugState('Enable notifications click handler entered');
    notificationDebug('Enable button clicked');
    try {
      notificationDebug('current Notification.permission', { permission: Notification.permission });
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        notificationDebug('Permission state after prompt', { permission });
        if (permission !== 'granted') {
          setNotificationMessage('', 'Notification permission was not granted.');
          renderNotificationControls();
          return;
        }
      } else {
        notificationDebug('Permission prompt skipped', { permission: Notification.permission });
      }
      localStorage.removeItem(NOTIFICATION_REMOVED_CURRENT_DEVICE_KEY);
      await registerNotificationToken({ triggerSource: 'user-enable' });
    } catch (error) {
      notificationDebug('Enable button handler failed', { error: error?.message || String(error) });
      setNotificationMessage('', error?.message || 'Unable to enable notifications.');
    }
  });
  document.getElementById('notification-reregister-btn')?.addEventListener('click', async () => {
    setNotificationDebugState('Re-register token click handler entered');
    notificationDebug('Re-register button clicked');
    try {
      localStorage.removeItem(NOTIFICATION_REMOVED_CURRENT_DEVICE_KEY);
      await registerNotificationToken({ force: true, triggerSource: 'user-reregister' });
    } catch (error) {
      notificationDebug('Re-register button handler failed', { error: error?.message || String(error) });
      setNotificationMessage('', error?.message || 'Unable to re-register token.');
    }
  });
  document.getElementById('notification-disable-btn')?.addEventListener('click', async () => {
    if (!notificationState.activeDeviceId) return;
    try {
      await api(`/api/notifications/devices/${encodeURIComponent(notificationState.activeDeviceId)}/disable`, { method: 'POST' });
      setNotificationMessage('Notifications disabled on this device.', '');
      await loadNotificationDevices();
    } catch (error) {
      setNotificationMessage('', 'Unable to disable this device.');
    }
  });
  document.getElementById('notification-devices-list')?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const deviceRowId = target.dataset.notificationRemoveDeviceId;
    if (!deviceRowId) return;
    await removeNotificationDevice(deviceRowId);
  });
  document.getElementById('notification-save-prefs-btn')?.addEventListener('click', async () => {
    setNotificationDebugState('Save preferences click handler entered');
    if (!notificationState.activeDeviceId) {
      setNotificationMessage('', 'Enable notifications first for this device.');
      return;
    }
    const categories = {
      criticalRiskAlerts: !!document.getElementById('notif-criticalRiskAlerts')?.checked,
      tradeAlerts: !!document.getElementById('notif-tradeAlerts')?.checked,
      tradeGroupAlerts: !!document.getElementById('notif-tradeGroupAlerts')?.checked,
      socialInvestorNotifications: !!document.getElementById('notif-socialInvestorNotifications')?.checked,
      brokerSyncFailures: !!document.getElementById('notif-brokerSyncFailures')?.checked,
      dailyRecap: !!document.getElementById('notif-dailyRecap')?.checked,
      soundEnabled: !!document.getElementById('notif-soundEnabled')?.checked
    };
    notificationState.categories = categories;
    const isActive = !!document.getElementById('notif-master-enabled')?.checked;
    try {
      notificationDebug('Save preferences API request started', { deviceId: notificationState.activeDeviceId });
      await api(`/api/notifications/devices/${encodeURIComponent(notificationState.activeDeviceId)}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories,
          isActive,
          permissionState: Notification.permission
        })
      });
      notificationDebug('Save preferences API request completed', { ok: true });
      setNotificationMessage('Notification preferences saved.', '');
      await loadNotificationDevices();
    } catch (error) {
      notificationDebug('Save preferences failed', { error: error?.data?.error || error?.message || String(error) });
      setNotificationMessage('', error?.data?.error || 'Unable to save notification preferences.');
    }
  });
  document.getElementById('notification-test-btn')?.addEventListener('click', async () => {
    setNotificationDebugState('Send test notification click handler entered');
    notificationDebug('Test notification button clicked', { deviceId: notificationState.activeDeviceId || null });
    try {
      notificationDebug('Send test API request started', { endpoint: '/api/notifications/test' });
      await api('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: notificationState.activeDeviceId || undefined })
      });
      notificationDebug('Send test API request completed', { ok: true });
      setNotificationMessage('Push test sent to registered device(s). Check your OS notification tray.', '');
    } catch (error) {
      notificationDebug('Send test notification failed', { error: error?.data?.error || error?.message || String(error) });
      setNotificationMessage('', error?.data?.error || 'Test notification failed.');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      helpModal?.classList.add('hidden');
      rawModal?.classList.add('hidden');
    }
  });
});
