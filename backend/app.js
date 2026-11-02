import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createStore, fileCategory, MAX_FILE_SIZE, MAX_STORAGE_SIZE } from './store.js';

const inlineTypes = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg', 'audio/webm',
  'video/mp4', 'video/webm', 'video/ogg',
]);

export function createApp({ store = createStore() } = {}) {
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
    res.status(201).json({ messages: [store.addMessage(text)] });
  });
  app.post('/api/files', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Выберите файл.' });
    const used = [...store.files.values()].reduce((sum, file) => sum + file.buffer.length, 0);
    if (used + req.file.size > MAX_STORAGE_SIZE) return res.status(413).json({ error: 'Память для файлов заполнена (50 МБ). Сервер нужно перезапустить.' });
    const decodedName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const originalName = decodedName.includes('\uFFFD') ? req.file.originalname : decodedName;
    const name = originalName.replaceAll('\\', '/').split('/').pop();
    const type = req.file.mimetype || 'application/octet-stream';
    const attachment = { id: randomUUID(), name, type, size: req.file.size, category: fileCategory(type) };
    store.files.set(attachment.id, { ...attachment, buffer: req.file.buffer });
    res.status(201).json({ messages: [store.addMessage('', { attachment })] });
  });

  function sendFile(req, res) {
    const file = store.files.get(req.params.id);
    if (!file) return res.status(404).json({ error: 'Файл не найден. После перезапуска сервера загрузки теряются.' });
    res.attachment(file.name);
    const inline = !req.path.endsWith('/download') && inlineTypes.has(file.type);
    if (inline) res.set('Content-Disposition', res.get('Content-Disposition').replace('attachment', 'inline'));
    res.type(inline ? file.type : 'application/octet-stream');
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
