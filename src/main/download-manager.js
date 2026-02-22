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
  } catch {
    downloads = [];
  }
}

function saveManifest() {
  fs.writeFileSync(manifestPath, JSON.stringify(downloads, null, 2));
}

const activeCommands = new Map();

function startDownload(videoData, webContents) {
  const id = crypto.randomUUID();
  const safeTitle = (videoData.title || 'Video').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  // Ensure the filename doesn't get ridiculously long
  const filename = `${safeTitle.substring(0, 50)}_${id.substring(0, 8)}.mp4`;
  const filePath = path.join(downloadsDir, filename);

  const downloadEntry = {
    id,
    title: videoData.title || 'Unknown Title',
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
      console.error('Download error:', err);
      const entry = downloads.find((d) => d.id === id);
      if (entry) {
        entry.status = 'error';
        entry.error = err.message;
        saveManifest();
        if (webContents && !webContents.isDestroyed()) {
          webContents.send('download-error', { id, error: err.message });
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
