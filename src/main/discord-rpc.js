const DiscordRPC = require('discord-rpc');
const { ipcMain } = require('electron');

const clientId = '1451640447993774232';
DiscordRPC.register(clientId);

const rpc = new DiscordRPC.Client({ transport: 'ipc' });

// Activity type 3 = Watching — only Watching (and Listening) show the timestamp/progress bar in Discord
const ACTIVITY_TYPE_WATCHING = 3;

/**
 * Send SET_ACTIVITY with our own payload (including type) via the client's request() method,
 * so we can set activity type without patching the discord-rpc library.
 */
function setActivityRaw(args) {
  if (!rpc || typeof rpc.request !== 'function') return Promise.resolve();
  if (!rpcReady) {
    attemptLogin();
    return Promise.resolve();
  }

  let timestamps;
  if (args.startTimestamp != null || args.endTimestamp != null) {
    const start =
      args.startTimestamp != null
        ? Math.round(args.startTimestamp instanceof Date ? args.startTimestamp.getTime() : args.startTimestamp)
        : NaN;
    const end =
      args.endTimestamp != null
        ? Math.round(args.endTimestamp instanceof Date ? args.endTimestamp.getTime() : args.endTimestamp)
        : NaN;
    timestamps = {};
    if (Number.isFinite(start)) timestamps.start = start;
    if (Number.isFinite(end)) timestamps.end = end;
    if (Object.keys(timestamps).length === 0) timestamps = undefined;
  }

  const assets =
    args.largeImageKey || args.largeImageText
      ? {
          large_image: args.largeImageKey,
          large_text: args.largeImageText,
          small_image: args.smallImageKey,
          small_text: args.smallImageText,
        }
      : undefined;

  const activity = {
    type: ACTIVITY_TYPE_WATCHING,
    name: args.name ?? 'P-Stream',
    state: args.state ?? undefined,
    details: args.details ?? undefined,
    timestamps,
    assets,
    buttons: args.buttons,
    instance: !!args.instance,
  };

  return rpc
    .request('SET_ACTIVITY', {
      pid: process.pid,
      activity,
    })
    .catch((error) => {
      rpcReady = false;
      logRpcError('request', error);
    });
}

// Store current media metadata for Discord RPC
let currentMediaMetadata = null;
let currentActivityTitle = null;
let store = null;
let rpcReady = false;
let loginInFlight = false;
let lastLoginAttempt = 0;
const LOGIN_RETRY_MS = 10000;
let lastRpcErrorLog = 0;
const RPC_ERROR_LOG_MS = 60000;

function logRpcError(context, error) {
  const message = error?.message ? String(error.message) : String(error);
  if (message.toLowerCase().includes('could not connect')) return;

  const now = Date.now();
  if (now - lastRpcErrorLog < RPC_ERROR_LOG_MS) return;
  lastRpcErrorLog = now;
  console.warn(`Discord RPC ${context} failed:`, error);
}

function attemptLogin() {
  if (!rpc || typeof rpc.login !== 'function') return Promise.resolve(false);
  if (loginInFlight) return Promise.resolve(false);

  const now = Date.now();
  if (now - lastLoginAttempt < LOGIN_RETRY_MS) return Promise.resolve(false);

  loginInFlight = true;
  lastLoginAttempt = now;

  return rpc
    .login({ clientId })
    .then(() => {
      loginInFlight = false;
      return true;
    })
    .catch((error) => {
      loginInFlight = false;
      rpcReady = false;
      logRpcError('login', error);
      return false;
    });
}

function clearActivitySafe() {
  if (!rpc || typeof rpc.clearActivity !== 'function') return Promise.resolve();
  if (!rpcReady) return Promise.resolve();

  return rpc.clearActivity().catch((error) => {
    rpcReady = false;
    logRpcError('clear activity', error);
  });
}

function getStreamUrlForRPC() {
  if (!store) return 'https://pstream.mov/';
  const streamUrl = store.get('streamUrl', 'pstream.mov');
  return streamUrl.startsWith('http://') || streamUrl.startsWith('https://') ? streamUrl : `https://${streamUrl}/`;
}

/**
 * Build the activity name (main status name in Discord) from media metadata.
 * Shows: "The Simpsons S5 E5: Treehouse of Horror IV" (artist + title, where title is like "S5 E5: Episode Name")
 * Movies/single: just the title
 */
function getCurrentMediaTitle(mediaMetadata) {
  if (!mediaMetadata?.title) return 'P-Stream';
  const title = mediaMetadata.title;
  const artist = mediaMetadata.artist;
  return artist ? `${artist} - ${title}` : title;
}

/**
 * Build the activity details (substatus in Discord) from media metadata.
 * Shows: "The Simpsons" (artist)
 * Movies/single: just the title
 */
function getActivityNameFromMedia(mediaMetadata) {
  if (!mediaMetadata?.title) return 'P-Stream';
  const title = mediaMetadata.title;
  const artist = mediaMetadata.artist;
  return artist ? artist : title;
}

/**
 * Get start/end timestamps in Unix milliseconds for Discord RPC progress bar.
 * Discord and the discord-rpc library expect milliseconds. Returns [undefined, undefined] for live/invalid duration.
 */
function getTimestampsFromMediaMetadata(mediaMetadata) {
  if (!mediaMetadata || mediaMetadata.currentTime == null) return [undefined, undefined];

  const currentTimeSec = Number(mediaMetadata.currentTime);
  const durationSec = Number.isFinite(mediaMetadata.duration) ? Number(mediaMetadata.duration) : NaN;

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return [undefined, undefined];
  }

  const nowMs = Date.now();
  const startMs = Math.round(nowMs - currentTimeSec * 1000);
  const endMs = Math.round(startMs + durationSec * 1000);

  return [startMs, endMs];
}

async function setActivity(title, mediaMetadata = null) {
  if (!rpc) return;

  if (store && !store.get('discordRPCEnabled', true)) {
    await clearActivitySafe();
    return;
  }

  // If no media metadata, show default browsing activity
  if (!mediaMetadata) {
    setActivityRaw({
      details: 'P-Stream',
      state: 'Browsing',
      startTimestamp: new Date(),
      largeImageKey: 'logo',
      largeImageText: 'P-Stream',
      instance: false,
      buttons: [{ label: 'Use P-Stream', url: getStreamUrlForRPC() }],
    });
    return;
  }

  const activity = {
    name: getActivityNameFromMedia(mediaMetadata),
    details: getCurrentMediaTitle(mediaMetadata),
    state: 'Loading...',
    startTimestamp: new Date(),
    largeImageKey: mediaMetadata.poster || 'logo',
    largeImageText: mediaMetadata.artist || mediaMetadata.title || 'P-Stream',
    smallImageKey: 'logo_no_bg',
    smallImageText: 'P-Stream',
    instance: false,
    buttons: [{ label: 'Use P-Stream', url: getStreamUrlForRPC() }],
  };

  if (mediaMetadata.isPlaying) {
    const [startTimestamp, endTimestamp] = getTimestampsFromMediaMetadata(mediaMetadata);
    if (startTimestamp != null) {
      activity.startTimestamp = startTimestamp;
    }
    if (endTimestamp != null) {
      activity.endTimestamp = endTimestamp;
    }
    activity.state = 'Watching';
  } else if (mediaMetadata.isPlaying === false && mediaMetadata.currentTime != null) {
    activity.startTimestamp = new Date();
    activity.endTimestamp = undefined;
    activity.state = 'Paused';
  }

  setActivityRaw(activity);
}

function initialize(settingsStore) {
  store = settingsStore;

  // Set up ready handler
  rpc.on('ready', () => {
    console.log('Discord RPC started');
    rpcReady = true;
    loginInFlight = false;
    // Only set activity if RPC is enabled (store might not be initialized yet)
    if (!store || store.get('discordRPCEnabled', true)) {
      setActivity(currentActivityTitle, currentMediaMetadata);
    }
  });

  // Login to Discord RPC
  attemptLogin();

  // Register IPC handlers
  ipcMain.handle('get-discord-rpc-enabled', () => {
    if (!store) return true; // Default to enabled if store not initialized
    return store.get('discordRPCEnabled', true);
  });

  ipcMain.handle('set-discord-rpc-enabled', async (event, enabled) => {
    if (!store) return false;

    store.set('discordRPCEnabled', enabled);

    // Update activity immediately
    if (enabled) {
      // Use stored current media metadata or fall back to title
      await setActivity(currentActivityTitle, currentMediaMetadata);
    } else {
      // Clear activity if disabled
      await clearActivitySafe();
    }

    return true;
  });

  ipcMain.handle('updateMediaMetadata', async (event, data) => {
    try {
      const hasMetadata = data?.metadata && (data.metadata.title || data.metadata.artist);
      const hasProgress = data?.progress && (data.progress.currentTime != null || data.progress.duration != null);

      if (!hasMetadata && !hasProgress) {
        currentMediaMetadata = null;
        setActivity(currentActivityTitle, null);
        return { success: true };
      }

      if (!currentMediaMetadata) {
        currentMediaMetadata = {};
      }

      if (data.metadata) {
        Object.assign(currentMediaMetadata, {
          title: data.metadata.title ?? currentMediaMetadata.title,
          artist: data.metadata.artist ?? currentMediaMetadata.artist,
          poster: data.metadata.poster ?? currentMediaMetadata.poster,
          season:
            data.metadata.season != null && !isNaN(data.metadata.season)
              ? data.metadata.season
              : currentMediaMetadata.season,
          episode:
            data.metadata.episode != null && !isNaN(data.metadata.episode)
              ? data.metadata.episode
              : currentMediaMetadata.episode,
        });
      }

      if (data.progress) {
        Object.assign(currentMediaMetadata, {
          currentTime:
            data.progress.currentTime != null && !isNaN(data.progress.currentTime)
              ? data.progress.currentTime
              : currentMediaMetadata.currentTime,
          duration:
            data.progress.duration != null && !isNaN(data.progress.duration)
              ? data.progress.duration
              : currentMediaMetadata.duration,
          isPlaying: data.progress.isPlaying ?? currentMediaMetadata.isPlaying,
        });
      }

      // If we have at least title and duration, update the activity; otherwise clear metadata
      // Sometimes we get incomplete updates (e.g., only title but no duration)
      // Since we use progress bar for both movies and episodes, duration is required to show activity for either type, so if it's missing we should clear the activity to avoid showing incorrect info
      // For that reason, we require both title and duration to show activity
      if (currentMediaMetadata.title && currentMediaMetadata.duration != null) {
        await setActivity(currentActivityTitle, currentMediaMetadata);
      } else {
        currentMediaMetadata = null;
        setActivity(currentActivityTitle, null);
      }

      return { success: true };
    } catch (error) {
      console.error('Error updating media metadata:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  initialize,
  setActivity,
  getCurrentActivityTitle: () => currentActivityTitle,
  setCurrentActivityTitle: (title) => {
    currentActivityTitle = title;
  },
  getCurrentMediaMetadata: () => currentMediaMetadata,
  setCurrentMediaMetadata: (metadata) => {
    currentMediaMetadata = metadata;
  },
  updateActivity: () => {
    setActivity(currentActivityTitle, currentMediaMetadata);
  },
};
