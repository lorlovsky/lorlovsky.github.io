/* NotchDrop dashboard. No user-supplied content is inserted as HTML. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const all = selector => [...document.querySelectorAll(selector)];
  const DAY = 86400000;
  const storageKey = 'notchdrop.v1';
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const deviceType = mobile ? 'phone' : 'laptop';
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let storageFailed = false;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { storageFailed = true; }
  const defaults = {handle: 'Maks', deviceName: mobile ? 'My phone' : /Mac/i.test(navigator.platform) ? 'MacBook' : 'Windows Laptop', notch: true, music: true, autoPranks: false, autoOwn: true, turnUrl: '', turnUser: '', turnPassword: '', forceRelay: false};
  let settings = {...defaults, ...(saved.settings || {})};
  const peerId = typeof saved.peerId === 'string' ? saved.peerId : `user-maks-${uid()}`;
  let contacts = Array.isArray(saved.contacts) ? saved.contacts.filter(c => c && typeof c.peerId === 'string' && typeof c.secret === 'string').map(c => ({...c, online: false})) : [];
  let history = Array.isArray(saved.history) ? saved.history.filter(h => h && typeof h.text === 'string').slice(0, 20) : [];
  let sentPranks = saved.sentPranks && typeof saved.sentPranks === 'object' ? saved.sentPranks : {};
  let receivedPranks = saved.receivedPranks && typeof saved.receivedPranks === 'object' ? saved.receivedPranks : {};
  let network, networkState = 'offline', pending = null, targetHint = null, noteTarget = null;
  let selectedPrank = 'confetti', requests = [], activeRequest = null, dragDepth = 0, dragTimer, prankTimer;
  let manuallyExpanded = false, pairURL = '', invitation = null;
  let lastPairAttempt = null;
  const pairingLog = [];
  const prankReservations = new Set();
  const activities = new Map();
  const blobURLs = [];
  const icons = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    devices: '<rect x="3" y="4" width="14" height="11" rx="2"/><path d="M6 20h8m-4-5v5"/><rect x="16" y="10" width="5" height="11" rx="1"/>',
    laptop: '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="m4 16-2 4h20l-2-4M9 20h6"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
    clipboard: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="8" y="2" width="8" height="6" rx="2"/><path d="M9 12h6m-6 4h4"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
    settings: '<path d="m9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h6l1-3 3-2v-3l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    file: '<path d="M14 2H5v20h14V7Z"/><path d="M14 2v5h5M8 12h8m-8 4h6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 4v3"/>',
    shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/>',
    camera: '<path d="M3 6h4l2-3h6l2 3h4v15H3Z"/><circle cx="12" cy="13" r="4"/>',
    send: '<path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    prank: '<circle cx="12" cy="12" r="9"/><path d="M8 9h.01M16 9h.01M7 14q5 6 10 0"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14-2l1 7M4 12l1 7a8 8 0 0 0 14-2"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'
  };
  function icon(name) { const el = document.createElement('span'); el.className = 'ui-icon'; el.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.devices}</svg>`; return el; }
  all('[data-icon]').forEach(el => el.replaceChildren(icon(el.dataset.icon)));
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function button(text, className, action, iconName) { const node = el('button', className, text); node.type = 'button'; if (iconName) node.prepend(icon(iconName)); node.addEventListener('click', action); return node; }
  function toast(message, kind = '') { const node = el('div', `toast ${kind}`, message); $('toasts').append(node); setTimeout(() => node.remove(), 5200); }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify({peerId, settings, contacts: contacts.map(({online, ...c}) => c), history, sentPranks, receivedPranks, shareURL: saved.shareURL || ''})); }
    catch { if (!storageFailed) toast('Browser storage is full or unavailable. Changes will last for this tab only.'); storageFailed = true; }
  }
  const identity = () => ({id: peerId, handle: settings.handle, deviceName: settings.deviceName, deviceType});
  const contactFor = id => contacts.find(c => c.peerId === id);
  const labelFor = (id, fallback) => contactFor(id)?.identity?.deviceName || fallback?.deviceName || fallback?.handle || id;
  const bytes = value => value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`;
  const clock = value => new Date(value).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  function showDialog(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
  function closeDialog(id) { $(id).close(); }
  const targetDialog = el('dialog', 'modal');
  targetDialog.id = 'target-dialog'; targetDialog.setAttribute('aria-label', 'Choose a recipient');
  document.body.append(targetDialog);
  const pairConnectionStatus = el('p', 'notice');
  pairConnectionStatus.id = 'pair-connection-status'; pairConnectionStatus.setAttribute('role', 'status');
  $('pair-dialog').append(pairConnectionStatus);
  targetDialog.addEventListener('cancel', event => { event.preventDefault(); cancelPending(); });
  all('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  all('dialog').forEach(dialog => {
    dialog.addEventListener('click', e => { if (e.target === dialog && dialog.id !== 'request-dialog' && dialog.id !== 'prank-overlay') { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) { if (dialog === targetDialog) cancelPending(); else dialog.close(); } } });
    dialog.addEventListener('close', () => { setTimeout(pumpRequests, 0); });
  });
  function applySettings() {
    $('profile-name').textContent = settings.handle;
    $('profile-initial').textContent = $('top-initial').textContent = settings.handle.slice(0, 1).toUpperCase();
    $('active-device-badge').textContent = settings.deviceName;
    $('notch').classList.toggle('is-hidden', !settings.notch);
    $('notch').classList.toggle('music-disabled', !settings.music);
    renderContacts();
    resetNotch();
  }
  function setNotch(state) {
    $('notch').dataset.state = state;
    $('notch-toggle').setAttribute('aria-expanded', String(state !== 'idle'));
    $('notch').classList.remove('force-visible');
  }
  function resetNotch() {
    if ($('prank-overlay').open) return renderPrankNotch();
    if (pending) return renderTargets();
    if (activeRequest && !document.querySelector('dialog[open]')) return settings.notch ? renderRequestNotch() : renderRequestDialog();
    setNotch(manuallyExpanded && settings.music ? 'music' : 'idle');
  }
  $('notch-toggle').addEventListener('click', () => { if (pending || activeRequest) return; manuallyExpanded = !manuallyExpanded; resetNotch(); });
  $('notch').addEventListener('mouseenter', () => { if (!pending && !activeRequest && settings.music && !dragDepth && !$('prank-overlay').open) setNotch('music'); });
  $('notch').addEventListener('mouseleave', () => { if (!dragDepth) resetNotch(); });
  $('try-island').addEventListener('click', () => { if (!settings.notch) return toast('Enable Dynamic Notch in Settings to meet your island.'); manuallyExpanded = true; setNotch('music'); });
  function renderContacts() {
    const own = contacts.filter(c => c.kind === 'own');
    const friends = contacts.filter(c => c.kind !== 'own');
    $('device-count').textContent = $('nav-device-count').textContent = own.length + 1;
    $('friend-count').textContent = $('nav-friend-count').textContent = friends.length;
    const here = el('div', 'device-row current-device');
    const hereIcon = el('span', 'device-icon'); hereIcon.append(icon(deviceType));
    const hereInfo = el('div', 'device-info'); hereInfo.append(el('strong', '', settings.deviceName), el('small', '', 'This device · ready to share'));
    const tag = el('span', 'tiny-tag this-device', 'YOU ARE HERE'); here.append(hereIcon, hereInfo, tag);
    $('devices-list').replaceChildren(here, ...own.map(renderContact));
    $('friends-list').replaceChildren(...friends.map(renderContact));
    if (!friends.length) { const empty = el('div', 'empty-state friends-empty'); empty.append(el('div', 'empty-friends-icon', '↗'), el('strong', '', 'Your people belong here.'), el('p', '', 'Add a friend to send good things their way.')); $('friends-list').append(empty); }
  }
  function renderContact(c) {
    const row = el('div', c.kind === 'own' ? 'device-row' : 'friend-row');
    const marker = el('span', c.kind === 'own' ? 'device-icon' : 'avatar');
    if (c.kind === 'own') marker.append(icon(c.identity?.deviceType || 'phone')); else marker.textContent = (c.identity?.handle || '?').slice(0, 1).toUpperCase();
    const info = el('div', 'device-info'); info.append(el('strong', '', c.kind === 'own' ? labelFor(c.peerId) : c.identity?.handle || 'Friend'), el('small', c.online ? 'online-text' : '', `${c.online ? 'Online' : 'Offline'} · ${c.kind === 'own' ? c.identity?.handle || 'My device' : labelFor(c.peerId)}`));
    const actions = el('div', 'device-actions');
    if (c.online) {
      for (const [name, glyph, action] of [['Send file', 'send', () => pickFiles(c.peerId)], ['Send clipboard', 'clipboard', () => pushClipboard(c.peerId)]]) { const b = button('', 'icon-button', action, glyph); b.title = name; b.setAttribute('aria-label', `${name} to ${labelFor(c.peerId)}`); actions.append(b); }
      if (c.kind !== 'own') { const b = button('', 'icon-button', () => openPranks(c.peerId), 'prank'); b.title = 'Send daily prank'; b.setAttribute('aria-label', `Send daily prank to ${labelFor(c.peerId)}`); actions.append(b); }
    } else { const b = button('', 'icon-button', () => connect(c.peerId, c.kind), 'refresh'); b.title = 'Reconnect device'; b.setAttribute('aria-label', `Reconnect ${labelFor(c.peerId)}`); actions.append(b); }
    const remove = button('', 'icon-button muted', () => removeContact(c.peerId), 'close'); remove.title = 'Forget device and revoke trust'; remove.setAttribute('aria-label', `Forget ${labelFor(c.peerId)}`); actions.append(remove);
    row.append(marker, info, actions); return row;
  }
  function removeContact(id) {
    contacts = contacts.filter(c => c.peerId !== id); persist();
    if (network?.revoke) network.revoke(id); else startNetwork();
    requests = requests.filter(r => { if (r.peerId === id) { r.decline(); return false; } return true; });
    if (activeRequest?.peerId === id) resolveRequest(false);
    renderContacts(); if (pending) renderTargets(); toast('Device forgotten. Pair again to restore access.');
  }
  function addActivity(id, title, subtitle, status = '', kind = 'send') {
    let item = activities.get(id);
    if (!item) {
      const row = el('div', 'activity-row'); const art = el('span', 'activity-icon'); art.append(icon(kind));
      const copy = el('div', 'activity-copy'); const heading = el('strong', '', title); const detail = el('small', '', subtitle); copy.append(heading, detail);
      const state = el('span', 'activity-status', status); row.append(art, copy, state); item = {row, heading, detail, state, copy}; activities.set(id, item);
      $('activity-list').querySelector('.empty-activity')?.remove(); $('activity-list').prepend(row);
      if (activities.size > 40) { const first = activities.keys().next().value; activities.get(first).row.remove(); activities.delete(first); }
    } else { item.heading.textContent = title; item.detail.textContent = subtitle; item.state.textContent = status; }
    return item;
  }
  function renderHistory() {
    $('clipboard-list').replaceChildren();
    if (!history.length) { const empty = el('div', 'empty-state clipboard-empty'); empty.append(icon('clipboard'), el('strong', '', 'A bridge for your bright ideas.'), el('p', '', 'Received notes and links will land right here.')); $('clipboard-list').append(empty); return; }
    history.forEach(h => { const row = el('div', 'clipboard-item'); const text = el('p', 'clipboard-text', h.text); const meta = el('div', 'clipboard-meta'); meta.append(el('small', 'muted', `${h.sender} · ${clock(h.time)}`), button('Copy', 'text-button', () => copyText(h.text))); row.append(text, meta); $('clipboard-list').append(row); });
  }
  async function copyText(text) {
    try { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(text); toast('Copied to your clipboard.'); }
    catch { const area = el('textarea'); area.value = text; area.style.cssText = 'position:fixed;left:-9999px;top:0'; (document.querySelector('dialog[open]') || document.body).append(area); area.select(); let copied = false; try { copied = document.execCommand('copy'); } catch {} area.remove(); toast(copied ? 'Copied to your clipboard.' : 'Clipboard is unavailable here. Select and copy the text manually.'); }
  }
  async function pushClipboard(id) {
    try { if (!navigator.clipboard?.readText) throw new Error(); const text = await navigator.clipboard.readText(); if (!text.trim()) return toast('Your clipboard is empty.'); choosePayload({type: 'clipboard', text}, id); }
    catch { noteTarget = id || null; $('note-text').value = ''; showDialog('note-dialog'); toast('Paste your clipboard here to share it.'); }
  }
  $('push-clipboard').addEventListener('click', () => pushClipboard());
  $('write-note').addEventListener('click', () => { noteTarget = null; $('note-text').value = ''; showDialog('note-dialog'); });
  $('note-form').addEventListener('submit', e => { e.preventDefault(); const text = $('note-text').value; if (!text.trim()) return; closeDialog('note-dialog'); choosePayload({type: 'clipboard', text}, noteTarget); });
  $('clear-clipboard').addEventListener('click', () => { history = []; persist(); renderHistory(); toast('Clipboard history cleared.'); });
  function pickFiles(id) { targetHint = id || null; $('file-input').click(); }
  $('drop-zone').addEventListener('click', () => pickFiles());
  $('drop-zone').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFiles(); } });
  $('mobile-files').addEventListener('click', () => pickFiles());
  $('camera-button').addEventListener('click', () => { targetHint = null; $('camera-input').click(); });
  ['file-input', 'camera-input'].forEach(id => $(id).addEventListener('change', e => { const files = [...e.target.files]; if (files.length) choosePayload({type: 'file', files}, targetHint); e.target.value = ''; }));
  function choosePayload(payload, selectedId) { pending = {...payload, selected: new Set(selectedId ? [selectedId] : [])}; manuallyExpanded = false; renderTargets(); $('notch').scrollIntoView({block: 'nearest'}); }
  function renderTargets() {
    if (!pending) return;
    setNotch(settings.notch ? 'targets' : 'idle');
    const title = pending.type === 'file' ? `${pending.files.length} ${pending.files.length === 1 ? 'file' : 'files'} ready to travel` : pending.type === 'prank' ? 'Choose your partner in crime' : 'Send a little thought';
    const wrap = el('div', 'notch-message'); wrap.append(el('strong', '', title), el('small', 'muted', pending.type === 'file' ? `${pending.files.map(f => f.name).join(', ').slice(0, 100)} · ${bytes(pending.files.reduce((n, f) => n + f.size, 0))}` : pending.type === 'clipboard' ? pending.text.slice(0, 80) : 'One prank per friend, every 24 hours.'));
    const choices = contacts.filter(c => c.online && (pending.type !== 'prank' || c.kind === 'friend'));
    const list = el('div', 'target-list');
    choices.forEach(c => { const row = el('label', 'target-option'); const check = document.createElement('input'); check.type = 'checkbox'; check.checked = pending.selected.has(c.peerId); const unavailable = pending.type === 'prank' && (prankReservations.has(c.peerId) || Date.now() - (sentPranks[c.peerId] || 0) < DAY); check.disabled = unavailable; if (unavailable) pending.selected.delete(c.peerId); check.addEventListener('change', () => check.checked ? pending.selected.add(c.peerId) : pending.selected.delete(c.peerId)); row.append(check, icon(c.identity?.deviceType || 'devices'), el('span', '', `${labelFor(c.peerId)}${unavailable ? ' · available tomorrow' : ''}`)); list.append(row); });
    if (!choices.length) list.append(el('p', 'muted', 'Pair a device and keep both tabs open to send.'));
    const actions = el('div', 'target-actions'); actions.append(button('Cancel', 'button secondary', cancelPending));
    if (choices.length) actions.append(button('Send drop ↗', 'button primary', sendPending)); else actions.append(button('Pair a device', 'button primary', openPair));
    wrap.append(list, actions);
    if (settings.notch) { if (targetDialog.open) targetDialog.close(); targetDialog.replaceChildren(); $('notch-content').replaceChildren(wrap); }
    else { $('notch-content').replaceChildren(); targetDialog.replaceChildren(wrap); showDialog('target-dialog'); }
  }
  function cancelPending() { pending = null; if (targetDialog.open) targetDialog.close(); targetDialog.replaceChildren(); resetNotch(); pumpRequests(); }
  async function sendPending() {
    if (!pending) return;
    const data = pending; const targets = [...data.selected].filter(id => contactFor(id)?.online);
    if (!targets.length) return toast('Choose an online recipient first.');
    pending = null; if (targetDialog.open) targetDialog.close(); targetDialog.replaceChildren(); resetNotch();
    await Promise.allSettled(targets.map(async id => {
      if (data.type === 'prank') { if (prankReservations.has(id) || Date.now() - (sentPranks[id] || 0) < DAY) return toast('That friend has already received your daily prank.'); prankReservations.add(id); }
      const activityId = uid(); const name = labelFor(id);
      addActivity(activityId, data.type === 'file' ? `Sending ${data.files.length} file(s)` : data.type === 'prank' ? 'Daily prank' : 'Clipboard drop', `To ${name} · ${clock(Date.now())}`, 'Waiting for approval');
      try {
        if (data.type === 'file') await network.sendFiles(id, data.files);
        else if (data.type === 'clipboard') await network.sendClipboard(id, data.text);
        else { await network.sendPrank(id, data.prankId); sentPranks[id] = Date.now(); persist(); }
        addActivity(activityId, data.type === 'file' ? `${data.files.length} file(s) sent` : data.type === 'prank' ? 'Prank delivered' : 'Clipboard delivered', `To ${name} · ${clock(Date.now())}`, 'Delivered', 'check'); toast(`Delivered to ${name}.`);
      } catch (error) { addActivity(activityId, 'Drop not completed', `To ${name}`, error?.message || 'Connection unavailable'); toast(error?.message || 'Could not send. Reconnect and try again.', 'error'); }
      finally { prankReservations.delete(id); }
    })); pumpRequests();
  }
  function dragAllowed(e) { return e.dataTransfer && [...e.dataTransfer.types].some(t => t === 'Files' || t === 'text/plain' || t === 'text/uri-list'); }
  function clearDrag() { dragDepth = 0; clearTimeout(dragTimer); $('drop-zone').classList.remove('drag-active'); resetNotch(); }
  document.addEventListener('dragenter', e => { if (!dragAllowed(e)) return; e.preventDefault(); dragDepth++; if (!activeRequest) { setNotch('drag'); const msg = el('div', 'notch-message drag-message'); msg.append(icon('send'), el('strong', '', 'Drop files or text here to AirDrop')); $('notch-content').replaceChildren(msg); } $('drop-zone').classList.add('drag-active'); });
  document.addEventListener('dragover', e => { if (!dragAllowed(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; clearTimeout(dragTimer); dragTimer = setTimeout(clearDrag, 800); });
  document.addEventListener('dragleave', e => { if (!dragAllowed(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) clearDrag(); });
  document.addEventListener('drop', e => { if (!dragAllowed(e)) return; e.preventDefault(); const files = [...e.dataTransfer.files]; const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list'); clearDrag(); if (files.length) choosePayload({type: 'file', files}); else if (text) choosePayload({type: 'clipboard', text: text.slice(0, 65536)}); });
  document.addEventListener('dragend', clearDrag);
  window.addEventListener('blur', clearDrag);
  function connect(id, kind = 'friend', token) {
    id = String(id || '').trim();
    if (!id || id === peerId) return toast('Use the code from your other device.');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return toast('That device code is not valid.');
    if (!network || networkState !== 'online') return toast('Signaling is offline. Reconnect before pairing.');
    lastPairAttempt = {id, kind, token};
    try { network.connect(id, kind, token); toast('Connecting. Keep both tabs visible until pairing finishes.'); } catch (e) { showPairingStatus({peerId: id, phase: 'failed', message: e.message || 'Pairing failed.'}); }
  }
  function showPairingStatus(detail) {
    const {peerId: remoteId, phase, message} = detail;
    pairingLog.push({time: new Date().toISOString(), peerId: remoteId, phase, message});
    if (pairingLog.length > 30) pairingLog.shift();
    $('pairing-status').hidden = false;
    $('pairing-status').dataset.phase = phase;
    $('pairing-status-title').textContent = ({connecting: 'Connecting to device', slow: 'Device connection is taking longer', handshake: 'Device reached', waiting: 'Waiting for approval', approval: 'Pairing approval needed', verifying: 'Confirming pairing', connected: 'Device paired', failed: 'Pairing failed', closed: 'Device disconnected'})[phase] || 'Pairing status';
    $('pairing-status-message').textContent = message;
    $('pairing-status-code').textContent = remoteId || '';
    $('pair-connection-status').textContent = message;
    const retryable = ['slow', 'failed', 'closed'].includes(phase);
    $('retry-pairing').hidden = !retryable || lastPairAttempt?.id !== remoteId;
    $('pairing-relay-settings').hidden = !retryable;
  }
  $('retry-pairing').addEventListener('click', () => { if (!lastPairAttempt) return; const {id, kind, token} = lastPairAttempt; network?.disconnect(id); connect(id, kind, token); });
  $('pairing-relay-settings').addEventListener('click', () => { openSettings(); document.querySelector('.network-settings').open = true; });
  $('copy-pairing-diagnostics').addEventListener('click', () => copyText(JSON.stringify({version: 'pairing-2', signaling: networkState, relayConfigured: Boolean(settings.turnUrl), events: pairingLog}, null, 2)));
  function startNetwork() {
    network?.destroy(); contacts.forEach(c => { c.online = false; }); renderContacts();
    if (typeof window.NotchPeer !== 'function') { setNetworkStatus({state: 'offline', message: 'Networking library unavailable'}); return; }
    network = new window.NotchPeer({identity: identity(), settings, getTrust: id => { const c = contactFor(id); return c ? {secret: c.secret, kind: c.kind} : null; }});
    network.addEventListener('pairing-status', e => showPairingStatus(e.detail));
    network.addEventListener('status', e => { setNetworkStatus(e.detail); if (e.detail.state === 'online') { for (const c of contacts) { try { network.connect(c.peerId, c.kind); } catch {} } if (invitation) { const data = invitation; invitation = null; queueRequest({requestType: 'pairing', outbound: true, peerId: data.id, identity: {handle: 'An invitation', deviceName: 'the linked device'}, accept: kind => connect(data.id, kind, data.token), decline: () => toast('Invitation dismissed.')}); } if ($('pair-dialog').open) updateQR(); } });
    network.addEventListener('connected', e => { const c = e.detail; if (!c.peerId || !c.secret) return; const old = contactFor(c.peerId); if (old) Object.assign(old, c, {online: true}); else contacts.push({...c, online: true}); persist(); renderContacts(); if (pending) renderTargets(); toast(`${labelFor(c.peerId)} is connected.`); addActivity(uid(), 'Device connected', labelFor(c.peerId), 'Online', 'devices'); });
    network.addEventListener('disconnected', e => { const c = contactFor(e.detail.peerId); if (c) c.online = false; discardRequests(r => r.peerId === e.detail.peerId); renderContacts(); if (pending) renderTargets(); });
    network.addEventListener('pairing-request', e => queueRequest({...e.detail, requestType: 'pairing'}));
    network.addEventListener('incoming-transfer', e => receiveRequest(e.detail));
    network.addEventListener('progress', e => { const d = e.detail; if (activities.get(d.id)?.received) return; const complete = d.direction === 'send' && d.percent >= 100; const item = addActivity(d.id, `${complete ? 'Sent' : d.direction === 'send' ? 'Sending' : 'Receiving'} ${d.name || 'drop'}`, `${labelFor(d.peerId)} · ${bytes(d.loaded || 0)} / ${bytes(d.total || 0)}`, complete ? 'Delivered' : `${Math.round(d.percent || 0)}%`, d.direction === 'send' ? 'send' : 'download'); let progress = item.copy.querySelector('progress'); if (!progress) { progress = el('progress', 'transfer-progress'); progress.max = 100; progress.setAttribute('aria-label', 'Transfer progress'); item.copy.append(progress); } progress.value = d.percent || 0; if (progress.value >= 100) progress.remove(); });
    network.addEventListener('received', e => onReceived(e.detail));
    network.addEventListener('error', e => { toast(e.detail.message || 'Connection error.', 'error'); if (e.detail.id) { discardRequests(r => r.id === e.detail.id && (!e.detail.peerId || r.peerId === e.detail.peerId)); if (activities.has(e.detail.id)) { const item = activities.get(e.detail.id); item.state.textContent = 'Failed'; item.copy.querySelector('progress')?.remove(); } } });
    try { network.start(); } catch (e) { setNetworkStatus({state: 'offline', message: e.message}); }
  }
  function setNetworkStatus({state, message}) {
    networkState = state; $('network-status').dataset.state = state; $('network-status').querySelector('span').textContent = state === 'online' ? 'Online' : state === 'connecting' ? 'Connecting' : 'Offline mode';
    $('network-status').title = message || (state === 'online' ? 'Signaling connected · click to reconnect' : 'Click to reconnect'); $('notch').dataset.connection = state; $('notch-label').textContent = state === 'online' ? 'NotchDrop' : state === 'connecting' ? 'Connecting' : 'Offline ready'; $('my-peer-id').value = peerId;
  }
  $('network-status').addEventListener('click', startNetwork);
  function receiveRequest(d) {
    const trusted = contactFor(d.peerId);
    if (!trusted) { d.decline(); return; }
    if (d.type === 'prank') {
      if (Date.now() - (receivedPranks[d.peerId] || 0) < DAY || requests.some(r => r.peerId === d.peerId && r.type === 'prank') || activeRequest?.peerId === d.peerId && activeRequest?.type === 'prank') { d.decline(); return; }
      if (settings.autoPranks) { receivedPranks[d.peerId] = Date.now(); persist(); d.accept(); return; }
    } else if (trusted.kind === 'own' && settings.autoOwn) { d.accept(); return; }
    queueRequest({...d, requestType: 'transfer'});
  }
  function queueRequest(request) { if (requests.length >= 20) { request.decline(); return; } requests.push(request); pumpRequests(); }
  function discardRequests(matches) {
    requests = requests.filter(r => { if (!matches(r)) return true; try { r.decline(); } catch {} return false; });
    if (activeRequest && matches(activeRequest)) resolveRequest(false);
  }
  function pumpRequests() {
    if (!activeRequest && !requests.length) return;
    if ($('request-dialog').open || $('prank-overlay').open) return;
    if (!activeRequest) activeRequest = requests.shift();
    if (activeRequest.outbound || (mobile && activeRequest.requestType === 'pairing') || !settings.notch || pending || document.querySelector('dialog[open]')) renderRequestDialog(); else renderRequestNotch();
  }
  function requestDescription() {
    const r = activeRequest;
    if (r.outbound) return `You scanned an invitation to ${r.peerId}. Tap Connect below to send a pairing request, then tap Accept on the other device. Keep both tabs visible.`;
    return r.requestType === 'pairing' ? `${r.identity?.handle || 'Someone'} wants to pair ${r.identity?.deviceName || 'a device'}. Verify their code: ${r.peerId}` : `${labelFor(r.peerId, r.identity)} ${r.type === 'file' ? `sent ${r.name} (${bytes(r.size || 0)})` : r.type === 'prank' ? `sent a ${prankName(r.prankId)} surprise` : 'sent a clipboard note'}.`;
  }
  function requestBody() {
    const body = el('div', 'incoming-body'); body.append(el('p', '', requestDescription()));
    if (activeRequest.requestType === 'pairing') { const label = el('label', 'checkbox-line'); const check = document.createElement('input'); check.type = 'checkbox'; check.id = 'pair-as-own'; check.checked = false; label.append(check, el('span', '', 'This is my own device')); body.append(label, el('small', 'muted', 'Only mark this if you control both devices.')); }
    if (activeRequest.type === 'clipboard') body.append(el('p', 'clipboard-text', (activeRequest.text || '').slice(0, 250)));
    return body;
  }
  function renderRequestNotch() {
    if (!activeRequest) return; setNotch('incoming'); const wrap = el('div', 'notch-message'); wrap.append(el('strong', '', activeRequest.requestType === 'pairing' ? 'A new connection' : 'An incoming drop'), requestBody()); const actions = el('div', 'incoming-actions'); actions.append(button('Decline', 'button secondary', () => resolveRequest(false)), button('Accept', 'button primary', () => resolveRequest(true))); wrap.append(actions); $('notch-content').replaceChildren(wrap);
  }
  function renderRequestDialog() { $('request-title').textContent = activeRequest.outbound ? 'Connect to the scanned device?' : activeRequest.requestType === 'pairing' ? 'Approve this device?' : 'An incoming drop'; $('request-accept').textContent = activeRequest.outbound ? 'Connect' : 'Accept'; $('request-decline').textContent = activeRequest.outbound ? 'Cancel' : 'Decline'; $('request-content').replaceChildren(requestBody()); showDialog('request-dialog'); }
  function resolveRequest(accept) {
    const r = activeRequest; if (!r) return;
    const own = $('pair-as-own')?.checked; activeRequest = null;
    try { if (accept) { if (r.requestType === 'pairing') r.accept(own ? 'own' : 'friend'); else { if (r.type === 'prank') { receivedPranks[r.peerId] = Date.now(); persist(); } r.accept(); } } else r.decline(); } catch (e) { toast(e.message || 'Request expired.'); }
    if ($('request-dialog').open) $('request-dialog').close(); $('request-content').replaceChildren(); $('notch-content').replaceChildren(); resetNotch(); setTimeout(pumpRequests, 0);
  }
  $('request-accept').addEventListener('click', () => resolveRequest(true));
  $('request-decline').addEventListener('click', () => resolveRequest(false));
  $('request-close').addEventListener('click', () => resolveRequest(false));
  $('request-dialog').addEventListener('cancel', e => { e.preventDefault(); resolveRequest(false); });
  function onReceived(d) {
    const sender = labelFor(d.peerId, d.identity);
    if (d.type === 'clipboard') { history.unshift({text: d.text || '', sender, time: Date.now()}); history = history.slice(0, 20); persist(); renderHistory(); toast(`Clipboard received from ${sender}.`); }
    else if (d.type === 'prank') { receivedPranks[d.peerId] = Date.now(); persist(); showPrank(d.prankId); }
    const item = addActivity(d.id || uid(), d.type === 'file' ? d.name : d.type === 'prank' ? `${prankName(d.prankId)} received` : 'Clipboard received', `From ${sender} · ${clock(Date.now())}`, 'Received', 'download');
    item.received = true;
    item.copy.querySelector('progress')?.remove();
    if (d.type === 'file' && d.blob instanceof Blob) { const url = URL.createObjectURL(d.blob); blobURLs.push(url); const a = el('a', 'text-button', 'Save file ↓'); a.href = url; a.download = d.name || 'NotchDrop-file'; item.state.replaceChildren(a); toast(`${d.name} received. Save it from Recent activity.`); }
  }
  function openPair() { $('share-url').value = saved.shareURL || (location.protocol === 'file:' ? '' : `${location.origin}${location.pathname}`); showDialog('pair-dialog'); updateQR(); }
  $('pair-button').addEventListener('click', openPair); $('add-device').addEventListener('click', openPair);
  function updateQR() {
    const base = $('share-url').value.trim(); $('my-peer-id').value = peerId; $('qr-code').replaceChildren(); pairURL = '';
    if (!base) { $('pair-warning').textContent = 'This local file cannot be opened from your phone. Host this folder on HTTPS, then paste its public URL here. Device codes work when both copies are online.'; return; }
    try {
      const url = new URL(base); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS app URL.');
      saved.shareURL = url.href;
      persist();
      pairURL = window.NotchPeer.generatePairURL(url.href, peerId, 'own');
      window.NotchPeer.renderQR($('qr-code'), pairURL);
      const local = /^(localhost|127\.|\[::1\])/.test(url.hostname);
      $('pair-warning').textContent = local ? 'This address only works on this computer. Use a reachable HTTPS address for your phone or mobile data.' : url.protocol !== 'https:' ? 'Use HTTPS for clipboard permissions and secure mobile access. Both devices must be able to open this URL.' : networkState === 'online' ? 'Scan with your phone camera, tap Connect on your phone, then Accept here. Keep both tabs visible.' : 'Pairing needs internet access. The dashboard and demo music work offline.';
    } catch (e) { $('pair-warning').textContent = e.message || 'Enter a valid app URL.'; }
  }
  $('update-qr').addEventListener('click', updateQR);
  $('copy-peer').addEventListener('click', () => copyText(peerId));
  $('copy-link').addEventListener('click', () => pairURL ? copyText(pairURL) : toast('Enter a reachable app URL to create a pairing link.'));
  $('pair-form').addEventListener('submit', e => { e.preventDefault(); connect($('pair-peer-id').value, 'own'); closeDialog('pair-dialog'); });
  ['add-friend', 'invite-friend'].forEach(id => $(id).addEventListener('click', () => showDialog('friend-dialog')));
  $('friend-form').addEventListener('submit', e => { e.preventDefault(); connect($('friend-peer-id').value, 'friend'); closeDialog('friend-dialog'); });
  $('copy-friend-link').addEventListener('click', () => { const base = saved.shareURL || (location.protocol !== 'file:' ? `${location.origin}${location.pathname}` : ''); if (!base) return toast('Set a reachable app URL in Pair a device first.'); try { copyText(window.NotchPeer.generatePairURL(base, peerId, 'friend')); } catch (e) { toast(e.message); } });
  function openSettings() { $('handle').value = settings.handle; $('device-name').value = settings.deviceName; for (const [id, key] of [['setting-notch','notch'], ['setting-music','music'], ['setting-pranks','autoPranks'], ['setting-own','autoOwn'], ['force-relay','forceRelay']]) $(id).checked = settings[key]; $('turn-url').value = settings.turnUrl; $('turn-user').value = settings.turnUser; $('turn-password').value = settings.turnPassword; showDialog('settings-dialog'); }
  all('.settings-open').forEach(b => b.addEventListener('click', openSettings));
  $('settings-form').addEventListener('submit', e => {
    e.preventDefault(); const oldNetwork = JSON.stringify([settings.turnUrl, settings.turnUser, settings.turnPassword, settings.forceRelay]); const turnUrl = $('turn-url').value.trim();
    if (turnUrl && !/^turns?:[^\s]+$/i.test(turnUrl)) return toast('Use a TURN URL beginning with turn: or turns:.');
    if ($('force-relay').checked && !turnUrl) return toast('Add a TURN server before forcing relay.');
    settings = {...settings, handle: $('handle').value.trim() || defaults.handle, deviceName: $('device-name').value.trim() || defaults.deviceName, notch: $('setting-notch').checked, music: $('setting-music').checked, autoPranks: $('setting-pranks').checked, autoOwn: $('setting-own').checked, turnUrl, turnUser: $('turn-user').value.trim(), turnPassword: $('turn-password').value, forceRelay: $('force-relay').checked};
    persist(); applySettings(); closeDialog('settings-dialog'); if (oldNetwork !== JSON.stringify([settings.turnUrl, settings.turnUser, settings.turnPassword, settings.forceRelay])) startNetwork(); else network?.updateIdentity(identity()); toast('Your setup is saved.');
  });
  all('[data-nav]').forEach(link => link.addEventListener('click', () => { all('[data-nav]').forEach(l => l.classList.toggle('active', l === link)); $('page-label').textContent = {overview:'Overview', devices:'My devices', friends:'Friends', clipboard:'Clipboard', activity:'Activity'}[link.dataset.nav]; }));
  function openPranks(id) { targetHint = id || null; showDialog('prank-dialog'); }
  function prankName(id) { return {confetti:'Confetti explosion', airhorn:'Airhorn', bsod:'Fake blue screen', cat:'Cat takeover', jumpscare:'Surprise'}[id] || 'Daily prank'; }
  $('open-pranks').addEventListener('click', () => openPranks());
  const memeOption = el('button', 'prank-option');
  memeOption.type = 'button'; memeOption.dataset.prank = 'jumpscare'; memeOption.setAttribute('aria-pressed', 'false');
  memeOption.append(el('span', '', '👀'), el('strong', '', 'Meme ambush'), el('small', '', 'A very unserious jumpscare'));
  $('prank-options').append(memeOption);
  all('[data-prank]').forEach(b => b.addEventListener('click', () => { selectedPrank = b.dataset.prank; all('[data-prank]').forEach(p => { p.classList.toggle('selected', p === b); p.setAttribute('aria-pressed', String(p === b)); }); }));
  $('send-prank').addEventListener('click', () => { closeDialog('prank-dialog'); choosePayload({type: 'prank', prankId: selectedPrank}, targetHint); });
  $('preview-prank').addEventListener('click', () => showPrank(selectedPrank));
  function dismissPrank() { clearTimeout(prankTimer); $('prank-overlay').close(); $('prank-scene').replaceChildren(); $('notch').classList.remove('prank-alert'); resetNotch(); }
  function renderPrankNotch() {
    if (!settings.notch) { setNotch('idle'); return; }
    setNotch('prank');
    const message = el('div', 'notch-message');
    message.append(el('strong', '', 'A little surprise, just for you.'), el('small', '', prankName($('prank-overlay').dataset.prank)));
    $('notch-content').replaceChildren(message);
  }
  $('dismiss-prank').addEventListener('click', dismissPrank);
  $('prank-overlay').addEventListener('cancel', e => { e.preventDefault(); dismissPrank(); });
  function showPrank(id) {
    clearTimeout(prankTimer); const scene = $('prank-scene'); scene.replaceChildren(); $('prank-overlay').dataset.prank = id; $('notch').classList.add('prank-alert');
    if (id === 'bsod') scene.append(el('div', 'prank-big-symbol', ':)'), el('h2', '', 'Your device ran into a friend.'), el('p', '', 'No error. No restart. Just your daily prank.'), el('small', '', '100% harmless · NOTCHDROP_PRANK'));
    else if (id === 'cat') scene.append(el('div', 'prank-big-symbol', '🐈'), el('h2', '', 'Your supervisor has arrived.'), el('p', '', 'Please stop working and provide snacks.'));
    else if (id === 'jumpscare') scene.append(el('div', 'prank-big-symbol', '👀'), el('h2', '', 'BOO. It’s your unfinished to-do list.'), el('p', '', 'Just kidding. Your friend says take a break.'));
    else if (id === 'airhorn') { scene.append(el('div', 'prank-big-symbol', '📣'), el('h2', '', 'A very important announcement.'), el('p', '', 'Your friend would like some attention.')); playHorn(); }
    else { scene.append(el('div', 'prank-big-symbol', '🎉'), el('h2', '', 'You deserve a tiny celebration.'), el('p', '', 'Consider this your daily standing ovation.')); if (!matchMedia('(prefers-reduced-motion: reduce)').matches) for (let i = 0; i < 55; i++) { const piece = el('i', 'confetti-piece'); piece.style.cssText = `--x:${Math.random() * 100}%;--delay:${Math.random() * 1.5}s;--rotation:${Math.random() * 720}deg;left:${Math.random() * 100}%;background:${['#c7f78a','#c4b5fd','#ffab84','#f8de76'][i % 4]}`; scene.append(piece); } }
    showDialog('prank-overlay'); renderPrankNotch(); prankTimer = setTimeout(dismissPrank, 9000);
  }
  function playHorn() {
    try { const Context = window.AudioContext || window.webkitAudioContext; if (!Context) return; const audio = new Context(); const gain = audio.createGain(); gain.gain.setValueAtTime(0.025, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.65); gain.connect(audio.destination); [220, 277].forEach(freq => { const osc = audio.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq; osc.connect(gain); osc.start(); osc.stop(audio.currentTime + 0.7); }); setTimeout(() => audio.close(), 900); } catch { /* Visual surprise still works when audio is blocked. */ }
  }
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); openSettings(); } if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { if (activeRequest) resolveRequest(false); else if (pending) { pending = null; resetNotch(); pumpRequests(); } else { manuallyExpanded = false; clearDrag(); } } });
  window.addEventListener('online', () => { if (networkState === 'offline') startNetwork(); });
  window.addEventListener('beforeunload', () => { network?.destroy(); blobURLs.forEach(url => URL.revokeObjectURL(url)); });
  function readInvitation() {
    try { const url = new URL(location.href); const hash = new URLSearchParams(url.hash.slice(1)); const params = url.searchParams.has('pair') ? url.searchParams : hash; const id = params.get('peer') || params.get('pair'); if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) return; invitation = {id, kind: params.get('kind') === 'own' ? 'own' : 'friend', token: params.get('token') || undefined}; ['pair', 'peer', 'kind', 'token'].forEach(key => url.searchParams.delete(key)); url.hash = ''; window.history.replaceState(null, '', url.href); } catch { /* Manual pairing remains available. */ }
  }
  readInvitation(); persist(); applySettings(); renderHistory(); window.NotchMusic?.init({toast}); startNetwork();
  if (storageFailed) toast('Browser storage is unavailable. Pairings and settings will last for this tab.');
  window.NotchDrop = Object.freeze({toast, getIdentity: identity, getSettings: () => ({...settings}), getState: () => ({networkState, contacts: contacts.map(({secret, ...c}) => ({...c})), pendingType: pending?.type || null, requestCount: requests.length + Number(Boolean(activeRequest)), clipboardCount: history.length}), reconnect: startNetwork});
})();
