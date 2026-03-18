# Trading 212 ticker/name usage audit (post-hardening)

## Safe canonical usage
- `getDisplayInstrumentIdentity` enforces canonical-first selection and explicit unresolved fallback state; all canonical ticker derivation now routes through this helper. (`server.js`)
- `resolveCanonicalTickerForTrade` delegates to `getDisplayInstrumentIdentity`.
- Leaderboard diagnostics trade rows use helper-derived ticker.
- Trade filtering symbol lookup uses helper-derived ticker.
- Trade CSV export `display_ticker` now uses helper-derived ticker.

## Acceptable raw debug/audit usage
- `trading212Ticker`, `trading212Name`, `raw_*` fields are still persisted on trades/mappings for audit and traceability.
- stop-order matching still uses raw instrument ticker because broker order payload matching requires broker-native symbol identity.
- delayed alert dedupe keys still include broker position key / raw broker ids for reconciliation stability.

## Unsafe/legacy usages still needing refactor
- A few ingestion and reconciliation paths still compare `trade.symbol` directly when matching existing open positions (legacy behavior predating canonical resolver).
- Some request/response payloads still expose `displayTicker`/`symbol` alongside canonical fields and may be interpreted by older clients.
- Historical closed trades may not yet have canonical name/exchange populated until backfill is run.

## Recommended next follow-up
1. migrate remaining `trade.symbol` matching heuristics to a dedicated canonical identity key where possible.
2. add API contract versioning to discourage client use of `symbol` as canonical for Trading 212-origin trades.
3. run backfill in dry-run then live mode and monitor unresolved/ambiguous queue volume.
