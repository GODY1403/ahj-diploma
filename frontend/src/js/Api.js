export default class Api {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  url(path) {
    return new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`).href;
  }

  async request(path, options = {}) {
    if (!this.baseUrl) throw new Error('Публичный сервер пока не подключён. Инструкция запуска находится в README репозитория.');
    let response;
    try {
      response = await fetch(this.url(path), { ...options, signal: AbortSignal.timeout(90000) });
    } catch {
      throw new Error('Сервер недоступен. Проверьте соединение и запуск backend, затем нажмите «Обновить».');
    }
    let result;
    try { result = await response.json(); } catch { throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.'); }
    if (!response.ok) throw new Error(result.error || `Ошибка сервера (${response.status}).`);
    return result;
  }

  history(before = '') {
    return this.request(`api/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`);
  }

  send(text) {
    return this.request('api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  }

  upload(file) {
    const data = new FormData();
    data.append('file', file);
    return this.request('api/files', { method: 'POST', body: data });
  }

  search(query) { return this.request(`api/search?q=${encodeURIComponent(query)}`); }
  favorites() { return this.request('api/favorites'); }
  attachments(category) { return this.request(`api/attachments?category=${encodeURIComponent(category)}`); }
  getPin() { return this.request('api/pin'); }
  pin(id) { return this.request('api/pin', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); }
  unpin() { return this.request('api/pin', { method: 'DELETE' }); }
  favorite(id, isFavorite) {
    return this.request(`api/messages/${id}/favorite`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isFavorite }) });
  }
}
