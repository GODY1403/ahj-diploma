import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createStore, MAX_FILE_SIZE, MAX_STORAGE_SIZE } from './store.js';
import { botReply } from './commands.js';

const inlineTypes = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg', 'audio/webm',
  'video/mp4', 'video/webm', 'video/ogg',
]);

export function createApp({ store = createStore(), notify = () => {} } = {}) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 0 } });
  app.use(cors({ exposedHeaders: ['Content-Disposition', 'Content-Length'] }));
  app.use(express.json({ limit: '128kb' }));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/messages', (req, res) => {
    const page = store.history(req.query.before);
    if (!page) return res.status(400).json({ error: 'Неизвестный курсор истории. Обновите страницу.' });
    res.json(page);
  });
  app.post('/api/messages', (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 20000) return res.status(400).json({ error: 'Введите текст от 1 до 20 000 символов.' });
    const messages = [store.addMessage(text)];
    const reply = botReply(text);
    if (reply) messages.push(store.addMessage(reply, { author: 'bot' }));
    notify({ type: 'messages', messages });
    res.status(201).json({ messages });
  });

  app.get('/api/search', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query || query.length > 200) return res.status(400).json({ error: 'Введите поисковый запрос от 1 до 200 символов.' });
    res.json({ messages: store.search(query) });
  });
  app.get('/api/favorites', (_req, res) => res.json({ messages: store.messages.filter((message) => message.isFavorite) }));
  app.patch('/api/messages/:id/favorite', (req, res) => {
    const message = store.messages.find((item) => item.id === req.params.id);
    if (!message) return res.status(404).json({ error: 'Сообщение не найдено.' });
    if (typeof req.body?.isFavorite !== 'boolean') return res.status(400).json({ error: 'Ожидается логическое значение isFavorite.' });
    message.isFavorite = req.body.isFavorite;
    notify({ type: 'favorite', message });
    res.json({ message });
  });
  app.get('/api/pin', (_req, res) => res.json({ message: store.getPin() }));
  app.put('/api/pin', (req, res) => {
    const message = store.messages.find((item) => item.id === req.body?.id);
    if (!message) return res.status(404).json({ error: 'Сообщение для закрепления не найдено.' });
    const pinned = store.setPin(message.id);
    notify({ type: 'pin', message: pinned });
    res.json({ message: pinned });
  });
  app.delete('/api/pin', (_req, res) => {
    store.setPin(null);
    notify({ type: 'pin', message: null });
    res.json({ message: null });
  });
  app.get('/api/attachments', (req, res) => {
    const category = req.query.category || 'all';
    if (!['all', 'images', 'video', 'audio', 'other'].includes(category)) return res.status(400).json({ error: 'Неизвестная категория файлов.' });
    res.json({ messages: store.messages.filter((message) => message.attachment && (category === 'all' || message.attachment.category === category)) });
  });
  app.post('/api/files', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Выберите файл.' });
    const used = [...store.files.values()].reduce((sum, file) => sum + file.buffer.length, 0);
    if (used + req.file.size > MAX_STORAGE_SIZE) return res.status(413).json({ error: 'Память для файлов заполнена (50 МБ). Сервер нужно перезапустить.' });
    const decodedName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const originalName = decodedName.includes('\uFFFD') ? req.file.originalname : decodedName;
    const name = originalName.replaceAll('\\', '/').split('/').pop();
    const type = req.file.mimetype || 'application/octet-stream';
    const messages = [store.addFile(name, type, req.file.buffer)];
    notify({ type: 'messages', messages });
    res.status(201).json({ messages });
  });

  function sendFile(req, res) {
    const file = store.files.get(req.params.id);
    if (!file) return res.status(404).json({ error: 'Файл не найден. После перезапуска сервера загрузки теряются.' });
    res.attachment(file.name);
    const inline = !req.path.endsWith('/download') && inlineTypes.has(file.type);
    if (inline) res.set('Content-Disposition', res.get('Content-Disposition').replace('attachment', 'inline'));
    res.type(file.type);
    res.set('Accept-Ranges', 'bytes');
    const size = file.buffer.length;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      let start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (match && !match[1] && match[2]) start = Math.max(0, size - Number(match[2]));
      if (!match || (!match[1] && !match[2]) || start > end || start >= size) {
        return res.status(416).set('Content-Range', `bytes */${size}`).end();
      }
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
      return res.send(file.buffer.subarray(start, end + 1));
    }
    res.send(file.buffer);
  }

  app.get('/api/files/:id', sendFile);
  app.get('/api/files/:id/download', sendFile);
  app.use((_req, res) => res.status(404).json({ error: 'Адрес API не найден.' }));
  app.use((error, _req, res, _next) => {
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Файл слишком большой. Лимит — 5 МБ.' });
    if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Отправляйте один файл за запрос.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON.' });
    if (error.status === 413) return res.status(413).json({ error: 'Запрос слишком большой.' });
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера. Попробуйте ещё раз.' });
  });
  return app;
}
