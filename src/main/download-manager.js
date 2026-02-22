/* global console, module, require */
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { app } = require('electron');
const crypto = require('crypto');

ffmpeg.setFfmpegPath(ffmpegPath);

const downloadsDir = path.join(app.getPath('userData'), 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

const manifestPath = path.join(downloadsDir, 'manifest.json');

let downloads = [];
if (fs.existsSync(manifestPath)) {
  try {
    downloads = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error('[DownloadManager] Failed to parse manifest.json:', err);
    // Backup the corrupted manifest for diagnosis
    try {
      const backupPath = manifestPath + `.corrupt-${Date.now()}`;
      fs.copyFileSync(manifestPath, backupPath);
      console.error('[DownloadManager] Corrupted manifest backed up to:', backupPath);
    } catch (backupErr) {
      console.error('[DownloadManager] Failed to backup corrupted manifest:', backupErr);
    }
    downloads = [];
  }
}

function saveManifest() {
  fs.writeFileSync(manifestPath, JSON.stringify(downloads, null, 2));
}

const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:']);
const MAX_SUBTITLE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_TITLE_LENGTH = 200;

const activeCommands = new Map();

function validateVideoData(videoData) {
  if (!videoData || typeof videoData !== 'object') {
    throw new Error('Invalid download request.');
  }

  if (typeof videoData.url !== 'string' || !videoData.url) {
    throw new Error('Invalid download request.');
  }

  let parsed;
  try {
    parsed = new URL(videoData.url);
  } catch {
    throw new Error('Invalid download request.');
  }

  if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
    throw new Error('Invalid download request.');
  }

  if (videoData.title !== undefined && typeof videoData.title !== 'string') {
    throw new Error('Invalid download request.');
  }

  if (videoData.poster !== undefined && videoData.poster !== null && typeof videoData.poster !== 'string') {
    throw new Error('Invalid download request.');
  }

  if (videoData.poster && typeof videoData.poster === 'string') {
    try {
      const posterUrl = new URL(videoData.poster);
      if (!ALLOWED_URL_SCHEMES.has(posterUrl.protocol) && !videoData.poster.startsWith('data:image/')) {
        videoData.poster = null;
      }
    } catch {
      if (!videoData.poster.startsWith('data:image/')) {
        videoData.poster = null;
      }
    }
  }

  if (videoData.subtitleText !== undefined) {
    if (typeof videoData.subtitleText !== 'string') {
      throw new Error('Invalid download request.');
    }
    if (Buffer.byteLength(videoData.subtitleText, 'utf8') > MAX_SUBTITLE_SIZE) {
      throw new Error('Invalid download request.');
    }
  }

  if (videoData.duration !== undefined && (typeof videoData.duration !== 'number' || !Number.isFinite(videoData.duration))) {
    videoData.duration = undefined;
  }
}

function startDownload(videoData, webContents) {
  validateVideoData(videoData);

  const id = crypto.randomUUID();
  const title = typeof videoData.title === 'string' ? videoData.title.substring(0, MAX_TITLE_LENGTH) : 'Video';
  const safeTitle = (title || 'Video').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  // Ensure the filename doesn't get ridiculously long
  const filename = `${safeTitle.substring(0, 50)}_${id.substring(0, 8)}.mp4`;
  const filePath = path.join(downloadsDir, filename);

  const downloadEntry = {
    id,
    title: title || 'Unknown Title',
    poster: videoData.poster || null,
    filePath,
    url: videoData.url,
    status: 'downloading',
    progress: 0,
    error: null,
    createdAt: Date.now(),
  };

  if (videoData.subtitleText) {
    const subPath = path.join(downloadsDir, `${id}.srt`);
    fs.writeFileSync(subPath, videoData.subtitleText);
    downloadEntry.subtitlePath = subPath;
  }

  downloads.unshift(downloadEntry); // Add to beginning
  saveManifest();

  // Need user agent or headers if stream blocks default ffmpeg
  const inputOptions = ['-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'];

  const outputOptions = ['-c copy'];
  if (videoData.url.includes('.m3u8') || videoData.url.includes('m3u8-proxy') || videoData.type === 'hls') {
    outputOptions.push('-bsf:a', 'aac_adtstoasc');
  }

  const command = ffmpeg(videoData.url)
    .inputOptions(inputOptions)
    .outputOptions(outputOptions)
    .output(filePath)
    .on('progress', (progress) => {
      let percent = progress.percent;
      if (!percent && videoData.duration && progress.timemark) {
        // Parse '00:00:00.00'
        const parts = progress.timemark.split(':');
        if (parts.length === 3) {
          const secs = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
          percent = (secs / videoData.duration) * 100;
        }
      }

      // MP4 streams sometimes report progress.targetSize vs the whole file size instead
      // but without total size, we rely gracefully on timemark + videoData.duration.

      const entry = downloads.find((d) => d.id === id);
      if (entry) {
        entry.progress = percent ? Math.min(percent, 100) : 0;
        if (webContents && !webContents.isDestroyed()) {
          webContents.send('download-progress', { id, progress: entry.progress });
        }
      }
    })
    .on('end', () => {
      const entry = downloads.find((d) => d.id === id);
      if (entry) {
        entry.status = 'completed';
        entry.progress = 100;
        saveManifest();
        if (webContents && !webContents.isDestroyed()) {
          webContents.send('download-complete', { id });
        }
      }
      activeCommands.delete(id);
    })
    .on('error', (err) => {
      console.error('[DownloadManager] Download error for', id, ':', err);
      const entry = downloads.find((d) => d.id === id);
      if (entry) {
        entry.status = 'error';
        entry.error = err.message; // Keep detailed error in manifest for internal diagnosis
        saveManifest();
        if (webContents && !webContents.isDestroyed()) {
          webContents.send('download-error', { id, error: 'Download failed. Please try again.' });
        }
      }
      activeCommands.delete(id);
    });

  command.run();
  activeCommands.set(id, command);

  return id;
}

function getDownloads() {
  return downloads;
}

function deleteDownload(id) {
  const index = downloads.findIndex((d) => d.id === id);
  if (index !== -1) {
    const entry = downloads[index];
    if (activeCommands.has(id)) {
      activeCommands.get(id).kill('SIGKILL');
      activeCommands.delete(id);
    }
    try {
      if (fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath);
      if (entry.subtitlePath && fs.existsSync(entry.subtitlePath)) fs.unlinkSync(entry.subtitlePath);
    } catch {
      console.error('Failed to delete files for', id);
    }
    downloads.splice(index, 1);
    saveManifest();
    return true;
  }
  return false;
}

module.exports = {
  startDownload,
  getDownloads,
  deleteDownload,
  downloadsDir,
};
