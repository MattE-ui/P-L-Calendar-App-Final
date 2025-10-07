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

function createSignupHandlers() {
  const usernameInput = document.getElementById('signup-username');
  const passwordInput = document.getElementById('signup-password');
  const signupBtn = document.getElementById('signup-btn');
  const loginLink = document.getElementById('login-link');
  const signupError = document.getElementById('signup-error');
  const signupSuccess = document.getElementById('signup-success');

  if (!usernameInput || !passwordInput || !signupBtn) {
    return;
  }

  removeLegacyResendElements();

  function setMessage(el, message) {
    if (el) {
      el.textContent = message;
    }
  }

  function isStrongPassword(password) {
    return password.length >= 12
      && /[A-Z]/.test(password)
      && /[a-z]/.test(password)
      && /\d/.test(password)
      && /[^A-Za-z0-9]/.test(password);
  }

  async function request(path, payload) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || 'Request failed');
      error.data = data;
      throw error;
    }
    return data;
  }

  async function handleSignup() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    setMessage(signupError, '');
    setMessage(signupSuccess, '');

    if (!username) {
      setMessage(signupError, 'Choose a username to continue.');
      return;
    }
    if (username.length < 3) {
      setMessage(signupError, 'Usernames must be at least 3 characters long.');
      return;
    }
    if (/\s/.test(username)) {
      setMessage(signupError, 'Usernames cannot contain spaces.');
      return;
    }
    if (!isStrongPassword(password)) {
      setMessage(signupError, 'Passwords must be 12+ characters with upper, lower, number, and symbol.');
      return;
    }

    try {
      await request('/api/signup', { username, password });
      setMessage(signupSuccess, 'Account created! Log in with your new credentials.');
      passwordInput.value = '';
    } catch (error) {
      console.error(error);
      setMessage(signupError, error?.data?.error || 'Sign up failed. Please try again.');
    }
  }

  signupBtn.addEventListener('click', handleSignup);
  passwordInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      handleSignup();
    }
  });
  loginLink?.addEventListener('click', () => {
    window.location.href = '/login.html';
  });
}

document.addEventListener('DOMContentLoaded', createSignupHandlers);
