/**
 * Точка входа (dev): long polling. Вся бизнес-логика обработчиков — в handlers.ts
 * (общая с прод-точкой входа src/app-max-webhook.ts), здесь только транспорт.
 */
import './handlers.js';
import { bot } from './adapters/max/bot.js';

// bot.start() крутит long polling в бесконечном цикле и резолвится только после stop() —
// поэтому не await'им его здесь, иначе строка ниже никогда бы не напечаталась.
bot
  .start({
    allowedUpdates: ['bot_started', 'message_created', 'message_callback', 'bot_added'],
  })
  .catch((err) => {
    console.error('Ошибка long polling:', err);
    process.exit(1);
  });

console.log('MAX-бот запущен (long polling)');
