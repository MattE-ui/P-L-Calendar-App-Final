const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const https = require('node:https');
const http = require('node:http');

let mainWindow;
let tray;
let connectorProcess = null;
let cachedConnectorKey = null;

const CONFIG_DIR = path.join(os.homedir(), '.veracity');
const CONFIG_PATH = path.join(CONFIG_DIR, 'ibkr-installer.json');
const LOG_PATH = path.join(CONFIG_DIR, 'ibkr-installer.log');

const defaultConfig = {
  serverUrl: 'https://veracitysuite.com',
  gatewayUrl: 'https://localhost:5000',
  pollSeconds: 15,
  insecure: true,
  gatewayPath: '',
  connectorPath: '',
  token: ''
};

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { ...defaultConfig };
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return { ...defaultConfig, ...(JSON.parse(raw) || {}) };
  } catch (err) {
    return { ...defaultConfig };
  }
}

function writeConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function logLine(message) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 780,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'app', 'renderer', 'index.html'));
}

function createTray() {
  const fallbackIcon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAQElEQVR4nGNgGAWjYBSMglEwCqYkRhGmQikMiFQpAaE0JQZkBauCoIAZgGQKMpJkCNYEAEApRgq5CgAZ8QAAAABJRU5ErkJggg=='
  );
  tray = new Tray(fallbackIcon);
  const menu = Menu.buildFromTemplate([
    { label: 'Open Veracity IBKR Connector', click: () => mainWindow.show() },
    { label: 'Start', click: () => startConnector() },
    { label: 'Stop', click: () => stopConnector() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setToolTip('Veracity IBKR Connector');
  tray.setContextMenu(menu);
}

function resolveConnectorPath(config) {
  if (config.connectorPath) return config.connectorPath;
  return path.join(__dirname, 'app', 'connector', 'index.js');
}

function startConnector() {
  if (connectorProcess && !connectorProcess.killed) return { ok: true };
  const config = readConfig();
  if (!config.token) {
    return { ok: false, message: 'Paste a one-time token before starting.' };
  }
  const connectorPath = resolveConnectorPath(config);
  if (!fs.existsSync(connectorPath)) {
    return { ok: false, message: 'Connector file missing. Run the installer build again.' };
  }
  const args = [
    connectorPath,
    '--server', config.serverUrl,
    '--gateway', config.gatewayUrl,
    '--pollSeconds', String(config.pollSeconds),
    '--token', config.token
  ];
  if (config.insecure) {
    args.push('--insecure');
  }

  connectorProcess = spawn(process.execPath, args, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  connectorProcess.stdout.on('data', (data) => logLine(data.toString().trim()));
  connectorProcess.stderr.on('data', (data) => logLine(data.toString().trim()));
  connectorProcess.on('exit', (code) => {
    logLine(`Connector exited with code ${code}`);
    connectorProcess = null;
  });

  return { ok: true };
}

function stopConnector() {
  if (!connectorProcess) return { ok: true };
  connectorProcess.kill();
  connectorProcess = null;
  return { ok: true };
}

function requestJson(url, { method = 'GET', body, insecure = false, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const isHttps = target.protocol === 'https:';
    const options = {
      method,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      headers
    };
    if (isHttps) {
      options.agent = new https.Agent({ rejectUnauthorized: !insecure });
    }

    const req = (isHttps ? https : http).request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          const parsed = raw ? JSON.parse(raw) : {};
          resolve({ status: res.statusCode || 0, data: parsed });
        } catch (err) {
          resolve({ status: res.statusCode || 0, data: raw });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

ipcMain.handle('get-config', () => readConfig());

ipcMain.handle('save-config', (_, update) => {
  const current = readConfig();
  const next = { ...current, ...update };
  writeConfig(next);
  return next;
});

ipcMain.handle('browse-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return '';
  return result.filePaths[0];
});

ipcMain.handle('start-connector', () => startConnector());
ipcMain.handle('stop-connector', () => stopConnector());

ipcMain.handle('test-gateway', async () => {
  const config = readConfig();
  const url = `${config.gatewayUrl.replace(/\/$/, '')}/v1/api/iserver/auth/status`;
  try {
    const result = await requestJson(url, { insecure: config.insecure });
    return { ok: result.status === 200, response: result.data };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('test-veracity', async () => {
  const config = readConfig();
  if (!config.token) {
    return { ok: false, message: 'Paste a one-time token first.' };
  }
  try {
    const exchange = await requestJson(`${config.serverUrl.replace(/\/$/, '')}/api/integrations/ibkr/connector/exchange`, {
      method: 'POST',
      body: {},
      headers: { Authorization: `Bearer ${config.token}` }
    });
    if (exchange.status !== 200 || !exchange.data?.connectorKey) {
      return { ok: false, message: 'Token exchange failed.' };
    }
    cachedConnectorKey = exchange.data.connectorKey;
    const heartbeat = await requestJson(`${config.serverUrl.replace(/\/$/, '')}/api/integrations/ibkr/connector/heartbeat`, {
      method: 'POST',
      body: {
        status: 'online',
        reason: '',
        authStatus: { authenticated: false, connected: false }
      },
      headers: { Authorization: `Bearer ${cachedConnectorKey}` }
    });
    return { ok: heartbeat.status === 200, response: heartbeat.data };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('before-quit', () => {
  stopConnector();
});
