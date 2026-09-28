<script>
  // Audio / subtitle track picker, as a little Win98-style window over the remote
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { toast } from '../lib/toast.svelte.js';

  let { kind, onClose } = $props();   // kind: 'audio' | 'subs'

  let dialog;
  let tracks = $state(null);

  onMount(async () => {
    dialog.showModal();
    try {
      const all = await api.tracks();
      tracks = kind === 'audio' ? all.audio : all.subtitles;
    } catch (err) {
      toast(err.message, 'error');
      tracks = [];
    }
  });

  async function pick(id) {
    try {
      await api.control(kind === 'audio' ? 'audio' : 'sub', id ?? 'off');
    } catch (err) {
      toast(err.message, 'error');
    }
    onClose();
  }

  function label(t) {
    return [t.lang?.toUpperCase(), t.title, t.codec].filter(Boolean).join(' · ') || `Доріжка ${t.id}`;
  }
</script>

<dialog bind:this={dialog} class="panel sheet" onclose={onClose} onclick={(e) => e.target === dialog && dialog.close()}>
  <div class="titlebar">{kind === 'audio' ? 'Аудіо' : 'Субтитри'}</div>
  <div class="list vfd" role="listbox" aria-label={kind === 'audio' ? 'Аудіодоріжки' : 'Субтитри'}>
    {#if tracks === null}
      <p class="empty">ЧИТАЮ ДОРІЖКИ…</p>
    {:else}
      {#if kind === 'subs'}
        <button class="row" role="option" aria-selected={!tracks.some((t) => t.selected)} onclick={() => pick(null)}>
          <span class="led" class:on={!tracks.some((t) => t.selected)}></span> Вимкнено
        </button>
      {/if}
      {#each tracks as t (t.id)}
        <button class="row" role="option" aria-selected={t.selected} onclick={() => pick(t.id)}>
          <span class="led" class:on={t.selected}></span> {label(t)}
        </button>
      {:else}
        {#if kind === 'audio'}<p class="empty">НЕМАЄ ДОРІЖОК</p>{/if}
      {/each}
    {/if}
  </div>
  <button class="chrome btn close" onclick={() => dialog.close()}>Закрити</button>
</dialog>

<style>
  .sheet {
    width: min(420px, calc(100vw - 2 * var(--gutter)));
    padding: 4px 10px 12px;
    color: var(--text);
  }
  .sheet::backdrop { background: rgb(0 0 0 / 0.65); }
  .list { display: grid; max-height: 50vh; overflow-y: auto; padding: 6px; }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 8px;
    text-align: left;
    color: var(--vfd);
    background: none;
    border: 0;
    border-bottom: 1px dashed var(--vfd-off);
    position: relative;
    z-index: 1;
  }
  .row:last-child { border-bottom: 0; }
  .led {
    width: 10px; height: 10px; flex: none;
    border-radius: 50%;
    background: var(--vfd-off);
  }
  .led.on { background: var(--vfd); box-shadow: 0 0 8px var(--vfd); }
  .empty { margin: 12px 8px; }
  .close { width: 100%; margin-top: 10px; }
</style>
