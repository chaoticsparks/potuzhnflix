# TV Box

A homemade TV box: pick a movie on your phone, and it plays on the TV over HDMI.
See [CLAUDE.md](CLAUDE.md) for the full project description.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
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

## Playing a torrent

```bash
npm run play -- "<magnet link or path to .torrent>"
```

The largest video file in the torrent is downloaded sequentially to `$TMPDIR/tvbox-cache`
and played in mpv while it downloads. Add `--serve-only` to skip mpv and only print the
local stream URL.

Example with a legal test torrent ([Sintel](https://durian.blender.org/), CC-BY):

```bash
npm run play -- "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent"
```
