// engine.js — WebTorrent wrapper: several torrents at once, per-file selection, local HTTP streaming
//
// Disk layout under `dir`:
//   data/<infoHash>/<paths from the torrent>   downloaded files
//   torrents/<infoHash>.torrent                saved metadata, so re-adding needs no network
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import WebTorrent from 'webtorrent';
import parseTorrent from 'parse-torrent';

export const VIDEO_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ogv': 'video/ogg',
};

const METADATA_TIMEOUT_MS = 90 * 1000;

export const DEFAULT_CACHE_DIR =process.env.TVBOX_CACHE ?? path.join(os.tmpdir(), 'tvbox-cache');

export class TorrentEngine extends EventEmitter {
  constructor({ dir = DEFAULT_CACHE_DIR } = {}) {
    super();
    this.dataDir = path.join(dir, 'data');
    this.torrentsDir = path.join(dir, 'torrents');
    this.client = new WebTorrent();
    this.client.on('error', (err) => this.emit('error', err));
    this.adding = new Map();     // infoHash → Promise<Torrent> while metadata is loading
    this.selected = new Map();   // infoHash → Set of selected file indexes
    this.server = null;
  }

  // Magnet, info hash, .torrent URL / path or Buffer → ready Torrent (reuses a loaded one)
  async add(source) {
    const { id, infoHash } = await this.#resolve(source);
    const loaded = this.get(infoHash);
    if (loaded) return loaded;
    if (!this.adding.has(infoHash)) {
      const p = this.#add(id, infoHash).finally(() => this.adding.delete(infoHash));
      this.adding.set(infoHash, p);
    }
    return this.adding.get(infoHash);
  }

  // Loaded torrent with metadata, or null
  get(infoHash) {
    return this.client.torrents.find((t) => t.infoHash === infoHash && t.ready) ?? null;
  }

  // Makes exactly these files of a loaded torrent download; everything else in it stops
  setSelection(infoHash, indexes) {
    const torrent = this.get(infoHash);
    if (!torrent) return;
    const want = new Set(indexes);
    const have = this.selected.get(infoHash) ?? new Set();
    if (want.size === have.size && [...want].every((i) => have.has(i))) return;
    // Deselect first: neighbouring files can share a boundary piece
    for (const i of have) torrent.files[i]?.deselect();
    for (const i of want) torrent.files[i]?.select();
    this.selected.set(infoHash, want);
  }

  fileStats(infoHash, index) {
    const file = this.get(infoHash)?.files[index];
    if (!file) return null;
    return { downloaded: file.downloaded, length: file.length, progress: file.progress, done: file.done };
  }

  torrentStats(infoHash) {
    const t = this.get(infoHash);
    return t ? { downloadSpeed: t.downloadSpeed, uploadSpeed: t.uploadSpeed, peers: t.numPeers } : null;
  }

  // Stops a torrent (loaded or still fetching metadata); files stay on disk
  async remove(infoHash) {
    this.selected.delete(infoHash);
    const torrent = this.client.torrents.find((t) => t.infoHash === infoHash);
    if (torrent) await new Promise((resolve) => torrent.destroy({ destroyStore: false }, resolve));
  }

  // Absolute path of a file inside a torrent's data folder
  filePath(infoHash, relPath) {
    return path.join(this.dataDir, infoHash, relPath);
  }

  // Deletes a whole torrent's data and metadata (call remove() first)
  async deleteTorrentData(infoHash) {
    await fs.rm(path.join(this.dataDir, infoHash), { recursive: true, force: true, maxRetries: 5 });
    await fs.rm(path.join(this.torrentsDir, `${infoHash}.torrent`), { force: true });
  }

  // Starts the local HTTP server once; returns the stream URL for a file
  async streamUrl(infoHash, index) {
    if (!this.server) {
      this.server = http.createServer((req, res) => this.#handle(req, res));
      await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    }
    const file = this.get(infoHash)?.files[index];
    if (!file) throw new Error('Torrent is not loaded');
    const { port } = this.server.address();
    return `http://127.0.0.1:${port}/${infoHash}/${index}/${encodeURIComponent(file.name)}`;
  }

  async destroy() {
    if (this.server) {
      this.server.closeAllConnections?.();
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }
    await new Promise((resolve) => this.client.destroy(resolve));
  }

  async #resolve(source) {
    let id = source;
    if (typeof source === 'string' && /^https?:\/\//i.test(source)) {
      const res = await fetch(source, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`Could not download .torrent: HTTP ${res.status}`);
      id = Buffer.from(await res.arrayBuffer());
    } else if (typeof source === 'string' && !/^magnet:/i.test(source) && !/^[a-f0-9]{40}$|^[a-z2-7]{32}$/i.test(source)) {
      id = await fs.readFile(source);
    }
    const { infoHash } = await parseTorrent(id);

    // Prefer saved metadata: works offline and skips the magnet metadata wait
    const saved = await fs.readFile(path.join(this.torrentsDir, `${infoHash}.torrent`)).catch(() => null);
    return { id: saved ?? id, infoHash };
  }

  async #add(id, infoHash) {
    // Start with nothing selected; setSelection() decides what downloads
    const torrent = this.client.add(id, { path: path.join(this.dataDir, infoHash), deselect: true });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Could not get torrent metadata: no peers found'));
        torrent.destroy();
      }, METADATA_TIMEOUT_MS);
      const done = (fn) => (arg) => { clearTimeout(timer); fn(arg); };
      torrent.once('ready', done(resolve));
      torrent.once('error', done(reject));
      // remove() destroyed it before metadata arrived
      torrent.once('close', done(() => reject(new Error('Torrent closed'))));
    });

    torrent.files.forEach((file, index) => {
      if (!file.done) file.once('done', () => this.emit('file-done', infoHash, index));
    });

    const saved = path.join(this.torrentsDir, `${infoHash}.torrent`);
    await fs.mkdir(this.torrentsDir, { recursive: true });
    await fs.writeFile(saved, torrent.torrentFile, { flag: 'wx' }).catch((err) => {
      if (err.code !== 'EEXIST') throw err;
    });
    return torrent;
  }

  #handle(req, res) {
    const [, infoHash, index] = req.url.split('/');
    const file = this.get(infoHash)?.files[Number(index)];
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
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
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
  }
}

// Largest file with a known video extension
export function pickVideoFile(files) {
  return files
    .filter((f) => VIDEO_TYPES[path.extname(f.name).toLowerCase()])
    .sort((a, b) => b.length - a.length)[0];
}

// Match by path relative to the torrent root; multi-file torrents prefix paths with the torrent name
export function findFile(files, wanted) {
  const norm = (p) => p.replace(/\\/g, '/');
  const target = norm(wanted);
  return files.find((f) => norm(f.path) === target || norm(f.path).endsWith(`/${target}`));
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
