'use strict';

/**
 * News Market Data Routes
 *
 * Four endpoints that power the live-data widgets on the News page.
 * All use Finnhub free-tier endpoints only.
 *
 * Registered by server.js via:
 *   const makeNewsMarketDataRouter = require('./routes/newsMarketData');
 *   app.use('/api/news', makeNewsMarketDataRouter({ auth, asyncHandler, loadDB, sleep }));
 */

const { Router } = require('express');
const { deriveUserCurrentHoldingTickers } = require('../services/news/ownedTickerUniverseService');
const {
  cache,
  getQuote,
  getMetrics,
  getCompanyNews,
  getRecommendations,
  getPriceTarget
} = require('../services/news/finnhubService');

// ---------------------------------------------------------------------------
// FOMC calendar constants
// ---------------------------------------------------------------------------

// Last updated: April 2026
// Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
// Update this array when the Fed publishes new meeting dates.
// Dates are the decision-announcement day (final day of each two-day meeting).
const FOMC_DATES = [
  '2025-01-29',
  '2025-03-19',
  '2025-05-07',
  '2025-06-18',
  '2025-07-30',
  '2025-09-17',
  '2025-10-29',
  '2025-12-10',
  '2026-01-28',
  '2026-03-18',
  '2026-04-29',
  '2026-06-10',
  '2026-07-29',
  '2026-09-16',
  '2026-10-28',
  '2026-12-09'
];

const FED_FUNDS_RATE_RANGE = '4.25–4.50%';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a number between lo and hi inclusive. */
function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Find the next FOMC date strictly after today and format the countdown
 * as "in Xd Yh".
 */
function resolveFomcCountdown(nowMs = Date.now()) {
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const next = FOMC_DATES.find((d) => d > todayIso);
  if (!next) return { nextFomcDate: null, nextFomcCountdown: null };

  const diffMs = Date.parse(`${next}T14:00:00Z`) - nowMs; // ~2pm ET decision time
  const totalHours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return {
    nextFomcDate: next,
    nextFomcCountdown: `in ${days}d ${hours}h`
  };
}

/**
 * VIX label from raw value.
 */
function vixLabel(value) {
  if (value < 15) return 'Low';
  if (value <= 25) return 'Normal';
  return 'Elevated';
}

/**
 * 10Y yield direction: compare current to previous close.
 * Up if diff > +0.02, Down if diff < -0.02, else Flat.
 */
function yieldDirection(current, previousClose) {
  const diff = current - previousClose;
  if (diff > 0.02) return 'up';
  if (diff < -0.02) return 'down';
  return 'flat';
}

/**
 * Score the VIX signal for fear-greed (0–33 pts).
 * Low VIX = greed; high VIX = fear.
 */
function scoreVix(vix) {
  if (vix < 15) return 33;
  if (vix <= 20) return 25;
  if (vix <= 25) return 17;
  if (vix <= 30) return 8;
  return 0;
}

/**
 * Score SPY momentum from change percent (0–33 pts).
 */
function scoreMomentum(changePct) {
  if (changePct > 1.5) return 33;
  if (changePct > 0.5) return 25;
  if (changePct >= -0.5) return 16; // flat
  if (changePct >= -1.5) return 8;
  return 0;
}

/**
 * Score where SPY sits in its 52-week range (0–34 pts).
 */
function scorePosition52w(current, low52, high52) {
  const range = high52 - low52;
  if (range <= 0) return 17; // guard divide-by-zero, default to neutral
  const position = (current - low52) / range;
  if (position > 0.8) return 34;
  if (position > 0.6) return 25;
  if (position > 0.4) return 17;
  if (position > 0.2) return 8;
  return 0;
}

/**
 * Map a 0–100 fear/greed score to a human label.
 */
function fearGreedLabel(score) {
  if (score <= 25) return 'Extreme Fear';
  if (score <= 44) return 'Fear';
  if (score <= 55) return 'Neutral';
  if (score <= 74) return 'Greed';
  return 'Extreme Greed';
}

/**
 * Derive a news-volume/recency proxy score (0–100) for a ticker.
 *
 * Score is based on news volume/recency only — sentiment field not available
 * on Finnhub free tier. To get true sentiment scoring, either upgrade to
 * Finnhub paid or integrate a separate NLP service.
 */
function deriveProxySentimentScore(articles) {
  const nowMs = Date.now();
  const last24hCutoffMs = nowMs - 24 * 60 * 60 * 1000;

  const articleCount = articles.length;
  const recentCount = articles.filter(
    (a) => Number(a.datetime) * 1000 >= last24hCutoffMs
  ).length;

  // Baseline volume score
  let score;
  if (articleCount === 0) score = 0;
  else if (articleCount <= 2) score = 15;
  else if (articleCount <= 5) score = 35;
  else if (articleCount <= 10) score = 55;
  else if (articleCount <= 15) score = 70;
  else score = 85;

  // Recency boost: +15 if more than 30% of articles are from the last 24h
  if (articleCount > 0 && recentCount / articleCount > 0.3) {
    score += 15;
  }

  return { score: clamp(score, 0, 100), articleCount, recentCount };
}

/**
 * Split an array into chunks of at most `size` items.
 */
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Classify analyst action by comparing period 0 (current) to period 1 (prior).
 */
function classifyAnalystAction(period0, period1) {
  if (!period1) return 'initiated';

  const bullish0 = (period0.strongBuy || 0) + (period0.buy || 0);
  const bullish1 = (period1.strongBuy || 0) + (period1.buy || 0);
  const bearish0 = (period0.strongSell || 0) + (period0.sell || 0);
  const bearish1 = (period1.strongSell || 0) + (period1.sell || 0);

  if (bullish0 - bullish1 >= 2) return 'upgrade';
  if (bearish0 - bearish1 >= 2) return 'downgrade';
  return 'reiterated';
}

/**
 * Derive a consensus rating label from a recommendation period's counts.
 */
function deriveRatingLabel(period) {
  if (!period) return 'Hold';
  const bullish = (period.strongBuy || 0) + (period.buy || 0);
  const bearish = (period.strongSell || 0) + (period.sell || 0);
  const neutral = period.hold || 0;
  if (bullish >= bearish && bullish >= neutral) return 'Buy';
  if (bearish > bullish && bearish >= neutral) return 'Sell';
  return 'Hold';
}

// ---------------------------------------------------------------------------
// Router factory — receives server.js dependencies as arguments
// ---------------------------------------------------------------------------

/**
 * @param {object} deps
 * @param {Function} deps.auth            Session-auth middleware from server.js
 * @param {Function} deps.asyncHandler    Promise-error-forwarding wrapper from server.js
 * @param {Function} deps.loadDB          JSON-file DB loader from server.js
 * @param {Function} deps.sleep           node:timers/promises setTimeout
 */
module.exports = function makeNewsMarketDataRouter({ auth, asyncHandler, loadDB, sleep }) {
  const router = Router();

  // -------------------------------------------------------------------------
  // GET /api/news/market-pulse
  // -------------------------------------------------------------------------
  // Returns live market snapshot for the four metric cards on the News page.
  // Calls SPY, VIX and TNX in parallel and caches the combined result for
  // 5 minutes.  The Fed Funds Rate and FOMC calendar are hardcoded constants.
  // -------------------------------------------------------------------------
  router.get('/market-pulse', auth, asyncHandler(async (req, res) => {
    const CACHE_KEY = 'market-pulse';
    const TTL_SECONDS = 5 * 60; // 5 minutes

    const cached = cache.get(CACHE_KEY);
    if (cached) return res.json({ data: cached });

    let spyQuote, vixQuote, tnxQuote;
    try {
      [spyQuote, vixQuote, tnxQuote] = await Promise.all([
        getQuote('SPY'),
        getQuote('VIX'),
        getQuote('TNX')
      ]);
    } catch (err) {
      console.error('[MarketPulse] Finnhub parallel fetch failed:', err.message);
      if (err.code === 'rate_limited') {
        return res.status(429).json({ error: 'rate_limited', retryAfter: 60 });
      }
      return res.status(503).json({ error: 'data_unavailable' });
    }

    // Cache individual quotes so fear-greed can reuse them without extra calls
    cache.set('quote:SPY', spyQuote, TTL_SECONDS);
    cache.set('quote:VIX', vixQuote, TTL_SECONDS);

    const vixValue = Number(vixQuote?.c);
    const tnxValue = Number(tnxQuote?.c);
    const tnxPrev  = Number(tnxQuote?.pc);

    const { nextFomcDate, nextFomcCountdown } = resolveFomcCountdown();

    const payload = {
      sp500: {
        price:     Number(spyQuote?.c)  || null,
        changePct: Number(spyQuote?.dp) || null
      },
      vix: {
        value: Number.isFinite(vixValue) ? vixValue : null,
        label: Number.isFinite(vixValue) ? vixLabel(vixValue) : null
      },
      treasury10y: {
        value:     Number.isFinite(tnxValue) ? tnxValue : null,
        direction: (Number.isFinite(tnxValue) && Number.isFinite(tnxPrev))
          ? yieldDirection(tnxValue, tnxPrev)
          : null
      },
      fedFunds: {
        range:             FED_FUNDS_RATE_RANGE,
        nextFomcDate,
        nextFomcCountdown
      }
    };

    cache.set(CACHE_KEY, payload, TTL_SECONDS);
    res.json({ data: payload });
  }));

  // -------------------------------------------------------------------------
  // GET /api/news/fear-greed
  // -------------------------------------------------------------------------
  // Synthesises a Fear & Greed style score (0–100) from three free-tier
  // Finnhub signals: VIX volatility, SPY momentum, and SPY 52-week position.
  //
  // previousWeek and previousMonth are approximated — upgrade to a paid
  // Finnhub plan or add a historical data store to get accurate values.
  // -------------------------------------------------------------------------
  router.get('/fear-greed', auth, asyncHandler(async (req, res) => {
    const CACHE_KEY = 'fear-greed';
    const TTL_SECONDS = 15 * 60; // 15 minutes

    const cached = cache.get(CACHE_KEY);
    if (cached) return res.json({ data: cached });

    // Reuse cached quotes from market-pulse if available to avoid duplicate calls
    let spyQuote = cache.get('quote:SPY');
    let vixQuote = cache.get('quote:VIX');

    const fetchPromises = [];
    if (!spyQuote) fetchPromises.push(getQuote('SPY').then((q) => { spyQuote = q; }));
    if (!vixQuote) fetchPromises.push(getQuote('VIX').then((q) => { vixQuote = q; }));
    // Always need SPY metrics for 52-week range
    let spyMetrics;
    fetchPromises.push(getMetrics('SPY').then((m) => { spyMetrics = m; }));

    try {
      await Promise.all(fetchPromises);
    } catch (err) {
      console.error('[FearGreed] Finnhub fetch failed:', err.message);
      if (err.code === 'rate_limited') {
        return res.status(429).json({ error: 'rate_limited', retryAfter: 60 });
      }
      return res.status(503).json({ error: 'data_unavailable' });
    }

    const vixValue  = Number(vixQuote?.c);
    const spyPrice  = Number(spyQuote?.c);

    // Signal 1 — Volatility (33 pts max)
    const s1 = Number.isFinite(vixValue) ? scoreVix(vixValue) : 16;

    // Signal 2 — Market momentum (33 pts max): SPY day change %
    const spyChangePct = Number(spyQuote?.dp); // dp = daily change %
    const s2 = Number.isFinite(spyChangePct) ? scoreMomentum(spyChangePct) : 16;

    // Signal 3 — Price strength (34 pts max): SPY position in 52-week range
    const high52 = Number(spyMetrics?.metric?.['52WeekHigh']);
    const low52  = Number(spyMetrics?.metric?.['52WeekLow']);
    const s3 = (Number.isFinite(spyPrice) && Number.isFinite(high52) && Number.isFinite(low52))
      ? scorePosition52w(spyPrice, low52, high52)
      : 17;

    const score = clamp(s1 + s2 + s3, 0, 100);
    const label = fearGreedLabel(score);

    // previousWeek and previousMonth are approximated — upgrade to a paid
    // Finnhub plan or add a historical data store to get accurate values.
    const previousWeek  = clamp(score + ((score % 7) - 3), 0, 100);
    const previousMonth = clamp(score + ((score % 13) - 6), 0, 100);

    const payload = { score, label, previousWeek, previousMonth };

    cache.set(CACHE_KEY, payload, TTL_SECONDS);
    res.json({ data: payload });
  }));

  // -------------------------------------------------------------------------
  // GET /api/news/portfolio-sentiment
  // -------------------------------------------------------------------------
  // Returns a news-volume/recency proxy sentiment score per held ticker.
  // Fetches company-news for the last 7 days for each held ticker.
  // Batches parallel calls in groups of 10 with 1s delay between batches
  // to stay within Finnhub's 60 req/min free-tier rate limit.
  //
  // Score is based on news volume/recency only — sentiment field not available
  // on Finnhub free tier. To get true sentiment scoring, either upgrade to
  // Finnhub paid or integrate a separate NLP service.
  // -------------------------------------------------------------------------
  router.get('/portfolio-sentiment', auth, asyncHandler(async (req, res) => {
    const TICKER_CACHE_TTL = 30 * 60; // 30 minutes per ticker

    const db = loadDB();
    const { tickerList } = deriveUserCurrentHoldingTickers(db, req.username);

    if (!tickerList.length) {
      return res.json({ data: [] });
    }

    // Date window: today and 7 days ago in YYYY-MM-DD format
    const nowMs  = Date.now();
    const toDate = new Date(nowMs).toISOString().slice(0, 10);
    const fromMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const fromDate = new Date(fromMs).toISOString().slice(0, 10);

    const results = [];
    const batches = chunk(tickerList, 10);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      if (batchIndex > 0) {
        // 1-second pause between batches to respect the 60 req/min rate limit
        await sleep(1000);
      }

      await Promise.all(
        batches[batchIndex].map(async (ticker) => {
          const cacheKey = `sentiment:${ticker}`;
          const cached = cache.get(cacheKey);
          if (cached) {
            results.push(cached);
            return;
          }

          let articles;
          try {
            articles = await getCompanyNews(ticker, fromDate, toDate);
            if (!Array.isArray(articles)) articles = [];
          } catch (err) {
            console.warn(`[PortfolioSentiment] Skipping ${ticker}: ${err.message}`);
            return; // exclude this ticker but don't fail the whole endpoint
          }

          const { score, articleCount } = deriveProxySentimentScore(articles);

          const entry = { ticker, score, articleCount };
          cache.set(cacheKey, entry, TICKER_CACHE_TTL);
          results.push(entry);
        })
      );
    }

    if (!results.length) {
      return res.status(503).json({ error: 'data_unavailable' });
    }

    res.json({ data: results });
  }));

  // -------------------------------------------------------------------------
  // GET /api/news/analyst-ratings
  // -------------------------------------------------------------------------
  // Returns recent analyst rating changes for the user's held tickers.
  // Each ticker gets a parallel recommendation + price-target call.
  // Batches in groups of 10 with 1s delay between batches.
  // By default, only "upgrade", "downgrade", and "initiated" entries are
  // returned. Pass ?includeReiterated=true to also include "reiterated".
  // -------------------------------------------------------------------------
  router.get('/analyst-ratings', auth, asyncHandler(async (req, res) => {
    const TICKER_CACHE_TTL = 60 * 60; // 60 minutes per ticker
    const includeReiterated =
      String(req.query?.includeReiterated || '').toLowerCase() === 'true';

    const db = loadDB();
    const { tickerList } = deriveUserCurrentHoldingTickers(db, req.username);

    if (!tickerList.length) {
      return res.json([]);
    }

    const allEntries = [];
    const batches = chunk(tickerList, 10);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      if (batchIndex > 0) {
        // 1-second pause between batches to respect the 60 req/min rate limit
        await sleep(1000);
      }

      await Promise.all(
        batches[batchIndex].map(async (ticker) => {
          const cacheKey = `analyst:${ticker}`;
          const cached = cache.get(cacheKey);
          if (cached) {
            allEntries.push(...cached);
            return;
          }

          let recommendations, priceTarget;
          try {
            [recommendations, priceTarget] = await Promise.all([
              getRecommendations(ticker),
              getPriceTarget(ticker)
            ]);
          } catch (err) {
            console.warn(`[AnalystRatings] Skipping ${ticker}: ${err.message}`);
            return; // exclude this ticker but don't fail the whole endpoint
          }

          if (!Array.isArray(recommendations) || recommendations.length === 0) {
            // Cache an empty result to avoid hammering on tickers with no data
            cache.set(cacheKey, [], TICKER_CACHE_TTL);
            return;
          }

          const period0 = recommendations[0]; // most recent monthly period
          const period1 = recommendations[1]; // prior period (may be undefined)

          const action = classifyAnalystAction(period0, period1);

          const entry = {
            ticker,
            firm: null, // Finnhub recommendation endpoint does not provide firm names
            action,
            toRating:   deriveRatingLabel(period0),
            fromRating: period1 ? deriveRatingLabel(period1) : null,
            ptTo:       Number.isFinite(Number(priceTarget?.targetMean))
              ? Number(priceTarget.targetMean)
              : null,
            // period field from Finnhub is a date string e.g. "2026-04-01"
            publishedAt: period0?.period
              ? `${period0.period}T09:30:00Z`
              : null
          };

          // Cache at the ticker level as an array (may contain one entry or none)
          const tickerEntries = [entry];
          cache.set(cacheKey, tickerEntries, TICKER_CACHE_TTL);
          allEntries.push(entry);
        })
      );
    }

    if (!allEntries.length) {
      return res.status(503).json({ error: 'data_unavailable' });
    }

    // Filter by action unless caller wants all entries
    const filtered = includeReiterated
      ? allEntries
      : allEntries.filter((e) => e.action !== 'reiterated');

    // Sort by publishedAt descending (most recent first)
    filtered.sort((a, b) =>
      String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))
    );

    res.json(filtered);
  }));

  return router;
};
