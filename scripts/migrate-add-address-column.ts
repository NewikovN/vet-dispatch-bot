/**
 * scripts/migrate-add-address-column.ts — миграция ДЛЯ ПРОДА: добавляет столбец
 * requests.address в уже существующую боевую таблицу requests.
 *
 * `CREATE TABLE IF NOT EXISTS` в schema.sql (db/index.ts применяет его при каждом старте)
 * НЕ добавит новый столбец в таблицу, которая уже есть, — только `ALTER TABLE` может.
 * Поэтому это ОТДЕЛЬНЫЙ разовый скрипт, не запускается автоматически при старте бота.
 *
 * Идемпотентна: проверяет PRAGMA table_info(requests) перед ALTER TABLE — повторный
 * запуск (например, по ошибке дважды) ничего не ломает и не падает.
 *
 * НЕ выполняется этим агентом на проде — только готовится. Запуск на сервере вручную,
 * ДО `pnpm build && systemctl restart vet-bot`, из корня проекта:
 *
 *   pnpm exec tsx scripts/migrate-add-address-column.ts
 *   (или так же, но с DB_PATH=путь/к/базе, если база не в стандартном месте)
 *
 * Существующие строки получат address = '' (пустая строка, как и price_note при своём
 * добавлении) — сами заявки этим не ломаются, просто в старых карточках адрес будет пуст,
 * пока их не отредактируют вручную (редактирования заявок бот не поддерживает — это
 * ожидаемое ограничение миграции на уже закрытых/старых заявках).
 */
import Database from 'better-sqlite3';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const dbPath = resolve(projectRoot, process.env.DB_PATH ?? 'data.db');

console.log('Миграция requests.address: открываю', dbPath);

const db = new Database(dbPath);

const columns = db.prepare(`PRAGMA table_info(requests)`).all() as Array<{ name: string }>;
const hasAddress = columns.some((c) => c.name === 'address');

if (hasAddress) {
  console.log('Столбец address уже есть в requests — миграция не нужна, ничего не делаю.');
} else {
  db.exec(`ALTER TABLE requests ADD COLUMN address TEXT NOT NULL DEFAULT ''`);
  console.log('Готово: столбец requests.address добавлен (существующие строки получили address = \'\').');
}

db.close();
