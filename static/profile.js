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

const profileState = {
  complete: false,
  netDeposits: 0,
  netDepositsBaseline: 0,
  username: '',
  nickname: '',
  isGuest: false,
  currency: 'GBP',
  rates: { GBP: 1 }
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
  const isPositive = Number.isFinite(value) && value > 0;
  const isNegative = Number.isFinite(value) && value < 0;
  el.classList.toggle('positive', isPositive);
  el.classList.toggle('negative', isNegative);
  if (!isPositive && !isNegative) {
    el.classList.remove('positive');
    el.classList.remove('negative');
  }
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
      await api('/api/logout', { method: 'POST' });
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

async function loadProfile() {
  try {
    const data = await api('/api/profile');
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
    profileState.isGuest = !!data.isGuest;
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
  } catch (e) {
    console.error('Unable to load profile details', e);
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
    'profile-reset',
    't212-enabled',
    't212-api-key',
    't212-api-secret',
    't212-mode',
    't212-save',
    't212-run-now'
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
  const sections = ['account-security', 'profile-reset-card', 'automation-card'];
  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('guest-disabled', disable);
  });
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
    input.value = profileState.nickname;
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
  lastBaseUrl: null,
  lastEndpoint: null,
  cooldownUntil: null,
  lastRaw: null
};

const ibkrState = {
  enabled: false,
  mode: 'gateway',
  accountId: '',
  connectionStatus: 'disconnected',
  lastSyncAt: null,
  lastStatus: null,
  lastSessionCheckAt: null,
  gatewayUrl: '/api/integrations/ibkr/gateway',
  accounts: []
};

function setIntegrationFieldsDisabled(disabled) {
  const container = document.getElementById('t212-fields');
  const apiInput = document.getElementById('t212-api-key');
  const secretInput = document.getElementById('t212-api-secret');
  const modeSelect = document.getElementById('t212-mode');
  const runBtn = document.getElementById('t212-run-now');
  if (container) container.classList.toggle('is-hidden', disabled);
  if (apiInput) apiInput.disabled = disabled;
  if (secretInput) secretInput.disabled = disabled;
  if (modeSelect) modeSelect.disabled = disabled;
  if (runBtn) runBtn.disabled = disabled;
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
    statusEl.textContent = 'No automated Trading 212 sync has run yet.';
  }
}

function setIbkrFieldsDisabled(disabled) {
  const container = document.getElementById('ibkr-fields');
  const accountSelect = document.getElementById('ibkr-account');
  if (container) container.classList.toggle('is-hidden', disabled);
  if (accountSelect) accountSelect.disabled = disabled;
}

function renderIbkrStatus(data) {
  const statusEl = document.getElementById('ibkr-status');
  if (!statusEl) return;
  statusEl.classList.remove('is-error');
  if (!data.enabled) {
    statusEl.textContent = 'IBKR sync is currently switched off.';
    return;
  }
  const connection = data.connectionStatus || 'disconnected';
  if (connection === 'connected') {
    const accountInfo = data.accountId ? `Account ${data.accountId}` : 'Account not selected';
    const lastSync = data.lastSyncAt ? new Date(data.lastSyncAt) : null;
    const syncText = lastSync && !Number.isNaN(lastSync.getTime())
      ? `Last synced ${lastSync.toLocaleString('en-GB')}.`
      : 'Sync has not run yet.';
    statusEl.textContent = `Connected • ${accountInfo}. ${syncText}`;
    return;
  }
  if (connection === 'pending') {
    statusEl.textContent = 'Waiting for IBKR Client Portal login to complete.';
    return;
  }
  if (data.lastStatus && data.lastStatus.message) {
    statusEl.classList.add('is-error');
    statusEl.textContent = data.lastStatus.message;
    return;
  }
  statusEl.textContent = 'IBKR session is not active. Click start session to reconnect.';
}

function populateIbkrAccounts(accounts, selected) {
  const accountSelect = document.getElementById('ibkr-account');
  if (!accountSelect) return;
  accountSelect.innerHTML = '';
  const list = Array.isArray(accounts) ? accounts : [];
  if (!list.length) {
    if (selected) {
      const option = document.createElement('option');
      option.value = selected;
      option.textContent = selected;
      option.selected = true;
      accountSelect.appendChild(option);
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No accounts found yet';
      accountSelect.appendChild(option);
    }
    return;
  }
  list.forEach(account => {
    if (!account) return;
    const value = String(account);
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    if (selected && selected === value) option.selected = true;
    accountSelect.appendChild(option);
  });
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
    integrationState.lastBaseUrl = data.lastBaseUrl || null;
    integrationState.lastEndpoint = data.lastEndpoint || null;
    integrationState.cooldownUntil = data.cooldownUntil || null;
    integrationState.lastRaw = data.lastRaw || null;
    const toggle = document.getElementById('t212-enabled');
    const apiInput = document.getElementById('t212-api-key');
    const secretInput = document.getElementById('t212-api-secret');
    const modeSelect = document.getElementById('t212-mode');
    if (toggle) toggle.checked = integrationState.enabled;
    if (apiInput) {
      apiInput.value = '';
      apiInput.placeholder = integrationState.hasApiKey
        ? 'Key saved — paste a new key to replace'
        : 'Paste your API key';
    }
    if (secretInput) {
      secretInput.value = '';
      secretInput.placeholder = integrationState.hasApiSecret
        ? 'Secret saved — paste a new secret to replace'
        : 'Paste your API secret';
    }
    if (modeSelect) modeSelect.value = integrationState.mode;
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
    ibkrState.mode = data.mode || 'gateway';
    ibkrState.accountId = data.accountId || '';
    ibkrState.connectionStatus = data.connectionStatus || 'disconnected';
    ibkrState.lastSyncAt = data.lastSyncAt || null;
    ibkrState.lastStatus = data.lastStatus || null;
    ibkrState.lastSessionCheckAt = data.lastSessionCheckAt || null;
    ibkrState.gatewayUrl = data.gatewayUrl || '/api/integrations/ibkr/gateway';
    const toggle = document.getElementById('ibkr-enabled');
    if (toggle) toggle.checked = ibkrState.enabled;
    setIbkrFieldsDisabled(!ibkrState.enabled || profileState.isGuest);
    populateIbkrAccounts(ibkrState.accounts, ibkrState.accountId);
    renderIbkrStatus(ibkrState);
    if (ibkrState.enabled && !profileState.isGuest) {
      await checkIbkrSession();
    }
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
  const accountSelect = document.getElementById('ibkr-account');
  const enabled = !!toggle?.checked;
  const payload = {
    enabled,
    mode: ibkrState.mode
  };
  if (accountSelect?.value) {
    payload.accountId = accountSelect.value;
  }
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
    setIbkrFieldsDisabled(!ibkrState.enabled || profileState.isGuest);
    renderIbkrStatus(ibkrState);
  } catch (e) {
    console.error('Unable to save IBKR settings', e);
    if (errorEl) errorEl.textContent = e?.data?.error || e.message || 'Unable to save IBKR settings.';
  }
}

async function startIbkrSession() {
  const errorEl = document.getElementById('ibkr-error');
  if (errorEl) errorEl.textContent = '';
  try {
    const data = await api('/api/integrations/ibkr/start-session', { method: 'POST' });
    if (data.gatewayUrl) {
      window.open(data.gatewayUrl, '_blank', 'noopener');
    }
    ibkrState.enabled = true;
    ibkrState.connectionStatus = 'pending';
    renderIbkrStatus(ibkrState);
    if (!profileState.isGuest) {
      await checkIbkrSession();
    }
  } catch (e) {
    console.error('Unable to start IBKR session', e);
    if (errorEl) errorEl.textContent = e?.data?.error || e.message || 'Unable to start IBKR session.';
  }
}

async function checkIbkrSession() {
  const errorEl = document.getElementById('ibkr-error');
  if (errorEl) errorEl.textContent = '';
  try {
    const data = await api('/api/integrations/ibkr/session-status');
    ibkrState.connectionStatus = data.connectionStatus || 'disconnected';
    ibkrState.accounts = Array.isArray(data.accounts) ? data.accounts : [];
    ibkrState.accountId = data.accountId || ibkrState.accountId;
    populateIbkrAccounts(ibkrState.accounts, ibkrState.accountId);
    if (ibkrState.accounts.length && !ibkrState.accountId) {
      ibkrState.accountId = ibkrState.accounts[0];
      const accountSelect = document.getElementById('ibkr-account');
      if (accountSelect) accountSelect.value = ibkrState.accountId;
      await saveIbkrIntegration();
    }
    renderIbkrStatus(ibkrState);
  } catch (e) {
    console.error('Unable to check IBKR session', e);
    if (errorEl) errorEl.textContent = e?.data?.error || e.message || 'Unable to check IBKR session.';
  }
}

async function endIbkrSession() {
  const errorEl = document.getElementById('ibkr-error');
  if (errorEl) errorEl.textContent = '';
  try {
    await api('/api/integrations/ibkr/end-session', { method: 'POST' });
    ibkrState.connectionStatus = 'disconnected';
    renderIbkrStatus(ibkrState);
  } catch (e) {
    console.error('Unable to end IBKR session', e);
    if (errorEl) errorEl.textContent = e?.data?.error || e.message || 'Unable to end IBKR session.';
  }
}

async function saveIntegration({ runNow = false } = {}) {
  const errorEl = document.getElementById('t212-error');
  if (errorEl) errorEl.textContent = '';
  const toggle = document.getElementById('t212-enabled');
  const apiInput = document.getElementById('t212-api-key');
  const secretInput = document.getElementById('t212-api-secret');
  const modeSelect = document.getElementById('t212-mode');
  const enabled = !!toggle?.checked;
  const payload = {
    enabled,
    mode: modeSelect?.value || integrationState.mode
  };
  const apiKeyValue = apiInput?.value.trim();
  if (apiKeyValue) {
    payload.apiKey = apiKeyValue;
  } else if (!enabled && integrationState.hasApiKey) {
    payload.apiKey = '';
  }
  const apiSecretValue = secretInput?.value.trim();
  if (apiSecretValue) {
    payload.apiSecret = apiSecretValue;
  } else if (!enabled && integrationState.hasApiSecret) {
    payload.apiSecret = '';
  }
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
    integrationState.lastBaseUrl = data.lastBaseUrl || null;
    integrationState.lastEndpoint = data.lastEndpoint || null;
    integrationState.cooldownUntil = data.cooldownUntil || null;
    integrationState.lastRaw = data.lastRaw || null;
    if (apiInput) {
      apiInput.value = '';
      apiInput.placeholder = integrationState.hasApiKey
        ? 'Key saved — paste a new key to replace'
        : 'Paste your API key';
    }
    if (secretInput) {
      secretInput.value = '';
      secretInput.placeholder = integrationState.hasApiSecret
        ? 'Secret saved — paste a new secret to replace'
        : 'Paste your API secret';
    }
    if (toggle) toggle.checked = integrationState.enabled;
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
  const portfolio = Number(portfolioRaw);
  const nicknameRaw = nicknameInput?.value.trim() ?? '';
  if (nicknameError) nicknameError.textContent = '';
  if (!portfolioRaw || Number.isNaN(portfolio) || portfolio < 0) {
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
    await api('/api/logout', { method: 'POST' });
  } catch (e) {
    console.warn(e);
  }
  sessionStorage.removeItem('guestMode');
  localStorage.removeItem('guestMode');
  window.location.href = '/login.html';
}

window.addEventListener('DOMContentLoaded', () => {
  bindNav();
  loadProfile();
  loadIntegration();
  loadIbkrIntegration();
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
  document.getElementById('ibkr-start')?.addEventListener('click', startIbkrSession);
  document.getElementById('ibkr-check')?.addEventListener('click', checkIbkrSession);
  document.getElementById('ibkr-sync')?.addEventListener('click', () => saveIbkrIntegration({ runNow: true }));
  document.getElementById('ibkr-end')?.addEventListener('click', endIbkrSession);
  document.getElementById('ibkr-account')?.addEventListener('change', () => saveIbkrIntegration());
  document.getElementById('profile-reset')?.addEventListener('click', resetProfile);
  document.getElementById('account-password-submit')?.addEventListener('click', handlePasswordChange);
  document.getElementById('account-nickname-submit')?.addEventListener('click', handleNicknameUpdate);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      helpModal?.classList.add('hidden');
      rawModal?.classList.add('hidden');
    }
  });
});
