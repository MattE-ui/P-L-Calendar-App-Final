# P&L Calendar App

This project provides a profit & loss tracking calendar with multi-scale views and built-in GBP/USD currency conversion.

## Features
- Secure username-based sign-up/login with bcrypt-hashed passwords, strong password requirements, and HTTP-only cookies.
- Prompt new users to record their opening portfolio value and cumulative net deposits immediately after sign-in, and allow edits from the dashboard thereafter.
- Record daily portfolio values while separately tracking net deposits/withdrawals so both the evolving balance and cash-adjusted performance remain visible at a glance.
- Attach optional notes to individual calendar days and surface them across daily and monthly views for added context.
- Surface lifetime summary cards that highlight the current balance, cumulative net deposits, and performance excluding cash movements in both GBP and USD.
- Log same-day deposits or withdrawals alongside each portfolio value so cash movements adjust the balance without inflating profit/loss figures.
- Optionally connect a Trading 212 account to automate daily portfolio snapshots and cash adjustments at a time you choose.
- Reset and permanently delete all stored data (including persistent disk records) from the profile page when you need a clean start.
- Update your password directly from the profile page once you’re logged in.
- Size trades with the built-in risk calculator (choose GBP or USD) that uses your current portfolio value, chosen entry/stop-loss, and desired risk percentage.
- Journal trades straight from the calculator into any calendar day (defaulting to today) and view the trade count per day without cluttering the grid.
- Track active trades with live market pricing (GBP/USD aware), show open PnL that rolls into your live portfolio total, and close trades with recorded fills.
- Toggle between day, week, month, and year summaries.
- View data in GBP or USD using exchange rates fetched from the Open ER API and cached on the server.

## Getting Started
1. Install Node.js 22.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Visit [http://localhost:3000](http://localhost:3000) and use the **Sign Up** button to create an account with a unique username and strong password.
5. After logging in for the first time, complete the profile setup form by entering your current portfolio value and lifetime net deposits (numeric values are required) so the calendar can separate performance from cash movements.

## Risk calculator
- Open the dashboard (main calendar page) and scroll to the **Risk calculator** card.
- Enter your planned entry price, stop-loss price, and the percentage of your portfolio you’re willing to risk on the trade.
- Toggle the calculator currency between **GBP** and **USD** (independent of the portfolio display currency) to match the instrument you’re sizing.
- The calculator uses your current portfolio balance to show:
  - How much capital is at risk for the trade.
  - The number of fractional shares/units to buy.
  - The position size at the entry price.
- Add an optional trade note and click **Save trade to calendar** to log the trade on today or a past date. The calendar shows how many trades were taken per day; click a day to view full trade details alongside portfolio entries.
- Adjust the inputs as needed; the figures update instantly and stay in sync with your latest recorded portfolio value.

## Live pricing & active trades
- The dashboard now shows an **Active trades** card listing all open trades with live market prices and open PnL. Live open PnL is added to your recorded portfolio to present a “live” total in the key metrics.
- When logging a trade, include the ticker so the server can pull prices (defaults to Yahoo Finance; override with `MARKET_DATA_URL` if needed).
- To close a trade, enter the fill price and date in the Active trades card and hit **Close trade**. Closed trades stay in the journal for history while being removed from the live PnL tally.

## Account security
- Usernames are unique and must not contain spaces; passwords must be at least 12 characters long and include upper-case, lower-case, numeric, and symbol characters.
- All passwords are hashed with bcrypt and stored server-side; authentication cookies are HTTP-only.
- You can update your password from the profile page at any time by supplying your current password and a new strong password. Updates take effect immediately—there is no email approval step.

## Trading 212 automation
1. Visit the profile page (link in the header) and scroll to the **Trading 212 automation** card.
2. Enable the toggle, paste your Trading 212 API key **and API secret**, pick whether you’re syncing a live or practice account (the server will still probe both sets of Trading 212 hosts if the selection is wrong), and choose the time of day (Europe/London) to record the snapshot.
3. When creating the API key inside Trading 212, enable the toggles for **Portfolio value**, **Balance & cash**, and **Transactions** so the integration can fetch balances and cash movements. The Trading 212 UI will show both a key (username) and secret (password)—copy both.
4. Optional: provide a custom API base URL or endpoint path if Trading 212 instructs you to use a different hostname/path (the defaults cover the documented live and practice hosts). The integration remembers the last successful combination and surfaces it on the profile page.
5. Save your settings. The server will call Trading 212 at the scheduled time each day, record the closing portfolio value, and apply any deposits or withdrawals as cash adjustments on your calendar. Use **Run sync now** to trigger an immediate test pull.

The backend authenticates with Trading 212 using HTTP Basic auth, sending your API key as the username and the API secret as the password exactly as required by their documentation. Credentials are stored encrypted-at-rest in the server data store (by default `storage/data.json`) and never returned to the browser after the initial save.

If Trading 212 responds with **404**, double-check that the account type (live vs. practice) you selected matches the key you generated and that the permissions above were granted. The integration will automatically fan out across the documented live and practice hosts and a wider set of portfolio-summary endpoints (plus any custom URL/path you provide) before surfacing the error, and shows which combination failed in the profile status. A **429** rate-limit response places the integration in a short cooldown and the profile page will show how long to wait before retrying.

## Interactive Brokers (IBKR) integration
The IBKR integration uses the official Client Portal Gateway and IBKR Client Portal Web API (CPAPI v1). Authentication is manual (username/password + 2FA) and cannot be automated.

1. Start the gateway service (recommended via Docker). The backend talks to `IBKR_API_BASE_URL` (default `http://localhost:5000/v1/api`) and exposes a protected proxy route for the login UI at `/api/integrations/ibkr/gateway`.
2. Open the **Interactive Brokers (IBKR)** card on the profile page, toggle **Enable IBKR sync**, and click **Start session**.
3. Complete your IBKR login + 2FA in the gateway window (manual step). Once authenticated, return and click **Check session**.
4. Pick the account ID if multiple accounts are returned, then click **Sync now** to pull portfolio value, positions, and stop orders.

Environment variables:
- `IBKR_API_BASE_URL`: Client Portal Web API base URL (default `http://localhost:5000/v1/api`).
- `IBKR_GATEWAY_URL`: Gateway UI base URL for the authenticated proxy (defaults to the host of `IBKR_API_BASE_URL`).
- `IBKR_TOKEN_SECRET`: Secret used to encrypt OAuth tokens at rest (required if you enable OAuth mode).
- `IBKR_CACHE_TTL_MS`: Optional cache TTL for IBKR polling (default `15000`).
- `IBKR_RATE_LIMIT_MAX` / `IBKR_RATE_LIMIT_WINDOW_MS`: Optional rate-limit controls for IBKR endpoints.

Optional Docker compose snippet for the Client Portal Gateway:

```yaml
services:
  ibkr-gateway:
    image: ghcr.io/interactivate-brokers/ib-gateway:latest
    ports:
      - "5000:5000"
    environment:
      - TZ=Europe/London
    restart: unless-stopped
```

The gateway should be deployed on the same private network as this app. Do **not** expose it publicly without authentication—use the built-in `/api/integrations/ibkr/gateway` proxy or place it behind your own auth-aware reverse proxy.

## Persisted Data
User accounts, sessions, and P&L entries are stored in a JSON file whose location you can configure:

- By default the app reads and writes `storage/data.json` (the directory is created automatically on boot).
- Set the `DATA_DIR` environment variable to a directory mounted on persistent storage (for example `/var/data/pl-calendar`) to keep data across redeploys, or set `DATA_FILE` to point to an explicit file path.
- On Render, create a [Persistent Disk](https://render.com/docs/persistent-disks), mount it at a path such as `/var/data`, and set `DATA_DIR=/var/data/pl-calendar` in the service environment so user records survive code pushes and restarts.
- Guest sessions expire automatically; configure the TTL with `GUEST_TTL_HOURS` (defaults to 24 hours).

When the new location is empty the server will migrate any legacy `data.json` file that shipped with earlier versions so existing installs retain their data.

## Resetting your data
- Open the **Profile** page and scroll to the **Reset your data** card.
- Review the warning, then choose **Delete everything** to remove your account, portfolio history, cash adjustments, and Trading 212 credentials.
- The server wipes your record from the persistent data store immediately; you’ll be redirected to sign up again if you want to create a fresh account.

## Deploying / Pushing to GitHub
All changes currently live on the local `work` branch. To publish them to your GitHub repository, push the branch from your machine or a Codespaces/CI session:

```bash
git push origin work
```

You can then merge the branch into your default branch on GitHub via pull request or fast-forward merge.

## Branches & Merging
The active development branch is `work`, which already contains the latest portfolio-value workflow. To merge it into your main branch locally:

```bash
git checkout work
git pull
git checkout main
git merge work
```

If Git reports conflicts, keep the versions that reference **recording daily portfolio values** (rather than entering raw profit/loss numbers) so the docs and UI stay aligned. Once everything looks correct, finish with:

```bash
git push origin main
```
