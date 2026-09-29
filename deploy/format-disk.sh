#!/usr/bin/env bash
# format-disk.sh — erases a disk and formats it ext4, with a folder ready for use-disk.sh.
# This is the ONLY script that formats anything; use-disk.sh (run next) never does.
#
#   sudo bash deploy/format-disk.sh <device> [folder]   e.g. ... /dev/sda1 tvbox
#
# Find the device with: lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT
set -euo pipefail

APP_USER="${SUDO_USER:?run it with sudo from the user that owns the app}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$APP_DIR/deploy/lib.sh"

DEV="${1:?usage: format-disk.sh <device> [folder]}"
FOLDER="${2:-tvbox}"
[[ -b "$DEV" ]] || { echo "ERROR: $DEV is not a block device (is it plugged in?)" >&2; exit 1; }

# Refuse anything on the same disk as the root filesystem — never format the SD card.
# PKNAME is empty for a whole disk (not a partition), so fall back to its own name in that case:
# this also catches passing the root disk itself (not just one of its partitions).
root_disk() { lsblk -no PKNAME "$1" 2>/dev/null || true; }
ROOT_SRC="$(findmnt -no SOURCE /)"
ROOT_DISK="$(root_disk "$ROOT_SRC")"; ROOT_DISK="${ROOT_DISK:-$(basename "$ROOT_SRC")}"
DEV_DISK="$(root_disk "$DEV")"; DEV_DISK="${DEV_DISK:-$(basename "$DEV")}"
if [[ -n "$ROOT_DISK" && "$DEV_DISK" == "$ROOT_DISK" ]]; then
  echo "ERROR: $DEV is on /dev/$ROOT_DISK, the disk the Pi boots from. Refusing." >&2
  exit 1
fi

# If something's mounted at $DEV already (e.g. reformatting a disk that's currently in service),
# take it out of service first rather than formatting out from under a mounted filesystem
MOUNTED_AT="$(lsblk -no MOUNTPOINT "$DEV" 2>/dev/null || true)"
if [[ "$MOUNTED_AT" == "$TVBOX_MOUNT" ]]; then
  systemctl stop potuzhnflix
  umount "$TVBOX_MOUNT"
elif [[ -n "$MOUNTED_AT" ]]; then
  echo "ERROR: $DEV is mounted at $MOUNTED_AT — unmount it first." >&2
  exit 1
fi

echo "== About to ERASE EVERYTHING on $DEV and format it ext4:"
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT "$DEV"
echo
read -rp "Type the device path again to confirm ($DEV): " CONFIRM
[[ "$CONFIRM" == "$DEV" ]] || { echo "Doesn't match — nothing done."; exit 1; }

mkfs.ext4 -F -L "$FOLDER" "$DEV"
UUID="$(blkid -o value -s UUID "$DEV")"

# A fresh filesystem has no folder yet, and use-disk.sh refuses a disk without one — make it now.
# A private mountpoint, not $TVBOX_MOUNT: that one may already be busy with the disk in service.
TMP=/mnt/format-disk-tmp
install -d "$TMP"
mount "$DEV" "$TMP"
install -d -o "$APP_USER" "$TMP/$FOLDER"
sync
umount "$TMP"

echo
echo "Done. $DEV is ext4, UUID $UUID, with an empty '$FOLDER' folder."
echo "Next: sudo bash deploy/use-disk.sh $UUID $FOLDER"
