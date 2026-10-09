'use strict';
// Node 24+. No runtime packages, passwords or database credentials in the frontend.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const DAY = 86400000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const uuid = () => crypto.randomUUID();
const usernamePattern = /^[a-z0-9_]{3,24}$/;
const idPattern = /^[a-f0-9-]{36}$/;
const staticFiles = new Set(['index.html','styles.css','auth.css','app.js','peer.js','music.js','auth.js','accounts.js','config.js','desktop/dashboard.js','desktop/spotify-ui.js']);
const publicUser = row => ({id:row.id, username:row.username, createdAt:row.created_at});
const publicDevice = row => ({id:row.id, userId:row.user_id, peerId:row.peer_id, name:row.name, type:row.type, lastSeen:row.last_seen, active:Date.now()-row.last_seen < 90000});
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const reject = (status, message) => { throw new HttpError(status, message); };
function normalizeUsername(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!usernamePattern.test(name)) reject(400, 'Use 3–24 letters, numbers or underscores for your username.');
  return name;
}
function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) reject(400, 'Use a password with 10–128 characters.');
  return value;
}
function safeText(value, fallback, max=60) { return String(value || fallback).replace(/[\u0000-\u001f]/g,'').trim().slice(0,max) || fallback; }
async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) reject(415,'Send JSON data.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 16384) reject(413,'Request is too large.'); chunks.push(chunk); }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { reject(400,'Send a valid JSON object.'); }
}

function createServer(options={}) {
  const filename = options.database || process.env.NOTCHDROP_DATABASE || path.join(ROOT,'data','notchdrop.sqlite');
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)),{recursive:true});
  const db = new DatabaseSync(filename);
  db.exec(fs.readFileSync(path.join(ROOT,'database','schema.sql'),'utf8'));
  const allowed = new Set((options.origins || process.env.NOTCHDROP_ORIGINS || 'https://lorlovsky.github.io').split(',').map(x=>x.trim()).filter(Boolean));
  if(process.env.NOTCHDROP_PUBLIC_URL) allowed.add(new URL(process.env.NOTCHDROP_PUBLIC_URL).origin);
  const localHost=['127.0.0.1','localhost','::1'].includes(process.env.NOTCHDROP_HOST || '127.0.0.1');
  const allowFile = options.allowFile ?? (process.env.NOTCHDROP_ALLOW_FILE_ORIGIN === undefined ? localHost : process.env.NOTCHDROP_ALLOW_FILE_ORIGIN === 'true');
  let cryptoInFlight = 0;
  const run = (sql,...args) => db.prepare(sql).run(...args);
  const get = (sql,...args) => db.prepare(sql).get(...args);
  const all = (sql,...args) => db.prepare(sql).all(...args);
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch(error) { db.exec('ROLLBACK'); throw error; } }
  async function derive(password,salt) {
    if (cryptoInFlight >= 2) reject(503,'The account server is busy. Please try again shortly.');
    cryptoInFlight++;
    try { return await scrypt(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024}); }
    finally { cryptoInFlight--; }
  }
  async function matches(password, user) {
    const result = await derive(password, user?.password_salt || 'notchdrop-dummy-verification-salt');
    const expected = user ? Buffer.from(user.password_hash,'hex') : Buffer.alloc(64);
    return crypto.timingSafeEqual(result,expected) && Boolean(user);
  }
  function rateLimit(key, max) {
    const now=Date.now(), row=get('SELECT * FROM auth_limits WHERE key=?',key);
    if (!row || now-row.window_start >= 15*60000) run('INSERT INTO auth_limits(key,attempts,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=1,window_start=excluded.window_start',key,now);
    else { if (row.attempts >= max) reject(429,'Too many attempts. Please wait 15 minutes and try again.'); run('UPDATE auth_limits SET attempts=attempts+1 WHERE key=?',key); }
  }
  function limitAuth(req,name) {
    // Only trust a reverse proxy header when the deployment explicitly enables it.
    const ip = process.env.NOTCHDROP_TRUST_PROXY === 'true' ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
    rateLimit('ip:'+hash(String(ip)),60);
    if(name) rateLimit('user:'+hash(name),10);
  }
  function newSession(user) {
    const token=crypto.randomBytes(32).toString('hex'), expiresAt=Date.now()+7*DAY;
    run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',hash(token),user.id,expiresAt);
    return {token,expiresAt,user:publicUser(user)};
  }
  function authenticate(req) {
    const match=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
    if (!match) reject(401,'Please sign in to your account.');
    const tokenHash=hash(match[1]);
    const user=get('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?',tokenHash,Date.now());
    if(!user) reject(401,'Your session has expired. Please sign in again.');
    return {user,tokenHash};
  }
  function ownDeviceList(userId) { return all('SELECT * FROM devices WHERE user_id=? ORDER BY last_seen DESC',userId).map(publicDevice); }
  function friendList(userId) {
    return all('SELECT f.*,u.id AS friend_id,u.username FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester_id=? THEN f.recipient_id ELSE f.requester_id END WHERE f.requester_id=? OR f.recipient_id=? ORDER BY f.created_at DESC',userId,userId,userId).map(row=>({id:row.id,userId:row.friend_id,username:row.username,status:row.status,incoming:row.recipient_id===userId,devices:row.status==='accepted'?ownDeviceList(row.friend_id):[]}));
  }
  function json(res,status,data) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
  async function handle(req,res) {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    const url = new URL(req.url,'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'Method not allowed.'});
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if (!staticFiles.has(name)) return json(res,404,{error:'Not found.'});
      const body=fs.readFileSync(path.join(ROOT,name));
      res.writeHead(200,{'Content-Type':name.endsWith('.js')?'application/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache'});
      return res.end(req.method==='HEAD'?undefined:body);
    }
    const origin=req.headers.origin;
    const ownOrigin=(req.socket.encrypted?'https:':'http:')+'//'+req.headers.host;
    if(origin) {
      if(origin!==ownOrigin && !allowed.has(origin) && !(origin==='null' && allowFile)) reject(403,'This website is not allowed to use the account server.');
      res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Vary','Origin');
    }
    if(req.method==='OPTIONS') {
      res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, PATCH, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}); return res.end();
    }
    const route=req.method+' '+url.pathname;
    if(route==='GET /api/health') return json(res,200,{ok:true,service:'notchdrop-accounts',version:1});
    if(route==='POST /api/auth/register' || route==='POST /api/auth/login') {
      const body=await readBody(req), name=normalizeUsername(body.username), password=validatePassword(body.password);
      limitAuth(req,name);
      const existing=get('SELECT * FROM users WHERE username=?',name);
      if(route.endsWith('/register')) {
        if(existing) reject(409,'That username is already taken. Choose another one.');
        const salt=crypto.randomBytes(32).toString('hex'), derived=await derive(password,salt);
        let result;
        try { result=transaction(()=>{const id=uuid();run('INSERT INTO users(id,username,password_salt,password_hash,created_at) VALUES(?,?,?,?,?)',id,name,salt,derived.toString('hex'),Date.now());return newSession(get('SELECT * FROM users WHERE id=?',id));}); }
        catch(error) { if(String(error.message).includes('UNIQUE')) reject(409,'That username is already taken. Choose another one.'); throw error; }
        return json(res,201,result);
      }
      if(!await matches(password,existing)) reject(401,'The username or password is incorrect.');
      if(get('SELECT password_hash FROM users WHERE id=?',existing.id)?.password_hash!==existing.password_hash) reject(401,'Your password changed. Please sign in again.');
      run('DELETE FROM auth_limits WHERE key=?','user:'+hash(name));
      return json(res,200,newSession(existing));
    }
    const {user,tokenHash}=authenticate(req);
    if(route==='GET /api/me') return json(res,200,{user:publicUser(user)});
    if(route==='POST /api/auth/logout') { run('DELETE FROM sessions WHERE token_hash=?',tokenHash); return json(res,200,{ok:true}); }
    if(route==='POST /api/auth/password') {
      const body=await readBody(req), next=validatePassword(body.password), current=validatePassword(body.currentPassword);
      limitAuth(req,user.username);
      if(!await matches(current,user)) reject(403,'The current password is incorrect.');
      const salt=crypto.randomBytes(32).toString('hex'), derived=await derive(next,salt);
      const result=transaction(()=>{if(get('SELECT password_hash FROM users WHERE id=?',user.id)?.password_hash!==user.password_hash) reject(409,'Your password changed in another session. Sign in again.');run('UPDATE users SET password_salt=?,password_hash=? WHERE id=?',salt,derived.toString('hex'),user.id);run('DELETE FROM sessions WHERE user_id=?',user.id);return newSession(user);});
      return json(res,200,result);
    }
    if(route==='PATCH /api/me') {
      const body=await readBody(req), name=normalizeUsername(body.username);
      try { run('UPDATE users SET username=? WHERE id=?',name,user.id); }
      catch(error) { if(String(error.message).includes('UNIQUE')) reject(409,'That username is already taken.'); throw error; }
      return json(res,200,{user:publicUser(get('SELECT * FROM users WHERE id=?',user.id))});
    }
    if(route==='GET /api/devices') return json(res,200,{devices:ownDeviceList(user.id)});
    if(route==='POST /api/devices/register') {
      const body=await readBody(req);
      if(!idPattern.test(body.installationId || '')) reject(400,'Invalid device identifier.');
      const old=get('SELECT * FROM devices WHERE user_id=? AND installation_id=?',user.id,body.installationId);
      const name=safeText(body.name,'My device'), type=['laptop','phone','desktop'].includes(body.type)?body.type:'laptop';
      if(old) run('UPDATE devices SET name=?,type=?,last_seen=? WHERE id=?',name,type,Date.now(),old.id);
      else {
        if(get('SELECT count(*) AS n FROM devices WHERE user_id=?',user.id).n>=30) reject(400,'This account has 30 devices. Remove an old device first.');
        run('INSERT INTO devices(id,user_id,installation_id,peer_id,name,type,last_seen) VALUES(?,?,?,?,?,?,?)',uuid(),user.id,body.installationId,'nd-'+uuid(),name,type,Date.now());
      }
      return json(res,200,{device:publicDevice(get('SELECT * FROM devices WHERE user_id=? AND installation_id=?',user.id,body.installationId))});
    }
    const deviceMatch=/^\/api\/devices\/([a-f0-9-]{36})$/.exec(url.pathname);
    if(deviceMatch && ['PATCH','DELETE'].includes(req.method)) {
      const device=get('SELECT * FROM devices WHERE id=? AND user_id=?',deviceMatch[1],user.id);
      if(!device) reject(404,'Device not found.');
      if(req.method==='DELETE') run('DELETE FROM devices WHERE id=? AND user_id=?',device.id,user.id);
      else { const body=await readBody(req); run('UPDATE devices SET name=?,last_seen=? WHERE id=? AND user_id=?',safeText(body.name,device.name),body.online===false?0:Date.now(),device.id,user.id); }
      return json(res,200,{ok:true});
    }
    if(route==='GET /api/friends') return json(res,200,{friends:friendList(user.id)});
    if(route==='POST /api/friends') {
      const body=await readBody(req), name=normalizeUsername(body.username);
      rateLimit('friend:'+user.id,30);
      const other=get('SELECT id FROM users WHERE username=?',name);
      if(!other) reject(404,'No account has that username.');
      if(other.id===user.id) reject(400,'That is your own username. Your other devices appear under your account.');
      if(get('SELECT count(*) AS n FROM friendships WHERE requester_id=? OR recipient_id=?',user.id,user.id).n>=200) reject(400,'Your friend list is full. Remove an old request first.');
      const existing=get('SELECT id FROM friendships WHERE (requester_id=? AND recipient_id=?) OR (requester_id=? AND recipient_id=?)',user.id,other.id,other.id,user.id);
      if(existing) reject(409,'A friendship or request already exists. Check your friend list.');
      run('INSERT INTO friendships(id,requester_id,recipient_id,created_at) VALUES(?,?,?,?)',uuid(),user.id,other.id,Date.now());
      return json(res,201,{friends:friendList(user.id)});
    }
    const friendMatch=/^\/api\/friends\/([a-f0-9-]{36})$/.exec(url.pathname);
    if(friendMatch && ['PATCH','DELETE'].includes(req.method)) {
      const row=get('SELECT * FROM friendships WHERE id=? AND (requester_id=? OR recipient_id=?)',friendMatch[1],user.id,user.id);
      if(!row) reject(404,'Friend request not found.');
      if(req.method==='DELETE') run('DELETE FROM friendships WHERE id=?',row.id);
      else {
        const body=await readBody(req);
        if(body.action!=='accept' || row.recipient_id!==user.id || row.status!=='pending') reject(403,'Only the recipient can accept a pending request.');
        run('UPDATE friendships SET status=\'accepted\' WHERE id=?',row.id);
      }
      return json(res,200,{friends:friendList(user.id)});
    }
    return json(res,404,{error:'Not found.'});
  }
  const server=http.createServer((req,res)=>handle(req,res).catch(error=>{
    if(res.headersSent) return res.end();
    const status=error.status || 500;
    if(status===500) console.error('Account request failed:',error.code || error.name);
    if(status===429) res.setHeader('Retry-After','900');
    json(res,status,{error:status===500?'The account server could not complete this request.':error.message});
  }));
  server.requestTimeout=20000; server.headersTimeout=15000;
  const cleanup=setInterval(()=>{try {run('DELETE FROM sessions WHERE expires_at<?',Date.now());run('DELETE FROM auth_limits WHERE window_start<?',Date.now()-DAY);} catch {}},60000);
  cleanup.unref();
  server.on('close',()=>{clearInterval(cleanup);db.close();});
  return server;
}
module.exports={createServer};
if(require.main===module) {
  const port=Number(process.env.PORT || 8083),host=process.env.NOTCHDROP_HOST || '127.0.0.1';
  const server=createServer();
  server.listen(port,host,()=>console.log(`NotchDrop accounts + dashboard: http://${host}:${server.address().port}\nDatabase: ${process.env.NOTCHDROP_DATABASE || path.join(ROOT,'data','notchdrop.sqlite')}\nKeep this server running while using accounts.`));
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Port is already in use. Set PORT to another port.':error.message);process.exitCode=1;server.close();});
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close();server.closeIdleConnections();});
}
