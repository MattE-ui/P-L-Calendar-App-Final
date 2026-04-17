'use strict';

// Dynamic import of node-fetch, matching the pattern used throughout server.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { setTimeout: sleep } = require('node:timers/promises');

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// ---------------------------------------------------------------------------
// Simple in-memory cache with per-entry TTL
// ---------------------------------------------------------------------------
const _cache = new Map();

/**
 * Retrieve a cached value. Returns null if absent or expired.
 */
function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Store a value with a TTL in seconds.
 */
function cacheSet(key, value, ttlSeconds) {
  _cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Returns true if the key is present and not expired.
 */
function cacheHas(key) {
  return cacheGet(key) !== null;
}

// ---------------------------------------------------------------------------
// Core HTTP helper
// ---------------------------------------------------------------------------

/**
 * Fetch a Finnhub REST endpoint and return the parsed JSON body.
 *
 * Behaviour:
 *  - Attaches the API key as a `token` query param (never echoed in errors).
 *  - On HTTP 429 waits 1 second then retries once before throwing.
 *  - Throws with a `code` property so callers can distinguish error types.
 *
 * @param {string} endpoint  e.g. '/quote'
 * @param {Object} params    Query params (excluding token)
 */
async function finnhubFetch(endpoint, params = {}) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    throw Object.assign(
      new Error('FINNHUB_API_KEY environment variable is not set'),
      { code: 'missing_api_key' }
    );
  }

  const url = new URL(`${FINNHUB_BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set('token', apiKey);

  async function attempt() {
    let response;
    try {
      response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    } catch (err) {
      throw Object.assign(
        new Error(`Finnhub network error [${endpoint}]: ${err.message}`),
        { code: 'network_error' }
      );
    }

    if (response.status === 429) {
      return { rateLimited: true };
    }

    let body;
    try {
      body = await response.json();
    } catch (_) {
      throw Object.assign(
        new Error(`Finnhub response parse error [${endpoint}]`),
        { code: 'parse_error' }
      );
    }

    if (!response.ok) {
      // Log symbol/endpoint only — never expose the API key
      const sym = params.symbol || '';
      console.warn(`[FinnhubService] HTTP ${response.status} on ${endpoint}${sym ? ` (${sym})` : ''}`);
      throw Object.assign(
        new Error(`Finnhub HTTP ${response.status} [${endpoint}]`),
        { code: `http_${response.status}`, status: response.status }
      );
    }

    return { body };
  }

  const first = await attempt();
  if (!first.rateLimited) return first.body;

  // HTTP 429 — wait 1 second and retry once
  await sleep(1000);
  const second = await attempt();
  if (second.rateLimited) {
    throw Object.assign(
      new Error(`Finnhub rate limited [${endpoint}]`),
      { code: 'rate_limited', status: 429 }
    );
  }
  return second.body;
}

// ---------------------------------------------------------------------------
// Named API functions (free-tier endpoints only)
// ---------------------------------------------------------------------------

/** GET /quote — real-time quote for any symbol */
async function getQuote(symbol) {
  return finnhubFetch('/quote', { symbol });
}

/** GET /stock/metric?metric=all — fundamental metrics including 52-week range */
async function getMetrics(symbol) {
  return finnhubFetch('/stock/metric', { symbol, metric: 'all' });
}

/**
 * GET /company-news — news articles for a symbol over a date range.
 * @param {string} symbol
 * @param {string} from  ISO date string YYYY-MM-DD
 * @param {string} to    ISO date string YYYY-MM-DD
 */
async function getCompanyNews(symbol, from, to) {
  return finnhubFetch('/company-news', { symbol, from, to });
}

/** GET /stock/recommendation — monthly analyst recommendation trend */
async function getRecommendations(symbol) {
  return finnhubFetch('/stock/recommendation', { symbol });
}

/** GET /stock/price-target — consensus price target */
async function getPriceTarget(symbol) {
  return finnhubFetch('/stock/price-target', { symbol });
}

/**
 * GET /calendar/earnings — earnings events in a date range.
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 * Returns { earningsCalendar: Array<{ symbol, date, hour, epsActual, epsEstimate, revenueActual, revenueEstimate }> }
 */
async function getEarningsCalendar(from, to) {
  return finnhubFetch('/calendar/earnings', { from, to });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  cache: { get: cacheGet, set: cacheSet, has: cacheHas },
  getQuote,
  getMetrics,
  getCompanyNews,
  getRecommendations,
  getPriceTarget,
  getEarningsCalendar
};
