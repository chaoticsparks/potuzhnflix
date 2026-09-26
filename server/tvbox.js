// tvbox.js — ties search → download library → mpv together; one playback at a time
import { EventEmitter } from 'node:events';
import { MpvPlayer } from '../player/player.js';
import { Library, httpError } from '../library/library.js';
import { search } from '../search/index.js';

// Control actions accepted by control(); value is validated per action
const ACTIONS = {
  play: (p) => p.play(),
  pause: (p) => p.pause(),
  toggle: (p) => p.togglePause(),
  seekBy: (p, v) => p.seekBy(num(v)),
  seekTo: (p, v) => p.seekTo(num(v)),
  volume: (p, v) => p.setVolume(num(v)),
  volumeBy: (p, v) => p.changeVolume(num(v)),
  audio: (p, v) => p.setAudioTrack(num(v)),
  sub: (p, v) => p.setSubtitleTrack(v === null || v === 'off' ? null : num(v)),
};

export class TvBox extends EventEmitter {
  constructor({ playerArgs = [], cacheDir, policy } = {}) {
    super();
    this.playerArgs = playerArgs;
    this.library = new Library({ dir: cacheDir, policy });
    this.library.on('changed', () => {
      this.emit('downloads', this.library.list());
      this.#changed();
    });
    this.library.on('error', (err) => this.emit('error', err));
    this.player = null;
    this.session = 0;   // bumped by every play/stop, so a stale play() can tell it was superseded
    this.phase = 'idle';   // idle | loading | playing | error
    this.current = null;   // library item id being played
    this.title = null;
    this.error = null;
  }

  init() {
    return this.library.load();
  }

  search(query) {
    return search(query);
  }

  // Download without playing
  download({ torrent, file, title }) {
    return this.library.add({ torrent, file, title });
  }

  // Plays a library item ({ id }) or a new torrent ({ torrent, file, title }, added to the library).
  // Resolves when mpv has started loading; the long part is torrent metadata.
  async play({ id, torrent, file, title }) {
    if (!id && !torrent) throw httpError(400, 'id or torrent is required');
    const session = ++this.session;
    await this.#release();
    this.#set({ phase: 'loading', title: title ?? this.library.get(id)?.title ?? null, error: null });

    try {
      const item = id ? this.library.get(id) : await this.library.add({ torrent, file, title });
      if (!item) throw httpError(404, `No such download: ${id}`);
      if (session !== this.session) return;
      const source = await this.library.stream(item.id);
      if (session !== this.session) {
        await this.library.release(item.id);   // no-op if a newer play() already took over
        return;
      }
      this.current = item.id;
      const player = await this.#ensurePlayer();
      if (session !== this.session) return;
      await player.load(source, { title: item.title });
      this.#set({ phase: 'playing', title: item.title });
    } catch (err) {
      if (session !== this.session) return;   // cancelled by stop() or a newer play()
      await this.#release();
      this.#fail(err);
      throw err;
    }
  }

  async control(action, value) {
    const fn = ACTIONS[action];
    if (!fn) throw httpError(400, `Unknown action: ${action}`);
    if (!this.player || this.phase !== 'playing') throw httpError(409, 'Nothing is playing');
    await fn(this.player, value);
  }

  async tracks() {
    return this.player ? this.player.tracks() : { audio: [], subtitles: [] };
  }

  // Stops playback; the film stays in the library and keeps downloading if unfinished
  async stop() {
    this.session++;
    await this.player?.stop().catch(() => {});
    await this.#release();
    this.#set({ phase: 'idle', title: null, error: null });
  }

  // Deleting the film that is playing stops it first
  async deleteDownload(id) {
    if (this.current === id) await this.stop();
    await this.library.remove(id);
  }

  status() {
    const p = this.player?.state;
    const item = this.current ? this.library.get(this.current) : null;
    return {
      phase: this.phase,
      title: this.title,
      error: this.error,
      itemId: this.current,
      player: p && this.phase === 'playing' ? {
        paused: p.paused, position: p.position, duration: p.duration,
        volume: p.volume, buffering: p.buffering,
      } : null,
      download: item ? {
        state: item.state, progress: item.progress, downloaded: item.downloaded, length: item.length,
        downloadSpeed: item.downloadSpeed, peers: item.peers,
      } : null,
    };
  }

  async shutdown() {
    this.session++;
    await this.player?.quit();
    await this.library.close();
  }

  async #release() {
    if (!this.current) return;
    const id = this.current;
    this.current = null;
    await this.library.release(id);
  }

  // mpv is started lazily and restarted if its window was closed
  async #ensurePlayer() {
    if (this.player) return this.player;
    const player = new MpvPlayer({ extraArgs: this.playerArgs });
    player.on('state', () => this.#changed());
    player.on('end-file', (e) => this.#onEndFile(e));
    player.on('exit', () => {
      if (this.player === player) this.player = null;
      if (this.phase === 'playing' || this.phase === 'loading') this.stop();
    });
    await player.start();
    this.player = player;
    return player;
  }

  // 'stop' also fires when a new file replaces the old one, so only eof/error matter
  #onEndFile(e) {
    if (this.phase !== 'playing') return;
    if (e.reason === 'eof') this.stop();
    else if (e.reason === 'error') this.#fail(new Error(`mpv could not play the file (${e.file_error ?? 'unknown error'})`));
  }

  #fail(err) {
    this.#set({ phase: 'error', error: err.message });
  }

  #set(fields) {
    Object.assign(this, fields);
    this.#changed();
  }

  #changed() {
    this.emit('status', this.status());
  }
}

function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw httpError(400, `Expected a number, got ${JSON.stringify(v)}`);
  return n;
}
