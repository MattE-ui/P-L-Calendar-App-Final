const isGuestSession = () => (sessionStorage.getItem('guestMode') === 'true'
  || localStorage.getItem('guestMode') === 'true')
  && typeof window.handleGuestRequest === 'function';

async function api(path, opts = {}) {
  if (isGuestSession()) return window.handleGuestRequest(path, opts);
  const res = await fetch(path, { credentials: 'include', ...opts });
  let data = {};
  try {
    data = await res.json();
  } catch (error) {
    data = {};
  }
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Unauthenticated');
  }
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function initialsFromProfile(profile) {
  const seed = profile?.nickname || profile?.username || 'Veracity Trader';
  return seed
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || 'VT';
}

async function loadHubData() {
  try {
    const profile = await api('/api/profile');
    const identity = profile?.nickname
      ? `${profile.nickname} · ${profile.username || 'Account owner'}`
      : (profile?.username || 'Account owner');
    setText('hub-identity', identity);
    const avatar = document.getElementById('hub-avatar');
    if (avatar) avatar.textContent = initialsFromProfile(profile);

    const tradingAccounts = Array.isArray(profile?.tradingAccounts) ? profile.tradingAccounts : [];
    const connectedCount = tradingAccounts.filter(account => account?.integrationEnabled).length;
    setText('status-trading', `${connectedCount} connected`);

    setText('status-investor', profile?.investorAccountsEnabled ? 'Master mode enabled' : 'Disabled');
  } catch (error) {
    setText('hub-identity', 'Unable to load account summary');
    setText('status-trading', 'Status unavailable');
    setText('status-investor', 'Status unavailable');
  }

  try {
    const [t212, ibkr] = await Promise.all([
      api('/api/t212/settings').catch(() => ({})),
      api('/api/ibkr/settings').catch(() => ({}))
    ]);
    const enabled = [!!t212?.enabled, !!ibkr?.enabled].filter(Boolean).length;
    setText('status-automation', enabled === 0 ? 'No automations enabled' : `${enabled} automation${enabled > 1 ? 's' : ''} enabled`);
    setText('status-integrations', enabled === 0 ? 'No active integrations' : `${enabled} active integration${enabled > 1 ? 's' : ''}`);
  } catch (error) {
    setText('status-automation', 'Status unavailable');
    setText('status-integrations', 'Status unavailable');
  }

  const notificationPermission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const notificationStatusMap = {
    granted: 'Push enabled',
    denied: 'Permission blocked',
    default: 'Permission pending',
    unsupported: 'Not supported in this browser'
  };
  setText('status-notifications', notificationStatusMap[notificationPermission] || 'Status unavailable');
}

loadHubData();
