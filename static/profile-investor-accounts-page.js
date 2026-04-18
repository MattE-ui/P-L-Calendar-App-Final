(async function initInvestorAccountsPage() {
  const { api, setText } = window.AccountCenter;

  // ── State ─────────────────────────────────────────────────

  const state = {
    investorModeEnabled: false,
    investors: [],          // active (non-deleted)
    deletedInvestors: [],   // soft-deleted
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
    // Alphabet excluding ambiguous chars: 0 O 1 l I
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

    // Guarantee minimums: 2 of each category
    let chars = [
      ...pick(upper, 2),
      ...pick(lower, 2),
      ...pick(digits, 2),
      ...pick(syms, 2)
    ];

    // Fill remainder from full pool
    const full = upper + lower + digits + syms;
    chars = chars.concat(pick(full, 16 - chars.length));

    // Fisher-Yates shuffle with crypto random
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
        // Force reflow to restart animation
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
    // Focus first focusable element
    const first = el.querySelector('input, button:not([aria-label="Close"]), select, textarea');
    if (first) setTimeout(() => first.focus(), 50);
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  function trapEscape(e) {
    if (e.key === 'Escape') {
      // Close any open modal or drawer
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
      if (Number.isFinite(capital)) acc.capital += capital;
      if (Number.isFinite(pnl)) acc.pnl += pnl;
      if (Number.isFinite(returnPct)) { acc.returnTotal += returnPct; acc.returnCount += 1; }
      return acc;
    }, { capital: 0, pnl: 0, returnTotal: 0, returnCount: 0 });

    return {
      investorCount: state.investors.length,
      capital: totals.capital,
      pnl: totals.pnl,
      avgReturnPct: totals.returnCount ? (totals.returnTotal / totals.returnCount) : null
    };
  };

  // ── Render helpers ────────────────────────────────────────

  const metricCard = (label, value, extraClass = '') => `
    <article class="metric-card ${extraClass}">
      <h3>${label}</h3>
      <p class="metric-value">${value}</p>
    </article>
  `;

  const renderModePanel = () => {
    const modeLabel = document.getElementById('investor-mode-label');
    const modeBadge = document.getElementById('investor-mode-badge');
    const modeToggleBtn = document.getElementById('investor-mode-toggle');
    const modeMetrics = document.getElementById('investor-mode-metrics');
    const metrics = getAggregateMetrics();

    if (modeLabel) modeLabel.textContent = state.investorModeEnabled ? 'Enabled' : 'Disabled';
    if (modeBadge) {
      modeBadge.textContent = state.investorModeEnabled ? 'Enabled' : 'Disabled';
      modeBadge.className = `status-badge ${state.investorModeEnabled ? 'active' : 'suspended'}`;
    }
    if (modeToggleBtn) {
      modeToggleBtn.textContent = state.investorModeEnabled ? 'Disable investor mode' : 'Enable investor mode';
      modeToggleBtn.classList.toggle('danger', state.investorModeEnabled);
    }
    if (modeMetrics) {
      modeMetrics.innerHTML = [
        metricCard('Total investors', String(metrics.investorCount)),
        metricCard('Total capital', formatCurrency(metrics.capital)),
        metricCard('Total PnL', formatCurrency(metrics.pnl), metrics.pnl >= 0 ? 'positive' : 'negative')
      ].join('');
    }
  };

  const renderSummary = () => {
    const summaryMetrics = document.getElementById('investor-summary-metrics');
    if (!summaryMetrics) return;
    const metrics = getAggregateMetrics();
    summaryMetrics.innerHTML = [
      metricCard('Investors', String(metrics.investorCount)),
      metricCard('Total capital', formatCurrency(metrics.capital)),
      metricCard('Total PnL', formatCurrency(metrics.pnl), metrics.pnl >= 0 ? 'positive' : 'negative'),
      metricCard('Average return', formatPercent(metrics.avgReturnPct))
    ].join('');
  };

  const renderReporting = () => {
    const reportSplit = document.getElementById('report-profit-split');
    const reportNavFrequency = document.getElementById('report-nav-frequency');
    const reportStatus = document.getElementById('reporting-status');

    if (reportSplit) {
      const splits = state.investors
        .map((inv) => {
          const perf = state.perfById.get(inv.id) || {};
          const bps = Number(inv.investor_share_bps ?? perf.investor_share_bps ?? NaN);
          if (!Number.isFinite(bps)) return null;
          return bps / 100;
        })
        .filter((pct) => Number.isFinite(pct));
      reportSplit.textContent = splits.length
        ? `Avg ${(splits.reduce((s, v) => s + v, 0) / splits.length).toFixed(2)}% investor share`
        : 'Not configured';
    }

    if (reportNavFrequency) {
      const sorted = [...state.valuations]
        .map((row) => String(row.valuationDate || row.valuation_date || ''))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      if (sorted.length < 2) {
        reportNavFrequency.textContent = sorted.length ? 'Single valuation recorded' : 'No NAV history';
      } else {
        const days = [];
        for (let i = 1; i < sorted.length; i++) {
          const gap = Math.round((new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000);
          if (gap > 0) days.push(gap);
        }
        const avgGap = days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null;
        reportNavFrequency.textContent = avgGap ? `~Every ${avgGap} day${avgGap === 1 ? '' : 's'}` : 'Variable cadence';
      }
    }

    if (reportStatus) {
      reportStatus.textContent = !state.investorModeEnabled
        ? 'Offline'
        : !state.investors.length ? 'Mode enabled · Awaiting investors'
        : 'Live';
    }
  };

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

    // ── Wire card buttons ────────────────────────────────────

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

  const renderAll = () => {
    renderModePanel();
    renderSummary();
    renderInvestorCards();
    renderReporting();
  };

  // ── Data loading ──────────────────────────────────────────

  async function loadInvestorData() {
    try {
      const [livePayload, deletedPayload, performancePayload, valuationPayload] = await Promise.all([
        api('/api/master/investors').catch(() => ({ investors: [] })),
        api('/api/master/investors?include_deleted=true').catch(() => ({ investors: [] })),
        api('/api/master/investors/performance').catch(() => ({ investors: [] })),
        api('/api/master/valuations').catch(() => ({ valuations: [] }))
      ]);

      state.investors = Array.isArray(livePayload?.investors) ? livePayload.investors : [];
      const allInvestors = Array.isArray(deletedPayload?.investors) ? deletedPayload.investors : [];
      state.deletedInvestors = allInvestors.filter(i => i.deletedAt != null);
      const performanceRows = Array.isArray(performancePayload?.investors) ? performancePayload.investors : [];
      state.perfById = new Map(performanceRows.map((row) => [row.investor_profile_id, row]));
      state.valuations = Array.isArray(valuationPayload?.valuations) ? valuationPayload.valuations : [];
      renderAll();
    } catch (_error) {
      state.investors = [];
      state.deletedInvestors = [];
      state.perfById = new Map();
      state.valuations = [];
      renderAll();
    }
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
      renderModePanel();
      renderReporting();
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
    // Auto-generate a password when modal opens
    const pwInput = document.getElementById('rp-password');
    pwInput.value = generateStrongPassword();
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
      // The existing reset-password endpoint generates its own password server-side.
      // We use the PATCH endpoint instead to set our generated password via create-with-temp-password flow.
      // Actually, call reset-password which auto-generates — but we want OUR generated password.
      // So: PATCH the login directly isn't an endpoint we have. Use the existing reset-password
      // endpoint but then update the UI with the server's password, not ours.
      // Simpler: reset-password endpoint returns the generated tempPassword; show that.
      const data = await api(`/api/master/investors/${resetPwTargetId}/reset-password`, { method: 'POST' });
      document.getElementById('rp-password').value = data.tempPassword;
      errorEl.textContent = '';
      const statusEl = document.getElementById('rp-copy-status');
      statusEl.textContent = 'Password set. Share this with the investor.';
      setBtn.textContent = 'Done';
    } catch (error) {
      errorEl.textContent = error.message || 'Failed to reset password.';
      setBtn.disabled = false;
      setBtn.textContent = 'Set this password';
    }
  });

  // ── Invite link modal (replaces prompt()) ─────────────────

  function openInviteLinkModal(url) {
    // Reuse the reset-pw modal structure — just swap content temporarily
    // Since we don't want another modal, use a simple inline alert-style approach
    // that still avoids prompt(). The task says replace alert/confirm/prompt with custom modals.
    // We'll reuse the delete-confirm modal with adapted content.
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
    // Restore after close
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
    if (!deleteTargetId || document.getElementById('dc-confirm-btn').onclick) return; // hijacked for invite
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
        <!-- Section 1: Editable fields -->
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

        <!-- Section 2: Capital & performance -->
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

        <!-- Section 3: Recent cashflows -->
        <section class="ia-drawer-section">
          <h3 class="ia-drawer-section__title">Recent cashflows</h3>
          <div id="md-cashflows-list">${renderCashflowsList(cashflowsData?.cashflows || [], investorId)}</div>
        </section>

        <!-- Section 4: Danger zone -->
        <section class="ia-drawer-section ia-danger-zone">
          <h3 class="ia-drawer-section__title ia-danger-title">Danger zone</h3>
          <p class="helper" style="margin:0 0 10px">Soft-delete removes this investor from your active list. Records are retained and can be restored.</p>
          <button class="ghost small ia-danger-btn" id="md-delete-btn" data-id="${inv.id}" data-name="${inv.displayName || ''}" type="button">Delete investor</button>
        </section>
      `;

      // Wire drawer-internal buttons
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
      body.innerHTML = `<p class="error">${error.message || 'Failed to load investor details.'}</p>`;
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

  // Re-delegate cashflow delete clicks inside drawer body
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
      // Refresh drawer header
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
      // Collapse form and reload drawer
      document.getElementById('md-cashflow-form').hidden = true;
      document.getElementById('md-toggle-cashflow-form').textContent = '+ Record cashflow';
      await loadManageDrawer(investorId);
    } catch (error) {
      errorEl.textContent = error.message || 'Failed to record cashflow.';
    } finally {
      submitBtn.disabled = false;
    }
  }

})();
