/* global window, document, URL, URLSearchParams, console */
window.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get('id');

  if (!id) return;

  const requestMsg = (name, body) =>
    new Promise((resolve, reject) => {
      const relayId = Math.random().toString(36).substring(7);
      const handler = (e) => {
        if (e.data && e.data.relayId === relayId && e.data.relayed) {
          window.removeEventListener('message', handler);
          if ((e.data.body && e.data.body.error === false) || e.data.body.success === false) {
            reject(new Error(e.data.body.error));
          } else {
            resolve(e.data.body);
          }
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ name, body, relayId, instanceId: 'offline-player' }, '*');
    });

  let downloads = [];
  try {
    downloads = await requestMsg('getDownloads');
  } catch (e) {
    console.error('Failed to get downloads:', e);
  }

  const video = downloads.find((d) => d.id === id);
  if (!video) return;

  const player = document.getElementById('player');
  const backBtn = document.getElementById('back-btn');
  const ccBtn = document.getElementById('cc-btn');

  backBtn.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.pathname = url.pathname.replace('player.html', 'offline.html');
    url.search = '';
    window.location.href = url.href;
  });

  // Use the custom 'pstream://' protocol for secure local file access
  const videoFilename = video.filePath.split(/\/|\\/).pop();
  player.src = `pstream://${encodeURIComponent(videoFilename)}`;

  if (video.subtitlePath) {
    // Read the SRT file and convert to WebVTT (the only format <track> supports)
    try {
      const subFilename = video.subtitlePath.split(/\/|\\/).pop();
      const subUrl = `pstream://${encodeURIComponent(subFilename)}`;
      const res = await fetch(subUrl);
      const srtText = await res.text();

      // Convert SRT to VTT: add header and replace comma with dot in timestamps
      const vttText = 'WEBVTT\n\n' + srtText.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      const blob = new Blob([vttText], { type: 'text/vtt' });

      const track = document.createElement('track');
      track.kind = 'captions';
      track.label = 'English';
      track.srclang = 'en';
      track.src = URL.createObjectURL(blob);
      player.appendChild(track);
      track.track.mode = 'hidden';

      // Show CC toggle button
      ccBtn.style.display = 'block';
      ccBtn.addEventListener('click', () => {
        const isShowing = track.track.mode === 'showing';
        track.track.mode = isShowing ? 'hidden' : 'showing';
        ccBtn.classList.toggle('active', !isShowing);
      });
    } catch (e) {
      console.error('Failed to load subtitles:', e);
    }
  }
});
