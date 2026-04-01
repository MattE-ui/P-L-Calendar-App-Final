function $(s) { return document.querySelector(s); }
function $$(s) { return Array.from(document.querySelectorAll(s)); }

function fmtMoney(value) {
  const safe = Number(value);
  if (!Number.isFinite(safe)) return '—';
  return `£${safe.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(value) {
  const safe = Number(value);
  if (!Number.isFinite(safe)) return '—';
  const sign = safe > 0 ? '+' : '';
  return `${sign}${safe.toFixed(2)}%`;
}

function recapStatusClass(netPnlGBP) {
  const value = Number(netPnlGBP);
  if (value > 0) return { label: 'Positive', cls: 'pos' };
  if (value < 0) return { label: 'Negative', cls: 'neg' };
  return { label: 'Flat', cls: 'flat' };
}

function buildWeeklyTakeaway(metrics = {}) {
  const closedTrades = Number(metrics.closedTrades) || 0;
  const netPnl = Number(metrics.weeklyRealisedPnlGBP ?? metrics.netPnlGBP) || 0;
  const winRate = Number(metrics.winRatePct) || 0;
  const avgWinner = Number(metrics.averageWinnerGBP) || 0;
  const avgLoser = Math.abs(Number(metrics.averageLoserGBP) || 0);
  const totalGains = Number(metrics.totalRealisedGainsGBP) || 0;
  const totalLosses = Math.abs(Number(metrics.totalRealisedLossesGBP) || 0);
  const worstTrade = Math.abs(Number(metrics?.worstTrade?.realizedPnlGBP) || 0);

  if (!closedTrades) return 'No closed trades were recorded for this period, so there is no realised edge to evaluate yet.';
  if (netPnl > 0 && avgWinner > avgLoser) return 'Profitable week driven by strong average winners relative to average losses.';
  if (netPnl > 0 && winRate < 50) return 'The week finished positive despite a lower hit rate, indicating that winner size carried results.';
  if (netPnl < 0 && worstTrade > 0 && worstTrade >= totalLosses * 0.45) return 'One outsized loss accounted for most of the week’s downside.';
  if (netPnl < 0 && winRate >= 45) return 'Losses outweighed gains despite a moderate hit rate.';
  if (netPnl < 0 && totalLosses > totalGains) return 'Total losses outpaced gains this week, keeping realised performance under pressure.';
  if (Math.abs(netPnl) < 1) return 'The week closed near flat, with gains and losses largely balancing out.';
  return 'Performance was mixed this week, with follow-through opportunities remaining selective.';
}

async function api(path, opts = {}) {
  const response = await fetch(path, { credentials: 'include', ...opts });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

const state = {
  activeTab: 'recap',
  recap: null,
  recapError: '',
  loadingRecap: false
};

function PlaceholderPanel(message) {
  return `
    <section class="review-placeholder">
      <p class="tool-overline">Review module</p>
      <h3>${message}</h3>
    </section>
  `;
}

function RecapPanel() {
  if (state.loadingRecap) return '<div class="tool-note">Loading weekly recap…</div>';
  if (state.recapError) return `<div class="error">${state.recapError}</div>`;
  if (!state.recap) {
    return `<div class="weekly-recap-highlight"><strong>No recap generated yet</strong><div>Generate a weekly recap once the completed week closes.</div></div>`;
  }
  const metrics = state.recap.metrics || {};
  const status = recapStatusClass(metrics.weeklyRealisedPnlGBP ?? metrics.netPnlGBP);
  const best = metrics.bestTrade;
  const worst = metrics.worstTrade;
  const supportMetrics = [];
  if (Number.isFinite(Number(metrics.portfolioReturnPct))) supportMetrics.push({ label: 'Portfolio return', value: fmtPct(metrics.portfolioReturnPct) });
  if (Number.isFinite(Number(metrics.closedTradeReturnPct))) supportMetrics.push({ label: 'Closed-trade return', value: fmtPct(metrics.closedTradeReturnPct) });
  const avgPerTrade = Number(metrics.closedTrades) > 0
    ? (Number(metrics.weeklyRealisedPnlGBP ?? metrics.netPnlGBP) || 0) / Number(metrics.closedTrades)
    : null;
  if (Number.isFinite(avgPerTrade)) supportMetrics.push({ label: 'Realised / trade', value: fmtMoney(avgPerTrade) });
  const renderHighlight = (label, item, toneClass) => {
    if (!item) {
      return `<article class="weekly-trade-card ${toneClass}"><div class="weekly-trade-card__head"><p class="tool-overline">${label}</p></div><div class="weekly-trade-card__empty">No closed trade recorded</div></article>`;
    }
    return `<article class="weekly-trade-card ${toneClass}">
      <div class="weekly-trade-card__head"><p class="tool-overline">${label}</p><span class="weekly-trade-card__dir">${item.direction || 'LONG'}</span></div>
      <div class="weekly-trade-card__ticker">${item.ticker || '—'}</div>
      <div class="weekly-trade-card__pnl">${fmtMoney(item.realizedPnlGBP)}</div>
      <div class="weekly-trade-card__date">Closed ${item.closeDate || '—'}</div>
    </article>`;
  };
  const supportMetricHtml = supportMetrics.slice(0, 3).map(metric => `<div class="weekly-support-item"><span>${metric.label}</span><strong>${metric.value}</strong></div>`).join('');
  return `
    <section class="weekly-recap-topline">
      <div class="weekly-recap-primary">
        <p class="tool-overline">WEEKLY RECAP</p>
        <h4>${metrics.weekLabel || `${metrics.weekStart || ''} → ${metrics.weekEnd || ''}`}</h4>
        <div class="weekly-primary-label">Weekly realised PnL</div>
        <div class="weekly-primary-value">${fmtMoney(metrics.weeklyRealisedPnlGBP ?? metrics.netPnlGBP)}</div>
      </div>
      <div class="weekly-recap-side">
        <span class="weekly-chip ${status.cls}">${status.label}</span>
        <div class="weekly-support-grid">${supportMetricHtml}</div>
      </div>
    </section>
    <section class="weekly-recap-stat-groups">
      <div class="weekly-stat-group"><p class="weekly-stat-group__title">Execution</p><div class="weekly-recap-stat-grid">
        <div class="weekly-recap-tile"><span>Closed trades</span><strong>${metrics.closedTrades ?? 0}</strong></div>
        <div class="weekly-recap-tile"><span>Win rate</span><strong>${fmtPct(metrics.winRatePct)}</strong></div>
        <div class="weekly-recap-tile"><span>Average winner</span><strong>${fmtMoney(metrics.averageWinnerGBP)}</strong></div>
      </div></div>
      <div class="weekly-stat-group"><p class="weekly-stat-group__title">P&L breakdown</p><div class="weekly-recap-stat-grid">
        <div class="weekly-recap-tile"><span>Average loser</span><strong>${fmtMoney(metrics.averageLoserGBP)}</strong></div>
        <div class="weekly-recap-tile"><span>Total gains</span><strong>${fmtMoney(metrics.totalRealisedGainsGBP)}</strong></div>
        <div class="weekly-recap-tile"><span>Total losses</span><strong>${fmtMoney(metrics.totalRealisedLossesGBP)}</strong></div>
      </div></div>
    </section>
    <section class="weekly-recap-highlights">
      ${renderHighlight('Best trade', best, 'is-positive')}
      ${renderHighlight('Worst trade', worst, 'is-negative')}
    </section>
    <div class="weekly-recap-highlight"><strong>Weekly takeaway</strong><div>${buildWeeklyTakeaway(metrics)}</div></div>
  `;
}

function ReviewTabs() {
  $$('#review-tabs .review-tabs__btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tab === state.activeTab);
  });
}

function ReviewPage() {
  const content = $('#review-tab-content');
  if (!content) return;
  if (state.activeTab === 'recap') content.innerHTML = RecapPanel();
  if (state.activeTab === 'trade-review') content.innerHTML = PlaceholderPanel('Trade review coming soon');
  if (state.activeTab === 'scorecard') content.innerHTML = PlaceholderPanel('Weekly scorecard coming soon');
  if (state.activeTab === 'planning') content.innerHTML = PlaceholderPanel('Planning tools coming soon');
  ReviewTabs();
}

function shouldDeepLinkOpenWeeklyRecap() {
  const params = new URLSearchParams(window.location.search || '');
  return params.get('openWeeklyRecap') === 'latest';
}

function clearWeeklyRecapDeepLinkParams() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('openWeeklyRecap') && !url.searchParams.has('source')) return;
  url.searchParams.delete('openWeeklyRecap');
  url.searchParams.delete('source');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function isWeekendLocal() {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

function shouldAutoOpenWeeklyRecap(recap) {
  if (!recap) return false;
  if (!recap.readyAt && !recap.generatedAt) return false;
  if (recap.viewedAt || recap.dismissedAt) return false;
  return isWeekendLocal();
}

async function markWeeklyRecapViewed(recapId) {
  if (!recapId) return;
  try { await api(`/api/weekly-recap/${encodeURIComponent(recapId)}/viewed`, { method: 'POST' }); } catch (_error) {}
}

async function markWeeklyRecapDismissed(recapId) {
  if (!recapId) return;
  try { await api(`/api/weekly-recap/${encodeURIComponent(recapId)}/dismissed`, { method: 'POST' }); } catch (_error) {}
}

async function openRecapModal({ markViewed = false } = {}) {
  const modal = $('#weekly-recap-modal');
  const content = $('#weekly-recap-content');
  if (!modal || !content) return;
  content.innerHTML = '<div class="tool-note">Loading weekly recap…</div>';
  modal.classList.remove('hidden');
  try {
    const response = await api('/api/weekly-recap/latest');
    const recap = response?.recap || null;
    state.recap = recap;
    content.innerHTML = RecapPanel();
    if (markViewed && recap?.id) await markWeeklyRecapViewed(recap.id);
  } catch (error) {
    content.innerHTML = `<div class="error">${error?.message || 'Failed to load recap.'}</div>`;
  }
}

function bindModalActions() {
  $('#weekly-recap-close-btn')?.addEventListener('click', async () => {
    if (state.recap?.id && !state.recap?.viewedAt) await markWeeklyRecapDismissed(state.recap.id);
    $('#weekly-recap-modal')?.classList.add('hidden');
  });
}

async function loadRecap() {
  state.loadingRecap = true;
  state.recapError = '';
  ReviewPage();
  try {
    const response = await api('/api/weekly-recap/latest');
    state.recap = response?.recap || null;
  } catch (error) {
    state.recapError = error?.message || 'Failed to load recap.';
  } finally {
    state.loadingRecap = false;
    ReviewPage();
  }
}

function bindTabs() {
  $('#review-tabs')?.addEventListener('click', (event) => {
    const btn = event.target.closest('.review-tabs__btn');
    if (!btn) return;
    state.activeTab = btn.dataset.tab || 'recap';
    ReviewPage();
  });
}

async function init() {
  bindTabs();
  bindModalActions();
  await loadRecap();

  const deepLinkOpen = shouldDeepLinkOpenWeeklyRecap();
  const weekendAutoOpen = shouldAutoOpenWeeklyRecap(state.recap);
  if (deepLinkOpen || weekendAutoOpen) {
    state.activeTab = 'recap';
    ReviewPage();
    await openRecapModal({ markViewed: deepLinkOpen });
    if (deepLinkOpen) clearWeeklyRecapDeepLinkParams();
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
