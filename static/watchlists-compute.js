(() => {
  // ── Pin store ────────────────────────────────────────────────────────────────
  // Single localStorage key; centralised so migration to a DB-backed API is
  // a one-file change: read localStorage on load, POST to the new endpoint,
  // clear the key.
  const PINS_KEY = 'watchlist-pins';
  const pinStore = {
    read() {
      try { return JSON.parse(localStorage.getItem(PINS_KEY) || '[]'); } catch { return []; }
    },
    write(ids) {
      try { localStorage.setItem(PINS_KEY, JSON.stringify(Array.from(ids))); } catch {}
    },
    getAll() { return new Set(pinStore.read()); },
    isPinned(id) { return pinStore.read().includes(id); },
    toggle(id) {
      const pins = pinStore.read();
      const idx = pins.indexOf(id);
      if (idx >= 0) pins.splice(idx, 1); else pins.push(id);
      pinStore.write(pins);
      return idx < 0; // returns new pinned state
    }
  };

  // ── Normalisation / escaping ─────────────────────────────────────────────────
  function normalizeTicker(raw) {
    return String(raw || '').trim().toUpperCase();
  }

  function escapeHtml(v) {
    return String(v || '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  // ── Formatting ───────────────────────────────────────────────────────────────
  // Unicode minus (U+2212) for negative numbers so it renders distinct from a hyphen.
  function fmtPct(n) {
    if (!Number.isFinite(n)) return '—';
    const sign = n > 0 ? '+' : n < 0 ? '\u2212' : '';
    return `${sign}${Math.abs(n).toFixed(2)}%`;
  }

  function fmtPrice(n, currency = '$') {
    if (!Number.isFinite(n) || n <= 0) return '—';
    const dp = n < 1 ? 4 : 2;
    return `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
  }

  function fmtVolume(n) {
    if (!Number.isFinite(n) || n <= 0) return '—';
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }

  function fmtAsOf(v) {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // Relative time for < 24h, absolute date+time for older. Used in header meta row.
  function fmtRelativeOrAbsolute(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
    return d.toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  }

  // ── Session label / class ────────────────────────────────────────────────────
  function _priceSourceKey(row) {
    return String(row.selectedPriceSource || row.priceSource || '').trim();
  }

  function sessionLabel(row = {}) {
    const src = _priceSourceKey(row);
    if (src === 'preMarketPrice') return 'PRE';
    if (src === 'postMarketPrice') return 'POST';
    if (src === 'extendedHoursPrice') return 'EXT';
    if (src === 'regularMarketPrice') return 'LIVE';
    const s = String(row.session || '').toLowerCase();
    if (s === 'premarket') return 'PRE';
    if (s === 'afterhours') return 'AH';
    if (s === 'extended') return 'EXT';
    if (s === 'stale') return 'STALE';
    if (s === 'regular') return 'LIVE';
    return 'CLOSED';
  }

  function sessionClass(row = {}) {
    const src = _priceSourceKey(row);
    if (src === 'preMarketPrice') return 'is-premarket';
    if (src === 'postMarketPrice') return 'is-afterhours';
    if (src === 'extendedHoursPrice') return 'is-afterhours';
    if (src === 'regularMarketPrice') return 'is-live';
    const s = String(row.session || '').toLowerCase();
    if (s === 'premarket') return 'is-premarket';
    if (s === 'afterhours') return 'is-afterhours';
    if (s === 'extended') return 'is-afterhours';
    if (s === 'stale') return 'is-closed';
    if (s === 'regular') return 'is-live';
    return 'is-closed';
  }

  // ── Watchlist-level stats (computed client-side from loaded rows) ─────────────
  // Denominators:
  //   - gainers/total: total = rows.length (all loaded rows, incl. those with null pct).
  //     gainers = rows with displayChangePct strictly > 0.
  //   - avgChange: arithmetic mean of displayChangePct for rows where it's finite.
  //     Tickers with null pct are excluded. Unweighted.
  //   - biggestMover: row with largest abs(displayChangePct) among rows with finite pct.
  //   - avgAdr: arithmetic mean of adrPercent for rows where it's finite. Unweighted.
  function computeWatchlistStats(rows) {
    const all = Array.isArray(rows) ? rows : [];
    const withPct = all.filter((r) => Number.isFinite(r?.displayChangePct));
    if (!withPct.length) {
      return { gainers: 0, total: all.length, avgChange: null, biggestMover: null, avgAdr: null };
    }
    const gainers = withPct.filter((r) => r.displayChangePct > 0).length;
    const avgChange = withPct.reduce((s, r) => s + r.displayChangePct, 0) / withPct.length;

    let biggestMover = null;
    let biggestAbs = -Infinity;
    for (const r of withPct) {
      const abs = Math.abs(r.displayChangePct);
      if (abs > biggestAbs) { biggestAbs = abs; biggestMover = r; }
    }

    const withAdr = all.filter((r) => Number.isFinite(r?.adrPercent));
    const avgAdr = withAdr.length
      ? withAdr.reduce((s, r) => s + r.adrPercent, 0) / withAdr.length
      : null;

    return { gainers, total: all.length, avgChange, biggestMover, avgAdr };
  }

  // Section-level stats scoped to the tickers in one section.
  function computeSectionStats(tickers, rowLookup) {
    const rows = tickers.map((t) => rowLookup.get(normalizeTicker(t))).filter(Boolean);
    const withPct = rows.filter((r) => Number.isFinite(r?.displayChangePct));
    const up = withPct.filter((r) => r.displayChangePct > 0).length;
    const down = withPct.filter((r) => r.displayChangePct < 0).length;
    const avgChange = withPct.length
      ? withPct.reduce((s, r) => s + r.displayChangePct, 0) / withPct.length
      : null;
    return { up, down, avgChange };
  }

  // ── Change-detection signatures ──────────────────────────────────────────────
  function buildMarketRowsSignature(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map((r) => [
        normalizeTicker(r?.ticker),
        r?.displayPrice ?? 'null',
        r?.displayChangePct ?? r?.percentChangeToday ?? 'null',
        r?.asOf || '',
        r?.session || '',
        r?.isStale === true ? 1 : 0,
        r?.dollarVolumeDisplay || '—'
      ].join('|'))
      .join('||');
  }

  function sectionStructureSignature(sections) {
    return (Array.isArray(sections) ? sections : [])
      .map((s) => `${s.key}:${s.tickers.join(',')}`)
      .join('||');
  }

  // ── Data transforms ──────────────────────────────────────────────────────────
  const UNGROUPED_TITLE = 'Ungrouped';

  function toBuilderModel(sections) {
    const normalized = Array.isArray(sections) ? sections : [];
    const seen = new Set();
    const builder = { ungrouped: [], groups: [] };
    normalized.forEach((section, idx) => {
      const name = String(section?.title || '').trim();
      const tickers = Array.isArray(section?.tickers)
        ? section.tickers.map(normalizeTicker).filter((t) => t && !seen.has(t) && seen.add(t))
        : [];
      if (!name || name.toLowerCase() === UNGROUPED_TITLE.toLowerCase()) {
        builder.ungrouped.push(...tickers);
      } else {
        builder.groups.push({ id: String(section?.id || `group-${idx + 1}`), name, tickers });
      }
    });
    return builder;
  }

  function buildDetailSections(selected) {
    const raw = Array.isArray(selected?.sections) ? selected.sections : [];
    const normalized = raw
      .map((s, idx) => ({
        key: String(s?.id || `${selected?.id || 'wl'}-${idx + 1}`),
        title: String(s?.title || '').trim() || `Section ${idx + 1}`,
        tickers: Array.isArray(s?.tickers) ? s.tickers.map(normalizeTicker).filter(Boolean) : []
      }))
      .filter((s) => s.tickers.length);

    if (!normalized.length) return [];
    const grouped = normalized.filter((s) => s.title.toLowerCase() !== UNGROUPED_TITLE.toLowerCase());
    if (!grouped.length) return normalized.map((s) => ({ ...s, isUngrouped: false }));
    return normalized.map((s) => ({
      ...s,
      title: s.title.toLowerCase() === UNGROUPED_TITLE.toLowerCase() ? UNGROUPED_TITLE : s.title,
      isUngrouped: s.title.toLowerCase() === UNGROUPED_TITLE.toLowerCase()
    }));
  }

  // ── Filter + sort ─────────────────────────────────────────────────────────────
  function filterRows(rows, { text = '', direction = 'all' } = {}) {
    let out = Array.isArray(rows) ? rows : [];
    if (text) {
      const q = text.toLowerCase();
      out = out.filter((r) =>
        normalizeTicker(r.ticker).toLowerCase().includes(q) ||
        String(r.name || '').toLowerCase().includes(q)
      );
    }
    if (direction === 'gainers') out = out.filter((r) => Number(r.displayChangePct) > 0);
    if (direction === 'losers') out = out.filter((r) => Number(r.displayChangePct) < 0);
    return out;
  }

  function sortRows(rows, sortBy = 'manual') {
    if (sortBy === 'manual') return rows;
    const sorted = [...rows];
    const NUM = (get) => (a, b) => (get(b) ?? -Infinity) - (get(a) ?? -Infinity);
    const NUM_ASC = (get) => (a, b) => (get(a) ?? Infinity) - (get(b) ?? Infinity);
    const sortMap = {
      'change-desc': NUM((r) => r.displayChangePct),
      'change-asc': NUM_ASC((r) => r.displayChangePct),
      'price-desc': NUM((r) => r.displayPrice),
      'price-asc': NUM_ASC((r) => r.displayPrice),
      'adr-desc': NUM((r) => r.adrPercent),
      'adr-asc': NUM_ASC((r) => r.adrPercent),
      'volume-desc': NUM((r) => r.dollarVolume),
      'volume-asc': NUM_ASC((r) => r.dollarVolume),
      'ticker-az': (a, b) => normalizeTicker(a.ticker).localeCompare(normalizeTicker(b.ticker))
    };
    if (sortMap[sortBy]) sorted.sort(sortMap[sortBy]);
    return sorted;
  }

  // ── Sparkline path ────────────────────────────────────────────────────────────
  // Returns a polyline `d` attribute string for a 70×22 SVG, or null if insufficient data.
  function buildSparklinePath(closes, width = 70, height = 22) {
    if (!Array.isArray(closes) || closes.length < 2) return null;
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    const pad = 2;
    const w = width - 2 * pad;
    const h = height - 2 * pad;
    const pts = closes.map((v, i) => {
      const x = pad + (i / (closes.length - 1)) * w;
      const y = pad + h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${pts.join('L')}`;
  }

  window.WatchlistsCompute = {
    pinStore,
    normalizeTicker,
    escapeHtml,
    fmtPct,
    fmtPrice,
    fmtVolume,
    fmtAsOf,
    fmtRelativeOrAbsolute,
    sessionLabel,
    sessionClass,
    computeWatchlistStats,
    computeSectionStats,
    buildMarketRowsSignature,
    sectionStructureSignature,
    toBuilderModel,
    buildDetailSections,
    filterRows,
    sortRows,
    buildSparklinePath,
    UNGROUPED_TITLE
  };
})();
