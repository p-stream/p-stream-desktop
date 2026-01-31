// Updater window renderer script
const statusText = document.getElementById('status-text');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');

// Listen for progress updates from main process
window.updater.onProgress((data) => {
  if (data.percent !== undefined) {
    progressBar.style.width = `${data.percent}%`;
    progressText.textContent = `${data.percent}%`;
  }
  if (data.status) {
    statusText.textContent = data.status;
  }
});
