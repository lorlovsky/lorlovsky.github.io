/* Desktop integration test. npm install first; Playwright supplied externally. */
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'notchdrop-desktop-test-'));
  const executablePath = require(path.join(root, 'node_modules', 'electron'));
  const electron = await _electron.launch({ executablePath, args: [path.join(root, 'desktop', 'main.cjs'), '--notchdrop-test'], env: { ...process.env, NOTCHDROP_TEST_PROFILE: profile } });
  const errors = [];
  try {
    let dashboard, overlay;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      for (const page of electron.windows()) {
        if (page.url().endsWith('/index.html')) dashboard = page;
        if (page.url().endsWith('/desktop/overlay.html')) overlay = page;
      }
      if (dashboard && overlay) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert(dashboard && overlay, 'Both isolated windows created');
    for (const page of [dashboard, overlay]) page.on('pageerror', error => errors.push(error.message));
    await dashboard.waitForFunction(() => !!window.NotchDrop);
    await overlay.waitForFunction(() => !!document.querySelector('[data-desktop-action]'));
    const windows = await electron.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Desktop Notch'));
      return { bounds: win.getBounds(), primary: screen.getPrimaryDisplay().bounds, alwaysOnTop: win.isAlwaysOnTop(), visible: win.isVisible(), resizable: win.isResizable() };
    });
    assert.equal(windows.bounds.y, windows.primary.y);
    assert.equal(windows.bounds.x, Math.round(windows.primary.x + (windows.primary.width - windows.bounds.width) / 2));
    assert.equal(windows.alwaysOnTop, true);
    assert.equal(windows.visible, true);
    assert.equal(windows.resizable, false);
    assert.equal(await overlay.evaluate(() => typeof require), 'undefined');
    assert.equal(await dashboard.evaluate(() => typeof require), 'undefined');
    // Exercise the actual native click-through API with controlled cursor coordinates.
    await electron.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find(win => win.getTitle().includes('Desktop Notch'));
      w._realIgnore = w.setIgnoreMouseEvents.bind(w);
      w.setIgnoreMouseEvents = (ignore, options) => { w._testIgnored = ignore; w._realIgnore(ignore, options); };
      screen._realCursor = screen.getCursorScreenPoint.bind(screen);
      const bounds = w.getBounds();
      screen.getCursorScreenPoint = () => ({ x: bounds.x + bounds.width / 2, y: bounds.y + 10 });
    });
    await overlay.waitForFunction(() => document.querySelector('#notch').dataset.state === 'music');
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Desktop Notch'))._testIgnored), false);
    await electron.evaluate(({ BrowserWindow, screen }) => {
      const bounds = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Desktop Notch')).getBounds();
      screen.getCursorScreenPoint = () => ({ x: bounds.x - 100, y: bounds.y + 200 });
    });
    await overlay.waitForFunction(() => document.querySelector('#notch').dataset.state === 'idle');
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Desktop Notch'))._testIgnored), true);
    await electron.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find(win => win.getTitle().includes('Desktop Notch'));
      w.setIgnoreMouseEvents = w._realIgnore; screen.getCursorScreenPoint = screen._realCursor;
      w.setBounds({ ...w.getBounds(), x: w.getBounds().x + 50 });
      screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), ['bounds']);
    });
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Desktop Notch')).getBounds().x), windows.bounds.x);
    await overlay.locator('#notch').dispatchEvent('mouseenter');
    await overlay.waitForFunction(() => document.querySelector('#notch').dataset.state === 'music');
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await overlay.screenshot({ path: path.join(root, 'test-results', 'native-notch.png'), omitBackground: true });
    await overlay.locator('[data-music=play]').click();
    await dashboard.waitForFunction(() => NotchMusic.getState().playing);
    await overlay.locator('[data-music=next]').click();
    await dashboard.waitForFunction(() => NotchMusic.getState().title === 'Soft Landing');
    await overlay.locator('[data-music=play]').click();
    await dashboard.waitForFunction(() => !NotchMusic.getState().playing);
    await electron.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Command Center')); w.minimize(); });
    assert(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Desktop Notch')).isVisible()));
    await overlay.evaluate(() => NotchDesktop.drop({ text: 'A note dropped on the native island' }));
    await overlay.waitForFunction(() => document.querySelector('#notch').dataset.state === 'targets');
    assert((await overlay.locator('#notch-content').innerText()).includes('A note dropped on the native island'));
    await overlay.getByRole('button', { name: 'Cancel', exact: true }).click({ force: true });
    await dashboard.waitForFunction(() => NotchDrop.getState().pendingType === null);
    const result = await overlay.evaluate(() => NotchDesktop.drop({ files: [{ name: 'desktop-test.txt', type: 'text/plain', bytes: new TextEncoder().encode('native file drop').buffer }] }));
    assert.equal(result.ok, true);
    await overlay.waitForFunction(() => document.querySelector('#notch').dataset.state === 'targets');
    await overlay.waitForFunction(() => document.querySelector('#notch-content').textContent.includes('desktop-test.txt'));
    await overlay.getByRole('button', { name: 'Cancel', exact: true }).click({ force: true });
    await overlay.evaluate(() => NotchDesktop.showDashboard());
    await dashboard.locator('.topbar .settings-open').click();
    await dashboard.locator('#setting-notch').uncheck({ force: true });
    await dashboard.locator('#settings-form button[type=submit]').click();
    await dashboard.waitForTimeout(400);
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Desktop Notch')).isVisible()), false);
    await dashboard.locator('.topbar .settings-open').click();
    await dashboard.locator('#setting-notch').check({ force: true });
    await dashboard.locator('#settings-form button[type=submit]').click();
    await dashboard.waitForTimeout(400);
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Desktop Notch')).isVisible()), true);
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Command Center')).close());
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Desktop Notch')).isVisible()), true);
    assert.deepEqual(errors, []);
    console.log('PASS: primary-monitor top-center position, always-on-top native window, sandboxed renderers, hover expansion, shared music controls, text/file drops, settings visibility, notch survives dashboard minimize/close.');
  } finally { await electron.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
