const { contextBridge, ipcRenderer } = require('electron');

const VALID_CHANNELS = ['hello', 'makeRequest', 'prepareStream', 'openPage', 'updateMediaMetadata'];

window.addEventListener('message', async (event) => {
  // Security check: only accept messages from the same window
  if (event.source !== window) return;

  const data = event.data;

  // Basic Plasmo relay check
  // We look for messages that have a 'name' that matches our API
  // and are NOT marked as 'relayed' (to avoid infinite loops)
  if (!data || !data.name || data.relayed) return;

  if (VALID_CHANNELS.includes(data.name)) {
    try {
      // Forward to Main Process
      const response = await ipcRenderer.invoke(data.name, data.body);

      // Send response back to window (only if it's not a one-way update like updateMediaMetadata)
      if (data.name !== 'updateMediaMetadata') {
        window.postMessage(
          {
            name: data.name,
            relayId: data.relayId,
            instanceId: data.instanceId,
            body: response,
            relayed: true,
          },
          '*',
        ); // Target origin * is okay here as we validated source === window
      }
    } catch (error) {
      console.error(`[Preload] Error handling ${data.name}:`, error);
      if (data.name !== 'updateMediaMetadata') {
        window.postMessage(
          {
            name: data.name,
            relayId: data.relayId,
            instanceId: data.instanceId,
            body: { success: false, error: error.message },
            relayed: true,
          },
          '*',
        );
      }
    }
  }
});

// Expose flag so the web app knows it's running in the desktop client
contextBridge.exposeInMainWorld('__PSTREAM_DESKTOP__', true);

// When the web app requests desktop settings (e.g. menu → Desktop), open the control panel
window.addEventListener('pstream-desktop-settings', () => {
  ipcRenderer.invoke('openControlPanel');
});

console.log('P-Stream Desktop Preload Loaded');

let lastThemeColor = null;

const getThemeColor = () => {
  const body = document.body;
  const root = document.documentElement;

  const bodyColor = body ? getComputedStyle(body).backgroundColor : '';
  const rootColor = root ? getComputedStyle(root).backgroundColor : '';

  const isTransparent = (value) => !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)';

  if (!isTransparent(bodyColor)) return bodyColor;
  if (!isTransparent(rootColor)) return rootColor;
  return '#1f2025';
};

const sendThemeColor = () => {
  const color = getThemeColor();
  if (color && color !== lastThemeColor) {
    lastThemeColor = color;
    ipcRenderer.send('theme-color', color);
  }
};

const observeThemeChanges = () => {
  sendThemeColor();

  const observer = new MutationObserver(() => {
    sendThemeColor();
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme', 'data-mode'],
    subtree: true,
  });

  if (document.body) {
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-mode'],
      subtree: true,
    });
  }
};

window.addEventListener('DOMContentLoaded', () => {
  observeThemeChanges();
  setInterval(sendThemeColor, 2000);
});
