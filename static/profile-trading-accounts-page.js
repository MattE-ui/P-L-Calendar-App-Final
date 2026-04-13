(async function initTradingAccountsPage() {
  const { api, setText, setStatus } = window.AccountCenter;

  const state = {
    t212Accounts: [],
    tradingAccounts: [],
    ibkr: {},
    resolvedAccounts: [],
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
    accountType: document.getElementById('t212-account-type-input'),
    brokerLabel: document.getElementById('t212-broker-label-input'),
    providerStatus: document.getElementById('t212-provider-status'),
    apiKeyWrap: document.getElementById('t212-api-key-wrap'),
    apiSecretWrap: document.getElementById('t212-api-secret-wrap'),
    providerStatusWrap: document.getElementById('t212-provider-status-wrap'),
    apiKey: document.getElementById('t212-api-key-input'),
    apiSecret: document.getElementById('t212-api-secret-input'),
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

  function normalizeLabel(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function normalizeDataSource(account = {}) {
    if (account?.dataSource) return account.dataSource;
    if (account?.source === 'imported' || account?.imported || account?.importSource) return 'imported';
    const provider = String(account.integrationProvider || '').toLowerCase();
    if (provider === 'trading212' && account.integrationEnabled !== false) return 'automated';
    if (provider === 'ibkr' && account.integrationEnabled !== false) return 'automated';
    return 'manual';
  }

  function accountIdentityKey({ providerAccountId, linkedLocalAccountId, broker, accountName, accountType }) {
    if (providerAccountId) return `provider:${providerAccountId}`;
    if (linkedLocalAccountId) return `local:${linkedLocalAccountId}`;
    return `fallback:${normalizeLabel(broker)}|${normalizeLabel(accountName)}|${normalizeLabel(accountType || 'trading account')}`;
  }

  function resolveAccountsForView() {
    const localAccounts = Array.isArray(state.tradingAccounts) ? state.tradingAccounts : [];
    const integrationAccounts = Array.isArray(state.t212Accounts) ? state.t212Accounts : [];
    const merged = new Map();
    const stats = {
      localCount: localAccounts.length,
      integrationCount: integrationAccounts.length,
      mergeMatches: 0,
      unmatchedLocal: 0,
      unmatchedIntegration: 0
    };

    localAccounts.forEach((local) => {
      const provider = local.integrationProvider === 'trading212' ? 'Trading 212' : local.integrationProvider === 'ibkr' ? 'IBKR' : (local.brokerDisplayLabel || 'Manual');
      const dataSource = normalizeDataSource(local);
      const key = accountIdentityKey({
        providerAccountId: local.providerAccountId || local.linkedBrokerAccountId,
        linkedLocalAccountId: local.id,
        broker: provider,
        accountName: local.label,
        accountType: local.accountType || 'Trading account'
      });
      merged.set(key, {
        id: `resolved:${local.id}`,
        name: local.label || 'Trading account',
        broker,
        accountType: local.accountType || 'Trading account',
        portfolioValue: Number.isFinite(Number(local.currentValue)) ? Number(local.currentValue) : null,
        lastUpdated: state.ibkr.lastSyncAt || null,
        dataSource: {
          type: dataSource,
          provider: local.integrationProvider || undefined,
          connectionId: local.linkedBrokerAccountId || null,
          providerAccountId: local.providerAccountId || null
        },
        actions: {
          canManage: true,
          canEdit: true,
          canSync: dataSource === 'automated',
          canDisconnect: dataSource === 'automated',
          canImport: dataSource !== 'automated'
        },
        localAccountId: local.id,
        brokerAccountId: local.linkedBrokerAccountId || null,
        connectionStatus: null
      });
    });

    integrationAccounts.forEach((integration) => {
      const keyCandidates = [
        accountIdentityKey({
          providerAccountId: integration.providerAccountId || integration.brokerAccountId,
          linkedLocalAccountId: integration.linkedTradingAccountId || integration.providerMetadata?.linkedTradingAccountId,
          broker: 'Trading 212',
          accountName: integration.accountLabel,
          accountType: integration.accountType || 'Trading account'
        }),
        accountIdentityKey({
          providerAccountId: null,
          linkedLocalAccountId: integration.linkedTradingAccountId || integration.providerMetadata?.linkedTradingAccountId,
          broker: 'Trading 212',
          accountName: integration.accountLabel,
          accountType: integration.accountType || 'Trading account'
        }),
        accountIdentityKey({
          providerAccountId: null,
          linkedLocalAccountId: null,
          broker: 'Trading 212',
          accountName: integration.accountLabel,
          accountType: integration.accountType || 'Trading account'
        })
      ];

      const matchKey = keyCandidates.find((candidate) => merged.has(candidate));
      if (matchKey) {
        stats.mergeMatches += 1;
        const current = merged.get(matchKey);
        merged.set(matchKey, {
          ...current,
          broker: 'Trading 212',
          accountType: current.accountType || integration.accountType || 'Trading account',
          portfolioValue: current.portfolioValue,
          lastUpdated: integration.lastSyncAt || current.lastUpdated,
          dataSource: {
            type: 'automated',
            provider: 'trading212',
            connectionId: integration.brokerAccountId || null,
            providerAccountId: integration.providerAccountId || integration.brokerAccountId || null
          },
          actions: {
            canManage: true,
            canEdit: true,
            canSync: true,
            canDisconnect: true,
            canImport: false
          },
          brokerAccountId: integration.brokerAccountId || current.brokerAccountId,
          providerConnectionStatus: integration.connectionStatus || null
        });
        return;
      }

      const fallbackKey = keyCandidates[keyCandidates.length - 1];
      merged.set(fallbackKey, {
        id: `resolved:t212:${integration.brokerAccountId}`,
        name: integration.accountLabel || 'Trading 212 account',
        broker: 'Trading 212',
        accountType: integration.accountType || 'Trading account',
        portfolioValue: null,
        lastUpdated: integration.lastSyncAt || null,
        dataSource: {
          type: 'automated',
          provider: 'trading212',
          connectionId: integration.brokerAccountId || null,
          providerAccountId: integration.providerAccountId || integration.brokerAccountId || null
        },
        actions: {
          canManage: true,
          canEdit: true,
          canSync: true,
          canDisconnect: true,
          canImport: false
        },
        localAccountId: null,
        brokerAccountId: integration.brokerAccountId,
        providerConnectionStatus: integration.connectionStatus || null
      });
      stats.unmatchedIntegration += 1;
    });

    merged.forEach((item) => {
      if (item.localAccountId && !item.brokerAccountId && item.dataSource.provider === 'trading212' && item.dataSource.type === 'automated') {
        stats.unmatchedLocal += 1;
      }
    });

    const resolved = Array.from(merged.values());
    console.debug('[TradingAccounts][resolve]', {
      localAccountCount: stats.localCount,
      integrationAccountCount: stats.integrationCount,
      resolvedAccountCount: resolved.length,
      mergeMatchesFound: stats.mergeMatches,
      unmatchedLocalRecords: stats.unmatchedLocal,
      unmatchedIntegrationRecords: stats.unmatchedIntegration
    });
    return resolved;
  }

  async function persistTradingAccounts(accounts) {
    await api('/api/account/trading-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, accounts })
    });
  }

  async function reconcileStaleLinkedState() {
    const localAccounts = Array.isArray(state.tradingAccounts) ? state.tradingAccounts : [];
    const integrationAccounts = Array.isArray(state.t212Accounts) ? state.t212Accounts : [];
    if (!localAccounts.length) return false;
    const activeIntegrationIds = new Set(integrationAccounts.map((item) => item.brokerAccountId).filter(Boolean));
    let changed = false;
    const repaired = localAccounts.map((account) => {
      if (!(account.integrationProvider === 'trading212' && account.integrationEnabled)) return account;
      const linkedId = account.linkedBrokerAccountId || account.providerAccountId;
      const hasIntegration = linkedId
        ? activeIntegrationIds.has(linkedId)
        : integrationAccounts.some((item) => normalizeLabel(item.accountLabel) === normalizeLabel(account.label));
      if (hasIntegration) return account;
      changed = true;
      return {
        ...account,
        integrationProvider: null,
        integrationEnabled: false,
        linkedBrokerAccountId: '',
        providerAccountId: ''
      };
    });
    if (!changed) return false;
    console.debug('[TradingAccounts][reconcile] removing stale linked-provider state from local records');
    await persistTradingAccounts(repaired);
    return true;
  }

  function renderAccountsList() {
    const root = document.getElementById('trading-accounts-grid');
    if (!root) return;
    const accounts = state.resolvedAccounts;
    root.innerHTML = '';

    if (!accounts.length) {
      root.innerHTML = '<p class="helper">No trading accounts yet. Add an account to get started.</p>';
      return;
    }

    accounts.forEach((account) => {
      const card = document.createElement('article');
      card.className = 'trading-account-card';
      const sourceLabel = account.dataSource.type.charAt(0).toUpperCase() + account.dataSource.type.slice(1);
      card.innerHTML = `
        <header class="trading-account-card__header">
          <h3>${escapeHtml(account.name)}</h3>
          <span class="data-source-badge is-${escapeHtml(account.dataSource.type)}">${escapeHtml(sourceLabel)}</span>
        </header>
        <dl class="broker-meta-grid">
          <div><dt>Broker</dt><dd>${escapeHtml(account.broker)}</dd></div>
          <div><dt>Account type</dt><dd>${escapeHtml(account.accountType || 'Trading account')}</dd></div>
          <div><dt>Portfolio value</dt><dd>${formatMoney(account.portfolioValue)}</dd></div>
          <div><dt>Last updated</dt><dd>${formatWhen(account.lastUpdated)}</dd></div>
        </dl>
        <div class="broker-card__actions">
          <button type="button" class="ghost" data-action="manage-account" data-account-id="${escapeHtml(account.id)}">Manage</button>
          <button type="button" class="ghost" data-action="edit-unified-account" data-account-id="${escapeHtml(account.id)}">Edit</button>
          ${account.actions.canSync ? `<button type="button" class="primary" data-action="sync-unified-account" data-account-id="${escapeHtml(account.id)}">Sync</button>` : ''}
          ${account.actions.canImport ? `<button type="button" class="ghost" data-action="import-unified-account" data-account-id="${escapeHtml(account.id)}">Import</button>` : ''}
          ${account.actions.canDisconnect ? `<button type="button" class="danger" data-action="disconnect-unified-account" data-account-id="${escapeHtml(account.id)}">Disconnect</button>` : ''}
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

    const staleFixed = await reconcileStaleLinkedState();
    if (staleFixed) {
      const refreshed = await api('/api/account/trading-accounts').catch(() => ({ accounts: [] }));
      state.tradingAccounts = Array.isArray(refreshed.accounts) ? refreshed.accounts : [];
    }

    state.resolvedAccounts = resolveAccountsForView();
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
    const resolved = isEdit ? state.resolvedAccounts.find((item) => item.id === accountId) : null;
    const integration = isEdit ? state.t212Accounts.find((row) => row.brokerAccountId === (resolved?.brokerAccountId || accountId)) : null;
    const editingAutomated = !!integration || resolved?.dataSource?.provider === 'trading212';

    modalElements.title.textContent = isEdit ? 'Edit account' : 'Add Trading 212 account';
    modalElements.subtitle.textContent = isEdit
      ? 'Update account metadata. Provider credentials are optional unless you need to rotate keys.'
      : 'Connect a Trading 212 account with secure API credentials.';
    modalElements.submit.textContent = isEdit ? 'Save changes' : 'Save account';

    modalElements.label.value = integration?.accountLabel || resolved?.name || '';
    modalElements.accountType.value = integration?.accountType || resolved?.accountType || 'Trading account';
    modalElements.brokerLabel.value = resolved?.broker || 'Trading 212';
    modalElements.apiKey.value = '';
    modalElements.apiSecret.value = '';

    modalElements.apiKeyWrap?.classList.toggle('hidden', isEdit && !editingAutomated);
    modalElements.apiSecretWrap?.classList.toggle('hidden', isEdit && !editingAutomated);
    modalElements.providerStatusWrap?.classList.toggle('hidden', !(isEdit && editingAutomated));
    modalElements.providerStatus.textContent = editingAutomated
      ? `${integration?.connectionStatus || resolved?.providerConnectionStatus || 'Connected'} · ${integration?.syncStatus || 'Idle'}`
      : 'Manual account';

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
      accountType: 'Trading account',
      brokerDisplayLabel: 'Manual',
      currentValue: Number.isFinite(value) && value >= 0 ? value : 0,
      currentNetDeposits: 0,
      integrationProvider: null,
      integrationEnabled: false,
      linkedBrokerAccountId: '',
      providerAccountId: ''
    });
    await persistTradingAccounts(accounts);
    setText('trading-broker-action-status', 'Manual account created.');
  }

  async function updateLocalAccount(accountId, patch) {
    const accounts = Array.isArray(state.tradingAccounts) ? [...state.tradingAccounts] : [];
    const next = accounts.map((account) => (account.id === accountId ? { ...account, ...patch } : account));
    await persistTradingAccounts(next);
  }

  async function submitAccountModal() {
    const isEditMode = state.modalMode === 'edit';
    const accountLabel = modalElements.label.value.trim();
    const accountType = modalElements.accountType.value.trim() || 'Trading account';
    const brokerDisplayLabel = modalElements.brokerLabel.value.trim();
    const apiKey = modalElements.apiKey.value.trim();
    const apiSecret = modalElements.apiSecret.value.trim();
    if (!accountLabel) return setStatus('t212-account-modal-status', 'Account label is required.', true);

    if (isEditMode) {
      const resolved = state.resolvedAccounts.find((item) => item.id === state.modalAccountId);
      if (!resolved) return setStatus('t212-account-modal-status', 'Account no longer exists.', true);

      if (resolved.brokerAccountId && resolved.dataSource.provider === 'trading212') {
        await api(`/api/broker-accounts/${encodeURIComponent(resolved.brokerAccountId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountLabel, accountType, ...(apiKey ? { apiKey } : {}), ...(apiSecret ? { apiSecret } : {}) })
        });
      }

      if (resolved.localAccountId) {
        await updateLocalAccount(resolved.localAccountId, {
          label: accountLabel,
          accountType,
          brokerDisplayLabel,
          linkedBrokerAccountId: resolved.brokerAccountId || '',
          providerAccountId: resolved.dataSource.providerAccountId || resolved.brokerAccountId || ''
        });
      }
      closeAccountModal();
      setText('trading-broker-action-status', 'Account updated.');
      return;
    }

    if (!apiKey) return setStatus('t212-account-modal-status', 'API key is required.', true);
    if (!apiSecret) return setStatus('t212-account-modal-status', 'API secret is required.', true);

    const created = await api('/api/broker-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'trading212', accountLabel, apiKey, apiSecret })
    });

    const accounts = Array.isArray(state.tradingAccounts) ? [...state.tradingAccounts] : [];
    accounts.push({
      id: `linked-${Date.now()}`,
      label: accountLabel,
      accountType,
      brokerDisplayLabel: brokerDisplayLabel || 'Trading 212',
      currentValue: 0,
      currentNetDeposits: 0,
      integrationProvider: 'trading212',
      integrationEnabled: true,
      linkedBrokerAccountId: created?.account?.brokerAccountId || '',
      providerAccountId: created?.account?.brokerAccountId || ''
    });
    await persistTradingAccounts(accounts);

    closeAccountModal();
    setText('trading-broker-action-status', 'Trading 212 account linked.');
  }

  async function disconnectResolvedAccount(account) {
    if (account.brokerAccountId && account.dataSource.provider === 'trading212') {
      await api(`/api/broker-accounts/${encodeURIComponent(account.brokerAccountId)}`, { method: 'DELETE' });
    }

    if (account.localAccountId) {
      await updateLocalAccount(account.localAccountId, {
        integrationProvider: null,
        integrationEnabled: false,
        linkedBrokerAccountId: '',
        providerAccountId: ''
      });
    }
  }

  async function handleUnifiedAction(action, accountId) {
    const account = state.resolvedAccounts.find((item) => item.id === accountId);
    if (!account) return;
    if (action === 'manage-account') {
      window.location.href = '/profile/manage';
      return;
    }
    if (action === 'edit-unified-account') {
      return openAccountModal('edit', account.id);
    }
    if (action === 'sync-unified-account') {
      if (account.dataSource.provider === 'trading212' && account.brokerAccountId) {
        await api(`/api/broker-accounts/${encodeURIComponent(account.brokerAccountId)}/sync`, { method: 'POST' });
        return setText('trading-broker-action-status', 'Trading 212 account refresh requested.');
      }
      if (account.dataSource.provider === 'ibkr') {
        await api('/api/integrations/ibkr/sync', { method: 'POST' });
        return setText('trading-broker-action-status', 'IBKR sync requested.');
      }
    }
    if (action === 'disconnect-unified-account') {
      await disconnectResolvedAccount(account);
      return setText('trading-broker-action-status', 'Account disconnected and reconciled.');
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
    if (action === 'disconnect-account') {
      const resolved = state.resolvedAccounts.find((item) => item.brokerAccountId === accountId);
      if (resolved) return disconnectResolvedAccount(resolved);
      return api(`/api/broker-accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    }
    if (action === 'edit-account') {
      const resolved = state.resolvedAccounts.find((item) => item.brokerAccountId === accountId);
      return openAccountModal('edit', resolved?.id || `resolved:t212:${accountId}`);
    }
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
