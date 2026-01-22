const { contextBridge, ipcRenderer } = require('electron');

const VALID_CHANNELS = ['hello', 'makeRequest', 'prepareStream', 'openPage'];

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
      
      // Send response back to window
      window.postMessage({
        name: data.name,
        relayId: data.relayId,
        instanceId: data.instanceId,
        body: response,
        relayed: true
      }, '*'); // Target origin * is okay here as we validated source === window
    } catch (error) {
      console.error(`[Preload] Error handling ${data.name}:`, error);
      window.postMessage({
        name: data.name,
        relayId: data.relayId,
        instanceId: data.instanceId,
        body: { success: false, error: error.message },
        relayed: true
      }, '*');
    }
  }
});

// We don't need to expose anything via contextBridge if the site relies solely on window.postMessage
// But just in case, we can log that we are ready.
console.log('P-Stream Desktop Preload Loaded');
