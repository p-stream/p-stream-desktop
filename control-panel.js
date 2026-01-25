const toggle = document.getElementById('discord-rpc-toggle');
const versionText = document.getElementById('version-text');
const checkUpdatesBtn = document.getElementById('check-updates-btn');
const resetAppBtn = document.getElementById('reset-app-btn');
const streamUrlInput = document.getElementById('stream-url-input');
const saveUrlBtn = document.getElementById('save-url-btn');

// Load initial state
async function loadState() {
  try {
    const enabled = await window.controlPanel.getDiscordRPCEnabled();
    toggle.checked = enabled;
  } catch (error) {
    console.error('Failed to load Discord RPC state:', error);
  }

  try {
    const version = await window.controlPanel.getVersion();
    versionText.textContent = `v${version}`;
  } catch (error) {
    console.error('Failed to load version:', error);
    versionText.textContent = 'Unknown';
  }

  try {
    const url = await window.controlPanel.getStreamUrl();
    streamUrlInput.value = url;
  } catch (error) {
    console.error('Failed to load stream URL:', error);
  }
}

// Handle toggle change
toggle.addEventListener('change', async (event) => {
  try {
    await window.controlPanel.setDiscordRPCEnabled(event.target.checked);
  } catch (error) {
    console.error('Failed to update Discord RPC state:', error);
    // Revert toggle on error
    toggle.checked = !event.target.checked;
  }
});

// Track update state
let updateAvailable = false;
let updateVersion = null;
let updateDownloaded = false;

// Listen for update download completion
window.controlPanel.onUpdateDownloaded((data) => {
  console.log('Update downloaded event received:', data);
  updateDownloaded = true;
  versionText.textContent = `Download complete! Click to install v${data.version}`;
  checkUpdatesBtn.textContent = 'Install & Restart';
  checkUpdatesBtn.disabled = false;
});

// Handle update check/install button
checkUpdatesBtn.addEventListener('click', async () => {
  const buttonText = checkUpdatesBtn.textContent;

  // Handle different button states
  if (buttonText === 'Install') {
    await handleInstallUpdate();
  } else if (buttonText === 'Install & Restart') {
    await handleRestartAndInstall();
  } else {
    // Otherwise, check for updates
    await handleCheckForUpdates();
  }
});

async function handleCheckForUpdates() {
  checkUpdatesBtn.disabled = true;
  checkUpdatesBtn.textContent = 'Checking...';
  updateAvailable = false;
  updateVersion = null;

  try {
    const result = await window.controlPanel.checkForUpdates();

    if (result.error) {
      // Show error message
      versionText.textContent = result.error;
      checkUpdatesBtn.textContent = 'Check for Updates';
      // Reset after a few seconds
      setTimeout(() => {
        if (versionText.textContent === result.error) {
          versionText.textContent = `v${result.version || 'Unknown'}`;
        }
      }, 5000);
    } else if (result.isDevelopment) {
      // Development mode - show friendly message
      versionText.textContent = result.message || 'Development mode';
      checkUpdatesBtn.textContent = 'Check for Updates';
      setTimeout(() => {
        versionText.textContent = `v${result.version}`;
      }, 3000);
    } else if (result.updateAvailable) {
      // Update available - show Install button
      updateAvailable = true;
      updateVersion = result.version;
      versionText.textContent = `Update available: v${result.version}`;
      checkUpdatesBtn.textContent = 'Install';
    } else {
      // Already up to date
      const displayVersion = result.version || result.currentVersion || 'Unknown';
      versionText.textContent = `v${displayVersion} (Latest)`;
      checkUpdatesBtn.textContent = 'Up to Date';
      setTimeout(() => {
        checkUpdatesBtn.textContent = 'Check for Updates';
      }, 2000);
    }
  } catch (error) {
    console.error('Failed to check for updates:', error);
    versionText.textContent = 'Error checking for updates';
    checkUpdatesBtn.textContent = 'Check for Updates';
    // Reset after a few seconds
    setTimeout(() => {
      if (versionText.textContent === 'Error checking for updates') {
        window.controlPanel.getVersion().then((version) => {
          versionText.textContent = `v${version}`;
        });
      }
    }, 5000);
  } finally {
    checkUpdatesBtn.disabled = false;
  }
}

async function handleInstallUpdate() {
  // Check if update is already downloaded
  const downloadStatus = await window.controlPanel.isUpdateDownloaded();
  if (downloadStatus.downloaded) {
    updateDownloaded = true;
    versionText.textContent = `Download complete! Click to install v${downloadStatus.version}`;
    checkUpdatesBtn.textContent = 'Install & Restart';
    checkUpdatesBtn.disabled = false;
    return;
  }

  checkUpdatesBtn.disabled = true;
  checkUpdatesBtn.textContent = 'Downloading...';
  versionText.textContent = 'Downloading update...';
  updateDownloaded = false;

  try {
    // Start download
    const downloadResult = await window.controlPanel.downloadUpdate();

    if (downloadResult.error) {
      versionText.textContent = `Error: ${downloadResult.error}`;
      checkUpdatesBtn.textContent = 'Install';
      setTimeout(() => {
        versionText.textContent = `Update available: v${updateVersion}`;
      }, 3000);
      checkUpdatesBtn.disabled = false;
      return;
    }

    // Download started - show progress
    // The update-downloaded event will be handled by the listener above
    versionText.textContent = 'Downloading update...';
    checkUpdatesBtn.textContent = 'Downloading...';
    checkUpdatesBtn.disabled = true;
  } catch (error) {
    console.error('Failed to download update:', error);
    versionText.textContent = 'Error downloading update';
    checkUpdatesBtn.textContent = 'Install';
    setTimeout(() => {
      versionText.textContent = `Update available: v${updateVersion}`;
    }, 3000);
    checkUpdatesBtn.disabled = false;
  }
}

async function handleRestartAndInstall() {
  // Verify update is downloaded before installing
  const downloadStatus = await window.controlPanel.isUpdateDownloaded();
  if (!downloadStatus.downloaded) {
    versionText.textContent = 'Update not downloaded yet. Please wait...';
    checkUpdatesBtn.textContent = 'Install & Restart';
    checkUpdatesBtn.disabled = false;
    return;
  }

  checkUpdatesBtn.disabled = true;
  checkUpdatesBtn.textContent = 'Installing...';
  versionText.textContent = 'Installing update and restarting...';

  try {
    const result = await window.controlPanel.installUpdate();
    if (result.error) {
      versionText.textContent = `Error: ${result.error}`;
      checkUpdatesBtn.textContent = 'Install & Restart';
      checkUpdatesBtn.disabled = false;
    } else {
      versionText.textContent = 'Installing update and restarting...';
      checkUpdatesBtn.textContent = 'Installing...';
      // quitAndInstall() will restart the app and install the update
      // The app will close and restart automatically
    }
  } catch (error) {
    console.error('Failed to install update:', error);
    versionText.textContent = 'Error installing update';
    checkUpdatesBtn.textContent = 'Install & Restart';
    checkUpdatesBtn.disabled = false;
  }
}

// Handle save URL button
saveUrlBtn.addEventListener('click', async () => {
  const url = streamUrlInput.value.trim();

  if (!url) {
    alert('Please enter a valid URL');
    return;
  }

  // Validate URL format (basic validation)
  try {
    // If it doesn't start with http:// or https://, add https://
    let formattedUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      formattedUrl = `https://${url}`;
    }

    // Validate URL format
    new URL(formattedUrl);

    // Extract just the domain if full URL was provided, or use as-is if it's just a domain
    let urlToSave = url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const urlObj = new URL(url);
      urlToSave = urlObj.hostname;
    }

    saveUrlBtn.disabled = true;
    saveUrlBtn.textContent = 'Saving...';

    try {
      await window.controlPanel.setStreamUrl(urlToSave);
      saveUrlBtn.textContent = 'Saved!';

      // Reset button text after a short delay
      setTimeout(() => {
        saveUrlBtn.textContent = 'Save';
        saveUrlBtn.disabled = false;
      }, 2000);
    } catch (error) {
      console.error('Failed to save stream URL:', error);
      saveUrlBtn.textContent = 'Save';
      saveUrlBtn.disabled = false;
      alert('Failed to save URL. Please try again.');
    }
  } catch (error) {
    alert('Please enter a valid URL or domain name');
  }
});

// Handle Enter key in URL input
streamUrlInput.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') {
    saveUrlBtn.click();
  }
});

// Handle reset app button
resetAppBtn.addEventListener('click', async () => {
  // Confirm with user
  const confirmed = confirm(
    'Are you sure you want to reset the app? This will clear all local data and cookies. This action cannot be undone.',
  );

  if (!confirmed) {
    return;
  }

  resetAppBtn.disabled = true;
  resetAppBtn.textContent = 'Resetting...';

  try {
    await window.controlPanel.resetApp();
    resetAppBtn.textContent = 'Reset Complete';

    // Show success message
    alert('App has been reset successfully. The app will reload.');

    // Reload the control panel after a short delay
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  } catch (error) {
    console.error('Failed to reset app:', error);
    resetAppBtn.textContent = 'Reset App';
    alert('Failed to reset app. Please try again.');
  } finally {
    resetAppBtn.disabled = false;
  }
});

// Load state when page loads
loadState();
