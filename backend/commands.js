const forecasts = [
  'Демонстрационный прогноз: солнечно, +18 °C. Хороший день для прогулки.',
  'Демонстрационный прогноз: облачно, +12 °C. Возьмите лёгкую куртку.',
  'Демонстрационный прогноз: дождь, +9 °C. Не забудьте зонт.',
];
const jokes = [
  'Программист поставил чайник, а потом решил проверить, воспроизводится ли кипение.',
  'Самая короткая история про дедлайн: «Почти готово».',
  'Почему компьютер не мёрзнет? У него всегда открыты окна.',
];
const pick = (items) => items[Math.floor(Math.random() * items.length)];

export function botReply(text, now = new Date()) {
  if (!/^@chaos:/i.test(text)) return null;
  const command = text.slice(7).trim().toLowerCase();
  const options = { timeZone: 'Europe/Moscow' };
  switch (command) {
    case 'help':
      return 'Команды Chaos:\n@chaos: help — помощь\n@chaos: time — московское время\n@chaos: date — текущая дата в Москве\n@chaos: weather — случайный демонстрационный прогноз\n@chaos: joke — короткая шутка';
    case 'time': return `Московское время: ${now.toLocaleTimeString('ru-RU', options)}`;
    case 'date': return `Сегодня: ${now.toLocaleDateString('ru-RU', options)} (Москва).`;
    case 'weather': return pick(forecasts);
    case 'joke': return pick(jokes);
    default: return 'Неизвестная команда. Напишите @chaos: help, чтобы увидеть список.';
  }
}
