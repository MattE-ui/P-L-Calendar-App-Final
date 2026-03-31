(async function initSettingsPage() {
  const { api, setText, isGuestSession } = window.AccountCenter;

  function loadLocalPrefs() {
    try {
      return JSON.parse(localStorage.getItem('plc-prefs') || '{}');
    } catch (_error) {
      return {};
    }
  }

  const localPrefs = loadLocalPrefs();
  if (localPrefs.defaultRiskPct) document.getElementById('settings-risk').value = String(localPrefs.defaultRiskPct);
  if (localPrefs.defaultRiskCurrency) document.getElementById('settings-currency').value = localPrefs.defaultRiskCurrency;

  if (!isGuestSession()) {
    try {
      const prefs = await api('/api/prefs');
      if (prefs?.defaultRiskPct) document.getElementById('settings-risk').value = String(prefs.defaultRiskPct);
      if (prefs?.defaultRiskCurrency) document.getElementById('settings-currency').value = prefs.defaultRiskCurrency;
    } catch (_error) {
      // local fallback is enough
    }
  }

  document.getElementById('settings-save')?.addEventListener('click', async () => {
    const prefs = {
      defaultRiskPct: Number(document.getElementById('settings-risk').value),
      defaultRiskCurrency: document.getElementById('settings-currency').value
    };
    localStorage.setItem('plc-prefs', JSON.stringify(prefs));
    if (!isGuestSession()) {
      try {
        await api('/api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefs) });
      } catch (error) {
        setText('settings-status', `Saved locally; server sync failed: ${error.message}`);
        return;
      }
    }
    setText('settings-status', 'Preferences saved.');
  });
})();
