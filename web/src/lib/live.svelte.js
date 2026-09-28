// live.svelte.js — live state pushed by the backend over WebSocket, reconnecting on its own

export const live = $state({
  connected: false,
  status: null,       // see TvBox.status() on the server
  downloads: [],      // see Library.view()
});

let socket = null;
let retry = 1000;
let timer = null;

export function connect() {
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  clearTimeout(timer);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);

  socket.onopen = () => {
    live.connected = true;
    retry = 1000;
  };
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'status') {
      const { type, ...status } = msg;
      live.status = status;
    } else if (msg.type === 'downloads') {
      live.downloads = msg.items;
    }
  };
  socket.onclose = () => {
    live.connected = false;
    socket = null;
    timer = setTimeout(connect, retry);
    retry = Math.min(retry * 2, 8000);
  };
}

// Phones drop sockets of background tabs; reconnect right away when the remote is opened again.
// A socket that survived gets a "wake" instead (a new connection wakes the TV by itself):
// picking up the remote brings the TV back from its screen saver.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'wake' }));
    } else {
      retry = 1000;
      connect();
    }
  });
}
