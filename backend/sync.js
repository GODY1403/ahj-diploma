import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { createStore } from './store.js';

export function createOrganizerServer(options = {}) {
  const store = options.store || createStore();
  const server = createServer();
  const sockets = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });
  const notify = (change) => {
    for (const socket of sockets.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(change));
    }
  };
  sockets.on('connection', (socket) => {
    socket.on('error', () => socket.close());
    socket.send(JSON.stringify({ type: 'ready', latestId: store.messages.at(-1)?.id || null, pin: store.getPin() }));
  });
  server.on('request', createApp({ ...options, store, notify }));
  server.on('close', () => sockets.close());
  return server;
}
