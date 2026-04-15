const {
  normalizeString,
  normalizeIso,
  normalizeImportance,
  fetchJsonList
} = require('./configuredNewsProviderCommon');
const { getEnvString, getEnvNumber } = require('../../lib/env-utils');

const PROVIDER_NAME = 'configured_world';

function normalizeWorldHeadlineRow(row = {}) {
  const title = normalizeString(row.title || row.headline);
  const publishedAt = normalizeIso(row.publishedAt || row.published_at || row.datetime || row.date);
  if (!title || !publishedAt) return null;

  const sourceName = normalizeString(row.sourceName || row.source || row.publisher || 'Configured World Provider');
  const sourceUrl = normalizeString(row.sourceUrl || row.url || row.link);
  const sourceExternalId = normalizeString(row.sourceExternalId || row.id || row.guid || (sourceUrl ? `url:${sourceUrl}` : null));

  return {
    sourceType: 'news',
    eventType: 'world_news',
    title,
    summary: normalizeString(row.summary || row.description || row.snippet) || '',
    body: normalizeString(row.body || row.content) || '',
    ticker: null,
    canonicalTicker: null,
    country: normalizeString(row.country),
    region: normalizeString(row.region),
    importance: normalizeImportance(row.importance || row.impact || row.score, 65),
    publishedAt,
    sourceName,
    sourceUrl,
    sourceExternalId,
    metadataJson: {
      provider: PROVIDER_NAME,
      rawCategory: normalizeString(row.category || row.topic),
      providerRowShape: 'configured_world'
    },
    status: 'active'
  };
}

async function fetchConfiguredWorldNews(options = {}) {
  const rows = await fetchJsonList({
    url: options.url || getEnvString('NEWS_WORLD_PROVIDER_URL'),
    apiKey: options.apiKey || getEnvString('NEWS_WORLD_PROVIDER_API_KEY'),
    timeoutMs: options.timeoutMs || getEnvNumber('NEWS_WORLD_PROVIDER_TIMEOUT_MS', 8000, { min: 1000 }),
    logger: options.logger
  });
  return rows;
}

module.exports = {
  PROVIDER_NAME,
  normalizeWorldHeadlineRow,
  fetchConfiguredWorldNews
};
