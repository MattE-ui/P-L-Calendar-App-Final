(async function initManageProfile() {
  const { api, setText } = window.AccountCenter;
  let latestProfile = null;

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
    return 'Prompt';
  }

  function profileComplete(profile) {
    const required = [profile?.username, profile?.nickname, profile?.portfolio, profile?.netDepositsTotal ?? profile?.initialNetDeposits];
    return required.every((value) => value !== null && value !== undefined && `${value}`.trim() !== '');
  }

  function updateAccountSummary(profile, tradingCount = 0) {
    setText('manage-summary-profile-status', profileComplete(profile) ? 'Complete' : 'Incomplete');
    setText('manage-summary-trading-count', String(tradingCount));
    setText('manage-summary-investor-mode', profile?.investorAccountsEnabled ? 'Enabled' : 'Off');
    setText('manage-summary-notifications', resolveNotificationStatus());
    setText('manage-summary-last-updated', timestamp(profile?.updatedAt || profile?.lastUpdatedAt));
    const summaryPortfolio = profile?.portfolio || 0;
    const summaryNet = profile?.netDepositsTotal ?? profile?.initialNetDeposits ?? 0;
    setText('manage-summary-portfolio', money(summaryPortfolio));
    setText('manage-summary-net', money(summaryNet));
  }

  async function load() {
    const [profile, tradingAccountsPayload] = await Promise.all([
      api('/api/profile'),
      api('/api/trading-accounts').catch(() => ({ accounts: [] }))
    ]);
    latestProfile = profile;
    const tradingAccounts = Array.isArray(tradingAccountsPayload?.accounts) ? tradingAccountsPayload.accounts : [];

    document.getElementById('manage-username').value = profile.username || '';
    document.getElementById('manage-email').value = profile.username || '';
    document.getElementById('manage-nickname').value = profile.nickname || '';
    document.getElementById('manage-portfolio').value = Number(profile.portfolio || 0).toFixed(2);
    document.getElementById('manage-net').value = Number(profile.netDepositsTotal || profile.initialNetDeposits || 0).toFixed(2);
    setAvatar(profile);
    updateAccountSummary(profile, tradingAccounts.length);
  }

  document.getElementById('manage-save-nickname')?.addEventListener('click', async () => {
    setButtonLoading('manage-save-nickname', true, 'Save nickname', 'Saving...');
    try {
      const nickname = document.getElementById('manage-nickname').value.trim();
      await api('/api/account/nickname', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname }) });
      setText('manage-identity-status', 'Nickname updated.');
      showToast('Nickname updated.', 'success');
      await load();
    } catch (error) {
      setText('manage-identity-status', error.message);
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
        setText('manage-avatar-status', 'Avatar updated.');
        showToast('Avatar updated.', 'success');
        await load();
      } catch (error) {
        setText('manage-avatar-status', error.message);
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
      setText('manage-avatar-status', 'Avatar removed.');
      showToast('Avatar removed.', 'info');
      await load();
    } catch (error) {
      setText('manage-avatar-status', error.message);
      showToast(error.message, 'error');
    } finally {
      setButtonLoading('manage-avatar-remove', false, 'Remove avatar', 'Removing...');
    }
  });

  document.getElementById('manage-save-baseline')?.addEventListener('click', async () => {
    setButtonLoading('manage-save-baseline', true, 'Save baseline', 'Saving...');
    try {
      const portfolio = Number(document.getElementById('manage-portfolio').value);
      const netDeposits = Number(document.getElementById('manage-net').value);
      await api('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portfolio, netDeposits }) });
      setText('manage-baseline-status', 'Portfolio baseline saved.');
      showToast('Portfolio baseline saved.', 'success');
      if (latestProfile) {
        latestProfile.portfolio = portfolio;
        latestProfile.netDepositsTotal = netDeposits;
      }
      await load();
    } catch (error) {
      setText('manage-baseline-status', error.message);
      showToast(error.message, 'error');
    } finally {
      setButtonLoading('manage-save-baseline', false, 'Save baseline', 'Saving...');
    }
  });

  load().catch((error) => setText('manage-baseline-status', error.message));
})();
