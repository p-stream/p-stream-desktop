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

// Expose function to open settings
contextBridge.exposeInMainWorld('__PSTREAM_OPEN_SETTINGS__', () => {
  ipcRenderer.send('open-settings');
});

// Expose function to open DevTools for this (embedded) page
contextBridge.exposeInMainWorld('__PSTREAM_OPEN_DEVTOOLS__', () => {
  ipcRenderer.send('open-embed-devtools');
});

// Expose WARP controls for the "failed to load" error page (turn on WARP, then reload)
contextBridge.exposeInMainWorld('__PSTREAM_SET_WARP_ENABLED__', (enabled) =>
  ipcRenderer.invoke('set-warp-enabled', enabled),
);
contextBridge.exposeInMainWorld('__PSTREAM_GET_WARP_STATUS__', () => ipcRenderer.invoke('get-warp-status'));
contextBridge.exposeInMainWorld('__PSTREAM_RELOAD_STREAM_PAGE__', () => ipcRenderer.invoke('reload-stream-page'));

// When the web app requests desktop settings (e.g. menu → Desktop), open the settings panel
window.addEventListener('pstream-desktop-settings', () => {
  ipcRenderer.send('open-settings');
});

console.log('P-Stream Desktop Preload Loaded');

let lastThemeColor = null;
let themeSendScheduled = false;

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

const scheduleThemeSend = () => {
  if (themeSendScheduled) return;
  themeSendScheduled = true;
  requestAnimationFrame(() => {
    themeSendScheduled = false;
    sendThemeColor();
  });
};

const observeThemeChanges = () => {
  sendThemeColor();

  const observer = new MutationObserver(() => {
    scheduleThemeSend();
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
  const intervalId = setInterval(sendThemeColor, 10000);
  window.addEventListener(
    'beforeunload',
    () => {
      clearInterval(intervalId);
    },
    { once: true },
  );
});
