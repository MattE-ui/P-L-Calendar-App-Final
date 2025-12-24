const DEFAULT_BIN_COUNT = 12;

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function median(values = []) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function standardDeviation(values = []) {
  if (!values.length) return null;
  const mean = values.reduce((s, n) => s + n, 0) / values.length;
  const variance = values.reduce((s, n) => s + Math.pow(n - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function summarizeTrades(trades = []) {
  const closed = trades.filter(t => Number.isFinite(safeNumber(t.realizedPnlGBP)));
  if (!closed.length) {
    return {
      total: 0,
      wins: 0,
      losses: 0,
      grossProfit: 0,
      grossLoss: 0,
      winRate: 0,
      lossRate: 0,
      avgWin: 0,
      avgLoss: 0,
      expectancy: 0,
      profitFactor: null,
      avgR: null
    };
  }
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let totalR = 0;
  let countedR = 0;

  closed.forEach(trade => {
    const pnl = safeNumber(trade.realizedPnlGBP) || 0;
    if (pnl > 0) {
      wins += 1;
      grossProfit += pnl;
    } else if (pnl < 0) {
      losses += 1;
      grossLoss += Math.abs(pnl);
    }
    const rMultiple = safeNumber(trade.rMultiple);
    if (rMultiple !== null && rMultiple !== undefined) {
      totalR += rMultiple;
      countedR += 1;
    } else {
      const risk = safeNumber(trade.riskAmountGBP);
      if (risk && risk > 0) {
        totalR += pnl / risk;
        countedR += 1;
      }
    }
  });

  const total = closed.length;
  const winRate = total ? wins / total : 0;
  const lossRate = total ? losses / total : 0;
  const avgWin = wins ? grossProfit / wins : 0;
  const avgLoss = losses ? grossLoss / losses : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;
  const expectancy = (winRate * avgWin) - (lossRate * avgLoss);
  const avgR = countedR ? totalR / countedR : null;

  return {
    total,
    wins,
    losses,
    grossProfit,
    grossLoss,
    winRate,
    lossRate,
    avgWin,
    avgLoss,
    expectancy,
    profitFactor,
    avgR
  };
}

function equityCurve(trades = []) {
  let cumulative = 0;
  const sorted = trades
    .filter(t => Number.isFinite(safeNumber(t.realizedPnlGBP)))
    .map(t => ({ date: t.closeDate || t.openDate, pnl: safeNumber(t.realizedPnlGBP) || 0 }))
    .filter(p => typeof p.date === 'string')
    .sort((a, b) => a.date.localeCompare(b.date));

  return sorted.map(point => {
    cumulative += point.pnl;
    return { ...point, cumulative };
  });
}

function drawdowns(curve = []) {
  let peak = 0;
  let peakDate = null;
  let troughDate = null;
  let recoveryDate = null;
  let maxDrawdown = 0;
  let maxDuration = 0;
  let currentDuration = 0;
  const series = [];

  curve.forEach(point => {
    if (point.cumulative > peak || peakDate === null) {
      peak = point.cumulative;
      peakDate = point.date;
      currentDuration = 0;
    }
    const dd = point.cumulative - peak;
    series.push({ date: point.date, drawdown: dd });
    if (dd < maxDrawdown) {
      maxDrawdown = dd;
      troughDate = point.date;
      recoveryDate = null;
    }
    if (dd < 0) {
      currentDuration += 1;
      if (currentDuration > maxDuration) {
        maxDuration = currentDuration;
      }
    } else {
      if (maxDrawdown < 0 && !recoveryDate) {
        recoveryDate = point.date;
      }
      currentDuration = 0;
    }
  });

  return {
    maxDrawdown,
    peakDate,
    troughDate,
    recoveryDate,
    durationDays: maxDuration,
    series
  };
}

function distribution(trades = [], binCount = DEFAULT_BIN_COUNT) {
  const pnls = trades
    .map(t => safeNumber(t.realizedPnlGBP))
    .filter(v => v !== null);
  if (!pnls.length) {
    return {
      median: null,
      stddev: null,
      best: null,
      worst: null,
      histogram: []
    };
  }
  const min = Math.min(...pnls);
  const max = Math.max(...pnls);
  const bucketSize = (max - min) / (binCount || DEFAULT_BIN_COUNT || 1) || 1;
  const bins = [];
  for (let i = 0; i < (binCount || DEFAULT_BIN_COUNT); i++) {
    const start = min + i * bucketSize;
    const end = i === binCount - 1 ? max : start + bucketSize;
    bins.push({ start, end, count: 0 });
  }
  pnls.forEach(value => {
    if (!bins.length) return;
    if (value === max) {
      bins[bins.length - 1].count += 1;
      return;
    }
    const idx = Math.floor((value - min) / bucketSize);
    const safeIdx = Math.min(Math.max(idx, 0), bins.length - 1);
    bins[safeIdx].count += 1;
  });
  return {
    median: median(pnls),
    stddev: standardDeviation(pnls),
    best: max,
    worst: min,
    histogram: bins
  };
}

function streaks(trades = []) {
  const closed = trades
    .filter(t => Number.isFinite(safeNumber(t.realizedPnlGBP)))
    .sort((a, b) => (a.closeDate || a.openDate || '').localeCompare(b.closeDate || b.openDate || ''));
  let currentWin = 0;
  let currentLoss = 0;
  let maxWin = 0;
  let maxLoss = 0;
  closed.forEach(trade => {
    const pnl = safeNumber(trade.realizedPnlGBP) || 0;
    if (pnl > 0) {
      currentWin += 1;
      currentLoss = 0;
    } else if (pnl < 0) {
      currentLoss += 1;
      currentWin = 0;
    } else {
      currentWin = 0;
      currentLoss = 0;
    }
    if (currentWin > maxWin) maxWin = currentWin;
    if (currentLoss > maxLoss) maxLoss = currentLoss;
  });
  return { maxWinStreak: maxWin, maxLossStreak: maxLoss };
}

function breakdowns(trades = []) {
  const pnlByType = {};
  const pnlByStrategy = {};
  const winLossByType = {};

  trades.forEach(trade => {
    const type = trade.tradeType || 'unspecified';
    const strategy = trade.strategyTag || 'Unspecified';
    const pnl = safeNumber(trade.realizedPnlGBP) || 0;
    pnlByType[type] = (pnlByType[type] || 0) + pnl;
    pnlByStrategy[strategy] = (pnlByStrategy[strategy] || 0) + pnl;

    if (!winLossByType[type]) {
      winLossByType[type] = { wins: 0, total: 0 };
    }
    if (pnl > 0) {
      winLossByType[type].wins += 1;
    }
    if (pnl !== 0) {
      winLossByType[type].total += 1;
    }
  });

  const winRateByType = {};
  Object.entries(winLossByType).forEach(([type, stats]) => {
    winRateByType[type] = stats.total ? stats.wins / stats.total : 0;
  });

  return { pnlByType, pnlByStrategy, winRateByType };
}

module.exports = {
  summarizeTrades,
  equityCurve,
  drawdowns,
  distribution,
  streaks,
  breakdowns,
  median,
  standardDeviation
};
