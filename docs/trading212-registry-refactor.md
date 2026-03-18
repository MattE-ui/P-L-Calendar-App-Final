# Trading 212 Registry Refactor

## What changed

- Added a durable `brokerInstrumentRegistry` collection in the DB snapshot model.
- Added `instrumentResolutionHistory` for canonical ticker change auditing.
- Reworked Trading 212 resolution to prioritize:
  1. manual override
  2. existing trusted registry row
  3. ISIN exact match
  4. broker instrument id exact match
  5. normalized name + currency matching
  6. unresolved / ambiguous fallback
- Kept `rawTicker` and `cleanedFallbackTicker` separate from `canonicalTicker`.
- Added explicit revalidation support (`forceRevalidate`) and history writes on canonical ticker changes.
- Added admin history endpoint:
  - `GET /api/admin/instrument-resolver/history`

## Hot-path simplification

- Trade serialization (`/api/trades`, `/api/trades/active`, `/api/pl`) now relies on pre-resolved DB registry lookups.
- Removed runtime resolver scoring from render paths and replaced it with O(1) lookup cache maps.
- Kept unresolved behavior non-blocking with safe display fallback ticker.

## Known remaps verified

- `US78497K1025` remaps to `SEI`.
- `NL0009805522` remaps to `NBIS`.

## Performance measurements

Measured using:

- `node scripts/measure-load.js`
- `node scripts/benchmark-endpoints.js`

Representative endpoint timings after refactor in the local synthetic dataset:

- `/api/portfolio`: ~0.5–2.1ms server perf
- `/api/trades`: ~65–87ms server perf
- `/api/trades/active`: warm ~7–8ms (cold cache sample had ~490ms in `active_trades.build`)
- `/api/pl`: ~42–77ms server perf

The dominant remaining cost on active endpoints is the active-trade build path and journal normalization, not canonical ticker resolution.
