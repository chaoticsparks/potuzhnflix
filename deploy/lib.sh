# lib.sh — helpers for the deploy scripts (sourced, not run)

# Write stdin to a file so that a power cut can't leave it empty: temp file, fsync, rename.
# put <target> <mode>; mode "-" skips chmod (FAT boot partition has no Unix permissions)
put() {
  local target="$1" mode="$2" tmp="$1.new"
  cat > "$tmp"
  [[ -s "$tmp" ]] || { echo "ERROR: nothing to write to $target" >&2; exit 1; }
  [[ "$mode" == - ]] || chmod "$mode" "$tmp"
  sync "$tmp"
  mv "$tmp" "$target"
  sync "$(dirname "$target")"
}
