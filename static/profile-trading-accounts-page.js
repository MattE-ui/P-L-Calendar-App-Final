(async function initTradingAccountsPage() {
  const { api, setText } = window.AccountCenter;

  const BROKERS = [
    { id: 'trading212', name: 'Trading 212', typeHint: 'ISA / Invest' },
    { id: 'ibkr', name: 'IBKR', typeHint: 'Margin / Cash' }
  ];

  const state = {
    tradingAccounts: [],
    trading212: {},
    ibkr: {}
  };

  function formatWhen(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  }

  function brokerEnabled(brokerId) {
    return brokerId === 'trading212' ? !!state.trading212.enabled : !!state.ibkr.enabled;
  }

  function linkedAccountLabel(brokerId) {
    const linked = state.tradingAccounts.find((account) => account.integrationEnabled && account.integrationProvider === brokerId);
    return linked?.label || null;
  }

  function syncStatusFor(brokerId) {
    if (brokerId === 'trading212') {
      if (!state.trading212.enabled) return 'Not syncing';
      if (state.trading212.syncInProgress) return 'Active';
      if (state.trading212.lastStatus?.ok === false || state.trading212.lastSyncError) return 'Error';
      if (state.trading212.lastSyncAt) return 'Active';
      return 'Not syncing';
    }
    if (!state.ibkr.enabled) return 'Not syncing';
    if (state.ibkr.connectionStatus === 'online') return 'Active';
    if (state.ibkr.lastStatus?.ok === false) return 'Error';
    return 'Not syncing';
  }

  function accountTypeFor(brokerId, fallback) {
    const label = linkedAccountLabel(brokerId);
    return label || fallback;
  }

  function statusClass(isConnected) {
    return isConnected ? 'is-connected' : 'is-disconnected';
  }

  function renderBrokerCards() {
    const root = document.getElementById('broker-cards');
    if (!root) return;
    root.innerHTML = '';

    BROKERS.forEach((broker) => {
      const connected = brokerEnabled(broker.id);
      const syncState = syncStatusFor(broker.id);
      const lastSync = broker.id === 'trading212' ? state.trading212.lastSyncAt : state.ibkr.lastSyncAt;
      const card = document.createElement('article');
      card.className = `broker-card ${statusClass(connected)}`;
      card.innerHTML = `
        <header class="broker-card__head">
          <h3>${broker.name}</h3>
          <span class="broker-pill ${connected ? 'is-on' : 'is-off'}">${connected ? 'Connected' : 'Not connected'}</span>
        </header>
        <dl class="broker-meta-grid">
          <div><dt>Connection</dt><dd>${connected ? 'Connected' : 'Not connected'}</dd></div>
          <div><dt>Account type</dt><dd>${accountTypeFor(broker.id, broker.typeHint)}</dd></div>
          <div><dt>Sync status</dt><dd>${syncState}</dd></div>
          <div><dt>Last sync</dt><dd>${formatWhen(lastSync)}</dd></div>
        </dl>
        <div class="broker-card__actions">
          <a class="ghost small" href="/profile/settings">Manage</a>
          ${connected
            ? `<button type="button" class="ghost small" data-action="sync-now" data-broker="${broker.id}">Sync now</button>
               <button type="button" class="danger small" data-action="disconnect" data-broker="${broker.id}">Disconnect</button>`
            : `<button type="button" class="primary small" data-action="connect" data-broker="${broker.id}">Connect</button>`}
        </div>
      `;
      root.appendChild(card);
    });
  }

  function renderBrokerConnectOptions() {
    const root = document.getElementById('broker-connect-options');
    if (!root) return;
    root.innerHTML = '';

    BROKERS.forEach((broker) => {
      const connected = brokerEnabled(broker.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `broker-connect-option ${statusClass(connected)}`;
      button.dataset.action = connected ? 'manage' : 'connect';
      button.dataset.broker = broker.id;
      button.innerHTML = `
        <strong>${broker.name}</strong>
        <span>${connected ? 'Connected — manage integration' : 'Connect broker'}</span>
      `;
      root.appendChild(button);
    });
  }

  function renderSyncPanel() {
    const panel = document.getElementById('trading-sync-status-panel');
    if (!panel) return;
    panel.innerHTML = '';

    const rows = [
      {
        label: 'Trading 212',
        value: state.trading212.enabled
          ? `${syncStatusFor('trading212')} · Last sync ${formatWhen(state.trading212.lastSyncAt)}`
          : 'Not connected'
      },
      {
        label: 'IBKR',
        value: state.ibkr.enabled
          ? `${syncStatusFor('ibkr')} · Last sync ${formatWhen(state.ibkr.lastSyncAt)}`
          : 'Not connected'
      },
      {
        label: 'Auto-sync · Trading 212',
        value: state.trading212.enabled ? 'Enabled' : 'Disabled'
      },
      {
        label: 'Auto-sync · IBKR',
        value: state.ibkr.enabled ? 'Enabled' : 'Disabled'
      },
      {
        label: 'Next scheduled sync',
        value: state.trading212.enabled && state.trading212.snapshotTime
          ? `Trading 212 daily ${state.trading212.snapshotTime} (${state.trading212.timezone || 'Europe/London'})`
          : 'No scheduled sync'
      }
    ];

    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'status-kv-row';
      item.innerHTML = `<span>${row.label}</span><strong>${row.value}</strong>`;
      panel.appendChild(item);
    });
  }

  function renderAll() {
    renderBrokerCards();
    renderBrokerConnectOptions();
    renderSyncPanel();
  }

  async function refreshData() {
    const [accountsPayload, t212Payload, ibkrPayload] = await Promise.all([
      api('/api/account/trading-accounts').catch(() => ({ accounts: [] })),
      api('/api/integrations/trading212').catch(() => ({})),
      api('/api/integrations/ibkr').catch(() => ({}))
    ]);
    state.tradingAccounts = Array.isArray(accountsPayload.accounts) ? accountsPayload.accounts : [];
    state.trading212 = t212Payload || {};
    state.ibkr = ibkrPayload || {};
    renderAll();
  }

  async function connectBroker(broker) {
    if (broker === 'trading212') {
      return api('/api/integrations/trading212', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true })
      });
    }
    return api('/api/integrations/ibkr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    });
  }

  async function disconnectBroker(broker) {
    if (broker === 'trading212') {
      return api('/api/integrations/trading212', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false })
      });
    }
    return api('/api/integrations/ibkr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    });
  }

  async function syncNow(broker) {
    if (broker === 'trading212') {
      return api('/api/integrations/trading212', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !!state.trading212.enabled, runNow: true })
      });
    }
    return api('/api/integrations/ibkr/sync', { method: 'POST' });
  }

  function bindActions() {
    document.body.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-action][data-broker]');
      if (!target) return;
      const action = target.dataset.action;
      const broker = target.dataset.broker;
      if (!action || !broker) return;

      try {
        if (action === 'connect') {
          await connectBroker(broker);
          setText('trading-broker-action-status', `${broker === 'ibkr' ? 'IBKR' : 'Trading 212'} connected.`);
        } else if (action === 'disconnect') {
          await disconnectBroker(broker);
          setText('trading-broker-action-status', `${broker === 'ibkr' ? 'IBKR' : 'Trading 212'} disconnected.`);
        } else if (action === 'sync-now') {
          await syncNow(broker);
          setText('trading-broker-action-status', `${broker === 'ibkr' ? 'IBKR' : 'Trading 212'} sync requested.`);
        } else if (action === 'manage') {
          window.location.href = '/profile/settings';
          return;
        }
        await refreshData();
      } catch (error) {
        setText('trading-broker-action-status', error.message || 'Action failed.');
      }
    });
  }

  bindActions();
  try {
    await refreshData();
  } catch (error) {
    setText('trading-broker-action-status', error.message || 'Unable to load broker dashboard.');
  }
})();
