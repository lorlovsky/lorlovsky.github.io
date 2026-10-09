/* NotchDrop original, royalty-free synthesized demos. No media downloads required.
 * Optional Spotify: NotchMusic.connectSpotify(callback => callback(accessToken)).
 * Provide fresh Premium-user tokens from your own OAuth flow; never store secrets here.
 * Select "NotchDrop" in Spotify Connect after the SDK reports ready. SDK reference:
 * https://developer.spotify.com/documentation/web-playback-sdk/reference
 */
(() => {
  'use strict';
  const TRACKS = [
    { title: 'After Hours', root: 48, notes: [12, 19, 15, 22, 19, 15, 10, 17], chords: [0, 8, 3, 10], color: '#cf986a' },
    { title: 'Soft Landing', root: 50, notes: [12, 16, 19, 23, 19, 16, 14, 21], chords: [0, 7, 9, 5], color: '#99b9c8' },
    { title: 'Window Seat', root: 45, notes: [12, 15, 19, 22, 24, 19, 17, 15], chords: [0, 5, 8, 7], color: '#b2a0ce' }
  ];
  const DURATION = 60;
  const buffers = new Map();
  let context, source, master, index = 0, offset = 0, startedAt = 0;
  let playing = false, initialized = false, frame = 0, generation = 0;
  let spotify = null, spotifyState = null, spotifyAt = 0, sdkPromise = null;
  let desktop = null, desktopState = null, desktopAt = 0, desktopTimer = null, desktopBusy = false;
  let desktopSeekTimer = null;
  const desktopSeekWaiters = [];
  let toast = () => {};
  const $ = id => document.getElementById(id);
  const format = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const frequency = midi => 440 * Math.pow(2, (midi - 69) / 12);
  const setText = (id, text) => { if ($(id)) $(id).textContent = text; };

  // Rendering to a buffer makes playback independent of background timer throttling.
  function makeBuffer(track) {
    const rate = 22050;
    const buffer = context.createBuffer(1, rate * DURATION, rate);
    const samples = buffer.getChannelData(0);
    const tau = Math.PI * 2;
    const melody = track.notes.map(n => tau * frequency(track.root + n));
    const chords = track.chords.map(n => [0, 3, 7].map(interval => tau * frequency(track.root + n + interval)));
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate;
      const step = Math.floor(t / .5);
      const noteTime = t % .5;
      const chord = chords[Math.floor(t / 4) % chords.length];
      const note = melody[step % melody.length];
      const pluckEnvelope = Math.min(1, noteTime * 90) * Math.exp(-noteTime * 6);
      const pluck = (Math.sin(note * t) + .15 * Math.sin(note * t * 2)) * pluckEnvelope * .19;
      const padEnvelope = .55 + .45 * Math.sin(Math.PI * (t % 4) / 4);
      const pad = (Math.sin(chord[0] * t) + Math.sin(chord[1] * t) + Math.sin(chord[2] * t)) * .033 * padEnvelope;
      const beat = t % 1;
      const kick = Math.sin(tau * (48 * beat + 6 * (1 - Math.exp(-beat * 18)))) * Math.exp(-beat * 16) * .17;
      const bass = Math.sin(chord[0] * t / 2) * Math.exp(-(t % .5) * 5) * .08;
      const fade = Math.min(1, t / .15, (DURATION - t) / .5);
      samples[i] = (pluck + pad + kick + bass) * fade;
    }
    return buffer;
  }

  function ensureAudio() {
    if (context) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('This browser does not support Web Audio.');
    context = new Audio();
    master = context.createGain();
    master.gain.value = .45;
    master.connect(context.destination);
  }

  function position() {
    if (desktop) {
      if (!desktopState?.available) return 0;
      const elapsed = playing ? (performance.now() - desktopAt) / 1000 : 0;
      return Math.min(desktopState.duration || 0, (desktopState.position || 0) + elapsed);
    }
    if (spotify) {
      if (!spotifyState) return 0;
      const elapsed = spotifyState.paused ? 0 : (performance.now() - spotifyAt) / 1000;
      return Math.min(spotifyState.duration / 1000, spotifyState.position / 1000 + elapsed);
    }
    return Math.min(DURATION, offset + (playing && context ? context.currentTime - startedAt : 0));
  }

  function stopSource() {
    if (source) {
      source.onended = null;
      try { source.stop(); } catch (_) { /* Already ended. */ }
      source.disconnect();
      source = null;
    }
  }

  function updateUI() {
    const liveTrack = spotifyState?.track_window?.current_track;
    const title = desktop ? (desktopState?.title || 'Waiting for Spotify') : spotify ? (liveTrack?.name || 'Spotify Connect ready') : TRACKS[index].title;
    const artist = desktop ? (desktopState?.available ? `${desktopState.artist || 'Spotify'} · Spotify desktop` : desktopState?.message || 'Open Spotify and play a song') : spotify ? `${liveTrack?.artists?.map(item => item.name).join(', ') || 'Choose NotchDrop in Spotify'} · Spotify` : 'NotchDrop Sessions · offline demo';
    setText('track-title', title);
    setText('notch-track-title', title);
    setText('track-artist', artist);
    const subtitle = document.querySelector('.notch-track small');
    if (subtitle) subtitle.textContent = artist;
    document.body.classList.toggle('music-playing', playing);
    document.body.dataset.musicSource = desktop ? 'spotify-desktop' : spotify ? 'spotify' : 'demo';
    document.querySelectorAll('[data-music="play"]').forEach(button => {
      button.textContent = playing ? 'Ⅱ' : '▶';
      button.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${spotify || desktop ? 'Spotify' : 'demo music'}`);
      button.setAttribute('aria-pressed', String(playing));
    });
    document.querySelectorAll('[data-music]').forEach(button => {
      const capability = { play: 'canPlayPause', next: 'canNext', prev: 'canPrevious' }[button.dataset.music];
      button.disabled = !!desktop && (!desktopState?.available || desktopState?.[capability] === false);
    });
    document.querySelectorAll('.album-art').forEach(art => {
      art.style.setProperty('--album-color', TRACKS[index].color);
      const caption = art.querySelector('small');
      if (caption) caption.textContent = spotify || desktop ? 'SPOTIFY' : TRACKS[index].title.toUpperCase();
      art.setAttribute('aria-label', spotify || desktop ? 'Spotify playback' : `${title}, original synthesized demo`);
      const cover = desktop && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(desktopState?.cover || '') ? desktopState.cover : '';
      art.classList.toggle('has-cover', !!cover);
      if (cover) art.style.backgroundImage = `url("${cover}")`; else art.style.removeProperty('background-image');
    });
    updateProgress();
    if ('mediaSession' in navigator && !spotify && !desktop && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'NotchDrop Sessions', album: 'Original offline demos' });
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
    window.dispatchEvent(new CustomEvent('notchdrop:music-source', { detail: { source: desktop ? 'spotify-desktop' : spotify ? 'spotify' : 'demo', available: !!desktopState?.available, message: desktopState?.message || '' } }));
  }

  function updateProgress() {
    const seconds = position();
    const duration = desktop ? (desktopState?.duration || 1) : spotifyState?.duration ? spotifyState.duration / 1000 : DURATION;
    document.querySelectorAll('#notch-seek, #music-seek, [data-music-seek]').forEach(slider => {
      slider.max = String(duration);
      slider.disabled = !!desktop && (!desktopState?.available || !desktopState.canSeek);
      slider.value = String(seconds);
      slider.setAttribute('aria-valuetext', `${format(seconds)} of ${format(duration)}`);
      slider.style.setProperty('--progress', `${seconds / duration * 100}%`);
    });
    setText('music-time', format(seconds));
    setText('music-duration', format(duration));
  }

  function tick() {
    cancelAnimationFrame(frame);
    updateProgress();
    if (playing) frame = requestAnimationFrame(tick);
  }

  async function playDemo() {
    const current = ++generation;
    try {
      ensureAudio();
      await context.resume();
      if (current !== generation || spotify || desktop) return;
      if (context.state !== 'running') throw new Error('Tap play again to enable audio in your browser.');
      if (!buffers.has(index)) buffers.set(index, makeBuffer(TRACKS[index]));
      stopSource();
      if (offset >= DURATION) offset = 0;
      source = context.createBufferSource();
      source.buffer = buffers.get(index);
      source.connect(master);
      startedAt = context.currentTime;
      playing = true;
      source.onended = () => {
        if (current !== generation || !playing) return;
        index = (index + 1) % TRACKS.length;
        offset = 0;
        playDemo();
      };
      source.start(0, offset);
      updateUI();
      tick();
    } catch (error) {
      playing = false;
      stopSource();
      updateUI();
      toast(error.message || 'Audio could not start. Tap play to retry.');
    }
  }

  function pauseDemo() {
    offset = position();
    generation++;
    playing = false;
    stopSource();
    cancelAnimationFrame(frame);
    updateUI();
  }

  async function spotifyCommand(method, value) {
    try {
      if (!spotifyState) {
        toast('Select NotchDrop in Spotify Connect and start a track first.');
        return;
      }
      if (method === 'togglePlay') await spotify.activateElement();
      await spotify[method](value);
      const state = await spotify.getCurrentState();
      if (state) receiveSpotifyState(state);
    } catch (error) { toast(`Spotify: ${error.message || 'Playback command failed.'}`); }
  }

  function togglePlay() {
    if (desktop) return desktopCommand('toggle');
    if (spotify) return spotifyCommand('togglePlay');
    if (playing) pauseDemo(); else return playDemo();
  }

  function changeTrack(direction) {
    if (desktop) return desktopCommand(direction > 0 ? 'next' : 'previous');
    if (spotify) return spotifyCommand(direction > 0 ? 'nextTrack' : 'previousTrack');
    const wasPlaying = playing;
    pauseDemo();
    index = (index + direction + TRACKS.length) % TRACKS.length;
    offset = 0;
    updateUI();
    if (wasPlaying) return playDemo();
  }

  function seekTrack(value) {
    const number = Number(value?.target?.value ?? value);
    if (!Number.isFinite(number)) return;
    const duration = desktop ? (desktopState?.duration || 0) : spotifyState?.duration ? spotifyState.duration / 1000 : DURATION;
    const seconds = Math.max(0, Math.min(duration, number));
    if (desktop) {
      const adapter = desktop;
      clearTimeout(desktopSeekTimer);
      return new Promise(resolve => {
        desktopSeekWaiters.push(resolve);
        desktopSeekTimer = setTimeout(async () => {
          const waiting = desktopSeekWaiters.splice(0);
          if (desktop === adapter) await desktopCommand('seek', seconds);
          waiting.forEach(done => done());
        }, 120);
      });
    }
    if (spotify) return spotifyCommand('seek', Math.round(seconds * 1000));
    const wasPlaying = playing;
    pauseDemo();
    offset = seconds;
    updateProgress();
    if (wasPlaying) return playDemo();
  }

  function receiveSpotifyState(state) {
    spotifyState = state;
    spotifyAt = performance.now();
    playing = Boolean(state && !state.paused);
    updateUI();
    tick();
  }

  function loadSpotifySDK() {
    if (window.Spotify?.Player) return Promise.resolve();
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const previous = window.onSpotifyWebPlaybackSDKReady;
      const script = document.createElement('script');
      const timeout = setTimeout(() => finish(new Error('Spotify SDK timed out. Check your connection.')), 15000);
      const finish = error => {
        clearTimeout(timeout);
        window.onSpotifyWebPlaybackSDKReady = previous;
        if (error) { script.remove(); sdkPromise = null; reject(error); } else resolve();
      };
      window.onSpotifyWebPlaybackSDKReady = () => {
        try { if (previous) previous(); } finally { finish(); }
      };
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      script.onerror = () => finish(new Error('Spotify SDK could not load. Offline demos remain available.'));
      document.head.append(script);
    });
    return sdkPromise;
  }

  async function connectSpotify(getOAuthToken) {
    if (typeof getOAuthToken !== 'function') throw new TypeError('Provide the SDK getOAuthToken(callback) function.');
    disconnectDesktopSpotify();
    disconnectSpotify();
    try {
      await loadSpotifySDK();
      const player = new window.Spotify.Player({ name: 'NotchDrop', getOAuthToken, volume: .3 });
      pauseDemo();
      spotify = player;
      player.addListener('ready', ({ device_id }) => {
        if (spotify !== player) return;
        toast('Spotify connected. Select NotchDrop in Spotify Connect to start your music.');
        window.dispatchEvent(new CustomEvent('notchdrop:spotify-ready', { detail: { deviceId: device_id } }));
        updateUI();
      });
      player.addListener('player_state_changed', state => { if (spotify === player) receiveSpotifyState(state); });
      player.addListener('not_ready', () => { if (spotify === player) { disconnectSpotify(); toast('Spotify disconnected. Offline demos are ready.'); } });
      player.addListener('autoplay_failed', () => toast('Tap play to allow Spotify audio.'));
      ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach(event => {
        player.addListener(event, ({ message }) => {
          if (spotify !== player) return;
          disconnectSpotify();
          toast(`Spotify: ${message}. Offline demos are available.`);
        });
      });
      if (!await player.connect()) throw new Error('Spotify could not connect. Check your token and Premium account.');
      if (spotify !== player) return null;
      updateUI();
      return player;
    } catch (error) {
      disconnectSpotify();
      toast(error.message || 'Spotify connection failed. Offline demos are ready.');
      return null;
    }
  }

  function disconnectSpotify() {
    const player = spotify;
    spotify = null;
    spotifyState = null;
    if (player) player.disconnect();
    pauseDemo();
    offset = 0;
    updateUI();
  }

  function receiveDesktopState(state) {
    desktopState = state;
    desktopAt = performance.now();
    playing = !!(state?.available && state.playing);
    updateUI(); tick();
  }
  async function pollDesktop() {
    if (!desktop || desktopBusy) return;
    const adapter = desktop; desktopBusy = true;
    try {
      const result = await adapter('status');
      if (desktop !== adapter) return;
      if (result.error) throw new Error(result.error);
      receiveDesktopState(result.state);
    } catch (error) {
      if (desktop === adapter) receiveDesktopState({ available: false, playing: false, message: error.message });
    } finally { desktopBusy = false; }
  }
  async function desktopCommand(action, value) {
    if (!desktop) return;
    const adapter = desktop;
    try {
      const result = await adapter(action, value);
      if (desktop !== adapter) return;
      if (result.error) throw new Error(result.error);
      receiveDesktopState(result.state);
    } catch (error) { toast(error.message || 'Spotify could not respond.'); }
  }
  async function connectDesktopSpotify(adapter) {
    if (typeof adapter !== 'function') throw new TypeError('A desktop media adapter is required.');
    disconnectDesktopSpotify(); disconnectSpotify();
    desktop = adapter;
    if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
    receiveDesktopState({ available: false, message: 'Connecting to Spotify desktop…' });
    await pollDesktop();
    if (desktop === adapter) desktopTimer = setInterval(pollDesktop, 1500);
    return !!desktopState?.available;
  }
  function disconnectDesktopSpotify() {
    if (!desktop && !desktopTimer) return;
    clearTimeout(desktopSeekTimer); desktopSeekWaiters.splice(0).forEach(done => done());
    clearInterval(desktopTimer); desktopTimer = null;
    desktop = null; desktopState = null; playing = false; offset = 0;
    cancelAnimationFrame(frame); updateUI();
  }

  function init(options = {}) {
    if (options.toast) toast = options.toast;
    if (initialized) return;
    initialized = true;
    document.querySelectorAll('[data-music]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      const action = button.dataset.music;
      if (action === 'play') togglePlay();
      if (action === 'next') changeTrack(1);
      if (action === 'prev') changeTrack(-1);
    }));
    document.querySelectorAll('#notch-seek, #music-seek, [data-music-seek]').forEach(slider => {
      slider.addEventListener('input', seekTrack);
      slider.addEventListener('click', event => event.stopPropagation());
    });
    if ('mediaSession' in navigator) {
      const handlers = { play: () => { if (!playing) togglePlay(); }, pause: () => { if (playing) togglePlay(); }, previoustrack: () => changeTrack(-1), nexttrack: () => changeTrack(1), seekto: details => seekTrack(details.seekTime) };
      for (const [action, handler] of Object.entries(handlers)) {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) { /* Optional browser support. */ }
      }
    }
    window.addEventListener('pagehide', () => {
      if (desktop) disconnectDesktopSpotify(); else if (spotify) disconnectSpotify(); else pauseDemo();
      if (context) context.suspend().catch(() => {});
    });
    updateUI();
  }

  window.togglePlay = togglePlay;
  window.nextTrack = () => changeTrack(1);
  window.prevTrack = () => changeTrack(-1);
  window.seekTrack = seekTrack;
  window.NotchMusic = { init, togglePlay, nextTrack: window.nextTrack, prevTrack: window.prevTrack, seekTrack, connectSpotify, disconnectSpotify, connectDesktopSpotify, disconnectDesktopSpotify, getState: () => ({ source: desktop ? 'spotify-desktop' : spotify ? 'spotify' : 'demo', playing, available: desktop ? !!desktopState?.available : true, title: desktop ? desktopState?.title || 'Waiting for Spotify' : spotifyState?.track_window?.current_track?.name || TRACKS[index].title, position: position(), duration: desktop ? desktopState?.duration || 0 : spotifyState?.duration / 1000 || DURATION }) };
})();
