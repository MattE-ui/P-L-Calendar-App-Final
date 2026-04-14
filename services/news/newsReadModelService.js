const { isScheduledSignal, isPublishedSignal } = require('./newsEventService');
const { isEventRelevantToUser } = require('./ownedTickerUniverseService');

const READ_MODEL_MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

function normalizeIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), READ_MODEL_MAX_LIMIT);
}

function normalizeFilters(filters = {}) {
  return {
    sourceType: typeof filters.sourceType === 'string' && filters.sourceType.trim() ? filters.sourceType.trim() : null,
    eventType: typeof filters.eventType === 'string' && filters.eventType.trim() ? filters.eventType.trim() : null,
    from: normalizeIsoDate(filters.from),
    to: normalizeIsoDate(filters.to),
    importanceMin: filters.importance !== undefined && filters.importance !== null && filters.importance !== ''
      ? Number(filters.importance)
      : null,
    includePast: String(filters.includePast || '').toLowerCase() === 'true',
    portfolioOnly: String(filters.portfolioOnly || '').toLowerCase() === 'true',
    highImportanceOnly: String(filters.highImportanceOnly || '').toLowerCase() === 'true'
  };
}

function parseCursor(raw, mode) {
  if (typeof raw !== 'string' || !raw.trim()) return { offset: 0 };
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (decoded?.mode !== mode) return { offset: 0 };
    if (!Number.isFinite(decoded?.offset) || decoded.offset < 0) return { offset: 0 };
    return { offset: Math.floor(decoded.offset) };
  } catch (_error) {
    return { offset: 0 };
  }
}

function encodeCursor(mode, offset) {
  return Buffer.from(JSON.stringify({ mode, offset })).toString('base64');
}

function urgencyFromScheduledAt(scheduledAt, nowMs) {
  if (!scheduledAt) return 'none';
  const ts = Date.parse(scheduledAt);
  if (!Number.isFinite(ts)) return 'none';
  const diffMs = ts - nowMs;
  if (diffMs < 0) return 'past';
  if (diffMs <= 24 * 60 * 60 * 1000) return 'today';
  if (diffMs <= 3 * 24 * 60 * 60 * 1000) return 'soon';
  return 'upcoming';
}

function formatTimeLabel(event, nowMs) {
  const scheduled = normalizeIsoDate(event.scheduledAt);
  const published = normalizeIsoDate(event.publishedAt);
  const candidate = scheduled || published;
  if (!candidate) return 'No time set';
  const ts = Date.parse(candidate);
  if (!Number.isFinite(ts)) return 'No time set';
  const diffMs = ts - nowMs;
  if (Math.abs(diffMs) < 60 * 60 * 1000) return 'Within 1 hour';
  if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) return 'Within 24 hours';
  return candidate.replace('.000Z', 'Z');
}

function deriveBadge(event, { isPortfolioRelevant, isHighImportance, urgencyClass }) {
  if (event.eventType === 'earnings' && isPortfolioRelevant) return { badgeLabel: 'Portfolio Earnings', badgeTone: 'highlight' };
  if (event.sourceType === 'macro' && isHighImportance) return { badgeLabel: 'High Impact Macro', badgeTone: 'critical' };
  if (urgencyClass === 'today') return { badgeLabel: 'Today', badgeTone: 'attention' };
  if (urgencyClass === 'soon') return { badgeLabel: 'Soon', badgeTone: 'info' };
  return { badgeLabel: 'Scheduled', badgeTone: 'neutral' };
}

function deriveRelevanceClass(event, { isPortfolioRelevant }) {
  if (isPortfolioRelevant) return 'portfolio';
  if (event.sourceType === 'macro') return 'macro';
  return 'neutral';
}

function calculateSortTimestamp(event) {
  return normalizeIsoDate(event.scheduledAt)
    || normalizeIsoDate(event.publishedAt)
    || normalizeIsoDate(event.updatedAt)
    || normalizeIsoDate(event.createdAt)
    || '1970-01-01T00:00:00.000Z';
}

function buildNewsEventCardModel(event, context = {}) {
  const nowIso = normalizeIsoDate(context.now) || new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const userId = context.userId || null;
  const userTickers = context.userTickers instanceof Set ? context.userTickers : new Set();
  const eventTicker = String(event.canonicalTicker || event.ticker || '').toUpperCase();
  const mappedRelevance = Array.isArray(event?.metadataJson?.relevanceUserIds) && userId
    ? isEventRelevantToUser(event, userId)
    : false;
  const isPortfolioRelevant = Boolean(eventTicker && userTickers.has(eventTicker)) || mappedRelevance;
  const urgencyClass = urgencyFromScheduledAt(event.scheduledAt, nowMs);
  const isHighImportance = Number(event.importance || 0) >= 80;
  const relevanceClass = deriveRelevanceClass(event, { isPortfolioRelevant });
  const { badgeLabel, badgeTone } = deriveBadge(event, { isPortfolioRelevant, isHighImportance, urgencyClass });
  const sortTimestamp = calculateSortTimestamp(event);

  return {
    id: event.id,
    sourceType: event.sourceType,
    eventType: event.eventType,
    title: event.title,
    summary: event.summary,
    ticker: event.ticker,
    canonicalTicker: event.canonicalTicker,
    country: event.country,
    region: event.region,
    importance: event.importance,
    scheduledAt: event.scheduledAt,
    publishedAt: event.publishedAt,
    sourceName: event.sourceName,
    sourceUrl: event.sourceUrl,
    status: event.status,
    badgeLabel,
    badgeTone,
    relevanceClass,
    urgencyClass,
    timeLabel: formatTimeLabel(event, nowMs),
    isPortfolioRelevant,
    isHighImportance,
    isUpcoming: urgencyClass !== 'past' && urgencyClass !== 'none',
    isPast: urgencyClass === 'past',
    sortTimestamp,
    stableSortKey: `${sortTimestamp}|${String(event.id || '')}`
  };
}

function buildNewsSectionSummary(events, context = {}) {
  const cards = Array.isArray(events) ? events : [];
  return {
    key: context.key || 'section',
    title: context.title || context.key || 'Section',
    count: cards.length,
    highImportanceCount: cards.filter((event) => event.isHighImportance).length,
    upcomingCount: cards.filter((event) => event.isUpcoming).length,
    portfolioRelevantCount: cards.filter((event) => event.isPortfolioRelevant).length
  };
}

function sortStableByTimestampAsc(a, b) {
  return a.sortTimestamp.localeCompare(b.sortTimestamp) || a.id.localeCompare(b.id);
}

function sortStableByTimestampDesc(a, b) {
  return b.sortTimestamp.localeCompare(a.sortTimestamp) || a.id.localeCompare(b.id);
}

function applyFilterRows(rows, filters) {
  return rows.filter((event) => {
    if (filters.sourceType && event.sourceType !== filters.sourceType) return false;
    if (filters.eventType && event.eventType !== filters.eventType) return false;
    if (Number.isFinite(filters.importanceMin) && Number(event.importance || 0) < filters.importanceMin) return false;
    const compareAt = event.scheduledAt || event.publishedAt;
    if (filters.from && (!compareAt || compareAt < filters.from)) return false;
    if (filters.to && (!compareAt || compareAt > filters.to)) return false;
    return true;
  });
}

function paginate(mode, cards, limit, cursor) {
  const normalizedLimit = normalizeLimit(limit);
  const { offset } = parseCursor(cursor, mode);
  const pageItems = cards.slice(offset, offset + normalizedLimit);
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    pagination: {
      mode,
      limit: normalizedLimit,
      offset,
      total: cards.length,
      returned: pageItems.length,
      cursor: nextOffset < cards.length ? encodeCursor(mode, nextOffset) : null,
      hasMore: nextOffset < cards.length
    }
  };
}

function getForYouNewsModel(deps, { userId, limit, cursor, filters = {} }) {
  const { newsEventService, resolveUserTickerUniverse, logger = console } = deps;
  const startedAt = Date.now();
  const normalizedFilters = normalizeFilters(filters);
  const context = { userId, userTickers: resolveUserTickerUniverse(userId), now: new Date().toISOString() };

  const rows = applyFilterRows(newsEventService.listUpcomingEvents({}), normalizedFilters);
  const cards = rows
    .map((event) => buildNewsEventCardModel(event, context))
    .filter((card) => normalizedFilters.includePast || card.isUpcoming || card.urgencyClass === 'today')
    .filter((card) => !normalizedFilters.portfolioOnly || card.isPortfolioRelevant)
    .filter((card) => !normalizedFilters.highImportanceOnly || card.isHighImportance);

  const portfolioUpcomingEarnings = cards
    .filter((card) => card.eventType === 'earnings' && card.isPortfolioRelevant && card.isUpcoming)
    .sort(sortStableByTimestampAsc);

  const macroUpcoming = cards
    .filter((card) => card.sourceType === 'macro' && card.isHighImportance && card.isUpcoming)
    .sort(sortStableByTimestampAsc);

  const recentlyUpdatedRelevant = cards
    .filter((card) => card.isPortfolioRelevant && card.eventType !== 'earnings')
    .sort(sortStableByTimestampDesc)
    .slice(0, 20);

  const seen = new Set();
  const mixed = [];
  for (const card of [...portfolioUpcomingEarnings, ...macroUpcoming]) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    mixed.push(card);
  }
  const remainingRelevantUpcoming = cards
    .filter((card) => !seen.has(card.id) && card.isPortfolioRelevant && card.isUpcoming)
    .sort(sortStableByTimestampAsc);
  for (const card of remainingRelevantUpcoming) {
    seen.add(card.id);
    mixed.push(card);
  }

  const paged = paginate('for_you', mixed, limit, cursor);
  const sectionsRaw = [
    { key: 'portfolioUpcomingEarnings', title: 'Portfolio Upcoming Earnings', items: portfolioUpcomingEarnings },
    { key: 'macroUpcoming', title: 'Macro Upcoming', items: macroUpcoming },
    ...(recentlyUpdatedRelevant.length ? [{ key: 'recentlyUpdatedRelevant', title: 'Recently Updated Relevant', items: recentlyUpdatedRelevant }] : [])
  ];
  const sections = sectionsRaw.map((section) => ({
    summary: buildNewsSectionSummary(section.items, { key: section.key, title: section.title }),
    items: section.items
  }));

  logger.info('[NewsReadModel] for_you built.', {
    userId,
    filters: normalizedFilters,
    counts: Object.fromEntries(sections.map((section) => [section.summary.key, section.summary.count])),
    durationMs: Date.now() - startedAt,
    pagination: paged.pagination
  });

  return {
    generatedAt: new Date().toISOString(),
    appliedFilters: normalizedFilters,
    sections,
    sectionCounts: Object.fromEntries(sections.map((section) => [section.summary.key, section.summary.count])),
    data: paged.items,
    pagination: paged.pagination
  };
}

function getCalendarNewsModel(deps, { userId, limit, cursor, filters = {} }) {
  const { newsEventService, resolveUserTickerUniverse, logger = console } = deps;
  const startedAt = Date.now();
  const normalizedFilters = normalizeFilters(filters);
  const context = { userId, userTickers: resolveUserTickerUniverse(userId), now: new Date().toISOString() };

  const cards = applyFilterRows(newsEventService.listUpcomingEvents({}), normalizedFilters)
    .filter((event) => isScheduledSignal(event.sourceType, event.eventType))
    .map((event) => buildNewsEventCardModel(event, context))
    .filter((card) => normalizedFilters.includePast || card.isUpcoming)
    .filter((card) => !normalizedFilters.portfolioOnly || card.isPortfolioRelevant)
    .filter((card) => !normalizedFilters.highImportanceOnly || card.isHighImportance)
    .sort(sortStableByTimestampAsc);

  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const today = [];
  const next7Days = [];
  const later = [];

  for (const card of cards) {
    const ts = Date.parse(card.scheduledAt || card.sortTimestamp);
    const diff = ts - nowMs;
    if (diff <= dayMs) today.push(card);
    else if (diff <= 7 * dayMs) next7Days.push(card);
    else later.push(card);
  }

  const paged = paginate('calendar', cards, limit, cursor);
  const sections = [
    { key: 'today', title: 'Today', items: today },
    { key: 'next7Days', title: 'Next 7 Days', items: next7Days },
    { key: 'later', title: 'Later', items: later }
  ].map((section) => ({
    summary: buildNewsSectionSummary(section.items, { key: section.key, title: section.title }),
    items: section.items
  }));

  logger.info('[NewsReadModel] calendar built.', {
    userId,
    filters: normalizedFilters,
    counts: Object.fromEntries(sections.map((section) => [section.summary.key, section.summary.count])),
    durationMs: Date.now() - startedAt,
    pagination: paged.pagination
  });

  return {
    generatedAt: new Date().toISOString(),
    appliedFilters: normalizedFilters,
    sections,
    sectionCounts: Object.fromEntries(sections.map((section) => [section.summary.key, section.summary.count])),
    data: paged.items,
    pagination: paged.pagination
  };
}

function getLatestNewsModel(deps, { userId, limit, cursor, filters = {} }) {
  const { newsEventService, resolveUserTickerUniverse, logger = console } = deps;
  const startedAt = Date.now();
  const normalizedFilters = normalizeFilters(filters);
  const context = { userId, userTickers: resolveUserTickerUniverse(userId), now: new Date().toISOString() };

  const cards = applyFilterRows(newsEventService.listPublishedNews({}), normalizedFilters)
    .filter((event) => isPublishedSignal(event.sourceType, event.eventType))
    .map((event) => buildNewsEventCardModel(event, context))
    .filter((card) => !normalizedFilters.portfolioOnly || card.isPortfolioRelevant)
    .filter((card) => !normalizedFilters.highImportanceOnly || card.isHighImportance)
    .sort(sortStableByTimestampDesc);

  const paged = paginate('latest', cards, limit, cursor);
  const sections = [{
    summary: buildNewsSectionSummary(cards, { key: 'headlines', title: 'Headlines' }),
    items: paged.items
  }];

  logger.info('[NewsReadModel] latest built.', {
    userId,
    filters: normalizedFilters,
    counts: { headlines: cards.length },
    durationMs: Date.now() - startedAt,
    pagination: paged.pagination
  });

  return {
    generatedAt: new Date().toISOString(),
    appliedFilters: normalizedFilters,
    sections,
    sectionCounts: { headlines: cards.length },
    data: paged.items,
    emptyState: {
      isHeadlineIngestionActive: cards.length > 0,
      message: cards.length ? null : 'Headline news ingestion is not active yet. Latest news is intentionally minimal.'
    },
    pagination: paged.pagination
  };
}

function createNewsReadModelService(deps) {
  return {
    getForYouNewsModel: (params) => getForYouNewsModel(deps, params),
    getCalendarNewsModel: (params) => getCalendarNewsModel(deps, params),
    getLatestNewsModel: (params) => getLatestNewsModel(deps, params),
    buildNewsEventCardModel,
    buildNewsSectionSummary
  };
}

module.exports = {
  createNewsReadModelService,
  getForYouNewsModel,
  getCalendarNewsModel,
  getLatestNewsModel,
  buildNewsEventCardModel,
  buildNewsSectionSummary
};
