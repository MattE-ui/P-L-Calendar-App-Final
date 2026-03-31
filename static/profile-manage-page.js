(async function initManageProfile() {
  const { api, setText } = window.AccountCenter;
  let latestProfile = null;
  let profileLastChangedAt = null;

  function money(value) {
    const amount = Number(value || 0);
    return `£${Number.isFinite(amount) ? amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
  }

  function timestamp(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  }

  function relativeTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const diffMs = Date.now() - date.getTime();
    const absMinutes = Math.round(Math.abs(diffMs) / 60000);
    if (absMinutes < 1) return 'just now';
    if (absMinutes < 60) return `${absMinutes}m ${diffMs >= 0 ? 'ago' : 'from now'}`;
    const absHours = Math.round(absMinutes / 60);
    if (absHours < 24) return `${absHours}h ${diffMs >= 0 ? 'ago' : 'from now'}`;
    const absDays = Math.round(absHours / 24);
    return `${absDays}d ${diffMs >= 0 ? 'ago' : 'from now'}`;
  }

  function setStatusLine(id, message, type = 'neutral') {
    const line = document.getElementById(id);
    if (!line) return;
    line.textContent = message || '';
    line.classList.toggle('is-hidden', !message);
    line.classList.toggle('is-error', type === 'error');
    line.classList.toggle('is-success', type === 'success');
  }

  function setInputError(inputId, message) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      input.classList.add('input-invalid');
    } else {
      input.removeAttribute('aria-invalid');
      input.classList.remove('input-invalid');
    }
  }

  function setAvatar(profile) {
    const slot = document.getElementById('manage-avatar-preview');
    if (!slot) return;
    if (profile?.avatarUrl) {
      slot.innerHTML = `<img src="${profile.avatarUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      const initials = (profile?.avatarInitials || profile?.nickname || profile?.username || 'VT').slice(0, 2).toUpperCase();
      slot.textContent = initials;
    }
  }

  function setButtonLoading(buttonId, isLoading, idleText, loadingText) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    button.disabled = isLoading;
    button.textContent = isLoading ? loadingText : idleText;
    button.dataset.loading = isLoading ? 'true' : 'false';
  }

  let toastContainer;
  function ensureToastContainer() {
    if (toastContainer) return toastContainer;
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  function showToast(message, type = 'success') {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 180);
    }, 2200);
  }

  function resolveNotificationStatus() {
    if (typeof Notification === 'undefined') return 'Unsupported';
    if (Notification.permission === 'granted') return 'Enabled';
    if (Notification.permission === 'denied') return 'Blocked';
    return 'Not configured';
  }

  function getProfileHealth(profile, tradingCount = 0) {
    const checklist = [
      { key: 'username', ok: Boolean(profile?.username), label: 'username' },
      { key: 'nickname', ok: Boolean(String(profile?.nickname || '').trim()), label: 'nickname' },
      { key: 'avatar', ok: Boolean(profile?.avatarUrl), label: 'avatar' },
      { key: 'baseline', ok: Number.isFinite(Number(profile?.portfolio)) && Number.isFinite(Number(profile?.netDepositsTotal ?? profile?.initialNetDeposits)), label: 'portfolio baseline' },
      { key: 'broker', ok: tradingCount > 0, label: 'trading account' }
    ];
    const completed = checklist.filter((item) => item.ok).length;
    const percent = Math.round((completed / checklist.length) * 100);
    const missing = checklist.filter((item) => !item.ok).map((item) => item.label);
    let tone = 'attention';
    let label = `Profile ${percent}% complete`;
    if (percent === 100) {
      tone = 'healthy';
      label = 'Profile complete';
    } else if (percent >= 60) {
      tone = 'attention';
    } else {
      label = 'Setup incomplete';
    }
    return { percent, missing, tone, label };
  }

  function updateProfileHealth(profile, tradingCount = 0) {
    const health = getProfileHealth(profile, tradingCount);
    const badge = document.getElementById('manage-profile-health-badge');
    if (badge) {
      badge.textContent = health.label;
      badge.classList.toggle('manage-status-chip--healthy', health.tone === 'healthy');
      badge.classList.toggle('manage-status-chip--attention', health.tone !== 'healthy');
    }
    const missingText = health.missing.length
      ? `Missing: ${health.missing.slice(0, 3).join(', ')}${health.missing.length > 3 ? '…' : ''}.`
      : 'Everything needed for account readiness is configured.';
    setText('manage-profile-health-copy', missingText);
  }

  function resolveAutomationStatus(t212, ibkr) {
    const hasAnyEnabled = !!(t212?.enabled || ibkr?.enabled);
    if (!hasAnyEnabled) return 'Configurable';
    const states = [];
    if (t212?.enabled) states.push('T212 on');
    if (ibkr?.enabled) {
      states.push(ibkr?.connectionStatus === 'online' ? 'IBKR online' : 'IBKR enabled');
    }
    return states.join(' · ');
  }

  function updateAccountSummary(profile, tradingCount = 0, automation = {}) {
    const health = getProfileHealth(profile, tradingCount);
    setText('manage-summary-profile-status', health.percent === 100 ? 'Complete' : `${health.percent}% complete`);
    setText('manage-summary-trading-count', String(tradingCount));
    setText('manage-summary-investor-mode', profile?.investorAccountsEnabled ? 'Enabled' : 'Off');
    setText('manage-summary-automation', resolveAutomationStatus(automation.t212, automation.ibkr));
    setText('manage-summary-notifications', resolveNotificationStatus());
    const lastUpdatedRaw = profileLastChangedAt || profile?.updatedAt || profile?.lastUpdatedAt;
    const lastUpdatedLabel = lastUpdatedRaw ? `${timestamp(lastUpdatedRaw)} (${relativeTime(lastUpdatedRaw)})` : '—';
    setText('manage-summary-last-updated', lastUpdatedLabel);
    const syncAt = profile?.portfolioLastUpdatedAt || automation?.t212?.lastSyncAt || automation?.ibkr?.lastSyncAt || automation?.ibkr?.lastSnapshotAt;
    setText('manage-summary-portfolio-sync', syncAt ? `${timestamp(syncAt)} (${relativeTime(syncAt)})` : 'Not synced yet');
    const summaryPortfolio = profile?.portfolio || 0;
    const summaryNet = profile?.netDepositsTotal ?? profile?.initialNetDeposits ?? 0;
    setText('manage-summary-portfolio', money(summaryPortfolio));
    setText('manage-summary-net', money(summaryNet));
    const performanceCard = document.getElementById('manage-summary-performance-card');
    const performanceValue = Number(summaryPortfolio) - Number(summaryNet);
    if (performanceCard && Number.isFinite(performanceValue) && Number.isFinite(Number(summaryNet))) {
      const rate = Number(summaryNet) !== 0 ? (performanceValue / Number(summaryNet)) * 100 : null;
      setText('manage-summary-performance', money(performanceValue));
      setText('manage-summary-performance-rate', rate === null ? 'No % baseline' : `${rate >= 0 ? '+' : ''}${rate.toFixed(2)}%`);
      performanceCard.classList.remove('is-hidden');
      performanceCard.classList.toggle('is-positive', performanceValue >= 0);
      performanceCard.classList.toggle('is-negative', performanceValue < 0);
    }
    updateProfileHealth(profile, tradingCount);
  }

  async function load() {
    const [profile, tradingAccountsPayload, t212, ibkr] = await Promise.all([
      api('/api/profile'),
      api('/api/trading-accounts').catch(() => ({ accounts: [] })),
      api('/api/integrations/trading212').catch(() => ({})),
      api('/api/integrations/ibkr').catch(() => ({}))
    ]);
    latestProfile = profile;
    const tradingAccounts = Array.isArray(tradingAccountsPayload?.accounts) ? tradingAccountsPayload.accounts : [];

    document.getElementById('manage-username').value = profile.username || '';
    document.getElementById('manage-email').value = profile.username || '';
    document.getElementById('manage-nickname').value = profile.nickname || '';
    document.getElementById('manage-portfolio').value = Number(profile.portfolio || 0).toFixed(2);
    document.getElementById('manage-net').value = Number(profile.netDepositsTotal || profile.initialNetDeposits || 0).toFixed(2);
    setAvatar(profile);
    updateAccountSummary(profile, tradingAccounts.length, { t212, ibkr });
  }

  document.getElementById('manage-save-nickname')?.addEventListener('click', async () => {
    setInputError('manage-nickname', '');
    const nickname = document.getElementById('manage-nickname').value.trim();
    if (!nickname) {
      setInputError('manage-nickname', 'Nickname is required');
      setStatusLine('manage-identity-status', 'Nickname cannot be empty.', 'error');
      return;
    }
    if (nickname.length < 3) {
      setInputError('manage-nickname', 'Nickname must be at least 3 characters');
      setStatusLine('manage-identity-status', 'Nickname must be at least 3 characters.', 'error');
      return;
    }
    setButtonLoading('manage-save-nickname', true, 'Save nickname', 'Saving...');
    setStatusLine('manage-identity-status', 'Saving nickname…');
    try {
      await api('/api/account/nickname', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname }) });
      profileLastChangedAt = new Date().toISOString();
      setStatusLine('manage-identity-status', 'Nickname updated.', 'success');
      showToast('Nickname updated.', 'success');
      await load();
    } catch (error) {
      setStatusLine('manage-identity-status', error.message, 'error');
      showToast(error.message, 'error');
    } finally {
      setButtonLoading('manage-save-nickname', false, 'Save nickname', 'Saving...');
    }
  });

  document.getElementById('manage-avatar-upload')?.addEventListener('click', () => document.getElementById('manage-avatar-input')?.click());
  document.getElementById('manage-avatar-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setButtonLoading('manage-avatar-upload', true, 'Upload avatar', 'Uploading...');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api('/api/profile/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: reader.result }) });
        profileLastChangedAt = new Date().toISOString();
        setStatusLine('manage-avatar-status', 'Avatar updated.', 'success');
        showToast('Avatar updated.', 'success');
        await load();
      } catch (error) {
        setStatusLine('manage-avatar-status', error.message, 'error');
        showToast(error.message, 'error');
      } finally {
        setButtonLoading('manage-avatar-upload', false, 'Upload avatar', 'Uploading...');
      }
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('manage-avatar-remove')?.addEventListener('click', async () => {
    setButtonLoading('manage-avatar-remove', true, 'Remove avatar', 'Removing...');
    try {
      await api('/api/profile/avatar', { method: 'DELETE' });
      profileLastChangedAt = new Date().toISOString();
      setStatusLine('manage-avatar-status', 'Avatar removed.', 'success');
      showToast('Avatar removed.', 'info');
      await load();
    } catch (error) {
      setStatusLine('manage-avatar-status', error.message, 'error');
      showToast(error.message, 'error');
    } finally {
      setButtonLoading('manage-avatar-remove', false, 'Remove avatar', 'Removing...');
    }
  });

  document.getElementById('manage-save-baseline')?.addEventListener('click', async () => {
    setInputError('manage-portfolio', '');
    setInputError('manage-net', '');
    const portfolio = Number(document.getElementById('manage-portfolio').value);
    const netDeposits = Number(document.getElementById('manage-net').value);
    if (!Number.isFinite(portfolio) || portfolio < 0) {
      setInputError('manage-portfolio', 'Portfolio value must be a non-negative number');
      setStatusLine('manage-baseline-status', 'Portfolio value must be a non-negative number.', 'error');
      return;
    }
    if (!Number.isFinite(netDeposits)) {
      setInputError('manage-net', 'Net deposits must be a valid number');
      setStatusLine('manage-baseline-status', 'Net deposits must be a valid number.', 'error');
      return;
    }
    setButtonLoading('manage-save-baseline', true, 'Save baseline', 'Saving...');
    setStatusLine('manage-baseline-status', 'Saving baseline…');
    try {
      await api('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portfolio, netDeposits }) });
      profileLastChangedAt = new Date().toISOString();
      setStatusLine('manage-baseline-status', 'Portfolio baseline saved.', 'success');
      showToast('Portfolio baseline saved.', 'success');
      if (latestProfile) {
        latestProfile.portfolio = portfolio;
        latestProfile.netDepositsTotal = netDeposits;
      }
      await load();
    } catch (error) {
      setStatusLine('manage-baseline-status', error.message, 'error');
      showToast(error.message, 'error');
    } finally {
      setButtonLoading('manage-save-baseline', false, 'Save baseline', 'Saving...');
    }
  });

  load().catch((error) => setStatusLine('manage-baseline-status', error.message, 'error'));
})();
