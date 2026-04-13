(async function initTradingAccountsPage() {
  const { api, setText, setStatus } = window.AccountCenter;

  const state = {
    t212Accounts: [],
    tradingAccounts: [],
    ibkr: {},
    modalMode: 'add',
    modalAccountId: '',
    activeTab: 'accounts'
  };

  const modalElements = {
    root: document.getElementById('t212-account-modal'),
    title: document.getElementById('t212-account-modal-title'),
    subtitle: document.getElementById('t212-account-modal-subtitle'),
    form: document.getElementById('t212-account-form'),
    label: document.getElementById('t212-account-label-input'),
    apiKey: document.getElementById('t212-api-key-input'),
    apiSecret: document.getElementById('t212-api-secret-input'),
    apiKeyHelper: document.getElementById('t212-api-key-helper'),
    apiSecretHelper: document.getElementById('t212-api-secret-helper'),
    submit: document.getElementById('t212-account-submit-btn')
  };

  const addAccountModal = document.getElementById('add-account-modal');

  function formatWhen(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
  }

  function formatMoney(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(numeric);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char] || char
    ));
  }

  function normalizeDataSource(account = {}) {
    if (account?.dataSource) return account.dataSource;
    if (account?.source === 'imported' || account?.imported || account?.importSource) return 'imported';
    const provider = String(account.integrationProvider || '').toLowerCase();
    if (provider === 'trading212' && account.integrationEnabled !== false) return 'automated';
    if (provider === 'ibkr') return 'manual';
    return 'manual';
  }

  function createUnifiedAccounts() {
    const unified = [];

    state.tradingAccounts.forEach((account) => {
      const provider = account.integrationProvider === 'trading212'
        ? 'Trading 212'
        : account.integrationProvider === 'ibkr'
          ? 'IBKR'
          : 'Manual';
      unified.push({
        id: `acct-${account.id}`,
        sourceId: account.id,
        accountName: account.label || 'Trading account',
        broker: provider,
        accountType: account.integrationProvider === 'ibkr' ? 'Broker account' : 'Trading account',
        portfolioValue: account.currentValue,
        dataSource: normalizeDataSource(account),
        lastUpdated: state.ibkr.lastSyncAt || null,
        automated: normalizeDataSource(account) === 'automated',
        kind: 'trading-account',
        provider: account.integrationProvider || null
      });
    });

    state.t212Accounts.forEach((account) => {
      unified.push({
        id: `t212-${account.brokerAccountId}`,
        sourceId: account.brokerAccountId,
        accountName: account.accountLabel || 'Trading 212 account',
        broker: 'Trading 212',
        accountType: account.accountType || 'Trading account',
        portfolioValue: null,
        dataSource: 'automated',
        lastUpdated: account.lastSyncAt,
        automated: true,
        kind: 't212',
        provider: 'trading212'
      });
    });

    return unified;
  }

  function renderAccountsList() {
    const root = document.getElementById('trading-accounts-grid');
    if (!root) return;
    const accounts = createUnifiedAccounts();
    root.innerHTML = '';

    if (!accounts.length) {
      root.innerHTML = '<p class="helper">No trading accounts yet. Add an account to get started.</p>';
      return;
    }

    accounts.forEach((account) => {
      const card = document.createElement('article');
      card.className = 'trading-account-card';
      const sourceLabel = account.dataSource.charAt(0).toUpperCase() + account.dataSource.slice(1);
      const canSync = account.dataSource === 'automated';
      const canImport = account.dataSource !== 'automated';
      card.innerHTML = `
        <header class="trading-account-card__header">
          <h3>${escapeHtml(account.accountName)}</h3>
          <span class="data-source-badge is-${escapeHtml(account.dataSource)}">${escapeHtml(sourceLabel)}</span>
        </header>
        <dl class="broker-meta-grid">
          <div><dt>Broker</dt><dd>${escapeHtml(account.broker)}</dd></div>
          <div><dt>Account type</dt><dd>${escapeHtml(account.accountType)}</dd></div>
          <div><dt>Portfolio value</dt><dd>${formatMoney(account.portfolioValue)}</dd></div>
          <div><dt>Last updated</dt><dd>${formatWhen(account.lastUpdated)}</dd></div>
        </dl>
        <div class="broker-card__actions">
          <button type="button" class="ghost" data-action="manage-account" data-account-id="${escapeHtml(account.id)}">Manage</button>
          <button type="button" class="ghost" data-action="edit-unified-account" data-account-id="${escapeHtml(account.id)}">Edit</button>
          ${canSync ? `<button type="button" class="primary" data-action="sync-unified-account" data-account-id="${escapeHtml(account.id)}">Sync</button>` : ''}
          ${canImport ? `<button type="button" class="ghost" data-action="import-unified-account" data-account-id="${escapeHtml(account.id)}">Import</button>` : ''}
          ${account.automated ? `<button type="button" class="danger" data-action="disconnect-unified-account" data-account-id="${escapeHtml(account.id)}">Disconnect</button>` : ''}
        </div>
      `;
      root.appendChild(card);
    });
  }

  function renderProviderHeader() {
    const count = state.t212Accounts.length;
    return `
      <div class="broker-provider-header">
        <div class="broker-provider-header__copy">
          <p class="broker-provider-header__eyebrow">Provider</p>
          <h3>Trading 212</h3>
          <p class="helper">${count ? `${count} linked account${count === 1 ? '' : 's'} connected.` : 'Link multiple Trading 212 accounts.'}</p>
        </div>
        <button type="button" class="primary" data-action="add-t212">+ Add account</button>
      </div>
    `;
  }

  function renderTrading212Cards() {
    const root = document.getElementById('broker-cards');
    if (!root) return;
    root.innerHTML = '';

    const wrapper = document.createElement('section');
    wrapper.className = 'broker-provider-section';
    wrapper.innerHTML = `${renderProviderHeader()}<div class="broker-provider-list"></div>`;
    const list = wrapper.querySelector('.broker-provider-list');

    if (!state.t212Accounts.length) {
      const empty = document.createElement('p');
      empty.className = 'helper';
      empty.textContent = 'No linked Trading 212 accounts yet.';
      list.appendChild(empty);
    }

    state.t212Accounts.forEach((account) => {
      const card = document.createElement('article');
      card.className = 'broker-card broker-card--premium';
      card.innerHTML = `
        <header class="broker-card__head">
          <div class="broker-card__title-wrap">
            <h4>${escapeHtml(account.accountLabel || 'Trading 212 account')}</h4>
            <div class="broker-card__badges">
              <span class="broker-pill">Trading 212</span>
              <span class="broker-pill">${escapeHtml(account.accountType || 'Trading account')}</span>
            </div>
          </div>
        </header>
        <dl class="broker-meta-grid">
          <div><dt>Connection</dt><dd>${escapeHtml(account.connectionStatus || 'Connected')}</dd></div>
          <div><dt>Data status</dt><dd>${escapeHtml(account.syncStatus || 'Idle')}</dd></div>
          <div><dt>Account type</dt><dd>${escapeHtml(account.accountType || 'Trading account')}</dd></div>
          <div><dt>Last update</dt><dd>${formatWhen(account.lastSyncAt)}</dd></div>
        </dl>
        <div class="broker-card__actions">
          <button type="button" class="primary" data-action="sync-account" data-account-id="${account.brokerAccountId}">Refresh now</button>
          <button type="button" class="ghost" data-action="edit-account" data-account-id="${account.brokerAccountId}">Edit account</button>
          <button type="button" class="danger" data-action="disconnect-account" data-account-id="${account.brokerAccountId}">Disconnect</button>
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
    panel.innerHTML = `
      <div class="status-kv-group">
        <h3 class="status-kv-group__title">Trading 212</h3>
        <div class="status-kv-row"><span>Linked accounts</span><strong>${state.t212Accounts.length}</strong></div>
      </div>
      <div class="status-kv-group">
        <h3 class="status-kv-group__title">IBKR</h3>
        <div class="status-kv-row"><span>Status</span><strong>${state.ibkr.enabled ? 'Connected' : 'Disconnected'}</strong></div>
        <div class="status-kv-row"><span>Last update</span><strong>${formatWhen(state.ibkr.lastSyncAt)}</strong></div>
      </div>
    `;
  }

  function setActiveTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.trading-page-tab').forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.trading-tab-panel').forEach((panel) => {
      panel.classList.toggle('is-hidden', panel.dataset.panel !== tab);
    });
  }

  async function refreshData() {
    const [brokerPayload, ibkrPayload, tradingAccountsPayload] = await Promise.all([
      api('/api/broker-accounts?provider=trading212').catch(() => ({ accounts: [] })),
      api('/api/integrations/ibkr').catch(() => ({})),
      api('/api/account/trading-accounts').catch(() => ({ accounts: [] }))
    ]);
    state.t212Accounts = Array.isArray(brokerPayload.accounts)
      ? brokerPayload.accounts.filter((account) => account.provider === 'trading212' && account.active !== false)
      : [];
    state.ibkr = ibkrPayload || {};
    state.tradingAccounts = Array.isArray(tradingAccountsPayload.accounts) ? tradingAccountsPayload.accounts : [];
    renderAccountsList();
    renderTrading212Cards();
    renderIbkrCard();
    renderSyncPanel();
  }

  function openAccountModal(mode, accountId = '') {
    if (!modalElements.root) return;
    const isEdit = mode === 'edit';
    state.modalMode = mode;
    state.modalAccountId = accountId;
    const account = isEdit ? state.t212Accounts.find((row) => row.brokerAccountId === accountId) : null;
    modalElements.title.textContent = isEdit ? 'Edit Trading 212 account' : 'Add Trading 212 account';
    modalElements.subtitle.textContent = isEdit
      ? 'Update label or replace credentials. Leave key/secret blank to keep current values.'
      : 'Connect a Trading 212 account with secure API credentials.';
    modalElements.submit.textContent = isEdit ? 'Save changes' : 'Save account';
    modalElements.label.value = account?.accountLabel || '';
    modalElements.apiKey.value = '';
    modalElements.apiSecret.value = '';
    setStatus('t212-account-modal-status', '', false);
    modalElements.root.classList.remove('hidden');
    modalElements.label.focus();
  }

  function closeAccountModal() {
    modalElements.root?.classList.add('hidden');
    setStatus('t212-account-modal-status', '', false);
  }

  function openAddAccountModal() {
    addAccountModal?.classList.remove('hidden');
  }

  function closeAddAccountModal() {
    addAccountModal?.classList.add('hidden');
  }

  async function createManualAccount() {
    const label = window.prompt('Manual account name');
    if (!label) return;
    const valueRaw = window.prompt('Portfolio value (GBP)', '0');
    const value = Number(valueRaw || 0);
    const accounts = Array.isArray(state.tradingAccounts) ? [...state.tradingAccounts] : [];
    accounts.push({
      id: `manual-${Date.now()}`,
      label: label.trim(),
      currentValue: Number.isFinite(value) && value >= 0 ? value : 0,
      currentNetDeposits: 0,
      integrationProvider: null,
      integrationEnabled: false
    });
    await api('/api/account/trading-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, accounts })
    });
    setText('trading-broker-action-status', 'Manual account created.');
  }

  async function submitAccountModal() {
    const isEditMode = state.modalMode === 'edit';
    const accountLabel = modalElements.label.value.trim();
    const apiKey = modalElements.apiKey.value.trim();
    const apiSecret = modalElements.apiSecret.value.trim();
    if (!accountLabel) return setStatus('t212-account-modal-status', 'Account label is required.', true);
    if (!isEditMode && !apiKey) return setStatus('t212-account-modal-status', 'API key is required.', true);
    if (!isEditMode && !apiSecret) return setStatus('t212-account-modal-status', 'API secret is required.', true);

    if (isEditMode) {
      await api(`/api/broker-accounts/${encodeURIComponent(state.modalAccountId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountLabel, ...(apiKey ? { apiKey } : {}), ...(apiSecret ? { apiSecret } : {}) })
      });
      closeAccountModal();
      setText('trading-broker-action-status', 'Trading 212 account updated.');
      return;
    }

    await api('/api/broker-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'trading212', accountLabel, apiKey, apiSecret })
    });
    closeAccountModal();
    setText('trading-broker-action-status', 'Trading 212 account linked.');
  }

  async function handleUnifiedAction(action, accountId) {
    const account = createUnifiedAccounts().find((item) => item.id === accountId);
    if (!account) return;
    if (action === 'manage-account') {
      window.location.href = '/profile-manage.html';
      return;
    }
    if (action === 'edit-unified-account') {
      if (account.kind === 't212') return openAccountModal('edit', account.sourceId);
      return setText('trading-broker-action-status', 'Edit manual/imported accounts from Profile Manage.');
    }
    if (action === 'sync-unified-account') {
      if (account.kind === 't212') {
        await api(`/api/broker-accounts/${encodeURIComponent(account.sourceId)}/sync`, { method: 'POST' });
        return setText('trading-broker-action-status', 'Trading 212 account refresh requested.');
      }
      if (account.provider === 'ibkr') {
        await api('/api/integrations/ibkr/sync', { method: 'POST' });
        return setText('trading-broker-action-status', 'IBKR sync requested.');
      }
    }
    if (action === 'disconnect-unified-account') {
      if (account.kind === 't212') {
        await api(`/api/broker-accounts/${encodeURIComponent(account.sourceId)}`, { method: 'DELETE' });
        return setText('trading-broker-action-status', 'Trading 212 account disconnected.');
      }
      if (account.provider === 'ibkr') {
        await api('/api/integrations/ibkr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
        return setText('trading-broker-action-status', 'IBKR disconnected.');
      }
    }
    if (action === 'import-unified-account') {
      window.location.href = '/trades.html';
    }
  }

  async function handleAction(action, accountId) {
    if (action === 'open-add-account-modal') return openAddAccountModal();
    if (action === 'close-add-account-modal') return closeAddAccountModal();
    if (action === 'add-account-connect-broker') {
      closeAddAccountModal();
      setActiveTab('integrations');
      return;
    }
    if (action === 'add-account-manual') {
      closeAddAccountModal();
      return createManualAccount();
    }
    if (action === 'add-account-import' || action === 'import-account') {
      closeAddAccountModal();
      return window.location.assign('/trades.html');
    }
    if (action === 'open-integrations-tab') return setActiveTab('integrations');
    if (action === 'add-t212') return openAccountModal('add');
    if (action === 'sync-account') return api(`/api/broker-accounts/${encodeURIComponent(accountId)}/sync`, { method: 'POST' });
    if (action === 'disconnect-account') return api(`/api/broker-accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    if (action === 'edit-account') return openAccountModal('edit', accountId);
    if (action === 'close-account-modal') return closeAccountModal();
    if (action === 'connect-ibkr') {
      return api('/api/integrations/ibkr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    }
    if (action === 'sync-ibkr') return api('/api/integrations/ibkr/sync', { method: 'POST' });
    if (['manage-account', 'edit-unified-account', 'sync-unified-account', 'import-unified-account', 'disconnect-unified-account'].includes(action)) {
      return handleUnifiedAction(action, accountId);
    }
    return null;
  }

  document.body.addEventListener('click', async (event) => {
    if (event.target === modalElements.root) return closeAccountModal();
    if (event.target === addAccountModal) return closeAddAccountModal();

    const tabButton = event.target.closest('.trading-page-tab');
    if (tabButton) return setActiveTab(tabButton.dataset.tab || 'accounts');

    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const accountId = target.dataset.accountId || '';
    try {
      await handleAction(action, accountId);
      await refreshData();
    } catch (error) {
      setText('trading-broker-action-status', error.message || 'Action failed.');
    }
  });

  modalElements.form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await submitAccountModal();
      await refreshData();
    } catch (error) {
      setStatus('t212-account-modal-status', error.message || 'Unable to save account.', true);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (modalElements.root && !modalElements.root.classList.contains('hidden')) closeAccountModal();
    if (addAccountModal && !addAccountModal.classList.contains('hidden')) closeAddAccountModal();
  });

  try {
    setActiveTab('accounts');
    await refreshData();
  } catch (error) {
    setText('trading-broker-action-status', error.message || 'Unable to load trading accounts.');
  }
})();
