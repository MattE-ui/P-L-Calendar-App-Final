const TRUST_TIERS = Object.freeze(['high', 'medium', 'low']);

const TRUST_TIER_BASE_SCORES = Object.freeze({
  high: 1,
  medium: 0.65,
  low: 0.35
});

const DEFAULT_SOURCE_PROFILE = Object.freeze({
  sourceName: 'unknown',
  trustTier: 'low',
  priorityBoost: 0,
  isAllowed: true,
  isMuted: false,
  categoryOverrides: {}
});

function normalizeSourceName(value) {
  return String(value || '').trim();
}

function normalizeTrustTier(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return TRUST_TIERS.includes(candidate) ? candidate : DEFAULT_SOURCE_PROFILE.trustTier;
}

function normalizePriorityBoost(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-20, Math.min(20, parsed));
}

function normalizeCategoryOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeSourceProfile(input = {}, existing = null) {
  const sourceName = normalizeSourceName(input.sourceName || existing?.sourceName);
  if (!sourceName) return null;
  return {
    sourceName,
    trustTier: normalizeTrustTier(input.trustTier ?? existing?.trustTier),
    priorityBoost: normalizePriorityBoost(input.priorityBoost ?? existing?.priorityBoost ?? 0),
    isAllowed: input.isAllowed === undefined ? (existing?.isAllowed ?? true) : !!input.isAllowed,
    isMuted: input.isMuted === undefined ? (existing?.isMuted ?? false) : !!input.isMuted,
    categoryOverrides: normalizeCategoryOverrides(input.categoryOverrides ?? existing?.categoryOverrides)
  };
}

function buildSourceLookup(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const normalized = normalizeSourceProfile(row);
    if (!normalized) continue;
    map.set(normalized.sourceName.toLowerCase(), normalized);
  }
  return map;
}

function resolveSourceProfile(rows = [], sourceName) {
  const lookup = Array.isArray(rows) && rows._lookup instanceof Map ? rows._lookup : buildSourceLookup(rows);
  const key = normalizeSourceName(sourceName).toLowerCase();
  if (!key) return { ...DEFAULT_SOURCE_PROFILE };
  return lookup.get(key) || { ...DEFAULT_SOURCE_PROFILE, sourceName: normalizeSourceName(sourceName) || 'unknown' };
}

function createNewsSourceRegistryService({ loadDB, saveDB, ensureNewsEventTables }) {
  if (typeof loadDB !== 'function' || typeof saveDB !== 'function' || typeof ensureNewsEventTables !== 'function') {
    throw new Error('createNewsSourceRegistryService requires loadDB/saveDB/ensureNewsEventTables');
  }

  function listSources() {
    const db = loadDB();
    ensureNewsEventTables(db);
    return db.newsSourceRegistry
      .map((row) => normalizeSourceProfile(row))
      .filter(Boolean)
      .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  }

  function getSourceProfile(sourceName) {
    const db = loadDB();
    ensureNewsEventTables(db);
    return resolveSourceProfile(db.newsSourceRegistry, sourceName);
  }

  function upsertSource(sourceName, patch = {}) {
    const db = loadDB();
    ensureNewsEventTables(db);
    const key = normalizeSourceName(sourceName);
    if (!key) throw new Error('sourceName is required');

    const existing = db.newsSourceRegistry.find((row) => String(row?.sourceName || '').toLowerCase() === key.toLowerCase()) || null;
    const normalized = normalizeSourceProfile({ ...patch, sourceName: key }, existing);
    if (!normalized) throw new Error('Unable to normalize source profile');

    if (existing) Object.assign(existing, normalized);
    else db.newsSourceRegistry.push(normalized);
    saveDB(db);
    return normalized;
  }

  return {
    TRUST_TIERS,
    TRUST_TIER_BASE_SCORES,
    DEFAULT_SOURCE_PROFILE,
    listSources,
    getSourceProfile,
    upsertSource
  };
}

module.exports = {
  TRUST_TIERS,
  TRUST_TIER_BASE_SCORES,
  DEFAULT_SOURCE_PROFILE,
  normalizeSourceProfile,
  resolveSourceProfile,
  createNewsSourceRegistryService
};
