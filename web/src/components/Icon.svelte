<script>
  // Chunky transport glyphs in the style of the logo's player buttons
  let { name, size = 22 } = $props();

  const PATHS = {
    play: 'M7 4.5v15l12-7.5z',
    pause: 'M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z',
    stop: 'M5.5 5.5h13v13h-13z',
    prev: 'M5 5h3v14H5zM20 5v14L9 12z',
    next: 'M16 5h3v14h-3zM4 5v14l11-7z',
    back: 'M12 5v14L3 12zM21 5v14l-9-7z',
    fwd: 'M3 5v14l9-7zM12 5v14l9-7z',
    volume: 'M4 9h4l5-4.5v15L8 15H4zM16 8.5q2.5 3.5 0 7M18.5 6q4.5 6 0 12',
    audio: 'M9 17.5a2.5 2.5 0 1 1-2.5-2.5H9V5l10-2v12.5a2.5 2.5 0 1 1-2.5-2.5H19',
    subs: 'M3 5h18v13H3zM6 11h5M13 11h5M6 14.5h9',
    eject: 'M12 4l8 9H4zM4 16h16v3H4z',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    down: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    list: 'M4 6h16M4 12h16M4 18h16',
    shelf: 'M3 20h18M5 20V6h3v14M10 20V4h3v16M15 20l1.5-13 3 .4-1.5 12.6',
  };
  // Outlined glyphs; the rest are filled
  const STROKE = new Set(['volume', 'audio', 'subs', 'lock', 'trash', 'down', 'list', 'shelf']);
</script>

<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
  {#if STROKE.has(name)}
    <path d={PATHS[name]} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter" />
  {:else}
    <path d={PATHS[name]} fill="currentColor" />
  {/if}
</svg>

<style>
  svg { display: block; flex: none; }
</style>
