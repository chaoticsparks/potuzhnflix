// index.js — runs all search providers in parallel and merges their results
import magnet from './providers/magnet.js';
import archive from './providers/archive.js';

/**
 * A provider: { id, name, search(query, { signal }) → Promise<Result[]> }
 *
 * @typedef {object} Result
 * @property {string} provider   provider id
 * @property {string} id         unique within the provider
 * @property {string} title
 * @property {number=} year
 * @property {string=} quality   e.g. "1080p"
 * @property {number=} size      bytes of the video file (or whole torrent if unknown)
 * @property {number=} seeders   null when unknown
 * @property {string} torrent    magnet link, .torrent URL or path — passed to TorrentEngine.open()
 * @property {string=} file      file path inside the torrent; empty → largest video file
 * @property {string=} url       page with details about the release
 */

export const PROVIDERS = [magnet, archive];

export async function search(query, { providers = PROVIDERS, timeoutMs = 20000 } = {}) {
  query = query.trim();
  if (!query) return { results: [], errors: [] };

  const signal = AbortSignal.timeout(timeoutMs);
  const settled = await Promise.allSettled(providers.map((p) => p.search(query, { signal })));

  const results = [];
  const errors = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') results.push(...s.value);
    else errors.push({ provider: providers[i].id, message: s.reason?.message ?? String(s.reason) });
  });
  return { results, errors };
}
