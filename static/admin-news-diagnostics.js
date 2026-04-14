async function api(path) {
  const res = await fetch(path, { credentials: 'include' });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = '/login.html';
    return null;
  }
  if (!res.ok) {
    throw new Error(payload?.error || `Request failed (${res.status})`);
  }
  return payload;
}

function compactBaseline(data) {
  if (!data) return data;
  if (data?.metadata?.insufficientBaseline) return data;
  return {
    metadata: data.metadata,
    driftIndicators: data.driftIndicators,
    rankingScoreAverages: data?.comparisons?.rankingScoreAverages,
    thresholdDropoffPercentages: data?.comparisons?.thresholdDropoffPercentages,
    surfacedRelevanceMix: data?.comparisons?.surfacedRelevanceMix,
    sourceSuppressionPercentage: data?.comparisons?.sourceSuppressionPercentage,
    notificationBlockReasonMix: data?.comparisons?.notificationBlockReasonMix,
    eligibleVsBlockedRatios: data?.comparisons?.eligibleVsBlockedRatios
  };
}

function compactTrend(data) {
  if (!data) return data;
  return {
    metadata: data.metadata,
    recentPoints: Array.isArray(data.overviewSeries) ? data.overviewSeries.slice(-12) : []
  };
}

async function loadDiagnostics() {
  const timeRange = document.getElementById('time-range')?.value || '24h';
  const interval = document.getElementById('trend-interval')?.value || '';
  const query = new URLSearchParams({ timeRange });
  if (interval) query.set('interval', interval);

  const entries = [
    ['overview-panel', `/api/admin/news/diagnostics/overview?${query.toString()}`],
    ['ranking-panel', `/api/admin/news/diagnostics/ranking?${query.toString()}`],
    ['relevance-panel', `/api/admin/news/diagnostics/relevance?${query.toString()}`],
    ['thresholds-panel', `/api/admin/news/diagnostics/thresholds?${query.toString()}`],
    ['notifications-panel', `/api/admin/news/diagnostics/notifications?${query.toString()}`],
    ['sources-panel', `/api/admin/news/diagnostics/sources?${query.toString()}`],
    ['baseline-panel', `/api/admin/news/diagnostics/baselines?baselineWindow=${encodeURIComponent(timeRange === '7d' ? '7d' : '24h')}`],
    ['trends-panel', `/api/admin/news/diagnostics/trends?${query.toString()}`],
    ['ranking-trends-panel', `/api/admin/news/diagnostics/ranking-trends?${query.toString()}`],
    ['threshold-trends-panel', `/api/admin/news/diagnostics/threshold-trends?${query.toString()}`],
    ['notification-trends-panel', `/api/admin/news/diagnostics/notification-trends?${query.toString()}`],
    ['source-trends-panel', `/api/admin/news/diagnostics/source-trends?${query.toString()}`]
  ];

  await Promise.all(entries.map(async ([elementId, endpoint]) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = 'Loading…';
    try {
      const data = (await api(endpoint))?.data || {};
      const rendered = elementId === 'baseline-panel'
        ? compactBaseline(data)
        : (elementId === 'trends-panel' ? compactTrend(data) : data);
      el.textContent = JSON.stringify(rendered, null, 2);
    } catch (error) {
      el.textContent = error?.message || 'Unable to load diagnostics.';
    }
  }));
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('refresh-button')?.addEventListener('click', loadDiagnostics);
  document.getElementById('time-range')?.addEventListener('change', loadDiagnostics);
  document.getElementById('trend-interval')?.addEventListener('change', loadDiagnostics);
  loadDiagnostics();
});
