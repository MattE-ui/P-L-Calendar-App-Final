(async function initInvestorAccountsPage() {
  const { api, setText } = window.AccountCenter;
  try {
    const profile = await api('/api/profile');
    const toggle = document.getElementById('investor-enabled');
    if (toggle) toggle.checked = !!profile.investorAccountsEnabled;
  } catch (error) {
    setText('investor-status', error.message);
  }

  document.getElementById('investor-save')?.addEventListener('click', async () => {
    try {
      const enabled = !!document.getElementById('investor-enabled')?.checked;
      await api('/api/account/investor-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
      setText('investor-status', enabled ? 'Investor mode enabled.' : 'Investor mode disabled.');
    } catch (error) {
      setText('investor-status', error.message);
    }
  });

  try {
    const payload = await api('/api/master/investors');
    const list = document.getElementById('investor-list');
    const investors = Array.isArray(payload?.investors) ? payload.investors : [];
    list.innerHTML = investors.length
      ? investors.map(inv => `<p>${inv.displayName || inv.email || inv.id} · ${inv.status || 'active'}</p>`).join('')
      : '<p class="helper">No investor accounts found.</p>';
  } catch (_error) {
    const list = document.getElementById('investor-list');
    if (list) list.innerHTML = '<p class="helper">Investor list is available after master access is enabled.</p>';
  }
})();
