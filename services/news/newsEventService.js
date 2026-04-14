const crypto = require('crypto');

const SOURCE_TYPES = ['macro', 'earnings', 'news', 'social_post'];
const EVENT_TYPES = ['fomc', 'cpi', 'rate_decision', 'earnings', 'stock_news', 'world_news', 'internal_post'];
const SCHEDULED_EVENT_TYPES = new Set(['fomc', 'cpi', 'rate_decision', 'earnings']);
const PUBLISHED_EVENT_TYPES = new Set(['stock_news', 'world_news', 'internal_post']);

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const next = String(value).trim();
  return next ? next : null;
}

function normalizeIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeImportance(value) {
  if (value === undefined || value === null || value === '') return null;
  const numberValue = Number(value);
  if (Number.isFinite(numberValue)) return Math.max(0, Math.min(100, numberValue));
  const lowered = String(value).trim().toLowerCase();
  if (lowered === 'high') return 90;
  if (lowered === 'medium') return 60;
  if (lowered === 'low') return 30;
  return null;
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeEvent(input = {}, existing = null) {
  const nowIso = new Date().toISOString();
  const sourceType = SOURCE_TYPES.includes(String(input.sourceType || '').trim())
    ? String(input.sourceType).trim()
    : (existing?.sourceType || null);
  const eventType = EVENT_TYPES.includes(String(input.eventType || '').trim())
    ? String(input.eventType).trim()
    : (existing?.eventType || null);

  return {
    id: existing?.id || normalizeString(input.id) || crypto.randomUUID(),
    sourceType,
    eventType,
    title: normalizeString(input.title) || existing?.title || '',
    summary: normalizeString(input.summary) || existing?.summary || '',
    body: normalizeString(input.body) || existing?.body || '',
    ticker: normalizeString(input.ticker) || existing?.ticker || null,
    canonicalTicker: (normalizeString(input.canonicalTicker) || normalizeString(input.ticker) || existing?.canonicalTicker || null),
    country: normalizeString(input.country) || existing?.country || null,
    region: normalizeString(input.region) || existing?.region || null,
    importance: normalizeImportance(input.importance) ?? existing?.importance ?? null,
    scheduledAt: normalizeIsoDate(input.scheduledAt) || existing?.scheduledAt || null,
    publishedAt: normalizeIsoDate(input.publishedAt) || existing?.publishedAt || null,
    sourceName: normalizeString(input.sourceName) || existing?.sourceName || null,
    sourceUrl: normalizeString(input.sourceUrl) || existing?.sourceUrl || null,
    sourceExternalId: normalizeString(input.sourceExternalId) || existing?.sourceExternalId || null,
    dedupeKey: normalizeString(input.dedupeKey) || existing?.dedupeKey || null,
    metadataJson: normalizeMetadata(input.metadataJson || existing?.metadataJson),
    status: normalizeString(input.status) || existing?.status || 'active',
    isActive: typeof input.isActive === 'boolean' ? input.isActive : (existing?.isActive ?? true),
    lastSeenAt: normalizeIsoDate(input.lastSeenAt) || nowIso,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso
  };
}

function buildEventDedupeKey(input = {}) {
  const explicit = normalizeString(input.dedupeKey);
  if (explicit) return explicit;
  const sourceType = normalizeString(input.sourceType) || 'unknown';
  const eventType = normalizeString(input.eventType) || 'unknown';
  const sourceExternalId = normalizeString(input.sourceExternalId) || '';
  const canonicalTicker = normalizeString(input.canonicalTicker || input.ticker) || '';
  const scheduledAt = normalizeIsoDate(input.scheduledAt) || '';
  const publishedAt = normalizeIsoDate(input.publishedAt) || '';
  const title = normalizeString(input.title) || '';
  const raw = [sourceType, eventType, sourceExternalId, canonicalTicker, scheduledAt, publishedAt, title].join('|').toLowerCase();
  if (!raw.replace(/\|/g, '').trim()) return null;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function isScheduledSignal(sourceType, eventType) {
  return sourceType === 'macro' || sourceType === 'earnings' || SCHEDULED_EVENT_TYPES.has(eventType);
}

function isPublishedSignal(sourceType, eventType) {
  return sourceType === 'news' || sourceType === 'social_post' || PUBLISHED_EVENT_TYPES.has(eventType);
}

function createNewsEventService({ loadDB, saveDB, ensureNewsEventTables, logger = console }) {
  function upsertEvent(input = {}) {
    const db = loadDB();
    ensureNewsEventTables(db);
    const dedupeKey = buildEventDedupeKey(input);
    const nowIso = new Date().toISOString();

    let existing = null;
    if (dedupeKey) {
      existing = db.newsEvents.find((item) => item.dedupeKey === dedupeKey) || null;
    }
    if (!existing && input.id) {
      existing = db.newsEvents.find((item) => item.id === input.id) || null;
    }

    const normalized = normalizeEvent({ ...input, dedupeKey, lastSeenAt: nowIso }, existing);

    if (dedupeKey && !existing) {
      const conflict = db.newsEvents.find((item) => item.dedupeKey && item.dedupeKey === dedupeKey);
      if (conflict) {
        logger.warn('[NewsEvents] dedupe key collision detected during insert.', {
          dedupeKey,
          existingId: conflict.id,
          incomingId: normalized.id
        });
        existing = conflict;
      }
    }

    let mode = 'inserted';
    if (existing) {
      Object.assign(existing, normalized);
      mode = 'updated';
    } else {
      db.newsEvents.push(normalized);
    }

    saveDB(db);
    logger.info('[NewsEvents] upsert completed.', {
      mode,
      id: (existing || normalized).id,
      dedupeKey: dedupeKey || null,
      sourceType: normalized.sourceType,
      eventType: normalized.eventType
    });
    return existing || normalized;
  }

  function upsertManyEvents(inputs = []) {
    const results = [];
    for (const input of inputs) {
      results.push(upsertEvent(input));
    }
    return results;
  }

  function listEvents(filters = {}, mode = 'all') {
    const startedAt = Date.now();
    const db = loadDB();
    ensureNewsEventTables(db);

    const sourceType = normalizeString(filters.sourceType);
    const eventType = normalizeString(filters.eventType);
    const ticker = normalizeString(filters.ticker);
    const canonicalTicker = normalizeString(filters.canonicalTicker);
    const from = normalizeIsoDate(filters.from);
    const to = normalizeIsoDate(filters.to);
    const importanceMin = filters.importance !== undefined && filters.importance !== null && filters.importance !== ''
      ? Number(filters.importance)
      : null;
    const isActive = filters.isActive === undefined ? true : filters.isActive === true;

    let rows = db.newsEvents.filter((event) => {
      if (isActive && event.isActive === false) return false;
      if (sourceType && event.sourceType !== sourceType) return false;
      if (eventType && event.eventType !== eventType) return false;
      if (ticker && String(event.ticker || '').toUpperCase() !== ticker.toUpperCase()) return false;
      if (canonicalTicker && String(event.canonicalTicker || '').toUpperCase() !== canonicalTicker.toUpperCase()) return false;
      if (Number.isFinite(importanceMin) && Number(event.importance || 0) < importanceMin) return false;
      if (from) {
        const compareAt = event.scheduledAt || event.publishedAt;
        if (!compareAt || compareAt < from) return false;
      }
      if (to) {
        const compareAt = event.scheduledAt || event.publishedAt;
        if (!compareAt || compareAt > to) return false;
      }
      if (mode === 'upcoming' && !isScheduledSignal(event.sourceType, event.eventType)) return false;
      if (mode === 'published' && !isPublishedSignal(event.sourceType, event.eventType)) return false;
      return true;
    });

    if (mode === 'published') {
      rows.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
    } else {
      rows.sort((a, b) => String(a.scheduledAt || '').localeCompare(String(b.scheduledAt || '')));
    }

    logger.info('[NewsEvents] query completed.', {
      mode,
      durationMs: Date.now() - startedAt,
      resultCount: rows.length,
      filters: {
        sourceType: sourceType || null,
        eventType: eventType || null,
        ticker: ticker || null,
        canonicalTicker: canonicalTicker || null
      }
    });

    return rows;
  }

  function listUpcomingEvents(filters = {}) {
    return listEvents(filters, 'upcoming');
  }

  function listPublishedNews(filters = {}) {
    return listEvents(filters, 'published');
  }

  return {
    SOURCE_TYPES,
    EVENT_TYPES,
    normalizeEvent,
    buildEventDedupeKey,
    upsertEvent,
    upsertManyEvents,
    listUpcomingEvents,
    listPublishedNews,
    isScheduledSignal,
    isPublishedSignal
  };
}

module.exports = {
  SOURCE_TYPES,
  EVENT_TYPES,
  normalizeEvent,
  buildEventDedupeKey,
  createNewsEventService,
  isScheduledSignal,
  isPublishedSignal
};
