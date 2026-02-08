const { app, BrowserWindow, BrowserView, session, ipcMain, dialog, globalShortcut, shell } = require('electron');
const path = require('path');
const { handlers, setupInterceptors } = require('./ipc-handlers');
const { autoUpdater } = require('electron-updater');
const SimpleStore = require('./storage');
const discordRPC = require('./discord-rpc');
const { checkAndAutoUpdate } = require('./auto-updater');
const warpProxy = require('./warp-proxy');

// Paths relative to src/main/ (__dirname)
const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, '..', 'preload');
const RENDERER = path.join(__dirname, '..', 'renderer');
const SETTINGS = path.join(__dirname, '..', 'settings');

// Settings store (will be initialized when app is ready)
let store = null;

// Settings window reference
let settingsWindow = null;

// BrowserView reference (for reset functionality)
let mainBrowserView = null;

const PASSKEY_PERMISSIONS = new Set(['publickey-credentials-create', 'publickey-credentials-get']);
const COMMON_MULTI_TLD = new Set(['co.uk', 'com.au', 'com.br', 'com.mx', 'co.jp', 'co.kr', 'co.in']);

function getOriginFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isLocalhostHost(hostname) {
  if (!hostname) return false;
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost')
  );
}

function isPotentiallySecureOrigin(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && isLocalhostHost(parsed.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

function getRegistrableDomain(hostname) {
  if (!hostname) return null;
  const lower = hostname.toLowerCase();
  if (isLocalhostHost(lower)) return lower;
  if (lower.includes(':')) return lower; // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower)) return lower; // IPv4
  const parts = lower.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (COMMON_MULTI_TLD.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

function isSameSite(requestingUrl, topLevelUrl) {
  try {
    const requestingHost = new URL(requestingUrl).hostname;
    const topLevelHost = new URL(topLevelUrl).hostname;
    return getRegistrableDomain(requestingHost) === getRegistrableDomain(topLevelHost);
  } catch {
    return false;
  }
}

function shouldAllowPasskeyRequest(requestingUrl, topLevelUrl) {
  const requestingOrigin = getOriginFromUrl(requestingUrl);
  if (!requestingOrigin) return false;

  if (!isPotentiallySecureOrigin(requestingUrl)) return false;

  const topLevelOrigin = getOriginFromUrl(topLevelUrl);
  if (!topLevelOrigin) return true;

  if (requestingOrigin === topLevelOrigin) return true;

  return isSameSite(requestingUrl, topLevelUrl);
}

function createWindow() {
  const TITLE_BAR_HEIGHT = 40;
  // Allow platform override via environment variable for previewing different platforms
  const platform = process.env.PLATFORM_OVERRIDE || process.platform;
  const isMac = platform === 'darwin';
  const iconPath = path.join(ROOT, isMac ? 'app.icns' : 'logo.png');

  // Configure window based on platform
  const windowOptions = {
    width: 1300,
    height: 800,
    autoHideMenuBar: true,
    icon: iconPath,
    backgroundColor: '#1f2025',
    fullscreenable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(PRELOAD, 'preload-titlebar.js'),
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

  mainWindow.loadFile(path.join(RENDERER, 'index.html'));

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      persistSessionCookies: true,
      preload: path.join(PRELOAD, 'preload.js'),
    },
  });

  // Store reference to BrowserView globally
  mainBrowserView = view;

  // Attach CORS bypass (extension-equivalent): add CORS headers to responses that match
  // rules registered via prepareStream IPC from the page.
  setupInterceptors(view.webContents.session, {
    getStreamHostname: () => (store ? store.get('streamUrl', 'pstream.mov') : 'pstream.mov'),
  });

  // Allow WebAuthn passkey flows for the current origin only; allow fullscreen for the web player
  const viewSession = view.webContents.session;
  viewSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'fullscreen') {
      callback(true);
      return;
    }
    if (!PASSKEY_PERMISSIONS.has(permission)) {
      callback(false);
      return;
    }

    const requestingUrl = details?.requestingUrl || details?.securityOrigin || webContents.getURL();
    const topLevelUrl = details?.topLevelUrl || webContents.getURL();

    const win = BrowserWindow.fromWebContents(webContents);
    if (win && !win.isFocused()) {
      win.focus();
    }
    if (!webContents.isFocused()) {
      webContents.focus();
    }

    const allowed = shouldAllowPasskeyRequest(requestingUrl, topLevelUrl);
    callback(allowed);
  });

  viewSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === 'fullscreen') return true;
    if (!PASSKEY_PERMISSIONS.has(permission)) return false;
    const topLevelUrl = webContents.getURL();
    return shouldAllowPasskeyRequest(requestingOrigin, topLevelUrl);
  });

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
    fullscreenMenuBarInterval = setInterval(hideMenuBarInFullscreen, 250);
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
    mainWindow.setFullScreen(true);
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setMenu(null);
    mainWindow.webContents.send('window-fullscreen', true);
    setTimeout(() => resizeView(), 0);
    setTimeout(() => resizeView(), 50);

    if (fullscreenMenuBarInterval) {
      clearInterval(fullscreenMenuBarInterval);
    }
    fullscreenMenuBarInterval = setInterval(hideMenuBarInFullscreen, 250);
  });

  // Extracted function to handle fullscreen exit
  function exitFullscreen() {
    mainWindow.setFullScreen(false);
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setMenu(null);
    mainWindow.webContents.send('window-fullscreen', false);
    setTimeout(() => resizeView(), 0);
    setTimeout(() => resizeView(), 50);

    if (fullscreenMenuBarInterval) {
      clearInterval(fullscreenMenuBarInterval);
      fullscreenMenuBarInterval = null;
    }
  }

  // Handle fullscreen exit from both HTML fullscreen and window fullscreen events
  view.webContents.on('leave-html-full-screen', () => {
    exitFullscreen();
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

  // Show error page when the main document fails to load (e.g. no connection, DNS)
  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    // -3 = ERR_ABORTED (user navigated away or cancelled) — don't show error page
    if (errorCode === -3) return;
    const displayUrl = validatedURL || fullUrl;
    const displayError = errorDescription || `ERR_${errorCode}`;
    const errorHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #1f2025;
              color: #e4e4e7;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 24px;
              text-align: center;
            }
            .error-box {
              max-width: 420px;
            }
            h1 {
              font-size: 18px;
              font-weight: 600;
              margin-bottom: 12px;
              color: #f4f4f5;
            }
            p {
              font-size: 14px;
              line-height: 1.5;
              color: #a1a1aa;
            }
            .url {
              word-break: break-all;
              color: #6366f1;
              margin: 12px 0;
              font-size: 13px;
            }
            .hint {
              margin-top: 16px;
              font-size: 13px;
              color: #71717a;
            }
            .settings-btn {
              margin-top: 20px;
              padding: 10px 20px;
              background: #5865f2;
              color: #ffffff;
              border: none;
              border-radius: 6px;
              font-size: 14px;
              font-weight: 500;
              cursor: pointer;
              transition: background-color 0.2s;
            }
            .settings-btn:hover {
              background: #4752c4;
            }
            .settings-btn:active {
              background: #3c45a5;
            }
            .settings-btn.secondary {
              background: #3f3f46;
              margin-left: 8px;
            }
            .settings-btn.secondary:hover {
              background: #52525b;
            }
            .warp-status {
              margin: 2px 0 0 0;
              padding: 0;
              font-size: 12px;
              line-height: 1.3;
              min-height: 16px;
            }
            .error-detail {
              margin-top: 8px;
              font-size: 13px;
              color: #f87171;
              font-family: ui-monospace, monospace;
            }
            .warp-row {
              margin-top: 20px;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 12px;
            }
            .warp-toggle-wrap {
              display: flex;
              align-items: center;
              gap: 10px;
            }
            .warp-label {
              font-size: 14px;
              color: #e4e4e7;
            }
            .toggle {
              position: relative;
              width: 44px;
              height: 24px;
              background: #3f3f46;
              border-radius: 12px;
              cursor: pointer;
              transition: background 0.2s;
            }
            .toggle.on {
              background: #5865f2;
            }
            .toggle-knob {
              position: absolute;
              top: 2px;
              left: 2px;
              width: 20px;
              height: 20px;
              background: #fff;
              border-radius: 50%;
              transition: transform 0.2s;
            }
            .toggle.on .toggle-knob {
              transform: translateX(20px);
            }
            .toggle.busy {
              pointer-events: none;
              opacity: 0.7;
            }
          </style>
        </head>
        <body>
          <div class="error-box">
            <h1>Failed to connect</h1>
            <p>Could not load the page.</p>
            <p class="error-detail">${displayError.replace(/</g, '&lt;')}</p>
            <p class="url">${displayUrl.replace(/</g, '&lt;')}</p>
            <p class="hint">Try Cloudflare WARP to bypass connection issues.</p>
            <div class="warp-row">
              <div class="warp-toggle-wrap">
                <span class="warp-label">Cloudflare WARP</span>
                <div id="warp-toggle" class="toggle" role="button" tabindex="0" aria-label="Toggle WARP"><span class="toggle-knob"></span></div>
              </div>
              <p id="warp-status" class="warp-status" style="color:#71717a;"></p>
              <button class="settings-btn secondary" onclick="if(window.__PSTREAM_OPEN_SETTINGS__)window.__PSTREAM_OPEN_SETTINGS__()">Open Settings</button>
            </div>
            <p class="hint" style="margin-top: 16px;">You can reload with Ctrl+R (or Cmd+R on Mac).</p>
          </div>
          <script>
            (function() {
              var toggleEl = document.getElementById('warp-toggle');
              var statusEl = document.getElementById('warp-status');
              function setToggle(on, busy) {
                toggleEl.classList.toggle('on', on);
                toggleEl.classList.toggle('busy', busy);
              }
              function setStatus(text, color) {
                statusEl.textContent = text || '';
                statusEl.style.color = color || '#71717a';
              }
              async function refreshWarpStatus() {
                if (!window.__PSTREAM_GET_WARP_STATUS__) return;
                try {
                  var status = await window.__PSTREAM_GET_WARP_STATUS__();
                  setToggle(!!status.enabled, false);
                  if (status.enabled && status.proxyHost)
                    setStatus('Connected via ' + status.proxyHost + ':' + (status.proxyPort || ''), '#4ade80');
                  else
                    setStatus('Disabled', '#71717a');
                } catch (e) {
                  setStatus('', '#71717a');
                }
              }
              async function onToggleClick() {
                if (!window.__PSTREAM_SET_WARP_ENABLED__ || !window.__PSTREAM_GET_WARP_STATUS__ || !window.__PSTREAM_RELOAD_STREAM_PAGE__) return;
                var currentlyOn = toggleEl.classList.contains('on');
                var targetOn = !currentlyOn;
                setToggle(targetOn, true);
                if (targetOn) setStatus('Connecting...', '#fbbf24');
                else setStatus('Disconnecting...', '#fbbf24');
                try {
                  var result = await window.__PSTREAM_SET_WARP_ENABLED__(targetOn);
                  if (result && result.success) {
                    setToggle(targetOn, false);
                    if (targetOn) {
                      setStatus('Connected. Reloading page...', '#4ade80');
                      await window.__PSTREAM_RELOAD_STREAM_PAGE__();
                    } else {
                      setStatus('Disabled. Reloading page...', '#71717a');
                      await window.__PSTREAM_RELOAD_STREAM_PAGE__();
                    }
                    return;
                  }
                  setToggle(currentlyOn, false);
                  setStatus(result && result.error ? result.error : 'Failed', '#f87171');
                } catch (e) {
                  setToggle(currentlyOn, false);
                  setStatus(e.message || 'Failed', '#f87171');
                }
              }
              toggleEl.addEventListener('click', onToggleClick);
              toggleEl.addEventListener('keydown', function(e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggleClick(); } });
              refreshWarpStatus();
            })();
          </script>
        </body>
      </html>
    `;
    view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
  });

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

        const isSameMetadata = (a, b) => {
          if (a === b) return true;
          if (!a || !b) return false;
          return a.title === b.title && a.artist === b.artist && a.poster === b.poster;
        };

        const isSameProgress = (a, b) => {
          if (a === b) return true;
          if (!a || !b) return false;
          return (
            a.currentTime === b.currentTime &&
            a.duration === b.duration &&
            a.isPlaying === b.isPlaying &&
            a.playbackState === b.playbackState
          );
        };

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

            const metadataChanged = !isSameMetadata(currentMetadata, lastMetadata);
            const progressChanged = !isSameProgress(currentProgress, lastProgress);

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

  // Right-click opens DevTools for the embedded page (injected so the page captures the event)
  const injectDevToolsShortcut = () => {
    const script = `
      (function() {
        if (window.__PSTREAM_DEVTOOLS_SHORTCUT__) return;
        window.__PSTREAM_DEVTOOLS_SHORTCUT__ = true;
        document.addEventListener('contextmenu', function(e) {
          if (window.__PSTREAM_OPEN_DEVTOOLS__) {
            e.preventDefault();
            e.stopPropagation();
            window.__PSTREAM_OPEN_DEVTOOLS__();
          }
        }, true);
      })();
    `;
    view.webContents.executeJavaScript(script).catch(() => {});
  };

  // Inject media watcher when page loads
  view.webContents.on('did-finish-load', () => {
    injectMediaWatcher();
    injectDevToolsShortcut();
  });

  // Also inject on navigation
  view.webContents.on('did-navigate', () => {
    setTimeout(injectMediaWatcher, 1000);
    setTimeout(injectDevToolsShortcut, 100);
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
      const cleanTitle = title.replace(' • P-Stream', '');
      mainWindow.setTitle(`${cleanTitle} • P-Stream`);
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

  // Cmd/Ctrl + , only when this window is focused (avoids overriding other apps, e.g. Mac preferences)
  const shortcut = process.platform === 'darwin' ? 'Command+,' : 'Control+,';
  mainWindow.on('focus', () => {
    globalShortcut.register(shortcut, () => {
      openSettingsWindow();
    });
  });
  mainWindow.on('blur', () => {
    globalShortcut.unregister(shortcut);
  });
  mainWindow.on('closed', () => {
    globalShortcut.unregister(shortcut);
  });

  // Optional: Open DevTools
  // view.webContents.openDevTools();
}

function openSettingsWindow(parentWindow = null) {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  const platform = process.env.PLATFORM_OVERRIDE || process.platform;
  const isMac = platform === 'darwin';
  const iconPath = path.join(ROOT, isMac ? 'app.icns' : 'logo.png');

  settingsWindow = new BrowserWindow({
    width: 500,
    height: 560,
    minWidth: 400,
    minHeight: 400,
    parent: parentWindow || undefined,
    modal: false,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: '#1f2025',
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(PRELOAD, 'preload-settings.js'),
    },
    title: 'Settings',
    show: false,
  });

  settingsWindow.setMenu(null);
  settingsWindow.loadFile(path.join(SETTINGS, 'settings.html'));

  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
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

  // Show dialog for automatic checks (startup) or when not a manual check from settings
  // Manual checks from settings will show status in the settings window instead
  if (!isManualCheck) {
    // Wait a bit for the window to be ready, especially on startup
    setTimeout(
      () => {
        dialog
          .showMessageBox(BrowserWindow.getFocusedWindow() || null, {
            type: 'info',
            title: 'Update Available',
            message: `A new version (${info.version}) of P-Stream is available!`,
            detail: 'Update now to download and install automatically, or open the releases page in your browser.',
            buttons: ['Update now', 'Open Releases Page', 'Later'],
            defaultId: 0,
            cancelId: 2,
          })
          .then(async (result) => {
            if (result.response === 0) {
              // Update now - trigger the auto-updater (download + install)
              const { checkAndAutoUpdate } = require('./auto-updater');
              await checkAndAutoUpdate();
            } else if (result.response === 1) {
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
      warpLaunchEnabled: false,
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

  ipcMain.handle('openControlPanel', () => {
    openSettingsWindow();
  });

  createWindow();

  // Auto-enable WARP proxy if configured
  if (store.get('warpLaunchEnabled')) {
    try {
      const result = await warpProxy.enableWarpProxy();
      if (result.success && mainBrowserView?.webContents) {
        const proxyConfig = warpProxy.getProxyConfig();
        await mainBrowserView.webContents.session.setProxy(proxyConfig);
        console.log('WARP auto-enabled');
      }
    } catch (err) {
      console.error('WARP auto-enable failed:', err);
    }
  }

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

  // IPC handler to trigger the auto-updater (download + install from GitHub release)
  ipcMain.handle('installUpdate', async () => {
    if (!app.isPackaged) {
      return { updateInstalling: false, error: 'Update is not available in development mode' };
    }
    try {
      const { checkAndAutoUpdate } = require('./auto-updater');
      const updateInstalling = await checkAndAutoUpdate();
      return { updateInstalling };
    } catch (error) {
      console.error('Install update failed:', error);
      return { updateInstalling: false, error: error.message };
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

ipcMain.on('open-settings', (event) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  openSettingsWindow(parentWindow);
});

ipcMain.on('open-embed-devtools', () => {
  if (mainBrowserView && mainBrowserView.webContents) {
    mainBrowserView.webContents.toggleDevTools();
  }
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

  // Remove trailing slash only (keep protocol and path)
  normalizedUrl = normalizedUrl.replace(/\/$/, '');

  // Basic validation - should be a valid domain or URL
  if (!normalizedUrl || normalizedUrl.length === 0) {
    throw new Error('URL cannot be empty');
  }

  store.set('streamUrl', normalizedUrl);

  // Reload the BrowserView with the new URL if it exists
  if (mainBrowserView && mainBrowserView.webContents) {
    // Add https:// if no protocol specified
    const fullUrl =
      normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://')
        ? normalizedUrl
        : `https://${normalizedUrl}/`;
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

// WARP VPN IPC handlers
ipcMain.handle('get-warp-launch-enabled', () => {
  if (!store) return false;
  return store.get('warpLaunchEnabled', false);
});

ipcMain.handle('get-warp-enabled', () => {
  return warpProxy.isWarpProxyEnabled();
});

ipcMain.handle('get-warp-status', () => {
  const enabled = warpProxy.isWarpProxyEnabled();
  if (enabled) {
    return {
      enabled: true,
      proxyHost: warpProxy.PROXY_HOST,
      proxyPort: warpProxy.PROXY_PORT,
    };
  }
  return { enabled: false };
});

ipcMain.handle('set-warp-launch-enabled', async (event, enabled) => {
  try {
    if (!store) return false;
    store.set('warpLaunchEnabled', enabled);
    return true;
  } catch (error) {
    console.error('Failed to set WARP launch setting:', error);
    return false;
  }
});

ipcMain.handle('set-warp-enabled', async (event, enabled) => {
  try {
    if (enabled) {
      const result = await warpProxy.enableWarpProxy();
      if (result.success) {
        // Set proxy for the BrowserView session
        if (mainBrowserView && mainBrowserView.webContents) {
          const proxyConfig = warpProxy.getProxyConfig();
          await mainBrowserView.webContents.session.setProxy(proxyConfig);
        }
        return { success: true, proxyHost: result.proxyHost, proxyPort: result.proxyPort };
      }
      return { success: false, error: result.error };
    } else {
      warpProxy.disableWarpProxy();
      // Clear proxy for the BrowserView session
      if (mainBrowserView && mainBrowserView.webContents) {
        await mainBrowserView.webContents.session.setProxy({ proxyRules: '' });
      }
      return { success: true };
    }
  } catch (error) {
    console.error('Failed to toggle WARP proxy:', error);
    return { success: false, error: error.message };
  }
});

// Reload the stream page (used from the "failed to load" error page after turning on WARP)
ipcMain.handle('reload-stream-page', () => {
  if (!mainBrowserView || !mainBrowserView.webContents) return;
  const streamUrl = store ? store.get('streamUrl', 'pstream.mov') : 'pstream.mov';
  const fullUrl =
    streamUrl.startsWith('http://') || streamUrl.startsWith('https://') ? streamUrl : `https://${streamUrl}/`;
  mainBrowserView.webContents.loadURL(fullUrl);
});

// Cleanup WARP proxy on app quit
app.on('before-quit', () => {
  warpProxy.cleanup();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
