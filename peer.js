/* NotchDrop transport. PeerJS handles signaling and encrypted WebRTC data channels.
 * Public STUN helps direct connections; restrictive networks need your own TURN.
 * Trust is granted by local pairing approval and verified using HMAC on reconnect.
 */
(() => {
  'use strict';
  const VERSION = 1;
  const CHUNK = 64 * 1024;
  const MAX_FILE = 100 * 1024 * 1024;
  const MAX_TEXT = 64 * 1024;
  const MAX_PENDING = 16;
  const TIMEOUT = 120000;
  const clean = (value, max = 100) => String(value || '').replace(/[\u0000-\u001f]/g, '').slice(0, max);
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  const kindOf = value => value === 'own' ? 'own' : 'friend';
  const random = () => {
    if (!globalThis.crypto?.getRandomValues) throw new Error('Secure randomness is unavailable in this browser.');
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join('');
  };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const byteLength = value => new TextEncoder().encode(value).byteLength;
  const identityOf = value => ({ id: clean(value?.id), handle: clean(value?.handle || 'Someone', 50), deviceName: clean(value?.deviceName || 'Device', 70), deviceType: clean(value?.deviceType || 'desktop', 24) });
  async function proof(secret, message) {
    if (!crypto.subtle) throw new Error('Trusted reconnect needs a secure context (HTTPS or localhost).');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))), n => n.toString(16).padStart(2, '0')).join('');
  }

  class NotchPeer extends EventTarget {
    constructor({ identity, settings = {}, getTrust = () => null } = {}) {
      super();
      this.identity = identityOf(identity);
      this.settings = settings;
      this.getTrust = getTrust;
      this.connections = new Map();
      this.outgoing = new Map();
      this.incoming = new Map();
      this.peer = null;
      this.online = false;
      this.destroyed = false;
      this.sweep = setInterval(() => this._prune(), 5000);
    }
    _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    _error(message, extra = {}) { this._emit('error', { message, ...extra }); }
    start() {
      if (this.peer && !this.peer.destroyed) return this;
      if (typeof window.Peer !== 'function') {
        this._emit('status', { state: 'offline', peerId: this.identity.id, message: 'Offline mode · connect to the internet to load PeerJS.' });
        return this;
      }
      if (!validId(this.identity.id)) {
        this._error('Device ID must contain only letters, numbers, underscores and hyphens.');
        return this;
      }
      const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
      const turnUrl = String(this.settings.turnUrl || '').trim();
      if (turnUrl) {
        if (!/^turns?:[^\s]+$/i.test(turnUrl)) {
          this._error('Enter a valid turn: or turns: relay URL.');
          return this;
        }
        iceServers.push({ urls: turnUrl, username: this.settings.turnUser || '', credential: this.settings.turnPassword || '' });
      }
      if (this.settings.forceRelay && !turnUrl) {
        this._error('Relay-only mode requires a TURN server URL and credentials.');
        return this;
      }
      this._emit('status', { state: 'connecting', peerId: this.identity.id, message: 'Connecting to signaling…' });
      try {
        this.peer = new window.Peer(this.identity.id, { debug: 0, config: { iceServers, iceTransportPolicy: this.settings.forceRelay ? 'relay' : 'all' } });
        this.peer.on('open', id => {
          this.online = true;
          this._emit('status', { state: 'online', peerId: id, message: 'Ready to pair' });
        });
        this.peer.on('connection', connection => this._bind(connection, false));
        this.peer.on('disconnected', () => {
          this.online = false;
          this._emit('status', { state: 'offline', peerId: this.identity.id, message: 'Signaling disconnected. Existing transfers may continue.' });
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => {
            if (!this.destroyed && this.peer?.disconnected && !this.peer.destroyed) this.peer.reconnect();
          }, 3000);
        });
        this.peer.on('error', error => {
          const message = error.type === 'peer-unavailable' ? 'That device is unavailable. Keep NotchDrop open on both devices.' : error.type === 'unavailable-id' ? 'This device ID is already active. Close another NotchDrop tab, then reload.' : clean(error.message || 'Peer connection failed.', 250);
          this._error(message);
          if (!this.peer?.open) {
            this.online = false;
            this._emit('status', { state: 'offline', peerId: this.identity.id, message });
          }
        });
      } catch (error) { this._error(error.message); }
      return this;
    }
    connect(peerId, kind = 'friend', token) {
      peerId = String(peerId || '').trim();
      if (!validId(peerId) || peerId === this.identity.id) throw new Error('Enter another device’s valid pairing ID.');
      if (!this.peer?.open) throw new Error('Go online before pairing a device.');
      const existing = this.connections.get(peerId);
      if (existing) return existing.conn;
      const conn = this.peer.connect(peerId, { reliable: true, serialization: 'binary' });
      this._bind(conn, true, kind, token);
      return conn;
    }
    _bind(conn, outbound, kind = 'friend', token) {
      if (this.connections.size >= 24 || !validId(conn.peer)) { conn.close(); return; }
      const old = this.connections.get(conn.peer);
      if (old?.ready) { conn.close(); return; }
      if (old) {
        // Both tabs can reconnect at once. Keep the same channel on both ends:
        // the smaller peer ID initiates when two channels compete.
        const preferredOutbound = this.identity.id < conn.peer;
        if (old.outbound === outbound || outbound !== preferredOutbound) { conn.close(); return; }
        this.connections.delete(conn.peer);
        old.conn.close();
      }
      const state = { conn, outbound, kind: kindOf(kind), token: clean(token), nonce: random(), ready: false, identity: null, created: Date.now(), lastSeen: Date.now(), queue: Promise.resolve() };
      this.connections.set(conn.peer, state);
      conn.on('open', () => {
        if (this.connections.get(conn.peer) === state && conn.open) this._send(state, { op: 'HELLO', identity: this.identity, nonce: state.nonce, requestedKind: state.kind });
      });
      conn.on('data', packet => {
        if (this.connections.get(conn.peer) !== state) return;
        state.queue = state.queue.then(() => this._packet(state, packet)).catch(error => {
          if (this.connections.get(conn.peer) !== state) return;
          this._error(error.message, { peerId: conn.peer });
          conn.close();
        });
      });
      conn.on('close', () => this._closed(state));
      conn.on('error', error => { this._error(clean(error.message || 'Connection failed.', 200), { peerId: conn.peer }); this._closed(state); });
    }
    _send(state, packet) {
      if (!state.conn.open) throw new Error('The other device disconnected.');
      state.conn.send({ v: VERSION, ...packet });
    }
    async _packet(state, packet) {
      if (!packet || typeof packet !== 'object' || packet.v !== VERSION || typeof packet.op !== 'string') return;
      state.lastSeen = Date.now();
      const peerId = state.conn.peer;
      if (packet.op === 'HELLO') {
        if (state.identity || !/^[a-f0-9]{48}$/.test(packet.nonce || '')) return;
        state.identity = identityOf(packet.identity);
        state.identity.id = peerId;
        state.remoteNonce = packet.nonce;
        const trust = this.getTrust(peerId);
        if (trust?.secret) {
          state.trust = trust;
          this._send(state, { op: 'AUTH', proof: await proof(trust.secret, `${state.remoteNonce}:${this.identity.id}:${peerId}`) });
        } else if (!state.outbound) {
          let decided = false;
          this._emit('pairing-request', {
            peerId, identity: state.identity, requestedKind: kindOf(packet.requestedKind),
            accept: (kind = 'friend') => {
              if (decided || !state.conn.open) return;
              decided = true;
              state.kind = kindOf(kind);
              state.secret = random();
              this._send(state, { op: 'PAIR_ACCEPT', secret: state.secret, kind: state.kind });
            },
            decline: () => { if (!decided) { decided = true; this._send(state, { op: 'PAIR_DECLINE' }); setTimeout(() => state.conn.close(), 100); } }
          });
        }
        return;
      }
      if (!state.identity) return;
      if (packet.op === 'PAIR_DECLINE') { this._error('Pairing was declined.', { peerId }); state.conn.close(); return; }
      if (packet.op === 'AUTH' && state.trust && !state.ready) {
        const expected = await proof(state.trust.secret, `${state.nonce}:${peerId}:${this.identity.id}`);
        if (packet.proof !== expected) throw new Error('Trusted device verification failed. Remove and pair this device again.');
        this._ready(state, state.trust.kind, state.trust.secret);
        return;
      }
      if (packet.op === 'AUTH' && !state.trust) throw new Error('Pairing records differ between devices. Remove the saved pairing on both devices and pair again.');
      if (packet.op === 'PAIR_ACCEPT' && state.outbound && !state.ready && !state.trust) {
        if (!/^[a-f0-9]{48}$/.test(packet.secret || '')) throw new Error('Invalid pairing response.');
        // The local user chose the destination and its role; a remote claim cannot promote a friend to an own device.
        this._send(state, { op: 'PAIR_CONFIRM', proof: await proof(packet.secret, `${state.remoteNonce}:${this.identity.id}:${peerId}`) });
        this._ready(state, state.kind, packet.secret);
        return;
      }
      if (packet.op === 'PAIR_CONFIRM' && !state.outbound && state.secret && !state.ready) {
        if (packet.proof !== await proof(state.secret, `${state.nonce}:${peerId}:${this.identity.id}`)) throw new Error('Pairing verification failed.');
        this._ready(state, state.kind, state.secret);
        return;
      }
      if (!state.ready) return;
      if (packet.op === 'IDENTITY') { state.identity = { ...identityOf(packet.identity), id: peerId }; this._emit('connected', this._contact(state)); return; }
      if (packet.op === 'OFFER') { this._offer(state, packet); return; }
      const key = `${peerId}:${packet.id}`;
      const outgoing = this.outgoing.get(key);
      const incoming = this.incoming.get(key);
      if (packet.op === 'ACCEPT' && outgoing && !outgoing.accepted) {
        outgoing.accepted = true;
        outgoing.updated = Date.now();
        if (outgoing.type === 'file') this._stream(state, outgoing).catch(error => this._failOutgoing(key, error));
        return;
      }
      if (packet.op === 'DECLINE' && outgoing) {
        if (outgoing.type === 'prank') this._emit('prank-result', { id: outgoing.id, peerId, prankId: outgoing.prankId, accepted: false });
        this._failOutgoing(key, new Error(clean(packet.reason || 'Transfer declined.', 200)));
        return;
      }
      if (packet.op === 'CHUNK' && incoming?.accepted && incoming.type === 'file') {
        // PeerJS BinaryPack returns Uint8Array views; preserve their exact window.
        // Never consume surrounding bytes from a pooled or offset backing buffer.
        const raw = packet.buffer;
        const binary = raw instanceof ArrayBuffer || ArrayBuffer.isView(raw);
        const length = binary ? raw.byteLength : 0;
        if (!binary || !length || length > CHUNK || packet.sequence !== incoming.sequence || incoming.loaded + length > incoming.size) {
          this.incoming.delete(key);
          this._send(state, { op: 'DECLINE', id: packet.id, reason: 'Invalid file chunk.' });
          throw new Error('The incoming file stream failed validation.');
        }
        const chunk = raw instanceof ArrayBuffer ? raw : raw.buffer.slice(raw.byteOffset, raw.byteOffset + length);
        incoming.chunks.push(chunk);
        incoming.loaded += chunk.byteLength;
        incoming.sequence++;
        incoming.updated = Date.now();
        this._progress(incoming, 'receive');
        return;
      }
      if (packet.op === 'FINISH' && incoming?.accepted && incoming.type === 'file') {
        if (incoming.loaded !== incoming.size || incoming.sequence !== packet.chunks) throw new Error('The incoming file is incomplete.');
        this.incoming.delete(key);
        const blob = new Blob(incoming.chunks, { type: incoming.mime });
        this._emit('received', { ...this._detail(incoming), blob });
        this._send(state, { op: 'ACK', id: incoming.id });
        this._progress(incoming, 'receive', true);
        return;
      }
      if (packet.op === 'ACK' && outgoing && (outgoing.type !== 'file' || outgoing.finished)) {
        this.outgoing.delete(key);
        this._progress(outgoing, 'send', true);
        if (outgoing.type === 'prank') this._emit('prank-result', { id: outgoing.id, peerId, prankId: outgoing.prankId, accepted: true });
        outgoing.resolve(this._detail(outgoing));
      }
    }
    _ready(state, kind, secret) {
      state.ready = true;
      state.kind = kindOf(kind);
      state.secret = secret;
      this._emit('connected', this._contact(state));
    }
    _contact(state) { return { peerId: state.conn.peer, identity: state.identity, kind: state.kind, secret: state.secret }; }
    _detail(item) {
      const { id, peerId, identity, kind, type, name, size, mime, text, prankId } = item;
      return { id, peerId, identity, kind, type, name, size, mime, text, prankId };
    }
    _offer(state, packet) {
      const peerId = state.conn.peer;
      if (!/^[a-f0-9]{48}$/.test(packet.id || '')) return;
      const key = `${peerId}:${packet.id}`;
      if (this.incoming.has(key)) return;
      const type = packet.type === 'FILE_TRANSFER' ? 'file' : packet.type === 'CLIPBOARD_SYNC' ? 'clipboard' : ['DAILY_PRANK', 'PRANK_PAYLOAD'].includes(packet.type) ? 'prank' : null;
      const text = typeof packet.text === 'string' ? packet.text : '';
      const allowedPranks = ['airhorn', 'confetti', 'bsod', 'cat', 'jumpscare'];
      const reservedBytes = Array.from(this.incoming.values()).reduce((total, item) => total + (item.type === 'file' ? item.size : 0), 0);
      if (!type || this.incoming.size >= MAX_PENDING || (type === 'file' && (!Number.isSafeInteger(packet.size) || packet.size < 0 || packet.size > MAX_FILE || reservedBytes + packet.size > 2 * MAX_FILE)) || (type === 'clipboard' && byteLength(text) > MAX_TEXT) || (type === 'prank' && !allowedPranks.includes(packet.prankId))) {
        this._send(state, { op: 'DECLINE', id: packet.id, reason: 'Unsupported transfer or size limit exceeded (100 MB/file, 64 KB/text).' });
        return;
      }
      const item = { id: packet.id, peerId, identity: state.identity, kind: state.kind, type, name: type === 'file' ? clean(packet.name, 180).split(/[\\/]/).pop() || 'download' : type === 'clipboard' ? 'Clipboard text' : 'Daily prank', size: type === 'file' ? packet.size : type === 'clipboard' ? byteLength(text) : 1, mime: clean(packet.mime, 100), text: type === 'clipboard' ? text : undefined, prankId: type === 'prank' ? packet.prankId : undefined, chunks: [], loaded: 0, sequence: 0, accepted: false, updated: Date.now() };
      this.incoming.set(key, item);
      const decline = reason => {
        if (!this.incoming.has(key)) return;
        this.incoming.delete(key);
        this._send(state, { op: 'DECLINE', id: item.id, reason: typeof reason === 'string' ? clean(reason, 200) : 'Transfer declined.' });
      };
      const accept = () => {
        if (!this.incoming.has(key) || item.accepted) return;
        item.accepted = true;
        item.updated = Date.now();
        if (type === 'file') {
          this._send(state, { op: 'ACCEPT', id: item.id });
          this._progress(item, 'receive');
        } else {
          this.incoming.delete(key);
          this._emit('received', this._detail(item));
          this._send(state, { op: 'ACK', id: item.id });
        }
      };
      this._emit('incoming-transfer', { ...this._detail(item), accept, decline });
    }
    _state(peerId) {
      const state = this.connections.get(peerId);
      if (!state?.ready || !state.conn.open) throw new Error('This device is offline or has not approved pairing.');
      return state;
    }
    _transfer(peerId, payload, file) {
      const state = this._state(peerId);
      if (this.outgoing.size >= MAX_PENDING) return Promise.reject(new Error('Too many pending transfers. Wait for a transfer to finish.'));
      const id = random();
      const key = `${peerId}:${id}`;
      return new Promise((resolve, reject) => {
        const item = { ...payload, id, peerId, identity: state.identity, kind: state.kind, file, loaded: 0, updated: Date.now(), resolve, reject, accepted: false };
        this.outgoing.set(key, item);
        try {
          const type = payload.type === 'file' ? 'FILE_TRANSFER' : payload.type === 'clipboard' ? 'CLIPBOARD_SYNC' : 'DAILY_PRANK';
          this._send(state, { ...payload, type, op: 'OFFER', id, timestamp: Date.now() });
          this._progress(item, 'send');
        } catch (error) { this._failOutgoing(key, error); }
      });
    }
    async sendFiles(peerId, files) {
      const list = Array.from(files || []);
      if (!list.length) throw new Error('Choose at least one file.');
      if (list.some(file => !(file instanceof Blob) || file.size > MAX_FILE)) throw new Error('Each file must be 100 MB or smaller.');
      const results = [];
      for (const file of list) results.push(await this._transfer(peerId, { type: 'file', name: clean(file.name || 'download', 180), size: file.size, mime: clean(file.type, 100) }, file));
      return results;
    }
    async sendClipboard(peerId, text) {
      if (typeof text !== 'string' || !text.length || byteLength(text) > MAX_TEXT) throw new Error('Clipboard text must contain 1–65,536 bytes.');
      return this._transfer(peerId, { type: 'clipboard', text, name: 'Clipboard text', size: byteLength(text) });
    }
    async sendPrank(peerId, prankId) {
      if (!['airhorn', 'confetti', 'bsod', 'cat', 'jumpscare'].includes(prankId)) throw new Error('Choose a supported prank.');
      return this._transfer(peerId, { type: 'prank', prankId, name: 'Daily prank', size: 1 });
    }
    async _stream(state, item) {
      const key = `${item.peerId}:${item.id}`;
      let sequence = 0;
      while (item.loaded < item.size) {
        while ((state.conn.dataChannel?.bufferedAmount || 0) > 512 * 1024 || (state.conn.bufferSize || 0) > 4) {
          if (!state.conn.open || !this.outgoing.has(key)) throw new Error('Transfer cancelled or disconnected.');
          if (Date.now() - item.updated > TIMEOUT) throw new Error('The transfer stalled. Try again.');
          await delay(20);
        }
        if (!this.outgoing.has(key)) return;
        const buffer = await item.file.slice(item.loaded, item.loaded + CHUNK).arrayBuffer();
        this._send(state, { op: 'CHUNK', id: item.id, sequence, buffer });
        item.loaded += buffer.byteLength;
        item.updated = Date.now();
        sequence++;
        this._progress(item, 'send');
      }
      item.finished = true;
      this._send(state, { op: 'FINISH', id: item.id, chunks: sequence });
    }
    _progress(item, direction, complete = false) {
      const now = Date.now();
      if (!complete && item.lastProgress && now - item.lastProgress < 80) return;
      item.lastProgress = now;
      this._emit('progress', { id: item.id, peerId: item.peerId, type: item.type, name: item.name, direction, loaded: complete ? item.size : item.loaded, total: item.size, percent: complete ? 100 : item.size ? Math.min(99, Math.floor(item.loaded / item.size * 100)) : 0, complete });
    }
    _failOutgoing(key, error) {
      const item = this.outgoing.get(key);
      if (!item) return;
      this.outgoing.delete(key);
      item.reject(error);
    }
    _closed(state) {
      if (this.connections.get(state.conn.peer) !== state) return;
      this.connections.delete(state.conn.peer);
      for (const [key, item] of this.outgoing) if (item.peerId === state.conn.peer) this._failOutgoing(key, new Error('The other device disconnected.'));
      for (const [key, item] of this.incoming) if (item.peerId === state.conn.peer) this.incoming.delete(key);
      this._emit('disconnected', { peerId: state.conn.peer });
    }
    _prune() {
      const now = Date.now();
      for (const state of this.connections.values()) if (!state.ready && now - state.created > 60000) {
        this._error('Pairing timed out. Check that both devices are online; restrictive networks may require TURN.', { peerId: state.conn.peer });
        state.conn.close();
        this._closed(state);
      }
      for (const [key, item] of this.outgoing) if (now - item.updated > TIMEOUT) this._failOutgoing(key, new Error('Transfer timed out. Ask the other device to try again.'));
      for (const [key, item] of this.incoming) if (now - item.updated > TIMEOUT) {
        this.incoming.delete(key);
        try { this._send(this._state(item.peerId), { op: 'DECLINE', id: item.id, reason: 'Transfer timed out.' }); } catch (_) { /* Already disconnected. */ }
        this._error('Incoming transfer expired.', { id: item.id, peerId: item.peerId });
      }
    }
    updateIdentity(identity) {
      this.identity = { ...identityOf({ ...this.identity, ...identity }), id: this.identity.id };
      for (const state of this.connections.values()) if (state.ready) this._send(state, { op: 'IDENTITY', identity: this.identity });
    }
    disconnect(peerId) {
      const state = this.connections.get(peerId);
      if (state) { state.conn.close(); this._closed(state); }
    }
    // The caller removes the saved getTrust record before revoking the live connection.
    revoke(peerId) { this.disconnect(peerId); }
    destroy() {
      this.destroyed = true;
      clearInterval(this.sweep);
      clearTimeout(this.reconnectTimer);
      for (const state of this.connections.values()) { state.conn.close(); this._closed(state); }
      for (const key of this.outgoing.keys()) this._failOutgoing(key, new Error('Connection shut down.'));
      this.incoming.clear();
      this.peer?.destroy();
      this.online = false;
    }
    static generatePairURL(base, peerId, kind = 'own') {
      const url = new URL(base);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('For phone pairing, serve NotchDrop over HTTPS and enter its public address. A local file URL cannot open on your phone.');
      if (!validId(peerId)) throw new Error('Invalid device ID.');
      url.hash = '';
      url.search = '';
      url.searchParams.set('pair', peerId);
      url.searchParams.set('kind', kindOf(kind));
      return url.href;
    }
    generatePairURL(base, kind = 'own') { return NotchPeer.generatePairURL(base, this.identity.id, kind); }
    static renderQR(container, url) {
      container.replaceChildren();
      if (typeof window.QRCode !== 'function') throw new Error('QR generator is unavailable offline. Share the pairing link or device ID instead.');
      return new window.QRCode(container, { text: url, width: 192, height: 192, colorDark: '#101219', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
    }
    renderQR(container, url) { return NotchPeer.renderQR(container, url); }
  }
  NotchPeer.MAX_FILE_SIZE = MAX_FILE;
  NotchPeer.MAX_TEXT_SIZE = MAX_TEXT;
  window.NotchPeer = NotchPeer;
})();
