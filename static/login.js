function createLoginHandlers() {
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-btn');
  const signupLink = document.getElementById('signup-link');
  document.querySelectorAll('#guest-btn').forEach(btn => btn.remove());
  const guestBtn = document.getElementById('guest-btn-bottom');
  const loginInfo = document.getElementById('login-info');
  const credentialsPanel = document.getElementById('login-credentials-panel');
  const twoFactorPanel = document.getElementById('login-2fa-panel');
  const twoFactorCodeInput = document.getElementById('login-2fa-code');
  const twoFactorBackupToggleBtn = document.getElementById('login-2fa-toggle-btn');
  const twoFactorBackupGroup = document.getElementById('login-2fa-backup-group');
  const twoFactorBackupCodeInput = document.getElementById('login-2fa-backup-code');
  const twoFactorVerifyBtn = document.getElementById('login-2fa-verify-btn');
  const twoFactorBackBtn = document.getElementById('login-2fa-back-btn');

  const AUTH_MODES = Object.freeze({
    CREDENTIALS: 'credentials',
    TWO_FACTOR: 'twoFactorChallenge'
  });

  const TWO_FACTOR_METHODS = Object.freeze({
    TOTP: 'totp',
    BACKUP_CODE: 'backup_code'
  });

  let authMode = AUTH_MODES.CREDENTIALS;
  let selectedTwoFactorMethod = TWO_FACTOR_METHODS.TOTP;
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

  function setTwoFactorMethod(method) {
    selectedTwoFactorMethod = method === TWO_FACTOR_METHODS.BACKUP_CODE
      ? TWO_FACTOR_METHODS.BACKUP_CODE
      : TWO_FACTOR_METHODS.TOTP;
    const usingBackup = selectedTwoFactorMethod === TWO_FACTOR_METHODS.BACKUP_CODE;
    if (twoFactorBackupGroup) twoFactorBackupGroup.classList.toggle('hidden', !usingBackup);
    if (twoFactorBackupToggleBtn) {
      twoFactorBackupToggleBtn.textContent = usingBackup
        ? 'Use authenticator code instead'
        : 'Use backup code instead';
    }
    if (usingBackup) {
      twoFactorCodeInput?.setAttribute('disabled', 'disabled');
      if (twoFactorCodeInput) twoFactorCodeInput.value = '';
      twoFactorBackupCodeInput?.removeAttribute('disabled');
      twoFactorBackupCodeInput?.focus();
    } else {
      twoFactorBackupCodeInput?.setAttribute('disabled', 'disabled');
      if (twoFactorBackupCodeInput) twoFactorBackupCodeInput.value = '';
      twoFactorCodeInput?.removeAttribute('disabled');
      twoFactorCodeInput?.focus();
    }
  }

  function setAuthMode(mode) {
    authMode = mode === AUTH_MODES.TWO_FACTOR ? AUTH_MODES.TWO_FACTOR : AUTH_MODES.CREDENTIALS;
    const inCredentialsMode = authMode === AUTH_MODES.CREDENTIALS;
    if (credentialsPanel) credentialsPanel.classList.toggle('hidden', !inCredentialsMode);
    if (twoFactorPanel) twoFactorPanel.classList.toggle('hidden', inCredentialsMode);
    if (inCredentialsMode) {
      pendingChallengeId = '';
      setTwoFactorMethod(TWO_FACTOR_METHODS.TOTP);
      usernameInput?.focus();
    } else {
      setTwoFactorMethod(TWO_FACTOR_METHODS.TOTP);
      setError('Enter your authenticator code to finish signing in.');
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

  async function waitForAuthenticatedSession({ maxAttempts = 6, delayMs = 150 } = {}) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const res = await fetch('/api/profile/bootstrap', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      const authenticated = res.ok && data?.authenticated === true;
      const twoFactorComplete = res.ok && data?.twoFactorComplete === true;
      console.info('[auth-hydration] post-login check', {
        attempt,
        status: res.status,
        authenticated,
        twoFactorComplete
      });
      if (authenticated && twoFactorComplete) return data;
      if (attempt < maxAttempts) {
        await new Promise(resolve => window.setTimeout(resolve, delayMs));
      }
    }
    throw new Error('Session was not fully ready. Please try again.');
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
        setAuthMode(AUTH_MODES.TWO_FACTOR);
        if (typeof challenge.message === 'string' && challenge.message.trim()) {
          setError(challenge.message.trim());
        }
      } else if (res.ok) {
        sessionStorage.removeItem('guestMode');
        localStorage.removeItem('guestMode');
        const session = await waitForAuthenticatedSession();
        window.location.href = session.profileComplete ? '/' : '/profile.html';
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
    const code = selectedTwoFactorMethod === TWO_FACTOR_METHODS.BACKUP_CODE
      ? (twoFactorBackupCodeInput?.value || '').trim()
      : (twoFactorCodeInput?.value || '').trim();
    if (!pendingChallengeId) {
      setError('Your 2FA challenge expired. Please sign in again.');
      setAuthMode(AUTH_MODES.CREDENTIALS);
      return;
    }
    if (!code) {
      setError(selectedTwoFactorMethod === TWO_FACTOR_METHODS.BACKUP_CODE
        ? 'Enter your backup code.'
        : 'Enter your authenticator code.');
      return;
    }
    setLoading(twoFactorVerifyBtn, true, 'Verifying...');
    try {
      const res = await call('/api/login/2fa', {
        challengeId: pendingChallengeId,
        code,
        method: selectedTwoFactorMethod
      });
      const data = await res.json().catch(() => ({ error: '2FA verification failed' }));
      if (res.ok) {
        sessionStorage.removeItem('guestMode');
        localStorage.removeItem('guestMode');
        const session = await waitForAuthenticatedSession();
        window.location.href = session.profileComplete ? '/' : '/profile.html';
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

  twoFactorBackupToggleBtn?.addEventListener('click', () => {
    const nextMethod = selectedTwoFactorMethod === TWO_FACTOR_METHODS.TOTP
      ? TWO_FACTOR_METHODS.BACKUP_CODE
      : TWO_FACTOR_METHODS.TOTP;
    setTwoFactorMethod(nextMethod);
    setError('');
  });

  twoFactorVerifyBtn?.addEventListener('click', handleTwoFactorVerify);
  twoFactorCodeInput?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') handleTwoFactorVerify();
  });
  twoFactorBackupCodeInput?.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') handleTwoFactorVerify();
  });
  twoFactorBackBtn?.addEventListener('click', () => {
    setAuthMode(AUTH_MODES.CREDENTIALS);
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

  setAuthMode(AUTH_MODES.CREDENTIALS);
}

document.addEventListener('DOMContentLoaded', createLoginHandlers);
