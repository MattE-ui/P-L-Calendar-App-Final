async function request(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.data = data;
    throw err;
  }
  return data;
}

function setMessage(id, message) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = message;
  }
}

async function handleSignup() {
  const usernameEl = document.getElementById('signup-email');
  const passwordEl = document.getElementById('signup-password');
  const username = usernameEl?.value.trim() ?? '';
  const password = passwordEl?.value.trim() ?? '';
  setMessage('signup-error', '');
  setMessage('signup-success', '');

  if (!username || !password) {
    setMessage('signup-error', 'Enter your email and a strong password to continue.');
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
    setMessage('signup-error', 'Enter a valid email address.');
    return;
  }

  const strong = password.length >= 12
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);

  if (!strong) {
    setMessage('signup-error', 'Passwords must be 12+ characters with upper, lower, number, and symbol.');
    return;
  }

  try {
    await request('/api/signup', { email: username, username, password });
    setMessage('signup-success', 'Check your inbox for a verification link to activate your account.');
    usernameEl.value = '';
    passwordEl.value = '';
  } catch (e) {
    console.error(e);
    setMessage('signup-error', e?.data?.error || 'Sign up failed. Please try again.');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('signup-btn')?.addEventListener('click', handleSignup);
  document.getElementById('login-link')?.addEventListener('click', () => {
    window.location.href = '/login.html';
  });
  document.getElementById('signup-password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSignup();
    }
  });
});
