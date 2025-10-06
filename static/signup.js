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
  const usernameEl = document.getElementById('signup-username');
  const passwordEl = document.getElementById('signup-password');
  const username = usernameEl?.value.trim() ?? '';
  const password = passwordEl?.value.trim() ?? '';
  setMessage('signup-error', '');
  setMessage('signup-success', '');

  if (!username || !password) {
    setMessage('signup-error', 'Choose a username and password to continue.');
    return;
  }

  try {
    await request('/api/signup', { username, password });
    setMessage('signup-success', 'Account created! You can log in now.');
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 900);
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
