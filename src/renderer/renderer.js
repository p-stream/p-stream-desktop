const titleEl = document.getElementById('window-title');
const minimizeBtn = document.getElementById('minimize');
const maximizeBtn = document.getElementById('maximize');
const closeBtn = document.getElementById('close');
const titlebar = document.getElementById('titlebar');
const titlebarRight = document.querySelector('.titlebar__right');
const appIcon = document.querySelector('.app-icon');

// Store last theme color to restore after reload (persist across reloads)
const THEME_COLOR_KEY = 'p-stream-titlebar-theme-color';

// Function to apply theme color to titlebar
const applyThemeColor = (color) => {
  if (!titlebar) return;
  if (color) {
    titlebar.style.background = color;
    titlebar.style.borderBottomColor = 'transparent';
    // Persist theme color for reload
    sessionStorage.setItem(THEME_COLOR_KEY, color);
  } else {
    // Reset to default if no color provided
    titlebar.style.background = '';
    titlebar.style.borderBottomColor = '';
    sessionStorage.removeItem(THEME_COLOR_KEY);
  }
};

// Restore theme color from sessionStorage after page loads
const restoreThemeColor = () => {
  const savedColor = sessionStorage.getItem(THEME_COLOR_KEY);
  if (savedColor) {
    applyThemeColor(savedColor);
  }
};

// Platform-specific setup
window.windowControls.onPlatformChanged((platform) => {
  const isMac = platform === 'darwin';
  const isLinux = platform === 'linux';

  // Add platform class to body for CSS targeting
  document.body.setAttribute('data-platform', platform);

  if (isMac) {
    // macOS: Hide custom buttons, window title, and logo
    if (titlebarRight) titlebarRight.style.display = 'none';
    if (titleEl) titleEl.style.display = 'none';
    if (appIcon) appIcon.style.display = 'none';
    if (titlebar) titlebar.classList.add('titlebar--macos');
  } else if (isLinux) {
    // Linux: Show custom buttons with chevron icons
    if (titlebar) titlebar.classList.add('titlebar--linux');
    // Switch to Linux icons: chevron down for minimize, chevron up for maximize
    const minimizeIcon = minimizeBtn?.querySelector('svg');
    const maximizeIcon = maximizeBtn?.querySelector('.icon-max');
    const restoreIcon = maximizeBtn?.querySelector('.icon-restore');
    if (minimizeIcon) {
      minimizeIcon.innerHTML =
        '<path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />';
    }
    if (maximizeIcon) {
      maximizeIcon.innerHTML =
        '<path d="M3 7.5l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />';
    }
    if (restoreIcon) {
      // Restore icon also uses chevron up (same as maximize when not maximized)
      restoreIcon.innerHTML =
        '<path d="M3 7.5l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />';
    }
  } else {
    // Windows: Keep default Windows-style icons
    if (titlebar) titlebar.classList.add('titlebar--windows');
    if (appIcon) appIcon.style.display = 'block';
  }

  // After platform is set, wait for page to load then restore theme color
  if (document.readyState === 'complete') {
    // Page already loaded, restore immediately after a short delay
    setTimeout(restoreThemeColor, 100);
  } else {
    // Wait for page to load before restoring theme color
    window.addEventListener('load', () => {
      setTimeout(restoreThemeColor, 100);
    });
  }
});

minimizeBtn.addEventListener('click', () => window.windowControls.minimize());
maximizeBtn.addEventListener('click', () => window.windowControls.maximizeToggle());
closeBtn.addEventListener('click', () => window.windowControls.close());

titlebar.addEventListener('dblclick', (event) => {
  const isButton = event.target.closest('.window-btn');
  if (isButton) return;
  window.windowControls.maximizeToggle();
});

window.windowControls.onTitleChanged((title) => {
  if (titleEl) titleEl.textContent = title || 'P-Stream';
});

window.windowControls.onMaximizedChanged((isMaximized) => {
  if (!maximizeBtn) return;
  if (isMaximized) maximizeBtn.classList.add('is-maximized');
  else maximizeBtn.classList.remove('is-maximized');
});

window.windowControls.onThemeColorChanged((color) => {
  applyThemeColor(color);
});

// Hide/show titlebar based on fullscreen state
window.windowControls.onFullscreenChanged((isFullscreen) => {
  if (titlebar) {
    if (isFullscreen) {
      titlebar.style.display = 'none';
    } else {
      titlebar.style.display = '';
    }
  }
});
