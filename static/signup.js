const signupEmailInput = document.getElementById('signup-email');
const signupPasswordInput = document.getElementById('signup-password');
const signupResendBtn = document.getElementById('signup-resend-btn');

if (signupResendBtn && !signupResendBtn.dataset.label) {
  signupResendBtn.dataset.label = signupResendBtn.textContent || 'Resend verification email';
}

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

async function handleSignup() {
  const username = signupEmailInput?.value.trim() ?? '';
  const password = signupPasswordInput?.value.trim() ?? '';
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
    if (signupPasswordInput) signupPasswordInput.value = '';
    if (signupResendBtn) {
      startButtonCooldown(signupResendBtn, 60);
    }
  } catch (e) {
    console.error(e);
    setMessage('signup-error', e?.data?.error || 'Sign up failed. Please try again.');
    if (signupResendBtn && !signupResendBtn._cooldownTimer) {
      resetButtonCooldown(signupResendBtn);
    }
  }
}

async function handleSignupResend() {
  if (!signupResendBtn) return;
  const email = signupEmailInput?.value.trim() || '';
  setMessage('signup-error', '');
  setMessage('signup-success', '');

  if (!email) {
    setMessage('signup-error', 'Enter your email above so we know where to send it.');
    return;
  }

  signupResendBtn.disabled = true;
  signupResendBtn.classList.remove('is-cooldown');
  signupResendBtn.textContent = 'Sending…';

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
        setMessage('signup-success', 'This email is already verified. Head to the login page to sign in.');
        resetButtonCooldown(signupResendBtn);
        return;
      }
      const wait = Number.isFinite(Number(result.retryAfter)) ? Number(result.retryAfter) : 60;
      const message = result.status === 'unknown'
        ? 'If we find an account for that email, we\'ll send a new verification link shortly.'
        : 'If your account still needs verification, we just sent a new link.';
      setMessage('signup-success', message);
      startButtonCooldown(signupResendBtn, wait > 0 ? wait : 60);
    } else if (response.status === 429) {
      const wait = Number.isFinite(Number(result.retryAfter)) ? Number(result.retryAfter) : 60;
      setMessage('signup-success', result.error || 'Please wait a moment before requesting another email.');
      startButtonCooldown(signupResendBtn, wait > 0 ? wait : 60);
    } else if (response.status === 400) {
      setMessage('signup-error', result.error || 'Enter a valid email before requesting a new link.');
      resetButtonCooldown(signupResendBtn);
    } else {
      setMessage('signup-error', result.error || 'Could not resend the verification email. Try again shortly.');
      resetButtonCooldown(signupResendBtn);
    }
  } catch (error) {
    console.error(error);
    setMessage('signup-error', 'Could not resend the verification email. Try again shortly.');
    resetButtonCooldown(signupResendBtn);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('signup-btn')?.addEventListener('click', handleSignup);
  document.getElementById('login-link')?.addEventListener('click', () => {
    window.location.href = '/login.html';
  });
  signupPasswordInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSignup();
    }
  });
  signupResendBtn?.addEventListener('click', handleSignupResend);
});
