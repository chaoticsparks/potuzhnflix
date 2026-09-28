# ПотужнFLIX: приставка для телевизора

Контекст проекта, перенесённый из чата в claude.ai. Этот файл лежит в корне репозитория, и Claude Code читает его автоматически.

## Идея

Самодельная приставка, которая подключается к телевизору по HDMI и выходит в интернет через домашний Wi‑Fi.

**Name: «ПотужнFLIX»** (logo: `logo.png` in the repo root). UI language: Ukrainian.

- **Управление:** с телефона через простое PWA. Пользователь вставляет magnet-ссылку или выбирает .torrent файл и нажимает «Смотреть» или «Скачать».
- **Воспроизведение:** приставка скачивает фильм по торренту во временное хранилище и сразу начинает показ, не дожидаясь полной загрузки. Торрент с несколькими видео (сериал) играет как плейлист.
- **Видео идёт по HDMI прямо на телевизор.** На телефон видео НЕ передаётся: телефон работает только как пульт (пауза, громкость, перемотка, дорожки).
- **По сети между телефоном и приставкой** ходят только команды и статус. Весь тяжёлый трафик идёт из интернета в приставку, а оттуда по HDMI в телевизор.

## Архитектура

```
Телефон (PWA) ──REST/WebSocket──► Backend на приставке
                                     │
                     ┌───────────────┴────────────────┐
                     ▼                                ▼
          Библиотека загрузок ──► Торрент-движок ──HTTP (localhost)──► mpv ──HDMI──► ТВ
      (library.json, очистка)   (последовательная загрузка,
                                 Range-запросы, кэш на USB)
```

- **mpv:** управляется через JSON IPC-сокет. На Pi выводит видео напрямую в DRM/KMS, без рабочего стола.
- **Торрент-движок (WebTorrent):** качает куски последовательно, с приоритетом на текущую позицию. Перемотка переключает приоритет. Файл отдаётся по HTTP с поддержкой Range, и его забирает mpv.
- **Библиотека загрузок:** всё, что смотрели или скачали, с паузой, «оставить», удалением и автоочисткой.
- **Input: a magnet link or a .torrent file uploaded from the phone.** Search and content providers (Internet Archive etc.) were built and then removed on the user's decision: no search, no .torrent URLs. The box does not integrate with any trackers or catalogues. (.torrent upload was added later at the user's request: not every release has a magnet. It also makes web-seed-only torrents like Internet Archive's work, which time out as magnets.)

## Стек

Raspberry Pi OS Lite (64-bit), Node.js 20+ (ESM), WebTorrent, mpv, Fastify, WebSocket, PWA на Svelte, systemd, Avahi (mDNS, `tvbox.local`).

## Железо (решено)

Цель: Full HD. От 4K отказались: дорого, и фильмы качаются медленнее.

- **Raspberry Pi 4 Model B Starter Kit, 4 ГБ (официальный).**
  - В комплекте: плата, официальный БП USB‑C 5 В/3 А, кабель micro‑HDMI, официальный корпус, microSD SanDisk 32 ГБ.
  - Pi 4 аппаратно декодирует H.264 и H.265 в 1080p.
  - Видео выводится через порт HDMI0, ближний к разъёму питания.
- **Lexar JumpDrive D500, 128 ГБ.**
  - Твердотельный USB-накопитель (USB 3.2 Gen 1, запись до 360 МБ/с), подключается в синий порт USB 3.0.
  - Хранит временные файлы торрентов.
- **Наклеиваемые радиаторы.** Официальный корпус не охлаждается, при перегреве можно добавить официальный Case Fan.
- **Опционально:** Ethernet-кабель, картридер для microSD.
- **Не нужны:** клавиатура, мышь, монитор. Настройка идёт headless по SSH.
- **Что рассматривали и отклонили:**
  - Intel N100 / Radxa X4: нужны только для 4K.
  - Raspberry Pi 5: не умеет аппаратно декодировать H.264.
  - Безымянный «Lenovo SSD» с Prom: подделка, характеристики противоречат сами себе.

## План по этапам

1. **Плеер (mpv).** ✅ ГОТОВО
   - Управление через IPC: пауза, громкость, перемотка, дорожки, стоп.
   - Состояние (позиция, длительность, громкость, буферизация) обновляется в реальном времени.
   - Экран ожидания на ТВ: ✅ synthwave idle scene, VCR blue screen for loading / errors, VCR OSD (see `player/tvscreen.js`).
2. **Торрент-движок.** ✅ POC DONE (`npm run play -- "<magnet>"`, see `torrent/`, `library/`)
   - Принимает magnet-ссылку, сам выбирает, что играть: фильм, фильм из частей или серии сериала (плейлист).
   - Качает последовательно, при перемотке меняет приоритет кусков.
   - Раздаёт файл локальным HTTP-сервером с поддержкой Range.
   - Отдаёт статус: процент загрузки, скорость, пиры.
   - Чистит кэш после просмотра или при заполнении диска. → Done as a download library: play or download-only, pause/resume, keep, delete, auto-cleanup by age and free space (see `library/`).
   - Результат этапов 1–2: фильм по magnet-ссылке играет из командной строки.
3. ~~**Поиск.**~~ Dropped: built (Internet Archive + magnet providers), then removed. Input is magnet links only. Stage numbers are kept as they are.
4. **Backend.** Fastify. ✅ POC DONE (`npm start`, see `server/`; REST under `/api/`)
   - REST: `/api/play`, `/api/control`, `/api/stop`, `/api/downloads`, `/api/storage`.
   - WebSocket со статусом и списком загрузок.
   - Раздаёт PWA.
   - Связывает библиотеку загрузок → mpv.
5. **PWA-пульт.** ✅ DONE (`npm run build`, see `web/`). Not yet tried on a real phone.
   - Поле для magnet-ссылки: «Смотреть» / «Скачать».
   - Экран пульта: пауза, ползунок перемотки, громкость, ±10 с, субтитры и аудиодорожки. For series: episode name, next / previous.
   - Downloads screen: list with progress / state / expiry, pause/resume, keep, delete, free disk space. Series: episode list with per-episode progress, "continue from episode N".
   - Устанавливается на главный экран телефона.
   - Результат: полностью рабочий пульт с телефона (пока на компьютере).
6. **Перенос на Pi.** ← IN PROGRESS: runs on the Pi as a service; blue screen, playback (smooth, hardware decoding), HDMI sound, phone remote and temperature confirmed by the user on the real TV. Left: Lexar (not delivered yet) → move downloads there; optional: DHCP reservation, heatsinks, a real 1080p HEVC film.
   - Запись ОС, Wi‑Fi, SSH, монтирование Lexar.
   - mDNS `tvbox.local`.
   - systemd-сервисы с автозапуском и перезапуском при сбое.
   - Настройка вывода mpv в DRM, проверка нагрева.
   - Результат: готовая приставка.
7. **Улучшения (по желанию).**
   - ~~HDMI-CEC: автовключение ТВ и переключение входа.~~ ✅ DONE (see `server/cec.js`): auto power-on + input switch at boot and on wake from the screen saver; the TV goes to standby when the screen saver starts.
   - Продолжение просмотра с места остановки, история.
   - Автопоиск субтитров.
   - Индикатор буферизации на ТВ.

Этапы 1–5 разрабатываются на обычном компьютере, пока едет железо.

## Текущее состояние кода

```
tvbox/
  CLAUDE.md
  README.md           # install and run instructions (mpv, Node.js)
  logo.png            # the logo, source for the icons in web/public
  package.json        # "type": "module", скрипты: player / player:pi / play / play:pi / start / start:pi / build / dev:web
  deploy/
    setup-pi.sh       # one-time root setup on the Pi (run by the user with sudo; idempotent)
    use-disk.sh       # downloads into <folder> on an existing disk (never formats); --off reverts
    lib.sh            # put(): power-cut-safe file writes, shared by the scripts
    potuzhnflix.service  # systemd unit template (@USER@, @DIR@, @CACHE@)
  scripts/
    tv-fonts.mjs      # WOFF → TTF for mpv's OSD (runs in `npm run build`), output player/fonts (git-ignored)
  player/
    player.js         # класс MpvPlayer (EventEmitter)
    tvscreen.js       # TvScreen: the TV picture around the film (synthwave idle, VCR blue screen, VCR OSD), ASS via osd-overlay
    cli.js            # консольный пульт для ручной проверки
  torrent/
    engine.js         # TorrentEngine: many torrents in one WebTorrent client, per-file selection, HTTP streaming
    cli.js            # magnet [--episode n] → library → mpv, auto-advances episodes, prints download status
  library/
    library.js        # Library: persistent downloads, playlists, pause/resume/keep/delete, auto-cleanup
  server/
    tvbox.js          # TvBox: library → mpv, one playback, episodes, status
    index.js          # Fastify: REST /api/*, WebSocket /ws, static web/dist
    health.js         # health(): temperature, power warnings, CPU, memory, network, uptime
    cec.js            # Cec: turn the TV on/off and switch input over HDMI-CEC (cec-ctl)
  web/                # phone remote: Svelte 5 + Vite, built into web/dist (git-ignored)
    vite.config.js    # root web/, dev server :5173 proxies /api and /ws to the backend
    index.html
    public/           # manifest.webmanifest, icons (from logo.png), logo.jpg, mark.png
    src/
      main.js, App.svelte    # shell: header, tabs Пульт / Полиця, offline banner, toasts
      app.css                # design tokens and shared styles
      lib/                   # api.js (REST), live.svelte.js (WebSocket state), toast, format (uk)
      components/            # Remote, Shelf, Tape, MagnetForm, TrackSheet, PowerSheet, Health, Icon
```

### `torrent/engine.js`, class `TorrentEngine`

- Low-level; `Library` is the only intended user. One WebTorrent client, several torrents at once.
- Disk layout under the cache dir (`TVBOX_CACHE` env, default `$TMPDIR/tvbox-cache`; on the Pi → the Lexar):
  - `data/<infoHash>/<paths from the torrent>`: downloaded files. One folder per torrent, so deleting is `rm -r`.
  - `torrents/<infoHash>.torrent`: metadata saved after the first add; re-adding after a restart needs no network and no magnet wait.
  - `torrents/<infoHash>.bitfield`: which pieces are on disk (WebTorrent's `bitfield` add option). Saved every 30 s, when a file finishes, on `remove()` and `destroy()`; temp + rename, serialised per torrent (several files finishing at once raced on one temp file). With it WebTorrent trusts the data, spot-checks ≤ 2 pieces per file and re-hashes only on a mismatch: a torrent is ready in ~20 ms instead of minutes (first full check of a 32 GB series with 7.6 GB on the USB HDD: ~3 min).
  - `torrents/.clean-shutdown`: written by `destroy()`, consumed by `start()` (called from `Library.load()`). Bitfields are trusted only if it was there; otherwise (power cut: newest pieces may not be on disk yet) all `.bitfield` files are deleted and the data is re-hashed once.
  - `library.json`: see `Library`.
- `add(source)`: magnet link, .torrent contents (Buffer, from an upload) or a bare info hash (used internally to reload) → ready `Torrent`. Invalid → 400 "Not a valid magnet link" / "Not a valid .torrent file" (buffers ≤ 20 bytes are rejected: parse-torrent would read them as a raw info hash). The info hash is parsed first (`parse-torrent`), so an already loaded torrent is reused (WebTorrent refuses duplicates), and saved metadata is used when present. Added with `deselect: true`. Metadata timeout 90 s ("no peers found"), counted only until the `metadata` event: verifying data already on disk can take minutes and used to hit the timeout ("Torrent is not loaded" when resuming a big series).
- Magnets need real BitTorrent peers for metadata. Torrents served only by web seeds (e.g. Internet Archive: HTTP only, no peers) time out as magnets.
- `setSelection(infoHash, indexes)`: exactly these files download. Deselects first, then selects, because neighbouring files can share a boundary piece.
- `streamUrl(infoHash, index)`: local HTTP server on `127.0.0.1` (random port), `/<infoHash>/<index>/<name>`. Single `Range` (206/416) and HEAD. Each Range read calls `file.createReadStream({start, end})`, which makes WebTorrent prioritise the pieces there, so seeking moves the download position. Strategy is WebTorrent's default `sequential`.
- Emits `file-done (infoHash, index)`. Files already complete when a torrent loads are detected by `Library` via `fileStats().done`.
- `pickVideoFiles(files)`: what to play: one film, a film in parts, or the episodes of a series, in natural order (`E2` < `E10`). Skips samples / trailers / extras (by name) and files under 5 % of the largest. Same video in several formats (`ep1.mp4` + `ep1.ogv` + `ep1_512kb.mp4`) → one: container rank first (mkv, mp4, m4v, avi, …, webm, ogv: H.264/H.265 first, the Pi decodes those in hardware), then size.
- Disk quirks seen on Windows: a file is allocated at full length on first write; boundary pieces leave small scraps in neighbouring files; torrents may contain `.____padding_file` entries.
- npm skips install scripts for `node-datachannel`, `bufferutil`, `utf-8-validate`, `utp-native`. Harmless: `node-datachannel` ships a prebuilt binary (WebRTC peers work), `bufferutil`/`utf-8-validate` are optional `ws` speed-ups, without `utp-native` peers use TCP (plus web seeds).

### `library/library.js`, class `Library`

- An **item** is one torrent (one magnet), played as a **playlist** of the video files `pickVideoFiles` chose: a film (one file), a film in parts, or the episodes of a series. Id = info hash (items from older versions may have `<infoHash>-<n>` ids; lookups by torrent go through `infoHash`). Title = torrent name.
- Stored in `library.json` (`{version: 2, items}`; v1 items with a single file are migrated on load). **Power-cut safe** (the box gets unplugged): new file written to `.tmp`, fsync'ed, the old one renamed to `library.json.bak`, then `.tmp` → `library.json`, then the directory is fsync'ed. Save within 2 s of a real change, within 10 s of mere download progress (SD wear); a pending timer is only brought forward, never restarted. Loading: `library.json` → `.bak` → rebuilt from `torrents/*.torrent` (progress found again when torrents verify their data). Never refuses to start: an empty library would make orphan cleanup erase every download. BOM tolerated.
- Item: `{id, infoHash, title, files: [{index, name, path, length, downloaded, done, wanted}], episode, state: downloading|paused|complete, keep, addedAt, completedAt, lastPlayedAt, lastActivityAt}` (timestamps in ms). `episode` = last played entry of `files`. **Episode choice:** `wanted` per file (default true; older items migrated to true). Only wanted files download; the item is `complete` when every wanted file is done (and at least one is wanted); progress and space checks count wanted files only. `setWanted(id, episodePositions)` (checks disk space for the extra, reverts on 507; complete ↔ downloading as needed). Unwanted files keep what they already downloaded — deleting one file of a torrent would break the boundary pieces it shares. Watching an episode sets `wanted`; the next episode is still prefetched while watching.
- API: `load()`, `add(magnet)` (the same torrent again returns the existing item; resolves after metadata), `stream(id, episode?)` → local path if that file is done (mpv plays it directly) or stream URL; episode defaults to the last played; `release(id)`, `pause(id)`, `resume(id)`, `setKeep(id, bool)`, `remove(id)`, `cleanup()`, `list()`, `get(id)`, `storage()`, `close()`. Emits `changed` (on every change and every second while downloading).
- `view(item)`: `{id, title, length, downloaded, wantedLength, wantedDownloaded, wantedCount, wantedDone, progress (of wanted), state, waiting, playing, keep, downloadSpeed, peers, episode, files: [{name, length, downloaded, progress, done}], addedAt, completedAt, lastPlayedAt, expiresAt}` (totals are sums over files).
- `#sync()` (serialised) makes torrents match item states: a torrent is loaded only while one of its files is wanted. Wanted = the playing episode **and the next one** (prefetch), or, when nothing plays, every unfinished file of `downloading` items. Torrents still loading metadata or claimed by an `add()` in progress are never stopped by it.
- **While something plays, every other download waits** (`waiting: true`) so the stream gets the bandwidth. After stop they continue.
- **After stop, an unfinished film keeps downloading**, so watching it later starts instantly. User can pause or delete it.
- Completed files: torrent is stopped (no seeding).
- **Auto-cleanup** (`DEFAULT_POLICY`), on load and every 10 min; items with `keep` or playing are never touched:
  - complete: deleted `completedDays` (30) after `max(completedAt, lastPlayedAt)`;
  - unfinished (downloading or paused): deleted after `unfinishedDays` (7) without progress or use (`lastActivityAt`);
  - disk: keep `minFreeBytes` (5 GB) free, counting what active downloads still need; least recently active items go first. A new download that still does not fit → HTTP 507.
  - orphans: data folders / .torrent files not referenced by any item are deleted on load.
- Deleting an item removes `data/<infoHash>` and its saved .torrent.

### `server/` (POC)

- `tvbox.js`, class `TvBox`: one playback at a time; `Library` → `MpvPlayer`.
  - `play({id, episode?})` plays a library item (episode defaults to the last watched); `play({magnet})` adds it to the library first. Resolves once mpv has loaded the source (video appears a few seconds later). Switching episodes of the playing item does not release it (no download reshuffle).
  - Playlist: at `eof` the next episode starts automatically; after the last one playback stops. Control actions `next` / `prev` (409 at the ends).
  - Every `play`/`stop` bumps `session`; a `play()` superseded mid-load exits quietly and releases its item.
  - mpv starts lazily and restarts if its window was closed. Closing mpv → `stop()`.
  - `deleteDownload(id)` stops playback first if that film is playing.
  - Status: `{phase: idle|loading|playing|error, title, error, itemId, episode: {index, count, name} | null (null for a single file), player: {paused, position, duration, volume, buffering} | null, download: {state, progress, downloaded, length, downloadSpeed, peers} | null, storage: {ok, error}, power, poweringOff}`.
  - Library not loaded (film disk missing): `play`, `download`, `updateDownload`, `deleteDownload`, `storage` → 503 "Film disk is not connected"; `downloads()` → `[]`.
- `index.js`: Fastify on `0.0.0.0:8080` (`PORT`, `HOST`, `LOG_LEVEL`, `TVBOX_CACHE` env; `--pi` → `PI_ARGS`).
  - Errors: `{error}` with the error's `statusCode` (400 validation / not a magnet, 404 unknown id or no video in torrent, 409 conflict, 507 no disk space), anything else 502 (e.g. "no peers found").
  - `POST /api/play {id, episode?} | {magnet}` → status (`magnet` must match `^magnet:\?`)
  - `POST /api/play/torrent`, `POST /api/downloads/torrent`: the .torrent file as the raw body (`application/x-bittorrent` or `application/octet-stream`, ≤ 10 MB → else 413). Same results as the magnet routes.
  - `POST /api/control {action, value?}`: `play pause toggle seekBy seekTo volume volumeBy audio sub next prev` (`sub: null|"off"` disables) → `{ok}`
  - `POST /api/stop`, `GET /api/status`, `GET /api/tracks`
  - `GET /api/downloads` → items; `POST /api/downloads {magnet}` → 201 item; `PATCH /api/downloads/:id {paused?, keep?, wanted?: [episode positions]}` → item; `DELETE /api/downloads/:id` → 204
  - `GET /api/storage` → `{dir, free, total, used, policy}`
  - `GET /api/health` (`server/health.js`) → `{temperature (°C, thermal_zone0), power: {undervoltage, throttled: 'now'|'earlier'|null} (firmware `get_throttled`: the sysfs file if present — this Pi's kernel doesn't have it — else `vcgencmd get_throttled`; throttled includes the 80 °C soft limit), cpu (0–1 of all cores since the previous request), memory: {total, available}, network: {type: 'ethernet'|'wifi', iface, signal (dBm, /proc/net/wireless)} (interface of the lowest-metric default route), uptime (s)}`. Linux-only readings are `null` elsewhere (Windows dev).
  - WebSocket `/ws`: `{type: "status", ...}` (≤ 4/s) and `{type: "downloads", items}` (≤ 1/s); both sent on connect.
  - Static files from `web/dist` (a plain-text hint at `/` if it isn't built).

### Testing so far (Windows, real mpv)

- Player: playback, pause, seek, volume, tracks through the API.
- Streaming a film never downloaded before: video in ~8 s, 4–6 MB/s, seek to 33 min resumes in < 4 s (tested with an Internet Archive torrent, before search was removed).
- Library: two parallel downloads; the same torrent twice returns the same item; other downloads wait while a film plays and continue after stop; pause/resume; keep; delete (files gone from disk); completed film plays from disk; deleting the playing film stops it; 404/409/400 errors.
- Restart: unfinished download resumes from where it was; orphan folder deleted; film finished 31 days ago deleted on start; state survives a hard kill while downloading; v1 → v2 migration.
- Series (The Lone Ranger 1949, public domain, 16 episodes): playlist in natural order, only episodes 1–2 download while 1 plays, next/prev and their limits, auto-advance at eof, play a given episode, last episode remembered across restart, whole series downloads after stop.
- Magnet-only API: Sintel magnet plays; https URL / old `torrent` field / malformed magnet → 400; `/api/search` → 404; series added by magnet (metadata pre-seeded, since IA has no peers) → playlist.
- Not tested yet: the 507 disk-full path (test PC had 390 GB free), Raspberry Pi.

### `web/`: phone remote (ПотужнFLIX)

- Svelte 5 (runes) + Vite. No service worker: browsers allow it only over HTTPS, and the box is plain HTTP on the LAN. Manifest + apple meta tags give a home-screen icon anyway.
- State: `live.svelte.js` holds `{connected, status, downloads}` from the `/ws` socket, reconnects with backoff and on `visibilitychange`. Commands go through `api.js` (REST). No polling except `/api/storage` every 15 s on the shelf.
- **Design: Y2K, old and cozy VHS**, follows the logo (a VHS cassette with a synthwave sunset label, chrome "Потужн" + red "FLIX"). No Winamp (redesigned away from it: Winamp is about music, the box is about tapes).
  - Remote = a **VCR deck** (`Remote.svelte`): black plastic panel with a printed label strip ("ПотужнFLIX · VHS · HQ · Hi-Fi Stereo", PLAY LED); a tape slot showing the playing tape's handwritten label (flap "Вставте касету" when empty); a cyan **VFD** display with a mesh: status word in 14-segment (PLAY / PAUS / LOAD / BUFF / STOP / ERR), VHS / HQ / Hi-Fi marks, tape counter in 7-segment with unlit "8" segments behind (tap → time remaining), scrolling title, episode and download stats.
  - Glossy silver piano keys with small labels: Попер. / −10 / Грати·Пауза (sunset gradient when paused) / +10 / Наст. / ⏏ Стоп; volume fader (purple → magenta → orange); AUDIO / SUB buttons. Seek bar with the downloaded part of the current file shaded.
  - Idle / loading / error: a small CRT TV with the VCR blue screen ("insert a tape", the new tape form, "continue").
  - Under it on the Пульт tab, "Стан приставки" (`Health.svelte`): a small deck panel with a VFD: CPU temperature with a segment meter (cyan < 70 °C, orange < 80, red), CPU %, memory, network (Кабель / Wi-Fi · добре|середньо|слабко), uptime; warnings for undervoltage / overheating (now = red, since boot = orange). Polls `/api/health` every 5 s while the page is visible.
  - New tape form (`MagnetForm`): magnet field or "Вибрати .torrent файл" (hidden `<input type=file accept=".torrent,application/x-bittorrent">`); a picked file shows as a chip (name, size, ✕) in place of the field; the client checks the extension and 10 MB. Checked with Puppeteer (`uploadFile`).
  - Series on the shelf: a summary line ("Вибрано 3 з 10 серій · 9.6 ГБ" / "Завантажуються всі серії" / "Жодна серія не вибрана"), a toggle "Серії: завантажувати N з M", "Усі" / "Жодної", and per episode a download tick (role=checkbox), state (✔ / % / —) and a separate ▶. Taps are kept locally and sent once after 0.4 s. After "На полицю" (from either tab) the app switches to the shelf and opens the new series' episode list.
  - Shelf = VHS cassettes like the logo's (notched shell, VHS / HQ badges, silver-hub reels on both sides of a handwritten paper label): the reels show progress (tape moves left → right as it downloads, hubs spin while downloading), stickers REC / ПАУЗА / ЧЕКАЄ / ГРАЄ / ЗАПИСАНО (playing = sunset gradient + magenta glow), "keep" = record-protect tab, VFD disk meter. New tape form on a CRT blue screen above the shelf.
  - Colours from the logo (tokens in `app.css`): night-sky background with sparkles, synthwave purple / magenta / orange / sun yellow, chrome greys, VFD cyan, FLIX red, VCR blue. Main action = sunset gradient (`.btn.hot`).
  - Icons (`web/public`) are crops of the logo's cassette.
  - Fonts (bundled, work offline, all with Cyrillic): Russo One (wordmark, headings, buttons), Press Start 2P (VFD text, small labels), Caveat (handwritten tape labels), DSEG7 / DSEG14 (segment displays, digits and Latin only). Body text: system font. Pixelify Sans was dropped: it lacks Cyrillic І О П.
- Mobile first, max width 480 px, safe-area insets, touch targets ≥ 44 px, `prefers-reduced-motion` stops animations, `aria-label`s on icon buttons.
- Checked with Edge (Puppeteer, 390×844 mobile emulation) against the real backend + mpv: all screens render without horizontal overflow; pause / play / ±10 s / next episode / volume and seek sliders / stop / magnet validation / "continue watching" work.

### `player/player.js`, класс `MpvPlayer`

- **Запуск:** `start()` запускает mpv со следующими флагами:
  - `--idle=yes --force-window=yes --input-terminal=no --msg-level=all=warn --hwdec=auto-safe --input-ipc-server=<сокет>`
  - mpv warnings/errors (stdout/stderr) are emitted as `log` events; `TvBox` → `mpv-log` → the server log. With `--no-terminal` they were lost (the desktop holding DRM went unnoticed).
  - Сокет: `$TMPDIR/tvbox-mpv.sock`, на Windows — `\\.\pipe\tvbox-mpv`.
  - После подключения подписывается на свойства через `observe_property`.
- **Методы:**
  - `load(url, {title})`, `play()`, `pause()`, `togglePause()`
  - `seekBy(s)`, `seekTo(s)`
  - `setVolume(v)` (значение 0–100), `changeVolume(d)`
  - `stop()`
  - `tracks()` возвращает `{audio, subtitles}`; `setAudioTrack(id)`, `setSubtitleTrack(id|null)`
  - `quit()`
  - Низкоуровневые: `command(...args)`, `commandNamed({name, ...})` (named-argument commands like `osd-overlay`), `getProperty()`, `setProperty()`
  - `load()` also sets `pause=false`: mpv keeps `pause` across files, so a film paused before Stop made the next one start paused.
- **Состояние:** `player.state = {paused, position, duration, volume, idle, title, buffering}`.
- **События:**
  - `state` при каждом изменении отслеживаемого свойства;
  - события mpv: `file-loaded`, `end-file` и другие;
  - `exit` при закрытии mpv.
- **`PI_ARGS`:** settings for the Pi, see "mpv on the Pi" in the Raspberry Pi section.
- **Статус проверки:** работает с реальным mpv на Windows и на Pi (через backend).

### `player/tvscreen.js`, class `TvScreen`: the TV picture (old VHS TV)

- mpv is the only thing that draws on the TV (no browser/desktop on the Pi), so everything is ASS markup sent with mpv's `osd-overlay` command. Overlays: 1 = still background (z 0; VCR blue `#1739c4` + faint CRT scanlines, or the synthwave scene), 3 = the synthwave's moving grid (z 1), 2 = content (z 2). A 15 fps ticker composes them and sends only when a string changed. The synthwave scene (~25 KB of ASS) is cached and resent only when the drift moves it (2 px steps, every few seconds); the grid moves at 7.5 fps.
- Cost on the Pi (idle, mpv CPU): 37 % of a core with the grid at 15 fps, ~23 % at 7.5 fps (54 °C, no throttling).
- **Screen saver** (the Pi 4 has no sleep/suspend, and downloads must go on, so only the TV picture rests): after `saverMs` (default 20 min, `TVBOX_SAVER_MIN` env, 0 = never) on the idle scene without activity, the screen goes black (overlays 1/3 removed) with a dim clock + "ПотужнFLIX" that jumps to a random place every minute (1 send/min). Activity = `TvScreen.wake()` via `TvBox.wake()`: any non-GET API request (`onRequest` hook), a new `/ws` connection, or a `{type: "wake"}` WebSocket message (the remote sends it on `visibilitychange` → visible when its socket survived), plus any scene change (e.g. a film stopped). GETs don't count: an open remote polls `/api/health` and `/api/storage`. Checked on Windows: saver after the delay while a socket stays open; wake by a POST, a socket message and a new connection.
- **HDMI-CEC** (`server/cec.js`, class `Cec`; `cec` TvBox option, default on, `TVBOX_CEC=off` disables — some TVs mishandle CEC): turns the TV on + switches it to our input at boot and whenever the screen saver ends, and puts the TV in standby when the screen saver starts. Uses `cec-ctl` (v4l-utils, already on Raspberry Pi OS; nothing to install) over the Pi's v4l2 CEC framework (`/dev/cec0`/`/dev/cec1`, one per HDMI port on `vc4_hdmi`). `Cec.start()` claims a Playback Device logical address on whichever adapter reports a real physical address (not `f.f.f.f`, i.e. actually wired to the TV — on this box that's `/dev/cec0`/HDMI0, physical address `2.0.0.0`); safe with no CEC hardware/TV at all (a dev PC, `cec-ctl` missing, or a disconnected port): every method just no-ops. `turnOn()` sends `IMAGE_VIEW_ON` then `ACTIVE_SOURCE`; `standby()` sends `STANDBY` addressed to the TV only (0), not the whole bus (a soundbar etc. stays on). `TvScreen` emits `'saver'` (boolean) on the transition (in `#tick()`); `TvBox` wires it to `cec.standby()` / `cec.turnOn()`, and calls `cec.turnOn()` once more after `#ensurePlayer()` in `init()` for the boot case (no saver transition to trigger it there). `status().cec` reports whether an adapter was claimed. Checked on the Pi (real Samsung TV): claims `/dev/cec0` (topology already showed the TV); `--to 0 --standby` on the saver's `'saver'` event made the TV stop responding to CEC queries (`--show-topology` came back empty); a POST request woke it and `--show-topology` showed `Power Status: On` again within ~4 s.
- `TV_ARGS` (added by `TvBox`): `--osc=no` (no mpv controller / idle logo), `--osd-level=0` (no mpv messages; `osd-overlay` still renders), `--osd-fonts-dir=player/fonts`. Font: Press Start 2P (VCR blocky, Cyrillic), converted from @fontsource WOFF by `scripts/tv-fonts.mjs`. Cyrillic and Latin subsets are separate files of one family; libass takes each glyph from whichever file has it (checked).
- Canvas: height 1080, width follows `osd-dimensions` (polled every 3 s). Margin 100 px for overscan. All text uppercase, white with black outline and a dark-blue shadow.
- Scenes (`setScene(scene, {title, error, episode})`, driven by `TvBox` phases):
  - `idle`: a **synthwave night** (the user's choice, matches the logo's label): banded sky purple → magenta → pink, stars, a striped sun with a glow (gaps widening towards the horizon), mountains at the sides, palm silhouettes leaning inwards, a neon-pink floor grid (vanishing lines still, horizontal lines coming towards the viewer), CRT scanlines. All drawn procedurally in `synthScene()` / `synthGrid()` / `palm()` (polygons and bezier circles; each palm part is its own drawing, since overlapping subpaths of one drawing can cancel out). On top: "■ STOP" top left, clock with blinking colon top right, "ВСТАВТЕ КАСЕТУ_" (neon pink shadow) above the sun, the disk warning under it. On the grid, translucent dark panels with pink edges (bottom-aligned at the margin): left, a **QR code** (qrcode-generator, level M, 25 modules × 8 px + 3-module quiet zone ≈ 250 px; one ASS drawing of horizontal runs, navy on off-white `#e4eaff`, whole-pixel position so modules stay sharp) with "Пульт на телефоні: <remoteUrl>", "АБО <ip>" and "Наведіть камеру телефона на код" beside it. The QR opens `qrUrl()` = the **IP address** (server's `lanUrl()`, first LAN IPv4, re-read every 30 s; no port when 80), because many Android phones can't resolve `tvbox.local`; the text still shows `TVBOX_URL`. Right panel (only when something records; alone, the QR panel is centred): "■ ЗАПИС НА ПОЛИЦЮ" (blinking red REC square) with up to 3 downloads in progress (not playing), fastest first: title (+ "done/chosen" for series), %, МБ/С; "+N ЩЕ" beyond. `TvBox` refreshes it on every library `changed` (~1/s). Everything, scene included, drifts a few pixels slowly (burn-in protection). Checked: the QR decodes (jsQR) from a 960×540 window capture, i.e. at 4 px per module.
  - `loading`: blue, "▶ PLAY", "ЗАВАНТАЖУЮ КАСЕТУ..." (text only, like a real VCR), title and episode.
  - Blinking "_", counting "...", the clock's ":": the whole line is always laid out at full length and the "off" characters are drawn transparent (`text()` tail argument). libass drops trailing spaces, so padding with spaces made centred text jump.
  - `error`: blue, "■ STOP", "КАСЕТУ НЕ ПРОЧИТАНО_", error text wrapped (≤ 3 lines).
  - `playing`: the blue loading screen stays until the film's first frame (`playback-restart`, fallback: position > 1 s), then transparent with VCR messages: "▶ PLAY" + "СЕРІЯ n/N" + title for 4 s at start; "❚❚ PAUSE" + tape counter while paused; "▶▶ / ◀◀ 0:01:06" after seeks (direction from position before `seek` vs after); "▶ PLAY" on resume; green 20-block VOLUME bar on volume change; blinking "ЗАВАНТАЖЕННЯ" top right while buffering > 0.7 s. Messages react to mpv events, so they also appear for changes not made from the phone.
- `TvBox` starts mpv in `init()`, so the TV shows the blue screen right after boot; if mpv is missing, the server still starts (error logged). `remoteUrl` = `TVBOX_URL` env or `http://<first LAN IPv4>:<port>`.
- `TVBOX_MPV_ARGS` env: extra mpv options, e.g. `--geometry=960x540+40+40` for development.
- Checked on Windows (window captures): idle (synthwave, QR decodes, grid moves), loading, start card, seek, resume, pause, volume.

### Raspberry Pi (stage 6)

- Hardware: Pi 4 4 GB, **no heatsinks and no fan yet** (the kit came without them). 42–50 °C idle in the closed official case. Check under load (film + download) before deciding on stick-on heatsinks / the official Case Fan. `vcgencmd get_throttled` was 0x0.
- OS: the card has **Raspberry Pi OS with desktop** (Debian 13 trixie, 64-bit), switched to console boot: `systemctl set-default multi-user.target` (lightdm/labwc held DRM, so mpv couldn't draw). Reverse: `set-default graphical.target`. Reflash with Lite only if the card is redone anyway.
- Access: user `chaoticsparks`, host `tvbox` (mDNS `tvbox.local` is flaky from the Windows PC; the IP changes on reboot → the user should add a DHCP reservation, MAC `98:fe:54:34:12:2c`). SSH: key-only, the PC's `~/.ssh/id_ed25519`. When connecting by IP use `-o HostKeyAlias=tvbox.local`.
- `sudo` needs a password, which Claude never types: root steps go into `deploy/setup-pi.sh` and the user runs `ssh -t chaoticsparks@tvbox.local "sudo bash ~/potuzhnflix/deploy/setup-pi.sh"`. The script installs mpv/nodejs/npm from Debian, the cache dir, the service, disables getty@tty1, and a sudoers rule so the user can `sudo systemctl start|stop|restart potuzhnflix` without a password (used for deploys). Files are written temp + sync + rename: the first run lost them to a power cut right after.
- Service `potuzhnflix`: `node server/index.js --pi` as the user, port 80 via `CAP_NET_BIND_SERVICE`, `TVBOX_URL=http://tvbox.local`, `TVBOX_CACHE=/home/chaoticsparks/tvbox-cache` (SD card until the Lexar arrives; /tmp is RAM on Debian 13), `Restart=always`. Logs: `journalctl -u potuzhnflix` (user is in `adm`); mpv warnings/errors appear there as `"msg":"mpv"`.
- Node.js 20.19.2 from Debian. WebTorrent 3 declares `node >=22` (npm EBADENGINE warning) but works on 20 (checked: metadata, peers, download; node-datachannel loads on arm64). If something breaks, install Node 22.
- **Downloads now on the user's own 1 TB USB HDD** (Toshiba MQ04UBF100, 2.5" bus-powered, NTFS, label EXTERNAL_USB, UUID `90DE2E52DE2E3140`), temporarily until the Lexar arrives. **The disk holds the user's own files: never format it, never touch anything outside `tvbox/`.** Set up with `sudo bash deploy/use-disk.sh 90DE2E52DE2E3140 tvbox`:
  - fstab `UUID=… /mnt/tvbox-disk ntfs3 uid=1000,gid=1000,umask=022,windows_names,noatime,nofail,x-systemd.device-timeout=20s` (kernel ntfs3, not ntfs-3g/FUSE; `windows_names` keeps the disk readable on Windows; a "dirty" NTFS is not force-mounted — fix it in Windows).
  - Drop-in `/etc/systemd/system/potuzhnflix.service.d/disk.conf`: `TVBOX_CACHE=/mnt/tvbox-disk/tvbox` + `TVBOX_REQUIRE_MOUNT=/mnt/tvbox-disk` (overrides the unit's SD-card path; setup-pi.sh leaves the drop-in alone). No `RequiresMountsFor` any more: after a power cut the NTFS disk came back "dirty", ntfs3 refused it, and the whole box looked dead. Now `TvBox` starts without the disk: TV and remote work and say the disk is missing; every 30 s it runs `sudo -n mount /mnt/tvbox-disk` (sudoers rule; fstab options, never forced) and loads the library when that works. Never writes to the SD card instead: a mount point is "mounted" when its device differs from its parent's.
  - A "dirty" NTFS (unclean power-off) must be fixed in Windows: `chkdsk X: /f`, then safely remove. It happened once (the Pi was unplugged to connect Ethernet). The remote's power button prevents it: poweroff unmounts cleanly.
  - `use-disk.sh --off` removes the drop-in and the fstab line (checked on a copy: other fstab lines stay byte-identical, repeated runs keep one line).
  - Checked: Sintel downloaded and played from the HDD (v4l2m2m-copy, 0 drops), files only under `tvbox/` (top-level item count on the disk unchanged), no undervoltage with the HDD spinning, 58.9 °C.
  - The old SD cache `~/tvbox-cache` was deleted (it held only a test Sintel). If downloads go back to the SD card (`use-disk.sh --off`), the library recreates it empty.
  - Lexar later: format it ext4 (the user agreed to erase it), then the same `use-disk.sh <UUID> <folder>`.
- **Power button** (remote header, only when `status.power`, i.e. `--pi`): `POST /api/power {action: poweroff|reboot}` → `TvBox.power()`: stop playback, `library.flush()`, TV scene `poweroff` ("ВИМИКАЮСЬ..." / "ПЕРЕЗАВАНТАЖУЮСЬ..."), then after 1.5 s `sudo -n systemctl poweroff|reboot` (sudoers rule). The phone shows a blue "ПРИСТАВКУ ВИМКНЕНО" screen (wait ~20 s for the green LED, then unplug) or "ПЕРЕЗАВАНТАЖЕННЯ..." until a fresh status arrives. 501 when not on the Pi.
- sudoers (`/etc/sudoers.d/potuzhnflix`, from setup-pi.sh): `systemctl start|stop|restart potuzhnflix`, `systemctl poweroff|reboot`, `mount /mnt/tvbox-disk` — nothing else.
- Network: Ethernet (`eth0`, 192.168.3.239) and Wi‑Fi (`wlan0`, 192.168.3.235) both up via NetworkManager; default route metric 100 (eth) vs 600 (wifi), so the cable is used first and Wi‑Fi takes over by itself. Nothing configured for this.
- Deploy (the GitHub repo is private, the Pi has no credentials): `git archive HEAD | ssh … "tar -x -C ~/potuzhnflix"` (or tar the changed files), then `npm ci` if dependencies changed, `npm run build`, `sudo systemctl restart potuzhnflix`. npm ci takes ~1 min, build ~7 s on the Pi.
- mpv on the Pi: `PI_ARGS` = `--vo=gpu --gpu-context=drm --drm-mode=1920x1080 --fs --profile=fast --hwdec=drm,v4l2m2m-copy`. The TV is 4K; output 1080p, the TV upscales. mpv 0.40 from Debian, FFmpeg is Raspberry Pi's build (`+rpt`, has the stateless HEVC decoder). HDMI0 = `card1-HDMI-A-1`, sound cards `vc4hdmi0`/`vc4hdmi1`, mpv uses ALSA.
  - Decoding, measured on the Pi (15 s after warm-up, standalone mpv, no OSD): the default `auto-safe` never tries the Pi's decoders (tried CUDA/Vulkan → software). H.264: `v4l2m2m-copy` works (zero-copy `v4l2m2m` dropped frames). H.265: `drm` (zero-copy) and `drm-copy` work; `v4l2m2m` doesn't do HEVC; `drm` doesn't do H.264, so the list picks per codec.
  - Without `--profile=fast`, 1080p HEVC dropped 46–134 frames / 15 s in every mode (even software): mpv's default scaling is too heavy for the Pi 4 GPU. With it: 0 drops, H.265 `drm` ~18 % CPU, H.264 `v4l2m2m-copy` ~19 %. `--vo=drm` also gave 0 drops but 180–250 % CPU (scaling on the CPU) — rejected.
  - In the service (Sintel H.264 via the API): `v4l2m2m-copy`, 0 drops, mpv ~20 % CPU, 56 °C. Temperature without heatsinks, closed case: 50 °C idle, 55–56 °C playing Sintel; a real 1080p H.264 series from the HDD while downloading the next episode (1.8 MB/s, node up to 190 % CPU hashing pieces, mpv 65–110 %): peak 68 °C at the start of an episode, then a steady 60–63 °C over 30 min; `throttled=0x0` throughout. Heatsinks optional.
  - Benchmarks: stop the service (`sudo systemctl stop potuzhnflix`), run a separate mpv with `--input-ipc-server=/tmp/bench.sock` and read `hwdec-current` / `frame-drop-count` over IPC. Kill it by PID, not `pkill -f` (the pattern matches the SSH command itself). HEVC test clip: `ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=24 -t 30 -c:v libx265 -preset ultrafast`.
- DRM devices: `card0` = v3d (3D only, no connectors), `card1` = vc4 (HDMI-A-1/2). mpv picks the card with a *connected* connector; many TVs drop HDMI hot-plug in standby, then mpv fails with "No primary DRM device could be picked" and sits without a screen.
  - Fix: `setup-pi.sh` appends `video=HDMI-A-1:1920x1080@60D` to `/boot/firmware/cmdline.txt` (D = force the output on); needs a reboot.
  - Safety net in `TvBox`: mpv logging "Error opening/initializing the VO window" → quit and restart it every 30 s (`DISPLAY_RETRY_MS`) until the screen is there (checked on the Pi with the TV off).

## Договорённости

- Communicate with the user in English.
- Code in Node.js, ESM. All code comments in English.
- Пользователь живёт в Украине, железо покупает там (Prom, Rozetka и др.).
- Backend будет раздавать статус через WebSocket. Событие `state` из MpvPlayer приходит часто (при каждом обновлении `time-pos`), поэтому перед отправкой на телефон его нужно ограничивать по частоте.
