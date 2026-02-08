const warpLaunchToggle = document.getElementById('warp-launch-toggle');
const warpToggle = document.getElementById('warp-toggle');
const warpStatus = document.getElementById('warp-status');
const discordToggle = document.getElementById('discord-rpc-toggle');
const versionText = document.getElementById('version-text');
const checkUpdatesBtn = document.getElementById('check-updates-btn');
const updateNowBtn = document.getElementById('update-now-btn');
const streamUrlInput = document.getElementById('stream-url-input');
const saveUrlBtn = document.getElementById('save-url-btn');
const resetAppBtn = document.getElementById('reset-app-btn');
const uninstallAppBtn = document.getElementById('uninstall-app-btn');
const hardwareAccelToggle = document.getElementById('hardware-accel-toggle');

// Load initial state
async function loadState() {
  // Load WARP on launch state
  try {
    const warpLaunchEnabled = await window.settings.getWarpLaunchEnabled();
    warpLaunchToggle.checked = warpLaunchEnabled;
  } catch (error) {
    console.error('Failed to load WARP on launch state:', error);
  }

  // Load WARP VPN state
  try {
    const warpEnabled = await window.settings.getWarpEnabled();
    warpToggle.checked = warpEnabled;
    updateWarpStatus();
  } catch (error) {
    console.error('Failed to load WARP state:', error);
  }

  // Load Discord RPC state
  try {
    const enabled = await window.settings.getDiscordRPCEnabled();
    discordToggle.checked = enabled;
  } catch (error) {
    console.error('Failed to load Discord RPC state:', error);
  }

  // Load version
  try {
    const version = await window.settings.getVersion();
    versionText.textContent = `v${version}`;
  } catch (error) {
    console.error('Failed to load version:', error);
    versionText.textContent = 'Unknown';
  }

  // Load stream URL
  try {
    const url = await window.settings.getStreamUrl();
    streamUrlInput.value = url;
  } catch (error) {
    console.error('Failed to load stream URL:', error);
  }

  // Load hardware acceleration state
  try {
    const hwAccel = await window.settings.getHardwareAcceleration();
    hardwareAccelToggle.checked = hwAccel;
  } catch (error) {
    console.error('Failed to load hardware acceleration state:', error);
  }

  // Check if we're in development mode
  try {
    const updateCheck = await window.settings.checkForUpdates();
    if (updateCheck.isDevelopment) {
      checkUpdatesBtn.textContent = 'Open Releases Page';
      updateNowBtn.hidden = true;
      versionText.textContent = `v${updateCheck.version} (Dev Mode)`;
    } else {
      checkUpdatesBtn.textContent = 'Check for Updates';
      updateNowBtn.hidden = true;
    }
  } catch (error) {
    console.log('Could not determine if in dev mode:', error);
    checkUpdatesBtn.textContent = 'Check for Updates';
    updateNowBtn.hidden = true;
  }
}

// Update WARP status display
async function updateWarpStatus() {
  try {
    const status = await window.settings.getWarpStatus();
    if (status.enabled) {
      warpStatus.textContent = `Connected via ${status.proxyHost}:${status.proxyPort}`;
      warpStatus.style.color = '#4ade80';
    } else if (status.error) {
      warpStatus.textContent = `Error: ${status.error}`;
      warpStatus.style.color = '#f87171';
    } else {
      warpStatus.textContent = 'Disabled';
      warpStatus.style.color = '#a1a1aa';
    }
  } catch (error) {
    console.error('Failed to update WARP status:', error);
    warpStatus.textContent = '';
  }
}

// Handle WARP on launch toggle change
warpLaunchToggle.addEventListener('change', async (event) => {
  try {
    await window.settings.setWarpLaunchEnabled(event.target.checked);
  } catch (error) {
    console.error('Failed to update WARP on launch state:', error);
    warpLaunchToggle.checked = !event.target.checked;
  }
});

// Handle WARP toggle change
warpToggle.addEventListener('change', async (event) => {
  const enabling = event.target.checked;
  warpToggle.disabled = true;
  warpStatus.textContent = enabling ? 'Connecting...' : 'Disconnecting...';
  warpStatus.style.color = '#fbbf24';

  try {
    const result = await window.settings.setWarpEnabled(enabling);
    if (result.success) {
      warpToggle.checked = enabling;
      await updateWarpStatus();
    } else {
      warpToggle.checked = !enabling;
      warpStatus.textContent = result.error || 'Failed';
      warpStatus.style.color = '#f87171';
    }
  } catch (error) {
    console.error('Failed to update WARP state:', error);
    warpToggle.checked = !enabling;
    warpStatus.textContent = error.message || 'Failed';
    warpStatus.style.color = '#f87171';
  } finally {
    warpToggle.disabled = false;
  }
});

// Handle Discord RPC toggle change
discordToggle.addEventListener('change', async (event) => {
  try {
    await window.settings.setDiscordRPCEnabled(event.target.checked);
  } catch (error) {
    console.error('Failed to update Discord RPC state:', error);
    discordToggle.checked = !event.target.checked;
  }
});

// Handle hardware acceleration toggle change
hardwareAccelToggle.addEventListener('change', async (event) => {
  const enabling = event.target.checked;
  hardwareAccelToggle.disabled = true;

  try {
    const result = await window.settings.setHardwareAcceleration(enabling);
    if (result.success) {
      hardwareAccelToggle.checked = enabling;

      // Show restart prompt
      const restart = confirm(
        'Hardware acceleration setting requires a restart to take effect.\n\nDo you want to restart the app now?',
      );

      if (restart) {
        await window.settings.restartApp();
      }
    } else {
      hardwareAccelToggle.checked = !enabling;
      alert('Failed to update hardware acceleration setting');
    }
  } catch (error) {
    console.error('Failed to update hardware acceleration state:', error);
    hardwareAccelToggle.checked = !enabling;
  } finally {
    hardwareAccelToggle.disabled = false;
  }
});

// Handle update check button
checkUpdatesBtn.addEventListener('click', async () => {
  const buttonText = checkUpdatesBtn.textContent;

  if (buttonText === 'Open Releases Page') {
    await handleOpenReleasesPage();
  } else {
    await handleCheckForUpdates();
  }
});

// Handle Update now button
updateNowBtn.addEventListener('click', handleUpdateNow);

async function handleCheckForUpdates() {
  checkUpdatesBtn.disabled = true;
  checkUpdatesBtn.textContent = 'Checking...';

  try {
    const result = await window.settings.checkForUpdates();

    if (result.error) {
      versionText.textContent = result.error;
      updateNowBtn.hidden = true;
      checkUpdatesBtn.textContent = 'Check for Updates';
      setTimeout(() => {
        if (versionText.textContent === result.error) {
          versionText.textContent = `v${result.version || 'Unknown'}`;
        }
      }, 5000);
    } else if (result.isDevelopment) {
      versionText.textContent = `v${result.version} (Dev Mode)`;
      updateNowBtn.hidden = true;
      checkUpdatesBtn.textContent = 'Open Releases Page';
    } else if (result.updateAvailable) {
      versionText.textContent = `Update available: v${result.version}`;
      updateNowBtn.hidden = false;
      checkUpdatesBtn.textContent = 'Open Releases Page';
    } else {
      const displayVersion = result.version || result.currentVersion || 'Unknown';
      versionText.textContent = `v${displayVersion} (Latest)`;
      updateNowBtn.hidden = true;
      checkUpdatesBtn.textContent = 'Up to Date';
      setTimeout(() => {
        checkUpdatesBtn.textContent = 'Check for Updates';
      }, 2000);
    }
  } catch (error) {
    console.error('Failed to check for updates:', error);
    versionText.textContent = 'Error checking for updates';
    checkUpdatesBtn.textContent = 'Check for Updates';
    setTimeout(() => {
      if (versionText.textContent === 'Error checking for updates') {
        window.settings.getVersion().then((version) => {
          versionText.textContent = `v${version}`;
        });
      }
    }, 5000);
  } finally {
    checkUpdatesBtn.disabled = false;
  }
}

async function handleOpenReleasesPage() {
  try {
    await window.settings.openReleasesPage();
  } catch (error) {
    console.error('Failed to open releases page:', error);
    versionText.textContent = 'Error opening releases page';
    setTimeout(() => {
      window.settings.getVersion().then((version) => {
        versionText.textContent = `v${version}`;
      });
    }, 3000);
  }
}

async function handleUpdateNow() {
  updateNowBtn.disabled = true;
  checkUpdatesBtn.disabled = true;
  updateNowBtn.textContent = 'Starting update...';

  try {
    const result = await window.settings.installUpdate();
    if (result.updateInstalling) {
      versionText.textContent = 'Update in progress...';
    } else if (result.error) {
      versionText.textContent = result.error;
      updateNowBtn.textContent = 'Update now';
      updateNowBtn.disabled = false;
      checkUpdatesBtn.disabled = false;
      setTimeout(async () => {
        if (versionText.textContent === result.error) {
          try {
            const v = await window.settings.getVersion();
            versionText.textContent = `v${v}`;
          } catch {
            versionText.textContent = 'Unknown';
          }
        }
      }, 5000);
    } else {
      updateNowBtn.textContent = 'Update now';
      updateNowBtn.disabled = false;
      checkUpdatesBtn.disabled = false;
    }
  } catch (error) {
    console.error('Update now failed:', error);
    versionText.textContent = 'Update failed';
    updateNowBtn.textContent = 'Update now';
    updateNowBtn.disabled = false;
    checkUpdatesBtn.disabled = false;
  }
}

// Save URL
saveUrlBtn.addEventListener('click', async () => {
  const url = streamUrlInput.value.trim();
  if (!url) {
    alert('Please enter a valid URL');
    return;
  }
  try {
    let formattedUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      formattedUrl = `https://${url}`;
    }
    new URL(formattedUrl);
    const urlToSave = url;
    saveUrlBtn.disabled = true;
    saveUrlBtn.textContent = 'Saving...';
    try {
      await window.settings.setStreamUrl(urlToSave);
      saveUrlBtn.textContent = 'Saved!';
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
  } catch {
    alert('Please enter a valid URL or domain name');
  }
});

streamUrlInput.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') saveUrlBtn.click();
});

// Reset app
resetAppBtn.addEventListener('click', async () => {
  const confirmed = confirm(
    'Are you sure you want to reset the app? This will clear all local data and cookies. This action cannot be undone.',
  );
  if (!confirmed) return;
  resetAppBtn.disabled = true;
  resetAppBtn.textContent = 'Resetting...';
  try {
    await window.settings.resetApp();
    resetAppBtn.textContent = 'Reset Complete';
    alert('App has been reset successfully. The app will reload.');
    setTimeout(() => window.location.reload(), 1000);
  } catch (error) {
    console.error('Failed to reset app:', error);
    resetAppBtn.textContent = 'Reset App';
    alert('Failed to reset app. Please try again.');
  } finally {
    resetAppBtn.disabled = false;
  }
});

// Uninstall app
uninstallAppBtn.addEventListener('click', async () => {
  const firstConfirm = confirm(
    '⚠️ WARNING: This will permanently delete the P-Stream app and ALL associated data from your computer.\n\n' +
      'This includes:\n' +
      '• All app settings\n' +
      '• All cookies and browsing data\n' +
      '• All stored preferences\n\n' +
      'This action CANNOT be undone.\n\n' +
      'Are you absolutely sure you want to continue?',
  );
  if (!firstConfirm) return;
  const secondConfirm = confirm(
    'Final confirmation: Are you sure you want to uninstall P-Stream?\n\n' +
      'The app will be removed from your computer and all data will be deleted.',
  );
  if (!secondConfirm) return;
  uninstallAppBtn.disabled = true;
  uninstallAppBtn.textContent = 'Uninstalling...';
  try {
    const result = await window.settings.uninstallApp();
    if (result.success) {
      alert(result.message || 'The app is being uninstalled. Please follow any additional instructions that appear.');
    } else {
      uninstallAppBtn.textContent = 'Uninstall App';
      alert(
        result.error ||
          'Failed to uninstall the app. You may need to uninstall it manually through your system settings.',
      );
      uninstallAppBtn.disabled = false;
    }
  } catch (error) {
    console.error('Failed to uninstall app:', error);
    uninstallAppBtn.textContent = 'Uninstall App';
    alert(
      'An error occurred while trying to uninstall the app. You may need to uninstall it manually through your system settings.',
    );
    uninstallAppBtn.disabled = false;
  }
});

// Load state when page loads
loadState();
