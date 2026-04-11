(async function initTradingAccountsPage() {
  const { api, setText } = window.AccountCenter;

  const state = { t212Accounts: [], ibkr: {} };

  function formatWhen(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
  }

  function statusClass(status) {
    if (status === 'connected' || status === 'active') return 'is-connected';
    if (status === 'error') return 'is-warning';
    return 'is-disconnected';
  }

  function renderTrading212Cards() {
    const root = document.getElementById('broker-cards');
    if (!root) return;
    root.innerHTML = '';

    const wrapper = document.createElement('section');
    wrapper.className = 'broker-provider-section';
    wrapper.innerHTML = `
      <div class="trading-section-head">
        <h3>Trading 212</h3>
        <button type="button" class="primary small" data-action="add-t212">+ Add Trading 212 account</button>
      </div>
      <div class="broker-provider-list"></div>
    `;
    const list = wrapper.querySelector('.broker-provider-list');

    if (!state.t212Accounts.length) {
      const empty = document.createElement('p');
      empty.className = 'helper';
      empty.textContent = 'No linked Trading 212 accounts yet.';
      list.appendChild(empty);
    }

    state.t212Accounts.forEach((account) => {
      const card = document.createElement('article');
      card.className = `broker-card ${statusClass(account.connectionStatus)}`;
      card.innerHTML = `
        <header class="broker-card__head">
          <h4>${account.accountLabel || 'Trading 212 account'}</h4>
          <span class="broker-pill">${account.accountType || 'Trading account'}</span>
        </header>
        <dl class="broker-meta-grid">
          <div><dt>Connection</dt><dd>${account.connectionStatus || 'disconnected'}</dd></div>
          <div><dt>Sync status</dt><dd>${account.syncStatus || 'idle'}</dd></div>
          <div><dt>Last sync</dt><dd>${formatWhen(account.lastSyncAt)}</dd></div>
          <div><dt>Automation</dt><dd>${account.automationEnabled ? 'Enabled' : 'Disabled'}</dd></div>
        </dl>
        <div class="broker-card__actions">
          <button type="button" class="primary small" data-action="sync-account" data-account-id="${account.brokerAccountId}">Sync now</button>
          <button type="button" class="ghost small" data-action="edit-account" data-account-id="${account.brokerAccountId}">Edit credentials</button>
          <button type="button" class="ghost small" data-action="toggle-automation" data-account-id="${account.brokerAccountId}">${account.automationEnabled ? 'Pause automation' : 'Enable automation'}</button>
          <button type="button" class="danger small" data-action="disconnect-account" data-account-id="${account.brokerAccountId}">Disconnect</button>
        </div>
      `;
      list.appendChild(card);
    });

    root.appendChild(wrapper);
  }

  function renderIbkrCard() {
    const root = document.getElementById('broker-connect-options');
    if (!root) return;
    const connected = !!state.ibkr.enabled;
    root.innerHTML = `
      <button type="button" class="broker-connect-option ${connected ? 'is-connected' : 'is-disconnected'}" data-action="${connected ? 'sync-ibkr' : 'connect-ibkr'}">
        <div class="broker-connect-option__head">
          <strong>IBKR</strong>
          <span class="broker-connect-option__status">${connected ? 'Connected' : 'Not connected'}</span>
        </div>
        <span class="broker-connect-option__action">${connected ? 'Sync now' : 'Connect broker'}</span>
      </button>
    `;
  }

  function renderSyncPanel() {
    const panel = document.getElementById('trading-sync-status-panel');
    if (!panel) return;
    const latestT212 = state.t212Accounts
      .map((account) => Date.parse(account.lastSyncAt || ''))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    panel.innerHTML = `
      <div class="status-kv-group">
        <h3 class="status-kv-group__title">Trading 212</h3>
        <div class="status-kv-row"><span>Linked accounts</span><strong>${state.t212Accounts.length}</strong></div>
        <div class="status-kv-row"><span>Latest sync</span><strong>${latestT212 ? new Date(latestT212).toLocaleString() : '—'}</strong></div>
      </div>
      <div class="status-kv-group">
        <h3 class="status-kv-group__title">IBKR</h3>
        <div class="status-kv-row"><span>Status</span><strong>${state.ibkr.enabled ? 'Connected' : 'Disconnected'}</strong></div>
        <div class="status-kv-row"><span>Last sync</span><strong>${formatWhen(state.ibkr.lastSyncAt)}</strong></div>
      </div>
    `;
  }

  async function refreshData() {
    const [brokerPayload, ibkrPayload] = await Promise.all([
      api('/api/broker-accounts?provider=trading212').catch(() => ({ accounts: [] })),
      api('/api/integrations/ibkr').catch(() => ({}))
    ]);
    state.t212Accounts = Array.isArray(brokerPayload.accounts)
      ? brokerPayload.accounts.filter((account) => account.provider === 'trading212' && account.active !== false)
      : [];
    state.ibkr = ibkrPayload || {};
    renderTrading212Cards();
    renderIbkrCard();
    renderSyncPanel();
  }

  async function addAccountFlow() {
    const label = window.prompt('Account label (e.g. ISA, General, CFD):', '');
    if (label === null) return;
    const apiKey = window.prompt('Trading 212 API key:');
    if (!apiKey) return;
    const apiSecret = window.prompt('Trading 212 API secret:');
    if (!apiSecret) return;
    await api('/api/broker-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'trading212', accountLabel: label, apiKey, apiSecret })
    });
    setText('trading-broker-action-status', 'Trading 212 account linked.');
  }

  async function editAccountFlow(accountId) {
    const account = state.t212Accounts.find((row) => row.brokerAccountId === accountId);
    if (!account) return;
    const accountLabel = window.prompt('Rename account label:', account.accountLabel || '');
    if (accountLabel === null) return;
    const apiKey = window.prompt('New API key (leave blank to keep current):', '');
    const apiSecret = window.prompt('New API secret (leave blank to keep current):', '');
    await api(`/api/broker-accounts/${encodeURIComponent(accountId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountLabel,
        ...(apiKey ? { apiKey } : {}),
        ...(apiSecret ? { apiSecret } : {})
      })
    });
    setText('trading-broker-action-status', 'Trading 212 account updated.');
  }

  async function handleAction(action, accountId) {
    if (action === 'add-t212') return addAccountFlow();
    if (action === 'sync-account') return api(`/api/broker-accounts/${encodeURIComponent(accountId)}/sync`, { method: 'POST' });
    if (action === 'disconnect-account') return api(`/api/broker-accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    if (action === 'edit-account') return editAccountFlow(accountId);
    if (action === 'toggle-automation') {
      const account = state.t212Accounts.find((row) => row.brokerAccountId === accountId);
      return api(`/api/broker-accounts/${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automationEnabled: !(account?.automationEnabled) })
      });
    }
    if (action === 'connect-ibkr') {
      return api('/api/integrations/ibkr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    }
    if (action === 'sync-ibkr') return api('/api/integrations/ibkr/sync', { method: 'POST' });
    return null;
  }

  document.body.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const accountId = target.dataset.accountId || '';
    try {
      await handleAction(action, accountId);
      await refreshData();
      if (action === 'disconnect-account') setText('trading-broker-action-status', 'Trading 212 account disconnected.');
      if (action === 'sync-account') setText('trading-broker-action-status', 'Trading 212 account sync requested.');
      if (action === 'toggle-automation') setText('trading-broker-action-status', 'Automation setting updated.');
    } catch (error) {
      setText('trading-broker-action-status', error.message || 'Action failed.');
    }
  });

  try {
    await refreshData();
  } catch (error) {
    setText('trading-broker-action-status', error.message || 'Unable to load broker dashboard.');
  }
})();
