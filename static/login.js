const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const loginInfo = document.getElementById('login-info');
const loginResendBtn = document.getElementById('login-resend-btn');

if (loginResendBtn && !loginResendBtn.dataset.label) {
  loginResendBtn.dataset.label = loginResendBtn.textContent || 'Resend verification email';
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

function resetButtonCooldown(button) {
  if (!button) return;
  if (button._cooldownTimer) {
    clearInterval(button._cooldownTimer);
    button._cooldownTimer = null;
  }
  button.classList.remove('is-cooldown');
  button.disabled = false;
  const label = button.dataset.label || 'Resend verification email';
  button.textContent = label;
}

function startButtonCooldown(button, seconds) {
  if (!button) return;
  const label = button.dataset.label || 'Resend verification email';
  if (button._cooldownTimer) {
    clearInterval(button._cooldownTimer);
  }
  let remaining = Math.max(0, Math.floor(seconds));
  button.disabled = true;
  button.classList.add('is-cooldown');

  const tick = () => {
    if (remaining <= 0) {
      clearInterval(button._cooldownTimer);
      button._cooldownTimer = null;
      button.classList.remove('is-cooldown');
      button.disabled = false;
      button.textContent = label;
      return;
    }
    button.textContent = `${label} (${remaining})`;
    remaining -= 1;
  };

  tick();
  button._cooldownTimer = setInterval(tick, 1000);
}

async function handleLogin() {
  const email = loginEmailInput?.value.trim() || '';
  const password = loginPasswordInput?.value.trim() || '';
  if (loginError) loginError.textContent = '';
  if (loginInfo) loginInfo.textContent = '';
  if (!email || !password) {
    if (loginError) loginError.textContent = 'Please enter your email and password';
    return;
  }
  const res = await call('/api/login', { email, username: email, password });
  const data = await res.json().catch(() => ({ error: 'Login failed' }));
  if (res.ok) {
    const destination = data.profileComplete ? '/' : '/profile.html';
    window.location.href = destination;
  } else {
    if (res.status === 403 && loginInfo) {
      loginInfo.textContent = 'We emailed you a confirmation link when you signed up. Approve it and then try logging in again.';
      if (loginResendBtn && !loginResendBtn._cooldownTimer) {
        loginResendBtn.disabled = false;
        loginResendBtn.textContent = loginResendBtn.dataset.label || loginResendBtn.textContent;
      }
    }
    if (loginError) loginError.textContent = data.error || 'Login failed';
  }
}

async function handleLoginResend() {
  if (!loginResendBtn) return;
  const email = loginEmailInput?.value.trim() || '';
  if (!email) {
    if (loginError) loginError.textContent = 'Enter your email above so we know where to send it.';
    return;
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
