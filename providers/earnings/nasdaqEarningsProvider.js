const NASDAQ_EARNINGS_SOURCE_URL = 'https://api.nasdaq.com/api/company';
const NASDAQ_EARNINGS_TICKER_URL_BASE = 'https://api.nasdaq.com/api/company';

const DATE_FIELD_HINTS = ['earningsdate', 'reportdate', 'date'];

function normalizeTicker(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.\-_]/g, '');
}

function normalizeDateOnly(raw) {
  const value = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function parseFlexibleDateOnly(raw) {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date && Number.isFinite(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const date = new Date(raw);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }

  const value = String(raw || '').trim();
  if (!value) return null;
  const strict = normalizeDateOnly(value);
  if (strict) return strict;
  const isoLike = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (isoLike) return isoLike[1];
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (mdy) {
    const [, mm, dd, yyyy] = mdy;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  const parsedMs = Date.parse(value);
  if (Number.isNaN(parsedMs)) return null;
  return new Date(parsedMs).toISOString().slice(0, 10);
}

function parseScheduledAt(dateOnly) {
  const date = parseFlexibleDateOnly(dateOnly);
  if (!date) return null;
  return `${date}T16:00:00.000Z`;
}

function toCsvPreview(values, limit = 12) {
  return (Array.isArray(values) ? values : [])
    .filter(Boolean)
    .slice(0, limit)
    .join(', ');
}

function buildTickerEarningsUrl(baseUrl, ticker) {
  const safeTicker = encodeURIComponent(String(ticker || '').trim().toLowerCase());
  return `${String(baseUrl).replace(/\/$/, '')}/${safeTicker}/earnings`;
}

function extractDateCandidate(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return null;

  const direct = parseFlexibleDateOnly(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractDateCandidate(item, depth + 1);
      if (candidate) return candidate;
    }
    return null;
  }

  if (typeof value !== 'object') return null;

  const prioritizedKeys = ['earningsDate', 'reportDate', 'date', 'value'];
  for (const key of prioritizedKeys) {
    const candidate = extractDateCandidate(value[key], depth + 1);
    if (candidate) return candidate;
  }

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = String(key || '').toLowerCase();
    if (!DATE_FIELD_HINTS.some((hint) => normalizedKey.includes(hint))) continue;
    const candidate = extractDateCandidate(nested, depth + 1);
    if (candidate) return candidate;
  }

  for (const nested of Object.values(value)) {
    const candidate = extractDateCandidate(nested, depth + 1);
    if (candidate) return candidate;
  }

  return null;
}

function extractEarningsDateFromApiPayload(payload) {
  const prioritizedCandidates = [
    payload?.data?.earnings?.earningsDate,
    payload?.data?.earnings?.reportDate,
    payload?.data?.earningsDate,
    payload?.data?.reportDate,
    payload?.earningsDate,
    payload?.reportDate
  ];

  for (const candidate of prioritizedCandidates) {
    const date = extractDateCandidate(candidate);
    if (date) return date;
  }

  return extractDateCandidate(payload?.data?.earnings || payload?.data || payload);
}

function normalizeNasdaqEarningsRow(row, { tickerUniverse = null } = {}) {
  const normalized = normalizeNasdaqEarningsRowWithReason(row, { tickerUniverse });
  return normalized.row;
}

function normalizeNasdaqEarningsRowWithReason(row, { tickerUniverse = null, nowMs = Date.now() } = {}) {
  if (!row) return { row: null, reason: 'dropped_invalid_row' };
  const ticker = normalizeTicker(row?.ticker || row?.symbol);
  if (!ticker) return { row: null, reason: 'dropped_missing_symbol' };
  const canonicalTicker = ticker;
  if (tickerUniverse && tickerUniverse.size && !tickerUniverse.has(canonicalTicker)) return { row: null, reason: 'dropped_not_in_portfolio' };

  const reportDate = parseFlexibleDateOnly(row?.reportDate || row?.earningsDate || row?.earningsAnnouncementDate || row?.date);
  if (!reportDate) return { row: null, reason: 'dropped_invalid_date' };

  const scheduledAt = parseScheduledAt(reportDate);
  if (!scheduledAt) return { row: null, reason: 'dropped_invalid_date' };

  const scheduledMs = Date.parse(scheduledAt);
  if (!Number.isFinite(scheduledMs)) return { row: null, reason: 'dropped_invalid_date' };
  if (scheduledMs <= nowMs) return { row: null, reason: 'dropped_past_date' };

  return {
    reason: 'kept_future_match',
    row: {
      sourceType: 'earnings',
      eventType: 'earnings',
      source: 'nasdaq',
      ticker,
      canonicalTicker,
      title: `Earnings: ${ticker}`,
      summary: `${ticker} earnings report`,
      body: null,
      country: null,
      region: null,
      importance: 70,
      scheduledAt,
      publishedAt: null,
      sourceName: 'Nasdaq',
      sourceUrl: buildTickerEarningsUrl(NASDAQ_EARNINGS_TICKER_URL_BASE, ticker),
      sourceExternalId: `nasdaq:earnings:${canonicalTicker}:${reportDate}`,
      status: 'upcoming',
      metadataJson: {
        provider: 'nasdaqEarningsProvider',
        reportDate,
        raw: row
      }
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

function buildDateRange() {
  return [];
}

function buildDateRangePlan() {
  return {
    strategy: 'disabled',
    fromDateRaw: null,
    toDateRaw: null,
    fromDate: null,
    toDate: null,
    daysAhead: 0,
    dates: [],
    isValidRange: true
  };
}

async function fetchNasdaqEarningsEvents({
  tickers = [],
  fetcher = global.fetch,
  logger = console,
  baseUrl = NASDAQ_EARNINGS_TICKER_URL_BASE
} = {}) {
  const startedAt = Date.now();
  const tickerUniverse = new Set((Array.isArray(tickers) ? tickers : []).map((item) => normalizeTicker(item)).filter(Boolean));
  const diagnostics = {
    provider: 'nasdaq',
    strategyUsed: 'company_earnings_api',
    tickersProcessed: 0,
    successfulExtractions: 0,
    failedExtractions: 0,
    extractedDatesSample: [],
    fetchFailures: [],
    parseFailures: [],
    rowsMatchedToPortfolio: 0,
    nextEarningsPerTickerCount: 0,
    matchedTickersSample: [],
    unmatchedPortfolioTickersSample: [],
    portfolioTickerSetSize: tickerUniverse.size,
    elapsedMs: 0
  };

  if (!tickerUniverse.size) {
    diagnostics.elapsedMs = Date.now() - startedAt;
    logger.info('[Earnings][Nasdaq] fetch completed.', diagnostics);
    return { rows: [], diagnostics };
  }

  const normalizedRows = [];

  for (const canonicalTicker of tickerUniverse) {
    diagnostics.tickersProcessed += 1;
    const url = buildTickerEarningsUrl(baseUrl, canonicalTicker);
    let response;
    try {
      response = await fetcher(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json'
        }
      });
    } catch (error) {
      diagnostics.failedExtractions += 1;
      diagnostics.fetchFailures.push({ ticker: canonicalTicker, reason: error?.message || 'request_failed' });
      continue;
    }

    if (!response?.ok) {
      diagnostics.failedExtractions += 1;
      diagnostics.fetchFailures.push({ ticker: canonicalTicker, reason: `http_${response?.status || 'unknown'}` });
      continue;
    }

    let payload = null;
    try {
      payload = typeof response?.json === 'function' ? await response.json() : null;
    } catch (error) {
      diagnostics.failedExtractions += 1;
      diagnostics.fetchFailures.push({ ticker: canonicalTicker, reason: 'body_read_failed' });
      continue;
    }

    const parsedDate = extractEarningsDateFromApiPayload(payload);
    if (!parsedDate) {
      diagnostics.failedExtractions += 1;
      diagnostics.parseFailures.push({ ticker: canonicalTicker, reason: 'earnings_date_not_found' });
      continue;
    }

    const normalized = normalizeNasdaqEarningsRowWithReason({
      ticker: canonicalTicker,
      earningsDate: parsedDate
    }, {
      tickerUniverse,
      nowMs: startedAt
    });

    if (!normalized?.row) {
      diagnostics.failedExtractions += 1;
      diagnostics.parseFailures.push({ ticker: canonicalTicker, reason: normalized?.reason || 'normalization_failed', rawDate: parsedDate });
      continue;
    }

    diagnostics.successfulExtractions += 1;
    if (diagnostics.extractedDatesSample.length < 10) {
      diagnostics.extractedDatesSample.push({ ticker: canonicalTicker, date: parsedDate });
    }
    normalizedRows.push(normalized.row);
  }

  const dedupedNext = selectNextUpcomingEarningsPerTicker(normalizedRows, startedAt);
  diagnostics.rowsMatchedToPortfolio = normalizedRows.length;
  diagnostics.nextEarningsPerTickerCount = dedupedNext.rows.length;
  const matchedTickers = new Set(dedupedNext.nextEarningsTickers);
  diagnostics.matchedTickersSample = Array.from(matchedTickers).slice(0, 10);
  diagnostics.unmatchedPortfolioTickersSample = Array.from(tickerUniverse).filter((ticker) => !matchedTickers.has(ticker)).slice(0, 10);
  diagnostics.matchedTickersSampleCsv = toCsvPreview(diagnostics.matchedTickersSample);
  diagnostics.unmatchedPortfolioTickersSampleCsv = toCsvPreview(diagnostics.unmatchedPortfolioTickersSample);
  diagnostics.elapsedMs = Date.now() - startedAt;

  logger.info('[Earnings][Nasdaq] parse summary.', {
    tickersProcessed: diagnostics.tickersProcessed,
    successfulExtractions: diagnostics.successfulExtractions,
    failedExtractions: diagnostics.failedExtractions,
    nextEarningsPerTickerCount: diagnostics.nextEarningsPerTickerCount,
    extractedDatesSample: diagnostics.extractedDatesSample,
    matchedTickersSampleCsv: diagnostics.matchedTickersSampleCsv,
    unmatchedPortfolioTickersSampleCsv: diagnostics.unmatchedPortfolioTickersSampleCsv
  });
  logger.info('[Earnings][Nasdaq] fetch completed.', diagnostics);

  return { rows: dedupedNext.rows, diagnostics };
}

module.exports = {
  NASDAQ_EARNINGS_SOURCE_URL,
  NASDAQ_EARNINGS_TICKER_URL_BASE,
  buildDateRange,
  buildDateRangePlan,
  normalizeNasdaqEarningsRow,
  selectNextUpcomingEarningsPerTicker,
  extractEarningsDateFromApiPayload,
  fetchNasdaqEarningsEvents
};
