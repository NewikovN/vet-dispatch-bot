/**
 * scripts/manual-test.ts — ручная проверка: listRequestsForExport() отдаёт ТОЛЬКО закрытые
 * (closed) заявки, даже без фильтра (никакого фильтра по city/from/to — самый широкий вызов).
 *
 * Работает на ТЕСТОВОЙ базе (data-seed.db, наполняется `pnpm seed`), не на боевой data.db —
 * DB_PATH выставляется здесь ДО импорта db/index.ts (модуль открывает соединение по этой
 * переменной при первом импорте, см. db/index.ts).
 *
 * Запуск:
 *   pnpm seed
 *   pnpm exec tsx scripts/manual-test.ts
 */
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const dbPath = resolve(projectRoot, process.env.SEED_DB_PATH ?? 'data-seed.db');

// Защита от случайного запуска на боевой базе — та же проверка, что в seed.ts
if (/(^|[\\/])data\.db$/.test(dbPath)) {
  console.error(`Отказ: путь указывает на рабочую базу (${dbPath}). Используйте data-seed.db.`);
  process.exit(1);
}

process.env.DB_PATH = dbPath;
console.log('manual-test: проверяю listRequestsForExport() на', dbPath);

const { db } = await import('../src/db/index.js');
const { listRequestsForExport, createRequest, claimRequest, approveRequest, closeRequest } = await import(
  '../src/db/requestsRepo.js'
);

let rows = listRequestsForExport({});
console.log(`listRequestsForExport({}) вернул ${rows.length} строк(и).`);

if (rows.length === 0) {
  console.log('Closed-заявок в базе не нашлось — создаю одну и провожу через claim/approve/close вручную.');

  const anyUser = db.prepare('SELECT user_id FROM users LIMIT 1').get() as { user_id: string } | undefined;
  if (!anyUser) {
    console.error('В базе нет ни одного пользователя — сначала выполните `pnpm seed`.');
    process.exit(1);
  }
  const userId = anyUser.user_id;

  const id = createRequest({
    createdBy: userId,
    date: '01.01.2026',
    city: 'Тестовый город (manual-test)',
    animal: 'Тест-животное',
    problem: 'Тест: проверка фильтра отчёта на closed',
    priceNote: '',
    clientContacts: 'Тест Тестов, +70000000000',
  });

  const claimed = claimRequest(id, userId);
  const approved = approveRequest(id);
  const closed = closeRequest(id, userId, 150000);
  console.log(`Заявка №${id} проведена по статусам: claim=${claimed}, approve=${approved}, close=${closed}`);

  rows = listRequestsForExport({});
  console.log(`После ручного прогона: listRequestsForExport({}) вернул ${rows.length} строк(и).`);
}

const statuses = rows.map((r) => r.status);
console.log('Статусы в выдаче:', statuses);

const allClosed = statuses.length > 0 && statuses.every((s) => s === 'closed');

if (!allClosed) {
  console.error('ОШИБКА: в выдаче есть заявки со статусом, отличным от closed (или выдача пуста).');
  process.exit(1);
}

console.log(`OK: все ${statuses.length} строк(и) — статус 'closed'.`);
