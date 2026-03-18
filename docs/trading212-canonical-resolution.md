# Trading 212 Canonical Ticker Resolution

## Architecture

The canonical ticker flow is now backend-first and centered around a resolver pipeline.

- Trading 212 sync fetches and caches metadata (`metadata/instruments`, `metadata/exchanges`) per base URL in `db.t212MetadataCache`.
- Position ingestion calls `resolveAndUpsertTrading212InstrumentMapping` before creating/updating journal trades.
- Resolver stores durable records in `db.instrumentMappings` with raw broker fields + canonical fields + status/source/confidence timestamps.
- Trades persist canonical resolution fields (`canonicalTicker`, `resolutionStatus`, `resolutionSource`, `confidenceScore`, `requiresManualReview`) so all downstream consumers can use server-derived canonical identifiers.

## Resolution order

Priority order implemented:

1. **Manual override** (`resolution_status=manual_override`) if present.
2. **Cached high-confidence mapping** (`confidence_score >= 0.95`).
3. **Exact metadata match** by broker instrument id / ISIN.
4. **Scored metadata match** using normalized name + ticker/exchange/currency/type signals.
5. **Controlled fallback** remains internal (no open-web lookup).
6. **Manual review queue** if confidence is low or candidates are ambiguous.

## Confidence behavior

- `>= 0.95`: auto-resolved (`resolved`).
- `0.80 - 0.949`: resolved with scored source and metrics logging.
- `< 0.80`: unresolved/ambiguous and marked `requiresManualReview=true`.

The resolver records status/source/confidence and appends metrics to `db.instrumentResolutionMetrics`.

## Manual overrides

Admin tooling endpoints:

- `GET /api/admin/instrument-resolver/review-queue`
- `POST /api/admin/instrument-resolver/manual-override`

Manual overrides set:

- `resolution_status=manual_override`
- `resolution_source=manual_override`
- `confidence_score=1`
- `requiresManualReview=false`

They are treated as highest priority and are not overwritten by automatic flows.

## Backfill and migration notes

- Existing raw fields are preserved (`trading212Ticker`, `trading212Name`, etc.).
- New backfill script `scripts/backfill-t212-canonical-tickers.js` resolves legacy positions and writes canonical fields.
- If unresolved, UI-safe fallback still uses existing display symbol while preserving unresolved status for review.

## Known limitations

- Metadata endpoint variants differ by Trading 212 environment/account setup; code tries multiple endpoint candidates.
- Ambiguous symbols with weak metadata can remain unresolved until manual review.
- Backfill script does not force live metadata fetches; it primarily uses cached mappings and stored raw fields.
