// player.js — mpv control over JSON IPC
import { spawn } from 'node:child_process';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const isWin = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Observed mpv properties and their names in our state
const OBSERVED = {
  'pause': 'paused',
  'time-pos': 'position',
  'duration': 'duration',
  'volume': 'volume',
  'idle-active': 'idle',
  'media-title': 'title',
  'paused-for-cache': 'buffering',
};

// Raspberry Pi: output straight to HDMI, no desktop
export const PI_ARGS = ['--vo=gpu', '--gpu-context=drm', '--fs'];

export class MpvPlayer extends EventEmitter {
  constructor({ extraArgs = [], socketPath, mpvPath = 'mpv' } = {}) {
    super();
    this.mpvPath = mpvPath;
    this.extraArgs = extraArgs;
    this.socketPath = socketPath ??
      (isWin ? '\\\\.\\pipe\\tvbox-mpv' : path.join(os.tmpdir(), 'tvbox-mpv.sock'));
    this.reqId = 0;
    this.pending = new Map();
    this.state = {
      paused: false, position: 0, duration: 0, volume: 100,
      idle: true, title: null, buffering: false,
    };
  }

  async start() {
    if (!isWin && fs.existsSync(this.socketPath)) fs.unlinkSync(this.socketPath);
    const args = [
      '--idle=yes',          // stay open when nothing is playing
      '--force-window=yes',  // keep the window open
      '--no-terminal',
      '--hwdec=auto-safe',   // hardware decoding where possible
      `--input-ipc-server=${this.socketPath}`,
      ...this.extraArgs,
    ];
    this.proc = spawn(this.mpvPath, args, { stdio: 'ignore' });
    this.proc.on('error', (err) => {
      this.startError = err;
      if (this.listenerCount('error')) this.emit('error', err);
    });
    this.proc.on('exit', (code) => {
      this.socket?.destroy();
      this.emit('exit', code);
    });

    await this.#connect();
    const names = Object.keys(OBSERVED);
    for (let i = 0; i < names.length; i++) {
      await this.command('observe_property', i + 1, names[i]);
    }
  }

  async #connect() {
    for (let attempt = 0; attempt < 50 && !this.socket; attempt++) {
      if (this.startError) throw new Error(`Не удалось запустить mpv: ${this.startError.message}`);
      try {
        this.socket = await new Promise((resolve, reject) => {
          const s = net.createConnection(this.socketPath);
          s.once('connect', () => resolve(s));
          s.once('error', reject);
        });
      } catch {
        await sleep(100);
      }
    }
    if (!this.socket) throw new Error('mpv не открыл IPC-сокет');

    this.socket.setEncoding('utf8');
    this.socket.on('error', () => {});
    let buf = '';
    this.socket.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try { this.#handle(JSON.parse(line)); } catch { /* skip malformed line */ }
      }
    });
    this.socket.on('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('Соединение с mpv закрыто'));
      this.pending.clear();
    });
  }

  #handle(msg) {
    // Reply to one of our commands
    if (msg.request_id && this.pending.has(msg.request_id)) {
      const { resolve, reject } = this.pending.get(msg.request_id);
      this.pending.delete(msg.request_id);
      if (msg.error === 'success') resolve(msg.data);
      else reject(new Error(`mpv: ${msg.error}`));
      return;
    }
    // An observed property changed
    if (msg.event === 'property-change') {
      const key = OBSERVED[msg.name];
      if (!key) return;
      const numeric = key === 'position' || key === 'duration';
      this.state[key] = msg.data ?? (numeric ? 0 : null);
      this.emit('state', { ...this.state });
      return;
    }
    // Other events: file-loaded, end-file, seek, etc.
    if (msg.event) this.emit(msg.event, msg);
  }

  command(...args) {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('mpv не запущен'));
    const id = ++this.reqId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(JSON.stringify({ command: args, request_id: id }) + '\n');
    });
  }

  getProperty(name) { return this.command('get_property', name); }
  setProperty(name, value) { return this.command('set_property', name, value); }

  // --- Playback control ---
  async load(url, { title } = {}) {
    await this.setProperty('force-media-title', title ?? '');
    return this.command('loadfile', url, 'replace');
  }
  play() { return this.setProperty('pause', false); }
  pause() { return this.setProperty('pause', true); }
  togglePause() { return this.command('cycle', 'pause'); }
  seekBy(seconds) { return this.command('seek', seconds, 'relative'); }
  seekTo(seconds) { return this.command('seek', seconds, 'absolute'); }
  setVolume(v) { return this.setProperty('volume', Math.max(0, Math.min(100, v))); }
  changeVolume(delta) { return this.setVolume((this.state.volume ?? 100) + delta); }
  stop() { return this.command('stop'); }

  // --- Tracks ---
  async tracks() {
    const list = (await this.getProperty('track-list')) ?? [];
    const pick = (type) => list
      .filter((t) => t.type === type)
      .map((t) => ({
        id: t.id, lang: t.lang ?? '', title: t.title ?? '',
        codec: t.codec ?? '', selected: !!t.selected,
      }));
    return { audio: pick('audio'), subtitles: pick('sub') };
  }
  setAudioTrack(id) { return this.setProperty('aid', id); }
  setSubtitleTrack(id) { return this.setProperty('sid', id ?? 'no'); }

  async quit() {
    try { await this.command('quit'); } catch { /* mpv already closed */ }
  }
}
