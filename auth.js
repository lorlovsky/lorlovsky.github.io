/* Real account authentication against server.cjs. No local password database. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const configured = String(window.NOTCHDROP_CONFIG?.apiBaseUrl || '').trim().replace(/\/+$/,'');
  const base = configured || (location.protocol === 'file:' ? 'http://127.0.0.1:8083' : location.origin);
  const storageKey = 'notchdrop.session.v1:' + base;
  let token = '', user = null, mode = 'login', busy = false, reachable = false;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  try { token = localStorage.getItem(storageKey) || ''; } catch {}
  function message(text,error=false) { $('auth-message').textContent=text; $('auth-message').classList.toggle('is-error',error); }
  function setBusy(value) { busy=value; $('auth-submit').disabled=value || !reachable; $('auth-submit').textContent=value?'One moment…':mode==='register'?'Create my account':'Sign in'; }
  function saveSession(data) {
    token=data.token; user=data.user;
    try { localStorage.setItem(storageKey,token); } catch { /* This tab can still use the in-memory session. */ }
  }
  function clearSession() { token=''; user=null; try { localStorage.removeItem(storageKey); } catch {} }
  function stopSharing() { window.dispatchEvent(new Event('notchdrop:signout')); }
  async function request(route,{method='GET',body,authenticated=true}={}) {
    let response;
    try {
      const url=new URL(base);
      if (!['http:','https:'].includes(url.protocol)) throw new Error();
      if (location.protocol==='https:' && url.protocol!=='https:') throw new Error();
      response=await fetch(base+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(authenticated&&token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000),cache:'no-store',credentials:'omit'});
    } catch { throw new Error('We can’t reach the account server. Check your connection and try again.'); }
    let data;
    try { data=await response.json(); } catch { throw new Error('The account server is not available at this address yet.'); }
    if(!response.ok) {
      if(response.status===401 && authenticated && token) { clearSession(); stopSharing(); location.reload(); }
      const error=new Error(data.error || 'The account request failed.'); error.status=response.status; throw error;
    }
    return data;
  }
  function selectMode(next) {
    if(busy) return;
    mode=next;
    $('auth-login-tab').setAttribute('aria-pressed',String(next==='login'));
    $('auth-register-tab').setAttribute('aria-pressed',String(next==='register'));
    $('auth-title').textContent=next==='register'?'Make yourself at home.':'Welcome back.';
    $('auth-description').textContent=next==='register'?'Choose a username. Bring your devices together.':'Sign in to your devices, friends, and little island.';
    $('auth-password').autocomplete=next==='register'?'new-password':'current-password';
    $('auth-confirm-row').hidden=next!=='register'; $('auth-confirm').required=next==='register';
    $('auth-password').value=''; $('auth-confirm').value='';
    setBusy(false); message('');
  }
  $('auth-login-tab').addEventListener('click',()=>selectMode('login'));
  $('auth-register-tab').addEventListener('click',()=>selectMode('register'));
  $('auth-reveal').addEventListener('click',()=>{
    const show=$('auth-password').type==='password'; $('auth-password').type=show?'text':'password';
    $('auth-reveal').textContent=show?'Hide':'Show'; $('auth-reveal').setAttribute('aria-label',show?'Hide password':'Show password');
  });
  $('auth-retry').addEventListener('click',()=>location.reload());
  $('auth-form').addEventListener('submit',async event=>{
    event.preventDefault(); if(busy || !reachable) return;
    const username=$('auth-username').value.trim().toLowerCase(), password=$('auth-password').value;
    if(!/^[a-z0-9_]{3,24}$/.test(username)) return message('Use 3–24 letters, numbers or underscores.',true);
    if(mode==='register' && password!==$('auth-confirm').value) return message('Your passwords don’t match.',true);
    setBusy(true); message('');
    try {
      const data=await request('/api/auth/'+mode,{method:'POST',body:{username,password},authenticated:false});
      saveSession(data); $('auth-password').value=''; $('auth-confirm').value='';
      message('Signed in. Getting your devices ready…'); resolveReady({...user});
    } catch(error) { message(error.message,true); setBusy(false); }
  });
  async function logout() {
    stopSharing();
    try { await request('/api/auth/logout',{method:'POST',body:{}}); } catch { /* Clear local access even if the server went offline. */ }
    clearSession(); location.reload();
  }
  async function updateUsername(username) { const data=await request('/api/me',{method:'PATCH',body:{username}}); user=data.user; return {...user}; }
  async function changePassword(currentPassword,password) { const data=await request('/api/auth/password',{method:'POST',body:{currentPassword,password}}); saveSession(data); }
  function completeStartup() { $('auth-screen').hidden=true; document.body.classList.remove('auth-locked'); }
  function startupError(error) { message(error.message || 'Could not load your account. Please try again.',true); $('auth-retry').hidden=false; setBusy(false); }
  window.NotchAuth=Object.freeze({ready,request,logout,updateUsername,changePassword,completeStartup,startupError,getUser:()=>user?{...user}:null});
  window.addEventListener('storage',event=>{if(event.key===storageKey && event.newValue!==token) {stopSharing();location.reload();}});
  (async()=>{
    message('Connecting to your account…'); setBusy(true);
    try {
      const health=await request('/api/health',{authenticated:false});
      if(health.service!=='notchdrop-accounts') throw new Error('The account server is not connected yet.');
      reachable=true;
      if(token) {
        const data=await request('/api/me'); user=data.user;
        message('Welcome back. Getting your devices ready…'); resolveReady({...user});
      } else {setBusy(false);message('');}
    } catch(error) {startupError(error);}
  })();
})();
