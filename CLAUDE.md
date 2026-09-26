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

Raspberry Pi OS Lite (64-bit), Node.js 18+ (ESM), WebTorrent, mpv, Fastify, WebSocket, PWA на Svelte, systemd, Avahi (mDNS, `tvbox.local`).

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
2. **Торрент-движок.** ← IN PROGRESS (POC done: `npm run play -- "<magnet>"`, see `torrent/`; cache cleanup postponed)
   - Принимает magnet-ссылку или .torrent, сам выбирает самый крупный видеофайл.
   - Качает последовательно, при перемотке меняет приоритет кусков.
   - Раздаёт файл локальным HTTP-сервером с поддержкой Range.
   - Отдаёт статус: процент загрузки, скорость, пиры.
   - Чистит кэш после просмотра или при заполнении диска.
   - Результат этапов 1–2: фильм по magnet-ссылке играет из командной строки.
3. **Поиск.** Интерфейс провайдера и модули Internet Archive и ручного magnet.
4. **Backend.** Fastify.
   - REST: `/search`, `/play`, `/control`, `/stop`.
   - WebSocket со статусом.
   - Раздаёт PWA.
   - Связывает поиск → торрент → mpv.
5. **PWA-пульт.**
   - Экран поиска и список результатов.
   - Экран пульта: пауза, ползунок перемотки, громкость, ±10 с, субтитры и аудиодорожки.
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
  package.json        # "type": "module", скрипты: npm run player / player:pi / play / play:pi
  player/
    player.js         # класс MpvPlayer (EventEmitter)
    cli.js            # консольный пульт для ручной проверки
  torrent/
    engine.js         # TorrentEngine: WebTorrent + local HTTP server with Range
    cli.js            # magnet/.torrent → engine → mpv, prints download status
```

### `torrent/engine.js`, class `TorrentEngine` (POC)

- `open(torrentId)`: magnet / .torrent path / info hash. Added with `deselect: true`, then only the largest video file is selected (WebTorrent default strategy is `sequential`).
- `serve()`: HTTP server on `127.0.0.1` (random port), returns the file URL for mpv. Supports single `Range` requests (206/416) and HEAD.
- Seeking: each Range request calls `file.createReadStream({start, end})`, which makes WebTorrent prioritise the pieces at that position. No custom priority logic yet.
- `status()` and the `status` event (every 1 s): `{name, progress, downloaded, length, downloadSpeed, uploadSpeed, peers}`.
- Cache: `$TMPDIR/tvbox-cache`. Nothing is deleted yet (cleanup postponed).
- `cli.js --serve-only`: serves without starting mpv (handy for testing with curl).
- Tested on Windows with the Sintel torrent (CC-BY): metadata, file choice, Range and far seeks work. Full playback in mpv not yet checked.
- npm warns that install scripts for `node-datachannel` / `bufferutil` / `utf-8-validate` were skipped. This is harmless: `node-datachannel` ships a prebuilt binary (WebRTC peers work), and the other two are optional speed-ups for `ws`.

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
