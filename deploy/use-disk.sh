#!/usr/bin/env bash
# use-disk.sh — keep downloads in a folder on an existing disk. Never formats and never deletes:
# it only mounts the partition and points the service at <disk>/<folder>.
#
#   sudo bash deploy/use-disk.sh <filesystem UUID> <folder>   e.g. ... 90DE2E52DE2E3140 tvbox
#   sudo bash deploy/use-disk.sh --off                         back to the SD card
#
# Find the UUID with: lsblk -o NAME,SIZE,FSTYPE,LABEL,UUID
set -euo pipefail

APP_USER="${SUDO_USER:?run it with sudo from the user that owns the app}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$APP_DIR/deploy/lib.sh"

MNT=/mnt/tvbox-disk
DROPIN_DIR=/etc/systemd/system/potuzhnflix.service.d
DROPIN="$DROPIN_DIR/disk.conf"

# fstab without our line (matched by mount point)
fstab_without_ours() {
  awk -v mnt="$MNT" '$2 != mnt' /etc/fstab
}

if [[ "${1:-}" == --off ]]; then
  echo "== Downloads back to the SD card"
  rm -f "$DROPIN"
  systemctl daemon-reload
  systemctl restart potuzhnflix
  umount "$MNT" 2>/dev/null || true
  fstab_without_ours | put /etc/fstab 644
  systemctl daemon-reload
  echo "Done. The disk can be unplugged."
  exit 0
fi

UUID="${1:?usage: use-disk.sh <filesystem UUID> <folder> | --off}"
FOLDER="${2:?usage: use-disk.sh <filesystem UUID> <folder> | --off}"
DEV="/dev/disk/by-uuid/$UUID"
[[ -e "$DEV" ]] || { echo "ERROR: no partition with UUID $UUID (is the disk plugged in?)" >&2; exit 1; }

FSTYPE="$(blkid -o value -s TYPE "$DEV")"
OWNER="uid=$(id -u "$APP_USER"),gid=$(id -g "$APP_USER")"
# nofail: the Pi still boots without the disk; the service then waits for it (see the drop-in)
COMMON="noatime,nofail,x-systemd.device-timeout=20s"
case "$FSTYPE" in
  # ntfs3: the kernel driver (fast); windows_names: no file names that Windows can't open
  ntfs)  TYPE=ntfs3; OPTS="$OWNER,umask=022,windows_names,$COMMON" ;;
  exfat) TYPE=exfat; OPTS="$OWNER,umask=022,$COMMON" ;;
  ext4)  TYPE=ext4;  OPTS="$COMMON" ;;
  *) echo "ERROR: $FSTYPE is not supported here (NTFS, exFAT or ext4)" >&2; exit 1 ;;
esac

echo "== Mounting $DEV ($FSTYPE) at $MNT — nothing is formatted or deleted"
install -d "$MNT"
{ fstab_without_ours; echo "UUID=$UUID  $MNT  $TYPE  $OPTS  0  0"; } | put /etc/fstab 644
systemctl daemon-reload
mountpoint -q "$MNT" && umount "$MNT"
if ! mount "$MNT"; then
  echo >&2
  echo "ERROR: the disk didn't mount. If it's NTFS and says 'dirty': plug it into Windows," >&2
  echo "use 'Safely remove', or run 'chkdsk <letter>: /f' there, then try again." >&2
  fstab_without_ours | put /etc/fstab 644
  systemctl daemon-reload
  exit 1
fi

CACHE="$MNT/$FOLDER"
[[ -d "$CACHE" ]] || { echo "ERROR: folder '$FOLDER' not found on the disk (the name is case-sensitive)" >&2; exit 1; }
[[ "$FSTYPE" == ext4 ]] && chown "$APP_USER:" "$CACHE"
sudo -u "$APP_USER" test -w "$CACHE" || { echo "ERROR: $APP_USER can't write to $CACHE" >&2; exit 1; }

echo "== Downloads go to $CACHE; the service starts only when the disk is mounted"
install -d "$DROPIN_DIR"
put "$DROPIN" 644 <<EOF
# Written by deploy/use-disk.sh — remove with: sudo bash deploy/use-disk.sh --off
[Unit]
RequiresMountsFor=$MNT

[Service]
Environment=TVBOX_CACHE=$CACHE
EOF
systemctl daemon-reload
systemctl restart potuzhnflix

sync
echo
echo "Done: $(df -h --output=avail "$MNT" | tail -1 | tr -d ' ') free on the disk."
