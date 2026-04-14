const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEventDedupeKey } = require('../services/news/newsEventService');
const { parseFedFomcCalendarHtml } = require('../providers/macro/fedFomcProvider');
const { parseCpiScheduleHtml } = require('../providers/macro/blsCpiProvider');
const { runMacroIngestion } = require('../services/news/macroIngestionService');

function createLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

test('macro dedupe key is stable across source title/summary changes', () => {
  const base = {
    sourceType: 'macro',
    eventType: 'fomc',
    country: 'US',
    region: 'US',
    scheduledAt: '2026-06-17T19:00:00.000Z',
    title: 'FOMC meeting A',
    summary: 'A'
  };
  const changed = {
    ...base,
    title: 'Federal Open Market Committee Meeting',
    summary: 'Different provider formatting'
  };
  assert.equal(buildEventDedupeKey(base), buildEventDedupeKey(changed));
});

test('FOMC parser normalizes meeting rows', () => {
  const html = `
    <h4>2026 FOMC Meetings</h4>
    <p>January</p>
    <p>27-28</p>
    <p>March</p>
    <p>17-18*</p>
    <p>* Meeting associated with a Summary of Economic Projections.</p>
  `;
  const parsed = parseFedFomcCalendarHtml(html, createLogger());
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].eventType, 'fomc');
  assert.equal(parsed.rows[0].country, 'US');
  assert.match(parsed.rows[0].scheduledAt, /^2026-01-28T/);
});

test('CPI parser normalizes schedule rows', () => {
  const html = `
    <section>
      Reference Month Release Date Release Time
      January 2026 Feb. 13, 2026 08:30 AM
      February 2026 Mar. 11, 2026 08:30 AM
    </section>
  `;
  const parsed = parseCpiScheduleHtml(html, createLogger());
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].eventType, 'cpi');
  assert.equal(parsed.rows[0].sourceName, 'BLS');
  assert.match(parsed.rows[0].scheduledAt, /^2026-02-13T13:30:00\.000Z$/);
});

test('macro ingestion succeeds when one provider fails', async () => {
  const inserted = [];
  const diagnostics = await runMacroIngestion({
    logger: createLogger(),
    newsEventService: {
      listUpcomingEvents: () => [],
      upsertManyEvents: (rows) => {
        inserted.push(...rows);
        return rows.map((row, index) => ({ ...row, id: `id-${index}`, dedupeKey: `k-${index}` }));
      }
    },
    providers: [
      {
        name: 'fomc',
        fetch: async () => [{ sourceType: 'macro', eventType: 'fomc', scheduledAt: '2026-06-17T19:00:00.000Z' }]
      },
      {
        name: 'cpi',
        fetch: async () => { throw new Error('provider down'); }
      }
    ]
  });

  assert.equal(diagnostics.success, true);
  assert.equal(inserted.length, 1);
  assert.equal(diagnostics.providers.length, 2);
  assert.equal(diagnostics.providers[1].success, false);
});
