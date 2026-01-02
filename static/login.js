function createLoginHandlers() {
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-btn');
  const signupLink = document.getElementById('signup-link');
  document.querySelectorAll('#guest-btn').forEach(btn => btn.remove());
  const guestBtn = document.getElementById('guest-btn-bottom');
  const loginInfo = document.getElementById('login-info');

  if (!usernameInput || !passwordInput || !loginBtn) {
    return;
  }

  function setError(message) {
    if (loginError) {
      loginError.textContent = message || '';
    }
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('expired') === 'guest') {
    if (loginInfo) {
      loginInfo.textContent = 'Guest session expired. Continue as Guest again or sign up.';
    }
  }

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
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    setError('');
    if (!username || !password) {
      setError('Enter your username and password.');
      return;
    }
    try {
      const res = await call('/api/login', { username, password });
      const data = await res.json().catch(() => ({ error: 'Login failed' }));
      if (res.ok) {
        sessionStorage.removeItem('guestMode');
        localStorage.removeItem('guestMode');
        window.location.href = data.profileComplete ? '/' : '/profile.html';
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (error) {
      console.error(error);
      setError('Login failed. Please try again.');
    }
  }

  loginBtn.addEventListener('click', handleLogin);
  passwordInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      handleLogin();
    }
  });

  signupLink?.addEventListener('click', () => {
    window.location.href = '/signup.html';
  });

  guestBtn?.addEventListener('click', async () => {
    setError('');
    try {
      const res = await call('/api/auth/guest', {});
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        window.location.href = '/';
      } else {
        setError(data.error || 'Unable to start guest mode.');
      }
    } catch (error) {
      console.error(error);
      setError('Unable to start guest mode. Please try again.');
    }
  });
}

document.addEventListener('DOMContentLoaded', createLoginHandlers);
