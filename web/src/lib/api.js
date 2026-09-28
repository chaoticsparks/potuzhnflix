// api.js — REST calls to the backend; errors carry the server's message

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return reply(res);
}

// A .torrent file goes up as the raw body
async function upload(path, file) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-bittorrent' },
    body: file,
  });
  return reply(res);
}

async function reply(res) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  play: (body) => call('POST', '/api/play', body),              // { magnet } | { id, episode? }
  control: (action, value) => call('POST', '/api/control', { action, value }),
  stop: () => call('POST', '/api/stop'),
  tracks: () => call('GET', '/api/tracks'),
  download: (magnet) => call('POST', '/api/downloads', { magnet }),
  playTorrent: (file) => upload('/api/play/torrent', file),           // file: a .torrent File
  downloadTorrent: (file) => upload('/api/downloads/torrent', file),
  update: (id, patch) => call('PATCH', `/api/downloads/${encodeURIComponent(id)}`, patch),   // { paused?, keep?, wanted?: [episode positions] }
  remove: (id) => call('DELETE', `/api/downloads/${encodeURIComponent(id)}`),
  storage: () => call('GET', '/api/storage'),
  power: (action) => call('POST', '/api/power', { action }),   // 'poweroff' | 'reboot' (the Pi only)
};
