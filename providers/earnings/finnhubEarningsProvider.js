const FINNHUB_EARNINGS_URL = 'https://finnhub.io/api/v1/calendar/earnings';
const DEFAULT_DAYS_AHEAD = 45;

function normalizeTicker(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.\-_]/g, '');
}

function normalizeDateOnly(raw) {
  const value = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function parseDateOnly(raw, fallback = null) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (raw instanceof Date && Number.isFinite(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'number' && Number.isFinite(raw)) return new Date(raw).toISOString().slice(0, 10);
  const strict = normalizeDateOnly(raw);
  if (strict) return strict;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : fallback;
}

function addDays(dateOnly, days) {
  const base = Date.parse(`${dateOnly}T00:00:00.000Z`);
  if (!Number.isFinite(base)) return null;
  return new Date(base + (days * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function computeDateRange({ from, to, daysAhead = DEFAULT_DAYS_AHEAD, nowMs = Date.now() } = {}) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const fromDate = parseDateOnly(from, today);
  const toDate = parseDateOnly(to, addDays(fromDate, daysAhead));
  return { fromDate, toDate };
}

function formatRevenue(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return null;
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 100e9 ? 0 : 1).replace(/\.0$/, '')}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 100e6 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `${sign}$${num.toFixed(2)}`;
}

function formatEps(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const sign = num < 0 ? '-' : '';
  return `${sign}$${Math.abs(num).toFixed(2)}`;
}

function buildSummary({ symbol, hour, epsEstimate, epsActual, revenueEstimate, revenueActual }) {
  const chunks = [];
  if (hour) chunks.push(`timing ${String(hour).toUpperCase()}`);
  const fmtEpsEst = epsEstimate != null && epsEstimate !== '' ? formatEps(epsEstimate) : null;
  const fmtEpsAct = epsActual != null && epsActual !== '' ? formatEps(epsActual) : null;
  const fmtRevEst = revenueEstimate != null && revenueEstimate !== '' ? formatRevenue(revenueEstimate) : null;
  const fmtRevAct = revenueActual != null && revenueActual !== '' ? formatRevenue(revenueActual) : null;
  if (fmtEpsEst) chunks.push(`EPS est ${fmtEpsEst}`);
  if (fmtEpsAct) chunks.push(`EPS act ${fmtEpsAct}`);
  if (fmtRevEst) chunks.push(`Rev est ${fmtRevEst}`);
  if (fmtRevAct) chunks.push(`Rev act ${fmtRevAct}`);
  return chunks.length ? `${symbol} earnings (${chunks.join(', ')})` : `${symbol} earnings scheduled`;
}

function buildScheduledAt(dateOnly, hour) {
  const date = normalizeDateOnly(dateOnly);
  if (!date) return null;
  const hourCode = String(hour || '').trim().toLowerCase();
  const timeMap = {
    bmo: '13:00:00.000Z',
    amc: '21:00:00.000Z',
    dmh: '16:00:00.000Z'
  };
  return `${date}T${timeMap[hourCode] || '16:00:00.000Z'}`;
}

function deriveStatus(scheduledAt, nowMs = Date.now()) {
  const scheduledMs = Date.parse(String(scheduledAt || ''));
  if (!Number.isFinite(scheduledMs)) return 'unknown';
  return scheduledMs > nowMs ? 'upcoming' : 'published';
}

function toCsvPreview(values, limit = 12) {
  return (Array.isArray(values) ? values : []).filter(Boolean).slice(0, limit).join(', ');
}

function normalizeFinnhubRowWithReason(row, { tickerUniverse = null, nowMs = Date.now() } = {}) {
  if (!row || typeof row !== 'object') return { row: null, reason: 'dropped_invalid_row' };
  const ticker = normalizeTicker(row.symbol);
  if (!ticker) return { row: null, reason: 'dropped_missing_symbol' };
  if (tickerUniverse && tickerUniverse.size && !tickerUniverse.has(ticker)) return { row: null, reason: 'dropped_not_in_portfolio' };

  const dateOnly = normalizeDateOnly(row.date);
  if (!dateOnly) return { row: null, reason: 'dropped_invalid_date' };

  const scheduledAt = buildScheduledAt(dateOnly, row.hour);
  if (!scheduledAt) return { row: null, reason: 'dropped_invalid_date' };

  const scheduledMs = Date.parse(scheduledAt);
  if (!Number.isFinite(scheduledMs)) return { row: null, reason: 'dropped_invalid_date' };
  if (scheduledMs <= nowMs) return { row: null, reason: 'dropped_past_date' };

  return {
    reason: 'kept_future_match',
    row: {
      sourceType: 'earnings',
      eventType: 'earnings',
      source: 'finnhub',
      ticker,
      canonicalTicker: ticker,
      title: `Earnings: ${ticker}`,
      summary: buildSummary({
        symbol: ticker,
        hour: row.hour,
        epsEstimate: row.epsEstimate,
        epsActual: row.epsActual,
        revenueEstimate: row.revenueEstimate,
        revenueActual: row.revenueActual
      }),
      body: null,
      country: null,
      region: null,
      importance: 70,
      scheduledAt,
      publishedAt: null,
      sourceName: 'Finnhub',
      sourceUrl: 'https://finnhub.io/docs/api/earnings-calendar',
      sourceExternalId: `finnhub:earnings:${ticker}:${dateOnly}`,
      status: deriveStatus(scheduledAt, nowMs),
      metadataJson: {
        provider: 'finnhubEarningsProvider',
        date: dateOnly,
        hour: row.hour || null,
        quarter: row.quarter ?? null,
        year: row.year ?? null,
        epsEstimate: row.epsEstimate ?? null,
        epsActual: row.epsActual ?? null,
        revenueEstimate: row.revenueEstimate ?? null,
        revenueActual: row.revenueActual ?? null,
        raw: row
      }
    }
  };
}

function normalizeFinnhubEarningsRow(row, options = {}) {
  return normalizeFinnhubRowWithReason(row, options).row;
}

function selectNextUpcomingEarningsPerTicker(rows, nowMs = Date.now()) {
  const earliestByTicker = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const canonicalTicker = normalizeTicker(row?.canonicalTicker || row?.ticker);
    const scheduledMs = Date.parse(String(row?.scheduledAt || ''));
    if (!canonicalTicker || !Number.isFinite(scheduledMs) || scheduledMs <= nowMs) continue;
    const existing = earliestByTicker.get(canonicalTicker);
    if (!existing || scheduledMs < existing.scheduledMs) {
      earliestByTicker.set(canonicalTicker, { row, scheduledMs });
    }
  }
  return {
    rows: Array.from(earliestByTicker.values())
      .map((item) => item.row)
      .sort((a, b) => String(a?.scheduledAt || '').localeCompare(String(b?.scheduledAt || ''))),
    nextEarningsTickers: Array.from(earliestByTicker.keys())
  };
}

async function fetchFinnhubEarningsEvents({
  tickers = [],
  from,
  to,
  fetcher = global.fetch,
  logger = console,
  apiKey = process.env.FINNHUB_API_KEY,
  baseUrl = FINNHUB_EARNINGS_URL
} = {}) {
  const startedAt = Date.now();
  const tickerUniverse = new Set((Array.isArray(tickers) ? tickers : []).map(normalizeTicker).filter(Boolean));
  const { fromDate, toDate } = computeDateRange({ from, to, nowMs: startedAt });
  const diagnostics = {
    provider: 'finnhub',
    apiKeyPresent: !!String(apiKey || '').trim(),
    trackedTickersInput: Array.from(tickerUniverse).sort(),
    fromDateComputed: fromDate,
    toDateComputed: toDate,
    rawFinnhubEarningsCount: 0,
    normalizedEarningsByTicker: [],
    excludedRows: [],
    totalRowsFetched: 0,
    rowsMatchedToPortfolio: 0,
    uniquePortfolioTickersMatched: 0,
    nextEarningsPerTickerCount: 0,
    matchedTickersSampleCsv: '',
    unmatchedPortfolioTickersSampleCsv: '',
    rowsInserted: 0,
    failureReason: null,
    failureBodySnippet: null,
    elapsedMs: 0
  };

  if (!diagnostics.apiKeyPresent) {
    diagnostics.failureReason = 'missing_finnhub_api_key';
    diagnostics.elapsedMs = Date.now() - startedAt;
    const error = new Error('FINNHUB_API_KEY is required for earnings ingestion');
    error.diagnostics = diagnostics;
    throw error;
  }

  if (!tickerUniverse.size) {
    diagnostics.elapsedMs = Date.now() - startedAt;
    logger.info('[Earnings][Finnhub] fetch completed.', diagnostics);
    return { rows: [], diagnostics };
  }

  const url = new URL(baseUrl);
  url.searchParams.set('from', fromDate);
  url.searchParams.set('to', toDate);
  url.searchParams.set('token', String(apiKey));

  let response;
  try {
    response = await fetcher(url.toString(), { headers: { Accept: 'application/json' } });
  } catch (error) {
    diagnostics.failureReason = error?.message || 'request_failed';
    diagnostics.elapsedMs = Date.now() - startedAt;
    const wrapped = new Error(`Finnhub earnings request failed: ${diagnostics.failureReason}`);
    wrapped.diagnostics = diagnostics;
    throw wrapped;
  }

  let payload = null;
  try {
    payload = typeof response?.json === 'function' ? await response.json() : null;
  } catch (error) {
    diagnostics.failureReason = 'body_read_failed';
    diagnostics.elapsedMs = Date.now() - startedAt;
    const wrapped = new Error('Finnhub earnings response body could not be parsed');
    wrapped.diagnostics = diagnostics;
    throw wrapped;
  }

  if (!response?.ok) {
    diagnostics.failureReason = `http_${response?.status || 'unknown'}`;
    diagnostics.failureBodySnippet = JSON.stringify(payload).slice(0, 300);
    diagnostics.elapsedMs = Date.now() - startedAt;
    const wrapped = new Error(`Finnhub earnings request returned ${response?.status || 'unknown'}`);
    wrapped.diagnostics = diagnostics;
    throw wrapped;
  }

  const rows = Array.isArray(payload?.earningsCalendar) ? payload.earningsCalendar : [];
  diagnostics.totalRowsFetched = rows.length;
  diagnostics.rawFinnhubEarningsCount = rows.length;

  const normalizedRows = [];
  for (const row of rows) {
    const normalized = normalizeFinnhubRowWithReason(row, { tickerUniverse, nowMs: startedAt }) || {};
    if (normalized?.row) {
      normalizedRows.push(normalized.row);
      diagnostics.normalizedEarningsByTicker.push({
        ticker: normalized.row.canonicalTicker || normalized.row.ticker || null,
        scheduledAt: normalized.row.scheduledAt || null
      });
    } else {
      diagnostics.excludedRows.push({
        ticker: normalizeTicker(row?.symbol),
        date: normalizeDateOnly(row?.date),
        reason: normalized.reason || 'dropped_unknown'
      });
    }
  }

  diagnostics.rowsMatchedToPortfolio = normalizedRows.length;
  const dedupedNext = selectNextUpcomingEarningsPerTicker(normalizedRows, startedAt);
  diagnostics.nextEarningsPerTickerCount = dedupedNext.rows.length;

  const matchedTickers = new Set(dedupedNext.nextEarningsTickers);
  diagnostics.uniquePortfolioTickersMatched = matchedTickers.size;
  diagnostics.matchedTickersSampleCsv = toCsvPreview(Array.from(matchedTickers));
  diagnostics.unmatchedPortfolioTickersSampleCsv = toCsvPreview(Array.from(tickerUniverse).filter((ticker) => !matchedTickers.has(ticker)));
  diagnostics.elapsedMs = Date.now() - startedAt;

  logger.info('[Earnings][Finnhub] fetch completed.', diagnostics);
  return { rows: dedupedNext.rows, diagnostics };
}

module.exports = {
  FINNHUB_EARNINGS_URL,
  DEFAULT_DAYS_AHEAD,
  computeDateRange,
  normalizeFinnhubEarningsRow,
  selectNextUpcomingEarningsPerTicker,
  fetchFinnhubEarningsEvents
};
