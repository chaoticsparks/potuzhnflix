// tvscreen.js — what the TV shows around the film, VHS style, drawn with mpv's OSD (ASS markup):
// a VCR blue screen when idle / loading / on error, and VCR-like messages over the film
// (▶ PLAY, ❚❚ PAUSE, seek counter, volume bar, buffering).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const FONTS_DIR = fileURLToPath(new URL('./fonts', import.meta.url));   // made by scripts/tv-fonts.mjs
const FONT = 'Press Start 2P';

// mpv options the TV screen needs: no built-in controller / idle logo / OSD messages, our font
export const TV_ARGS = [
  '--osc=no',
  '--osd-level=0',
  ...(fs.existsSync(FONTS_DIR) ? [`--osd-fonts-dir=${FONTS_DIR}`] : []),
];

const H = 1080;               // ASS canvas height; width follows the screen's aspect
const MARGIN = 100;           // TVs may overscan: keep text away from the edges
const FPS = 15;
const PLAY_CARD_MS = 4000;
const FLASH_MS = 2500;
const BUFFERING_DELAY_MS = 700;   // don't flash the indicator for short stalls

const BLUE = '1739c4';
const WHITE = 'ffffff';
const PALE = 'c9d6ff';
const GREEN = '98ff4f';
const YELLOW = 'ffd23a';
const SHADOW = '0a1a66';

export class TvScreen {
  constructor(player, { remoteUrl = null } = {}) {
    this.player = player;
    this.remoteUrl = remoteUrl;
    this.width = 1920;
    this.scene = 'idle';        // idle | loading | error | playing
    this.info = {};             // { title, error, episode: { index, count } }
    this.sent = new Map();      // overlay id → last data sent
    this.firstFrame = false;    // film is visible (until then the blue screen stays)
    this.flash = null;          // { kind, until, ... } transient VCR message
    this.bufferingSince = null;
    this.last = { paused: null, volume: null, position: 0 };
    this.seekFrom = null;

    this.onState = (s) => this.#onState(s);
    this.onSeek = () => { this.seekFrom = this.last.position; };
    this.onRestart = () => this.#onRestart();
    player.on('state', this.onState);
    player.on('seek', this.onSeek);
    player.on('playback-restart', this.onRestart);
  }

  start() {
    this.timer = setInterval(() => this.#tick(), 1000 / FPS);
    this.dimsTimer = setInterval(() => this.#refreshSize(), 3000);
    this.#refreshSize();
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.dimsTimer);
    this.player.off('state', this.onState);
    this.player.off('seek', this.onSeek);
    this.player.off('playback-restart', this.onRestart);
  }

  // scene: idle | loading | error | playing | poweroff; info: { title, error, episode, warning, reboot }
  setScene(scene, info = {}) {
    const key = (s, i) => `${s}|${i.title}|${i.episode?.index}`;
    const changed = key(scene, info) !== key(this.scene, this.info);
    this.scene = scene;
    this.info = info;
    // A new film / episode: keep the blue screen until its first frame, then show the play card
    if (changed && scene === 'playing') {
      this.firstFrame = false;
      this.flash = null;
    }
  }

  // ---- Player events ----

  #onState(s) {
    // Fallback if playback-restart came before setScene('playing'): the film is clearly running
    if (this.scene === 'playing' && !this.firstFrame && !s.buffering && s.position > 1) {
      this.firstFrame = true;
      this.#flash('start', PLAY_CARD_MS);
    } else if (this.scene === 'playing' && this.firstFrame) {
      if (this.last.paused === true && s.paused === false) this.#flash('play');
      if (this.last.volume !== null && Math.round(s.volume) !== Math.round(this.last.volume)) this.#flash('volume');
    }
    if (s.buffering && !this.bufferingSince) this.bufferingSince = Date.now();
    if (!s.buffering) this.bufferingSince = null;
    this.last = { paused: s.paused, volume: s.volume, position: s.position ?? 0 };
  }

  // First frame of a file, or the end of a seek
  #onRestart() {
    if (this.scene !== 'playing') return;
    if (!this.firstFrame) {
      this.firstFrame = true;
      this.#flash('start', PLAY_CARD_MS);
    } else if (this.seekFrom !== null) {
      this.#flash(this.player.state.position >= this.seekFrom ? 'ff' : 'rew');
    }
    this.seekFrom = null;
  }

  #flash(kind, ms = FLASH_MS) {
    this.flash = { kind, until: Date.now() + ms };
  }

  // ---- Rendering ----

  async #refreshSize() {
    try {
      const d = await this.player.getProperty('osd-dimensions');
      if (d?.w > 0 && d?.h > 0) this.width = Math.round((H * d.w) / d.h);
    } catch {
      // mpv busy or gone; keep the last size
    }
  }

  #tick() {
    const now = Date.now();
    if (this.flash && now > this.flash.until) this.flash = null;
    const blue = this.scene !== 'playing' || !this.firstFrame;
    this.#send(1, blue ? this.#background() : '', 0);
    this.#send(2, blue ? this.#blueScreen(now) : this.#vcrOsd(now), 1);
  }

  #send(id, data, z) {
    const key = `${this.width}|${data}`;
    if (this.sent.get(id) === key) return;
    this.sent.set(id, key);
    this.player.commandNamed({
      name: 'osd-overlay', id, z,
      format: data ? 'ass-events' : 'none',
      data,
      res_x: this.width, res_y: H,
    }).catch(() => {});
  }

  // Flat VCR blue with faint CRT scanlines
  #background() {
    const W = this.width;
    let lines = '';
    for (let y = 0; y < H; y += 4) lines += `m 0 ${y} l ${W} ${y} ${W} ${y + 2} 0 ${y + 2} `;
    return [
      `{\\an7\\pos(0,0)\\bord0\\shad0\\1c${c(BLUE)}\\p1}m 0 0 l ${W} 0 ${W} ${H} 0 ${H}{\\p0}`,
      `{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H000000&\\1a&HE0&\\p1}${lines}{\\p0}`,
    ].join('\n');
  }

  #blueScreen(now) {
    const W = this.width;
    const blink = Math.floor(now / 500) % 2 === 0;
    // Slow drift of everything by a few pixels, so nothing burns into the TV over hours
    const dx = Math.round(24 * Math.sin(now / 97000));
    const dy = Math.round(16 * Math.sin(now / 131000));
    const cx = W / 2 + dx;
    const cy = H / 2 + dy;
    const out = [];

    // Top corners: VCR state and clock
    const state = this.scene === 'loading' || (this.scene === 'playing' && !this.firstFrame) ? 'play' : 'stop';
    out.push(...vcrLabel(MARGIN + dx, MARGIN + dy, state, state === 'play' ? 'PLAY' : 'STOP'));
    const t = new Date(now);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    out.push(text(W - MARGIN + dx, MARGIN + dy, 9, 44, WHITE, hh, ':', blink ? 1 : 0, mm));

    if (this.scene === 'poweroff') {
      const reboot = this.info.reboot;
      out.push(text(cx, cy - 30, 5, 52, WHITE, reboot ? 'ПЕРЕЗАВАНТАЖУЮСЬ' : 'ВИМИКАЮСЬ', '...', Math.floor(now / 400) % 4));
      out.push(text(cx, cy + 60, 5, 26, PALE, reboot ? 'ПУЛЬТ ПІДКЛЮЧИТЬСЯ САМ' : 'ДО ЗУСТРІЧІ!'));
    } else if (this.scene === 'idle') {
      out.push(text(cx, cy - 40, 5, 64, WHITE, 'ВСТАВТЕ КАСЕТУ', '_', blink ? 1 : 0));
      if (this.remoteUrl) {
        out.push(text(cx, cy + 80, 5, 24, PALE, 'ПУЛЬТ НА ТЕЛЕФОНІ:'));
        out.push(text(cx, cy + 130, 5, 30, WHITE, this.remoteUrl));
      }
      // e.g. the downloads' disk is missing: the box works, but can't play anything
      if (this.info.warning) out.push(text(cx, cy + 220, 5, 28, YELLOW, `! ${this.info.warning}`));
    } else if (this.scene === 'error') {
      out.push(text(cx, cy - 90, 5, 52, WHITE, 'КАСЕТУ НЕ ПРОЧИТАНО', '_', blink ? 1 : 0));
      wrap(humanError(this.info.error ?? ''), 44).slice(0, 3).forEach((line, i) => {
        out.push(text(cx, cy + 20 + i * 50, 5, 26, PALE, line));
      });
    } else {
      // loading, or a film whose first frame hasn't arrived yet: text only, like a real VCR
      out.push(text(cx, cy - 30, 5, 52, WHITE, 'ЗАВАНТАЖУЮ КАСЕТУ', '...', Math.floor(now / 400) % 4));
      const title = [prettyName(this.info.title ?? ''), episodeText(this.info.episode)].filter(Boolean).join(' · ');
      if (title) out.push(text(cx, cy + 60, 5, 26, PALE, clip(title, 52)));
    }
    return out.join('\n');
  }

  // Messages over the film, like a VCR
  #vcrOsd(now) {
    const W = this.width;
    const s = this.player.state;
    const out = [];
    const counter = tapeCounter(s.position);

    // Top left: pause is persistent; otherwise the latest flash
    if (s.paused) {
      out.push(...vcrLabel(MARGIN, MARGIN, 'pause', 'PAUSE'));
      out.push(text(MARGIN, MARGIN + 80, 7, 40, WHITE, counter));
    } else if (this.flash?.kind === 'ff' || this.flash?.kind === 'rew') {
      out.push(...vcrLabel(MARGIN, MARGIN, this.flash.kind, counter));
    } else if (this.flash?.kind === 'start' || this.flash?.kind === 'play') {
      out.push(...vcrLabel(MARGIN, MARGIN, 'play', 'PLAY'));
      if (this.flash.kind === 'start') {
        const ep = episodeText(this.info.episode);
        if (ep) out.push(text(MARGIN, MARGIN + 80, 7, 36, WHITE, ep));
        out.push(text(MARGIN, H - MARGIN, 1, 30, WHITE, clip(prettyName(this.info.title ?? ''), 48)));
      }
    }

    // Top right: buffering
    if (this.bufferingSince && now - this.bufferingSince > BUFFERING_DELAY_MS && Math.floor(now / 500) % 2 === 0) {
      out.push(text(W - MARGIN, MARGIN, 9, 36, WHITE, 'ЗАВАНТАЖЕННЯ'));
    }

    // Bottom centre: volume bar
    if (this.flash?.kind === 'volume') {
      const vol = Math.round(s.volume ?? 0);
      const blocks = 20;
      const lit = Math.round((vol / 100) * blocks);
      const size = 30;
      const gap = 8;
      const barW = blocks * (size + gap) - gap;
      const x0 = W / 2 - barW / 2;
      const y0 = H - MARGIN - size;
      out.push(text(x0, y0 - 24, 1, 32, WHITE, 'VOLUME'));
      out.push(text(x0 + barW, y0 - 24, 3, 32, WHITE, String(vol)));
      for (let i = 0; i < blocks; i++) {
        const on = i < lit;
        out.push(box(x0 + i * (size + gap), y0, size, size, on ? GREEN : '000000', on ? 0 : 0x80, true));
      }
    }
    return out.join('\n');
  }
}

// ---- ASS helpers (colours are RRGGBB; ASS wants &HBBGGRR&) ----

function c(hex) {
  return `&H${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}&`;
}

// Braces and backslashes are ASS markup; keep them out of titles
function esc(s) {
  return String(s).replace(/[{}\\]/g, ' ');
}

// White blocky VCR text with a dark outline.
// `tail` (a blinking "_", counting "...", a clock's ":") shows its first `shown` characters; the rest
// is drawn transparent, so the line keeps its width and doesn't move — libass drops trailing
// spaces, which made centred text jump. `after` follows the tail and is always visible.
function text(x, y, an, size, color, str, tail = '', shown = tail.length, after = '') {
  const up = (s) => esc(s).toUpperCase();
  const HIDE = '{\\1a&HFF&\\3a&HFF&\\4a&HFF&}';
  const SHOW = '{\\1a&H00&\\3a&H00&\\4a&H60&}';
  let body = up(str) + up(tail.slice(0, shown));
  if (shown < tail.length) body += HIDE + up(tail.slice(shown)) + (after ? SHOW : '');
  body += up(after);
  return `{\\an${an}\\pos(${x},${y})\\fn${FONT}\\fs${size}\\bord4\\3c&H000000&\\shad4\\4c${c(SHADOW)}\\4a&H60&\\1c${c(color)}}${body}`;
}

function shape(x, y, color, path, outline = true) {
  return `{\\an7\\pos(${x},${y})\\bord${outline ? 4 : 0}\\3c&H000000&\\shad${outline ? 4 : 0}\\4c${c(SHADOW)}\\4a&H60&\\1c${c(color)}\\p1}${path}{\\p0}`;
}

function box(x, y, w, h, color, alpha = 0, outline = false) {
  return `{\\an7\\pos(${x},${y})\\bord${outline ? 3 : 0}\\3c&H000000&\\shad0\\1c${c(color)}\\1a&H${alpha.toString(16).padStart(2, '0')}&\\p1}m 0 0 l ${w} 0 ${w} ${h} 0 ${h}{\\p0}`;
}

// VCR icons, 44 px tall, drawn from (0,0)
const ICONS = {
  play: 'm 0 0 l 38 22 l 0 44',
  pause: 'm 0 0 l 14 0 14 44 0 44 m 24 0 l 38 0 38 44 24 44',
  stop: 'm 0 0 l 40 0 40 40 0 40',
  ff: 'm 0 0 l 30 22 l 0 44 m 30 0 l 60 22 l 30 44',
  rew: 'm 30 0 l 0 22 l 30 44 m 60 0 l 30 22 l 60 44',
};

// Icon + label in the top-left corner, e.g. ▶ PLAY
function vcrLabel(x, y, icon, label) {
  const iconW = icon === 'ff' || icon === 'rew' ? 60 : 40;
  return [shape(x, y, WHITE, ICONS[icon]), text(x + iconW + 28, y - 2, 7, 44, WHITE, label)];
}

// ---- Text helpers ----

function tapeCounter(seconds) {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function episodeText(ep) {
  return ep ? `СЕРІЯ ${ep.index + 1}/${ep.count}` : '';
}

// Torrent names for people (same rule as the phone remote)
function prettyName(name) {
  return name.replace(/\.(mkv|mp4|m4v|avi|mov|webm|ogv|mpe?g|m2?ts)$/i, '').replace(/[._]+/g, ' ').trim();
}

// Server errors are English; the TV speaks Ukrainian (same wording as the phone remote)
function humanError(message) {
  if (/no peers/i.test(message)) return 'Ніхто не роздає цей торрент. Спробуйте інше посилання.';
  if (/not a valid magnet/i.test(message)) return 'Це не схоже на magnet-посилання.';
  if (/no video/i.test(message)) return 'У цьому торренті немає відео.';
  if (/disk space/i.test(message)) return 'Не вистачає місця на диску.';
  if (/mpv could not play/i.test(message)) return 'Цей файл не відтворюється.';
  return message;
}

function clip(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function wrap(s, width) {
  const lines = [];
  let line = '';
  for (const word of s.split(/\s+/)) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
