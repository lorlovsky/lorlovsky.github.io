/* Optional live WebRTC smoke check. Uses public PeerJS signaling, two isolated browsers. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { accountFixture } = require('./account-fixture.cjs');
(async () => {
  const accounts = await accountFixture();
  const url = process.env.NOTCHDROP_URL || accounts.url;
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  try {
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    await Promise.all(pages.map(page => page.goto(url)));
    for (const page of pages) {
      await page.waitForFunction(() => typeof Peer === 'function' && typeof NotchPeer === 'function', { timeout: 25000 });
      await page.evaluate(() => {
        window.receipts = [];
        window.liveErrors = [];
        window.liveTrust = {};
        window.live = new NotchPeer({ identity: { id: 'nd-test-' + crypto.randomUUID(), handle: 'Live test', deviceName: 'Isolated browser', deviceType: 'desktop' }, getTrust: id => liveTrust[id] });
        live.addEventListener('error', e => liveErrors.push(e.detail.message));
        live.addEventListener('pairing-request', e => e.detail.accept('own'));
        live.addEventListener('connected', e => { liveTrust[e.detail.peerId] = e.detail; });
        live.addEventListener('incoming-transfer', e => e.detail.accept());
        live.addEventListener('received', async e => {
          const item = { ...e.detail };
          if (item.blob) item.bytes = Array.from(new Uint8Array(await item.blob.arrayBuffer()));
          receipts.push(item);
        });
        live.start();
      });
      await page.waitForFunction(() => live.online, { timeout: 30000 });
    }
    const receiver = await pages[1].evaluate(() => live.identity.id);
    await pages[0].evaluate(id => live.connect(id, 'own'), receiver);
    await Promise.all(pages.map(page => page.waitForFunction(() => Array.from(live.connections.values()).some(c => c.ready), { timeout: 30000 })));
    await pages[0].evaluate(async id => {
      const bytes = Uint8Array.from({ length: 196623 }, (_, i) => i % 251);
      await live.sendFiles(id, [new File([bytes], 'binary-fixture.bin')]);
      await live.sendClipboard(id, 'Hello across WebRTC — 🏝️');
      await live.sendPrank(id, 'confetti');
    }, receiver);
    await pages[1].waitForFunction(() => receipts.length === 3);
    const result = await pages[1].evaluate(() => ({ count: receipts.length, valid: receipts[0].bytes.length === 196623 && receipts[0].bytes.every((n, i) => n === i % 251), text: receipts[1].text, prank: receipts[2].prankId, errors: liveErrors }));
    assert.equal(result.valid, true);
    assert.equal(result.text, 'Hello across WebRTC — 🏝️');
    assert.equal(result.prank, 'confetti');
    assert.deepEqual(result.errors, []);
    console.log('PASS: real PeerJS signaling, isolated browser contexts, real WebRTC data channel, 196623-byte file exact integrity, Unicode clipboard and acknowledged prank.');
    await Promise.all(pages.map(page => page.evaluate(() => live.destroy())));
  } finally { await browser.close(); await accounts.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
