(async function initTradingAccountsPage() {
  const { api, setText } = window.AccountCenter;
  let accounts = [];

  function render() {
    const list = document.getElementById('trading-accounts-list');
    if (!list) return;
    list.innerHTML = '';
    if (!accounts.length) {
      list.innerHTML = '<p class="helper">No trading accounts yet. Add one to connect Trading 212 or IBKR.</p>';
      return;
    }
    accounts.forEach((account, index) => {
      const row = document.createElement('div');
      row.className = 'profile-field';
      row.innerHTML = `
        <label>Account ${index + 1}</label>
        <input data-key="label" data-id="${account.id}" type="text" value="${account.label || ''}">
        <select data-key="integrationProvider" data-id="${account.id}">
          <option value="">No broker linked</option>
          <option value="trading212" ${account.integrationProvider === 'trading212' ? 'selected' : ''}>Trading 212</option>
          <option value="ibkr" ${account.integrationProvider === 'ibkr' ? 'selected' : ''}>IBKR</option>
        </select>
        <label class="toggle"><input data-key="integrationEnabled" data-id="${account.id}" type="checkbox" ${account.integrationEnabled ? 'checked' : ''}><span>Connection enabled</span></label>
      `;
      list.appendChild(row);
    });
  }

  document.getElementById('trading-accounts-list')?.addEventListener('input', (event) => {
    const target = event.target;
    const id = target.dataset.id;
    const key = target.dataset.key;
    const account = accounts.find(item => item.id === id);
    if (!account || !key) return;
    account[key] = target.type === 'checkbox' ? target.checked : target.value;
  });

  document.getElementById('trading-add-account')?.addEventListener('click', () => {
    accounts.push({ id: `custom-${Date.now()}`, label: `Account ${accounts.length + 1}`, integrationProvider: null, integrationEnabled: false });
    render();
  });

  document.getElementById('trading-save-accounts')?.addEventListener('click', async () => {
    try {
      await api('/api/account/trading-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, accounts })
      });
      setText('trading-save-status', 'Trading accounts saved.');
    } catch (error) { setText('trading-save-status', error.message); }
  });

  try {
    const payload = await api('/api/account/trading-accounts');
    accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    render();
    const t212 = await api('/api/integrations/trading212').catch(() => ({}));
    const ibkr = await api('/api/integrations/ibkr').catch(() => ({}));
    const syncBits = [];
    syncBits.push(`Trading 212: ${t212?.enabled ? 'connected' : 'not connected'}`);
    syncBits.push(`IBKR: ${ibkr?.enabled ? 'connected' : 'not connected'}`);
    setText('trading-sync-status', syncBits.join(' · '));
  } catch (error) {
    setText('trading-sync-status', error.message);
  }
})();
