(function initSecurityPage() {
  const { api, setText } = window.AccountCenter;

  const state = {
    dashboard: null,
    settings: loadLocalSettings(),
    twoFactor: {
      setupLoading: false,
      setupId: '',
      backupCodes: [],
      lastError: ''
    }
  };

  function loadLocalSettings() {
    try {
      const raw = localStorage.getItem('security-dashboard-settings');
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        autoLogoutMinutes: Number(parsed.autoLogoutMinutes) || 30,
        loginAlerts: !!parsed.loginAlerts
      };
    } catch (_error) {
      return { autoLogoutMinutes: 30, loginAlerts: false };
    }
  }

  function saveLocalSettings() {
    localStorage.setItem('security-dashboard-settings', JSON.stringify(state.settings));
  }

  function formatDateTime(value) {
    if (!value) return 'Unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unavailable';
    return date.toLocaleString();
  }

  function passwordStrengthStatus(passwordUpdatedAt) {
    if (!passwordUpdatedAt) return { label: 'Weak', tone: 'risk' };
    const ageDays = (Date.now() - Date.parse(passwordUpdatedAt)) / (1000 * 60 * 60 * 24);
    if (ageDays > 365) return { label: 'Weak', tone: 'risk' };
    if (ageDays > 180) return { label: 'Moderate', tone: 'moderate' };
    return { label: 'Strong', tone: 'secure' };
  }

  function overallSecurityLabel(securityStatus) {
    if (securityStatus === 'good') return { label: 'Good', tone: 'secure' };
    if (securityStatus === 'moderate') return { label: 'Moderate', tone: 'moderate' };
    return { label: 'Weak', tone: 'risk' };
  }

  function setMetricStatus(id, label, tone) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = label;
    element.classList.remove('status-secure', 'status-moderate', 'status-risk', 'status-neutral');
    element.classList.add(tone ? `status-${tone}` : 'status-neutral');
  }

  function renderOverview() {
    const dashboard = state.dashboard;
    const overall = overallSecurityLabel(dashboard?.securityStatus);
    const passwordStatus = passwordStrengthStatus(dashboard?.passwordUpdatedAt);
    const twoFactorOn = !!dashboard?.twoFactorEnabled;
    setMetricStatus('security-status-level', overall.label, overall.tone);
    setMetricStatus('password-status-level', passwordStatus.label, passwordStatus.tone);
    setMetricStatus('two-factor-status', twoFactorOn ? 'Enabled' : 'Not enabled', twoFactorOn ? 'secure' : 'risk');
    setText('active-session-count', String(dashboard?.activeSessionCount ?? 0));
    setText('last-login-time', formatDateTime(dashboard?.lastLoginAt));
    setText('security-overview-updated', `Last refreshed: ${new Date().toLocaleTimeString()}`);
    setText('password-summary', `Password health: ${passwordStatus.label}`);
    setText('password-updated-time', `Last updated: ${formatDateTime(dashboard?.passwordUpdatedAt)}`);
    setText('two-factor-summary', twoFactorOn
      ? '2FA is enabled and reducing account takeover risk.'
      : '2FA is currently disabled. Enable it to protect against compromised passwords.');
    const button = document.getElementById('two-factor-toggle');
    if (button) button.textContent = twoFactorOn ? 'Disable 2FA' : 'Enable 2FA';
  }

  function parseUserAgent(userAgent) {
    if (!userAgent) return { device: 'Unknown device', browser: 'Unknown browser' };
    const browser = /Edg\//.test(userAgent) ? 'Edge'
      : /Chrome\//.test(userAgent) ? 'Chrome'
        : /Safari\//.test(userAgent) && !/Chrome\//.test(userAgent) ? 'Safari'
          : /Firefox\//.test(userAgent) ? 'Firefox'
            : 'Browser';
    const device = /Mobile|Android|iPhone|iPad/.test(userAgent) ? 'Mobile device' : 'Desktop device';
    return { device, browser };
  }

  function renderSessions() {
    const list = document.getElementById('security-session-list');
    if (!list) return;
    const sessions = Array.isArray(state.dashboard?.activeSessions) ? state.dashboard.activeSessions : [];
    if (!sessions.length) {
      list.innerHTML = '<p class="helper">No active session data available.</p>';
      return;
    }
    list.innerHTML = sessions.map((session) => {
      const parsed = parseUserAgent(session.userAgent);
      return `<article class="security-session-item">
        <div>
          <h3>${parsed.device}${session.current ? ' (Current)' : ''}</h3>
          <p class="helper">${parsed.browser} • Last active: ${formatDateTime(session.lastActiveAt)}</p>
          <p class="helper">IP: ${session.ip || 'Unavailable'}</p>
        </div>
        ${session.current ? '<span class="pill">Current session</span>' : `<button class="ghost small" type="button" data-session-token="${session.token}">Log out</button>`}
      </article>`;
    }).join('');
  }

  function renderActivity() {
    const list = document.getElementById('security-activity-list');
    if (!list) return;
    const items = Array.isArray(state.dashboard?.activity) ? state.dashboard.activity : [];
    if (!items.length) {
      list.innerHTML = '<li class="helper">No recent security events are available yet.</li>';
      return;
    }
    list.innerHTML = items.map((item) => `<li><strong>${item.detail}</strong><span>${formatDateTime(item.at)}</span></li>`).join('');
  }

  function renderAdvanced() {
    setText('session-protection-status', `${state.dashboard?.activeSessionCount || 0} active session(s) monitored.`);
    setText('auto-logout-status', `Auto logout after ${state.settings.autoLogoutMinutes} minutes of inactivity.`);
    setText('login-alerts-status', state.settings.loginAlerts ? 'Login alerts are enabled for this browser.' : 'Login alerts are disabled for this browser.');
  }

  async function refreshDashboard() {
    try {
      state.dashboard = await api('/api/account/security-dashboard');
      renderOverview();
      renderSessions();
      renderActivity();
      renderAdvanced();
    } catch (error) {
      setText('security-auth-status', error.message || 'Unable to load security data.');
    }
  }

  function toggleModal(show) {
    const modal = document.getElementById('two-factor-modal');
    if (!modal) return;
    modal.classList.toggle('hidden', !show);
    modal.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  function showTwoFactorStep(stepId) {
    document.querySelectorAll('.two-factor-step').forEach((el) => el.classList.add('hidden'));
    document.getElementById(stepId)?.classList.remove('hidden');
    setText('two-factor-modal-status', '');
  }

  function setTwoFactorStatus(message, isError = false) {
    const el = document.getElementById('two-factor-modal-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', !!isError);
  }

  async function apiWithTimeout(path, options = {}, timeoutMs = 15000) {
    const timeout = new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error('2FA setup timed out. Please try again.')), timeoutMs);
    });
    return Promise.race([api(path, options), timeout]);
  }

  function renderTwoFactorSetup(setup) {
    if (!setup || typeof setup !== 'object') {
      throw new Error('2FA setup payload is missing. Please try again.');
    }
    if (!setup.setupId) {
      throw new Error('2FA setup ID is missing. Please restart setup.');
    }

    const qrEl = document.getElementById('two-factor-qr');
    const secret = typeof setup.secret === 'string' ? setup.secret.trim() : '';
    const qrCodeUrl = typeof setup.qrCodeUrl === 'string' ? setup.qrCodeUrl.trim() : '';

    state.twoFactor.setupId = setup.setupId;
    if (qrEl) {
      qrEl.src = qrCodeUrl || '';
      qrEl.alt = qrCodeUrl ? '2FA QR code' : 'QR code unavailable for this setup';
      qrEl.classList.toggle('hidden', !qrCodeUrl);
    }
    setText('two-factor-secret', secret || 'Unavailable. Restart setup to generate a new manual key.');

    if (!qrCodeUrl && !secret) {
      throw new Error('2FA setup data was incomplete. Please try again.');
    }
  }

  function setTwoFactorToggleLoading(loading) {
    const button = document.getElementById('two-factor-toggle');
    if (!button) return;
    if (loading) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = 'Starting 2FA...';
      button.disabled = true;
      return;
    }
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
  }

  async function beginTwoFactorSetup() {
    if (state.twoFactor.setupLoading) return;
    state.twoFactor.setupLoading = true;
    state.twoFactor.lastError = '';
    showTwoFactorStep('two-factor-step-setup');
    toggleModal(true);
    setTwoFactorStatus('Preparing setup...');
    setTwoFactorToggleLoading(true);
    try {
      const setup = await apiWithTimeout('/api/security/2fa/setup', { method: 'POST' });
      renderTwoFactorSetup(setup);
      setTwoFactorStatus('Setup ready. Scan the QR code or use the manual key.', false);
    } catch (error) {
      state.twoFactor.lastError = error.message || 'Unable to begin 2FA setup.';
      setTwoFactorStatus(state.twoFactor.lastError, true);
      setText('security-auth-status', state.twoFactor.lastError);
    } finally {
      state.twoFactor.setupLoading = false;
      setTwoFactorToggleLoading(false);
    }
  }

  function resetTwoFactorModal() {
    state.twoFactor.setupId = '';
    state.twoFactor.backupCodes = [];
    state.twoFactor.lastError = '';
    document.getElementById('two-factor-code-input').value = '';
    document.getElementById('two-factor-backup-codes').value = '';
    const qrEl = document.getElementById('two-factor-qr');
    if (qrEl) {
      qrEl.src = '';
      qrEl.alt = '2FA QR code';
      qrEl.classList.remove('hidden');
    }
    setText('two-factor-secret', '');
    const confirm = document.getElementById('two-factor-backup-confirm');
    if (confirm) confirm.checked = false;
    const finish = document.getElementById('two-factor-finish');
    if (finish) finish.disabled = true;
    setTwoFactorStatus('');
    showTwoFactorStep('two-factor-step-setup');
  }

  function setButtonLoading(id, loading, label) {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (loading) {
      btn.dataset.originalLabel = btn.textContent;
      btn.textContent = label;
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.originalLabel || btn.textContent;
      btn.disabled = false;
    }
  }

  document.getElementById('security-save')?.addEventListener('click', async () => {
    const currentPassword = document.getElementById('security-current')?.value || '';
    const newPassword = document.getElementById('security-new')?.value || '';
    try {
      await api('/api/account/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword })
      });
      setText('security-auth-status', 'Password updated successfully.');
      document.getElementById('security-current').value = '';
      document.getElementById('security-new').value = '';
      await refreshDashboard();
    } catch (error) {
      setText('security-auth-status', error.message);
    }
  });

  document.getElementById('two-factor-toggle')?.addEventListener('click', async () => {
    try {
      if (state.dashboard?.twoFactorEnabled) {
        await api('/api/security/2fa/disable', { method: 'POST' });
        setText('security-auth-status', 'Two-factor authentication disabled.');
        await refreshDashboard();
        return;
      }
      await beginTwoFactorSetup();
    } catch (error) {
      setText('security-auth-status', error.message);
    }
  });

  document.getElementById('two-factor-modal-close')?.addEventListener('click', () => {
    toggleModal(false);
    resetTwoFactorModal();
  });

  document.getElementById('two-factor-modal')?.addEventListener('click', (event) => {
    if (event.target?.id === 'two-factor-modal') {
      toggleModal(false);
      resetTwoFactorModal();
    }
  });

  document.getElementById('two-factor-to-verify')?.addEventListener('click', () => {
    showTwoFactorStep('two-factor-step-verify');
    document.getElementById('two-factor-code-input')?.focus();
  });

  document.getElementById('two-factor-verify-btn')?.addEventListener('click', async () => {
    const code = (document.getElementById('two-factor-code-input')?.value || '').trim();
    if (!/^\d{6}$/.test(code)) {
      setTwoFactorStatus('Enter a valid 6-digit code.', true);
      return;
    }
    setButtonLoading('two-factor-verify-btn', true, 'Verifying...');
    try {
      const response = await api('/api/security/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupId: state.twoFactor.setupId, code })
      });
      state.twoFactor.backupCodes = response.backupCodes || [];
      document.getElementById('two-factor-backup-codes').value = state.twoFactor.backupCodes.join('\n');
      showTwoFactorStep('two-factor-step-backup');
      setTwoFactorStatus('2FA enabled. Save these backup codes before finishing.');
      await refreshDashboard();
    } catch (error) {
      setTwoFactorStatus(error.message || 'Verification failed.', true);
    } finally {
      setButtonLoading('two-factor-verify-btn', false, 'Verifying...');
    }
  });

  document.getElementById('two-factor-copy-codes')?.addEventListener('click', async () => {
    const raw = state.twoFactor.backupCodes.join('\n');
    if (!raw) return;
    try {
      await navigator.clipboard.writeText(raw);
      setTwoFactorStatus('Backup codes copied.');
    } catch (_error) {
      setTwoFactorStatus('Unable to copy automatically. Please copy manually.', true);
    }
  });

  document.getElementById('two-factor-download-codes')?.addEventListener('click', () => {
    const raw = state.twoFactor.backupCodes.join('\n');
    if (!raw) return;
    const blob = new Blob([raw], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'veracity-2fa-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
    setTwoFactorStatus('Backup codes downloaded.');
  });

  document.getElementById('two-factor-backup-confirm')?.addEventListener('change', (event) => {
    const target = event.target;
    document.getElementById('two-factor-finish').disabled = !target.checked;
  });

  document.getElementById('two-factor-finish')?.addEventListener('click', () => {
    toggleModal(false);
    resetTwoFactorModal();
    setText('security-auth-status', 'Two-factor authentication enabled successfully.');
  });

  document.getElementById('security-session-list')?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const token = target.getAttribute('data-session-token');
    if (!token) return;
    try {
      await api('/api/account/security/sessions/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      setText('security-session-status', 'Session logged out.');
      await refreshDashboard();
    } catch (error) {
      setText('security-session-status', error.message);
    }
  });

  document.getElementById('logout-others')?.addEventListener('click', async () => {
    try {
      await api('/api/account/security/sessions/logout-others', { method: 'POST' });
      setText('security-session-status', 'All other sessions have been logged out.');
      await refreshDashboard();
    } catch (error) {
      setText('security-session-status', error.message);
    }
  });

  document.getElementById('security-improve')?.addEventListener('click', () => {
    document.getElementById('two-factor-toggle')?.focus();
    setText('security-auth-status', 'Recommended: enable 2FA and rotate your password if it is old.');
  });

  document.getElementById('security-configure')?.addEventListener('click', () => {
    state.settings.loginAlerts = !state.settings.loginAlerts;
    state.settings.autoLogoutMinutes = state.settings.autoLogoutMinutes === 30 ? 15 : 30;
    saveLocalSettings();
    renderAdvanced();
    setText('security-advanced-status', 'Advanced protection settings updated for this browser.');
  });

  refreshDashboard();
})();
