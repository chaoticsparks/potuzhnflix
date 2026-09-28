#!/usr/bin/env bash
# setup-pi.sh — one-time system setup for ПотужнFLIX on Raspberry Pi OS Lite (Debian 13).
# Run from the app user's account: sudo bash deploy/setup-pi.sh
# Safe to run again (e.g. after changing the cache folder).
set -euo pipefail

APP_USER="${SUDO_USER:?run it with sudo from the user that owns the app}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_DIR="${TVBOX_CACHE:-/home/$APP_USER/tvbox-cache}"
# A download disk set up with use-disk.sh overrides CACHE_DIR in a drop-in; this script leaves it alone
source "$APP_DIR/deploy/lib.sh"

echo "== Packages: mpv, Node.js, npm"
apt-get update
apt-get install -y --no-install-recommends mpv nodejs npm

echo "== Download folder: $CACHE_DIR"
install -d -o "$APP_USER" -g "$APP_USER" "$CACHE_DIR"

echo "== Service: potuzhnflix.service"
sed -e "s|@USER@|$APP_USER|g" -e "s|@DIR@|$APP_DIR|g" -e "s|@CACHE@|$CACHE_DIR|g" \
  "$APP_DIR/deploy/potuzhnflix.service" | put /etc/systemd/system/potuzhnflix.service 644
systemctl daemon-reload
systemctl enable potuzhnflix.service

echo "== HDMI belongs to the player: no login prompt on the TV"
systemctl disable --now getty@tty1.service

echo "== HDMI0 always on at 1080p, even while the TV is off (applies after a reboot)"
# Many TVs drop hot-plug in standby; without this the Pi sees no screen and mpv can't start
CMDLINE=/boot/firmware/cmdline.txt
if ! grep -q 'video=HDMI-A-1:' "$CMDLINE"; then
  printf '%s video=HDMI-A-1:1920x1080@60D\n' "$(tr -d '\n' < "$CMDLINE")" | put "$CMDLINE" -
  echo "   added video=HDMI-A-1:1920x1080@60D — reboot to apply"
fi

echo "== Let $APP_USER run exactly these as root without a password:"
echo "   start/stop/restart the service (updates), power off / reboot (the remote's button),"
echo "   mount the download disk (the box retries when it's plugged in later)"
put /etc/sudoers.d/potuzhnflix 440 <<EOF
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl start potuzhnflix, /usr/bin/systemctl stop potuzhnflix, /usr/bin/systemctl restart potuzhnflix
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff, /usr/bin/systemctl reboot
$APP_USER ALL=(root) NOPASSWD: /usr/bin/mount $TVBOX_MOUNT
EOF
visudo -cf /etc/sudoers.d/potuzhnflix

sync
echo
echo "Done. Next, as $APP_USER:"
echo "  cd $APP_DIR && npm ci && npm run build && sudo systemctl start potuzhnflix"
