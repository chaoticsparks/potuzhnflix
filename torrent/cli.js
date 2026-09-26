// cli.js — play a magnet link / .torrent on mpv from the terminal (stages 1–2 POC)
import { TorrentEngine } from './engine.js';
import { MpvPlayer, PI_ARGS } from '../player/player.js';

const args = process.argv.slice(2);
const onPi = args.includes('--pi');
const serveOnly = args.includes('--serve-only');
const torrentId = args.find((a) => !a.startsWith('--'));

if (!torrentId) {
  console.log('Usage: npm run play -- "<magnet link | path to .torrent>" [--pi] [--serve-only]');
  process.exit(1);
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

const engine = new TorrentEngine();
engine.on('error', (err) => console.error('\nTorrent error:', err.message));

console.log('Fetching torrent metadata…');
const info = await engine.open(torrentId);
console.log(`Video file: ${info.name} (${mb(info.length)} MB)`);

const url = await engine.serve();
console.log(`Streaming at ${url}`);

engine.on('status', (s) => {
  process.stdout.write(
    `\r${(s.progress * 100).toFixed(1)}% | ${mb(s.downloaded)}/${mb(s.length)} MB` +
    ` | ↓ ${mb(s.downloadSpeed)} MB/s | peers ${s.peers}   `,
  );
});

let player = null;
let exiting = false;
async function shutdown() {
  if (exiting) return;
  exiting = true;
  console.log('\nStopping…');
  await player?.quit();
  await engine.destroy();
  process.exit(0);
}
process.on('SIGINT', shutdown);

if (!serveOnly) {
  player = new MpvPlayer({ extraArgs: onPi ? PI_ARGS : [] });
  player.on('exit', shutdown);
  await player.start();
  await player.load(url, { title: info.name });
  console.log('Playing in mpv. Close the mpv window or press Ctrl+C to stop.');
} else {
  console.log('Serve-only mode. Press Ctrl+C to stop.');
}
