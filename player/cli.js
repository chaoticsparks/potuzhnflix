// cli.js — manual player testing from the terminal
import readline from 'node:readline';
import { MpvPlayer, PI_ARGS } from './player.js';

const onPi = process.argv.includes('--pi');
const player = new MpvPlayer({ extraArgs: onPi ? PI_ARGS : [] });

const fmt = (s) => {
  if (!Number.isFinite(s)) return '--:--';
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
};

const status = () => {
  const s = player.state;
  if (s.idle) return 'Nothing is playing';
  return `${s.paused ? '⏸' : '▶'} ${fmt(s.position)} / ${fmt(s.duration)}` +
    ` | volume ${Math.round(s.volume)}` +
    (s.buffering ? ' | buffering…' : '') +
    ` | ${s.title ?? ''}`;
};

const HELP = `
Commands:
  load <url or path>   open a video
  p                    pause / resume
  > / <                seek ±10 s
  >> / <<              seek ±60 s
  seek <sec>           seek to a position
  + / -                volume ±5
  vol <0-100>          set the volume
  tracks               audio tracks and subtitles
  audio <id>           pick an audio track
  sub <id|off>         pick a subtitle track
  s                    status
  stop                 stop
  help                 this message
  q                    quit
`;

player.on('file-loaded', () => console.log('\n✓ File loaded'));
player.on('end-file', (e) => console.log(`\n■ Playback ended (${e.reason})`));
player.on('exit', () => { console.log('mpv closed'); process.exit(0); });

try {
  await player.start();
} catch (err) {
  console.error(err.message);
  console.error('Make sure mpv is installed and available on the terminal as "mpv".');
  process.exit(1);
}
console.log('mpv started.' + HELP);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'tvbox> ' });
rl.prompt();

rl.on('line', async (line) => {
  const [cmd = '', ...rest] = line.trim().split(/\s+/);
  const arg = rest.join(' ');
  try {
    switch (cmd) {
      case 'load': await player.load(arg); break;
      case 'p': await player.togglePause(); break;
      case '>': await player.seekBy(10); break;
      case '<': await player.seekBy(-10); break;
      case '>>': await player.seekBy(60); break;
      case '<<': await player.seekBy(-60); break;
      case 'seek': await player.seekTo(Number(arg)); break;
      case '+': await player.changeVolume(5); break;
      case '-': await player.changeVolume(-5); break;
      case 'vol': await player.setVolume(Number(arg)); break;
      case 'tracks': {
        const t = await player.tracks();
        console.log('Audio:'); console.table(t.audio);
        console.log('Subtitles:'); console.table(t.subtitles);
        break;
      }
      case 'audio': await player.setAudioTrack(Number(arg)); break;
      case 'sub': await player.setSubtitleTrack(arg === 'off' ? null : Number(arg)); break;
      case 's': console.log(status()); break;
      case 'stop': await player.stop(); break;
      case 'help': console.log(HELP); break;
      case 'q': await player.quit(); return;
      case '': break;
      default: console.log('Unknown command, type help');
    }
  } catch (err) {
    console.log('Error:', err.message);
  }
  rl.prompt();
});
