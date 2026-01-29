import axios, { AxiosInstance } from 'axios';

const args = process.argv.slice(2);
const getArg = (flag: string, fallback: string | null = null) => {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
};

const server = getArg('--server', process.env.VERACITY_SERVER || '') || '';
const token = getArg('--token', process.env.VERACITY_CONNECTOR_TOKEN || '') || '';
const gateway = getArg('--gateway', process.env.IBKR_GATEWAY_URL || 'http://127.0.0.1:5000') || '';
const poll = Number(getArg('--poll', process.env.IBKR_POLL_INTERVAL || '15')) || 15;
const accountOverride = getArg('--account', process.env.IBKR_ACCOUNT_ID || '') || '';

if (!server || !token) {
  console.error('Missing required --server or --token.');
  process.exit(1);
}

const normalizeGateway = gateway.replace(/\/+$/, '');
const ibkrApiBase = `${normalizeGateway}/v1/api`;

const connectorClient: AxiosInstance = axios.create({
  baseURL: server.replace(/\/+$/, ''),
  headers: { Authorization: `Bearer ${token}` },
  timeout: 15000
});

const ibkrClient: AxiosInstance = axios.create({
  baseURL: ibkrApiBase,
  timeout: 15000
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

const normalizeOrder = (raw: any) => {
  const ticker = String(raw?.ticker || raw?.symbol || raw?.contract?.symbol || raw?.contractDesc || '').trim();
  const conid = raw?.conid ?? raw?.conidex ?? raw?.contract?.conid ?? raw?.contract?.conidex ?? '';
  const type = String(raw?.orderType ?? raw?.orderTypeDesc ?? raw?.orderTypeId ?? raw?.type ?? '').trim().toUpperCase();
  const status = String(raw?.status ?? raw?.orderStatus ?? raw?.state ?? '').trim().toUpperCase();
  const side = String(raw?.side ?? raw?.action ?? raw?.direction ?? '').trim().toUpperCase();
  const quantity = Number(raw?.totalQuantity ?? raw?.qty ?? raw?.quantity ?? raw?.size ?? raw?.orderSize);
  const stopPrice = Number(raw?.auxPrice ?? raw?.stopPrice ?? raw?.stop ?? raw?.stopPriceLimit);
  const id = raw?.orderId ?? raw?.id ?? raw?.order_id ?? '';
  const createdAt = raw?.orderTime ?? raw?.createdTime ?? raw?.time ?? raw?.submittedTime ?? '';
  if (!Number.isFinite(stopPrice)) return null;
  return {
    id: id ? String(id) : undefined,
    ticker: ticker ? ticker.toUpperCase() : undefined,
    conid: conid ? String(conid) : undefined,
    type,
    status,
    side,
    quantity: Number.isFinite(quantity) ? quantity : undefined,
    stopPrice,
    createdAt
  };
};

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
  const positionsRes = await ibkrClient.get(`/portfolio2/${accountId}/positions`);
  const positionsRaw = Array.isArray(positionsRes.data) ? positionsRes.data : positionsRes.data?.positions || [];
  const positions = positionsRaw.map(normalizePosition).filter(Boolean);
  const ordersRes = await ibkrClient.get('/iserver/account/orders');
  const ordersRaw = Array.isArray(ordersRes.data) ? ordersRes.data : ordersRes.data?.orders || [];
  const orders = ordersRaw.map(normalizeOrder).filter(Boolean);
  return { accountId: String(accountId), portfolioValue, positions, orders };
};

const sendHeartbeat = async () => {
  await connectorClient.post('/api/integrations/ibkr/connector/heartbeat');
};

const sendSnapshot = async (snapshot: any) => {
  await connectorClient.post('/api/integrations/ibkr/connector/snapshot', snapshot);
};

const run = async () => {
  console.log(`Veracity IBKR connector running. Gateway=${normalizeGateway} Server=${server}`);
  while (true) {
    try {
      await sendHeartbeat();
      const snapshot = await fetchSnapshot();
      await sendSnapshot(snapshot);
      console.log(`Snapshot sent at ${new Date().toISOString()} for account ${snapshot.accountId}`);
    } catch (error: any) {
      const message = error?.response?.data?.error || error?.message || 'Unknown error';
      console.error(`Connector error: ${message}`);
    }
    await sleep(poll * 1000);
  }
};

run().catch(error => {
  console.error('Connector failed to start', error?.message || error);
  process.exit(1);
});
