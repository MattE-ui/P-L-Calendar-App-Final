function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeTicker(raw) {
  const value = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.\-_]/g, '');
  return value || null;
}

function normalizeImportance(value, fallback = 55) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, Math.min(100, Math.round(numeric)));
  const lowered = String(value).trim().toLowerCase();
  if (lowered === 'high') return 85;
  if (lowered === 'medium') return 65;
  if (lowered === 'low') return 35;
  return fallback;
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function fetchJsonList({ url, apiKey, timeoutMs = 8000, logger = console }) {
  const normalizedUrl = normalizeString(url);
  if (!normalizedUrl) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
    });
    if (!response.ok) {
      throw new Error(`provider_http_${response.status}`);
    }
    const payload = await response.json();
    return extractItems(payload);
  } catch (error) {
    logger.warn('[ConfiguredNewsProvider] fetch failed.', {
      url: normalizedUrl,
      error: error?.message || String(error)
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  normalizeString,
  normalizeIso,
  normalizeTicker,
  normalizeImportance,
  fetchJsonList
};
