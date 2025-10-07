const signupUsernameInput = document.getElementById('signup-username');
const signupPasswordInput = document.getElementById('signup-password');
const signupError = document.getElementById('signup-error');
const signupSuccess = document.getElementById('signup-success');

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

async function handleSignup() {
  const username = signupUsernameInput?.value.trim() ?? '';
  const password = signupPasswordInput?.value.trim() ?? '';
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
    if (signupPasswordInput) signupPasswordInput.value = '';
  } catch (error) {
    console.error(error);
    setMessage(signupError, error?.data?.error || 'Sign up failed. Please try again.');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('signup-btn')?.addEventListener('click', handleSignup);
  document.getElementById('login-link')?.addEventListener('click', () => {
    window.location.href = '/login.html';
  });
  signupPasswordInput?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      handleSignup();
    }
  });
});
