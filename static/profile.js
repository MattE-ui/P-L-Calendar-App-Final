async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', ...opts });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Unauthenticated');
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.data = data;
    throw err;
  }
  return data;
}

async function loadProfile() {
  try {
    const data = await api('/api/profile');
    const portfolio = Number(data.portfolio);
    const netDeposits = Number(data.initialNetDeposits);
    const portfolioInput = document.getElementById('profile-portfolio');
    const netInput = document.getElementById('profile-net-deposits');
    const dateEl = document.getElementById('profile-date');
    if (dateEl && typeof data.today === 'string') {
      const parsed = new Date(`${data.today}T00:00:00`);
      const formatted = Number.isNaN(parsed.getTime())
        ? data.today
        : parsed.toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          });
      dateEl.textContent = `As of ${formatted}`;
    }
    if (data.profileComplete) {
      if (portfolioInput && Number.isFinite(portfolio)) {
        portfolioInput.value = portfolio.toFixed(2);
      }
      if (netInput && Number.isFinite(netDeposits)) {
        netInput.value = netDeposits.toFixed(2);
      }
    }
  } catch (e) {
    console.error('Unable to load profile details', e);
  }
}

async function saveProfile() {
  const errEl = document.getElementById('profile-error');
  if (errEl) errEl.textContent = '';
  const portfolioInput = document.getElementById('profile-portfolio');
  const netInput = document.getElementById('profile-net-deposits');
  const portfolioRaw = portfolioInput?.value.trim() ?? '';
  const netRaw = netInput?.value.trim() ?? '';
  const portfolio = Number(portfolioRaw);
  const netDeposits = Number(netRaw);
  if (!portfolioRaw || Number.isNaN(portfolio) || portfolio < 0) {
    if (errEl) errEl.textContent = 'Enter a non-negative portfolio value to continue.';
    return;
  }
  if (!netRaw || Number.isNaN(netDeposits)) {
    if (errEl) errEl.textContent = 'Enter your cumulative net deposits (can be negative).';
    return;
  }
  try {
    await api('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolio, netDeposits })
    });
    window.location.href = '/';
  } catch (e) {
    console.error(e);
    if (errEl) errEl.textContent = e?.data?.error || 'Unable to save profile details. Please try again.';
  }
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (e) {
    console.warn(e);
  }
  window.location.href = '/login.html';
}

window.addEventListener('DOMContentLoaded', () => {
  loadProfile();
  document.getElementById('profile-save')?.addEventListener('click', saveProfile);
  document.getElementById('profile-logout')?.addEventListener('click', logout);
});
