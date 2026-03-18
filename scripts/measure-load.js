#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

async function main() {
  const root = path.resolve(__dirname, '..');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plc-perf-'));
  const dbPath = path.join(tmpDir, 'data.json');
  const username = 'perf-user';
  const token = 'perf-token';
  const port = Number(process.env.PERF_PORT || 3199);
  const day = '2026-03-01';
  const journal = {};
  journal[day] = [];
  for (let i = 0; i < 3500; i += 1) {
    const idx = i % 6;
    journal[day].push({
      id: crypto.randomUUID(),
      symbol: ['SOI', 'YNDX', 'RCAT', 'LWLG', 'AMPX', 'TSLA'][idx],
      displaySymbol: ['SOI', 'YNDX', 'RCAT', 'LWLG', 'AMPX', 'TSLA'][idx],
      trading212Ticker: ['SOI_US_EQ', 'YNDX_US_EQ', 'RCAT_US_EQ', 'LWLG_US_EQ', 'AMPX_US_EQ', 'TSLA_US_EQ'][idx],
      trading212Isin: ['US78497K1025', 'NL0009805522', 'US75618M3051', 'US53195Q1040', 'US03214Q1085', 'US88160R1014'][idx],
      trading212Name: ['SEI Investments Company', 'Nebius Group N.V.', 'Red Cat', 'Lightwave Logic', 'Ampx', 'Tesla'][idx],
      source: 'trading212',
      status: i % 4 === 0 ? 'closed' : 'open',
      openDate: day,
      createdAt: `${day}T12:00:00.000Z`,
      entry: 10 + (i % 15),
      sizeUnits: 10,
      currency: 'USD',
      stop: 9,
      lastSyncPrice: 11,
      direction: 'long',
      riskPct: 1,
      positionGBP: 100,
      riskAmountGBP: 1,
      guaranteedPnlGBP: 2,
      realizedPnlGBP: i % 4 === 0 ? 5 : 0
    });
  }
  const db = {
    users: {
      [username]: {
        username,
        password: 'x',
        profileComplete: true,
        portfolio: 100000,
        initialPortfolio: 80000,
        tradeJournal: journal,
        portfolioHistory: { '2026-03': { [day]: { end: 100000 } } }
      }
    },
    sessions: { [token]: username },
    instrumentMappings: [
      { id: 1, source: 'TRADING212', broker: 'trading212', source_key: 'TRADING212|ISIN:US78497K1025', scope: 'global', status: 'active', resolution_status: 'resolved', resolution_source: 'local_cache', confidence_score: 0.98, canonical_ticker: 'SOI', raw_ticker: 'SOI_US_EQ', raw_isin: 'US78497K1025' },
      { id: 2, source: 'TRADING212', broker: 'trading212', source_key: 'TRADING212|ISIN:NL0009805522', scope: 'global', status: 'active', resolution_status: 'resolved', resolution_source: 'local_cache', confidence_score: 0.98, canonical_ticker: 'YNDX', raw_ticker: 'YNDX_US_EQ', raw_isin: 'NL0009805522' }
    ],
    instrumentResolutionMetrics: [],
    t212MetadataCache: []
  };
  fs.writeFileSync(dbPath, JSON.stringify(db));

  process.env.DB_PATH = dbPath;
  process.env.PORT = String(port);
  process.env.SKIP_RATE_FETCH = 'true';
  const { app } = require(path.join(root, 'server.js'));
  const server = app.listen(port);

  async function call(url) {
    const start = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      headers: { Cookie: `auth_token=${token}` }
    });
    const elapsed = Date.now() - start;
    const json = await res.json();
    return { elapsed, status: res.status, json };
  }

  const endpoints = ['/api/pl?debugPerf=1', '/api/portfolio?debugPerf=1', '/api/trades/active?debugPerf=1'];
  const dashStart = Date.now();
  const dashResults = await Promise.all(endpoints.map(call));
  const dashboardTotal = Date.now() - dashStart;

  const trades = await call('/api/trades?debugPerf=1');

  console.log(JSON.stringify({
    dashboard: {
      totalMs: dashboardTotal,
      requests: endpoints.map((ep, i) => ({ endpoint: ep, elapsedMs: dashResults[i].elapsed, perf: dashResults[i].json.performance }))
    },
    trades: {
      totalMs: trades.elapsed,
      perf: trades.json.performance
    }
  }, null, 2));

  await new Promise(resolve => server.close(resolve));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
