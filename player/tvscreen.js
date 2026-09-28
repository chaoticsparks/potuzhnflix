// tvscreen.js — what the TV shows around the film, VHS style, drawn with mpv's OSD (ASS markup):
// a synthwave night scene when idle (sun, palms, a moving neon grid), a VCR blue screen while loading /
// on error, and VCR-like messages over the film (▶ PLAY, ❚❚ PAUSE, seek counter, volume bar, buffering).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-generator';

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
const SHADOW = '120c5c';
const REC_RED = 'ff2a1f';
// Synthwave idle scene
const HORIZON = 640;
const SKY = [[0, '0a0420'], [0.45, '250a58'], [0.75, '5e1580'], [0.9, 'b0278c'], [1, 'ff5a8c']];
const FLOOR = [[0, '2a0a4e'], [0.25, '160530'], [1, '06020e']];
const SUN = [[0, 'ffe46b'], [0.5, 'ff9a3d'], [1, 'ff3f8e']];
const PINK = 'ff3fb4';
const NIGHT = '0a0214';          // palm silhouettes
const GRID_PERIOD = 3000;        // ms for the grid to move by one line
const GRID_FPS = 7.5;            // each grid frame re-renders the whole OSD: ~37 % of a Pi 4 core at 15 fps
const PANEL_PAD = 24;
const QR_TEXT_W = 480;           // text column beside the QR code
const NEON_TITLE = `\\3c${c('2a0650')}\\4c${c(PINK)}\\4a&H30&\\shad6`;
// QR: dark on light (phones read inverted codes poorly); not pure white, it sits on the TV for hours
const QR_PAPER = 'e4eaff';
const QR_INK = '0a1a66';
const QR_MODULE = 8;       // px per module: 25 modules + quiet zone ≈ 250 px, scannable from the sofa
const MAX_TV_DOWNLOADS = 3;

export class TvScreen {
  // remoteUrl: shown as text (e.g. http://tvbox.local); qrUrl(): what the QR code opens — the IP
  // address, since many Android phones can't resolve .local names
  constructor(player, { remoteUrl = null, qrUrl = null } = {}) {
    this.player = player;
    this.remoteUrl = remoteUrl;
    this.qrUrl = qrUrl;
    this.width = 1920;
    this.scene = 'idle';        // idle | loading | error | playing
    this.info = {};             // { title, error, episode: { index, count } }
    this.sent = new Map();      // overlay id → last data sent
    this.synthCache = { key: null, data: '' };
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
    const synth = this.scene === 'idle';
    const d = drift(now);
    // Layers: 1 = still background (resent only when the drift moves it), 3 = the moving grid, 2 = text
    this.#send(1, synth ? this.#synthBackground(d) : blue ? this.#background() : '', 0);
    this.#send(3, synth ? synthGrid(this.width, d, now) : '', 1);
    this.#send(2, blue ? this.#blueScreen(now, d) : this.#vcrOsd(now), 2);
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

  #synthBackground({ dx, dy }) {
    const key = `${this.width}|${dx}|${dy}`;
    if (this.synthCache.key !== key) this.synthCache = { key, data: synthScene(this.width, dx, dy) };
    return this.synthCache.data;
  }

  #blueScreen(now, { dx, dy }) {
    const W = this.width;
    const blink = Math.floor(now / 500) % 2 === 0;
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
      out.push(...this.#idle(dx, dy, blink));
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

  // "Insert a tape" over the synthwave scene; on the grid below the sun, two OSD panels: a QR code
  // with the remote's address, and what is recording to the shelf
  #idle(dx, dy, blink) {
    const W = this.width;
    const out = [text(W / 2 + dx, 215 + dy, 5, 60, WHITE, 'ВСТАВТЕ КАСЕТУ', '_', blink ? 1 : 0, '', NEON_TITLE)];
    // e.g. the downloads' disk is missing: the box works, but can't play anything
    if (this.info.warning) out.push(text(W / 2 + dx, 295 + dy, 5, 26, YELLOW, `! ${this.info.warning}`));

    const downloads = this.info.downloads ?? [];
    const bottom = H - MARGIN + dy;
    let panelH = 250 + 2 * PANEL_PAD;
    let nextX = MARGIN + dx;

    if (this.remoteUrl) {
      const target = this.qrUrl?.() ?? this.remoteUrl;
      const qr = qrCode(target);
      const w = PANEL_PAD + qr.size + 40 + QR_TEXT_W + PANEL_PAD;
      panelH = qr.size + 2 * PANEL_PAD;
      // Alone it sits in the middle; with downloads beside it, on the left
      const x = downloads.length ? MARGIN + dx : Math.round((W - w) / 2) + dx;
      const y = bottom - panelH;
      out.push(panel(x, y, w, panelH));
      const qx = x + PANEL_PAD;   // whole pixels keep the QR modules sharp
      const qy = y + PANEL_PAD;
      out.push(box(qx, qy, qr.size, qr.size, QR_PAPER));
      out.push(`{\\an7\\pos(${qx},${qy})\\bord0\\shad0\\1c${c(QR_INK)}\\p1}${qr.path}{\\p0}`);
      const tx = qx + qr.size + 40;
      // The address must fit beside the code; an IP with a port is longer than tvbox.local
      const urlSize = Math.min(28, Math.floor(QR_TEXT_W / this.remoteUrl.length));
      out.push(text(tx, qy + 30, 7, 22, PALE, 'ПУЛЬТ НА ТЕЛЕФОНІ:'));
      out.push(text(tx, qy + 80, 7, urlSize, WHITE, this.remoteUrl));
      if (target !== this.remoteUrl) out.push(text(tx, qy + 122, 7, 20, PALE, `АБО ${new URL(target).host}`));
      out.push(text(tx, qy + 172, 7, 20, PALE, 'НАВЕДІТЬ КАМЕРУ'));
      out.push(text(tx, qy + 207, 7, 20, PALE, 'ТЕЛЕФОНА НА КОД'));
      nextX = x + w + 40;
    }

    // Downloads in progress, like a VCR recording: blinking red REC dot
    if (downloads.length) {
      const x = nextX;
      const w = W - MARGIN + dx - x;
      const y = bottom - panelH;
      const left = x + PANEL_PAD;
      const right = x + w - PANEL_PAD;
      out.push(panel(x, y, w, panelH));
      if (blink) out.push(box(left, y + PANEL_PAD + 2, 20, 20, REC_RED));
      out.push(text(left + 36, y + PANEL_PAD, 7, 24, WHITE, 'ЗАПИС НА ПОЛИЦЮ'));
      const nameChars = Math.max(8, Math.floor((right - left - 230 - 110) / 22));
      downloads.slice(0, MAX_TV_DOWNLOADS).forEach((d, i) => {
        const ly = y + PANEL_PAD + 56 + i * 46;
        const name = d.parts ? `${prettyName(d.title)} ${d.parts}` : prettyName(d.title);
        out.push(text(left, ly, 7, 22, PALE, clip(name, nameChars)));
        out.push(text(right - 230, ly, 9, 22, WHITE, `${Math.floor(d.progress * 100)}%`));
        out.push(text(right, ly, 9, 22, WHITE, `${(d.speed / 1024 ** 2).toFixed(1)} МБ/С`));
      });
      if (downloads.length > MAX_TV_DOWNLOADS) {
        out.push(text(left, y + PANEL_PAD + 56 + MAX_TV_DOWNLOADS * 46, 7, 20, PALE, `+${downloads.length - MAX_TV_DOWNLOADS} ЩЕ`));
      }
    }
    return out;
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
// `style`: extra ASS overrides (e.g. a neon shadow).
function text(x, y, an, size, color, str, tail = '', shown = tail.length, after = '', style = '') {
  const up = (s) => esc(s).toUpperCase();
  const HIDE = '{\\1a&HFF&\\3a&HFF&\\4a&HFF&}';
  const SHOW = '{\\1a&H00&\\3a&H00&\\4a&H60&}';
  let body = up(str) + up(tail.slice(0, shown));
  if (shown < tail.length) body += HIDE + up(tail.slice(shown)) + (after ? SHOW : '');
  body += up(after);
  return `{\\an${an}\\pos(${x},${y})\\fn${FONT}\\fs${size}\\bord4\\3c&H000000&\\shad4\\4c${c(SHADOW)}\\4a&H60&\\1c${c(color)}${style}}${body}`;
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

// QR code as one ASS drawing: dark modules merged into horizontal runs, 3-module quiet zone.
// Built once per address.
const qrCache = new Map();
function qrCode(url) {
  if (qrCache.has(url)) return qrCache.get(url);
  const q = qrcode(0, 'M');
  q.addData(url);
  q.make();
  const n = q.getModuleCount();
  const quiet = 3;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n;) {
      if (!q.isDark(r, col)) { col++; continue; }
      let end = col;
      while (end < n && q.isDark(r, end)) end++;
      const x0 = (col + quiet) * QR_MODULE;
      const x1 = (end + quiet) * QR_MODULE;
      const y0 = (r + quiet) * QR_MODULE;
      const y1 = y0 + QR_MODULE;
      path += `m ${x0} ${y0} l ${x1} ${y0} ${x1} ${y1} ${x0} ${y1} `;
      col = end;
    }
  }
  const qr = { size: (n + 2 * quiet) * QR_MODULE, path };
  qrCache.set(url, qr);
  return qr;
}

// ---- Synthwave idle scene ----

// Slow drift of everything by a few pixels, so nothing burns into the TV over hours.
// In 2 px steps: the still background is only resent when it actually moves (every few seconds).
function drift(now) {
  return {
    dx: 2 * Math.round(12 * Math.sin(now / 97000)),
    dy: 2 * Math.round(8 * Math.sin(now / 131000)),
  };
}

// Solid (or translucent) ASS drawing in screen coordinates
function fill(path, color, alpha = 0) {
  return `{\\an7\\pos(0,0)\\bord0\\shad0\\1c${c(color)}\\1a&H${alpha.toString(16).padStart(2, '0')}&\\p1}${path}{\\p0}`;
}

function poly(points) {
  const [first, ...rest] = points.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`);
  return `m ${first} l ${rest.join(' ')} `;
}

function circle(cx, cy, r) {
  const k = 0.5523 * r;
  const p = (...v) => v.map(Math.round).join(' ');
  return `m ${p(cx, cy - r)} b ${p(cx + k, cy - r, cx + r, cy - k, cx + r, cy)} b ${p(cx + r, cy + k, cx + k, cy + r, cx, cy + r)} `
    + `b ${p(cx - k, cy + r, cx - r, cy + k, cx - r, cy)} b ${p(cx - r, cy - k, cx - k, cy - r, cx, cy - r)} `;
}

// Colour along a gradient given as [[t, 'rrggbb'], ...]
function mix(stops, t) {
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, a] = stops[i];
  const [t1, b] = stops[i + 1];
  const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const ch = (s, o) => parseInt(s.slice(o, o + 2), 16);
  return [0, 2, 4].map((o) => Math.round(ch(a, o) + (ch(b, o) - ch(a, o)) * k).toString(16).padStart(2, '0')).join('');
}

// Same stars every time
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The still part: sky in bands, stars, a striped sun, mountains, the floor with the grid's
// vanishing lines, palms, CRT scanlines. Drawn past the edges so the drift never shows a gap.
function synthScene(W, dx, dy) {
  const out = [];
  const L = -40;
  const R = W + 40;
  const hz = HORIZON + dy;
  const cx = W / 2 + dx;

  // Sky: banded gradient, like a cheap 90s render
  const bands = 36;
  for (let i = 0; i < bands; i++) {
    const y0 = Math.round(-40 + ((hz + 40) * i) / bands);
    const y1 = Math.round(-40 + ((hz + 40) * (i + 1)) / bands);
    out.push(fill(poly([[L, y0], [R, y0], [R, y1], [L, y1]]), mix(SKY, (i + 0.5) / bands)));
  }

  // Stars in the upper sky
  const rnd = random(1987);
  const stars = [[], []];
  for (let i = 0; i < 80; i++) {
    const x = L + rnd() * (R - L) + dx;
    const y = -20 + rnd() * hz * 0.55;
    const s = rnd() < 0.2 ? 4 : 2;
    stars[rnd() < 0.35 ? 0 : 1].push(poly([[x, y], [x + s, y], [x + s, y + s], [x, y + s]]));
  }
  out.push(fill(stars[0].join(''), 'ffffff', 0x20), fill(stars[1].join(''), 'e8d0ff', 0x90));

  // Sun: glow, then gradient bands with the classic gaps widening towards the horizon
  const r = 240;
  const sy = hz - 90;
  out.push(fill(circle(cx, sy, r + 60), 'ff3f8e', 0xe0), fill(circle(cx, sy, r + 28), 'ff5aa0', 0xc0));
  const half = (y) => Math.sqrt(Math.max(0, r * r - (y - sy) ** 2));
  const top = sy - r;
  const solid = [];   // [y0, y1] stripes between the gaps
  let from = top;
  for (let k = 0, g = sy - r * 0.15; g < hz; k++, g += 28 + 2 * k) {
    solid.push([from, g]);
    from = g + 3 + 2.5 * k;
  }
  if (from < hz) solid.push([from, hz]);
  for (const [s0, s1] of solid) {
    for (let y0 = s0; y0 < s1; y0 += 10) {   // 10 px slices for the colour gradient
      const y1 = Math.min(y0 + 10, s1);
      const ys = [y0, (y0 + y1) / 2, y1];
      const pts = [...ys.map((v) => [cx + half(v), v]), ...ys.reverse().map((v) => [cx - half(v), v])];
      out.push(fill(poly(pts), mix(SUN, (y0 - top) / (hz - top))));
    }
  }

  // Mountains at both sides, far range lighter than the near one
  const far = [[-0.03, 0], [0.04, -70], [0.09, -40], [0.15, -125], [0.21, -60], [0.27, -95], [0.33, -30], [0.39, 0]];
  const near = [[-0.03, 0], [0.03, -45], [0.08, -22], [0.13, -60], [0.2, -12], [0.25, 0]];
  for (const [range, color] of [[far, '2a0d52'], [near, '160630']]) {
    for (const side of [1, -1]) {
      const pts = range.map(([fx, fy]) => [side > 0 ? fx * W + dx : W - fx * W + dx, hz + fy]);
      out.push(fill(poly(pts), color));
    }
  }

  // Floor, and the grid lines running to the vanishing point
  const floorBands = 14;
  for (let i = 0; i < floorBands; i++) {
    const y0 = Math.round(hz + ((H + 40 - hz) * i) / floorBands);
    const y1 = Math.round(hz + ((H + 40 - hz) * (i + 1)) / floorBands);
    out.push(fill(poly([[L, y0], [R, y0], [R, y1], [L, y1]]), mix(FLOOR, (i + 0.5) / floorBands)));
  }
  let lines = '';
  for (let i = -22; i <= 22; i++) {
    const tx = cx + i * 14;
    const bx = cx + i * 170;
    lines += poly([[tx - 1, hz], [tx + 1, hz], [bx + 3, H + 40], [bx - 3, H + 40]]);
  }
  out.push(fill(lines, PINK, 0x50));
  out.push(fill(poly([[L, hz - 8], [R, hz - 8], [R, hz + 8], [L, hz + 8]]), PINK, 0xb0));
  out.push(fill(poly([[L, hz - 2], [R, hz - 2], [R, hz + 2], [L, hz + 2]]), 'ff8ad6'));

  // Palms: a tall and a short one at each side, leaning inwards
  out.push(...palm(200 + dx, hz + 170, 560, 70, 16));
  out.push(...palm(340 + dx, hz + 90, 380, 30, 12));
  out.push(...palm(W - 190 + dx, hz + 190, 600, -80, 17));
  out.push(...palm(W - 350 + dx, hz + 100, 360, -25, 11));

  // CRT scanlines over everything
  let scan = '';
  for (let y = 0; y < H; y += 4) scan += `m 0 ${y} l ${W} ${y} ${W} ${y + 2} 0 ${y + 2} `;
  out.push(fill(scan, '000000', 0xe0));
  return out.join('\n');
}

// A palm silhouette: base (bx, by), height h, top shifted by `lean`, trunk half-width `size`.
// Each part is its own drawing: overlapping subpaths of one drawing can cancel each other out.
function palm(bx, by, h, lean, size) {
  const out = [];
  const tx = bx + lean;
  const ty = by - h;
  const qx = bx + lean * 0.1;
  const qy = by - h * 0.55;
  const right = [];
  const left = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = (1 - t) ** 2 * bx + 2 * (1 - t) * t * qx + t * t * tx;
    const y = (1 - t) ** 2 * by + 2 * (1 - t) * t * qy + t * t * ty;
    const w = size * (1 - 0.5 * t) * (i % 2 ? 1.12 : 1);   // trunk rings
    right.push([x + w, y]);
    left.push([x - w, y]);
  }
  out.push(fill(poly([...right, ...left.reverse()]), NIGHT));

  // Fronds: [angle° (0 = right, 90 = up), length, droop]; mirrored when the palm leans left
  const L = h * 0.5;
  const fronds = [[165, 1, 0.95], [140, 0.9, 0.7], [115, 0.7, 0.45], [80, 0.6, 0.35], [50, 0.85, 0.65], [18, 1, 0.95], [98, 0.45, 0.2]];
  for (const [deg, len, droop] of fronds) {
    const a = ((lean < 0 ? 180 - deg : deg) * Math.PI) / 180;
    const ux = Math.cos(a) * L * len;
    const uy = -Math.sin(a) * L * len;
    const upper = [];
    const lower = [];
    const m = 18;
    for (let i = 0; i <= m; i++) {
      const t = i / m;
      const px = tx + ux * t;
      const py = ty + uy * t + droop * L * t * t;
      const vx = ux;
      const vy = uy + 2 * droop * L * t;
      const len2 = Math.hypot(vx, vy) || 1;
      let nx = -vy / len2;
      let ny = vx / len2;
      if (ny > 0) { nx = -nx; ny = -ny; }   // n points up: leaflets hang down
      const w = size * 1.6 * Math.sin(Math.PI * t) ** 0.6 * (1 - 0.3 * t);
      upper.push([px + nx * w * 0.35, py + ny * w * 0.35]);
      lower.push([px - nx * w * (i % 2 ? 1.25 : 0.3), py - ny * w * (i % 2 ? 1.25 : 0.3)]);   // jagged leaflets
    }
    out.push(fill(poly([...upper, ...lower.reverse()]), NIGHT));
  }
  // Coconuts
  for (const [ox, oy] of [[-0.6, 0.5], [0.5, 0.6], [0, 0.9]]) out.push(fill(circle(tx + ox * size, ty + oy * size, size * 0.55), NIGHT));
  return out;
}

// The moving part: horizontal grid lines coming towards the viewer
function synthGrid(W, { dx, dy }, now) {
  const hz = HORIZON + dy;
  const depth = (H - HORIZON) * 0.6;   // a line at distance 0.6 sits at the bottom of the screen
  const frame = Math.floor(now / (1000 / GRID_FPS)) * (1000 / GRID_FPS);
  const phase = (frame % GRID_PERIOD) / GRID_PERIOD;
  const out = [];
  for (let k = 0; k < 40; k++) {
    const z = 0.3 * (k + 1 - phase);
    const y = Math.round(hz + depth / z);
    if (y > H + 10) continue;
    if (y - hz < 5) break;
    const thick = Math.max(2, Math.round(4 / (z + 0.3)));
    const near = (y - hz) / (H - HORIZON);   // 0 at the horizon, 1 at the bottom
    const alpha = Math.round(0xd0 - near * 0xc0);
    out.push(fill(poly([[-40 + dx, y], [W + 40 + dx, y], [W + 40 + dx, y + thick], [-40 + dx, y + thick]]), PINK, alpha));
  }
  return out.join('\n');
}

// Translucent OSD panel with a neon edge, so text and the QR stay readable over the scene
function panel(x, y, w, h) {
  return [
    fill(poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]), '0c0322', 0x38),
    fill(poly([[x, y], [x + w, y], [x + w, y + 3], [x, y + 3]]), PINK, 0x20),
    fill(poly([[x, y + h - 3], [x + w, y + h - 3], [x + w, y + h], [x, y + h]]), PINK, 0x20),
  ].join('\n');
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
