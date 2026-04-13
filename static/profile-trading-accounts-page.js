(async function initTradingAccountsPage() {
  const { api, setText, setStatus } = window.AccountCenter;

  const state = {
    t212Accounts: [],
    ibkr: {},
    modalMode: 'add',
    modalAccountId: ''
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

  function prettyStatus(status, fallback = 'Unknown') {
    if (!status) return fallback;
    return String(status)
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char] || char
    ));
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
    wrapper.innerHTML = `
      ${renderProviderHeader()}
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
      const connectionStatus = prettyStatus(account.connectionStatus, 'Disconnected');
      const dataStatus = prettyStatus(account.syncStatus, 'Idle');
      const card = document.createElement('article');
      card.className = `broker-card broker-card--premium ${statusClass(account.connectionStatus)}`;
      card.innerHTML = `
        <header class="broker-card__head">
          <div class="broker-card__title-wrap">
            <h4>${escapeHtml(account.accountLabel || 'Trading 212 account')}</h4>
            <div class="broker-card__badges">
              <span class="broker-pill">Trading 212</span>
              <span class="broker-pill">${escapeHtml(account.accountType || 'Trading account')}</span>
              <span class="broker-pill ${statusClass(account.connectionStatus)}">${escapeHtml(connectionStatus)}</span>
              <span class="broker-pill">${escapeHtml(dataStatus)}</span>
            </div>
          </div>
        </header>
        <dl class="broker-meta-grid">
          <div><dt>Connection</dt><dd>${escapeHtml(connectionStatus)}</dd></div>
          <div><dt>Data status</dt><dd>${escapeHtml(dataStatus)}</dd></div>
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
    const latestT212 = state.t212Accounts
      .map((account) => Date.parse(account.lastSyncAt || ''))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    panel.innerHTML = `
      <div class="status-kv-group">
        <h3 class="status-kv-group__title">Trading 212</h3>
        <div class="status-kv-row"><span>Linked accounts</span><strong>${state.t212Accounts.length}</strong></div>
        <div class="status-kv-row"><span>Latest update</span><strong>${latestT212 ? new Date(latestT212).toLocaleString() : '—'}</strong></div>
      </div>
      <div class="status-kv-group">
        <h3 class="status-kv-group__title">IBKR</h3>
        <div class="status-kv-row"><span>Status</span><strong>${state.ibkr.enabled ? 'Connected' : 'Disconnected'}</strong></div>
        <div class="status-kv-row"><span>Last update</span><strong>${formatWhen(state.ibkr.lastSyncAt)}</strong></div>
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
    modalElements.apiKey.placeholder = isEdit ? 'Leave blank to keep current API key' : 'Paste Trading 212 API key';
    modalElements.apiSecret.placeholder = isEdit ? 'Leave blank to keep current API secret' : 'Paste Trading 212 API secret';
    modalElements.apiKeyHelper.textContent = isEdit
      ? 'Leave blank to keep your existing API key.'
      : 'Your API key is encrypted and only used for broker sync.';
    modalElements.apiSecretHelper.textContent = isEdit
      ? 'Leave blank to keep your existing API secret.'
      : 'Your API secret is stored securely and never shown in plain text.';
    setStatus('t212-account-modal-status', '', false);
    modalElements.root.classList.remove('hidden');
    modalElements.label.focus();
  }

  function closeAccountModal() {
    if (!modalElements.root) return;
    modalElements.root.classList.add('hidden');
    setStatus('t212-account-modal-status', '', false);
  }

  function validateModalPayload(payload, isEditMode) {
    if (!payload.accountLabel) return 'Account label is required.';
    if (!isEditMode && !payload.apiKey) return 'API key is required.';
    if (!isEditMode && !payload.apiSecret) return 'API secret is required.';
    return '';
  }

  async function submitAccountModal() {
    const isEditMode = state.modalMode === 'edit';
    const accountLabel = modalElements.label.value.trim();
    const apiKey = modalElements.apiKey.value.trim();
    const apiSecret = modalElements.apiSecret.value.trim();
    const validationError = validateModalPayload({ accountLabel, apiKey, apiSecret }, isEditMode);
    if (validationError) {
      setStatus('t212-account-modal-status', validationError, true);
      return;
    }
    if (isEditMode) {
      await api(`/api/broker-accounts/${encodeURIComponent(state.modalAccountId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountLabel,
          ...(apiKey ? { apiKey } : {}),
          ...(apiSecret ? { apiSecret } : {})
        })
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

  async function handleAction(action, accountId) {
    if (action === 'add-t212') return openAccountModal('add');
    if (action === 'sync-account') return api(`/api/broker-accounts/${encodeURIComponent(accountId)}/sync`, { method: 'POST' });
    if (action === 'disconnect-account') return api(`/api/broker-accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    if (action === 'edit-account') return openAccountModal('edit', accountId);
    if (action === 'close-account-modal') return closeAccountModal();
    if (action === 'connect-ibkr') {
      return api('/api/integrations/ibkr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    }
    if (action === 'sync-ibkr') return api('/api/integrations/ibkr/sync', { method: 'POST' });
    return null;
  }

  document.body.addEventListener('click', async (event) => {
    if (event.target === modalElements.root) {
      closeAccountModal();
      return;
    }
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const accountId = target.dataset.accountId || '';
    try {
      await handleAction(action, accountId);
      await refreshData();
      if (action === 'disconnect-account') setText('trading-broker-action-status', 'Trading 212 account disconnected.');
      if (action === 'sync-account') setText('trading-broker-action-status', 'Trading 212 account refresh requested.');
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
    if (event.key === 'Escape' && modalElements.root && !modalElements.root.classList.contains('hidden')) {
      closeAccountModal();
    }
  });

  try {
    await refreshData();
  } catch (error) {
    setText('trading-broker-action-status', error.message || 'Unable to load broker dashboard.');
  }
})();
