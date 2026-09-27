# ПотужнFLIX: приставка для телевизора

Контекст проекта, перенесённый из чата в claude.ai. Этот файл лежит в корне репозитория, и Claude Code читает его автоматически.

## Идея

Самодельная приставка, которая подключается к телевизору по HDMI и выходит в интернет через домашний Wi‑Fi.

**Name: «ПотужнFLIX»** (logo: `logo.png` in the repo root). UI language: Ukrainian.

- **Управление:** с телефона через простое PWA. Пользователь вставляет magnet-ссылку и нажимает «Смотреть» или «Скачать».
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
- **Input: magnet links only.** Search and content providers (Internet Archive etc.) were built and then removed on the user's decision: no search, no .torrent URLs/files. The box does not integrate with any trackers or catalogues.

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
   - Ещё не сделано: экран ожидания (заставка на ТВ).
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
6. **Перенос на Pi.** ← NEXT
   - Запись ОС, Wi‑Fi, SSH, монтирование Lexar.
   - mDNS `tvbox.local`.
   - systemd-сервисы с автозапуском и перезапуском при сбое.
   - Настройка вывода mpv в DRM, проверка нагрева.
   - Результат: готовая приставка.
7. **Улучшения (по желанию).**
   - HDMI-CEC: автовключение ТВ и переключение входа.
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
  player/
    player.js         # класс MpvPlayer (EventEmitter)
    cli.js            # консольный пульт для ручной проверки
  torrent/
    engine.js         # TorrentEngine: many torrents in one WebTorrent client, per-file selection, HTTP streaming
    cli.js            # magnet [--episode n] → library → mpv, auto-advances episodes, prints download status
  library/
    library.js        # Library: persistent downloads, playlists, pause/resume/keep/delete, auto-cleanup
  server/
    tvbox.js          # TvBox: library → mpv, one playback, episodes, status
    index.js          # Fastify: REST /api/*, WebSocket /ws, static web/dist
  web/                # phone remote: Svelte 5 + Vite, built into web/dist (git-ignored)
    vite.config.js    # root web/, dev server :5173 proxies /api and /ws to the backend
    index.html
    public/           # manifest.webmanifest, icons (from logo.png), logo.jpg, mark.png
    src/
      main.js, App.svelte    # shell: header, tabs Пульт / Полиця, offline banner, toasts
      app.css                # design tokens and shared styles
      lib/                   # api.js (REST), live.svelte.js (WebSocket state), toast, format (uk)
      components/            # Remote, Shelf, Tape, MagnetForm, TrackSheet, Icon
```

### `torrent/engine.js`, class `TorrentEngine`

- Low-level; `Library` is the only intended user. One WebTorrent client, several torrents at once.
- Disk layout under the cache dir (`TVBOX_CACHE` env, default `$TMPDIR/tvbox-cache`; on the Pi → the Lexar):
  - `data/<infoHash>/<paths from the torrent>`: downloaded files. One folder per torrent, so deleting is `rm -r`.
  - `torrents/<infoHash>.torrent`: metadata saved after the first add; re-adding after a restart needs no network and no magnet wait.
  - `library.json`: see `Library`.
- `add(magnetOrHash)`: magnet link (or bare info hash, used internally to reload) → ready `Torrent`. Anything else → 400 "Not a valid magnet link". The info hash is parsed first (`parse-torrent`), so an already loaded torrent is reused (WebTorrent refuses duplicates), and saved metadata is used when present. Added with `deselect: true`. Metadata timeout 90 s ("no peers found").
- Magnets need real BitTorrent peers for metadata. Torrents served only by web seeds (e.g. Internet Archive: HTTP only, no peers) time out as magnets.
- `setSelection(infoHash, indexes)`: exactly these files download. Deselects first, then selects, because neighbouring files can share a boundary piece.
- `streamUrl(infoHash, index)`: local HTTP server on `127.0.0.1` (random port), `/<infoHash>/<index>/<name>`. Single `Range` (206/416) and HEAD. Each Range read calls `file.createReadStream({start, end})`, which makes WebTorrent prioritise the pieces there, so seeking moves the download position. Strategy is WebTorrent's default `sequential`.
- Emits `file-done (infoHash, index)`. Files already complete when a torrent loads are detected by `Library` via `fileStats().done`.
- `pickVideoFiles(files)`: what to play: one film, a film in parts, or the episodes of a series, in natural order (`E2` < `E10`). Skips samples / trailers / extras (by name) and files under 5 % of the largest. Same video in several formats (`ep1.mp4` + `ep1.ogv` + `ep1_512kb.mp4`) → one: container rank first (mkv, mp4, m4v, avi, …, webm, ogv: H.264/H.265 first, the Pi decodes those in hardware), then size.
- Disk quirks seen on Windows: a file is allocated at full length on first write; boundary pieces leave small scraps in neighbouring files; torrents may contain `.____padding_file` entries.
- npm skips install scripts for `node-datachannel`, `bufferutil`, `utf-8-validate`, `utp-native`. Harmless: `node-datachannel` ships a prebuilt binary (WebRTC peers work), `bufferutil`/`utf-8-validate` are optional `ws` speed-ups, without `utp-native` peers use TCP (plus web seeds).

### `library/library.js`, class `Library`

- An **item** is one torrent (one magnet), played as a **playlist** of the video files `pickVideoFiles` chose: a film (one file), a film in parts, or the episodes of a series. Id = info hash (items from older versions may have `<infoHash>-<n>` ids; lookups by torrent go through `infoHash`). Title = torrent name.
- Stored in `library.json` (`{version: 2, items}`; v1 items with a single file are migrated on load). Saved within 2 s of a change (the timer is not restarted, so constant progress updates can't starve it), via temp file + rename, writes serialised. BOM tolerated. A corrupt file stops startup on purpose: an empty library would delete every download as an orphan.
- Item: `{id, infoHash, title, files: [{index, name, path, length, downloaded, done}], episode, state: downloading|paused|complete, keep, addedAt, completedAt, lastPlayedAt, lastActivityAt}` (timestamps in ms). `episode` = last played entry of `files`. The item is `complete` when all files are done.
- API: `load()`, `add(magnet)` (the same torrent again returns the existing item; resolves after metadata), `stream(id, episode?)` → local path if that file is done (mpv plays it directly) or stream URL; episode defaults to the last played; `release(id)`, `pause(id)`, `resume(id)`, `setKeep(id, bool)`, `remove(id)`, `cleanup()`, `list()`, `get(id)`, `storage()`, `close()`. Emits `changed` (on every change and every second while downloading).
- `view(item)`: `{id, title, length, downloaded, progress, state, waiting, playing, keep, downloadSpeed, peers, episode, files: [{name, length, downloaded, progress, done}], addedAt, completedAt, lastPlayedAt, expiresAt}` (totals are sums over files).
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
  - Status: `{phase: idle|loading|playing|error, title, error, itemId, episode: {index, count, name} | null (null for a single file), player: {paused, position, duration, volume, buffering} | null, download: {state, progress, downloaded, length, downloadSpeed, peers} | null}`.
- `index.js`: Fastify on `0.0.0.0:8080` (`PORT`, `HOST`, `LOG_LEVEL`, `TVBOX_CACHE` env; `--pi` → `PI_ARGS`).
  - Errors: `{error}` with the error's `statusCode` (400 validation / not a magnet, 404 unknown id or no video in torrent, 409 conflict, 507 no disk space), anything else 502 (e.g. "no peers found").
  - `POST /api/play {id, episode?} | {magnet}` → status (`magnet` must match `^magnet:\?`)
  - `POST /api/control {action, value?}`: `play pause toggle seekBy seekTo volume volumeBy audio sub next prev` (`sub: null|"off"` disables) → `{ok}`
  - `POST /api/stop`, `GET /api/status`, `GET /api/tracks`
  - `GET /api/downloads` → items; `POST /api/downloads {magnet}` → 201 item; `PATCH /api/downloads/:id {paused?, keep?}` → item; `DELETE /api/downloads/:id` → 204
  - `GET /api/storage` → `{dir, free, total, used, policy}`
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
- **Design: follows the logo**, 2000s nostalgia, cozy analogue:
  - Winamp-era player window: dark metal panel, bevelled silver "chrome" buttons (the logo's transport buttons), title bar with grip stripes.
  - Green LCD with scanlines: VCR status word in 14-segment (PLAY / PAUS / LOAD / BUFF / STOP / ERR), tape counter in 7-segment with unlit "8" segments behind, Winamp-style scrolling title, green EQ bars from the logo (animated while playing). Tap the counter → time remaining.
  - Seek bar with the downloaded part of the current file shaded; volume bar in Winamp green → yellow → red.
  - VCR blue screen for "insert a tape" (idle / loading / error).
  - Shelf = VHS cassettes: handwritten paper label, tape window whose reels show progress (tape moves left → right as it downloads, hubs spin while downloading), stickers REC / ПАУЗА / ЧЕКАЄ / ГРАЄ / ЗАПИСАНО, "keep" = record-protect tab, LED disk meter.
  - Colours from the logo (tokens in `app.css`): near-black background, chrome greys, LCD green, bolt amber for the main action, FLIX red, VCR blue.
  - Fonts (bundled, work offline, all with Cyrillic): Russo One (wordmark, headings, buttons), Pixelify Sans (LCD text only; its Cyrillic is too rough for buttons), Press Start 2P (small labels), Caveat (handwritten tape labels), DSEG7 / DSEG14 (segment displays, digits and Latin only). Body text: system font.
- Mobile first, max width 480 px, safe-area insets, touch targets ≥ 44 px, `prefers-reduced-motion` stops animations, `aria-label`s on icon buttons.
- Checked with Edge (Puppeteer, 390×844 mobile emulation) against the real backend + mpv: all screens render without horizontal overflow; pause / play / ±10 s / next episode / volume and seek sliders / stop / magnet validation / "continue watching" work.

### `player/player.js`, класс `MpvPlayer`

- **Запуск:** `start()` запускает mpv со следующими флагами:
  - `--idle=yes --force-window=yes --no-terminal --hwdec=auto-safe --input-ipc-server=<сокет>`
  - Сокет: `$TMPDIR/tvbox-mpv.sock`, на Windows — `\\.\pipe\tvbox-mpv`.
  - После подключения подписывается на свойства через `observe_property`.
- **Методы:**
  - `load(url, {title})`, `play()`, `pause()`, `togglePause()`
  - `seekBy(s)`, `seekTo(s)`
  - `setVolume(v)` (значение 0–100), `changeVolume(d)`
  - `stop()`
  - `tracks()` возвращает `{audio, subtitles}`; `setAudioTrack(id)`, `setSubtitleTrack(id|null)`
  - `quit()`
  - Низкоуровневые: `command(...args)`, `getProperty()`, `setProperty()`
- **Состояние:** `player.state = {paused, position, duration, volume, idle, title, buffering}`.
- **События:**
  - `state` при каждом изменении отслеживаемого свойства;
  - события mpv: `file-loaded`, `end-file` и другие;
  - `exit` при закрытии mpv.
- **`PI_ARGS = ['--vo=gpu', '--gpu-context=drm', '--fs']`:** настройки для Pi, будем уточнять на этапе 6.
- **Статус проверки:** работает с реальным mpv на Windows (через backend); на Pi ещё не проверялся.

## Договорённости

- Communicate with the user in English.
- Code in Node.js, ESM. All code comments in English.
- Пользователь живёт в Украине, железо покупает там (Prom, Rozetka и др.).
- Backend будет раздавать статус через WebSocket. Событие `state` из MpvPlayer приходит часто (при каждом обновлении `time-pos`), поэтому перед отправкой на телефон его нужно ограничивать по частоте.
