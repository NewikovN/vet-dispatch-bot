/**
 * Точка входа (прод): webhook. Вся бизнес-логика обработчиков — в handlers.ts (общая с dev/
 * polling точкой входа app-max.ts), здесь только транспорт: поднимает Express-сервер
 * (src/webhook/server.ts) на локальном порту — наружу его выставляет nginx на 443.
 *
 * НЕ вызывает bot.start() — это long polling, webhook и polling взаимоисключающи на стороне
 * MAX (см. src/webhook/register.ts). Саму подписку (POST /subscriptions) этот файл НЕ трогает —
 * это отдельное разовое действие при деплое/смене адреса: `pnpm webhook:register`.
 */
import './handlers.js';
import { bot } from './adapters/max/bot.js';
import { app } from './webhook/server.js';

const PORT = Number(process.env.PORT ?? 8080);

// Для паритета с long polling: Bot.start() перед циклом делает то же самое (getMyInfo),
// иначе в вебхук-режиме ctx.botInfo/ctx.myId остались бы undefined.
bot.api
  .getMyInfo()
  .then((info) => {
    bot.botInfo = info;
  })
  .catch((err) => {
    console.error('Не удалось получить информацию о боте (getMyInfo):', err);
  });

app.listen(PORT, () => {
  console.log(`MAX-бот запущен (webhook): слушаю порт ${PORT}, жду POST /webhook.`);
});
