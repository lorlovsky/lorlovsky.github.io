/* Run with Node 22+: node --test tests/transport.cjs
 * Tests protocol behavior in memory. They do not claim to test real NAT traversal.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const registry = new Map();
class Connection extends EventEmitter {
  constructor(peer) {
    super();
    this.peer = peer;
    this.open = false;
    this.bufferSize = 0;
    this.dataChannel = { bufferedAmount: 0 };
  }
  send(packet) {
    if (!this.open) throw new Error('Connection closed');
    const message = structuredClone(packet);
    this.inspect?.(message);
    setImmediate(() => { if (this.other.open) this.other.emit('data', message); });
  }
  close() {
    if (!this.open) return;
    this.open = this.other.open = false;
    this.emit('close');
    this.other.emit('close');
  }
}
class MockPeer extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.open = false;
    registry.set(id, this);
    setImmediate(() => { this.open = true; this.emit('open', id); });
  }
  connect(id) {
    const remote = registry.get(id);
    const localConnection = new Connection(id);
    const remoteConnection = new Connection(this.id);
    localConnection.other = remoteConnection;
    remoteConnection.other = localConnection;
    setImmediate(() => {
      remote.emit('connection', remoteConnection);
      localConnection.open = remoteConnection.open = true;
      localConnection.emit('open');
      remoteConnection.emit('open');
    });
    return localConnection;
  }
  destroy() { this.destroyed = true; registry.delete(this.id); }
}
global.window = global;
global.Peer = MockPeer;
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'peer.js'), 'utf8'));

const until = async predicate => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Test timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

test('pairing, file integrity, acknowledgements and transfer validation', async t => {
  const trustA = new Map(), trustB = new Map();
  const a = new NotchPeer({ identity: { id: 'device-a', handle: 'Alice' }, getTrust: id => trustA.get(id) });
  const b = new NotchPeer({ identity: { id: 'device-b', handle: 'Bob' }, getTrust: id => trustB.get(id) });
  const errors = [], received = [], progress = [];
  let pairing, requests = 0, response = 'accept';
  a.addEventListener('connected', event => trustA.set(event.detail.peerId, event.detail));
  b.addEventListener('connected', event => trustB.set(event.detail.peerId, event.detail));
  b.addEventListener('pairing-request', event => { pairing = event.detail; requests++; });
  for (const peer of [a, b]) peer.addEventListener('error', event => errors.push(event.detail.message));
  a.addEventListener('progress', event => progress.push(event.detail));
  b.addEventListener('incoming-transfer', event => {
    if (response === 'accept') event.detail.accept();
    if (response === 'decline') event.detail.decline();
  });
  b.addEventListener('received', event => received.push(event.detail));
  t.after(() => { a.destroy(); b.destroy(); });
  a.start(); b.start();
  await until(() => a.online && b.online);

  await t.test('a new connection requires explicit consent and local roles stay independent', async () => {
    a.connect('device-b', 'own');
    await until(() => pairing);
    assert.equal(a.connections.get('device-b').ready, false);
    await assert.rejects(a.sendClipboard('device-b', 'not yet'), /approved pairing/);
    pairing.accept('friend');
    await until(() => a.connections.get('device-b')?.ready && b.connections.get('device-a')?.ready);
    assert.equal(a.connections.get('device-b').kind, 'own');
    assert.equal(b.connections.get('device-a').kind, 'friend');
    assert.equal(trustA.get('device-b').secret, trustB.get('device-a').secret);
    assert.equal(requests, 1);
  });

  await t.test('multiple binary chunks preserve all bytes and complete only after ACK', async () => {
    const bytes = Uint8Array.from({ length: 180000 }, (_, i) => i % 251);
    const file = new Blob([bytes], { type: 'application/octet-stream' });
    file.name = 'sample.bin';
    let chunkCount = 0, ackSeen = false;
    a.connections.get('device-b').conn.inspect = packet => { if (packet.op === 'CHUNK') chunkCount++; };
    b.connections.get('device-a').conn.inspect = packet => { if (packet.op === 'ACK') ackSeen = true; };
    await a.sendFiles('device-b', [file]);
    assert.equal(chunkCount, 3);
    assert.equal(ackSeen, true);
    assert.deepEqual(new Uint8Array(await received.at(-1).blob.arrayBuffer()), bytes);
    assert.equal(progress.at(-1).complete, true);
    assert.equal(a.outgoing.size, 0);
    assert.equal(b.incoming.size, 0);
  });

  await t.test('empty files, Unicode clipboard and prank packets round-trip', async () => {
    const file = new Blob([]); file.name = 'empty.txt';
    await a.sendFiles('device-b', [file]);
    assert.equal(received.at(-1).blob.size, 0);
    const text = '<b>plain text</b> — Grüezi 🌍';
    await a.sendClipboard('device-b', text);
    assert.equal(received.at(-1).text, text);
    await a.sendPrank('device-b', 'confetti');
    assert.equal(received.at(-1).prankId, 'confetti');
  });

  await t.test('PeerJS typed-array chunks respect their backing-buffer offset and length', async () => {
    const bytes = Uint8Array.from({ length: 70003 }, (_, i) => (i * 7) % 251);
    a.connections.get('device-b').conn.inspect = packet => {
      if (packet.op !== 'CHUNK') return;
      const original = new Uint8Array(packet.buffer);
      const pooled = new Uint8Array(original.length + 33);
      pooled.fill(255);
      pooled.set(original, 17);
      packet.buffer = pooled.subarray(17, 17 + original.length);
    };
    const file = new Blob([bytes]); file.name = 'offset-view.bin';
    await a.sendFiles('device-b', [file]);
    assert.deepEqual(new Uint8Array(await received.at(-1).blob.arrayBuffer()), bytes);
    a.connections.get('device-b').conn.inspect = null;
  });

  await t.test('declined content is never delivered and byte limits are enforced', async () => {
    response = 'decline';
    const before = received.length;
    await assert.rejects(a.sendClipboard('device-b', 'decline me'), /declined/);
    assert.equal(received.length, before);
    await assert.rejects(a.sendClipboard('device-b', '🌍'.repeat(16385)), /65,536/);
    await assert.rejects(a.sendPrank('device-b', 'unknown'), /supported prank/);
  });

  await t.test('disconnect rejects pending transfers and reconnect authenticates without another prompt', async () => {
    response = 'pending';
    const pending = a.sendClipboard('device-b', 'disconnect test');
    const rejection = assert.rejects(pending, /disconnected/);
    await until(() => b.incoming.size === 1);
    a.disconnect('device-b');
    await rejection;
    assert.equal(a.outgoing.size, 0);
    assert.equal(b.incoming.size, 0);
    a.connect('device-b', 'own');
    await until(() => a.connections.get('device-b')?.ready && b.connections.get('device-a')?.ready);
    assert.equal(requests, 1);
    assert.deepEqual(errors, []);
  });

  await t.test('out-of-order file chunks terminate transfer without exposing a partial file', async () => {
    response = 'accept';
    const before = received.length;
    a.connections.get('device-b').conn.inspect = packet => { if (packet.op === 'CHUNK') packet.sequence = 99; };
    const file = new Blob(['malformed stream']); file.name = 'invalid.txt';
    await assert.rejects(a.sendFiles('device-b', [file]), /disconnected|validation/);
    assert.equal(received.length, before);
    assert.equal(b.incoming.size, 0);
    assert.ok(errors.some(message => /validation/.test(message)));
  });

  await t.test('QR links use a real web address and keep pairing fields only', () => {
    assert.equal(NotchPeer.generatePairURL('https://example.test/app/?old=x#x', 'device-a'), 'https://example.test/app/?pair=device-a&kind=own');
    assert.throws(() => NotchPeer.generatePairURL('file:///a/index.html', 'device-a'), /HTTPS/);
  });
});
