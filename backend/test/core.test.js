import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../app.js';
import { createStore, MAX_FILE_SIZE } from '../store.js';

export async function startServer(t, { seed = true } = {}) {
  const store = createStore({ seed });
  const server = createApp({ store }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const base = `http://127.0.0.1:${server.address().port}/`;
  return { store, request: (path, options) => fetch(new URL(path, base), options) };
}

test('История выдаёт 10 + 10 + 10 + 4 сообщения без повторов и в исходном порядке', async (t) => {
  const { request, store } = await startServer(t);
  const ids = [];
  const sizes = [];
  let cursor = '';
  do {
    const response = await request(`api/messages${cursor ? `?before=${cursor}` : ''}`);
    assert.equal(response.status, 200);
    const page = await response.json();
    sizes.push(page.messages.length);
    ids.unshift(...page.messages.map((message) => message.id));
    cursor = page.nextCursor;
    assert.equal(page.hasMore, Boolean(cursor));
  } while (cursor);
  assert.deepEqual(sizes, [10, 10, 10, 4]);
  assert.equal(new Set(ids).size, 34);
  assert.deepEqual(ids, store.messages.map((message) => message.id));
});

test('Курсор не сдвигается после добавления новых сообщений; неизвестный курсор даёт 400', async (t) => {
  const { request, store } = await startServer(t);
  const first = await (await request('api/messages')).json();
  store.addMessage('Новое сообщение между запросами');
  const older = await (await request(`api/messages?before=${first.nextCursor}`)).json();
  assert.equal(older.messages.length, 10);
  assert.ok(older.messages.every((message) => !first.messages.some((item) => item.id === message.id)));
  assert.equal((await request('api/messages?before=missing')).status, 400);
});

test('Пустая история и запрос перед первой записью завершают подгрузку', async (t) => {
  const { request, store } = await startServer(t, { seed: false });
  assert.deepEqual(await (await request('api/messages')).json(), { messages: [], hasMore: false, nextCursor: null });
  const first = store.addMessage('Первая запись');
  assert.deepEqual(await (await request(`api/messages?before=${first.id}`)).json(), { messages: [], hasMore: false, nextCursor: null });
});

test('Текст, переносы и ссылки сохраняются на сервере и доступны повторным запросом', async (t) => {
  const { request } = await startServer(t, { seed: false });
  const text = 'Первая строка\nhttp://example.com/ и https://netology.ru/ <script>не исполняется</script>';
  const response = await request('api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  assert.equal(response.status, 201);
  const { messages: [message] } = await response.json();
  assert.ok(message.id);
  assert.ok(!Number.isNaN(Date.parse(message.createdAt)));
  assert.equal(message.text, text);
  const page = await (await request('api/messages')).json();
  assert.equal(page.messages[0].text, text);
  assert.equal((await request('api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
});

test('PNG, WAV, WebM и текст загружаются, скачиваются без изменения байтов и поддерживают Range', async (t) => {
  const { request } = await startServer(t, { seed: false });
  for (const [name, type] of [['demo-image.png', 'image/png'], ['demo-audio.wav', 'audio/wav'], ['demo-video.webm', 'video/webm'], ['demo-note.txt', 'text/plain']]) {
    const bytes = await readFile(new URL(`../demo/${name}`, import.meta.url));
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), `Пример-${name}`);
    const uploaded = await request('api/files', { method: 'POST', body: form });
    assert.equal(uploaded.status, 201);
    const { messages: [message] } = await uploaded.json();
    assert.equal(message.attachment.name, `Пример-${name}`);
    assert.equal(message.attachment.type, type);
    assert.equal(message.attachment.size, bytes.length);
    const download = await request(`api/files/${message.attachment.id}/download`);
    assert.match(download.headers.get('content-disposition'), /attachment;.*filename\*/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    const range = await request(`api/files/${message.attachment.id}`, { headers: { Range: 'bytes=0-9' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), `bytes 0-9/${bytes.length}`);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 10));
  }
});

test('Файл больше 5 МБ отклоняется с 413, отсутствующий файл — с 404; CORS разрешён', async (t) => {
  const { request, store } = await startServer(t, { seed: false });
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(MAX_FILE_SIZE + 1)]), 'large.bin');
  const response = await request('api/files', { method: 'POST', body: form });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /5 МБ/);
  assert.equal(store.files.size, 0);
  assert.equal((await request('api/files/missing')).status, 404);
  const cors = await request('api/files', { method: 'OPTIONS', headers: { Origin: 'https://gody1403.github.io', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(cors.headers.get('access-control-allow-origin'), '*');
  assert.equal(cors.status, 204);
});
