// format.js — numbers and dates for the UI (Ukrainian)

// Tape counter: 1:02:03 / 12:34
export function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function size(bytes) {
  if (!bytes) return '0 МБ';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} ГБ`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;   // .torrent files
}

export function speed(bytesPerSecond) {
  return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} МБ/с`;
}

export function percent(fraction) {
  return `${Math.floor((fraction ?? 0) * 100)}%`;
}

// 1 серія, 2 серії, 5 серій
export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// "через 5 днів" / "через 3 год" / "скоро"
export function until(timestamp) {
  const ms = timestamp - Date.now();
  if (ms <= 60 * 60 * 1000) return 'скоро';
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 48) return `через ${hours} год`;
  const days = Math.round(hours / 24);
  return `через ${days} ${plural(days, 'день', 'дні', 'днів')}`;
}

// Torrent / file names for people: no video extension, dots and underscores → spaces
export function prettyName(name) {
  return name.replace(/\.(mkv|mp4|m4v|avi|mov|webm|ogv|mpe?g|m2?ts)$/i, '').replace(/[._]+/g, ' ').trim();
}
