'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

// GitHub repository configuration
const GITHUB_OWNER = 'p-stream';
const GITHUB_REPO = 'p-stream-desktop';

// Updater window reference
let updaterWindow = null;

/**
 * Compare two semantic versions
 * @returns 1 if latest > current, -1 if latest < current, 0 if equal
 */
function compareVersions(current, latest) {
  const currentParts = current.replace(/^v/, '').split('.').map(Number);
  const latestParts = latest.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;

    if (latestPart > currentPart) return 1;
    if (latestPart < currentPart) return -1;
  }

  return 0;
}

/**
 * Fetch JSON from a URL using https
 */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'P-Stream-Desktop-Updater',
        Accept: 'application/vnd.github.v3+json',
      },
    };

    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      timeout: 5000, // 5 second timeout
      ...options,
    };

    const req = https
      .get(reqOptions, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchJSON(res.headers.location).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject)
      .on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
  });
}

/**
 * Download a file with progress reporting
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const doRequest = (requestUrl) => {
      const urlObj = new URL(requestUrl);
      const reqOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: { 'User-Agent': 'P-Stream-Desktop-Updater' },
      };

      https
        .get(reqOptions, (res) => {
          // Handle redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doRequest(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            file.close();
            fs.unlink(destPath, () => {});
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }

          const totalSize = parseInt(res.headers['content-length'], 10) || 0;
          let downloadedSize = 0;

          res.on('data', (chunk) => {
            downloadedSize += chunk.length;
            if (totalSize > 0 && onProgress) {
              onProgress(Math.round((downloadedSize / totalSize) * 100));
            }
          });

          res.pipe(file);

          file.on('finish', () => {
            file.close();
            resolve(destPath);
          });

          file.on('error', (err) => {
            file.close();
            fs.unlink(destPath, () => {});
            reject(err);
          });
        })
        .on('error', (err) => {
          file.close();
          fs.unlink(destPath, () => {});
          reject(err);
        });
    };

    doRequest(url);
  });
}

/**
 * Get the appropriate installer asset for the current platform
 */
function getInstallerAsset(assets) {
  const platform = process.platform;
  const arch = process.arch;

  for (const asset of assets) {
    const name = asset.name.toLowerCase();

    if (platform === 'win32') {
      // Prefer x64 exe for Windows
      if (name.endsWith('.exe')) {
        if (arch === 'x64' && name.includes('x64')) return asset;
        if (arch === 'arm64' && name.includes('arm64')) return asset;
        // Fallback to any exe if arch-specific not found
        if (!name.includes('x64') && !name.includes('arm64')) return asset;
      }
    } else if (platform === 'linux') {
      // AppImage for Linux
      if (name.endsWith('.appimage')) {
        if (arch === 'x64' && name.includes('x64')) return asset;
        if (arch === 'arm64' && name.includes('arm64')) return asset;
        if (!name.includes('x64') && !name.includes('arm64')) return asset;
      }
    } else if (platform === 'darwin') {
      // DMG for macOS
      if (name.endsWith('.dmg')) {
        if (arch === 'x64' && name.includes('x64')) return asset;
        if (arch === 'arm64' && name.includes('arm64')) return asset;
        if (!name.includes('x64') && !name.includes('arm64')) return asset;
      }
    }
  }

  // Fallback: return first matching platform asset
  for (const asset of assets) {
    const name = asset.name.toLowerCase();
    if (platform === 'win32' && name.endsWith('.exe')) return asset;
    if (platform === 'linux' && name.endsWith('.appimage')) return asset;
    if (platform === 'darwin' && name.endsWith('.dmg')) return asset;
  }

  return null;
}

/**
 * Create the updater splash window
 */
function createUpdaterWindow() {
  updaterWindow = new BrowserWindow({
    width: 400,
    height: 200,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#1f2025',
    icon: path.join(__dirname, process.platform === 'darwin' ? 'app.icns' : 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-updater.js'),
    },
  });

  updaterWindow.loadFile(path.join(__dirname, 'updater.html'));

  return updaterWindow;
}

/**
 * Send progress update to the updater window
 */
function sendProgress(percent, status) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send('update-progress', { percent, status });
  }
}

/**
 * Run the installer based on platform
 */
function runInstaller(installerPath) {
  return new Promise((resolve, reject) => {
    const platform = process.platform;

    try {
      if (platform === 'win32') {
        // Run NSIS installer silently
        // /S = silent, the installer will auto-launch the app after (runAfterFinish: true in package.json)
        const installer = spawn(installerPath, ['/S'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        installer.unref();
        resolve();
      } else if (platform === 'linux') {
        // For AppImage, make it executable and show in file manager
        fs.chmodSync(installerPath, '755');
        // Open file manager to the downloaded AppImage
        const { shell } = require('electron');
        shell.showItemInFolder(installerPath);
        resolve();
      } else if (platform === 'darwin') {
        // For DMG, open it for manual installation
        spawn('open', [installerPath], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        resolve();
      } else {
        reject(new Error('Unsupported platform'));
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Check for updates and install if available
 * @returns {Promise<boolean>} true if update is being installed (app should quit), false otherwise
 */
async function checkAndAutoUpdate() {
  // Skip in development mode
  if (!app.isPackaged) {
    console.log('[AutoUpdater] Skipping update check in development mode');
    return false;
  }

  try {
    console.log('[AutoUpdater] Checking for updates...');

    // Fetch latest release from GitHub
    const releaseUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
    const release = await fetchJSON(releaseUrl);

    if (!release || !release.tag_name) {
      console.log('[AutoUpdater] No release found');
      return false;
    }

    const latestVersion = release.tag_name.replace(/^v/, '');
    const currentVersion = app.getVersion();

    console.log(`[AutoUpdater] Current: ${currentVersion}, Latest: ${latestVersion}`);

    // Check if update is needed
    if (compareVersions(currentVersion, latestVersion) !== 1) {
      console.log('[AutoUpdater] Already up to date');
      return false;
    }

    console.log('[AutoUpdater] Update available!');

    // Find the appropriate installer asset
    const asset = getInstallerAsset(release.assets || []);
    if (!asset) {
      console.log('[AutoUpdater] No suitable installer found for this platform');
      return false;
    }

    console.log(`[AutoUpdater] Downloading: ${asset.name}`);

    // Create updater window
    createUpdaterWindow();

    // Wait for window to be ready
    await new Promise((resolve) => {
      updaterWindow.once('ready-to-show', resolve);
      updaterWindow.show();
    });

    sendProgress(0, 'Downloading update...');

    // Download the installer to temp directory
    const tempPath = path.join(app.getPath('temp'), asset.name);
    await downloadFile(asset.browser_download_url, tempPath, (percent) => {
      sendProgress(percent, `Downloading update... ${percent}%`);
    });

    sendProgress(100, 'Installing update...');

    // Small delay to show the "Installing" status
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Run the installer
    await runInstaller(tempPath);

    // On Windows, quit the app - the installer will restart it
    // On Linux/macOS, we've shown the file/opened the DMG - user will handle it
    if (process.platform === 'win32') {
      console.log('[AutoUpdater] Installer launched, quitting app...');
      app.quit();
      return true;
    } else {
      // Close updater window and let user continue
      if (updaterWindow && !updaterWindow.isDestroyed()) {
        updaterWindow.close();
        updaterWindow = null;
      }
      return false;
    }
  } catch (error) {
    console.error('[AutoUpdater] Error:', error);

    // Close updater window on error
    if (updaterWindow && !updaterWindow.isDestroyed()) {
      updaterWindow.close();
      updaterWindow = null;
    }

    return false;
  }
}

/**
 * Get update info without installing (for UI display)
 */
async function getUpdateInfo() {
  try {
    const releaseUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
    const release = await fetchJSON(releaseUrl);

    if (!release || !release.tag_name) {
      return { updateAvailable: false, currentVersion: app.getVersion() };
    }

    const latestVersion = release.tag_name.replace(/^v/, '');
    const currentVersion = app.getVersion();
    const updateAvailable = compareVersions(currentVersion, latestVersion) === 1;

    return {
      updateAvailable,
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url,
      releaseName: release.name,
      releaseNotes: release.body,
    };
  } catch (error) {
    console.error('[AutoUpdater] Error getting update info:', error);
    return { updateAvailable: false, currentVersion: app.getVersion(), error: error.message };
  }
}

module.exports = {
  checkAndAutoUpdate,
  getUpdateInfo,
  compareVersions,
};
