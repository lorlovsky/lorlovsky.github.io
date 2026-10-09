// Exercises QR approval on a mobile viewport against real PeerJS signaling.
// NOTCHDROP_OVERRIDE points at local assets to test before publishing.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { accountFixture } = require('./account-fixture.cjs');
(async () => {
  const accounts = await accountFixture();
  const base = process.env.NOTCHDROP_URL || accounts.url;
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {})});
  try {
    const host = await browser.newContext();
    const phone = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'});
    const errors = [];
    await accounts.prepare(host, 'qr_host'); await accounts.prepare(phone, 'qr_phone');
    if (process.env.NOTCHDROP_OVERRIDE) for (const context of [host,phone]) await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (url.origin === new URL(base).origin && ['index.html','app.js','peer.js','styles.css'].includes(name)) {
        await route.fulfill({body:await fs.readFile(path.join(process.env.NOTCHDROP_OVERRIDE,name)),contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html'});
      } else await route.continue();
    });
    const a = await host.newPage(), b = await phone.newPage();
    for (const page of [a,b]) page.on('pageerror', error=>errors.push(error.message));
    await a.goto(base);
    await a.waitForFunction(()=>NotchDrop.getState().networkState==='online');
    const link = await a.evaluate(()=>NotchPeer.generatePairURL(location.href,NotchDrop.getIdentity().id));
    await a.locator('#pair-button').click();
    await b.goto(link);
    await b.locator('#request-dialog').waitFor({state:'visible'});
    assert.equal(await b.locator('#request-accept').innerText(),'Connect');
    assert.match(await b.locator('#request-content').innerText(),/then tap Accept on the other device/);
    assert.equal(await a.evaluate(()=>NotchDrop.getState().requestCount),0);
    await b.locator('#pair-as-own').check();
    await b.locator('#request-accept').click();
    await a.locator('#request-dialog').waitFor({state:'visible'});
    assert.match(await b.locator('#pairing-status-message').innerText(),/Request reached the other device/);
    await a.locator('#pair-as-own').check();
    await a.locator('#request-accept').click();
    for (const page of [a,b]) await page.waitForFunction(()=>NotchDrop.getState().contacts.some(c=>c.online && c.kind==='own'));
    assert.match(await b.locator('#pairing-status-title').innerText(),/Device paired/);
    assert(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await fs.mkdir(path.join(__dirname,'..','test-results'),{recursive:true});
    await b.screenshot({path:path.join(__dirname,'..','test-results','pairing-mobile.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS: mobile QR confirmation visible without hovering, explicit Connect, host approval over QR modal, connection progress, independent own-device consent, no mobile overflow or page errors.');
  } finally { await browser.close(); await accounts.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
