# ПотужнFLIX

![ПотужнFLIX](logo.png)

A homemade TV box: paste a magnet link on your phone, and the film plays on the TV over HDMI.
See [CLAUDE.md](CLAUDE.md) for the full technical writeup.

## What you need

- A **Raspberry Pi 4** (2 GB or more; 4 GB recommended), with a power supply and a micro-HDMI cable.
- A **microSD card** (16 GB+) flashed with **Raspberry Pi OS Lite (64-bit)**.
- A **USB storage drive** for downloads — any USB flash drive, SSD or hard disk. NTFS, exFAT and
  ext4 are all supported, so a drive you already have works fine; nothing is erased unless you
  explicitly ask for that (see [Storage](#storage) below).
- A **TV with HDMI**, and a **phone** on the same Wi‑Fi network as the Pi.
- A computer to flash the SD card and to `ssh` into the Pi from.

## Setting up the box

1. **Flash the OS.** Use [Raspberry Pi Imager](https://www.raspberrypi.com/software/) to write
   **Raspberry Pi OS Lite (64-bit)** to the microSD card. In the imager's settings (the gear icon,
   or press `Ctrl+Shift+X`), set a hostname, enable SSH, and set a username and password — this
   avoids needing a keyboard/monitor on the Pi. Boot the Pi with the card inserted and an Ethernet
   cable or Wi‑Fi configured.

2. **Find it and log in.**
   ```bash
   ssh <username>@<hostname>.local
   ```
   (If `.local` doesn't resolve, find the Pi's IP address from your router's device list instead.)

3. **Copy this project to the Pi.** If you can clone the repo directly on the Pi, do that. Otherwise,
   from your computer:
   ```bash
   git archive HEAD | ssh <username>@<hostname>.local "mkdir -p potuzhnflix && tar -x -C potuzhnflix"
   ```

4. **Run the one-time setup script**, as root, from the app's own user account:
   ```bash
   ssh -t <username>@<hostname>.local "cd potuzhnflix && sudo bash deploy/setup-pi.sh"
   ```
   This installs `mpv`, Node.js and npm; creates a `potuzhnflix` systemd service (set to start on
   boot); disables the login prompt on the TV's HDMI output so mpv can use it; forces the HDMI
   output on at 1920×1080 even while the TV is in standby (many TVs drop the connection there,
   which otherwise leaves the Pi with no picture — this needs a reboot to take effect); and adds a
   narrow `sudoers` rule so the app can start/stop itself, power off or reboot, and mount the
   download disk, without a password. It's safe to run again.

5. **Set up storage** — see [Storage](#storage) below. You can also skip this for now: the box
   works without a disk, downloading nothing until one is set up.

6. **Build and start it:**
   ```bash
   ssh <username>@<hostname>.local "cd potuzhnflix && npm ci && npm run build && sudo systemctl start potuzhnflix"
   ```
   Reboot once (`sudo reboot`) so the HDMI fix from step 4 takes effect, if you haven't already.
   The TV should show the idle screen. Open the address the box prints (or scan the QR code shown
   on the TV) on your phone, on the same Wi‑Fi network.

To update the code later: copy the changed files the same way as step 3, run `npm ci` again only if
`package.json` changed, then `npm run build && sudo systemctl restart potuzhnflix`.

### Optional tweaks

Set these as `Environment=...` lines in the service (edit with
`sudo systemctl edit --full potuzhnflix`, then `sudo systemctl restart potuzhnflix`):

| Variable | Effect |
| --- | --- |
| `TVBOX_URL` | The address shown on the TV and used for the QR code (default: works it out automatically) |
| `TVBOX_SAVER_MIN` | Minutes idle before the TV screen saver kicks in (`0` = never; default 20) |
| `TVBOX_CEC` | Set to `off` to disable automatic TV power/input switching (HDMI-CEC), if your TV reacts badly to it |
| `TVBOX_MPV_ARGS` | Extra mpv options, space-separated |

If the TV stays off or shows "No primary DRM device could be picked" in the logs
(`journalctl -u potuzhnflix`), make sure the HDMI cable is in the port nearest the power connector
and that step 4's reboot happened.

## Storage

Downloads live in a folder on a USB disk, tracked with a `library.json` (progress, "keep" flags,
resume positions, watch history). `deploy/use-disk.sh` mounts an existing disk and points the box
at a folder on it — **it never formats or deletes anything**. That folder needs to already exist at
the root of the disk: create a folder there named `tvbox` (or whatever you'll pass below) from
Windows/macOS/Linux, or on the Pi by mounting the disk yourself once first (`lsblk` to find its
device, then `sudo mount /dev/sdXN /mnt`, `mkdir /mnt/tvbox`, `sudo umount /mnt`). Then:

```bash
lsblk -o NAME,SIZE,FSTYPE,LABEL,UUID     # find the disk's filesystem UUID
sudo bash deploy/use-disk.sh <UUID> tvbox
```

Works with NTFS, exFAT or ext4, so a drive already in use for something else is fine; the box only
ever touches the one folder you name.

**Starting from a blank drive?** `deploy/format-disk.sh` erases it and formats it ext4, with that
folder created for you:

```bash
sudo bash deploy/format-disk.sh /dev/sda1 tvbox   # asks you to confirm the device before erasing anything
sudo bash deploy/use-disk.sh <the UUID it prints> tvbox
```

**Moving to a different or bigger disk later, without losing what's downloaded?**
`deploy/migrate-disk.sh` copies the current disk's folder onto a new, already-formatted one (format
it first if it's blank), so downloads, "keep" flags, resume positions and watch history all carry
over:

```bash
sudo bash deploy/migrate-disk.sh <new disk's UUID> tvbox   # reads the old disk, never modifies it
sudo bash deploy/use-disk.sh <new disk's UUID> tvbox       # switches over
```

`sudo bash deploy/use-disk.sh --off` reverts to the SD card (mostly for testing — it fills up
fast). Without a disk mounted, the box still runs: the TV and remote work, they just say the disk
is missing.

## Using it

Open the address the box prints (also shown as a QR code on the TV's idle screen) on your phone, in
the same Wi‑Fi network. Add it to your home screen ("Add to Home Screen" on Safari, "Install app" /
"Add to home screen" on Chrome) for an app-like icon.

- **Пульт** (remote): a VCR deck. Display with the tape counter (tap it to switch to time
  remaining), seek bar, play/pause, ±10 s, previous/next episode, volume, audio and subtitle
  tracks, stop. When nothing plays: the magnet form and "continue watching" (resumes exactly where
  it was left off). Below: "Стан приставки", the box's own CPU temperature, power / overheating
  warnings, CPU, memory, network and uptime.
- **Полиця** (shelf): every film as a VHS tape. The tape moves from the left reel to the right one
  as it downloads. Pause/resume a download, protect a tape from automatic erasing (the lock tab),
  erase it, pick a series episode. Playback always resumes where it stopped (per episode); a title
  watched through to the end starts over from the beginning next time.
- **Історія переглядів** (watch history, below the shelf): everything watched recently, even after
  its download is gone — with when, how far you got, and a button to either continue it (if it's
  still on the shelf) or add it back by its magnet link (rebuilt from the torrent's info hash, no
  tracker needed).

Paste a magnet link or upload a .torrent file, then tap "Дивитися" (watch) to stream it right away,
or "На полицю" (add to shelf) to just download it. There's no search — bring your own link.

The UI is in Ukrainian.

## The TV picture

When nothing plays, the TV shows a synthwave night (striped sun, palms, a moving neon grid) with
"ВСТАВТЕ КАСЕТУ", a clock, a QR code and the address of the phone remote, and what is downloading.
While a film loads it shows an old-VCR blue screen, "ЗАВАНТАЖУЮ КАСЕТУ..."; during the film,
VCR-style messages: ▶ PLAY, ❚❚ PAUSE with the tape counter, ▶▶ / ◀◀ after seeking, a green
volume bar, and "ЗАВАНТАЖЕННЯ..." with the download speed (or "no peers") if it has to stop and
buffer. It is all drawn by mpv's on-screen display, so it works on the Pi without a desktop.

After 20 minutes on the idle screen with nobody using the remote, the TV goes dark with a dim
clock (screen saver; downloads go on). Opening the remote or pressing anything brings it back. On
the Pi, the box also turns the TV on and switches it to the right input by itself (HDMI-CEC) when
it starts up and whenever the screen saver ends, and puts the TV in standby when the screen saver
starts. See [Optional tweaks](#optional-tweaks) to change or disable any of this.

## Developing on a PC

The box can run entirely on a regular computer for development — mpv opens in a window instead of
going to HDMI, and the download disk is just a temp folder.

### Installing mpv

**Windows:**
```powershell
winget install shinchiro.mpv
```
This installs to `C:\Program Files\MPV Player\mpv.exe`, but **does not add it to `PATH`**. Add it
yourself (no admin rights needed):
```powershell
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Program Files\MPV Player", "User")
```
Open a **new** terminal afterwards so `PATH` is refreshed, then check with `mpv --version`.

**Raspberry Pi OS / Debian / Ubuntu:**
```bash
sudo apt update && sudo apt install mpv
```

**macOS:**
```bash
brew install mpv
```

### Setup

```bash
npm install
npm run build    # builds the phone remote into web/dist
```

### Running the player (manual test)

```bash
npm run player        # desktop: mpv opens in a window
npm run player:pi     # Raspberry Pi: output straight to HDMI (DRM/KMS)
```

Then type `load <path or URL>` to play a file, and `help` for the command list.

### Playing a magnet link

The box takes magnet links and .torrent files (in the phone remote: "Вибрати .torrent файл"); there is no search.

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

### Series

A series is a torrent with several episodes; paste its magnet link the same way as a film.
The box plays the episodes in order and remembers where you stopped: playing the series again
continues from the last episode.

- Episodes are sorted naturally (`E2` before `E10`); samples, trailers and extras are skipped.
- While you watch an episode, the next one downloads too, so it starts right away.
- `next` / `prev` control actions switch episodes.

### Downloads

Everything played or downloaded goes into the download library, stored in `$TMPDIR/tvbox-cache`
(set `TVBOX_CACHE` to change it; on the Pi this is the USB drive — see [Storage](#storage)). It
survives restarts: unfinished downloads continue where they stopped.

- While a film plays, other downloads wait, so the stream gets all the bandwidth.
- An unfinished film keeps downloading after you stop watching, so it starts instantly next time.
- Finished films play straight from disk.
- Automatic cleanup (films marked "keep" are never touched):
  - finished films: 30 days after last watched;
  - unfinished downloads: after 7 days without progress;
  - when free disk space drops under 5 GB: least recently used films first.

Don't run `npm start` and `npm run play` at the same time: they would share the same library.

### Running the backend

```bash
npm start        # desktop
npm run start:pi # Raspberry Pi: mpv outputs straight to HDMI
```

Listens on port 8080 on all interfaces (override with `PORT` / `HOST`) and prints the LAN
address to open on your phone.

To work on the UI with hot reload, run the backend and the Vite dev server side by side, then open
`http://<computer's IP>:5173` on the phone:

```bash
npm start
```
```bash
npm run dev:web
```

Windows Firewall may ask to allow Node.js on first start: allow it on private networks, or the
phone can't connect.

### API

The remote uses this API; it also works with `curl`:

| Method | Path | Body / query |
| --- | --- | --- |
| POST | `/api/play` | `{ "magnet": "magnet:?..." }` or `{ "id": "...", "episode": 0 }` (from the library; `episode` optional) |
| POST | `/api/control` | `{ "action": "pause" }`, `{ "action": "seekBy", "value": 10 }`, … |
| POST | `/api/stop` | |
| GET | `/api/status`, `/api/tracks` | |
| GET | `/api/downloads` | list of downloads |
| POST | `/api/downloads` | `{ "magnet": "magnet:?..." }`: download without playing |
| POST | `/api/play/torrent`, `/api/downloads/torrent` | the .torrent file as the body (`Content-Type: application/x-bittorrent`, ≤ 10 MB) |
| PATCH | `/api/downloads/:id` | `{ "paused": true }`, `{ "keep": true }` |
| DELETE | `/api/downloads/:id` | deletes the files |
| GET | `/api/storage` | free / total / used disk space and cleanup settings |
| GET | `/api/health` | CPU temperature, undervoltage / overheating warnings, CPU, memory, network, uptime |
| GET | `/api/history` | watched titles, most recent first, kept even after the download is deleted |
| DELETE | `/api/history/:id` | removes one history entry |
| POST | `/api/power` | `{ "action": "poweroff" }` or `{ "action": "reboot" }` (the Pi only) |
| WS | `/ws` | pushes `{ "type": "status", ... }` (≤ 4/s) and `{ "type": "downloads", "items": [...] }` (≤ 1/s) |

Control actions: `play`, `pause`, `toggle`, `seekBy`, `seekTo`, `volume`, `volumeBy`, `audio`, `sub`, `next`, `prev`.
