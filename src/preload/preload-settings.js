const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  // WARP VPN
  setWarpLaunchEnabled: (enabled) => ipcRenderer.invoke('set-warp-launch-enabled', enabled),
  getWarpLaunchEnabled: () => ipcRenderer.invoke('get-warp-launch-enabled'),
  getWarpEnabled: () => ipcRenderer.invoke('get-warp-enabled'),
  setWarpEnabled: (enabled) => ipcRenderer.invoke('set-warp-enabled', enabled),
  getWarpStatus: () => ipcRenderer.invoke('get-warp-status'),
  // Discord RPC
  getDiscordRPCEnabled: () => ipcRenderer.invoke('get-discord-rpc-enabled'),
  setDiscordRPCEnabled: (enabled) => ipcRenderer.invoke('set-discord-rpc-enabled', enabled),
  // Version and updates
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('checkForUpdates'),
  installUpdate: () => ipcRenderer.invoke('installUpdate'),
  openReleasesPage: () => ipcRenderer.invoke('openReleasesPage'),
  // Stream URL, reset, uninstall
  getStreamUrl: () => ipcRenderer.invoke('get-stream-url'),
  setStreamUrl: (url) => ipcRenderer.invoke('set-stream-url', url),
  resetApp: () => ipcRenderer.invoke('reset-app'),
  uninstallApp: () => ipcRenderer.invoke('uninstall-app'),
  // Hardware acceleration
  getHardwareAcceleration: () => ipcRenderer.invoke('get-hardware-acceleration'),
  setHardwareAcceleration: (enabled) => ipcRenderer.invoke('set-hardware-acceleration', enabled),
  restartApp: () => ipcRenderer.invoke('restartApp'),
});
