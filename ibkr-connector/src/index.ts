import axios, { AxiosInstance } from 'axios';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';

const args = process.argv.slice(2);
const getArg = (flag: string, fallback: string | null = null) => {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
};

const server = getArg('--server', process.env.VERACITY_SERVER || '') || '';
const token = getArg('--token', process.env.VERACITY_CONNECTOR_TOKEN || '') || '';
const connectorKeyArg = getArg('--connector-key', process.env.VERACITY_CONNECTOR_KEY || '') || '';
const gateway = getArg('--gateway', process.env.IBKR_GATEWAY_URL || 'https://localhost:5000') || '';
const pollSecondsRaw = getArg('--pollSeconds', getArg('--poll', process.env.IBKR_POLL_INTERVAL || '15')) || '15';
const pollSeconds = Number(pollSecondsRaw) || 15;
const accountOverride = getArg('--account', process.env.IBKR_ACCOUNT_ID || '') || '';
const keyFileArg = getArg(
  '--key-file',
  process.env.VERACITY_CONNECTOR_KEY_FILE || path.join(os.homedir(), '.veracity', 'ibkr-connector.json')
) || '';
const insecure = args.includes('--insecure') || process.env.IBKR_INSECURE_TLS === '1';
const connectorVersion = process.env.VERACITY_CONNECTOR_VERSION || 'ibkr-connector';

const loadStoredConnectorKey = () => {
  if (!keyFileArg || !fs.existsSync(keyFileArg)) return '';
  try {
    const raw = fs.readFileSync(keyFileArg, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.connectorKey === 'string') {
      return parsed.connectorKey;
    }
  } catch (error) {
    console.warn('Unable to read stored connector key.', error);
  }
  return '';
};

const storeConnectorKey = (connectorKey: string) => {
  if (!keyFileArg) return;
  const dir = path.dirname(keyFileArg);
  fs.mkdirSync(dir, { recursive: true });
  const payload = { connectorKey, storedAt: new Date().toISOString() };
  fs.writeFileSync(keyFileArg, JSON.stringify(payload, null, 2), 'utf8');
};

let connectorKey = connectorKeyArg || loadStoredConnectorKey();

if (!server || (!token && !connectorKey)) {
  console.error('Missing required --server and either --token or --connector-key.');
  process.exit(1);
}

const normalizeGateway = gateway.replace(/\/+$/, '');
const ibkrApiBase = `${normalizeGateway}/v1/api`;

const createHttpClient = ({ baseURL, insecureTls }: { baseURL: string; insecureTls: boolean }) => {
  const config: { baseURL: string; timeout: number; httpsAgent?: https.Agent } = {
    baseURL,
    timeout: 10000
  };
  if (baseURL.startsWith('https://') && insecureTls) {
    config.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }
  return axios.create(config);
};

const connectorClient: AxiosInstance = createHttpClient({
  baseURL: server.replace(/\/+$/, ''),
  insecureTls: false
});

const ibkrClient: AxiosInstance = createHttpClient({
  baseURL: ibkrApiBase,
  insecureTls: insecure
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const normalizePosition = (raw: any) => {
  const ticker = String(raw?.ticker || raw?.symbol || raw?.contract?.symbol || raw?.contractDesc || '').trim();
  const units = Number(raw?.position ?? raw?.quantity ?? raw?.qty ?? raw?.units ?? raw?.size);
  const buyPrice = Number(raw?.avgPrice ?? raw?.avgCost ?? raw?.avgFillPrice ?? raw?.averagePrice);
  const pnlValue = Number(raw?.unrealizedPnl ?? raw?.unrealizedPnL ?? raw?.pnl ?? raw?.pnlUnrealized);
  const livePrice = Number(raw?.mktPrice ?? raw?.marketPrice ?? raw?.lastPrice ?? raw?.price);
  const currency = String(raw?.currency || raw?.asset?.currency || raw?.fxCurrency || 'USD').trim();
  const conid = raw?.conid ?? raw?.conidex ?? raw?.contract?.conid ?? raw?.contract?.conidex ?? '';
  if (!ticker || !Number.isFinite(units) || !Number.isFinite(buyPrice)) return null;
  return {
    ticker: ticker.toUpperCase(),
    units,
    buyPrice,
    pnlValue: Number.isFinite(pnlValue) ? pnlValue : null,
    currency,
    livePrice: Number.isFinite(livePrice) ? livePrice : null,
    conid: conid ? String(conid) : undefined
  };
};

const extractOrdersFromIserverResponse = (data: any): any[] => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.orders)) {
    const flattened = data.orders.flatMap((entry: any) => {
      if (Array.isArray(entry?.orders)) return entry.orders;
      return entry;
    });
    return flattened.filter(Boolean);
  }
  if (Array.isArray(data?.order)) return data.order;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

const normalizeOrderType = (raw: any) => String(raw ?? '').trim().toUpperCase();
const normalizeOrderStatus = (raw: any) => String(raw ?? '').trim().toUpperCase();
const normalizeOrderSide = (raw: any) => String(raw ?? '').trim().toUpperCase();

const isStopOrder = (orderType: string) => {
  const normalized = normalizeOrderType(orderType);
  return normalized.includes('STOP') || normalized.includes('STP');
};

const normalizeOrder = (raw: any) => {
  const ticker = String(raw?.ticker || raw?.symbol || raw?.contract?.symbol || raw?.contractDesc || raw?.listing || '').trim();
  const conid = raw?.conid ?? raw?.conidex ?? raw?.contract?.conid ?? raw?.contract?.conidex ?? '';
  const type = normalizeOrderType(raw?.orderType ?? raw?.orderTypeDesc ?? raw?.orderTypeId ?? raw?.type);
  const status = normalizeOrderStatus(raw?.status ?? raw?.orderStatus ?? raw?.state);
  const side = normalizeOrderSide(raw?.side ?? raw?.action ?? raw?.direction);
  const quantity = Number(raw?.totalQuantity ?? raw?.qty ?? raw?.quantity ?? raw?.size ?? raw?.orderSize);
  const stopPrice = Number(
    raw?.auxPrice
    ?? raw?.stopPrice
    ?? raw?.triggerPrice
    ?? raw?.stop
    ?? raw?.stopPriceLimit
  );
  const id = raw?.orderId ?? raw?.id ?? raw?.order_id ?? '';
  const createdAt = raw?.orderTime ?? raw?.createdTime ?? raw?.time ?? raw?.submittedTime ?? '';
  const tif = raw?.tif ?? raw?.timeInForce ?? raw?.tifType ?? '';
  if (!isStopOrder(type) || !Number.isFinite(stopPrice)) return null;
  return {
    id: id ? String(id) : undefined,
    ticker: ticker ? ticker.toUpperCase() : undefined,
    conid: conid ? String(conid) : undefined,
    type,
    status,
    side,
    quantity: Number.isFinite(quantity) ? quantity : undefined,
    stopPrice,
    createdAt,
    tif
  };
};

const extractRootCurrency = (summary: any, accounts: any[]) => {
  const candidates = [
    summary?.baseCurrency,
    summary?.currency,
    summary?.accountCurrency,
    summary?.acctCurrency
  ];
  if (summary?.baseCurrency) return { currency: String(summary.baseCurrency).trim().toUpperCase(), source: 'summary.baseCurrency' };
  if (summary?.currency) return { currency: String(summary.currency).trim().toUpperCase(), source: 'summary.currency' };
  if (Array.isArray(summary)) {
    const currencyRow = summary.find((entry: any) => String(entry?.tag || entry?.key || '').toUpperCase() === 'BASECURRENCY');
    if (currencyRow?.value) {
      return { currency: String(currencyRow.value).trim().toUpperCase(), source: 'summary.tag.BASECURRENCY' };
    }
  }
  for (const account of accounts || []) {
    if (account?.currency) return { currency: String(account.currency).trim().toUpperCase(), source: 'accounts.currency' };
    if (account?.baseCurrency) return { currency: String(account.baseCurrency).trim().toUpperCase(), source: 'accounts.baseCurrency' };
  }
  const value = candidates.find(item => typeof item === 'string' && item.trim());
  return { currency: value ? value.trim().toUpperCase() : 'USD', source: 'default' };
};

const extractAuthFlags = (payload: any) => ({
  authenticated: payload?.authenticated === true || payload?.isAuthenticated === true,
  connected: payload?.connected === true || payload?.brokerageSession === true
});

const fetchSnapshot = async () => {
  const accountsRes = await ibkrClient.get('/portfolio/accounts');
  const accounts = Array.isArray(accountsRes.data) ? accountsRes.data : accountsRes.data?.accounts || [];
  const accountId = accountOverride || accounts[0]?.accountId || accounts[0]?.id || accounts[0] || '';
  if (!accountId) {
    throw new Error('No IBKR account found.');
  }
  const summaryRes = await ibkrClient.get(`/portfolio/${accountId}/summary`);
  const summary = summaryRes.data;
  const netLiqEntry = Array.isArray(summary)
    ? summary.find((item: any) => String(item?.tag || '').toUpperCase() === 'NETLIQUIDATION')
    : null;
  const portfolioValue = Number(netLiqEntry?.value ?? summary?.NetLiquidation ?? summary?.netLiquidation);
  if (!Number.isFinite(portfolioValue)) {
    throw new Error('Net liquidation value missing from summary.');
  }
  const rootCurrencyMeta = extractRootCurrency(summary, accounts);
  const positionsRes = await ibkrClient.get(`/portfolio2/${accountId}/positions`);
  const positionsRaw = Array.isArray(positionsRes.data) ? positionsRes.data : positionsRes.data?.positions || [];
  const positions = positionsRaw.map(normalizePosition).filter(Boolean);
  const ordersRes = await ibkrClient.get('/iserver/account/orders');
  const ordersRaw = extractOrdersFromIserverResponse(ordersRes.data);
  const orders = ordersRaw.map(normalizeOrder).filter(Boolean);
  return {
    accountId: String(accountId),
    portfolioValue,
    rootCurrency: rootCurrencyMeta.currency,
    rootCurrencySource: rootCurrencyMeta.source,
    positions,
    orders
  };
};

const exchangeConnectorKey = async () => {
  if (connectorKey) return connectorKey;
  if (!token) {
    throw new Error('Connector key missing and no exchange token provided.');
  }
  const response = await connectorClient.post(
    '/api/integrations/ibkr/connector/exchange',
    null,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const exchangedKey = response.data?.connectorKey;
  if (!exchangedKey) {
    throw new Error('Connector key was not returned by server.');
  }
  connectorKey = exchangedKey;
  storeConnectorKey(connectorKey);
  return connectorKey;
};

const isRetryable = (error: any) => {
  if (!error) return false;
  if (error.code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(error.code)) {
    return true;
  }
  const status = error?.response?.status;
  return typeof status === 'number' && status >= 500;
};

const postWithRetry = async (path: string, payload: any) => {
  const maxAttempts = 3;
  let attempt = 0;
  let delay = 1000;
  while (attempt < maxAttempts) {
    try {
      await connectorClient.post(
        path,
        payload,
        { headers: { Authorization: `Bearer ${connectorKey}` } }
      );
      return true;
    } catch (error: any) {
      attempt += 1;
      if (attempt >= maxAttempts || !isRetryable(error)) {
        throw error;
      }
      await sleep(delay);
      delay *= 2;
    }
  }
  return false;
};

const sendHeartbeat = async (payload: any) => {
  await postWithRetry('/api/integrations/ibkr/connector/heartbeat', payload);
};

const sendSnapshot = async (snapshot: any) => {
  await postWithRetry('/api/integrations/ibkr/connector/snapshot', snapshot);
};

const run = async () => {
  connectorKey = await exchangeConnectorKey();
  console.log(`Veracity IBKR connector running. Gateway=${normalizeGateway} Server=${server}`);
  let veracityBackoffMs = 0;
  while (true) {
    const heartbeatPayload: any = {
      status: 'online',
      reason: '',
      authStatus: { authenticated: false, connected: false },
      connectorVersion,
      gatewayUrl: normalizeGateway
    };
    try {
      const authRes = await ibkrClient.get('/iserver/auth/status');
      const authFlags = extractAuthFlags(authRes.data);
      heartbeatPayload.authStatus = authFlags;
      if (!authFlags.authenticated || !authFlags.connected) {
        heartbeatPayload.status = 'disconnected';
        heartbeatPayload.reason = 'IBKR session not authenticated. Open https://localhost:5000 and login/2FA in Client Portal Gateway.';
        console.warn(heartbeatPayload.reason);
        await sendHeartbeat(heartbeatPayload);
        veracityBackoffMs = 0;
        await sleep(pollSeconds * 1000);
        continue;
      }
      await ibkrClient.post('/tickle');
    } catch (error: any) {
      heartbeatPayload.status = 'error';
      heartbeatPayload.reason = 'Unable to reach IBKR Client Portal Gateway.';
      try {
        await sendHeartbeat(heartbeatPayload);
        veracityBackoffMs = 0;
      } catch (sendError) {
        veracityBackoffMs = veracityBackoffMs ? Math.min(veracityBackoffMs * 2, 60000) : 2000;
        console.error('Veracity unreachable; backing off.', sendError?.message || sendError);
      }
      await sleep((pollSeconds * 1000) + veracityBackoffMs);
      continue;
    }
    try {
      await sendHeartbeat(heartbeatPayload);
      veracityBackoffMs = 0;
      const snapshot = await fetchSnapshot();
      const { rootCurrencySource, ...snapshotPayload } = snapshot as any;
      const payload = {
        ...snapshotPayload,
        meta: {
          gatewayUrl: normalizeGateway,
          connectorVersion,
          ts: new Date().toISOString(),
          rootCurrencySource: rootCurrencySource || ''
        }
      };
      await sendSnapshot(payload);
      console.log(`Snapshot sent at ${new Date().toISOString()} for account ${snapshot.accountId}`);
    } catch (error: any) {
      const message = error?.response?.data?.error || error?.message || 'Unknown error';
      if (isRetryable(error)) {
        veracityBackoffMs = veracityBackoffMs ? Math.min(veracityBackoffMs * 2, 60000) : 2000;
        console.error(`Veracity error: ${message}. Backing off ${veracityBackoffMs}ms.`);
      } else {
        veracityBackoffMs = 0;
        console.error(`Connector error: ${message}`);
      }
    }
    await sleep((pollSeconds * 1000) + veracityBackoffMs);
  }
};

run().catch(error => {
  console.error('Connector failed to start', error?.message || error);
  process.exit(1);
});
