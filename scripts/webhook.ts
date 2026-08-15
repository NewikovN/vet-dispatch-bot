/**
 * scripts/webhook.ts — управление webhook-подпиской MAX. Разовое действие при деплое/смене
 * адреса — НЕ часть обычного запуска процесса (app-max-webhook.ts подписку не трогает).
 *
 * Запуск:
 *   pnpm webhook:register   — ставит подписку на MAX_WEBHOOK_URL с секретом MAX_WEBHOOK_SECRET
 *                              (сначала удаляет старые подписки — webhook и polling несовместимы)
 *   pnpm webhook:delete     — снимает все подписки (например, чтобы вернуться на long polling)
 *   pnpm webhook:list       — показывает текущие подписки
 */
import { config } from '../src/config.js';
import { registerWebhook, deleteWebhook, listWebhooks } from '../src/webhook/register.js';

const cmd = process.argv[2];

async function main() {
  if (cmd === 'register') {
    const url = process.env.MAX_WEBHOOK_URL;
    const secret = process.env.MAX_WEBHOOK_SECRET;
    if (!url || !secret) {
      console.error('Нужны MAX_WEBHOOK_URL и MAX_WEBHOOK_SECRET в .env');
      process.exit(1);
    }
    console.log(`Регистрирую webhook для бота (директор из .env: ${config.directorId}): ${url}`);
    await registerWebhook(url, secret);
    console.log('Готово. Старые подписки (если были) удалены, новая — активна.');
    return;
  }

  if (cmd === 'delete') {
    await deleteWebhook();
    console.log('Все подписки удалены. Можно возвращаться на long polling (pnpm dev:max).');
    return;
  }

  if (cmd === 'list') {
    const subs = await listWebhooks();
    console.log(subs.length ? subs : 'Подписок нет.');
    return;
  }

  console.error('Использование: tsx scripts/webhook.ts <register|delete|list>');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
