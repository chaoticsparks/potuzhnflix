<script>
  // App shell: header with the logo, the remote / shelf tabs, connection state, toasts
  import { onMount } from 'svelte';
  import Remote from './components/Remote.svelte';
  import Shelf from './components/Shelf.svelte';
  import Icon from './components/Icon.svelte';
  import PowerSheet from './components/PowerSheet.svelte';
  import { live, connect } from './lib/live.svelte.js';
  import { toasts } from './lib/toast.svelte.js';

  let tab = $state('remote');   // 'remote' | 'shelf'
  let powerSheet = $state(false);
  let off = $state(null);         // 'poweroff' | 'reboot' once the box was told to
  let added = $state(null);       // id of a download just put on the shelf from the remote tab

  // The box came back after a reboot (a fresh status without poweringOff)
  $effect(() => {
    if (off === 'reboot' && live.connected && live.status && !live.status.poweringOff) off = null;
  });

  // Film disk missing: the TV and the remote work, but nothing can play
  const storage = $derived(live.connected ? live.status?.storage : null);
  const diskMessage = $derived(
    !storage || storage.ok ? null
      : /disconnected/i.test(storage.error ?? '')
        ? 'Диск з фільмами відʼєднали. Підключіть його і перезавантажте приставку.'
        : 'Диск з фільмами не підключено або його треба перевірити. Підключіть його — приставка підхопить диск сама за пів хвилини.',
  );

  const recording = $derived(live.downloads.filter((d) => d.state === 'downloading' && !d.waiting && !d.playing).length);

  onMount(connect);

  function show(name) {
    tab = name;
    window.scrollTo({ top: 0 });
  }
</script>

<header class="top">
  <img class="mark" src="/mark.png" alt="" width="200" height="161" />
  <h1 class="wordmark"><span class="potuzhn">Потужн</span><span class="flix">FLIX</span></h1>
  <span class="link tiny" class:on={live.connected} role="status">
    <i></i>{live.connected ? 'Online' : 'Offline'}
  </span>
  {#if live.status?.power}
    <button class="chrome power" aria-label="Живлення приставки" onclick={() => (powerSheet = true)}>
      <Icon name="power" size={18} />
    </button>
  {/if}
</header>

{#if off}
  <section class="off" role="alert">
    {#if off === 'poweroff'}
      <p class="off-title">ПРИСТАВКУ ВИМКНЕНО_</p>
      <p>Зачекайте 20 секунд, поки перестане блимати зелений індикатор на приставці, — тоді можна від'єднати живлення.</p>
      <p class="muted">Щоб увімкнути знову, від'єднайте і знову під'єднайте живлення.</p>
    {:else}
      <p class="off-title">ПЕРЕЗАВАНТАЖЕННЯ...</p>
      <p>Пульт підключиться сам приблизно за хвилину.</p>
    {/if}
  </section>
{:else if !live.connected}
  <p class="offline" role="alert">Немає зв'язку з приставкою. Перевірте, що вона увімкнена і телефон у тій самій Wi‑Fi мережі.</p>
{/if}

{#if diskMessage && !off}
  <p class="offline" role="alert">{diskMessage}</p>
{/if}

<main>
  {#if tab === 'remote'}
    <Remote onDownload={(item) => { added = item.id; show('shelf'); }} />
  {:else}
    <Shelf onPlay={() => show('remote')} openId={added} />
  {/if}
</main>

<nav class="tabs panel" aria-label="Розділи">
  <button class="chrome btn" class:pressed={tab === 'remote'} aria-current={tab === 'remote' ? 'page' : undefined} onclick={() => show('remote')}>
    <Icon name="play" size={18} /> Пульт
  </button>
  <button class="chrome btn" class:pressed={tab === 'shelf'} aria-current={tab === 'shelf' ? 'page' : undefined} onclick={() => show('shelf')}>
    <Icon name="shelf" size={18} /> Полиця
    {#if recording}<span class="rec tiny" aria-label="{recording} записується">● {recording}</span>{/if}
  </button>
</nav>

{#if powerSheet}
  <PowerSheet onClose={() => (powerSheet = false)} onDone={(action) => (off = action)} />
{/if}

<div class="toasts" aria-live="polite">
  {#each toasts as t (t.id)}
    <p class="toast {t.kind}">{t.text}</p>
  {/each}
</div>

<style>
  :global(#app) {
    max-width: 480px;
    margin: 0 auto;
    padding: calc(env(safe-area-inset-top) + 8px) var(--gutter) calc(env(safe-area-inset-bottom) + 96px);
  }

  .top { display: flex; align-items: center; gap: 10px; padding: 4px 0 12px; }
  .mark { width: 52px; height: auto; flex: none; }
  .wordmark {
    margin: 0;
    flex: 1;
    font-family: var(--f-head);
    font-weight: 400;
    font-style: italic;
    font-size: 27px;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  /* Chrome lettering like the logo */
  .potuzhn {
    background: linear-gradient(180deg, #ffffff 0%, #dfe4ea 45%, #8d96a3 52%, #c9d0d8 75%, #f2f5f8 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    -webkit-text-stroke: 0.5px #2a3342;
    filter: drop-shadow(0 2px 0 #0d1320);
  }
  .flix {
    color: var(--flix);
    font-family: var(--f-head);
    filter: drop-shadow(0 2px 0 #3b0605);
  }

  .power { display: grid; place-items: center; width: 40px; height: 40px; padding: 0; flex: none; color: var(--flix); }

  .off {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    align-content: center;
    gap: 14px;
    padding: 24px;
    color: #fff;
    text-align: center;
    background:
      repeating-linear-gradient(180deg, rgb(255 255 255 / 0.035) 0 1px, transparent 1px 3px),
      linear-gradient(180deg, #1d44d6, var(--vcr) 60%, #102a96);
  }
  .off p { margin: 0 auto; max-width: 34ch; line-height: 1.45; }
  .off .muted { color: #c9d6ff; }
  .off-title { font-family: var(--f-tiny); font-size: 15px; line-height: 1.6; text-shadow: 2px 2px 0 #0a1a66; }

  .link { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 7px; }
  .link i { width: 8px; height: 8px; border-radius: 50%; background: var(--flix); box-shadow: 0 0 6px var(--flix); }
  .link.on i { background: var(--lcd); box-shadow: 0 0 6px var(--lcd); }

  .offline {
    margin: 0 0 12px;
    padding: 10px 12px;
    color: #ffe1de;
    background: rgb(232 33 29 / 0.2);
    border: 1px solid rgb(232 33 29 / 0.6);
    border-radius: 6px;
  }

  .tabs {
    position: fixed;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: min(480px, 100%);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 10px var(--gutter) calc(env(safe-area-inset-bottom) + 10px);
    border-radius: 12px 12px 0 0;
    z-index: 10;
  }
  .rec { color: var(--flix); font-size: 8px; }

  .toasts {
    position: fixed;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom) + 84px);
    transform: translateX(-50%);
    width: min(440px, calc(100% - 2 * var(--gutter)));
    display: grid;
    gap: 8px;
    z-index: 20;
    pointer-events: none;
  }
  .toast {
    margin: 0;
    padding: 10px 12px;
    font-family: var(--f-pixel);
    font-size: 15px;
    color: var(--lcd);
    background: var(--lcd-bg);
    border: 2px solid var(--lcd-mid);
    border-radius: 4px;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.6);
  }
  .toast.error { color: #ffd0cc; border-color: var(--flix); background: #1c0605; }
</style>
