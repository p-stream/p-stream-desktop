const { app, BrowserWindow, BrowserView, session, ipcMain, dialog, Notification, globalShortcut } = require('electron');
const path = require('path');
const { handlers, setupInterceptors } = require('./ipc-handlers');
const DiscordRPC = require('discord-rpc');
const { autoUpdater } = require('electron-updater');
const SimpleStore = require('./storage');

const clientId = '1451640447993774232';
DiscordRPC.register(clientId);

const rpc = new DiscordRPC.Client({ transport: 'ipc' });
const startTimestamp = new Date();

// Settings store (will be initialized when app is ready)
let store = null;

// Control panel window reference
let controlPanelWindow = null;

// Store current activity title
let currentActivityTitle = null;

async function setActivity(title) {
  if (!rpc) return;
  
  // Check if Discord RPC is enabled (store might not be initialized yet)
  if (store && !store.get('discordRPCEnabled', true)) {
    // Clear activity if disabled
    rpc.clearActivity().catch(console.error);
    return;
  }

  let details = 'Not watching anything';
  let state = 'P-Stream is goated af';

  if (title && title !== 'P-Stream') {
    details = `Watching: ${title}`;
    state = 'P-Stream is goated af';
  }

  rpc.setActivity({
    details: details,
    state: state,
    startTimestamp,
    largeImageKey: 'logo',
    largeImageText: 'P-Stream',
    instance: false,
    buttons: [{ label: 'Use P-Stream', url: 'https://pstream.mov/' }]
  }).catch(console.error);
}


function createWindow() {
  const TITLE_BAR_HEIGHT = 40;
  // Allow platform override via environment variable for previewing different platforms
  const platform = process.env.PLATFORM_OVERRIDE || process.platform;
  const isMac = platform === 'darwin';
  const isLinux = platform === 'linux';

  // Configure window based on platform
  const windowOptions = {
    width: 1300,
    height: 800,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'logo.png'),
    backgroundColor: '#1f2025',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-titlebar.js')
    },
    title: 'P-Stream'
  };

  if (isMac) {
    // macOS: Use hidden title bar with native traffic lights
    windowOptions.frame = false;
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 12, y: 12 };
  } else {
    // Windows and Linux: Use frameless window with custom buttons
    windowOptions.frame = false;
  }

  const mainWindow = new BrowserWindow(windowOptions);

  // Remove the menu entirely
  mainWindow.setMenu(null);

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      persistSessionCookies: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setBrowserView(view);

  const resizeView = () => {
    const { width, height } = mainWindow.getContentBounds();
    view.setBounds({ x: 0, y: TITLE_BAR_HEIGHT, width, height: height - TITLE_BAR_HEIGHT });
  };

  resizeView();
  view.setAutoResize({ width: true, height: true });

  mainWindow.on('resize', resizeView);
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized', false));

  view.webContents.loadURL('https://pstream.mov/');

  // Update title when page title changes
  view.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();

    if (title === 'P-Stream') {
      mainWindow.setTitle('P-Stream');
      currentActivityTitle = null;
      setActivity(null);
    } else {
      const cleanTitle = title.replace(' - P-Stream', '');
      mainWindow.setTitle(`${cleanTitle} - P-Stream`);
      currentActivityTitle = cleanTitle;
      setActivity(cleanTitle);
    }

    mainWindow.webContents.send('title-changed', mainWindow.getTitle());
  });

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('title-changed', mainWindow.getTitle());
    mainWindow.webContents.send('window-maximized', mainWindow.isMaximized());
    mainWindow.webContents.send('platform-changed', platform);
  });

  // Optional: Open DevTools
  // view.webContents.openDevTools();
}

function createControlPanelWindow() {
  // If window already exists, focus it
  if (controlPanelWindow) {
    controlPanelWindow.focus();
    return;
  }

  controlPanelWindow = new BrowserWindow({
    width: 500,
    height: 400,
    minWidth: 400,
    minHeight: 300,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'logo.png'),
    backgroundColor: '#1f2025',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-control-panel.js')
    },
    title: 'P-Stream Control Panel',
    show: false
  });

  controlPanelWindow.loadFile(path.join(__dirname, 'control-panel.html'));

  controlPanelWindow.once('ready-to-show', () => {
    controlPanelWindow.show();
  });

  controlPanelWindow.on('closed', () => {
    controlPanelWindow = null;
  });
}

// Auto-updater configuration
autoUpdater.autoDownload = false; // Don't auto-download, let user choose
autoUpdater.autoInstallOnAppQuit = true; // Auto-install when app quits

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  dialog.showMessageBox(BrowserWindow.getFocusedWindow() || null, {
    type: 'info',
    title: 'Update Available',
    message: `A new version (${info.version}) of P-Stream is available!`,
    detail: 'Would you like to download and install it now?',
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1
  }).then(result => {
    if (result.response === 0) { // Download button
      autoUpdater.downloadUpdate();

      // Show download progress notification
      if (Notification.isSupported()) {
        new Notification({
          title: 'Downloading Update',
          body: 'P-Stream update is being downloaded...'
        }).show();
      }
    }
  }).catch(console.error);
});

autoUpdater.on('update-not-available', (info) => {
  console.log('Update not available. Current version:', info.version);
  // Silently handle - user is already on latest version, no action needed
});

autoUpdater.on('error', (err) => {
  console.error('Update error:', err);
  // Only show error dialog for actual failures, not for "already up to date" scenarios
  // Check if it's a network/API error vs. just no update available
  const errorMessage = err.message || err.toString().toLowerCase();
  const isNetworkError = errorMessage.includes('enotfound') || 
                         errorMessage.includes('econnrefused') ||
                         errorMessage.includes('etimedout') ||
                         errorMessage.includes('network') ||
                         errorMessage.includes('connection') ||
                         errorMessage.includes('fetch') ||
                         errorMessage.includes('timeout');
  
  // Don't show errors for "no update available" scenarios
  const isNoUpdateError = errorMessage.includes('no update available') ||
                          errorMessage.includes('already latest') ||
                          errorMessage.includes('404') ||
                          errorMessage.includes('not found');
  
  // Only show dialog for actual network/API errors, not for "no update" scenarios
  if (isNetworkError && !isNoUpdateError) {
    dialog.showErrorBox('Update Check Failed', 'Unable to check for updates. Please check your internet connection and try again later.');
  } else {
    // For "no update available" or minor errors, just log silently
    console.log('Update check completed (no update available):', err.message || err.toString());
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  let log_message = "Download speed: " + progressObj.bytesPerSecond;
  log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
  log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
  console.log(log_message);
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded:', info.version);
  dialog.showMessageBox(BrowserWindow.getFocusedWindow() || null, {
    type: 'info',
    title: 'Update Downloaded',
    message: `P-Stream ${info.version} has been downloaded!`,
    detail: 'The update will be installed when you restart the application.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1
  }).then(result => {
    if (result.response === 0) { // Restart Now button
      autoUpdater.quitAndInstall();
    }
  }).catch(console.error);
});

rpc.on('ready', () => {
  console.log('Discord RPC started');
  // Only set activity if RPC is enabled (store might not be initialized yet)
  if (!store || store.get('discordRPCEnabled', true)) {
    setActivity(currentActivityTitle);
  }
});

app.whenReady().then(async () => {
  // Set the app name
  app.setName('P-Stream');

  // Initialize settings store (after app is ready so app.getPath works)
  store = new SimpleStore({
    defaults: {
      discordRPCEnabled: true
    }
  });

  // Register IPC handlers
  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, async (event, ...args) => {
      return handler(...args);
    });
  });

  // Setup Network Interceptors
  setupInterceptors(session.defaultSession);

  createWindow();

  // Check for updates (only in production)
  if (!app.isPackaged) {
    console.log('Running in development mode, skipping update check');
  } else {
    // Check for updates after a short delay to let the app fully load
    setTimeout(() => {
      autoUpdater.checkForUpdates();
    }, 3000);
  }

  // IPC handler for manual update check
  ipcMain.handle('checkForUpdates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        updateAvailable: result.updateInfo ? true : false,
        version: result.updateInfo?.version || app.getVersion()
      };
    } catch (error) {
      console.error('Manual update check failed:', error);
      return { error: error.message };
    }
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Register global keyboard shortcut (Cmd/Ctrl + ,)
  const shortcut = process.platform === 'darwin' ? 'Command+,' : 'Control+,';
  globalShortcut.register(shortcut, () => {
    createControlPanelWindow();
  });
});

// Unregister all shortcuts when app quits
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on('window-maximize-toggle', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.on('theme-color', (event, color) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.webContents.send('theme-color', color);
});

// IPC handlers for Discord RPC toggle
ipcMain.handle('get-discord-rpc-enabled', () => {
  if (!store) return true; // Default to enabled if store not initialized
  return store.get('discordRPCEnabled', true);
});

ipcMain.handle('set-discord-rpc-enabled', async (event, enabled) => {
  if (!store) return false;
  
  store.set('discordRPCEnabled', enabled);
  
  // Update activity immediately
  if (enabled) {
    // Use stored current activity title
    await setActivity(currentActivityTitle);
  } else {
    // Clear activity if disabled
    if (rpc) {
      rpc.clearActivity().catch(console.error);
    }
  }
  
  return true;
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

rpc.login({ clientId }).catch(console.error);
