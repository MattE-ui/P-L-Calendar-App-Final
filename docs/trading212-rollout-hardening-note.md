# Trading 212 canonical resolver hardening note

## Remaining risks
- metadata endpoint shape differences by environment can still reduce candidate universe quality.
- legacy `trade.symbol` dependencies may influence behavior for older records without canonical fields.
- ambiguous low-confidence cases require manual review throughput to prevent queue buildup.

## Unresolved legacy usages
- legacy position matching includes symbol fallbacks in reconciliation paths.
- older client surfaces may still render `symbol` if they do not consume canonical identity fields.

## Recommended rollout order
1. deploy backend with metrics and unresolved queue enabled.
2. run backfill in `--dry-run` mode and review counts.
3. run backfill live and monitor unresolved/ambiguous/conflict rates.
4. enable admin review workflow and process queue.
5. tighten client/UI contracts to canonical-only fields.

## Recommended dashboards/alerts
- resolution totals and rates: exact/scored/unresolved/ambiguous/manual.
- metadata cache hit rate + metadata refresh failures.
- conflicting remap attempts.
- canonical mismatch count (`canonicalTicker != rawTicker`).
- unresolved queue age percentile (P50/P95) and growth rate.
