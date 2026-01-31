const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updater', {
  onProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, data) => {
      callback(data);
    });
  },
});
