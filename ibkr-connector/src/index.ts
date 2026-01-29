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
const debug = args.includes('--debug') || process.env.VERACITY_DEBUG === '1';

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

const clearStoredConnectorKey = () => {
  if (!keyFileArg) return;
  try {
    if (fs.existsSync(keyFileArg)) {
      fs.unlinkSync(keyFileArg);
    }
  } catch (error) {
    console.warn('Unable to remove stored connector key.', error);
  }
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

const buildFullUrl = (baseURL?: string, url?: string) => {
  const base = baseURL ? String(baseURL).replace(/\/+$/, '') : '';
  if (!url) return base;
  if (!base) return url;
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
};

const safeStringify = (value: any) => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
};

const logAxiosError = (prefix: string, error: any) => {
  if (axios.isAxiosError(error)) {
    const method = (error.config?.method || 'GET').toUpperCase();
    const fullUrl = buildFullUrl(error.config?.baseURL, error.config?.url);
    const status = error.response?.status;
    const payload = safeStringify(error.response?.data);
    const payloadSuffix = payload ? ` ${payload}` : '';
    console.error(`${prefix} ${status ?? 'ERR'} ${method} ${fullUrl}${payloadSuffix}`.trim());
    return;
  }
  console.error(`${prefix} ${error?.message || error}`);
};

const logAxiosSuccess = (prefix: string, response: any) => {
  if (!debug || !response) return;
  const method = (response.config?.method || 'GET').toUpperCase();
  const fullUrl = buildFullUrl(response.config?.baseURL, response.config?.url);
  console.log(`${prefix} ${response.status} ${method} ${fullUrl}`);
};

const requestIbkr = async (method: 'GET' | 'POST', url: string) => {
  try {
    const response = await ibkrClient.request({ method, url });
    logAxiosSuccess('[IBKR]', response);
    return response;
  } catch (error) {
    logAxiosError('[IBKR]', error);
    throw error;
  }
};

const requestVeracity = async (method: 'GET' | 'POST', url: string, payload?: any) => {
  try {
    const response = await connectorClient.request({
      method,
      url,
      data: payload,
      headers: { Authorization: `Bearer ${connectorKey}` }
    });
    logAxiosSuccess('[VERACITY]', response);
    return response;
  } catch (error) {
    logAxiosError('[VERACITY]', error);
    throw error;
  }
};

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

const determineRootCurrency = (summary: any, ledger: any, accounts: any[]) => {
  const summaryCurrency =
    summary?.netliquidation?.currency
    || summary?.equitywithloanvalue?.currency
    || summary?.totalcashvalue?.currency;
  if (summaryCurrency) {
    return { currency: String(summaryCurrency).trim().toUpperCase(), confidence: 'high', reason: 'summary.netliquidation.currency' };
  }
  if (summary?.baseCurrency) {
    return { currency: String(summary.baseCurrency).trim().toUpperCase(), confidence: 'high', reason: 'summary.baseCurrency' };
  }
  if (summary?.currency) {
    return { currency: String(summary.currency).trim().toUpperCase(), confidence: 'high', reason: 'summary.currency' };
  }
  if (Array.isArray(summary)) {
    const currencyRow = summary.find((entry: any) => String(entry?.tag || entry?.key || '').toUpperCase() === 'BASECURRENCY');
    if (currencyRow?.value) {
      return { currency: String(currencyRow.value).trim().toUpperCase(), confidence: 'high', reason: 'summary.tag.BASECURRENCY' };
    }
  }
  if (ledger?.baseCurrency) {
    return { currency: String(ledger.baseCurrency).trim().toUpperCase(), confidence: 'medium', reason: 'ledger.baseCurrency' };
  }
  if (ledger && typeof ledger === 'object') {
    const keys = Object.keys(ledger).filter(key => typeof key === 'string' && key.length === 3);
    if (keys.length === 1) {
      return { currency: keys[0].toUpperCase(), confidence: 'medium', reason: 'ledger.singleCurrency' };
    }
  }
  for (const account of accounts || []) {
    if (account?.currency) {
      return { currency: String(account.currency).trim().toUpperCase(), confidence: 'medium', reason: 'accounts.currency' };
    }
    if (account?.baseCurrency) {
      return { currency: String(account.baseCurrency).trim().toUpperCase(), confidence: 'medium', reason: 'accounts.baseCurrency' };
    }
  }
  return { currency: 'UNKNOWN', confidence: 'low', reason: 'unresolved' };
};

const extractAuthFlags = (payload: any) => ({
  authenticated: payload?.authenticated === true || payload?.isAuthenticated === true,
  connected: payload?.connected === true || payload?.brokerageSession === true
});

const extractAmount = (summary: any, key: string) => {
  const entry = summary?.[key];
  if (!entry) return null;
  if (typeof entry.amount === 'number') return entry.amount;
  if (typeof entry.value === 'number') return entry.value;
  if (typeof entry.value === 'string') {
    const parsed = Number(entry.value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const extractCurrency = (summary: any, key: string) => {
  const entry = summary?.[key];
  if (entry && typeof entry.currency === 'string' && entry.currency) {
    return entry.currency;
  }
  return null;
};

const extractPortfolioValue = (summary: any) => {
  const value =
    extractAmount(summary, 'netliquidation')
    ?? extractAmount(summary, 'equitywithloanvalue')
    ?? extractAmount(summary, 'totalcashvalue');
  if (!Number.isFinite(value)) return null;
  const currency =
    extractCurrency(summary, 'netliquidation')
    ?? extractCurrency(summary, 'equitywithloanvalue')
    ?? extractCurrency(summary, 'totalcashvalue');
  return { value, currency: currency || 'UNKNOWN' };
};

const fetchSnapshot = async () => {
  const accountsRes = await requestIbkr('GET', '/portfolio/accounts');
  const accounts = Array.isArray(accountsRes.data) ? accountsRes.data : accountsRes.data?.accounts || [];
  const accountId = accountOverride || accounts[0]?.accountId || accounts[0]?.id || accounts[0] || '';
  if (!accountId) {
    throw new Error('No IBKR account found.');
  }
  const summaryRes = await requestIbkr('GET', `/portfolio/${accountId}/summary`);
  const summary = summaryRes.data;
  const portfolioMeta = extractPortfolioValue(summary);
  if (!portfolioMeta) {
    console.warn('Net liquidation value missing from summary. Skipping snapshot.');
    return null;
  }
  let ledger = null;
  try {
    const ledgerRes = await requestIbkr('GET', `/portfolio/${accountId}/ledger`);
    ledger = ledgerRes.data;
  } catch (error) {
    ledger = null;
  }
  const rootCurrencyMeta = determineRootCurrency(summary, ledger, accounts);
  if (rootCurrencyMeta.currency === 'UNKNOWN') {
    console.warn('Unable to determine IBKR account currency; reporting UNKNOWN.');
  }
  const positionsRes = await requestIbkr('GET', `/portfolio2/${accountId}/positions`);
  const positionsRaw = Array.isArray(positionsRes.data) ? positionsRes.data : positionsRes.data?.positions || [];
  const positions = positionsRaw.map(normalizePosition).filter(Boolean);
  const ordersRes = await requestIbkr('GET', '/iserver/account/orders');
  const ordersRaw = extractOrdersFromIserverResponse(ordersRes.data);
  const orders = ordersRaw.map(normalizeOrder).filter(Boolean);
  return {
    accountId: String(accountId),
    portfolioValue: portfolioMeta.value,
    rootCurrency: rootCurrencyMeta.currency,
    rootCurrencySource: rootCurrencyMeta.reason,
    rootCurrencyConfidence: rootCurrencyMeta.confidence,
    rootCurrencyReason: rootCurrencyMeta.reason,
    positions,
    orders
  };
};

const exchangeConnectorKey = async () => {
  if (connectorKey) return connectorKey;
  if (!token) {
    throw new Error('Connector key missing and no exchange token provided.');
  }
  try {
    const response = await connectorClient.post(
      '/api/integrations/ibkr/connector/exchange',
      null,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    logAxiosSuccess('[VERACITY]', response);
    const exchangedKey = response.data?.connectorKey;
    if (!exchangedKey) {
      throw new Error('Connector key was not returned by server.');
    }
    connectorKey = exchangedKey;
    storeConnectorKey(connectorKey);
    return connectorKey;
  } catch (error: any) {
    if (error?.response?.status === 401) {
      logAxiosError('[VERACITY]', error);
      console.error('Connector token rejected; please generate a fresh token.');
      clearStoredConnectorKey();
      process.exit(1);
    }
    logAxiosError('[VERACITY]', error);
    throw error;
  }
};

const isRetryable = (error: any) => {
  if (!error) return false;
  if (error.code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(error.code)) {
    return true;
  }
  const status = error?.response?.status;
  return typeof status === 'number' && status >= 500;
};

const sendHeartbeat = async (payload: any) => {
  await requestVeracity('POST', '/api/integrations/ibkr/connector/heartbeat', payload);
};

const sendSnapshot = async (snapshot: any) => {
  await requestVeracity('POST', '/api/integrations/ibkr/connector/snapshot', snapshot);
};

const handleVeracityError = async (error: any) => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const errorBody = error.response?.data;
    const message = typeof errorBody === 'string' ? errorBody : (errorBody?.error || '');
    const normalized = String(message).toLowerCase();
    if (status === 401) {
      if (normalized.includes('connector key') || normalized.includes('missing connector key')) {
        console.error('Connector key rejected by server. Delete local config and re-run with a fresh one-time token.');
        clearStoredConnectorKey();
        process.exit(1);
      }
      return { backoffMs: 0, handled: true };
    }
    if (status === 429) {
      const jitter = Math.floor(Math.random() * 1000);
      const backoffMs = Math.min(60000, 2000 + jitter);
      console.error(`[VERACITY] Rate limited. Backing off ${backoffMs}ms.`);
      return { backoffMs, handled: true };
    }
    if (status && status >= 500) {
      return { backoffMs: 2000, handled: true };
    }
  }
  if (isRetryable(error)) {
    console.error('Veracity unreachable; backing off.');
    return { backoffMs: 2000, handled: true };
  }
  return { backoffMs: 0, handled: false };
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
    let snapshot = null;
    try {
      const authRes = await requestIbkr('GET', '/iserver/auth/status');
      const authFlags = extractAuthFlags(authRes.data);
      heartbeatPayload.authStatus = authFlags;
      if (!authFlags.authenticated || !authFlags.connected) {
        heartbeatPayload.status = 'disconnected';
        heartbeatPayload.reason = 'IBKR session not authenticated. Open https://localhost:5000 and login/2FA in Client Portal Gateway.';
        console.warn(`[IBKR] ${heartbeatPayload.reason}`);
      } else {
        await requestIbkr('POST', '/tickle');
        snapshot = await fetchSnapshot();
      }
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        heartbeatPayload.status = 'disconnected';
        heartbeatPayload.reason = 'IBKR session not authenticated. Open https://localhost:5000 and login/2FA in Client Portal Gateway.';
        console.warn(`[IBKR] ${heartbeatPayload.reason}`);
      } else {
        heartbeatPayload.status = 'error';
        heartbeatPayload.reason = 'Unable to reach IBKR Client Portal Gateway.';
        console.error(`[IBKR] ${heartbeatPayload.reason}`);
      }
    }

    try {
      await sendHeartbeat(heartbeatPayload);
      if (snapshot) {
        const {
          rootCurrencySource,
          rootCurrencyConfidence,
          rootCurrencyReason,
          ...snapshotPayload
        } = snapshot as any;
        const payload = {
          ...snapshotPayload,
          meta: {
            gatewayUrl: normalizeGateway,
            connectorVersion,
            ts: new Date().toISOString(),
            rootCurrencySource: rootCurrencySource || '',
            currencyConfidence: rootCurrencyConfidence || 'low',
            currencyReason: rootCurrencyReason || ''
          }
        };
        await sendSnapshot(payload);
        console.log(`Snapshot sent at ${new Date().toISOString()} for account ${snapshot.accountId}`);
      }
      veracityBackoffMs = 0;
    } catch (error: any) {
      const { backoffMs, handled } = await handleVeracityError(error);
      if (!handled) {
        console.error(`[VERACITY] ${error?.message || 'Unknown error'}`);
      }
      veracityBackoffMs = backoffMs || 0;
    }
    await sleep((pollSeconds * 1000) + veracityBackoffMs);
  }
};

run().catch(error => {
  console.error('Connector failed to start', error?.message || error);
  process.exit(1);
});
