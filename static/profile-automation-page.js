(async function initAutomationPage() {
  const { api, setText } = window.AccountCenter;

  async function load() {
    const t212 = await api('/api/integrations/trading212').catch(() => ({}));
    const ibkr = await api('/api/integrations/ibkr').catch(() => ({}));
    const enabledToggle = document.getElementById('auto-t212-enabled');
    const modeSelect = document.getElementById('auto-t212-mode');
    if (enabledToggle) enabledToggle.checked = !!t212?.enabled;
    if (modeSelect && t212?.mode) modeSelect.value = t212.mode;
    setText('auto-t212-status', t212?.lastStatus ? `Last Trading 212 sync status: ${t212.lastStatus}` : 'Trading 212 automation ready.');
    setText('auto-ibkr-status', ibkr?.connectionStatus ? `IBKR connector: ${ibkr.connectionStatus}` : 'IBKR connector status unavailable.');
  }

  document.getElementById('auto-save-t212')?.addEventListener('click', async () => {
    try {
      const enabled = !!document.getElementById('auto-t212-enabled')?.checked;
      const mode = document.getElementById('auto-t212-mode')?.value || 'live';
      await api('/api/integrations/trading212', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, mode }) });
      setText('auto-t212-status', 'Trading 212 automation settings saved.');
    } catch (error) { setText('auto-t212-status', error.message); }
  });

  document.getElementById('auto-run-t212')?.addEventListener('click', async () => {
    try {
      await api('/api/integrations/trading212', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runNow: true }) });
      setText('auto-t212-status', 'Trading 212 sync triggered.');
    } catch (error) { setText('auto-t212-status', error.message); }
  });

  document.getElementById('auto-refresh-ibkr')?.addEventListener('click', () => load());

  load().catch((error) => setText('auto-t212-status', error.message));
})();
