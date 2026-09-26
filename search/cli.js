// cli.js — search from the terminal; optionally play a result with --play <n>
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { search } from './index.js';

const args = process.argv.slice(2);
const playIdx = args.indexOf('--play');
const playN = playIdx >= 0 ? Number(args[playIdx + 1]) : null;
const query = args.filter((a, i) => !a.startsWith('--') && !(playIdx >= 0 && i === playIdx + 1)).join(' ');

if (!query) {
  console.log('Usage: npm run search -- "<title | magnet link>" [--play <n>] [--pi]');
  process.exit(1);
}

const gb = (bytes) => (bytes ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : '');

const { results, errors } = await search(query);
for (const e of errors) console.error(`! ${e.provider}: ${e.message}`);
if (!results.length) {
  console.log('Nothing found.');
  process.exit(0);
}

results.forEach((r, i) => {
  const meta = [r.year, r.quality, gb(r.size), r.provider].filter(Boolean).join(' · ');
  console.log(`${String(i + 1).padStart(2)}. ${r.title}  (${meta})`);
});

if (playN) {
  const r = results[playN - 1];
  if (!r) {
    console.error(`No result #${playN}`);
    process.exit(1);
  }
  console.log(`\n▶ ${r.title} ${r.quality ?? ''}\n`);
  const cli = fileURLToPath(new URL('../torrent/cli.js', import.meta.url));
  const playArgs = [cli, r.torrent];
  if (r.file) playArgs.push('--file', r.file);
  if (args.includes('--pi')) playArgs.push('--pi');
  spawn(process.execPath, playArgs, { stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0));
}
