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
  if (s.idle) return 'Ничего не играет';
  return `${s.paused ? '⏸' : '▶'} ${fmt(s.position)} / ${fmt(s.duration)}` +
    ` | громкость ${Math.round(s.volume)}` +
    (s.buffering ? ' | буферизация…' : '') +
    ` | ${s.title ?? ''}`;
};

const HELP = `
Команды:
  load <url или путь>  открыть видео
  p                    пауза / продолжить
  > / <                вперёд / назад на 10 с
  >> / <<              вперёд / назад на 60 с
  seek <сек>           перейти к позиции
  + / -                громкость ±5
  vol <0-100>          установить громкость
  tracks               аудиодорожки и субтитры
  audio <id>           выбрать аудиодорожку
  sub <id|off>         выбрать субтитры
  s                    статус
  stop                 остановить
  help                 эта подсказка
  q                    выход
`;

player.on('file-loaded', () => console.log('\n✓ Файл загружен'));
player.on('end-file', (e) => console.log(`\n■ Воспроизведение завершено (${e.reason})`));
player.on('exit', () => { console.log('mpv закрыт'); process.exit(0); });

try {
  await player.start();
} catch (err) {
  console.error(err.message);
  console.error('Проверьте, что mpv установлен и доступен в терминале командой "mpv".');
  process.exit(1);
}
console.log('mpv запущен.' + HELP);

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
        console.log('Аудио:'); console.table(t.audio);
        console.log('Субтитры:'); console.table(t.subtitles);
        break;
      }
      case 'audio': await player.setAudioTrack(Number(arg)); break;
      case 'sub': await player.setSubtitleTrack(arg === 'off' ? null : Number(arg)); break;
      case 's': console.log(status()); break;
      case 'stop': await player.stop(); break;
      case 'help': console.log(HELP); break;
      case 'q': await player.quit(); return;
      case '': break;
      default: console.log('Неизвестная команда, введите help');
    }
  } catch (err) {
    console.log('Ошибка:', err.message);
  }
  rl.prompt();
});
