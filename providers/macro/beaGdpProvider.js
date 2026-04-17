const BEA_GDP_SOURCE_URL = 'https://www.bea.gov/data/gdp/gross-domestic-product';

// BEA GDP Advance Estimate release dates.
// Published approximately 4 weeks after each quarter ends, at 08:30 ET (13:30 UTC).
// Quarter ends: Q1=Mar 31, Q2=Jun 30, Q3=Sep 30, Q4=Dec 31.
const GDP_RELEASES = [
  { date: '2025-01-30', quarter: 4, year: 2024 },
  { date: '2025-04-30', quarter: 1, year: 2025 },
  { date: '2025-07-30', quarter: 2, year: 2025 },
  { date: '2025-10-30', quarter: 3, year: 2025 },
  { date: '2026-01-29', quarter: 4, year: 2025 },
  { date: '2026-04-29', quarter: 1, year: 2026 },
  { date: '2026-07-29', quarter: 2, year: 2026 },
  { date: '2026-10-28', quarter: 3, year: 2026 }
];

async function fetchBeaGdpEvents({ logger = console } = {}) {
  const startedAt = Date.now();
  logger.info('[Macro][GDP] build start.', { count: GDP_RELEASES.length });

  const rows = GDP_RELEASES.map(({ date, quarter, year }) => {
    // 08:30 ET = 13:30 UTC
    const scheduledAt = `${date}T13:30:00.000Z`;
    const quarterLabel = `Q${quarter} ${year}`;
    return {
      sourceType: 'macro',
      eventType: 'gdp',
      title: `GDP Advance Estimate (${quarterLabel})`,
      summary: `Bureau of Economic Analysis advance GDP estimate for ${quarterLabel}.`,
      body: null,
      country: 'US',
      region: 'US',
      importance: 90,
      scheduledAt,
      sourceName: 'Bureau of Economic Analysis',
      sourceUrl: BEA_GDP_SOURCE_URL,
      sourceExternalId: `bea:gdp:${date}`,
      dedupeKey: `macro|gdp|US||${scheduledAt}`,
      status: new Date(scheduledAt).getTime() > Date.now() ? 'upcoming' : 'completed',
      metadataJson: {
        provider: 'beaGdpProvider',
        quarter,
        year,
        quarterLabel,
        scheduledAtUtc: scheduledAt,
        sourceUrl: BEA_GDP_SOURCE_URL
      }
    };
  });

  logger.info('[Macro][GDP] build end.', { elapsedMs: Date.now() - startedAt, rows: rows.length });
  return rows;
}

module.exports = {
  BEA_GDP_SOURCE_URL,
  GDP_RELEASES,
  fetchBeaGdpEvents
};
