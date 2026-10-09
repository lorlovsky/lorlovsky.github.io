/* Run against `node serve.cjs`: PLAYWRIGHT_PATH points to a Playwright install. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.env.NOTCHDROP_URL || 'http://localhost:8080';
const output = path.join(__dirname, '..', 'test-results');

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    // Verify the entire local experience with every CDN and font request blocked.
    await context.route(/^https:\/\//, route => route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.NotchMusic && document.querySelector('#devices-list').children.length);
    assert.equal(await page.locator('h1').innerText(), 'Your devices, in sync.');
    assert(await page.locator('#devices-list').innerText());
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.locator('.round-play').click();
    await page.waitForFunction(() => NotchMusic.getState().playing);
    const before = await page.evaluate(() => NotchMusic.getState().position);
    await page.waitForFunction(initial => NotchMusic.getState().position > initial + .05, before, { timeout: 5000 });
    await page.evaluate(() => seekTrack(25));
    assert((await page.evaluate(() => NotchMusic.getState().position)) >= 25);
    await page.evaluate(() => nextTrack());
    assert.equal(await page.locator('#track-title').innerText(), 'Soft Landing');
    await page.locator('.round-play').click();
    assert.equal(await page.evaluate(() => NotchMusic.getState().playing), false);
    await page.locator('#notch').hover();
    await page.waitForFunction(() => document.querySelector('#notch').dataset.state === 'music');
    await page.mouse.move(700, 350);

    await page.locator('.topbar .settings-open').click();
    await page.locator('#handle').fill('QA Explorer');
    await page.locator('#device-name').fill('Test Laptop');
    await page.locator('#setting-notch').uncheck({ force: true });
    await page.locator('#settings-form button[type=submit]').click();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#profile-name').textContent === 'QA Explorer');
    assert.equal(await page.locator('#notch').isVisible(), false);
    await page.locator('#write-note').click();
    await page.locator('#note-text').fill('Send while the notch is disabled');
    await page.locator('#note-form button[type=submit]').click();
    await page.locator('#target-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#notch').isVisible(), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => NotchDrop.getState().pendingType), null);
    await page.locator('.topbar .settings-open').click();
    assert.equal(await page.locator('#device-name').inputValue(), 'Test Laptop');
    await page.locator('#setting-notch').check({ force: true });
    await page.locator('#settings-form button[type=submit]').click();

    await page.locator('#write-note').click();
    await page.locator('#note-text').fill('<img src=x onerror=alert(1)> A safe plain-text note');
    await page.locator('#note-form button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#notch').dataset.state === 'targets');
    assert.equal(await page.locator('#notch-content img').count(), 0);
    await page.keyboard.press('Escape');

    await page.locator('#open-pranks').click();
    await page.locator('[data-prank=cat]').click();
    await page.locator('#preview-prank').click();
    await page.waitForFunction(() => document.querySelector('#prank-overlay').open);
    assert.equal(await page.locator('#notch').getAttribute('data-state'), 'prank');
    await page.waitForTimeout(400);
    assert((await page.locator('#notch').boundingBox()).width >= 380);
    await page.locator('#dismiss-prank').click();
    await page.keyboard.press('Escape');

    const dt = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(['test content'], 'hello.txt', { type: 'text/plain' })); return data; });
    await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt });
    await page.dispatchEvent('body', 'dragover', { dataTransfer: dt, clientY: 12 });
    await page.waitForFunction(() => document.querySelector('#notch').dataset.state === 'drag');
    await page.dispatchEvent('#notch', 'drop', { dataTransfer: dt });
    await page.waitForFunction(() => document.querySelector('#notch').dataset.state === 'targets');
    await page.keyboard.press('Escape');
    await page.locator('#pair-button').click();
    assert((await page.locator('#my-peer-id').inputValue()).startsWith('user-'));
    assert((await page.locator('#pair-warning').innerText()).length > 0);
    await page.keyboard.press('Escape');

    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400);
      const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert(sizes.scroll <= sizes.width + 1, `Horizontal overflow at ${width}: ${sizes.scroll}`);
      if (width === 390) await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    }
    await context.close();
    const local = await browser.newContext();
    await local.route(/^https?:\/\//, route => route.abort());
    const filePage = await local.newPage();
    filePage.on('pageerror', error => errors.push(error.message));
    await filePage.goto(require('node:url').pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await filePage.waitForFunction(() => window.NotchMusic && document.querySelector('#devices-list').children.length);
    await filePage.locator('.round-play').click();
    await filePage.waitForFunction(() => NotchMusic.getState().playing);
    await local.close();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log('PASS: offline desktop/mobile/file://, music playback and seeking, persisted settings, plain-text note, prank preview, drag/drop, pairing fallback, no horizontal overflow or browser exceptions.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
