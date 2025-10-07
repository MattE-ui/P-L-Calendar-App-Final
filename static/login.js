const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const loginError = document.getElementById('login-error');

async function call(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });
  return res;
}

async function handleLogin() {
  const username = loginUsernameInput?.value.trim() || '';
  const password = loginPasswordInput?.value.trim() || '';
  if (loginError) loginError.textContent = '';
  if (!username || !password) {
    if (loginError) loginError.textContent = 'Enter your username and password.';
    return;
  }
  try {
    const res = await call('/api/login', { username, password });
    const data = await res.json().catch(() => ({ error: 'Login failed' }));
    if (res.ok) {
      const destination = data.profileComplete ? '/' : '/profile.html';
      window.location.href = destination;
    } else {
      if (loginError) loginError.textContent = data.error || 'Login failed';
    }
  } catch (error) {
    console.error(error);
    if (loginError) loginError.textContent = 'Login failed. Please try again.';
  }
}

if (document.getElementById('login-btn')) {
  document.getElementById('login-btn').addEventListener('click', handleLogin);
}

loginPasswordInput?.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') {
    handleLogin();
  }
}

if (document.getElementById('login-btn')) {
  document.getElementById('login-btn').addEventListener('click', handleLogin);
}

loginPasswordInput?.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') {
    handleLogin();
  }
});

loginResendBtn?.addEventListener('click', handleLoginResend);

document.getElementById('signup-link')?.addEventListener('click', () => {
  window.location.href = '/signup.html';
});

document.getElementById('signup-link')?.addEventListener('click', () => {
  window.location.href = '/signup.html';
});

document.getElementById('signup-link')?.addEventListener('click', () => {
  window.location.href = '/signup.html';
});
