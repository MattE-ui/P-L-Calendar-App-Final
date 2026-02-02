const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('veracityInstaller', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  browseFolder: () => ipcRenderer.invoke('browse-folder'),
  startConnector: () => ipcRenderer.invoke('start-connector'),
  stopConnector: () => ipcRenderer.invoke('stop-connector'),
  startGateway: () => ipcRenderer.invoke('start-gateway'),
  openGatewayUi: () => ipcRenderer.invoke('open-gateway-ui'),
  testGateway: () => ipcRenderer.invoke('test-gateway'),
  testVeracity: () => ipcRenderer.invoke('test-veracity')
});
