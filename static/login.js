function createLoginHandlers() {
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-btn');
  const signupLink = document.getElementById('signup-link');
  document.querySelectorAll('#guest-btn').forEach(btn => btn.remove());
  const guestBtn = document.getElementById('guest-btn-bottom');
  const loginInfo = document.getElementById('login-info');
  const twoFactorPanel = document.getElementById('login-2fa-panel');
  const twoFactorCodeInput = document.getElementById('login-2fa-code');
  const twoFactorVerifyBtn = document.getElementById('login-2fa-verify-btn');
  const twoFactorBackBtn = document.getElementById('login-2fa-back-btn');

  let pendingChallengeId = '';

  if (!usernameInput || !passwordInput || !loginBtn) {
    return;
  }

  function setError(message) {
    if (loginError) {
      loginError.textContent = message || '';
    }
  }

  function setLoading(button, loading, loadingLabel) {
    if (!button) return;
    if (loading) {
      button.dataset.label = button.textContent;
      button.textContent = loadingLabel;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  function setTwoFactorMode(enabled) {
    if (twoFactorPanel) twoFactorPanel.classList.toggle('hidden', !enabled);
    if (enabled) {
      loginBtn.classList.add('hidden');
      pendingChallengeId = pendingChallengeId || '';
      setError('Enter your authenticator code (or a backup code) to finish signing in.');
      twoFactorCodeInput?.focus();
    } else {
      loginBtn.classList.remove('hidden');
      pendingChallengeId = '';
      if (twoFactorCodeInput) twoFactorCodeInput.value = '';
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

  function parseTwoFactorChallenge(data = {}) {
    const requiresTwoFactor = data.requiresTwoFactor === true || data.requires_2fa === true;
    const challengeId = typeof data.challengeId === 'string'
      ? data.challengeId
      : (typeof data.challenge_id === 'string' ? data.challenge_id : (typeof data.challengeToken === 'string' ? data.challengeToken : (typeof data.challenge_token === 'string' ? data.challenge_token : '')));
    return {
      requiresTwoFactor,
      challengeId: challengeId.trim(),
      message: data.message
    };
  }

  async function handleLogin() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    setError('');
    if (!username || !password) {
      setError('Enter your username and password.');
      return;
    }
    setLoading(loginBtn, true, 'Signing in...');
    try {
      const res = await call('/api/login', { username, password });
      const data = await res.json().catch(() => ({ error: 'Login failed' }));
      const challenge = parseTwoFactorChallenge(data);
      if ((res.status === 202 || res.ok) && challenge.requiresTwoFactor) {
        if (!challenge.challengeId) {
          setError('2FA challenge is missing. Please try signing in again.');
          return;
        }
        pendingChallengeId = challenge.challengeId;
        setTwoFactorMode(true);
        if (typeof challenge.message === 'string' && challenge.message.trim()) {
          setError(challenge.message.trim());
        }
      } else if (res.ok) {
        sessionStorage.removeItem('guestMode');
        localStorage.removeItem('guestMode');
        window.location.href = data.profileComplete ? '/' : '/profile.html';
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (error) {
      console.error(error);
      setError('Login failed. Please try again.');
    } finally {
      setLoading(loginBtn, false, 'Signing in...');
    }
  }

  async function handleTwoFactorVerify() {
    const code = (twoFactorCodeInput?.value || '').trim();
    if (!pendingChallengeId) {
      setError('Your 2FA challenge expired. Please sign in again.');
      setTwoFactorMode(false);
      return;
    }
    if (!code) {
      setError('Enter your authenticator code or backup code.');
      return;
    }
    const method = /^\d{6}$/.test(code) ? 'totp' : 'backup_code';
    setLoading(twoFactorVerifyBtn, true, 'Verifying...');
    try {
      const res = await call('/api/login/2fa', { challengeId: pendingChallengeId, code, method });
      const data = await res.json().catch(() => ({ error: '2FA verification failed' }));
      if (res.ok) {
        sessionStorage.removeItem('guestMode');
        localStorage.removeItem('guestMode');
        window.location.href = data.profileComplete ? '/' : '/profile.html';
      } else {
        setError(data.error || '2FA verification failed.');
      }
    } catch (error) {
      console.error(error);
      setError('2FA verification failed. Please try again.');
    } finally {
      setLoading(twoFactorVerifyBtn, false, 'Verifying...');
    }
  }

  loginBtn.addEventListener('click', handleLogin);
  passwordInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      handleLogin();
    }
  });

  twoFactorVerifyBtn?.addEventListener('click', handleTwoFactorVerify);
  twoFactorCodeInput?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') handleTwoFactorVerify();
  });
  twoFactorBackBtn?.addEventListener('click', () => {
    setTwoFactorMode(false);
    setError('');
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
