(function initSecurityPage() {
  const { api, setText } = window.AccountCenter;

  const state = {
    dashboard: null,
    settings: loadLocalSettings()
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
      const next = !state.dashboard?.twoFactorEnabled;
      await api('/api/account/security/two-factor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next })
      });
      setText('security-auth-status', `Two-factor authentication ${next ? 'enabled' : 'disabled'}.`);
      await refreshDashboard();
    } catch (error) {
      setText('security-auth-status', error.message);
    }
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
