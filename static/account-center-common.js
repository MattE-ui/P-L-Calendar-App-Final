(function initAccountCenterCommon() {
  const isGuestSession = () => (sessionStorage.getItem('guestMode') === 'true'
    || localStorage.getItem('guestMode') === 'true')
    && typeof window.handleGuestRequest === 'function';

  async function api(path, opts = {}) {
    if (isGuestSession()) return window.handleGuestRequest(path, opts);
    const method = (opts.method || 'GET').toUpperCase();
    const fetchPromise = fetch(path, { credentials: 'include', ...opts });
    const response = window.PerfDiagnostics
      ? await window.PerfDiagnostics.trackApi(`account-center-api:${method}:${path}`, fetchPromise)
      : await fetchPromise;
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

  function setStatus(id, message, isError = false) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('is-hidden', !message);
    element.classList.toggle('is-error', !!isError);
  }

  window.AccountCenter = {
    api,
    setText,
    setStatus,
    wireGlobalActions,
    isGuestSession
  };

  wireGlobalActions();
})();
