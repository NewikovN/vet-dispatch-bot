/**
 * scripts/migrate-add-cancelled-status.ts — миграция ДЛЯ ПРОДА: добавляет статус 'cancelled'
 * в requests.status и столбец requests.cancelled_at.
 *
 * В отличие от migrate-add-address-column.ts, простым `ALTER TABLE ... ADD COLUMN` тут не
 * обойтись: requests.status объявлен с `CHECK (status IN (...))`, а SQLite НЕ умеет менять
 * CHECK-constraint через ALTER TABLE — единственный официальный способ (см. "Making Other Kinds
 * Of Table Schema Changes" в документации SQLite) — пересобрать таблицу: создать новую с нужной
 * схемой, скопировать данные, удалить старую, переименовать новую.
 *
 * Идемпотентна: если requests.cancelled_at уже есть — считаем, что миграция уже применена,
 * ничего не делаем (тот же маркер, что использует пересборка ниже).
 *
 * НЕЗАВИСИМА от порядка с migrate-add-address-column.ts: колонка address на боевой базе к
 * моменту запуска этой миграции может быть ещё не добавлена (обе миграции пока не выполнялись
 * на проде) — читаем реальный список столбцов старой таблицы через PRAGMA table_info и сами
 * подставляем '' вместо address, если его ещё нет. Так эту миграцию можно запускать и до, и
 * после migrate-add-address-column.ts — результат один и тот же.
 *
 * Перед пересборкой делает резервную копию файла БД
 * (`<dbPath>.before-cancelled-migration-<ISO-метка времени>.bak`) через db.backup() (SQLite
 * Online Backup API) — НЕ голый fs.copyFileSync: база в режиме WAL (schema.sql), часть свежих
 * изменений может лежать в .db-wal и не попасть в простую копию основного файла; db.backup()
 * снимает консистентный снапшот независимо от WAL. Метка времени в имени — db.backup() молча
 * перезаписывает файл назначения, если он уже существует (проверено), поэтому фиксированное имя
 * стирало бы бэкап от предыдущей попытки миграции. Это ДОПОЛНИТЕЛЬНАЯ подстраховка поверх
 * штатных cron-бэкапов (см. PROGRESS.md) — на случай если пересборка технически отработает без
 * ошибок, но данные окажутся логически повреждены и это вскроется уже после успешного commit.
 * Если сам бэкап не удался — миграция прерывается, к пересборке не переходим.
 *
 * НЕ выполняется этим агентом на проде — только готовится. Запуск на сервере вручную,
 * ДО `pnpm build && systemctl restart vet-bot`, из корня проекта:
 *
 *   pnpm exec tsx scripts/migrate-add-cancelled-status.ts
 *   (или с DB_PATH=путь/к/базе, если база не в стандартном месте)
 */
import Database from 'better-sqlite3';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const dbPath = resolve(projectRoot, process.env.DB_PATH ?? 'data.db');

console.log('Миграция requests.status (+ cancelled) и requests.cancelled_at: открываю', dbPath);

const db = new Database(dbPath);

const oldColumns = (db.prepare(`PRAGMA table_info(requests)`).all() as Array<{ name: string }>).map((c) => c.name);
const hasCancelledAt = oldColumns.includes('cancelled_at');
const hasAddress = oldColumns.includes('address');

if (hasCancelledAt) {
  console.log('Столбец cancelled_at уже есть в requests — миграция не нужна, ничего не делаю.');
} else {
  const addressSelectExpr = hasAddress ? 'address' : `'' AS address`;

  console.log(hasAddress ? 'address уже есть в старой таблице.' : 'address ещё нет — подставлю пустую строку.');

  // Метка времени в имени — db.backup() молча ПЕРЕЗАПИСЫВАЕТ файл назначения, если он уже
  // существует (проверено: второй backup() на тот же путь не падает, а подменяет содержимое
  // текущим состоянием источника). С фиксированным именем повторная попытка миграции стёрла бы
  // бэкап от предыдущей попытки — с меткой времени каждый прогон оставляет свой файл.
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.before-cancelled-migration-${timestamp}.bak`;
  console.log('Резервная копия перед пересборкой:', backupPath);
  try {
    await db.backup(backupPath);
  } catch (err) {
    console.error('ОШИБКА: не удалось сделать резервную копию — миграция прервана, таблицу requests не трогал.', err);
    process.exit(1);
  }
  console.log('Резервная копия готова.');

  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE requests_new (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        created_by         TEXT NOT NULL REFERENCES users(user_id),
        date               TEXT NOT NULL,
        city               TEXT NOT NULL,
        address            TEXT NOT NULL DEFAULT '',
        animal             TEXT NOT NULL,
        problem            TEXT NOT NULL,
        price_note         TEXT NOT NULL DEFAULT '',
        client_contacts    TEXT NOT NULL,
        status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'taken', 'approved', 'closed', 'cancelled')),
        assigned_doctor_id TEXT REFERENCES users(user_id),
        check_amount       INTEGER,
        group_message_id   TEXT,
        manage_message_id  TEXT,
        created_at         TEXT NOT NULL,
        taken_at           TEXT,
        approved_at        TEXT,
        closed_at          TEXT,
        cancelled_at       TEXT
      );
    `);

    db.exec(`
      INSERT INTO requests_new
        (id, created_by, date, city, address, animal, problem, price_note, client_contacts, status,
         assigned_doctor_id, check_amount, group_message_id, manage_message_id, created_at, taken_at,
         approved_at, closed_at)
      SELECT
        id, created_by, date, city, ${addressSelectExpr}, animal, problem, price_note, client_contacts, status,
        assigned_doctor_id, check_amount, group_message_id, manage_message_id, created_at, taken_at,
        approved_at, closed_at
      FROM requests;
    `);

    db.exec(`DROP TABLE requests;`);
    db.exec(`ALTER TABLE requests_new RENAME TO requests;`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);`);
  });

  // foreign_keys выключаем на время пересборки (стандартная процедура SQLite для смены схемы
  // таблицы, на которую есть FK) и проверяем целостность после — до COMMIT PRAGMA не переключить
  // внутри самой транзакции, поэтому обрамляем транзакцию снаружи.
  db.pragma('foreign_keys = OFF');
  rebuild();
  const fkErrors = db.pragma('foreign_key_check');
  if (Array.isArray(fkErrors) && fkErrors.length > 0) {
    console.error('ОШИБКА: нарушения внешних ключей после пересборки:', fkErrors);
    process.exitCode = 1;
  } else {
    console.log(
      `Готово: requests.status допускает 'cancelled', столбец cancelled_at добавлен` +
        (hasAddress ? '.' : ', address тоже добавлен (его миграция ещё не запускалась) со значением \'\'.'),
    );
  }
  db.pragma('foreign_keys = ON');
}

db.close();
