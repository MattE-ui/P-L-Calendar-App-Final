const FOMC_CALENDAR_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';

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

function htmlToText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeNormalizeMonthLabel(raw = '') {
  const token = String(raw).trim().toLowerCase().replace(/\./g, '');
  return MONTH_INDEX[token] ?? null;
}

function parseMeetingDateLine(monthLabel, dayExpression, year) {
  const monthTokens = String(monthLabel || '').split('/').map((item) => item.trim()).filter(Boolean);
  if (!monthTokens.length) return null;

  const cleanedDay = String(dayExpression || '').trim().replace(/\*/g, '');
  const dayMatch = cleanedDay.match(/^(\d{1,2})(?:\s*-\s*(\d{1,2}))?(?:\s*\(.*\))?$/);
  if (!dayMatch) return null;

  const startDay = Number(dayMatch[1]);
  const endDay = dayMatch[2] ? Number(dayMatch[2]) : startDay;
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay)) return null;

  let targetYear = Number(year);
  let targetMonth = safeNormalizeMonthLabel(monthTokens[0]);
  if (targetMonth === null) return null;

  if (endDay < startDay && monthTokens.length > 1) {
    const secondMonth = safeNormalizeMonthLabel(monthTokens[1]);
    if (secondMonth === null) return null;
    if (secondMonth < targetMonth) targetYear += 1;
    targetMonth = secondMonth;
  }

  const date = new Date(Date.UTC(targetYear, targetMonth, endDay, 19, 0, 0));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseFedFomcCalendarHtml(html = '', logger = console) {
  const lines = String(html)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => htmlToText(line))
    .filter(Boolean);

  const rows = [];
  let skippedRows = 0;
  let currentYear = null;
  let currentMonth = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const yearMatch = line.match(/^(\d{4})\s+FOMC\s+Meetings/i);
    if (yearMatch) {
      currentYear = Number(yearMatch[1]);
      currentMonth = null;
      continue;
    }
    if (!currentYear) continue;

    const monthOnly = line.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\/(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?))?$/i);
    if (monthOnly) {
      currentMonth = line;
      continue;
    }

    const dayRange = line.match(/^(\d{1,2}\s*(?:-\s*\d{1,2})?(?:\*|\s*\(notation vote\))?)$/i);
    if (dayRange && currentMonth) {
      const scheduledAt = parseMeetingDateLine(currentMonth, dayRange[1], currentYear);
      if (!scheduledAt) {
        skippedRows += 1;
        logger.warn('[Macro][FOMC] skipped row due to invalid date parsing.', {
          year: currentYear,
          month: currentMonth,
          dayExpression: dayRange[1]
        });
        continue;
      }
      const referenceTag = `${currentYear}-${String(rows.length + 1).padStart(2, '0')}`;
      rows.push({
        sourceType: 'macro',
        eventType: 'fomc',
        title: `FOMC Meeting (${currentMonth} ${dayRange[1].replace(/\*/g, '').trim()}, ${currentYear})`,
        summary: `Federal Open Market Committee scheduled meeting ending ${scheduledAt.slice(0, 10)}.`,
        body: null,
        country: 'US',
        region: 'US',
        importance: 'high',
        scheduledAt,
        sourceName: 'Federal Reserve',
        sourceUrl: FOMC_CALENDAR_URL,
        sourceExternalId: `fomc:${currentYear}:${currentMonth.toLowerCase().replace(/\s+/g, '-')}:${dayRange[1].replace(/\s+/g, '')}`,
        status: new Date(scheduledAt).getTime() > Date.now() ? 'upcoming' : 'completed',
        metadataJson: {
          provider: 'fedFomcProvider',
          year: currentYear,
          monthLabel: currentMonth,
          dayExpression: dayRange[1],
          referenceTag,
          scheduledAtUtc: scheduledAt,
          sourceUrl: FOMC_CALENDAR_URL
        }
      });
    }
  }

  logger.info('[Macro][FOMC] parse completed.', {
    parsedRows: rows.length,
    skippedRows
  });

  return { rows, parsedRows: rows.length, skippedRows };
}

async function fetchFedFomcEvents({ fetcher = global.fetch, logger = console } = {}) {
  const startedAt = Date.now();
  logger.info('[Macro][FOMC] fetch start.', { sourceUrl: FOMC_CALENDAR_URL });
  const response = await fetcher(FOMC_CALENDAR_URL, { headers: { 'user-agent': 'pl-calendar-macro-ingest/1.0' } });
  if (!response?.ok) {
    throw new Error(`FOMC fetch failed with status ${response?.status || 'unknown'}`);
  }
  const html = await response.text();
  const { rows, parsedRows, skippedRows } = parseFedFomcCalendarHtml(html, logger);
  logger.info('[Macro][FOMC] fetch end.', {
    elapsedMs: Date.now() - startedAt,
    fetchedBytes: html.length,
    parsedRows,
    skippedRows
  });
  return rows;
}

module.exports = {
  FOMC_CALENDAR_URL,
  parseFedFomcCalendarHtml,
  fetchFedFomcEvents
};
