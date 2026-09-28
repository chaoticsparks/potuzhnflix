<script>
  // Watch history: recently played titles, most recent first, kept even after the download itself
  // (and its resume position) is gone — a title can be added back to the shelf by its magnet.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { toast } from '../lib/toast.svelte.js';
  import { ago, clock, prettyName } from '../lib/format.js';

  let { onPlay = () => {} } = $props();

  let items = $state([]);
  let open = $state(false);
  let busyId = $state(null);

  async function refresh() {
    try {
      items = await api.history();
    } catch {
      // shown elsewhere via the connection indicator
    }
  }
  onMount(refresh);

  async function run(id, fn) {
    if (busyId) return;
    busyId = id;
    try {
      await fn();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busyId = null;
    }
  }

  const resume = (h) => run(h.id, async () => { await api.play({ id: h.id }); onPlay(); });
  const redownload = (h) => run(h.id, async () => {
    await api.download(h.magnet);
    toast(`Знову на полиці: ${prettyName(h.title)}`);
    await refresh();
  });
  const forget = (h) => run(h.id, async () => {
    await api.removeHistory(h.id);
    items = items.filter((x) => x.id !== h.id);
  });
</script>

<section class="history">
  <button class="chrome btn small toggle" aria-expanded={open} aria-controls="history-list" onclick={() => (open = !open)}>
    {open ? '▾' : '▸'} Історія переглядів {#if items.length}({items.length}){/if}
  </button>
  {#if open}
    <div id="history-list">
      {#if items.length === 0}
        <p class="empty tiny muted">Ви ще нічого не дивились.</p>
      {:else}
        <ul>
          {#each items as h (h.id)}
            <li class="row">
              <div class="text">
                <p class="title">
                  {prettyName(h.title)} {#if h.episode}· Серія {h.episode.index + 1}/{h.episode.count}{/if}
                </p>
                <p class="meta tiny muted">
                  {ago(h.watchedAt)} {#if h.duration}· {h.completed ? 'Переглянуто' : `${clock(h.position)} з ${clock(h.duration)}`}{/if}
                </p>
              </div>
              <div class="actions">
                <button class="chrome btn small" disabled={busyId === h.id}
                  onclick={() => (h.inLibrary ? resume(h) : redownload(h))}
                  aria-label={h.inLibrary ? 'Продовжити перегляд' : 'Завантажити знову'}>
                  <Icon name={h.inLibrary ? 'play' : 'down'} size={16} />
                </button>
                <button class="chrome btn small" disabled={busyId === h.id} onclick={() => forget(h)}
                  aria-label="Прибрати з історії">
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .history { margin-top: 18px; display: grid; gap: 10px; }
  .toggle { justify-content: flex-start; }
  .empty { margin: 0; }

  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: linear-gradient(180deg, #1b1b25, #0e0e14);
    border: 1px solid #2c2d3c;
    border-radius: 8px;
  }
  .text { min-width: 0; }
  .title { margin: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { margin: 3px 0 0; }
  .actions { display: flex; gap: 6px; flex: none; }
</style>
