const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controlPanel', {
  getDiscordRPCEnabled: () => ipcRenderer.invoke('get-discord-rpc-enabled'),
  setDiscordRPCEnabled: (enabled) => ipcRenderer.invoke('set-discord-rpc-enabled', enabled),
  getStreamUrl: () => ipcRenderer.invoke('get-stream-url'),
  setStreamUrl: (url) => ipcRenderer.invoke('set-stream-url', url),
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('checkForUpdates'),
  installUpdate: () => ipcRenderer.invoke('installUpdate'),
  openReleasesPage: () => ipcRenderer.invoke('openReleasesPage'),
  restartApp: () => ipcRenderer.invoke('restartApp'),
  resetApp: () => ipcRenderer.invoke('reset-app'),
  uninstallApp: () => ipcRenderer.invoke('uninstall-app'),
});
