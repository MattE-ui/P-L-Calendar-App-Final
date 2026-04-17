const BLS_NFP_SOURCE_URL = 'https://www.bls.gov/schedule/news_release/empsit.htm';

// BLS Employment Situation (Non-Farm Payrolls) release dates.
// Released the first Friday of each month at 08:30 ET (13:30 UTC).
// Holiday exceptions: when the first Friday falls on a federal holiday,
// BLS releases on the preceding Thursday.
const NFP_RELEASE_DATES = [
  // 2025
  '2025-01-10', // Dec 2024 data
  '2025-02-07', // Jan 2025 data
  '2025-03-07', // Feb 2025 data
  '2025-04-04', // Mar 2025 data
  '2025-05-02', // Apr 2025 data
  '2025-06-06', // May 2025 data
  '2025-07-03', // Jun 2025 data — moved from Jul 4 (Independence Day)
  '2025-08-01', // Jul 2025 data
  '2025-09-05', // Aug 2025 data
  '2025-10-03', // Sep 2025 data
  '2025-11-07', // Oct 2025 data
  '2025-12-05', // Nov 2025 data
  // 2026
  '2026-01-09', // Dec 2025 data — Jan 2 too close to New Year holiday
  '2026-02-06', // Jan 2026 data
  '2026-03-06', // Feb 2026 data
  '2026-04-03', // Mar 2026 data
  '2026-05-01', // Apr 2026 data
  '2026-06-05', // May 2026 data
  '2026-07-03', // Jun 2026 data
  '2026-08-07', // Jul 2026 data
  '2026-09-04', // Aug 2026 data
  '2026-10-02', // Sep 2026 data
  '2026-11-06', // Oct 2026 data
  '2026-12-04'  // Nov 2026 data
];

// Reference month labels aligned to the release schedule (data lags by one month)
const NFP_REFERENCE_MONTHS = [
  'December 2024', 'January 2025', 'February 2025', 'March 2025',
  'April 2025', 'May 2025', 'June 2025', 'July 2025',
  'August 2025', 'September 2025', 'October 2025', 'November 2025',
  'December 2025', 'January 2026', 'February 2026', 'March 2026',
  'April 2026', 'May 2026', 'June 2026', 'July 2026',
  'August 2026', 'September 2026', 'October 2026', 'November 2026'
];

async function fetchBlsNfpEvents({ logger = console } = {}) {
  const startedAt = Date.now();
  logger.info('[Macro][NFP] build start.', { count: NFP_RELEASE_DATES.length });

  const rows = NFP_RELEASE_DATES.map((dateStr, index) => {
    // 08:30 ET = 13:30 UTC
    const scheduledAt = `${dateStr}T13:30:00.000Z`;
    const referenceMonth = NFP_REFERENCE_MONTHS[index] || dateStr;
    return {
      sourceType: 'macro',
      eventType: 'nfp',
      title: `Non-Farm Payrolls (NFP) — ${referenceMonth}`,
      summary: `Bureau of Labor Statistics Employment Situation release for ${referenceMonth}.`,
      body: null,
      country: 'US',
      region: 'US',
      importance: 92,
      scheduledAt,
      sourceName: 'Bureau of Labor Statistics',
      sourceUrl: BLS_NFP_SOURCE_URL,
      sourceExternalId: `bls:nfp:${dateStr}`,
      dedupeKey: `macro|nfp|US||${scheduledAt}`,
      status: new Date(scheduledAt).getTime() > Date.now() ? 'upcoming' : 'completed',
      metadataJson: {
        provider: 'blsNfpProvider',
        referenceMonth,
        scheduledAtUtc: scheduledAt,
        sourceUrl: BLS_NFP_SOURCE_URL
      }
    };
  });

  logger.info('[Macro][NFP] build end.', { elapsedMs: Date.now() - startedAt, rows: rows.length });
  return rows;
}

module.exports = {
  BLS_NFP_SOURCE_URL,
  NFP_RELEASE_DATES,
  fetchBlsNfpEvents
};
