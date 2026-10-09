'use strict';
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const zlib = require('node:zlib');
const WindowsSpotify = require('./spotify.cjs');
const spotifyBridge = new WindowsSpotify();
let coverCache = { raw: '', data: '' };
const root = path.resolve(__dirname, '..');
const testing = process.argv.includes('--notchdrop-test');
app.setName('NotchDrop');
const profile = testing && process.env.NOTCHDROP_TEST_PROFILE ? process.env.NOTCHDROP_TEST_PROFILE : path.join(app.getPath('appData'), 'NotchDrop');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setAppUserModelId('com.notchdrop.desktop');
let dashboard, island, tray, quitting = false, latestSnapshot = null, pointerTimer;
let region = { x: 120, y: 0, width: 200, height: 34 }, inside = false, ignoring = true;
const WINDOW_WIDTH = 460;

function trayImage() {
  const size = 32, rows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = y * (1 + size * 4) + 1 + x * 4;
    const visible = x >= 2 && x < 30 && y >= 2 && y < 30;
    const notch = x >= 8 && x < 24 && y >= 7 && (y < 15 || (x - 15.5) ** 2 + (y - 15) ** 2 < 64);
    rows[p] = notch ? 10 : 201; rows[p + 1] = notch ? 12 : 245; rows[p + 2] = notch ? 10 : 139; rows[p + 3] = visible ? 255 : 0;
  }
  const chunk = (name, data) => {
    const type = Buffer.from(name), bytes = Buffer.concat([type, data]);
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const header = Buffer.alloc(4), tail = Buffer.alloc(4);
    header.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, bytes, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return nativeImage.createFromBuffer(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}
function placement() {
  const { bounds } = screen.getPrimaryDisplay();
  return { x: Math.round(bounds.x + (bounds.width - WINDOW_WIDTH) / 2), y: bounds.y, width: WINDOW_WIDTH, height: Math.min(640, bounds.height) };
}
function pinIsland() {
  if (!island || island.isDestroyed()) return;
  island.setBounds(placement());
  island.setAlwaysOnTop(true, 'screen-saver');
}
function showDashboard() {
  if (!dashboard || dashboard.isDestroyed()) return;
  if (dashboard.isMinimized()) dashboard.restore();
  dashboard.show(); dashboard.focus(); pinIsland();
}
const isSender = (event, window) => window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
function lockNavigation(window, allowed) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== allowed) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}
function updatePointer() {
  if (!island || island.isDestroyed() || !island.isVisible()) return;
  const cursor = screen.getCursorScreenPoint(), bounds = island.getBounds();
  const x = cursor.x - bounds.x, y = cursor.y - bounds.y;
  const nowInside = x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;
  if (ignoring === nowInside) { ignoring = !nowInside; island.setIgnoreMouseEvents(ignoring, { forward: true }); }
  if (inside !== nowInside) { inside = nowInside; island.webContents.send('notch:pointer', inside); }
}
function createWindows() {
  const preferences = { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false };
  dashboard = new BrowserWindow({ title: 'NotchDrop — Command Center', width: 1280, height: 900, minWidth: 700, minHeight: 500, show: false, backgroundColor: '#101112', icon: trayImage(), webPreferences: { ...preferences, autoplayPolicy: 'no-user-gesture-required' } });
  dashboard.setMenuBarVisibility(false);
  dashboard.on('page-title-updated', event => event.preventDefault());
  island = new BrowserWindow({ title: 'NotchDrop — Desktop Notch', ...placement(), frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, show: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, webPreferences: preferences });
  island.setIgnoreMouseEvents(true, { forward: true });
  pinIsland();
  const dashboardURL = pathToFileURL(path.join(root, 'index.html')).href;
  const islandURL = pathToFileURL(path.join(__dirname, 'overlay.html')).href;
  lockNavigation(dashboard, dashboardURL); lockNavigation(island, islandURL);
  const localOrigin = url => typeof url === 'string' && url.startsWith('file://');
  dashboard.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents === dashboard.webContents && localOrigin(contents.getURL()) && ['clipboard-read', 'clipboard-sanitized-write'].includes(permission));
  });
  dashboard.webContents.session.setPermissionCheckHandler((contents, permission) => contents === dashboard.webContents && ['clipboard-read', 'clipboard-sanitized-write'].includes(permission));
  dashboard.on('close', event => { if (!quitting) { event.preventDefault(); dashboard.hide(); } });
  island.on('close', event => { if (!quitting) event.preventDefault(); });
  dashboard.once('ready-to-show', () => { if (!testing) dashboard.show(); });
  dashboard.webContents.on('did-start-loading', () => { latestSnapshot = null; if (island && !island.isDestroyed()) island.hide(); });
  dashboard.webContents.once('did-finish-load', () => { if (process.argv.includes('--spotify')) dashboard.webContents.send('notch:perform', { kind: 'spotify-connect' }); });
  island.webContents.once('did-finish-load', () => { if (latestSnapshot) island.webContents.send('notch:snapshot', latestSnapshot); });
  dashboard.loadURL(dashboardURL);
  island.loadURL(islandURL);
  tray = new Tray(trayImage());
  tray.setToolTip('NotchDrop — your primary-screen island');
  const menu = Menu.buildFromTemplate([
    { label: 'Open Command Center', click: showDashboard },
    { label: 'Connect Spotify desktop', click: () => dashboard.webContents.send('notch:perform', { kind: 'spotify-connect' }) },
    { label: 'Recenter on primary monitor', click: pinIsland },
    { type: 'separator' },
    { label: 'Quit NotchDrop', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu); tray.on('double-click', showDashboard);
  ipcMain.on('notch:menu', event => { if (isSender(event, island)) menu.popup({ window: island }); });
  pointerTimer = setInterval(updatePointer, 45);
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, pinIsland);
}

ipcMain.on('notch:publish', (event, data) => {
  if (!isSender(event, dashboard) || !data || typeof data.html !== 'string' || data.html.length > 250000) return;
  if (typeof data.state !== 'string' || !Array.isArray(data.forms)) return;
  latestSnapshot = data;
  if (island && !island.isDestroyed()) {
    island.webContents.send('notch:snapshot', data);
    if (data.enabled === false) island.hide(); else if (!island.isVisible()) { island.showInactive(); pinIsland(); }
  }
});
ipcMain.on('notch:action', (event, data) => {
  if (!isSender(event, island) || !data || !['hover', 'leave', 'click', 'input', 'change', 'drag', 'dragend', 'escape'].includes(data.kind)) return;
  if (data.id !== undefined && !/^d\d{1,9}$/.test(data.id)) return;
  if (data.value !== undefined && String(data.value).length > 1000) return;
  dashboard.webContents.send('notch:perform', data);
});
ipcMain.on('notch:region', (event, data) => {
  if (!isSender(event, island) || !data || !['x','y','width','height'].every(k => Number.isFinite(data[k]))) return;
  region = { x: Math.max(0, data.x), y: Math.max(0, data.y), width: Math.max(0, Math.min(WINDOW_WIDTH, data.width)), height: Math.max(0, Math.min(640, data.height)) };
  updatePointer();
});
ipcMain.on('notch:ready', event => {
  if (isSender(event, island) && latestSnapshot) island.webContents.send('notch:snapshot', latestSnapshot);
  if (isSender(event, island) && dashboard) dashboard.webContents.send('notch:refresh');
});
ipcMain.on('notch:show-dashboard', event => { if (isSender(event, island) || isSender(event, dashboard)) showDashboard(); });
ipcMain.handle('notch:spotify', async (event, data) => {
  if (!isSender(event, dashboard) || !data || !['status','toggle','next','previous','seek'].includes(data.action)) return { error: 'Unsupported Spotify request.' };
  try {
    const state = await spotifyBridge.request(data.action, data.position);
    if (state.cover) {
      if (state.cover !== coverCache.raw) {
        const cover = nativeImage.createFromBuffer(Buffer.from(state.cover, 'base64'));
        coverCache = { raw: state.cover, data: cover.isEmpty() ? '' : cover.resize({ width: 128, height: 128 }).toDataURL() };
      }
      state.cover = coverCache.data;
    }
    return { state };
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('notch:drop', (event, data) => {
  if (!isSender(event, island) || !data) return { error: 'Invalid drop source.' };
  if (typeof data.text === 'string' && new TextEncoder().encode(data.text).length <= 65536) {
    dashboard.webContents.send('notch:receive-drop', { text: data.text }); return { ok: true };
  }
  if (!Array.isArray(data.files) || !data.files.length || data.files.length > 16) return { error: 'Choose between 1 and 16 files.' };
  let total = 0;
  for (const file of data.files) {
    if (typeof file.name !== 'string' || file.name.length > 255 || typeof file.type !== 'string' || !(file.bytes instanceof ArrayBuffer)) return { error: 'Invalid file data.' };
    total += file.bytes.byteLength;
    if (file.bytes.byteLength > 100 * 1024 * 1024 || total > 200 * 1024 * 1024) return { error: 'Use files under 100 MB each and 200 MB per drop.' };
  }
  dashboard.webContents.send('notch:receive-drop', { files: data.files });
  return { ok: true };
});

if (!testing && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showDashboard);
  app.whenReady().then(createWindows);
}
app.on('before-quit', () => { quitting = true; clearInterval(pointerTimer); spotifyBridge.stop(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
app.on('activate', showDashboard);
