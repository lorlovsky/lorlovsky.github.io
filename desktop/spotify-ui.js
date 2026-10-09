(() => {
  'use strict';
  if (!window.NotchDesktop || !window.NotchMusic) return;
  function initialize() {
  const section = document.createElement('section'); section.className = 'spotify-source';
  const heading = document.createElement('h3'); heading.textContent = 'Your Spotify desktop app';
  const status = document.createElement('p'); status.className = 'small-text muted'; status.id = 'spotify-desktop-status'; status.textContent = 'Connect the Spotify app on this PC. No token or extra sign-in required.';
  const row = document.createElement('div'); row.className = 'input-row';
  const connect = document.createElement('button'); connect.type = 'button'; connect.id = 'spotify-desktop-connect'; connect.className = 'button primary'; connect.textContent = 'Connect Spotify desktop';
  const demo = document.createElement('button'); demo.type = 'button'; demo.className = 'button secondary'; demo.id = 'spotify-use-demo'; demo.textContent = 'Use demo music';
  row.append(connect, demo); section.append(heading, status, row);
  const form = document.getElementById('settings-form'); form.insertBefore(section, form.querySelector('h3'));
  const remember = value => { try { localStorage.setItem('notchdrop.musicSource', value); } catch {} };
  connect.addEventListener('click', async () => {
    connect.disabled = true; remember('spotify-desktop');
    try {
      const ready = await NotchMusic.connectDesktopSpotify((action, position) => NotchDesktop.spotify(action, position));
      NotchDrop.toast(ready ? 'Connected to your Spotify desktop app.' : 'Open Spotify and play a song. The notch will connect automatically.');
    } finally { connect.disabled = false; }
  });
  demo.addEventListener('click', () => { remember('demo'); NotchMusic.disconnectDesktopSpotify(); NotchMusic.disconnectSpotify(); status.textContent = 'Original offline demo tracks selected. Spotify keeps its own playback state.'; });
  window.addEventListener('notchdrop:music-source', event => {
    if (event.detail.source === 'spotify-desktop') status.textContent = event.detail.available ? 'Connected. Your current song and playback controls are in the notch.' : event.detail.message || 'Waiting for Spotify. Open it and play a song.';
  });
  try { if (localStorage.getItem('notchdrop.musicSource') === 'spotify-desktop') connect.click(); } catch {}
  if (window.notchDropPendingSpotify) { window.notchDropPendingSpotify = false; connect.click(); }
  }
  if (window.NotchDrop) initialize();
  else window.addEventListener('notchdrop:ready', initialize, {once: true});
})();
