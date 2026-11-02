import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createOrganizerServer } from '../sync.js';
import { createStore } from '../store.js';

function waitFor(socket, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', listener);
      reject(new Error(`Не получено событие ${type}`));
    }, 3000);
    const listener = (raw) => {
      const data = JSON.parse(raw);
      if (data.type !== type) return;
      clearTimeout(timer);
      socket.off('message', listener);
      resolve(data);
    };
    socket.on('message', listener);
  });
}

test('Две WebSocket-сессии получают сообщения, избранное и закрепление с теми же id, что HTTP', { timeout: 10000 }, async () => {
  const server = createOrganizerServer({ store: createStore({ seed: false }) }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = new WebSocket(base.replace('http:', 'ws:') + '/ws');
  const second = new WebSocket(base.replace('http:', 'ws:') + '/ws');
  try {
    const [ready] = await Promise.all([waitFor(first, 'ready'), waitFor(second, 'ready')]);
    assert.equal(ready.latestId, null);
    const received = Promise.all([waitFor(first, 'messages'), waitFor(second, 'messages')]);
    const response = await fetch(base + '/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '@chaos: help' }) });
    const sent = await response.json();
    for (const change of await received) assert.deepEqual(change.messages, sent.messages);
    assert.equal(sent.messages.length, 2);
    const id = sent.messages[0].id;
    const starred = Promise.all([waitFor(first, 'favorite'), waitFor(second, 'favorite')]);
    await fetch(`${base}/api/messages/${id}/favorite`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isFavorite: true }) });
    for (const change of await starred) { assert.equal(change.message.id, id); assert.equal(change.message.isFavorite, true); }
    const pinned = Promise.all([waitFor(first, 'pin'), waitFor(second, 'pin')]);
    await fetch(base + '/api/pin', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    for (const change of await pinned) assert.equal(change.message.id, id);
    const unpinned = Promise.all([waitFor(first, 'pin'), waitFor(second, 'pin')]);
    await fetch(base + '/api/pin', { method: 'DELETE' });
    for (const change of await unpinned) assert.equal(change.message, null);
  } finally {
    first.terminate();
    second.terminate();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
