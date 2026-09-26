# TV Box: приставка для телевизора

Контекст проекта, перенесённый из чата в claude.ai. Этот файл лежит в корне репозитория, и Claude Code читает его автоматически.

## Идея

Самодельная приставка, которая подключается к телевизору по HDMI и выходит в интернет через домашний Wi‑Fi.

- **Управление:** с телефона через простое PWA. Пользователь вводит название фильма, выбирает раздачу и нажимает «Смотреть».
- **Воспроизведение:** приставка скачивает фильм по торренту во временное хранилище и сразу начинает показ, не дожидаясь полной загрузки.
- **Видео идёт по HDMI прямо на телевизор.** На телефон видео НЕ передаётся: телефон работает только как пульт (пауза, громкость, перемотка, дорожки).
- **По сети между телефоном и приставкой** ходят только команды и статус. Весь тяжёлый трафик идёт из интернета в приставку, а оттуда по HDMI в телевизор.

## Архитектура

```
Телефон (PWA) ──REST/WebSocket──► Backend на приставке
                                     │
                     ┌───────────────┼────────────────┐
                     ▼               ▼                ▼
                 Поиск         Торрент-движок ──HTTP (localhost)──► mpv ──HDMI──► ТВ
            (провайдеры)    (последовательная загрузка,
                             Range-запросы, кэш на USB)
```

- **mpv:** управляется через JSON IPC-сокет. На Pi выводит видео напрямую в DRM/KMS, без рабочего стола.
- **Торрент-движок (WebTorrent):** качает куски последовательно, с приоритетом на текущую позицию. Перемотка переключает приоритет. Файл отдаётся по HTTP с поддержкой Range, и его забирает mpv.
- **Поиск:** подключаемые модули с общим интерфейсом «название → список раздач» (размер, качество, сиды).
  - Источники: легальные. Первым идёт Internet Archive (фильмы в общественном достоянии, у каждого есть .torrent), плюс ручной ввод magnet-ссылки.
  - Интеграции с пиратскими трекерами не делаем.

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
   - Принимает magnet-ссылку или .torrent, сам выбирает самый крупный видеофайл.
   - Качает последовательно, при перемотке меняет приоритет кусков.
   - Раздаёт файл локальным HTTP-сервером с поддержкой Range.
   - Отдаёт статус: процент загрузки, скорость, пиры.
   - Чистит кэш после просмотра или при заполнении диска. → Done as a download library: play or download-only, pause/resume, keep, delete, auto-cleanup by age and free space (see `library/`).
   - Результат этапов 1–2: фильм по magnet-ссылке играет из командной строки.
3. **Поиск.** Интерфейс провайдера и модули Internet Archive и ручного magnet. ✅ POC DONE (`npm run search -- "<title>" [--play n]`, see `search/`)
4. **Backend.** Fastify. ✅ POC DONE (`npm start`, see `server/`; REST under `/api/`)
   - REST: `/search`, `/play`, `/control`, `/stop`.
   - WebSocket со статусом.
   - Раздаёт PWA.
   - Связывает поиск → торрент → mpv.
5. **PWA-пульт.** ← NEXT
   - Экран поиска и список результатов.
   - Экран пульта: пауза, ползунок перемотки, громкость, ±10 с, субтитры и аудиодорожки.
   - Downloads screen: list with progress / state / expiry, "Download" next to "Watch" in search results, pause/resume, keep, delete, free disk space.
   - Magnet input. Series (playlists): episode list with per-episode progress, next / previous, "continue from episode N".
   - Устанавливается на главный экран телефона.
   - Результат: полностью рабочий пульт с телефона (пока на компьютере).
6. **Перенос на Pi.**
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
  package.json        # "type": "module", скрипты: npm run player / player:pi / play / play:pi / search / start / start:pi
  player/
    player.js         # класс MpvPlayer (EventEmitter)
    cli.js            # консольный пульт для ручной проверки
  torrent/
    engine.js         # TorrentEngine: many torrents in one WebTorrent client, per-file selection, HTTP streaming
    cli.js            # magnet/.torrent [--file <path>] → library → mpv, prints download status
  library/
    library.js        # Library: persistent downloads, pause/resume/keep/delete, auto-cleanup
  search/
    index.js          # search(query): runs all providers in parallel, merges results
    providers/
      magnet.js       # pasted magnet / info hash / .torrent URL → one result
      archive.js      # Internet Archive, collection feature_films
    cli.js            # prints results; --play <n> launches torrent/cli.js
  server/
    tvbox.js          # TvBox: search → library → mpv, one playback, status
    index.js          # Fastify: REST /api/*, WebSocket /ws, static public/
  public/
    index.html        # placeholder until the PWA (stage 5)
```

### `torrent/engine.js`, class `TorrentEngine`

- Low-level; `Library` is the only intended user. One WebTorrent client, several torrents at once.
- Disk layout under the cache dir (`TVBOX_CACHE` env, default `$TMPDIR/tvbox-cache`; on the Pi → the Lexar):
  - `data/<infoHash>/<paths from the torrent>`: downloaded files. One folder per torrent, so deleting is `rm -r`.
  - `torrents/<infoHash>.torrent`: saved metadata; re-adding after a restart needs no network and no magnet wait.
  - `library.json`: see `Library`.
- `add(source)`: magnet / info hash / .torrent URL / path / Buffer → ready `Torrent`. The info hash is parsed first (`parse-torrent`), so an already loaded torrent is reused (WebTorrent refuses duplicates). Added with `deselect: true`. Metadata timeout 90 s ("no peers found").
- `setSelection(infoHash, indexes)`: exactly these files download. Deselects first, then selects, because neighbouring files can share a boundary piece.
- `streamUrl(infoHash, index)`: local HTTP server on `127.0.0.1` (random port), `/<infoHash>/<index>/<name>`. Single `Range` (206/416) and HEAD. Each Range read calls `file.createReadStream({start, end})`, which makes WebTorrent prioritise the pieces there, so seeking moves the download position. Strategy is WebTorrent's default `sequential`.
- Emits `file-done (infoHash, index)`. Files already complete when a torrent loads are detected by `Library` via `fileStats().done`.
- `pickVideoFiles(files)`: what to play when the user gave no file: one film, a film in parts, or the episodes of a series, in natural order (`E2` < `E10`). Skips samples / trailers / extras (by name) and files under 5 % of the largest. Same video in several formats (IA: `ep1.mp4` + `ep1.ogv` + `ep1_512kb.mp4`) → one: container rank first (mkv, mp4, m4v, avi, …, webm, ogv: H.264/H.265 first, the Pi decodes those in hardware), then size.
- Disk quirks seen on Windows: a file is allocated at full length on first write; boundary pieces leave small scraps in neighbouring files; torrents may contain `.____padding_file` entries.
- npm skips install scripts for `node-datachannel`, `bufferutil`, `utf-8-validate`, `utp-native`. Harmless: `node-datachannel` ships a prebuilt binary (WebRTC peers work), `bufferutil`/`utf-8-validate` are optional `ws` speed-ups, without `utp-native` peers use TCP (plus web seeds).

### `library/library.js`, class `Library`

- An **item** is a **playlist** of video files inside one torrent: a film (one file), a film in parts, or the episodes of a series. Id: `<infoHash>-<fileIndex>` for one file, `<infoHash>-p<sha1 of the indexes, 8 hex>` for a playlist. Several items can share a torrent and even files (e.g. 1080p and 480p from the same IA item, or the same series added twice with a different file set).
- Stored in `library.json` (`{version: 2, items}`; v1 items with a single file are migrated on load). Saved within 2 s of a change (the timer is not restarted, so constant progress updates can't starve it), via temp file + rename, writes serialised. BOM tolerated. A corrupt file stops startup on purpose: an empty library would delete every download as an orphan.
- Item: `{id, infoHash, title, files: [{index, name, path, length, downloaded, done}], episode, state: downloading|paused|complete, keep, addedAt, completedAt, lastPlayedAt, lastActivityAt}` (timestamps in ms). `episode` = last played entry of `files`. The item is `complete` when all files are done.
- API: `load()`, `add({torrent, file?, files?, title?})` (`files` = paths in play order; none → `pickVideoFiles`; dedupes by id; resolves after metadata), `stream(id, episode?)` → local path if that file is done (mpv plays it directly) or stream URL; episode defaults to the last played; `release(id)`, `pause(id)`, `resume(id)`, `setKeep(id, bool)`, `remove(id)`, `cleanup()`, `list()`, `get(id)`, `storage()`, `close()`. Emits `changed` (on every change and every second while downloading).
- `view(item)`: `{id, title, length, downloaded, progress, state, waiting, playing, keep, downloadSpeed, peers, episode, files: [{name, length, downloaded, progress, done}], addedAt, completedAt, lastPlayedAt, expiresAt}` (totals are sums over files).
- `#sync()` (serialised) makes torrents match item states: a torrent is loaded only while one of its files is wanted. Wanted = the playing episode **and the next one** (prefetch), or, when nothing plays, every unfinished file of `downloading` items. Torrents still loading metadata or claimed by an `add()` in progress are never stopped by it. A finished file is marked done in every item that contains it.
- **While a film plays, every other download waits** (`waiting: true`) so the stream gets the bandwidth. After stop they continue.
- **After stop, an unfinished film keeps downloading**, so watching it later starts instantly. User can pause or delete it.
- Completed files: torrent is stopped (no seeding).
- **Auto-cleanup** (`DEFAULT_POLICY`), on load and every 10 min; items with `keep` or playing are never touched:
  - complete: deleted `completedDays` (30) after `max(completedAt, lastPlayedAt)`;
  - unfinished (downloading or paused): deleted after `unfinishedDays` (7) without progress or use (`lastActivityAt`);
  - disk: keep `minFreeBytes` (5 GB) free, counting what active downloads still need; least recently active items go first. A new download that still does not fit → HTTP 507.
  - orphans: data folders / .torrent files not referenced by any item are deleted on load.
- Deleting an item removes `data/<infoHash>` + its .torrent, or, if other items use the same torrent, only its files that no other item contains.

### `search/` (POC)

- Provider: `{ id, name, search(query, { signal }) → Result[] }`. Result: `{provider, id, title, year, quality, size, seeders, torrent, file, url}`; `torrent` + `file` go straight to `/api/play` or `/api/downloads`. Typedef in `search/index.js`.
- `search()` uses `Promise.allSettled`: a failing provider shows up in `errors`, the others still return results. Timeout 20 s.
- **Internet Archive:** `advancedsearch.php` (`title:(…) AND mediatype:movies AND collection:feature_films`, top 10 by downloads), then `/metadata/<id>` per item.
  - One IA item = many versions of the same film in ONE torrent (`<id>_archive.torrent`, with archive.org web seeds). Each quality becomes a separate result pointing at one file.
  - Quality buckets 1080p/720p/480p/360p/240p (width counts too). Per bucket keep the smallest file; drop a quality if a better one is not larger; drop 240p if anything else exists; skip files < 50 MB.
  - Films split into parts (`1of5`, `part2`, `cd1`, `reel 3`) are skipped. The library supports playlists now, but on the user's decision search stays films-only; series and multi-part come in via magnet / .torrent input.
  - `seeders` is `null`: IA doesn't report it, and web seeds make it irrelevant.

### `server/` (POC)

- `tvbox.js`, class `TvBox`: one playback at a time; search → `Library` → `MpvPlayer`.
  - `play({id, episode?})` plays a library item (episode defaults to the last watched); `play({torrent, file?, files?, title?})` adds it to the library first. Resolves once mpv has loaded the source (video appears a few seconds later). Switching episodes of the playing item does not release it (no download reshuffle).
  - Playlist: at `eof` the next episode starts automatically; after the last one playback stops. Control actions `next` / `prev` (409 at the ends).
  - Every `play`/`stop` bumps `session`; a `play()` superseded mid-load exits quietly and releases its item.
  - mpv starts lazily and restarts if its window was closed. Closing mpv or `end-file` with `eof` → `stop()`.
  - `deleteDownload(id)` stops playback first if that film is playing.
  - Status: `{phase: idle|loading|playing|error, title, error, itemId, episode: {index, count, name} | null (null for a single file), player: {paused, position, duration, volume, buffering} | null, download: {state, progress, downloaded, length, downloadSpeed, peers} | null}`.
- `index.js`: Fastify on `0.0.0.0:8080` (`PORT`, `HOST`, `LOG_LEVEL`, `TVBOX_CACHE` env; `--pi` → `PI_ARGS`).
  - Errors: `{error}` with the error's `statusCode` (400 validation, 404 unknown id, 409 conflict, 507 no disk space), anything else 502.
  - `GET /api/search?q=` → `{results, errors}`
  - `POST /api/play {id, episode?} | {torrent, file?, files?, title?}` → status
  - `POST /api/control {action, value?}`: `play pause toggle seekBy seekTo volume volumeBy audio sub next prev` (`sub: null|"off"` disables) → `{ok}`
  - `POST /api/stop`, `GET /api/status`, `GET /api/tracks`
  - `GET /api/downloads` → items; `POST /api/downloads {torrent, file?, title?}` → 201 item; `PATCH /api/downloads/:id {paused?, keep?}` → item; `DELETE /api/downloads/:id` → 204
  - `GET /api/storage` → `{dir, free, total, used, policy}`
  - WebSocket `/ws`: `{type: "status", ...}` (≤ 4/s) and `{type: "downloads", items}` (≤ 1/s); both sent on connect.
  - Static files from `public/`.

### Testing so far (Windows, real mpv)

- Player: playback, pause, seek, volume, tracks through the API.
- Fresh Internet Archive film (Nosferatu 720p): `/play` → video in ~8 s, 4–6 MB/s, seek to 33 min resumes in < 4 s.
- Library: two parallel downloads; duplicate add returns the same item; other downloads wait while a film plays and continue after stop; pause/resume; keep; delete (files gone from disk); completed film plays from disk; deleting the playing film stops it; 404/409/400 errors.
- Restart: unfinished download resumes from where it was; orphan folder deleted; film finished 31 days ago deleted on start.
- Series (The Lone Ranger 1949, IA classic_tv, pasted as .torrent URL, 16 episodes): playlist in order, only episodes 1–2 download while 1 plays, next/prev and their limits, auto-advance at eof, play a given episode, last episode remembered across restart, whole series downloads after stop, same torrent re-added with a different file set shares finished files, deleting one item keeps the shared files. v1 → v2 migration. State survives a hard kill while downloading.
- Not tested yet: the 507 disk-full path (test PC had 390 GB free), Raspberry Pi.

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
- **Статус проверки:** синтаксис проверен (`node --check`), но с реальным mpv код ещё не запускался. Первым делом нужно протестировать его вручную: `npm run player`, затем `load <файл>`.

## Договорённости

- Communicate with the user in English.
- Code in Node.js, ESM. All code comments in English.
- Пользователь живёт в Украине, железо покупает там (Prom, Rozetka и др.).
- Backend будет раздавать статус через WebSocket. Событие `state` из MpvPlayer приходит часто (при каждом обновлении `time-pos`), поэтому перед отправкой на телефон его нужно ограничивать по частоте.
