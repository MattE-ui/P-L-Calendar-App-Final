/* ════════════════════════════════════════════════════════════
   investor-portal.js
   Shared JS for all investor-facing pages:
     /investor/login
     /investor/change-password
     /investor/activate
     /investor/dashboard
     /investor/preview
   ════════════════════════════════════════════════════════════ */

// ── Shared utilities ─────────────────────────────────────────

function investorApi(path, opts = {}, previewToken = '') {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (previewToken) headers.Authorization = `Bearer ${previewToken}`;
  return fetch(path, { credentials: 'include', ...opts, headers }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  });
}

function formatGBP(value) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function formatPct(value, digits = 2) {
  return `${(Number(value) || 0).toFixed(digits)}%`;
}

function relativeTime(isoString) {
  if (!isoString) return 'never';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

function absoluteDate(isoString) {
  if (!isoString) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(isoString));
}

function absoluteDateFull(isoString) {
  if (!isoString) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  }).format(new Date(isoString));
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Login page ───────────────────────────────────────────────

async function initInvestorLogin() {
  const btn = document.getElementById('investor-login-btn');
  if (!btn) return;

  async function attemptLogin() {
    const errorEl = document.getElementById('investor-login-error');
    if (errorEl) errorEl.textContent = '';
    const email = document.getElementById('investor-email')?.value?.trim() || '';
    const password = document.getElementById('investor-password')?.value || '';
    if (!email || !password) {
      if (errorEl) errorEl.textContent = 'Email and password are required.';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const result = await investorApi('/api/investor/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (result.mustChangePassword) {
        window.location.href = '/investor/change-password';
      } else {
        window.location.href = '/investor/dashboard';
      }
    } catch (error) {
      if (errorEl) errorEl.textContent = error.message;
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  }

  btn.addEventListener('click', attemptLogin);

  document.getElementById('investor-password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptLogin();
  });
}

// ── Change-password page ─────────────────────────────────────

async function initInvestorChangePassword() {
  const btn = document.getElementById('cp-submit-btn');
  if (!btn) return;

  async function attemptChange() {
    const errorEl = document.getElementById('cp-error');
    if (errorEl) errorEl.textContent = '';
    const currentPassword = document.getElementById('cp-current')?.value || '';
    const newPassword = document.getElementById('cp-new')?.value || '';
    const confirmPassword = document.getElementById('cp-confirm')?.value || '';
    if (!currentPassword || !newPassword || !confirmPassword) {
      if (errorEl) errorEl.textContent = 'All fields are required.';
      return;
    }
    if (newPassword !== confirmPassword) {
      if (errorEl) errorEl.textContent = 'New passwords do not match.';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await investorApi('/api/investor/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      window.location.href = '/investor/dashboard';
    } catch (error) {
      if (errorEl) errorEl.textContent = error.message;
      btn.disabled = false;
      btn.textContent = 'Set password & continue';
    }
  }

  btn.addEventListener('click', attemptChange);

  document.getElementById('cp-confirm')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptChange();
  });
}

// ── Activate page (invite-link flow) ─────────────────────────

async function initInvestorActivate() {
  const btn = document.getElementById('investor-activate-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const errorEl = document.getElementById('investor-activate-error');
    const okEl = document.getElementById('investor-activate-ok');
    if (errorEl) errorEl.textContent = '';
    if (okEl) okEl.textContent = '';
    try {
      const token = new URLSearchParams(window.location.search).get('token') || '';
      const password = document.getElementById('investor-activate-password')?.value || '';
      const confirmPassword = document.getElementById('investor-activate-password-confirm')?.value || '';
      if (password !== confirmPassword) throw new Error('Passwords do not match.');
      await investorApi('/api/investor/auth/activate', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      if (okEl) okEl.textContent = 'Activation complete. Redirecting to login…';
      setTimeout(() => { window.location.href = '/investor/login'; }, 1200);
    } catch (error) {
      if (errorEl) errorEl.textContent = error.message;
    }
  });
}

// ── Dashboard page ───────────────────────────────────────────

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setHtml(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

async function renderInvestorDashboard(data) {
  // Must-change-password guard: redirect if flag still set
  if (data.mustChangePassword) {
    window.location.href = '/investor/change-password';
    return;
  }

  // Header
  const avatarEl = document.getElementById('dash-avatar');
  if (avatarEl) avatarEl.textContent = initials(data.name);
  setText('dash-first-name', data.firstName);

  // Page title block
  setText('dash-welcome', `Welcome back, ${data.firstName}`);
  const valuationLine = data.lastValuationAt
    ? `Last valued ${relativeTime(data.lastValuationAt)} · ${absoluteDate(data.lastValuationAt)}`
    : 'No valuation recorded yet';
  setText('dash-valuation-line', valuationLine);

  // Hero card — current value
  setText('dash-current-value', formatGBP(data.currentValue));

  const isSuspended = data.status === 'suspended';
  const pnlNum = Number(data.pnl) || 0;
  const returnNum = Number(data.returnPct) || 0;

  const deltaEl = document.getElementById('dash-delta');
  if (deltaEl) {
    const sign = pnlNum > 0 ? '+' : '';
    deltaEl.textContent = `${sign}${formatGBP(pnlNum)} (${sign}${formatPct(returnNum)})`;
    deltaEl.className = 'investor-hero-card__delta';
    if (!isSuspended) {
      if (pnlNum > 0) deltaEl.classList.add('is-positive');
      else if (pnlNum < 0) deltaEl.classList.add('is-negative');
    }
  }

  // Hero bottom cols
  setText('dash-capital', formatGBP(data.capitalInvested));

  const pnlColEl = document.getElementById('dash-pnl');
  if (pnlColEl) {
    pnlColEl.textContent = formatGBP(pnlNum);
    if (!isSuspended) {
      pnlColEl.style.color = pnlNum > 0
        ? 'var(--success)'
        : pnlNum < 0 ? 'var(--danger)' : '';
    }
  }

  setText('dash-split', `${formatPct(data.profitSplitPct)} of profits`);

  // Return metric card
  const returnEl = document.getElementById('dash-return');
  if (returnEl) {
    const sign = returnNum > 0 ? '+' : '';
    returnEl.textContent = `${sign}${formatPct(returnNum)}`;
    if (!isSuspended) {
      returnEl.style.color = returnNum > 0
        ? 'var(--success)'
        : returnNum < 0 ? 'var(--danger)' : '';
    }
  }

  // Status metric card
  const statusCellEl = document.getElementById('dash-status-cell');
  if (statusCellEl) {
    const dot = document.createElement('span');
    dot.className = `investor-status-dot ${data.status}`;
    const label = document.createElement('span');
    label.textContent = data.status === 'active' ? 'Active' : 'Suspended';
    statusCellEl.innerHTML = '';
    statusCellEl.appendChild(dot);
    statusCellEl.appendChild(label);
    if (data.status === 'suspended') {
      statusCellEl.style.color = 'var(--danger)';
    }
  }

  // Account details card
  setText('dash-holder', data.name);
  setText('dash-split-detail', `${formatPct(data.profitSplitPct)} to you · ${formatPct(data.masterSplitPct)} to manager`);
  setText('dash-last-val', data.lastValuationAt ? absoluteDateFull(data.lastValuationAt) : 'Not yet recorded');
  setText('dash-reporting', data.status === 'active' ? 'Active' : 'Suspended');
}

async function initInvestorDashboardOrPreview() {
  const contentEl = document.getElementById('investor-dash-content');
  if (!contentEl) return;

  const loadingEl = document.getElementById('investor-dash-loading');
  const errorEl = document.getElementById('investor-dash-error');
  const errorMsgEl = document.getElementById('investor-dash-error-msg');

  const isPreview = window.location.pathname === '/investor/preview';
  const previewToken = isPreview
    ? new URLSearchParams(window.location.search).get('token') || ''
    : '';

  const previewBadge = document.getElementById('investor-preview-badge');
  if (previewBadge) previewBadge.hidden = !(isPreview && previewToken);

  async function load() {
    if (loadingEl) loadingEl.hidden = false;
    if (errorEl) errorEl.hidden = true;
    contentEl.hidden = true;

    try {
      const data = await investorApi('/api/investor/me', {}, previewToken);
      if (loadingEl) loadingEl.hidden = true;
      contentEl.hidden = false;
      await renderInvestorDashboard(data);
    } catch (error) {
      if (loadingEl) loadingEl.hidden = true;
      if (error.status === 401 && !isPreview) {
        window.location.href = '/investor/login';
        return;
      }
      if (errorEl) errorEl.hidden = false;
      if (errorMsgEl) errorMsgEl.textContent = error.message || 'Unable to load dashboard.';
    }
  }

  document.getElementById('investor-dash-retry')?.addEventListener('click', load);

  document.getElementById('investor-logout-btn')?.addEventListener('click', async () => {
    await investorApi('/api/investor/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/investor/login';
  });

  await load();
}

// ── Boot ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initInvestorLogin();
  initInvestorChangePassword();
  initInvestorActivate();
  initInvestorDashboardOrPreview();
});
