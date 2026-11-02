function appendText(parent, text) {
  const pattern = /https?:\/\/[^\s<>"]+/g;
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    let value = match[0].replace(/[.,!?;:]+$/, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1);
    }
    parent.append(document.createTextNode(text.slice(position, match.index)));
    try {
      const url = new URL(value);
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = value;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      parent.append(link);
    } catch { parent.append(document.createTextNode(value)); }
    position = match.index + value.length;
  }
  parent.append(document.createTextNode(text.slice(position)));
}

export default function messageView(message, api) {
  const article = document.createElement('article');
  article.className = `message${message.author === 'bot' ? ' bot-message' : ''}`;
  article.dataset.id = message.id;
  const heading = document.createElement('div');
  heading.className = 'message-heading';
  const author = document.createElement('span');
  author.textContent = message.author === 'bot' ? 'Chaos · помощник' : 'Вы';
  const time = document.createElement('time');
  time.dateTime = message.createdAt;
  time.textContent = new Date(message.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  heading.append(author, time);
  article.append(heading);
  if (message.text) {
    const text = document.createElement('p');
    text.className = 'message-text';
    appendText(text, message.text);
    article.append(text);
  }
  if (message.attachment) {
    const file = message.attachment;
    const attachment = document.createElement('div');
    attachment.className = 'attachment';
    if (file.category === 'images' && file.type !== 'image/svg+xml') {
      const image = document.createElement('img');
      image.src = api.url(`api/files/${file.id}`);
      image.alt = file.name;
      image.width = 320;
      image.height = 180;
      attachment.append(image);
    }
    const name = document.createElement('strong');
    name.textContent = file.name;
    const info = document.createElement('span');
    info.className = 'file-info';
    info.textContent = `${file.type} · ${(file.size / 1024).toFixed(1)} КБ`;
    const download = document.createElement('a');
    download.href = api.url(`api/files/${file.id}/download`);
    download.textContent = 'Скачать файл';
    download.className = 'download-link';
    attachment.append(name, info, download);
    article.append(attachment);
  }
  return article;
}
