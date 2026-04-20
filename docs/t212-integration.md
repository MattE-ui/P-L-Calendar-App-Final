# Trading 212 Integration Spec

> **Status**: Pre-rebuild. Reconciliation endpoint live (`/api/admin/trade-reconciliation`). Stage 0 not started — waiting on demo probe results.  
> **Last updated**: 2026-04-19  
> **Source**: Official T212 API docs + code audit of server.js.  
> **Do not start Stage 0 until the probe comes back clean.**

---

## 1. Environments

| Environment | Base URL |
|-------------|----------|
| Live | `https://live.trading212.com/api/v0` |
| Paper (demo) | `https://demo.trading212.com/api/v0` |

**Per-account data is NOT shared between environments.** A demo API key will not return live positions, and vice versa. The UI must show clearly which environment a connection uses — a demo connection appearing to show live data would be a trust issue.

Probe must be run against **demo first**. Docs are currently beta and explicitly warn about active changes. Validate shape in sandbox before touching live.

---

## 2. Account Type Restriction

Only **Invest** and **Stocks ISA** accounts can use this API. CFD and Gaming accounts cannot. Onboarding must detect account type on the first probe and reject unsupported types with a clear error, not silently.

---

## 3. Auth — Confirmed Correct, Do Not Change

```
Authorization: Basic <base64(apiKey:apiSecret)>
```

The official T212 docs explicitly specify:
> "The API uses a secure key pair for authentication on every request. You must provide your API Key as the username and your API Secret as the password, formatted as an HTTP Basic Authentication header."

The current code is correct on this. Do not change auth format.

The docs also list a `legacyApiKeyHeader` scheme (single raw API key in the `Authorization` header). This was the older format and may still be accepted, but the current, documented, supported format is Basic auth. If a user's keys fail with Basic auth and succeed with the legacy format, that becomes a probe-detected edge case handled explicitly — not the default code path.

**Storage**: `user.trading212.accounts[].encryptedApiKey` / `encryptedApiSecret`  
**Decrypt via**: `decryptBrokerCredential()` in server.js  
**Legacy fallback**: `user.trading212.apiKey` / `apiSecret` (still supported, deprecated)

---

## 4. Rate Limits — Complete Table

All limits are **per-account**, not per-IP. Multiple API keys for the same user do not grant more budget. The central client class (Stage 0) is the single serialisation point across all features.

| Endpoint | Limit | Notes |
|----------|-------|-------|
| `GET /equity/account/summary` | 1 req / 5s | Account cash + invested + total |
| `GET /equity/positions` | 1 req / 1s | Open positions — tightest useful limit for us |
| `GET /equity/orders` | 1 req / 5s | Pending orders |
| `GET /equity/orders/{id}` | 1 req / 1s | Single pending order by ID |
| `POST /equity/orders/market` | 50 req / 1m | Write — not used |
| `POST /equity/orders/limit` | 1 req / 2s | Write — not used |
| `POST /equity/orders/stop` | 1 req / 2s | Write — not used |
| `POST /equity/orders/stop_limit` | 1 req / 2s | Write — not used |
| `DELETE /equity/orders/{id}` | 50 req / 1m | Write — not used |
| `GET /equity/history/orders` | 6 req / 1m | Historical fills — the bottleneck |
| `GET /equity/history/transactions` | 6 req / 1m | Deposits / withdrawals / dividends / fees |
| `GET /equity/history/dividends` | 6 req / 1m | Dividends specifically |
| `GET /equity/history/exports` (list) | 1 req / 1m | CSV report status polling |
| `POST /equity/history/exports` | 1 req / 30s | Request a CSV export |
| `GET /equity/metadata/instruments` | 1 req / 50s | Tradable universe — cache hard, refresh daily |
| `GET /equity/metadata/exchanges` | 1 req / 30s | Exchange trading hours |

**Practical implications:**
- Positions at 1 req/1s supports 15s dashboard polling easily
- History orders at 6 req/min means a full backfill at 50 fills/page takes ~17 minutes for a 5,000-fill account
- Metadata/instruments at 1 req/50s means: initialise once at startup, cache, never re-fetch mid-session

**Bursting:** Docs explicitly note that rate limits support bursting. A 50 req/min endpoint does not mean one call every 1.2 seconds — it means up to 50 calls in a burst, then wait for reset. The client should allow bursts for features that need them (e.g. parallel fetches during initial sync) while respecting the per-window total.

**Max pending orders:** Docs note a max of 50 pending orders per ticker per account. Not relevant for our read-only integration but noted for completeness.

### Rate limit response headers (present on every response)

```
x-ratelimit-limit      — total requests allowed in window
x-ratelimit-period     — window duration in seconds
x-ratelimit-remaining  — requests remaining in current window
x-ratelimit-reset      — Unix timestamp when window resets
x-ratelimit-used       — requests used this window
```

The central client class reads these on every response and maintains a per-endpoint budget. When `x-ratelimit-remaining` reaches 0, the client queues further calls until `x-ratelimit-reset` passes rather than letting them fail with 429.

**Caveat:** Before trusting these headers as the authoritative budget, the probe must confirm they decrement correctly — see Section 9.

---

## 5. Confirmed Endpoint Paths

### Endpoints we use (confirmed correct)

| Path | Method | Purpose | Rate limit |
|------|--------|---------|------------|
| `/equity/account/summary` | GET | Cash + invested + total account value | 1 req/5s |
| `/equity/positions` | GET | All open positions with current quantities | 1 req/1s |
| `/equity/orders` | GET | Active stop/limit orders | 1 req/5s |
| `/equity/history/orders` | GET | Historical filled orders, paginated | 6 req/min |

### Endpoints to add in rebuild

| Path | Method | Purpose | Rate limit |
|------|--------|---------|------------|
| `/equity/metadata/instruments` | GET | Ticker/ISIN/currency reference | 1 req/50s |
| `/equity/history/transactions` | GET | Deposits/withdrawals (net deposits figure) | 6 req/min |

### Endpoints confirmed NOT to exist

- `/equity/account/cash` — does not appear in official docs. Use `/equity/account/summary`.
- `/equity/portfolio/summary` — the path the current code defaults to. Appears to be invented. Delete.

### Write operations — explicit non-goal

Order placement endpoints exist in T212 docs. These must not be added to the client class at any stage. Not exposed, not commented-out stubs, not "for later." Veracity is a journal, not a broker frontend. If this ever becomes a desired feature, it gets designed fresh from scratch.

---

## 6. Pagination

- `limit` parameter: max 50, default 20
- `cursor`: opaque string — do not parse, reconstruct, or modify
- Response shape: `{ items: [...], nextPagePath: string | null }`
- `nextPagePath` is the **full path + query string** for the next page — use it verbatim
- `null` means end of data
- Cursor expiration behaviour is **not specified in the docs** — a paused backfill resuming later may or may not find the cursor still valid. Build with retry-from-beginning as fallback

---

## 7. Key Data Shape Notes

### Ticker format

T212 returns tickers as `AAPL_US_EQ`, not `AAPL`. The bidirectional mapping lives in the client class, not scattered through feature code. All ticker matching against our trade journal normalises T212's format first using the instruments cache.

### Sell convention

**Negative quantity = sell / short position.** If the current ingest parses historical orders and assumes positive-only quantities, it is wrong. This may be a contributing factor to the phantom-exit problem. Verify explicitly during Stage 2.

### Multi-currency

T212 returns values in the user's primary account currency (likely GBP for UK accounts, but not guaranteed). For the rebuild:
- Store values in source currency alongside an ISO currency code
- Convert to display currency on render using stored exchange rates
- The UI currency switcher is **display-only** for T212-sourced views — do not let it imply you can request data in a different currency from T212

### Current price freshness

The `currentPrice` field on the positions response has unspecified freshness in the docs. The probe will tell us whether it is real-time, delayed, or end-of-day.

---

## 8. Current Ingest Pipeline (pre-rebuild)

### Trigger
- User-triggered: POST to `/api/integrations/trading212` or manual sync button
- Automatic poll: background interval
- Not event-driven: no websocket documented, REST polling only

### Flow

```
poll / user action
  → resolveTrading212BaseUrl(config)         live vs demo
  → buildTrading212AuthHeaders(config)       Basic auth — correct
  → parallel fetch:
      fetchTrading212Orders()                /equity/orders — cached 20s — correct path
      fetchTrading212HistoryOrders()         /equity/history/orders — cached 180s — correct path
      fetchTrading212Snapshot()              11-endpoint fallback — REPLACE with /equity/account/summary
  → reconcileTrading212HistoricalExits()
      for each SELL fill:
        find matching open trade by ticker/ISIN
        create exit execution leg
        applyTrading212ExecutionSummary()    recomputes openQty, status, pnl
        [live] logs phantom-exit-candidate if openQty goes from >0 to ≤0
  → upsertTrading212StopOrders()
      for each active SELL stop order:
        match to open trade by ticker/ISIN
        update trade.currentStop
  → saveDB()
```

---

## 9. Feature → Endpoint Mapping

| Feature | T212 endpoint | Current state | Notes |
|---------|--------------|---------------|-------|
| Active trades panel | `/equity/positions` (not called yet) | **Broken** — positions not pulled; derived from fill math which has phantom-exit bug | Stage 2 fix |
| Calendar daily P&L | `/equity/history/orders` | **Partially working** — fills close out trades; calendar aggregates those | |
| Closed trade journal | `/equity/history/orders` | **Working** — dedup by importFingerprint prevents double-counting | |
| Open position count | Derived from `openQuantity` | **Broken** — phantom exits cause count to drop | Stage 2 fix |
| Portfolio header value | `/equity/account/summary` | **Unreliable** — hitting wrong endpoint via 11-path fallback | Stage 1 fix |
| Net deposits | `/equity/account/summary` | **Unreliable** — same fallback | Stage 1 fix |
| Sparkline data | Derived from stored daily entries | **Working** — no direct T212 call | |
| Stop prices | `/equity/orders` | **Working** — matched by ticker/ISIN | |
| Dividends | Not implemented | **Missing** | `/equity/history/dividends` or via `/equity/history/transactions` |
| Net deposits (authoritative) | `/equity/history/transactions` | **Missing** | Filter by DEPOSIT/WITHDRAWAL type |
| Instrument metadata | Not called | **Missing** | Needed for ticker normalisation — Stage 0 |
| Real-time updates | Not implemented | **Missing** | No websocket; REST polling only |

---

## 10. Known Bugs (pre-rebuild)

### P0 — Phantom exits

**Symptom**: Trade shows `status: 'open'` in DB but `openQuantity ≤ 0`, so `buildActiveTrades()` excludes it.  
**Root cause** (suspected): A SELL fill matched to the wrong trade, or negative quantities not handled correctly (see sell convention note in Section 7).  
**Detection**: `[t212-ingest][phantom-exit-candidate]` logs. `/api/admin/trade-reconciliation` endpoint.  
**Fix**: Stage 2 — T212's own `quantity` from `/equity/positions` becomes source of truth.

### P1 — Portfolio summary endpoint wrong

**Symptom**: Header shows wrong/stale portfolio value or silently fails.  
**Root cause**: 11-candidate path fallback; correct path is `/equity/account/summary`.  
**Fix**: Stage 1.

### P1 — Pagination interrupted by rate limits

**Symptom**: Some historical closed trades missing from journal after a rate-limited sync.  
**Root cause**: 429 during pagination exits the loop without saving resume cursor.  
**Fix**: Stage 3.

---

## 11. Known Unknowns (from docs + audit)

- **Cursor expiration**: Not specified. A resumed backfill cursor may be invalid after a long pause. Retry-from-start is the fallback.
- **Corporate actions**: Splits, ticker renames, dividends-in-stock are not called out in order history response shape. Discover empirically during Stage 3.
- **Current price freshness**: Not specified in docs. Probe response will indicate whether it is real-time, delayed, or end-of-day.
- **Websocket**: Not documented. REST polling is the only confirmed option.
- **Account summary `invested` field**: Confirmed as approximate net-deposits proxy — exact behaviour TBC. May need `/equity/history/transactions` filtered by DEPOSIT/WITHDRAWAL for a more accurate figure.

---

## 12. Rebuild Plan

### Stage 0 — Central T212 client class (~3h) [BLOCKED on probe]

Before any endpoint-specific work. No feature code calls `fetch` against T212 directly.

**Requirements:**
- One instance per connected user account (keyed by `accountId`)
- Holds encrypted credentials; decrypts per-request
- Tracks which environment (live vs demo) per account; exposes it for UI display
- Queues outgoing requests — no parallel calls to the same endpoint
- Reads all `x-ratelimit-*` headers on every response; maintains per-endpoint budget
- When `x-ratelimit-remaining === 0`: queues calls until `x-ratelimit-reset`; does not drop them
- Fallback if headers are absent or untrustworthy: maintain observed-timestamp budget based on documented limits
- Typed public methods: `getAccountSummary()`, `getPositions()`, `getOrders()`, `getHistoryOrders({ cursor, limit })`, `getInstruments()`, `getHistoryTransactions({ cursor, limit })`
- No mutation methods — not even commented stubs
- Built-in retry: 429 → wait for reset, then retry; network error → 3 attempts with backoff

### Stage 1 — Account summary replacement (~1h)

Replace `fetchTrading212Snapshot()` 11-endpoint fallback with `client.getAccountSummary()`. Delete the fallback code entirely — no comments, no flags.

If call fails: surface "T212 unreachable — last synced N minutes ago" on affected panels. No silent fallback to stale data.

**Fields to map from response:**
- Total account value → `state.currentPortfolioValueGBP` (after currency conversion)
- Invested → net deposits proxy (verify against `/equity/history/transactions` for accuracy)
- Free funds → informational, display only

### Stage 2 — Positions reconciliation (~4h)

On every sync: call `client.getPositions()`, reconcile against our DB.

| T212 says | We say | Action |
|-----------|--------|--------|
| Open, quantities match | Open, quantities match | No action |
| Open, quantity X | Open, quantity Y ≠ X | Log `quantity_mismatch`, update to T212's qty, notify user |
| Open (present in response) | Closed or missing | Log `t212_open_we_closed`, reopen or flag for review, notify user |
| Closed (absent from response) | Open | Log `t212_closed_we_open`, close trade in our DB, notify user |

Every reconciliation event:
- Emits `[reconcile][auto-mutate]` log
- Surfaces as a dismissable user notification
- Never silently mutates data

**Also verify during Stage 2:** negative quantities are handled correctly as sells (see sell convention, Section 7).

### Stage 3 — History pagination with resume (~3h)

- On each page response: persist `nextPagePath` to `historyCheckpoint.resumeCursor`
- On 429 or network error: stop, preserve cursor, resume from it on next sync
- On cursor-invalid error from T212: fall back to full re-fetch from beginning (deduplicated by existing `importFingerprint`)
- First connect: backfill as background job with progress indicator; does not block the page
- Subsequent syncs: incremental from last saved cursor

### Stage 4 — Instruments metadata cache (~1h)

`/equity/metadata/instruments` at 1 req/50s: initialise at Stage 0 client startup, cache to DB, refresh daily. Builds `AAPL_US_EQ ↔ AAPL` mapping table. All ticker normalisation in Stage 2 depends on this being ready first. Implement as part of Stage 0 client initialisation.

If the daily refresh fails, serve from previous cache with a log warning. Do not block other operations.

### Stage 5 — Write operations (non-goal)

Intentionally not built. See Section 5.

---

## 13. Pre-Stage-0 Probe

Run against **demo** (`demo.trading212.com`) first.

```bash
CREDENTIALS=$(echo -n "<DEMO_API_KEY>:<DEMO_API_SECRET>" | base64)

curl -X GET "https://demo.trading212.com/api/v0/equity/account/summary" \
  -H "Authorization: Basic $CREDENTIALS" \
  -i

curl -X GET "https://demo.trading212.com/api/v0/equity/positions" \
  -H "Authorization: Basic $CREDENTIALS" \
  -i
```

`-i` includes response headers in output alongside the body.

**Paste both full responses** (redact account numbers and personal values, but keep field names, types, and structure intact) before Stage 0 begins.

### What to check

| Check | Pass condition | Fail action |
|-------|---------------|-------------|
| HTTP status 200 | Both return 200 | 401/403 → auth issue; 404 → path wrong |
| Auth format | Accepted without 401 | Verify Basic vs legacy scheme |
| Rate-limit headers present | All five `x-ratelimit-*` headers appear | Client must maintain own budget from observed timestamps |
| Response fields match expected shapes below | Field names present, correct types | Update spec before writing client |
| `x-ratelimit-remaining` decrements | Run positions twice ~200ms apart; check second response has remaining − 1 | If headers don't decrement, can't trust them as budget signal |

### Expected response shapes

**`/equity/account/summary`:**
```json
{
  "free": 1234.56,
  "invested": 15000.00,
  "ppl": 234.56,
  "result": 1200.00,
  "total": 16234.56
}
```
`total` → portfolio value. `invested` → net deposits proxy (verify accuracy vs transaction history).

**`/equity/positions`:**
```json
[
  {
    "ticker": "AAPL_US_EQ",
    "quantity": 10.0,
    "averagePrice": 178.50,
    "currentPrice": 182.30,
    "ppl": 38.00,
    "fxPpl": 0.00,
    "initialFillDate": "2025-01-15T10:30:00Z",
    "frontend": "EQUITY",
    "maxBuy": 5.0,
    "maxSell": 10.0,
    "pieQuantity": 0
  }
]
```
`ticker` requires instrument normalisation (`AAPL_US_EQ → AAPL`). Negative `quantity` = short. `currentPrice` freshness: observe from probe.

---

## 14. Decisions Locked

These are settled and not open for re-evaluation without a new planning round:

| Decision | Rationale |
|----------|-----------|
| Auth stays as Basic key:secret | Confirmed by official docs |
| `/equity/positions` not `/equity/portfolio` | Confirmed by official docs |
| `/equity/account/summary` not any of the 11 fallback paths | Confirmed by official docs |
| Stage 0 client class before any endpoint work | Everything else depends on correct budget tracking |
| Write operations out of scope entirely | Veracity is a journal; mutation risk is too high |
| Demo probe before live | Standard practice; docs are beta and may differ from implementation |
| Auto-reconciliation mutations must be user-visible | Trust in a journal depends on it |

---

## 15. UX Invariants

Design behaviours that must be preserved through the Stage 2 rebuild. These are not optional polish — they represent established user mental models. Breaking them silently is worse than not having the feature.

### Active Trades — dynamic tile grouping

**Behaviour**: Positions are grouped by `ticker + direction` in the Active Trades panel. One tile per open position, not one tile per trade record.

**When a position has multiple open legs** (original entry + one or more add-ons):

- **Parent row** (always visible): aggregated across all legs
  - Ticker + direction badge
  - Combined unrealised P&L (sum of all legs)
  - Combined P&L % (weighted by position size)
  - Combined R-multiple (weighted)
  - Combined risk % of portfolio
- **Child rows** (indented, visually muted): one per individual trade record
  - Per-leg unrealised P&L
  - Per-leg P&L %
  - Per-leg R-multiple
  - Per-leg risk contribution
  - Visual treatment: left-indented, reduced opacity relative to parent, preceded by an arrow-down (↳) indicator showing attachment to parent

**Current state (post-Stage-0)**: The rerouted Active Trades panel shows one tile per trade record, so add-ons appear as separate equal-weight tiles. This is a regression from the previous UX.

**Why deferred to Stage 2**: The grouping logic depends on knowing which trade records belong to the same open position. That source-of-truth comes from `/equity/positions` reconciliation, which is the core of Stage 2. Implementing grouping before Stage 2 would require replicating fragile fill-math logic that Stage 2 replaces.

**Stage 2 implementation notes**:
- Group by `(normalizedTicker, direction)` — not by raw T212 ticker format
- A position with a single leg renders as parent only (no children, no expand affordance)
- A position with N ≥ 2 legs renders as collapsed parent by default; click/tap expands children
- Parent metrics must recompute when any child leg changes (live poll refresh)
- Child sort order: chronological by `entryDate` ascending (oldest leg first)

**Screenshot**: [attach screenshot showing parent + child tile layout — user provided reference 2026-04-20]
