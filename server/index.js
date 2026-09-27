// index.js — HTTP API + WebSocket status + the phone remote (built into web/dist)
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { TvBox } from './tvbox.js';
import { PI_ARGS } from '../player/player.js';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST ?? '0.0.0.0';
const STATUS_INTERVAL_MS = 250;      // mpv reports time-pos many times a second; phones get ≤ 4 updates/s
const DOWNLOADS_INTERVAL_MS = 1000;

// Shown on the TV's idle screen; on the Pi this will be http://tvbox.local (set TVBOX_URL)
const REMOTE_URL = process.env.TVBOX_URL ?? `http://${lanAddresses()[0] ?? 'localhost'}:${PORT}`;

// Extra mpv options, space-separated, e.g. TVBOX_MPV_ARGS="--geometry=960x540+40+40"
const EXTRA_MPV_ARGS = (process.env.TVBOX_MPV_ARGS ?? '').split(/\s+/).filter(Boolean);

const box = new TvBox({
  playerArgs: [...(process.argv.includes('--pi') ? PI_ARGS : []), ...EXTRA_MPV_ARGS],
  remoteUrl: REMOTE_URL,
});
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
box.on('error', (err) => app.log.error(err));

await app.register(fastifyWebsocket);
const WEB_DIST = fileURLToPath(new URL('../web/dist', import.meta.url));
if (fs.existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST });
} else {
  app.get('/', (req, reply) => reply.type('text/plain; charset=utf-8')
    .send('ПотужнFLIX: the remote is not built yet. Run "npm run build".'));
}

// Errors carry statusCode (validation → 400, library → 404/409/507); anything else is a torrent/mpv failure
app.setErrorHandler((err, req, reply) => {
  const code = err.statusCode ?? 502;
  if (code >= 500) req.log.error(err);
  reply.code(code).send({ error: err.message });
});

const magnet = { type: 'string', pattern: '^magnet:\\?' };

// --- Playback ---

// Body: { id, episode? } to play from the library, or { magnet } for a new one.
// A torrent with several videos (series) becomes a playlist.
app.post('/api/play', {
  schema: {
    body: {
      type: 'object',
      properties: { magnet, id: { type: 'string' }, episode: { type: 'integer', minimum: 0 } },
    },
  },
}, async (req) => {
  await box.play(req.body);
  return box.status();
});

app.post('/api/control', {
  schema: {
    body: { type: 'object', required: ['action'], properties: { action: { type: 'string' }, value: {} } },
  },
}, async (req) => {
  await box.control(req.body.action, req.body.value);
  return { ok: true };
});

app.post('/api/stop', async () => {
  await box.stop();
  return box.status();
});

app.get('/api/status', () => box.status());
app.get('/api/tracks', () => box.tracks());

// --- Downloads library ---

app.get('/api/downloads', () => box.library.list());

app.post('/api/downloads', {
  schema: { body: { type: 'object', required: ['magnet'], properties: { magnet } } },
}, async (req, reply) => {
  reply.code(201);
  return box.download(req.body);
});

// Body: { paused?: boolean, keep?: boolean }
app.patch('/api/downloads/:id', {
  schema: {
    body: { type: 'object', properties: { paused: { type: 'boolean' }, keep: { type: 'boolean' } } },
  },
}, async (req, reply) => {
  const { id } = req.params;
  if (!box.library.get(id)) return reply.code(404).send({ error: `No such download: ${id}` });
  if (req.body.keep !== undefined) box.library.setKeep(id, req.body.keep);
  if (req.body.paused === true) await box.library.pause(id);
  if (req.body.paused === false) await box.library.resume(id);
  return box.library.get(id);
});

app.delete('/api/downloads/:id', async (req, reply) => {
  await box.deleteDownload(req.params.id);
  reply.code(204);
});

app.get('/api/storage', () => box.library.storage());

// --- WebSocket: full state on connect, then throttled updates ---

const clients = new Set();

function broadcast(msg) {
  const json = JSON.stringify(msg);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) socket.send(json);
  }
}

app.get('/ws', { websocket: true }, (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify({ type: 'status', ...box.status() }));
  socket.send(JSON.stringify({ type: 'downloads', items: box.library.list() }));
  socket.on('close', () => clients.delete(socket));
});

box.on('status', throttle((status) => broadcast({ type: 'status', ...status }), STATUS_INTERVAL_MS));
box.on('downloads', throttle((items) => broadcast({ type: 'downloads', items }), DOWNLOADS_INTERVAL_MS));

// --- Start / stop ---

await box.init();
await app.listen({ port: PORT, host: HOST });
for (const addr of lanAddresses()) app.log.info(`Remote: http://${addr}:${PORT}`);
app.log.info(`Downloads: ${box.library.dir}`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  await box.shutdown();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Calls fn at most once per `ms`, always delivering the latest value
function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pending;
  return (value) => {
    pending = value;
    if (timer) return;
    const wait = Math.max(0, last + ms - Date.now());
    timer = setTimeout(() => {
      timer = null;
      last = Date.now();
      fn(pending);
    }, wait);
  };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}
