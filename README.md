# TV Box

A homemade TV box: pick a movie on your phone, and it plays on the TV over HDMI.
See [CLAUDE.md](CLAUDE.md) for the full project description.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer
- [mpv](https://mpv.io/) available on `PATH` as the `mpv` command

## Installing mpv

### Windows

```powershell
winget install shinchiro.mpv
```

This installs to `C:\Program Files\MPV Player\mpv.exe`, but **does not add it to `PATH`**.
Add it yourself (no admin rights needed):

```powershell
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Program Files\MPV Player", "User")
```

Open a **new** terminal afterwards so `PATH` is refreshed, then check:

```powershell
mpv --version
```

### Raspberry Pi OS / Debian / Ubuntu

```bash
sudo apt update
sudo apt install mpv
```

### macOS

```bash
brew install mpv
```

## Setup

```bash
npm install
```

## Running the player (manual test)

```bash
npm run player        # desktop: mpv opens in a window
npm run player:pi     # Raspberry Pi: output straight to HDMI (DRM/KMS)
```

Then type `load <path or URL>` to play a file, and `help` for the command list.

## Playing a magnet link

The box works with magnet links only: there is no search.

```bash
npm run play -- "<magnet link>"
npm run play -- "<magnet link>" --episode 3
```

The torrent is added to the download library and played in mpv while it downloads. A torrent
with several videos (a series, or a film split into parts) plays as a playlist: episodes in
order, the next one starts automatically. `--episode <n>` starts from episode `n`. Add
`--serve-only` to skip mpv and only print the local stream URL.

The magnet needs living peers: the torrent's metadata comes from them. If none answer within
90 seconds, you get "no peers found".

Example with a legal test torrent ([Sintel](https://durian.blender.org/), CC-BY):

```bash
npm run play -- "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent"
```

## Series

A series is a torrent with several episodes; paste its magnet link the same way as a film.
The box plays the episodes in order and remembers where you stopped: playing the series again
continues from the last episode.

- Episodes are sorted naturally (`E2` before `E10`); samples, trailers and extras are skipped.
- While you watch an episode, the next one downloads too, so it starts right away.
- `next` / `prev` control actions switch episodes.
## Downloads

Everything played or downloaded goes into the download library, stored in `$TMPDIR/tvbox-cache`
(set `TVBOX_CACHE` to change it; on the Pi this will be the USB drive). It survives restarts:
unfinished downloads continue where they stopped.

- While a film plays, other downloads wait, so the stream gets all the bandwidth.
- An unfinished film keeps downloading after you stop watching, so it starts instantly next time.
- Finished films play straight from disk.
- Automatic cleanup (films marked "keep" are never touched):
  - finished films: 30 days after last watched;
  - unfinished downloads: after 7 days without progress;
  - when free disk space drops under 5 GB: least recently used films first.

Don't run `npm start` and `npm run play` at the same time: they would share the same library.

## Running the backend

```bash
npm start        # desktop
npm run start:pi # Raspberry Pi: mpv outputs straight to HDMI
```

Listens on port 8080 on all interfaces (override with `PORT` / `HOST`) and prints the LAN
address to open on your phone. The remote UI arrives in the next stage; until then, use the API:

| Method | Path | Body / query |
| --- | --- | --- |
| POST | `/api/play` | `{ "magnet": "magnet:?..." }` or `{ "id": "...", "episode": 0 }` (from the library; `episode` optional) |
| POST | `/api/control` | `{ "action": "pause" }`, `{ "action": "seekBy", "value": 10 }`, … |
| POST | `/api/stop` | |
| GET | `/api/status`, `/api/tracks` | |
| GET | `/api/downloads` | list of downloads |
| POST | `/api/downloads` | `{ "magnet": "magnet:?..." }`: download without playing |
| PATCH | `/api/downloads/:id` | `{ "paused": true }`, `{ "keep": true }` |
| DELETE | `/api/downloads/:id` | deletes the files |
| GET | `/api/storage` | free / total / used disk space and cleanup settings |
| WS | `/ws` | pushes `{ "type": "status", ... }` (≤ 4/s) and `{ "type": "downloads", "items": [...] }` (≤ 1/s) |

Control actions: `play`, `pause`, `toggle`, `seekBy`, `seekTo`, `volume`, `volumeBy`, `audio`, `sub`, `next`, `prev`.
