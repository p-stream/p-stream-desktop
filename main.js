const { app, BrowserWindow, BrowserView, session, ipcMain, dialog, globalShortcut, shell } = require('electron');
const path = require('path');
const { handlers, setupInterceptors } = require('./ipc-handlers');
const { autoUpdater } = require('electron-updater');
const SimpleStore = require('./storage');
const discordRPC = require('./discord-rpc');
const { checkAndAutoUpdate } = require('./auto-updater');

// Settings store (will be initialized when app is ready)
let store = null;

// Control panel window reference
let controlPanelWindow = null;

// BrowserView reference (for reset functionality)
let mainBrowserView = null;

function createWindow() {
  const TITLE_BAR_HEIGHT = 40;
  // Allow platform override via environment variable for previewing different platforms
  const platform = process.env.PLATFORM_OVERRIDE || process.platform;
  const isMac = platform === 'darwin';

  // Configure window based on platform
  const windowOptions = {
    width: 1300,
    height: 800,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'logo.png'),
    backgroundColor: '#1f2025',
    fullscreenable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-titlebar.js'),
    },
    title: 'P-Stream',
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
  // Ensure menu bar is hidden (especially important for fullscreen)
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      persistSessionCookies: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Store reference to BrowserView globally
  mainBrowserView = view;

  mainWindow.setBrowserView(view);

  // Set up keyboard shortcuts after view is created
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isMac = platform === 'darwin';
    const isReload =
      (isMac && input.meta && input.key.toLowerCase() === 'r') ||
      (!isMac && input.control && input.key.toLowerCase() === 'r');

    if (isReload && input.type === 'keyDown') {
      // Reload the BrowserView (embedded web page)
      if (view && view.webContents) {
        view.webContents.reload();
      }
      event.preventDefault();
    } else if (input.control && input.shift && input.key.toLowerCase() === 'i' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  const resizeView = () => {
    const { width, height } = mainWindow.getContentBounds();
    const isFullscreen = mainWindow.isFullScreen();
    // In fullscreen, BrowserView should fill the entire window (titlebar is hidden)
    // Otherwise, start below the titlebar
    if (isFullscreen) {
      view.setBounds({ x: 0, y: 0, width, height });
    } else {
      view.setBounds({ x: 0, y: TITLE_BAR_HEIGHT, width, height: height - TITLE_BAR_HEIGHT });
    }
  };

  resizeView();
  view.setAutoResize({ width: true, height: true });

  mainWindow.on('resize', resizeView);
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized', false));

  // Aggressively hide menu bar in fullscreen - set up interval to continuously check
  let fullscreenMenuBarInterval = null;

  const hideMenuBarInFullscreen = () => {
    if (mainWindow.isFullScreen()) {
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setMenu(null);
    }
  };

  // Hide menu bar when entering fullscreen
  mainWindow.on('enter-full-screen', () => {
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setMenu(null);
    // Notify renderer to hide titlebar
    mainWindow.webContents.send('window-fullscreen', true);
    // Resize BrowserView to fill entire window
    resizeView();
    // Continuously check and hide menu bar while in fullscreen
    if (fullscreenMenuBarInterval) {
      clearInterval(fullscreenMenuBarInterval);
    }
    fullscreenMenuBarInterval = setInterval(hideMenuBarInFullscreen, 100);
  });

  // Keep menu bar hidden when leaving fullscreen (since menu is null anyway)
  mainWindow.on('leave-full-screen', () => {
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setMenu(null);
    // Notify renderer to show titlebar
    mainWindow.webContents.send('window-fullscreen', false);
    // Resize BrowserView to account for titlebar
    resizeView();
    // Stop the interval when leaving fullscreen
    if (fullscreenMenuBarInterval) {
      clearInterval(fullscreenMenuBarInterval);
      fullscreenMenuBarInterval = null;
    }
  });

  // Handle fullscreen requests from BrowserView (web content)
  view.webContents.on('enter-html-full-screen', () => {
    // Make the main window go fullscreen when web content requests it
    mainWindow.setFullScreen(true);
    // Force menu bar to be hidden immediately and repeatedly
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setMenu(null);
    // Notify renderer to hide titlebar
    mainWindow.webContents.send('window-fullscreen', true);
    // Resize BrowserView to fill entire window
    setTimeout(() => resizeView(), 0);
    setTimeout(() => resizeView(), 50);
    // Use multiple timeouts to ensure it sticks
    setTimeout(() => {
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setMenu(null);
    }, 0);
    setTimeout(() => {
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setMenu(null);
    }, 50);
    setTimeout(() => {
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setMenu(null);
    }, 100);
    setTimeout(() => {
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setMenu(null);
    }, 200);
    // Start interval to continuously check
    if (fullscreenMenuBarInterval) {
      clearInterval(fullscreenMenuBarInterval);
    }
    fullscreenMenuBarInterval = setInterval(hideMenuBarInFullscreen, 100);
  });

  view.webContents.on('leave-html-full-screen', () => {
    // Exit fullscreen when web content exits fullscreen
    mainWindow.setFullScreen(false);
    // Keep menu bar hidden
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setMenu(null);
    // Notify renderer to show titlebar
    mainWindow.webContents.send('window-fullscreen', false);
    // Resize BrowserView to account for titlebar
    setTimeout(() => resizeView(), 0);
    setTimeout(() => resizeView(), 50);
    // Stop the interval
    if (fullscreenMenuBarInterval) {
      clearInterval(fullscreenMenuBarInterval);
      fullscreenMenuBarInterval = null;
    }
  });

  // Also listen for various window events to ensure menu bar stays hidden
  mainWindow.on('will-resize', () => {
    hideMenuBarInFullscreen();
  });

  mainWindow.on('will-move', () => {
    hideMenuBarInFullscreen();
  });

  // Clean up interval when window is closed
  mainWindow.on('closed', () => {
    if (fullscreenMenuBarInterval) {
      clearInterval(fullscreenMenuBarInterval);
      fullscreenMenuBarInterval = null;
    }
  });

  // Get the saved stream URL or use default
  const streamUrl = store ? store.get('streamUrl', 'pstream.mov') : 'pstream.mov';
  const fullUrl =
    streamUrl.startsWith('http://') || streamUrl.startsWith('https://') ? streamUrl : `https://${streamUrl}/`;
  view.webContents.loadURL(fullUrl);

  // Helper function to extract domain from URL
  function getDomainFromUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, ''); // Remove www. prefix for comparison
    } catch {
      return null;
    }
  }

  // Helper function to check if URL is external
  function isExternalUrl(url) {
    try {
      const currentDomain = getDomainFromUrl(fullUrl);
      const targetDomain = getDomainFromUrl(url);
      if (!currentDomain || !targetDomain) return true; // If we can't parse, treat as external
      return currentDomain !== targetDomain;
    } catch {
      return true; // If parsing fails, treat as external
    }
  }

  // Handle new window requests (middle-click, Ctrl+Click, target="_blank", etc.)
  view.webContents.setWindowOpenHandler(({ url }) => {
    // Check if the URL is external (different domain)
    if (isExternalUrl(url)) {
      // Open external links in the default browser
      shell.openExternal(url).catch((err) => {
        console.error('Failed to open external URL:', err);
      });
      return { action: 'deny' }; // Prevent opening in Electron window
    } else {
      // Internal links: navigate in the current view
      view.webContents.loadURL(url);
      return { action: 'deny' }; // Prevent opening a new window
    }
  });

  // Also handle the deprecated 'new-window' event as a fallback
  view.webContents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    // Check if the URL is external (different domain)
    if (isExternalUrl(navigationUrl)) {
      // Open external links in the default browser
      shell.openExternal(navigationUrl).catch((err) => {
        console.error('Failed to open external URL:', err);
      });
    } else {
      // Internal links: navigate in the current view
      view.webContents.loadURL(navigationUrl);
    }
  });

  // Inject script to watch MediaSession API and video elements for Discord RPC
  const injectMediaWatcher = () => {
    const script = `
      (function() {
        if (window.__pstreamMediaWatcherInjected) return;
        window.__pstreamMediaWatcherInjected = true;

        let lastMetadata = null;
        let lastProgress = null;
        let updateInterval = null;

        // Helper to convert relative URLs to absolute
        const getAbsoluteUrl = (url) => {
          if (!url) return null;
          try {
            // If already absolute, return as is
            if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
              return url;
            }
            // Convert relative to absolute
            return new URL(url, window.location.href).href;
          } catch (e) {
            return url; // Return original if conversion fails
          }
        };

        const sendMediaUpdate = () => {
          try {
            const metadata = navigator.mediaSession?.metadata;
            const playbackState = navigator.mediaSession?.playbackState;
            
            // Find video element to get progress
            const video = document.querySelector('video');
            let currentTime = null;
            let duration = null;
            let isPlaying = false;

            if (video && !isNaN(video.currentTime) && !isNaN(video.duration)) {
              currentTime = video.currentTime;
              duration = video.duration;
              isPlaying = !video.paused;
            }

            // Extract metadata and convert poster URL to absolute
            let posterUrl = null;
            if (metadata?.artwork && metadata.artwork.length > 0) {
              posterUrl = getAbsoluteUrl(metadata.artwork[0].src);
            }

            const currentMetadata = metadata ? {
              title: metadata.title || null,
              artist: metadata.artist || null,
              poster: posterUrl
            } : null;

            const currentProgress = {
              currentTime: currentTime !== null && !isNaN(currentTime) ? currentTime : null,
              duration: duration !== null && !isNaN(duration) ? duration : null,
              isPlaying,
              playbackState
            };

            const metadataChanged = JSON.stringify(currentMetadata) !== JSON.stringify(lastMetadata);
            const progressChanged = JSON.stringify(currentProgress) !== JSON.stringify(lastProgress);

            if (metadataChanged || progressChanged) {
              lastMetadata = currentMetadata;
              lastProgress = currentProgress;

              // Send to main process via window.postMessage (will be caught by preload)
              window.postMessage({
                name: 'updateMediaMetadata',
                body: {
                  metadata: currentMetadata,
                  progress: currentProgress
                }
              }, '*');
            }
          } catch (e) {
            console.error('[P-Stream Media Watcher]', e);
          }
        };

        // Watch for MediaSession changes
        if (navigator.mediaSession) {
          // Intercept MediaSession.metadata setter to detect changes immediately
          const originalMediaSession = navigator.mediaSession;
          let currentMetadataValue = originalMediaSession.metadata;
          
          Object.defineProperty(navigator.mediaSession, 'metadata', {
            get: function() {
              return currentMetadataValue;
            },
            set: function(value) {
              currentMetadataValue = value;
              // Trigger update when metadata is set
              setTimeout(sendMediaUpdate, 100);
            },
            configurable: true,
            enumerable: true
          });

          // Poll for changes every 2 seconds (as backup)
          updateInterval = setInterval(sendMediaUpdate, 2000);

          // Also listen for video events
          const videoEvents = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'seeked', 'progress'];
          videoEvents.forEach(event => {
            document.addEventListener(event, sendMediaUpdate, true);
          });

          // Initial check after a short delay
          setTimeout(sendMediaUpdate, 1000);
        }
      })();
    `;

    view.webContents.executeJavaScript(script).catch(console.error);
  };

  // Inject media watcher when page loads
  view.webContents.on('did-finish-load', () => {
    injectMediaWatcher();
  });

  // Also inject on navigation
  view.webContents.on('did-navigate', () => {
    setTimeout(injectMediaWatcher, 1000);
  });

  // Update title when page title changes
  view.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();

    if (title === 'P-Stream') {
      mainWindow.setTitle('P-Stream');
      discordRPC.setCurrentActivityTitle(null);
      discordRPC.setCurrentMediaMetadata(null);
      discordRPC.setActivity(null);
    } else {
      const cleanTitle = title.replace(' - P-Stream', '');
      mainWindow.setTitle(`${cleanTitle} - P-Stream`);
      discordRPC.setCurrentActivityTitle(cleanTitle);
      // Only use title if we don't have media metadata
      if (!discordRPC.getCurrentMediaMetadata()) {
        discordRPC.setActivity(cleanTitle);
      }
    }

    mainWindow.webContents.send('title-changed', mainWindow.getTitle());
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('title-changed', mainWindow.getTitle());
    mainWindow.webContents.send('window-maximized', mainWindow.isMaximized());
    mainWindow.webContents.send('platform-changed', platform);
    // Send initial fullscreen state
    mainWindow.webContents.send('window-fullscreen', mainWindow.isFullScreen());
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
      preload: path.join(__dirname, 'preload-control-panel.js'),
    },
    title: 'P-Stream Control Panel',
    show: false,
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
autoUpdater.autoDownload = false; // Don't auto-download, users download manually
autoUpdater.autoInstallOnAppQuit = false; // Don't auto-install, users install manually

// Configure updater for GitHub releases
// electron-updater automatically reads from package.json build.publish config
// But we can explicitly configure it for better error handling
if (app.isPackaged) {
  try {
    // electron-updater v6+ automatically uses package.json config
    // But we can explicitly set it to ensure it works
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'p-stream',
      repo: 'p-stream-desktop',
    });
    console.log('Auto-updater configured for GitHub releases');
  } catch (error) {
    console.error('Failed to configure auto-updater:', error);
  }
}

// Track if we're doing a manual check to avoid duplicate dialogs
let isManualCheck = false;
// Track if we're checking on startup (to handle pending updates)
let isStartupCheck = false;

// Simple version comparison function (handles semantic versioning)
function compareVersions(current, latest) {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;

    if (latestPart > currentPart) return 1; // latest is newer
    if (latestPart < currentPart) return -1; // current is newer
  }

  return 0; // versions are equal
}

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);

  // Show dialog for automatic checks (startup) or when not a manual check from control panel
  // Manual checks from control panel will show status in the control panel instead
  if (!isManualCheck) {
    // Wait a bit for the window to be ready, especially on startup
    setTimeout(
      () => {
        dialog
          .showMessageBox(BrowserWindow.getFocusedWindow() || null, {
            type: 'info',
            title: 'Update Available',
            message: `A new version (${info.version}) of P-Stream is available!`,
            detail: 'Would you like to open the releases page to download the update?',
            buttons: ['Open Releases Page', 'Later'],
            defaultId: 0,
            cancelId: 1,
          })
          .then((result) => {
            if (result.response === 0) {
              // Open Releases Page button
              shell.openExternal('https://github.com/p-stream/p-stream-desktop/releases');
            }
          })
          .catch(console.error);
      },
      isStartupCheck ? 2000 : 0,
    ); // Wait 2 seconds on startup to ensure window is ready
  }
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
  const isNetworkError =
    errorMessage.includes('enotfound') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('etimedout') ||
    errorMessage.includes('network') ||
    errorMessage.includes('connection') ||
    errorMessage.includes('fetch') ||
    errorMessage.includes('timeout');

  // Don't show errors for "no update available" scenarios
  const isNoUpdateError =
    errorMessage.includes('no update available') ||
    errorMessage.includes('already latest') ||
    errorMessage.includes('404') ||
    errorMessage.includes('not found');

  // Only show dialog for actual network/API errors, not for "no update" scenarios
  if (isNetworkError && !isNoUpdateError) {
    dialog.showErrorBox(
      'Update Check Failed',
      'Unable to check for updates. Please check your internet connection and try again later.',
    );
  } else {
    // For "no update available" or minor errors, just log silently
    console.log('Update check completed (no update available):', err.message || err.toString());
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  let log_message = 'Download speed: ' + progressObj.bytesPerSecond;
  log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
  log_message = log_message + ' (' + progressObj.transferred + '/' + progressObj.total + ')';
  console.log(log_message);
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded:', info.version);
  // Note: We no longer handle installation automatically
  // Users will download manually from GitHub releases
});

app.whenReady().then(async () => {
  // Set the app name
  app.setName('P-Stream');

  // Check for updates FIRST (before creating window)
  // If an update is being installed, the app will quit and this won't continue
  const updateInProgress = await checkAndAutoUpdate();
  if (updateInProgress) {
    // Update is being installed, app is quitting
    return;
  }

  // Initialize settings store (after app is ready so app.getPath works)
  store = new SimpleStore({
    defaults: {
      discordRPCEnabled: true,
      streamUrl: 'pstream.mov',
    },
  });

  // Initialize Discord RPC
  discordRPC.initialize(store);

  // Register IPC handlers
  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, async (event, ...args) => {
      return handler(...args);
    });
  });

  // Setup Network Interceptors
  setupInterceptors(session.defaultSession);

  createWindow();

  // IPC handler for manual update check
  ipcMain.handle('checkForUpdates', async () => {
    try {
      // In development mode, autoUpdater.checkForUpdates() returns null
      if (!app.isPackaged) {
        return {
          updateAvailable: false,
          version: app.getVersion(),
          isDevelopment: true,
          message: 'Update checking is not available in development mode',
        };
      }

      // Set flag to indicate this is a manual check (prevents duplicate dialogs)
      isManualCheck = true;
      console.log('Manual update check initiated...');

      const result = await autoUpdater.checkForUpdates();

      // Handle null result (can happen if update check is skipped or no releases found)
      if (!result) {
        console.log('Update check returned null - no releases found or update server not configured');
        isManualCheck = false;
        return {
          updateAvailable: false,
          version: app.getVersion(),
          message: 'No updates available or update server not found. Make sure releases exist on GitHub.',
        };
      }

      // Check if updateInfo exists and compare versions
      if (result.updateInfo) {
        const currentVersion = app.getVersion();
        const updateVersion = result.updateInfo.version;
        const versionComparison = compareVersions(currentVersion, updateVersion);

        console.log(
          `Version comparison: current=${currentVersion}, latest=${updateVersion}, comparison=${versionComparison}`,
        );

        // Only return updateAvailable if the update version is actually newer
        if (versionComparison > 0) {
          console.log('Update available:', updateVersion);
          // Reset flag after a short delay to allow event handlers to process
          setTimeout(() => {
            isManualCheck = false;
          }, 500);
          return {
            updateAvailable: true,
            version: updateVersion,
            currentVersion: currentVersion,
          };
        } else {
          console.log('Already on latest version:', currentVersion);
          isManualCheck = false;
          return {
            updateAvailable: false,
            version: currentVersion,
            message: 'Already up to date',
          };
        }
      }

      // No update available
      console.log('No update available');
      isManualCheck = false;
      return {
        updateAvailable: false,
        version: app.getVersion(),
      };
    } catch (error) {
      // Always reset flag on error
      isManualCheck = false;

      console.error('Manual update check failed:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
      });

      // Provide user-friendly error messages
      const errorMessage = error.message || error.toString().toLowerCase();
      let userMessage = 'Unable to check for updates';

      if (
        errorMessage.includes('network') ||
        errorMessage.includes('connection') ||
        errorMessage.includes('fetch') ||
        errorMessage.includes('enotfound') ||
        errorMessage.includes('econnrefused')
      ) {
        userMessage = 'Network error. Please check your internet connection.';
      } else if (
        errorMessage.includes('not found') ||
        errorMessage.includes('404') ||
        errorMessage.includes('no published releases') ||
        errorMessage.includes('release not found')
      ) {
        userMessage = 'Update server not found. Make sure releases exist on GitHub with update metadata files.';
      } else if (errorMessage.includes('403') || errorMessage.includes('unauthorized')) {
        userMessage = 'Update server access denied. The repository may be private or requires authentication.';
      } else {
        userMessage = `Update check failed: ${error.message || 'Unknown error'}`;
      }

      return {
        error: userMessage,
        version: app.getVersion(),
      };
    }
  });

  // IPC handler for restarting the app (useful in development mode)
  ipcMain.handle('restartApp', () => {
    try {
      console.log('Restarting application...');
      app.relaunch();
      app.exit(0);
      return { success: true };
    } catch (error) {
      console.error('Failed to restart app:', error);
      return { success: false, error: error.message };
    }
  });

  // IPC handler for opening releases page in external browser
  ipcMain.handle('openReleasesPage', () => {
    try {
      shell.openExternal('https://github.com/p-stream/p-stream-desktop/releases');
      return { success: true };
    } catch (error) {
      console.error('Failed to open releases page:', error);
      return { success: false, error: error.message };
    }
  });

  // IPC handler for uninstalling the app
  ipcMain.handle('uninstall-app', async () => {
    try {
      const platform = process.platform;
      const isMac = platform === 'darwin';
      const isWindows = platform === 'win32';
      const isLinux = platform === 'linux';

      // First, clear all app data
      try {
        // Clear settings store
        if (store) {
          store.clear();
        }

        // Clear cookies and storage from the BrowserView session
        if (mainBrowserView && mainBrowserView.webContents) {
          const viewSession = mainBrowserView.webContents.session;
          await viewSession.clearStorageData({
            storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'websql', 'cachestorage', 'filesystem'],
          });
        }

        // Clear default session cookies
        await session.defaultSession.clearStorageData({
          storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'websql', 'cachestorage', 'filesystem'],
        });
      } catch (error) {
        console.error('Error clearing app data during uninstall:', error);
        // Continue with uninstall even if data clearing fails
      }

      // Platform-specific uninstall handling
      if (isMac) {
        // macOS: Try to move the app bundle to trash
        try {
          // Get the app path - in production, this should be the .app bundle
          const appPath = app.getPath('exe');
          // In a packaged app, appPath points to the executable inside the bundle
          // We need to get the .app bundle path
          let appBundlePath = appPath;

          // If we're in a .app bundle, get the bundle path
          if (appPath.includes('.app/Contents/MacOS/')) {
            appBundlePath = appPath.substring(0, appPath.indexOf('.app/') + 5);
          } else if (appPath.endsWith('.app')) {
            appBundlePath = appPath;
          } else {
            // In development or if path detection fails, try to find the app
            // For now, we'll just show instructions
            dialog.showMessageBoxSync(BrowserWindow.getFocusedWindow() || null, {
              type: 'info',
              title: 'Uninstall Instructions',
              message: 'To complete the uninstall:',
              detail:
                '1. All app data has been cleared.\n' +
                '2. Please drag P-Stream.app from your Applications folder to the Trash.\n' +
                '3. Empty the Trash to complete the removal.',
              buttons: ['OK'],
            });
            app.quit();
            return { success: true, message: 'App data cleared. Please manually remove the app from Applications.' };
          }

          // Try to move to trash
          const moved = shell.moveItemToTrash(appBundlePath, false);
          if (moved) {
            // Wait a moment then quit
            setTimeout(() => {
              app.quit();
            }, 1000);
            return {
              success: true,
              message: 'App has been moved to Trash. Please empty the Trash to complete the removal.',
            };
          } else {
            // If move to trash fails, show instructions
            dialog.showMessageBoxSync(BrowserWindow.getFocusedWindow() || null, {
              type: 'info',
              title: 'Uninstall Instructions',
              message: 'To complete the uninstall:',
              detail:
                '1. All app data has been cleared.\n' +
                '2. Please drag P-Stream.app from your Applications folder to the Trash.\n' +
                '3. Empty the Trash to complete the removal.',
              buttons: ['OK'],
            });
            app.quit();
            return { success: true, message: 'App data cleared. Please manually remove the app from Applications.' };
          }
        } catch (error) {
          console.error('Error moving app to trash:', error);
          dialog.showMessageBoxSync(BrowserWindow.getFocusedWindow() || null, {
            type: 'info',
            title: 'Uninstall Instructions',
            message: 'To complete the uninstall:',
            detail:
              '1. All app data has been cleared.\n' +
              '2. Please drag P-Stream.app from your Applications folder to the Trash.\n' +
              '3. Empty the Trash to complete the removal.',
            buttons: ['OK'],
          });
          app.quit();
          return { success: true, message: 'App data cleared. Please manually remove the app from Applications.' };
        }
      } else if (isWindows) {
        // Windows: Show instructions to use Add/Remove Programs
        const dialogResult = dialog.showMessageBoxSync(BrowserWindow.getFocusedWindow() || null, {
          type: 'info',
          title: 'Uninstall Instructions',
          message: 'To complete the uninstall:',
          detail:
            '1. All app data has been cleared.\n' +
            '2. Open Settings > Apps > Apps & features\n' +
            '3. Find "P-Stream" and click Uninstall\n' +
            '4. Follow the uninstaller prompts',
          buttons: ['Open Settings', 'OK'],
          defaultId: 0,
        });

        if (dialogResult === 0) {
          // Open Windows Settings to Apps
          shell.openExternal('ms-settings:appsfeatures');
        }

        app.quit();
        return {
          success: true,
          message: 'App data cleared. Please use Windows Settings to complete the uninstall.',
        };
      } else if (isLinux) {
        // Linux: Show instructions (AppImage can be deleted directly)
        dialog.showMessageBoxSync(BrowserWindow.getFocusedWindow() || null, {
          type: 'info',
          title: 'Uninstall Instructions',
          message: 'To complete the uninstall:',
          detail:
            '1. All app data has been cleared.\n' +
            '2. Delete the P-Stream AppImage file from where you saved it.\n' +
            '3. Remove any desktop entries or shortcuts you created.',
          buttons: ['OK'],
        });

        app.quit();
        return {
          success: true,
          message: 'App data cleared. Please manually delete the AppImage file.',
        };
      } else {
        // Unknown platform
        app.quit();
        return {
          success: true,
          message: "App data cleared. Please manually remove the app using your system's standard method.",
        };
      }
    } catch (error) {
      console.error('Failed to uninstall app:', error);
      return {
        success: false,
        error: error.message || 'Failed to uninstall the app. You may need to uninstall it manually.',
      };
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

// IPC handler for getting app version
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// IPC handlers for stream URL
ipcMain.handle('get-stream-url', () => {
  if (!store) return 'pstream.mov';
  return store.get('streamUrl', 'pstream.mov');
});

ipcMain.handle('set-stream-url', async (event, url) => {
  if (!store) return false;

  // Validate and normalize URL
  let normalizedUrl = url.trim();

  // Remove protocol if present (we'll add it when loading)
  if (normalizedUrl.startsWith('http://')) {
    normalizedUrl = normalizedUrl.replace('http://', '');
  }
  if (normalizedUrl.startsWith('https://')) {
    normalizedUrl = normalizedUrl.replace('https://', '');
  }

  // Remove trailing slash
  normalizedUrl = normalizedUrl.replace(/\/$/, '');

  // Basic validation - should be a valid domain
  if (!normalizedUrl || normalizedUrl.length === 0) {
    throw new Error('URL cannot be empty');
  }

  store.set('streamUrl', normalizedUrl);

  // Reload the BrowserView with the new URL if it exists
  if (mainBrowserView && mainBrowserView.webContents) {
    const fullUrl = `https://${normalizedUrl}/`;
    mainBrowserView.webContents.loadURL(fullUrl);
  }

  // Update Discord RPC button URL
  discordRPC.updateActivity();

  return true;
});

// IPC handler for resetting the app
ipcMain.handle('reset-app', async () => {
  try {
    // Clear local storage (settings)
    if (store) {
      store.clear();
    }

    // Clear cookies and storage from the BrowserView session
    if (mainBrowserView && mainBrowserView.webContents) {
      const viewSession = mainBrowserView.webContents.session;

      // Clear cookies
      await viewSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'websql', 'cachestorage', 'filesystem'],
      });
    }

    // Also clear default session cookies (in case they're used elsewhere)
    await session.defaultSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'websql', 'cachestorage', 'filesystem'],
    });

    // Reload the BrowserView with the default URL
    if (mainBrowserView && mainBrowserView.webContents) {
      const defaultUrl = 'https://pstream.mov/';
      mainBrowserView.webContents.loadURL(defaultUrl);
    }

    return { success: true };
  } catch (error) {
    console.error('Error resetting app:', error);
    return { success: false, error: error.message };
  }
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
