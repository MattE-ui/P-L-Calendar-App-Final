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
  const err = document.getElementById('login-error'); err.textContent = '';
  const res = await call('/api/login', { username: u, password: p });
  if (res.ok) { window.location.href = '/'; } else {
    const j = await res.json().catch(()=>({error:'Login failed'}));
    err.textContent = j.error || 'Login failed';
  }
});

document.getElementById('signup-btn').addEventListener('click', async () => {
  const u = document.getElementById('signup-username').value.trim();
  const p = document.getElementById('signup-password').value.trim();
  const err = document.getElementById('signup-error'); err.textContent = '';
  const res = await call('/api/signup', { username: u, password: p });
  if (res.ok) {
    // auto login
    const res2 = await call('/api/login', { username: u, password: p });
    if (res2.ok) window.location.href = '/'; else err.textContent = 'Signed up, but auto-login failed';
  } else {
    const j = await res.json().catch(()=>({error:'Sign up failed'}));
    err.textContent = j.error || 'Sign up failed';
  }
});
