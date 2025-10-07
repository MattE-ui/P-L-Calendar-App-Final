async function call(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });
  return res;
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const u = document.getElementById('login-email').value.trim();
  const p = document.getElementById('login-password').value.trim();
  const err = document.getElementById('login-error');
  const info = document.getElementById('login-info');
  err.textContent = '';
  if (info) info.textContent = '';
  if (!u || !p) {
    err.textContent = 'Please enter your email and password';
    return;
  }
  const res = await call('/api/login', { email: u, username: u, password: p });
  const j = await res.json().catch(() => ({ error: 'Login failed' }));
  if (res.ok) {
    const destination = j.profileComplete ? '/' : '/profile.html';
    window.location.href = destination;
  } else {
    if (res.status === 403 && info) {
      info.textContent = 'We emailed you a confirmation link when you signed up. Approve it and then try logging in again.';
    }
    err.textContent = j.error || 'Login failed';
  }
});

document.getElementById('signup-link')?.addEventListener('click', () => {
  window.location.href = '/signup.html';
});
