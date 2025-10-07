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
  if (loginError) loginError.textContent = '';
  if (loginInfo) loginInfo.textContent = '';

  loginResendBtn.disabled = true;
  loginResendBtn.classList.remove('is-cooldown');
  loginResendBtn.textContent = 'Sending…';

  try {
    const response = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email })
    });
    const result = await response.json().catch(() => ({}));

    if (response.ok) {
      if (result.status === 'already-verified') {
        if (loginInfo) loginInfo.textContent = 'This email is already verified. Try logging in instead.';
        resetButtonCooldown(loginResendBtn);
        return;
      }
      if (loginInfo) {
        loginInfo.textContent = result.status === 'unknown'
          ? 'If we find an account for that email, we\'ll send a new verification link shortly.'
          : 'If your account still needs verification, we just sent a new link.';
      }
      const wait = Number.isFinite(Number(result.retryAfter)) ? Number(result.retryAfter) : 60;
      startButtonCooldown(loginResendBtn, wait > 0 ? wait : 60);
    } else if (response.status === 429) {
      const wait = Number.isFinite(Number(result.retryAfter)) ? Number(result.retryAfter) : 60;
      if (loginInfo) {
        loginInfo.textContent = result.error || 'Please wait a moment before requesting another email.';
      }
      startButtonCooldown(loginResendBtn, wait > 0 ? wait : 60);
    } else if (response.status === 400) {
      if (loginError) loginError.textContent = result.error || 'Enter a valid email before requesting a new link.';
      resetButtonCooldown(loginResendBtn);
    } else {
      if (loginError) loginError.textContent = result.error || 'Could not resend the verification email. Try again shortly.';
      resetButtonCooldown(loginResendBtn);
    }
  } catch (error) {
    console.error(error);
    if (loginError) loginError.textContent = 'Could not resend the verification email. Try again shortly.';
    resetButtonCooldown(loginResendBtn);
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
