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

async function loadProfile() {
  try {
    const data = await api('/api/profile');
    const portfolio = Number(data.portfolio);
    const netDeposits = Number(data.initialNetDeposits);
    const portfolioInput = document.getElementById('profile-portfolio');
    const netInput = document.getElementById('profile-net-deposits');
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
      if (netInput && Number.isFinite(netDeposits)) {
        netInput.value = netDeposits.toFixed(2);
      }
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
  cooldownUntil: null
};

function setIntegrationFieldsDisabled(disabled) {
  const container = document.getElementById('t212-fields');
  const apiInput = document.getElementById('t212-api-key');
  const secretInput = document.getElementById('t212-api-secret');
  const modeSelect = document.getElementById('t212-mode');
  const timeInput = document.getElementById('t212-time');
  const runBtn = document.getElementById('t212-run-now');
  if (container) container.classList.toggle('is-hidden', disabled);
  if (apiInput) apiInput.disabled = disabled;
  if (secretInput) secretInput.disabled = disabled;
  if (modeSelect) modeSelect.disabled = disabled;
  if (timeInput) timeInput.disabled = disabled;
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
    if (data.lastStatus && data.lastStatus.ok) {
      statusEl.textContent = `Last synced ${formatted}.`;
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
      statusEl.textContent = `Last sync failed${statusCode}: ${message}`;
    } else {
      statusEl.textContent = `Last sync attempted ${formatted}.`;
    }
  } else if (data.lastStatus && !data.lastStatus.ok && data.lastStatus.message) {
    statusEl.classList.add('is-error');
    const statusCode = data.lastStatus.status ? ` (HTTP ${data.lastStatus.status})` : '';
    statusEl.textContent = `Sync pending${statusCode}: ${data.lastStatus.message}`;
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
    integrationState.cooldownUntil = data.cooldownUntil || null;
    const toggle = document.getElementById('t212-enabled');
    const apiInput = document.getElementById('t212-api-key');
    const secretInput = document.getElementById('t212-api-secret');
    const modeSelect = document.getElementById('t212-mode');
    const timeInput = document.getElementById('t212-time');
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
    setIntegrationFieldsDisabled(!integrationState.enabled);
    renderIntegrationStatus({
      enabled: integrationState.enabled,
      lastSyncAt: data.lastSyncAt,
      lastStatus: data.lastStatus,
      timezone: integrationState.timezone,
      cooldownUntil: integrationState.cooldownUntil
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
    if (toggle) toggle.checked = integrationState.enabled;
    setIntegrationFieldsDisabled(!integrationState.enabled);
    renderIntegrationStatus({
      enabled: integrationState.enabled,
      lastSyncAt: data.lastSyncAt,
      lastStatus: data.lastStatus,
      timezone: integrationState.timezone,
      cooldownUntil: integrationState.cooldownUntil
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
  const portfolioRaw = portfolioInput?.value.trim() ?? '';
  const netRaw = netInput?.value.trim() ?? '';
  const portfolio = Number(portfolioRaw);
  const netDeposits = Number(netRaw);
  if (!portfolioRaw || Number.isNaN(portfolio) || portfolio < 0) {
    if (errEl) errEl.textContent = 'Enter a non-negative portfolio value to continue.';
    return;
  }
  if (!netRaw || Number.isNaN(netDeposits)) {
    if (errEl) errEl.textContent = 'Enter your cumulative net deposits (can be negative).';
    return;
  }
  try {
    await api('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolio, netDeposits })
    });
    window.location.href = '/';
  } catch (e) {
    console.error(e);
    if (errEl) errEl.textContent = e?.data?.error || 'Unable to save profile details. Please try again.';
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
  document.getElementById('t212-enabled')?.addEventListener('change', (ev) => {
    const checked = ev.target.checked;
    setIntegrationFieldsDisabled(!checked);
  });
  document.getElementById('t212-save')?.addEventListener('click', () => saveIntegration());
  document.getElementById('t212-run-now')?.addEventListener('click', () => saveIntegration({ runNow: true }));
});
