const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const { handlers, setupInterceptors } = require('./ipc-handlers');
// const DiscordRPC = require('discord-rpc');

const clientId = '1451640447993774232';
// DiscordRPC.register(clientId);

// const rpc = new DiscordRPC.Client({ transport: 'ipc' });
const startTimestamp = new Date();

async function setActivity(title) {
  // if (!rpc) return;

  let details = 'Not watching anything';
  let state = 'https://pstream.mov';

  if (title && title !== 'P-Stream') {
    details = `Watching: ${title}`;
    state = 'https://pstream.mov';
  }

  /*
  rpc.setActivity({
    details: details,
    state: state,
    startTimestamp,
    largeImageKey: 'logo',
    largeImageText: 'P-Stream',
    instance: false,
  }).catch(console.error);
  */
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      persistSessionCookies: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: "P-Stream"
  });

  // Remove the menu entirely
  mainWindow.setMenu(null);

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.loadURL('https://pstream.mov/');

  // Update title when page title changes
  mainWindow.on('page-title-updated', (event, title) => {
    event.preventDefault();
    let displayTitle = title;
    
    if (title === 'P-Stream') {
      mainWindow.setTitle('P-Stream');
      setActivity(null);
    } else {
      // Assuming the title comes as "Movie Title - P-Stream" or just "Movie Title"
      // If it's "Movie Title - P-Stream", we want "Movie Title"
      const cleanTitle = title.replace(' - P-Stream', '');
      mainWindow.setTitle(`${cleanTitle} - P-Stream`);
      setActivity(cleanTitle);
    }
  });

  // Optional: Open DevTools
  // mainWindow.webContents.openDevTools();
}

// rpc.on('ready', () => {
//   console.log('Discord RPC started');
//   setActivity(null);
// });

app.whenReady().then(async () => {
  // Register IPC handlers
  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, async (event, ...args) => {
      return handler(...args);
    });
  });

  // Setup Network Interceptors
  setupInterceptors(session.defaultSession);

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// rpc.login({ clientId }).catch(console.error);
