#!/usr/bin/env node
const fs = require('fs');
const { spawn } = require('child_process');

const port = Number(process.env.BENCH_PORT || 4111);
const dataFile = process.env.BENCH_DATA_FILE || '/tmp/plc-bench.json';
const samples = Number(process.env.BENCH_SAMPLES || 3);
const tradeCount = Number(process.env.BENCH_TRADES || 1200);

function seed() {
  const username = 'bench';
  const token = 'bench-token';
  const db = { users: {}, sessions: { [token]: username } };
  const tradeJournal = {};
  for (let i = 0; i < tradeCount; i += 1) {
    const day = `2026-02-${String((i % 28) + 1).padStart(2, '0')}`;
    tradeJournal[day] ||= [];
    tradeJournal[day].push({
      id: `t${i}`,
      entry: 100 + (i % 15),
      stop: 95 + (i % 15),
      riskPct: 1,
      sizeUnits: 10 + (i % 3),
      symbol: i % 2 ? 'AAPL_US_EQ' : 'MSFT_US_EQ',
      trading212Ticker: i % 2 ? 'AAPL_US_EQ' : 'MSFT_US_EQ',
      trading212Name: i % 2 ? 'Apple Inc' : 'Microsoft Corp',
      trading212InstrumentType: 'EQUITY',
      trading212Exchange: 'NASDAQ',
      currency: 'USD',
      status: i % 3 === 0 ? 'closed' : 'open',
      openDate: day,
      source: 'trading212'
    });
  }
  db.users[username] = {
    username,
    passwordHash: 'x',
    portfolio: 100000,
    initialPortfolio: 100000,
    initialNetDeposits: 0,
    profileComplete: true,
    portfolioHistory: { '2026-02': { '2026-02-01': { end: 100000, cashIn: 0, cashOut: 0 } } },
    tradeJournal,
    trading212: {},
    security: {}
  };
  fs.writeFileSync(dataFile, JSON.stringify(db));
  return { username, token };
}

async function run() {
  const { token } = seed();
  const env = { ...process.env, DATA_FILE: dataFile, SKIP_RATE_FETCH: 'true', PORT: String(port) };
  const server = spawn('node', ['server.js'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const healthDeadline = Date.now() + 20000;
  let healthy = false;
  while (!healthy && Date.now() < healthDeadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      healthy = response.ok;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  if (!healthy) {
    throw new Error('Server boot timeout');
  }

  const base = `http://127.0.0.1:${port}`;
  const headers = { cookie: `auth_token=${token}` };
  const endpoints = ['/api/pl?debugPerf=1', '/api/portfolio?debugPerf=1', '/api/trades?debugPerf=1', '/api/trades/active?debugPerf=1'];
  const results = {};

  for (const endpoint of endpoints) {
    results[endpoint] = [];
    for (let i = 0; i < samples; i += 1) {
      const started = Date.now();
      const response = await fetch(`${base}${endpoint}`, { headers });
      const payload = await response.json();
      results[endpoint].push({
        httpMs: Date.now() - started,
        status: response.status,
        performance: payload.performance || null
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));
  server.kill('SIGTERM');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
