<script>
  // The remote: a Winamp-style player window with an LCD, plus the "insert a tape" screen when idle
  import Icon from './Icon.svelte';
  import MagnetForm from './MagnetForm.svelte';
  import TrackSheet from './TrackSheet.svelte';
  import { live } from '../lib/live.svelte.js';
  import { api } from '../lib/api.js';
  import { toast } from '../lib/toast.svelte.js';
  import { clock, speed, percent, prettyName, plural } from '../lib/format.js';

  const s = $derived(live.status);
  const phase = $derived(s?.phase ?? 'idle');
  const p = $derived(phase === 'playing' ? s?.player : null);
  const ep = $derived(s?.episode);
  const item = $derived(s?.itemId ? live.downloads.find((d) => d.id === s.itemId) : null);
  const file = $derived(item?.files[ep?.index ?? 0] ?? null);

  // --- Seek: while the finger is on the slider, show its position instead of mpv's ---
  let seeking = $state(false);
  let seekValue = $state(0);
  let seekTimer;
  const duration = $derived(p?.duration || 0);
  const position = $derived(seeking ? seekValue : (p?.position ?? 0));

  function onSeekInput(e) {
    clearTimeout(seekTimer);
    seeking = true;
    seekValue = Number(e.currentTarget.value);
  }
  async function onSeekChange(e) {
    seekValue = Number(e.currentTarget.value);
    await send('seekTo', seekValue);
    // Keep showing the target until mpv reports the new position
    seekTimer = setTimeout(() => (seeking = false), 1200);
  }

  // --- Volume: sent at most every 150 ms while dragging ---
  let volDragging = $state(false);
  let volValue = $state(100);
  let volSendTimer = null;
  let volReleaseTimer;
  const volume = $derived(volDragging ? volValue : (p?.volume ?? 100));

  function onVolumeInput(e) {
    clearTimeout(volReleaseTimer);
    volDragging = true;
    volValue = Number(e.currentTarget.value);
    volSendTimer ??= setTimeout(() => {
      volSendTimer = null;
      send('volume', volValue);
    }, 150);
  }
  function onVolumeChange(e) {
    volValue = Number(e.currentTarget.value);
    clearTimeout(volSendTimer);
    volSendTimer = null;
    send('volume', volValue);
    volReleaseTimer = setTimeout(() => (volDragging = false), 800);
  }

  async function send(action, value) {
    try {
      await api.control(action, value);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  async function stop() {
    try {
      await api.stop();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // --- LCD ---
  let showRemaining = $state(false);
  const counter = $derived(showRemaining && duration ? `-${clock(duration - position)}` : clock(position));
  const word = $derived(
    phase === 'loading' ? 'LOAD'
      : phase === 'error' ? 'ERR'
      : phase !== 'playing' ? 'STOP'
      : p?.buffering ? 'BUFF'
      : p?.paused ? 'PAUS'
      : 'PLAY',
  );
  const running = $derived(phase === 'playing' && !p?.paused && !p?.buffering);
  const marquee = $derived(
    phase === 'loading' ? `Шукаю пірів і дані торрента…${s?.title ? ` · ${prettyName(s.title)}` : ''}`
      : phase === 'error' ? `Помилка: ${s?.error}`
      : phase === 'playing' ? `${prettyName(s?.title ?? '')}${ep ? ` · ${ep.index + 1}/${ep.count} · ${prettyName(ep.name)}` : ''}`
      : 'Вставте касету — додайте magnet-посилання',
  );
  // Unlit segments behind the digits, like a real LCD
  const ghost = (text, full) => text.replace(/[^:.]/g, full);

  // Winamp-style scrolling title, only when it doesn't fit
  let boxWidth = $state(0);
  let textWidth = $state(0);
  const scroll = $derived(textWidth > boxWidth);

  // --- Tracks ---
  let sheet = $state(null);   // 'audio' | 'subs' | null

  // --- "Continue watching": the most recently played tape ---
  const recent = $derived(
    live.downloads
      .filter((d) => d.lastPlayedAt)
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)[0] ?? null,
  );
  async function resume() {
    try {
      await api.play({ id: recent.id });
    } catch (err) {
      toast(err.message, 'error');
    }
  }
</script>

<section class="player panel" aria-label="Плеєр">
  <div class="titlebar">ПотужнFLIX</div>

  <div class="lcd screen">
    <div class="row top">
      <span class="seg14 word" aria-label={word}>
        <span class="off" aria-hidden="true">{ghost(word, '~')}</span>
        <span class="on">{word}</span>
      </span>
      {#if ep}
        <span class="tiny episode">СЕР {String(ep.index + 1).padStart(2, '0')}/{String(ep.count).padStart(2, '0')}</span>
      {/if}
    </div>

    <button class="counter" onclick={() => (showRemaining = !showRemaining)} disabled={!p}
      aria-label={showRemaining ? 'Залишилось часу; натисніть, щоб показати пройдений' : 'Пройдено часу; натисніть, щоб показати залишок'}>
      <span class="seg7">
        <span class="off" aria-hidden="true">{ghost(counter, '8')}</span>
        <span class="on">{counter}</span>
      </span>
    </button>

    <div class="marquee" bind:clientWidth={boxWidth}>
      <span class="track" class:run={scroll} style="--shift: {-(textWidth + 48)}px; --dur: {(textWidth + 48) / 35}s">
        <span bind:clientWidth={textWidth}>{marquee}</span>
        {#if scroll}<span aria-hidden="true">{marquee}</span>{/if}
      </span>
    </div>

    <div class="row bottom">
      <div class="eq" class:run={running} class:idle={phase !== 'playing'} aria-hidden="true">
        {#each { length: 14 } as _, i}<i style="--d: {(i * 137) % 900}ms; --h: {30 + ((i * 53) % 70)}%"></i>{/each}
      </div>
      <span class="tiny stats">
        {#if file?.done}
          з диска
        {:else if item && phase === 'playing'}
          ↓ {speed(item.downloadSpeed)} · {item.peers} {plural(item.peers, 'пір', 'піри', 'пірів')} · {percent(file?.progress)}
        {/if}
      </span>
    </div>
  </div>

  <label class="sr-only" for="seek">Позиція</label>
  <input
    id="seek"
    class="slider"
    type="range"
    min="0"
    max={duration || 1}
    step="1"
    value={position}
    disabled={!p || !duration}
    style="--fill: {duration ? (position / duration) * 100 : 0}%; --buffer: {(file?.done ? 1 : file?.progress ?? 0) * 100}%"
    oninput={onSeekInput}
    onchange={onSeekChange}
  />
  <div class="times tiny muted">
    <span>{clock(position)}</span>
    <span>{duration ? clock(duration) : '--:--'}</span>
  </div>

  <div class="transport">
    <button class="chrome key" aria-label="Попередня серія" disabled={!p || !ep || ep.index === 0} onclick={() => send('prev')}><Icon name="prev" /></button>
    <button class="chrome key" aria-label="Назад на 10 секунд" disabled={!p} onclick={() => send('seekBy', -10)}><Icon name="back" /></button>
    <button class="chrome key big" class:hot={p && p.paused} aria-label={p?.paused ? 'Грати' : 'Пауза'} disabled={!p} onclick={() => send('toggle')}>
      <Icon name={p && !p.paused ? 'pause' : 'play'} size={28} />
    </button>
    <button class="chrome key" aria-label="Вперед на 10 секунд" disabled={!p} onclick={() => send('seekBy', 10)}><Icon name="fwd" /></button>
    <button class="chrome key" aria-label="Наступна серія" disabled={!p || !ep || ep.index >= ep.count - 1} onclick={() => send('next')}><Icon name="next" /></button>
  </div>

  <div class="volume">
    <Icon name="volume" size={20} />
    <label class="sr-only" for="volume">Гучність</label>
    <input id="volume" class="slider volume" type="range" min="0" max="100" step="1"
      value={volume} disabled={!p} style="--fill: {volume}%"
      oninput={onVolumeInput} onchange={onVolumeChange} />
    <span class="tiny vol-num">{Math.round(volume)}</span>
  </div>

  <div class="extras">
    <button class="chrome btn small" disabled={!p} onclick={() => (sheet = 'audio')}><Icon name="audio" size={16} /> Аудіо</button>
    <button class="chrome btn small" disabled={!p} onclick={() => (sheet = 'subs')}><Icon name="subs" size={16} /> Субтитри</button>
    <button class="chrome btn small danger" disabled={phase === 'idle'} onclick={stop}><Icon name="stop" size={16} /> Стоп</button>
  </div>
</section>

{#if phase === 'idle' || phase === 'error'}
  <section class="vcr" aria-label="Нова касета">
    <p class="vcr-title">▶ {phase === 'error' ? 'КАСЕТУ НЕ ПРОЧИТАНО' : 'ВСТАВТЕ КАСЕТУ'}<span class="cursor">_</span></p>
    {#if phase === 'error'}
      <p class="vcr-error">{s?.error}</p>
    {/if}
    {#if recent && phase === 'idle'}
      <button class="chrome btn continue" onclick={resume}>
        <Icon name="play" size={18} />
        <span class="continue-text">
          Продовжити «{prettyName(recent.title)}»{#if recent.files.length > 1}, серія {recent.episode + 1}{/if}
        </span>
      </button>
    {/if}
    <MagnetForm />
  </section>
{:else if phase === 'loading'}
  <section class="vcr loading" aria-live="polite">
    <div class="reels" aria-hidden="true"><span></span><span></span></div>
    <p class="vcr-title">ЗАВАНТАЖУЮ КАСЕТУ<span class="cursor">_</span></p>
    <button class="chrome btn" onclick={stop}>Скасувати</button>
  </section>
{/if}

{#if sheet}
  <TrackSheet kind={sheet} onClose={() => (sheet = null)} />
{/if}

<style>
  .player { padding: 2px 12px 14px; display: grid; gap: 10px; }
  /* Grid items default to min-width: auto, and the long marquee line would widen everything */
  .player > *, .screen > *, .vcr > * { min-width: 0; }

  /* ----- LCD ----- */
  .screen { padding: 10px 12px 8px; display: grid; gap: 6px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; position: relative; z-index: 1; }
  .seg14, .seg7 { position: relative; display: inline-block; }
  .seg14 .off, .seg7 .off { position: absolute; right: 0; color: var(--lcd-off); text-shadow: none; }
  .seg14 .on, .seg7 .on { position: relative; }
  .word { font-family: var(--f-seg14); font-size: 18px; }
  .episode { color: var(--lcd); }

  .counter {
    justify-self: end;
    padding: 0;
    background: none;
    border: 0;
    color: inherit;
    position: relative;
    z-index: 1;
  }
  .counter:disabled { cursor: default; }
  .seg7 { font-family: var(--f-seg7); font-size: clamp(34px, 12vw, 48px); letter-spacing: 0.02em; }

  .marquee { overflow: hidden; white-space: nowrap; font-size: 17px; text-transform: uppercase; position: relative; z-index: 1; }
  .track { display: inline-flex; gap: 48px; }
  .track.run { animation: marquee var(--dur) linear infinite; }
  @keyframes marquee { to { transform: translateX(var(--shift)); } }

  .bottom { min-height: 22px; }
  .stats { color: var(--lcd); text-align: right; }

  /* Equalizer bars from the logo */
  .eq { display: flex; align-items: flex-end; gap: 2px; height: 20px; }
  .eq i {
    width: 5px;
    height: var(--h);
    background: repeating-linear-gradient(0deg, var(--lcd) 0 3px, transparent 3px 4px);
    opacity: 0.9;
  }
  .eq.run i { animation: bounce 700ms ease-in-out var(--d) infinite alternate; }
  .eq.idle i { height: 15%; opacity: 0.35; }
  @keyframes bounce { from { height: 12%; } to { height: var(--h); } }

  .times { display: flex; justify-content: space-between; margin-top: -6px; }

  /* ----- Buttons ----- */
  .transport { display: grid; grid-template-columns: 1fr 1fr 1.4fr 1fr 1fr; gap: 8px; align-items: stretch; }
  .key { display: grid; place-items: center; min-height: 56px; padding: 0; }
  .key.big { min-height: 64px; }
  .key.hot { color: #2a1400; background: linear-gradient(180deg, var(--bolt-hi), var(--bolt)); }

  .volume { display: flex; align-items: center; gap: 10px; color: var(--chrome-2); }
  .vol-num { width: 3ch; text-align: right; color: var(--chrome-2); }

  .extras { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }

  /* ----- VCR blue screen ----- */
  .vcr {
    margin-top: 16px;
    padding: 16px var(--gutter) 18px;
    display: grid;
    gap: 14px;
    background:
      repeating-linear-gradient(180deg, rgb(255 255 255 / 0.035) 0 1px, transparent 1px 3px),
      linear-gradient(180deg, #1d44d6, var(--vcr) 60%, #102a96);
    border-radius: 10px;
    border: 2px solid #0a1a66;
    box-shadow: inset 0 0 40px rgb(0 0 30 / 0.6);
  }
  .vcr-title { margin: 0; font-family: var(--f-tiny); font-size: 13px; line-height: 1.6; color: #fff; text-shadow: 2px 2px 0 #0a1a66; }
  .vcr-error { margin: 0; color: #ffd0cc; }
  .cursor { animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }

  .continue { justify-content: flex-start; text-align: left; white-space: normal; }
  .continue-text { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

  .loading { justify-items: center; text-align: center; }
  .reels { display: flex; gap: 40px; }
  .reels span {
    width: 44px; height: 44px; border-radius: 50%;
    background: radial-gradient(circle, #fff 0 5px, transparent 6px), conic-gradient(#fff 0 30deg, transparent 30deg 120deg, #fff 120deg 150deg, transparent 150deg 240deg, #fff 240deg 270deg, transparent 270deg);
    border: 3px solid #fff;
    animation: spin 1.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
