<script>
  // The shelf: everything that was watched or downloaded, as VHS tapes, plus free disk space
  import { onMount } from 'svelte';
  import Tape from './Tape.svelte';
  import MagnetForm from './MagnetForm.svelte';
  import { live } from '../lib/live.svelte.js';
  import { api } from '../lib/api.js';
  import { size } from '../lib/format.js';

  // openId: a series just put on the shelf from the remote — open its episode choice
  let { onPlay = () => {}, openId = null } = $props();
  let justAdded = $state(null);

  let storage = $state(null);
  const SEGMENTS = 20;
  const usedFraction = $derived(storage ? 1 - storage.free / storage.total : 0);
  const lit = $derived(Math.round(usedFraction * SEGMENTS));

  async function refreshStorage() {
    try {
      storage = await api.storage();
    } catch {
      // Keep the last value; the connection indicator already shows problems
    }
  }

  onMount(() => {
    refreshStorage();
    const timer = setInterval(refreshStorage, 15000);
    return () => clearInterval(timer);
  });

  // Tapes appearing or disappearing change the free space right away
  $effect(() => {
    live.downloads.length;
    refreshStorage();
  });
</script>

<section class="tv" aria-label="Нова касета">
  <div class="crt">
    <p class="vcr-title">▶ НОВА КАСЕТА<span class="cursor">_</span></p>
    <MagnetForm {onPlay} onDownload={(item) => (justAdded = item.id)} />
  </div>
  <div class="tv-chin tiny" aria-hidden="true"><span>ПотужнFLIX</span><span class="tv-led"></span></div>
</section>

<section aria-label="Полиця">
  <div class="heading">
    <h2>Полиця</h2>
    {#if storage}
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(usedFraction * 100)}
        aria-label="Зайнято місця на диску">
        {#each { length: SEGMENTS } as _, i}
          <i class:on={i < lit} class:warn={i >= SEGMENTS * 0.7} class:full={i >= SEGMENTS * 0.9}></i>
        {/each}
      </div>
    {/if}
  </div>
  {#if storage}
    <p class="free tiny muted">Вільно {size(storage.free)} з {size(storage.total)}</p>
  {/if}

  {#if live.downloads.length}
    <div class="tapes">
      {#each live.downloads as item (item.id)}
        <Tape {item} {onPlay} open={item.id === (justAdded ?? openId)} />
      {/each}
    </div>
  {:else}
    <div class="empty">
      <img src="/logo.jpg" alt="ПотужнFLIX" width="720" height="374" />
      <p>Полиця порожня. Вставте magnet-посилання або .torrent вище — касета з'явиться тут.</p>
    </div>
  {/if}
</section>

<style>
  section { display: grid; gap: 12px; }
  .tv { margin: 0 0 22px; }

  .heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h2 {
    margin: 0;
    font-family: var(--f-head);
    font-weight: 400;
    font-size: 24px;
    font-style: italic;
    background: linear-gradient(180deg, #fff 0%, #dfe4f5 45%, #8d93b0 55%, #e6eaf8 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 2px 0 #1a1030);
  }
  .free { margin: -6px 0 4px; font-size: 8px; }

  /* VFD disk meter: cyan, then sunset orange, then FLIX red when the disk fills up */
  .meter { display: flex; gap: 2px; padding: 4px; background: var(--vfd-bg); border-radius: 3px; border: 1px solid #000; box-shadow: 0 1px 0 rgb(255 255 255 / 0.08); }
  .meter i { width: 5px; height: 14px; background: var(--vfd-off); }
  .meter i.warn { background: #2a1a0b; }
  .meter i.full { background: #2d0c0a; }
  .meter i.on { background: var(--vfd); box-shadow: 0 0 5px var(--vfd); }
  .meter i.on.warn { background: var(--orange); box-shadow: 0 0 5px var(--orange); }
  .meter i.on.full { background: var(--flix); box-shadow: 0 0 5px var(--flix); }

  .tapes { display: grid; gap: 18px; }

  .empty { text-align: center; color: var(--muted); padding: 8px 0 24px; }
  .empty img { width: min(280px, 80%); height: auto; opacity: 0.9; }
  .empty p { margin: 8px auto 0; max-width: 32ch; }
</style>
