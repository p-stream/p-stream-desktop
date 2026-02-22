/* global window, document, URL, setTimeout, console, confirm */
window.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('downloads-grid');
  const backBtn = document.getElementById('back-btn');

  backBtn.addEventListener('click', () => {
    window.__PSTREAM_RELOAD_STREAM_PAGE__ && window.__PSTREAM_RELOAD_STREAM_PAGE__();
  });

  async function render() {
    let downloads = [];
    try {
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
          window.postMessage({ name, body, relayId, instanceId: 'offline' }, '*');
        });

      downloads = await requestMsg('getDownloads');
    } catch (e) {
      console.error('Failed to get downloads:', e);
      grid.innerHTML = `<div class="empty-state">
        <div class="empty-icon-wrapper">
          <svg viewBox="0 0 24 24" fill="none" stroke="#E44F4F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h2>Error Loading</h2>
        <p>Failed to communicate with download manager.</p>
      </div>`;
      return;
    }

    if (!downloads || downloads.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </div>
          <h2>No Downloads Yet</h2>
          <p>Videos you download for offline viewing will appear here.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = '';

    downloads.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'card';

      const posterSrc =
        d.poster ||
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23141414" width="100" height="100"/><text x="50" y="50" fill="%23868686" font-family="sans-serif" font-size="12" text-anchor="middle" alignment-baseline="middle">No Poster</text></svg>';

      let statusHTML = '';
      if (d.status === 'downloading') {
        statusHTML = `<div class="status-text status-downloading">
          <span class="spinner"></span>
          <span>Downloading <span class="percent-text" id="percent-${d.id}" style="font-variant-numeric: tabular-nums;">${Math.round(d.progress)}%</span></span>
        </div>`;
      } else if (d.status === 'completed') {
        statusHTML = `<div class="status-text status-completed">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>
          Ready to Play
        </div>`;
      } else if (d.status === 'error') {
        statusHTML = `<div class="status-text status-error">Failed</div>`;
      }

      card.innerHTML = `
        <div class="poster-container">
          <img class="poster" src="${posterSrc}" alt="${d.title}" />
          <div class="poster-overlay"></div>
          ${d.status === 'completed' ? `
          <div class="play-overlay">
            <div class="play-button">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>
            </div>
          </div>` : ''}
          <button class="delete-btn" data-id="${d.id}" title="Delete Download">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
          </button>
        </div>
        <div class="info">
          <div class="title" title="${d.title}">${d.title}</div>
          <div class="status" id="status-${d.id}">
            ${statusHTML}
          </div>
          ${d.status === 'downloading'
            ? `<div class="progress-bar-container"><div class="progress-bar" id="progress-${d.id}" style="width: ${Math.max(2, d.progress)}%"></div></div>`
            : ''}
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.delete-btn')) return;
        if (d.status === 'completed') {
          const url = new URL(window.location.href);
          url.pathname = url.pathname.replace('offline.html', 'player.html');
          url.searchParams.set('id', d.id);
          window.location.href = url.href;
        }
      });

      const delBtn = card.querySelector('.delete-btn');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this download?')) {
          card.style.opacity = '0';
          card.style.transition = 'opacity 0.2s';
          setTimeout(() => {
            window.postMessage({ name: 'deleteDownload', body: d.id, relayId: 'del' }, '*');
            setTimeout(render, 300);
          }, 200);
        }
      });

      grid.appendChild(card);
    });
  }

  window.addEventListener('message', (e) => {
    if (e.data && e.data.name === 'download-progress') {
      const pb = document.getElementById('progress-' + e.data.body.id);
      const pct = document.getElementById('percent-' + e.data.body.id);
      if (pb) pb.style.width = Math.max(2, e.data.body.progress) + '%';
      if (pct) pct.textContent = Math.round(e.data.body.progress) + '%';
    } else if (e.data && e.data.name === 'download-complete') {
      render();
    } else if (e.data && e.data.name === 'download-error') {
      render();
    }
  });

  render();
});
