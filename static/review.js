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
  loadingRecap: false,
  loadingTrades: false,
  tradeError: '',
  trades: [],
  selectedTradeId: ''
};

const REVIEW_TAGS = ['Breakout', 'Pullback', 'News', 'Earnings', 'Scalping', 'Swing', 'FOMO', 'Revenge'];
const REVIEW_OUTCOMES = [
  { key: 'good', label: 'Good trade' },
  { key: 'bad', label: 'Bad trade' },
  { key: 'neutral', label: 'Neutral' }
];

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
  const totalGains = Number(metrics.totalRealisedGainsGBP) || 0;
  const totalLossesAbs = Math.abs(Number(metrics.totalRealisedLossesGBP) || 0);
  const profitFactor = totalLossesAbs > 0 ? (totalGains / totalLossesAbs) : null;
  if (Number.isFinite(profitFactor)) supportMetrics.push({ label: 'Profit factor', value: profitFactor.toFixed(2) });
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
    <section class="weekly-recap-layout weekly-recap--review">
      <section class="weekly-recap-topline">
      <div class="weekly-recap-primary">
        <p class="tool-overline">WEEKLY RECAP</p>
        <h4>${metrics.weekLabel || `${metrics.weekStart || ''} → ${metrics.weekEnd || ''}`}</h4>
        <div class="weekly-primary-label">Weekly realised PnL</div>
        <div class="weekly-primary-value">${fmtMoney(metrics.weeklyRealisedPnlGBP ?? metrics.netPnlGBP)}</div>
        <div class="weekly-primary-subvalue">${Number.isFinite(avgPerTrade) ? `Realised / trade ${fmtMoney(avgPerTrade)}` : 'Realised / trade —'}</div>
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
      <div class="weekly-stat-group"><p class="weekly-stat-group__title">Outcome</p><div class="weekly-recap-stat-grid">
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
    </section>
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
  if (state.activeTab === 'trade-review') content.innerHTML = TradeReviewPanel();
  if (state.activeTab === 'scorecard') content.innerHTML = PlaceholderPanel('Weekly scorecard coming soon');
  if (state.activeTab === 'planning') content.innerHTML = PlaceholderPanel('Planning tools coming soon');
  ReviewTabs();
}

function formatDirection(direction) {
  return direction === 'short' ? 'Short' : 'Long';
}

function fmtSignedMoney(value) {
  const safe = Number(value);
  if (!Number.isFinite(safe)) return '—';
  const sign = safe > 0 ? '+' : safe < 0 ? '-' : '';
  return `${sign}${fmtMoney(Math.abs(safe))}`;
}

function getTradeById(id) {
  return state.trades.find(trade => trade.id === id) || null;
}

function getSelectedTrade() {
  return getTradeById(state.selectedTradeId);
}

function isTradeReviewed(trade) {
  return ['good', 'bad', 'neutral'].includes(trade?.outcome);
}

function isTradeTagged(trade) {
  return Array.isArray(trade?.tags) && trade.tags.length > 0;
}

function hasTradeNotes(trade) {
  return typeof trade?.notes === 'string' && trade.notes.trim().length > 0;
}

function hasReviewProgress(trade) {
  return isTradeReviewed(trade) || isTradeTagged(trade) || hasTradeNotes(trade);
}

function formatHoldTime(trade) {
  const start = new Date(`${trade?.openDate || ''}T00:00:00Z`);
  const end = new Date(`${trade?.closeDate || trade?.openDate || ''}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return '—';
  const days = Math.max(0, Math.round((end - start) / (24 * 60 * 60 * 1000)));
  return days === 0 ? 'Same day' : `${days}d`;
}

function TradeReviewPanel() {
  if (state.loadingTrades) return '<div class="tool-note">Loading trades…</div>';
  if (state.tradeError) return `<div class="error">${state.tradeError}</div>`;
  if (!state.trades.length) return '<section class="review-placeholder"><h3>No trades to review yet</h3><p class="tool-note">Close trades to start your review workflow.</p></section>';
  const selected = getSelectedTrade();
  const listHtml = state.trades.map((trade) => `
    <button class="trade-review-row ${trade.id === state.selectedTradeId ? 'is-active' : ''}" data-trade-id="${trade.id}" type="button">
      <div class="trade-review-row__line">
        <strong class="trade-review-row__ticker">${trade.displayTicker || trade.displaySymbol || trade.symbol || '—'}</strong>
        ${hasReviewProgress(trade) ? '<span class="trade-review-row__review-indicator" title="Review started" aria-label="Review started"></span>' : ''}
      </div>
      <div class="trade-review-row__line trade-review-row__line--meta">
        <span class="trade-review-row__pnl ${Number(trade.realizedPnlGBP) > 0 ? 'pos' : Number(trade.realizedPnlGBP) < 0 ? 'neg' : ''}">${fmtSignedMoney(trade.realizedPnlGBP)}</span>
        <span class="trade-review-row__date">${trade.closeDate || '—'}</span>
      </div>
    </button>
  `).join('');
  if (!selected) {
    return `<section class="trade-review-layout"><aside class="trade-review-list">${listHtml}</aside><section class="trade-review-detail"><div class="tool-note">Select a trade.</div></section></section>`;
  }
  const selectedTags = Array.isArray(selected.tags) ? selected.tags : [];
  const notes = typeof selected.notes === 'string' ? selected.notes : '';
  const outcomesHtml = REVIEW_OUTCOMES.map(item => `<button class="trade-review-outcome ${selected.outcome === item.key ? 'is-active' : ''}" data-outcome="${item.key}" type="button">${item.label}</button>`).join('');
  const tagsHtml = REVIEW_TAGS.map(tag => `<button class="trade-review-tag ${selectedTags.includes(tag) ? 'is-active' : ''}" data-tag="${tag}" type="button">${tag}</button>`).join('');
  return `
    <section class="trade-review-layout">
      <aside id="trade-review-list" class="trade-review-list">${listHtml}</aside>
      <section class="trade-review-detail">
        <section class="trade-review-card">
          <p class="tool-overline">Trade summary</p>
          <div class="trade-review-summary-top">
            <h3>${selected.displayTicker || selected.displaySymbol || selected.symbol || '—'}</h3>
            <span class="trade-review-row__dir ${selected.direction === 'short' ? 'short' : 'long'}">${formatDirection(selected.direction)}</span>
          </div>
          <div class="trade-review-pnl ${Number(selected.realizedPnlGBP) > 0 ? 'pos' : Number(selected.realizedPnlGBP) < 0 ? 'neg' : ''}">${fmtSignedMoney(selected.realizedPnlGBP)}</div>
          <div class="trade-review-summary-grid">
            <div><span>Entry</span><strong>${Number.isFinite(Number(selected.avgEntryPrice)) ? selected.avgEntryPrice : selected.entry || '—'}</strong></div>
            <div><span>Exit</span><strong>${Number.isFinite(Number(selected.avgExitPrice)) ? selected.avgExitPrice : selected.closePrice || '—'}</strong></div>
            <div><span>Closed</span><strong>${selected.closeDate || '—'}</strong></div>
            <div><span>Hold time</span><strong>${formatHoldTime(selected)}</strong></div>
          </div>
        </section>
        <section class="trade-review-card trade-review-card--decision">
          <p class="tool-overline">Decision</p>
          <div class="trade-review-card__section">
            <p class="trade-review-section-label">Outcome</p>
          <div class="trade-review-outcomes">${outcomesHtml}</div>
          </div>
          <div class="trade-review-card__section">
          <p class="trade-review-section-label">Tags</p>
          <div class="trade-review-tags">${tagsHtml}</div>
          </div>
        </section>
        <section class="trade-review-card trade-review-card--notes">
          <p class="tool-overline">Notes</p>
          <textarea id="trade-review-notes" class="trade-review-notes" rows="3" placeholder="Optional notes">${notes}</textarea>
        </section>
      </section>
    </section>
  `;
}

let saveNotesTimer = null;

async function patchTradeReview(tradeId, patch) {
  const trade = getTradeById(tradeId);
  if (!trade) return;
  Object.assign(trade, patch);
  ReviewPage();
  try {
    await api(`/api/trades/${encodeURIComponent(tradeId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
  } catch (_error) {}
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

async function loadTrades() {
  state.loadingTrades = true;
  state.tradeError = '';
  if (state.activeTab === 'trade-review') ReviewPage();
  try {
    const response = await api('/api/trades?status=closed');
    state.trades = (response?.trades || [])
      .filter(trade => trade.status === 'closed')
      .sort((a, b) => (b.closeDate || '').localeCompare(a.closeDate || ''));
    state.selectedTradeId = state.trades[0]?.id || '';
  } catch (error) {
    state.tradeError = error?.message || 'Failed to load trades.';
  } finally {
    state.loadingTrades = false;
    if (state.activeTab === 'trade-review') ReviewPage();
  }
}

function bindTradeReviewActions() {
  $('#review-tab-content')?.addEventListener('click', (event) => {
    const row = event.target.closest('.trade-review-row');
    if (row?.dataset?.tradeId) {
      state.selectedTradeId = row.dataset.tradeId;
      ReviewPage();
      return;
    }
    const outcomeBtn = event.target.closest('.trade-review-outcome');
    if (outcomeBtn?.dataset?.outcome && state.selectedTradeId) {
      patchTradeReview(state.selectedTradeId, { outcome: outcomeBtn.dataset.outcome });
      return;
    }
    const tagBtn = event.target.closest('.trade-review-tag');
    if (tagBtn?.dataset?.tag && state.selectedTradeId) {
      const trade = getSelectedTrade();
      if (!trade) return;
      const current = Array.isArray(trade.tags) ? trade.tags : [];
      const hasTag = current.includes(tagBtn.dataset.tag);
      const tags = hasTag ? current.filter(tag => tag !== tagBtn.dataset.tag) : [...current, tagBtn.dataset.tag];
      patchTradeReview(state.selectedTradeId, { tags });
    }
  });
  $('#review-tab-content')?.addEventListener('input', (event) => {
    const notesEl = event.target.closest('#trade-review-notes');
    if (!notesEl || !state.selectedTradeId) return;
    const notes = String(notesEl.value || '');
    const trade = getSelectedTrade();
    if (trade) trade.notes = notes;
    if (saveNotesTimer) clearTimeout(saveNotesTimer);
    saveNotesTimer = setTimeout(() => {
      patchTradeReview(state.selectedTradeId, { notes });
    }, 200);
  });
}

async function init() {
  bindTabs();
  bindModalActions();
  bindTradeReviewActions();
  await loadRecap();
  await loadTrades();

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
