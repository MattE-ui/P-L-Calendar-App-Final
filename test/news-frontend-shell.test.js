const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTab, resolveInitialTab, mergeUniqueById, buildSectionList } = require('../static/news.js');

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
