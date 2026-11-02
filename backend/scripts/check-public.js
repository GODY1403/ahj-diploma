import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = process.env.API_URL;
if (!base || new URL(base).protocol !== 'https:') throw new Error('Укажите HTTPS-адрес сервера в API_URL.');
const url = (path) => new URL(path, base.endsWith('/') ? base : `${base}/`);
const request = (path, options = {}) => fetch(url(path), { ...options, signal: AbortSignal.timeout(90000) });
async function json(path, method = 'GET', body, expected = 200) {
  const response = await request(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  assert.equal(response.status, expected, `${method} ${path}`);
  return response.json();
}

assert.equal((await json('api/health')).status, 'ok');
console.log('OK: HTTPS /api/health');
const first = await json('api/messages');
assert.equal(first.messages.length, 10);
const ids = [];
const sizes = [];
let page = first;
do {
  sizes.push(page.messages.length);
  assert.ok(page.messages.length <= 10);
  assert.equal(page.hasMore, Boolean(page.nextCursor));
  ids.unshift(...page.messages.map((message) => message.id));
  if (!page.hasMore) break;
  page = await json(`api/messages?before=${encodeURIComponent(page.nextCursor)}`);
} while (true);
assert.ok(ids.length >= 38);
assert.equal(new Set(ids).size, ids.length);
assert.equal((await request('api/messages?before=missing')).status, 400);
console.log(`OK: серверная пагинация ${sizes.join(' + ')}, без повторов`);

const found = await json(`api/search?q=${encodeURIComponent('АРХИВНЫЙ МАЯК')}`);
assert.ok(found.messages.length > 0);
assert.ok(!first.messages.some((message) => message.id === found.messages[0].id));
assert.equal((await json('api/search?q=no-match-public-987654')).messages.length, 0);
assert.equal((await request('api/search?q=%20')).status, 400);
console.log('OK: поиск вне первой страницы, пустой запрос и отсутствие результатов');

const marker = `Публичная проверка ${new Date().toISOString()}`;
const text = `${marker}\nhttp://example.com/ и https://netology.ru/ <script>это текст</script>`;
const sent = (await json('api/messages', 'POST', { text }, 201)).messages[0];
assert.equal(sent.text, text);
assert.ok(sent.id && !Number.isNaN(Date.parse(sent.createdAt)));
assert.ok((await json('api/messages')).messages.some((message) => message.id === sent.id));
const older = await json(`api/messages?before=${first.nextCursor}`);
assert.ok(older.messages.every((message) => !first.messages.some((item) => item.id === message.id)));
console.log('OK: сохранение текста, ссылок и переносов; устойчивость курсора');

for (const [name, type] of [['demo-image.png', 'image/png'], ['demo-audio.wav', 'audio/wav'], ['demo-video.webm', 'video/webm'], ['demo-note.txt', 'text/plain']]) {
  const bytes = await readFile(new URL(`../demo/${name}`, import.meta.url));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), `Проверка-${name}`);
  const response = await request('api/files', { method: 'POST', body: form });
  assert.equal(response.status, 201);
  const { messages: [message] } = await response.json();
  assert.equal(message.attachment.name, `Проверка-${name}`);
  assert.equal(message.attachment.size, bytes.length);
  const download = await request(`api/files/${message.attachment.id}/download`);
  assert.equal(download.status, 200);
  assert.ok(download.headers.get('content-type').startsWith(type));
  assert.match(download.headers.get('content-disposition'), /attachment;.*filename\*/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const range = await request(`api/files/${message.attachment.id}`, { headers: { Range: 'bytes=0-9' } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 10));
}
console.log('OK: PNG, WAV, WebM, текст — загрузка, имя, MIME, скачанные байты и Range');
const oversized = new FormData();
oversized.append('file', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]), 'large.bin');
assert.equal((await request('api/files', { method: 'POST', body: oversized })).status, 413);
assert.equal((await request('api/files/missing')).status, 404);
const cors = await request('api/files', { method: 'OPTIONS', headers: { Origin: 'https://gody1403.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
assert.equal(cors.status, 204);
assert.equal(cors.headers.get('access-control-allow-origin'), '*');
console.log('OK: лимит 5 МБ, ошибка 404 и CORS для GitHub Pages');

const previousPin = (await json('api/pin')).message;
try {
  await json('api/pin', 'PUT', { id: sent.id });
  assert.equal((await json('api/pin')).message.id, sent.id);
  await json('api/pin', 'PUT', { id: first.messages[0].id });
  assert.equal((await json('api/pin')).message.id, first.messages[0].id);
  await json('api/pin', 'DELETE');
  assert.equal((await json('api/pin')).message, null);
} finally {
  if (previousPin) await json('api/pin', 'PUT', { id: previousPin.id });
}
await json(`api/messages/${sent.id}/favorite`, 'PATCH', { isFavorite: true });
assert.ok((await json('api/favorites')).messages.some((message) => message.id === sent.id));
await json(`api/messages/${sent.id}/favorite`, 'PATCH', { isFavorite: false });
assert.ok(!(await json('api/favorites')).messages.some((message) => message.id === sent.id));
for (const category of ['images', 'video', 'audio', 'other']) {
  const result = await json(`api/attachments?category=${category}`);
  assert.ok(result.messages.length > 0);
  assert.ok(result.messages.every((message) => message.attachment.category === category));
}
console.log('OK: закрепление, замена, открепление, избранное и четыре категории');
for (const command of ['help', 'time', 'date', 'weather', 'joke']) {
  const { messages } = await json('api/messages', 'POST', { text: `@chaos: ${command}` }, 201);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].author, 'bot');
  assert.ok(messages[1].text.length > 10);
  assert.ok((await json('api/messages')).messages.some((message) => message.id === messages[1].id));
}
console.log('OK: все пять команд бота и сохранение ответов');

const socket = new WebSocket(url('ws').href.replace('https:', 'wss:'));
function event(type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(new Error(`Не получено WSS-событие ${type}`)); }, 15000);
    const listener = ({ data }) => {
      const change = JSON.parse(data);
      if (change.type !== type) return;
      clearTimeout(timer);
      socket.removeEventListener('message', listener);
      resolve(change);
    };
    socket.addEventListener('message', listener);
  });
}
try {
  await event('ready');
  const received = event('messages');
  const sentThroughHttp = await json('api/messages', 'POST', { text: `${marker}: WSS` }, 201);
  assert.deepEqual((await received).messages, sentThroughHttp.messages);
  console.log('OK: WSS получает тот же объект сообщения, что HTTPS');
} finally {
  socket.close();
}
