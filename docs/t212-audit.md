# T212 Integration Audit — April 2026

Audit of current `server.js` T212 integration against the confirmed spec in `docs/t212-integration.md`.
Categories: **BREAK** (wrong, will fail), **MASK** (wrong, currently hiding itself), **FINE** (aligned with spec), **CALL** (unspecified, needs a decision).

---

## BREAK — Wrong and will break real functionality

### B1 — Portfolio summary endpoint default is wrong (`fetchTrading212Snapshot`)

**Location:** `server.js:6342`, `server.js:12392`

The DB normalisation step at line 6342 defaults `cfg.endpoint` to `/api/v0/equity/portfolio/summary`. The snapshot function at 12392 uses this as its first candidate. Per spec, the correct endpoint is `/api/v0/equity/account/summary`. `/equity/portfolio/summary` does not exist — T212 will return a 404 or redirect.

The fallback chain (11 candidates, lines 12392–12402) eventually includes the correct path at position 9. This means every sync burns 8 rate-limited requests before reaching a working endpoint. Under bursting conditions this will exhaust the per-account budget before the request succeeds.

**Fix:** Change the default `cfg.endpoint` to `/api/v0/equity/account/summary` and make it the first candidate. Remove the 10 speculative fallbacks or demote them to a one-time discovery mode.

---

### B2 — Portfolio value field extraction is pure speculation

**Location:** `server.js:12091–12153` (`requestTrading212Endpoint`)

After getting a response from `account/summary`, the code tries 23 field path candidates (e.g. `data.totalValue.value`, `data.portfolio.equity.amount`) to find `portfolioValue`. If none match, it falls back to `Math.max(...Object.values(account))` — i.e. picks the largest number in the response object.

The confirmed spec shape for `/equity/account/summary` is:
```
{ cash, invested, result, pieCash }
```
None of the 23 candidates match this shape. The `Math.max` fallback would likely return `invested` (total invested value), not `invested + cash` (the correct total). This causes a silently incorrect portfolio value.

**Fix:** Once probe confirms field names, replace with typed access: `data.cash + data.invested` (or whichever fields constitute the total). Remove the speculation candidates.

---

### B3 — `parseTrading212RateLimitHeaders` drops `period` and `used`

**Location:** `server.js:8840–8850`

```javascript
return {
  limit: toInt(headers?.['x-ratelimit-limit']),
  remaining: toInt(headers?.['x-ratelimit-remaining']),
  reset: toInt(headers?.['x-ratelimit-reset'])
  // missing: period, used
};
```

The spec documents 5 headers. `x-ratelimit-used` is dropped. `used` is the counter value that lets you calculate remaining budget accurately without trusting the `remaining` field. `period` tells you the window length per endpoint.

Without `used`, the Stage 0 client class cannot implement accurate proactive budget tracking. It can only react to 429s.

**Fix (Stage 0):** Add `period` and `used` to the parsed object. Use `used` + `limit` as the authoritative budget state.

---

### B4 — `TRADING212_LIST_ENDPOINT_THROTTLE_MS = 350` breaches orders rate limit

**Location:** `server.js:8637`, `server.js:10927`, `server.js:12689`, `server.js:12775`

The throttle constant (350ms) is used as the inter-page sleep during history orders pagination and between sync steps. The orders endpoint rate limit is 1 req/sec (1000ms). 350ms → ~2.8 req/sec → guaranteed 429s during any multi-page history fetch.

**Fix:** Increase to `1100` (10% headroom over 1000ms minimum). History orders may need a separate `TRADING212_HISTORY_ORDERS_THROTTLE_MS` given its lower limit (1 req/min per page at heavy load).

---

### B5 — `lastSyncAt` written on failure masks staleness

**Location:** `server.js:13575` (inside the sync error catch)

On sync failure, the catch block sets `cfg.lastSyncAt = new Date().toISOString()`. The portfolio source selector at line 10400 checks `isFreshTimestamp(tradingCfg.lastSyncAt, PORTFOLIO_SOURCE_T212_STALE_MS)`. Since `lastSyncAt` is refreshed on every attempt (including failed ones), a permanently failing account appears "fresh" for 36 hours after the last failure. The UI will show stale data labelled as current.

**Fix:** Write `lastSyncAt` only on success. On failure, write `lastSyncFailedAt` instead. The staleness check should use `lastSuccessfulSyncAt` (which already exists at line 13521).

---

## MASK — Wrong but currently hiding itself

### M1 — Snapshot endpoint fallback chain accidentally works

The fallback chain (B1) eventually includes `/api/v0/equity/account/summary` at position 9. So in practice, sync succeeds after burning 8 extra requests. The current user's account survives because the rate limit budget is large enough (240 req/min on some endpoints) that 8 wasted probes don't exhaust it during testing. Under concurrent multi-account sync this may stop masking.

---

### M2 — `normalizeTrading212Symbol` digit stripping

**Location:** `server.js:8593`

```javascript
const cleaned = core.replace(/\d+/g, '');
return cleaned || '';
```

Strips all digits from the ticker after splitting on `_`. US equity tickers are alpha-only so this is silent today. Would corrupt tickers like `1318.HK` → `'' ` (returned as empty string, then dropped). Not currently triggered but wrong in principle. If T212 ever returns non-US instruments this silently drops them.

**Fix (low priority):** Remove the digit strip. The split-on-`_`-take-first is sufficient for T212's `SYMBOL_REGION_CLASS` format.

---

### M3 — Positions response shape assumes `items` or raw array

**Location:** `server.js:12358`, `server.js:12435`

```javascript
const list = Array.isArray(payload) ? payload : payload?.items || payload?.positions;
```

T212 positions response shape is `{ items: [...] }` per spec. The code handles this correctly. The fallback to raw array and `.positions` key is redundant but harmless if the spec shape is right. If the spec is wrong (e.g. it's actually a bare array), the `payload?.items` branch returns `undefined` and the code falls through to throw — masked today by the spec being correct.

---

### M4 — `x-ratelimit-reset` used as cooldown seconds in 429 path

**Location:** `server.js:12196`

```javascript
const headerResetSeconds = Number.isFinite(rateLimitHeaders.reset) ? rateLimitHeaders.reset : null;
const effectiveRetryAfter = headerResetSeconds !== null && headerResetSeconds > 0 ? headerResetSeconds : retryAfter;
```

`x-ratelimit-reset` in the spec is a Unix epoch timestamp (seconds since 1970), not a "seconds until reset" duration. Using it as a cooldown duration would cause a multi-decade sleep on any 429. This is masked because: (a) 429s are thrown immediately (no retry in the rate-limit branch) so `effectiveRetryAfter` feeds `cfg.cooldownUntil` calculation at 13578 — which would then be absurd. In practice 429s have been rare so this path hasn't fired.

**Fix:** When epoch is needed, compute `reset - Math.floor(Date.now() / 1000)` to get seconds-until-reset.

---

## FINE — Aligned with spec

| Item | Location | Notes |
|---|---|---|
| Auth header construction | `server.js:8619–8631` | Correct: `Basic base64(key:secret)` |
| AES-256-GCM credential encryption | `server.js:8364–8393` | Correct. IV + GCM auth tag + ciphertext pattern. |
| `BROKER_CREDENTIAL_SECRET` key derivation | `server.js:274` | Falls back to `SESSION_SECRET`. Acceptable. |
| 429 handling — no retry | `server.js:12064`, `12202` | Throws immediately. Correct per spec. |
| Auth failure — no retry | `server.js:12066–12068` | Throws immediately. Correct. |
| Network error retry + backoff | `server.js:12040–12047` | 3 attempts, exponential sleep. Fine. |
| `[T212][upstream]` log on every call | `server.js:12057`, `12192` | Logs limit/remaining/reset. Good observability. |
| `TRADING212_SYNC_MIN_INTERVALS_MS.summary = 8000` | `server.js:8640` | Conservative (8s vs 5s spec minimum). Fine. |
| `PORTFOLIO_SOURCE_T212_STALE_MS = 36h` | `server.js:207` | Reasonable staleness window. |
| Positions first candidate is correct path | `server.js:12347` | `/equity/positions` is first — succeeds immediately if endpoint is correct. |
| `lastDataSource = 'cached_db'` on failure | `server.js:13597` | Journal not cleared on failure. Correct. |
| `resolveTrading212BaseUrl` + mode switch | `server.js:8611–8616` | Correctly maps `practice` vs `live` to different base URLs. |
| Phantom-exit log `[t212-ingest][phantom-exit-candidate]` | `server.js` (added this session) | Correct placement and fields. |
| Reconciliation endpoint (admin-only, read-only) | `server.js` (added this session) | Correct scope and reason codes. |

---

## CALL — Unspecified, needs a decision

### C1 — Confirmed field names from `account/summary`

Until the probe lands, the exact fields in the `account/summary` response are unknown. The spec lists `{ cash, invested, result, pieCash }` but this is unverified. The correct `portfolioValue` formula (cash + invested? total only? include pie?) needs a decision before B2 can be fixed.

**Decision needed:** What constitutes total portfolio value from `account/summary`? Is it `cash + invested`, or is there an explicit total field?

---

### C2 — Multi-account sync parallelism

When a user has multiple T212 accounts, are syncs run in parallel or serial? T212 rate limits are per-account, so parallel is safe from a limit perspective. But if the current code runs them concurrently with the same lock key, requests could interleave unexpectedly.

**Decision needed:** Confirm whether `TRADING212_ACCOUNT_LOCKS` scopes per-account or per-user. If per-user, parallel accounts serialize unnecessarily. If not locking, risk of concurrent mutations.

---

### C3 — `TRADING212_ORDERS_CACHE_MS = 20000`

Orders cache TTL is 20 seconds. The orders endpoint is 1 req/sec. A 20s cache means at most 1 req per 20s per account — very conservative. If the ingest pipeline calls orders + history orders in sequence for multiple trades, the cache prevents duplicate requests but may return stale order state within a 20s window during rapid trading. Acceptable risk?

**Decision needed:** Is 20s orders cache TTL acceptable for the ingest pipeline's accuracy requirements?

---

### C4 — Transaction endpoints are pure speculation

`fetchTrading212Snapshot` fetches transactions from 6 candidate paths (lines 12417–12423). The spec does not document a transactions endpoint. If none of these paths exist, the sync continues without transaction data (no throw). Is transaction data used anywhere in the ingest pipeline, or is it vestigial?

**Decision needed:** Audit `transactionsRaw` usage. If unused, remove the 6-candidate transaction probe entirely.

---

### C5 — `legacyApiKeyHeader` — old API format?

The spec notes reference a `legacyApiKeyHeader` in the codebase. If this is a `Authorization: Bearer {key}` fallback for old T212 API keys (pre-Basic-auth), it may conflict with the confirmed Basic auth requirement.

**Decision needed:** Grep for `legacyApiKeyHeader` usage. If it's a fallback path that overrides Basic auth headers, it could silently send malformed credentials.

---

## Ticker normalisation — all locations

| Location | What it does | Risk |
|---|---|---|
| `normalizeTrading212Symbol()` line ~8593 | Splits on `_`, takes first segment, strips digits, maps FB→META | Digit strip is wrong (M2) |
| `normalizeTrading212TickerValue()` (called by above) | Pre-processing step before `normalizeTrading212Symbol` — likely trims/uppercases | Low |
| `resolveCanonicalTickerForTrade()` line ~1416 | Fallback chain: `displayTicker → displaySymbol → symbol → normalizeTrading212Symbol(normalizeTrading212TickerValue(trade.trading212Ticker))` | Correct fallback order |
| T212 ingest legs | Each execution leg carries `trading212Ticker`; `normalizeTrading212Symbol` called at leg resolution time | Same digit-strip risk |

The normalisation is not centralised at the boundary — it's called at multiple points in the ingest pipeline. A Stage 0 client class should normalise at the response-parsing layer so downstream code receives clean tickers.

---

## Rate limit header tracking — summary

The code logs `limit/remaining/reset` on every upstream call and reads `reset` for 429 cooldown. It does NOT:
- Track remaining budget proactively across calls
- Queue requests when budget is near-zero
- Use `used` or `period` headers
- Expose per-endpoint budget state to the sync scheduler (it has `endpointState.rateLimit` but this is only updated via `recordTrading212EndpointAttempt`, not driving scheduling decisions)

This is sufficient for the current reactive model (retry on 429). It is insufficient for Stage 0's proactive budget management goal.

---

## Reconciliation endpoint — design inventory

`GET /api/admin/trade-reconciliation` (added this session):
- Admin-only, authenticated
- Iterates all users' trades
- Reports per-trade: `positionState`, `wouldBeActive`, `isStoredOpen`, `canonicallyClosed`
- Reason codes: `canonically_closed_flag_set_but_status_is_open`, `invalid_execution_state_exits_exceed_entries`, `computed_open_qty_not_positive`, `canonically_closed`
- Reports IBKR positions not in journal
- Logs `[trade-reconciliation] report_generated` on each call

No mutations. Output is purely diagnostic. Ready to use.

---

## Priority order for fixes

When not blocked on probe:

1. **B4** (throttle) — safe to fix now, no probe dependency. Change `TRADING212_LIST_ENDPOINT_THROTTLE_MS` to 1100.
2. **B5** (staleness mask) — safe to fix now. Write `lastSyncAt` only on success; change staleness check to use `lastSuccessfulSyncAt`.
3. **M4** (reset timestamp vs duration) — fix the epoch-to-duration conversion now.
4. **M2** (digit strip) — remove `replace(/\d+/g, '')`, low risk.
5. **B3** (missing headers) — fix `parseTrading212RateLimitHeaders` to include `period` and `used`. No functional change until Stage 0 consumes them.
6. **B1 + B2** (wrong endpoint default + field extraction) — blocked on probe. Fix after confirmed shapes.
7. **C4** (transaction probe) — audit `transactionsRaw` usage, then remove if vestigial.
8. **C5** (legacyApiKeyHeader) — grep and assess.
