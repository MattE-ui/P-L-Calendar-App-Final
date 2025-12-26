async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', ...opts });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Unauthenticated');
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.data = data;
    throw err;
  }
  return data;
}

const profileState = {
  complete: false,
  netDeposits: 0,
  netDepositsBaseline: 0,
  username: ''
};

const currencySymbols = { GBP: '£', USD: '$' };

function formatSignedCurrency(value, currency = 'GBP') {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const sign = num < 0 ? '-' : '';
  const symbol = currencySymbols[currency] || '£';
  return `${sign}${symbol}${Math.abs(num).toFixed(2)}`;
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
    window.location.href = '/login.html';
  });
  document.getElementById('quick-settings-btn')?.addEventListener('click', () => {
    closeNav?.(false);
    const modal = document.getElementById('quick-settings-modal');
    const riskSel = document.getElementById('qs-risk-select');
    const curSel = document.getElementById('qs-currency-select');
    try {
      const saved = localStorage.getItem('plc-prefs');
      if (saved) {
        const prefs = JSON.parse(saved);
        if (riskSel && Number.isFinite(prefs?.defaultRiskPct)) riskSel.value = String(prefs.defaultRiskPct);
        if (curSel && prefs?.defaultRiskCurrency) curSel.value = prefs.defaultRiskCurrency;
      }
    } catch (e) {
      console.warn(e);
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
    closeQs();
  });
  api('/api/profile')
    .then(profile => {
      const show = profile?.username === 'mevs.0404@gmail.com';
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
      netInput.readOnly = profileState.complete;
      netInput.classList.toggle('readonly', profileState.complete);
      netInput.required = !profileState.complete;
    }
    if (totalField) {
      totalField.classList.toggle('readonly', profileState.complete);
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
    const netPerformance = portfolioValue - netDepositsValue;
    const netPerfPct = netDepositsValue ? netPerformance / Math.abs(netDepositsValue) : 0;
    const heroPortfolio = document.getElementById('header-portfolio-value');
    if (heroPortfolio) heroPortfolio.textContent = formatSignedCurrency(portfolioValue);
    const heroDeposits = document.getElementById('hero-net-deposits-value');
    if (heroDeposits) heroDeposits.textContent = formatSignedCurrency(netDepositsValue);
    const heroPerformance = document.getElementById('hero-net-performance-value');
    if (heroPerformance) heroPerformance.textContent = formatSignedCurrency(netPerformance);
    const heroPerfSub = document.getElementById('hero-net-performance-sub');
    if (heroPerfSub) heroPerfSub.textContent = `${(netPerfPct * 100).toFixed(1)}%`;
    renderSecurityState();
  } catch (e) {
    console.error('Unable to load profile details', e);
  }
}

function renderSecurityState() {
  const usernameInput = document.getElementById('account-username');
  if (usernameInput) {
    usernameInput.value = profileState.username || '';
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
  } catch (e) {
    console.error('Unable to load Trading 212 settings', e);
    const statusEl = document.getElementById('t212-status');
    if (statusEl) statusEl.textContent = 'Trading 212 settings could not be loaded.';
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
  const portfolioRaw = portfolioInput?.value.trim() ?? '';
  const netRaw = netInput?.value.trim() ?? '';
  const portfolio = Number(portfolioRaw);
  if (!portfolioRaw || Number.isNaN(portfolio) || portfolio < 0) {
    if (errEl) errEl.textContent = 'Enter a non-negative portfolio value to continue.';
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
    if (deltaRaw) {
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
      body: JSON.stringify({ portfolio, netDeposits: netDepositsTotal })
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
  window.location.href = '/login.html';
}

window.addEventListener('DOMContentLoaded', () => {
  bindNav();
  loadProfile();
  loadIntegration();
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
  document.getElementById('t212-save')?.addEventListener('click', () => saveIntegration());
  document.getElementById('t212-run-now')?.addEventListener('click', () => saveIntegration({ runNow: true }));
  document.getElementById('profile-reset')?.addEventListener('click', resetProfile);
  document.getElementById('account-password-submit')?.addEventListener('click', handlePasswordChange);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      helpModal?.classList.add('hidden');
      rawModal?.classList.add('hidden');
    }
  });
});
