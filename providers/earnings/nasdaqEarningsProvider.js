const NASDAQ_EARNINGS_CALENDAR_API_URL = 'https://api.nasdaq.com/api/calendar/earnings';
const NASDAQ_EARNINGS_SOURCE_URL = 'https://www.nasdaq.com/market-activity/earnings';
const DEFAULT_DAYS_AHEAD = 45;
const MAX_DAYS_AHEAD = 120;
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
  return Math.min(parsed, MAX_DAYS_AHEAD);
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

function firstNonEmptyString(values = []) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function extractRawNasdaqSymbol(row) {
  return firstNonEmptyString([row?.symbol, row?.ticker, row?.securitySymbol, row?.issueSymbol, row?.assetSymbol]);
}

function extractNasdaqSymbolDiagnostics(row) {
  const rawSymbol = extractRawNasdaqSymbol(row);
  const normalizedTicker = normalizeTicker(rawSymbol);
  const normalizedCanonicalTicker = normalizedTicker ? normalizedTicker.toUpperCase() : '';
  return {
    rawSymbol: typeof row?.symbol === 'string' ? row.symbol : null,
    rawTicker: typeof row?.ticker === 'string' ? row.ticker : null,
    rawSecuritySymbol: typeof row?.securitySymbol === 'string' ? row.securitySymbol : null,
    normalizedTicker: normalizedTicker || null,
    normalizedCanonicalTicker: normalizedCanonicalTicker || null
  };
}

function toCsvPreview(values, limit = 12) {
  return (Array.isArray(values) ? values : [])
    .filter(Boolean)
    .slice(0, limit)
    .join(', ');
}

function normalizeNasdaqEarningsRow(row, { tickerUniverse = null } = {}) {
  if (!row) return null;
  const rawSymbol = extractRawNasdaqSymbol(row);
  if (!rawSymbol) return null;
  const ticker = normalizeTicker(rawSymbol);
  if (!ticker) return null;
  const canonicalTicker = ticker.toUpperCase();
  if (tickerUniverse && tickerUniverse.size && !tickerUniverse.has(canonicalTicker)) return null;

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
    canonicalTicker,
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
    sourceExternalId: `nasdaq:earnings:${canonicalTicker}:${reportDate}`,
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

function selectNextUpcomingEarningsPerTicker(rows, nowMs = Date.now()) {
  const earliestByTicker = new Map();
  const skippedPastRows = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const canonicalTicker = String(row?.canonicalTicker || row?.ticker || '').trim().toUpperCase();
    const scheduledMs = Date.parse(String(row?.scheduledAt || ''));
    if (!canonicalTicker || Number.isNaN(scheduledMs)) continue;
    if (scheduledMs <= nowMs) {
      skippedPastRows.push(canonicalTicker);
      continue;
    }
    const existing = earliestByTicker.get(canonicalTicker);
    if (!existing || scheduledMs < existing.scheduledMs) {
      earliestByTicker.set(canonicalTicker, { row, scheduledMs });
    }
  }
  return {
    rows: Array.from(earliestByTicker.values()).map((item) => item.row),
    skippedPastRows,
    nextEarningsTickers: Array.from(earliestByTicker.keys())
  };
}

function buildDateRange({ from, to, daysAhead = DEFAULT_DAYS_AHEAD } = {}) {
  return buildDateRangePlan({ from, to, daysAhead }).dates;
}

function buildDateRangePlan({ from, to, daysAhead = DEFAULT_DAYS_AHEAD, nowMs = Date.now() } = {}) {
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

  const todayDate = new Date(nowMs).toISOString().slice(0, 10);
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

function safeSnippet(raw, max = 300) {
  const value = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function detectResponseFormat(contentType, bodyText) {
  const type = String(contentType || '').toLowerCase();
  const text = String(bodyText || '').trim();

  if (type.includes('application/json')) return 'json';
  if (type.includes('text/html')) return 'html';
  if (type.startsWith('text/')) return 'text';

  if (text.startsWith('{') || text.startsWith('[')) return 'json';
  if (text.startsWith('<!doctype html') || text.startsWith('<html') || text.startsWith('<head') || text.startsWith('<body')) return 'html';
  if (text) return 'text';
  return 'unknown';
}

function classifyNonJsonShape(detectedFormat, bodySnippet) {
  const snippet = String(bodySnippet || '').toLowerCase();
  if (detectedFormat === 'html') {
    if (
      snippet.includes('access denied')
      || snippet.includes('captcha')
      || snippet.includes('cloudflare')
      || snippet.includes('bot')
      || snippet.includes('verify you are human')
    ) {
      return 'anti_bot_html';
    }
    return 'unexpected_html';
  }
  if (detectedFormat === 'text') return 'non_json_text';
  return 'unknown_response_format';
}

function extractRowsFromNasdaqPayload(payload) {
  const candidates = [
    ['data', 'calendar', 'rows'],
    ['data', 'rows'],
    ['data', 'data', 'rows'],
    ['data', 'earnings', 'rows'],
    ['calendar', 'rows'],
    ['earnings', 'rows'],
    ['rows']
  ];

  for (const path of candidates) {
    let current = payload;
    for (const segment of path) {
      current = current?.[segment];
    }
    if (Array.isArray(current)) {
      return { rows: current, path: path.join('.') };
    }
  }

  return { rows: null, path: null };
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
  const envDaysAheadRaw = process.env.NASDAQ_EARNINGS_DAYS_AHEAD;
  const tickerUniverse = new Set((Array.isArray(tickers) ? tickers : []).map((item) => normalizeTicker(item)).filter(Boolean));
  const datePlan = buildDateRangePlan({ from, to, daysAhead });
  const requestedDates = datePlan.dates;
  const strategyUsed = datePlan.strategy === 'explicit' ? 'explicit_range' : 'default_horizon';
  const daysAheadSource = envDaysAheadRaw === undefined ? 'default' : 'env_override';

  const diagnostics = {
    provider: 'nasdaq',
    fromDateRaw: datePlan.fromDateRaw,
    toDateRaw: datePlan.toDateRaw,
    fromDateComputed: datePlan.fromDate,
    toDateComputed: datePlan.toDate,
    dateRangeStrategy: datePlan.strategy,
    strategyUsed,
    horizonDays: datePlan.daysAhead,
    daysAheadUsed: datePlan.daysAhead,
    envDaysAheadRaw: envDaysAheadRaw ?? null,
    daysAheadSource,
    isValidRange: datePlan.isValidRange,
    datesRequested: requestedDates,
    generatedDateCount: requestedDates.length,
    generatedDatesPreview: requestedDates.slice(0, 5),
    fetchAttemptsPlanned: requestedDates.length,
    fetchAttempts: 0,
    datesFetched: 0,
    fetchFailures: [],
    unexpectedResponseShapes: [],
    unexpectedResponseShapeReasons: [],
    totalRowsFetched: 0,
    rowsExtractedBeforePortfolioFilter: 0,
    rowsMatchedToPortfolio: 0,
    rowsMismatchedToPortfolio: 0,
    uniquePortfolioTickersMatched: 0,
    nextEarningsPerTickerCount: 0,
    rowsSkipped: 0,
    rowsSkippedPastDate: 0,
    extractedSymbolsSample: [],
    extractedSymbolsSampleCsv: '',
    portfolioTickersSample: Array.from(tickerUniverse).slice(0, 10),
    portfolioTickersSampleCsv: '',
    matchedTickersSample: [],
    matchedTickersSampleCsv: '',
    unmatchedPortfolioTickersSample: [],
    unmatchedPortfolioTickersSampleCsv: '',
    extractedSymbolSetSize: 0,
    portfolioTickerSetSize: tickerUniverse.size,
    intersectionCount: 0,
    intersectionSampleCsv: '',
    normalizedRowSample: null,
    successfulJsonResponses: 0,
    htmlResponses: 0,
    nonJsonTextResponses: 0,
    unknownFormatResponses: 0,
    elapsedMs: 0
  };
  diagnostics.portfolioTickersSampleCsv = toCsvPreview(diagnostics.portfolioTickersSample);

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
    isValidRange: diagnostics.isValidRange,
    portfolioTickersSampleCsv: toCsvPreview(diagnostics.portfolioTickersSample)
  });
  logger.info('[Earnings][Nasdaq] live range summary.', {
    daysAheadUsed: diagnostics.daysAheadUsed,
    fromDateComputed: diagnostics.fromDateComputed,
    toDateComputed: diagnostics.toDateComputed,
    fetchAttemptsPlanned: diagnostics.fetchAttemptsPlanned,
    envDaysAheadRaw: diagnostics.envDaysAheadRaw,
    strategyUsed: diagnostics.strategyUsed,
    daysAheadSource: diagnostics.daysAheadSource
  });

  if (!requestedDates.length || !tickerUniverse.size) {
    diagnostics.elapsedMs = Date.now() - startedAt;
    logger.info('[Earnings][Nasdaq] fetch completed.', diagnostics);
    return { rows: [], diagnostics };
  }

  const matchedRows = [];
  const extractedSymbolSet = new Set();
  const normalizedRowSampleCandidates = [];

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

    const contentType = response?.headers?.get?.('content-type') || response?.headers?.['content-type'] || null;
    let responseText = '';
    try {
      if (typeof response?.text === 'function') {
        responseText = await response.text();
      } else if (typeof response?.json === 'function') {
        const fallbackJson = await response.json();
        responseText = JSON.stringify(fallbackJson);
      }
    } catch (error) {
      diagnostics.fetchFailures.push({ date, reason: 'body_read_failed' });
      logger.warn('[Earnings][Nasdaq] failed to read response body.', { date, url, status: response?.status ?? null, error: error?.message || error });
      continue;
    }

    const bodySnippet = safeSnippet(responseText, 300);
    const detectedFormat = detectResponseFormat(contentType, responseText);
    const perAttemptDiagnostics = {
      date,
      url,
      status: response?.status ?? null,
      contentType,
      bodySnippet,
      detectedFormat
    };

    if (detectedFormat === 'html') diagnostics.htmlResponses += 1;
    else if (detectedFormat === 'text') diagnostics.nonJsonTextResponses += 1;
    else if (detectedFormat === 'unknown') diagnostics.unknownFormatResponses += 1;

    if (detectedFormat !== 'json') {
      const reason = classifyNonJsonShape(detectedFormat, bodySnippet);
      diagnostics.unexpectedResponseShapes.push({ date, reason, detectedFormat, contentType, bodySnippet });
      diagnostics.unexpectedResponseShapeReasons.push(reason);
      logger.warn('[Earnings][Nasdaq] unexpected response shape.', { ...perAttemptDiagnostics, reason });
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(responseText);
      diagnostics.successfulJsonResponses += 1;
    } catch (error) {
      diagnostics.fetchFailures.push({ date, reason: 'invalid_json' });
      logger.warn('[Earnings][Nasdaq] invalid JSON payload.', { ...perAttemptDiagnostics, error: error?.message || error });
      continue;
    }

    const topLevelKeys = payload && typeof payload === 'object' && !Array.isArray(payload) ? Object.keys(payload).slice(0, 20) : [];
    const extracted = extractRowsFromNasdaqPayload(payload);
    if (!Array.isArray(extracted.rows)) {
      const reason = 'rows_not_found_in_known_paths';
      diagnostics.unexpectedResponseShapes.push({
        date,
        reason,
        detectedFormat,
        contentType,
        topLevelKeys,
        bodySnippet
      });
      diagnostics.unexpectedResponseShapeReasons.push(reason);
      logger.warn('[Earnings][Nasdaq] unexpected response shape.', { ...perAttemptDiagnostics, topLevelKeys, reason });
      continue;
    }

    const rows = extracted.rows;
    logger.info('[Earnings][Nasdaq] parsed rows for date.', {
      ...perAttemptDiagnostics,
      topLevelKeys,
      rowsReturned: rows.length,
      rowsPath: extracted.path
    });
    diagnostics.datesFetched += 1;
    diagnostics.totalRowsFetched += rows.length;
    diagnostics.rowsExtractedBeforePortfolioFilter += rows.length;

    for (const row of rows) {
      const symbolDiagnostics = extractNasdaqSymbolDiagnostics(row);
      if (symbolDiagnostics.normalizedCanonicalTicker) {
        extractedSymbolSet.add(symbolDiagnostics.normalizedCanonicalTicker);
      }
      if (diagnostics.extractedSymbolsSample.length < 12 && symbolDiagnostics.normalizedCanonicalTicker) {
        diagnostics.extractedSymbolsSample.push(symbolDiagnostics.normalizedCanonicalTicker);
      }
      if (normalizedRowSampleCandidates.length < 3) {
        normalizedRowSampleCandidates.push(symbolDiagnostics);
      }
      const normalized = normalizeNasdaqEarningsRow(row, { tickerUniverse });
      if (!normalized) {
        diagnostics.rowsSkipped += 1;
        continue;
      }
      diagnostics.rowsMatchedToPortfolio += 1;
      matchedRows.push(normalized);
    }
  }

  const dedupedNext = selectNextUpcomingEarningsPerTicker(matchedRows);
  const matchedTickers = new Set(dedupedNext.nextEarningsTickers);
  const unmatchedPortfolioTickers = Array.from(tickerUniverse).filter((ticker) => !matchedTickers.has(ticker));
  diagnostics.rowsSkippedPastDate = dedupedNext.skippedPastRows.length;
  diagnostics.uniquePortfolioTickersMatched = matchedTickers.size;
  diagnostics.nextEarningsPerTickerCount = dedupedNext.rows.length;
  diagnostics.matchedTickersSample = Array.from(matchedTickers).slice(0, 10);
  diagnostics.unmatchedPortfolioTickersSample = unmatchedPortfolioTickers.slice(0, 10);
  diagnostics.extractedSymbolSetSize = extractedSymbolSet.size;
  diagnostics.portfolioTickerSetSize = tickerUniverse.size;
  const intersectionTickers = Array.from(extractedSymbolSet).filter((ticker) => tickerUniverse.has(ticker));
  diagnostics.intersectionCount = intersectionTickers.length;
  diagnostics.intersectionSampleCsv = toCsvPreview(intersectionTickers);
  diagnostics.extractedSymbolsSampleCsv = toCsvPreview(diagnostics.extractedSymbolsSample);
  diagnostics.portfolioTickersSampleCsv = toCsvPreview(diagnostics.portfolioTickersSample);
  diagnostics.matchedTickersSampleCsv = toCsvPreview(diagnostics.matchedTickersSample);
  diagnostics.unmatchedPortfolioTickersSampleCsv = toCsvPreview(diagnostics.unmatchedPortfolioTickersSample);
  diagnostics.normalizedRowSample = normalizedRowSampleCandidates[0] || null;

  diagnostics.rowsMismatchedToPortfolio = Math.max(
    diagnostics.rowsExtractedBeforePortfolioFilter - diagnostics.rowsMatchedToPortfolio,
    0
  );
  diagnostics.elapsedMs = Date.now() - startedAt;
  const compactUnexpectedReasons = Object.entries(
    diagnostics.unexpectedResponseShapeReasons.reduce((acc, reason) => {
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {})
  ).map(([reason, count]) => `${reason}:${count}`);

  logger.info('[Earnings][Nasdaq] parse summary.', {
    datesFetched: diagnostics.datesFetched,
    fetchAttempts: diagnostics.fetchAttempts,
    successfulJsonResponses: diagnostics.successfulJsonResponses,
    htmlResponses: diagnostics.htmlResponses,
    rowsExtractedBeforePortfolioFilter: diagnostics.rowsExtractedBeforePortfolioFilter,
    rowsMatchedToPortfolio: diagnostics.rowsMatchedToPortfolio,
    uniquePortfolioTickersMatched: diagnostics.uniquePortfolioTickersMatched,
    nextEarningsPerTickerCount: diagnostics.nextEarningsPerTickerCount,
    rowsMismatchedToPortfolio: diagnostics.rowsMismatchedToPortfolio,
    rowsSkippedPastDate: diagnostics.rowsSkippedPastDate,
    extractedSymbolSetSize: diagnostics.extractedSymbolSetSize,
    portfolioTickerSetSize: diagnostics.portfolioTickerSetSize,
    intersectionCount: diagnostics.intersectionCount,
    intersectionSampleCsv: diagnostics.intersectionSampleCsv,
    extractedSymbolsSampleCsv: diagnostics.extractedSymbolsSampleCsv,
    portfolioTickersSampleCsv: diagnostics.portfolioTickersSampleCsv,
    matchedTickersSampleCsv: diagnostics.matchedTickersSampleCsv,
    unmatchedPortfolioTickersSampleCsv: diagnostics.unmatchedPortfolioTickersSampleCsv,
    normalizedRowSample: diagnostics.normalizedRowSample,
    unexpectedResponseShapes: compactUnexpectedReasons
  });

  logger.info('[Earnings][Nasdaq] fetch completed.', diagnostics);

  return { rows: dedupedNext.rows, diagnostics };
}

module.exports = {
  NASDAQ_EARNINGS_CALENDAR_API_URL,
  NASDAQ_EARNINGS_SOURCE_URL,
  buildDateRange,
  buildDateRangePlan,
  normalizeNasdaqEarningsRow,
  selectNextUpcomingEarningsPerTicker,
  fetchNasdaqEarningsEvents
};
