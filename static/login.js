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
  const u = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value.trim();
  const err = document.getElementById('login-error');
  err.textContent = '';
  if (!u || !p) {
    err.textContent = 'Please enter a username and password';
    return;
  }
  const res = await call('/api/login', { username: u, password: p });
  const j = await res.json().catch(() => ({ error: 'Login failed' }));
  if (res.ok) {
    const destination = j.profileComplete ? '/' : '/profile.html';
    window.location.href = destination;
  } else {
    err.textContent = j.error || 'Login failed';
  }
});

document.getElementById('signup-btn').addEventListener('click', async () => {
  const u = document.getElementById('signup-username').value.trim();
  const p = document.getElementById('signup-password').value.trim();
  const err = document.getElementById('signup-error');
  err.textContent = '';
  if (!u || !p) {
    err.textContent = 'Please choose a username and password';
    return;
  }
  const res = await call('/api/signup', { username: u, password: p });
  const j = await res.json().catch(() => ({ error: 'Sign up failed' }));
  if (res.ok) {
    const res2 = await call('/api/login', { username: u, password: p });
    const j2 = await res2.json().catch(() => ({ error: 'Signed up, but auto-login failed' }));
    if (res2.ok) {
      const destination = j2.profileComplete ? '/' : '/profile.html';
      window.location.href = destination;
    } else {
      err.textContent = j2.error || 'Signed up, but auto-login failed';
    }
  } else {
    err.textContent = j.error || 'Sign up failed';
  }
});
