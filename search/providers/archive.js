// archive.js — Internet Archive provider (public-domain feature films)
//
// One IA item often holds several versions of the same film (1080p mkv, 480p mp4, 240p…),
// all inside a single torrent. Each quality becomes a separate result that points at
// one file inside the item's torrent.

const API = 'https://archive.org';
const MAX_ITEMS = 10;
const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|avi|mov|mpe?g|ogv|m2ts|ts)$/i;
const MIN_SIZE = 50 * 1024 * 1024;   // skip trailers, samples, previews
// Films split into parts ("1of5", "part2", "cd1", "reel 3") — not supported yet, would need a playlist
const SPLIT_PART = /(\d+\s*of\s*\d+|part[\s_-]*\d+|\bcd[\s_-]*\d+|reel[\s_-]*\d+)/i;

export default {
  id: 'archive',
  name: 'Internet Archive',

  async search(query, { signal } = {}) {
    if (/^(magnet:|https?:\/\/)/i.test(query)) return [];

    const items = await findItems(query, signal);
    const perItem = await Promise.allSettled(items.map((item) => itemResults(item, signal)));
    return perItem.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  },
};

async function findItems(query, signal) {
  // Strip characters that have a meaning in the Lucene query syntax
  const words = query.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim();
  if (!words) return [];

  const params = new URLSearchParams({
    q: `title:(${words}) AND mediatype:movies AND collection:feature_films`,
    rows: String(MAX_ITEMS),
    output: 'json',
  });
  for (const f of ['identifier', 'title', 'year']) params.append('fl[]', f);
  params.append('sort[]', 'downloads desc');

  const data = await getJson(`${API}/advancedsearch.php?${params}`, signal);
  return data.response?.docs ?? [];
}

async function itemResults(item, signal) {
  const meta = await getJson(`${API}/metadata/${encodeURIComponent(item.identifier)}`, signal);
  const files = meta.files ?? [];

  const torrentFile = files.find((f) => f.name.endsWith('_archive.torrent'));
  if (!torrentFile) return [];   // IA has not built a torrent for this item

  const videos = files
    .filter((f) => VIDEO_EXT.test(f.name) && Number(f.size) >= MIN_SIZE && !SPLIT_PART.test(f.name))
    .map((f) => ({ name: f.name, size: Number(f.size), quality: qualityOf(f) }));

  // Several files per quality are common (mkv + mp4 + m2ts at 1080p) — keep the smallest,
  // it streams fastest at the same resolution
  const best = new Map();
  for (const v of videos) {
    const prev = best.get(v.quality);
    if (!prev || v.size < prev.size) best.set(v.quality, v);
  }

  // Drop a quality if a better one in the same item is not larger (e.g. 720p 8 GB vs 1080p 1.7 GB),
  // and 240p unless nothing else exists
  const sorted = [...best.values()].sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
  let smallest = Infinity;
  let kept = sorted.filter((v) => {
    if (v.size >= smallest) return false;
    smallest = v.size;
    return true;
  });
  if (kept.length > 1) kept = kept.filter((v) => v.quality !== '240p');

  const year = Number(item.year) || undefined;
  const title = firstOf(item.title) ?? item.identifier;
  return kept
    .map((v) => ({
      provider: 'archive',
      id: `${item.identifier}/${v.name}`,
      title,
      year,
      quality: v.quality,
      size: v.size,
      seeders: null,   // IA torrents are served by archive.org web seeds
      torrent: `${API}/download/${encodeURIComponent(item.identifier)}/${encodeURIComponent(torrentFile.name)}`,
      file: v.name,
      url: `${API}/details/${encodeURIComponent(item.identifier)}`,
    }));
}

// Standard buckets; width also counts, so 1920×800 widescreen is still 1080p
function qualityOf(f) {
  const w = Number(f.width) || 0;
  const h = Number(f.height) || 0;
  if (!w && !h) return '?';
  if (w >= 1800 || h >= 1000) return '1080p';
  if (w >= 1200 || h >= 700) return '720p';
  if (w >= 800 || h >= 440) return '480p';
  if (w >= 600 || h >= 330) return '360p';
  return '240p';
}

function qualityRank(q) {
  return parseInt(q, 10) || 0;
}

function firstOf(v) {
  return Array.isArray(v) ? v[0] : v;
}

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Internet Archive: HTTP ${res.status}`);
  return res.json();
}
