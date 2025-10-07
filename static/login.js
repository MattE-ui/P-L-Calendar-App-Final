function removeLegacyResendElements() {
  const candidates = Array.from(document.querySelectorAll('button, .resend-block, .resend-container'));
  candidates.forEach((el) => {
    if (!el) return;
    const text = (el.textContent || '').toLowerCase();
    if (text.includes('resend') && text.includes('verification')) {
      const wrapper = el.closest('.resend-block, .resend-container, .helper');
      if (wrapper) {
        wrapper.remove();
      } else {
        el.remove();
      }
    }
  });
  const legacyTextMatchers = [
    (text) => text.includes('verification') && text.includes('email'),
    (text) => text.includes("didn't get") && text.includes('email'),
    (text) => text.includes('send another link'),
    (text) => text.includes('another link to the address above')
  ];

  document.querySelectorAll('p, span, div, small').forEach((el) => {
    const text = (el.textContent || '').toLowerCase().trim();
    if (!text) return;
    if (legacyTextMatchers.some((fn) => {
      try {
        return fn(text);
      } catch (error) {
        console.warn('Legacy resend matcher failed', error);
        return false;
      }
    })) {
      const wrapper = el.closest('.helper, .resend-block, .resend-container');
      if (wrapper) {
        wrapper.remove();
      } else {
        el.remove();
      }
    }
  });
}

function createLoginHandlers() {
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-btn');
  const signupLink = document.getElementById('signup-link');

  if (!usernameInput || !passwordInput || !loginBtn) {
    return;
  }

  removeLegacyResendElements();

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
}

document.addEventListener('DOMContentLoaded', createLoginHandlers);
