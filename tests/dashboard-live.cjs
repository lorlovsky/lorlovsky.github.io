/* End-to-end UI checks using real signaling and two isolated browser profiles. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { accountFixture } = require('./account-fixture.cjs');
(async () => {
  const accounts = await accountFixture();
  const base = process.env.NOTCHDROP_URL || accounts.url;
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  const errors = [];
  try {
    const ca = await browser.newContext({ acceptDownloads: true });
    const cb = await browser.newContext({ acceptDownloads: true });
    await accounts.prepare(ca, 'dashboard_a'); await accounts.prepare(cb, 'dashboard_b');
    const a = await ca.newPage(), b = await cb.newPage();
    for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
    await Promise.all([a.goto(base), b.goto(base)]);
    await Promise.all([a, b].map(page => page.waitForFunction(() => window.NotchDrop?.getState().networkState === 'online')));
    const aid = await a.evaluate(() => NotchDrop.getIdentity().id);
    // Approval must work even while the host's QR modal is still open.
    await a.locator('#pair-button').click();
    assert(await a.locator('#qr-code canvas').count());
    await b.locator('#add-friend').click();
    await b.locator('#friend-dialog summary').click();
    await b.locator('#friend-peer-id').fill(aid);
    await b.locator('#friend-form button[type=submit]').click();
    await a.locator('#request-dialog').waitFor({ state: 'visible' });
    await a.locator('#request-accept').click();
    await a.keyboard.press('Escape');
    await Promise.all([a, b].map(page => page.waitForFunction(() => NotchDrop.getState().contacts.some(c => c.online))));
    assert.equal((await a.evaluate(() => NotchDrop.getState().contacts[0].kind)), 'friend');
    const payload = Buffer.alloc(160123);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 239;
    await b.locator('#file-input').setInputFiles({ name: 'ui-roundtrip.bin', mimeType: 'application/octet-stream', buffer: payload });
    await b.locator('.target-option input').check();
    await b.locator('.target-actions .primary').click();
    await a.locator('#notch-content').getByRole('button', { name: 'Accept', exact: true }).click();
    await a.locator('a[download="ui-roundtrip.bin"]').waitFor();
    await a.waitForTimeout(200);
    const downloadWait = a.waitForEvent('download');
    await a.locator('a[download="ui-roundtrip.bin"]').click();
    const download = await downloadWait;
    assert.deepEqual(await fs.readFile(await download.path()), payload);

    async function note(text) {
      await b.locator('#write-note').click();
      await b.locator('#note-text').fill(text);
      await b.locator('#note-form button[type=submit]').click();
      await b.locator('.target-option input').check();
      await b.locator('.target-actions .primary').click();
    }
    await note('decline this note');
    await a.locator('#notch-content').getByRole('button', { name: 'Decline', exact: true }).click();
    assert.equal(await a.evaluate(() => NotchDrop.getState().clipboardCount), 0);
    // Hidden island must still provide a usable approval dialog.
    await a.locator('.topbar .settings-open').click();
    await a.locator('#setting-notch').uncheck({ force: true });
    await a.locator('#settings-form button[type=submit]').click();
    await note('Shared safely <script>notExecuted()</script> 🏝️');
    await a.locator('#request-dialog').waitFor({ state: 'visible' });
    await a.locator('#request-accept').click();
    await a.waitForFunction(() => NotchDrop.getState().clipboardCount === 1);
    assert((await a.locator('#clipboard-list').innerText()).includes('<script>notExecuted()</script>'));
    assert.equal(await a.locator('#clipboard-list script').count(), 0);

    await b.locator('#open-pranks').click();
    await b.locator('#send-prank').click();
    await b.locator('.target-option input').check();
    await b.locator('.target-actions .primary').click();
    await a.locator('#request-accept').click();
    await a.locator('#prank-overlay').waitFor({ state: 'visible' });
    await a.locator('#dismiss-prank').click();
    await b.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('notchdrop.v2:' + NotchAuth.getUser().id)).sentPranks).length === 1);
    await b.locator('#open-pranks').click();
    await b.locator('#send-prank').click();
    assert(await b.locator('.target-option input').isDisabled());
    await b.keyboard.press('Escape');
    await a.locator('#friends-list [title="Forget device and revoke trust"]').click();
    await b.locator('#friends-list [title="Forget device and revoke trust"]').click();
    await b.locator('#pair-button').click();
    await b.locator('#pair-peer-id').fill(aid);
    await b.locator('#pair-form button[type=submit]').click();
    await a.locator('#request-dialog').waitFor({ state: 'visible' });
    await a.locator('#pair-as-own').check();
    await a.locator('#request-accept').click();
    await Promise.all([a, b].map(page => page.waitForFunction(() => NotchDrop.getState().contacts.some(c => c.online && c.kind === 'own'))));
    await b.locator('#file-input').setInputFiles({ name: 'own-auto.txt', mimeType: 'text/plain', buffer: Buffer.from('Own device auto-accept') });
    await b.locator('.target-option input').check();
    await b.locator('.target-actions .primary').click();
    await a.locator('a[download="own-auto.txt"]').waitFor();
    assert.equal(await a.evaluate(() => NotchDrop.getState().requestCount), 0);
    await a.locator('#write-note').click();
    await a.locator('#note-text').fill('Sending with the notch completely disabled');
    await a.locator('#note-form button[type=submit]').click();
    await a.locator('#target-dialog').waitFor({ state: 'visible' });
    assert.equal(await a.locator('#notch').isVisible(), false);
    await a.locator('#target-dialog .target-option input').check();
    await a.locator('#target-dialog .target-actions .primary').click();
    await b.waitForFunction(() => NotchDrop.getState().clipboardCount === 1);
    await Promise.all([a.reload(), b.reload()]);
    try {
      await Promise.all([a, b].map(page => page.waitForFunction(() => NotchDrop.getState().contacts.some(c => c.online && c.kind === 'own'))));
    } catch (error) {
      console.log('Reconnect diagnostics:', await Promise.all([a, b].map(page => page.evaluate(() => ({ state: NotchDrop.getState(), message: document.querySelector('#network-status').title, toasts: document.querySelector('#toasts').innerText })))));
      throw error;
    }
    assert.equal(await a.evaluate(() => NotchDrop.getState().requestCount), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: live dashboard pairing while QR dialog open, friend approval, file download exact bytes, clipboard decline and plain-text acceptance, hidden-notch fallback, prank approval and daily cooldown, explicit own-device auto-accept, simultaneous trusted reconnect.');
  } finally { await browser.close(); await accounts.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
