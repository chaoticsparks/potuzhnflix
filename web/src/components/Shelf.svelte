<script>
  // The shelf: everything that was watched or downloaded, as VHS tapes, plus free disk space
  import { onMount } from 'svelte';
  import Tape from './Tape.svelte';
  import MagnetForm from './MagnetForm.svelte';
  import { live } from '../lib/live.svelte.js';
  import { api } from '../lib/api.js';
  import { size } from '../lib/format.js';

  let { onPlay = () => {} } = $props();

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

<section class="new vcr-mini" aria-label="Нова касета">
  <h2 class="tiny">Нова касета</h2>
  <MagnetForm {onPlay} />
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
        <Tape {item} {onPlay} />
      {/each}
    </div>
  {:else}
    <div class="empty">
      <img src="/logo.jpg" alt="ПотужнFLIX" width="720" height="505" />
      <p>Полиця порожня. Вставте magnet-посилання вище — касета з'явиться тут.</p>
    </div>
  {/if}
</section>

<style>
  section { display: grid; gap: 12px; }
  .vcr-mini {
    padding: 12px var(--gutter) 14px;
    background:
      repeating-linear-gradient(180deg, rgb(255 255 255 / 0.035) 0 1px, transparent 1px 3px),
      linear-gradient(180deg, #1d44d6, var(--vcr));
    border: 2px solid #0a1a66;
    border-radius: 10px;
    margin-bottom: 18px;
  }
  .vcr-mini h2 { margin: 0; color: #fff; }

  .heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h2 { margin: 0; font-family: var(--f-head); font-weight: 400; font-size: 22px; font-style: italic; }
  .free { margin: -6px 0 4px; font-size: 8px; }

  /* LED disk meter */
  .meter { display: flex; gap: 2px; padding: 4px; background: #000; border-radius: 3px; border: 1px solid #2a2e35; }
  .meter i { width: 5px; height: 14px; background: #10220c; }
  .meter i.warn { background: #2a2408; }
  .meter i.full { background: #2d0c0a; }
  .meter i.on { background: var(--lcd); box-shadow: 0 0 4px var(--lcd); }
  .meter i.on.warn { background: #ffd23a; box-shadow: 0 0 4px #ffd23a; }
  .meter i.on.full { background: var(--flix); box-shadow: 0 0 4px var(--flix); }

  .tapes { display: grid; gap: 18px; }

  .empty { text-align: center; color: var(--muted); padding: 8px 0 24px; }
  .empty img { width: min(280px, 80%); height: auto; opacity: 0.9; }
  .empty p { margin: 8px auto 0; max-width: 32ch; }
</style>
