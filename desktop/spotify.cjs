'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

class WindowsSpotify {
  constructor() { this.child = null; this.requests = new Map(); this.sequence = 0; }
  start() {
    if (this.child) return;
    if (process.platform !== 'win32') throw new Error('Spotify desktop controls require Windows 10 or 11.');
    const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'spotify-session.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let lastError = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', data => { lastError = (lastError + data).slice(-1000); });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      try {
        const message = JSON.parse(line), pending = this.requests.get(message.id);
        if (!pending) return;
        this.requests.delete(message.id); clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.state); else pending.reject(new Error(message.error || 'Spotify request failed.'));
      } catch { /* Ignore nonprotocol startup output. */ }
    });
    const fail = error => {
      if (this.child !== child) return;
      this.child = null;
      for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.requests.clear(); lines.close();
    };
    child.on('error', error => fail(error));
    child.on('exit', () => fail(new Error(lastError || 'Windows media connection closed. Try connecting Spotify again.')));
    child.stdin.on('error', error => fail(error));
  }
  request(action, position) {
    if (!['status', 'toggle', 'next', 'previous', 'seek'].includes(action)) return Promise.reject(new Error('Unsupported Spotify action.'));
    if (action === 'seek' && (!Number.isFinite(position) || position < 0 || position > 604800)) return Promise.reject(new Error('Invalid seek position.'));
    if (this.requests.size >= 8) return Promise.reject(new Error('Wait for the previous Spotify action.'));
    try { this.start(); } catch (error) { return Promise.reject(error); }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error('Spotify is taking too long to respond.')); }, 10000);
      this.requests.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, action, position }) + '\n');
    });
  }
  stop() {
    for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(new Error('Spotify connection closed.')); }
    this.requests.clear();
    if (this.child) { const child = this.child; this.child = null; child.stdin.end(); setTimeout(() => { if (child.exitCode === null) child.kill(); }, 500).unref(); }
  }
}
module.exports = WindowsSpotify;
