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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  selectedTradeId: '',
  planning: null,
  planningError: '',
  loadingPlanning: false,
  savingPlanning: false
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

function fmtPlainPct(value) {
  const safe = Number(value);
  if (!Number.isFinite(safe)) return '—';
  return `${safe.toFixed(1)}%`;
}

function scoreTone(score) {
  if (score >= 85) return { label: 'Strong', cls: 'is-strong' };
  if (score >= 70) return { label: 'Solid', cls: 'is-solid' };
  if (score >= 55) return { label: 'Needs work', cls: 'is-warning' };
  return { label: 'At risk', cls: 'is-risk' };
}

function deriveScorecard(trades = []) {
  const totalTrades = trades.length;
  const reviewedTrades = trades.filter(isTradeReviewed).length;
  const taggedTrades = trades.filter(isTradeTagged).length;
  const classifiedTrades = reviewedTrades;
  const goodTrades = trades.filter(trade => trade?.outcome === 'good').length;
  const badTrades = trades.filter(trade => trade?.outcome === 'bad').length;
  const fomoTrades = trades.filter(trade => Array.isArray(trade?.tags) && trade.tags.includes('FOMO')).length;
  const revengeTrades = trades.filter(trade => Array.isArray(trade?.tags) && trade.tags.includes('Revenge')).length;
  const unreviewedTrades = Math.max(0, totalTrades - reviewedTrades);
  const untaggedTrades = Math.max(0, totalTrades - taggedTrades);
  const reviewCompletionPct = totalTrades > 0 ? (reviewedTrades / totalTrades) * 100 : 0;
  const taggingCompletionPct = totalTrades > 0 ? (taggedTrades / totalTrades) * 100 : 0;
  const classifiedPct = totalTrades > 0 ? (classifiedTrades / totalTrades) * 100 : 0;

  const winners = trades.filter(trade => Number(trade?.realizedPnlGBP) > 0);
  const losers = trades.filter(trade => Number(trade?.realizedPnlGBP) < 0);
  const totalGains = winners.reduce((sum, trade) => sum + (Number(trade.realizedPnlGBP) || 0), 0);
  const totalLossesAbs = Math.abs(losers.reduce((sum, trade) => sum + (Number(trade.realizedPnlGBP) || 0), 0));
  const avgWinner = winners.length ? totalGains / winners.length : null;
  const avgLoserAbs = losers.length ? totalLossesAbs / losers.length : null;
  const profitFactor = totalLossesAbs > 0 ? totalGains / totalLossesAbs : (winners.length ? Infinity : null);
  const winRate = totalTrades > 0 ? (winners.length / totalTrades) * 100 : 0;
  const goodTradesProfitPct = goodTrades > 0
    ? (trades.filter(trade => trade?.outcome === 'good' && Number(trade?.realizedPnlGBP) > 0).length / goodTrades) * 100
    : null;

  const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
  const asPct = (numerator, denominator) => (denominator > 0 ? (numerator / denominator) * 100 : 0);
  const normalize = (value, min, max) => {
    if (!Number.isFinite(value)) return null;
    if (max <= min) return null;
    return clamp(((value - min) / (max - min)) * 100, 0, 100);
  };
  const safeNumber = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

  // Scorecard redesign (weighted blend):
  // Final = 40% Discipline + 30% Mistakes + 30% Quality.
  // Why blend this way:
  // - Discipline should be the largest lever because review process quality is the foundation.
  // - Mistake control and trade quality still matter, but weak PnL alone should not zero-out the score.
  // - Each section has a floor so one weak dimension cannot collapse the full score unrealistically.
  const SECTION_MIN = 10;
  const SECTION_MAX = 100;

  // Discipline (40%): reward completion rates directly.
  const disciplineRaw = (
    (reviewCompletionPct * 0.4)
    + (taggingCompletionPct * 0.3)
    + (classifiedPct * 0.3)
  );
  const disciplineScore = clamp(disciplineRaw, SECTION_MIN, SECTION_MAX);

  // Mistakes (30%): penalize rates, not raw counts, so higher activity alone is not punished.
  const fomoRate = asPct(fomoTrades, totalTrades);
  const revengeRate = asPct(revengeTrades, totalTrades);
  const badTradeRate = asPct(badTrades, totalTrades);
  const mistakesPenalty = (fomoRate * 0.35) + (revengeRate * 0.35) + (badTradeRate * 0.3);
  const mistakesRaw = 100 - mistakesPenalty;
  const mistakesScore = clamp(mistakesRaw, SECTION_MIN, SECTION_MAX);

  // Quality (30%): combine win rate, profit factor, winner/loser efficiency, and good-trade profitability.
  const avgWinLossRatio = (avgWinner && avgLoserAbs) ? (avgWinner / avgLoserAbs) : null;
  const profitFactorScore = normalize(safeNumber(profitFactor, 0), 0.6, 2.0);
  const winLossRatioScore = normalize(safeNumber(avgWinLossRatio, 0), 0.5, 2.0);
  const goodTradesProfitScore = goodTradesProfitPct === null ? 50 : safeNumber(goodTradesProfitPct, 50);
  const qualityRaw = (
    (winRate * 0.35)
    + (safeNumber(profitFactorScore, 0) * 0.3)
    + (safeNumber(winLossRatioScore, 0) * 0.2)
    + (goodTradesProfitScore * 0.15)
  );
  const qualityScore = clamp(qualityRaw, SECTION_MIN, SECTION_MAX);

  const blendedScore = (
    (disciplineScore * 0.4)
    + (mistakesScore * 0.3)
    + (qualityScore * 0.3)
  );
  const score = Math.round(clamp(blendedScore, 0, 100));

  const summary = buildScoreSummary({
    score,
    disciplineScore,
    mistakesScore,
    qualityScore
  });

  return {
    score,
    tone: scoreTone(score),
    summary,
    discipline: { score: disciplineScore, reviewCompletionPct, taggingCompletionPct, classifiedPct },
    mistakes: { score: mistakesScore, fomoTrades, revengeTrades, badTrades, fomoRate, revengeRate, badTradeRate },
    quality: { score: qualityScore, winRate, avgWinner, avgLoserAbs, profitFactor, goodTradesProfitPct, avgWinLossRatio },
    counts: { totalTrades, unreviewedTrades, untaggedTrades }
  };
}

function buildScoreSummary(metrics) {
  if (metrics.disciplineScore >= 85 && metrics.qualityScore >= 70 && metrics.mistakesScore >= 70) {
    return 'Strong process quality and execution are aligned across all score components.';
  }
  if (metrics.disciplineScore >= 80 && metrics.qualityScore < 55) {
    return 'Review discipline is strong; now focus on improving edge and execution quality.';
  }
  if (metrics.disciplineScore < 55 && metrics.qualityScore < 55) {
    return 'Low discipline and weak performance are both contributing to the score.';
  }
  return 'Balanced scorecard: improve weak sections while protecting your strongest habits.';
}

function formatProfitFactor(value) {
  if (value === Infinity) return '∞';
  if (!Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(2);
}

function ScorecardPanel() {
  if (state.loadingTrades) return '<div class="tool-note">Loading scorecard…</div>';
  if (state.tradeError) return `<div class="error">${state.tradeError}</div>`;
  if (!state.trades.length) return '<section class="review-placeholder"><h3>No closed trades yet</h3><p class="tool-note">Close trades to generate your scorecard.</p></section>';
  const scorecard = deriveScorecard(state.trades);
  return `
    <section class="scorecard-layout">
      <header class="scorecard-head ${scorecard.tone.cls}">
        <p class="tool-overline">Performance scorecard</p>
        <div class="scorecard-head__score">Score: <strong>${scorecard.score}</strong> / 100</div>
        <p class="tool-note">Score blends discipline, mistakes, and performance quality.</p>
        <p class="scorecard-head__summary">${scorecard.summary}</p>
      </header>
      <section class="scorecard-grid">
        <article class="scorecard-card">
          <h3>Discipline</h3>
          <div class="scorecard-metric-list">
            <div><span>Section score</span><strong>${scorecard.discipline.score.toFixed(1)} / 100</strong></div>
            <div><span>Trades reviewed</span><strong>${fmtPlainPct(scorecard.discipline.reviewCompletionPct)}</strong></div>
            <div><span>Trades tagged</span><strong>${fmtPlainPct(scorecard.discipline.taggingCompletionPct)}</strong></div>
            <div><span>Outcome classified</span><strong>${fmtPlainPct(scorecard.discipline.classifiedPct)}</strong></div>
          </div>
        </article>
        <article class="scorecard-card">
          <h3>Mistakes</h3>
          <div class="scorecard-metric-list">
            <div><span>Section score</span><strong>${scorecard.mistakes.score.toFixed(1)} / 100</strong></div>
            <div><span>FOMO trades</span><strong>${scorecard.mistakes.fomoTrades} (${fmtPlainPct(scorecard.mistakes.fomoRate)})</strong></div>
            <div><span>Revenge trades</span><strong>${scorecard.mistakes.revengeTrades} (${fmtPlainPct(scorecard.mistakes.revengeRate)})</strong></div>
            <div><span>Bad trades</span><strong>${scorecard.mistakes.badTrades} (${fmtPlainPct(scorecard.mistakes.badTradeRate)})</strong></div>
          </div>
        </article>
        <article class="scorecard-card">
          <h3>Quality</h3>
          <div class="scorecard-metric-list">
            <div><span>Section score</span><strong>${scorecard.quality.score.toFixed(1)} / 100</strong></div>
            <div><span>Win rate</span><strong>${fmtPlainPct(scorecard.quality.winRate)}</strong></div>
            <div><span>Avg winner vs loser</span><strong>${fmtMoney(scorecard.quality.avgWinner)} / ${fmtMoney(scorecard.quality.avgLoserAbs)}</strong></div>
            <div><span>Profit factor</span><strong>${formatProfitFactor(scorecard.quality.profitFactor)}</strong></div>
            <div><span>Profitable good trades</span><strong>${fmtPlainPct(scorecard.quality.goodTradesProfitPct)}</strong></div>
          </div>
        </article>
      </section>
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
  if (state.activeTab === 'trade-review') refreshTradeReviewPanel({ preserveScroll: true });
  if (state.activeTab === 'scorecard') content.innerHTML = ScorecardPanel();
  if (state.activeTab === 'planning') content.innerHTML = PlanningPanel();
  ReviewTabs();
}

function getWeekStartKey(date = new Date()) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = current.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  current.setUTCDate(current.getUTCDate() + diff);
  return current.toISOString().slice(0, 10);
}

function formatWeekLabelFromKey(weekKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekKey || ''))) return '';
  const start = new Date(`${weekKey}T00:00:00Z`);
  if (!Number.isFinite(start.getTime())) return '';
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 4);
  const fmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });
  return `${fmt.format(start)} → ${fmt.format(end)}`;
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptySetup() {
  return {
    id: uid('setup'),
    ticker: '',
    direction: 'bullish',
    setupType: '',
    entryIdea: '',
    invalidation: '',
    target: '',
    notes: '',
    status: 'active'
  };
}

function createEmptyLevel() {
  return {
    id: uid('level'),
    ticker: '',
    triggerLevel: '',
    reason: '',
    action: ''
  };
}

function createEmptyRiskNote() {
  return {
    id: uid('risk'),
    text: '',
    done: false
  };
}

function createPlanningDocument(weekKey = getWeekStartKey()) {
  return {
    weekKey,
    gamePlan: {
      weekLabel: formatWeekLabelFromKey(weekKey),
      weeklyFocus: '',
      primaryTheme: '',
      riskMode: 'Normal',
      mainObjective: ''
    },
    setups: [],
    levels: [],
    risks: []
  };
}

function normalizePlanningDocument(doc = {}) {
  const weekKey = /^\d{4}-\d{2}-\d{2}$/.test(String(doc.weekKey || '')) ? doc.weekKey : getWeekStartKey();
  const gamePlanRaw = doc.gamePlan && typeof doc.gamePlan === 'object' ? doc.gamePlan : {};
  const riskModeRaw = typeof gamePlanRaw.riskMode === 'string' ? gamePlanRaw.riskMode.trim() : 'Normal';
  const safeRiskMode = ['Conservative', 'Normal', 'Aggressive'].includes(riskModeRaw) ? riskModeRaw : 'Normal';
  return {
    weekKey,
    gamePlan: {
      weekLabel: typeof gamePlanRaw.weekLabel === 'string' ? gamePlanRaw.weekLabel : formatWeekLabelFromKey(weekKey),
      weeklyFocus: typeof gamePlanRaw.weeklyFocus === 'string' ? gamePlanRaw.weeklyFocus : '',
      primaryTheme: typeof gamePlanRaw.primaryTheme === 'string' ? gamePlanRaw.primaryTheme : '',
      riskMode: safeRiskMode,
      mainObjective: typeof gamePlanRaw.mainObjective === 'string' ? gamePlanRaw.mainObjective : ''
    },
    setups: Array.isArray(doc.setups) ? doc.setups.map((item) => ({
      ...createEmptySetup(),
      ...item,
      id: typeof item?.id === 'string' && item.id ? item.id : uid('setup'),
      direction: item?.direction === 'bearish' ? 'bearish' : 'bullish'
    })) : [],
    levels: Array.isArray(doc.levels) ? doc.levels.map((item) => ({
      ...createEmptyLevel(),
      ...item,
      id: typeof item?.id === 'string' && item.id ? item.id : uid('level')
    })) : [],
    risks: Array.isArray(doc.risks) ? doc.risks.map((item) => ({
      ...createEmptyRiskNote(),
      ...item,
      id: typeof item?.id === 'string' && item.id ? item.id : uid('risk'),
      done: item?.done === true
    })) : []
  };
}

function PlanningPanel() {
  if (state.loadingPlanning) return '<div class="tool-note">Loading planning workspace…</div>';
  if (state.planningError) return `<div class="error">${state.planningError}</div>`;
  const planning = normalizePlanningDocument(state.planning || createPlanningDocument());
  const setupCards = planning.setups.length
    ? planning.setups.map((setup, index) => `
      <article class="planning-setup-card" data-setup-id="${escapeHtml(setup.id)}">
        <div class="planning-card-head">
          <strong>Setup ${index + 1}</strong>
          <button class="ghost" data-action="delete-setup" data-id="${escapeHtml(setup.id)}" type="button">Remove</button>
        </div>
        <div class="planning-grid planning-grid--setup">
          <label><span>Ticker</span><input data-field="ticker" data-id="${escapeHtml(setup.id)}" data-section="setups" value="${escapeHtml(setup.ticker || '')}" placeholder="e.g. NVDA"></label>
          <label><span>Direction</span><select data-field="direction" data-id="${escapeHtml(setup.id)}" data-section="setups"><option value="bullish" ${setup.direction === 'bullish' ? 'selected' : ''}>Bullish</option><option value="bearish" ${setup.direction === 'bearish' ? 'selected' : ''}>Bearish</option></select></label>
          <label><span>Setup type</span><input data-field="setupType" data-id="${escapeHtml(setup.id)}" data-section="setups" value="${escapeHtml(setup.setupType || '')}" placeholder="Breakout / pullback / trend"></label>
          <label><span>Entry idea</span><input data-field="entryIdea" data-id="${escapeHtml(setup.id)}" data-section="setups" value="${escapeHtml(setup.entryIdea || '')}" placeholder="Location + trigger"></label>
          <label><span>Invalidation / stop</span><input data-field="invalidation" data-id="${escapeHtml(setup.id)}" data-section="setups" value="${escapeHtml(setup.invalidation || '')}" placeholder="Price or condition"></label>
          <label><span>Target</span><input data-field="target" data-id="${escapeHtml(setup.id)}" data-section="setups" value="${escapeHtml(setup.target || '')}" placeholder="R multiple or level"></label>
          <label class="planning-span-2"><span>Notes</span><textarea data-field="notes" data-id="${escapeHtml(setup.id)}" data-section="setups" rows="2" placeholder="Execution details, catalysts, timing">${escapeHtml(setup.notes || '')}</textarea></label>
        </div>
      </article>
    `).join('')
    : '<div class="tool-note">No setups yet. Add your highest-conviction ideas for next week.</div>';
  const levelsRows = planning.levels.length
    ? planning.levels.map((level) => `
      <tr>
        <td><input data-field="ticker" data-id="${escapeHtml(level.id)}" data-section="levels" value="${escapeHtml(level.ticker || '')}" placeholder="Ticker"></td>
        <td><input data-field="triggerLevel" data-id="${escapeHtml(level.id)}" data-section="levels" value="${escapeHtml(level.triggerLevel || '')}" placeholder="Price / level"></td>
        <td><input data-field="reason" data-id="${escapeHtml(level.id)}" data-section="levels" value="${escapeHtml(level.reason || '')}" placeholder="Why this matters"></td>
        <td><input data-field="action" data-id="${escapeHtml(level.id)}" data-section="levels" value="${escapeHtml(level.action || '')}" placeholder="If hit, then..."></td>
        <td><button class="ghost" data-action="delete-level" data-id="${escapeHtml(level.id)}" type="button">✕</button></td>
      </tr>
    `).join('')
    : '<tr><td colspan="5" class="tool-note">Add key trigger levels for priority names.</td></tr>';
  const riskRows = planning.risks.length
    ? planning.risks.map((risk) => `
      <div class="planning-risk-row">
        <input type="checkbox" data-field="done" data-id="${escapeHtml(risk.id)}" data-section="risks" ${risk.done ? 'checked' : ''}>
        <input data-field="text" data-id="${escapeHtml(risk.id)}" data-section="risks" value="${escapeHtml(risk.text || '')}" placeholder="Discipline rule / thing to avoid">
        <button class="ghost" data-action="delete-risk" data-id="${escapeHtml(risk.id)}" type="button">✕</button>
      </div>
    `).join('')
    : '<div class="tool-note">Capture discipline reminders for the coming week.</div>';
  return `
    <section class="planning-layout">
      <article class="planning-card">
        <div class="planning-card-head">
          <div>
            <p class="tool-overline">A. Weekly game plan</p>
            <h3>Weekly Game Plan</h3>
          </div>
          <span class="planning-save-state">${state.savingPlanning ? 'Saving…' : 'Saved'}</span>
        </div>
        <div class="planning-grid">
          <label><span>Week label</span><input data-section="gamePlan" data-field="weekLabel" value="${escapeHtml(planning.gamePlan.weekLabel || '')}" placeholder="07 Apr → 11 Apr"></label>
          <label><span>Week key</span><input data-section="meta" data-field="weekKey" value="${escapeHtml(planning.weekKey)}" type="date"></label>
          <label><span>Weekly focus</span><input data-section="gamePlan" data-field="weeklyFocus" value="${escapeHtml(planning.gamePlan.weeklyFocus || '')}" placeholder="What must be executed well"></label>
          <label><span>Primary market theme</span><input data-section="gamePlan" data-field="primaryTheme" value="${escapeHtml(planning.gamePlan.primaryTheme || '')}" placeholder="Macro / sector context"></label>
          <label><span>Risk mode</span><select data-section="gamePlan" data-field="riskMode"><option value="Conservative" ${planning.gamePlan.riskMode === 'Conservative' ? 'selected' : ''}>Conservative</option><option value="Normal" ${planning.gamePlan.riskMode === 'Normal' ? 'selected' : ''}>Normal</option><option value="Aggressive" ${planning.gamePlan.riskMode === 'Aggressive' ? 'selected' : ''}>Aggressive</option></select></label>
          <label><span>Main objective</span><input data-section="gamePlan" data-field="mainObjective" value="${escapeHtml(planning.gamePlan.mainObjective || '')}" placeholder="Single measurable goal"></label>
        </div>
      </article>

      <article class="planning-card planning-card--primary">
        <div class="planning-card-head">
          <div><p class="tool-overline">B. Watchlist / setups</p><h3>Watchlist / Setups</h3></div>
          <button class="btn small-btn" data-action="add-setup" type="button">+ Add setup</button>
        </div>
        <div class="planning-setup-list">${setupCards}</div>
      </article>

      <div class="planning-split-grid">
        <article class="planning-card">
          <div class="planning-card-head">
            <div><p class="tool-overline">C. Key levels / triggers</p><h3>Key Levels / Triggers</h3></div>
            <button class="ghost" data-action="add-level" type="button">+ Add</button>
          </div>
          <div class="planning-table-wrap">
            <table class="planning-table">
              <thead><tr><th>Ticker</th><th>Trigger level</th><th>Reason</th><th>Action if triggered</th><th></th></tr></thead>
              <tbody>${levelsRows}</tbody>
            </table>
          </div>
        </article>

        <article class="planning-card">
          <div class="planning-card-head">
            <div><p class="tool-overline">D. Risks / things to avoid</p><h3>Risks / Things to Avoid</h3></div>
            <button class="ghost" data-action="add-risk" type="button">+ Add</button>
          </div>
          <div class="planning-risk-list">${riskRows}</div>
        </article>
      </div>
    </section>
  `;
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
  const listHtml = buildTradeReviewListHtml();
  const detailHtml = buildTradeReviewDetailHtml();
  return `
    <section class="trade-review-layout">
      <div class="trade-review-list-shell"><aside id="trade-review-list" class="trade-review-list">${listHtml}</aside></div>
      <section id="trade-review-detail" class="trade-review-detail">${detailHtml}</section>
    </section>
  `;
}

function buildTradeReviewListHtml() {
  return state.trades.map((trade) => `
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
}

function buildTradeReviewDetailHtml() {
  const selected = getSelectedTrade();
  if (!selected) return '<div class="tool-note">Select a trade.</div>';
  const selectedTags = Array.isArray(selected.tags) ? selected.tags : [];
  const notes = typeof selected.notes === 'string' ? selected.notes : '';
  const outcomesHtml = REVIEW_OUTCOMES.map(item => `<button class="trade-review-outcome ${selected.outcome === item.key ? 'is-active' : ''}" data-outcome="${item.key}" type="button">${item.label}</button>`).join('');
  const tagsHtml = REVIEW_TAGS.map(tag => `<button class="trade-review-tag ${selectedTags.includes(tag) ? 'is-active' : ''}" data-tag="${tag}" type="button">${tag}</button>`).join('');
  return `
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
  `;
}

function renderTradeReviewDetail() {
  const detail = $('#trade-review-detail');
  if (!detail) return;
  detail.innerHTML = buildTradeReviewDetailHtml();
}

function renderTradeReviewList({ preserveScroll = false } = {}) {
  const list = $('#trade-review-list');
  if (!list) return;
  const previousScrollTop = preserveScroll ? list.scrollTop : 0;
  list.innerHTML = buildTradeReviewListHtml();
  if (preserveScroll) list.scrollTop = previousScrollTop;
}

function updateTradeReviewSelection() {
  const list = $('#trade-review-list');
  if (!list) return;
  list.querySelectorAll('.trade-review-row').forEach((row) => {
    row.classList.toggle('is-active', row.dataset.tradeId === state.selectedTradeId);
  });
  renderTradeReviewDetail();
}

function refreshTradeReviewPanel({ preserveScroll = false } = {}) {
  const content = $('#review-tab-content');
  if (!content || state.activeTab !== 'trade-review') return;
  const hasMountedLayout = Boolean(content.querySelector('.trade-review-layout'));
  const nextHtml = TradeReviewPanel();
  if (!hasMountedLayout || state.loadingTrades || state.tradeError || !state.trades.length) {
    content.innerHTML = nextHtml;
    return;
  }
  renderTradeReviewList({ preserveScroll });
  renderTradeReviewDetail();
}

let saveNotesTimer = null;
let savePlanningTimer = null;

async function patchTradeReview(tradeId, patch) {
  const trade = getTradeById(tradeId);
  if (!trade) return;
  Object.assign(trade, patch);
  if (state.activeTab === 'trade-review') refreshTradeReviewPanel({ preserveScroll: true });
  else ReviewPage();
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

async function savePlanning() {
  if (!state.planning) return;
  state.savingPlanning = true;
  if (state.activeTab === 'planning') ReviewPage();
  try {
    const payload = normalizePlanningDocument(state.planning);
    const response = await api('/api/review/planning', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planning: payload, weekKey: payload.weekKey })
    });
    state.planning = normalizePlanningDocument(response?.planning || payload);
    state.planningError = '';
  } catch (error) {
    state.planningError = error?.message || 'Failed to save planning workspace.';
  } finally {
    state.savingPlanning = false;
    if (state.activeTab === 'planning') ReviewPage();
  }
}

function schedulePlanningSave() {
  if (savePlanningTimer) clearTimeout(savePlanningTimer);
  savePlanningTimer = setTimeout(() => {
    savePlanning();
  }, 220);
}

function updatePlanningField(section, id, field, value) {
  if (!state.planning) state.planning = createPlanningDocument();
  if (section === 'gamePlan' && state.planning.gamePlan) {
    state.planning.gamePlan[field] = value;
  } else if (section === 'meta' && field === 'weekKey') {
    const nextWeekKey = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(nextWeekKey)) {
      state.planning.weekKey = nextWeekKey;
      if (!state.planning.gamePlan.weekLabel) {
        state.planning.gamePlan.weekLabel = formatWeekLabelFromKey(nextWeekKey);
      }
    }
  } else if (section === 'setups') {
    const item = (state.planning.setups || []).find(setup => setup.id === id);
    if (item) item[field] = value;
  } else if (section === 'levels') {
    const item = (state.planning.levels || []).find(level => level.id === id);
    if (item) item[field] = value;
  } else if (section === 'risks') {
    const item = (state.planning.risks || []).find(risk => risk.id === id);
    if (item) item[field] = value;
  }
  schedulePlanningSave();
}

async function loadPlanning() {
  state.loadingPlanning = true;
  state.planningError = '';
  if (state.activeTab === 'planning') ReviewPage();
  try {
    const response = await api('/api/review/planning');
    state.planning = normalizePlanningDocument(response?.planning || createPlanningDocument());
  } catch (error) {
    state.planningError = error?.message || 'Failed to load planning workspace.';
  } finally {
    state.loadingPlanning = false;
    if (state.activeTab === 'planning') ReviewPage();
  }
}

function bindTradeReviewActions() {
  $('#review-tab-content')?.addEventListener('click', (event) => {
    const row = event.target.closest('.trade-review-row');
    if (row?.dataset?.tradeId) {
      state.selectedTradeId = row.dataset.tradeId;
      updateTradeReviewSelection();
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

function bindPlanningActions() {
  $('#review-tab-content')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    if (!state.planning) state.planning = createPlanningDocument();
    if (btn.dataset.action === 'add-setup') {
      state.planning.setups.push(createEmptySetup());
      ReviewPage();
      schedulePlanningSave();
      return;
    }
    if (btn.dataset.action === 'delete-setup' && btn.dataset.id) {
      state.planning.setups = state.planning.setups.filter(item => item.id !== btn.dataset.id);
      ReviewPage();
      schedulePlanningSave();
      return;
    }
    if (btn.dataset.action === 'add-level') {
      state.planning.levels.push(createEmptyLevel());
      ReviewPage();
      schedulePlanningSave();
      return;
    }
    if (btn.dataset.action === 'delete-level' && btn.dataset.id) {
      state.planning.levels = state.planning.levels.filter(item => item.id !== btn.dataset.id);
      ReviewPage();
      schedulePlanningSave();
      return;
    }
    if (btn.dataset.action === 'add-risk') {
      state.planning.risks.push(createEmptyRiskNote());
      ReviewPage();
      schedulePlanningSave();
      return;
    }
    if (btn.dataset.action === 'delete-risk' && btn.dataset.id) {
      state.planning.risks = state.planning.risks.filter(item => item.id !== btn.dataset.id);
      ReviewPage();
      schedulePlanningSave();
    }
  });
  $('#review-tab-content')?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-section][data-field]');
    if (!input) return;
    const section = input.dataset.section;
    const field = input.dataset.field;
    const id = input.dataset.id || '';
    const value = input.type === 'checkbox' ? input.checked : String(input.value || '');
    updatePlanningField(section, id, field, value);
  });
  $('#review-tab-content')?.addEventListener('change', (event) => {
    const input = event.target.closest('[data-section][data-field]');
    if (!input) return;
    const section = input.dataset.section;
    const field = input.dataset.field;
    const id = input.dataset.id || '';
    const value = input.type === 'checkbox' ? input.checked : String(input.value || '');
    updatePlanningField(section, id, field, value);
  });
}

async function init() {
  bindTabs();
  bindModalActions();
  bindTradeReviewActions();
  bindPlanningActions();
  await loadRecap();
  await loadTrades();
  await loadPlanning();

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
