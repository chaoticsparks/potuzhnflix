// library.js — downloads that survive restarts: add, pause/resume, delete, keep, auto-cleanup
//
// An item is one torrent (added by magnet link), played as a playlist of its video files:
// a film (one file), a film split into parts, or the episodes of a series.
// While something plays, all other downloads wait so the stream gets the bandwidth.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import parseTorrent from 'parse-torrent';
import { TorrentEngine, DEFAULT_CACHE_DIR, pickVideoFiles } from '../torrent/engine.js';

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
    await this.engine.start();
    for (const item of await this.#readSaved()) this.items.set(item.id, migrate(item));

    await this.#deleteOrphans();
    await this.cleanup();
    this.#sync();

    // Refresh progress once a second; sweep for expired items / low disk periodically
    this.ticker = setInterval(() => this.#tick(), 1000);
    this.sweeper = setInterval(() => this.cleanup().catch((err) => this.emit('error', err)), this.policy.sweepIntervalMs);
  }

  // Starts (or reuses) a download; resolves once torrent metadata is known.
  // The videos to play are chosen by pickVideoFiles().
  async add(magnet) {
    const claim = { infoHash: null };   // keeps #doSync from stopping the torrent before the item exists
    this.claims.add(claim);
    try {
      return await this.#add(magnet, claim);
    } finally {
      this.claims.delete(claim);
      this.#sync();   // drops the torrent again if the add failed and nothing else needs it
    }
  }

  async #add(magnet, claim) {
    const t = await this.engine.add(magnet);
    claim.infoHash = t.infoHash;

    const chosen = pickVideoFiles(t.files);
    if (!chosen.length) throw httpError(404, 'No video file found in torrent');
    const id = t.infoHash;
    const now = Date.now();

    // Items from older versions may have a different id format
    let item = [...this.items.values()].find((i) => i.infoHash === t.infoHash);
    if (!item) {
      await this.#ensureSpace(sum(chosen, 'length'), id);
      item = {
        id,
        infoHash: t.infoHash,
        title: t.name,
        files: chosen.map((f) => ({
          index: t.files.indexOf(f), name: f.name, path: f.path, length: f.length, downloaded: 0, done: false, wanted: true,
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
    f.wanted = true;   // watching an episode means keeping it
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
    }
    if (item.state === 'complete') item.completedAt = null;
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

  // Which episodes to download: positions in `files`. The others stop downloading; what is already
  // on disk stays (deleting one file of a torrent would break the pieces it shares with neighbours).
  async setWanted(id, episodes) {
    const item = this.#get(id);
    const chosen = new Set(episodes);
    for (const k of chosen) {
      if (!Number.isInteger(k) || k < 0 || k >= item.files.length) throw httpError(400, `No episode ${k}`);
    }
    const before = remaining(item);
    const previous = item.files.map((f) => f.wanted);
    item.files.forEach((f, k) => { f.wanted = chosen.has(k); });
    const after = remaining(item);
    if (after > before) {
      try {
        await this.#ensureSpace(after, id);
      } catch (err) {
        item.files.forEach((f, k) => { f.wanted = previous[k]; });
        throw err;
      }
    }

    const now = Date.now();
    item.lastActivityAt = now;
    if (allWantedDone(item)) {
      if (item.state !== 'complete') {
        item.state = 'complete';
        item.completedAt = now;
      }
    } else if (item.state === 'complete') {
      item.state = 'downloading';
      item.completedAt = null;
    }
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
    await this.engine.deleteTorrentData(item.infoHash);
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
    // Progress and "complete" are about the chosen episodes
    const chosen = item.files.filter((f) => f.wanted);
    const wantedLength = sum(chosen, 'length');
    const wantedDownloaded = sum(chosen, 'downloaded');
    return {
      id: item.id,
      title: item.title,
      length,
      downloaded,
      wantedLength,
      wantedDownloaded,
      wantedCount: chosen.length,
      wantedDone: chosen.filter((f) => f.done).length,
      progress: wantedLength ? wantedDownloaded / wantedLength : 0,
      state: item.state,
      waiting,   // paused for now because another film plays
      playing,
      keep: item.keep,
      downloadSpeed: active ? stats.downloadSpeed : 0,
      peers: active ? stats.peers : 0,
      episode: item.episode,
      files: item.files.map((f) => ({
        name: f.name, length: f.length, downloaded: f.downloaded,
        progress: f.length ? f.downloaded / f.length : 0, done: f.done, wanted: f.wanted,
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

  // Write library.json now (before a shutdown), instead of within the next few seconds
  flush() {
    return this.#save();
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

  #onFileDone(infoHash, index) {
    const item = [...this.items.values()].find((i) => i.infoHash === infoHash);
    const f = item?.files.find((x) => x.index === index);
    if (!f || f.done) return;
    const now = Date.now();
    f.done = true;
    f.downloaded = f.length;
    item.lastActivityAt = now;
    if (allWantedDone(item) && item.state !== 'complete') {
      item.state = 'complete';
      item.completedAt = now;
    }
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
        for (const f of item.files) if (f.wanted) want(item.infoHash, f);
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
    if (changed) this.#changed(false);
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

  // Saves within 2 s of a real change, within 10 s of mere download progress (spares the SD card).
  // A pending timer is only ever brought forward: progress changes every second while downloading,
  // and a timer restarted on each change would never fire.
  #changed(urgent = true) {
    const due = Date.now() + (urgent ? 2000 : 10000);
    if (!this.saveTimer || due < this.saveDue) {
      clearTimeout(this.saveTimer);
      this.saveDue = due;
      this.saveTimer = setTimeout(() => this.#save().catch((err) => this.emit('error', err)), due - Date.now());
    }
    this.emit('changed');
  }

  // Survives power cuts (the box gets unplugged): the new file is fsync'ed before it replaces the
  // old one, and the previous version stays as library.json.bak. Serialised: one temp file.
  #save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.saving = (this.saving ?? Promise.resolve()).catch(() => {}).then(async () => {
      const tmp = `${this.file}.tmp`;
      const fh = await fs.open(tmp, 'w');
      try {
        await fh.writeFile(JSON.stringify({ version: 2, items: [...this.items.values()] }, null, 2));
        await fh.sync();
      } finally {
        await fh.close();
      }
      await fs.rename(this.file, `${this.file}.bak`).catch((err) => {
        if (err.code !== 'ENOENT') throw err;
      });
      await fs.rename(tmp, this.file);
      await syncDir(this.dir);
    });
    return this.saving;
  }

  // library.json → library.json.bak → rebuilt from the saved .torrent files. Never gives up:
  // an empty library would make #deleteOrphans() erase every download.
  async #readSaved() {
    for (const file of [this.file, `${this.file}.bak`]) {
      const json = await fs.readFile(file, 'utf8').catch(() => null);
      if (!json) continue;   // missing, or emptied by a power cut
      try {
        const { items } = JSON.parse(json.replace(/^﻿/, ''));   // BOM: Windows editors add one
        if (Array.isArray(items)) {
          if (file !== this.file) this.emit('error', new Error(`${this.file} was damaged; loaded the backup`));
          return items;
        }
      } catch {
        // try the next one
      }
    }
    const rebuilt = await this.#rebuildFromTorrents();
    if (rebuilt.length) {
      this.emit('error', new Error(`${this.file} was damaged; rebuilt ${rebuilt.length} download(s) from saved torrents`));
    }
    return rebuilt;
  }

  // Every download keeps its metadata in torrents/<infoHash>.torrent; progress is found again
  // when the torrent loads and checks the data on disk
  async #rebuildFromTorrents() {
    const names = await fs.readdir(this.engine.torrentsDir).catch(() => []);
    const items = [];
    for (const name of names.filter((n) => n.endsWith('.torrent'))) {
      try {
        const t = await parseTorrent(await fs.readFile(path.join(this.engine.torrentsDir, name)));
        const chosen = pickVideoFiles(t.files);
        if (!chosen.length) continue;
        const now = Date.now();
        items.push({
          id: t.infoHash,
          infoHash: t.infoHash,
          title: t.name,
          files: chosen.map((f) => ({
            index: t.files.indexOf(f), name: f.name, path: f.path, length: f.length, downloaded: 0, done: false, wanted: true,
          })),
          episode: 0,
          state: 'downloading',
          keep: false,
          addedAt: now,
          completedAt: null,
          lastPlayedAt: null,
          lastActivityAt: now,
        });
      } catch {
        // unreadable metadata: its data folder is removed as an orphan
      }
    }
    return items;
  }
}

// Makes a rename durable (Linux); directories can't be opened for sync on Windows
async function syncDir(dir) {
  try {
    const fh = await fs.open(dir, 'r');
    try { await fh.sync(); } finally { await fh.close(); }
  } catch {
    // not supported here
  }
}

// v1 items held a single file in flat fields; items before episode choice had no `wanted`
function migrate(item) {
  if (!item.files) {
    const { fileIndex, name, path: p, length, downloaded, ...rest } = item;
    const done = item.state === 'complete';
    item = {
      ...rest,
      files: [{ index: fileIndex, name, path: p, length, downloaded: done ? length : downloaded, done }],
      episode: 0,
    };
  }
  for (const f of item.files) f.wanted ??= true;
  return item;
}

// Bytes still to download for the chosen episodes
function remaining(item) {
  return item.files.reduce((s, f) => s + (f.done || !f.wanted ? 0 : f.length - f.downloaded), 0);
}

// "Complete" = every chosen episode is on disk (and at least one is chosen)
function allWantedDone(item) {
  const chosen = item.files.filter((f) => f.wanted);
  return chosen.length > 0 && chosen.every((f) => f.done);
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

// Errors with a status code the HTTP layer can pass through
export function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
