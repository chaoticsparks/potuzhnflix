// tvbox.js — ties the download library, mpv and the TV screen together; one playback at a time
import { EventEmitter } from 'node:events';
import { MpvPlayer } from '../player/player.js';
import { TvScreen, TV_ARGS } from '../player/tvscreen.js';
import { Library, httpError } from '../library/library.js';

const DISPLAY_RETRY_MS = 30 * 1000;

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
  // remoteUrl: address of the phone remote, shown on the TV's idle screen
  constructor({ playerArgs = [], cacheDir, policy, remoteUrl = null } = {}) {
    super();
    this.playerArgs = [...TV_ARGS, ...playerArgs];
    this.remoteUrl = remoteUrl;
    this.tv = null;
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

  // Loads the library and turns the TV on (blue "insert a tape" screen)
  async init() {
    await this.library.load();
    try {
      await this.#ensurePlayer();
    } catch (err) {
      // No mpv here (e.g. a dev machine): the API still works, playback will fail with a clear error
      this.emit('error', err);
    }
  }

  // Download without playing
  download({ magnet }) {
    return this.library.add(magnet);
  }

  // Plays a library item ({ id, episode? }) or a new magnet link ({ magnet }, added to the library).
  // `episode` defaults to the last one watched.
  // Resolves when mpv has started loading; the long part is torrent metadata.
  async play({ id, episode, magnet }) {
    if (!id && !magnet) throw httpError(400, 'id or magnet is required');
    const session = ++this.session;
    // Switching episodes of the same item keeps it marked as playing (no download reshuffle)
    if (!id || id !== this.current) await this.#release();
    this.#set({ phase: 'loading', title: id ? this.library.get(id)?.title ?? null : null, error: null });

    try {
      const item = id ? this.library.get(id) : await this.library.add(magnet);
      if (!item) throw httpError(404, `No such download: ${id}`);
      if (session !== this.session) return;
      if (!this.title) this.#set({ title: item.title });   // a new magnet: name known after metadata
      const source = await this.library.stream(item.id, episode);
      if (session !== this.session) {
        // Cancelled by stop() before this item became current. When switching episodes of the
        // current item, stop() / the newer play() already handled it, and releasing here would
        // release the newer episode too.
        if (this.current !== item.id) await this.library.release(item.id);
        return;
      }
      this.current = item.id;
      const player = await this.#ensurePlayer();
      if (session !== this.session) return;
      const playing = this.library.get(item.id);
      const name = playing.files.length > 1 ? `${playing.title} · ${playing.files[playing.episode].name}` : playing.title;
      await player.load(source, { title: name });
      this.#set({ phase: 'playing', title: playing.title });
    } catch (err) {
      if (session !== this.session) return;   // cancelled by stop() or a newer play()
      await this.#release();
      this.#fail(err);
      throw err;
    }
  }

  async control(action, value) {
    if (action === 'next' || action === 'prev') return this.#step(action === 'next' ? 1 : -1);
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
      // Position in the playlist (series episodes, film parts); null for a single file
      episode: item && item.files.length > 1 ? {
        index: item.episode, count: item.files.length, name: item.files[item.episode].name,
      } : null,
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
    this.closing = true;
    clearTimeout(this.displayRetry);
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

  // mpv starts with the server (the TV shows the blue screen) and again on play if its window was closed
  async #ensurePlayer() {
    if (this.player) return this.player;
    const player = new MpvPlayer({ extraArgs: this.playerArgs });
    const tv = new TvScreen(player, { remoteUrl: this.remoteUrl });
    player.on('state', () => this.#changed());
    player.on('end-file', (e) => this.#onEndFile(e));
    player.on('log', (line) => {
      this.emit('mpv-log', line);
      if (/Error opening\/initializing the VO window/.test(line)) this.#retryDisplay(player);
    });
    player.on('exit', () => {
      tv.stop();
      if (this.player === player) {
        this.player = null;
        this.tv = null;
      }
      if (this.phase === 'playing' || this.phase === 'loading') this.stop();
    });
    await player.start();
    this.player = player;
    this.tv = tv;
    tv.start();
    this.#updateTv();
    return player;
  }

  // mpv started without a screen (e.g. the TV was off and dropped HDMI hot-plug) and would sit
  // there blind; restart it until the screen is back. The kernel's video=…D setting on the Pi
  // normally prevents this.
  #retryDisplay(player) {
    if (this.displayRetry || this.closing) return;
    this.emit('error', new Error(`mpv has no screen; retrying in ${DISPLAY_RETRY_MS / 1000} s`));
    this.displayRetry = setTimeout(async () => {
      this.displayRetry = null;
      if (this.closing || this.player !== player) return;
      await new Promise((resolve) => {
        player.once('exit', resolve);
        player.quit();
        setTimeout(() => player.proc?.kill(), 3000);   // didn't take the hint
      });
      try {
        await this.#ensurePlayer();
      } catch (err) {
        this.emit('error', err);
      }
    }, DISPLAY_RETRY_MS);
  }

  // Next / previous entry of the playlist
  async #step(delta) {
    const item = this.current && this.library.get(this.current);
    if (!item || this.phase !== 'playing') throw httpError(409, 'Nothing is playing');
    const k = item.episode + delta;
    if (k < 0 || k >= item.files.length) throw httpError(409, delta > 0 ? 'This is the last episode' : 'This is the first episode');
    await this.play({ id: item.id, episode: k });
  }

  // 'stop' also fires when a new file replaces the old one, so only eof/error matter.
  // At the end of an episode the next one starts; after the last one, playback stops.
  #onEndFile(e) {
    if (this.phase !== 'playing') return;
    if (e.reason === 'eof') {
      const item = this.current && this.library.get(this.current);
      if (item && item.episode + 1 < item.files.length) {
        this.play({ id: item.id, episode: item.episode + 1 }).catch(() => {});   // failure is shown via status
      } else {
        this.stop();
      }
    }
    else if (e.reason === 'error') this.#fail(new Error(`mpv could not play the file (${e.file_error ?? 'unknown error'})`));
  }

  #fail(err) {
    this.#set({ phase: 'error', error: err.message });
  }

  #set(fields) {
    Object.assign(this, fields);
    this.#updateTv();
    this.#changed();
  }

  #updateTv() {
    this.tv?.setScene(this.phase, { title: this.title, error: this.error, episode: this.status().episode });
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
