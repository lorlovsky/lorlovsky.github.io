/* Database-backed devices and username friendships. Peer trust stays on each device. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let snapshot={devices:[],friends:[]}, currentDevice, options, timer, syncing=false, online=false, stopped=false;
  const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls||'';if(text!==undefined)el.textContent=text;return el;};
  function action(label,fn,cls='button secondary') {
    const b=node('button',cls,label); b.type='button';
    b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){options?.toast(e.message);}finally{b.disabled=false;}});
    return b;
  }
  const api=(route,config)=>NotchAuth.request(route,config);
  function status(message,error=false) {const el=$('account-sync-status');if(el){el.textContent=message;el.classList.toggle('is-error',error);}}
  async function refresh() {
    if(syncing||stopped)return;
    syncing=true;
    try {
      const [devices,friends]=await Promise.all([api('/api/devices'),api('/api/friends')]);
      if(stopped)return;
      const removed=snapshot.friends.filter(old=>old.status==='accepted'&&!friends.friends.some(f=>f.id===old.id&&f.status==='accepted'));
      snapshot={devices:devices.devices,friends:friends.friends};
      for(const friend of removed)options?.onRemoved(friend.devices.map(d=>d.peerId));
      options?.onChange();status('Account synced · device availability updates every 20 seconds');
    }catch(e){status(e.message,true);}finally{syncing=false;}
  }
  async function heartbeat() {
    if(!currentDevice||stopped)return;
    try{await api('/api/devices/'+currentDevice.id,{method:'PATCH',body:{online}});}catch(e){status(e.message,true);}
  }
  async function register({installationId,name,type}) {
    const result=await api('/api/devices/register',{method:'POST',body:{installationId,name,type}});
    currentDevice=result.device;return result.device;
  }
  function start(callbacks) {
    options=callbacks;stopped=false;
    const dialog=$('friend-dialog');
    const form=node('form','account-username-form');form.id='account-friend-form';
    const label=node('label','','Friend’s username');label.htmlFor='account-friend-username';
    const input=node('input');input.id='account-friend-username';input.required=true;input.maxLength=24;input.pattern='[A-Za-z0-9_]{3,24}';input.placeholder='their_username';input.autocomplete='off';
    const submit=node('button','button primary full','Send friend request');submit.type='submit';
    form.append(label,input,submit);
    form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{await api('/api/friends',{method:'POST',body:{username:input.value}});input.value='';dialog.close();options.toast('Friend request sent. They can accept it in their Friends list.');await refresh();}catch(e){options.toast(e.message);}finally{submit.disabled=false;}});
    dialog.querySelector('p').textContent='Add a friend by their account username. They choose whether to accept your request.';
    const manual=$('friend-form'),details=node('details','network-settings');
    details.append(node('summary','','Or pair directly with a device code'));manual.before(form,details);details.append(manual);
    const sync=node('p','account-sync');sync.id='account-sync-status';
    $('friends-list').after(sync);
    const account=node('section','account-actions');account.id='account-settings';
    account.append(node('h3','','Your account'),node('p','small-text','Signed in as @'+NotchAuth.getUser().username));
    account.append(action('Sign out',()=>NotchAuth.logout()));
    const password=node('details','network-settings');password.append(node('summary','','Change password'));
    const passwordForm=node('form','account-password-form');passwordForm.id='account-password-form';
    for(const [id,labelText,autocomplete] of [['account-current-password','Current password','current-password'],['account-new-password','New password (at least 10 characters)','new-password']]){
      const label=node('label','',labelText);label.htmlFor=id;const field=node('input');field.id=id;field.type='password';field.required=true;field.minLength=10;field.maxLength=128;field.autocomplete=autocomplete;passwordForm.append(label,field);
    }
    const change=node('button','button secondary','Update password');change.type='submit';passwordForm.append(change);
    passwordForm.addEventListener('submit',async e=>{e.preventDefault();change.disabled=true;try{await NotchAuth.changePassword($('account-current-password').value,$('account-new-password').value);passwordForm.reset();password.open=false;options.toast('Password updated. Other sessions have been signed out.');}catch(error){options.toast(error.message);}finally{change.disabled=false;}});
    password.append(passwordForm);account.append(password);$('settings-form').after(account);
    // A heartbeat records presence only; it never grants pairing or transfer permission.
    timer=setInterval(()=>{heartbeat();refresh();},20000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){heartbeat();refresh();}});
    refresh();
  }
  function deviceRows(contacts,connect) {
    return snapshot.devices.filter(d=>d.id!==currentDevice?.id&&!contacts.some(c=>c.peerId===d.peerId)).map(d=>{
      const row=node('div','account-cloud-row'),top=node('div','account-cloud-top'),copy=node('div');
      copy.append(node('strong','',d.name),node('small','',d.active?'On your account · seen recently':'On your account · offline'));
      top.append(copy);row.append(top);
      if(d.active){const b=action('Pair device',()=>connect(d.peerId,'own'));row.append(b);}
      return row;
    });
  }
  function friendRows(contacts,connect) {
    return snapshot.friends.map(friend=>{
      const row=node('div','account-cloud-row'),top=node('div','account-cloud-top'),copy=node('div');
      copy.append(node('strong','','@'+friend.username),node('small','',friend.status==='pending'?(friend.incoming?'Wants to be your friend':'Request sent'):'Account friend'));
      top.append(copy);row.append(top);const actions=node('div','account-cloud-actions');
      if(friend.status==='pending'&&friend.incoming)actions.append(action('Accept',async()=>{await api('/api/friends/'+friend.id,{method:'PATCH',body:{action:'accept'}});await refresh();},'button primary'));
      actions.append(action(friend.status==='pending'?(friend.incoming?'Decline':'Cancel request'):'Remove friend',async()=>{await api('/api/friends/'+friend.id,{method:'DELETE'});await refresh();}));
      if(friend.status==='accepted')for(const device of friend.devices){
        const linked=contacts.find(c=>c.peerId===device.peerId);
        if(device.active&&!linked?.online)actions.append(action('Connect · '+device.name,()=>connect(device.peerId,'friend')));
        else if(linked?.online)actions.append(node('small','online-text',device.name+' · connected'));
      }
      if(friend.status==='accepted'&&!friend.devices.some(d=>d.active))copy.append(node('small','','No device seen recently'));
      row.append(actions);return row;
    });
  }
  function stop() {stopped=true;clearInterval(timer);if(currentDevice)api('/api/devices/'+currentDevice.id,{method:'PATCH',body:{online:false}}).catch(()=>{});}
  window.addEventListener('notchdrop:signout',stop);
  window.NotchAccounts=Object.freeze({register,start,refresh,deviceRows,friendRows,stop,getSnapshot:()=>snapshot,setOnline:value=>{if(online!==value){online=value;heartbeat();}},renameDevice:async name=>{if(currentDevice)await api('/api/devices/'+currentDevice.id,{method:'PATCH',body:{name,online}});},updateAccountLabel:()=>{const p=$('account-settings')?.querySelector('p');if(p)p.textContent='Signed in as @'+NotchAuth.getUser().username;}});
})();
