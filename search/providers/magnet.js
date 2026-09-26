// magnet.js — "manual" provider: turns a pasted magnet link, info hash or .torrent URL into a result

const HASH_RE = /^([a-f0-9]{40}|[a-z2-7]{32})$/i;

export default {
  id: 'magnet',
  name: 'Magnet link',

  async search(query) {
    if (query.startsWith('magnet:?')) {
      const params = new URLSearchParams(query.slice('magnet:?'.length));
      const hash = /urn:btih:([^&]+)/i.exec(params.get('xt') ?? '')?.[1];
      if (!hash) return [];
      const size = Number(params.get('xl'));
      return [{
        provider: 'magnet',
        id: hash.toLowerCase(),
        title: params.get('dn') || hash,
        size: size > 0 ? size : undefined,
        seeders: null,
        torrent: query,
      }];
    }

    if (HASH_RE.test(query)) {
      return [{ provider: 'magnet', id: query.toLowerCase(), title: query, seeders: null, torrent: query }];
    }

    if (/^https?:\/\/\S+\.torrent(\?\S*)?$/i.test(query)) {
      const name = decodeURIComponent(new URL(query).pathname.split('/').pop());
      return [{ provider: 'magnet', id: query, title: name, seeders: null, torrent: query }];
    }

    return [];
  },
};
