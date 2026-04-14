const BLS_CPI_SCHEDULE_URL = 'https://www.bls.gov/schedule/news_release/cpi.htm';
const BLS_ICS_URL = 'https://www.bls.gov/schedule/news_release/bls.ics';

const MONTH_INDEX = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11
};

function toMonthIndex(raw) {
  return MONTH_INDEX[String(raw || '').trim().toLowerCase().replace(/\./g, '')] ?? null;
}

function parseReleaseDateTime(dateLabel, timeLabel) {
  const cleaned = String(dateLabel || '').replace(/,/g, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  const month = toMonthIndex(parts[0]);
  const day = Number(parts[1]);
  const year = Number(parts[2]);
  if (month === null || !Number.isFinite(day) || !Number.isFinite(year)) return null;

  const timeMatch = String(timeLabel || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!timeMatch) return null;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const meridiem = timeMatch[3].toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  // BLS release time is ET; use 13:30 UTC as a stable storage-safe baseline for 08:30 ET releases.
  const date = new Date(Date.UTC(year, month, day, hour + 5, minute, 0));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseCpiScheduleHtml(html = '', logger = console) {
  const clean = String(html).replace(/\r/g, '');
  const rows = [];
  let skippedRows = 0;

  const rowRegex = /([A-Za-z]+\s+\d{4})\s+([A-Za-z]{3,4}\.?\s+\d{1,2},\s+\d{4})\s+(\d{2}:\d{2}\s*(?:AM|PM))/g;
  let match = rowRegex.exec(clean);
  while (match) {
    const referenceMonth = match[1];
    const releaseDate = match[2];
    const releaseTime = match[3];
    const scheduledAt = parseReleaseDateTime(releaseDate, releaseTime);
    if (!scheduledAt) {
      skippedRows += 1;
      logger.warn('[Macro][CPI] skipped row due to invalid datetime.', { referenceMonth, releaseDate, releaseTime });
      match = rowRegex.exec(clean);
      continue;
    }
    rows.push({
      sourceType: 'macro',
      eventType: 'cpi',
      title: `US CPI Release (${referenceMonth})`,
      summary: `BLS Consumer Price Index release for ${referenceMonth}.`,
      body: null,
      country: 'US',
      region: 'US',
      importance: 'high',
      scheduledAt,
      sourceName: 'BLS',
      sourceUrl: BLS_CPI_SCHEDULE_URL,
      sourceExternalId: `bls-cpi:${referenceMonth.toLowerCase().replace(/\s+/g, '-')}:${scheduledAt.slice(0, 10)}`,
      status: new Date(scheduledAt).getTime() > Date.now() ? 'upcoming' : 'completed',
      metadataJson: {
        provider: 'blsCpiProvider',
        referenceMonth,
        releaseDateLabel: releaseDate,
        releaseTimeLabel: releaseTime,
        scheduledAtUtc: scheduledAt,
        sourceUrl: BLS_CPI_SCHEDULE_URL
      }
    });
    match = rowRegex.exec(clean);
  }

  logger.info('[Macro][CPI] parse completed.', { parsedRows: rows.length, skippedRows });
  return { rows, parsedRows: rows.length, skippedRows };
}

async function fetchBlsCpiEvents({ fetcher = global.fetch, logger = console } = {}) {
  const startedAt = Date.now();
  logger.info('[Macro][CPI] fetch start.', { sourceUrl: BLS_CPI_SCHEDULE_URL });
  const response = await fetcher(BLS_CPI_SCHEDULE_URL, { headers: { 'user-agent': 'pl-calendar-macro-ingest/1.0' } });
  if (!response?.ok) {
    throw new Error(`BLS CPI fetch failed with status ${response?.status || 'unknown'}`);
  }
  const html = await response.text();
  const { rows, parsedRows, skippedRows } = parseCpiScheduleHtml(html, logger);
  logger.info('[Macro][CPI] fetch end.', {
    elapsedMs: Date.now() - startedAt,
    fetchedBytes: html.length,
    parsedRows,
    skippedRows,
    sourceIcsUrl: BLS_ICS_URL
  });
  return rows;
}

module.exports = {
  BLS_CPI_SCHEDULE_URL,
  BLS_ICS_URL,
  parseCpiScheduleHtml,
  fetchBlsCpiEvents
};
