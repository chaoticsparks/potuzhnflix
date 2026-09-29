#!/usr/bin/env bash
# migrate-disk.sh — copies the current download folder onto a different, already-formatted disk,
# so switching disks with use-disk.sh doesn't lose what's already downloaded (progress, "keep",
# resume position, watch history all live in that folder's library.json).
#
#   sudo bash deploy/migrate-disk.sh <new disk UUID> <folder>   e.g. ... 1234-ABCD tvbox
#
# Run this BEFORE use-disk.sh <new UUID> <folder>. Only reads from the disk currently in service
# (whatever use-disk.sh has mounted at the moment) — never touches or unmounts it.
set -euo pipefail

APP_USER="${SUDO_USER:?run it with sudo from the user that owns the app}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$APP_DIR/deploy/lib.sh"


# The apostrophe in a possessive ("disk's") breaks bash's brace-matching inside ${...:?...} even
# though it's inside double quotes — confirmed by reproducing it locally. Keep these apostrophe-free.
NEW_UUID="${1:?usage: migrate-disk.sh <new disk UUID> <folder>}"
FOLDER="${2:?usage: migrate-disk.sh <new disk UUID> <folder>}"
NEW_DEV="/dev/disk/by-uuid/$NEW_UUID"
[[ -e "$NEW_DEV" ]] || { echo "ERROR: no partition with UUID $NEW_UUID (is the disk plugged in?)" >&2; exit 1; }

mountpoint -q "$TVBOX_MOUNT" || { echo "ERROR: nothing is mounted at $TVBOX_MOUNT — is a disk currently in use? (see use-disk.sh)" >&2; exit 1; }
[[ -d "$TVBOX_MOUNT/$FOLDER" ]] || { echo "ERROR: no '$FOLDER' folder on the current disk ($TVBOX_MOUNT)" >&2; exit 1; }

TMP=/mnt/migrate-disk-tmp
install -d "$TMP"
mountpoint -q "$TMP" && umount "$TMP"
mount "$NEW_DEV" "$TMP"
if [[ ! -d "$TMP/$FOLDER" ]]; then
  umount "$TMP"
  echo "ERROR: no '$FOLDER' folder on the new disk — format it first: deploy/format-disk.sh" >&2
  exit 1
fi

SIZE="$(du -sh "$TVBOX_MOUNT/$FOLDER" 2>/dev/null | cut -f1)"
echo "== Stopping the box so nothing changes mid-copy (the TV and remote go quiet until use-disk.sh next)"
systemctl stop potuzhnflix

echo "== Copying $TVBOX_MOUNT/$FOLDER ($SIZE) -> $TMP/$FOLDER"
echo "   No progress meter — for a full library this can take a while (disk speed limited); be patient."
cp -a "$TVBOX_MOUNT/$FOLDER/." "$TMP/$FOLDER/"
chown -R "$APP_USER:" "$TMP/$FOLDER"
sync
umount "$TMP"

echo
echo "Done. $TVBOX_MOUNT (the old disk) is untouched — kept as a backup until you're sure."
echo "Next: sudo bash deploy/use-disk.sh $NEW_UUID $FOLDER"
