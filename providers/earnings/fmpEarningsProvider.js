const FMP_EARNINGS_CALENDAR_URL = 'https://financialmodelingprep.com/api/v3/earning_calendar';

function normalizeTicker(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.\-_]/g, '');
}

function normalizeDateOnly(raw) {
  const value = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function parseFmpDate(dateOnly, timeHint = '') {
  const base = normalizeDateOnly(dateOnly);
  if (!base) return null;
  const hint = String(timeHint || '').trim().toLowerCase();
  if (hint === 'bmo') return `${base}T12:00:00.000Z`;
  if (hint === 'amc') return `${base}T21:00:00.000Z`;
  if (hint === 'dmh') return `${base}T16:00:00.000Z`;
  return `${base}T16:00:00.000Z`;
}

function parseFmpPublishedAt(raw) {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function buildFmpSourceExternalId(row, ticker, scheduledAtIso) {
  const eventDate = normalizeDateOnly(row?.date) || (scheduledAtIso ? scheduledAtIso.slice(0, 10) : 'unknown');
  const timeHint = String(row?.time || '').trim().toLowerCase() || 'unspecified';
  return `fmp:earnings:${ticker}:${eventDate}:${timeHint}`;
}

function normalizeFmpEarningsRow(row, { tickerUniverse = null } = {}) {
  const ticker = normalizeTicker(row?.symbol);
  if (!ticker) return null;
  if (tickerUniverse && tickerUniverse.size && !tickerUniverse.has(ticker)) return null;

  const scheduledAt = parseFmpDate(row?.date, row?.time);
  if (!scheduledAt) return null;

  const sourceExternalId = buildFmpSourceExternalId(row, ticker, scheduledAt);
  const sourceUrl = `https://financialmodelingprep.com/stable/earnings-calendar?symbol=${encodeURIComponent(ticker)}`;
  const nowMs = Date.now();
  const scheduledMs = new Date(scheduledAt).getTime();

  return {
    sourceType: 'earnings',
    eventType: 'earnings',
    title: `${ticker} Earnings (${scheduledAt.slice(0, 10)})`,
    summary: `Scheduled earnings release for ${ticker}.`,
    body: null,
    ticker,
    canonicalTicker: ticker,
    country: row?.country ? String(row.country).trim().toUpperCase() : null,
    region: row?.exchangeShortName ? String(row.exchangeShortName).trim().toUpperCase() : null,
    importance: 70,
    scheduledAt,
    publishedAt: parseFmpPublishedAt(row?.updatedFromDate || row?.updatedAt || row?.lastUpdated),
    sourceName: 'Financial Modeling Prep',
    sourceUrl,
    sourceExternalId,
    status: scheduledMs > nowMs ? 'upcoming' : 'completed',
    metadataJson: {
      provider: 'fmpEarningsProvider',
      providerEventDate: normalizeDateOnly(row?.date),
      providerTimeHint: String(row?.time || '').trim() || null,
      eps: row?.eps ?? null,
      epsEstimated: row?.epsEstimated ?? row?.epsestimate ?? null,
      revenue: row?.revenue ?? null,
      revenueEstimated: row?.revenueEstimated ?? row?.revenueestimate ?? null,
      fiscalDateEnding: row?.fiscalDateEnding || null,
      updatedFromDate: row?.updatedFromDate || null,
      raw: row
    }
  };
}

async function fetchFmpEarningsEvents({
  tickers = [],
  from,
  to,
  fetcher = global.fetch,
  logger = console,
  apiKey = process.env.FMP_API_KEY,
  baseUrl = FMP_EARNINGS_CALENDAR_URL
} = {}) {
  const startedAt = Date.now();
  const tickerUniverse = new Set((Array.isArray(tickers) ? tickers : []).map((item) => normalizeTicker(item)).filter(Boolean));

  const fromDate = normalizeDateOnly(from) || new Date(Date.now() - (2 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  const toDate = normalizeDateOnly(to) || new Date(Date.now() + (45 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);

  const url = new URL(baseUrl);
  url.searchParams.set('from', fromDate);
  url.searchParams.set('to', toDate);
  if (apiKey) url.searchParams.set('apikey', apiKey);

  logger.info('[Earnings][FMP] fetch start.', {
    from: fromDate,
    to: toDate,
    tickersRequested: tickerUniverse.size,
    sourceUrl: baseUrl
  });

  const response = await fetcher(url.toString(), {
    headers: { 'user-agent': 'pl-calendar-earnings-ingest/1.0' }
  });
  if (!response?.ok) {
    throw new Error(`FMP earnings fetch failed with status ${response?.status || 'unknown'}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : [];
  let parsedRows = 0;
  let skippedRows = 0;
  const normalized = [];

  for (const row of rows) {
    const next = normalizeFmpEarningsRow(row, { tickerUniverse });
    if (!next) {
      skippedRows += 1;
      continue;
    }
    parsedRows += 1;
    normalized.push(next);
  }

  logger.info('[Earnings][FMP] fetch end.', {
    elapsedMs: Date.now() - startedAt,
    rowsFetched: rows.length,
    rowsParsed: parsedRows,
    rowsSkipped: skippedRows
  });

  return normalized;
}

module.exports = {
  FMP_EARNINGS_CALENDAR_URL,
  normalizeFmpEarningsRow,
  fetchFmpEarningsEvents
};
