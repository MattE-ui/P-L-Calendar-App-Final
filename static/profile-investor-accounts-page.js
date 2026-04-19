(async function initInvestorAccountsPage() {
  const { api, setText } = window.AccountCenter;

  // ── State ─────────────────────────────────────────────────

  const state = {
    investorModeEnabled: false,
    investors: [],
    deletedInvestors: [],
    showDeleted: false,
    perfById: new Map(),
    valuations: []
  };

  // ── Formatting ────────────────────────────────────────────

  const formatCurrency = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '—';
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(amount);
  };

  const formatPercent = (value, digits = 2) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '—';
    return `${amount.toFixed(digits)}%`;
  };

  const statusClass = (status) => (String(status || '').toLowerCase() === 'active' ? 'active' : 'suspended');

  const today = () => new Date().toISOString().slice(0, 10);

  // ── Password generator ────────────────────────────────────

  function generateStrongPassword() {
    const upper  = 'ABCDEFGHJKMNPQRSTUVWXYZ';
    const lower  = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const syms   = '!@#$%^&*-_=+';

    const pick = (pool, n) => {
      const arr = [];
      const buf = new Uint32Array(n);
      crypto.getRandomValues(buf);
      for (let i = 0; i < n; i++) arr.push(pool[buf[i] % pool.length]);
      return arr;
    };

    let chars = [
      ...pick(upper, 2),
      ...pick(lower, 2),
      ...pick(digits, 2),
      ...pick(syms, 2)
    ];

    const full = upper + lower + digits + syms;
    chars = chars.concat(pick(full, 16 - chars.length));

    const shuffle = new Uint32Array(chars.length);
    crypto.getRandomValues(shuffle);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = shuffle[i] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
  }

  function attachGenButton(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', () => {
      input.value = generateStrongPassword();
      const icon = btn.querySelector('.ia-gen-icon');
      if (icon) {
        icon.classList.remove('ia-gen-spin');
        void icon.offsetWidth;
        icon.classList.add('ia-gen-spin');
      }
    });
  }

  // ── Modal helpers ─────────────────────────────────────────

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    const first = el.querySelector('input, button:not([aria-label="Close"]), select, textarea');
    if (first) setTimeout(() => first.focus(), 50);
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  function trapEscape(e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not([hidden])').forEach(m => { m.hidden = true; });
      closeDrawer();
    }
  }
  document.addEventListener('keydown', trapEscape);

  document.querySelectorAll('.modal-close[data-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal(overlay.id);
    });
  });

  // ── Aggregate metrics ─────────────────────────────────────

  const getAggregateMetrics = () => {
    const totals = state.investors.reduce((acc, investor) => {
      const perf = state.perfById.get(investor.id) || {};
      const capital = Number(perf.net_contributions || 0);
      const pnl = Number(perf.investor_profit_share || 0);
      const returnPct = Number(perf.investor_return_pct || 0);
      const bps = Number(investor.investor_share_bps ?? perf.investor_share_bps ?? NaN);
      if (Number.isFinite(capital)) acc.capital += capital;
      if (Number.isFinite(pnl)) acc.pnl += pnl;
      if (Number.isFinite(returnPct)) { acc.returnTotal += returnPct; acc.returnCount += 1; }
      if (Number.isFinite(bps)) { acc.splitTotal += bps; acc.splitCount += 1; }
      return acc;
    }, { capital: 0, pnl: 0, returnTotal: 0, returnCount: 0, splitTotal: 0, splitCount: 0 });

    return {
      investorCount: state.investors.length,
      capital: totals.capital,
      pnl: totals.pnl,
      avgReturnPct: totals.returnCount ? (totals.returnTotal / totals.returnCount) : null,
      avgSplitPct: totals.splitCount ? (totals.splitTotal / totals.splitCount / 100) : null
    };
  };

  // ── Status strip ──────────────────────────────────────────

  const renderStatusStrip = () => {
    const dot = document.getElementById('ia-strip-dot');
    const label = document.getElementById('ia-strip-label');
    const toggleBtn = document.getElementById('investor-mode-toggle');
    const modeMetrics = document.getElementById('investor-mode-metrics');

    const on = state.investorModeEnabled;

    if (dot) {
      dot.className = `ia-status-dot ${on ? 'ia-status-dot--on' : 'ia-status-dot--off'}`;
    }
    if (label) {
      label.innerHTML = `Investor mode <strong>${on ? 'enabled' : 'disabled'}</strong>`;
    }
    if (toggleBtn) {
      toggleBtn.textContent = on ? 'Disable investor mode' : 'Enable investor mode';
      toggleBtn.classList.toggle('danger', on);
    }
    if (modeMetrics) {
      if (on) {
        const m = getAggregateMetrics();
        modeMetrics.hidden = false;
        modeMetrics.innerHTML = `
          <span>${m.investorCount} investor${m.investorCount === 1 ? '' : 's'}</span>
          <span>Capital: ${formatCurrency(m.capital)}</span>
          <span>PnL: ${formatCurrency(m.pnl)}</span>
        `;
      } else {
        modeMetrics.hidden = true;
      }
    }
  };

  // ── Summary row (5 metrics) ───────────────────────────────

  const renderSummary = () => {
    const container = document.getElementById('investor-summary-metrics');
    if (!container) return;
    const m = getAggregateMetrics();
    const latestNav = state.valuations.length ? state.valuations[0] : null;
    const latestNavVal = latestNav ? Number(latestNav.nav) : null;

    const metric = (label, value, sub = '') => `
      <div class="ia-summary-metric">
        <span class="ia-summary-metric__label">${label}</span>
        <span class="ia-summary-metric__value">${value}</span>
        ${sub ? `<span class="ia-summary-metric__sub">${sub}</span>` : ''}
      </div>`;

    const pnlClass = m.pnl >= 0 ? '' : 'style="color:var(--negative,#e05c5c)"';

    container.innerHTML = [
      metric('Investors', String(m.investorCount), m.investorCount ? `${m.investorCount} active` : 'none yet'),
      metric('Total capital', formatCurrency(m.capital)),
      metric('Total PnL', `<span ${pnlClass}>${formatCurrency(m.pnl)}</span>`),
      metric('Avg return', m.avgReturnPct !== null ? formatPercent(m.avgReturnPct) : '—'),
      metric('Latest NAV', latestNavVal !== null ? formatCurrency(latestNavVal) : '—', latestNav ? latestNav.valuationDate : '')
    ].join('');
  };

  // ── NAV sparkline ─────────────────────────────────────────

  function buildSparkline(valuations, svgId, viewW = 300, viewH = 60) {
    const svg = document.getElementById(svgId);
    if (!svg) return;

    const rows = [...valuations]
      .filter(v => Number.isFinite(Number(v.nav)))
      .sort((a, b) => String(a.valuationDate).localeCompare(String(b.valuationDate)));

    if (rows.length < 2) {
      svg.innerHTML = '';
      return;
    }

    const navs = rows.map(r => Number(r.nav));
    const minNav = Math.min(...navs);
    const maxNav = Math.max(...navs);
    const range = maxNav - minNav || 1;
    const pad = 4;

    const toX = (i) => pad + (i / (rows.length - 1)) * (viewW - pad * 2);
    const toY = (v) => viewH - pad - ((v - minNav) / range) * (viewH - pad * 2);

    const pts = rows.map((r, i) => `${toX(i).toFixed(1)},${toY(Number(r.nav)).toFixed(1)}`).join(' ');
    const firstX = toX(0).toFixed(1);
    const lastX  = toX(rows.length - 1).toFixed(1);
    const lastY  = toY(navs[navs.length - 1]).toFixed(1);
    const gradId = `sp-grad-${svgId}`;

    svg.innerHTML = `
      <defs>
        <linearGradient id="${gradId}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <polygon points="${pts} ${lastX},${viewH} ${firstX},${viewH}" fill="url(#${gradId})"/>
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lastX}" cy="${lastY}" r="3" fill="var(--accent)"/>
    `;
  }

  // ── NAV card ──────────────────────────────────────────────

  const renderNavCard = () => {
    const navValue  = document.getElementById('ia-nav-current');
    const navDelta  = document.getElementById('ia-nav-delta');
    const navDate   = document.getElementById('ia-nav-date');
    const sparkHint = document.getElementById('ia-sparkline-hint');

    const sorted = [...state.valuations]
      .filter(v => Number.isFinite(Number(v.nav)))
      .sort((a, b) => {
        const d = String(b.valuationDate).localeCompare(String(a.valuationDate));
        return d !== 0 ? d : String(b.createdAt).localeCompare(String(a.createdAt));
      });

    if (!sorted.length) {
      if (navValue) navValue.textContent = '—';
      if (navDelta) navDelta.hidden = true;
      if (navDate) navDate.textContent = 'No valuations recorded yet';
      if (sparkHint) sparkHint.textContent = '';
      buildSparkline([], 'ia-sparkline');
      return;
    }

    const latest = sorted[0];
    const prior  = sorted[1];
    const latestNav = Number(latest.nav);

    if (navValue) navValue.textContent = formatCurrency(latestNav);
    if (navDate) navDate.textContent = `As of ${latest.valuationDate}`;

    if (navDelta && prior) {
      const priorNav = Number(prior.nav);
      if (Number.isFinite(priorNav) && priorNav > 0) {
        const pct = ((latestNav - priorNav) / priorNav) * 100;
        const up = pct >= 0;
        navDelta.textContent = `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%`;
        navDelta.className = `ia-nav-delta ${up ? 'ia-nav-delta--up' : 'ia-nav-delta--down'}`;
        navDelta.hidden = false;
      } else {
        navDelta.hidden = true;
      }
    } else if (navDelta) {
      navDelta.hidden = true;
    }

    buildSparkline(sorted, 'ia-sparkline');

    if (sparkHint) {
      sparkHint.textContent = sorted.length > 1 ? `${sorted.length} valuations` : '';
    }
  };

  const renderAll = () => {
    renderStatusStrip();
    renderSummary();
    renderNavCard();
    renderInvestorCards();
  };

  // ── Investor cards ────────────────────────────────────────

  const renderInvestorCards = () => {
    const list = document.getElementById('investor-list');
    if (!list) return;

    const activeList = state.investors;
    const deletedList = state.showDeleted ? state.deletedInvestors : [];
    const allVisible = [...activeList, ...deletedList];

    if (!allVisible.length) {
      list.innerHTML = '<p class="helper">No investor accounts yet. Configure investor mode and create investor profiles to populate this dashboard.</p>';
      return;
    }

    list.innerHTML = allVisible.map((inv) => {
      const isDeleted = !!inv.deletedAt;
      const perf = state.perfById.get(inv.id) || {};
      const status = String(inv.status || 'active').toLowerCase();
      const split = Number(inv.investor_share_bps ?? perf.investor_share_bps ?? 0) / 100;
      const pnl = Number(perf.investor_profit_share || 0);

      if (isDeleted) {
        return `
          <article class="investor-account-card ia-card-deleted" data-investor-id="${inv.id}">
            <div class="investor-account-card__head">
              <div>
                <h3>${inv.displayName || inv.email || inv.id}</h3>
                <p class="helper">${inv.email || 'No login email'}</p>
              </div>
              <span class="status-badge suspended">Deleted</span>
            </div>
            <p class="helper" style="margin:4px 0;font-size:12px">Deleted ${inv.deletedAt ? new Date(inv.deletedAt).toLocaleDateString('en-GB') : ''}</p>
            <div class="profile-actions investor-account-card__actions">
              <button class="ghost small investor-restore" data-id="${inv.id}" data-name="${inv.displayName || ''}" type="button">Restore</button>
              <button class="ghost small ia-danger-btn investor-purge" data-id="${inv.id}" data-name="${inv.displayName || ''}" type="button">Permanently delete</button>
            </div>
          </article>
        `;
      }

      return `
        <article class="investor-account-card ${statusClass(status)}" data-investor-id="${inv.id}">
          <div class="investor-account-card__head">
            <div>
              <h3>${inv.displayName || inv.email || inv.id}</h3>
              <p class="helper">${inv.email || 'No login email configured'}</p>
            </div>
            <span class="status-badge ${statusClass(status)}">${status === 'active' ? 'Active' : 'Suspended'}</span>
          </div>
          <div class="investor-account-card__metrics">
            <article><span>Capital allocated</span><strong>${formatCurrency(perf.net_contributions)}</strong></article>
            <article><span>PnL</span><strong class="${pnl >= 0 ? 'pos' : 'neg'}">${formatCurrency(pnl)}</strong></article>
            <article><span>Return %</span><strong>${formatPercent(perf.investor_return_pct)}</strong></article>
            <article><span>Profit split %</span><strong>${Number.isFinite(split) ? split.toFixed(2) + '%' : '—'}</strong></article>
          </div>
          <div class="profile-actions investor-account-card__actions">
            <button class="ghost small investor-manage" data-id="${inv.id}" type="button">Manage</button>
            <button class="ghost small investor-view" data-id="${inv.id}" type="button">View</button>
            <button class="ghost small investor-reset-pw" data-id="${inv.id}" data-name="${inv.displayName || ''}" type="button">Reset password</button>
            <button class="ghost small investor-invite" data-id="${inv.id}" type="button">Send invite</button>
            <button class="ghost small investor-suspend" data-id="${inv.id}" data-next="${status === 'active' ? 'suspended' : 'active'}" type="button">${status === 'active' ? 'Suspend' : 'Reactivate'}</button>
            <button class="ghost small ia-danger-btn investor-delete" data-id="${inv.id}" data-name="${inv.displayName || ''}" type="button">Delete</button>
          </div>
        </article>
      `;
    }).join('');

    list.querySelectorAll('.investor-manage').forEach((btn) => {
      btn.addEventListener('click', () => openManageDrawer(btn.dataset.id));
    });

    list.querySelectorAll('.investor-view').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        const data = await api(`/api/master/investors/${btn.dataset.id}/preview-token`);
        window.open(`/investor/preview?token=${encodeURIComponent(data.token)}`, '_blank', 'noopener');
      } catch (error) {
        setText('investor-status', error.message || 'Unable to open investor preview.');
      }
    }));

    list.querySelectorAll('.investor-reset-pw').forEach((btn) => {
      btn.addEventListener('click', () => openResetPwModal(btn.dataset.id, btn.dataset.name));
    });

    list.querySelectorAll('.investor-invite').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        const data = await api(`/api/master/investors/${btn.dataset.id}/invite`, { method: 'POST' });
        openInviteLinkModal(data.inviteUrl);
      } catch (error) {
        setText('investor-status', error.message || 'Unable to generate invite link.');
      }
    }));

    list.querySelectorAll('.investor-suspend').forEach((btn) => btn.addEventListener('click', async () => {
      const { id, next } = btn.dataset;
      if (!id || !next) return;
      try {
        await api(`/api/master/investors/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next })
        });
        setText('investor-status', `Investor status updated to ${next}.`);
        await loadInvestorData();
      } catch (error) {
        setText('investor-status', error.message || 'Unable to update status.');
      }
    }));

    list.querySelectorAll('.investor-delete').forEach((btn) => {
      btn.addEventListener('click', () => openDeleteConfirm(btn.dataset.id, btn.dataset.name));
    });

    list.querySelectorAll('.investor-restore').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await api(`/api/master/investors/${btn.dataset.id}/restore`, { method: 'POST' });
        await loadInvestorData();
      } catch (error) {
        setText('investor-status', error.message || 'Unable to restore investor.');
      }
    }));

    list.querySelectorAll('.investor-purge').forEach((btn) => {
      btn.addEventListener('click', () => openPurgeConfirm(btn.dataset.id, btn.dataset.name));
    });
  };

  // ── Data loading ──────────────────────────────────────────

  async function loadInvestorData() {
    const sentinel = Symbol('fail');
    const safe = p => p.catch(err => { console.error('[investor-accounts] fetch failed:', err); return sentinel; });

    const [livePayload, deletedPayload, performancePayload, valuationPayload] = await Promise.all([
      safe(api('/api/master/investors')),
      safe(api('/api/master/investors?include_deleted=true')),
      safe(api('/api/master/investors/performance')),
      safe(api('/api/master/valuations'))
    ]);

    let anyChange = false;

    if (livePayload !== sentinel) {
      state.investors = Array.isArray(livePayload?.investors) ? livePayload.investors : [];
      anyChange = true;
    }
    if (deletedPayload !== sentinel) {
      const allInvestors = Array.isArray(deletedPayload?.investors) ? deletedPayload.investors : [];
      state.deletedInvestors = allInvestors.filter(i => i.deletedAt != null);
      anyChange = true;
    }
    if (performancePayload !== sentinel) {
      const performanceRows = Array.isArray(performancePayload?.investors) ? performancePayload.investors : [];
      state.perfById = new Map(performanceRows.map((row) => [row.investor_profile_id, row]));
      anyChange = true;
    }
    if (valuationPayload !== sentinel) {
      state.valuations = Array.isArray(valuationPayload?.valuations) ? valuationPayload.valuations : [];
      anyChange = true;
    }

    if (anyChange) renderAll();
  }

  // ── Init mode toggle ──────────────────────────────────────

  try {
    const profile = await api('/api/profile');
    state.investorModeEnabled = !!profile.investorAccountsEnabled;
  } catch (error) {
    setText('investor-status', error.message);
  }

  document.getElementById('investor-mode-toggle')?.addEventListener('click', async () => {
    try {
      const enabled = !state.investorModeEnabled;
      await api('/api/account/investor-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      state.investorModeEnabled = enabled;
      setText('investor-status', enabled ? 'Investor mode enabled.' : 'Investor mode disabled.');
      renderStatusStrip();
      // Sync settings modal checkbox if open
      const isModeToggle = document.getElementById('is-mode-toggle');
      if (isModeToggle) isModeToggle.checked = enabled;
    } catch (error) {
      setText('investor-status', error.message);
    }
  });

  document.getElementById('show-deleted-toggle')?.addEventListener('change', (e) => {
    state.showDeleted = e.target.checked;
    renderInvestorCards();
  });

  await loadInvestorData();

  // ── Password generator buttons ────────────────────────────

  attachGenButton('ci-gen-btn', 'ci-temp-password');
  attachGenButton('rp-gen-btn', 'rp-password');

  // ── Create investor modal ─────────────────────────────────

  document.getElementById('create-investor-btn')?.addEventListener('click', () => {
    document.getElementById('ci-name').value = '';
    document.getElementById('ci-email').value = '';
    document.getElementById('ci-temp-password').value = '';
    document.getElementById('create-investor-error').textContent = '';
    document.getElementById('create-investor-result').hidden = true;
    const submitBtn = document.getElementById('ci-submit-btn');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create account';
    openModal('create-investor-modal');
  });

  document.getElementById('ci-submit-btn')?.addEventListener('click', async () => {
    const errorEl = document.getElementById('create-investor-error');
    const resultEl = document.getElementById('create-investor-result');
    errorEl.textContent = '';
    resultEl.hidden = true;

    const displayName = document.getElementById('ci-name').value.trim();
    const email = document.getElementById('ci-email').value.trim();
    const tempPassword = document.getElementById('ci-temp-password').value;

    if (!displayName) { errorEl.textContent = 'Display name is required.'; return; }
    if (!email) { errorEl.textContent = 'Email is required.'; return; }

    const submitBtn = document.getElementById('ci-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';

    try {
      const body = { display_name: displayName, email };
      if (tempPassword) body.temp_password = tempPassword;
      await api('/api/master/investors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (tempPassword) {
        resultEl.innerHTML = `
          <p style="margin:0 0 6px;font-weight:600;color:var(--accent)">Account created — share these credentials</p>
          <p style="margin:0 0 2px;font-size:13px;color:var(--text-muted)">Login URL: <strong style="color:var(--text)">${window.location.origin}/investor/login</strong></p>
          <p style="margin:0 0 2px;font-size:13px;color:var(--text-muted)">Email: <strong style="color:var(--text)">${email}</strong></p>
          <p style="margin:0;font-size:13px;color:var(--text-muted)">Temporary password: <strong style="color:var(--text);font-family:monospace">${tempPassword}</strong></p>
          <p style="margin:8px 0 0;font-size:12px;color:var(--text-dim)">The investor must change their password on first login.</p>
        `;
      } else {
        resultEl.innerHTML = `<p style="margin:0;color:var(--accent);font-weight:600">Account created. Use "Send invite" on the card to generate an activation link.</p>`;
      }
      resultEl.hidden = false;
      submitBtn.textContent = 'Done';
      await loadInvestorData();
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to create investor account.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create account';
    }
  });

  // ── Reset-password modal ──────────────────────────────────

  let resetPwTargetId = null;

  function openResetPwModal(investorId, investorName) {
    resetPwTargetId = investorId;
    document.getElementById('rp-investor-name').textContent = `Setting temporary password for: ${investorName || 'this investor'}`;
    document.getElementById('rp-error').textContent = '';
    document.getElementById('rp-copy-status').textContent = '';
    const setBtn = document.getElementById('rp-set-btn');
    setBtn.disabled = false;
    setBtn.textContent = 'Set this password';
    document.getElementById('rp-password').value = generateStrongPassword();
    openModal('reset-pw-modal');
  }

  document.getElementById('rp-copy-btn')?.addEventListener('click', async () => {
    const pw = document.getElementById('rp-password').value;
    const statusEl = document.getElementById('rp-copy-status');
    if (!pw) return;
    try {
      await navigator.clipboard.writeText(pw);
      statusEl.textContent = 'Copied to clipboard.';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } catch (_e) {
      statusEl.textContent = 'Copy failed — please select and copy manually.';
    }
  });

  document.getElementById('rp-set-btn')?.addEventListener('click', async () => {
    const pw = document.getElementById('rp-password').value;
    const errorEl = document.getElementById('rp-error');
    const setBtn = document.getElementById('rp-set-btn');
    errorEl.textContent = '';
    if (!pw || !resetPwTargetId) return;
    setBtn.disabled = true;
    setBtn.textContent = 'Setting…';
    try {
      const data = await api(`/api/master/investors/${resetPwTargetId}/reset-password`, { method: 'POST' });
      document.getElementById('rp-password').value = data.tempPassword;
      const statusEl = document.getElementById('rp-copy-status');
      statusEl.textContent = 'Password set. Share this with the investor.';
      setBtn.textContent = 'Done';
    } catch (error) {
      errorEl.textContent = error.message || 'Failed to reset password.';
      setBtn.disabled = false;
      setBtn.textContent = 'Set this password';
    }
  });

  // ── Invite link modal ─────────────────────────────────────

  function openInviteLinkModal(url) {
    const modal = document.getElementById('delete-confirm-modal');
    const msgEl = document.getElementById('dc-message');
    const errEl = document.getElementById('dc-error');
    const confirmBtn = document.getElementById('dc-confirm-btn');
    const titleEl = document.getElementById('dc-modal-title');

    if (!modal) { prompt('Invite link (valid 72 hours):', url); return; }

    titleEl.textContent = 'Investor invite link';
    msgEl.innerHTML = `Invite link (valid 72 hours):<br><span style="display:block;margin-top:6px;font-family:monospace;font-size:12px;word-break:break-all;color:var(--accent)">${url}</span>`;
    errEl.textContent = '';
    confirmBtn.textContent = 'Copy link';
    confirmBtn.className = 'primary';
    confirmBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        confirmBtn.textContent = 'Copied!';
        setTimeout(() => closeModal('delete-confirm-modal'), 1200);
      } catch (_e) {
        errEl.textContent = 'Copy failed — select the link above manually.';
      }
    };
    openModal('delete-confirm-modal');
    modal.addEventListener('click', restoreDeleteModal, { once: true });
    document.getElementById('dc-modal-title').closest('.modal-overlay')?.querySelectorAll('.modal-close').forEach(b => {
      b.addEventListener('click', restoreDeleteModal, { once: true });
    });
  }

  function restoreDeleteModal() {
    document.getElementById('dc-modal-title').textContent = 'Delete investor';
    document.getElementById('dc-confirm-btn').textContent = 'Delete investor';
    document.getElementById('dc-confirm-btn').className = 'danger';
    document.getElementById('dc-confirm-btn').onclick = null;
  }

  // ── Soft-delete flow ──────────────────────────────────────

  let deleteTargetId = null;

  function openDeleteConfirm(investorId, investorName) {
    deleteTargetId = investorId;
    document.getElementById('dc-message').textContent =
      `Soft delete ${investorName || 'this investor'}? They will no longer appear in your investor list, but their records are retained.`;
    document.getElementById('dc-error').textContent = '';
    document.getElementById('dc-modal-title').textContent = 'Delete investor';
    const confirmBtn = document.getElementById('dc-confirm-btn');
    confirmBtn.textContent = 'Delete investor';
    confirmBtn.className = 'danger';
    confirmBtn.onclick = null;
    openModal('delete-confirm-modal');
  }

  document.getElementById('dc-confirm-btn')?.addEventListener('click', async () => {
    if (!deleteTargetId || document.getElementById('dc-confirm-btn').onclick) return;
    const errEl = document.getElementById('dc-error');
    errEl.textContent = '';
    const btn = document.getElementById('dc-confirm-btn');
    btn.disabled = true;
    try {
      await api(`/api/master/investors/${deleteTargetId}`, { method: 'DELETE' });
      closeModal('delete-confirm-modal');
      deleteTargetId = null;
      await loadInvestorData();
    } catch (error) {
      errEl.textContent = error.message || 'Unable to delete investor.';
      btn.disabled = false;
    }
  });

  // ── Purge (hard-delete) flow ──────────────────────────────

  let purgeTargetId = null;
  let purgeTargetName = '';

  function openPurgeConfirm(investorId, investorName) {
    purgeTargetId = investorId;
    purgeTargetName = investorName || '';
    document.getElementById('pc-name-hint').textContent = purgeTargetName;
    document.getElementById('pc-name-input').value = '';
    document.getElementById('pc-error').textContent = '';
    document.getElementById('pc-confirm-btn').disabled = true;
    openModal('purge-confirm-modal');
  }

  document.getElementById('pc-name-input')?.addEventListener('input', (e) => {
    document.getElementById('pc-confirm-btn').disabled = e.target.value.trim() !== purgeTargetName;
  });

  document.getElementById('pc-confirm-btn')?.addEventListener('click', async () => {
    if (!purgeTargetId) return;
    const errEl = document.getElementById('pc-error');
    errEl.textContent = '';
    const btn = document.getElementById('pc-confirm-btn');
    btn.disabled = true;
    try {
      await api(`/api/master/investors/${purgeTargetId}/purge`, { method: 'DELETE' });
      closeModal('purge-confirm-modal');
      purgeTargetId = null;
      await loadInvestorData();
    } catch (error) {
      errEl.textContent = error.message || 'Unable to purge investor.';
      btn.disabled = false;
    }
  });

  // ══════════════════════════════════════════════════════════
  //  MANAGE DRAWER
  // ══════════════════════════════════════════════════════════

  let drawerInvestorId = null;

  function openDrawer() {
    const overlay = document.getElementById('manage-overlay');
    const drawer = document.getElementById('manage-drawer');
    if (overlay) { overlay.hidden = false; overlay.removeAttribute('aria-hidden'); }
    if (drawer) { drawer.hidden = false; requestAnimationFrame(() => drawer.classList.add('ia-drawer-open')); }
    document.body.classList.add('ia-drawer-open');
  }

  function closeDrawer() {
    const overlay = document.getElementById('manage-overlay');
    const drawer = document.getElementById('manage-drawer');
    if (overlay) { overlay.hidden = true; overlay.setAttribute('aria-hidden', 'true'); }
    if (drawer) { drawer.classList.remove('ia-drawer-open'); drawer.hidden = true; }
    document.body.classList.remove('ia-drawer-open');
    drawerInvestorId = null;
  }

  document.getElementById('manage-overlay')?.addEventListener('click', closeDrawer);
  document.getElementById('manage-drawer-close')?.addEventListener('click', closeDrawer);

  async function openManageDrawer(investorId) {
    drawerInvestorId = investorId;
    document.getElementById('md-investor-name').textContent = '…';
    document.getElementById('md-status-badge').textContent = '';
    document.getElementById('manage-drawer-body').innerHTML = '<p class="helper ia-drawer-loading">Loading…</p>';
    openDrawer();
    await loadManageDrawer(investorId);
  }

  async function loadManageDrawer(investorId) {
    const body = document.getElementById('manage-drawer-body');
    try {
      const [inv, perfData, cashflowsData] = await Promise.all([
        api(`/api/master/investors/${investorId}`),
        api(`/api/master/investors/${investorId}/performance`).catch(() => null),
        api(`/api/master/investors/${investorId}/cashflows?limit=20`)
      ]);

      document.getElementById('md-investor-name').textContent = inv.displayName || inv.id;
      const badge = document.getElementById('md-status-badge');
      badge.textContent = inv.status === 'active' ? 'Active' : 'Suspended';
      badge.className = `ia-drawer-header__badge status-badge ${inv.status === 'active' ? 'active' : 'suspended'}`;

      const investorSharePct = ((Number(inv.investor_share_bps) || 0) / 100).toFixed(2);
      const effectiveFrom = inv.effective_from || '';
      const perf = perfData && !perfData.error ? perfData : null;

      body.innerHTML = `
        <section class="ia-drawer-section">
          <h3 class="ia-drawer-section__title">Account details</h3>
          <label for="md-name">Display name</label>
          <input id="md-name" type="text" value="${inv.displayName || ''}" autocomplete="off">
          <label for="md-status-select">Status</label>
          <select id="md-status-select">
            <option value="active" ${inv.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="suspended" ${inv.status === 'suspended' ? 'selected' : ''}>Suspended</option>
          </select>
          <label for="md-split">Investor profit share %</label>
          <p class="helper" style="margin:2px 0 6px;font-size:12px">Current: <strong>${investorSharePct}%</strong>${effectiveFrom ? ` (effective from ${effectiveFrom})` : ''}</p>
          <input id="md-split" type="number" min="0" max="100" step="0.01" value="${investorSharePct}">
          <div class="profile-actions" style="margin-top:14px">
            <button id="md-save-btn" class="primary small" type="button">Save changes</button>
          </div>
          <p class="helper ia-save-status" id="md-save-status" style="min-height:1.2em;margin-top:6px"></p>
          <div id="md-save-error" class="error" style="min-height:1.2em"></div>
        </section>

        <section class="ia-drawer-section">
          <h3 class="ia-drawer-section__title">Capital &amp; performance</h3>
          ${perf ? `
            <div class="ia-perf-grid">
              <div class="ia-perf-item"><span>Capital invested</span><strong>${formatCurrency(perf.net_contributions)}</strong></div>
              <div class="ia-perf-item"><span>PnL</span><strong class="${Number(perf.investor_profit_share) >= 0 ? 'pos' : 'neg'}">${formatCurrency(perf.investor_profit_share)}</strong></div>
              <div class="ia-perf-item"><span>Current value</span><strong>${formatCurrency(Number(perf.net_contributions || 0) + Number(perf.investor_profit_share || 0))}</strong></div>
              <div class="ia-perf-item"><span>Return</span><strong>${formatPercent(Number(perf.investor_return_pct || 0) * 100)}</strong></div>
            </div>
          ` : '<p class="helper" style="margin:0">No valuations recorded yet.</p>'}
          <p class="helper" style="margin:10px 0 12px;font-size:12px">Capital and PnL are derived from cashflows and master valuations.</p>
          <button class="ghost small" id="md-toggle-cashflow-form" type="button">+ Record cashflow</button>
          <div id="md-cashflow-form" class="ia-cashflow-form" hidden>
            <label for="md-cf-type">Type</label>
            <select id="md-cf-type">
              <option value="deposit">Deposit</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="fee">Fee</option>
            </select>
            <label for="md-cf-amount">Amount (GBP)</label>
            <input id="md-cf-amount" type="number" min="0.01" step="0.01" placeholder="0.00">
            <label for="md-cf-date">Effective date</label>
            <input id="md-cf-date" type="date" value="${today()}">
            <label for="md-cf-ref">Reference (optional)</label>
            <input id="md-cf-ref" type="text" placeholder="e.g. Initial deposit">
            <div id="md-cf-error" class="error" style="min-height:1.2em"></div>
            <div class="profile-actions" style="margin-top:10px">
              <button id="md-cf-submit" class="primary small" type="button">Record cashflow</button>
              <button id="md-cf-cancel" class="ghost small" type="button">Cancel</button>
            </div>
          </div>
        </section>

        <section class="ia-drawer-section">
          <h3 class="ia-drawer-section__title">Recent cashflows</h3>
          <div id="md-cashflows-list">${renderCashflowsList(cashflowsData?.cashflows || [], investorId)}</div>
        </section>

        <section class="ia-drawer-section ia-danger-zone">
          <h3 class="ia-drawer-section__title ia-danger-title">Danger zone</h3>
          <p class="helper" style="margin:0 0 10px">Soft-delete removes this investor from your active list. Records are retained and can be restored.</p>
          <button class="ghost small ia-danger-btn" id="md-delete-btn" data-id="${inv.id}" data-name="${inv.displayName || ''}" type="button">Delete investor</button>
        </section>
      `;

      document.getElementById('md-save-btn')?.addEventListener('click', () => handleManageSave(investorId));

      const toggleCfBtn = document.getElementById('md-toggle-cashflow-form');
      const cfForm = document.getElementById('md-cashflow-form');
      toggleCfBtn?.addEventListener('click', () => {
        const isHidden = cfForm.hidden;
        cfForm.hidden = !isHidden;
        toggleCfBtn.textContent = isHidden ? '− Cancel cashflow' : '+ Record cashflow';
      });
      document.getElementById('md-cf-cancel')?.addEventListener('click', () => {
        cfForm.hidden = true;
        toggleCfBtn.textContent = '+ Record cashflow';
      });
      document.getElementById('md-cf-submit')?.addEventListener('click', () => handleCashflowSubmit(investorId));

      document.getElementById('md-delete-btn')?.addEventListener('click', (e) => {
        closeDrawer();
        openDeleteConfirm(e.currentTarget.dataset.id, e.currentTarget.dataset.name);
      });

    } catch (error) {
      console.error('[loadManageDrawer] failed:', error);
      const msg = error.message || 'Failed to load investor details.';
      body.innerHTML = `<div class="ia-drawer-error">
        <p class="error">${msg}</p>
        <button class="btn btn--sm" id="md-retry-btn">Retry</button>
      </div>`;
      document.getElementById('md-retry-btn')?.addEventListener('click', () => loadManageDrawer(investorId));
    }
  }

  function renderCashflowsList(cashflows, investorId) {
    if (!cashflows.length) return '<p class="helper" style="margin:0">No cashflows recorded yet.</p>';
    const typeColor = { deposit: 'ia-cf-deposit', withdrawal: 'ia-cf-withdrawal', fee: 'ia-cf-fee' };
    return `<table class="ia-cf-table">
      <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Ref</th><th></th></tr></thead>
      <tbody>${cashflows.map(row => `
        <tr>
          <td>${row.effectiveDate}</td>
          <td><span class="ia-cf-badge ${typeColor[row.type] || ''}">${row.type}</span></td>
          <td>${formatCurrency(row.amount)}</td>
          <td class="ia-cf-ref">${row.reference || '—'}</td>
          <td><button class="ghost small ia-cf-del" data-id="${row.id}" data-investor="${investorId}" title="Delete cashflow" aria-label="Delete cashflow">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4h10M6 4V2h4v2M5 4v9h6V4H5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  document.getElementById('manage-drawer-body')?.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('.ia-cf-del');
    if (!delBtn) return;
    const { id: cashflowId, investor: investorId } = delBtn.dataset;
    if (!cashflowId || !investorId) return;
    if (!window.confirm('Delete this cashflow? This will affect capital and PnL calculations.')) return;
    try {
      await api(`/api/master/investors/${investorId}/cashflows/${cashflowId}`, { method: 'DELETE' });
      await loadManageDrawer(investorId);
    } catch (error) {
      setText('investor-status', error.message || 'Unable to delete cashflow.');
    }
  });

  async function handleManageSave(investorId) {
    const saveBtn = document.getElementById('md-save-btn');
    const saveStatus = document.getElementById('md-save-status');
    const saveError = document.getElementById('md-save-error');
    saveStatus.textContent = '';
    saveError.textContent = '';
    saveBtn.disabled = true;

    const displayName = document.getElementById('md-name')?.value.trim();
    const status = document.getElementById('md-status-select')?.value;
    const splitPctRaw = parseFloat(document.getElementById('md-split')?.value);

    if (!displayName) { saveError.textContent = 'Display name cannot be empty.'; saveBtn.disabled = false; return; }
    if (!Number.isFinite(splitPctRaw) || splitPctRaw < 0 || splitPctRaw > 100) {
      saveError.textContent = 'Profit share must be between 0 and 100.'; saveBtn.disabled = false; return;
    }

    const investor_share_bps = Math.round(splitPctRaw * 100);

    try {
      await api(`/api/master/investors/${investorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName, status, investor_share_bps })
      });
      saveStatus.textContent = 'Saved · just now';
      setTimeout(() => { saveStatus.textContent = ''; }, 3000);
      await loadInvestorData();
      document.getElementById('md-investor-name').textContent = displayName;
      const badge = document.getElementById('md-status-badge');
      badge.textContent = status === 'active' ? 'Active' : 'Suspended';
      badge.className = `ia-drawer-header__badge status-badge ${status === 'active' ? 'active' : 'suspended'}`;
    } catch (error) {
      saveError.textContent = error.message || 'Failed to save.';
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function handleCashflowSubmit(investorId) {
    const errorEl = document.getElementById('md-cf-error');
    errorEl.textContent = '';
    const type = document.getElementById('md-cf-type')?.value;
    const amount = parseFloat(document.getElementById('md-cf-amount')?.value);
    const effectiveDate = document.getElementById('md-cf-date')?.value;
    const reference = document.getElementById('md-cf-ref')?.value?.trim();

    if (!Number.isFinite(amount) || amount <= 0) { errorEl.textContent = 'Amount must be greater than 0.'; return; }
    if (!effectiveDate) { errorEl.textContent = 'Date is required.'; return; }

    const submitBtn = document.getElementById('md-cf-submit');
    submitBtn.disabled = true;
    try {
      await api(`/api/master/investors/${investorId}/cashflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, amount, effective_date: effectiveDate, reference: reference || '' })
      });
      document.getElementById('md-cashflow-form').hidden = true;
      document.getElementById('md-toggle-cashflow-form').textContent = '+ Record cashflow';
      await loadManageDrawer(investorId);
    } catch (error) {
      errorEl.textContent = error.message || 'Failed to record cashflow.';
    } finally {
      submitBtn.disabled = false;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  RECORD NAV MODAL
  // ══════════════════════════════════════════════════════════

  let navOverwriteTargetId = null;

  function resetRecordNavModal() {
    document.getElementById('rn-date').value = today();
    document.getElementById('rn-nav').value = '';
    document.getElementById('rn-notes').value = '';
    document.getElementById('rn-error').textContent = '';
    document.getElementById('rn-overwrite-warning').hidden = true;
    navOverwriteTargetId = null;
    const submitBtn = document.getElementById('rn-submit-btn');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save NAV';
  }

  document.getElementById('ia-record-nav-btn')?.addEventListener('click', () => {
    resetRecordNavModal();
    openModal('record-nav-modal');
  });

  document.getElementById('rn-submit-btn')?.addEventListener('click', () => submitRecordNav(false));
  document.getElementById('rn-overwrite-confirm')?.addEventListener('click', () => submitRecordNav(true));
  document.getElementById('rn-overwrite-cancel')?.addEventListener('click', () => {
    document.getElementById('rn-overwrite-warning').hidden = true;
    navOverwriteTargetId = null;
  });

  // Handle API errors with status + body for the 409 case
  // We need AccountCenter.api to forward status for 409 — patch the call:
  // The api helper throws with message; we need to detect 409 and get the body.
  // Wrap api for valuations calls:
  async function apiValuations(path, opts) {
    const res = await fetch(path, {
      ...opts,
      credentials: 'same-origin',
      headers: { ...(opts?.headers || {}) }
    });
    let data;
    try { data = await res.json(); } catch (_) { data = {}; }
    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function submitRecordNav(overwrite) {
    const dateVal = document.getElementById('rn-date').value;
    const navVal  = parseFloat(document.getElementById('rn-nav').value);
    const notes   = document.getElementById('rn-notes').value.trim();
    const errorEl = document.getElementById('rn-error');
    const submitBtn = document.getElementById('rn-submit-btn');

    errorEl.textContent = '';

    if (!dateVal) { errorEl.textContent = 'Date is required.'; return; }
    if (!Number.isFinite(navVal) || navVal <= 0) { errorEl.textContent = 'NAV must be a number greater than 0.'; return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      if (overwrite && navOverwriteTargetId) {
        await apiValuations(`/api/master/valuations/${navOverwriteTargetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nav: navVal, valuation_date: dateVal, notes: notes || null })
        });
      } else {
        await apiValuations('/api/master/valuations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nav: navVal, valuation_date: dateVal, notes: notes || null, source: 'manual' })
        });
      }

      closeModal('record-nav-modal');
      await loadInvestorData();

    } catch (err) {
      if (err.status === 409 && err.data?.existing) {
        const ex = err.data.existing;
        navOverwriteTargetId = ex.id;
        const warning = document.getElementById('rn-overwrite-warning');
        const detail  = document.getElementById('rn-overwrite-detail');
        detail.textContent = ` Existing: ${formatCurrency(ex.nav)} on ${ex.valuationDate}.${ex.notes ? ' Notes: ' + ex.notes : ''}`;
        warning.hidden = false;
      } else {
        errorEl.textContent = err.message || 'Failed to save NAV.';
      }
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save NAV';
    }
  }

  // ══════════════════════════════════════════════════════════
  //  NAV HISTORY MODAL
  // ══════════════════════════════════════════════════════════

  document.getElementById('ia-nav-history-btn')?.addEventListener('click', () => openHistoryModal());

  function openHistoryModal() {
    renderHistoryModal();
    openModal('nav-history-modal');
  }

  function renderHistoryModal() {
    const rows = [...state.valuations].sort((a, b) => {
      const d = String(b.valuationDate).localeCompare(String(a.valuationDate));
      return d !== 0 ? d : String(b.createdAt).localeCompare(String(a.createdAt));
    });

    // Build duplicate date map
    const dateCounts = new Map();
    for (const row of rows) {
      const d = row.valuationDate;
      dateCounts.set(d, (dateCounts.get(d) || 0) + 1);
    }
    const dupDates = new Set([...dateCounts.entries()].filter(([, n]) => n > 1).map(([d]) => d));
    const dupCount = dupDates.size;

    // Banner
    const banner = document.getElementById('nh-dup-banner');
    if (dupCount > 0) {
      banner.hidden = false;
      banner.innerHTML = `
        <strong>⚠ ${dupCount} date${dupCount > 1 ? 's have' : ' has'} multiple valuations.</strong>
        Review and delete the unwanted entries.
        <button class="ia-dup-jump" id="nh-jump-btn" type="button">Jump to first duplicate</button>
      `;
      document.getElementById('nh-jump-btn')?.addEventListener('click', () => {
        const firstDup = document.querySelector('#nh-tbody tr.ia-dup-row');
        if (firstDup) firstDup.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    } else {
      banner.hidden = true;
    }

    // Draw history chart (largest sparkline in modal)
    buildSparkline(rows.filter(r => !dupDates.has(r.valuationDate) || rows.findIndex(x => x.id === r.id) === rows.findLastIndex(x => x.valuationDate === r.valuationDate)), 'nh-chart', 500, 120);

    // Table
    const tbody = document.getElementById('nh-tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px" class="helper">No valuations recorded yet.</td></tr>';
      return;
    }

    const fmtDate = (iso) => {
      if (!iso) return '—';
      try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (_) { return iso; }
    };

    tbody.innerHTML = rows.map((row, i) => {
      const isDup = dupDates.has(row.valuationDate);
      const prior = rows[i + 1];
      let changeTxt = '—';
      if (prior && prior.valuationDate !== row.valuationDate) {
        const pct = ((Number(row.nav) - Number(prior.nav)) / Number(prior.nav)) * 100;
        if (Number.isFinite(pct)) {
          const col = pct >= 0 ? 'var(--positive,#4caf7d)' : 'var(--negative,#e05c5c)';
          changeTxt = `<span style="color:${col}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%</span>`;
        }
      }
      const dupBadge = isDup ? `<span class="ia-dup-badge" title="Multiple valuations on this date">!</span>` : '';
      return `
        <tr class="${isDup ? 'ia-dup-row' : ''}" data-val-id="${row.id}">
          <td>${fmtDate(row.valuationDate)}${dupBadge}</td>
          <td>${formatCurrency(row.nav)}</td>
          <td>${changeTxt}</td>
          <td><span class="ia-source-badge">${row.source || 'manual'}</span></td>
          <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-secondary)">${row.notes || ''}</td>
          <td style="white-space:nowrap">
            <button class="ia-icon-btn nh-edit-btn" data-id="${row.id}" title="Edit" aria-label="Edit">✎</button>
            <button class="ia-icon-btn ia-icon-btn--danger nh-del-btn" data-id="${row.id}" title="Delete" aria-label="Delete">✕</button>
          </td>
        </tr>`;
    }).join('');

    // Wire edit/delete buttons
    tbody.querySelectorAll('.nh-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openNavEditModal(btn.dataset.id));
    });
    tbody.querySelectorAll('.nh-del-btn').forEach(btn => {
      btn.addEventListener('click', () => openNavDeleteModal(btn.dataset.id));
    });
  }

  // ══════════════════════════════════════════════════════════
  //  NAV EDIT MODAL
  // ══════════════════════════════════════════════════════════

  function openNavEditModal(valId) {
    const row = state.valuations.find(v => v.id === valId);
    if (!row) return;
    document.getElementById('ne-id').value = row.id;
    document.getElementById('ne-date').value = row.valuationDate;
    document.getElementById('ne-nav').value = row.nav;
    document.getElementById('ne-notes').value = row.notes || '';
    document.getElementById('ne-error').textContent = '';
    const submitBtn = document.getElementById('ne-submit-btn');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save changes';
    openModal('nav-edit-modal');
  }

  document.getElementById('ne-submit-btn')?.addEventListener('click', async () => {
    const id       = document.getElementById('ne-id').value;
    const dateVal  = document.getElementById('ne-date').value;
    const navVal   = parseFloat(document.getElementById('ne-nav').value);
    const notes    = document.getElementById('ne-notes').value.trim();
    const errorEl  = document.getElementById('ne-error');
    const submitBtn = document.getElementById('ne-submit-btn');

    errorEl.textContent = '';
    if (!dateVal) { errorEl.textContent = 'Date is required.'; return; }
    if (!Number.isFinite(navVal) || navVal <= 0) { errorEl.textContent = 'NAV must be greater than 0.'; return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      await apiValuations(`/api/master/valuations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nav: navVal, valuation_date: dateVal, notes: notes || null })
      });
      closeModal('nav-edit-modal');
      await loadInvestorData();
      renderHistoryModal();
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to save.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save changes';
    }
  });

  // ══════════════════════════════════════════════════════════
  //  NAV DELETE MODAL
  // ══════════════════════════════════════════════════════════

  let navDeleteTargetId = null;

  function openNavDeleteModal(valId) {
    const row = state.valuations.find(v => v.id === valId);
    if (!row) return;
    navDeleteTargetId = valId;
    document.getElementById('nd-message').textContent =
      `Delete NAV entry for ${row.valuationDate} (${formatCurrency(row.nav)})?`;
    document.getElementById('nd-error').textContent = '';
    const btn = document.getElementById('nd-confirm-btn');
    btn.disabled = false;
    btn.textContent = 'Delete entry';
    openModal('nav-delete-modal');
  }

  document.getElementById('nd-confirm-btn')?.addEventListener('click', async () => {
    if (!navDeleteTargetId) return;
    const errEl = document.getElementById('nd-error');
    const btn   = document.getElementById('nd-confirm-btn');
    errEl.textContent = '';
    btn.disabled = true;
    try {
      await apiValuations(`/api/master/valuations/${navDeleteTargetId}`, { method: 'DELETE' });
      closeModal('nav-delete-modal');
      navDeleteTargetId = null;
      await loadInvestorData();
      if (!document.getElementById('nav-history-modal').hidden) renderHistoryModal();
    } catch (err) {
      errEl.textContent = err.message || 'Failed to delete.';
      btn.disabled = false;
    }
  });

  // ══════════════════════════════════════════════════════════
  //  INVESTOR SETTINGS MODAL
  // ══════════════════════════════════════════════════════════

  document.getElementById('ia-settings-btn')?.addEventListener('click', async () => {
    const modeToggle = document.getElementById('is-mode-toggle');
    const urlEl = document.getElementById('is-invite-url');
    const statusEl = document.getElementById('is-status');

    if (modeToggle) modeToggle.checked = state.investorModeEnabled;
    if (urlEl) urlEl.textContent = '…';
    if (statusEl) statusEl.textContent = '';

    openModal('investor-settings-modal');

    try {
      const settings = await api('/api/master/settings');
      if (urlEl) urlEl.textContent = settings.invite_base_url || '(not configured)';
      if (modeToggle) modeToggle.checked = !!settings.investor_portal_enabled;
    } catch (_) {
      if (urlEl) urlEl.textContent = '(unavailable)';
    }
  });

  document.getElementById('is-mode-toggle')?.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    const statusEl = document.getElementById('is-status');
    if (statusEl) statusEl.textContent = '';
    try {
      await api('/api/account/investor-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      state.investorModeEnabled = enabled;
      renderStatusStrip();
      if (statusEl) statusEl.textContent = enabled ? 'Investor mode enabled.' : 'Investor mode disabled.';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || 'Failed to update.';
      e.target.checked = !enabled;
    }
  });

})();
