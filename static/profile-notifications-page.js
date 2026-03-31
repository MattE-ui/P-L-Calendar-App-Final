(async function initNotificationsPage() {
  const { api, setText } = window.AccountCenter;

  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const permissionMap = {
    granted: 'Push permission granted',
    denied: 'Push permission denied',
    default: 'Push permission not yet granted',
    unsupported: 'Push notifications unsupported in this browser'
  };
  setText('notif-permission', permissionMap[permission] || 'Permission unknown');

  try {
    const payload = await api('/api/notifications/devices');
    const prefs = payload?.preferences || {};
    ['criticalRiskAlerts', 'tradeAlerts', 'brokerSyncFailures', 'dailyRecap'].forEach((key) => {
      const input = document.getElementById(`notif-${key}`);
      if (input) input.checked = !!prefs[key];
    });
    const list = document.getElementById('notif-devices');
    const devices = Array.isArray(payload.devices) ? payload.devices : [];
    list.innerHTML = devices.length
      ? devices.map(device => `<p>${device.deviceLabel || device.deviceId} · ${device.enabled ? 'enabled' : 'disabled'}</p>`).join('')
      : '<p class="helper">No notification devices are registered.</p>';
  } catch (error) {
    setText('notif-status', error.message);
  }

  document.getElementById('notif-save')?.addEventListener('click', async () => {
    try {
      const preferences = {
        criticalRiskAlerts: !!document.getElementById('notif-criticalRiskAlerts')?.checked,
        tradeAlerts: !!document.getElementById('notif-tradeAlerts')?.checked,
        brokerSyncFailures: !!document.getElementById('notif-brokerSyncFailures')?.checked,
        dailyRecap: !!document.getElementById('notif-dailyRecap')?.checked
      };
      const devicesPayload = await api('/api/notifications/devices');
      const devices = Array.isArray(devicesPayload.devices) ? devicesPayload.devices : [];
      const deviceId = devicesPayload.activeDeviceId || devices[0]?.deviceId || devices[0]?.id;
      if (!deviceId) throw new Error('No registered device found for preference updates.');
      await api(`/api/notifications/devices/${encodeURIComponent(deviceId)}/preferences`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences)
      });
      setText('notif-status', 'Notification preferences saved for active device.');
    } catch (error) {
      setText('notif-status', error.message);
    }
  });
})();
