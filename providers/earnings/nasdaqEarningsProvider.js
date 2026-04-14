const NASDAQ_EARNINGS_SOURCE_URL = 'https://www.nasdaq.com/market-activity/earnings';
const NASDAQ_EARNINGS_TICKER_URL_BASE = 'https://www.nasdaq.com/market-activity/stocks';

const MONTH_NAME_DATE_RE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/i;

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

function decodeHtmlEntities(raw = '') {
  return String(raw)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractFirstMonthNameDate(raw = '') {
  const match = String(raw).match(MONTH_NAME_DATE_RE);
  return match ? match[0] : null;
}

function extractEarningsAnnouncementDateFromHtml(html = '') {
  const rawHtml = String(html || '');
  if (!rawHtml.trim()) return null;

  const decoded = decodeHtmlEntities(rawHtml);
  const compactHtml = decoded.replace(/\s+/g, ' ');

  const labeledBlockPattern = /earnings\s+announcement\*?[^A-Za-z0-9]{0,80}(.{0,220})/ig;
  let labeledBlockMatch = labeledBlockPattern.exec(compactHtml);
  while (labeledBlockMatch) {
    const candidate = extractFirstMonthNameDate(labeledBlockMatch[1] || '');
    if (candidate) return candidate;
    labeledBlockMatch = labeledBlockPattern.exec(compactHtml);
  }

  const textOnly = compactHtml
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const labelMatch = /earnings\s+announcement\*?/i.exec(textOnly);
  if (labelMatch && Number.isFinite(labelMatch.index)) {
    const windowStart = Math.max(0, labelMatch.index);
    const windowEnd = Math.min(textOnly.length, labelMatch.index + 260);
    const localWindow = textOnly.slice(windowStart, windowEnd);
    const localDate = extractFirstMonthNameDate(localWindow);
    if (localDate) return localDate;
  }

  return null;
}

function buildTickerEarningsUrl(baseUrl, ticker) {
  const safeTicker = encodeURIComponent(String(ticker || '').trim().toLowerCase());
  return `${String(baseUrl).replace(/\/$/, '')}/${safeTicker}/earnings`;
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

  const reportDate = parseFlexibleDateOnly(row?.reportDate || row?.earningsAnnouncementDate || row?.date);
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
    strategyUsed: 'per_ticker_page_scrape',
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
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

    let html = '';
    try {
      html = typeof response?.text === 'function' ? await response.text() : '';
    } catch (error) {
      diagnostics.failedExtractions += 1;
      diagnostics.fetchFailures.push({ ticker: canonicalTicker, reason: 'body_read_failed' });
      continue;
    }

    const earningsAnnouncementDateText = extractEarningsAnnouncementDateFromHtml(html);
    if (!earningsAnnouncementDateText) {
      diagnostics.failedExtractions += 1;
      diagnostics.parseFailures.push({ ticker: canonicalTicker, reason: 'earnings_announcement_date_not_found' });
      continue;
    }

    const parsedDate = parseFlexibleDateOnly(earningsAnnouncementDateText);
    if (!parsedDate) {
      diagnostics.failedExtractions += 1;
      diagnostics.parseFailures.push({ ticker: canonicalTicker, reason: 'earnings_announcement_date_invalid', rawDate: earningsAnnouncementDateText });
      continue;
    }

    const normalized = normalizeNasdaqEarningsRowWithReason({
      ticker: canonicalTicker,
      earningsAnnouncementDate: parsedDate
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
  extractEarningsAnnouncementDateFromHtml,
  fetchNasdaqEarningsEvents
};
