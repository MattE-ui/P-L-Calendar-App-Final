(function initAccountCenterCommon() {
  const isGuestSession = () => (sessionStorage.getItem('guestMode') === 'true'
    || localStorage.getItem('guestMode') === 'true')
    && typeof window.handleGuestRequest === 'function';

  async function api(path, opts = {}) {
    if (isGuestSession()) return window.handleGuestRequest(path, opts);
    const response = await fetch(path, { credentials: 'include', ...opts });
    let payload = {};
    try {
      payload = await response.json();
    } catch (_error) {
      payload = {};
    }
    if (response.status === 401) {
      window.location.href = '/login.html';
      throw new Error('Unauthenticated');
    }
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  }

  async function logout() {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (_error) {
      // redirect anyway
    }
    sessionStorage.removeItem('guestMode');
    localStorage.removeItem('guestMode');
    window.location.href = '/login.html';
  }

  function wireGlobalActions() {
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    document.getElementById('quick-settings-btn')?.addEventListener('click', () => {
      window.location.href = '/profile/settings';
    });
    document.getElementById('devtools-btn')?.addEventListener('click', () => {
      window.location.href = '/devtools.html';
    });
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  window.AccountCenter = {
    api,
    setText,
    wireGlobalActions,
    isGuestSession
  };

  wireGlobalActions();
})();
