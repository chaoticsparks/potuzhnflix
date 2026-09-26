// library.js — downloads that survive restarts: add, pause/resume, delete, keep, auto-cleanup
//
// An item is a playlist of video files inside one torrent: a film (one file), a film split
// into parts, or the episodes of a series. Several items may share a torrent (e.g. 1080p and
// 480p versions from the same Internet Archive item).
// While something plays, all other downloads wait so the stream gets the bandwidth.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { TorrentEngine, DEFAULT_CACHE_DIR, pickVideoFiles, findFile } from '../torrent/engine.js';

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
    this.engine.on('file-done', (infoHash, index) => this.#onFileDone(infoHash, index));
    this.items = new Map();
    this.playing = null;           // { id, episode } being played
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
    for (const item of saved) this.items.set(item.id, migrate(item));

    await this.#deleteOrphans();
    await this.cleanup();
    this.#sync();

    // Refresh progress once a second; sweep for expired items / low disk periodically
    this.ticker = setInterval(() => this.#tick(), 1000);
    this.sweeper = setInterval(() => this.cleanup().catch((err) => this.emit('error', err)), this.policy.sweepIntervalMs);
  }

  // Starts (or reuses) a download; resolves once torrent metadata is known.
  // `files` (paths, in play order) or `file` pick what to download; otherwise pickVideoFiles() decides.
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

  async #add({ torrent, file, files, title }, claim) {
    const t = await this.engine.add(torrent);
    claim.infoHash = t.infoHash;

    const wanted = files?.length ? files : file ? [file] : null;
    const chosen = wanted
      ? wanted.map((p) => findFile(t.files, p) ?? notFound(p))
      : pickVideoFiles(t.files);
    if (!chosen.length) throw httpError(404, 'No video file found in torrent');

    const indexes = chosen.map((f) => t.files.indexOf(f));
    const id = itemId(t.infoHash, indexes);
    const now = Date.now();

    let item = this.items.get(id);
    if (!item) {
      await this.#ensureSpace(sum(chosen, 'length'), id);
      item = {
        id,
        infoHash: t.infoHash,
        title: title || (chosen.length > 1 ? t.name : chosen[0].name),
        files: chosen.map((f, i) => ({
          index: indexes[i], name: f.name, path: f.path, length: f.length, downloaded: 0, done: false,
        })),
        episode: 0,             // last played entry of `files`
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

  // Marks an episode as playing and returns what mpv should open: a local path or a stream URL.
  // `episode` defaults to the last one played.
  async stream(id, episode) {
    const item = this.#get(id);
    const k = episode ?? item.episode ?? 0;
    if (!Number.isInteger(k) || k < 0 || k >= item.files.length) {
      throw httpError(400, `No episode ${k} (this has ${item.files.length})`);
    }
    const f = item.files[k];
    const now = Date.now();
    item.episode = k;
    item.lastPlayedAt = now;
    item.lastActivityAt = now;

    if (f.done) {
      const local = this.engine.filePath(item.infoHash, f.path);
      const exists = await fs.stat(local).then((s) => s.size === f.length).catch(() => false);
      if (exists) {
        this.playing = { id, episode: k };
        await this.#sync();   // may still prefetch the next episode
        this.#changed();
        return local;
      }
      // File vanished from disk — download it again
      f.done = false;
      f.downloaded = 0;
      item.completedAt = null;
    }
    if (item.state !== 'downloading') item.state = 'downloading';

    this.playing = { id, episode: k };
    await this.#sync();
    this.#changed();
    return this.engine.streamUrl(item.infoHash, f.index);
  }

  // Playback ended; other downloads continue. Ignored if a newer stream() took over.
  async release(id) {
    if (this.playing?.id !== id) return;
    this.playing = null;
    await this.#sync();
    this.#changed();
  }

  async pause(id) {
    const item = this.#get(id);
    if (item.state !== 'downloading') return this.view(item);
    if (this.playing?.id === id) throw httpError(409, 'Cannot pause the film that is playing');
    item.state = 'paused';
    item.lastActivityAt = Date.now();
    await this.#sync();
    this.#changed();
    return this.view(item);
  }

  async resume(id) {
    const item = this.#get(id);
    if (item.state !== 'paused') return this.view(item);
    await this.#ensureSpace(remaining(item), id);
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
    if (this.playing?.id === id) throw httpError(409, 'Stop playback before deleting this film');
    this.items.delete(id);
    await this.#sync();

    const siblings = [...this.items.values()].filter((i) => i.infoHash === item.infoHash);
    if (siblings.length) {
      // Other items use this torrent: delete only files that none of them needs
      const used = new Set(siblings.flatMap((i) => i.files.map((f) => f.index)));
      for (const f of item.files) {
        if (used.has(f.index)) continue;
        await fs.rm(this.engine.filePath(item.infoHash, f.path), { force: true, maxRetries: 5 }).catch(() => {});
      }
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
      if (expires !== null && expires <= now && this.playing?.id !== item.id) await this.remove(item.id);
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
    const playing = this.playing?.id === item.id;
    const waiting = item.state === 'downloading' && !!this.playing && !playing;
    const active = (item.state === 'downloading' || playing) && !waiting && stats;
    const length = sum(item.files, 'length');
    const downloaded = sum(item.files, 'downloaded');
    return {
      id: item.id,
      title: item.title,
      length,
      downloaded,
      progress: length ? downloaded / length : 0,
      state: item.state,
      waiting,   // paused for now because another film plays
      playing,
      keep: item.keep,
      downloadSpeed: active ? stats.downloadSpeed : 0,
      peers: active ? stats.peers : 0,
      episode: item.episode,
      files: item.files.map((f) => ({
        name: f.name, length: f.length, downloaded: f.downloaded,
        progress: f.length ? f.downloaded / f.length : 0, done: f.done,
      })),
      addedAt: item.addedAt,
      completedAt: item.completedAt,
      lastPlayedAt: item.lastPlayedAt,
      expiresAt: this.expiresAt(item),
    };
  }

  async storage() {
    const { free, total } = await diskSpace(this.dir);
    const used = [...this.items.values()].reduce((s, i) => s + sum(i.files, 'length'), 0);
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

  // A torrent file finished; it may belong to several items
  #onFileDone(infoHash, index) {
    const now = Date.now();
    let changed = false;
    for (const item of this.items.values()) {
      if (item.infoHash !== infoHash) continue;
      const f = item.files.find((x) => x.index === index);
      if (!f || f.done) continue;
      f.done = true;
      f.downloaded = f.length;
      item.lastActivityAt = now;
      if (item.files.every((x) => x.done)) {
        item.state = 'complete';
        item.completedAt = now;
      }
      changed = true;
    }
    if (!changed) return;
    this.#sync();   // stops the torrent unless something still needs it
    this.#changed();
  }

  // Brings torrents in line with item states. Serialised, since adding a torrent is async.
  #sync() {
    this.syncing = this.syncing.then(() => this.#doSync()).catch((err) => this.emit('error', err));
    return this.syncing;
  }

  async #doSync() {
    const wanted = new Map();   // infoHash → file indexes that should download
    const want = (infoHash, f) => {
      if (f.done) return;
      if (!wanted.has(infoHash)) wanted.set(infoHash, new Set());
      wanted.get(infoHash).add(f.index);
    };
    for (const item of this.items.values()) {
      if (this.playing?.id === item.id) {
        // The episode being watched and the next one, so it starts without waiting
        const k = this.playing.episode;
        for (const f of item.files.slice(k, k + 2)) want(item.infoHash, f);
      } else if (item.state === 'downloading' && !this.playing) {
        for (const f of item.files) want(item.infoHash, f);
      }
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
      this.engine.setSelection(infoHash, [...indexes]);
      // Files already complete on disk (checked while the torrent was loading)
      for (const index of indexes) {
        if (this.engine.fileStats(infoHash, index)?.done) this.#onFileDone(infoHash, index);
      }
    }
  }

  // Refresh downloaded bytes; progress counts as activity for the unfinished-download timer
  #tick() {
    let changed = false;
    for (const item of this.items.values()) {
      if (item.state === 'complete') continue;
      for (const f of item.files) {
        if (f.done) continue;
        const stats = this.engine.fileStats(item.infoHash, f.index);
        if (!stats || stats.downloaded === f.downloaded) continue;
        if (stats.downloaded > f.downloaded) item.lastActivityAt = Date.now();
        f.downloaded = stats.downloaded;
        changed = true;
      }
    }
    if (changed) this.#changed();
  }

  // Frees space for `needed` more bytes plus what active downloads still have to fetch
  async #ensureSpace(needed, forId = null) {
    const pending = [...this.items.values()]
      .filter((i) => i.state === 'downloading' && i.id !== forId)
      .reduce((s, i) => s + remaining(i), 0);
    const required = needed + pending + this.policy.minFreeBytes;

    let { free } = await diskSpace(this.dir);
    if (free >= required) return;

    const candidates = [...this.items.values()]
      .filter((i) => !i.keep && i.id !== forId && i.id !== this.playing?.id)
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
    const metas = (await fs.readdir(this.engine.torrentsDir).catch(() => [])).map((n) => n.replace(/\.torrent$/, ''));
    for (const infoHash of new Set([...dirs, ...metas])) {
      if (!known.has(infoHash)) await this.engine.deleteTorrentData(infoHash);
    }
  }

  // Saves within 2 s of a change. A pending timer is not restarted: progress changes every
  // second while downloading, and a restarting timer would never fire.
  #changed() {
    this.saveTimer ??= setTimeout(() => this.#save().catch((err) => this.emit('error', err)), 2000);
    this.emit('changed');
  }

  // Write to a temp file and rename, so a crash never leaves a half-written library.json.
  // Serialised: two writes must not share the temp file.
  #save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.saving = (this.saving ?? Promise.resolve()).catch(() => {}).then(async () => {
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ version: 2, items: [...this.items.values()] }, null, 2));
      await fs.rename(tmp, this.file);
    });
    return this.saving;
  }
}

// Single file: "<infoHash>-<index>"; playlist: "<infoHash>-p<hash of the indexes>"
function itemId(infoHash, indexes) {
  if (indexes.length === 1) return `${infoHash}-${indexes[0]}`;
  const h = crypto.createHash('sha1').update(indexes.join(',')).digest('hex').slice(0, 8);
  return `${infoHash}-p${h}`;
}

// v1 items held a single file in flat fields
function migrate(item) {
  if (item.files) return item;
  const { fileIndex, name, path: p, length, downloaded, ...rest } = item;
  const done = item.state === 'complete';
  return {
    ...rest,
    files: [{ index: fileIndex, name, path: p, length, downloaded: done ? length : downloaded, done }],
    episode: 0,
  };
}

function remaining(item) {
  return item.files.reduce((s, f) => s + (f.done ? 0 : f.length - f.downloaded), 0);
}

function sum(list, key) {
  return list.reduce((s, x) => s + x[key], 0);
}

async function diskSpace(dir) {
  const s = await fs.statfs(dir);
  return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
}

function fmtGB(bytes) {
  return `${(bytes / GB).toFixed(1)} GB`;
}

function notFound(p) {
  throw httpError(404, `File not found in torrent: ${p}`);
}

// Errors with a status code the HTTP layer can pass through
export function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
