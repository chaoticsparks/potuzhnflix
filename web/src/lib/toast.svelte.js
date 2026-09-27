// toast.svelte.js — short messages at the bottom of the screen

export const toasts = $state([]);
let nextId = 1;

export function toast(text, kind = 'info') {
  const id = nextId++;
  toasts.push({ id, text, kind });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, kind === 'error' ? 6000 : 3000);
}
