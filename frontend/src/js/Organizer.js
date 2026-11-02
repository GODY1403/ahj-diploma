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
    this.messages = new Map();
    this.mode = 'history';
    this.pinned = null;
    this.changing = false;
    this.searchForm = document.querySelector('[data-search-form]');
    this.category = document.querySelector('[data-category]');
    this.cursor = null;
    this.hasMore = false;
    this.loading = false;
    this.sending = false;
    this.dragDepth = 0;
  }

  init() {
    document.querySelector('[data-refresh]').addEventListener('click', () => this.showView(this.mode));
    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => this.showView(button.dataset.mode));
    });
    this.searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.showView('search');
    });
    document.querySelector('[data-clear-search]').addEventListener('click', () => this.showView('history'));
    this.category.addEventListener('change', () => this.showView('attachments'));
    document.querySelector('[data-unpin]').addEventListener('click', () => this.changePin(null));
    this.list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const id = button.closest('[data-id]').dataset.id;
      if (button.dataset.action === 'pin') this.changePin(this.pinned?.id === id ? null : id);
      else this.changeFavorite(id);
    });
    document.querySelector('[data-help]').addEventListener('click', () => {
      const help = document.querySelector('[data-command-help]');
      help.hidden = !help.hidden;
    });
    document.querySelectorAll('[data-command]').forEach((button) => {
      button.addEventListener('click', () => {
        this.form.elements.text.value = `@chaos: ${button.dataset.command}`;
        this.form.elements.text.focus();
      });
    });
    this.form.addEventListener('submit', (event) => this.send(event));
    this.form.elements.text.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.form.requestSubmit();
      }
    });
    this.history.addEventListener('scroll', () => {
      if (this.mode === 'history' && this.history.scrollTop <= 30 && this.hasMore && !this.loading) this.loadHistory(true);
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
    this.showView('history');
  }

  async showView(mode) {
    if (this.loading) return;
    const query = this.searchForm.elements.query.value.trim();
    if (mode === 'search' && !query) {
      this.notice.textContent = 'Введите слово или фразу для поиска.';
      return;
    }
    this.mode = mode;
    const titles = { history: 'Сообщения', search: 'Результаты поиска', favorites: 'Избранное', attachments: 'Вложения' };
    document.querySelector('h1').textContent = titles[mode];
    document.querySelector('[data-category-filter]').hidden = mode !== 'attachments';
    document.querySelector('[data-clear-search]').hidden = mode !== 'search';
    document.querySelector('[data-history-status]').textContent = mode === 'history' ? 'Последние 10 сообщений · прокрутите вверх для продолжения' : 'По всей истории на сервере';
    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === mode);
      if (button.dataset.mode === mode) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (mode === 'history') {
      this.searchForm.elements.query.value = '';
      await this.loadHistory();
    } else {
      this.setLoading(true);
      this.notice.textContent = '';
      try {
        const result = mode === 'search' ? await this.api.search(query)
          : mode === 'favorites' ? await this.api.favorites() : await this.api.attachments(this.category.value);
        this.messages.clear();
        this.list.replaceChildren(...this.makeNodes(result.messages));
        this.hasMore = false;
        this.cursor = null;
        this.history.scrollTop = 0;
        this.olderStatus.textContent = result.messages.length ? `Найдено: ${result.messages.length}` : 'Ничего не найдено.';
      } catch (error) { this.notice.textContent = error.message; }
      finally { this.setLoading(false); }
    }
    await this.loadPin();
  }

  makeNodes(messages) {
    return messages.filter((message) => !this.messages.has(message.id)).map((message) => {
      this.messages.set(message.id, message);
      return messageView(message, this.api, this.pinned?.id);
    });
  }

  async loadHistory(older = false) {
    if (this.loading || (older && !this.hasMore)) return;
    this.setLoading(true);
    this.notice.textContent = '';
    this.olderStatus.textContent = 'Загрузка…';
    try {
      const page = await this.api.history(older ? this.cursor : '');
      const height = this.history.scrollHeight;
      const top = this.history.scrollTop;
      if (!older) { this.messages.clear(); this.list.replaceChildren(); }
      const nodes = this.makeNodes(page.messages);
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
    } finally { this.setLoading(false); }
  }

  appendMessages(messages) {
    this.list.append(...this.makeNodes(messages));
    this.history.scrollTop = this.history.scrollHeight;
  }

  async send(event) {
    event.preventDefault();
    const text = this.form.elements.text.value.trim();
    if (!text || this.sending || this.loading) return;
    this.setSending(true);
    this.notice.textContent = '';
    try {
      const result = await this.api.send(text);
      if (this.mode !== 'history') await this.showView('history');
      this.appendMessages(result.messages);
      this.form.elements.text.value = '';
    } catch (error) { this.notice.textContent = error.message; }
    finally { this.setSending(false); }
  }

  async uploadFiles(files) {
    if (!files.length) return;
    if (this.sending || this.loading) {
      this.notice.textContent = 'Дождитесь завершения текущего запроса и повторите загрузку файла.';
      return;
    }
    this.setSending(true);
    this.notice.textContent = '';
    try {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) throw new Error('Файл слишком большой. Лимит — 5 МБ.');
        const result = await this.api.upload(file);
        if (this.mode !== 'history') await this.showView('history');
        this.appendMessages(result.messages);
      }
    } catch (error) { this.notice.textContent = error.message; }
    finally { this.fileInput.value = ''; this.setSending(false); }
  }

  setSending(value) {
    this.sending = value;
    this.updateControls();
  }

  setLoading(value) {
    this.loading = value;
    document.querySelectorAll('[data-mode], [data-search-form] button, [data-refresh]').forEach((button) => { button.disabled = value; });
    this.category.disabled = value;
    this.updateControls();
  }

  updateControls() {
    const busy = this.loading || this.sending;
    this.form.querySelector('button').disabled = busy;
    this.fileInput.disabled = busy;
    this.form.elements.text.disabled = busy;
  }

  async loadPin() {
    try {
      const result = await this.api.getPin();
      this.pinned = result.message;
      this.renderPin();
    } catch (error) { this.notice.textContent = error.message; }
  }

  renderPin() {
    document.querySelector('[data-pin]').hidden = !this.pinned;
    document.querySelector('[data-pin-text]').textContent = this.pinned ? this.pinned.text || this.pinned.attachment.name : '';
    this.updateActions();
  }

  updateActions() {
    this.list.querySelectorAll('[data-id]').forEach((node) => {
      const message = this.messages.get(node.dataset.id);
      const favorite = node.querySelector('[data-action="favorite"]');
      favorite.textContent = message.isFavorite ? 'Убрать из избранного' : 'В избранное';
      favorite.setAttribute('aria-pressed', String(message.isFavorite));
      const pin = node.querySelector('[data-action="pin"]');
      const pinned = this.pinned?.id === message.id;
      pin.textContent = pinned ? 'Открепить' : 'Закрепить';
      pin.setAttribute('aria-pressed', String(pinned));
    });
  }

  async changePin(id) {
    if (this.changing) return;
    this.changing = true;
    this.notice.textContent = '';
    try {
      const result = id ? await this.api.pin(id) : await this.api.unpin();
      this.pinned = result.message;
      this.renderPin();
    } catch (error) { this.notice.textContent = error.message; }
    finally { this.changing = false; }
  }

  async changeFavorite(id) {
    if (this.changing) return;
    this.changing = true;
    this.notice.textContent = '';
    try {
      const result = await this.api.favorite(id, !this.messages.get(id).isFavorite);
      this.messages.set(id, result.message);
      if (this.mode === 'favorites') await this.showView('favorites');
      else this.updateActions();
    } catch (error) { this.notice.textContent = error.message; }
    finally { this.changing = false; }
  }
}
