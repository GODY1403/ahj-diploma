import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../app.js';
import { createStore, MAX_FILE_SIZE } from '../store.js';
import { botReply } from '../commands.js';

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

test('История выдаёт 10 + 10 + 10 + 8 сообщений без повторов и в исходном порядке', async (t) => {
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
  assert.deepEqual(sizes, [10, 10, 10, 8]);
  assert.equal(new Set(ids).size, 38);
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
    assert.ok(download.headers.get('content-type').startsWith(type));
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

test('Поиск на сервере находит раннее сообщение вне первой страницы, учитывает регистр и пустой запрос', async (t) => {
  const { request } = await startServer(t);
  const first = await (await request('api/messages')).json();
  assert.ok(first.messages.every((message) => !message.text.includes('Архивный маяк')));
  const results = await (await request(`api/search?q=${encodeURIComponent('АРХИВНЫЙ МАЯК')}`)).json();
  assert.equal(results.messages.length, 1);
  assert.match(results.messages[0].text, /Архивный маяк/);
  assert.deepEqual(await (await request('api/search?q=no-match-12345')).json(), { messages: [] });
  assert.equal((await request('api/search?q=%20')).status, 400);
});

test('Закрепление хранится на сервере, заменяет прежнюю запись и удаляется', async (t) => {
  const { request, store } = await startServer(t);
  const [first, second] = store.messages;
  const pin = (id) => request('api/pin', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  assert.deepEqual(await (await request('api/pin')).json(), { message: null });
  assert.equal((await pin(first.id)).status, 200);
  assert.equal((await (await request('api/pin')).json()).message.id, first.id);
  await pin(second.id);
  assert.equal((await (await request('api/pin')).json()).message.id, second.id);
  assert.equal((await pin('missing')).status, 404);
  assert.equal((await (await request('api/pin')).json()).message.id, second.id);
  await request('api/pin', { method: 'DELETE' });
  assert.deepEqual(await (await request('api/pin')).json(), { message: null });
});

test('Избранное добавляется и удаляется независимо от загруженных страниц', async (t) => {
  const { request, store } = await startServer(t);
  const id = store.messages[0].id;
  const favorite = (value) => request(`api/messages/${id}/favorite`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isFavorite: value }) });
  await favorite(true);
  const list = await (await request('api/favorites')).json();
  assert.equal(list.messages.length, 1);
  assert.equal(list.messages[0].id, id);
  assert.equal(list.messages[0].isFavorite, true);
  assert.equal((await favorite('true')).status, 400);
  await favorite(false);
  assert.deepEqual(await (await request('api/favorites')).json(), { messages: [] });
  assert.equal((await request('api/messages/missing/favorite', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isFavorite: true }) })).status, 404);
});

test('Все категории вложений находятся на сервере, даже если их нет в последних десяти сообщениях', async (t) => {
  const { request, store } = await startServer(t);
  for (let index = 0; index < 12; index += 1) store.addMessage(`Более поздняя заметка ${index}`);
  const first = await (await request('api/messages')).json();
  assert.ok(first.messages.every((message) => !message.attachment));
  for (const category of ['images', 'audio', 'video', 'other']) {
    const result = await (await request(`api/attachments?category=${category}`)).json();
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].attachment.category, category);
  }
  assert.equal((await (await request('api/attachments')).json()).messages.length, 4);
  assert.equal((await request('api/attachments?category=missing')).status, 400);
});

test('Пять команд создают сохранённые ответы бота; неизвестная команда показывает помощь', async (t) => {
  const { request } = await startServer(t, { seed: false });
  for (const command of ['help', 'time', 'date', 'weather', 'joke', 'unknown']) {
    const response = await request('api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `@chaos: ${command}` }) });
    assert.equal(response.status, 201);
    const { messages } = await response.json();
    assert.equal(messages.length, 2);
    assert.equal(messages[0].author, 'user');
    assert.equal(messages[1].author, 'bot');
    assert.ok(messages[1].text.length > 10);
    const page = await (await request('api/messages')).json();
    assert.equal(page.messages.at(-1).id, messages[1].id);
  }
});

test('Время и дата команд соответствуют Москве, обычный текст не запускает бота', () => {
  const now = new Date('2026-11-02T22:15:30.000Z');
  assert.equal(botReply('@chaos: time', now), 'Московское время: 01:15:30');
  assert.equal(botReply('@chaos: date', now), 'Сегодня: 03.11.2026 (Москва).');
  assert.match(botReply('@chaos: help', now), /@chaos: weather/);
  assert.match(botReply('@chaos: weather', now), /^Демонстрационный прогноз:/);
  assert.equal(botReply('Обычное сообщение', now), null);
});
