const statusEl = document.getElementById('status');

const fields = {
  gatewayPath: document.getElementById('gateway-path'),
  serverUrl: document.getElementById('server-url'),
  gatewayUrl: document.getElementById('gateway-url'),
  pollSeconds: document.getElementById('poll-seconds'),
  insecure: document.getElementById('insecure'),
  token: document.getElementById('token')
};

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

async function loadConfig() {
  const config = await window.veracityInstaller.getConfig();
  fields.gatewayPath.value = config.gatewayPath || '';
  fields.serverUrl.value = config.serverUrl || '';
  fields.gatewayUrl.value = config.gatewayUrl || '';
  fields.pollSeconds.value = config.pollSeconds || 15;
  fields.insecure.checked = Boolean(config.insecure);
  fields.token.value = config.token || '';
}

async function saveConfig() {
  const config = {
    gatewayPath: fields.gatewayPath.value.trim(),
    serverUrl: fields.serverUrl.value.trim(),
    gatewayUrl: fields.gatewayUrl.value.trim(),
    pollSeconds: Number(fields.pollSeconds.value) || 15,
    insecure: fields.insecure.checked,
    token: fields.token.value.trim()
  };
  await window.veracityInstaller.saveConfig(config);
  return config;
}

document.getElementById('browse-gateway').addEventListener('click', async () => {
  const folder = await window.veracityInstaller.browseFolder();
  if (folder) fields.gatewayPath.value = folder;
});

document.getElementById('start-gateway').addEventListener('click', async () => {
  await saveConfig();
  const result = await window.veracityInstaller.startGateway();
  setStatus(result.ok ? 'Gateway launch started.' : result.message, !result.ok);
});

document.getElementById('open-gateway').addEventListener('click', async () => {
  await window.veracityInstaller.openGatewayUi();
});

document.getElementById('start').addEventListener('click', async () => {
  await saveConfig();
  const result = await window.veracityInstaller.startConnector();
  setStatus(result.ok ? 'Connector started.' : result.message, !result.ok);
});

document.getElementById('stop').addEventListener('click', async () => {
  const result = await window.veracityInstaller.stopConnector();
  setStatus(result.ok ? 'Connector stopped.' : result.message, !result.ok);
});

document.getElementById('test-gateway').addEventListener('click', async () => {
  await saveConfig();
  const result = await window.veracityInstaller.testGateway();
  if (result.ok) {
    setStatus('Gateway reachable. Auth status returned.');
  } else {
    setStatus(result.message || 'Gateway not reachable.', true);
  }
});

document.getElementById('test-veracity').addEventListener('click', async () => {
  await saveConfig();
  const result = await window.veracityInstaller.testVeracity();
  setStatus(result.ok ? 'Veracity heartbeat accepted.' : result.message, !result.ok);
});

loadConfig().catch(() => setStatus('Unable to load config.', true));
