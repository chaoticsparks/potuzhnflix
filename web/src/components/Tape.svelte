<script>
  // One download on the shelf, drawn as a VHS cassette.
  // Tape moves from the left reel to the right one as it downloads; "keep" is the record-protect tab.
  // A series lists its episodes with a "download" tick each.
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { toast } from '../lib/toast.svelte.js';
  import { size, speed, percent, until, plural, prettyName } from '../lib/format.js';

  // open: a series just added to the shelf — show its episode choice right away
  let { item, onPlay = () => {}, open = false } = $props();

  let confirming = $state(false);
  let busy = $state(false);
  let showEpisodes = $state(false);
  let card;

  const series = $derived(item.files.length > 1);

  $effect(() => {
    if (open && series) {
      showEpisodes = true;
      card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // Episode choice: kept locally while the user taps, sent once they pause for 0.4 s
  // (the item from the server arrives ~1 s later; quick taps must not overwrite each other)
  let wantedLocal = $state(null);
  let wantedTimer;
  const wanted = $derived(wantedLocal ?? item.files.map((f) => f.wanted));
  const wantedCount = $derived(wanted.filter(Boolean).length);
  const wantedSize = $derived(item.files.reduce((sum, f, i) => sum + (wanted[i] ? f.length : 0), 0));

  function setWanted(next) {
    wantedLocal = next;
    clearTimeout(wantedTimer);
    wantedTimer = setTimeout(async () => {
      try {
        await api.update(item.id, { wanted: next.flatMap((w, i) => (w ? [i] : [])) });
      } catch (err) {
        toast(err.message, 'error');
      }
      if (wantedLocal === next) wantedLocal = null;
    }, 400);
  }
  const toggleEpisode = (i) => setWanted(wanted.map((w, k) => (k === i ? !w : w)));

  // What this series will download, in words
  const plan = $derived.by(() => {
    if (!series) return null;
    const total = item.files.length;
    if (wantedCount === 0) return 'Жодна серія не вибрана для завантаження';
    if (item.state === 'complete') {
      return wantedCount === total ? 'Усі серії записано' : `Записано ${wantedCount} з ${total} серій`;
    }
    if (wantedCount === total) return `Завантажуються всі серії · ${size(wantedSize)}`;
    return `Вибрано ${wantedCount} з ${total} серій · ${size(wantedSize)}`;
  });

  const recording = $derived(item.state === 'downloading' && !item.waiting && !item.playing);
  const sticker = $derived.by(() => {
    if (item.playing) return { text: '▶ Грає', kind: 'play' };
    if (item.state === 'complete') {
      const partial = series && item.wantedCount < item.files.length;
      return { text: partial ? `✔ ${item.wantedDone}/${item.files.length}` : '✔ Записано', kind: 'done' };
    }
    if (item.state === 'paused') return { text: '‖ Пауза', kind: 'pause' };
    if (item.waiting) return { text: '… Чекає', kind: 'wait' };
    return { text: 'REC', kind: 'rec' };
  });

  // Reel radii in the tape window (SVG units)
  const R_MIN = 9;
  const R_MAX = 19;
  const left = $derived(R_MIN + (1 - item.progress) * (R_MAX - R_MIN));
  const right = $derived(R_MIN + item.progress * (R_MAX - R_MIN));

  async function run(fn, done) {
    if (busy) return;
    busy = true;
    try {
      await fn();
      done?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busy = false;
    }
  }

  const play = (episode) => run(() => api.play(episode === undefined ? { id: item.id } : { id: item.id, episode }), onPlay);
  const togglePause = () => run(() => api.update(item.id, { paused: item.state !== 'paused' }));
  const toggleKeep = () => run(() => api.update(item.id, { keep: !item.keep }));
  const remove = () => run(() => api.remove(item.id), () => toast(`Стерто: ${prettyName(item.title)}`));
</script>

<article class="tape" class:playing={item.playing} bind:this={card}>
  <button class="tab" class:kept={item.keep} aria-pressed={item.keep} disabled={busy} onclick={toggleKeep}
    title={item.keep ? 'Захищено від стирання' : 'Не стирати автоматично'}>
    <Icon name="lock" size={14} />
    <span>{item.keep ? 'Захищено' : 'Не стирати'}</span>
  </button>

  <div class="label">
    <h3>{prettyName(item.title)}</h3>
    <p class="meta tiny">
      {#if series}{item.files.length} {plural(item.files.length, 'серія', 'серії', 'серій')} · {/if}{size(item.length)}
    </p>
  </div>

  <div class="window-row">
    <svg class="window" viewBox="0 0 160 48" aria-hidden="true">
      <rect x="1" y="1" width="158" height="46" rx="6" class="glass" />
      <g class="reel" class:spin={recording || item.playing}>
        <circle cx="40" cy="24" r={left} class="spool" />
        <g class="hub" style="transform-origin: 40px 24px"><circle cx="40" cy="24" r="6" /><path d="M40 18v12M34 24h12" /></g>
      </g>
      <g class="reel" class:spin={recording || item.playing}>
        <circle cx="120" cy="24" r={right} class="spool" />
        <g class="hub" style="transform-origin: 120px 24px"><circle cx="120" cy="24" r="6" /><path d="M120 18v12M114 24h12" /></g>
      </g>
    </svg>
    <div class="state">
      <span class="sticker {sticker.kind}">{sticker.text}</span>
      <span class="tiny pct">{percent(item.progress)}</span>
      {#if recording}<span class="tiny muted">{speed(item.downloadSpeed)}</span>{/if}
    </div>
  </div>

  {#if plan}<p class="plan" class:none={wantedCount === 0}>{plan}</p>{/if}

  <p class="expiry tiny">
    {#if item.keep}Не зітреться автоматично{:else if item.expiresAt}Зітреться {until(item.expiresAt)}{/if}
  </p>

  <div class="actions">
    <button class="chrome btn small hot play" disabled={busy || item.playing} onclick={() => play()}>
      <Icon name="play" size={16} />
      {item.playing ? 'Грає' : series && item.lastPlayedAt ? `Серія ${item.episode + 1}` : 'Дивитися'}
    </button>
    {#if item.state !== 'complete'}
      <button class="chrome btn small" disabled={busy || item.playing} onclick={togglePause}
        aria-label={item.state === 'paused' ? 'Продовжити завантаження' : 'Призупинити завантаження'}>
        <Icon name={item.state === 'paused' ? 'down' : 'pause'} size={16} />
      </button>
    {/if}
    <button class="chrome btn small danger" disabled={busy} onclick={() => (confirming = true)} aria-label="Стерти касету">
      <Icon name="trash" size={16} />
    </button>
  </div>

  {#if confirming}
    <div class="confirm" role="alertdialog" aria-label="Підтвердження">
      <p>Стерти «{prettyName(item.title)}» разом з файлами?</p>
      <div class="actions">
        <button class="chrome btn small danger" disabled={busy} onclick={remove}>Так, стерти</button>
        <button class="chrome btn small" onclick={() => (confirming = false)}>Ні</button>
      </div>
    </div>
  {/if}

  {#if series}
    <button class="chrome btn small toggle" aria-expanded={showEpisodes} aria-controls="eps-{item.id}"
      onclick={() => (showEpisodes = !showEpisodes)}>
      {showEpisodes ? '▾' : '▸'} Серії: завантажувати {wantedCount} з {item.files.length}
    </button>
    {#if showEpisodes}
      <div class="episodes" id="eps-{item.id}">
        <p class="hint">Позначте серії, які завантажити на полицю. Решта не качається, але їх можна дивитися онлайн.</p>
        <div class="bulk">
          <button class="chrome btn small" disabled={wantedCount === item.files.length}
            onclick={() => setWanted(item.files.map(() => true))}>Усі</button>
          <button class="chrome btn small" disabled={wantedCount === 0}
            onclick={() => setWanted(item.files.map(() => false))}>Жодної</button>
        </div>
        <ol>
          {#each item.files as f, i}
            <li class="ep" class:current={i === item.episode && item.lastPlayedAt} class:off={!wanted[i]}>
              <button class="check" role="checkbox" aria-checked={wanted[i]} onclick={() => toggleEpisode(i)}
                aria-label="Завантажувати серію {i + 1}">
                <span class="box" aria-hidden="true">{wanted[i] ? '✔' : ''}</span>
                <span class="num tiny">{String(i + 1).padStart(2, '0')}</span>
                <span class="name">{prettyName(f.name)}</span>
                <span class="tiny ep-state">
                  {f.done ? '✔' : f.progress > 0 ? percent(f.progress) : wanted[i] ? '0%' : '—'}
                </span>
              </button>
              <button class="watch" disabled={busy} onclick={() => play(i)} aria-label="Дивитися серію {i + 1}">
                <Icon name="play" size={16} />
              </button>
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  {/if}
</article>

<style>
  .tape {
    position: relative;
    padding: 22px 12px 12px;
    display: grid;
    gap: 10px;
    color: var(--text);
    /* Black cassette plastic with moulded ridges */
    background:
      repeating-linear-gradient(90deg, rgb(255 255 255 / 0.025) 0 2px, transparent 2px 6px),
      linear-gradient(180deg, #202125, var(--tape) 30%, #0a0a0b);
    border: 1px solid #2c2d32;
    border-radius: 8px;
    box-shadow: 0 8px 20px rgb(0 0 0 / 0.55), inset 0 1px 0 rgb(255 255 255 / 0.06);
    scroll-margin-top: 12px;
  }
  .tape.playing { border-color: var(--bolt); box-shadow: 0 0 0 1px var(--bolt), 0 8px 24px rgb(255 148 22 / 0.25); }

  /* Record-protect tab */
  .tab {
    position: absolute;
    top: -1px;
    left: 14px;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    padding: 3px 8px;
    font-family: var(--f-tiny);
    font-size: 8px;
    text-transform: uppercase;
    color: var(--muted);
    background: #1b1c20;
    border: 1px solid #34363c;
    border-top: 0;
    border-radius: 0 0 5px 5px;
  }
  .tab.kept { color: #fff; background: var(--flix); border-color: #ff6a5e; }

  /* Paper label with a handwritten title */
  .label {
    padding: 8px 12px 6px;
    color: var(--paper-ink);
    background:
      repeating-linear-gradient(180deg, transparent 0 21px, rgb(31 42 107 / 0.18) 21px 22px),
      linear-gradient(180deg, #fbf6e7, var(--paper));
    border-radius: 3px;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08), 0 1px 0 rgb(255 255 255 / 0.1);
    border-left: 8px solid var(--flix);
  }
  h3 {
    margin: 0;
    font-family: var(--f-hand);
    font-weight: 700;
    font-size: 26px;
    line-height: 1.05;
    overflow-wrap: anywhere;
  }
  .meta { margin: 4px 0 0; color: #5a5f7a; font-size: 8px; }

  .window-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
  .window { width: 100%; max-width: 220px; height: auto; }
  .glass { fill: #050506; stroke: #3a3b41; stroke-width: 2; }
  .spool { fill: #3b2a1c; stroke: #20150d; stroke-width: 1; transition: r 600ms ease; }
  .hub circle { fill: #e6e2d6; }
  .hub path { stroke: #50473a; stroke-width: 2.5; }
  .reel.spin .hub { animation: spin 1.4s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .state { display: grid; justify-items: end; gap: 4px; }
  .sticker {
    font-family: var(--f-tiny);
    font-size: 9px;
    padding: 4px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .sticker.rec { color: #fff; background: #3a0b0a; }
  .sticker.rec::before { content: '● '; color: var(--flix); animation: blink 1s steps(1) infinite; }
  .sticker.done { color: #0b1c05; background: var(--lcd); }
  .sticker.play { color: #2a1400; background: var(--bolt); }
  .sticker.pause, .sticker.wait { color: var(--ink); background: var(--chrome-2); }
  @keyframes blink { 50% { opacity: 0; } }
  .pct { color: var(--text); }

  .plan { margin: 0; font-size: 14px; color: var(--text); }
  .plan.none { color: #ffd23a; }

  .expiry { margin: 0; color: var(--muted); font-size: 8px; }

  .actions { display: flex; gap: 8px; }
  .actions .play { flex: 1; }

  .confirm {
    padding: 10px;
    display: grid;
    gap: 8px;
    background: rgb(232 33 29 / 0.15);
    border: 1px dashed var(--flix);
    border-radius: 6px;
  }
  .confirm p { margin: 0; }
  .confirm .actions > * { flex: 1; }

  /* Episodes of a series */
  .toggle { justify-content: flex-start; }
  .episodes { display: grid; gap: 8px; }
  .hint { margin: 0; font-size: 13px; color: var(--muted); }
  .bulk { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .ep {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px;
    background: var(--lcd-bg);
    border: 1px solid #1d2a1a;
    border-radius: 4px;
  }
  .ep.current { border-color: var(--lcd-mid); box-shadow: inset 3px 0 0 var(--lcd); }
  .check {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 6px 8px;
    text-align: left;
    font-family: var(--f-pixel);
    color: var(--lcd);
    background: none;
    border: 0;
  }
  .box {
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    font-size: 14px;
    line-height: 1;
    color: #0b1c05;
    background: var(--lcd);
    border: 2px solid var(--lcd-mid);
    border-radius: 3px;
  }
  .ep.off .box { background: transparent; }
  .ep.off .check { color: #4c6b3f; }
  .watch {
    display: grid;
    place-items: center;
    color: var(--lcd);
    background: #0d180b;
    border: 0;
    border-left: 1px solid #1d2a1a;
    border-radius: 0 4px 4px 0;
  }
  .watch:disabled { opacity: 0.4; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .num, .ep-state { color: var(--lcd-mid); }
</style>
