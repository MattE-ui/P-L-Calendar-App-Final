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

async function loadDiagnostics() {
  const timeRange = document.getElementById('time-range')?.value || '24h';
  const entries = [
    ['overview-panel', '/api/admin/news/diagnostics/overview'],
    ['ranking-panel', '/api/admin/news/diagnostics/ranking'],
    ['relevance-panel', '/api/admin/news/diagnostics/relevance'],
    ['thresholds-panel', '/api/admin/news/diagnostics/thresholds'],
    ['notifications-panel', '/api/admin/news/diagnostics/notifications'],
    ['sources-panel', '/api/admin/news/diagnostics/sources']
  ];

  await Promise.all(entries.map(async ([elementId, endpoint]) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = 'Loading…';
    try {
      const data = await api(`${endpoint}?timeRange=${encodeURIComponent(timeRange)}`);
      el.textContent = JSON.stringify(data?.data || {}, null, 2);
    } catch (error) {
      el.textContent = error?.message || 'Unable to load diagnostics.';
    }
  }));
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('refresh-button')?.addEventListener('click', loadDiagnostics);
  document.getElementById('time-range')?.addEventListener('change', loadDiagnostics);
  loadDiagnostics();
});
