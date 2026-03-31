(async function initInvestorAccountsPage() {
  const { api, setText } = window.AccountCenter;

  const state = {
    investorModeEnabled: false,
    investors: [],
    perfById: new Map(),
    valuations: []
  };

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

  const getAggregateMetrics = () => {
    const totals = state.investors.reduce((acc, investor) => {
      const perf = state.perfById.get(investor.id) || {};
      const capital = Number(perf.net_contributions || 0);
      const pnl = Number(perf.investor_profit_share || 0);
      const returnPct = Number(perf.investor_return_pct || 0);
      if (Number.isFinite(capital)) acc.capital += capital;
      if (Number.isFinite(pnl)) acc.pnl += pnl;
      if (Number.isFinite(returnPct)) {
        acc.returnTotal += returnPct;
        acc.returnCount += 1;
      }
      return acc;
    }, { capital: 0, pnl: 0, returnTotal: 0, returnCount: 0 });

    return {
      investorCount: state.investors.length,
      capital: totals.capital,
      pnl: totals.pnl,
      avgReturnPct: totals.returnCount ? (totals.returnTotal / totals.returnCount) : null
    };
  };

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
      if (!splits.length) {
        reportSplit.textContent = 'Not configured';
      } else {
        const avgSplit = splits.reduce((sum, val) => sum + val, 0) / splits.length;
        reportSplit.textContent = `Avg ${avgSplit.toFixed(2)}% investor share`;
      }
    }

    if (reportNavFrequency) {
      const sorted = [...state.valuations]
        .map((row) => String(row.valuationDate || row.valuation_date || ''))
        .filter(Boolean)
        .sort((a, b) => String(a).localeCompare(String(b)));
      if (sorted.length < 2) {
        reportNavFrequency.textContent = sorted.length ? 'Single valuation recorded' : 'No NAV history';
      } else {
        const days = [];
        for (let i = 1; i < sorted.length; i += 1) {
          const prev = new Date(sorted[i - 1]);
          const next = new Date(sorted[i]);
          const gap = Math.round((next - prev) / (1000 * 60 * 60 * 24));
          if (Number.isFinite(gap) && gap > 0) days.push(gap);
        }
        const avgGap = days.length ? Math.round(days.reduce((sum, d) => sum + d, 0) / days.length) : null;
        reportNavFrequency.textContent = avgGap ? `~Every ${avgGap} day${avgGap === 1 ? '' : 's'}` : 'Variable cadence';
      }
    }

    if (reportStatus) {
      if (!state.investorModeEnabled) {
        reportStatus.textContent = 'Offline';
      } else if (!state.investors.length) {
        reportStatus.textContent = 'Mode enabled · Awaiting investors';
      } else {
        reportStatus.textContent = 'Live';
      }
    }
  };

  const renderInvestorCards = () => {
    const list = document.getElementById('investor-list');
    if (!list) return;

    if (!state.investors.length) {
      list.innerHTML = '<p class="helper">No investor accounts yet. Configure investor mode and create investor profiles to populate this dashboard.</p>';
      return;
    }

    list.innerHTML = state.investors.map((inv) => {
      const perf = state.perfById.get(inv.id) || {};
      const status = String(inv.status || 'active').toLowerCase();
      const split = Number(inv.investor_share_bps ?? perf.investor_share_bps ?? 0) / 100;
      const pnl = Number(perf.investor_profit_share || 0);
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
            <a class="ghost small" href="/profile.html#investor-section">Manage</a>
            <button class="ghost small investor-view" data-id="${inv.id}" type="button">View</button>
            <button class="ghost small investor-suspend" data-id="${inv.id}" data-next="${status === 'active' ? 'suspended' : 'active'}" type="button">${status === 'active' ? 'Suspend' : 'Reactivate'}</button>
          </div>
        </article>
      `;
    }).join('');

    list.querySelectorAll('.investor-view').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        const data = await api(`/api/master/investors/${btn.dataset.id}/preview-token`);
        window.open(`/investor/preview?token=${encodeURIComponent(data.token)}`, '_blank', 'noopener');
      } catch (error) {
        setText('investor-status', error.message || 'Unable to open investor preview.');
      }
    }));

    list.querySelectorAll('.investor-suspend').forEach((btn) => btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const next = btn.dataset.next;
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
        setText('investor-status', error.message || 'Unable to update investor status.');
      }
    }));
  };

  const renderAll = () => {
    renderModePanel();
    renderSummary();
    renderInvestorCards();
    renderReporting();
  };

  async function loadInvestorData() {
    try {
      const [investorPayload, performancePayload, valuationPayload] = await Promise.all([
        api('/api/master/investors').catch(() => ({ investors: [] })),
        api('/api/master/investors/performance').catch(() => ({ investors: [] })),
        api('/api/master/valuations').catch(() => ({ valuations: [] }))
      ]);

      state.investors = Array.isArray(investorPayload?.investors) ? investorPayload.investors : [];
      const performanceRows = Array.isArray(performancePayload?.investors) ? performancePayload.investors : [];
      state.perfById = new Map(performanceRows.map((row) => [row.investor_profile_id, row]));
      state.valuations = Array.isArray(valuationPayload?.valuations) ? valuationPayload.valuations : [];
      renderAll();
    } catch (_error) {
      state.investors = [];
      state.perfById = new Map();
      state.valuations = [];
      renderAll();
    }
  }

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

  await loadInvestorData();
})();
