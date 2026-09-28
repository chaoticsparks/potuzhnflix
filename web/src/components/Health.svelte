<script>
  // How the box itself is doing: temperature, power / overheating warnings, CPU, memory, network, uptime
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { live } from '../lib/live.svelte.js';
  import { plural, size } from '../lib/format.js';

  const POLL_MS = 5000;
  // Pi 4: the firmware slows the CPU down from 80 °C (soft limit), hard limit 85 °C
  const WARM = 70;
  const HOT = 80;
  const SEGMENTS = 12;
  const SCALE = [30, 85];   // °C across the meter

  let h = $state(null);

  async function refresh() {
    if (document.hidden) return;
    try {
      h = await api.health();
    } catch {
      // Keep the last reading; the connection indicator already shows problems
    }
  }

  onMount(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  });

  const t = $derived(h?.temperature ?? null);
  const heat = $derived(t === null ? null : t >= HOT ? 'hot' : t >= WARM ? 'warm' : 'ok');
  const lit = $derived(t === null ? 0 : Math.round(Math.min(1, Math.max(0, (t - SCALE[0]) / (SCALE[1] - SCALE[0]))) * SEGMENTS));

  const warnings = $derived.by(() => {
    const p = h?.power;
    if (!p) return [];
    const out = [];
    if (p.undervoltage === 'now') out.push({ level: 'hot', text: 'Слабке живлення! Потрібен блок 5 В / 3 А.' });
    else if (p.undervoltage === 'earlier') out.push({ level: 'warm', text: 'Від увімкнення було слабке живлення.' });
    if (p.throttled === 'now') out.push({ level: 'hot', text: 'Перегрів: процесор сповільнюється.' });
    else if (p.throttled === 'earlier') out.push({ level: 'warm', text: 'Від увімкнення був перегрів.' });
    return out;
  });

  function network(n) {
    if (!n?.type) return '—';
    if (n.type === 'ethernet') return 'Кабель';
    if (n.signal === null) return 'Wi-Fi';
    return `Wi-Fi · ${n.signal >= -60 ? 'добре' : n.signal >= -70 ? 'середньо' : 'слабко'}`;
  }

  function uptime(s) {
    const d = Math.floor(s / 86400);
    const hrs = Math.floor((s % 86400) / 3600);
    const min = Math.floor((s % 3600) / 60);
    if (d) return `${d} ${plural(d, 'день', 'дні', 'днів')} ${hrs} год`;
    if (hrs) return `${hrs} год ${min} хв`;
    return `${min} хв`;
  }
</script>

<section class="health panel" aria-label="Стан приставки" class:stale={!live.connected}>
  <div class="titlebar"><span>Стан приставки</span>{#if h}<span>Працює {uptime(h.uptime)}</span>{/if}</div>
  <div class="vfd screen">
    <div class="temp {heat ?? ''}">
      <span class="label">Темп</span>
      <b>{t === null ? '—' : `${t.toFixed(1)}°C`}</b>
      <span class="meter" role="meter" aria-label="Температура процесора" aria-valuemin={SCALE[0]} aria-valuemax={SCALE[1]}
        aria-valuenow={t ?? undefined}>
        {#each { length: SEGMENTS } as _, i}
          <i class:on={i < lit} class:warm={i >= SEGMENTS * ((WARM - SCALE[0]) / (SCALE[1] - SCALE[0]))}
            class:hot={i >= SEGMENTS * ((HOT - SCALE[0]) / (SCALE[1] - SCALE[0]))}></i>
        {/each}
      </span>
    </div>
    <dl>
      <div><dt>Процесор</dt><dd>{h ? `${Math.round(h.cpu * 100)}%` : '—'}</dd></div>
      <div><dt>Мережа</dt><dd>{network(h?.network)}</dd></div>
      <div><dt>Пам'ять</dt><dd>{h ? `${size(h.memory.total - h.memory.available)} з ${size(h.memory.total)}` : '—'}</dd></div>
    </dl>
    {#each warnings as w}
      <p class="warning {w.level}" role="alert">! {w.text}</p>
    {/each}
  </div>
</section>

<style>
  .health { margin-top: 22px; padding: 4px 12px 12px; display: grid; gap: 8px; }
  .health.stale .screen { opacity: 0.5; }

  .screen { padding: 12px; display: grid; gap: 12px; font-size: 9px; line-height: 1.6; }

  .temp { display: grid; grid-template-columns: auto auto 1fr; align-items: center; gap: 10px; }
  .temp b { font-weight: 400; font-size: 16px; }
  .temp.warm b { color: var(--orange); text-shadow: 0 0 8px rgb(255 138 61 / 0.6); }
  .temp.hot b { color: var(--flix); text-shadow: 0 0 8px rgb(255 42 34 / 0.6); }
  .label, dt { color: var(--vfd-mid); text-shadow: none; }

  /* Same segment meter as the shelf's disk meter: cyan, sunset orange, FLIX red */
  .meter { display: flex; gap: 2px; justify-self: end; }
  .meter i { width: 6px; height: 14px; background: var(--vfd-off); }
  .meter i.warm { background: #2a1a0b; }
  .meter i.hot { background: #2d0c0a; }
  .meter i.on { background: var(--vfd); box-shadow: 0 0 5px var(--vfd); }
  .meter i.on.warm { background: var(--orange); box-shadow: 0 0 5px var(--orange); }
  .meter i.on.hot { background: var(--flix); box-shadow: 0 0 5px var(--flix); }

  /* Readout rows: label left, value right */
  dl { margin: 0; display: grid; gap: 8px; }
  dl div { min-width: 0; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  dt, dd { margin: 0; white-space: nowrap; }
  dd { font-size: 11px; overflow: hidden; text-overflow: ellipsis; }

  .warning { margin: 0; font-size: 9px; line-height: 1.7; }
  .warning.warm { color: var(--orange); text-shadow: 0 0 8px rgb(255 138 61 / 0.5); }
  .warning.hot { color: var(--flix); text-shadow: 0 0 8px rgb(255 42 34 / 0.5); }
</style>
