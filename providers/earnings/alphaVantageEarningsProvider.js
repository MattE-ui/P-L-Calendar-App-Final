const ALPHA_VANTAGE_EARNINGS_CALENDAR_URL = 'https://www.alphavantage.co/query';
const DEFAULT_HORIZON = '3month';
const VALID_HORIZONS = new Set(['3month', '6month', '12month']);
const DEFAULT_MAX_SYMBOLS_PER_RUN = 5;

function normalizeTicker(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.\-_]/g, '');
}

function normalizeDateOnly(raw) {
  const value = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function parseScheduledAt(rawReportDate) {
  const dateOnly = normalizeDateOnly(rawReportDate);
  if (!dateOnly) return null;
  return `${dateOnly}T16:00:00.000Z`;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === ',') {
      values.push(current);
      current = '';
    } else if (char === '"') {
      quoted = true;
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function parseAlphaVantageCsv(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map((h) => String(h || '').trim());
  if (!headers.length) return [];

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] != null ? String(values[index]).trim() : '';
    });
    return row;
  });
}

function deriveExternalId(row, ticker, scheduledAt) {
  const reportDate = normalizeDateOnly(row?.reportDate) || (scheduledAt ? scheduledAt.slice(0, 10) : 'unknown');
  const fiscalDateEnding = normalizeDateOnly(row?.fiscalDateEnding) || 'unknown';
  return `alpha-vantage:earnings:${ticker}:${reportDate}:${fiscalDateEnding}`;
}

function normalizeAlphaVantageEarningsRow(row, { tickerUniverse = null } = {}) {
  const ticker = normalizeTicker(row?.symbol);
  if (!ticker) return null;
  if (tickerUniverse && tickerUniverse.size && !tickerUniverse.has(ticker)) return null;

  const scheduledAt = parseScheduledAt(row?.reportDate);
  if (!scheduledAt) return null;

  const scheduledMs = new Date(scheduledAt).getTime();
  const nowMs = Date.now();
  const companyName = String(row?.name || '').trim();

  return {
    sourceType: 'earnings',
    eventType: 'earnings',
    ticker,
    canonicalTicker: ticker,
    title: `${ticker} Earnings (${scheduledAt.slice(0, 10)})`,
    summary: companyName
      ? `Scheduled earnings release for ${ticker} (${companyName}).`
      : `Scheduled earnings release for ${ticker}.`,
    body: null,
    country: null,
    region: null,
    importance: 70,
    scheduledAt,
    publishedAt: null,
    sourceName: 'Alpha Vantage',
    sourceUrl: `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&symbol=${encodeURIComponent(ticker)}`,
    sourceExternalId: deriveExternalId(row, ticker, scheduledAt),
    status: scheduledMs > nowMs ? 'upcoming' : 'completed',
    metadataJson: {
      provider: 'alphaVantageEarningsProvider',
      providerReportDate: normalizeDateOnly(row?.reportDate),
      fiscalDateEnding: normalizeDateOnly(row?.fiscalDateEnding),
      estimate: row?.estimate != null && row.estimate !== '' ? row.estimate : null,
      currency: row?.currency ? String(row.currency).trim().toUpperCase() : null,
      raw: row
    }
  };
}

function clampMaxSymbolsPerRun(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_SYMBOLS_PER_RUN;
  return Math.min(n, 25);
}

function buildFailureSnippet(bodyText) {
  return String(bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 240) || null;
}

function detectThrottleHint(status, snippet) {
  if (status === 429) return 'http_429';
  const lower = String(snippet || '').toLowerCase();
  if (!lower) return null;
  if (lower.includes('frequency') || lower.includes('rate limit')) return 'provider_rate_limit_message';
  if (lower.includes('thank you for using alpha vantage')) return 'alpha_vantage_throttle_notice';
  return null;
}

async function fetchAlphaVantageEarningsEvents({
  tickers = [],
  horizon = process.env.ALPHA_VANTAGE_EARNINGS_HORIZON || DEFAULT_HORIZON,
  fetcher = global.fetch,
  logger = console,
  apiKey = process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY,
  baseUrl = ALPHA_VANTAGE_EARNINGS_CALENDAR_URL,
  maxSymbolsPerRun = process.env.ALPHA_VANTAGE_MAX_SYMBOLS_PER_RUN
} = {}) {
  const startedAt = Date.now();
  const normalizedHorizon = VALID_HORIZONS.has(String(horizon || '').trim()) ? String(horizon).trim() : DEFAULT_HORIZON;
  const tickerUniverse = Array.from(new Set((Array.isArray(tickers) ? tickers : []).map(normalizeTicker).filter(Boolean))).sort();
  const symbolLimit = clampMaxSymbolsPerRun(maxSymbolsPerRun);
  const symbolsRequested = tickerUniverse.slice(0, symbolLimit);
  const symbolsDeferred = tickerUniverse.slice(symbolLimit);

  const diagnostics = {
    provider: 'alphaVantage',
    apiKeyPresent: Boolean(apiKey),
    horizon: normalizedHorizon,
    tickersRequested: symbolsRequested,
    tickersDeferred: symbolsDeferred,
    rowsReturned: 0,
    parsedRows: 0,
    skippedRows: 0,
    responseStatus: null,
    failureSnippet: null,
    throttleHint: null,
    callsAttempted: 0,
    callsCompleted: 0,
    elapsedMs: 0
  };

  if (!apiKey) {
    const error = new Error('Missing ALPHA_VANTAGE_API_KEY for earnings ingestion provider.');
    error.diagnostics = diagnostics;
    throw error;
  }

  if (!symbolsRequested.length) {
    diagnostics.elapsedMs = Date.now() - startedAt;
    return { rows: [], diagnostics };
  }

  if (symbolsDeferred.length) {
    logger.info('[Earnings][AlphaVantage] deferred ticker batch to respect free-tier constraints.', {
      requested: tickerUniverse.length,
      processed: symbolsRequested.length,
      deferred: symbolsDeferred.length,
      maxSymbolsPerRun: symbolLimit
    });
  }

  const rawRows = [];
  for (const symbol of symbolsRequested) {
    diagnostics.callsAttempted += 1;

    const url = new URL(baseUrl);
    url.searchParams.set('function', 'EARNINGS_CALENDAR');
    url.searchParams.set('horizon', normalizedHorizon);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('apikey', apiKey);

    const response = await fetcher(url.toString(), {
      headers: { 'user-agent': 'pl-calendar-earnings-ingest/1.0' }
    });

    diagnostics.responseStatus = response?.status ?? null;
    const bodyText = await response.text();

    if (!response?.ok) {
      diagnostics.failureSnippet = buildFailureSnippet(bodyText);
      diagnostics.throttleHint = detectThrottleHint(response?.status, diagnostics.failureSnippet);
      diagnostics.elapsedMs = Date.now() - startedAt;
      const error = new Error(`Alpha Vantage earnings fetch failed with status ${response?.status || 'unknown'}.`);
      error.diagnostics = diagnostics;
      throw error;
    }

    const snippet = buildFailureSnippet(bodyText);
    const parsedRows = parseAlphaVantageCsv(bodyText);
    if (!parsedRows.length && snippet) {
      diagnostics.failureSnippet = snippet;
      diagnostics.throttleHint = detectThrottleHint(response?.status, snippet);
      if (diagnostics.throttleHint) {
        diagnostics.elapsedMs = Date.now() - startedAt;
        const error = new Error('Alpha Vantage earnings fetch appears throttled.');
        error.diagnostics = diagnostics;
        throw error;
      }
    }

    diagnostics.callsCompleted += 1;
    rawRows.push(...parsedRows);
  }

  diagnostics.rowsReturned = rawRows.length;

  const tickerUniverseSet = new Set(symbolsRequested);
  const normalizedRows = [];
  for (const row of rawRows) {
    const normalized = normalizeAlphaVantageEarningsRow(row, { tickerUniverse: tickerUniverseSet });
    if (!normalized) {
      diagnostics.skippedRows += 1;
      continue;
    }
    diagnostics.parsedRows += 1;
    normalizedRows.push(normalized);
  }

  diagnostics.elapsedMs = Date.now() - startedAt;

  logger.info('[Earnings][AlphaVantage] fetch completed.', diagnostics);
  return { rows: normalizedRows, diagnostics };
}

module.exports = {
  ALPHA_VANTAGE_EARNINGS_CALENDAR_URL,
  parseAlphaVantageCsv,
  normalizeAlphaVantageEarningsRow,
  fetchAlphaVantageEarningsEvents
};
