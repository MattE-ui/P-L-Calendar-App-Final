(function initPerfDiagnostics() {
  const ENV_ENABLED = false;
  const QUERY_KEYS = ['perf', '__perf', 'debugPerf'];
  const STORAGE_KEY = 'perfDiagnosticsEnabled';
  const HEADER_VALUE = '1';
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const inFlightCounts = new Map();
  let fetchWrapped = false;
  let navSeq = 0;

  function readEnabledFlag() {
    if (ENV_ENABLED) return true;
    const query = new URLSearchParams(window.location.search || '');
    if (QUERY_KEYS.some((key) => ['1', 'true', 'yes', 'on'].includes(String(query.get(key) || '').toLowerCase()))) {
      localStorage.setItem(STORAGE_KEY, '1');
      return true;
    }
    return localStorage.getItem(STORAGE_KEY) === '1';
  }

  function log(event, payload = {}) {
    if (!readEnabledFlag()) return;
    console.info('[perf][client]', { event, ts: new Date().toISOString(), path: window.location.pathname, ...payload });
  }

  function mark(label, extra = {}) {
    const ts = now();
    log('marker', { label, atMs: Number(ts.toFixed(2)), ...extra });
    return ts;
  }

  function measure(label, startedAt, extra = {}) {
    const durationMs = now() - startedAt;
    log('measure', { label, durationMs: Number(durationMs.toFixed(2)), ...extra });
    return durationMs;
  }

  function wrapFetch() {
    if (fetchWrapped || typeof window.fetch !== 'function') return;
    fetchWrapped = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const method = String(init.method || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : (input?.url || '');
      const key = `${method} ${url}`;
      const startedAt = now();
      const count = (inFlightCounts.get(key) || 0) + 1;
      inFlightCounts.set(key, count);
      if (count > 1) {
        log('duplicate-request', { key, inFlightCount: count });
      }
      const headers = new Headers(init.headers || {});
      headers.set('x-perf-debug', HEADER_VALUE);
      const nextInit = { ...init, headers };
      log('fetch-start', { method, url, inFlightCount: count });
      try {
        const response = await originalFetch(input, nextInit);
        const durationMs = now() - startedAt;
        log('fetch-end', {
          method,
          url,
          status: response.status,
          durationMs: Number(durationMs.toFixed(2)),
          requestId: response.headers.get('x-request-id') || null
        });
        return response;
      } finally {
        const current = (inFlightCounts.get(key) || 1) - 1;
        if (current <= 0) inFlightCounts.delete(key);
        else inFlightCounts.set(key, current);
      }
    };
  }

  function setupNavigationTracking() {
    document.addEventListener('click', (event) => {
      const link = event.target?.closest?.('a[href]');
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      const target = new URL(href, window.location.origin);
      if (target.origin !== window.location.origin) return;
      navSeq += 1;
      mark('route-transition-start', { navId: navSeq, to: `${target.pathname}${target.search}` });
    }, true);
    window.addEventListener('pageshow', () => {
      mark('route-transition-end', { fromNavigationEntry: true });
    });
  }

  const api = {
    isEnabled: readEnabledFlag,
    enable: () => localStorage.setItem(STORAGE_KEY, '1'),
    disable: () => localStorage.removeItem(STORAGE_KEY),
    mark,
    measure,
    trackApi: async (label, promise) => {
      const started = mark(`${label}:start`);
      const result = await promise;
      measure(`${label}:end`, started);
      return result;
    },
    log
  };

  window.PerfDiagnostics = api;
  mark('page-mount');
  wrapFetch();
  setupNavigationTracking();
})();
