(async function initAutomationPage() {
  const { api, setText } = window.AccountCenter;

  const state = {
    t212: null,
    ibkr: null,
    notifications: null
  };

  const STATUS_CLASS_MAP = {
    active: 'automation-pill--active',
    idle: 'automation-pill--idle',
    error: 'automation-pill--error',
    disconnected: 'automation-pill--disconnected'
  };

  function formatDateTime(value) {
    if (!value) return 'Unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unavailable';
    return date.toLocaleString();
  }

  function setStatusPill(id, label, tone) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = label;
    el.classList.remove('automation-pill--active', 'automation-pill--idle', 'automation-pill--error', 'automation-pill--disconnected');
    el.classList.add(STATUS_CLASS_MAP[tone] || 'automation-pill--disconnected');
  }

  function revealStatusLine(id, message, type = '') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.classList.remove('is-hidden', 'is-error', 'is-success');
    if (type === 'error') el.classList.add('is-error');
    if (type === 'success') el.classList.add('is-success');
  }

  function deriveTrading212Status(t212) {
    if (!t212?.hasApiKey || !t212?.hasApiSecret) return { label: 'Disconnected', tone: 'disconnected' };
    if (t212?.lastSyncError) return { label: 'Error', tone: 'error' };
    if (t212?.enabled) return { label: 'Active', tone: 'active' };
    return { label: 'Idle', tone: 'idle' };
  }

  function deriveIbkrStatus(ibkr) {
    if (!ibkr?.connectorConfigured) return { label: 'Disconnected', tone: 'disconnected' };
    if (ibkr?.connectionStatus === 'online' && ibkr?.enabled) return { label: 'Active', tone: 'active' };
    if (ibkr?.connectionStatus === 'online' && !ibkr?.enabled) return { label: 'Idle', tone: 'idle' };
    if (ibkr?.lastStatus && /fail|error/i.test(ibkr.lastStatus)) return { label: 'Error', tone: 'error' };
    if (ibkr?.connectionStatus === 'disconnected') return { label: 'Disconnected', tone: 'disconnected' };
    return { label: 'Idle', tone: 'idle' };
  }

  function renderBrokerStateList(t212Status, ibkrStatus) {
    const list = document.getElementById('automation-broker-states');
    if (!list) return;
    list.innerHTML = [
      `<li><span>Trading 212</span><strong class="is-${t212Status.tone}">${t212Status.label}</strong></li>`,
      `<li><span>IBKR connector</span><strong class="is-${ibkrStatus.tone}">${ibkrStatus.label}</strong></li>`
    ].join('');
  }

  function renderOverview() {
    const { t212, ibkr } = state;
    const t212Status = deriveTrading212Status(t212);
    const ibkrStatus = deriveIbkrStatus(ibkr);

    const anyEnabled = !!(t212?.enabled || ibkr?.enabled);
    const anyError = t212Status.tone === 'error' || ibkrStatus.tone === 'error';
    const overallTone = anyError ? 'error' : (anyEnabled ? 'active' : 'idle');
    const overallLabel = anyError ? 'Attention required' : (anyEnabled ? 'Active' : 'Paused');

    setStatusPill('automation-overall-pill', overallLabel, overallTone);
    setText('automation-status', overallLabel);
    setText('automation-auto-sync', `Auto-sync: ${anyEnabled ? 'enabled' : 'disabled'}`);

    const lastRunCandidates = [t212?.lastSyncAt, ibkr?.lastSyncAt, ibkr?.lastSnapshotAt]
      .filter(Boolean)
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => b - a);
    setText('automation-last-run', lastRunCandidates.length ? lastRunCandidates[0].toLocaleString() : 'Unavailable');

    const resultText = [t212?.lastStatus, ibkr?.lastStatus].filter(Boolean).join(' | ');
    setText('automation-last-result', `Result: ${resultText || 'Unavailable'}`);

    const nextRun = t212?.snapshotTime ? `Trading 212 daily at ${t212.snapshotTime} (${t212?.timezone || 'configured timezone'})` : 'Unavailable';
    setText('automation-next-run', nextRun);

    renderBrokerStateList(t212Status, ibkrStatus);
  }

  function renderEngineCards() {
    const { t212, ibkr } = state;
    const t212Status = deriveTrading212Status(t212);
    const ibkrStatus = deriveIbkrStatus(ibkr);

    setStatusPill('engine-t212-status', t212Status.label, t212Status.tone);
    setText('engine-t212-mode', t212?.mode === 'practice' ? 'Demo' : (t212?.mode ? 'Live' : 'Unavailable'));
    setText('engine-t212-last-run', formatDateTime(t212?.lastSyncAt));
    setText('engine-t212-last-result', t212?.lastSyncError || t212?.lastStatus || 'Unavailable');
    setText('engine-t212-next-run', t212?.snapshotTime ? `${t212.snapshotTime} (${t212?.timezone || 'configured timezone'})` : 'Unavailable');

    const t212Toggle = document.getElementById('engine-t212-toggle');
    if (t212Toggle) t212Toggle.textContent = t212?.enabled ? 'Pause' : 'Resume';

    const t212Connect = document.getElementById('engine-t212-connect');
    if (t212Connect) t212Connect.textContent = (t212?.hasApiKey && t212?.hasApiSecret) ? 'Connected' : 'Connect';

    setStatusPill('engine-ibkr-status', ibkrStatus.label, ibkrStatus.tone);
    setText('engine-ibkr-mode', ibkr?.mode ? 'Live' : 'Unavailable');
    setText('engine-ibkr-last-run', formatDateTime(ibkr?.lastSyncAt || ibkr?.lastSnapshotAt));
    setText('engine-ibkr-last-result', ibkr?.lastStatus || ibkr?.lastDisconnectReason || 'Unavailable');
    setText('engine-ibkr-next-run', ibkr?.enabled ? 'Managed by connector heartbeat' : 'Unavailable');

    const ibkrToggle = document.getElementById('engine-ibkr-toggle');
    if (ibkrToggle) ibkrToggle.textContent = ibkr?.enabled ? 'Pause' : 'Resume';

    const ibkrConnect = document.getElementById('engine-ibkr-connect');
    if (ibkrConnect) ibkrConnect.textContent = ibkr?.connectorConfigured ? 'Connected' : 'Connect';
  }

  function renderAlerts() {
    const payload = state.notifications || {};
    const devices = Array.isArray(payload.devices) ? payload.devices : [];
    const hasPushDevice = devices.some((device) => device.isActive !== false);
    const categories = devices[0]?.categories || {};

    setText('alerts-trade', categories.tradeAlerts === undefined ? 'Unavailable' : (categories.tradeAlerts ? 'Enabled' : 'Disabled'));
    setText('alerts-group', categories.tradeGroupAlerts === undefined ? 'Unavailable' : (categories.tradeGroupAlerts ? 'Enabled' : 'Disabled'));
    setText('alerts-push', hasPushDevice ? 'Enabled' : 'Disabled');
  }

  function renderSystemStatus() {
    const ibkr = state.ibkr || {};
    const connector = ibkr.connectionStatus || 'Unavailable';
    const worker = ibkr.enabled ? 'Running' : 'Paused';
    const queue = ibkr.lastSessionCheckAt ? `Last processed ${formatDateTime(ibkr.lastSessionCheckAt)}` : 'Unavailable';

    setText('system-ibkr-connector', connector);
    setText('system-worker', worker);
    setText('system-queue', queue);

    const detailBits = [
      ibkr.lastHeartbeatAt ? `Heartbeat ${formatDateTime(ibkr.lastHeartbeatAt)}` : '',
      ibkr.lastDisconnectReason ? `Reason: ${ibkr.lastDisconnectReason}` : ''
    ].filter(Boolean);
    setText('system-details', detailBits.length ? detailBits.join(' • ') : 'Runtime diagnostics are populated from available integration telemetry.');
  }

  async function load() {
    const [t212, ibkr, notifications] = await Promise.all([
      api('/api/integrations/trading212').catch(() => ({})),
      api('/api/integrations/ibkr').catch(() => ({})),
      api('/api/notifications/devices').catch(() => ({}))
    ]);

    state.t212 = t212;
    state.ibkr = ibkr;
    state.notifications = notifications;

    renderOverview();
    renderEngineCards();
    renderAlerts();
    renderSystemStatus();
  }

  async function runTrading212() {
    try {
      await api('/api/integrations/trading212', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runNow: true })
      });
      revealStatusLine('engine-t212-feedback', 'Trading 212 sync triggered.', 'success');
      await load();
    } catch (error) {
      revealStatusLine('engine-t212-feedback', error.message || 'Unable to run Trading 212 sync.', 'error');
    }
  }

  async function toggleTrading212() {
    try {
      await api('/api/integrations/trading212', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !state.t212?.enabled })
      });
      revealStatusLine('engine-t212-feedback', `Trading 212 automation ${state.t212?.enabled ? 'paused' : 'resumed'}.`, 'success');
      await load();
    } catch (error) {
      revealStatusLine('engine-t212-feedback', error.message || 'Unable to update Trading 212 status.', 'error');
    }
  }

  async function runIbkr() {
    try {
      await api('/api/integrations/ibkr/sync', { method: 'POST' });
      revealStatusLine('engine-ibkr-feedback', 'IBKR sync triggered.', 'success');
      await load();
    } catch (error) {
      revealStatusLine('engine-ibkr-feedback', error.message || 'Unable to run IBKR sync.', 'error');
    }
  }

  async function toggleIbkr() {
    try {
      await api('/api/integrations/ibkr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !state.ibkr?.enabled })
      });
      revealStatusLine('engine-ibkr-feedback', `IBKR automation ${state.ibkr?.enabled ? 'paused' : 'resumed'}.`, 'success');
      await load();
    } catch (error) {
      revealStatusLine('engine-ibkr-feedback', error.message || 'Unable to update IBKR status.', 'error');
    }
  }

  function openTradingAccountConfig() {
    window.location.href = '/profile/trading-accounts';
  }

  document.getElementById('auto-refresh-overview')?.addEventListener('click', () => load());
  document.getElementById('auto-refresh-ibkr')?.addEventListener('click', () => load());

  document.getElementById('engine-t212-run')?.addEventListener('click', runTrading212);
  document.getElementById('engine-t212-toggle')?.addEventListener('click', toggleTrading212);
  document.getElementById('engine-t212-configure')?.addEventListener('click', openTradingAccountConfig);
  document.getElementById('engine-t212-connect')?.addEventListener('click', openTradingAccountConfig);

  document.getElementById('engine-ibkr-run')?.addEventListener('click', runIbkr);
  document.getElementById('engine-ibkr-toggle')?.addEventListener('click', toggleIbkr);
  document.getElementById('engine-ibkr-configure')?.addEventListener('click', openTradingAccountConfig);
  document.getElementById('engine-ibkr-connect')?.addEventListener('click', openTradingAccountConfig);

  load().catch((error) => {
    revealStatusLine('engine-t212-feedback', error.message || 'Unable to load automation dashboard.', 'error');
  });
})();
