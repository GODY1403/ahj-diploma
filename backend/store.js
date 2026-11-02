import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PAGE_SIZE = 10;
export const MAX_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_STORAGE_SIZE = 50 * 1024 * 1024;

export function fileCategory(type) {
  if (type.startsWith('image/')) return 'images';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'other';
}

export function createStore({ seed = true } = {}) {
  const messages = [];
  const files = new Map();
  let pinnedId = null;

  function addMessage(text, { attachment = null, author = 'user', createdAt = new Date().toISOString() } = {}) {
    const message = { id: randomUUID(), text, createdAt, author, attachment, isFavorite: false };
    messages.push(message);
    return message;
  }

  function addFile(name, type, buffer, options = {}) {
    const attachment = { id: randomUUID(), name, type, size: buffer.length, category: fileCategory(type) };
    files.set(attachment.id, { ...attachment, buffer });
    return addMessage('', { ...options, attachment });
  }

  function search(query) {
    const needle = query.toLocaleLowerCase('ru');
    return messages.filter((message) => `${message.text} ${message.attachment?.name || ''}`.toLocaleLowerCase('ru').includes(needle));
  }

  function getPin() {
    return messages.find((message) => message.id === pinnedId) || null;
  }

  function setPin(id) {
    pinnedId = id;
    return getPin();
  }

  function history(before) {
    const end = before ? messages.findIndex((message) => message.id === before) : messages.length;
    if (end === -1) return null;
    const start = Math.max(0, end - PAGE_SIZE);
    return {
      messages: messages.slice(start, end),
      hasMore: start > 0,
      nextCursor: start > 0 ? messages[start].id : null,
    };
  }

  if (seed) {
    const examples = [
      'Идея для проекта: хранить заметки, ссылки и файлы в одном месте.',
      'Список покупок: чай, яблоки и хлеб.',
      'Редкая заметка: экспедиция на Марс. Найдите её поиском по слову «экспедиция».',
      'Материалы курса: https://netology.ru/',
      'Обычная HTTP-ссылка: http://example.com/',
      'План на неделю\n1. Повторить DOM\n2. Закончить проект\n3. Проверить результат',
      'Заметка о встрече: обсудить интерфейс органайзера.',
      'Полезная документация: https://developer.mozilla.org/ru/docs/Web/JavaScript',
    ];
    for (let index = 0; index < 34; index += 1) {
      const text = index === 2 ? 'Архивный маяк: эта уникальная заметка находится в начале истории.' : examples[index % examples.length];
      addMessage(`${text}\nДемонстрационная запись ${index + 1}.`, {
        createdAt: new Date(Date.UTC(2026, 9, 20 + Math.floor(index / 6), 9, (index % 6) * 10)).toISOString(),
      });
    }
    const demoFiles = [
      ['demo-image.png', 'image/png'], ['demo-audio.wav', 'audio/wav'],
      ['demo-video.webm', 'video/webm'], ['demo-note.txt', 'text/plain'],
    ];
    demoFiles.forEach(([name, type], index) => {
      addFile(name, type, readFileSync(new URL(`./demo/${name}`, import.meta.url)), {
        createdAt: new Date(Date.UTC(2026, 9, 26, 9, index * 10)).toISOString(),
      });
    });
  }

  return { messages, files, addMessage, addFile, history, search, getPin, setPin };
}
