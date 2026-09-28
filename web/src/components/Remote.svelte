<script>
  // The remote: the front panel of a Y2K VHS recorder (tape slot, cyan VFD, piano keys),
  // plus a little CRT TV with the blue "insert a tape" screen when nothing plays
  import Icon from './Icon.svelte';
  import MagnetForm from './MagnetForm.svelte';
  import TrackSheet from './TrackSheet.svelte';
  import { live } from '../lib/live.svelte.js';
  import { api } from '../lib/api.js';
  import { toast } from '../lib/toast.svelte.js';
  import { clock, speed, percent, prettyName, plural } from '../lib/format.js';

  // onDownload(item): a magnet was put on the shelf from here
  let { onDownload = () => {} } = $props();

  const s = $derived(live.status);
  const phase = $derived(s?.phase ?? 'idle');
  const p = $derived(phase === 'playing' ? s?.player : null);
  const ep = $derived(s?.episode);
  const item = $derived(s?.itemId ? live.downloads.find((d) => d.id === s.itemId) : null);
  const file = $derived(item?.files[ep?.index ?? 0] ?? null);
  const tapeIn = $derived(phase === 'playing' || phase === 'loading');

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

  // --- VFD ---
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
  const marquee = $derived(
    phase === 'loading' ? `Шукаю пірів і дані торрента…${s?.title ? ` · ${prettyName(s.title)}` : ''}`
      : phase === 'error' ? `Помилка: ${s?.error}`
      : phase === 'playing' ? `${prettyName(s?.title ?? '')}${ep ? ` · ${ep.index + 1}/${ep.count} · ${prettyName(ep.name)}` : ''}`
      : 'Вставте касету — додайте magnet-посилання або .torrent',
  );
  // Unlit segments behind the digits, like a real display
  const ghost = (text, full) => text.replace(/[^:.]/g, full);

  // Scrolling title, only when it doesn't fit
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

<section class="deck panel" aria-label="Відеомагнітофон">
  <div class="titlebar">
    <span class="brand"><span class="brand-p">Потужн</span><span class="brand-f">FLIX</span></span>
    <span>VHS · HQ · Hi-Fi Stereo</span>
    <span class="led" class:on={phase === 'playing' && !p?.paused} aria-hidden="true"></span>
  </div>

  <!-- Cassette slot: the playing tape sticks out with its handwritten label -->
  <div class="slot" class:loaded={tapeIn}>
    {#if tapeIn}
      <div class="tape-edge">
        <span class="tape-label">{prettyName(s?.title ?? '') || '…'}</span>
      </div>
    {:else}
      <span class="flap tiny">Вставте касету</span>
    {/if}
  </div>

  <div class="vfd screen">
    <div class="row top">
      <span class="seg14 word" aria-label={word}>
        <span class="off" aria-hidden="true">{ghost(word, '~')}</span>
        <span class="on">{word}</span>
      </span>
      <span class="marks tiny" aria-hidden="true">
        <span class:lit={tapeIn}>VHS</span>
        <span class:lit={tapeIn}>HQ</span>
        <span class:lit={phase === 'playing'}>Hi-Fi</span>
      </span>
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

    <div class="row bottom tiny">
      <span>{#if ep}СЕР {String(ep.index + 1).padStart(2, '0')}/{String(ep.count).padStart(2, '0')}{/if}</span>
      <span class="stats">
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

  <!-- Piano keys of the deck -->
  <div class="keys">
    <button class="chrome key" disabled={!p || !ep || ep.index === 0} onclick={() => send('prev')} aria-label="Попередня серія">
      <Icon name="prev" /><small>Попер.</small>
    </button>
    <button class="chrome key" disabled={!p} onclick={() => send('seekBy', -10)} aria-label="Назад на 10 секунд">
      <Icon name="back" /><small>−10</small>
    </button>
    <button class="chrome key big" class:hot={p && p.paused} disabled={!p} onclick={() => send('toggle')} aria-label={p?.paused ? 'Грати' : 'Пауза'}>
      <Icon name={p && !p.paused ? 'pause' : 'play'} size={26} /><small>{p && !p.paused ? 'Пауза' : 'Грати'}</small>
    </button>
    <button class="chrome key" disabled={!p} onclick={() => send('seekBy', 10)} aria-label="Вперед на 10 секунд">
      <Icon name="fwd" /><small>+10</small>
    </button>
    <button class="chrome key" disabled={!p || !ep || ep.index >= ep.count - 1} onclick={() => send('next')} aria-label="Наступна серія">
      <Icon name="next" /><small>Наст.</small>
    </button>
    <button class="chrome key eject" disabled={phase === 'idle'} onclick={stop} aria-label="Стоп — вийняти касету">
      <Icon name="eject" /><small>Стоп</small>
    </button>
  </div>

  <div class="volume">
    <span class="tiny vol-label">Vol</span>
    <label class="sr-only" for="volume">Гучність</label>
    <input id="volume" class="slider volume" type="range" min="0" max="100" step="1"
      value={volume} disabled={!p} style="--fill: {volume}%"
      oninput={onVolumeInput} onchange={onVolumeChange} />
    <span class="tiny vol-num">{Math.round(volume)}</span>
  </div>

  <div class="extras">
    <button class="chrome btn small" disabled={!p} onclick={() => (sheet = 'audio')}><Icon name="audio" size={16} /> Аудіо</button>
    <button class="chrome btn small" disabled={!p} onclick={() => (sheet = 'subs')}><Icon name="subs" size={16} /> Субтитри</button>
  </div>
</section>

{#if phase === 'idle' || phase === 'error' || phase === 'loading'}
  <!-- A small CRT TV showing the VCR's blue screen -->
  <section class="tv" aria-label={phase === 'loading' ? 'Завантаження' : 'Нова касета'} aria-live="polite">
    <div class="crt">
      {#if phase === 'loading'}
        <p class="vcr-title">▶ ЗАВАНТАЖУЮ КАСЕТУ<span class="cursor">_</span></p>
        <button class="chrome btn" onclick={stop}>Скасувати</button>
      {:else}
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
        <MagnetForm {onDownload} />
      {/if}
    </div>
    <div class="tv-chin tiny" aria-hidden="true"><span>ПотужнFLIX</span><span class="tv-led"></span></div>
  </section>
{/if}

{#if sheet}
  <TrackSheet kind={sheet} onClose={() => (sheet = null)} />
{/if}

<style>
  .deck { padding: 2px 12px 14px; display: grid; gap: 12px; }
  /* Grid items default to min-width: auto, and the long marquee line would widen everything */
  .deck > *, .screen > *, .crt > * { min-width: 0; }

  /* Printed strip: brand, format badges, PLAY LED */
  .brand { font-family: var(--f-head); font-size: 13px; font-style: italic; letter-spacing: 0; text-transform: none; }
  .brand-p { color: var(--chrome-2); }
  .brand-f { color: var(--flix); }
  .led { width: 9px; height: 9px; border-radius: 50%; background: #1f3325; box-shadow: inset 0 1px 2px #000; }
  .led.on { background: #5cff7a; box-shadow: 0 0 8px #5cff7a; }

  /* Cassette slot with its hinged flap */
  .slot {
    position: relative;
    height: 44px;
    display: grid;
    place-items: center;
    background:
      repeating-linear-gradient(180deg, rgb(255 255 255 / 0.03) 0 1px, transparent 1px 4px),
      linear-gradient(180deg, #050507, #16161f);
    border-radius: 6px;
    box-shadow: inset 0 3px 8px #000, 0 1px 0 rgb(255 255 255 / 0.08);
    overflow: hidden;
  }
  .flap { color: var(--chrome-4); letter-spacing: 0.18em; text-shadow: 0 1px 0 #000; }
  .tape-edge {
    position: absolute;
    inset: 6px 10% auto;
    height: 34px;
    display: grid;
    place-items: center;
    background: linear-gradient(180deg, #2a2a33, var(--tape));
    border-radius: 3px 3px 0 0;
    box-shadow: 0 -1px 0 rgb(255 255 255 / 0.15), 0 4px 8px #000;
    animation: insert 500ms ease-out;
  }
  .tape-label {
    max-width: 88%;
    padding: 1px 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--f-hand);
    font-weight: 700;
    font-size: 19px;
    line-height: 1.2;
    color: var(--paper-ink);
    background: linear-gradient(180deg, #fbf6e7, var(--paper));
    border-left: 6px solid var(--flix);
    border-radius: 2px;
  }
  @keyframes insert { from { transform: translateY(-40px); opacity: 0; } }

  /* ----- VFD ----- */
  .screen { padding: 10px 12px 8px; display: grid; gap: 6px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; position: relative; z-index: 1; }
  .seg14, .seg7 { position: relative; display: inline-block; }
  .seg14 .off, .seg7 .off { position: absolute; right: 0; color: var(--vfd-off); text-shadow: none; }
  .seg14 .on, .seg7 .on { position: relative; }
  .word { font-family: var(--f-seg14); font-size: 18px; }
  .marks { display: flex; gap: 8px; font-size: 8px; }
  .marks span { color: var(--vfd-off); text-shadow: none; border: 1px solid currentColor; padding: 2px 4px; border-radius: 2px; }
  .marks span.lit { color: var(--vfd); box-shadow: 0 0 6px rgb(98 246 255 / 0.4); }

  .counter { justify-self: end; padding: 0; background: none; border: 0; color: inherit; position: relative; z-index: 1; }
  .counter:disabled { cursor: default; }
  .seg7 { font-family: var(--f-seg7); font-size: clamp(34px, 12vw, 48px); letter-spacing: 0.02em; }

  .marquee { overflow: hidden; white-space: nowrap; font-size: 13px; line-height: 1.6; text-transform: uppercase; position: relative; z-index: 1; }
  .track { display: inline-flex; gap: 48px; }
  .track.run { animation: marquee var(--dur) linear infinite; }
  @keyframes marquee { to { transform: translateX(var(--shift)); } }

  .bottom { min-height: 18px; font-size: 8px; }
  .stats { text-align: right; }

  .times { display: flex; justify-content: space-between; margin-top: -8px; }

  /* ----- Piano keys ----- */
  .keys { display: grid; grid-template-columns: 1fr 1fr 1.35fr 1fr 1fr 1fr; gap: 6px; }
  .key {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 3px;
    min-height: 60px;
    padding: 6px 0 4px;
    border-radius: 4px 4px 7px 7px;
  }
  .key small { font-family: var(--f-tiny); font-size: 7px; text-transform: uppercase; color: var(--chrome-5); }
  .key.big { min-height: 64px; }
  .key.hot {
    color: #fff;
    background:
      linear-gradient(180deg, rgb(255 255 255 / 0.45) 0%, rgb(255 255 255 / 0) 50%),
      linear-gradient(90deg, var(--hot-a), var(--hot-b));
  }
  .key.hot small { color: #fff; }
  .key.eject { color: #b3160f; }

  .volume { display: flex; align-items: center; gap: 10px; }
  .vol-label, .vol-num { color: var(--chrome-3); font-size: 8px; }
  .vol-num { width: 3ch; text-align: right; }

  .extras { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

  .continue { justify-content: flex-start; text-align: left; white-space: normal; }
  .continue-text { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
</style>
