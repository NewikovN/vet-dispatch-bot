/**
 * scripts/refresh-approved-cards.ts — РАЗОВАЯ ПРОД-ОПЕРАЦИЯ, не тест.
 *
 * Зачем: кнопка «Вернуть в бот» на управленческой карточке (renderManageKeyboard, статус
 * approved) рисуется только в момент, когда бот сам перерисовывает сообщение (editManageCard —
 * при take/approve/reject/cancel/return/close). Существующие заявки/вакцинации, которые УЖЕ
 * были в статусе approved на момент выката этой правки, свою карточку в MAX не перерисовывают
 * сами по себе — старое сообщение так и останется без новой кнопки, пока бот не перезапустят
 * повторно, а такого действия в обычном жизненном цикле approved-записи, кроме «Закрыть», нет.
 *
 * Что делает: находит ВСЕ заявки и вакцинации в статусе 'approved', у которых есть
 * manage_message_id (карточка была отправлена) и у города настроен manageChatId, и вызывает
 * editManageCard с их ТЕКУЩИМИ данными (через уже существующие toManageCard из
 * requestService.ts/vaccinationService.ts — не дублируем сборку карточки). Это ТОЛЬКО
 * перерисовка сообщения в MAX — никакие данные заявки/вакцинации в БД не меняются, статус
 * не трогается.
 *
 * Работает через РЕАЛЬНЫЙ MaxAdapter (не фейковый Messenger, как в проверочных скриптах) —
 * реально шлёт editMessage в MAX, поэтому запускается вручную на сервере (или локально с
 * реальным MAX_TOKEN в .env, если сознательно нужно потрогать боевые чаты).
 *
 * --dry-run — ничего не отправляет в MAX. Вместо editManageCard просто печатает в консоль id,
 * город, куда (chatId/messageId) отправился бы вызов, и готовый текст карточки (тот же
 * renderManageCardText, что реально уйдёт в сообщение) — чтобы посмотреть, что именно будет
 * затронуто, прежде чем реально трогать боевые чаты.
 *
 * Запуск (на сервере, из корня проекта):
 *   NODE_EXTRA_CA_CERTS=./certs/russian_trusted_root.pem pnpm exec tsx scripts/refresh-approved-cards.ts --dry-run
 *   NODE_EXTRA_CA_CERTS=./certs/russian_trusted_root.pem pnpm exec tsx scripts/refresh-approved-cards.ts
 *   (или pnpm refresh-approved-cards [-- --dry-run])
 */
import { db } from '../src/db/index.js';
import { bot } from '../src/adapters/max/bot.js';
import { MaxAdapter } from '../src/adapters/max/MaxAdapter.js';
import { getRequest } from '../src/db/requestsRepo.js';
import { getVaccination } from '../src/db/vaccinationsRepo.js';
import { getUser } from '../src/db/usersRepo.js';
import { getCityChats } from '../src/db/cityChatsRepo.js';
import { toManageCard as toRequestManageCard } from '../src/domain/requestService.js';
import { toManageCard as toVaccinationManageCard } from '../src/domain/vaccinationService.js';
import { renderManageCardText } from '../src/adapters/max/cardView.js';

const DRY_RUN = process.argv.includes('--dry-run');

const messenger = new MaxAdapter(bot.api);

interface Stats {
  ok: number;
  skipped: number;
  failed: number;
}

async function refreshRequests(): Promise<Stats> {
  const ids = (
    db
      .prepare(`SELECT id FROM requests WHERE status = 'approved' AND manage_message_id IS NOT NULL`)
      .all() as Array<{ id: number }>
  ).map((r) => r.id);

  const stats: Stats = { ok: 0, skipped: 0, failed: 0 };

  for (const id of ids) {
    const req = getRequest(id);
    if (!req || !req.manageMessageId) {
      console.log(`[заявка №${id}] пропущена — не найдена или нет manageMessageId (гонка с другим процессом?)`);
      stats.skipped++;
      continue;
    }

    const chats = getCityChats(req.city);
    if (!chats?.manageChatId) {
      console.log(`[заявка №${id}] пропущена — у города «${req.city}» не настроен управленческий чат`);
      stats.skipped++;
      continue;
    }

    const doctor = req.assignedDoctorId ? getUser(req.assignedDoctorId) : null;
    const card = toRequestManageCard(req, doctor?.displayName);

    if (DRY_RUN) {
      console.log(
        `\n[заявка №${id}] DRY-RUN — было бы отправлено в чат ${chats.manageChatId} (город «${req.city}»), ` +
          `messageId=${req.manageMessageId}:`,
      );
      console.log(renderManageCardText(card));
      console.log('---');
      stats.ok++;
      continue;
    }

    try {
      await messenger.editManageCard(chats.manageChatId, req.manageMessageId, card);
      console.log(`[заявка №${id}] карточка перерисована ✅`);
      stats.ok++;
    } catch (err) {
      console.error(`[заявка №${id}] ОШИБКА при перерисовке:`, err);
      stats.failed++;
    }
  }

  return stats;
}

async function refreshVaccinations(): Promise<Stats> {
  const ids = (
    db
      .prepare(`SELECT id FROM vaccinations WHERE status = 'approved' AND manage_message_id IS NOT NULL`)
      .all() as Array<{ id: number }>
  ).map((r) => r.id);

  const stats: Stats = { ok: 0, skipped: 0, failed: 0 };

  for (const id of ids) {
    const vac = getVaccination(id);
    if (!vac || !vac.manageMessageId) {
      console.log(`[вакцинация №${id}] пропущена — не найдена или нет manageMessageId (гонка с другим процессом?)`);
      stats.skipped++;
      continue;
    }

    const chats = getCityChats(vac.city);
    if (!chats?.manageChatId) {
      console.log(`[вакцинация №${id}] пропущена — у города «${vac.city}» не настроен управленческий чат`);
      stats.skipped++;
      continue;
    }

    const doctor = vac.assignedDoctorId ? getUser(vac.assignedDoctorId) : null;
    const card = toVaccinationManageCard(vac, doctor?.displayName);

    if (DRY_RUN) {
      console.log(
        `\n[вакцинация №${id}] DRY-RUN — было бы отправлено в чат ${chats.manageChatId} (город «${vac.city}»), ` +
          `messageId=${vac.manageMessageId}:`,
      );
      console.log(renderManageCardText(card));
      console.log('---');
      stats.ok++;
      continue;
    }

    try {
      await messenger.editManageCard(chats.manageChatId, vac.manageMessageId, card);
      console.log(`[вакцинация №${id}] карточка перерисована ✅`);
      stats.ok++;
    } catch (err) {
      console.error(`[вакцинация №${id}] ОШИБКА при перерисовке:`, err);
      stats.failed++;
    }
  }

  return stats;
}

async function main() {
  console.log(
    DRY_RUN
      ? 'DRY-RUN: показываю, что было бы затронуто — реальных вызовов к MAX API НЕ будет.'
      : 'Разовая перерисовка управленческих карточек в статусе approved (добавляет кнопку «Вернуть в бот»).',
  );
  console.log('Данные заявок/вакцинаций НЕ меняются — только сообщения в MAX.\n');

  console.log('=== Заявки ===');
  const reqStats = await refreshRequests();

  console.log('\n=== Вакцинации ===');
  const vacStats = await refreshVaccinations();

  console.log('\n=== Итого ===');
  const label = DRY_RUN ? 'было бы затронуто' : 'ok';
  console.log(`Заявки:     ${label}=${reqStats.ok}, пропущено=${reqStats.skipped}, ошибок=${reqStats.failed}`);
  console.log(`Вакцинации: ${label}=${vacStats.ok}, пропущено=${vacStats.skipped}, ошибок=${vacStats.failed}`);

  db.close();

  if (reqStats.failed > 0 || vacStats.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Скрипт упал:', err);
  process.exit(1);
});
