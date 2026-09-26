// library.js — downloads that survive restarts: add, pause/resume, delete, keep, auto-cleanup
//
// An item is one video file inside one torrent. Several items may share a torrent
// (e.g. 1080p and 480p versions from the same Internet Archive item).
// While something plays, all other downloads are paused so the stream gets the bandwidth.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { TorrentEngine, DEFAULT_CACHE_DIR, pickVideoFile, findFile } from '../torrent/engine.js';

const DAY = 24 * 60 * 60 * 1000;
const GB = 1024 ** 3;

export const DEFAULT_POLICY = {
  completedDays: 30,             // finished films: deleted this long after last watched (or finished)
  unfinishedDays: 7,             // unfinished downloads: deleted after this long without progress or use
  minFreeBytes: 5 * GB,          // disk space to keep free; least recently used items go first
  sweepIntervalMs: 10 * 60 * 1000,
};

export class Library extends EventEmitter {
  constructor({ dir = DEFAULT_CACHE_DIR, policy = {} } = {}) {
    super();
    this.dir = dir;
    this.file = path.join(dir, 'library.json');
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.engine = new TorrentEngine({ dir });
    this.engine.on('error', (err) => this.emit('error', err));
    this.engine.on('file-done', (infoHash, index) => this.#onFileDone(`${infoHash}-${index}`));
    this.items = new Map();
    this.playing = null;           // id of the item being played
    this.claims = new Set();       // adds in progress: { infoHash }
    this.syncing = Promise.resolve();
    this.saveTimer = null;
  }

  async load() {
    await fs.mkdir(this.dir, { recursive: true });
    const json = await fs.readFile(this.file, 'utf8').catch((err) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    });
    let saved = [];
    try {
      // Strip a BOM (Windows editors add one)
      if (json) saved = JSON.parse(json.replace(/^﻿/, '')).items;
    } catch (err) {
      // Refuse to start: with an empty library every download would be deleted as an orphan
      throw new Error(`${this.file} is corrupt (${err.message}). Fix or delete it.`);
    }
    for (const item of saved) this.items.set(item.id, item);

    await this.#deleteOrphans();
    await this.cleanup();
    this.#sync();

    // Refresh progress once a second; sweep for expired items / low disk periodically
    this.ticker = setInterval(() => this.#tick(), 1000);
    this.sweeper = setInterval(() => this.cleanup().catch((err) => this.emit('error', err)), this.policy.sweepIntervalMs);
  }

  // Starts (or reuses) a download; resolves once torrent metadata is known
  async add(request) {
    const claim = { infoHash: null };   // keeps #doSync from stopping the torrent before the item exists
    this.claims.add(claim);
    try {
      return await this.#add(request, claim);
    } finally {
      this.claims.delete(claim);
      this.#sync();   // drops the torrent again if the add failed and nothing else needs it
    }
  }

  async #add({ torrent, file, title }, claim) {
    const t = await this.engine.add(torrent);
    claim.infoHash = t.infoHash;
    const f = file ? findFile(t.files, file) : pickVideoFile(t.files);
    if (!f) throw httpError(404, file ? `File not found in torrent: ${file}` : 'No video file found in torrent');
    const index = t.files.indexOf(f);
    const id = `${t.infoHash}-${index}`;
    const now = Date.now();

    let item = this.items.get(id);
    if (!item) {
      await this.#ensureSpace(f.length, id);
      item = {
        id,
        infoHash: t.infoHash,
        fileIndex: index,
        title: title || f.name,
        name: f.name,
        path: f.path,
        length: f.length,
        downloaded: 0,
        state: 'downloading',   // downloading | paused | complete
        keep: false,
        addedAt: now,
        completedAt: null,
        lastPlayedAt: null,
        lastActivityAt: now,
      };
      this.items.set(id, item);
    } else if (item.state === 'paused') {
      item.state = 'downloading';
      item.lastActivityAt = now;
    }

    await this.#sync();
    this.#changed();
    return this.view(item);
  }

  // Marks an item as playing and returns what mpv should open: a local path or a stream URL
  async stream(id) {
    const item = this.#get(id);
    const now = Date.now();
    item.lastPlayedAt = now;
    item.lastActivityAt = now;

    if (item.state === 'complete') {
      const local = this.engine.filePath(item.infoHash, item.path);
      const exists = await fs.stat(local).then((s) => s.size === item.length).catch(() => false);
      if (exists) {
        this.playing = id;
        await this.#sync();
        this.#changed();
        return local;
      }
      // File vanished from disk — download it again
      item.state = 'downloading';
      item.completedAt = null;
      item.downloaded = 0;
    } else if (item.state === 'paused') {
      item.state = 'downloading';
    }

    this.playing = id;
    await this.#sync();
    this.#changed();
    return this.engine.streamUrl(item.infoHash, item.fileIndex);
  }

  // Playback ended; other downloads continue. Ignored if a newer stream() took over.
  async release(id) {
    if (this.playing !== id) return;
    this.playing = null;
    await this.#sync();
    this.#changed();
  }

  async pause(id) {
    const item = this.#get(id);
    if (item.state !== 'downloading') return this.view(item);
    if (this.playing === id) throw httpError(409, 'Cannot pause the film that is playing');
    item.state = 'paused';
    item.lastActivityAt = Date.now();
    await this.#sync();
    this.#changed();
    return this.view(item);
  }

  async resume(id) {
    const item = this.#get(id);
    if (item.state !== 'paused') return this.view(item);
    await this.#ensureSpace(item.length - item.downloaded, id);
    item.state = 'downloading';
    item.lastActivityAt = Date.now();
    await this.#sync();
    this.#changed();
    return this.view(item);
  }

  // Kept items are never deleted automatically
  setKeep(id, keep) {
    const item = this.#get(id);
    item.keep = !!keep;
    this.#changed();
    return this.view(item);
  }

  async remove(id) {
    const item = this.#get(id);
    if (this.playing === id) throw httpError(409, 'Stop playback before deleting this film');
    this.items.delete(id);
    await this.#sync();

    const siblings = [...this.items.values()].some((i) => i.infoHash === item.infoHash);
    if (siblings) {
      // Other files of this torrent are still in use: delete only this one
      await fs.rm(this.engine.filePath(item.infoHash, item.path), { force: true, maxRetries: 5 }).catch(() => {});
    } else {
      await this.engine.deleteTorrentData(item.infoHash);
    }
    this.#changed();
  }

  // Deletes expired items, then least recently used ones while disk space is low
  async cleanup() {
    const now = Date.now();
    for (const item of [...this.items.values()]) {
      const expires = this.expiresAt(item);
      if (expires !== null && expires <= now && this.playing !== item.id) await this.remove(item.id);
    }
    await this.#ensureSpace(0).catch(() => {});   // not being able to free enough is not an error here
  }

  // When an item will be deleted automatically (ms timestamp), or null if never
  expiresAt(item) {
    if (item.keep) return null;
    if (item.state === 'complete') {
      return Math.max(item.completedAt ?? 0, item.lastPlayedAt ?? 0) + this.policy.completedDays * DAY;
    }
    return item.lastActivityAt + this.policy.unfinishedDays * DAY;
  }

  list() {
    return [...this.items.values()]
      .sort((a, b) => b.addedAt - a.addedAt)
      .map((item) => this.view(item));
  }

  get(id) {
    const item = this.items.get(id);
    return item ? this.view(item) : null;
  }

  // Public shape of an item, with live torrent stats
  view(item) {
    const stats = this.engine.torrentStats(item.infoHash);
    const active = item.state === 'downloading' && (!this.playing || this.playing === item.id);
    return {
      id: item.id,
      title: item.title,
      name: item.name,
      length: item.length,
      downloaded: item.downloaded,
      progress: item.length ? item.downloaded / item.length : 0,
      state: item.state,
      waiting: item.state === 'downloading' && !active,   // paused for now because another film plays
      playing: this.playing === item.id,
      keep: item.keep,
      downloadSpeed: active && stats ? stats.downloadSpeed : 0,
      peers: active && stats ? stats.peers : 0,
      addedAt: item.addedAt,
      completedAt: item.completedAt,
      lastPlayedAt: item.lastPlayedAt,
      expiresAt: this.expiresAt(item),
    };
  }

  async storage() {
    const { free, total } = await diskSpace(this.dir);
    const used = [...this.items.values()].reduce((sum, i) => sum + i.length, 0);
    return { dir: this.dir, free, total, used, policy: this.policy };
  }

  async close() {
    clearInterval(this.ticker);
    clearInterval(this.sweeper);
    await this.syncing;
    await this.#save();
    await this.engine.destroy();
  }

  #get(id) {
    const item = this.items.get(id);
    if (!item) throw httpError(404, `No such download: ${id}`);
    return item;
  }

  #onFileDone(id) {
    const item = this.items.get(id);
    if (!item || item.state === 'complete') return;
    const now = Date.now();
    item.state = 'complete';
    item.downloaded = item.length;
    item.completedAt = now;
    item.lastActivityAt = now;
    this.#sync();   // stops the torrent unless it is still being streamed
    this.#changed();
  }

  // Brings torrents in line with item states. Serialised, since adding a torrent is async.
  #sync() {
    this.syncing = this.syncing.then(() => this.#doSync()).catch((err) => this.emit('error', err));
    return this.syncing;
  }

  async #doSync() {
    const wanted = new Map();   // infoHash → file indexes that should download
    for (const item of this.items.values()) {
      const streaming = this.playing === item.id && item.state !== 'complete';
      const downloading = item.state === 'downloading' && !this.playing;
      if (!streaming && !downloading) continue;
      if (!wanted.has(item.infoHash)) wanted.set(item.infoHash, []);
      wanted.get(item.infoHash).push(item.fileIndex);
    }

    // Stop torrents nobody needs any more (keeps their files). Torrents still loading
    // metadata, or claimed by an add() in progress, are left alone.
    const claimed = new Set([...this.claims].map((c) => c.infoHash));
    for (const t of [...this.engine.client.torrents]) {
      if (!t.ready || claimed.has(t.infoHash) || wanted.has(t.infoHash)) continue;
      await this.engine.remove(t.infoHash);
    }

    for (const [infoHash, indexes] of wanted) {
      try {
        await this.engine.add(infoHash);
      } catch (err) {
        this.emit('error', new Error(`Could not load torrent ${infoHash}: ${err.message}`));
        continue;
      }
      this.engine.setSelection(infoHash, indexes);
      // Files already complete on disk (checked while the torrent was loading)
      for (const index of indexes) {
        if (this.engine.fileStats(infoHash, index)?.done) this.#onFileDone(`${infoHash}-${index}`);
      }
    }
  }

  // Refresh downloaded bytes; progress counts as activity for the unfinished-download timer
  #tick() {
    let changed = false;
    for (const item of this.items.values()) {
      if (item.state === 'complete') continue;
      const stats = this.engine.fileStats(item.infoHash, item.fileIndex);
      if (!stats || stats.downloaded === item.downloaded) continue;
      if (stats.downloaded > item.downloaded) item.lastActivityAt = Date.now();
      item.downloaded = stats.downloaded;
      changed = true;
    }
    if (changed) this.#changed();
  }

  // Frees space for `needed` more bytes plus what active downloads still have to fetch
  async #ensureSpace(needed, forId = null) {
    const remaining = [...this.items.values()]
      .filter((i) => i.state === 'downloading' && i.id !== forId)
      .reduce((sum, i) => sum + (i.length - i.downloaded), 0);
    const required = needed + remaining + this.policy.minFreeBytes;

    let { free } = await diskSpace(this.dir);
    if (free >= required) return;

    const candidates = [...this.items.values()]
      .filter((i) => !i.keep && i.id !== forId && i.id !== this.playing)
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt);
    for (const item of candidates) {
      if (free >= required) break;
      await this.remove(item.id);
      ({ free } = await diskSpace(this.dir));
    }
    if (free < required) {
      throw httpError(507, `Not enough disk space: need ${fmtGB(required)}, free ${fmtGB(free)}`);
    }
  }

  // Data and .torrent files not referenced by any item (e.g. a failed add, or a crash mid-delete)
  async #deleteOrphans() {
    const known = new Set([...this.items.values()].map((i) => i.infoHash));
    const dirs = await fs.readdir(this.engine.dataDir).catch(() => []);
    const metas = (await fs.readdir(this.engine.torrentsDir).catch(() => [])).map((n) => n.replace(/.torrent$/, ''));
    for (const infoHash of new Set([...dirs, ...metas])) {
      if (!known.has(infoHash)) await this.engine.deleteTorrentData(infoHash);
    }
  }

  #changed() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.#save().catch((err) => this.emit('error', err)), 2000);
    this.emit('changed');
  }

  // Write to a temp file and rename, so a crash never leaves a half-written library.json
  async #save() {
    clearTimeout(this.saveTimer);
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, items: [...this.items.values()] }, null, 2));
    await fs.rename(tmp, this.file);
  }
}

async function diskSpace(dir) {
  const s = await fs.statfs(dir);
  return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
}

function fmtGB(bytes) {
  return `${(bytes / GB).toFixed(1)} GB`;
}

// Errors with a status code the HTTP layer can pass through
export function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
