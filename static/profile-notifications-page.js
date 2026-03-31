(async function initNotificationsPage() {
  const { api, setText, setStatus } = window.AccountCenter;

  const ALERT_GROUPS = [
    {
      key: 'criticalRiskAlerts',
      title: 'Critical alerts',
      description: 'Risk breaches and high-priority failures.',
      method: 'Push'
    },
    {
      key: 'tradeAlerts',
      title: 'Trade alerts',
      description: 'Trade entries, exits, and execution changes.',
      method: 'Push'
    },
    {
      key: 'brokerSyncFailures',
      title: 'System alerts',
      description: 'Sync failures and automation incidents.',
      method: 'Push'
    },
    {
      key: 'dailyRecap',
      title: 'Summary',
      description: 'Daily recap and routine summaries.',
      method: 'Push'
    }
  ];

  const state = {
    permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    devices: [],
    activeDeviceId: '',
    categories: {
      criticalRiskAlerts: false,
      tradeAlerts: false,
      brokerSyncFailures: false,
      dailyRecap: false
    },
    isSaving: false
  };

  function formatTimestamp(value) {
    if (!value) return 'Not available';
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return 'Not available';
    return new Date(parsed).toLocaleString();
  }

  function permissionLabel(permission) {
    const map = {
      granted: 'Granted',
      denied: 'Denied',
      default: 'Not enabled',
      unsupported: 'Unsupported'
    };
    return map[permission] || 'Unknown';
  }

  function systemState() {
    const permissionGranted = state.permission === 'granted';
    const activeDeviceCount = state.devices.filter((item) => item.isActive !== false).length;
    const enabledCount = ALERT_GROUPS.filter((group) => !!state.categories[group.key]).length;
    if (permissionGranted && activeDeviceCount > 0 && enabledCount === ALERT_GROUPS.length) {
      return { level: 'active', label: 'Active' };
    }
    if (permissionGranted || activeDeviceCount > 0 || enabledCount > 0) {
      return { level: 'suspended', label: 'Partial' };
    }
    return { level: 'inactive', label: 'Inactive' };
  }

  function setBadgeState(el, label, level) {
    if (!el) return;
    el.textContent = label;
    el.classList.remove('active', 'suspended', 'inactive');
    if (level) el.classList.add(level);
  }

  function renderPermissionPanel() {
    const permission = state.permission;
    setText('notif-permission', `Push permission: ${permissionLabel(permission)}`);
    const guidanceEl = document.getElementById('notif-permission-guidance');
    if (!guidanceEl) return;
    if (permission === 'denied') {
      guidanceEl.textContent = 'Permission is denied. Re-enable notifications in your browser site settings, then return and register this device.';
      guidanceEl.classList.add('is-error');
    } else if (permission === 'granted') {
      guidanceEl.textContent = 'Permission is enabled. Register this device to activate delivery routing.';
      guidanceEl.classList.remove('is-error');
    } else if (permission === 'unsupported') {
      guidanceEl.textContent = 'Push notifications are not supported in this browser context.';
      guidanceEl.classList.add('is-error');
    } else {
      guidanceEl.textContent = 'Permission has not been granted yet. Enable notifications to allow this browser to receive alerts.';
      guidanceEl.classList.remove('is-error');
    }
    setBadgeState(document.getElementById('notif-permission-badge'), permissionLabel(permission), permission === 'granted' ? 'active' : permission === 'denied' || permission === 'unsupported' ? 'inactive' : 'suspended');
  }

  function renderDevices() {
    const container = document.getElementById('notif-devices');
    const devices = Array.isArray(state.devices) ? state.devices : [];
    setBadgeState(document.getElementById('notif-devices-badge'), `${devices.length} registered`, devices.length ? 'active' : 'suspended');
    if (!container) return;
    if (!devices.length) {
      container.innerHTML = '<div class="notification-empty-state"><strong>No notification devices registered.</strong><p class="helper">Register this browser after enabling push permission.</p></div>';
      return;
    }
    container.innerHTML = devices.map((device) => {
      const title = device.deviceLabel || [device.platform, device.browser].filter(Boolean).join(' · ') || device.deviceId || 'Unknown device';
      const lastActive = device.lastReceivedAt || device.updatedAt || device.lastRegistrationAt || device.createdAt;
      return `<div class="notification-device-row"><div><strong>${title}</strong><p class="helper">Last active: ${formatTimestamp(lastActive)}</p></div><button class="ghost danger" type="button" data-remove-device="${device.id}">Remove device</button></div>`;
    }).join('');
    container.querySelectorAll('[data-remove-device]').forEach((button) => {
      button.addEventListener('click', async () => {
        const deviceId = button.getAttribute('data-remove-device');
        if (!deviceId) return;
        try {
          await api(`/api/notifications/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
          setStatus('notif-status', 'Device removed from notification routing.', false);
          await loadDevices();
          renderAll();
        } catch (error) {
          setStatus('notif-status', error?.message || 'Unable to remove device.', true);
        }
      });
    });
  }

  function renderAlertGroups() {
    const container = document.getElementById('notif-alert-groups');
    if (!container) return;
    container.innerHTML = ALERT_GROUPS.map((group) => {
      const checked = !!state.categories[group.key] ? 'checked' : '';
      return `<div class="notification-alert-row"><div><strong>${group.title}</strong><p class="helper">${group.description}</p></div><div class="notification-alert-controls"><label class="toggle"><input data-alert-toggle="${group.key}" type="checkbox" ${checked}><span>${checked ? 'Enabled' : 'Disabled'}</span></label><label>Delivery</label><select data-alert-method="${group.key}"><option value="push" selected>${group.method}</option><option value="email" disabled>Email (not configured)</option><option value="both" disabled>Both (not configured)</option></select></div></div>`;
    }).join('');

    container.querySelectorAll('[data-alert-toggle]').forEach((toggle) => {
      toggle.addEventListener('change', async () => {
        const key = toggle.getAttribute('data-alert-toggle');
        if (!key) return;
        state.categories[key] = !!toggle.checked;
        renderOverview();
        await persistPreferences();
        renderAlertGroups();
      });
    });
  }

  async function persistPreferences() {
    if (state.isSaving) return;
    const target = state.activeDeviceId || state.devices[0]?.id;
    if (!target) {
      setStatus('notif-status', 'No registered device available. Register this device to store alert toggles.', true);
      return;
    }
    state.isSaving = true;
    try {
      await api(`/api/notifications/devices/${encodeURIComponent(target)}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: state.categories })
      });
      setStatus('notif-status', 'Alert configuration updated.', false);
    } catch (error) {
      setStatus('notif-status', error?.message || 'Unable to update alert configuration.', true);
    } finally {
      state.isSaving = false;
    }
  }

  function renderOverview() {
    const system = systemState();
    setText('notif-system-state', system.label);
    setBadgeState(document.getElementById('notif-system-state-badge'), system.label, system.level);
    const pushStatus = state.permission === 'granted' ? 'Enabled' : state.permission === 'denied' ? 'Denied' : state.permission === 'unsupported' ? 'Unsupported' : 'Pending';
    setText('notif-push-status', pushStatus);
    setText('notif-device-count', String(state.devices.length));
    const enabledCount = ALERT_GROUPS.filter((group) => !!state.categories[group.key]).length;
    setText('notif-alert-config-state', `${enabledCount}/${ALERT_GROUPS.length} enabled`);
    const lastSent = state.devices.map((device) => device.lastSentAt).find(Boolean);
    setText('notif-last-alert', lastSent ? formatTimestamp(lastSent) : 'Not available');

    setBadgeState(document.getElementById('notif-routing-push'), pushStatus, state.permission === 'granted' ? 'active' : pushStatus === 'Pending' ? 'suspended' : 'inactive');
  }

  async function loadDevices() {
    const payload = await api('/api/notifications/devices');
    state.devices = Array.isArray(payload?.devices) ? payload.devices : [];
    const mine = state.devices.find((device) => device.isActive !== false && device.permissionState === 'granted');
    state.activeDeviceId = mine?.id || state.devices[0]?.id || '';
    state.categories = {
      ...state.categories,
      ...(mine?.categories || state.devices[0]?.categories || {})
    };
  }

  function renderAll() {
    renderPermissionPanel();
    renderDevices();
    renderOverview();
    renderAlertGroups();
  }

  document.getElementById('notif-enable')?.addEventListener('click', async () => {
    if (typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') {
      setStatus('notif-status', 'Push notifications are not supported in this browser.', true);
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      state.permission = permission;
      renderAll();
      setStatus('notif-status', permission === 'granted' ? 'Push permission enabled. Register this device to complete setup.' : 'Push permission was not enabled.', permission !== 'granted');
    } catch (error) {
      setStatus('notif-status', error?.message || 'Unable to request push permission.', true);
    }
  });

  document.getElementById('notif-register-device')?.addEventListener('click', async () => {
    if (state.permission !== 'granted') {
      setStatus('notif-status', 'Enable notifications first, then register this device.', true);
      return;
    }
    setStatus('notif-status', 'This dashboard supports device registration data. Complete token registration flow from the full profile notifications module if this device is not listed yet.', true);
    await loadDevices();
    renderAll();
  });

  document.getElementById('notif-configure-channels')?.addEventListener('click', () => {
    setStatus('notif-status', 'Push routing is controlled by permission and active devices. Email routing is not configured in this module yet.', false);
  });

  try {
    await loadDevices();
  } catch (error) {
    setStatus('notif-status', error?.message || 'Unable to load notification devices.', true);
  }
  renderAll();
})();
