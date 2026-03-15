async function loadSocialProfile() {
  const friendCodeEl = document.getElementById('social-friend-code');
  const errorEl = document.getElementById('social-error');

  if (!friendCodeEl) return;

  try {
    const res = await fetch('/api/profile', { credentials: 'include' });
    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Unable to load social profile.');
    }
    friendCodeEl.textContent = data.friendCode || 'Unavailable';
    if (errorEl) errorEl.textContent = '';
  } catch (error) {
    if (errorEl) errorEl.textContent = error.message || 'Unable to load social profile.';
    friendCodeEl.textContent = 'Unavailable';
  }
}

document.addEventListener('DOMContentLoaded', loadSocialProfile);
