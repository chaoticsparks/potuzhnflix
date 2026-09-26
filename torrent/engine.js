// engine.js — torrent download + local HTTP streaming with Range support
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import WebTorrent from 'webtorrent';

const VIDEO_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ogv': 'video/ogg',
};

export const DEFAULT_CACHE_DIR = path.join(os.tmpdir(), 'tvbox-cache');

export class TorrentEngine extends EventEmitter {
  constructor({ cacheDir = DEFAULT_CACHE_DIR, statusIntervalMs = 1000 } = {}) {
    super();
    this.cacheDir = cacheDir;
    this.statusIntervalMs = statusIntervalMs;
    this.client = new WebTorrent();
    this.client.on('error', (err) => this.emit('error', err));
    this.torrent = null;
    this.file = null;
    this.server = null;
  }

  // Add a magnet link, .torrent path or info hash; resolves once metadata is known
  async open(torrentId) {
    await this.close();
    // Start with nothing selected, so only the chosen video file gets downloaded
    const torrent = this.client.add(torrentId, { path: this.cacheDir, deselect: true });
    this.torrent = torrent;

    await new Promise((resolve, reject) => {
      torrent.once('ready', resolve);
      torrent.once('error', reject);
    });

    const file = pickVideoFile(torrent.files);
    if (!file) throw new Error('No video file found in torrent');
    file.select();
    this.file = file;

    this.timer = setInterval(() => this.emit('status', this.status()), this.statusIntervalMs);
    return { name: file.name, length: file.length, infoHash: torrent.infoHash };
  }

  // Serve the selected file on 127.0.0.1; returns the URL for mpv
  async serve(port = 0) {
    if (!this.file) throw new Error('No torrent opened');
    if (!this.server) {
      this.server = http.createServer((req, res) => this.#handle(req, res));
      await new Promise((resolve) => this.server.listen(port, '127.0.0.1', resolve));
    }
    const { port: actual } = this.server.address();
    return `http://127.0.0.1:${actual}/${encodeURIComponent(this.file.name)}`;
  }

  #handle(req, res) {
    const file = this.file;
    if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(file ? 405 : 404).end();
      return;
    }

    const size = file.length;
    const type = VIDEO_TYPES[path.extname(file.name).toLowerCase()] ?? 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
    let start = 0;
    let end = size - 1;

    const range = parseRange(req.headers.range, size);
    if (range === 'invalid') {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    if (range) {
      ({ start, end } = range);
      res.statusCode = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    } else {
      res.statusCode = 200;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(res.statusCode, headers);
    if (req.method === 'HEAD') { res.end(); return; }

    // Reading a range makes WebTorrent prioritise the pieces it needs,
    // so seeking in mpv moves the download position automatically
    const stream = file.createReadStream({ start, end });
    stream.pipe(res);
    const cleanup = () => stream.destroy();
    res.on('close', cleanup);
    stream.on('error', () => res.destroy());
  }

  status() {
    const t = this.torrent;
    if (!t) return null;
    return {
      name: this.file?.name ?? t.name,
      progress: this.file?.progress ?? 0,   // 0..1, selected file only
      downloaded: this.file?.downloaded ?? 0,
      length: this.file?.length ?? 0,
      downloadSpeed: t.downloadSpeed,       // bytes/s
      uploadSpeed: t.uploadSpeed,
      peers: t.numPeers,
    };
  }

  async close() {
    clearInterval(this.timer);
    if (this.torrent) {
      const t = this.torrent;
      this.torrent = null;
      this.file = null;
      await new Promise((resolve) => t.destroy({ destroyStore: false }, resolve));
    }
  }

  async destroy() {
    await this.close();
    if (this.server) {
      this.server.closeAllConnections?.();
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }
    await new Promise((resolve) => this.client.destroy(resolve));
  }
}

// Largest file with a known video extension
function pickVideoFile(files) {
  return files
    .filter((f) => VIDEO_TYPES[path.extname(f.name).toLowerCase()])
    .sort((a, b) => b.length - a.length)[0];
}

// Single-range "bytes=a-b" / "bytes=a-" / "bytes=-n"; null when absent
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start, end;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}
