# Dashboard / Trades Load Path Audit

## Hot-path endpoints

| Endpoint | Purpose | Current blocking role | Primary latency drivers | Avoidable on page load? |
|---|---|---|---|---|
| `/api/pl` | Calendar/month data | Blocking for calendar body | JSON load + trade normalization | Required for calendar grid only |
| `/api/portfolio` | Header metrics and baseline portfolio values | Blocking for top metrics | DB read + aggregation | Required for top-of-page metrics |
| `/api/trades/active` | Active trades card + live open P/L | Blocking for active-trades section | Trade flattening, quote fetches for non-provider trades | Required for active trades, but broker sync was avoidable |
| `/api/trades` | Trades page table payload | Blocking on trades page table | Flatten + filter + sorting + FX fetch | Required on trades page |

## Main causes of slow render before fix

1. **Broker stop-sync work ran inside `/api/trades/active`** during normal page polls, adding external Trading 212/IBKR calls to a page-render path.
2. **Quote enrichment in `buildActiveTrades` executed sequentially per trade** (`await` inside loop), multiplying latency with open positions.
3. **Dashboard `loadData()` fetched critical datasets sequentially** (`/api/pl` then `/api/portfolio` then `/api/trades/active`) instead of parallel.

## Remediation implemented

- Removed broker metadata/stop-sync refresh from `/api/trades/active` hot path.
- Parallelized market quote fetches for active trades using a symbol promise map.
- Parallelized initial dashboard data loads (`/api/pl`, `/api/portfolio`, `/api/trades/active`) with immediate skeleton state.
- Added endpoint and operation timing logs + internal summary endpoint (`/api/admin/performance/summary`).

## How to read timing output

Server logs now emit structured entries such as:

- `[Perf] db.load.active_trades {"durationMs":...}`
- `[Perf] active_trades.build {"durationMs":...}`
- `[Perf] trades.filter_sort {"durationMs":...}`

Use `/api/admin/performance/summary` (admin only) to inspect rolling averages and max durations.
