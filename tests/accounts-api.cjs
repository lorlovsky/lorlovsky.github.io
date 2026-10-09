const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createServer}=require('../server.cjs');
const {randomUUID}=require('node:crypto');

test('real SQLite accounts enforce session and ownership boundaries',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'notchdrop-accounts-test-'));
  const database=path.join(directory,'test.sqlite');
  let server=createServer({database,origins:'https://lorlovsky.github.io'});
  const listen=()=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const close=()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  await listen();
  let base='http://127.0.0.1:'+server.address().port;
  const call=async(route,method='GET',body,token,origin)=>{
    const r=await fetch(base+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:r.status,body:await r.json(),headers:r.headers};
  };
  let alice,bob,device,friend;
  const password='A long test password 123!';
  try {
    await t.test('registration normalizes unique usernames and never returns password material',async()=>{
      const result=await call('/api/auth/register','POST',{username:'Alice',password});
      assert.equal(result.status,201);alice=result.body;
      assert.equal(alice.user.username,'alice');assert.match(alice.token,/^[a-f0-9]{64}$/);
      assert.deepEqual(Object.keys(alice.user).sort(),['createdAt','id','username']);
      assert.equal((await call('/api/auth/register','POST',{username:'ALICE',password})).status,409);
      assert.equal((await call('/api/auth/register','POST',{username:'bad name',password})).status,400);
      assert.equal((await call('/api/auth/register','POST',{username:'shortpass',password:'weak'})).status,400);
      bob=(await call('/api/auth/register','POST',{username:'bob',password})).body;
      const db=new DatabaseSync(database);const row=db.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').get(alice.user.id);
      assert.notEqual(row.password_hash,password);assert.equal(row.password_hash.length,128);
      assert.equal(db.prepare('SELECT token_hash FROM sessions WHERE user_id=?').get(alice.user.id).token_hash.includes(alice.token),false);db.close();
    });
    await t.test('wrong credentials and missing sessions cannot access account data',async()=>{
      assert.equal((await call('/api/auth/login','POST',{username:'alice',password:'Wrong password 123'})).status,401);
      assert.equal((await call('/api/me')).status,401);
      assert.equal((await call('/api/devices')).status,401);
      assert.equal((await call('/api/friends')).status,401);
      assert.equal((await call('/api/me','GET',undefined,alice.token)).body.user.id,alice.user.id);
    });
    await t.test('device records are stable, private, and cannot be changed by another account',async()=>{
      const installationId=randomUUID();
      device=(await call('/api/devices/register','POST',{installationId,name:'Alice laptop',type:'laptop'},alice.token)).body.device;
      const again=(await call('/api/devices/register','POST',{installationId,name:'Renamed laptop',type:'laptop'},alice.token)).body.device;
      assert.equal(again.peerId,device.peerId);assert.equal(again.id,device.id);
      assert.equal((await call('/api/devices','GET',undefined,bob.token)).body.devices.length,0);
      assert.equal((await call('/api/devices/'+device.id,'PATCH',{name:'Hacked'},bob.token)).status,404);
      assert.equal((await call('/api/devices/'+device.id,'DELETE',undefined,bob.token)).status,404);
      assert.equal((await call('/api/devices','GET',undefined,alice.token)).body.devices[0].name,'Renamed laptop');
    });
    await t.test('only recipients can accept friendship; device discovery requires acceptance',async()=>{
      const sent=await call('/api/friends','POST',{username:'bob'},alice.token);assert.equal(sent.status,201);friend=sent.body.friends[0];
      const incoming=(await call('/api/friends','GET',undefined,bob.token)).body.friends[0];
      assert.equal(incoming.incoming,true);assert.deepEqual(incoming.devices,[]);
      assert.equal((await call('/api/friends/'+friend.id,'PATCH',{action:'accept'},alice.token)).status,403);
      assert.equal((await call('/api/friends/'+friend.id,'PATCH',{action:'accept'},bob.token)).status,200);
      assert.equal((await call('/api/friends','GET',undefined,bob.token)).body.friends[0].devices[0].peerId,device.peerId);
      assert.equal((await call('/api/friends','POST',{username:'alice'},bob.token)).status,409);
    });
    await t.test('sessions and account data survive a server restart',async()=>{
      await close();server=createServer({database});await listen();base='http://127.0.0.1:'+server.address().port;
      assert.equal((await call('/api/me','GET',undefined,alice.token)).status,200);
      assert.equal((await call('/api/friends','GET',undefined,bob.token)).body.friends[0].status,'accepted');
    });
    await t.test('renaming and password change respect identity and revoke old sessions',async()=>{
      assert.equal((await call('/api/me','PATCH',{username:'bob'},alice.token)).status,409);
      assert.equal((await call('/api/me','PATCH',{username:'alice_new'},alice.token)).body.user.id,alice.user.id);
      assert.equal((await call('/api/auth/password','POST',{currentPassword:'Incorrect old password',password:'Replacement password 456'},alice.token)).status,403);
      const changed=await call('/api/auth/password','POST',{currentPassword:password,password:'Replacement password 456'},alice.token);
      assert.equal(changed.status,200);
      assert.equal((await call('/api/me','GET',undefined,alice.token)).status,401);
      alice=changed.body;
      assert.equal((await call('/api/me','GET',undefined,alice.token)).status,200);
      assert.equal((await call('/api/auth/login','POST',{username:'alice_new',password})).status,401);
      assert.equal((await call('/api/auth/login','POST',{username:'alice_new',password:'Replacement password 456'})).status,200);
    });
    await t.test('unfriending removes discovery and logout invalidates the session',async()=>{
      assert.equal((await call('/api/friends/'+friend.id,'DELETE',undefined,bob.token)).status,200);
      assert.deepEqual((await call('/api/friends','GET',undefined,bob.token)).body.friends,[]);
      assert.equal((await call('/api/auth/logout','POST',{},bob.token)).status,200);
      assert.equal((await call('/api/me','GET',undefined,bob.token)).status,401);
    });
    await t.test('database, server source, and disallowed origins are inaccessible over HTTP',async()=>{
      for(const route of ['/data/notchdrop.sqlite','/server.cjs','/database/schema.sql','/tests/accounts-api.cjs'])assert.equal((await call(route)).status,404);
      assert.equal((await call('/api/me','GET',undefined,alice.token,'https://untrusted.example')).status,403);
      const allowed=await call('/api/me','GET',undefined,alice.token,'https://lorlovsky.github.io');assert.equal(allowed.status,200);assert.equal(allowed.headers.get('access-control-allow-origin'),'https://lorlovsky.github.io');
    });
    await t.test('repeated password guessing is rate limited',async()=>{
      let last;
      for(let n=0;n<11;n++) last=await call('/api/auth/login','POST',{username:'missing_user',password:'Wrong password 123'});
      assert.equal(last.status,429);assert.equal(last.headers.get('retry-after'),'900');
    });
  }finally{await close();fs.rmSync(directory,{recursive:true,force:true});}
});
