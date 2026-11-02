import { randomUUID } from 'node:crypto';

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

  function addMessage(text, { attachment = null, author = 'user', createdAt = new Date().toISOString() } = {}) {
    const message = { id: randomUUID(), text, createdAt, author, attachment };
    messages.push(message);
    return message;
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
      addMessage(`${examples[index % examples.length]}\nДемонстрационная запись ${index + 1}.`, {
        createdAt: new Date(Date.UTC(2026, 9, 20 + Math.floor(index / 6), 9, (index % 6) * 10)).toISOString(),
      });
    }
  }

  return { messages, files, addMessage, history };
}
