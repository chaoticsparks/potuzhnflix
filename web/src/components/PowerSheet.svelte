<script>
  // Turn the box off (or restart it) properly, so the power can be pulled without damaging the disk
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { toast } from '../lib/toast.svelte.js';

  let { onClose, onDone } = $props();   // onDone('poweroff' | 'reboot')

  let dialog;
  let busy = $state(false);

  onMount(() => dialog.showModal());

  async function power(action) {
    busy = true;
    try {
      await api.power(action);
      onDone(action);
      dialog.close();
    } catch (err) {
      toast(err.message, 'error');
      busy = false;
    }
  }
</script>

<dialog bind:this={dialog} class="panel sheet" onclose={onClose} onclick={(e) => e.target === dialog && !busy && dialog.close()}>
  <div class="titlebar">Живлення</div>
  <p>Вимкніть приставку перед тим, як від'єднати її від розетки: так фільми й диск не пошкодяться.</p>
  <div class="actions">
    <button class="chrome btn danger" disabled={busy} onclick={() => power('poweroff')}>
      <Icon name="power" size={18} /> Вимкнути приставку
    </button>
    <button class="chrome btn" disabled={busy} onclick={() => power('reboot')}>Перезавантажити</button>
    <button class="chrome btn" disabled={busy} onclick={() => dialog.close()}>Скасувати</button>
  </div>
</dialog>

<style>
  .sheet {
    width: min(420px, calc(100vw - 2 * var(--gutter)));
    padding: 4px 12px 14px;
    color: var(--text);
  }
  .sheet::backdrop { background: rgb(0 0 0 / 0.65); }
  p { margin: 6px 2px 14px; line-height: 1.4; }
  .actions { display: grid; gap: 10px; }
</style>
