// Full browser UI with a real, isolated SQLite backend; no auth mocks.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createServer}=require('../server.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'notchdrop-browser-test-'));
  const server=createServer({database:path.join(directory,'accounts.sqlite')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
  const errors=[],password='Browser test password 123!';
  const output=path.join(__dirname,'..','test-results');await fs.mkdir(output,{recursive:true});
  try{
    const ca=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    const cb=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
    const cc=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const a=await ca.newPage(),b=await cb.newPage(),c=await cc.newPage();
    for(const page of [a,b,c])page.on('pageerror',e=>errors.push(e.message));
    async function signIn(page,name,register=false){
      await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#auth-submit').disabled);
      if(register)await page.locator('#auth-register-tab').click();
      await page.locator('#auth-username').fill(name);await page.locator('#auth-password').fill(password);
      if(register)await page.locator('#auth-confirm').fill(password);
      await page.locator('#auth-submit').click();
      try{await page.waitForFunction(()=>window.NotchDrop&&!document.body.classList.contains('auth-locked'));}
      catch(e){console.log('Startup message:',await page.locator('#auth-message').innerText());throw e;}
    }
    await a.goto(base);await a.waitForFunction(()=>!document.querySelector('#auth-submit').disabled);
    assert.equal(await a.evaluate(()=>typeof window.NotchDrop),'undefined');
    await a.screenshot({path:path.join(output,'accounts-signin-desktop.png')});
    await c.goto(base);await c.waitForFunction(()=>!document.querySelector('#auth-submit').disabled);
    await c.locator('#auth-register-tab').click();await c.screenshot({path:path.join(output,'accounts-signup-mobile.png')});
    assert(await c.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await signIn(a,'alice_browser',true);await signIn(b,'bob_browser',true);
    assert.equal(await a.locator('#profile-name').innerText(),'alice_browser');
    await a.evaluate(()=>{const key='notchdrop.v2:'+NotchAuth.getUser().id;const data=JSON.parse(localStorage.getItem(key));data.history=[{text:'Private to Alice',sender:'Alice',time:Date.now()}];localStorage.setItem(key,JSON.stringify(data));});
    await a.reload();await a.waitForFunction(()=>window.NotchDrop?.getState().clipboardCount===1);
    await Promise.all([a,b].map(p=>p.waitForFunction(()=>NotchDrop.getState().networkState==='online')));
    await a.locator('#add-friend').click();await a.locator('#account-friend-username').fill('bob_browser');await a.locator('#account-friend-form button').click();
    await a.waitForFunction(()=>!document.querySelector('#friend-dialog').open);
    await b.evaluate(()=>NotchAccounts.refresh());
    await b.locator('#friends-list .account-cloud-row').getByRole('button',{name:'Accept',exact:true}).click();
    await b.waitForFunction(()=>NotchAccounts.getSnapshot().friends[0]?.status==='accepted');
    await a.evaluate(()=>NotchAccounts.refresh());
    await a.locator('#friends-list .account-cloud-row').getByRole('button',{name:'Connect · Windows Laptop',exact:true}).click();
    await b.locator('#notch-content').getByRole('button',{name:'Accept',exact:true}).click();
    await Promise.all([a,b].map(p=>p.waitForFunction(()=>NotchDrop.getState().contacts.some(d=>d.online))));
    const bytes=Buffer.alloc(140123);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
    await a.locator('#file-input').setInputFiles({name:'account-transfer.bin',mimeType:'application/octet-stream',buffer:bytes});
    await a.locator('.target-option input').check();await a.locator('.target-actions .primary').click();
    await b.locator('#notch-content').getByRole('button',{name:'Accept',exact:true}).click();
    await b.locator('a[download="account-transfer.bin"]').waitFor();
    const downloadWait=b.waitForEvent('download');await b.locator('a[download="account-transfer.bin"]').click();
    assert.deepEqual(await fs.readFile(await (await downloadWait).path()),bytes);
    await signIn(c,'alice_browser');
    await a.evaluate(()=>NotchAccounts.refresh());
    await a.locator('#devices-list').getByRole('button',{name:'Pair device',exact:true}).waitFor();
    assert.equal(await a.evaluate(()=>NotchAccounts.getSnapshot().devices.length),2);
    await a.screenshot({path:path.join(output,'accounts-dashboard.png'),fullPage:true});
    const oldToken=await a.evaluate(()=>localStorage.getItem('notchdrop.session.v1:'+location.origin));
    await a.locator('.topbar .settings-open').click();await a.locator('#account-settings').getByRole('button',{name:'Sign out',exact:true}).click();
    await a.waitForFunction(()=>document.body.classList.contains('auth-locked')&&!document.querySelector('#auth-submit').disabled);
    assert.equal((await fetch(base+'/api/me',{headers:{Authorization:'Bearer '+oldToken}})).status,401);
    await signIn(a,'bob_browser');assert.equal(await a.evaluate(()=>NotchDrop.getState().clipboardCount),0);
    assert.equal(await a.locator('#profile-name').innerText(),'bob_browser');
    assert.deepEqual(errors,[]);
    console.log('PASS: real registration/login/persistent sessions, mobile forms, username friend request and recipient approval, real PeerJS transfer (140123 exact bytes), same-account device discovery, logout revocation, and per-account clipboard isolation.');
  }finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await fs.rm(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
