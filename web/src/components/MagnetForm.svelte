<script>
  // A new "tape": paste a magnet link or pick a .torrent file → watch now or put it on the shelf
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { toast } from '../lib/toast.svelte.js';
  import { prettyName, size } from '../lib/format.js';

  let { onPlay = () => {}, onDownload = () => {} } = $props();

  const MAX_TORRENT_BYTES = 10 * 1024 * 1024;   // same limit as the server

  let magnet = $state('');
  let file = $state(null);   // a picked .torrent File; takes the place of the magnet link
  let busy = $state(null);   // 'play' | 'download' | null
  let error = $state('');
  let picker;

  const validMagnet = $derived(/^magnet:\?/i.test(magnet.trim()));
  const ready = $derived(!!file || validMagnet);

  function pick(e) {
    const chosen = e.currentTarget.files?.[0];
    e.currentTarget.value = '';   // picking the same file again still fires
    if (!chosen) return;
    error = '';
    if (!/\.torrent$/i.test(chosen.name) && chosen.type !== 'application/x-bittorrent') {
      error = 'Це не .torrent файл.';
      return;
    }
    if (chosen.size > MAX_TORRENT_BYTES) {
      error = 'Файл завеликий для .torrent (більше 10 МБ).';
      return;
    }
    file = chosen;
    magnet = '';
  }

  async function submit(mode) {
    if (!ready || busy) return;
    busy = mode;
    error = '';
    try {
      if (mode === 'play') {
        await (file ? api.playTorrent(file) : api.play({ magnet: magnet.trim() }));
        onPlay();
      } else {
        const item = await (file ? api.downloadTorrent(file) : api.download(magnet.trim()));
        toast(item.files.length > 1 ? `На полиці: ${prettyName(item.title)} — оберіть серії` : `На полиці: ${prettyName(item.title)}`);
        onDownload(item);
      }
      magnet = '';
      file = null;
    } catch (err) {
      error = humanize(err.message);
    } finally {
      busy = null;
    }
  }

  function humanize(message) {
    if (/no peers/i.test(message)) return 'Ніхто не роздає цей торрент. Спробуйте інше посилання.';
    if (/not a valid \.torrent/i.test(message)) return 'Файл пошкоджений або це не торрент.';
    if (/not a valid magnet|must match pattern/i.test(message)) return 'Це не схоже на magnet-посилання.';
    if (/no video/i.test(message)) return 'У цьому торренті немає відео.';
    if (/disk space/i.test(message)) return 'Не вистачає місця на диску.';
    if (/disk is not connected|disk was disconnected/i.test(message)) return 'Диск з фільмами не підключено.';
    if (/too large|body is too large/i.test(message)) return 'Файл завеликий для .torrent (більше 10 МБ).';
    return message;
  }
</script>

<form class="form" onsubmit={(e) => { e.preventDefault(); submit('play'); }}>
  <label class="tiny label" for="magnet">Magnet-посилання або .torrent файл</label>

  {#if file}
    <div class="file">
      <Icon name="folder" size={18} />
      <span class="file-name">{file.name}</span>
      <span class="tiny file-size">{size(file.size)}</span>
      <button class="remove" type="button" disabled={!!busy} onclick={() => (file = null)} aria-label="Прибрати файл">✕</button>
    </div>
  {:else}
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
    <button class="chrome btn small pick" type="button" disabled={!!busy} onclick={() => picker.click()}>
      <Icon name="folder" size={16} /> Вибрати .torrent файл
    </button>
  {/if}
  <input bind:this={picker} class="sr-only" type="file" accept=".torrent,application/x-bittorrent" tabindex="-1" onchange={pick} />

  <div class="actions">
    <button class="chrome btn hot" type="submit" disabled={!ready || !!busy}>
      <Icon name="play" size={18} /> {busy === 'play' ? 'Шукаю…' : 'Дивитися'}
    </button>
    <button class="chrome btn" type="button" disabled={!ready || !!busy} onclick={() => submit('download')}>
      <Icon name="down" size={18} /> {busy === 'download' ? 'Шукаю…' : 'На полицю'}
    </button>
  </div>
  {#if busy}
    <p class="hint">
      {file ? 'Передаю торрент на приставку…' : 'Шукаю пірів і дані торрента. Це може тривати до півтори хвилини.'}
    </p>
  {:else if error}
    <p class="error" role="alert">{error}</p>
  {:else if magnet && !validMagnet}
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
    color: var(--vfd);
    background: var(--vfd-bg);
    border: 2px solid;
    border-color: #000 #5b6371 #5b6371 #000;
    border-radius: 4px;
    box-shadow: inset 0 0 10px rgb(0 0 0 / 0.8);
    caret-color: var(--vfd);
  }
  .field::placeholder { color: #3d6b2c; }
  .pick { justify-self: start; }

  /* The picked file, shown in place of the magnet field */
  .file {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto 44px;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 0 0 12px;
    font-family: var(--f-pixel);
    font-size: 11px;
    color: var(--vfd);
    background: var(--vfd-bg);
    border: 2px solid;
    border-color: #000 #5b6371 #5b6371 #000;
    border-radius: 4px;
  }
  .file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-size { color: var(--vfd-mid); }
  .remove {
    align-self: stretch;
    font-size: 18px;
    color: var(--vfd);
    background: none;
    border: 0;
    border-left: 1px solid #1d2a1a;
  }

  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .hint, .error { margin: 0; font-size: 14px; }
  .hint { color: #c9d6ff; }
  .error { color: #ffd0cc; background: rgb(232 33 29 / 0.25); padding: 8px 10px; border-radius: 4px; }
  code { font-family: var(--f-tiny); font-size: 10px; }
</style>
