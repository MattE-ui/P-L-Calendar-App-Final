const NASDAQ_EARNINGS_CALENDAR_API_URL = 'https://api.nasdaq.com/api/calendar/earnings';
const NASDAQ_EARNINGS_SOURCE_URL = 'https://www.nasdaq.com/market-activity/earnings';
const DEFAULT_DAYS_AHEAD = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeTicker(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.\-_]/g, '');
}

function normalizeDateOnly(raw) {
  const value = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function normalizeDaysAhead(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DAYS_AHEAD;
  return Math.min(parsed, 30);
}

function parseDateToUtcMs(raw) {
  const normalized = normalizeDateOnly(raw);
  if (!normalized) return null;
  const ms = Date.parse(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

function formatUtcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function enumerateDateRangeInclusive(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const dates = [];
  for (let current = startMs; current <= endMs; current += MS_PER_DAY) {
    dates.push(formatUtcDate(current));
  }
  return dates;
}

function parseSessionTime(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'unspecified';
  if (value.includes('pre-market') || value.includes('premarket') || value === 'before market open' || value === 'bmo') return 'pre-market';
  if (value.includes('after-hours') || value.includes('after market close') || value === 'amc') return 'after-hours';
  return value;
}

function parseScheduledAt(dateOnly, sessionTime) {
  const date = normalizeDateOnly(dateOnly);
  if (!date) return null;
  if (sessionTime === 'pre-market') return `${date}T12:00:00.000Z`;
  if (sessionTime === 'after-hours') return `${date}T21:00:00.000Z`;
  return `${date}T16:00:00.000Z`;
}

function normalizeNasdaqEarningsRow(row, { tickerUniverse = null } = {}) {
  const ticker = normalizeTicker(row?.symbol);
  if (!ticker) return null;
  if (tickerUniverse && tickerUniverse.size && !tickerUniverse.has(ticker)) return null;

  const reportDate = normalizeDateOnly(row?.reportDate);
  if (!reportDate) return null;

  const sessionTime = parseSessionTime(row?.time);
  const scheduledAt = parseScheduledAt(reportDate, sessionTime);
  if (!scheduledAt) return null;

  const nowMs = Date.now();
  const scheduledMs = new Date(scheduledAt).getTime();
  const companyName = String(row?.companyName || '').trim();

  return {
    sourceType: 'earnings',
    eventType: 'earnings',
    ticker,
    canonicalTicker: ticker,
    title: `Earnings: ${ticker}`,
    summary: companyName ? `${companyName} earnings report` : `${ticker} earnings report`,
    body: null,
    country: null,
    region: null,
    importance: 70,
    scheduledAt,
    publishedAt: null,
    sourceName: 'Nasdaq',
    sourceUrl: NASDAQ_EARNINGS_SOURCE_URL,
    sourceExternalId: `nasdaq:earnings:${ticker}:${reportDate}`,
    status: scheduledMs > nowMs ? 'upcoming' : 'completed',
    metadataJson: {
      provider: 'nasdaqEarningsProvider',
      companyName: companyName || null,
      epsForecast: row?.epsForecast ?? null,
      time: sessionTime,
      fiscalQuarterEnding: normalizeDateOnly(row?.fiscalQuarterEnding),
      raw: row
    }
  };
}

function buildDateRange({ from, to, daysAhead = DEFAULT_DAYS_AHEAD } = {}) {
  return buildDateRangePlan({ from, to, daysAhead }).dates;
}

function buildDateRangePlan({ from, to, daysAhead = DEFAULT_DAYS_AHEAD } = {}) {
  const fromDate = normalizeDateOnly(from);
  const toDate = normalizeDateOnly(to);
  const normalizedDaysAhead = normalizeDaysAhead(daysAhead);

  const explicitFromMs = parseDateToUtcMs(fromDate);
  const explicitToMs = parseDateToUtcMs(toDate);

  if (explicitFromMs !== null && explicitToMs !== null) {
    const dates = enumerateDateRangeInclusive(explicitFromMs, explicitToMs);
    return {
      strategy: 'explicit',
      fromDateRaw: from ?? null,
      toDateRaw: to ?? null,
      fromDate: fromDate,
      toDate: toDate,
      daysAhead: normalizedDaysAhead,
      dates,
      isValidRange: dates.length > 0
    };
  }

  const todayDate = new Date().toISOString().slice(0, 10);
  const startMs = parseDateToUtcMs(todayDate);
  const endMs = startMs + (normalizedDaysAhead * MS_PER_DAY);
  const dates = enumerateDateRangeInclusive(startMs, endMs);
  return {
    strategy: 'horizon',
    fromDateRaw: from ?? null,
    toDateRaw: to ?? null,
    fromDate: todayDate,
    toDate: formatUtcDate(endMs),
    daysAhead: normalizedDaysAhead,
    dates,
    isValidRange: dates.length > 0
  };
}

function buildRequestUrl(baseUrl, date) {
  const url = new URL(baseUrl);
  url.searchParams.set('date', date);
  return url.toString();
}

async function fetchNasdaqEarningsEvents({
  tickers = [],
  from,
  to,
  daysAhead = process.env.NASDAQ_EARNINGS_DAYS_AHEAD || DEFAULT_DAYS_AHEAD,
  fetcher = global.fetch,
  logger = console,
  baseUrl = NASDAQ_EARNINGS_CALENDAR_API_URL
} = {}) {
  const startedAt = Date.now();
  const tickerUniverse = new Set((Array.isArray(tickers) ? tickers : []).map((item) => normalizeTicker(item)).filter(Boolean));
  const datePlan = buildDateRangePlan({ from, to, daysAhead });
  const requestedDates = datePlan.dates;

  const diagnostics = {
    provider: 'nasdaq',
    fromDateRaw: datePlan.fromDateRaw,
    toDateRaw: datePlan.toDateRaw,
    fromDateComputed: datePlan.fromDate,
    toDateComputed: datePlan.toDate,
    dateRangeStrategy: datePlan.strategy,
    horizonDays: datePlan.daysAhead,
    isValidRange: datePlan.isValidRange,
    datesRequested: requestedDates,
    generatedDateCount: requestedDates.length,
    generatedDatesPreview: requestedDates.slice(0, 5),
    fetchAttemptsPlanned: requestedDates.length,
    fetchAttempts: 0,
    datesFetched: 0,
    fetchFailures: [],
    unexpectedResponseShapes: [],
    totalRowsFetched: 0,
    rowsMatchedToPortfolio: 0,
    rowsSkipped: 0,
    elapsedMs: 0
  };

  logger.info('[Earnings][Nasdaq] date plan computed.', {
    fromDateRaw: diagnostics.fromDateRaw,
    toDateRaw: diagnostics.toDateRaw,
    fromDateComputed: diagnostics.fromDateComputed,
    toDateComputed: diagnostics.toDateComputed,
    horizonDays: diagnostics.horizonDays,
    generatedDateCount: diagnostics.generatedDateCount,
    generatedDatesPreview: diagnostics.generatedDatesPreview,
    fetchAttemptsPlanned: diagnostics.fetchAttemptsPlanned,
    dateRangeStrategy: diagnostics.dateRangeStrategy,
    isValidRange: diagnostics.isValidRange
  });

  if (!requestedDates.length || !tickerUniverse.size) {
    diagnostics.elapsedMs = Date.now() - startedAt;
    logger.info('[Earnings][Nasdaq] fetch completed.', diagnostics);
    return { rows: [], diagnostics };
  }

  const normalizedRows = [];

  for (const date of requestedDates) {
    const url = buildRequestUrl(baseUrl, date);
    diagnostics.fetchAttempts += 1;
    logger.info('[Earnings][Nasdaq] fetch attempt.', { date, url });
    let response;
    try {
      response = await fetcher(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json'
        }
      });
    } catch (error) {
      diagnostics.fetchFailures.push({ date, reason: error?.message || 'request_failed' });
      logger.warn('[Earnings][Nasdaq] fetch failed for date.', { date, error: error?.message || error });
      continue;
    }

    logger.info('[Earnings][Nasdaq] fetch response received.', { date, url, status: response?.status ?? null });

    if (!response?.ok) {
      diagnostics.fetchFailures.push({ date, reason: `http_${response?.status || 'unknown'}` });
      logger.warn('[Earnings][Nasdaq] fetch failed for date.', { date, status: response?.status ?? null });
      continue;
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      diagnostics.fetchFailures.push({ date, reason: 'invalid_json' });
      logger.warn('[Earnings][Nasdaq] invalid JSON payload.', { date, error: error?.message || error });
      continue;
    }

    const rows = payload?.data?.calendar?.rows;
    if (!Array.isArray(rows)) {
      diagnostics.unexpectedResponseShapes.push({ date, reason: 'data.calendar.rows_missing' });
      logger.warn('[Earnings][Nasdaq] unexpected response shape.', { date, url, status: response?.status ?? null });
      continue;
    }

    logger.info('[Earnings][Nasdaq] parsed rows for date.', { date, url, status: response?.status ?? null, rowsReturned: rows.length });
    diagnostics.datesFetched += 1;
    diagnostics.totalRowsFetched += rows.length;

    for (const row of rows) {
      const normalized = normalizeNasdaqEarningsRow(row, { tickerUniverse });
      if (!normalized) {
        diagnostics.rowsSkipped += 1;
        continue;
      }
      diagnostics.rowsMatchedToPortfolio += 1;
      normalizedRows.push(normalized);
    }
  }

  diagnostics.elapsedMs = Date.now() - startedAt;

  logger.info('[Earnings][Nasdaq] fetch completed.', diagnostics);

  return { rows: normalizedRows, diagnostics };
}

module.exports = {
  NASDAQ_EARNINGS_CALENDAR_API_URL,
  NASDAQ_EARNINGS_SOURCE_URL,
  buildDateRange,
  buildDateRangePlan,
  normalizeNasdaqEarningsRow,
  fetchNasdaqEarningsEvents
};
