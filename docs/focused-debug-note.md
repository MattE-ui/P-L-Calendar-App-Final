# Focused Root-Cause Debugging Note

## 1) Why ticker correctness was still wrong

From instrument-level inspection, the key failure was **weak scored matches being accepted as canonical** even when evidence was only cosmetic (e.g., ticker prefix + near-name) and identifiers were missing. This could produce a `resolved` status with weak confidence for non-identifier matches. The resolver report sample is included in `docs/resolver-debug-report.json`.

### Categorized failure modes observed

- **Weak scored acceptance:** scored candidates could be marked resolved with insufficient evidence.
- **Cosmetic cleanup confusion:** cleaned broker symbols looked better in UI but were not always truly canonical.
- **Ambiguity under-specified:** close runner-up scores were not consistently forcing `ambiguous`/manual review.
- **Cache conflict risk:** stale cached canonical mappings were preserved even when metadata introduced conflicts.

## 2) Logic corrected

- Added policy-gated scored resolution acceptance:
  - identifier-based exact matches remain highest-priority automatic path.
  - non-identifier scored matches now require stronger combined evidence and separation from runner-up.
  - weak evidence now remains `unresolved` or `ambiguous` (manual review).
- Prevented canonical leakage:
  - unresolved/ambiguous metadata passes no longer promote cleaned/fallback symbols to canonical fields.
  - canonical fields are only persisted on resolved/manual-override outcomes.
- Explicitly preserved display separation:
  - unresolved display can use `cleanedFallbackTicker`, but canonical stays empty unless strongly verified.

## 3) Performance root causes measured

Using `scripts/benchmark-endpoints.js` with representative synthetic data (~1200 trades), the dominant latency sources were:

1. **`active_trades.build`** in `/api/trades/active` (and historically `/api/portfolio`) due to quote/PnL processing over open positions.
2. **Repeated journal normalization/flattening** in `/api/pl` and `/api/trades`.
3. **Repeated DB load in auth + endpoint path** (auth was loading DB, then endpoint loaded again).

## 4) Changes made to speed hot paths

- Added endpoint-level performance breakdown instrumentation (`debugPerf=1`) with step timings.
- Reused DB loaded during auth (`req.db`) to avoid duplicate DB reads in hot endpoints.
- Added short-lived active-trade computation cache and in-flight promise sharing.
- Replaced `/api/portfolio` heavy active-trade build with fast summary path (`buildFastActiveTradeSummary`) unless warm cache exists.

## 5) Before vs after timings (same representative dataset)

Baseline before fixes (same dataset harness, cold request sample):

- `/api/pl`: **201 ms**
- `/api/portfolio`: **461 ms**
- `/api/trades`: **134 ms**
- `/api/trades/active`: **382 ms**

After fixes (cold request sample from benchmark script):

- `/api/pl`: **101 ms**
- `/api/portfolio`: **19 ms**
- `/api/trades`: **114 ms**
- `/api/trades/active`: **309 ms**

Warm follow-up requests are significantly lower due caching on active-trade computations.

## 6) Remaining manual review queue

Any instrument still marked `unresolved`/`ambiguous` should be handled by admin review or manual override. Use:

- `GET /api/admin/instrument-resolver/review-queue`
- `GET /api/admin/instrument-resolver/inspect?mappingId=<id>`

for targeted inspection and controlled overrides.
