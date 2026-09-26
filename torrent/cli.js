// cli.js — play a magnet link / .torrent on mpv from the terminal, through the download library.
// A torrent with several videos (series) plays as a playlist: the next episode starts automatically.
import { Library } from '../library/library.js';
import { MpvPlayer, PI_ARGS } from '../player/player.js';

const args = process.argv.slice(2);
const onPi = args.includes('--pi');
const serveOnly = args.includes('--serve-only');
const valueOf = new Set();   // indexes of option values
const files = [];
let episode;
args.forEach((a, i) => {
  if (a === '--file') { files.push(args[i + 1]); valueOf.add(i + 1); }
  if (a === '--episode') { episode = Number(args[i + 1]) - 1; valueOf.add(i + 1); }
});
const torrentId = args.find((a, i) => !a.startsWith('--') && !valueOf.has(i));

if (!torrentId) {
  console.log('Usage: npm run play -- "<magnet | .torrent path or URL>" [--file <path in torrent>]... [--episode <n>] [--pi] [--serve-only]');
  process.exit(1);
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

const library = new Library();
library.on('error', (err) => console.error('\nError:', err.message));
await library.load();

console.log('Fetching torrent metadata…');
const item = await library.add({ torrent: torrentId, files });
if (item.files.length > 1) {
  console.log(`Playlist: ${item.title}`);
  item.files.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}. ${f.name} (${mb(f.length)} MB)`));
} else {
  console.log(`Video file: ${item.files[0].name} (${mb(item.length)} MB)`);
}

library.on('changed', () => {
  const s = library.get(item.id);
  if (!s) return;
  const ep = s.files.length > 1 ? `ep ${s.episode + 1}/${s.files.length} | ` : '';
  process.stdout.write(
    `\r${ep}${(s.progress * 100).toFixed(1)}% | ${mb(s.downloaded)}/${mb(s.length)} MB` +
    ` | ↓ ${mb(s.downloadSpeed)} MB/s | peers ${s.peers}   `,
  );
});

let player = null;
let exiting = false;
async function shutdown() {
  if (exiting) return;
  exiting = true;
  console.log('\nStopping… (it stays in the library)');
  await player?.quit();
  await library.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);

async function playEpisode(k) {
  const source = await library.stream(item.id, k);
  const s = library.get(item.id);
  const name = s.files[s.episode].name;
  console.log(`\n▶ ${s.files.length > 1 ? `${s.episode + 1}/${s.files.length} ` : ''}${name}\n  ${source}`);
  await player?.load(source, { title: s.files.length > 1 ? `${s.title} · ${name}` : s.title });
}

if (!serveOnly) {
  player = new MpvPlayer({ extraArgs: onPi ? PI_ARGS : [] });
  player.on('exit', shutdown);
  player.on('end-file', (e) => {
    if (e.reason !== 'eof') return;
    const s = library.get(item.id);
    if (s.episode + 1 < s.files.length) playEpisode(s.episode + 1).catch((err) => console.error('\nError:', err.message));
    else shutdown();
  });
  await player.start();
  await playEpisode(episode);
  console.log('Playing in mpv. Close the mpv window or press Ctrl+C to stop.');
} else {
  await playEpisode(episode);
  console.log('Serve-only mode. Press Ctrl+C to stop.');
}
