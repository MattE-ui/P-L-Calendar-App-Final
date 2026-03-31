(async function initSettingsPage() {
  const { api, isGuestSession } = window.AccountCenter;

  const STORAGE_KEY = 'plc-environment-config';
  const LEGACY_PREFS_KEY = 'plc-prefs';

  const DEFAULT_CONFIG = {
    defaultRiskPct: 1,
    defaultRiskCurrency: 'GBP',
    positionSizingMethod: 'risk',
    stopLossPolicy: 'required',
    layoutDensity: 'comfortable',
    dashboardDefaultView: 'overview',
    theme: 'system',
    animationsEnabled: true,
    visibleMetrics: {
      pnlPct: true,
      rMultiple: true,
      winRate: true,
      drawdown: true
    },
    autoSaveTrades: true,
    requireStopLossOnEntry: true,
    defaultGrouping: 'none',
    autoSyncBehavior: 'startup',
    exportFormat: 'csv',
    exportScope: 'all',
    includeMetricsInExport: true,
    updatedAt: null
  };

  function readJsonStorage(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch (_error) {
      return {};
    }
  }

  function mergeConfig(base, patch) {
    return {
      ...base,
      ...patch,
      visibleMetrics: {
        ...base.visibleMetrics,
        ...(patch?.visibleMetrics || {})
      }
    };
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function formatTimestamp(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  function setStatus(elementId, message, kind = 'success') {
    const element = document.getElementById(elementId);
    if (!element) return;
    if (!message) {
      element.textContent = '';
      element.classList.add('is-hidden');
      element.classList.remove('is-success', 'is-error');
      return;
    }
    element.textContent = message;
    element.classList.remove('is-hidden');
    element.classList.toggle('is-success', kind === 'success');
    element.classList.toggle('is-error', kind === 'error');
  }

  function patchOverview(config) {
    document.getElementById('overview-risk').textContent = `${config.defaultRiskPct}% per trade`;
    document.getElementById('overview-currency').textContent = config.defaultRiskCurrency;
    document.getElementById('overview-display').textContent = `${config.layoutDensity} • ${config.theme}`;
    const behaviour = [
      config.autoSaveTrades ? 'Auto-save on' : 'Auto-save off',
      config.requireStopLossOnEntry ? 'Stop-loss required' : 'Stop-loss optional',
      `Sync: ${config.autoSyncBehavior}`
    ].join(' • ');
    document.getElementById('overview-behaviour').textContent = behaviour;
    document.getElementById('settings-last-updated').textContent = `Last updated: ${formatTimestamp(config.updatedAt)}`;
  }

  function readFormConfig(currentConfig) {
    return mergeConfig(currentConfig, {
      defaultRiskPct: Number(document.getElementById('settings-risk').value),
      defaultRiskCurrency: document.getElementById('settings-currency').value,
      positionSizingMethod: document.getElementById('settings-position-sizing').value,
      stopLossPolicy: document.getElementById('settings-stoploss-policy').value,
      layoutDensity: document.getElementById('settings-layout-density').value,
      dashboardDefaultView: document.getElementById('settings-dashboard-view').value,
      theme: document.getElementById('settings-theme').value,
      animationsEnabled: document.getElementById('settings-animations').checked,
      visibleMetrics: {
        pnlPct: document.getElementById('settings-metric-pnlpct').checked,
        rMultiple: document.getElementById('settings-metric-rmultiple').checked,
        winRate: document.getElementById('settings-metric-winrate').checked,
        drawdown: document.getElementById('settings-metric-drawdown').checked
      },
      autoSaveTrades: document.getElementById('settings-auto-save').checked,
      requireStopLossOnEntry: document.getElementById('settings-require-stop').checked,
      defaultGrouping: document.getElementById('settings-grouping').value,
      autoSyncBehavior: document.getElementById('settings-autosync').value,
      exportFormat: document.getElementById('settings-export-format').value,
      exportScope: document.getElementById('settings-export-scope').value,
      includeMetricsInExport: document.getElementById('settings-export-metrics').checked
    });
  }

  function paintForm(config) {
    document.getElementById('settings-risk').value = String(config.defaultRiskPct);
    document.getElementById('settings-currency').value = config.defaultRiskCurrency;
    document.getElementById('settings-position-sizing').value = config.positionSizingMethod;
    document.getElementById('settings-stoploss-policy').value = config.stopLossPolicy;
    document.getElementById('settings-layout-density').value = config.layoutDensity;
    document.getElementById('settings-dashboard-view').value = config.dashboardDefaultView;
    document.getElementById('settings-theme').value = config.theme;
    document.getElementById('settings-animations').checked = Boolean(config.animationsEnabled);
    document.getElementById('settings-metric-pnlpct').checked = Boolean(config.visibleMetrics.pnlPct);
    document.getElementById('settings-metric-rmultiple').checked = Boolean(config.visibleMetrics.rMultiple);
    document.getElementById('settings-metric-winrate').checked = Boolean(config.visibleMetrics.winRate);
    document.getElementById('settings-metric-drawdown').checked = Boolean(config.visibleMetrics.drawdown);
    document.getElementById('settings-auto-save').checked = Boolean(config.autoSaveTrades);
    document.getElementById('settings-require-stop').checked = Boolean(config.requireStopLossOnEntry);
    document.getElementById('settings-grouping').value = config.defaultGrouping;
    document.getElementById('settings-autosync').value = config.autoSyncBehavior;
    document.getElementById('settings-export-format').value = config.exportFormat;
    document.getElementById('settings-export-scope').value = config.exportScope;
    document.getElementById('settings-export-metrics').checked = Boolean(config.includeMetricsInExport);
  }

  async function saveTradingDefaults(nextConfig) {
    const tradingPrefs = {
      defaultRiskPct: nextConfig.defaultRiskPct,
      defaultRiskCurrency: nextConfig.defaultRiskCurrency
    };
    localStorage.setItem(LEGACY_PREFS_KEY, JSON.stringify(tradingPrefs));
    if (isGuestSession()) return;
    await api('/api/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tradingPrefs)
    });
  }

  function persistConfig(nextConfig) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConfig));
  }

  function scopeToExportQuery(scope) {
    if (scope === 'win') return '?winLoss=win';
    if (scope === 'loss') return '?winLoss=loss';
    return '';
  }

  async function exportPerformanceReport(config) {
    const [summary, distribution, streaks] = await Promise.all([
      api('/api/analytics/summary'),
      api('/api/analytics/distribution'),
      api('/api/analytics/streaks')
    ]);

    const reportPayload = {
      generatedAt: nowIso(),
      exportFormat: config.exportFormat,
      exportScope: config.exportScope,
      includeMetrics: config.includeMetricsInExport,
      summary,
      distribution,
      streaks
    };

    const exportAsJson = config.exportFormat === 'json';
    const blob = exportAsJson
      ? new Blob([JSON.stringify(reportPayload, null, 2)], { type: 'application/json' })
      : new Blob([
        [
          'metric,value',
          `totalTrades,${summary?.totalTrades ?? ''}`,
          `winRate,${summary?.winRate ?? ''}`,
          `expectancyR,${summary?.expectancyR ?? ''}`,
          `profitFactor,${summary?.profitFactor ?? ''}`,
          `maxDrawdownPct,${summary?.maxDrawdownPct ?? ''}`
        ].join('\n')
      ], { type: 'text/csv;charset=utf-8;' });

    const extension = exportAsJson ? 'json' : 'csv';
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `performance-report-${new Date().toISOString().slice(0, 10)}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  }

  let config = mergeConfig(DEFAULT_CONFIG, readJsonStorage(STORAGE_KEY));
  const legacyPrefs = readJsonStorage(LEGACY_PREFS_KEY);
  config = mergeConfig(config, {
    defaultRiskPct: Number.isFinite(Number(legacyPrefs.defaultRiskPct)) ? Number(legacyPrefs.defaultRiskPct) : config.defaultRiskPct,
    defaultRiskCurrency: legacyPrefs.defaultRiskCurrency || config.defaultRiskCurrency
  });

  if (!isGuestSession()) {
    try {
      const serverPrefs = await api('/api/prefs');
      config = mergeConfig(config, {
        defaultRiskPct: Number.isFinite(Number(serverPrefs?.defaultRiskPct)) ? Number(serverPrefs.defaultRiskPct) : config.defaultRiskPct,
        defaultRiskCurrency: serverPrefs?.defaultRiskCurrency || config.defaultRiskCurrency
      });
    } catch (_error) {
      setStatus('settings-status-trading', 'Loaded local trading defaults; server preference read failed.', 'error');
    }
  }

  paintForm(config);
  patchOverview(config);

  document.getElementById('settings-save-trading')?.addEventListener('click', async () => {
    setStatus('settings-status-trading', '');
    config = readFormConfig(config);
    config.updatedAt = nowIso();
    persistConfig(config);
    try {
      await saveTradingDefaults(config);
      setStatus('settings-status-trading', 'Trading defaults applied and synced.');
    } catch (error) {
      setStatus('settings-status-trading', `Trading defaults saved locally; sync failed: ${error.message}`, 'error');
    }
    patchOverview(config);
  });

  const immediateDisplayIds = [
    'settings-layout-density',
    'settings-dashboard-view',
    'settings-theme',
    'settings-animations',
    'settings-metric-pnlpct',
    'settings-metric-rmultiple',
    'settings-metric-winrate',
    'settings-metric-drawdown'
  ];

  immediateDisplayIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      config = readFormConfig(config);
      config.updatedAt = nowIso();
      persistConfig(config);
      patchOverview(config);
      setStatus('settings-status-display', 'Display settings updated.');
    });
  });

  ['settings-auto-save', 'settings-require-stop', 'settings-grouping', 'settings-autosync'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      config = readFormConfig(config);
      config.updatedAt = nowIso();
      persistConfig(config);
      patchOverview(config);
      setStatus('settings-status-workflow', 'Workflow behaviour updated.');
    });
  });

  ['settings-export-format', 'settings-export-scope', 'settings-export-metrics'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      config = readFormConfig(config);
      config.updatedAt = nowIso();
      persistConfig(config);
      patchOverview(config);
      setStatus('settings-status-export', 'Export configuration updated.');
    });
  });

  document.getElementById('settings-export-transactions')?.addEventListener('click', () => {
    config = readFormConfig(config);
    config.updatedAt = nowIso();
    persistConfig(config);
    const query = scopeToExportQuery(config.exportScope);
    window.location.href = `/api/trades/export${query}`;
  });

  document.getElementById('settings-export-performance')?.addEventListener('click', async () => {
    setStatus('settings-status-export', 'Preparing performance report export...');
    config = readFormConfig(config);
    config.updatedAt = nowIso();
    persistConfig(config);
    if (isGuestSession()) {
      setStatus('settings-status-export', 'Performance export requires sign in.', 'error');
      return;
    }
    try {
      await exportPerformanceReport(config);
      setStatus('settings-status-export', 'Performance report downloaded.');
      patchOverview(config);
    } catch (error) {
      setStatus('settings-status-export', `Performance export failed: ${error.message}`, 'error');
    }
  });
})();
