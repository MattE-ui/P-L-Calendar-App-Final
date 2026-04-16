const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTab, resolveInitialTab, mergeUniqueById, buildSectionList, buildUnifiedTimelineItems, sessionOrder } = require('../static/news.js');

test('normalizeTab restores expected default', () => {
  assert.equal(normalizeTab('calendar'), 'calendar');
  assert.equal(normalizeTab('invalid'), 'for-you');
});

test('resolveInitialTab restores query-param tab for direct load/refresh', () => {
  const restored = resolveInitialTab('?tab=calendar');
  assert.equal(restored.requestedTab, 'calendar');
  assert.equal(restored.activeTab, 'calendar');

  const fallback = resolveInitialTab('?tab=broken');
  assert.equal(fallback.activeTab, 'for-you');
});

test('mergeUniqueById preserves existing order and de-duplicates incoming cards', () => {
  const merged = mergeUniqueById(
    [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    [{ id: 'b', title: 'B2' }, { id: 'c', title: 'C' }]
  );
  assert.deepEqual(merged.map((item) => item.id), ['a', 'b', 'c']);
});

test('buildSectionList preserves backend section order per tab shell', () => {
  const response = {
    sections: [
      { summary: { key: 'later' }, items: [{ id: 'l' }] },
      { summary: { key: 'today' }, items: [{ id: 't' }] },
      { summary: { key: 'next7Days' }, items: [{ id: 'n' }] }
    ]
  };

  const ordered = buildSectionList('calendar', response);
  assert.deepEqual(ordered.map((item) => item.summary.key), ['today', 'next7Days', 'later']);
});

test('buildSectionList prioritizes unified upcomingEvents section for for-you tab', () => {
  const response = {
    sections: [
      { summary: { key: 'macroUpcoming' }, items: [{ id: 'm' }] },
      { summary: { key: 'upcomingEvents' }, items: [{ id: 'u' }] },
      { summary: { key: 'portfolioUpcomingEarnings' }, items: [{ id: 'e' }] }
    ]
  };
  const ordered = buildSectionList('for-you', response);
  assert.deepEqual(ordered.map((item) => item.summary.key), ['upcomingEvents', 'portfolioUpcomingEarnings', 'macroUpcoming']);
});

test('buildUnifiedTimelineItems de-duplicates presentational duplicates and sorts chronologically', () => {
  const merged = buildUnifiedTimelineItems([
    { id: '1', eventType: 'earnings', ticker: 'BE', title: 'BE earnings', eventDate: '2026-04-28T21:00:00.000Z', timeLabel: 'AH' },
    { id: '2', eventType: 'macro', title: 'CPI release', eventDate: '2026-04-28T12:30:00.000Z', timeLabel: '08:30 ET' },
    { id: '3', eventType: 'macro', title: 'CPI release', eventDate: '2026-04-28T12:30:00.000Z', timeLabel: '08:30 ET' }
  ]);
  assert.deepEqual(merged.map((item) => item.id), ['2', '1']);
});

test('sessionOrder establishes deterministic fallback ordering when event timestamps are coarse', () => {
  assert.equal(sessionOrder({ timeLabel: 'BMO' }), 10);
  assert.equal(sessionOrder({ timeLabel: 'AH' }), 40);
  assert.equal(sessionOrder({ timeLabel: 'time tbc' }), 50);
});
