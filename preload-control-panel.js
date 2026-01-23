const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controlPanel', {
  getDiscordRPCEnabled: () => ipcRenderer.invoke('get-discord-rpc-enabled'),
  setDiscordRPCEnabled: (enabled) => ipcRenderer.invoke('set-discord-rpc-enabled', enabled)
});
