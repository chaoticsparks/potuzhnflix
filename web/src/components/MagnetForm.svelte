<script>
  // Paste a magnet link → watch now or put it on the shelf
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { toast } from '../lib/toast.svelte.js';
  import { prettyName } from '../lib/format.js';

  let { onPlay = () => {}, onDownload = () => {} } = $props();

  let magnet = $state('');
  let busy = $state(null);   // 'play' | 'download' | null
  let error = $state('');

  let valid = $derived(/^magnet:\?/i.test(magnet.trim()));

  async function submit(mode) {
    if (!valid || busy) return;
    busy = mode;
    error = '';
    try {
      if (mode === 'play') {
        await api.play({ magnet: magnet.trim() });
        onPlay();
      } else {
        const item = await api.download(magnet.trim());
        toast(item.files.length > 1 ? `На полиці: ${prettyName(item.title)} — оберіть серії` : `На полиці: ${prettyName(item.title)}`);
        onDownload(item);
      }
      magnet = '';
    } catch (err) {
      error = humanize(err.message);
    } finally {
      busy = null;
    }
  }

  function humanize(message) {
    if (/no peers/i.test(message)) return 'Ніхто не роздає цей торрент. Спробуйте інше посилання.';
    if (/not a valid magnet|must match pattern/i.test(message)) return 'Це не схоже на magnet-посилання.';
    if (/no video/i.test(message)) return 'У цьому торренті немає відео.';
    if (/disk space/i.test(message)) return 'Не вистачає місця на диску.';
    if (/disk is not connected|disk was disconnected/i.test(message)) return 'Диск з фільмами не підключено.';
    return message;
  }
</script>

<form class="form" onsubmit={(e) => { e.preventDefault(); submit('play'); }}>
  <label class="tiny label" for="magnet">Magnet-посилання</label>
  <input
    id="magnet"
    class="field"
    type="text"
    inputmode="url"
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    placeholder="magnet:?xt=urn:btih:…"
    bind:value={magnet}
    disabled={!!busy}
  />
  <div class="actions">
    <button class="chrome btn hot" type="submit" disabled={!valid || !!busy}>
      <Icon name="play" size={18} /> {busy === 'play' ? 'Шукаю…' : 'Дивитися'}
    </button>
    <button class="chrome btn" type="button" disabled={!valid || !!busy} onclick={() => submit('download')}>
      <Icon name="down" size={18} /> {busy === 'download' ? 'Шукаю…' : 'На полицю'}
    </button>
  </div>
  {#if busy}
    <p class="hint">Шукаю пірів і дані торрента. Це може тривати до півтори хвилини.</p>
  {:else if error}
    <p class="error" role="alert">{error}</p>
  {:else if magnet && !valid}
    <p class="hint">Посилання має починатися з <code>magnet:?</code></p>
  {/if}
</form>

<style>
  .form { display: grid; gap: 10px; }
  .label { color: #c9d6ff; }
  .field {
    width: 100%;
    min-height: 48px;
    padding: 10px 12px;
    font-family: var(--f-pixel);
    font-size: 16px;   /* ≥ 16px: iOS doesn't zoom on focus */
    color: var(--lcd);
    background: var(--lcd-bg);
    border: 2px solid;
    border-color: #000 #5b6371 #5b6371 #000;
    border-radius: 4px;
    box-shadow: inset 0 0 10px rgb(0 0 0 / 0.8);
    caret-color: var(--lcd);
  }
  .field::placeholder { color: #3d6b2c; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .hint, .error { margin: 0; font-size: 14px; }
  .hint { color: #c9d6ff; }
  .error { color: #ffd0cc; background: rgb(232 33 29 / 0.25); padding: 8px 10px; border-radius: 4px; }
  code { font-family: var(--f-tiny); font-size: 10px; }
</style>
