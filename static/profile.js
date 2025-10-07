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
  netDeposits: 0
};

async function loadProfile() {
  try {
    const data = await api('/api/profile');
    const portfolio = Number(data.portfolio);
    const netDeposits = Number(data.initialNetDeposits);
    profileState.complete = !!data.profileComplete;
    profileState.netDeposits = Number.isFinite(netDeposits) ? netDeposits : 0;
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
  } catch (e) {
    console.error('Unable to load profile details', e);
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
  cooldownUntil: null
};

function setIntegrationFieldsDisabled(disabled) {
  const container = document.getElementById('t212-fields');
  const apiInput = document.getElementById('t212-api-key');
  const secretInput = document.getElementById('t212-api-secret');
  const modeSelect = document.getElementById('t212-mode');
  const timeInput = document.getElementById('t212-time');
  const hostInput = document.getElementById('t212-host');
  const endpointInput = document.getElementById('t212-endpoint');
  const runBtn = document.getElementById('t212-run-now');
  if (container) container.classList.toggle('is-hidden', disabled);
  if (apiInput) apiInput.disabled = disabled;
  if (secretInput) secretInput.disabled = disabled;
  if (modeSelect) modeSelect.disabled = disabled;
  if (timeInput) timeInput.disabled = disabled;
  if (hostInput) hostInput.disabled = disabled;
  if (endpointInput) endpointInput.disabled = disabled;
  if (runBtn) runBtn.disabled = disabled;
}

function renderIntegrationStatus(data) {
  const statusEl = document.getElementById('t212-status');
  if (!statusEl) return;
  statusEl.classList.remove('is-error');
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
    integrationState.endpoint = data.endpoint || '/api/v0/equity/portfolio/summary';
    integrationState.lastBaseUrl = data.lastBaseUrl || null;
    integrationState.lastEndpoint = data.lastEndpoint || null;
    integrationState.cooldownUntil = data.cooldownUntil || null;
    const toggle = document.getElementById('t212-enabled');
    const apiInput = document.getElementById('t212-api-key');
    const secretInput = document.getElementById('t212-api-secret');
    const modeSelect = document.getElementById('t212-mode');
    const timeInput = document.getElementById('t212-time');
    const hostInput = document.getElementById('t212-host');
    const endpointInput = document.getElementById('t212-endpoint');
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
    if (timeInput) timeInput.value = integrationState.snapshotTime;
    if (hostInput) hostInput.value = integrationState.baseUrl || '';
    if (endpointInput) endpointInput.value = integrationState.endpoint || '/api/v0/equity/portfolio/summary';
    setIntegrationFieldsDisabled(!integrationState.enabled);
    renderIntegrationStatus({
      enabled: integrationState.enabled,
      lastSyncAt: data.lastSyncAt,
      lastStatus: data.lastStatus,
      timezone: integrationState.timezone,
      cooldownUntil: integrationState.cooldownUntil,
      lastBaseUrl: integrationState.lastBaseUrl,
      lastEndpoint: integrationState.lastEndpoint
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
  const timeInput = document.getElementById('t212-time');
  const hostInput = document.getElementById('t212-host');
  const endpointInput = document.getElementById('t212-endpoint');
  const enabled = !!toggle?.checked;
  const payload = {
    enabled,
    mode: modeSelect?.value || integrationState.mode,
    snapshotTime: timeInput?.value || integrationState.snapshotTime
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
  if (hostInput) {
    payload.baseUrl = hostInput.value.trim();
  }
  if (endpointInput) {
    payload.endpoint = endpointInput.value.trim();
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
    integrationState.endpoint = data.endpoint || '/api/v0/equity/portfolio/summary';
    integrationState.lastBaseUrl = data.lastBaseUrl || null;
    integrationState.lastEndpoint = data.lastEndpoint || null;
    integrationState.cooldownUntil = data.cooldownUntil || null;
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
    if (hostInput) hostInput.value = integrationState.baseUrl || '';
    if (endpointInput) endpointInput.value = integrationState.endpoint || '/api/v0/equity/portfolio/summary';
    if (toggle) toggle.checked = integrationState.enabled;
    setIntegrationFieldsDisabled(!integrationState.enabled);
    renderIntegrationStatus({
      enabled: integrationState.enabled,
      lastSyncAt: data.lastSyncAt,
      lastStatus: data.lastStatus,
      timezone: integrationState.timezone,
      cooldownUntil: integrationState.cooldownUntil,
      lastBaseUrl: integrationState.lastBaseUrl,
      lastEndpoint: integrationState.lastEndpoint
    });
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
  loadProfile();
  loadIntegration();
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
});
