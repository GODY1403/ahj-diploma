import messageView from './messageView';

export default class Organizer {
  constructor(api) {
    this.api = api;
    this.history = document.querySelector('[data-history]');
    this.list = document.querySelector('[data-message-list]');
    this.notice = document.querySelector('[data-notice]');
    this.connection = document.querySelector('[data-connection]');
    this.olderStatus = document.querySelector('[data-older-status]');
    this.form = document.querySelector('[data-composer]');
    this.fileInput = document.querySelector('[data-file-input]');
    this.dropOverlay = document.querySelector('[data-drop-overlay]');
    this.ids = new Set();
    this.cursor = null;
    this.hasMore = false;
    this.loading = false;
    this.sending = false;
    this.dragDepth = 0;
  }

  init() {
    document.querySelector('[data-refresh]').addEventListener('click', () => this.loadHistory());
    this.form.addEventListener('submit', (event) => this.send(event));
    this.form.elements.text.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.form.requestSubmit();
      }
    });
    this.history.addEventListener('scroll', () => {
      if (this.history.scrollTop <= 30 && this.hasMore && !this.loading) this.loadHistory(true);
    });
    this.fileInput.addEventListener('change', () => this.uploadFiles(this.fileInput.files));
    const workspace = document.querySelector('.workspace');
    workspace.addEventListener('dragenter', (event) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      this.dragDepth += 1;
      this.dropOverlay.hidden = false;
    });
    workspace.addEventListener('dragover', (event) => {
      if (event.dataTransfer.types.includes('Files')) event.preventDefault();
    });
    workspace.addEventListener('dragleave', () => {
      this.dragDepth -= 1;
      if (this.dragDepth <= 0) this.dropOverlay.hidden = true;
    });
    workspace.addEventListener('drop', (event) => {
      event.preventDefault();
      this.dragDepth = 0;
      this.dropOverlay.hidden = true;
      this.uploadFiles(event.dataTransfer.files);
    });
    this.loadHistory();
  }

  async loadHistory(older = false) {
    if (this.loading || (older && !this.hasMore)) return;
    this.loading = true;
    this.notice.textContent = '';
    this.olderStatus.textContent = 'Загрузка…';
    try {
      const page = await this.api.history(older ? this.cursor : '');
      const height = this.history.scrollHeight;
      const top = this.history.scrollTop;
      if (!older) { this.ids.clear(); this.list.replaceChildren(); }
      const nodes = page.messages.filter((message) => !this.ids.has(message.id)).map((message) => {
        this.ids.add(message.id);
        return messageView(message, this.api);
      });
      if (older) this.list.prepend(...nodes); else this.list.append(...nodes);
      this.cursor = page.nextCursor;
      this.hasMore = page.hasMore;
      this.olderStatus.textContent = this.hasMore ? 'Прокрутите вверх, чтобы загрузить ещё 10' : 'Начало истории';
      this.history.scrollTop = older ? top + this.history.scrollHeight - height : this.history.scrollHeight;
      this.connection.textContent = 'Сервер подключён';
      this.connection.classList.add('connected');
    } catch (error) {
      this.notice.textContent = error.message;
      this.olderStatus.textContent = 'Не удалось загрузить историю';
      this.connection.textContent = 'Нет соединения';
      this.connection.classList.remove('connected');
    } finally { this.loading = false; }
  }

  appendMessages(messages) {
    for (const message of messages) {
      if (this.ids.has(message.id)) continue;
      this.ids.add(message.id);
      this.list.append(messageView(message, this.api));
    }
    this.history.scrollTop = this.history.scrollHeight;
  }

  async send(event) {
    event.preventDefault();
    const text = this.form.elements.text.value.trim();
    if (!text || this.sending) return;
    this.setSending(true);
    this.notice.textContent = '';
    try {
      const result = await this.api.send(text);
      this.appendMessages(result.messages);
      this.form.elements.text.value = '';
    } catch (error) { this.notice.textContent = error.message; }
    finally { this.setSending(false); }
  }

  async uploadFiles(files) {
    if (!files.length || this.sending) return;
    this.setSending(true);
    this.notice.textContent = '';
    try {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) throw new Error('Файл слишком большой. Лимит — 5 МБ.');
        const result = await this.api.upload(file);
        this.appendMessages(result.messages);
      }
    } catch (error) { this.notice.textContent = error.message; }
    finally { this.fileInput.value = ''; this.setSending(false); }
  }

  setSending(value) {
    this.sending = value;
    this.form.querySelector('button').disabled = value;
    this.fileInput.disabled = value;
    this.form.elements.text.disabled = value;
  }
}
