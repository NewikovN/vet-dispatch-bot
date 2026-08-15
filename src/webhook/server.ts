/**
 * Express-приложение для приёма событий MAX через webhook (прод-транспорт).
 * Экспортирует только `app` — сам listen() делает точка входа (app-max-webhook.ts),
 * чтобы этот файл можно было импортировать/тестировать без побочного эффекта открытия порта.
 *
 * Регистрация обработчиков (bot.on(...)) — в ../handlers.js, ОБЩАЯ с long polling. Здесь
 * только транспорт: приём HTTP-запроса от MAX и передача Update тем же обработчикам.
 */
import express from 'express';
import { bot } from '../adapters/max/bot.js';

type HandleUpdateFn = (update: unknown) => Promise<void>;

// Bot.handleUpdate объявлен `private` в .d.ts библиотеки (core: dist/bot.d.ts), но библиотека
// НЕ поддерживает webhook вообще — Bot.start() умеет только long polling (core/network/polling.js).
// handleUpdate — единственная точка, которая превращает сырой Update в вызов зарегистрированных
// bot.on(...) обработчиков (см. dist/bot.js: Polling.loop дёргает именно его на каждый апдейт).
// На рантайме это обычное свойство: bot.js присваивает его стрелочной функцией в конструкторе
// (this.handleUpdate = async (update) => {...}) — `private` в .d.ts стирается при компиляции TS
// и не создаёт настоящей рантайм-инкапсуляции (в отличие от `#privateField`), поэтому вызов
// извне работает один в один как из Polling.loop(). Приведение типа — осознанный обход того,
// что .d.ts скрывает сигнатуру приватных членов целиком (даже не показывает типы аргументов).
const handleUpdate = (bot as unknown as { handleUpdate: HandleUpdateFn }).handleUpdate;

export const app = express();

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

app.post('/webhook', (req, res) => {
  const secret = req.header('x-max-bot-api-secret');
  const expected = process.env.MAX_WEBHOOK_SECRET;

  if (!expected || secret !== expected) {
    res.sendStatus(401);
    return;
  }

  // У MAX лимит на ответ — 30 сек. Отвечаем СРАЗУ и без await, обработку не ждём —
  // если обработчик упадёт, это уже не должно задерживать/менять HTTP-ответ MAX.
  res.sendStatus(200);

  handleUpdate(req.body).catch((err) => {
    console.error('Ошибка обработки webhook-апдейта:', err, JSON.stringify(req.body));
  });
});
