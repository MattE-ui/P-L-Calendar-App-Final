function createLoginHandlers() {
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-btn');
  const signupLink = document.getElementById('signup-link');
  const guestBtn = document.getElementById('guest-btn');

  if (!usernameInput || !passwordInput || !loginBtn) {
    return;
  }

  function setError(message) {
    if (loginError) {
      loginError.textContent = message || '';
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
  guestBtn?.addEventListener('click', () => {
    sessionStorage.setItem('guestMode', 'true');
    localStorage.removeItem('guestMode');
    window.location.href = '/';
  });
}

document.addEventListener('DOMContentLoaded', createLoginHandlers);
