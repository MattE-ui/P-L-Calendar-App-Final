/* eslint-disable no-console */
import axios, { AxiosInstance } from "axios";
import https from "https";
import fs from "fs";
import path from "path";
import os from "os";

type ConnectorConfig = {
  connectorKey: string;
};

const CONFIG_DIR = path.join(os.homedir(), ".veracity");
const CONFIG_FILE = path.join(CONFIG_DIR, "ibkr-connector.json");

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadConfig(): ConnectorConfig | null {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.connectorKey === "string" && parsed.connectorKey.length > 0) {
      return { connectorKey: parsed.connectorKey };
    }
    return null;
  } catch {
    return null;
  }
}

function saveConfig(cfg: ConnectorConfig) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

function createHttpClient(baseURL: string, insecure: boolean): AxiosInstance {
  const agent =
    baseURL.startsWith("https://")
      ? new https.Agent({ rejectUnauthorized: !insecure })
      : undefined;

  return axios.create({
    baseURL,
    timeout: 15000,
    httpsAgent: agent,
  });
}

/* -------------------- SUMMARY HELPERS -------------------- */

function getSummaryFieldAmount(summary: any, key: string): number | null {
  const v = summary?.[key];
  if (!v) return null;

  if (typeof v.amount === "number") return v.amount;

  if (typeof v.value === "string") {
    const n = Number(v.value);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function getSummaryFieldCurrency(summary: any, key: string): string | null {
  const v = summary?.[key];
  if (!v) return null;
  if (typeof v.currency === "string" && v.currency) return v.currency;
  return null;
}

/* -------------------- IBKR SNAPSHOT -------------------- */

async function fetchSnapshot(ibkr: AxiosInstance, accountId: string) {
  // Summary
  const summaryRes = await ibkr.get(`/v1/api/portfolio/${accountId}/summary`);
  const summary = summaryRes.data;

  const netLiq =
    getSummaryFieldAmount(summary, "netliquidation") ??
    getSummaryFieldAmount(summary, "equitywithloanvalue") ??
    getSummaryFieldAmount(summary, "totalcashvalue");

  const rootCurrency =
    getSummaryFieldCurrency(summary, "netliquidation") ??
    getSummaryFieldCurrency(summary, "equitywithloanvalue") ??
    getSummaryFieldCurrency(summary, "totalcashvalue") ??
    "UNKNOWN";

  if (netLiq == null) {
    console.warn(
      "Net liquidation value not available from IBKR summary; skipping snapshot this cycle."
    );
    return null;
  }

  // Positions
  const positionsRes = await ibkr.get(`/v1/api/portfolio2/${accountId}/positions`);
  const positions = Array.isArray(positionsRes.data) ? positionsRes.data : [];

  // Orders
  const ordersRes = await ibkr.get(`/v1/api/iserver/account/orders`);
  const rawOrders = ordersRes.data;

  const orders: any[] = [];
  if (Array.isArray(rawOrders)) {
    orders.push(...rawOrders);
  } else if (Array.isArray(rawOrders?.orders)) {
    for (const o of rawOrders.orders) {
      if (Array.isArray(o.orders)) orders.push(...o.orders);
      else orders.push(o);
    }
  }

  return {
    ts: Date.now(),
    accountId,
    portfolioValue: netLiq,
    rootCurrency,
    positions,
    orders,
    meta: {
      rootCurrencySource: rootCurrency !== "UNKNOWN" ? "portfolio/summary" : "unknown",
      currencyConfidence: rootCurrency !== "UNKNOWN" ? "high" : "low",
    },
  };
}

/* -------------------- MAIN -------------------- */

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const server = getArg("--server");
  const gateway = getArg("--gateway") || "https://localhost:5000";
  const token = getArg("--token");
  const pollSeconds = Number(getArg("--pollSeconds") || "15");
  const insecure = args.includes("--insecure");

  if (!server) {
    console.error("Missing --server");
    process.exit(1);
  }

  const ibkr = createHttpClient(gateway, insecure);
  const veracity = createHttpClient(server, false);

  let cfg = loadConfig();

  // If we already have a connectorKey, we do NOT need the one-time token again.
  if (cfg?.connectorKey) {
    console.log("Using stored connectorKey for Veracity auth.");
  } else {
    console.log("No stored connectorKey; will exchange one-time token.");
    if (!token) {
      console.error("No connectorKey found. Generate a token on the site and run again with --token.");
      process.exit(1);
    }

    const res = await veracity.post(
      "/api/integrations/ibkr/connector/exchange",
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const connectorKey = res?.data?.connectorKey;
    if (typeof connectorKey !== "string" || connectorKey.length === 0) {
      throw new Error("Exchange did not return a connectorKey.");
    }

    cfg = { connectorKey };
    saveConfig(cfg);

    console.log("Connector key exchanged and saved to:", CONFIG_FILE);
  }

  if (!cfg?.connectorKey) {
    console.error("No connectorKey available after exchange/load.");
    process.exit(1);
  }

  const authHeaders = {
    Authorization: `Bearer ${cfg.connectorKey}`,
  };

  // Fast self-test so we fail immediately if auth is broken.
  try {
    const hb = await veracity.post(
      "/api/integrations/ibkr/connector/heartbeat",
      { status: "online" },
      { headers: authHeaders }
    );
    if (hb.status !== 200) {
      console.warn("Heartbeat self-test returned non-200:", hb.status);
    } else {
      console.log("Heartbeat self-test OK.");
    }
  } catch (e: any) {
    const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e));
    throw new Error(`Heartbeat self-test failed. ${msg}`);
  }

  console.log(`Veracity IBKR connector running. Gateway=${gateway} Server=${server}`);

  let veracityBackoffMs = 0;

  while (true) {
    try {
      // Auth status
      const auth = await ibkr.get("/v1/api/iserver/auth/status");
      if (!auth.data?.authenticated) {
        console.warn(
          "IBKR session not authenticated. Open https://localhost:5000 and login/2FA in Client Portal Gateway."
        );
        await sleep(pollSeconds * 1000);
        continue;
      }

      // Keepalive
      await ibkr.post("/v1/api/tickle");

      // Accounts
      const accountsRes = await ibkr.get("/v1/api/portfolio/accounts");
      const accountId = Array.isArray(accountsRes.data) ? accountsRes.data[0] : null;

      if (!accountId) {
        console.warn("No IBKR accountId found.");
        await sleep(pollSeconds * 1000);
        continue;
      }

      // Snapshot
      const snapshot = await fetchSnapshot(ibkr, accountId);
      if (!snapshot) {
        console.log("Snapshot not available this cycle; will retry.");
        await sleep(pollSeconds * 1000);
        continue;
      }

      // Heartbeat (always connectorKey auth)
      await veracity.post(
        "/api/integrations/ibkr/connector/heartbeat",
        { status: "online" },
        { headers: authHeaders }
      );

      // Snapshot push (always connectorKey auth)
      await veracity.post(
        "/api/integrations/ibkr/connector/snapshot",
        snapshot,
        { headers: authHeaders }
      );

      veracityBackoffMs = 0;
    } catch (sendError: any) {
      veracityBackoffMs = veracityBackoffMs ? Math.min(veracityBackoffMs * 2, 60000) : 2000;

      const errMsg =
        sendError?.response?.data
          ? JSON.stringify(sendError.response.data)
          : sendError instanceof Error
          ? sendError.message
          : typeof sendError === "string"
          ? sendError
          : JSON.stringify(sendError);

      console.error("Veracity unreachable; backing off.", errMsg);

      await sleep(veracityBackoffMs);
    }

    await sleep(pollSeconds * 1000);
  }
}

main().catch(err => {
  console.error("Fatal connector error:", err);
  process.exit(1);
});
