// tvbox.js — ties the download library, mpv and the TV screen together; one playback at a time
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MpvPlayer } from '../player/player.js';
import { TvScreen, TV_ARGS } from '../player/tvscreen.js';
import { Library, httpError } from '../library/library.js';

const run = promisify(execFile);
const DISPLAY_RETRY_MS = 30 * 1000;
const STORAGE_RETRY_MS = 30 * 1000;
const NO_DISK = 'Film disk is not connected';

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
  // remoteUrl: address of the phone remote, shown on the TV's idle screen; qrUrl(): the same by IP,
  // for the QR code.
  // requireMount: mount point the downloads live on (the box works without it, just no films).
  // canPower: the box may shut down / reboot the machine (the Pi, not a dev PC).
  // saverMs: idle time before the TV's screen saver (0 = never).
  constructor({ playerArgs = [], cacheDir, policy, remoteUrl = null, qrUrl = null, requireMount = null, canPower = false, saverMs } = {}) {
    super();
    this.playerArgs = [...TV_ARGS, ...playerArgs];
    this.saverMs = saverMs;
    this.remoteUrl = remoteUrl;
    this.qrUrl = qrUrl;
    this.requireMount = requireMount;
    this.canPower = canPower;
    this.tv = null;
    this.library = new Library({ dir: cacheDir, policy });
    this.library.on('changed', () => {
      const list = this.library.list();
      this.emit('downloads', list);
      this.#updateTv(list);   // the idle screen shows what is downloading
      this.#changed();
    });
    this.library.on('error', (err) => this.emit('error', err));
    this.libraryReady = false;
    this.storageError = null;
    this.poweringOff = null;   // 'poweroff' | 'reboot' once requested
    this.player = null;
    this.session = 0;   // bumped by every play/stop, so a stale play() can tell it was superseded
    this.phase = 'idle';   // idle | loading | playing | error
    this.current = null;   // library item id being played
    this.title = null;
    this.error = null;
  }

  // Turns the TV on (blue "insert a tape" screen), then opens the library — which may have to wait
  // for its disk; the TV and the remote work meanwhile
  async init() {
    try {
      await this.#ensurePlayer();
    } catch (err) {
      // No mpv here (e.g. a dev machine): the API still works, playback will fail with a clear error
      this.emit('error', err);
    }
    await this.#openLibrary();
  }

  // Download without playing
  download({ magnet, torrent }) {   // torrent: .torrent file contents (Buffer)
    this.#needLibrary();
    return this.library.add(torrent ?? magnet);
  }

  downloads() {
    return this.libraryReady ? this.library.list() : [];
  }

  // { paused?, keep?, wanted?: episode positions to download }
  async updateDownload(id, { paused, keep, wanted }) {
    this.#needLibrary();
    if (!this.library.get(id)) throw httpError(404, `No such download: ${id}`);
    if (wanted !== undefined) await this.library.setWanted(id, wanted);
    if (keep !== undefined) this.library.setKeep(id, keep);
    if (paused === true) await this.library.pause(id);
    if (paused === false) await this.library.resume(id);
    return this.library.get(id);
  }

  storage() {
    this.#needLibrary();
    return this.library.storage();
  }

  // Plays a library item ({ id, episode? }) or a new torrent — { magnet } or { torrent: .torrent file
  // contents as a Buffer } — which is added to the library first.
  // `episode` defaults to the last one watched.
  // Resolves when mpv has started loading; the long part is torrent metadata.
  async play({ id, episode, magnet, torrent }) {
    if (!id && !magnet && !torrent) throw httpError(400, 'id, magnet or a .torrent file is required');
    this.#needLibrary();
    const session = ++this.session;
    // Switching episodes of the same item keeps it marked as playing (no download reshuffle)
    if (!id || id !== this.current) await this.#release();
    this.#set({ phase: 'loading', title: id ? this.library.get(id)?.title ?? null : null, error: null });

    try {
      const item = id ? this.library.get(id) : await this.library.add(torrent ?? magnet);
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
    this.#needLibrary();
    if (this.current === id) await this.stop();
    await this.library.remove(id);
  }

  // Proper shutdown / reboot, so the power can be pulled safely afterwards: playback stops, the
  // library is flushed, and systemd unmounts the disk cleanly (an NTFS disk comes back "dirty"
  // otherwise). Resolves before the machine goes down, so the phone gets the answer.
  async power(action) {
    if (!this.canPower) throw httpError(501, 'Power control is only available on the TV box');
    if (action !== 'poweroff' && action !== 'reboot') throw httpError(400, `Unknown power action: ${action}`);
    await this.stop().catch(() => {});
    if (this.libraryReady) await this.library.flush();
    this.poweringOff = action;
    this.#updateTv();
    this.#changed();
    setTimeout(() => {
      run('sudo', ['-n', 'systemctl', action]).catch((err) => {
        this.poweringOff = null;
        this.#updateTv();
        this.#changed();
        this.emit('error', new Error(`${action} failed: ${err.message}`));
      });
    }, 1500);   // let the TV show the message and the reply reach the phone
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
      storage: { ok: this.libraryReady && !this.storageError, error: this.storageError },
      power: this.canPower,
      poweringOff: this.poweringOff,
    };
  }

  async shutdown() {
    this.closing = true;
    clearTimeout(this.displayRetry);
    clearTimeout(this.storageRetry);
    clearInterval(this.mountWatch);
    this.session++;
    await this.player?.quit();
    if (this.libraryReady) await this.library.close();
  }

  // The downloads' disk may be missing, or refuse to mount (an NTFS disk after a power cut).
  // Try to mount it and load the library; retry every 30 s until it works.
  async #openLibrary() {
    if (this.closing || this.libraryReady) return;
    try {
      if (this.requireMount && !(await isMounted(this.requireMount))) {
        // sudoers allows exactly this; fstab has the options (never forced)
        await run('sudo', ['-n', 'mount', this.requireMount]).catch(() => {});
        if (!(await isMounted(this.requireMount))) throw new Error(NO_DISK);
      }
      await this.library.load();
      this.libraryReady = true;
      this.#setStorageError(null);
      this.emit('downloads', this.library.list());
      if (this.requireMount) this.#watchMount();
    } catch (err) {
      this.#setStorageError(err.message);
      this.storageRetry = setTimeout(() => this.#openLibrary(), STORAGE_RETRY_MS);
    }
  }

  // The disk unplugged while running: tell the user (the library can't be unloaded safely)
  #watchMount() {
    this.mountWatch = setInterval(async () => {
      const ok = await isMounted(this.requireMount);
      this.#setStorageError(ok ? null : 'Film disk was disconnected; restart the box');
    }, STORAGE_RETRY_MS);
  }

  #setStorageError(message) {
    if (message === this.storageError) return;
    this.storageError = message;
    if (message) this.emit('error', new Error(message));
    this.#updateTv();
    this.#changed();
  }

  #needLibrary() {
    if (!this.libraryReady) throw httpError(503, this.storageError ?? NO_DISK);
  }

  async #release() {
    if (!this.current) return;
    const id = this.current;
    this.current = null;
    await this.library.release(id);
  }

  // Someone used the remote: bring the TV back from the screen saver
  wake() {
    this.tv?.wake();
  }

  // mpv starts with the server (the TV shows the blue screen) and again on play if its window was closed
  async #ensurePlayer() {
    if (this.player) return this.player;
    const player = new MpvPlayer({ extraArgs: this.playerArgs });
    const tv = new TvScreen(player, { remoteUrl: this.remoteUrl, qrUrl: this.qrUrl, saverMs: this.saverMs });
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

  #updateTv(list = this.libraryReady ? this.library.list() : []) {
    if (!this.tv) return;
    this.tv.setScene(this.poweringOff ? 'poweroff' : this.phase, {
      title: this.title,
      error: this.error,
      episode: this.status().episode,
      warning: this.storageError ? 'Диск з фільмами не підключено' : null,
      reboot: this.poweringOff === 'reboot',
      // Recording to the shelf right now, fastest first; parts: "3/10" chosen episodes done
      downloads: list
        .filter((d) => d.state === 'downloading' && !d.playing)
        .sort((a, b) => b.downloadSpeed - a.downloadSpeed)
        .map((d) => ({
          title: d.title,
          progress: d.progress,
          speed: d.downloadSpeed,
          parts: d.files.length > 1 ? `${d.wantedDone}/${d.wantedCount}` : null,
        })),
    });
  }

  #changed() {
    this.emit('status', this.status());
  }
}

// A mount point is mounted when it sits on a different device than its parent directory
async function isMounted(dir) {
  try {
    const [inner, outer] = await Promise.all([fs.stat(dir), fs.stat(path.dirname(dir))]);
    return inner.dev !== outer.dev;
  } catch {
    return false;
  }
}

function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw httpError(400, `Expected a number, got ${JSON.stringify(v)}`);
  return n;
}
