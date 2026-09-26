// cli.js — play a magnet link / .torrent on mpv from the terminal, through the download library
import { Library } from '../library/library.js';
import { MpvPlayer, PI_ARGS } from '../player/player.js';

const args = process.argv.slice(2);
const onPi = args.includes('--pi');
const serveOnly = args.includes('--serve-only');
const fileIdx = args.indexOf('--file');
const wantedFile = fileIdx >= 0 ? args[fileIdx + 1] : undefined;
const torrentId = args.find((a, i) => !a.startsWith('--') && !(fileIdx >= 0 && i === fileIdx + 1));

if (!torrentId) {
  console.log('Usage: npm run play -- "<magnet | .torrent path or URL>" [--file <path in torrent>] [--pi] [--serve-only]');
  process.exit(1);
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

const library = new Library();
library.on('error', (err) => console.error('\nError:', err.message));
await library.load();

console.log('Fetching torrent metadata…');
const item = await library.add({ torrent: torrentId, file: wantedFile });
console.log(`Video file: ${item.name} (${mb(item.length)} MB)`);

const source = await library.stream(item.id);
console.log(`Source: ${source}`);

library.on('changed', () => {
  const s = library.get(item.id);
  if (!s) return;
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
  console.log('\nStopping… (the film stays in the library)');
  await player?.quit();
  await library.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);

if (!serveOnly) {
  player = new MpvPlayer({ extraArgs: onPi ? PI_ARGS : [] });
  player.on('exit', shutdown);
  await player.start();
  await player.load(source, { title: item.title });
  console.log('Playing in mpv. Close the mpv window or press Ctrl+C to stop.');
} else {
  console.log('Serve-only mode. Press Ctrl+C to stop.');
}
