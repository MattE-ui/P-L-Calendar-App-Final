(async function initNotificationsPage() {
  const { api, setText, setStatus } = window.AccountCenter;

  const ALERT_GROUPS = [
    { key: 'criticalRiskAlerts', title: 'Critical alerts', description: 'Risk breaches and high-priority failures.' },
    { key: 'tradeAlerts', title: 'Trade alerts', description: 'Trade entries, exits, and execution changes.' },
    { key: 'tradeGroupAlerts', title: 'Trade group alerts', description: 'Invites, member updates, and group announcements.' },
    { key: 'socialInvestorNotifications', title: 'Investor notifications', description: 'Investor updates and social portfolio activity.' },
    { key: 'brokerSyncFailures', title: 'System alerts', description: 'Sync failures and automation incidents.' },
    { key: 'dailyRecap', title: 'Summary', description: 'Daily recap and routine summaries.' }
  ];

  const state = {
    permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    devices: [],
    activeDeviceId: '',
    deviceId: getOrCreateNotificationDeviceId(),
    preferences: {
      categories: {
        criticalRiskAlerts: true,
        tradeAlerts: true,
        tradeGroupAlerts: true,
        socialInvestorNotifications: true,
        brokerSyncFailures: true,
        dailyRecap: false
      },
      delivery: {
        criticalRiskAlerts: 'push',
        tradeAlerts: 'push',
        tradeGroupAlerts: 'push',
        socialInvestorNotifications: 'push',
        brokerSyncFailures: 'push',
        dailyRecap: 'push'
      }
    },
    isSaving: false,
    saveErrorByKey: {},
    config: null
  };

  function getOrCreateNotificationDeviceId() {
    const key = 'veracity_notification_device_id';
    let value = localStorage.getItem(key);
    if (!value) {
      const randomId = window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2);
      value = `${Date.now().toString(36)}-${randomId}`;
      localStorage.setItem(key, value);
    }
    return value;
  }

  function getNotificationPlatform() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios-browser';
    if (/Android/.test(ua)) return 'android-browser';
    return 'desktop-browser';
  }

  function detectBrowserName() {
    const ua = navigator.userAgent || '';
    if (/Edg\//.test(ua)) return 'edge';
    if (/OPR\//.test(ua)) return 'opera';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Chrome\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
    return 'unknown';
  }

  function formatTimestamp(value) {
    if (!value) return 'Not available';
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return 'Not available';
    return new Date(parsed).toLocaleString();
  }

  function permissionLabel(permission) {
    const map = { granted: 'Granted', denied: 'Denied', default: 'Not enabled', unsupported: 'Unsupported' };
    return map[permission] || 'Unknown';
  }

  function setBadgeState(el, label, level) {
    if (!el) return;
    el.textContent = label;
    el.classList.remove('active', 'suspended', 'inactive');
    if (level) el.classList.add(level);
  }

  function systemState() {
    const permissionGranted = state.permission === 'granted';
    const activeDeviceCount = state.devices.filter((item) => item.isActive !== false).length;
    const enabledCount = ALERT_GROUPS.filter((group) => !!state.preferences.categories[group.key]).length;
    if (permissionGranted && activeDeviceCount > 0 && enabledCount > 0) return { level: 'active', label: 'Active' };
    if (permissionGranted || activeDeviceCount > 0 || enabledCount > 0) return { level: 'suspended', label: 'Partial' };
    return { level: 'inactive', label: 'Inactive' };
  }

  function renderPermissionPanel() {
    setText('notif-permission', `Push permission: ${permissionLabel(state.permission)}`);
    const guidanceEl = document.getElementById('notif-permission-guidance');
    if (!guidanceEl) return;
    if (state.permission === 'denied') {
      guidanceEl.textContent = 'Permission is denied. Re-enable notifications in browser site settings, then register this device.';
      guidanceEl.classList.add('is-error');
    } else if (state.permission === 'granted') {
      guidanceEl.textContent = 'Permission is enabled. Register this device to activate delivery routing.';
      guidanceEl.classList.remove('is-error');
    } else {
      guidanceEl.textContent = 'Permission has not been granted yet. Enable notifications to allow this browser to receive alerts.';
      guidanceEl.classList.toggle('is-error', state.permission === 'unsupported');
    }
    setBadgeState(document.getElementById('notif-permission-badge'), permissionLabel(state.permission), state.permission === 'granted' ? 'active' : state.permission === 'default' ? 'suspended' : 'inactive');
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
      const isCurrent = device.deviceId === state.deviceId;
      const title = device.deviceLabel || [device.platform, device.browser].filter(Boolean).join(' · ') || device.deviceId || 'Unknown device';
      const lastActive = device.lastReceivedAt || device.updatedAt || device.lastRegistrationAt || device.createdAt;
      return `<div class="notification-device-row"><div><strong>${title}${isCurrent ? ' (this device)' : ''}</strong><p class="helper">Last active: ${formatTimestamp(lastActive)}</p></div><button class="ghost danger" type="button" data-remove-device="${device.id}">Remove device</button></div>`;
    }).join('');
    container.querySelectorAll('[data-remove-device]').forEach((button) => {
      button.addEventListener('click', async () => {
        const deviceId = button.getAttribute('data-remove-device');
        if (!deviceId) return;
        try {
          await api(`/api/notifications/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
          setStatus('notif-status', 'Device removed from notification routing.', false);
          await refreshAllData();
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
      const enabled = !!state.preferences.categories[group.key];
      const delivery = state.preferences.delivery[group.key] || 'push';
      const rowError = state.saveErrorByKey[group.key] || '';
      return `<div class="notification-alert-row"><div><strong>${group.title}</strong><p class="helper">${group.description}</p>${rowError ? `<p class="helper is-error">${rowError}</p>` : ''}</div><div class="notification-alert-controls"><label class="toggle"><input data-alert-toggle="${group.key}" type="checkbox" ${enabled ? 'checked' : ''}><span>${enabled ? 'Enabled' : 'Disabled'}</span></label><label>Delivery</label><select data-alert-method="${group.key}"><option value="push" ${delivery === 'push' ? 'selected' : ''}>Push</option><option value="email" ${delivery === 'email' ? 'selected' : ''}>Email</option><option value="both" ${delivery === 'both' ? 'selected' : ''}>Both</option><option value="disabled" ${delivery === 'disabled' ? 'selected' : ''}>Disabled</option></select></div></div>`;
    }).join('');

    container.querySelectorAll('[data-alert-toggle]').forEach((toggle) => {
      toggle.addEventListener('change', async () => {
        const key = toggle.getAttribute('data-alert-toggle');
        if (!key) return;
        const nextCategories = { ...state.preferences.categories, [key]: !!toggle.checked };
        await savePreferences({ categories: nextCategories }, key);
      });
    });

    container.querySelectorAll('[data-alert-method]').forEach((select) => {
      select.addEventListener('change', async () => {
        const key = select.getAttribute('data-alert-method');
        if (!key) return;
        const nextDelivery = { ...state.preferences.delivery, [key]: select.value };
        await savePreferences({ delivery: nextDelivery }, key);
      });
    });
  }

  function renderOverview() {
    const system = systemState();
    const pushStatus = state.permission === 'granted' ? 'Enabled' : state.permission === 'denied' ? 'Denied' : state.permission === 'unsupported' ? 'Unsupported' : 'Pending';
    const enabledCount = ALERT_GROUPS.filter((group) => !!state.preferences.categories[group.key]).length;
    const lastSent = state.devices.map((device) => device.lastSentAt).filter(Boolean).sort((a, b) => Date.parse(b || 0) - Date.parse(a || 0))[0] || null;
    setText('notif-system-state', system.label);
    setBadgeState(document.getElementById('notif-system-state-badge'), system.label, system.level);
    setText('notif-push-status', pushStatus);
    setText('notif-device-count', String(state.devices.length));
    setText('notif-alert-config-state', `${enabledCount}/${ALERT_GROUPS.length} enabled`);
    setText('notif-last-alert', lastSent ? formatTimestamp(lastSent) : 'Not available');
    setBadgeState(document.getElementById('notif-routing-push'), pushStatus, state.permission === 'granted' ? 'active' : pushStatus === 'Pending' ? 'suspended' : 'inactive');
  }

  async function loadDevices() {
    console.info('[Notifications][Dashboard] settings fetch: /api/notifications/devices started');
    const payload = await api('/api/notifications/devices');
    state.devices = Array.isArray(payload?.devices) ? payload.devices : [];
    const mine = state.devices.find((device) => device.deviceId === state.deviceId && device.isActive !== false);
    state.activeDeviceId = mine?.id || state.devices[0]?.id || '';
    console.info('[Notifications][Dashboard] settings fetch: /api/notifications/devices completed', { count: state.devices.length, activeDeviceId: state.activeDeviceId || null });
  }

  async function loadPreferences() {
    console.info('[Notifications][Dashboard] settings fetch: /api/notifications/preferences started');
    const payload = await api('/api/notifications/preferences');
    state.preferences = {
      categories: { ...state.preferences.categories, ...(payload?.preferences?.categories || {}) },
      delivery: { ...state.preferences.delivery, ...(payload?.preferences?.delivery || {}) }
    };
    console.info('[Notifications][Dashboard] settings fetch: /api/notifications/preferences completed', state.preferences);
  }

  async function savePreferences(partial, key) {
    if (state.isSaving) return;
    const prev = JSON.parse(JSON.stringify(state.preferences));
    state.preferences = {
      categories: { ...state.preferences.categories, ...(partial.categories || {}) },
      delivery: { ...state.preferences.delivery, ...(partial.delivery || {}) }
    };
    delete state.saveErrorByKey[key];
    renderAll();
    state.isSaving = true;
    console.info('[Notifications][Dashboard] settings save started', { key, partial });
    try {
      await api('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.preferences)
      });
      if (state.activeDeviceId) {
        await api(`/api/notifications/devices/${encodeURIComponent(state.activeDeviceId)}/preferences`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.preferences)
        });
      }
      console.info('[Notifications][Dashboard] settings save completed', { key });
      setStatus('notif-status', 'Alert configuration updated.', false);
      await refreshAllData();
    } catch (error) {
      state.preferences = prev;
      state.saveErrorByKey[key] = error?.message || 'Save failed.';
      console.error('[Notifications][Dashboard] settings save failed', { key, error: error?.message || String(error) });
      setStatus('notif-status', `Unable to update ${key || 'settings'}: ${error?.message || 'save failed'}`, true);
      renderAll();
    } finally {
      state.isSaving = false;
    }
  }

  async function ensureFirebaseMessagingReady(configPayload) {
    const injectScript = (src) => new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) return resolve();
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed loading ${src}`));
      document.head.appendChild(script);
    });
    await injectScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    await injectScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
    const config = configPayload?.config || {};
    const app = (Array.isArray(window.firebase.apps) && window.firebase.apps.length) ? window.firebase.apps[0] : window.firebase.initializeApp(config);
    return window.firebase.messaging(app);
  }

  async function registerCurrentDevice() {
    try {
      console.info('[Notifications][Dashboard] device registration started');
      if (typeof Notification === 'undefined') throw new Error('Push notifications are not supported in this browser.');
      if (Notification.permission !== 'granted') {
        throw new Error(`Push permission is ${Notification.permission}. Click Enable notifications first.`);
      }
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Service worker or PushManager is unavailable in this browser context.');
      }
      state.config = state.config || await api('/api/notifications/config');
      if (!state.config?.supported) throw new Error('Notification configuration is incomplete on the server.');
      const registration = await navigator.serviceWorker.register('/serviceWorker.js?v=20260401-notification-dashboard', { updateViaCache: 'none' });
      await registration.update();
      const swReady = await navigator.serviceWorker.ready;
      const messaging = await ensureFirebaseMessagingReady(state.config);
      console.info('[Notifications][Dashboard] token acquisition started');
      const token = await messaging.getToken({
        vapidKey: state.config?.config?.vapidKey,
        serviceWorkerRegistration: swReady
      });
      if (!token) throw new Error('Token acquisition returned empty token.');
      console.info('[Notifications][Dashboard] token acquisition succeeded', { tokenSuffix: token.slice(-8) });
      const payload = {
        deviceId: state.deviceId,
        token,
        platform: getNotificationPlatform(),
        browser: detectBrowserName(),
        userAgent: navigator.userAgent,
        permissionState: Notification.permission,
        installedAsPwa: !!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone),
        categories: state.preferences.categories,
        delivery: state.preferences.delivery,
        isActive: true
      };
      console.info('[Notifications][Dashboard] backend registration request started', { deviceId: payload.deviceId });
      const registerResponse = await api('/api/notifications/devices/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.info('[Notifications][Dashboard] backend registration response', registerResponse);
      setStatus('notif-status', 'Device registered for push notifications.', false);
      await refreshAllData();
    } catch (error) {
      console.error('[Notifications][Dashboard] device registration failed', { error: error?.message || String(error) });
      setStatus('notif-status', error?.message || 'Unable to register this device.', true);
    }
  }

  async function refreshAllData() {
    state.permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    await Promise.all([loadPreferences(), loadDevices()]);
    renderAll();
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
    await registerCurrentDevice();
  });

  document.getElementById('notif-configure-channels')?.addEventListener('click', () => {
    setStatus('notif-status', 'Delivery changes are saved immediately and used by the real send pipeline.', false);
  });

  try {
    await refreshAllData();
  } catch (error) {
    setStatus('notif-status', error?.message || 'Unable to load notification dashboard data.', true);
    renderAll();
  }
})();
