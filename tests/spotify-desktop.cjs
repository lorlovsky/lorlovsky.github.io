/* Read-only live Spotify check, plus playback-command routing using a fake adapter.
 * Does not pause, seek, or skip the user's actual Spotify music. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'notchdrop-spotify-test-'));
  const electron = await _electron.launch({ executablePath: require(path.join(root, 'node_modules', 'electron')), args: [path.join(root, 'desktop/main.cjs'), '--notchdrop-test'], env: { ...process.env, NOTCHDROP_TEST_PROFILE: profile } });
  try {
    let page;
    for (let i = 0; i < 100 && !page; i++) { page = electron.windows().find(p => p.url().endsWith('/index.html')); if (!page) await new Promise(r => setTimeout(r, 100)); }
    assert(page);
    await page.waitForFunction(() => !!document.querySelector('#spotify-desktop-connect'));
    const live = await page.evaluate(() => NotchDesktop.spotify('status'));
    assert(!live.error, live.error);
    assert.equal(typeof live.state.available, 'boolean');
    await page.evaluate(() => document.querySelector('#spotify-desktop-connect').click());
    await page.waitForFunction(() => NotchMusic.getState().source === 'spotify-desktop');
    if (live.state.available) await page.waitForFunction(() => NotchMusic.getState().available && NotchMusic.getState().title !== 'Waiting for Spotify');
    assert.equal(await page.evaluate(() => localStorage.getItem('notchdrop.musicSource')), 'spotify-desktop');
    await page.evaluate(async () => {
      window.spotifyActions = [];
      window.fakeSpotify = { available: true, title: 'First test track', artist: 'Test artist', duration: 120, position: 10, playing: false, canSeek: true, canNext: true, canPrevious: true, canPlayPause: true };
      await NotchMusic.connectDesktopSpotify(async (action, position) => {
        spotifyActions.push(action);
        if (action === 'toggle') fakeSpotify.playing = !fakeSpotify.playing;
        if (action === 'next') fakeSpotify.title = 'Second test track';
        if (action === 'previous') fakeSpotify.title = 'First test track';
        if (action === 'seek') fakeSpotify.position = position;
        return { state: { ...fakeSpotify } };
      });
      await togglePlay(); await nextTrack(); await prevTrack(); await seekTrack(45);
    });
    const state = await page.evaluate(() => ({ music: NotchMusic.getState(), actions: spotifyActions, title: document.querySelector('#notch-track-title').textContent }));
    assert.equal(state.music.source, 'spotify-desktop'); assert.equal(state.music.playing, true);
    assert.equal(state.title, 'First test track'); assert(state.music.position >= 45);
    for (const action of ['toggle','next','previous','seek']) assert(state.actions.includes(action));
    await page.evaluate(() => document.querySelector('#spotify-use-demo').click());
    assert.equal(await page.evaluate(() => NotchMusic.getState().source), 'demo');
    assert.equal(await page.locator('#track-title').innerText(), 'After Hours');
    assert.equal(await page.evaluate(() => localStorage.getItem('notchdrop.musicSource')), 'demo');
    console.log(`PASS: Windows Spotify media bridge (${live.state.available ? 'active session detected' : 'no active session; waiting state verified'}), source selection and persistence, track rendering, play/pause/next/previous/seek routing, return to demos. Actual Spotify playback was not modified.`);
  } finally { await electron.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
